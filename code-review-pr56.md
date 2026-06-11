# Code Review — PR #56 (`review/retirement-7`)

**Scope:** retirement-flow services + their data tables (source) — 11 files, +4135 lines, purely additive.
Roth-conversion DP, RMD service, income projection (work/SS/pension/interest), income classification,
account growth + contribution caps, milestone evaluation, cashflow-detail builder, and the
RMD / Social-Security / federal-pension / contribution-limit data.
**Effort:** xhigh (9 finder angles — 5 correctness / 3 cleanup / 1 altitude — + verify + gap sweep,
3 parallel finder agents + a manual line-by-line pass).

## Setup caveat
Campaign-7 scoped-review PR (scope-3-retirement): the reviewed source is identical to `main`, so every
finding was validated against the real tree (`SimulationEngine.tsx`, `YearSolver.ts`, the Income models,
`TaxService`). Findings that depend on what a function actually receives were traced to the call site —
the headline bug only exists because the stored `SimulationYear.incomes` (`returnedIncomes`) strips the
RMD income that the DP's comment assumes is present.

Confirmed clean (no defect): no taxable-SS double-count in conversion sizing (federal vs state SS each
counted once), LTCG not double-counted, all three SS sibling classes
(`SocialSecurityIncome`/`CurrentSocialSecurityIncome`/`FutureSocialSecurityIncome`) are enumerated in
every in-scope `instanceof` list, `??` is used correctly throughout the DP/growth code (no falsy-zero),
the interest `PassiveIncome` correctly uses `Date.UTC`, the RMD 25% excise flows into the year's taxes,
the §415(c) match trim is authoritative downstream in `CashflowDetailBuilder`, and the RMD divisor table
has a single source (`TaxOptimizationService` imports `getDistributionPeriod`, no drift).

---

## Resolution (applied to `main`; suites green: 50 files / 880 tests across the affected paths, `tsc -b` clean)

Six findings fixed by four sequential agents working on `main`, each writing a red→green regression test
that failed before its fix; one finding refuted on closer reading. Every behavioral fix shipped with a
test and the `fix(review7):` commit prefix. No cross-fix test interactions (unlike PR #55) — the full
simulation + integration + data suites pass clean against the stacked fixes.

| # | Finding | Disposition | Commit |
|---|---------|-------------|--------|
| 1 | DP double-subtracts RMD from the ordinary-income base | **Fixed** — drop `- baselineRMDAmount` (gross already excludes RMD); stale comment corrected | `073c260` |
| 2 | SS earnings-test reduction compounds year-over-year | **Fixed** — base the withholding on the preserved full `projectedPIA`, not the running reduced amount (FRA-restoration left as the pre-existing documented limitation) | `b2a4e86` |
| 3 | Same-year ESPP purchase nets against a sale, dropping the sale | **Fixed** — drop the redundant positive `userInflows[esppId]` purchase writes (balance is set via `addLot`); `userInflows` now carries only the sale | `b6f8317` |
| 4 | FERS MRA-to-62 supplement never auto-computed | **Fixed** — derive it via `calculateFERSSupplement` on auto-High-3 activation when retiring before 62 | `a9c7121` |
| 5 | §415(c) employee-only excess across multiple incomes into one account | **Fixed** — after match-first trim, trim employee deferrals for any remaining excess | `882cb92` |
| 6 | CSRS early-retirement log message shows uncapped reduction | **Fixed** — compute capped reduction once, use it in both `reductionPercent` and `message` | `3580718` |
| 7 | `DeficitDebtAccount` branch in `growAccounts` map loop is "dead" | **Refuted / wont-fix** — `DeficitDebtAccount extends DebtAccount`, so the branch (line 240) short-circuits the subclass before the generic `DebtAccount` branch (line 245) which would apply APR to deficit debt; the post-loop block only repairs the *system* entry. Removing it would corrupt the map's intermediate. Defensive, not dead. | — |

**Net: 6 fixed, 1 refuted.** Each fix verified red→green individually; the consolidated run
(simulation services, integration stories, SimulationEngine, RMD/SS/Pension/contribution-limit data)
is green and `tsc -b` exits 0.

Notable fix details:
- **#3:** investigation confirmed the positive ESPP purchase write to `userInflows` was consumed by
  nothing (balance flows through `addLot`; cashflow tracks ESPP via the `WorkIncome` contribution), so
  removing it is safe and leaves `userInflows[esppId]` carrying only the sale signal.
- **#2:** `projectedPIA` is set equal to `calculatedPIA` at activation and COLA-grown in lockstep, so it
  reliably holds the full benefit; the fix falls back to `amount/12` when `projectedPIA` is unset (one
  existing test constructs the income without it), preserving the single-year reduction there.

All review-fix regression tests live in `src/__tests__/services/simulation/ReviewFixes_PR56.test.ts`.

---

## Findings

### 1. [Confirmed · High] `RothConversionDP.ts:445` — RMD double-subtracted from the DP's ordinary-income base
`buildDPYearContexts` computes
`nonSSOrdinaryIncomeExclRMD = max(0, grossIncome - ssBenefits - baselineRMDAmount)` where
`grossIncome = getGrossIncome(simYear.incomes)`. The comment at line 435 asserts "getGrossIncome
includes RMD," but the baseline `SimulationYear.incomes` is `returnedIncomes`, which
`SimulationEngine.tsx:630-632,668` builds by filtering out every `PassiveIncome` with
`sourceType === 'RMD'`. So gross income **already excludes** RMD, and subtracting `baselineRMDAmount`
removes it a second time. Retiree age 76, $40k pension, $60k required RMD: `grossIncome - ss = $40k`,
then `- $60k` → clamped to `$0`. `evaluateCell` then rebuilds ordinary income as `0 + rmd + conversion`,
losing the $40k of pension/wage/passive ordinary income **every post-RMD year**, so the DP sees phantom
bracket headroom and mis-prices/over-sizes conversions across the whole RMD horizon — the headline use
case for this module. (Secondary: `baselineRMDAmount` uses `rmdDetails.totalRMD` (required) while a
shortfall year's gross would reflect `totalWithdrawn` — moot once the erroneous subtraction is removed.)

### 2. [Confirmed · Med] `IncomeProjection.ts:287-298` — SS earnings-test reduction compounds year-over-year and is never restored
The earnings-test reduction is written back as the new `calculatedPIA` (line 291, `monthlyReduced`), so
the reduced benefit is what carries forward. Next year, `shouldRecalculate` is false (past claiming age),
`inc.increment()` COLA-grows the **already-reduced** PIA, and the earnings-test block reduces it **again**
by roughly the same withholding. For a pre-FRA claimant who keeps working, the benefit ratchets down each
year and, once work stops, stays permanently reduced instead of recovering toward the full PIA
(`projectedPIA` is preserved but never used to restore — the code's own comment flags "recalculated at
FRA (not yet implemented)"). Born 1965, claims at 62 (FRA 67), earns $80k: benefit shrinks every working
year and never recovers. _(Fix targets the compounding; FRA-restoration remains the documented
limitation.)_

### 3. [Confirmed · Med] `AccountGrowth.ts:266` — a same-year ESPP purchase nets against a sale, dropping the sale
`growAccounts` derives `grossWithdrawn = userIn < 0 ? -userIn : 0` from the **net** `userInflows[esppId]`.
But ESPP sales write a negative there (`SimulationEngine.tsx:61-62`) while same-year ESPP purchases write
a positive (`AccountGrowth.ts:152/170`), and for ESPP the purchase reaches the balance only via `addLot`
(positive `userIn` is otherwise ignored). Still-employed user contributes +$8k to ESPP and the planner
sells $5k for a one-off expense: net `userIn = +$3k` → `grossWithdrawn = 0` → `removeSoldShares` never
runs, the $5k of shares stay on the books, and the ESPP balance is overstated by the unsold $5k even
though the cash was spent. (Any year with both a buy and a sell mis-handles the balance — the buy masks
part/all of the sell.)

### 4. [Confirmed · Med] `IncomeProjection.ts:113-120` — FERS MRA-to-62 supplement is never auto-computed
On auto-High-3 FERS activation the new `FERSPensionIncome` is built passing `inc.fersSupplement`
verbatim (line 116). The model's `getSupplement()` / `calculateFERSSupplement` (models.tsx:657) that would
derive it is **dead code — never called anywhere**. A FERS employee with `autoCalculateHigh3=true`
retiring at 57 with 30 years of service and `estimatedSSAt62` set, but `fersSupplement` left at its
default 0, gets `$0` bridge supplement from 57–62 instead of the expected `~(30/40)×SS@62` — understating
spendable income for those years. (High-3 and base benefit *are* auto-derived; the supplement alone is
not — the asymmetry the dead `getSupplement()` was meant to close. The default-config UI sets
`fersSupplement=0, estimatedSSAt62=0`, confirming the supplement is intended to be auto-derived.)

### 5. [Plausible · Low] `AccountGrowth.ts:66-72` — §415(c) cap trims only the employer match; employee-only excess slips through
The §415(c) combined limit is enforced by trimming the employer match
(`trimmedMatch = max(0, employerMatch - excess)`). When two incomes feed the **same** 401k account, their
combined employee deferrals alone can exceed the limit with no match to trim: two `WorkIncome`s each under
the §402(g) elective limit but summing to $75k of employee contributions vs a $70k §415(c) cap → the
already-zero match is clamped to zero, nothing is removed, and `userInflows` lands $5k over the cap.
Uncommon (two incomes → one account) but real.

### 6. [Confirmed · Low/cosmetic] `PensionData.tsx:277-281` — CSRS early-retirement log message shows the uncapped reduction
`checkCSRSEligibility` returns `reductionPercent: Math.min(reduction, 10)` (benefit correctly cut ≤10%)
but interpolates the **uncapped** `reduction` into `message`. age 45 / 25 yrs → returns 10% but the
message says "Early retirement with 20% reduction"; `IncomeProjection.ts:159` then logs the
self-contradictory "reduced by 10% (Early retirement with 20% reduction)". Log-only, no math impact.

### 7. [Cleanup → Refuted] `AccountGrowth.ts:240-243` — the `DeficitDebtAccount` branch in the `growAccounts` map loop is **not** dead
Initially flagged as dead (the post-loop block at 301-318 re-derives and replaces the system entry), but
`DeficitDebtAccount extends DebtAccount`, so the specific branch at line 240 must precede the generic
`DebtAccount` branch at line 245 to short-circuit the subclass — otherwise a deficit-debt account would be
treated as an APR-bearing `DebtAccount` in the map result. The post-loop block only repairs the *system*
`system-deficit-debt` entry. The branch is defensive, not dead. **Wont-fix.**

---

## Checked and deprioritized
- **No taxable-SS double-count in conversion sizing** — `computeYearTax` passes SS-excluding
  `ordinaryIncome` to `calculateTotalFederalTax` (which derives taxable SS internally) and adds
  `getTaxableSocialSecurityBenefits` to the state base only for SS-taxing states. Each counted once.
- **All three SS sibling classes enumerated** — `IncomeClassifier` (55-57, 154-156),
  `CashflowDetailBuilder` (121-125): no silent third-class drop in scope.
- **`getFERSCOLA` diet-COLA boundaries** correct at the 2%/3% edges; **`getClaimingAdjustment`** matches
  SSA (5/9%/mo then 5/12%/mo, 2/3%/mo delayed); RMD **25% excise** flows `RMDService` → `SimulationEngine`
  → `YearSolver` `totalPenalties`.
- **Refuted — earnings-test claiming-year proration:** `FutureSocialSecurityIncome` activates with a
  Jan-1 `startDate`, so the claiming-year benefit is modeled full-year — no partial-year-benefit /
  full-year-limit mismatch.
- **Refuted — `SocialSecurityData.ts:471` year-of-FRA window / `calculateBenefitAdjustment` FRA=67:** the
  integer-vs-fractional-FRA logic lives in `SocialSecurityCalculator` (out of scope); the in-scope
  `getClaimingAdjustment`/`getFRA` are correct. `calculateBenefitAdjustment` is in `models.tsx`
  (out of scope).
- **`IncomeClassifier` RMD add/undo** (83-93) is self-consistent (subtracts the same `annualAmount` it
  added); `classified.taxableTotal`'s naive "full SS taxable" sum is **not consumed** anywhere outside the
  type, so it poisons nothing.
- **`getDistributionPeriod` pre-72 fallback** returns the age-72 divisor for age < 72, but all callers
  guard on `age >= rmdStartAge` / `age < 72` first — latent footgun, no live trigger.
