/**
 * Unit tests for workers/api/src/lib/email.ts — the Resend sendEmail wrapper.
 *
 * The source file is intentionally tiny (no template rendering, no HTML
 * builder — callers pass pre-built HTML). This suite covers the four
 * behaviours that downstream code relies on:
 *
 *   1. silent no-op when RESEND_API_KEY is unset (preview / local dev)
 *   2. POST to the correct Resend endpoint with Bearer auth
 *   3. from-address matches our verified sender domain
 *   4. all caller-supplied HTML is passed through VERBATIM (so the caller
 *      controls escaping — sendResendEmail is NOT a template renderer)
 *   5. Resend outage is caught + logged, never throws
 *
 * Mocking fetch globally — the wrapper IS a fetch call, so testing it
 * against a real `fetch` would mean every test hits the network. This
 * way we lock the request shape AND the catch-and-log behaviour.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendResendEmail } from '../lib/email';

let fetchMock: ReturnType<typeof vi.fn>;
let consoleErrSpy: ReturnType<typeof vi.spyOn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  fetchMock = vi.fn();
  originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as any;
  consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  consoleErrSpy.mockRestore();
});

function makeEnv(opts: Partial<{ RESEND_API_KEY: string }> = {}): any {
  return { ...opts } as any;
}

describe('sendResendEmail — silent no-op when key missing', () => {
  it('does NOTHING when RESEND_API_KEY is undefined', async () => {
    await sendResendEmail(makeEnv(), { to: 'a@b.com', subject: 's', html: '<p>x</p>' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when RESEND_API_KEY is empty string', async () => {
    await sendResendEmail(makeEnv({ RESEND_API_KEY: '' }), {
      to: 'a@b.com', subject: 's', html: '<p>x</p>',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws on missing key (publish path must keep flowing on preview deploys)', async () => {
    await expect(
      sendResendEmail(makeEnv(), { to: 'a@b.com', subject: 's', html: '<p>x</p>' })
    ).resolves.toBeUndefined();
  });
});

describe('sendResendEmail — happy path', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'msg-123' }), { status: 200 }));
  });

  it('POSTs to https://api.resend.com/emails', async () => {
    await sendResendEmail(
      makeEnv({ RESEND_API_KEY: 'rs-test' }),
      { to: 'user@example.com', subject: 'Welcome', html: '<p>Hello!</p>' },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
  });

  it('uses Bearer auth with the supplied key', async () => {
    await sendResendEmail(
      makeEnv({ RESEND_API_KEY: 'rs-secret-xyz' }),
      { to: 'a@b.com', subject: 's', html: 'x' },
    );
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer rs-secret-xyz');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends from the verified Social AI Studio domain (locked)', async () => {
    await sendResendEmail(
      makeEnv({ RESEND_API_KEY: 'k' }),
      { to: 'a@b.com', subject: 's', html: '<p>x</p>' },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe('Social AI Studio <noreply@socialaistudio.au>');
  });

  it('passes through to/subject/html VERBATIM', async () => {
    const html = '<h1>Welcome</h1><p>Click <a href="https://x">here</a>.</p>';
    await sendResendEmail(
      makeEnv({ RESEND_API_KEY: 'k' }),
      { to: 'user@example.com', subject: 'Welcome!', html },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toBe('user@example.com');
    expect(body.subject).toBe('Welcome!');
    expect(body.html).toBe(html);
  });

  it('does NOT escape HTML — callers are responsible for sanitising user-supplied content', async () => {
    // sendResendEmail is a thin transport. If a caller's template inlines
    // user content unsafely, that's a caller bug — this wrapper does not
    // (and should not) silently re-encode. Locking that contract here.
    const html = '<script>alert(1)</script>';
    await sendResendEmail(
      makeEnv({ RESEND_API_KEY: 'k' }),
      { to: 'a@b.com', subject: 's', html },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).toBe('<script>alert(1)</script>');
  });

  it('handles unusual but valid characters in subject + html', async () => {
    const subject = 'New post: G\'day 🎉 — let\'s go';
    const html = '<p>Hello "Steve" &amp; co.</p>';
    await sendResendEmail(
      makeEnv({ RESEND_API_KEY: 'k' }),
      { to: 'a@b.com', subject, html },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toBe(subject);
    expect(body.html).toBe(html);
  });
});

describe('sendResendEmail — never throws', () => {
  it('swallows network errors (fetch rejection) and logs via console.error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      sendResendEmail(
        makeEnv({ RESEND_API_KEY: 'k' }),
        { to: 'a@b.com', subject: 's', html: 'x' },
      )
    ).resolves.toBeUndefined();
    expect(consoleErrSpy).toHaveBeenCalled();
    // First arg should be the error label so log scrapers can pick it out.
    expect(consoleErrSpy.mock.calls[0][0]).toMatch(/Resend send error/);
  });

  it('swallows synchronous throws inside fetch (defensive)', async () => {
    fetchMock.mockImplementation(() => {
      throw new Error('bad URL');
    });
    await expect(
      sendResendEmail(
        makeEnv({ RESEND_API_KEY: 'k' }),
        { to: 'a@b.com', subject: 's', html: 'x' },
      )
    ).resolves.toBeUndefined();
    expect(consoleErrSpy).toHaveBeenCalled();
  });

  it('does NOT throw on non-Error rejection (string, undefined)', async () => {
    fetchMock.mockRejectedValue('string error');
    await expect(
      sendResendEmail(
        makeEnv({ RESEND_API_KEY: 'k' }),
        { to: 'a@b.com', subject: 's', html: 'x' },
      )
    ).resolves.toBeUndefined();
  });
});
