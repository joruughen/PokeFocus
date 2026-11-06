/**
 * Sound profile UI (GDD §4.3): the opt-in toggle (PreSession), the discreet
 * "study style" indicator (FocusSession) and the style line (Results).
 * The analysis itself lives in `lib/mic/`.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, dominantSound, type SessionResult, type SoundProfile } from '../../../engine'
import { PixelIcon, Switch, Tooltip } from '../../components'
import { cx } from '../../lib/cx'
import { fmtPct } from '../../lib/format'
import { dominantOf } from '../../lib/mic/classify'
import { micUnavailable, probeMic, useMic } from '../../lib/mic/monitor'
import { useNames } from '../../lib/names'
import { usePrefs } from '../../store/prefs'
import { HeadphonesSwitch, MicCalibrationDialog } from '../MicSettings'

const cfg = defaultContext().config

/**
 * PreSession: "Analyse my study sound" switch with a one-line status. The
 * first time it is switched on, it offers the calibration wizard (optional,
 * re-runnable from Settings); while on, the headphones option shows below.
 */
export function MicToggle() {
  const { t } = useTranslation()
  const enabled = usePrefs((s) => s.micEnabled)
  const setEnabled = usePrefs((s) => s.setMicEnabled)
  const offered = usePrefs((s) => s.micCalibrationOffered)
  const setOffered = usePrefs((s) => s.setMicCalibrationOffered)
  const [calOpen, setCalOpen] = useState(false)
  const status = useMic((s) => s.status)
  const why = micUnavailable()
  const blocked = why ?? (status === 'denied' || status === 'unsupported' || status === 'error' ? status : null)

  const onChange = async (on: boolean) => {
    if (!on) return setEnabled(false)
    // Ask now, inside the click, so the session never starts with a pending prompt.
    const st = await probeMic()
    setEnabled(st === 'off')
    if (st === 'off' && !offered) {
      setOffered(true)
      setCalOpen(true)
    }
  }

  const note = blocked ? t(`mic.status.${blocked}`) : enabled ? t('mic.onNote') : t('mic.offNote')
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-lg">
            <PixelIcon name="mic" size={18} />
            {t('mic.toggle')}
          </p>
          <p className={cx('text-sm', blocked ? 'text-amber-400' : 'text-mist-400')} role={blocked ? 'status' : undefined}>
            {note}
          </p>
        </div>
        <Switch checked={enabled && !why} disabled={why !== null} onChange={(v) => void onChange(v)} label={t('mic.toggle')} />
      </div>
      {enabled && !blocked && (
        <div className="border-l-2 border-dusk-600 pl-3">
          <HeadphonesSwitch compact />
        </div>
      )}
      <MicCalibrationDialog open={calOpen} onOpenChange={setCalOpen} />
    </div>
  )
}

/** FocusSession: small chip with the study style so far (only when the mic is on). */
export function MicIndicator() {
  const { t } = useTranslation()
  const enabled = usePrefs((s) => s.micEnabled)
  const status = useMic((s) => s.status)
  const tally = useMic((s) => s.tally)
  const current = useMic((s) => s.current)
  if (!enabled) return null
  const style = dominantOf(tally) ?? current
  const problem = status === 'denied' || status === 'insecure' || status === 'unsupported' || status === 'error'
  const label = problem ? t(`mic.status.${status}`) : style ? t('mic.style', { style: t(`mic.kind.${style}`) }) : t('mic.listening')
  return (
    <Tooltip content={current && !problem ? t('mic.now', { kind: t(`mic.kind.${current}`) }) : t('mic.private')}>
      <span
        tabIndex={0}
        aria-live="off"
        className={cx('inline-flex items-center gap-2 bg-dusk-900 px-3 py-1 text-sm inset-shadow-well', problem ? 'text-amber-400' : 'text-mist-300')}
      >
        <PixelIcon name="mic" size={16} className={cx(status === 'listening' && 'text-leaf-400')} />
        {label}
      </span>
    </Tooltip>
  )
}

/** Results: "Study style: Silence 62 % · a few more Psychic, Ghost, Ice". */
export function StudyStyleLine({ result }: { result: Pick<SessionResult, 'soundProfile'> }) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const sp: SoundProfile | null = result.soundProfile
  const kind = dominantSound(sp)
  if (!sp || !kind) return null
  const types = cfg.encounters.soundProfileTypes[kind].map((ty) => names.type(ty)).join(', ')
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-dusk-600">
      <PixelIcon name="mic" size={16} />
      <span>{t('mic.resultStyle', { style: t(`mic.kind.${kind}`), pct: fmtPct(sp[kind], i18n.language) })}</span>
      <span>{t('mic.resultTypes', { types })}</span>
    </p>
  )
}
