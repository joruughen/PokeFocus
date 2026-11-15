/** Render smoke test of the Box picker on the Team screen (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { makeMon, makePlayer, MIN, T0 } from '../../../engine/test-helpers'
import { useGame } from '../../store/game'
import { BoxPicker } from './BoxPicker'
import { usePickFilters } from './pickFromBox'

/** Server rendering reads a zustand store's *initial* state, so patch that object in place. */
function patchStore<T extends object>(store: { getInitialState: () => T }, patch: Partial<T>) {
  Object.assign(store.getInitialState(), patch)
}

const mon = (slug: string, level: number, uid: string, patch = {}) => makeMon(slug, level, { uid, caughtAt: T0 - level * MIN, ...patch })

function load(teamSize: number) {
  const team = ['pikachu', 'squirtle', 'pidgey', 'gastly', 'magnemite', 'eevee'].slice(0, teamSize).map((s, i) => mon(s, 10 + i, `t${i}`))
  const box = [mon('bulbasaur', 14, 'grass'), mon('charmander', 12, 'fire'), mon('machop', 30, 'tired', { energy: { current: 0, updatedAt: T0 } }), mon('zubat', 9, 'sleepy', { asleepNextSession: true, asleepSetAt: T0 - MIN })]
  const player = makePlayer(team, { pokemon: Object.fromEntries([...team, ...box].map((p) => [p.uid, p])) })
  patchStore(useGame, { player })
}

const render = () => renderToStaticMarkup(<BoxPicker at={T0} disabled={false} onApply={async () => {}} />)

describe('BoxPicker', () => {
  beforeEach(() => patchStore(usePickFilters, { query: '', type: 'any', sort: 'now' }))

  for (const lng of ['es', 'en'] as const) {
    it(`lists the Box with types, state labels and Add buttons while there is room (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load(3)
      const html = render()
      expect(html).not.toMatch(/team\.(pick|swap)\./) // no raw i18n keys
      expect(html.slice(html.indexOf('<ul')).match(/<li /g)).toHaveLength(4)
      expect(html).toContain(i18n.t('team.pick.exhausted'))
      expect(html).toContain(i18n.t('team.pick.asleep'))
      expect(html).toContain(i18n.t('team.add'))
      // Bulbasaur is Grass and it is morning (T0 is 10:00 UTC): its boost shows next to the type.
      expect(html).toMatch(lng === 'es' ? /×1,\d\d/ : /×1\.\d\d/) // decimals follow the UI language
      expect(html).toContain(i18n.t('conditions.memberBoost', { type: lng === 'es' ? 'Planta' : 'Grass', mult: '1.10' }).slice(0, 20))
      expect(html).not.toContain(i18n.t('team.pick.swap'))
      // Unavailable ones go last: the ready one comes first.
      expect(html.indexOf('/sprites/icons/4.png')).toBeLessThan(html.indexOf('/sprites/icons/66.png'))
      expect(html.indexOf('/sprites/icons/1.png')).toBeLessThan(html.indexOf('/sprites/icons/4.png')) // boosted Grass before plain Fire
    })

    it(`offers Swap instead of Add when the team is full (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load(6)
      const html = render()
      expect(html).toContain(`>${i18n.t('team.pick.swap')}<`)
      expect(html).not.toContain(`>${i18n.t('team.add')}<`)
      expect(html).toContain(i18n.t('team.full'))
    })
  }

  it('shows the count and the empty state when the filters match nothing', async () => {
    await i18n.changeLanguage('es')
    load(2)
    patchStore(usePickFilters, { query: 'zzz' })
    const html = render()
    expect(html).toContain('0 de 4 Pokémon')
    expect(html).toContain(i18n.t('team.pick.noMatch'))
    expect(html).toContain(i18n.t('team.pick.clear'))
  })
})
