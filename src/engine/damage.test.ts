import { describe, expect, it } from 'vitest'
import { applyStatusCharge, rerollWild, throwBall } from './capture'
import { defaultContext } from './context'
import { counterDamage } from './counter'
import {
  assignDamage,
  autoAssignDamage,
  damageTokens,
  effectiveHits,
  estimateTokenDamage,
  isManualWave,
  lockWaveAttacks,
  lockWaveDamage,
  previewAssignment,
  setAutoDamage,
  wastedDamage,
} from './damage'
import { createRng } from './rng'
import { applySessionResult } from './session'
import type { PlayerState } from './state'
import { computeStats } from './stats'
import { makeMon, makePlayer, runSession, T0 } from './test-helpers'
import { damageFromHits, hpFractionAfter } from './waves'

const ctx = defaultContext()
const cfg = ctx.config
const rng = () => createRng(5)

/** Claim a 50-min session (2 waves) with a 2-member team, in auto or manual mode. Same rolls either way. */
function claimed(autoDamage: boolean | undefined, seed = 3, abilities: { a?: string; b?: string } = {}): PlayerState {
  const team = [makeMon('squirtle', 20, { uid: 'a', ability: abilities.a ?? null }), makeMon('charmander', 20, { uid: 'b', ability: abilities.b ?? null })]
  const base = makePlayer(team, autoDamage === undefined ? {} : { autoDamage })
  const { result, state } = runSession(base, 50, seed)
  const r = applySessionResult(state, result)
  if (!r.ok) throw new Error(r.error)
  return r.value.state
}

const wave0 = (s: PlayerState) => s.encounter!.waves[0]!
const must = <T,>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('damage split: modes', () => {
  it('auto mode is exactly the rolled split (no assignments)', () => {
    const s = claimed(true)
    expect(s.encounter!.damageMode).toBe('auto')
    const w = wave0(s)
    expect(isManualWave(w)).toBe(false)
    expect(w.assignments).toBeUndefined()
    w.wilds.forEach((x, i) => expect(x.damage).toBeCloseTo(damageFromHits(w.hits!, i, x, x.isLegendary, ctx)))
  })

  it('missing autoDamage (old docs) = manual: tokens unassigned, wilds at full HP', () => {
    const s = claimed(undefined)
    expect(s.encounter!.damageMode).toBe('manual')
    for (const w of s.encounter!.waves) {
      expect(isManualWave(w)).toBe(true)
      expect(w.damageLocked).toBe(false)
      for (const x of w.wilds) {
        expect(x.damage).toBe(0)
        expect(x.hpFraction).toBe(1)
      }
      const tokens = damageTokens(w)
      expect(tokens.map((t) => t.uid).sort()).toEqual(['a', 'b'])
      expect(tokens.every((t) => t.assigned === null && t.hits > 0)).toBe(true)
    }
  })

  it('setAutoDamage only changes the preference', () => {
    const s = claimed(false)
    const next = setAutoDamage(s, true)
    expect(next.autoDamage).toBe(true)
    expect(next.encounter!.damageMode).toBe('manual')
  })
})

describe('damage split: tokens and attacks (GDD §11.4)', () => {
  it('a token sums its hits by move; ×N matches the per-group count', () => {
    const w = wave0(claimed(false))
    for (const tk of damageTokens(w)) {
      const groups = w.hits!.filter((h) => h.uid === tk.uid)
      expect(tk.hits).toBe(groups.reduce((a, h) => a + Math.max(1, Math.round(h.units)), 0))
      expect(tk.moves.reduce((a, m) => a + m.hits, 0)).toBe(tk.hits)
      const units = groups.reduce((a, h) => a + h.units, 0)
      expect(tk.moves.reduce((a, m) => a + m.hit.units, 0)).toBeCloseTo(units)
    }
  })

  it('assigning is an attack: all of the token goes to that wild and the wild strikes back at the attacker', () => {
    const s = claimed(false)
    const w = wave0(s)
    const tk = damageTokens(w).find((t) => t.uid === 'a')!
    const next = must(assignDamage(s, { waveIndex: 0, uid: 'a', wildIndex: 0 }, rng()))
    const w1 = wave0(next)
    const est = estimateTokenDamage(tk, w.wilds[0]!)
    expect(w1.wilds[0]!.damage).toBeCloseTo(est.damage)
    expect(w1.wilds[0]!.hpFraction).toBeCloseTo(hpFractionAfter(est.damage, w.wilds[0]!.maxHp, cfg))
    expect(w1.wilds.slice(1).every((x) => x.damage === 0)).toBe(true)
    expect(previewAssignment(w, 'a', 0).wilds[0]!.damage).toBeCloseTo(est.damage)
    // The counterattack: on 'a', not on the leader... 'a' is the leader here, so check with b too.
    const atk = w1.attacks!.a!
    expect(atk.wildIndex).toBe(0)
    expect(atk.skipped).toBeNull()
    expect(atk.counter!.targetUid).toBe('a')
    expect(next.pokemon.a!.energy.current).toBeCloseTo(s.pokemon.a!.energy.current - atk.counter!.damage)
    const viaB = must(assignDamage(s, { waveIndex: 0, uid: 'b', wildIndex: 0 }, rng()))
    expect(wave0(viaB).attacks!.b!.counter!.targetUid).toBe('b')
    expect(viaB.pokemon.a!.energy.current).toBe(s.pokemon.a!.energy.current)
    expect(viaB.pokemon.b!.energy.current).toBeLessThan(s.pokemon.b!.energy.current)
  })

  it('the counter of an attack is the wild\'s best type against the attacker, ×damageMult', () => {
    const s = claimed(false)
    const wild = wave0(s).wilds[0]!
    const next = must(assignDamage(s, { waveIndex: 0, uid: 'b', wildIndex: 0 }, rng()))
    const c = wave0(next).attacks!.b!.counter!
    const b = s.pokemon.b!
    const st = computeStats(b, ctx)
    if (!c.missed && c.healed === 0) {
      const expected = Math.min(b.energy.current, counterDamage(st.hp, b.level, st.defense, wild.level, c.effectiveness, wild.isLegendary, cfg))
      expect(c.damage).toBeCloseTo(expected)
    }
    expect(cfg.capture.counter.damageMult).toBe(1.5)
  })

  it('attacks are irreversible: no reassigning, no taking back', () => {
    const s = must(assignDamage(claimed(false), { waveIndex: 0, uid: 'a', wildIndex: 0 }, rng()))
    expect(assignDamage(s, { waveIndex: 0, uid: 'a', wildIndex: 0 }, rng())).toEqual({ ok: false, error: 'already_attacked' })
    expect(assignDamage(s, { waveIndex: 0, uid: 'a', wildIndex: 1 }, rng())).toEqual({ ok: false, error: 'already_attacked' })
  })

  it('an exhausted member cannot attack, and the Auto button / lock leave it out', () => {
    const s0 = claimed(false)
    const s = { ...s0, pokemon: { ...s0.pokemon, b: { ...s0.pokemon.b!, energy: { ...s0.pokemon.b!.energy, current: 0 } } } }
    expect(assignDamage(s, { waveIndex: 0, uid: 'b', wildIndex: 0 }, rng())).toEqual({ ok: false, error: 'attacker_exhausted' })
    const auto = must(autoAssignDamage(s, 0, rng()))
    expect(wave0(auto).assignments).toEqual({ a: 'auto' })
    expect(effectiveHits(wave0(auto)).every((h) => h.uid === 'a')).toBe(true)
    expect(Object.keys(wave0(auto).attacks!)).toEqual(['a'])
  })

  it('a status technique that worked means no counterattack (asleep or paralyzed)', () => {
    const s0 = claimed(false)
    const charged: PlayerState = { ...s0, encounter: { ...s0.encounter!, charges: [{ id: 's1', kind: 'status', status: 'sleep', sourceUid: 'a', source: 'hypnosis' }] } }
    const slept = must(applyStatusCharge(charged, 's1', { waveIndex: 0, wildIndex: 0 }))
    const r = must(assignDamage(slept, { waveIndex: 0, uid: 'a', wildIndex: 0 }, rng()))
    expect(wave0(r).attacks!.a).toEqual({ wildIndex: 0, counter: null, skipped: 'asleep' })
    expect(r.pokemon.a!.energy.current).toBe(s0.pokemon.a!.energy.current)

    const s = { ...s0, encounter: { ...s0.encounter!, waves: s0.encounter!.waves.map((w, i) => (i === 0 ? { ...w, wilds: w.wilds.map((x) => ({ ...x, status: 'paralysis' as const })) } : w)) } }
    for (let seed = 1; seed < 20; seed++) {
      const p = must(assignDamage(s, { waveIndex: 0, uid: 'b', wildIndex: 0 }, createRng(seed)))
      expect(wave0(p).attacks!.b).toEqual({ wildIndex: 0, counter: null, skipped: 'paralyzed' })
      expect(p.pokemon.b!.energy.current).toBe(s0.pokemon.b!.energy.current)
    }
    // Without a status the same attack does draw a counterattack.
    expect(wave0(must(assignDamage(s0, { waveIndex: 0, uid: 'b', wildIndex: 0 }, rng()))).attacks!.b!.skipped).toBeNull()
  })

  it('counter abilities belong to the attacker (magic-guard, magic-bounce)', () => {
    const s = claimed(false, 3, { b: 'magic-guard' })
    const r = must(assignDamage(s, { waveIndex: 0, uid: 'b', wildIndex: 0 }, rng()))
    expect(wave0(r).attacks!.b!.counter!.damage).toBe(0)
    const s2 = claimed(false, 3, { b: 'magic-bounce' })
    const r2 = must(assignDamage(s2, { waveIndex: 0, uid: 'b', wildIndex: 0 }, rng()))
    const c = wave0(r2).attacks!.b!.counter!
    if (!c.missed) {
      expect(c.reflected).toBeGreaterThan(0)
      // The reflected HP survives the next attack's recompute.
      const r3 = must(assignDamage(r2, { waveIndex: 0, uid: 'a', wildIndex: 1 }, rng()))
      expect(wave0(r3).wilds[0]!.hpFraction).toBeCloseTo(wave0(r2).wilds[0]!.hpFraction)
    }
  })

  it('estimates carry per-move effectiveness', () => {
    const w = wave0(claimed(false))
    const tk = damageTokens(w)[0]!
    const est = estimateTokenDamage(tk, w.wilds[0]!)
    expect(est.moves).toHaveLength(tk.moves.length)
    expect(est.moves.reduce((a, m) => a + m.damage, 0)).toBeCloseTo(est.damage)
    for (const m of est.moves) expect(m.effectiveness).toBeGreaterThanOrEqual(0)
  })

  it('"Auto" button attacks with every token left (rolled split) and each draws one counterattack', () => {
    const auto = wave0(claimed(true))
    const s = claimed(false)
    const r = must(autoAssignDamage(s, 0, rng()))
    const w = wave0(r)
    expect(w.assignments).toEqual({ a: 'auto', b: 'auto' })
    expect(w.damageLocked).toBe(false)
    expect(Object.keys(w.attacks!).sort()).toEqual(['a', 'b'])
    for (const uid of ['a', 'b']) {
      const atk = w.attacks![uid]!
      expect(atk.wildIndex).not.toBeNull()
      if (atk.counter) expect(atk.counter.targetUid).toBe(uid)
    }
    auto.wilds.forEach((x, i) => {
      if (!w.wilds[i]!.extraHpLoss) expect(w.wilds[i]!.damage).toBeCloseTo(x.damage)
    })
    // Nothing left to send.
    expect(assignDamage(r, { waveIndex: 0, uid: 'a', wildIndex: 0 }, rng())).toEqual({ ok: false, error: 'already_attacked' })
  })

  it('manual wave: a ball makes nobody attack and does not lock; its counterattack goes to the leader', () => {
    const s0 = claimed(false)
    const r = must(assignDamage(s0, { waveIndex: 0, uid: 'b', wildIndex: 0 }, rng()))
    let t = null
    // Any wild of the wave and any seed whose throw fails (some wilds are near-certain catches).
    for (let seed = 1; seed < 200 && !t; seed++) {
      const x = throwBall(r, { waveIndex: 0, wildIndex: seed % wave0(r).wilds.length }, 'poke-ball', createRng(seed), T0 + 3_600_000)
      if (x.ok && x.value.outcome.kind === 'failed') t = x.value
    }
    expect(t).not.toBeNull()
    const w = wave0(t!.state)
    // Only 'b' attacked (the player sent it); 'a' was NOT made to attack by the throw, and the wave stays open.
    expect(w.damageLocked).toBeFalsy()
    expect(w.assignments).toEqual({ b: 0 })
    expect(Object.keys(w.attacks!)).toEqual(['b'])
    // The ball's counterattack goes to the leader ('a'), though 'b' hit that wild.
    if (t!.outcome.kind === 'failed' && t!.outcome.counter) expect(t!.outcome.counter.targetUid).toBe('a')
    // The player can still choose for 'a' after the throw.
    const later = assignDamage(t!.state, { waveIndex: 0, uid: 'a', wildIndex: 0 }, rng())
    expect(later.ok).toBe(true)
  })

  it('auto mode: the first ball turns the wave into all-auto attacks (same damage) with counterattacks', () => {
    const s = claimed(true)
    const locked = lockWaveAttacks(s, 0, rng())
    const w = wave0(locked)
    expect(w.damageLocked).toBe(true)
    expect(w.assignments).toEqual({ a: 'auto', b: 'auto' })
    expect(Object.keys(w.attacks!).sort()).toEqual(['a', 'b'])
    wave0(s).wilds.forEach((x, i) => {
      if (!w.wilds[i]!.extraHpLoss) expect(w.wilds[i]!.damage).toBeCloseTo(x.damage)
    })
    // Preview without counters = same damage.
    const pv = lockWaveDamage(wave0(s))
    wave0(s).wilds.forEach((x, i) => expect(pv.wilds[i]!.damage).toBeCloseTo(x.damage))
  })

  it('the throw uses the locked HP for the catch chance (same as auto mode)', () => {
    const auto = claimed(true)
    const manual = claimed(false)
    const ta = throwBall(auto, { waveIndex: 0, wildIndex: 0 }, 'poke-ball', createRng(4), T0 + 3_600_000)
    const tm = throwBall(manual, { waveIndex: 0, wildIndex: 0 }, 'poke-ball', createRng(4), T0 + 3_600_000)
    if (!ta.ok || !tm.ok) throw new Error('throw failed')
    expect(tm.value.outcome.chance).toBeCloseTo(ta.value.outcome.chance)
    expect(tm.value.outcome.kind).toBe(ta.value.outcome.kind)
  })

  it('status charges do not lock; a reroll keeps the slot\'s assigned damage for the new wild', () => {
    const s0 = claimed(false)
    const withCharges: PlayerState = {
      ...s0,
      encounter: {
        ...s0.encounter!,
        charges: [
          { id: 's1', kind: 'status', status: 'sleep', sourceUid: 'a', source: 'hypnosis' },
          { id: 'r1', kind: 'reroll', sourceUid: 'a', source: 'roar' },
        ],
      },
    }
    const a = must(assignDamage(withCharges, { waveIndex: 0, uid: 'a', wildIndex: 0 }, rng()))
    const st = must(applyStatusCharge(a, 's1', { waveIndex: 0, wildIndex: 0 }))
    expect(wave0(st).damageLocked).toBe(false)
    const rr = must(rerollWild(st, 'r1', { waveIndex: 0, wildIndex: 0 }, createRng(11)))
    const w = wave0(rr)
    const tk = damageTokens(w).find((t) => t.uid === 'a')!
    expect(w.wilds[0]!.damage).toBeCloseTo(estimateTokenDamage(tk, w.wilds[0]!).damage)
    expect(w.wilds[0]!.damage).toBeGreaterThan(0)
    expect(assignDamage(rr, { waveIndex: 0, uid: 'b', wildIndex: 0 }, rng()).ok).toBe(true)
  })

  it('wasted damage is what goes past the HP floor', () => {
    expect(wastedDamage({ damage: 50, maxHp: 100 }, cfg)).toBe(0)
    expect(wastedDamage({ damage: 120, maxHp: 100 }, cfg)).toBeCloseTo(120 - (1 - cfg.capture.minHpFraction) * 100)
  })

  it('rule errors', () => {
    const s = claimed(false)
    expect(assignDamage(s, { waveIndex: 0, uid: 'zz', wildIndex: 0 }, rng())).toEqual({ ok: false, error: 'unknown_token' })
    expect(assignDamage(s, { waveIndex: 0, uid: 'a', wildIndex: 42 }, rng())).toEqual({ ok: false, error: 'unknown_wild' })
    expect(assignDamage(s, { waveIndex: 7, uid: 'a', wildIndex: 0 }, rng())).toEqual({ ok: false, error: 'unknown_wave' })
    const later = { ...s, encounter: { ...s.encounter!, currentWave: 1 } }
    expect(assignDamage(later, { waveIndex: 0, uid: 'a', wildIndex: 0 }, rng())).toEqual({ ok: false, error: 'wave_passed' })
    // A future wave can be attacked already.
    expect(assignDamage(s, { waveIndex: 1, uid: 'a', wildIndex: 0 }, rng()).ok).toBe(true)
    expect(assignDamage(claimed(true), { waveIndex: 0, uid: 'a', wildIndex: 0 }, rng())).toEqual({ ok: false, error: 'damage_auto' })
    expect(autoAssignDamage({ ...s, encounter: null }, 0, rng())).toEqual({ ok: false, error: 'no_encounter' })
  })

  it('legacy waves (no hits) stay automatic and unchanged by the lock', () => {
    const s = claimed(false)
    const legacy = { ...wave0(s), hits: undefined, assignments: undefined, damageLocked: undefined }
    expect(isManualWave(legacy)).toBe(false)
    expect(lockWaveDamage(legacy)).toBe(legacy)
    expect(damageTokens(legacy)).toEqual([])
    const st = { ...s, encounter: { ...s.encounter!, waves: [legacy, ...s.encounter!.waves.slice(1)] } }
    expect(lockWaveAttacks(st, 0, rng())).toBe(st)
  })
})
