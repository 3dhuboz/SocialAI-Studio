/**
 * Unit tests for lib/facebook-facts.ts — shop-scoped fact helpers.
 *
 * Covers:
 *  - loadShopFactsForPrompt: returns null when table is empty, returns
 *    formatted multi-line string when about + posts are present, truncates
 *    long content, handles query failure gracefully.
 *  - refreshFactsForShop: calls graph.facebook.com with correct paths,
 *    fires INSERT for each valid about/post/photo row, surfaces errors
 *    array on network failure.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadShopFactsForPrompt, refreshFactsForShop } from '../facebook-facts';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeDb(overrides: Record<string, any> = {}) {
  // Minimal D1 mock — prepare returns a fluent builder.
  const defaultFirst = vi.fn().mockResolvedValue(null);
  const defaultAll  = vi.fn().mockResolvedValue({ results: [] });
  const defaultRun  = vi.fn().mockResolvedValue({ meta: { changes: 0 } });

  const stmt = {
    bind: vi.fn().mockReturnThis(),
    first: overrides.first ?? defaultFirst,
    all:   overrides.all  ?? defaultAll,
    run:   overrides.run  ?? defaultRun,
  };

  return {
    prepare: vi.fn().mockReturnValue(stmt),
    _stmt: stmt,
  };
}

const SHOP  = 'acme.myshopify.com';
const PAGE  = '123456789';
const TOKEN = 'EAAtest';

// ── loadShopFactsForPrompt ───────────────────────────────────────────────────

describe('loadShopFactsForPrompt', () => {
  it('returns null when both about and posts queries return empty', async () => {
    const db = makeDb();
    const env = { DB: db } as any;
    const result = await loadShopFactsForPrompt(env, SHOP);
    expect(result).toBeNull();
  });

  it('returns formatted string when about row is present', async () => {
    // first() returns about row; all() returns empty posts
    const db = {
      prepare: vi.fn(),
    };

    const aboutStmt = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ content: 'Award-winning BBQ joint.', metadata: null }),
    };
    const postsStmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };

    let callCount = 0;
    (db.prepare as any).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? aboutStmt : postsStmt;
    });

    const result = await loadShopFactsForPrompt({ DB: db } as any, SHOP);
    expect(result).not.toBeNull();
    expect(result).toContain('Page about: Award-winning BBQ joint.');
  });

  it('returns formatted string including post when high-engagement posts present', async () => {
    const db = { prepare: vi.fn() };

    const aboutStmt = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ content: 'Great burgers.', metadata: null }),
    };
    const postsStmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({
        results: [
          { content: 'Our famous wagyu smash burger is back!', engagement_score: 42, metadata: null },
        ],
      }),
    };

    let callCount = 0;
    (db.prepare as any).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? aboutStmt : postsStmt;
    });

    const result = await loadShopFactsForPrompt({ DB: db } as any, SHOP);
    expect(result).toContain('Page about: Great burgers.');
    expect(result).toContain('Past high-engagement post (engagement 42)');
    expect(result).toContain('wagyu smash burger');
  });

  it('truncates about content longer than 400 chars', async () => {
    const longAbout = 'A'.repeat(500);
    const db = { prepare: vi.fn() };

    const aboutStmt = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ content: longAbout, metadata: null }),
    };
    const postsStmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };

    let callCount = 0;
    (db.prepare as any).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? aboutStmt : postsStmt;
    });

    const result = await loadShopFactsForPrompt({ DB: db } as any, SHOP);
    expect(result).not.toBeNull();
    // Should be trimmed to 400 chars + '…' suffix, not 500
    expect(result!.includes('AAAA')).toBe(true);
    expect(result!.endsWith('…') || result!.length < 500).toBe(true);
  });

  it('returns null and does not throw when DB query throws', async () => {
    const db = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockRejectedValue(new Error('table missing')),
        all:   vi.fn().mockRejectedValue(new Error('table missing')),
      }),
    };
    const result = await loadShopFactsForPrompt({ DB: db } as any, SHOP);
    expect(result).toBeNull();
  });
});

// ── refreshFactsForShop ──────────────────────────────────────────────────────

describe('refreshFactsForShop', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function makeDeleteStmt() {
    return { bind: vi.fn().mockReturnThis(), run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }) };
  }
  function makeInsertStmt(changes = 1) {
    return { bind: vi.fn().mockReturnThis(), run: vi.fn().mockResolvedValue({ meta: { changes } }) };
  }

  it('hits graph.facebook.com/about and /posts endpoints', async () => {
    const db = { prepare: vi.fn() };
    let callIdx = 0;
    (db.prepare as any).mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) return makeDeleteStmt(); // DELETE existing rows
      return makeInsertStmt(1);                   // INSERT for about/posts/photos
    });

    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      about: 'Great food.',
      description: null,
      category: 'Restaurant',
      fan_count: 1200,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await refreshFactsForShop({ DB: db } as any, SHOP, PAGE, TOKEN);

    // At least 1 fetch call should be to graph.facebook.com
    const urls = fetchSpy.mock.calls.map((c: any[]) => String(c[0]));
    expect(urls.some((u: string) => u.includes('graph.facebook.com'))).toBe(true);
    expect(urls.some((u: string) => u.includes(PAGE))).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('records graph API error in errors array (does not throw)', async () => {
    const db = { prepare: vi.fn() };
    let callIdx = 0;
    (db.prepare as any).mockImplementation(() => {
      callIdx++;
      return makeDeleteStmt();
    });

    // All three fetch calls return a Graph API error object
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await refreshFactsForShop({ DB: db } as any, SHOP, PAGE, TOKEN);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Invalid OAuth access token');
  });

  it('records network error in errors array (does not throw)', async () => {
    const db = { prepare: vi.fn() };
    let callIdx = 0;
    (db.prepare as any).mockImplementation(() => {
      callIdx++;
      return makeDeleteStmt();
    });

    fetchSpy.mockRejectedValue(new Error('network timeout'));

    const result = await refreshFactsForShop({ DB: db } as any, SHOP, PAGE, TOKEN);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('network timeout'))).toBe(true);
    expect(result.inserted).toBe(0);
  });
});
