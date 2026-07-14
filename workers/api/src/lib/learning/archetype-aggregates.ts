export interface AggregateContribution {
  tenantKey: string;
  postId: string;
  archetypeSlug: string;
  variableKey: string;
  variableValue: string;
  effect: number;
  confidence: number;
  caption?: string;
  imageUrl?: string;
}

export interface EligibleAggregate {
  archetypeSlug: string;
  variableKey: string;
  variableValue: string;
  workspaceCount: number;
  postCount: number;
  effectRange: [number, number];
  confidence: number;
}

type ContributionRow = {
  tenant_key: string;
  post_id: string;
  archetype_slug: string;
  variable_key: string;
  variable_value: string;
  effect: number | string;
  confidence: number | string;
};

const MIN_WORKSPACES = 10;
const MIN_POSTS = 100;

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function coarse(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function validString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

export function buildEligibleAggregates(
  rows: readonly AggregateContribution[],
): EligibleAggregate[] {
  const groups = new Map<string, Map<string, AggregateContribution>>();
  for (const row of rows) {
    const effect = finiteNumber(row.effect);
    const confidence = finiteNumber(row.confidence);
    if (!validString(row.tenantKey)
      || !validString(row.postId)
      || !validString(row.archetypeSlug)
      || !validString(row.variableKey)
      || !validString(row.variableValue)
      || effect === null
      || effect < -1
      || effect > 1
      || confidence === null
      || confidence < 0
      || confidence > 1) {
      continue;
    }
    const groupKey = `${row.archetypeSlug}\u0000${row.variableKey}\u0000${row.variableValue}`;
    const postKey = `${row.tenantKey}\u0000${row.postId}`;
    const group = groups.get(groupKey) ?? new Map<string, AggregateContribution>();
    const existing = group.get(postKey);
    if (!existing || row.confidence > existing.confidence) {
      group.set(postKey, { ...row, effect, confidence });
    }
    groups.set(groupKey, group);
  }

  const output: EligibleAggregate[] = [];
  for (const group of groups.values()) {
    const contributions = [...group.values()];
    const workspaceCount = new Set(contributions.map((row) => row.tenantKey)).size;
    const postCount = contributions.length;
    if (workspaceCount < MIN_WORKSPACES || postCount < MIN_POSTS) continue;
    const effects = contributions.map((row) => row.effect).sort((left, right) => left - right);
    output.push({
      archetypeSlug: contributions[0].archetypeSlug,
      variableKey: contributions[0].variableKey,
      variableValue: contributions[0].variableValue,
      workspaceCount,
      postCount,
      effectRange: [coarse(effects[0]), coarse(effects.at(-1)!)],
      confidence: coarse(
        contributions.reduce((sum, row) => sum + row.confidence, 0) / postCount,
      ),
    });
  }
  return output.sort((left, right) =>
    left.archetypeSlug.localeCompare(right.archetypeSlug)
      || left.variableKey.localeCompare(right.variableKey)
      || left.variableValue.localeCompare(right.variableValue));
}

async function loadAggregateContributions(
  db: D1Database,
  archetypeSlug: string | null,
): Promise<AggregateContribution[]> {
  const rows = await db.prepare(`
    SELECT
      ls.user_id || char(0) || ls.workspace_key AS tenant_key,
      pe.post_id,
      CASE
        WHEN ls.owner_kind = 'client'
          THEN COALESCE(c.archetype_slug, u.archetype_slug)
        ELSE u.archetype_slug
      END AS archetype_slug,
      ls.variable_key,
      ls.variable_value,
      ls.effect,
      ls.confidence
    FROM learning_signals ls
    JOIN json_each(
      CASE WHEN json_valid(ls.supporting_outcomes_json)
        THEN ls.supporting_outcomes_json ELSE '[]' END
    ) support
    JOIN learning_outcomes lo ON lo.id = support.value
      AND lo.window_hours = 168
      AND lo.source_status != 'unavailable'
    JOIN publication_events pe ON pe.id = lo.publication_event_id
      AND pe.user_id = ls.user_id
      AND pe.workspace_key = ls.workspace_key
      AND pe.owner_kind = ls.owner_kind
      AND pe.owner_id = ls.owner_id
    LEFT JOIN users u ON u.id = ls.user_id
    LEFT JOIN clients c ON ls.owner_kind = 'client'
      AND c.id = ls.owner_id AND c.user_id = ls.user_id
    WHERE ls.status IN ('usable', 'proven', 'operator_locked')
      AND CASE
        WHEN ls.owner_kind = 'client'
          THEN COALESCE(c.archetype_slug, u.archetype_slug)
        ELSE u.archetype_slug
      END IS NOT NULL
      AND (? IS NULL OR CASE
        WHEN ls.owner_kind = 'client'
          THEN COALESCE(c.archetype_slug, u.archetype_slug)
        ELSE u.archetype_slug
      END = ?)
    ORDER BY archetype_slug, ls.variable_key, ls.variable_value, tenant_key, pe.post_id
  `).bind(archetypeSlug, archetypeSlug).all<ContributionRow>();
  return (rows.results ?? []).flatMap((row) => {
    if (!validString(row.tenant_key)
      || !validString(row.post_id)
      || !validString(row.archetype_slug)
      || !validString(row.variable_key)
      || !validString(row.variable_value)) {
      return [];
    }
    return [{
      tenantKey: row.tenant_key,
      postId: row.post_id,
      archetypeSlug: row.archetype_slug,
      variableKey: row.variable_key,
      variableValue: row.variable_value,
      effect: Number(row.effect),
      confidence: Number(row.confidence),
    }];
  });
}

async function persistArchetype(
  db: D1Database,
  archetypeSlug: string,
  aggregates: EligibleAggregate[],
  rebuiltAt: string,
  randomId: () => string,
): Promise<{ deleted: number; inserted: number }> {
  const statements = [
    db.prepare(`DELETE FROM archetype_aggregates WHERE archetype_slug = ?`)
      .bind(archetypeSlug),
    ...aggregates.map((aggregate) => db.prepare(`
      INSERT INTO archetype_aggregates (
        id,archetype_slug,variable_key,variable_value,workspace_count,
        post_count,effect_range_json,confidence,rebuilt_at
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      randomId(),
      aggregate.archetypeSlug,
      aggregate.variableKey,
      aggregate.variableValue,
      aggregate.workspaceCount,
      aggregate.postCount,
      JSON.stringify(aggregate.effectRange),
      aggregate.confidence,
      rebuiltAt,
    )),
  ];
  await db.batch(statements);
  return { deleted: 1, inserted: aggregates.length };
}

function requireArchetype(value: string): string {
  const slug = value.trim();
  if (!slug) throw new Error('Archetype slug is required');
  return slug;
}

function requireTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error('Aggregate rebuild timestamp is invalid');
  return new Date(value).toISOString();
}

export async function rebuildArchetypeAggregates(
  db: D1Database,
  archetypeSlug: string,
  rebuiltAt: string,
  randomId: () => string = () => crypto.randomUUID(),
): Promise<{ deleted: number; inserted: number }> {
  const slug = requireArchetype(archetypeSlug);
  const timestamp = requireTimestamp(rebuiltAt);
  const contributions = await loadAggregateContributions(db, slug);
  const aggregates = buildEligibleAggregates(contributions)
    .filter((aggregate) => aggregate.archetypeSlug === slug);
  return persistArchetype(db, slug, aggregates, timestamp, randomId);
}

export async function rebuildAllArchetypeAggregates(
  db: D1Database,
  rebuiltAt: string,
  randomId: () => string = () => crypto.randomUUID(),
): Promise<{ archetypes: number; inserted: number }> {
  const timestamp = requireTimestamp(rebuiltAt);
  const contributions = await loadAggregateContributions(db, null);
  const existing = await db.prepare(
    'SELECT DISTINCT archetype_slug FROM archetype_aggregates',
  ).all<{ archetype_slug: string }>();
  const slugs = [...new Set([
    ...contributions.map((row) => row.archetypeSlug),
    ...(existing.results ?? []).map((row) => row.archetype_slug),
  ].filter(validString).map((slug) => slug.trim()))].sort();
  const aggregates = buildEligibleAggregates(contributions);
  let inserted = 0;
  for (const slug of slugs) {
    const result = await persistArchetype(
      db,
      slug,
      aggregates.filter((aggregate) => aggregate.archetypeSlug === slug),
      timestamp,
      randomId,
    );
    inserted += result.inserted;
  }
  return { archetypes: slugs.length, inserted };
}
