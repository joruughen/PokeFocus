/**
 * Team management: Pokémon nicknames and saved team presets.
 *
 * Both are cosmetic/convenience state with strict validation here (the
 * reducer and the server call these; the UI only mirrors the limits for
 * live counters):
 * - Nickname: at most `NICKNAME_MAX` graphemes (user-perceived characters, so
 *   an emoji or an accented letter counts as one), trimmed, no control or
 *   invisible-direction characters, empty = remove.
 * - Presets: a name (1–`PRESET_NAME_MAX` graphemes) and the ordered uids of a
 *   team (slot 0 = leader). At most `MAX_TEAM_PRESETS`. Applying one only
 *   works between sessions; uids that no longer exist (released) are skipped.
 */
import { setTeam } from './box'
import { defaultContext, type EngineContext } from './context'
import { err, ok, type OwnedPokemon, type PlayerState, type Result } from './state'

export const NICKNAME_MAX = 12
export const PRESET_NAME_MAX = 20
export const MAX_TEAM_PRESETS = 10
/** Hard cap on code points before grapheme counting (a "zalgo" grapheme can be arbitrarily long). */
const MAX_CODE_POINTS = 160

export interface TeamPreset {
  id: string
  name: string
  /** Up to 6 distinct Pokémon uids, slot 0 = leader. */
  uids: string[]
}

export type NicknameError = 'nickname_too_long' | 'nickname_invalid'
export type PresetError =
  | 'preset_name_empty'
  | 'preset_name_too_long'
  | 'preset_name_invalid'
  | 'too_many_presets'
  | 'unknown_preset'
  | 'preset_empty'
  | 'session_active'
  | 'team_empty'

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/** Number of user-perceived characters (graphemes) of `s`. */
export function graphemeCount(s: string): number {
  if (!segmenter) return [...s].length
  let n = 0
  for (const _ of segmenter.segment(s)) n++
  return n
}

/**
 * Control characters, private-use/surrogate code points, line and
 * paragraph separators, bidi controls and zero-width invisibles (U+200D, the
 * emoji joiner, is allowed).
 */
const FORBIDDEN = /[\p{Cc}\p{Cs}\p{Co}\u2028\u2029\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u

type TextError = 'too_long' | 'invalid'

/** Trim + validate a short label. Returns the normalized text ('' when empty after trimming). */
function cleanLabel(raw: unknown, max: number): Result<string, TextError> {
  if (typeof raw !== 'string') return err('invalid')
  const s = raw.normalize('NFC').trim()
  if (s === '') return ok('')
  if ([...s].length > MAX_CODE_POINTS) return err('too_long')
  if (FORBIDDEN.test(s)) return err('invalid')
  if (graphemeCount(s) > max) return err('too_long')
  return ok(s)
}

/** Validate a nickname. Returns the clean nickname, or null when it is empty (= remove it). */
export function normalizeNickname(raw: unknown): Result<string | null, NicknameError> {
  const r = cleanLabel(raw, NICKNAME_MAX)
  if (!r.ok) return err(r.error === 'too_long' ? 'nickname_too_long' : 'nickname_invalid')
  return ok(r.value === '' ? null : r.value)
}

/** Validate a preset name (1–20 graphemes after trimming). */
export function normalizePresetName(raw: unknown): Result<string, PresetError> {
  const r = cleanLabel(raw, PRESET_NAME_MAX)
  if (!r.ok) return err(r.error === 'too_long' ? 'preset_name_too_long' : 'preset_name_invalid')
  if (r.value === '') return err('preset_name_empty')
  return ok(r.value)
}

/** Set (or, with an empty text, remove) a Pokémon's nickname. Allowed at any time. */
export function setNickname(state: PlayerState, uid: string, raw: unknown): Result<PlayerState, NicknameError | 'unknown_pokemon'> {
  const p = state.pokemon[uid]
  if (!p) return err('unknown_pokemon')
  const n = normalizeNickname(raw)
  if (!n.ok) return err(n.error)
  const { nickname: _old, ...rest } = p
  const next: OwnedPokemon = n.value === null ? rest : { ...rest, nickname: n.value }
  return ok({ ...state, pokemon: { ...state.pokemon, [uid]: next } })
}

/** The player's presets (absent in older saves = none). */
export function teamPresets(state: PlayerState): TeamPreset[] {
  return state.teamPresets ?? []
}

function nextPresetId(presets: readonly TeamPreset[]): string {
  let n = 0
  for (const p of presets) {
    const m = /^t(\d+)$/.exec(p.id)
    if (m) n = Math.max(n, Number(m[1]))
  }
  return `t${n + 1}`
}

/** Save the current team under a new name. */
export function savePreset(state: PlayerState, rawName: unknown): Result<{ state: PlayerState; preset: TeamPreset }, PresetError> {
  const name = normalizePresetName(rawName)
  if (!name.ok) return err(name.error)
  const presets = teamPresets(state)
  if (presets.length >= MAX_TEAM_PRESETS) return err('too_many_presets')
  if (state.team.length === 0) return err('team_empty')
  const preset: TeamPreset = { id: nextPresetId(presets), name: name.value, uids: [...state.team] }
  return ok({ state: { ...state, teamPresets: [...presets, preset] }, preset })
}

export function renamePreset(state: PlayerState, id: string, rawName: unknown): Result<PlayerState, PresetError> {
  const presets = teamPresets(state)
  if (!presets.some((p) => p.id === id)) return err('unknown_preset')
  const name = normalizePresetName(rawName)
  if (!name.ok) return err(name.error)
  return ok({ ...state, teamPresets: presets.map((p) => (p.id === id ? { ...p, name: name.value } : p)) })
}

/** Replace a preset's members with the current team (order and leader included). */
export function overwritePreset(state: PlayerState, id: string): Result<PlayerState, PresetError> {
  const presets = teamPresets(state)
  if (!presets.some((p) => p.id === id)) return err('unknown_preset')
  if (state.team.length === 0) return err('team_empty')
  return ok({ ...state, teamPresets: presets.map((p) => (p.id === id ? { ...p, uids: [...state.team] } : p)) })
}

export function deletePreset(state: PlayerState, id: string): Result<PlayerState, PresetError> {
  const presets = teamPresets(state)
  if (!presets.some((p) => p.id === id)) return err('unknown_preset')
  return ok({ ...state, teamPresets: presets.filter((p) => p.id !== id) })
}

/** The members of a preset that still exist (order kept) and how many are gone. */
export function presetMembers(state: PlayerState, preset: TeamPreset): { uids: string[]; missing: number } {
  const uids: string[] = []
  for (const u of preset.uids) if (state.pokemon[u] && !uids.includes(u)) uids.push(u)
  const kept = uids.slice(0, 6)
  return { uids: kept, missing: preset.uids.length - kept.length }
}

/**
 * Make a preset the active team. Not during a session. Released members are
 * skipped (`missing` says how many); if none is left → 'preset_empty'.
 */
export function applyPreset(
  state: PlayerState,
  id: string,
  now: number,
  ctx: EngineContext = defaultContext(),
): Result<{ state: PlayerState; missing: number }, PresetError> {
  if (state.activeSession) return err('session_active')
  const preset = teamPresets(state).find((p) => p.id === id)
  if (!preset) return err('unknown_preset')
  const { uids, missing } = presetMembers(state, preset)
  if (uids.length === 0) return err('preset_empty')
  const r = setTeam(state, uids, now, ctx)
  if (!r.ok) return err('preset_empty')
  return ok({ state: r.value, missing })
}
