// Web-fetch helper — fetches a URL and extracts the readable text so the
// campaign-research agent has real product data to work with rather than
// re-parroting whatever the user typed.
//
// Why this lives in the worker (not the frontend):
//   - CORS — most marketing sites don't set Access-Control-Allow-Origin,
//     so a browser fetch would be blocked.
//   - User-Agent control — we want to identify ourselves cleanly so site
//     owners can spot us in their logs (and we can be polite, see CRAWLER_UA).
//   - Output sanitisation — strips scripts/styles/nav so the AI doesn't
//     waste tokens on cookie banners and footer boilerplate.
//
// Hard limits (defence against being weaponised as a generic web-proxy):
//   - 5s per fetch (Cloudflare worker subrequest budget)
//   - 1 MB max response body (drops gigantic SPA bundles)
//   - 30 KB max returned text (caps token spend on the AI side)
//   - http(s) only — no file://, no internal IP shenanigans

const FETCH_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_RETURNED_CHARS = 30_000;
const CRAWLER_UA =
  'Mozilla/5.0 (compatible; SocialAIStudioBot/1.0; +https://socialaistudio.au/bot)';

export interface WebFetchResult {
  ok: boolean;
  url: string;
  finalUrl?: string;
  status?: number;
  contentType?: string;
  title?: string;
  text?: string;
  /** chars in `text` after extraction (post-trim, post-truncate) */
  chars?: number;
  /** Why ok=false. Stable strings the UI can branch on:
   *  'invalid-url' | 'unsupported-scheme' | 'private-host' | 'fetch-error' |
   *  'http-error' | 'too-large' | 'not-html' | 'empty' */
  error?: string;
}

/** Surface-level URL guard. Catches obvious garbage + private hosts before fetch. */
function looksFetchable(raw: string): { url: URL; reason?: undefined } | { url?: undefined; reason: string } {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { reason: 'invalid-url' }; }
  if (!/^https?:$/.test(parsed.protocol)) return { reason: 'unsupported-scheme' };
  // Block obvious private IPs + localhost. CF Workers can't reach RFC1918
  // anyway in most cases, but make refusal explicit so we're not relying on
  // network-layer behaviour. NOT exhaustive (no IPv6 here) — intentionally
  // light because the worker can't actually route to most of these.
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return { reason: 'private-host' };
  }
  return { url: parsed };
}

/** Strip <script>/<style>/<nav>/<footer> blocks + tags + collapse whitespace. */
function htmlToText(html: string): { title: string | undefined; text: string } {
  // Title — quick regex grab before we strip everything.
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : undefined;

  let s = html;

  // Drop noise blocks first (everything between opening + closing tag).
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // Block-level tags → newlines so paragraphs survive the collapse below.
  s = s.replace(/<\/(?:p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n');

  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, ' ');

  // HTML entity unescape (most common — full table is overkill).
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  // Collapse runs of whitespace within each line, keep paragraph breaks.
  s = s
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return { title, text: s };
}

/** Public: fetch a URL, return cleaned text + metadata, never throw. */
export async function fetchUrlText(rawUrl: string): Promise<WebFetchResult> {
  const guard = looksFetchable(rawUrl);
  if ('reason' in guard) return { ok: false, url: rawUrl, error: guard.reason };
  const url = guard.url;

  // Manual timeout via AbortController — Cloudflare Workers don't honour the
  // fetch() AbortSignal.timeout() static method as cleanly across the runtime.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': CRAWLER_UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
    });
  } catch (e: any) {
    clearTimeout(timer);
    return { ok: false, url: rawUrl, error: 'fetch-error' };
  }
  clearTimeout(timer);

  if (!res.ok) {
    return { ok: false, url: rawUrl, finalUrl: res.url, status: res.status, error: 'http-error' };
  }

  const contentType = res.headers.get('content-type') || '';
  const isHtmlish =
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml') ||
    contentType.includes('text/plain') ||
    contentType === ''; // some sites serve HTML without a content-type header
  if (!isHtmlish) {
    return { ok: false, url: rawUrl, finalUrl: res.url, status: res.status, contentType, error: 'not-html' };
  }

  // Read the body up to the cap. Reading res.text() unbounded would let a
  // huge SPA bundle blow our isolate memory + waste tokens.
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_RESPONSE_BYTES) {
    return { ok: false, url: rawUrl, finalUrl: res.url, status: res.status, error: 'too-large' };
  }
  // CF Workers' TextDecoder requires both fatal + ignoreBOM in its constructor
  // options type; both default to false at runtime if you pass an empty object.
  const html = new TextDecoder('utf-8').decode(buf);
  const { title, text } = htmlToText(html);

  if (!text) {
    return { ok: false, url: rawUrl, finalUrl: res.url, status: res.status, title, error: 'empty' };
  }

  const truncated = text.length > MAX_RETURNED_CHARS ? text.slice(0, MAX_RETURNED_CHARS) : text;

  return {
    ok: true,
    url: rawUrl,
    finalUrl: res.url,
    status: res.status,
    contentType,
    title,
    text: truncated,
    chars: truncated.length,
  };
}

/** URL extraction — pull http(s) URLs out of free-form user text. Bare www.
 *  matches get https:// prepended so they're fetchable. Caps at `max` URLs
 *  so a paragraph full of links doesn't fan out the research call. */
export function extractUrls(input: string, max = 3): string[] {
  if (!input) return [];
  const matches = input.match(/(?:https?:\/\/|www\.)[^\s,)>"']+/gi) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?)\]]+$/g, ''); // strip trailing punctuation
    const normalised = cleaned.startsWith('www.') ? `https://${cleaned}` : cleaned;
    if (!seen.has(normalised)) {
      seen.add(normalised);
      out.push(normalised);
      if (out.length >= max) break;
    }
  }
  return out;
}
