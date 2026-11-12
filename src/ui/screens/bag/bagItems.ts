/**
 * Bag model (pure): what the player carries as a flat list of entries, the
 * category of each one, and the search / filter / sort used by the Bag page.
 * Names come from the game data (`lib/names`), copy from the i18n dictionaries.
 */
import { energyAt, evolutionOptions, maxEnergyOf, type EngineContext, type LocaleCode, type OwnedPokemon, type PlayerState, type TypeSlug } from '../../../engine'
import { fmtPct } from '../../lib/format'
import { itemName, pick, pokemonName, speciesName, typeName } from '../../lib/names'
import { lineRoot } from '../shared/EvoLine'

export type BagCategory = 'ball' | 'heal' | 'evolution' | 'candy' | 'event' | 'other'

/** Display order of the categories (also the default sort). */
export const BAG_CATEGORIES: readonly BagCategory[] = ['ball', 'heal', 'evolution', 'candy', 'event', 'other']

export type BagFilter = BagCategory | 'all'
export type BagSort = 'category' | 'name' | 'quantity'

export type BagEntryKind = 'item' | 'chainCandy' | 'typeCandy'

/** One of the player's Pokémon that can use an entry (links to `#/box/<uid>`). */
export interface BagUser {
  uid: string
  name: string
  speciesSlug: string
  /** Can use it right now (an evolution with no other requirement missing, a potion it needs). */
  ready: boolean
}

export interface BagEntry {
  /** Stable key: `item:<slug>`, `chain:<chainId>`, `type:<type>`. */
  id: string
  kind: BagEntryKind
  category: BagCategory
  /** Item slug (items), root species slug of the line (chain candies) or the type (type candies). */
  slug: string
  name: string
  /** What it is for, in the UI language. */
  description: string
  count: number
  users: BagUser[]
}

/** Translator shape of `i18next.t` that the builder needs. */
export type BagText = (key: string, params?: Record<string, unknown>) => string

const evoItemsMemo = new WeakMap<EngineContext, Set<string>>()

/** Item slugs some evolution asks for (stones and the like). */
function evolutionItems(ctx: EngineContext): Set<string> {
  let set = evoItemsMemo.get(ctx)
  if (!set) {
    set = new Set()
    for (const sp of ctx.data.species) for (const e of sp.evolutions) if (e.trigger === 'item' && e.item) set.add(e.item)
    evoItemsMemo.set(ctx, set)
  }
  return set
}

/**
 * Category of an item slug. Mechanics first (healing items from the config,
 * items an evolution consumes), then event / mission items the data does not
 * know, then name patterns of the PokeAPI slugs; anything else is `other`.
 */
export function categorizeItem(slug: string, ctx: EngineContext): BagCategory {
  if (slug in ctx.config.energy.potions || slug === 'revive') return 'heal'
  if (evolutionItems(ctx).has(slug)) return 'evolution'
  const known = ctx.data.items.some((i) => i.slug === slug)
  if (!known && slug in ctx.missions.placeholderItems) return 'event'
  if (slug.endsWith('-ball')) return 'ball'
  if (slug.endsWith('-stone') || slug === 'dubious-disc' || slug === 'electirizer' || slug === 'magmarizer') return 'evolution'
  if (/(^|-)(potion|revive|elixir|ether)$/.test(slug) || slug === 'full-restore') return 'heal'
  if (slug.endsWith('-candy')) return 'candy'
  return 'other'
}

/** Lower case without accents, for search ("poción" matches "pocion"). */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase('en').trim()
}

function userOf(p: OwnedPokemon, lng: LocaleCode, ready: boolean): BagUser {
  return { uid: p.uid, name: pokemonName(p, lng), speciesSlug: p.speciesSlug, ready }
}

function sortUsers(users: BagUser[], lng: LocaleCode): BagUser[] {
  return users.sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name, lng) || a.uid.localeCompare(b.uid))
}

/** Who can use an inventory item: potions (hurt), revive (exhausted) and evolution items (a species that evolves with it). */
function itemUsers(player: PlayerState, slug: string, category: BagCategory, ctx: EngineContext, lng: LocaleCode, now: number): BagUser[] {
  const mons = Object.values(player.pokemon)
  if (category === 'heal') {
    const out: BagUser[] = []
    for (const p of mons) {
      const e = energyAt(player, p, now)
      const need = slug === 'revive' ? e <= 0 : e < maxEnergyOf(p, ctx)
      if (need) out.push(userOf(p, lng, true))
    }
    return sortUsers(out, lng)
  }
  if (category === 'evolution') {
    const out: BagUser[] = []
    for (const p of mons) {
      const sp = ctx.speciesBySlug.get(p.speciesSlug)
      if (!sp?.evolutions.some((e) => e.trigger === 'item' && e.item === slug)) continue
      const opt = evolutionOptions(player, p, now, ctx).find((o) => o.evolution.item === slug)
      out.push(userOf(p, lng, Boolean(opt) && !opt?.blockedBy))
    }
    return sortUsers(out, lng)
  }
  return []
}

function itemDescription(slug: string, category: BagCategory, ctx: EngineContext, lng: LocaleCode, text: BagText): string {
  switch (category) {
    case 'ball':
      return text('bag.desc.ball')
    case 'heal': {
      const amount = ctx.config.energy.potions[slug]
      const effect = amount === undefined ? text('energy.reviveDesc', { pct: fmtPct(ctx.config.energy.revivePct, lng) }) : text('energy.potionDesc', { amount })
      return `${effect}. ${text('bag.healHow')}`
    }
    case 'evolution':
      return text('bag.desc.evolution')
    case 'event':
      return pick(ctx.missions.placeholderItems[slug]?.description, lng) || text('bag.desc.event')
    default:
      return text('bag.desc.other')
  }
}

/**
 * Everything the player carries: Balls and other items from the inventory plus
 * candies by evolution line and by type. Entries with a zero count are left out.
 */
export function buildBagEntries(player: PlayerState, ctx: EngineContext, lng: LocaleCode, text: BagText, now: number): BagEntry[] {
  const out: BagEntry[] = []
  for (const [slug, count] of Object.entries(player.inventory)) {
    if (count <= 0) continue
    const category = categorizeItem(slug, ctx)
    out.push({
      id: `item:${slug}`,
      kind: 'item',
      category,
      slug,
      name: itemName(slug, lng),
      description: itemDescription(slug, category, ctx, lng, text),
      count,
      users: itemUsers(player, slug, category, ctx, lng, now),
    })
  }
  const mons = Object.values(player.pokemon)
  for (const [chainId, count] of Object.entries(player.candies.chains)) {
    if (count <= 0) continue
    const members = ctx.data.species.filter((s) => String(s.evolutionChainId) === chainId)
    const root = members[0] ? lineRoot(members[0]) : null
    const rootName = root ? speciesName(root.slug, lng) : chainId
    const users = mons.filter((p) => String(ctx.speciesBySlug.get(p.speciesSlug)?.evolutionChainId) === chainId).map((p) => userOf(p, lng, true))
    out.push({
      id: `chain:${chainId}`,
      kind: 'chainCandy',
      category: 'candy',
      slug: root?.slug ?? chainId,
      name: text('bag.lineCandy', { name: rootName }),
      description: text('bag.desc.lineCandy', { name: rootName, exp: ctx.config.progression.candyExp }),
      count,
      users: sortUsers(users, lng),
    })
  }
  for (const [type, count] of Object.entries(player.candies.types) as [TypeSlug, number | undefined][]) {
    if (!count || count <= 0) continue
    const tName = typeName(type, lng)
    const users = mons.filter((p) => ctx.speciesBySlug.get(p.speciesSlug)?.types.includes(type)).map((p) => userOf(p, lng, true))
    out.push({
      id: `type:${type}`,
      kind: 'typeCandy',
      category: 'candy',
      slug: type,
      name: text('bag.typeCandy', { type: tName }),
      description: text('bag.desc.typeCandy', { type: tName, exp: ctx.config.progression.typeCandyExp }),
      count,
      users: sortUsers(users, lng),
    })
  }
  return out
}

/** Entries matching a search: every word must appear in the name, description or slug (accents ignored). */
export function searchBag(entries: BagEntry[], query: string): BagEntry[] {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return entries
  return entries.filter((e) => {
    const hay = normalizeText(`${e.name} ${e.description} ${e.kind === 'item' ? e.slug : ''}`)
    return words.every((w) => hay.includes(w))
  })
}

/** Search, then the category filter. */
export function filterBag(entries: BagEntry[], query: string, category: BagFilter): BagEntry[] {
  const found = searchBag(entries, query)
  return category === 'all' ? found : found.filter((e) => e.category === category)
}

/** Entries per category (and `all`) after the search, for the chip counters. */
export function bagCounts(entries: BagEntry[], query: string): Record<BagFilter, number> {
  const found = searchBag(entries, query)
  const out: Record<BagFilter, number> = { all: found.length, ball: 0, heal: 0, evolution: 0, candy: 0, event: 0, other: 0 }
  for (const e of found) out[e.category]++
  return out
}

/** Sorted copy: by category then name (default), by name, or by quantity (most first). */
export function sortBag(entries: BagEntry[], sort: BagSort, lng: LocaleCode): BagEntry[] {
  const byName = (a: BagEntry, b: BagEntry) => a.name.localeCompare(b.name, lng, { sensitivity: 'base' }) || a.id.localeCompare(b.id)
  const cmp: Record<BagSort, (a: BagEntry, b: BagEntry) => number> = {
    category: (a, b) => BAG_CATEGORIES.indexOf(a.category) - BAG_CATEGORIES.indexOf(b.category) || byName(a, b),
    name: byName,
    quantity: (a, b) => b.count - a.count || byName(a, b),
  }
  return [...entries].sort(cmp[sort])
}
