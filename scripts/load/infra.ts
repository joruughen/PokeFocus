/**
 * Infraestructura de la prueba: PostgreSQL en docker (puerto y volumen propios) y el servidor local
 * de PokeFocus en otro puerto, con entorno limpio (NO hereda el .env del proyecto ni variables del shell).
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const ROOT = resolve(import.meta.dirname, '../..')
export const CONTAINER = 'pfload-pg'
export const VOLUME = 'pfload-pgdata'
export const PG_PASSWORD = randomBytes(12).toString('hex')

export interface PgInfo {
  url: string
  port: number
  containerId: string
  containerPid: number
}

const sh = (cmd: string, args: string[], quiet = false) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    if (quiet) return ''
    throw e
  }
}

export function removePg(): void {
  sh('docker', ['rm', '-f', '-v', CONTAINER], true)
  sh('docker', ['volume', 'rm', '-f', VOLUME], true)
}

export async function startPg(port: number, image: string, extraArgs: string[] = []): Promise<PgInfo> {
  removePg()
  // Volumen con nombre (se borra al terminar), en 127.0.0.1 y en un puerto distinto del 5432.
  sh('docker', ['run', '-d', '--name', CONTAINER, '-e', `POSTGRES_PASSWORD=${PG_PASSWORD}`, '-e', 'POSTGRES_DB=pokefocus', '-v', `${VOLUME}:/var/lib/postgresql/data`, '-p', `127.0.0.1:${port}:5432`, image, ...extraArgs])
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    if (sh('docker', ['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-d', 'pokefocus', '-h', '127.0.0.1'], true).includes('accepting')) {
      // pg_isready responde también durante el arranque temporal del initdb: espera a que acepte SQL por el puerto publicado.
      if (sh('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'pokefocus', '-h', '127.0.0.1', '-tAc', 'select 1'], true) === '1') {
        return {
          url: `postgres://postgres:${PG_PASSWORD}@127.0.0.1:${port}/pokefocus`,
          port,
          containerId: sh('docker', ['inspect', '-f', '{{.Id}}', CONTAINER]),
          containerPid: Number(sh('docker', ['inspect', '-f', '{{.State.Pid}}', CONTAINER])),
        }
      }
    }
  }
  throw new Error('PostgreSQL no arrancó en 60 s')
}

export interface ServerHandle {
  proc: ChildProcess
  pid: number
  baseUrl: string
  origin: string
  stop(): Promise<void>
  logPath: string
  workdir: string
}

export interface ServerOpts {
  port: number
  databaseUrl: string
  logPath: string
  /** Con DEV_TOOLS=1 el servidor acepta x-dev-now (necesario para reclamar sesiones sin esperar 15+ min reales). */
  devTools: boolean
  /** Pepper desechable de TODA la ejecución: el mismo para todos los reinicios del servidor (si cambia, nadie puede iniciar sesión). */
  pepper: string
  nodeOptions?: string
}

export async function startServer(o: ServerOpts): Promise<ServerHandle> {
  // cwd vacío: server/index.ts hace process.loadEnvFile('.env') y no queremos el .env real del proyecto.
  const workdir = mkdtempSync(join(tmpdir(), 'pfload-srv-'))
  mkdirSync(join(workdir, 'uploads'))
  const origin = 'http://localhost:5173'
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: workdir,
    NODE_ENV: 'development',
    // En producción el caché del ranking está activo (10 s); aquí NODE_ENV es development, así que se fija igual.
    LEADERBOARD_CACHE_MS: '10000',
    PORT: String(o.port),
    DATABASE_URL: o.databaseUrl,
    APP_ORIGIN: origin,
    DEV_TOOLS: o.devTools ? '1' : '0',
    // Detrás de un proxy: la IP del cliente es el último salto de X-Forwarded-For. Los límites siguen ACTIVOS;
    // cada usuario virtual manda su propia IP (así se distribuye la carga sin desactivar nada).
    TRUST_PROXY: '1',
    UPLOADS_DIR: join(workdir, 'uploads'),
    // Pepper desechable de esta ejecución de prueba (nunca el de producción).
    PASSWORD_PEPPER: o.pepper,
  }
  if (o.nodeOptions) env.NODE_OPTIONS = o.nodeOptions
  const loader = pathToFileURL(join(ROOT, 'node_modules/tsx/dist/loader.mjs')).href
  const log = createWriteStream(o.logPath)
  const proc = spawn(process.execPath, ['--import', loader, join(ROOT, 'server/index.ts')], { cwd: workdir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout!.pipe(log)
  proc.stderr!.pipe(log)
  const baseUrl = `http://127.0.0.1:${o.port}`
  let exited = false
  proc.on('exit', () => (exited = true))
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (exited) throw new Error(`El servidor terminó al arrancar (mira ${o.logPath})`)
    try {
      const r = await fetch(`${baseUrl}/api/health`)
      if (r.ok) break
    } catch {
      /* aún no escucha */
    }
    if (i === 119) throw new Error('El servidor no respondió en 60 s')
  }
  return {
    proc,
    pid: proc.pid!,
    baseUrl,
    origin,
    logPath: o.logPath,
    workdir,
    async stop() {
      if (!exited) {
        proc.kill('SIGTERM')
        await new Promise<void>((r) => {
          const t = setTimeout(() => {
            proc.kill('SIGKILL')
            r()
          }, 5000)
          proc.on('exit', () => {
            clearTimeout(t)
            r()
          })
        })
      }
      log.end()
      rmSync(workdir, { recursive: true, force: true })
    },
  }
}
