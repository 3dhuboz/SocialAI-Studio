import React, { useMemo } from 'react';
import {
  Calendar, Wand2, BarChart3, Settings, Clock, Users, TrendingUp,
  Sparkles, ArrowRight, CheckCircle, AlertCircle, Brain, Zap,
  Facebook, Instagram, Lightbulb, Target, Star, RefreshCw,
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
  planName?: string;
  businessName: string;
  onGoCalendar: () => void;
  onGoCreate: () => void;
  onGoSchedule: () => void;
  onGoInsights: () => void;
  onGoSettings: () => void;
}

const TIPS = [
  { icon: Clock,      color: 'text-amber-400',   bg: 'bg-amber-500/10  border-amber-500/20',  title: 'Best time to post', body: 'Facebook engagement peaks between 9–11am and 1–3pm on weekdays. Try scheduling your next post in that window.' },
  { icon: Target,     color: 'text-blue-400',    bg: 'bg-blue-500/10   border-blue-500/20',   title: 'Consistency wins', body: '3–5 posts per week outperforms daily posting for most small businesses. Quality and regularity beats volume.' },
  { icon: Brain,      color: 'text-purple-400',  bg: 'bg-purple-500/10 border-purple-500/20', title: 'Hook in the first line', body: 'Only the first 2 lines show before "See more". Make them count — ask a question, make a bold claim, or open a loop.' },
  { icon: Star,       color: 'text-green-400',   bg: 'bg-green-500/10  border-green-500/20',  title: 'Images drive reach', body: 'Posts with images get up to 3× more reach than text-only. Use the AI image generator on your next post.' },
  { icon: RefreshCw,  color: 'text-pink-400',    bg: 'bg-pink-500/10   border-pink-500/20',   title: 'Repurpose top content', body: 'Check Insights for your best-performing posts, then use Smart Schedule to create variations of what already works.' },
  { icon: Lightbulb,  color: 'text-amber-300',   bg: 'bg-amber-500/8   border-amber-500/15',  title: 'Use pillars', body: 'Rotate through 3–4 content pillars (e.g. Behind the scenes, Product spotlight, Tips, Customer stories) to keep your feed varied.' },
];

export const HomeDashboard: React.FC<Props> = ({
  posts, stats, liveStats, hasApiKey, fbConnected,
  activePlan, planName, businessName,
  onGoCalendar, onGoCreate, onGoSchedule, onGoInsights, onGoSettings,
}) => {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const upcomingPosts = useMemo(() =>
    posts.filter(p => p.status === 'Scheduled' && new Date(p.scheduledFor) > now)
         .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()),
    [posts]
  );
  const nextPost = upcomingPosts[0] ?? null;
  const missedPosts = posts.filter(p => p.status === 'Missed');
  const postedThisMonth = posts.filter(p => {
    const d = new Date(p.scheduledFor);
    return p.status === 'Posted' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  // Pick 3 tips, seeded by day so they rotate daily
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const tips = [0, 1, 2].map(i => TIPS[(dayOfYear + i) % TIPS.length]);

  const actionCards = [
    {
      id: 'calendar',
      icon: Calendar,
      label: 'Calendar',
      desc: 'View and manage all your scheduled posts',
      color: 'from-blue-600/30 to-blue-900/20',
      border: 'border-blue-500/25 hover:border-blue-500/50',
      iconBg: 'bg-blue-500/20 text-blue-400',
      badge: upcomingPosts.length > 0 ? `${upcomingPosts.length} scheduled` : null,
      badgeColor: 'bg-blue-500/15 text-blue-300',
      onClick: onGoCalendar,
    },
    {
      id: 'create',
      icon: Wand2,
      label: 'Create a Post',
      desc: 'Generate AI content for a single post now',
      color: 'from-amber-600/30 to-amber-900/20',
      border: 'border-amber-500/25 hover:border-amber-500/50',
      iconBg: 'bg-amber-500/20 text-amber-400',
      badge: !hasApiKey ? 'Setup needed' : null,
      badgeColor: 'bg-amber-500/15 text-amber-300',
      onClick: onGoCreate,
    },
    {
      id: 'schedule',
      icon: Sparkles,
      label: 'Smart Schedule',
      desc: 'Let AI plan and schedule a full week of content',
      color: 'from-purple-600/30 to-purple-900/20',
      border: 'border-purple-500/25 hover:border-purple-500/50',
      iconBg: 'bg-purple-500/20 text-purple-400',
      badge: 'AI Autopilot',
      badgeColor: 'bg-purple-500/15 text-purple-300',
      onClick: onGoSchedule,
    },
    {
      id: 'insights',
      icon: BarChart3,
      label: 'Insights',
      desc: 'Track reach, engagement and follower growth',
      color: 'from-green-600/30 to-green-900/20',
      border: 'border-green-500/25 hover:border-green-500/50',
      iconBg: 'bg-green-500/20 text-green-400',
      badge: liveStats ? `${liveStats.engagementRate}% engagement` : fbConnected ? 'Connected' : null,
      badgeColor: 'bg-green-500/15 text-green-300',
      onClick: onGoInsights,
    },
  ];

  return (
    <div className="space-y-8">

      {/* ── Hero Greeting ── */}
      <div className="relative rounded-3xl overflow-hidden border border-white/8 bg-gradient-to-br from-[#13131f] via-[#0d0d18] to-[#0a0a12] px-6 py-8 md:px-10 md:py-10">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-purple-500/5 pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div>
            <p className="text-white/35 text-sm mb-1">{greeting} 👋</p>
            <h1 className="text-2xl md:text-3xl font-black text-white leading-tight">
              {businessName || 'Welcome back'}
            </h1>
            <p className="text-white/40 text-sm mt-2 max-w-md">
              {upcomingPosts.length > 0
                ? `You have ${upcomingPosts.length} post${upcomingPosts.length > 1 ? 's' : ''} scheduled. ${nextPost ? `Next up ${new Date(nextPost.scheduledFor).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} at ${new Date(nextPost.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}`
                : "You have no posts scheduled. Use Smart Schedule to plan your week."
              }
            </p>
          </div>
          {/* Status pills */}
          <div className="flex flex-wrap gap-2 md:flex-col md:items-end">
            <span className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${fbConnected ? 'bg-green-500/10 border-green-500/25 text-green-400' : 'bg-white/5 border-white/10 text-white/30'}`}>
              <Facebook size={10} /> {fbConnected ? 'Facebook connected' : 'Facebook not connected'}
            </span>
            <span className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${hasApiKey ? 'bg-purple-500/10 border-purple-500/25 text-purple-400' : 'bg-white/5 border-white/10 text-white/30'}`}>
              <Brain size={10} /> {hasApiKey ? 'AI ready' : 'AI key needed'}
            </span>
            {activePlan && (
              <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border bg-amber-500/10 border-amber-500/25 text-amber-400">
                <Zap size={10} /> {planName ?? activePlan}
              </span>
            )}
          </div>
        </div>

        {/* Mini stat row */}
        <div className="relative mt-7 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Scheduled',      value: upcomingPosts.length,         icon: Clock,      color: 'text-blue-400' },
            { label: 'Posted this month', value: postedThisMonth,            icon: CheckCircle, color: 'text-green-400' },
            { label: 'Followers',      value: liveStats ? liveStats.followersCount.toLocaleString() : '—', icon: Users, color: 'text-purple-400' },
            { label: 'Engagement',     value: liveStats ? `${liveStats.engagementRate}%` : '—',          icon: TrendingUp, color: 'text-amber-400' },
          ].map(s => (
            <div key={s.label} className="bg-white/4 border border-white/8 rounded-2xl px-4 py-3 flex items-center gap-3">
              <s.icon size={16} className={s.color} />
              <div>
                <p className="text-white font-black text-lg leading-none">{s.value}</p>
                <p className="text-white/30 text-[11px] mt-0.5">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Missed posts alert */}
        {missedPosts.length > 0 && (
          <div className="relative mt-4 flex items-center gap-3 bg-red-500/10 border border-red-500/25 rounded-2xl px-4 py-3">
            <AlertCircle size={15} className="text-red-400 shrink-0" />
            <p className="text-sm text-red-300 flex-1">
              <span className="font-bold">{missedPosts.length} post{missedPosts.length > 1 ? 's' : ''} missed</span> — go to Calendar to retry them.
            </p>
            <button onClick={onGoCalendar} className="text-xs font-bold text-red-300 hover:text-white flex items-center gap-1 transition">
              View <ArrowRight size={11} />
            </button>
          </div>
        )}
      </div>

      {/* ── Action Cards ── */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-white/25 mb-4">What would you like to do?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {actionCards.map(card => (
            <button
              key={card.id}
              onClick={card.onClick}
              className={`group relative rounded-2xl border ${card.border} bg-gradient-to-br ${card.color} p-5 text-left transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-black/40 flex flex-col gap-4`}
            >
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-xl ${card.iconBg} flex items-center justify-center`}>
                  <card.icon size={18} />
                </div>
                {card.badge && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${card.badgeColor}`}>
                    {card.badge}
                  </span>
                )}
              </div>
              <div className="flex-1">
                <p className="font-black text-white text-base mb-1">{card.label}</p>
                <p className="text-white/40 text-xs leading-relaxed">{card.desc}</p>
              </div>
              <div className="flex items-center gap-1 text-white/30 group-hover:text-white/60 transition text-xs font-semibold">
                Open <ArrowRight size={12} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Next post preview + Tips side-by-side ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Next scheduled post */}
        <div className="lg:col-span-1 bg-[#0d0d18] border border-white/8 rounded-2xl p-5 flex flex-col">
          <p className="text-xs font-bold uppercase tracking-widest text-white/25 mb-4">Next scheduled post</p>
          {nextPost ? (
            <div className="flex-1 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                {nextPost.platform === 'Facebook'
                  ? <Facebook size={13} className="text-blue-400" />
                  : <Instagram size={13} className="text-pink-400" />}
                <span className="text-xs text-white/40">
                  {new Date(nextPost.scheduledFor).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' })}
                  {' · '}
                  {new Date(nextPost.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {nextPost.image && (
                <img src={nextPost.image} alt="" className="w-full h-28 object-cover rounded-xl opacity-80" />
              )}
              <p className="text-sm text-white/70 leading-relaxed line-clamp-4 flex-1">{nextPost.content}</p>
              <button
                onClick={onGoCalendar}
                className="mt-auto flex items-center gap-1.5 text-xs font-bold text-white/40 hover:text-white transition"
              >
                View in calendar <ArrowRight size={11} />
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-6 text-center">
              <Calendar size={28} className="text-white/15" />
              <p className="text-white/25 text-sm">No posts scheduled yet</p>
              <button
                onClick={onGoSchedule}
                className="text-xs font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition"
              >
                <Sparkles size={11} /> Use Smart Schedule
              </button>
            </div>
          )}
        </div>

        {/* Tips */}
        <div className="lg:col-span-2 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-white/25">Posting tips for today</p>
          {tips.map((tip, i) => (
            <div key={i} className={`flex gap-4 border ${tip.bg} rounded-2xl px-4 py-4`}>
              <div className={`w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center shrink-0`}>
                <tip.icon size={15} className={tip.color} />
              </div>
              <div>
                <p className={`text-sm font-bold mb-0.5 ${tip.color}`}>{tip.title}</p>
                <p className="text-xs text-white/45 leading-relaxed">{tip.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Setup nudge if not fully set up ── */}
      {(!hasApiKey || !fbConnected) && (
        <div className="bg-gradient-to-r from-amber-950/40 to-amber-900/20 border border-amber-500/20 rounded-2xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Settings size={16} className="text-amber-400 shrink-0" />
            <div>
              <p className="text-sm font-bold text-amber-300">Finish your setup</p>
              <p className="text-xs text-white/35 mt-0.5">
                {!hasApiKey && !fbConnected
                  ? 'Add your Gemini API key and connect Facebook to unlock AI generation and auto-publishing.'
                  : !hasApiKey
                  ? 'Add your Gemini API key in Settings to enable AI content generation.'
                  : 'Connect your Facebook page in Settings to enable auto-publishing.'}
              </p>
            </div>
          </div>
          <button
            onClick={onGoSettings}
            className="shrink-0 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 font-bold text-xs px-4 py-2 rounded-xl transition flex items-center gap-1.5"
          >
            Open Settings <ArrowRight size={12} />
          </button>
        </div>
      )}

    </div>
  );
};
