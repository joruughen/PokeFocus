import type { SparseHist } from './hist'
import type { Sample } from './sampler'

export interface Mix {
  /** Fracción de usuarios virtuales que además estudian (start → claim → dismiss) en bucle. */
  actors: number
  /** Probabilidad por iteración de volver a iniciar sesión (POST /auth/login, scrypt = CPU). */
  loginPerIter: number
  /** Pesos de las consultas de un usuario virtual (se normalizan). */
  weights: { game: number; lbGlobal: number; lbCountry: number; lbFriends: number; friends: number; content: number; config: number }
}

export interface WorkerInit {
  mode: 'seed' | 'run'
  baseUrl: string
  origin: string
  /** Usuarios de este worker: índice global, y token (null = aún sin registrar). */
  users: { i: number; token: string | null }[]
  totalVus: number
  mix: Mix
  /** Ms entre acciones de un usuario virtual (±50 %). */
  thinkMs: number
  /** Ms que dura «estudiando» entre start y claim (se simula con x-dev-now; no se espera la sesión real). */
  studyMs: number
  devTools: boolean
  /** Seed: concurrencia de altas por worker. */
  seedConcurrency: number
  /** Seed: fracción de usuarios que cierran una sesión para tener puntos en los rankings. */
  seedPlayFraction: number
  /** Fracción (0-1) de usuarios virtuales que participan en el pico (solo escenario `peak`). */
  peakFraction: number
}

export type ScenarioKind = 'steady' | 'peak' | 'event'

export type ToWorker =
  | { type: 'init'; init: WorkerInit }
  /** `peakAt`: instante absoluto (ms) del inicio del pico; `peakWindowMs`: ventana en la que arrancan los participantes. */
  | { type: 'go'; startAt: number; rampMs: number; endAt: number; peakAt?: number; peakWindowMs?: number }
  /** El orquestador va a publicar/anunciar algo: los clientes miden cuánto tarda el SSE correspondiente en llegarles (t0 = ms absolutos). */
  | { type: 'mark'; kind: 'content' | 'announce'; t0: number }
  | { type: 'stop' }

export interface OpStats {
  ok: number
  err: number
  limited: number
  conflict: number
  hist: SparseHist
}

export interface Tick {
  ops: Record<string, OpStats>
  bytesIn: number
  bytesOut: number
  sseOpen: number
  sseEvents: number
  sseBytes: number
  sseReconnects: number
  vusActive: number
  errSamples: string[]
}

export type FromWorker =
  | { type: 'ready'; pid: number }
  | { type: 'tick'; tick: Tick }
  | { type: 'tokens'; tokens: Record<number, string> }
  | { type: 'done' }

export interface OpSummary {
  n: number
  ok: number
  err: number
  limited: number
  conflict: number
  p50: number
  p95: number
  p99: number
}

export interface PhaseResult {
  mode: 'seed' | 'run'
  users: number
  durationSec: number
  ops: Record<string, OpSummary>
  total: OpSummary & { rps: number; errRate: number }
  bytesIn: number
  bytesOut: number
  series: { t: number[]; rps: number[]; errPerSec: number[]; p50: number[]; p95: number[]; p99: number[]; inMBs: number[]; outMBs: number[]; sseOpen: number[]; vus: number[]; probeMs: number[] }
  probe: { p50: number; p95: number; p99: number }
  sse: { peakOpen: number; events: number; reconnects: number; bytes: number }
  samples: Sample[]
  errSamples: string[]
  /** Consultas de conexiones «idle in transaction» si el pool se bloqueó. */
  pgDiag?: string[]
  aborted?: string
  /** Solo en los escenarios `peak` / `event`: instantes de interés (segundos desde el inicio de la fase). */
  scenario?: ScenarioInfo
}

export interface ScenarioInfo {
  kind: Exclude<ScenarioKind, 'steady'>
  /** Los `Sample.t` cuentan desde que arranca el muestreador, unos segundos después que `series.t`: se restan al cruzarlos. */
  sampleOffsetSec: number
  params: Record<string, number>
  marks: { name: string; sec: number; info?: Record<string, number | string> }[]
}

export interface BigBaseInfo {
  /** Usuarios dormidos sembrados y total de usuarios de la base tras sembrar. */
  sleepers: number
  totalUsers: number
  seconds: number
  dbSizeMb: number
  tables: Record<string, { rows: number; mb: number }>
}

export interface LevelResult {
  name: string
  users: number
  params: { rampSec: number; holdSec: number; thinkMs: number; studyMs: number; actors: number; loginPerIter: number; workers: number }
  seed: PhaseResult | null
  run: PhaseResult
  serverLogErrors: number
  db: { sizeMb: number; users: number }
  scenario?: ScenarioKind
  bigBase?: BigBaseInfo
  startedAt: string
}
