/**
 * In-browser video + audio mixing using Web Audio API + MediaRecorder.
 * Zero external dependencies. Tracks sourced from Mixkit (free commercial use, no attribution).
 * Output: WebM/VP9 blob URL (downloadable; upload-ready via Late for most platforms).
 */

export type VideoMood =
  | 'upbeat' | 'energetic' | 'fun' | 'playful'
  | 'calm' | 'relaxed' | 'peaceful' | 'soft'
  | 'inspiring' | 'motivational' | 'uplifting'
  | 'professional' | 'corporate' | 'serious'
  | string; // catch-all for AI-generated mood strings

/**
 * Map AI mood text → a royalty-free Mixkit track URL.
 * All tracks: free commercial licence, no attribution required.
 * https://mixkit.co/free-music/
 */
const MOOD_TRACKS: Record<string, string> = {
  upbeat:       'https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3',
  energetic:    'https://assets.mixkit.co/music/preview/mixkit-hip-hop-02-738.mp3',
  fun:          'https://assets.mixkit.co/music/preview/mixkit-fun-fashion-show-668.mp3',
  playful:      'https://assets.mixkit.co/music/preview/mixkit-games-worldbeat-667.mp3',
  calm:         'https://assets.mixkit.co/music/preview/mixkit-valley-sunset-127.mp3',
  relaxed:      'https://assets.mixkit.co/music/preview/mixkit-peaceful-garden-melody-1230.mp3',
  peaceful:     'https://assets.mixkit.co/music/preview/mixkit-serene-view-443.mp3',
  soft:         'https://assets.mixkit.co/music/preview/mixkit-piano-reflections-22.mp3',
  inspiring:    'https://assets.mixkit.co/music/preview/mixkit-life-is-a-dream-837.mp3',
  motivational: 'https://assets.mixkit.co/music/preview/mixkit-spirit-of-the-game-127.mp3',
  uplifting:    'https://assets.mixkit.co/music/preview/mixkit-feeling-happy-5.mp3',
  professional: 'https://assets.mixkit.co/music/preview/mixkit-corporate-innovation-565.mp3',
  corporate:    'https://assets.mixkit.co/music/preview/mixkit-corporate-innovation-565.mp3',
  serious:      'https://assets.mixkit.co/music/preview/mixkit-cinematic-mystery-158.mp3',
};

const DEFAULT_TRACK = MOOD_TRACKS.upbeat;

/** Pick a track URL from a free-form mood string (e.g. "Upbeat pop, 120BPM") */
export function trackUrlForMood(mood: string): string {
  const lower = mood.toLowerCase();
  for (const [key, url] of Object.entries(MOOD_TRACKS)) {
    if (lower.includes(key)) return url;
  }
  if (lower.includes('pop') || lower.includes('dance') || lower.includes('fast')) return MOOD_TRACKS.energetic;
  if (lower.includes('chill') || lower.includes('ambient') || lower.includes('lofi')) return MOOD_TRACKS.calm;
  if (lower.includes('inspir') || lower.includes('uplift') || lower.includes('motivat')) return MOOD_TRACKS.inspiring;
  return DEFAULT_TRACK;
}

export interface AudioMixOptions {
  musicVolume?: number; // 0-1, default 0.45
  onProgress?: (pct: number) => void;
}

/**
 * Mix a background music track into a video file, returning a new blob URL.
 * Uses Web Audio API + Canvas + MediaRecorder — runs entirely in the browser.
 */
export async function addAudioToVideo(
  videoUrl: string,
  mood: string,
  opts: AudioMixOptions = {}
): Promise<string> {
  const { musicVolume = 0.45, onProgress } = opts;
  const audioUrl = trackUrlForMood(mood);

  onProgress?.(0.05);

  const videoEl = document.createElement('video');
  videoEl.crossOrigin = 'anonymous';
  videoEl.src = videoUrl;
  videoEl.muted = true;
  videoEl.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    videoEl.onloadedmetadata = () => resolve();
    videoEl.onerror = () => reject(new Error('Failed to load video'));
    videoEl.load();
  });

  const w = videoEl.videoWidth || 1080;
  const h = videoEl.videoHeight || 1920;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx2d = canvas.getContext('2d')!;

  onProgress?.(0.15);

  const audioCtx = new AudioContext();
  const audioRes = await fetch(audioUrl, { mode: 'cors' });
  if (!audioRes.ok) throw new Error(`Music fetch failed: ${audioRes.status}`);
  const audioBuffer = await audioCtx.decodeAudioData(await audioRes.arrayBuffer());

  onProgress?.(0.30);

  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.loop = true;

  const gainNode = audioCtx.createGain();
  gainNode.gain.value = musicVolume;

  const dest = audioCtx.createMediaStreamDestination();
  source.connect(gainNode);
  gainNode.connect(dest);

  const canvasStream = canvas.captureStream(30);
  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm';

  const recorder = new MediaRecorder(combined, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  const duration = videoEl.duration;

  return new Promise<string>((resolve, reject) => {
    recorder.onstop = () => {
      audioCtx.close();
      const blob = new Blob(chunks, { type: 'video/webm' });
      resolve(URL.createObjectURL(blob));
    };

    videoEl.onended = () => {
      source.stop();
      recorder.stop();
    };

    videoEl.onerror = () => { recorder.stop(); reject(new Error('Video playback error')); };

    source.start();
    recorder.start(100);

    videoEl.play().catch(reject);

    const draw = () => {
      if (videoEl.paused || videoEl.ended) return;
      ctx2d.drawImage(videoEl, 0, 0, w, h);
      const pct = 0.30 + (videoEl.currentTime / (duration || 5)) * 0.65;
      onProgress?.(Math.min(0.95, pct));
      requestAnimationFrame(draw);
    };
    draw();
  });
}
