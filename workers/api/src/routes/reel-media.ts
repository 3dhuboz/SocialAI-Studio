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

function finiteSecond(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function secondString(value: number): string {
  return `${Number(value.toFixed(3))}s`;
}

function finishTimingIssue(input: {
  sourceDurationSeconds: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
  coverSeconds: number | null;
}): string | null {
  const { sourceDurationSeconds, startSeconds, endSeconds, coverSeconds } = input;
  if (startSeconds === null || endSeconds === null || coverSeconds === null) {
    return 'Choose valid trim and cover times.';
  }
  if (startSeconds < 0 || endSeconds <= startSeconds) {
    return 'The trim end must come after the start.';
  }
  const clipDuration = endSeconds - startSeconds;
  if (clipDuration < 1) return 'The finished Reel must be at least 1 second.';
  if (clipDuration > 60) return 'The finished Reel cannot exceed 60 seconds.';
  if (coverSeconds < startSeconds || coverSeconds > endSeconds) {
    return 'Choose a cover frame inside the finished clip.';
  }
  if (sourceDurationSeconds !== null && endSeconds > sourceDurationSeconds + 0.05) {
    return 'The trim end is beyond the uploaded video.';
  }
  return null;
}

function publicAssetUrl(publicBase: string, key: string): string {
  return `${publicBase.replace(/\/+$/, '')}/${key}`;
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

  app.post('/api/reel-media/finish', async (c) => {
    if (!c.env.REELS_R2 || !c.env.R2_REELS_PUBLIC_BASE?.trim()) {
      return c.json({ error: 'Reel storage is not configured.' }, 503);
    }
    if (!c.env.MEDIA) {
      return c.json({ error: 'Reel finishing is not configured yet.' }, 503);
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return c.json({ error: 'The finishing request is invalid.' }, 400);
    }

    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (!/^reels\/uploads\/[a-zA-Z0-9-]+\.(mp4|mov|webm)$/.test(key)) {
      return c.json({ error: 'Choose a valid Reel Studio upload.' }, 400);
    }

    const clientId = typeof body.clientId === 'string' && body.clientId.trim()
      ? body.clientId.trim()
      : null;
    const startSeconds = finiteSecond(body.startSeconds);
    const endSeconds = finiteSecond(body.endSeconds);
    const coverSeconds = finiteSecond(body.coverSeconds);
    const source = await c.env.REELS_R2.get(key);
    const uid = c.get('uid') as string;
    const expectedWorkspace = clientId || 'own';
    if (
      !source
      || source.customMetadata?.ownerId !== uid
      || source.customMetadata?.clientId !== expectedWorkspace
    ) {
      return c.json({ error: 'Reel upload not found.' }, 404);
    }

    const durationMs = positiveInteger(source.customMetadata?.durationMs);
    const sourceDurationSeconds = durationMs ? durationMs / 1000 : null;
    const timingIssue = finishTimingIssue({
      sourceDurationSeconds,
      startSeconds,
      endSeconds,
      coverSeconds,
    });
    if (timingIssue || startSeconds === null || endSeconds === null || coverSeconds === null) {
      return c.json({ error: timingIssue || 'Choose valid trim and cover times.' }, 400);
    }

    const id = crypto.randomUUID();
    const videoKey = `reels/finished/${id}.mp4`;
    const coverKey = `reels/covers/${id}.jpg`;
    const clipDuration = Math.round((endSeconds - startSeconds) * 1000) / 1000;
    const commonMetadata = {
      ownerId: uid,
      clientId: expectedWorkspace,
      source: 'reel-studio-finish',
      sourceKey: key,
      startSeconds: String(startSeconds),
      endSeconds: String(endSeconds),
      coverSeconds: String(coverSeconds),
    };

    try {
      const videoResult = c.env.MEDIA.input(source.body).output({
        mode: 'video',
        time: secondString(startSeconds),
        duration: secondString(clipDuration),
        audio: true,
      });
      await c.env.REELS_R2.put(videoKey, await videoResult.media(), {
        httpMetadata: {
          contentType: await videoResult.contentType(),
          cacheControl: 'public, max-age=31536000, immutable',
        },
        customMetadata: commonMetadata,
      });

      const coverSource = await c.env.REELS_R2.get(key);
      if (!coverSource) throw new Error('The uploaded Reel disappeared while finishing.');
      const coverResult = c.env.MEDIA.input(coverSource.body).output({
        mode: 'frame',
        time: secondString(coverSeconds),
        format: 'jpg',
      });
      await c.env.REELS_R2.put(coverKey, await coverResult.media(), {
        httpMetadata: {
          contentType: await coverResult.contentType(),
          cacheControl: 'public, max-age=31536000, immutable',
        },
        customMetadata: commonMetadata,
      });
    } catch (error) {
      await Promise.allSettled([
        c.env.REELS_R2.delete(videoKey),
        c.env.REELS_R2.delete(coverKey),
      ]);
      console.error('Reel finishing failed', error);
      return c.json({
        error: 'This video could not be finished. Try an MP4 recorded on your phone.',
      }, 422);
    }

    const publicBase = c.env.R2_REELS_PUBLIC_BASE;
    return c.json({
      key: videoKey,
      url: publicAssetUrl(publicBase, videoKey),
      coverKey,
      coverUrl: publicAssetUrl(publicBase, coverKey),
      contentType: 'video/mp4',
      startSeconds,
      endSeconds,
      coverSeconds,
    }, 201);
  });
}
