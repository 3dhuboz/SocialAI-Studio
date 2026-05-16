/**
 * Unit tests for workers/api/src/lib/web-fetch.ts — the campaign-research
 * URL fetcher with sanitisation + hard limits.
 *
 * Mocks global fetch. Locks the security + budget guarantees:
 *
 *   - URL validation: rejects invalid, non-http(s), private hosts
 *   - 1 MB response body cap (prevents isolate OOM from huge SPA bundles)
 *   - 30 KB returned text cap (caps token spend on the AI side)
 *   - content-type filter: rejects PDFs, images, audio; allows HTML/plain
 *   - HTML → text extraction: strips script/style/nav/footer, preserves
 *     paragraphs, unescapes entities
 *   - extractUrls: pulls http(s) URLs out of free-form user text, caps at
 *     `max`, strips trailing punctuation, prepends https:// to bare www.
 *
 * Mocking fetch is the only way to lock these without hammering the
 * network; the wrapper IS a fetch call wearing safety gear.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchUrlText, extractUrls } from '../lib/web-fetch';

let fetchMock: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  fetchMock = vi.fn();
  originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function htmlResponse(html: string, opts: Partial<{ status: number; contentType: string; finalUrl: string }> = {}): Response {
  const r = new Response(html, {
    status: opts.status ?? 200,
    headers: { 'content-type': opts.contentType ?? 'text/html; charset=utf-8' },
  });
  // Response.url is read-only — patch via Object.defineProperty when caller
  // wants to assert finalUrl propagation.
  if (opts.finalUrl) Object.defineProperty(r, 'url', { value: opts.finalUrl });
  return r;
}

// ── URL validation guards ─────────────────────────────────────────────

describe('fetchUrlText — pre-flight URL guard', () => {
  it('rejects invalid URL with error=invalid-url (no fetch attempted)', async () => {
    const r = await fetchUrlText('not a url');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid-url');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects ftp:// with error=unsupported-scheme', async () => {
    const r = await fetchUrlText('ftp://example.com/file');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('unsupported-scheme');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects file:// with error=unsupported-scheme', async () => {
    const r = await fetchUrlText('file:///etc/passwd');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('unsupported-scheme');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'http://localhost/admin',
    'http://127.0.0.1:8080/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/', // AWS IMDS
    'http://172.16.0.1/',
    'http://172.20.5.5/',
    'http://172.31.255.255/',
    'http://0.0.0.0/',
  ])('rejects private host %s with error=private-host', async (url) => {
    const r = await fetchUrlText(url);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('private-host');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ALLOWS 172.15.x and 172.32.x (boundary check — only 172.16-31 is private)', async () => {
    // Two separate Response objects — bodies can't be re-read once consumed.
    fetchMock.mockResolvedValueOnce(htmlResponse('<p>ok</p>'));
    fetchMock.mockResolvedValueOnce(htmlResponse('<p>ok</p>'));
    const r1 = await fetchUrlText('http://172.15.0.1/');
    const r2 = await fetchUrlText('http://172.32.0.1/');
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('allows normal public https URLs', async () => {
    fetchMock.mockResolvedValue(htmlResponse('<p>Hello</p>'));
    const r = await fetchUrlText('https://example.com/page');
    expect(r.ok).toBe(true);
  });
});

// ── Fetch error / status handling ────────────────────────────────────

describe('fetchUrlText — network + HTTP error paths', () => {
  it('returns error=fetch-error when fetch throws (DNS, connection refused, abort)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const r = await fetchUrlText('https://example.com/');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('fetch-error');
  });

  it('returns error=fetch-error when fetch is aborted (timeout)', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abortError);
    const r = await fetchUrlText('https://example.com/');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('fetch-error');
  });

  it('returns error=http-error with status preserved on 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }));
    const r = await fetchUrlText('https://example.com/missing');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('http-error');
    expect(r.status).toBe(404);
  });

  it('returns error=http-error on 5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 503 }));
    const r = await fetchUrlText('https://example.com/');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('http-error');
    expect(r.status).toBe(503);
  });

  it('passes redirect=follow so res.url reflects the final URL after redirects', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('<p>after-redirect</p>', { finalUrl: 'https://final.example.com/' }));
    const r = await fetchUrlText('https://start.example.com/');
    const initArg = fetchMock.mock.calls[0][1];
    expect(initArg.redirect).toBe('follow');
    expect(r.finalUrl).toBe('https://final.example.com/');
  });
});

// ── Content-type filter ──────────────────────────────────────────────

describe('fetchUrlText — content-type filter', () => {
  it('accepts text/html', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('<p>html</p>'));
    const r = await fetchUrlText('https://example.com/');
    expect(r.ok).toBe(true);
  });

  it('accepts text/html; charset=utf-8', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('<p>html</p>', { contentType: 'text/html; charset=utf-8' }));
    const r = await fetchUrlText('https://example.com/');
    expect(r.ok).toBe(true);
  });

  it('accepts application/xhtml+xml', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('<p>xhtml</p>', { contentType: 'application/xhtml+xml' }));
    const r = await fetchUrlText('https://example.com/');
    expect(r.ok).toBe(true);
  });

  it('accepts text/plain', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('hello world', { contentType: 'text/plain' }));
    const r = await fetchUrlText('https://example.com/');
    expect(r.ok).toBe(true);
  });

  it('accepts empty content-type (some sites omit it)', async () => {
    const res = new Response('<p>x</p>', { status: 200 });
    res.headers.delete('content-type');
    fetchMock.mockResolvedValueOnce(res);
    const r = await fetchUrlText('https://example.com/');
    expect(r.ok).toBe(true);
  });

  it('rejects application/pdf with error=not-html', async () => {
    fetchMock.mockResolvedValueOnce(new Response('%PDF…', { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const r = await fetchUrlText('https://example.com/report.pdf');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not-html');
    expect(r.contentType).toBe('application/pdf');
  });

  it('rejects image/* with error=not-html', async () => {
    fetchMock.mockResolvedValueOnce(new Response('PNG…', { status: 200, headers: { 'content-type': 'image/png' } }));
    const r = await fetchUrlText('https://example.com/logo.png');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not-html');
  });

  it('rejects application/json with error=not-html', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const r = await fetchUrlText('https://api.example.com/data');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not-html');
  });
});

// ── Size cap ─────────────────────────────────────────────────────────

describe('fetchUrlText — 1 MB response body cap', () => {
  it('rejects responses larger than 1 MB with error=too-large', async () => {
    const big = new Uint8Array(1_000_001); // 1 byte over the cap
    big.fill('a'.charCodeAt(0));
    fetchMock.mockResolvedValueOnce(
      new Response(big.buffer, { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const r = await fetchUrlText('https://example.com/big');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('too-large');
  });

  it('accepts responses up to exactly 1 MB', async () => {
    // 1_000_000 bytes of a valid HTML body — the extractor will produce a
    // bunch of "a a a" text but ok=true.
    const ok = new Uint8Array(1_000_000);
    ok.fill('a'.charCodeAt(0));
    fetchMock.mockResolvedValueOnce(
      new Response(ok.buffer, { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const r = await fetchUrlText('https://example.com/');
    // Either ok=true with extracted text, or ok=false with error=empty
    // (extractor depends on tags). Both prove we didn't reject for size.
    expect(r.error).not.toBe('too-large');
  });
});

// ── HTML extraction ─────────────────────────────────────────────────

describe('fetchUrlText — HTML to text extraction', () => {
  it('extracts the <title> separately', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('<html><head><title>My Page</title></head><body><p>hi</p></body></html>'));
    const r = await fetchUrlText('https://example.com/');
    expect(r.title).toBe('My Page');
  });

  it('strips <script> contents entirely', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(
      '<html><body><p>visible</p><script>document.cookie="x";var leakedSecret="dontShow";</script></body></html>',
    ));
    const r = await fetchUrlText('https://example.com/');
    expect(r.ok).toBe(true);
    expect(r.text).not.toContain('document.cookie');
    expect(r.text).not.toContain('leakedSecret');
    expect(r.text).toContain('visible');
  });

  it('strips <style> contents', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(
      '<html><body><style>.hidden { color: red; font-family: Arial; }</style><p>content</p></body></html>',
    ));
    const r = await fetchUrlText('https://example.com/');
    expect(r.text).not.toContain('color: red');
    expect(r.text).toContain('content');
  });

  it('strips <nav> and <footer> (boilerplate)', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(
      '<body><nav>Home About Contact</nav><main><p>real content</p></main><footer>© 2026 Big Co</footer></body>',
    ));
    const r = await fetchUrlText('https://example.com/');
    expect(r.text).toContain('real content');
    expect(r.text).not.toContain('Home About Contact');
    expect(r.text).not.toContain('© 2026 Big Co');
  });

  it('strips HTML comments', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('<body><p>shown</p><!-- secret note --></body>'));
    const r = await fetchUrlText('https://example.com/');
    expect(r.text).toContain('shown');
    expect(r.text).not.toContain('secret note');
  });

  it('unescapes common HTML entities', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(
      '<p>Tom &amp; Jerry &lt;3 &nbsp;&quot;hi&quot; &#39;there&apos;</p>',
    ));
    const r = await fetchUrlText('https://example.com/');
    expect(r.text).toContain('Tom & Jerry');
    expect(r.text).toContain('<3');
    expect(r.text).toContain('"hi"');
    expect(r.text).toContain("'there'");
  });

  it('preserves paragraph breaks from block-level tags', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(
      '<body><p>line 1</p><p>line 2</p><h1>heading</h1><div>line 3</div></body>',
    ));
    const r = await fetchUrlText('https://example.com/');
    // Paragraph breaks come through as newlines.
    const lines = r.text!.split('\n');
    expect(lines).toContain('line 1');
    expect(lines).toContain('line 2');
    expect(lines).toContain('line 3');
    expect(lines).toContain('heading');
  });

  it('collapses runs of whitespace within a line', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('<p>one    two\t\tthree    four</p>'));
    const r = await fetchUrlText('https://example.com/');
    expect(r.text).toContain('one two three four');
  });

  it('returns error=empty when there is no extractable text', async () => {
    // The htmlToText extractor strips <script>, <style>, <nav>, <footer>,
    // <noscript>, <svg> blocks but NOT <head>/<title>. The title's TEXT
    // would land in `text` if a <title> were present — so to test the
    // empty path properly, send a body that's literally just whitespace +
    // script content.
    fetchMock.mockResolvedValueOnce(htmlResponse('<html><body><script>x()</script></body></html>'));
    const r = await fetchUrlText('https://example.com/');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('empty');
  });
});

// ── Returned text cap ───────────────────────────────────────────────

describe('fetchUrlText — 30 KB returned text cap', () => {
  it('truncates extracted text to 30,000 chars', async () => {
    // Build a large body of paragraphs so the extractor produces >30k of text.
    const bigP = '<p>' + 'a'.repeat(50_000) + '</p>';
    fetchMock.mockResolvedValueOnce(htmlResponse('<body>' + bigP + '</body>'));
    const r = await fetchUrlText('https://example.com/long');
    expect(r.ok).toBe(true);
    expect(r.text!.length).toBe(30_000);
    expect(r.chars).toBe(30_000);
  });

  it('does NOT truncate when text is well under 30 KB', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('<p>short content</p>'));
    const r = await fetchUrlText('https://example.com/');
    expect(r.ok).toBe(true);
    expect(r.text!.length).toBeLessThan(100);
  });
});

// ── User-Agent + headers ────────────────────────────────────────────

describe('fetchUrlText — request headers', () => {
  it('sets a polite custom UA + Accept + Accept-Language', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('<p>x</p>'));
    await fetchUrlText('https://example.com/');
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers['User-Agent']).toContain('SocialAIStudioBot');
    expect(init.headers['Accept']).toContain('text/html');
    expect(init.headers['Accept-Language']).toBe('en-AU,en;q=0.9');
  });
});

// ── extractUrls ─────────────────────────────────────────────────────

describe('extractUrls — pull URLs out of free-form text', () => {
  it('returns [] for empty / missing input', () => {
    expect(extractUrls('')).toEqual([]);
    expect(extractUrls(undefined as any)).toEqual([]);
  });

  it('extracts a single https URL', () => {
    expect(extractUrls('check out https://example.com/page for more')).toEqual(['https://example.com/page']);
  });

  it('extracts http and https URLs', () => {
    expect(extractUrls('try http://a.com or https://b.com')).toEqual(['http://a.com', 'https://b.com']);
  });

  it('prepends https:// to bare www. matches', () => {
    expect(extractUrls('visit www.example.com today')).toEqual(['https://www.example.com']);
  });

  it('strips trailing punctuation (.,;:!?]) ', () => {
    expect(extractUrls('see https://x.com, then https://y.com.')).toEqual(['https://x.com', 'https://y.com']);
    expect(extractUrls('go to https://x.com!')).toEqual(['https://x.com']);
    expect(extractUrls('(https://x.com)')).toEqual(['https://x.com']);
  });

  it('deduplicates repeat URLs', () => {
    expect(extractUrls('https://x.com and again https://x.com and https://x.com')).toEqual(['https://x.com']);
  });

  it('caps at `max` URLs (default 3)', () => {
    const text = 'a https://1.com b https://2.com c https://3.com d https://4.com e https://5.com';
    expect(extractUrls(text)).toHaveLength(3);
    expect(extractUrls(text, 5)).toHaveLength(5);
    expect(extractUrls(text, 1)).toEqual(['https://1.com']);
  });

  it('does not include URLs after the cap (preserves order)', () => {
    const text = 'a https://1.com b https://2.com c https://3.com d https://4.com';
    expect(extractUrls(text, 2)).toEqual(['https://1.com', 'https://2.com']);
  });

  it('ignores embedded URLs without an http(s) or www prefix', () => {
    expect(extractUrls('the domain example.com is great')).toEqual([]);
  });
});
