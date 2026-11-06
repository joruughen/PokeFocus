/**
 * Personal microphone calibration per device (localStorage, keyed by the mic
 * `deviceId`): thresholds plus the mic's noise profile (~1 KB). Every access
 * is wrapped: without storage (private mode, blocked site data) the
 * calibration still works for this tab.
 *
 * v1 entries (before the noise profile) still load, with `noise: null`: the
 * session then learns the noise from its first quiet windows, and the UI asks
 * for a new calibration before the mic is switched on again.
 */
import { create } from 'zustand'
import { sanitizeThresholds, type CalibrationResult } from './calibrate'
import { DEFAULT_THRESHOLDS, type Thresholds } from './classify'
import { sanitizeProfile, type NoiseProfile } from './noise'

const KEY = 'pokefocus.micCalibration.v2'
const LEGACY_KEY = 'pokefocus.micCalibration.v1'
/** Keep at most this many devices. */
const MAX_DEVICES = 8

export interface StoredCalibration {
  thresholds: Thresholds
  noise: NoiseProfile | null
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
      const c = v as Partial<Record<keyof StoredCalibration, unknown>>
      const m = (c.measured ?? {}) as Partial<StoredCalibration['measured']>
      devices[id] = {
        thresholds: sanitizeThresholds(c.thresholds as Partial<Thresholds> | undefined),
        noise: sanitizeProfile(c.noise),
        at: typeof c.at === 'number' && Number.isFinite(c.at) ? c.at : 0,
        measured: { silence: m.silence === true, voice: m.voice === true, music: m.music === true },
      }
    }
  }
  return { devices, last: typeof o.last === 'string' && devices[o.last] ? o.last : null }
}

function load(): CalibrationState {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
    return parse(raw ? JSON.parse(raw) : null)
  } catch {
    return { devices: {}, last: null }
  }
}

function persist(next: CalibrationState): void {
  useMicCalibration.setState(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // No storage: kept in memory for this tab.
  }
}

export const useMicCalibration = create<CalibrationState>()(() => load())

export function saveCalibration(deviceId: string, result: CalibrationResult, now = Date.now()): void {
  const s = useMicCalibration.getState()
  const devices = { ...s.devices, [deviceId]: { thresholds: result.thresholds, noise: result.noise, at: now, measured: result.measured } }
  const ids = Object.keys(devices).sort((a, b) => devices[b]!.at - devices[a]!.at)
  for (const id of ids.slice(MAX_DEVICES)) delete devices[id]
  persist({ devices, last: deviceId })
}

export function clearCalibration(deviceId: string): void {
  const s = useMicCalibration.getState()
  const devices = { ...s.devices }
  delete devices[deviceId]
  persist({ devices, last: s.last === deviceId ? null : s.last })
}

/** Thresholds and noise profile for this device (defaults and no profile if never calibrated). */
export function calibrationFor(deviceId: string | null | undefined): { thresholds: Thresholds; noise: NoiseProfile | null } {
  const c = deviceId ? useMicCalibration.getState().devices[deviceId] : undefined
  return { thresholds: c?.thresholds ?? DEFAULT_THRESHOLDS, noise: c?.noise ?? null }
}

/** Calibrated with a noise profile (the silence step of the current wizard). */
export function isCalibrated(deviceId: string | null | undefined): boolean {
  return Boolean(deviceId && useMicCalibration.getState().devices[deviceId]?.noise)
}

/** Exposed for tests. */
export const __parseCalibration = parse
