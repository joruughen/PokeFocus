/**
 * Escenario «evento publicado»: usa la API de administración REAL del servidor de prueba.
 * Todo desechable: el administrador es una cuenta creada en la base temporal (rol `admin` puesto por SQL, porque no existe
 * un endpoint para ello), con la contraseña de prueba; el sudo se obtiene con POST /admin/reauth como en el panel.
 * No hay ADMIN_TOKEN ni credenciales reales en ningún sitio.
 */
import { Http } from './http'
import { PASSWORD } from './ids'

export interface AdminClient {
  http: Http
  headers: Record<string, string>
  eventId: string
}

const call = async (a: { http: Http; headers: Record<string, string> }, method: string, path: string, json?: unknown) => {
  const r = await a.http.request({ method, path, json, headers: a.headers, timeoutMs: 60_000 })
  if (r.status < 200 || r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${r.body.slice(0, 300)}`)
  return r
}

/** Crea el administrador desechable, entra en modo sudo y deja un evento en borrador listo para publicar. */
export async function prepareAdminEvent(baseUrl: string, origin: string, psql: (q: string) => string): Promise<AdminClient> {
  const http = new Http(baseUrl)
  const base = { origin, 'x-forwarded-for': '10.250.0.1' }
  const email = 'admin@load.test'
  const reg = await http.request({ method: 'POST', path: '/api/auth/register', headers: base, json: { email, password: PASSWORD, trainerName: 'LoadAdmin', country: 'ES' } })
  if (reg.status !== 201) throw new Error(`registro del administrador de prueba → ${reg.status} ${reg.body.slice(0, 200)}`)
  const m = /pf_session=([^;]+)/.exec(([] as string[]).concat(reg.headers['set-cookie'] ?? []).join(';'))
  if (!m) throw new Error('el registro del administrador no devolvió cookie')
  psql(`update users set role = 'admin' where email = '${email}'`)
  const headers = { ...base, cookie: `pf_session=${m[1]}` }
  const a = { http, headers }
  await call(a, 'POST', '/api/admin/reauth', { password: PASSWORD })
  const now = Date.now()
  const created = await call(a, 'POST', '/api/admin/events', {
    slug: `carga-evento-${now.toString(36)}`,
    name: { es: 'Evento de carga', en: 'Load test event' },
    description: { es: '**Pikachu** sale mucho más.\n- Más probabilidad de encontrarlo', en: '**Pikachu** shows up much more.\n- Higher chance to find it' },
    startsAt: now - 60_000,
    endsAt: now + 6 * 3600_000,
    overlay: { featured: [{ species: 'pikachu', weightMult: 3 }], shiny: { chance: 0.008, scope: 'featured' }, drops: [], missions: [] },
  })
  const id = (JSON.parse(created.body) as { event: { id: string } }).event.id
  return { http, headers, eventId: id }
}

const timed = async (fn: () => Promise<unknown>): Promise<number> => {
  const t = performance.now()
  await fn()
  return Math.round(performance.now() - t)
}

/** Publica el evento (el servidor recarga el contenido y emite SSE `content` a todos). Devuelve lo que tardó la llamada. */
export async function publishEvent(a: AdminClient): Promise<Record<string, number>> {
  const ms = await timed(() => call(a, 'POST', `/api/admin/events/${a.eventId}/publish`, { confirm: true }))
  return { adminCallMs: ms }
}

/** «Avisar a los jugadores»: SSE `event_announce` a todos. */
export async function announceEvent(a: AdminClient): Promise<Record<string, number>> {
  const ms = await timed(() => call(a, 'POST', `/api/admin/events/${a.eventId}/announce`, {}))
  return { adminCallMs: ms }
}
