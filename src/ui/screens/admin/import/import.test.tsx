/** JSON import / export of the admin screen: draft conversions and the round trip, slug clashes, content drafts, and the markup (ES + EN, no raw keys). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ContentPatch } from '../../../../engine/content'
import { parseJsonText, validateContentImport, validateEventImport } from '../../../../game/content'
import type { AdminContentVersionResponse, AdminEvent } from '../../../../game/protocol'
import i18n from '../../../../i18n'
import type { ValidationIssue } from '../../../../game/content'
import { blankDraft, draftFromEvent, draftToBody, sameDraft } from '../events/draft'
import { EventEditor } from '../events/EventEditor'
import { EventsList } from '../events/EventsAdminPanel'
import {
  contentExportText,
  createContentDraft,
  createTiedDraft,
  eventExportText,
  exportFileName,
  filledDraft,
  freeSlug,
  importedDraft,
  isSlug,
  knownEventItems,
  slugState,
} from './logic'
import { ImportIssues, ImportNotice, importIssueText, JsonSource } from './parts'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 9, 15, 0)
const RAW_KEY = /\badminJson\.[a-zA-Z]/
const noop = () => undefined

function event(over: Partial<AdminEvent> = {}): AdminEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'pikachu-week',
    status: 'draft',
    startsAt: Date.UTC(2026, 11, 1, 5, 0),
    endsAt: Date.UTC(2026, 11, 8, 5, 0),
    name: { es: 'Semana Pikachu', en: 'Pikachu Week' },
    description: { es: 'Pikachu **sale** más.\n- uno\n-[green] dos', en: 'Pikachu shows up **more**.' },
    imageId: '22222222-2222-4222-8222-222222222222',
    image: { url: '/media/events/a.webp', thumbUrl: '/media/events/a-480.webp', width: 1600, height: 900 },
    overlay: {
      featured: [{ species: 'pikachu', weightMult: 3 }],
      shiny: { chance: 0.0075, scope: 'featured' },
      legendaryChanceMult: 2,
      drops: [
        { item: 'poke-ball', perWaveChance: 0.25, max: 3 },
        { item: 'spark-token', perWaveChance: 0.05, max: 1 },
      ],
      missions: [
        {
          id: 'sparks',
          period: 'event',
          kind: 'catch',
          target: 5,
          title: { es: 'Atrapa {n}', en: 'Catch {n}' },
          description: { es: 'Atrapa {n} en el evento.', en: 'Catch {n} during the event.' },
          rewards: [{ dust: 100, items: { 'spark-token': 1 }, randomItem: { pool: ['poke-ball'], count: 1 } }, { minTrainerLevel: 10, dust: 300 }],
        },
        {
          id: 'long',
          period: 'event',
          kind: 'longSession',
          minMinutes: 45,
          target: 2,
          minTrainerLevel: 5,
          title: { es: 'Larga', en: 'Long' },
          description: { es: 'Sesiones largas.', en: 'Long sessions.' },
          rewards: [{ items: { potion: 2 } }],
        },
      ],
      items: { 'spark-token': { names: { es: 'Ficha chispa', en: 'Spark token' }, description: { es: 'x', en: 'y' } } },
    },
    revision: 3,
    announceRev: 0,
    validation: null,
    createdBy: null,
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    publishedBy: null,
    publishedAt: null,
    active: false,
    scheduled: false,
    ...over,
  }
}

describe('round trip: export → import is the same draft', () => {
  it('an event survives export and import (image aside, which never travels)', async () => {
    const original = draftFromEvent(event())
    const exp = await eventExportText(original, { offsetMinutes: () => -300 })
    expect(exp.ok).toBe(true)
    if (!exp.ok) return
    const parsed = parseJsonText(exp.text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const r = validateEventImport(parsed.value, { smoke: false, allEventItems: {} })
    expect(r.errors.map((e) => e.path + ':' + e.code)).toEqual([])
    const back = importedDraft(r.value!, {})
    // identity and image are not part of the JSON: a new, unsaved draft without image
    expect(back).toMatchObject({ id: null, status: 'new', revision: 1, imageId: null, image: null })
    expect(sameDraft({ ...back, id: original.id, status: original.status, revision: original.revision, imageId: original.imageId, image: original.image }, original)).toBe(true)
    // and what the request would carry is identical
    expect(draftToBody({ ...back, imageId: original.imageId }).body).toEqual(draftToBody(original).body)
  })

  it('also with everything off and with unusual numbers', async () => {
    const e = event({ overlay: { featured: [], drops: [], missions: [] } })
    const d = { ...draftFromEvent(e), shinyPct: '0.5', legendaryMult: '2' }
    const exp = await eventExportText(d, { offsetMinutes: () => 0 })
    if (!exp.ok) throw new Error('export failed')
    const r = validateEventImport(JSON.parse(exp.text), { smoke: false })
    expect(r.ok).toBe(true)
    expect(importedDraft(r.value!, { target: e })).toMatchObject({ id: e.id, status: 'draft', shinyOn: false, legendaryOn: false })
  })

  it('the exported dates are in the asked zone and the same instants come back', async () => {
    const d = draftFromEvent(event())
    const exp = await eventExportText(d, { offsetMinutes: () => -300 })
    if (!exp.ok) throw new Error('export failed')
    expect(JSON.parse(exp.text)).toMatchObject({ format: 'pokefocus.event@1', startsAt: '2026-12-01T00:00:00-05:00', endsAt: '2026-12-08T00:00:00-05:00' })
  })

  it('a form that cannot be read yet cannot be exported (and says which fields)', async () => {
    const r = await eventExportText(blankDraft(NOW))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.map((p) => p.path)).toEqual(expect.arrayContaining(['slug', 'name.es']))
  })

  it('a content draft round-trips as a full patch over the base', async () => {
    const patch: ContentPatch = { species: { eevee: { captureRate: 60 } }, config: { encounters: { shinyChance: 0.002 } } }
    const text = await contentExportText({ title: 'Mi ajuste', note: 'nota', patch })
    const r = validateContentImport(JSON.parse(text), { smoke: false, live: { species: { pikachu: { captureRate: 100 } } } })
    expect(r.ok).toBe(true)
    expect(r.value).toMatchObject({ title: 'Mi ajuste', note: 'nota', applyOver: 'base', patch })
    expect(JSON.parse(await contentExportText({ title: '  ', patch: {} })).title).toBe('Export')
  })

  it('export file names are safe', () => {
    expect(exportFileName('Semana Pikachu', 'event')).toBe('semana-pikachu.event.json')
    expect(exportFileName('Ñandú!!', 'content')).toBe('nandu.content.json')
    expect(exportFileName('', 'content')).toBe('content.content.json')
  })
})

describe('what an import becomes', () => {
  const data = () => {
    const r = validateEventImport(
      {
        format: 'pokefocus.event@1',
        slug: 'nuevo',
        name: { es: 'Nuevo', en: 'New' },
        description: { es: 'a', en: 'b' },
        startsAt: '2026-12-01T00:00:00-05:00',
        endsAt: '2026-12-02T00:00:00-05:00',
        featured: [{ species: 'eevee', weightMult: 2 }],
        imageNote: 'portada',
      },
      { smoke: false },
    )
    return r.value!
  }

  it('a new import is an unsaved draft; updating a draft keeps its identity and image and replaces the fields', () => {
    const fresh = importedDraft(data())
    expect(fresh).toMatchObject({ id: null, status: 'new', slug: 'nuevo', nameEs: 'Nuevo', featured: [{ species: 'eevee', weightMult: '2' }], imageId: null })
    const target = event()
    const updated = importedDraft(data(), { target })
    expect(updated).toMatchObject({ id: target.id, status: 'draft', revision: 3, imageId: target.imageId, image: target.image, slug: 'nuevo', nameEn: 'New', drops: [], missions: [] })
    expect(importedDraft(data(), { target, slug: 'otro' }).slug).toBe('otro')
  })

  it('filling the editor keeps who the draft is, and a published event keeps its slug', () => {
    const cur = draftFromEvent(event())
    expect(filledDraft(cur, data())).toMatchObject({ id: cur.id, slug: 'nuevo', imageId: cur.imageId, nameEs: 'Nuevo' })
    expect(filledDraft({ ...cur, status: 'published' }, data())).toMatchObject({ slug: cur.slug, status: 'published', nameEs: 'Nuevo' })
    expect(filledDraft(blankDraft(NOW), data())).toMatchObject({ id: null, status: 'new', slug: 'nuevo' })
  })
})

describe('slug clashes', () => {
  const events = [event({ slug: 'a', status: 'draft' }), event({ id: 'b', slug: 'b', status: 'published' }), event({ id: 'c', slug: 'c', status: 'archived' }), event({ id: 'd', slug: 'a-2', status: 'draft' })]

  it('only a draft can be updated; published and archived slugs are taken for ever', () => {
    expect(slugState('zzz', events)).toEqual({ kind: 'free' })
    expect(slugState('a', events).kind).toBe('draft')
    expect(slugState('b', events).kind).toBe('taken')
    expect(slugState('c', events).kind).toBe('taken')
  })

  it('proposes the first free «slug-N» within 64 characters', () => {
    expect(freeSlug('a', events)).toBe('a-3')
    expect(freeSlug('b', events)).toBe('b-2')
    const long = 'x'.repeat(64)
    const next = freeSlug(long, [event({ slug: long })])
    expect(next).toHaveLength(64)
    expect(next.endsWith('-2')).toBe(true)
    expect(isSlug(next)).toBe(true)
  })

  it('knows the items of published and archived events, not of drafts nor of the one being edited', () => {
    const it = (n: string) => ({ overlay: { featured: [], drops: [], missions: [], items: { [n]: { names: { es: n, en: n } } } } })
    const list = [event({ id: 'p', status: 'published', ...it('pub') }), event({ id: 'q', status: 'archived', ...it('arch') }), event({ id: 'r', status: 'draft', ...it('dra') }), event({ id: 's', status: 'published', ...it('self') })]
    expect(Object.keys(knownEventItems(list, 's')).sort()).toEqual(['arch', 'pub'])
  })

  it('isSlug matches the server rule', () => {
    for (const s of ['a', 'semana-pikachu-2026', 'x1']) expect(isSlug(s)).toBe(true)
    for (const s of ['', 'A', 'a b', 'a--b', '-a', 'a-', 'ñ', 'a_b', 'x'.repeat(65)]) expect(isSlug(s)).toBe(false)
  })
})

describe('content drafts', () => {
  const version = (id: number): AdminContentVersionResponse => ({ version: { id } as AdminContentVersionResponse['version'], diff: [], serverNow: NOW })
  const api = () => ({
    createDraft: vi.fn(async (_b: object) => version(7)),
    saveDraft: vi.fn(async (_id: number, _b: object) => version(7)),
  })

  it('«live» starts from what is live and saves the merged patch; «base» starts empty and saves the patch as it is', async () => {
    const live: ContentPatch = { species: { eevee: { captureRate: 60 } } }
    const patch: ContentPatch = { species: { pikachu: { spawn: { weightMult: 2 } } } }
    const a = api()
    await createContentDraft({ title: 'T', note: 'n', applyOver: 'live', patch }, live, a)
    expect(a.createDraft).toHaveBeenCalledWith({ from: 'active', title: 'T', note: 'n' })
    expect(a.saveDraft).toHaveBeenCalledWith(7, { patch: { species: { eevee: { captureRate: 60 }, pikachu: { spawn: { weightMult: 2 } } } } })
    const b = api()
    await createContentDraft({ title: 'T', applyOver: 'base', patch }, live, b)
    expect(b.createDraft).toHaveBeenCalledWith({ from: 'empty', title: 'T' })
    expect(b.saveDraft).toHaveBeenCalledWith(7, { patch })
  })

  it('the tied content of an event becomes a draft and says how to publish it', async () => {
    const a = api()
    const tied = await createTiedDraft({ title: 'Atado', applyOver: 'live', revertWhenEnds: true, patch: { species: {} } }, null, a)
    expect(tied).toEqual({ id: 7, title: 'Atado', revertWhenEnds: true })
    expect(a.createDraft).toHaveBeenCalledTimes(1)
  })

  it('an API error propagates (the dialog shows it) and the second call is never made', async () => {
    const a = api()
    a.createDraft.mockRejectedValueOnce(new Error('too_many_drafts'))
    await expect(createContentDraft({ title: 'T', applyOver: 'base', patch: {} }, null, a)).rejects.toThrow('too_many_drafts')
    expect(a.saveDraft).not.toHaveBeenCalled()
  })
})

describe('markup', () => {
  const issue = (over: Partial<ValidationIssue>): ValidationIssue => ({ code: 'bad_date', path: 'endsAt', message: 'm', ...over })

  for (const lng of ['es', 'en'] as const) {
    it(`the list and the editor offer import and export (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const es = lng === 'es'
      const list = renderToStaticMarkup(<EventsList items={[event()]} error={null} onRetry={noop} onNew={noop} onImport={noop} onOpen={noop} />)
      expect(list).not.toMatch(RAW_KEY)
      expect(list).toContain(es ? 'Importar JSON' : 'Import JSON')
      // while the list loads there is nothing to compare slugs with: no import button
      expect(renderToStaticMarkup(<EventsList items={null} error={null} onRetry={noop} onNew={noop} onOpen={noop} />)).not.toContain(es ? 'Importar JSON' : 'Import JSON')
      const ed = (ev: AdminEvent | null) =>
        renderToStaticMarkup(<EventEditor event={ev} elevated={false} onElevated={noop} onSaved={noop} onDeleted={noop} onBack={noop} onDuplicate={noop} />)
      const draft = ed(event())
      expect(draft).not.toMatch(RAW_KEY)
      expect(draft).toContain(es ? 'Importar JSON' : 'Import JSON')
      expect(draft).toContain(es ? 'Exportar JSON' : 'Export JSON')
      expect(ed(null)).toContain(es ? 'Importar JSON' : 'Import JSON')
      // a published event can be exported but not overwritten by an import; an archived one is locked
      const published = ed(event({ status: 'published' }))
      expect(published).toContain(es ? 'Exportar JSON' : 'Export JSON')
      expect(published).not.toContain(es ? 'Importar JSON' : 'Import JSON')
      expect(ed(event({ status: 'archived' }))).not.toContain(es ? 'Importar JSON' : 'Import JSON')
    })

    it(`an import shows its notice in the editor and the issues with their paths (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const es = lng === 'es'
      const withInfo = renderToStaticMarkup(
        <EventEditor event={null} prefill={importedDraft(validateEventImport({ format: 'pokefocus.event@1', slug: 'nuevo', name: { es: 'N', en: 'N' }, description: { es: 'a', en: 'b' }, startsAt: '2026-12-01T00:00:00-05:00', endsAt: '2026-12-02T00:00:00-05:00' }, { smoke: false }).value!)} importInfo={{ imageNote: 'portada azul', tied: { id: 9, title: 'Atado', revertWhenEnds: true } }} elevated={false} onElevated={noop} onSaved={noop} onDeleted={noop} onBack={noop} onDuplicate={noop} />,
      )
      expect(withInfo).not.toMatch(RAW_KEY)
      expect(withInfo).toContain(es ? 'Importado desde JSON' : 'Imported from JSON')
      expect(withInfo).toContain('portada azul')
      expect(withInfo).toContain('#9')
      expect(withInfo).toContain(es ? 'Abrir el borrador de contenido' : 'Open the content draft')
      // the imported fields are on screen and the draft is unsaved (so «Save» is on)
      expect(withInfo).toContain('value="nuevo"')
      expect(withInfo).not.toMatch(/<button[^>]*disabled=""[^>]*>(?:<[^>]*>)*(Guardar y validar|Save and validate)/)

      const html = renderToStaticMarkup(<ImportIssues kind="event" errors={[issue({}), issue({ code: 'number_max', path: 'featured.0.weightMult', params: { max: 10 } })]} warnings={[issue({ code: 'big_change', path: 'legendaryChanceMult', requiresConfirm: true, params: { factor: 3, value: 5 } })]} />)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain('<code')
      expect(html).toContain('featured.0.weightMult')
      expect(html).toContain(es ? 'el máximo es 10' : 'the maximum is 10')
      expect(html).toContain(es ? '2 errores' : '2 errors')
      expect(html).toContain(es ? '1 aviso' : '1 warning')
      expect(renderToStaticMarkup(<JsonSource value="{}" onChange={noop} onFile={noop} />)).toContain(es ? 'Subir un archivo .json' : 'Upload a .json file')
      expect(renderToStaticMarkup(<ImportNotice info={{}} onDismiss={noop} />)).toContain(es ? 'La imagen no viene en el JSON' : 'The image does not come in the JSON')
    })
  }

  it('every issue code of the import format has copy in both languages, and unknown ones fall back to the message', async () => {
    const codes = ['json_empty', 'json_syntax', 'not_object', 'wrong_kind', 'wrong_format', 'required', 'wrong_type', 'bad_value', 'bad_slug', 'bad_date', 'bad_key', 'blank', 'number_min', 'number_max', 'text_min', 'text_max', 'list_min', 'list_max', 'unknown_key', 'invalid', 'ends_in_past', 'starts_too_far']
    for (const lng of ['es', 'en']) {
      await i18n.changeLanguage(lng)
      for (const code of codes) expect(importIssueText({ code, path: 'x', message: 'fallback' }, 'event')).not.toBe('fallback')
      expect(importIssueText({ code: 'no_such_code', path: 'x', message: 'fallback' }, 'content')).toBe('fallback')
    }
  })
})
