import type { ReactNode } from 'react'
import { cx } from '../lib/cx'
import { Mascot, type MascotPose } from './Mascot'

export interface EmptyStateProps {
  /** What this area is ("Tu caja"). */
  title: ReactNode
  /** How to fill it, in one or two sentences. */
  body: ReactNode
  /** The next action (a Button). Empty states always invite to act. */
  action?: ReactNode
  pose?: MascotPose
  className?: string
}

/** Teaching empty state (NN/g): what it is, how to fill it, a button. Spoken by the mascot. */
export function EmptyState({ title, body, action, pose = 'think', className }: EmptyStateProps) {
  return (
    <div className={cx('mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-12 text-center', className)}>
      <Mascot pose={pose} size={144} />
      <h2 className="text-2xl">{title}</h2>
      <p className="max-w-[46ch] text-mist-300">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
