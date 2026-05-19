// Operational alerting — keep Steve informed within an hour when something
// breaks in production without him having to tail Cloudflare Workers logs.
//
// Single chokepoint: fireAlert(env, key, severity, body). Upserts into
// cron_alerts (one row per alert_key), applies a severity-specific throttle
// window so we don't spam, optionally suppresses email when dark_launch=1
// (the calibration mode — record-only for the first week so thresholds can
// be tuned without sending false-positive emails).
//
// Severity windows (minimum time between consecutive emails for the same key):
//   - critical: 30 minutes — actionable now, but no point hammering inbox
//   - warn:     2 hours    — actionable soon, can wait
//   - info:     12 hours   — FYI, daily-ish cadence is plenty
//
// Schema: workers/api/schema_v23_alerts.sql. Dark-launch defaults to 1 in
// the migration so a new alert key requires an explicit one-off SQL flip to
// go live. After the first week of dark-launch data we flip each key
// individually after confirming the threshold matches real-world noise.
//
// Wired by:
//   - cron/dispatcher.ts → trackCron's catch block fires
//     'cron_crashed:<type>' at critical severity
//   - Future: lib/health-sweep.ts threshold checks
//   - Future: routes/postproxy.ts webhook signature failures

import type { Env } from '../env';
import { sendResendEmail } from './email';

export type AlertSeverity = 'info' | 'warn' | 'critical';

interface AlertRow {
  alert_key: string;
  severity: AlertSeverity;
  first_fired_at: string;
  last_fired_at: string;
  last_email_at: string | null;
  fire_count: number;
  last_resolved_at: string | null;
  last_body: string | null;
  dark_launch: number;
}

const THROTTLE_MINUTES: Record<AlertSeverity, number> = {
  critical: 30,
  warn: 120,
  info: 720,
};

// Recipient is fixed for v1 — single-owner workspace. If/when this becomes
// multi-recipient (team / on-call rotation), make it a column on cron_alerts
// or env-driven, NOT hardcoded across multiple files.
const ALERT_RECIPIENT = 'steve@3dhub.au';

/**
 * Record + maybe email an alert. Never throws — alerting must not be able
 * to take down the caller (we don't want a Resend outage to break the
 * publish cron).
 *
 * Behaviour:
 *   1. Upsert into cron_alerts. New rows start with the migration's
 *      dark_launch=1 default; existing rows preserve their dark_launch
 *      setting across fires.
 *   2. If last_email_at is within the severity's throttle window, return
 *      without sending an email (fire_count + last_fired_at still update).
 *   3. If dark_launch=1, return without sending.
 *   4. Otherwise send via sendResendEmail with subject prefix
 *      [CRITICAL]/[WARN]/[FYI] + the alert key.
 */
export async function fireAlert(
  env: Env,
  key: string,
  severity: AlertSeverity,
  body: string,
): Promise<void> {
  try {
    const truncatedBody = (body || '').slice(0, 1000);

    // Upsert. ON CONFLICT keeps the original first_fired_at + dark_launch +
    // last_resolved_at (so a still-open resolve doesn't get clobbered);
    // updates the rolling fields.
    await env.DB.prepare(
      `INSERT INTO cron_alerts (alert_key, severity, first_fired_at, last_fired_at, fire_count, last_body, dark_launch)
       VALUES (?, ?, datetime('now'), datetime('now'), 1, ?, 1)
       ON CONFLICT(alert_key) DO UPDATE SET
         severity = excluded.severity,
         last_fired_at = datetime('now'),
         fire_count = cron_alerts.fire_count + 1,
         last_body = excluded.last_body`
    ).bind(key, severity, truncatedBody).run();

    // Re-read the post-upsert state to decide whether to email.
    const row = await env.DB.prepare(
      `SELECT alert_key, severity, first_fired_at, last_fired_at, last_email_at, fire_count, last_resolved_at, last_body, dark_launch
       FROM cron_alerts WHERE alert_key = ?`
    ).bind(key).first<AlertRow>();
    if (!row) return; // shouldn't happen after the upsert, but defensive

    if (row.dark_launch === 1) {
      console.log(`[alerts] DARK ${severity} ${key}: ${truncatedBody.slice(0, 200)}`);
      return;
    }

    if (row.last_email_at && !shouldEmail(row.last_email_at, severity)) {
      console.log(`[alerts] THROTTLED ${severity} ${key} (fire_count=${row.fire_count})`);
      return;
    }

    const prefix = severity === 'critical' ? '[CRITICAL]' : severity === 'warn' ? '[WARN]' : '[FYI]';
    const subject = `${prefix} SocialAI: ${key}`;
    const html = renderAlertHtml(row, truncatedBody);
    await sendResendEmail(env, { to: ALERT_RECIPIENT, subject, html });

    await env.DB.prepare(
      `UPDATE cron_alerts SET last_email_at = datetime('now') WHERE alert_key = ?`
    ).bind(key).run();
  } catch (e: any) {
    // Alerting is best-effort. Log loudly but never propagate the error.
    console.error(`[alerts] fireAlert(${key}) threw: ${e?.message || e}`);
  }
}

/**
 * Mark an alert resolved — the sweep cron calls this when the underlying
 * condition has cleared. Sets last_resolved_at; the next fire is treated
 * as a fresh incident and bypasses the throttle.
 *
 * The throttle bypass is implemented by clearing last_email_at on resolve:
 * the next fireAlert sees last_email_at=NULL and skips the shouldEmail check.
 */
export async function resolveAlert(env: Env, key: string): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE cron_alerts
       SET last_resolved_at = datetime('now'),
           last_email_at = NULL
       WHERE alert_key = ?`
    ).bind(key).run();
  } catch (e: any) {
    console.error(`[alerts] resolveAlert(${key}) threw: ${e?.message || e}`);
  }
}

/**
 * Read recent alerts for an admin observability route. Read-only — caller
 * decides what to show. Defaults to 100 most-recently-fired rows.
 */
export async function recentAlerts(env: Env, limit = 100): Promise<AlertRow[]> {
  const cap = Math.min(Math.max(limit, 1), 500);
  const rows = await env.DB.prepare(
    `SELECT alert_key, severity, first_fired_at, last_fired_at, last_email_at, fire_count, last_resolved_at, last_body, dark_launch
     FROM cron_alerts
     ORDER BY last_fired_at DESC
     LIMIT ?`
  ).bind(cap).all<AlertRow>();
  return rows.results || [];
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** True iff we're outside the throttle window for `severity`. Exported for
 *  tests; not part of the public surface. */
export function shouldEmail(lastEmailAt: string, severity: AlertSeverity): boolean {
  const last = Date.parse(lastEmailAt);
  if (Number.isNaN(last)) return true; // unparseable — let it through
  const minutesAgo = (Date.now() - last) / 60_000;
  return minutesAgo >= THROTTLE_MINUTES[severity];
}

function renderAlertHtml(row: AlertRow, body: string): string {
  // Plain-ish HTML; matches the minimal style of lib/cron-notify.ts so
  // alert emails feel consistent with the per-post failure notifications.
  return [
    `<p style="margin:0 0 12px 0;font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#222;">`,
    `<strong style="font-size:15px;">${escapeHtml(row.alert_key)}</strong><br>`,
    `<span style="color:#666;font-size:13px;">severity: ${row.severity} · fired ${row.fire_count}× · first ${row.first_fired_at} UTC</span>`,
    `</p>`,
    `<pre style="margin:0;padding:10px 12px;background:#f6f8fa;border-radius:6px;font-size:12px;white-space:pre-wrap;line-height:1.45;color:#0a0a0a;">${escapeHtml(body)}</pre>`,
    `<p style="margin:14px 0 0 0;font-size:11px;color:#999;">Throttle: emails resume after the severity window has elapsed since last_email_at. To resolve, call resolveAlert('${escapeHtml(row.alert_key)}') or wait for the next sweep to clear it.</p>`,
  ].join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
