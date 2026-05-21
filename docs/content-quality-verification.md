# Content-quality verification SOP — PR #142

Step-by-step harness for confirming that the tech-saas-agency hardening
fixes shipped in [PR #142](https://github.com/3dhuboz/SocialAI-Studio/pull/142)
actually improved post quality in production. Run this after every Smart
Schedule regeneration on the SocialAI Studio workspace until two clean
batches in a row pass all seven checks.

---

## What changed in #142

PR #142 added post-flight enforcement (not just prompt hints) for five
slip-throughs caught in the 2026-05 audit of SocialAI Studio self-promo
posts: em-dash compound-word fusion (`money-and`), word-fusion after the
fab-pattern scrubber (`$29/moWhat's`), three SaaS-bro sentence openers,
invented competitor pricing brackets, and brand-name leakage on
`(no product mention)` pillars. The worker was deployed at version
`5c39b808-e8e5-4dfd-a55e-547ec87bd425` carrying these fixes.

---

## How to test

1. **Sign in to socialaistudio.au as the workspace owner** for SocialAI
   Studio itself (the dogfood workspace — `users.business_type =
   'social media agency'` or similar, resolves to the `tech-saas-agency`
   archetype via `src/data/archetypes.ts`).

2. **Navigate to** Smart AI tab → Smart Schedule sub-mode. Click
   **Generate Smart Schedule** with the default settings (7 posts, both
   platforms enabled). The frontend calls `generateSmartSchedule` in
   `src/services/gemini.ts:2085`, which runs the same `processOne`
   post-flight scrubber added in #142 against every generated post.

3. **Pull the results for review**:
   - **Admin UI**: open the Calendar tab; the 7 new Scheduled posts
     appear with the workspace's pillar shown in each card.
   - **Direct D1 query**: see the SQL block below. The workspace owner's
     `user_id` is in their Clerk session (visible in browser devtools →
     Network → any `/api/*` call → `Authorization` header sub claim).

4. **Score each post against the 7 checks below**. The pass bar is *every
   post passes every check*. One failure = regenerate and re-test.

---

## What to look for — 7-check failure pattern checklist

For each of the 7 generated posts, verify:

- [ ] **#1 — Em-dash compound-word artifacts.** No occurrences of
      `\w-\w` patterns that should have been " — " — e.g. `money-and`,
      `exist-you`, `failure-it's`. The fix in `gemini.ts` converts
      em-dash to ` — ` (spaced) so adjacent words don't fuse during JSON
      sanitization.
- [ ] **#2 — `$X/moWord` word fusion.** No fab-pattern scrubber
      artifacts where pricing claims like `$29/mo` ran into the next
      word — e.g. `$29/moWhat's your stack?`. The fix swapped 30
      empty-string replacements for single-space replacements.
- [ ] **#3 — `We built SocialAI Studio because...` opener.** Sentence
      MUST NOT start with this pattern. The fix added a BANNED_PATTERN
      anchored to sentence start.
- [ ] **#4 — `Most small business owners don't...` opener.** Same
      sentence-start anchor — must not appear.
- [ ] **#5 — Brand name in `(no product mention)` pillar posts.** If a
      post's `pillar` field contains `(no product mention)` (e.g.
      `Tactical SMB Tip (no product mention)`), the post body MUST NOT
      mention "SocialAI Studio", "SocialAI", or "Studio" as the brand.
      `processOne` enforces this post-flight and triggers auto-recovery;
      the recovery re-check must have passed.
- [ ] **#6 — Invented competitor pricing.** No claims like
      `Existing tools cost $500-$1,500/month`, `Most platforms charge
      $200-$400`, or any other invented competitor pricing bracket.
      The fab pattern lives in `shared/fabrication-patterns.ts`.
- [ ] **#7 — Pillar-name compliance.** Every post's `pillar` field is
      one of these 5 verbatim strings from
      `src/data/archetypes.ts:154` (`tech-saas-agency` archetype):
  - `Tactical SMB Tip (no product mention)`
  - `Industry Hot Take (one strong opinion)`
  - `Behind the Build (real moment, no pitch)`
  - `Free Resource or Framework`
  - `Personal Lesson Learned (founder voice)`

A pillar value that doesn't match exactly means the LLM made up a pillar
name, which is a separate slip-through worth reporting.

---

## D1 spot-check SQL

Run via `wrangler` against the production binding (`socialai-db`,
binding `DB`, id `6295841e-e5f7-4355-b0e0-c5f22e58d99d`). All queries
assume you have already resolved the workspace owner's `user_id` —
substitute it for `:uid` in each query.

### Pull the 7 most recent posts in the SocialAI Studio workspace

```bash
npx wrangler d1 execute socialai-db --remote --command "
SELECT id, platform, pillar, scheduled_for, substr(content, 1, 280) AS preview
FROM posts
WHERE user_id = ':uid' AND client_id IS NULL
ORDER BY created_at DESC
LIMIT 7;
"
```

### #1 — em-dash compound-word artifacts (literal hyphen between two letters where an em-dash space should be)

```bash
npx wrangler d1 execute socialai-db --remote --command "
SELECT id, pillar, content
FROM posts
WHERE user_id = ':uid' AND client_id IS NULL
  AND created_at > datetime('now', '-1 hour')
  AND (
    content LIKE '%-and %' OR content LIKE '%-you %' OR content LIKE '%-it''s %'
    OR content LIKE '%-but %' OR content LIKE '%-so %' OR content LIKE '%-because %'
  );
"
```
*Pass = empty result set.*

### #2 — `$X/moWord` word-fusion artifacts

```bash
npx wrangler d1 execute socialai-db --remote --command "
SELECT id, content
FROM posts
WHERE user_id = ':uid' AND client_id IS NULL
  AND created_at > datetime('now', '-1 hour')
  AND content GLOB '*$*/mo[A-Za-z]*';
"
```
*Pass = empty result set.* (GLOB `[A-Za-z]` catches any letter immediately after `/mo` without an intervening space.)

### #3 + #4 — banned sentence openers

```bash
npx wrangler d1 execute socialai-db --remote --command "
SELECT id, pillar, substr(content, 1, 120) AS opening
FROM posts
WHERE user_id = ':uid' AND client_id IS NULL
  AND created_at > datetime('now', '-1 hour')
  AND (
    content LIKE 'We built SocialAI Studio because%'
    OR content LIKE 'Most small business owners don''t%'
    OR content LIKE 'Ready to %?'
  );
"
```
*Pass = empty result set.*

### #5 — brand name in `(no product mention)` pillar

```bash
npx wrangler d1 execute socialai-db --remote --command "
SELECT id, pillar, content
FROM posts
WHERE user_id = ':uid' AND client_id IS NULL
  AND created_at > datetime('now', '-1 hour')
  AND pillar LIKE '%(no product mention)%'
  AND (
    content LIKE '%SocialAI Studio%'
    OR content LIKE '%SocialAI %'
  );
"
```
*Pass = empty result set.* If non-empty, `processOne`'s recovery did not
catch the brand-name leak — file a follow-up bug.

### #6 — invented competitor pricing brackets

```bash
npx wrangler d1 execute socialai-db --remote --command "
SELECT id, content
FROM posts
WHERE user_id = ':uid' AND client_id IS NULL
  AND created_at > datetime('now', '-1 hour')
  AND (
    content GLOB '*[Ee]xisting tools cost*'
    OR content GLOB '*[Mm]ost platforms charge*'
    OR content GLOB '*\$[0-9]*-\$[0-9]*/month*'
    OR content GLOB '*\$[0-9]*-\$[0-9]*/mo*'
  );
"
```
*Pass = empty result set.*

### #7 — pillar-name compliance (lists any post whose pillar isn't one of the 5 verbatim strings)

```bash
npx wrangler d1 execute socialai-db --remote --command "
SELECT id, pillar, substr(content, 1, 80) AS preview
FROM posts
WHERE user_id = ':uid' AND client_id IS NULL
  AND created_at > datetime('now', '-1 hour')
  AND pillar NOT IN (
    'Tactical SMB Tip (no product mention)',
    'Industry Hot Take (one strong opinion)',
    'Behind the Build (real moment, no pitch)',
    'Free Resource or Framework',
    'Personal Lesson Learned (founder voice)'
  );
"
```
*Pass = empty result set.* A non-empty result means the model invented a
pillar name, which is upstream of #142 and worth raising as a separate
issue.

---

## If a check fails

1. Save the offending post's `id` and `content`.
2. Re-run the Smart Schedule generator. If the same pattern reappears
   on the second pass, the post-flight scrubber isn't catching it —
   the regex in `src/services/gemini.ts` (for em-dash, openers, pillar
   gate) or `shared/fabrication-patterns.ts` (for fab patterns) needs a
   tightening fix.
3. Open a follow-up issue with the offending post copy-pasted verbatim
   so the next PR has a concrete failure case to test against.
