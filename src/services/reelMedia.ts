const API_BASE = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';

export const MAX_REEL_UPLOAD_BYTES = 95 * 1024 * 1024;

const ALLOWED_REEL_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

type AuthMode = 'clerk' | 'portal' | 'embed';

export interface UploadedReelMedia {
  key: string;
  url: string;
  contentType: string;
  sizeBytes: number;
}

export interface ReelUploadHeaderInput {
  file: Pick<File, 'name' | 'size' | 'type'>;
  token: string | null;
  authMode: AuthMode;
  clientId?: string | null;
  durationMs?: number | null;
}

export function getReelUploadIssue(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (!ALLOWED_REEL_TYPES.has(file.type)) {
    return 'Choose an MP4, MOV or WebM video.';
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return 'That video file is empty or unreadable.';
  }
  if (file.size > MAX_REEL_UPLOAD_BYTES) {
    return 'Keep Reel uploads under 95 MB.';
  }
  return null;
}

function authorizationValue(token: string, authMode: AuthMode): string {
  if (authMode === 'portal') return `Portal ${token}`;
  if (authMode === 'embed') return `Embed ${token}`;
  return `Bearer ${token}`;
}

export function buildReelUploadHeaders(input: ReelUploadHeaderInput): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': input.file.type,
    'X-Reel-Filename': encodeURIComponent(input.file.name.slice(0, 160)),
    'X-Reel-Size': String(input.file.size),
  };
  if (input.token) headers.Authorization = authorizationValue(input.token, input.authMode);
  if (input.clientId) headers['X-Client-Id'] = input.clientId;
  if (Number.isFinite(input.durationMs) && Number(input.durationMs) >= 0) {
    headers['X-Reel-Duration-Ms'] = String(Math.round(Number(input.durationMs)));
  }
  return headers;
}

export async function uploadReelMedia(input: {
  file: File;
  getToken: () => Promise<string | null>;
  authMode: AuthMode;
  clientId?: string | null;
  durationMs?: number | null;
  onProgress?: (progress: number) => void;
}): Promise<UploadedReelMedia> {
  const issue = getReelUploadIssue(input.file);
  if (issue) throw new Error(issue);

  const token = await input.getToken();
  if (!token) throw new Error('Your sign-in expired. Sign in again before uploading.');

  const headers = buildReelUploadHeaders({
    file: input.file,
    token,
    authMode: input.authMode,
    clientId: input.clientId,
    durationMs: input.durationMs,
  });

  return new Promise<UploadedReelMedia>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_BASE}/api/reel-media/uploads`);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      input.onProgress?.(Math.min(1, Math.max(0, event.loaded / event.total)));
    };
    request.onerror = () => reject(new Error('The Reel upload was interrupted. Try again.'));
    request.onabort = () => reject(new Error('The Reel upload was cancelled.'));
    request.onload = () => {
      let body: Record<string, unknown> = {};
      try { body = request.responseText ? JSON.parse(request.responseText) : {}; } catch {}
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(typeof body.error === 'string' ? body.error : `Reel upload failed (${request.status}).`));
        return;
      }
      if (typeof body.url !== 'string' || typeof body.key !== 'string') {
        reject(new Error('The Reel upload finished without a usable media URL.'));
        return;
      }
      input.onProgress?.(1);
      resolve({
        key: body.key,
        url: body.url,
        contentType: typeof body.contentType === 'string' ? body.contentType : input.file.type,
        sizeBytes: typeof body.sizeBytes === 'number' ? body.sizeBytes : input.file.size,
      });
    };
    request.send(input.file);
  });
}
