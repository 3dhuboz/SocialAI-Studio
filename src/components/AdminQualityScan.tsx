import React, { useState } from 'react';
import { ShieldAlert, Trash2, Loader2, CheckCircle, Facebook, Instagram } from 'lucide-react';
import { useDb } from '../hooks/useDb';
import type { FlaggedPost } from '../services/db';

/**
 * AdminQualityScan — collapsible admin card that scans Scheduled posts for
 * AI-fabrication / cadence / trope patterns via the worker endpoint added in
 * the 2026-05 audit (workers/api/src/index.ts → /api/admin/scan-flagged-posts).
 *
 * Mounted inside AdminCustomers above the customer list. Lets admins find and
 * delete pre-deployment posts whose copy reads like generic AI marketing — the
 * exact failure mode that prompted PR #59.
 *
 * Read-only by default: the scan only returns metadata + a content preview.
 * Per-post Delete button calls db.deletePost(id) (already wired up since v1).
 * No bulk operations — admin must triage each flagged post by hand.
 */
type ScanStatus = 'Scheduled' | 'Posted' | 'Missed' | 'Draft';

export const AdminQualityScan: React.FC = () => {
  const db = useDb();
  const [expanded, setExpanded] = useState(false);
  const [scanResult, setScanResult] = useState<{ scanned: number; flagged: FlaggedPost[] } | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus>('Scheduled');

  const runScan = async () => {
    setScanLoading(true);
    setScanError(null);
    try {
      const res = await db.getFlaggedPosts(scanStatus, 500);
      setScanResult({ scanned: res.scanned, flagged: res.flagged });
      // Auto-expand on first results so the admin sees them
      if (!expanded) setExpanded(true);
    } catch (e: any) {
      setScanError(e?.message || 'Scan failed');
    } finally {
      setScanLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Permanently delete this scheduled post? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await db.deletePost(id);
      setScanResult(r => r ? { ...r, flagged: r.flagged.filter(p => p.id !== id) } : r);
    } catch (e: any) {
      alert(`Delete failed: ${e?.message || e}`);
    } finally {
      setDeletingId(null);
    }
  };

  const flaggedCount = scanResult?.flagged.length ?? 0;
  const hasFlags = flaggedCount > 0;

  return (
    <div className="bg-[#111118] border border-white/8 rounded-2xl overflow-hidden">
      {/* Header row — clickable to expand/collapse */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-white/3 transition text-left"
      >
        <div className="flex items-center gap-3">
          <ShieldAlert size={18} className={hasFlags ? 'text-rose-400' : 'text-amber-400'} />
          <div>
            <p className="text-sm font-bold text-white">AI Quality Scan</p>
            <p className="text-[11px] text-white/35 leading-tight mt-0.5">
              {scanResult
                ? `${scanResult.scanned} ${scanStatus.toLowerCase()} posts scanned · ${hasFlags ? `${flaggedCount} flagged` : 'all clean'}`
                : 'Find scheduled posts that trip the 2026-05 fabrication / cadence / trope detectors'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasFlags && (
            <span className="text-[10px] font-black bg-rose-500/20 border border-rose-500/30 text-rose-200 px-2 py-1 rounded-full">
              {flaggedCount}
            </span>
          )}
          <span className="text-[10px] text-white/30">{expanded ? '▾' : '▸'}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-4">
          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Status:</label>
            <select
              value={scanStatus}
              onChange={e => setScanStatus(e.target.value as ScanStatus)}
              disabled={scanLoading}
              className="text-[10px] bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-white/60 focus:outline-none focus:border-amber-500/40 disabled:opacity-40"
            >
              <option value="Scheduled">Scheduled (cleanup target)</option>
              <option value="Posted">Posted (audit only — won't unpublish)</option>
              <option value="Missed">Missed</option>
              <option value="Draft">Draft</option>
            </select>
            <button
              onClick={runScan}
              disabled={scanLoading}
              className="text-xs font-bold bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 px-4 py-2 rounded-xl flex items-center gap-2 transition disabled:opacity-40"
            >
              {scanLoading ? <Loader2 size={12} className="animate-spin" /> : <ShieldAlert size={12} />}
              {scanLoading ? 'Scanning…' : (scanResult ? 'Re-scan' : 'Scan now')}
            </button>
          </div>

          {scanError && (
            <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
              ⚠ {scanError}
            </div>
          )}

          {scanResult && scanResult.flagged.length === 0 && (
            <div className="text-center py-8 bg-emerald-500/5 border border-emerald-500/15 rounded-2xl">
              <CheckCircle size={24} className="text-emerald-400/70 mx-auto mb-2" />
              <p className="text-sm font-bold text-emerald-300">All clean.</p>
              <p className="text-[11px] text-white/30 mt-1">
                No {scanStatus.toLowerCase()} posts trip the AI-quality detectors.
              </p>
            </div>
          )}

          {scanResult && scanResult.flagged.length > 0 && (
            <div className="space-y-2">
              {scanResult.flagged.map(post => (
                <div
                  key={post.id}
                  className="bg-black/30 border border-rose-500/20 rounded-2xl p-3 space-y-2"
                >
                  <div className="flex flex-wrap gap-1.5">
                    {post.reasons.map((reason, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] font-semibold bg-rose-500/10 border border-rose-500/25 text-rose-300 px-2 py-0.5 rounded-full"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-white/70 leading-relaxed">{post.content_preview}</p>
                  {post.image_prompt_preview && (
                    <p className="text-[10px] text-white/30 italic border-l-2 border-white/10 pl-2">
                      Image prompt: {post.image_prompt_preview}
                    </p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-3 text-[10px] text-white/30">
                      {post.platform === 'Instagram'
                        ? <Instagram size={10} className="text-pink-400/70" />
                        : <Facebook size={10} className="text-blue-400/70" />}
                      <span>
                        {post.scheduled_for
                          ? new Date(post.scheduled_for).toLocaleString('en-AU', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                            })
                          : '—'}
                      </span>
                      <span className="text-amber-400/50">
                        {post.workspace === '_self' ? 'Own' : post.workspace}
                      </span>
                      <span className="text-white/15 font-mono">{post.id.slice(0, 8)}</span>
                    </div>
                    <button
                      onClick={() => handleDelete(post.id)}
                      disabled={deletingId === post.id}
                      className="text-[10px] font-bold bg-rose-500/10 border border-rose-500/25 text-rose-300 hover:bg-rose-500/20 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition disabled:opacity-40"
                    >
                      {deletingId === post.id
                        ? <Loader2 size={9} className="animate-spin" />
                        : <Trash2 size={9} />}
                      {deletingId === post.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!scanResult && !scanLoading && (
            <p className="text-[11px] text-white/30 text-center py-3">
              Click <span className="text-amber-300 font-bold">Scan now</span> to find flagged posts.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
