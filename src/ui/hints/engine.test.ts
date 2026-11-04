import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from '../store/prefs'
import {
  closeHint,
  emitHintEvent,
  enterScreen,
  leaveScreen,
  MAX_AUTO_PER_SCREEN,
  nextInSequence,
  openHint,
  registerHints,
  setHintsSuppressed,
  useHints,
} from './engine'

registerHints([
  { id: 't.a', screen: 'test', trigger: { kind: 'firstVisit' }, order: 1 },
  { id: 't.b', screen: 'test', trigger: { kind: 'firstVisit' }, order: 2 },
  { id: 't.c', screen: 'test', trigger: { kind: 'firstVisit' }, order: 3 },
  { id: 't.ev', screen: 'test', trigger: { kind: 'event', event: 'boom' } },
  { id: 's.1', screen: 'seq', trigger: { kind: 'firstVisit' }, sequence: 'q', order: 1 },
  { id: 's.2', screen: 'seq', trigger: { kind: 'firstVisit' }, sequence: 'q', order: 2 },
  { id: 's.3', screen: 'seq', trigger: { kind: 'firstVisit' }, sequence: 'q', order: 3 },
])

const active = () => useHints.getState().active?.id ?? null

beforeEach(() => {
  vi.useFakeTimers()
  usePrefs.setState({ seenHints: {}, tipsEnabled: true })
  useHints.setState({ active: null, queue: [], screen: null, autoShown: 0, suppressed: false, values: {} })
})
afterEach(() => {
  leaveScreen('test')
  leaveScreen('seq')
  vi.useRealTimers()
})

describe('hint engine', () => {
  it('shows first-visit hints one at a time, in order, up to the per-screen cap', () => {
    enterScreen('test')
    vi.advanceTimersByTime(1000)
    expect(active()).toBe('t.a')
    closeHint()
    vi.advanceTimersByTime(1000)
    expect(active()).toBe('t.b')
    closeHint()
    vi.advanceTimersByTime(1000)
    expect(MAX_AUTO_PER_SCREEN).toBe(2)
    expect(active()).toBeNull()
    expect(usePrefs.getState().seenHints['t.a']).toBeTypeOf('number')
  })

  it('never shows a hint twice once seen', () => {
    usePrefs.setState({ seenHints: { 't.a': 1, 't.b': 1 } })
    enterScreen('test')
    vi.advanceTimersByTime(1000)
    expect(active()).toBe('t.c')
  })

  it('stays quiet while suppressed (focus session) and resumes afterwards', () => {
    setHintsSuppressed(true)
    enterScreen('test')
    vi.advanceTimersByTime(1000)
    expect(active()).toBeNull()
    setHintsSuppressed(false)
    vi.advanceTimersByTime(1000)
    expect(active()).toBe('t.a')
    setHintsSuppressed(true)
    expect(active()).toBeNull()
    expect(usePrefs.getState().seenHints['t.a']).toBeUndefined()
  })

  it('respects "don\'t show tips", but HelpDot opens on demand', () => {
    usePrefs.setState({ tipsEnabled: false })
    enterScreen('test')
    emitHintEvent('boom')
    vi.advanceTimersByTime(1000)
    expect(active()).toBeNull()
    openHint('t.ev')
    expect(useHints.getState().active).toMatchObject({ id: 't.ev', manual: true })
  })

  it('event hints fire only for listeners on the current screen', () => {
    enterScreen('seq')
    usePrefs.setState({ seenHints: { 's.1': 1 } })
    emitHintEvent('boom')
    vi.advanceTimersByTime(1000)
    expect(active()).toBeNull()
  })

  it('plays a sequence with a step counter; closing skips the rest', () => {
    enterScreen('seq')
    vi.advanceTimersByTime(1000)
    expect(useHints.getState().active).toMatchObject({ id: 's.1', step: { index: 0, total: 3 } })
    nextInSequence()
    expect(useHints.getState().active).toMatchObject({ id: 's.2', step: { index: 1, total: 3 } })
    closeHint()
    const seen = usePrefs.getState().seenHints
    expect(Object.keys(seen).sort()).toEqual(['s.1', 's.2', 's.3'])
  })
})
