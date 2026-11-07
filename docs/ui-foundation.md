# PokeFocus UI foundation (part A)

This is the contract for anyone building screens on top of the prototype frontend. Read it before you add a screen. The game rules all live in `src/engine/` (see `docs/engine-api.md`). The UI never computes a formula itself: it asks the engine (`pokemonView`, `wildCatchChance`, `typeConditionMult`, `waveCount`…) and renders the answer.

```
src/
  index.css               design tokens (Tailwind v4 @theme), base styles, keyframes
  i18n/                   i18next setup, es.json / en.json, locales.test.ts
  ui/
    App.tsx               providers: Tooltip, Toast, HintLayer, DevPanel, SessionWatcher
    AppShell.tsx          side rail + current screen
    router.ts             hash router (useRoute, navigate, hrefTo)
    routes.tsx            screen registry  ← add screens here
    SessionWatcher.tsx    end-of-session notification, hint suppression
    components/           UI kit (import from 'src/ui/components')
    hints/                hint engine (import from 'src/ui/hints')
    api/                  typed fetch client, endpoint helpers, SSE events (talks to server/)
    changelog/            release stage + version, news page, version badge (see the last section)
    store/                zustand stores: game.ts (server cache), auth.ts, social.ts, group.ts, announcements.ts, prefs.ts (per device), clock.ts, selectors.ts, persistence.ts
    lib/                  names (localized data), format, conditions preview, notify, cx
    screens/              FirstRun, home/* (core loop, break, checklist), box/, team/, dex/, league/, missions/, shared/, Settings
    dev/DevPanel.tsx      developer tools
```

---

## 1. Design plan

**Subject.** A study timer where your Pokémon team "studies with you" and the reward is a wave of wild Pokémon to catch. The audience is university students, mostly Spanish-speaking, on a desktop browser, often studying late. The app has to do two jobs: start a focus session in two clicks, and then make the reward feel like a game.

**Concept: "the study route at dusk".** The chrome is a calm, deep-indigo surface that can stay on screen for hours. Above it sits the route band: a pixel landscape (sky, sun or moon, weather, grass and battle platforms) where your team stands. This band is the one bold element of the app, and it carries information:

- The sky follows the player's local time (morning, afternoon, evening, night). These use the same windows as the type conditions, so night is also when Ghost is active.
- The detected weather (device location or city; the dev panel can override it) changes the band (rain streaks, snow, a bigger sun).
- Platforms come from the battle screens. Empty team slots appear as dashed ghost platforms that explain how to fill them.
- On the waves screen the band becomes a field with tall grass. During a focus session it is dimmed.

Everything else stays quiet: flat surfaces, 2px "ink" outlines with notched pixel corners (drawn with box-shadows, so there is no border-radius anywhere), and hard drop edges instead of soft shadows.

### Palette (tokens in `src/index.css`)

| Token | Hex | Role |
|---|---|---|
| `ink` | `#0f1530` | Outlines (the same role as a sprite's outline), text on light plates |
| `dusk-950 / 900 / 800 / 700 / 600` | `#141b36` `#19213f` `#212b52` `#2b3866` `#39487f` | Background → wells → plates → raised controls |
| `mist-50 / 100 / 300` | `#f3f5fc` `#e4e8f6` `#aeb8db` | Text on dusk; light "nameplate" surfaces |
| `volt-400` | `#ffd23f` | The only accent (the mascot's yellow): primary actions, selection, focus ring |
| `leaf-400 / amber-400 / cheek-400` | `#62d68f` `#f6b544` `#ff6b66` | Energy/HP meters (as in the games), success/warning/danger |
| `exp-400` | `#6cc2ff` | EXP bar, info |
| `sky-*`, `grass-*` | see CSS | The route band only |
| `type-*` | 18 classic type hues | Type badges only |

### Type

| Face | Token | Use |
|---|---|---|
| **Tiny5** | `font-display` | Headings, buttons, labels, nameplates. Pixel face, multiples of 8px (16/24/32/40/48), never below 16px |
| **Jersey 10** | `font-num` | Every number that matters: timer, points, levels, counts, percentages |
| **Atkinson Hyperlegible Next** | `font-body` (default) | Body text, explanations, hints |

Scale: `text-xs 13` `sm 14` `base 16` `lg 20` `xl 24` `2xl 32` `3xl 40` `4xl 48` `timer 176` (px). Body lines stay under about 60ch. Copy is in sentence case, with no all-caps labels, no eyebrows above headings, no "A · B" meta strings, and no "→" in buttons (buttons use pixel icons).

### Layout

```
┌rail──────┐┌main (max 76rem) ──────────────────────────────────────────┐
│ logo     ││ Greeting + local time                                     │
│ Inicio ◀ ││ ┌ route band: sky by local time, weather, team on platforms┐│
│ Caja     ││ │  [sprite]  [sprite]   ┆ ghost slots: "5 free slots"     ││
│ Equipo   ││ │  nameplate nameplate  ┆                                 ││
│ Pokédex  ││ └──────────────────────────────────────────────────────────┘│
│ Liga     ││ ┌ Your next session (7fr) ─────┐ ┌ Conditions now (5fr) ──┐ │
│ Ajustes  ││ │ 25 50 75 100 Other           │ │ type · rule · ×mult     │ │
│          ││ │ weather keys                 │ └─────────────────────────┘ │
│ [live    ││ │ [ ▶ Start 25 min ]           │ ┌ League ────────────────┐ │
│  session]││ └──────────────────────────────┘ │ points, progress       │ │
│ trainer  ││                                  └─────────────────────────┘ │
│ bag      │└───────────────────────────────────────────────────────────┘
└──────────┘
```

Content is left-aligned. The two moments that are centered are the timer and the claim, because each is a single call to action. The rail is 15rem at ≥1280px, an icon rail at 640–1279px, and a bottom bar below 640px. The two-column grids stack below 1280px.

### Principles

1. **The route band is the only decoration, and it is informative.** Everything else is flat.
2. **Pixel art is content, not chrome.** Sprites scale by whole numbers with `image-rendering: pixelated`. UI icons are pixel grids too (`PixelIcon`, art `*.svg`), never an anti-aliased icon pack.
3. **One accent.** Volt yellow means "the thing to do now" or "selected".
4. **Every number explains itself.** A multiplier has its reason next to it, a meter has its label, and a stat has its "based on" tooltip.
5. **One orchestrated motion per moment:** the throw (arc, wobble, burst or stamp), the counterattack (shake plus a floating −N), and bobbing sprites on claim and results. All motion respects `prefers-reduced-motion`.

### What I revised after self-review

- **Plan stage.** My first idea was a cream "field notebook" theme (graph paper and index cards). That is the warm-cream AI default (trait 1), so I dropped it for the dusk route. I also replaced NES.css-style thick black borders on every element with 2px outlines that echo the sprite outlines, with notched corners only.
- **Hierarchy.** I avoided a "same card everywhere" kit by giving surfaces three levels: plate (outline + 8px drop edge), frame (outline only) and well (inset). The light "battle nameplate" plate is used only for Pokémon and for the results scoreboard.
- **Screenshot pass 1.** Pixelify Sans (preinstalled) rendered "C" like "O" and "5" like "S" ("Oaja", "2S min"). I switched the display face to **Tiny5**, which the UX research lists as a less-clichéd option, and moved the scale to multiples of 8. I removed Pixelify and the unused `@floating-ui/react-dom` (Base UI already positions popups).
- **Screenshot pass 1.** I fixed these too:
  - Mascot and logo sizes were fractional multiples of their pixel grid, so I snapped the mascot to 48/96/144 and the logo to a 16px height.
  - The logo is now inlined so its "Focus" text and outline can be themed light on dark.
  - Tall grass was covering the wild Pokémon's nameplates.
  - Two mascots appeared on screen at once (the page's and the hint's). Now only the hint speaks.
  - The results screen got a scoreboard inside the route band.
- **Screenshot pass 2.** I fixed responsive issues (cards truncating at 1024px, the league panel crushed) by changing the stage to flex with fixed 10.5rem cells and moving the two-column breakpoint to `xl`. I also made the session legend accurate for 25 minutes, made event hints wait behind first-visit hints, and moved the dev toggle off the page headers.
- **Screenshot pass 2.** The wild card had focusable tooltips nested inside its `<button>`, which I flattened into its aria-label. Three hints had no trigger, so they now fire on events: shiny, wave done, and Energy running low.

---

## 2. Headless primitives: Base UI

**Choice: `@base-ui/react` 1.9** (MUI and the Radix authors, MIT). It is used for Dialog, Popover (hints and "?" info tips), Tooltip, Tabs, Toast, Select and ToggleGroup.

Why:

- It is unstyled, with no CSS to fight. Styling goes through `className` and `data-*` state attributes (`data-pressed`, `data-active`, `data-starting-style`…), which fit Tailwind utilities and our tokens.
- It is the current successor to Radix primitives: actively released, and the default under shadcn/ui since 2026. Radix still works, but its releases have slowed.
- Popover takes an arbitrary `anchor` (element or virtual rect). That is exactly what the hint engine needs to point a bubble at any widget without wrapping it. Its `openOnHover` trigger is Base UI's recommended pattern for "info tips" that touch and screen-reader users can also reach.
- The global toast manager can be called from store actions and supports anchored toasts.
- React Aria is the most rigorous option, but it is more verbose and pulls in its own i18n layer, which we don't need because i18next covers it.

Sources: [DesignRevision on Radix alternatives (2026)](https://designrevision.com/alternatives/radix-ui), [Untitled UI: Base UI vs React Aria](https://www.untitledui.com/blog/base-ui-vs-react-aria), [LogRocket: headless UI alternatives](https://blog.logrocket.com/headless-ui-alternatives/). API docs ship with the package: `node_modules/@base-ui/react/docs/`.

---

## 3. Components (`src/ui/components`)

Import from `src/ui/components`. Every component takes `className`.

| Component | Key props | Notes |
|---|---|---|
| `Button` | `variant: primary\|secondary\|danger\|ghost`, `size: sm\|md\|lg`, `icon?: IconName`, `trailing?`, `beacon?` | Pixel frame, 3px press. Forwards ref, so it works as Base UI `render` |
| `IconButton` | `icon`, `label` (required), `size`, `variant` | Icon only, with `aria-label` |
| `Panel` | `variant: plate\|frame\|well`, `title?`, `help?: hintId`, `actions?`, `as?`, `padded?` | `help` puts a `HelpDot` next to the title |
| `Dialog` / `DialogClose` | `open`, `onOpenChange`, `trigger?`, `title`, `description?`, `footer?`, `size` | Modal (focus trap, Escape). Wrap footer buttons in `<DialogClose render={<Button/>}/>` |
| `Tooltip` | `content`, `side`, `variant: plain\|help` | `plain`: Base UI Tooltip, hover/focus only. `help`: Popover with `openOnHover`, which also opens on click/tap. Use `help` for anything people need |
| `InfoTip` | `content`, `label?` | A small "?" trigger with a help tooltip |
| `HelpDot` | `hint` | "?" button that re-opens a registered hint on demand |
| `Tabs` | `items: {value,label,content}[]`, `label`, `value?`, `onValueChange?` | Sliding volt indicator |
| `toast` / `ToastViewport` | `toast.add({ title, description?, type: 'info'\|'success'\|'danger' })` | Callable anywhere, including store code |
| `ProgressBar` | `value`, `max`, `variant: energy\|hp\|exp\|volt`, `label` (a11y), `valueText?`, `from?` (trail), `ticks?`, `size` | `role="meter"`. `energy`/`hp` colors: green >50%, amber >20%, red otherwise |
| `TypeBadge` | `type`, `size: sm\|md`, `muted?` | Localized name from `types.json` |
| `StatRow` | `stat`, `value`, `scale?`, `nature?` | PokeFocus name + art icon + help tooltip "basada en Velocidad"; ▲/▼ from the nature. Also exports `STAT_ORDER`, `STAT_ICON` |
| `Sprite` | `kind: showdown\|icon\|item`, `slug`, `shiny?`, `scale` (integer), `fit?` (items), `flip?`, `alt` | Sizes itself to natural size × scale. A missing file renders a framed placeholder |
| `BallIcon` / `StudyBallIcon` | `ball`, `size` | Item sprite, or the art Study Ball |
| `PokemonCard` | `view: PokemonView`, `variant: stage\|compact`, `leader?`, `condition?`, `energy?`, `energyFrom?`, `floating?`, `shake?`, `dim?`, `night?`, `footer?` | Sprite + battle nameplate (name, level, types, Energy, crown, ×condition) |
| `Stage` / `Platform` | `time`, `weather`, `variant: route\|focus\|field`, `celestial?`, `sky?` / `width`, `ghost?`, `night?` | The route band and the battle platform |
| `EmptyState` | `title`, `body`, `action?`, `pose?` | Says what the area is, how to fill it, and gives a button. The mascot speaks it |
| `Mascot` | `pose: idle\|point\|cheer\|think\|sleep`, `size: 48\|96\|144` | `/art/mascot-{pose}.svg`. If the file is missing it shows a pixel placeholder |
| `Logo` | `height: 16\|32\|48\|64`, `onLight?` | Inlined `/art/logo.svg`, themed for dark surfaces. Typeset fallback |
| `ArtSvg` / `ArtIcon` | `name`, `size: 12\|24\|36\|48` | Inlines `/art/*.svg` so `currentColor` and CSS variables work. Tint with `text-*` |
| `PixelIcon` | `name: IconName`, `size` (multiples of 10), `label?` | 10×10 pixel UI icons. Add one by adding a grid in `PixelIcon.tsx` |
| `Segmented` | `options`, `value`, `onChange`, `label`, `size` | One-of-many pixel keys (ToggleGroup) |
| `Select` | `options`, `value`, `onChange`, `label` | Base UI Select |

Utilities (from `index.css`):

- Shadows: `shadow-frame`, `shadow-plate`, `shadow-raised`, `shadow-pressed`, `inset-shadow-well`, `inset-shadow-bevel`.
- Animations: `pixelated`, `tabular`, `pixel-grid`, `animate-bob|wobble|shake|pop-in|float-up|throw-in|flash|burst|stamp|pulse-ring`.
- `[data-hint-active]` draws the beacon ring on the element a hint points at.

---

## 4. State (`src/ui/store`)

Since F2 the game does not live in the browser: **the server owns each player's document** (table `player_docs`, `docs/F2-plan.md` §Cliente, `docs/server.md`) and the game stores below are only caches of it. Nothing about the game is saved in `localStorage`: the prototype's `pokefocus:game` key no longer exists, and old local saves are not migrated.

| Store | File | What it holds | Where the truth lives |
|---|---|---|---|
| `useAuth` | `auth.ts` | `status: 'loading' \| 'anon' \| 'authed'`, `user: PublicUser` (email, trainerName, country, friendCode), `bootError`; login, register, logout, password and sessions | The server. The login session is an HttpOnly cookie (`pf_session`) that the client never reads. A 401, or the SSE `logout` event, sends the store to `anon` |
| `useGame` | `game.ts` | A cache of the `GameDoc` (below) | The server: `GET /api/game`, `POST /api/game/action` |
| `useFriends`, `useGroups` | `social.ts`, `group.ts` | Friends and requests; the study-group lobby and invites | The server: `/api/friends`, `/api/groups` |
| `useAnnouncements` | `announcements.ts` | Scheduled maintenance windows (public, polled) | The server: `/api/announcements` |
| `usePrefs` | `prefs.ts` | Per-device UI preferences (below) | `localStorage`, key `pokefocus:prefs` |

On sign-in, `useAuth` clears and reloads `useGame` and `useFriends` and opens the event stream (`api/events.ts`, `GET /api/events`); on sign-out it clears them and closes it. All HTTP goes through the typed client in `src/ui/api/` (`client.ts`, `endpoints.ts`).

### `useGame` (game.ts): a client cache of the server document

| Field | Meaning |
|---|---|
| `player: PlayerState \| null` | The engine state, untouched. `null` means the first run is showing |
| `timer: SessionTimer \| null` | `{ sessionId, endsAt, pausedAt, pausedMs, notified }` in game time |
| `outcome: LastOutcome \| null` | `{ result: SessionResult, events: ProgressEvent[], before, seen }` for the results screen |
| `breakTimer: BreakTimer \| null`, `lastBreakFor` | The pomodoro break in progress, and the last session whose break was taken or skipped |
| `version`, `loaded`, `loading`, `pending`, `error` | Client bookkeeping, not part of the document. `version` is the doc version we hold (−1 = nothing loaded); `pending` counts actions in flight (buttons disable while it is above 0); `error` is the last failure code |

The first five fields are the `GameDoc` of `src/game/protocol.ts`; the server stores it as one JSON document per user.

How it works:

- **Every action is a request.** Each helper is `async`: it POSTs a `GameAction` to `/api/game/action`; the server runs the pure reducer (`src/game/actions.ts`, `applyAction`) with the engine, saves the new document in one transaction, and answers with the whole document and its `version`. The store adopts the response only if its `version` is newer than the one it holds, so slow or out-of-order responses are dropped. Progress is therefore saved on every action: there is no save step, and a reload or another device gets the same state from `GET /api/game`.
- **The client never rolls dice or decides outcomes.** Rolls, points, captures and session times are decided by the server. The client only shows the result.
- **Other tabs and devices.** After every write the server sends an SSE `game` event with the new `version`; the listener in `auth.ts` reloads the doc if that version is newer. A failed action (other than a network error) also triggers a quiet reload, in case the cache was stale. Several browsers can be signed in at once; only one study session can be active per user.
- **Return values.** Helpers resolve to an error code or `null`, or to `{ ok, … }` objects, for the UI to map to `errors.*`. A failure that is not a game rule (network, 5xx, 403) comes back as `'network'` or `'http_<status>'` and is also kept in `error`.

Actions:

- **Setup:** `createPlayer` (language, time zone, starter; the trainer name comes from the account), `updateProfile` (language, time zone, city, `location`). `setWeather` is a dev-panel action only (the server refuses it without DEV_TOOLS=1).
- **Session:** `start(minutes)`, `pause`, `resume`, `cancel`, `claim()`, `markNotified`, `dismissResults`.
- **Waves:** `throwBall(ref, ball)`, `applyStatus(chargeId, ref)`, `reroll(chargeId, ref)`, `assignDamage`, `autoAssignDamage`, `setAutoDamage`, `nextWave`, `finishWaves`.
- **Box, team, missions and breaks:** `release`, `feedCandy`, `equip`, `setTeam`, `setLeader`, `evolve`, `heal`, `claimMission`, `claimAllMissions`, `startBreak`, `endBreak`, `skipBreak`.
- **Dev:** `devAddItems`, `devAddDust`, `devAddCandies`, `devFinishNow` (client-only: it moves the dev clock), `devLevelUp`, `devAddRandomPokemon`, `resetAll`.

`claim()` is idempotent on the server: it only works on an active session whose timer has ended, and a second claim (for example from another tab) gets `no_session`, so rewards are never delivered twice. It sends only the microphone percentages (`soundProfile`), never audio.

To add a mutation, extend the contract and the server, then the store (the checklist of `docs/session-depth-plan.md`): the action type and result in `src/game/protocol.ts`, its validation in `server/validation.ts`, a branch in the reducer (`src/game/actions.ts`) that calls the engine, a typed helper in `useGame` that calls `dispatch`, and tests.

`phaseOf(state, now)` returns one of:

```
'none' | 'idle' | 'focus' | 'paused' | 'claim' | 'late' | 'results' | 'waves' | 'break'
```

The phase is derived from the document and the clock, never stored, so a reload always lands on the right screen. `usePhase()` is the hook.

### `usePrefs` (prefs.ts), persisted as `pokefocus:prefs`

Per-device preferences only: it never touches `PlayerState` and is not synced between tabs or devices. It holds `locale`, `tipsEnabled`, `audio` (replaces the old `sound`), `seenHints`, `milestones` and `checklistDismissed` (getting-started checklist), `micEnabled` (microphone opt-in), `lastSeenVersion` (changelog dot) and `dev: { panelOpen, rate, anchor, focusLabel, seed, rngCounter }`. The old `tzChangedAt` is gone (a saved one is ignored when loading): the 30-day time-zone lock is `profile.timezoneChangedAt` in the server document.

**Time:** always use `now()` from prefs.ts, never `Date.now()`. Without the dev clock it is the browser clock corrected by the server skew (`serverNow − Date.now()`, measured on every game response, so countdowns match the server even if the device clock is off). With the dev clock it equals `anchor.virtual + (realNow − anchor.real) × rate`, and the virtual time travels to the server as the `x-dev-now` header. At rate 60, one study minute passes in one real second. React components use `useNow()` (clock.ts), which re-renders four times a second while visible and recomputes on `visibilitychange`; a Worker heartbeat keeps hidden tabs ticking.

**RNG:** the server rolls the dice. With a fixed dev seed, `nextSeed()` returns `"<seed>:<n>"` with an increasing `n` and it travels as the `x-dev-seed` header, so runs are reproducible. The server honors both dev headers only with `DEV_TOOLS=1` (never in production).

### What is stored where

| Where | What |
|---|---|
| **Server** (PostgreSQL / PGlite) | The account, the game document (team, Box, items, Pokédex, missions, history, the active session and its timer, results, breaks), the profile (language, time zone with its lock, city and rounded location), friends, study groups, rankings. Saved on every action |
| **Browser `localStorage`, `pokefocus:prefs`** | `usePrefs` (above) |
| **Browser, other keys** | The microphone calibration per device (`pokefocus.micCalibration.v2`, `lib/mic/calibration-store.ts`). The microphone tally, last problem and last result of a session in `sessionStorage` (`lib/mic/monitor.ts`), and the admin token in `sessionStorage` (`pokefocus:adminToken`) |
| **Cookie `pf_session`** | The login. HttpOnly, so the client cannot read it |
| **Memory only** | `useAuth`, `useGame`, `useFriends`, `useGroups` and `useAnnouncements` are rebuilt from the server on every page load |

### Persistence

`persistence.ts` exports `storageBackend` (`localStorage` with an in-memory fallback), `jsonStorage` and `STORAGE_KEYS`. Only `usePrefs` uses it. It is not the place to persist game data: add a field to the `GameDoc` and an action instead (§4 above). `STORAGE_KEYS` only has `prefs`: the prototype's `game` key was removed.

### Selectors and helpers

- `selectors.ts`:
  - `usePlayer()` (only below FirstRun)
  - `useTeamViews(player, now, uids?)`: engine `pokemonView`s, recomputed once per game minute
  - `useScene(player, now)`: sky phase and weather for `Stage`
- `lib/names.ts`: `useNames()` returns localized `species/type/move/item/nature/ability` plus `technique(slug)` / `abilityDesc(slug)` descriptions from the custom data.
- `lib/conditions.ts`: `conditionsNow(state, now, minutes)` builds a "session starting now" `ConditionEnv` and asks the engine for each type's multiplier. It mirrors the env that `completeSession` builds; if the engine gains a `conditionEnvAt` helper, switch to it. It also exports `WEATHER_PRESETS`, `weatherKind` and `timeOfDay`.
- `lib/format.ts`: `fmtInt`, `fmtPct`, `fmtCountdown`, `fmtClock` (profile time zone), `fmtWeekday`, `allTimeZones`.

---

## 5. Session timer

- `endsAt` is persisted when the session starts. Remaining time is `endsAt − now()`; nothing is ever decremented. Pausing stores `pausedAt`. Resuming adds the paused time to both `endsAt` and `pausedMs`, and `pausedMs / 1000` is passed to the engine as `pausedSeconds`.
- The Start click calls `primeSignals()`, which creates or resumes the AudioContext and asks for Notification permission once (never again after "denied").
- `SessionWatcher` runs on every tick. When the phase becomes `claim`, the **leader tab** (a held Web Lock, `pokefocus-leader`) does the following, guarded by the persisted `timer.notified` flag so it happens once:
  - sends a Notification (`tag: pokefocus-session`)
  - plays a soft three-note chime (unless sound is off)
  - changes the tab title if the tab is hidden
- The claim window comes from config (`claimWindowMinutes`). After it, the phase is `late`, and the copy explains the 50% before you press Claim.

---

## 6. Hint engine (`src/ui/hints`)

The mascot speaks contextual hints. It is not a tour.

### Rules

- At most **one** hint is on screen at a time.
- At most **2 automatic hints per screen visit** (`MAX_AUTO_PER_SCREEN`). A sequence counts as one.
- **No automatic hints during a focus session.** `SessionWatcher` calls `setHintsSuppressed`.
- No automatic hints when the player chose "Don't show tips" (`tipsEnabled = false`).
- Seen flags persist in `prefs.seenHints`. Closing a sequence step marks the whole sequence as seen.
- `HelpDot` (and `openHint`) always works, even for seen hints and with tips off.
- Settings → "Replay tips" and Dev → "Reset tips" clear the flags.

### API

```ts
import { registerHints, useHintScreen, hintAnchor, emitHintEvent, useHintEvent, openHint } from 'src/ui/hints'

registerHints([{
  id: 'box.firstVisit',                 // copy: hints.box.firstVisit.title / .body in es.json + en.json
  screen: 'box',                        // matches useHintScreen('box'); '*' = any screen
  trigger: { kind: 'firstVisit' }       // | { kind: 'event', event: 'candyUsed' } | { kind: 'focus' } | { kind: 'manual' }
  anchor: 'box.grid',                   // data-hint-anchor of the target; omit for a docked bubble
  pose: 'point', side: 'bottom',
  sequence?: 'boxTour', order?: 1,      // up to 4 steps, shown with "n/4"
}])

function BoxScreen() {
  useHintScreen('box')                               // once per screen component
  useHintEvent('candyUsed', usedCandy)               // emits once when the condition becomes true
  return <div {...hintAnchor('box.grid')}>…<HelpDot hint="box.firstVisit" /></div>
}
emitHintEvent('throw.failed', { name, damage })      // values are interpolated into the copy
```

- `focus` triggers fire the first time the anchor element is hovered or focused.
- If the anchor is not on screen within about 1.5s, the bubble docks bottom-right.
- To register hints for a new screen, create `src/ui/hints/<screen>.ts` with a `registerHints([...])` call, import it from `src/ui/hints/index.ts`, and add the copy to both locale files. `locales.test.ts` fails if any registered hint has no title or body.

### Hints registered by part A

| Group | Hint ids |
|---|---|
| Home | `home.team`, `home.start` (first visit); `home.conditions`, `home.weather`, `home.league` (focus); `home.energy` (event `energyLow`); `home.duration` (manual) |
| Claim and results | `claim.window`, `results.why` (first visit); `results.levelUp` (event) |
| Waves, guided first wave (4 steps) | `waves.hp`, `waves.studyBall`, `waves.throw`, `waves.flee` |
| Waves, events | `waves.counter` (`throw.failed`), `waves.fled`, `waves.firstCatch` (points at the Box nav item), `waves.charges`, `waves.shiny`, `waves.next` (`waveDone`) |

The nav items carry the anchors `nav.home`, `nav.box`, `nav.team`, `nav.dex`, `nav.league` and `nav.settings`.

---

## 7. i18n

- ES (neutral Latin American, "tú") and EN, in `src/i18n/locales/{es,en}.json`. The default comes from the browser (`detectLocale`); the choice is saved in prefs.
- Names and descriptions of species, types, moves, items, natures, abilities and techniques come from the data (`useNames()`), never from the dictionaries.
- Plurals use i18next `_one` / `_other` keys with `count`.
- **Stat names:** never show the original ones. Use `stats.<key>.name` (Energía/Energy, Ritmo/Pace, Rendimiento/Output, Captura/Catch, Técnica/Technique, Aguante/Grit). `stats.<key>.base` is only for the "basada en …" line.
- **Engine error codes** map to `errors.<code>`, `errors.throw.<code>` and `errors.charge.<code>`.
- **Locale test:** `src/i18n/locales.test.ts` checks that both files have the same keys, that every literal `t('…')` key used in `src/ui` exists, and that every registered hint has copy. Dynamic keys (`` t(`roles.${r}.name`) ``) are not checked, so keep their families complete.

---

## 8. Adding a screen

1. Create `src/ui/screens/Box.tsx` (or a folder). Start with `useHintScreen('box')`.
2. Read the player with `usePlayer()`, time with `useNow()`, and derived numbers with engine views (`pokemonView`, `levelProgress`, `evolutionOptions`…).
3. Mutations go through a `useGame` action that sends the intent to the server, which runs the engine and returns the new document (see §4).
4. Default-export the screen and add it to `src/ui/routes.tsx` as a lazy route: `{ id: 'box', labelKey: 'nav.box', icon: 'box', component: lazy(loaders.box), nav: true, preload: loaders.box }`. Use `navigate('box', uid)` and `useRouteParams()` for detail views (`#/box/p12`).
5. Add copy to both locale files and register the screen's hints (§6).
6. Empty states teach: use `EmptyState` with what the area is, how to fill it, and an action.

---

## 9. Conventions

- **No formulas in the UI.** If a number is not in a view, add a pure helper to the engine; don't compute it in a component.
- **No raw colors.** Use tokens only (`bg-dusk-800`, `text-volt-400`, `bg-type-fire`). Add tokens to `@theme` if you need more.
- **Pixel integrity.**
  - Sprites use integer `scale`.
  - The mascot is 48/96/144.
  - Art icons are 12/24/36.
  - `PixelIcon` sizes are multiples of 10.
  - Tiny5 sizes are multiples of 8.
  - No fractional `transform: scale()` on pixel art.
- **Sprites:** showdown front sprites face left. Our team uses `flip`, so it faces right, toward the wild Pokémon.
- **Art files** in `public/art/` are generated by `scripts/art/`; don't edit them by hand. `ArtSvg` inlines them for theming.
- **Accessibility.**
  - Every icon-only control has a label.
  - Meters use `role="meter"` with real values.
  - Interactive cards are a single button with a full `aria-label`; don't nest focusable elements inside them.
  - The focus ring is a 3px volt outline.
  - `prefers-reduced-motion` disables animations, and the throw lands instantly.
- **Copy.**
  - Sentence case, active verbs.
  - An action keeps its name through the flow ("Reclamar recompensas" → toast). Errors say what happened and how to fix it.
  - No all-caps labels, eyebrows, "→" or middle-dot meta strings.

---

## 10. Dev panel

Open it with `?dev` in the URL or Settings → Developer tools. The wrench button (`DevToggle`) sits at the bottom of the side rail, so it never covers page content (below 640px it floats at the top right; it is not shown on the first-run screen). The panel itself floats over the main column. It provides:

- **Clock:** 1× or "1 min = 1 s", +1 h, +1 day, back to real time. A rate change or time jump re-times the end-of-session bell already scheduled on the audio clock (`resyncSessionEnd`, called by `SessionWatcher` when `dev.anchor` changes).
- **Session:** finish the session now (jumps the clock to `endsAt`), and the simulated Focus label (studying, educational, chat, social, game, no permission), sent as `devFocusLabel` with the claim. Only a server with `DEV_TOOLS=1` honours it; in production Focus is always the neutral value.
- **Items:** add Balls, Dust, or candies (for the team's chains and types).
- **RNG:** a fixed seed.
- **Hints:** reset tips.

---

## 11. Part B (screens, audio, missions)

### Screens

| Route | File | What it does |
|---|---|---|
| `#/box` | `screens/box/Box.tsx` | Grid of `MonTile`s, search, type/role/where filters, shiny-only switch, sort (recent, level, Pokédex no., IV quality). Filters live in `screens/box/filters.ts` (`useBoxFilters`, kept while you browse details). "Mochila" side panel: Dust, Balls, candies by line/type, items |
| `#/box/<uid>` | `screens/box/Detail.tsx` (+ `Techniques.tsx`, `Growth.tsx`, `EvolveMoment.tsx`) | Hero on the route band, nameplate with team/leader/release actions, prev/next through the filtered list. Technique slots (1–4, locked slots say their level, "replace" mode when full), known techniques with category/power/base and effective chance/limits/Mastery stars, locked extras "Se desbloquea al nivel X". Candies (species + type; Dust cost, predicted level, level-cap message linking to the Pokédex). Evolution options with why each is blocked; the evolution moment (white silhouettes swapping faster, burst, `evolveStart`/`evolveDone`, music ducked). Stats (`StatRow`), nature "+Ritmo −Captura", ability, IV quality, origin. Energy + healing items + Bond. Release dialog shows the candies you get |
| `#/team` | `screens/team/Team.tsx` | Band with the team, ordered slot rows (▲▼, crown = leader, remove), warnings (asleep via `isAsleepAt`, exhausted, may run out in 25 min), leader panel (Grit, Energy, type weaknesses/resistances), "add from the Box" list. Locked during a session |
| `#/dex` | `screens/dex/Dex.tsx` | Level-cap ladder (config `levelCaps`), 56 species as caught (color + check) / seen (dimmed) / unknown (silhouette, "???"), entry with genus, flavor text (es/en), types, role and `EvoLine` |
| `#/league` | `screens/league/League.tsx` | League hero, one equal step per league (thresholds, "about N per wave, up to M" from `leagueWaveBonus`/`leagueMaxWaveSize`), reset countdown, monthly league; stats tiles; charts (minutes per day this week, points per session, Focus trend) and the session history table |
| `#/missions` | `screens/missions/Missions.tsx` | Daily/weekly missions with renew countdowns, Pokédex milestones, progress bars, rewards, claim / claim all (`claimMission`, `claimAllMissions`). Nav badge = `missionsView().claimable` |
| `#/settings` | `screens/Settings.tsx` | Account (`account/AccountPanel.tsx`: email, trainer name and country, each behind a confirm dialog and a 30-day lock from `PublicUser.nameChangedAt` / `countryChangedAt` that disables the field and shows the unlock date, dev mode bypasses, a stale-clock 409 `name_locked` / `country_locked` refreshes the user and toasts the date; a privacy switch "anonymous in the global and country rankings" saves at once, and the Leaderboards then show `trainerName: null` rows as "Entrenador anónimo", with a "Oculto para los demás" tag on my own row; password, devices), language, time zone (confirm dialog + 30-day lock stored in the server document as `profile.timezoneChangedAt`; dev mode bypasses), weather ("Usar mi ubicación" rounded to ~10 km / remove it, typed city as fallback, detected weather line; no manual weather), audio (mute, master/music/sfx sliders with preview sounds, music during focus, focus level, background, vinyl), microphone (calibration wizard: silence required, voice and speaker music optional, live check; live meter with the level over the mic noise), notifications, tips + replay (also restores the checklist), dev tools, reset, about |
| Home extras | `screens/home/Break.tsx`, `Checklist.tsx` | Pomodoro break: offered on Home after a session (one per session, within 60 min; 5/10/15 min). Phase `break` shows a calm countdown; completing it calls the engine `completeBreak` (+`breakRecoverPct` Energy, previewed per member); ending early gives nothing. Getting-started checklist (7 steps; session/catch/team derived from the save, mission/equip/candy/evolve are `prefs.milestones`), dismissible |
| Waves extras | `screens/home/Waves.tsx` | IV quality row when `encounterModifiers().revealWildIvs`; "Golpes" row from `Wave.hits` (who weakened each wild); Study Ball limit from `studyBallMaxLevelFor` |

Screens other than Home are lazy routes (`routes.tsx`, `preload` on idle, `Suspense` in `AppShell`). `vite.config.ts` splits `game-data` and `vendor` chunks: index ≈ 320 kB, game data ≈ 383 kB, vendor ≈ 484 kB, each screen 3–36 kB.

### New components

`Slider` (Base UI, 0–1 volume), `Switch` (Base UI), `Stars` (pixel stars), `CategoryChip` (damage/passive/activable), `IvQuality` (engine `ivQuality` tiers), `MonTile` (box tile, one button), `RoleBadge` (role + help tooltip), `BarChart` / `LineChart` (hand-built single-series pixel charts with per-mark tooltips, sparse labels, empty state), `TYPE_BG` map. Shared: `screens/shared/EvoLine.tsx` (`EvoLine`, `lineRoot`, `useEvoCondition`). New `PixelIcon`s: lock, search, heart, potion, trash, up, down, sparkle, chart, coffee, egg, missions.

### Stores

- `useGame`: `release`, `feedCandy`, `equip`, `setTeam`, `setLeader`, `evolve`, `heal`, `claimMission`, `claimAllMissions`, `startBreak` / `endBreak` / `skipBreak` (`breakTimer`, `lastBreakFor` live in the server document), dev `devLevelUp(n)`, `devAddRandomPokemon(n)`. `phaseOf` has a `break` phase.
- `usePrefs`: `audio: AudioSettings` (replaces part A's `sound`; a saved `sound: false` becomes muted), `milestones`, `checklistDismissed`.
- Engine helpers added (additive, tested in `src/engine/helpers.test.ts`): `ivQuality(ivs)`, `conditionEnvAt(state, now, minutes)` (now used by `lib/conditions.ts`).

### Audio wiring (`src/audio`, see `docs/audio.md`)

- `AudioBridge` (App root) mirrors `prefs.audio` through `AudioProvider` (which unlocks on the first gesture) and plays a delegated click sound: `uiClick` on buttons/links, `toggle` on switches and pressed keys. Opt out with `data-sfx="none"` (used where a screen plays its own sound) or name one with `data-sfx="<SfxName>"`.
- `MusicDirector`: `focus` during focus/paused (any screen), `results` on Home claim/results, `encounter` on waves, `home` elsewhere. The engine crossfades and honours "music during focus".
- `lib/sound.ts`: `sfx`, `sfxLater`, and the session-end bells scheduled on the audio clock at Start/Resume (`scheduleSessionEnd`, cancelled on pause/cancel, re-timed by `resyncSessionEnd` when the dev clock changes). `SessionWatcher` only plays `sessionEnd` itself if nothing was scheduled (reload) and also signals the end of a break. The old chime in `notify.ts` now calls the sfx.
- SFX: sessionStart, claim, pointsTick (count-up on Results, rising pitch), levelUp / leagueUp / newMove after the count, waveAppear + wildAppear per wild (panned) + shinyAppear, ballThrow, ballShake, catchSuccess/catchFail, counterHit/counterMiss, exhausted, flee, evolveStart/evolveDone, heal (potions, break), hintPop (automatic hints), error (every `danger` toast, via `toast.add`). `AudioLab` is in the dev panel (Sound section).

### Hints added (`src/ui/hints/partB.ts`)

| Group | Hint ids |
|---|---|
| Box | `box.intro` (first visit), `box.filters` (focus), `box.candies` (manual) |
| Detail | tour `detail.techniques` → `detail.candies` → `detail.actions`; `detail.evolve` (event `evolveReady`); manual: `detail.mastery`, `detail.extraMoves`, `detail.iv`, `detail.stats`, `detail.levelCap`, `detail.energy`, `detail.bond` |
| Team | `team.intro`, `team.leader` (first visit), `team.order` (manual), `team.tired` (event `teamTired`) |
| Pokédex | `dex.intro`, `dex.cap` (first visit) |
| League | `league.intro` (first visit), `league.stats` (focus), `league.focus` (manual) |
| Missions | `missions.intro` (first visit), `missions.ready` (event `missionReady`, any screen, points at the nav item), `missions.pokedex` (manual) |
| Home / break / waves / settings | `home.break` (event `breakOffer`), `home.checklist` (event `checklist`), `break.why` (first visit), `waves.iv` (event `ivReveal`), `settings.audio` (focus) |

`waves.studyBall` now interpolates `{{level}}` (Waves sets the hint value from `studyBallMaxLevelFor`).

### Dev panel additions

"+ Pociones y piedras", "+5 niveles al equipo" (up to the cap), "+10 Pokémon" (random, some shiny, marks them seen/caught), Audio lab.

### Leftovers

- Missions only grant placeholder items (Tera Shard, TM) that show a pixel icon; nothing uses them yet.
- Saved teams, mints/caps and trading are later phases (rankings and friends shipped in F2).
- The detail sheet hides the name of evolutions you haven't seen ("???") on purpose.

---

## Types guide, planner and session mute (package D)

- **Types guide** (`screens/home/TypesGuide.tsx`): the "Todos los tipos" button at the bottom of the conditions panel opens a `Dialog` with the 18 types. Each card has the badge, the multiplier (the top one, with "hasta" for Poison and Bug, while it is off), Active or Inactive, the rule (`conditions.rule.*`) and one sentence on how it switches on ("Se activa mañana a las 05:00", "el sábado", "con una racha de 7 días (llevas 3)"). The team's types come first, with a volt frame and a "Tu equipo" tag.
- **Planner** at the top of the dialog ("¿Y si empiezo a las…?": day, time, length) recomputes the table for that start. Fields the player does not touch follow the clock and the panel's duration. A time that has already passed today means now. The weather of another day is unknown, so those days use no weather.
- **No rules in the UI.** `conditionOutlook` / `nextActivation` (`src/engine/activation.ts`, `docs/engine-api.md`) return data; `screens/home/typesGuideText.ts` only picks the words (`typesGuide.next.*`, `typesGuide.when.*`). `typesGuideText.test.ts` renders every branch in ES and EN. The sentences for Flying, Psychic and Fairy already speak of the microphone and of group study.
- **Microphone** (`screens/home/SoundStyle.tsx`, `screens/MicSettings.tsx`, analysis in `lib/mic/`, GDD §4.3):
  - `MicToggle` (PreSession): switching it on asks for permission; a device without a calibration with noise profile opens `MicCalibrationDialog` and the pref only turns on once the silence step is done (cancel = off). While on, a line with the calibration date and "Volver a calibrar". No study-style selector, no headphones option (`micHeadphones` and `micCalibrationOffered` are dropped from saved prefs).
  - Wizard: intro → silence 5 s (required) → voice (recommended: "Hablar 5 s" / "Saltar") → music ("Pon música por los altavoces (5 s)" / "Saltar este paso") → live check with ticks for Silencio/Voz(/Música) and "Repetir calibración". The `LiveMeter` shows the kind (`aria-live` polite, changes at most every 2 s) and the level over the mic noise.
  - `MicIndicator` (FocusSession): "Silencio · 3 min analizados", "En pausa…", or "Micrófono detenido: permiso denegado / se desconectó…". The chip is `aria-live="off"`; an sr-only region announces problems at once and kind changes at most every 30 s.
  - `StudyStyleLine` (Results): the measured style with the four shares, or "No se aplicó el micrófono: …" from the local per-session record (`useMicResult`, saved at claim).
- **Mute** (`screens/home/MuteMusicButton.tsx`): an icon toggle (`aria-pressed`, fixed label `focus.muteMusic`) next to Pause and Abandon in `FocusSession`. It only switches "music during focus", the same option as in Settings, so volumes and the end-of-session chime are untouched (`focusMusicPatch`, `docs/audio.md`). New pixel icons: `volume`, `volumeOff`.

## Release stage, changelog and maintenance notices (2026-11-06)

- **Stage and version** (`src/ui/changelog/release.ts`): `RELEASE_STAGE` (`'alpha' | 'beta'`) and `APP_VERSION` (the newest changelog entry). The game is in **alpha**. `StageBadge` ("ALFA v0.4.0", links to `#/changelog`) sits under the logo in the rail (xl), as an "ALFA" chip in the icon rail (sm–xl), on the sign-in screen and in Settings → About; the phone's bottom bar has no room for it. A red dot shows when `usePrefs().lastSeenVersion` differs from `APP_VERSION` (the first time a device runs the app it only records the version, so new players see no dot). Opening the news page records it.
- **To ship a version:** add an entry at the top of `src/ui/changelog/entries.ts` (every text in ES and EN, short, player-facing) and bump `version` in `package.json` (`npm version X.Y.Z --no-git-tag-version`). `changelog.test.ts` checks the order, the dates, both languages and that `package.json` agrees. **To move to beta:** change `RELEASE_STAGE`; the texts for both stages are already in the locales.
- **News page** (`#/changelog`, `changelog/Changelog.tsx`, not in the rail): the stage panel with what is coming, then one card per version with New / Improved / Fixed lines.
- **Maintenance banner** (`MaintenanceBanner.tsx`, `store/announcements.ts`, `lib/maintenance.ts`): `GET /api/announcements` is public, so the banner also shows on the sign-in screen. It is polled every 2 minutes and when the tab becomes visible, and a failed poll keeps the last list. Windows are absolute instants and are written in each viewer's own time zone ("vie, 6 nov, 10:02 – 12:02 GMT-5"), compared against the server's clock (`skew`). A running window wins (red, cannot be closed); otherwise the soonest upcoming one (amber, "Empieza dentro de 59 minutos", can be closed until the next reload). The admin's note is shown as plain text.
- **Admin** (`#/admin`, `screens/admin/Admin.tsx`, not linked anywhere): schedule and remove windows. It asks for the server's `ADMIN_TOKEN` (kept in `sessionStorage`, gone when the tab closes); it is not tied to the player account, and a wrong token must not sign the player out (`allow401` on every `adminApi` call). It previews the banner as players will see it. The notice only informs: the server does not block anything during a window (`docs/server.md` → Maintenance notices).

## Push notices (service worker)

- **Why:** the page still shows the end-of-session notification itself (`lib/notify.ts`, leader tab, `timer.notified`). A hidden tab the browser froze (or a closed one) shows nothing, so the server also pushes as a fallback when the page did not notify (rule and endpoints: `src/game/protocol.ts` → "Web Push"). The 5-minute claim window does not change.
- **Flow** (`lib/push.ts`, `public/sw.js`): Settings → Session → "Avisos aunque la pestaña esté dormida o cerrada" (`screens/PushSettings.tsx`). Switching it on, from the click: ask notification permission if still undecided, register `/sw.js` (scope `/`), wait for `ready`, `pushManager.subscribe({ userVisibleOnly, applicationServerKey })` with the key from `GET /api/push/config`, then `POST /api/push/subscribe`. If the server refuses, the browser subscription is dropped again. Off: `POST /api/push/unsubscribe`, then the browser unsubscribes. The state line covers unsupported browser, server without VAPID keys, blocked permission, off and on; "Enviar aviso de prueba" (`POST /api/push/test`) only shows when on.
- **Per browser:** a subscription belongs to this browser, stored on the server under whoever is signed in. After every sign-in (and boot) `syncPushOnSignIn` re-posts an existing subscription, so it moves to the account now using this browser.
- **The worker** shows a `session-end` push only when no window of the app is visible (a visible page notifies on its own, so it would double). A `test` push always shows (it is sent from a visible Settings page). It uses the page's tag, `pokefocus-session` (`PUSH_TAG`), so a second notice replaces the first. An empty or malformed payload still shows a generic notice (the browser requires one). Clicking focuses an open window of the app (without reloading it) or opens one; only same-origin relative urls are followed. `pushsubscriptionchange` re-subscribes and re-posts, best effort. No caching, no offline.
- **Logout:** before the logout call, `forgetPushOnSignOut` asks the server to forget this browser's subscription (best effort, at most 3 s, never blocks logout), so the previous player's pushes do not pop up on a shared browser. The browser keeps its subscription; the next sign-in hands it over.
- **Tests:** `lib/push.test.ts` (flows on fake browser objects), `lib/push.sw.test.ts` (runs `public/sw.js` with a fake `self`), `screens/PushSettings.test.tsx` (every state in ES and EN).

## Stats | IVs tabs and the evolution preview

- **Card** (`screens/box/StatsPanel.tsx`, right column of the detail sheet): the header is the kit's `Tabs` (`Estadísticas | IVs`, arrow keys via Base UI); the Panel's "?" (`detail.stats`) sits at the right end of the strip. The selected tab is local state, so it resets to Estadísticas when paging with Prev/Next (`BoxRoute` keys `Detail` by uid); `initialTab` exists for tests.
- **Estadísticas** is the Pokémon's current effective stats (already with IVs, level and nature): bars, the derived lines, Nature (with the +/− markers and its tip), Ability, Origin. **IVs** shows the overall quality (`IvQuality`, with the `detail.iv` "?"), three plain sentences (`iv.what/fixed/effect`) and one row per stat with 0–4 stars and the tier word, plus a "Máximo" chip for a stat at `ivMax`. Exact IV numbers are deliberately not shown (GDD §6.1, the `detail.iv` hint calls them hidden values, and the wild reveal effect only shows quality). The per-stat tier reuses `ivQuality`'s thresholds (`ivStatTier`).
- **Evolution preview** (`EvolutionPreview.tsx`, one per option in the Evolution card, collapsed behind "Ver cambios de estadísticas"): six rows `now → new (+N)` at the current level, the biggest gain highlighted, and a note that IVs and nature stay. The numbers come from `statChangeOnEvolution(pokemon, toSlug)` in `evolutionStats.ts`, which is `computeStats` with the evolved species and never calls `evolvePokemon`. Not every evolution raises every stat (Caterpie → Metapod lowers Pace and Catch), so a drop is shown as `(−N)` and is never highlighted.
- **Tests:** `evolutionStats.test.ts`, `StatsPanel.test.tsx` (both tabs, ES and EN), `EvolutionPreview.test.tsx`, and a block in `Detail.test.tsx`.
