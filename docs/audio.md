# Audio

All PokeFocus sound is **synthesized at runtime with the Web Audio API**: no audio
files, no samples, no licensing. Melodies are original (built from plain
arpeggios and scale steps, not taken from any game). There are no npm
dependencies.

Code lives in `src/audio/`:

| File | Role |
| --- | --- |
| `index.ts` | Public entry: `audio` singleton, `applyAudioSettings`, `installAudioUnlock`, re-exports |
| `engine.ts` | `AudioEngine`: context lifecycle, buses, limiter, sfx, ducking, music crossfades, visibility |
| `settings.ts` | `AudioSettings` type, defaults, `sanitizeAudioSettings` |
| `synth.ts` | sfxr-style voice renderer (pulse/triangle/saw/sine/noise, envelope, slide, arp, vibrato, filter, pan) |
| `presets.ts` | The named sfx presets (pure data) |
| `tracks.ts` | Generative track definitions + `TrackGenerator` (pure) |
| `instruments.ts` | Music instruments (pad, bass, lead, pluck, bell, kick, snare, hat, crackle, hiss bed) |
| `music.ts` | `TrackPlayer`: one running track (fade gain, reverb send, scheduler) |
| `scheduler.ts` | Lookahead bar scheduler + Worker-based tick source |
| `theory.ts`, `rng.ts` | Note/scale/chord/voice-leading helpers, seeded RNG |
| `useAudio.tsx` | React: `useAudio()` hook and `AudioProvider` (only file besides AudioLab importing React) |
| `AudioLab.tsx` | Dev review panel |
| `audio.test.ts` | Vitest: RNG, theory, scheduler, preset sanity, mock-context render, track generation, settings |

## API

```ts
import { audio, applyAudioSettings, installAudioUnlock } from '../audio'

audio.init()                    // create/resume AudioContext; call from a user gesture; idempotent; returns Promise
installAudioUnlock()            // or: auto-call init() on the first pointerdown/keydown/touchend (returns cleanup)

audio.sfx('claim')              // play now → SfxHandle | null (null if muted / rate-limited)
audio.sfx('pointsTick', { pitch: 50 * i, volume: 0.8, pan: -0.2, force: false })
const h = audio.sfxAt('sessionEnd', secondsLeft) // schedule on the audio clock (background-tab safe)
h?.stop()                       // cancel (e.g. session aborted)

audio.music.play('focus')       // 'focus' | 'home' | 'encounter' | 'results'; crossfades ~1.5 s
audio.music.stop(fadeMs?)       // default 1500 ms
audio.music.current             // requested track or null

audio.setDucking(true)          // manually lower music (e.g. evolution cutscene); false restores
audio.enabled = false           // master switch (same as applyAudioSettings({ enabled: false }))
applyAudioSettings({ music: 0.5 }) // partial or full settings; invalid values are clamped/ignored

audio.subscribe(fn) / audio.getSnapshot() // store interface (used by useAudio)
```

`audio.sfx()` called before `init()` creates the context itself, so a sound
triggered from a click handler also unlocks audio. `audio.music.play()` before
unlock just records the request; music starts as soon as the context runs.

### Settings (`AudioSettings`)

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. Off = context suspended, nothing synthesized |
| `muted` | `false` | Quick mute, volumes untouched |
| `master` | `0.8` | Master volume 0–1 |
| `music` | `0.35` | Music bus 0–1 |
| `sfx` | `0.6` | SFX bus 0–1 |
| `musicDuringFocus` | `true` | Play the `focus` track during sessions |
| `focusMusicLevel` | `0.6` | Focus track level relative to `music` ("on but low") |
| `backgroundMusic` | `true` | Keep focus music playing in a hidden tab |
| `ducking` | `true` | Auto-duck music under fanfares/jingles |
| `vinylHiss` | `true` | Hiss + crackle bed on the focus track |

`focusMusicAudible(settings)` says whether the focus track can be heard, and
`focusMusicPatch(settings, audible)` is the patch for the session screen's mute
button. Muting only sets `musicDuringFocus: false`, so volumes stay and sound
effects (the end-of-session chime) keep playing; unmuting also lifts a global
mute or a zero volume, so the button never does nothing.

Volumes are linear gains. Store the object in the persisted prefs and push it
with `applyAudioSettings(settings)` (or `<AudioProvider settings={...}>`). The
existing `prefs.sound` boolean can map to `enabled`.

### React

```tsx
import { AudioProvider, useAudio } from '../audio/useAudio'

<AudioProvider settings={audioSettingsFromPrefs}>…</AudioProvider> // installs unlock + mirrors settings

const { sfx, playMusic, stopMusic, setSettings, setDucking, init,
        settings, track, playing, state, ready, supported, ducked } = useAudio()
const locked = useSoundLocked() // sound on, but the context is not running yet
```

`track` is what the app asked for; `playing` is what is actually audible
(differs when hidden, disabled, muted or focus music is off).

## Behaviour

- **Graph**: track players → music bus → duck gain → master; reverb (synthetic
  convolution IR) on music only; sfx → sfx bus → master; master → compressor
  used as a limiter (−8 dB threshold, 16:1) → 0.85 headroom gain → output.
  Rendered peaks of every sfx and track (Chromium OfflineAudioContext, before
  bus volumes) are ≤ 0.42.
- **Visibility**: when the tab is hidden, music fades out unless the requested
  track is `focus` and both `musicDuringFocus` and `backgroundMusic` are on. It
  restarts (new random variation) when the tab is visible again. The context
  itself is never suspended on hide, so sfx (e.g. `sessionEnd`) still play.
- **Background timing**: the scheduler wakes from a tiny inline Web Worker
  (not throttled like main-thread timers) and uses a 2.5 s lookahead while
  hidden (0.6 s visible), falling back to `setInterval`. If the clock falls
  behind (laptop asleep), the backlog is dropped instead of bursting.
- **Suspended after a reload** (QA R-01): browsers keep a new AudioContext
  suspended until the next tap/click/key, so the end bell could be silent and a
  player studying in another tab could miss the end and claim late (lower
  reward). `soundLocked(snapshot)` (React: `useSoundLocked()`) is true while
  sound effects are on but the context is not running; the focus session shows
  "Toca para activar el sonido" (`screens/home/SoundUnlockChip.tsx`), whose
  click calls `audio.init()` inside the gesture. The engine emits on every
  `statechange`, so any other click that resumes audio hides the chip too, and
  `SessionWatcher` then calls `syncSessionEndToAudio()` (re-times a bell
  scheduled on a frozen clock, or the leader tab schedules it). `init()` also
  resumes Safari's `interrupted` state.
- **One end sound across tabs** (QA R-03): the tab that has the end bell on a
  *running* audio clock holds a Web Lock `pokefocus-end-bell:<sessionId>`
  (`scheduleSessionEnd`; released on cancel, when the context stops running, or
  when the tab closes). The leader tab, at the end, calls
  `chimeUnlessOtherTabRings`: it stays silent if it has its own bell or the lock
  is held by another tab, otherwise it chimes. A bell on a suspended context never
  claims, so the unlocked tab is the one that sounds. Without Web Locks the leader
  chimes as before.
- **Microphone in a hidden tab** (`src/ui/lib/mic/monitor.ts`, its own
  AudioContext, never connected to the speakers): frames are read every 100 ms
  from the same Worker tick source (`workerTickSource`), so a 2 s window still
  has ~20 frames when the tab is hidden (main-thread timers drop to ~1/s, then
  ~1/min). Fallback: `setInterval`, also if the worker errors while loading. A
  window with fewer than 5 frames (page frozen or suspended) is dropped: not
  classified, not credited, and the noise estimate does not learn from it;
  time already credited is never taken back. Switching tabs never costs
  analysed time beyond such frozen stretches.
- **Rate limiting**: each preset has `cooldownMs` and `maxInstances`; spammy
  ones (`uiHover` 70 ms, `pointsTick` 45 ms, `uiClick` 30 ms) are tight. `force: true` bypasses.
- **Variance**: UI and impact sounds get a random ± cents detune per play.
- **Ducking**: fanfare presets (`sessionEnd`, `catchSuccess`, `levelUp`,
  `evolveDone`, `leagueUp`, `shinyAppear`) lower music to 30 % for their length.

## Sound effects

Durations ≤ 1.5 s, fanfares ≤ 3 s (enforced by tests).

| Name | Sound |
| --- | --- |
| `uiClick` | Tiny soft pulse blip sliding down (1.1→0.76 kHz) |
| `uiHover` | Very quiet, very short triangle tick |
| `uiOpen` | Two-note rising fifth (E5→B5) |
| `uiClose` | Two-note falling fifth (B5→E5) |
| `toggle` | Two quick high blips (C6, G6) |
| `sessionStart` | Rising C-major arpeggio over a low C with a bell sparkle — "let's go" |
| `sessionEnd` | Gentle three-bell chime G5→C6→E6 with long tails; noticeable, not an alarm |
| `claim` | Quick G–D–G arpeggio with a high bell glint |
| `pointsTick` | Tiny high tick for counting numbers (pass a rising `pitch`) |
| `waveAppear` | Rustling-grass noise flutter, then a soft A→E sting |
| `wildAppear` | "!" — quick slide up a fifth with a low root |
| `shinyAppear` | Scattered high E-major bell pings + airy shimmer |
| `ballThrow` | Rising band-passed whoosh panning across |
| `ballShake` | Three wobble clicks at 0 s, 0.35 s, 0.70 s |
| `catchSuccess` | Lock click, then an original E–G–C–D–C jingle over a C chord (~1.4 s) |
| `catchFail` | Noisy pop + upward blip + small sad drop |
| `counterHit` | Low sine thud with a dull noise knock |
| `counterMiss` | Airy swish + soft falling tone |
| `flee` | Quick patter rising in pitch, fading and panning off to the right |
| `levelUp` | Original fanfare C–E–G–E–G → high C over a C-major chord (~1.2 s) |
| `evolveStart` | 1.4 s shimmering riser (two voices a fifth apart + rising air) |
| `evolveDone` | Quick Cmaj9 arpeggio blooming into a bell chord (~2 s) |
| `newMove` | G–A–D motif with a glint |
| `hintPop` | Soft rising sine blip — the mascot's tip bubble |
| `error` | Low rounded E→C "nope" (not a buzzer) |
| `exhausted` | Sleepy descending "yawn" with slow vibrato |
| `heal` | Soft F-major add9 bell shimmer rising upward |
| `leagueUp` | Bigger original fanfare: triplet pickup, I–IV–V–I with bass, harmony and a soft crash (~2.8 s) |

## Music

Generative: every bar picks the next chord of a progression (re-chosen every
4-bar phrase), voices it with minimal-movement voice leading, and writes bass,
arpeggios, melody (phrase motif with varied contour, strong beats snapped to
chord tones) and drums from a seeded RNG. Everything stays diatonic to one key
per track (tested). Pulse waves are always low-passed.

| Track | Idea |
| --- | --- |
| `focus` | F major, 72 BPM, lazy swing. Imaj7/vi7/ii7/V7-style seventh chords on a soft, dark triangle pad, slow bass, sparse pentatonic bell motifs, optional vinyl hiss + crackle. No drums. |
| `home` | G major, 94 BPM. Cozy town feel: plucked broken-chord eighths, walking bass with approach notes, sing-song pulse lead, soft kit. |
| `encounter` | A natural minor, 124 BPM. i–VI–VII / i–iv–VII–III: octave-pumping bass, eighth-note arps, light kit. Curious tension, not aggressive. |
| `results` | C major, 112 BPM. Rising bell arpeggios, bright pentatonic motif, light kit — celebratory bed. |

## AudioLab (dev panel)

```tsx
import { AudioLab } from '../../audio/AudioLab'
// inside DevPanel:
<AudioLab />
```

Buttons for every sfx (tooltip shows duration), a "count-up ×20" button to
hear `pointsTick` rate limiting, track switcher, duck toggle, volume sliders and
all settings toggles. Inline styles only.

## Where to fire each sound (integration notes)

| Moment | Call |
| --- | --- |
| App root | `<AudioProvider settings={…}>` or `installAudioUnlock()` once |
| Buttons / menu items | `uiClick`; hover on primary cards only: `uiHover` |
| Dialog/drawer open / close | `uiOpen` / `uiClose` |
| Switches, checkboxes | `toggle` |
| Start a focus session | `sessionStart`, then `music.play('focus')`; also `const end = audio.sfxAt('sessionEnd', remainingSec)` |
| Focus time ends | `sessionEnd` (already scheduled via `sfxAt`; cancel with `end.stop()` if the session is aborted/paused and reschedule on resume) |
| Leave session / back to menus, box | `music.play('home')` |
| Claim rewards | `claim`; animated counters: `pointsTick` with `pitch` rising per step |
| Capture waves | `music.play('encounter')`, `waveAppear` when a wave spawns, `wildAppear` per Pokémon reveal, `shinyAppear` instead for shinies |
| Throw | `ballThrow`, then `ballShake` (sync wobbles to 0/0.35/0.7 s) |
| Outcome | `catchSuccess` / `catchFail`; Pokémon runs: `flee` |
| Counter-attack | `counterHit` / `counterMiss` |
| Results screen | `music.play('results')`; `levelUp`, `newMove`, `leagueUp` as they appear |
| Evolution | `audio.setDucking(true)`, `evolveStart`, then `evolveDone`, `setDucking(false)` |
| Mascot tip appears | `hintPop` |
| Invalid action | `error` |
| Pokémon exhausted / healed | `exhausted` / `heal` |

Notes: don't call `uiClick` and a game sfx for the same click (pick the game
sfx). The app timer's own end-of-session callback may be throttled in hidden
tabs; `sfxAt` is the reliable way to ring at the right moment. With the dev
time-rate acceleration, compute `remainingSec` in real seconds.
