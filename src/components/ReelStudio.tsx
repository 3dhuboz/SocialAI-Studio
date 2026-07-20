import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  Facebook,
  FileVideo2,
  Image as ImageIcon,
  Instagram,
  Loader2,
  RefreshCw,
  Save,
  Scissors,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { BusinessProfile, SocialTokens } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useDb } from '../hooks/useDb';
import { useToast } from './Toast';
import {
  fetchClientFacts,
  generateSocialPost,
  type ClientFact,
} from '../services/gemini';
import { createPostproxyService } from '../services/postproxyService';
import {
  finishReelMedia,
  getReelFinishIssue,
  getReelUploadIssue,
  uploadReelMedia,
  type FinishedReelMedia,
  type UploadedReelMedia,
} from '../services/reelMedia';
import './ReelStudio.css';

type Platform = 'Facebook' | 'Instagram';
type ReleaseMode = 'now' | 'schedule';

interface ReelStudioProps {
  clientId: string | null;
  profile: BusinessProfile;
  socialTokens: SocialTokens;
  workspaceName: string;
  onPostsChanged: () => Promise<void> | void;
  onOpenSettings: () => void;
  loadFacts?: (clientId?: string | null) => Promise<ClientFact[]>;
  uploadMedia?: typeof uploadReelMedia;
  finishMedia?: typeof finishReelMedia;
}

interface VideoMetadata {
  durationMs: number;
  width: number;
  height: number;
}

interface CaptionOption {
  hook: string;
  body: string;
  hashtags: string[];
}

function parseFactMetadata(fact: ClientFact): Record<string, any> {
  if (fact.metadata && typeof fact.metadata === 'object') return fact.metadata;
  if (typeof fact.metadata !== 'string') return {};
  try { return JSON.parse(fact.metadata); } catch { return {}; }
}

export function publicFactContent(fact: ClientFact): string {
  return fact.content
    .split(/\r?\n/)
    .filter((line) => !/^\s*(Fulfilment|Window|Suburb|Packed total|Items):/i.test(line))
    .join('\n')
    .trim();
}

function factTitle(fact: ClientFact): string {
  const metadata = parseFactMetadata(fact);
  const title = metadata?.brief?.title;
  if (typeof title === 'string' && title.trim()) return title.trim();
  return publicFactContent(fact).split(/\r?\n/)[0]?.replace(/\s*\([^)]*\)\s*$/, '').trim() || 'Verified business context';
}

function factSummary(fact: ClientFact): string {
  const lines = publicFactContent(fact).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(1).join(' ').slice(0, 150) || lines[0]?.slice(0, 150) || '';
}

export function isCustomerSafeFact(fact: ClientFact): boolean {
  const metadata = parseFactMetadata(fact);
  if (metadata.source === 'richo-road-butchery') {
    return metadata.eventType === 'weekly_special' && !metadata.order;
  }
  return !metadata.order && ['about', 'own_post', 'photo', 'event'].includes(fact.fact_type);
}

function splitGeneratedCaption(content: string): Pick<CaptionOption, 'hook' | 'body'> {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return { hook: lines[0] || '', body: '' };
  return { hook: lines[0], body: lines.slice(1).join('\n\n') };
}

function parseHashtags(value: string): string[] {
  return [...new Set(
    value
      .split(/[\s,]+/)
      .map((tag) => tag.trim().replace(/^#+/, ''))
      .filter(Boolean),
  )].slice(0, 10);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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

function defaultScheduleValue(): string {
  const value = new Date(Date.now() + 24 * 60 * 60 * 1000);
  value.setHours(9, 0, 0, 0);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function readVideoMetadata(url: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const timeout = window.setTimeout(() => reject(new Error('The video metadata could not be read.')), 12_000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      resolve({
        durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('That video cannot be previewed in this browser.'));
    };
    video.src = url;
  });
}

export const ReelStudio: React.FC<ReelStudioProps> = ({
  clientId,
  profile,
  socialTokens,
  workspaceName,
  onPostsChanged,
  onOpenSettings,
  loadFacts = fetchClientFacts,
  uploadMedia = uploadReelMedia,
  finishMedia = finishReelMedia,
}) => {
  const { getApiToken, authMode } = useAuth();
  const db = useDb();
  const { toast } = useToast();
  const postproxy = useMemo(
    () => createPostproxyService(getApiToken, authMode),
    [getApiToken, authMode],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadSequenceRef = useRef(0);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [uploadedMedia, setUploadedMedia] = useState<UploadedReelMedia | null>(null);
  const [finishedMedia, setFinishedMedia] = useState<FinishedReelMedia | null>(null);
  const [trimStartSeconds, setTrimStartSeconds] = useState(0);
  const [trimEndSeconds, setTrimEndSeconds] = useState(0);
  const [coverSeconds, setCoverSeconds] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [facts, setFacts] = useState<ClientFact[]>([]);
  const [factsLoading, setFactsLoading] = useState(true);
  const [selectedFactIndex, setSelectedFactIndex] = useState(0);
  const [clipTitle, setClipTitle] = useState('');
  const [footageNotes, setFootageNotes] = useState('');
  const [platform, setPlatform] = useState<Platform>('Facebook');
  const [captionOptions, setCaptionOptions] = useState<CaptionOption[]>([]);
  const [selectedOption, setSelectedOption] = useState(0);
  const [hook, setHook] = useState('');
  const [captionBody, setCaptionBody] = useState('');
  const [hashtagsText, setHashtagsText] = useState('');
  const [cta, setCta] = useState('Order online from Richo Road Butchery.');
  const [isGenerating, setIsGenerating] = useState(false);
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>('now');
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleValue);
  const [isSaving, setIsSaving] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const facebookConnected = Boolean(
    socialTokens.postproxyPlacementId
    || (socialTokens.facebookConnected && socialTokens.facebookPageId),
  );
  const instagramConnected = Boolean(
    socialTokens.postproxyInstagramProfileId
    || (socialTokens.instagramConnected && socialTokens.instagramBusinessAccountId),
  );
  const platformConnected = platform === 'Facebook' ? facebookConnected : instagramConnected;
  const immediatePublisherConnected = platform === 'Facebook'
    ? Boolean(socialTokens.postproxyPlacementId)
    : Boolean(socialTokens.postproxyInstagramProfileId);
  const releaseConnected = releaseMode === 'now' ? immediatePublisherConnected : platformConnected;

  const customerSafeFacts = useMemo(
    () => facts.filter(isCustomerSafeFact).slice(0, 12),
    [facts],
  );
  const selectedFact = customerSafeFacts[selectedFactIndex] ?? null;
  const selectedFactMetadata = selectedFact ? parseFactMetadata(selectedFact) : {};
  const selectedFactCta = typeof selectedFactMetadata?.brief?.callToAction === 'string'
    ? selectedFactMetadata.brief.callToAction.trim()
    : '';

  const ctaOptions = useMemo(() => [...new Set([
    selectedFactCta,
    'Order online from Richo Road Butchery.',
    'See this week\'s counter picks online.',
    '',
  ])], [selectedFactCta]);
  const sourceDurationSeconds = videoMetadata ? videoMetadata.durationMs / 1000 : 0;
  const finishedDurationSeconds = Math.max(0, trimEndSeconds - trimStartSeconds);
  const finishIssue = videoMetadata
    ? getReelFinishIssue({
      sourceDurationSeconds,
      startSeconds: trimStartSeconds,
      endSeconds: trimEndSeconds,
      coverSeconds,
    })
    : 'Upload a video before finishing it.';

  useEffect(() => {
    let cancelled = false;
    setFactsLoading(true);
    loadFacts(clientId)
      .then((nextFacts) => {
        if (cancelled) return;
        setFacts(nextFacts);
        setSelectedFactIndex(0);
      })
      .finally(() => { if (!cancelled) setFactsLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, loadFacts]);

  useEffect(() => {
    if (selectedFactCta) setCta(selectedFactCta);
  }, [selectedFactCta]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handleFile = async (nextFile: File) => {
    const issue = getReelUploadIssue(nextFile);
    if (issue) {
      toast(issue, 'warning');
      return;
    }

    const sequence = ++uploadSequenceRef.current;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const nextPreviewUrl = URL.createObjectURL(nextFile);
    setPreviewUrl(nextPreviewUrl);
    setFile(nextFile);
    setClipTitle(nextFile.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    setUploadedMedia(null);
    setFinishedMedia(null);
    setUploadError(null);
    setFinishError(null);
    setUploadProgress(0);
    setLastResult(null);
    setIsUploading(true);

    try {
      const metadata = await readVideoMetadata(nextPreviewUrl);
      if (sequence !== uploadSequenceRef.current) return;
      setVideoMetadata(metadata);
      const durationSeconds = metadata.durationMs / 1000;
      const initialEnd = Math.min(durationSeconds, 60);
      setTrimStartSeconds(0);
      setTrimEndSeconds(initialEnd);
      setCoverSeconds(Math.min(initialEnd, Math.max(0, initialEnd * 0.35)));
      const uploaded = await uploadMedia({
        file: nextFile,
        getToken: getApiToken,
        authMode,
        clientId,
        durationMs: metadata.durationMs,
        onProgress: (progress) => {
          if (sequence === uploadSequenceRef.current) setUploadProgress(progress);
        },
      });
      if (sequence !== uploadSequenceRef.current) return;
      setUploadedMedia(uploaded);
      setUploadProgress(1);
    } catch (error: any) {
      if (sequence !== uploadSequenceRef.current) return;
      setUploadError(error?.message || 'The Reel could not be uploaded.');
    } finally {
      if (sequence === uploadSequenceRef.current) setIsUploading(false);
    }
  };

  const seekPreview = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    try { video.currentTime = seconds; } catch {}
  };

  const resetFinishedMedia = () => {
    setFinishedMedia(null);
    setFinishError(null);
    setLastResult(null);
  };

  const changeTrimStart = (value: number) => {
    const next = moveReelTrimWindow({
      value,
      sourceDurationSeconds,
      trimStartSeconds,
      trimEndSeconds,
      coverSeconds,
    });
    setTrimStartSeconds(next.startSeconds);
    setTrimEndSeconds(next.endSeconds);
    setCoverSeconds(next.coverSeconds);
    resetFinishedMedia();
    seekPreview(next.startSeconds);
  };

  const changeTrimEnd = (value: number) => {
    const maximumEnd = Math.min(sourceDurationSeconds, trimStartSeconds + 60);
    const nextEnd = clamp(value, trimStartSeconds + 1, maximumEnd);
    setTrimEndSeconds(nextEnd);
    setCoverSeconds((current) => clamp(current, trimStartSeconds, nextEnd));
    resetFinishedMedia();
    seekPreview(nextEnd);
  };

  const changeCover = (value: number) => {
    const nextCover = clamp(value, trimStartSeconds, trimEndSeconds);
    setCoverSeconds(nextCover);
    resetFinishedMedia();
    seekPreview(nextCover);
  };

  const handleFinish = async () => {
    if (!uploadedMedia || !videoMetadata) {
      toast('Wait for the Reel upload to finish.', 'warning');
      return;
    }
    if (finishIssue) {
      toast(finishIssue, 'warning');
      return;
    }
    setIsFinishing(true);
    setFinishError(null);
    setLastResult(null);
    try {
      const result = await finishMedia({
        key: uploadedMedia.key,
        clientId,
        startSeconds: trimStartSeconds,
        endSeconds: trimEndSeconds,
        coverSeconds,
        getToken: getApiToken,
        authMode,
      });
      setFinishedMedia(result);
      toast('Finished Reel and cover are ready.', 'success');
    } catch (error: any) {
      setFinishError(error?.message || 'The Reel could not be finished.');
    } finally {
      setIsFinishing(false);
    }
  };

  const applyCaptionOption = (option: CaptionOption, index: number) => {
    setSelectedOption(index);
    setHook(option.hook);
    setCaptionBody(option.body);
    setHashtagsText(option.hashtags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' '));
  };

  const generateCaptionOptions = async () => {
    if (!uploadedMedia) {
      toast('Upload the Reel before preparing its copy.', 'warning');
      return;
    }
    const safeContext = selectedFact ? publicFactContent(selectedFact) : '';
    if (!safeContext && !footageNotes.trim()) {
      toast('Add a short note about what happens in the clip.', 'warning');
      return;
    }

    setIsGenerating(true);
    setLastResult(null);
    const directions = [
      'Lead with the product and a clear local ordering reason.',
      'Sound like Pete talking to a regular customer at the counter.',
      'Keep it short, energetic, and suited to a fast Reel.',
    ];
    const sourceMaterial = [
      safeContext && `Verified Richo Road context:\n${safeContext}`,
      footageNotes.trim() && `Pete's description of the actual footage:\n${footageNotes.trim()}`,
      `Clip title: ${clipTitle.trim() || file?.name || 'Uploaded Reel'}`,
    ].filter(Boolean).join('\n\n');

    try {
      const settled = await Promise.allSettled(directions.map((direction) => (
        generateSocialPost(
          `${sourceMaterial}\n\nCaption direction: ${direction}\nOnly describe details present in the verified context or Pete's footage note.`,
          platform,
          profile.name,
          profile.type,
          profile.tone,
          {
            ...profile,
            weeklyMaterial: [profile.weeklyMaterial, sourceMaterial].filter(Boolean).join('\n\n'),
          },
          'promotional',
          clientId,
        )
      )));
      const seen = new Set<string>();
      const options = settled.flatMap((result) => {
        if (result.status !== 'fulfilled' || !result.value.content.trim()) return [];
        const split = splitGeneratedCaption(result.value.content);
        const key = `${split.hook}\n${split.body}`.toLowerCase();
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ ...split, hashtags: result.value.hashtags || [] }];
      });
      if (options.length === 0) throw new Error('The copy service did not return a usable caption.');
      setCaptionOptions(options);
      applyCaptionOption(options[0], 0);
    } catch (error: any) {
      toast(error?.message || 'AI copy could not be prepared.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const saveReel = async (action: 'draft' | 'release') => {
    if (!finishedMedia) {
      toast('Finish the Reel and choose its cover before saving.', 'warning');
      return;
    }
    const finalContent = [hook.trim(), captionBody.trim(), cta.trim()].filter(Boolean).join('\n\n');
    if (!finalContent) {
      toast('Add a caption before saving this Reel.', 'warning');
      return;
    }
    if (action === 'release' && !releaseConnected) {
      toast(
        releaseMode === 'now' && platformConnected
          ? `Publish now needs the current ${platform} Reel connection. You can schedule this Reel instead.`
          : `Connect ${platform} before publishing or scheduling.`,
        'warning',
      );
      onOpenSettings();
      return;
    }
    if (action === 'release' && releaseMode === 'schedule') {
      const scheduledTime = new Date(scheduleAt).getTime();
      if (!Number.isFinite(scheduledTime) || scheduledTime <= Date.now() + 60_000) {
        toast('Choose a schedule time at least two minutes from now.', 'warning');
        return;
      }
    }

    setIsSaving(true);
    setLastResult(null);
    try {
      const isScheduled = action === 'release' && releaseMode === 'schedule';
      const postId = await db.createPost({
        content: finalContent,
        platform,
        status: isScheduled ? 'Scheduled' : 'Draft',
        scheduledFor: isScheduled ? new Date(scheduleAt).toISOString() : null,
        hashtags: parseHashtags(hashtagsText),
        topic: clipTitle.trim() || (selectedFact && factTitle(selectedFact)) || 'Uploaded Reel',
        pillar: 'Promotion',
        postType: 'video',
        imageUrl: finishedMedia.coverUrl,
        videoUrl: finishedMedia.url,
        videoStatus: 'ready',
        r2VideoKey: finishedMedia.key,
        videoScript: footageNotes.trim() || null,
        videoMood: 'owner-uploaded',
        clientId,
      } as any);

      if (action === 'release' && releaseMode === 'now') {
        await postproxy.publishNow(postId);
        setLastResult(`${platform} is processing the Reel now.`);
        toast('Reel sent for publishing.', 'success');
      } else if (isScheduled) {
        setLastResult(`Reel scheduled for ${new Date(scheduleAt).toLocaleString()}.`);
        toast('Reel scheduled.', 'success');
      } else {
        setLastResult('Draft saved. You can finish or release it from the calendar.');
        toast('Reel saved as a draft.', 'success');
      }
      await onPostsChanged();
    } catch (error: any) {
      toast(error?.message?.slice(0, 160) || 'The Reel could not be saved.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="reel-studio">
      <header className="reel-studio__header">
        <div>
          <span className="reel-studio__eyebrow">Owner media desk</span>
          <h1>Reel Studio</h1>
          <p>{workspaceName}</p>
        </div>
        <div className="reel-studio__trust">
          <ShieldCheck size={18} />
          <span>Verified context only</span>
        </div>
      </header>

      <div className="reel-studio__grid">
        <section className="reel-panel reel-panel--media" aria-labelledby="reel-media-heading">
          <div className="reel-panel__heading">
            <span>01</span>
            <div>
              <h2 id="reel-media-heading">Your Reel</h2>
              <p>Phone footage, stored for publishing.</p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            capture="environment"
            hidden
            onChange={(event) => {
              const nextFile = event.currentTarget.files?.[0];
              if (nextFile) void handleFile(nextFile);
              event.currentTarget.value = '';
            }}
          />

          {previewUrl ? (
            <div className="reel-preview">
              <video
                ref={videoRef}
                src={finishedMedia?.url || previewUrl}
                poster={finishedMedia?.coverUrl}
                controls
                playsInline
                preload="metadata"
              />
              <button type="button" className="reel-preview__replace" onClick={() => fileInputRef.current?.click()}>
                <RefreshCw size={15} /> Replace
              </button>
              {isUploading && (
                <div className="reel-upload-progress" role="status">
                  <div className="reel-upload-progress__track">
                    <span style={{ width: `${Math.round(uploadProgress * 100)}%` }} />
                  </div>
                  <span>{Math.round(uploadProgress * 100)}%</span>
                </div>
              )}
              {isFinishing && (
                <div className="reel-finish-progress" role="status">
                  <Loader2 size={16} className="spin" /> Finishing MP4 and cover...
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              className={`reel-dropzone${isDragging ? ' is-dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                const nextFile = event.dataTransfer.files?.[0];
                if (nextFile) void handleFile(nextFile);
              }}
            >
              <Upload size={28} />
              <strong>Upload Pete's Reel</strong>
              <span>MP4, MOV or WebM, up to 95 MB</span>
            </button>
          )}

          {file && (
            <div className="reel-file-meta">
              <FileVideo2 size={18} />
              <div>
                <strong>{file.name}</strong>
                <span>
                  {formatBytes(file.size)}
                  {videoMetadata ? ` / ${formatDuration(videoMetadata.durationMs)} / ${videoMetadata.width}x${videoMetadata.height}` : ''}
                </span>
              </div>
              <span className={`reel-file-state${uploadedMedia ? ' is-ready' : uploadError ? ' is-error' : ''}`}>
                {finishedMedia
                  ? <><Check size={13} /> Finished</>
                  : uploadedMedia
                    ? <><Check size={13} /> Uploaded</>
                    : uploadError ? 'Retry' : 'Uploading'}
              </span>
            </div>
          )}

          {uploadError && (
            <div className="reel-inline-error" role="alert">
              <AlertCircle size={16} />
              <span>{uploadError}</span>
              {file && <button type="button" onClick={() => void handleFile(file)}>Retry upload</button>}
            </div>
          )}

          {uploadedMedia && videoMetadata && (
            <div className="reel-finisher" aria-labelledby="reel-finisher-heading">
              <div className="reel-finisher__heading">
                <Scissors size={17} />
                <div>
                  <strong id="reel-finisher-heading">Trim and cover</strong>
                  <span>{formatTimestamp(finishedDurationSeconds)} selected / original sound kept</span>
                </div>
              </div>

              <div className="reel-range">
                <div className="reel-range__label">
                  <label htmlFor="reel-trim-start">Starts</label>
                  <output htmlFor="reel-trim-start">{formatTimestamp(trimStartSeconds)}</output>
                </div>
                <input
                  id="reel-trim-start"
                  type="range"
                  min={0}
                  max={Math.max(0, sourceDurationSeconds - 1)}
                  step={0.1}
                  value={trimStartSeconds}
                  aria-valuetext={formatTimestamp(trimStartSeconds)}
                  onChange={(event) => changeTrimStart(Number(event.target.value))}
                />
              </div>

              <div className="reel-range">
                <div className="reel-range__label">
                  <label htmlFor="reel-trim-end">Ends</label>
                  <output htmlFor="reel-trim-end">{formatTimestamp(trimEndSeconds)}</output>
                </div>
                <input
                  id="reel-trim-end"
                  type="range"
                  min={Math.min(sourceDurationSeconds, trimStartSeconds + 1)}
                  max={Math.min(sourceDurationSeconds, trimStartSeconds + 60)}
                  step={0.1}
                  value={trimEndSeconds}
                  aria-valuetext={formatTimestamp(trimEndSeconds)}
                  onChange={(event) => changeTrimEnd(Number(event.target.value))}
                />
              </div>

              <div className="reel-range reel-range--cover">
                <div className="reel-range__label">
                  <label htmlFor="reel-cover-frame">Cover frame</label>
                  <output htmlFor="reel-cover-frame">{formatTimestamp(coverSeconds)}</output>
                </div>
                <input
                  id="reel-cover-frame"
                  type="range"
                  min={trimStartSeconds}
                  max={trimEndSeconds}
                  step={0.1}
                  value={coverSeconds}
                  aria-valuetext={formatTimestamp(coverSeconds)}
                  onChange={(event) => changeCover(Number(event.target.value))}
                />
              </div>

              <div className={`reel-finish-summary${finishedMedia ? ' is-ready' : ''}`}>
                {finishedMedia ? (
                  <img src={finishedMedia.coverUrl} alt="Selected Reel cover frame" />
                ) : (
                  <span className="reel-finish-summary__icon"><ImageIcon size={19} /></span>
                )}
                <div>
                  <strong>{finishedMedia ? 'Finished Reel ready' : 'Cover not made yet'}</strong>
                  <span>{finishedMedia ? 'MP4 and cover saved' : finishIssue || 'Ready to finish'}</span>
                </div>
              </div>

              {finishError && (
                <div className="reel-inline-error" role="alert">
                  <AlertCircle size={16} />
                  <span>{finishError}</span>
                </div>
              )}

              <button
                type="button"
                className="reel-finish-action"
                onClick={() => void handleFinish()}
                disabled={isFinishing || Boolean(finishIssue)}
              >
                {isFinishing ? <Loader2 size={16} className="spin" /> : finishedMedia ? <RefreshCw size={16} /> : <Scissors size={16} />}
                {isFinishing ? 'Finishing Reel...' : finishedMedia ? 'Update finished Reel' : 'Finish Reel'}
              </button>
            </div>
          )}
        </section>

        <section className="reel-panel reel-panel--copy" aria-labelledby="reel-copy-heading">
          <div className="reel-panel__heading">
            <span>02</span>
            <div>
              <h2 id="reel-copy-heading">Shape the story</h2>
              <p>Pick real context, then edit every word.</p>
            </div>
          </div>

          <div className="reel-field">
            <label htmlFor="reel-clip-title">Clip title</label>
            <input id="reel-clip-title" value={clipTitle} onChange={(event) => setClipTitle(event.target.value)} placeholder="Friday counter picks" />
          </div>

          <div className="reel-field">
            <label htmlFor="reel-footage-notes">What happens in the clip?</label>
            <textarea
              id="reel-footage-notes"
              value={footageNotes}
              onChange={(event) => setFootageNotes(event.target.value)}
              rows={3}
              placeholder="Pete slices the burgers, shows the tray, then points to the weekend special."
            />
          </div>

          <div className="reel-field">
            <label htmlFor="reel-context">Website context</label>
            <select
              id="reel-context"
              value={customerSafeFacts.length ? selectedFactIndex : -1}
              onChange={(event) => setSelectedFactIndex(Number(event.target.value))}
              disabled={factsLoading || customerSafeFacts.length === 0}
            >
              {factsLoading && <option value={-1}>Loading verified context...</option>}
              {!factsLoading && customerSafeFacts.length === 0 && <option value={-1}>Use my footage note only</option>}
              {customerSafeFacts.map((fact, index) => (
                <option key={`${factTitle(fact)}-${index}`} value={index}>{factTitle(fact)}</option>
              ))}
            </select>
            {selectedFact && <span className="reel-field__hint">{factSummary(selectedFact)}</span>}
          </div>

          <button
            type="button"
            className="reel-ai-button"
            onClick={() => void generateCaptionOptions()}
            disabled={isGenerating || !uploadedMedia}
          >
            {isGenerating ? <Loader2 size={17} className="spin" /> : <Sparkles size={17} />}
            {isGenerating ? 'Writing three options...' : 'Write 3 caption options'}
          </button>

          {captionOptions.length > 0 && (
            <div className="reel-caption-options" aria-label="Caption options">
              {captionOptions.map((option, index) => (
                <button
                  type="button"
                  key={`${option.hook}-${index}`}
                  className={selectedOption === index ? 'is-selected' : ''}
                  onClick={() => applyCaptionOption(option, index)}
                >
                  <span>Option {index + 1}</span>
                  <strong>{option.hook}</strong>
                </button>
              ))}
            </div>
          )}

          <div className="reel-field">
            <label htmlFor="reel-hook">Hook</label>
            <input id="reel-hook" value={hook} onChange={(event) => setHook(event.target.value)} placeholder="This weekend's counter pick is ready." />
          </div>

          <div className="reel-field">
            <div className="reel-field__label-row">
              <label htmlFor="reel-caption">Caption</label>
              <span>{captionBody.length} characters</span>
            </div>
            <textarea id="reel-caption" value={captionBody} onChange={(event) => setCaptionBody(event.target.value)} rows={6} placeholder="Add the product details and reason to order." />
          </div>

          <div className="reel-field">
            <label htmlFor="reel-cta">Call to action</label>
            <select id="reel-cta" value={cta} onChange={(event) => setCta(event.target.value)}>
              {ctaOptions.map((option) => <option key={option || 'none'} value={option}>{option || 'No call to action'}</option>)}
            </select>
          </div>

          <div className="reel-field">
            <label htmlFor="reel-hashtags">Hashtags</label>
            <input id="reel-hashtags" value={hashtagsText} onChange={(event) => setHashtagsText(event.target.value)} placeholder="#Rockhampton #Butcher #WeeklySpecial" />
          </div>
        </section>

        <aside className="reel-panel reel-panel--release" aria-labelledby="reel-release-heading">
          <div className="reel-panel__heading">
            <span>03</span>
            <div>
              <h2 id="reel-release-heading">Release</h2>
              <p>Save it, schedule it, or send it live.</p>
            </div>
          </div>

          <div className="reel-release-block">
            <span className="reel-release-block__label">Platform</span>
            <div className="reel-platforms">
              <button
                type="button"
                className={platform === 'Facebook' ? 'is-selected' : ''}
                onClick={() => setPlatform('Facebook')}
              >
                <Facebook size={17} />
                <span>Facebook</span>
                {facebookConnected ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              </button>
              <button
                type="button"
                className={platform === 'Instagram' ? 'is-selected' : ''}
                onClick={() => setPlatform('Instagram')}
              >
                <Instagram size={17} />
                <span>Instagram</span>
                {instagramConnected ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              </button>
            </div>
            {!releaseConnected && (
              <button type="button" className="reel-connect-link" onClick={onOpenSettings}>
                {releaseMode === 'now' && platformConnected
                  ? `Update ${platform} connection for Publish now`
                  : `Connect ${platform} in Settings`}
              </button>
            )}
          </div>

          <div className="reel-release-block">
            <span className="reel-release-block__label">Timing</span>
            <div className="reel-timing">
              <button type="button" className={releaseMode === 'now' ? 'is-selected' : ''} onClick={() => setReleaseMode('now')}>
                <Send size={16} /> Publish now
              </button>
              <button type="button" className={releaseMode === 'schedule' ? 'is-selected' : ''} onClick={() => setReleaseMode('schedule')}>
                <CalendarClock size={16} /> Schedule
              </button>
            </div>
            {releaseMode === 'schedule' && (
              <div className="reel-field reel-field--schedule">
                <label htmlFor="reel-schedule">Date and time</label>
                <input id="reel-schedule" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
              </div>
            )}
          </div>

          <div className="reel-review">
            <span>Release check</span>
            <ul>
              <li className={finishedMedia ? 'is-ready' : ''}><Check size={14} /> Finished video and cover</li>
              <li className={hook.trim() || captionBody.trim() ? 'is-ready' : ''}><Check size={14} /> Editable copy</li>
              <li className={releaseConnected ? 'is-ready' : ''}><Check size={14} /> Connected publisher</li>
            </ul>
          </div>

          {lastResult && (
            <div className="reel-result" role="status">
              <CheckCircle2 size={18} />
              <span>{lastResult}</span>
            </div>
          )}

          <div className="reel-release-actions">
            <button type="button" className="reel-secondary-action" onClick={() => void saveReel('draft')} disabled={isSaving || !finishedMedia}>
              <Save size={17} /> Save draft
            </button>
            <button type="button" className="reel-primary-action" onClick={() => void saveReel('release')} disabled={isSaving || !finishedMedia || !releaseConnected}>
              {isSaving ? <Loader2 size={18} className="spin" /> : releaseMode === 'schedule' ? <CalendarClock size={18} /> : <Send size={18} />}
              {isSaving ? 'Saving...' : releaseMode === 'schedule' ? 'Schedule Reel' : 'Review and publish'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default ReelStudio;
