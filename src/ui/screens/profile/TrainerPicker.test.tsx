/** The character picker (server-side render): the Profile panel, and the chooser that opens from it. */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import type { PublicUser } from '../../../game/protocol'
import { TRAINER_CATALOG } from '../../../game/trainerCatalog'
import { defaultTrainerSprite } from '../../../game/trainers'
import { useAuth } from '../../store/auth'
import { PAGE_SIZE, TrainerChooser, TrainerPicker, type TrainerChooserProps } from './TrainerPicker'

const user = (trainerSprite: string | null): PublicUser => ({
  id: 'u-picker',
  email: 'a@example.com',
  trainerName: 'Ash',
  country: 'PE',
  friendCode: 'ABCD2345',
  createdAt: 0,
  nameChangedAt: null,
  countryChangedAt: null,
  anonymousRankings: false,
  trainerSprite,
  role: 'player',
})

function panel(u: PublicUser | null): string {
  Object.assign(useAuth.getInitialState(), { status: u ? 'authed' : 'anon', user: u })
  return renderToStaticMarkup(<TrainerPicker />)
}

const noop = () => {}
const chooser = (o: Partial<TrainerChooserProps> = {}) =>
  renderToStaticMarkup(<TrainerChooser current="hilbert" defaultSlug="lass" chosen leader={{ slug: 'pikachu', shiny: false }} onSave={noop} onCancel={noop} {...o} />)
const tiles = (html: string) => [...html.matchAll(/data-slug="([^"]+)"/g)].map((m) => m[1]!)
/** The «Use this character» button tag. */
const useButton = (html: string, label = 'Use this character') => new RegExp(`<button[^>]*>[^<]*(?:<[^>]*>)*${label}`).exec(html)![0]
const disabled = (tag: string) => / disabled(=""|\s|>)/.test(tag)

beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(() => {
  Object.assign(useAuth.getInitialState(), { status: 'loading', user: null })
})

describe('Profile panel', () => {
  it('renders nothing while signed out', () => {
    expect(panel(null)).toBe('')
  })

  it('shows only your character and the button; the chooser stays closed (no wall of sprites)', () => {
    const html = panel(user('hilbert'))
    expect(html).toContain('Your character')
    expect(html).toContain('Now: Hilbert')
    expect(html).toContain('Change character')
    expect(html).toContain(`Choose from ${TRAINER_CATALOG.length} trainers`)
    expect(html.match(/<img[^>]*src="\/sprites\/trainers\//g)).toHaveLength(1)
    expect(html).not.toContain('type="search"')
    expect(html).not.toMatch(/\b(profile|trainers)\.[a-zA-Z]/)
  })

  it('names fan art by its author, and credits them', () => {
    const html = panel(user('aarune'))
    expect(html).toContain('Now: Aarune')
    expect(html).toContain('Sprite by kyledove')
  })

  it('without a choice, the default of the account is the current one', () => {
    const html = panel(user(null))
    expect(html).toContain(`/sprites/trainers/${defaultTrainerSprite('u-picker')}.png`)
  })

  it('speaks Spanish too', async () => {
    await i18n.changeLanguage('es')
    const html = panel(user('lass'))
    expect(html).toContain('Tu personaje')
    expect(html).toContain('Ahora: Chica')
    expect(html).toContain('Cambiar personaje')
  })
})

describe('chooser', () => {
  it('opens on the group of the current character: the featured 24, one page, nothing to add', () => {
    const html = chooser()
    expect(tiles(html)).toHaveLength(24)
    expect(html).toContain('Showing 24 of 24')
    expect(html).not.toContain('Show 24 more')
    // Search, the group chips with counters, «Surprise me», and the two buttons.
    expect(html).toContain('type="search"')
    for (const g of ['All', 'Featured', 'Classic', 'Older games', 'Fan art']) expect(html).toContain(g)
    expect(html).toContain(`>${TRAINER_CATALOG.length}<`)
    expect(html).toContain('Surprise me')
    expect(html).toContain('Cancel')
  })

  it('big groups are paged and their images load lazily', () => {
    const html = chooser({ initialGroup: 'all' })
    expect(tiles(html)).toHaveLength(PAGE_SIZE)
    expect(html).toContain(`Showing ${PAGE_SIZE} of ${TRAINER_CATALOG.length}`)
    expect(html).toContain(`Show ${PAGE_SIZE} more`)
    expect(html.match(/loading="lazy"/g)?.length).toBe(PAGE_SIZE)
  })

  it('the preview shows the pending character with the leader and the author, tags the current one', () => {
    const html = chooser({ initialPending: 'aarune' })
    expect(html).toContain('Aarune')
    expect(html).toContain('Sprite by kyledove')
    expect(html).not.toContain('Your character now')
    expect(disabled(useButton(html))).toBe(false)
    const same = chooser()
    expect(same).toContain('Your character now')
    expect(disabled(useButton(same))).toBe(true) // nothing to save
  })

  it('the default of the account is tagged until the player chooses', () => {
    expect(chooser({ chosen: false })).toContain('Default')
    expect(chooser({ chosen: true })).not.toContain('>Default<')
  })

  it('older games get a generation filter, fan art an author filter', () => {
    const older = chooser({ initialGroup: 'older' })
    for (const g of ['Gen 1', 'Gen 5']) expect(older).toContain(g)
    expect(older).toContain('aria-label="Game"')
    const fan = chooser({ initialGroup: 'fan' })
    expect(fan).toContain('Author')
    expect(fan).toContain('All authors (')
    const gen = chooser({ initialGroup: 'older', initialSub: 'gen5' })
    expect(tiles(gen).every((s) => TRAINER_CATALOG.find((e) => e.slug === s)!.sub === 'gen5')).toBe(true)
  })

  it('search finds by name with or without spaces, and counts the matches per group', () => {
    const html = chooser({ initialGroup: 'all', initialQuery: 'bug catcher' })
    expect(tiles(html)).toContain('bugcatcher')
    expect(tiles(html).length).toBeLessThan(40)
    const none = chooser({ initialGroup: 'featured', initialQuery: 'kyledove' })
    expect(tiles(none)).toEqual([])
    expect(none).toContain('No trainer matches “kyledove” in this group.')
    expect(none).toMatch(/See the \d+ matches in all groups/)
    const nothing = chooser({ initialGroup: 'all', initialQuery: 'zzzzzz' })
    expect(nothing).toContain('No trainer matches')
    expect(nothing).not.toContain('matches in all groups')
  })

  it('finds a featured character by its translated name', async () => {
    await i18n.changeLanguage('es')
    const html = chooser({ initialGroup: 'all', initialQuery: 'cinturon negro' })
    expect(tiles(html)).toContain('blackbelt')
    expect(html).toContain('Cinturón negro')
    expect(html).toContain('Usar este personaje')
    expect(html).not.toMatch(/\b(profile|trainers)\.[a-zA-Z]/)
  })

  it('every tile is a named button, with the author when it has one', () => {
    const html = chooser({ initialGroup: 'fan', initialSub: 'Horo' })
    expect(html).toMatch(/aria-label="[^"]+ \(Horo\)"/)
  })
})
