/**
 * Bag model (pure): what the player carries as a flat list of entries, the
 * category of each one, and the search / filter / sort used by the Bag page.
 * Names come from the game data (`lib/names`), copy from the i18n dictionaries.
 */
import {
  abilityCapsuleChoices,
  ABILITY_CAPSULE,
  BOTTLE_CAP,
  bottleCapStats,
  CHOICE_MINT,
  effectiveNature,
  energyAt,
  evolutionOptions,
  isMintItem,
  isUnlocked,
  maxEnergyOf,
  mintNatureOf,
  TECHNICAL_MACHINE,
  TERA_SHARD,
  tmCandidates,
  unlockLevel,
  type AdvancedUnlock,
  type EngineContext,
  type LocaleCode,
  type OwnedPokemon,
  type PlayerState,
  type TypeSlug,
} from '../../../engine'
import { fmtPct } from '../../lib/format'
import { itemName, natureName, pick, pokemonName, speciesName, typeName } from '../../lib/names'
import { lineRoot } from '../shared/EvoLine'
import { ROLE_STAT, roleNatureFit } from '../box/roleNature'

export type BagCategory = 'ball' | 'heal' | 'evolution' | 'candy' | 'training' | 'event' | 'other'

/** Display order of the categories (also the default sort). */
export const BAG_CATEGORIES: readonly BagCategory[] = ['ball', 'heal', 'evolution', 'candy', 'training', 'event', 'other']

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
  /** i18n key suffix of the users line (`bag.users.<key>` / `bag.noUsers.<key>`); default: the category or kind. */
  usersKey?: string
  /** Trainer level that unlocks its use, while the player is below it (advanced items). */
  lockedLevel?: number
}

/** Advanced item kind (F4) of an item slug, or null. */
export type TrainingKind = 'tera' | 'tm' | 'mint' | 'bottleCap' | 'abilityCapsule'

export function trainingKind(slug: string, ctx: EngineContext): TrainingKind | null {
  if (slug === TERA_SHARD) return 'tera'
  if (slug === TECHNICAL_MACHINE) return 'tm'
  if (slug === BOTTLE_CAP) return 'bottleCap'
  if (slug === ABILITY_CAPSULE) return 'abilityCapsule'
  return isMintItem(slug, ctx) ? 'mint' : null
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
  if (trainingKind(slug, ctx)) return 'training'
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
  if (category === 'training') return trainingUsers(player, slug, ctx, lng)
  return []
}

/**
 * Who an advanced item is for: Tera → the team; TM → those with a TM move left to learn; mint → those whose
 * role it suits better (it raises their role stat and their effect does not yet); Bottle Cap → team members
 * with an IV below the max; Ability Capsule → those with another ability to choose.
 */
function trainingUsers(player: PlayerState, slug: string, ctx: EngineContext, lng: LocaleCode): BagUser[] {
  const kind = trainingKind(slug, ctx)
  const mons = Object.values(player.pokemon)
  const team = player.team.map((u) => player.pokemon[u]).filter((p): p is OwnedPokemon => Boolean(p))
  let list: OwnedPokemon[] = []
  if (kind === 'tera') list = team
  else if (kind === 'tm') list = mons.filter((p) => tmCandidates(p, ctx).length > 0)
  else if (kind === 'bottleCap') list = team.filter((p) => bottleCapStats(p, ctx).length > 0)
  else if (kind === 'abilityCapsule') list = mons.filter((p) => abilityCapsuleChoices(p, ctx).length > 0)
  else if (slug === CHOICE_MINT) {
    // Any nature can be picked: those whose role stat is not yet raised by their effect (and that a nature could raise).
    list = mons.filter((p) => {
      const role = ctx.speciesBySlug.get(p.speciesSlug)?.role
      const stat = role ? ROLE_STAT[role] : null
      return Boolean(stat) && stat !== 'hp' && roleNatureFit(role, ctx.naturesBySlug.get(effectiveNature(p)))?.kind !== 'with'
    })
  } else if (kind === 'mint') {
    const target = ctx.naturesBySlug.get(mintNatureOf(slug, ctx) ?? '')
    list = mons.filter((p) => {
      const role = ctx.speciesBySlug.get(p.speciesSlug)?.role
      return roleNatureFit(role, target)?.kind === 'with' && roleNatureFit(role, ctx.naturesBySlug.get(effectiveNature(p)))?.kind !== 'with'
    })
  }
  return sortUsers(list.map((p) => userOf(p, lng, true)), lng)
}

const UNLOCK_OF: Partial<Record<TrainingKind, AdvancedUnlock>> = { tera: 'tera', tm: 'tm', mint: 'mint', bottleCap: 'bottleCap', abilityCapsule: 'abilityCapsule' }

function trainingDescription(slug: string, ctx: EngineContext, lng: LocaleCode, text: BagText): string {
  const kind = trainingKind(slug, ctx)
  const a = ctx.config.advanced
  switch (kind) {
    case 'tera':
      return text('bag.desc.tera', { count: a.tera.shardCost, hours: a.tera.hours, sessions: a.tera.sessions })
    case 'tm':
      return text('bag.desc.tm')
    case 'bottleCap':
      return text('bag.desc.bottleCap', { max: ctx.config.progression.ivMax })
    case 'abilityCapsule':
      return text('bag.desc.abilityCapsule')
    case 'mint': {
      if (slug === CHOICE_MINT) return text('bag.desc.choiceMint')
      const n = ctx.naturesBySlug.get(mintNatureOf(slug, ctx) ?? '')
      const effect =
        n?.increased && n.decreased ? `+${text(`stats.${n.increased}.name`)} −${text(`stats.${n.decreased}.name`)}` : text('bag.desc.mintNeutral')
      return text('bag.desc.mint', { nature: natureName(n?.slug ?? '', lng), effect })
    }
    default:
      return text('bag.desc.other')
  }
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
    case 'training':
      return trainingDescription(slug, ctx, lng, text)
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
    const training = category === 'training' ? trainingKind(slug, ctx) : null
    const unlock = training ? UNLOCK_OF[training] : undefined
    const locked = unlock && !isUnlocked(player, unlock, ctx) ? unlockLevel(unlock, ctx) : undefined
    out.push({
      id: `item:${slug}`,
      kind: 'item',
      category,
      slug,
      name: itemName(slug, lng),
      description: itemDescription(slug, category, ctx, lng, text),
      count,
      users: locked ? [] : itemUsers(player, slug, category, ctx, lng, now),
      ...(training && { usersKey: slug === CHOICE_MINT ? 'choiceMint' : training }),
      ...(locked !== undefined && { lockedLevel: locked }),
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
  const out: Record<BagFilter, number> = { all: found.length, ball: 0, heal: 0, evolution: 0, candy: 0, training: 0, event: 0, other: 0 }
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
