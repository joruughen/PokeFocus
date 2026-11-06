/**
 * Live microphone for the calibration wizard and the Settings meter: the
 * level of each frame and the kind of each 2 s window, classified like a
 * session would (personal thresholds of the device, headphones option). It
 * can also record the frames of a calibration step. Nothing is stored or sent.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { openMicAnalyser, type MicStatus } from './analyser'
import { thresholdsFor } from './calibration-store'
import { applyHeadphones, classifyWindow, updateFloor, windowFeatures, type FrameFeatures, type SoundKind, type Thresholds } from './classify'

const FRAME_MS = 100
const WINDOW_FRAMES = 20
/** Level shown in the bar: −90 dBFS = empty, −10 dBFS = full. */
export const METER_MIN_DB = -90
export const METER_MAX_DB = -10

export function meterFraction(db: number | null): number {
  if (db === null) return 0
  return Math.min(1, Math.max(0, (db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)))
}

export interface LiveMic {
  status: MicStatus
  /** Level of the last frame, smoothed (dBFS), null before the first. */
  levelDb: number | null
  /** Kind of the last 2 s window. */
  kind: SoundKind | null
  deviceId: string | null
  /** Start collecting frames for a calibration step (drops any previous recording). */
  record(): void
  /** Stop collecting and return the frames. */
  take(): FrameFeatures[]
}

/**
 * Opens the mic while `active`. `thresholds` overrides the device's stored
 * ones (the wizard previews a fresh calibration before it is saved).
 */
export function useLiveMic(active: boolean, opts: { headphones: boolean; thresholds?: Thresholds | null }): LiveMic {
  const [status, setStatus] = useState<MicStatus>('off')
  const [levelDb, setLevel] = useState<number | null>(null)
  const [kind, setKind] = useState<SoundKind | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const rec = useRef<FrameFeatures[] | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    let close = () => {}
    setStatus('starting')
    void openMicAnalyser().then((r) => {
      if (!r.ok) {
        if (!cancelled) setStatus(r.status)
        return
      }
      if (cancelled) return r.mic.close()
      const mic = r.mic
      close = () => mic.close()
      setDeviceId(mic.deviceId)
      setStatus('listening')
      mic.onEnded(() => {
        clearInterval(timer)
        setStatus('error')
      })
      let frames: FrameFeatures[] = []
      let floor: number | null = null
      let smooth: number | null = null
      timer = setInterval(() => {
        const f = mic.frame()
        if (!f) return
        rec.current?.push(f)
        frames.push(f)
        // Fast attack, slower release: readable bar without flicker.
        smooth = smooth === null || f.rmsDb > smooth ? f.rmsDb : smooth * 0.7 + f.rmsDb * 0.3
        setLevel(smooth)
        if (frames.length < WINDOW_FRAMES) return
        const w = windowFeatures(frames)
        frames = []
        if (!w) return
        const th = optsRef.current.thresholds ?? thresholdsFor(mic.deviceId)
        setKind(applyHeadphones(classifyWindow(w, floor, th), optsRef.current.headphones))
        floor = updateFloor(floor, w.rmsDb)
      }, FRAME_MS)
    })
    return () => {
      cancelled = true
      clearInterval(timer)
      close()
      rec.current = null
      setStatus('off')
      setLevel(null)
      setKind(null)
    }
  }, [active])

  const record = useCallback(() => {
    rec.current = []
  }, [])
  const take = useCallback(() => {
    const f = rec.current ?? []
    rec.current = null
    return f
  }, [])

  return { status, levelDb, kind, deviceId, record, take }
}
