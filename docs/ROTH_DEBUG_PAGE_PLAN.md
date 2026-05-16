# Roth Conversion Debug Page — Rewrite Plan

## Goal

Replace the current "Tax Optimization" view in the Testing tab with a page that helps users **understand** the Roth conversion logic (concepts, formulas, why dollars get converted) *and* **verify** it (concrete numbers, year-by-year, with source links). Same page serves both audiences.

The current page accreted around a defunct ideal/realistic/effective trichotomy. Rather than continue patching, rewrite it around the user's actual questions:

1. What did the engine convert this year, and why?
2. Why did it stop converting where it did?
3. Where will I land at RMD age, and is that good?

## Layout

**Left rail:** compact year selector + balance sparkline.
- Table columns: year, age, converted, limiting factor.
- Sparkline above the table: trad balance over time, with the selected year highlighted.
- Filter to retirement-onward years (where conversions actually happen). Skip pre-retirement (`NOT_RETIRED`) and post-RMD (`AT_RMD_AGE`) rows.

**Right pane:** single-year drill-down (sections below).

## Right-pane sections (top to bottom, for the selected year)

### 1. Headline

One sentence summarizing the year's decision:

> In 2044 (age 67), the engine converted **$48,200** because **the rate gap closed at the 22% bracket**.

Plus a small ledger of inputs feeding the decision: current trad balance, current AGI, projected RMD-year marginal rate.

### 2. Your aggressiveness setting

The `rothConversionMinRateGap` slider is shown read-only with its current value, framed as:

> You're willing to convert a dollar at rate X today only if it would otherwise be taxed at X+5pp or higher at RMD age.

Plus a one-line nudge: "Lower for more conversions; raise for fewer." Grounds the rest of the page in the user's lever.

### 3. The rate-match walk

The page's verification surface. A table that traces the algorithm's decision bracket-by-bracket for this year:

```
Bracket          Current rate   Projected RMD rate   Gap     Decision      Cumulative
10% ($0-$23k)       10%              24%             14pp    ✓ convert     $23,200
12% ($23k-$94k)     12%              24%             12pp    ✓ convert     $94,300
22% ($94k-$201k)    22%              24%              2pp    ✗ stop        —
```

- The "stop" row is highlighted — that's the limiting factor in action.
- Each row tooltip shows the formula with concrete values plugged in.
- Source link: `TaxOptimizedWithdrawal.ts:1060` (rate-match walk implementation).

### 4. Constraint adjustments

Below the walk, list adjustments that *narrowed* the bracket space below the raw federal bracket size — only show ones that fired this year:

- **SS torpedo:** "$X of bracket space lost — converting more pushes more SS benefits into taxability."
- **ACA cliff:** "$Y reserved — would cross subsidy cliff at $Z MAGI."
- **Spending withdrawals:** "$W already used by traditional withdrawals to cover this year's spending."

Each adjustment links to the source line implementing it.

### 5. Trajectory check

Two numbers side by side, plus status:

- **Where you'll land at RMD:** `$projectedBalanceAtRMD` (from current rate-match-walk trajectory)
- **Zero-tax floor:** the trad balance whose first-RMD-year withdrawal, combined with taxable SS and pension, stays under the standard deduction → first RMD year tax = $0.
- **Status:** "Below zero-tax floor — your first RMD year will owe no federal tax" / "$N above floor — first RMD year will owe roughly $T at the X% bracket"

The zero-tax floor is computed *on the debug page only* — it is not an input to the simulation engine. It's a pedagogical reference: "here's the cleanest possible outcome; here's where your settings will actually put you."

**Formula:**
```
maxRMD = standardDeduction − taxableSS − pension − otherOrdinaryIncome
zeroTaxFloor = maxRMD × rmdDivisor(firstRMDAge)
```

Use first-RMD-year values for SS, pension, std deduction, and divisor. For taxable SS, use the 85% ceiling unless we want to model the provisional-income formula precisely (TBD — see open question 1).

### 6. Concept reference (collapsed by default)

Five expandable sections, each with a 3-sentence explanation and a `src/...:LN` jump link:

- The rate-match walk — `TaxOptimizedWithdrawal.ts:1060`
- Bracket space & limiting factors — `types.ts:392`
- SS torpedo math — find file
- ACA cliff — find file
- RMD divisor + ideal-balance calc

Collapsed by default — experts skip, learners click.

## Open questions

1. **Taxable SS for the zero-tax floor:** use the 85% ceiling (simple, slightly pessimistic — produces a slightly lower floor) or the full provisional-income formula (precise, more code)? Lean: 85% ceiling for now; revisit if it produces visibly wrong floors in real scenarios.

2. **Left rail year range:** retirement-onward (current behavior) is correct — keep.

3. **Skipped years:** pre-retirement and post-RMD rows are noise. Don't show them.

## Out of scope for this rewrite

- The aggressiveness slider itself (lives in `WithdrawalTab.tsx`, not changing).
- The simulation engine math (verification surface only — no algorithm changes).

## Prerequisite cleanup (do before page rewrite)

Rip out the dead bracket-fill machinery so the new page isn't built on stale plumbing:

- Remove `rothConversionTargetBracket` from `AssumptionsContext.tsx` (state field, default, action types).
- Remove all read sites: `WithdrawalTab.tsx:212`, `YearSolver.ts:366`, `WithdrawalTab.tsx:310` (passed into `optimizationSummary`).
- Remove `targetBracket` parameter from `calculateDynamicConversionCeiling` and any internal pass-throughs.
- Remove `calculateIdealTargetBalance` (replaced by debug-page-only zero-tax-floor calc).
- Remove `idealTarget`, `targetTraditionalAtRMD` from `TaxOptimizationTarget` interface in `types.ts`. Keep `projectedBalanceAtRMD` (used by new page).
- Remove the no-op blocking check at `YearSolver.ts:490` (`if (projectedBalanceAtRMD <= idealTargetBalance && !hasStdDedHeadroom) skip`).
- Remove `conversionNeededThisYear` from `TaxOptimizationTarget` (hardcoded to 0, dead per `YearSolver.ts:460`).
- Update tests asserting on these fields — verify the assertions were testing the field's *existence* rather than the field's *correctness*; if the latter, investigate before deleting per CLAUDE.md.

## Files to touch

- `src/tabs/Testing/Testing.tsx` — replace the Tax Optimization content component (currently around line 5980+).
- Possibly extract into its own file (`src/tabs/Testing/RothConversionDebug.tsx`) given the scope.

## Verification

- All existing tests still pass (`npm run test:ci`).
- Manual walkthrough on a real scenario where the user is mid-retirement with active conversions — confirm rate-match walk numbers match a hand-calculation.
- Build clean (`npm run build`).
