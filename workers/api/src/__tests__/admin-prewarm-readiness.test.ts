import { describe, expect, it } from 'vitest';
import { summarizePrewarmReadiness } from '../routes/admin-stats';

describe('summarizePrewarmReadiness', () => {
  it('counts due-soon scheduled posts with missing media or non-ready video state', () => {
    const result = summarizePrewarmReadiness([
      {
        id: 'image-missing',
        user_id: 'user_1',
        client_id: null,
        content: 'Image post needs media',
        platform: 'Facebook',
        scheduled_for: '2026-05-23T10:30:00.000Z',
        post_type: 'image',
        image_url: null,
        video_url: null,
        video_status: null,
        video_error: null,
      },
      {
        id: 'video-pending',
        user_id: 'user_1',
        client_id: 'client_1',
        content: 'Reel is still waiting',
        platform: 'Instagram',
        scheduled_for: '2026-05-23T11:00:00.000Z',
        post_type: 'video',
        image_url: 'https://cdn.example/thumb.jpg',
        video_url: null,
        video_status: 'pending',
        video_error: null,
      },
      {
        id: 'video-failed',
        user_id: 'user_2',
        client_id: null,
        content: 'Reel failed generation',
        platform: 'Facebook',
        scheduled_for: '2026-05-23T12:00:00.000Z',
        post_type: 'reel',
        image_url: 'https://cdn.example/thumb-2.jpg',
        video_url: null,
        video_status: 'failed',
        video_error: 'fal queue timeout',
      },
    ]);

    expect(result.total).toBe(3);
    expect(result.counts).toEqual({
      missing_images: 1,
      video_pending: 1,
      video_failed: 1,
      video_missing: 2,
    });
    expect(result.posts.map((post) => post.issue)).toEqual([
      'missing_image',
      'video_pending',
      'video_failed',
    ]);
    expect(result.posts[0].workspace).toBe('Own Workspace');
    expect(result.posts[1].workspace).toBe('client_1');
    expect(result.posts[2].video_error).toBe('fal queue timeout');
  });
});
