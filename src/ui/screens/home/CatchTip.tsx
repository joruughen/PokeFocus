import { useTranslation } from 'react-i18next'
import type { CatchBreakdown, ThrowBall } from '../../../engine'
import { fmtPct } from '../../lib/format'
import { useNames } from '../../lib/names'

/** How hard a species is to catch, from its capture rate (0–255). */
export function rateWord(rate: number): 'veryHard' | 'hard' | 'normal' | 'easy' {
  if (rate < 50) return 'veryHard'
  if (rate < 100) return 'hard'
  if (rate < 190) return 'normal'
  return 'easy'
}

const mult = (n: number, lng: string) => `×${n.toLocaleString(lng, { maximumFractionDigits: 2 })}`

/**
 * Body of the catch chance tooltip: every factor of the formula with this wild's
 * numbers (engine `catchBreakdown`), and what would raise it.
 */
export function CatchTip({ b, ball, speciesSlug }: { b: CatchBreakdown; ball: ThrowBall; speciesSlug: string }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const names = useNames()
  const pct = (f: number) => fmtPct(f, lng)
  const ballName = ball === 'study-ball' ? t('balls.study') : names.item(ball)

  if (b.guaranteed) {
    return <p>{t(b.guaranteed === 'study' ? 'waves.catchTip.study' : 'waves.catchTip.shiny', { ball: ballName })}</p>
  }

  const rows: { label: string; value: string; note?: string }[] = [
    {
      label: t('waves.catchTip.species', { name: names.species(speciesSlug) }),
      value: mult(b.rateFactor, lng),
      note: t('waves.catchTip.rate', { rate: b.captureRate, word: t(`waves.catchTip.rateWord.${rateWord(b.captureRate)}`) }) + (b.legendaryFloor ? ` ${t('waves.catchTip.legendaryFloor')}` : ''),
    },
    {
      label: t('waves.catchTip.hp', { hp: pct(b.hpFraction) }),
      value: mult(b.hpFactor, lng),
      note: b.hpAtFloor ? t('waves.catchTip.hpFloor') : t('waves.catchTip.hpMore'),
    },
    { label: ballName, value: mult(b.ballMult, lng) },
  ]
  if (b.abilityMult !== 1) rows.push({ label: t('waves.catchTip.abilities'), value: mult(b.abilityMult, lng) })
  if (b.status) rows.push({ label: t(`waves.status.${b.status}`), value: mult(b.statusMult, lng) })
  if (b.nextThrowBonus !== 1) rows.push({ label: t('waves.catchTip.bonus'), value: mult(b.nextThrowBonus, lng) })

  const tips = [
    b.ifAsleep !== null && t('waves.catchTip.ifAsleep', { pct: pct(b.ifAsleep) }),
    b.ifParalyzed !== null && t('waves.catchTip.ifParalyzed', { pct: pct(b.ifParalyzed) }),
    b.withUltra !== null && t('waves.catchTip.withUltra', { pct: pct(b.withUltra) }),
  ].filter((x): x is string => Boolean(x))

  return (
    <div className="space-y-2">
      <p className="font-display text-base">{t('waves.catchTip.title', { pct: pct(b.chance) })}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.label}>
            <span className="flex justify-between gap-3">
              <span>{r.label}</span>
              <span className="font-num">{r.value}</span>
            </span>
            {r.note && <span className="block text-xs text-dusk-700">{r.note}</span>}
          </li>
        ))}
      </ul>
      {b.capped && <p className="text-xs text-dusk-700">{t('waves.catchTip.capped')}</p>}
      {tips.length > 0 && (
        <div>
          <p className="text-xs font-bold">{t('waves.catchTip.raise')}</p>
          <ul className="list-disc pl-4 text-xs">
            {tips.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-dusk-700">{t('waves.catchTip.notCounted')}</p>
    </div>
  )
}
