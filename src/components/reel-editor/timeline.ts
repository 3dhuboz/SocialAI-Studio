export const MAX_REEL_DURATION_SECONDS = 60;
export const MIN_REEL_DURATION_SECONDS = 1;
export const MIN_CLIP_DURATION_SECONDS = 0.35;

export type ReelAspectRatio = '9:16' | '4:5' | '1:1';
export type ReelFitMode = 'cover' | 'contain';
export type ReelTextPosition = 'top' | 'centre' | 'bottom';
export type ReelTextSize = 'small' | 'medium' | 'large';
export type ReelTransition = 'cut' | 'fade';
export type ReelRotation = 0 | 90 | 180 | 270;

export interface ReelClip {
  id: string;
  sourceId: string;
  file: File;
  url: string;
  name: string;
  sourceDurationSeconds: number;
  width: number;
  height: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
  speed: number;
  transition: ReelTransition;
  transitionDurationSeconds: number;
  volume: number;
  muted: boolean;
  fit: ReelFitMode;
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotation: ReelRotation;
  brightness: number;
  contrast: number;
  saturation: number;
  overlayText: string;
  overlayPosition: ReelTextPosition;
  overlaySize: ReelTextSize;
  overlayColor: string;
  overlayBackground: boolean;
}

export interface ReelMusicTrack {
  id: string;
  file: File;
  url: string;
  name: string;
  volume: number;
  loop: boolean;
}

export interface ReelProject {
  clips: ReelClip[];
  selectedClipId: string | null;
  aspectRatio: ReelAspectRatio;
  background: 'black' | 'blur';
  music: ReelMusicTrack | null;
}

export interface EditHistory<T> {
  past: T[];
  present: T;
  future: T[];
}

export interface ProjectTimeLocation {
  clip: ReelClip;
  clipIndex: number;
  sourceSeconds: number;
  projectStartSeconds: number;
}

const clamp = (value: number, minimum: number, maximum: number) => (
  Math.min(maximum, Math.max(minimum, value))
);

const roundSecond = (value: number) => Math.round(value * 1000) / 1000;

export function createEmptyReelProject(): ReelProject {
  return {
    clips: [],
    selectedClipId: null,
    aspectRatio: '9:16',
    background: 'blur',
    music: null,
  };
}

export function createReelClip(input: {
  id: string;
  sourceId?: string;
  file: File;
  url: string;
  name?: string;
  sourceDurationSeconds: number;
  width: number;
  height: number;
}): ReelClip {
  return {
    id: input.id,
    sourceId: input.sourceId || input.id,
    file: input.file,
    url: input.url,
    name: input.name || input.file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
    sourceDurationSeconds: input.sourceDurationSeconds,
    width: input.width,
    height: input.height,
    trimStartSeconds: 0,
    trimEndSeconds: input.sourceDurationSeconds,
    speed: 1,
    transition: 'cut',
    transitionDurationSeconds: 0.6,
    volume: 1,
    muted: false,
    fit: 'cover',
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    brightness: 1,
    contrast: 1,
    saturation: 1,
    overlayText: '',
    overlayPosition: 'bottom',
    overlaySize: 'medium',
    overlayColor: '#ffffff',
    overlayBackground: true,
  };
}

export function reelClipDuration(clip: ReelClip): number {
  const sourceDuration = Math.max(0, clip.trimEndSeconds - clip.trimStartSeconds);
  return roundSecond(sourceDuration / clamp(clip.speed, 0.25, 4));
}

export function reelClipTransitionOpacity(clip: ReelClip, outputSeconds: number): number {
  if (clip.transition !== 'fade') return 1;
  const clipDuration = reelClipDuration(clip);
  const transitionDuration = Math.min(
    clamp(clip.transitionDurationSeconds, 0.2, 1.5),
    clipDuration / 2,
  );
  if (transitionDuration <= 0) return 1;
  const position = clamp(outputSeconds, 0, clipDuration);
  return clamp(Math.min(
    position / transitionDuration,
    (clipDuration - position) / transitionDuration,
  ), 0, 1);
}

export function reelProjectDuration(project: Pick<ReelProject, 'clips'>): number {
  return roundSecond(project.clips.reduce((total, clip) => total + reelClipDuration(clip), 0));
}

export function getReelProjectIssue(project: ReelProject): string | null {
  if (project.clips.length === 0) return 'Add at least one clip.';
  if (project.clips.length > 12) return 'Keep each Reel to 12 clips or fewer.';
  if (project.clips.some((clip) => (
    !Number.isFinite(clip.trimStartSeconds)
    || !Number.isFinite(clip.trimEndSeconds)
    || clip.trimStartSeconds < 0
    || clip.trimEndSeconds > clip.sourceDurationSeconds + 0.05
    || clip.trimEndSeconds - clip.trimStartSeconds < MIN_CLIP_DURATION_SECONDS
  ))) return 'Each clip needs a valid trimmed section.';
  const duration = reelProjectDuration(project);
  if (duration < MIN_REEL_DURATION_SECONDS) return 'The finished Reel must be at least 1 second.';
  if (duration > MAX_REEL_DURATION_SECONDS) return 'Keep the finished Reel to 60 seconds or less.';
  return null;
}

export function updateReelClip(
  project: ReelProject,
  clipId: string,
  patch: Partial<Omit<ReelClip, 'id' | 'sourceId' | 'file' | 'url'>>,
): ReelProject {
  return {
    ...project,
    clips: project.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      const next = { ...clip, ...patch };
      const trimStartSeconds = clamp(next.trimStartSeconds, 0, Math.max(0, clip.sourceDurationSeconds - MIN_CLIP_DURATION_SECONDS));
      const trimEndSeconds = clamp(
        next.trimEndSeconds,
        trimStartSeconds + MIN_CLIP_DURATION_SECONDS,
        clip.sourceDurationSeconds,
      );
      return {
        ...next,
        trimStartSeconds: roundSecond(trimStartSeconds),
        trimEndSeconds: roundSecond(trimEndSeconds),
        speed: clamp(next.speed, 0.5, 2),
        transitionDurationSeconds: clamp(next.transitionDurationSeconds, 0.2, 1.5),
        volume: clamp(next.volume, 0, 1),
        zoom: clamp(next.zoom, 1, 2.5),
        offsetX: clamp(next.offsetX, -1, 1),
        offsetY: clamp(next.offsetY, -1, 1),
        brightness: clamp(next.brightness, 0.5, 1.5),
        contrast: clamp(next.contrast, 0.5, 1.5),
        saturation: clamp(next.saturation, 0, 2),
      };
    }),
  };
}

export function moveReelClip(project: ReelProject, clipId: string, direction: -1 | 1): ReelProject {
  const currentIndex = project.clips.findIndex((clip) => clip.id === clipId);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= project.clips.length) return project;
  const clips = [...project.clips];
  [clips[currentIndex], clips[nextIndex]] = [clips[nextIndex], clips[currentIndex]];
  return { ...project, clips };
}

export function removeReelClip(project: ReelProject, clipId: string): ReelProject {
  const index = project.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return project;
  const clips = project.clips.filter((clip) => clip.id !== clipId);
  const replacement = clips[Math.min(index, clips.length - 1)] || null;
  return {
    ...project,
    clips,
    selectedClipId: project.selectedClipId === clipId ? replacement?.id || null : project.selectedClipId,
  };
}

export function duplicateReelClip(project: ReelProject, clipId: string, nextId: string): ReelProject {
  const index = project.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return project;
  const clips = [...project.clips];
  clips.splice(index + 1, 0, { ...clips[index], id: nextId, name: `${clips[index].name} copy` });
  return { ...project, clips, selectedClipId: nextId };
}

export function splitReelClip(
  project: ReelProject,
  clipId: string,
  sourceSeconds: number,
  leftId: string,
  rightId: string,
): ReelProject {
  const index = project.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return project;
  const clip = project.clips[index];
  const splitAt = roundSecond(sourceSeconds);
  if (
    splitAt - clip.trimStartSeconds < MIN_CLIP_DURATION_SECONDS
    || clip.trimEndSeconds - splitAt < MIN_CLIP_DURATION_SECONDS
  ) return project;
  const clips = [...project.clips];
  clips.splice(index, 1,
    { ...clip, id: leftId, name: `${clip.name} A`, trimEndSeconds: splitAt },
    { ...clip, id: rightId, name: `${clip.name} B`, trimStartSeconds: splitAt },
  );
  return { ...project, clips, selectedClipId: rightId };
}

export function locateReelProjectTime(project: ReelProject, seconds: number): ProjectTimeLocation | null {
  if (project.clips.length === 0) return null;
  const totalDuration = reelProjectDuration(project);
  const target = clamp(seconds, 0, totalDuration);
  let cursor = 0;
  for (let index = 0; index < project.clips.length; index += 1) {
    const clip = project.clips[index];
    const duration = reelClipDuration(clip);
    const isLast = index === project.clips.length - 1;
    if (target <= cursor + duration || isLast) {
      const localOutputSeconds = clamp(target - cursor, 0, duration);
      return {
        clip,
        clipIndex: index,
        sourceSeconds: roundSecond(clip.trimStartSeconds + localOutputSeconds * clip.speed),
        projectStartSeconds: roundSecond(cursor),
      };
    }
    cursor += duration;
  }
  return null;
}

export function moveReelTrimWindow(input: {
  value: number;
  sourceDurationSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
  coverSeconds: number;
}) {
  const previousDuration = clamp(input.trimEndSeconds - input.trimStartSeconds, 1, 60);
  const startSeconds = clamp(input.value, 0, Math.max(0, input.sourceDurationSeconds - 1));
  const endSeconds = Math.min(input.sourceDurationSeconds, startSeconds + previousDuration);
  const coverOffset = input.coverSeconds - input.trimStartSeconds;
  return {
    startSeconds,
    endSeconds,
    coverSeconds: clamp(startSeconds + coverOffset, startSeconds, endSeconds),
  };
}

export function createEditHistory<T>(initialValue: T): EditHistory<T> {
  return { past: [], present: initialValue, future: [] };
}

export function commitEdit<T>(history: EditHistory<T>, nextValue: T, limit = 40): EditHistory<T> {
  if (Object.is(history.present, nextValue)) return history;
  return {
    past: [...history.past, history.present].slice(-limit),
    present: nextValue,
    future: [],
  };
}

export function undoEdit<T>(history: EditHistory<T>): EditHistory<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoEdit<T>(history: EditHistory<T>): EditHistory<T> {
  if (history.future.length === 0) return history;
  const [next, ...future] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future,
  };
}

export function reelOutputDimensions(aspectRatio: ReelAspectRatio): { width: number; height: number } {
  if (aspectRatio === '4:5') return { width: 720, height: 900 };
  if (aspectRatio === '1:1') return { width: 720, height: 720 };
  return { width: 720, height: 1280 };
}
