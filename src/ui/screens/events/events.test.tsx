/** Player-facing events UI: pure helpers, card / page / banner markup (ES + EN, no raw keys) and the live-events store. */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import type { LiveEventPublic, LiveEventsResponse } from '../../../game/protocol'
import { resetLiveEventsForTests, useLiveEvents } from '../../store/liveEvents'
import { EventBannerBar } from './EventBanner'
import { EventCard } from './EventCard'
import { EventsView } from './Events'
import { bannerEvent, eventPhase, fmtMult, formatEventWhen, imageSrcSet, missionLines, remainingKey, remainingParts, rewardOfDef, shinyBoost } from './model'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 9, 15, 0)
const RAW_KEY = /\b(events|missions)\.[a-zA-Z]+\.?[a-zA-Z]*\b(?![^<]*>)/

function ev(over: Partial<LiveEventPublic> = {}): LiveEventPublic {
  return {
    id: 'e1',
    slug: 'pikachu-week',
    name: { es: 'Semana Pikachu', en: 'Pikachu Week' },
    description: { es: 'Pikachu aparece más.', en: 'Pikachu shows up more.' },
    image: { url: '/media/events/' + 'a'.repeat(64) + '.webp', thumbUrl: '/media/events/' + 'a'.repeat(64) + '-480.webp', width: 1600, height: 900 },
    startsAt: NOW - 2 * HOUR,
    endsAt: NOW + 26 * HOUR,
    featured: [{ species: 'pikachu', weightMult: 3 }],
    shiny: { chance: 0.0075, scope: 'featured' },
    legendaryChanceMult: 2,
    drops: [
      { item: 'poke-ball', perWaveChance: 0.25, max: 3 },
      { item: 'spark-token', perWaveChance: 0.05, max: 1 },
    ],
    missions: [
      {
        id: 'sparks',
        period: 'event',
        kind: 'catch',
        target: 5,
        title: { es: 'Atrapa {n} Pokémon', en: 'Catch {n} Pokémon' },
        description: { es: 'Atrapa {n} en el evento.', en: 'Catch {n} during the event.' },
        rewards: [{ dust: 100 }, { minTrainerLevel: 10, dust: 300, items: { 'spark-token': 2 } }],
      },
    ],
    items: { 'spark-token': { names: { es: 'Ficha chispa', en: 'Spark token' } } },
    ...over,
  }
}

describe('model helpers', () => {
  it('phases and banner pick', () => {
    const e = ev()
    expect(eventPhase(e, NOW)).toBe('active')
    expect(eventPhase(e, e.startsAt - 1)).toBe('upcoming')
    expect(eventPhase(e, e.endsAt)).toBe('past')
    const other = ev({ id: 'e2' })
    expect(bannerEvent([e, other], [], NOW)?.id).toBe('e1')
    expect(bannerEvent([e, other], ['e1'], NOW)?.id).toBe('e2')
    expect(bannerEvent([e], ['e1'], NOW)).toBeNull()
    // The server list can lag a few seconds: an event that already ended never shows a banner.
    expect(bannerEvent([e], [], e.endsAt)).toBeNull()
  })

  it('countdown parts and keys', () => {
    expect(remainingParts(2 * 86_400_000 + 4 * HOUR)).toEqual({ days: 2, hours: 4, minutes: 0 })
    expect(remainingParts(61 * 60_000 - 1)).toEqual({ days: 0, hours: 1, minutes: 1 })
    expect(remainingKey(remainingParts(2 * 86_400_000 + 4 * HOUR))).toEqual({ key: 'dh', values: { d: 2, h: 4 } })
    expect(remainingKey(remainingParts(3 * HOUR + 5 * 60_000))).toEqual({ key: 'hm', values: { h: 3, m: 5 } })
    expect(remainingKey(remainingParts(-5))).toEqual({ key: 'm', values: { m: 1 } })
  })

  it('shows dates in the given zone', () => {
    const lima = formatEventWhen(Date.UTC(2026, 10, 9, 3, 30), 'America/Lima', 'en')
    expect(lima).toContain('8')
    expect(lima).toContain('10:30')
    expect(formatEventWhen(Date.UTC(2026, 10, 9, 3, 30), 'No/Such_Zone', 'en')).toMatch(/2026/)
  })

  it('srcset uses the 480 px card and the full image', () => {
    const e = ev()
    expect(imageSrcSet(e.image!)).toBe(`${e.image!.thumbUrl} 480w, ${e.image!.url} 1600w`)
  })

  it('shiny boost is relative to the base chance', () => {
    expect(shinyBoost({ shiny: { chance: 0.0075, scope: 'all' } }, 0.0025)).toEqual({ mult: 3, chance: 0.0075, scope: 'all' })
    expect(shinyBoost({}, 0.0025)).toBeNull()
    expect(shinyBoost({ shiny: { chance: 0.01, scope: 'all' } }, 0)?.mult).toBeNull()
    expect(fmtMult(3)).toBe('3')
    expect(fmtMult(2.54)).toBe('2.5')
  })

  it('rewards follow the trainer level; lines use the player slot when there is one', () => {
    const def = ev().missions[0]!
    expect(rewardOfDef(def, 1)).toEqual({ items: {}, dust: 100, typeCandies: {} })
    expect(rewardOfDef(def, 12)).toEqual({ items: { 'spark-token': 2 }, dust: 300, typeCandies: {} })
    const typeName = (t: string) => t
    const plain = missionLines(ev(), undefined, 'en', 1, typeName)
    expect(plain[0]).toMatchObject({ title: 'Catch 5 Pokémon', progress: null, claimed: false })
    const view = {
      id: 'e:e1:sparks',
      defId: 'sparks',
      eventId: 'e1',
      period: 'event' as const,
      kind: 'catch' as const,
      title: { es: 'Atrapa 5 Pokémon', en: 'Catch 5 Pokémon' },
      description: { es: 'x', en: 'y' },
      params: { n: 5, minutes: null, type: null },
      progress: 3,
      target: 5,
      completed: false,
      claimed: false,
      reward: { items: {}, dust: 100, typeCandies: {} },
    }
    expect(missionLines(ev(), [view], 'es', 1, typeName)[0]).toMatchObject({ id: 'e:e1:sparks', progress: 3, title: 'Atrapa 5 Pokémon' })
  })
})

describe('EventCard', () => {
  const card = (e: LiveEventPublic, phase?: 'active' | 'upcoming' | 'past') =>
    renderToStaticMarkup(<EventCard event={e} now={NOW} tz="America/Lima" baseShinyChance={0.0025} phase={phase} />)

  for (const lng of ['es', 'en'] as const) {
    it(`shows image, dates, featured, shiny, legendary, drops and missions (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = card(ev())
      const es = lng === 'es'
      expect(html).not.toMatch(RAW_KEY)
      // The 480 px version in the list, the big one in srcset, no layout shift (explicit size).
      expect(html).toContain('-480.webp')
      expect(html).toContain('srcSet=')
      expect(html).toContain('loading="lazy"')
      expect(html).toContain(es ? 'Semana Pikachu' : 'Pikachu Week')
      expect(html).toContain(es ? 'En marcha' : 'Live')
      expect(html).toContain(es ? 'Termina en 1 d 2 h' : 'Ends in 1 d 2 h')
      expect(html).toContain('Pikachu')
      expect(html).toContain('×3')
      expect(html).toContain(es ? 'Shiny ×3' : 'Shiny ×3')
      expect(html).toContain(es ? 'solo en los destacados' : 'on featured Pokémon only')
      expect(html).toContain(es ? 'Legendarios ×2' : 'Legendaries ×2')
      expect(html).toContain(es ? 'Ficha chispa' : 'Spark token')
      expect(html).toContain(es ? 'Atrapa 5 Pokémon' : 'Catch 5 Pokémon')
      expect(html).toContain('#/missions')
    })
  }

  it('a past event says when it ended and has no missions link; an upcoming one counts down to the start', async () => {
    await i18n.changeLanguage('en')
    const past = card(ev({ startsAt: NOW - 10 * HOUR, endsAt: NOW - HOUR }))
    expect(past).toContain('Ended')
    expect(past).not.toContain('#/missions')
    const soon = card(ev({ startsAt: NOW + 5 * HOUR, endsAt: NOW + 9 * HOUR }))
    expect(soon).toContain('Starts in 5 h 0 min')
  })

  it('works without image, shiny, legendary, drops, missions', async () => {
    await i18n.changeLanguage('en')
    const html = card(ev({ image: null, shiny: undefined, legendaryChanceMult: undefined, drops: [], missions: [], featured: [], items: undefined }))
    expect(html).not.toContain('<img')
    expect(html).not.toContain('Shiny')
    expect(html).not.toContain('Prizes per wave')
    expect(html).toContain('Pikachu Week')
  })
})

describe('EventsView', () => {
  const view = (over: Partial<React.ComponentProps<typeof EventsView>> = {}) =>
    renderToStaticMarkup(
      <EventsView
        active={[ev()]}
        upcoming={[]}
        past={[]}
        hasMore={false}
        loadingMore={false}
        status="ready"
        now={NOW}
        baseShinyChance={0.0025}
        missionViews={() => undefined}
        onMore={() => undefined}
        onRetry={() => undefined}
        title="Events"
        {...over}
      />,
    )

  it('lists the sections, with an empty line for upcoming and no past section when there is none', async () => {
    await i18n.changeLanguage('en')
    const html = view()
    expect(html).toContain('Active')
    expect(html).toContain('Upcoming')
    expect(html).toContain('No events announced yet.')
    expect(html).not.toContain('Past')
    expect(html).not.toContain('Show more past events')
  })

  it('paginates the past ones', async () => {
    await i18n.changeLanguage('es')
    const html = view({ past: [ev({ id: 'p1', startsAt: NOW - 90 * HOUR, endsAt: NOW - 50 * HOUR })], hasMore: true })
    expect(html).toContain('Pasados')
    expect(html).toContain('Ver más eventos pasados')
  })

  it('has loading, error and empty states', async () => {
    await i18n.changeLanguage('en')
    expect(view({ active: [], status: 'loading' })).toContain('Loading')
    expect(view({ active: [], status: 'error' })).toContain('We could not load the events')
    expect(view({ active: [], status: 'ready' })).toContain('No events yet')
  })
})

describe('EventBannerBar', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`links to the page and can be closed (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<EventBannerBar event={ev()} now={NOW} onDismiss={() => undefined} />)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain('href="#/events"')
      expect(html).toContain(lng === 'es' ? 'Evento: Semana Pikachu' : 'Event: Pikachu Week')
      expect(html).toContain(lng === 'es' ? 'Cerrar el aviso de Semana Pikachu' : 'Close the Pikachu Week notice')
    })
  }
  it('has no close button without a handler', () => {
    expect(renderToStaticMarkup(<EventBannerBar event={ev()} now={NOW} />)).not.toContain('<button')
  })
})

describe('live events store', () => {
  const page = (over: Partial<LiveEventsResponse> = {}): LiveEventsResponse => ({ active: [ev()], upcoming: [], past: [], nextCursor: null, serverNow: NOW, ...over })
  const respond = (...bodies: LiveEventsResponse[]) => {
    const f = vi.fn(async () => new Response(JSON.stringify(bodies.shift() ?? page()), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', f)
    return f
  }
  beforeEach(() => {
    resetLiveEventsForTests()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('loads the lists and the clock skew, then pages the past ones with the cursor', async () => {
    const past1 = ev({ id: 'p1', endsAt: NOW - 1 })
    const past2 = ev({ id: 'p2', endsAt: NOW - 2 })
    const f = respond(page({ past: [past1], nextCursor: 1234 }), page({ active: [], past: [past1, past2], nextCursor: null }))
    await useLiveEvents.getState().load()
    expect(useLiveEvents.getState()).toMatchObject({ status: 'ready', nextCursor: 1234 })
    expect(useLiveEvents.getState().active).toHaveLength(1)
    await useLiveEvents.getState().loadMore()
    expect(String((f.mock.calls[1] as unknown[])[0])).toContain('/api/live-events?before=1234')
    expect(useLiveEvents.getState().past.map((e) => e.id)).toEqual(['p1', 'p2'])
    expect(useLiveEvents.getState().nextCursor).toBeNull()
    // No cursor: nothing to ask.
    await useLiveEvents.getState().loadMore()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('keeps the old lists when a reload fails, and reports an error only when it never loaded', async () => {
    respond(page())
    await useLiveEvents.getState().load()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    await useLiveEvents.getState().load()
    expect(useLiveEvents.getState().status).toBe('ready')
    expect(useLiveEvents.getState().active).toHaveLength(1)
    resetLiveEventsForTests()
    await useLiveEvents.getState().load()
    expect(useLiveEvents.getState().status).toBe('error')
  })

  it('remembers closed banners', () => {
    useLiveEvents.getState().dismissBanner('e1')
    useLiveEvents.getState().dismissBanner('e1')
    expect(useLiveEvents.getState().dismissed).toEqual(['e1'])
  })
})
