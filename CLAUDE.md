# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stag is a personal finance planning and retirement simulation web app built with React 19, TypeScript, Vite, and Tailwind CSS. It simulates year-by-year financial projections including income, expenses, taxes, investments, Social Security, pensions, and withdrawal strategies.

## Commands

```bash
npm run dev          # Start development server
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint
npm run test         # Vitest in watch mode
npm run test:ci      # Vitest single run (CI)
npm run test:e2e     # Playwright end-to-end tests
npm run test:e2e:ui  # Playwright with UI
```

Run a single test file:
```bash
npx vitest run src/__tests__/services/WithdrawalStrategies.test.ts
npx playwright test e2e/import-export.spec.ts
```

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
