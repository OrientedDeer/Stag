# Code Review — PR #52 (`review/sim-core-5`)

**Scope:** the ~16.4k-line additive simulation / tax / Roth implementation
(commit "Scope: simulation engine + Roth + tax/data/model closure"). The
committed test suite (commit "Base: tests only") was used as a behavioral
oracle (intentionally non-runnable here — missing external deps — so it was
read as a spec, not executed).

**Effort:** max (9 finder angles + gap sweep). ~50 candidates raised; the
majority were refuted against real code (the tax-math and oracle-divergence
passes largely self-refuted; several candidates cited hallucinated line numbers
/ confabulated symbols). 14 findings survived verification.

**Status legend:** ☐ open · ☑ resolved · ⊘ won't-do · ⏸ deferred (needs decision)

---

## Resolution — fixes landed on `main` (with regression tests)

`review/sim-core-5` is an unrelated orphan snapshot, so the fixes were ported to
`main` (the real, runnable repo) and verified against its suite (**3312 tests
green**). #1, #2, #6 ship with new regression tests that fail on unfixed `main`.

**Withdrawn during porting:** findings #7, #9, #12 (date) and #14 — they were not
real bugs for this app (see notes below).

| # | Status | Fix on `main` |
|---|--------|---------------|
| #1 priorEarnings dropped | ☑ + test | AssumptionsContext.tsx — preserve `priorEarnings` after mergeSection |
| #2 SS class omitted | ☑ + test | incomeAggregation.ts — add `SocialSecurityIncome` to getSocialSecurityBenefits |
| #3 converged flag | ☑ | YearSolver.ts — init `false`; set `true` only on real termination |
| #4 ACA MAGI omits LTCG | ☑ | helpers.ts — `magiBefore += ltcgIncome` |
| #5 Sankey match vs §415(c) | ☑ | CashflowDetailBuilder.ts + SimulationEngine.tsx — thread real `employerInflows` |
| #6 END_OF_PLAN `+1` | ☑ + test | AssumptionsContext.tsx — migration drops the `+1` (both fresh & migrated = life expectancy) |
| #7 Mortgage/Loan amortization "UTC" | ⊘ withdrawn | parseDate stores LOCAL midnight → local `getFullYear` was correct |
| #8 costBasis clamp | ☑ | Accounts/models.tsx — drop the `Math.min(…, amount)` clamp (allow underwater basis) |
| #9 goal already-purchased "UTC" | ⊘ withdrawn | same as #7 — local was correct |
| #10 RMD snapshot reservation | ☑ | YearSolver.ts — reserve RMD against the Traditional snapshot |
| #11 grossUp ceiling | ☑ | WithdrawalPlanner.ts — grow `hi` until net ≥ netNeeded |
| #12 active-month "UTC" | ⊘ withdrawn | same as #7 — local was correct |
| #13 dead ternary | ☑ | YearSolver.ts + types.ts — add/use `OPTIMIZATION_DISABLED` |
| #14 surplus "overshoot" | ⊘ withdrawn | intended/tested behavior: park surplus in savings when no brokerage |

**#7 / #9 / #12 withdrawn (date) — the important correction:** `parseDate`
(modelUtils.ts) parses `YYYY-MM-DD` via `new Date(y, m-1, d)` — it stores date-only
values at **local** midnight ("to avoid UTC timezone shift"). The original code
read them back with local `getFullYear()/getMonth()`, which is **correct**.
Switching to `getUTC*` was the wrong direction (shifts dates back a day in
positive-offset zones; a no-op in US/EST). Reverted. NOTE — the inverse latent
issue is real: a few pre-existing functions (`getExpenseActiveMultiplier`,
`getIncomeActiveMultiplier`, `isGoalDueInYear`, `getBalanceAtDate`) read these
local dates with `getUTC*` under a comment wrongly claiming `parseDate` returns
UTC. Harmless for US users; standardizing everything on local is the correct,
separate, low-priority cleanup.

**#14 withdrawn:** the no-brokerage savings fallback intentionally parks all
remaining surplus in savings (an existing test asserts the full deposit); the
"overshoot" is by design when there's nowhere else for the cash to go.

**#1 confirmed — why tests missed it:** `migrateAssumptions` runs on every load
(line 494) over the persisted `assumptions_settings` blob (which includes
`demographics.priorEarnings`), and `mergeSection` only copies keys present in
defaults. `AssumptionsContext.test.tsx` has **zero** `priorEarnings`/
`SET_PRIOR_EARNINGS` coverage, so the round-trip was never exercised.

**#2 confirmed — why tests missed it:** the tax oracle (`TaxService.test.tsx`,
`SocialSecurityTax.test.tsx`) constructs **only** `Current`/`Future` SS classes
(0 bare `SocialSecurityIncome`), so the omitted class is never hit by a tax
assertion — even though the *simulation* scenario tests use it heavily.

**#6 resolved (decision: drop the migration's `+1`, both fresh & migrated store
the life-expectancy value):** `getLifeExpectancy` (AssumptionsContext.tsx) returns
the END_OF_PLAN milestone's raw AGE value with no adjustment, so the fresh-user
`>= lifeExpectancy` was already correct (90) and the migration's `>= value+1`
wrongly made it 91. The migration now preserves the age value. Covered by a new
regression test (legacy `> 90` milestone → `getLifeExpectancy` 90).

---

## Findings

### #1 — ☐ priorEarnings silently dropped on every reload
**HIGH** · `src/components/Objects/Assumptions/AssumptionsContext.tsx:227`

`migrateAssumptions`/`mergeSection` only copies keys present in the **defaults**
object (`for (const key of Object.keys(defaultSection))`). The default
`demographics` is only `{ priorYearMode: false }` (line 190-193) — it has no
`priorEarnings` key.

- User imports SSA earnings XML → `SET_PRIOR_EARNINGS` stores it at
  `demographics.priorEarnings` (line 445) → persisted to localStorage.
- On reload, `mergeSection` never copies `priorEarnings`, so
  `IncomeProjection.ts:187` reads `undefined` and SS benefits silently fall back
  to estimates.

Any saved-only field absent from defaults is lost the same way (general
footgun, `priorEarnings` is the concrete instance with a live consumer).

### #2 — ☐ getSocialSecurityBenefits omits the base `SocialSecurityIncome` class
**HIGH** · `src/components/Objects/Taxes/taxService/incomeAggregation.ts:99`

The filter is `inc instanceof CurrentSocialSecurityIncome || inc instanceof
FutureSocialSecurityIncome` — omitting the sibling concrete class
`SocialSecurityIncome`. All three classes `extends BaseIncome` as **siblings**
(models.tsx:314/494/543); `SocialSecurityIncome` is in `AnyIncome` and is
reconstituted (models.tsx:942).

A `SocialSecurityIncome` benefit is therefore not recognized as SS by
`federalTax.ts:54`, `stateTax.ts:45/151`, and `RothConversionDP.ts:421` — it
stays in ordinary income and is taxed at **100% instead of the IRS ≤85% cap**,
overstating federal + state tax and distorting the conversion optimizer.
`IncomeClassifier.getTotalSSBenefits` / `CashflowDetailBuilder` / `classifyIncome`
all correctly include all three classes.

### #3 — ☐ `converged` flag can report true on non-convergence
**MED-HIGH** · `src/services/simulation/YearSolver.ts:1412`

`let converged = true;` is only ever re-set to `true` (1613) — never `false`.
If the retirement-year fixed-point loop exhausts `MAX_ITERATIONS` without
`ltcgDelta < 1 && tradDelta < 1` (e.g. Traditional-withdrawal ↔ SS-taxability
oscillation across the 50%/85% kinks), it falls through and `return { …converged
}` (1732) reports `converged: true` while holding the last iteration's
**non-converged** tax/withdrawal values. Downstream consumers (and the oracle,
which treats `converged` as a real signal) trust wrong numbers.

### #4 — ☐ ACA-cliff MAGI omits capital gains
**MED** · `src/services/simulation/helpers.ts:191`

`const magiBefore = nonSSIncome + totalSSBenefits;` omits the `ltcgIncome`
parameter (used everywhere else in the function — federal calc 98/108, state
178). ACA MAGI includes capital gains, so a conversion's cliff crossing is
under-detected for any retiree with LTCG.

Example: age 60, nonSSIncome $30k, SS 0, ltcgIncome $25k, cliff ≈ $60,240.
Converting $25k → magiBefore $30k / magiAfter $55k, both < cliff →
`crossesACACliff=false`, subsidy loss = 0. True MAGI (with the $25k LTCG) is
$55k → $80k, over the cliff. The conversion is priced as cliff-safe and the
subsidy is forfeited in the real sim.

### #5 — ☐ Sankey employer match ignores the §415(c) trim
**MED** · `src/services/simulation/CashflowDetailBuilder.ts:73`

`const match = inc.getEffectiveAnnualEmployerMatch(year);` recomputes the match
from scratch, ignoring the §415(c) combined-limit trim that
`AccountGrowth.processInflows` already applied (`employerMatch = trimmedMatch`,
AccountGrowth.ts:72). For high earners who hit the combined 401k limit the chart
overstates employer match and breaks the Sankey inflow = outflow balance —
defeating the module's stated purpose of not drifting from the sim's values.

### #6 — ☐ End-of-Plan milestone off-by-one (fresh vs migrated)
**MED** · `src/components/Objects/Assumptions/AssumptionsContext.tsx:45`

`createBuiltinMilestones` emits `{ operator: '>=', value: lifeExpectancy }`,
ending the plan **at** life expectancy — contradicting the adjacent comment
("Trigger AFTER life expectancy year so expenses continue through it") and the
migration path, which converts old `'>'` to `'>=', value+1` (line 347). A
migrated user runs through age 91 (life 90) while a fresh user's milestone-gated
incomes/expenses terminate at age 90 — inconsistent horizons for identical
inputs.

### #7 — ☐ Mortgage amortization reads startDate as local, not UTC
**MED** · `src/components/Objects/Expense/models.tsx:359`

`calculateAnnualAmortization` uses local `getFullYear()`/`getMonth()` (359-360)
while the sibling `getBalanceAtDate` (490-491) and the sim's
`getExpenseActiveMultiplier` use `getUTC*`. A UTC-midnight first-of-month start
shifts to the prior month/year in negative-offset zones.

Example: `startDate = parseDate('2025-01-01')` (UTC midnight) → in US-Eastern,
`purchaseYear` = 2024, `purchaseMonth` = 11. Sim year 2024 then computes a full
December of P&I for a mortgage that doesn't exist until 2025 (phantom
pre-purchase amortization) and mis-prorates the real first year.

### #8 — ☐ costBasis clamped to value erases underwater basis
**MED-LOW** · `src/components/Objects/Accounts/models.tsx:950`

`const costBasis = Math.max(0, Math.min(Number(data.costBasis ?? amount),
amount));` clamps basis ≤ current value. For an account saved while underwater
(amount $80k, basis $100k) the $20k loss is destroyed on reload; later recovery
to $100k is taxed as $20k phantom LTCG (gainRatio → WithdrawalPlanner). For
Roth, it understates penalty-free withdrawable basis. The comment's premise
("costBasis > amount is nonsensical") is false for loss positions.

### #9 — ☐ Goal "already purchased" check uses local year vs UTC elsewhere
**MED-LOW** · `src/components/Objects/Assumptions/SimulationEngine.tsx:344`

`new Date(e.goalTargetDate).getFullYear() < year` (local) vs `isGoalDueInYear`'s
`getUTCFullYear()` (Expense/models.tsx:930). For a Jan-1 (UTC) target date in a
negative-offset zone, the year flips: in the due year the goal fund is added to
`inactiveGoalFundIds` and capped to 0, while `isGoalDueInYear` still fires the
lump purchase the same year — funding is cut in the year the purchase happens.

### #10 — ☐ Snapshots don't net the RMD already claimed via userInflows
**MED-LOW** · `src/services/simulation/WithdrawalPlanner.ts:214`

`createOrderedSnapshots` builds snapshots from the raw start-of-year balance and
does not subtract the RMD drain recorded in `withdrawalState.userInflows`
(RMDService.ts:104, applied later by growAccounts). A large same-year
discretionary Traditional withdrawal + the RMD can exceed the balance:
increment clamps the balance at 0, but the RMD income and the planned net are
both counted as spendable cash → phantom cash equal to the over-draw. Triggers
when the deficit needs nearly the whole Traditional balance.

### #11 — ☐ grossUpTraditional search ceiling under-funds at very high rates
**LOW (edge)** · `src/services/simulation/WithdrawalPlanner.ts:344`

`let hi = netNeeded * 3;`. Once the combined fed + state + early-withdrawal rate
exceeds ~66.7%, net at `hi` = 3·netNeeded·(1−rate) < netNeeded, so every probe
falls short, `lo` rises to `hi`, and the function returns a gross whose net is
still below the deficit — silently under-funded, no widening of `hi`.

### #12 — ☐ isExpense/IncomeActiveInCurrentMonth read UTC dates as local
**LOW (display)** · `src/components/Objects/Expense/models.tsx:850` (and
`src/components/Objects/Income/models.tsx:840`)

`getMonth()`/`getFullYear()` on UTC-stored dates shifts the "active this month"
determination by a month for first-of-month dates in negative-offset zones
(e.g. a Feb-1 expense shows active in January). Display/active-list only — the
simulation paths (`getExpenseActiveMultiplier`/`getIncomeActiveMultiplier`)
correctly use `getUTC*`.

### #13 — ☐ Dead ternary mislabels conversion limiting factor
**LOW** · `src/services/simulation/YearSolver.ts:379`

`const limitingFactor: ConversionLimitingFactor = !input.isRetired ?
'NOT_RETIRED' : 'NOT_RETIRED';` — both branches identical. A retired user with
tax-optimization disabled is reported as `NOT_RETIRED` instead of an
"optimization disabled" reason.

### #14 — ☐ Surplus no-brokerage fallback overshoots the emergency-fund cap
**LOW** · `src/services/simulation/SurplusAllocator.ts:345`

With no priority buckets and no brokerage account, step 4's
`accounts.find(a => a instanceof SavedAccount && !bucketAccountIds.has(a.id))`
re-selects the same SavedAccount that step 2a just capped at
`emergencyFundTarget` and deposits all remaining surplus into it, blowing past
the target. Arguably a defensible "don't lose the money" fallback, but it
silently violates the cap step 2a enforces.

---

## Checked and cleared (no defect)

- Progressive-bracket / capital-gains stacking / FICA wage-base cap /
  SS-provisional-income tiers — internally consistent, match the oracle.
- ESPP qualifying/disqualifying ordinary-income split and LTCG basis — correct.
- `calculateRMD`'s `age < 72` floor — dead defense; the only caller gates on
  `isRMDRequired` with the birth-year-aware start age.
- `RMDData` age-118 factor (2.5) — matches the real IRS Uniform Lifetime Table
  (non-uniform tail; the "expected 2.6" was a bad assumption).
- `IncomeClassifier` RMD add-then-undo — nets correctly, no double-count.
- WithdrawalPlanner ACA-cliff Roth-substitution (585-744) — correctly guarded
  against conversion double-spend / 5-year-rule mis-assignment ("BUG #9 FIX").
- `getCombinedMarginalRate` FICA wage-base quirk — moot, no simulation caller
  (re-export only).
- Most RothConversionDP finder candidates (terminal value, exogenous brokerage
  cap, discounting, binary ACA penalty) — documented modeling approximations,
  not defects; the binary ACA penalty is a plan-neutral additive constant.

## Notes on confidence

Items #10–#14 are real mechanisms but lower-confidence on trigger frequency
(edge timezones, >66.7% marginal rates, no-brokerage setups, diagnostic-only
labels). Weigh accordingly.
