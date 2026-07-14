import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRecordingD1 } from './helpers/recording-d1';
import {
  deleteReachUserData,
  deleteReachWorkspaceData,
} from '../lib/reach/deletion';

const TABLE_ORDER = [
  'reach_plans',
  'approved_media_assets',
  'audience_segments',
  'reach_profiles',
];

describe('reach deletion', () => {
  it('deletes a client workspace in dependency order with owner and workspace binds', async () => {
    const { db, calls } = makeRecordingD1();

    await deleteReachWorkspaceData(db, 'owner_1', 'client_1');

    expect(calls.map((call) => TABLE_ORDER.find((table) => call.sql.includes(table))))
      .toEqual(TABLE_ORDER);
    expect(calls.every((call) => (
      JSON.stringify(call.binds) === JSON.stringify(['owner_1', 'client_1'])
    ))).toBe(true);
  });

  it('deletes all account reach rows using only the authenticated user id', async () => {
    const { db, calls } = makeRecordingD1();

    await deleteReachUserData(db, 'owner_1');

    expect(calls.map((call) => TABLE_ORDER.find((table) => call.sql.includes(table))))
      .toEqual(TABLE_ORDER);
    expect(calls.every((call) => call.binds.length === 1
      && call.binds[0] === 'owner_1')).toBe(true);
  });

  it('uses the canonical shop sentinel and cannot match another shop workspace', async () => {
    const { db, calls } = makeRecordingD1();

    await deleteReachWorkspaceData(
      db,
      'store.myshopify.com',
      'shop:store.myshopify.com',
    );

    expect(calls.every((call) => JSON.stringify(call.binds) === JSON.stringify([
      'store.myshopify.com', 'shop:store.myshopify.com',
    ]))).toBe(true);
    expect(calls.some((call) => call.binds.includes('shop:other.myshopify.com')))
      .toBe(false);
  });

  it('registers both authenticated reach route families', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');

    expect(source).toContain("import { registerReachRoutes } from './routes/reach';");
    expect(source).toContain("import { registerShopifyReachRoutes } from './routes/shopify-reach';");
    expect(source).toContain('registerReachRoutes(app);');
    expect(source).toContain('registerShopifyReachRoutes(app);');
  });

  it('wires reach cleanup before every parent workspace deletion', () => {
    const userRoute = readFileSync(resolve(process.cwd(), 'src/routes/user.ts'), 'utf8');
    const clientRoute = readFileSync(resolve(process.cwd(), 'src/routes/clients.ts'), 'utf8');
    const shopRoute = readFileSync(resolve(process.cwd(), 'src/routes/shopify-oauth.ts'), 'utf8');

    expect(userRoute.indexOf('deleteReachUserData(c.env.DB, uid)')).toBeGreaterThan(-1);
    expect(userRoute.indexOf('deleteReachUserData(c.env.DB, uid)'))
      .toBeLessThan(userRoute.indexOf("DELETE FROM users WHERE id = ?"));

    expect(clientRoute.indexOf('deleteReachWorkspaceData(c.env.DB, uid, clientId)'))
      .toBeGreaterThan(-1);
    expect(clientRoute.indexOf('deleteReachWorkspaceData(c.env.DB, uid, clientId)'))
      .toBeLessThan(clientRoute.indexOf("DELETE FROM clients WHERE id = ? AND user_id = ?"));

    expect(shopRoute.indexOf('deleteReachWorkspaceData(c.env.DB, shop, `shop:${shop}`)'))
      .toBeGreaterThan(-1);
    expect(shopRoute.indexOf('deleteReachWorkspaceData(c.env.DB, shop, `shop:${shop}`)'))
      .toBeLessThan(shopRoute.indexOf("DELETE FROM users WHERE id = ? AND plan = 'shopify-shop'"));
  });
});
