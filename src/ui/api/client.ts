/**
 * Typed `fetch` wrapper for the PokeFocus API (docs/F2-plan.md §API).
 *
 * - Every request goes to `/api/*` on the same origin (Vite proxies it in dev)
 *   with `credentials: 'same-origin'`: the session is an HttpOnly cookie the
 *   client never sees.
 * - Bodies are JSON (the server rejects non-JSON writes as CSRF protection).
 * - Errors throw `ApiError { status, code, retryAfter?, body }`. `code` is the
 *   server's `{ error }` string, or 'network' / 'http_<status>' when there is none;
 *   `body` is the parsed JSON object of the answer (extra fields such as `unlockAt`),
 *   or null when it was not a JSON object.
 * - A 401 calls the handler registered with `onUnauthorized` (the auth store
 *   goes 'anon'), except for the requests that pass `allow401` (login, /me).
 */

export const API_BASE = '/api'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** Seconds, from `Retry-After` on 429. */
  readonly retryAfter: number | null
  /** The whole error answer (`{ error, ...extra }`, e.g. `unlockAt` of 409 name_locked); null when it was not a JSON object. */
  readonly body: Record<string, unknown> | null

  constructor(status: number, code: string, retryAfter: number | null = null, body: Record<string, unknown> | null = null) {
    super(`${status} ${code}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
    this.body = body
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

/** Error code of anything thrown by the client ('network' for non-API failures). */
export function errorCode(e: unknown): string {
  return isApiError(e) ? e.code : 'network'
}

export interface RequestOptions {
  headers?: Record<string, string>
  /** Do not report a 401 to the auth store (bootstrap / login probes). */
  allow401?: boolean
  signal?: AbortSignal
  /** Send this file as the raw body (its own Content-Type) instead of JSON: image uploads only. */
  raw?: Blob
}

let unauthorizedHandler: (() => void) | null = null

/** Registered by the auth store (avoids an import cycle). */
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
  // The server requires JSON on every write (CSRF guard), even with no payload (logout, DELETE, accept).
  if (method !== 'GET') {
    headers['Content-Type'] = opts.raw ? opts.raw.type : 'application/json'
    body ??= {}
  }
  let res: Response
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    throw new ApiError(0, 'network')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const code = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : `http_${res.status}`
    const ra = res.headers.get('Retry-After')
    const bodyRa = data && typeof data === 'object' ? (data as { retryAfter?: unknown }).retryAfter : undefined
    const retryAfter = typeof bodyRa === 'number' ? bodyRa : ra !== null && ra !== '' && Number.isFinite(Number(ra)) ? Number(ra) : null
    // 'invalid_credentials' is a failed login, not an expired session.
    if (res.status === 401 && !opts.allow401 && code !== 'invalid_credentials') unauthorizedHandler?.()
    const errBody = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null
    throw new ApiError(res.status, code, retryAfter, errBody)
  }
  return data as T
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body ?? {}, opts),
  patch: <T>(path: string, body: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body, opts),
  put: <T>(path: string, body: unknown, opts?: RequestOptions) => request<T>('PUT', path, body, opts),
  /** Raw image upload (`POST /admin/uploads`): the body is the file itself. */
  upload: <T>(path: string, file: Blob, opts?: RequestOptions) => request<T>('POST', path, undefined, { ...opts, raw: file }),
  delete: <T = void>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
}
