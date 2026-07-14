import type { Env } from '../env';
import { collectDueLearningOutcomes } from '../lib/learning/outcome-collector';
import { reconcilePublishedPosts } from '../lib/learning/publication-repository';

export interface CollectLearningOutcomesOptions {
  now?: string;
  reconciliationLimit?: number;
  outcomeLimit?: number;
}

export async function cronCollectLearningOutcomes(
  env: Env,
  options: CollectLearningOutcomesOptions = {},
): Promise<{
  posts_processed: number;
  reconciled: number;
  dueEvents: number;
  saved: number;
  skipped: number;
}> {
  const now = options.now ?? new Date().toISOString();
  const reconciled = await reconcilePublishedPosts(
    env.DB,
    options.reconciliationLimit,
  );
  const outcomes = await collectDueLearningOutcomes(
    env.DB,
    now,
    options.outcomeLimit,
  );
  return { posts_processed: outcomes.saved, reconciled, ...outcomes };
}
