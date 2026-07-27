export class RequestTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    const duration = timeoutMs >= 1000
      ? `${Math.ceil(timeoutMs / 1000)} seconds`
      : `${timeoutMs}ms`;
    super(`${label} timed out after ${duration}.`);
    this.name = 'RequestTimeoutError';
  }
}

async function fetchParsedWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  label: string,
  parse: (response: Response) => Promise<T>,
): Promise<{ response: Response; data: T }> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Request timeout must be a positive number.');
  }

  const controller = new AbortController();
  let timedOut = false;
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const data = await parse(response);
    return { response, data };
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError(label, timeoutMs);
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

export async function fetchJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<{ response: Response; data: T }> {
  return fetchParsedWithTimeout(input, init, timeoutMs, label, async (response) => {
    try {
      return await response.json() as T;
    } catch {
      throw new Error(`${label} returned an invalid response (${response.status}).`);
    }
  });
}

export async function fetchBlobWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<{ response: Response; data: Blob }> {
  return fetchParsedWithTimeout(input, init, timeoutMs, label, (response) => response.blob());
}
