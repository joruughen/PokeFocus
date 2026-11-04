# PokeFocus pixel art

Every image here is **generated**. Do not edit files in this folder by hand. Edit the char grids in
`scripts/art/` and rebuild:

```sh
npx tsx scripts/art/build.ts
```

Sources: `scripts/art/lib.ts` (sprite model, SVG emitter, PNG encoder), `palette.ts`
(mascot colours), `mascot.ts`, `logo.ts`, `icons.ts`, `build.ts`. In each grid, one char is one pixel,
and `.` means transparent.

SVGs use `shape-rendering="crispEdges"` and an integer `viewBox`, with one `<rect>` per horizontal
run. Always scale them by whole numbers (2×, 3×, …) and add `image-rendering: pixelated` when you
use the PNGs.

## Mascot: Profe Pika (48×48)

| File | Use |
|---|---|
| `mascot-idle.svg` | Default/home, about |
| `mascot-point.svg` | Tooltips, hints, onboarding (points to the left) |
| `mascot-cheer.svg` | Catch / level-up celebration (grad cap + sparkles) |
| `mascot-think.svg` | Loading, "thinking", tips (paw on chin, lens glint) |
| `mascot-sleep.svg` | Empty states, "no energy" (dozing on a book) |

Fixed colours (no theming). They are designed to be shown at 2× (96px) or 3× (144px).

## Logo

| File | Size | Use |
|---|---|---|
| `logo.svg` | 83×16 | Emblem + wordmark, header |
| `logo-wordmark.svg` | 63×10 | Wordmark only |
| `logo-mark.svg` | 32×32 | Emblem (same as `logo-mark-32.svg`) |
| `logo-mark-32.svg` | 32×32 | Emblem, large uses (splash, about) |
| `logo-mark-16.svg` | 16×16 | Emblem, small uses |

The emblem is a Poké Ball whose button is a clock. You can theme it with CSS custom properties:

```css
.header-logo {
  --logo-primary: #e3463b; /* ball top, "Poke" */
  --logo-accent: #2b3566;  /* outline/band/clock hands, "Focus" */
  --logo-paper: #ffffff;   /* ball bottom, clock face */
}
```

The variables only take effect when the SVG is inlined (or used via `<use>`). An `<img>` uses the defaults.

## Favicons

| File | Size | Use |
|---|---|---|
| `favicon.svg` | 16×16 grid | `<link rel="icon" type="image/svg+xml">` |
| `favicon-32.png` | 32×32 | PNG fallback icon |
| `favicon-180.png` | 180×180, opaque | `apple-touch-icon` |

## Icons (12×12, `currentColor`)

The main fill is `currentColor`, so set `color:` to tint an icon. Light/dark shades are translucent
white/black layers over that tint. The outline (`#1c1a24`) and white details are fixed.

| File | Meaning |
|---|---|
| `stat-energy.svg` | Energía (battery + bolt) |
| `stat-pace.svg` | Ritmo (running shoe) |
| `stat-output.svg` | Rendimiento (rising bars) |
| `stat-catch.svg` | Captura (ball + burst) |
| `stat-technique.svg` | Técnica (open book + sparkle) |
| `stat-grit.svg` | Aguante (shield) |
| `icon-study-ball.svg` | Ball de Estudio (ball with grad cap) |
| `icon-dust.svg` | Polvo de Estudio (hourglass + sparkle) |
| `icon-candy.svg` | Caramelo |
| `icon-leader.svg` | Líder (crown) |
| `icon-timer.svg` | Temporizador (stopwatch) |
| `icon-bond.svg` | Vínculo (heart) |
| `icon-shiny.svg` | Variocolor / shiny (sparkle) |
| `icon-sleep.svg` | Status: dormido (Zz) |
| `icon-paralysis.svg` | Status: paralizado (bolt) |

Show them at 12px × an integer scale (24px, 36px).

## PNGs

`png/<name>@4x.png` and `png/<name>@8x.png` exist for every asset above, for OG images,
docs and so on. The icon PNGs are rendered with the sample tints from `ICON_TINTS` in `icons.ts`.

`_contact-sheet.png` shows everything at 4×, plus the mascots at 2× on light and dark surfaces.
