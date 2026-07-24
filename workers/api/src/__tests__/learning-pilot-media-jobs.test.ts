import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import type { CriticContext } from '../lib/learning/critic-context';
import {
  buildPilotVideoQueueUrl,
  pollRecordOnlyPilotVideoJob,
  startRecordOnlyPilotMediaJob,
  type PilotMediaJobDeps,
} from '../lib/learning/pilot-media-jobs';
import type { WorkspaceIdentity } from '../lib/learning/types';

interface TestD1Statement {
  bind(...values: unknown[]): TestD1Statement;
  run(): Promise<{ success: true; meta: { changes: number } }>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}

function sqliteD1(db: DatabaseSync): D1Database {
  const statement = (sql: string): TestD1Statement => {
    let bindings: unknown[] = [];
    const api: TestD1Statement = {
      bind(...values: unknown[]) {
        bindings = values;
        return api;
      },
      async run() {
        const result = db.prepare(sql).run(...bindings as any[]);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async first<T>() {
        return (db.prepare(sql).get(...bindings as any[]) ?? null) as T | null;
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...bindings as any[]) as T[] };
      },
    };
    return api;
  };

  return {
    prepare: statement,
    async batch(statements: TestD1Statement[]) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
}

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      client_id TEXT,
      owner_kind TEXT,
      owner_id TEXT,
      content TEXT NOT NULL DEFAULT '',
      platform TEXT,
      status TEXT,
      scheduled_for TEXT,
      hashtags TEXT DEFAULT '[]',
      image_url TEXT,
      topic TEXT,
      pillar TEXT,
      image_prompt TEXT,
      reasoning TEXT,
      post_type TEXT,
      video_url TEXT,
      video_status TEXT,
      video_script TEXT,
      video_shots TEXT,
      video_request_id TEXT,
      publish_attempts INTEGER DEFAULT 0
    );
    CREATE TABLE learning_pilot_enrollments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_key TEXT NOT NULL,
      client_id TEXT,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      consent_basis TEXT NOT NULL,
      consent_confirmed_at TEXT,
      consent_note TEXT,
      record_only INTEGER NOT NULL
    );
    CREATE TABLE workspace_learning_settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_key TEXT NOT NULL,
      client_id TEXT,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      autopublish_consent_at TEXT,
      autopublish_policy_version TEXT,
      experiment_rate INTEGER NOT NULL,
      monthly_ai_budget_usd_cents INTEGER NOT NULL,
      disabled_reason TEXT
    );
    CREATE TABLE clients (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT,
      status TEXT
    );
    CREATE TABLE publication_events (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL
    );
    CREATE TABLE publish_delivery_receipts (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL
    );
  `);
  db.exec(readFileSync(
    resolve(process.cwd(), 'schema_v49_learning_pilot_media_jobs.sql'),
    'utf8',
  ));
  db.exec(`
    INSERT INTO learning_pilot_enrollments (
      id,user_id,workspace_key,client_id,owner_kind,owner_id,policy_version,
      consent_basis,consent_confirmed_at,consent_note,record_only
    ) VALUES (
      'enrollment-1','owner-1','__owner__',NULL,'user','owner-1',
      '2026-07-14-v1','owner_self','2026-07-24T00:00:00.000Z',
      'Owner approved record-only staging evaluation.',1
    );
    INSERT INTO workspace_learning_settings (
      id,user_id,workspace_key,client_id,owner_kind,owner_id,mode,
      autopublish_consent_at,autopublish_policy_version,experiment_rate,
      monthly_ai_budget_usd_cents,disabled_reason
    ) VALUES (
      'settings-1','owner-1','__owner__',NULL,'user','owner-1','approval',
      NULL,NULL,0,500,NULL
    );
  `);
  return db;
}

const identity: WorkspaceIdentity = {
  userId: 'owner-1',
  workspaceKey: '__owner__',
  clientId: null,
  ownerKind: 'user',
  ownerId: 'owner-1',
};

const context: CriticContext = {
  profile: {
    name: 'Penny Wise I.T',
    type: 'Technology consultancy and custom software development',
    description: 'Builds custom workflow software for small businesses.',
  },
  verifiedFacts: [{
    ownerKind: 'user',
    ownerId: 'owner-1',
    clientId: null,
    factType: 'service',
    content: 'Custom workflow software development.',
    verifiedAt: '2026-07-20T00:00:00.000Z',
  }],
  recentPosts: [],
  forbiddenSubjects: ['circuit boards'],
};

function dependencies(nowRef: { value: Date }): PilotMediaJobDeps {
  let uuid = 0;
  return {
    generateDraft: vi.fn(async () => ({
      content: 'Map one repeated handoff before choosing the workflow automation that removes it.',
      hashtags: ['#WorkflowAutomation'],
      imagePrompt: 'Bright overhead photograph of a paper workflow map with arrows and one repeated handoff circled',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      attemptCount: 1,
    })),
    generateImage: vi.fn(async () => ({
      imageUrl: 'https://fal.example/pilot-image.webp',
      modelUsed: 'gpt-image-2-medium',
      archetypeSlug: 'tech-saas-agency',
    })),
    startVideo: vi.fn(async () => ({
      requestId: 'request-1',
      provider: 'fal' as const,
      model: 'kling-video/v1.6/standard/image-to-video' as const,
    })),
    pollVideo: vi.fn(async () => ({
      state: 'ready' as const,
      videoUrl: 'https://fal.example/pilot-video.mp4',
    })),
    now: () => new Date(nowRef.value),
    randomUuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
  };
}

const enrollment = {
  id: 'enrollment-1',
  policyVersion: '2026-07-14-v1',
};

const openDatabases: DatabaseSync[] = [];

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

function environment(db: DatabaseSync): Env {
  openDatabases.push(db);
  return {
    DB: sqliteD1(db),
    FAL_API_KEY: 'test-fal-key',
    IMAGE_GEN_PROVIDER: 'gpt-image-2',
    ENVIRONMENT: 'local-test',
  } as Env;
}

describe('record-only pilot media jobs', () => {
  it('uses the full fal model path for video status and result polling', () => {
    expect(buildPilotVideoQueueUrl('request/with spaces', 'status')).toBe(
      'https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video/requests/request%2Fwith%20spaces/status',
    );
    expect(buildPilotVideoQueueUrl('request-1', 'result')).toBe(
      'https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video/requests/request-1',
    );
    expect(() => buildPilotVideoQueueUrl('  ', 'status'))
      .toThrow('video_provider_request_id_invalid');
  });

  it('creates one immutable image Draft and returns it idempotently', async () => {
    const db = database();
    const env = environment(db);
    const nowRef = { value: new Date('2026-07-24T01:00:00.000Z') };
    const deps = dependencies(nowRef);

    const first = await startRecordOnlyPilotMediaJob(env, {
      identity,
      enrollment,
      context,
      adminId: 'admin-1',
      slot: 1,
      mediaKind: 'image',
    }, deps);
    const second = await startRecordOnlyPilotMediaJob(env, {
      identity,
      enrollment,
      context,
      adminId: 'admin-1',
      slot: 1,
      mediaKind: 'image',
    }, deps);

    expect(first).toMatchObject({
      state: 'ready',
      mediaKind: 'image',
      slot: 1,
      sourceStatus: 'Draft',
      scheduledFor: null,
      publishingAllowed: false,
    });
    expect(second).toEqual(first);
    expect(deps.generateDraft).toHaveBeenCalledOnce();
    expect(deps.generateImage).toHaveBeenCalledOnce();
    const post = db.prepare(
      'SELECT status,scheduled_for,image_url,post_type FROM posts WHERE id = ?',
    ).get(first.postId!) as Record<string, unknown>;
    expect(post).toMatchObject({
      status: 'Draft',
      scheduled_for: null,
      image_url: 'https://fal.example/pilot-image.webp',
      post_type: 'image',
    });
    expect(() => db.exec(
      `INSERT INTO publication_events (id,post_id) VALUES ('event-1','${first.postId}')`,
    )).toThrow(/cannot be published/);
  });

  it('keeps a video out of posts until the provider result is ready', async () => {
    const db = database();
    const env = environment(db);
    const nowRef = { value: new Date('2026-07-24T01:00:00.000Z') };
    const deps = dependencies(nowRef);
    (deps.pollVideo as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ state: 'pending' })
      .mockResolvedValueOnce({
        state: 'ready',
        videoUrl: 'https://fal.example/pilot-video.mp4',
      });

    const started = await startRecordOnlyPilotMediaJob(env, {
      identity,
      enrollment,
      context,
      adminId: 'admin-1',
      slot: 2,
      mediaKind: 'video',
    }, deps);
    expect(started).toMatchObject({
      state: 'generating',
      mediaKind: 'video',
      postId: null,
      publishingAllowed: false,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM posts').get()).toEqual({ count: 0 });

    const pending = await pollRecordOnlyPilotVideoJob(env, {
      identity,
      enrollment,
      slot: 2,
    }, deps);
    expect(pending.state).toBe('generating');
    expect(db.prepare(
      'SELECT archetype_slug FROM learning_pilot_media_jobs WHERE id = ?',
    ).get(started.id)).toEqual({ archetype_slug: 'tech-saas-agency' });

    const ready = await pollRecordOnlyPilotVideoJob(env, {
      identity,
      enrollment,
      slot: 2,
    }, deps);
    expect(ready).toMatchObject({
      state: 'ready',
      mediaKind: 'video',
      sourceStatus: 'Draft',
      mediaUrl: 'https://fal.example/pilot-video.mp4',
      publishingAllowed: false,
    });
    const post = db.prepare(
      'SELECT status,scheduled_for,post_type,video_status,video_url FROM posts WHERE id = ?',
    ).get(ready.postId!) as Record<string, unknown>;
    expect(post).toMatchObject({
      status: 'Draft',
      scheduled_for: null,
      post_type: 'video',
      video_status: 'ready',
      video_url: 'https://fal.example/pilot-video.mp4',
    });
    expect(db.prepare(
      'SELECT archetype_slug FROM learning_pilot_media_jobs WHERE id = ?',
    ).get(ready.id)).toEqual({ archetype_slug: 'tech-saas-agency' });
  });

  it('allows one lease-expired retry and never a third provider attempt', async () => {
    const db = database();
    const env = environment(db);
    const nowRef = { value: new Date('2026-07-24T01:00:00.000Z') };
    const deps = dependencies(nowRef);
    (deps.generateImage as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({
        imageUrl: 'https://fal.example/retry-image.webp',
        modelUsed: 'gpt-image-2-medium',
        archetypeSlug: 'tech-saas-agency',
      });

    const failed = await startRecordOnlyPilotMediaJob(env, {
      identity,
      enrollment,
      context,
      adminId: 'admin-1',
      slot: 3,
      mediaKind: 'image',
    }, deps);
    expect(failed).toMatchObject({ state: 'failed', attemptCount: 1 });

    nowRef.value = new Date('2026-07-24T01:06:00.000Z');
    const ready = await startRecordOnlyPilotMediaJob(env, {
      identity,
      enrollment,
      context,
      adminId: 'admin-1',
      slot: 3,
      mediaKind: 'image',
    }, deps);
    expect(ready).toMatchObject({ state: 'ready', attemptCount: 2 });

    const same = await startRecordOnlyPilotMediaJob(env, {
      identity,
      enrollment,
      context,
      adminId: 'admin-1',
      slot: 3,
      mediaKind: 'image',
    }, deps);
    expect(same).toEqual(ready);
    expect(deps.generateImage).toHaveBeenCalledTimes(2);
  });

  it('permits only one active media generation lease per workspace', async () => {
    const db = database();
    const env = environment(db);
    const nowRef = { value: new Date('2026-07-24T01:00:00.000Z') };
    const deps = dependencies(nowRef);

    const generating = await startRecordOnlyPilotMediaJob(env, {
      identity,
      enrollment,
      context,
      adminId: 'admin-1',
      slot: 1,
      mediaKind: 'video',
    }, deps);
    expect(generating.state).toBe('generating');

    await expect(startRecordOnlyPilotMediaJob(env, {
      identity,
      enrollment,
      context,
      adminId: 'admin-1',
      slot: 2,
      mediaKind: 'image',
    }, deps)).rejects.toThrow('pilot_media_generation_in_progress');

    expect(db.prepare(
      'SELECT COUNT(*) AS count FROM learning_pilot_media_jobs',
    ).get()).toEqual({ count: 1 });
    expect(deps.generateDraft).toHaveBeenCalledOnce();
    expect(deps.generateImage).toHaveBeenCalledOnce();
  });

  it('fails before reserving a slot when the staging Fal secret is absent', async () => {
    const db = database();
    const env = environment(db);
    delete env.FAL_API_KEY;
    const nowRef = { value: new Date('2026-07-24T01:00:00.000Z') };
    const deps = dependencies(nowRef);

    await expect(startRecordOnlyPilotMediaJob(env, {
      identity,
      enrollment,
      context,
      adminId: 'admin-1',
      slot: 1,
      mediaKind: 'image',
    }, deps)).rejects.toThrow('staging_fal_secret_missing');

    expect(db.prepare('SELECT COUNT(*) AS count FROM learning_pilot_media_jobs').get())
      .toEqual({ count: 0 });
    expect(deps.generateDraft).not.toHaveBeenCalled();
  });
});
