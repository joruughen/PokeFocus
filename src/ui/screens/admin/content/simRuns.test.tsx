/** Simulation sub-tab (delivery E10): the comparison rows, the copy in both languages, and the calls against the in-memory admin API. */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../../../i18n'
import { ADMIN_SIM_PROFILES } from '../../../../game/protocol'
import { ApiError } from '../../../api'
import { installFakeServer, type FakeServer } from '../../../test/fakeServer'
import { fakeSimReport, installFakeAdminContent, type FakeAdminContent } from '../../../test/fakeAdminContent'
import { contentApi } from './api'
import { setConfigValue } from './patch'
import { SIM_METRICS, SimRuns, simRows } from './SimRuns'

const RAW = /\badmin\.(content|config|tabs)\./

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

describe('simRows', () => {
  it('pairs active and draft per profile and figure, with the relative change', () => {
    const report = fakeSimReport({ profiles: ['constant', 'casual'], seeds: 2, weeks: 2 }, null, 3)
    const rows = simRows(report)
    expect(rows).toHaveLength(2 * SIM_METRICS.length)
    const pts = rows.find((r) => r.profile === 'casual' && r.metric === 'weeklyPoints')!
    expect(pts.active).toBe(10000)
    expect(pts.change).toBeCloseTo(0.1)
    expect(rows.find((r) => r.metric === 'master')!.change).toBe(0) // 0 → 0
    expect(rows.find((r) => r.metric === 'catches')!.change).toBe(0)
  })
})

describe('copy', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`renders the form and every label without raw keys (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<SimRuns draftId={1} />)
      expect(html).not.toMatch(RAW)
      expect(html).toContain(i18n.t('admin.content.sim.run'))
      for (const p of ADMIN_SIM_PROFILES) expect(i18n.exists(`admin.content.sim.profile.${p}`), p).toBe(true)
      for (const m of SIM_METRICS) expect(i18n.exists(`admin.content.sim.m.${m.key}`), m.key).toBe(true)
      for (const s of ['running', 'done', 'failed', 'timeout', 'interrupted']) expect(i18n.exists(`admin.content.sim.status.${s}`), s).toBe(true)
      for (const e of ['busy', 'sim_too_big', 'validation_failed']) expect(i18n.exists(`admin.content.sim.error.${e}`), e).toBe(true)
      expect(i18n.exists('admin.content.publish.noSim')).toBe(true)
      expect(i18n.exists('admin.content.sections.sim')).toBe(true)
    })
  }
})

describe('simulation calls (fake admin API)', () => {
  it('simulate → running → done; the draft then counts as simulated until its patch changes', async () => {
    admin.seedPublished({})
    const d = admin.seedDraft(setConfigValue({}, 'encounters.shinyChance', 0.003))
    expect((await contentApi.version(d.id)).sim).toEqual({ recent: false, last: null })
    admin.simAutoFinish = false
    const started = await contentApi.simulate(d.id, { profiles: ['constant'], seeds: 2, weeks: 2 })
    expect(started.run).toMatchObject({ status: 'running', params: { profiles: ['constant'], seeds: 2, weeks: 2 } })
    expect((await contentApi.simRuns(d.id)).busy).toBe(true)
    await expect(contentApi.simulate(d.id)).rejects.toMatchObject({ code: 'busy' })
    admin.finishSims()
    const done = await contentApi.simRun(started.run.id)
    expect(done.run.status).toBe('done')
    expect(simRows(done.run.report!).length).toBe(SIM_METRICS.length)
    expect((await contentApi.version(d.id)).sim?.recent).toBe(true)
    await contentApi.saveDraft(d.id, { patch: setConfigValue({}, 'encounters.shinyChance', 0.0025) })
    expect((await contentApi.version(d.id)).sim?.recent).toBe(false)
  })

  it('refuses a run beyond the cost cap', async () => {
    const d = admin.seedDraft({})
    const e = await contentApi.simulate(d.id, { profiles: [...ADMIN_SIM_PROFILES], seeds: 20, weeks: 8 }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect((e as ApiError).code).toBe('sim_too_big')
  })
})
