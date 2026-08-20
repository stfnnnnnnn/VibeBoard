import { getAccessToken, type CanvasConnectionRow } from './credentials';
import { CanvasAuthError, CanvasApiError } from './errors';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/** A single Canvas call must not be able to stall a whole sync run indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

async function requestWithRetry(url: string, token: string, attempt = 1): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // A timeout-triggered abort (TimeoutError) and a network-level failure (DNS, reset,
    // connection refused) are both transient — same retry budget as a 5xx.
    if (attempt >= 3) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CanvasApiError(`Canvas request failed after ${attempt} attempts (${message})`, 0);
    }
    await sleep(2 ** attempt * 500); // 1s, 2s, 4s
    return requestWithRetry(url, token, attempt + 1);
  }

  if (res.status === 401) throw new CanvasAuthError();

  if (res.status === 429 || res.status === 403 || res.status >= 500) {
    if (attempt >= 3) {
      throw new CanvasApiError(`Canvas request failed after ${attempt} attempts (status ${res.status})`, res.status);
    }
    await sleep(2 ** attempt * 500); // 1s, 2s, 4s
    return requestWithRetry(url, token, attempt + 1);
  }

  if (!res.ok) throw new CanvasApiError(`Canvas request failed (status ${res.status})`, res.status);

  const remaining = res.headers.get('X-Rate-Limit-Remaining');
  if (remaining !== null && Number(remaining) < 10) {
    await sleep(1000);
  }

  return res;
}

/** Fetches every page of a Canvas list endpoint (following the Link header) and returns the combined array. */
export async function canvasGetAll(
  connection: CanvasConnectionRow,
  path: string,
  params: Record<string, string | string[]> = {},
): Promise<unknown[]> {
  const token = getAccessToken(connection);
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach(v => qs.append(key, v));
    else qs.append(key, value);
  }
  qs.set('per_page', '100');

  let url: string | null = `${connection.base_url.replace(/\/$/, '')}/api/v1${path}?${qs.toString()}`;
  const results: unknown[] = [];

  while (url) {
    const res  = await requestWithRetry(url, token);
    const page = (await res.json()) as unknown[];
    results.push(...page);
    url = parseNextLink(res.headers.get('Link'));
  }

  return results;
}

/** Validates a token by fetching the connected Canvas user's own profile. Throws CanvasAuthError on a bad token. */
export async function canvasValidateToken(baseUrl: string, token: string): Promise<{ id: number; name: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/users/self`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401) throw new CanvasAuthError('Invalid Canvas access token');
  if (!res.ok) throw new CanvasApiError(`Could not reach Canvas at ${baseUrl} (status ${res.status})`, res.status);
  const data = await res.json() as { id: number; name: string };
  return { id: data.id, name: data.name };
}
