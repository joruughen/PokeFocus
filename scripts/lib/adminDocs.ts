/**
 * The generated parts of docs/admin-json.md: the table of ranges comes straight from `limits.ts`, so the doc an
 * assistant reads cannot disagree with what the server accepts. `npm run admin:schema` rewrites it and a test
 * fails when it is stale.
 */
import { DATA_LIMITS as D, type NumberBounds } from '../../src/game/content'

export const LIMITS_START = '<!-- limits:start (generado por npm run admin:schema; no editar a mano) -->'
export const LIMITS_END = '<!-- limits:end -->'

const range = (b: NumberBounds): string => {
  if (b.kind === 'prob') return `${b.min} a ${b.max} (fracción: ${Number((b.min * 100).toPrecision(4))} % a ${Number((b.max * 100).toPrecision(4))} %)`
  return `${b.min} a ${b.max}${b.unit ? ` ${b.unit}` : ''}`
}

const ROWS: [string, string][] = [
  ['`featured` (especies destacadas)', `como mucho ${D.eventFeaturedMax}`],
  ['`featured[].weightMult`', `×${range(D.eventFeaturedMult)}`],
  ['`shiny.chance`', range(D.eventShinyChance)],
  ['`legendaryChanceMult`', `×${range(D.eventLegendaryMult)}`],
  ['`drops` (objetos que caen)', `como mucho ${D.eventDropsMax}`],
  ['`drops[].perWaveChance`', range(D.eventDropChance)],
  ['`drops[].max` (por sesión)', range(D.eventDropMax)],
  ['`missions` (misiones de evento)', `como mucho ${D.eventMissionsMax}`],
  ['`missions[].target`', range(D.missionTarget)],
  ['`missions[].minMinutes` (solo `longSession`)', range(D.missionMinMinutes)],
  ['`missions[].minTrainerLevel`', range(D.minTrainerLevel)],
  ['`missions[].rewards` (tramos de recompensa)', `de 1 a ${D.rewardTiersMax}`],
  ['recompensa `dust`', range(D.rewardDust)],
  ['recompensa `items[slug]` (unidades)', range(D.rewardItemCount)],
  ['recompensa `typeCandies`', range(D.rewardTypeCandies)],
  ['recompensa `randomItem.count`', range(D.rewardRandomCount)],
  ['`items` (objetos propios del evento)', `como mucho ${D.eventItemsMax}`],
  ['nombres y títulos (`name`, `missions[].title`, `items[].names`)', `1 a ${D.shortText} caracteres`],
  ['`description` del evento', `1 a ${D.longText} caracteres **visibles** (las marcas no cuentan)`],
  ['`missions[].description`, `items[].description`', `1 a ${D.longText} caracteres`],
  ['duración del evento (`endsAt` − `startsAt`)', `como mucho ${D.eventMaxDurationMs / 86_400_000} días`],
  ['`patch.species[].captureRate`', range(D.captureRate)],
  ['`patch.species[].spawn.weightMult`', `×${range(D.spawnWeightMult)}`],
  ['`patch.species[].spawn.hours` (franjas `[desde, hasta)`)', `horas ${range(D.spawnHour)}, como mucho ${D.spawnMaxWindows} franjas`],
  ['`patch.species[].spawn.minTrainerLevel`', range(D.minTrainerLevel)],
  ['`patch.moves[].power`', range(D.movePower)],
  ['`patch.moves[].accuracy`', range(D.moveAccuracy)],
  ['`patch.missions.dailyCount` / `weeklyCount`', range(D.missionCount)],
  ['`patch.missions.pool` (misiones diarias y semanales)', `como mucho ${D.missionPoolMax}`],
  ['`patch.techniques[].limitPerSession` / `limitPerWeek`', range(D.techniqueLimit)],
]

/** The markdown table of ranges (without the markers). */
export function limitsMarkdown(): string {
  return ['| Campo | Rango o límite |', '| --- | --- |', ...ROWS.map(([k, v]) => `| ${k} | ${v} |`)].join('\n')
}

/** `doc` with the block between the markers replaced by the current table (throws when a marker is missing). */
export function withLimitsBlock(doc: string): string {
  const a = doc.indexOf(LIMITS_START)
  const b = doc.indexOf(LIMITS_END)
  if (a < 0 || b < a) throw new Error('docs/admin-json.md: faltan las marcas del bloque de rangos')
  return `${doc.slice(0, a)}${LIMITS_START}\n${limitsMarkdown()}\n${doc.slice(b)}`
}
