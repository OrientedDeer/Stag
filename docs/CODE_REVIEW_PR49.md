# Code Review — PR #49 (simulation core)

`/code-review max 49` — Stag simulation core scoped review.

- **Scope:** 39 source files, ~16.4K LOC (`review-base-2...review/sim-core-2`). Reviewed against the working tree, which is byte-identical to PR #49's head.
- **Method:** 9 independent finder angles → line-level verification by reading the actual code → gap sweep.
- **Tests:** used as a behavioral oracle only. No test-change recommendations; source/test disagreements are flagged as questions.
- **Date:** 2026-06-07

Findings are ranked, correctness only. File references are `path:line`.

---

## Findings

### 1. ESPP withdrawals create money from nothing — HIGH
`src/components/Objects/Assumptions/SimulationEngine.tsx:49`

`executeYearPlan`'s deduction guard only matches `InvestedAccount`/`SavedAccount`, so an `ESPPAccount` withdrawal hits `continue` and `userInflows[espp]` is never decremented. `growAccounts` (`AccountGrowth.ts:239-250`) only grows ESPP + adds lots, and `removeSoldShares` (`models.tsx:630`) has zero callers. The planner fully sells ESPP and books the cash + tax (`WithdrawalPlanner.ts:62,927-985`).

→ With an ESPP account in the withdrawal order, it funds spending every year while its balance is never reduced (and keeps compounding) — phantom cash, overstated net worth and plan survival.

### 2. Milestones double-count every linked loan — HIGH
`src/services/simulation/MilestoneEvaluator.ts:31,40` (and `82,89`)

A financed home creates **both** a `PropertyAccount.loanAmount` and a linked `MortgageExpense.loan_balance` (`AddAccountModal.tsx:133-144`), kept in sync by `AccountGrowth.ts:196`; a debt creates both `DebtAccount.amount` and a `LoanExpense.amount` (`AddAccountModal.tsx:145-151`). `calculateNetWorth`/`calculateTotalDebt` count both sides.

→ $300k mortgage ⇒ net worth understated $300k, total debt doubled; net-worth / debt-free / FI milestones fire years off (and cascade into anything those milestones gate).

### 3. Capital-gains brackets are frozen after the last data year — HIGH
`src/components/Objects/Taxes/taxService/parameters.ts:97-110`

For `year > max_year` with `inflationAdjusted`, ordinary `brackets`, `standardDeduction`, and `socialSecurityWageBase` are inflated but `capitalGainsBrackets` is carried un-inflated via the spread.

→ A retiree living on LTCG who is in the 0% bracket in real terms gets pushed to 15% in nominal terms in every projected year — over-taxes gains across the whole multi-decade horizon. Flows through every federal tax call.

### 4. HSA is drained first, then penalized — MEDIUM-HIGH
`src/services/simulation/WithdrawalPlanner.ts:86` vs `889`

`hasEarlyWithdrawalPenalty` returns `false` for all accounts at age ≥ 59.5 (the early-return precedes the HSA case), so HSA is ordered as penalty-free; execution charges 20% on HSA until 65.

→ A 60-year-old taps HSA ahead of a genuinely penalty-free Traditional IRA and eats an avoidable 20% penalty.

### 5. Roth-conversion DP caps every year at the year-0 balance — MEDIUM-HIGH
`src/services/simulation/RothConversionDP.ts:866-867`

`maxConversion = determineMaxConversion(currentTradBalance)` and `dC = maxConversion / CONVERSION_BUCKETS` are computed once from the starting Traditional balance.

→ Start at $400k → the grid can never evaluate a yearly conversion above ~$400k even at age 80 when the balance has grown to ~$1.5M; the optimizer silently truncates the optimal plan, defeating its RMD-reduction purpose.

### 6. Taxable Social Security overstated for small benefits — MEDIUM
`src/components/Objects/Taxes/taxService/socialSecurity.ts:79`

In the 85% zone, `tier1Amount` is a flat `(second−first)·0.5` (=$4,500) but the IRS worksheet caps it at `min(0.5·SS, 4,500)`.

→ Single, SS=$6,000, other income=$31,000 → code returns $4,500 taxable vs IRS $3,000. Bites whenever annual benefits < ~$9k single / $12k MFJ — including the partial first claiming year for many filers.

### 7. "Simple"-interest loans don't match their own amortization — MEDIUM
`src/components/Objects/Expense/models.tsx:607` vs `549-550`

`increment()` accrues interest for any `apr>0`, but `calculateAnnualAmortization()` accrues interest only for `'Compounding'`. `'Simple'` is the reconstitution default (`models.tsx:1037`).

→ A Simple loan's balance trajectory (increment) and the engine's reported principal/interest split diverge, and a tax-deductible Simple loan reports **$0 deductible interest** while really paying interest.

### 8. The same home appreciates at two different rates — MEDIUM
`src/components/Objects/Expense/models.tsx:312`

`MortgageExpense.valuation` grows by `housingAppreciation + generalInflation`, but the linked `PropertyAccount` grows by `housingAppreciation` only (`Accounts/models.tsx` ~776).

→ Property tax, PMI drop-off, maintenance, and insurance (all `%` of valuation) drift above the home's net-worth value every year; PMI auto-removes too early.

### 9. Lifestyle creep is ~12–26× too small — MEDIUM
`src/services/simulation/SpendingStrategy.ts:67`

`realRaise = prevInc.amount * salaryGrowthRate` uses the **per-period** salary, but `lifestyleCreepAmount` is divided into **annual** discretionary (lines 78-84). `applyLifestyleCreep` is live (`SimulationEngine.tsx:259`).

→ A Monthly-frequency salary ($100k as $8,333/mo) with 3% growth and 100% creep raises discretionary by ~$250/yr instead of ~$3,000/yr. (Tests only use `Annually`, so they miss it.)

### 10. FERS supplement is computed but never paid — MEDIUM (niche)
`src/components/Objects/Income/models.tsx:692`

`getTotalAnnualAmount()` (the only method that adds `fersSupplement`) has **no callers**; every consumer uses `getAnnualAmount()` = base annuity only.

→ A FERS retiree at MRA 57 with an $18k/yr bridge supplement gets $0 of it in spendable/taxable income for ages 57-62.

### 11. No Additional Medicare Tax — MEDIUM
`src/components/Objects/Taxes/taxService/ficaTax.ts:27`

Medicare is a flat `taxableBase × 1.45%`; the 0.9% surtax above $200k single / $250k MFJ is missing.

→ $400k W-2 single: FICA understated by $1,800/yr, growing and uncapped with wages.

### 12. FERS/CSRS auto-High-3 never recomputes — MEDIUM (niche)
`src/services/simulation/IncomeProjection.ts:100`

The recompute is gated on `inc.calculatedBenefit === 0`, but `AddIncomeModal.tsx:198-202` seeds it with a non-zero estimate even when `autoCalculateHigh3` is on.

→ The pension stays pinned to today's-salary estimate (COLA-grown); a user retiring in 20 years has their High-3 understated by ~two decades of raises. (Tests construct it with `0`, so the dead branch looks covered — source/test disagreement, not a test fix.)

### 13. Roth DP ignores state tax on Social Security — MEDIUM
`src/services/simulation/RothConversionDP.ts:547`

`computeYearTax` passes only `ordinaryIncome + ltcgIncome` to the state-tax calc, never SS.

→ In states that tax SS, a conversion that raises taxable SS incurs real state tax the DP can't see, so it under-prices and over-recommends conversions.

### 14. Roth-401k conversion basis erodes across solver iterations — MEDIUM
`src/services/simulation/WithdrawalPlanner.ts:416` + `836`

`grossUpRoth` mutates `conv.amount` in place (intentional intra-year), but YearSolver builds `accountSnapshots` once (`YearSolver.ts:1427`) and calls `planWithdrawals` repeatedly in the convergence loop (`YearSolver.ts:1514`); the `roth_401k` path shares the snapshot's `conversionHistory` objects (shallow copy at 836).

→ Across iterations the conversion basis shrinks, so penalty-free Roth-401k conversion dollars get re-taxed/penalized as earnings.

### 15. Missing SECURE 2.0 age 60–63 super catch-up — MEDIUM-LOW
`src/data/ContributionLimits.ts:103`

`get401kLimit` adds only the flat 50+ catch-up; ages 60-63 get ~$11,250 in real life.

→ An auto-maxing 61-year-old under-contributes ~$3,750/yr, understating the Traditional balance and later RMDs.

---

## Real but below the top-15 cut (verified, mostly medium/low)

- `WithdrawalPlanner.ts:529` — `getStateRate` counts state-exempt SS in the bracket position.
- `helpers.ts:169` — `calculateEffectiveConversionTax` double-counts taxable SS in the torpedo sub-calc.
- `WithdrawalPlanner.ts:933` — ESPP gross-up reserves only LTCG tax, not the ordinary-income portion.
- `YearSolver.ts:305` — `returnRates.ror || 7%` turns a legitimate 0% assumption into 7%.
- `YearSolver.ts:1267` — GK "prosperity" raise is unreachable (`Math.min(totalLivingExpenses, gkBudget)`), with now-dead handling at `SimulationEngine.tsx:441-449`.
- `YearSolver.ts:686` — ACA MAGI estimate uses pre-GK-trim expenses.
- `stateTax.ts` — senior deduction differs between the with/without-withdrawal paths (`calculateStateTax` vs `calculateUnifiedStateTax`).
- `RMDService.ts:61` — prior-year balance falls back to the current (grown) balance when the prior account isn't found.

## Cleanup (not bugs)

- `TaxOptimizedWithdrawal.ts:150` — a second RMD divisor table (covers only 72-95, extrapolates) duplicating canonical `RMDData.ts`.
- Duplicated LTCG-rate walkers (`YearSolver` ↔ `WithdrawalPlanner`).
- Amortization formula copy-pasted ~6× in `Expense/models.tsx` with an inconsistent 0%-APR guard.
- ~150 lines duplicated between `planConversion` and `planConversionDP`; surplus-allocation block duplicated across `solveRetirementYear`/`solveWorkingYear`.
