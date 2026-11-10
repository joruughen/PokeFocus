import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  currentLeague,
  currentMaxWaveSize,
  defaultContext,
  isAsleepAt,
  MINUTE_MS,
  nextLeagueProgress,
  waveCount,
  weeklyPoints,
  type PokemonView,
} from '../../../engine'
import { Button, Panel, PixelIcon, Platform, PokemonCard, ProgressBar, Segmented, Stage, toast, TypeBadge } from '../../components'
import { hintAnchor, useHintEvent, useHintScreen } from '../../hints'
import { conditionsNow } from '../../lib/conditions'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { clampMinutes, fmtClock, fmtInt, fmtWeekday } from '../../lib/format'
import { useNames } from '../../lib/names'
import { primeSignals } from '../../lib/notify'
import { scheduleSessionEnd, sfx } from '../../lib/sound'
import { AutoDamageToggle } from './AutoDamageToggle'
import { BreakOffer, useBreakOffer } from './Break'
import { Checklist } from './Checklist'
import { GroupStudyPanel } from './GroupStudy'
import { QuickTeamSwitch } from '../team/TeamPresets'
import { useNow } from '../../store/clock'
import { useAuth } from '../../store/auth'
import { useGame } from '../../store/game'
import { useBusy, usePlayer, useScene, useTeamViews } from '../../store/selectors'
import { conditionRuleValues } from './conditionCopy'
import { TypesGuide } from './TypesGuide'
import { MicToggle } from './SoundStyle'
import { WeatherPicker } from './WeatherPicker'
import { useSessionWeather } from '../../lib/weather'

const cfg = defaultContext().config
const PRESETS = cfg.session.presets.map(String)

export function PreSession() {
  useHintScreen('home')
  const { t, i18n } = useTranslation()
  const names = useNames()
  const now = useNow()
  const player = usePlayer()
  const start = useGame((s) => s.start)
  const busy = useBusy()
  const trainerName = useAuth((s) => s.user?.trainerName)
  const views = useTeamViews(player, now)
  const scene = useScene(player, now)
  const [choice, setChoice] = useState<string>('25')
  const [custom, setCustom] = useState(40)
  // What is typed in the field; it is only clamped on blur so "45" can be typed (not clamped at "4").
  const [draft, setDraft] = useState('40')
  const minutes = choice === 'custom' ? custom : Number(choice)
  const sessionWeather = useSessionWeather(player.profile).effective
  const cond = conditionsNow(player, now, minutes, sessionWeather)
  const tz = player.profile.timezone
  const lng = i18n.language
  const waves = waveCount(minutes, cfg)
  const endsAt = now + minutes * MINUTE_MS

  // Who may run out of Energy before the end (engine view numbers; effects not included).
  const awake = views.filter((v) => !isAsleepAt(player, v.pokemon, now))
  const allOut = awake.length > 0 && awake.every((v) => v.energy <= 0)
  // Members already at 0 show "Agotado" on their card; only warn about the ones that will run out during the session.
  const tired = awake.filter((v) => v.energy > 0 && (minutes * 60) / v.actionIntervalSeconds > v.actionsLeft)
  useHintEvent('energyLow', tired.length > 0 || allOut)

  const onStart = async () => {
    if (busy) return
    primeSignals()
    const err = await start(minutes)
    if (err) {
      toast.add({ title: errorText(err), type: 'danger' })
      return
    }
    sfx('sessionStart')
    const timer = useGame.getState().timer
    if (timer) scheduleSessionEnd(timer.sessionId, timer.endsAt)
  }
  const breakOffer = useBreakOffer()
  useHintEvent('breakOffer', breakOffer)


  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">{t('home.greeting', { name: trainerName ?? player.profile.trainerName })}</h1>
          <p className="mt-1 text-mist-300">
            {t('home.now', { day: fmtWeekday(now, tz, lng), time: fmtClock(now, tz, lng) })} {t(`timeOfDay.${scene.time}`)}
          </p>
        </div>
      </header>

      <Stage time={scene.time} weather={scene.weather} className="px-4 pt-10 pb-5" sky={null}>
        <h2 className="sr-only">{t('team.title')}</h2>
        <div {...hintAnchor('home.team')} className="flex flex-wrap justify-center gap-x-3 gap-y-6 xl:justify-start">
          {views.map((v, i) => (
            <div key={v.pokemon.uid} className="w-[10.5rem]">
              <PokemonCard view={v} leader={i === 0} night={scene.time === 'night'} condition={cond.member[v.pokemon.uid]} />
            </div>
          ))}
          {views.length < 6 && <EmptySlots count={6 - views.length} night={scene.time === 'night'} />}
        </div>
      </Stage>

      <QuickTeamSwitch />

      <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title={t('home.plan.title')} help="home.duration">
          <div className="flex flex-col gap-6">
            <div {...hintAnchor('home.duration')}>
              <Segmented
                size="lg"
                label={t('home.plan.duration')}
                value={choice}
                onChange={setChoice}
                options={[
                  ...PRESETS.map((p) => ({ value: p, label: <span className="font-num text-3xl leading-none">{p}</span>, ariaLabel: t('common.minutes', { count: Number(p) }) })),
                  { value: 'custom', label: t('home.plan.custom') },
                ]}
              />
              {choice === 'custom' && (
                <label className="mt-4 flex items-center gap-3">
                  <span className="text-mist-300">{t('home.plan.customLabel')}</span>
                  <input
                    type="number"
                    min={cfg.session.minMinutes}
                    max={cfg.session.maxMinutes}
                    inputMode="numeric"
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value)
                      const n = Number(e.target.value)
                      if (e.target.value.trim() !== '' && Number.isInteger(n) && n >= cfg.session.minMinutes && n <= cfg.session.maxMinutes) setCustom(n)
                    }}
                    onBlur={() => {
                      const v = clampMinutes(draft, custom, cfg.session.minMinutes, cfg.session.maxMinutes)
                      setCustom(v)
                      setDraft(String(v))
                    }}
                    aria-invalid={clampMinutes(draft, custom, cfg.session.minMinutes, cfg.session.maxMinutes) !== Number(draft)}
                    className="h-11 w-24 bg-dusk-900 px-3 font-num text-2xl text-mist-50 shadow-frame inset-shadow-well"
                  />
                  <span className="text-mist-300">{t('common.min')}</span>
                </label>
              )}
              <p className="mt-3 text-mist-300">
                {t('home.plan.waves', { count: waves })} {t('home.plan.endsAt', { time: fmtClock(endsAt, tz, lng) })}
              </p>
            </div>

            <div {...hintAnchor('home.weather')}>
              <WeatherPicker profile={player.profile} />
            </div>

            <AutoDamageToggle />
            <MicToggle />

            {allOut ? (
              <p {...hintAnchor('home.energy')} className="flex items-start gap-2 bg-dusk-900 p-3 text-sm text-amber-400 inset-shadow-well" role="status">
                <PixelIcon name="bolt" size={20} className="mt-0.5 shrink-0" />
                <span>{t('home.plan.allExhausted')}</span>
              </p>
            ) : tired.length > 0 && (
              <p {...hintAnchor('home.energy')} className="flex items-start gap-2 bg-dusk-900 p-3 text-sm text-amber-400 inset-shadow-well">
                <PixelIcon name="bolt" size={20} className="mt-0.5 shrink-0" />
                <span>{t('home.plan.tired', { names: tired.map((v: PokemonView) => names.pokemon(v.pokemon)).join(', '), count: tired.length })}</span>
              </p>
            )}

            <div className="flex flex-wrap items-center gap-4">
              <Button {...hintAnchor('home.start')} size="lg" icon="play" onClick={() => void onStart()} disabled={busy} aria-busy={busy} className="min-w-64">
                {t('home.plan.start')}
                <span className="font-num text-4xl leading-none">{t('home.plan.startMinutes', { count: minutes })}</span>
              </Button>
              <p className="max-w-[34ch] text-sm text-mist-400">{t('home.plan.startNote')}</p>
            </div>
          </div>
        </Panel>

        <div className="flex flex-col gap-8">
          {breakOffer && <BreakOffer />}
          <GroupStudyPanel minutes={minutes} />
          <Checklist />
          <ConditionsPanel rows={cond.rows} minutes={minutes} />
          <LeaguePanel now={now} />
        </div>
      </div>
    </div>
  )
}

/** Free team slots: ghost platforms and one plate that says how to fill them. */
function EmptySlots({ count, night }: { count: number; night: boolean }) {
  const { t } = useTranslation()
  // One or two free slots: ghost platforms in the same column width as the cards, so the row never wraps.
  if (count <= 2) {
    return (
      <>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex w-[10.5rem] flex-col items-center">
            <div className="flex h-36 w-full items-end justify-center">
              <Platform width={112} ghost night={night} className="opacity-80" />
            </div>
            <a
              href="#/team"
              className="mt-2 flex min-h-[6.75rem] w-full flex-col items-center justify-center bg-ink/25 px-3 py-3 text-center outline-2 -outline-offset-2 outline-mist-50/40 outline-dashed hover:bg-ink/35"
            >
              <span className="font-display text-base text-mist-50">{t('team.emptySlots', { count: 1 })}</span>
              <span className="mt-1 text-xs text-mist-50/85">{t('team.emptySlotShort')}</span>
            </a>
          </div>
        ))}
      </>
    )
  }
  return (
    <div className="flex min-w-[15rem] flex-1 flex-col">
      <div className="flex h-36 items-end justify-around overflow-hidden">
        {Array.from({ length: count }, (_, i) => (
          <Platform key={i} width={112} ghost night={night} className={cx('shrink-0 opacity-80', i >= 2 && 'max-xl:hidden', i >= 1 && 'max-sm:hidden')} />
        ))}
      </div>
      <div className="mt-2 flex min-h-[6.75rem] flex-col items-center justify-center bg-ink/25 px-4 py-3 text-center outline-2 -outline-offset-2 outline-mist-50/40 outline-dashed">
        <p className="font-display text-lg text-mist-50">{t('team.emptySlots', { count })}</p>
        <p className="mt-1 max-w-[40ch] text-sm text-mist-50/85">{t('team.emptySlotHow')}</p>
      </div>
    </div>
  )
}

function ConditionsPanel({ rows, minutes }: { rows: ReturnType<typeof conditionsNow>['rows']; minutes: number }) {
  const { t } = useTranslation()
  const player = usePlayer()
  const teamTypes = new Set(player.team.flatMap((u) => {
    const p = player.pokemon[u]
    return p ? (defaultContext().speciesBySlug.get(p.speciesSlug)?.types ?? []) : []
  }))
  const mine = rows.filter((r) => teamTypes.has(r.type))
  const others = rows.filter((r) => !teamTypes.has(r.type) && r.active && r.type !== 'normal')
  const values = conditionRuleValues(minutes)
  return (
    <Panel title={t('conditions.title')} help="home.conditions" {...hintAnchor('home.conditions')}>
      <ul className="flex flex-col gap-3">
        {mine.map((r) => (
          <li key={r.type} className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
            <TypeBadge type={r.type} size="md" muted={!r.active} />
            <p className="text-sm leading-snug text-mist-300">{t(`conditions.rule.${r.type}`, values)}</p>
            {r.active ? (
              <span className="font-num text-2xl leading-none text-leaf-400">×{r.mult.toFixed(2)}</span>
            ) : (
              <span className="pt-0.5 text-sm text-mist-400">{t('conditions.off')}</span>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <div className="mt-5 bg-dusk-900 p-3 inset-shadow-well">
          <p className="mb-2 text-sm text-mist-300">{t('conditions.othersActive')}</p>
          <div className="flex flex-wrap gap-2">
            {others.map((r) => (
              <span key={r.type} className="inline-flex items-center gap-1.5">
                <TypeBadge type={r.type} />
                <span className="font-num text-lg leading-none text-leaf-400">×{r.mult.toFixed(2)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <TypesGuide minutes={minutes} />
      </div>
    </Panel>
  )
}

function LeaguePanel({ now }: { now: number }) {
  const { t, i18n } = useTranslation()
  const player = usePlayer()
  const league = currentLeague(player, now)
  const points = weeklyPoints(player, now)
  const next = nextLeagueProgress(player, now)
  const maxWave = currentMaxWaveSize(player, now)
  const threshold = next ? points + next.pointsNeeded : points
  return (
    <Panel title={t('league.title')} help="home.league" {...hintAnchor('home.league')}>
      <div className="flex items-center gap-4">
        <span className={cx('grid size-14 shrink-0 place-items-center shadow-frame', LEAGUE_BG[league])}>
          <PixelIcon name="league" size={30} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl">{t(`league.names.${league}`)}</p>
          <p className="text-sm text-mist-300">{t('league.maxWave', { count: maxWave })}</p>
        </div>
        <div className="text-right">
          <p className="font-num text-3xl leading-none tabular">{fmtInt(points, i18n.language)}</p>
          <p className="text-xs text-mist-400">{t('league.weekPoints')}</p>
        </div>
      </div>
      {next ? (
        <div className="mt-4">
          <ProgressBar variant="volt" value={points} max={threshold} label={t('league.progressLabel', { league: t(`league.names.${next.next}`) })} />
          <p className="mt-2 text-sm text-mist-300">
            {t('league.toNext', { points: fmtInt(next.pointsNeeded, i18n.language), league: t(`league.names.${next.next}`) })}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-mist-300">{t('league.top')}</p>
      )}
      <p className="mt-1 text-xs text-mist-400">{t('league.resets')}</p>
    </Panel>
  )
}

const LEAGUE_BG: Record<string, string> = {
  base: 'bg-dusk-600 text-mist-100',
  super: 'bg-exp-400 text-ink',
  ultra: 'bg-volt-400 text-ink',
  master: 'bg-type-psychic text-ink',
}

