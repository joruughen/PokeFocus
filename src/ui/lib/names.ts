/**
 * Localized names and descriptions taken from the game data (never from the
 * i18n dictionaries): species, types, moves, items, natures, abilities, and
 * technique/ability effect descriptions.
 */
import { defaultContext, type LocaleCode, type LocalizedText, type PartialLocalizedText, type TypeSlug } from '../../engine'
import { useTranslation } from 'react-i18next'

const ctx = defaultContext()
const typeNames = new Map(ctx.data.types.types.map((t) => [t.slug, t.names]))
const itemNames = new Map(ctx.data.items.map((i) => [i.slug, i.names]))
const abilityNames = new Map(ctx.data.abilities.map((a) => [a.slug, a.names]))

export function asLocale(lng: string): LocaleCode {
  return lng.startsWith('es') ? 'es' : 'en'
}

export function pick(text: LocalizedText | PartialLocalizedText | undefined, lng: LocaleCode): string {
  if (!text) return ''
  return text[lng] ?? text.en ?? text.es ?? ''
}

export function speciesName(slug: string, lng: LocaleCode): string {
  const s = ctx.speciesBySlug.get(slug)
  return s ? pick(s.names, lng) : slug
}
export function typeName(type: TypeSlug, lng: LocaleCode): string {
  return pick(typeNames.get(type), lng) || type
}
export function moveName(slug: string, lng: LocaleCode): string {
  return pick(ctx.movesBySlug.get(slug)?.names, lng) || slug
}
export function itemName(slug: string, lng: LocaleCode): string {
  // Mission-only items the data doesn't have yet (Tera Shard, TM) are named in custom-missions.json.
  return pick(itemNames.get(slug) ?? ctx.missions.placeholderItems[slug]?.names, lng) || slug
}
export function natureName(slug: string, lng: LocaleCode): string {
  return pick(ctx.naturesBySlug.get(slug)?.names, lng) || slug
}
export function abilityName(slug: string, lng: LocaleCode): string {
  return pick(abilityNames.get(slug), lng) || slug
}
/** PokeFocus description of a special technique (custom-techniques.json), or ''. */
export function techniqueDescription(slug: string, lng: LocaleCode): string {
  return pick(ctx.techniques[slug]?.description, lng)
}
/** PokeFocus description of an ability (custom-abilities.json), or ''. */
export function abilityDescription(slug: string, lng: LocaleCode): string {
  return pick(ctx.abilities[slug]?.description, lng)
}

/** `useNames()` → name helpers bound to the current UI language. */
export function useNames() {
  const { i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  return {
    lng,
    species: (slug: string) => speciesName(slug, lng),
    type: (t: TypeSlug) => typeName(t, lng),
    move: (slug: string) => moveName(slug, lng),
    item: (slug: string) => itemName(slug, lng),
    nature: (slug: string) => natureName(slug, lng),
    ability: (slug: string) => abilityName(slug, lng),
    technique: (slug: string) => techniqueDescription(slug, lng),
    abilityDesc: (slug: string) => abilityDescription(slug, lng),
  }
}
