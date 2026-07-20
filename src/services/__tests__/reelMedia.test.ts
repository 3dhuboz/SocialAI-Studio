import { describe, expect, it } from 'vitest';
import {
  MAX_REEL_UPLOAD_BYTES,
  buildReelFinishPayload,
  buildReelUploadHeaders,
  getReelFinishIssue,
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

describe('reel media finishing contract', () => {
  it('accepts a cover frame inside a one-to-sixty second clip', () => {
    expect(getReelFinishIssue({
      sourceDurationSeconds: 74.2,
      startSeconds: 8.4,
      endSeconds: 42.6,
      coverSeconds: 12.5,
    })).toBeNull();
  });

  it('rejects clips outside Cloudflare finishing limits', () => {
    expect(getReelFinishIssue({
      sourceDurationSeconds: 74,
      startSeconds: 4,
      endSeconds: 4.5,
      coverSeconds: 4.2,
    })).toContain('at least 1 second');

    expect(getReelFinishIssue({
      sourceDurationSeconds: 74,
      startSeconds: 2,
      endSeconds: 63,
      coverSeconds: 10,
    })).toContain('60 seconds');

    expect(getReelFinishIssue({
      sourceDurationSeconds: 20,
      startSeconds: 2,
      endSeconds: 12,
      coverSeconds: 14,
    })).toContain('inside the clip');
  });

  it('rounds timing values before they cross the API boundary', () => {
    expect(buildReelFinishPayload({
      key: 'reels/uploads/source.mp4',
      clientId: 'client_richo',
      startSeconds: 1.23456,
      endSeconds: 14.9999,
      coverSeconds: 4.4444,
    })).toEqual({
      key: 'reels/uploads/source.mp4',
      clientId: 'client_richo',
      startSeconds: 1.235,
      endSeconds: 15,
      coverSeconds: 4.444,
    });
  });
});
