# Dead Code & Rewrite Audit

Originally compiled from a knip pass plus four parallel sub-agent audits, then verified against the codebase. Seven cleanup passes plus five major refactor splits have landed (work split across parallel agents). This doc is updated to reflect current state.

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

### Pass 7 — drop unused exports + delete commented-out debug logs (commit 36c0deb)
- Un-exported `MIN_DISPLAY_THRESHOLD` (cashflowSankeyData.ts), `getESPPLotOrder` + `ESPPLotOrder` type (Accounts/models.tsx), `isTypingTarget` / `hasModifier` / `ShortcutMap` (useKeyboardShortcuts.ts). All used internally only.
- Deleted 8 commented-out `// console.log` lines across WithdrawalPlanner.ts (3 DEBUG clusters) and SurplusAllocator.ts (2 DEBUG clusters). Per CLAUDE.md, no comments for removed code.

### Major component splits (multi-PR refactor work, landed across parallel agents)
- `AddIncomeModal.tsx` 878 → 477 lines (commit 7a5922e). Extracted `IncomeTypeSelector`, `WorkIncomeFields`, `FERSPensionFields`, `CSRSPensionFields`, `incomeFormTypes.ts`.
- `TransactionsTab.tsx` 1510 → 360 lines (commit 9ac3242, parallel agent). Extracted `AddTransactionForm`, `ClearAllDialog`, `CollapsibleSection`, `Toolbar`, `TransactionRow`, plus `useBulkSelection` / `useCollapsedCategories` / `useTransactionEditor` hooks and a `utils.ts`. Stayed read-only against BudgetContext shape.
- `TaxService.tsx` 1241 → 50 lines (commit 6511bbd, parallel agent). Now a barrel re-exporting from 12 focused domain files under `Taxes/taxService/`: parameters, incomeAggregation, socialSecurity, deductions, bracketTax, federalTax, stateTax, ficaTax, capitalGainsTax, withdrawalGrossUp, marginalRates, esppTax. Many consumers use namespace import — barrel preserves every old name.
- `CSVImportModal.tsx` 706 → 144 lines (commit 7616706). Reorganized around a state-machine architecture: `csvImportReducer.ts` (14 actions, fully unit-tested at 26 tests), `useCSVImportFlow.ts` (side-effectful actions), 4 stage components (Upload / Mapping / Preview / Result) — wizard now scales additively.
- `IncomeCard.tsx` 730 → 324 lines (commit 41104aa). Pulled the inline sub-components into `card/`, extracted `incomeCardUtils.ts` (pure helpers, 21 unit tests) and `useSSAEarningsImport.ts` (XML upload flow). Also fixed a **silent-corruption bug surfaced during refactor**: FERS/CSRS pensions previously fell through every `instanceof` branch and showed the generic Amount field, which would overwrite the simulation-computed `calculatedBenefit` when edited. Added dedicated `card/FERSPensionFields.tsx` + `card/CSRSPensionFields.tsx` and a hide-misleading-inputs gate.

Result: knip unused-exports went from 70 (pre-cleanup) → 36. Net code change across passes: roughly −2400 production lines deleted plus ~3500 lines reorganized into focused modules + four new unit-test files. Full test count 3251 → 3298.

---

## 🔜 Knip baseline still flagging

- 🚨 `@rollup/rollup-linux-x64-gnu` pinned in deps — platform-specific transitive. Removing may break Linux installs. Skip unless you understand the rollup install dance.
- ✗ `husky` flagged as both unused devDep and unlisted binary — known knip quirk for prepare-script-only packages. Already in devDeps after Pass 2, correct as-is.
- ✗ `lint-staged` flagged — knip false positive (invoked by `.husky/pre-commit`).

Current knip totals: **36 unused exports / 100 unused exported types**. Most of the remaining "unused exported types" are interface props for components (consumed implicitly through JSX) and tagged-union helpers — false positives for the way knip counts. A targeted sweep would need a per-symbol audit.

---

## 🤔 Decisions waiting on you

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

- `SimulationEngine.tsx` — 679 lines (path: `src/components/Objects/Assumptions/SimulationEngine.tsx`). Audit suggested `YearPlanExecutor` / `WithdrawalStateManager` / `YearSimulator` — verify the seams against current code before acting. **Hot.**
- `AccountCard.tsx` — 640 lines. Card+modals+actions; ESPP/Property/Debt variants suggest natural extraction points.
- `useSimulation.tsx` — 624 lines (path: `src/components/Objects/Assumptions/useSimulation.tsx`). ✗ Original audit said "extract `useSimulationCache`" — **no cache layer exists in this file** (hashing happens externally in consumers via `services/simulationHash.ts`). Real refactors that exist: the file has no React hook despite the `use` prefix, and `runSimulation` is 268 lines that could be split into sub-phases. Both are speculative reshuffles, not obvious wins.
- `ScenarioContext.tsx` — 579 lines. Real React Context. Audit suggested "split state vs comparison logic." Bounded internal change; consumers (ScenarioManager, ScenarioCard, ScenarioComparisonTab) keep importing the same hook.
- `ExpenseCard.tsx` — 515 lines. Same family as IncomeCard / AccountCard. The IncomeCard split (commit 41104aa) is the reference pattern: pure utils + flow hook + per-type sub-components in a sibling `card/` subfolder.

### Other refactor opportunities

- **Extract shared Roth-conversion helpers** between `RothConversionDP` and `TaxOptimizedWithdrawal` (`getAcaCliffThreshold`, tax-impact math) into a common module. Both files stay — they're intentional alternate optimizers. **`RothConversionDP` is hot** — coordinate before touching.
- **Raw-input sweep** on `SettingsTab.tsx` (4) and `ScenarioCard.tsx` (7). The current raw inputs use `bg-gray-800` styling that differs from InputFields' `bg-gray-900`; converting needs more than a swap-replace. (TransactionsTab's 19 raw inputs may also have been resolved as part of the 9ac3242 split — re-verify before acting.)
- **`assertions.ts`** — ~600 lines, only ~8 helpers actively used. Aggressive trim needs per-helper call-site audit.
- **`MortgageExpense`** (in `Expense/models.tsx`) — six methods share amortization-loop math: `calculatePrincipalAndInterest` (289), `calculateAnnualAmortization` (298), `calculatePayment` (361), `calculateDeductible` (382), `getPrincipalPayment` (397), `getBalanceAtDate` (411). Extract a shared `amortize(month, …)` helper; don't merge the methods themselves.
- **`SimpleExpense` full discriminated-union collapse** — Pass 5 did the minimal version (one-liner subclasses sharing a parent). The full collapse to a single `GeneralExpense { type }` would touch 10+ files (AddExpenseModal dispatching, ExpenseCard `instanceof` checks, Dashboard category mapping, default data, ~30 test assertions). Worth doing only if the existing class hierarchy starts getting in the way.

---

## ⏸ Pure-churn skips

- `DropdownInput.tsx` — 1-line shim re-exporting `CustomDropdown`. Removing requires renaming `<DropdownInput>` → `<CustomDropdown>` in **19** consumer files (up from 13 in the original audit; the AddIncomeModal + IncomeCard splits added 7 new ones). Still pure churn — the shim has zero cost and removal has only gotten more expensive.
- `BudgetContext.tsx` re-exports the rest of `BudgetTypes` (`INCOME_CATEGORIES`, `TRANSFER_CATEGORY_ID`, `getFrequencyDivisor`, `Transaction`, `CategoryMapping`, `SavedCSVMapping`, `MonthlySnapshot`, `BudgetState`, `IncomeCategory`, `TransactionFrequency`) — these have real BudgetContext consumers. Removing would require updating every importer to point at `BudgetTypes` directly. Pure rename.

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
- **AddIncomeModal split candidate** — landed (commit 7a5922e).
- **CashflowSankey split candidate** — landed Pass 6.
- **SimpleExpense 6 subclasses** — collapsed (lightweight version) in Pass 5.
- **TransactionsTab split candidate** — landed (commit 9ac3242).
- **TaxService split candidate** — landed (commit 6511bbd).
- **CSVImportModal split candidate** — landed (commit 7616706).
- **IncomeCard split candidate** — landed (commit 41104aa). Audit's description ("Same card+modals+actions inline pattern as the AddIncomeModal") was misleading — there were no inline modals in IncomeCard, only inline sub-component functions. Real seams turned out to be: pure utilities, SSA file-upload flow, and missing FERS/CSRS pension subforms (which was also a silent-corruption bug, not just a refactor opportunity).
- **`TaxService.tsx` path** — was at `src/components/Objects/Taxes/TaxService.tsx`, not `src/services/TaxService.tsx` as the audit had implied.
- **`SimulationEngine.tsx` / `useSimulation.tsx` paths** — both live under `src/components/Objects/Assumptions/`, not `src/services/simulation/`.
- **BudgetContext re-exports of `TRANSACTION_FREQUENCIES` and `FormatFingerprint`** — the audit framed these as needing "every consumer updated" if removed. Actually dead re-exports: `TRANSACTION_FREQUENCIES` had zero importers anywhere; `FormatFingerprint`'s one importer (`CSVImportService.ts`) was already importing it from `BudgetTypes.ts` directly. Both lines deleted with zero consumer changes. The *other* re-exports in the same block remain real consumer-facing surface.

---

## Where this leaves us

Both the dead-code phase and the audit-listed component splits are genuinely done. Everything that was a real concentrated win has landed across seven cleanup passes and the five major splits (AddIncomeModal, TransactionsTab, TaxService, CSVImportModal, IncomeCard). What's left is either:

- Five remaining big files (`SimulationEngine`, `AccountCard`, `ExpenseCard`, `useSimulation`, `ScenarioContext`) where the refactor is more speculative — best done while you're already in the file for feature work.
- One judgment call (production `console.error` usage).
- The remaining "Other refactor opportunities" entries (Roth-conversion helper extraction, raw-input sweep, assertions trim, MortgageExpense amortization helper, SimpleExpense full collapse).

If the next ask is "keep cleaning," the remaining cards (AccountCard, ExpenseCard) are the closest to mechanical — both follow the same card+sub-components pattern the IncomeCard split established. The Assumptions-side `SimulationEngine` and `useSimulation` files are hot and should not be touched cold.

## Pass 8 (2026-06-24 deep-review)

Two dead functions surfaced by the 2026-06-24 deep-review and removed:

- `estimateBenefitFromCurrentIncome` (`src/services/SocialSecurityCalculator.tsx`) — zero `src/` callers (only its own 3-test describe block referenced it). Also carried a future-earnings off-by-one (`i < yearsUntilRetirement` omitted the claiming-year earnings), so deletion beat fixing the bound. Removed the function + its 3-test block + the import.
- `extractIncomeForRMDEstimate` (+ the `ExtractedIncomeForRMD` interface, `src/services/simulation/helpers.ts`) — no production caller; the live RMD path in `YearSolver.ts` extracts income inline and had already diverged (it includes the FERS MRA-to-62 supplement and excludes RMD-sourced PassiveIncome, neither of which the helper did) — so the helper was both dead and stale. Removed the function, the interface, the section header, and its dedicated ~1076-line test file. Sibling `estimateFixedIncomeAtRMD` is still used by YearSolver and was kept.
