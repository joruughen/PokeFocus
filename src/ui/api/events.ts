/**
 * Server-sent events (GET /api/events): one EventSource per tab while signed
 * in. The server sends `ServerEvent` JSON either as the default `message`
 * event or as named events (`game`, `friends`, `logout`); both are handled.
 *
 * Reconnects with exponential backoff (1 s → 30 s, with jitter) when the
 * connection drops; the backoff resets after a successful open.
 */
import type { ServerEvent } from '../../game/protocol'
import { API_BASE } from './client'

type Listener = (e: ServerEvent) => void

const listeners = new Set<Listener>()
let source: EventSource | null = null
let retry: ReturnType<typeof setTimeout> | null = null
let attempt = 0
let wanted = false

function dispatch(raw: string) {
  let ev: ServerEvent
  try {
    ev = JSON.parse(raw) as ServerEvent
  } catch {
    return
  }
  if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') return
  for (const l of listeners) l(ev)
}

function open() {
  if (!wanted || source || typeof EventSource === 'undefined') return
  const es = new EventSource(`${API_BASE}/events`, { withCredentials: true })
  source = es
  es.onopen = () => {
    attempt = 0
  }
  es.onmessage = (m) => dispatch(m.data as string)
  for (const name of ['game', 'friends', 'logout'] as const) {
    es.addEventListener(name, (m) => {
      const data = (m as MessageEvent).data as string
      // Named events may carry just the payload; make sure `type` is set.
      try {
        const obj = data ? (JSON.parse(data) as Record<string, unknown>) : {}
        dispatch(JSON.stringify({ ...obj, type: name }))
      } catch {
        dispatch(JSON.stringify({ type: name }))
      }
    })
  }
  es.onerror = () => {
    // The browser retries by itself on some errors, but not on HTTP errors (e.g. 401): own it.
    es.close()
    if (source === es) source = null
    schedule()
  }
}

function schedule() {
  if (!wanted || retry) return
  const delay = Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + Math.random() * 0.5)
  attempt = Math.min(attempt + 1, 6)
  retry = setTimeout(() => {
    retry = null
    open()
  }, delay)
}

/** Start listening (idempotent). Called when the user is signed in. */
export function connectEvents(): void {
  wanted = true
  open()
}

/** Stop listening (on logout). */
export function disconnectEvents(): void {
  wanted = false
  attempt = 0
  if (retry) clearTimeout(retry)
  retry = null
  source?.close()
  source = null
}

/** Subscribe to every server event; returns the unsubscribe function. */
export function onServerEvent(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
