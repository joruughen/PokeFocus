/** Pending captures (Box full, GDD §12.9): pure helpers and render smoke tests (server-side render, ES and EN, no raw keys). */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { boxCapacity, type OwnedPokemon, type PlayerState } from '../../../engine'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import i18n from '../../../i18n'
import { useGame } from '../../store/game'
import { PendingBanner, PendingCaptureBody } from './PendingCaptureDialog'
import { boxHasRoom, candyOf, riskOf, swapCandidates, usePendingUi } from './pendingCapture'

const lead = makeMon('pidgey', 5, { uid: 'lead' })
const boxed: OwnedPokemon[] = [
  makeMon('caterpie', 3, { uid: 'weak' }),
  makeMon('charmeleon', 20, { uid: 'nick', nickname: 'Fuego' }),
  makeMon('squirtle', 30, { uid: 'shiny', isShiny: true }),
  makeMon('mewtwo', 10, { uid: 'legend' }),
]
const capture = makeMon('charmander', 8, { uid: 'cap' })

/** A player whose Box is exactly full (filler Pokémon) so only a swap or a conversion is possible. */
function fullPlayer(pending: OwnedPokemon[] = [capture]): PlayerState {
  const base = makePlayer([lead])
  const pokemon: Record<string, OwnedPokemon> = { lead }
  for (const m of boxed) pokemon[m.uid] = m
  const cap = boxCapacity(base.trainer.level)
  for (let i = Object.keys(pokemon).length; i < cap; i++) pokemon[`f${i}`] = makeMon('pidgey', 4, { uid: `f${i}` })
  return { ...base, pokemon, team: ['lead'], pendingCaptures: pending }
}
const roomy = (): PlayerState => ({ ...makePlayer([lead]), pendingCaptures: [capture] })

const noop = async () => null
const RAW_KEY = /box\.pending\.|\{\{/

describe('pending capture helpers', () => {
  it('swap candidates never include the team, nor the pending capture', () => {
    const p = fullPlayer()
    const uids = swapCandidates(p, '', 'weakest', 'es').map((m) => m.uid)
    expect(uids).not.toContain('lead')
    expect(uids).not.toContain('cap')
    expect(uids).toContain('weak')
    expect(uids.length).toBe(Object.keys(p.pokemon).length - 1)
  })
  it('weakest sort starts with the lowest level; search filters by name or nickname', () => {
    const p = fullPlayer()
    expect(swapCandidates(p, '', 'weakest', 'es')[0]!.level).toBeLessThanOrEqual(4)
    expect(swapCandidates(p, 'fuego', 'weakest', 'es').map((m) => m.uid)).toEqual(['nick'])
  })
  it('flags what needs an extra confirmation', () => {
    const p = fullPlayer()
    expect(riskOf(p, p.pokemon.weak!)).toEqual([])
    expect(riskOf(p, p.pokemon.nick!)).toContain('nickname')
    expect(riskOf(p, p.pokemon.shiny!)).toEqual(expect.arrayContaining(['shiny', 'highLevel']))
    expect(riskOf(p, p.pokemon.legend!)).toContain('legendary')
  })
  it('candy gain and room', () => {
    expect(candyOf('charmander').gain).toBeGreaterThan(0)
    expect(boxHasRoom(fullPlayer())).toBe(false)
    expect(boxHasRoom(roomy())).toBe(true)
  })
})

for (const lng of ['es', 'en'] as const) {
  describe(`pending capture window (${lng})`, () => {
    beforeEach(async () => {
      await i18n.changeLanguage(lng)
    })

    it('shows the capture, the "N of M" counter, the swap list, convert and decide later', () => {
      const p = fullPlayer([capture, makeMon('squirtle', 5, { uid: 'c2' })])
      const html = renderToStaticMarkup(<PendingCaptureBody player={p} capture={capture} position={{ index: 1, total: 2 }} busy={false} onResolve={noop} />)
      expect(html).toContain(i18n.t('box.pending.position', { index: 1, total: 2 }))
      expect(html).toContain(i18n.t('box.pending.swapTitle'))
      expect(html).toContain(i18n.t('box.pending.later'))
      expect(html).toContain(i18n.t('box.pending.convert', { count: candyOf('charmander').gain }))
      expect(html).toContain('role="radiogroup"')
      expect(html).not.toContain('role="radio" aria-checked="true"')
      expect(html).toContain('Fuego')
      expect(html).not.toMatch(RAW_KEY)
    })

    it('no counter with a single capture; Swap is disabled until someone is picked', () => {
      const html = renderToStaticMarkup(<PendingCaptureBody player={fullPlayer()} capture={capture} busy={false} onResolve={noop} />)
      expect(html).not.toContain(i18n.t('box.pending.position', { index: 1, total: 1 }))
      expect(html).toMatch(new RegExp(`<button[^>]* disabled=""[^>]*>[^]*?${i18n.t('box.pending.swap')}`))
      expect(html).toContain(i18n.t('box.pending.pickOne'))
    })

    it('"Keep" only exists when the Box has room', () => {
      const full = renderToStaticMarkup(<PendingCaptureBody player={fullPlayer()} capture={capture} busy={false} onResolve={noop} />)
      expect(full).not.toContain(i18n.t('box.pending.keepTitle'))
      expect(full).toContain(i18n.t('box.pending.fullNote', { count: Object.keys(fullPlayer().pokemon).length, max: boxCapacity(1) }))
      const room = renderToStaticMarkup(<PendingCaptureBody player={roomy()} capture={capture} busy={false} onResolve={noop} />)
      expect(room).toContain(i18n.t('box.pending.keepTitle'))
      expect(room).toContain(`>${i18n.t('box.pending.keep')}<`)
    })

    it('a picked row is checked and previews the swap; a risky one asks for a second confirmation', () => {
      const p = fullPlayer()
      const picked = renderToStaticMarkup(<PendingCaptureBody player={p} capture={capture} busy={false} onResolve={noop} initial={{ picked: 'weak' }} />)
      expect(picked).toContain('aria-checked="true"')
      expect(picked).not.toContain(i18n.t('box.pending.pickOne'))
      const confirm = renderToStaticMarkup(<PendingCaptureBody player={p} capture={capture} busy={false} onResolve={noop} initial={{ picked: 'shiny', confirming: 'swap' }} />)
      expect(confirm).toContain(i18n.t('box.pending.confirmTitle'))
      expect(confirm).toContain(i18n.t('box.pending.risk.shiny'))
      expect(confirm).toContain(i18n.t('box.pending.risk.highLevel', { level: 30 }))
      expect(confirm).toContain(i18n.t('box.pending.irreversible').replace(/'/g, '&#x27;'))
      expect(confirm).not.toMatch(RAW_KEY)
    })

    it('converting a shiny capture asks first and names the line', () => {
      const shinyCap = makeMon('charmander', 8, { uid: 'cap', isShiny: true })
      const html = renderToStaticMarkup(<PendingCaptureBody player={{ ...fullPlayer([shinyCap]) }} capture={shinyCap} busy={false} onResolve={noop} initial={{ confirming: 'convert' }} />)
      expect(html).toContain(i18n.t('box.pending.risk.shiny'))
      expect(html).toContain(i18n.t('box.pending.confirmConvertBtn'))
      expect(html).not.toMatch(RAW_KEY)
    })

    it('banner: nothing without pending captures, count and Decide with them', () => {
      Object.assign(useGame.getInitialState(), { player: { ...fullPlayer(), pendingCaptures: undefined } })
      expect(renderToStaticMarkup(<PendingBanner />)).toBe('')
      Object.assign(useGame.getInitialState(), { player: fullPlayer([capture, makeMon('squirtle', 5, { uid: 'c2' })]) })
      const html = renderToStaticMarkup(<PendingBanner />)
      expect(html).toContain(i18n.t('box.pending.banner', { count: 2 }))
      expect(html).toContain(i18n.t('box.pending.decide'))
      expect(html).not.toMatch(RAW_KEY)
    })
  })
}

describe('pending window store', () => {
  it('opens and closes', () => {
    usePendingUi.getState().setOpen(true)
    expect(usePendingUi.getState().open).toBe(true)
    usePendingUi.getState().setOpen(false)
    expect(usePendingUi.getState().open).toBe(false)
  })
})
