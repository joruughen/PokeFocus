/**
 * Live microphone for the calibration wizard and the Settings meter: the
 * level of each frame and the kind of each 2 s window, classified exactly
 * like a session (same pipeline: noise subtraction and tracking, personal
 * thresholds of the device). It can also record the raw frames of a
 * calibration step. Nothing is stored or sent.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { openMicAnalyser, type MicStatus } from './analyser'
import { calibrationFor } from './calibration-store'
import type { SoundKind, Thresholds } from './classify'
import type { NoiseProfile } from './noise'
import { createPipeline, type RawFrame, type SoundPipeline } from './pipeline'

const FRAME_MS = 100
const WINDOW_FRAMES = 20
/** Level shown in the bar: −90 dBFS = empty, −10 dBFS = full. */
export const METER_MIN_DB = -90
export const METER_MAX_DB = -10

export function meterFraction(db: number | null): number {
  if (db === null) return 0
  return Math.min(1, Math.max(0, (db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)))
}

export interface LiveCalibration {
  thresholds: Thresholds
  noise: NoiseProfile | null
}

export interface LiveMic {
  status: MicStatus
  /** Level of the last frame, smoothed (dBFS), null before the first. */
  levelDb: number | null
  /** Kind of the last 2 s window. */
  kind: SoundKind | null
  /** Level of the last window over the mic's own noise (dB), null without a noise estimate. */
  aboveDb: number | null
  /** Windows classified since the mic opened or the calibration changed. */
  windows: number
  deviceId: string | null
  /** Start collecting raw frames for a calibration step (drops any previous recording). */
  record(): void
  /** Stop collecting and return the frames. */
  take(): RawFrame[]
}

/**
 * Opens the mic while `active`. `calibration` overrides the device's stored
 * one (the wizard checks a fresh calibration); changing it restarts the
 * analysis with the new values.
 */
export function useLiveMic(active: boolean, calibration: LiveCalibration | null = null): LiveMic {
  const [status, setStatus] = useState<MicStatus>('off')
  const [levelDb, setLevel] = useState<number | null>(null)
  const [kind, setKind] = useState<SoundKind | null>(null)
  const [aboveDb, setAbove] = useState<number | null>(null)
  const [windows, setWindows] = useState(0)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const calRef = useRef(calibration)
  calRef.current = calibration
  const rec = useRef<RawFrame[] | null>(null)

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
      let usedCal: LiveCalibration | null | undefined
      let pipe: SoundPipeline | null = null
      let smooth: number | null = null
      timer = setInterval(() => {
        // (Re)build the pipeline when the calibration in use changes.
        if (!pipe || usedCal !== calRef.current) {
          usedCal = calRef.current
          pipe = createPipeline(usedCal ?? calibrationFor(mic.deviceId))
          setKind(null)
          setAbove(null)
          setWindows(0)
        }
        const f = mic.frame()
        if (!f) return
        rec.current?.push(f)
        pipe.push(f)
        // Fast attack, slower release: readable bar without flicker.
        smooth = smooth === null || f.rmsDb > smooth ? f.rmsDb : smooth * 0.7 + f.rmsDb * 0.3
        setLevel(smooth)
        if (pipe.pending < WINDOW_FRAMES) return
        const out = pipe.endWindow()
        if (!out) return
        setKind(out.kind)
        setAbove(out.w.aboveDb)
        setWindows((n) => n + 1)
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
      setAbove(null)
      setWindows(0)
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

  return { status, levelDb, kind, aboveDb, windows, deviceId, record, take }
}
