import { describe, expect, it } from 'vitest';
import { makeRecordingD1 } from './helpers/recording-d1';
import { workspaceKey } from '../lib/learning/types';
import {
  confirmReachProfile,
  getLatestReachProfile,
  listApprovedAssets,
  proposeReachProfile,
} from '../lib/reach/reach-profile';
import {
  assertConfirmedReachProfile,
  type ReachProfile,
} from '../lib/reach/types';

const profile: ReachProfile = {
  id: 'reach_1',
  userId: 'owner_1',
  clientId: null,
  workspaceKey: '__owner__',
  ownerKind: 'user',
  ownerId: 'owner_1',
  version: 1,
  confirmationStatus: 'confirmed',
  timezone: 'Australia/Brisbane',
  baseLocation: {
    country: 'Australia',
    region: 'Queensland',
    locality: 'Gladstone',
  },
  serviceArea: { radiusKm: 40, included: ['Gladstone'] },
  excludedLocations: [],
  platforms: ['facebook', 'instagram'],
};

const profileRow = {
  id: 'reach_1', user_id: 'owner_1', client_id: null,
  workspace_key: '__owner__', owner_kind: 'user', owner_id: 'owner_1',
  version: 1, confirmation_status: 'proposed', timezone: 'Australia/Brisbane',
  base_location_json: JSON.stringify(profile.baseLocation),
  service_area_json: JSON.stringify(profile.serviceArea),
  excluded_locations_json: '[]', platforms_json: '["facebook","instagram"]',
  cadence_json: '{}', confirmed_at: null,
};

describe('reach profile validation', () => {
  it('requires a confirmed profile with timezone and included locations', () => {
    expect(() => assertConfirmedReachProfile({
      ...profile,
      confirmationStatus: 'proposed',
    })).toThrow('not confirmed');
    expect(() => assertConfirmedReachProfile({
      ...profile,
      serviceArea: { radiusKm: null, included: [] },
    })).toThrow('incomplete');
    expect(() => assertConfirmedReachProfile(profile)).not.toThrow();
  });

  it('uses the shared non-null owner workspace key', () => {
    expect(workspaceKey(null)).toBe('__owner__');
    expect(workspaceKey('client_1')).toBe('client_1');
    expect(workspaceKey(null, 'shop', 'Store.MyShopify.com'))
      .toBe('shop:store.myshopify.com');
  });
});

describe('reach profile repository', () => {
  it('verifies client ownership and binds canonical workspace identity', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM clients': [{ id: 'client_1' }],
      'FROM reach_profiles': [],
    });

    await getLatestReachProfile(db, {
      userId: 'owner_1', clientId: 'client_1',
      ownerKind: 'client', ownerId: 'client_1',
    });

    expect(calls[0].binds).toEqual(['client_1', 'owner_1']);
    expect(calls[1].binds).toEqual([
      'owner_1', 'client_1', 'client', 'client_1',
    ]);
  });

  it('requires an installed shop and uses the canonical shop workspace key', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM shopify_stores': [{ shop_domain: 'store.myshopify.com' }],
      'FROM reach_profiles': [],
    });

    await getLatestReachProfile(db, {
      userId: 'Store.MyShopify.com', clientId: null,
      ownerKind: 'shop', ownerId: 'Store.MyShopify.com',
    });

    expect(calls[0].binds).toEqual(['store.myshopify.com']);
    expect(calls[1].binds).toEqual([
      'store.myshopify.com', 'shop:store.myshopify.com',
      'shop', 'store.myshopify.com',
    ]);
  });

  it('confirms by inserting a new profile version without mutating history', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM users': [{ id: 'owner_1' }],
      'FROM reach_profiles': [profileRow],
    });

    const confirmed = await confirmReachProfile(db, {
      userId: 'owner_1', clientId: null,
      ownerKind: 'user', ownerId: 'owner_1',
    }, 'reach_1', '2026-07-14T03:00:00.000Z');

    expect(confirmed.version).toBe(2);
    expect(confirmed.confirmationStatus).toBe('confirmed');
    expect(calls.some((call) => /^\s*UPDATE\s/i.test(call.sql))).toBe(false);
    const insert = calls.find((call) => call.sql.includes('INSERT INTO reach_profiles'));
    expect(insert?.binds).toContain(2);
    expect(insert?.binds).toContain('confirmed');
  });

  it('proposes the next version inside the canonical owner workspace', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM users': [{ id: 'owner_1' }],
      'MAX(version)': [{ version: 2 }],
    });

    const proposed = await proposeReachProfile(db, {
      userId: 'owner_1', clientId: null,
      ownerKind: 'user', ownerId: 'owner_1',
    }, {
      timezone: profile.timezone,
      baseLocation: profile.baseLocation,
      serviceArea: profile.serviceArea,
    });

    expect(proposed.version).toBe(3);
    expect(proposed.confirmationStatus).toBe('proposed');
    const insert = calls.find((call) => call.sql.includes('INSERT INTO reach_profiles'));
    expect(insert?.binds.slice(1, 6)).toEqual([
      'owner_1', '__owner__', null, 'user', 'owner_1',
    ]);
  });

  it('lists only confirmed assets from the canonical workspace', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM users': [{ id: 'owner_1' }],
      'FROM approved_media_assets': [{
        id: 'asset_1', asset_type: 'image', url: 'https://example.com/asset.jpg',
        tags_json: '["local","product"]', rights_status: 'confirmed',
      }],
    });

    const assets = await listApprovedAssets(db, {
      userId: 'owner_1', clientId: null,
      ownerKind: 'user', ownerId: 'owner_1',
    });

    expect(assets).toEqual([{
      id: 'asset_1', assetType: 'image', url: 'https://example.com/asset.jpg',
      tags: ['local', 'product'], rightsStatus: 'confirmed',
    }]);
    expect(calls[1].binds).toEqual(['owner_1', '__owner__', 'user', 'owner_1']);
    expect(calls[1].sql).toContain("rights_status = 'confirmed'");
  });
});
