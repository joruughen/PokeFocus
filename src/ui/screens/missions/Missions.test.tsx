/** Missions screen: the event groups (claimable while the event runs and after it ended, as the engine says). */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEngineContext, refreshMissions, resolveContent, type EventOverlay } from '../../../engine'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import i18n from '../../../i18n'
import type { LiveEventPublic } from '../../../game/protocol'
import Missions from './Missions'

// Server-side rendering reads a zustand store's initial state, so the stores this screen reads are replaced by plain selectors over `mock`.
const mock = vi.hoisted(() => ({ player: null as unknown, events: [] as unknown[] }))
vi.mock('../../store/game', () => ({
  useGame: Object.assign((sel: (s: unknown) => unknown) => sel({ player: mock.player, claimMission: vi.fn(), claimAllMissions: vi.fn(), error: null }), { getState: () => ({ error: null }) }),
}))
vi.mock('../../store/selectors', () => ({ usePlayer: () => mock.player, useBusy: () => false }))
// A selector must return the same reference for the same state: a fresh array per call loops forever in zustand v5 (the screen went blank).
vi.mock('../../store/liveEvents', () => ({
  useLiveEvents: (sel: (s: unknown) => unknown) => {
    const state = { active: mock.events, upcoming: [], past: [] }
    const first = sel(state)
    if (sel(state) !== first) throw new Error('useLiveEvents selector returns a new value on every call')
    return first
  },
}))

const DAY = 86_400_000

function overlay(over: Partial<EventOverlay> = {}): EventOverlay {
  const now = Date.now()
  return {
    id: 'fest',
    slug: 'fest-slug',
    startsAt: now - DAY,
    endsAt: now + DAY,
    featured: [],
    drops: [],
    missions: [
      {
        id: 'study',
        period: 'event',
        kind: 'sessions',
        target: 1,
        title: { es: 'Estudia en el evento', en: 'Study in the event' },
        description: { es: 'Haz una sesión.', en: 'Do a session.' },
        rewards: [{ dust: 50 }],
      },
    ],
    ...over,
  }
}

/** A player whose missions were created while `ev` was running, and who already finished the study mission. */
function playerWith(ev: EventOverlay) {
  const ctx = createEngineContext(resolveContent({}, [ev], {}))
  let s = makePlayer([makeMon('pikachu', 20, { uid: 'a' })], {}, ctx)
  s = refreshMissions(s, Date.now(), ctx)
  const group = s.missions!.event!['fest']!
  return { ...s, missions: { ...s.missions!, event: { fest: { ...group, slots: group.slots.map((x) => ({ ...x, progress: x.target })) } } } }
}

const named = (ev: EventOverlay): LiveEventPublic => ({ ...ev, name: { es: 'Fiesta de estudio', en: 'Study fest' }, description: { es: 'd', en: 'd' }, image: null, startsAt: ev.startsAt, endsAt: ev.endsAt, items: undefined })

describe('Missions: event groups', () => {
  afterEach(() => {
    mock.player = null
    mock.events = []
  })

  for (const lng of ['es', 'en'] as const) {
    it(`shows an active event's missions with the event name and the countdown (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const ev = overlay()
      mock.player = playerWith(ev)
      mock.events = [named(ev)]
      const html = renderToStaticMarkup(<Missions />)
      expect(html).toContain(lng === 'es' ? 'Fiesta de estudio' : 'Study fest')
      expect(html).toContain(lng === 'es' ? 'Estudia en el evento' : 'Study in the event')
      expect(html).toContain(lng === 'es' ? 'Termina en' : 'Ends in')
      // Completed and not claimed: the claim button is there.
      expect(html).toContain(lng === 'es' ? 'Reclamar' : 'Claim')
    })
  }

  it('keeps the group claimable after the event ended, and says until when', async () => {
    await i18n.changeLanguage('en')
    const now = Date.now()
    const ev = overlay({ startsAt: now - 3 * DAY, endsAt: now - DAY })
    // Created while it ran (a day ago), viewed now.
    const ctx = createEngineContext(resolveContent({}, [{ ...ev, endsAt: now + DAY }], {}))
    let s = refreshMissions(makePlayer([makeMon('pikachu', 20, { uid: 'a' })], {}, ctx), now - 2 * DAY, ctx)
    const g = s.missions!.event!['fest']!
    s = { ...s, missions: { ...s.missions!, event: { fest: { ...g, endsAt: ev.endsAt, slots: g.slots.map((x) => ({ ...x, progress: x.target })) } } } }
    mock.player = s
    const html = renderToStaticMarkup(<Missions />)
    expect(html).toContain('Study in the event')
    expect(html).toContain('Ended: claim until')
    expect(html).toContain('Claim')
    // Not in the list any more (past event, not loaded): the group falls back to the slug.
    expect(html).toContain('fest-slug')
  })

  it('shows no event panel without events', async () => {
    await i18n.changeLanguage('en')
    mock.player = makePlayer([makeMon('pikachu', 20, { uid: 'a' })])
    const html = renderToStaticMarkup(<Missions />)
    expect(html).not.toContain('Event missions')
    expect(html).toContain('Daily')
  })
})
