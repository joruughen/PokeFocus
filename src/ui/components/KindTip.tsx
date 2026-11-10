import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, type ActionPace, type PassiveOutlook, type TechniqueKind, type TechniqueOutlook } from '../../engine'
import { fmtPct } from '../lib/format'
import { useNames } from '../lib/names'
import { whenText } from '../lib/whenText'

const cfg = defaultContext().config

const num = (n: number, lng: string, digits = 1) => n.toLocaleString(lng, { maximumFractionDigits: digits })
/** Percent with one decimal below 10 % ("3,5 %"), whole above ("18 %"). */
const pct = (f: number, lng: string) => new Intl.NumberFormat(lng, { style: 'percent', maximumFractionDigits: f < 0.1 ? 1 : 0 }).format(f)

/**
 * Body of the Damage / Passive / Activable help bubble: what the category does
 * (updated for the v0.9 combat) and, when an `outlook` is given, the numbers of
 * that Pokémon: when it triggers and with what probability. All numbers come
 * from the engine (`techniqueOutlook`, `abilityOutlook`).
 */
export function KindTip({ kind, outlook, pokemonName }: { kind: TechniqueKind; outlook?: TechniqueOutlook | PassiveOutlook | null; pokemonName?: string }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const names = useNames()
  const lines: ReactNode[] = []
  const pace = (p: ActionPace) => (
    <>
      {t('technique.tip.damage.pace', { seconds: num(p.intervalSeconds, lng), actions: num(p.actionsPerWave, lng, 0) })}
      {p.conditional && ` ${t('technique.tip.paceMore')}`}
    </>
  )

  if (outlook?.kind === 'damage') {
    const o = outlook
    lines.push(t('technique.tip.damage.energy', { energy: num(o.energyPerAction, lng), type: names.type(o.type), power: o.power }))
    if (o.stab) lines.push(t('technique.tip.damage.stab'))
    lines.push(pace(o.pace))
    if (o.share < 1) lines.push(t('technique.tip.damage.share', { count: Math.round(1 / o.share), pct: fmtPct(o.share, lng) }))
    lines.push(t('technique.tip.damage.wave', { energy: num(o.energyPerWave, lng) }))
    lines.push(t('technique.tip.damage.why', { min: Math.round(cfg.capture.minHpFraction * 100) }))
    lines.push(
      t('technique.tip.damage.counter', {
        name: pokemonName ?? '',
        cost: num(o.pace.energyCostPerAction, lng, 2),
        n: num(o.pace.actionsOnFullEnergy, lng, 0),
      }),
    )
  } else if (outlook?.kind === 'activable') {
    const o = outlook
    lines.push(<strong key="c">{t('technique.tip.activable.chance', { pct: pct(o.chancePerAction, lng) })}</strong>)
    lines.push(
      t('technique.tip.activable.how', { base: pct(o.baseChance, lng), tech: num(o.techniqueMult, lng, 2), mastery: num(o.masteryMult, lng, 2) }) +
        (o.techChanceMult !== 1 ? t('technique.tip.activable.howExtra', { extra: num(o.techChanceMult, lng, 2) }) : ''),
    )
    if (o.capped) lines.push(t('technique.tip.activable.cap', { pct: pct(cfg.actions.maxActivationChance, lng) }))
    lines.push(t('technique.tip.activable.rolls', { seconds: num(o.pace.intervalSeconds, lng), actions: num(o.pace.actionsPerWave, lng, 0) }))
    lines.push(t('technique.tip.activable.expected', { n: num(o.expectedPerWave, lng), pct: pct(o.atLeastOncePerWave, lng) }))
    if (o.limitPerSession !== null) lines.push(t('tech.limit', { count: o.limitPerSession }))
    if (o.limitPerWeek !== null) lines.push(t('tech.limitWeek', { count: o.limitPerWeek }))
    if (o.inflicts) lines.push(t(`technique.tip.activable.inflicts.${o.inflicts}`))
    if (o.conditionalTechChance) lines.push(t('technique.tip.activable.conditional'))
  } else if (outlook?.kind === 'passive') {
    const o = outlook
    const whens = o.whens.map((w) => whenText(w, t)).filter(Boolean)
    if (whens.length === 0) lines.push(t('technique.tip.passive.always'))
    else if (o.always) lines.push(t('technique.tip.passive.alsoWhen', { when: whens.join(t('technique.tip.passive.or')) }))
    else lines.push(t('technique.tip.passive.onlyWhen', { when: whens.join(t('technique.tip.passive.or')) }))
    for (const r of o.rolls) {
      if (r.kind === 'statusOnAction') {
        lines.push(
          t('technique.tip.passive.rollAction', {
            pct: pct(r.chance, lng),
            status: t(`report.charge.${r.status}`),
            limit: r.limit,
            once: pct(r.atLeastOncePerWave ?? 0, lng),
          }),
        )
      } else if (r.kind === 'counterMiss') lines.push(t(r.team ? 'technique.tip.passive.rollMissTeam' : 'technique.tip.passive.rollMiss', { pct: pct(r.chance, lng) }))
      else lines.push(t('technique.tip.passive.rollStatus', { pct: pct(r.chance, lng), status: t(`waves.status.${r.status}`).toLowerCase() }))
    }
  }

  return (
    <span className="flex flex-col gap-1.5">
      <span>{t(`technique.kindHelp.${kind}`)}</span>
      {lines.length > 0 && (
        <>
          <span className="font-display text-base">{t('technique.tip.withName', { name: pokemonName ?? '' })}</span>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </>
      )}
    </span>
  )
}
