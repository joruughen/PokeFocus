/** Render smoke tests of the saved-teams panel and the quick switch on the home screen (server-side render). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { MAX_TEAM_PRESETS, releasePokemon, savePreset, type PlayerState } from '../../../engine'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import { presetRows } from './presets'
import { QuickTeamSwitchView, TeamPresetsView, type TeamPresetsViewProps } from './TeamPresets'

const WIDE_NAME = 'WWWWWWWWWWWWWWWWWWWW' // 20 wide characters

const mon = (slug: string, uid: string, patch = {}) => makeMon(slug, 10, { uid, ...patch })

function state(names: string[] = ['Estudio']): PlayerState {
  const all = [mon('pikachu', 'a', { nickname: 'Monito' }), mon('squirtle', 'b'), mon('pidgey', 'c')]
  let p = makePlayer([all[0]!, all[1]!], { pokemon: Object.fromEntries(all.map((m) => [m.uid, m])) })
  for (const [i, n] of names.entries()) {
    const r = savePreset({ ...p, team: i % 2 === 0 ? ['a', 'b'] : ['c', 'a'] }, n)
    if (!r.ok) throw new Error(r.error)
    p = { ...r.value.state, team: ['a', 'b'] }
  }
  return p
}

const noop = () => {}
const view = (over: Partial<TeamPresetsViewProps>): TeamPresetsViewProps => ({
  rows: [],
  canSwitch: true,
  busy: false,
  draft: '',
  onDraft: noop,
  onSave: noop,
  onApply: noop,
  onOverwrite: noop,
  onRename: noop,
  onDelete: noop,
  ...over,
})

describe('TeamPresetsView', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`lists saved teams with members (nicknames), the active one, and the count (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const p = state([WIDE_NAME, 'Tarde'])
      const html = renderToStaticMarkup(<TeamPresetsView {...view({ rows: presetRows(p) })} />)
      expect(html).not.toMatch(/presets\.[a-z]/) // no raw keys
      expect(html).toContain(WIDE_NAME)
      expect(html).toContain('Tarde')
      expect(html).toContain(`2/${MAX_TEAM_PRESETS}`)
      expect(html).toContain(i18n.t('presets.active')) // the first one equals the current team
      expect(html).toContain('title="Monito (Pikachu)"')
      expect(html).toContain('[overflow-wrap:anywhere]') // a 20-wide name wraps instead of widening the card
      for (const k of ['use', 'overwrite']) expect(html).toContain(i18n.t(`presets.${k}`))
      expect(html).toContain(i18n.t('presets.renameOf', { name: 'Tarde' }))
      expect(html).toContain(i18n.t('presets.deleteOf', { name: 'Tarde' }))
    })
    it(`shows the empty state and the counter of the name (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<TeamPresetsView {...view({ draft: 'Repaso' })} />)
      expect(html).toContain(i18n.t('presets.empty'))
      expect(html).toContain(i18n.t('presets.nameHint', { count: 6, max: 20 }))
      expect(html).not.toContain('aria-invalid')
    })
    it(`validates the name and blocks saving when too long, blank or at the limit (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const long = renderToStaticMarkup(<TeamPresetsView {...view({ draft: 'x'.repeat(21) })} />)
      expect(long).toContain('aria-invalid="true"')
      expect(long).toContain(i18n.t('presets.error.preset_name_too_long', { max: 20 }))
      const names = Array.from({ length: MAX_TEAM_PRESETS }, (_, i) => `T${i}`)
      const full = renderToStaticMarkup(<TeamPresetsView {...view({ rows: presetRows(state(names)), draft: 'otro' })} />)
      expect(full).toContain(i18n.t('presets.full', { max: MAX_TEAM_PRESETS }))
      expect(full).toMatch(/<button[^>]* disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]* disabled=""/)
    })
  }
  it('disables switching during a session and says why', async () => {
    await i18n.changeLanguage('es')
    const html = renderToStaticMarkup(<TeamPresetsView {...view({ rows: presetRows(state(['Uno', 'Dos'])), canSwitch: false })} />)
    expect(html).toContain(i18n.t('presets.locked'))
    const useBtn = new RegExp(`<button[^>]* disabled=""[^>]*>(?:(?!</button>)[\\s\\S])*${i18n.t('presets.use')}`)
    expect(html).toMatch(useBtn)
  })
  it('warns about released members and disables Use when none are left', async () => {
    await i18n.changeLanguage('es')
    let p = state(['Estudio'])
    const r = savePreset({ ...p, team: ['c'] }, 'Solo c')
    if (!r.ok) throw new Error(r.error)
    p = { ...r.value.state, team: ['a', 'b'] }
    const g = releasePokemon(p, 'c')
    if (!g.ok) throw new Error(g.error)
    const html = renderToStaticMarkup(<TeamPresetsView {...view({ rows: presetRows(g.value) })} />)
    expect(html).toContain(i18n.t('presets.allGone'))
  })
})

describe('QuickTeamSwitchView', () => {
  it('renders nothing without saved teams', () => {
    expect(renderToStaticMarkup(<QuickTeamSwitchView rows={[]} canSwitch busy={false} onApply={noop} />)).toBe('')
  })
  for (const lng of ['es', 'en'] as const) {
    it(`shows one chip per saved team, the active one pressed, and a link to manage them (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<QuickTeamSwitchView rows={presetRows(state([WIDE_NAME, 'Tarde']))} canSwitch busy={false} onApply={noop} />)
      expect(html).not.toMatch(/presets\.[a-z]/)
      expect(html.match(/<button/g)).toHaveLength(2)
      expect(html).toContain('aria-pressed="true"')
      expect(html).toContain('aria-pressed="false"')
      expect(html).toContain(i18n.t('presets.manage'))
      expect(html).toContain('href="#/team"')
      expect(html).toContain('max-w-full') // the chip never exceeds the screen
      expect(html).toContain('truncate')
    })
  }
  it('disables every chip during a session', async () => {
    await i18n.changeLanguage('es')
    const html = renderToStaticMarkup(<QuickTeamSwitchView rows={presetRows(state(['Uno', 'Dos']))} canSwitch={false} busy={false} onApply={noop} />)
    expect(html.match(/<button[^>]* disabled=""/g)).toHaveLength(2)
  })
})
