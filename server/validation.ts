/** zod schemas for every request body (auth, friends, game actions). */
import { z } from 'zod'
import { ALL_TYPES, defaultContext, MAX_RELEASE_BATCH, STAT_KEYS, type StatKey, type TypeSlug } from '../src/engine'
import { MAINTENANCE_MAX_MS, MAINTENANCE_NOTE_MAX, type GameAction } from '../src/game/protocol'
import { isTrainerSprite } from '../src/game/trainerCatalog'
import { PASSWORD_MAX, PASSWORD_MIN } from './auth/password'

// ---------------------------------------------------------------------------
// Admin notes shown to players (plain text only)
// ---------------------------------------------------------------------------

const plainLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // No HTML and no control characters (so no line breaks): the client renders it as text, this is the second belt.
    .refine((s) => !/[<>\u0000-\u001f\u007f]/.test(s), 'plain_text')

/** `{ es?, en? }`: at least one non-empty language, each a plain line up to `max` characters. Empty strings are dropped. */
export const localizedNote = (max: number) =>
  z
    .object({ es: plainLine(max).optional(), en: plainLine(max).optional() })
    .strict()
    .transform((n) => ({ ...(n.es ? { es: n.es } : {}), ...(n.en ? { en: n.en } : {}) }))
    .refine((n) => n.es !== undefined || n.en !== undefined, 'empty_note')

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email())
export const passwordSchema = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX)
export const trainerNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[\p{L}\p{N} _]+$/u)
export const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/)

export const registerBody = z.object({
  email: emailSchema,
  password: passwordSchema,
  trainerName: trainerNameSchema,
  country: countrySchema,
})

export const loginBody = z.object({
  email: emailSchema,
  // Do not reveal the policy on login: any non-empty string up to the max.
  password: z.string().min(1).max(PASSWORD_MAX),
})

/** A character of the catalogue (`trainerCatalog.ts`, all of Showdown's trainer sprites), or null to go back to the default. */
export const trainerSpriteSchema = z
  .string()
  .refine(isTrainerSprite, 'unknown_trainer')
  .nullable()

export const patchMeBody = z
  .object({
    trainerName: trainerNameSchema.optional(),
    country: countrySchema.optional(),
    anonymousRankings: z.boolean().optional(),
    trainerSprite: trainerSpriteSchema.optional(),
  })
  .refine((v) => v.trainerName !== undefined || v.country !== undefined || v.anonymousRankings !== undefined || v.trainerSprite !== undefined, { message: 'empty patch' })

export const passwordBody = z.object({ current: z.string().min(1).max(PASSWORD_MAX), next: passwordSchema })

export const friendRequestBody = z.object({ friendCode: z.string().trim().min(1).max(20) })

// ---------------------------------------------------------------------------
// Game actions (mirrors GameAction in src/game/protocol.ts)
// ---------------------------------------------------------------------------

const session = defaultContext().config.session

const timezone = z.union([
  z.number().int().min(-14 * 60).max(14 * 60),
  z
    .string()
    .min(1)
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
      } catch {
        return false
      }
    }, 'invalid time zone'),
])
const locale = z.enum(['es', 'en'])
const id = z.string().min(1).max(64)
const slug = z.string().min(1).max(64)
const count = z.number().int().min(1).max(999)
const ref = z.object({ waveIndex: z.number().int().min(0).max(99), wildIndex: z.number().int().min(0).max(99) })
const ball = z.enum(['poke-ball', 'great-ball', 'ultra-ball', 'study-ball'])
const typeSlug = z.enum(ALL_TYPES as readonly [TypeSlug, ...TypeSlug[]])
const weather = z.object({
  rain: z.boolean(),
  sun: z.boolean(),
  snow: z.boolean().optional(),
  tempC: z.number().min(-100).max(100).nullable(),
})

/** Device location for the weather; the client rounds it to ~0.1°, the reducer rounds again before storing. */
const geoCell = z.object({ lat: z.number().finite().min(-90).max(90), lon: z.number().finite().min(-180).max(180) })

/** Microphone shares (0–1 each); rounding may push the sum a bit over 1. */
export const soundProfileSchema = z
  .object({ silence: z.number().min(0).max(1), music: z.number().min(0).max(1), voice: z.number().min(0).max(1), noise: z.number().min(0).max(1) })
  .refine((p) => p.silence + p.music + p.voice + p.noise <= 1.05, 'shares sum over 1.05')

const act = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) => z.object({ type: z.literal(type), ...shape })

export const gameActionBody = z.discriminatedUnion('type', [
  act('createPlayer', { locale, timezone, starterSlug: slug }),
  act('updateProfile', {
    patch: z.object({
      locale: locale.optional(),
      timezone: timezone.optional(),
      city: z.string().trim().max(80).nullable().optional(),
      location: geoCell.nullable().optional(),
    }),
  }),
  act('setWeather', { weather: weather.nullable() }),
  act('start', { minutes: z.number().int().min(session.minMinutes).max(session.maxMinutes) }),
  act('pause', {}),
  act('resume', {}),
  act('cancel', { soundProfile: soundProfileSchema.nullable().optional() }),
  act('markNotified', {}),
  act('claim', { devFocusLabel: z.string().max(32).nullable().optional(), soundProfile: soundProfileSchema.nullable().optional() }),
  act('dismissResults', {}),
  act('ackLevelUp', {}),
  act('ackGifts', {}),
  act('ackLeagueNotices', {}),
  act('ackTrade', {}),
  act('throwBall', { ref, ball }),
  act('applyStatus', { chargeId: id, ref }),
  act('reroll', { chargeId: id, ref }),
  act('assignDamage', { waveIndex: ref.shape.waveIndex, uid: id, wildIndex: ref.shape.wildIndex }),
  act('autoAssignDamage', { waveIndex: ref.shape.waveIndex }),
  act('setAutoDamage', { value: z.boolean() }),
  act('nextWave', {}),
  act('finishWaves', {}),
  act('release', { uid: id }),
  act('resolveCapture', {
    uid: id,
    choice: z.discriminatedUnion('kind', [z.object({ kind: z.literal('swap'), releaseUid: id }), z.object({ kind: z.literal('convert') }), z.object({ kind: z.literal('keep') })]),
  }),
  act('releaseMany', { uids: z.array(id).min(1).max(MAX_RELEASE_BATCH).refine((a) => new Set(a).size === a.length, 'duplicate uids') }),
  act('feedCandy', {
    uid: id,
    candy: z.discriminatedUnion('kind', [z.object({ kind: z.literal('species') }), z.object({ kind: z.literal('type'), type: typeSlug })]),
    count,
  }),
  act('equip', { uid: id, moves: z.array(slug).max(8) }),
  act('setTeam', { uids: z.array(id).min(1).max(6) }),
  act('setLeader', { uid: id }),
  act('evolve', { uid: id, to: slug }),
  act('heal', { uid: id, item: slug }),
  // Raw text only bounded here; the reducer trims and counts graphemes (nickname 12, preset name 20).
  act('setNickname', { uid: id, nickname: z.string().max(200).nullable() }),
  act('useTera', { uid: id, teraType: typeSlug }),
  act('useTm', { uid: id, move: slug }),
  act('useMint', { uid: id, nature: slug }),
  act('useBottleCap', { uid: id, stat: z.enum(STAT_KEYS as readonly [StatKey, ...StatKey[]]) }),
  act('useAbilityCapsule', { uid: id, ability: slug }),
  act('savePreset', { name: z.string().max(200) }),
  act('renamePreset', { id, name: z.string().max(200) }),
  act('overwritePreset', { id }),
  act('deletePreset', { id }),
  act('applyPreset', { id }),
  act('claimMission', { id }),
  act('claimAllMissions', {}),
  act('startBreak', { minutes: z.number().int().min(1).max(60) }),
  act('endBreak', {}),
  act('skipBreak', {}),
  act('devAddItems', {
    items: z.record(slug, z.number().int().min(-999).max(999)).refine((r) => Object.keys(r).length <= 50, 'too many items'),
  }),
  act('devAddDust', { amount: z.number().int().min(1).max(1_000_000) }),
  act('devAddCandies', { amount: count }),
  act('devLevelUp', { levels: z.number().int().min(1).max(100) }),
  act('devAddLeaguePoints', { points: z.number().int().min(1).max(10_000_000) }),
  act('devAddTrainerExp', { amount: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, 'zero') }),
  act('devAddRandomPokemon', { count: z.number().int().min(1).max(200) }),
  act('resetAll', {}),
])

// Compile-time guard: every parsed body is a valid GameAction.
export const asGameAction = (a: z.infer<typeof gameActionBody>): GameAction => a

// ---------------------------------------------------------------------------
// Study groups (/api/groups)
// ---------------------------------------------------------------------------

/** Up to 7 friends (8 people with the host); see MAX_GROUP_SIZE in server/groups.ts. */
const friendIdList = z.array(z.uuid()).min(1).max(7)

export const groupCreateBody = z.object({
  minutes: z.number().int().min(session.minMinutes).max(session.maxMinutes),
  friendIds: friendIdList,
})

export const groupInviteBody = z.object({ friendIds: friendIdList })

// ---------------------------------------------------------------------------
// Trades (/api/trades, GDD §12.8). The message is re-checked in graphemes by the route.
// ---------------------------------------------------------------------------

export const tradeOfferBody = z.object({
  toUserId: z.uuid(),
  uid: id,
  message: z.string().max(400).nullable().optional(),
})

export const tradeCounterBody = z.object({ uid: id })

// ---------------------------------------------------------------------------
// Study-group heals (/api/heals)
// ---------------------------------------------------------------------------

export const healSendBody = z.object({ groupId: z.uuid(), toUserId: z.uuid(), uid: id })

// ---------------------------------------------------------------------------
// Admin: scheduled maintenance windows (/api/admin/maintenance)
// ---------------------------------------------------------------------------

/** Last instant a Date can safely round-trip through the database (year 9999). */
const MAX_EPOCH_MS = 253_402_300_799_999

const instant = z.number().int().max(MAX_EPOCH_MS)

/**
 * POST body. `now` is the server clock (ms): a window must end in the future.
 * Cross-field errors are reported on the field to fix (`endsAt`).
 */
export const maintenanceCreateBody = (now: number) =>
  z
    .object({
      startsAt: instant,
      endsAt: instant,
      // Trimmed first, then measured; blank = no note.
      note: z
        .string()
        .trim()
        .max(MAINTENANCE_NOTE_MAX)
        .nullish()
        .transform((v) => v || null),
    })
    .refine((v) => v.endsAt > v.startsAt, { path: ['endsAt'], message: 'must be after startsAt' })
    .refine((v) => v.endsAt > now, { path: ['endsAt'], message: 'must be in the future' })
    .refine((v) => v.endsAt - v.startsAt <= MAINTENANCE_MAX_MS, { path: ['endsAt'], message: 'window too long' })
