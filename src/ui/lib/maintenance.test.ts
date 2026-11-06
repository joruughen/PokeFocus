import { describe, expect, it } from 'vitest'
import type { MaintenanceNotice } from '../../game/protocol'
import { formatInstant, formatRelative, formatWindow, fromLocalInput, pickNotice, toLocalInput } from './maintenance'

const MIN = 60_000
const HOUR = 60 * MIN
const T0 = Date.UTC(2026, 10, 7, 0, 0) // Sat 7 Nov 2026 00:00 UTC

const n = (id: string, startsAt: number, endsAt: number, note: string | null = null): MaintenanceNotice => ({ id, startsAt, endsAt, note })

describe('pickNotice', () => {
  it('shows nothing when there are no notices or all have ended', () => {
    expect(pickNotice([], T0)).toBeNull()
    expect(pickNotice([n('a', T0 - 2 * HOUR, T0 - HOUR)], T0)).toBeNull()
    expect(pickNotice([n('a', T0 - HOUR, T0)], T0)).toBeNull() // ends exactly now
  })

  it('shows the soonest upcoming notice', () => {
    const view = pickNotice([n('late', T0 + 5 * HOUR, T0 + 6 * HOUR), n('soon', T0 + HOUR, T0 + 2 * HOUR)], T0)
    expect(view).toMatchObject({ phase: 'upcoming', notice: { id: 'soon' } })
  })

  it('a running window wins over an upcoming one', () => {
    const view = pickNotice([n('soon', T0 + HOUR, T0 + 2 * HOUR), n('now', T0 - HOUR, T0 + HOUR)], T0)
    expect(view).toMatchObject({ phase: 'active', notice: { id: 'now' } })
    expect(pickNotice([n('x', T0, T0 + HOUR)], T0)?.phase).toBe('active') // starts exactly now
  })

  it('among running windows, the one that ends first', () => {
    const view = pickNotice([n('long', T0 - HOUR, T0 + 5 * HOUR), n('short', T0 - HOUR, T0 + HOUR)], T0)
    expect(view?.notice.id).toBe('short')
  })

  it('a dismissed upcoming notice is skipped, a running one cannot be dismissed', () => {
    const list = [n('up', T0 + HOUR, T0 + 2 * HOUR), n('later', T0 + 5 * HOUR, T0 + 6 * HOUR)]
    expect(pickNotice(list, T0, new Set(['up']))?.notice.id).toBe('later')
    expect(pickNotice(list, T0, new Set(['up', 'later']))).toBeNull()
    const running = [n('run', T0 - HOUR, T0 + HOUR)]
    expect(pickNotice(running, T0, new Set(['run']))?.notice.id).toBe('run')
  })
})

describe('formatWindow', () => {
  const start = T0 + 2 * HOUR // 02:00 UTC
  const end = T0 + 4 * HOUR // 04:00 UTC

  it('same day: date once, then the two times and the zone (es)', () => {
    const s = formatWindow(start, end, 'es', 'UTC')
    expect(s).toMatch(/^sáb\.?,? 7 nov\.?, 02:00 – 04:00 UTC$/)
  })

  it('same day (en)', () => {
    const s = formatWindow(start, end, 'en', 'UTC')
    expect(s).toMatch(/^Sat, Nov 7, 02:00.AM – 04:00.AM UTC$/)
  })

  it('across midnight: both days are named', () => {
    const s = formatWindow(T0 - 2 * HOUR, T0 + 4 * HOUR, 'es', 'UTC')
    expect(s).toContain('vie')
    expect(s).toContain('6 nov')
    expect(s).toContain('sáb')
    expect(s).toContain('7 nov')
    expect(s).toContain('22:00')
    expect(s).toContain('04:00')
  })

  it('writes the time in the viewer zone, not the admin zone', () => {
    // 02:00 UTC is 21:00 the day before in New York (UTC-5 in early November).
    const s = formatWindow(start, end, 'es', 'America/New_York')
    expect(s).toContain('21:00')
    expect(s).toContain('23:00')
    expect(s).toContain('6 nov')
    expect(s).toMatch(/GMT-5$/)
  })

  it('formatInstant names the day, the time and the zone', () => {
    expect(formatInstant(end, 'es', 'UTC')).toMatch(/04:00 UTC$/)
  })
})

describe('formatRelative', () => {
  it('rounds to minutes, hours or days', () => {
    expect(formatRelative(25 * MIN, 'en')).toBe('in 25 minutes')
    expect(formatRelative(10_000, 'en')).toBe('in 1 minute')
    expect(formatRelative(3 * HOUR, 'en')).toBe('in 3 hours')
    expect(formatRelative(3 * 24 * HOUR, 'es')).toBe('dentro de 3 días')
    expect(formatRelative(25 * MIN, 'es')).toBe('dentro de 25 minutos')
  })
})

describe('datetime-local helpers', () => {
  it('round-trips through the local zone', () => {
    const ts = new Date(2026, 10, 7, 2, 30).getTime()
    expect(toLocalInput(ts)).toBe('2026-11-07T02:30')
    expect(fromLocalInput('2026-11-07T02:30')).toBe(ts)
  })

  it('rejects empty or malformed input', () => {
    expect(fromLocalInput('')).toBeNaN()
    expect(fromLocalInput('2026-11-07')).toBeNaN()
    expect(fromLocalInput('nope')).toBeNaN()
  })
})
