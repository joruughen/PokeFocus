/** Read helpers for screens. All derived numbers come from engine views. */
import { useMemo } from 'react'
import { pokemonView, toLocal, type PlayerState, type PokemonView } from '../../engine'
import { timeOfDay, weatherKind, type TimeOfDay, type WeatherKind } from '../lib/conditions'
import { useSessionWeather } from '../lib/weather'
import { phaseOf, useGame, type Phase } from './game'
import { useNow } from './clock'

/** The player (screens below FirstRun can assume it exists). */
export function usePlayer(): PlayerState {
  const p = useGame((s) => s.player)
  if (!p) throw new Error('usePlayer() used before the player exists')
  return p
}

/** Engine views of the team (leader first) at `now`. */
export function useTeamViews(player: PlayerState, now: number, uids: string[] = player.team): PokemonView[] {
  // Energy changes slowly: recompute once per minute of game time, not every tick.
  const minute = Math.floor(now / 60_000)
  return useMemo(
    () => uids.map((u) => pokemonView(player, u, minute * 60_000)).filter((v): v is PokemonView => v !== null),
    [player, minute, uids.join(',')],
  )
}

/** Current core-loop phase, re-evaluated every tick. */
export function usePhase(): Phase {
  const now = useNow()
  const player = useGame((s) => s.player)
  const timer = useGame((s) => s.timer)
  const outcome = useGame((s) => s.outcome)
  const breakTimer = useGame((s) => s.breakTimer)
  return phaseOf({ player, timer, outcome, breakTimer }, now)
}

/**
 * Sky and weather of the route band for the player's local time. Weather: the
 * active session's (fixed at start), else what a session started now would use.
 */
export function useScene(player: PlayerState, now: number): { time: TimeOfDay; weather: WeatherKind; hour: number } {
  const hour = toLocal(now, player.profile.timezone).hour
  const { effective } = useSessionWeather(player.profile)
  const sessionWeather = player.activeSession?.weather
  return { time: timeOfDay(hour), weather: weatherKind(sessionWeather !== undefined ? sessionWeather : effective), hour }
}

/** True while a game action is in flight (disable the buttons that send one). */
export function useBusy(): boolean {
  return useGame((s) => s.pending > 0)
}
