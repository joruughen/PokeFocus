import { describe, expect, it } from 'vitest'
import { abilities, moves, species, types } from './index'

describe('game data', () => {
  it('is internally consistent', () => {
    const moveSlugs = new Set(moves.map((m) => m.slug))
    const abilitySlugs = new Set(abilities.map((a) => a.slug))
    const speciesIds = new Set(species.map((s) => s.id))
    expect(species.length).toBeGreaterThan(0)
    for (const s of species) {
      for (const a of s.abilities) expect(abilitySlugs.has(a.slug), `${s.slug}: ${a.slug}`).toBe(true)
      for (const m of [...s.learnset.levelUp.map((l) => l.move), ...s.learnset.egg, ...s.learnset.tutor, ...s.learnset.machine]) {
        expect(moveSlugs.has(m), `${s.slug}: ${m}`).toBe(true)
      }
      for (const e of s.evolutions) expect(speciesIds.has(e.to), `${s.slug} -> ${e.to}`).toBe(true)
      if (s.evolvesFrom !== null) expect(speciesIds.has(s.evolvesFrom)).toBe(true)
    }
  })

  it('has a complete 18 x 18 type chart', () => {
    const slugs = types.types.map((t) => t.slug)
    expect(slugs).toHaveLength(18)
    for (const attacker of slugs) {
      expect(Object.keys(types.chart[attacker]).sort()).toEqual([...slugs].sort())
    }
  })
})
