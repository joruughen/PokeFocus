import { useTranslation } from 'react-i18next'
import { Button } from '../../components'
import { hintAnchor } from '../../hints'

export interface StartRowProps {
  minutes: number
  busy: boolean
  /** A study-group room (lobby) is open: the group's own Start button is the way in. */
  inGroup: boolean
  onStart: () => void
}

/**
 * The solo "Start" button of the plan panel. While a group room is open it is
 * disabled and a line says why (starting alone would leave the room behind).
 */
export function StartRow({ minutes, busy, inGroup, onStart }: StartRowProps) {
  const { t } = useTranslation()
  const noteId = 'start-note'
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button
        {...hintAnchor('home.start')}
        size="lg"
        icon="play"
        onClick={onStart}
        disabled={busy || inGroup}
        aria-busy={busy}
        aria-describedby={inGroup ? noteId : undefined}
        className="min-w-64"
      >
        {t('home.plan.start')}
        <span className="font-num text-4xl leading-none">{t('home.plan.startMinutes', { count: minutes })}</span>
      </Button>
      <p id={noteId} className="max-w-[34ch] text-sm text-mist-400">
        {inGroup ? t('home.plan.startInGroup') : t('home.plan.startNote')}
      </p>
    </div>
  )
}
