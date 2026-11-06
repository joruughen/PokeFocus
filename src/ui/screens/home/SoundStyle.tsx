/**
 * Sound profile UI (GDD §4.3): the opt-in toggle (PreSession), the discreet
 * indicator (FocusSession: what the mic hears and how long it has analysed,
 * or why it stopped) and the line in Results (the measured style, or why the
 * mic did not apply). The analysis itself lives in `lib/mic/`.
 *
 * The study style is only what the mic measures: music counts when it is
 * heard through the speakers; music on headphones is not heard.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, dominantSound, type SessionResult, type SoundProfile } from '../../../engine'
import { Button, PixelIcon, Switch, Tooltip } from '../../components'
import { cx } from '../../lib/cx'
import { fmtPct } from '../../lib/format'
import { isCalibrated } from '../../lib/mic/calibration-store'
import { tallySeconds } from '../../lib/mic/classify'
import { micSkipReason, micUnavailable, probeMic, useMic, useMicResult } from '../../lib/mic/monitor'
import { useNames } from '../../lib/names'
import { usePrefs } from '../../store/prefs'
import { usePhase } from '../../store/selectors'
import { MicCalibrationDialog, useCalibrationLine } from '../MicSettings'

const cfg = defaultContext().config

/** "45 s" / "3 min" of analysed time. */
function useAnalysed() {
  const { t } = useTranslation()
  return (seconds: number) => (seconds < 60 ? t('mic.secs', { count: Math.floor(seconds) }) : t('mic.mins', { count: Math.floor(seconds / 60) }))
}

/**
 * PreSession: "Perfil sonoro" switch with a one-line status. Switching it on
 * needs a calibrated mic: if this device has no calibration (with its noise
 * profile), the wizard opens and the mic only turns on once the silence step
 * is done; cancelling leaves it off.
 */
export function MicToggle() {
  const { t } = useTranslation()
  const enabled = usePrefs((s) => s.micEnabled)
  const setEnabled = usePrefs((s) => s.setMicEnabled)
  const [calOpen, setCalOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const status = useMic((s) => s.status)
  const calLine = useCalibrationLine()
  const why = micUnavailable()
  const blocked = why ?? (status === 'denied' || status === 'unsupported' || status === 'error' ? status : null)

  const onChange = async (on: boolean) => {
    if (!on) return setEnabled(false)
    // Ask now, inside the click, so the session never starts with a pending prompt.
    setAsking(true)
    const r = await probeMic()
    setAsking(false)
    if (r.status !== 'off') return setEnabled(false)
    if (isCalibrated(r.deviceId)) setEnabled(true)
    else setCalOpen(true)
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
        <Switch checked={enabled && !why} disabled={why !== null || asking} onChange={(v) => void onChange(v)} label={t('mic.toggle')} />
      </div>
      {enabled && !blocked && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-l-2 border-dusk-600 pl-3">
          <p className="min-w-0 text-sm text-mist-400">
            {calLine} {t('mic.speakerShort')}
          </p>
          <Button size="sm" variant="ghost" icon="reroll" onClick={() => setCalOpen(true)}>
            {t('mic.cal.again')}
          </Button>
        </div>
      )}
      <MicCalibrationDialog open={calOpen} onOpenChange={setCalOpen} onCalibrated={() => setEnabled(true)} />
    </div>
  )
}

/** Announce to screen readers: problems at once, kind changes at most every 30 s. */
function useThrottledAnnouncement(text: string, urgent: boolean): string {
  const [said, setSaid] = useState('')
  const last = useRef(0)
  useEffect(() => {
    const now = Date.now()
    if (urgent || now - last.current >= 30_000) {
      last.current = now
      setSaid(text)
    }
  }, [text, urgent])
  return said
}

/**
 * FocusSession: "Silencio · 3 min analizados", or why the mic is not
 * listening (paused, permission denied, device lost…). Only while the mic
 * toggle is on.
 */
export function MicIndicator() {
  const { t } = useTranslation()
  const enabled = usePrefs((s) => s.micEnabled)
  const status = useMic((s) => s.status)
  const tally = useMic((s) => s.tally)
  const current = useMic((s) => s.current)
  const issue = useMic((s) => s.issue)
  const calibrated = useMic((s) => s.calibrated)
  const phase = usePhase()
  const analysed = useAnalysed()
  const secs = tallySeconds(tally)
  const problem = issue !== null
  const paused = phase === 'paused'
  const label = problem
    ? t(`mic.stopped.${issue}`)
    : paused
      ? t('mic.paused')
      : status !== 'listening'
        ? t('mic.listening')
        : current
          ? t('mic.live', { kind: t(`mic.kind.${current}`), time: analysed(secs) })
          : t('mic.listening')
  const kindForSr = problem ? label : current ? t(`mic.kind.${current}`) : ''
  const announced = useThrottledAnnouncement(kindForSr, problem)
  if (!enabled) return null
  return (
    <>
      <Tooltip content={problem ? t('mic.stoppedNote') : calibrated ? t('mic.private') : t('mic.uncalibrated')}>
        <span
          tabIndex={0}
          aria-live="off"
          className={cx('inline-flex max-w-full items-center gap-2 bg-dusk-900 px-3 py-1 text-sm inset-shadow-well', problem ? 'text-amber-400' : 'text-mist-300')}
        >
          <PixelIcon name="mic" size={16} className={cx('shrink-0', status === 'listening' && 'text-leaf-400')} />
          <span className="min-w-0">{label}</span>
        </span>
      </Tooltip>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announced}
      </span>
    </>
  )
}

/**
 * Results: "Estilo de estudio: Silencio (62 %) · …" with the four shares, or —
 * when the mic was on for this session but did not apply — why ("solo se
 * analizaron 7 s (mínimo 30 s)", "permiso denegado"…).
 */
export function StudyStyleLine({ result }: { result: Pick<SessionResult, 'soundProfile' | 'sessionId'> }) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const outcome = useMicResult((s) => (s.last?.sessionId === result.sessionId ? s.last : null))
  const analysed = useAnalysed()
  const sp: SoundProfile | null = result.soundProfile
  const kind = dominantSound(sp)
  if (sp && kind) {
    const types = cfg.encounters.soundProfileTypes[kind].map((ty) => names.type(ty)).join(', ')
    return (
      <p className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-dusk-600">
        <PixelIcon name="mic" size={16} />
        <span>{t('mic.resultStyle', { style: t(`mic.kind.${kind}`), pct: fmtPct(sp[kind], i18n.language) })}</span>
        <span>{t('mic.resultTypes', { types })}</span>
        <span className="basis-full text-dusk-500">
          {(['silence', 'voice', 'music', 'noise'] as const).map((k) => `${t(`mic.kind.${k}`)} ${fmtPct(sp[k], i18n.language)}`).join(' · ')}
        </span>
        {outcome?.issue && <span className="basis-full text-dusk-500">{t('mic.resultPartial', { why: t(`mic.why.${outcome.issue}`), time: analysed(outcome.analysedS) })}</span>}
      </p>
    )
  }
  const skip = micSkipReason(outcome)
  if (!skip) return null
  const why = skip.kind === 'issue' ? t(`mic.why.${skip.issue}`) : t('mic.why.short', { time: analysed(skip.seconds), min: skip.min })
  return (
    <p className="mt-3 flex items-start gap-2 text-sm text-dusk-600" role="note">
      <PixelIcon name="mic" size={16} className="mt-0.5 shrink-0" />
      <span>{t('mic.notApplied', { why })}</span>
    </p>
  )
}
