import React, { useState, useEffect } from 'react';
import { Facebook, Instagram, Filter, Grid3X3, List, Calendar, CheckCircle, Clock, AlertTriangle, X, RefreshCw } from 'lucide-react';

interface Post {
  id: string;
  content: string;
  platform?: string | null;
  status?: string | null;
  scheduled_for?: string | null;
  image_url?: string | null;
  client_id?: string | null;
}

interface Client {
  id: string;
  name: string;
  businessType?: string | null;
  facebookConnected?: boolean;
  facebookPageName?: string;
}

interface Props {
  clients: Client[];
  ownWorkspace?: { facebookConnected: boolean; facebookPageName?: string };
  allPosts: Post[];
  onRefresh: () => void;
  isLoading?: boolean;
}

type ViewMode = 'grid' | 'list';
type StatusFilter = 'all' | 'Scheduled' | 'Posted' | 'Missed' | 'Draft';
type ClientFilter = 'all' | string;

const statusBadge: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  Scheduled: { bg: 'bg-blue-500/15 border-blue-500/25', text: 'text-blue-300', icon: <Clock size={10} /> },
  Posted: { bg: 'bg-green-500/15 border-green-500/25', text: 'text-green-300', icon: <CheckCircle size={10} /> },
  Missed: { bg: 'bg-red-500/15 border-red-500/25', text: 'text-red-300', icon: <AlertTriangle size={10} /> },
  Draft: { bg: 'bg-white/5 border-white/10', text: 'text-white/40', icon: null },
};

export const AdminDashboard: React.FC<Props> = ({ clients, ownWorkspace, allPosts, onRefresh, isLoading }) => {
  const [tab, setTab] = useState<'posts' | 'connections'>('posts');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [clientFilter, setClientFilter] = useState<ClientFilter>('all');

  const filtered = allPosts
    .filter(p => statusFilter === 'all' || p.status === statusFilter)
    .filter(p => clientFilter === 'all' || p.client_id === clientFilter || (clientFilter === 'own' && !p.client_id))
    .sort((a, b) => new Date(b.scheduled_for || 0).getTime() - new Date(a.scheduled_for || 0).getTime());

  const getClientName = (clientId: string | null | undefined) => {
    if (!clientId) return 'Own Workspace';
    return clients.find(c => c.id === clientId)?.name || clientId;
  };

  const counts: Record<StatusFilter, number> = {
    all: allPosts.length,
    Scheduled: allPosts.filter(p => p.status === 'Scheduled').length,
    Posted: allPosts.filter(p => p.status === 'Posted').length,
    Missed: allPosts.filter(p => p.status === 'Missed').length,
    Draft: allPosts.filter(p => p.status === 'Draft').length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black text-white">Admin Dashboard</h2>
          <p className="text-xs text-white/30">{allPosts.length} posts across {clients.length + 1} workspaces</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setTab('posts')} className={`text-xs font-bold px-4 py-2 rounded-xl border transition ${tab === 'posts' ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'glass-card border-white/[0.08] text-white/40'}`}>
            Posts
          </button>
          <button onClick={() => setTab('connections')} className={`text-xs font-bold px-4 py-2 rounded-xl border transition ${tab === 'connections' ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'glass-card border-white/[0.08] text-white/40'}`}>
            Connections
          </button>
          <button onClick={onRefresh} disabled={isLoading} className="text-xs bg-white/5 border border-white/10 text-white/40 hover:text-white/60 px-3 py-2 rounded-xl transition flex items-center gap-1.5">
            <RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* ── POSTS TAB ── */}
      {tab === 'posts' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <Filter size={12} className="text-white/20" />
            {(['all', 'Scheduled', 'Posted', 'Missed'] as StatusFilter[]).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition ${statusFilter === s ? 'bg-amber-500/20 border-amber-500/30 text-amber-300' : 'glass-card border-white/[0.08] text-white/30 hover:text-white/50'}`}>
                {s === 'all' ? `All (${counts.all})` : `${s} (${counts[s] || 0})`}
              </button>
            ))}
            <span className="text-white/10 mx-1">|</span>
            <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
              className="text-[10px] bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-white/40 focus:outline-none">
              <option value="all">All Workspaces</option>
              <option value="own">Own Workspace</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="text-white/10 mx-1">|</span>
            <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-lg transition ${viewMode === 'grid' ? 'bg-white/10 text-white/60' : 'text-white/20'}`}><Grid3X3 size={13} /></button>
            <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-lg transition ${viewMode === 'list' ? 'bg-white/10 text-white/60' : 'text-white/20'}`}><List size={13} /></button>
          </div>

          {/* Posts Grid/List */}
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-white/20 text-sm">No posts match your filters.</div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map(post => {
                const badge = statusBadge[post.status || 'Draft'] || statusBadge.Draft;
                return (
                  <div key={post.id} className="glass-card border border-white/[0.08] rounded-2xl overflow-hidden hover:border-white/15 transition">
                    {post.image_url ? (
                      <img src={post.image_url} alt="" loading="lazy" className="w-full h-32 object-cover" />
                    ) : (
                      <div className="w-full h-20 bg-gradient-to-br from-white/3 to-white/1 flex items-center justify-center">
                        <Calendar size={18} className="text-white/10" />
                      </div>
                    )}
                    <div className="p-3 space-y-2">
                      <p className="text-xs text-white/60 line-clamp-2 leading-relaxed">{post.content?.substring(0, 100)}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {post.platform === 'Instagram' ? <Instagram size={10} className="text-pink-400" /> : <Facebook size={10} className="text-blue-400" />}
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${badge.bg} ${badge.text} flex items-center gap-1`}>
                          {badge.icon} {post.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-white/20">{post.scheduled_for ? new Date(post.scheduled_for).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                        <span className="text-[9px] text-amber-400/60 font-semibold">{getClientName(post.client_id)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filtered.map(post => {
                const badge = statusBadge[post.status || 'Draft'] || statusBadge.Draft;
                return (
                  <div key={post.id} className="flex items-center gap-4 py-3 px-2 hover:bg-white/2 transition">
                    <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-black/40 border border-white/5">
                      {post.image_url ? <img src={post.image_url} alt="" loading="lazy" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Calendar size={12} className="text-white/10" /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/60 truncate">{post.content?.substring(0, 120)}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {post.platform === 'Instagram' ? <Instagram size={9} className="text-pink-400" /> : <Facebook size={9} className="text-blue-400" />}
                        <span className="text-[9px] text-white/20">{post.scheduled_for ? new Date(post.scheduled_for).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                        <span className="text-[9px] text-amber-400/50">{getClientName(post.client_id)}</span>
                      </div>
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-1 rounded-full border ${badge.bg} ${badge.text} flex items-center gap-1 shrink-0`}>
                      {badge.icon} {post.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── CONNECTIONS TAB ── */}
      {tab === 'connections' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[{ id: null, name: 'Own Workspace (Agency)', businessType: 'Agency', facebookConnected: ownWorkspace?.facebookConnected, facebookPageName: ownWorkspace?.facebookPageName }, ...clients].map((client: any) => {
            const isConnected = !!client.facebookConnected;
            return (
              <div key={client.id || 'own'} className="glass-card border border-white/[0.08] rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-white">{client.name}</p>
                    <p className="text-[10px] text-white/25">{client.businessType || 'Unknown'}</p>
                  </div>
                  <Facebook size={18} className={isConnected ? 'text-blue-400' : 'text-white/10'} />
                </div>
                <div className={`flex items-center gap-2 text-[10px] font-bold px-2.5 py-1.5 rounded-xl border ${isConnected ? 'bg-green-500/10 border-green-500/20 text-green-300' : 'bg-red-500/10 border-red-500/20 text-red-300'}`}>
                  {isConnected ? <><CheckCircle size={10} /> Connected</> : <><X size={10} /> Not Connected</>}
                </div>
                {client.facebookPageName && <p className="text-[10px] text-white/30">Page: {client.facebookPageName}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
