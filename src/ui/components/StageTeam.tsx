import { cx } from '../lib/cx'
import { Sprite } from './Sprite'
import { Platform } from './Stage'

export interface StageTeamMember {
  uid: string
  slug: string
  shiny?: boolean
  /** Accessible name (the species name). */
  name: string
}

export interface StageTeamProps {
  members: StageTeamMember[]
  night?: boolean
  /** Bobbing idle animation (off for the calm break scene). */
  bob?: boolean
  /** Dimmed platforms and sprites (the calm `focus` stage variant). */
  dim?: boolean
  className?: string
}

/**
 * The team standing on platforms inside a `Stage`. It wraps instead of cropping:
 * on a narrow screen (390 px) six members take two rows of three, so the outer
 * sprites are never cut by the stage's `overflow-hidden` (QA R-05).
 */
export function StageTeam({ members, night = false, bob = true, dim = false, className }: StageTeamProps) {
  return (
    <div className={cx('flex flex-wrap content-end items-end justify-center gap-x-2 gap-y-3 px-3 pb-6 sm:gap-x-6 sm:px-6', className)}>
      {members.map((m, i) => (
        <div key={m.uid} className="relative flex w-24 flex-col items-center sm:w-28">
          <Platform width={104} night={night} className={cx('absolute bottom-0 left-1/2 -translate-x-1/2', dim && 'brightness-75')} />
          <Sprite
            kind="showdown"
            slug={m.slug}
            shiny={m.shiny}
            scale={2}
            flip
            alt={m.name}
            className={cx('relative mb-3', bob && 'motion-safe:animate-bob', dim && 'brightness-90')}
            style={bob ? { animationDelay: `${i * 0.2}s`, animationDuration: '0.7s' } : undefined}
          />
        </div>
      ))}
    </div>
  )
}
