# SocialAI Growth Intelligence Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver self-critiquing Protected Autopilot and account-specific organic reach optimisation without changing existing publishing until each safety gate passes.

**Architecture:** The program is split into four independently deployable releases. Every release is feature-flagged, tenant-scoped, tested in shadow mode, and reversible; a release may not unlock the next release's production behaviour until its own acceptance gates pass.

**Tech Stack:** Cloudflare Workers, Hono, D1, Workers AI, Anthropic/OpenRouter, React, TypeScript, Vitest, Wrangler, Facebook/Instagram publishing.

**Starting Point:** The repository already contains schema v36 customer-feedback fields and the existing BBQ/Macca root-cause image fixes plus publish-time guardrails. This program starts at v37 and adds independent release safety; it does not replace or weaken the existing generation chokepoint.

---

## Release Train

1. [Release 1: Shadow Foundation](./2026-07-14-release-1-shadow-foundation.md)
   - D1 decision receipts and critic-verdict records.
   - Tenant-safe workspace mode resolver.
   - Read-only shadow evaluator.
   - All flags default off; publishing cannot change.
2. [Release 2: Independent Self-Critique](./2026-07-14-release-2-independent-self-critique.md)
   - Text, fact, brand, repetition, platform, business-harm, and image critics.
   - Two-pass self-correction.
   - Independent Release Judge.
   - Shadow and approval behaviour before enforcement.
3. [Release 3: Organic Reach Engine](./2026-07-14-release-3-organic-reach-engine.md)
   - Confirmed geography and private audience segments.
   - Per-account timing, local keywords, hashtags, and media direction.
   - Per-post Reach Plans for Facebook and Instagram.
4. [Release 4: Learning And Protected Autopilot](./2026-07-14-release-4-learning-protected-autopilot.md)
   - Outcome Ledger and blended business score.
   - Confidence-weighted strategy learning and experiments.
   - Conversion attribution and anonymous archetype aggregates.
   - One-time Protected Autopilot consent and product-level promotion gates.

## Non-negotiable Execution Rules

- Create a dedicated `codex/customer-learning-brain` branch and D-drive worktree before implementation. Do not implement directly on `main`.
- Apply migrations in numeric order: `v37`, `v38`, then `v39`.
- Export production D1 to `D:\GitHubBackup\SocialAi\database` immediately before each production migration.
- Run each migration against `socialai-db-staging` and verify table shape before production.
- Keep `LEARNING_BRAIN_ENABLED=false` until Release 1 verification is complete.
- Keep release enforcement disabled until Release 2 shadow and approval evidence passes.
- Preserve `clients.status = 'on_hold'`; Hugheseys Que must remain excluded unless Steve separately authorises removing the hold.
- Preserve `generateImageWithGuardrails`, the BBQ cut-accuracy rules, forbidden-subject loading, image critique/retry, and publish-time quality threshold. A new critic supplements these root fixes; it is not a substitute for them.
- Keep Higgsfield behind its existing production gate until a documented server-to-server API, deploy-safe credentials, critic/retry path, and fal.ai fallback are proven.
- A critic or learning failure must not change existing publishing while the workspace is `off` or `shadow`.
- `off` and `shadow` are rollout states, not permanent publish bypasses. After permanent preflight enforcement is promoted, every active workspace resolves to at least `approval`; only a consented, fully gated workspace resolves to `protected_autopilot`.
- The generator cannot create critic verdicts or a release decision for its own output.
- Protected Autopilot requires one-time workspace consent and green release receipts, not permanent per-post human approval. Only unresolved release-critical risk is held.
- Protected Autopilot also requires a configured per-workspace AI-cost ceiling, healthy current-month spend, and a fresh product-readiness receipt; missing telemetry never counts as safe.
- Organic Reach uses paid-campaign planning discipline but must never claim or imply paid Meta distribution, guaranteed reach, or protected-trait targeting.
- Commit after each green task. Deploy only at the explicit deploy steps in each release plan.

## Required Tenancy Coverage

- Own workspace: `posts.owner_kind='user'`; scope by authenticated `user_id` plus `workspace_key='__owner__'`.
- Agency/white-label client: `posts.owner_kind='client'`; scope by authenticated owner plus client ID. Portal access may inspect only its provisioned client.
- Shopify embedded app: `posts.owner_kind='shop'`; scope by shop-domain sentinel user plus `workspace_key='shop:<canonical-domain>'`. Critic context comes from `shopify_stores.profile`, `shopify_facts`, and shop-owned posts, never from an unrelated `users.profile` row.
- Every release must test all three ownership kinds. A tenancy kind without verified context and a consent-capable settings route remains `shadow`; it cannot silently inherit another workspace or enter Protected Autopilot.
- Shopify uninstall, client deletion, and account deletion must remove their learning/reach/outcome rows and invalidate affected aggregate rows.

## Program Completion Evidence

- Full Worker test suite and typecheck pass after each release.
- Staging migration, staging smoke, production backup, production migration, deploy, and live health evidence are recorded.
- Shadow receipts prove zero content, schedule, status, or publishing mutations.
- Protected Autopilot test corpus has no known severe false pass and fewer than 5 percent false holds.
- Required critic and Release Judge availability is at least 99.5 percent with retries and fallback routing.
- The latest consecutive pilot window has complete decision receipts, no critical replay/tenancy/media bypass, no publishing regression, at least 15 percent predicted-quartile lift, and positive rank correlation.
- Every unattended post has a green release receipt and recorded one-time workspace consent.
- No active publishable workspace remains in an effective `off` or `shadow` mode; invalid, deleted, cross-owner, and on-hold identities make zero remote publish calls.
- GitHub push and D-drive Codex save complete after each release.
