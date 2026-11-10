/** Admin events editor: form <-> request conversions, validation round trip, markup (ES + EN, no raw keys), upload and publish flow pieces. */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../../i18n'
import { validateEventOverlay } from '../../../../game/content'
import type { AdminEvent } from '../../../../game/protocol'
import { eventsAdminApi } from './api'
import { blankDraft, blankMission, draftFromEvent, draftToBody, draftToOverlayInput, draftToPublic, eventGroup, sameDraft, slugify } from './draft'
import { eventsErrorText } from './errors'
import { EventEditor } from './EventEditor'
import { EventsList, groupEvents } from './EventsAdminPanel'
import { ImagePicker, uploadProblem } from './ImagePicker'
import { mergePreviews } from './preview'
import { SpawnTable } from './SpawnPreview'
import { SudoForm } from './SudoDialog'
import { ApiError } from '../../../api'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 9, 15, 0)
const noop = () => undefined
const RAW_KEY = /\beventsAdmin\.[a-zA-Z]/

function event(over: Partial<AdminEvent> = {}): AdminEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'pikachu-week',
    status: 'draft',
    startsAt: NOW + 2 * HOUR,
    endsAt: NOW + 50 * HOUR,
    name: { es: 'Semana Pikachu', en: 'Pikachu Week' },
    description: { es: 'Pikachu aparece más.', en: 'Pikachu shows up more.' },
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
      ],
      items: { 'spark-token': { names: { es: 'Ficha chispa', en: 'Spark token' } } },
    },
    revision: 1,
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

describe('draft <-> request', () => {
  it('a saved event survives the form untouched (percentages, extra reward tiers, randomItem, item descriptions)', () => {
    const e = event()
    e.overlay.items!['spark-token']!.description = { es: 'x', en: 'y' }
    const d = draftFromEvent(e)
    expect(d.shinyPct).toBe('0.75')
    expect(d.drops[0]!.pct).toBe('25')
    const { body, problems } = draftToBody(d)
    expect(problems).toEqual([])
    expect(body.overlay).toEqual(e.overlay)
    expect(body.name).toEqual(e.name)
    expect(body.startsAt).toBe(Math.floor(e.startsAt / 60_000) * 60_000)
    expect(body.imageId).toBe(e.imageId)
  })

  it('what the form sends passes the same validation as the server', () => {
    const d = draftFromEvent(event())
    const input = draftToOverlayInput(d)!
    const r = validateEventOverlay(input, { smoke: false })
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('reports empty and non-numeric fields with their path, and a bad date range', () => {
    const d = { ...blankDraft(NOW), featured: [{ species: 'pikachu', weightMult: 'abc' }], drops: [{ item: 'poke-ball', pct: '', max: '2' }], missions: [{ ...blankMission([]), target: '' }] }
    const { problems } = draftToBody({ ...d, endsAt: d.startsAt })
    const paths = problems.map((p) => `${p.path}:${p.code}`)
    expect(paths).toContain('name.es:required')
    expect(paths).toContain('slug:required')
    expect(paths).toContain('featured.0.weightMult:number')
    expect(paths).toContain('drops.0.perWaveChance:required')
    expect(paths).toContain('missions.0.target:required')
    expect(paths).toContain('endsAt:dates')
    expect(draftToOverlayInput(d)).toBeNull()
  })

  it('optional blocks only go out when switched on; longSession needs minMinutes, catchType keeps its type', () => {
    const base = draftFromEvent(event({ overlay: { featured: [], drops: [], missions: [] } }))
    const off = draftToBody(base).body.overlay
    expect(off).toEqual({ featured: [], drops: [], missions: [] })
    const m = { ...blankMission([]), kind: 'longSession' as const, minMinutes: '45', titleEs: 'a', titleEn: 'b', descEs: 'c', descEn: 'd' }
    const withMission = draftToBody({ ...base, shinyOn: true, shinyPct: '1', legendaryOn: true, legendaryMult: '3', missions: [m, { ...m, id: 'm2', kind: 'catchType', type: 'water', minMinutes: '' }] })
    expect(withMission.body.overlay.shiny).toEqual({ chance: 0.01, scope: 'featured' })
    expect(withMission.body.overlay.legendaryChanceMult).toBe(3)
    expect(withMission.body.overlay.missions[0]).toMatchObject({ kind: 'longSession', minMinutes: 45 })
    expect(withMission.body.overlay.missions[1]).toMatchObject({ kind: 'catchType', type: 'water' })
    expect(withMission.body.overlay.missions[1]).not.toHaveProperty('minMinutes')
  })

  it('the player preview needs a readable form and keeps the draft image', () => {
    const d = draftFromEvent(event())
    expect(draftToPublic(d)?.image?.thumbUrl).toBe('/media/events/a-480.webp')
    expect(draftToPublic({ ...d, drops: [{ item: 'poke-ball', pct: 'x', max: '1' }] })).toBeNull()
  })

  it('detects unsaved changes, slugs names and groups events by state', () => {
    const d = draftFromEvent(event())
    expect(sameDraft(d, { ...d })).toBe(true)
    expect(sameDraft(d, { ...d, nameEn: 'x' })).toBe(false)
    expect(slugify('¡Semana Pikachú 2026!')).toBe('semana-pikachu-2026')
    const e = (over: Partial<AdminEvent>) => event(over)
    expect(eventGroup(e({ status: 'draft' }))).toBe('draft')
    expect(eventGroup(e({ status: 'published', active: true }))).toBe('active')
    expect(eventGroup(e({ status: 'published', scheduled: true }))).toBe('scheduled')
    expect(eventGroup(e({ status: 'published' }))).toBe('past')
    expect(eventGroup(e({ status: 'archived' }))).toBe('past')
    const g = groupEvents([e({ id: 'a', status: 'draft', updatedAt: 1 }), e({ id: 'b', status: 'draft', updatedAt: 5 }), e({ id: 'c', status: 'archived', endsAt: 9 }), e({ id: 'd', status: 'archived', endsAt: 20 })])
    expect(g.draft.map((x) => x.id)).toEqual(['b', 'a'])
    expect(g.past.map((x) => x.id)).toEqual(['d', 'c'])
  })
})

describe('spawn preview table', () => {
  const sp = (slug: string, probability: number) => ({ slug, probability, weight: 1, weightMult: 1 })
  it('joins both tables, featured first, then by share', () => {
    const rows = mergePreviews({ species: [sp('rattata', 0.4), sp('pidgey', 0.3), sp('pikachu', 0.05)] }, { species: [sp('rattata', 0.3), sp('pidgey', 0.2), sp('pikachu', 0.2), sp('eevee', 0.1)] }, ['pikachu'])
    expect(rows.map((r) => r.slug)).toEqual(['pikachu', 'rattata', 'pidgey', 'eevee'])
    expect(rows[0]).toMatchObject({ before: 0.05, after: 0.2, featured: true })
    expect(rows[0]!.delta).toBeCloseTo(0.15)
    expect(rows[3]).toMatchObject({ before: 0, after: 0.1 })
  })
  it('renders in both languages', async () => {
    const rows = mergePreviews({ species: [sp('rattata', 0.4)] }, { species: [sp('rattata', 0.3), sp('pikachu', 0.1)] }, ['pikachu'])
    for (const lng of ['es', 'en'] as const) {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<SpawnTable rows={rows} legendary={[0.001, 0.002]} count={[1, 2]} hour={12} lng={lng} />)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain('Pikachu')
      expect(html).toContain(lng === 'es' ? 'Con evento' : 'With event')
      expect(html).toContain('<table')
      expect(html).toContain('scope="col"')
    }
  })
})

describe('SudoForm', () => {
  const form = (over: Partial<Parameters<typeof SudoForm>[0]> = {}) =>
    renderToStaticMarkup(<SudoForm mode="publish" eventName="Semana Pikachu" elevated={false} risky={[]} busy={false} error={null} onSubmit={noop} onCancel={noop} {...over} />)

  for (const lng of ['es', 'en'] as const) {
    it(`asks for the password only when the sudo mode is off (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const locked = form()
      expect(locked).not.toMatch(RAW_KEY)
      expect(locked).toContain('type="password"')
      expect(locked).toContain(lng === 'es' ? 'Tu contraseña' : 'Your password')
      expect(locked).toContain(lng === 'es' ? 'Publicar ahora' : 'Publish now')
      expect(form({ elevated: true })).not.toContain('type="password"')
    })
  }

  it('shows the big-change warnings with a confirmation box, and nothing when there are none', async () => {
    await i18n.changeLanguage('en')
    const risky = form({ risky: [{ code: 'big_change', path: 'featured.0.weightMult', message: 'featured weight ×8', requiresConfirm: true }], elevated: true })
    expect(risky).toContain('type="checkbox"')
    expect(risky).toContain('Big changes you must confirm')
    expect(risky).toContain('Big change')
    expect(form({ elevated: true })).not.toContain('type="checkbox"')
  })

  it('has its own copy for every mode', async () => {
    await i18n.changeLanguage('es')
    for (const mode of ['publish', 'schedule', 'save', 'archive'] as const) {
      const html = form({ mode, elevated: true })
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain('Semana Pikachu')
    }
    expect(form({ mode: 'schedule', elevated: true })).toContain('Programar')
  })
})

describe('ImagePicker', () => {
  it('checks type and size before uploading', () => {
    expect(uploadProblem({ type: 'image/png', size: 1000 })).toBeNull()
    expect(uploadProblem({ type: 'image/webp', size: 3 * 1024 * 1024 })).toBeNull()
    expect(uploadProblem({ type: 'image/gif', size: 1000 })).toBe('unsupported_type')
    expect(uploadProblem({ type: 'image/svg+xml', size: 1000 })).toBe('unsupported_type')
    expect(uploadProblem({ type: 'image/png', size: 3 * 1024 * 1024 + 1 })).toBe('body_too_large')
    expect(uploadProblem({ type: 'image/jpeg', size: 0 })).toBe('empty')
  })
  it('shows a 16:9 preview and the upload button (ES + EN)', async () => {
    for (const lng of ['es', 'en'] as const) {
      await i18n.changeLanguage(lng)
      const none = renderToStaticMarkup(<ImagePicker imageId={null} image={null} onChange={noop} />)
      expect(none).not.toMatch(RAW_KEY)
      expect(none).toContain('aspect-video')
      expect(none).toContain('accept="image/png,image/jpeg,image/webp"')
      expect(none).toContain(lng === 'es' ? 'Subir imagen' : 'Upload image')
      const some = renderToStaticMarkup(<ImagePicker imageId="x" image={event().image} onChange={noop} />)
      expect(some).toContain('-480.webp')
      expect(some).toContain(lng === 'es' ? 'Quitar imagen' : 'Remove image')
    }
  })
})

describe('events list and editor markup', () => {
  it('lists events by state in both languages', async () => {
    const items = [event({ id: 'a' }), event({ id: 'b', status: 'published', active: true, slug: 'live-one' }), event({ id: 'c', status: 'published', scheduled: true, slug: 'soon' })]
    for (const lng of ['es', 'en'] as const) {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<EventsList items={items} error={null} onRetry={noop} onNew={noop} onOpen={noop} />)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain(lng === 'es' ? 'En marcha' : 'Running')
      expect(html).toContain(lng === 'es' ? 'Programados' : 'Scheduled')
      expect(html).toContain(lng === 'es' ? 'Borradores' : 'Drafts')
      expect(html).toContain('live-one')
      expect(html.match(/<button/g)!.length).toBe(4)
    }
    expect(renderToStaticMarkup(<EventsList items={[]} error={null} onRetry={noop} onNew={noop} onOpen={noop} />)).toContain('There are no events yet')
    expect(renderToStaticMarkup(<EventsList items={null} error="boom" onRetry={noop} onNew={noop} onOpen={noop} />)).toContain('boom')
  })

  const editor = (e: AdminEvent | null, over: Partial<Parameters<typeof EventEditor>[0]> = {}) =>
    renderToStaticMarkup(<EventEditor event={e} elevated={false} onElevated={noop} onSaved={noop} onDeleted={noop} onBack={noop} onDuplicate={noop} {...over} />)

  for (const lng of ['es', 'en'] as const) {
    it(`renders every section of a draft with its values (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const es = lng === 'es'
      const html = editor(event())
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain('Semana Pikachu')
      expect(html).toContain('pikachu-week')
      expect(html).toContain('type="datetime-local"')
      expect(html).toContain('UTC')
      expect(html).toContain('<datalist')
      expect(html).toContain(es ? 'Especies destacadas' : 'Featured species')
      expect(html).toContain(es ? 'Premios por oleada' : 'Prizes per wave')
      expect(html).toContain(es ? 'Misiones del evento' : 'Event missions')
      expect(html).toContain(es ? 'Vista previa de apariciones' : 'Spawn preview')
      expect(html).toContain(es ? 'Así lo verán los jugadores' : 'What players will see')
      expect(html).toContain(es ? 'Guardar y validar' : 'Save and validate')
      expect(html).toMatch(es ? /Publicar…|Programar…/ : /Publish…|Schedule…/)
      expect(html).toContain('0.75')
      // Every input has a label (a11y): each id used by a label exists once.
      const ids = [...html.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1]!)
      expect(ids.length).toBeGreaterThan(20)
      for (const id of ids) expect(html.split(`id="${id}"`).length - 1).toBe(1)
    })
  }

  it('a published event locks its slug and offers saving changes and archiving; an archived one is read only', async () => {
    await i18n.changeLanguage('en')
    const published = editor(event({ status: 'published', active: true, revision: 3 }))
    expect(published).toContain('revision 3')
    expect(published).toContain('Archive…')
    expect(published).toContain('Save changes…')
    expect(published).toContain('A published event keeps its identifier.')
    expect(published).not.toContain('Delete draft')
    const archived = editor(event({ status: 'archived' }))
    expect(archived).toContain('<fieldset disabled=""')
    expect(archived).not.toContain('Archive…')
    expect(archived).not.toContain('Save and validate')
    expect(archived).toContain('Duplicate as a draft')
  })

  it('a new event starts empty, with a delete-free action bar and no spawn preview until saved', async () => {
    await i18n.changeLanguage('en')
    const html = editor(null)
    expect(html).toContain('New event')
    expect(html).not.toContain('Delete draft')
    expect(html).toContain('Save the draft to see the preview.')
  })
})

describe('error copy', () => {
  it('has text for the codes the event routes answer, in both languages', async () => {
    for (const lng of ['es', 'en'] as const) {
      await i18n.changeLanguage(lng)
      for (const code of ['slug_taken', 'elevation_required', 'wrong_password', 'confirm_required', 'validation_failed', 'unsupported_type', 'image_too_small', 'in_use']) {
        const text = eventsErrorText(new ApiError(code === 'slug_taken' ? 409 : 400, code))
        expect(text).not.toMatch(RAW_KEY)
        expect(text.length).toBeGreaterThan(10)
      }
      expect(eventsErrorText(new ApiError(429, 'rate_limited', 120))).toContain('2')
    }
  })
})

describe('api calls', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stub = (status = 200, body: unknown = {}) => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', f)
    return f
  }

  it('uploads the picture as the raw body with its own content type', async () => {
    const f = stub(201, { upload: { id: 'u' }, reused: false })
    const file = new File([new Uint8Array([1, 2, 3])], 'cover.png', { type: 'image/png' })
    await eventsAdminApi.upload(file)
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('/api/admin/uploads')
    expect(init!.method).toBe('POST')
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe('image/png')
    expect(init!.body).toBe(file)
  })

  it('edits with PUT, publishes and archives with POST, and asks the preview with the event', async () => {
    const f = stub(200, { event: {} })
    await eventsAdminApi.update('e1', { slug: 'x', confirm: true })
    await eventsAdminApi.publish('e1', { confirm: true, note: 'go' })
    await eventsAdminApi.archive('e1', {})
    await eventsAdminApi.spawnPreview({ eventId: 'e1', hour: 9, weather: 'rain', trainerLevel: 12 })
    const calls = f.mock.calls.map(([u, i]) => `${i?.method} ${u}`)
    expect(calls).toEqual([
      'PUT /api/admin/events/e1',
      'POST /api/admin/events/e1/publish',
      'POST /api/admin/events/e1/archive',
      'GET /api/admin/content/spawn-preview?hour=9&weather=rain&trainerLevel=12&eventId=e1',
    ])
    expect(JSON.parse(String(f.mock.calls[1]![1]!.body))).toEqual({ confirm: true, note: 'go' })
  })
})
