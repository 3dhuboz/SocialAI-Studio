// Shared helpers for post-image critique state.
//
// Two drift bugs caused the same class of incident in different places:
//   1. Short captions skipped critique entirely even when the image prompt
//      had enough signal to ground the verdict.
//   2. Editing a post's caption/image/prompt could leave an old "good" score
//      attached to a materially different post.
//
// Keep the "what text does the critic see?" and "when is stored critique
// stale?" rules here so CRUD routes and publish/generation paths stay aligned.

type CritiqueContextInput = {
  caption?: string | null;
  hashtags?: string[] | string | null;
  imagePrompt?: string | null;
};

const CRITIQUE_INVALIDATION_KEYS = new Set([
  'content',
  'hashtags',
  'imageUrl',
  'image_url',
  'imagePrompt',
  'image_prompt',
]);

function normalizeHashtags(input: CritiqueContextInput['hashtags']): string[] {
  if (Array.isArray(input)) {
    return input
      .map((tag) => String(tag || '').trim())
      .filter(Boolean);
  }
  if (typeof input === 'string' && input.trim()) {
    return input
      .trim()
      .split(/\s+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

export function buildCritiqueContextText(input: CritiqueContextInput): string {
  const caption = String(input.caption || '').trim();
  const hashtags = normalizeHashtags(input.hashtags);
  const imagePrompt = String(input.imagePrompt || '').trim();

  const parts: string[] = [];
  if (caption) parts.push(caption);
  if (hashtags.length > 0) parts.push(`Hashtags: ${hashtags.join(' ')}`);

  // When the publish caption is too short to ground the verdict, fold in the
  // intended image brief so the critic can still catch cross-domain or surreal
  // outputs on terse posts like "Now open" or "Book now".
  if ((caption.length < 20 || parts.join(' ').length < 30) && imagePrompt) {
    parts.push(`Intended image brief: ${imagePrompt.slice(0, 600)}`);
  }

  return parts.join('\n\n').trim();
}

export function shouldInvalidateStoredCritique(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).some((key) => CRITIQUE_INVALIDATION_KEYS.has(key));
}

export function buildCritiqueInvalidationPatch(
  patch: Record<string, unknown>,
): Record<string, number | string | null> {
  if (!shouldInvalidateStoredCritique(patch)) return {};
  return {
    image_critique_score: null,
    image_critique_reasoning: null,
    image_critique_at: null,
    image_regen_count: 0,
  };
}
