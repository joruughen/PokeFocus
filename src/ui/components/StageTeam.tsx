import { cx } from '../lib/cx'
import { useMinWidth } from '../lib/useMinWidth'
import { Sprite } from './Sprite'
import { Platform } from './Stage'
import { TrainerSprite } from './TrainerSprite'

export interface StageTeamMember {
  uid: string
  slug: string
  shiny?: boolean
  /** Accessible name (the species name). */
  name: string
  /** Faded sprite (asleep during the session). */
  faded?: boolean
}

export interface StageTeamProps {
  members: StageTeamMember[]
  night?: boolean
  /** Bobbing idle animation (off for the calm break scene). */
  bob?: boolean
  /** Dimmed platforms and sprites (the calm `focus` stage variant). */
  dim?: boolean
  /**
   * Slug of the player's character, on its own platform: at the left of the team from `sm` (double size) and in a
   * phone with a team of one or two; in front of a bigger team on a phone (natural size, after the team: the free
   * slot of the last row, or a row of its own: the stage must then be taller, see `teamStageHeight`).
   */
  trainer?: string | null
  className?: string
}

/**
 * Height classes of a stage that holds a `StageTeam` (the session screen): 18 rem, and on a phone 24 rem when a team
 * of six has its trainer in front (three rows instead of two). Whole class names, so Tailwind sees them.
 */
export const teamStageHeight = (members: number, trainer: boolean): string => (trainer && members >= 6 ? 'h-72 max-sm:h-96' : 'h-72')

/**
 * The team standing on platforms inside a `Stage`. It wraps instead of cropping:
 * on a narrow screen (390 px) six members take two rows of three, so the outer
 * sprites are never cut by the stage's `overflow-hidden` (QA R-05).
 */
export function StageTeam({ members, night = false, bob = true, dim = false, trainer = null, className }: StageTeamProps) {
  const wide = useMinWidth(640)
  // Double size when there is room: from `sm`, or on a phone with a team of one or two (they fit on one row).
  const big = wide || members.length <= 2
  // From `sm` the trainer is the first of one row; on a phone with a bigger team it stands in front (last), so the
  // team keeps its two rows of three and the trainer takes the free slot (or a row of its own).
  const first = big
  return (
    <div className={cx('flex flex-wrap content-end items-end justify-center gap-x-2 gap-y-3 px-3 pb-6 sm:px-6', trainer ? 'sm:gap-x-4' : 'sm:gap-x-6', className)}>
      {trainer && (
        <div className={cx('relative flex flex-col items-center', first ? 'order-first' : 'order-last', wide ? 'w-28' : big ? 'w-32' : 'w-24')}>
          <Platform width={104} night={night} className={cx('absolute bottom-0 left-1/2 -translate-x-1/2', dim && 'brightness-75')} />
          <TrainerSprite slug={trainer} scale={big ? 2 : 1} flip alt="" className={cx('relative', big ? '-mb-1' : 'mb-1', dim && 'brightness-90')} />
        </div>
      )}
      {members.map((m, i) => (
        <div key={m.uid} className="relative flex w-24 flex-col items-center sm:w-28">
          <Platform width={104} night={night} className={cx('absolute bottom-0 left-1/2 -translate-x-1/2', dim && 'brightness-75')} />
          <Sprite
            kind="showdown"
            slug={m.slug}
            shiny={m.shiny}
            box={wide ? { height: 204, width: 184 } : { height: 140, width: 112 }}
            flip
            alt={m.name}
            className={cx('relative mb-3', bob && 'motion-safe:animate-bob', dim && 'brightness-90', m.faded && 'opacity-60')}
            style={bob ? { animationDelay: `${i * 0.2}s`, animationDuration: '0.7s' } : undefined}
          />
        </div>
      ))}
    </div>
  )
}
