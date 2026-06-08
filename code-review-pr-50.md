# Code Review — PR #50: Simulation / Tax Core

**Branch:** `review/sim-core-3` · **Diff:** `git diff HEAD~1` (16,512 insertions, 39 new files, 0 deletions)
**Effort:** max (9 finder angles → verify → sweep) · **Reviewed:** 2026-06-07

> Scope note: this branch is a deliberately *partial* extract (supporting modules like
> `modelUtils.ts` and `useDebouncedLocalStorage` are absent), so the project does **not**
> build and the oracle tests cannot be executed here. Fixes are source-level and
> reasoning-based; the behavioral tests in the tree are a reference only and may themselves
> be wrong (per the PR description) — if a test encodes a bug, flag it rather than matching it.

Findings are ranked most-severe first. Status legend: ☐ open · ☑ fixed · ⚠ fixed but needs human decision.

---

## ✅ Fix Status — all 15 addressed 2026-06-07 (7 parallel agents, file-disjoint)

Branch can't build/test (partial extract), so all fixes are reasoning-based against the proven contracts. **Re-run the full oracle suite once the tree is whole.** 12 files changed, +264 / −114.

| # | Status | Fix | Caveat for human |
|---|--------|-----|------------------|
| 1 SS double-count | ☑ | Threaded `nonSSOrdinaryIncome` (= `taxableBase − SS`) into both conversion paths; also corrected two opposite-direction `− SS` mis-nets (estimateMAGI ~666, roughFedTax ~1304). | `helpers.ts:74-103` TODO about ACA-MAGI SS double-count is now **stale** (callers pass non-SS income). |
| 2 UTC date off-by-one | ⚠ | Both multipliers now use `getUTCFullYear()/getUTCMonth()`. | `isExpense/IncomeActiveInCurrentMonth` left as-is (mixes parsed UTC date w/ local `new Date()`); residual positive-TZ edge on synthetic local dates; **`IncomeClassifierDateFilter.test.ts:67` hard-codes the OLD buggy value and must be updated.** |
| 3 0% APR NaN | ☑ | Guarded `monthlyRate===0` → straight-line in **4** unguarded sites (375/431/471/501), not just the reported one. | — |
| 4 ESPP gross-up | ☑ | Denominator now uses the lot pool's blended ordinary+LTCG effective rate. | Sizing uses whole-pool average; lot-walk then computes precise tax (estimate-then-exact, same character as before). |
| 5 ror falsy-zero | ☑ | `||` → `??` at line 306. | — |
| 6 Roth FIFO drain | ☑ | Withdrawal now drains basis → oldest conversions → earnings (matches `grossUpRoth`). | Best-effort re-derivation: `increment` only gets net `userContribution`, not the planner's tranche breakdown. Cleaner fix = planner passes tapped tranches in. |
| 7 Roth IRA double-limit | ☑ | Running `rothIRAContributedSoFar` accumulator caps all buckets to one per-person limit. | No spouse modeling — per-spouse Roth IRAs would legitimately allow 2×. |
| 8 VA senior deduction | ☑ | Added `+ seniorDeductionAmount` to both itemized branches of `calculateStateTax`. | — |
| 9 ACA Roth mutation | ☑ | ACA path now drains the shared `pooledRothConversions` (roth_ira) / same snapshot (roth_401k). | roth_401k correctness depends on ACA look-ahead running before roth iterations (true with current ordering). |
| 10 MULTIPLE_OF_EXPENSES | ☑ | Cap now subtracts prior in-pass allocations to the same account. | External payroll contributions still invisible here; full fix needs caller to pass projected contributions. |
| 11 §415(c) cap | ⚠ | Added `section415c` table + `get415cLimit()`; AccountGrowth clamps total additions (trims employer match). | **Modeling decision:** trims match only; confirm 2026=71000 projection & whether raw custom employee deferrals should also be re-clamped. |
| 12 RMD vested vs full | ⚠ | RMD requirement now uses vested prior-year balance (consistent w/ withdrawal cap). | **Modeling stance:** real IRS RMD uses full balance; this is a deliberate simplification to avoid penalizing undistributable money. Confirm. |
| 13 FERS supplement | ☑ | Supplement now prorated by the same active-year multiplier as the base. | — |
| 14 2024 SS wage base | ☑ | 168600 for all three 2024 statuses. | 2026 entries are a flat copy of 2025 (176100) — likely needs the real 2026 figure. |
| 15 RMD divisor dup | ☑ | `getRMDDivisor` now delegates to `RMDData.getDistributionPeriod`; local table removed. In-range values verified identical (73→26.5, 80→20.2). | — |

**Action items for a human:** update `IncomeClassifierDateFilter.test.ts:67`; decide on #11/#12 modeling stances; set the real 2026 SS wage base; remove the now-stale `helpers.ts` SS-TODO; run the oracle suite.

### Verification (2026-06-07) — fixes tested against full `main` tree

The 12 fixed files are byte-identical to `main`, so the patch was applied to a `main` worktree and run with the real tooling (`tsc -b`, `vitest`).

- **Typecheck:** `tsc -b` clean (exit 0).
- **Baseline:** all affected test files pass on unpatched `main` (so every failure below is attributable to the patch, none pre-existing).
- **After fixes:** **3346 passed / 12 failed** (110 files). A regression introduced by the first pass of fix #6 was caught and corrected:
  - **Regression (fixed):** fix #6 had changed `InvestedAccount.increment` cost-basis draining to FIFO for **all** account types, breaking taxable **Brokerage** average-cost basis (`CapitalGainsTax` test: got 70000, want 72000). Now scoped to **Roth only** (`Accounts/models.tsx`); brokerage keeps proportional basis.
- **Remaining 12 failures are all stale oracle tests that encode the OLD buggy behavior** — the fixes are correct (verified against IRS facts / calendar math):
  - 9× `TaxOptimizedWithdrawal.test.ts` `getRMDDivisor` "Linear Extrapolation" — assert the removed extrapolation; fix returns IRS Uniform Lifetime values (age 100: 4.4→**6.4**, age 120: 1.0→**2.0**).
  - 2× `TaxService.test.tsx` `calculateFicaTax` — assert 2024 wage base $176,100; fix uses **$168,600** (the real 2024 figure).
  - 1× `IncomeClassifierDateFilter.test.ts` — asserts 7 months ($58,333) for a July-1 start; fix yields 6 months (**$50,000**). (Baseline confirms test env is a negative TZ.)

**These 12 oracle tests must be updated to the corrected values for CI to be green.**

---

## 1. ☐ Social Security double-counted in Roth-conversion tax sizing
**Severity:** High · **File:** `src/services/simulation/YearSolver.ts:814` (also `planConversionDP` ~1110, `src/services/simulation/helpers.ts:203`)

`baseOrdinaryIncome` is built as `N + taxableSS` (YearSolver.ts:1284-1292), but it's then passed as the
`nonSSIncome` argument to `calculateEffectiveConversionTax`, alongside the **full** SS benefits.
`calculateTotalFederalTax`'s first arg is contractually non-SS income (proven in `federalTax.ts:54-56`:
`nonSSGross = incomeGross - totalSSBenefits`), and it re-derives taxable SS internally — so taxable SS is
counted ~1.85×.

**Failure:** Single filer, 68, $40k SS + $30k pension, converting $20k → provisional income overstated by
the taxable-SS amount → conversion's marginal rate too high → conversions under-sized and displayed
`conversion.taxAmount` overstated, for every retiree with SS income. The executed/authoritative year tax
(YearSolver ~1498-1539, which correctly passes SS separately) is unaffected, so this distorts the
*optimizer's sizing decision*, not the cash ledger. Hidden because conversion oracle tests use $0 SS except
Scenario5 (loose bounds `>0 && <30000`).

**Fix:** Pass the true non-SS ordinary income (`taxableBase - socialSecurityBenefits`, i.e. `N`) as
`nonSSIncome`, keeping full SS as the separate arg. Apply at the `calculateEffectiveConversionTax` call
(line 813-822), the `planConversionDP` equivalent, and audit `helpers.ts:203` (`stateIncome = nonSSIncome + ltcgIncome`)
so the state base also excludes taxable SS for SS-exempt states.

---

## 2. ☐ UTC date-only off-by-one in income/expense active-window math
**Severity:** High · **File:** `src/components/Objects/Expense/models.tsx:807-826` and `src/components/Objects/Income/models.tsx` (`getIncomeActiveMultiplier`, parallel ~807-826)

`getExpenseActiveMultiplier` / `getIncomeActiveMultiplier` read date-only values with **local**
`.getFullYear()` / `.getMonth()`, but those dates come from `parseDate`, which the in-tree oracle
(`modelUtils.test.ts:15-18`) documents and asserts returns **UTC** dates ("use getUTC methods for local
date comparison").

**Failure (negative TZ, e.g. America/New_York):** startDate `2030-01-01` → 2029-12-31 local → `startYear=2029`,
`getMonth()=11` → counted 1 month in 2029 (year before it exists) + full 2030 = 13 months. `2025-06-01` →
May → 8 months instead of 7. Bites the common 1st-of-month / Jan-1 start/end dates. `IncomeClassifierDateFilter.test.ts:67`
hard-codes the buggy 7-month count (source-vs-test disagreement — flag it).

**Fix:** Use `getUTCFullYear()` / `getUTCMonth()` in both multipliers to match `parseDate`'s UTC contract.
Audit the `isExpenseActiveInCurrentMonth` / `isIncomeActiveInCurrentMonth` variants (they mix UTC-parsed
dates with a local `new Date()` "now") and make the comparison consistent.

---

## 3. ☐ 0% APR mortgage produces NaN (missing guard)
**Severity:** High · **File:** `src/components/Objects/Expense/models.tsx:375`

`calculateAnnualAmortization` lacks the `apr === 0` guard that the constructor (line 269) and
`calculatePrincipalAndInterest` (line 350) both have. With `apr=0`, `monthlyRate=0`, line 375 evaluates
`balance * (0*1)/(1-1)` = `0/0` = **NaN**.

**Failure:** A 0% mortgage (supported input) → `standardMonthlyPI`/`targetMonthlyPayment` NaN → all of
`totalInterest`/`totalPrincipal`/`totalPayment` NaN → poisons every consumer (SimulationEngine, deductions,
SpendingStrategy, MilestoneEvaluator); the whole sim's expense/tax numbers go NaN.

**Fix:** Mirror the constructor's guard — when `monthlyRate === 0`, use straight-line
`starting_loan_balance / numPayments`.

---

## 4. ☐ ESPP gross-up omits ordinary-income (bargain-element) tax
**Severity:** Medium-High · **File:** `src/services/simulation/WithdrawalPlanner.ts:935`

`estimatedGross = remainingNetNeeded / (1 - gainRatio*ltcgRate)` sizes the sale as if all tax were LTCG,
but the actual tax (968-970) is `esppOrdinaryIncome*(marginal+state) + esppLTCG*ltcgRate`. The ordinary tax
on the bargain element is omitted from the denominator.

**Failure:** Disqualifying lot worth $10k with $3k ordinary bargain element → net received ≈ $9.7k vs $10k
needed; the shortfall cascades to the next account or becomes `unfundedDeficit`. `gainRatio` also includes
the bargain element, so the lower LTCG rate is wrongly applied to ordinary-taxed income.

**Fix:** Size the gross-up against the blended effective rate (ordinary portion at `marginal+state`, gain
portion at `ltcgRate`), e.g. derive a per-dollar tax fraction from the lot mix, or iterate like the
Traditional/Roth gross-ups do.

---

## 5. ☐ `returnRates.ror || default` falsy-zero
**Severity:** Medium-High · **File:** `src/services/simulation/YearSolver.ts:305`

`const grossRoR = input.assumptions.investments.returnRates.ror || (DEFAULT_GROWTH_RATE * 100);` — an
explicit `ror = 0` (valid zero-growth stress test) becomes 7%.

**Failure:** With `ror=0`, `grossRoR = 700` → `growthRate ≈ 0.0699`; `calculateDynamicConversionCeiling`
compounds the Traditional balance at ~7%, overstating the projected balance / peak-RMD bracket and
oversizing conversions.

**Fix:** Use `?? (DEFAULT_GROWTH_RATE * 100)`.

---

## 6. ☐ Roth `conversionHistory` drained proportionally instead of FIFO
**Severity:** Medium · **File:** `src/components/Objects/Accounts/models.tsx:256-264`

On any Roth withdrawal, `increment()` shrinks every `conversionHistory` entry and `costBasis` by
`gross/amount` (blended), contradicting the planner's IRS FIFO ordering (contributions → conversions →
earnings; see `grossUpRoth`). Brokerage lots got real FIFO (line 271+); Roth conversions didn't.

**Failure:** Roth IRA with $50k contribution basis + a 2-yr-old $30k conversion; $10k withdrawal taken
entirely from contribution basis by the planner — but `increment` still erases ~12.5% of the conversion
entry. Across years this corrupts the 5-year-rule clock → wrong future early-withdrawal penalties for
conversion-ladder retirees.

**Fix:** Drain `conversionHistory`/basis in FIFO order matching the planner: deplete contribution basis
first, then oldest conversions, then earnings — rather than proportionally. (Coordinate with how the planner
reports which tranche it tapped.)

---

## 7. ☐ Multiple Roth IRA accounts each receive the full annual limit
**Severity:** Medium · **File:** `src/services/simulation/SurplusAllocator.ts:243`

`contributionRoom = rothIRALimit - rothIRAContributedThisYear` is recomputed per bucket, but
`rothIRAContributedThisYear` is fixed (caller passes 0) and never incremented when an allocation is made
(line 260 only decrements the surplus pool `remaining`).

**Failure:** One person with two Roth IRA accounts in priority buckets + ample earned income/surplus
contributes up to the limit to *each* → e.g. $14,000 vs the $7,000 per-person aggregate IRS limit.

**Fix:** Track running Roth-IRA contributions across buckets within the pass and subtract from the shared
limit (a local accumulator incremented on each Roth IRA allocation).

---

## 8. ☐ VA senior (65+) deduction applied inconsistently on the itemized path
**Severity:** Medium · **File:** `src/components/Objects/Taxes/taxService/stateTax.ts:93` and `:101`

`calculateUnifiedStateTax` adds `seniorDeductionAmount` to the itemized deduction (lines 195/201), but
`calculateStateTax` does not (lines 93/101) — only its standard path adds it (line 84).

**Failure:** VA resident, 67, `deductionMethod: 'Itemized'`: a no-withdrawal year (→ `calculateStateTax`)
and a with-withdrawal year (→ `calculateUnifiedStateTax`) apply different deductions to the same person —
a ~$12k+ swing in VA taxable income depending only on whether a withdrawal/conversion exists. (VA is the
only state with `seniorDeduction`.)

**Fix:** Add `+ seniorDeductionAmount` to the itemized deduction in `calculateStateTax`'s Auto-itemized
(line 93) and manual-itemized (line 101) branches, mirroring `calculateUnifiedStateTax`.

---

## 9. ☐ ACA-cliff Roth substitution mutates / diverges from pooled conversion list
**Severity:** Medium · **File:** `src/services/simulation/WithdrawalPlanner.ts:661`

The ACA look-ahead passes the live `rothSnapshot.conversionHistory` into `grossUpRoth`, which mutates entry
`.amount` in place (line 417), while the main loop drains a separate `pooledRothConversions` array (line 551).
The two views diverge. (The code's own TODO at 655-657 flags the staleness.)

**Failure:** Under-59.5, ACA-aware retiree whose Roth has a recent conversion layer: the ACA substitution
consumes a conversion (charging 10% penalty) by mutating `conversionHistory`, but `pooledRothConversions`
still shows it available → the main-loop pass can withdraw it again; penalty/availability double-count.

**Fix:** Have the ACA path consume from (and decrement) the same `pooledRothConversions` source the main
loop uses, or pass copies and reconcile, so conversion dollars aren't double-counted.

---

## 10. ☐ `MULTIPLE_OF_EXPENSES` cap ignores same-year inflows
**Severity:** Medium-Low · **File:** `src/services/simulation/SurplusAllocator.ts:187`

`bucketCap = max(0, monthlyExpenses*capValue - account.amount)` subtracts only the start-of-year balance,
ignoring contributions/prior allocations that also land in the account this year.

**Failure:** Target "6 months" = $30k, `account.amount` $20k, but $8k of payroll/other inflows also arrive
this year → allocates the full $10k of computed room → ends at $38k vs the intended $30k target.

**Fix:** Account for inflows already routed to this account this year (and prior in-pass allocations) when
computing remaining room toward the target balance.

---

## 11. ☐ No §415(c) combined employee+employer 401k cap
**Severity:** Medium-Low · **File:** `src/data/ContributionLimits.ts:100` (enforcement at `src/services/simulation/AccountGrowth.ts:52-57`)

`get401kLimit` returns only the elective-deferral limit; nothing caps employee + employer additions to the
§415(c) annual-additions limit (~$70k 2025), so employer match can push total contributions past the IRS limit.

**Failure:** Salary $400k, 10% match, no `employerMatchMax` → ~$40k match added unconstrained on top of a
maxed $23.5k deferral = $63.5k+, with no clamp.

**Fix:** Add a §415(c) annual-additions constant and clamp total (employee + employer) additions to it in
the contribution path. (Confirm whether the app intends to model this before enforcing — flag if uncertain.)

---

## 12. ☐ RMD computed on full balance but capped at vested → phantom penalty
**Severity:** Low · **File:** `src/services/simulation/RMDService.ts:70` & `:83`

`rmdAmount = calculateRMD(priorYearBalance /* full account.amount */, currentAge)` but
`availableBalance = account.vestedAmount`, so `actualWithdrawal = min(rmd, vested)`. When vested < rmd
(unvested employer money), a shortfall + 25% penalty is fabricated.

**Failure:** Traditional 401k $500k entirely unvested → rmd ≈ $20,325, withdrawal 0, penalty ≈ $5,081 every
RMD year. Rare (RMD-age accounts are usually fully vested), hence an untested edge.

**Fix:** Base the RMD requirement on the same balance basis used for the withdrawal cap (vested), or document
the simplification. Resolve the full-vs-vested inconsistency.

---

## 13. ☐ FERS supplement not prorated in partial start/end years
**Severity:** Low · **File:** `src/components/Objects/Income/models.tsx:692-696`

`getTotalAnnualAmount` prorates the base benefit via `getAnnualAmount(year)` but adds the **full**
`fersSupplement`.

**Failure:** FERS pension starting July 1 (multiplier 0.5), benefit $30k, supplement $18k → returns
$15k + $18k = $33k, overstating that year's pension income by $9k. Consumed by `IncomeClassifier:63` and
`CashflowDetailBuilder:117`.

**Fix:** Apply the same active-year multiplier to `fersSupplement` as to the base.

---

## 14. ☐ 2024 federal Social Security wage base is wrong
**Severity:** Low (past year) · **File:** `src/data/TaxData.tsx:83`

`socialSecurityWageBase: 176100` in the 2024 block (Single brackets ending 609350 / cap-gains 47025/518900
confirm it's 2024). The actual 2024 wage base was **$168,600**; 176,100 is the 2025 figure.

**Failure:** 2024 earned income $200k → SS tax $10,918 vs correct $10,453 (overcharged $465). Only affects
2024 (backtests); 2025 = 176100 is correct.

**Fix:** Set the 2024 entry to `168600`. (Verify the 2026 entry against the published figure while here.)

---

## 15. ☐ Duplicate RMD divisor table + bad >95 extrapolation
**Severity:** Low (cleanup + minor correctness) · **File:** `src/services/simulation/TaxOptimizedWithdrawal.ts:150`/`:195`

A second hardcoded `RMD_DIVISORS` table duplicates `RMDData.ts`'s Uniform Lifetime Table, and `getRMDDivisor`'s
out-of-range extrapolation (`max(1.0, 8.9-(age-95)*0.9)`) diverges sharply from canonical values: age 100 →
4.4 vs IRS 6.4 (+31% RMD); age 104+ → 1.0 vs 4.9 (~5×).

**Failure:** `calculateDynamicConversionCeiling` (line 1072) uses this divisor while RMDService/RothConversionDP
use `RMDData`'s table — drift risk + overstated late-age RMD in the conversion ceiling.

**Fix:** Replace the local table/`getRMDDivisor` with `RMDData.ts`'s `getDistributionPeriod`/`calculateRMD`
so there's a single source of truth.

---

## Notes (follow-ups) — resolved 2026-06-07

All landed on `main` across commits `fd93dc7` (15 findings), `ff43b13` (tax data + cleanup),
`f902787` (dead-code removal). Full tree verified each time: `tsc -b` clean; final `vitest 3307 passed / 0 failed`.

- ☑ **MILESTONE_PLUS — NOT a bug.** Verified on the full tree: `useSimulation.tsx:188-189` populates
  `milestoneReachYears` and threads it forward, so `MILESTONE_PLUS` works. The "broken" appearance was an
  artifact of `useSimulation.tsx` being stripped from the review branch. Removed the dead `_age`-key lookup
  branch in `MilestoneEvaluator` (the year-difference derivation was always the real path).
- ☑ **CA 2024 → $0 state tax** — fixed: state-tax lookup now falls back to the nearest year present in a
  state's table when `getClosestTaxYear` resolves to a year that state lacks.
- ☑ **2026 SS wage base** — set to $184,500 (SSA-announced; the three 2026 federal entries were copied from 2025).
- ☑ **Stale `helpers.ts` SS TODO** — replaced (the double-count it described was resolved by the conversion fix).
- ☑ **Dead/duplicated code — removed (with tests, per decision to take the thorough path).**
  `calculateGrossWithdrawal` (whole `withdrawalGrossUp.ts`), `SpendingStrategy.enforceSpendingCap`
  (+ orphaned `calculateTotalLivingExpenses`), `helpers.estimateTraditionalWithdrawalForExpenses`, and
  `RMDService`'s `fedTaxIncrease`/`stateTaxIncrease` outputs + their tax computation (trimmed the now-unused
  `allIncomes`/`taxState`/`preTaxDeductions` params and updated the `SimulationEngine` call site). ~51 tests
  removed alongside. **Kept** `applyProsperitySpending` and `calculateTotalDiscretionary` (the latter is used
  in production) and their tests.

### 2026 federal figures — fully verified 2026-06-07 (commit `9d2cdcc`)
Checked against IRS Rev. Proc. 2025-32 / Tax Foundation:
- ☑ Ordinary brackets (Single/MFJ/MFS, all rates) — correct.
- ☑ Standard deduction (16,100 / 32,200 / 16,100) — correct.
- ☑ SS wage base (184,500) — correct (fixed earlier).
- ☑ **Long-term capital-gains thresholds — were pre-release estimates; FIXED** to
  Single 49,450/545,500 · MFJ 98,900/613,700 · MFS 49,450/306,850.
