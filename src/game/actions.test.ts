import { describe, expect, it } from 'vitest'
import { createRng, MINUTE_MS, weeklyPoints } from '../engine'
import { applyAction, type ActionEnv } from './actions'
import { EMPTY_DOC, type GameAction, type GameDoc } from './protocol'

const T0 = Date.UTC(2026, 10, 3, 10, 0)

function env(now: number, patch: Partial<ActionEnv> = {}): ActionEnv {
  return { now, rng: createRng(`seed-${now}`), dev: false, trainerName: 'Ash', ...patch }
}

function must(doc: GameDoc, action: GameAction, e: ActionEnv): GameDoc {
  const r = applyAction(doc, action, e)
  if (!r.ok) throw new Error(`${action.type}: ${r.error}`)
  return r.doc
}

function newPlayer(): GameDoc {
  return must(EMPTY_DOC, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'charmander' }, env(T0))
}

describe('createPlayer', () => {
  it('creates the player with the trainer name from env', () => {
    const doc = newPlayer()
    expect(doc.player?.profile.trainerName).toBe('Ash')
    expect(doc.player?.team).toEqual(['p1'])
    expect(doc.player?.pokemon.p1?.speciesSlug).toBe('charmander')
  })
  it('refuses a second player and invalid starters', () => {
    const doc = newPlayer()
    expect(applyAction(doc, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'charmander' }, env(T0))).toEqual({ ok: false, error: 'player_exists' })
    expect(applyAction(EMPTY_DOC, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'mewtwo' }, env(T0))).toEqual({ ok: false, error: 'invalid_starter' })
  })
  it('other actions need a player', () => {
    expect(applyAction(EMPTY_DOC, { type: 'start', minutes: 25 }, env(T0))).toEqual({ ok: false, error: 'no_player' })
  })
})

describe('study session', () => {
  it('start → claim → throwBall full flow', () => {
    let doc = newPlayer()
    doc = must(doc, { type: 'start', minutes: 30 }, env(T0))
    expect(doc.timer?.endsAt).toBe(T0 + 30 * MINUTE_MS)
    expect(applyAction(doc, { type: 'start', minutes: 30 }, env(T0 + 1000))).toEqual({ ok: false, error: 'session_active' })
    expect(applyAction(doc, { type: 'claim' }, env(T0 + 29 * MINUTE_MS))).toEqual({ ok: false, error: 'not_finished' })

    const dev = env(T0 + 31 * MINUTE_MS, { dev: true })
    const claimed = applyAction(doc, { type: 'claim', devFocusLabel: 'studying' }, dev)
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return
    doc = claimed.doc
    expect(doc.player?.activeSession).toBeNull()
    expect(doc.timer).toBeNull()
    expect(claimed.result.outcome.result.minutes).toBe(30)
    expect(doc.outcome?.seen).toBe(false)
    expect(weeklyPoints(doc.player!, dev.now)).toBeGreaterThan(0)

    doc = must(doc, { type: 'dismissResults' }, dev)
    expect(doc.outcome?.seen).toBe(true)

    const enc = doc.player!.encounter
    expect(enc).not.toBeNull()
    const wave = enc!.waves[enc!.currentWave]!
    const thrown = applyAction(doc, { type: 'throwBall', ref: { waveIndex: wave.index, wildIndex: 0 }, ball: 'poke-ball' }, env(dev.now + 1000))
    expect(thrown.ok).toBe(true)
    if (thrown.ok) expect(['caught', 'failed', 'fled']).toContain(thrown.result.outcome.kind)

    doc = must(doc, { type: 'finishWaves' }, env(dev.now))
    expect(doc.player?.encounter).toBeNull()
    expect(applyAction(doc, { type: 'nextWave' }, env(dev.now))).toEqual({ ok: false, error: 'no_encounter' })
  })

  it('pause/resume shifts endsAt by the paused time; claim refuses while paused', () => {
    let doc = must(newPlayer(), { type: 'start', minutes: 20 }, env(T0))
    doc = must(doc, { type: 'pause' }, env(T0 + 5 * MINUTE_MS))
    expect(doc.timer?.pausedAt).toBe(T0 + 5 * MINUTE_MS)
    // pausing twice is a no-op
    expect(must(doc, { type: 'pause' }, env(T0 + 6 * MINUTE_MS)).timer?.pausedAt).toBe(T0 + 5 * MINUTE_MS)
    expect(applyAction(doc, { type: 'claim' }, env(T0 + 60 * MINUTE_MS))).toEqual({ ok: false, error: 'paused' })
    doc = must(doc, { type: 'resume' }, env(T0 + 8 * MINUTE_MS))
    expect(doc.timer).toMatchObject({ pausedAt: null, pausedMs: 3 * MINUTE_MS, endsAt: T0 + 23 * MINUTE_MS })
    expect(applyAction(doc, { type: 'claim' }, env(T0 + 22 * MINUTE_MS))).toEqual({ ok: false, error: 'not_finished' })
    const r = applyAction(doc, { type: 'claim' }, env(T0 + 23 * MINUTE_MS))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.result.outcome.result.minutes).toBe(20)
  })

  it('cannot pause after the end; cancel clears the session', () => {
    let doc = must(newPlayer(), { type: 'start', minutes: 20 }, env(T0))
    expect(applyAction(doc, { type: 'pause' }, env(T0 + 21 * MINUTE_MS))).toEqual({ ok: false, error: 'already_finished' })
    doc = must(doc, { type: 'cancel' }, env(T0 + MINUTE_MS))
    expect(doc.player?.activeSession).toBeNull()
    expect(doc.timer).toBeNull()
    expect(applyAction(doc, { type: 'cancel' }, env(T0))).toEqual({ ok: false, error: 'no_session' })
    expect(applyAction(doc, { type: 'claim' }, env(T0))).toEqual({ ok: false, error: 'no_session' })
    expect(applyAction(doc, { type: 'pause' }, env(T0))).toEqual({ ok: false, error: 'no_session' })
  })

  it('devFocusLabel is ignored without dev tools', () => {
    const doc = must(newPlayer(), { type: 'start', minutes: 30 }, env(T0))
    const end = T0 + 31 * MINUTE_MS
    const a = applyAction(doc, { type: 'claim', devFocusLabel: 'game' }, env(end))
    const b = applyAction(doc, { type: 'claim', devFocusLabel: null }, env(end))
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.result.outcome.result.focus).toBe(b.result.outcome.result.focus)
  })
})

describe('break', () => {
  it('a completed break is rewarded, one per session', () => {
    let doc = must(newPlayer(), { type: 'start', minutes: 15 }, env(T0))
    doc = must(doc, { type: 'claim' }, env(T0 + 16 * MINUTE_MS))
    expect(applyAction(doc, { type: 'endBreak' }, env(T0))).toEqual({ ok: false, error: 'no_break' })
    doc = must(doc, { type: 'startBreak', minutes: 5 }, env(T0 + 16 * MINUTE_MS))
    const early = applyAction(doc, { type: 'endBreak' }, env(T0 + 18 * MINUTE_MS))
    expect(early.ok && early.result).toEqual({ rewarded: false })
    const full = applyAction(doc, { type: 'endBreak' }, env(T0 + 22 * MINUTE_MS))
    expect(full.ok && full.result).toEqual({ rewarded: true })
    if (!full.ok) return
    expect(applyAction(full.doc, { type: 'startBreak', minutes: 5 }, env(T0 + 23 * MINUTE_MS))).toEqual({ ok: false, error: 'already_claimed' })
  })
})

describe('dev gating', () => {
  it('rejects dev actions without dev tools', () => {
    const doc = newPlayer()
    for (const a of [
      { type: 'devAddDust', amount: 100 },
      { type: 'devAddItems', items: { 'poke-ball': 3 } },
      { type: 'devAddCandies', amount: 3 },
      { type: 'devLevelUp', levels: 3 },
      { type: 'devAddRandomPokemon', count: 2 },
      { type: 'resetAll' },
    ] as GameAction[]) {
      expect(applyAction(doc, a, env(T0))).toEqual({ ok: false, error: 'dev_disabled' })
    }
  })
  it('applies them with dev tools', () => {
    let doc = newPlayer()
    const d = env(T0, { dev: true })
    doc = must(doc, { type: 'devAddDust', amount: 100 }, d)
    expect(doc.player?.dust).toBe(100)
    doc = must(doc, { type: 'devAddRandomPokemon', count: 3 }, d)
    expect(Object.keys(doc.player!.pokemon)).toHaveLength(4)
    doc = must(doc, { type: 'resetAll' }, d)
    expect(doc).toEqual(EMPTY_DOC)
  })
})

describe('box errors', () => {
  it('passes engine errors through', () => {
    const doc = newPlayer()
    expect(applyAction(doc, { type: 'release', uid: 'p1' }, env(T0))).toEqual({ ok: false, error: 'in_team' })
    expect(applyAction(doc, { type: 'setLeader', uid: 'nope' }, env(T0))).toEqual({ ok: false, error: 'unknown_pokemon' })
    expect(applyAction(doc, { type: 'claimMission', id: 'nope' }, env(T0)).ok).toBe(false)
  })
})

describe('timezone lock', () => {
  const DAY = 86_400_000
  it('allows one change, then locks it for 30 days outside dev mode', () => {
    let doc = must(newPlayer(), { type: 'updateProfile', patch: { timezone: 'America/Lima' } }, env(T0, { dev: false }))
    expect(doc.player?.profile.timezoneChangedAt).toBe(T0)
    const again: GameAction = { type: 'updateProfile', patch: { timezone: 'Europe/Madrid' } }
    expect(applyAction(doc, again, env(T0 + 29 * DAY, { dev: false }))).toEqual({ ok: false, error: 'timezone_locked' })
    // Same zone again is a no-op, not a lock violation.
    expect(applyAction(doc, { type: 'updateProfile', patch: { timezone: 'America/Lima' } }, env(T0 + DAY, { dev: false })).ok).toBe(true)
    doc = must(doc, again, env(T0 + 31 * DAY, { dev: false }))
    expect(doc.player?.profile.timezone).toBe('Europe/Madrid')
  })
  it('dev mode bypasses the lock', () => {
    const doc = must(newPlayer(), { type: 'updateProfile', patch: { timezone: 'America/Lima' } }, env(T0, { dev: true }))
    expect(applyAction(doc, { type: 'updateProfile', patch: { timezone: 'Asia/Tokyo' } }, env(T0 + DAY, { dev: true })).ok).toBe(true)
  })
})

describe('damage split', () => {
  const claimWith = (autoDamage: boolean | null) => {
    let doc = newPlayer()
    if (autoDamage !== null) doc = must(doc, { type: 'setAutoDamage', value: !autoDamage }, env(T0))
    doc = must(doc, { type: 'start', minutes: 30 }, env(T0))
    // The preference can still change during the session (and on the claim screen).
    if (autoDamage !== null) doc = must(doc, { type: 'setAutoDamage', value: autoDamage }, env(T0 + 10 * MINUTE_MS))
    return must(doc, { type: 'claim', devFocusLabel: 'studying' }, env(T0 + 31 * MINUTE_MS, { dev: true }))
  }
  const t = T0 + 32 * MINUTE_MS

  it('defaults to manual; assign, auto and the lock at the first ball', () => {
    let doc = claimWith(null)
    const enc = doc.player!.encounter!
    expect(enc.damageMode).toBe('manual')
    expect(enc.waves[0]!.wilds.every((w) => w.hpFraction === 1)).toBe(true)
    doc = must(doc, { type: 'assignDamage', waveIndex: 0, uid: 'p1', wildIndex: 0 }, env(t))
    expect(doc.player!.encounter!.waves[0]!.assignments).toEqual({ p1: 0 })
    expect(doc.player!.encounter!.waves[0]!.wilds[0]!.hpFraction).toBeLessThan(1)
    doc = must(doc, { type: 'assignDamage', waveIndex: 0, uid: 'p1', wildIndex: null }, env(t))
    doc = must(doc, { type: 'autoAssignDamage', waveIndex: 0 }, env(t))
    expect(doc.player!.encounter!.waves[0]!.assignments).toEqual({ p1: 'auto' })
    doc = must(doc, { type: 'throwBall', ref: { waveIndex: 0, wildIndex: 0 }, ball: 'poke-ball' }, env(t))
    expect(doc.player!.encounter!.waves[0]!.damageLocked).toBe(true)
    expect(applyAction(doc, { type: 'assignDamage', waveIndex: 0, uid: 'p1', wildIndex: 0 }, env(t))).toEqual({ ok: false, error: 'damage_locked' })
  })

  it('autoDamage on at claim: the encounter is automatic and keeps that mode after the preference changes', () => {
    let doc = claimWith(true)
    expect(doc.player!.autoDamage).toBe(true)
    expect(doc.player!.encounter!.damageMode).toBe('auto')
    doc = must(doc, { type: 'setAutoDamage', value: false }, env(t))
    expect(doc.player!.encounter!.damageMode).toBe('auto')
    expect(applyAction(doc, { type: 'assignDamage', waveIndex: 0, uid: 'p1', wildIndex: 0 }, env(t))).toEqual({ ok: false, error: 'damage_auto' })
  })
})
