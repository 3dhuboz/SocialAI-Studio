import { describe, expect, it } from 'vitest';
import {
  createDecisionReceipt,
  findFreshReleaseReceipt,
  listDecisionReceipts,
  replaceCriticVerdicts,
} from '../lib/learning/decision-repository';
import { makeRecordingD1 } from './helpers/recording-d1';

describe('learning decision repository', () => {
  it('binds a client workspace key on writes and reads', async () => {
    const { db, calls } = makeRecordingD1({
      'INSERT INTO learning_decisions': [{ id: 'decision-client' }],
    });
    await createDecisionReceipt(db, {
      userId: 'owner_1', clientId: 'client_1', postId: 'post_1', mode: 'shadow',
      stage: 'snapshot', releaseState: 'shadow_only', contentHash: 'abc', summary: {},
    });
    await listDecisionReceipts(db, 'owner_1', 'client_1', 'post_1', 20);
    expect(calls.every((call) => call.binds.includes('owner_1'))).toBe(true);
    expect(calls.every((call) => call.binds.includes('client_1'))).toBe(true);
    expect(calls[1].sql).toContain('client_id IS ?');
    expect(calls[1].sql).toContain('owner_kind = ?');
    expect(calls[1].sql).toContain('owner_id = ?');
    expect(calls[1].binds).toEqual([
      'owner_1', 'client_1', 'client_1', 'client', 'client_1', 'post_1', 20,
    ]);
  });

  it('uses a non-null owner key so duplicate owner receipts upsert', async () => {
    const { db, calls } = makeRecordingD1({
      'INSERT INTO learning_decisions': [{ id: 'decision-owner' }],
    });
    await createDecisionReceipt(db, {
      userId: 'owner_1', clientId: null, postId: 'post_1', mode: 'shadow',
      stage: 'snapshot', releaseState: 'shadow_only', contentHash: 'abc', summary: {},
    });
    expect(calls[0].sql).toContain('ON CONFLICT(user_id,workspace_key,post_id,stage,content_hash)');
    expect(calls[0].binds).toContain('__owner__');
  });

  it('returns the persisted id after an upsert conflict', async () => {
    const { db } = makeRecordingD1({
      'INSERT INTO learning_decisions': [{ id: 'existing-decision' }],
    });
    await expect(createDecisionReceipt(db, {
      userId: 'owner_1', clientId: null, postId: 'post_1', mode: 'shadow',
      stage: 'snapshot', releaseState: 'shadow_only', contentHash: 'abc', summary: {},
    })).resolves.toBe('existing-decision');
  });

  it('uses the canonical Shopify key and owner metadata', async () => {
    const { db, calls } = makeRecordingD1({
      'INSERT INTO learning_decisions': [{ id: 'decision-shop' }],
    });
    await createDecisionReceipt(db, {
      userId: 'store.myshopify.com', clientId: null, ownerKind: 'shop',
      ownerId: 'Store.MyShopify.com', postId: 'post_1', mode: 'shadow',
      stage: 'snapshot', releaseState: 'shadow_only', contentHash: 'abc', summary: {},
    });
    expect(calls[0].binds).toEqual(expect.arrayContaining([
      'store.myshopify.com', 'shop:store.myshopify.com', 'shop', 'store.myshopify.com',
    ]));
  });

  it('rejects inconsistent ownership before preparing SQL', async () => {
    const { db, calls } = makeRecordingD1();
    await expect(createDecisionReceipt(db, {
      userId: 'owner_1', clientId: null, ownerKind: 'shop', ownerId: 'store.myshopify.com',
      postId: 'post_1', mode: 'shadow', stage: 'snapshot', releaseState: 'shadow_only',
      contentHash: 'abc', summary: {},
    })).rejects.toThrow('Invalid Shopify workspace identity');
    expect(calls).toEqual([]);
  });

  it('throws when D1 does not return a persisted receipt id', async () => {
    const { db } = makeRecordingD1();
    await expect(createDecisionReceipt(db, {
      userId: 'owner_1', clientId: null, postId: 'post_1', mode: 'shadow',
      stage: 'snapshot', releaseState: 'shadow_only', contentHash: 'abc', summary: {},
    })).rejects.toThrow('Learning decision receipt was not persisted');
  });

  it('reuses only a fresh complete release receipt for the canonical workspace', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM learning_decisions d': [{ id: 'fresh-decision', release_state: 'pass_green' }],
    });

    await expect(findFreshReleaseReceipt(
      db,
      'owner_1',
      'client_1',
      'client',
      'client_1',
      'post_1',
      'content-hash',
      'shadow',
    )).resolves.toEqual({ id: 'fresh-decision', state: 'pass_green' });

    expect(calls[0].sql).toContain("d.stage = 'release'");
    expect(calls[0].sql).toContain("datetime('now', '-24 hours')");
    expect(calls[0].sql).toContain('learning_critic_verdicts');
    expect(calls[0].sql).toContain('verdictCount');
    expect(calls[0].sql).toContain('d.client_id IS ?');
    expect(calls[0].sql).toContain('d.owner_kind = ?');
    expect(calls[0].sql).toContain('d.owner_id = ?');
    expect(calls[0].binds).toEqual([
      'owner_1', 'client_1', 'client_1', 'client', 'client_1',
      'post_1', 'content-hash', 'shadow',
    ]);
  });

  it('atomically replaces every critic attempt with provider evidence', async () => {
    const { db, calls } = makeRecordingD1();
    await replaceCriticVerdicts(db, 'decision-1', [[
      {
        kind: 'brand', verdict: 'pass', severity: 'advisory', confidence: 1,
        evidence: ['brand.denylist'], repairs: [], provider: 'deterministic', model: 'rules-v1',
      },
    ], [
      {
        kind: 'fact', verdict: 'warn_repairable', severity: 'release_critical', confidence: 0.9,
        evidence: ['unsupported claim'], repairs: ['remove claim'], provider: 'anthropic', model: 'haiku',
      },
    ]]);

    expect(calls[0].sql).toContain('DELETE FROM learning_critic_verdicts');
    const inserts = calls.filter((call) => call.sql.includes('INSERT INTO learning_critic_verdicts'));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].binds).toEqual(expect.arrayContaining([
      'decision-1', 'brand', 'pass', 0, 'deterministic', 'rules-v1',
    ]));
    expect(inserts[1].binds).toEqual(expect.arrayContaining([
      'decision-1', 'fact', 'warn_repairable', 1, 'anthropic', 'haiku',
    ]));
  });
});
