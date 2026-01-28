# Tax Optimization Strategy Specification

## Overview

This document describes the tax-optimized withdrawal and Roth conversion strategy for retirement planning, with special focus on early retirees (FIRE scenarios).

## User Scenario (Reference Case)

- **Account Balances at Retirement:**
  - $841k Traditional 401k
  - $581k Brokerage
  - $213k Roth IRA
- **Income:**
  - $35k/year Social Security starting at age 67
- **Expenses:**
  - $68k/year living expenses
- **Timeline:**
  - Retiring at age 40 (early retiree/FIRE)
  - Social Security starts at age 67
  - RMDs start at age 73

## Core Goals

1. **Minimize lifetime taxes** by using low tax brackets strategically
2. **Maintain a target Traditional balance** throughout retirement to always have money to fill low brackets before and after RMDs determine what the tax rate will be in retirement, use this as the limit for traditional withdrawals, accounting for early withdrawal penalties when applicable.
3. **Use Roth conversions** during low-income years to move money from Traditional to Roth at low tax rates
4. **Avoid RMD problems** by not having too much in Traditional when RMDs start
5. **Fill low brackets during RMDs** by maintaining a Traditional balance that, with Social Security, fills the lower brackets. Use Roth for expenses above that.
6. **Don't over convert** when doing Roth conversions, some people may have too much in the Traditional accounts, and no amount of converting will help. Keep current taxable income under control.

## Key Concepts

### Early Retiree Definition
An "early retiree" is someone with **more than 15 years between retirement age and RMD start age** (typically 73). This gives them significant time to do Roth conversions during low-income "gap years."

### Gap Years
The period between retirement and when Social Security/pensions start. During these years:
- Income is typically $0 or very low (just dividends/interest)
- Low tax brackets are available (0%, 10%, 12%)
- This is the BEST time for Roth conversions

### Target Traditional Balance
The amount of Traditional balance we want to maintain so that:
- RMDs fill low tax brackets (not too high)
- We always have Traditional money to withdraw at low rates
- Typically calculated based on filling the 12% bracket at RMD age when accounting for social security

**Important:** There are two concepts here:
1. **Ideal Target** - The balance that keeps RMDs in low brackets (pure math)
2. **Realistic Target** - What we can actually achieve given time and bracket constraints

If someone has $5M Traditional and 2 years until RMD, the ideal target ($400k) is unachievable. The realistic target is what they can get to with maximum conversions.

### Dynamic Conversion Ceiling

The conversion bracket ceiling should NOT be fixed at 12%. It should be based on the **projected RMD tax bracket**.

**Key Insight:** If RMDs will be taxed at 35%, then converting at 32% is still a win.

The conversion ceiling is calculated iteratively each year:

```
1. Start with a conservative ceiling (12%)
2. Calculate bracket space up to that ceiling
3. Project maximum conversions possible (bracket space × years until RMD)
4. Project Traditional balance at RMD after those conversions
5. Calculate what bracket RMDs will land in
6. If projected RMD bracket > current ceiling, raise ceiling and repeat
7. Converge when projected RMD bracket <= conversion ceiling
```

**Example with $5M Traditional, 2 years until RMD:**

| Iteration | Ceiling | Bracket Space/yr | Projected Balance at RMD | RMD Bracket |
|-----------|---------|------------------|--------------------------|-------------|
| 1         | 12%     | $60k             | ~$4.9M                   | 37%         |
| 2         | 37%     | $400k            | ~$4.2M                   | 35%         |
| 3         | 35%     | $380k            | ~$4.3M                   | 35%         |
| Converged | 35%     |                  |                          |             |

Result: Convert aggressively into the 32% bracket because RMDs will be taxed at 35% anyway.

### Recalculate Every Year

The target and conversion ceiling should be **recalculated each year** because:
1. Market returns may differ from projections
2. Previous years' conversions may have been constrained by other income
3. Fewer remaining years means more aggressive conversions needed
4. Fixed income projections may change

### Early Withdrawal Penalty
Early withdrawal penalties effectively raise the tax brackets by 10%, account for this.
  - This does not apply to roth conversions.

For the reference case, target might be ~$200k at age 75, which produces RMDs of ~$8k/year that stay in low brackets.

## Two Phases of Retirement

### Phase 1: While Brokerage Has Funds

**Goal:** Use brokerage for spending while doing maximum Roth conversions.

**Strategy:**
1. **Spending comes from Brokerage** (tax-efficient - only gains are taxed at favorable capital gains rates)
2. **Roth conversions fill available bracket space** (based on estimated RMD tax rate), making sure to gross up the spending when determining if it should be used.
3. **Don't over convert** - Make sure to maintain some Traditional balance for later, only use Trad for spending in the 0% bracket
4. **Avoid using Roth** - Don't use roth unless your taxable income is above the standard deduction

**Example for a year in Phase 1:**
- Expenses needed: $68k
- 0% bracket space: ~$15k (standard deduction)
- 10% bracket space: ~$12k
- 12% bracket space: ~$36k
- Target Traditional balance: $200k
- Current Traditional: $400k (above target, so conversions needed)
- Brokerage balance: $200k

Calculation:
1. Amount needed to be withdrawn from Traditional: $400k - $200k = $200k total over remaining years, say $30k this year
2. Fill 0% and 10% bracket: $27k from Traditional for conversions
3. Fill some of the 12% bracket: 3k from Traditional for conversions.
4. No need for additional Traditional spending since the 30k has been hit.
5. Total Traditional used: $27k + $3 = $30k for conversion
6. Remaining spending need: $68k from Brokerage


**Why this works:**
- Brokerage withdrawals have favorable tax treatment (long-term capital gains)
- Roth conversions use the bracket space that would otherwise go unused
- Traditional balance decreases via conversions (not spending), moving money to Roth

### Phase 2: After Brokerage is Depleted

**Goal:** Keep Traditional on track to maintain the target Traditional balance.

**Strategy:**

**Priority Order (CRITICAL):**

1. **Roth conversions to hit target Traditional balance** if balance is above target and taxable income is within 12% bracket
2. **Use Trad for remaining bracket space** if there is space in the 12% bracket, use traditional to fill the space, making sure to account for penalties when determining if it should be used.
3. **Roth for ALL remaining spending** (primary spending source)

**Key Insight:** Roth becomes the PRIMARY spending source after brokerage depletes. Traditional is only used to fill low bracket space that isn't being used by conversions.

**Example for a year in Phase 2:**
- Expenses needed: $68k
- 0% bracket space: ~$15k (standard deduction)
- 10% bracket space: ~$12k
- 12% bracket space: ~$36k
- Target Traditional balance: $200k
- Current Traditional: $400k (above target, so conversions needed)

Calculation:
1. Amount needed to be withdrawn from Traditional: $400k - $200k = $200k total over remaining years, say $30k this year
2. Fill 0% and 10% bracket: $27k from Traditional for conversions
3. Fill some of the 12% bracket: 3k from Traditional for conversions.
4. Remaining bracket space after conversion: $33k
5. Additional Traditional spending: $33k (fills remaining bracket space)
6. Total Traditional used: $27k + $3 + $33k = $33k for spending, $30k for conversion
7. Remaining spending need: $68k - $33k = $35k from Roth

## What We're NOT Trying to Do

1. **NOT depleting Traditional entirely** - we want to maintain target balance
2. **NOT using Traditional as primary spending source** - that's what Roth is for after brokerage unless there is tax bracket space available that would make it cheaper now than later.
3. **NOT skipping conversions in gap years** - these are the best years for conversions
4. **NOT over-converting** - don't go below target Traditional balance

## Implementation Notes

### Determining Conversion Amount

For each year during retirement:

1. Calculate bracket headroom (how much ordinary income fits in target bracket)
2. Subtract any other ordinary income (SS, pensions, interest) SS has weird tax torpedo stuff we need to account for.
3. If early retiree with brokerage available: Convert up to headroom
4. If early retiree without brokerage: Convert what's needed to reach target, spend rest of headroom from Traditional while accounting for any penalties. Using roth to cover excesses.
5. If traditional retiree: Follow scheduled conversion plan

### Determining Withdrawal Order

**When brokerage available:**
```
1. Brokerage (for all spending)
2. Try to avoid savings, people usually like having an emergency fund. This also helps model having to withdrawal semi annually and holding cash.
```

**When brokerage depleted:**
```
1. Traditional (ONLY up to: bracket space - conversion amount)
2. Roth (for ALL remaining spending)
3. Savings (if everything else is empty)
```

### Coordinating Conversions and Spending

This is where previous implementations went wrong. The conversion and spending must be coordinated:

```
bracketSpace = calculateBracketHeadroom()
conversionAmount = calculateConversionNeeded(currentBalance, targetBalance, yearsRemaining)
conversionThisYear = min(conversionAmount, bracketSpace)
bracketSpaceForSpending = bracketSpace - conversionThisYear
traditionalSpending = min(bracketSpaceForSpending, spendingNeeded)
rothSpending = spendingNeeded - traditionalSpending
```

### Edge Cases

1. **Traditional already below target:** No conversions needed, but still use Traditional to fill low brackets for spending if the penalties don't make it illogical
2. **No bracket headroom:** Skip conversions, use Roth for spending
3. **RMD years:** RMD counts as Traditional withdrawal, reduces conversion/spending headroom
4. **Social Security starts:** Reduces available bracket space (SS is partially taxable) and has weird tax torpedo effects.
5. **Converted Roth 5 Year Window** I believe each conversion is handled seperately. Check to see if we have logic for Roth Lots, if not we'll just ignore it here and make a note for fixing it later.

## Tax Bracket Reference (2025 Single)

| Bracket | Taxable Income Range | Cumulative (with $15k std ded) |
|---------|---------------------|-------------------------------|
| 0%      | $0 - $0             | $0 - $15,000 gross           |
| 10%     | $0 - $11,925        | $15,000 - $26,925 gross      |
| 12%     | $11,925 - $48,475   | $26,925 - $63,475 gross      |
| 22%     | $48,475 - $103,350  | $63,475 - $118,350 gross     |

## Success Criteria

1. **No deficits** - spending needs are always met
2. **Traditional balance stays near target** throughout retirement
3. **Roth conversions happen every year** during gap years (early retiree)
4. **Low effective tax rate** - most income taxed at 0%, 10%, or 12%
5. **Roth grows substantially** - becomes primary spending source in later retirement

## Questions Resolved

1. **Should conversions stop when SS starts?** No - continue if projected RMD bracket is higher than current conversion rate. The dynamic ceiling handles this automatically.

2. **How aggressive should conversions be?** Convert up to the projected RMD bracket. If RMDs will be taxed at 35%, convert at 32%. The dynamic ceiling calculation handles this.

3. **Should we adjust target based on life expectancy?** No - target is based on RMD start age, not life expectancy.

4. **How to handle years with unusual income?** The yearly recalculation handles this - less bracket space that year means fewer conversions.

## Future Improvements (Not in Initial Implementation)

### Roth Conversion Lots (5-Year Rule)
Each Roth conversion has its own 5-year clock. Before age 59.5, withdrawing converted amounts within 5 years incurs a 10% penalty.

**Current approach:** Ignore this complexity. In most FIRE scenarios, brokerage lasts long enough that early conversions are 5+ years old by the time Roth spending is needed. Also, `regularContributions` (original Roth contributions) are always penalty-free.

**Future enhancement:** Track conversion lots with dates, prioritize withdrawals from oldest conversions and regular contributions.

### Brokerage Lot Selection
Currently uses average cost basis. Could be enhanced to:
- Track individual lots with purchase dates
- Prefer long-term lots (lower capital gains rate)
- Tax-loss harvesting opportunities

### Monte Carlo Success Rate Guard
Run simulations with optimization ON vs OFF, ensure success rate doesn't decrease. If it does, reduce conversion aggressiveness.

## Functions to Implement

When reimplementing, create these functions in a new service file:

### `calculateDynamicConversionCeiling()`
Determine the maximum bracket to convert into based on projected RMD situation.
Iteratively finds equilibrium where conversion ceiling matches projected RMD bracket.

```typescript
function calculateDynamicConversionCeiling(
    currentTraditionalBalance: number,
    yearsUntilRMD: number,
    fixedIncomeAtRMD: number,  // SS + pensions
    growthRate: number,
    taxParams: TaxParameters
): {
    conversionCeiling: number,      // e.g., 0.32 for 32% bracket
    bracketSpacePerYear: number,    // how much can convert each year
    projectedBalanceAtRMD: number,  // realistic target
    projectedRMDBracket: number,    // what bracket RMDs will land in
    idealTarget: number             // what balance WOULD keep RMDs in 12%
}
```

### `calculateTargetTraditionalBalance()`
Calculate both ideal and realistic Traditional balance targets.
- **Ideal:** Balance that keeps RMDs + fixed income in 12% bracket
- **Realistic:** What we can achieve given conversion ceiling and years remaining
- Returns the higher of the two (can't go below realistic)

```typescript
function calculateTargetTraditionalBalance(
    currentBalance: number,
    yearsUntilRMD: number,
    fixedIncomeAtRMD: number,
    conversionCeiling: number,  // from calculateDynamicConversionCeiling
    growthRate: number,
    taxParams: TaxParameters
): {
    idealTarget: number,
    realisticTarget: number,
    effectiveTarget: number,  // max(ideal, realistic)
    conversionNeededThisYear: number
}
```

### `planTaxOptimizedYear()`
Master planning function called at the start of each simulation year.
Coordinates conversions and spending to share bracket space correctly.

```typescript
function planTaxOptimizedYear(
    deficit: number,                 // expenses - income (spending needed)
    accounts: AnyAccount[],
    yearsUntilRMD: number,
    fixedIncome: number,             // current year SS, pensions, etc.
    taxParams: TaxParameters
): {
    conversionAmount: number,        // how much to convert Trad → Roth
    traditionalSpending: number,     // how much to withdraw from Trad for spending
    brokerageSpending: number,       // how much from brokerage
    rothSpending: number,            // how much from Roth
    conversionCeiling: number,       // bracket we're converting up to
    projectedRMDBracket: number      // for UI display
}
```

**Logic:**
```
1. Calculate dynamic conversion ceiling (iterative)
2. Determine target Traditional balance
3. Calculate conversion needed this year
4. Check which phase we're in:
   - Phase 1 (brokerage available): Brokerage for spending, conversions get full bracket space
   - Phase 2 (brokerage depleted): Conversions first, Traditional spending gets remaining bracket space, Roth covers rest
5. Return the plan
```

### `getSmartWithdrawalOrder()`
Determine optimal withdrawal order for a given deficit:
- Phase 1 (brokerage available): Use brokerage, do conversions
- Phase 2 (brokerage depleted): Fill brackets with Traditional, use Roth for rest
- Return ordered list of accounts with amounts and tax implications

### `shouldDoAutoRothConversions()`
Simple gate function: Returns true when tax optimization is enabled AND person is retired.
Currently inlined in SimulationEngine.tsx as: `assumptions.investments.taxOptimizationEnabled && isRetired`

## Files Involved

- `RothConversionService.ts` - Conversion execution (exists, does bracket-filling conversions)
- `WithdrawalService.ts` - Actual withdrawal mechanics (exists)
- `SimulationEngine.tsx` - Orchestrates the simulation year-by-year
- **TODO:** Create new tax optimization service file when reimplementing
