/** The admin import JSON (docs/admin-json.md): shape, semantics shared with the server, merge over live, export, and the examples of the doc. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ContentPatch } from '../../engine/content'
import {
  adminJsonKind,
  contentToJson,
  CONTENT_FORMAT,
  eventToJson,
  EVENT_FORMAT,
  isoWithOffset,
  parseJsonText,
  patchToApply,
  validateAdminJson,
  validateContentImport,
  validateEventImport,
  type EventExportInput,
} from './index'

const DOC = readFileSync(new URL('../../../docs/admin-json.md', import.meta.url), 'utf8')

/** Every ```json block of the doc that is a whole document (starts with its `format`). */
function docExamples(): { format: string; json: unknown; text: string }[] {
  const out: { format: string; json: unknown; text: string }[] = []
  for (const m of DOC.matchAll(/```json\n([\s\S]*?)```/g)) {
    const text = m[1] ?? ''
    if (!/^\{\s*"format"/.test(text)) continue
    const json = JSON.parse(text) as { format: string }
    out.push({ format: json.format, json, text })
  }
  return out
}

const base = (over: Record<string, unknown> = {}) => ({
  format: EVENT_FORMAT,
  slug: 'semana-test',
  name: { es: 'Semana test', en: 'Test week' },
  description: { es: 'Texto **uno**', en: 'Text **one**' },
  startsAt: '2026-12-01T00:00:00-05:00',
  endsAt: '2026-12-08T00:00:00-05:00',
  ...over,
})

const codes = (r: { errors: { code: string; path: string }[] }) => r.errors.map((e) => `${e.path}:${e.code}`)

describe('the examples of docs/admin-json.md', () => {
  const examples = docExamples()

  it('the doc has the three event examples and a content one', () => {
    expect(examples.filter((e) => e.format === EVENT_FORMAT).length).toBeGreaterThanOrEqual(3)
    expect(examples.filter((e) => e.format === CONTENT_FORMAT).length).toBeGreaterThanOrEqual(1)
  })

  it('every one validates with the server rules (smoke test included)', () => {
    for (const ex of examples) {
      const { kind, result } = validateAdminJson(ex.json, { smoke: { sessions: 30 } })
      expect({ title: ex.text.slice(0, 80), kind, errors: result.errors }).toEqual({ title: ex.text.slice(0, 80), kind: ex.format === EVENT_FORMAT ? 'event' : 'content', errors: [] })
      expect(result.ok).toBe(true)
    }
  })

  it('and none of them needs the confirmation tick (the examples are meant to be clean)', () => {
    for (const ex of examples) expect(validateAdminJson(ex.json, { smoke: false }).result.requiresConfirm).toBe(false)
  })
})

describe('parsing the text', () => {
  it('accepts a BOM and the ```json fences a chat adds', () => {
    expect(parseJsonText('﻿{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseJsonText('```\n{"a":1}```')).toEqual({ ok: true, value: { a: 1 } })
  })
  it('says what is wrong with an empty or broken text', () => {
    expect(parseJsonText('   ')).toMatchObject({ ok: false, issue: { code: 'json_empty' } })
    const bad = parseJsonText('{"a": 1,}')
    expect(bad).toMatchObject({ ok: false, issue: { code: 'json_syntax' } })
  })
  it('knows the format of a document', () => {
    expect(adminJsonKind({ format: EVENT_FORMAT })).toBe('event')
    expect(adminJsonKind({ format: CONTENT_FORMAT })).toBe('content')
    expect(adminJsonKind({ format: 'nope' })).toBeNull()
    expect(adminJsonKind([])).toBeNull()
  })
})

describe('event: shape errors carry the path inside the JSON', () => {
  it('reports a missing zone, a bad slug, ranges, unknown keys and empty texts', () => {
    const r = validateEventImport(
      base({
        slug: 'Semana Test',
        endsAt: '2026-12-08T00:00:00',
        name: { es: '', en: 'x' },
        featured: [{ species: 'pikachu', weightMult: 30 }],
        shiny: { chance: 0.5, scope: 'featured' },
        extra: 1,
      }),
    )
    expect(r.ok).toBe(false)
    expect(codes(r)).toEqual(expect.arrayContaining(['slug:bad_slug', 'endsAt:bad_date', 'name.es:text_min', 'featured.0.weightMult:number_max', 'shiny.chance:number_max', 'extra:unknown_key']))
    expect(r.errors.find((e) => e.path === 'featured.0.weightMult')?.params).toMatchObject({ max: 10 })
  })

  it('reports missing fields, a wrong format and the other kind of document', () => {
    expect(codes(validateEventImport({ format: EVENT_FORMAT }))).toEqual(expect.arrayContaining(['slug:required', 'name:required', 'startsAt:required']))
    expect(codes(validateEventImport(base({ format: 'pokefocus.event@9' })))).toContain('format:wrong_format')
    expect(codes(validateEventImport({ format: CONTENT_FORMAT, title: 'x', patch: {} }))).toEqual(['format:wrong_kind'])
    expect(codes(validateEventImport([]))).toEqual([':not_object'])
  })

  it('a date that does not exist is not a date', () => {
    expect(codes(validateEventImport(base({ startsAt: '2026-02-30T10:00:00-05:00' })))).toContain('startsAt:bad_date')
  })

  it('a longSession mission needs minMinutes (the same rule as the server)', () => {
    const r = validateEventImport(base({ missions: [{ id: 'm', kind: 'longSession', target: 1, title: { es: 'a', en: 'b' }, description: { es: 'a', en: 'b' }, rewards: [{ dust: 10 }] }] }))
    expect(r.errors.map((e) => e.path)).toContain('missions.0.minMinutes')
  })
})

describe('event: the semantic validation is the server one', () => {
  it('unknown species and items, duplicates, shiny scope and shadowed items', () => {
    const r = validateEventImport(
      base({
        featured: [{ species: 'nopemon', weightMult: 2 }],
        shiny: { chance: 0.01, scope: 'featured' },
        drops: [
          { item: 'no-such-item', perWaveChance: 0.1, max: 1 },
          { item: 'poke-ball', perWaveChance: 0.1, max: 1 },
          { item: 'poke-ball', perWaveChance: 0.1, max: 1 },
        ],
        items: { 'poke-ball': { names: { es: 'a', en: 'b' } } },
      }),
      { smoke: false },
    )
    expect(codes(r)).toEqual(expect.arrayContaining(['featured.0.species:unknown_species', 'drops.0.item:unknown_item', 'drops.2.item:duplicate_drop', 'items.poke-ball:item_shadows_base']))
  })

  it('shiny «featured» without featured species is an error; big values are warnings that need the tick', () => {
    expect(codes(validateEventImport(base({ shiny: { chance: 0.01, scope: 'featured' } }), { smoke: false }))).toContain('shiny.scope:shiny_no_featured')
    const r = validateEventImport(base({ featured: [{ species: 'pikachu', weightMult: 8 }], legendaryChanceMult: 5 }), { smoke: false })
    expect(r.ok).toBe(true)
    expect(r.requiresConfirm).toBe(true)
    expect(r.warnings.map((w) => w.path)).toEqual(expect.arrayContaining(['featured.0.weightMult', 'legendaryChanceMult']))
  })

  it('items of the other events are known when the caller says so', () => {
    const drop = base({ drops: [{ item: 'spark-token', perWaveChance: 0.1, max: 1 }] })
    expect(codes(validateEventImport(drop, { smoke: false }))).toContain('drops.0.item:unknown_item')
    expect(validateEventImport(drop, { smoke: false, allEventItems: { 'spark-token': { names: { es: 'a', en: 'b' } } } }).ok).toBe(true)
  })

  it('warns about dates that cannot be published, only when given a clock', () => {
    const now = Date.parse('2026-12-20T00:00:00-05:00')
    expect(validateEventImport(base(), { smoke: false }).warnings).toEqual([])
    expect(validateEventImport(base(), { smoke: false, now }).warnings.map((w) => w.code)).toEqual(['ends_in_past'])
    expect(validateEventImport(base(), { smoke: false, now: Date.parse('2026-08-01T00:00:00Z') }).warnings.map((w) => w.code)).toEqual(['starts_too_far'])
  })

  it('an event longer than 62 days is rejected', () => {
    expect(codes(validateEventImport(base({ endsAt: '2027-03-01T00:00:00-05:00' }), { smoke: false }))).toContain('endsAt:invalid')
  })

  it('the smoke test runs unless it is switched off, and the result is what the editor needs', () => {
    const r = validateEventImport(base({ featured: [{ species: 'pikachu', weightMult: 3 }], imageNote: 'portada' }), { smoke: { sessions: 10 } })
    expect(r.ok).toBe(true)
    expect(r.value).toMatchObject({ slug: 'semana-test', startsAt: Date.parse('2026-12-01T00:00:00-05:00'), imageNote: 'portada' })
    expect(r.value?.overlay).toEqual({ featured: [{ species: 'pikachu', weightMult: 3 }], drops: [], missions: [] })
  })
})

describe('event: tied content', () => {
  const tied = (patch: unknown, extra: Record<string, unknown> = {}) => base({ featured: [{ species: 'pikachu', weightMult: 2 }], content: { patch, ...extra } })

  it('a valid patch comes with its defaults (live, no revert, the event name as title)', () => {
    const r = validateEventImport(tied({ species: { pikachu: { spawn: { weightMult: 2 } } } }), { smoke: false })
    expect(r.ok).toBe(true)
    expect(r.value?.content).toEqual({ title: 'Semana test', applyOver: 'live', revertWhenEnds: false, patch: { species: { pikachu: { spawn: { weightMult: 2 } } } } })
  })

  it('problems inside the patch are reported under content.patch', () => {
    const shape = validateEventImport(tied({ config: { encounters: { shinyChance: 0.5 } } }), { smoke: false })
    expect(codes(shape)).toContain('content.patch.config.encounters.shinyChance:number_max')
    const semantic = validateEventImport(tied({ species: { nopemon: { captureRate: 10 } } }), { smoke: false })
    expect(codes(semantic)).toContain('content.patch.species.nopemon:unknown_species')
    expect(codes(validateEventImport(tied({ species: {} }, { revertWhenEnds: 'yes' }), { smoke: false }))).toContain('content.revertWhenEnds:wrong_type')
  })
})

describe('content', () => {
  const doc = (patch: unknown, extra: Record<string, unknown> = {}) => ({ format: CONTENT_FORMAT, title: 'Ajuste', patch, ...extra })

  it('validates a patch like the server does', () => {
    expect(validateContentImport(doc({ species: { eevee: { captureRate: 60 } } }), { smoke: false }).ok).toBe(true)
    expect(codes(validateContentImport(doc({ species: { eevee: { captureRate: 600 } } }), { smoke: false }))).toEqual(['patch.species.eevee.captureRate:number_max'])
    expect(codes(validateContentImport(doc({ species: { nopemon: { captureRate: 6 } } }), { smoke: false }))).toEqual(['patch.species.nopemon:unknown_species'])
    expect(codes(validateContentImport(doc({ config: { session: { x: 1 } } }), { smoke: false }))).toEqual(['patch.config.session:unknown_key'])
    expect(codes(validateContentImport({ format: CONTENT_FORMAT, patch: {} }))).toContain('title:required')
    expect(codes(validateContentImport(base()))).toEqual(['format:wrong_kind'])
  })

  it('«live» merges the changes over what is live (lists are replaced); «base» takes the patch as it is', () => {
    const live: ContentPatch = { species: { eevee: { captureRate: 60 }, pikachu: { spawn: { weightMult: 2 } } }, config: { encounters: { shinyChance: 0.002 } } }
    const r = validateContentImport(doc({ species: { pikachu: { spawn: { hours: [[8, 20]] } } } }), { smoke: false, live })
    expect(r.ok).toBe(true)
    expect(patchToApply(r.value!, live)).toEqual({ species: { eevee: { captureRate: 60 }, pikachu: { spawn: { weightMult: 2, hours: [[8, 20]] } } }, config: { encounters: { shinyChance: 0.002 } } })
    const asBase = validateContentImport(doc({ species: { pikachu: { spawn: { hours: [[8, 20]] } } } }, { applyOver: 'base' }), { smoke: false, live })
    expect(patchToApply(asBase.value!, live)).toEqual({ species: { pikachu: { spawn: { hours: [[8, 20]] } } } })
    // no live patch known: the patch alone
    expect(patchToApply(r.value!, null)).toEqual({ species: { pikachu: { spawn: { hours: [[8, 20]] } } } })
  })

  it('compares the big-change guard against what is live', () => {
    const live: ContentPatch = { species: { pikachu: { spawn: { weightMult: 8 } } } }
    const same = validateContentImport(doc({ species: { eevee: { captureRate: 100 } } }), { smoke: false, live })
    expect(same.warnings.some((w) => w.code === 'big_change')).toBe(false)
  })
})

describe('export', () => {
  const event: EventExportInput = {
    slug: 'noche-electrica',
    name: { es: 'Noche eléctrica', en: 'Electric night' },
    description: { es: 'Texto', en: 'Text' },
    startsAt: Date.parse('2026-12-14T18:00:00-05:00'),
    endsAt: Date.parse('2026-12-21T18:00:00-05:00'),
    overlay: {
      featured: [{ species: 'pikachu', weightMult: 3 }],
      shiny: { chance: 0.008, scope: 'featured' },
      legendaryChanceMult: 2,
      drops: [{ item: 'spark-token', perWaveChance: 0.1, max: 2 }],
      missions: [
        { id: 'm1', period: 'event', kind: 'catch', target: 5, title: { es: 'a', en: 'b' }, description: { es: 'c', en: 'd' }, rewards: [{ dust: 100 }, { minTrainerLevel: 10, dust: 200 }] },
      ],
      items: { 'spark-token': { names: { es: 'Ficha', en: 'Token' }, description: { es: 'x', en: 'y' } } },
    },
  }

  it('writes dates in the asked zone and imports back to the same event', () => {
    const json = eventToJson(event, { imageNote: 'portada' }) as unknown as { startsAt: string; missions: { period?: string }[] }
    expect(json.startsAt).toBe('2026-12-14T18:00:00-05:00')
    expect(json.missions[0]).not.toHaveProperty('period')
    const r = validateEventImport(JSON.parse(JSON.stringify(json)), { smoke: false })
    expect(r.errors).toEqual([])
    expect(r.value).toMatchObject({ slug: event.slug, name: event.name, description: event.description, startsAt: event.startsAt, endsAt: event.endsAt, imageNote: 'portada' })
    expect(r.value?.overlay).toEqual(event.overlay)
  })

  it('omits what is off, and exports a content draft as a full patch over the base', () => {
    const bare = eventToJson({ ...event, overlay: { featured: [], drops: [], missions: [] } }) as Record<string, unknown>
    expect(Object.keys(bare)).toEqual(['format', 'slug', 'name', 'description', 'startsAt', 'endsAt', 'featured', 'drops', 'missions'])
    const c = contentToJson({ title: 'T', patch: { species: { eevee: { captureRate: 60 } } } })
    expect(c).toEqual({ format: CONTENT_FORMAT, title: 'T', applyOver: 'base', patch: { species: { eevee: { captureRate: 60 } } } })
    const back = validateContentImport(JSON.parse(JSON.stringify(c)), { smoke: false })
    expect(back.value).toMatchObject({ title: 'T', applyOver: 'base', patch: { species: { eevee: { captureRate: 60 } } } })
  })

  it('isoWithOffset handles negative, positive and half-hour zones', () => {
    const t = Date.UTC(2026, 11, 1, 23, 30, 5)
    expect(isoWithOffset(t, 0)).toBe('2026-12-01T23:30:05+00:00')
    expect(isoWithOffset(t, -300)).toBe('2026-12-01T18:30:05-05:00')
    expect(isoWithOffset(t, 330)).toBe('2026-12-02T05:00:05+05:30')
    expect(Date.parse(isoWithOffset(t, -300))).toBe(t)
  })
})
