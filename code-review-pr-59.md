# PR #59 Review — Campaign 7 fact-check (cumulative fix diff)

Scope reviewed: `review-campaign-base...review-fixes-7` — the cumulative output
of the five scoped reviews (PRs #54–#58) plus their claims docs. Effort: xhigh
(9 finder angles + 1-vote verify + sweep). Reviewed source ≈ `main` (all
`fix(review7):` commits present).

Status legend: ☐ open · ☑ fixed (test-backed) · ◇ cleanup (no failing test) · ⏸ deferred

## Resolution (2026-06-11)

Fixed test-first via 4 file-disjoint sub-agents + a reconciliation pass. Final
state: **3453 tests pass under default, `America/New_York` (−UTC), and
`Australia/Sydney` (+UTC)**; `tsc -b` clean; lint clean on all touched files.

- **#1 ☑** `expandKeys` now consults `legacyAliasFor(shortKey, siblings)`:
  `pp` expands to `projectedPIA` only when the object's own className sibling
  contains `SocialSecurity`; otherwise → `purchasePrice`. New `Pi` payloads
  untouched. Red-verified (`expected undefined to be 3100` pre-fix);
  `QRUtils.test.ts` +4 legacy-decode tests.
- **#2 ☑** Convergence now requires `esppDelta < 1` alongside ltcg/trad.
  Red-verified: SS + zero-gain disqualifying ESPP lot exited iter-0 with SS
  deemed untaxable (federal tax $369 low). `ReviewFixes_PR59_YearSolver.test.ts`.
- **#3 ☑** `estimateMAGI` state tax now uses `nonSSOrdinaryIncome +
  conversion` (== solver's `allOrdinaryIncome - currentSSTaxable`); the
  `+ estimatedLTCG` term is deliberately absent there (LTCG derives from this
  very deficit; matches the solver's pre-loop baseline — documented in a
  comment). Red test: DC MFJ + $40k SS, predicted MAGI $85,027 > $84,600
  cliff forfeited a conversion the solver would permit.
- **#4 ☑** DataTab table sum AND its CSV export now pass `year.year`. New
  `Components/tabs/DataTab.test.tsx` (red-verified: capped $7,400 vs uncapped
  $14,400 in the payoff year). Mortgage-amortization display nuance noted as
  separate pre-existing issue, out of scope.
- **#5 ◇ NOT TRIGGERABLE** All exit paths consistent: iter-0 surplus exits
  plan no withdrawals (LTCG genuinely 0); iter>0 exits follow the
  LTCG-inclusive recompute; convergence bounds the error < $1. Formulas made
  textually identical anyway (no-op `+ estimatedLTCG` + comment).
- **#6 ☑** Filename uses `formatDateForInput(new Date())`. Red-verified under
  `TZ=America/New_York` at 23:30 local (`…2026-06-12.json` pre-fix); test's
  `beforeEach` system time hardened to local noon for TZ-independence.
- **#7 ◇** Shared `generateId(prefix)` in new `src/utils/id.ts`; BudgetContext,
  CSVImportService (`TXN`), backupMerge (`MONTH`) all delegate.
  Collision-within-a-tick tests pass unmodified.
- **#8 ◇** `ordinaryTaxOf()` / `ltcgTaxOf()` helpers replace all four
  duplicated reduce-expressions in YearSolver.
- **#9 ◇** `localToday()` delegates to `formatDateForInput`.
- **#10 ◇** `handleGlobalExport` now calls `getBackupData()`.
- **#11 ◇** Shared `activeFundedGoals(milestoneFilteredExpenses)` helper in
  SimulationEngine; funding loop derives its fund-id set from it, purchase
  loop iterates it keeping its loop-specific guards. Invariants (committed
  transfer, once-per-fund-id, pacing) untouched; goal suites green.

New tests: `QRUtils.test.ts` (+4), `ReviewFixes_PR59_YearSolver.test.ts`,
`DataTab.test.tsx`, `useFileManager.test.tsx` (+1). Incidental lint fixes in
touched files only (YearSolver `no-explicit-any` casts, useFileManager
`FullBackup` typing, DataTab unused-var directives for kept PDF-export code).

## Fact-check verdicts (the PR's three questions)

- **VERIFIED:** the UTC→LOCAL date unification is consistent at every touched
  site (`endDate`/`startDate` are `Date` instances via `parseDate` before any
  local getter reads them); §415(c) two-stage trimming; SS earnings-test
  full-PIA base; RMD double-subtraction removals; FERS supplement/COLA fixes;
  2024 Single brackets vs IRS figures; QR forward round-trip; burnOrder alias.
- **UNSUBSTANTIATED claim:** `code-review-pr58.md` justified dropping legacy
  decode of `projectedPIA` with "legacy SS projectedPIA is recomputed, so
  losing its legacy decode is harmless." False — `IncomeProjection.ts:292` only
  falls back to `amount / 12` when PIA is 0; the saved value is lost (finding #1).
- **BREAKS-INTENDED:** none found.
- Refuted candidates (checked, cleared): PMI divide-by-zero (yields 0, not
  NaN); debounce-hook listener leak (cleanup present + tested); budget
  timestamp shuffling; module ID counters; goal `endDate` UTC parsing (Date
  object by then); federal/state deduction-guard asymmetry; stateTax
  delegation chain; `months.map` reducer idiom.

---

## Correctness findings

### 1. ☑ qrUtils legacy `pp` decode: silent projectedPIA loss on old QR imports
`qrUtils.ts:36` remapped `projectedPIA` from `'pp'` to `'Pi'` to fix the
collision with `purchasePrice: 'pp'`. Forward round-trip is now correct, but
there is **no legacy alias**: old QR payloads encoded SS `projectedPIA` as
`pp`, and HEAD's `REVERSE_KEY_MAP` now expands `pp` → `purchasePrice`.
Reconstitution then yields `projectedPIA = 0` (`models.tsx:974`
`Number(data.projectedPIA) || 0`) and the sim silently falls back to
`amount / 12`. Note: in BASE the reverse map sent `pp` → `projectedPIA`
(last-writer-wins), so legacy ESPP `purchasePrice` decode was broken in the
other direction. Fix needs context-aware legacy handling so old payloads
restore the right field per object type. `QRUtils.test.ts` has no
legacy-payload case.

### 2. ☑ YearSolver: `estimatedESPPOrdinaryIncome` missing from convergence check
Introduced by this campaign. `YearSolver.ts:1506` initializes the estimate to
0; it is updated from the withdrawal plan (~1623) but the convergence check
(~1626-1636) tests only `ltcgDelta` and `tradDelta`. The loop can exit on an
iteration where the ESPP estimate just jumped, so final SS taxability and the
withdrawal sizing disagree (one-iteration lag). Trigger: SS benefits + ESPP
ordinary income in withdrawals.

### 3. ☑ YearSolver: `estimateMAGI` state-tax formula disagrees with the solver loop
`YearSolver.ts:757` computes state tax as
`calculateTax(allOrdinaryIncome, ...)` while the authoritative loop uses
`allOrdinaryIncome - currentSSTaxable + estimatedLTCG` (`:1522`, `:1556`).
Pre-existing (identical in base), re-exposed by the rewrite. In SS-exempting
states the overstated state tax inflates deficit → estimatedLTCG → predicted
MAGI, skewing the ACA-cliff binary search both directions.

### 4. ☑ DataTab sums `getAnnualAmount()` without year → payoff-year mismatch
`src/tabs/Future/tabs/DataTab.tsx:99`. After the LoanExpense payoff-year
capping fix (PR #57 #2), callers that pass `year` (Sankey/sunburst/sim) show
the capped payment; DataTab's no-arg call shows the uncapped one. Fix:
`exp.getAnnualAmount(year.year)`.

### 5. ◇ (not triggerable) YearSolver: pre-loop state-tax baseline omits `estimatedLTCG` (iter-0 exit)
`YearSolver.ts:1522` computes the baseline without `+ estimatedLTCG`; the
in-loop recompute (`:1556`) is gated `if (iter > 0)`. An iter-0 exit
(`deficit <= 0`) keeps the LTCG-less value. Pre-existing; trigger is narrow —
iter-0 exits are surplus years where withdrawal LTCG is 0 — so investigate
whether any non-withdrawal LTCG can make this observable; if not, make the
formulas consistent anyway (cheap) and document.

### 6. ☑ Backup filename uses UTC date
`useFileManager.ts:68`: `new Date().toISOString().split('T')[0]` — UTC date in
the filename, violating the local-date convention this campaign unified.
Pre-existing, cosmetic (filename never parsed back). Use
`formatDateForInput(new Date())` from `src/utils/formatters.ts`.

## Cleanup findings

### 7. ◇ `crypto.randomUUID`-with-fallback implemented three times
`BudgetContext.generateId`, `CSVImportService.newTransactionId`,
`backupMerge.generateMonthId` (which comments "Mirrors
BudgetContext.generateId"). Extract one shared `generateId(prefix)` util.

### 8. ◇ YearSolver duplicated withdrawal tax-split reduce-expressions
Ordinary-tax `(w.capitalGains === undefined ? w.tax : (w.ordinaryTax ?? 0))`
at `:1608` and `:1888`; LTCG-tax `(w.tax - (w.ordinaryTax ?? 0))` at `:1684`
and `:1886`. Extract shared helpers.

### 9. ◇ `backupMerge.localToday()` re-implements `formatDateForInput`
`backupMerge.ts:147-151` duplicates the canonical local YYYY-MM-DD formatter
in `src/utils/formatters.ts`.

### 10. ◇ `getBackupData()` / `handleGlobalExport()` duplicated serialization
`useFileManager.ts`: two identical FullBackup-building blocks (pre-existing,
file touched by campaign). `handleGlobalExport` should call `getBackupData`.

### 11. ◇ Goal-funding and goal-purchase loops carry parallel milestone filters
`SimulationEngine.tsx:278` and `:553` each filter goal activity independently;
a third goal loop would have to remember the same guard. Extract a shared
helper both loops call.
