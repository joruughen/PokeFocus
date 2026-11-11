import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, EVENT_MISSION_GRACE_MS, missionsView, type MissionReward, type MissionView, type TimeZoneSpec, type TypeSlug } from '../../../engine'
import { Button, HelpDot, Panel, PixelIcon, ProgressBar, Sprite, toast, Tooltip, TYPE_TEXT } from '../../components'
import { hintAnchor, useHintScreen } from '../../hints'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { fmtInt } from '../../lib/format'
import { formatEventWhen, remainingKey, remainingParts } from '../events/model'
import { pick, useNames } from '../../lib/names'
import { sfx } from '../../lib/sound'
import { useNow } from '../../store/clock'
import { useGame } from '../../store/game'
import { useLiveEvents } from '../../store/liveEvents'
import { useBusy, usePlayer } from '../../store/selectors'

/** Items with a sprite (mission-only placeholders like the Tera Shard get a pixel icon). */

/** Missions (GDD §13): 3 daily, 3 weekly and Pokédex milestones, all from the engine's `missionsView`. */
export default function Missions() {
  useHintScreen('missions')
  const { t, i18n } = useTranslation()
  const names = useNames()
  const now = useNow()
  const player = usePlayer()
  const claim = useGame((s) => s.claimMission)
  const claimAll = useGame((s) => s.claimAllMissions)
  const busy = useBusy()
  // Select the three stable arrays: a selector that builds a new array every call loops forever in zustand v5.
  const liveActive = useLiveEvents((s) => s.active)
  const liveUpcoming = useLiveEvents((s) => s.upcoming)
  const livePast = useLiveEvents((s) => s.past)
  const eventNames = useMemo(() => [...liveActive, ...liveUpcoming, ...livePast], [liveActive, liveUpcoming, livePast])
  const minute = Math.floor(now / 60_000)
  const view = useMemo(() => missionsView(player, minute * 60_000), [player, minute])

  const onClaim = async (m: MissionView) => {
    if (busy) return
    const r = await claim(m.id)
    if (!r.ok) {
      toast.add({ title: errorText(r.error, 'mission'), type: 'danger' })
      return
    }
    sfx('claim')
    setTimeout(() => sfx('heal', { volume: 0.5 }), 260)
    toast.add({ title: t('missions.claimed', { title: pick(m.title, names.lng) }), description: rewardText(r.reward), type: 'success' })
  }
  const onClaimAll = async () => {
    if (busy) return
    const rs = await claimAll()
    if (rs.length === 0) {
      const err = useGame.getState().error
      if (err) toast.add({ title: errorText(err, 'mission'), type: 'danger' })
      return
    }
    sfx('leagueUp')
    toast.add({ title: t('missions.claimedAll', { count: rs.length }), description: rs.map(rewardText).join(', '), type: 'success' })
  }
  const rewardText = (r: MissionReward) =>
    [
      ...Object.entries(r.items).map(([k, n]) => `${names.item(k)} ×${n}`),
      r.dust > 0 ? `${t('items.dust')} +${fmtInt(r.dust, i18n.language)}` : '',
      ...Object.entries(r.typeCandies).map(([ty, n]) => `${t('bag.typeCandy', { type: names.type(ty as TypeSlug) })} ×${n}`),
    ]
      .filter(Boolean)
      .join(', ')

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl">
            {t('missions.title')}
            <HelpDot hint="missions.intro" />
          </h1>
          <p className="mt-1 max-w-[70ch] text-mist-300">{t('missions.subtitle')}</p>
        </div>
        {view.claimable > 0 && (
          <Button icon="star" onClick={() => void onClaimAll()} disabled={busy} data-sfx="none" beacon>
            {t('missions.claimAll', { count: view.claimable })}
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <Panel title={t('missions.daily')} actions={<Renews endsAt={view.daily.endsAt} now={now} />} {...hintAnchor('missions.daily')}>
          <MissionList list={view.daily.missions} onClaim={onClaim} />
        </Panel>
        <Panel title={t('missions.weekly')} actions={<Renews endsAt={view.weekly.endsAt} now={now} />}>
          <MissionList list={view.weekly.missions} onClaim={onClaim} />
        </Panel>
      </div>
      {view.event.map((g) => {
        const named = eventNames.find((e) => e.id === g.eventId)
        return (
          <Panel key={g.eventId} title={named ? pick(named.name, names.lng) : g.slug} actions={<EventRenews endsAt={g.endsAt} active={g.active} now={now} tz={player.profile.timezone} />} aria-label={t('missions.event.group')}>
            <MissionList list={g.missions} onClaim={onClaim} columns />
          </Panel>
        )
      })}
      <Panel title={t('missions.pokedex')} help="missions.pokedex">
        <MissionList list={view.pokedex} onClaim={onClaim} columns />
      </Panel>
    </div>
  )
}

function Renews({ endsAt, now }: { endsAt: number; now: number }) {
  const { t } = useTranslation()
  const mins = Math.max(0, Math.round((endsAt - now) / 60_000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return (
    <span className="flex items-center gap-1.5 text-sm text-mist-300">
      <PixelIcon name="clock" size={10} />
      {d > 0 ? t('missions.renewsDays', { d, h }) : t('missions.renewsHours', { h, m })}
    </span>
  )
}

/** Event groups: how long the event runs, or until when the rewards can still be claimed once it has ended. */
function EventRenews({ endsAt, active, now, tz }: { endsAt: number; active: boolean; now: number; tz: TimeZoneSpec }) {
  const { t, i18n } = useTranslation()
  const rem = remainingKey(remainingParts(endsAt - now))
  return (
    <span className="flex items-center gap-1.5 text-right text-sm text-mist-300">
      <PixelIcon name="clock" size={10} className="shrink-0" />
      {active ? t('events.endsIn', { time: t(`events.remaining.${rem.key}`, rem.values) }) : t('missions.event.claimUntil', { when: formatEventWhen(endsAt + EVENT_MISSION_GRACE_MS, tz, i18n.language) })}
    </span>
  )
}

function MissionList({ list, onClaim, columns }: { list: MissionView[]; onClaim: (m: MissionView) => void; columns?: boolean }) {
  const { t } = useTranslation()
  if (list.length === 0) return <p className="text-sm text-mist-300">{t('missions.none')}</p>
  return (
    <ul className={cx('grid grid-cols-1 gap-3', columns && 'lg:grid-cols-3')}>
      {list.map((m) => (
        <MissionRow key={m.id} m={m} onClaim={() => onClaim(m)} />
      ))}
    </ul>
  )
}

function MissionRow({ m, onClaim }: { m: MissionView; onClaim: () => void }) {
  const busy = useBusy()
  const { t, i18n } = useTranslation()
  const names = useNames()
  const ready = m.completed && !m.claimed
  return (
    <li className={cx('flex flex-col gap-2.5 bg-dusk-900 p-4 inset-shadow-well', ready && 'outline-2 -outline-offset-2 outline-volt-400', m.claimed && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg leading-tight text-mist-50">{pick(m.title, names.lng)}</p>
          <p className="text-sm text-mist-300">{pick(m.description, names.lng)}</p>
        </div>
        {m.claimed ? (
          <span className="inline-flex shrink-0 items-center gap-1 bg-leaf-400 px-1.5 py-0.5 font-display text-sm text-ink shadow-frame">
            <PixelIcon name="check" size={10} />
            {t('missions.done')}
          </span>
        ) : ready ? (
          <Button size="sm" icon="star" onClick={onClaim} disabled={busy} data-sfx="none" className="shrink-0">
            {t('missions.claim')}
          </Button>
        ) : null}
      </div>
      <ProgressBar variant={m.completed ? 'energy' : 'volt'} size="sm" value={Math.min(m.progress, m.target)} max={m.target} label={pick(m.title, names.lng)} valueText={`${fmtInt(Math.min(m.progress, m.target), i18n.language)}/${fmtInt(m.target, i18n.language)}`} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-label={t('missions.reward')}>
        <span className="text-xs text-mist-400">{t('missions.reward')}</span>
        {Object.entries(m.reward.items).map(([k, n]) => (
          <Tooltip key={k} content={names.item(k)}>
            <span tabIndex={0} className="inline-flex items-center gap-1">
              <span className="grid size-7 place-items-center">
                {defaultContext().data.items.some((i) => i.slug === k) ? <Sprite kind="item" slug={k} fit={28} alt="" /> : <PixelIcon name="sparkle" size={20} className="text-type-psychic" />}
              </span>
              <span className="font-num text-lg leading-none">×{n}</span>
            </span>
          </Tooltip>
        ))}
        {m.reward.dust > 0 && (
          <span className="inline-flex items-center gap-1">
            <PixelIcon name="dust" size={20} className="text-exp-400" />
            <span className="font-num text-lg leading-none">+{fmtInt(m.reward.dust, i18n.language)}</span>
          </span>
        )}
        {Object.entries(m.reward.typeCandies).map(([ty, n]) => (
          <Tooltip key={ty} content={t('bag.typeCandy', { type: names.type(ty as TypeSlug) })}>
            <span tabIndex={0} className="inline-flex items-center gap-1">
              <PixelIcon name="candy" size={20} className={TYPE_TEXT[ty as TypeSlug]} />
              <span className="font-num text-lg leading-none">×{n}</span>
            </span>
          </Tooltip>
        ))}
      </div>
    </li>
  )
}
