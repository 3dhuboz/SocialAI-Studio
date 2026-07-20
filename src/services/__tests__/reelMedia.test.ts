import { describe, expect, it } from 'vitest';
import {
  MAX_REEL_UPLOAD_BYTES,
  buildReelUploadHeaders,
  getReelUploadIssue,
} from '../reelMedia';

const fileLike = (overrides: Partial<Pick<File, 'name' | 'size' | 'type'>> = {}) => ({
  name: overrides.name ?? 'friday-counter-picks.mp4',
  size: overrides.size ?? 8_000_000,
  type: overrides.type ?? 'video/mp4',
}) as File;

describe('reel media upload contract', () => {
  it('accepts the formats Pete is likely to upload from a phone', () => {
    expect(getReelUploadIssue(fileLike({ type: 'video/mp4' }))).toBeNull();
    expect(getReelUploadIssue(fileLike({ type: 'video/quicktime', name: 'phone-clip.mov' }))).toBeNull();
    expect(getReelUploadIssue(fileLike({ type: 'video/webm', name: 'browser-clip.webm' }))).toBeNull();
  });

  it('explains unsupported formats and oversized files before network upload', () => {
    expect(getReelUploadIssue(fileLike({ type: 'image/jpeg', name: 'still.jpg' })))
      .toContain('MP4, MOV or WebM');
    expect(getReelUploadIssue(fileLike({ size: MAX_REEL_UPLOAD_BYTES + 1 })))
      .toContain('95 MB');
  });

  it('builds authenticated, workspace-scoped headers without leaking a local path', () => {
    const headers = buildReelUploadHeaders({
      file: fileLike({ name: 'Pete counter reel.mp4' }),
      token: 'clerk-token',
      authMode: 'clerk',
      clientId: 'client_richo',
      durationMs: 12_450,
    });

    expect(headers.Authorization).toBe('Bearer clerk-token');
    expect(headers['X-Client-Id']).toBe('client_richo');
    expect(headers['X-Reel-Filename']).toBe('Pete%20counter%20reel.mp4');
    expect(headers['X-Reel-Size']).toBe('8000000');
    expect(headers['X-Reel-Duration-Ms']).toBe('12450');
  });
});
