import React, { useEffect, useState, useCallback } from 'react';
import { Brain, Image, Video, RefreshCw, Zap, Activity, AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react';

const AI_WORKER = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';

interface OpenRouterStats {
  ok: boolean;
  label?: string | null;
  isFreeTier?: boolean;
  usage?: number | null;
  limit?: number | null;
  limitRemaining?: number | null;
  rateLimit?: { requests: number; interval: string } | null;
  totalCredits?: number | null;
  totalUsage?: number | null;
  model?: string;
  provider?: string;
  error?: string;
}

const AGENTS = [
  {
    name: 'Gemini 2.0 Flash',
    role: 'Text & Content Generation',
    detail: 'Posts, captions, hashtags, insights, smart scheduling',
    provider: 'OpenRouter',
    providerUrl: 'https://openrouter.ai',
    icon: Brain,
    gradient: 'from-blue-500 to-violet-600',
    glow: 'rgba(99,102,241,0.15)',
    border: 'border-violet-500/25',
    iconBg: 'bg-violet-500/15',
    badge: 'Text AI',
    badgeColor: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
  },
  {
    name: 'FLUX Schnell',
    role: 'AI Image Generation',
    detail: 'Marketing images, post visuals, thumbnails',
    provider: 'fal.ai',
    providerUrl: 'https://fal.ai',
    icon: Image,
    gradient: 'from-pink-500 to-rose-600',
    glow: 'rgba(244,63,94,0.15)',
    border: 'border-rose-500/25',
    iconBg: 'bg-rose-500/15',
    badge: 'Image AI',
    badgeColor: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
  },
  {
    name: 'Kling v1.6',
    role: 'AI Video Generation',
    detail: 'Short reels, image-to-video, social clips',
    provider: 'fal.ai',
    providerUrl: 'https://fal.ai',
    icon: Video,
    gradient: 'from-purple-500 to-indigo-600',
    glow: 'rgba(168,85,247,0.15)',
    border: 'border-purple-500/25',
    iconBg: 'bg-purple-500/15',
    badge: 'Video AI',
    badgeColor: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
  },
];

const fmt = (n: number | null | undefined, prefix = '$') => {
  if (n == null) return '—';
  return `${prefix}${n.toFixed(4)}`;
};

export const AiEnginePanel: React.FC<{ isSuperAdmin: boolean }> = ({ isSuperAdmin }) => {
  const [stats, setStats] = useState<OpenRouterStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [pulse, setPulse] = useState(false);

  const fetchStats = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    try {
      const res = await fetch(`${AI_WORKER}/api/ai/stats`);
      const data: OpenRouterStats = await res.json();
      setStats(data);
      setLastFetched(new Date());
      setPulse(true);
      setTimeout(() => setPulse(false), 800);
    } catch {
      setStats({ ok: false, error: 'Failed to reach OpenRouter' });
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const usedPct =
    stats?.usage != null && stats?.totalCredits != null && stats.totalCredits > 0
      ? Math.min(100, (stats.usage / stats.totalCredits) * 100)
      : null;

  return (
    <div className="space-y-4">

      {/* ── Agent Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {AGENTS.map((agent) => {
          const Icon = agent.icon;
          return (
            <div
              key={agent.name}
              className={`relative glass-card border ${agent.border} rounded-2xl p-4 overflow-hidden group card-hover transition-all duration-300`}
              style={{ boxShadow: `0 0 24px ${agent.glow}` }}
            >
              {/* Glow bg */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{ background: `radial-gradient(ellipse at 50% 0%, ${agent.glow} 0%, transparent 70%)` }}
              />

              <div className="relative">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-9 h-9 ${agent.iconBg} rounded-xl flex items-center justify-center`}>
                    <Icon size={16} className="text-white/80" />
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-[10px] text-green-400 font-semibold">Active</span>
                  </div>
                </div>

                {/* Name + badge */}
                <p className="text-sm font-black text-white leading-tight mb-0.5">{agent.name}</p>
                <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-xl border ${agent.badgeColor} mb-2`}>
                  {agent.badge}
                </span>

                {/* Role */}
                <p className="text-xs font-semibold text-white/60 leading-snug mb-1">{agent.role}</p>
                <p className="text-[11px] text-white/30 leading-snug">{agent.detail}</p>

                {/* Provider */}
                <a
                  href={agent.providerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center gap-1 text-[10px] text-white/25 hover:text-white/60 transition group/link"
                >
                  <span>via {agent.provider}</span>
                  <ExternalLink size={9} className="opacity-0 group-hover/link:opacity-100 transition" />
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Live OpenRouter Stats (super-admin only) ── */}
      {isSuperAdmin && (
        <div className="glass-card border border-white/[0.08] rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <div className={`w-2 h-2 rounded-full ${stats?.ok ? 'bg-green-400' : 'bg-red-400'} ${pulse ? 'scale-125' : ''} transition-transform`} />
              <p className="text-sm font-black text-white">OpenRouter Live Stats</p>
              {stats?.model && (
                <span className="text-[10px] font-mono text-white/25 bg-white/[0.05] px-2 py-0.5 rounded-lg">{stats.model}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {lastFetched && (
                <span className="text-[10px] text-white/20">
                  Updated {lastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
              <button
                onClick={fetchStats}
                disabled={loading}
                className="text-white/20 hover:text-white/60 transition disabled:opacity-40"
                title="Refresh"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {/* Stats grid */}
          {stats?.error ? (
            <div className="flex items-center gap-2 px-5 py-4 text-sm text-red-400">
              <AlertTriangle size={14} />
              <span>{stats.error}</span>
            </div>
          ) : loading && !stats ? (
            <div className="flex items-center gap-2 px-5 py-4 text-sm text-white/30">
              <RefreshCw size={13} className="animate-spin" />
              <span>Loading stats…</span>
            </div>
          ) : stats ? (
            <div className="p-5 space-y-5">
              {/* Key + status */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <CheckCircle size={12} className="text-green-400" />
                  <span className="text-xs font-semibold text-green-300">API Key Active</span>
                </div>
                {stats.label && (
                  <span className="text-[11px] text-white/30 bg-white/[0.05] px-2 py-0.5 rounded-lg font-mono">{stats.label}</span>
                )}
                {stats.isFreeTier && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25">
                    Free Tier
                  </span>
                )}
              </div>

              {/* Credit bar */}
              {stats.usage != null && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] text-white/40 font-semibold uppercase tracking-wider">Credits Used</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-white">{fmt(stats.usage)}</span>
                      {stats.totalCredits != null && (
                        <span className="text-[11px] text-white/30">/ {fmt(stats.totalCredits)} purchased</span>
                      )}
                    </div>
                  </div>
                  {usedPct != null && (
                    <div className="h-1.5 bg-white/[0.08] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-500 to-blue-500 rounded-full transition-all duration-700"
                        style={{ width: `${usedPct}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Stat tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <StatTile
                  label="Session Usage"
                  value={fmt(stats.usage)}
                  icon={<Zap size={12} className="text-amber-400" />}
                  sub="credits this period"
                />
                <StatTile
                  label="Remaining"
                  value={stats.limitRemaining != null ? fmt(stats.limitRemaining) : stats.limit == null ? '∞ Unlimited' : '—'}
                  icon={<Activity size={12} className="text-green-400" />}
                  sub={stats.limit == null ? 'no cap set' : 'credit limit'}
                />
                <StatTile
                  label="Rate Limit"
                  value={stats.rateLimit ? `${stats.rateLimit.requests} req` : '—'}
                  icon={<RefreshCw size={12} className="text-blue-400" />}
                  sub={stats.rateLimit ? `per ${stats.rateLimit.interval}` : ''}
                />
                <StatTile
                  label="All-Time Spend"
                  value={fmt(stats.totalUsage)}
                  icon={<Brain size={12} className="text-violet-400" />}
                  sub="total cost"
                />
              </div>

              {/* Footer note */}
              <p className="text-[10px] text-white/20 flex items-center gap-1.5">
                <span>Auto-refreshes every 60 s</span>
                <span className="text-white/10">·</span>
                <a href="https://openrouter.ai/settings/billing" target="_blank" rel="noopener noreferrer" className="hover:text-white/50 transition flex items-center gap-0.5">
                  Manage billing <ExternalLink size={8} />
                </a>
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

const StatTile: React.FC<{ label: string; value: string; icon: React.ReactNode; sub?: string }> = ({
  label, value, icon, sub,
}) => (
  <div className="glass-card border border-white/[0.08] rounded-xl p-3">
    <div className="flex items-center gap-1.5 mb-1.5">
      {icon}
      <span className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">{label}</span>
    </div>
    <p className="text-sm font-black text-white leading-none">{value}</p>
    {sub && <p className="text-[10px] text-white/25 mt-0.5">{sub}</p>}
  </div>
);
