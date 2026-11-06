import { describe, expect, it } from 'vitest'
import { defaultContext, type SessionResult } from '../../../engine'
import { makeMon, makePlayer, MIN, runSession, T0 } from '../../../engine/test-helpers'
import { chargesBy, conditionLines, wildFactors } from './sessionReportModel'

const cfg = defaultContext().config

describe('session report model', () => {
  it('lists why these wilds: time, conditions, team, sound (no mic), Magnet Pull source, league', () => {
    const mag = makeMon('magnemite', 20, { uid: 'm', ability: 'magnet-pull' })
    const r = runSession(makePlayer([mag]), 50, 1, { startedAt: T0 + 11 * 60 * MIN }).result
    const f = wildFactors(r, cfg)
    expect(f[0]).toEqual({ kind: 'time', hour: 21, period: 'night' })
    const cond = f.find((x) => x.kind === 'conditions')
    expect(cond && cond.kind === 'conditions' && cond.types).toContain('ghost')
    expect(f.find((x) => x.kind === 'sound')).toMatchObject({ dominant: null })
    expect(f.find((x) => x.kind === 'typeWeight')).toMatchObject({ type: 'steel', mult: 2, uid: 'm', source: 'magnet-pull' })
    expect(f.find((x) => x.kind === 'league')).toMatchObject({ league: r.league, sizes: r.waves.map((w) => w.wilds.length) })
  })

  it('degrades for results saved before the log', () => {
    const mag = makeMon('magnemite', 20, { uid: 'm', ability: 'magnet-pull' })
    const r = runSession(makePlayer([mag]), 25).result
    const legacy: SessionResult = { ...r, wildFactors: undefined, members: r.members.map(({ conditionLog: _c, activables: _a, passives: _p, damageMoves: _d, ...m }) => m) }
    expect(wildFactors(legacy, cfg).find((x) => x.kind === 'typeWeight')).toMatchObject({ type: 'steel', uid: null })
    expect(() => conditionLines(legacy.members[0]!, legacy)).not.toThrow()
  })

  it('charges by member and condition lines with mult > 1 only', () => {
    const g = makeMon('gastly', 20, { uid: 'g' })
    const r = runSession(makePlayer([g]), 25, 1, { startedAt: T0 + 11 * 60 * MIN }).result
    const lines = conditionLines(r.members[0]!, r)
    expect(lines.every((l) => l.mult > 1)).toBe(true)
    expect(lines[0]?.type).toBe('ghost')
    expect(chargesBy({ charges: [{ id: 'c1', kind: 'status', status: 'sleep', sourceUid: 'g', source: 'hypnosis' }] }, 'g')).toHaveLength(1)
    expect(chargesBy({ charges: [{ id: 'c1', kind: 'status', status: 'sleep', sourceUid: 'x', source: 'hypnosis' }] }, 'g')).toHaveLength(0)
  })
})
