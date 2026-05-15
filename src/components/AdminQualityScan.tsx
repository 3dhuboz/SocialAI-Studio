import React, { useState } from 'react';
import { ShieldAlert, Trash2, Loader2, CheckCircle, Facebook, Instagram, ShieldCheck, RefreshCw } from 'lucide-react';
import { useDb } from '../hooks/useDb';
import type { FlaggedPost } from '../services/db';
import type { SocialPost } from '../types';

/**
 * AdminQualityScan — collapsible admin card. Read-only by default: the scan
 * only returns metadata + a content preview. Per-post Delete button calls
 * db.deletePost(id). No bulk operations — admin must triage each flagged post
 * by hand (deliberate, since false-positives still happen).
 */
export const AdminQualityScan: React.FC = () => {
  const db = useDb();
  const [expanded, setExpanded] = useState(false);
  const [scanResult, setScanResult] = useState<{ scanned: number; flagged: FlaggedPost[] } | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<SocialPost['status']>('Scheduled');

  // ── Vision critique backfill + bulk regen (2026-05-12) ─────────────────
  // Two ops the user can trigger from this card to retroactively clean up
  // existing posts that pre-date the cron's vision-critique gate:
  //   1. backfillCritiqueScores — scores every post that has image_url but
  //      no image_critique_score yet (50 per click, paged)
  //   2. bulkRegenLowScoreImages — regenerates all posts where score ≤4
  //      using the forced-archetype-fallback path (20 per click)
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{
    scored: number; failed: number; low_scores: number; remaining_estimate: string;
  } | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenResult, setRegenResult] = useState<{
    regenerated: number; failed: number; found: number;
  } | null>(null);

  const runBackfill = async () => {
    setBackfillLoading(true);
    setBackfillResult(null);
    try {
      const res = await db.backfillCritiqueScores(50);
      setBackfillResult(res);
    } catch (e: any) {
      alert(`Backfill failed: ${e?.message || e}`);
    } finally {
      setBackfillLoading(false);
    }
  };

  const runBulkRegen = async () => {
    if (!confirm('Regenerate images for all posts scoring ≤4? This costs ~$0.04 per post and takes ~15s per post.')) return;
    setRegenLoading(true);
    setRegenResult(null);
    try {
      const res = await db.bulkRegenLowScoreImages(4, 20);
      setRegenResult(res);
    } catch (e: any) {
      alert(`Bulk regen failed: ${e?.message || e}`);
    } finally {
      setRegenLoading(false);
    }
  };

  const runScan = async () => {
    setScanLoading(true);
    setScanError(null);
    try {
      const res = await db.getFlaggedPosts(scanStatus, 500);
      setScanResult(res);
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
  const scanButtonLabel = scanLoading ? 'Scanning…' : scanResult ? 'Re-scan' : 'Scan now';

  return (
    <div className="glass-card border border-white/[0.08] rounded-2xl overflow-hidden">
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
        <div className="border-t border-white/[0.05] p-4 space-y-4">
          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Status:</label>
            <select
              value={scanStatus}
              onChange={e => setScanStatus(e.target.value as SocialPost['status'])}
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
              {scanButtonLabel}
            </button>
          </div>

          {scanError && (
            <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
              ⚠ {scanError}
            </div>
          )}

          {/* ── Vision critique backfill + bulk regen ────────────────────
              Two retroactive ops for cleaning up posts that pre-date the
              cron's vision-critique gate. Backfill scores existing images,
              bulk regen replaces all ≤4 scores. Both are paged — re-click
              until done. */}
          <div className="bg-black/30 border border-white/[0.08] rounded-2xl p-3 space-y-3">
            <div>
              <p className="text-[11px] font-bold text-white/55 uppercase tracking-wider mb-0.5">Vision critique</p>
              <p className="text-[10px] text-white/30 leading-snug">
                Retroactively score + regen images for posts created before today's vision-critique gate.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={runBackfill}
                disabled={backfillLoading}
                className="text-xs font-bold bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition disabled:opacity-40"
              >
                {backfillLoading ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
                {backfillLoading ? 'Scoring…' : 'Score 50 unrated posts'}
              </button>
              <button
                onClick={runBulkRegen}
                disabled={regenLoading}
                className="text-xs font-bold bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition disabled:opacity-40"
              >
                {regenLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                {regenLoading ? 'Regenerating…' : 'Regen ≤4 scores (20)'}
              </button>
            </div>
            {backfillResult && (
              <p className="text-[11px] text-sky-300/80">
                ✓ Scored {backfillResult.scored} posts ·{' '}
                <span className="text-rose-300">{backfillResult.low_scores} flagged ≤4</span>
                {backfillResult.failed > 0 && <> · {backfillResult.failed} failed</>}
                {backfillResult.remaining_estimate === 'more available — run again' && (
                  <span className="text-white/40"> · more remaining, click again</span>
                )}
              </p>
            )}
            {regenResult && (
              <p className="text-[11px] text-emerald-300/80">
                ✓ Regenerated {regenResult.regenerated} of {regenResult.found} flagged posts
                {regenResult.failed > 0 && <span className="text-rose-300/70"> · {regenResult.failed} failed</span>}
              </p>
            )}
          </div>

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
              {scanResult.flagged.map(post => {
                const isDeleting = deletingId === post.id;
                return (
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
                      disabled={isDeleting}
                      className="text-[10px] font-bold bg-rose-500/10 border border-rose-500/25 text-rose-300 hover:bg-rose-500/20 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition disabled:opacity-40"
                    >
                      {isDeleting ? <Loader2 size={9} className="animate-spin" /> : <Trash2 size={9} />}
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
                );
              })}
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
