/**
 * «PokeFocus admin import» (docs/admin-json.md): a stable, versioned JSON that an assistant can write from a
 * description in natural language and the admin can paste or upload to fill the event editor (`pokefocus.event@1`)
 * or the content editor (`pokefocus.content@1`).
 *
 * The schemas REUSE the ones of the live content (schema.ts): the event JSON is the event overlay (flat) plus slug,
 * name, description, ISO 8601 dates and optional extras; the content JSON wraps a `ContentPatch`. The semantic
 * checks (references, rules, big-change guard, engine smoke test) are the server's: `validateEventOverlay` and
 * `validateContentPatch` run on what the JSON means, so a JSON that passes here is accepted by the server.
 * Everything is pure (no DOM, no server): used by the admin UI, the CLI (`npm run admin:validate`) and the tests.
 *
 * Shape errors carry the path INSIDE the JSON document (`featured.0.weightMult`, `content.patch.config…`) and
 * stable codes (`adminJson.issues.<code>` in the locales); semantic issues keep the codes of validate.ts.
 */
import { z } from 'zod'
import { deepMerge } from '../../engine/config'
import type { ContentItem, ContentPatch, EventOverlay } from '../../engine/content'
import type { LocalizedText } from '../../engine/data-types'
import type { EventOverlayBody } from '../protocol'
import { DATA_LIMITS as D } from './limits'
import {
  contentPatchSchema,
  eventMissionBaseSchema,
  eventOverlayBodySchema,
  missionRules,
  richLongTextSchema,
  shortTextSchema,
  slugSchema,
  SLUG_RE,
} from './schema'
import { validateContentPatch, validateEventOverlay, type SmokeOptions, type ValidationIssue } from './validate'

export const EVENT_FORMAT = 'pokefocus.event@1'
export const CONTENT_FORMAT = 'pokefocus.content@1'
export type AdminJsonKind = 'event' | 'content'

/** Where a content patch of the JSON applies: over what is live now (the changes only) or over the base data (a full patch). */
export type ApplyOver = 'live' | 'base'

const DAY_MS = 86_400_000
/** Publishing rule of the server (`MAX_SCHEDULE_MS`): an event may start at most this far ahead. */
const MAX_SCHEDULE_DAYS = 60

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** ISO 8601 with a zone: `2026-12-01T18:00:00-05:00` or `…Z` (seconds optional). */
const ISO_ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

/** The calendar fields are real (no 30 February, no 25:00): `Date.parse` alone lets some of them through. */
function realIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (!m) return false
  const [y, mo, d, h, mi, sec] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x))) as [number, number, number, number, number, number]
  const day = new Date(Date.UTC(y, mo - 1, d))
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(s)
  return day.getUTCMonth() === mo - 1 && day.getUTCDate() === d && h < 24 && mi < 60 && sec < 60 && (!offset || (Number(offset[2]) < 24 && Number(offset[3]) < 60)) && !Number.isNaN(Date.parse(s))
}

const isoDateSchema = z.string().regex(ISO_ZONED).refine(realIsoDate, { message: 'bad_date' })

const nonBlank = /\S/

/** A content patch to publish together with the event (the «Junto a un evento» option of the publish dialog). */
export const tiedContentSchema = z.strictObject({
  title: z.string().min(1).max(80).regex(nonBlank).optional().describe('Nombre del borrador de contenido (por defecto, el del evento).'),
  note: z.string().max(400).optional().describe('Nota interna del borrador.'),
  applyOver: z.enum(['live', 'base']).optional().describe('"live" (por defecto): el parche son solo los cambios y se mezcla sobre lo que esté en vivo. "base": es un parche completo sobre los datos base.'),
  revertWhenEnds: z.boolean().optional().describe('true: al terminar el evento se vuelve a lo que había antes (casilla «Volver a lo anterior cuando termine el evento»).'),
  patch: contentPatchSchema,
})

/** Event missions as the JSON writes them: `period` is implied. */
const importMissionSchema = eventMissionBaseSchema.extend({ period: z.literal('event').optional() }).superRefine(missionRules)

const ov = eventOverlayBodySchema.shape

export const eventImportSchema = z.strictObject({
  $schema: z.string().optional(),
  format: z.literal(EVENT_FORMAT).describe('Siempre "pokefocus.event@1".'),
  slug: slugSchema.describe('Identificador único para siempre: minúsculas, números y guiones (p. ej. "semana-pikachu-2026").'),
  name: shortTextSchema.describe('Nombre del evento en español e inglés (máx. 80 caracteres).'),
  description: richLongTextSchema.describe('Descripción en español e inglés con el formato propio (**negrita**, *cursiva*, [red]…[/red], viñetas "- "). Máx. 400 caracteres visibles.'),
  startsAt: isoDateSchema.describe('Inicio, ISO 8601 con zona (p. ej. "2026-12-01T18:00:00-05:00").'),
  endsAt: isoDateSchema.describe('Fin (exclusivo), ISO 8601 con zona. Máx. 62 días después del inicio.'),
  imageNote: z.string().min(1).max(400).optional().describe('Recordatorio para el admin sobre la imagen (la imagen NO va en el JSON: se sube aparte en el editor).'),
  featured: ov.featured.optional().describe('Especies destacadas: slug de la especie y multiplicador de peso.'),
  shiny: ov.shiny.describe('Shiny del evento: probabilidad como fracción (0.02 = 2 %) y alcance.'),
  legendaryChanceMult: ov.legendaryChanceMult.describe('Multiplicador de la probabilidad de legendario.'),
  drops: ov.drops.optional().describe('Objetos que caen: slug, probabilidad por oleada como fracción (0.1 = 10 %) y máximo por sesión.'),
  items: ov.items.describe('Objetos propios del evento por slug, con nombre (y descripción opcional) en español e inglés.'),
  missions: z.array(importMissionSchema).max(D.eventMissionsMax).optional().describe('Misiones del evento (máx. 10).'),
  content: tiedContentSchema.optional().describe('Contenido atado: un parche de contenido que se publica junto al evento (se crea como borrador de contenido).'),
})

export const contentImportSchema = z.strictObject({
  $schema: z.string().optional(),
  format: z.literal(CONTENT_FORMAT).describe('Siempre "pokefocus.content@1".'),
  title: z.string().min(1).max(80).regex(nonBlank).describe('Nombre del borrador (máx. 80 caracteres).'),
  note: z.string().max(400).optional().describe('Nota interna del borrador (máx. 400 caracteres).'),
  applyOver: z.enum(['live', 'base']).optional().describe('"live" (por defecto): el parche son solo los cambios y se mezcla sobre lo que esté en vivo. "base": es un parche completo sobre los datos base.'),
  patch: contentPatchSchema,
})

export type EventImportJson = z.input<typeof eventImportSchema>
export type ContentImportJson = z.input<typeof contentImportSchema>

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface ContentImportData {
  title: string
  note?: string
  applyOver: ApplyOver
  patch: ContentPatch
}

export interface TiedContentData extends ContentImportData {
  revertWhenEnds: boolean
}

/** An event as the request of the admin API carries it (without the image). */
export interface EventImportData {
  slug: string
  name: LocalizedText
  description: LocalizedText
  startsAt: number
  endsAt: number
  overlay: EventOverlayBody
  /** Reminder for the admin about the image (never applied). */
  imageNote?: string
  content?: TiedContentData
}

export interface ImportResult<T> {
  ok: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  requiresConfirm: boolean
  /** Present when `ok`. */
  value?: T
}

export interface ImportOptions {
  /** Engine smoke test (default true; `false` for a quick check in the browser). */
  smoke?: boolean | SmokeOptions
  /** Items of the events that already exist (their slugs are known items). */
  allEventItems?: Record<string, ContentItem>
  /** Clock for the date warnings (default: no date warnings). */
  now?: number
}

export interface ContentImportOptions extends ImportOptions {
  /** The patch in force now: `applyOver: "live"` merges over it and the big-change guard compares against it. */
  live?: ContentPatch | null
}

// ---------------------------------------------------------------------------
// Parsing the text
// ---------------------------------------------------------------------------

/** The issue shape of validate.ts, so the UI and the CLI list both kinds the same way. */
function issue(code: string, path: string, message: string, params?: Record<string, unknown>): ValidationIssue {
  return { code, path, message, ...(params && { params }) }
}

/** Parse the pasted or uploaded text. Tolerates a BOM and the ```json fences a chat assistant likes to add. */
export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false; issue: ValidationIssue } {
  let s = text.replace(/^﻿/, '').trim()
  const fenced = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(s)
  if (fenced) s = (fenced[1] ?? '').trim()
  if (s === '') return { ok: false, issue: issue('json_empty', '', 'empty text') }
  try {
    return { ok: true, value: JSON.parse(s) as unknown }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return { ok: false, issue: issue('json_syntax', '', `not valid JSON: ${detail}`, { detail }) }
  }
}

/** Which format a parsed document declares (null = none or unknown). */
export function adminJsonKind(value: unknown): AdminJsonKind | null {
  if (typeof value !== 'object' || value === null) return null
  const f = (value as { format?: unknown }).format
  if (f === EVENT_FORMAT) return 'event'
  if (f === CONTENT_FORMAT) return 'content'
  return null
}

// ---------------------------------------------------------------------------
// zod → issues with stable codes
// ---------------------------------------------------------------------------

const join = (prefix: string, path: readonly PropertyKey[]): string => [prefix, ...path.map(String)].filter((p) => p !== '').join('.')

type ZodIssueLike = z.core.$ZodIssue

function mapZod(i: ZodIssueLike, prefix: string, out: ValidationIssue[]): void {
  const path = join(prefix, i.path)
  const any = i as unknown as Record<string, unknown>
  switch (i.code) {
    case 'unrecognized_keys':
      for (const k of (any.keys as string[]) ?? []) out.push(issue('unknown_key', join(path, [k]), `unknown key ${k}`, { key: k }))
      return
    case 'invalid_type':
      if (/received undefined/.test(i.message)) out.push(issue('required', path, 'required', { expected: any.expected }))
      else out.push(issue('wrong_type', path, i.message, { expected: any.expected }))
      return
    case 'invalid_value': {
      const values = ((any.values as unknown[]) ?? []).map(String)
      if (path === 'format') out.push(issue('wrong_format', path, i.message, { expected: values.join(', ') }))
      else out.push(issue('bad_value', path, i.message, { values: values.join(', ') }))
      return
    }
    case 'invalid_format': {
      const pattern = String(any.pattern ?? '')
      if (pattern === String(SLUG_RE)) out.push(issue('bad_slug', path, i.message))
      else if (pattern === String(ISO_ZONED)) out.push(issue('bad_date', path, i.message))
      else if (pattern === String(nonBlank)) out.push(issue('blank', path, i.message))
      else out.push(issue('invalid', path, i.message, { detail: i.message }))
      return
    }
    case 'too_small':
    case 'too_big': {
      const small = i.code === 'too_small'
      const bound = small ? any.minimum : any.maximum
      const origin = String(any.origin ?? '')
      const kind = origin === 'number' || origin === 'int' ? 'number' : origin === 'array' || origin === 'set' ? 'list' : 'text'
      out.push(issue(`${kind}_${small ? 'min' : 'max'}`, path, i.message, { [small ? 'min' : 'max']: bound, inclusive: any.inclusive }))
      return
    }
    case 'invalid_key':
      out.push(issue('bad_key', path, i.message))
      return
    case 'custom':
      if (i.message === 'bad_date') out.push(issue('bad_date', path, 'not a real date'))
      else out.push(issue('invalid', path, i.message, { detail: i.message }))
      return
    default:
      out.push(issue('invalid', path, i.message, { detail: i.message }))
  }
}

function zodIssues(error: z.ZodError, prefix = ''): ValidationIssue[] {
  const out: ValidationIssue[] = []
  for (const i of error.issues) mapZod(i, prefix, out)
  // An empty string is also «blank», and a bad date fails the pattern and the calendar: say each thing once.
  const seen = new Set<string>()
  return out.filter((i) => {
    if (i.code === 'blank' && out.some((o) => o.path === i.path && o.code === 'text_min')) return false
    const key = `${i.path}|${i.code}|${JSON.stringify(i.params ?? null)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const withPrefix = (issues: readonly ValidationIssue[], prefix: string): ValidationIssue[] => issues.map((i) => ({ ...i, path: join(prefix, i.path === '' ? [] : i.path.split('.')) }))

function fail<T>(errors: ValidationIssue[], warnings: ValidationIssue[] = []): ImportResult<T> {
  return { ok: false, errors, warnings, requiresConfirm: false }
}

/** `not an object` / a document of the other kind: the problems that make the rest meaningless. */
function wrongDocument(input: unknown, want: AdminJsonKind): ValidationIssue | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return issue('not_object', '', 'the JSON must be an object')
  const kind = adminJsonKind(input)
  if (kind !== null && kind !== want) return issue('wrong_kind', 'format', `this is a ${kind} document`, { found: kind, expected: want })
  return null
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

function eventData(p: z.infer<typeof eventImportSchema>): EventImportData {
  const overlay: EventOverlayBody = {
    featured: p.featured ?? [],
    ...(p.shiny && { shiny: p.shiny }),
    ...(p.legendaryChanceMult !== undefined && { legendaryChanceMult: p.legendaryChanceMult }),
    drops: p.drops ?? [],
    missions: (p.missions ?? []).map((m) => ({ ...m, period: 'event' as const })),
    ...(p.items && Object.keys(p.items).length > 0 && { items: p.items }),
  }
  const c = p.content
  return {
    slug: p.slug,
    name: p.name,
    description: p.description,
    startsAt: Date.parse(p.startsAt),
    endsAt: Date.parse(p.endsAt),
    overlay,
    ...(p.imageNote !== undefined && { imageNote: p.imageNote }),
    ...(c && {
      content: {
        title: c.title ?? p.name.es.slice(0, 80),
        ...(c.note !== undefined && { note: c.note }),
        applyOver: c.applyOver ?? 'live',
        revertWhenEnds: c.revertWhenEnds ?? false,
        patch: c.patch as ContentPatch,
      },
    }),
  }
}

/**
 * Validate an event document (parsed JSON): shape, then the same semantic validation as the server
 * (`validateEventOverlay`, with the tied content patch underneath when there is one) and, unless `smoke: false`,
 * the engine smoke test. `value` (when `ok`) is what the editor needs.
 */
export function validateEventImport(input: unknown, opts: ImportOptions = {}): ImportResult<EventImportData> {
  const wrong = wrongDocument(input, 'event')
  if (wrong) return fail([wrong])
  const parsed = eventImportSchema.safeParse(input)
  if (!parsed.success) return fail(zodIssues(parsed.error))
  const data = eventData(parsed.data)
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  const overlay = { id: 'import', slug: data.slug, startsAt: data.startsAt, endsAt: data.endsAt, ...data.overlay } as unknown as EventOverlay
  // The tied patch is merged over what is live when the admin publishes it; here, over the base (what the CLI knows).
  const tied = data.content
  if (tied) {
    const r = validateContentPatch(tied.patch, { events: [overlay], allEventItems: { ...opts.allEventItems, ...data.overlay.items }, smoke: false })
    errors.push(...withPrefix(r.errors, 'content.patch'))
    warnings.push(...withPrefix(r.warnings, 'content.patch'))
  }
  const ev = validateEventOverlay(overlay, { ...(tied && { patch: tied.patch }), ...(opts.allEventItems && { allEventItems: opts.allEventItems }), ...(opts.smoke !== undefined && { smoke: opts.smoke }) })
  errors.push(...ev.errors)
  warnings.push(...ev.warnings)
  let requiresConfirm = ev.requiresConfirm || warnings.some((w) => w.requiresConfirm)

  if (opts.now !== undefined) {
    if (data.endsAt <= opts.now) warnings.push(issue('ends_in_past', 'endsAt', 'the event already ended: it cannot be published'))
    else if (data.startsAt > opts.now + MAX_SCHEDULE_DAYS * DAY_MS) warnings.push(issue('starts_too_far', 'startsAt', `the event starts more than ${MAX_SCHEDULE_DAYS} days ahead: it cannot be published yet`, { days: MAX_SCHEDULE_DAYS }))
  }
  requiresConfirm ||= warnings.some((w) => w.requiresConfirm)
  return { ok: errors.length === 0, errors, warnings, requiresConfirm, ...(errors.length === 0 && { value: data }) }
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

/** What the draft will hold: the patch alone, or merged over the live one. */
export function patchToApply(data: Pick<ContentImportData, 'applyOver' | 'patch'>, live: ContentPatch | null | undefined): ContentPatch {
  return data.applyOver === 'live' && live ? deepMerge(live, data.patch) : data.patch
}

/** Validate a content document: shape, then `validateContentPatch` (as it will be saved: merged over live when asked). */
export function validateContentImport(input: unknown, opts: ContentImportOptions = {}): ImportResult<ContentImportData> {
  const wrong = wrongDocument(input, 'content')
  if (wrong) return fail([wrong])
  const parsed = contentImportSchema.safeParse(input)
  if (!parsed.success) return fail(zodIssues(parsed.error))
  const p = parsed.data
  const data: ContentImportData = { title: p.title, ...(p.note !== undefined && { note: p.note }), applyOver: p.applyOver ?? 'live', patch: p.patch as ContentPatch }
  const effective = patchToApply(data, opts.live)
  const r = validateContentPatch(effective, {
    ...(opts.live && { previous: opts.live }),
    ...(opts.allEventItems && { allEventItems: opts.allEventItems }),
    ...(opts.smoke !== undefined && { smoke: opts.smoke }),
  })
  // Paths of the merged patch point into `patch` of the document (a path that only exists in the live part has no home there).
  return { ok: r.ok, errors: withPrefix(r.errors, 'patch'), warnings: withPrefix(r.warnings, 'patch'), requiresConfirm: r.requiresConfirm, ...(r.ok && { value: data }) }
}

/** Validate whatever format the document declares. */
export function validateAdminJson(input: unknown, opts: ContentImportOptions = {}): { kind: AdminJsonKind | null; result: ImportResult<EventImportData | ContentImportData> } {
  const kind = adminJsonKind(input)
  if (kind === 'event') return { kind, result: validateEventImport(input, opts) }
  if (kind === 'content') return { kind, result: validateContentImport(input, opts) }
  const bad =
    typeof input !== 'object' || input === null || Array.isArray(input)
      ? issue('not_object', '', 'the JSON must be an object')
      : (input as { format?: unknown }).format === undefined
        ? issue('required', 'format', 'format is required', { expected: 'string' })
        : issue('wrong_format', 'format', 'unknown format', { expected: `${EVENT_FORMAT}, ${CONTENT_FORMAT}` })
  return { kind: null, result: fail([bad]) }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const pad = (n: number): string => String(Math.abs(n)).padStart(2, '0')

/** `2026-12-01T18:00:00-05:00` for an instant, written in the zone `offsetMinutes` east of UTC (Lima = -300). */
export function isoWithOffset(ms: number, offsetMinutes: number): string {
  const d = new Date(ms + offsetMinutes * 60_000)
  const sign = offsetMinutes < 0 ? '-' : '+'
  const off = `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${off}`
}

export interface EventExportInput {
  slug: string
  name: LocalizedText
  description: LocalizedText
  startsAt: number
  endsAt: number
  overlay: EventOverlayBody
}

/** The event as a JSON document. `offsetMinutes` gives the zone of the dates for an instant (default Lima, UTC-5). */
export function eventToJson(e: EventExportInput, opts: { offsetMinutes?: (ms: number) => number; imageNote?: string } = {}): EventImportJson {
  const off = opts.offsetMinutes ?? (() => -300)
  const o = e.overlay
  return {
    format: EVENT_FORMAT,
    slug: e.slug,
    name: e.name,
    description: e.description,
    startsAt: isoWithOffset(e.startsAt, off(e.startsAt)),
    endsAt: isoWithOffset(e.endsAt, off(e.endsAt)),
    ...(opts.imageNote && { imageNote: opts.imageNote }),
    featured: o.featured,
    ...(o.shiny && { shiny: o.shiny }),
    ...(o.legendaryChanceMult !== undefined && { legendaryChanceMult: o.legendaryChanceMult }),
    drops: o.drops,
    ...(o.items && Object.keys(o.items).length > 0 && { items: o.items }),
    missions: o.missions.map(({ period: _period, ...m }) => m),
  }
}

/** A draft's patch is a full patch over the base: it is exported as such (`applyOver: "base"`). */
export function contentToJson(c: { title: string; note?: string; patch: ContentPatch }): ContentImportJson {
  return { format: CONTENT_FORMAT, title: c.title, ...(c.note && { note: c.note }), applyOver: 'base', patch: c.patch as ContentImportJson['patch'] }
}
