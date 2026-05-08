import React, { useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, Film } from 'lucide-react';
import { aiAuthHeaders } from '../services/gemini';

const AI_WORKER = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';

interface Props {
  /** When set, runs the test against the agency-managed client workspace
   *  instead of the user's own Facebook tokens. Mirrors how the cron resolves
   *  tokens for portal/client workspaces. */
  clientId?: string | null;
}

type TestResult =
  | { ok: true; page_name: string; message: string }
  | { ok: false; stage: string; message: string; fb_error_code?: number; page_name?: string };

/**
 * Pre-flight smoke test for FB Page Reels publishing. Aligns with the user's
 * #1 priority (reliability) — detect permission/token issues at config time
 * rather than letting a scheduled reel silently fall back to image at
 * publish time. Free (no Kling cost — just a FB Graph API ping).
 */
export const TestReelPublishButton: React.FC<Props> = ({ clientId }) => {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const runTest = async () => {
    setRunning(true);
    setResult(null);
    try {
      const headers = await aiAuthHeaders();
      const res = await fetch(`${AI_WORKER}/api/test-reel-publish`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ clientId: clientId ?? null }),
      });
      const data = await res.json() as TestResult;
      setResult(data);
    } catch (e: any) {
      setResult({
        ok: false,
        stage: 'network',
        message: `Could not run test: ${e?.message || 'unknown error'}. Check your internet connection.`,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={runTest}
        disabled={running}
        className="w-full flex items-center justify-center gap-2 bg-purple-500/12 hover:bg-purple-500/20 border border-purple-500/25 text-purple-300 text-xs font-bold px-4 py-2.5 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {running ? (
          <><Loader2 size={12} className="animate-spin" /> Testing reel permissions…</>
        ) : (
          <><Film size={12} /> Test reel publishing</>
        )}
      </button>
      {result && (
        <div
          className={`text-xs leading-relaxed rounded-xl px-3 py-2.5 border flex items-start gap-2 ${
            result.ok
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
              : 'bg-red-500/10 border-red-500/25 text-red-300'
          }`}
        >
          {result.ok ? (
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className="font-semibold">
              {result.ok ? 'All set — reels ready to publish' : `Test failed at: ${result.stage}`}
            </p>
            <p className="opacity-80 mt-0.5">{result.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};
