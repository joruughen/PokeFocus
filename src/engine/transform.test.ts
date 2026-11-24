import { describe, expect, it } from 'vitest'
import { setTeam } from './box'
import { defaultContext } from './context'
import { createRng } from './rng'
import { applySessionResult, conditionTypes } from './session'
import type { OwnedPokemon, PlayerState } from './state'
import { makeMon, makePlayer, runSession } from './test-helpers'
import { bodyTypes, canTransform, copiedMoves, copyCandidates, copySummary, copyTarget, effectiveMember, pendingCopyUids, pruneCopies, setCopy } from './transform'
import { pokemonView } from './views'

const ctx = defaultContext()
const rng = () => createRng('copy')

function team(): PlayerState {
  const ditto = makeMon('ditto', 30, { uid: 'ditto' })
  const mon = makeMon('charmander', 30, { uid: 'char', equippedMoves: ['ember', 'agility'], moveMasteryMinutes: { ember: 400, agility: 1000 } })
  const other = makeMon('squirtle', 30, { uid: 'squ' })
  return makePlayer([mon, ditto, other])
}

const must = <T,>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('Transformación: quién puede copiar y a quién', () => {
  it('Ditto puede copiar; el resto no', () => {
    const s = team()
    expect(canTransform(s.pokemon.ditto as OwnedPokemon, ctx)).toBe(true)
    expect(canTransform(s.pokemon.char as OwnedPokemon, ctx)).toBe(false)
  })

  it('los candidatos son el equipo sin él mismo ni otros Ditto', () => {
    let s = team()
    s = { ...s, pokemon: { ...s.pokemon, ditto2: makeMon('ditto', 10, { uid: 'ditto2' }) }, team: [...s.team, 'ditto2'] }
    const ids = copyCandidates(s, s.pokemon.ditto as OwnedPokemon, ctx).map((p) => p.uid)
    expect(ids.sort()).toEqual(['char', 'squ'])
  })

  it('copia al elegido, borra la copia con null y rechaza objetivos no válidos', () => {
    const s = team()
    const a = must(setCopy(s, 'ditto', 'char', rng(), ctx))
    expect(a.pokemon.ditto?.copyOfUid).toBe('char')
    expect(copyTarget(a, a.pokemon.ditto as OwnedPokemon, ctx)?.uid).toBe('char')
    expect(must(setCopy(a, 'ditto', null, rng(), ctx)).pokemon.ditto?.copyOfUid).toBeUndefined()
    expect(setCopy(s, 'ditto', 'ditto', rng(), ctx)).toEqual({ ok: false, error: 'invalid_target' })
    expect(setCopy(s, 'ditto', 'nadie', rng(), ctx)).toEqual({ ok: false, error: 'invalid_target' })
    expect(setCopy(s, 'char', 'squ', rng(), ctx)).toEqual({ ok: false, error: 'not_transformer' })
    expect(setCopy(s, 'zzz', 'char', rng(), ctx)).toEqual({ ok: false, error: 'unknown_pokemon' })
  })

  it('un Ditto de la Caja puede copiar a alguien del equipo, pero no a quien está fuera', () => {
    let s = team()
    const out = makeMon('pidgey', 5, { uid: 'out' })
    s = { ...s, pokemon: { ...s.pokemon, out, boxditto: makeMon('ditto', 5, { uid: 'boxditto' }) } }
    expect(must(setCopy(s, 'boxditto', 'squ', rng(), ctx)).pokemon.boxditto?.copyOfUid).toBe('squ')
    expect(setCopy(s, 'boxditto', 'out', rng(), ctx)).toEqual({ ok: false, error: 'invalid_target' })
  })

  it('aleatorio: elige a un compañero válido, igual con la misma semilla', () => {
    const s = team()
    const a = must(setCopy(s, 'ditto', 'random', createRng(5), ctx)).pokemon.ditto?.copyOfUid
    const b = must(setCopy(s, 'ditto', 'random', createRng(5), ctx)).pokemon.ditto?.copyOfUid
    expect(['char', 'squ']).toContain(a)
    expect(a).toBe(b)
    const alone = makePlayer([makeMon('ditto', 5, { uid: 'ditto' })])
    expect(setCopy(alone, 'ditto', 'random', rng(), ctx)).toEqual({ ok: false, error: 'no_candidates' })
  })
})

describe('Transformación: qué copia', () => {
  it('tipos del compañero, primeras técnicas según los huecos de Ditto y su Dominio', () => {
    const s = must(setCopy(team(), 'ditto', 'char', rng(), ctx))
    const ditto = s.pokemon.ditto as OwnedPokemon
    const target = s.pokemon.char as OwnedPokemon
    expect(bodyTypes(ditto, target, ctx)).toEqual(['fire'])
    expect(bodyTypes(ditto, null, ctx)).toEqual(['normal'])
    // Nivel 30: 3 huecos; el compañero lleva 2.
    expect(copiedMoves(ditto, target, ctx)).toEqual(['ember', 'agility'])
    const eff = effectiveMember(s, ditto, ctx)
    expect(eff.equippedMoves).toEqual(['ember', 'agility'])
    expect(eff.moveMasteryMinutes.ember).toBe(400)
    expect(eff.moveMasteryMinutes.agility).toBe(1000)
    expect(eff.uid).toBe('ditto')
    expect(eff.speciesSlug).toBe('ditto')
    expect(ditto.equippedMoves).not.toContain('ember')
  })

  it('con pocos huecos copia solo las primeras', () => {
    const ditto = makeMon('ditto', 5, { uid: 'ditto' })
    const mon = makeMon('charmander', 30, { uid: 'char', equippedMoves: ['ember', 'agility'] })
    const s = must(setCopy(makePlayer([mon, ditto]), 'ditto', 'char', rng(), ctx))
    expect(copiedMoves(ditto, mon, ctx)).toEqual(['ember'])
    expect(effectiveMember(s, s.pokemon.ditto as OwnedPokemon, ctx).equippedMoves).toEqual(['ember'])
  })

  it('el resumen y la vista traen el aspecto y los tipos del copiado', () => {
    const s = must(setCopy(team(), 'ditto', 'char', rng(), ctx))
    const sum = copySummary(s, s.pokemon.ditto as OwnedPokemon, ctx)
    expect(sum?.speciesSlug).toBe('charmander')
    expect(sum?.techniques.map((t) => t.slug)).toEqual(['ember', 'agility'])
    const v = pokemonView(s, 'ditto', 0, ctx)
    expect(v?.canTransform).toBe(true)
    expect(v?.fightTypes).toEqual(['fire'])
    expect(v?.types).toEqual(['normal'])
    expect(pokemonView(s, 'char', 0, ctx)?.copy).toBeNull()
  })

  it('la Tera de Ditto manda sobre los tipos copiados en las condiciones', () => {
    const s = must(setCopy(team(), 'ditto', 'char', rng(), ctx))
    const ditto = { ...(s.pokemon.ditto as OwnedPokemon), teraType: 'water' as const, teraUntil: 10 ** 15, teraSessionsLeft: 3 }
    expect(conditionTypes(ditto, 0, ctx, s.pokemon.char)).toEqual(['water'])
    expect(conditionTypes(s.pokemon.ditto as OwnedPokemon, 0, ctx, s.pokemon.char)).toEqual(['fire'])
  })
})

describe('Transformación: se deshace sola', () => {
  it('al sacar al copiado del equipo, Ditto vuelve a ser Ditto', () => {
    const s = must(setCopy(team(), 'ditto', 'char', rng(), ctx))
    const next = must(setTeam(s, ['ditto', 'squ'], 0, ctx))
    expect(next.pokemon.ditto?.copyOfUid).toBeUndefined()
    // Y no vuelve solo si el compañero regresa.
    expect(must(setTeam(next, ['char', 'ditto', 'squ'], 0, ctx)).pokemon.ditto?.copyOfUid).toBeUndefined()
  })

  it('pruneCopies no toca nada válido y devuelve el mismo estado', () => {
    const s = must(setCopy(team(), 'ditto', 'char', rng(), ctx))
    expect(pruneCopies(s, ctx)).toBe(s)
  })

  it('un Ditto cuyo objetivo ya no existe no copia', () => {
    const s = must(setCopy(team(), 'ditto', 'char', rng(), ctx))
    const gone = { ...s, pokemon: { ...s.pokemon } }
    delete gone.pokemon.char
    expect(copyTarget(gone, gone.pokemon.ditto as OwnedPokemon, ctx)).toBeNull()
  })
})

describe('Transformación: durante una sesión', () => {
  it('con la sesión en marcha no se puede cambiar; al terminar solo responder la pregunta', () => {
    const s0 = team()
    expect(pendingCopyUids(s0, ctx)).toEqual(['ditto'])
    const { state } = runSession(s0, 25)
    expect(setCopy(state, 'ditto', 'char', rng(), ctx)).toEqual({ ok: false, error: 'session_active' })
    const answered = must(setCopy(state, 'ditto', 'char', rng(), ctx, { atSessionEnd: true }))
    expect(answered.pokemon.ditto?.copyOfUid).toBe('char')
    // Ya copiando: ni siquiera al final se puede cambiar de opinión ni borrar.
    expect(setCopy(answered, 'ditto', 'squ', rng(), ctx, { atSessionEnd: true })).toEqual({ ok: false, error: 'session_active' })
    expect(setCopy(state, 'ditto', null, rng(), ctx, { atSessionEnd: true })).toEqual({ ok: false, error: 'session_active' })
    expect(pendingCopyUids(answered, ctx)).toEqual([])
  })

  it('el resultado trae lo copiado y rinde más que Ditto solo', () => {
    const plain = runSession(team(), 25, 11).result.members.find((m) => m.uid === 'ditto')!
    const copying = runSession(must(setCopy(team(), 'ditto', 'char', rng(), ctx)), 25, 11).result.members.find((m) => m.uid === 'ditto')!
    expect(plain.copy).toBeUndefined()
    expect(copying.copy).toEqual({ uid: 'char', speciesSlug: 'charmander', isShiny: false, moves: ['ember', 'agility'] })
    expect(copying.speciesSlug).toBe('ditto')
    // Solo lleva técnicas de daño de su copia: energía completa y de tipo Fuego.
    expect(copying.catchEnergy).toBeGreaterThan(plain.catchEnergy)
    expect(copying.damageMoves?.map((m) => m.move)).toContain('ember')
    // Los puntos salen de sus propios stats: con Agilidad copiada actúa más a menudo.
    expect(copying.actions).toBeGreaterThan(plain.actions)
    // No entrena las técnicas copiadas: su Dominio es del compañero.
    expect(Object.keys(copying.masteryMinutes)).not.toContain('ember')
  })

  it('es determinista', () => {
    const s = must(setCopy(team(), 'ditto', 'char', rng(), ctx))
    expect(runSession(s, 50, 3).result).toEqual(runSession(s, 50, 3).result)
  })

  it('el acceso a la copia sigue valiendo tras reclamar y aplicar el resultado', () => {
    const s = must(setCopy(team(), 'ditto', 'char', rng(), ctx))
    const { result, state } = runSession(s, 25)
    const applied = must(applySessionResult(state, result, ctx))
    expect(applied.state.pokemon.ditto?.copyOfUid).toBe('char')
    expect(applied.state.pokemon.ditto?.equippedMoves).not.toContain('ember')
  })
})
