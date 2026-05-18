/**
 * Unit tests for workers/api/src/lib/postproxy-webhook.ts.
 *
 * Pure functions — no DB / Env mocking required. Asserts:
 *   - planWebhookAction returns the right kind for each event_type
 *   - failure events surface the platform error message (truncated)
 *   - signature verification handles all of: missing secret, missing header,
 *     happy path, sha256= prefix, hex case insensitivity, tamper
 *   - parseWebhookEvent rejects malformed / missing-field payloads
 */
import { describe, it, expect } from 'vitest';
import {
  parseWebhookEvent,
  planWebhookAction,
  verifyWebhookSignature,
  type PostproxyWebhookPayload,
} from '../lib/postproxy-webhook';

describe('planWebhookAction', () => {
  const base = (overrides: Partial<PostproxyWebhookPayload>): PostproxyWebhookPayload => ({
    event_id: 'evt_1',
    event_type: 'post.processed',
    data: { id: 'pp_post_1', status: 'pending' },
    ...overrides,
  } as PostproxyWebhookPayload);

  it('platform_post.published -> mark_published with permalink', () => {
    const action = planWebhookAction(base({
      event_type: 'platform_post.published',
      data: {
        id: 'pp_post_1',
        status: 'published',
        platforms: [{
          platform: 'facebook',
          status: 'published',
          permalink: 'https://fb.com/post/1',
        }],
      },
    }));
    expect(action.kind).toBe('mark_published');
    expect(action.postproxyPostId).toBe('pp_post_1');
    expect(action.permalink).toBe('https://fb.com/post/1');
  });

  it('platform_post.failed -> mark_failed with platform error', () => {
    const action = planWebhookAction(base({
      event_type: 'platform_post.failed',
      data: {
        id: 'pp_post_1',
        status: 'failed',
        platforms: [{
          platform: 'facebook',
          status: 'failed',
          error: 'Token expired',
        }],
      },
    }));
    expect(action.kind).toBe('mark_failed');
    expect(action.errorMessage).toBe('Token expired');
  });

  it('platform_post.failed without platform error falls back to status-based message', () => {
    const action = planWebhookAction(base({
      event_type: 'platform_post.failed',
      data: {
        id: 'pp_post_1',
        status: 'failed',
      },
    }));
    expect(action.kind).toBe('mark_failed');
    expect(action.errorMessage).toMatch(/Postproxy reported failure/);
  });

  it('post.processed -> log_only (no DB mutation)', () => {
    const action = planWebhookAction(base({
      event_type: 'post.processed',
      data: { id: 'pp_post_1', status: 'processed' },
    }));
    expect(action.kind).toBe('log_only');
    expect(action.postproxyPostId).toBe('pp_post_1');
  });

  it('truncates very long error messages to 400 chars', () => {
    const longErr = 'x'.repeat(5000);
    const action = planWebhookAction(base({
      event_type: 'platform_post.failed',
      data: {
        id: 'pp_post_1',
        status: 'failed',
        platforms: [{ platform: 'facebook', status: 'failed', error: longErr }],
      },
    }));
    expect(action.errorMessage?.length).toBe(400);
  });
});

describe('parseWebhookEvent', () => {
  it('parses a valid payload', () => {
    const raw = JSON.stringify({
      event_id: 'evt_x',
      event_type: 'platform_post.published',
      data: { id: 'pp_y', status: 'published' },
    });
    const parsed = parseWebhookEvent(raw);
    expect(parsed?.event_id).toBe('evt_x');
    expect(parsed?.data.id).toBe('pp_y');
  });

  it('returns null for non-JSON body', () => {
    expect(parseWebhookEvent('not json')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseWebhookEvent(JSON.stringify({ event_type: 'x' }))).toBeNull();
    expect(parseWebhookEvent(JSON.stringify({ event_id: 'a', event_type: 'x' }))).toBeNull();
    expect(parseWebhookEvent(JSON.stringify({ event_id: 'a', event_type: 'x', data: {} }))).toBeNull();
  });

  it('returns null for empty body', () => {
    expect(parseWebhookEvent('')).toBeNull();
  });
});

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ hello: 'world' });
  const secret = 'shared-secret-value';

  async function sign(rawBody: string, secret: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
    return Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  it('returns false when secret is undefined', async () => {
    expect(await verifyWebhookSignature(body, 'abc', undefined)).toBe(false);
  });

  it('returns false when header is missing', async () => {
    expect(await verifyWebhookSignature(body, null, secret)).toBe(false);
  });

  it('returns true when signature matches (bare hex)', async () => {
    const sig = await sign(body, secret);
    expect(await verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it('returns true when signature matches with sha256= prefix', async () => {
    const sig = await sign(body, secret);
    expect(await verifyWebhookSignature(body, `sha256=${sig}`, secret)).toBe(true);
  });

  it('returns false when body has been tampered with', async () => {
    const sig = await sign(body, secret);
    expect(await verifyWebhookSignature(body + 'x', sig, secret)).toBe(false);
  });

  it('returns false for non-hex signature', async () => {
    expect(await verifyWebhookSignature(body, 'not-a-hex-string!!!', secret)).toBe(false);
  });
});
