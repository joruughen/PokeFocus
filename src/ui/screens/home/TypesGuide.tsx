import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addDays,
  conditionOutlook,
  defaultContext,
  localToTs,
  MINUTE_MS,
  toLocal,
  type ConditionOutlook,
  type TypeSlug,
} from '../../../engine'
import { Button, Dialog, PixelIcon, Segmented, Select, TypeBadge } from '../../components'
import { teamConditionTypes } from '../../lib/conditions'
import { cx } from '../../lib/cx'
import { fmtWeekday } from '../../lib/format'
import { useNow } from '../../store/clock'
import { usePlayer } from '../../store/selectors'
import { conditionRuleValues } from './conditionCopy'
import { activationText, whenText, type GuideTextEnv } from './typesGuideText'

const cfg = defaultContext().config
const DAYS_AHEAD = 7
/** Types whose multiplier grows with something (sessions today, Bug team members). */
const VARIABLE: ReadonlySet<TypeSlug> = new Set(['poison', 'bug'])

const pad = (n: number) => String(n).padStart(2, '0')

/** "Todos los tipos" button and the dialog it opens. The panel around it stays as it is. */
export function TypesGuide({ minutes }: { minutes: number }) {
  const { t } = useTranslation()
  return (
    <Dialog
      size="lg"
      title={t('typesGuide.title')}
      description={t('typesGuide.description')}
      trigger={
        <Button variant="secondary" size="sm" icon="dex">
          {t('typesGuide.open')}
        </Button>
      }
    >
      <GuideBody minutes={minutes} />
    </Dialog>
  )
}

/** Mounted only while the dialog is open. */
function GuideBody({ minutes }: { minutes: number }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const player = usePlayer()
  const now = useNow()
  const tz = player.profile.timezone

  // What the player changed. Untouched fields follow the clock and the panel's duration.
  const [dayOffset, setDayOffset] = useState(0)
  const [chosenTime, setChosenTime] = useState<string | null>(null)
  const [chosenMinutes, setChosenMinutes] = useState<number | null>(null)

  const today = toLocal(now, tz)
  const time = chosenTime ?? `${pad(today.hour)}:${pad(today.minute)}`
  const length = chosenMinutes ?? minutes
  const planned = dayOffset !== 0 || chosenTime !== null
  const changed = planned || chosenMinutes !== null
  const nowMinute = Math.floor(now / MINUTE_MS)

  // The start the table is computed for: now, or the chosen day and time (a time already gone today means now).
  const { from, past } = useMemo(() => {
    const clock = nowMinute * MINUTE_MS
    if (!planned) return { from: clock, past: false }
    const [h = 0, m = 0] = time.split(':').map(Number)
    const at = localToTs(addDays(toLocal(clock, tz).dayKey, dayOffset), h * 60 + m, tz)
    return at < clock ? { from: clock, past: true } : { from: at, past: false }
  }, [planned, time, dayOffset, nowMinute, tz])
  const sameDay = toLocal(from, tz).dayKey === today.dayKey

  const outlook = useMemo(
    // Today's weather is the one the player set; another day's cannot be known.
    () => conditionOutlook(player, from, length, sameDay ? {} : { weather: null }),
    [player, from, length, sameDay],
  )
  const team = useMemo(() => teamConditionTypes(player, from), [player, from])
  const rows = useMemo(() => sortRows(outlook, team), [outlook, team])
  const activeCount = outlook.filter((o) => o.active).length

  // Day words ("mañana") are counted from the real now, so the sentences only change when the day does.
  const env: GuideTextEnv = { t, lng, tz, now, minutes: length }
  const values = useMemo(() => conditionRuleValues(length), [length])
  const texts = useMemo(
    () => new Map(outlook.map((o) => [o.type, activationText(env, o)] as const)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outlook, t, lng, tz, today.dayKey, length],
  )

  const reset = () => {
    setDayOffset(0)
    setChosenTime(null)
    setChosenMinutes(null)
  }
  const dayOptions = Array.from({ length: DAYS_AHEAD }, (_, i) => {
    if (i === 0) return { value: '0', label: t('typesGuide.planner.today') }
    if (i === 1) return { value: '1', label: t('typesGuide.planner.tomorrow') }
    const ts = localToTs(addDays(today.dayKey, i), 12 * 60, tz)
    const wd = fmtWeekday(ts, tz, lng)
    return { value: String(i), label: `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${toLocal(ts, tz).day}` }
  })
  const lengths = [...new Set([...cfg.session.presets, minutes, length])].sort((a, b) => a - b)

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="types-planner" className="bg-dusk-900 p-4 inset-shadow-well">
        <h3 id="types-planner" className="mb-3 text-lg">
          {t('typesGuide.planner.title')}
        </h3>
        <div className="grid grid-cols-1 gap-4 min-[30rem]:grid-cols-2">
          <Select label={t('typesGuide.planner.day')} options={dayOptions} value={String(dayOffset)} onChange={(v) => setDayOffset(Number(v))} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="types-planner-time" className="font-display text-base text-mist-300">
              {t('typesGuide.planner.time')}
            </label>
            <input
              id="types-planner-time"
              type="time"
              value={time}
              onChange={(e) => e.target.value && setChosenTime(e.target.value)}
              className="min-h-11 bg-dusk-950 px-3 font-num text-2xl text-mist-50 shadow-frame inset-shadow-well [color-scheme:dark]"
            />
          </div>
          <div className="flex flex-col gap-1.5 min-[30rem]:col-span-2">
            <span className="font-display text-base text-mist-300">
              {t('typesGuide.planner.duration')}
            </span>
            <Segmented
              label={t('typesGuide.planner.duration')}
              value={String(length)}
              onChange={(v) => setChosenMinutes(Number(v))}
              options={lengths.map((m) => ({
                value: String(m),
                ariaLabel: t('common.minutes', { count: m }),
                label: <span className="font-num text-2xl leading-none">{m}</span>,
              }))}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="min-w-0 flex-1 basis-60 text-mist-50">
            {t(planned ? 'typesGuide.summary.plan' : 'typesGuide.summary.now', { count: activeCount, when: whenText(env, from, true) })}
          </p>
          {changed && (
            <Button variant="ghost" size="sm" icon="reroll" onClick={reset}>
              {t('typesGuide.planner.reset')}
            </Button>
          )}
        </div>
        {past && <p className="mt-2 text-sm text-amber-400">{t('typesGuide.planner.past')}</p>}
        <p className="mt-2 text-sm text-mist-300">{t('typesGuide.planner.note')}</p>
      </section>

      <ul aria-label={t('typesGuide.list')} className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.map((o) => {
          const mine = team.has(o.type)
          const variable = VARIABLE.has(o.type)
          const shown = o.active ? o.mult : o.maxMult
          const next = texts.get(o.type)
          return (
            <li
              key={o.type}
              className={cx('flex flex-col gap-2 bg-dusk-900 p-3 inset-shadow-well', mine && 'outline-2 -outline-offset-2 outline-volt-400')}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <TypeBadge type={o.type} size="md" />
                {mine && (
                  <span className="inline-flex items-center gap-1 font-display text-base text-volt-400">
                    <PixelIcon name="star" size={10} />
                    {t('typesGuide.team')}
                  </span>
                )}
                <div className="ml-auto text-right">
                  <p className="flex items-baseline justify-end gap-1.5">
                    {variable && !o.active && <span className="text-sm text-mist-400">{t('typesGuide.upToWord')}</span>}
                    <span className={cx('font-num text-2xl leading-none tabular', o.active ? 'text-leaf-400' : 'text-mist-400')}>×{shown.toFixed(2)}</span>
                  </p>
                  <p className={cx('flex items-center justify-end gap-1 text-sm', o.active ? 'text-leaf-400' : 'text-mist-400')}>
                    {o.active && <PixelIcon name="check" size={10} />}
                    {o.active ? t('typesGuide.active') : t('typesGuide.inactive')}
                    {variable && o.active && <span className="text-mist-400">, {t('typesGuide.upTo', { mult: o.maxMult.toFixed(2) })}</span>}
                  </p>
                </div>
              </div>
              <p className="text-sm leading-snug text-mist-300">{t(`conditions.rule.${o.type}`, values)}</p>
              {next && <p className={cx('text-sm leading-snug', o.active ? 'text-mist-50' : 'text-volt-300')}>{next}</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The team's types first, then the active ones, then by how soon each switches on (unknown last), then Pokédex order. */
function sortRows(rows: ConditionOutlook[], team: ReadonlySet<TypeSlug>): ConditionOutlook[] {
  const soon = (o: ConditionOutlook) => ('at' in o.activation && o.activation.at !== null ? o.activation.at : Infinity)
  return rows
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      const ta = team.has(a.o.type) ? 0 : 1
      const tb = team.has(b.o.type) ? 0 : 1
      if (ta !== tb) return ta - tb
      if (a.o.active !== b.o.active) return a.o.active ? -1 : 1
      const sa = soon(a.o)
      const sb = soon(b.o)
      if (sa !== sb) return sa < sb ? -1 : 1
      return a.i - b.i
    })
    .map((x) => x.o)
}
