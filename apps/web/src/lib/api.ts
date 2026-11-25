export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: { requiredTier?: string; retryAfterSeconds?: number; details?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api/v1";

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; requiredTier?: string; retryAfterSeconds?: number; details?: unknown } };
    const e = body.error;
    return new ApiError(res.status, e?.code ?? "UNKNOWN", e?.message ?? res.statusText, {
      requiredTier: e?.requiredTier,
      retryAfterSeconds: e?.retryAfterSeconds,
      details: e?.details,
    });
  } catch {
    return new ApiError(res.status, "UNKNOWN", res.statusText || "Request failed");
  }
}

let refreshing: Promise<boolean> | null = null;
/** Single-flight refresh so concurrent 401s share one request. */
function refresh(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: csrfToken() ? { "x-csrf-token": csrfToken()! } : {},
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Double-submit CSRF: the API sets a JS-readable `mg_csrf` cookie and expects it echoed back. */
function csrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const m = /(?:^|;\s*)mg_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]!) : null;
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { body, headers, ...rest } = opts;
  const method = (rest.method ?? "GET").toUpperCase();
  const run = () => {
    const csrf = method === "GET" || method === "HEAD" ? null : csrfToken();
    return fetch(`${BASE}${path}`, {
      credentials: "include",
      ...rest,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await run();
  // One silent refresh-and-retry; never for the auth endpoints themselves.
  if (res.status === 401 && !path.startsWith("/auth/") && (await refresh())) res = await run();
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  // Every success body is `{ data }`; callers get the payload directly.
  return ((await res.json()) as { data: T }).data;
}

/** Field-level messages from a 422 validation error: `{ email: "Enter a valid email address" }`. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !Array.isArray(err.extra.details)) return {};
  const out: Record<string, string> = {};
  for (const d of err.extra.details as Array<{ path?: string; message?: string }>) {
    if (d.path && d.message && !(d.path in out)) out[d.path] = d.message;
  }
  return out;
}

/** True while the API is up but Postgres is down (auth, billing and new jobs return 503). */
export const isDegraded = (err: unknown): boolean =>
  err instanceof ApiError && (err.code === "DEGRADED" || err.status === 503);
