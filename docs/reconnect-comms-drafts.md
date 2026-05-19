# Reconnect Comms — Email Drafts for Steve's Review

> Three variants for the Phase 2 customer reconnect email. Pick one (or remix), tune voice, then we'll wire the send path via `lib/email.ts` (`sendResendEmail`).
>
> **Target audience:** existing customers with `social_tokens.facebookConnected = 1` AND no `postproxy_placement_id` set (i.e. legacy FB path, hasn't migrated yet). Phase 1 dual-path window is open NOW so a reconnect is non-blocking — they can take 1–2 weeks.
>
> **Why we're asking:** legacy FB tokens auto-expire in 60 days, and we're retiring the legacy refresh-tokens cron in Phase 3. A one-time reconnect via the Postproxy hosted OAuth flow takes ~30 seconds and gives them a more reliable publish path going forward.
>
> **Trigger:** ideally one-off blast at start of Phase 2 window, plus an in-app `MigrationBanner` (already in plan §2). Optional: 7-day reminder if they haven't reconnected.

---

## Variant A — Matter-of-fact (recommended for technical-ish customers)

**Subject options:**
- `Reconnect Facebook in 30 seconds — publishing upgrade ready`
- `One-time Facebook reconnect needed (30 sec)`
- `Your Social AI Studio publishing path has an upgrade waiting`

**Body (HTML — pass into `sendResendEmail` as `opts.html`):**

```html
<p>Hi {{firstName}},</p>

<p>We've moved our Facebook publishing onto a more reliable backend. To keep your scheduled posts going out without interruption, please reconnect your Facebook account — it takes about 30 seconds.</p>

<p>
  <a href="https://socialaistudio.au/?reconnect=facebook"
     style="display:inline-block;background:#f59e0b;color:#fff;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">
    Reconnect Facebook →
  </a>
</p>

<p style="color:#666;font-size:14px;">
  <strong>What changes:</strong> Posts go out the same way, on the same schedule. We just hand them to a more battle-tested publisher behind the scenes.<br>
  <strong>What you need:</strong> Click the button above, sign into Facebook, pick your Page. Done.<br>
  <strong>Deadline:</strong> No hard deadline yet — old connection works alongside the new one. We'll retire the legacy path in early {{phase3Month}} and follow up before then.
</p>

<p>Any questions, just reply to this email.</p>

<p>— Steve<br>
Social AI Studio</p>
```

**Notes for Steve:**
- `{{firstName}}` placeholder needs server-side substitution — pull from `users.email` parse or add a `first_name` column. Default to "there" if missing.
- `{{phase3Month}}` placeholder — substitute the planned cleanup date when sending (e.g. "June").
- The amber CTA matches the existing in-app accent (`text-amber-300` is used throughout AccountPanel).
- Plain-text fallback not included — Resend will auto-generate, but a hand-written one reads better. Can add if needed.

---

## Variant B — Friendly (recommended for SMB/non-technical customers)

**Subject options:**
- `Quick favour — 30-second Facebook reconnect ❤️` (drop emoji per CLAUDE.md preference unless Steve wants it)
- `Could you take 30 seconds to reconnect Facebook?`
- `Small ask: reconnect Facebook so your posts keep flying`

**Body:**

```html
<p>Hey {{firstName}},</p>

<p>Quick favour. We just upgraded the engine that pushes your posts to Facebook — it's faster, more reliable, and means fewer "huh, that post didn't go out" moments.</p>

<p>To switch you over, we need you to reconnect Facebook once. It takes about 30 seconds:</p>

<ol style="color:#444;font-size:15px;">
  <li>Click the button below</li>
  <li>Sign into Facebook (same as before)</li>
  <li>Pick the Page you post to</li>
  <li>Done — we'll handle the rest</li>
</ol>

<p>
  <a href="https://socialaistudio.au/?reconnect=facebook"
     style="display:inline-block;background:#f59e0b;color:#fff;font-weight:600;padding:12px 22px;border-radius:8px;text-decoration:none;">
    Reconnect Facebook in 30 seconds
  </a>
</p>

<p style="color:#666;font-size:14px;">Your scheduled posts keep going out on the old connection in the meantime — no rush, no broken queue. We'd just love to have everyone on the new path by {{phase3Month}}.</p>

<p>Cheers,<br>
Steve</p>
```

**Notes:**
- Warmer, more SMB-friendly tone. Numbered list demystifies the flow.
- Same CTA + placeholders as Variant A — interchangeable.

---

## Variant C — Direct with deadline (recommended ONLY if Variant A/B haven't moved the needle 14 days in)

**Subject options:**
- `Action needed by {{deadline}} — reconnect Facebook`
- `Last call: reconnect Facebook before {{deadline}}`

**Body:**

```html
<p>Hi {{firstName}},</p>

<p>Heads up — we're retiring the old Facebook connection on <strong>{{deadline}}</strong>. After that date, your scheduled posts won't publish unless you reconnect.</p>

<p>It's a 30-second one-time reconnect:</p>

<p>
  <a href="https://socialaistudio.au/?reconnect=facebook"
     style="display:inline-block;background:#dc2626;color:#fff;font-weight:600;padding:12px 22px;border-radius:8px;text-decoration:none;">
    Reconnect Facebook now →
  </a>
</p>

<p style="color:#666;font-size:14px;">
  If you've already reconnected, ignore this — you're good to go. To check, log in and visit <a href="https://socialaistudio.au/account">your Account page</a>: you'll see "Connected via Postproxy" under Facebook if you're on the new path.
</p>

<p>Any questions, reply here and I'll sort it.</p>

<p>— Steve</p>
```

**Notes:**
- Red CTA (`#dc2626`) signals urgency without being shouty.
- "If you've already reconnected, ignore this" is the kind line — costs nothing, reduces support tickets.
- Pre-condition: the in-app "Connected via Postproxy" indicator needs to exist. Check `AccountPanel.tsx` after the frontend Postproxy work landed in PR #111.

---

## Wire-up plan (engineering, after Steve picks a variant)

1. Add `lib/reconnect-comms.ts` (new) with:
   - `getReconnectCandidates(env): Promise<Array<{ userId, email, firstName }>>`
     — SELECT users WHERE has facebook_token AND not has postproxy_placement_id
   - `sendReconnectEmail(env, candidate, template: 'A' | 'B' | 'C'): Promise<void>`
     — wraps `sendResendEmail` with the chosen template + substitutions
2. Add admin route `POST /api/admin/reconnect-comms/send` in `routes/admin-actions.ts`:
   - Body: `{ template: 'A' | 'B' | 'C', dryRun?: boolean, deadline?: string }`
   - Returns: `{ recipients: [...], sent: N, skipped: N }`
   - Dry-run support is non-negotiable — Steve previews recipient list before blasting.
3. Optional: tracking column `users.reconnect_email_sent_at` so we don't double-send and the 7-day reminder cron knows who to retry.
4. Optional: 7-day reminder cron — could piggyback on the existing weekly-review cron schedule.

**Estimated effort:** 1.5 hours engineering + Steve's voice/copy review.

---

## What needs Steve's input before send

- Which variant (A / B / C / remix)
- Final voice/wording pass
- `{{phase3Month}}` value — when does Phase 3 cleanup actually land?
- For Variant C: `{{deadline}}` date and how many days after Phase 2 start
- Whether to include emoji / personality / signoff style
- Whether to send from Steve's personal email or `noreply@socialaistudio.au` (current default)
