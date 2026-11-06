import { describe, expect, it } from 'vitest'
import { applyStatusCharge, rerollWild, throwBall } from './capture'
import { defaultContext } from './context'
import {
  assignDamage,
  autoAssignDamage,
  damageTokens,
  effectiveHits,
  estimateTokenDamage,
  isManualWave,
  lockWaveDamage,
  previewAssignment,
  setAutoDamage,
  wastedDamage,
} from './damage'
import { createRng } from './rng'
import { applySessionResult } from './session'
import type { PlayerState } from './state'
import { makeMon, makePlayer, runSession, T0 } from './test-helpers'
import { damageFromHits, hpFractionAfter } from './waves'

const ctx = defaultContext()
const cfg = ctx.config

/** Claim a 50-min session (2 waves) with a 2-member team, in auto or manual mode. Same rolls either way. */
function claimed(autoDamage: boolean | undefined, seed = 3): PlayerState {
  const team = [makeMon('squirtle', 20, { uid: 'a' }), makeMon('charmander', 20, { uid: 'b' })]
  const base = makePlayer(team, autoDamage === undefined ? {} : { autoDamage })
  const { result, state } = runSession(base, 50, seed)
  const r = applySessionResult(state, result)
  if (!r.ok) throw new Error(r.error)
  return r.value.state
}

const wave0 = (s: PlayerState) => s.encounter!.waves[0]!

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

describe('damage split: tokens and assignment', () => {
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

  it('assigning sends all of a token to one wild; reassigning and unassigning move it', () => {
    const s = claimed(false)
    const w = wave0(s)
    const tk = damageTokens(w).find((t) => t.uid === 'a')!
    const r = assignDamage(s, { waveIndex: 0, uid: 'a', wildIndex: 0 })
    if (!r.ok) throw new Error(r.error)
    const w1 = wave0(r.value)
    const est = estimateTokenDamage(tk, w.wilds[0]!)
    expect(w1.wilds[0]!.damage).toBeCloseTo(est.damage)
    expect(w1.wilds[0]!.hpFraction).toBeCloseTo(hpFractionAfter(est.damage, w.wilds[0]!.maxHp, cfg))
    expect(w1.wilds.slice(1).every((x) => x.damage === 0)).toBe(true)
    // Preview = what the server computes.
    expect(previewAssignment(w, 'a', 0).wilds[0]!.damage).toBeCloseTo(est.damage)

    if (w.wilds.length > 1) {
      const r2 = assignDamage(r.value, { waveIndex: 0, uid: 'a', wildIndex: 1 })
      if (!r2.ok) throw new Error(r2.error)
      expect(wave0(r2.value).wilds[0]!.damage).toBe(0)
      expect(wave0(r2.value).wilds[1]!.damage).toBeCloseTo(estimateTokenDamage(tk, w.wilds[1]!).damage)
    }
    const r3 = assignDamage(r.value, { waveIndex: 0, uid: 'a', wildIndex: null })
    if (!r3.ok) throw new Error(r3.error)
    expect(wave0(r3.value).wilds.every((x) => x.damage === 0)).toBe(true)
    expect(wave0(r3.value).assignments).toEqual({})
  })

  it('estimates carry per-move effectiveness', () => {
    const w = wave0(claimed(false))
    const tk = damageTokens(w)[0]!
    const est = estimateTokenDamage(tk, w.wilds[0]!)
    expect(est.moves).toHaveLength(tk.moves.length)
    expect(est.moves.reduce((a, m) => a + m.damage, 0)).toBeCloseTo(est.damage)
    for (const m of est.moves) expect(m.effectiveness).toBeGreaterThanOrEqual(0)
  })

  it('"Auto" button and the lock both give today\'s split for unassigned tokens', () => {
    const auto = wave0(claimed(true))
    const s = claimed(false)
    const r = autoAssignDamage(s, 0)
    if (!r.ok) throw new Error(r.error)
    const viaButton = wave0(r.value)
    expect(Object.values(viaButton.assignments!)).toEqual(['auto', 'auto'])
    expect(viaButton.damageLocked).toBe(false)
    const viaLock = lockWaveDamage(wave0(s))
    expect(viaLock.damageLocked).toBe(true)
    auto.wilds.forEach((x, i) => {
      expect(viaButton.wilds[i]!.damage).toBeCloseTo(x.damage)
      expect(viaLock.wilds[i]!.hpFraction).toBeCloseTo(x.hpFraction)
    })
    // Auto-assigned tokens can still be moved before the lock.
    expect(assignDamage(r.value, { waveIndex: 0, uid: 'a', wildIndex: 0 }).ok).toBe(true)
  })

  it('the first ball locks the wave; unassigned tokens go auto, assigned ones stay', () => {
    const s0 = claimed(false)
    const r = assignDamage(s0, { waveIndex: 0, uid: 'a', wildIndex: 0 })
    if (!r.ok) throw new Error(r.error)
    const t = throwBall(r.value, { waveIndex: 0, wildIndex: 0 }, 'poke-ball', createRng(9), T0 + 3_600_000)
    if (!t.ok) throw new Error(t.error)
    const w = wave0(t.value.state)
    expect(w.damageLocked).toBe(true)
    expect(w.assignments).toEqual({ a: 0, b: 'auto' })
    expect(assignDamage(t.value.state, { waveIndex: 0, uid: 'a', wildIndex: null })).toEqual({ ok: false, error: 'damage_locked' })
    expect(autoAssignDamage(t.value.state, 0)).toEqual({ ok: false, error: 'damage_locked' })
    // Effective hits: all of a's hits on slot 0, b's as rolled.
    const eff = effectiveHits(w)
    expect(eff.filter((h) => h.uid === 'a').every((h) => h.target === 0)).toBe(true)
    expect(eff.filter((h) => h.uid === 'b')).toEqual(w.hits!.filter((h) => h.uid === 'b'))
    // The next wave is still open.
    expect(wave0(t.value.state).index).toBe(0)
    expect(t.value.state.encounter!.waves[1]!.damageLocked).toBe(false)
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
    const a = assignDamage(withCharges, { waveIndex: 0, uid: 'a', wildIndex: 0 })
    if (!a.ok) throw new Error(a.error)
    const st = applyStatusCharge(a.value, 's1', { waveIndex: 0, wildIndex: 0 })
    if (!st.ok) throw new Error(st.error)
    expect(wave0(st.value).damageLocked).toBe(false)
    const rr = rerollWild(st.value, 'r1', { waveIndex: 0, wildIndex: 0 }, createRng(11))
    if (!rr.ok) throw new Error(rr.error)
    const w = wave0(rr.value)
    const tk = damageTokens(w).find((t) => t.uid === 'a')!
    expect(w.wilds[0]!.damage).toBeCloseTo(estimateTokenDamage(tk, w.wilds[0]!).damage)
    expect(w.wilds[0]!.damage).toBeGreaterThan(0)
    // Still editable after the reroll.
    expect(assignDamage(rr.value, { waveIndex: 0, uid: 'b', wildIndex: 0 }).ok).toBe(true)
  })

  it('wasted damage is what goes past the HP floor', () => {
    expect(wastedDamage({ damage: 50, maxHp: 100 }, cfg)).toBe(0)
    expect(wastedDamage({ damage: 120, maxHp: 100 }, cfg)).toBeCloseTo(120 - (1 - cfg.capture.minHpFraction) * 100)
  })

  it('rule errors', () => {
    const s = claimed(false)
    expect(assignDamage(s, { waveIndex: 0, uid: 'zz', wildIndex: 0 })).toEqual({ ok: false, error: 'unknown_token' })
    expect(assignDamage(s, { waveIndex: 0, uid: 'a', wildIndex: 42 })).toEqual({ ok: false, error: 'unknown_wild' })
    expect(assignDamage(s, { waveIndex: 7, uid: 'a', wildIndex: 0 })).toEqual({ ok: false, error: 'unknown_wave' })
    const later = { ...s, encounter: { ...s.encounter!, currentWave: 1 } }
    expect(assignDamage(later, { waveIndex: 0, uid: 'a', wildIndex: 0 })).toEqual({ ok: false, error: 'wave_passed' })
    // A future wave can be prepared.
    expect(assignDamage(s, { waveIndex: 1, uid: 'a', wildIndex: 0 }).ok).toBe(true)
    expect(assignDamage(claimed(true), { waveIndex: 0, uid: 'a', wildIndex: 0 })).toEqual({ ok: false, error: 'damage_auto' })
    expect(autoAssignDamage({ ...s, encounter: null }, 0)).toEqual({ ok: false, error: 'no_encounter' })
  })

  it('legacy waves (no hits) stay automatic and unchanged by the lock', () => {
    const s = claimed(false)
    const legacy = { ...wave0(s), hits: undefined, assignments: undefined, damageLocked: undefined }
    expect(isManualWave(legacy)).toBe(false)
    expect(lockWaveDamage(legacy)).toBe(legacy)
    expect(damageTokens(legacy)).toEqual([])
  })
})
