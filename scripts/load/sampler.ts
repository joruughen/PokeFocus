/**
 * Muestreador de recursos (lee /proc y los cgroups; sin herramientas externas):
 *  - proceso del servidor: CPU (% de un núcleo), RSS, descriptores de fichero, hilos, conexiones TCP al puerto;
 *  - contenedor de PostgreSQL: CPU y memoria (cgroup v2), red (/proc/<pid>/net/dev del contenedor),
 *    conexiones y transacciones/s (pg_stat_*);
 *  - el propio generador de carga (para saber si él es el límite) y el host (CPU total, memoria disponible).
 */
import { readFileSync, readdirSync } from 'node:fs'
import postgres from 'postgres'

export interface Sample {
  /** Segundos desde el inicio de la fase medida. */
  t: number
  srvCpu: number
  srvRssMb: number
  srvFds: number
  srvThreads: number
  tcpEst: number
  pgCpu: number
  pgMemMb: number
  pgNetInKBs: number
  pgNetOutKBs: number
  pgConns: number
  pgActive: number
  /** Conexiones «idle in transaction»: una transacción abierta que no hace nada (si son todas las del pool, el servidor está bloqueado). */
  pgIdleTx: number
  pgTps: number
  driverCpu: number
  hostCpu: number
  hostMemAvailMb: number
}

export interface SamplerTargets {
  serverPid: number
  serverPort: number
  pgContainerId: string
  pgContainerPid: number
  pgUrl: string
  /** PIDs de los procesos del generador de carga (dinámico: los workers). */
  driverPids: () => number[]
}

const TICK = 100 // CLK_TCK en Linux
const PAGE = 4096

const readNum = (path: string): number => Number(readFileSync(path, 'utf8').trim())

function procCpuSec(pid: number): number {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const f = s.slice(s.lastIndexOf(')') + 2).split(' ')
    return (Number(f[11]) + Number(f[12])) / TICK // utime + stime (campos 14 y 15)
  } catch {
    return 0
  }
}

function procStat(pid: number): { rssMb: number; threads: number } {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const f = s.slice(s.lastIndexOf(')') + 2).split(' ')
    return { rssMb: (Number(f[21]) * PAGE) / 1048576, threads: Number(f[17]) }
  } catch {
    return { rssMb: 0, threads: 0 }
  }
}

function tcpEstablished(port: number): number {
  const hex = port.toString(16).toUpperCase().padStart(4, '0')
  let n = 0
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let txt = ''
    try {
      txt = readFileSync(f, 'utf8')
    } catch {
      continue
    }
    for (const line of txt.split('\n')) {
      const c = line.trim().split(/\s+/)
      // c[1] = local_address:port, c[3] = estado (01 = ESTABLISHED)
      if (c[3] === '01' && c[1]?.endsWith(`:${hex}`)) n++
    }
  }
  return n
}

function hostCpuTimes(): { busy: number; total: number } {
  const l = readFileSync('/proc/stat', 'utf8').split('\n')[0]!.split(/\s+/).slice(1).map(Number)
  const idle = (l[3] ?? 0) + (l[4] ?? 0)
  const total = l.reduce((a, b) => a + b, 0)
  return { busy: total - idle, total }
}

function memAvailMb(): number {
  const m = /MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))
  return m ? Number(m[1]) / 1024 : 0
}

function netDev(pid: number): { rx: number; tx: number } {
  try {
    const line = readFileSync(`/proc/${pid}/net/dev`, 'utf8').split('\n').find((l) => l.trim().startsWith('eth0:'))
    const c = line!.trim().split(/\s+/)
    return { rx: Number(c[1]), tx: Number(c[9]) }
  } catch {
    return { rx: 0, tx: 0 }
  }
}

export class Sampler {
  readonly samples: Sample[] = []
  /** Consultas de las conexiones «idle in transaction» la primera vez que hay ≥ 8 (diagnóstico de bloqueos). */
  readonly diag: string[] = []
  private timer: NodeJS.Timeout | null = null
  private sql: ReturnType<typeof postgres>
  private cg: string
  private prev: { at: number; srv: number; pg: number; drv: number; host: { busy: number; total: number }; net: { rx: number; tx: number }; xact: number } | null = null
  private t0 = 0
  private busy = false

  private tg: SamplerTargets
  private intervalMs: number

  constructor(tg: SamplerTargets, intervalMs = 2000) {
    this.tg = tg
    this.intervalMs = intervalMs
    this.sql = postgres(tg.pgUrl, { max: 1, onnotice: () => {}, idle_timeout: 0, connect_timeout: 10 })
    this.cg = `/sys/fs/cgroup/system.slice/docker-${tg.pgContainerId}.scope`
  }

  private async pgInfo(): Promise<{ conns: number; active: number; idleTx: number; xact: number }> {
    try {
      const r = await this.sql`
        select (select count(*) from pg_stat_activity where datname = 'pokefocus' and pid <> pg_backend_pid())::int as conns,
               (select count(*) from pg_stat_activity where datname = 'pokefocus' and state = 'active' and pid <> pg_backend_pid())::int as active,
               (select count(*) from pg_stat_activity where datname = 'pokefocus' and state like 'idle in transaction%')::int as idle_tx,
               (select xact_commit + xact_rollback from pg_stat_database where datname = 'pokefocus')::float8 as xact`
      if (r[0]!.idle_tx >= 8 && this.diag.length === 0) {
        const q = await this.sql`select state, wait_event_type, wait_event, left(query, 140) as query from pg_stat_activity where datname = 'pokefocus' and state like 'idle in transaction%' limit 10`
        for (const x of q) this.diag.push(`${x.state} / ${x.wait_event_type ?? '-'}:${x.wait_event ?? '-'} / ${x.query}`)
      }
      return { conns: r[0]!.conns, active: r[0]!.active, idleTx: r[0]!.idle_tx, xact: r[0]!.xact }
    } catch {
      return { conns: 0, active: 0, idleTx: 0, xact: 0 }
    }
  }

  private async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const now = performance.now()
      const srv = procCpuSec(this.tg.serverPid)
      const drv = this.tg.driverPids().reduce((a, p) => a + procCpuSec(p), 0)
      let pg = 0
      let pgMem = 0
      try {
        const cpu = readFileSync(`${this.cg}/cpu.stat`, 'utf8')
        pg = Number(/usage_usec (\d+)/.exec(cpu)![1]) / 1e6
        const stat = readFileSync(`${this.cg}/memory.stat`, 'utf8')
        const inactive = Number(/^inactive_file (\d+)/m.exec(stat)?.[1] ?? 0)
        pgMem = (readNum(`${this.cg}/memory.current`) - inactive) / 1048576 // como docker stats: sin caché inactiva
      } catch {
        /* sin cgroup legible: queda a 0 y el informe lo avisa */
      }
      const host = hostCpuTimes()
      const net = netDev(this.tg.pgContainerPid)
      const info = await this.pgInfo()
      const st = procStat(this.tg.serverPid)
      let fds = 0
      try {
        fds = readdirSync(`/proc/${this.tg.serverPid}/fd`).length
      } catch {
        /* proceso terminado */
      }
      const p = this.prev
      if (p) {
        const dt = (now - p.at) / 1000
        this.samples.push({
          t: (now - this.t0) / 1000,
          srvCpu: ((srv - p.srv) / dt) * 100,
          srvRssMb: st.rssMb,
          srvFds: fds,
          srvThreads: st.threads,
          tcpEst: tcpEstablished(this.tg.serverPort),
          pgCpu: ((pg - p.pg) / dt) * 100,
          pgMemMb: pgMem,
          pgNetInKBs: (net.rx - p.net.rx) / 1024 / dt,
          pgNetOutKBs: (net.tx - p.net.tx) / 1024 / dt,
          pgConns: info.conns,
          pgActive: info.active,
          pgIdleTx: info.idleTx,
          pgTps: (info.xact - p.xact) / dt,
          driverCpu: Math.max(0, ((drv - p.drv) / dt) * 100),
          hostCpu: ((host.busy - p.host.busy) / Math.max(1, host.total - p.host.total)) * 100,
          hostMemAvailMb: memAvailMb(),
        })
      }
      this.prev = { at: now, srv, pg, drv, host, net, xact: info.xact }
    } finally {
      this.busy = false
    }
  }

  start(): void {
    this.t0 = performance.now()
    this.prev = null
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    await this.sql.end({ timeout: 3 })
  }

  /** Tamaño de la base y número de filas aproximadas, para el informe. */
  async dbStats(): Promise<{ sizeMb: number; users: number }> {
    const s = postgres(this.tg.pgUrl, { max: 1, onnotice: () => {} })
    try {
      const r = await s`select (pg_database_size('pokefocus') / 1048576.0)::float8 as mb, (select count(*) from users)::int as users`
      return { sizeMb: r[0]!.mb, users: r[0]!.users }
    } finally {
      await s.end({ timeout: 3 })
    }
  }
}
