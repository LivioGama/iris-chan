const MAX_RETRIES = 4;
const BASE_DELAY_MS = 350;
const FETCH_TIMEOUT_MS = 5000;

export interface ConvexResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: string;
  latencyMs: number;
  retryCount: number;
}

export const createConvexClient = (
  baseUrl: string,
  adminKey?: string,
) => {
  const run = async <T = unknown>(
    functionName: string,
    args: Record<string, unknown> = {},
  ): Promise<ConvexResult<T>> => {
    // Convert colon notation to URL path: "runtime:saveEvent" → "/runtime/saveEvent"
    const path = functionName.replace(':', '/');
    const url = `${baseUrl}/api/mutation/${path}`;

    let retries = 0;
    const startMs = Date.now();

    while (true) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (adminKey) {
          headers['Authorization'] = `Convex ${adminKey}`;
        }

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ args }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        const json = await res.json();
        const latencyMs = Date.now() - startMs;

        if (!res.ok || json.status === 'error') {
          return {
            ok: false,
            error: json.errorMessage ?? json.error ?? `HTTP ${res.status}`,
            latencyMs,
            retryCount: retries,
          };
        }

        return {
          ok: true,
          value: json.value as T,
          latencyMs,
          retryCount: retries,
        };
      } catch (err) {
        retries++;
        if (retries > MAX_RETRIES) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            latencyMs: Date.now() - startMs,
            retryCount: retries,
          };
        }
        const delay = BASE_DELAY_MS * Math.pow(2, retries - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  };

  const query = async <T = unknown>(
    functionName: string,
    args: Record<string, unknown> = {},
  ): Promise<ConvexResult<T>> => {
    const path = functionName.replace(':', '/');
    const url = `${baseUrl}/api/query/${path}`;

    const startMs = Date.now();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (adminKey) {
        headers['Authorization'] = `Convex ${adminKey}`;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ args }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      const json = await res.json();
      const latencyMs = Date.now() - startMs;

      if (!res.ok || json.status === 'error') {
        return {
          ok: false,
          error: json.errorMessage ?? json.error ?? `HTTP ${res.status}`,
          latencyMs,
          retryCount: 0,
        };
      }

      return { ok: true, value: json.value as T, latencyMs, retryCount: 0 };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startMs,
        retryCount: 0,
      };
    }
  };

  return { run, query };
};
