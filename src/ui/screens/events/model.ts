/** Pure helpers of the player-facing events UI (cards, banner, page): easy to test without a DOM. */
import type { LiveEventImage, LiveEventPublic } from '../../../game/protocol'
import type { EventMissionDef, LocaleCode, LocalizedText, MissionReward, MissionView, TimeZoneSpec, TypeSlug } from '../../../engine'
import { intlZone } from '../../lib/format'

export type EventPhase = 'active' | 'upcoming' | 'past'

export function eventPhase(ev: Pick<LiveEventPublic, 'startsAt' | 'endsAt'>, now: number): EventPhase {
  if (now >= ev.endsAt) return 'past'
  return now >= ev.startsAt ? 'active' : 'upcoming'
}

/** The event the home banner shows: the first active one (earliest start) the player has not closed. */
export function bannerEvent(active: readonly LiveEventPublic[], dismissed: readonly string[], now: number): LiveEventPublic | null {
  return active.find((e) => eventPhase(e, now) === 'active' && !dismissed.includes(e.id)) ?? null
}

export interface Remaining {
  days: number
  hours: number
  minutes: number
}

/** ms → whole days, hours and minutes (rounded up to the minute so "0 min" only shows at the end). */
export function remainingParts(ms: number): Remaining {
  const mins = Math.max(0, Math.ceil(ms / 60_000))
  return { days: Math.floor(mins / 1440), hours: Math.floor((mins % 1440) / 60), minutes: mins % 60 }
}

/** i18n key (under `events.remaining.`) and values for a remaining time: "2 d 4 h", "3 h 5 min", "12 min". */
export function remainingKey(r: Remaining): { key: 'dh' | 'hm' | 'm'; values: Record<string, number> } {
  if (r.days > 0) return { key: 'dh', values: { d: r.days, h: r.hours } }
  if (r.hours > 0) return { key: 'hm', values: { h: r.hours, m: r.minutes } }
  return { key: 'm', values: { m: Math.max(1, r.minutes) } }
}

/** "9 nov 2026, 18:30" in the player's time zone (falls back to the browser's when the zone is unknown). */
export function formatEventWhen(ts: number, tz: TimeZoneSpec | undefined, lng: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  try {
    return new Intl.DateTimeFormat(lng, { ...opts, timeZone: tz === undefined ? undefined : intlZone(tz) }).format(ts)
  } catch {
    return new Intl.DateTimeFormat(lng, opts).format(ts)
  }
}

/** `srcset` of an event image: the 480 px card version and the full 16:9 one. */
export function imageSrcSet(img: LiveEventImage): string {
  return `${img.thumbUrl} 480w, ${img.url} ${Math.max(img.width, 481)}w`
}

export interface ShinyBoost {
  /** Event chance ÷ base chance (null when the base is 0). */
  mult: number | null
  /** The event's own chance (0-1). */
  chance: number
  scope: 'all' | 'featured'
}

/** "Shiny ×N": how many times the base shiny chance the event's one is. Null without an event shiny. */
export function shinyBoost(ev: Pick<LiveEventPublic, 'shiny'>, baseChance: number): ShinyBoost | null {
  if (!ev.shiny) return null
  const mult = baseChance > 0 ? ev.shiny.chance / baseChance : null
  return { mult, chance: ev.shiny.chance, scope: ev.shiny.scope }
}

/** 1 → "1", 2.5 → "2.5", 3.04 → "3" (at most one decimal). */
export function fmtMult(n: number): string {
  return String(Math.round(n * 10) / 10)
}

/** An event mission's title/description as the page shows it before the player has a slot for it ({n}, {minutes}, {type} filled in). */
export function fillMissionText(text: LocalizedText, lng: LocaleCode, def: Pick<EventMissionDef, 'target' | 'minMinutes' | 'type'>, typeName: (t: TypeSlug) => string): string {
  const type = def.type && def.type !== 'random' ? typeName(def.type) : ''
  return (text[lng] || text.en || text.es).replaceAll('{n}', String(def.target)).replaceAll('{minutes}', String(def.minMinutes ?? '')).replaceAll('{type}', type)
}

/** The reward of an event mission for a trainer level: the last tier whose `minTrainerLevel` is reached (items, Dust, type Candies). Random items are not listed. */
export function rewardOfDef(def: Pick<EventMissionDef, 'rewards' | 'type'>, trainerLevel: number): MissionReward {
  let tier = def.rewards[0]
  for (const t of def.rewards) if ((t.minTrainerLevel ?? 1) <= trainerLevel) tier = t
  const candies = tier?.typeCandies && def.type && def.type !== 'random' ? { [def.type]: tier.typeCandies } : {}
  return { items: { ...tier?.items }, dust: tier?.dust ?? 0, typeCandies: candies }
}

/** Name of an event's own item, or null when it is not one of its items. */
export function eventItemName(ev: Pick<LiveEventPublic, 'items'>, slug: string, lng: LocaleCode): string | null {
  const names = ev.items?.[slug]?.names
  return names ? (names[lng] ?? names.en ?? names.es ?? null) : null
}

/** Localized text of an event (name / description). */
export function eventText(text: { es: string; en: string }, lng: LocaleCode): string {
  return text[lng] || text.en || text.es
}

/** 0.05 → "5%", 0.0025 → "0.3%" (at most one decimal). */
export function fmtChance(p: number, lng: string): string {
  return new Intl.NumberFormat(lng, { style: 'percent', maximumFractionDigits: p < 0.1 ? 1 : 0 }).format(p)
}

/** One event mission as a line of the card: from the player's own slot when there is one, else from the event's definition. */
export interface MissionLine {
  id: string
  title: string
  description: string
  target: number
  /** null = no slot for this player yet (upcoming event, or the player has not opened the game since it started). */
  progress: number | null
  completed: boolean
  claimed: boolean
  reward: MissionReward
}

export function missionLines(
  ev: Pick<LiveEventPublic, 'missions'>,
  views: readonly MissionView[] | undefined,
  lng: LocaleCode,
  trainerLevel: number,
  typeName: (t: TypeSlug) => string,
): MissionLine[] {
  return ev.missions.map((def) => {
    const v = views?.find((m) => m.defId === def.id)
    if (v) {
      return { id: v.id, title: v.title[lng] || v.title.en, description: v.description[lng] || v.description.en, target: v.target, progress: v.progress, completed: v.completed, claimed: v.claimed, reward: v.reward }
    }
    return {
      id: def.id,
      title: fillMissionText(def.title, lng, def, typeName),
      description: fillMissionText(def.description, lng, def, typeName),
      target: def.target,
      progress: null,
      completed: false,
      claimed: false,
      reward: rewardOfDef(def, trainerLevel),
    }
  })
}
