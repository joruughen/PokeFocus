/**
 * GET /api/config — public (no session), tiny: what the server can do that the
 * client has to know before showing a feature. Today only `devTools`, so the
 * developer panel (`?dev`) can tell a server that ignores `x-dev-now` and the
 * `dev*` actions (production, Docker, `npm start`) from a development one.
 */
import { Hono } from 'hono'
import type { ConfigResponse } from '../../src/game/protocol'
import type { AppEnv, Deps } from '../http'

export function configRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()

  app.get('/', (c) => {
    const body: ConfigResponse = { devTools: deps.env.devTools }
    // A restart with another DEV_TOOLS must show up on the next load.
    c.header('Cache-Control', 'no-store')
    return c.json(body)
  })

  return app
}
