/**
 * PokeAPI import script.
 *
 * PokeAPI is used ONLY as an import source: this script downloads the data of
 * the active pack and writes clean JSON into `data/generated/`. The app itself
 * never calls PokeAPI.
 *
 *   npm run import:pokeapi              # uses data/cache/ when available
 *   npm run import:pokeapi -- --refresh # ignore the cache and refetch everything
 *
 * Raw API responses are cached in `data/cache/` (gitignored), so reruns do not
 * hit the network. Concurrency is limited to MAX_CONCURRENCY requests.
 *
 * Never edit `data/generated/` by hand; use `data/overrides/` instead.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  Ability,
  DamageClass,
  Evolution,
  Item,
  Learnset,
  LevelUpMove,
  LocalizedText,
  Move,
  Nature,
  NatureStatKey,
  PartialLocalizedText,
  Species,
  StatKey,
  TimeOfDay,
  TypeChart,
  TypeInfo,
  TypeMultiplier,
  TypeSlug,
  TypesFile,
} from '../src/engine/data-types.ts'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** National dex ids of the Pack 1 species (default forms only). */
const PACK_1_IDS: number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 18, 25, 26, 27, 28, 35, 36, 41, 42, 169, 63, 64,
  65, 66, 67, 68, 74, 75, 76, 81, 82, 92, 93, 94, 133, 134, 135, 136, 196, 197, 147, 148, 149, 228,
  229, 220, 221, 144, 145, 146, 150, 151,
]

const PREFERRED_VERSION_GROUP = 'ultra-sun-ultra-moon'

const API = 'https://pokeapi.co/api/v2'
const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites'
const MAX_CONCURRENCY = 5

const EXCLUDED_TYPES = new Set(['stellar', 'unknown', 'shadow'])

const ITEM_SLUGS = [
  'poke-ball',
  'great-ball',
  'ultra-ball',
  'master-ball',
  'potion',
  'super-potion',
  'hyper-potion',
  'revive',
  'fire-stone',
  'water-stone',
  'thunder-stone',
  'leaf-stone',
  'moon-stone',
  'rare-candy',
  'bottle-cap',
  'ability-capsule',
  'tm-normal',
]

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = path.join(ROOT, 'data', 'cache')
const OUT_DIR = path.join(ROOT, 'data', 'generated')
const REFRESH = process.argv.includes('--refresh')

// ---------------------------------------------------------------------------
// Minimal PokeAPI response typings (only the fields this script reads)
// ---------------------------------------------------------------------------

interface NamedRef {
  name: string
  url: string
}
interface ApiList {
  results: NamedRef[]
}
interface ApiName {
  name: string
  language: { name: string }
}
interface ApiVersionGroup {
  id: number
  name: string
  generation: NamedRef
  versions: NamedRef[]
}
interface ApiPokemon {
  id: number
  name: string
  types: { slot: number; type: { name: string } }[]
  stats: { base_stat: number; stat: { name: string } }[]
  abilities: { is_hidden: boolean; slot: number; ability: { name: string } }[]
  moves: {
    move: { name: string }
    version_group_details: {
      level_learned_at: number
      move_learn_method: { name: string }
      version_group: { name: string }
      order?: number | null
    }[]
  }[]
}
interface ApiSpecies {
  id: number
  name: string
  capture_rate: number
  is_legendary: boolean
  is_mythical: boolean
  evolution_chain: { url: string }
  names: ApiName[]
  genera: { genus: string; language: { name: string } }[]
  flavor_text_entries: { flavor_text: string; language: { name: string }; version: { name: string } }[]
}
interface ApiEvolutionDetail {
  is_default?: boolean
  item: { name: string } | null
  trigger: { name: string }
  min_level: number | null
  min_happiness: number | null
  time_of_day: string
  evolved_pokemon_form?: unknown
  [key: string]: unknown
}
interface ApiChainNode {
  species: { name: string; url: string }
  evolution_details: ApiEvolutionDetail[]
  evolves_to: ApiChainNode[]
}
interface ApiEvolutionChain {
  id: number
  chain: ApiChainNode
}
interface ApiMove {
  id: number
  name: string
  accuracy: number | null
  power: number | null
  effect_chance: number | null
  damage_class: { name: string }
  type: { name: string }
  names: ApiName[]
  effect_entries: { short_effect: string; language: { name: string } }[]
  flavor_text_entries: { flavor_text: string; language: { name: string }; version_group: { name: string } }[]
}
interface ApiAbility {
  id: number
  name: string
  names: ApiName[]
  effect_entries: { short_effect: string; language: { name: string } }[]
  flavor_text_entries: { flavor_text: string; language: { name: string }; version_group: { name: string } }[]
}
interface ApiType {
  id: number
  name: string
  names: ApiName[]
  damage_relations: {
    double_damage_to: NamedRef[]
    half_damage_to: NamedRef[]
    no_damage_to: NamedRef[]
  }
}
interface ApiNature {
  id: number
  name: string
  names: ApiName[]
  increased_stat: NamedRef | null
  decreased_stat: NamedRef | null
}
interface ApiItem {
  id: number
  name: string
  names: ApiName[]
}

// ---------------------------------------------------------------------------
// Logging / warnings
// ---------------------------------------------------------------------------

const warnings: string[] = []
function warn(message: string): void {
  warnings.push(message)
}

// ---------------------------------------------------------------------------
// HTTP with cache, concurrency limit and retries
// ---------------------------------------------------------------------------

function createLimiter(max: number) {
  let active = 0
  const queue: (() => void)[] = []
  const next = () => {
    if (active >= max) return
    const run = queue.shift()
    if (run) {
      active++
      run()
    }
  }
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      })
      next()
    })
  }
}

const limit = createLimiter(MAX_CONCURRENCY)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await limit(() => fetch(url, { ...init, headers: { 'User-Agent': 'PokeFocus-importer' } }))
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      return res
    } catch (err) {
      lastError = err
      await sleep(500 * 2 ** attempt)
    }
  }
  throw new Error(`Failed to fetch ${url}: ${String(lastError)}`)
}

const inFlight = new Map<string, Promise<unknown>>()

/** GET `${API}/${route}` as JSON, cached in data/cache. Returns null on 404 when `optional`. */
function api<T>(route: string, optional: true): Promise<T | null>
function api<T>(route: string, optional?: false): Promise<T>
function api<T>(route: string, optional = false): Promise<T | null> {
  const existing = inFlight.get(route)
  if (existing) return existing as Promise<T | null>
  const promise = (async () => {
    const cacheFile = path.join(CACHE_DIR, `${route.replace(/[?&=]/g, '_')}.json`)
    if (!REFRESH) {
      try {
        return JSON.parse(await readFile(cacheFile, 'utf8')) as T
      } catch {
        // not cached (or unreadable): fetch it
      }
    }
    const res = await fetchWithRetry(`${API}/${route}`)
    if (res.status === 404 && optional) return null
    if (!res.ok) throw new Error(`GET ${API}/${route} -> HTTP ${res.status}`)
    const text = await res.text()
    await mkdir(path.dirname(cacheFile), { recursive: true })
    await writeFile(cacheFile, text)
    return JSON.parse(text) as T
  })()
  inFlight.set(route, promise)
  return promise
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Collapse line breaks, form feeds, soft hyphens and repeated spaces. */
function normalizeText(text: string): string {
  return text
    .replace(/­\s*/g, '') // soft hyphen (used for hyphenated line breaks)
    .replace(/[\f\n\r\t\v]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Localized name; falls back to English (with a warning) if Spanish is missing. */
function localizedNames(names: ApiName[], what: string): LocalizedText {
  const find = (lang: string) => names.find((n) => n.language.name === lang)?.name
  const en = find('en')
  if (!en) throw new Error(`${what}: missing English name`)
  let es = find('es')
  if (!es) {
    warn(`${what}: no Spanish name, using English`)
    es = en
  }
  return { es, en }
}

/** Versions/version groups ranked chronologically (higher = newer). */
type Rank = Map<string, number>

/** Newest flavor text for a language. */
function pickFlavor<E extends { flavor_text: string; language: { name: string } }>(
  entries: E[],
  lang: string,
  keyOf: (entry: E) => string,
  rank: Rank,
): string | undefined {
  let best: E | undefined
  let bestRank = -Infinity
  for (const entry of entries) {
    if (entry.language.name !== lang) continue
    const r = rank.get(keyOf(entry)) ?? -1
    if (r >= bestRank) {
      best = entry
      bestRank = r
    }
  }
  return best ? normalizeText(best.flavor_text) : undefined
}

function partialFlavor<E extends { flavor_text: string; language: { name: string } }>(
  entries: E[],
  keyOf: (entry: E) => string,
  rank: Rank,
): PartialLocalizedText {
  const out: PartialLocalizedText = {}
  const es = pickFlavor(entries, 'es', keyOf, rank)
  const en = pickFlavor(entries, 'en', keyOf, rank)
  if (es) out.es = es
  if (en) out.en = en
  return out
}

function idFromUrl(url: string): number {
  const match = /\/(\d+)\/?$/.exec(url)
  if (!match) throw new Error(`Cannot extract id from ${url}`)
  return Number(match[1])
}

const camel = (stat: string): StatKey =>
  stat.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as StatKey

// ---------------------------------------------------------------------------
// Version ordering
// ---------------------------------------------------------------------------

async function loadVersionRanks(): Promise<{ versionRank: Rank; groupRank: Rank }> {
  const list = await api<ApiList>('version-group?limit=200')
  const groups = await Promise.all(list.results.map((g) => api<ApiVersionGroup>(`version-group/${idFromUrl(g.url)}`)))
  const versionRank: Rank = new Map()
  const groupRank: Rank = new Map()
  for (const group of groups) {
    // generation first (so Colosseum/XD sort with gen 3), then version group id, then version id
    const base = idFromUrl(group.generation.url) * 1_000_000 + group.id * 1_000
    groupRank.set(group.name, base)
    for (const version of group.versions) versionRank.set(version.name, base + idFromUrl(version.url))
  }
  return { versionRank, groupRank }
}

// ---------------------------------------------------------------------------
// Evolutions
// ---------------------------------------------------------------------------

interface ChainEntry {
  parent: number | null
  details: ApiEvolutionDetail[]
}

function flattenChain(node: ApiChainNode, parent: number | null, out: Map<number, ChainEntry>): void {
  const id = idFromUrl(node.species.url)
  out.set(id, { parent, details: node.evolution_details })
  for (const child of node.evolves_to) flattenChain(child, id, out)
}

/** Conditions that make an evolution "other" because they cannot be expressed by our trigger kinds. */
const COMPLEX_CONDITIONS = [
  'gender',
  'held_item',
  'known_move',
  'known_move_type',
  'location',
  'min_affection',
  'min_beauty',
  'min_damage_taken',
  'min_move_count',
  'min_steps',
  'near_special_rock',
  'needs_multiplayer',
  'needs_overworld_rain',
  'party_species',
  'party_type',
  'region',
  'relative_physical_stats',
  'trade_species',
  'turn_upside_down',
  'used_move',
  'allowed_natures',
  'condition_expression',
]

function hasComplexCondition(detail: ApiEvolutionDetail): boolean {
  return COMPLEX_CONDITIONS.some((key) => {
    const value = detail[key]
    return value !== null && value !== undefined && value !== false && value !== ''
  })
}

function mapEvolution(to: number, allDetails: ApiEvolutionDetail[], fromSlug: string): Evolution {
  // Default forms only: ignore regional-form evolutions (Alolan Raichu/Sandslash...).
  const details = allDetails.filter((d) => !d.evolved_pokemon_form)
  const detail = details.find((d) => d.is_default) ?? details[details.length - 1]
  if (!detail) {
    warn(`evolution ${fromSlug} -> #${to}: no usable evolution details`)
    return { to, trigger: 'other' }
  }
  const timeOfDay = detail.time_of_day
  if (timeOfDay && !['day', 'night', 'dusk'].includes(timeOfDay)) {
    warn(`evolution ${fromSlug} -> #${to}: unknown time_of_day "${timeOfDay}"`)
  }
  const time = timeOfDay ? { timeOfDay: timeOfDay as TimeOfDay } : {}
  const complex = hasComplexCondition(detail)
  switch (detail.trigger.name) {
    case 'use-item':
      if (detail.item && !complex) return { to, trigger: 'item', item: detail.item.name, ...time }
      break
    case 'trade':
      if (!complex) return { to, trigger: 'trade' }
      break
    case 'level-up':
      if (complex) break
      if (detail.min_happiness !== null) {
        return { to, trigger: 'friendship', minHappiness: detail.min_happiness, ...time }
      }
      if (detail.min_level !== null) return { to, trigger: 'level', minLevel: detail.min_level, ...time }
      break
  }
  warn(`evolution ${fromSlug} -> #${to}: classified as "other" (${detail.trigger.name})`)
  return { to, trigger: 'other', ...time }
}

// ---------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------

function parseLearnset(pokemon: ApiPokemon, versionGroup: string): Learnset {
  const levelUp: (LevelUpMove & { order: number })[] = []
  const egg = new Set<string>()
  const tutor = new Set<string>()
  const machine = new Set<string>()
  for (const entry of pokemon.moves) {
    for (const d of entry.version_group_details) {
      if (d.version_group.name !== versionGroup) continue
      const move = entry.move.name
      switch (d.move_learn_method.name) {
        case 'level-up':
          levelUp.push({ move, level: d.level_learned_at, order: d.order ?? 0 })
          break
        case 'egg':
          egg.add(move)
          break
        case 'tutor':
          tutor.add(move)
          break
        case 'machine':
          machine.add(move)
          break
      }
    }
  }
  levelUp.sort((a, b) => a.level - b.level || a.order - b.order || a.move.localeCompare(b.move))
  const seen = new Set<string>()
  const unique: LevelUpMove[] = []
  for (const { move, level } of levelUp) {
    const key = `${level}:${move}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({ move, level })
  }
  const sorted = (set: Set<string>) => [...set].sort()
  return { levelUp: unique, egg: sorted(egg), tutor: sorted(tutor), machine: sorted(machine) }
}

function pickLearnsetVersionGroup(pokemon: ApiPokemon, groupRank: Rank): string | null {
  const groups = new Set<string>()
  for (const entry of pokemon.moves) {
    for (const d of entry.version_group_details) groups.add(d.version_group.name)
  }
  if (groups.has(PREFERRED_VERSION_GROUP)) return PREFERRED_VERSION_GROUP
  let best: string | null = null
  for (const g of groups) {
    if (best === null || (groupRank.get(g) ?? -1) > (groupRank.get(best) ?? -1)) best = g
  }
  return best
}

function speciesSprites(id: number) {
  return {
    icon: `${SPRITES}/pokemon/versions/generation-vii/icons/${id}.png`,
    showdown: `${SPRITES}/pokemon/other/showdown/${id}.gif`,
    showdownShiny: `${SPRITES}/pokemon/other/showdown/shiny/${id}.gif`,
    artwork: `${SPRITES}/pokemon/other/official-artwork/${id}.png`,
  }
}

async function buildSpecies(
  packIds: number[],
  versionRank: Rank,
  groupRank: Rank,
): Promise<Species[]> {
  const inPack = new Set(packIds)
  const raw = await Promise.all(
    packIds.map(async (id) => {
      const [pokemon, species] = await Promise.all([
        api<ApiPokemon>(`pokemon/${id}`),
        api<ApiSpecies>(`pokemon-species/${id}`),
      ])
      return { pokemon, species }
    }),
  )

  const chainIds = [...new Set(raw.map((r) => idFromUrl(r.species.evolution_chain.url)))]
  const chains = new Map<number, Map<number, ChainEntry>>()
  await Promise.all(
    chainIds.map(async (cid) => {
      const chain = await api<ApiEvolutionChain>(`evolution-chain/${cid}`)
      const flat = new Map<number, ChainEntry>()
      flattenChain(chain.chain, null, flat)
      chains.set(cid, flat)
    }),
  )

  const evolvesFromOf = new Map<number, number | null>()
  for (const { species } of raw) {
    const entry = chains.get(idFromUrl(species.evolution_chain.url))?.get(species.id)
    const parent = entry?.parent ?? null
    evolvesFromOf.set(species.id, parent !== null && inPack.has(parent) ? parent : null)
  }

  return raw
    .map(({ pokemon, species }): Species => {
      const id = species.id
      const slug = species.name
      const chainId = idFromUrl(species.evolution_chain.url)
      const chain = chains.get(chainId)!

      const baseStats = {} as Species['baseStats']
      for (const s of pokemon.stats) baseStats[camel(s.stat.name)] = s.base_stat

      let stage = 1
      for (let p = evolvesFromOf.get(id) ?? null; p !== null; p = evolvesFromOf.get(p) ?? null) stage++
      if (stage > 3) throw new Error(`${slug}: stage ${stage} out of range`)

      const evolutions = [...chain.entries()]
        .filter(([childId, entry]) => entry.parent === id && inPack.has(childId))
        .sort(([a], [b]) => a - b)
        .map(([childId, entry]) => mapEvolution(childId, entry.details, slug))

      const learnsetVersionGroup = pickLearnsetVersionGroup(pokemon, groupRank)
      if (!learnsetVersionGroup) throw new Error(`${slug}: no learnset data in any version group`)

      const flavorEn = pickFlavor(species.flavor_text_entries, 'en', (e) => e.version.name, versionRank)
      let flavorEs = pickFlavor(species.flavor_text_entries, 'es', (e) => e.version.name, versionRank)
      if (!flavorEn) throw new Error(`${slug}: no English flavor text`)
      if (!flavorEs) {
        warn(`species ${slug}: no Spanish flavor text, using English`)
        flavorEs = flavorEn
      }
      const genus = (lang: string) => species.genera.find((g) => g.language.name === lang)?.genus
      const genusEn = genus('en')
      if (!genusEn) throw new Error(`${slug}: no English genus`)
      const genusEs = genus('es') ?? (warn(`species ${slug}: no Spanish genus, using English`), genusEn)

      return {
        id,
        slug,
        names: localizedNames(species.names, `species ${slug}`),
        genus: { es: genusEs, en: genusEn },
        flavorText: { es: flavorEs, en: flavorEn },
        types: [...pokemon.types].sort((a, b) => a.slot - b.slot).map((t) => t.type.name as TypeSlug),
        baseStats,
        captureRate: species.capture_rate,
        isLegendary: species.is_legendary,
        isMythical: species.is_mythical,
        evolutionChainId: chainId,
        stage: stage as 1 | 2 | 3,
        evolvesFrom: evolvesFromOf.get(id) ?? null,
        evolutions,
        abilities: [...pokemon.abilities]
          .sort((a, b) => a.slot - b.slot)
          .map((a) => ({ slug: a.ability.name, isHidden: a.is_hidden })),
        learnset: parseLearnset(pokemon, learnsetVersionGroup),
        learnsetVersionGroup,
        sprites: speciesSprites(id),
      }
    })
    .sort((a, b) => a.id - b.id)
}

// ---------------------------------------------------------------------------
// Moves / abilities
// ---------------------------------------------------------------------------

function shortEffect(entries: { short_effect: string; language: { name: string } }[], chance: number | null, what: string) {
  const en = entries.find((e) => e.language.name === 'en')?.short_effect
  if (!en) {
    warn(`${what}: no English short effect`)
    return { en: '' }
  }
  const text = normalizeText(en).replace(/\$effect_chance/g, chance === null ? '' : String(chance))
  return { en: text }
}

async function buildMoves(slugs: string[], groupRank: Rank): Promise<Move[]> {
  const moves = await Promise.all(slugs.map((slug) => api<ApiMove>(`move/${slug}`)))
  return moves
    .map((m): Move => {
      const damageClass = m.damage_class.name as DamageClass
      return {
        slug: m.name,
        id: m.id,
        names: localizedNames(m.names, `move ${m.name}`),
        type: m.type.name as TypeSlug,
        power: m.power,
        damageClass,
        accuracy: m.accuracy,
        shortEffect: shortEffect(m.effect_entries, m.effect_chance, `move ${m.name}`),
        flavorText: partialFlavor(m.flavor_text_entries, (e) => e.version_group.name, groupRank),
      }
    })
    .sort((a, b) => a.id - b.id)
}

async function buildAbilities(slugs: string[], groupRank: Rank): Promise<Ability[]> {
  const abilities = await Promise.all(slugs.map((slug) => api<ApiAbility>(`ability/${slug}`)))
  return abilities
    .map(
      (a): Ability => ({
        slug: a.name,
        id: a.id,
        names: localizedNames(a.names, `ability ${a.name}`),
        shortEffect: shortEffect(a.effect_entries, null, `ability ${a.name}`),
        flavorText: partialFlavor(a.flavor_text_entries, (e) => e.version_group.name, groupRank),
      }),
    )
    .sort((a, b) => a.id - b.id)
}

// ---------------------------------------------------------------------------
// Types / natures / items
// ---------------------------------------------------------------------------

async function buildTypes(): Promise<TypesFile> {
  const list = await api<ApiList>('type?limit=100')
  const refs = list.results.filter((t) => !EXCLUDED_TYPES.has(t.name))
  const apiTypes = (await Promise.all(refs.map((t) => api<ApiType>(`type/${t.name}`)))).sort((a, b) => a.id - b.id)
  if (apiTypes.length !== 18) throw new Error(`Expected 18 types, got ${apiTypes.length}`)

  const slugs = apiTypes.map((t) => t.name as TypeSlug)
  const chart = {} as TypeChart
  for (const attacker of apiTypes) {
    const row = {} as Record<TypeSlug, TypeMultiplier>
    const rel = attacker.damage_relations
    const has = (refs: NamedRef[], slug: string) => refs.some((r) => r.name === slug)
    for (const defender of slugs) {
      row[defender] = has(rel.no_damage_to, defender)
        ? 0
        : has(rel.double_damage_to, defender)
          ? 2
          : has(rel.half_damage_to, defender)
            ? 0.5
            : 1
    }
    chart[attacker.name as TypeSlug] = row
  }
  const types: TypeInfo[] = apiTypes.map((t) => ({
    id: t.id,
    slug: t.name as TypeSlug,
    names: localizedNames(t.names, `type ${t.name}`),
  }))
  return { types, chart }
}

async function buildNatures(): Promise<Nature[]> {
  const list = await api<ApiList>('nature?limit=100')
  const natures = await Promise.all(list.results.map((n) => api<ApiNature>(`nature/${n.name}`)))
  if (natures.length !== 25) warn(`expected 25 natures, got ${natures.length}`)
  return natures
    .map(
      (n): Nature => ({
        id: n.id,
        slug: n.name,
        names: localizedNames(n.names, `nature ${n.name}`),
        increased: n.increased_stat ? (camel(n.increased_stat.name) as NatureStatKey) : null,
        decreased: n.decreased_stat ? (camel(n.decreased_stat.name) as NatureStatKey) : null,
      }),
    )
    .sort((a, b) => a.id - b.id)
}

async function buildItems(): Promise<Item[]> {
  const list = await api<ApiList>('item?limit=3000')
  const mints = list.results.map((i) => i.name).filter((name) => /-mint$/.test(name))
  const slugs = [...new Set([...ITEM_SLUGS, ...mints])]
  const items: Item[] = []
  await Promise.all(
    slugs.map(async (slug) => {
      const item = await api<ApiItem>(`item/${slug}`, true)
      if (!item) {
        warn(`item ${slug}: not found in PokeAPI, skipped`)
        return
      }
      items.push({
        id: item.id,
        slug: item.name,
        names: localizedNames(item.names, `item ${slug}`),
        sprite: `${SPRITES}/items/${item.name}.png`,
      })
    }),
  )
  return items.sort((a, b) => a.id - b.id)
}

// ---------------------------------------------------------------------------
// Sprite verification (HEAD requests)
// ---------------------------------------------------------------------------

async function verifySprites(urls: string[]): Promise<string[]> {
  const cacheFile = path.join(CACHE_DIR, '_sprite-status.json')
  let status: Record<string, number> = {}
  if (!REFRESH) {
    try {
      status = JSON.parse(await readFile(cacheFile, 'utf8')) as Record<string, number>
    } catch {
      // no cache yet
    }
  }
  await Promise.all(
    [...new Set(urls)].map(async (url) => {
      if (status[url] === 200 || status[url] === 404) return
      const res = await fetchWithRetry(url, { method: 'HEAD' })
      status[url] = res.status
    }),
  )
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(cacheFile, JSON.stringify(status, null, 2) + '\n')
  return [...new Set(urls)].filter((u) => status[u] !== 200).sort()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function writeJson(name: string, data: unknown): Promise<void> {
  await writeFile(path.join(OUT_DIR, name), JSON.stringify(data, null, 2) + '\n')
}

async function main(): Promise<void> {
  const started = Date.now()
  await mkdir(CACHE_DIR, { recursive: true })
  await mkdir(OUT_DIR, { recursive: true })

  console.log(`Importing ${PACK_1_IDS.length} species from PokeAPI (concurrency ${MAX_CONCURRENCY}${REFRESH ? ', refresh' : ''})...`)
  const duplicate = PACK_1_IDS.filter((id, i) => PACK_1_IDS.indexOf(id) !== i)
  if (duplicate.length) throw new Error(`Duplicate ids in pack: ${duplicate.join(', ')}`)

  const { versionRank, groupRank } = await loadVersionRanks()

  console.log('- species, evolution chains')
  const species = await buildSpecies(PACK_1_IDS, versionRank, groupRank)

  const moveSlugs = [...new Set(species.flatMap((s) => [...s.learnset.levelUp.map((m) => m.move), ...s.learnset.egg, ...s.learnset.tutor, ...s.learnset.machine]))].sort()
  const abilitySlugs = [...new Set(species.flatMap((s) => s.abilities.map((a) => a.slug)))].sort()

  console.log(`- ${moveSlugs.length} moves, ${abilitySlugs.length} abilities`)
  const [moves, abilities] = await Promise.all([buildMoves(moveSlugs, groupRank), buildAbilities(abilitySlugs, groupRank)])

  console.log('- types, natures, items')
  const [types, natures, items] = await Promise.all([buildTypes(), buildNatures(), buildItems()])

  console.log('- verifying sprite URLs (HEAD)')
  const missingSprites = await verifySprites([
    ...species.flatMap((s) => Object.values(s.sprites)),
    ...items.map((i) => i.sprite),
  ])

  await Promise.all([
    writeJson('species.json', species),
    writeJson('moves.json', moves),
    writeJson('abilities.json', abilities),
    writeJson('types.json', types),
    writeJson('natures.json', natures),
    writeJson('items.json', items),
  ])

  // ---- summary ------------------------------------------------------------
  const fallback = species.filter((s) => s.learnsetVersionGroup !== PREFERRED_VERSION_GROUP)
  console.log('\n=== Import summary ===')
  console.log(`species:   ${species.length}`)
  console.log(`moves:     ${moves.length}`)
  console.log(`abilities: ${abilities.length}`)
  console.log(`types:     ${types.types.length}`)
  console.log(`natures:   ${natures.length}`)
  console.log(`items:     ${items.length}`)
  console.log(
    `learnset fallbacks (not ${PREFERRED_VERSION_GROUP}): ${
      fallback.length ? fallback.map((s) => `${s.slug} -> ${s.learnsetVersionGroup}`).join(', ') : 'none'
    }`,
  )
  console.log(`missing sprites (non-200 on HEAD): ${missingSprites.length || 'none'}`)
  for (const url of missingSprites) console.log(`  - ${url}`)
  console.log(`warnings: ${warnings.length || 'none'}`)
  for (const w of warnings.sort()) console.log(`  - ${w}`)
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
