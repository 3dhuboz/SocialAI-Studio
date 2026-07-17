import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deleteLearningUserData,
  deleteLearningWorkspaceData,
} from '../lib/learning/deletion';
import { makeRecordingD1 } from './helpers/recording-d1';

describe('learning data deletion', () => {
  it.each([
    ['owner', 'owner_1', '__owner__'],
    ['client', 'owner_1', 'client_1'],
    ['shop', 'store.myshopify.com', 'shop:store.myshopify.com'],
  ])('deletes %s verdicts, decisions, and settings within one tenant key', async (
    _kind,
    userId,
    workspaceKey,
  ) => {
    const { db, calls } = makeRecordingD1();

    await deleteLearningWorkspaceData(db, userId, workspaceKey);

    const deletes = calls.filter((call) => /^\s*DELETE\s+FROM/i.test(call.sql));
    expect(deletes).toHaveLength(15);
    expect(deletes.some((call) =>
      call.sql.includes('DELETE FROM learning_decision_disqualifications'))).toBe(true);
    expect(deletes.some((call) =>
      call.sql.includes('DELETE FROM learning_pilot_enrollments'))).toBe(true);
    expect(deletes.at(-3)?.sql).toContain('DELETE FROM learning_critic_verdicts');
    expect(deletes.at(-2)?.sql).toContain('DELETE FROM learning_decisions');
    expect(deletes.at(-1)?.sql).toContain('DELETE FROM workspace_learning_settings');
    expect(deletes.every((call) =>
      call.binds[0] === userId && call.binds[1] === workspaceKey,
    )).toBe(true);
  });

  it('deletes every learning workspace before its user account', async () => {
    const { db, calls } = makeRecordingD1();

    await deleteLearningUserData(db, 'owner_1');

    const deletes = calls.filter((call) => /^\s*DELETE\s+FROM/i.test(call.sql));
    expect(deletes).toHaveLength(15);
    expect(deletes.some((call) =>
      call.sql.includes('DELETE FROM learning_decision_disqualifications'))).toBe(true);
    expect(deletes.some((call) =>
      call.sql.includes('DELETE FROM learning_pilot_enrollments'))).toBe(true);
    expect(deletes.at(-3)?.sql).toContain('DELETE FROM learning_critic_verdicts');
    expect(deletes.at(-2)?.sql).toContain('DELETE FROM learning_decisions');
    expect(deletes.at(-1)?.sql).toContain('DELETE FROM workspace_learning_settings');
    expect(deletes.every((call) => call.binds[0] === 'owner_1')).toBe(true);
  });

  it('wires cleanup before every parent deletion', () => {
    const userRoute = readFileSync(resolve(process.cwd(), 'src/routes/user.ts'), 'utf8');
    const clientRoute = readFileSync(resolve(process.cwd(), 'src/routes/clients.ts'), 'utf8');
    const shopRoute = readFileSync(resolve(process.cwd(), 'src/routes/shopify-oauth.ts'), 'utf8');

    expect(userRoute.indexOf('deleteLearningUserData(c.env.DB, uid)')).toBeGreaterThan(-1);
    expect(userRoute.indexOf('deleteLearningUserData(c.env.DB, uid)'))
      .toBeLessThan(userRoute.indexOf("DELETE FROM users WHERE id = ?"));

    expect(clientRoute.indexOf('deleteLearningWorkspaceData(c.env.DB, uid, clientId)'))
      .toBeGreaterThan(-1);
    expect(clientRoute.indexOf('deleteLearningWorkspaceData(c.env.DB, uid, clientId)'))
      .toBeLessThan(clientRoute.indexOf("DELETE FROM clients WHERE id = ? AND user_id = ?"));

    expect(shopRoute.indexOf('deleteLearningWorkspaceData(c.env.DB, shop, `shop:${shop}`)'))
      .toBeGreaterThan(-1);
    expect(shopRoute.indexOf('deleteLearningWorkspaceData(c.env.DB, shop, `shop:${shop}`)'))
      .toBeLessThan(shopRoute.indexOf("DELETE FROM users WHERE id = ? AND plan = 'shopify-shop'"));
  });
});
