import React, { useEffect, useState } from 'react';
import {
  X, Facebook, Instagram, Send, Trash2, Save, Loader2,
  Calendar, Clock, Edit2, CheckCircle, Image as ImageIcon,
  RefreshCw, Upload, Hash, TrendingUp, Sparkles, ShieldCheck, ShieldAlert, Flag
} from 'lucide-react';
import { SocialPost } from '../types';
import { AnimatedReelPreview } from './AnimatedReelPreview';
import { useDb } from '../hooks/useDb';
import type { LearningDecision, ReachPlan, ViralityScore } from '../services/db';

interface Props {
  post: SocialPost;
  image?: string;
  isGeneratingImage?: boolean;
  fbConnected: boolean;
  hasApiKey: boolean;
  onClose: () => void;
  onPublish: (post: SocialPost) => Promise<void>;
  onDelete: (id: string) => void;
  onSave: (id: string, updates: Partial<SocialPost>) => Promise<void>;
  onRegenImage: (postId: string, prompt: string) => void;
  onUpload: (postId: string) => void;
  /** Reset a failed reel back to 'pending' so the prewarm cron picks it up
   *  again. No credit re-charge — user already paid; this is just a retry of
   *  the same paid attempt. */
  onRetryReel?: (postId: string) => Promise<void>;
}

const RELEASE_STATE_COPY: Record<LearningDecision['release_state'], {
  label: string;
  tone: string;
  reason: string;
}> = {
  pass_green: {
    label: 'Ready',
    tone: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/25',
    reason: 'Independent critics found no release-critical issue.',
  },
  hold_amber: {
    label: 'Needs attention',
    tone: 'text-amber-300 bg-amber-500/15 border-amber-400/25',
    reason: 'One or more checks need stronger evidence or a safe repair.',
  },
  block_red: {
    label: 'Blocked',
    tone: 'text-rose-300 bg-rose-500/15 border-rose-400/25',
    reason: 'A release-critical business risk remains unresolved.',
  },
  shadow_only: {
    label: 'Shadow only',
    tone: 'text-sky-300 bg-sky-500/15 border-sky-400/25',
    reason: 'The review was recorded without changing publishing behaviour.',
  },
  pending: {
    label: 'Pending',
    tone: 'text-white/50 bg-white/[0.05] border-white/10',
    reason: 'Independent review has not finished yet.',
  },
};

function criticLabel(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

export const LearningSafetyReport: React.FC<{
  decision: LearningDecision | null;
  loading: boolean;
}> = ({ decision, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-[11px] text-white/35">
        <Loader2 size={11} className="animate-spin text-amber-400/60" />
        Loading safety report...
      </div>
    );
  }
  if (!decision) return null;

  const state = RELEASE_STATE_COPY[decision.release_state];
  const candidateChanged = decision.summary.candidateChanged === true;
  const reason = candidateChanged
    ? 'A safer repair was proposed but has not replaced the scheduled post.'
    : state.reason;

  return (
    <details className="group rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-3 py-2.5">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/50">
          {decision.release_state === 'pass_green'
            ? <ShieldCheck size={12} className="text-emerald-400" />
            : <ShieldAlert size={12} className="text-amber-400" />}
          Safety report
        </span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${state.tone}`}>
          {state.label}
        </span>
      </summary>
      <div className="border-t border-white/[0.06] px-3 py-3 space-y-3 bg-black/15">
        <div className="space-y-1">
          <p className="text-[11px] leading-relaxed text-white/55">{reason}</p>
          <p className="text-[10px] text-white/25">
            {decision.mode === 'shadow' ? 'Shadow review' : criticLabel(decision.mode)}
            {' · '}{decision.verdicts.length} critic result{decision.verdicts.length === 1 ? '' : 's'}
          </p>
        </div>
        {decision.verdicts.map((verdict) => (
          <div key={verdict.id} className="rounded-lg border border-white/[0.06] bg-black/20 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-white/70">{criticLabel(verdict.critic_kind)}</span>
              <span className="text-[9px] uppercase tracking-wider text-white/30">
                {criticLabel(verdict.verdict)} · {Math.round(verdict.confidence * 100)}%
              </span>
            </div>
            {verdict.evidence.map((item, index) => (
              <p key={`e-${index}`} className="text-[10px] leading-relaxed text-white/45">Evidence: {item}</p>
            ))}
            {verdict.repairs.map((item, index) => (
              <p key={`r-${index}`} className="text-[10px] leading-relaxed text-amber-300/70">Repair: {item}</p>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
};

const REACH_WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

function reachHour(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized >= 12 ? 'pm' : 'am';
  const display = normalized % 12 || 12;
  return `${display}:00 ${suffix}`;
}

export const ReachPlanRationale: React.FC<{
  plan: ReachPlan | null;
  loading: boolean;
  platform: SocialPost['platform'];
}> = ({ plan, loading, platform }) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-[11px] text-white/35">
        <Loader2 size={11} className="animate-spin text-emerald-400/60" />
        Loading organic reach rationale...
      </div>
    );
  }
  if (!plan) return null;

  const platformKey = platform.toLowerCase() as 'facebook' | 'instagram';
  const treatment = plan.platformPlan[platformKey];
  const timing = plan.timing.find((window) => window.platform === platformKey)
    ?? plan.timing[0];
  const hashtags = platformKey === 'facebook'
    ? plan.hashtags.facebookTags ?? []
    : plan.hashtags.instagramTags ?? [];
  const media = plan.media[platformKey];
  const mediaLabel = media?.source === 'approved_asset'
    ? `Approved ${media.format ?? 'media'}`
    : media?.source === 'generated'
      ? `Guarded generated ${media.format ?? 'media'}`
      : 'Media direction pending';

  return (
    <details className="group overflow-hidden rounded-xl border border-emerald-400/15 bg-emerald-500/[0.035]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-emerald-100/60">
          <TrendingUp size={12} className="text-emerald-300" />
          Organic reach rationale
        </span>
        <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-300">
          Shadow advice only
        </span>
      </summary>
      <div className="grid gap-2 border-t border-white/[0.06] bg-black/15 p-3 sm:grid-cols-2">
        <RationaleFact
          label="Intended audience"
          value={plan.audience?.label ?? 'Broad commercial audience pending'}
          detail={plan.audience?.needs.join(', ') || undefined}
        />
        <RationaleFact
          label="Geographic focus"
          value={plan.geographicFocus.join(', ') || 'Confirmed service area'}
        />
        <RationaleFact
          label="Platform treatment"
          value={`${platform}-specific caption`}
          detail={`${treatment?.hashtags?.length ?? 0} platform hashtags`}
        />
        <RationaleFact
          label="Recommended timing"
          value={timing
            ? `${REACH_WEEKDAYS[timing.weekday] ?? 'Local day'}, ${reachHour(timing.startHour)}-${reachHour(timing.endHour)}`
            : 'Not enough account history yet'}
          detail={timing
            ? `${Math.round(timing.confidence * 100)}% confidence from ${timing.source} evidence`
            : 'Archetype fallback only'}
        />
        <RationaleFact
          label="Local keywords"
          value={(plan.hashtags.localKeywords ?? []).join(', ') || 'None selected'}
        />
        <RationaleFact
          label="Hashtags"
          value={hashtags.join(' ') || 'No hashtags selected'}
        />
        <RationaleFact label="Media source" value={mediaLabel} />
        <RationaleFact
          label="Objective"
          value={plan.objective || 'Organic local relevance'}
        />
        <p className="sm:col-span-2 text-[10px] leading-relaxed text-white/25">
          This plan is explanatory only. It has not changed the caption, media, schedule, or publish state.
        </p>
      </div>
    </details>
  );
};

const RationaleFact: React.FC<{
  label: string;
  value: string;
  detail?: string;
}> = ({ label, value, detail }) => (
  <div className="rounded-lg border border-white/[0.06] bg-black/20 p-2.5">
    <p className="text-[9px] font-bold uppercase tracking-wider text-white/25">{label}</p>
    <p className="mt-1 text-[11px] font-semibold leading-relaxed text-white/65">{value}</p>
    {detail && <p className="mt-0.5 text-[9px] leading-relaxed text-white/30">{detail}</p>}
  </div>
);

export const PostModal: React.FC<Props> = ({
  post, image, isGeneratingImage, fbConnected, hasApiKey,
  onClose, onPublish, onDelete, onSave, onRegenImage, onUpload, onRetryReel,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [editHashtags, setEditHashtags] = useState((post.hashtags || []).join(' '));
  const [editDate, setEditDate] = useState(() => {
    const d = new Date(post.scheduledFor);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 16);
    return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const displayImage = image || post.image;

  // ── Safe-close guard (audit P0-6, 2026-05-22) ────────────────────────────
  // Backdrop click + Escape both close the modal. If the user is mid-edit,
  // confirm before discarding so a stray click doesn't burn 30 seconds of
  // caption work. Restoring the native confirm() since it's the only
  // synchronous "are you sure?" available without standing up a second modal.
  const hasUnsavedEdits =
    isEditing &&
    (editContent !== post.content ||
      editHashtags !== (post.hashtags || []).join(' '));
  const safeClose = () => {
    if (!hasUnsavedEdits || confirm('Discard your unsaved edits?')) onClose();
  };

  // Escape key close (with the safe-close guard). Attach to document so the
  // handler fires even when focus is inside a deeply-nested input that
  // hasn't bubbled the keydown to the modal wrapper.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') safeClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedEdits]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const tags = editHashtags.trim()
        ? editHashtags.trim().split(/\s+/).map(t => t.startsWith('#') ? t : `#${t}`)
        : [];
      await onSave(post.id, {
        content: editContent,
        hashtags: tags,
        scheduledFor: new Date(editDate).toISOString(),
      });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      await onPublish(post);
      onClose();
    } finally {
      setIsPublishing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this post?')) return;
    setIsDeleting(true);
    onDelete(post.id);
    onClose();
  };

  const isIG = post.platform === 'Instagram';
  const isVideo = post.postType === 'video';
  const [showScript, setShowScript] = useState(false);

  // ── Virality Score (2026-05 Tier 3) ──
  // Debounced 1.5s prediction trained on the workspace's own past engagement.
  // Only runs for editable posts (Draft/Scheduled) — Posted/Missed are history.
  const db = useDb();
  const isScorable = post.status === 'Draft' || post.status === 'Scheduled';
  const scoringContent = isEditing ? editContent : post.content;
  const [viralityScore, setViralityScore] = useState<ViralityScore | null>(null);
  const [isScoringPost, setIsScoringPost] = useState(false);
  const [qaFeedbackReason, setQaFeedbackReason] = useState(post.qaFeedbackReason);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [learningDecisions, setLearningDecisions] = useState<LearningDecision[]>([]);
  const [isLoadingSafetyReport, setIsLoadingSafetyReport] = useState(true);
  const [reachPlans, setReachPlans] = useState<ReachPlan[]>([]);
  const [isLoadingReachPlans, setIsLoadingReachPlans] = useState(true);
  type FeedbackReason = NonNullable<SocialPost['qaFeedbackReason']>;
  type FeedbackTarget = NonNullable<SocialPost['qaFeedbackTarget']>;
  const markFeedback = async (target: FeedbackTarget, reason: FeedbackReason) => {
    setIsSendingFeedback(true);
    try {
      await db.markPostFeedback({ postId: post.id, target, reason });
      setQaFeedbackReason(reason);
    } catch (e) {
      console.warn('[post-feedback]', e);
    } finally {
      setIsSendingFeedback(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    setIsLoadingSafetyReport(true);
    db.getLearningDecisions(post.id, post.clientId)
      .then((decisions) => {
        if (!cancelled) setLearningDecisions(decisions);
      })
      .catch((error) => {
        if (!cancelled) {
          setLearningDecisions([]);
          console.warn('[learning-decisions]', error);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSafetyReport(false);
      });
    return () => { cancelled = true; };
  }, [db, post.id, post.clientId]);
  useEffect(() => {
    let cancelled = false;
    setIsLoadingReachPlans(true);
    db.getReachPlans(post.id, post.clientId)
      .then((plans) => {
        if (!cancelled) setReachPlans(plans);
      })
      .catch((error) => {
        if (!cancelled) {
          setReachPlans([]);
          console.warn('[reach-plans]', error);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingReachPlans(false);
      });
    return () => { cancelled = true; };
  }, [db, post.id, post.clientId]);
  useEffect(() => {
    if (!isScorable) return;
    if (!scoringContent || scoringContent.trim().length < 10) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsScoringPost(true);
      try {
        const result = await db.scorePost({
          content: scoringContent,
          platform: post.platform,
          pillar: post.pillar,
          hashtags: post.hashtags,
        });
        if (!cancelled) setViralityScore(result);
      } catch (e) {
        if (!cancelled) console.warn('[score-post]', e);
      } finally {
        if (!cancelled) setIsScoringPost(false);
      }
    }, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [scoringContent, post.platform, post.pillar, isScorable]);

  const tierColours: Record<NonNullable<ViralityScore['tier']>, { bg: string; text: string; border: string }> = {
    low:   { bg: 'bg-red-500/15',    text: 'text-red-300',    border: 'border-red-500/30' },
    mid:   { bg: 'bg-amber-500/15',  text: 'text-amber-300',  border: 'border-amber-500/30' },
    high:  { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/30' },
    viral: { bg: 'bg-purple-500/20', text: 'text-purple-200', border: 'border-purple-500/40' },
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) safeClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Post details"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-lg" />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-[calc(100vw-1rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto bg-[var(--color-surface-1)] glass-card noise border-gradient rounded-3xl shadow-2xl shadow-black/60 animate-spring-in">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            {isIG
              ? <Instagram size={15} className="text-pink-400" />
              : <Facebook size={15} className="text-blue-400" />}
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
              post.status === 'Posted' ? 'bg-green-500/15 text-green-300' :
              post.status === 'Scheduled' ? 'bg-blue-500/15 text-blue-300' :
              'bg-white/8 text-white/30'
            }`}>{post.status}</span>
            {post.pillar && (
              <span className="text-[10px] bg-purple-500/15 text-purple-300 px-2 py-0.5 rounded-full">{post.pillar}</span>
            )}
          </div>
          <button onClick={safeClose} aria-label="Close post details" className="text-white/25 hover:text-white/60 hover:bg-white/[0.06] transition-all rounded-lg p-1.5 press">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[80vh]">
          {/* ── Video Reel Preview ── */}
          {isVideo ? (
            <div className="border-b border-white/[0.06]">
              {/* Once the prewarm cron finishes, show the actual mp4 — that's
                  what's about to publish. Before then, fall back to the
                  animated preview frame so the user has something to look at
                  while it's queued. */}
              {post.videoStatus === 'ready' && post.videoUrl ? (
                <video
                  src={post.videoUrl}
                  controls
                  playsInline
                  className="w-full max-h-[60vh] object-contain bg-black"
                />
              ) : null}
              <div className="flex items-center gap-4 p-5">
                {!(post.videoStatus === 'ready' && post.videoUrl) && (
                  <AnimatedReelPreview
                    imageUrl={post.image}
                    hookText={post.videoScript?.split(/Hook:|Body:|CTA:/).find((s: string) => s.trim())?.replace(/^['"]/, '').trim() || post.content}
                    mood={post.videoMood}
                    size="md"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/25">Reel</span>
                    {/* Status pill — same colour key as the calendar list view.
                        Surfaces whether the prewarm cron has the reel ready,
                        is still working on it, or fell back to image. */}
                    {post.status !== 'Posted' && post.status !== 'Missed' && (
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          post.videoStatus === 'ready'      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' :
                          post.videoStatus === 'generating' ? 'bg-amber-500/15 text-amber-300 border-amber-500/25' :
                          post.videoStatus === 'failed'     ? 'bg-red-500/15 text-red-300 border-red-500/25' :
                                                              'bg-white/8 text-white/55 border-white/12'
                        }`}
                      >
                        {post.videoStatus === 'ready'      ? 'Reel ready' :
                         post.videoStatus === 'generating' ? 'Generating ~2 min' :
                         post.videoStatus === 'failed'     ? 'Reel failed — image fallback' :
                                                             'Queued for prewarm'}
                      </span>
                    )}
                  </div>
                  {post.videoStatus === 'failed' && post.videoError && (
                    <p className="text-[11px] text-red-300/80 mt-2 leading-snug">
                      <span className="font-semibold">Why: </span>{post.videoError}
                    </p>
                  )}
                  {post.videoStatus === 'failed' && onRetryReel && post.status === 'Scheduled' && (
                    <button
                      onClick={() => onRetryReel(post.id)}
                      className="text-[11px] mt-2 inline-flex items-center gap-1.5 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 px-2.5 py-1 rounded-lg transition font-semibold"
                    >
                      <RefreshCw size={10} /> Retry reel generation
                    </button>
                  )}
                  {!post.videoStatus && (
                    <p className="text-[11px] text-white/40 mt-2 leading-snug">
                      Reel queued — generates 45 min before scheduled time.
                    </p>
                  )}
                  {post.videoMood && <p className="text-xs text-white/30 mt-2">Mood: {post.videoMood}</p>}
                  {post.videoScript && (
                    <button
                      onClick={() => setShowScript(!showScript)}
                      className="text-xs text-purple-400 hover:text-purple-300 mt-2 flex items-center gap-1 transition"
                    >
                      {showScript ? '▴ Hide' : '▾ View'} Video Script & Shot Brief
                    </button>
                  )}
                </div>
              </div>
              {showScript && post.videoScript && (
                <div className="px-5 pb-4 space-y-3 animate-fadeSlideUp">
                  <div className="glass-card border border-white/[0.08] rounded-xl p-3">
                    <p className="text-[10px] font-bold text-purple-400/60 uppercase tracking-wider mb-1">Script</p>
                    <p className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">{post.videoScript}</p>
                  </div>
                  {post.videoShots && (
                    <div className="glass-card border border-white/[0.08] rounded-xl p-3">
                      <p className="text-[10px] font-bold text-purple-400/60 uppercase tracking-wider mb-1">Shot Brief</p>
                      <p className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">{post.videoShots}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
          /* ── Image ── */
          displayImage ? (
            <div className="relative">
              <img src={displayImage} alt="" loading="lazy" className="w-full max-h-56 object-cover" />
              {/* AI quality-check badge — populated by Haiku 4.5 vision at
                  prewarm time. Colour-codes the score so the user can scan
                  for "needs eyes on it" posts at a glance. Tooltip shows the
                  one-sentence reasoning. */}
              {typeof post.imageCritiqueScore === 'number' && (
                <div
                  className={`absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg backdrop-blur text-[10px] font-bold uppercase tracking-wider border ${
                    post.imageCritiqueScore >= 8
                      ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300'
                      : post.imageCritiqueScore >= 5
                      ? 'bg-amber-500/20 border-amber-400/30 text-amber-300'
                      : 'bg-rose-500/25 border-rose-400/40 text-rose-200'
                  }`}
                  title={post.imageCritiqueReasoning || 'AI quality check'}
                >
                  {post.imageCritiqueScore >= 5
                    ? <ShieldCheck size={11} />
                    : <ShieldAlert size={11} />}
                  AI {post.imageCritiqueScore}/10
                </div>
              )}
              <div className="absolute top-2 right-2 flex gap-1.5">
                {post.imagePrompt && hasApiKey && (
                  <button
                    onClick={() => onRegenImage(post.id, post.imagePrompt!)}
                    className="bg-black/60 hover:bg-black/80 border border-white/15 text-white/70 p-1.5 rounded-lg transition backdrop-blur"
                    title="Regenerate image"
                  >
                    <RefreshCw size={12} />
                  </button>
                )}
                <button
                  onClick={() => onUpload(post.id)}
                  className="bg-black/60 hover:bg-black/80 border border-white/15 text-white/70 p-1.5 rounded-lg transition backdrop-blur"
                  title="Upload image"
                >
                  <Upload size={12} />
                </button>
              </div>
            </div>
          ) : isGeneratingImage ? (
            <div className="w-full h-32 bg-black/30 flex items-center justify-center gap-2 border-b border-white/[0.06]">
              <Loader2 size={16} className="animate-spin text-amber-400" />
              <span className="text-xs text-amber-400/70">Generating image…</span>
            </div>
          ) : (
            <div className="w-full h-24 bg-black/20 flex items-center justify-center gap-3 border-b border-white/[0.06]">
              <ImageIcon size={16} className="text-white/15" />
              <div className="flex gap-2">
                {post.imagePrompt && hasApiKey && (
                  <button
                    onClick={() => onRegenImage(post.id, post.imagePrompt!)}
                    className="text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 px-3 py-1.5 rounded-lg transition border border-amber-500/20"
                  >
                    Generate AI Image
                  </button>
                )}
                <button
                  onClick={() => onUpload(post.id)}
                  className="text-xs bg-white/6 hover:bg-white/10 text-white/40 px-3 py-1.5 rounded-lg transition border border-white/10"
                >
                  Upload Image
                </button>
              </div>
            </div>
          )
          )}

          <div className="p-6 space-y-4">
            {/* ── Schedule info ── */}
            <div className="flex items-center gap-4 text-xs text-white/35">
              <span className="flex items-center gap-1.5">
                <Calendar size={12} />
                {new Date(post.scheduledFor).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock size={12} />
                {new Date(post.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            <LearningSafetyReport
              decision={learningDecisions[0] ?? null}
              loading={isLoadingSafetyReport}
            />

            <ReachPlanRationale
              plan={reachPlans[0] ?? null}
              loading={isLoadingReachPlans}
              platform={post.platform}
            />

            {/* ── Virality Score (Tier 3 wow feature) ──
                 Pre-publish prediction trained on this workspace's own past
                 engagement. Only shows for editable posts; debounced 1.5s on
                 content edits. Insufficient-data state surfaces a hint to
                 connect FB instead of a fake score. */}
            {isScorable && (viralityScore || isScoringPost) && (
              <div className="mb-4">
                {isScoringPost && !viralityScore ? (
                  <div className="flex items-center gap-2 text-[11px] text-white/35 glass-card border border-white/[0.07] rounded-xl px-3 py-2">
                    <Loader2 size={11} className="animate-spin text-amber-400/60" />
                    Predicting engagement based on your past posts…
                  </div>
                ) : viralityScore?.data_status === 'insufficient' ? (
                  <div className="flex items-start gap-2 text-[11px] text-white/40 glass-card rounded-xl px-3 py-2.5 border border-white/[0.08]">
                    <Sparkles size={12} className="text-amber-400/50 shrink-0 mt-0.5" />
                    <span>{viralityScore.reasoning}</span>
                  </div>
                ) : viralityScore && (
                  <div className={`rounded-xl border ${tierColours[viralityScore.tier].border} ${tierColours[viralityScore.tier].bg} overflow-hidden`}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <TrendingUp size={20} className={tierColours[viralityScore.tier].text} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className={`text-2xl font-black ${tierColours[viralityScore.tier].text}`}>{viralityScore.score}</span>
                          <span className="text-[10px] text-white/40 uppercase tracking-widest font-bold">/ 100 · {viralityScore.tier}</span>
                          {isScoringPost && <Loader2 size={10} className="animate-spin text-white/30 ml-auto" />}
                        </div>
                        <p className="text-[11px] text-white/70 leading-snug mt-0.5">{viralityScore.reasoning}</p>
                      </div>
                    </div>
                    {viralityScore.suggestions.length > 0 && (
                      <ul className="border-t border-white/[0.05] px-4 py-2.5 space-y-1 bg-black/20">
                        {viralityScore.suggestions.map((s, i) => (
                          <li key={i} className="text-[11px] text-white/55 flex items-start gap-2 leading-snug">
                            <span className="text-amber-400/60 mt-0.5">→</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(viralityScore.workspace_p50 !== undefined && viralityScore.workspace_p95 !== undefined) && (
                      <p className="text-[10px] text-white/30 px-4 py-1.5 border-t border-white/[0.05] bg-black/20">
                        Trained on {viralityScore.historical_posts} past posts · your median engagement {viralityScore.workspace_p50.toFixed(0)}, top-tier ≥{viralityScore.workspace_p95.toFixed(0)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {post.status !== 'Posted' && (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/35">
                    <Flag size={11} /> Feedback
                  </span>
                  {qaFeedbackReason && (
                    <span className="text-[10px] font-bold text-rose-300 bg-rose-500/15 border border-rose-400/20 rounded-full px-2 py-0.5">
                      Marked
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => markFeedback('post', 'off_brand')}
                    disabled={isSendingFeedback}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${
                      qaFeedbackReason === 'off_brand'
                        ? 'bg-rose-500/20 border-rose-400/35 text-rose-200'
                        : 'bg-black/20 border-white/10 text-white/45 hover:text-white/70 hover:bg-white/[0.06]'
                    } disabled:opacity-50`}
                  >
                    <ShieldAlert size={11} /> Off-brand
                  </button>
                  <button
                    onClick={() => markFeedback('image', 'bad_image')}
                    disabled={isSendingFeedback}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${
                      qaFeedbackReason === 'bad_image'
                        ? 'bg-rose-500/20 border-rose-400/35 text-rose-200'
                        : 'bg-black/20 border-white/10 text-white/45 hover:text-white/70 hover:bg-white/[0.06]'
                    } disabled:opacity-50`}
                  >
                    <ImageIcon size={11} /> Bad image
                  </button>
                  <button
                    onClick={() => markFeedback('caption', 'bad_caption')}
                    disabled={isSendingFeedback}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${
                      qaFeedbackReason === 'bad_caption'
                        ? 'bg-rose-500/20 border-rose-400/35 text-rose-200'
                        : 'bg-black/20 border-white/10 text-white/45 hover:text-white/70 hover:bg-white/[0.06]'
                    } disabled:opacity-50`}
                  >
                    <Edit2 size={11} /> Bad caption
                  </button>
                </div>
              </div>
            )}

            {/* ── Content ── */}
            {isEditing ? (
              <div className="space-y-3">
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 focus:border-amber-500/40 rounded-xl p-4 text-white text-sm resize-none min-h-[140px] placeholder:text-white/20 focus:outline-none transition"
                  placeholder="Post caption…"
                />
                <div>
                  <label className="text-[11px] text-white/35 flex items-center gap-1 mb-1.5">
                    <Hash size={10} /> Hashtags (space-separated)
                  </label>
                  <input
                    value={editHashtags}
                    onChange={e => setEditHashtags(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 focus:border-amber-500/40 rounded-xl px-4 py-2.5 text-amber-300/80 text-xs focus:outline-none transition placeholder:text-white/20"
                    placeholder="#hashtag1 #hashtag2 …"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-white/35 flex items-center gap-1 mb-1.5">
                    <Calendar size={10} /> Scheduled for
                  </label>
                  <input
                    type="datetime-local"
                    value={editDate}
                    onChange={e => setEditDate(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 focus:border-amber-500/40 rounded-xl px-4 py-2.5 text-white text-xs focus:outline-none transition"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-black font-bold px-4 py-2 rounded-xl text-sm transition"
                  >
                    {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {isSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button
                    onClick={() => { setIsEditing(false); setEditContent(post.content); setEditHashtags((post.hashtags || []).join(' ')); }}
                    className="text-white/40 hover:text-white/70 hover:bg-white/[0.05] px-4 py-2 rounded-xl text-sm transition-all press"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-white/75 leading-relaxed whitespace-pre-wrap">{post.content}</p>
                {post.hashtags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {post.hashtags.map((t, i) => (
                      <span key={i} className="text-[11px] bg-amber-500/10 text-amber-300/70 px-2 py-0.5 rounded-full border border-amber-500/15">
                        {t.startsWith('#') ? t : `#${t}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/[0.06] bg-[var(--color-surface-0)]/40 backdrop-blur-sm">
          <div className="flex gap-2">
            {/* Publish */}
            {fbConnected && post.status !== 'Posted' && (
              <button
                onClick={handlePublish}
                disabled={isPublishing || isEditing}
                className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90 disabled:opacity-60 text-white font-bold px-4 py-2.5 rounded-xl text-sm transition shadow-lg shadow-blue-900/20 press"
              >
                {isPublishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {isPublishing ? 'Publishing…' : 'Publish Now'}
              </button>
            )}
            {post.status === 'Posted' && (
              <span className="flex items-center gap-1.5 text-xs text-green-400 px-3 py-2.5">
                <CheckCircle size={13} /> Published
              </span>
            )}
            {/* Edit */}
            {!isEditing && post.status !== 'Posted' && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 bg-white/6 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition press"
              >
                <Edit2 size={13} /> Edit
              </button>
            )}
          </div>
          {/* Delete */}
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="flex items-center gap-1.5 text-white/20 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 px-3 py-2.5 rounded-xl text-xs transition-all press"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
};
