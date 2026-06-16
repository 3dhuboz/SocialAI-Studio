import { describe, expect, it } from 'vitest';

import { postproxyMediaArray, postproxyMissingMediaReason } from '../lib/postproxy-media';

describe('Postproxy media requirements', () => {
  it('allows Facebook feed posts to publish text-only when generated media is unavailable', () => {
    expect(postproxyMissingMediaReason({
      platform: 'facebook',
      postType: null,
      mediaUrl: null,
    })).toBeNull();
    expect(postproxyMediaArray(null)).toEqual([]);
  });

  it('requires media for Facebook reels', () => {
    expect(postproxyMissingMediaReason({
      platform: 'facebook',
      postType: 'video',
      mediaUrl: null,
    })).toMatch(/Reel post has no video URL/);
  });

  it('requires media for Instagram posts', () => {
    expect(postproxyMissingMediaReason({
      platform: 'instagram',
      postType: 'image',
      mediaUrl: null,
    })).toMatch(/Instagram posts require a public image\/video URL/);
  });
});
