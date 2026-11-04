# PokeFocus UX and tech research (as of 2026-11-03)

"[verified]" means I checked it directly (HTTP headers, npm registry, GitHub API, font files). Other claims are cited.

## 1. Self-teaching onboarding: patterns in priority order

1. **No tutorial before the first session.** Show a ready screen with a pre-filled starter team, ask at most language and name, then "Start 25 min". NN/g says avoid onboarding where possible, prefer in-context tips, and keep any instruction "brief, optional" with a visible Skip ([NN/g](https://www.nngroup.com/articles/mobile-app-onboarding/)). Forest puts the core action first ([Boxes & Arrows](https://boxesandarrows.com/how-to-use-gamification-in-mobile-apps-a-case-study)). Don't copy Pokémon Sleep: its first session is a long, menu-heavy tutorial ([Nintendo Life](https://www.nintendolife.com/features/hands-on-pokemon-sleep-open-beta-an-absolute-snoozefest)).
2. **A hint engine, not a tour.** Each mechanic gets a hint `id`, a trigger event ("first wave", "first catch", "first empty technique slot") and a persisted `seen` flag. Roblox's guidance: contextual tutorials are "triggered by normal play", and non-essential info waits for later sessions ([Roblox](https://create.roblox.com/docs/production/game-design/onboarding-techniques)). **Never show hints during the focus countdown.** Queue them for the break and wave screens.
3. **The first wave is the tutorial.** Script it: 3 weak Pokémon, a free ball, one pulsing highlight on the throw button. This mirrors Red/Blue's old man demonstrating a catch ([Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Old_man_(Kanto))). Learning by doing beats explaining (NN/g, above).
4. **Unlock ladder tied to progress, not time.** Habitica holds the class system until level 10 "to avoid new users having too many features" ([wiki](https://habitica.fandom.com/wiki/Class_System)). Pokémon GO gates gyms and raids at level 5 and trading at 10 ([Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Trainer_level)). Suggested ladder:
   - Session 1: timer and team.
   - First finished session: waves.
   - First catch: box.
   - 3 catches: technique slot 1, then slots 2–4.
   - Later: type and time conditions, then leagues and leaderboards.

   Show locked areas as dimmed silhouettes with the unlock condition. Don't hide them.
5. **Empty states teach.** NN/g's rules: explain what the area is, how to fill it, and give a button ([NN/g](https://www.nngroup.com/articles/empty-state-interface-design/)). Box: "Catch your first Pokémon in the next wave". Empty technique slots: ghost "+" slots. Leaderboard: "Finish 1 session to join".
6. **Explain outcomes inline.** After each wave or score, add a one-line "why" ("Ghost +20% (night)"). Add hover help on type chips; CHI 2012 found hover help among the most effective contextual help ([Andersen et al.](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf)).
7. **Anti-fatigue rules.**
   - Use non-blocking beacons, one at a time, at most 2 per session. Add a "Disable tips" toggle and "Replay tips" in settings.
   - Cap sequences at 4 steps, with a progress indicator.
   - Prefer self-triggered over auto-triggered help. Chameleon (vendor data) reports 61% average tour completion, +123% when self-triggered and +21% when checklist-triggered ([Chameleon](https://www.chameleon.io/blog/product-tour-benchmarks-highlights)). So add a small "Getting started" checklist.
8. **i18n.** Keep hint text per `id` in the ES/EN dictionaries. Spanish runs longer, so give bubbles slack.

## 2. Hint/coach-mark library

- **react-joyride 3.2.0:** MIT, released 2026-07-09. Peer react 16.8–19. Its v3 rewrite added a `useJoyride` hook and Floating UI ([release](https://github.com/gilbarbara/react-joyride/releases/tag/v3.0.0)). It has 10 runtime deps and 720 KB unpacked [verified]. It works on React 19 but is tour-oriented and heavy.
- **driver.js 1.10.2:** MIT, released 2026-10-18, zero deps. Hints (pulsing beacons) arrived in 1.8.0 (Jul 2026, ~5 KB gzip) and checklists in 1.10.0 ([releases](https://github.com/nilbuild/driver.js/releases), [hints docs](https://driverjs.com/docs/hints)). It is the best off-the-shelf fallback, but both APIs are months old. Popovers are non-React DOM (strings only), targets are CSS selectors, and dismissal persistence is DIY.
- **Shepherd 15.3.0:** AGPL-3.0 on npm [verified]. Avoid.
- **Onborda 1.2.5:** Next.js-oriented; last release 2024-12-22 [verified]. Avoid.

**Recommendation: a custom component, about 150 lines.**
- State: a zustand `persist` store with `hints: Record<id, 'seen'|'dismissed'>` and `tipsEnabled`.
- API: `useHint(id, {when})` and `<Hint id anchorRef side>`.
- Positioning: [`@floating-ui/react-dom`](https://registry.npmjs.org/@floating-ui/react-dom/latest) 2.1.9 (peer react >=16.8, 62 KB unpacked).
- Why custom: our triggers are store events, not DOM tours, and text must come from i18n and use pixel tokens.
- Zero-dep alternative: `popover="manual"` ([Baseline 2025](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API)) plus CSS anchor positioning. Reported support: Chrome 125, Safari 26, Firefox 147 ([summary](https://www.refontelearning.com/blog/css-anchor-positioning-reaches-baseline)).
- If time is short, use driver.js hints and store dismissed IDs in zustand via `onDismiss`.

## 3. Reliable pomodoro timer

Facts:
- Hidden tabs get 1 s timer wake-ups. After 5+ minutes hidden, with chained timers and no audio, Chrome drops to 1 per minute. A silent audio track doesn't exempt a page ([Chrome](https://developer.chrome.com/blog/timer-throttling-in-chrome-88), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)).
- `requestAnimationFrame` pauses in hidden tabs ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)).
- Memory Saver can discard inactive tabs ([Google](https://blog.google/products/chrome/new-chrome-features-to-save-battery-and-make-browsing-smoother/)).

Implementation:
- **Timestamps are the source of truth.** Persist `endsAt = Date.now() + ms` and compute remaining as `endsAt - Date.now()`. Never decrement a counter. This survives throttling, reloads, tab discards and laptop sleep.
- **Render tick:** a 250–500 ms `setInterval` while visible, plus an immediate recompute on `visibilitychange`.
- **Wake-up helper:** a dedicated Worker (`new Worker(new URL('./timer.worker.ts', import.meta.url), {type:'module'})`) posting 1 Hz ticks and a one-shot timeout to `endsAt`. Worker timers are widely reported to escape the main-thread clamp, but I found no primary doc guaranteeing it, and a 2018 blink-dev intent proposed throttling background workers ([thread](https://groups.google.com/a/chromium.org/d/topic/blink-dev/8xpEA-iNHwg)). Treat it as best-effort.
- **Completion is idempotent.** Guard with a persisted `completedAt`, so a block awards points and spawns a wave exactly once, even when catching up on return.
- **Notifications:** request permission on the first "Start" click with a one-line explanation ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static); Safari requires a gesture per [Apple](https://developer.apple.com/videos/play/wwdc2022/10098/)). Use `tag`, never re-prompt after `denied`, and fall back to a `document.title` change plus a chime.
- **Audio:** create or `resume()` the `AudioContext` inside the Start click ([autoplay policy](https://developer.chrome.com/blog/autoplay)).
- **Multiple tabs:** Web Locks leader election so only one tab notifies and awards ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)).
- **Wake Lock:** low value on desktop, and released whenever the tab is hidden ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)). Skip it for the MVP.

## 4. Pixel-art UI direction

**Fonts.** All are on Google Fonts, and the font files contain ÁÉÍÓÚÑÜáéíóúñü¡¿ [verified].
- **Press Start 2P** is the cliché. It is wide, single-weight, and designed for multiples of 8 px ([description](https://raw.githubusercontent.com/google/fonts/main/ofl/pressstart2p/DESCRIPTION.en_us.html)). Use it at most for a logo or big numerals.
- **Pixelify Sans** (400–700) is the best pixel font for headings, buttons and labels. Keep it at 16 px or larger.
- **Silkscreen** suits tiny type chips and badges.
- **Less cliché:** Jersey 10/15 (scoreboard-style timers and leaderboards), Tiny5, and Geist Pixel (added to Google Fonts Jun 2026, display only, [Vercel](https://vercel.com/blog/introducing-geist-pixel)). VT323 works for terminal-style digits at 20 px or larger.
- **Body text must not be pixel.** Use Atkinson Hyperlegible Next or Figtree (both have latin-ext) instead of the default Inter.
- Self-host with `@fontsource/*`. Use at most 2 pixel families, only for titles, buttons and numbers.

**Sprites.**
- Scale by integers only: `width: calc(var(--w) * 3px)` with `image-rendering: pixelated`. `pixelated` is nearest-neighbour to the nearest integer multiple, then smooths ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering)).
- Avoid fractional `transform: scale()`.
- Put each sprite in a fixed, bottom-anchored stage with `object-fit: contain`. Showdown GIFs range from 60×60 to 148×126 [verified].

**Blending with a clean UI.**
- Pixel art is content, not chrome.
- Use flat surfaces, 2 px borders and hard shadows like `0 2px 0 var(--edge)`.
- Keep spacing on a 4 px grid, with one accent per type.
- Use 9-slice `border-image` only on hero panels.
- Don't mix anti-aliased icon packs with pixel icons.

## 5. Sprite pitfalls (PokeAPI/sprites)

- **Don't hotlink raw GitHub.** `raw.githubusercontent.com` sends `access-control-allow-origin: *` but `cache-control: max-age=300` [verified]. The repo is about 27 GB, so never clone it [verified]. PokeAPI asks to "locally cache resources" ([docs](https://pokeapi.co/docs/v2)).
  - **Fix:** a build script that downloads only the needed files into `public/sprites/`. Alternatively use jsDelivr pinned to a commit SHA (CORS `*`, 7-day cache) [verified].
- **Coverage holes.**
  - `other/showdown/<id>.gif` is missing 14 IDs in 1–1025: 990–995, 1006, 1008, 1010, 1017, 1022–1025 [verified].
  - Showdown's name-based `ani/` URLs also 404 for several of these (ironbundle, miraidon, ogerpon, pecharunt, terapagos) [verified].
  - Run a manifest check at build time, drop those species from wave pools, or fall back to `official-artwork`.
- **Pixel icons for the box.** `versions/generation-vii/icons/<id>.png` are 40×30 and ~264 B, covering 1–809 [verified]. Gen 8 icons are 68×68 and stop at 898. Gen 9 `scarlet-violet/icons` are 119×131 RGBA renders (11–17 KB), not pixel icons [verified]. Restrict the box to Gen 1–7 for consistency, or evaluate Showdown's 392 KB `pokemonicons-sheet.png` (needs an index map; I did not verify one).
- **GIF weight.** Pikachu 26 KB, Mewtwo 130 KB, Wailord 235 KB, Eternatus 394 KB [verified]. A wave of 8 can reach 1–2 MB. Preload the next wave during the focus block. Under `prefers-reduced-motion`, swap in the static PNG.
- **CORS and canvas.** `play.pokemonshowdown.com` returned no `Access-Control-Allow-Origin` [verified], so a canvas drawing its GIFs would be tainted. A canvas shows only frame 0 of a GIF anyway, so use `<img>`.
- **Data and i18n.** PokeAPI has Spanish names (`names[lang=es]`: "Fantasma", "Bola Sombra") [verified]. Snapshot species, type and move data at build time instead of calling it at runtime.
- **IP.** The sprites repo has no clear license (GitHub reports NOASSERTION), and Gen V+ sprites are Smogon community work. Keep the app private and non-commercial, and add a "not affiliated with Nintendo/Game Freak/The Pokémon Company" footer. I could not load The Pokémon Company's fan-content policy, so review it before sharing publicly.
