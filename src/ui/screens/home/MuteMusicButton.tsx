import { useTranslation } from 'react-i18next'
import { focusMusicAudible, focusMusicPatch } from '../../../audio'
import { Button } from '../../components'
import { usePrefs } from '../../store/prefs'

/**
 * Mutes or restores the focus music without leaving the session. It only
 * switches "music during focus" (the same option as in Settings), so volumes
 * and sound effects, including the end-of-session chime, stay as they are.
 * A toggle button: the label stays the same and `aria-pressed` says whether
 * the music is muted.
 */
export function MuteMusicButton({ className }: { className?: string }) {
  const { t } = useTranslation()
  const settings = usePrefs((s) => s.audio)
  const setAudio = usePrefs((s) => s.setAudio)
  const audible = focusMusicAudible(settings)
  return (
    <Button
      size="lg"
      variant="ghost"
      icon={audible ? 'volume' : 'volumeOff'}
      aria-pressed={!audible}
      title={t('focus.muteMusicHint')}
      onClick={() => setAudio(focusMusicPatch(settings, !audible))}
      className={className}
    >
      {t('focus.musicOn')}
    </Button>
  )
}
