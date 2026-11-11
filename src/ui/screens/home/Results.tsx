import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { pokemonView, type MemberResult, type ProgressEvent, type TypeSlug } from '../../../engine'
import { BallIcon, Button, Panel, PixelIcon, ProgressBar, Sprite, Stage, StageTeam, toast, Tooltip, TypeBadge } from '../../components'
import { hintAnchor, useHintEvent, useHintScreen } from '../../hints'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { fmtInt, fmtPct } from '../../lib/format'
import { useNames } from '../../lib/names'
import { sfx } from '../../lib/sound'
import { useNow } from '../../store/clock'
import { useGame } from '../../store/game'
import { useBusy, usePlayer, useScene } from '../../store/selectors'
import { SessionReportButton } from './SessionReport'
import { eventDrops } from './sessionReportModel'
import { GroupFairyNote } from './GroupStudy'
import { StudyStyleLine } from './SoundStyle'
import { useContent } from '../../store/content'

/** What the session produced, and why. */
export function Results() {
  const cfg = useContent().config
  useHintScreen('results')
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const names = useNames()
  const player = usePlayer()
  const now = useNow()
  const outcome = useGame((s) => s.outcome)!
  const dismissResults = useGame((s) => s.dismissResults)
  const busy = useBusy()
  const dismiss = async () => {
    const err = await dismissResults()
    if (err) toast.add({ title: errorText(err), type: 'danger' })
  }
  const { result, events } = outcome
  const scene = useScene(player, now)
  const levelUps = events.filter((e): e is Extract<ProgressEvent, { type: 'levelUp' }> => e.type === 'levelUp')
  useHintEvent('levelUp', levelUps.length > 0)
  const shown = useCountUp(result.totalPoints, outcome.result.sessionId, () => {
    // After the count: the fanfares, in order of importance.
    if (events.some((e) => e.type === 'leagueUp')) sfx('leagueUp')
    else if (levelUps.length > 0) sfx('levelUp')
    if (levelUps.some((e) => e.newMoves.length > 0)) setTimeout(() => sfx('newMove'), 1600)
  })

  // --- The "why" line ------------------------------------------------------
  const why: ReactNode[] = []
  const condByType = new Map<TypeSlug, { mult: number; who: string[] }>()
  for (const m of result.members) {
    if (m.conditionType && m.conditionMult > 1) {
      const c = condByType.get(m.conditionType) ?? { mult: m.conditionMult, who: [] }
      c.who.push(names.pokemon(player.pokemon[m.uid], m.speciesSlug))
      c.mult = Math.max(c.mult, m.conditionMult)
      condByType.set(m.conditionType, c)
    }
  }
  for (const [type, c] of condByType) {
    why.push(
      <WhyChip key={`c-${type}`} tip={t('results.whyCondition', { type: names.type(type), who: c.who.join(', ') })}>
        <TypeBadge type={type} />
        <span className="font-num text-xl leading-none text-leaf-400">×{c.mult.toFixed(2)}</span>
      </WhyChip>,
    )
  }
  const techs = new Map<string, number>()
  for (const m of result.members) for (const u of m.techniques) techs.set(u.move, (techs.get(u.move) ?? 0) + u.count)
  for (const [move, count] of techs) {
    why.push(
      <WhyChip key={`t-${move}`} tip={names.technique(move) || t('results.whyTechnique')}>
        <PixelIcon name="bolt" size={16} className="text-volt-400" />
        <span>{names.move(move)}</span>
        <span className="font-num text-xl leading-none">×{count}</span>
      </WhyChip>,
    )
  }
  why.push(
    <WhyChip key="focus" tip={t('results.whyFocus')}>
      <PixelIcon name="star" size={16} className="text-exp-400" />
      <span>{t('results.focus', { pct: fmtPct(result.focus, lng) })}</span>
    </WhyChip>,
  )
  if (result.lateClaim)
    why.push(
      <WhyChip key="late" tip={t('results.whyLate')} tone="warn">
        <PixelIcon name="clock" size={16} />
        <span>{t('results.late', { mult: cfg.session.lateClaimMultiplier })}</span>
      </WhyChip>,
    )
  if (result.valid && result.rewardFactor < 1)
    why.push(
      <WhyChip key="daily" tip={t('results.whyDaily')} tone="warn">
        <PixelIcon name="clock" size={16} />
        <span>{t('results.daily', { pct: fmtPct(result.rewardFactor, lng) })}</span>
      </WhyChip>,
    )

  const hasWaves = Boolean(player.encounter) && result.waves.length > 0

  return (
    <div className="flex flex-col gap-8">
      <Stage time={scene.time} weather={scene.weather} className="px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          {/* Scoreboard: the one big number of the loop, with its reasons right under it. */}
          <div className="max-w-xl bg-mist-50 p-5 text-ink shadow-plate" {...hintAnchor('results.points')}>
            <h1 className="text-xl text-dusk-700">{result.cancelled ? t('results.cancelledTitle') : result.valid ? t('results.title') : t('results.invalidTitle')}</h1>
            <p className="mt-1 text-sm text-dusk-600">
              {result.cancelled
                ? t('results.cancelledSubtitle', { minutes: result.minutes, planned: result.plannedMinutes })
                : result.valid
                  ? t('results.subtitle', { count: result.minutes })
                  : t('results.invalid', { min: cfg.session.minMinutes })}
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-x-4">
              <p className="font-num text-[6rem] leading-[0.78] tabular" aria-label={fmtInt(result.totalPoints, lng)}>
                <span aria-hidden>{fmtInt(shown, lng)}</span>
              </p>
              <p className="pb-1 font-display text-xl">{t('results.points')}</p>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm text-dusk-600">{t('results.why')}</span>
              {why}
            </div>
            <SessionReportButton sessionId={result.sessionId} label={t('results.howPoints')} className="mt-3" />
            <GroupFairyNote result={result} />
            <StudyStyleLine result={result} />
          </div>
          <StageTeam
            className="max-w-full justify-start px-0 pb-1 sm:gap-x-4 sm:px-0"
            night={scene.time === 'night'}
            members={result.members.map((m) => {
              const slug = player.pokemon[m.uid]?.speciesSlug ?? m.speciesSlug
              return { uid: m.uid, slug, shiny: player.pokemon[m.uid]?.isShiny, name: names.pokemonFull(player.pokemon[m.uid], slug) }
            })}
          />
        </div>
      </Stage>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="flex flex-col gap-8">

          <Panel title={t('results.team')} actions={<SessionReportButton sessionId={result.sessionId} />} {...hintAnchor('results.team')}>
            <ul className="flex flex-col gap-4">
              {result.members.map((m) => (
                <MemberRow key={m.uid} m={m} events={events.filter((e) => 'uid' in e && e.uid === m.uid)} before={outcome.before} now={now} />
              ))}
            </ul>
          </Panel>
        </div>

        <div className="flex flex-col gap-8">
          <Panel title={t('results.rewards')}>
            <ul className="flex flex-col gap-3">
              <RewardRow icon={<PixelIcon name="dust" size={20} className="text-exp-400" />} label={t('items.dust')} value={`+${fmtInt(result.dust, lng)}`} />
              <RewardRow icon={<BallIcon ball="poke-ball" />} label={t('results.balls')} value={`+${result.pokeBalls}`} />
              <RewardRow icon={<PixelIcon name="league" size={20} className="text-volt-400" />} label={t('results.leaguePoints')} value={`+${fmtInt(result.totalPoints, lng)}`} />
              {eventDrops(result).map((d) => (
                <RewardRow key={d.item} icon={<PixelIcon name="sparkle" size={20} className="text-shiny-300" />} label={t('results.eventItem', { item: names.item(d.item) })} value={`+${fmtInt(d.count, lng)}`} />
              ))}
            </ul>
            {events
              .filter((e) => e.type === 'trainerLevelUp' || e.type === 'leagueUp')
              .map((e, i) => (
                <p key={i} className="mt-4 flex items-center gap-2 bg-dusk-900 p-3 text-sm inset-shadow-well">
                  <PixelIcon name="star" size={16} className="text-volt-400" />
                  {e.type === 'trainerLevelUp'
                    ? t('results.trainerLevelUp', { level: e.to })
                    : t('results.leagueUp', { league: t(`league.names.${e.to}`) })}
                </p>
              ))}
          </Panel>

          <Panel variant="frame" className="flex flex-col gap-4">
            {hasWaves ? (
              <>
                <p className="font-display text-xl">{t('results.wavesReady', { count: result.waves.length })}</p>
                <p className="text-sm text-mist-300">{t('results.wavesNote')}</p>
                <Button size="lg" icon="next" onClick={() => void dismiss()} disabled={busy}>
                  {t('results.toWaves')}
                </Button>
              </>
            ) : (
              <>
                <p className="text-mist-300">{t('results.noWaves')}</p>
                <Button size="lg" onClick={() => void dismiss()} disabled={busy}>
                  {t('results.done')}
                </Button>
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

/**
 * Count the score up once per session (≈1.2 s, `pointsTick` with a rising
 * pitch), then call `onDone`. Reduced motion or a revisit: shows the total at once.
 */
const counted = new Set<string>()
function useCountUp(target: number, key: string, onDone: () => void): number {
  const [value, setValue] = useState(() => (counted.has(key) ? target : 0))
  useEffect(() => {
    if (counted.has(key)) {
      setValue(target)
      return
    }
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || target <= 0) {
      counted.add(key)
      setValue(target)
      onDone()
      return
    }
    const steps = Math.min(24, Math.max(6, Math.round(target / 3)))
    let i = 0
    const id = setInterval(() => {
      i++
      setValue(Math.round((target * i) / steps))
      sfx('pointsTick', { pitch: i * 40, volume: 0.6 })
      if (i >= steps) {
        clearInterval(id)
        counted.add(key)
        setTimeout(onDone, 150)
      }
    }, 1200 / steps)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return value
}

function WhyChip({ children, tip, tone }: { children: ReactNode; tip: string; tone?: 'warn' }) {
  return (
    <Tooltip content={tip}>
      <span tabIndex={0} className={cx('inline-flex items-center gap-1.5 bg-dusk-800 px-2 py-1 text-sm text-mist-50 shadow-frame', tone === 'warn' && 'text-amber-400')}>
        {children}
      </span>
    </Tooltip>
  )
}

function RewardRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="grid size-9 place-items-center">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="font-num text-2xl leading-none tabular">{value}</span>
    </li>
  )
}

function MemberRow({ m, events, before, now }: { m: MemberResult; events: ProgressEvent[]; before: { levels: Record<string, number> }; now: number }) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const player = usePlayer()
  const view = pokemonView(player, m.uid, now)
  if (!view) return null
  const name = names.pokemon(view.pokemon)
  const from = before.levels[m.uid] ?? view.pokemon.level
  const up = view.pokemon.level > from
  const newMoves = events.flatMap((e) => (e.type === 'levelUp' ? e.newMoves : []))
  const slots = events.some((e) => e.type === 'levelUp' && e.slotsUnlocked)
  const evo = events.find((e) => e.type === 'evolutionAvailable')
  const capped = events.find((e) => e.type === 'levelCapped')
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 bg-dusk-900 p-3 inset-shadow-well">
      <div className="grid size-16 place-items-center">
        <Sprite kind="icon" slug={view.pokemon.speciesSlug} scale={2} alt="" />
      </div>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-lg">{name}</span>
          <span className="font-num text-xl leading-none">
            {up ? (
              <span className="text-volt-400">
                {t('pokemon.levelShort')}
                {from} ▸ {t('pokemon.levelShort')}
                {view.pokemon.level}
              </span>
            ) : (
              <>
                {t('pokemon.levelShort')}
                {view.pokemon.level}
              </>
            )}
          </span>
          {m.asleep && <span className="text-sm text-mist-400">{t('results.asleep')}</span>}
        </p>
        <ProgressBar
          className="mt-2"
          size="sm"
          variant="exp"
          value={view.expIntoLevel}
          from={up ? 0 : Math.max(0, view.expIntoLevel - m.exp)}
          max={view.expForNextLevel}
          label={t('pokemon.expOf', { name })}
          valueText={`+${fmtInt(m.exp, i18n.language)} ${t('pokemon.exp')}`}
        />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-mist-300">
          <span>{t('results.actions', { count: m.actions })}</span>
          <span>{t('results.energySpent', { spent: Math.round(m.energySpent), max: Math.round(m.energyMax) })}</span>
          {m.exhaustedAtMinute !== null && <span className="text-amber-400">{t('results.exhausted', { minute: Math.round(m.exhaustedAtMinute) })}</span>}
        </div>
        {(newMoves.length > 0 || slots || evo || capped) && (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {newMoves.map((mv) => (
              <li key={mv} className="text-leaf-400">
                {t('results.newMove', { move: names.move(mv) })}
              </li>
            ))}
            {slots && <li className="text-leaf-400">{t('results.newSlot')}</li>}
            {evo && evo.type === 'evolutionAvailable' && <li className="text-volt-300">{t('results.evolution', { name, to: names.species(evo.to) })}</li>}
            {capped && capped.type === 'levelCapped' && <li className="text-amber-400">{t('results.capped', { cap: capped.cap })}</li>}
          </ul>
        )}
      </div>
      <div className="text-right">
        <p className="font-num text-3xl leading-none tabular">{fmtInt(m.points, i18n.language)}</p>
        <p className="text-xs text-mist-400">{t('results.pointsShort')}</p>
      </div>
    </li>
  )
}
