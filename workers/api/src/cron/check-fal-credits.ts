// fal.ai credit balance watchdog (every 6 hours).
//
// fal.ai charges per image/video and Steve's account is prepay — if the
// balance hits zero, prewarm + JIT image gen silently fail and posts ship
// text-only. This cron polls fal.ai's /api/users/me endpoint and emails
// Steve via Resend when the balance drops below $5 so he can top up
// before a stampede of failed prewarms.
//
// Extracted from src/index.ts as Phase B step 9 of the route-module split.
// Self-contained — no shared state, single caller (scheduled() handler).

import type { Env } from '../env';

export async function cronCheckFalCredits(env: Env) {
  const apiKey = env.FAL_API_KEY;
  const resendKey = env.RESEND_API_KEY;
  if (!apiKey || !resendKey) return;

  try {
    const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${apiKey}` } });
    const data = await res.json() as any;
    const balance = data?.balance ?? data?.credits ?? null;
    console.log(`[CRON] fal.ai balance: $${balance}`);

    const threshold = 5;
    if (balance !== null && balance < threshold) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'SocialAI Studio <noreply@socialaistudio.au>',
          to: 'steve@3dhub.au',
          subject: `fal.ai Credits Low — $${typeof balance === 'number' ? balance.toFixed(2) : balance} remaining`,
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;"><h2 style="color:#f59e0b;">fal.ai Credit Alert</h2><p>Your fal.ai balance is <strong style="color:#ef4444;font-size:1.3em;">$${typeof balance === 'number' ? balance.toFixed(2) : balance}</strong></p><p>Image generation will stop when credits run out.</p><a href="https://fal.ai/dashboard/usage-billing/credits" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:10px;">Top Up Credits</a></div>`,
        }),
      });
      console.log(`[CRON] Low balance alert sent ($${balance})`);
    }
  } catch (e: any) {
    console.error('[CRON] Credit check failed:', e.message);
  }
}
