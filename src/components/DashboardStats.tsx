import React, { useState, useRef, useEffect } from 'react';
import {
  Calendar, TrendingUp, Users, CheckCircle, Clock, Brain,
  Facebook, Instagram, X, Info, AlertTriangle, Zap, Target,
  BarChart3, MessageSquare, Eye, Heart, ArrowRight, ChevronRight,
} from 'lucide-react';
import { SocialPost, ContentCalendarStats } from '../types';

interface LiveFbStats {
  fanCount: number;
  followersCount: number;
  reach28d: number;
  engagedUsers28d: number;
  engagementRate: number;
}

interface Props {
  posts: SocialPost[];
  stats: ContentCalendarStats;
  liveStats: LiveFbStats | null;
  hasApiKey: boolean;
  fbConnected: boolean;
  activePlan: string | null;
  planName: string | undefined;
  lastPulled: Date | null;
  onGoToSettings: () => void;
}

type CardId = 'posts' | 'next' | 'engagement' | 'status';

const Popover: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute top-full mt-2 left-0 z-50 w-72 bg-[#13131f] border border-white/12 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden animate-in"
      style={{ animation: 'fadeSlideDown 0.15s ease-out' }}
    >
      {children}
    </div>
  );
};

export const DashboardStats: React.FC<Props> = ({
  posts, stats, liveStats, hasApiKey, fbConnected,
  activePlan, planName, lastPulled, onGoToSettings,
}) => {
  const [open, setOpen] = useState<CardId | null>(null);
  const toggle = (id: CardId) => setOpen(o => o === id ? null : id);

  const now = new Date();
  const upcomingPosts = posts
    .filter(p => new Date(p.scheduledFor) > now)
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
  const nextPost = upcomingPosts[0];
  const publishedPosts = posts.filter(p => p.status === 'Posted');
  const draftPosts = posts.filter(p => p.status === 'Draft');
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const thisWeekPosts = upcomingPosts.filter(p => new Date(p.scheduledFor) <= weekFromNow);
  const fbPosts = upcomingPosts.filter(p => p.platform === 'Facebook').length;
  const igPosts = upcomingPosts.filter(p => p.platform === 'Instagram').length;

  const engagementStatus = stats.engagement >= 5 ? 'excellent' : stats.engagement >= 3 ? 'good' : stats.engagement >= 1 ? 'average' : 'low';
  const engagementColor = engagementStatus === 'excellent' ? 'text-emerald-400' : engagementStatus === 'good' ? 'text-amber-400' : engagementStatus === 'average' ? 'text-orange-400' : 'text-red-400';
  const engagementBg = engagementStatus === 'excellent' ? 'bg-emerald-500/10 border-emerald-500/20' : engagementStatus === 'good' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-orange-500/10 border-orange-500/20';

  const activeCount = [hasApiKey, fbConnected].filter(Boolean).length;
  const statusColor = activeCount === 2 ? 'text-emerald-400' : activeCount === 1 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

      {/* ── Card 1: Scheduled Posts ── */}
      <div className="relative">
        <button
          onClick={() => toggle('posts')}
          className={`w-full text-left bg-white/3 border rounded-2xl p-4 transition hover:bg-white/5 group ${open === 'posts' ? 'border-amber-500/40 bg-white/5' : 'border-white/8 hover:border-white/15'}`}
        >
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-white/30">Scheduled Posts</p>
            <Info size={11} className="text-white/15 group-hover:text-white/40 transition" />
          </div>
          <p className="text-3xl font-black text-white">{upcomingPosts.length}</p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-white/25">{publishedPosts.length} published all-time</p>
            {draftPosts.length > 0 && (
              <span className="text-[10px] bg-white/8 text-white/35 px-1.5 py-0.5 rounded-full">{draftPosts.length} draft</span>
            )}
          </div>
          {/* Mini progress bar — posts this week */}
          {upcomingPosts.length > 0 && (
            <div className="mt-2.5">
              <div className="flex justify-between text-[10px] text-white/20 mb-1">
                <span>{thisWeekPosts.length} this week</span>
                <span>FB {fbPosts} · IG {igPosts}</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
                  style={{ width: `${Math.min(100, (thisWeekPosts.length / 7) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </button>

        {open === 'posts' && (
          <Popover onClose={() => setOpen(null)}>
            <div className="p-4 border-b border-white/8 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-amber-400" />
                <p className="text-sm font-black text-white">Post Queue</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-white/20 hover:text-white"><X size={13} /></button>
            </div>
            <div className="p-4 space-y-3">
              {/* Stat breakdown */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Upcoming', value: upcomingPosts.length, color: 'text-amber-400' },
                  { label: 'Published', value: publishedPosts.length, color: 'text-emerald-400' },
                  { label: 'Drafts', value: draftPosts.length, color: 'text-white/50' },
                ].map(s => (
                  <div key={s.label} className="bg-white/4 border border-white/8 rounded-xl p-2.5 text-center">
                    <p className={`text-lg font-black ${s.color}`}>{s.value}</p>
                    <p className="text-[9px] text-white/30 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Platform split */}
              {upcomingPosts.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-wide">Platform split</p>
                  <div className="flex items-center gap-2">
                    <Facebook size={12} className="text-blue-400 flex-shrink-0" />
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${upcomingPosts.length > 0 ? (fbPosts / upcomingPosts.length) * 100 : 0}%` }} />
                    </div>
                    <span className="text-[10px] text-white/30 w-6 text-right">{fbPosts}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Instagram size={12} className="text-pink-400 flex-shrink-0" />
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-pink-500 rounded-full" style={{ width: `${upcomingPosts.length > 0 ? (igPosts / upcomingPosts.length) * 100 : 0}%` }} />
                    </div>
                    <span className="text-[10px] text-white/30 w-6 text-right">{igPosts}</span>
                  </div>
                </div>
              )}

              {/* Next 3 posts */}
              {upcomingPosts.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-wide">Coming up</p>
                  {upcomingPosts.slice(0, 3).map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {p.platform === 'Instagram' ? <Instagram size={10} className="text-pink-400 flex-shrink-0" /> : <Facebook size={10} className="text-blue-400 flex-shrink-0" />}
                      <span className="text-white/50 truncate flex-1">{p.topic || p.content.substring(0, 30)}…</span>
                      <span className="text-white/25 flex-shrink-0">{new Date(p.scheduledFor).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-amber-500/8 border border-amber-500/15 rounded-xl px-3 py-2 text-[11px] text-amber-300/70 leading-relaxed">
                💡 <strong>Tip:</strong> Aim for 5–7 posts per week across both platforms for consistent growth. Use Smart AI to fill your week in one click.
              </div>
            </div>
          </Popover>
        )}
      </div>

      {/* ── Card 2: Next Post ── */}
      <div className="relative">
        <button
          onClick={() => toggle('next')}
          className={`w-full text-left bg-white/3 border rounded-2xl p-4 transition hover:bg-white/5 group ${open === 'next' ? 'border-purple-500/40 bg-white/5' : 'border-white/8 hover:border-white/15'}`}
        >
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-white/30">Next Post</p>
            <Info size={11} className="text-white/15 group-hover:text-white/40 transition" />
          </div>
          {nextPost ? (
            <>
              <p className="text-sm font-black text-amber-400 leading-tight">
                {new Date(nextPost.scheduledFor).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
              </p>
              <p className="text-xs text-white/35 mt-1 flex items-center gap-1">
                <Clock size={9} />
                {new Date(nextPost.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {nextPost.platform}
              </p>
              <p className="text-[11px] text-white/25 mt-2 line-clamp-2 leading-relaxed">
                {nextPost.content.substring(0, 60)}…
              </p>
            </>
          ) : (
            <div className="mt-1">
              <p className="text-sm text-white/20">Nothing scheduled yet</p>
              <p className="text-[11px] text-white/15 mt-1.5">Use Smart AI to generate posts</p>
            </div>
          )}
        </button>

        {open === 'next' && (
          <Popover onClose={() => setOpen(null)}>
            <div className="p-4 border-b border-white/8 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-purple-400" />
                <p className="text-sm font-black text-white">Next Scheduled Post</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-white/20 hover:text-white"><X size={13} /></button>
            </div>
            {nextPost ? (
              <div className="p-4 space-y-3">
                {/* Platform + time */}
                <div className="flex items-center gap-2">
                  {nextPost.platform === 'Instagram'
                    ? <Instagram size={16} className="text-pink-400" />
                    : <Facebook size={16} className="text-blue-400" />}
                  <div>
                    <p className="text-sm font-black text-white">
                      {new Date(nextPost.scheduledFor).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                    <p className="text-xs text-white/40">
                      {new Date(nextPost.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {nextPost.platform}
                    </p>
                  </div>
                  <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${nextPost.status === 'Scheduled' ? 'bg-amber-500/15 text-amber-400' : 'bg-white/8 text-white/30'}`}>
                    {nextPost.status}
                  </span>
                </div>

                {/* Content preview */}
                <div className="bg-white/4 border border-white/8 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-white/70 leading-relaxed">{nextPost.content}</p>
                  {nextPost.hashtags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1 border-t border-white/5">
                      {nextPost.hashtags.slice(0, 5).map((h, i) => (
                        <span key={i} className="text-[10px] text-amber-400/60">{h.startsWith('#') ? h : `#${h}`}</span>
                      ))}
                      {nextPost.hashtags.length > 5 && <span className="text-[10px] text-white/20">+{nextPost.hashtags.length - 5} more</span>}
                    </div>
                  )}
                </div>

                {/* Countdown */}
                <div className="bg-purple-500/8 border border-purple-500/15 rounded-xl px-3 py-2 flex items-center gap-2">
                  <Zap size={12} className="text-purple-400" />
                  <span className="text-[11px] text-purple-300/70">
                    {(() => {
                      const diff = new Date(nextPost.scheduledFor).getTime() - now.getTime();
                      const hrs = Math.floor(diff / 3600000);
                      const days = Math.floor(hrs / 24);
                      return days > 0 ? `Goes live in ${days}d ${hrs % 24}h` : hrs > 0 ? `Goes live in ${hrs}h` : 'Going live soon';
                    })()}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <p className="text-sm text-white/40">No posts are scheduled yet.</p>
                <div className="bg-amber-500/8 border border-amber-500/15 rounded-xl px-3 py-2 text-[11px] text-amber-300/70">
                  💡 Go to the <strong>Smart AI</strong> tab and click <strong>Generate My Content Calendar</strong> to create a full week of posts automatically.
                </div>
              </div>
            )}
          </Popover>
        )}
      </div>

      {/* ── Card 3: Engagement Rate ── */}
      <div className="relative">
        <button
          onClick={() => toggle('engagement')}
          className={`w-full text-left bg-white/3 border rounded-2xl p-4 transition hover:bg-white/5 group ${open === 'engagement' ? 'border-emerald-500/40 bg-white/5' : 'border-white/8 hover:border-white/15'}`}
        >
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-white/30">Engagement Rate</p>
            <Info size={11} className="text-white/15 group-hover:text-white/40 transition" />
          </div>
          <p className="text-3xl font-black text-white">
            {liveStats ? liveStats.engagementRate : stats.engagement}
            <span className="text-lg text-white/40">%</span>
          </p>
          <div className="mt-1 flex items-center justify-between">
            <p className="text-xs text-white/25">
              {(liveStats?.followersCount ?? stats.followers).toLocaleString()} followers
            </p>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${engagementBg} ${engagementColor}`}>
              {engagementStatus}
            </span>
          </div>
          {liveStats && (
            <div className="mt-2 flex gap-3 text-[10px] text-white/25">
              <span><Eye size={9} className="inline mr-0.5" />{liveStats.reach28d.toLocaleString()} reach</span>
              <span><Heart size={9} className="inline mr-0.5" />{liveStats.engagedUsers28d.toLocaleString()} engaged</span>
            </div>
          )}
        </button>

        {open === 'engagement' && (
          <Popover onClose={() => setOpen(null)}>
            <div className="p-4 border-b border-white/8 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp size={14} className="text-emerald-400" />
                <p className="text-sm font-black text-white">Engagement Breakdown</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-white/20 hover:text-white"><X size={13} /></button>
            </div>
            <div className="p-4 space-y-3">
              {/* Key metrics */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Engagement Rate', value: `${liveStats ? liveStats.engagementRate : stats.engagement}%`, color: engagementColor, icon: Target },
                  { label: 'Followers', value: (liveStats?.followersCount ?? stats.followers).toLocaleString(), color: 'text-blue-400', icon: Users },
                  ...(liveStats ? [
                    { label: '28d Reach', value: liveStats.reach28d.toLocaleString(), color: 'text-purple-400', icon: Eye },
                    { label: 'Engaged Users', value: liveStats.engagedUsers28d.toLocaleString(), color: 'text-pink-400', icon: Heart },
                  ] : [
                    { label: 'Est. Reach', value: stats.reach.toLocaleString(), color: 'text-purple-400', icon: Eye },
                    { label: 'Posts (30d)', value: String(stats.postsLast30Days), color: 'text-amber-400', icon: BarChart3 },
                  ]),
                ].map(s => (
                  <div key={s.label} className="bg-white/4 border border-white/8 rounded-xl p-2.5">
                    <div className="flex items-center gap-1 mb-1">
                      <s.icon size={10} className={s.color} />
                      <p className="text-[9px] text-white/30">{s.label}</p>
                    </div>
                    <p className={`text-base font-black ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Industry benchmark */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-wide">Industry benchmarks</p>
                {[
                  { label: 'Low', range: '< 1%', active: stats.engagement < 1 },
                  { label: 'Average', range: '1–3%', active: stats.engagement >= 1 && stats.engagement < 3 },
                  { label: 'Good', range: '3–5%', active: stats.engagement >= 3 && stats.engagement < 5 },
                  { label: 'Excellent', range: '5%+', active: stats.engagement >= 5 },
                ].map(b => (
                  <div key={b.label} className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg ${b.active ? 'bg-emerald-500/15 border border-emerald-500/25' : 'bg-white/3'}`}>
                    <span className={b.active ? 'text-emerald-300 font-bold' : 'text-white/30'}>{b.label}</span>
                    <span className={b.active ? 'text-emerald-400 font-black' : 'text-white/20'}>{b.range}</span>
                    {b.active && <CheckCircle size={11} className="text-emerald-400" />}
                  </div>
                ))}
              </div>

              <div className="bg-blue-500/8 border border-blue-500/15 rounded-xl px-3 py-2 text-[11px] text-blue-300/70 leading-relaxed">
                💡 <strong>What is engagement rate?</strong> It measures the % of people who interact with your content (likes, comments, shares) out of everyone who saw it. Higher = more relevant content.
              </div>

              {lastPulled && (
                <p className="text-[10px] text-white/20 text-center">Live data · Updated {lastPulled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              )}
            </div>
          </Popover>
        )}
      </div>

      {/* ── Card 4: Status ── */}
      <div className="relative">
        <button
          onClick={() => toggle('status')}
          className={`w-full text-left bg-white/3 border rounded-2xl p-4 transition hover:bg-white/5 group ${open === 'status' ? 'border-blue-500/40 bg-white/5' : 'border-white/8 hover:border-white/15'}`}
        >
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-white/30">Status</p>
            <Info size={11} className="text-white/15 group-hover:text-white/40 transition" />
          </div>
          <div className="space-y-1.5 mt-1">
            <div className={`flex items-center gap-1.5 text-xs font-semibold ${hasApiKey ? 'text-green-400' : 'text-red-400/80'}`}>
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasApiKey ? 'bg-green-400 animate-pulse' : 'bg-red-400/80'}`} />
              {hasApiKey ? 'AI Active' : 'No API Key'}
            </div>
            <div className={`flex items-center gap-1.5 text-xs font-semibold ${fbConnected ? 'text-blue-400' : 'text-white/25'}`}>
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${fbConnected ? 'bg-blue-400' : 'bg-white/15'}`} />
              {fbConnected ? 'Facebook Connected' : 'Facebook Not Connected'}
            </div>
            {planName && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400/70 mt-0.5">
                <Zap size={9} className="flex-shrink-0" />
                {planName} Plan
              </div>
            )}
          </div>
          <div className={`mt-2.5 text-[10px] font-bold ${statusColor}`}>
            {activeCount === 2 ? '✓ All systems go' : activeCount === 1 ? '⚠ Setup incomplete' : '✗ Action needed'}
          </div>
        </button>

        {open === 'status' && (
          <Popover onClose={() => setOpen(null)}>
            <div className="p-4 border-b border-white/8 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle size={14} className="text-blue-400" />
                <p className="text-sm font-black text-white">System Status</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-white/20 hover:text-white"><X size={13} /></button>
            </div>
            <div className="p-4 space-y-2.5">
              {/* AI Key status */}
              <div className={`flex items-start gap-3 p-3 rounded-xl border ${hasApiKey ? 'bg-emerald-500/8 border-emerald-500/20' : 'bg-red-500/8 border-red-500/20'}`}>
                <Brain size={15} className={hasApiKey ? 'text-emerald-400 mt-0.5 flex-shrink-0' : 'text-red-400 mt-0.5 flex-shrink-0'} />
                <div>
                  <p className={`text-xs font-black ${hasApiKey ? 'text-emerald-300' : 'text-red-300'}`}>
                    Gemini AI — {hasApiKey ? 'Active' : 'Not configured'}
                  </p>
                  <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">
                    {hasApiKey
                      ? 'AI is generating captions, hashtags, and images for your posts.'
                      : 'Add your free Gemini API key in Settings to unlock AI content generation.'}
                  </p>
                  {!hasApiKey && (
                    <button onClick={onGoToSettings} className="mt-1.5 text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 font-bold transition">
                      Go to Settings <ArrowRight size={9} />
                    </button>
                  )}
                </div>
              </div>

              {/* Facebook status */}
              <div className={`flex items-start gap-3 p-3 rounded-xl border ${fbConnected ? 'bg-blue-500/8 border-blue-500/20' : 'bg-white/3 border-white/8'}`}>
                <Facebook size={15} className={fbConnected ? 'text-blue-400 mt-0.5 flex-shrink-0' : 'text-white/20 mt-0.5 flex-shrink-0'} />
                <div>
                  <p className={`text-xs font-black ${fbConnected ? 'text-blue-300' : 'text-white/30'}`}>
                    Facebook — {fbConnected ? 'Connected' : 'Not connected'}
                  </p>
                  <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">
                    {fbConnected
                      ? 'Your Facebook page is linked. Posts can be published and stats synced.'
                      : 'Connect your Facebook page in Settings to enable auto-publishing and pull live stats.'}
                  </p>
                  {!fbConnected && (
                    <button onClick={onGoToSettings} className="mt-1.5 text-[10px] text-white/40 hover:text-white flex items-center gap-1 font-bold transition">
                      Go to Settings <ArrowRight size={9} />
                    </button>
                  )}
                </div>
              </div>

              {/* Plan status */}
              {planName && (
                <div className="flex items-start gap-3 p-3 rounded-xl border bg-amber-500/8 border-amber-500/20">
                  <Zap size={15} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-black text-amber-300">{planName} Plan — Active</p>
                    <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">
                      Your subscription is active. Visit the Account panel to manage billing.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Popover>
        )}
      </div>

    </div>
  );
};
