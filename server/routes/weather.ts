/**
 * GET /api/weather — the weather the next session would use, for Settings and
 * the "conditions if you start now" preview. Same rule and cache as `start`.
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { resolveSessionWeather, type WeatherResponse } from '../../src/game/weather'
import { playerDocs } from '../db/schema'
import { requireAuth, type AppEnv, type Deps } from '../http'

export function weatherRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth(deps))

  app.get('/', async (c) => {
    const user = c.get('user')
    const [row] = await deps.db.select({ doc: playerDocs.doc }).from(playerDocs).where(eq(playerDocs.userId, user.id))
    const profile = row?.doc.player?.profile
    const city = profile?.city?.trim() || null
    const manual = profile?.weather ?? null
    const detected = await deps.weather.current(city)
    const { weather, source } = resolveSessionWeather(detected?.weather ?? null, manual, deps.env.devTools)
    const body: WeatherResponse = { city, detected, weather, source }
    return c.json(body)
  })

  return app
}
