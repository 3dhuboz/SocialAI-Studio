import type { Env } from '../env';
import { fireAlert } from '../lib/alerts';
import {
  AUTOPILOT_POLICY_VERSION,
  collectLearningReadiness,
  type LearningReadinessSnapshot,
} from '../lib/learning/readiness';

type PreviousReadiness = { ready: number } | null;

interface PersistedReadinessInput {
  id: string;
  snapshot: LearningReadinessSnapshot;
  evaluatedAt: string;
}

export interface EvaluateLearningReadinessOptions {
  now?: Date;
  collect?: typeof collectLearningReadiness;
  loadPrevious?: (db: D1Database) => Promise<PreviousReadiness>;
  persist?: (db: D1Database, input: PersistedReadinessInput) => Promise<void>;
  alert?: typeof fireAlert;
  randomId?: () => string;
}

async function loadPrevious(db: D1Database): Promise<PreviousReadiness> {
  return db.prepare(`
    SELECT ready
    FROM learning_release_readiness
    WHERE policy_version = ?
    ORDER BY evaluated_at DESC, id DESC
    LIMIT 1
  `).bind(AUTOPILOT_POLICY_VERSION).first<{ ready: number }>();
}

async function persistReadiness(
  db: D1Database,
  input: PersistedReadinessInput,
): Promise<void> {
  await db.prepare(`
    INSERT INTO learning_release_readiness (
      id, policy_version, ready, metrics_json, checks_json, evaluated_by, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, 'cron', ?)
  `).bind(
    input.id,
    AUTOPILOT_POLICY_VERSION,
    input.snapshot.ready ? 1 : 0,
    JSON.stringify(input.snapshot.metrics),
    JSON.stringify(input.snapshot.checks),
    input.evaluatedAt,
  ).run();
}

function failedChecks(snapshot: LearningReadinessSnapshot): string[] {
  const failed = Object.entries(snapshot.checks)
    .filter(([key, value]) => key !== 'tenancyProofs' && value === false)
    .map(([key]) => key);
  for (const [ownerKind, passed] of Object.entries(snapshot.checks.tenancyProofs)) {
    if (!passed) failed.push(`tenancyProofs.${ownerKind}`);
  }
  return failed;
}

export async function cronEvaluateLearningReadiness(
  env: Env,
  options: EvaluateLearningReadinessOptions = {},
): Promise<{ posts_processed: number; ready: boolean; id: string }> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Readiness timestamp is invalid');
  const collect = options.collect ?? collectLearningReadiness;
  const readPrevious = options.loadPrevious ?? loadPrevious;
  const persist = options.persist ?? persistReadiness;
  const alert = options.alert ?? fireAlert;
  const randomId = options.randomId ?? (() => crypto.randomUUID());

  const previous = await readPrevious(env.DB);
  const snapshot = await collect(env.DB, now);
  const id = randomId();
  await persist(env.DB, { id, snapshot, evaluatedAt: now.toISOString() });

  if (previous?.ready === 1 && !snapshot.ready) {
    await alert(
      env,
      'learning_readiness_green_to_red',
      'critical',
      `Protected Autopilot readiness turned red: ${failedChecks(snapshot).join(', ')}`,
    );
  }
  return {
    posts_processed: snapshot.metrics.pilotDecisions,
    ready: snapshot.ready,
    id,
  };
}
