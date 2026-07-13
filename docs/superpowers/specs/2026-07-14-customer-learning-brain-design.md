# Customer Learning Brain Design

Date: 2026-07-14
Status: Approved design, awaiting written-spec review

## 1. Purpose

SocialAI Studio already generates posts, records Facebook engagement facts,
scores draft posts, critiques image-caption fit, performs safe recommendation
fixes, and sends weekly reviews. These capabilities currently operate as
separate tools. They do not maintain one durable, evidence-based strategy that
improves future posts for each customer.

The Customer Learning Brain connects those capabilities into a closed learning
loop. It optimises for measurable business outcomes while preserving the
existing quality, safety, scheduling, and publishing controls.

The first release is not a self-training foundation model. It is a transparent,
confidence-weighted decision system built around existing SocialAI services and
Cloudflare D1 data.

Trust is a product requirement, not an optional setting. The model that creates
a post cannot approve its own output. Independent critics must challenge the
post before release. Once a customer enables protected autopublishing, a clean
post should critique, self-correct if needed, and publish without human action.
Human review is an exception reserved for unresolved release-critical risk.

## 2. Goals

- Improve each customer's blended business outcome score over its own baseline.
- Learn which topics, offers, hooks, calls-to-action, visual directions, and
  posting windows work for each customer.
- Give new customers a safe curated archetype baseline and, when privacy and
  evidence thresholds are met, anonymous aggregate patterns from similar
  businesses.
- Build a confirmed geographic market, predicted audience segments, and a
  platform-specific organic reach strategy for every workspace.
- Optimise Facebook and Instagram timing, local language, hashtags, and media
  choice from each account's measured results.
- Run as Protected Autopilot. Optimisation may choose among safe candidates, but
  it cannot override a quality or safety failure.
- Make every selection, block, experiment, and learning update explainable and
  reversible.
- Independently self-critique every customer-visible post before it can be
  approved or published.
- Introduce the system in shadow mode before it changes customer-visible posts.
- Preserve existing publishing behaviour whenever the learning layer is
  unavailable or disabled.
- Preserve one-time customer control over whether protected autopublishing is
  enabled without requiring approval for every post.

## 3. Non-goals

- Replacing the current post generator, image generator, critic, scheduler, or
  publisher.
- Automatically changing prices, dates, offers, legal claims, or business facts.
- Training on or exposing another customer's raw captions, images, identity,
  or customer-level embeddings.
- Enabling Higgsfield through desktop OAuth. Higgsfield remains behind its
  documented production API and credential gate.
- Building a fully autonomous multi-week campaign agent in this release.
- Claiming guaranteed reach, virality, leads, or sales.
- Silently enabling autopublishing for an existing or newly onboarded customer.
- Claiming organic posts can directly target or receive the guaranteed
  distribution available through paid Meta advertising.
- Inferring protected personal traits, scraping private audience data, or
  unattended posting into Facebook groups.

## 4. Core Architecture

The learning layer contains six bounded components.

### 4.1 Outcome Ledger

The Outcome Ledger stores immutable measurements for each published post at
24-hour, 72-hour, and 7-day windows. Each record includes:

- The post and workspace identifiers.
- The decision and strategy versions used when the post was selected.
- Creative variables such as topic, hook type, offer type, CTA, content pillar,
  format, visual direction, and scheduled time bucket.
- Available platform metrics.
- Tracked click, QR, coupon, message, lead, booking, and sales signals when
  available.
- Measurement completeness and source status.
- A versioned blended outcome score.

Measurements are append-only. Later metric windows do not overwrite earlier
snapshots.

### 4.2 Private Strategy Memory

Each workspace has a versioned strategy profile containing confidence-weighted
preferences and avoidances. A learning signal records:

- The creative variable and value being evaluated.
- The business objective and archetype context.
- Sample count, estimated effect, confidence, and freshness.
- Supporting outcome identifiers.
- Whether the signal is tentative, usable, proven, rejected, or operator-locked.

Strategy updates are gradual. A single unusually strong or weak post cannot
radically alter the profile. Evidence decays over time so old patterns do not
remain dominant when audiences, seasons, menus, or offers change.

The initial decay half-life is 90 days. Operator-locked rules do not decay.

### 4.3 Archetype Baseline

New customers start with curated rules already defined for their business
archetype. Anonymous fleet evidence may supplement those rules only when one
archetype-variable cohort contains at least:

- 10 distinct workspaces; and
- 100 eligible measured posts.

Shared aggregates contain only counts, coarse variable labels, effect ranges,
and confidence. They never contain captions, images, names, workspace IDs,
customer IDs, raw facts, or customer-level vectors.

If the threshold is not met, the curated baseline remains the only cold-start
source.

### 4.4 Candidate Lab

For each post request, the Candidate Lab creates three meaningfully different
text and image-direction candidates. Candidate differences must be tagged so
the system knows what it is comparing. At least one of these must vary a single
learning variable while keeping the rest of the brief stable.

To control cost, full image generation runs only for the candidate selected
after text, prompt, strategy, and risk evaluation. An image-style experiment
may generate one additional image when the workspace's experiment budget allows
it.

Approximately 85 percent of selections exploit proven patterns. Approximately
15 percent test one bounded variable. Operator settings can reduce the
experiment percentage to zero, but cannot raise it above 20 percent in the
first release.

### 4.5 Independent Self-Critique Council

The generator never grades or releases its own output. Each candidate is sent
to independent, narrowly scoped evaluators that return structured verdicts and
evidence:

- `Brand Critic`: checks voice, customer instructions, forbidden subjects, and
  reputational fit.
- `Fact Critic`: checks every price, date, offer, location, product, service,
  availability, and factual claim against verified workspace facts.
- `Image Critic`: checks image-caption alignment, anatomy, realism, embedded
  text, logos, unsafe content, and archetype fit.
- `Repetition Critic`: checks recent posts for repeated hooks, wording, topics,
  CTAs, and near-duplicate visual concepts.
- `Platform Critic`: checks platform policy, format, link, and regulated-category
  constraints.
- `Business Harm Critic`: takes an adversarial position and answers, "How could
  publishing this damage, mislead, embarrass, or confuse this business?"

Critics receive the candidate, verified facts, brand rules, and recent-content
context. They do not receive the generator's hidden reasoning or a suggestion
that the candidate is probably acceptable.

Critics run when their required inputs exist. Text, fact, brand, repetition,
platform, and business-harm checks run before expensive media creation. The
Image Critic runs after the Media Director has produced the final caption-media
pair, followed by a complete final release pass.

Each critic returns `PASS`, `WARN_REPAIRABLE`, or `BLOCK`, plus a severity,
confidence, evidence, and exact repair instructions. An advisory warning cannot
hold a post by itself. Only a release-critical `BLOCK`, an unresolved required
fact, or an unavailable release-critical check after retries can prevent
protected autopublishing.

When a separate provider is configured, the Business Harm Critic should use a
different model family from the generator. At minimum, it must use a separate
call, isolated prompt, and fresh context. Provider independence is preferred;
logical independence is mandatory.

### 4.6 Self-Correction Loop

A `WARN_REPAIRABLE` verdict returns precise repair instructions. The generator
revises only the flagged fields and then sends the entire revised post through
all critics again from scratch. It cannot reuse prior passes. If all
release-critical verdicts then pass, the post continues automatically without
human approval.

The loop is capped at two revisions. Transient critic failures use bounded
retries and a configured fallback provider while the post remains queued. A
remaining release-critical block, persistent missing required verdict near the
publishing deadline, or unresolved release-critical disagreement holds the post
for human approval. Hard failures are never auto-repaired into an autopublish
decision.

### 4.7 Release Judge

The Release Judge receives the structured critic verdicts, verified facts, risk
classification, and decision receipt. It cannot alter critic results and cannot
approve a candidate when a release-critical verdict is absent or blocking. It
may approve advisory warnings after successful automatic repair or when they do
not represent business harm.

Its allowed outputs are:

- `PASS_GREEN`: eligible for the workspace's configured publishing flow.
- `HOLD_AMBER`: saved as a draft with plain-English reasons and required human
  action.
- `BLOCK_RED`: not publishable; operator intervention is required.

The Release Judge is a separate model call from generation. Where configured,
it should use a different model family. If the judge is temporarily unavailable,
the system retries and uses the configured fallback judge before holding the
post. A persistent judge outage near the publishing deadline fails closed to
`HOLD_AMBER`.

### 4.8 Decision Gate

The Decision Gate combines the Self-Critique Council and Release Judge while
keeping two independent dimensions:

1. Business outcome potential.
2. Quality and safety eligibility.

Quality and safety are not blended into the performance score. A candidate
that fails a hard rule is ineligible even if its predicted business outcome is
high.

Hard rules include the existing forbidden-subject, image-caption, archetype,
and publish-time protections, plus:

- Explicit brand-rule and forbidden-subject conflicts.
- Unsupported factual claims.
- Unverified prices, dates, offers, or availability.
- Near-duplicate content that remains after automatic revision.
- Platform or regulated-category restrictions.
- Broken links, missing required assets, or stale campaign information.

The gate emits a decision receipt containing candidate scores, every critic
verdict, repair history, rule results, the selected strategy signals, operating
mode, model/provider versions, release decision, and a plain-English
explanation.

### 4.9 Learning Job

The Learning Job compares predictions with measured outcomes and updates the
private strategy profile. It runs after the 72-hour and 7-day windows, with the
7-day result treated as final for the initial release.

Updates are confidence-weighted and capped so no weekly run can move a strategy
weight by more than 10 percentage points. A pattern remains tentative until at
least three comparable outcomes exist. It becomes usable after five comparable
outcomes and proven only after ten outcomes with a consistent directional
effect.

Correlation alone does not create an operator-visible causal claim. The system
uses language such as "associated with stronger results" unless a controlled
experiment isolated the variable.

### 4.10 Organic Reach Engine

The Organic Reach Engine applies the decision discipline of paid promotion to
organic Facebook and Instagram publishing. It cannot buy placement or guarantee
distribution. It can improve local relevance, audience-message fit, timing,
format selection, creative testing, and conversion attribution.

#### 4.10.1 Organic Reach Profile

Each workspace receives a versioned profile containing:

- Verified base location and timezone.
- Customer-confirmed service or delivery radius.
- Included towns, suburbs, and regions.
- Excluded or unsupported locations.
- Facebook and Instagram account context.
- Three to five broad commercial audience segments.
- Account-level cadence, format, and media preferences.

SocialAI proposes the initial geography from verified business details. The
customer confirms it once and may change it later. The engine cannot silently
expand the service area. A material location, service-boundary, or business
identity change requires one new confirmation, not approval of every post.

Audience segments describe commercial needs and buying context, such as local
families, trade customers, event organisers, or repeat buyers. They may use
aggregate page engagement and verified business context. They must not infer or
target protected traits, precise individual location, or private personal data.

#### 4.10.2 Reach Plan

Every candidate request receives a structured Reach Plan containing:

- Business objective and intended audience segment.
- Geographic focus and a verified local relevance angle.
- Facebook and Instagram treatment.
- Predicted posting window with confidence.
- Local-keyword and hashtag strategy.
- Recommended media format and asset source.
- Success signal and the single experiment variable, if any.

The Reach Plan becomes part of the decision receipt. It does not give the
generator permission to invent a local event, landmark, customer, premises,
offer, or service area.

#### 4.10.3 Timing And Cadence Model

Timing begins with the confirmed timezone and curated archetype baseline. It
then learns account-specific windows by audience segment, business objective,
platform, media type, day, and recent results. It also considers recent posting
cadence and content similarity so the same audience is not repeatedly served
near-duplicate posts.

The output is a ranked time window rather than a guaranteed best hour. Missing
or low-confidence performance data falls back to the last-known-good account
window and does not hold an otherwise safe post.

#### 4.10.4 Hashtag And Local-keyword Model

Facebook and Instagram receive separate language strategies. Candidate terms
come from verified towns and service areas, business category, product or
service language, brand and campaign terms, and the account's measured history.

The engine excludes irrelevant, misleading, repetitive, restricted, and spammy
terms. It rotates controlled sets and evaluates useful reach, profile actions,
messages, clicks, and conversions rather than rewarding raw hashtag volume.

#### 4.10.5 Media Director

The Media Director chooses the format and source in this order:

1. Use a suitable rights-cleared real customer asset when available.
2. Select image, carousel, poster, reel, or video from the objective, audience,
   platform, and account evidence.
3. Generate media only when the approved asset library has no suitable option.
4. Create full media only for the winning candidate, except for one explicitly
   budgeted media experiment.
5. Validate crop, aspect ratio, text, logo, rights, factual claims, realism,
   brand fit, and audience suitability.
6. Send the completed caption-media combination through the Independent
   Self-Critique Council and Release Judge.

Generated media cannot present invented staff, customers, products, premises,
landmarks, testimonials, or events as real. Uncertain media is regenerated or
replaced before release.

#### 4.10.6 Paid-style Organic Optimisation

The engine maps paid-promotion discipline into organic controls:

| Paid promotion concept | Organic SocialAI equivalent |
| --- | --- |
| Audience targeting | Segment-specific copy, local context, and creative |
| Placements | Facebook and Instagram format adaptation |
| Creative variants | Controlled hook, CTA, media, and timing experiments |
| Campaign budget | Posting cadence and experiment allowance |
| Frequency control | Repetition and audience-fatigue limits |
| Conversion tracking | Tracked links, QR codes, offer codes, and feedback |
| Ad optimisation | Continuous learning from measured account outcomes |

Only one meaningful variable changes in an experiment. Underperforming posts
inform future choices; they are not automatically deleted or rewritten after
publication. The engine does not use fake engagement, mass tagging, irrelevant
trends, or spammy frequency.

## 5. Blended Business Outcome Score

The score is calculated per workspace and is used for relative improvement,
not cross-business league tables. It is normalised to a 0-100 scale against the
workspace's rolling history.

When all signal categories are available, the initial weight allocation is:

| Signal category | Weight |
| --- | ---: |
| Confirmed sales, bookings, or completed orders | 40% |
| Qualified calls, messages, enquiries, or leads | 25% |
| Tracked clicks, QR scans, or offer-code actions | 15% |
| Shares, saves, and substantive comments | 15% |
| Reactions and reach efficiency | 5% |

Missing categories are marked unavailable and the remaining weights are
renormalised. They are not treated as zero. The score records a completeness
grade so an engagement-only result cannot appear as equally trustworthy as a
sale-confirmed result.

Manual outcome feedback must identify its source and may be corrected. It has
high business value but lower verification confidence than a tracked order or
coupon redemption.

## 6. End-to-end Decision Flow

1. Resolve the workspace, business objective, archetype, current campaign,
   private strategy version, Organic Reach Profile, and allowed archetype
   baseline.
2. Build the Reach Plan for audience, geography, platform, timing, language,
   hashtags, media, and success signal.
3. Build a constrained candidate brief from the Reach Plan and verified
   business facts.
4. Generate three tagged candidates.
5. Apply deterministic validation and all applicable text-stage critics.
6. Repair soft failures at most twice, rerunning every applicable critic after
   each repair.
7. Exclude every hard-failing, unresolved, or incomplete candidate.
8. Predict the blended outcome potential of remaining candidates using the
   workspace's own history first and the eligible archetype baseline second.
9. Apply the 85/15 exploit-explore policy within the configured experiment
   budget.
10. Have the Media Director create or select the winning media and send the
    completed caption-media pair through all required critics.
11. Send the complete candidate, Reach Plan, and critic record to the
    independent Release Judge.
12. Create a decision receipt and select, hold, or block the post.
13. Follow the workspace's explicit approval and publishing settings.
14. Collect outcome windows and update the private strategy, audience, timing,
    language, hashtag, and media signals when evidence is sufficient.

## 7. Operating Modes And Risk Levels

### 7.1 Modes

- `Shadow`: score, decide, and learn without changing generated posts,
  scheduling, or publishing.
- `Approval`: apply the recommended candidate to a draft but require a person
  to approve it.
- `Protected Autopilot`: allow eligible green decisions to publish unattended
  through the existing scheduler after independent critique and release.

Customers choose `Approval` or `Protected Autopilot` once during setup and can
change it later. An existing explicit autopublish setting counts as that choice;
deployment must not silently enable it for anyone else. Protected Autopilot has
no per-post approval requirement and no per-customer probation quota after the
self-critique system has passed its product-level release gates. A global kill
switch and workspace kill switch can immediately return the pipeline to
approval-only behaviour.

### 7.2 Risk levels

- `Green`: verified facts, known brand pattern, all required critics and the
  Release Judge pass, and no sensitive change. The post may follow existing
  publishing settings when the workspace has selected `Protected Autopilot`.
- `Amber`: new or unverified price, date, offer, availability, factual claim,
  unresolved unusual brand direction, or persistent release-critical system
  uncertainty. Human approval is required. An ordinary low-confidence
  performance prediction is not enough to make a post amber.
- `Red`: hard safety failure, forbidden subject, materially misleading claim,
  broken required asset, release-critical content violation, or tenant-boundary
  uncertainty. The post is blocked.

An outcome prediction failure changes a decision to the normal safe workflow.
Advisory critic warnings trigger repair or logging, not automatic holds.
Persistent release-critical critic or Release Judge failures prevent protected
autopublishing for the affected post.

Human approval is requested only when the workspace selected `Approval`, a
sensitive claim lacks a verified source, a release-critical problem remains
after two repairs, required release infrastructure remains unavailable near the
deadline, or the post is otherwise classified amber. Routine advisory warnings,
performance uncertainty, and successful automatic repairs do not require a
person.

## 8. Data Model Boundaries

The implementation should introduce dedicated tables with tenant-scoped access:

- `learning_outcomes`: immutable metric-window records and score versions.
- `learning_decisions`: candidate summaries, predictions, gates, selection,
  mode, and strategy version.
- `learning_signals`: atomic private observations and confidence state.
- `learning_profiles`: materialised last-known-good strategy versions.
- `learning_experiments`: tested variable, hypothesis, budget, status, and
  result.
- `reach_profiles`: versioned geography, timezone, platform, cadence, and
  confirmation state.
- `audience_segments`: tenant-private segment definitions, evidence, confidence,
  and status.
- `reach_plans`: immutable per-post audience, geography, timing, language,
  hashtag, media, objective, and experiment decisions.
- `archetype_aggregates`: thresholded anonymous fleet statistics.

Existing `client_facts` remains an input source but does not become the strategy
store. Existing posts retain their current critique columns and publishing
contract.

Every private table query includes both owner and workspace scope. Aggregate
building reads eligible private outcomes in a controlled job and writes only
thresholded aggregate rows. Deleting a customer deletes its private learning
records and excludes them from the next aggregate rebuild.

Workspaces with `clients.on_hold = 1` do not generate candidates, run
experiments, update strategy, or publish. Their existing records remain frozen
until the hold is removed or the customer is deleted.

## 9. Product Experience

### 9.1 Draft explanation

Every selected draft displays "Why SocialAI chose this" with:

- The business objective.
- The strongest supporting private or archetype pattern.
- Intended audience, geographic focus, platform treatment, and posting window.
- Hashtag/local-keyword rationale and selected media format.
- The variable being tested, if any.
- Expected outcome band and confidence, without guaranteed-performance claims.
- Approval or block reasons.

Every draft also displays a preflight report with the status of each critic,
the facts it relied on, any automatic revisions, and the final Release Judge
decision. A customer never has to trust a single unexplained "AI approved"
badge.

### 9.2 What's Working panel

Each workspace receives a plain-English view of:

- Strong and weak topics.
- Effective offers and CTAs.
- Visual and format patterns.
- Posting windows.
- Audience and geographic patterns.
- Hashtag, local-language, and media-format patterns.
- Confidence and sample size.
- Recent strategy changes.

Operators may lock, reject, or reset a lesson. Resets create an audit record and
restore the last approved baseline rather than deleting history silently.

### 9.3 Outcome feedback

After publication, the owner can record whether a post produced calls,
messages, bookings, sales, or no known business result. Tracked links, campaign
QR codes, and offer codes can add stronger attribution in a later slice without
changing the core architecture.

### 9.4 Admin controls

The admin dashboard exposes operating mode, confirmed geography, audience
segments, experiment budget, outcome-data completeness, learning confidence,
declining performance, repetition risk, last-known-good reach and strategy
versions, false-hold rate, and kill-switch status for every workspace.

## 10. Failure Handling And Observability

- Learning and prediction failures do not interrupt the existing safe post
  workflow.
- Missing timing or performance data falls back to the last-known-good account
  window and does not hold a safe post.
- Hashtag or local-keyword failure falls back to verified brand, category, and
  location terms.
- Media-generation failure retries or uses a suitable approved asset; it cannot
  substitute unrelated media.
- Release-critical critic, Release Judge, tenant-scope, or required-fact
  failures retry before the publishing deadline. Only unresolved failures hold
  protected autopublishing and notify the operator.
- Metric retrieval failures retry with bounded backoff and remain unknown; they
  never become a negative outcome.
- Strategy writes use version checks so concurrent jobs cannot overwrite a
  newer profile.
- Every learning run records input windows, output version, affected signals,
  skipped records, and errors.
- Every publish record links to its decision receipt and strategy version.
- Operators can roll a workspace back to any approved strategy version.
- Provider and cost telemetry is recorded per candidate stage. Cost ceilings
  prevent candidate generation from multiplying image or vision charges
  without limit.
- A weekly calibration audit rechecks a sample of green decisions with an
  independent critic. A severe false pass automatically disables protected
  autopublishing for that workspace pending operator review.
- Human rejections and corrections are recorded as critic-calibration evidence,
  not blindly treated as business-performance lessons.
- Hold rate, false-hold rate, critic availability, repair success, and severe
  false-pass rate are first-class operational metrics. The target is for at
  least 95 percent of legitimate routine posts to complete protected
  autopublishing without human action.

## 11. Rollout

### Phase 1: Historical replay

Build the Outcome Ledger, Organic Reach Profile, and evaluation logic. Replay
eligible historical posts without changing production behaviour. Run Reach
Plans, the full Self-Critique Council, and the Release Judge against known good
and deliberately unsafe examples. Check whether predicted high cohorts
meaningfully outperform predicted low cohorts within each workspace.

### Phase 2: Shadow mode

Generate Reach Plans, timing, language, hashtag, media recommendations, decision
receipts, and predictions for live posts while the current pipeline remains
authoritative. Use this product-level period to calibrate outcome predictions,
critic severities, repair success, false holds, and false passes before
Protected Autopilot is offered broadly.

### Phase 3: Approval pilot

Enable candidate selection for Steve's workspace and one consenting active
customer. During this temporary release-validation pilot only, selected drafts
require approval so critic false passes and false holds can be measured.
Per-post approval is removed when the product-level release gates pass.
Hugheseys Que remains excluded while its `on_hold` flag is set.

### Phase 4: Protected Autopilot

After the product-level release gates pass, any customer who selects Protected
Autopilot can use it without approving every post. Start learning experiments
at zero percent, then increase to 10 percent and finally the default 15 percent
if results and safety remain healthy. This experiment ramp does not stop normal
green posts from publishing.

### Phase 5: Archetype And Context Learning

Enable anonymous fleet aggregates only for cohorts that pass both the distinct
workspace and eligible-post thresholds. Keep curated defaults for all smaller
cohorts. Add reliable weather, local-event, and seasonal signals only after the
account-specific engine is proven, and never use unverified context as filler.

## 12. Verification Strategy

### 12.1 Unit tests

- Score weighting and missing-signal renormalisation.
- Confidence thresholds, capped updates, and 90-day decay.
- Exploit-explore selection and experiment budgets.
- Green, amber, and red risk classification.
- Required-critic completeness, disagreement handling, revision caps, and
  Release Judge fail-closed behaviour.
- Strategy version conflict handling and rollback.
- Aggregate cohort thresholds and exclusion after customer deletion.
- Geographic inclusion and exclusion, timezone windows, audience-segment
  isolation, and protected-trait rejection.
- Platform-specific language, hashtag filtering, media selection, and content
  fatigue rules.

### 12.2 Integration tests

- Complete generation-to-decision-to-outcome-to-learning flow.
- Existing release-critical critic failure blocks protected autopublishing.
- The generator cannot write critic verdicts or release its own candidate.
- Every repaired candidate reruns every required critic from scratch.
- Persistent release-critical critic timeout, malformed verdict, disagreement,
  or Release Judge outage holds the post after retries and fallback routing.
- Advisory critic warnings and outages do not hold otherwise safe posts.
- Prediction failure falls back to the existing safe workflow.
- Metric outage remains unknown and does not lower the score.
- Every private query rejects cross-workspace and cross-owner access.
- On-hold workspaces remain frozen.
- Existing post scheduling and publishing behaviour remains unchanged in
  shadow mode and when the kill switch is active.
- Wrong geography, unsupported local claims, and invented media context cannot
  receive a green release.
- Reach optimisation outages use last-known-good fallbacks without bypassing
  release-critical checks.

### 12.3 Replay and red-team tests

- Historical top and bottom performers across multiple active archetypes.
- Misleading prices, dates, offers, and unsupported claims.
- Repetitive captions and near-duplicate visual concepts.
- Off-brand and anatomically incorrect generated images.
- Prompt injection inside imported social content.
- Sparse, missing, delayed, and contradictory outcome signals.
- Persuasive but harmful drafts designed to fool a generic quality scorer.
- Wrong-customer facts, old prices, expired offers, and invented availability.
- Out-of-area locations, fabricated local events, restricted audience traits,
  irrelevant hashtags, and spammy frequency.
- Wrong aspect ratios, misleading generated locations, unlicensed assets, and
  unsuitable image or video formats.

## 13. Release Gates

Protected Autopilot cannot be released as a product capability until all of the
following are true:

- No known quality or safety critic bypass in replay or shadow testing.
- At least 30 consecutive pilot decisions with no severe false pass.
- Fewer than 5 percent of legitimate routine test posts are incorrectly held.
- Required critic and Release Judge availability is at least 99.5 percent with
  configured retries and fallback routing included.
- No cross-tenant data exposure in automated isolation tests.
- No known geographic-boundary, protected-audience, local-claim, or media-rights
  bypass.
- No publishing, scheduling, or on-hold regression.
- In the shadow and pilot sample, predicted top-quartile posts have a median
  blended outcome score at least 15 percent above predicted bottom-quartile
  posts, with a positive rank correlation.
- Decision receipts exist for every candidate selection and block.
- Global and workspace kill switches have been exercised successfully.
- The customer's one-time autopublish choice is recorded with a timestamp and
  policy version before their first unattended post.
- AI and image costs remain within configured per-workspace ceilings.

The product success target is a positive median lift in blended outcome score
against each participating workspace's rolling baseline. Safety and tenant
isolation remain release gates even when measured business lift is positive.

## 14. Implementation Sequence

The eventual implementation plan should preserve these boundaries:

1. Schema, tenant-scoped repositories, and feature flags.
2. Confirmed Organic Reach Profiles and audience segments.
3. Outcome score library and historical replay tooling.
4. Per-post Reach Plans with timing, language, hashtags, and media direction.
5. Decision receipts and shadow-mode evaluation.
6. Independent Self-Critique Council, correction loop, and Release Judge.
7. Private strategy signals, profile versioning, and learning job.
8. Candidate Lab, Media Director, and approval-mode interface.
9. Operator controls, outcome feedback, and observability.
10. Protected Autopilot release and consent controls.
11. Thresholded archetype aggregate job.

Higgsfield integration and the autonomous campaign agent are separate future
designs. Neither is required to deliver or validate the Customer Learning Brain.
