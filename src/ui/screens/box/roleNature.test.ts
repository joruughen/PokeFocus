import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { defaultContext, STAT_KEYS, type SpeciesRole } from '../../../engine'
import { ROLE_STAT, roleNatureFit } from './roleNature'

const ctx = defaultContext()
const nature = (slug: string) => {
  const n = ctx.naturesBySlug.get(slug)
  if (!n) throw new Error(`no nature ${slug}`)
  return n
}
const ROLES = Object.keys(ROLE_STAT) as SpeciesRole[]

describe('roleNatureFit', () => {
  it('a Relaxed Sprinter (Relaxed lowers Speed) works against its role', () => {
    expect(nature('relaxed')).toMatchObject({ increased: 'defense', decreased: 'speed' })
    expect(roleNatureFit('sprinter', nature('relaxed'))).toEqual({ kind: 'against', role: 'sprinter', stat: 'speed' })
  })

  it('a Jolly Sprinter (Jolly raises Speed) works with its role', () => {
    expect(roleNatureFit('sprinter', nature('jolly'))).toEqual({ kind: 'with', role: 'sprinter', stat: 'speed' })
  })

  it('says nothing for a neutral nature or one that touches other stats', () => {
    expect(roleNatureFit('sprinter', nature('hardy'))).toBeNull() // neutral
    expect(roleNatureFit('sprinter', nature('modest'))).toBeNull() // +Sp. Atk, −Atk: not Speed
    expect(roleNatureFit('scholar', nature('relaxed'))).toBeNull()
  })

  it('says nothing without a role, without a nature, or for roles that are not tied to a stat', () => {
    expect(roleNatureFit(undefined, nature('relaxed'))).toBeNull()
    expect(roleNatureFit('sprinter', undefined)).toBeNull()
    for (const n of ctx.data.natures) {
      expect(roleNatureFit('support', n)).toBeNull()
      expect(roleNatureFit('allrounder', n)).toBeNull()
      expect(roleNatureFit('marathoner', n)).toBeNull() // Energy (HP) is never changed by a nature
    }
  })

  it('agrees with the nature definition for every role and every nature', () => {
    for (const n of ctx.data.natures) {
      for (const role of ROLES) {
        const stat = ROLE_STAT[role]
        const fit = roleNatureFit(role, n)
        if (!stat || stat === 'hp') expect(fit).toBeNull()
        else if (n.decreased === stat) expect(fit).toEqual({ kind: 'against', role, stat })
        else if (n.increased === stat) expect(fit).toEqual({ kind: 'with', role, stat })
        else expect(fit).toBeNull()
      }
    }
  })
})

describe('ROLE_STAT matches the engine data', () => {
  it('uses real stat keys', () => {
    for (const stat of Object.values(ROLE_STAT)) if (stat) expect(STAT_KEYS).toContain(stat)
  })

  it('most species with a role have that role stat among their highest base stats', () => {
    // The role is curated by hand, so a few species differ on purpose (a Blastoise is a Guardian
    // although Sp. Def is its top stat); the mapping is wrong if most of a role's species do not match.
    for (const role of ROLES) {
      const stat = ROLE_STAT[role]
      if (!stat) continue
      const species = ctx.data.species.filter((s) => s.role === role)
      expect(species.length, role).toBeGreaterThan(0)
      const matching = species.filter((s) => s.baseStats[stat] === Math.max(...STAT_KEYS.map((k) => s.baseStats[k])))
      expect(matching.length / species.length, role).toBeGreaterThanOrEqual(0.6)
    }
  })

  it('every role in the data is a known role', () => {
    for (const s of ctx.data.species) if (s.role) expect(ROLES, s.slug).toContain(s.role)
  })
})

describe('notice copy', () => {
  // Roles whose stat a nature can raise or lower get one sentence per direction, in both languages.
  const touchable = new Set(ctx.data.natures.flatMap((n) => [n.increased, n.decreased]).filter((s) => s !== null))
  const roles = ROLES.filter((r) => ROLE_STAT[r] && touchable.has(ROLE_STAT[r] as never))

  for (const lng of ['es', 'en'] as const) {
    it(`has a sentence naming the nature, the stat and the role (${lng})`, () => {
      const t = i18n.getFixedT(lng)
      expect(roles.length).toBeGreaterThanOrEqual(5)
      for (const kind of ['against', 'with'] as const) {
        for (const role of roles) {
          const text = t(`roleInfo.${kind}.${role}`, { nature: 'NATURE_X' })
          expect(text, `${kind}.${role}`).not.toMatch(/roleInfo\./)
          expect(text).toContain('NATURE_X')
          expect(text).toContain(t(`stats.${ROLE_STAT[role]}.name`))
          expect(text).toContain(t(`roles.${role}.name`))
        }
      }
    })
  }

  it('the Spanish example reads as intended', () => {
    const text = i18n.getFixedT('es')('roleInfo.against.sprinter', { nature: 'Plácida' })
    expect(text).toBe('Su naturaleza Plácida baja el Ritmo: es un Velocista más lento de lo normal.')
  })
})
