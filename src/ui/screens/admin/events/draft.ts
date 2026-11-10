/**
 * The admin's event form as plain strings (what the inputs hold) and the pure conversions to and from the
 * server's shape (`AdminEvent` ⇄ `POST/PUT /api/admin/events`). Kept free of React so it can be tested alone.
 *
 * Percentages are typed as percentages ("25" = 25 %); the request carries fractions (0.25).
 */
import type { ContentItem, EventMissionDef, LocalizedText, MissionKind, MissionRewardDef, TypeSlug } from '../../../../engine'
import type { AdminEvent, AdminEventStatus, EventOverlayBody, LiveEventImage, LiveEventPublic } from '../../../../game/protocol'
import { fromLocalInput, toLocalInput } from '../../../lib/maintenance'

const HOUR = 3_600_000

export interface DraftFeatured {
  species: string
  weightMult: string
}
export interface DraftDrop {
  item: string
  /** Percent per wave. */
  pct: string
  max: string
}
export interface DraftReward {
  item: string
  count: string
}
export interface DraftMission {
  id: string
  kind: MissionKind
  target: string
  /** longSession only. */
  minMinutes: string
  /** catchType only: '' = none, 'random' or a type slug. */
  type: string
  minTrainerLevel: string
  titleEs: string
  titleEn: string
  descEs: string
  descEn: string
  /** First reward tier (the editable one). */
  dust: string
  typeCandies: string
  items: DraftReward[]
  /** Parts of the original first tier the form does not edit (`minTrainerLevel`, `randomItem`) and every tier after it: kept as they are. */
  tierRest: Pick<MissionRewardDef, 'minTrainerLevel' | 'randomItem'>
  moreTiers: MissionRewardDef[]
}
export interface DraftItem {
  slug: string
  nameEs: string
  nameEn: string
  /** Kept from the original (the form does not edit it). */
  description?: LocalizedText
}

export interface EventDraft {
  /** null = not saved yet. */
  id: string | null
  status: AdminEventStatus | 'new'
  revision: number
  slug: string
  nameEs: string
  nameEn: string
  descEs: string
  descEn: string
  /** `datetime-local` values in the admin's zone. */
  startsAt: string
  endsAt: string
  imageId: string | null
  image: LiveEventImage | null
  featured: DraftFeatured[]
  shinyOn: boolean
  shinyPct: string
  shinyScope: 'all' | 'featured'
  legendaryOn: boolean
  legendaryMult: string
  drops: DraftDrop[]
  missions: DraftMission[]
  items: DraftItem[]
}

const str = (n: number | undefined): string => (n === undefined ? '' : String(n))
/** Fraction → percent text without float noise (0.0075 → "0.75"). */
const toPct = (p: number): string => String(Number((p * 100).toPrecision(8)))
/** Percent text → fraction. */
const fromPct = (n: number): number => Number((n / 100).toPrecision(10))

export function blankDraft(now: number): EventDraft {
  const start = Math.ceil((now + 3 * HOUR) / HOUR) * HOUR
  return {
    id: null,
    status: 'new',
    revision: 1,
    slug: '',
    nameEs: '',
    nameEn: '',
    descEs: '',
    descEn: '',
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(start + 7 * 24 * HOUR),
    imageId: null,
    image: null,
    featured: [],
    shinyOn: false,
    shinyPct: '0.5',
    shinyScope: 'featured',
    legendaryOn: false,
    legendaryMult: '2',
    drops: [],
    missions: [],
    items: [],
  }
}

export function blankMission(existing: readonly DraftMission[]): DraftMission {
  let n = existing.length + 1
  while (existing.some((m) => m.id === `mission-${n}`)) n++
  return {
    id: `mission-${n}`,
    kind: 'sessions',
    target: '3',
    minMinutes: '',
    type: '',
    minTrainerLevel: '',
    titleEs: '',
    titleEn: '',
    descEs: '',
    descEn: '',
    dust: '100',
    typeCandies: '',
    items: [],
    tierRest: {},
    moreTiers: [],
  }
}

function missionToDraft(m: EventMissionDef): DraftMission {
  const [first, ...more] = m.rewards
  const { items, dust, typeCandies, ...rest } = first ?? {}
  return {
    id: m.id,
    kind: m.kind,
    target: str(m.target),
    minMinutes: str(m.minMinutes),
    type: m.type ?? '',
    minTrainerLevel: str(m.minTrainerLevel),
    titleEs: m.title.es,
    titleEn: m.title.en,
    descEs: m.description.es,
    descEn: m.description.en,
    dust: str(dust),
    typeCandies: str(typeCandies),
    items: Object.entries(items ?? {}).map(([item, count]) => ({ item, count: String(count) })),
    tierRest: rest,
    moreTiers: more,
  }
}

/** The form for a saved event. */
export function draftFromEvent(e: AdminEvent): EventDraft {
  const o = e.overlay
  return {
    id: e.id,
    status: e.status,
    revision: e.revision,
    slug: e.slug,
    nameEs: e.name.es,
    nameEn: e.name.en,
    descEs: e.description.es,
    descEn: e.description.en,
    startsAt: toLocalInput(e.startsAt),
    endsAt: toLocalInput(e.endsAt),
    imageId: e.imageId,
    image: e.image,
    featured: o.featured.map((f) => ({ species: f.species, weightMult: String(f.weightMult) })),
    shinyOn: o.shiny !== undefined,
    shinyPct: o.shiny ? toPct(o.shiny.chance) : '0.5',
    shinyScope: o.shiny?.scope ?? 'featured',
    legendaryOn: o.legendaryChanceMult !== undefined,
    legendaryMult: o.legendaryChanceMult !== undefined ? String(o.legendaryChanceMult) : '2',
    drops: o.drops.map((d) => ({ item: d.item, pct: toPct(d.perWaveChance), max: String(d.max) })),
    missions: o.missions.map(missionToDraft),
    items: Object.entries(o.items ?? {}).map(([slug, it]) => ({ slug, nameEs: it.names.es, nameEn: it.names.en, ...(it.description && { description: it.description }) })),
  }
}

export interface DraftProblem {
  /** Field key (`startsAt`, `featured.2.weightMult`, `missions.0.target`…): the same paths the server's issues use where there is one. */
  path: string
  code: 'required' | 'number' | 'dates'
}

export interface EventRequestBody {
  slug: string
  name: LocalizedText
  description: LocalizedText
  startsAt: number
  endsAt: number
  imageId: string | null
  overlay: EventOverlayBody
}

/** What the inputs say → the request body, plus every empty or non-numeric field (the body is only good without problems). */
export function draftToBody(d: EventDraft): { body: EventRequestBody; problems: DraftProblem[] } {
  const problems: DraftProblem[] = []
  const num = (path: string, s: string): number => {
    const n = s.trim() === '' ? Number.NaN : Number(s)
    if (!Number.isFinite(n)) {
      problems.push({ path, code: s.trim() === '' ? 'required' : 'number' })
      return 0
    }
    return n
  }
  const optNum = (path: string, s: string): number | undefined => (s.trim() === '' ? undefined : num(path, s))
  const text = (path: string, s: string): string => {
    if (s.trim() === '') problems.push({ path, code: 'required' })
    return s.trim()
  }

  const startsAt = fromLocalInput(d.startsAt)
  const endsAt = fromLocalInput(d.endsAt)
  if (Number.isNaN(startsAt)) problems.push({ path: 'startsAt', code: 'required' })
  if (Number.isNaN(endsAt)) problems.push({ path: 'endsAt', code: 'required' })
  if (!Number.isNaN(startsAt) && !Number.isNaN(endsAt) && endsAt <= startsAt) problems.push({ path: 'endsAt', code: 'dates' })

  const missions: EventMissionDef[] = d.missions.map((m, i) => {
    const p = `missions.${i}`
    const dust = optNum(`${p}.dust`, m.dust)
    const candies = optNum(`${p}.typeCandies`, m.typeCandies)
    const items: Record<string, number> = {}
    m.items.forEach((r, j) => {
      if (r.item) items[r.item] = num(`${p}.items.${j}.count`, r.count)
    })
    const tier: MissionRewardDef = {
      ...m.tierRest,
      ...(Object.keys(items).length > 0 && { items }),
      ...(dust !== undefined && dust > 0 && { dust }),
      ...(candies !== undefined && candies > 0 && { typeCandies: candies }),
    }
    const minMinutes = m.kind === 'longSession' ? num(`${p}.minMinutes`, m.minMinutes) : undefined
    const minLevel = optNum(`${p}.minTrainerLevel`, m.minTrainerLevel)
    return {
      id: m.id.trim(),
      period: 'event',
      kind: m.kind,
      target: num(`${p}.target`, m.target),
      ...(minMinutes !== undefined && { minMinutes }),
      ...(m.kind === 'catchType' && m.type !== '' && { type: m.type as TypeSlug | 'random' }),
      ...(minLevel !== undefined && { minTrainerLevel: minLevel }),
      title: { es: text(`${p}.title.es`, m.titleEs), en: text(`${p}.title.en`, m.titleEn) },
      description: { es: text(`${p}.description.es`, m.descEs), en: text(`${p}.description.en`, m.descEn) },
      rewards: [tier, ...m.moreTiers],
    }
  })

  const items: Record<string, ContentItem> = {}
  d.items.forEach((it, i) => {
    items[it.slug.trim()] = {
      names: { es: text(`items.${i}.names.es`, it.nameEs), en: text(`items.${i}.names.en`, it.nameEn) },
      ...(it.description && { description: it.description }),
    }
  })

  const overlay: EventOverlayBody = {
    featured: d.featured.map((f, i) => ({ species: f.species, weightMult: num(`featured.${i}.weightMult`, f.weightMult) })),
    ...(d.shinyOn && { shiny: { chance: fromPct(num('shiny.chance', d.shinyPct)), scope: d.shinyScope } }),
    ...(d.legendaryOn && { legendaryChanceMult: num('legendaryChanceMult', d.legendaryMult) }),
    drops: d.drops.map((x, i) => ({ item: x.item, perWaveChance: fromPct(num(`drops.${i}.perWaveChance`, x.pct)), max: num(`drops.${i}.max`, x.max) })),
    missions,
    ...(d.items.length > 0 && { items }),
  }

  const body: EventRequestBody = {
    slug: d.slug.trim(),
    name: { es: text('name.es', d.nameEs), en: text('name.en', d.nameEn) },
    description: { es: text('description.es', d.descEs), en: text('description.en', d.descEn) },
    startsAt: Number.isNaN(startsAt) ? 0 : startsAt,
    endsAt: Number.isNaN(endsAt) ? 0 : endsAt,
    imageId: d.imageId,
    overlay,
  }
  if (body.slug === '') problems.push({ path: 'slug', code: 'required' })
  return { body, problems }
}

/** The event as a player's card shows it (the admin's live preview of the draft). Null while the form cannot be read. */
export function draftToPublic(d: EventDraft): LiveEventPublic | null {
  const { body, problems } = draftToBody(d)
  if (problems.some((p) => p.code !== 'dates') || body.endsAt === 0) return null
  return { id: d.id ?? 'draft', slug: body.slug || 'draft', name: body.name, description: body.description, image: d.image, startsAt: body.startsAt, endsAt: body.endsAt, ...body.overlay }
}

/** What `validateEventOverlay` takes: the overlay with its id, slug and dates. */
export function draftToOverlayInput(d: EventDraft): Record<string, unknown> | null {
  const { body, problems } = draftToBody(d)
  if (problems.some((p) => p.code === 'number')) return null
  return { id: d.id ?? 'draft', slug: body.slug || 'draft', startsAt: body.startsAt, endsAt: body.endsAt, ...body.overlay }
}

/** Two drafts say the same thing (to know whether there are unsaved changes). */
export function sameDraft(a: EventDraft, b: EventDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Lowercase slug proposal from a name ("Semana Pikachu" → "semana-pikachu"). */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** The list order of the admin: running first, then scheduled, drafts, and the rest by date. */
export type EventGroup = 'active' | 'scheduled' | 'draft' | 'past'

export function eventGroup(e: Pick<AdminEvent, 'status' | 'active' | 'scheduled' | 'endsAt'>): EventGroup {
  if (e.status === 'draft') return 'draft'
  if (e.status === 'published' && e.active) return 'active'
  if (e.status === 'published' && e.scheduled) return 'scheduled'
  return 'past'
}
