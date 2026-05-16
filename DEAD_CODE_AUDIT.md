# Dead Code & Rewrite Audit (Verified + Cleanup Pass)

Originally compiled from a knip pass plus four parallel sub-agent audits, then verified against the codebase. A first cleanup pass landed the trivial wins; remaining items are tracked below.

Status legend:
- ✅ **Done** — cleaned up
- ⏸ **Deferred** — verified but skipped (real refactor work, not a free win)
- 🛠 **Refactor** — verified, but takes hours of real editing — not mechanical
- 🤔 **Decision needed** — waiting on a delete-or-migrate call
- ✗ **Wrong** — original audit claim was incorrect, do not act
- ⚠ **Partial** — claim needs nuance; see notes
- 🚨 **Watch** — true but has hidden consumers/load-bearing context

---

## ✅ Done in cleanup passes 1 + 2

### Pass 1
| Item | Notes |
|---|---|
| 10 duplicate `export default` removed | AlertBanner, ExpandableCard, ScenarioCard, ScenarioManager, DifferenceSummary, FinancialRatiosTab, OverlaidChartView, ScenarioComparisonTab, SideBySideView, TaxOptimizationTab. All confirmed named-only imports. |
| `HelpIcon` deleted from `Tooltip.tsx` | Zero callers. |
| `_getFirstBrokerageAccount` deleted from `YearSolver.ts` | Placeholder with explicit `void` suppression. |
| `useSimulation.tsx` `'PensionIncome'` dead `className` branch removed | Class doesn't exist; only `FERSPensionIncome` / `CSRSPensionIncome` do. |
| Unused npm deps removed | `@nivo/core`, `@nivo/pie`, `cloc`. |
| 3 skipped test blocks removed | `TaxOptimizationSnapshot.test.ts` (entire file, 514 lines), `ExcelExportService.test.ts:147` (it.skip + describe), `BugCAndDBracketSpace.test.ts:524` (it.skip). |
| `AddESPPLotModal.formatDateForInput` deduped | Now imports from `utils/formatters.ts`. Utils version extended to accept `Date \| string` and switched from `toISOString()` to local-time `getFullYear/Month/Date` to avoid timezone day-shift. |

### Pass 2
| Item | Notes |
|---|---|
| `infrastructure/lambda/` deleted | Entire directory removed; was unreferenced. |
| 4 more unused devDeps removed | `@tailwindcss/postcss`, `autoprefixer`, `postcss`, `@types/html2canvas`. |
| `husky` added to devDeps | Was invoked by `"prepare"` script but not declared. |
| 13 `TaxOptimizationService` constants un-exported | Comment `(exported for testing)` was inaccurate — tests only reference these in `it()` name strings. Now `const`. |
| `DisplayGroup` un-exported in `StyleUI.tsx` | Used internally by `StyledDisplay`; no external imports. |
| `Skeleton` + `ChartSkeleton` deleted from `LoadingSpinner.tsx` | Both unused outside the file. |
| `AddAccountModal.tsx:247` `as any` cast fixed | Replaced `TaxTypeEnum as any` with `[...TaxTypeEnum]` (proper spread to mutable string array). |
| `assertCashflowAlgebra` un-exported in `assertions.ts` | Used internally by another assertion helper; no external imports. |
| 3 integration test helpers deleted | `getTotalIncome`, `isMonotonicallyIncreasing`, `isMonotonicallyDecreasing` from `simulationTestUtils.ts`. |

### Pass 3 — WithdrawalService port + delete
| Item | Notes |
|---|---|
| `WithdrawalService.ts` shrunk 794 → 51 lines | Removed dead `executeWithdrawals` + `executeWithdrawalPlan` + `WithdrawalResult` + `WithdrawalPlan` types. Production path uses `WithdrawalPlanner.planWithdrawals`. Kept `processDeficitDebt` (used by SimulationEngine) + `DeficitDebtResult`. |
| `WithdrawalService.test.ts` shrunk 1387 → 134 lines | Removed `executeWithdrawals` (122–975) and `executeWithdrawalPlan` (1095–end) describes. Kept `processDeficitDebt` tests. |
| New `RothAndHSAEdgeCases.test.ts` (~240 lines, 10 tests) | Ported 8 critical tax invariants pointed at `planWithdrawals`: Roth contributions penalty-free; Roth 5-year rule on conversions; Roth earnings ordinary income; Roth earnings 10% penalty; HSA penalty after vs before 65; Traditional 10% early penalty; Traditional penalty gross-up; FP cleanup (deficit + surplus). |
| HSA behavior correction | Dead test asserted HSA withdrawals are unconditionally tax-free. `planWithdrawals` correctly models HSA as ordinary income + 20% penalty before 65. Ported test asserts the *correct* behavior. |

### Pass 4 — TaxOptimizedWithdrawal export annotations
| Item | Notes |
|---|---|
| `getEffectiveConversionRate` annotated `@public` | NOT actually dead. Called 6× inside `coarseToFineSearch` (the live search used by `YearSolver`). Only the external export is unused. Tests use it as a direct probe into marginal-rate math (SS torpedo, ACA cliff, state stacking). Added comment + `@public` JSDoc so knip stops flagging. |
| `calculateEffectiveRateConversionLimit` annotated `@public` | Thin test-only wrapper around `coarseToFineSearch`. Backs `BugCAndDBracketSpace.test.ts` (Bug C/D regression suite) and `TaxOptimizedWithdrawalRefactor.test.ts` (refactor sanity). Same annotation pattern. |
| Knip unused-exports went from 70 (pre-cleanup) to 39 | Across all 4 passes. |

Verified by `npm run test:ci` ✓ (101 files / 3251 tests passing) + `npx knip` no longer flags the two annotated exports. Full `npm run build` is currently blocked by an *unrelated* TS error in `OverviewTab.tsx`/`SpendingTab.tsx` introduced by a parallel work-in-progress on the branch (not from this cleanup).

---

## Remaining items (none are free wins anymore)

### Knip baseline
- 🚨 `@rollup/rollup-linux-x64-gnu` — platform-specific transitive; removing risks Linux install break.
- ✗ `lint-staged` — knip false positive (invoked by husky).
- ⏸ `BudgetContext.tsx` re-export shim — many consumers; same churn pattern as DropdownInput.

### Services
- ✅ **`WithdrawalService.ts:executeWithdrawals`** removed (pass 3); critical tax invariants ported to `RothAndHSAEdgeCases.test.ts`.
- ✅ **`TaxOptimizedWithdrawal.ts:calculateEffectiveRateConversionLimit`** + **`getEffectiveConversionRate`** annotated `@public` (pass 4). Investigation showed these are live (used inside `coarseToFineSearch`); only the external export was "unused." Tests probe specific marginal-rate / Bug-C/D-regression cases that aren't reachable through the search's opaque output. No port-and-delete warranted.
- 🛠 Extract shared helpers between `RothConversionDP` and `TaxOptimizedWithdrawal` (e.g., `getAcaCliffThreshold`, tax-impact math) into a common module. Both files stay — intentional alternate optimizers per commit history.
- ✗ `simulation/__tests__/TaxOptimizedWithdrawalRefactor.test.ts` — NOT stale. Tests current functions.
- ✗ `ScenarioService.ts` "legacyValue" — financial term (estate value), not dead code.
- ⚠ `TaxOptimizedWithdrawal.ts:projectBalanceAtRMD` (827) — IS called by `calculateDynamicConversionCeiling` at line 1057. Not a duplicate.

### Components & Tabs

**Raw HTML inputs (CLAUDE.md violation — InputFields/ convention):**
- ✗ `CloudBackupPanel.tsx` — the one raw `<input>` is `type="file"`. There's no styled file-input equivalent in `InputFields/`. **False positive.**
- 🛠 `SettingsTab.tsx` (4), `ScenarioCard.tsx` (7), `TransactionsTab.tsx` (19) — these are inline mini-forms using `bg-gray-800 border-gray-700 rounded-lg` styling that differs from the InputFields' `bg-gray-900` convention. Converting requires adjusting both the JSX and the surrounding visual context, not just swap-replace.

**Console statements (judgment call — CLAUDE.md forbids `console.log` specifically):**
- ⚠ All confirmed but are `console.error`/`console.warn`, not `.log`:
  - `useDebouncedLocalStorage.ts:40,60`
  - `PDFReportService.tsx:247,261,498`
  - `CashflowSankey.tsx:32,563,569,574,608`

**File-size rewrites (multi-PR refactors, not free wins):**
- 🛠 `TransactionsTab.tsx` — **1510** lines. Split into `TransactionForm`, `TransactionFilter`, `TransactionGrid`; convert raw inputs.
- 🛠 `TaxService.tsx` — 1241 lines. Split into `TaxBracketService`, `SALTCapService`, `TaxCalculationService`.
- 🛠 `AddIncomeModal.tsx` — 878 lines. Extract `IncomeTypeSelector` + `FrequencySelector`.
- 🛠 `CashflowSankey.tsx` — 731 lines. Extract error boundary + data transform.
- 🛠 `IncomeCard.tsx` (730), `AccountCard.tsx` (640), `ExpenseCard.tsx` (515) — card + modals + actions inline; split.
- 🛠 `SimulationEngine.tsx` (679) — split `YearPlanExecutor`, `WithdrawalStateManager`, `YearSimulator`.
- 🛠 `useSimulation.tsx` (625) — extract `useSimulationCache`.
- 🛠 `ScenarioContext.tsx` (579) — split state vs comparison logic.
- ⚠ `CSVImportModal.tsx` — 706 lines (audit said ~1100). Still big enough to consider splitting parser/mapper/preview.

### Contexts & Models
- 🚨 `Expense/models.tsx:927 case 'HousingExpense':` — class doesn't exist, but the case maps legacy localStorage data to `RentExpense`. Delete only if you're willing to drop backward-compat for old saves.
- ⚠ `SimpleExpense` abstract class spawns **6** concrete subclasses (Vacation, Subscription, Emergency, Transport, Food, Other; lines 700–745). Collapse into one `GeneralExpense` discriminated by `type` field.
- ⚠ `MortgageExpense` — methods `calculatePrincipalAndInterest` (289), `calculateAnnualAmortization` (298), `calculatePayment` (361), `calculateDeductible` (382), `getPrincipalPayment` (397), `getBalanceAtDate` (411). They share amortization-loop math but compute different things. Extract a shared `amortize(month, …)` helper, don't merge them.
- ✗ `QRGenerateModal.tsx` / `QRScanModal.tsx` "unused `assumptions: unknown` import" — it's a struct *field* on `FullBackup`/`ParsedData`, not an import. Load-bearing.
- ✗ `CloudBackupService.ts` + `CloudBackupContext.tsx` "no UI entry point" — wired through Sidebar's data panel. The feature ships.
- ✗ `ImportKeyContext.tsx` "verify any consumer" — Dashboard uses `importKey` as a React `key` to remount charts after global import (`Dashboard.tsx:479,535,616`). Critical to current behavior.
- ✗ `useSimulation` 45–47 FERS/CSRS branches — the `'PensionIncome'` branch was dead (now removed ✅), but the FERS/CSRS branches above it are live.

### Tests / Hooks / Utils
- 🛠 `assertions.ts` — ~600 lines, only ~8 helpers actively used. Aggressive trim needs per-helper call-site audit, not mechanical.
- ⚠ `hooks/useAutoReconcile.ts` — confirmed single caller (`BudgetTab.tsx:18`). Inlining is a style call, not strictly dead.
- ⚠ `utils/formatters.ts:getFrequencyAbbrev` — 2 callers (IncomeCard, ExpenseCard). Borderline export-vs-inline.
- 🚨 `package.json` `predeploy`/`deploy` scripts — `gh-pages` IS in deps; no `.github/workflows/`; this is the active manual deploy path. **Don't remove.**

---

## ⏸ Deferred (verified, but skipped in first pass — need a call before doing)

### `DropdownInput.tsx` re-export shim
The file is a one-line alias: `export { CustomDropdown as DropdownInput } from './CustomDropdown';`. Removing it requires touching **13 consumer files** to rename either the import or the JSX usage. Not a free win — defer until you're touching those files anyway, or until you're willing to do the bulk rename.

### `WithdrawalService.ts` execute* removal
Bigger than expected once mapped out:
- Production cuts: `executeWithdrawals` (lines 70–559) + internal `executeWithdrawalPlan` (604–end). ~490 lines.
- Test cuts: `WithdrawalService.test.ts` `describe('executeWithdrawals')` (122–975) + `describe('executeWithdrawalPlan (internal)')` (1095–1387). ~1100 lines.
- Keep: `processDeficitDebt` (line 560) and its tests — used by `SimulationEngine.tsx:448`.

Two paths to choose from:
1. **Delete** — drop function + tests. Loses ~1600 lines of test coverage, but the coverage was only exercising dead production code.
2. **Migrate** — rewrite the tests to exercise `WithdrawalPlanner.planWithdrawals` (the function that replaced `executeWithdrawals` in prod). Keeps coverage; bigger effort.

---

## What's actually next

The free wins are all done. What remains is:

**Decisions for you (🤔):**
1. **WithdrawalService** + the two `TaxOptimizedWithdrawal` test-only exports — pick "delete fns + tests" or "migrate tests to `WithdrawalPlanner.planWithdrawals`."
2. **HousingExpense legacy reconstitute branch** — keep for old-save backward-compat, or drop.

**Real refactor work (🛠), best done while you're already in those files:**
- Split the giant components (TransactionsTab, TaxService, AddIncomeModal, SimulationEngine, CashflowSankey).
- Raw-input sweep on SettingsTab / ScenarioCard / TransactionsTab (~30 edits, but each needs context-aware adjustment, not a swap).
- Extract shared Roth-conversion helpers between `RothConversionDP` and `TaxOptimizedWithdrawal`.
- Collapse `SimpleExpense` 6 subclasses into one discriminated `GeneralExpense`.
- Trim `assertions.ts` per-helper.

**Shim removals (⏸ — pure churn):**
- `DropdownInput.tsx` (13 consumers).
- `BudgetContext.tsx` re-exports from `BudgetTypes.ts` (many consumers).
- Bundle these into one rename pass if you ever want them gone.

---

*Verified by re-grepping each claim against `src/`. Items marked 🚨 still need a judgment call; ✗ are agent errors not to act on. Cleanup pass: build + 3280 tests passing.*
