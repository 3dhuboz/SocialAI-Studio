/**
 * Unit tests for workers/api/src/lib/archetypes.ts — runtime archetype
 * resolution + the three-layer classifier (keyword → Vectorize → Haiku).
 *
 * NOTE on scope: the FRONTEND archetype library lives in src/data/
 * archetypes.ts and has its own test suite (src/data/__tests__/
 * archetypes.test.ts) that covers the pure keyword-matcher (a few dozen
 * SMB descriptions → classified archetype). This file covers the
 * server-side glue:
 *
 *   - resolveArchetypeSlug — D1 lookup with client-tier-wins resolution
 *   - classifyArchetypeFromFingerprint — three-layer logic against
 *     mocked D1 + global fetch + the Vectorize binding
 *
 * Mocks the D1 + AI + Vectorize bindings via thin function stubs so the
 * tests run in a plain Node context (no miniflare needed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveArchetypeSlug,
  classifyArchetypeFromFingerprint,
  classifyViaVectorize,
} from '../lib/archetypes';

// ── resolveArchetypeSlug — pure D1 lookup ────────────────────────────

/** Build an Env stub whose users / clients rows return whatever the test
 *  provides. Routes the prepare(sql) call to the right return value. */
function makeResolveEnv(opts: {
  userRow?: { archetype_slug: string | null } | null;
  clientRow?: { archetype_slug: string | null } | null;
  userError?: Error;
  clientError?: Error;
}): any {
  const prepare = vi.fn().mockImplementation((sql: string) => ({
    bind: () => ({
      first: () => {
        const lower = sql.toLowerCase();
        if (lower.includes('from clients')) {
          if (opts.clientError) return Promise.reject(opts.clientError);
          return Promise.resolve(opts.clientRow === undefined ? null : opts.clientRow);
        }
        if (lower.includes('from users')) {
          if (opts.userError) return Promise.reject(opts.userError);
          return Promise.resolve(opts.userRow === undefined ? null : opts.userRow);
        }
        return Promise.resolve(null);
      },
    }),
  }));
  return { DB: { prepare } };
}

describe('resolveArchetypeSlug', () => {
  it('returns null when both user and client rows are missing', async () => {
    const env = makeResolveEnv({});
    expect(await resolveArchetypeSlug(env, 'u1', null)).toBeNull();
  });

  it('returns user-level archetype when no clientId provided', async () => {
    const env = makeResolveEnv({ userRow: { archetype_slug: 'tech-saas-agency' } });
    expect(await resolveArchetypeSlug(env, 'u1', null)).toBe('tech-saas-agency');
  });

  it('returns NULL when users.archetype_slug is null', async () => {
    const env = makeResolveEnv({ userRow: { archetype_slug: null } });
    expect(await resolveArchetypeSlug(env, 'u1', null)).toBeNull();
  });

  it('CLIENT tier wins over user tier when client.archetype_slug is set', async () => {
    // Schema v9 invariant: agency users running a food client get the
    // food guardrails on that client's posts, not their own tech tier.
    const env = makeResolveEnv({
      userRow: { archetype_slug: 'tech-saas-agency' },
      clientRow: { archetype_slug: 'food-restaurant' },
    });
    expect(await resolveArchetypeSlug(env, 'u1', 'client-99')).toBe('food-restaurant');
  });

  it('falls back to user tier when client row exists but archetype_slug is null', async () => {
    const env = makeResolveEnv({
      userRow: { archetype_slug: 'tech-saas-agency' },
      clientRow: { archetype_slug: null },
    });
    expect(await resolveArchetypeSlug(env, 'u1', 'client-99')).toBe('tech-saas-agency');
  });

  it('falls back to user tier when client row does not exist', async () => {
    const env = makeResolveEnv({
      userRow: { archetype_slug: 'tech-saas-agency' },
      clientRow: null,
    });
    expect(await resolveArchetypeSlug(env, 'u1', 'client-missing')).toBe('tech-saas-agency');
  });

  it('client lookup failure falls through to user tier (does not throw)', async () => {
    const env = makeResolveEnv({
      userRow: { archetype_slug: 'tech-saas-agency' },
      clientError: new Error('D1 timeout'),
    });
    expect(await resolveArchetypeSlug(env, 'u1', 'client-99')).toBe('tech-saas-agency');
  });

  it('user lookup failure returns null (does not throw)', async () => {
    const env = makeResolveEnv({ userError: new Error('D1 down') });
    expect(await resolveArchetypeSlug(env, 'u1', null)).toBeNull();
  });

  it('client lookup is SKIPPED when clientId is null (no DB call to clients table)', async () => {
    const prepare = vi.fn().mockImplementation((sql: string) => ({
      bind: () => ({
        first: () => Promise.resolve(sql.toLowerCase().includes('from users') ? { archetype_slug: 'food-restaurant' } : null),
      }),
    }));
    const env = { DB: { prepare } } as any;
    await resolveArchetypeSlug(env, 'u1', null);
    // None of the prepare() calls should reference `clients`.
    const sqls = prepare.mock.calls.map((c) => (c[0] as string).toLowerCase());
    expect(sqls.some((s) => s.includes('from clients'))).toBe(false);
  });
});

// ── classifyArchetypeFromFingerprint — three-layer classifier ─────────

let fetchMock: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  fetchMock = vi.fn();
  originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as any;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Minimal archetype row factory — only the columns the classifier reads. */
function makeArchetypeRow(slug: string, keywords: string[], opts: Partial<{ name: string; description: string }> = {}) {
  return {
    slug,
    name: opts.name ?? slug,
    description: opts.description ?? `${slug} description`,
    keywords: JSON.stringify(keywords),
    image_examples: JSON.stringify(['example scene']),
    image_avoid_notes: 'no people',
    voice_cues: 'warm',
    content_pillars: JSON.stringify(['pillar a', 'pillar b']),
    banned_trope_extras: null,
  };
}

function makeClassifyEnv(opts: {
  archetypes: ReturnType<typeof makeArchetypeRow>[];
  openrouterKey?: string;
  vectorize?: { matches: Array<{ id: string; score: number }> } | null;
  aiBinding?: boolean;
}): any {
  const prepare = vi.fn().mockImplementation((_sql: string) => ({
    all: () => Promise.resolve({ results: opts.archetypes }),
  }));
  const env: any = {
    DB: { prepare },
    OPENROUTER_API_KEY: opts.openrouterKey,
  };
  if (opts.vectorize !== undefined) {
    env.ARCHETYPE_VEC = {
      query: vi.fn().mockResolvedValue(opts.vectorize ?? { matches: [] }),
      upsert: vi.fn(),
      describe: vi.fn(),
    };
  }
  if (opts.aiBinding) {
    env.AI = {
      run: vi.fn().mockResolvedValue({ data: [new Array(768).fill(0.1)] }),
    };
  }
  return env;
}

describe('classifyArchetypeFromFingerprint — Layer 0 (keyword)', () => {
  it('returns the keyword winner when it has ≥2 hits and a ≥2 margin', async () => {
    const env = makeClassifyEnv({
      archetypes: [
        makeArchetypeRow('tech-saas-agency', ['saas', 'platform', 'agency', 'whitelabel']),
        makeArchetypeRow('food-restaurant', ['restaurant', 'cafe', 'menu']),
      ],
    });
    const r = await classifyArchetypeFromFingerprint(env, 'Whitelabel SaaS platform for agencies') as any;
    expect(r.chosen).toBeDefined();
    expect(r.chosen.slug).toBe('tech-saas-agency');
    expect(r.chosen.confidence).toBe(0.9);
    expect(r.chosen.reasoning).toContain('Keyword match');
    expect(r.archetypePayload.slug).toBe('tech-saas-agency');
  });

  it('falls THROUGH keyword layer when only 1 hit (insufficient confidence)', async () => {
    const env = makeClassifyEnv({
      archetypes: [
        makeArchetypeRow('tech-saas-agency', ['saas', 'platform', 'agency']),
        makeArchetypeRow('food-restaurant', ['restaurant', 'cafe']),
      ],
      openrouterKey: 'or-test',
    });
    // Only 1 keyword hit ("agency") → must fall through to next layer.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"archetype_slug":"tech-saas-agency","confidence":0.8,"reasoning":"saas-y"}' } }],
      }), { status: 200 }),
    );
    const r = await classifyArchetypeFromFingerprint(env, 'we are an agency') as any;
    expect(r.chosen).toBeDefined();
    // Came from Haiku, not the keyword layer.
    expect(r.chosen.reasoning).not.toMatch(/keyword match/i);
  });

  it('falls through keyword layer when margin over runner-up is <2', async () => {
    const env = makeClassifyEnv({
      archetypes: [
        makeArchetypeRow('tech-saas-agency', ['saas', 'platform']),
        makeArchetypeRow('food-restaurant', ['restaurant', 'cafe']),
      ],
      openrouterKey: 'or-test',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"archetype_slug":"food-restaurant","confidence":0.7,"reasoning":"tie-break"}' } }],
      }), { status: 200 }),
    );
    // 2 saas hits and 2 restaurant hits → margin=0, falls through.
    const r = await classifyArchetypeFromFingerprint(env, 'saas platform for a restaurant cafe') as any;
    expect(r.chosen).toBeDefined();
    expect(r.chosen.reasoning).not.toMatch(/keyword match/i);
  });
});

describe('classifyArchetypeFromFingerprint — Layer 0.5 (Vectorize)', () => {
  it('uses the Vectorize verdict when bindings are configured AND confidence ≥ 0.78', async () => {
    const env = makeClassifyEnv({
      archetypes: [
        makeArchetypeRow('tech-saas-agency', ['saas']),
        makeArchetypeRow('food-restaurant', ['cafe']),
      ],
      vectorize: { matches: [{ id: 'tech-saas-agency', score: 0.91 }] },
      aiBinding: true,
    });
    const r = await classifyArchetypeFromFingerprint(env, 'we build software for businesses') as any;
    expect(r.chosen.slug).toBe('tech-saas-agency');
    expect(r.chosen.reasoning).toContain('Vectorize match');
    expect(r.chosen.confidence).toBeCloseTo(0.91, 2);
  });

  it('falls through to Haiku when Vectorize confidence < 0.78', async () => {
    const env = makeClassifyEnv({
      archetypes: [makeArchetypeRow('tech-saas-agency', ['saas'])],
      vectorize: { matches: [{ id: 'tech-saas-agency', score: 0.65 }] },
      aiBinding: true,
      openrouterKey: 'or-test',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"archetype_slug":"tech-saas-agency","confidence":0.9,"reasoning":"haiku"}' } }],
      }), { status: 200 }),
    );
    const r = await classifyArchetypeFromFingerprint(env, 'fuzzy desc') as any;
    expect(r.chosen.reasoning).not.toContain('Vectorize');
  });

  it('falls through when Vectorize bindings are not configured', async () => {
    const env = makeClassifyEnv({
      archetypes: [makeArchetypeRow('tech-saas-agency', ['saas'])],
      openrouterKey: 'or-test',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"archetype_slug":"tech-saas-agency","confidence":0.8,"reasoning":"haiku"}' } }],
      }), { status: 200 }),
    );
    const r = await classifyArchetypeFromFingerprint(env, 'fuzzy desc') as any;
    expect(r.chosen).toBeDefined();
  });

  it('Vectorize layer failure does not crash the classifier — falls through to Haiku', async () => {
    const env: any = {
      DB: { prepare: vi.fn().mockReturnValue({
        all: () => Promise.resolve({ results: [makeArchetypeRow('tech-saas-agency', ['saas'])] }),
      }) },
      AI: { run: () => Promise.reject(new Error('AI binding down')) },
      ARCHETYPE_VEC: { query: vi.fn() },
      OPENROUTER_API_KEY: 'or-test',
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"archetype_slug":"tech-saas-agency","confidence":0.7,"reasoning":"haiku"}' } }],
      }), { status: 200 }),
    );
    const r = await classifyArchetypeFromFingerprint(env, 'desc') as any;
    expect(r.chosen).toBeDefined();
  });
});

describe('classifyArchetypeFromFingerprint — Layer 1 (Haiku fallback)', () => {
  it('falls back to Haiku when keyword + Vectorize both miss', async () => {
    const env = makeClassifyEnv({
      archetypes: [makeArchetypeRow('tech-saas-agency', ['saas'])],
      openrouterKey: 'or-key',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"archetype_slug":"tech-saas-agency","confidence":0.95,"reasoning":"clearly saas"}' } }],
      }), { status: 200 }),
    );
    const r = await classifyArchetypeFromFingerprint(env, 'we are a digital agency that does many things') as any;
    expect(r.chosen.slug).toBe('tech-saas-agency');
    expect(r.chosen.confidence).toBe(0.95);
    expect(r.chosen.reasoning).toBe('clearly saas');
  });

  it('clamps Haiku confidence to [0, 1]', async () => {
    const env = makeClassifyEnv({
      archetypes: [makeArchetypeRow('tech-saas-agency', ['saas'])],
      openrouterKey: 'k',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"archetype_slug":"tech-saas-agency","confidence":1.5,"reasoning":"x"}' } }],
      }), { status: 200 }),
    );
    const r = await classifyArchetypeFromFingerprint(env, 'fuzzy') as any;
    expect(r.chosen.confidence).toBe(1);
  });

  it('defaults to 0.7 confidence when Haiku omits the confidence field', async () => {
    const env = makeClassifyEnv({
      archetypes: [makeArchetypeRow('tech-saas-agency', ['saas'])],
      openrouterKey: 'k',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"archetype_slug":"tech-saas-agency","reasoning":"x"}' } }],
      }), { status: 200 }),
    );
    const r = await classifyArchetypeFromFingerprint(env, 'fuzzy') as any;
    expect(r.chosen.confidence).toBe(0.7);
  });

  it('returns error when Haiku returns an unknown slug', async () => {
    const env = makeClassifyEnv({
      archetypes: [makeArchetypeRow('tech-saas-agency', ['saas'])],
      openrouterKey: 'k',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"archetype_slug":"made-up-slug","confidence":0.9,"reasoning":"x"}' } }],
      }), { status: 200 }),
    );
    const r = await classifyArchetypeFromFingerprint(env, 'fuzzy') as any;
    expect('error' in r).toBe(true);
    expect(r.status).toBe(502);
    expect(r.error).toMatch(/unknown slug/);
    expect(r.valid_slugs).toEqual(['tech-saas-agency']);
  });

  it('returns error when Haiku returns malformed JSON', async () => {
    const env = makeClassifyEnv({
      archetypes: [makeArchetypeRow('tech-saas-agency', ['saas'])],
      openrouterKey: 'k',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{ message: { content: '{not json}' } }],
      }), { status: 200 }),
    );
    const r = await classifyArchetypeFromFingerprint(env, 'fuzzy') as any;
    expect('error' in r).toBe(true);
    expect(r.error).toMatch(/malformed JSON/);
    expect(r.status).toBe(502);
  });

  it('returns error when OpenRouter returns 5xx', async () => {
    const env = makeClassifyEnv({
      archetypes: [makeArchetypeRow('tech-saas-agency', ['saas'])],
      openrouterKey: 'k',
    });
    fetchMock.mockResolvedValueOnce(new Response('upstream burned', { status: 503 }));
    const r = await classifyArchetypeFromFingerprint(env, 'fuzzy') as any;
    expect('error' in r).toBe(true);
    expect(r.status).toBe(502);
    expect(r.error).toMatch(/503/);
  });

  it('returns error when OPENROUTER_API_KEY is missing AND no upstream resolved chosen', async () => {
    const env = makeClassifyEnv({
      archetypes: [makeArchetypeRow('tech-saas-agency', ['saas'])],
      openrouterKey: undefined,
    });
    const r = await classifyArchetypeFromFingerprint(env, 'fuzzy') as any;
    expect('error' in r).toBe(true);
    expect(r.error).toMatch(/OPENROUTER_API_KEY/);
  });

  it('returns error when business_archetypes table is empty', async () => {
    const env = makeClassifyEnv({ archetypes: [] });
    const r = await classifyArchetypeFromFingerprint(env, 'anything') as any;
    expect('error' in r).toBe(true);
    expect(r.error).toMatch(/business_archetypes table is empty/);
    expect(r.status).toBe(500);
  });

  it('truncates Haiku reasoning to 400 chars (defensive against runaway prose)', async () => {
    const env = makeClassifyEnv({
      archetypes: [makeArchetypeRow('tech-saas-agency', ['saas'])],
      openrouterKey: 'k',
    });
    const longReasoning = 'a'.repeat(2000);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ archetype_slug: 'tech-saas-agency', confidence: 0.9, reasoning: longReasoning }) } }],
      }), { status: 200 }),
    );
    const r = await classifyArchetypeFromFingerprint(env, 'fuzzy') as any;
    expect(r.chosen.reasoning.length).toBe(400);
  });
});

// ── classifyViaVectorize ─────────────────────────────────────────────

describe('classifyViaVectorize', () => {
  it('returns null when bindings are not configured', async () => {
    const env: any = {}; // no ARCHETYPE_VEC, no AI
    expect(await classifyViaVectorize(env, 'desc')).toBeNull();
  });

  it('returns the match id + score on success', async () => {
    const env: any = {
      AI: { run: vi.fn().mockResolvedValue({ data: [new Array(768).fill(0.5)] }) },
      ARCHETYPE_VEC: {
        query: vi.fn().mockResolvedValue({ matches: [{ id: 'food-restaurant', score: 0.82 }] }),
      },
    };
    const r = await classifyViaVectorize(env, 'cafe in bondi');
    expect(r).toEqual({ slug: 'food-restaurant', confidence: 0.82 });
  });

  it('returns null when bge-base returns unexpected vector shape', async () => {
    const env: any = {
      AI: { run: vi.fn().mockResolvedValue({ data: [new Array(512).fill(0.5)] }) }, // wrong dimension
      ARCHETYPE_VEC: { query: vi.fn() },
    };
    const r = await classifyViaVectorize(env, 'desc');
    expect(r).toBeNull();
  });

  it('returns null when bge-base returns a non-array', async () => {
    const env: any = {
      AI: { run: vi.fn().mockResolvedValue({ data: 'oops not an array' }) },
      ARCHETYPE_VEC: { query: vi.fn() },
    };
    const r = await classifyViaVectorize(env, 'desc');
    expect(r).toBeNull();
  });

  it('returns null when Vectorize returns no matches', async () => {
    const env: any = {
      AI: { run: vi.fn().mockResolvedValue({ data: [new Array(768).fill(0.5)] }) },
      ARCHETYPE_VEC: { query: vi.fn().mockResolvedValue({ matches: [] }) },
    };
    const r = await classifyViaVectorize(env, 'desc');
    expect(r).toBeNull();
  });

  it('accepts the alt embedding shape: { embedding: [...] }', async () => {
    const env: any = {
      AI: { run: vi.fn().mockResolvedValue({ embedding: new Array(768).fill(0.5) }) },
      ARCHETYPE_VEC: {
        query: vi.fn().mockResolvedValue({ matches: [{ id: 'tech-saas-agency', score: 0.9 }] }),
      },
    };
    const r = await classifyViaVectorize(env, 'desc');
    expect(r?.slug).toBe('tech-saas-agency');
  });
});
