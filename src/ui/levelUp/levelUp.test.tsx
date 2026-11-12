/** The trainer level-up window: when it shows (pure), how it merges notices, what it remembers, and its markup (ES + EN). */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import type { PendingLevelUp } from '../../engine'
import { EMPTY_DOC } from '../../game/protocol'
import { decideEventPopup } from '../screens/events/popup'
import { useGame } from '../store/game'
import { LevelUpBody } from './LevelUpDialog'
import { decideLevelUp, levelUpKey, mergeLevelUps, type LevelUpContext } from './levelUp'
import { markLevelUpsDismissed, owedLevelUps, resetLevelUpDismissedForTests } from './owed'

const RAW_KEY = /\b(levelUp|items|results)\.[a-zA-Z]+\b(?![^<]*>)/

const up = (from: number, to: number, over: Partial<PendingLevelUp> = {}): PendingLevelUp => ({
  from,
  to,
  items: { 'poke-ball': 3 * (to - from) },
  dust: 60 * (to - from),
  at: 1000 + from,
  ...over,
})

const calm = (over: Partial<LevelUpContext> = {}): LevelUpContext => ({
  pending: [up(1, 2)],
  phase: 'idle',
  hintOpen: false,
  otherDialogOpen: false,
  whatsNewPending: false,
  ...over,
})

describe('mergeLevelUps', () => {
  it('nothing owed: null', () => {
    expect(mergeLevelUps(undefined)).toBeNull()
    expect(mergeLevelUps([])).toBeNull()
  })

  it('several notices make one: first from, last to, items and Dust summed', () => {
    const m = mergeLevelUps([up(1, 2, { items: { 'poke-ball': 3 }, dust: 70 }), up(2, 5, { items: { 'poke-ball': 9, potion: 1 }, dust: 400 })])
    expect(m).toEqual({ from: 1, to: 5, items: { 'poke-ball': 12, potion: 1 }, dust: 470 })
  })
})

describe('decideLevelUp', () => {
  it('nothing owed: none', () => {
    expect(decideLevelUp(calm({ pending: [] }))).toBe('none')
  })

  it('shows when the player is calm (idle or looking at the results)', () => {
    expect(decideLevelUp(calm())).toBe('show')
    expect(decideLevelUp(calm({ phase: 'results' }))).toBe('show')
  })

  it('waits during a session, the waves or a break', () => {
    for (const phase of ['focus', 'paused', 'claim', 'late', 'waves', 'break']) expect(decideLevelUp(calm({ phase })), phase).toBe('wait')
  })

  it("waits over a hint, another dialog or «What's new?»", () => {
    expect(decideLevelUp(calm({ hintOpen: true }))).toBe('wait')
    expect(decideLevelUp(calm({ otherDialogOpen: true }))).toBe('wait')
    expect(decideLevelUp(calm({ whatsNewPending: true }))).toBe('wait')
  })

  it('the event window waits for the level-up window, and goes after it', () => {
    const base = { pending: [], phase: 'idle', hintOpen: false, otherDialogOpen: false, whatsNewPending: false, onEvents: false } as const
    const ev = { event: { id: 'e1' }, phase: 'active', key: 'e1#0#a' } as never
    expect(decideEventPopup({ ...base, pending: [ev], levelUpPending: true })).toEqual({ kind: 'wait' })
    expect(decideEventPopup({ ...base, pending: [ev], levelUpPending: false }).kind).toBe('show')
    expect(decideEventPopup({ ...base, pending: [ev] }).kind).toBe('show')
  })
})

describe('what this device already closed', () => {
  afterEach(() => {
    resetLevelUpDismissedForTests()
    useGame.setState({ ...EMPTY_DOC })
  })

  it('a dismissed notice is no longer owed while the ack is in flight; a new one is', () => {
    const a = up(1, 2)
    const b = up(2, 3)
    useGame.setState({ player: { pendingLevelUps: [a, b] } as never })
    expect(owedLevelUps()).toEqual([a, b])
    markLevelUpsDismissed([a])
    expect(owedLevelUps()).toEqual([b])
    expect(levelUpKey(a)).not.toBe(levelUpKey(b))
    useGame.setState({ player: { pendingLevelUps: undefined } as never })
    expect(owedLevelUps()).toEqual([])
    useGame.setState({ player: null })
    expect(owedLevelUps()).toEqual([])
  })
})

describe('LevelUpBody', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`one level: mascot, the level, Dust and every item with sprite and name (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<LevelUpBody pending={[up(4, 5, { items: { 'poke-ball': 3, 'great-ball': 3, potion: 1 }, dust: 100 })]} />)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain('/art/mascot-cheer.svg')
      expect(html).toContain(lng === 'es' ? 'Subiste al nivel 5' : 'You reached level 5')
      expect(html).toContain(lng === 'es' ? 'Polvo de Estudio' : 'Study Dust')
      expect(html).toContain('+100')
      for (const slug of ['poke-ball', 'great-ball', 'potion']) expect(html).toContain(`/sprites/items/${slug}.png`)
      expect(html).toContain(lng === 'es' ? 'Super Ball' : 'Great Ball')
      expect(html).toContain(lng === 'es' ? 'Poción' : 'Potion')
      expect(html).toContain('×3')
      expect(html).toContain('×1')
    })

    it(`several level-ups in one window: "from N to M", summed (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<LevelUpBody pending={[up(3, 4, { items: { 'poke-ball': 3 }, dust: 90 }), up(4, 6, { items: { 'poke-ball': 6 }, dust: 230 })]} />)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain(lng === 'es' ? 'Subiste del nivel 3 al 6' : 'You went from level 3 to 6')
      expect(html).toContain('+320')
      expect(html).toContain('×9')
    })
  }

  it('renders nothing without notices and skips zero Dust', () => {
    expect(renderToStaticMarkup(<LevelUpBody pending={[]} />)).toBe('')
    const html = renderToStaticMarkup(<LevelUpBody pending={[up(1, 2, { dust: 0 })]} />)
    expect(html).not.toContain('+0')
  })

  it('is built for 390 px: a column, the list can shrink and long names wrap', () => {
    const html = renderToStaticMarkup(<LevelUpBody pending={[up(1, 2)]} />)
    expect(html).toContain('flex-col')
    expect(html).toContain('min-w-0')
  })
})
