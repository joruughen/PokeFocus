/**
 * Study-group scenes (GDD §9.2): every player is a small stage with their character (the trainer sprite they
 * picked in the profile) next to their leader, and the rest of the team standing behind. Mine is always first and
 * looks exactly like everybody else's. A page holds 4 players; with more, an arrow on the right moves on.
 * Pure display: `GroupStudy.tsx` builds the players from the server's group view.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GroupMon } from '../../../game/protocol'
import { IconButton, PixelIcon, Platform, Sprite, Stage, TrainerSprite } from '../../components'
import type { TimeOfDay } from '../../lib/conditions'
import { cx } from '../../lib/cx'
import { useElementWidth } from '../../lib/useElementWidth'
import { useNames } from '../../lib/names'

/** Players per page: me and three partners, then the next four (a group has 8 at most). */
export const PLAYERS_PER_PAGE = 4

/** `ready`: accepted, waiting in the lobby · `in`: studying · `done`: finished · `left`: out of the group. */
export type SceneState = 'ready' | 'in' | 'done' | 'left'

export interface ScenePlayer {
  userId: string
  name: string
  /** Slug of their character. */
  trainer: string
  /** Up to 6, leader first. */
  team: GroupMon[]
  you: boolean
  host: boolean
  state: SceneState
  /** The state in words (already translated). */
  stateText: string
}

/** Me first, then the rest in the order given. */
export function meFirst<T extends { userId: string }>(players: T[], meId: string | undefined): T[] {
  const mine = players.filter((p) => p.userId === meId)
  return [...mine, ...players.filter((p) => p.userId !== meId)]
}

export function pageCount(players: number): number {
  return Math.max(1, Math.ceil(players / PLAYERS_PER_PAGE))
}

const STATE_DOT: Record<SceneState, string> = { ready: 'bg-leaf-400', in: 'bg-leaf-400', done: 'bg-exp-400', left: 'bg-dusk-500' }

/** From this width (px) a scene draws the team at double size. */
const WIDE_SCENE = 460

/** A sprite standing on its platform. */
function Standing({ width, children, className }: { width: number; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('relative flex shrink-0 flex-col items-center', className)} style={{ width }}>
      <Platform width={width} className="absolute bottom-0 left-1/2 -translate-x-1/2" />
      {children}
    </div>
  )
}

export function PlayerScene({ player, time }: { player: ScenePlayer; time: TimeOfDay }) {
  const { t } = useTranslation()
  const names = useNames()
  // Sizes follow the room the scene has, not the screen: the same scene sits in a narrow column or a wide one.
  const [ref, width] = useElementWidth<HTMLLIElement>()
  const wide = width >= WIDE_SCENE
  const [leader, ...others] = player.team
  const dim = player.state === 'left' || player.state === 'done'
  const monName = (m: GroupMon) => (m.shiny ? `${names.species(m.slug)} (${t('pokemon.shiny')})` : names.species(m.slug))
  // Natural scale in a narrow scene, double in a wide one; the leader is always the biggest.
  const otherScale = wide ? 2 : 1
  const otherPlatform = wide ? 84 : 50
  return (
    <li ref={ref} className="min-w-0 bg-dusk-800 shadow-frame">
      <header className="flex min-w-0 items-center gap-2 px-3 py-2">
        {player.host && <PixelIcon name="crown" size={16} className="shrink-0 text-volt-400" />}
        <h3 className={cx('min-w-0 truncate font-display text-lg leading-tight', player.state === 'left' && 'text-mist-400 line-through decoration-1')}>{player.name}</h3>
        {player.you && <span className="shrink-0 bg-volt-400 px-1.5 font-display text-sm leading-5 text-ink">{t('group.scene.you')}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-mist-300">
          <span aria-hidden className={cx('size-2.5', STATE_DOT[player.state])} />
          {player.stateText}
        </span>
      </header>
      <Stage time={time} weather="clear" celestial={false} className={cx('shadow-none!', dim && 'opacity-60 saturate-50')}>
        <div className="flex flex-col items-center gap-y-2 px-2 pt-6 pb-4">
          <div className="flex items-end justify-center">
            <Standing width={104}>
              <TrainerSprite slug={player.trainer} scale={2} flip alt={t(`trainers.names.${player.trainer}`)} className="relative -mb-1" />
            </Standing>
            {leader && (
              <Standing width={wide ? 144 : 112} className="-ml-3">
                <Sprite kind="showdown" slug={leader.slug} shiny={leader.shiny} scale={2} maxHeight={wide ? 168 : 132} maxWidth={wide ? 150 : 116} flip alt={monName(leader)} className="relative mb-3 motion-safe:animate-bob" style={{ animationDuration: '0.7s' }} />
              </Standing>
            )}
          </div>
          {others.length > 0 && (
            <div className={cx('flex flex-wrap items-end justify-center gap-y-2', wide ? 'gap-x-1' : 'gap-x-0.5')}>
              {others.map((m, i) => (
                <Standing key={`${m.slug}-${i}`} width={otherPlatform}>
                  <Sprite
                    kind="showdown"
                    slug={m.slug}
                    shiny={m.shiny}
                    scale={otherScale}
                    maxHeight={wide ? 104 : 64}
                    maxWidth={otherPlatform + (wide ? 8 : 14)}
                    flip
                    alt={monName(m)}
                    className="relative mb-2 motion-safe:animate-bob"
                    style={{ animationDelay: `${(i + 1) * 0.2}s`, animationDuration: '0.7s' }}
                  />
                </Standing>
              ))}
            </div>
          )}
        </div>
      </Stage>
    </li>
  )
}

/**
 * The scenes, four to a page. With more than four players an arrow on the right edge goes to the next page
 * (and back) with a page indicator; the page keeps its place when somebody joins or leaves.
 */
export function GroupRoster({ players, time, label, initialPage = 0, className }: { players: ScenePlayer[]; time: TimeOfDay; label: string; initialPage?: number; className?: string }) {
  const { t } = useTranslation()
  const [asked, setPage] = useState(initialPage)
  const pages = pageCount(players.length)
  const page = Math.min(Math.max(0, asked), pages - 1)
  const shown = players.slice(page * PLAYERS_PER_PAGE, (page + 1) * PLAYERS_PER_PAGE)
  const paged = pages > 1
  return (
    <div className={cx('@container relative', className)}>
      <ul aria-label={label} className={cx('grid grid-cols-1 gap-4 @[56rem]:grid-cols-2', paged && 'pr-10')}>
        {shown.map((p) => (
          <PlayerScene key={p.userId} player={p} time={time} />
        ))}
      </ul>
      {paged && (
        <nav aria-label={t('group.scene.pages')} className="absolute inset-y-0 right-0 flex w-9 flex-col items-center justify-center gap-2">
          {page > 0 && <IconButton icon="back" size="sm" label={t('group.scene.prev', { page, pages })} onClick={() => setPage(page - 1)} />}
          <span className="font-num text-xl leading-none tabular text-mist-100" aria-live="polite" aria-atomic="true">
            <span aria-hidden>
              {page + 1}/{pages}
            </span>
            <span className="sr-only">{t('group.scene.page', { page: page + 1, pages })}</span>
          </span>
          {page < pages - 1 && <IconButton icon="next" size="sm" label={t('group.scene.next', { page: page + 2, pages })} onClick={() => setPage(page + 1)} />}
        </nav>
      )}
    </div>
  )
}
