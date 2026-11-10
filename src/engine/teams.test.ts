import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  deletePreset,
  graphemeCount,
  MAX_TEAM_PRESETS,
  normalizeNickname,
  normalizePresetName,
  overwritePreset,
  PRESET_NAME_MAX,
  presetMembers,
  releasePokemon,
  renamePreset,
  savePreset,
  setNickname,
  startSession,
  teamPresets,
  type PlayerState,
} from '.'
import { makeMon, makePlayer, MIN, T0 } from './test-helpers'

const mon = (slug: string, uid: string) => makeMon(slug, 10, { uid, caughtAt: T0 - MIN })
/** Characters built from code points so the source file stays plain ASCII. */
const ch = (...codes: number[]) => String.fromCodePoint(...codes)
const EMOJI = ch(0x1f600)
const FAMILY = ch(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466)

function sample(): PlayerState {
  const all = [mon('pikachu', 'a'), mon('squirtle', 'b'), mon('pidgey', 'c'), mon('gastly', 'd')]
  return makePlayer([all[0]!, all[1]!], { pokemon: Object.fromEntries(all.map((p) => [p.uid, p])) })
}
const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('nicknames', () => {
  it('trims, keeps a valid name and treats blank as removal', () => {
    expect(normalizeNickname('  Monito ')).toEqual({ ok: true, value: 'Monito' })
    expect(normalizeNickname('')).toEqual({ ok: true, value: null })
    expect(normalizeNickname('   ')).toEqual({ ok: true, value: null })
  })
  it('counts graphemes, not bytes or UTF-16 units', () => {
    expect(normalizeNickname('WWWWWWWWWWWW').ok).toBe(true) // 12
    expect(normalizeNickname('WWWWWWWWWWWWW')).toEqual({ ok: false, error: 'nickname_too_long' }) // 13
    expect(normalizeNickname(ch(0xe9).repeat(12)).ok).toBe(true) // 12 accented letters (2 bytes each)
    expect(normalizeNickname(EMOJI.repeat(12)).ok).toBe(true) // 12 emoji (4 bytes, 2 UTF-16 units each)
    expect(normalizeNickname(EMOJI.repeat(13)).ok).toBe(false)
    // A ZWJ family emoji is a single grapheme.
    expect(graphemeCount(FAMILY)).toBe(1)
    expect(normalizeNickname(FAMILY.repeat(12)).ok).toBe(true)
    // Decomposed accents are composed first (e + combining acute = one letter).
    expect(normalizeNickname(ch(0x65, 0x301).repeat(12)).ok).toBe(true)
  })
  it('rejects control characters, newlines and invisible direction marks', () => {
    for (const code of [0x0a, 0x09, 0x00, 0x7f, 0x202e, 0x200b, 0x2028, 0x2066]) {
      expect(normalizeNickname(`a${ch(code)}b`)).toEqual({ ok: false, error: 'nickname_invalid' })
    }
    expect(normalizeNickname(42)).toEqual({ ok: false, error: 'nickname_invalid' })
  })
  it('rejects a giant combining-mark grapheme', () => {
    expect(normalizeNickname('a' + ch(0x301).repeat(500)).ok).toBe(false)
  })
  it('sets, replaces and removes the nickname on the Pokemon', () => {
    let s = sample()
    s = must(setNickname(s, 'a', ' Monito '))
    expect(s.pokemon.a?.nickname).toBe('Monito')
    expect(s.pokemon.b?.nickname).toBeUndefined()
    s = must(setNickname(s, 'a', 'Rayo'))
    expect(s.pokemon.a?.nickname).toBe('Rayo')
    s = must(setNickname(s, 'a', '  '))
    expect('nickname' in s.pokemon.a!).toBe(false)
    expect(setNickname(s, 'zzz', 'x')).toEqual({ ok: false, error: 'unknown_pokemon' })
    expect(setNickname(s, 'a', 'x'.repeat(13))).toEqual({ ok: false, error: 'nickname_too_long' })
  })
  it('does not mutate the input state', () => {
    const s = sample()
    const before = JSON.stringify(s)
    setNickname(s, 'a', 'Monito')
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('team presets', () => {
  it('validates names (1-20 graphemes, trimmed, no control chars)', () => {
    expect(normalizePresetName(' Estudio ')).toEqual({ ok: true, value: 'Estudio' })
    expect(normalizePresetName('  ')).toEqual({ ok: false, error: 'preset_name_empty' })
    expect(normalizePresetName('x'.repeat(PRESET_NAME_MAX + 1))).toEqual({ ok: false, error: 'preset_name_too_long' })
    expect(normalizePresetName('x'.repeat(PRESET_NAME_MAX)).ok).toBe(true)
    expect(normalizePresetName('a\nb')).toEqual({ ok: false, error: 'preset_name_invalid' })
  })
  it('saves the current team (order and leader), renames, overwrites and deletes', () => {
    let s = sample()
    const saved = must(savePreset(s, 'Manana'))
    s = saved.state
    expect(saved.preset).toEqual({ id: 't1', name: 'Manana', uids: ['a', 'b'] })
    s = { ...s, team: ['b', 'c', 'a'] }
    s = must(savePreset(s, 'Tarde')).state
    expect(teamPresets(s).map((p) => [p.id, p.uids])).toEqual([
      ['t1', ['a', 'b']],
      ['t2', ['b', 'c', 'a']],
    ])
    s = must(renamePreset(s, 't1', '  Noche '))
    expect(teamPresets(s)[0]?.name).toBe('Noche')
    s = must(overwritePreset(s, 't1'))
    expect(teamPresets(s)[0]?.uids).toEqual(['b', 'c', 'a'])
    s = must(deletePreset(s, 't2'))
    expect(teamPresets(s).map((p) => p.id)).toEqual(['t1'])
    expect(must(savePreset(s, 'Otro')).preset.id).toBe('t2')
    for (const r of [renamePreset(s, 'nope', 'x'), overwritePreset(s, 'nope'), deletePreset(s, 'nope')]) expect(r).toEqual({ ok: false, error: 'unknown_preset' })
    expect(renamePreset(s, 't1', ' ')).toEqual({ ok: false, error: 'preset_name_empty' })
  })
  it('caps the number of presets', () => {
    let s = sample()
    for (let i = 0; i < MAX_TEAM_PRESETS; i++) s = must(savePreset(s, `T${i}`)).state
    expect(savePreset(s, 'extra')).toEqual({ ok: false, error: 'too_many_presets' })
    s = must(deletePreset(s, 't3'))
    expect(savePreset(s, 'extra').ok).toBe(true)
  })
  it('applies a preset keeping order and leader', () => {
    let s = sample()
    s = { ...s, team: ['c', 'a', 'b'] }
    s = must(savePreset(s, 'Trio')).state
    s = { ...s, team: ['a'] }
    const r = must(applyPreset(s, 't1', T0))
    expect(r.state.team).toEqual(['c', 'a', 'b'])
    expect(r.missing).toBe(0)
  })
  it('skips released members and reports how many were missing', () => {
    let s = sample()
    s = { ...s, team: ['d', 'a', 'b'] }
    s = must(savePreset(s, 'Trio')).state
    s = { ...s, team: ['a'] }
    s = must(releasePokemon(s, 'd')) // the old leader leaves
    const r = must(applyPreset(s, 't1', T0))
    expect(r.state.team).toEqual(['a', 'b'])
    expect(r.missing).toBe(1)
    expect(presetMembers(s, teamPresets(s)[0]!)).toEqual({ uids: ['a', 'b'], missing: 1 })
  })
  it('refuses when every member is gone, during a session, or for an unknown id', () => {
    let s = sample()
    s = { ...s, team: ['c', 'd'] }
    s = must(savePreset(s, 'Solo')).state
    s = { ...s, team: ['a'] }
    let g = must(releasePokemon(s, 'c'))
    g = must(releasePokemon(g, 'd'))
    expect(applyPreset(g, 't1', T0)).toEqual({ ok: false, error: 'preset_empty' })
    expect(applyPreset(s, 'nope', T0)).toEqual({ ok: false, error: 'unknown_preset' })
    const started = must(startSession(s, { plannedMinutes: 25, startedAt: T0 })).state
    expect(applyPreset(started, 't1', T0)).toEqual({ ok: false, error: 'session_active' })
  })
  it('treats saves without the field as no presets', () => {
    const s = sample()
    expect('teamPresets' in s).toBe(false)
    expect(teamPresets(s)).toEqual([])
  })
})
