// Resend transactional email helper.
//
// Single chokepoint for every outbound email — PayPal webhooks (welcome,
// cancellation, admin notify), publish-failure alerts, fal credit alerts,
// token-refresh failure alerts, Monday weekly recap.
//
// Silently no-ops when RESEND_API_KEY is unset (preview deploys, local dev)
// so the rest of the pipeline can run without an email backend. Catches and
// logs delivery errors — never throws, so a Resend outage can't cascade
// into a failed publish path.
//
// Extracted from src/index.ts as Phase B step 12 of the route-module split.

import type { Env } from '../env';

export async function sendResendEmail(
  env: Env,
  opts: { to: string; subject: string; html: string },
): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Social AI Studio <noreply@socialaistudio.au>',
        to: opts.to, subject: opts.subject, html: opts.html,
      }),
    });
  } catch (e: any) {
    console.error('Resend send error:', e?.message || e);
  }
}
