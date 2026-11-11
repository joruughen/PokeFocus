/**
 * Human text for the paths and values of a diff or a validation issue: «Shiny chance», «Pikachu: capture rate»,
 * «1% → 2%». Pure apart from the i18n lookups (pass `t`/`lng` in).
 */
import i18n from 'i18next'
import { CONFIG_LIMITS, CONFIG_LIST_LIMITS, CONFIG_TABLE_LIMITS, configLimit, type LimitKind } from '../../../../game/content/limits'
import type { ContentIssue } from '../../../../game/protocol'
import type { LocaleCode } from '../../../../engine/data-types'
import { moveName, speciesName } from '../../../lib/names'
import { formatNumber } from './patch'

export type T = (key: string, opts?: Record<string, unknown>) => string

const MAX_JSON = 90

const labelOfConfig = (rest: string, t: T): string => {
  const exact = CONFIG_LIMITS.find((l) => l.path === rest)
  if (exact) return t(exact.labelKey)
  const nested = [...CONFIG_LIST_LIMITS, ...CONFIG_TABLE_LIMITS].find((l) => rest.startsWith(`${l.path}.`))
  if (nested) {
    const [row, col] = rest.slice(nested.path.length + 1).split('.')
    const rowNo = Number(row) + 1
    return `${t(nested.labelKey)} › ${Number.isFinite(rowNo) ? `#${rowNo}` : row}${col ? ` · ${i18n.exists(`admin.content.columns.${col}`) ? t(`admin.content.columns.${col}`) : col}` : ''}`
  }
  const whole = [...CONFIG_LIST_LIMITS, ...CONFIG_TABLE_LIMITS].find((l) => l.path === rest)
  if (whole) return t(whole.labelKey)
  return rest
}

const field = (name: string, t: T): string => (i18n.exists(`admin.content.fields.${name}`) ? t(`admin.content.fields.${name}`) : name)

/** Readable name of a patch path (`config.encounters.shinyChance`, `species.pikachu.captureRate`…). */
export function pathLabel(path: string, t: T, lng: LocaleCode): string {
  if (path === '') return t('admin.content.issues.wholePatch')
  const parts = path.split('.')
  const [head, slug, ...rest] = parts
  if (head === 'config') return labelOfConfig(parts.slice(1).join('.'), t)
  if (head === 'species' && slug) return rest.length ? `${speciesName(slug, lng)}: ${rest.map((r) => field(r, t)).join(' › ')}` : speciesName(slug, lng)
  if (head === 'moves' && slug) return rest.length ? `${moveName(slug, lng)}: ${rest.map((r) => field(r, t)).join(' › ')}` : moveName(slug, lng)
  if ((head === 'techniques' || head === 'abilities') && slug) return `${t(`admin.content.sections.${head}`)} › ${slug}`
  if (head === 'missions') return [t('admin.content.sections.missions'), ...parts.slice(1)].join(' › ')
  return path
}

function short(s: string): string {
  return s.length > MAX_JSON ? `${s.slice(0, MAX_JSON - 1)}…` : s
}

/** A diff/validation value in words: numbers with their unit, booleans yes/no, objects as compact JSON. */
export function valueText(path: string, v: unknown, t: T, lng: string): string {
  if (v === null || v === undefined) return t('admin.content.diff.unset')
  if (typeof v === 'boolean') return t(v ? 'admin.content.yes' : 'admin.content.no')
  if (typeof v === 'number') {
    const limit = path.startsWith('config.') ? configLimit(path.slice('config.'.length)) : undefined
    return limit ? `${formatNumber(limit.kind, v, lng)}${limit.unit && limit.kind !== 'prob' ? ` ${limit.unit}` : ''}` : formatNumber('number', v, lng)
  }
  if (typeof v === 'string') return short(v)
  if (Array.isArray(v) && v.every((x) => typeof x === 'number')) {
    const limit = path.startsWith('config.') ? CONFIG_LIST_LIMITS.find((l) => l.path === path.slice('config.'.length)) : undefined
    return short(`[${v.map((x) => (limit ? formatNumber(limit.item.kind, x, lng) : String(x))).join(', ')}]`)
  }
  return short(JSON.stringify(v))
}

/** Text of a validation issue: the translated copy for its code, else the server's English message. */
export function issueText(issue: ContentIssue, t: T): string {
  const p = issue.params
  // The ×3/×5 guard: numbers the way the form and the diff print them (a probability as %, not 0.00136 → 0.01),
  // and the reference it was compared with (the content in force, or the base when nothing is published).
  if (issue.code === 'big_change' && typeof p?.base === 'number' && typeof p.value === 'number') {
    const kind = (typeof p.kind === 'string' ? p.kind : undefined) as LimitKind | undefined
    const show = (v: number) => (kind ? `${formatNumber(kind, v, i18n.language)}${unitOf(issue.path, kind)}` : valueText(issue.path, v, t, i18n.language))
    return t(p.from === 'live' ? 'admin.content.issues.big_change_live' : 'admin.content.issues.big_change', { ...p, path: issue.path, base: show(p.base), value: show(p.value) })
  }
  const key = `admin.content.issues.${issue.code}`
  const slots = p?.slots
  return i18n.exists(key) ? t(key, { ...p, path: issue.path, ...(Array.isArray(slots) && { slotCount: slots.length }) }) : issue.message
}

/** Unit suffix of a config path (` min`, ` s`…; none for probabilities, which carry the %). */
function unitOf(path: string, kind: LimitKind): string {
  if (kind === 'prob' || !path.startsWith('config.')) return ''
  const rest = path.slice('config.'.length)
  const limit = configLimit(rest) ?? CONFIG_LIST_LIMITS.find((l) => rest.startsWith(`${l.path}.`))?.item
  return limit?.unit ? ` ${limit.unit}` : ''
}
