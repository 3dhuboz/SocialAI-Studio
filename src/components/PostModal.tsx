import React, { useEffect, useState } from 'react';
import {
  X, Facebook, Instagram, Send, Trash2, Save, Loader2,
  Calendar, Clock, Edit2, CheckCircle, Image as ImageIcon,
  RefreshCw, Upload, Hash, TrendingUp, Sparkles, ShieldCheck, ShieldAlert
} from 'lucide-react';
import { SocialPost } from '../types';
import { AnimatedReelPreview } from './AnimatedReelPreview';
import { useDb } from '../hooks/useDb';
import type { ViralityScore } from '../services/db';

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

export const PostModal: React.FC<Props> = ({
  post, image, isGeneratingImage, fbConnected, hasApiKey,
  onClose, onPublish, onDelete, onSave, onRegenImage, onUpload, onRetryReel,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [editHashtags, setEditHashtags] = useState((post.hashtags || []).join(' '));
  const [editDate, setEditDate] = useState(() => {
    const d = new Date(post.scheduledFor);
    return d.toISOString().slice(0, 16);
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const displayImage = image || post.image;

  const handleSave = async () => {
    setIsSaving(true);
    const tags = editHashtags.trim()
      ? editHashtags.trim().split(/\s+/).map(t => t.startsWith('#') ? t : `#${t}`)
      : [];
    await onSave(post.id, {
      content: editContent,
      hashtags: tags,
      scheduledFor: new Date(editDate).toISOString(),
    });
    setIsSaving(false);
    setIsEditing(false);
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    await onPublish(post);
    setIsPublishing(false);
    onClose();
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
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-lg" />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-[calc(100vw-1rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto bg-[var(--color-surface-1)] glass-card noise border-gradient rounded-3xl shadow-2xl shadow-black/60 animate-spring-in">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/6">
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
          <button onClick={onClose} className="text-white/25 hover:text-white/60 hover:bg-white/[0.06] transition-all rounded-lg p-1.5 press">
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
              <img src={displayImage} alt="" className="w-full max-h-56 object-cover" />
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
            <div className="w-full h-32 bg-black/30 flex items-center justify-center gap-2 border-b border-white/6">
              <Loader2 size={16} className="animate-spin text-amber-400" />
              <span className="text-xs text-amber-400/70">Generating image…</span>
            </div>
          ) : (
            <div className="w-full h-24 bg-black/20 flex items-center justify-center gap-3 border-b border-white/6">
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
                      <ul className="border-t border-white/5 px-4 py-2.5 space-y-1 bg-black/20">
                        {viralityScore.suggestions.map((s, i) => (
                          <li key={i} className="text-[11px] text-white/55 flex items-start gap-2 leading-snug">
                            <span className="text-amber-400/60 mt-0.5">→</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(viralityScore.workspace_p50 !== undefined && viralityScore.workspace_p95 !== undefined) && (
                      <p className="text-[10px] text-white/30 px-4 py-1.5 border-t border-white/5 bg-black/20">
                        Trained on {viralityScore.historical_posts} past posts · your median engagement {viralityScore.workspace_p50.toFixed(0)}, top-tier ≥{viralityScore.workspace_p95.toFixed(0)}
                      </p>
                    )}
                  </div>
                )}
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
