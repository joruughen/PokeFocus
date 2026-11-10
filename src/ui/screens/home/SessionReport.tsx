import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  defaultContext,
  type ActivableLog,
  type Effect,
  type MemberResult,
  type PassiveLog,
  type PlayerState,
  type SessionResult,
  type TypeSlug,
  type When,
} from '../../../engine'
import { Button, Dialog, PixelIcon, Sprite, TypeBadge } from '../../components'
import { fmtInt, fmtPct } from '../../lib/format'
import { useNames } from '../../lib/names'
import { useGame } from '../../store/game'
import { useChargeLabel } from './ChargeChip'
import { conditionRuleValues } from './conditionCopy'
import { activationsOf, chargesBy, conditionLines, wildFactors, type WildFactor } from './sessionReportModel'

const cfg = defaultContext().config

type T = (k: string, o?: Record<string, unknown>) => string

/** Percent with one decimal below 10 % ("3,5 %"), whole above ("18 %"). */
function fmtChance(f: number, lng: string): string {
  return new Intl.NumberFormat(lng, { style: 'percent', maximumFractionDigits: f < 0.1 ? 1 : 0 }).format(f)
}
const fmtMult = (m: number) => `×${Number(m.toFixed(2))}`

/**
 * "Informe de la sesión" button: opens the report of the session whose
 * outcome is stored (Results, or Waves of that same session). Renders nothing
 * when there is no matching outcome.
 */
export function SessionReportButton({ sessionId, className }: { sessionId: string; className?: string }) {
  const { t, i18n } = useTranslation()
  const outcome = useGame((s) => s.outcome)
  const player = useGame((s) => s.player)
  if (!outcome || outcome.result.sessionId !== sessionId) return null
  return (
    <Dialog
      size="lg"
      title={t('report.title')}
      description={t('report.subtitle', { minutes: outcome.result.minutes, focus: fmtPct(outcome.result.focus, i18n.language) })}
      trigger={
        <Button variant="secondary" size="sm" icon="help" className={className}>
          {t('report.open')}
        </Button>
      }
    >
      <SessionReport result={outcome.result} player={player} />
    </Dialog>
  )
}

/** The report body: one collapsible row per team member, then why these wilds. */
export function SessionReport({ result, player }: { result: SessionResult; player: PlayerState | null }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="report-team">
        <h3 id="report-team" className="mb-2 text-lg">
          {t('report.teamTitle')}
        </h3>
        {!result.members[0]?.activables && <p className="mb-2 text-sm text-mist-400">{t('report.legacy')}</p>}
        <ul className="flex flex-col gap-2">
          {result.members.map((m) => (
            <MemberReport key={m.uid} m={m} result={result} player={player} />
          ))}
        </ul>
      </section>
      <section aria-labelledby="report-wilds">
        <h3 id="report-wilds" className="mb-2 text-lg">
          {t('report.wildsTitle')}
        </h3>
        {result.waves.length === 0 ? (
          <p className="text-sm text-mist-300">{t('report.noWilds')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {wildFactors(result, cfg).map((f, i) => (
              <WildFactorRow key={i} f={f} result={result} player={player} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function MemberReport({ m, result, player }: { m: MemberResult; result: SessionResult; player: PlayerState | null }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const names = useNames()
  const chargeLabel = useChargeLabel(player)
  const name = names.pokemon(player?.pokemon[m.uid], m.speciesSlug)
  const conds = conditionLines(m, result)
  const charges = chargesBy(result, m.uid)
  const ability = player?.pokemon[m.uid]?.ability ?? null
  const passives = m.passives ?? []
  const abilityFired = ability !== null && passives.some((p) => p.sourceKind === 'ability' && p.source === ability)
  const acts = activationsOf(m)
  const summary: string[] = [t('results.actions', { count: m.actions })]
  if (acts > 0) summary.push(t('report.summaryTechs', { count: acts }))
  if (conds[0]) summary.push(`${names.type(conds[0].type)} ${fmtMult(conds[0].mult)}`)
  if (charges.length > 0) summary.push(t('report.summaryCharges', { count: charges.length }))

  return (
    <li className="bg-dusk-900 inset-shadow-well">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-3 outline-offset-2 [&::-webkit-details-marker]:hidden">
          <Sprite kind="icon" slug={m.speciesSlug} alt="" className="-my-2" />
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg leading-tight">{name}</span>
            <span className="block text-sm text-mist-300">{m.asleep ? t('results.asleep') : summary.join(' · ')}</span>
          </span>
          <span className="text-right">
            <span className="block font-num text-2xl leading-none tabular">{fmtInt(m.points, lng)}</span>
            <span className="block text-xs text-mist-400">{t('results.pointsShort')}</span>
          </span>
          <PixelIcon name="next" size={16} className="shrink-0 transition-transform group-open:rotate-90" />
        </summary>
        <div className="flex flex-col gap-3 px-3 pb-3 text-sm">
          {m.damageMoves && m.damageMoves.length > 0 && (
            <Block title={t('report.moves')}>
              <p>
                {m.damageMoves
                  .slice()
                  .sort((a, b) => b.count - a.count)
                  .map((d) => `${d.move ? names.move(d.move) : t('report.noMove')} ×${d.count}`)
                  .join(' · ')}
              </p>
              {m.damageMoves.some((d) => d.move === null) && <p className="text-mist-400">{t('report.noMoveTip')}</p>}
            </Block>
          )}

          <Block title={t('report.activables')}>
            {m.activables && m.activables.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {m.activables.map((a) => (
                  <li key={a.move}>
                    <span className="font-display">{names.move(a.move)}</span>: {activableLine(a, t, lng)}
                  </li>
                ))}
              </ul>
            ) : m.techniques.length > 0 ? (
              <p>{m.techniques.map((u) => `${names.move(u.move)} ×${u.count}`).join(' · ')}</p>
            ) : (
              <p className="text-mist-400">{t('report.noActivables')}</p>
            )}
          </Block>

          <Block title={t('report.passives')}>
            {passives.length > 0 && (
              <ul className="flex flex-col gap-1">
                {passives.map((p, i) => (
                  <li key={i}>
                    <span className="font-display">{p.sourceKind === 'ability' ? names.ability(p.source) : names.move(p.source)}</span>: {passiveLine(p, m, t, names, lng)}
                  </li>
                ))}
              </ul>
            )}
            {ability && !abilityFired && m.passives && (
              <p className="text-mist-400">
                {t('report.abilityIdle', { ability: names.ability(ability) })} {names.abilityDesc(ability)}
              </p>
            )}
            {passives.length === 0 && !ability && <p className="text-mist-400">{t('report.noPassives')}</p>}
          </Block>

          <Block title={t('report.condition')}>
            {conds.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {conds.map((c) => (
                  <li key={`${c.type}-${c.mult}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <TypeBadge type={c.type} />
                    <span>{t('report.conditionLine', { mult: fmtMult(c.mult), actions: c.actions, total: m.actions })}</span>
                    <span className="text-mist-400">
                      {c.forcedBy
                        ? t('report.conditionForced', { move: names.move(c.forcedBy.move), who: names.pokemon(player?.pokemon[c.forcedBy.byUid]), minute: Math.round(c.forcedBy.atMinute) })
                        : t(`conditions.rule.${c.type}`, conditionRuleValues(result.minutes))}
                    </span>
                  </li>
                ))}
                {(m.conditionBonusMult ?? 1) > 1 && <li className="text-mist-400">{t('report.conditionBonus', { mult: fmtMult(m.conditionBonusMult ?? 1) })}</li>}
              </ul>
            ) : (
              <p className="text-mist-400">{t('report.noCondition')}</p>
            )}
          </Block>

          {charges.length > 0 && (
            <Block title={t('report.charges')}>
              <ul className="flex flex-col gap-1">
                {charges.map((c) => (
                  <li key={c.id}>{chargeLabel(c)}</li>
                ))}
              </ul>
            </Block>
          )}

          <Block title={t('report.energy')}>
            <p>
              {t('results.energySpent', { spent: Math.round(m.energySpent), max: Math.round(m.energyMax) })}
              {m.energyHealed > 0 && ` · ${t('report.healed', { amount: Math.round(m.energyHealed) })}`}
              {m.exhaustedAtMinute !== null && <span className="text-amber-400"> · {t('results.exhausted', { minute: Math.round(m.exhaustedAtMinute) })}</span>}
            </p>
            {m.exhaustedAtMinute !== null && <p className="text-mist-400">{t('report.exhaustedTip')}</p>}
          </Block>
        </div>
      </details>
    </li>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-0.5 font-display text-sm text-volt-300">{title}</h4>
      {children}
    </div>
  )
}

function activableLine(a: ActivableLog, t: T, lng: string): string {
  if (a.attempts === 0) return a.limitReached ? t('report.weeklyLimit') : t('report.neverRolled')
  const chance = a.chanceMax - a.chanceMin < 0.005 ? fmtChance(a.chanceAvg, lng) : `${fmtChance(a.chanceMin, lng)}–${fmtChance(a.chanceMax, lng)}`
  let s = t('report.activated', { count: a.activations, attempts: a.attempts, chance })
  if (a.limitReached) s += ` ${a.limitPerSession !== null ? t('report.limitReached', { limit: a.limitPerSession }) : t('report.weeklyLimit')}`
  return s
}

function whenText(w: When | undefined, t: T): string {
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

function passiveLine(p: PassiveLog, m: MemberResult, t: T, names: ReturnType<typeof useNames>, lng: string): string {
  const e: Effect = p.effect
  const when = whenText(e.when, t)
  const withWhen = (s: string) => (when ? `${s} (${when})` : s)
  switch (e.kind) {
    case 'statMod': {
      const base = t('report.effect.statMod', { stat: t(`report.stat.${e.stat}`), mult: fmtMult(e.mult) })
      const scope = e.scope === 'team' ? ` ${t('report.teamScope')}` : ''
      const perAction = e.stat !== 'exp' && e.stat !== 'bondGain'
      return withWhen(base + scope) + (perAction ? ` · ${t('report.inActions', { count: p.count, total: m.actions })}` : '')
    }
    case 'statusOnAction':
      return t('report.effect.statusOnAction', { count: p.count, status: t(`report.charge.${e.status}`), chance: fmtChance(e.chance, lng) })
    case 'heal':
      return withWhen(t(e.timing === 'nextSessionStart' ? 'report.effect.healNext' : 'report.effect.heal', { pct: Math.round(e.pct * 100), target: t(`report.target.${e.target}`) }))
    case 'encounterWeight':
      return 'type' in e.match
        ? t('report.effect.encounterType', { type: names.type(e.match.type), mult: fmtMult(e.mult) })
        : t('report.effect.sync', { pct: fmtPct(e.mult, lng) })
    case 'focusFloor':
      return t('report.effect.focusFloor', { pct: fmtPct(e.min, lng) })
    case 'focusLabelFloor':
      return t('report.effect.focusLabelFloor', { pct: fmtPct(e.value, lng) })
    case 'lateClaimImmune':
      return t('report.effect.lateClaimImmune')
    case 'conditionBonusMult':
      return t('report.effect.conditionBonusMult', { mult: fmtMult(e.mult) })
    case 'lastActionMult':
      return t('report.effect.lastActionMult', { mult: fmtMult(e.mult) })
    case 'effectivenessFloor':
      return t('report.effect.effectivenessFloor', { from: e.from, to: e.to })
    case 'streakProtect':
      return t('report.effect.streakProtect')
    case 'noSleepFromRest':
      return t('report.effect.noSleepFromRest')
    default:
      return t('report.effect.generic', { count: p.count })
  }
}

function WildFactorRow({ f, result, player }: { f: WildFactor; result: SessionResult; player: PlayerState | null }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const names = useNames()
  const who = (uid: string | null) => (uid ? names.pokemon(player?.pokemon[uid], result.members.find((m) => m.uid === uid)?.speciesSlug ?? '') : '')
  const src = (uid: string | null, source: string | null) => (source ? t('report.wild.by', { who: who(uid), source: uid && player?.pokemon[uid]?.ability !== source ? names.move(source) : names.ability(source) }) : '')
  let icon: 'clock' | 'star' | 'league' | 'bolt' | 'help' = 'star'
  let body: ReactNode
  switch (f.kind) {
    case 'time':
      icon = 'clock'
      body = t('report.wild.time', { hour: String(f.hour).padStart(2, '0'), period: t(`report.period.${f.period}`) })
      break
    case 'conditions':
      body = (
        <>
          <span>{t('report.wild.conditions', { mult: fmtMult(f.mult) })}</span>
          <Badges types={f.types} />
          {f.forced.map((c) => (
            <span key={c.type} className="text-mist-400">
              {t('report.wild.forced', { type: names.type(c.type), move: names.move(c.move), who: who(c.byUid) })}
            </span>
          ))}
        </>
      )
      break
    case 'team':
      body = (
        <>
          <span>{t('report.wild.team', { mult: fmtMult(f.mult) })}</span>
          <Badges types={f.types} />
        </>
      )
      break
    case 'sound':
      body = f.dominant ? (
        <>
          <span>{t('report.wild.sound', { sound: t(`report.sound.${f.dominant}`), mult: fmtMult(f.mult) })}</span>
          <Badges types={f.types} />
        </>
      ) : (
        <span className="text-mist-400">{t('report.wild.noMic')}</span>
      )
      break
    case 'typeWeight':
      body = (
        <>
          <span>{t('report.wild.typeWeight', { type: names.type(f.type), mult: fmtMult(f.mult) })}</span>
          <span className="text-mist-400">{src(f.uid, f.source)}</span>
        </>
      )
      break
    case 'sync':
      body = (
        <>
          <span>{t('report.wild.sync', { pct: fmtPct(f.chance, lng), nature: names.nature(f.nature) })}</span>
          <span className="text-mist-400">{src(f.uid, f.source)}</span>
        </>
      )
      break
    case 'league':
      icon = 'league'
      body = t('report.wild.league', { league: t(`league.names.${f.league}`), max: f.max, sizes: f.sizes.join(', ') })
      break
    case 'extraWild':
      icon = 'bolt'
      body = t('report.wild.extraWild', { count: f.count })
      break
    case 'lowFocus':
      icon = 'help'
      body = t('report.wild.lowFocus', { pct: fmtPct(f.focus, lng) })
      break
    case 'roaming':
      body = t('report.wild.roaming', { names: f.species.map((s) => names.species(s)).join(', ') })
      break
    case 'longSession':
      body = t('report.wild.longSession', { count: f.waves })
      break
  }
  return (
    <li className="flex items-start gap-3 bg-dusk-900 p-3 text-sm inset-shadow-well">
      <PixelIcon name={icon} size={16} className="mt-0.5 shrink-0 text-volt-300" />
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{body}</span>
    </li>
  )
}

function Badges({ types }: { types: readonly TypeSlug[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {types.map((ty) => (
        <TypeBadge key={ty} type={ty} />
      ))}
    </span>
  )
}
