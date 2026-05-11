import React, { useState } from 'react';
import {
  ChevronLeft, ChevronRight, Facebook, Instagram, Send, Trash2,
  RefreshCw, Upload, Loader2, Image as ImageIcon, Calendar, Wand2, Brain, X
} from 'lucide-react';
import { SocialPost } from '../types';
import { PostModal } from './PostModal';
import { AnimatedReelPreview } from './AnimatedReelPreview';

interface Props {
  posts: SocialPost[];
  calendarImages: Record<string, string>;
  calendarGenSet: Set<string>;
  fbConnected: boolean;
  hasApiKey: boolean;
  onDelete: (id: string) => void;
  onPublish: (post: SocialPost) => Promise<void>;
  onRetry?: (post: SocialPost) => Promise<void>;
  onSave: (id: string, updates: Partial<SocialPost>) => Promise<void>;
  onRegenImage: (postId: string, prompt: string) => void;
  onUpload: (postId: string) => void;
  onRetryReel?: (postId: string) => Promise<void>;
  onGoCreate: () => void;
  onGoSmart: () => void;
  onGoSettings?: () => void;
  toast?: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

// Token issues need a reconnect, not a retry — the FB page connection is broken
// and clicking Retry will just fail again. Detect from the persisted reason and
// swap the affordance.
function isTokenReason(reason: string | undefined): boolean {
  if (!reason) return false;
  return /token|expired|reconnect|permission|forbidden|page not found|connect facebook|manage_pages|no facebook page connected/i.test(reason);
}

// posts.reasoning is dual-use: the cron writes a failure sentence on Missed,
// but Smart Schedule writes its scheduling rationale ("Posted at 09:00 on
// Tuesday — researched peak engagement…") at create-time, and that rationale
// is still in the column on a Missed post created BEFORE the cron started
// overwriting it. Showing "Why: Posted at 09:00 on Tuesday…" on a Missed post
// is gibberish. Recognise actual failure phrasings; suppress the rest.
function looksLikeFailureReason(reason: string | undefined): boolean {
  if (!reason) return false;
  return /token|expired|connected|reconnect|permission|forbidden|page not found|connect facebook|manage_pages|rate limit|failed|denied|fb api|image upload|could not publish/i.test(reason);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export const CalendarGrid: React.FC<Props> = ({
  posts, calendarImages, calendarGenSet, fbConnected, hasApiKey,
  onDelete, onPublish, onRetry, onSave, onRegenImage, onUpload, onRetryReel, onGoCreate, onGoSmart, onGoSettings, toast: toastFn,
}) => {
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<Date | null>(today);
  const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // Build 6-row × 7-col grid
  const cells: { date: Date; isCurrentMonth: boolean }[] = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push({ date: new Date(year, month - 1, daysInPrevMonth - firstDay + i + 1), isCurrentMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), isCurrentMonth: true });
  }
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ date: new Date(year, month + 1, d), isCurrentMonth: false });
  }

  const postsForDay = (date: Date) =>
    posts.filter(p => isSameDay(new Date(p.scheduledFor), date))
      .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());

  const selectedPosts = selectedDay ? postsForDay(selectedDay) : [];

  const handlePublish = async (post: SocialPost) => {
    setPublishingId(post.id);
    await onPublish(post);
    setPublishingId(null);
  };

  return (
    <div className="space-y-4">
      {/* ── Month navigation ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setViewDate(new Date(year, month - 1, 1))}
            aria-label="Previous month"
            className="w-11 h-11 sm:w-9 sm:h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 border border-white/8 transition text-white/50 hover:text-white"
          >
            <ChevronLeft size={16} />
          </button>
          <h2 className="text-base sm:text-xl font-bold text-white min-w-[120px] sm:min-w-[180px]">
            {MONTHS[month]} <span className="text-white/40 font-normal">{year}</span>
          </h2>
          <button
            onClick={() => setViewDate(new Date(year, month + 1, 1))}
            aria-label="Next month"
            className="w-11 h-11 sm:w-9 sm:h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 border border-white/8 transition text-white/50 hover:text-white"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          onClick={() => { setViewDate(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDay(today); }}
          className="text-xs font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 px-3 py-1.5 rounded-xl transition"
        >
          Today
        </button>
      </div>

      {/* ── Grid ─────────────────────────────────────────────────────────── */}
      <div className="glass noise rounded-2xl overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-white/[0.06]">
          {DAYS.map(d => (
            <div key={d} className="py-2.5 text-center text-[11px] font-bold text-white/30 uppercase tracking-wider">
              {d}
            </div>
          ))}
        </div>

        {/* Weeks */}
        <div className="grid grid-cols-7">
          {cells.map(({ date, isCurrentMonth }, idx) => {
            const dayPosts = postsForDay(date);
            const isToday = isSameDay(date, today);
            const isSelected = selectedDay ? isSameDay(date, selectedDay) : false;
            const fbPosts = dayPosts.filter(p => p.platform === 'Facebook');
            const igPosts = dayPosts.filter(p => p.platform === 'Instagram');
            const postedCount = dayPosts.filter(p => p.status === 'Posted').length;

            return (
              <button
                key={idx}
                onClick={() => setSelectedDay(date)}
                className={`min-h-[64px] sm:min-h-[80px] p-1 sm:p-2 text-left border-b border-r border-white/5 transition relative
                  ${idx % 7 === 6 ? 'border-r-0' : ''}
                  ${idx >= 35 ? 'border-b-0' : ''}
                  ${isSelected ? 'bg-amber-500/8 border-amber-500/20 shadow-[inset_0_0_30px_rgba(245,158,11,0.05)]' : isCurrentMonth ? 'hover:bg-white/[0.04] hover:shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]' : 'hover:bg-white/2'}
                `}
              >
                {/* Date number */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-[13px] font-bold w-6 h-6 flex items-center justify-center rounded-full
                    ${isToday ? 'bg-amber-500 text-black' : isCurrentMonth ? 'text-white/70' : 'text-white/20'}
                  `}>
                    {date.getDate()}
                  </span>
                  {postedCount > 0 && (
                    <span className="text-[9px] text-green-400/60">✓{postedCount}</span>
                  )}
                </div>

                {/* Post pills — click to open post directly */}
                <div className="space-y-0.5">
                  {fbPosts.slice(0, 2).map(p => (
                    <div key={p.id}
                      onClick={(e) => { e.stopPropagation(); setSelectedDay(date); setSelectedPost(p); }}
                      className={`text-[10px] px-1.5 py-0.5 rounded-md truncate font-medium cursor-pointer hover:ring-1 hover:ring-white/20 transition
                      ${p.status === 'Posted' ? 'bg-green-500/20 text-green-300' : p.status === 'Missed' ? 'bg-red-500/20 text-red-300' : 'bg-blue-500/20 text-blue-300'}
                    `}>
                      <Facebook size={8} className="inline mr-0.5" />
                      {new Date(p.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  ))}
                  {igPosts.slice(0, 2).map(p => (
                    <div key={p.id}
                      onClick={(e) => { e.stopPropagation(); setSelectedDay(date); setSelectedPost(p); }}
                      className={`text-[10px] px-1.5 py-0.5 rounded-md truncate font-medium cursor-pointer hover:ring-1 hover:ring-white/20 transition
                      ${p.status === 'Posted' ? 'bg-green-500/20 text-green-300' : p.status === 'Missed' ? 'bg-red-500/20 text-red-300' : 'bg-pink-500/20 text-pink-300'}
                    `}>
                      <Instagram size={8} className="inline mr-0.5" />
                      {new Date(p.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  ))}
                  {dayPosts.length > 3 && (
                    <div className="text-[9px] text-white/30 pl-1">+{dayPosts.length - 3} more</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-1">
        <div className="flex items-center gap-1.5 text-[11px] text-white/30">
          <div className="w-2.5 h-2.5 rounded bg-blue-500/40" /> Facebook
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-white/30">
          <div className="w-2.5 h-2.5 rounded bg-pink-500/40" /> Instagram
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-white/30">
          <div className="w-2.5 h-2.5 rounded bg-green-500/40" /> Published
        </div>
      </div>

      {/* ── Selected Day Panel ───────────────────────────────────────────── */}
      {selectedDay && (
        <div className="glass rounded-2xl overflow-hidden animate-fadeSlideUp">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
            <div>
              <p className="font-bold text-white text-sm">
                {selectedDay.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
                {isToday(selectedDay) && <span className="ml-2 text-[10px] text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-full">Today</span>}
              </p>
              <p className="text-xs text-white/30 mt-0.5">{selectedPosts.length} post{selectedPosts.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              {selectedPosts.length > 1 && (
                <button
                  onClick={() => {
                    if (!confirm(`Delete all ${selectedPosts.length} posts for this day?`)) return;
                    selectedPosts.forEach(p => onDelete(p.id));
                    toastFn?.(`${selectedPosts.length} posts deleted.`, 'success');
                  }}
                  className="text-red-400/60 hover:text-red-400 text-[10px] font-semibold flex items-center gap-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/15 px-2 py-1 rounded-lg transition"
                >
                  <Trash2 size={10} /> Delete All
                </button>
              )}
              <button onClick={() => setSelectedDay(null)} className="text-white/20 hover:text-white/50 transition">
                <X size={15} />
              </button>
            </div>
          </div>

          {selectedPosts.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-white/25 text-sm mb-3">No posts scheduled for this day</p>
              <div className="flex justify-center gap-2">
                <button onClick={onGoCreate} className="text-xs bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/20 text-amber-300 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5">
                  <Wand2 size={11} /> Create Post
                </button>
                <button onClick={onGoSmart} className="text-xs bg-white/5 hover:bg-white/8 border border-white/10 text-white/40 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5">
                  <Brain size={11} /> Smart AI
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {selectedPosts.map(post => (
                <button
                  key={post.id}
                  onClick={() => setSelectedPost(post)}
                  className="w-full flex gap-4 p-4 hover:bg-white/4 transition group text-left"
                >
                  {/* Thumbnail */}
                  {post.postType === 'video' ? (
                    <AnimatedReelPreview
                      imageUrl={calendarImages[post.id] || post.image}
                      hookText={post.videoScript?.split(/Hook:|Body:|CTA:/).find((s: string) => s.trim())?.replace(/^['"]/, '').trim() || post.content}
                      mood={post.videoMood}
                      size="sm"
                    />
                  ) : (
                  <div className="w-14 h-14 rounded-xl shrink-0 overflow-hidden bg-black/40 border border-white/8">
                    {calendarImages[post.id] || post.image ? (
                      <img src={calendarImages[post.id] || post.image} alt="" className="w-full h-full object-cover" />
                    ) : calendarGenSet.has(post.id) ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 size={14} className="animate-spin text-amber-400" />
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon size={14} className="text-white/15" />
                      </div>
                    )}
                  </div>
                  )}
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {post.platform === 'Instagram'
                        ? <Instagram size={11} className="text-pink-400" />
                        : <Facebook size={11} className="text-blue-400" />}
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                          post.status === 'Posted' ? 'bg-green-500/15 text-green-300' :
                          post.status === 'Missed' ? 'bg-red-500/20 text-red-300' :
                          post.status === 'Scheduled' ? 'bg-blue-500/15 text-blue-300' :
                          'bg-white/8 text-white/30'
                        }`}
                        title={post.status === 'Missed' && looksLikeFailureReason(post.reasoning) ? post.reasoning : undefined}
                      >{post.status === 'Missed' ? '⚠ Missed' : post.status}</span>
                      {/* Reel status pill — only on video posts. Shows where the
                          prewarm cron has the reel: pending → generating → ready,
                          or failed (in which case publish falls back to image). */}
                      {post.postType === 'video' && post.status !== 'Posted' && post.status !== 'Missed' && (
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                            post.videoStatus === 'ready'      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' :
                            post.videoStatus === 'generating' ? 'bg-amber-500/15 text-amber-300 border-amber-500/25' :
                            post.videoStatus === 'failed'     ? 'bg-red-500/15 text-red-300 border-red-500/25' :
                                                                'bg-purple-500/15 text-purple-300 border-purple-500/25'
                          }`}
                          title={post.videoError || (
                            post.videoStatus === 'ready' ? 'Reel ready to publish' :
                            post.videoStatus === 'generating' ? 'Reel generating now…' :
                            post.videoStatus === 'failed' ? 'Reel generation failed — will publish as image instead' :
                            'Reel queued — generates 45 min before scheduled time'
                          )}
                        >
                          {post.videoStatus === 'ready'      ? '🎬 Reel ready' :
                           post.videoStatus === 'generating' ? '🎬 Generating' :
                           post.videoStatus === 'failed'     ? '🎬 Failed' :
                                                               '🎬 Queued'}
                        </span>
                      )}
                      <span className="text-[11px] text-white/25">
                        {new Date(post.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-white/60 line-clamp-2 leading-relaxed">{post.content}</p>
                    {/* Surface the cron's failure reason inline so the user knows
                        WHY a post is Missed without opening the modal. The cron
                        writes a human sentence into post.reasoning on failure.
                        Suppress non-failure reasoning (Smart Schedule rationale)
                        — see looksLikeFailureReason for why. */}
                    {post.status === 'Missed' && looksLikeFailureReason(post.reasoning) && (
                      <p className="text-[10px] text-red-300/80 mt-1 leading-snug">
                        <span className="font-semibold text-red-300">Why: </span>{post.reasoning}
                      </p>
                    )}
                  </div>
                  {post.status === 'Missed' && isTokenReason(post.reasoning) && onGoSettings ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onGoSettings(); }}
                      className="shrink-0 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/25 text-amber-300 text-[10px] font-bold px-2 py-1 rounded-lg transition flex items-center gap-1"
                      title="Reconnect Facebook in Settings — token has expired or page is missing."
                    >
                      <Facebook size={10} /> Reconnect
                    </button>
                  ) : post.status === 'Missed' && onRetry && (
                    <button
                      onClick={async (e) => { e.stopPropagation(); setPublishingId(post.id); try { await onRetry(post); } finally { setPublishingId(null); } }}
                      disabled={publishingId === post.id}
                      className="shrink-0 bg-red-500/20 hover:bg-red-500/30 border border-red-500/25 text-red-300 text-[10px] font-bold px-2 py-1 rounded-lg transition flex items-center gap-1"
                    >
                      {publishingId === post.id ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Retry
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!confirm('Delete this post?')) return;
                      onDelete(post.id);
                      toastFn?.('Post deleted.', 'success');
                    }}
                    className="shrink-0 text-white/10 hover:text-red-400 transition p-1 rounded-lg hover:bg-red-500/10"
                    title="Delete post"
                  >
                    <Trash2 size={12} />
                  </button>
                  <div className="text-white/15 group-hover:text-white/35 transition shrink-0 self-center text-xs">›</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {posts.length === 0 && (
        <div className="text-center py-16 glass rounded-2xl">
          <div className="w-14 h-14 mx-auto mb-4 bg-white/5 rounded-2xl flex items-center justify-center">
            <Calendar size={24} className="text-white/20" />
          </div>
          <p className="text-white/30 font-semibold mb-1">Your calendar is empty</p>
          <p className="text-white/20 text-sm mb-5">Create a post manually, or use Smart AI to generate a full week.</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <button onClick={onGoCreate} className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/20 text-amber-300 px-5 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2">
              <Wand2 size={14} /> Create a Post
            </button>
            <button onClick={onGoSmart} className="bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 px-5 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2">
              <Brain size={14} /> Smart AI Scheduler
            </button>
          </div>
        </div>
      )}
      {/* ── Post Modal ───────────────────────────────────────────────────── */}
      {selectedPost && (
        <PostModal
          post={posts.find(p => p.id === selectedPost.id) || selectedPost}
          image={calendarImages[selectedPost.id]}
          isGeneratingImage={calendarGenSet.has(selectedPost.id)}
          fbConnected={fbConnected}
          hasApiKey={hasApiKey}
          onClose={() => setSelectedPost(null)}
          onPublish={async (post) => { await onPublish(post); setSelectedPost(null); }}
          onDelete={(id) => { onDelete(id); setSelectedPost(null); }}
          onSave={async (id, updates) => { await onSave(id, updates); setSelectedPost(prev => prev ? { ...prev, ...updates } : prev); }}
          onRegenImage={onRegenImage}
          onUpload={onUpload}
          onRetryReel={onRetryReel}
        />
      )}
    </div>
  );
};

function isToday(date: Date) {
  const t = new Date();
  return date.getFullYear() === t.getFullYear() && date.getMonth() === t.getMonth() && date.getDate() === t.getDate();
}
