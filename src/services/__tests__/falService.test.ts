import { describe, it, expect } from 'vitest';
import { extractCompletedFalVideoUrl } from '../falService';

describe('extractCompletedFalVideoUrl', () => {
  it('accepts the task-result shapes returned by the worker proxy', () => {
    expect(extractCompletedFalVideoUrl({ video: { url: 'https://cdn/video.mp4' } })).toBe('https://cdn/video.mp4');
    expect(extractCompletedFalVideoUrl({ output: { video: { url: 'https://cdn/output-video.mp4' } } })).toBe('https://cdn/output-video.mp4');
    expect(extractCompletedFalVideoUrl({ output: ['https://cdn/array-video.mp4'] })).toBe('https://cdn/array-video.mp4');
  });

  it('returns null when the completed task has no usable URL', () => {
    expect(extractCompletedFalVideoUrl({ output: [] })).toBeNull();
    expect(extractCompletedFalVideoUrl({})).toBeNull();
  });
});
