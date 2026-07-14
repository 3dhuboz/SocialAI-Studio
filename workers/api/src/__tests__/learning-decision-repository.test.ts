import { describe, expect, it } from 'vitest';
import {
  createDecisionReceipt,
  listDecisionReceipts,
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
});
