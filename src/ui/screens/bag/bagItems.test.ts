import { beforeAll, describe, expect, it } from 'vitest'
import { defaultContext } from '../../../engine'
import { makeMon, makePlayer, MIN, T0 } from '../../../engine/test-helpers'
import i18n from '../../../i18n'
import { BAG_CATEGORIES, bagCounts, buildBagEntries, categorizeItem, filterBag, normalizeText, searchBag, sortBag, type BagText } from './bagItems'

const ctx = defaultContext()
const text: BagText = (k, p) => String(i18n.t(k, p as never))

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

function bag() {
  const clefairy = makeMon('clefairy', 20, { uid: 'clef' })
  const hurt = makeMon('pikachu', 12, { uid: 'hurt', energy: { current: 3, updatedAt: T0 } })
  const fainted = makeMon('pidgey', 8, { uid: 'out', energy: { current: 0, updatedAt: T0 } })
  const fit = makeMon('zubat', 8, { uid: 'fit' })
  const player = makePlayer([fit], {
    pokemon: { fit, clef: clefairy, hurt, out: fainted },
    inventory: { 'poke-ball': 7, 'great-ball': 2, potion: 3, revive: 1, 'moon-stone': 2, 'tera-shard': 4, 'bottle-cap': 1, 'rare-candy': 5, 'ultra-ball': 0 },
    candies: { chains: { [String(ctx.speciesBySlug.get('pikachu')!.evolutionChainId)]: 6, '99999': 0 }, types: { fire: 3, water: 0 } },
  })
  return buildBagEntries(player, ctx, 'es', text, T0)
}

describe('categorizeItem', () => {
  it('puts known items in their category', () => {
    expect(categorizeItem('poke-ball', ctx)).toBe('ball')
    expect(categorizeItem('master-ball', ctx)).toBe('ball')
    expect(categorizeItem('potion', ctx)).toBe('heal')
    expect(categorizeItem('hyper-potion', ctx)).toBe('heal')
    expect(categorizeItem('revive', ctx)).toBe('heal')
    expect(categorizeItem('moon-stone', ctx)).toBe('evolution')
    expect(categorizeItem('fire-stone', ctx)).toBe('evolution')
    expect(categorizeItem('rare-candy', ctx)).toBe('candy')
  })

  it('sends the advanced items (F4) to training', () => {
    for (const slug of ['tera-shard', 'technical-machine', 'bottle-cap', 'ability-capsule', 'adamant-mint', 'serious-mint', 'choice-mint']) expect(categorizeItem(slug, ctx)).toBe('training')
  })

  it('sends mission-only items to the event category', () => {
    const withEvent = { ...ctx, missions: { ...ctx.missions, placeholderItems: { ...ctx.missions.placeholderItems, 'gold-leaf': { names: { es: 'Hoja', en: 'Leaf' } } } } }
    expect(categorizeItem('gold-leaf', withEvent)).toBe('event')
  })

  it('sends unknown or unused items to other', () => {
    expect(categorizeItem('fake-mint', ctx)).toBe('other')
    expect(categorizeItem('something-new', ctx)).toBe('other')
  })

  it('recognises PokeAPI-style slugs the data does not list yet', () => {
    expect(categorizeItem('dusk-stone', ctx)).toBe('evolution')
    expect(categorizeItem('max-potion', ctx)).toBe('heal')
    expect(categorizeItem('premier-ball', ctx)).toBe('ball')
  })
})

describe('buildBagEntries', () => {
  it('lists items, line candies and type candies, without zero counts', () => {
    const entries = bag()
    const ids = entries.map((e) => e.id)
    expect(ids).toContain('item:poke-ball')
    expect(ids).not.toContain('item:ultra-ball')
    expect(ids.filter((i) => i.startsWith('chain:'))).toHaveLength(1)
    expect(ids).toContain('type:fire')
    expect(ids).not.toContain('type:water')
    const line = entries.find((e) => e.kind === 'chainCandy')!
    expect(line.name).toBe('Caramelos de Pikachu')
    expect(line.slug).toBe('pikachu')
    expect(line.count).toBe(6)
    expect(line.users.map((u) => u.uid)).toEqual(['hurt'])
    expect(entries.find((e) => e.id === 'type:fire')!.name).toBe('Caramelos tipo Fuego')
  })

  it('describes each item and who can use it', () => {
    const entries = bag()
    const by = (slug: string) => entries.find((e) => e.id === `item:${slug}`)!
    expect(by('poke-ball').category).toBe('ball')
    expect(by('potion').description).toContain('Recupera 20 de Energía')
    // A potion is for the hurt ones, a revive for the exhausted one.
    expect(by('potion').users.map((u) => u.uid).sort()).toEqual(['hurt', 'out'])
    expect(by('revive').users.map((u) => u.uid)).toEqual(['out'])
    expect(by('moon-stone').users.map((u) => u.uid)).toEqual(['clef'])
    expect(by('moon-stone').users[0]!.ready).toBe(true)
    // Advanced items: real descriptions, locked below their trainer level (the test player is level 1).
    expect(by('tera-shard').description).toContain('Teracristaliza')
    expect(by('tera-shard').description).toContain('2 Teralitos')
    expect(by('tera-shard').lockedLevel).toBe(20)
    expect(by('tera-shard').users).toEqual([])
    expect(by('bottle-cap').description).toContain('31')
    expect(by('bottle-cap').lockedLevel).toBe(25)
  })

  it('links the advanced items to the Pokémon that can use them once unlocked', () => {
    const pidgey = makeMon('pidgey', 20, { uid: 'pid', ability: 'keen-eye', nature: 'relaxed' })
    const pika = makeMon('pikachu', 20, { uid: 'pika', ability: 'static', ivs: { hp: 31, attack: 31, defense: 31, specialAttack: 31, specialDefense: 31, speed: 31 } })
    const player = makePlayer([pika], {
      trainer: { level: 30, exp: 0 },
      pokemon: { pika, pid: pidgey },
      inventory: { 'tera-shard': 2, 'technical-machine': 1, 'bottle-cap': 1, 'ability-capsule': 1, 'timid-mint': 1, 'modest-mint': 1 },
    })
    const entries = buildBagEntries(player, ctx, 'es', text, T0)
    const by = (slug: string) => entries.find((e) => e.id === `item:${slug}`)!
    expect(by('tera-shard').users.map((u) => u.uid)).toEqual(['pika'])
    expect(by('tera-shard').usersKey).toBe('tera')
    expect(by('tera-shard').lockedLevel).toBeUndefined()
    expect(by('technical-machine').users.map((u) => u.uid).sort()).toEqual(['pid', 'pika'])
    // Pikachu's IVs are maxed: no Bottle Cap user in the team.
    expect(by('bottle-cap').users).toEqual([])
    // Only Pidgey has a second defined ability.
    expect(by('ability-capsule').users.map((u) => u.uid)).toEqual(['pid'])
    // Timid raises Pace: both are Sprinters (Relaxed Pidgey, Hardy Pikachu); Modest suits no one here.
    expect(by('timid-mint').users.map((u) => u.uid)).toEqual(['pid', 'pika'])
    expect(by('timid-mint').description).toContain('Miedosa')
    expect(by('timid-mint').description).toContain('+Ritmo')
    expect(by('modest-mint').users).toEqual([])
  })

  it('the Choice Mint is a training item with its own text, ES and EN, and links to Pokémon whose role a nature could improve', async () => {
    const pidgey = makeMon('pidgey', 20, { uid: 'pid', nature: 'relaxed' }) // Sprinter with a Pace-lowering nature
    const pika = makeMon('pikachu', 20, { uid: 'pika', nature: 'timid' }) // Sprinter already raising Pace
    const player = makePlayer([pika], { trainer: { level: 30, exp: 0 }, pokemon: { pika, pid: pidgey }, inventory: { 'choice-mint': 2 } })
    for (const lng of ['es', 'en'] as const) {
      await i18n.changeLanguage(lng)
      const e = buildBagEntries(player, ctx, lng, (k, p) => String(i18n.t(k, p as never)), T0).find((x) => x.slug === 'choice-mint')!
      expect(e.category).toBe('training')
      expect(e.name).toBe(lng === 'es' ? 'Menta a elegir' : 'Choice Mint')
      expect(e.description).toBe(i18n.t('bag.desc.choiceMint'))
      expect(e.description).not.toMatch(/bag\.|\{\{/)
      expect(e.usersKey).toBe('choiceMint')
      expect(i18n.t(`bag.users.choiceMint`)).not.toBe('bag.users.choiceMint')
      expect(i18n.t(`bag.noUsers.choiceMint`)).not.toBe('bag.noUsers.choiceMint')
      expect(e.users.map((u) => u.uid)).toEqual(['pid'])
      expect(e.lockedLevel).toBeUndefined()
    }
    await i18n.changeLanguage('es')
    const low = makePlayer([pika], { trainer: { level: 5, exp: 0 }, inventory: { 'choice-mint': 1 } })
    expect(buildBagEntries(low, ctx, 'es', text, T0).find((x) => x.slug === 'choice-mint')!.lockedLevel).toBe(10)
  })
})

describe('normalizeText and searchBag', () => {
  it('ignores accents and case', () => {
    expect(normalizeText('  Poción ÁÉÍ ')).toBe('pocion aei')
  })

  it('finds by name without accents, by description and by several words', () => {
    const entries = bag()
    expect(searchBag(entries, 'pocion').map((e) => e.id)).toContain('item:potion')
    expect(searchBag(entries, 'POCIÓN').map((e) => e.id)).toContain('item:potion')
    expect(searchBag(entries, 'piedra lunar').map((e) => e.id)).toEqual(['item:moon-stone'])
    expect(searchBag(entries, 'capturar').map((e) => e.id)).toEqual(expect.arrayContaining(['item:poke-ball', 'item:great-ball']))
    expect(searchBag(entries, 'zzzz')).toEqual([])
    expect(searchBag(entries, '   ')).toHaveLength(entries.length)
  })

  it('searches the current language names', async () => {
    await i18n.changeLanguage('en')
    const entries = buildBagEntries(makePlayer([makeMon('pikachu', 5)], { inventory: { 'moon-stone': 1, potion: 1 } }), ctx, 'en', text, T0)
    expect(searchBag(entries, 'moon').map((e) => e.id)).toEqual(['item:moon-stone'])
    expect(searchBag(entries, 'lunar')).toEqual([])
    await i18n.changeLanguage('es')
  })
})

describe('filterBag, bagCounts and sortBag', () => {
  it('filters by category and combines it with the search', () => {
    const entries = bag()
    expect(filterBag(entries, '', 'ball').map((e) => e.id).sort()).toEqual(['item:great-ball', 'item:poke-ball'])
    expect(filterBag(entries, '', 'all')).toHaveLength(entries.length)
    expect(filterBag(entries, 'pocion', 'heal').map((e) => e.id)).toEqual(['item:potion'])
    expect(filterBag(entries, 'pocion', 'ball')).toEqual([])
    expect(filterBag(entries, '', 'candy').map((e) => e.kind).sort()).toEqual(['chainCandy', 'item', 'typeCandy'])
  })

  it('counts per category after the search', () => {
    const entries = bag()
    const all = bagCounts(entries, '')
    expect(all.all).toBe(entries.length)
    expect(BAG_CATEGORIES.reduce((n, c) => n + all[c], 0)).toBe(all.all)
    expect(all.ball).toBe(2)
    expect(all.heal).toBe(2)
    expect(all.evolution).toBe(1)
    expect(all.training).toBe(2)
    expect(all.event).toBe(0)
    const searched = bagCounts(entries, 'pocion')
    expect(searched.all).toBe(1)
    expect(searched.heal).toBe(1)
    expect(searched.ball).toBe(0)
  })

  it('sorts by category (default), name or quantity without touching the input', () => {
    const entries = bag()
    const before = entries.map((e) => e.id)
    const cat = sortBag(entries, 'category', 'es')
    const order = cat.map((e) => BAG_CATEGORIES.indexOf(e.category))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(cat[0]!.category).toBe('ball')
    const names = sortBag(entries, 'name', 'es').map((e) => e.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })))
    const qty = sortBag(entries, 'quantity', 'es').map((e) => e.count)
    expect(qty).toEqual([...qty].sort((a, b) => b - a))
    expect(entries.map((e) => e.id)).toEqual(before)
  })

  it('hides nothing by accident: an evolution item for a Pokémon that cannot evolve yet is still listed', () => {
    const p = makePlayer([makeMon('clefairy', 20, { uid: 'c' })], { inventory: { 'moon-stone': 1 } })
    const [e] = buildBagEntries(p, ctx, 'es', text, T0 + 5 * MIN)
    expect(e!.users.map((u) => u.uid)).toEqual(['c'])
  })
})
