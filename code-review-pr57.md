# PR #57 Review — domain models + simulation orchestration

Scope reviewed: `Accounts/models.tsx`, `Income/models.tsx`, `Expense/models.tsx`,
`modelUtils.ts`, `Assumptions/{AssumptionsContext,MonteCarloContext,SimulationContext,SimulationEngine,useSimulation}.tsx`.
Effort: xhigh (9 finder angles + verify + sweep). Reviewed source ≈ `main`
(SimulationEngine already carried the PR #56 `ordinaryTax` fix).

Status legend: ☐ open · ☑ fixed (test-backed) · ◇ cleanup (no failing test) · ⏸ deferred

## Resolution (2026-06-11)

Fixed test-first via 4 file-disjoint sub-agents + a reconciliation pass. Final
state: **3425 tests pass under default, `Australia/Sydney` (+UTC), and
`America/New_York` (−UTC)**; `tsc -b` clean; no new lint (only pre-existing
`react-refresh/only-export-components`).

- **#1 ☑** Date convention unified to LOCAL everywhere. Readers `getUTC*`→`getFullYear()/getMonth()` in `Expense/models`, `Income/models`, `SimulationEngine:548`, `MilestoneEvaluator:130-131`; `Date.UTC` date-only creation → `new Date(y,m-1,d)` in `Income/models:807`, `incomeFormTypes:59`, `IncomeProjection.ts`. ESPP lot dates (`AccountGrowth`) left as-is (consumed via `getTime()` diffs, TZ-agnostic). Proven by full-suite runs in both ± UTC zones.
- **#2 ☑** `LoanExpense.getAnnualAmount(year)` now returns `calculateAnnualAmortization(year).totalPayment` (capped); `getMonthlyAmount` delegates to it.
- **#3 ☑** FERS supplement no longer `*(1+cola)`. (Latent: `getFERSCOLA` returns 0 under 62, so it never actually grew — fix kept as a guard against future COLA changes.)
- **#4 ☑ / #8 ☑** Goal funding + purchase loops iterate `milestoneFilteredExpenses`; funding assigns the per-account total ONCE per unique fund id (helper now sums all goals on the account) — fixes both the milestone bypass and the shared-account double-count. Engine test proves the double-count guard by temporary revert.
- **#5 ☑** `MortgageExpense.calculatePayment()` PMI now LTV-gated like the constructor.
- **#6 ◇ REFUTED** No off-by-one: `increment(year, currentAge)` zeroes the supplement in the SAME year `currentAge>=62`. Regression test kept.
- **#7 ☑** `PropertyAccount` increment + reconstitute now pass `apr`.
- **#9 ☑** `reconstituteAccount` uses `!= null` for `customROR` (Invested + ESPP).

New tests: `Accounts/models-bugs-7-9.test.tsx`, `Expense/bugs.test.tsx`,
`services/simulation/GoalFundingMilestone.test.ts`. Corrected pre-existing tests
that encoded the false "UTC-midnight storage" premise (`modelUtils.test.ts`,
`IncomeClassifierDateFilter.test.ts`, `GoalFundingGateUtcYear.test.tsx`,
`Income/models.test.tsx`, `IncomeProjection.test.ts`, `Expense/models.test.tsx`)
to construct LOCAL dates — same assertions, now TZ-robust.

Cleanups #10–#15 NOT done (no failing test; out of scope for this pass).

---

## Correctness findings

### 1. ☐ Date convention is inverted (systemic, latent for US users)
`parseDate` (`modelUtils.ts:29`) builds **local-midnight** dates, but the window
readers across the model files use `getUTCFullYear()/getUTCMonth()` — and the
inline comments claim the opposite ("parseDate returns UTC dates"). Creation is
itself split: `Date.UTC(...)` in `incomeFormTypes.ts:59`,
`Income/models.tsx:807` (`calculateSocialSecurityStartDate`),
`IncomeProjection.ts` (SS start/end), `AccountGrowth.ts:123-124` (ESPP lots);
local `new Date(y,m-1,d)` in `parseDate` and the expense/TriggerSelector forms.

- Correct for **negative-UTC** (Americas) — which is why it works for the current user.
- Wrong for **positive-UTC** (Europe/Asia/Australia): a `YYYY-01-01` value rolls
  back to the prior year/month, shifting every active-income/expense window, goal
  due-year, and goal funding window.
- The Vitest suite runs in UTC (local == UTC), so it structurally cannot catch this.

Readers affected: `getExpenseActiveMultiplier:826`, `isExpenseActiveInCurrentMonth`,
`isGoalDueInYear:932`, `getGoalFundMonthlyCap:965`, `goalMonthsActiveInYear:983`,
`monthsBetween/getGoalMonthlySetAside`, `LoanExpense`/`MortgageExpense`
amortization date reads; `getIncomeActiveMultiplier`, `isIncomeActiveInCurrentMonth`.

**Convention to adopt (per repo memory):** local everywhere — readers use
`getFullYear()/getMonth()`, all date-only creation uses `new Date(y,m-1,d)`. Must
be made **consistent per file** (a half-conversion that leaves one side `Date.UTC`
and the other local would regress negative-UTC / the current user). Prove with TZ
overrides in BOTH `America/New_York` (no regression) and `Australia/Sydney` (fix).

### 2. ☐ `LoanExpense.getAnnualAmount` is uncapped → Sankey imbalance in payoff year
`Expense/models.tsx:683` returns `payment × activeMonths` with no payoff cap. The
solver totals loans via `calculateAnnualAmortization().totalPayment` (capped,
`SimulationEngine:287`), but `CashflowDetailBuilder.ts:173` uses `getAnnualAmount`
for loans (only Mortgage is special-cased). In any loan's payoff year the Sankey
Expenses node overstates vs the solver's living-expense total — the exact
"category sum must equal living expenses" invariant the builder relies on.
Fix: make `getAnnualAmount` (and `getMonthlyAmount`) derive from
`calculateAnnualAmortization(year).totalPayment` so all consumers agree.

### 3. ☐ FERS Annuity Supplement grows with COLA
`Income/models.tsx:668`: `newSupplement = currentAge >= 62 ? 0 : this.fersSupplement * (1 + cola)`.
The real FERS supplement receives **no** COLA. Compounding ~CPI overstates pre-62
bridge income every year. Fix: drop the `* (1 + cola)` factor.

### 4. ☐ Goal funding/purchase loops bypass the milestone filter
`SimulationEngine.tsx:274` (funding) and `:544` (purchase) iterate the unfiltered
`expenses`, while living expenses use `milestoneFilteredExpenses` (`:235`). A goal
gated by a start/end milestone is therefore funded and purchased outside its
milestone window, and its set-aside can diverge from the Sankey's filtered list.
Fix: iterate the milestone-filtered set in both loops (and pass the filtered list
to `getGoalFundAnnualSetAside`).

### 5. ☐ `MortgageExpense.calculatePayment()` adds PMI unconditionally
`Expense/models.tsx:441` computes `valuation*pmi/12` with no LTV gate, unlike the
constructor (`:277`) and `increment` (`:322-329`) which drop PMI at ≤80% LTV. For
a >20%-equity mortgage that carries a PMI rate, the recomputed payment (e.g. via
`ExpenseCard.tsx:146` on edit) is inflated. Fix: gate PMI on `loan_balance/valuation > 0.8`.

### 6. ☐ FERS supplement paid through the age-62 year (off-by-one)
`increment` zeroes the supplement only for the year **after** `currentAge >= 62`,
but `getTotalAnnualAmount` (`:698`) still pays the full (COLA-grown) supplement in
the age-62 year. Result: ~one extra year of the bridge. Tie the cutoff to the same
age basis so the supplement stops at 62.

### 7. ☐ `PropertyAccount` drops `apr` on increment and reconstitute
`Accounts/models.tsx:834` (`increment`) and `:992` (`reconstituteAccount`) rebuild
the account with only 7 of 8 constructor args, omitting `apr` (defaults to 0). A
user-set property APR silently reverts every sim year and on reload. (Currently
`apr` isn't consumed by the engine, so observable impact is UI/future-use only —
but it's a real constructor-arg drift.) Fix: pass `this.apr` / `Number(data.apr)`.

### 8. ☐ `getGoalFundAnnualSetAside` double-counts when two goals share a fund account
`Expense/models.tsx:1008` resolves the goal via `expenses.find()` by
`goalAccountId`, returning the FIRST match. If two goals share one fund account the
engine loop adds the first goal's set-aside twice and ignores the second. Fix: sum
the set-asides of all goals targeting the account (or document one-goal-per-account
as an invariant and enforce it).

### 9. ☐ `reconstituteAccount` coerces `customROR: null` to a hard 0%
`Accounts/models.tsx:963` (and ESPP `:984`): `data.customROR !== undefined ? Number(...) : undefined`
turns a persisted/imported `null` into `Number(null)=0` — a 0% custom return
instead of "use global ROR". Fix: use `!= null` (covers null and undefined).

---

## Cleanup findings (no failing test; lower priority)

- **10. ◇** `reconstitute{Account,Income,Expense}` hand-roll id/name/amount instead of the existing `modelUtils.extractBaseFields()` (`Accounts:934`, `Income:913`, `Expense:1121`).
- **11. ◇** The amortization formula + 0%-APR guard is copy-pasted 5× in `MortgageExpense` (`:270,:432,:472,:502`) instead of delegating to the private `calculatePrincipalAndInterest()` (`:353`).
- **12. ◇** `getExpenseActiveMultiplier`/`isExpenseActiveInCurrentMonth` are line-for-line duplicates of the Income equivalents; extract one shared helper in `modelUtils`.
- **13. ◇** `WorkIncome.increment` ESPP `'PERCENTAGE'` branch (`Income:232-234`) is a no-op (assigns the value it already holds).
- **14. ◇** Per-year hot-path scans in `SimulationEngine` (`goalFundIds` rebuild `:349`, `accounts.find` per withdrawal, `getBirthYear` milestone scan) — hoist out of the year loop / use a `Map` (matters at N years × M Monte Carlo trials).
- **15. ◇** `LoanExpense.getMonthlyAmount` (`:687`) recomputes `getProratedAnnual(this.payment)/12` instead of delegating to `getAnnualAmount(year)/12`.

---

## Refuted / by-design (checked, not bugs)

- `CLASS_TO_CATEGORY[exp.constructor.name]` is safe — `vite.config.ts` sets `keepNames: true`.
- InvestedAccount `lots` not restored on reconstitute is **by design** (sim-internal; ESPP lots ARE persisted).
- `getTotalAnnualAmount` returning 0 when `base <= 0` is correct (pension inactive — don't pay the supplement before the annuity starts).
- `age || this.retirementAge` falsy-zero (`Income:662`) is untriggerable — `age` is always threaded as a positive int via `IncomeProjection.ts:136`.
- `mergeSection` typeof guard and `autoMax401k || 'custom'` only misfire on corrupt/undefined-default data — effectively by-design.
</content>
