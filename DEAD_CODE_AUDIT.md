# Dead Code & Rewrite Audit

Originally compiled from a knip pass plus four parallel sub-agent audits, then verified against the codebase. Six cleanup passes have landed (some by a parallel agent). This doc is updated to reflect current state.

Status legend:
- ✅ Done — cleaned up
- 🛠 Refactor — verified, real refactor work (not a free win)
- 🤔 Decision needed — waiting on a delete-or-migrate call
- ✗ Wrong — original audit claim was incorrect; do not act
- ⚠ Partial — claim needs nuance; see notes
- 🚨 Watch — true but has hidden consumers / load-bearing context

---

## ✅ Done

### Pass 1 — duplicate defaults + first knip wins
- 10 duplicate `export default` removed: AlertBanner, ExpandableCard, ScenarioCard, ScenarioManager, DifferenceSummary, FinancialRatiosTab, OverlaidChartView, ScenarioComparisonTab, SideBySideView, TaxOptimizationTab.
- `HelpIcon` deleted from `Tooltip.tsx`.
- `_getFirstBrokerageAccount` deleted from `YearSolver.ts` (had `void` suppression).
- `useSimulation.tsx` `'PensionIncome'` dead `className` branch removed (class doesn't exist; only FERS/CSRS variants do).
- 3 unused deps removed: `@nivo/core`, `@nivo/pie`, `cloc`.
- 3 skipped test blocks removed: entire `TaxOptimizationSnapshot.test.ts` (514 lines), `ExcelExportService.test.ts:147` `it.skip`, `BugCAndDBracketSpace.test.ts:524` `it.skip`.
- `AddESPPLotModal.formatDateForInput` deduped — now imports from `utils/formatters.ts`. Utils version extended to accept `Date | string` and switched from `toISOString()` to local-time `getFullYear/Month/Date` (avoids timezone day-shift).

### Pass 2 — second knip sweep
- `infrastructure/lambda/` deleted (was zero-referenced).
- 4 more unused devDeps removed: `@tailwindcss/postcss`, `autoprefixer`, `postcss`, `@types/html2canvas`.
- `husky` added to devDeps (was invoked by `prepare` script but not declared).
- 13 `TaxOptimizationService` constants un-exported (only referenced in test names, never imported).
- `DisplayGroup` un-exported in `StyleUI.tsx` (used internally by `StyledDisplay`).
- `Skeleton` + `ChartSkeleton` deleted from `LoadingSpinner.tsx`.
- `AddAccountModal.tsx:247` `as any` cast replaced with `[...TaxTypeEnum]` (proper spread to mutable string array).
- `assertCashflowAlgebra` un-exported in `assertions.ts` (used internally by another helper).
- 3 dead integration test helpers removed: `getTotalIncome`, `isMonotonicallyIncreasing`, `isMonotonicallyDecreasing` from `simulationTestUtils.ts`.

### Pass 3 — WithdrawalService port + delete
- `WithdrawalService.ts` shrunk 794 → 51 lines. Removed dead `executeWithdrawals` + internal `executeWithdrawalPlan` + `WithdrawalResult` + `WithdrawalPlan` types. Production path uses `WithdrawalPlanner.planWithdrawals`. Kept `processDeficitDebt` (used by `SimulationEngine.tsx:448`) + `DeficitDebtResult`.
- `WithdrawalService.test.ts` shrunk 1387 → 134 lines. Removed dead-function describes; kept `processDeficitDebt` tests.
- New `RothAndHSAEdgeCases.test.ts` (10 tests, ~240 lines) ports 8 critical tax invariants pointed at `planWithdrawals`: Roth contributions penalty-free; Roth 5-year rule on conversions; Roth earnings ordinary income; Roth earnings 10% penalty; HSA penalty after vs before 65; Traditional 10% early penalty; Traditional penalty gross-up; FP cleanup (deficit + surplus).
- HSA behavior correction: dead test asserted HSA is unconditionally tax-free. `planWithdrawals` correctly models HSA as ordinary income + 20% penalty before 65. Ported test asserts the *correct* behavior.

### Pass 4 — TaxOptimizedWithdrawal export annotations
- `getEffectiveConversionRate` annotated `@public`. NOT actually dead — called 6× inside `coarseToFineSearch`. Tests use it as a direct probe into marginal-rate math (SS torpedo, ACA cliff, state stacking).
- `calculateEffectiveRateConversionLimit` annotated `@public`. Thin test-only wrapper around `coarseToFineSearch`. Backs `BugCAndDBracketSpace.test.ts` regression suite + `TaxOptimizedWithdrawalRefactor.test.ts` sanity suite.

### Pass 5 — SimpleExpense subclass collapse
- Replaced the 6-subclass `createInstance` pattern with `new this.constructor(...)`. Each subclass collapsed to a one-liner. Zero caller changes (`instanceof` + reconstitute still work).
- Vacation/Subscription/Emergency/Transport/Food/Other are now empty `extends SimpleExpense {}` classes; `increment`/`adjustAmount` live on the parent.

### Pass 6 — CashflowSankey extraction
- `CashflowSankey.tsx` shrunk 731 → 197 lines (chart memo + render only).
- New `SankeyErrorBoundary.tsx` (69 lines) — extracted error-boundary class.
- New `cashflowSankeyData.ts` (535 lines) — pure `buildCashflowSankeyData` fn with typed inputs. No closure deps on the component; independently testable.
- All 5 `console.error`/`console.warn` calls in the file removed. Errors still surface via the error boundary UI and the data fn's `error` return field.
- `SankeyImbalance` re-exported from `CashflowSankey.tsx` for backward compat.

### Landed by parallel agent (not part of this audit cycle but moves the cleanup forward)
- `AddIncomeModal.tsx` split 878 → 477 lines (commit 7a5922e). Extracted `IncomeTypeSelector`, `WorkIncomeFields`, `FERSPensionFields`, `CSRSPensionFields`, `incomeFormTypes.ts` into the same directory.

Result: knip unused-exports went from 70 (pre-cleanup) → 40. Net code change across passes: roughly −2400 production lines + a new test file. All 3251 tests pass.

---

## 🔜 Free wins still on the floor

These are mechanical and isolated — pick them up any time.

### Drop `export` from internal-only symbols
- `cashflowSankeyData.ts:14` — `MIN_DISPLAY_THRESHOLD` was exported by me in Pass 6 but nothing else imports it. Drop the `export`.
- `models.tsx:376` (Accounts) — `getESPPLotOrder` is exported but only declared, never called by anything (including internally). Either delete the function or confirm a planned consumer.
- `useKeyboardShortcuts.ts:8,20,28` (parallel agent's new file) — `isTypingTarget`, `hasModifier`, `ShortcutMap` are used inside the file but no external importers. Un-export.

### Commented-out debug noise
- `WithdrawalPlanner.ts` lines 541, 542, 543, 545, 1051, 1063, 1064 — six commented-out `// console.log` lines.
- `SurplusAllocator.ts` lines 74, 357 — two more.
- CLAUDE.md's "no comments for removed code" rule says delete; total ~8 lines of cruft.

### Knip baseline still flagging
- 🚨 `@rollup/rollup-linux-x64-gnu` pinned in deps — platform-specific transitive. Removing may break Linux installs. Skip unless you understand the rollup install dance.
- ✗ `husky` flagged as both unused devDep and unlisted binary — known knip quirk for prepare-script-only packages. Already in devDeps after Pass 2, correct as-is.
- ✗ `lint-staged` flagged — knip false positive (invoked by `.husky/pre-commit`).

---

## 🤔 Decisions waiting on you

### `Expense/models.tsx:927 case 'HousingExpense':`
Class doesn't exist; the case maps legacy localStorage data to `RentExpense`. Delete only if you're willing to drop backward-compat for users with old saves. Otherwise leave it.

### Production `console.error` / `console.warn` calls
CLAUDE.md forbids `console.log` specifically, leaving `error`/`warn` as a judgment call. Current sites (post-Pass-6 Sankey cleanup):
- `useFileManager.ts:110` — catch handler for import/export failure
- `useDebouncedLocalStorage.ts:40,60` — localStorage write failure
- `models.tsx:968` (Accounts) — `console.warn` on unknown className during reconstitute
- `tabs/Future/tabs/DataTab.tsx:85` — PDF export failure
- `ScenarioService.ts:69,81` — scenario load/save failure
- `IncomeProjection.ts:241` — SS benefit calc failure
- `ExcelExportService.ts:652` — null sheet builder
- `PDFReportService.tsx:247,261,498` — chart capture + generate failure

Most are legitimate error reporting that should probably route through a real logging hook eventually. None are debug `log` cruft.

---

## 🛠 Real refactors (multi-PR scope, best done while you're already in those files)

These are *opportunities*, not "to-do." Don't pick them up cold for the sake of refactoring; do them when you're touching the area for feature work.

### Component splits — file sizes verified

- `TransactionsTab.tsx` — 1510 lines. Candidates: `TransactionForm`, `TransactionFilter`, `TransactionGrid`. Also has 19 raw `<input>`/`<select>` that should become InputFields.
- `TaxService.tsx` — 1241 lines. Candidates: `TaxBracketService`, `SALTCapService`, `TaxCalculationService`. **Hot** — touched by tax features; risky cold.
- `IncomeCard.tsx` — 730 lines. Same card+modals+actions inline pattern as the (already-split) AddIncomeModal.
- `CSVImportModal.tsx` — 706 lines. Parser / mapper / preview seams.
- `SimulationEngine.tsx` — 679 lines. Audit suggested `YearPlanExecutor` / `WithdrawalStateManager` / `YearSimulator` — verify the seams against current code before acting. **Hot.**
- `AccountCard.tsx` — 640 lines. Card+modals+actions; ESPP/Property/Debt variants suggest natural extraction points. *(Note: as of writing, a parallel agent has been pointed at this one.)*
- `useSimulation.tsx` — 624 lines. ✗ Original audit said "extract `useSimulationCache`" — **no cache layer exists in this file** (hashing happens externally in consumers via `services/simulationHash.ts`). Real refactors that exist: the file has no React hook despite the `use` prefix, and `runSimulation` is 268 lines that could be split into sub-phases. Both are speculative reshuffles, not obvious wins.
- `ScenarioContext.tsx` — 579 lines. Real React Context. Audit suggested "split state vs comparison logic." Bounded internal change; consumers (ScenarioManager, ScenarioCard, ScenarioComparisonTab) keep importing the same hook.
- `ExpenseCard.tsx` — 515 lines. Same family as IncomeCard / AccountCard.

### Other refactor opportunities

- **Extract shared Roth-conversion helpers** between `RothConversionDP` and `TaxOptimizedWithdrawal` (`getAcaCliffThreshold`, tax-impact math) into a common module. Both files stay — they're intentional alternate optimizers. **`RothConversionDP` is hot** — coordinate before touching.
- **Raw-input sweep** on `SettingsTab.tsx` (4), `ScenarioCard.tsx` (7), `TransactionsTab.tsx` (19). The current raw inputs use `bg-gray-800` styling that differs from InputFields' `bg-gray-900`; converting needs more than a swap-replace.
- **`assertions.ts`** — ~600 lines, only ~8 helpers actively used. Aggressive trim needs per-helper call-site audit.
- **`MortgageExpense`** (in `Expense/models.tsx`) — six methods share amortization-loop math: `calculatePrincipalAndInterest` (289), `calculateAnnualAmortization` (298), `calculatePayment` (361), `calculateDeductible` (382), `getPrincipalPayment` (397), `getBalanceAtDate` (411). Extract a shared `amortize(month, …)` helper; don't merge the methods themselves.
- **`SimpleExpense` full discriminated-union collapse** — Pass 5 did the minimal version (one-liner subclasses sharing a parent). The full collapse to a single `GeneralExpense { type }` would touch 10+ files (AddExpenseModal dispatching, ExpenseCard `instanceof` checks, Dashboard category mapping, default data, ~30 test assertions). Worth doing only if the existing class hierarchy starts getting in the way.

---

## ⏸ Pure-churn skips

- `DropdownInput.tsx` — 1-line shim re-exporting `CustomDropdown`. Removing requires renaming `<DropdownInput>` → `<CustomDropdown>` in 13 consumer files. The 1-line file is harmless.
- `BudgetContext.tsx` re-exports `TRANSACTION_FREQUENCIES` + `FormatFingerprint` from `BudgetTypes.ts` for "backward compatibility" (explicit comment on line 4). Removing requires updating every consumer to import from `BudgetTypes` directly. Same shape as `DropdownInput`.

Bundle these into one rename pass if you ever want them gone.

---

## ✗ Original audit claims that turned out to be wrong

Don't act on these — they're documented so the next audit doesn't re-raise them.

- **`useSimulationCache` extraction** — no cache exists in `useSimulation.tsx`. Hashing happens externally in consumers.
- **CloudBackup feature unwired** — wired through `Sidebar.tsx:5,178` (data panel) and `App.tsx:27` (provider). Feature ships.
- **`ImportKeyContext` vestigial** — `Dashboard.tsx` (lines 479, 535, 616) uses `importKey` as a React `key` to remount charts after global import. Critical to current behavior.
- **QR modals' `assumptions: unknown` import** — it's a *field* on `FullBackup` / `ParsedData` interfaces, not an import. Load-bearing.
- **`ScenarioService.ts` "legacyValue"** — financial term for estate / end-of-life value; actively computed and rendered, not dead code.
- **`TaxOptimizedWithdrawalRefactor.test.ts` stale** — tests current functions (`getEffectiveConversionRate`, `calculateEffectiveRateConversionLimit`).
- **`lint-staged` unused** — knip false positive; invoked by `.husky/pre-commit`.
- **`TaxOptimizedWithdrawal.ts:projectBalanceAtRMD` duplicate** — called by `calculateDynamicConversionCeiling` at line 1057. Helper, not duplicate.
- **`CloudBackupPanel.tsx` raw input** — it's `<input type="file">`. No styled file-input exists in `InputFields/`. False positive.
- **CashflowSankey console-statement violations (5 sites)** — removed in Pass 6.
- **AddIncomeModal split candidate** — landed by parallel agent (commit 7a5922e).
- **CashflowSankey split candidate** — landed Pass 6.
- **SimpleExpense 6 subclasses** — collapsed (lightweight version) in Pass 5.

---

## Where this leaves us

The dead-code phase is genuinely done. What's left is either:

- A handful of one-line `export` cleanups + commented-debug deletes (~15 minutes of work, listed in "Free wins still on the floor").
- Real refactors that are worth doing only when you're already in the file for feature work.
- Two judgment calls (HousingExpense legacy reconstitute, production `console.error` usage).

If the next ask is "keep cleaning," the only things left are the free wins above. Bigger work needs a feature-driven trigger.
