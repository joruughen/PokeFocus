/** Interpolation values for `conditions.rule.<type>` (numbers come from the config). */
import { defaultContext } from '../../../engine'

export function conditionRuleValues(minutes: number): Record<string, string | number> {
  const c = defaultContext().config.conditions
  const pct = (m: number) => Math.round((m - 1) * 100)
  return {
    minutes,
    hot: c.fireHotCelsius,
    cold: c.iceColdCelsius,
    dayFrom: c.dayWindow[0],
    dayTo: c.dayWindow[1],
    pmFrom: c.afternoonWindow[0],
    pmTo: c.afternoonWindow[1],
    nightFrom: c.nightWindow[0],
    nightTo: c.nightWindow[1],
    electricMax: c.electricMaxMinutes,
    electricGap: c.electricChainGapMinutes,
    fightingMin: c.fightingMinMinutes,
    poisonPct: Math.round(c.poisonPerSession * 100),
    poisonMax: pct(c.poisonMax),
    bugPct: Math.round(c.bugPerBug * 100),
    noise: Math.round(c.flyingNoiseShare * 100),
    silence: Math.round(c.psychicSilenceShare * 100),
    streak: c.dragonStreakDays,
    missed: c.darkMissedDays,
    steelWindow: c.steelWindowMinutes,
    fairyPct: pct(c.fairy),
  }
}
