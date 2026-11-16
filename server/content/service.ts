/**
 * ContentService (docs/admin-plan.md §1 «Servidor»): which live content applies
 * now, and the exact content a session pinned when it started.
 *
 * - `current(now)`: the published version with the latest `effective_at <= now`
 *   + the live events active at `now`, resolved into an EngineContext and
 *   memoized by `versionId + [eventId@revision]`. No version and no events =
 *   the base context itself (`hash: 'base'`), so without a published patch
 *   every action runs exactly as before.
 * - `byHash(hash)`: the context of a pinned hash (LRU in memory, else
 *   `content_snapshots`). `persist(tx, resolved)` writes that snapshot inside
 *   the transaction of the action that pins it (session start).
 * - `contentForAction(...)`: which context each game action uses (start →
 *   current; claim/cancel → the session's; wave actions → the encounter's;
 *   the rest → current).
 * - `check(now)`: broadcast `{type:'content', hash}` over SSE when the active
 *   hash changed (publication, scheduled version, event start/end). The
 *   server ticks it every 30 s (server/index.ts).
 *
 * The engine does not hash: `hash = sha256(baseHash + canonical({patch, events, eventItems}))`.
 * Single instance (in-memory memo/LRU and event bus), like push and groups.
 */
import { createHash } from 'node:crypto'
import { and, eq, isNotNull } from 'drizzle-orm'
import { baseContext, createEngineContext, type EngineContext } from '../../src/engine/context'
import { resolveContent, type ContentItem, type ContentPatch, type EventOverlay } from '../../src/engine/content'
import type { ContentResponse, GameAction, GameDoc } from '../../src/game/protocol'
import meta from '../../src/data/game/meta.json'
import type { Db, Tx } from '../db/client'
import { contentSnapshots, contentVersions, type ResolvedContentInput } from '../db/schema'
import type { EventBus } from '../events'

/** sha256 of the shipped data (src/data/game/meta.json, written by `npm run build:data`). */
export const BASE_HASH: string = meta.baseHash

/** A published live event as the service sees it (loaded from `live_events` by server/content/events.ts). */
export interface PublishedEvent {
  overlay: EventOverlay
  /** +1 on every published edit (part of the memo key). */
  revision: number
  /** Archived: never active again, but its items keep their names in the inventory. */
  retired?: boolean
}

/**
 * Source of the published (and archived) events. It receives the executor the service is
 * loading with: inside a transaction it must query through that handle, never `db`
 * (PGlite has a single connection and would deadlock).
 */
export type EventSource = (ex: Db | Tx) => Promise<PublishedEvent[]>

/** A resolved content: what a context was built from, its hash and the context. */
export interface ResolvedContent extends ResolvedContentInput {
  hash: string
  baseHash: string
  /** Active content version (null = none, only the base and/or events). */
  versionId: number | null
  /** `{ [eventId]: revision }` of the active events. */
  eventRevs: Record<string, number>
  ctx: EngineContext
}

type Executor = Db | Tx

export interface ContentService {
  readonly baseHash: string
  /** Content active at `now` (game time). Reloads from the database every `reloadMs`. */
  current(now: number, ex?: Executor): Promise<ResolvedContent>
  /** Content of a pinned hash; 'base' = the shipped data; null = unknown hash. */
  byHash(hash: string, db?: Executor): Promise<ResolvedContent | null>
  /** Store the snapshot of a non-base content (idempotent), in the caller's transaction. */
  persist(tx: Executor, r: ResolvedContent): Promise<void>
  /** Re-read the published versions and events now (after an admin write in this process). */
  reload(): Promise<void>
  /** Broadcast `{type:'content', hash}` if the active hash changed since the last check. Returns the new hash or null. */
  check(now?: number): Promise<string | null>
  /**
   * Publish a NEW version (immutable): used by tests and by the admin rollback.
   * `effectiveAt` default = now (real clock). Without `ex` it reloads and
   * checks right away; with the caller's transaction it only inserts, and the
   * caller runs `refresh()` after the commit.
   */
  publish(input: PublishInput, ex?: Executor): Promise<{ id: number; hash: string }>
  /**
   * Publish an existing DRAFT in the caller's transaction (admin API): it
   * becomes `published` (scheduled when `effectiveAt` is in the future) and
   * immutable. Null when the row is not a draft (nothing changed). Run
   * `refresh()` after the commit.
   */
  publishDraft(ex: Executor, id: number, input: PublishDraftInput): Promise<{ id: number; hash: string } | null>
  /** `reload()` + `check()`: after a publication committed, announce it at once (SSE) when it changes the active hash. */
  refresh(): Promise<void>
}

/** The event a version is tied to (see `content_versions.linked_event_id`). */
export interface EventLinkInput {
  linkedEventId?: string
  linkedRole?: 'start' | 'end'
  revertOfVersionId?: number
}

export interface PublishDraftInput extends EventLinkInput {
  effectiveAt?: number
  userId?: string | null
  validation?: unknown
}

export interface PublishInput extends EventLinkInput {
  patch: ContentPatch
  effectiveAt?: number
  title?: string | null
  note?: string | null
  parentId?: number | null
  userId?: string | null
  validation?: unknown
}

export interface ContentServiceOptions {
  db: Db
  bus?: EventBus
  /** Real time (ms), for the reload TTL and `publish`/`check` defaults. */
  clock?: () => number
  events?: EventSource
  /** Reload period of the published versions/events (default 60 s). */
  reloadMs?: number
  /** Size of the hash → context LRU (default 32). */
  lruSize?: number
}

interface VersionMeta {
  id: number
  effectiveAt: number
}

const BASE_INPUT: ResolvedContentInput = Object.freeze({ patch: {}, events: [], eventItems: {} }) as ResolvedContentInput

/** JSON with sorted keys and no `undefined` (stable across key order). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
}

function isEmptyInput(r: ResolvedContentInput): boolean {
  return Object.keys(r.patch).length === 0 && r.events.length === 0 && Object.keys(r.eventItems).length === 0
}

/** 'base' when nothing changes, else sha256(baseHash + canonical input). */
export function contentHashOf(r: ResolvedContentInput, baseHash = BASE_HASH): string {
  if (isEmptyInput(r)) return 'base'
  return createHash('sha256')
    .update(baseHash + canonicalJson({ patch: r.patch, events: r.events, eventItems: r.eventItems }))
    .digest('hex')
}

/** Hash of a version's patch alone (content_versions.hash). */
export function patchHash(patch: ContentPatch): string {
  return createHash('sha256').update(canonicalJson(patch)).digest('hex')
}

export const HASH_RE = /^(base|[a-f0-9]{64})$/

export function createContentService(opts: ContentServiceOptions): ContentService {
  const { db } = opts
  const clock = opts.clock ?? Date.now
  const eventSource: EventSource = opts.events ?? (async () => [])
  const reloadMs = opts.reloadMs ?? 60_000
  const lruSize = opts.lruSize ?? 32

  const base: ResolvedContent = { ...BASE_INPUT, hash: 'base', baseHash: BASE_HASH, versionId: null, eventRevs: {}, ctx: baseContext() }

  let versions: VersionMeta[] = [] // published, by effectiveAt asc then id asc
  let events: PublishedEvent[] = []
  let eventItems: Record<string, ContentItem> = {}
  let loadedAt = -Infinity
  let loading: Promise<void> | null = null
  const patches = new Map<number, ContentPatch>() // published = immutable: cached forever
  const byKey = new Map<string, ResolvedContent>()
  const lru = new Map<string, ResolvedContent>()
  let lastBroadcast: string | null = null

  const remember = (r: ResolvedContent) => {
    if (r.hash === 'base') return
    lru.delete(r.hash)
    lru.set(r.hash, r)
    while (lru.size > lruSize) lru.delete(lru.keys().next().value!)
  }

  const build = (input: ResolvedContentInput, hash: string, versionId: number | null, eventRevs: Record<string, number>): ResolvedContent => {
    const cached = lru.get(hash)
    // Same content from another version (e.g. a rollback copy): share the context, report the version that applies now.
    if (cached) return cached.versionId === versionId ? cached : { ...cached, versionId, eventRevs }
    const ctx = createEngineContext(resolveContent(input.patch, input.events, input.eventItems, { hash }))
    const r: ResolvedContent = { ...input, hash, baseHash: BASE_HASH, versionId, eventRevs, ctx }
    remember(r)
    return r
  }

  async function load(ex: Executor): Promise<void> {
    const rows = await ex
      .select({ id: contentVersions.id, effectiveAt: contentVersions.effectiveAt })
      .from(contentVersions)
      .where(and(eq(contentVersions.status, 'published'), isNotNull(contentVersions.effectiveAt)))
    const nextVersions = rows.map((r) => ({ id: r.id, effectiveAt: r.effectiveAt!.getTime() })).sort((a, b) => a.effectiveAt - b.effectiveAt || a.id - b.id)
    const nextEvents = await eventSource(ex)
    const items: Record<string, ContentItem> = {}
    // Items of every published event (past ones too), so the inventory keeps their names.
    for (const e of [...nextEvents].sort((a, b) => a.overlay.startsAt - b.overlay.startsAt || (a.overlay.id < b.overlay.id ? -1 : 1))) Object.assign(items, e.overlay.items ?? {})
    // Swap everything at once (no await in between), so readers never see new versions with old events.
    versions = nextVersions
    events = nextEvents
    eventItems = items
    byKey.clear()
    loadedAt = clock()
  }

  /**
   * First load: callers wait for it. Afterwards a stale cache is served as is while ONE reload runs
   * in the background on the pool. Waiting for it from inside a transaction deadlocked under load:
   * every pool connection held by a transaction waiting for a reload that needed a free connection.
   */
  async function ensureLoaded(ex: Executor = db): Promise<void> {
    if (clock() - loadedAt < reloadMs) return
    if (loadedAt === -Infinity) {
      loading ??= load(ex).finally(() => {
        loading = null
      })
      await loading
      return
    }
    loading ??= load(db)
      .catch(() => {}) // keep serving the old content; the next request tries again
      .finally(() => {
        loading = null
      })
  }

  async function patchOf(id: number, ex: Executor = db): Promise<ContentPatch> {
    let p = patches.get(id)
    if (!p) {
      const [row] = await ex.select({ patch: contentVersions.patch }).from(contentVersions).where(eq(contentVersions.id, id))
      p = row?.patch ?? {}
      patches.set(id, p)
    }
    return p
  }

  /** `ex`: pass the caller's transaction when inside one (PGlite has a single connection: querying `db` there deadlocks). */
  async function current(now: number, ex: Executor = db): Promise<ResolvedContent> {
    await ensureLoaded(ex)
    let version: VersionMeta | null = null
    for (const v of versions) if (v.effectiveAt <= now) version = v
    const active = events.filter((e) => !e.retired && e.overlay.startsAt <= now && now < e.overlay.endsAt)
    if (!version && active.length === 0 && Object.keys(eventItems).length === 0) return base
    const eventRevs = Object.fromEntries(active.map((e) => [e.overlay.id, e.revision]))
    const key = `${version?.id ?? '-'}|${Object.entries(eventRevs).map(([id, rev]) => `${id}@${rev}`).sort().join(',')}`
    const hit = byKey.get(key)
    if (hit) return hit
    const input: ResolvedContentInput = {
      patch: version ? await patchOf(version.id, ex) : {},
      events: active.map((e) => e.overlay).sort((a, b) => a.startsAt - b.startsAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      eventItems,
    }
    const hash = contentHashOf(input)
    const r = hash === 'base' ? base : build(input, hash, version?.id ?? null, eventRevs)
    byKey.set(key, r)
    return r
  }

  async function byHash(hash: string, ex: Executor = db): Promise<ResolvedContent | null> {
    if (hash === 'base') return base
    const hit = lru.get(hash)
    if (hit) {
      remember(hit)
      return hit
    }
    if (!HASH_RE.test(hash)) return null
    const [row] = await ex.select().from(contentSnapshots).where(eq(contentSnapshots.hash, hash))
    if (!row) return null
    if (row.baseHash !== BASE_HASH) console.warn(`[content] snapshot ${hash.slice(0, 12)} was resolved on another base (${row.baseHash.slice(0, 12)}); rebuilt on the current one`)
    return build(row.resolved, hash, row.versionId, row.eventRevs)
  }

  async function persist(tx: Executor, r: ResolvedContent): Promise<void> {
    if (r.hash === 'base') return
    await tx
      .insert(contentSnapshots)
      .values({ hash: r.hash, baseHash: r.baseHash, versionId: r.versionId, eventRevs: r.eventRevs, resolved: { patch: r.patch, events: r.events, eventItems: r.eventItems } })
      .onConflictDoNothing()
  }

  async function reload(): Promise<void> {
    await loading // a background reload may predate the change that asked for this one
    loadedAt = -Infinity
    await ensureLoaded()
  }

  async function check(now = clock()): Promise<string | null> {
    const { hash } = await current(now)
    if (lastBroadcast === null) {
      // First check after boot: remember, don't announce (clients fetch on load anyway).
      lastBroadcast = hash
      return null
    }
    if (hash === lastBroadcast) return null
    lastBroadcast = hash
    opts.bus?.broadcast({ type: 'content', hash })
    return hash
  }

  async function publish(input: PublishInput, ex: Executor = db): Promise<{ id: number; hash: string }> {
    const t = clock()
    const hash = patchHash(input.patch)
    const [row] = await ex
      .insert(contentVersions)
      .values({
        status: 'published',
        patch: input.patch,
        baseHash: BASE_HASH,
        hash,
        parentId: input.parentId ?? null,
        title: input.title ?? null,
        note: input.note ?? null,
        effectiveAt: new Date(input.effectiveAt ?? t),
        ...(input.validation !== undefined && { validation: input.validation }),
        createdBy: input.userId ?? null,
        publishedBy: input.userId ?? null,
        publishedAt: new Date(t),
        ...(input.linkedEventId && { linkedEventId: input.linkedEventId, linkedRole: input.linkedRole ?? 'start' }),
        ...(input.revertOfVersionId !== undefined && { revertOfVersionId: input.revertOfVersionId }),
      })
      .returning({ id: contentVersions.id })
    if (ex === db) await refresh()
    return { id: row!.id, hash }
  }

  async function publishDraft(ex: Executor, id: number, input: PublishDraftInput): Promise<{ id: number; hash: string } | null> {
    const t = clock()
    const [cur] = await ex.select({ patch: contentVersions.patch, status: contentVersions.status }).from(contentVersions).where(eq(contentVersions.id, id)).for('update')
    if (!cur || cur.status !== 'draft') return null
    const hash = patchHash(cur.patch)
    await ex
      .update(contentVersions)
      .set({
        status: 'published',
        baseHash: BASE_HASH,
        hash,
        effectiveAt: new Date(input.effectiveAt ?? t),
        ...(input.validation !== undefined && { validation: input.validation }),
        publishedBy: input.userId ?? null,
        publishedAt: new Date(t),
        ...(input.linkedEventId && { linkedEventId: input.linkedEventId, linkedRole: input.linkedRole ?? 'start' }),
      })
      .where(eq(contentVersions.id, id))
    return { id, hash }
  }

  async function refresh(): Promise<void> {
    await reload()
    await check()
  }

  return { baseHash: BASE_HASH, current, byHash, persist, reload, check, publish, publishDraft, refresh }
}

/** Actions that run on the content pinned by the active session. */
const SESSION_PINNED: ReadonlySet<GameAction['type']> = new Set<GameAction['type']>(['claim', 'cancel'])
/** Actions that run on the content pinned by the encounter (waves of a claimed session). */
const ENCOUNTER_PINNED: ReadonlySet<GameAction['type']> = new Set<GameAction['type']>([
  'throwBall',
  'applyStatus',
  'reroll',
  'assignDamage',
  'autoAssignDamage',
  'nextWave',
  'finishWaves',
])

/**
 * The content a game action runs on (docs/admin-plan.md «Fijado por sesión»):
 * start → current (and pinned on the session); claim/cancel → the session's;
 * wave actions → the encounter's; anything else → current. A missing hash
 * means the session/encounter started on the base content ('base'). An
 * unknown snapshot (should not happen: it is written at start) falls back to current.
 */
export async function contentForAction(content: ContentService, tx: Executor, doc: GameDoc, type: GameAction['type'], now: number): Promise<ResolvedContent> {
  const p = doc.player
  let pinned: string | null = null
  if (SESSION_PINNED.has(type) && p?.activeSession) pinned = p.activeSession.contentHash ?? 'base'
  else if (ENCOUNTER_PINNED.has(type) && p?.encounter) pinned = p.encounter.contentHash ?? 'base'
  if (pinned !== null) {
    const r = await content.byHash(pinned, tx)
    if (r) return r
    console.warn(`[content] pinned content ${pinned.slice(0, 12)} not found; using the current one`)
  }
  return content.current(now, tx)
}

/** Public body of GET /api/content(/:hash). */
export function contentBody(r: ResolvedContent): ContentResponse {
  return { hash: r.hash, baseHash: r.baseHash, patch: r.patch, events: r.events, eventItems: r.eventItems }
}
