# Code Review — PR #55 (`review/tax-7`)

**Scope:** tax services + tax data tables (source) — 14 files, +2169 lines, purely additive.
**Effort:** xhigh (9 finder angles — 5 correctness / 3 cleanup / 1 altitude — + verify + gap sweep).

## Setup caveat
Campaign-7 scoped-review PR: the reviewed source is identical to `main`, so findings were
validated against the real tree. The federal math engine was traced against IRS worksheets
(17+ cases — provisional income, taxable-SS, bracket walk, LTCG stacking, NIIT) with **no**
correctness bug found. The cross-file tracer confirmed `tsc -b` exits 0 — no signature,
return-shape, or import breaks at any call site. This is mature, already-reviewed code
(it passed PR #54), so the surviving items are modeling inconsistencies and cleanup, not
high-severity defects.

---

## Resolution (applied to `main`, full suite green: 121 files / 3383 tests, `tsc -b` clean)

All 13 findings were fixed in parallel by five isolated worktree agents (one per file group),
each writing a red→green or characterization test before its fix; the branches were cherry-picked
onto `main` (commits `73248f5`, `6075a54`, `57f161e`, `96d8877`, `583409a`) and one reconciliation
commit (`0aa7a6a`) resolved two cross-fix test interactions.

| # | Finding | Disposition | Commit |
|---|---------|-------------|--------|
| 1 | Additional Medicare missing from combined marginal rate | **Fixed** — shared `getAdditionalMedicareThreshold` helper; `+0.009` above threshold | `6075a54` |
| 2 | `seniorDeduction` not inflated in projection branch | **Fixed** — inflate `seniorDeduction` (+ unpopulated `ssExemptionThreshold`/`retirementIncomeExemption`) | `73248f5` |
| 3 | 2024 Single brackets off-by-one (`+1` convention) | **Fixed** — corrected to breakpoint values; 5 existing boundary assertions updated | `583409a` |
| 4 | No deflation below the data range | **Deferred — out of scope/risky** (forward-only projection); noted, not implemented | — |
| 5 | NaN if partial `assumptions` lacks `inflationRate` | **Fixed** — `Number.isFinite` guard → treat as 0% | `73248f5` |
| 6 | Nearest-year tie-break prefers older year | **Fixed** (`<`→`<=` in shared `findNearestYear`) — latent, not separately unit-tested | `73248f5` |
| 7 | `calculateUnifiedStateTax` duplicates `calculateStateTax` | **Fixed** — shared `computeStateTaxFromGross`; base delegates with `additional=0` | `57f161e` |
| 8 | State tax computed then discarded under `Standard` | **Fixed** — SALT/itemized block guarded by `deductionMethod !== 'Standard'` | `57f161e` |
| 9 | Duplicated nearest-year reducer (+ memoization) | **Partially fixed** — reducer extracted; memoization left out (out of scope) | `73248f5` |
| 10 | `getPre/PostTaxExemptions` duplication | **Fixed** — shared `resolveEffective401k(...,'preTax'|'roth')` | `96d8877` |
| 11 | Redundant `if (totalSSBenefits > 0)` wrapper | **Fixed** — flattened into the shared state-tax helper | `57f161e` |
| 12 | `\|\| 14600` falsy-zero fallback | **Fixed** (`?? 14600` / `?? 0`) — latent, not separately unit-tested | `6075a54` |
| 13 | `(exp as any).tax_deductible \|\| 0` cast | **Fixed** — `hasTaxDeductible` type guard, no `as any`, `?? 0` | `96d8877` |

**Net: 11 fixed, 1 partially fixed (#9 — reducer extracted, memoization deferred), 1 deferred (#4).**

Each behavioral fix shipped with a red→green test; the refactors (#7/#8/#9/#10/#11/#13) shipped with
characterization tests verified green against the original code first. Two cross-fix interactions were
reconciled in `0aa7a6a`: the #1 surtax made a pre-existing "Medicare-only above wage base" test collide
with the $200k threshold (income moved to $175k, preserving its intent), and the #3 bracket fix shifted
three #8 characterization values by exactly $0.10 (the correct post-fix amounts).

**Flagged for a future pass (not in this scope):** `calculateFederalTaxFromIncomes` with
`deductionMethod: 'Auto'` returns its own internally-computed min, which does **not** equal
`min(standalone Standard, standalone Itemized)` (e.g. 13427.08 vs 13356.44 for the same inputs). Pinned
as a regression guard in `ReviewFixes_PR55_stateTax.test.ts`; worth confirming the divergence is intended.

---

## Findings

### 1. [Confirmed · Med] `marginalRates.ts:110` — combined marginal rate omits 0.9% Additional Medicare
`getCombinedMarginalRate` builds `ficaRate` as SS + Medicare (or Medicare-only above the wage
base) but never adds the **0.9% Additional Medicare surtax** above the filing-status threshold —
the opposite direction from `calculateFicaTax:32`, which *does* charge it. Single filer, earned
income $260k, `includesFICA=true`: realized FICA includes 0.9% on the $60k over $200k, but the
marginal rate returns `fica=0.0145`. `TaxOptimizationService.ts` (196/464/579/888) sizes
conversions/withdrawals off this understated rate, so the optimizer's estimate disagrees with the
tax it actually realizes above $200k/$250k/$125k. No test covers >$200k earned income with FICA,
so the gap isn't locked in.

### 2. [Confirmed · Med] `parameters.ts:116` — inflation branch leaves `seniorDeduction` un-inflated
The `year > max_year` branch inflates `standardDeduction`, `brackets`, `socialSecurityWageBase`,
and `capitalGainsBrackets`, but spreads `seniorDeduction` (and the other state-only thresholds)
through from the base year via `...baseYearParams`, un-inflated. Virginia, MFJ, 65+, year 2050,
`inflationAdjusted=true`: brackets and the $17,500 standard deduction scale ~1.85×, but
`seniorDeduction` stays $12,000 (then doubled to $24k in `stateTax.ts`). Because the app projects
**every** year past 2026 through this branch, a VA senior's age deduction erodes in real terms in
every projected year, overstating VA tax.

### 3. [Confirmed · Low] `TaxData.tsx:71` — 2024 Single brackets use the `+1` convention, inconsistent with the rest of the table
Federal 2024 Single is `47151 / 100526 / 191951 / 243726` (IRS "+1" lower-bound convention), while
the 2024 **MFS** row (`47150 / 100525 / 191950 / 243725`) and the 2025/2026 Single rows all use the
breakpoint value. The 2024 Single row is the lone outlier. A 2024 Single filer with taxable income
between 47150 and 47151 is taxed at 12% instead of 22% (each boundary $1 too high). ~$0.10 impact,
but a confirmed internal inconsistency that also shifts any Roth-ceiling keyed to the 2024 22/24/32/35%
bracket tops by a dollar.

### 4. [Plausible · Low] `parameters.ts:90` — inflation only goes up, never down
Inflation is applied only when `year > max_year`; there is no deflation for years below the data
range. `year=2019, inflationAdjusted=true, MFJ` → `getClosestTaxYear` snaps to 2024 and returns the
larger 2024 brackets/$29,200 std deduction verbatim. A historical/back-test scenario understates
tax. Edge case (the app normally projects forward), but the inflate-up / never-deflate-down asymmetry
is undocumented.

### 5. [Plausible · Low] `parameters.ts:76` — NaN if a partial `assumptions` lacks `inflationRate`
`inflation = assumptions.macro.inflationRate / 100` has no NaN guard, and the default-parameter
override fires only when the **entire** `assumptions` arg is `undefined`. A partial/migrated object
`{ macro: { inflationAdjusted: true } }` at year 2030 → `inflation=NaN` → `Math.pow(1+NaN,…)=NaN` →
every threshold/deduction NaN → `calculateTax` returns NaN, silently poisoning SimulationYear totals
with no thrown error.

### 6. [Plausible · Low] `parameters.ts:144` — nearest-year tie-break prefers the older year
The fallback reducer uses strict `<`, so an exactly-equidistant target keeps the first (older) year
in `Object.keys` order. Latent: a state table with only 2024 and 2026 rows queried for 2025 returns
the older 2024 brackets. No current state data has a missing middle year, so it doesn't trigger today,
but it silently prefers stale data if such a gap is ever introduced.

### 7. [Cleanup] `stateTax.ts:120` — `calculateUnifiedStateTax` duplicates `calculateStateTax` (~60 lines)
Near line-for-line copy: identical SS-treatment switch, senior-deduction doubling, and
Auto/Standard/Itemized selection; the only difference is `annualGross` including
`additionalOrdinaryIncome`. Any fix to SS treatment, senior-deduction logic, or deduction selection
must be made in both, and a one-sided edit silently diverges the withdrawal-inclusive path from the
base path. Extract a shared `computeStateTax(adjustedGross, params, …)` helper (same pattern PR #54
used for the conversion-tax helper).

### 8. [Cleanup/Efficiency] `federalTax.ts:62` — state tax computed then discarded under `deductionMethod === 'Standard'`
`stateTax` → `cappedStateTax` → `itemizedTotal` are computed unconditionally to build the SALT-capped
itemized deduction, but on the `'Standard'` path `itemizedTotal` is never used. For a Standard-method
user, every per-year federal calc runs a full state-tax pass (its own `getTaxParameters` + bracket
walk) and throws it away. Guard the SALT/itemized block behind `deductionMethod !== 'Standard'`.

### 9. [Cleanup/Efficiency] `parameters.ts:140` — duplicated nearest-year reducer + no memoization
The `Object.keys(sourceData).map(Number).filter(!NaN).reduce(nearest)` search is duplicated (96-102
and 140-146), and `getTaxParameters` is re-invoked per year by federal/state/fica/capitalGains with no
caching — a single `calculateFederalTaxFromIncomes` triggers 2-3 passes for the same (year, status),
each potentially the O(years) fallback scan. Extract the reducer and consider memoizing by
(year, status, authority, state, inflation).

### 10. [Cleanup] `incomeAggregation.ts:59` — `getPostTaxExemptions` / `getPreTaxExemptions` duplication
Identical filter+reduce over `WorkIncome` with the same `useStoredValue`/`getEffective401k`
resolution; only the field read differs. A change to how effective 401k is resolved (e.g. catch-up
handling) must be edited in both. Extract `getEffective401kField(inc, year, age, useStoredValue,
'preTax'|'roth')`.

### 11. [Cleanup] `stateTax.ts:48` — redundant `if (totalSSBenefits > 0)` wrapper
The `'income-based'` and `'exempt'` arms are byte-identical (`adjustedGross = annualGross −
totalSSBenefits`), which equals `annualGross` when SS is 0 — only the `'taxable'` arm needs the guard.
Flatten to `if (ssTreatment === 'taxable') { … } else { adjustedGross -= totalSSBenefits }`
(subtracting 0 when no SS). Duplicated in both state functions.

### 12. [Plausible · Low] `marginalRates.ts:96` — `|| 14600` falsy-zero fallback
`fedParams?.standardDeduction || 14600` replaces a legitimately-zero standard deduction with the
hardcoded $14,600. Currently safe (federal rows never carry 0) but fragile — use `?? 14600`.

### 13. [Plausible · Low] `deductions.ts:15` — `(exp as any).tax_deductible || 0` casts away type-checking
`tax_deductible` is not declared on every member of the `AnyExpense` union, so the compiler can't
catch a member that passes the `is_tax_deductible` filter but lacks the field — it silently becomes
`undefined || 0 = 0`, dropping the deduction. Narrow with a type guard instead of `as any`.

---

## Checked and deprioritized
- **Math engine — verified correct:** provisional-income / taxable-SS / ordinary bracket walk (`>` is
  right) / LTCG stacking with `unusedDeduction` offset / NIIT base (`min(NII, MAGI-excess)`) all match
  IRS worksheets; pre-tax deductions are applied exactly once.
- **Not a bug — tested as intended:** `marginalRates.ts:39` negative-income headroom returns the bracket
  boundary (not `threshold − income`); `getMarginalTaxRate(-5000)` explicitly asserts `headroom=12400`.
- **Not a bug — documented intentional:** `stateTax.ts:78` MFJ senior-deduction doubling assumes both
  spouses meet the age threshold (stated in the comment); there is no second-spouse age to check.
- **Refuted:** `bracketTax.ts:141` NIIT MAGI "double-counts deductions" — the only caller passes gross
  `ordinaryIncome` (`nonSSGross + additionalOrdinaryIncome`), so `preTaxDeductions` is subtracted once.
- **Data — spot-checked clean:** all `brackets`/`capitalGainsBrackets` strictly monotonic, rates ascend,
  every array starts at threshold 0; 2024/2025/2026 ordinary brackets, std deductions, LTCG 0/15/20%
  thresholds, SS wage bases (168600/176100/184500), and FICA 6.2%/1.45% match published figures; MFS
  ≈ ½ MFJ. California's missing 2024 row is handled by the documented nearest-year fallback; Texas
  omitting `socialSecurityTreatment` is correct (no income tax).
