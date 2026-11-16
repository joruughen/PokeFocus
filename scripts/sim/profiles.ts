/**
 * Player profiles: who studies when. A profile turns (weeks, seed) into a fully
 * pre-generated schedule of sessions with weather, focus labels, pauses, claim
 * delays and sound profiles. The schedule only depends on (profile, seed), so
 * re-running with different game config sees exactly the same player behaviour
 * (common random numbers).
 */
import { chance, createRng, pick, randInt, shuffle, type Rng, type SoundProfile, type WeatherInput } from '../../src/engine/index.ts'

export type ProfileId = 'casual' | 'constant' | 'marathoner' | 'night-owl' | 'irregular' | 'grinder' | 'casual-real' | 'exams' | 'dropout'

/** The six profiles of the standard 12-week report (unchanged). */
export const PROFILE_IDS: readonly ProfileId[] = ['casual', 'constant', 'marathoner', 'night-owl', 'irregular', 'grinder']
/** Realistic long-horizon profiles (only used by the long-term report, `--longterm`). */
export const LONGTERM_PROFILE_IDS: readonly ProfileId[] = ['casual-real', 'exams', 'dropout']
export const ALL_PROFILE_IDS: readonly ProfileId[] = [...PROFILE_IDS, ...LONGTERM_PROFILE_IDS]

export const PROFILE_DESC: Record<ProfileId, string> = {
  casual: '1–2 × 25 min en ~4 días laborales al azar, por la tarde',
  constant: '4 × 25 min todos los días (mañana + tarde), con descansos',
  marathoner: '2 × 100 min todos los días',
  'night-owl': '3 × 50 min cada noche, empezando entre las 21:00 y las 23:00',
  irregular: '~50 % de los días, 1–4 × 25 min a hora aleatoria',
  grinder: 'sonda antitrampas: 14 h/día de sesiones de 50 min seguidas',
  'casual-real': '1 × 25 min en ~3 días a la semana (2–4), por la tarde; ~15 % de las semanas en blanco',
  exams: 'ráfagas de 2–3 semanas (~6 días, 3–4 × 25 min) seguidas de 2–4 semanas casi vacías (~8 % de los días, 1 × 25 min)',
  dropout: 'empieza constante (3 × 25 min casi a diario) y decae hasta dejar de jugar entre las semanas 6 y 10',
}

export interface PlannedSession {
  /** Local day index since the start (day 0 = a Monday). */
  day: number
  /** Local minutes since day 0 at 00:00 (may exceed 1440 for sessions after midnight). */
  startMin: number
  minutes: number
  /** Classifier label for the single screenshot (dev-only; the simulated sessions send no labels). */
  label: string
  pausedSeconds: number
  /** Minutes between the end of the timer and pressing Claim. */
  claimDelayMin: number
  /** Does the player complete the pomodoro break after this session? */
  breakAfter: boolean
  sound: SoundProfile | null
}

export interface SchedulePlan {
  profile: ProfileId
  days: number
  /** Weather per local day (rain 25 %, sun 30 %, cold 15 %, else clear). */
  weather: WeatherInput[]
  sessions: PlannedSession[]
}

/** Minutes the player spends on the results screen throwing balls. */
const CAPTURE_MIN = 2
const BREAK_MIN = 5

function rollWeather(rng: Rng): WeatherInput {
  const r = rng.next()
  if (r < 0.25) return { rain: true, sun: false, tempC: 16 }
  if (r < 0.55) return { rain: false, sun: true, tempC: 27 }
  if (r < 0.7) return { rain: false, sun: false, snow: false, tempC: 8 }
  return { rain: false, sun: false, tempC: 19 }
}

/**
 * ~15 % of sessions get a chat / social / game label (the rest studying-like). Not sent to the engine
 * any more (production has no screenshot classifier, see run.ts); still rolled so the schedules
 * (and every later random draw) stay the same.
 */
function rollLabel(rng: Rng): string {
  const r = rng.next()
  if (r < 0.74) return 'studying'
  if (r < 0.82) return 'educational'
  if (r < 0.85) return 'unknown'
  if (r < 0.93) return 'chat'
  if (r < 0.97) return 'social'
  return 'game'
}

/** 60 % of sessions have the microphone on; the dominant sound varies. */
function rollSound(rng: Rng): SoundProfile | null {
  if (!chance(rng, 0.6)) return null
  const r = rng.next()
  const dom = r < 0.4 ? 'silence' : r < 0.7 ? 'music' : r < 0.8 ? 'voice' : 'noise'
  const share = 0.55 + rng.next() * 0.3
  const rest = [rng.next(), rng.next(), rng.next()]
  const restSum = rest[0]! + rest[1]! + rest[2]!
  const others = (['silence', 'music', 'voice', 'noise'] as const).filter((k) => k !== dom)
  const sp: SoundProfile = { silence: 0, music: 0, voice: 0, noise: 0 }
  sp[dom] = share
  others.forEach((k, i) => {
    sp[k] = ((1 - share) * (rest[i] as number)) / restSum
  })
  return sp
}

interface Item {
  minutes: number
  /** Extra idle minutes before this session (on top of claim + captures + break). */
  gapBefore?: number
}

interface ChainOpts {
  breakProb: number
  pauseProb: number
  lateClaimProb?: number
}

/** Lay out consecutive sessions from `start`, honouring claim, capture and break time. */
function chain(rng: Rng, day: number, start: number, items: Item[], o: ChainOpts): PlannedSession[] {
  const out: PlannedSession[] = []
  let t = start
  items.forEach((it, i) => {
    t += it.gapBefore ?? 0
    const pausedSeconds = chance(rng, o.pauseProb) ? randInt(rng, 60, 300) : 0
    const late = chance(rng, o.lateClaimProb ?? 0.05)
    const claimDelayMin = late ? randInt(rng, 6, 20) : 0.5 + rng.next() * 3
    const isLast = i === items.length - 1
    const breakAfter = !isLast && chance(rng, o.breakProb)
    out.push({
      day,
      startMin: Math.round(t),
      minutes: it.minutes,
      label: rollLabel(rng),
      pausedSeconds,
      claimDelayMin,
      breakAfter,
      sound: rollSound(rng),
    })
    t += it.minutes + pausedSeconds / 60 + claimDelayMin + CAPTURE_MIN + (breakAfter ? BREAK_MIN : 0)
  })
  return out
}

function repeat(n: number, minutes: number): Item[] {
  return Array.from({ length: n }, () => ({ minutes }))
}

export function planProfile(profile: ProfileId, weeks: number, seed: number | string): SchedulePlan {
  const rng = createRng(`sched|${profile}|${seed}`)
  const days = weeks * 7
  const weather: WeatherInput[] = Array.from({ length: days }, () => rollWeather(rng))
  const sessions: PlannedSession[] = []
  const add = (s: PlannedSession[]) => sessions.push(...s)
  // State of the long-horizon profiles. Drawn from the profile's own stream only, so the original
  // profiles (and the default report) see exactly the same random numbers as before.
  const quitWeek = profile === 'dropout' ? randInt(rng, 6, 10) : 0
  let examLeft = profile === 'exams' ? randInt(rng, 2, 3) : 0
  let examBurst = true
  let blankWeek = false
  let realDays = new Set<number>()

  for (let w = 0; w < weeks; w++) {
    const casualDays = new Set(shuffle(rng, [0, 1, 2, 3, 4]).slice(0, 4))
    if (profile === 'exams') {
      if (examLeft === 0) {
        examBurst = !examBurst
        examLeft = examBurst ? randInt(rng, 2, 3) : randInt(rng, 2, 4)
      }
      examLeft--
    }
    if (profile === 'casual-real') {
      blankWeek = chance(rng, 0.15)
      realDays = new Set(blankWeek ? [] : shuffle(rng, [0, 1, 2, 3, 4, 5, 6]).slice(0, pick(rng, [2, 3, 3, 3, 4])))
    }
    // Dropout: probability of playing on a day and sessions per day fall until the quit week.
    const dropP = w >= quitWeek ? 0 : 0.95 * (1 - w / quitWeek)
    const dropN = w < quitWeek * 0.4 ? 3 : w < quitWeek * 0.7 ? 2 : 1
    for (let wd = 0; wd < 7; wd++) {
      const d = w * 7 + wd
      const base = d * 1440
      switch (profile) {
        case 'casual':
          if (casualDays.has(wd)) {
            const n = pick(rng, [1, 2])
            add(chain(rng, d, base + 14 * 60 + randInt(rng, 0, 180), repeat(n, 25), { breakProb: 0.5, pauseProb: 0.2 }))
          }
          break
        case 'constant':
          add(chain(rng, d, base + 8 * 60 + 30 + randInt(rng, 0, 60), repeat(2, 25), { breakProb: 0.9, pauseProb: 0.2 }))
          add(chain(rng, d, base + 14 * 60 + 30 + randInt(rng, 0, 60), repeat(2, 25), { breakProb: 0.9, pauseProb: 0.2 }))
          break
        case 'marathoner':
          add(
            chain(rng, d, base + 8 * 60 + 30 + randInt(rng, 0, 60), [{ minutes: 100 }, { minutes: 100, gapBefore: randInt(rng, 45, 100) }], {
              breakProb: 0.8,
              pauseProb: 0.2,
            }),
          )
          break
        case 'night-owl':
          add(chain(rng, d, base + 21 * 60 + randInt(rng, 0, 120), [{ minutes: 50 }, { minutes: 50, gapBefore: 3 }, { minutes: 50, gapBefore: 3 }], { breakProb: 0.6, pauseProb: 0.2 }))
          break
        case 'irregular':
          if (chance(rng, 0.5)) {
            const n = randInt(rng, 1, 4)
            const items: Item[] = Array.from({ length: n }, (_, i) => ({ minutes: 25, gapBefore: i === 0 ? 0 : randInt(rng, 0, 40) }))
            add(chain(rng, d, base + randInt(rng, 7 * 60, 22 * 60), items, { breakProb: 0.5, pauseProb: 0.2 }))
          }
          break
        case 'casual-real':
          if (realDays.has(wd)) add(chain(rng, d, base + 15 * 60 + randInt(rng, 0, 240), repeat(1, 25), { breakProb: 0.5, pauseProb: 0.2 }))
          break
        case 'exams':
          if (examBurst) {
            if (chance(rng, 6 / 7)) add(chain(rng, d, base + 9 * 60 + randInt(rng, 0, 120), repeat(randInt(rng, 3, 4), 25), { breakProb: 0.8, pauseProb: 0.2 }))
          } else if (chance(rng, 0.08)) {
            add(chain(rng, d, base + randInt(rng, 9 * 60, 21 * 60), repeat(1, 25), { breakProb: 0.3, pauseProb: 0.2 }))
          }
          break
        case 'dropout':
          if (chance(rng, dropP)) add(chain(rng, d, base + 9 * 60 + randInt(rng, 0, 600), repeat(dropN, 25), { breakProb: 0.7, pauseProb: 0.2 }))
          break
        case 'grinder':
          add(chain(rng, d, base + 7 * 60, repeat(16, 50), { breakProb: 0, pauseProb: 0, lateClaimProb: 0 }))
          break
      }
    }
  }
  sessions.sort((a, b) => a.startMin - b.startMin)
  return { profile, days, weather, sessions }
}

/** Local weekday index (0 = Monday) of a local day. */
export function weekdayOfDay(day: number): number {
  return day % 7
}
