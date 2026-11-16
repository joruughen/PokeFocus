/**
 * CLI de las pruebas de carga (siempre contra un servidor local propio con credenciales desechables; no admite --url).
 *   npx tsx scripts/load/run.ts smoke
 *   npx tsx scripts/load/run.ts run [--levels 100,1000,5000,10000] [--users N --ramp S --hold S]
 *   npx tsx scripts/load/run.ts report
 *
 * Opciones generales: --think ms, --study ms, --actors 0.1, --login-rate 0.002, --workers N, --pg-port, --port, --pg-image,
 *   --min-mem-mb 1500 (aborta la fase si la RAM libre baja de ese valor), --no-dev-tools, --keep, --tag nombre,
 *   --no-report (no regenera docs/load-report.md al terminar; útil en humos),
 *   --pg-stats (pg_stat_statements: vuelca las 15 consultas con más tiempo a results/<nivel>-queries.json; los escenarios lo activan solos,
 *   --no-pg-stats lo desactiva).
 *
 * Escenarios (--scenario steady|peak|event; por defecto steady = carga constante):
 *   peak   «Pico»: --peak-pct 30 (% de usuarios conectados que arrancan una sesión casi a la vez), --peak-at 20 (s tras acabar la rampa),
 *          --peak-window 8 (s en los que arrancan; las reclamaciones llegan ~--study ms después), --recover 60 (s de observación tras el pico).
 *          Necesita DEV_TOOLS (reloj de juego adelantado). La meseta se calcula sola salvo que pases --hold.
 *   event  «Evento publicado»: con todos conectados por SSE se publica un evento desde la API de administración del servidor de prueba
 *          (admin desechable + sudo) en --event-at 25 (s tras la rampa) y se anuncia a --event-gap 25 s; --recover 60. Mide el retraso de
 *          llegada del SSE (percentiles) y las peticiones que provoca (recarga de /content y /live-events).
 *
 * Base grande: --big-base N siembra por SQL hasta N usuarios registrados (dormidos, con ~30 Pokémon, puntuaciones y amistades) ANTES de
 *   la fase medida, p. ej. `--levels 5000 --big-base 100000`. Pesa unos GB en disco del contenedor (ver docs/server.md).
 *
 * Ver docs/server.md («Load tests») y docs/load-report.md.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { cpus, totalmem } from 'node:os'
import { announceEvent, prepareAdminEvent, publishEvent } from './adminEvent'
import { seedBigBase } from './bigbase'
import { runPhase } from './driver'
import { ROOT, removePg, startPg, startServer, type PgInfo, type ServerHandle } from './infra'
import { Sampler } from './sampler'
import type { BigBaseInfo, LevelResult, Mix, ScenarioKind } from './types'
import { writeReport } from './report'

interface Level { name: string; users: number; rampSec: number; holdSec: number }
export const LEVELS: Record<string, Level> = {
  smoke: { name: 'smoke', users: 40, rampSec: 5, holdSec: 20 },
  '100': { name: '100', users: 100, rampSec: 20, holdSec: 60 },
  '1000': { name: '1000', users: 1000, rampSec: 60, holdSec: 120 },
  '5000': { name: '5000', users: 5000, rampSec: 120, holdSec: 180 },
  '10000': { name: '10000', users: 10000, rampSec: 180, holdSec: 240 },
}

const DATA = join(ROOT, '.data/load')
const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const flag = (name: string) => process.argv.includes(`--${name}`)
const log = (s: string) => console.log(s)

const MIX: Mix = {
  actors: Number(arg('actors', process.argv[2] === 'smoke' ? '0.4' : '0.1')),
  loginPerIter: Number(arg('login-rate', process.argv[2] === 'smoke' ? '0.05' : '0.002')),
  weights: { game: 30, lbGlobal: 20, lbCountry: 10, lbFriends: 10, friends: 10, content: 15, config: 5 },
}

async function main() {
  const cmd = process.argv[2] ?? 'smoke'
  if (cmd === 'report') {
    writeReport(DATA)
    return
  }
  const base = arg('url')
  if (base) throw new Error('Esta herramienta solo lanza su propio servidor local; no admite --url (nunca contra producción).')
  const scenario = arg('scenario', 'steady') as ScenarioKind
  if (!['steady', 'peak', 'event'].includes(scenario)) throw new Error('--scenario debe ser steady, peak o event')
  const peakPct = Number(arg('peak-pct', '30')) / 100
  const peakAtSec = Number(arg('peak-at', '20'))
  const peakWindowSec = Number(arg('peak-window', '8'))
  const eventAtSec = Number(arg('event-at', '25'))
  const eventGapSec = Number(arg('event-gap', '25'))
  const recoverSec = Number(arg('recover', '60'))
  const bigBase = Number(arg('big-base', '0'))
  if (!(peakPct > 0 && peakPct <= 1)) throw new Error('--peak-pct debe estar entre 1 y 100')
  const names = cmd === 'smoke' ? ['smoke'] : (arg('levels', '100,1000') as string).split(',')
  const levels = names.map((n) => {
    const l = LEVELS[n] ?? { name: n, users: Number(n), rampSec: 30, holdSec: 60 }
    const tag = arg('tag')
    const suffix = [scenario !== 'steady' ? scenario : '', bigBase > 0 ? 'big' : '', tag ?? ''].filter(Boolean).join('-')
    // Los escenarios tienen su propia duración (calentamiento + suceso + recuperación) salvo que se fije --hold.
    const studyS = Number(arg('study', cmd === 'smoke' ? '1500' : '15000')) / 1000
    const autoHold = scenario === 'peak' ? peakAtSec + peakWindowSec + Math.ceil(1.3 * studyS) + 2 + recoverSec : scenario === 'event' ? eventAtSec + eventGapSec + recoverSec : l.holdSec
    return { ...l, name: suffix ? `${l.name}-${suffix}` : l.name, users: Number(arg('users', String(l.users))), rampSec: Number(arg('ramp', String(l.rampSec))), holdSec: Number(arg('hold', String(autoHold))) }
  })
  if (scenario !== 'steady' && flag('no-dev-tools') && scenario === 'peak') throw new Error('El escenario peak necesita DEV_TOOLS (quita --no-dev-tools)')
  const pgPort = Number(arg('pg-port', '55432'))
  const srvPort = Number(arg('port', '18787'))
  const image = arg('pg-image', 'postgres:16')!
  const devTools = !flag('no-dev-tools')
  const smoke = cmd === 'smoke'
  const thinkMs = Number(arg('think', smoke ? '1500' : '20000'))
  const studyMs = Number(arg('study', smoke ? '1500' : '15000'))
  const minMem = Number(arg('min-mem-mb', '1500'))
  const keepData = flag('keep')
  const maxWorkers = Number(arg('workers', String(Math.min(4, Math.max(1, Math.floor(cpus().length / 3))))))
  mkdirSync(join(DATA, 'results'), { recursive: true })

  let pg: PgInfo | null = null
  let srv: ServerHandle | null = null
  const cleanup = async () => {
    try { await srv?.stop() } catch { /* ya parado */ }
    if (!keepData) removePg()
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void cleanup().then(() => process.exit(130)))
  try {
    log(`Máquina: ${cpus().length} núcleos, ${(totalmem() / 2 ** 30).toFixed(1)} GB de RAM. Niveles: ${levels.map((l) => l.users).join(', ')}`)
    log(`Arrancando PostgreSQL (${image}) en el puerto ${pgPort}…`)
    const pgStats = flag('pg-stats') || (scenario !== 'steady' && !flag('no-pg-stats'))
    let bigInfo: BigBaseInfo | null = null
    pg = await startPg(pgPort, image, pgStats ? ['-c', 'shared_preload_libraries=pg_stat_statements', '-c', 'pg_stat_statements.track=all'] : [])
    const psql = (q: string) => execFileSync('docker', ['exec', 'pfload-pg', 'psql', '-U', 'postgres', '-d', 'pokefocus', '-h', '127.0.0.1', '-tAc', q], { encoding: 'utf8' }).trim()
    if (pgStats) psql('create extension if not exists pg_stat_statements')
    const tokens: Record<number, string> = {}
    const pepper = randomBytes(32).toString('base64url')
    for (const lv of levels) {
      log(`\n=== Nivel ${lv.name}: ${lv.users} usuarios virtuales (rampa ${lv.rampSec}s + ${lv.holdSec}s) ===`)
      srv = await startServer({ port: srvPort, databaseUrl: pg.url, logPath: join(DATA, `server-${lv.name}.log`), devTools, pepper })
      const targets = { serverPid: srv.pid, serverPort: srvPort, pgContainerId: pg.containerId, pgContainerPid: pg.containerPid, pgUrl: pg.url }
      const common = { baseUrl: srv.baseUrl, origin: srv.origin, mix: MIX, workers: maxWorkers, thinkMs, studyMs, devTools, targets, minMemAvailMb: minMem, log }
      // 1) Altas (solo las que faltan; los usuarios se reutilizan entre niveles de la misma ejecución)
      const all = Array.from({ length: lv.users }, (_, i) => ({ i, token: tokens[i] ?? null }))
      const missing = all.filter((u) => !u.token)
      let seed = null
      if (missing.length > 0) {
        log(`  Fase de altas: ${missing.length} usuarios nuevos (registro + createPlayer + una sesión en ~30 %)…`)
        const r = await runPhase({ ...common, mode: 'seed', users: missing, rampSec: 0, holdSec: 0, seedPlayFraction: 0.3 })
        Object.assign(tokens, r.tokens)
        seed = r.result
        log(`  altas: ${seed.total.n} peticiones en ${seed.durationSec}s (${seed.total.rps.toFixed(1)}/s), errores ${seed.total.err}`)
      }
      for (const u of all) u.token = tokens[u.i] ?? null
      const ready = all.filter((u) => u.token)
      if (ready.length < all.length) log(`  AVISO: ${all.length - ready.length} usuarios sin sesión tras las altas (límites o errores); la carga usa ${ready.length}`)
      // 1b) Base grande: usuarios dormidos sembrados por SQL (una sola vez por ejecución, antes de la fase medida)
      if (bigBase > 0 && !bigInfo) bigInfo = await seedBigBase(pg.url, bigBase, log)
      // 1c) Escenario «evento»: administrador desechable + borrador del evento (la publicación ocurre durante la fase)
      const admin = scenario === 'event' ? await prepareAdminEvent(srv.baseUrl, srv.origin, psql) : null
      // pg_stat_statements: solo la fase medida (sin altas ni siembra)
      if (pgStats) psql('select pg_stat_statements_reset()')
      // 2) Carga medida
      log(`  Fase de carga${scenario !== 'steady' ? ` (escenario ${scenario})` : ''}…`)
      const r = await runPhase({
        ...common, mode: 'run', users: ready, rampSec: lv.rampSec, holdSec: lv.holdSec, seedPlayFraction: 0,
        ...(scenario === 'peak' ? { peak: { pct: peakPct, atSec: peakAtSec, windowSec: peakWindowSec }, scenarioKind: 'peak' as const, scenarioParams: { peakPct: peakPct * 100, peakAtSec, peakWindowSec, recoverSec, studyMs } } : {}),
        ...(scenario === 'event' && admin
          ? {
              scenarioKind: 'event' as const,
              scenarioParams: { eventAtSec, eventGapSec, recoverSec },
              timed: [
                { atSec: eventAtSec, name: 'event.publish', mark: 'content' as const, run: () => publishEvent(admin) },
                { atSec: eventAtSec + eventGapSec, name: 'event.announce', mark: 'announce' as const, run: () => announceEvent(admin) },
              ],
            }
          : {}),
      })
      const sam = new Sampler({ ...targets, driverPids: () => [] })
      const db = await sam.dbStats()
      await sam.stop()
      await srv.stop()
      const logTxt = existsSync(srv.logPath) ? readFileSync(srv.logPath, 'utf8') : ''
      const res: LevelResult = {
        name: lv.name, users: ready.length, startedAt: new Date().toISOString(),
        params: { rampSec: lv.rampSec, holdSec: lv.holdSec, thinkMs, studyMs, actors: devTools ? MIX.actors : 0, loginPerIter: MIX.loginPerIter, workers: maxWorkers },
        seed, run: r.result, serverLogErrors: (logTxt.match(/unhandled error|\[server\].*failed/g) ?? []).length, db,
        ...(scenario !== 'steady' ? { scenario } : {}), ...(bigInfo ? { bigBase: bigInfo } : {}),
      }
      srv = null
      writeFileSync(join(DATA, 'results', `${lv.name}.json`), JSON.stringify(res))
      if (pgStats) {
        // Consultas que más tiempo de base consumieron en este nivel (sin las propias del muestreador).
        const top = psql(`select coalesce(json_agg(t), '[]') from (select calls, round(total_exec_time)::int as total_ms, round(mean_exec_time::numeric, 2) as mean_ms, rows, left(regexp_replace(query, '\\s+', ' ', 'g'), 400) as query from pg_stat_statements where query not like '%pg_stat%' order by total_exec_time desc limit 15) t`)
        writeFileSync(join(DATA, 'results', `${lv.name}-queries.json`), top)
      }
      const t = res.run.total
      log(`  RESULTADO ${lv.name}: ${t.rps.toFixed(0)} req/s, p50 ${t.p50.toFixed(0)} ms, p95 ${t.p95.toFixed(0)} ms, p99 ${t.p99.toFixed(0)} ms, errores ${(t.errRate * 100).toFixed(2)} %, SSE pico ${res.run.sse.peakOpen}${res.run.aborted ? ' (ABORTADO)' : ''}`)
    }
    if (!flag('no-report')) writeReport(DATA)
  } finally {
    await cleanup()
    log('Limpieza hecha (servidor de prueba, contenedor y volumen de PostgreSQL eliminados).')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
