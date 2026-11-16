/** Cliente HTTP mínimo sobre node:http (keep-alive), sin dependencias: mide latencia y bytes. */
import http from 'node:http'

export interface Res {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
  ms: number
  bytesIn: number
  bytesOut: number
  /** Error de red/timeout (status 0). */
  error?: string
}

export interface ReqOpts {
  method?: string
  path: string
  headers?: Record<string, string>
  json?: unknown
  timeoutMs?: number
}

export class Http {
  readonly agent: http.Agent
  readonly host: string
  readonly port: number
  constructor(baseUrl: string) {
    const u = new URL(baseUrl)
    this.host = u.hostname
    this.port = Number(u.port || 80)
    this.agent = new http.Agent({ keepAlive: true, maxSockets: Infinity, maxFreeSockets: 256 })
  }

  request(o: ReqOpts): Promise<Res> {
    const t0 = performance.now()
    const payload = o.json !== undefined ? Buffer.from(JSON.stringify(o.json)) : null
    const headers: Record<string, string | number> = { ...(o.headers ?? {}) }
    if (payload) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = payload.length
    }
    return new Promise((resolve) => {
      let done = false
      const finish = (r: Omit<Res, 'ms'>) => {
        if (done) return
        done = true
        resolve({ ...r, ms: performance.now() - t0 })
      }
      const req = http.request({ host: this.host, port: this.port, method: o.method ?? 'GET', path: o.path, headers, agent: this.agent }, (res) => {
        const chunks: Buffer[] = []
        let n = 0
        res.on('data', (c: Buffer) => {
          chunks.push(c)
          n += c.length
        })
        res.on('end', () => {
          const headBytes = res.rawHeaders.reduce((a, h) => a + h.length + 2, 0) + 20
          finish({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), bytesIn: n + headBytes, bytesOut: reqBytes(o, payload) })
        })
        res.on('error', (e) => finish({ status: 0, headers: {}, body: '', bytesIn: 0, bytesOut: 0, error: e.message }))
      })
      req.setTimeout(o.timeoutMs ?? 30_000, () => {
        req.destroy(new Error('timeout'))
      })
      req.on('error', (e) => finish({ status: 0, headers: {}, body: '', bytesIn: 0, bytesOut: 0, error: e.message }))
      if (payload) req.write(payload)
      req.end()
    })
  }
}

function reqBytes(o: ReqOpts, payload: Buffer | null): number {
  const h = Object.entries(o.headers ?? {}).reduce((a, [k, v]) => a + k.length + v.length + 4, 0)
  return o.path.length + 40 + h + (payload?.length ?? 0)
}
