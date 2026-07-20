import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  Facebook,
  Instagram,
  Loader2,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
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
  getReelUploadIssue,
  uploadReelMedia,
  type FinishedReelMedia,
} from '../services/reelMedia';
import { ReelClipEditor } from './reel-editor/ReelClipEditor';
import { renderReelProject, type ReelRenderProgress } from './reel-editor/renderTimeline';
import {
  commitEdit,
  createEditHistory,
  createEmptyReelProject,
  createReelClip,
  getReelProjectIssue,
  redoEdit,
  reelProjectDuration,
  undoEdit,
  type ReelProject,
} from './reel-editor/timeline';
import './ReelStudio.css';

export { moveReelTrimWindow } from './reel-editor/timeline';

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

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`;
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
  const assetUrlsRef = useRef(new Set<string>());
  const renderAbortRef = useRef<AbortController | null>(null);
  const [projectHistory, setProjectHistory] = useState(() => createEditHistory(createEmptyReelProject()));
  const project = projectHistory.present;
  const [finishedMedia, setFinishedMedia] = useState<FinishedReelMedia | null>(null);
  const [coverSeconds, setCoverSeconds] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState<ReelRenderProgress | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

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
  const finishedDurationSeconds = reelProjectDuration(project);
  const finishIssue = getReelProjectIssue(project);

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

  const resetFinishedMedia = () => {
    setFinishedMedia(null);
    setFinishError(null);
    setLastResult(null);
  };

  const changeProject = (nextProject: ReelProject, recordHistory = true) => {
    setProjectHistory((current) => (
      recordHistory
        ? commitEdit(current, nextProject)
        : { ...current, present: nextProject }
    ));
    if (recordHistory) resetFinishedMedia();
  };

  const handleUndo = () => {
    setProjectHistory((current) => undoEdit(current));
    resetFinishedMedia();
  };

  const handleRedo = () => {
    setProjectHistory((current) => redoEdit(current));
    resetFinishedMedia();
  };

  useEffect(() => {
    setCoverSeconds((current) => Math.min(current, finishedDurationSeconds));
  }, [finishedDurationSeconds]);

  useEffect(() => () => {
    renderAbortRef.current?.abort();
    assetUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    assetUrlsRef.current.clear();
  }, []);

  const handleFiles = async (files: File[]) => {
    if (project.clips.length + files.length > 12) {
      toast('Keep each Reel to 12 clips or fewer.', 'warning');
      return;
    }
    setIsImporting(true);
    const nextClips = [];
    try {
      for (const nextFile of files) {
        const issue = getReelUploadIssue(nextFile);
        if (issue) {
          toast(`${nextFile.name}: ${issue}`, 'warning');
          continue;
        }
        const url = URL.createObjectURL(nextFile);
        assetUrlsRef.current.add(url);
        try {
          const metadata = await readVideoMetadata(url);
          nextClips.push(createReelClip({
            id: crypto.randomUUID(),
            file: nextFile,
            url,
            sourceDurationSeconds: metadata.durationMs / 1000,
            width: metadata.width,
            height: metadata.height,
          }));
        } catch (error) {
          URL.revokeObjectURL(url);
          assetUrlsRef.current.delete(url);
          toast(error instanceof Error ? `${nextFile.name}: ${error.message}` : `${nextFile.name} could not be read.`, 'warning');
        }
      }
      if (nextClips.length === 0) return;
      const nextProject = {
        ...project,
        clips: [...project.clips, ...nextClips],
        selectedClipId: project.selectedClipId || nextClips[0].id,
      };
      changeProject(nextProject);
      if (!clipTitle.trim()) setClipTitle(nextClips[0].name);
      if (project.clips.length === 0) {
        const initialDuration = reelProjectDuration(nextProject);
        setCoverSeconds(Math.min(initialDuration, Math.max(0, initialDuration * 0.35)));
      }
    } finally {
      setIsImporting(false);
    }
  };

  const handleMusicFile = (musicFile: File) => {
    if (!musicFile.type.startsWith('audio/')) {
      toast('Choose an MP3, M4A, WAV, AAC, or OGG audio file.', 'warning');
      return;
    }
    if (musicFile.size > 25 * 1024 * 1024) {
      toast('Keep background music under 25 MB.', 'warning');
      return;
    }
    const url = URL.createObjectURL(musicFile);
    assetUrlsRef.current.add(url);
    changeProject({
      ...project,
      music: {
        id: crypto.randomUUID(),
        file: musicFile,
        url,
        name: musicFile.name,
        volume: 0.22,
        loop: true,
      },
    });
  };

  const removeMusic = () => {
    changeProject({ ...project, music: null });
  };

  const handleFinish = async () => {
    if (finishIssue) {
      toast(finishIssue, 'warning');
      return;
    }
    const controller = new AbortController();
    renderAbortRef.current = controller;
    setIsFinishing(true);
    setFinishError(null);
    setLastResult(null);
    setUploadProgress(0);
    setRenderProgress({ phase: 'preparing', progress: 0, clipIndex: 0, clipCount: project.clips.length });
    try {
      const rendered = await renderReelProject(project, {
        signal: controller.signal,
        onProgress: setRenderProgress,
      });
      setRenderProgress(null);
      const renderedFile = new File(
        [rendered.blob],
        `socialai-reel-${Date.now()}.${rendered.extension}`,
        { type: rendered.contentType },
      );
      const uploadIssue = getReelUploadIssue(renderedFile);
      if (uploadIssue) throw new Error(uploadIssue);
      const uploaded = await uploadMedia({
        file: renderedFile,
        getToken: getApiToken,
        authMode,
        clientId,
        durationMs: rendered.durationMs,
        onProgress: setUploadProgress,
      });
      const renderedDurationSeconds = rendered.durationMs / 1000;
      const safeCoverSeconds = Math.min(
        Math.max(0, coverSeconds),
        Math.max(0, renderedDurationSeconds - 0.05),
      );
      const result = await finishMedia({
        key: uploaded.key,
        clientId,
        startSeconds: 0,
        endSeconds: renderedDurationSeconds,
        coverSeconds: safeCoverSeconds,
        getToken: getApiToken,
        authMode,
      });
      setFinishedMedia(result);
      toast('Edited Reel and cover are ready.', 'success');
    } catch (error: any) {
      if (error?.name === 'AbortError') toast('Reel rendering cancelled.', 'info');
      else setFinishError(error?.message || 'The Reel could not be finished.');
    } finally {
      renderAbortRef.current = null;
      setRenderProgress(null);
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
    if (project.clips.length === 0) {
      toast('Add a clip before preparing its copy.', 'warning');
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
      `Clip title: ${clipTitle.trim() || project.clips[0]?.name || 'Uploaded Reel'}`,
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
              <h2 id="reel-media-heading">Edit your Reel</h2>
              <p>Cut, arrange, style, mix, and preview every clip.</p>
            </div>
          </div>

          <ReelClipEditor
            project={project}
            onProjectChange={changeProject}
            onAddFiles={handleFiles}
            onAddMusic={handleMusicFile}
            onRemoveMusic={removeMusic}
            canUndo={projectHistory.past.length > 0}
            canRedo={projectHistory.future.length > 0}
            onUndo={handleUndo}
            onRedo={handleRedo}
            coverSeconds={coverSeconds}
            onCoverChange={(seconds) => {
              setCoverSeconds(seconds);
              resetFinishedMedia();
            }}
            finishedMedia={finishedMedia}
            finishError={finishError}
            finishIssue={finishIssue}
            isImporting={isImporting}
            isFinishing={isFinishing}
            renderProgress={renderProgress}
            uploadProgress={uploadProgress}
            onFinish={handleFinish}
            onCancelFinish={() => renderAbortRef.current?.abort()}
          />
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
            disabled={isGenerating || project.clips.length === 0}
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
