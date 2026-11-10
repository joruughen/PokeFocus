import { useTranslation } from 'react-i18next'
import { breakMusicAudible, breakMusicPatch, focusMusicAudible, focusMusicPatch, type AudioSettings } from '../../../audio'
import { Button } from '../../components'
import { usePrefs } from '../../store/prefs'

type Phase = 'focus' | 'break'

/**
 * Mutes or restores the music of a session (`phase="focus"`, the default) or of
 * a break (`phase="break"`) without leaving the screen. It only switches that
 * phase's own option ("music during focus" / "music during breaks", the same
 * ones as in Settings), so volumes and sound effects, including the
 * end-of-session chime, stay as they are. A toggle button: the label stays the
 * same and `aria-pressed` says whether the music is muted.
 */
export function MuteMusicButton({ phase = 'focus', className }: { phase?: Phase; className?: string }) {
  const settings = usePrefs((s) => s.audio)
  const setAudio = usePrefs((s) => s.setAudio)
  return <MuteMusicButtonView phase={phase} settings={settings} onPatch={setAudio} className={className} />
}

/** The button itself, with the settings passed in (so it can be rendered and tested without the store). */
export function MuteMusicButtonView({ phase, settings, onPatch, className }: { phase: Phase; settings: AudioSettings; onPatch: (patch: Partial<AudioSettings>) => void; className?: string }) {
  const { t } = useTranslation()
  const isBreak = phase === 'break'
  const audible = isBreak ? breakMusicAudible(settings) : focusMusicAudible(settings)
  const patch = isBreak ? breakMusicPatch : focusMusicPatch
  return (
    <Button
      size="lg"
      variant="ghost"
      icon={audible ? 'volume' : 'volumeOff'}
      aria-pressed={!audible}
      title={t(isBreak ? 'break.muteMusicHint' : 'focus.muteMusicHint')}
      onClick={() => onPatch(patch(settings, !audible))}
      className={className}
    >
      {t('focus.musicOn')}
    </Button>
  )
}
