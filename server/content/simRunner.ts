/**
 * Admin simulation runs (docs/admin-plan.md §7, E10): one at a time per server, persisted in
 * `content_sim_runs`, executed off the main thread (server/content/simWorker.ts) and cancelled
 * after `timeoutMs` (default 5 min).
 *
 * - `start(...)` inserts the `running` row in the caller's transaction (with its audit row) and
 *   `launch(id, input)` after the commit spawns the worker. A second start while one runs → 409 `busy`.
 * - On completion the row becomes `done` (with the report), `failed` or `timeout`.
 * - Rows left `running` by a previous process are marked `interrupted` the first time the runner
 *   touches the table (single instance, like push and groups).
 *
 * The executor and the timer are injectable (tests: a fake executor and a manual timer).
 */
import { and, eq, ne } from 'drizzle-orm'
import type { AdminSimReport } from '../../src/game/protocol'
import type { Db, Tx } from '../db/client'
import { contentSimRuns } from '../db/schema'
import { ApiError } from '../http'
import type { SimInput } from './simCompare'
import type { SimJob } from './simWorker'

export const SIM_TIMEOUT_MS = 5 * 60_000

export type SimExecutor = (input: SimInput, onProgress: (done: number, total: number) => void) => SimJob
/** Calls `fn` after `ms`; returns a function that cancels it. */
export type SimTimer = (fn: () => void, ms: number) => () => void

export interface SimRunnerOptions {
  db: Db
  clock?: () => number
  timeoutMs?: number
  execute?: SimExecutor
  timer?: SimTimer
}

export interface SimRunner {
  /** Id of the run in progress (null = idle). */
  readonly current: number | null
  /** Progress of the run in progress. */
  progress(id: number): { done: number; total: number } | null
  /** Throws 409 `busy` when a run is in progress (or reserved). Call `launch` after the commit, or `release` if it rolled back. */
  reserve(): void
  release(): void
  /** Mark the stale `running` rows of a previous process as `interrupted` (idempotent, once). */
  recover(ex?: Db | Tx): Promise<void>
  /** Start the worker for the inserted row `id`; resolves when the row is final. */
  launch(id: number, input: SimInput): Promise<void>
}

const defaultTimer: SimTimer = (fn, ms) => {
  const t = setTimeout(fn, ms)
  t.unref?.()
  return () => clearTimeout(t)
}

const defaultExecutor: SimExecutor = (input, onProgress) => {
  // Lazy: the worker module (and worker_threads) only load when an admin simulates.
  let job: SimJob | null = null
  let cancelled: string | null = null
  const result = import('./simWorker').then(({ spawnSimWorker }) => {
    if (cancelled) throw new Error(cancelled)
    job = spawnSimWorker(input, { onProgress })
    return job.result
  })
  return {
    result,
    cancel(reason = 'cancelled') {
      cancelled = reason
      job?.cancel(reason)
    },
  }
}

export function createSimRunner(opts: SimRunnerOptions): SimRunner {
  const { db } = opts
  const clock = opts.clock ?? Date.now
  const timeoutMs = opts.timeoutMs ?? SIM_TIMEOUT_MS
  const execute = opts.execute ?? defaultExecutor
  const timer = opts.timer ?? defaultTimer
  let current: number | null = null
  let reserved = false
  let prog: { done: number; total: number } | null = null
  let recovered = false

  async function recover(ex: Db | Tx = db): Promise<void> {
    if (recovered) return
    recovered = true
    const where = current === null ? eq(contentSimRuns.status, 'running') : and(eq(contentSimRuns.status, 'running'), ne(contentSimRuns.id, current))
    await ex.update(contentSimRuns).set({ status: 'interrupted', error: 'server restarted', finishedAt: new Date(clock()) }).where(where)
  }

  async function finish(id: number, set: { status: 'done' | 'failed' | 'timeout'; result?: AdminSimReport; error?: string }): Promise<void> {
    await db
      .update(contentSimRuns)
      .set({ status: set.status, result: set.result ?? null, error: set.error ?? null, finishedAt: new Date(clock()) })
      .where(and(eq(contentSimRuns.id, id), eq(contentSimRuns.status, 'running')))
  }

  async function launch(id: number, input: SimInput): Promise<void> {
    current = id
    reserved = true
    prog = { done: 0, total: input.params.profiles.length * input.params.seeds * 2 }
    let timedOut = false
    const job = execute(input, (done, total) => {
      prog = { done, total }
    })
    const stopTimer = timer(() => {
      timedOut = true
      job.cancel('timeout')
    }, timeoutMs)
    try {
      const report = await job.result
      await finish(id, { status: 'done', result: report })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (timedOut) await finish(id, { status: 'timeout', error: `cancelled after ${Math.round(timeoutMs / 1000)} s` })
      else {
        console.error(`[sim] run ${id} failed: ${message}`)
        await finish(id, { status: 'failed', error: message.slice(0, 500) })
      }
    } finally {
      stopTimer()
      current = null
      reserved = false
      prog = null
    }
  }

  return {
    get current() {
      return current
    },
    progress: (id) => (id === current ? prog : null),
    reserve() {
      if (reserved) throw new ApiError(409, 'busy')
      reserved = true
    },
    release() {
      if (current === null) reserved = false
    },
    recover,
    launch,
  }
}
