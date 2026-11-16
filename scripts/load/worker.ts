/**
 * Worker del generador de carga: ejecuta un grupo de usuarios virtuales (proceso aparte para no saturar un solo hilo).
 * Lo lanza driver.ts; se comunica por IPC.
 */
import nodeHttp from 'node:http'
import { addTo } from './hist'
import { Http } from './http'
import { PASSWORD, emailOf, ipOf } from './ids'
import type { FromWorker, Mix, OpStats, Tick, ToWorker, WorkerInit } from './types'

const COUNTRIES = ['ES', 'MX', 'AR', 'CO', 'US', 'FR', 'BR', 'CL', 'PE', 'DE']

const send = (m: FromWorker) => process.send?.(m)
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** Espera sin pasar del fin de la fase (los usuarios no sobreviven a `endAt`). */
const sleepUntil = (ms: number) => sleep(Math.max(0, Math.min(ms, endAt - Date.now())))
const rand = (a: number, b: number) => a + Math.random() * (b - a)

let init: WorkerInit
let http: Http
let cur = fresh()
let stopFlag = false
let endAt = 0
let peakAt = 0
let peakWindowMs = 0
/** Marcas activas del orquestador: la primera vez que a cada usuario le llega el evento SSE tras la marca, se mide el retraso. */
const marks: Partial<Record<'content' | 'announce', number>> = {}
let sseOpen = 0
let sseEvents = 0
let sseBytes = 0
let sseReconnects = 0
let vusActive = 0
const tokens: Record<number, string> = {}

function fresh(): Tick {
  return { ops: {}, bytesIn: 0, bytesOut: 0, sseOpen: 0, sseEvents: 0, sseBytes: 0, sseReconnects: 0, vusActive: 0, errSamples: [] }
}

function opStats(op: string): OpStats {
  return (cur.ops[op] ??= { ok: 0, err: 0, limited: 0, conflict: 0, hist: {} })
}

interface Vu {
  i: number
  token: string | null
  offset: number // ms que el reloj de juego de este usuario va por delante del real (solo con DEV_TOOLS)
  studying: { minutes: number } | null
  /** Última marca (t0) de cada tipo cuyo SSE ya recibió este usuario. */
  seen: Partial<Record<'content' | 'announce', number>>
}

async function call(op: string, vu: Vu, o: { method?: string; path: string; json?: unknown; extra?: Record<string, string>; expect?: number[] }) {
  const headers: Record<string, string> = { 'x-forwarded-for': ipOf(vu.i), origin: init.origin, ...(o.extra ?? {}) }
  if (vu.token) headers.cookie = `pf_session=${vu.token}`
  const r = await http.request({ method: o.method, path: o.path, json: o.json, headers })
  const s = opStats(op)
  cur.bytesIn += r.bytesIn
  cur.bytesOut += r.bytesOut
  addTo(s.hist, r.ms)
  if (r.status === 429) s.limited++
  else if (r.status === 409 && o.method === 'POST') s.conflict++
  else if ((r.status >= 200 && r.status < 400) || o.expect?.includes(r.status)) s.ok++
  else {
    s.err++
    if (cur.errSamples.length < 5) cur.errSamples.push(`${op} ${r.status || 'net'} ${r.error ?? r.body.slice(0, 120)}`)
  }
  return r
}

const nowFor = (vu: Vu, extraMs = 0) => ({ 'x-dev-now': String(Date.now() + vu.offset + extraMs) })

async function register(vu: Vu): Promise<void> {
  const r = await call('auth.register', vu, {
    method: 'POST',
    path: '/api/auth/register',
    json: { email: emailOf(vu.i), password: PASSWORD, trainerName: `Load${vu.i}`, country: COUNTRIES[vu.i % COUNTRIES.length] },
  })
  const m = /pf_session=([^;]+)/.exec(([] as string[]).concat(r.headers['set-cookie'] ?? []).join(';'))
  if (r.status === 201 && m) {
    vu.token = m[1]!
    tokens[vu.i] = vu.token
  } else if (r.status === 409) {
    await login(vu)
  }
}

async function login(vu: Vu): Promise<void> {
  const r = await call('auth.login', vu, { method: 'POST', path: '/api/auth/login', json: { email: emailOf(vu.i), password: PASSWORD } })
  const m = /pf_session=([^;]+)/.exec(([] as string[]).concat(r.headers['set-cookie'] ?? []).join(';'))
  if (r.status === 200 && m) {
    vu.token = m[1]!
    tokens[vu.i] = vu.token
  }
}

const action = (vu: Vu, op: string, body: unknown, extraMs = 0) =>
  call(op, vu, { method: 'POST', path: '/api/game/action', json: body, extra: init.devTools ? nowFor(vu, extraMs) : {} })

async function createPlayer(vu: Vu) {
  await action(vu, 'game.createPlayer', { type: 'createPlayer', locale: 'es', timezone: 'Europe/Madrid', starterSlug: ['bulbasaur', 'charmander', 'squirtle'][vu.i % 3] })
}

/** Una sesión completa (start → claim → dismissResults) con el reloj de juego adelantado (DEV_TOOLS). */
async function studyCycle(vu: Vu, minutes: number, wait: boolean) {
  const st = await action(vu, 'game.start', { type: 'start', minutes })
  if (st.status !== 200) return
  if (wait) await sleepUntil(rand(0.7, 1.3) * init.studyMs)
  const adv = (minutes + 1) * 60_000
  const cl = await action(vu, 'game.claim', { type: 'claim' }, adv)
  vu.offset += adv
  if (cl.status === 200) await action(vu, 'game.dismiss', { type: 'dismissResults' })
}

async function seedUser(vu: Vu) {
  if (!vu.token) {
    await register(vu)
    if (!vu.token) return
    await createPlayer(vu)
  }
  if (init.devTools && (vu.i * 2654435761) % 1000 < init.seedPlayFraction * 1000) await studyCycle(vu, 25, false)
}

/** Reacción de la app al SSE `content` / `event_announce` (recarga de contenido y de eventos en vivo) + medida del retraso de llegada. */
function onServerEvent(vu: Vu, kind: 'content' | 'announce'): void {
  const t0 = marks[kind]
  if (t0 !== undefined && vu.seen[kind] !== t0) {
    vu.seen[kind] = t0
    const s = opStats(`sse.lat.${kind}`)
    s.ok++
    addTo(s.hist, Math.max(0, Date.now() - t0))
  }
  if (stopFlag || Date.now() >= endAt) return
  if (kind === 'content') void call('react.content', vu, { path: '/api/content' })
  void call('react.liveEvents', vu, { path: '/api/live-events' })
}

function openSse(vu: Vu): void {
  if (stopFlag || Date.now() >= endAt || !vu.token) return
  // Conexión larga: node:http directo, sin el timeout de petición del cliente normal.
  {
    const r = nodeHttp.request(
      { host: http.host, port: http.port, path: '/api/events', method: 'GET', agent: http.agent, headers: { cookie: `pf_session=${vu.token}`, 'x-forwarded-for': ipOf(vu.i), accept: 'text/event-stream' } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          cur.errSamples.length < 5 && cur.errSamples.push(`sse ${res.statusCode}`)
          opStats('sse.connect').err++
          retry()
          return
        }
        opStats('sse.connect').ok++
        sseOpen++
        let closed = false
        res.on('data', (c: Buffer) => {
          sseBytes += c.length
          const s = c.toString('latin1')
          if (s.includes('"type":"content"')) onServerEvent(vu, 'content')
          if (s.includes('"type":"event_announce"')) onServerEvent(vu, 'announce')
          let p = 0
          while ((p = s.indexOf('data:', p)) !== -1) {
            sseEvents++
            p += 5
          }
        })
        const done = () => {
          if (closed) return
          closed = true
          sseOpen--
          retry()
        }
        res.on('end', done)
        res.on('close', done)
        res.on('error', done)
        vuSse.set(vu.i, () => r.destroy())
      },
    )
    r.on('error', () => {
      opStats('sse.connect').err++
      retry()
    })
    r.end()
    function retry() {
      if (stopFlag || Date.now() >= endAt) return
      sseReconnects++
      setTimeout(() => openSse(vu), 5000)
    }
  }
}
const vuSse = new Map<number, () => void>()

function pickQuery(mix: Mix): { op: string; path: string; extra?: Record<string, string> } {
  const w = mix.weights
  const entries: [string, number][] = Object.entries(w)
  let x = Math.random() * entries.reduce((a, [, v]) => a + v, 0)
  let k = entries[0]![0]
  for (const [name, v] of entries) {
    if ((x -= v) < 0) {
      k = name
      break
    }
  }
  const period = Math.random() < 0.7 ? 'week' : 'month'
  switch (k) {
    case 'game':
      return { op: 'game.get', path: '/api/game' }
    case 'lbGlobal':
      return { op: 'lb.global', path: `/api/leaderboard?scope=global&period=${period}` }
    case 'lbCountry':
      return { op: 'lb.country', path: `/api/leaderboard?scope=country&period=${period}` }
    case 'lbFriends':
      return { op: 'lb.friends', path: `/api/leaderboard?scope=friends&period=${period}` }
    case 'friends':
      return { op: 'friends.get', path: '/api/friends' }
    case 'content':
      return Math.random() < 0.5 ? { op: 'content.get', path: '/api/content' } : { op: 'content.cond', path: '/api/content', extra: { 'if-none-match': `"base"` } }
    default:
      return { op: 'config.get', path: '/api/config' }
  }
}

/** Escenario «pico»: este usuario arranca una sesión dentro de la ventana del pico y la reclama tras `studyMs` (el reloj de juego se adelanta con DEV_TOOLS). */
async function peakTask(vu: Vu) {
  await sleepUntil(peakAt + rand(0, peakWindowMs) - Date.now())
  if (stopFlag || Date.now() >= endAt) return
  await studyCycle(vu, 25, true)
}

async function runVu(vu: Vu, startDelay: number, actor: boolean, peak: boolean) {
  await sleep(startDelay)
  vusActive++
  if (Math.random() < 0.05) await login(vu) // algunos arrancan con un inicio de sesión nuevo
  openSse(vu)
  // El primer paso de toda sesión de la app: estado de juego + contenido vivo.
  await call('game.get', vu, { path: '/api/game' })
  await call('content.get', vu, { path: '/api/content' })
  const peakP = peak ? peakTask(vu) : Promise.resolve()
  while (!stopFlag && Date.now() < endAt) {
    await sleepUntil(rand(0.5, 1.5) * init.thinkMs)
    if (stopFlag || Date.now() >= endAt) break
    if (Math.random() < init.mix.loginPerIter) await login(vu)
    if (actor && Math.random() < 0.5) {
      await studyCycle(vu, Math.random() < 0.7 ? 25 : 50, true)
      continue
    }
    const q = pickQuery(init.mix)
    await call(q.op, vu, { path: q.path, extra: q.extra, expect: q.extra ? [304] : undefined })
  }
  await peakP
  vusActive--
}

function flush() {
  cur.sseOpen = sseOpen
  cur.sseEvents = sseEvents
  cur.sseBytes = sseBytes
  cur.sseReconnects = sseReconnects
  cur.vusActive = vusActive
  send({ type: 'tick', tick: cur })
  cur = fresh()
  sseEvents = 0
  sseBytes = 0
  sseReconnects = 0
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let k = 0
  await Promise.all(Array.from({ length: n }, async () => { while (k < items.length) await fn(items[k++]!) }))
}

send({ type: 'ready', pid: process.pid })
process.on('message', async (m: ToWorker) => {
  if (m.type === 'init') {
    init = m.init
    http = new Http(init.baseUrl)
  } else if (m.type === 'stop') {
    stopFlag = true
    for (const d of vuSse.values()) d()
  } else if (m.type === 'mark') {
    marks[m.kind] = m.t0
  } else if (m.type === 'go') {
    endAt = m.endAt
    peakAt = m.peakAt ?? 0
    peakWindowMs = m.peakWindowMs ?? 0
    const vus: Vu[] = init.users.map((u) => ({ i: u.i, token: u.token, offset: 0, studying: null, seen: {} }))
    const tmr = setInterval(flush, 1000)
    if (init.mode === 'seed') {
      await pool(vus, init.seedConcurrency, seedUser)
    } else {
      const wait = Math.max(0, m.startAt - Date.now())
      await sleep(wait)
      await Promise.all(
        vus.map((vu) => {
          // Participantes del pico: selección determinista; no son «actores» de fondo (su única sesión es la del pico).
          const peak = init.devTools && peakAt > 0 && (vu.i * 40503) % 1000 < init.peakFraction * 1000
          const actor = !peak && init.devTools && (vu.i * 7919) % 1000 < init.mix.actors * 1000
          return runVu(vu, rand(0, m.rampMs), actor, peak)
        }),
      )
      // cierra SSE
      for (const d of vuSse.values()) d()
      await sleep(300)
    }
    clearInterval(tmr)
    flush()
    send({ type: 'tokens', tokens })
    send({ type: 'done' })
    setTimeout(() => process.exit(0), 200)
  }
})
