# Code Review — PR #53 (`review/sim-core-6`)

**Scope:** simulation engine + Roth + tax/data/model closure — 38 new source files, ~16.5k lines.
**Effort:** max (9 finder angles by subsystem + gap sweep, then line-level verification).

## Setup caveat
This PR is a **static-review scaffold**: the source files are added against a "tests-only" base,
but the tree is missing dependency files (`modelUtils`, `hooks/`), so the behavioral-oracle suite
**cannot run** here (only leaf tests like `RMDData` execute). Nothing below is validated against a
passing test — these are static findings, ranked by severity, with confidence labels.

---

## Resolution (applied to `main`, full suite green: 114 files / 3342 tests)

Each bug was handed to an isolated worktree agent to verify → judge the fix →
write a red/green test → fix. After integrating all branches, the full suite
caught two fixes that broke established behavior; both were reverted.

| # | Bug | Disposition | Commit |
|---|-----|-------------|--------|
| 1 | LTCG / unused std deduction | **Fixed** (also corrected 5 tests that encoded the bug) | `987fbb3` |
| 2 | Surplus dropped | **Reverted → works-as-designed** — caps pace saving; excess is discretionary spend, surfaced as `unallocated`. Force-filling a capped bucket broke FIXED/MAX caps + sinking funds. | `09e60c3`, `5f70bc4` |
| 3 | LTCG rate off gross income | **Reverted → won't-fix** — taxable-income lookup returns the 0% *floor* rate and under-withdraws when gains spill into 15%; gross is a conservative proxy. A real fix needs blended-rate stacking. | `c92194b`, `5f70bc4` |
| 4 | RMD penalty never applied | **Fixed** | `09e60c3` |
| 5 | Mortgage/loan amortization local dates | **Fixed** (→ UTC) | `eb9007b` |
| 6 | Ceiling drops FERS supplement | **Fixed** | `09e60c3` |
| 7 | Stale state marginal rate | **Fixed** | `c92194b` |
| 8 | isActive / monthsUntilPaidOff local dates | **Fixed** (→ UTC) | `eb9007b` |
| 9 | Brokerage gains all long-term | **Deferred — needs cross-file** (snapshot carries only avg `gainRatio`; YearSolver hardcodes STCG=0). | — |
| 10 | ACA MAGI frozen | **Fixed** | `09e60c3` |
| 11 | Goal funding gate local year | **Fixed** (→ UTC) | `2076aeb` |
| 12 | Mortgage double-count in net worth | **Refuted** — `linkedAccountId` is populated bidirectionally (verified in Add*Modal + serialized data); de-dup is correct. Regression test added. | `b079d3c` |
| 13 | Interest income local dates | **Fixed** (→ UTC) | `6c60fdc` |
| 14 | Unguarded `1/(1-rate)` gross-up | **Fixed** (`grossUpDivisor` floor) | `c92194b` |
| 15 | `getMarginalTaxRate` empty-bracket crash | **Fixed** (guard; latent today) | `1388ae1` |

**Net: 11 fixed, 2 reverted (by-design / net-negative), 1 refuted, 1 deferred.**
Every fix shipped with a red→green test; reverts (#2/#3) are documented with NOTE
comments in the source so they aren't re-flagged.

---

## Findings

### 1. [Confirmed · High] `bracketTax.ts:83,103` — unused standard deduction never offsets LTCG
`taxableOrdinary = max(0, adjustedOrdinary − standardDeduction)` floors at 0, then LTCG stacks from
that floor. When ordinary income < the standard deduction, the leftover deduction is lost.
Single/2024, ordinary $10k + LTCG $50k → engine returns **$446** LTCG tax; correct is **$0**
(taxable income $45.4k < the $47,025 0%-bracket top). The line-80 comment states this as intent, but
it's IRS-incorrect — and this is the authoritative engine used for Roth-conversion cost, withdrawals,
and milestones. Hits low-ordinary-income retirees living off brokerage gains.

### 2. [Confirmed · High] `SurplusAllocator.ts:370` → `YearSolver.ts:1732,1926` — surplus silently dropped
Leftover surplus is returned as `unallocated`, but the caller only reads `.allocations`. When the only
brokerage/savings account is a priority bucket whose cap is reached, Steps 3–4 skip it
(`!bucketAccountIds.has`) and the remainder vanishes from net worth. A `$2k/mo` ($24k) FIXED-cap
brokerage bucket with $30k surplus drops **$6k every year**, compounding.

### 3. [Confirmed · Med-High] `WithdrawalPlanner.ts:577` (helper `capitalGainsTax.ts:19`) — LTCG rate off gross income
`getLTCGRate(runningOrdinaryIncome)` passes **gross** income, but the CG bracket thresholds are on
**taxable** income; the sibling `getMarginalRate` (534) correctly subtracts `standardDeduction`. Near
the 0%/15% boundary this over-states the rate, over-grossing brokerage withdrawals and over-estimating
their tax.

### 4. [Confirmed · Med-High] `RMDService.ts:119` — RMD shortfall penalty never applied
The 25% excise is computed into `rmdDetails.penalty` but never added to tax or cash (YearSolver never
references it). When the vested traditional balance can't cover the RMD (capped at line 80), the real
penalty is ignored, overstating net worth.

### 5. [Confirmed · Med-High] `Expense/models.tsx:359-360, 596,612-613` — amortization uses local date accessors
`MortgageExpense`/`LoanExpense.calculateAnnualAmortization` read UTC-stored dates with **local**
`getFullYear()`/`getMonth()`, while the rest of the file uses `getUTC*` (490, 825, 833, 900). In US
timezones a `YYYY-01-01` start shifts to prior-Dec, so the first/last partial year is off by a month
(or a whole year is dropped/added) — mis-stating interest+principal that feed cashflow, spending need,
FI milestones, and deductible interest. (This is the repo's known recurring off-by-one.)

### 6. [Confirmed · Med] `YearSolver.ts:268` — Roth-ceiling drops FERS supplement
The conversion ceiling sums pension via `getAnnualAmount(year)` (base only), while
`IncomeClassifier.ts:63` and `CashflowDetailBuilder.ts:127` use `getTotalAnnualAmount(year)`
(base + FERS MRA-to-62 supplement). The ceiling under-counts income and sizes conversions too large
for the target bracket.

### 7. [Confirmed · Med] `WithdrawalPlanner.ts:550,578` — stale state marginal rate
`stateRate` is captured once from the initial income and frozen; `marginalRate =
getMarginalRate(runningOrdinaryIncome) + stateRate` updates the federal part as withdrawals raise
income but keeps the stale state rate, under-grossing later HSA/Roth-earnings gross-ups.

### 8. [Confirmed · Med] `Expense/models.tsx:850-863,676-678` + `Income/models.tsx:840` — more local-on-UTC date reads
`isExpenseActiveInCurrentMonth`, `getMonthsUntilPaidOff`, and `isIncomeActiveInCurrentMonth` use local
`getFullYear()`/`getMonth()` on UTC-stored dates — off-by-one at month/year boundaries (active-state
display, loan term → derived payment).

### 9. [Plausible · Med] `WithdrawalPlanner.ts:777` — all brokerage gains taxed as long-term
Hardcodes `{ shortTerm: 0, longTerm: actualLTCG }` via an averaged `gainRatio`, ignoring the account
model's FIFO short/long split (`BrokerageLots`). Short-term gains from recently-bought lots get the
lower LTCG rate. (Impact depends on whether YearSolver taxes off this field or re-derives from the
account.)

### 10. [Plausible · Med] `YearSolver.ts:1501` — ACA MAGI frozen before deficit loop
`currentMAGI` is fixed at base + conversion, excluding the traditional withdrawal + brokerage LTCG the
loop generates, so the ACA-cliff guard under-counts MAGI and can withdraw past the subsidy cliff it's
meant to protect.

### 11. [Plausible · Med] `SimulationEngine.tsx:341` — goal funding gate local vs UTC
Funding gate uses local `getFullYear()` on a UTC goal date while `isGoalDueInYear` (928) uses
`getUTCFullYear()`; a `YYYY-01-01` target reads as prior-year in US timezones, zeroing the goal's
funding a year before the purchase fires → underfunded.

### 12. [Plausible · Med] `MilestoneEvaluator.ts:44-46` — mortgage loan double-counted in net worth
The de-dup keys off `account.linkedAccountId` (account→expense), but linkage is populated as
`expense.linkedAccountId`→account (the direction `AccountGrowth.ts:217-220` uses). A property with both
a PropertyAccount `loanAmount` (line 34) and a linked MortgageExpense (line 53) double-counts the loan,
skewing NET_WORTH/FI milestones.

### 13. [Plausible · Low-Med] `IncomeProjection.ts:317` — reinvested-interest income built local, read UTC
Built with local `new Date(year,…)` but consumed via `getIncomeActiveMultiplier` (`getUTC*`); in
positive-UTC timezones the active window shifts and mis-prorates taxable interest.

### 14. [Plausible · Low] `WithdrawalPlanner.ts:456,931` — unguarded `1/(1−rate)` gross-up
Divides by `1 − (marginalRate + 0.10)`; combined marginal ≥ 90% → denominator ≤ 0 → Infinity/NaN into
totals. Rare.

### 15. [Plausible · Low] `marginalRates.ts:26-27` — empty-bracket deref
Dereferences `brackets[0].rate` when `taxableIncome ≤ 0` with no empty-array guard; an authority with
empty `brackets` throws and aborts the year solve. (Reachability depends on whether such data exists.)

---

## Checked and deprioritized
- **Not a bug:** `WorkIncome.increment` percent employer-match — `getEffectiveAnnualEmployerMatch`
  recomputes percent matches from salary and ignores the stored field. RMD prior-balance fallback when
  `previousSimulation` is empty — fine for year 1 (start-of-year ≈ prior Dec-31).
- **Real but sub-dollar:** `RothConversionDP.ts:699` yearTax/waterfall staleness at fixed-point
  convergence.
- **Data freshness, not logic (verify against published figures):** 2025 SS bend points `1200/7240`
  (SSA actuals `1226/7391`); 2026 IRA limit `7500`.
- **Worth a focused look — couldn't confirm a concrete wrong number statically:** ESPP tax handling
  drew three independent smoke signals (`WithdrawalPlanner.ts:992` blended gross-up rate, `:162/1074`
  fallback treating the bargain element as LTCG, `AccountGrowth.ts:266` share sale possibly untaxed).
