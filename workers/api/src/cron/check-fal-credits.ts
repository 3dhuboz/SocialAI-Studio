// fal.ai credit balance watchdog (every 6 hours).
//
// fal.ai charges per image/video and Steve's account is prepay. If the
// balance hits zero, prewarm + JIT image gen silently fail and posts ship
// text-only. This cron polls fal.ai's /api/users/me endpoint and emails
// Steve via Resend when the balance drops below $5 so he can top up.
//
// Uses cron_alerts as an incident latch: one email while the balance remains
// low, then re-arms after a successful check above the threshold.

import type { Env } from '../env';

const LOW_CREDIT_ALERT_KEY = 'fal_credits_low';
const LOW_CREDIT_THRESHOLD = 5;

interface FalCreditAlertRow {
  alert_key: string;
  last_email_at: string | null;
  fire_count: number;
}

export async function cronCheckFalCredits(env: Env) {
  const apiKey = env.FAL_API_KEY;
  const resendKey = env.RESEND_API_KEY;
  if (!apiKey || !resendKey) return;

  try {
    const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${apiKey}` } });
    const data = await res.json() as any;
    const balance = data?.balance ?? data?.credits ?? null;
    console.log(`[CRON] fal.ai balance: $${balance}`);

    if (balance !== null && balance < LOW_CREDIT_THRESHOLD) {
      const row = await recordLowCreditFire(env, balance);
      if (row?.last_email_at) {
        console.log(`[CRON] Low balance alert suppressed; already sent for current incident (fire_count=${row.fire_count})`);
        return;
      }

      await sendLowCreditEmail(resendKey, balance);
      await markLowCreditEmailed(env);
      console.log(`[CRON] Low balance alert sent ($${balance})`);
      return;
    }

    if (balance !== null) await resolveLowCreditAlert(env);
  } catch (e: any) {
    console.error('[CRON] Credit check failed:', e.message);
  }
}

async function recordLowCreditFire(env: Env, balance: unknown): Promise<FalCreditAlertRow | null> {
  const body = `fal.ai balance $${formatBalance(balance)} is below $${LOW_CREDIT_THRESHOLD}`;
  await env.DB.prepare(
    `INSERT INTO cron_alerts (alert_key, severity, first_fired_at, last_fired_at, fire_count, last_body, dark_launch)
     VALUES (?, 'warn', datetime('now'), datetime('now'), 1, ?, 0)
     ON CONFLICT(alert_key) DO UPDATE SET
       severity = excluded.severity,
       last_fired_at = datetime('now'),
       fire_count = cron_alerts.fire_count + 1,
       last_body = excluded.last_body`
  ).bind(LOW_CREDIT_ALERT_KEY, body).run();

  return env.DB.prepare(
    `SELECT alert_key, last_email_at, fire_count
     FROM cron_alerts WHERE alert_key = ?`
  ).bind(LOW_CREDIT_ALERT_KEY).first<FalCreditAlertRow>();
}

async function markLowCreditEmailed(env: Env): Promise<void> {
  await env.DB.prepare(
    `UPDATE cron_alerts SET last_email_at = datetime('now') WHERE alert_key = ?`
  ).bind(LOW_CREDIT_ALERT_KEY).run();
}

async function resolveLowCreditAlert(env: Env): Promise<void> {
  await env.DB.prepare(
    `UPDATE cron_alerts
     SET last_resolved_at = datetime('now'),
         last_email_at = NULL
     WHERE alert_key = ?`
  ).bind(LOW_CREDIT_ALERT_KEY).run();
}

async function sendLowCreditEmail(resendKey: string, balance: unknown): Promise<void> {
  const formattedBalance = formatBalance(balance);
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'SocialAI Studio <noreply@socialaistudio.au>',
      to: 'steve@3dhub.au',
      subject: `fal.ai Credits Low - $${formattedBalance} remaining`,
      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;"><h2 style="color:#f59e0b;">fal.ai Credit Alert</h2><p>Your fal.ai balance is <strong style="color:#ef4444;font-size:1.3em;">$${formattedBalance}</strong></p><p>Image generation will stop when credits run out.</p><a href="https://fal.ai/dashboard/usage-billing/credits" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:10px;">Top Up Credits</a></div>`,
    }),
  });
}

function formatBalance(balance: unknown): string {
  return typeof balance === 'number' ? balance.toFixed(2) : String(balance);
}
