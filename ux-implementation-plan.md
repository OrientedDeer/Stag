# UX implementation plan — agent work packages

Companion to `ux-design-notes.md` (the "why"). This is the "how": seven
self-contained work packages (P1–P7), each written as a brief a sub-agent can
execute without further design input. Wave/conflict map at the bottom.

## Ground rules (every agent, read first)

- Repo conventions are in `CLAUDE.md`. Highlights that bite: styled inputs
  only (ToggleInput/DropdownInput/CurrencyInput/NumberInput/NameInput), no
  console.log (sim debugging uses `logs.push`), alert styles (info
  `bg-blue-900/20 border-blue-700/50 text-blue-400`, warning
  `bg-yellow-900/30 border-yellow-700/50 text-yellow-300`).
- Typecheck: `node_modules/.bin/tsc -b` (NOT `tsc --noEmit` — it's a no-op).
  Tests: `node_modules/.bin/vitest run [path]`. Run the FULL suite before
  declaring done; fix lint in files you touch (repo lint is broadly red —
  your files still must not add errors).
- Dates are LOCAL, decided 2026-06 (campaign 7, PR #57): date-only values are
  created `new Date(y, m-1, d)` and read with local accessors. Never
  `toISOString()` / `new Date('YYYY-MM-DD')` for date-only. Use
  `formatDateForInput` / `parseDate`.
- Goal funding is COMMITTED and DERIVED (no buckets, no stored set-aside,
  `endDate` IS the target). Don't reintroduce stored copies. Helpers:
  `getGoalMonthlySetAside`, `getGoalFundAnnualSetAside` in
  `Expense/models.tsx`.
- Behavioral changes land test-first (red before the fix/feature assertion
  where feasible). New UI gets at least a render + interaction test.
- Each agent commits ONLY its own package's files (parallel agents share the
  repo — do not bundle foreign hunks). Commit directly to main, small
  commits, descriptive subjects.

---

## P1 — ReceiptToast infrastructure + account-creation receipts

**Goal:** a single reusable toast that tells the user when an action created
or changed something in another tab, with an optional link.

**Build:**
- `src/components/Layout/Overlays/ReceiptToast.tsx` + a
  `ReceiptToastProvider`/`useReceiptToast()` (context with
  `show({ message, linkTo?, linkLabel?, tone? })`). Render once near the app
  root (`App.tsx`, alongside GlobalKeyboardShortcuts). Info-blue styling per
  CLAUDE.md; auto-dismiss ~8s + manual dismiss; stack max 3; `linkTo` uses
  react-router `Link`.
- Wire TWO emitters in `src/components/Objects/Accounts/AddAccountModal.tsx`
  (~lines 131–152):
  - Financed PropertyAccount → auto-created MortgageExpense: message MUST
    surface the invented defaults: "Created mortgage expense (assumed 6.23%
    APR, 30 yr) — review it under Current → Expenses", linkTo
    `/current/expense`.
  - DebtAccount → auto-created LoanExpense: "Created loan expense '<name>'
    under Current → Expenses", same link.

**Do NOT** wire the goal receipt here (P3 owns AddExpenseModal — avoid the
file conflict).

**Tests:** provider render/dismiss/stacking unit test; AddAccountModal test
asserting the toast fires with the right copy for both account types.

**Acceptance:** creating a financed property or debt account visibly
announces the spawned expense; nothing else regresses (`vitest run` green).

---

## P2 — Pre-delete impact summaries (milestones, accounts)

**Goal:** destructive actions that mutate OTHER objects warn BEFORE, listing
exactly what's affected.

**Build:**
- Milestone delete (`src/components/Objects/Assumptions/MilestoneModal.tsx:93`,
  `REMOVE_MILESTONE`): before dispatch, scan incomes + expenses for
  `startMilestoneId/endMilestoneId === id`. If referenced, show a confirm
  (reuse `src/components/Layout/ConfirmDialog.tsx`) with a warning-yellow
  block: "N expenses and M incomes use this milestone as a trigger; they
  will reset to End of Plan: <names>". Unreferenced milestones delete
  without friction. (Context: TriggerSelector silently resets dangling
  references — `TriggerSelector.tsx:66-70`. Keep that fallback; this change
  makes it informed.)
- Account delete (`src/components/Objects/Accounts/DeleteAccountUI.tsx`):
  extend the existing confirm to list dangling references that will remain:
  scan `assumptions.priorities[].accountId`,
  `assumptions.withdrawalStrategy[].accountId`, and WorkIncome
  `matchAccountId`/`esppAccountId`. Offer cleanup: deleting the account also
  removes its priority buckets and withdrawal-order entries (dispatches
  exist: `REMOVE_PRIORITY`, `SET_WITHDRAWAL_STRATEGY`) and a yellow note for
  payroll routings (those need user reassignment, don't auto-clear).

**Tests:** reducer-level test for the cleanup dispatches; component tests for
both dialogs listing referenced objects by name.

**Acceptance:** deleting a referenced milestone/account is impossible to do
unknowingly; deleting an unreferenced one is no harder than today.

---

## P3 — Goal plan preview + goal receipt (AddExpenseModal)

**Goal:** the goal-mode modal shows the consequences before Create, and a
receipt after.

**Build (all in `src/components/Objects/Expense/AddExpenseModal.tsx`):**
- Live preview line (info-blue block) in goal mode, derived per keystroke
  from existing helpers — construct a throwaway expense or compute directly:
  targetDate: "Sets aside **$X/mo** (<start MMM yyyy> → <target MMM yyyy>)
  into a new '<name> (fund)' account. The $<total> is spent at the target
  date." recurring: "Sets aside $X/mo, replacing every N years." Months math
  must match `getGoalMonthlySetAside` exactly (derive from it, don't
  reimplement).
- Handle the degenerate case: target ≤ 1 month out → show the lump warning
  ("target is this month — the full $<total> is due immediately").
- On create, fire `useReceiptToast()` (from P1): "Created '<name> (fund)'
  account — visible under Current → Accounts", linkTo `/current/accounts`.

**Depends on P1 (the hook). Same-file conflict: do not run concurrently with
anything else touching AddExpenseModal.**

**Tests:** preview text for a known case (e.g. $10,000, 18 months → $556/mo);
updates when amount/target change; receipt fired on create.

---

## P4 — Budget pacing "why" + monthly-figure labels

**Goal:** every pacing judgment and monthly figure explains its arithmetic.

**Build:**
- `src/tabs/Budget/SpendingTab.tsx`: contribution rows get a tooltip/expando
  (existing `Tooltip` component) showing the formula with numbers:
  "expected $1,950 by Jun = $278/mo × 7 active months (funding starts Jun)".
  Source values already exist in the row computation (`annualTarget`,
  `monthlyTarget`, `monthsActive`, `startMonth`, `plannedMonths`). Same for
  pacing status: one line on why it's waiting/on-track/behind ("behind =
  even 2× monthly for the remaining N months can't reach the target").
- Label the intentionally-different monthly figures (do NOT unify the math —
  it's deliberate, see memory/monthly-expense semantics):
  Dashboard's figure → "avg/mo this year"; SpendingTab/PriorityTab figures →
  "this month". Find each render site and add the suffix/subtitle.

**Tests:** tooltip content for a mid-year-start goal row; label presence.

**Acceptance:** a user can answer "why does it say behind?" without leaving
the row.

---

## P5 — Hide debug surfaces

**Goal:** self-diagnostics out of the default UI.

**Build:**
- Add `display.showDevTools: boolean` (default false) to
  `AssumptionsState.display` (`AssumptionsContext.tsx:150` — follow the
  existing `showExperimentalFeatures` pattern incl. merge defaults at :264).
  Toggle UI wherever display settings render today (find
  `useCompactCurrency`'s toggle and sit next to it).
- Gate the Testing tab: hide its Sidebar entry
  (`src/components/Layout/Overlays/Sidebar.tsx`) and keep the route working
  when the flag is on (keyboard nav list in
  `GlobalKeyboardShortcuts.tsx:11-22` should skip it when hidden).
- Sankey imbalance banner (`src/tabs/Future/tabs/CashflowTabs.tsx:42,167` and
  any sibling usage — grep `onBalanceCheck`): render only when
  `showDevTools`. The balance check itself still runs (cheap, and Testing
  uses it).

**Tests:** sidebar excludes/includes Testing per flag; banner hidden by
default, shown with flag.

---

## P6 — Theme/chart color contract test

**Goal:** no theme or token change can silently produce black/invalid chart
colors again.

**Build:** one test file, e.g.
`src/__tests__/Components/Charts/themeColorContract.test.ts`:
- Parse `src/index.css` for every theme block (`:root`,
  `[data-theme="..."]`) and extract `--color-chart-*`, `--c-cat-*`,
  `--c-warning*`/`--c-negative*`/`--c-positive*` token values.
- For each, assert `resolveColor` (`src/components/Charts/chartColors.ts`)
  returns a parseable rgb/hex (d3-color `color()` !== null is the exact
  production constraint — use it as the oracle).
- Assert every token defined in `:root` is also defined (or inherited
  cleanly) in each named theme, so a theme can't partially override a
  palette.

**No production code changes expected** (pure test) — unless it finds a bad
token, in which case fix the token, not the test.

---

## P7 — Future IA split + naming (do LAST, after P5)

**Goal:** separate plan inputs from projection outputs; fix naming drift.

**Build:**
- Sidebar (`Sidebar.tsx`) + routes (`App.tsx:60-73`) regrouped:
  Plan = Assumptions, Allocation, Withdrawal. Projection = the current
  /future/charts subtabs. Keep old routes as redirects (bookmarks/muscle
  memory; `GlobalKeyboardShortcuts.tsx` route list updated to match).
- Naming: one term — "Allocation" — across sidebar, page heading (currently
  "Your Priorities" in PriorityTab), and any body copy. Component/file names
  can stay (rename is churn without user value).
- Within Projection, group the nine subtabs: Overview / Cashflow / Assets /
  Debt / Data stay top-level; Monte Carlo + (Historical Backtest panel) under
  "Risk"; Tax + Scenarios under "Strategy"; Ratios folds into Overview or
  stays under Data — implementer's call, note it in the commit.
- Respect `showExperimentalFeatures` gating (Tax/Scenarios/Ratios) in the new
  grouping.

**Conflicts:** Sidebar + GlobalKeyboardShortcuts also touched by P5 — run
strictly after P5 lands.

**Tests:** route redirects; sidebar render per flags; e2e nav spec if one
exists (check `e2e/` for navigation specs and update).

---

## Deferred (not in this wave)

- Sankey node provenance (click → source objects) — needs design on the
  interaction; revisit after P1–P7.
- Goal-specific minimal creation flow + segmented date input (replaces
  native `<input type="date">` in TriggerSelector) — after P3 settles.
- Per-object timeline view — feature-sized; separate plan when wanted.

---

## Waves & conflict map

Wave 1 (parallel, disjoint files):
- P1 (Overlays/ReceiptToast, App.tsx, AddAccountModal)
- P2 (MilestoneModal, DeleteAccountUI, ConfirmDialog)
- P4 (SpendingTab, Dashboard labels, PriorityTab labels)
- P6 (new test file only)

Wave 2 (after P1):
- P3 (AddExpenseModal — needs P1's hook)
- P5 (Sidebar, GlobalKeyboardShortcuts, CashflowTabs, AssumptionsContext)
  — can run alongside P3; no shared files.

Wave 3 (after P5):
- P7 (Sidebar, App routes, FutureTab grouping)

Shared-file caution: App.tsx is touched by P1 (provider) and P7 (routes) —
sequenced by waves. AssumptionsContext is touched by P5 only.

Each wave ends with: full `vitest run` + `tsc -b` green on main before the
next wave starts.
