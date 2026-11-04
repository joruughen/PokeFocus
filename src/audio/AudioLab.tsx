/**
 * Dev-only review panel: every sfx, the track switcher and all settings.
 * Mount it anywhere (e.g. the dev panel): `<AudioLab />`.
 * Uses inline styles only, so it works without the app's design system.
 */
import type { CSSProperties } from 'react'
import { SFX, SFX_NAMES, TRACKS, TRACK_IDS } from './index'
import { presetDuration } from './synth'
import { useAudio } from './useAudio'
import type { AudioSettings } from './settings'

const box: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4 }
const btn: CSSProperties = { padding: '2px 6px', fontSize: 12, cursor: 'pointer', border: '1px solid currentColor', borderRadius: 3, background: 'transparent', color: 'inherit' }
const active: CSSProperties = { ...btn, background: 'rgba(120,200,120,0.35)' }

const SLIDERS: Array<[keyof AudioSettings, string]> = [
  ['master', 'Master'],
  ['music', 'Music'],
  ['sfx', 'SFX'],
  ['focusMusicLevel', 'Focus music level'],
]
const TOGGLES: Array<[keyof AudioSettings, string]> = [
  ['enabled', 'Audio enabled'],
  ['muted', 'Muted'],
  ['musicDuringFocus', 'Music during focus'],
  ['backgroundMusic', 'Focus music in background tab'],
  ['ducking', 'Duck music under fanfares'],
  ['vinylHiss', 'Vinyl hiss (focus)'],
]

export function AudioLab() {
  const a = useAudio()
  const s = a.settings
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
      <div>
        <strong>Audio Lab</strong> — context: {a.state} · requested: {a.track ?? '—'} · playing: {a.playing ?? '—'}
        {a.state !== 'running' && (
          <button style={{ ...btn, marginLeft: 6 }} onClick={() => void a.init()}>
            Unlock audio
          </button>
        )}
      </div>

      <section>
        <div>Music</div>
        <div style={box}>
          {TRACK_IDS.map((id) => (
            <button key={id} style={a.track === id ? active : btn} title={TRACKS[id].label} onClick={() => a.playMusic(id)}>
              {id}
            </button>
          ))}
          <button style={btn} onClick={() => a.stopMusic()}>
            stop
          </button>
          <button style={a.ducked ? active : btn} onClick={() => a.setDucking(!a.ducked)}>
            duck
          </button>
        </div>
        {a.track && <div style={{ opacity: 0.7 }}>{TRACKS[a.track].label}</div>}
      </section>

      <section>
        <div>Sound effects</div>
        <div style={box}>
          {SFX_NAMES.map((name) => (
            <button key={name} style={btn} title={`${presetDuration(SFX[name]).toFixed(2)} s · ${SFX[name].kind}`} onClick={() => a.sfx(name)}>
              {name}
            </button>
          ))}
          <button
            style={btn}
            title="pointsTick ×20 rising (tests rate limiting)"
            onClick={() => {
              for (let i = 0; i < 20; i++) setTimeout(() => a.sfx('pointsTick', { pitch: i * 25 }), i * 30)
            }}
          >
            count-up ×20
          </button>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 2 }}>
        {SLIDERS.map(([key, label]) => (
          <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ width: 120 }}>{label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={s[key] as number}
              onChange={(e) => a.setSettings({ [key]: Number(e.target.value) })}
            />
            <span>{Math.round((s[key] as number) * 100)}%</span>
          </label>
        ))}
        {TOGGLES.map(([key, label]) => (
          <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={s[key] as boolean} onChange={(e) => a.setSettings({ [key]: e.target.checked })} />
            {label}
          </label>
        ))}
      </section>
    </div>
  )
}

export default AudioLab
