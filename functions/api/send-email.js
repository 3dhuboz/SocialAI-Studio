/**
 * Cloudflare Pages Function — Resend transactional email
 * Available at: /api/send-email
 *
 * Required env vars: RESEND_API_KEY
 * Actions: intake-notify
 */

const FROM = 'Social AI Studio <noreply@socialaistudio.au>';
const ADMIN_EMAIL = 'steve@pennywiseit.com.au';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

async function sendEmail(env, { to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Resend error');
  return data;
}

function intakeNotifyHtml({ name, email, phone, businessName, businessType, plan, message }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <div style="background:linear-gradient(135deg,#f59e0b,#ef4444);border-radius:16px;padding:3px;margin-bottom:24px;">
      <div style="background:#111118;border-radius:14px;padding:28px 32px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <div style="width:36px;height:36px;background:linear-gradient(135deg,#f59e0b,#ef4444);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;">✨</div>
          <span style="color:#f59e0b;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">New Lead Alert</span>
        </div>
        <h1 style="color:#ffffff;font-size:22px;font-weight:900;margin:0 0 4px;">New Intake Form Submission</h1>
        <p style="color:#6b7280;font-size:13px;margin:0;">Someone is interested in Social AI Studio</p>
      </div>
    </div>

    <div style="background:#111118;border:1px solid #1f2937;border-radius:16px;padding:28px 32px;margin-bottom:16px;">
      <h2 style="color:#f59e0b;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 20px;">Contact Details</h2>
      <table style="width:100%;border-collapse:collapse;">
        ${[
          ['Name', name],
          ['Email', email],
          ['Phone', phone || '—'],
          ['Business', businessName],
          ['Type', businessType],
          ['Interested Plan', plan || '—'],
        ].map(([label, value]) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #1f2937;color:#6b7280;font-size:13px;width:140px;">${label}</td>
          <td style="padding:10px 0;border-bottom:1px solid #1f2937;color:#ffffff;font-size:13px;font-weight:600;">${value}</td>
        </tr>`).join('')}
      </table>
      ${message ? `
      <div style="margin-top:20px;">
        <p style="color:#6b7280;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Message</p>
        <p style="color:#d1d5db;font-size:13px;line-height:1.6;background:#0d0d18;border-radius:10px;padding:14px;margin:0;">${message}</p>
      </div>` : ''}
    </div>

    <div style="text-align:center;padding:16px;">
      <p style="color:#374151;font-size:11px;margin:0;">Social AI Studio · Penny Wise I.T · <a href="https://socialaistudio.au" style="color:#f59e0b;text-decoration:none;">socialaistudio.au</a></p>
    </div>
  </div>
</body>
</html>`;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: corsHeaders });
  if (request.method !== 'POST') return jsonRes({ error: 'Method Not Allowed' }, 405);

  if (!env.RESEND_API_KEY) return jsonRes({ error: 'Email service not configured' }, 503);

  let body;
  try { body = await request.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400); }

  const { action } = body;

  try {
    if (action === 'intake-notify') {
      const { name, email, phone, businessName, businessType, plan, message } = body;
      if (!name || !email) return jsonRes({ error: 'Missing name or email' }, 400);

      await sendEmail(env, {
        to: ADMIN_EMAIL,
        subject: `New intake: ${businessName || name} — ${plan || 'enquiry'}`,
        html: intakeNotifyHtml({ name, email, phone, businessName, businessType, plan, message }),
      });
      return jsonRes({ success: true });
    }

    return jsonRes({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error('send-email error:', err.message);
    return jsonRes({ error: 'Failed to send email' }, 500);
  }
}
