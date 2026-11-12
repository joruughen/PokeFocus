/**
 * In-memory stand-in for `/api/admin/content/*`, `/api/admin/me` and `/api/admin/reauth`, layered over whatever
 * `fetch` is installed (use it after `installFakeServer()`, and restore it before that one; every other path goes to it). It runs the REAL
 * pure code the server uses (validateContentPatch, diffPatches, spawnPreview) over an in-memory table of versions,
 * and reproduces the API's contract: sudo mode (403 `elevation_required`, 403 `wrong_password`), 409
 * `confirm_required`, 422 `validation_failed`, 409 `not_draft` / `not_published`, the 20-draft cap and the 60-day schedule.
 * Events: `GET /api/admin/events?status=` (what `seedEvent` added) and the publish options that tie a version to one
 * (`linkEventId`, `revertWhenEnds`): the `end` copy, `event_not_linkable`, and the unschedule that takes the copy along.
 */
import { vi } from 'vitest'
import { createEngineContext, resolveContent, type ContentPatch } from '../../engine'
import { diffPatches, spawnPreview, validateContentPatch } from '../../game/content'
import type {
  AdminContentStatus,
  AdminContentValidation,
  AdminContentVersion,
  AdminContentVersionResponse,
  AdminContentVersionSummary,
  AdminContentLinkRole,
  AdminEvent,
  AdminSimCheck,
  AdminSimParams,
  AdminSimProfile,
  AdminSimProfileStats,
  AdminSimReport,
  AdminSimRun,
  AdminSimRunSummary,
  AdminSpawnWeather,
  ContentIssue,
  UserRole,
} from '../../game/protocol'
import { ADMIN_SIM_MAX_PLAYER_WEEKS, ADMIN_SIM_RECENT_MS } from '../../game/protocol'

export interface FakeRow {
  id: number
  status: AdminContentStatus
  title: string | null
  note: string | null
  patch: ContentPatch
  parentId: number | null
  effectiveAt: number | null
  validation: AdminContentValidation | null
  createdAt: number
  linkedEventId?: string | null
  linkedRole?: AdminContentLinkRole | null
  revertOfVersionId?: number | null
}

export interface FakeEvent {
  id: string
  slug: string
  name: { es: string; en: string }
  status: 'draft' | 'published' | 'archived'
  startsAt: number
  endsAt: number
}

export interface FakeAdminContent {
  /** Role of the signed-in account. */
  role: UserRole
  /** Sudo mode on (set by a correct /admin/reauth, or by the test). */
  elevated: boolean
  password: string
  rows: Map<number, FakeRow>
  /** Admin requests seen: method, path, body. */
  calls: { method: string; path: string; body: unknown }[]
  /** Clock (epoch ms). */
  now: number
  /** Add a published version that is in force (effective in the past). */
  seedPublished: (patch: ContentPatch, title?: string) => FakeRow
  seedDraft: (patch: ContentPatch, title?: string) => FakeRow
  /** Live events the publish dialog can tie a version to (published by default). */
  events: FakeEvent[]
  seedEvent: (o: { slug: string; name?: { es: string; en: string }; startsAt: number; endsAt: number; status?: FakeEvent['status'] }) => FakeEvent
  /** Simulation runs (E10), newest last. A run stays `running` until `finishSims()` (or `simAutoFinish`). */
  sims: FakeSimRun[]
  /** Finish a running simulation on its next GET (default true). */
  simAutoFinish: boolean
  /** Another simulation occupies the server: POST simulate → 409 busy. */
  simBusy: boolean
  finishSims: () => void
  restore: () => void
}

export interface FakeSimRun {
  run: AdminSimRun
  /** JSON of the patch simulated (the fake's «draft hash»). */
  patchKey: string
}

/** Synthetic comparison: the draft gives 10 % more weekly points and 1 more shiny. */
export function fakeSimReport(params: AdminSimParams, activeVersionId: number | null, draftId: number): AdminSimReport {
  const stats = (k: number): AdminSimProfileStats[] =>
    params.profiles.map((profile) => ({
      profile,
      n: params.seeds,
      weeklyPoints: Array.from({ length: params.weeks }, () => ({ p25: 9000 * k, p50: 10000 * k, p75: 11000 * k, mean: 10000 * k })),
      weeklyPointsMedian: 10000 * k,
      leagueShare: { base: 1, super: 0.8, ultra: 0.2 * k, master: 0 },
      sessions: 20,
      minutesPerDay: 90,
      catches: 60,
      speciesCaught: 30,
      legendarySeen: 1,
      legendaryCaught: 0.5,
      shinySeen: k > 1 ? 2 : 1,
      shinyCaught: k > 1 ? 2 : 1,
      dustEarned: 5000,
      dustSpent: 4000,
      finalDust: 1000,
      exhaustedShare: 0.1,
      startedEmptyShare: 0,
      endEnergy: 0.6,
      restSessions: 0,
    }))
  return { params, active: { hash: 'base', versionId: activeVersionId, profiles: stats(1) }, proposed: { hash: `h${draftId}`, versionId: draftId, profiles: stats(1.1) }, ms: 1200 }
}

const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const MAX_DRAFTS = 20
const MAX_SCHEDULE_MS = 60 * 86_400_000

function toValidation(r: ReturnType<typeof validateContentPatch>, smoke: boolean, at: number): AdminContentValidation {
  return { ok: r.ok, errors: r.errors as ContentIssue[], warnings: r.warnings as ContentIssue[], requiresConfirm: r.requiresConfirm, smoke, at }
}

export function installFakeAdminContent(opts: { role?: UserRole; elevated?: boolean; now?: number } = {}): FakeAdminContent {
  const previous = globalThis.fetch
  let nextId = 1
  const fake: FakeAdminContent = {
    role: opts.role ?? 'admin',
    elevated: opts.elevated ?? false,
    password: 'correct horse',
    rows: new Map(),
    calls: [],
    now: opts.now ?? Date.UTC(2026, 10, 10, 12),
    seedPublished(patch, title) {
      const id = nextId++
      const row: FakeRow = { id, status: 'published', title: title ?? null, note: null, patch, parentId: null, effectiveAt: fake.now - 3_600_000, validation: null, createdAt: fake.now - 7_200_000 }
      fake.rows.set(id, row)
      return row
    },
    seedDraft(patch, title) {
      const id = nextId++
      const row: FakeRow = { id, status: 'draft', title: title ?? null, note: null, patch, parentId: null, effectiveAt: null, validation: null, createdAt: fake.now }
      fake.rows.set(id, row)
      return row
    },
    events: [],
    seedEvent(o) {
      const ev: FakeEvent = { id: `00000000-0000-4000-8000-${String(fake.events.length + 1).padStart(12, '0')}`, slug: o.slug, name: o.name ?? { es: o.slug, en: o.slug }, status: o.status ?? 'published', startsAt: o.startsAt, endsAt: o.endsAt }
      fake.events.push(ev)
      return ev
    },
    sims: [],
    simAutoFinish: true,
    simBusy: false,
    finishSims() {
      for (const s of fake.sims)
        if (s.run.status === 'running') {
          s.run.status = 'done'
          s.run.finishedAt = fake.now
          s.run.progress = null
          s.run.report = fakeSimReport(s.run.params, s.run.activeVersionId, s.run.versionId ?? 0)
        }
    },
    restore: () => {
      globalThis.fetch = previous
    },
  }
  const simSummary = (s: FakeSimRun): AdminSimRunSummary => {
    const { report: _report, ...rest } = s.run
    return rest
  }
  const simCheck = (r: FakeRow): AdminSimCheck => {
    const mine = fake.sims.filter((s) => s.run.versionId === r.id)
    const key = JSON.stringify(r.patch)
    const recent = mine.some((s) => s.run.status === 'done' && s.patchKey === key && s.run.finishedAt !== null && fake.now - s.run.finishedAt <= ADMIN_SIM_RECENT_MS)
    const last = mine.at(-1)
    return { recent, last: last ? simSummary(last) : null }
  }

  const activeRow = (): FakeRow | null => {
    let best: FakeRow | null = null
    for (const r of fake.rows.values()) if (r.status === 'published' && r.effectiveAt !== null && r.effectiveAt <= fake.now && (!best || r.effectiveAt >= best.effectiveAt!)) best = r
    return best
  }
  const scheduledRow = (): FakeRow | null =>
    [...fake.rows.values()].filter((r) => r.status === 'published' && r.effectiveAt !== null && r.effectiveAt > fake.now).sort((a, b) => a.effectiveAt! - b.effectiveAt!)[0] ?? null

  const summary = (r: FakeRow): AdminContentVersionSummary => {
    const ev = r.linkedEventId ? fake.events.find((e) => e.id === r.linkedEventId) : undefined
    return {
      ...base(r),
      linkedEvent: ev ? { id: ev.id, slug: ev.slug, name: ev.name, status: ev.status, startsAt: ev.startsAt, endsAt: ev.endsAt } : null,
      linkedRole: ev ? (r.linkedRole ?? 'start') : null,
      revertOfVersionId: r.revertOfVersionId ?? null,
      revertStale: staleRevert(r),
    }
  }
  /** The `end` copy is out of date when another version sits between the event's start and end (or the baseline changed). */
  const staleRevert = (r: FakeRow): boolean => {
    if (r.linkedRole !== 'end' || r.status !== 'published' || r.effectiveAt === null || r.effectiveAt <= fake.now) return false
    const ev = fake.events.find((e) => e.id === r.linkedEventId)
    const start = r.revertOfVersionId ? (fake.rows.get(r.revertOfVersionId)?.effectiveAt ?? ev?.startsAt ?? fake.now) : (ev?.startsAt ?? fake.now)
    const others = [...fake.rows.values()].filter((x) => x.status === 'published' && x.effectiveAt !== null && x.linkedEventId !== r.linkedEventId)
    if (others.some((x) => x.effectiveAt! > start && x.effectiveAt! <= r.effectiveAt!)) return true
    const before = others.filter((x) => x.effectiveAt! <= start).sort((a, b) => a.effectiveAt! - b.effectiveAt! || a.id - b.id).at(-1)
    return JSON.stringify(before?.patch ?? {}) !== JSON.stringify(r.patch)
  }

  const base = (r: FakeRow): Omit<AdminContentVersionSummary, 'linkedEvent' | 'linkedRole' | 'revertOfVersionId' | 'revertStale'> => ({
    id: r.id,
    status: r.status,
    title: r.title,
    note: r.note,
    parentId: r.parentId,
    hash: `h${r.id}`,
    effectiveAt: r.effectiveAt,
    createdBy: { id: 'u1', trainerName: 'Admin' },
    createdAt: r.createdAt,
    publishedBy: r.status === 'published' ? { id: 'u1', trainerName: 'Admin' } : null,
    publishedAt: r.status === 'published' ? r.effectiveAt : null,
    active: activeRow()?.id === r.id,
    scheduled: r.status === 'published' && r.effectiveAt !== null && r.effectiveAt > fake.now,
    validation: r.validation && { ok: r.validation.ok, errors: r.validation.errors.length, warnings: r.validation.warnings.length, requiresConfirm: r.validation.requiresConfirm, smoke: r.validation.smoke },
  })

  const body = (r: FakeRow): AdminContentVersionResponse => {
    const version: AdminContentVersion = { ...summary(r), patch: r.patch, baseHash: 'base', validationDetail: r.validation }
    return { version, diff: diffPatches(activeRow()?.patch ?? {}, r.patch), ...(r.status === 'draft' && { sim: simCheck(r) }), serverNow: fake.now }
  }

  const gate = (r: FakeRow, confirm: boolean | undefined): Response | null => {
    const v = validateContentPatch(r.patch, { previous: activeRow()?.patch, smoke: { sessions: 20 } })
    if (!v.ok) return json(422, { error: 'validation_failed', errors: v.errors, warnings: v.warnings, requiresConfirm: v.requiresConfirm })
    if (v.requiresConfirm && !confirm) return json(409, { error: 'confirm_required', warnings: v.warnings.filter((w) => w.requiresConfirm) })
    return null
  }

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    if (!path.startsWith('/api/admin/')) return previous(input, init)
    const method = (init?.method ?? 'GET').toUpperCase()
    const data = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    fake.calls.push({ method, path, body: typeof init?.body === 'string' ? data : undefined })
    const [route, query = ''] = path.slice('/api/admin/'.length).split('?')
    const params = new URLSearchParams(query)
    const staff = fake.role === 'admin' || fake.role === 'support'
    if (!staff) return json(403, { error: 'forbidden' })
    const needAdmin = (): Response | null => (fake.role === 'admin' ? null : json(403, { error: 'forbidden' }))
    const needSudo = (): Response | null => (fake.elevated ? null : json(403, { error: 'elevation_required' }))

    if (route === 'me' && method === 'GET') return json(200, { role: fake.role, elevated: fake.elevated, elevatedUntil: fake.elevated ? fake.now + 1_800_000 : null, serverNow: fake.now })
    if (route === 'reauth' && method === 'POST') {
      if (data.password !== fake.password) return json(403, { error: 'wrong_password' })
      fake.elevated = true
      return json(200, { role: fake.role, elevated: true, elevatedUntil: fake.now + 1_800_000, serverNow: fake.now })
    }
    if (route === 'events' && method === 'GET') {
      const status = params.get('status')
      const items = fake.events.filter((e) => !status || e.status === status).map((e) => ({ ...e, description: e.name, imageId: null, image: null, overlay: { featured: [], drops: [], missions: [] }, revision: 1, announceRev: 0, validation: null, createdBy: null, createdAt: e.startsAt, updatedAt: e.startsAt, publishedBy: null, publishedAt: null, active: e.startsAt <= fake.now && fake.now < e.endsAt, scheduled: e.startsAt > fake.now }) satisfies AdminEvent)
      return json(200, { items, serverNow: fake.now })
    }
    if (!route!.startsWith('content/')) return json(404, { error: 'not_found' })
    const parts = route!.slice('content/'.length).split('/')

    if (parts[0] === 'live' && method === 'GET') {
      const active = activeRow()
      const sched = scheduledRow()
      return json(200, { hash: active ? `h${active.id}` : 'base', baseHash: 'base', active: active && summary(active), patch: active?.patch ?? {}, scheduled: sched && summary(sched), events: [], serverNow: fake.now })
    }
    if (parts[0] === 'versions' && parts.length === 1 && method === 'GET') {
      const status = params.get('status')
      const items = [...fake.rows.values()].filter((r) => !status || r.status === status).sort((a, b) => b.id - a.id)
      return json(200, { items: items.map(summary), serverNow: fake.now })
    }
    if (parts[0] === 'versions' && parts.length === 2 && method === 'GET') {
      const r = fake.rows.get(Number(parts[1]))
      return r ? json(200, body(r)) : json(404, { error: 'not_found' })
    }
    if (parts[0] === 'versions' && parts[2] === 'rollback' && method === 'POST') {
      const denied = needAdmin() ?? needSudo()
      if (denied) return denied
      const src = fake.rows.get(Number(parts[1]))
      if (!src) return json(404, { error: 'not_found' })
      if (src.status === 'draft' || src.effectiveAt === null || src.effectiveAt > fake.now) return json(409, { error: 'not_published' })
      const blocked = gate(src, data.confirm as boolean | undefined)
      if (blocked) return blocked
      const row = fake.seedPublished(src.patch, `Rollback to #${src.id}`)
      row.parentId = src.id
      row.effectiveAt = fake.now
      return json(201, body(row))
    }
    if (parts[0] === 'versions' && parts[2] === 'unschedule' && method === 'POST') {
      const denied = needAdmin() ?? needSudo()
      if (denied) return denied
      const r = fake.rows.get(Number(parts[1]))
      if (!r) return json(404, { error: 'not_found' })
      if (r.status !== 'published' || r.effectiveAt === null || r.effectiveAt <= fake.now) return json(409, { error: 'not_scheduled' })
      const cancel = (x: FakeRow) => {
        x.status = 'draft'
        x.effectiveAt = null
        x.linkedEventId = null
        x.linkedRole = null
        x.revertOfVersionId = null
      }
      // The `end` copies of a cancelled `start` version go back to drafts with it.
      if (r.linkedRole === 'start') for (const x of fake.rows.values()) if (x.revertOfVersionId === r.id && x.status === 'published' && x.effectiveAt !== null && x.effectiveAt > fake.now) cancel(x)
      cancel(r)
      return json(200, body(r))
    }
    if (parts[0] === 'drafts' && parts.length === 1 && method === 'POST') {
      const denied = needAdmin()
      if (denied) return denied
      if ([...fake.rows.values()].filter((r) => r.status === 'draft').length >= MAX_DRAFTS) return json(409, { error: 'too_many_drafts' })
      let patch: ContentPatch = {}
      let parentId: number | null = null
      if (typeof data.fromVersionId === 'number') {
        const src = fake.rows.get(data.fromVersionId)
        if (!src) return json(404, { error: 'not_found' })
        patch = src.patch
        parentId = src.id
      } else if ((data.from ?? 'active') === 'active') {
        const a = activeRow()
        patch = a?.patch ?? {}
        parentId = a?.id ?? null
      }
      const row = fake.seedDraft(patch, (data.title as string) || undefined)
      row.parentId = parentId
      row.validation = toValidation(validateContentPatch(patch, { previous: activeRow()?.patch, smoke: false }), false, fake.now)
      return json(201, body(row))
    }
    if (parts[0] === 'drafts') {
      const denied = needAdmin()
      if (denied) return denied
      const r = fake.rows.get(Number(parts[1]))
      if (!r) return json(404, { error: 'not_found' })
      if (r.status !== 'draft') return json(409, { error: 'not_draft' })
      if (parts.length === 2 && method === 'PUT') {
        if (data.patch !== undefined) {
          r.patch = data.patch as ContentPatch
          r.validation = toValidation(validateContentPatch(r.patch, { previous: activeRow()?.patch, smoke: false }), false, fake.now)
        }
        if (data.title !== undefined) r.title = (data.title as string | null) || null
        if (data.note !== undefined) r.note = (data.note as string | null) || null
        return json(200, body(r))
      }
      if (parts.length === 2 && method === 'DELETE') {
        fake.rows.delete(r.id)
        return new Response(null, { status: 204 })
      }
      if (parts[2] === 'simulate' && method === 'POST') {
        if (fake.simBusy || fake.sims.some((s) => s.run.status === 'running')) return json(409, { error: 'busy' })
        const profiles = (data.profiles as AdminSimProfile[] | undefined) ?? ['casual', 'constant', 'marathoner']
        const seeds = (data.seeds as number | undefined) ?? 4
        const weeks = (data.weeks as number | undefined) ?? 4
        if (profiles.length * seeds * weeks > ADMIN_SIM_MAX_PLAYER_WEEKS) return json(400, { error: 'sim_too_big', max: ADMIN_SIM_MAX_PLAYER_WEEKS })
        const v = validateContentPatch(r.patch, { previous: activeRow()?.patch, smoke: false })
        if (!v.ok) return json(422, { error: 'validation_failed', errors: v.errors, warnings: v.warnings, requiresConfirm: v.requiresConfirm })
        const active = activeRow()
        const run: AdminSimRun = {
          id: fake.sims.length + 1,
          versionId: r.id,
          draftHash: `h${r.id}`,
          activeVersionId: active?.id ?? null,
          activeHash: active ? `h${active.id}` : 'base',
          status: 'running',
          params: { profiles, seeds, weeks },
          error: null,
          createdBy: { id: 'u1', trainerName: 'Admin' },
          createdAt: fake.now,
          finishedAt: null,
          progress: { done: 0, total: profiles.length * seeds * 2 },
          report: null,
        }
        fake.sims.push({ run, patchKey: JSON.stringify(r.patch) })
        return json(202, { run: { ...run }, serverNow: fake.now })
      }
      if (parts[2] === 'validate' && method === 'POST') {
        r.validation = toValidation(validateContentPatch(r.patch, { previous: activeRow()?.patch, smoke: { sessions: 20 } }), true, fake.now)
        return json(200, { validation: r.validation, diff: diffPatches(activeRow()?.patch ?? {}, r.patch), serverNow: fake.now })
      }
      if (parts[2] === 'publish' && method === 'POST') {
        const sudo = needSudo()
        if (sudo) return sudo
        const at = data.effectiveAt as number | undefined
        if (at !== undefined && (at <= fake.now || at > fake.now + MAX_SCHEDULE_MS)) return json(400, { error: 'invalid_effective_at' })
        const linkId = data.linkEventId as string | undefined
        if (linkId !== undefined && at !== undefined) return json(400, { error: 'invalid_body' })
        if (linkId !== undefined && !fake.events.some((e) => e.id === linkId)) return json(422, { error: 'unknown_event' })
        const ev = linkId ? fake.events.find((e) => e.id === linkId) : undefined
        if (ev && ev.status !== 'published') return json(409, { error: 'event_not_linkable', reason: 'not_published' })
        if (ev && ev.endsAt <= fake.now) return json(409, { error: 'event_not_linkable', reason: 'ended' })
        const blocked = gate(r, data.confirm as boolean | undefined)
        if (blocked) return blocked
        const when = ev ? Math.max(ev.startsAt, fake.now) : (at ?? fake.now)
        // What «go back» restores: the latest version in force at that moment that is not tied to this event.
        const before = ev && data.revertWhenEnds ? [...fake.rows.values()].filter((x) => x.status === 'published' && x.effectiveAt !== null && x.effectiveAt <= when && x.linkedEventId !== ev.id).sort((a, b) => a.effectiveAt! - b.effectiveAt! || a.id - b.id).at(-1) : undefined
        r.status = 'published'
        r.effectiveAt = when
        if (ev) {
          r.linkedEventId = ev.id
          r.linkedRole = 'start'
          if (data.revertWhenEnds) {
            const back = fake.seedPublished(before?.patch ?? {}, `Back after ${ev.slug}`)
            back.parentId = before?.id ?? null
            back.effectiveAt = ev.endsAt
            back.linkedEventId = ev.id
            back.linkedRole = 'end'
            back.revertOfVersionId = r.id
          }
        }
        if (typeof data.note === 'string' && data.note) r.note = data.note
        r.validation = toValidation(validateContentPatch(r.patch, { previous: activeRow()?.patch, smoke: { sessions: 20 } }), true, fake.now)
        return json(200, body(r))
      }
    }
    if (parts[0] === 'sim-runs' && parts.length === 1 && method === 'GET') {
      const vid = params.get('versionId')
      const items = fake.sims.filter((s) => !vid || s.run.versionId === Number(vid)).reverse()
      return json(200, { items: items.map(simSummary), busy: fake.simBusy || fake.sims.some((s) => s.run.status === 'running'), serverNow: fake.now })
    }
    if (parts[0] === 'sim-runs' && parts.length === 2 && method === 'GET') {
      const s = fake.sims.find((x) => x.run.id === Number(parts[1]))
      if (!s) return json(404, { error: 'not_found' })
      if (s.run.status === 'running' && fake.simAutoFinish) fake.finishSims()
      return json(200, { run: { ...s.run }, serverNow: fake.now })
    }
    if (parts[0] === 'spawn-preview' && method === 'GET') {
      const denied = needAdmin()
      if (denied) return denied
      const versionId = params.get('versionId')
      const row = versionId ? fake.rows.get(Number(versionId)) : activeRow()
      const patch = row?.patch ?? {}
      const ctx = createEngineContext(resolveContent(patch, [], {}))
      const q = { hour: Number(params.get('hour') ?? 12), weather: (params.get('weather') ?? 'clear') as AdminSpawnWeather, trainerLevel: Number(params.get('trainerLevel') ?? 1) }
      return json(200, { versionId: row?.id ?? null, hash: row ? `h${row.id}` : 'base', ...q, ...spawnPreview(ctx, q) })
    }
    return json(404, { error: 'not_found' })
  }

  // Assigned (not spied on) so it can sit on top of the fetch `installFakeServer()` already replaced.
  globalThis.fetch = vi.fn(handler) as unknown as typeof fetch
  return fake
}
