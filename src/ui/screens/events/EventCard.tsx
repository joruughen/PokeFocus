import { useTranslation } from 'react-i18next'
import { defaultContext, type MissionReward, type MissionView, type TimeZoneSpec, type TypeSlug } from '../../../engine'
import type { LiveEventPublic } from '../../../game/protocol'
import { PixelIcon, ProgressBar, RichText, Sprite } from '../../components'
import { cx } from '../../lib/cx'
import { fmtInt } from '../../lib/format'
import { asLocale, itemName, typeName } from '../../lib/names'
import { FeaturedList } from './FeaturedList'
import { eventItemName, eventPhase, eventText, fmtChance, fmtMult, formatEventWhen, imageSrcSet, missionLines, remainingKey, remainingParts, shinyBoost, type EventPhase } from './model'

export interface EventCardProps {
  event: LiveEventPublic
  /** Server-corrected "now" (ms). */
  now: number
  /** The player's time zone: dates are shown in it. */
  tz?: TimeZoneSpec
  /** Base shiny chance, to say "Shiny ×N". */
  baseShinyChance: number
  /** The player's own slots for this event (`missionsView().event[i].missions`); absent = show the event's missions as defined. */
  missionViews?: readonly MissionView[]
  /** The player's trainer level: featured species that cannot show up at it yet are dimmed and tagged. Absent (the admin's preview) = no marks. */
  trainerLevel?: number
  /** Heading level of the event name. */
  headingLevel?: 2 | 3
  /** Section the card sits in (decides the badge and the countdown); default: derived from the dates. */
  phase?: EventPhase
  className?: string
}

const PHASE_BADGE: Record<EventPhase, string> = {
  active: 'bg-volt-400 text-ink',
  upcoming: 'bg-amber-400 text-ink',
  past: 'bg-dusk-600 text-mist-100',
}

/**
 * One live event as players see it (Events page, and the admin's preview of a draft): 16:9 image
 * (the 480 px version in lists, `srcset` for wide screens), dates in the player's zone, a countdown,
 * featured species, shiny / legendary boosts, drops and the event's missions.
 */
export function EventCard({ event, now, tz, baseShinyChance, missionViews, trainerLevel, headingLevel = 3, phase, className }: EventCardProps) {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  const ph = phase ?? eventPhase(event, now)
  const H = headingLevel === 2 ? 'h2' : 'h3'
  const name = eventText(event.name, lng)
  const shiny = shinyBoost(event, baseShinyChance)
  const missions = missionLines(event, missionViews, lng, trainerLevel ?? 1, (ty) => typeName(ty, lng))
  const ctxItems = defaultContext().data.items

  const remain = ph === 'active' ? event.endsAt - now : ph === 'upcoming' ? event.startsAt - now : 0
  const rem = remainingKey(remainingParts(remain))
  const countdown = ph === 'past' ? t('events.ended', { when: formatEventWhen(event.endsAt, tz, i18n.language) }) : t(ph === 'active' ? 'events.endsIn' : 'events.startsIn', { time: t(`events.remaining.${rem.key}`, rem.values) })

  const itemLabel = (slug: string) => eventItemName(event, slug, lng) ?? itemName(slug, lng)
  const itemIcon = (slug: string, fit: number) =>
    ctxItems.some((i) => i.slug === slug) ? <Sprite kind="item" slug={slug} fit={fit} alt="" /> : <PixelIcon name="sparkle" size={20} className="text-type-psychic" />

  return (
    <article aria-labelledby={`ev-${event.id}`} className={cx('flex flex-col bg-dusk-800 shadow-plate', ph === 'past' && 'opacity-90', className)}>
      {event.image && (
        <img
          src={event.image.thumbUrl}
          srcSet={imageSrcSet(event.image)}
          sizes="(min-width: 1280px) 36rem, (min-width: 640px) 60vw, 100vw"
          width={480}
          height={270}
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-video w-full bg-dusk-900 object-cover"
        />
      )}
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={cx('px-1.5 pt-0.5 font-display text-sm leading-tight uppercase', PHASE_BADGE[ph])}>{t(`events.badge.${ph}`)}</span>
            <span className="text-sm text-mist-300">{countdown}</span>
          </div>
          <H id={`ev-${event.id}`} className={cx('break-words', headingLevel === 2 ? 'text-2xl' : 'text-xl')}>
            {name}
          </H>
          <p className="text-sm text-mist-300">
            <PixelIcon name="clock" size={10} className="mr-1.5 inline-block align-baseline" />
            {t('events.window', { start: formatEventWhen(event.startsAt, tz, i18n.language), end: formatEventWhen(event.endsAt, tz, i18n.language) })}
          </p>
        </header>

        <RichText text={eventText(event.description, lng)} className="max-w-[70ch] text-mist-100" />

        {(shiny || event.legendaryChanceMult !== undefined) && (
          <ul className="flex flex-wrap gap-2" aria-label={t('events.boosts')}>
            {shiny && (
              <li className="inline-flex items-center gap-1.5 bg-dusk-900 px-2 py-1 inset-shadow-well">
                <PixelIcon name="sparkle" size={20} className="text-amber-400" />
                <span className="font-display text-base">
                  {shiny.mult !== null && shiny.mult > 1.04 ? t('events.shinyMult', { n: fmtMult(shiny.mult) }) : t('events.shinyChance', { pct: fmtChance(shiny.chance, i18n.language) })}
                </span>
                <span className="text-sm text-mist-300">{t(`events.shinyScope.${shiny.scope}`)}</span>
              </li>
            )}
            {event.legendaryChanceMult !== undefined && (
              <li className="inline-flex items-center gap-1.5 bg-dusk-900 px-2 py-1 inset-shadow-well">
                <PixelIcon name="crown" size={20} className="text-volt-400" />
                <span className="font-display text-base">{t('events.legendaryMult', { n: fmtMult(event.legendaryChanceMult) })}</span>
              </li>
            )}
          </ul>
        )}

        {event.featured.length > 0 && (
          <section aria-label={t('events.featured')} className="flex flex-col gap-2">
            <h4 className="font-display text-base text-mist-300">{t('events.featured')}</h4>
            <FeaturedList featured={event.featured} trainerLevel={trainerLevel} note />
          </section>
        )}

        {event.drops.length > 0 && (
          <section aria-label={t('events.drops')} className="flex flex-col gap-2">
            <h4 className="font-display text-base text-mist-300">{t('events.drops')}</h4>
            <ul className="flex flex-col gap-1.5">
              {event.drops.map((d) => (
                <li key={d.item} className="flex items-center gap-2">
                  <span className="grid size-8 shrink-0 place-items-center">{itemIcon(d.item, 32)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words leading-tight">{itemLabel(d.item)}</span>
                    <span className="block text-sm text-mist-300">{t('events.dropRule', { pct: fmtChance(d.perWaveChance, i18n.language), max: d.max })}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {missions.length > 0 && (
          <section aria-label={t('events.missions')} className="flex flex-col gap-2">
            <h4 className="font-display text-base text-mist-300">{t('events.missions')}</h4>
            <ul className="flex flex-col gap-2">
              {missions.map((m) => (
                <li key={m.id} className={cx('flex flex-col gap-1.5 bg-dusk-900 p-3 inset-shadow-well', m.claimed && 'opacity-60')}>
                  <p className="font-display text-base leading-tight break-words">{m.title}</p>
                  <p className="text-sm break-words text-mist-300">{m.description}</p>
                  {m.progress !== null && (
                    <ProgressBar
                      variant={m.completed ? 'energy' : 'volt'}
                      size="sm"
                      value={Math.min(m.progress, m.target)}
                      max={m.target}
                      label={m.title}
                      valueText={`${fmtInt(Math.min(m.progress, m.target), i18n.language)}/${fmtInt(m.target, i18n.language)}`}
                    />
                  )}
                  <RewardLine reward={m.reward} itemLabel={itemLabel} />
                </li>
              ))}
            </ul>
            {ph === 'active' && (
              <a href="#/missions" className="self-start text-sm text-volt-300 underline underline-offset-2 hover:text-volt-200">
                {t('events.goMissions')}
              </a>
            )}
          </section>
        )}
      </div>
    </article>
  )
}

function RewardLine({ reward, itemLabel }: { reward: MissionReward; itemLabel: (slug: string) => string }) {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  const parts = [
    ...Object.entries(reward.items).map(([k, n]) => `${itemLabel(k)} ×${n}`),
    reward.dust > 0 ? `${t('items.dust')} +${fmtInt(reward.dust, i18n.language)}` : '',
    ...Object.entries(reward.typeCandies).map(([ty, n]) => `${t('bag.typeCandy', { type: typeName(ty as TypeSlug, lng) })} ×${n}`),
  ].filter(Boolean)
  if (parts.length === 0) return null
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
      <span className="text-mist-400">{t('missions.reward')}</span>
      <span className="break-words text-mist-100">{parts.join(', ')}</span>
    </p>
  )
}
