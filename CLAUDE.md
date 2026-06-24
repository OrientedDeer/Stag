# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stag is a personal finance planning and retirement simulation web app built with React 19, TypeScript, Vite, and Tailwind CSS. It simulates year-by-year financial projections including income, expenses, taxes, investments, Social Security, pensions, and withdrawal strategies.

## Commands

```bash
npm run dev          # Start development server
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint
npm run typecheck    # tsc -b only (incremental; ~0.3s no-op, seconds after an edit)
npm run test         # Vitest in watch mode
npm run test:ci      # Vitest single run, full suite (~250s) — pre-commit / CI only
npm run test:changed # Vitest run, only files affected by the current git diff
npm run test:e2e     # Playwright end-to-end tests
npm run test:e2e:ui  # Playwright with UI
```

Run a single test file:
```bash
npx vitest run src/__tests__/services/WithdrawalStrategies.test.ts
npx playwright test e2e/import-export.spec.ts
```

> **Don't run the full suite (~230s) after every edit.** During iteration, run
> `npm run typecheck` (~0.3s) plus the specific test file(s) you touched, and reserve
> `npm run test:ci` for the final pre-commit gate. See
> [Running tests efficiently](#running-tests-efficiently) under Testing Guidelines.

## Architecture

### State Management (React Context)

All app state is managed through Context providers in `App.tsx`. Each domain has its own context with a reducer pattern and localStorage persistence:

- **AccountContext** - Savings, investments, property, debt accounts
- **IncomeContext** - Work income, Social Security, pensions, passive income
- **ExpenseContext** - Housing, food, loans, discretionary expenses
- **TaxContext** - Filing status, state residency, tax overrides
- **AssumptionsContext** - Inflation, growth rates, retirement age, withdrawal strategy
- **SimulationContext** - Cached year-by-year simulation results
- **MonteCarloContext** - Monte Carlo simulation results with percentile bands
- **ScenarioContext** - Side-by-side scenario comparisons
- **ImportKeyContext** - Forces chart remounts after data import

### Domain Models

Each domain (Accounts, Income, Expenses) has typed class hierarchies in `models.tsx`:

- Classes have methods like `increment()` for year-over-year growth and `getAnnualAmount()`
- `reconstitute*()` functions convert JSON back to class instances (needed for localStorage hydration)
- Classes are serialized with `className` field for reconstitution

### Simulation Engine

`src/components/Objects/Assumptions/SimulationEngine.tsx` is the core engine that:
- Projects finances year-by-year from current age to life expectancy
- Handles income growth, expense inflation, account contributions
- Calculates federal/state/FICA taxes using `TaxService`
- Applies withdrawal strategies (Fixed Real, Guardrails, etc.)
- Computes RMDs, Roth conversions, Social Security claiming
- Tracks FERS/CSRS federal pensions with COLA

### Charts

Nivo charts (`@nivo/sankey`, `@nivo/line`, `@nivo/stream`, etc.) are used throughout. Charts depend on referential equality - use `key` props with `importKey` from context to force remounts after data imports.

### QR Code Import/Export

`src/components/Objects/Accounts/QRTransfer/qrUtils.ts` compresses backup data to fit in QR codes:
- Shortens keys (`startDate` → `s`)
- Strips default values
- Converts dates to ISO strings (important: Date objects must be handled specially in `shortenKeys`)
- Uses pako for zlib compression

## Terminology

- **Checkbox/checkbox**: Use the styled `ToggleInput` component, not native HTML checkbox

## Code Style

- **No console.log**: Remove debug logs before committing
- **Styled inputs**: Use components from `src/components/Layout/InputFields/` (ToggleInput, DropdownInput, CurrencyInput, NumberInput, NameInput)

## Output Formatting

- **No markdown tables**: Don't use markdown table syntax (`|`, `---`) when presenting data. Use simple `name: value` lists instead — they're easier to copy/paste and read in a terminal.

## Alert/Message Styles

- **Use `AlertBanner`** (`src/components/Layout/AlertBanner.tsx`) for alert/notice boxes: `<AlertBanner severity="info|warning|error|success" size="default|sm" title="…">…</AlertBanner>`. It carries the icon, padding, and themeable colors.
- **Don't hand-roll alerts with raw Tailwind color classes** (`bg-blue-900/20`, `text-yellow-300`, etc.). The raw palette is not reskinned by the theme system, so those colors leak through (e.g. literal blue/yellow under the Elite theme).
- When a banner doesn't fit the structure, use the **semantic tokens** directly: `bg-info-tint` / `border-info-strong` / `text-info` / `text-info-bright`, and the `warning-*`, `negative-*` (error), `positive-*` (success) equivalents. These resolve to `var(--c-*)` and follow the active theme.

## Debugging the Simulation Engine

- **Use `logs.push()` instead of `console.log`**: Every `SimulationYear` has a `logs: string[]` array that flows through the simulation engine. Add debug messages via `logs.push(...)` — they are viewable per-year in the Testing tab's year inspector under "Simulation Logs".
- **Prefix debug logs with `[DEBUG]`**: Use a prefix like `[DEBUG section]` so they're easy to spot and clean up later (e.g., `logs.push(\`[DEBUG growAccounts] balance=$\${amount}\`)`).
- **Remove debug logs before committing**: Debug logs are temporary — remove them once the issue is resolved.
- **Key files that carry `logs`**: The `logs` array is passed through `SimulationEngine.tsx`, `AccountGrowth.ts`, `RothConversionService.ts`, `WithdrawalPlanner.ts`, and other simulation services. Most functions already accept a `logs` parameter.

## Testing Guidelines

- **Investigate failures before loosening tests**: When a test fails, first investigate whether the failure indicates a real bug in the code. Do NOT immediately loosen test assertions or tolerances to make tests pass. Read the relevant source code to understand the intended behavior before deciding whether the test expectation or the code is wrong.
- **Ask user before relaxing test constraints**: If after investigation you believe a test threshold or assertion needs to be relaxed (e.g., increasing a tolerance, raising a growth rate limit, loosening a boundary check), STOP and ask the user for approval before making the change. Explain what the test is checking, why it's failing, and why you believe relaxing it is appropriate.

### Running tests efficiently

The full suite is ~230s (244 files, 4200+ tests). Do **not** run it after every edit —
that's the main source of wasted waiting. The fast loop, in order of preference:

1. **`npm run typecheck` after almost every edit.** `tsc -b` is incremental: ~0.3s for a
   no-op, a few seconds after a real change (it re-checks only the edited file + its
   dependents). This catches type breakage across the *entire* project without running a
   single test, so it's the cheapest, broadest safety net you have. Run it liberally.
   - Why `tsc -b` and not `tsc --noEmit`: the root `tsconfig.json` has `files: []`, so a
     plain `tsc`/`tsc --noEmit` checks nothing. `tsc -b` walks the project references.
   - The configs carry `incremental: true` *specifically* so this stays fast. Don't remove
     it: with `noEmit: true`, build mode otherwise looks for `.js` output files that never
     exist, decides the project is "out of date," and re-type-checks everything every run
     (~26s instead of ~0.3s). The `.tsbuildinfo` files (gitignored) are the cache.
2. **Run the specific test file(s) for what you touched:** `npx vitest run <path/to/X.test.ts>`
   (~1–2s each). This is the single biggest time lever for behavioral verification.
3. **`npx vitest related <src-file…>`** — runs every test importing the given source file,
   useful after editing a leaf module whose test files you don't know.
4. **`npm run test:changed`** (`vitest run --changed`) — tests affected by the uncommitted
   diff. Honest caveat: the core modules (`SimulationEngine`, the `Accounts`/`Expense`/
   `Income` `models.tsx`, `TaxService`, the Monte Carlo worker) are imported transitively by
   ~70% of the suite, so editing one of those makes `--changed`/`related` pull in most tests
   anyway. For core-engine edits, lean on targeted files + `typecheck` during iteration.
5. **`npm run test:ci`** (full suite) — reserve for the final pre-commit/pre-push gate.

**Don't try to "speed up" the full suite by changing the vitest pool/isolation** — this was
measured (2026-06-24):
- `isolate: false` → **104 failures** from cross-file jsdom DOM contamination (components stay
  mounted in a shared `document`). The component tests depend on a fresh DOM per file.
- `pool: 'threads'` → **no speedup** (~234s vs ~230s) and introduced a flaky failure.

The ~230s is genuine parallel work (CPU-bound test execution + the per-file jsdom
`environment` init that isolation requires), not config overhead. `forks` + `isolate: true`
(the vitest defaults, left unset in `vite.config.ts`) are correct. The real lever is running
fewer files per iteration, not reconfiguring the runner.
