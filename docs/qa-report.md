# QA report: prototype F1 (UI, audio, missions)

Date: 2026-11-04. Build under test: commit `cad7dee` plus the fixes listed below. Browser: Chromium (headless, Playwright 1.64), dev server `vite --port 5181`. Languages: ES (es-PE) and EN. Viewports: 1440x900, 1024x800, 390x844. A veteran save (a week of sessions, 24 Pokémon) and fresh first-run saves were used; the dev panel (`?dev`, 1 min = 1 s) drove the long flows.

Final command status: `npm run typecheck` green, `npm test` green (17 files, 198 tests; 8 new), `npm run build` green.

## 1. Summary

| | High | Medium | Low | Info |
|---|---|---|---|---|
| Bugs fixed | 0 | 2 | 11 | 0 |
| Bugs remaining | 0 | 2 | 6 | 2 |

No data loss, no blocked core loop, no uncaught exception and no failed or 4xx/5xx network request in any run. The only console output was the browser's `The AudioContext was not allowed to start` warning, 457 times across all runs; it is fixed (see Q-07).

Top remaining issues: R-01 (end-of-session sound can be silent after a reload until the user clicks), R-02 (a session can be started with a fully exhausted team; now warned, not blocked), R-03 (double chime when two tabs are open and the session was started in the non-leader tab; fixed, see section 4).

## 2. What was tested and the result

| # | Area | Result | Notes |
|---|---|---|---|
| 1 | First run, starter, home hints, 25-min session, claim on time, results, waves (Study Ball catch, Poké Ball fail with counterattack, flee after 3 fails), break, home | Pass (ES+EN, 1440+1024) | Hints: 2 on Home, 1 on Claim, 1 on Results, a 4-step tour on the first wave, 1 per event (counter, fled, shiny...). None during focus (0 in 7 screens visited mid-session). Hints that were skipped during focus appear after the session, then never again. HelpDots reopen seen hints, also with tips off. Break: starts from the Home offer, survives a reload, completes with +Energy (leader 20.9 to 23.4) and the offer disappears. |
| 2 | Persistence | Pass | Reload mid-session: timer shown 24:54 vs expected 24:53 (diff <= 1 s), `endsAt` unchanged, no hint. Pause survives reload (24:53 / 24:53); resume extends `endsAt` by the paused time. Reload in the claim window keeps Claim; double-click Claim applies once (history 14 to 15); reload on Results keeps the outcome. Reload on waves keeps balls, Pokémon and fails; reload 700 ms into a throw animation keeps the already-applied result and spends the ball once. Late claim (after +1 h): copy says 50 % before pressing, Results shows "Reclamo tarde x0.5". Cancel clears session and timer. |
| 3 | Two tabs | Pass with one Low | Session started in tab B appears in tab A at once (storage event); `start()` in A returns `session_active`; second `claim()` from the other tab returns false. Only the leader tab (Web Lock) sent the Notification (A=1, B=0) and `timer.notified` is set once. See R-03 for the audio detail. |
| 4 | Real-time sanity, 60 s without acceleration | Pass | 13 samples, 5 s apart, max drift 0 s against `endsAt - Date.now()`; tab title follows the timer; after 8 s with the tab in the background the timer is still exact. |
| 5a | Box: filters, sort, search, shiny, team/box | Pass | Search, type (19 options), role (8), 4 sorts (recent, level, Pokédex no., IV quality), where (all/team/box), shiny switch, empty state with "Quitar filtros". |
| 5b | Detail: equip, replace, unequip, locked extras, candies, level cap, evolve, release, heal | Pass | Equip fills free slots; when full the button says "Cambiar" and a "Reemplazar esta" appears on each slot; unequip works; locked extra "Enfado" says "Se desbloquea al nivel 40"; candy use disabled at the cap and the cap panel says "Nivel máximo por ahora: 30. Captura 25 especies ... Llevas 11." with a Pokédex link; evolve runs the moment animation and the Pokémon changes species; Release is disabled for team members, the dialog shows the candy gain, Escape closes and returns focus, confirm removes the Pokémon and adds the candy; Potion raised Energy 5 to 25, Revive stays disabled until the Pokémon is exhausted. |
| 5c | Team editor | Pass | Reorder with up/down, make leader moves to slot 0, remove, add from Box, cap of 6 (all Add buttons disabled), exhausted and "may run out" warnings, whole editor disabled during a session. |
| 5d | Pokédex | Pass | 56 entries as caught / seen / unknown (silhouette, "???", "Aún no lo has visto"), level-cap ladder with "Captura 14 especies más". |
| 5e | League | Pass | Hero, 4 league steps, charts with per-mark tooltips (39 focusable targets), Focus trend, history table, reset countdown. |
| 5f | Missions | Pass | Claim one gives its reward, "Reclamar las 4" claims the rest, nav badge goes 4 to 0, a claimed mission cannot be claimed twice. (A saved daily list from the previous day is replaced on first claim; this is the engine's day rollover, not a bug.) |
| 5g | Settings | Pass | Language switch updates nav and every screen at once and survives reload (8 routes scanned in both directions: no raw keys, no leftover other-language lines, `<html lang>` follows). Time zone: confirm dialog, cancel keeps the zone, confirm changes it and stores `tzChangedAt`, a second change is blocked by the 30-day lock outside dev mode. Audio: mute switch, sliders disabled while muted, arrows/Home/End change the value. Reset: cancel keeps the save, confirm returns to first run and clears hints. |
| 6a | Keyboard only | Pass with fixes | Whole first run, Start, Pause, Resume, Give up (dialog), nav links are reachable by Tab/Enter/Space/Escape. Focus ring is a visible 3 px volt outline everywhere. Dialogs trap focus (Cancel, Confirm, Close cycle) and return it to the trigger on Escape. Fixed: skip link (Q-02), starter radios without arrow keys (Q-12). |
| 6b | Reduced motion | Pass | With `prefers-reduced-motion: reduce` no element runs a CSS animation or a transition of 0.3 s or more on Home, Session, Box and Detail; throws land instantly on the waves screen. |
| 6c | 390 px | Pass (Low issue) | No page-level horizontal scroll on any screen in ES or EN; bottom bar shows. The team stage on Session and Claim crops the outer sprites (R-06). |
| 7 | Edge cases | Pass with fixes | No balls left, wave with no Study-Ball-eligible target, shiny (guaranteed-ball text + shiny hint), legendary badge, level cap, all-exhausted team, tips off, empty search, first-run empty states. See Q-10 and Q-11. |

## 3. Bugs fixed

| ID | Severity | Bug | Fix |
|---|---|---|---|
| Q-01 | Low | Dev-panel wrench sat on top of page content at the bottom left (it covered the last Box tile, the Home start note...). | The wrench is now `DevToggle`, rendered at the bottom of the side rail (top right below 640 px). `src/ui/dev/DevPanel.tsx`, `src/ui/AppShell.tsx` |
| Q-02 | Medium | The "Ir al contenido" skip link set the URL hash to `#main`; the hash router then fell back to Home, so using it on Box, Team... jumped to Home. | The link now prevents default and focuses `<main tabIndex=-1>`. `src/ui/App.tsx`, `src/ui/AppShell.tsx` |
| Q-03 | Medium | The custom session length field was unusable: every keystroke was clamped, so typing "45" gave 120 and "90" gave 120. | The field keeps a text draft and clamps on blur (`clampMinutes`). `src/ui/screens/home/PreSession.tsx`, `src/ui/lib/format.ts`, test `src/ui/lib/format.test.ts` (4 tests) |
| Q-04 | Low | Mastery stars were at different places in technique cards (right of the chips, or on a second row when the row wrapped; different columns in slots vs the known-moves list). | Every card: name left, stars top right on the name line, chips on their own row. `src/ui/screens/box/Techniques.tsx` |
| Q-05 | Low | Bag item help ("Úsala desde la ficha de un Pokémon") wrapped into 2 or 3 short lines. Truncation could not be reproduced at 768 to 1440 px (it always wrapped), so the copy is shorter and the line uses `overflow-wrap:anywhere`. | `src/i18n/locales/{es,en}.json` (`bag.healHow`), `src/ui/screens/box/Box.tsx` |
| Q-06 | Low | Getting-started checklist had no mission step. | New step "Reclama tu primera misión / Claim your first mission" (7 steps), stored as milestone `mission` when a mission is claimed (the engine drops claimed missions after the day rolls over, so it cannot be derived from the save). `src/ui/screens/home/Checklist.tsx`, `src/ui/store/{game,prefs}.ts`, locales, `docs/ui-foundation.md` |
| Q-07 | Low | Console spam: ~15 to 55 `The AudioContext was not allowed to start` warnings per reload onto Home or Waves (sounds were requested before any user gesture). 457 in this run. | `AudioEngine.playSfx` skips until `navigator.userActivation.hasBeenActive`; test `src/audio/audio.test.ts` ("autoplay policy", fails without the fix). `src/audio/engine.ts` |
| Q-08 | Low | Changing the dev clock rate (or jumping time) mid-session cancelled the scheduled end bells (the delay was computed with the old rate). | `resyncSessionEnd()` re-times the bell when `dev.anchor` changes, or drops it if the end is now past (the watcher then rings). Verified in the browser: bell 1500 s, then 25 s after switching to 1 min = 1 s, no duplicate chime. `src/ui/lib/sound.ts`, `src/ui/SessionWatcher.tsx`, `src/ui/dev/DevPanel.tsx`, test `src/ui/lib/sound.test.ts` (3 tests) |
| Q-09 | Low | The session progress meter exposed raw milliseconds (`aria-valuenow=66181`) to screen readers. | `ProgressBar` accepts `ariaValueText` (and uses a string `valueText`); the session bar reads "4 %". `src/ui/components/ProgressBar.tsx`, `src/ui/screens/home/FocusSession.tsx` |
| Q-10 | Low | With the whole team at 0 Energy, Home warned "podrían agotarse antes del final" (already exhausted, and the warning listed all of them). | Already-exhausted members are no longer in the "may run out" list; when every awake member is exhausted a clear message says the session will not earn points and how to recover. `src/ui/screens/home/PreSession.tsx`, locales (`home.plan.allExhausted`) |
| Q-11 | Low | On the waves screen, Throw was disabled with no visible reason when the selected ball could not be used (Study Ball on a non-eligible wild, or no balls of that type); the reason lived only in a hover tooltip. | The reason is shown under the Throw button. `src/ui/screens/home/Waves.tsx` |
| Q-12 | Low | Starter cards were a radio group without arrow-key support (Tab between each card). | Arrow keys move the selection, roving `tabIndex`. `src/ui/screens/FirstRun.tsx` |
| Q-13 | Low | Known issue: EN screenshots at 1024 px were missing. | Captured (see section 7). |

## 4. Bugs remaining

| ID | Severity | Description | Repro | Suspected cause / suggestion |
|---|---|---|---|---|
| R-01 | Medium | After a reload during a session the end-of-session chime may not play until the user interacts with the page (the Notification and tab title still fire). | Start a session, reload the tab, do not click, wait for the end (use 1 min = 1 s). | Browsers keep a fresh `AudioContext` suspended until a user gesture; the audio-clock bell scheduled at Start is lost on reload and `SessionWatcher` falls back to `chime()`. Chrome may allow it for sites with high media engagement. Suggest a "tap to turn sound on" chip on the session screen when the context is suspended. |
| R-02 | Medium | A session can be started with a fully exhausted team. The engine allows it and it now warns (Q-10), but it does not block or ask for confirmation. | Bring every team member to 0 Energy (several long sessions, or edit the save), press Start. | Design decision to confirm: block, confirm, or allow (a 0-point session still counts minutes and waves). |
| R-03 | Low | **Fixed.** Two tabs: if the session was started in a tab that is not the leader, both tabs made sound at the end (the starter's audio-clock bell and the leader's watcher chime). The Notification was sent once. | Open two tabs, start the session in the second one, let it end. | Fix: the tab that has the bell on a running audio clock holds a Web Lock (`pokefocus-end-bell:<sessionId>`); at the end the leader probes it with `ifAvailable` (`chimeUnlessOtherTabRings` in `src/ui/lib/sound.ts`) and stays silent when another live tab rings. A bell scheduled on a suspended context does not claim, so if only the leader is unlocked it chimes; if only the non-leader is unlocked, that tab rings (it is the only one that can be heard). The lock dies with the tab. Without Web Locks the old behaviour remains. Tests in `src/ui/lib/sound.test.ts`; to confirm in a real browser. |
| R-04 | Low | Counterattack feedback (floating -N, shake) is lost if the page reloads during the throw animation; the Energy loss itself is saved. | Throw a failing ball, reload within 1 s. | Animation state is local to `Waves`; the result is applied to the store first. Acceptable. |
| R-05 | Low | On 390 px the team stage on Session and Claim is centered and crops the outer sprites (3 of 5 visible). | Open Home with a 5-member team at 390 px during a session. | Row is `justify-center` inside an `overflow-hidden` stage; wrap or scale the row below 640 px. |
| R-06 | Low | At 1024 px (icon rail) the trainer card's Dust number (for example "7,750") is a few pixels wider than the card. | Open any screen at 1024 px with 4-digit Dust. | Rail is 5 rem wide; use `text-base` or hide the Dust icon row there. |
| R-07 | Low | Focus is not moved on route change, and after finishing the first-run the focus is on `<body>` (the pressed button unmounted). Hints open without taking focus (Escape closes them). | Keyboard: activate a nav link, or finish first run. | Move focus to `<main>` or the page `<h1>` after navigation and after onboarding. |
| R-08 | Low | When a Study Ball is the selected ball and the player selects a non-eligible wild, the ball stays on the (now disabled) Study Ball; the player must pick another ball. The reason is now shown (Q-11). | Waves screen, select a wild that is not Study-Ball eligible. | Auto-select the first usable ball when the selection becomes unusable. |
| R-09 | Info | The dev wrench is not available on the first-run screen (it lives in the rail). | Open `/?dev` on a fresh save. | Seed and clock can still be set after onboarding. |
| R-10 | Info | The "Shiny" hint docks bottom right over the wave footer buttons until dismissed. | Waves screen with a shiny. | Existing hint docking behaviour. |

## 5. Console errors, warnings and network

All runs were collected (`console.error`, `console.warning`, `pageerror`, `requestfailed`, HTTP >= 400); the raw log is `screens-qa/_console.log`.

- `pageerror`: 0. `console.error`: 0. Failed requests: 0. HTTP 4xx/5xx: 0.
- `The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page.`: 457 before the fix (Q-07), 0 after (checked on the waves reload, which produced 55 before).
- React DevTools notice (info, dev only) was ignored.

## 6. Accessibility findings

Passed: visible focus ring on every control; dialogs (release, cancel session, reset, time zone) trap focus, close with Escape and return focus; meters use `role="meter"` with real values; every icon-only button has a label; reduced motion removes all animations and long transitions; no horizontal scroll at 390 px; `<html lang>` follows the language.

Fixed: skip link broke routing (Q-02); starter radios without arrows (Q-12); session meter spoke milliseconds (Q-09).

Open: R-01 (sound may need a gesture), R-07 (focus after route change and onboarding). Note for test authors: Base UI moves focus back into a dialog one frame after it reaches the focus guard, so a scripted Tab burst without a short delay appears to "escape"; real keyboard use is fine (checked with a 200 ms delay on three dialogs).

## 7. Screenshots

Folder: `/tmp/claude-1000/-home-jorughen-Projects-PokeFocus/44a7d6a2-2530-4ebf-bbe5-1b6d9190c6fd/scratchpad/screens-qa/` (name pattern `<id>-<lang>-<width>.png`).

- Full loop, ES and EN at 1440 and 1024: `t1-01-firstrun` to `t1-09-waves-afterhints`, `t1-10-pre-throw` to `t1-15-after-finish` (1440 ES).
- Persistence: `t2-01` to `t2-08` (paused reload, cancel dialog, claim reload, results reload, waves reload, mid-throw reload, late claim, late results).
- Two tabs: `t3-01-tabA-after-B-start`, `t3-02-tabB-after-claim`. Real time: `t4-session-realtime`.
- Box and Detail: `t5-01` to `t5-05`, `t5-10` to `t5-15`, `t5-20` to `t5-22` (level cap), `t5-30` to `t5-36` (heal, release, evolve).
- Team: `t5-40` to `t5-43`. Pokédex: `t5-50` to `t5-53`. League: `t5-54`, `t5-55`. Missions: `t5-56` to `t5-59`. Settings: `t5-60` to `t5-67`.
- Keyboard: `t6-01-kbd-start-focus`, `t6-02-kbd-cancel-dialog`. 390 px: `t6-home`, `t6-box`, `t6-box-p1`, `t6-team`, `t6-dex`, `t6-league`, `t6-missions`, `t6-settings`, `t6-session` (ES and EN).
- Edge cases: `t7-01` to `t7-05` (shiny, legendary, non-eligible Study Ball, no balls), `t7-10`, `t7-12`, break `t9-01` to `t9-04`.
- Fix verification: `v1-box`, `v1-detail`, `v1-detail-slots` (stars, wrench in the rail).
- Per-screen sweep, with and without the first-visit hint: `s60` to `s67` (home, box, detail, team, dex, league, missions, settings) for EN 1024 (the missing set), ES 1024 and EN 1440.

## 8. How to re-run

The Playwright scripts live in `/tmp/claude-1000/-home-jorughen-Projects-PokeFocus/44a7d6a2-2530-4ebf-bbe5-1b6d9190c6fd/scratchpad/pw/` (`qa-lib.mjs` plus `t1b`..`t10`, `sweep.mjs`); they need the dev server on port 5181 and the veteran seeds `seed-es.json` / `seed-en.json` built with `scratchpad/seed.ts`. Run for example `node t2.mjs es 1440`.
