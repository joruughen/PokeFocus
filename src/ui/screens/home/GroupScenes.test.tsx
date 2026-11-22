/** Group scenes (server-side render, no DOM): who shows on which page, full sprites only, dimmed players, both languages. */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { TRAINER_CORE } from '../../../game/trainers'
import { GroupRoster, meFirst, pageCount, PLAYERS_PER_PAGE, type ScenePlayer } from './GroupScenes'

const TEAM = [
  { slug: 'pikachu', shiny: true },
  { slug: 'charmander', shiny: false },
  { slug: 'squirtle', shiny: false },
  { slug: 'bulbasaur', shiny: false },
  { slug: 'eevee', shiny: false },
  { slug: 'snorlax', shiny: false },
]

const player = (i: number, o: Partial<ScenePlayer> = {}): ScenePlayer => ({
  userId: `u${i}`,
  name: `Trainer${i}`,
  trainer: TRAINER_CORE[i % TRAINER_CORE.length]!,
  team: TEAM,
  you: false,
  host: false,
  state: 'in',
  stateText: 'studying',
  ...o,
})
const many = (n: number) => Array.from({ length: n }, (_, i) => player(i))
const render = (players: ScenePlayer[], initialPage = 0) => renderToStaticMarkup(<GroupRoster players={players} time="day" label="Players" initialPage={initialPage} />)
const scenes = (html: string) => html.split('<li ').length - 1
/** `src` of the <img> tags only (React also emits a preload <link> per image). */
const imgs = (html: string, dir: string) => [...html.matchAll(/<img[^>]*src="(\/sprites\/[^"]+)"/g)].map((m) => m[1]!).filter((src) => src.startsWith(`/sprites/${dir}/`))

describe('paging', () => {
  it('four to a page; a group has eight at most, so two pages', () => {
    expect(PLAYERS_PER_PAGE).toBe(4)
    expect([1, 4, 5, 8].map(pageCount)).toEqual([1, 1, 2, 2])
  })

  it('up to four players: one page, no arrow', () => {
    for (const n of [1, 3, 4]) {
      const html = render(many(n))
      expect(scenes(html)).toBe(n)
      expect(html).not.toContain('<nav')
    }
  })

  it('more than four: the first page has four, with the next arrow and the page indicator', async () => {
    await i18n.changeLanguage('en')
    const html = render(many(7))
    expect(scenes(html)).toBe(4)
    for (const i of [0, 1, 2, 3]) expect(html).toContain(`Trainer${i}`)
    expect(html).not.toContain('Trainer4')
    expect(html).toContain('1/2')
    expect(html).toContain('aria-label="Next players (page 2 of 2)"')
    expect(html).not.toContain('Previous players')
  })

  it('the second page has the rest and the way back', async () => {
    await i18n.changeLanguage('en')
    const html = render(many(7), 1)
    expect(scenes(html)).toBe(3)
    for (const i of [4, 5, 6]) expect(html).toContain(`Trainer${i}`)
    expect(html).not.toContain('Trainer3')
    expect(html).toContain('2/2')
    expect(html).toContain('aria-label="Previous players (page 1 of 2)"')
    expect(html).not.toContain('Next players')
  })

  it('a page that no longer exists (somebody left) falls back to the last one', () => {
    const html = render(many(5), 3)
    expect(scenes(html)).toBe(1)
    expect(html).toContain('Trainer4')
  })

  it('I always come first, the rest keep their order', () => {
    const ids = meFirst(many(6), 'u4').map((p) => p.userId)
    expect(ids).toEqual(['u4', 'u0', 'u1', 'u2', 'u3', 'u5'])
    expect(meFirst(many(3), undefined).map((p) => p.userId)).toEqual(['u0', 'u1', 'u2'])
  })
})

describe('a scene', () => {
  it('shows the character and the whole team with full sprites, never box icons; shiny uses the shiny sprite', () => {
    const html = render([player(0, { you: true, trainer: 'hilbert' })])
    expect(imgs(html, 'trainers')).toEqual(['/sprites/trainers/hilbert.png'])
    expect(imgs(html, 'icons')).toEqual([])
    expect(html).not.toContain('/sprites/icons/')
    // Pikachu (25) is the shiny leader; the other five are normal.
    expect(imgs(html, 'showdown-shiny')).toEqual(['/sprites/showdown-shiny/25.gif'])
    expect(imgs(html, 'showdown')).toHaveLength(5)
  })

  it('works with a partial team, and with no team to show (the character still stands there)', () => {
    const three = render([player(0, { team: TEAM.slice(0, 3) })])
    expect(imgs(three, 'showdown').length + imgs(three, 'showdown-shiny').length).toBe(3)
    const none = render([player(0, { team: [] })])
    expect(imgs(none, 'trainers')).toHaveLength(1)
    expect(none).not.toMatch(/\/sprites\/showdown/)
  })

  it('marks me and the host; players who left or finished are dimmed, the rest are not', async () => {
    await i18n.changeLanguage('en')
    const html = render([player(0, { you: true }), player(1, { host: true }), player(2, { state: 'left', stateText: 'out' }), player(3, { state: 'done', stateText: 'finished' })])
    expect(html).toContain('>You<')
    expect(html.match(/opacity-60 saturate-50/g)).toHaveLength(2)
    expect(html).toContain('line-through')
  })

  for (const lng of ['es', 'en'] as const) {
    it(`has no raw i18n keys and names every character (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = render(many(8), 1)
      expect(html).not.toMatch(/\b(group|trainers|profile)\.[a-zA-Z]/)
      for (const slug of TRAINER_CORE) expect(i18n.t(`trainers.names.${slug}`, { lng })).not.toBe(`trainers.names.${slug}`)
    })
  }
})
