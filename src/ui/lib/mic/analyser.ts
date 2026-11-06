/**
 * Opens the microphone into a Web Audio analyser (never connected to the
 * speakers) and reads one raw frame at a time. Shared by the session monitor,
 * the calibration wizard and the live meter. Audio never leaves the device.
 *
 * Chain: mic → high-pass (100 Hz, 2nd order) → analyser. The filter removes
 * mains hum fundamentals (50/60 Hz) and desk thumps before anything is
 * measured; the mic's remaining self-noise (hiss, hum harmonics) is removed
 * per frame with the calibrated noise profile (`noise.ts`).
 */
import type { RawFrame } from './pipeline'

export type MicStatus = 'off' | 'starting' | 'listening' | 'insecure' | 'unsupported' | 'denied' | 'error'

export const CONSTRAINTS: MediaStreamConstraints = {
  // Raw levels: the classifier relies on real loudness and noise.
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  video: false,
}

export const HIGHPASS_HZ = 100

/** Why the microphone cannot be used here, or null if it can be tried. */
export function micUnavailable(): 'insecure' | 'unsupported' | null {
  if (typeof window === 'undefined') return 'unsupported'
  if (!window.isSecureContext) return 'insecure'
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') return 'unsupported'
  return null
}

export function errorStatus(e: unknown): MicStatus {
  const name = (e as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'unsupported'
  return 'error'
}

/** Device of a stream ('default' when the browser does not say): the calibration key. */
export function deviceIdOf(stream: MediaStream): string {
  return stream.getAudioTracks()[0]?.getSettings?.().deviceId || 'default'
}

export interface MicAnalyser {
  deviceId: string
  /** One frame now (a copy), or null while the audio context is suspended (autoplay rules). */
  frame(): RawFrame | null
  /** Called once if the track ends on its own (device unplugged, permission revoked). */
  onEnded(cb: () => void): void
  close(): void
}

/** Ask for the mic and build the analyser. */
export async function openMicAnalyser(): Promise<{ ok: true; mic: MicAnalyser } | { ok: false; status: MicStatus }> {
  const why = micUnavailable()
  if (why) return { ok: false, status: why }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS)
  } catch (e) {
    return { ok: false, status: errorStatus(e) }
  }
  try {
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = HIGHPASS_HZ
    hp.Q.value = Math.SQRT1_2
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0
    source.connect(hp)
    hp.connect(analyser) // never connected to the speakers
    const time = new Float32Array(analyser.fftSize)
    // Autoplay rules: after a reload the context may start suspended until the next tap/click.
    const resume = () => void ctx.resume().catch(() => {})
    if (ctx.state === 'suspended') {
      resume()
      window.addEventListener('pointerdown', resume, { once: true })
      window.addEventListener('keydown', resume, { once: true })
    }
    const track = stream.getAudioTracks()[0]
    let closed = false
    const mic: MicAnalyser = {
      deviceId: deviceIdOf(stream),
      frame() {
        if (closed || ctx.state !== 'running') return null
        analyser.getFloatTimeDomainData(time)
        const spectrumDb = new Float32Array(analyser.frequencyBinCount)
        analyser.getFloatFrequencyData(spectrumDb)
        let sum = 0
        for (let i = 0; i < time.length; i++) sum += time[i]! * time[i]!
        const rms = Math.sqrt(sum / time.length)
        return { spectrumDb, rmsDb: rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100, sampleRate: ctx.sampleRate }
      },
      onEnded(cb) {
        track?.addEventListener('ended', () => {
          if (!closed) cb()
        })
      },
      close() {
        if (closed) return
        closed = true
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close().catch(() => {})
        window.removeEventListener('pointerdown', resume)
        window.removeEventListener('keydown', resume)
      },
    }
    return { ok: true, mic }
  } catch {
    stream.getTracks().forEach((t) => t.stop())
    return { ok: false, status: 'error' }
  }
}
