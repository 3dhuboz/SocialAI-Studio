import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('learning pilot media job schema', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'schema_v49_learning_pilot_media_jobs.sql'),
    'utf8',
  );

  it('caps immutable tenant-scoped media slots without altering v48 receipts', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS learning_pilot_media_jobs');
    expect(sql).toContain('slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 6)');
    expect(sql).toContain('UNIQUE(enrollment_id, slot)');
    expect(sql).toContain("media_kind TEXT NOT NULL CHECK (media_kind IN ('image','video'))");
    expect(sql).toContain('record_only INTEGER NOT NULL DEFAULT 1 CHECK (record_only = 1)');
    expect(sql).not.toContain('ALTER TABLE learning_pilot_generated_drafts');
    expect(sql).not.toContain('DROP TABLE learning_pilot_generated_drafts');
  });

  it('enforces bounded leases, immutable ready media, and every DB egress block', () => {
    expect(sql).toContain('attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 1 AND 2)');
    expect(sql).toContain('validate_learning_pilot_media_job_transition');
    expect(sql).toContain('validate_learning_pilot_media_job_ready');
    expect(sql).toContain('prevent_learning_pilot_media_job_ready_update');
    expect(sql).toContain('prevent_learning_pilot_media_job_ready_delete');
    expect(sql).toContain('prevent_learning_pilot_media_enrollment_delete');
    expect(sql).toContain('prevent_learning_pilot_media_post_update');
    expect(sql).toContain('prevent_learning_pilot_media_publication_event');
    expect(sql).toContain('prevent_learning_pilot_media_delivery');
  });

  it('executes in SQLite and blocks a ready image candidate from every mutation path', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
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
          post_type TEXT,
          video_url TEXT,
          video_status TEXT,
          video_script TEXT,
          video_shots TEXT
        );
        CREATE TABLE learning_pilot_enrollments (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          workspace_key TEXT NOT NULL,
          client_id TEXT,
          owner_kind TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          policy_version TEXT NOT NULL,
          consent_confirmed_at TEXT,
          record_only INTEGER NOT NULL
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
      db.exec(sql);
      db.exec(`
        INSERT INTO learning_pilot_enrollments (
          id,user_id,workspace_key,client_id,owner_kind,owner_id,
          policy_version,consent_confirmed_at,record_only
        ) VALUES (
          'enrollment-1','owner-1','__owner__',NULL,'user','owner-1',
          '2026-07-14-v1','2026-07-24T01:00:00.000Z',1
        );
        INSERT INTO learning_pilot_media_jobs (
          id,enrollment_id,slot,user_id,workspace_key,client_id,owner_kind,
          owner_id,policy_version,media_kind,state,attempt_count,claim_token_hash,
          lease_expires_at,generated_by,claimed_at,updated_at,record_only
        ) VALUES (
          'job-1','enrollment-1',1,'owner-1','__owner__',NULL,'user',
          'owner-1','2026-07-14-v1','image','claimed',1,
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '2026-07-24T02:10:00.000Z','admin-1',
          '2026-07-24T02:00:00.000Z','2026-07-24T02:00:00.000Z',1
        );
        INSERT INTO posts (
          id,user_id,client_id,owner_kind,owner_id,content,platform,status,
          scheduled_for,hashtags,image_url,image_prompt,post_type
        ) VALUES (
          'post-1','owner-1',NULL,'user','owner-1','Authentic image draft.',
          'facebook','Draft',NULL,'["#Local"]','https://cdn.example/image.webp',
          'Bright realistic local business scene with the caption subject.',
          'image'
        );
        UPDATE learning_pilot_media_jobs SET
          state = 'ready',
          post_id = 'post-1',
          content = 'Authentic image draft.',
          hashtags = '["#Local"]',
          image_prompt = 'Bright realistic local business scene with the caption subject.',
          thumbnail_url = 'https://cdn.example/image.webp',
          media_url = 'https://cdn.example/image.webp',
          content_hash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          caption_provider = 'anthropic',
          caption_model = 'claude-haiku-4-5',
          caption_attempt_count = 1,
          media_provider = 'fal',
          media_model = 'gpt-image-2-medium',
          completed_at = '2026-07-24T02:05:00.000Z',
          updated_at = '2026-07-24T02:05:00.000Z'
        WHERE id = 'job-1';
      `);

      expect(() => db.exec(
        "UPDATE posts SET status = 'Scheduled' WHERE id = 'post-1'",
      )).toThrow(/media posts are immutable/);
      expect(() => db.exec(
        "UPDATE learning_pilot_media_jobs SET media_model = 'other' WHERE id = 'job-1'",
      )).toThrow(/media jobs are immutable/);
      expect(() => db.exec(
        "DELETE FROM learning_pilot_media_jobs WHERE id = 'job-1'",
      )).toThrow(/post-first deletion/);
      expect(() => db.exec(
        "DELETE FROM learning_pilot_enrollments WHERE id = 'enrollment-1'",
      )).toThrow(/scoped withdrawal/);
      expect(() => db.exec(
        "INSERT INTO publication_events (id,post_id) VALUES ('event-1','post-1')",
      )).toThrow(/cannot be published/);
      expect(() => db.exec(
        "INSERT INTO publish_delivery_receipts (id,post_id) VALUES ('delivery-1','post-1')",
      )).toThrow(/cannot enter delivery/);
      db.exec("DELETE FROM posts WHERE id = 'post-1'");
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM learning_pilot_media_jobs WHERE id = 'job-1'",
      ).get()).toEqual({ count: 0 });
      db.exec("DELETE FROM learning_pilot_enrollments WHERE id = 'enrollment-1'");
    } finally {
      db.close();
    }
  });

  it('rejects a seventh slot and an unsafe claim transition', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE posts (id TEXT PRIMARY KEY);
        CREATE TABLE learning_pilot_enrollments (
          id TEXT PRIMARY KEY,user_id TEXT,workspace_key TEXT,client_id TEXT,
          owner_kind TEXT,owner_id TEXT,policy_version TEXT,
          consent_confirmed_at TEXT,record_only INTEGER
        );
        CREATE TABLE publication_events (id TEXT PRIMARY KEY,post_id TEXT);
        CREATE TABLE publish_delivery_receipts (id TEXT PRIMARY KEY,post_id TEXT);
      `);
      db.exec(sql);
      db.exec(`
        INSERT INTO learning_pilot_enrollments VALUES (
          'enrollment-1','owner-1','__owner__',NULL,'user','owner-1',
          '2026-07-14-v1','2026-07-24T01:00:00.000Z',1
        );
      `);
      const insert = (slot: number) => db.exec(`
        INSERT INTO learning_pilot_media_jobs (
          id,enrollment_id,slot,user_id,workspace_key,client_id,owner_kind,
          owner_id,policy_version,media_kind,state,attempt_count,claim_token_hash,
          lease_expires_at,generated_by,claimed_at,updated_at,record_only
        ) VALUES (
          'job-${slot}','enrollment-1',${slot},'owner-1','__owner__',NULL,'user',
          'owner-1','2026-07-14-v1','image','claimed',1,
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '2026-07-24T02:10:00.000Z','admin-1',
          '2026-07-24T02:00:00.000Z','2026-07-24T02:00:00.000Z',1
        );
      `);

      expect(() => insert(7)).toThrow();
      insert(1);
      expect(() => db.exec(
        "UPDATE learning_pilot_media_jobs SET state = 'ready' WHERE id = 'job-1'",
      )).toThrow();
    } finally {
      db.close();
    }
  });
});
