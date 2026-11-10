import type { When } from '../../engine'

type T = (k: string, o?: Record<string, unknown>) => string

/** The conditions of an effect as one phrase ("de día, con lluvia"), empty without a condition. */
export function whenText(w: When | undefined, t: T): string {
  if (!w) return ''
  const parts: string[] = []
  if (w.energyBelow !== undefined) parts.push(t('report.when.energyBelow', { pct: Math.round(w.energyBelow * 100) }))
  if (w.energyFull) parts.push(t('report.when.energyFull'))
  if (w.timeWindow) parts.push(t(`report.when.time.${w.timeWindow}`))
  if (w.weather) parts.push(t(`report.when.weather.${w.weather}`))
  if (w.weekend) parts.push(t('report.when.weekend'))
  if (w.noPauses) parts.push(t('report.when.noPauses'))
  if (w.isLeader) parts.push(t('report.when.isLeader'))
  if (w.targetLegendary) parts.push(t('report.when.targetLegendary'))
  if (w.sessionMinMinutes !== undefined) parts.push(t('report.when.sessionMin', { min: w.sessionMinMinutes }))
  return parts.join(', ')
}
