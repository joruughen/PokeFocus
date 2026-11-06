/**
 * Opens the microphone into a Web Audio analyser (never connected to the
 * speakers) and reads one `FrameFeatures` at a time. Shared by the session
 * monitor, the calibration wizard and the live meter. Audio never leaves the
 * device.
 */
import { frameFeatures, rmsDbOf, type FrameFeatures } from './classify'

export type MicStatus = 'off' | 'starting' | 'listening' | 'insecure' | 'unsupported' | 'denied' | 'error'

export const CONSTRAINTS: MediaStreamConstraints = {
  // Raw levels: the classifier relies on real loudness and noise.
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  video: false,
}

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

export interface MicAnalyser {
  /** Device the stream comes from ('default' when the browser does not say): the calibration key. */
  deviceId: string
  /** One frame now, or null while the audio context is suspended (autoplay rules). */
  frame(): FrameFeatures | null
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
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0
    source.connect(analyser) // never connected to the speakers
    const time = new Float32Array(analyser.fftSize)
    const freq = new Float32Array(analyser.frequencyBinCount)
    // Autoplay rules: after a reload the context may start suspended until the next tap/click.
    const resume = () => void ctx.resume().catch(() => {})
    if (ctx.state === 'suspended') {
      resume()
      window.addEventListener('pointerdown', resume, { once: true })
      window.addEventListener('keydown', resume, { once: true })
    }
    const track = stream.getAudioTracks()[0]
    const deviceId = track?.getSettings?.().deviceId || 'default'
    let closed = false
    const mic: MicAnalyser = {
      deviceId,
      frame() {
        if (closed || ctx.state !== 'running') return null
        analyser.getFloatTimeDomainData(time)
        analyser.getFloatFrequencyData(freq)
        return frameFeatures(freq, ctx.sampleRate, rmsDbOf(time))
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
