# Code Review — PR #51 (`review/sim-core-4`)

Scoped review of the simulation/tax core: 38 source files, 16,304 additions
(`git diff HEAD~1`, base = tests-only). Test files are a *possibly-wrong*
behavioral oracle and are **not** in the diff. Fixes land on `main` (all 38
source files are byte-identical between `review/sim-core-4` and `main`).

Method: max-effort recall review — 9 finder angles × ≤8 candidates → direct
verification by reading the code → ≤15 ranked findings.

The branch already carries every PR #50 fix (verified intact). The notable
result: **two of those fixes were incomplete** — the same bug survives in a
sibling path the original fix didn't reach (#1, #7).

## Fix status

| # | Sev | File:line | Bug | Status |
|---|-----|-----------|-----|--------|
| 1 | High | `YearSolver.ts:598` | SS double-counted when *sizing* a Roth conversion (search path; direct path was fixed) | ✅ Fixing |
| 2 | Med-High | `WithdrawalPlanner.ts:677` | roth_401k ACA path drains the live account `conversionHistory` in place across reused snapshots | ✅ Fixing |
| 3 | Med | `SimulationEngine.tsx:594` | RMD double-counted in Sankey `totalCashAvailable` → inflated `trueUserSaved`/`investedUser` | ✅ Fixed (RMD = income; see follow-up) |
| 4 | Med | `Expense/models.tsx:930` (+933, SimulationEngine:523) | `isGoalDueInYear` reads UTC date-only with local `getFullYear()` → goal fires wrong year | ✅ Fixing |
| 5 | Med | `MilestoneEvaluator.ts:127` | `calculateAnnualExpenses` uses local getters on UTC date-only bounds | ✅ Fixing |
| 6 | Med-Low | `Accounts/models.tsx:931` | `reconstituteAccount`/constructor don't clamp `employerBalance≤amount`/`costBasis≤amount` → negative `vestedAmount` → RMD skipped | ✅ Fixing |
| 7 | Med-Low | `parameters.ts:91` | Inflation-projection branch derefs `sourceData[max_year]` without the nearest-year fallback → crash for a state missing that year (latent) | ✅ Fixing |
| 8 | Low-Med | `Expense/models.tsx:916` (+900) | `getGoalMonthlySetAside`/`monthsBetween` local getters + `months<=0` returns full goal cost as one month | ✅ Fixing |
| 9 | Low | `SocialSecurityData.tsx:197` | 2026 SS wage base `184200`, should be `184500` (disagrees with TaxData) | ✅ Fixing |
| 10 | Low | `Expense/models.tsx:481` | `getBalanceAtDate` local getters on parsed date (no sim consumer) | ✅ Fixing |
| 11 | Perf | `RothConversionDP.ts:656` | DP recomputes roth-independent `yearTax` for all ~51 roth buckets in the ~1M-cell loop | ✅ Fixed |
| 12 | Cleanup | `YearSolver.ts:218` | LTCG bracket-rate walk duplicated (WithdrawalPlanner:505) | ✅ Fixed |
| 13 | Cleanup | `IncomeProjection.ts:102` | FERS/CSRS pension formulas inlined, duplicating PensionData.tsx | ✅ Fixed |
| 14 | Accuracy | `MilestoneEvaluator.ts:167` | `EXPENSES_GROSSED_UP` uses hardcoded `0.15` gross-up rate | ✅ Fixed |
| 15 | Cleanup | `TaxOptimizedWithdrawal.ts:1049` + `RothConversionDP.ts:1324` | Dead `if(false&&…)` block + `void WorkIncome;` dead import | ✅ Fixing |

**Refuted:** `getRMDDivisor` "age<72" gate (TaxOptimizedWithdrawal:159) — its
only caller passes `rmdStartAge` (always ≥72), so the sentinel never misfires.

## Verification

Fixes applied + verified on `main` (worktree): **`tsc -b` clean; `vitest` 3307/3307 passing (110/110 files); no test reconciliations required** — the fixes are timezone-robust and didn't conflict with any oracle test.

**Landed (10):** #1, #2, #4, #5, #6, #7, #8, #9, #10, #15.
- #1 — `coarseToFineSearch` now fed `nonSSOrdinaryIncome + bracketSpaceForSpending` (SS-excluded), matching the direct path's contract.
- #2 — roth_401k ACA path now passes a `.map()` copy of `conversionHistory` (mirrors roth_ira pooling); no longer mutates the model array.
- #4/#5/#8/#10 — date-only reads switched to `getUTC*`; `getGoalMonthlySetAside` ill-defined-horizon fallback → `0`.
- #6 — clamp applied in `reconstituteAccount` (not the constructor: a unit test legitimately constructs `costBasis > amount` to verify `unrealizedGains` floors at 0).
- #7 — inflation-projection branch falls back to the nearest available year when a state lacks the `max_year` row (federal behavior unchanged).
- #9 — `184200` → `184500`.
- #15 — dead `if(false&&…)` block + `void WorkIncome;` (and its now-unused import) removed.

**#3 deferred (reverted).** Investigation confirmed the double-count is real (RMD is in both `yearPlan.income.spendable` via `allIncomes`→`classifyIncome` *and* `withdrawalState.totalWithdrawals` via RMDService), so the Sankey's `investedUser` is inflated by the RMD each RMD year. **However it is display-only** (it does not affect account balances, taxes owed, or money movement), and the current code is internally *balanced* — the duplicated RMD appears on both the inflow and outflow (`investedUser`) sides, so `Scenario10`'s $1 Sankey-balance invariant holds. Any one-sided correction breaks a test: removing RMD from `totalCashAvailable` breaks `Scenario10` (balance off by the RMD); removing it from `cf.totalIncome` breaks `LongHorizonStability` ("tax ≤ income" assumes income includes RMD) and `StrategyBoundaries`. A correct fix requires a deliberate Sankey convention decision (is RMD an income node or a withdrawal node?) plus coordinated updates to `Scenario10`, `LongHorizonStability`, and `StrategyBoundaries`. Left for a focused follow-up.

## Second batch — #11–#14 landed (verified: `tsc -b` clean, vitest 3307/3307)

- **#11** — Hoisted the roth-independent initial `yearTax` out of the DP `rothIdx` loop (computed once per `(tradIdx, convIdx)`); numerically identical, ~51× fewer tax calls on the `dp-precomputed` hot path. The roth-dependent fixed-point path (when `tradSpending > 0`) is unchanged.
- **#12** — Extracted a single `getLTCGRate(ordinaryIncome, fedParams)` into `capitalGainsTax.ts`; `YearSolver` and `WithdrawalPlanner` now delegate to it. (The "third copy" in `capitalGainsTax.ts` was a *different* function — `calculateCapitalGainsTax` returns a tax amount, not a rate — so only the two true duplicates were unified.)
- **#13** — Verified the inlined FERS/CSRS formulas are exactly equivalent to `calculateFERSBasicBenefit`/`calculateCSRSBasicBenefit` in `PensionData.tsx`, then replaced the inline blocks with calls to them.
- **#14** — Replaced the flat `0.15` with a fixed-point gross-up over the real federal brackets for the milestone's year (`gross = expenses + tax(gross)`), and threaded the user's actual `filingStatus` from `SimulationEngine` through `MilestoneContext` (no longer hardcoded to Single). Still federal-only — `stateResidency` isn't on `MilestoneContext`; including state tax is a small further follow-up. No test asserted the old `0.15` value.

## Third batch — #3 landed (verified: `tsc -b` clean, vitest 3307/3307)

- **#3** — Sankey RMD double-count, fixed by adopting the **RMD = income** convention (user's call). The RMD was being counted on *both* the income side (`classifyIncome` → `spendable`) and the withdrawal side (`RMDService` → `totalWithdrawals`/`withdrawalDetail`), inflating `investedUser`/`totalInvested` by the RMD each year. The account drain has always lived solely in `userInflows` (applied by `growAccounts`), and `executeYearPlan` already skips the solver's RMD entry — so the withdrawal tallies were pure (double-counting) reporting. Changes:
  - `RMDService.ts` — stop adding RMD to `totalWithdrawals`/`withdrawalDetail`; keep the `userInflows` drain.
  - `CashflowDetailBuilder.ts` — surface RMD as an income node (removed the `sourceType === 'RMD'` skip).
  - `RothConversionDP.ts` + `TaxOptimizationService.ts` — drop the now-redundant "subtract RMD from withdrawalDetail-derived trad withdrawals" (numerically identical, since `withdrawalDetail` is already RMD-free).
  - `SimulationEngine.tsx` — `totalCashAvailable` auto-corrects (no RMD in `totalWithdrawals`); comment updated.
  - Oracle: `RMDCompliance.test.tsx` (8 spots) + `TemporalBoundaries.test.tsx` now assert the RMD via `rmdDetails.totalWithdrawn` instead of `withdrawalDetail['Traditional 401k']`. Scenario10's $1 Sankey-balance and the lifetime-reconciliation invariants still hold untouched (`totalIncome` keeps RMD; only the withdrawal representation moved).

## Deferred (optional follow-ups)

- **#14 (state tax)** — ~~thread `stateResidency` into `MilestoneContext` to include state tax in the `EXPENSES_GROSSED_UP` gross-up~~. **Won't-do** — federal-only gross-up is sufficient; not worth the plumbing. All PR #51 findings are now closed.
