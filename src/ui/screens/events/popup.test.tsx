/** The event pop-up: when it shows (pure), what it remembers, and its markup (ES + EN, no raw keys, no HTML injection). */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import type { LiveEventPublic } from '../../../game/protocol'
import { RichText } from '../../components'
import { resetLiveEventsForTests, useLiveEvents } from '../../store/liveEvents'
import { EventCard } from './EventCard'
import { EventPopupBody } from './EventPopup'
import { decideEventPopup, pendingPopups, popupCandidates, popupKey, type EventPopupContext } from './popup'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 9, 15, 0)
const RAW_KEY = /\b(events|eventsAdmin)\.[a-zA-Z]+\.?[a-zA-Z]*\b(?![^<]*>)/

function ev(over: Partial<LiveEventPublic> = {}): LiveEventPublic {
  return {
    id: 'e1',
    slug: 'pikachu-week',
    name: { es: 'Semana Pikachu', en: 'Pikachu Week' },
    description: { es: 'Pikachu **aparece** más. [red]Ojo[/red]', en: 'Pikachu shows up **more**. [red]Careful[/red]' },
    image: { url: '/media/events/' + 'a'.repeat(64) + '.webp', thumbUrl: '/media/events/' + 'a'.repeat(64) + '-480.webp', width: 1600, height: 900 },
    startsAt: NOW - 2 * HOUR,
    endsAt: NOW + 26 * HOUR,
    announceRev: 0,
    featured: [{ species: 'pikachu', weightMult: 3 }],
    drops: [],
    missions: [],
    ...over,
  }
}

const calm = (over: Partial<EventPopupContext> = {}): EventPopupContext => ({
  pending: pendingPopups([ev()], [], [], NOW),
  phase: 'idle',
  hintOpen: false,
  otherDialogOpen: false,
  whatsNewPending: false,
  onEvents: false,
  ...over,
})

describe('popup candidates', () => {
  it('a running event is owed once per device and revision', () => {
    const k = popupKey('e1', 0, 'active')
    expect(popupCandidates([ev()], [], NOW).map((c) => c.key)).toEqual([k])
    expect(pendingPopups([ev()], [], [k], NOW)).toEqual([])
    // an admin notice (rev 1) makes it owed again, also to whoever closed rev 0
    expect(pendingPopups([ev({ announceRev: 1 })], [], [k], NOW).map((c) => c.key)).toEqual([popupKey('e1', 1, 'active')])
  })

  it('an upcoming event only has a pop-up after an admin notified, and it is «upcoming»', () => {
    const soon = ev({ id: 'e2', startsAt: NOW + 5 * HOUR, endsAt: NOW + 9 * HOUR })
    expect(popupCandidates([], [soon], NOW)).toEqual([])
    const announced = { ...soon, announceRev: 1 }
    expect(popupCandidates([], [announced], NOW)).toMatchObject([{ phase: 'upcoming', key: popupKey('e2', 1, 'upcoming') }])
    // seen as «coming soon», it is owed again as «live» when it starts (another phase)
    const seen = [popupKey('e2', 1, 'upcoming')]
    expect(pendingPopups([], [announced], seen, NOW)).toEqual([])
    expect(pendingPopups([], [announced], seen, NOW + 6 * HOUR)).toMatchObject([{ phase: 'active' }])
  })

  it('ignores ended events, lists each event once, running ones first, then by start', () => {
    const over = ev({ id: 'old', endsAt: NOW - 1 })
    const a = ev({ id: 'a', startsAt: NOW - HOUR })
    const b = ev({ id: 'b', startsAt: NOW - 3 * HOUR })
    const up = ev({ id: 'u', startsAt: NOW + HOUR, endsAt: NOW + 3 * HOUR, announceRev: 2 })
    expect(popupCandidates([a, b, over, a], [up, up], NOW).map((c) => c.event.id)).toEqual(['b', 'a', 'u'])
  })
})

describe('decideEventPopup', () => {
  it('nothing owed: none', () => {
    expect(decideEventPopup(calm({ pending: [] }))).toEqual({ kind: 'none' })
  })

  it('shows the first one when the player is calm (idle or looking at the results)', () => {
    const d = decideEventPopup(calm())
    expect(d).toMatchObject({ kind: 'show', candidate: { event: { id: 'e1' }, phase: 'active' } })
    expect(decideEventPopup(calm({ phase: 'results' })).kind).toBe('show')
  })

  it('waits while studying: focus, paused, claim, late, catching waves or on a break', () => {
    for (const phase of ['focus', 'paused', 'claim', 'late', 'waves', 'break']) expect(decideEventPopup(calm({ phase })), phase).toEqual({ kind: 'wait' })
  })

  it('waits over a hint, another dialog or «What\'s new?»', () => {
    expect(decideEventPopup(calm({ hintOpen: true }))).toEqual({ kind: 'wait' })
    expect(decideEventPopup(calm({ otherDialogOpen: true }))).toEqual({ kind: 'wait' })
    expect(decideEventPopup(calm({ whatsNewPending: true }))).toEqual({ kind: 'wait' })
  })

  it('on the events page it only records them as seen', () => {
    const pending = [...pendingPopups([ev(), ev({ id: 'e9', startsAt: NOW - HOUR })], [], [], NOW)]
    expect(decideEventPopup(calm({ pending, onEvents: true }))).toEqual({ kind: 'record', keys: pending.map((p) => p.key) })
  })

  it('goes one at a time, in order, as each one is seen', () => {
    const live = [ev({ id: 'b', startsAt: NOW - 3 * HOUR }), ev({ id: 'a', startsAt: NOW - HOUR })]
    const seen: string[] = []
    const order: string[] = []
    for (let i = 0; i < 4; i++) {
      const d = decideEventPopup(calm({ pending: pendingPopups(live, [], seen, NOW) }))
      if (d.kind !== 'show') break
      order.push(d.candidate.event.id)
      seen.push(d.candidate.key)
    }
    expect(order).toEqual(['b', 'a'])
  })

  it('a session that starts later keeps it waiting, and it shows when the session is over', () => {
    const pending = pendingPopups([ev()], [], [], NOW)
    expect(decideEventPopup(calm({ pending, phase: 'focus' })).kind).toBe('wait')
    expect(decideEventPopup(calm({ pending, phase: 'results' })).kind).toBe('show')
  })
})

describe('what the device remembers', () => {
  const setItem = vi.fn()
  beforeEach(() => {
    setItem.mockReset()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem, removeItem: vi.fn() })
    resetLiveEventsForTests()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps seen pop-ups, without duplicates and bounded, and survives a storage that throws', () => {
    const s = useLiveEvents.getState()
    s.markPopupSeen(['a#0#a', 'b#0#a'])
    s.markPopupSeen(['a#0#a'])
    expect(useLiveEvents.getState().popupSeen).toEqual(['a#0#a', 'b#0#a'])
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(setItem.mock.calls[0]![0]).toBe('pokefocus:eventPopup:seen')
    s.markPopupSeen(Array.from({ length: 150 }, (_, i) => `k${i}#0#a`))
    expect(useLiveEvents.getState().popupSeen).toHaveLength(100)
    expect(useLiveEvents.getState().popupSeen.at(-1)).toBe('k149#0#a')
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => useLiveEvents.getState().markPopupSeen(['z#0#a'])).not.toThrow()
    expect(useLiveEvents.getState().popupSeen.at(-1)).toBe('z#0#a')
  })
})

describe('EventPopupBody', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`running event: big image with srcset, dates in the player's zone, rich text, featured species (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<EventPopupBody event={ev()} phase="active" tz="America/Lima" />)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain(`/media/events/${'a'.repeat(64)}.webp`)
      expect(html).toContain('srcSet=')
      expect(html).toContain('480w')
      expect(html).toContain('1600w')
      expect(html).toContain('<strong>')
      expect(html).toContain('text-rich-red')
      expect(html).not.toContain('**')
      expect(html).not.toContain('[red]')
      expect(html).toContain(lng === 'es' ? 'En marcha' : 'Live now')
      expect(html).toContain(lng === 'es' ? 'Hasta el' : 'Until')
      expect(html).toContain('Pikachu')
      expect(html).toContain('×3')
    })

    it(`scheduled event says «coming soon» with the start date (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const soon = ev({ startsAt: NOW + 5 * HOUR, endsAt: NOW + 9 * HOUR, announceRev: 1 })
      const html = renderToStaticMarkup(<EventPopupBody event={soon} phase="upcoming" tz="America/Lima" />)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain(lng === 'es' ? 'Próximamente' : 'Coming soon')
      expect(html).toContain(lng === 'es' ? 'Empieza el' : 'Starts')
      expect(html).toContain(lng === 'es' ? '15:00' : '03:00 PM') // NOW + 5 h = 20:00 UTC = 15:00 in Lima (UTC-5)
    })
  }

  it('works without an image and without featured species', () => {
    const html = renderToStaticMarkup(<EventPopupBody event={ev({ image: null, featured: [] })} phase="active" />)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<section')
  })
})

describe('RichText rendering', () => {
  it('renders the format as elements and never as HTML', () => {
    const html = renderToStaticMarkup(<RichText text={'**b** *i* [blue]c[/blue] <img src=x onerror=alert(1)> <script>x</script> [rojo]z[/rojo]'} />)
    expect(html).toContain('<strong>b</strong>')
    expect(html).toContain('<em>i</em>')
    expect(html).toContain('<span class="text-rich-blue">c</span>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('[rojo]z[/rojo]')
  })

  it('the events page card uses it', async () => {
    await i18n.changeLanguage('en')
    const html = renderToStaticMarkup(<EventCard event={ev()} now={NOW} baseShinyChance={0.0025} />)
    expect(html).toContain('<strong>more</strong>')
    expect(html).toContain('text-rich-red')
  })
})
