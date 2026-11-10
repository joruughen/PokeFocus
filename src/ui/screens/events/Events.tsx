import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, missionsView, type MissionView, type TimeZoneSpec } from '../../../engine'
import type { LiveEventPublic } from '../../../game/protocol'
import { Button, EmptyState } from '../../components'
import { useNow } from '../../store/clock'
import { useGame } from '../../store/game'
import { useLiveEvents, type LiveEventsStatus } from '../../store/liveEvents'
import { EventCard } from './EventCard'
import type { EventPhase } from './model'

/** Events (`#/events`): what is on now, what is coming and what just ended, from GET /api/live-events. */
export default function Events() {
  const { t } = useTranslation()
  const now = useNow()
  const live = useLiveEvents()
  const player = useGame((s) => s.player)
  const minute = Math.floor(now / 60_000)
  const missionGroups = useMemo(() => (player ? missionsView(player, minute * 60_000).event : []), [player, minute])
  return (
    <EventsView
      active={live.active}
      upcoming={live.upcoming}
      past={live.past}
      hasMore={live.nextCursor !== null}
      loadingMore={live.loadingMore}
      status={live.status}
      now={now + live.skew}
      tz={player?.profile.timezone}
      trainerLevel={player?.trainer.level}
      baseShinyChance={defaultContext().config.encounters.shinyChance}
      missionViews={(id) => missionGroups.find((g) => g.eventId === id)?.missions}
      onMore={() => void live.loadMore()}
      onRetry={() => void live.load()}
      title={t('events.title')}
    />
  )
}

export interface EventsViewProps {
  active: LiveEventPublic[]
  upcoming: LiveEventPublic[]
  past: LiveEventPublic[]
  hasMore: boolean
  loadingMore: boolean
  status: LiveEventsStatus
  now: number
  tz?: TimeZoneSpec
  trainerLevel?: number
  baseShinyChance: number
  missionViews: (eventId: string) => MissionView[] | undefined
  onMore: () => void
  onRetry: () => void
  title: string
}

/** The page without stores: sections and their empty/loading/error states. */
export function EventsView({ active, upcoming, past, hasMore, loadingMore, status, now, tz, trainerLevel, baseShinyChance, missionViews, onMore, onRetry, title }: EventsViewProps) {
  const { t } = useTranslation()
  const none = active.length + upcoming.length + past.length === 0
  const section = (phase: EventPhase, list: LiveEventPublic[]) => (
    <section aria-labelledby={`events-${phase}`} className="flex flex-col gap-4">
      <h2 id={`events-${phase}`} className="text-2xl">
        {t(`events.section.${phase}`)}
      </h2>
      {list.length === 0 ? (
        <p className="bg-dusk-900 p-4 text-mist-300 inset-shadow-well">{t(`events.empty.${phase}`)}</p>
      ) : (
        <ul className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
          {list.map((e) => (
            <li key={e.id} className="min-w-0">
              <EventCard event={e} now={now} tz={tz} phase={phase} baseShinyChance={baseShinyChance} trainerLevel={trainerLevel} missionViews={missionViews(e.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl">{title}</h1>
        <p className="mt-1 max-w-[70ch] text-mist-300">{t('events.subtitle')}</p>
      </header>

      {status === 'error' && none ? (
        <EmptyState title={t('events.error.title')} body={t('events.error.body')} pose="think" action={<Button onClick={onRetry}>{t('events.error.retry')}</Button>} />
      ) : status !== 'ready' && none ? (
        <p className="py-12 text-center font-display text-lg text-mist-400" role="status">
          {t('common.loading')}
        </p>
      ) : none ? (
        <EmptyState title={t('events.none.title')} body={t('events.none.body')} pose="think" />
      ) : (
        <>
          {section('active', active)}
          {section('upcoming', upcoming)}
          {past.length > 0 && section('past', past)}
          {hasMore && (
            <div>
              <Button variant="secondary" onClick={onMore} disabled={loadingMore}>
                {loadingMore ? t('common.loading') : t('events.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
