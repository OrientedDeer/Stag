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
| 3 | Med | `SimulationEngine.tsx:594` | RMD double-counted in Sankey `totalCashAvailable` → inflated `trueUserSaved`/`investedUser` | ⏸ Deferred (real but display-only — see Verification) |
| 4 | Med | `Expense/models.tsx:930` (+933, SimulationEngine:523) | `isGoalDueInYear` reads UTC date-only with local `getFullYear()` → goal fires wrong year | ✅ Fixing |
| 5 | Med | `MilestoneEvaluator.ts:127` | `calculateAnnualExpenses` uses local getters on UTC date-only bounds | ✅ Fixing |
| 6 | Med-Low | `Accounts/models.tsx:931` | `reconstituteAccount`/constructor don't clamp `employerBalance≤amount`/`costBasis≤amount` → negative `vestedAmount` → RMD skipped | ✅ Fixing |
| 7 | Med-Low | `parameters.ts:91` | Inflation-projection branch derefs `sourceData[max_year]` without the nearest-year fallback → crash for a state missing that year (latent) | ✅ Fixing |
| 8 | Low-Med | `Expense/models.tsx:916` (+900) | `getGoalMonthlySetAside`/`monthsBetween` local getters + `months<=0` returns full goal cost as one month | ✅ Fixing |
| 9 | Low | `SocialSecurityData.tsx:197` | 2026 SS wage base `184200`, should be `184500` (disagrees with TaxData) | ✅ Fixing |
| 10 | Low | `Expense/models.tsx:481` | `getBalanceAtDate` local getters on parsed date (no sim consumer) | ✅ Fixing |
| 11 | Perf | `RothConversionDP.ts:656` | DP recomputes roth-independent `yearTax` for all ~51 roth buckets in the ~1M-cell loop | ⏸ Deferred (perf) |
| 12 | Cleanup | `YearSolver.ts:218` | LTCG bracket-rate walk is a 3rd copy (also WithdrawalPlanner:505, capitalGainsTax.ts) | ⏸ Deferred (refactor) |
| 13 | Cleanup | `IncomeProjection.ts:102` | FERS/CSRS pension formulas inlined, duplicating PensionData.tsx | ⏸ Deferred (refactor) |
| 14 | Accuracy | `MilestoneEvaluator.ts:167` | `EXPENSES_GROSSED_UP` uses hardcoded `0.15` gross-up rate | ⏸ Deferred (changes milestone numbers — needs sign-off) |
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

## Deferred (optional follow-ups)

- **#3** — Sankey RMD double-count (display-only; needs convention + test updates, above).
- **#11** — DP redundant `yearTax` recompute across roth buckets (perf, `dp-precomputed` path).
- **#12** — LTCG bracket-rate walk triplication → one shared helper.
- **#13** — FERS/CSRS pension formulas inlined → call `PensionData.tsx`.
- **#14** — `EXPENSES_GROSSED_UP` hardcoded `0.15` rate → derive from tax service (changes milestone numbers; wants sign-off).
