# Plan: Skip Roth conversions during spending deficits, use tax-optimized Traditional withdrawals

## Context

The tax optimization engine (V2) currently plans Roth conversions BEFORE withdrawals. When there's a spending deficit (income < expenses), this creates a circular flow: Traditional -> Roth (conversion) -> withdraw from Roth (to cover spending). The conversion incurs income tax, but the money ends up withdrawn immediately — paying tax for no benefit. This circular flow causes ~$5k/year in wasted tax and is the primary reason the tax optimization strategy loses to basic withdrawal ordering in Monte Carlo simulations across all metrics.

**Fix**: When there's a spending deficit, skip the Roth conversion entirely. Instead, withdraw directly from Traditional (up to the dynamic bracket ceiling) for spending, then use Roth for the remainder. This fills the low tax brackets with Traditional income (same benefit as conversion) without the circular flow tax friction.

The bracket ceiling is NOT hardcoded — it uses the existing three-tier system in `calculateDynamicConversionCeiling`:
- Peak RMD bracket <= 12% -> ceiling = 0 (only standard deduction space)
- Peak RMD bracket <= 24% -> ceiling = 12%
- Peak RMD bracket > 24% -> ceiling = 24%

## Files to modify

1. `src/services/simulation/types.ts` — Add new limiting factor
2. `src/services/simulation/YearSolver.ts` — Skip conversion on deficit, reorder withdrawals

## Changes

### 1. `types.ts`: Add `SPENDING_DEFICIT` to `ConversionLimitingFactor` (line ~324)

```typescript
export type ConversionLimitingFactor =
    | 'BRACKET_CEILING'
    | 'SS_TORPEDO'
    | 'ACA_CLIFF'
    | 'BALANCE_BELOW_TARGET'
    | 'NO_BRACKET_SPACE'
    | 'PACING'
    | 'TRADITIONAL_DEPLETED'
    | 'NOT_RETIRED'
    | 'AT_RMD_AGE'
    | 'SPENDING_DEFICIT';      // <-- NEW: deficit exists, skip conversion to avoid circular flow
```

### 2. `YearSolver.ts` — `planConversion` function (after line ~412)

After `taxOptimizationTarget` is built (which includes `bracketSpaceThisYear`), add a deficit check that skips the conversion but preserves the bracket space info for the withdrawal phase:

```typescript
// Skip conversion when there's a spending deficit to avoid circular flow.
// Converting Trad->Roth then withdrawing from Roth wastes tax on the round-trip.
// The bracketSpaceThisYear is preserved in taxOptimizationTarget so the withdrawal
// planner can use it to cap Traditional withdrawals at the bracket ceiling.
if (surplus <= 0) {
    decisions.push({
        category: 'conversion',
        description: `Skipped Roth conversion: spending deficit (no surplus to pay conversion tax). ` +
            `Bracket space $${Math.round(ceilingResult.bracketSpacePerYear).toLocaleString()} ` +
            `available for tax-optimized Traditional withdrawals.`,
    });
    taxOptimizationTarget.limitingFactor = 'SPENDING_DEFICIT';
    taxOptimizationTarget.actualConversion = 0;
    return {
        conversion: null,
        conversionTax: 0,
        taxSource: 'SURPLUS',
        additionalOrdinaryIncome: 0,
        decisions,
        taxOptimizationTarget,
    };
}
```

Insert this BEFORE the existing "projected balance below target" check (line ~414). This way the bracket space is computed but the conversion is skipped.

### 3. `YearSolver.ts` — `solveRetirementYear` function (line ~986)

When `baseDeficit > 0`, check if conversion was skipped due to `SPENDING_DEFICIT`. If so AND age >= 59.5 (no early withdrawal penalty), reorder withdrawals to put Traditional first (capped at bracket space), then Roth, then others.

**Why age >= 59.5 gate**: Before 59.5, Traditional withdrawals incur a 10% early withdrawal penalty, making direct withdrawal more expensive than conversion (which has no penalty). After 59.5, direct withdrawal is strictly better than circular conversion flow.

Replace the current `createOrderedSnapshots` call (line ~988-993) with:

```typescript
let accountSnapshots: AccountBalanceSnapshot[];

if (conversionPlan.taxOptimizationTarget?.limitingFactor === 'SPENDING_DEFICIT'
    && input.currentAge >= 59.5
    && input.taxOptimizationEnabled) {
    // Tax-optimized withdrawal: Traditional first (up to bracket ceiling), then Roth, then others.
    // This fills low brackets with Traditional income without circular conversion flow.
    const allSnapshots = createOrderedSnapshots(
        input.accounts, input.withdrawalOrder, input.currentAge, input.year
    );
    const bracketCap = conversionPlan.taxOptimizationTarget.bracketSpaceThisYear;

    // Separate accounts into three groups, sharing the bracket cap across Traditional accounts
    let remainingCap = bracketCap;
    const tradSnapshots: AccountBalanceSnapshot[] = [];
    const rothSnapshots: AccountBalanceSnapshot[] = [];
    const otherSnapshots: AccountBalanceSnapshot[] = [];

    for (const s of allSnapshots) {
        if (s.accountType === 'traditional_401k' || s.accountType === 'traditional_ira') {
            const capped = Math.min(s.vestedBalance, remainingCap);
            if (capped > 0) {
                tradSnapshots.push({ ...s, vestedBalance: capped });
                remainingCap -= capped;
            }
        } else if (s.accountType === 'roth_401k' || s.accountType === 'roth_ira') {
            rothSnapshots.push(s);
        } else {
            otherSnapshots.push(s);
        }
    }

    accountSnapshots = [...tradSnapshots, ...rothSnapshots, ...otherSnapshots];

    decisions.push({
        category: 'withdrawal',
        description: `Tax-optimized withdrawal order: Traditional first ` +
            `(cap $${Math.round(bracketCap).toLocaleString()} at ` +
            `${(conversionPlan.taxOptimizationTarget.targetBracketCeiling * 100).toFixed(0)}% ceiling), ` +
            `then Roth, then others.`,
    });
} else {
    // Normal withdrawal order (user-configured, with penalty ordering)
    accountSnapshots = createOrderedSnapshots(
        input.accounts, input.withdrawalOrder, input.currentAge, input.year
    );
}
```

## Behavior summary

| Condition | Conversion | Withdrawal Order |
|-----------|-----------|-----------------|
| Surplus > 0 | Yes (as before) | User-configured order |
| Deficit, age < 59.5 | Skipped (SPENDING_DEFICIT) | User-configured order (Traditional penalized, goes to end automatically) |
| Deficit, age >= 59.5 | Skipped (SPENDING_DEFICIT) | Traditional first (capped at bracket ceiling) -> Roth -> others |

## Key design decisions

1. **`surplus <= 0` threshold**: Uses the pre-tax surplus estimate (`spendable + RMD - expenses`). Conservative — only skips conversion when income clearly doesn't cover expenses. Borderline cases (small surplus but high tax) still convert; this is acceptable for V1 since the circular flow is small in those cases.

2. **Bracket space reuse**: The `bracketSpacePerYear` from `calculateDynamicConversionCeiling` applies equally to Traditional withdrawals and conversions — both add the same amount of ordinary income. No adjustment needed.

3. **Cap via `vestedBalance`**: Capping the Traditional snapshot's `vestedBalance` at bracket space is a clean trick — the existing planner naturally "drains" the account and moves to the next one. The cap is shared across all Traditional accounts so total withdrawal stays within bracket space.

4. **RMD interaction**: RMD is handled separately (lines 962-984) and is already included in `baseOrdinaryIncome`. The `bracketSpacePerYear` accounts for this, so the additional Traditional withdrawal stays within the bracket ceiling.

## How existing code supports this

- **`calculateDynamicConversionCeiling`** (`TaxOptimizedWithdrawal.ts:826`): Already computes the three-tier ceiling and bracket space. We reuse `bracketSpacePerYear` directly for the withdrawal cap — no new calculation needed.
- **`createOrderedSnapshots`** (`WithdrawalPlanner.ts:193`): Already handles early withdrawal penalties by moving penalized accounts to end. Before 59.5, we use this default ordering (no Traditional reordering).
- **`grossUpTraditional`** (`WithdrawalPlanner.ts:265`): Already handles the algebraic gross-up for Traditional withdrawals including marginal rate and penalty. No changes needed.
- **`planWithdrawals`** (`WithdrawalPlanner.ts:376`): Takes `accountOrder` as parameter — we just pass a different order. No changes to the planner itself.
- **`initialSurplusEstimate`** (`YearSolver.ts:869`): Already computed before `planConversion`. We use the existing `surplus` parameter.

## Verification

1. `npm run build` passes
2. Run dev server, open Testing tab:
   - **Before 59.5 with deficit**: Should show `SPENDING_DEFICIT` as limiting factor, no conversion, normal withdrawal order
   - **After 59.5 with deficit**: Should show `SPENDING_DEFICIT`, no conversion, Traditional first in withdrawals (capped at bracket ceiling), then Roth
   - **Years with surplus**: Should still convert as before (no change)
3. Run Monte Carlo and compare tax-optimized vs basic strategy — expect improvement in success rate and percentile metrics
