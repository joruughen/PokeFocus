/**
 * Microphone extras (GDD §4.3): the calibration wizard, the live meter
 * ("Ahora detecto: Música") and the headphones option. The analysis stays in
 * the browser; calibration is stored per mic device (localStorage).
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, PixelIcon, Switch } from '../components'
import { cx } from '../lib/cx'
import { micUnavailable } from '../lib/mic/analyser'
import { calibrate, CAL_STEP_MS, stepWindows, type CalibrationResult } from '../lib/mic/calibrate'
import { saveCalibration, useMicCalibration } from '../lib/mic/calibration-store'
import { meterFraction, useLiveMic, type LiveMic } from '../lib/mic/live'
import { usePrefs } from '../store/prefs'

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
      <p className={cx('flex items-center gap-2 text-sm', problem ? 'text-amber-400' : 'text-mist-100')} aria-live="polite" aria-atomic="true">
        <PixelIcon name="mic" size={16} className={cx('shrink-0', mic.status === 'listening' && 'text-leaf-400')} />
        <span>{problem ? t(`mic.status.${mic.status}`) : mic.kind ? t('mic.meter.now', { kind: t(`mic.kind.${mic.kind}`) }) : t('mic.listening')}</span>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Headphones
// ---------------------------------------------------------------------------

export function HeadphonesSwitch({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const on = usePrefs((s) => s.micHeadphones)
  const set = usePrefs((s) => s.setMicHeadphones)
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className={compact ? 'text-base text-mist-100' : 'font-display text-lg'}>{t('mic.headphones')}</p>
        <p className="text-sm text-mist-400">{t('mic.headphonesNote')}</p>
      </div>
      <Switch checked={on} onChange={set} label={t('mic.headphones')} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Calibration wizard
// ---------------------------------------------------------------------------

type Step = 'intro' | 'silence' | 'voice' | 'musicAsk' | 'music' | 'done'
const MEASURED: Step[] = ['silence', 'voice', 'music']

/** ~15 s: silence, voice, and (optional) music, 5 s each. */
export function MicCalibrationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const headphones = usePrefs((s) => s.micHeadphones)
  const setHeadphones = usePrefs((s) => s.setMicHeadphones)
  const [step, setStep] = useState<Step>('intro')
  const [result, setResult] = useState<CalibrationResult | null>(null)
  const [left, setLeft] = useState(0)
  const mic = useLiveMic(open, { headphones, thresholds: step === 'done' ? result?.thresholds : null })
  const frames = useRef<{ silence: ReturnType<LiveMic['take']>; voice: ReturnType<LiveMic['take']> }>({ silence: [], voice: [] })
  const ready = mic.status === 'listening'

  useEffect(() => {
    if (!open) {
      setStep('intro')
      setResult(null)
    }
  }, [open])

  const finish = (musicFrames: ReturnType<LiveMic['take']> | null) => {
    const r = calibrate({
      silence: stepWindows(frames.current.silence),
      voice: stepWindows(frames.current.voice),
      music: musicFrames ? stepWindows(musicFrames) : null,
    })
    if (r.measured.silence && mic.deviceId) saveCalibration(mic.deviceId, r)
    setResult(r)
    setStep('done')
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
        setStep('voice')
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

  const n = MEASURED.indexOf(step as (typeof MEASURED)[number]) + 1
  const body = (() => {
    switch (step) {
      case 'intro':
        return <p className="text-mist-300">{t('mic.cal.intro')}</p>
      case 'silence':
      case 'voice':
      case 'music':
        return (
          <div>
            <p className="text-sm text-mist-400">{t('mic.cal.step', { n, total: 3 })}</p>
            <p className="font-display text-xl text-mist-50">{t(`mic.cal.${step}`)}</p>
            <p className="text-mist-300">{t(`mic.cal.${step}Note`)}</p>
            <p className="mt-2 font-num text-lg text-volt-300" aria-live="off">
              {ready ? t('mic.cal.measuring', { s: left }) : t('mic.listening')}
            </p>
          </div>
        )
      case 'musicAsk':
        return (
          <div>
            <p className="text-sm text-mist-400">{t('mic.cal.step', { n: 3, total: 3 })}</p>
            <p className="font-display text-xl text-mist-50">{t('mic.cal.musicAsk')}</p>
            <p className="text-mist-300">{t('mic.cal.musicAskNote')}</p>
          </div>
        )
      case 'done':
        return (
          <div className="flex flex-col gap-2">
            <p className="font-display text-xl text-mist-50">{result?.measured.silence ? t('mic.cal.done') : t('mic.cal.failed')}</p>
            {result?.measured.silence && (
              <p className="text-mist-300">
                {t('mic.cal.summary', {
                  parts: (['silence', 'voice', 'music'] as const)
                    .filter((k) => result.measured[k])
                    .map((k) => t(`mic.kind.${k}`))
                    .join(', '),
                })}
              </p>
            )}
            {result?.notes.map((k) => (
              <p key={k} className="text-sm text-amber-400">
                {t(`mic.cal.notes.${k}`)}
              </p>
            ))}
            <p className="text-sm text-mist-400">{t('mic.cal.verify')}</p>
          </div>
        )
    }
  })()

  const footer =
    step === 'intro' ? (
      <>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {t('mic.cal.later')}
        </Button>
        <Button disabled={!ready} onClick={() => setStep('silence')}>
          {t('mic.cal.start')}
        </Button>
      </>
    ) : step === 'musicAsk' ? (
      <>
        <Button
          variant="secondary"
          onClick={() => {
            setHeadphones(true)
            finish(null)
          }}
        >
          {t('mic.cal.musicSkip')}
        </Button>
        <Button onClick={() => setStep('music')}>{t('mic.cal.musicPlay')}</Button>
      </>
    ) : step === 'done' ? (
      <>
        <Button variant="secondary" onClick={() => setStep('intro')}>
          {t('mic.cal.redo')}
        </Button>
        <Button onClick={() => onOpenChange(false)}>{t('mic.cal.finish')}</Button>
      </>
    ) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('mic.cal.title')} footer={footer}>
      <div className="flex flex-col gap-4">
        {body}
        <LiveMeter mic={mic} />
        {step === 'done' && <HeadphonesSwitch compact />}
        {!headphones && step === 'done' && <p className="text-sm text-mist-400">{t('mic.speakerNote')}</p>}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Settings → microphone: calibration (re-run), headphones, and a live test. */
export function MicSettings() {
  const { t, i18n } = useTranslation()
  const [calOpen, setCalOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const headphones = usePrefs((s) => s.micHeadphones)
  const cal = useMicCalibration((s) => (s.last ? s.devices[s.last] : null))
  const mic = useLiveMic(testing && !calOpen, { headphones })
  const why = micUnavailable()

  if (why) return <p className="text-sm text-amber-400">{t(`mic.status.${why}`)}</p>

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-[40ch] min-w-0">
          <p className="font-display text-lg">{t('mic.cal.title')}</p>
          <p className="text-sm text-mist-300">
            {cal ? t('mic.cal.lastAt', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(cal.at) }) : t('mic.cal.never')}
          </p>
        </div>
        <Button variant="secondary" icon="mic" onClick={() => setCalOpen(true)}>
          {cal ? t('mic.cal.again') : t('mic.cal.run')}
        </Button>
      </div>
      <HeadphonesSwitch />
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
