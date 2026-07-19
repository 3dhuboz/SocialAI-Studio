import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import {
  publishPersistedPost,
  recordPublishedPostBestEffort,
  type PersistedPublishPost,
  type PublishOrchestratorDeps,
  type PublicationRecordDeps,
} from '../lib/publishing/publish-orchestrator';
import { makeRecordingD1 } from './helpers/recording-d1';

interface ProductionSource {
  path: string;
  source: string;
}

function productionTypeScriptSources(root: string): ProductionSource[] {
  const sources: ProductionSource[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') visit(resolve(directory, entry.name));
        continue;
      }
      if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) continue;
      if (/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) continue;
      const path = resolve(directory, entry.name);
      sources.push({ path, source: readFileSync(path, 'utf8') });
    }
  };
  visit(root);
  return sources;
}

function requestMethod(call: ts.CallExpression): string {
  const init = call.arguments[1];
  if (!init || !ts.isObjectLiteralExpression(init)) return init ? 'UNKNOWN' : 'GET';
  if (init.properties.some((property) => ts.isSpreadAssignment(property))) {
    return 'UNKNOWN';
  }
  const method = init.properties.find((property) => {
    if (!('name' in property) || !property.name) return false;
    return (ts.isIdentifier(property.name) && property.name.text === 'method')
      || (ts.isStringLiteral(property.name) && property.name.text === 'method');
  });
  if (!method) return 'GET';
  if (!ts.isPropertyAssignment(method) || !ts.isStringLiteralLike(method.initializer)) {
    return 'UNKNOWN';
  }
  return method.initializer.text.toUpperCase();
}

function graphUrlBindings(sourceFile: ts.SourceFile): Set<string> {
  const declarations = new Map<string, string>();
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
    ) {
      declarations.set(node.name.text, node.initializer.getText(sourceFile));
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const graphBindings = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, initializer] of declarations) {
      if (graphBindings.has(name)) continue;
      const directlyGraph = /graph\.facebook\.com/i.test(initializer);
      const derivedFromGraph = [...graphBindings].some((binding) =>
        new RegExp(`\\b${binding}\\b`).test(initializer),
      );
      if (directlyGraph || derivedFromGraph) {
        graphBindings.add(name);
        changed = true;
      }
    }
  }
  return graphBindings;
}

function providerPublicationBypasses(sources: ProductionSource[]): string[] {
  const bypasses: string[] = [];
  for (const item of sources) {
    const normalizedPath = item.path.replace(/\\/g, '/');
    const isOrchestrator = normalizedPath.endsWith(
      '/lib/publishing/publish-orchestrator.ts',
    );
    const sourceFile = ts.createSourceFile(
      item.path,
      item.source,
      ts.ScriptTarget.Latest,
      true,
      item.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || isOrchestrator) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (!/(?:^|\/)postproxy$/.test(statement.moduleSpecifier.text)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        bypasses.push(`${normalizedPath}: namespace Postproxy import`);
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName?.text ?? element.name.text) === 'createPost') {
            bypasses.push(`${normalizedPath}: direct Postproxy createPost import`);
          }
        }
      }
    }

    const graphBindings = graphUrlBindings(sourceFile);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        const rawFetch = (ts.isIdentifier(expression) && expression.text === 'fetch')
          || (ts.isPropertyAccessExpression(expression)
            && expression.name.text === 'fetch'
            && expression.expression.getText(sourceFile) === 'globalThis');
        const urlText = node.arguments[0]?.getText(sourceFile) ?? '';
        const graphTarget = /graph\.facebook\.com/i.test(urlText)
          || [...graphBindings].some((binding) =>
            new RegExp(`\\b${binding}\\b`).test(urlText),
          );
        const method = requestMethod(node);
        if (
          rawFetch
          && graphTarget
          && (method === 'POST' || method === 'UNKNOWN')
          && !isOrchestrator
        ) {
          const callText = node.getText(sourceFile);
          const diagnosticReelStart = normalizedPath.endsWith('/routes/facebook.ts')
            && /\/video_reels\b/.test(callText)
            && /upload_phase\s*:\s*['"]start['"]/.test(callText)
            && !/video_state\s*=\s*PUBLISHED|upload_phase\s*:\s*['"](?:finish|transfer)['"]/.test(callText);
          if (!diagnosticReelStart) {
            const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            bypasses.push(`${normalizedPath}:${position.line + 1}: raw Facebook POST`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return bypasses;
}

const fixturePost: PersistedPublishPost = {
  id: 'p1',
  user_id: 'u1',
  client_id: null,
  owner_kind: 'user',
  owner_id: 'u1',
  content: 'Safe caption',
  platform: 'facebook',
  hashtags: '[]',
  image_url: 'https://cdn.example/image.jpg',
  post_type: 'image',
  video_url: null,
  video_status: null,
};

const postproxyTarget = {
  backend: 'postproxy' as const,
  payload: {
    profileId: 'profile-1',
    body: 'Safe caption',
    media: ['https://cdn.example/image.jpg'],
    format: 'post' as const,
    pageId: 'page-1',
    platform: 'facebook' as const,
  },
};

const graphTarget = {
  backend: 'graph' as const,
  url: 'https://graph.facebook.com/v21.0/page/feed',
  init: { method: 'POST' },
};

const graphReelFinishTarget = {
  backend: 'graph_reel' as const,
  pageId: 'page-1',
  pageAccessToken: 'page-token',
  description: 'Safe reel caption',
  videoId: 'video-1',
};

function safeDeps(calls: { critic: number; postproxy: number; graph: number }): Partial<PublishOrchestratorDeps> {
  return {
    validateWorkspace: async () => undefined,
    evaluatePreflight: async () => {
      calls.critic += 1;
      return {
        mode: 'off',
        state: 'pending',
        mayPublish: true,
        mustHold: false,
        decisionId: null,
      };
    },
    createPost: async () => {
      calls.postproxy += 1;
      return { id: 'postproxy-1' } as any;
    },
    graphFetch: async () => {
      calls.graph += 1;
      return new Response('{"id":"facebook-1"}', { status: 200 });
    },
  };
}

describe('publishPersistedPost', () => {
  it('does not rebind Cloudflare global fetch when using the default Graph transport', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    delete deps.graphFetch;
    (deps as any).recordDeliveryReceipt = async () => undefined;
    (deps as any).buildContentHash = async () => 'a'.repeat(64);
    (deps as any).newAttemptId = () => 'attempt-cloudflare-fetch-binding';

    const receiverSensitiveFetch = vi.fn(function (
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation: incorrect fetch receiver');
      }
      return Promise.resolve(new Response('{"error":{"message":"invalid token"}}', {
        status: 400,
      }));
    });

    vi.stubGlobal('fetch', receiverSensitiveFetch);
    vi.resetModules();
    try {
      const module = await import('../lib/publishing/publish-orchestrator');
      const outcome = await module.publishPersistedPost(
        { DB: {} as D1Database } as Env,
        fixturePost,
        graphTarget,
        deps,
      );

      expect(outcome).toMatchObject({ backend: 'graph' });
      expect(receiverSensitiveFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('makes zero Postproxy or Graph calls when preflight holds', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    deps.evaluatePreflight = async () => {
      calls.critic += 1;
      return {
        mode: 'approval',
        state: 'hold_amber',
        mayPublish: false,
        mustHold: true,
        decisionId: 'decision-1',
      };
    };
    deps.persistHold = async () => undefined;

    await expect(
      publishPersistedPost({} as Env, fixturePost, postproxyTarget, deps),
    ).rejects.toThrow('release preflight');

    expect(calls).toEqual({ critic: 1, postproxy: 0, graph: 0 });
  });

  it('runs a fresh preflight before the final Facebook reel publish phase', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    let finishUrl = '';
    deps.graphFetch = async (input) => {
      calls.graph += 1;
      finishUrl = String(input);
      return new Response('{"success":true}', { status: 200 });
    };

    const outcome = await publishPersistedPost(
      {} as Env,
      { ...fixturePost, post_type: 'video', video_status: 'ready' },
      graphReelFinishTarget,
      deps,
    );

    expect(outcome).toMatchObject({ backend: 'graph_reel', videoId: 'video-1' });
    expect(finishUrl).toContain('/page-1/video_reels');
    expect(finishUrl).toContain('upload_phase=finish');
    expect(finishUrl).toContain('video_state=PUBLISHED');
    expect(finishUrl).toContain('video_id=video-1');
    expect(calls).toEqual({ critic: 1, postproxy: 0, graph: 1 });
  });

  it('makes zero final Facebook reel calls when the fresh preflight holds', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    const persistHold = vi.fn(async () => undefined);
    deps.evaluatePreflight = async () => {
      calls.critic += 1;
      return {
        mode: 'enforce',
        state: 'block_red',
        mayPublish: false,
        mustHold: true,
        decisionId: 'reel-hold-1',
      };
    };
    deps.persistHold = persistHold;

    await expect(publishPersistedPost(
      {} as Env,
      { ...fixturePost, post_type: 'video', video_status: 'ready' },
      graphReelFinishTarget,
      deps,
    )).rejects.toThrow('release preflight');

    expect(persistHold).toHaveBeenCalledOnce();
    expect(calls).toEqual({ critic: 1, postproxy: 0, graph: 0 });
  });

  it('makes zero final Facebook reel calls for an inactive workspace', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    deps.validateWorkspace = async () => {
      throw new Error('workspace inactive: client is on hold');
    };

    await expect(publishPersistedPost(
      {} as Env,
      { ...fixturePost, post_type: 'video', video_status: 'ready' },
      graphReelFinishTarget,
      deps,
    )).rejects.toThrow('workspace inactive');

    expect(calls).toEqual({ critic: 0, postproxy: 0, graph: 0 });
  });

  it('preserves Postproxy and Graph delivery when preflight allows it', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);

    const postproxy = await publishPersistedPost(
      {} as Env,
      fixturePost,
      postproxyTarget,
      deps,
    );
    const graph = await publishPersistedPost(
      {} as Env,
      fixturePost,
      graphTarget,
      deps,
    );

    expect(postproxy.backend).toBe('postproxy');
    expect(graph.backend).toBe('graph');
    expect(calls).toEqual({ critic: 2, postproxy: 1, graph: 1 });
  });

  it('appends tenant-scoped shadow receipts around an accepted provider request', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const receipts: Array<Record<string, unknown>> = [];
    const deps = safeDeps(calls);
    (deps as any).recordDeliveryReceipt = async (
      _db: D1Database,
      input: Record<string, unknown>,
    ) => {
      receipts.push(input);
    };

    await expect(publishPersistedPost(
      { DB: {} as D1Database } as Env,
      fixturePost,
      postproxyTarget,
      deps,
    )).resolves.toMatchObject({ backend: 'postproxy' });

    expect(receipts).toHaveLength(2);
    expect(receipts[0]).toMatchObject({
      userId: 'u1',
      clientId: null,
      ownerKind: 'user',
      ownerId: 'u1',
      postId: 'p1',
      backend: 'postproxy',
      eventKind: 'attempt_started',
    });
    expect(receipts[1]).toMatchObject({
      eventKind: 'provider_accepted',
      remotePostId: 'postproxy-1',
    });
    expect(receipts[1].attemptId).toBe(receipts[0].attemptId);
    expect(receipts[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('classifies a provider timeout as ambiguous without changing the thrown error', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const receipts: Array<Record<string, unknown>> = [];
    const deps = safeDeps(calls);
    const timeout = new Error('The operation was aborted after 30 seconds');
    timeout.name = 'AbortError';
    deps.createPost = async () => {
      calls.postproxy += 1;
      throw timeout;
    };
    (deps as any).recordDeliveryReceipt = async (
      _db: D1Database,
      input: Record<string, unknown>,
    ) => {
      receipts.push(input);
    };

    await expect(publishPersistedPost(
      { DB: {} as D1Database } as Env,
      fixturePost,
      postproxyTarget,
      deps,
    )).rejects.toBe(timeout);

    expect(receipts.map((receipt) => receipt.eventKind)).toEqual([
      'attempt_started',
      'ambiguous_failure',
    ]);
    expect(receipts[1]).toMatchObject({ errorClass: 'timeout' });
  });

  it('records an explicit Graph rejection while preserving the response for its caller', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const receipts: Array<Record<string, unknown>> = [];
    const deps = safeDeps(calls);
    deps.graphFetch = async () => {
      calls.graph += 1;
      return new Response('{"error":{"message":"invalid token"}}', { status: 400 });
    };
    (deps as any).recordDeliveryReceipt = async (
      _db: D1Database,
      input: Record<string, unknown>,
    ) => {
      receipts.push(input);
    };

    const outcome = await publishPersistedPost(
      { DB: {} as D1Database } as Env,
      fixturePost,
      graphTarget,
      deps,
    );

    expect(outcome.backend).toBe('graph');
    if (outcome.backend === 'graph') {
      expect(outcome.response.status).toBe(400);
      expect(await outcome.response.json()).toEqual({ error: { message: 'invalid token' } });
    }
    expect(receipts.at(-1)).toMatchObject({
      eventKind: 'definite_failure',
      errorClass: 'provider_rejected',
      httpStatus: 400,
    });
  });

  it('never blocks delivery when shadow receipt storage is unavailable', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    (deps as any).recordDeliveryReceipt = async () => {
      throw new Error('D1 shadow receipt unavailable');
    };

    await expect(publishPersistedPost(
      { DB: {} as D1Database } as Env,
      fixturePost,
      postproxyTarget,
      deps,
    )).resolves.toMatchObject({ backend: 'postproxy' });
    expect(calls.postproxy).toBe(1);
  });

  it('never blocks delivery when a shadow attempt id cannot be created', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    (deps as any).newAttemptId = () => {
      throw new Error('random source unavailable');
    };

    await expect(publishPersistedPost(
      { DB: {} as D1Database } as Env,
      fixturePost,
      postproxyTarget,
      deps,
    )).resolves.toMatchObject({ backend: 'postproxy' });
    expect(calls.postproxy).toBe(1);
  });

  it('runs both Facebook reel kick requests only after one preflight pass', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    deps.graphFetch = async (url) => {
      calls.graph += 1;
      return String(url).includes('/video_reels')
        ? new Response(
            JSON.stringify({
              video_id: 'video-1',
              upload_url: 'https://upload.facebook.example/video-1',
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ success: true }), { status: 200 });
    };

    const outcome = await publishPersistedPost(
      {} as Env,
      {
        ...fixturePost,
        post_type: 'video',
        video_url: 'https://cdn.example/final.mp4',
        video_status: 'ready',
      },
      {
        backend: 'graph_reel',
        pageId: 'page-1',
        pageAccessToken: 'token-1',
        description: 'Safe reel',
        videoUrl: 'https://cdn.example/final.mp4',
      },
      deps,
    );

    expect(outcome).toMatchObject({ backend: 'graph_reel', videoId: 'video-1' });
    expect(calls).toEqual({ critic: 1, postproxy: 0, graph: 2 });
  });

  it('classifies an explicit Facebook reel 400 as a definite rejection', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const receipts: Array<Record<string, unknown>> = [];
    const deps = safeDeps(calls);
    deps.graphFetch = async () => {
      calls.graph += 1;
      return new Response('{"error":{}}', { status: 400 });
    };
    (deps as any).recordDeliveryReceipt = async (
      _db: D1Database,
      input: Record<string, unknown>,
    ) => {
      receipts.push(input);
    };

    await expect(publishPersistedPost(
      { DB: {} as D1Database } as Env,
      {
        ...fixturePost,
        post_type: 'video',
        video_url: 'https://cdn.example/final.mp4',
        video_status: 'ready',
      },
      {
        backend: 'graph_reel',
        pageId: 'page-1',
        pageAccessToken: 'token-1',
        description: 'Safe reel',
        videoUrl: 'https://cdn.example/final.mp4',
      },
      deps,
    )).rejects.toThrow('FB reel start: 400');

    expect(receipts.at(-1)).toMatchObject({
      eventKind: 'definite_failure',
      errorClass: 'provider_rejected',
      httpStatus: 400,
    });
  });

  it('runs Instagram container and publish requests after one preflight pass', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    deps.graphFetch = async (url) => {
      calls.graph += 1;
      return String(url).endsWith('/media')
        ? new Response(JSON.stringify({ id: 'container-1' }), { status: 200 })
        : new Response(JSON.stringify({ id: 'instagram-1' }), { status: 200 });
    };

    const outcome = await publishPersistedPost(
      {} as Env,
      { ...fixturePost, platform: 'instagram' },
      {
        backend: 'graph_instagram',
        accountId: 'ig-1',
        pageAccessToken: 'token-1',
        caption: 'Safe caption',
        imageUrl: 'https://cdn.example/image.jpg',
      },
      deps,
    );

    expect(outcome).toMatchObject({
      backend: 'graph_instagram',
      mediaId: 'instagram-1',
    });
    expect(calls).toEqual({ critic: 1, postproxy: 0, graph: 2 });
  });

  it('makes zero critic and network calls for invalid or on-hold ownership', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    deps.validateWorkspace = async () => {
      throw new Error('workspace inactive');
    };

    await expect(
      publishPersistedPost({} as Env, fixturePost, postproxyTarget, deps),
    ).rejects.toThrow('workspace inactive');

    expect(calls).toEqual({ critic: 0, postproxy: 0, graph: 0 });
  });

  it('persists enforced holds as Draft with all publish claims cleared', async () => {
    const { db, calls: sqlCalls } = makeRecordingD1();
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    deps.evaluatePreflight = async () => ({
      mode: 'approval',
      state: 'block_red',
      mayPublish: false,
      mustHold: true,
      decisionId: 'decision-red',
    });

    await expect(
      publishPersistedPost(
        { DB: db } as Env,
        fixturePost,
        postproxyTarget,
        deps,
      ),
    ).rejects.toThrow('release preflight');

    const hold = sqlCalls.find((call) => call.sql.includes("status = 'Draft'"));
    expect(hold?.sql).toContain('scheduled_for = NULL');
    expect(hold?.sql).toContain('claim_id = NULL');
    expect(hold?.sql).toContain('claim_at = NULL');
    expect(hold?.sql).toContain('reasoning = ?');
    expect(hold?.binds).toEqual(expect.arrayContaining(['p1', 'u1', 'user']));
    expect(hold?.binds.some((value) => String(value).includes('decision-red'))).toBe(true);
    expect(calls.postproxy).toBe(0);
    expect(calls.graph).toBe(0);
  });
});

describe('recordPublishedPostBestEffort', () => {
  it('resolves decision context with the complete canonical owner tuple', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM learning_decisions': [{ id: 'decision-1', reach_plan_id: 'reach-1' }],
    });

    await expect(recordPublishedPostBestEffort(
      { DB: db } as Env,
      fixturePost,
      {
        platform: 'facebook',
        remotePostId: 'facebook-1',
        permalink: null,
        decisionId: 'decision-1',
        publishedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        recordPublicationEvent: async () => undefined,
        fireAlert: async () => undefined,
      },
    )).resolves.toBe(true);

    const contextRead = calls.find((call) => call.sql.includes('FROM learning_decisions'))!;
    expect(contextRead.sql).toContain('owner_kind = ?');
    expect(contextRead.sql).toContain('owner_id = ?');
    expect(contextRead.binds).toEqual(expect.arrayContaining(['u1', '__owner__', 'user']));
  });

  it('records the actual destination and release context after remote success', async () => {
    const records: unknown[] = [];
    const deps: PublicationRecordDeps = {
      resolveDecisionContext: async () => ({
        decisionId: 'decision-1',
        reachPlanId: 'reach-1',
      }),
      recordPublicationEvent: async (_db, input) => {
        records.push(input);
      },
      fireAlert: async () => undefined,
    };

    const recorded = await recordPublishedPostBestEffort(
      { DB: {} as D1Database } as Env,
      fixturePost,
      {
        platform: 'facebook',
        remotePostId: 'facebook-1',
        permalink: 'https://facebook.example/posts/facebook-1',
        decisionId: 'decision-1',
        publishedAt: '2026-07-14T00:00:00.000Z',
      },
      deps,
    );

    expect(recorded).toBe(true);
    expect(records).toEqual([expect.objectContaining({
      userId: 'u1',
      clientId: null,
      ownerKind: 'user',
      ownerId: 'u1',
      postId: 'p1',
      platform: 'facebook',
      remotePostId: 'facebook-1',
      decisionId: 'decision-1',
      reachPlanId: 'reach-1',
    })]);
  });

  it('alerts but never throws when event recording fails after publication', async () => {
    const alerts: Array<{ key: string; body: string }> = [];
    const deps: PublicationRecordDeps = {
      resolveDecisionContext: async () => ({ decisionId: null, reachPlanId: null }),
      recordPublicationEvent: async () => {
        throw new Error('D1 write unavailable');
      },
      fireAlert: async (_env, key, _severity, body) => {
        alerts.push({ key, body });
      },
    };

    await expect(recordPublishedPostBestEffort(
      { DB: {} as D1Database } as Env,
      fixturePost,
      {
        platform: 'facebook',
        remotePostId: 'facebook-1',
        permalink: null,
        decisionId: null,
        publishedAt: '2026-07-14T00:00:00.000Z',
      },
      deps,
    )).resolves.toBe(false);

    expect(alerts).toEqual([expect.objectContaining({
      key: 'publication_event_missing',
      body: expect.stringContaining('p1'),
    })]);
  });
});

describe('publish egress source contracts', () => {
  const workerRoot = resolve(process.cwd(), 'src');
  const repoRoot = resolve(process.cwd(), '../..');

  it('defines additive, tenant-scoped, append-only v42 delivery shadow receipts', () => {
    const migration = readFileSync(
      resolve(repoRoot, 'workers/api/schema_v42_delivery_uncertainty_receipts.sql'),
      'utf8',
    );

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS publish_delivery_receipts');
    expect(migration).toContain('user_id TEXT NOT NULL');
    expect(migration).toContain('workspace_key TEXT NOT NULL');
    expect(migration).toContain('owner_kind TEXT NOT NULL');
    expect(migration).toContain('owner_id TEXT NOT NULL');
    expect(migration).toContain('shadow_only INTEGER NOT NULL DEFAULT 1');
    expect(migration).toContain('UNIQUE(attempt_id, event_kind)');
    expect(migration).toContain('REFERENCES posts(id) ON DELETE CASCADE');
    expect(migration).toContain('prevent_publish_delivery_receipt_update');
    expect(migration).not.toMatch(/ALTER TABLE posts|UPDATE posts|INSERT INTO posts/);
  });

  it('detects new direct Facebook and Postproxy publication primitives', () => {
    const bypasses = providerPublicationBypasses([
      {
        path: 'src/new-facebook-publisher.ts',
        source: `const graph = 'https://graph.facebook.com/v21.0';
          fetch(\`${'${graph}'}/page/feed\`, { method: 'POST' });`,
      },
      {
        path: 'src/new-postproxy-publisher.ts',
        source: `import { createPost as sendPost } from '../lib/postproxy';
          void sendPost;`,
      },
      {
        path: 'src/indirect-facebook-publisher.ts',
        source: `const graph = 'https://graph.facebook.com/v21.0/page/feed';
          const options = { method: 'POST' };
          fetch(graph, options);`,
      },
    ]);

    expect(bypasses).toEqual([
      'src/new-facebook-publisher.ts:2: raw Facebook POST',
      'src/new-postproxy-publisher.ts: direct Postproxy createPost import',
      'src/indirect-facebook-publisher.ts:3: raw Facebook POST',
    ]);
  });

  it('rejects provider publication calls outside the centralized orchestrator', () => {
    expect(providerPublicationBypasses(productionTypeScriptSources(workerRoot)))
      .toEqual([]);
  });

  it('routes manual Postproxy publishing through the orchestrator', () => {
    const source = readFileSync(
      resolve(workerRoot, 'routes/postproxy.ts'),
      'utf8',
    );

    expect(source).toContain('publishPersistedPost');
    expect(source).not.toContain('await createPost(c.env');
  });

  it('routes cron Postproxy and final Graph publishing through the orchestrator', () => {
    const source = readFileSync(
      resolve(workerRoot, 'cron/publish-missed.ts'),
      'utf8',
    );

    expect(source).toContain('publishPersistedPost');
    expect(source).not.toContain('postproxyCreatePost(env');
    expect(source).not.toContain('kickFacebookReelUpload(');
    expect(source).not.toContain('fbRes = await fetch(`${base}/${pageId}/photos');
    expect(source).not.toContain('fbRes = await fetch(`${base}/${pageId}/feed');
  });

  it('routes the delayed Facebook reel finish phase through a fresh orchestrator preflight', () => {
    const source = readFileSync(
      resolve(workerRoot, 'cron/poll-pending-reels.ts'),
      'utf8',
    );

    expect(source).toContain('publishPersistedPost');
    expect(source).toContain("status = 'Publishing'");
    expect(source).toContain('content, platform, hashtags, image_url');
    expect(source).toContain('video_script, video_shots');
    expect(source).toContain("backend: 'graph_reel'");
    expect(source).toContain('videoId: post.fb_video_id');
    expect(source).toContain("if (/workspace inactive/i.test(finishMessage))");
    expect(source).toContain("SET status = 'Draft', scheduled_for = NULL");
    expect(source).toContain("WHERE id = ? AND status = 'Draft'");
    expect(source).not.toContain('finishFacebookReel');
    expect(source).not.toContain('fb-page-reel-pending:');
    expect(source).not.toContain('video_state=PUBLISHED');
  });

  it('records only confirmed publication completion paths for later outcome collection', () => {
    const publishCron = readFileSync(
      resolve(workerRoot, 'cron/publish-missed.ts'),
      'utf8',
    );
    const reelPoll = readFileSync(
      resolve(workerRoot, 'cron/poll-pending-reels.ts'),
      'utf8',
    );
    const postproxyRoutes = readFileSync(
      resolve(workerRoot, 'routes/postproxy.ts'),
      'utf8',
    );

    expect(publishCron.match(/recordPublishedPostBestEffort\(/g)).toHaveLength(2);
    expect(reelPoll.match(/recordPublishedPostBestEffort\(/g)).toHaveLength(1);
    expect(postproxyRoutes.match(/recordPublishedPostBestEffort\(/g)).toHaveLength(2);

    expect(publishCron).not.toMatch(/graph_reel[\s\S]{0,900}recordPublishedPostBestEffort/);
    expect(postproxyRoutes).not.toMatch(/postproxy_status = 'pending'[\s\S]{0,500}recordPublishedPostBestEffort/);
  });

  it('routes Quick Post and Calendar publishing through the Worker only', () => {
    const source = readFileSync(resolve(repoRoot, 'src/App.tsx'), 'utf8');

    expect(source).not.toMatch(
      /FacebookService\.(postToPageDirect|postToPageWithImageUrl|postToInstagram)/,
    );
    expect(source).toContain('postproxyService.publishNow');
  });

  it('removes every frontend direct-publish helper and banned Facebook scheduling path', () => {
    const source = readFileSync(
      resolve(repoRoot, 'src/services/facebookService.ts'),
      'utf8',
    );

    for (const helper of [
      'postToPageDirect',
      'postToPageWithImageUrl',
      'postToPageScheduled',
      'postToInstagram',
      'postReelToInstagram',
    ]) {
      expect(source).not.toContain(`${helper}: async`);
    }
    expect(source).not.toContain('scheduled_publish_time');
    expect(source).not.toContain('/media_publish');
  });

  it('records preflight receipts after final image and ready-video persistence', () => {
    const imageSource = readFileSync(
      resolve(repoRoot, 'workers/api/src/cron/prewarm-images.ts'),
      'utf8',
    );
    const videoSource = readFileSync(
      resolve(repoRoot, 'workers/api/src/cron/prewarm-videos.ts'),
      'utf8',
    );

    expect(imageSource).toContain('evaluateReleasePreflight');
    expect(videoSource).toContain('evaluateReleasePreflight');
    expect(imageSource.indexOf('SET image_url = ?')).toBeLessThan(
      imageSource.lastIndexOf('evaluateReleasePreflight'),
    );
    expect(videoSource.indexOf("SET video_status = 'ready'")).toBeLessThan(
      videoSource.lastIndexOf('evaluateReleasePreflight'),
    );
    for (const source of [imageSource, videoSource]) {
      expect(source).toContain('owner_kind');
      expect(source).toContain('owner_id');
      expect(source).toContain('video_script');
      expect(source).toContain('video_shots');
    }
  });

  it('carries video script and shot context into manual and cron preflight candidates', () => {
    const routeSource = readFileSync(
      resolve(repoRoot, 'workers/api/src/routes/postproxy.ts'),
      'utf8',
    );
    const cronSource = readFileSync(
      resolve(repoRoot, 'workers/api/src/cron/publish-missed.ts'),
      'utf8',
    );

    for (const source of [routeSource, cronSource]) {
      expect(source).toContain('video_script');
      expect(source).toContain('video_shots');
    }
    expect(routeSource).toMatch(/video_script:\s*post\.video_script/);
    expect(routeSource).toMatch(/video_shots:\s*post\.video_shots/);
    expect(cronSource).toMatch(/video_script:\s*typeof post\.video_script/);
    expect(cronSource).toMatch(/video_shots:\s*typeof post\.video_shots/);
  });
});
