/**
 * Microphone extras (GDD §4.3): the calibration wizard (silence required,
 * voice recommended, speaker music optional, then a live check), the live
 * meter ("Ahora detecto: Música") and the Settings block. The analysis stays
 * in the browser; the calibration is stored per mic device (localStorage).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, PixelIcon } from '../components'
import { cx } from '../lib/cx'
import { micUnavailable } from '../lib/mic/analyser'
import { calibrateFrames, CAL_STEP_MS, type CalibrationResult } from '../lib/mic/calibrate'
import { saveCalibration, useMicCalibration } from '../lib/mic/calibration-store'
import type { SoundKind } from '../lib/mic/classify'
import { meterFraction, useLiveMic, type LiveMic } from '../lib/mic/live'
import type { RawFrame } from '../lib/mic/pipeline'

// ---------------------------------------------------------------------------
// Live meter
// ---------------------------------------------------------------------------

/** Level bar + "Ahora detecto: Música". Only the kind is announced (when it changes, at most every 2 s). */
export function LiveMeter({ mic, className }: { mic: LiveMic; className?: string }) {
  const { t } = useTranslation()
  const f = meterFraction(mic.levelDb)
  const problem = mic.status !== 'listening' && mic.status !== 'starting' && mic.status !== 'off'
  return (
    <div className={cx('flex flex-col gap-2 bg-dusk-900 p-3 inset-shadow-well', className)}>
      <div
        role="meter"
        aria-label={t('mic.meter.label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(f * 100)}
        className="relative h-4 overflow-hidden bg-ink shadow-frame"
      >
        <div className={cx('absolute inset-y-0 left-0 transition-[width] duration-75', f > 0.8 ? 'bg-amber-400' : 'bg-leaf-400')} style={{ width: `${f * 100}%` }}>
          <div className="h-[35%] max-h-1 bg-white/35" />
        </div>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className={cx('flex items-center gap-2', problem ? 'text-sm text-amber-400' : 'font-display text-lg text-mist-100')} aria-live="polite" aria-atomic="true">
          <PixelIcon name="mic" size={16} className={cx('shrink-0', mic.status === 'listening' && 'text-leaf-400')} />
          <span>{problem ? t(`mic.status.${mic.status}`) : mic.kind ? t('mic.meter.now', { kind: t(`mic.kind.${mic.kind}`) }) : t('mic.listening')}</span>
        </p>
        {!problem && mic.aboveDb !== null && (
          <p className="font-num text-sm text-mist-400" aria-hidden>
            {t('mic.meter.above', { db: `${mic.aboveDb >= 0 ? '+' : '−'}${Math.abs(mic.aboveDb).toFixed(0)}` })}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Calibration wizard
// ---------------------------------------------------------------------------

type Step = 'intro' | 'silence' | 'voiceAsk' | 'voice' | 'musicAsk' | 'music' | 'check' | 'failed'
const MEASURED = ['silence', 'voice', 'music'] as const
const STEP_NO: Partial<Record<Step, number>> = { silence: 1, voiceAsk: 2, voice: 2, musicAsk: 3, music: 3 }

/**
 * ~15 s: silence (required), voice (recommended), music through the speakers
 * (optional), then a live check. `onCalibrated` runs once the calibration is
 * saved (the mic toggle switches on then); closing before that saves nothing.
 */
export function MicCalibrationDialog({ open, onOpenChange, onCalibrated }: { open: boolean; onOpenChange: (o: boolean) => void; onCalibrated?: () => void }) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>('intro')
  const [result, setResult] = useState<CalibrationResult | null>(null)
  const [left, setLeft] = useState(0)
  const [seen, setSeen] = useState<Set<SoundKind>>(new Set())
  // The live check runs on the fresh calibration (the meter rebuilds its analysis when it changes).
  const freshCal = useMemo(() => (step === 'check' && result ? { thresholds: result.thresholds, noise: result.noise } : null), [step, result])
  const mic = useLiveMic(open, freshCal)
  const frames = useRef<{ silence: RawFrame[]; voice: RawFrame[] }>({ silence: [], voice: [] })
  const ready = mic.status === 'listening'

  const reset = () => {
    frames.current = { silence: [], voice: [] }
    setResult(null)
    setSeen(new Set())
    setStep('intro')
  }
  useEffect(() => {
    if (!open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Live check: tick each kind once the meter has shown it.
  useEffect(() => {
    if (step !== 'check' || !mic.kind) return
    const k = mic.kind
    setSeen((s) => (s.has(k) ? s : new Set(s).add(k)))
  }, [step, mic.kind, mic.windows])

  const finish = (music: RawFrame[] | null) => {
    const r = calibrateFrames({ silence: frames.current.silence, voice: frames.current.voice, music })
    setResult(r)
    if (!r.measured.silence || !mic.deviceId) return setStep('failed')
    saveCalibration(mic.deviceId, r)
    onCalibrated?.()
    setSeen(new Set())
    setStep('check')
  }

  // Each measured step: record CAL_STEP_MS, then move on.
  const measuring = step === 'silence' || step === 'voice' || step === 'music'
  useEffect(() => {
    if (!measuring || !ready) return
    mic.record()
    const t0 = Date.now()
    setLeft(Math.ceil(CAL_STEP_MS / 1000))
    const tick = setInterval(() => setLeft(Math.max(0, Math.ceil((CAL_STEP_MS - (Date.now() - t0)) / 1000))), 250)
    const done = setTimeout(() => {
      const f = mic.take()
      if (step === 'silence') {
        frames.current.silence = f
        setStep('voiceAsk')
      } else if (step === 'voice') {
        frames.current.voice = f
        setStep('musicAsk')
      } else finish(f)
    }, CAL_STEP_MS)
    return () => {
      clearInterval(tick)
      clearTimeout(done)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, ready])

  const n = STEP_NO[step]
  const stepLabel = n ? <p className="text-sm text-mist-400">{t('mic.cal.step', { n, total: 3 })}</p> : null
  const countdown = (
    <p className="mt-2 font-num text-lg text-volt-300" aria-live="off">
      {ready ? t('mic.cal.measuring', { s: left }) : t('mic.listening')}
    </p>
  )
  const body = (() => {
    switch (step) {
      case 'intro':
        return <p className="text-mist-300">{t('mic.cal.intro')}</p>
      case 'silence':
      case 'voice':
      case 'music':
        return (
          <div>
            {stepLabel}
            <p className="font-display text-xl text-mist-50">{t(`mic.cal.${step}`)}</p>
            <p className="text-mist-300">{t(`mic.cal.${step}Note`)}</p>
            {countdown}
          </div>
        )
      case 'voiceAsk':
      case 'musicAsk':
        return (
          <div>
            {stepLabel}
            <p className="font-display text-xl text-mist-50">{t(`mic.cal.${step}`)}</p>
            <p className="text-mist-300">{t(`mic.cal.${step}Note`)}</p>
          </div>
        )
      case 'failed':
        return (
          <div className="flex flex-col gap-2">
            <p className="font-display text-xl text-mist-50">{t('mic.cal.failed')}</p>
            <p className="text-sm text-amber-400">{t(mic.deviceId ? 'mic.cal.notes.noSilence' : 'mic.cal.noDevice')}</p>
          </div>
        )
      case 'check':
        return result ? <CheckStep result={result} seen={seen} /> : null
    }
  })()

  const footer = (() => {
    switch (step) {
      case 'intro':
        return (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!ready} onClick={() => setStep('silence')}>
              {t('mic.cal.start')}
            </Button>
          </>
        )
      case 'voiceAsk':
        return (
          <>
            <Button variant="secondary" onClick={() => setStep('musicAsk')}>
              {t('mic.cal.skip')}
            </Button>
            <Button onClick={() => setStep('voice')}>{t('mic.cal.voiceGo')}</Button>
          </>
        )
      case 'musicAsk':
        return (
          <>
            <Button variant="secondary" onClick={() => finish(null)}>
              {t('mic.cal.musicSkip')}
            </Button>
            <Button onClick={() => setStep('music')}>{t('mic.cal.musicPlay')}</Button>
          </>
        )
      case 'failed':
        return (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={reset}>{t('mic.cal.redo')}</Button>
          </>
        )
      case 'check':
        return (
          <>
            <Button variant="secondary" icon="reroll" onClick={reset}>
              {t('mic.cal.redo')}
            </Button>
            <Button onClick={() => onOpenChange(false)}>{t('mic.cal.finish')}</Button>
          </>
        )
      default:
        return null
    }
  })()

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('mic.cal.title')} footer={footer} size="md">
      <div className="flex flex-col gap-4">
        {body}
        <LiveMeter mic={mic} />
        <p className="text-sm text-mist-400">{t('mic.private')}</p>
      </div>
    </Dialog>
  )
}

/** After calibrating: summary, notes and "say nothing → Silencio, talk → Voz" with ticks. */
function CheckStep({ result, seen }: { result: CalibrationResult; seen: Set<SoundKind> }) {
  const { t } = useTranslation()
  const tasks: { kind: SoundKind; key: string }[] = [
    { kind: 'silence', key: 'mic.cal.checkSilence' },
    { kind: 'voice', key: 'mic.cal.checkVoice' },
    ...(result.measured.music ? [{ kind: 'music' as const, key: 'mic.cal.checkMusic' }] : []),
  ]
  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-xl text-mist-50">{t('mic.cal.done')}</p>
      <p className="text-mist-300">
        {t('mic.cal.summary', {
          parts: MEASURED.filter((k) => result.measured[k])
            .map((k) => t(`mic.kind.${k}`))
            .join(', '),
        })}
      </p>
      {result.notes.map((k) => (
        <p key={k} className="text-sm text-amber-400">
          {t(`mic.cal.notes.${k}`)}
        </p>
      ))}
      <p className="text-mist-100">{t('mic.cal.check')}</p>
      <ul className="flex flex-col gap-2">
        {tasks.map(({ kind, key }) => {
          const ok = seen.has(kind)
          return (
            <li key={kind} className={cx('flex items-center gap-2', ok ? 'text-leaf-400' : 'text-mist-300')}>
              <span className={cx('inline-flex size-6 shrink-0 items-center justify-center shadow-frame', ok ? 'bg-leaf-600 text-ink' : 'bg-dusk-900')} aria-hidden>
                {ok && <PixelIcon name="check" size={16} />}
              </span>
              <span>
                {t(key)}
                <span className="sr-only">{ok ? ` — ${t('mic.cal.checkOk')}` : ''}</span>
              </span>
            </li>
          )
        })}
      </ul>
      <p className="text-sm text-mist-400">{t('mic.cal.checkHelp')}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** "Calibrado el 3 nov." / "Calibración antigua…" / "Sin calibrar". */
export function useCalibrationLine(): string {
  const { t, i18n } = useTranslation()
  const cal = useMicCalibration((s) => (s.last ? s.devices[s.last] : null))
  if (!cal) return t('mic.cal.never')
  if (!cal.noise) return t('mic.cal.outdated')
  return t('mic.cal.lastAt', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(cal.at) })
}

/** Settings → microphone: calibration (re-run) and a live test. */
export function MicSettings() {
  const { t } = useTranslation()
  const [calOpen, setCalOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const calibrated = useMicCalibration((s) => Boolean(s.last && s.devices[s.last]))
  const line = useCalibrationLine()
  const mic = useLiveMic(testing && !calOpen)
  const why = micUnavailable()

  if (why) return <p className="text-sm text-amber-400">{t(`mic.status.${why}`)}</p>

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-[40ch] min-w-0">
          <p className="font-display text-lg">{t('mic.cal.title')}</p>
          <p className="text-sm text-mist-300">{line}</p>
        </div>
        <Button variant="secondary" icon="mic" onClick={() => setCalOpen(true)}>
          {calibrated ? t('mic.cal.again') : t('mic.cal.run')}
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-[40ch] min-w-0">
            <p className="font-display text-lg">{t('mic.meter.title')}</p>
            <p className="text-sm text-mist-300">{t('mic.speakerNote')}</p>
          </div>
          <Button variant="secondary" aria-pressed={testing} onClick={() => setTesting((v) => !v)}>
            {testing ? t('mic.meter.stop') : t('mic.meter.start')}
          </Button>
        </div>
        {testing && !calOpen && <LiveMeter mic={mic} />}
      </div>
      <MicCalibrationDialog open={calOpen} onOpenChange={setCalOpen} />
    </div>
  )
}
