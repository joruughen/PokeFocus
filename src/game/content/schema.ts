/**
 * zod schemas of the live content (docs/admin-plan.md §2): `ContentPatch` and
 * `EventOverlay`, strict (unknown keys are errors), with the ranges of limits.ts.
 * Shape only: references (species, items…) and cross-field rules are checked
 * in validate.ts against the resolved context.
 *
 * Shared with the admin client chunk: only zod and engine leaf modules.
 */
import { z } from 'zod'
import type { ContentPatch, EventOverlay } from '../../engine/content'
import type { AbilityDef, Effect, EffectKind, TechniqueDef } from '../../engine/effect-types'
import { richPlainText, RICH_RAW_FACTOR } from '../richText'
import { MISSION_KINDS } from '../../engine/mission-kinds'
import type { MissionDef, PokedexMilestoneDef } from '../../engine/missions'
import type { TypeSlug } from '../../engine/data-types'
import {
  CONFIG_LIMITS,
  CONFIG_LIST_LIMITS,
  CONFIG_TABLE_LIMITS,
  DATA_LIMITS as D,
  type NumberBounds,
} from './limits'

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const slugSchema = z.string().min(1).max(64).regex(SLUG_RE)

export const TYPE_SLUGS = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const satisfies readonly TypeSlug[]

export const typeSlugSchema = z.enum(TYPE_SLUGS)

export function numberSchema(bounds: NumberBounds): z.ZodNumber {
  const n = z.number().min(bounds.min).max(bounds.max)
  return bounds.kind === 'int' ? n.int() : n
}

const nonBlank = /\S/

/** `{ es, en }`, both 1–`max` characters and not blank. */
export function localizedTextSchema(max: number) {
  const s = z.string().min(1).max(max).regex(nonBlank)
  return z.strictObject({ es: s, en: s })
}

export const shortTextSchema = localizedTextSchema(D.shortText)
export const longTextSchema = localizedTextSchema(D.longText)

/**
 * `{ es, en }` in the rich mini-format (src/game/richText.ts): the limit counts the VISIBLE characters, and
 * what is stored may be up to `RICH_RAW_FACTOR` times that. Used for the description of an event.
 */
export function richTextSchema(max: number) {
  const s = z
    .string()
    .min(1)
    .max(max * RICH_RAW_FACTOR)
    .superRefine((v, ctx) => {
      const plain = richPlainText(v)
      if (plain.length > max) ctx.addIssue({ code: 'custom', message: `visible text longer than ${max}` })
      if (!nonBlank.test(plain)) ctx.addIssue({ code: 'custom', message: 'blank' })
    })
  return z.strictObject({ es: s, en: s })
}
export const richLongTextSchema = richTextSchema(D.longText)

// ---------------------------------------------------------------------------
// Config (whitelist from limits.ts)
// ---------------------------------------------------------------------------

interface Tree {
  leaf?: z.ZodType
  children: Map<string, Tree>
}

function insert(root: Tree, path: string, leaf: z.ZodType): void {
  let node = root
  for (const key of path.split('.')) {
    let next = node.children.get(key)
    if (!next) node.children.set(key, (next = { children: new Map() }))
    node = next
  }
  node.leaf = leaf
}

function toSchema(node: Tree): z.ZodType {
  if (node.leaf) return node.leaf
  const shape: Record<string, z.ZodType> = {}
  for (const [k, child] of node.children) shape[k] = toSchema(child).optional()
  return z.strictObject(shape)
}

function buildConfigSchema(): z.ZodType {
  const root: Tree = { children: new Map() }
  for (const l of CONFIG_LIMITS) insert(root, l.path, numberSchema(l))
  for (const l of CONFIG_LIST_LIMITS) insert(root, l.path, z.array(numberSchema(l.item)).min(l.minItems).max(l.maxItems))
  for (const l of CONFIG_TABLE_LIMITS) {
    const row: Record<string, z.ZodNumber> = {}
    for (const [col, bounds] of Object.entries(l.columns)) row[col] = numberSchema(bounds)
    insert(root, l.path, z.array(z.strictObject(row)).min(l.minItems).max(l.maxItems))
  }
  return toSchema(root)
}

/** `ContentPatch.config`: only the whitelisted paths, strict at every level. */
export const configPatchSchema = buildConfigSchema()

// ---------------------------------------------------------------------------
// Effects (docs/effects.md), techniques and abilities
// ---------------------------------------------------------------------------

const wildStatusSchema = z.enum(['sleep', 'paralysis'])
const focusLabelSchema = z.enum(['studying', 'educational', 'chat', 'social', 'game', 'unknown'])
const modStatSchema = z.enum(['points', 'pace', 'captureEnergy', 'techChance', 'energyCost', 'exp', 'bondGain', 'counterDamageTaken'])
const scopeSchema = z.enum(['self', 'team'])
const prob = z.number().min(0).max(1)

export const whenSchema = z.strictObject({
  sessionMinMinutes: z.number().int().min(1).max(600).optional(),
  energyBelow: z.number().gt(0).max(1).optional(),
  energyFull: z.boolean().optional(),
  timeWindow: z.enum(['daylight', 'notDaylight', 'night', 'notNight', 'earlyMorning']).optional(),
  weather: z.enum(['rain', 'sun', 'cold']).optional(),
  weekend: z.boolean().optional(),
  noPauses: z.boolean().optional(),
  isLeader: z.boolean().optional(),
  targetLegendary: z.boolean().optional(),
})

function effect<K extends EffectKind, S extends z.ZodRawShape>(kind: K, shape: S) {
  return z.strictObject({ kind: z.literal(kind), when: whenSchema.optional(), ...shape })
}

/** One schema per `EFFECT_KINDS` entry, with ranges. */
export const effectSchemas = {
  statMod: effect('statMod', { stat: modStatSchema, mult: z.number().min(0).max(5), scope: scopeSchema.optional() }),
  heal: effect('heal', {
    pct: z.number().gt(0).max(1),
    target: z.enum(['self', 'team', 'lowestAlly']),
    timing: z.enum(['now', 'sessionEnd', 'nextSessionStart']).optional(),
  }),
  healOverTime: effect('healOverTime', { pctPerAction: z.number().gt(0).max(0.5) }),
  restFullHeal: effect('restFullHeal', {}),
  wildStatus: effect('wildStatus', { status: wildStatusSchema }),
  statusOnAction: effect('statusOnAction', { status: wildStatusSchema, chance: prob, limit: z.number().int().min(1).max(10) }),
  extraWild: effect('extraWild', { count: z.number().int().min(1).max(3) }),
  rerollWild: effect('rerollWild', {}),
  activateCondition: effect('activateCondition', { type: typeSlugSchema }),
  pointsBurst: effect('pointsBurst', { actions: z.number().int().min(1).max(20), mult: z.number().min(1).max(5) }),
  lastActionMult: effect('lastActionMult', { mult: z.number().min(1).max(10) }),
  conditionBonusMult: effect('conditionBonusMult', { mult: z.number().min(1).max(5) }),
  streakProtect: effect('streakProtect', {}),
  lateClaimImmune: effect('lateClaimImmune', {}),
  focusFloor: effect('focusFloor', { min: prob }),
  focusLabelFloor: effect('focusLabelFloor', { labels: z.array(focusLabelSchema).min(1).max(6), value: prob }),
  effectivenessFloor: effect('effectivenessFloor', { from: z.number().min(0).max(4), to: z.number().min(0).max(4) }),
  encounterWeight: effect('encounterWeight', {
    match: z.union([z.strictObject({ type: typeSlugSchema }), z.strictObject({ natureOfSelf: z.literal(true) })]),
    mult: z.number().min(0).max(5),
  }),
  ballMult: effect('ballMult', { mult: z.number().min(0.5).max(3) }),
  maxFailedThrows: effect('maxFailedThrows', { add: z.number().int().min(1).max(5) }),
  revealWildIvs: effect('revealWildIvs', {}),
  counterImmuneType: effect('counterImmuneType', { type: typeSlugSchema }),
  counterMinHp1: effect('counterMinHp1', {}),
  counterMiss: effect('counterMiss', { chance: z.number().min(0).max(0.9), scope: scopeSchema.optional() }),
  counterReflect: effect('counterReflect', { wildHpPct: prob }),
  counterStatus: effect('counterStatus', { status: wildStatusSchema, chance: prob }),
  counterNoFirst: effect('counterNoFirst', {}),
  nextThrowBonus: effect('nextThrowBonus', { mult: z.number().min(1).max(3) }),
  noSleepFromRest: effect('noSleepFromRest', {}),
} satisfies { [K in EffectKind]: z.ZodType }

const effectList = Object.values(effectSchemas) as unknown as [
  (typeof effectSchemas)[EffectKind],
  ...(typeof effectSchemas)[EffectKind][],
]

export const effectSchema = z.discriminatedUnion('kind', effectList)

export const techniqueSchema = z
  .strictObject({
    category: z.enum(['passive', 'activable']),
    baseChance: z.number().gt(0).max(1).optional(),
    limitPerSession: numberSchema(D.techniqueLimit).optional(),
    limitPerWeek: numberSchema(D.techniqueLimit).optional(),
    effects: z.array(effectSchema).min(1).max(D.effectsMax),
    description: longTextSchema,
  })
  .refine((t) => t.category !== 'activable' || t.baseChance !== undefined, {
    message: 'activable technique needs baseChance',
    path: ['baseChance'],
  })

export const abilitySchema = z.strictObject({
  effects: z.array(effectSchema).min(1).max(D.effectsMax),
  description: longTextSchema,
})

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export const missionRewardSchema = z.strictObject({
  minTrainerLevel: numberSchema(D.minTrainerLevel).optional(),
  items: z.record(slugSchema, numberSchema(D.rewardItemCount)).optional(),
  dust: numberSchema(D.rewardDust).optional(),
  typeCandies: numberSchema(D.rewardTypeCandies).optional(),
  randomItem: z.strictObject({ pool: z.array(slugSchema).min(1).max(20), count: numberSchema(D.rewardRandomCount) }).optional(),
})

const missionFields = {
  id: slugSchema,
  kind: z.enum(MISSION_KINDS as [MissionDef['kind'], ...MissionDef['kind'][]]),
  target: numberSchema(D.missionTarget),
  minMinutes: numberSchema(D.missionMinMinutes).optional(),
  type: z.union([typeSlugSchema, z.literal('random')]).optional(),
  weight: numberSchema(D.missionWeight).optional(),
  minTrainerLevel: numberSchema(D.minTrainerLevel).optional(),
  title: shortTextSchema,
  description: longTextSchema,
  rewards: z.array(missionRewardSchema).min(1).max(D.rewardTiersMax),
}

export function missionRules<T extends { kind: string; minMinutes?: number; type?: string }>(m: T, ctx: z.RefinementCtx): void {
  if (m.kind === 'longSession' && m.minMinutes === undefined) ctx.addIssue({ code: 'custom', message: 'longSession needs minMinutes', path: ['minMinutes'] })
  if (m.kind !== 'longSession' && m.minMinutes !== undefined) ctx.addIssue({ code: 'custom', message: 'minMinutes is only for longSession', path: ['minMinutes'] })
  if (m.kind !== 'catchType' && m.type !== undefined) ctx.addIssue({ code: 'custom', message: 'type is only for catchType', path: ['type'] })
}

export const missionDefSchema = z.strictObject({ ...missionFields, period: z.enum(['daily', 'weekly']) }).superRefine(missionRules)

/** Event missions: a fixed list (never drawn), so no weight. */
export const eventMissionBaseSchema = z.strictObject({ ...missionFields, period: z.literal('event') }).omit({ weight: true })
export const eventMissionDefSchema = eventMissionBaseSchema.superRefine(missionRules)

export const pokedexMilestoneSchema = z.strictObject({
  id: slugSchema,
  species: numberSchema(D.pokedexSpecies),
  title: shortTextSchema,
  description: longTextSchema,
  rewards: z.array(missionRewardSchema).min(1).max(D.rewardTiersMax),
})

export const contentItemSchema = z.strictObject({ names: shortTextSchema, description: longTextSchema.optional() })

export const missionsPatchSchema = z.strictObject({
  dailyCount: numberSchema(D.missionCount).optional(),
  weeklyCount: numberSchema(D.missionCount).optional(),
  pool: z.array(missionDefSchema).max(D.missionPoolMax).optional(),
  pokedex: z.array(pokedexMilestoneSchema).max(50).optional(),
  placeholderItems: z.record(slugSchema, contentItemSchema).optional(),
})

// ---------------------------------------------------------------------------
// Species, moves
// ---------------------------------------------------------------------------

export const SPAWN_WEATHERS = ['rain', 'sun', 'snow', 'clear'] as const

const hourWindowSchema = z
  .tuple([numberSchema(D.spawnHour), numberSchema(D.spawnHour)])
  .refine(([from, to]) => from !== to && from < 24, { message: 'empty hour window (from must differ from to, and be < 24)' })

export const speciesSpawnSchema = z.strictObject({
  enabled: z.boolean().optional(),
  weightMult: numberSchema(D.spawnWeightMult).optional(),
  hours: z.array(hourWindowSchema).min(1).max(D.spawnMaxWindows).optional(),
  weather: z
    .array(z.enum(SPAWN_WEATHERS))
    .min(1)
    .max(SPAWN_WEATHERS.length)
    .refine((w) => new Set(w).size === w.length, { message: 'duplicate weather' })
    .optional(),
  minTrainerLevel: numberSchema(D.minTrainerLevel).optional(),
})

export const speciesPatchSchema = z.strictObject({
  captureRate: numberSchema(D.captureRate).optional(),
  spawn: speciesSpawnSchema.optional(),
})

export const movePatchSchema = z.strictObject({
  power: numberSchema(D.movePower).nullable().optional(),
  accuracy: numberSchema(D.moveAccuracy).nullable().optional(),
})

// ---------------------------------------------------------------------------
// ContentPatch
// ---------------------------------------------------------------------------

export const contentPatchSchema = z.strictObject({
  config: configPatchSchema.optional(),
  species: z.record(slugSchema, speciesPatchSchema).optional(),
  moves: z.record(slugSchema, movePatchSchema).optional(),
  techniques: z.record(slugSchema, techniqueSchema).optional(),
  abilities: z.record(slugSchema, abilitySchema).optional(),
  missions: missionsPatchSchema.optional(),
})

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** The editable part of an event (`live_events.overlay`: no id, slug or dates). */
export const eventOverlayBodySchema = z.strictObject({
  featured: z
    .array(z.strictObject({ species: slugSchema, weightMult: numberSchema(D.eventFeaturedMult) }))
    .max(D.eventFeaturedMax),
  shiny: z.strictObject({ chance: numberSchema(D.eventShinyChance), scope: z.enum(['all', 'featured']) }).optional(),
  legendaryChanceMult: numberSchema(D.eventLegendaryMult).optional(),
  drops: z
    .array(z.strictObject({ item: slugSchema, perWaveChance: numberSchema(D.eventDropChance), max: numberSchema(D.eventDropMax) }))
    .max(D.eventDropsMax),
  missions: z.array(eventMissionDefSchema).max(D.eventMissionsMax),
  items: z
    .record(slugSchema, contentItemSchema)
    .refine((r) => Object.keys(r).length <= D.eventItemsMax, { message: `at most ${D.eventItemsMax} items` })
    .optional(),
})

const epochMs = z.number().int().min(0).max(8_640_000_000_000_000)

/** A full `EventOverlay` (body + id, slug and dates). */
export const eventOverlaySchema = eventOverlayBodySchema
  .extend({
    id: z.string().min(1).max(64),
    slug: slugSchema,
    startsAt: epochMs,
    endsAt: epochMs,
  })
  .superRefine((e, ctx) => {
    if (e.endsAt <= e.startsAt) ctx.addIssue({ code: 'custom', message: 'endsAt must be after startsAt', path: ['endsAt'] })
    else if (e.endsAt - e.startsAt > D.eventMaxDurationMs) ctx.addIssue({ code: 'custom', message: 'event too long', path: ['endsAt'] })
  })

/** Name and description of an event (`live_events.name/description`). */
export const eventMetaSchema = z.strictObject({ name: shortTextSchema, description: richLongTextSchema })

// ---------------------------------------------------------------------------
// Compile-time checks: what the schemas accept is what the engine types allow.
// ---------------------------------------------------------------------------

type Assignable<A, B> = [A] extends [B] ? true : false
type Assert<T extends true> = T

export type SchemaTypeChecks = [
  Assert<Assignable<z.infer<typeof effectSchema>, Effect>>,
  Assert<Assignable<z.infer<typeof techniqueSchema>, TechniqueDef>>,
  Assert<Assignable<z.infer<typeof abilitySchema>, AbilityDef>>,
  Assert<Assignable<z.infer<typeof missionDefSchema>, MissionDef>>,
  Assert<Assignable<z.infer<typeof pokedexMilestoneSchema>, PokedexMilestoneDef>>,
  Assert<Assignable<Omit<z.infer<typeof contentPatchSchema>, 'config'>, Omit<ContentPatch, 'config'>>>,
  Assert<Assignable<z.infer<typeof eventOverlaySchema>, EventOverlay>>,
]
