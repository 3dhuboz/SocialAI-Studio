import type { Hono } from 'hono';
import type { Env } from '../env';
import { requireAuth } from '../middleware/auth';

export const MAX_REEL_UPLOAD_BYTES = 95 * 1024 * 1024;

const TYPE_EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function originalFilename(value: string | undefined, extension: string): string {
  if (!value) return `uploaded-reel.${extension}`;
  try {
    return decodeURIComponent(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160)
      || `uploaded-reel.${extension}`;
  } catch {
    return `uploaded-reel.${extension}`;
  }
}

export function registerReelMediaRoutes(app: Hono<{ Bindings: Env }>): void {
  app.use('/api/reel-media', requireAuth);
  app.use('/api/reel-media/*', requireAuth);

  app.post('/api/reel-media/uploads', async (c) => {
    if (!c.env.REELS_R2 || !c.env.R2_REELS_PUBLIC_BASE?.trim()) {
      return c.json({ error: 'Reel storage is not configured.' }, 503);
    }

    const contentType = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
    const extension = TYPE_EXTENSIONS[contentType];
    if (!extension) {
      return c.json({ error: 'Choose an MP4, MOV or WebM video.' }, 415);
    }

    const declaredSize = positiveInteger(c.req.header('X-Reel-Size'));
    if (!declaredSize) {
      return c.json({ error: 'The video size is missing or invalid.' }, 400);
    }
    if (declaredSize > MAX_REEL_UPLOAD_BYTES) {
      return c.json({ error: 'Keep Reel uploads under 95 MB.' }, 413);
    }

    const contentLength = positiveInteger(c.req.header('Content-Length'));
    if (contentLength && contentLength > MAX_REEL_UPLOAD_BYTES) {
      return c.json({ error: 'Keep Reel uploads under 95 MB.' }, 413);
    }

    const uid = c.get('uid') as string;
    const clientId = c.req.header('X-Client-Id')?.trim() || null;
    if (clientId) {
      const ownedClient = await c.env.DB.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?')
        .bind(clientId, uid)
        .first<{ id: string }>();
      if (!ownedClient) return c.json({ error: 'Client workspace not found.' }, 404);
    }

    const body = c.req.raw.body;
    if (!body) return c.json({ error: 'The video file is empty.' }, 400);

    const key = `reels/uploads/${crypto.randomUUID()}.${extension}`;
    const durationMs = positiveInteger(c.req.header('X-Reel-Duration-Ms'));
    await c.env.REELS_R2.put(key, body, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        ownerId: uid,
        clientId: clientId || 'own',
        originalName: originalFilename(c.req.header('X-Reel-Filename'), extension),
        source: 'reel-studio',
        ...(durationMs ? { durationMs: String(durationMs) } : {}),
      },
    });

    const publicBase = c.env.R2_REELS_PUBLIC_BASE.replace(/\/+$/, '');
    return c.json({
      key,
      url: `${publicBase}/${key}`,
      contentType,
      sizeBytes: declaredSize,
    }, 201);
  });
}
