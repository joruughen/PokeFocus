/**
 * The publishing flow end to end against the in-memory admin API (src/ui/test/fakeAdminContent.ts, which runs the
 * real validation and diff): create a draft, edit it through the draft store, validate, publish (sudo, ×3 / ×5
 * confirmation, scheduling), roll back and preview spawns.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContentPatch } from '../../../../engine/content'
import { ApiError } from '../../../api'
import { installFakeServer, type FakeServer } from '../../../test/fakeServer'
import { installFakeAdminContent, type FakeAdminContent } from '../../../test/fakeAdminContent'
import { contentApi } from './api'
import { createDraftStore } from './draftStore'
import { eventsAdminApi } from '../events/api'
import { checkSchedule, classify, linkableEvents, linkedEffectiveAt, publishDraft, publishInput, reauthThen, rollbackTo, unscheduleVersion } from './flow'
import { liveValidate } from './live'
import { setConfigValue } from './patch'
import { previewRows } from './previewRows'

let server: FakeServer
let admin: FakeAdminContent

beforeEach(() => {
  server = installFakeServer()
  admin = installFakeAdminContent()
})
afterEach(() => {
  admin.restore()
  server.restore()
})

const NOW = Date.UTC(2026, 10, 10, 12)

describe('classify', () => {
  it('maps the API answers the screen handles apart from errors', () => {
    expect(classify(new ApiError(403, 'elevation_required'))).toEqual({ kind: 'elevation' })
    expect(classify(new ApiError(409, 'confirm_required', null, { error: 'confirm_required', warnings: [{ code: 'big_change', path: 'x', message: 'm' }] }))).toMatchObject({ kind: 'confirm', warnings: [{ code: 'big_change' }] })
    expect(classify(new ApiError(422, 'validation_failed', null, { errors: [{ code: 'e', path: 'p', message: 'm' }], warnings: [] }))).toMatchObject({ kind: 'invalid', errors: [{ code: 'e' }] })
    expect(classify(new ApiError(429, 'rate_limited', 30))).toEqual({ kind: 'error', code: 'rate_limited', retryAfter: 30 })
    expect(classify(new Error('boom'))).toEqual({ kind: 'error', code: 'network', retryAfter: null })
  })
})

describe('schedule input', () => {
  const local = (ts: number) => {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }
  it('accepts a time from a minute to 60 days ahead', () => {
    expect(checkSchedule(local(NOW + 3_600_000), NOW)).toMatchObject({ ok: true })
    expect(checkSchedule('', NOW)).toEqual({ ok: false, problem: 'invalid' })
    expect(checkSchedule(local(NOW - 3_600_000), NOW)).toEqual({ ok: false, problem: 'past' })
    expect(checkSchedule(local(NOW + 30_000), NOW)).toEqual({ ok: false, problem: 'past' })
    expect(checkSchedule(local(NOW + 61 * 86_400_000), NOW)).toEqual({ ok: false, problem: 'tooFar' })
  })

  it('builds the publish body: now has no effectiveAt, confirm and note only when set', () => {
    expect(publishInput({ mode: 'now' }, false, '  ')).toEqual({})
    expect(publishInput({ mode: 'later', at: 5 }, true, ' hi ')).toEqual({ effectiveAt: 5, confirm: true, note: 'hi' })
  })

  it('together with an event: the body carries the event (and the go-back box), never a time', () => {
    expect(publishInput({ mode: 'event', eventId: 'e1', revert: false }, false, '')).toEqual({ linkEventId: 'e1' })
    expect(publishInput({ mode: 'event', eventId: 'e1', revert: true }, true, 'x')).toEqual({ linkEventId: 'e1', revertWhenEnds: true, confirm: true, note: 'x' })
  })

  it('offers published events that have not ended, soonest first; a running one takes effect now', () => {
    const e = (id: string, status: string, startsAt: number, endsAt: number) => ({ id, status, startsAt, endsAt })
    const list = linkableEvents([e('later', 'published', NOW + 5, NOW + 9), e('draft', 'draft', NOW + 1, NOW + 9), e('over', 'published', NOW - 9, NOW - 1), e('running', 'published', NOW - 3, NOW + 3), e('gone', 'archived', NOW + 1, NOW + 9)], NOW)
    expect(list.map((x) => x.id)).toEqual(['running', 'later'])
    expect(linkedEffectiveAt(NOW - 3, NOW)).toBe(NOW)
    expect(linkedEffectiveAt(NOW + 5, NOW)).toBe(NOW + 5)
  })
})

describe('drafts', () => {
  it('creates a draft from the live version and edits it through the store, saved to the server', async () => {
    admin.seedPublished({ config: { encounters: { roamingSessions: 5 } } }, 'Wave 5')
    const created = await contentApi.createDraft({ from: 'active' })
    expect(created.version).toMatchObject({ status: 'draft', parentId: 1 })
    expect(created.version.patch.config?.encounters?.roamingSessions).toBe(5)

    const store = createDraftStore(created, { save: contentApi.saveDraft, debounceMs: 5 })
    store.edit((p) => setConfigValue(p, 'encounters.roamingSessions', 6))
    store.setTitle('Wave 6')
    expect(await store.flush()).toBe(true)
    expect(admin.rows.get(created.version.id)).toMatchObject({ title: 'Wave 6', patch: { config: { encounters: { roamingSessions: 6 } } } })
    // The server's diff against the live content comes back with the save.
    expect(store.getState().diff).toEqual([expect.objectContaining({ path: 'config.encounters.roamingSessions', kind: 'changed', before: 5, after: 6 })])
  })

  it('validation errors do not stop a save, and the live validator reports them by path', async () => {
    const created = await contentApi.createDraft({ from: 'empty' })
    const bad: ContentPatch = { config: { encounters: { shinyChance: 0.5 } } }
    const live = await liveValidate(bad)
    expect(live.errors.map((e) => e.path)).toContain('config.encounters.shinyChance')
    const res = await contentApi.saveDraft(created.version.id, { patch: bad })
    expect(res.version.validationDetail?.ok).toBe(false)
  })

  it('lists versions by status and deletes a draft', async () => {
    admin.seedPublished({}, 'A')
    const d = await contentApi.createDraft({ from: 'empty' })
    expect((await contentApi.versions('draft')).items.map((v) => v.id)).toEqual([d.version.id])
    expect((await contentApi.versions()).items).toHaveLength(2)
    await contentApi.deleteDraft(d.version.id)
    expect((await contentApi.versions('draft')).items).toEqual([])
    const live = await contentApi.live()
    expect(live.active?.id).toBe(1)
    expect(live.scheduled).toBeNull()
  })

  it('stops at 20 open drafts', async () => {
    for (let i = 0; i < 20; i++) admin.seedDraft({})
    await expect(contentApi.createDraft({ from: 'empty' })).rejects.toMatchObject({ code: 'too_many_drafts' })
  })

  it('full validation runs the smoke test', async () => {
    const d = await contentApi.createDraft({ from: 'empty' })
    const r = await contentApi.validate(d.version.id)
    expect(r.validation).toMatchObject({ ok: true, smoke: true })
  })
})

describe('publishing', () => {
  const draftWith = async (patch: ContentPatch) => (await contentApi.createDraft({ from: 'empty' }).then((r) => contentApi.saveDraft(r.version.id, { patch }))).version

  it('asks for the sudo password first, then publishes', async () => {
    const d = await draftWith({ config: { encounters: { roamingSessions: 5 } } })
    expect(await publishDraft(d.id, {})).toEqual({ kind: 'elevation' })

    expect(await reauthThen('wrong', () => publishDraft(d.id, {}))).toMatchObject({ kind: 'error', code: 'wrong_password' })
    expect(admin.rows.get(d.id)?.status).toBe('draft')

    const ok = await reauthThen('correct horse', () => publishDraft(d.id, {}))
    expect(ok).toMatchObject({ kind: 'ok', value: { id: d.id, status: 'published', active: true } })
    expect((await contentApi.live()).active?.id).toBe(d.id)
    // Already published: a second publish is refused.
    expect(await publishDraft(d.id, {})).toMatchObject({ kind: 'error', code: 'not_draft' })
  })

  it('a change beyond ×3 needs the confirmation; ×5 for probabilities', async () => {
    admin.elevated = true
    const d = await draftWith({ config: { rewards: { expPerMinute: 100 }, encounters: { shinyChance: 0.02 } } })
    const first = await publishDraft(d.id, {})
    expect(first.kind).toBe('confirm')
    if (first.kind !== 'confirm') return
    expect(first.warnings.map((w) => [w.path, w.params?.factor])).toEqual(
      expect.arrayContaining([
        ['config.rewards.expPerMinute', 3],
        ['config.encounters.shinyChance', 5],
      ]),
    )
    expect(admin.rows.get(d.id)?.status).toBe('draft')
    expect(await publishDraft(d.id, { confirm: true })).toMatchObject({ kind: 'ok' })
  })

  it('validation errors block publishing with the list', async () => {
    admin.elevated = true
    const d = await draftWith({ config: { encounters: { shinyChance: 0.9 } } })
    const out = await publishDraft(d.id, { confirm: true })
    expect(out.kind).toBe('invalid')
    if (out.kind === 'invalid') expect(out.errors.some((e) => e.path === 'config.encounters.shinyChance')).toBe(true)
  })

  it('schedules for later: the draft becomes a scheduled version and the live one stays', async () => {
    admin.elevated = true
    const base = admin.seedPublished({ config: { encounters: { roamingSessions: 5 } } })
    const d = await draftWith({ config: { encounters: { roamingSessions: 6 } } })
    const out = await publishDraft(d.id, publishInput({ mode: 'later', at: NOW + 86_400_000 }, false, 'Monday'))
    expect(out).toMatchObject({ kind: 'ok', value: { scheduled: true, active: false, note: 'Monday' } })
    const live = await contentApi.live()
    expect(live.active?.id).toBe(base.id)
    expect(live.scheduled?.id).toBe(d.id)
    // Out of the 60-day window the server says no.
    const d2 = await draftWith({ config: { encounters: { roamingSessions: 7 } } })
    expect(await publishDraft(d2.id, { effectiveAt: NOW + 70 * 86_400_000 })).toMatchObject({ kind: 'error', code: 'invalid_effective_at' })
  })

  it('rolls back: an old version becomes a new published one; a scheduled or draft one cannot', async () => {
    admin.elevated = true
    const v1 = admin.seedPublished({ config: { encounters: { roamingSessions: 5 } } }, 'v1')
    v1.effectiveAt = NOW - 2 * 86_400_000
    const v2 = admin.seedPublished({ config: { encounters: { roamingSessions: 6 } } }, 'v2')
    expect((await contentApi.live()).active?.id).toBe(v2.id)

    const out = await rollbackTo(v1.id)
    expect(out).toMatchObject({ kind: 'ok', value: { status: 'published', active: true, parentId: v1.id, patch: { config: { encounters: { roamingSessions: 5 } } } } })
    expect((await contentApi.live()).active?.id).not.toBe(v2.id)

    const draft = admin.seedDraft({})
    expect(await rollbackTo(draft.id)).toMatchObject({ kind: 'error', code: 'not_published' })

    admin.elevated = false
    expect(await rollbackTo(v1.id)).toEqual({ kind: 'elevation' })
  })

  it('support can read but not edit or publish', async () => {
    admin.role = 'support'
    admin.seedPublished({})
    expect((await contentApi.live()).active).not.toBeNull()
    expect((await contentApi.versions()).items).toHaveLength(1)
    await expect(contentApi.createDraft({ from: 'empty' })).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    await expect(contentApi.spawnPreview({ hour: 12, weather: 'clear', trainerLevel: 5 })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('publishing together with an event', () => {
  const draftWith = async (patch: ContentPatch) => (await contentApi.createDraft({ from: 'empty' }).then((r) => contentApi.saveDraft(r.version.id, { patch }))).version
  const wave = (n: number): ContentPatch => ({ config: { encounters: { roamingSessions: n } } })

  it('the dialog reads the events from the events API, and the version is tied to the chosen one', async () => {
    admin.elevated = true
    const ev = admin.seedEvent({ slug: 'spring', name: { es: 'Primavera', en: 'Spring' }, startsAt: NOW + 3_600_000, endsAt: NOW + 86_400_000 })
    admin.seedEvent({ slug: 'hidden', startsAt: NOW + 3_600_000, endsAt: NOW + 86_400_000, status: 'draft' })
    expect((await eventsAdminApi.list('published')).items.map((e) => e.slug)).toEqual(['spring'])
    const d = await draftWith(wave(6))
    const out = await publishDraft(d.id, publishInput({ mode: 'event', eventId: ev.id, revert: false }, false, ''))
    expect(out).toMatchObject({ kind: 'ok', value: { status: 'published', scheduled: true, active: false, effectiveAt: ev.startsAt, linkedRole: 'start', linkedEvent: { id: ev.id, slug: 'spring' } } })
    expect(admin.calls.at(-1)).toMatchObject({ method: 'POST', body: { linkEventId: ev.id } })
    expect((await contentApi.live()).scheduled).toMatchObject({ id: d.id, linkedEvent: { slug: 'spring' } })
    // The version list says which event it goes with.
    expect((await contentApi.versions()).items.find((v) => v.id === d.id)?.linkedEvent?.name.es).toBe('Primavera')
  })

  it('an event that already started: in force now', async () => {
    admin.elevated = true
    const ev = admin.seedEvent({ slug: 'now', startsAt: NOW - 3_600_000, endsAt: NOW + 86_400_000 })
    const d = await draftWith(wave(6))
    expect(await publishDraft(d.id, { linkEventId: ev.id })).toMatchObject({ kind: 'ok', value: { active: true, scheduled: false, effectiveAt: NOW } })
  })

  it('go back when it ends: a scheduled copy of what was in force, flagged when another version comes in between, cancelled with the start version', async () => {
    admin.elevated = true
    const before = admin.seedPublished(wave(5), 'before')
    const ev = admin.seedEvent({ slug: 'spring', startsAt: NOW + 3_600_000, endsAt: NOW + 86_400_000 })
    const d = await draftWith(wave(6))
    const out = await publishDraft(d.id, publishInput({ mode: 'event', eventId: ev.id, revert: true }, false, ''))
    expect(out.kind).toBe('ok')
    const back = [...admin.rows.values()].find((r) => r.linkedRole === 'end')!
    expect(back).toMatchObject({ status: 'published', effectiveAt: ev.endsAt, revertOfVersionId: d.id, patch: wave(5), parentId: before.id })
    const items = () => contentApi.versions().then((r) => r.items)
    expect((await items()).find((v) => v.id === back.id)).toMatchObject({ scheduled: true, linkedRole: 'end', revertOfVersionId: d.id, revertStale: false })
    // Another version published by hand in the middle of the event: the copy would override it.
    const mid = admin.seedPublished(wave(8), 'mid')
    mid.effectiveAt = NOW + 5 * 3_600_000
    expect((await items()).find((v) => v.id === back.id)?.revertStale).toBe(true)
    mid.status = 'draft'
    mid.effectiveAt = null
    // Cancelling the start version takes the copy with it; both go back to drafts, unlinked.
    expect(await unscheduleVersion(d.id)).toMatchObject({ kind: 'ok', value: { status: 'draft', linkedEvent: null } })
    expect(admin.rows.get(back.id)).toMatchObject({ status: 'draft', linkedEventId: null })
  })

  it('refuses an archived or ended event and an unknown one; needs the sudo password and the ×3 confirmation like any publish', async () => {
    const gone = admin.seedEvent({ slug: 'gone', startsAt: NOW + 3_600_000, endsAt: NOW + 86_400_000, status: 'archived' })
    const over = admin.seedEvent({ slug: 'over', startsAt: NOW - 86_400_000, endsAt: NOW - 3_600_000 })
    const live = admin.seedEvent({ slug: 'live', startsAt: NOW + 3_600_000, endsAt: NOW + 86_400_000 })
    const d = await draftWith(wave(6))
    expect(await publishDraft(d.id, { linkEventId: live.id })).toEqual({ kind: 'elevation' })
    admin.elevated = true
    expect(await publishDraft(d.id, { linkEventId: gone.id })).toMatchObject({ kind: 'error', code: 'event_not_linkable' })
    expect(await publishDraft(d.id, { linkEventId: over.id })).toMatchObject({ kind: 'error', code: 'event_not_linkable' })
    expect(await publishDraft(d.id, { linkEventId: '00000000-0000-4000-8000-0000000000ff' })).toMatchObject({ kind: 'error', code: 'unknown_event' })
    expect(admin.rows.get(d.id)?.status).toBe('draft')
    const big = await draftWith({ config: { rewards: { expPerMinute: 100 } } })
    expect((await publishDraft(big.id, { linkEventId: live.id })).kind).toBe('confirm')
    expect(await publishDraft(big.id, { linkEventId: live.id, confirm: true })).toMatchObject({ kind: 'ok' })
  })

  it('support cannot publish tied to an event', async () => {
    admin.role = 'support'
    const ev = admin.seedEvent({ slug: 'spring', startsAt: NOW + 3_600_000, endsAt: NOW + 86_400_000 })
    const d = admin.seedDraft(wave(6))
    expect(await publishDraft(d.id, { linkEventId: ev.id })).toMatchObject({ kind: 'error', code: 'forbidden' })
  })
})

describe('spawn preview', () => {
  it('compares the live content with the draft', async () => {
    admin.seedPublished({})
    const d = await contentApi.createDraft({ from: 'empty' })
    await contentApi.saveDraft(d.version.id, { patch: { species: { pikachu: { spawn: { weightMult: 8 } } } } })
    const q = { hour: 12, weather: 'clear' as const, trainerLevel: 20 }
    const [live, draft] = await Promise.all([contentApi.spawnPreview(q), contentApi.spawnPreview({ ...q, versionId: d.version.id })])
    const rows = previewRows(live, draft)
    const pika = rows.find((r) => r.slug === 'pikachu')!
    expect(pika.draft).toBeGreaterThan(pika.live)
    expect(pika.delta).toBeCloseTo(pika.draft - pika.live)
    expect(live.count).toBe(live.species.length)
  })
})

describe('layering', () => {
  it('other paths still reach the game fake server', async () => {
    const res = await fetch('/api/config')
    expect(res.status).toBe(200)
    expect(server.calls.some((c) => c.path === '/api/config')).toBe(true)
  })
})
