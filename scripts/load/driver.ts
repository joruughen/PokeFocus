/**
 * Orquestador de una fase de carga: reparte los usuarios entre workers (procesos), agrega sus métricas por segundo,
 * sondea /api/health como medida de la latencia «en reposo» del servidor y vigila la memoria libre del host.
 */
import { fork, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { addTo, mergeInto, percentile, type SparseHist } from './hist'
import { Http } from './http'
import { ROOT } from './infra'
import { Sampler, type SamplerTargets } from './sampler'
import type { FromWorker, Mix, OpStats, OpSummary, PhaseResult, ScenarioInfo, ToWorker, WorkerInit } from './types'

export interface PhaseOpts {
  mode: 'seed' | 'run'
  baseUrl: string
  origin: string
  users: { i: number; token: string | null }[]
  mix: Mix
  workers: number
  rampSec: number
  holdSec: number
  thinkMs: number
  studyMs: number
  devTools: boolean
  seedPlayFraction: number
  targets: Omit<SamplerTargets, 'driverPids'>
  /** Aborta si la memoria disponible del host baja de este valor (MB). */
  minMemAvailMb: number
  log: (s: string) => void
  /** Escenario «pico»: porcentaje de usuarios, inicio (s tras acabar la rampa) y ventana (s). */
  peak?: { pct: number; atSec: number; windowSec: number }
  /**
   * Acciones del orquestador durante la fase (p. ej. publicar un evento): `atSec` = segundos tras acabar la rampa.
   * `mark`: avisa a los clientes para que midan el retraso del SSE que provoque la acción.
   */
  timed?: { atSec: number; name: string; mark?: 'content' | 'announce'; run: () => Promise<Record<string, number | string> | void> }[]
  scenarioKind?: 'peak' | 'event'
  scenarioParams?: Record<string, number>
}

const summarize = (s: OpStats): OpSummary => ({ n: s.ok + s.err + s.limited + s.conflict, ok: s.ok, err: s.err, limited: s.limited, conflict: s.conflict, p50: percentile(s.hist, 50), p95: percentile(s.hist, 95), p99: percentile(s.hist, 99) })

export async function runPhase(o: PhaseOpts): Promise<{ result: PhaseResult; tokens: Record<number, string> }> {
  const loader = pathToFileURL(join(ROOT, 'node_modules/tsx/dist/loader.mjs')).href
  const kids: ChildProcess[] = []
  const pids: number[] = []
  const tokens: Record<number, string> = {}
  const nW = Math.max(1, Math.min(o.workers, o.users.length))
  const slices: { i: number; token: string | null }[][] = Array.from({ length: nW }, () => [])
  o.users.forEach((u, k) => slices[k % nW]!.push(u))

  const perSec = new Map<number, { n: number; err: number; hist: SparseHist; bin: number; bout: number; sse: number; vus: number }>()
  const opsAgg: Record<string, OpStats> = {}
  const t0 = Date.now()
  let bytesIn = 0
  let bytesOut = 0
  let sseEvents = 0
  let sseReconnects = 0
  let sseBytes = 0
  let peakSse = 0
  const errSamples: string[] = []
  const sseByWorker = new Map<number, number>()
  const vusByWorker = new Map<number, number>()
  let aborted: string | undefined

  const done: Promise<void>[] = []
  const ready: Promise<void>[] = []
  kids.length = 0
  slices.forEach((users, w) => {
    const kid = fork(join(ROOT, 'scripts/load/worker.ts'), [], { execArgv: ['--import', loader], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    kids.push(kid)
    ready.push(new Promise((res) => kid.once('message', (m: FromWorker) => { if (m.type === 'ready') { pids.push(m.pid); res() } })))
    done.push(new Promise((res) => kid.once('exit', () => res())))
    kid.on('message', (m: FromWorker) => {
      if (m.type === 'tokens') Object.assign(tokens, m.tokens)
      if (m.type !== 'tick') return
      const t = m.tick
      const sec = Math.floor((Date.now() - t0) / 1000)
      const b = perSec.get(sec) ?? { n: 0, err: 0, hist: {}, bin: 0, bout: 0, sse: 0, vus: 0 }
      perSec.set(sec, b)
      for (const [op, s] of Object.entries(t.ops)) {
        const a = (opsAgg[op] ??= { ok: 0, err: 0, limited: 0, conflict: 0, hist: {} })
        a.ok += s.ok; a.err += s.err; a.limited += s.limited; a.conflict += s.conflict
        mergeInto(a.hist, s.hist)
        mergeInto(b.hist, s.hist)
        b.n += s.ok + s.err + s.limited + s.conflict
        b.err += s.err
      }
      b.bin += t.bytesIn; b.bout += t.bytesOut
      bytesIn += t.bytesIn; bytesOut += t.bytesOut
      sseEvents += t.sseEvents; sseReconnects += t.sseReconnects; sseBytes += t.sseBytes
      sseByWorker.set(w, t.sseOpen)
      vusByWorker.set(w, t.vusActive)
      b.sse = [...sseByWorker.values()].reduce((x, y) => x + y, 0)
      b.vus = [...vusByWorker.values()].reduce((x, y) => x + y, 0)
      peakSse = Math.max(peakSse, b.sse)
      for (const e of t.errSamples) if (errSamples.length < 10) errSamples.push(e)
    })
    const init: WorkerInit = {
      mode: o.mode, baseUrl: o.baseUrl, origin: o.origin, users, totalVus: o.users.length, mix: o.mix, thinkMs: o.thinkMs, studyMs: o.studyMs,
      devTools: o.devTools, seedConcurrency: 24, seedPlayFraction: o.seedPlayFraction, peakFraction: o.peak?.pct ?? 0,
    }
    ready[w]!.then(() => kid.send({ type: 'init', init } satisfies ToWorker))
  })
  await Promise.all(ready)
  const sampler = new Sampler({ ...o.targets, driverPids: () => pids })
  const probe = new Http(o.baseUrl)
  const probeMs = new Map<number, number[]>()
  const probeHist: SparseHist = {}
  const probeTimer = setInterval(async () => {
    const r = await probe.request({ path: '/api/health', timeoutMs: 10_000 })
    const sec = Math.floor((Date.now() - t0) / 1000)
    ;(probeMs.get(sec) ?? probeMs.set(sec, []).get(sec)!).push(r.ms)
    addTo(probeHist, r.ms)
  }, 1000)
  sampler.start()
  const sampleOffsetSec = (Date.now() - t0) / 1000
  const marks: ScenarioInfo['marks'] = []

  const rampMs = o.rampSec * 1000
  const durMs = (o.rampSec + o.holdSec) * 1000
  const startAt = Date.now() + 500
  const endAt = startAt + durMs
  const rampEndAt = startAt + rampMs
  const peakAt = o.peak ? rampEndAt + o.peak.atSec * 1000 : undefined
  const peakWindowMs = o.peak ? o.peak.windowSec * 1000 : undefined
  for (const k of kids) k.send({ type: 'go', startAt, rampMs, endAt, peakAt, peakWindowMs } satisfies ToWorker)
  const secOf = (ms: number) => Math.round(((ms - t0) / 1000) * 10) / 10
  if (peakAt !== undefined) {
    marks.push({ name: 'peak.start', sec: secOf(peakAt) }, { name: 'peak.startsEnd', sec: secOf(peakAt + peakWindowMs!) })
    o.log(`  El pico empieza en t=${secOf(peakAt)} s (ventana de ${o.peak!.windowSec} s, ${(o.peak!.pct * 100).toFixed(0)} % de los usuarios)`)
  }
  const timedDone: Promise<void>[] = []
  for (const a of o.timed ?? []) {
    const at = rampEndAt + a.atSec * 1000
    timedDone.push(
      new Promise<void>((res) => {
        setTimeout(async () => {
          const t = Date.now()
          if (a.mark) for (const k of kids) k.send({ type: 'mark', kind: a.mark, t0: t } satisfies ToWorker)
          o.log(`  t=${secOf(t)} s: ${a.name}`)
          let info: Record<string, number | string> | void = undefined
          try {
            info = await a.run()
          } catch (e) {
            info = { error: String((e as Error).message ?? e).slice(0, 200) }
            o.log(`  ERROR en «${a.name}»: ${info.error}`)
          }
          marks.push({ name: a.name, sec: secOf(t), ...(info ? { info } : {}) })
          res()
        }, Math.max(0, at - Date.now()))
      }),
    )
  }

  // Vigilancia: memoria del host y fin de la fase.
  const guard = setInterval(() => {
    const s = sampler.samples.at(-1)
    if (s && s.hostMemAvailMb < o.minMemAvailMb && !aborted) {
      aborted = `memoria disponible del host ${Math.round(s.hostMemAvailMb)} MB < ${o.minMemAvailMb} MB: fase abortada por seguridad`
      o.log(`  ABORTADO: ${aborted}`)
      for (const k of kids) k.send({ type: 'stop' } satisfies ToWorker)
    }
  }, 1000)
  const progress = setInterval(() => {
    const s = sampler.samples.at(-1)
    const sec = Math.floor((Date.now() - t0) / 1000) - 1
    const b = perSec.get(sec)
    if (b) o.log(`  t=${sec}s vus=${b.vus} sse=${b.sse} rps=${b.n} err=${b.err} p95=${percentile(b.hist, 95).toFixed(0)}ms srvCPU=${s?.srvCpu.toFixed(0)}% rss=${s?.srvRssMb.toFixed(0)}MB pgCPU=${s?.pgCpu.toFixed(0)}% conns=${s?.pgConns} idleTx=${s?.pgIdleTx} mem libre=${s?.hostMemAvailMb.toFixed(0)}MB`)
  }, 5000)
  await Promise.all(done)
  await Promise.all(timedDone)
  clearInterval(guard); clearInterval(progress); clearInterval(probeTimer)
  await sampler.stop()

  const maxSec = Math.max(0, ...perSec.keys())
  const series = { t: [] as number[], rps: [] as number[], errPerSec: [] as number[], p50: [] as number[], p95: [] as number[], p99: [] as number[], inMBs: [] as number[], outMBs: [] as number[], sseOpen: [] as number[], vus: [] as number[], probeMs: [] as number[] }
  let lastSse = 0
  let lastVus = 0
  for (let s = 0; s <= maxSec; s++) {
    const b = perSec.get(s)
    series.t.push(s)
    series.rps.push(b?.n ?? 0)
    series.errPerSec.push(b?.err ?? 0)
    series.p50.push(b && b.n ? percentile(b.hist, 50) : NaN)
    series.p95.push(b && b.n ? percentile(b.hist, 95) : NaN)
    series.p99.push(b && b.n ? percentile(b.hist, 99) : NaN)
    series.inMBs.push((b?.bin ?? 0) / 1048576)
    series.outMBs.push((b?.bout ?? 0) / 1048576)
    lastSse = b?.sse ?? lastSse
    lastVus = b?.vus ?? lastVus
    series.sseOpen.push(lastSse)
    series.vus.push(lastVus)
    const pm = probeMs.get(s)
    series.probeMs.push(pm?.length ? pm.reduce((a, c) => a + c, 0) / pm.length : NaN)
  }
  const ops: Record<string, OpSummary> = {}
  const all: OpStats = { ok: 0, err: 0, limited: 0, conflict: 0, hist: {} }
  for (const [k, v] of Object.entries(opsAgg)) {
    ops[k] = summarize(v)
    if (k.startsWith('sse.')) continue // conexiones largas y retrasos de entrega del SSE: no son latencias de petición
    all.ok += v.ok; all.err += v.err; all.limited += v.limited; all.conflict += v.conflict
    mergeInto(all.hist, v.hist)
  }
  const sum = summarize(all)
  const durationSec = maxSec + 1
  const result: PhaseResult = {
    mode: o.mode, users: o.users.length, durationSec, ops,
    total: { ...sum, rps: sum.n / durationSec, errRate: sum.n ? (sum.err + sum.limited) / sum.n : 0 },
    bytesIn, bytesOut, series,
    probe: { p50: percentile(probeHist, 50), p95: percentile(probeHist, 95), p99: percentile(probeHist, 99) },
    sse: { peakOpen: peakSse, events: sseEvents, reconnects: sseReconnects, bytes: sseBytes },
    samples: sampler.samples, errSamples, aborted, pgDiag: sampler.diag,
    ...(o.scenarioKind ? { scenario: { kind: o.scenarioKind, sampleOffsetSec, params: o.scenarioParams ?? {}, marks } } : {}),
  }
  return { result, tokens }
}
