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

export interface FinishedReelMedia extends UploadedReelMedia {
  coverKey: string;
  coverUrl: string;
  startSeconds: number;
  endSeconds: number;
  coverSeconds: number;
}

export interface ReelFinishTiming {
  sourceDurationSeconds: number;
  startSeconds: number;
  endSeconds: number;
  coverSeconds: number;
}

export interface ReelFinishPayload extends Omit<ReelFinishTiming, 'sourceDurationSeconds'> {
  key: string;
  clientId?: string | null;
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

export function getReelFinishIssue(input: ReelFinishTiming): string | null {
  const values = [
    input.sourceDurationSeconds,
    input.startSeconds,
    input.endSeconds,
    input.coverSeconds,
  ];
  if (values.some((value) => !Number.isFinite(value))) return 'Choose valid trim and cover times.';
  if (input.startSeconds < 0 || input.endSeconds <= input.startSeconds) {
    return 'The trim end must come after the start.';
  }
  const clipDuration = input.endSeconds - input.startSeconds;
  if (clipDuration < 1) return 'The finished Reel must be at least 1 second.';
  if (clipDuration > 60) return 'Keep the finished Reel to 60 seconds or less.';
  if (input.endSeconds > input.sourceDurationSeconds + 0.05) {
    return 'The trim end is beyond the uploaded video.';
  }
  if (input.coverSeconds < input.startSeconds || input.coverSeconds > input.endSeconds) {
    return 'Choose a cover frame inside the clip.';
  }
  return null;
}

function roundSecond(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function buildReelFinishPayload(input: ReelFinishPayload): ReelFinishPayload {
  return {
    key: input.key,
    clientId: input.clientId,
    startSeconds: roundSecond(input.startSeconds),
    endSeconds: roundSecond(input.endSeconds),
    coverSeconds: roundSecond(input.coverSeconds),
  };
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

export async function finishReelMedia(input: ReelFinishPayload & {
  getToken: () => Promise<string | null>;
  authMode: AuthMode;
}): Promise<FinishedReelMedia> {
  const token = await input.getToken();
  if (!token) throw new Error('Your sign-in expired. Sign in again before finishing the Reel.');

  const response = await fetch(`${API_BASE}/api/reel-media/finish`, {
    method: 'POST',
    headers: {
      Authorization: authorizationValue(token, input.authMode),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildReelFinishPayload(input)),
  });
  let body: Record<string, unknown> = {};
  try { body = await response.json() as Record<string, unknown>; } catch {}
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `Reel finishing failed (${response.status}).`);
  }
  if (
    typeof body.key !== 'string'
    || typeof body.url !== 'string'
    || typeof body.coverKey !== 'string'
    || typeof body.coverUrl !== 'string'
  ) {
    throw new Error('The Reel finished without usable video and cover files.');
  }
  return {
    key: body.key,
    url: body.url,
    coverKey: body.coverKey,
    coverUrl: body.coverUrl,
    contentType: typeof body.contentType === 'string' ? body.contentType : 'video/mp4',
    sizeBytes: 0,
    startSeconds: typeof body.startSeconds === 'number' ? body.startSeconds : input.startSeconds,
    endSeconds: typeof body.endSeconds === 'number' ? body.endSeconds : input.endSeconds,
    coverSeconds: typeof body.coverSeconds === 'number' ? body.coverSeconds : input.coverSeconds,
  };
}
