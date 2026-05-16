# Rollout Status — ABORTED AT PRE-FLIGHT

**Run start:** 2026-05-16 ~01:15 UTC
**Run end:** 2026-05-16 ~01:20 UTC (aborted at pre-flight)
**Lead account:** github.com user `3dhuboz` / wrangler `steve@3dhub.au` (CF account `6700423b76671a05d196916b43410458`)
**Prod D1 (from `workers/api/wrangler.toml`):** `socialai-db` (id `6295841e-e5f7-4355-b0e0-c5f22e58d99d`)

The rollout instructions are explicit: *"If any preflight check finds an UNEXPECTED blocker (conflicts, required reviews, branch protection violations), STOP and report. Don't attempt to merge."*

Three independent unexpected blockers were found. **No PRs were merged, no D1 migrations were applied, the staging D1 was not created.** Production D1 is untouched.

---

## Auth — OK

| Check | Result |
| --- | --- |
| `gh auth status` | OK — logged in to github.com as `3dhuboz`, token scopes include `repo` + `workflow` |
| `wrangler whoami` | OK — `steve@3dhub.au`, account `6700423b76671a05d196916b43410458`, has `d1 (write)` |
| `git fetch origin --prune` | OK (no output) |
| Main branch protection | NONE (404 — `main` is unprotected, so admin-bypass not needed; conventional merges allowed) |

---

## Pre-flight PR status (snapshot at run time)

| PR  | Tier | Base | Head | Mergeable | mergeStateStatus | CI required check | Blocker? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 86  | T1   | `main` | `claude/revenue-integrity-pr-c` | **CONFLICTING** | **DIRTY** | Pages: SUCCESS (no `typecheck-and-build` ran for this branch — pre-CI-workflow PR) | **YES — merge conflicts vs main** |
| 100 | T1   | `claude/revenue-integrity-pr-c` (NOT main) | `claude/ai-pipeline-maturity` | MERGEABLE | UNSTABLE | `typecheck-and-build` **FAILURE** | **YES — base is #86's branch + CI red** |
| 89  | T2   | `main` | `claude/ops-ci-cron` | UNKNOWN | UNKNOWN | `typecheck-and-build` SUCCESS, Pages preview FAILURE x2 | Soft — Pages preview red, CI green |
| 90  | T2   | `main` | `claude/security-auth-bugs` | UNKNOWN | UNKNOWN | all SUCCESS | None |
| 95  | T2   | `main` | `claude/frontend-lazy-errorboundary` | UNKNOWN | UNKNOWN | all SUCCESS | None |
| 91  | T2   | `main` | `claude/fb-app-review-package` | MERGEABLE | CLEAN | all SUCCESS | None |
| 93  | T2   | `main` | `claude/workers-middleware-foundation` | MERGEABLE | UNSTABLE | `typecheck-and-build` **FAILURE** | **YES — CI red on required check** |
| 88  | T3   | `main` | `claude/db-indexes-missing-tables` | MERGEABLE | CLEAN | all SUCCESS | None |
| 94  | T3   | `main` | `claude/ai-cost` | MERGEABLE | CLEAN | all SUCCESS | None |
| 92  | T3   | `main` | `claude/whitelabel-brands-foundation` | MERGEABLE | CLEAN | all SUCCESS | None |
| 98  | T4   | `main` | `claude/test-coverage-stable` | MERGEABLE | CLEAN | all SUCCESS | None (already green — flux-dev test skew apparently resolved or never landed in `main` check) |

Several rows show `UNKNOWN` mergeStatus — GitHub re-computes that lazily; the actually-blocking states are PR #86 (DIRTY) and the CI failures on #93 / #100.

---

## Blockers — root-cause analysis

### Blocker 1 — PR #86 has merge conflicts with `main` (DIRTY/CONFLICTING)

PR #86 (`image-pipeline: FLUX-dev migration + drift fixes + cron perf`) is the foundation for Tier 1 and a prerequisite for #100 and (per rollout doc) the flux-dev test skew on #98.

Between when the PR was opened and now, four PRs were merged into main (all timestamped 01:06–01:07 UTC, ~10 min before this run started):

- #87 — `sec: harden auth boundaries + tighten frame-ancestors + scope activations`
- #96 — `feat(bridge): cancel-from-pennybuilder endpoint to deprovision PB-sourced subs`
- #97 — `perf(cost): throttle backlog regen + critique to every 6h`
- #101 — `test: bridge HMAC roundtrip + refactor embed-token helpers into shared lib`

PR #86 touches 28 files. The most recent commits on `claude/revenue-integrity-pr-c` (`af97a9c refactor: extract parseForbiddenSubjects to shared/`, `cee8bdc test(image-safety): coverage for needsSafeFallback filter`, `95923b5 fix(image-safety): align worker buildSafeImagePrompt with frontend filter`, etc.) overlap with the auth-hardening and shared-lib refactor surface that PR #87 and #101 just landed. GitHub flags the result as CONFLICTING.

**This is the load-bearing blocker.** Without #86, Tier 1 cannot start, which means Tier 4 (#98 — which only flips green after #86 merges per the documented flux-dev skew) and #100 (base is the #86 branch, not main) are both also blocked.

**Required user action:** rebase `claude/revenue-integrity-pr-c` onto current `main` and resolve the conflicts manually. The conflicts almost certainly involve `workers/api/src/shared/` and the security boundary files. After rebase, force-push the branch, wait for CI, then re-run this rollout from the top.

### Blocker 2 — PR #100's base is NOT `main`

PR #100 (`[ai] AI pipeline maturity ...`) has `baseRefName: claude/revenue-integrity-pr-c`, i.e. it's stacked on top of #86. `gh pr merge 100 --squash --delete-branch` would either:

- fail because the base branch (`claude/revenue-integrity-pr-c`) doesn't exist after #86 merges and the branch is deleted, OR
- target the wrong base if executed before #86 lands.

**Required user action:** after #86 is merged and the branch deleted, retarget #100's base to `main` (via `gh pr edit 100 --base main`). GitHub may also auto-retarget; either way, this must happen before merge.

### Blocker 3 — PR #93 and PR #100 both fail CI on `typecheck-and-build`

Both runs fail at the **`npm ci --prefix workers/api`** step with `EUSAGE: 'npm ci' can only install packages when your package.json and package-lock.json are in sync. Missing: esbuild@0.28.0 from lock file [+ all platform-specific @esbuild/* subpackages]`.

This is a `package-lock.json` drift on the branches relative to the lockfile expectations on `main`. Most likely either:

- one of the four recently-merged PRs (#87/#96/#97/#101) bumped `esbuild` to `0.28.0` in `main`'s `package.json` but the older branches still carry the pre-bump `package-lock.json`, OR
- the inverse — branches added `esbuild@0.28.0` to `package.json` without regenerating the lockfile.

Either way, this is a **real CI failure**, not the documented flux-dev temporal skew that the rollout doc warned about for #98. PR #93's instructions explicitly say "Prep D verified no frontend regression" — this isn't a frontend regression, it's a workers-API dependency drift, but it still blocks the required check.

**Required user action:** on each affected branch (`claude/workers-middleware-foundation` for #93, `claude/ai-pipeline-maturity` for #100, and any other branch carrying this drift) run `cd workers/api && npm install` to regenerate the lockfile, commit, push. CI will go green.

---

## Soft observation (not a hard blocker)

PR #89 (`[ops] CI tests + staging D1 split + observability + cron correctness`) shows `Cloudflare Pages: picklenick-social` and `Cloudflare Pages: streetmeats-social` as FAILURE while `typecheck-and-build` is green. Pages previews aren't usually required-checks (they're informational), so this likely does not block merge — but worth eyeballing before pushing the button. If the deploys-preview failures indicate the staging-D1 split breaks something in the Pages build, that's load-bearing for the rollout.

---

## What was NOT done

- **No PRs merged.** All 11 PRs are in the same state they were before this run.
- **No D1 migrations applied.** `socialai-db` (prod) is untouched. v17/v18/v19 schemas have NOT been run.
- **Staging D1 NOT created.** `socialai-db-staging` does not exist.
- **wrangler.toml not modified.** Still points at `database_id = "6295841e-e5f7-4355-b0e0-c5f22e58d99d"` for both prod and `env.staging` (line 97).
- **No commits, no force-pushes, no branch deletions** on any of the 11 PRs or `main`.

The defined partial state on the production D1 is: **none of v17, v18, or v19 applied.** Nothing to roll back.

---

## What the user must do manually before the rollout can be re-run

In this order:

1. **Resolve PR #86 conflicts.** Rebase `claude/revenue-integrity-pr-c` onto `main`, fix conflicts (likely in `workers/api/src/shared/` / security boundary code that overlaps with #87/#101's changes), force-push the branch, wait for CI.

2. **Fix `package-lock.json` drift on #93 and #100** (and any other branch that fails the same way after #86 lands). On each branch: `cd workers/api && npm install`, commit the regenerated `package-lock.json`, push. Verify `typecheck-and-build` goes green.

3. **Retarget PR #100 base to `main`.** Either let GitHub auto-retarget after #86 merges + its branch is deleted, or run `gh pr edit 100 --base main` explicitly.

4. **Re-run this rollout from the top** once all three are done. The same script will pass pre-flight and proceed through Tier 1 → Tier 5.

5. **Out of scope of this rollout (user manual follow-up, per the original instructions):**
   - Paste the staging D1 UUID into `workers/api/wrangler.toml` line 97 (replacing `database_id = "6295841e-..."` in the `[[env.staging.d1_databases]]` block) — once the staging DB exists. Currently the staging block points at the same UUID as prod (line 97 vs line 23). This rollout would have created `socialai-db-staging` and reported the UUID for that paste.
   - Facebook App Review submission (PR #91's package).
   - Staging deploy verification.
   - Meta/FB dashboard config, OAuth scopes, screencasts.

---

## Recommended re-run command (after blockers are fixed)

The same rollout prompt, unchanged. Pre-flight will re-validate every PR; if everything is clean it will proceed through Tier 1–5 automatically.
