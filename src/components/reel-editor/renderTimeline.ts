import {
  reelClipDuration,
  reelOutputDimensions,
  reelProjectDuration,
  type ReelClip,
  type ReelProject,
} from './timeline';

export type ReelRenderPhase = 'preparing' | 'rendering' | 'encoding';

export interface ReelRenderProgress {
  phase: ReelRenderPhase;
  progress: number;
  clipIndex: number;
  clipCount: number;
}

export interface RenderedReel {
  blob: Blob;
  contentType: string;
  extension: 'mp4' | 'webm';
  durationMs: number;
  width: number;
  height: number;
}

interface RenderOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ReelRenderProgress) => void;
}

const FRAME_RATE = 30;
const VIDEO_BITS_PER_SECOND = 6_000_000;

function abortError(): DOMException {
  return new DOMException('Reel rendering was cancelled.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function waitForMediaEvent(
  media: HTMLMediaElement,
  eventName: 'loadedmetadata' | 'loadeddata' | 'canplay' | 'seeked',
  signal?: AbortSignal,
  timeoutMs = 20_000,
): Promise<void> {
  if (eventName === 'loadedmetadata' && media.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  if ((eventName === 'loadeddata' || eventName === 'canplay') && media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timeout = 0;
    const onReady = () => finish();
    const onError = () => finish(new Error('A selected clip could not be decoded by this browser.'));
    const onAbort = () => finish(abortError());
    const finish = (error?: Error | DOMException) => {
      window.clearTimeout(timeout);
      media.removeEventListener(eventName, onReady);
      media.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    timeout = window.setTimeout(() => finish(new Error('A clip took too long to prepare.')), timeoutMs);
    media.addEventListener(eventName, onReady, { once: true });
    media.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function chooseRecorderMimeType(): string {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
}

function sourceScale(
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
  fit: ReelClip['fit'],
  rotation: ReelClip['rotation'],
): number {
  const sideways = rotation === 90 || rotation === 270;
  const orientedWidth = sideways ? sourceHeight : sourceWidth;
  const orientedHeight = sideways ? sourceWidth : sourceHeight;
  const scaleX = outputWidth / Math.max(1, orientedWidth);
  const scaleY = outputHeight / Math.max(1, orientedHeight);
  return fit === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
}

function drawVideoLayer(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  clip: ReelClip,
  outputWidth: number,
  outputHeight: number,
  fit: ReelClip['fit'],
  zoom: number,
): void {
  const scale = sourceScale(
    video.videoWidth,
    video.videoHeight,
    outputWidth,
    outputHeight,
    fit,
    clip.rotation,
  ) * zoom;
  const rotation = clip.rotation * Math.PI / 180;
  context.save();
  context.translate(
    outputWidth / 2 + clip.offsetX * outputWidth * 0.2,
    outputHeight / 2 + clip.offsetY * outputHeight * 0.2,
  );
  context.rotate(rotation);
  context.drawImage(
    video,
    -video.videoWidth * scale / 2,
    -video.videoHeight * scale / 2,
    video.videoWidth * scale,
    video.videoHeight * scale,
  );
  context.restore();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function wrapText(context: CanvasRenderingContext2D, text: string, maximumWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = words[0];
  for (let index = 1; index < words.length; index += 1) {
    const candidate = `${line} ${words[index]}`;
    if (context.measureText(candidate).width <= maximumWidth) line = candidate;
    else {
      lines.push(line);
      line = words[index];
    }
  }
  lines.push(line);
  return lines.slice(0, 4);
}

function drawOverlay(
  context: CanvasRenderingContext2D,
  clip: ReelClip,
  outputWidth: number,
  outputHeight: number,
): void {
  if (!clip.overlayText.trim()) return;
  const fontSize = Math.max(28, Math.round(outputWidth * 0.062));
  const lineHeight = Math.round(fontSize * 1.16);
  const horizontalPadding = Math.round(outputWidth * 0.055);
  const verticalPadding = Math.round(fontSize * 0.48);
  context.save();
  context.font = `800 ${fontSize}px Inter, system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const lines = wrapText(context, clip.overlayText, outputWidth - horizontalPadding * 4);
  if (lines.length === 0) {
    context.restore();
    return;
  }
  const textWidth = Math.max(...lines.map((line) => context.measureText(line).width));
  const boxWidth = Math.min(outputWidth - horizontalPadding * 2, textWidth + horizontalPadding * 2);
  const boxHeight = lines.length * lineHeight + verticalPadding * 2;
  const safeInset = Math.round(outputHeight * 0.09);
  const centreY = clip.overlayPosition === 'top'
    ? safeInset + boxHeight / 2
    : clip.overlayPosition === 'centre'
      ? outputHeight / 2
      : outputHeight - safeInset - boxHeight / 2;
  const boxX = (outputWidth - boxWidth) / 2;
  const boxY = centreY - boxHeight / 2;
  if (clip.overlayBackground) {
    context.fillStyle = 'rgba(0, 0, 0, 0.68)';
    roundedRect(context, boxX, boxY, boxWidth, boxHeight, Math.round(fontSize * 0.28));
    context.fill();
  }
  context.fillStyle = clip.overlayColor;
  context.shadowColor = 'rgba(0, 0, 0, 0.7)';
  context.shadowBlur = clip.overlayBackground ? 0 : 8;
  lines.forEach((line, index) => {
    const y = boxY + verticalPadding + lineHeight * index + lineHeight / 2;
    context.fillText(line, outputWidth / 2, y);
  });
  context.restore();
}

function drawFrame(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  clip: ReelClip,
  project: ReelProject,
  outputWidth: number,
  outputHeight: number,
): void {
  context.save();
  context.clearRect(0, 0, outputWidth, outputHeight);
  context.fillStyle = '#050506';
  context.fillRect(0, 0, outputWidth, outputHeight);
  if (project.background === 'blur' && clip.fit === 'contain') {
    context.filter = 'blur(28px) brightness(0.42) saturate(0.9)';
    drawVideoLayer(context, video, clip, outputWidth, outputHeight, 'cover', 1.12);
  }
  context.filter = `brightness(${clip.brightness}) contrast(${clip.contrast}) saturate(${clip.saturation})`;
  drawVideoLayer(context, video, clip, outputWidth, outputHeight, clip.fit, clip.zoom);
  context.restore();
  drawOverlay(context, clip, outputWidth, outputHeight);
}

async function prepareMusic(
  project: ReelProject,
  audioContext: AudioContext,
  destination: MediaStreamAudioDestinationNode,
  signal?: AbortSignal,
): Promise<HTMLAudioElement | null> {
  if (!project.music) return null;
  const music = new Audio(project.music.url);
  music.preload = 'auto';
  music.loop = project.music.loop;
  const source = audioContext.createMediaElementSource(music);
  const gain = audioContext.createGain();
  gain.gain.value = project.music.volume;
  source.connect(gain).connect(destination);
  await waitForMediaEvent(music, 'loadeddata', signal);
  return music;
}

async function renderClip(
  clip: ReelClip,
  project: ReelProject,
  context: CanvasRenderingContext2D,
  outputWidth: number,
  outputHeight: number,
  audioContext: AudioContext,
  destination: MediaStreamAudioDestinationNode,
  renderedBeforeSeconds: number,
  totalDurationSeconds: number,
  clipIndex: number,
  options: RenderOptions,
): Promise<void> {
  throwIfAborted(options.signal);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  video.src = clip.url;
  video.playbackRate = clip.speed;
  video.volume = 1;
  const source = audioContext.createMediaElementSource(video);
  const gain = audioContext.createGain();
  gain.gain.value = clip.muted ? 0 : clip.volume;
  source.connect(gain).connect(destination);
  await waitForMediaEvent(video, 'loadedmetadata', options.signal);
  await waitForMediaEvent(video, 'loadeddata', options.signal);
  if (Math.abs(video.currentTime - clip.trimStartSeconds) > 0.025) {
    video.currentTime = clip.trimStartSeconds;
    await waitForMediaEvent(video, 'seeked', options.signal);
  }
  drawFrame(context, video, clip, project, outputWidth, outputHeight);
  await video.play().catch(() => {
    throw new Error('This browser blocked clip playback while rendering. Try again from the Finish button.');
  });

  await new Promise<void>((resolve, reject) => {
    let animationFrame = 0;
    const onAbort = () => finish(abortError());
    const finish = (error?: Error | DOMException) => {
      window.cancelAnimationFrame(animationFrame);
      options.signal?.removeEventListener('abort', onAbort);
      video.pause();
      source.disconnect();
      gain.disconnect();
      video.removeAttribute('src');
      video.load();
      if (error) reject(error);
      else resolve();
    };
    const tick = () => {
      if (options.signal?.aborted) {
        finish(abortError());
        return;
      }
      drawFrame(context, video, clip, project, outputWidth, outputHeight);
      const localOutputSeconds = Math.max(0, video.currentTime - clip.trimStartSeconds) / clip.speed;
      options.onProgress?.({
        phase: 'rendering',
        progress: Math.min(0.995, (renderedBeforeSeconds + localOutputSeconds) / totalDurationSeconds),
        clipIndex,
        clipCount: project.clips.length,
      });
      if (video.ended || video.currentTime >= clip.trimEndSeconds - 0.025) {
        finish();
        return;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    animationFrame = window.requestAnimationFrame(tick);
  });
}

export async function renderReelProject(
  project: ReelProject,
  options: RenderOptions = {},
): Promise<RenderedReel> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot render edited Reels. Open SocialAI Studio in current Chrome, Edge, or Safari.');
  }
  const canvas = document.createElement('canvas');
  if (typeof canvas.captureStream !== 'function') {
    throw new Error('This browser cannot render a video canvas. Open SocialAI Studio in current Chrome, Edge, or Safari.');
  }
  throwIfAborted(options.signal);
  const { width, height } = reelOutputDimensions(project.aspectRatio);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('The Reel canvas could not be created.');
  const totalDurationSeconds = reelProjectDuration(project);
  if (totalDurationSeconds <= 0) throw new Error('Add a usable clip before rendering.');
  options.onProgress?.({ phase: 'preparing', progress: 0, clipIndex: 0, clipCount: project.clips.length });

  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) throw new Error('This browser cannot mix Reel audio.');
  const audioContext = new AudioContextClass();
  await audioContext.resume();
  const audioDestination = audioContext.createMediaStreamDestination();
  const canvasStream = canvas.captureStream(FRAME_RATE);
  const outputStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);
  const mimeType = chooseRecorderMimeType();
  const recorder = new MediaRecorder(outputStream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: 160_000,
  });
  const chunks: BlobPart[] = [];
  let recorderError: Error | null = null;
  recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
  recorder.onerror = (event) => {
    recorderError = new Error((event as Event & { error?: Error }).error?.message || 'The browser video encoder stopped.');
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.addEventListener('stop', () => resolve(), { once: true });
  });

  let music: HTMLAudioElement | null = null;
  let recorderStarted = false;
  try {
    music = await prepareMusic(project, audioContext, audioDestination, options.signal);
    recorder.start(1000);
    recorderStarted = true;
    if (music) {
      await music.play().catch(() => {
        throw new Error('The selected music track could not be played by this browser.');
      });
    }
    let renderedBeforeSeconds = 0;
    for (let index = 0; index < project.clips.length; index += 1) {
      await renderClip(
        project.clips[index],
        project,
        context,
        width,
        height,
        audioContext,
        audioDestination,
        renderedBeforeSeconds,
        totalDurationSeconds,
        index,
        options,
      );
      renderedBeforeSeconds += reelClipDuration(project.clips[index]);
    }
    options.onProgress?.({
      phase: 'encoding',
      progress: 1,
      clipIndex: project.clips.length - 1,
      clipCount: project.clips.length,
    });
  } finally {
    music?.pause();
    if (recorderStarted) {
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
    }
    outputStream.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => undefined);
  }
  throwIfAborted(options.signal);
  if (recorderError) throw recorderError;
  const resolvedMimeType = recorder.mimeType || mimeType || 'video/webm';
  const blob = new Blob(chunks, { type: resolvedMimeType });
  if (blob.size === 0) throw new Error('The browser finished without producing a video file.');
  return {
    blob,
    contentType: resolvedMimeType.split(';')[0],
    extension: resolvedMimeType.startsWith('video/mp4') ? 'mp4' : 'webm',
    durationMs: Math.round(totalDurationSeconds * 1000),
    width,
    height,
  };
}
