import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('learning pilot generated draft schema', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'schema_v48_learning_pilot_generated_drafts.sql'),
    'utf8',
  );

  it('keeps one immutable tenant-scoped provenance receipt per enrollment', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS learning_pilot_generated_drafts');
    expect(sql).toContain('enrollment_id TEXT NOT NULL UNIQUE');
    expect(sql).toContain('post_id TEXT NOT NULL UNIQUE');
    expect(sql).toContain("owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client'))");
    expect(sql).toContain('record_only INTEGER NOT NULL DEFAULT 1 CHECK (record_only = 1)');
    expect(sql).toContain(
      'REFERENCES learning_pilot_enrollments(id) ON DELETE CASCADE',
    );
    expect(sql).toContain('REFERENCES posts(id) ON DELETE CASCADE');
    expect(sql).toContain('prevent_learning_pilot_generated_draft_update');
  });

  it('blocks scheduling, publication events, and delivery at the database boundary', () => {
    expect(sql).toContain('prevent_learning_pilot_generated_draft_scheduling');
    expect(sql).toContain("LOWER(TRIM(COALESCE(NEW.status, ''))) <> 'draft'");
    expect(sql).toContain('prevent_learning_pilot_generated_publication_event');
    expect(sql).toContain('prevent_learning_pilot_generated_delivery');
    expect(sql).toContain('record-only pilot generated drafts cannot be published');
    expect(sql).toContain('record-only pilot generated drafts cannot enter delivery');
  });

  it('does not alter existing customer posts or production behavior', () => {
    expect(sql).not.toMatch(/ALTER TABLE posts/i);
    expect(sql).not.toMatch(/UPDATE posts/i);
    expect(sql).not.toMatch(/DELETE FROM posts/i);
    expect(sql).not.toMatch(/INSERT INTO posts/i);
  });

  it('executes against SQLite and enforces immutable record-only behavior', () => {
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
          reasoning TEXT,
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
        INSERT INTO posts (
          id,user_id,client_id,owner_kind,owner_id,content,platform,status,
          scheduled_for,hashtags,image_url,image_prompt,reasoning,post_type
        ) VALUES (
          'post-1','owner-1',NULL,'user','owner-1','Authentic draft content.',
          'facebook','Draft',NULL,'[]',NULL,'A relevant real-world photograph.',
          '{"recordOnly":true}','text'
        );
        INSERT INTO learning_pilot_generated_drafts (
          id,enrollment_id,post_id,user_id,workspace_key,client_id,
          owner_kind,owner_id,policy_version,content_hash,provider,model,
          attempt_count,generated_by,generated_at,record_only
        ) VALUES (
          'receipt-1','enrollment-1','post-1','owner-1','__owner__',NULL,
          'user','owner-1','2026-07-14-v1',
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'anthropic','claude-haiku-4-5',1,'admin-1',
          '2026-07-24T02:00:00.000Z',1
        );
      `);

      expect(() => db.exec(
        "UPDATE posts SET content = 'Changed content' WHERE id = 'post-1'",
      )).toThrow(/immutable and cannot be scheduled/);
      expect(() => db.exec(
        "UPDATE posts SET scheduled_for = '2026-07-25T02:00:00.000Z' WHERE id = 'post-1'",
      )).toThrow(/immutable and cannot be scheduled/);
      expect(() => db.exec(
        "INSERT INTO publication_events (id,post_id) VALUES ('event-1','post-1')",
      )).toThrow(/cannot be published/);
      expect(() => db.exec(
        "INSERT INTO publish_delivery_receipts (id,post_id) VALUES ('delivery-1','post-1')",
      )).toThrow(/cannot enter delivery/);
      expect(() => db.exec(
        "UPDATE learning_pilot_generated_drafts SET model = 'other' WHERE id = 'receipt-1'",
      )).toThrow(/receipts are immutable/);
    } finally {
      db.close();
    }
  });
});
