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

  it('claim takes the group overlap from env (Fairy proportional), never from the action', () => {
    const base = newPlayer()
    const p1 = base.player!.pokemon.p1!
    // A Fairy-type team member (swap the starter's species).
    let doc: GameDoc = { ...base, player: { ...base.player!, pokemon: { p1: { ...p1, speciesSlug: 'clefairy', equippedMoves: [], learnedMoves: [] } } } }
    doc = must(doc, { type: 'start', minutes: 30 }, env(T0))
    const fairy = 1.4
    const solo = applyAction(doc, { type: 'claim' }, env(T0 + 31 * MINUTE_MS))
    const half = applyAction(doc, { type: 'claim' }, env(T0 + 31 * MINUTE_MS, { friendOverlap: 0.5 }))
    expect(solo.ok && half.ok).toBe(true)
    if (!solo.ok || !half.ok) return
    expect(solo.result.outcome.result.friendOverlap).toBeNull()
    expect(solo.result.outcome.result.members[0]?.conditionType).not.toBe('fairy')
    expect(half.result.outcome.result.friendOverlap).toBe(0.5)
    expect(half.result.outcome.result.members[0]).toMatchObject({ conditionType: 'fairy' })
    expect(half.result.outcome.result.members[0]?.conditionMult).toBeCloseTo(1 + (fairy - 1) * 0.5)
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

  it('cancel after the end is refused (claim it, with the late rules)', () => {
    const doc = must(newPlayer(), { type: 'start', minutes: 50 }, env(T0))
    expect(applyAction(doc, { type: 'cancel' }, env(T0 + 50 * MINUTE_MS))).toEqual({ ok: false, error: 'already_finished' })
    expect(applyAction(doc, { type: 'cancel' }, env(T0 + 3 * 60 * MINUTE_MS))).toEqual({ ok: false, error: 'already_finished' })
  })

  it('cancelling a short session (≤ 25 min) keeps nothing', () => {
    const doc = must(newPlayer(), { type: 'start', minutes: 25 }, env(T0))
    const r = applyAction(doc, { type: 'cancel' }, env(T0 + 20 * MINUTE_MS))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.outcome).toBeNull()
    expect(r.doc.player?.history).toHaveLength(0)
    expect(r.doc.player?.activeSession).toBeNull()
  })

  it('cancelling a long session before 15 min keeps nothing', () => {
    const doc = must(newPlayer(), { type: 'start', minutes: 50 }, env(T0))
    const r = applyAction(doc, { type: 'cancel' }, env(T0 + 14 * MINUTE_MS + 59_000))
    expect(r.ok && r.result.outcome).toBeNull()
    if (r.ok) expect(r.doc.player?.history).toHaveLength(0)
  })

  it('cancelling a long session keeps the minutes studied and the waves of full blocks', () => {
    const doc = must(newPlayer(), { type: 'start', minutes: 100 }, env(T0))
    // 20 min: rewards of 20 min, no wave, no Poké Balls.
    const a = applyAction(doc, { type: 'cancel' }, env(T0 + 20 * MINUTE_MS + 30_000))
    expect(a.ok).toBe(true)
    if (!a.ok || !a.result.outcome) throw new Error('expected an outcome')
    const ra = a.result.outcome.result
    expect(ra).toMatchObject({ cancelled: true, minutes: 20, lateClaim: false, pokeBalls: 0, valid: true })
    expect(ra.waves).toHaveLength(0)
    expect(ra.totalPoints).toBeGreaterThan(0)
    expect(ra.dust).toBeGreaterThan(0)
    expect(a.doc.player?.encounter).toBeNull()
    expect(a.doc.player?.history.at(-1)).toMatchObject({ cancelled: true, minutes: 20 })
    expect(a.doc.outcome?.seen).toBe(false)
    expect(a.doc.timer).toBeNull()
    // 60 min: 2 full blocks → 2 waves.
    const b = applyAction(doc, { type: 'cancel' }, env(T0 + 60 * MINUTE_MS))
    if (!b.ok || !b.result.outcome) throw new Error('expected an outcome')
    expect(b.result.outcome.result.minutes).toBe(60)
    expect(b.result.outcome.result.waves).toHaveLength(2)
    expect(b.doc.player?.encounter?.waves).toHaveLength(2)
  })

  it('cancel while paused counts the time up to the pause, never a late claim', () => {
    let doc = must(newPlayer(), { type: 'start', minutes: 75 }, env(T0))
    doc = must(doc, { type: 'pause' }, env(T0 + 30 * MINUTE_MS))
    // Paused for hours (past the planned end): still 30 min, not late, 1 wave.
    const r = applyAction(doc, { type: 'cancel' }, env(T0 + 5 * 60 * MINUTE_MS))
    if (!r.ok || !r.result.outcome) throw new Error('expected an outcome')
    expect(r.result.outcome.result).toMatchObject({ minutes: 30, lateClaim: false, focus: 1 })
    expect(r.result.outcome.result.waves).toHaveLength(1)
    // Resumed later: the paused time does not count.
    doc = must(doc, { type: 'resume' }, env(T0 + 40 * MINUTE_MS))
    const r2 = applyAction(doc, { type: 'cancel' }, env(T0 + 66 * MINUTE_MS))
    if (!r2.ok || !r2.result.outcome) throw new Error('expected an outcome')
    expect(r2.result.outcome.result.minutes).toBe(56)
    expect(r2.result.outcome.result.waves).toHaveLength(2)
  })

  it('cancelling never yields more than completing the same session', () => {
    const doc = must(newPlayer(), { type: 'start', minutes: 100 }, env(T0))
    const full = applyAction(doc, { type: 'claim' }, env(T0 + 101 * MINUTE_MS, { rng: createRng('same') }))
    if (!full.ok) throw new Error('claim')
    const f = full.result.outcome.result
    for (const m of [15, 24, 25, 49, 50, 75, 99]) {
      const c = applyAction(doc, { type: 'cancel' }, env(T0 + m * MINUTE_MS, { rng: createRng('same') }))
      if (!c.ok || !c.result.outcome) throw new Error(`cancel at ${m}`)
      const r = c.result.outcome.result
      expect(r.minutes).toBe(m)
      expect(r.waves.length).toBe(Math.floor(m / 25))
      expect(r.waves.length).toBeLessThan(f.waves.length)
      expect(r.dust).toBeLessThan(f.dust)
      expect(r.totalPoints).toBeLessThan(f.totalPoints)
      expect(r.pokeBalls).toBeLessThanOrEqual(f.pokeBalls)
      const exp = (x: typeof r) => x.members.reduce((a, mm) => a + mm.exp, 0)
      expect(exp(r)).toBeLessThan(exp(f))
    }
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

describe('releaseMany', () => {
  function withBox(): GameDoc {
    const doc = newPlayer()
    const p = doc.player!
    const mon = (slug: string, uid: string) => ({ ...p.pokemon.p1!, uid, speciesSlug: slug })
    return { ...doc, player: { ...p, pokemon: { ...p.pokemon, p2: mon('charmander', 'p2'), p3: mon('squirtle', 'p3') } } }
  }
  it('releases the box Pokémon and returns the candies', () => {
    const r = applyAction(withBox(), { type: 'releaseMany', uids: ['p2', 'p3'] }, env(T0))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.doc.player!.pokemon)).toEqual(['p1'])
    expect(r.result).toMatchObject({ released: 2, totalCandies: 2 })
  })
  it('fails as a whole and leaves the doc intact', () => {
    const doc = withBox()
    expect(applyAction(doc, { type: 'releaseMany', uids: ['p2', 'p1'] }, env(T0))).toEqual({ ok: false, error: 'in_team' })
    expect(applyAction(doc, { type: 'releaseMany', uids: ['p2', 'zz'] }, env(T0))).toEqual({ ok: false, error: 'unknown_pokemon' })
    expect(applyAction(doc, { type: 'releaseMany', uids: [] }, env(T0))).toEqual({ ok: false, error: 'empty_selection' })
    expect(applyAction(EMPTY_DOC, { type: 'releaseMany', uids: ['p2'] }, env(T0))).toEqual({ ok: false, error: 'no_player' })
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

  it('defaults to manual; an assignment is a persistent, irreversible attack with its counterattack', () => {
    let doc = claimWith(null)
    const enc = doc.player!.encounter!
    expect(enc.damageMode).toBe('manual')
    expect(enc.waves[0]!.wilds.every((w) => w.hpFraction === 1)).toBe(true)
    const energy = doc.player!.pokemon.p1!.energy.current
    doc = must(doc, { type: 'assignDamage', waveIndex: 0, uid: 'p1', wildIndex: 0 }, env(t))
    const w = doc.player!.encounter!.waves[0]!
    expect(w.assignments).toEqual({ p1: 0 })
    expect(w.wilds[0]!.hpFraction).toBeLessThan(1)
    expect(w.attacks?.p1?.wildIndex).toBe(0)
    const c = w.attacks!.p1!.counter
    if (c) expect(doc.player!.pokemon.p1!.energy.current).toBeCloseTo(energy - c.damage + c.healed)
    // No reassigning, no Auto over an attack already made.
    expect(applyAction(doc, { type: 'assignDamage', waveIndex: 0, uid: 'p1', wildIndex: 1 }, env(t))).toEqual({ ok: false, error: 'already_attacked' })
    doc = must(doc, { type: 'autoAssignDamage', waveIndex: 0 }, env(t))
    expect(doc.player!.encounter!.waves[0]!.assignments).toEqual({ p1: 0 })
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

describe('trainer level-up window (ackLevelUp)', () => {
  const pending = [{ from: 1, to: 3, items: { 'poke-ball': 6 }, dust: 130, at: T0 }]

  it('empties pendingLevelUps, touches nothing else and is idempotent', () => {
    const doc = newPlayer()
    const withPending: GameDoc = { ...doc, player: { ...doc.player!, dust: 130, inventory: { 'poke-ball': 6 }, pendingLevelUps: pending } }
    const acked = must(withPending, { type: 'ackLevelUp' }, env(T0 + 1))
    expect(acked.player!.pendingLevelUps).toBeUndefined()
    expect(acked.player!.dust).toBe(130)
    expect(acked.player!.inventory).toEqual({ 'poke-ball': 6 })
    expect(must(acked, { type: 'ackLevelUp' }, env(T0 + 2)).player).toEqual(acked.player)
  })

  it('works for an old save with no pendingLevelUps, and needs a player', () => {
    const doc = newPlayer()
    expect(doc.player!.pendingLevelUps).toBeUndefined()
    expect(must(doc, { type: 'ackLevelUp' }, env(T0)).player).toEqual(doc.player)
    expect(applyAction(EMPTY_DOC, { type: 'ackLevelUp' }, env(T0))).toEqual({ ok: false, error: 'no_player' })
  })

  it('a claimed session that raises the trainer level leaves the notice in the doc (and a JSON round trip keeps it)', () => {
    const doc0 = newPlayer()
    let doc: GameDoc = { ...doc0, player: { ...doc0.player!, trainer: { level: 1, exp: 99 } } }
    doc = must(doc, { type: 'start', minutes: 30 }, env(T0))
    const dev = env(T0 + 31 * MINUTE_MS, { dev: true })
    doc = must(doc, { type: 'claim', devFocusLabel: 'studying' }, dev)
    expect(doc.player!.trainer.level).toBeGreaterThanOrEqual(2)
    const n = doc.player!.pendingLevelUps
    expect(n).toHaveLength(1)
    expect(n![0]!.from).toBe(1)
    expect(n![0]!.dust).toBeGreaterThan(0)
    const reloaded = JSON.parse(JSON.stringify(doc)) as GameDoc
    expect(reloaded.player!.pendingLevelUps).toEqual(n)
    expect(must(reloaded, { type: 'ackLevelUp' }, dev).player!.pendingLevelUps).toBeUndefined()
  })
})

describe('trade arrival window (ackTrade)', () => {
  it('empties pendingTrades, is idempotent and needs a player', () => {
    const doc = newPlayer()
    const arrival = { uid: 'p9', fromSpecies: 'kadabra', toSpecies: 'alakazam', shiny: false, partnerName: 'Ash', at: T0 }
    const withPending: GameDoc = { ...doc, player: { ...doc.player!, pendingTrades: [arrival] } }
    const acked = must(withPending, { type: 'ackTrade' }, env(T0 + 1))
    expect(acked.player!.pendingTrades).toBeUndefined()
    expect(must(acked, { type: 'ackTrade' }, env(T0 + 2)).player).toEqual(acked.player)
    expect(applyAction(EMPTY_DOC, { type: 'ackTrade' }, env(T0))).toEqual({ ok: false, error: 'no_player' })
  })
})
