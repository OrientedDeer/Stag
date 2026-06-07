# Theming Plan — making Stag reskinnable (and an Elite Dangerous theme)

## Goal

Make the app **themeable** so visual reskins (e.g. an Elite Dangerous "orange HUD"
cockpit look) become a matter of swapping a small set of variables, not editing
hundreds of components. The Elite theme is the first concrete payoff, but the
real deliverable is a theme *contract* that any future theme can target.

## Current state (the constraint)

- **Tailwind v4** (`@import "tailwindcss"`, `@tailwindcss/vite`). Every color
  utility compiles to a CSS variable: `bg-gray-800` → `background-color: var(--color-gray-800)`.
  This is the lever — overriding/aliasing those variables cascades everywhere.
- **~4,100 hardcoded color-utility occurrences across 105 files.** No theme
  abstraction. Colors encode *palette values*, not *intent*. Top offenders:
  - `text-gray-400` (885), `bg-gray-800` (313), `text-gray-300` (279),
    `border-gray-800` (254), `text-gray-500` (251), `border-gray-700` (251),
    `bg-gray-900` (229)
  - `text-green-400` (164), `text-red-400` (139) — **semantic** (gains/losses)
  - `text-blue-400` (79) and other `blue-*` — the de-facto **primary accent**
- **No custom fonts** (255 `font-mono` usages already — good for a HUD readout look).
- **690+ `rounded-lg`/`rounded-xl`** — Elite's UI is angular, so true fidelity
  fights this. Roundness is a global override when we want it.
- **Nivo charts** keep their own palette in `:root` as `--color-chart-*`
  (`src/index.css` ~line 137+) — separate but contained remap.
- **~30 hardcoded hex values** in CSS (DataSheetGrid `.budget-grid` overrides,
  custom scrollbars) bypass the variable system — small manual cleanup.

## Design decisions (already made)

- **Elite theme = full orange HUD.** Gains/losses/warnings all resolve to amber
  variants rather than green/red. This is the strongest argument for a token layer:
  with semantic tokens, "positive/negative/warning" collapse to amber by editing
  **three variables**, not 300+ class usages.
- **A full heavy reskin is a likely future goal**, not just a recolor. The system
  therefore must carry *more than Tailwind color tokens* — fonts, panel shapes,
  chrome/borders, effects, and potentially different component markup per theme.
  See the three-layer architecture below; a pure utility-class remap is explicitly
  *not* sufficient.

---

## Architecture: three layers (not just Tailwind)

A recolor needs only layer 1. A heavy reskin needs all three. Build toward all
three from the start so we never have to re-plumb.

**Layer 1 — Design tokens (CSS variables).** Color, radius, border-width,
spacing rhythm, shadow/glow, font-family. Drives both Tailwind utilities (via
`@theme`) *and* raw CSS / SVG chrome. Swappable per theme under `[data-theme]`.

**Layer 2 — Theme config object (TypeScript, via a `ThemeProvider` context).**
The "not just Tailwind" part. A typed config per theme for things CSS variables
can't express: active font, chart palette ramps, feature flags (scanlines on/off,
glow intensity), icon set, and **which component variant to render**. Components
read it via a `useTheme()` hook. This is what lets a heavy reskin change
*behavior and structure*, not only colors.

**Layer 3 — Themeable component primitives.** Wrap recurring chrome into a small
set of primitives — `Panel`/`Card`, `Button`, `Alert`, `Modal` frame, `SectionHeader`.
Pages compose primitives instead of hand-rolling `div`s with raw classes. A heavy
reskin then replaces ~10 primitive implementations (e.g. swap a rounded card for
an angular HUD frame rendered with `clip-path` or an SVG border) and the whole app
follows — no page-by-page rework. The primitive can branch on the Layer 2 config
to emit entirely different markup per theme.

**The discipline that makes all this possible:** route styling through (a) semantic
tokens and (b) primitives, and stop scattering raw palette values and bespoke
chrome. The migration below is how we retrofit that discipline onto today's code.

---

## Semantic token layer + runtime theme switch (Layer 1 detail)

### 1. Define the theme contract (semantic tokens)

Reduce the raw palette to intent-based roles. Proposed vocabulary derived from
actual usage:

**Surfaces** (from the gray bg scale)
- `surface-base`     ← bg-gray-950 (app background)
- `surface-raised`   ← bg-gray-900 (cards/panels)
- `surface-overlay`  ← bg-gray-800 (modals, popovers, inputs-on-cards)
- `surface-input`    ← bg-gray-700
- `surface-hover`    ← bg-gray-600

**Text** (from the gray text scale)
- `content-strong`   ← text-gray-50/100/200
- `content-default`  ← text-gray-300
- `content-muted`    ← text-gray-400
- `content-subtle`   ← text-gray-500/600

**Borders**
- `border-subtle`    ← border-gray-800
- `border-default`   ← border-gray-700
- `border-strong`    ← border-gray-600

**Accents / semantic**
- `accent`           ← **solid** blue (`bg-blue-500/600`, `ring-blue-500`) = primary action / focus
- `info`             ← **translucent** blue (`bg-blue-900/xx`, `border-blue-700/xx`, `text-blue-300/400`) = informational
- `positive`         ← green-* (gains)
- `negative`         ← red-* (losses)
- `warning`          ← yellow/amber-*

> **Action-vs-info blue is resolved (audited).** The two uses split cleanly by
> form, so they can be separated mechanically:
> - **Action/accent** is small and contained: `bg-blue-500` (13), `bg-blue-600` (13),
>   `ring-blue-500` (5), a handful of `hover:bg-blue-*` — almost all *solid* fills
>   on buttons/focus. ~50 occurrences.
> - **Info** is the large cohort and matches the documented Info-alert style in
>   CLAUDE.md (`bg-blue-900/20 border border-blue-700/50 ... text-blue-400`):
>   `text-blue-400` (77), `bg-blue-900/*` (~46), `border-blue-700/*` (~35),
>   `text-blue-300` (24), `text-blue-200` (8).
>
> **Rule for the codemod: solid blue → `accent`, translucent/`text-blue-*` → `info`.**
> Keeping these as distinct tokens *in the default skin* is the concrete first
> instance of the discipline above — it's what makes the eventual reskin (where
> `accent` becomes ED amber but `info` may stay cyan) a variable swap instead of a
> manual re-audit. `Testing.tsx` (46 blue uses) is the heaviest file; expect most
> ambiguity there.

### 2. Register tokens in `@theme`

In `src/index.css`, add an `@theme` block so Tailwind emits utilities
(`bg-surface-base`, `text-content-muted`, `text-positive`, `border-default`, …):

```css
@theme {
  --color-surface-base:   var(--c-surface-base);
  --color-surface-raised: var(--c-surface-raised);
  --color-content-muted:  var(--c-content-muted);
  --color-accent:         var(--c-accent);
  --color-positive:       var(--c-positive);
  --color-negative:       var(--c-negative);
  /* ...etc... each points at a runtime-swappable --c-* variable */
}
```

The `--color-*` names are the stable Tailwind contract; the `--c-*` values are
what each theme overrides.

### 3. Theme definitions via `data-theme`

Each theme is just a block assigning the `--c-*` variables. Switch at runtime by
setting `document.documentElement.dataset.theme`.

```css
:root, [data-theme="default"] {
  --c-surface-base:   #030712; /* current look = baseline */
  --c-accent:         #60a5fa; /* blue-400 */
  --c-positive:       #4ade80; /* green-400 */
  --c-negative:       #f87171; /* red-400 */
  /* ... */
}

[data-theme="elite"] {
  --c-surface-base:   #0a0a0a;
  --c-accent:         #ff7100; /* ED amber */
  --c-positive:       #ffb000; /* full orange HUD: amber */
  --c-negative:       #ff5000; /* amber-red, still distinguishable */
  --c-warning:        #ffd000;
  --c-content-muted:  #b87333; /* amber-tinted gray */
  /* ... */
}
```

### 4. Migration (the bulk of the work)

Replace raw color utilities with semantic ones. The top ~20 classes cover the
large majority of the 4,100 occurrences, so most of this is a scripted codemod
with a curated mapping, plus review:

- `text-gray-400` → `text-content-muted`
- `bg-gray-800`   → `bg-surface-overlay`
- `bg-gray-900`   → `bg-surface-raised`
- `border-gray-800` → `border-border-subtle`
- `text-green-400` → `text-positive`, `text-red-400` → `text-negative`
- `*-blue-*` (accent contexts) → `*-accent`
- …

Caveats requiring human judgment, not blind sed:
- `blue-*` action vs info — **resolved** by the solid-vs-translucent rule above;
  the codemod can apply it automatically, with a review pass on `Testing.tsx`.
- `green-*`/`red-*` are *occasionally* decorative, not gain/loss — check.
- Hover/active variants (`hover:bg-gray-700`) need matching hover tokens.

Where a component is being touched anyway, prefer migrating it to a **Layer 3
primitive** rather than just swapping its classes — that way the migration also
buys reskin-readiness instead of only recoloring.

### 5. Charts + hardcoded hex

- Map `--color-chart-*` (Nivo) into the per-theme blocks so chart series recolor
  with the theme. Elite: shift to amber/cyan/dim-orange ramps.
- Convert the `.budget-grid` and scrollbar hex literals to `var(--c-*)`.

### 6. Theme switcher

A small dropdown (reuse `DropdownInput`) in settings that sets `data-theme` and
persists to localStorage. Cheap once the token layer exists; enables shipping the
default look untouched while the Elite theme is opt-in.

---

## Elite Dangerous specific layer (after the token system)

These are on top of the palette and are where "themeable" ends and "per-theme
custom CSS" begins:

- **Font:** add a sci-fi face (Orbitron / Chakra Petch / Jura) via `@font-face`,
  applied only under `[data-theme="elite"]`. Lean on existing `font-mono` for readouts.
- **Glow:** amber `text-shadow`/`box-shadow` on accents and borders.
- **Angularity:** under `[data-theme="elite"]`, neutralize `rounded-*`
  (border-radius: 0 or small) and optionally `clip-path` beveled corners on panels.
- **Texture:** optional scanline / vignette overlay, hex motif accents.

---

## Phasing

- **Phase 0 — instant ED preview (throwaway, ~1–2 hrs).** Skip tokens; just
  override Tailwind's `--color-gray-*` / `--color-blue-*` in a single block to
  validate the vibe live. Disposable, but proves the look before investing.
- **Phase 1 — Layer 1 tokens + default-theme migration (the real work, ~1–2 days).**
  Steps 1–5. App looks identical afterward but is now driven by semantic tokens,
  including the action/info split.
- **Phase 1.5 — Layers 2 & 3 scaffolding (~1 day).** Add `ThemeProvider`/`useTheme`
  and extract the core primitives (`Panel`, `Button`, `Alert`, `Modal`,
  `SectionHeader`). Migrate the highest-traffic chrome to them. This is the
  investment that makes a *heavy* reskin tractable; skippable if we only ever want
  recolors, required if we want the full HUD.
- **Phase 2 — Elite theme + switcher + font (~half day).** Step 3's `elite` block,
  step 6 switcher, ED font wired through Layer 2 config.
- **Phase 3 — HUD polish (open-ended).** Glow, angular panel primitives, scanlines,
  hex motifs — most of which now live in Layer 3 primitives + Layer 2 flags.

## Risk / effort summary

- **Low risk:** Phase 0 (revert = delete one block), Phase 2/3 (scoped under
  `[data-theme="elite"]`, default theme untouched).
- **Medium risk / most effort:** Phase 1 migration — broad but mechanical;
  mitigated by codemod + the default theme keeping current values so any missed
  spot still renders correctly (just not yet theme-aware).
- Lint is broadly red & unenforced in this repo, but fix lint in touched files.
- Test cadence: small UI tweaks skip the suite; run it after the Phase 1 migration.
