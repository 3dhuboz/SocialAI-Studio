import type { SocialPost } from '../types';

/**
 * AI generation creates reviewable content. Publishing permission is granted
 * later, when an operator explicitly changes a post to Scheduled.
 */
export const smartBatchReviewStatus = (): SocialPost['status'] => 'Draft';
