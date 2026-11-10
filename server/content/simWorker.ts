/**
 * Admin balance simulation off the main thread (docs/admin-plan.md §7, E10).
 *
 * This file is both sides of a `worker_threads` worker:
 * - main thread: `spawnSimWorker(input)` starts a worker on this same file and returns the
 *   result promise, progress callbacks and `cancel()` (worker.terminate()).
 * - worker thread: runs `simulateComparison` (server/content/simCompare.ts → scripts/sim) on
 *   `workerData` and posts `{type:'progress'}` messages and one `{type:'done'|'error'}`.
 *
 * The server runs from TypeScript sources, so the worker is started with `--import tsx`
 * (it works the same under `npm start`, `tsx watch` and vitest). The heap of the worker
 * is capped so a huge run cannot take the whole VPS down. The Docker image copies
 * scripts/sim for this (Dockerfile).
 */
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import type { AdminSimReport } from '../../src/game/protocol'
import type { SimInput } from './simCompare'

type WorkerMsg = { type: 'progress'; done: number; total: number } | { type: 'done'; report: AdminSimReport } | { type: 'error'; message: string }

/** Marker in workerData: this file only does work when started by `spawnSimWorker`. */
const MARK = 'pokefocus-sim'

export interface SimJob {
  result: Promise<AdminSimReport>
  /** Stop the worker; `result` rejects with `cancelled`. */
  cancel(reason?: string): void
}

export interface SpawnOptions {
  onProgress?: (done: number, total: number) => void
  /** Worker old-space cap (MB). */
  heapMb?: number
}

export function spawnSimWorker(input: SimInput, opts: SpawnOptions = {}): SimJob {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { [MARK]: true, input },
    execArgv: ['--import', 'tsx'],
    resourceLimits: { maxOldGenerationSizeMb: opts.heapMb ?? 512 },
    stdout: false,
    stderr: false,
  })
  let settled = false
  let cancelReason: string | null = null
  const result = new Promise<AdminSimReport>((resolve, reject) => {
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    worker.on('message', (m: WorkerMsg) => {
      if (m.type === 'progress') opts.onProgress?.(m.done, m.total)
      else if (m.type === 'done') finish(() => resolve(m.report))
      else finish(() => reject(new Error(m.message)))
    })
    worker.on('error', (e) => finish(() => reject(e)))
    worker.on('exit', (code) => finish(() => reject(new Error(cancelReason ?? `worker exited (${code})`))))
  })
  // A finished worker exits by itself; make sure it is gone either way.
  result.then(
    () => void worker.terminate(),
    () => void worker.terminate(),
  )
  return {
    result,
    cancel(reason = 'cancelled') {
      cancelReason = reason
      void worker.terminate()
    },
  }
}

// --- Worker side -------------------------------------------------------------------------------

if (!isMainThread && parentPort && (workerData as Record<string, unknown> | null)?.[MARK]) {
  const port = parentPort
  const { input } = workerData as { input: SimInput }
  void (async () => {
    try {
      const { simulateComparison } = await import('./simCompare')
      let last = 0
      const report = simulateComparison(input, (done, total) => {
        const t = Date.now()
        // At most ~4 progress messages a second (plus the last one).
        if (done === total || t - last >= 250) {
          last = t
          port.postMessage({ type: 'progress', done, total } satisfies WorkerMsg)
        }
      })
      port.postMessage({ type: 'done', report } satisfies WorkerMsg)
    } catch (e) {
      port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) } satisfies WorkerMsg)
    }
  })()
}
