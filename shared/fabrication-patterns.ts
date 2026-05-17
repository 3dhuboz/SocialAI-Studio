// Single source of truth for the fabrication-pattern regex bank.
//
// Imported by:
//   - src/services/gemini.ts                     (gen-time detectFabrication)
//   - workers/api/src/routes/admin-stats.ts      (admin scan-flagged-posts)
//   - workers/api/src/cron/publish-missed.ts     (pre-publish belt-and-braces)
//
// Previously each call site maintained its own near-copy:
//   - gemini.ts FAB_CHECKS had the full pattern bank (every regex below)
//   - admin-stats.ts FAB_PATTERNS had ~80% of the patterns, slightly older
//   - publish-missed.ts had no scan at all (gap — the brisket-incident
//     class of bug could still slip through if the gen-time scan was
//     bypassed e.g. via a manual edit that didn't re-run detectFabrication)
//
// Now everyone shares one bank. Mirrors the FLUX_NEGATIVE_PROMPT lift in
// PR #86 and parseForbiddenSubjects in PR #85 — drift bug class closed.
//
// Both tsconfigs include `shared/` already (see shared/flux-prompts.ts).

export const FAB_PATTERNS: Array<[RegExp, string]> = [
  // ── Fake customer testimonials ──────────────────────────────────────────
  [/\b(?:a\s+)?(?:local|nearby|happy|recent)\s+(?:cafe|restaurant|business|client|customer|owner|food\s+truck|shop|store)\s+(?:in|from|at|near)?\s*[A-Z][a-z]+/i, 'invented customer testimonial'],
  [/\b(?:one\s+of\s+our|another)\s+(?:happy\s+)?(?:client|customer|user)/i, 'invented customer story'],
  // Invented quote: matches `<subject> says: "..."` but excludes rhetorical
  // anthropomorphizing like `It says: "..."`, `the stock photo says: "..."`
  // — those are figures of speech, not fake testimonials. Real fabrications
  // attribute to a human/customer/brand entity: `John says:`, `our customer
  // raved:`, `Sarah told us:`. 2026-05 audit: added said/mentioned/commented
  // — they appear in fabricated copy like `Sarah said: "..."` and the
  // previous list of attributive verbs missed them outright.
  [/\b(?<!\b(?:it|this|that|one|nothing|everything|message|photo|image|caption|post|content|feed|story|stock|generic|ad|advert|brand|tagline)\s)(?:says|said|told\s+us|reported|shared|raved|mentioned|commented)\s*[:,]?\s*["']/i, 'invented quote'],
  [/\b[A-Z][a-z]+\s+[A-Z]\.?\s*,\s*(?:from\s+)?[A-Z][a-z]+/i, 'fake testimonial signature (e.g. "Sarah J., Brisbane")'],
  // ── Fake statistics ─────────────────────────────────────────────────────
  // Match "45% increase" AND "by 45%" / "up to 45%" / "of 45%" shapes. The
  // "by" variant came up in real Penny Wise posts ("Boost engagement by 45%
  // with our new feature") and the original narrow regex missed it.
  [/\b\d{1,3}(?:\.\d+)?%\s+(?:increase|boost|growth|improvement|more|less|reduction|saving|higher|lower|faster)/i, 'invented percentage statistic'],
  [/\b(?:by|of|up\s+to|reach(?:ing|ed)?|gain(?:ing|ed)?|boost(?:ing|ed)?\s+\w+\s+by)\s+\d{1,3}(?:\.\d+)?%/i, 'invented percentage statistic ("by X%" form)'],
  [/\bsaved\s+(?:them\s+)?\d+\s+(?:hours?|days?|weeks?|minutes?)/i, 'invented time-saving claim'],
  [/\b\d+x\s+(?:more|better|faster|increase|growth)/i, 'invented multiplier claim'],
  [/\b(?:over|more\s+than)\s+\d{2,}\s+(?:clients?|customers?|users?|businesses)/i, 'invented user count'],
  // 2026-05 audit additions: invented frequency/cadence claims (real Penny
  // Wise post: "Small business owners in Rockhampton are already posting
  // 7-14 times per week on autopilot")
  [/\b(?:already\s+)?posting\s+\d+(?:[-–]\d+)?\s+times?\s+(?:per|a)\s+(?:day|week|month)/i, 'invented posting-frequency claim'],
  [/\b(?:already\s+)?(?:get|gets|getting|generating|generated)\s+\d+(?:[-–]\d+)?\s+(?:more\s+)?(?:leads?|sales?|customers?|comments?|likes?|shares?|views?)/i, 'invented engagement-stat claim'],
  // 2026-05 SaaS follow-up: "generates 7-14 posts per week" / "writes 30
  // captions a month" — the marketing-claim verb form. Distinct from the
  // "posting NN times" shape above. The literal "7-14 posts/week" survives
  // (brand-guide preferred form) — only the verb-driven sentence form trips.
  [/\b(?:generates?|writes?|produces?|delivers?|creates?|cranks?\s+out)\s+\d+(?:[-–]\d+)?\s+(?:posts?|captions?|articles?|videos?|reels?)\s+(?:per|a|each)\s+(?:day|week|month)/i, 'invented content-generation cadence claim'],
  // 2026-05 audit additions: leading questions with implied stat (real Penny
  // Wise post: "How many hours could you reclaim this week?")
  [/\bHow\s+many\s+(?:hours?|days?|customers?|sales?|leads?)\s+could\s+you\s+(?:reclaim|save|gain|earn|get|win)/i, 'leading question with implied invented stat'],
  // ── Fake urgency / countdowns / events without source ───────────────────
  [/\b(?:today\s+only|this\s+weekend\s+only|limited\s+(?:time|spots)|hurry|act\s+now|don'?t\s+miss\s+out)/i, 'fake urgency'],
  [/\b(?:countdown|just\s+\d+\s+(?:hours?|days?)\s+left|ends\s+(?:tomorrow|tonight|soon))/i, 'invented countdown'],
  // ── Structural AI tropes ────────────────────────────────────────────────
  // "Your best post goes live at 3 AM on a Tuesday. Nobody sees it."
  [/\bYour\s+(?:best|top|favourite|favorite)\s+\w+\s+goes\s+live\s+at\s+\d/i, 'AI-tutorial opener'],
  [/\bNobody\s+sees\s+(it|them)[.!?]\s*Timing\s+is\s+everything/i, 'three-beat AI rhythm'],
  [/\bNo more (staring at a blank screen|wondering what to (write|post|say)|guessing)/i, 'AI cliché ("No more X-ing at a Y")'],
  [/(?:\bEvery\s+\S+(?:\s+\S+){0,3}[.!]\s*){2,}/i, '"Every X. Every Y." anaphora'],
  [/\b(?:channell?ed|leveraged|elevated)\s+(?:significant|considerable|substantial|incredible)/i, 'buzzword soup ("channelled significant…")'],
  [/\bbespoke\s+(digital\s+platforms?|ai\s+(?:tools?|solutions?|platforms?))/i, 'agency-speak ("bespoke digital platforms")'],
  [/\bSmall business owners (often|usually|typically|always|never|rarely)/i, 'generalising opener ("Small business owners often…")'],
  [/\b(Timing|Consistency|Authenticity|Quality|Strategy)\s+is\s+everything[.!?]/i, 'empty epigram ("Timing is everything")'],
  [/\bThat'?s\s+the\s+gap\s+we\s+close/i, '"That\'s the gap we close"'],
  [/\bMaking\s+(real|a\s+real)\s+difference/i, '"Making real differences"'],
];

/**
 * Threshold for the structural cadence detector. 5+ consecutive declarative
 * sentences ≤6 words each is the textbook AI rhythm signature (originally
 * tuned at 3 but produced false positives on legitimate 3-item feature lists
 * like "AI writes your posts. Generates your images. Publishes at the right
 * time."). Keep this in lockstep with the cadence threshold in
 * scanContentForTropes — the admin scanner must use the same bar as the
 * gen-time guard or it flags posts the gen path accepted.
 */
export const AI_CADENCE_THRESHOLD = 5;

/**
 * Scan content for fabrication / AI-trope patterns.
 *
 * Returns an array of human-readable reason strings — empty when clean.
 * Used by:
 *   - admin scan-flagged-posts route (surface flagged posts pre-publish)
 *   - publish-missed cron (last-line-of-defence pre-publish belt-and-braces)
 *
 * The gen-time path (src/services/gemini.ts:detectFabrication) returns a
 * single reason (used for retry decision) — same patterns, different return
 * shape because the gen path retries with a stricter prompt while these
 * call sites use the reasons to surface posts for human review.
 */
export function scanContentForTropes(content: string): string[] {
  const reasons: string[] = [];
  if (!content) return reasons;
  for (const [pattern, reason] of FAB_PATTERNS) {
    if (pattern.test(content)) reasons.push(reason);
  }
  // Cadence detector — N+ consecutive ≤6-word declaratives
  const sentences = content.split(/[.!?]\s+/).filter((s) => s.trim().length > 0);
  let consecutiveShort = 0;
  let maxRun = 0;
  for (const s of sentences) {
    if (s.trim().split(/\s+/).length <= 6) {
      consecutiveShort++;
      if (consecutiveShort > maxRun) maxRun = consecutiveShort;
    } else {
      consecutiveShort = 0;
    }
  }
  if (maxRun >= AI_CADENCE_THRESHOLD) reasons.push(`AI cadence — ${maxRun} consecutive short sentences`);
  return reasons;
}
