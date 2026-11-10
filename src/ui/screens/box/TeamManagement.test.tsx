/** Render smoke tests of nicknames, the swap comparison and the swap entry point (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { pokemonView } from '../../../engine'
import { makeMon, makePlayer, MIN, T0 } from '../../../engine/test-helpers'
import { MonTile, PokemonCard } from '../../components'
import { useGame } from '../../store/game'
import { Detail } from './Detail'
import { NicknameForm } from './Nickname'
import { SwapCompareView } from './SwapCompare'

const WIDE = 'WWWWWWWWWWWW' // 12 wide characters

const base = (slug: string, level: number, uid: string, patch = {}) => makeMon(slug, level, { uid, caughtAt: T0 - level * MIN, ...patch })

function load(teamSize: number, extra: Record<string, unknown> = {}, patch = {}) {
  const team = ['pikachu', 'squirtle', 'pidgey', 'gastly', 'magnemite', 'eevee'].slice(0, teamSize).map((s, i) => base(s, 10 + i, `t${i}`, i === 0 ? { nickname: 'Monito' } : {}))
  const bird = base('zubat', 9, 'bat', { nickname: WIDE })
  const player = makePlayer(team, { pokemon: Object.fromEntries([...team, bird].map((p) => [p.uid, p])), ...patch, ...extra })
  Object.assign(useGame.getInitialState(), { player })
  return player
}

describe('NicknameForm', () => {
  const props = { onDraft: () => {}, onSubmit: () => {}, onRemove: () => {}, onCancel: () => {}, speciesName: 'Pikachu' }
  for (const lng of ['es', 'en'] as const) {
    it(`shows the live counter and an error beyond 12 graphemes (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const ok = renderToStaticMarkup(<NicknameForm {...props} draft={WIDE} hasNickname />)
      expect(ok).toContain('12/12')
      expect(ok).not.toContain('aria-invalid')
      expect(ok).toContain(i18n.t('nick.remove'))
      const bad = renderToStaticMarkup(<NicknameForm {...props} draft={WIDE + 'W'} hasNickname={false} />)
      expect(bad).toContain('13/12')
      expect(bad).toContain('aria-invalid="true"')
      expect(bad).toContain(i18n.t('nick.error.nickname_too_long', { max: 12 }))
      expect(bad).toMatch(new RegExp(`<button[^>]* disabled=""[^>]*>${i18n.t('nick.save')}</button>`)) // save blocked
      expect(ok).not.toMatch(new RegExp(`<button[^>]* disabled=""[^>]*>${i18n.t('nick.save')}</button>`))
      expect(bad).not.toContain(i18n.t('nick.remove'))
      expect(bad).not.toMatch(/nick\.[a-z]/) // no raw i18n keys
    })
  }
  it('flags a newline as invalid', async () => {
    await i18n.changeLanguage('es')
    const html = renderToStaticMarkup(<NicknameForm {...props} draft={'a\nb'} hasNickname={false} />)
    expect(html).toContain(i18n.t('nick.error.nickname_invalid'))
  })
})

describe('nickname display', () => {
  it('MonTile and PokemonCard show the nickname, with the species in the tooltip / label', async () => {
    await i18n.changeLanguage('es')
    const p = load(2)
    const mon = p.pokemon.t0!
    const tile = renderToStaticMarkup(<MonTile mon={mon} teamSlot={0} />)
    expect(tile).toContain('>Monito<')
    expect(tile).toContain('aria-label="Monito (Pikachu)')
    expect(tile).toContain('title="Monito (Pikachu)"')
    expect(tile).toContain('truncate') // a long nickname never widens the tile
    const card = renderToStaticMarkup(<PokemonCard view={pokemonView(p, 't0', T0)!} />)
    expect(card).toContain('Monito')
    expect(card).toContain('alt="Monito (Pikachu)"')
    expect(card).toContain('truncate')
    const plain = renderToStaticMarkup(<MonTile mon={p.pokemon.t1!} teamSlot={1} />)
    expect(plain).toContain('>Squirtle<')
    expect(plain).not.toContain('title=')
  })
  it('a 12-wide nickname is kept whole in the data and truncated by CSS in the tile', async () => {
    await i18n.changeLanguage('en')
    const p = load(2)
    const html = renderToStaticMarkup(<MonTile mon={p.pokemon.bat!} teamSlot={null} />)
    expect(html).toContain(`>${WIDE}<`)
    expect(html).toMatch(/min-w-0 truncate[^"]*">W/)
  })
})

describe('SwapCompareView', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`compares both Pokemon side by side with marked differences (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const p = load(6)
      const incoming = pokemonView(p, 'bat', T0)!
      const outgoing = pokemonView(p, 't1', T0)!
      const html = renderToStaticMarkup(<SwapCompareView incoming={incoming} outgoing={outgoing} slot={1} />)
      expect(html).not.toMatch(/swapCmp\.|stats\.[a-z]/) // no raw keys
      expect(html).toContain(i18n.t('swapCmp.entering'))
      expect(html).toContain(i18n.t('swapCmp.leaving'))
      expect(html).toContain(WIDE) // the incoming nickname
      expect(html).toContain(lng === 'es' ? 'Squirtle' : 'Squirtle')
      for (const k of ['level', 'energyNow', 'types', 'role', 'ability', 'techniques']) expect(html).toContain(i18n.t(`swapCmp.${k}`))
      for (const k of ['speed', 'specialAttack', 'attack', 'specialDefense', 'defense']) expect(html).toContain(i18n.t(`stats.${k}.name`))
      // Zubat (Lv 9) is lower than Squirtle (Lv 11): worse on the left, better on the right, with a word for screen readers too.
      expect(html).toContain(i18n.t('swapCmp.lower'))
      expect(html).toContain(i18n.t('swapCmp.higher'))
      expect(html).toContain(i18n.t('swapCmp.differs'))
      expect(html).toContain(i18n.t('swapCmp.takesSlot', { name: WIDE, n: 2 }))
      expect(html).not.toContain(i18n.t('swapCmp.takesLeader', { name: WIDE }))
    })
  }
  it('says the leader slot goes to the incoming one', async () => {
    await i18n.changeLanguage('en')
    const p = load(6)
    const html = renderToStaticMarkup(<SwapCompareView incoming={pokemonView(p, 'bat', T0)!} outgoing={pokemonView(p, 't0', T0)!} slot={0} />)
    expect(html).toContain(i18n.t('swapCmp.takesLeader', { name: WIDE }))
  })
  it('shows the nickname with the species as secondary text on the outgoing side too', async () => {
    await i18n.changeLanguage('es')
    const p = load(6)
    const html = renderToStaticMarkup(<SwapCompareView incoming={pokemonView(p, 'bat', T0)!} outgoing={pokemonView(p, 't0', T0)!} slot={0} />)
    expect(html).toContain('Monito')
    expect(html).toContain('Pikachu')
    expect(html).toContain('Zubat')
    expect(html).toContain('[overflow-wrap:anywhere]') // long names wrap instead of breaking the card
  })
})

describe('Detail: put on the team / swap for…', () => {
  const render = (uid: string) => renderToStaticMarkup(<Detail uid={uid} />)
  for (const lng of ['es', 'en'] as const) {
    it(`offers "put on the team" when there is room and "swap for…" when the team is full (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load(3)
      const room = render('bat')
      expect(room).toContain(i18n.t('detail.addTeam'))
      expect(room).not.toContain(i18n.t('detail.swapTeam'))
      load(6)
      const full = render('bat')
      expect(full).toContain(i18n.t('detail.swapTeam'))
      // Enabled between sessions.
      expect(full).not.toMatch(new RegExp(`<button[^>]* disabled=""[^>]*>(?:(?!</button>)[\\s\\S])*${i18n.t('detail.swapTeam')}`))
      expect(full).not.toContain(`>${i18n.t('detail.addTeam')}<`)
      // The nickname is the page title, the species is secondary, and the nickname button is there.
      expect(full).toContain(`<h1 class="text-3xl text-ink [overflow-wrap:anywhere]">${WIDE}</h1>`)
      expect(full).toContain('Zubat')
      expect(full).toContain(i18n.t('nick.change'))
    })
    it(`blocks the swap and the team change during a session (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const p = load(6)
      const session = { id: 's1', startedAt: T0, plannedMinutes: 25, teamUids: p.team, startEnergy: {}, asleepUids: [], note: null, subjectTag: null, startHeals: [] }
      load(6, { activeSession: session })
      const html = render('bat')
      const label = i18n.t('detail.swapTeam')
      expect(html).toMatch(new RegExp(`<button[^>]* disabled=""[^>]*>(?:(?!</button>)[\\s\\S])*${label}`))
    })
  }
  it('a Pokemon without a nickname shows just the species and offers to set one', async () => {
    await i18n.changeLanguage('es')
    load(3)
    const html = render('t1')
    expect(html).toContain('<h1 class="text-3xl text-ink [overflow-wrap:anywhere]">Squirtle</h1>')
    expect(html).toContain(i18n.t('nick.add'))
  })
})
