import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../db';

afterEach(() => vi.unstubAllGlobals());

describe('client automation API', () => {
  it('loads state and sends bounded pause, resume, and queue-review actions', async () => {
    const fetchMock = vi.fn(async (input: unknown) => new Response(JSON.stringify({
      automation: {
        status: 'on_hold', paused: true, draftCount: 16, scheduledCount: 2,
        postedCount: 7, overdueScheduledCount: 1, undatedScheduledCount: 1,
        staleScheduledCount: 2, canResume: false,
      },
      changed: 2,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const db = createDb(async () => 'portal-token', 'portal');

    await db.getClientAutomationState('hughesq-001');
    await db.updateClientAutomation('hughesq-001', 'pause');
    await db.updateClientAutomation('hughesq-001', 'resume');
    await db.updateClientAutomation('hughesq-001', 'return-stale-to-draft');

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      method: (init as RequestInit | undefined)?.method ?? 'GET',
      auth: new Headers((init as RequestInit | undefined)?.headers).get('Authorization'),
      body: (init as RequestInit | undefined)?.body
        ? JSON.parse(String((init as RequestInit).body))
        : null,
    }));
    expect(calls).toEqual([
      expect.objectContaining({ url: expect.stringContaining('/api/db/clients/hughesq-001/automation'), method: 'GET', auth: 'Portal portal-token' }),
      expect.objectContaining({ method: 'PUT', body: { action: 'pause' } }),
      expect.objectContaining({ method: 'PUT', body: { action: 'resume' } }),
      expect.objectContaining({ method: 'PUT', body: { action: 'return-stale-to-draft' } }),
    ]);
  });
});
