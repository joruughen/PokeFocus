import { describe, expect, it } from 'vitest'
import { releasePokemon, savePreset } from '../../../engine'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import { presetRows } from './presets'

const mon = (slug: string, uid: string) => makeMon(slug, 10, { uid })

describe('presetRows', () => {
  const all = [mon('pikachu', 'a'), mon('squirtle', 'b'), mon('pidgey', 'c')]
  const base = makePlayer([all[0]!, all[1]!], { pokemon: Object.fromEntries(all.map((p) => [p.uid, p])) })

  it('marks the preset equal to the current team (same order) as active', () => {
    const r = savePreset(base, 'Duo')
    if (!r.ok) throw new Error(r.error)
    expect(presetRows(r.value.state)[0]).toMatchObject({ active: true, missing: 0 })
    // Same members, different order: not active.
    expect(presetRows({ ...r.value.state, team: ['b', 'a'] })[0]?.active).toBe(false)
  })
  it('counts released members and keeps the rest', () => {
    const r = savePreset({ ...base, team: ['c', 'a'] }, 'Otro')
    if (!r.ok) throw new Error(r.error)
    const g = releasePokemon({ ...r.value.state, team: ['a'] }, 'c')
    if (!g.ok) throw new Error(g.error)
    const row = presetRows(g.value)[0]!
    expect(row.missing).toBe(1)
    expect(row.members.map((m) => m.uid)).toEqual(['a'])
    expect(row.active).toBe(false)
  })
  it('is empty for saves without presets', () => {
    expect(presetRows(base)).toEqual([])
  })
})
