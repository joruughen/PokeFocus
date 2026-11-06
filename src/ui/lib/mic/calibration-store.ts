/**
 * Personal microphone thresholds per device (localStorage, keyed by the mic
 * `deviceId`). Every access is wrapped: without storage (private mode,
 * blocked site data) the calibration still works for this tab and the
 * session falls back to `DEFAULT_THRESHOLDS` next time.
 */
import { create } from 'zustand'
import { sanitizeThresholds, type CalibrationResult } from './calibrate'
import { DEFAULT_THRESHOLDS, type Thresholds } from './classify'

const KEY = 'pokefocus.micCalibration.v1'
/** Keep at most this many devices. */
const MAX_DEVICES = 8

export interface StoredCalibration {
  thresholds: Thresholds
  at: number
  measured: CalibrationResult['measured']
}

interface CalibrationState {
  devices: Record<string, StoredCalibration>
  /** Device of the last calibration (the Settings summary). */
  last: string | null
}

function parse(raw: unknown): CalibrationState {
  const empty: CalibrationState = { devices: {}, last: null }
  if (!raw || typeof raw !== 'object') return empty
  const o = raw as { devices?: unknown; last?: unknown }
  const devices: Record<string, StoredCalibration> = {}
  if (o.devices && typeof o.devices === 'object') {
    for (const [id, v] of Object.entries(o.devices as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const c = v as Partial<StoredCalibration>
      const m = (c.measured ?? {}) as Partial<StoredCalibration['measured']>
      devices[id] = {
        thresholds: sanitizeThresholds(c.thresholds as Partial<Thresholds> | undefined),
        at: typeof c.at === 'number' ? c.at : 0,
        measured: { silence: m.silence === true, voice: m.voice === true, music: m.music === true },
      }
    }
  }
  return { devices, last: typeof o.last === 'string' && devices[o.last] ? o.last : null }
}

function load(): CalibrationState {
  try {
    const raw = localStorage.getItem(KEY)
    return parse(raw ? JSON.parse(raw) : null)
  } catch {
    return { devices: {}, last: null }
  }
}

export const useMicCalibration = create<CalibrationState>()(() => load())

export function saveCalibration(deviceId: string, result: CalibrationResult, now = Date.now()): void {
  const s = useMicCalibration.getState()
  const devices = { ...s.devices, [deviceId]: { thresholds: result.thresholds, at: now, measured: result.measured } }
  const ids = Object.keys(devices).sort((a, b) => devices[b]!.at - devices[a]!.at)
  for (const id of ids.slice(MAX_DEVICES)) delete devices[id]
  const next = { devices, last: deviceId }
  useMicCalibration.setState(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // No storage: kept in memory for this tab.
  }
}

export function clearCalibration(deviceId: string): void {
  const s = useMicCalibration.getState()
  const devices = { ...s.devices }
  delete devices[deviceId]
  const next = { devices, last: s.last === deviceId ? null : s.last }
  useMicCalibration.setState(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

/** Thresholds for this device (personal if calibrated, else the defaults). */
export function thresholdsFor(deviceId: string | null | undefined): Thresholds {
  return (deviceId && useMicCalibration.getState().devices[deviceId]?.thresholds) || DEFAULT_THRESHOLDS
}

/** Exposed for tests. */
export const __parseCalibration = parse
