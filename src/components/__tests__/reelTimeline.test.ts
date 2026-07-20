import { describe, expect, it } from 'vitest';
import {
  commitEdit,
  createEditHistory,
  createEmptyReelProject,
  createReelClip,
  duplicateReelClip,
  getReelProjectIssue,
  locateReelProjectTime,
  moveReelClip,
  redoEdit,
  reelProjectDuration,
  removeReelClip,
  splitReelClip,
  undoEdit,
  updateReelClip,
} from '../reel-editor/timeline';

const file = { name: 'counter.mp4', size: 1000, type: 'video/mp4' } as File;

const clip = (id: string, duration = 12) => createReelClip({
  id,
  file,
  url: `blob:${id}`,
  sourceDurationSeconds: duration,
  width: 1080,
  height: 1920,
});

describe('Reel editor timeline', () => {
  it('calculates edited duration using every clip speed', () => {
    const project = {
      ...createEmptyReelProject(),
      clips: [clip('one', 10), { ...clip('two', 12), speed: 2 }],
    };
    expect(reelProjectDuration(project)).toBe(16);
    expect(getReelProjectIssue(project)).toBeNull();
  });

  it('splits a clip without changing its total duration', () => {
    const project = { ...createEmptyReelProject(), clips: [clip('one')], selectedClipId: 'one' };
    const split = splitReelClip(project, 'one', 5, 'left', 'right');
    expect(split.clips.map((item) => [item.id, item.trimStartSeconds, item.trimEndSeconds])).toEqual([
      ['left', 0, 5],
      ['right', 5, 12],
    ]);
    expect(reelProjectDuration(split)).toBe(12);
    expect(split.selectedClipId).toBe('right');
  });

  it('supports duplicate, reorder, remove, undo, and redo', () => {
    const base = { ...createEmptyReelProject(), clips: [clip('one'), clip('two')], selectedClipId: 'one' };
    const duplicated = duplicateReelClip(base, 'one', 'copy');
    expect(duplicated.clips.map((item) => item.id)).toEqual(['one', 'copy', 'two']);
    const moved = moveReelClip(duplicated, 'copy', 1);
    expect(moved.clips.map((item) => item.id)).toEqual(['one', 'two', 'copy']);
    const removed = removeReelClip(moved, 'copy');
    expect(removed.clips.map((item) => item.id)).toEqual(['one', 'two']);

    const committed = commitEdit(createEditHistory(base), duplicated);
    expect(undoEdit(committed).present).toBe(base);
    expect(redoEdit(undoEdit(committed)).present).toBe(duplicated);
  });

  it('clamps visual and audio controls to production limits', () => {
    const base = { ...createEmptyReelProject(), clips: [clip('one')], selectedClipId: 'one' };
    const updated = updateReelClip(base, 'one', {
      speed: 9,
      volume: -1,
      zoom: 12,
      saturation: 4,
      trimStartSeconds: -4,
      trimEndSeconds: 99,
    });
    expect(updated.clips[0]).toMatchObject({
      speed: 2,
      volume: 0,
      zoom: 2.5,
      saturation: 2,
      trimStartSeconds: 0,
      trimEndSeconds: 12,
    });
  });

  it('maps a global playhead to the correct source frame', () => {
    const first = { ...clip('one', 10), speed: 2 };
    const second = { ...clip('two', 8), trimStartSeconds: 2, trimEndSeconds: 8 };
    const project = { ...createEmptyReelProject(), clips: [first, second] };
    expect(locateReelProjectTime(project, 6)).toMatchObject({
      clipIndex: 1,
      sourceSeconds: 3,
      projectStartSeconds: 5,
    });
  });

  it('rejects empty and overlong projects before rendering', () => {
    expect(getReelProjectIssue(createEmptyReelProject())).toContain('at least one clip');
    expect(getReelProjectIssue({
      ...createEmptyReelProject(),
      clips: [clip('long', 61)],
    })).toContain('60 seconds');
  });
});
