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
import { checkSchedule, classify, publishDraft, publishInput, reauthThen, rollbackTo } from './flow'
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
})

describe('drafts', () => {
  it('creates a draft from the live version and edits it through the store, saved to the server', async () => {
    admin.seedPublished({ config: { encounters: { baseWaveSize: 5 } } }, 'Wave 5')
    const created = await contentApi.createDraft({ from: 'active' })
    expect(created.version).toMatchObject({ status: 'draft', parentId: 1 })
    expect(created.version.patch.config?.encounters?.baseWaveSize).toBe(5)

    const store = createDraftStore(created, { save: contentApi.saveDraft, debounceMs: 5 })
    store.edit((p) => setConfigValue(p, 'encounters.baseWaveSize', 6))
    store.setTitle('Wave 6')
    expect(await store.flush()).toBe(true)
    expect(admin.rows.get(created.version.id)).toMatchObject({ title: 'Wave 6', patch: { config: { encounters: { baseWaveSize: 6 } } } })
    // The server's diff against the live content comes back with the save.
    expect(store.getState().diff).toEqual([expect.objectContaining({ path: 'config.encounters.baseWaveSize', kind: 'changed', before: 5, after: 6 })])
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
    const d = await draftWith({ config: { encounters: { baseWaveSize: 5 } } })
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
    const base = admin.seedPublished({ config: { encounters: { baseWaveSize: 5 } } })
    const d = await draftWith({ config: { encounters: { baseWaveSize: 6 } } })
    const out = await publishDraft(d.id, publishInput({ mode: 'later', at: NOW + 86_400_000 }, false, 'Monday'))
    expect(out).toMatchObject({ kind: 'ok', value: { scheduled: true, active: false, note: 'Monday' } })
    const live = await contentApi.live()
    expect(live.active?.id).toBe(base.id)
    expect(live.scheduled?.id).toBe(d.id)
    // Out of the 60-day window the server says no.
    const d2 = await draftWith({ config: { encounters: { baseWaveSize: 7 } } })
    expect(await publishDraft(d2.id, { effectiveAt: NOW + 70 * 86_400_000 })).toMatchObject({ kind: 'error', code: 'invalid_effective_at' })
  })

  it('rolls back: an old version becomes a new published one; a scheduled or draft one cannot', async () => {
    admin.elevated = true
    const v1 = admin.seedPublished({ config: { encounters: { baseWaveSize: 5 } } }, 'v1')
    v1.effectiveAt = NOW - 2 * 86_400_000
    const v2 = admin.seedPublished({ config: { encounters: { baseWaveSize: 6 } } }, 'v2')
    expect((await contentApi.live()).active?.id).toBe(v2.id)

    const out = await rollbackTo(v1.id)
    expect(out).toMatchObject({ kind: 'ok', value: { status: 'published', active: true, parentId: v1.id, patch: { config: { encounters: { baseWaveSize: 5 } } } } })
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
