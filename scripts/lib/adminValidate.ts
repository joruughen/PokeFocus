/**
 * The logic of `npm run admin:validate`: validate an admin import JSON (docs/admin-json.md) with the SAME code the
 * server and the admin screen use (shape + references and rules + engine smoke test), no server or database, and
 * say what is wrong in Spanish with the path of each problem. Kept apart from the CLI entry so the tests can call it.
 */
import { baseContext } from '../../src/engine/context'
import { MISSION_KINDS } from '../../src/engine/mission-kinds'
import {
  CONFIG_LIMITS,
  CONFIG_LIST_LIMITS,
  CONFIG_TABLE_LIMITS,
  parseJsonText,
  validateAdminJson,
  type ContentImportData,
  type EventImportData,
  type ValidationIssue,
} from '../../src/game/content'
import es from '../../src/i18n/locales/es.json'

type Dict = Record<string, unknown>

const lookup = (path: string): string | null => {
  let cur: unknown = es
  for (const k of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return null
    cur = (cur as Dict)[k]
  }
  return typeof cur === 'string' ? cur : null
}

/** One issue as a Spanish sentence (the locale text of its code; the English message when there is none). */
export function issueTextEs(i: ValidationIssue): string {
  const tpl = lookup(`adminJson.issues.${i.code}`) ?? lookup(`eventsAdmin.issues.${i.code}`) ?? lookup(`admin.content.issues.${i.code}`)
  if (!tpl) return i.message
  const params: Record<string, unknown> = { ...i.params, path: i.path }
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => (params[k] === undefined ? '' : String(params[k])))
}

const bullet = (i: ValidationIssue): string => `  - ${i.path === '' ? '(documento)' : i.path}: ${issueTextEs(i)}`

export interface ValidateReport {
  /** 0 = valid, 1 = errors found, 2 = could not read the document. */
  code: number
  lines: string[]
}

const dateEs = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

function summarize(kind: 'event' | 'content', v: EventImportData | ContentImportData): string[] {
  if (kind === 'event') {
    const e = v as EventImportData
    const o = e.overlay
    const out = [
      `Evento «${e.slug}»: ${e.name.es} / ${e.name.en}`,
      `  Del ${dateEs(e.startsAt)} al ${dateEs(e.endsAt)}`,
      `  ${o.featured.length} especies destacadas, ${o.drops.length} drops, ${o.missions.length} misiones, ${Object.keys(o.items ?? {}).length} objetos propios` +
        `${o.shiny ? `, shiny ${Number((o.shiny.chance * 100).toPrecision(4))} % (${o.shiny.scope})` : ''}${o.legendaryChanceMult !== undefined ? `, legendarios x${o.legendaryChanceMult}` : ''}`,
    ]
    if (e.imageNote) out.push(`  Recordatorio de imagen: ${e.imageNote}`)
    if (e.content) out.push(`  Contenido atado «${e.content.title}» (${e.content.applyOver === 'live' ? 'sobre lo que esté en vivo' : 'sobre la base'}${e.content.revertWhenEnds ? ', vuelve a lo anterior al terminar' : ''})`)
    return out
  }
  const c = v as ContentImportData
  return [`Contenido «${c.title}» (${c.applyOver === 'live' ? 'sobre lo que esté en vivo' : 'sobre la base'}): ${Object.keys(c.patch).join(', ') || 'sin cambios'}`]
}

/** Validate the text of a JSON file. `smoke: false` skips the engine smoke test (faster, less complete). */
export function validateText(text: string, opts: { smoke?: boolean; now?: number } = {}): ValidateReport {
  const parsed = parseJsonText(text)
  if (!parsed.ok) return { code: 2, lines: ['ERROR  ' + issueTextEs(parsed.issue)] }
  const { kind, result } = validateAdminJson(parsed.value, { smoke: opts.smoke ?? true, now: opts.now ?? Date.now() })
  const lines: string[] = []
  if (result.errors.length > 0) {
    lines.push(`ERRORES (${result.errors.length}): el servidor rechazaría este JSON.`, ...result.errors.map(bullet))
  }
  if (result.warnings.length > 0) {
    lines.push(`AVISOS (${result.warnings.length}):`, ...result.warnings.map((w) => bullet(w) + (w.requiresConfirm ? '  [al publicar pide marcar la casilla de confirmación]' : '')))
  }
  if (result.ok && kind && result.value) {
    lines.push(...summarize(kind, result.value))
    lines.push(`OK: el JSON es válido${opts.smoke === false ? ' (sin la prueba de humo del motor)' : ' (forma, referencias, reglas y prueba de humo del motor)'}.`)
  }
  return { code: result.ok ? 0 : 1, lines }
}

export const LIST_KINDS = ['species', 'items', 'moves', 'techniques', 'abilities', 'types', 'mission-kinds', 'config'] as const
export type ListKind = (typeof LIST_KINDS)[number]

/** Valid slugs / keys of the game, one per line (what an assistant needs to write a correct JSON). */
export function listLines(kind: ListKind): string[] {
  const ctx = baseContext()
  switch (kind) {
    case 'species':
      return ctx.data.species.map((s) => `${s.slug}\t#${s.id}\t${s.names.es} / ${s.names.en}${s.isLegendary || s.isMythical ? '\t(legendario)' : ''}`)
    case 'items': {
      const own = Object.entries(ctx.missions.placeholderItems)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => `${k}\t${v.names.es} / ${v.names.en}\t(objeto de misiones)`)
      return [...ctx.data.items.map((i) => `${i.slug}\t${i.names.es} / ${i.names.en}`), ...own]
    }
    case 'moves':
      return ctx.data.moves.map((m) => `${m.slug}\t${m.type}\tpotencia ${m.power ?? '-'}\tprecisión ${m.accuracy ?? '-'}`)
    case 'techniques':
      return Object.entries(ctx.techniques).map(([k, t]) => `${k}\t${t.category}`)
    case 'abilities':
      return Object.keys(ctx.abilities)
    case 'types':
      return ctx.data.types.types.map((t) => `${t.slug}\t${t.names.es} / ${t.names.en}`)
    case 'mission-kinds':
      return MISSION_KINDS.map((k) => k)
    case 'config':
      return [
        ...CONFIG_LIMITS.map((l) => `${l.path}\t${l.kind}\t${l.min}..${l.max}${l.unit ? ` ${l.unit}` : ''}${l.impact ? `\t(afecta: ${l.impact})` : ''}`),
        ...CONFIG_LIST_LIMITS.map((l) => `${l.path}\tlista de ${l.minItems}..${l.maxItems} números, cada uno ${l.item.min}..${l.item.max}`),
        ...CONFIG_TABLE_LIMITS.map((l) => `${l.path}\ttabla de ${l.minItems}..${l.maxItems} filas con ${Object.entries(l.columns).map(([c, b]) => `${c} ${b.min}..${b.max}`).join(', ')}`),
      ]
  }
}
