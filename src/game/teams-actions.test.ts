/** Reducer-level tests for nicknames and saved teams (validation lives in the reducer, not in the UI). */
import { describe, expect, it } from 'vitest'
import { createRng } from '../engine'
import { makeMon } from '../engine/test-helpers'
import { applyAction, type ActionEnv } from './actions'
import { EMPTY_DOC, type GameAction, type GameDoc } from './protocol'

const T0 = Date.UTC(2026, 10, 3, 10, 0)
const env = (now = T0, patch: Partial<ActionEnv> = {}): ActionEnv => ({ now, rng: createRng(`seed-${now}`), dev: false, trainerName: 'Ash', ...patch })

function must(doc: GameDoc, action: GameAction, e = env()): GameDoc {
  const r = applyAction(doc, action, e)
  if (!r.ok) throw new Error(`${action.type}: ${r.error}`)
  return r.doc
}

/** A player with p1 (starter) plus three more Pokemon in the box. */
function base(): GameDoc {
  let doc = must(EMPTY_DOC, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'charmander' })
  const p = doc.player!
  const extra = Object.fromEntries(['p2', 'p3', 'p4'].map((uid, i) => [uid, makeMon(['squirtle', 'pidgey', 'gastly'][i]!, 8, { uid })]))
  doc = { ...doc, player: { ...p, pokemon: { ...p.pokemon, ...extra }, counters: { ...p.counters, pokemon: 4 } } }
  return doc
}

describe('setNickname', () => {
  it('stores a trimmed nickname, keeps it through evolution-like spreads, and removes it with empty text or null', () => {
    let doc = must(base(), { type: 'setNickname', uid: 'p1', nickname: '  Monito ' })
    expect(doc.player?.pokemon.p1?.nickname).toBe('Monito')
    doc = must(doc, { type: 'setNickname', uid: 'p1', nickname: '' })
    expect(doc.player?.pokemon.p1?.nickname).toBeUndefined()
    doc = must(doc, { type: 'setNickname', uid: 'p1', nickname: 'Rayo' })
    doc = must(doc, { type: 'setNickname', uid: 'p1', nickname: null })
    expect('nickname' in doc.player!.pokemon.p1!).toBe(false)
  })
  it('rejects too long, control characters and unknown Pokemon, whatever the client sent', () => {
    const doc = base()
    expect(applyAction(doc, { type: 'setNickname', uid: 'p1', nickname: 'WWWWWWWWWWWWW' }, env())).toEqual({ ok: false, error: 'nickname_too_long' })
    expect(applyAction(doc, { type: 'setNickname', uid: 'p1', nickname: 'a\nb' }, env())).toEqual({ ok: false, error: 'nickname_invalid' })
    expect(applyAction(doc, { type: 'setNickname', uid: 'nope', nickname: 'x' }, env())).toEqual({ ok: false, error: 'unknown_pokemon' })
    expect(applyAction(EMPTY_DOC, { type: 'setNickname', uid: 'p1', nickname: 'x' }, env())).toEqual({ ok: false, error: 'no_player' })
  })
  it('is allowed during a session (it is cosmetic)', () => {
    const doc = must(base(), { type: 'start', minutes: 25 })
    expect(must(doc, { type: 'setNickname', uid: 'p1', nickname: 'Monito' }).player?.pokemon.p1?.nickname).toBe('Monito')
  })
})

describe('saved teams', () => {
  it('save → change team → apply restores order and leader; ids come back in the result', () => {
    let doc = must(base(), { type: 'setTeam', uids: ['p3', 'p1', 'p2'] })
    const saved = applyAction(doc, { type: 'savePreset', name: ' Estudio ' }, env())
    expect(saved.ok && saved.result).toEqual({ id: 't1' })
    if (!saved.ok) return
    doc = saved.doc
    expect(doc.player?.teamPresets).toEqual([{ id: 't1', name: 'Estudio', uids: ['p3', 'p1', 'p2'] }])
    doc = must(doc, { type: 'setTeam', uids: ['p4'] })
    const applied = applyAction(doc, { type: 'applyPreset', id: 't1' }, env())
    expect(applied.ok && applied.result).toEqual({ missing: 0 })
    if (!applied.ok) return
    expect(applied.doc.player?.team).toEqual(['p3', 'p1', 'p2'])
  })
  it('ignores released members and reports them', () => {
    let doc = must(base(), { type: 'setTeam', uids: ['p1', 'p4'] })
    doc = must(doc, { type: 'savePreset', name: 'Duo' })
    doc = must(doc, { type: 'setTeam', uids: ['p1'] })
    doc = must(doc, { type: 'release', uid: 'p4' })
    const r = applyAction(doc, { type: 'applyPreset', id: 't1' }, env())
    expect(r.ok && r.result).toEqual({ missing: 1 })
    if (r.ok) expect(r.doc.player?.team).toEqual(['p1'])
  })
  it('validates names and the limit of 10; rename, overwrite and delete work', () => {
    let doc = base()
    expect(applyAction(doc, { type: 'savePreset', name: '   ' }, env())).toEqual({ ok: false, error: 'preset_name_empty' })
    expect(applyAction(doc, { type: 'savePreset', name: 'x'.repeat(21) }, env())).toEqual({ ok: false, error: 'preset_name_too_long' })
    expect(applyAction(doc, { type: 'savePreset', name: 'a\tb' }, env())).toEqual({ ok: false, error: 'preset_name_invalid' })
    for (let i = 0; i < 10; i++) doc = must(doc, { type: 'savePreset', name: `T${i}` })
    expect(applyAction(doc, { type: 'savePreset', name: 'one more' }, env())).toEqual({ ok: false, error: 'too_many_presets' })
    doc = must(doc, { type: 'renamePreset', id: 't2', name: 'Renamed' })
    expect(doc.player?.teamPresets?.find((p) => p.id === 't2')?.name).toBe('Renamed')
    doc = must(doc, { type: 'setTeam', uids: ['p2', 'p1'] })
    doc = must(doc, { type: 'overwritePreset', id: 't2' })
    expect(doc.player?.teamPresets?.find((p) => p.id === 't2')?.uids).toEqual(['p2', 'p1'])
    doc = must(doc, { type: 'deletePreset', id: 't2' })
    expect(doc.player?.teamPresets).toHaveLength(9)
    expect(applyAction(doc, { type: 'deletePreset', id: 't2' }, env())).toEqual({ ok: false, error: 'unknown_preset' })
  })
  it('cannot switch teams during a session, but can still manage the list', () => {
    let doc = must(base(), { type: 'savePreset', name: 'Uno' })
    doc = must(doc, { type: 'start', minutes: 25 })
    expect(applyAction(doc, { type: 'applyPreset', id: 't1' }, env())).toEqual({ ok: false, error: 'session_active' })
    expect(applyAction(doc, { type: 'setTeam', uids: ['p2'] }, env())).toEqual({ ok: false, error: 'session_active' })
    expect(must(doc, { type: 'renamePreset', id: 't1', name: 'Dos' }).player?.teamPresets?.[0]?.name).toBe('Dos')
  })
  it('old saves without presets work (no migration needed: the field is optional)', () => {
    const doc = base()
    expect(doc.player?.teamPresets).toBeUndefined()
    expect(applyAction(doc, { type: 'applyPreset', id: 't1' }, env())).toEqual({ ok: false, error: 'unknown_preset' })
    expect(must(doc, { type: 'savePreset', name: 'Primero' }).player?.teamPresets).toHaveLength(1)
  })
})
