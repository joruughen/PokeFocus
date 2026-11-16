/** Genera docs/load-report.md y los SVG de docs/load-charts/ a partir de .data/load/results/*.json. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { ROOT } from './infra'
import type { Sample } from './sampler'
import type { LevelResult } from './types'

const ORDER = (n: string) => (n === 'smoke' ? -1 : parseInt(n, 10) * 10 + (n.includes('-') ? 1 : 0) || 0)
const f = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '—')
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const p90 = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.9)]! : NaN)
const max = (a: number[]) => (a.length ? Math.max(...a) : NaN)
const COLORS = ['#1b6ca8', '#d95f02', '#1b9e77', '#7570b3', '#e6ab02', '#a6761d']

function steady(r: LevelResult): Sample[] {
  const from = r.params.rampSec
  const s = r.run.samples.filter((x) => x.t >= from)
  return s.length ? s : r.run.samples
}

interface Chart { log?: boolean; file: string; title: string; unit: string; pick: (r: LevelResult) => { x: number[]; y: number[] }[]; names?: string[] }

function sampleSeries(k: keyof Sample) {
  return (r: LevelResult) => [{ x: r.run.samples.map((s) => s.t), y: r.run.samples.map((s) => s[k] as number) }]
}

const CHARTS: Chart[] = [
  { file: 'rps', title: 'Peticiones por segundo', unit: 'req/s', pick: (r) => [{ x: r.run.series.t, y: r.run.series.rps }] },
  { log: true, file: 'lat-p95', title: 'Latencia p95 por segundo (escala logarítmica)', unit: 'ms', pick: (r) => [{ x: r.run.series.t, y: r.run.series.p95 }] },
  { log: true, file: 'lat-p50', title: 'Latencia p50 por segundo (escala logarítmica)', unit: 'ms', pick: (r) => [{ x: r.run.series.t, y: r.run.series.p50 }] },
  { log: true, file: 'lat-probe', title: '/api/health (sonda de 1 Hz, mide el retraso del bucle de eventos)', unit: 'ms', pick: (r) => [{ x: r.run.series.t, y: r.run.series.probeMs }] },
  { file: 'errors', title: 'Errores por segundo', unit: 'err/s', pick: (r) => [{ x: r.run.series.t, y: r.run.series.errPerSec }] },
  { file: 'sse', title: 'Conexiones SSE abiertas (cliente)', unit: 'conexiones', pick: (r) => [{ x: r.run.series.t, y: r.run.series.sseOpen }] },
  { file: 'srv-cpu', title: 'CPU del servidor Node (100 % = un núcleo)', unit: '%', pick: sampleSeries('srvCpu') },
  { file: 'srv-rss', title: 'RAM del servidor Node (RSS)', unit: 'MB', pick: sampleSeries('srvRssMb') },
  { file: 'srv-fds', title: 'Descriptores de fichero del servidor', unit: 'fd', pick: sampleSeries('srvFds') },
  { file: 'pg-cpu', title: 'CPU de PostgreSQL (100 % = un núcleo)', unit: '%', pick: sampleSeries('pgCpu') },
  { file: 'pg-mem', title: 'RAM de PostgreSQL (sin caché inactiva)', unit: 'MB', pick: sampleSeries('pgMemMb') },
  { file: 'pg-conns', title: 'Conexiones a PostgreSQL (totales)', unit: 'conexiones', pick: sampleSeries('pgConns') },
  { file: 'pg-active', title: 'Consultas activas en PostgreSQL', unit: 'consultas', pick: sampleSeries('pgActive') },
  { file: 'pg-tps', title: 'Transacciones por segundo en PostgreSQL', unit: 'tx/s', pick: sampleSeries('pgTps') },
  { file: 'net-http', title: 'Ancho de banda HTTP medido por el cliente (entrada+salida, sin SSE)', unit: 'MB/s', pick: (r) => [{ x: r.run.series.t, y: r.run.series.inMBs.map((v, i) => v + (r.run.series.outMBs[i] ?? 0)) }] },
  { file: 'net-pg', title: 'Red servidor ↔ PostgreSQL (entrada+salida del contenedor)', unit: 'KB/s', pick: (r) => [{ x: r.run.samples.map((s) => s.t), y: r.run.samples.map((s) => s.pgNetInKBs + s.pgNetOutKBs) }] },
  { file: 'driver-cpu', title: 'CPU del generador de carga (todos sus procesos)', unit: '%', pick: sampleSeries('driverCpu') },
]

function niceMax(v: number): number {
  if (!(v > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const m = v / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}

function svg(c: Chart, levels: LevelResult[]): string {
  const W = 760, L = 62, R = 16, T = 34, B = 48 + 18 * Math.ceil(levels.length / 4), H = T + 220 + B
  const series = levels.map((r) => c.pick(r)[0]!)
  const xmax = Math.max(1, ...series.map((s) => max(s.x)))
  const ymax = niceMax(Math.max(...series.map((s) => max(s.y.filter(Number.isFinite)) || 0)) * 1.05)
  const X = (v: number) => L + (v / xmax) * (W - L - R)
  const lmin = 0.1, lmax = Math.pow(10, Math.ceil(Math.log10(Math.max(1, ymax))))
  const Y = c.log ? (v: number) => T + (1 - (Math.log10(Math.max(v, lmin)) - Math.log10(lmin)) / (Math.log10(lmax) - Math.log10(lmin))) * (H - T - B) : (v: number) => T + (1 - v / ymax) * (H - T - B)
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,sans-serif" font-size="11">`, `<rect width="${W}" height="${H}" fill="#fff"/>`, `<text x="${L}" y="20" font-size="13" font-weight="600" fill="#111">${esc(c.title)} (${c.unit})</text>`]
  const ticks = c.log ? Array.from({ length: Math.round(Math.log10(lmax / lmin)) + 1 }, (_, i) => lmin * Math.pow(10, i)) : Array.from({ length: 5 }, (_, i) => (ymax * i) / 4)
  for (const v of ticks) {
    out.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e3e3e3"/>`, `<text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" fill="#444">${fmtTick(v)}</text>`)
  }
  for (let i = 0; i <= 5; i++) {
    const v = (xmax * i) / 5
    out.push(`<text x="${X(v)}" y="${H - B + 16}" text-anchor="middle" fill="#444">${Math.round(v)} s</text>`)
  }
  series.forEach((s, k) => {
    let d = ''
    let pen = false
    s.x.forEach((x, i) => {
      const y = s.y[i]!
      if (!Number.isFinite(y)) { pen = false; return }
      d += `${pen ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`
      pen = true
    })
    out.push(`<path d="${d}" fill="none" stroke="${COLORS[k % COLORS.length]}" stroke-width="1.8" stroke-linejoin="round"/>`)
  })
  levels.forEach((r, k) => {
    const x = L + (k % 4) * 170
    const y = H - 22 - 18 * (Math.ceil(levels.length / 4) - 1 - Math.floor(k / 4))
    out.push(`<rect x="${x}" y="${y}" width="14" height="4" fill="${COLORS[k % COLORS.length]}"/><text x="${x + 20}" y="${y + 5}" fill="#222">${r.name === 'smoke' ? 'humo' : label(r)} usuarios, ${r.params.thinkMs / 1000} s</text>`)
  })
  out.push('</svg>')
  return out.join('\n')
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const fmtTick = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : v >= 10 ? v.toFixed(0) : v.toFixed(1))

/** Usuarios activos en el primer segundo desde el que p95 > 500 ms durante 3 s seguidos (null = nunca). */
function saturationVus(r: LevelResult): number | null {
  const { p95, vus } = r.run.series
  for (let i = 0; i + 2 < p95.length; i++) if (p95[i]! > 500 && p95[i + 1]! > 500 && p95[i + 2]! > 500) return vus[i] ?? null
  return null
}
const label = (r: LevelResult) => r.users.toLocaleString('es-ES') + (r.name.includes('-') ? ` (${r.name.split('-').slice(1).join(' ')})` : '')

function bottleneck(r: LevelResult): string {
  const s = steady(r)
  const srv = avg(s.map((x) => x.srvCpu)), srv90 = p90(s.map((x) => x.srvCpu))
  const pg = avg(s.map((x) => x.pgCpu)), pg90 = p90(s.map((x) => x.pgCpu))
  const act = avg(s.map((x) => x.pgActive))
  const idleTx = max(s.map((x) => x.pgIdleTx ?? 0))
  const drv = avg(s.map((x) => x.driverCpu))
  const host = avg(s.map((x) => x.hostCpu))
  const probe95 = r.run.probe.p95
  const e = r.run.total.errRate
  const notes: string[] = []
  if (r.run.aborted) notes.push('fase abortada por falta de memoria del equipo')
  if (pg90 >= 150) notes.push(`CPU de PostgreSQL (media ${f(pg)} %, p90 ${f(pg90)} % de un núcleo; ${f(act, 1)} de 10 conexiones del pool activas de media)`)
  if (srv90 >= 85) notes.push(`CPU del proceso Node (p90 ${f(srv90)} %): un solo hilo de JavaScript`)
  if (idleTx >= 8) notes.push(`pool de conexiones bloqueado (${f(idleTx)} transacciones «idle in transaction» a la vez)`)
  if (probe95 > 250) notes.push(`el bucle de eventos se retrasa (health p95 ${f(probe95)} ms)`)
  if (e > 0.01) notes.push(`errores ${f(e * 100, 1)} % (tiempos agotados)`)
  if (drv >= 250 || host >= 85) notes.push(`el generador de carga o el equipo van justos (generador ${f(drv)} %, equipo ${f(host)} %): el resultado es pesimista`)
  return notes.length ? notes.join('; ') : `ninguno: hay holgura (Node ${f(srv)} %, PG ${f(pg)} %)`
}

// --- Escenarios (pico / evento publicado) -------------------------------------------------------------------------------

interface Win { rps: number; p95mean: number; p95max: number; probeMax: number; errors: number; srvCpu: number; srvCpuMax: number; srvRssMax: number; pgCpu: number; pgCpuMax: number; pgConnsMax: number; pgActiveMax: number; idleTxMax: number }

/** Métricas de la ventana [from, to) en segundos desde el inicio de la fase. */
function windowStats(r: LevelResult, from: number, to: number): Win {
  const se = r.run.series
  const idx = se.t.map((t, i) => (t >= from && t < to ? i : -1)).filter((i) => i >= 0)
  const off = r.run.scenario?.sampleOffsetSec ?? 0
  const sm = r.run.samples.filter((x) => x.t + off >= from && x.t + off < to)
  const p95 = idx.map((i) => se.p95[i]!).filter(Number.isFinite)
  return {
    rps: avg(idx.map((i) => se.rps[i]!)),
    p95mean: avg(p95), p95max: max(p95), probeMax: max(idx.map((i) => se.probeMs[i]!).filter(Number.isFinite)),
    errors: idx.reduce((a, i) => a + se.errPerSec[i]!, 0),
    srvCpu: avg(sm.map((x) => x.srvCpu)), srvCpuMax: max(sm.map((x) => x.srvCpu)), srvRssMax: max(sm.map((x) => x.srvRssMb)),
    pgCpu: avg(sm.map((x) => x.pgCpu)), pgCpuMax: max(sm.map((x) => x.pgCpu)), pgConnsMax: max(sm.map((x) => x.pgConns)), pgActiveMax: max(sm.map((x) => x.pgActive)), idleTxMax: max(sm.map((x) => x.pgIdleTx ?? 0)),
  }
}

const WIN_HEAD = ['| Ventana | req/s (media) | p95 por segundo (media / máx) ms | Sonda health máx ms | Errores | Node CPU (media / pico) | Node RAM máx | PG CPU (media / pico) | Conex. PG máx | Consultas activas PG máx | «idle in tx» máx |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
const winRow = (name: string, w: Win) => `| ${name} | ${f(w.rps)} | ${f(w.p95mean, 1)} / ${f(w.p95max, 1)} | ${f(w.probeMax, 1)} | ${f(w.errors)} | ${f(w.srvCpu)} % / ${f(w.srvCpuMax)} % | ${f(w.srvRssMax)} MB | ${f(w.pgCpu)} % / ${f(w.pgCpuMax)} % | ${f(w.pgConnsMax)} | ${f(w.pgActiveMax)} | ${f(w.idleTxMax)} |`

/** Segundos tras `from` hasta que el p95 por segundo vuelve (3 s seguidos) a ≤ 1,5× la línea base (con un mínimo de +50 ms). null = no se recupera. */
function recoverySec(r: LevelResult, from: number, baseP95: number): number | null {
  const se = r.run.series
  const lim = Math.max(baseP95 * 1.5, baseP95 + 50)
  for (let i = 0; i < se.t.length; i++) {
    if (se.t[i]! < from) continue
    if ([0, 1, 2].every((d) => !(se.p95[i + d]! > lim))) return se.t[i]! - from
  }
  return null
}

const opRow = (r: LevelResult, op: string) => {
  const v = r.run.ops[op]
  return v ? `| \`${op}\` | ${v.n} | ${v.err} | ${v.limited} | ${v.conflict} | ${f(v.p50, 1)} | ${f(v.p95, 1)} | ${f(v.p99, 1)} |` : null
}
const OP_HEAD = ['| Operación | Peticiones | Errores | 429 | Conflictos 409 | p50 ms | p95 ms | p99 ms |', '|---|---:|---:|---:|---:|---:|---:|---:|']

function scenarioSections(levels: LevelResult[]): string[] {
  const L: string[] = []
  const peaks = levels.filter((r) => r.run.scenario?.kind === 'peak')
  const events = levels.filter((r) => r.run.scenario?.kind === 'event')
  if (peaks.length) {
    L.push('## Escenario «pico» (muchos usuarios empiezan o reclaman una sesión a la vez)', '')
    L.push('Un porcentaje de los usuarios conectados (SSE abierto, actividad normal de fondo) arranca una sesión de estudio dentro de una ventana corta (p. ej. «a la hora en punto»); unos `--study` ms después la reclaman (el reloj de juego se adelanta con `x-dev-now`, la transacción es la real) y cierran el resultado. «Pico» = desde el inicio de la ventana hasta la última reclamación; «recuperación» = hasta que el p95 por segundo vuelve (3 s seguidos) a ≤ 1,5× el de la línea base.', '')
    for (const r of peaks) {
      const sc = r.run.scenario!
      const t0 = sc.marks.find((m) => m.name === 'peak.start')?.sec ?? 0
      const pr = sc.params
      const end = t0 + (pr.peakWindowSec ?? 8) + 1.3 * ((pr.studyMs ?? 15000) / 1000)
      const dur = r.run.series.t.length
      const base = windowStats(r, r.params.rampSec + 5, t0)
      const rec = recoverySec(r, end, base.p95mean)
      L.push(`### ${label(r)} usuarios · ${f(pr.peakPct ?? 0)} % en el pico (${Math.round(r.users * (pr.peakPct ?? 0) / 100)} usuarios, ventana ${f(pr.peakWindowSec ?? 0)} s, empieza en t=${f(t0)} s)${r.bigBase ? ` · base de ${r.bigBase.totalUsers.toLocaleString('es-ES')} usuarios` : ''}`, '')
      L.push(...WIN_HEAD, winRow('Línea base (antes del pico)', base), winRow(`Pico (t=${f(t0)}–${f(end)} s)`, windowStats(r, t0, end)), winRow(`Después (t=${f(end)}–${f(dur)} s)`, windowStats(r, end, dur + 1)), '')
      L.push(rec === null ? '**Recuperación:** el p95 no volvió a la línea base antes de terminar la fase.' : `**Recuperación:** el p95 vuelve a la línea base ${f(rec)} s después del fin del pico.`, '')
      L.push(...OP_HEAD)
      for (const op of ['game.start', 'game.claim', 'game.dismiss', 'game.get', 'lb.global', 'lb.country', 'lb.friends']) { const x = opRow(r, op); if (x) L.push(x) }
      L.push('')
    }
  }
  if (events.length) {
    L.push('## Escenario «evento publicado» (SSE a todos los conectados)', '')
    L.push('Con todos los usuarios conectados por SSE se publica un evento en vivo desde la API de administración del servidor de prueba (administrador desechable + sudo): el servidor recarga el contenido y emite `content` a todas las conexiones; más tarde se pulsa «avisar a los jugadores» (`event_announce`). Cada cliente, al recibir el aviso, recarga `/api/content` y `/api/live-events` como la app real. El **retraso** es el tiempo entre justo antes de enviar la petición de administración y la llegada del evento a cada cliente (incluye lo que tarda el propio servidor en publicar, que se muestra aparte).', '')
    for (const r of events) {
      const sc = r.run.scenario!
      const pub = sc.marks.find((m) => m.name === 'event.publish')
      const ann = sc.marks.find((m) => m.name === 'event.announce')
      const dur = r.run.series.t.length
      L.push(`### ${label(r)} usuarios conectados${r.bigBase ? ` · base de ${r.bigBase.totalUsers.toLocaleString('es-ES')} usuarios` : ''}`, '')
      L.push('| Aviso | Llamada de administración ms | Clientes alcanzados / conectados | Retraso p50 ms | p95 ms | p99 ms |', '|---|---:|---:|---:|---:|---:|')
      for (const [name, key, m] of [['`content` (publicar)', 'content', pub], ['`event_announce` (avisar)', 'announce', ann]] as const) {
        const v = r.run.ops[`sse.lat.${key}`]
        L.push(`| ${name} | ${m?.info?.adminCallMs ?? (m?.info?.error ? `error: ${m.info.error}` : '—')} | ${v ? `${v.n} / ${r.run.sse.peakOpen}` : `0 / ${r.run.sse.peakOpen}`} | ${f(v?.p50 ?? NaN, 1)} | ${f(v?.p95 ?? NaN, 1)} | ${f(v?.p99 ?? NaN, 1)} |`)
      }
      L.push('')
      if (pub) {
        const t = pub.sec
        L.push(...WIN_HEAD, winRow('Antes de publicar', windowStats(r, r.params.rampSec + 5, t)), winRow('Primeros 10 s tras publicar', windowStats(r, t, t + 10)), winRow('Siguientes 10 s', windowStats(r, t + 10, t + 20)), winRow('Primeros 10 s tras avisar', windowStats(r, ann?.sec ?? t + 25, (ann?.sec ?? t + 25) + 10)), winRow('Hasta el final', windowStats(r, (ann?.sec ?? t) + 10, dur + 1)), '')
      }
      L.push('Peticiones provocadas por el aviso:', '', ...OP_HEAD)
      for (const op of ['react.content', 'react.liveEvents', 'content.get', 'content.cond']) { const x = opRow(r, op); if (x) L.push(x) }
      L.push('', 'Las consultas de ranking no se disparan por el evento: la mezcla normal de fondo sigue ahí (`lb.*`); mira la tabla de consultas más costosas de este nivel por si el recálculo del contenido toca la base.', '')
    }
  }
  const bigs = levels.filter((r) => r.bigBase)
  if (bigs.length) {
    L.push('## Base grande (usuarios dormidos sembrados por SQL)', '')
    L.push('Antes de la fase medida se siembran usuarios «dormidos» (mismo hash de contraseña precalculado, ~30 Pokémon por documento, puntuaciones de la semana/mes actuales y anteriores, ≈8 amigos cada uno y 10 amigos dormidos por cada usuario activo) con inserciones masivas `generate_series`; luego `ANALYZE`. Los documentos son copias de uno real con variaciones mínimas, así que PostgreSQL los comprime mejor de lo que lo harían documentos reales: el tamaño en disco es una cota inferior.', '')
    L.push('| Nivel | Usuarios en la base | Dormidos | Siembra | Base (MB) | `users` | `player_docs` | `league_scores` | `friendships` |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|')
    for (const r of bigs) {
      const b = r.bigBase!
      const t = (k: string) => (b.tables[k] ? `${b.tables[k]!.rows.toLocaleString('es-ES')} filas / ${f(b.tables[k]!.mb)} MB` : '—')
      L.push(`| ${r.name} | ${b.totalUsers.toLocaleString('es-ES')} | ${b.sleepers.toLocaleString('es-ES')} | ${b.seconds} s | ${f(b.dbSizeMb)} | ${t('users')} | ${t('player_docs')} | ${t('league_scores')} | ${t('friendships')} |`)
    }
    L.push('')
  }
  return L
}

/** Las 10 consultas con mayor tiempo total de cada nivel (results/<nivel>-queries.json, de `--pg-stats`). */
function queriesSection(dir: string, levels: LevelResult[]): string[] {
  const L: string[] = []
  for (const r of levels) {
    const file = join(dir, `${r.name}-queries.json`)
    if (!existsSync(file)) continue
    let rows: { calls: number; total_ms: number; mean_ms: number; rows: number; query: string }[]
    try { rows = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
    if (!rows.length) continue
    if (!L.length) L.push('## Consultas más costosas de PostgreSQL (`pg_stat_statements`)', '', 'Solo la fase de carga medida (se reinicia el contador tras las altas y la siembra). Ordenadas por tiempo total en la base; `rows` = filas devueltas o afectadas en total. Los parámetros aparecen como `$n`. Se generan con `--pg-stats` (los escenarios lo activan solos).', '')
    L.push(`### ${label(r)} usuarios (${r.name})`, '', '| # | Llamadas | Tiempo total ms | Medio ms | Filas | Consulta |', '|---:|---:|---:|---:|---:|---|')
    rows.sort((a, b) => b.total_ms - a.total_ms).slice(0, 10).forEach((q, i) => {
      const text = q.query.replace(/\s+/g, ' ').replace(/\|/g, '\\|').replace(/`/g, "'")
      L.push(`| ${i + 1} | ${q.calls.toLocaleString('es-ES')} | ${q.total_ms.toLocaleString('es-ES')} | ${f(q.mean_ms, 2)} | ${q.rows.toLocaleString('es-ES')} | \`${text.length > 220 ? text.slice(0, 220) + '…' : text}\` |`)
    })
    L.push('')
  }
  return L
}

export function writeReport(dataDir: string): void {
  const dir = join(dataDir, 'results')
  if (!existsSync(dir)) {
    console.log('No hay resultados en', dir)
    return
  }
  const all = readdirSync(dir).filter((x) => x.endsWith('.json') && !x.endsWith('-queries.json')).map((x) => JSON.parse(readFileSync(join(dir, x), 'utf8')) as LevelResult).sort((a, b) => ORDER(a.name) - ORDER(b.name))
  const levels = all.filter((r) => r.name !== 'smoke')
  if (levels.length === 0) levels.push(...all)
  const chartsDir = join(ROOT, 'docs/load-charts')
  mkdirSync(chartsDir, { recursive: true })
  for (const c of CHARTS) writeFileSync(join(chartsDir, `${c.file}.svg`), svg(c, levels))

  const L: string[] = []
  const when = levels.map((r) => r.startedAt).sort()[0]?.slice(0, 10) ?? ''
  L.push('# Informe de pruebas de carga', '')
  L.push(`Generado por \`scripts/load/\` (ver \`docs/server.md\`, sección «Load tests»). Fecha de las mediciones: ${when}.`, '')
  L.push(`**Máquina de prueba:** ${cpus().length} núcleos (${cpus()[0]?.model.trim()}), ${(totalmem() / 2 ** 30).toFixed(1)} GB de RAM; **el generador de carga, el servidor, PostgreSQL y las demás aplicaciones del equipo comparten esa máquina** (había ~8 GB ocupados por otros procesos). Es un banco de pruebas pesimista para el servidor porque el cliente de carga le quita CPU, y optimista en red (todo va por loopback, sin latencia ni límites de ancho de banda reales).`, '')
  const p = levels[0]?.params
  L.push('## Qué se mide y cómo', '')
  L.push('- Servidor de PokeFocus **local** (`node server/index.ts`, puerto 18787, `NODE_ENV=development` con `DEV_TOOLS=1`) contra **PostgreSQL 16 en docker** (puerto 55432, volumen temporal). Producción usa PostgreSQL 17 con la imagen `pokefocus-app`; el código es el mismo.')
  L.push('- `DEV_TOOLS=1` es necesario porque el servidor decide los minutos de estudio con su reloj y la sesión mínima dura 15 min: los usuarios «que estudian» adelantan su reloj de juego con la cabecera `x-dev-now` (el servidor ejecuta exactamente el mismo reductor, la transacción y los espejos de ranking) en vez de esperar. `DEV_TOOLS` no activa ningún otro camino de coste relevante. En producción está desactivado.')
  L.push('- Límites de uso **activos** (`server/rate-limit.ts`): con `TRUST_PROXY=1` el servidor toma la IP del último salto de `X-Forwarded-For` y cada usuario virtual envía su propia IP (10.x.y.z), exactamente como lo haría un proxy inverso con miles de clientes distintos. Cada usuario tiene su propio email, así que tampoco se acumulan los límites por email.')
  L.push('- Cada usuario virtual mantiene abierta su conexión SSE (`/api/events`), pide estado de juego/rankings/amigos/contenido/config cada ~' + ((p?.thinkMs ?? 20000) / 1000) + ' s (±50 %), el ' + f((p?.actors ?? 0.1) * 100) + ' % además estudia en bucle (start → claim → dismissResults; ~' + ((p?.studyMs ?? 15000) / 1000) + ' s entre start y claim) y una pequeña fracción inicia sesión de nuevo (`POST /auth/login`, scrypt). Mezcla de consultas: estado 30 %, ranking global 20 %, país 10 %, amigos 10 %, lista de amigos 10 %, contenido 15 % (la mitad con `If-None-Match`), config 5 %; semanal 70 % / mensual 30 %.')
  L.push('- Antes de cada nivel hay una **fase de altas** (registro por la API real + `createPlayer` + una sesión cerrada en el ~30 % para que los rankings tengan filas). Los usuarios se reutilizan entre niveles de la misma ejecución, de modo que la base crece de nivel en nivel.')
  L.push('- Latencias (p50/p95/p99) = de toda la fase de carga (rampa + meseta) y de todas las peticiones salvo las conexiones SSE. Peticiones/s, CPU, RAM, conexiones y ancho de banda = media en la **meseta** (con todos los usuarios activos) y máximo.')
  L.push('- Errores = respuestas 5xx, 4xx inesperadas, tiempos agotados (30 s) y 429 (límite de uso). Los 409 de acciones se cuentan aparte como «conflictos».', '')

  L.push('## Resumen por nivel de carga', '')
  L.push('| Usuarios | Rampa+meseta | p95 > 0,5 s desde | req/s (meseta) | p50 ms | p95 ms | p99 ms | Errores | SSE pico | Node CPU (media / pico) | Node RAM máx | PG CPU (media / pico) | PG RAM máx | Conex. PG (máx) | HTTP MB/s (media) | Cuello de botella |')
  L.push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|')
  for (const r of levels) {
    const s = steady(r)
    const t = r.run.total
    const from = r.params.rampSec
    const rps = avg(r.run.series.rps.filter((_, i) => r.run.series.t[i]! >= from))
    const bw = avg(r.run.series.inMBs.map((v, i) => v + (r.run.series.outMBs[i] ?? 0)).filter((_, i) => r.run.series.t[i]! >= from))
    const sv = saturationVus(r)
    L.push(`| ${label(r)}${r.run.aborted ? ' (abortado)' : ''} | ${r.params.rampSec}+${r.params.holdSec} s | ${sv === null ? 'nunca' : `${sv.toLocaleString('es-ES')} usuarios`} | ${f(rps)} | ${f(t.p50, 1)} | ${f(t.p95, 1)} | ${f(t.p99, 1)} | ${f(t.errRate * 100, 2)} % | ${r.run.sse.peakOpen} | ${f(avg(s.map((x) => x.srvCpu)))} % / ${f(max(s.map((x) => x.srvCpu)))} % | ${f(max(s.map((x) => x.srvRssMb)))} MB | ${f(avg(s.map((x) => x.pgCpu)))} % / ${f(max(s.map((x) => x.pgCpu)))} % | ${f(max(s.map((x) => x.pgMemMb)))} MB | ${f(max(s.map((x) => x.pgConns)))} | ${f(bw, 2)} | ${bottleneck(r)} |`)
  }
  L.push('', 'CPU: 100 % = un núcleo completo (el servidor Node usa un hilo de JavaScript más el pool de 4 hilos de libuv, que hace el scrypt de registro/login, así que puede superar el 100 %).', '')

  L.push('## Más detalle por nivel', '')
  L.push('| Usuarios | Sonda /api/health p50/p95/p99 ms | Descriptores del servidor (máx) | Hilos | TCP establecidas (máx) | Red PG ↔ servidor (media KB/s) | CPU generador (media) | CPU equipo (media) | RAM libre del equipo (mín) | Base (MB) | Usuarios en la base | Eventos SSE recibidos | Reconexiones SSE | Errores en el log del servidor | «idle in transaction» (máx) |')
  L.push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const r of levels) {
    const s = steady(r)
    L.push(`| ${label(r)} | ${f(r.run.probe.p50, 1)} / ${f(r.run.probe.p95, 1)} / ${f(r.run.probe.p99, 1)} | ${f(max(s.map((x) => x.srvFds)))} | ${f(max(s.map((x) => x.srvThreads)))} | ${f(max(s.map((x) => x.tcpEst)))} | ${f(avg(s.map((x) => x.pgNetInKBs + x.pgNetOutKBs)))} | ${f(avg(s.map((x) => x.driverCpu)))} % | ${f(avg(s.map((x) => x.hostCpu)))} % | ${f(Math.min(...r.run.samples.map((x) => x.hostMemAvailMb)))} MB | ${f(r.db.sizeMb, 0)} | ${r.db.users} | ${r.run.sse.events} | ${r.run.sse.reconnects} | ${r.serverLogErrors} | ${f(max(s.map((x) => x.pgIdleTx ?? 0)))} |`)
  }
  L.push('')
  for (const r of levels) if (r.run.pgDiag?.length) L.push(`Diagnóstico del bloqueo (${r.name}): ` + r.run.pgDiag.slice(0, 3).map((d) => `\`${d.replace(/`/g, "'")}\``).join('; '), '')

  for (const r of levels) {
    L.push(`### Latencia por operación — ${label(r)} usuarios`, '')
    L.push('| Operación | Peticiones | Errores | 429 | Conflictos 409 | p50 ms | p95 ms | p99 ms |', '|---|---:|---:|---:|---:|---:|---:|---:|')
    for (const [op, v] of Object.entries(r.run.ops).sort()) L.push(`| \`${op}\` | ${v.n} | ${v.err} | ${v.limited} | ${v.conflict} | ${f(v.p50, 1)} | ${f(v.p95, 1)} | ${f(v.p99, 1)} |`)
    if (r.run.errSamples.length) L.push('', 'Ejemplos de error: ' + r.run.errSamples.slice(0, 5).map((e) => `\`${e.replace(/`/g, "'")}\``).join(', '))
    L.push('')
  }

  L.push('## Fase de altas (registro + primera partida)', '')
  L.push('Cada alta hace un `scrypt` (N=2^15, 32 MiB y ~100 ms de CPU en el pool de 4 hilos de libuv): el registro y el inicio de sesión son las operaciones más caras del servidor.', '')
  L.push('| Nivel | Altas | Duración | Peticiones/s | Errores | register p50 / p95 ms | game.start p95 ms | game.claim p95 ms | CPU Node media | CPU PG media |', '|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|')
  for (const r of levels) {
    const sd = r.seed
    if (!sd) continue
    const reg = sd.ops['auth.register']
    L.push(`| ${r.name} | ${reg?.ok ?? 0} | ${sd.durationSec} s | ${f(sd.total.rps, 1)} | ${f(sd.total.errRate * 100, 2)} % | ${f(reg?.p50 ?? NaN)} / ${f(reg?.p95 ?? NaN)} | ${f(sd.ops['game.start']?.p95 ?? NaN)} | ${f(sd.ops['game.claim']?.p95 ?? NaN)} | ${f(avg(sd.samples.map((x) => x.srvCpu)))} % | ${f(avg(sd.samples.map((x) => x.pgCpu)))} % |`)
  }
  L.push('')
  L.push(...scenarioSections(levels))
  L.push(...queriesSection(dir, levels))
  L.push('## Gráficas', '', 'Una gráfica por métrica, una línea por nivel de carga (eje X = segundos desde que empieza la fase de carga; la rampa de entrada ocupa los primeros segundos de cada nivel).', '')
  for (const c of CHARTS) L.push(`![${c.title}](load-charts/${c.file}.svg)`, '')

  const concl = join(ROOT, 'scripts/load/conclusions.md')
  if (existsSync(concl)) L.push(readFileSync(concl, 'utf8').trim(), '')
  else L.push('## Conclusiones', '', '(pendiente de redactar: `scripts/load/conclusions.md`)', '')
  writeFileSync(join(ROOT, 'docs/load-report.md'), L.join('\n'))
  console.log('Informe: docs/load-report.md y docs/load-charts/*.svg')
}
