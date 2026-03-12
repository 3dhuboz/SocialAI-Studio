import React, { useState } from 'react';
import {
  ChevronLeft, ChevronRight, Facebook, Instagram, Send, Trash2,
  RefreshCw, Upload, Loader2, Image as ImageIcon, Calendar, Wand2, Brain, X
} from 'lucide-react';
import { SocialPost } from '../types';

interface Props {
  posts: SocialPost[];
  calendarImages: Record<string, string>;
  calendarGenSet: Set<string>;
  fbConnected: boolean;
  hasApiKey: boolean;
  onDelete: (id: string) => void;
  onPublish: (post: SocialPost) => Promise<void>;
  onRegenImage: (postId: string, prompt: string) => void;
  onUpload: (postId: string) => void;
  onGoCreate: () => void;
  onGoSmart: () => void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export const CalendarGrid: React.FC<Props> = ({
  posts, calendarImages, calendarGenSet, fbConnected, hasApiKey,
  onDelete, onPublish, onRegenImage, onUpload, onGoCreate, onGoSmart,
}) => {
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<Date | null>(today);
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
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 border border-white/8 transition text-white/50 hover:text-white"
          >
            <ChevronLeft size={15} />
          </button>
          <h2 className="text-xl font-bold text-white min-w-[180px]">
            {MONTHS[month]} <span className="text-white/40 font-normal">{year}</span>
          </h2>
          <button
            onClick={() => setViewDate(new Date(year, month + 1, 1))}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 border border-white/8 transition text-white/50 hover:text-white"
          >
            <ChevronRight size={15} />
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
      <div className="bg-white/2 border border-white/8 rounded-2xl overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-white/8">
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
                className={`min-h-[80px] p-2 text-left border-b border-r border-white/5 transition relative
                  ${idx % 7 === 6 ? 'border-r-0' : ''}
                  ${idx >= 35 ? 'border-b-0' : ''}
                  ${isSelected ? 'bg-amber-500/8 border-amber-500/20' : isCurrentMonth ? 'hover:bg-white/3' : 'hover:bg-white/2'}
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

                {/* Post pills */}
                <div className="space-y-0.5">
                  {fbPosts.slice(0, 2).map(p => (
                    <div key={p.id} className={`text-[10px] px-1.5 py-0.5 rounded-md truncate font-medium
                      ${p.status === 'Posted' ? 'bg-green-500/20 text-green-300' : 'bg-blue-500/20 text-blue-300'}
                    `}>
                      <Facebook size={8} className="inline mr-0.5" />
                      {new Date(p.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  ))}
                  {igPosts.slice(0, 2).map(p => (
                    <div key={p.id} className={`text-[10px] px-1.5 py-0.5 rounded-md truncate font-medium
                      ${p.status === 'Posted' ? 'bg-green-500/20 text-green-300' : 'bg-pink-500/20 text-pink-300'}
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
        <div className="bg-white/2 border border-white/8 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/6">
            <div>
              <p className="font-bold text-white text-sm">
                {selectedDay.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
                {isToday(selectedDay) && <span className="ml-2 text-[10px] text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-full">Today</span>}
              </p>
              <p className="text-xs text-white/30 mt-0.5">{selectedPosts.length} post{selectedPosts.length !== 1 ? 's' : ''}</p>
            </div>
            <button onClick={() => setSelectedDay(null)} className="text-white/20 hover:text-white/50 transition">
              <X size={15} />
            </button>
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
                <div key={post.id} className="flex gap-4 p-4 hover:bg-white/2 transition group">
                  {/* Thumbnail */}
                  <div className="w-16 h-16 rounded-xl shrink-0 overflow-hidden bg-black/40 border border-white/8 relative group/img">
                    {calendarImages[post.id] || post.image ? (
                      <>
                        <img src={calendarImages[post.id] || post.image} alt="" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/55 opacity-0 group-hover/img:opacity-100 transition flex items-center justify-center gap-1">
                          {post.imagePrompt && (
                            <button onClick={() => onRegenImage(post.id, post.imagePrompt!)} title="Regenerate" className="bg-white/20 hover:bg-white/30 p-1 rounded-lg">
                              <RefreshCw size={10} className="text-white" />
                            </button>
                          )}
                          <button onClick={() => onUpload(post.id)} title="Upload" className="bg-white/20 hover:bg-white/30 p-1 rounded-lg">
                            <Upload size={10} className="text-white" />
                          </button>
                        </div>
                      </>
                    ) : calendarGenSet.has(post.id) ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 size={14} className="animate-spin text-amber-400" />
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                        <ImageIcon size={12} className="text-white/15" />
                        {post.imagePrompt && hasApiKey && (
                          <button onClick={() => onRegenImage(post.id, post.imagePrompt!)} className="text-[8px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full hover:bg-amber-500/30 transition">Gen</button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {post.platform === 'Instagram'
                        ? <Instagram size={11} className="text-pink-400" />
                        : <Facebook size={11} className="text-blue-400" />}
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        post.status === 'Posted' ? 'bg-green-500/15 text-green-300' :
                        post.status === 'Scheduled' ? 'bg-blue-500/15 text-blue-300' :
                        'bg-white/8 text-white/30'
                      }`}>{post.status}</span>
                      <span className="text-[11px] text-white/25">
                        {new Date(post.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {post.pillar && <span className="text-[9px] bg-purple-500/15 text-purple-300 px-1.5 py-0.5 rounded-full">{post.pillar}</span>}
                    </div>
                    <p className="text-xs text-white/60 line-clamp-2 leading-relaxed">{post.content}</p>
                    {post.hashtags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {post.hashtags.slice(0, 3).map((t, i) => <span key={i} className="text-[9px] text-amber-400/50">{t.startsWith('#') ? t : `#${t}`}</span>)}
                        {post.hashtags.length > 3 && <span className="text-[9px] text-white/20">+{post.hashtags.length - 3}</span>}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {fbConnected && post.status !== 'Posted' && (
                      <button
                        onClick={() => handlePublish(post)}
                        disabled={publishingId === post.id}
                        className="bg-blue-600/20 hover:bg-blue-600/40 disabled:opacity-50 text-blue-300 p-1.5 rounded-lg transition"
                        title="Publish now"
                      >
                        {publishingId === post.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <Send size={12} />}
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(post.id)}
                      className="text-white/15 hover:text-red-400 p-1.5 rounded-lg transition opacity-0 group-hover:opacity-100"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {posts.length === 0 && (
        <div className="text-center py-16 border border-white/5 rounded-2xl bg-white/2">
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
    </div>
  );
};

function isToday(date: Date) {
  const t = new Date();
  return date.getFullYear() === t.getFullYear() && date.getMonth() === t.getMonth() && date.getDate() === t.getDate();
}
