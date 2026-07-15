import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import {
  deleteLearningUserData,
  deleteLearningWorkspaceData,
} from '../lib/learning/deletion';
import { registerTrackingRoutes } from '../routes/tracking';
import { makeRecordingD1 } from './helpers/recording-d1';

const EXPECTED_WORKSPACE_DELETE_ORDER = [
  'archetype_aggregates',
  'learning_outcomes',
  'learning_outcome_attempts',
  'publication_events',
  'platform_metric_snapshots',
  'conversion_feedback',
  'tracking_links',
  'learning_experiments',
  'learning_profiles',
  'learning_signals',
  'learning_adjudications',
  'learning_pilot_enrollments',
  'learning_critic_verdicts',
  'learning_decisions',
  'workspace_learning_settings',
];

function deletedTable(sql: string): string | null {
  return sql.match(/DELETE\s+FROM\s+([a-z_]+)/i)?.[1] ?? null;
}

describe('learning outcome deletion', () => {
  it('invalidates the affected archetype then deletes one workspace in dependency order', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM clients c': [{ archetype_slug: 'bbq-smokehouse' }],
    });

    await deleteLearningWorkspaceData(db, 'owner-1', 'client-1');

    const deletes = calls.filter((call) => /^\s*DELETE\s+FROM/i.test(call.sql));
    expect(deletes.map((call) => deletedTable(call.sql))).toEqual(EXPECTED_WORKSPACE_DELETE_ORDER);
    expect(deletes[0].binds).toEqual(['bbq-smokehouse']);
    expect(deletes[1].sql).toContain('SELECT id FROM publication_events');
    expect(deletes[1].binds).toEqual(['owner-1', 'client-1']);
    for (const call of deletes.slice(2)) {
      expect(call.binds).toEqual(['owner-1', 'client-1']);
      expect(call.sql).toContain('workspace_key');
    }
  });

  it('cannot delete a sibling workspace and uses the canonical shop sentinel scope', async () => {
    const clientDb = makeRecordingD1({
      'FROM clients c': [{ archetype_slug: 'bbq-smokehouse' }],
    });
    await deleteLearningWorkspaceData(clientDb.db, 'owner-1', 'client-a');
    const tenantDeletes = clientDb.calls.filter((call) =>
      /^\s*DELETE\s+FROM/i.test(call.sql) && deletedTable(call.sql) !== 'archetype_aggregates');
    expect(tenantDeletes.every((call) =>
      call.binds.includes('client-a') && !call.binds.includes('client-b'))).toBe(true);

    const shopDb = makeRecordingD1({
      'FROM users': [{ archetype_slug: 'shop-retail' }],
    });
    await deleteLearningWorkspaceData(
      shopDb.db,
      'store.myshopify.com',
      'shop:store.myshopify.com',
    );
    const shopDeletes = shopDb.calls.filter((call) =>
      /^\s*DELETE\s+FROM/i.test(call.sql) && deletedTable(call.sql) !== 'archetype_aggregates');
    expect(shopDeletes.every((call) =>
      call.binds.includes('store.myshopify.com')
        && call.binds.includes('shop:store.myshopify.com'))).toBe(true);
  });

  it('invalidates every account archetype and scopes all raw deletes by user id', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT DISTINCT archetype_slug': [
        { archetype_slug: 'bbq-smokehouse' },
        { archetype_slug: 'professional-services' },
      ],
    });

    await deleteLearningUserData(db, 'owner-1');

    const aggregateDeletes = calls.filter((call) =>
      call.sql.includes('DELETE FROM archetype_aggregates'));
    expect(aggregateDeletes.map((call) => call.binds)).toEqual([
      ['bbq-smokehouse'], ['professional-services'],
    ]);
    const tenantDeletes = calls.filter((call) =>
      /^\s*DELETE\s+FROM/i.test(call.sql) && deletedTable(call.sql) !== 'archetype_aggregates');
    expect(tenantDeletes.every((call) => call.binds.length === 1 && call.binds[0] === 'owner-1'))
      .toBe(true);
  });

  it('calls learning deletion before raw tenant rows in all three deletion handlers', () => {
    const routeRoot = resolve(process.cwd(), 'src/routes');
    const user = readFileSync(resolve(routeRoot, 'user.ts'), 'utf8');
    const clients = readFileSync(resolve(routeRoot, 'clients.ts'), 'utf8');
    const shopify = readFileSync(resolve(routeRoot, 'shopify-oauth.ts'), 'utf8');

    expect(user.indexOf('deleteLearningUserData(')).toBeLessThan(user.indexOf('DELETE FROM posts WHERE user_id = ?'));
    expect(clients.indexOf('deleteLearningWorkspaceData(')).toBeLessThan(clients.indexOf('DELETE FROM posts WHERE user_id = ? AND client_id = ?'));
    expect(shopify.indexOf('deleteLearningWorkspaceData(')).toBeLessThan(shopify.indexOf("DELETE FROM posts WHERE owner_kind = 'shop'"));
  });

  it('returns 404 after a deleted tracking code is absent', async () => {
    const { db } = makeRecordingD1({ 'FROM tracking_links': [] });
    const app = new Hono<{ Bindings: Env }>();
    registerTrackingRoutes(app);

    const response = await app.request('/r/deleted1', {}, { DB: db } as Env);

    expect(response.status).toBe(404);
  });
});
