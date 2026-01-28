# Tax Optimization - Detailed Implementation Plan

## Overview

This document describes the exact implementation for tax-optimized Roth conversions and withdrawals. Read this before writing any code.

---

## Key Amendments (v2)

The following critical corrections were added after initial review:

1. **Survival Spending Priority** - In Phase 2 (brokerage depleted), mandatory spending has FIRST claim on bracket space. Conversions only get the leftovers. Spending is non-negotiable; conversions are optional.

2. **LTCG Bump Zone Detection** - The effective rate calculation must detect when $1 of conversion pushes LTCG from 0% to 15% bracket (creating ~27% effective rate).

3. **Actual State Tax Calculation** - Use the existing TaxService to calculate actual state tax on conversions, not a hardcoded buffer.

4. **Early Withdrawal Penalty Gross-Up** - When withholding from conversions under age 59.5, gross up to cover the 10% penalty on the withheld portion.

5. **Coarse-to-Fine Search** - Replace pure binary search with $5k coarse scan followed by fine binary search to handle SS torpedo plateaus and LTCG bump zones.

6. **Invariant Correction** - If effective rate exceeds ceiling after allocation, reduce CONVERSIONS first (not spending). Survival spending is non-negotiable.

## Key Amendments (v3)

Additional corrections from external review:

7. **ACA Subsidy Cliff Awareness** - For early retirees under 65, cap conversions to stay under 400% FPL to preserve ACA subsidies. Optional feature.

8. **Recalculate Tax After Invariant Fix** - When conversions are reduced by the invariant check, recalculate `taxPaymentSource`, `totalTaxNeeded`, and withholding amounts.

9. **Dynamic Damping Factor** - Replace fixed 20% damping with a function of years remaining. More aggressive when time is short (40-50% with 3 years), conservative when time is long (15% with 15+ years).

10. **Phase Transition Smoothing** - Add `BROKERAGE_TRANSITION` phase when brokerage covers 0.5-2 years of expenses. Reduce conversion aggressiveness during transition.

11. **Roth Depletion Handling (Phase 3)** - Add `ROTH_DEPLETED` phase when Roth is nearly empty. Traditional becomes primary source regardless of bracket efficiency.

12. **Fast-Path for Simple Cases** - Skip coarse-to-fine search when SS=0 and LTCG=0 (common in gap years). Use simple bracket math instead.

13. **Edge Type Detection Thresholds** - Fixed thresholds for detecting edge types: SS_TORPEDO requires >25% rate jump (not 15%), LTCG_BUMP requires >12% jump (not 10%).

---

## Critical Design Principles

### 1. Use Effective Marginal Rate, Not Bracket Position

Conversions should stop when `effectiveMarginalRate(nextDollar) >= projectedRMDRate`, NOT when bracket headroom is exhausted. This is critical because:

- The Social Security tax torpedo can make the effective rate much higher than the nominal bracket
- A $1 conversion might trigger $0.85 of additional SS becoming taxable
- This can push effective rates to 40%+ even in the "22% bracket"

### 2. Dampen Ceiling Adjustments

The dynamic ceiling calculation must NOT jump multiple brackets in one iteration:
- **Cap ceiling increases to ONE bracket per iteration** (e.g., 12% → 22%, not 12% → 35%)
- **Hard cap at 32%** - even if RMDs will be taxed at 37%, converting at 35% may not be worth it
- This prevents wild swings in conversion amounts year-over-year

**Ceiling Monotonicity Note:** The ceiling is *generally* monotonic (non-decreasing) but MAY decrease when structural income changes occur:
- SS benefits start or change
- Spouse dies (filing status change)
- Pension starts or stops
- These decreases must be logged and are limited to one bracket per year

### 3. Conservative Conversion Amounts

Don't try to perfectly hit the target. Instead:
- Calculate "max useful conversion this year" based on effective rate
- Let annual recalculation smooth things out
- Prefer under-converting slightly to over-converting

### 4. Tax Payment Must Be Funded

Conversions create tax liability. We must explicitly define how taxes are paid:
- Primary: Brokerage/Savings (if available)
- Fallback: Withhold from conversion (reduces net conversion)
- Never: Create unfunded tax liability

### 5. Explicit Calculation Order (Survival Spending First)

There is a circular dependency between conversion amount and effective rate:
```
conversion limit → remaining bracket space → traditional spending
traditional spending → AGI → effective marginal rate → conversion limit
```

**Resolution:** Fixed calculation order with **SURVIVAL SPENDING PRIORITY**:

**CRITICAL INSIGHT:** Spending is non-negotiable; conversions are optional tax optimization.

1. **Calculate mandatory Traditional withdrawal needed for survival**
   - `minimumTraditionalWithdrawal = deficit - (availableRoth + availableSavings)`
   - This is what we MUST withdraw to cover expenses
2. **Calculate effective rate for mandatory withdrawal**
   - If this already exceeds `conversionCeiling`, conversions = 0
3. **Only THEN allocate remaining bracket space to conversions**
4. **Assert invariant after allocation:**
   ```typescript
   assert(effectiveRateAfterAllocation <= targetRate + EPSILON)
   ```

If the assertion fails, reduce **conversions** (never spending) until it passes.

**Key Principle:** Survival spending has first claim on bracket space. Conversions get the leftovers.

### 6. Withholding Tax Estimation

When withholding from conversions, use the actual TaxService to calculate combined federal + state tax:

**Use Actual State Tax Calculation (Marginal):**
```typescript
function calculateConversionWithholding(
    conversionAmount: number,
    currentAGI: number,
    socialSecurity: number,
    taxState: TaxState,      // From TaxContext - has actual state tax info
    taxParams: TaxParameters
): { federalTax: number; stateTax: number; totalTax: number } {
    // Calculate federal tax on conversion (using effective rate with SS torpedo)
    const federalTax = calculateEffectiveConversionTax(
        conversionAmount, currentAGI, socialSecurity, taxParams
    );

    // Calculate MARGINAL state tax (tax with conversion minus tax without)
    // This correctly handles progressive state brackets
    const stateTaxWithConversion = calculateStateTax(
        currentAGI + conversionAmount,
        taxState.residenceState,
        taxState.filingStatus
    );
    const stateTaxWithoutConversion = calculateStateTax(
        currentAGI,
        taxState.residenceState,
        taxState.filingStatus
    );
    const stateTax = stateTaxWithConversion - stateTaxWithoutConversion;

    return {
        federalTax,
        stateTax,
        totalTax: federalTax + stateTax
    };
}
```

**Early Withdrawal Penalty Gross-Up (Under 59.5):**

When `taxPaymentSource === 'WITHHOLD'` and age < 59.5:
- The withheld amount is a **non-qualified distribution**, not a conversion
- It incurs an additional 10% early withdrawal penalty
- Must gross up the withholding to cover this penalty

```typescript
function calculateWithholdingWithPenalty(
    conversionAmount: number,
    totalTax: number,        // Federal + state from actual calculation
    age: number
): { grossWithholding: number; netToRoth: number; penaltyAmount: number } {
    if (age >= 59.5) {
        return {
            grossWithholding: totalTax,
            netToRoth: conversionAmount - totalTax,
            penaltyAmount: 0
        };
    }

    // Under 59.5: withheld amount incurs 10% penalty
    // Need to solve: withholding = tax + 0.10 * withholding
    // => withholding = tax / 0.90
    const grossWithholding = totalTax / 0.90;
    const penaltyAmount = grossWithholding * 0.10;

    return {
        grossWithholding,
        netToRoth: conversionAmount - grossWithholding,
        penaltyAmount
    };
}
```

**Invariant:** `actualTaxLiability + penaltyAmount <= fundedTax + EPSILON`

---

## File Structure

### New File: `src/services/simulation/TaxOptimizedWithdrawal.ts`

This file contains all tax optimization logic. It exports functions that are called by `SimulationEngine.tsx`.

### Modified Files:
- `SimulationEngine.tsx` - Call the new planning function, pass results to existing services
- `RothConversionService.ts` - Accept conversion amount from planner instead of calculating independently
- `WithdrawalService.ts` - Accept withdrawal plan instead of using fixed order

---

## Data Types

### Input Types (already exist)

```typescript
// From AssumptionsContext
interface AssumptionsState {
    investments: {
        taxOptimizationEnabled: boolean;
        withdrawalRate: number;
        // ... other fields
    };
    withdrawalStrategy: WithdrawalBucket[];
    // ...
}

// From TaxService
interface TaxParameters {
    brackets: { rate: number; min: number; max: number }[];
    standardDeduction: number;
    // ...
}
```

### New Types

```typescript
/**
 * Result of dynamic conversion ceiling calculation
 */
interface ConversionCeilingResult {
    /** The tax bracket rate to convert up to (e.g., 0.32 for 32%) */
    conversionCeiling: number;

    /** Bracket space available per year up to the ceiling */
    bracketSpacePerYear: number;

    /** What Traditional balance will realistically be at RMD age */
    projectedBalanceAtRMD: number;

    /** What bracket RMDs will land in given projected balance */
    projectedRMDBracket: number;

    /** What balance WOULD keep RMDs in 12% bracket (may be unachievable) */
    idealTargetBalance: number;
}

/**
 * Result of target balance calculation
 */
interface TargetBalanceResult {
    /** Balance that keeps RMDs in low brackets */
    idealTarget: number;

    /** What we can realistically achieve */
    realisticTarget: number;

    /** max(ideal, realistic) - the effective target to use */
    effectiveTarget: number;

    /** How much to convert this year to stay on track */
    conversionNeededThisYear: number;

    /** Are we above or below target? */
    aboveTarget: boolean;
}

/**
 * The complete plan for a simulation year
 */
interface TaxOptimizedYearPlan {
    /** Which phase we're in */
    phase: 'BROKERAGE_AVAILABLE' | 'BROKERAGE_TRANSITION' | 'BROKERAGE_DEPLETED' | 'ROTH_DEPLETED';

    /** Roth conversion amount for this year (gross, before withholding) */
    conversionAmount: number;

    /** Amount withheld from conversion for taxes (0 if paid from other source) */
    conversionWithholding: number;

    /** Net amount that actually arrives in Roth */
    netConversionToRoth: number;

    /** How conversion taxes are funded (NONE if no conversion) */
    taxPaymentSource: 'BROKERAGE' | 'SAVINGS' | 'WITHHOLD' | 'NONE';

    /** Withdrawal amounts by source */
    withdrawals: {
        traditional: number;  // For spending (not conversion)
        roth: number;
        brokerage: number;
        savings: number;
    };

    /** Bracket we're converting/spending up to */
    conversionCeiling: number;

    /** For UI display */
    projectedRMDBracket: number;
    effectiveTarget: number;

    /** Effective marginal rate after all allocations (for invariant verification) */
    effectiveRateAfterAllocation: number;

    /** Breakdown of bracket space usage */
    bracketSpaceUsed: {
        byConversion: number;
        byTraditionalSpending: number;
        remaining: number;
    };

    /** Structural changes this year that may affect ceiling (for logging) */
    structuralChanges?: string[];
}
```

---

## Function Specifications

### 1. `calculateEffectiveRateConversionLimit()`

**Purpose:** Calculate how much can be converted before effective marginal rate exceeds a target rate. This replaces the naive "bracket space" approach.

**Why Not Simple Bracket Space:**
The SS tax torpedo means effective rates can be much higher than nominal brackets:
- At certain income levels, $1 of conversion can make $0.85 of SS become taxable
- Effective rate = nominal rate + (SS torpedo effect)
- Must use effective rate to determine when to stop converting

**Signature:**
```typescript
function calculateEffectiveRateConversionLimit(
    currentAGI: number,              // AGI before conversion (excluding SS)
    socialSecurityBenefits: number,  // Total SS benefits
    ltcgIncome: number,              // Long-term capital gains (for bump zone detection)
    targetEffectiveRate: number,     // Stop when effective rate exceeds this
    taxParams: TaxParameters,
    taxState: TaxState               // Contains filingStatus and state info
): {
    maxConversion: number,           // How much can convert before exceeding target rate
    effectiveRateAtMax: number,      // The effective rate at that conversion level
    bracketAtMax: number,            // The nominal bracket at that level
    edgeType: 'SS_TORPEDO' | 'LTCG_BUMP' | 'BRACKET_EDGE' | 'ALREADY_AT_CEILING' | null
}
```

**Logic:**
```
1. FAST-PATH: If SS=0 and LTCG=0, use simple bracket math (skip coarse-to-fine search)
   - This is common in gap years between retirement and SS start
   - No SS torpedo or LTCG bump zones to worry about
   - Just find bracket ceiling and subtract current taxable income

2. FULL-PATH: Use binary search to find conversion amount where effective rate = target rate
   For each test amount:
   a. Calculate taxable SS at (currentAGI + testAmount)
   b. Calculate total tax at (currentAGI + testAmount + taxableSS)
   c. Calculate marginal effective rate = (taxIncrease) / (conversionIncrease)
3. Return the conversion amount where effective rate just reaches target

Note: We already have calculateEffectiveConversionTax() in helpers.ts that does (a)-(c).
We just need to binary search to find where effective rate = target.
```

**Fast-Path Implementation (Simple Cases):**
```typescript
function calculateEffectiveRateConversionLimit(
    currentAGI: number,
    socialSecurityBenefits: number,
    ltcgIncome: number,
    targetEffectiveRate: number,
    taxParams: TaxParameters,
    taxState: TaxState
): EffectiveRateLimitResult {

    // FAST-PATH: No SS and no LTCG means no discontinuities
    // Use simple bracket math - much faster than coarse-to-fine search
    if (socialSecurityBenefits === 0 && ltcgIncome === 0) {
        const simpleBracketSpace = calculateSimpleBracketSpace(
            currentAGI,
            targetEffectiveRate,  // Use target rate as bracket ceiling
            taxParams,
            taxState
        );

        return {
            maxConversion: simpleBracketSpace,
            effectiveRateAtMax: targetEffectiveRate,
            bracketAtMax: targetEffectiveRate,
            edgeType: 'BRACKET_EDGE'
        };
    }

    // FULL-PATH: SS and/or LTCG present - use coarse-to-fine search
    // (existing coarseToFineSearch logic)
    ...
}
```

**Binary Search Guardrails (CRITICAL):**

The effective rate curve has multiple discontinuities:
1. **SS Tax Torpedo** - Plateaus where effective rate jumps 22-40%+
2. **LTCG Bump Zone** - Where ordinary income pushes LTCG from 0% to 15%

**Capital Gains Bump Zone Integration:**

The tax engine must correctly stack Ordinary Income under LTCG:
```
┌─────────────────────────────────────┐
│     LTCG (taxed at LTCG rates)      │  ← Top of stack
├─────────────────────────────────────┤
│     Ordinary Income (conversions)   │  ← Determines LTCG bracket
├─────────────────────────────────────┤
│     Standard Deduction              │
└─────────────────────────────────────┘
```

**Key Insight:** A $1 conversion can push $1 of LTCG from the 0% bracket into the 15% bracket, creating a ~27% effective marginal rate (12% ordinary + 15% LTCG).

```typescript
function calculateEffectiveRateWithLTCG(
    conversionAmount: number,
    ordinaryIncome: number,
    ltcgIncome: number,
    socialSecurity: number,
    taxParams: TaxParameters
): number {
    // Calculate tax at current level
    const taxBefore = calculateTotalTax(ordinaryIncome, ltcgIncome, socialSecurity, taxParams);

    // Calculate tax with $1 more conversion
    const taxAfter = calculateTotalTax(ordinaryIncome + 1, ltcgIncome, socialSecurity, taxParams);

    // Effective marginal rate includes LTCG bracket bump
    return taxAfter - taxBefore;
}
```

**Coarse-to-Fine Search (handles discontinuities):**

Pure binary search fails on plateaus and discontinuities. Use coarse-to-fine:

```typescript
const SEARCH_CONFIG = {
    coarseStep: 5_000,          // $5k increments for initial scan
    fineMinStep: 100,           // $100 minimum for fine search
    maxIterations: 50,
    epsilon: 0.0025,            // ±0.25% tolerance
    maxConversionCap: 500_000
};

function coarseToFineSearch(
    targetRate: number,
    traditionalBalance: number,
    currentAGI: number,
    socialSecurity: number,
    ltcgIncome: number,
    taxParams: TaxParameters
): { amount: number; converged: boolean; edgeType: string | null } {
    const maxAmount = Math.min(traditionalBalance, SEARCH_CONFIG.maxConversionCap);

    // EDGE CASE: Check if we're already above target rate at zero conversion
    const rateAtZero = calculateEffectiveRateWithLTCG(0, currentAGI, ltcgIncome, socialSecurity, taxParams);
    if (rateAtZero >= targetRate) {
        // Already at or above target rate from other income - cannot convert anything
        return { amount: 0, converged: true, edgeType: 'ALREADY_AT_CEILING' };
    }

    // PHASE 1: Coarse scan to find the bracket edge
    let edgeFound = false;
    let edgeLow = 0;
    let edgeHigh = 0;
    let edgeType: string | null = null;

    for (let amount = 0; amount <= maxAmount; amount += SEARCH_CONFIG.coarseStep) {
        const rate = calculateEffectiveRateWithLTCG(amount, ...params);

        if (rate > targetRate) {
            // Found the edge - it's somewhere in the previous $5k window
            edgeFound = true;
            edgeLow = Math.max(0, amount - SEARCH_CONFIG.coarseStep);
            edgeHigh = amount;

            // Identify edge type for logging
            // Thresholds based on actual discontinuity magnitudes:
            // - SS torpedo: Can cause 40%+ effective rates (jump of 25%+)
            // - LTCG bump: 0% to 15% LTCG rate (jump of ~12-15%)
            // - Bracket edge: Normal bracket transitions (10-12% jumps max)
            const rateBefore = calculateEffectiveRateWithLTCG(edgeLow, ...params);
            const rateJump = rate - rateBefore;
            if (rateJump > 0.25) {
                edgeType = 'SS_TORPEDO';  // >25% jump indicates SS taxation kicking in
            } else if (rateJump > 0.12) {
                edgeType = 'LTCG_BUMP';   // >12% jump indicates LTCG bracket shift
            } else {
                edgeType = 'BRACKET_EDGE';  // Normal bracket boundary
            }
            break;
        }
    }

    if (!edgeFound) {
        // Never exceeded target rate - can convert everything
        return { amount: maxAmount, converged: true, edgeType: null };
    }

    // PHASE 2: Fine binary search within the identified window
    let low = edgeLow;
    let high = edgeHigh;
    let iterations = 0;

    while (high - low > SEARCH_CONFIG.fineMinStep &&
           iterations < SEARCH_CONFIG.maxIterations) {
        const mid = Math.floor((low + high) / 2);
        const rate = calculateEffectiveRateWithLTCG(mid, ...params);

        if (Math.abs(rate - targetRate) < SEARCH_CONFIG.epsilon) {
            return { amount: mid, converged: true, edgeType };
        }

        if (rate < targetRate) {
            low = mid;
        } else {
            high = mid;
        }
        iterations++;
    }

    // Return conservative lower bound
    return { amount: low, converged: iterations < SEARCH_CONFIG.maxIterations, edgeType };
}
```

**Edge Type Logging:** When an edge is found, log the type (SS_TORPEDO, LTCG_BUMP, BRACKET_EDGE) for debugging and UI display.

**Example with SS Torpedo:**
```
currentAGI = $20,000 (dividends, small pension)
socialSecurityBenefits = $35,000
targetEffectiveRate = 0.22 (22%)

Without SS: Could convert up to 22% bracket ceiling (~$63k - $20k = $43k)

With SS torpedo:
  - At $30k conversion: effective rate might be 28% (SS torpedo in effect)
  - At $20k conversion: effective rate might be 22%
  - Binary search finds: maxConversion = $20k

Result: Can only convert $20k, not $43k, before effective rate hits 22%
```

**Edge Cases:**
- No SS benefits → falls back to simple bracket calculation
- Already above target rate → return 0
- Very high SS → torpedo effect dominates

### 1b. `calculateSimpleBracketSpace()` (Fallback)

For situations without SS (pre-SS years), use simple bracket math:

```typescript
function calculateSimpleBracketSpace(
    currentTaxableIncome: number,
    bracketCeiling: number,
    taxParams: TaxParameters,
    taxState: TaxState             // Contains filingStatus
): number
```

**Logic:**
```
1. Find the bracket that matches the ceiling rate
2. Get the upper bound of that bracket (adjusted for standard deduction)
3. Subtract current taxable income
4. Return max(0, result)
```

---

### 2. `calculateIdealTargetBalance()`

**Purpose:** Calculate what Traditional balance at RMD age would keep RMDs in a target bracket.

**Signature:**
```typescript
function calculateIdealTargetBalance(
    fixedIncomeAtRMD: number,     // SS + pensions at RMD age
    targetBracket: number,         // e.g., 0.12 for 12%
    rmdStartAge: number,           // 73 or 75 depending on birth year
    taxParams: TaxParameters,
    taxState: TaxState             // Contains filingStatus
): number  // Returns ideal Traditional balance
```

**Logic:**
```
1. Get bracket ceiling for target bracket (e.g., $63,475 for 12%)
2. Calculate space for RMD = bracketCeiling - fixedIncomeAtRMD
3. Get RMD divisor for rmdStartAge (e.g., 26.5 at age 73)
4. idealBalance = rmdSpace × rmdDivisor

Formula: Balance = (BracketCeiling - FixedIncome) × RMDDivisor
```

**Example:**
```
fixedIncomeAtRMD = $35,000 (SS)
targetBracket = 0.12
bracketCeiling = $63,475
rmdSpace = $63,475 - $35,000 = $28,475
rmdDivisor at 73 = 26.5
idealBalance = $28,475 × 26.5 = $754,588
```

**Edge Cases:**
- fixedIncomeAtRMD exceeds bracket ceiling → return 0 (no room for RMD in this bracket)
- Very high fixed income → may need to target higher bracket

---

### 3. `projectBalanceAtRMD()`

**Purpose:** Project what Traditional balance will be at RMD age given a conversion rate.

**Signature:**
```typescript
function projectBalanceAtRMD(
    currentBalance: number,
    yearsUntilRMD: number,
    annualConversionAmount: number,
    growthRate: number            // e.g., 0.07 for 7%
): number
```

**Logic:**
```
For each year from now until RMD:
    balance = balance × (1 + growthRate) - annualConversionAmount

OR simplified formula:
    Balance_n = Balance_0 × (1+g)^n - C × [(1+g)^n - 1] / g

Where:
    Balance_0 = current balance
    g = growth rate
    n = years
    C = annual conversion
```

**Example:**
```
currentBalance = $841,000
yearsUntilRMD = 33 (age 40 to 73)
annualConversion = $50,000
growthRate = 0.05 (real return, inflation-adjusted mode)

Year 1: $841k × 1.05 - $50k = $833k
Year 2: $833k × 1.05 - $50k = $825k
... (growth roughly offsets conversions in this example)
```

---

### 4. `calculateDynamicConversionCeiling()`

**Purpose:** Find the optimal bracket ceiling for conversions based on projected RMD bracket.

**Signature:**
```typescript
function calculateDynamicConversionCeiling(
    currentTraditionalBalance: number,
    yearsUntilRMD: number,
    fixedIncomeAtRMD: number,
    currentAGI: number,            // This year's AGI (excluding SS)
    socialSecurityThisYear: number, // This year's SS benefits
    ltcgIncome: number,            // Long-term capital gains (for bump zone)
    growthRate: number,
    taxParams: TaxParameters,
    taxState: TaxState             // Contains filingStatus and state info
): ConversionCeilingResult
```

**Critical Constraints:**
1. **ONE BRACKET INCREASE PER ITERATION** - Never jump from 12% to 35% directly
2. **HARD CAP AT 32%** - Even if RMDs will be 37%, don't convert above 32%
3. **USE EFFECTIVE RATE** - Account for SS torpedo when calculating conversion space

**Available Brackets (in order):**
```typescript
const BRACKET_PROGRESSION = [0.10, 0.12, 0.22, 0.24, 0.32];
// Note: 0.35 and 0.37 are excluded - never convert that high
```

**Logic (Damped Iterative):**
```
1. Start with ceiling = 0.12 (12% bracket)
2. currentBracketIndex = indexOf(0.12) in BRACKET_PROGRESSION

3. LOOP (max 5 iterations):
    a. conversionLimit = calculateEffectiveRateConversionLimit(
           currentAGI, socialSecurityThisYear, ltcgIncome, ceiling, taxParams, taxState
       )
    b. projectedBalance = projectBalanceAtRMD(
           currentBalance, years, conversionLimit.maxConversion, growth
       )
    c. projectedRMD = projectedBalance / rmdDivisor
    d. projectedTaxableIncome = projectedRMD + fixedIncomeAtRMD
    e. projectedRMDBracket = getBracketForIncome(projectedTaxableIncome)

    f. IF projectedRMDBracket > ceiling AND currentBracketIndex < BRACKET_PROGRESSION.length - 1:
           // Raise ceiling by ONE bracket only
           currentBracketIndex += 1
           ceiling = BRACKET_PROGRESSION[currentBracketIndex]
       ELSE:
           BREAK  // Converged or hit cap

4. Calculate ideal target at 12% bracket for comparison
5. Return results
```

**Rationale:** Damped iteration prevents wild year-over-year swings and over-conversion by gradually adjusting the ceiling.

**Example Trace:**
```
$5M Traditional, 2 years until RMD, $35k SS

Iteration 1: ceiling=12%
  conversionLimit = $53k/year (effective rate based)
  projectedBalance ≈ $5.1M
  projectedRMDBracket = 35%
  35% > 12%, raise ceiling ONE bracket → 22%

Iteration 2: ceiling=22%
  conversionLimit = $100k/year
  projectedBalance ≈ $4.9M
  projectedRMDBracket = 35%
  35% > 22%, raise ceiling ONE bracket → 24%

Iteration 3: ceiling=24%
  conversionLimit = $130k/year
  projectedBalance ≈ $4.7M
  projectedRMDBracket = 32%
  32% > 24%, raise ceiling ONE bracket → 32%

Iteration 4: ceiling=32%
  conversionLimit = $300k/year
  projectedBalance ≈ $4.4M
  projectedRMDBracket = 32%
  32% <= 32%, CONVERGED

Result: Convert up to 32% bracket (capped, even though RMDs might be 35%)
```

---

### 5. `calculateTargetTraditionalBalance()`

**Purpose:** Determine effective target and conversion amount for this year.

**Signature:**
```typescript
function calculateTargetTraditionalBalance(
    currentBalance: number,
    yearsUntilRMD: number,
    fixedIncomeAtRMD: number,
    ceilingResult: ConversionCeilingResult,
    growthRate: number
): TargetBalanceResult
```

**Logic:**
```
1. idealTarget = ceilingResult.idealTargetBalance (from 12% bracket calc)

2. realisticTarget = ceilingResult.projectedBalanceAtRMD

3. effectiveTarget = max(idealTarget, realisticTarget)
   // Can't target below what's realistically achievable

4. IF currentBalance > effectiveTarget:
       aboveTarget = true
       // Calculate max useful conversion this year (see below)
   ELSE:
       aboveTarget = false
       conversionNeededThisYear = 0

5. Return results
```

**Conservative Conversion Amount Calculation:**

The previous formula `(balance - target) / years × (1 + g/2)` can overshoot badly. Instead, use a "max useful this year" approach:

```typescript
/**
 * Dynamic damping factor based on years remaining until RMD.
 * More aggressive when time is short, conservative when time is long.
 */
function getDampingFactor(yearsUntilRMD: number): number {
    if (yearsUntilRMD >= 15) return 0.15;  // Very conservative with lots of time
    if (yearsUntilRMD >= 10) return 0.20;
    if (yearsUntilRMD >= 7)  return 0.25;
    if (yearsUntilRMD >= 5)  return 0.30;
    if (yearsUntilRMD >= 3)  return 0.40;
    return 0.50;  // Aggressive when time is very short
}

function calculateConversionThisYear(
    currentBalance: number,
    effectiveTarget: number,
    yearsUntilRMD: number,
    bracketSpaceThisYear: number,  // From effective rate calculation
    growthRate: number
): number {
    if (currentBalance <= effectiveTarget) return 0;
    if (yearsUntilRMD <= 0) return 0;

    // Method 1: Simple spread (baseline)
    const simpleSpread = (currentBalance - effectiveTarget) / yearsUntilRMD;

    // Method 2: Cap at this year's effective bracket space
    // (Already accounts for SS torpedo via calculateEffectiveRateConversionLimit)
    const bracketCap = bracketSpaceThisYear;

    // Method 3: Dynamic damping based on years remaining
    const dampingFactor = getDampingFactor(yearsUntilRMD);
    const dampedMax = (currentBalance - effectiveTarget) * dampingFactor;

    // Use the MINIMUM of all three
    // This prevents aggressive over-conversion
    const conversionAmount = Math.min(simpleSpread, bracketCap, dampedMax);

    return Math.max(0, conversionAmount);
}
```

**Rationale:** The three-way minimum prevents over-conversion. Under-converting is self-correcting (next year adjusts); over-converting cannot be undone.

---

### 6. `planTaxOptimizedYear()`

**Purpose:** Master function that creates the complete plan for a simulation year.

**Signature:**
```typescript
function planTaxOptimizedYear(
    deficit: number,                    // Spending needed (expenses - income)
    accounts: AnyAccount[],
    currentAge: number,
    rmdStartAge: number,
    currentAGI: number,                 // This year's AGI (excluding SS)
    socialSecurityThisYear: number,     // This year's SS benefits
    ltcgIncome: number,                 // Long-term capital gains this year (for bump zone)
    fixedIncomeAtRMD: number,           // Projected SS, pensions at RMD
    growthRate: number,
    taxParams: TaxParameters,
    taxState: TaxState,                 // From TaxContext - for state tax calculation
    assumptions: AssumptionsState
): TaxOptimizedYearPlan
```

**Logic:**
```
1. GATHER ACCOUNT BALANCES
   traditionalBalance = sum of Traditional 401k + IRA
   rothBalance = sum of Roth 401k + IRA
   brokerageBalance = sum of Brokerage accounts
   savingsBalance = sum of Savings accounts

2. CALCULATE YEARS UNTIL RMD
   yearsUntilRMD = max(0, rmdStartAge - currentAge)

3. CALCULATE CONVERSION CEILING (skip if already at RMD age)
   IF yearsUntilRMD > 0:
       ceilingResult = calculateDynamicConversionCeiling(
           traditionalBalance, yearsUntilRMD, fixedIncomeAtRMD,
           currentAGI, socialSecurityThisYear, ltcgIncome, growthRate, taxParams, taxState
       )
   ELSE:
       // At or past RMD age, no conversions by policy
       // (See "RMD Age Behavior" section - RMDs already drawing down Traditional)
       // Note: currentAGI already includes RMD amount at this point
       ceilingResult = { conversionCeiling: 0, bracketSpacePerYear: 0, ... }
       log('Post-RMD conversions disabled by policy')

4. CALCULATE TARGET BALANCE AND CONVERSION AMOUNT
   targetResult = calculateTargetTraditionalBalance(...)
   rawConversionAmount = targetResult.conversionNeededThisYear

5. DETERMINE PHASE (with transition smoothing)
   // Calculate how many years of expenses brokerage can cover
   brokerageYears = brokerageBalance / deficit

   // Four phases to avoid cliff behavior at transitions
   IF brokerageYears >= 2.0:
       phase = 'BROKERAGE_AVAILABLE'
   ELSE IF brokerageYears >= 0.5:
       phase = 'BROKERAGE_TRANSITION'
       // Reduce conversion aggressiveness during transition
       // This preserves brokerage for longer, smoother transition to Phase 2
   ELSE IF rothBalance >= deficit * 0.5:
       phase = 'BROKERAGE_DEPLETED'
   ELSE:
       phase = 'ROTH_DEPLETED'
       // Survival mode - Traditional is primary regardless of bracket efficiency

   // Note: Phase determination affects conversion strategy:
   // - BROKERAGE_AVAILABLE: Full conversions, brokerage pays taxes
   // - BROKERAGE_TRANSITION: Reduced conversions, preserve brokerage
   // - BROKERAGE_DEPLETED: Spending first, conversions get leftovers
   // - ROTH_DEPLETED: No conversions, Traditional covers all spending

6. CALCULATE TOTAL EFFECTIVE BRACKET SPACE
   // See coarseToFineSearch() in Section 1 for implementation details
   totalBracketSpace = coarseToFineSearch(
       ceilingResult.conversionCeiling, traditionalBalance,
       currentAGI, socialSecurityThisYear, ltcgIncome, taxParams
   ).amount

6b. APPLY ACA CLIFF CEILING (if enabled and under 65)
   IF assumptions.acaSubsidyAware AND currentAge < 65:
       // Use accurate, annually-updated FPL values
       // 2024: ~$60,240 single, ~$81,760 MFJ (400% FPL)
       // 2025: ~$62,600 single, ~$84,600 MFJ (estimated)
       // MAGI for ACA includes 100% of SS (different from tax calculation!)
       ACA_CLIFF = getAcaCliffThreshold(taxState.filingStatus, simulationYear)
       currentMAGI = currentAGI + socialSecurityThisYear  // Full SS for ACA
       roomUnderCliff = max(0, ACA_CLIFF - currentMAGI - 1000)  // $1k buffer

       // Cap conversion to stay under cliff
       rawConversionAmount = min(rawConversionAmount, roomUnderCliff)

       IF roomUnderCliff <= 0:
           log('ACA cliff: No room for conversions without losing subsidies')
           rawConversionAmount = 0

7. PHASE HANDLING (Explicit if/else-if for all four phases)
   // NOTE: Use explicit if/else-if chain, not nested structure
   // This makes the control flow clear and avoids confusion

   IF phase == 'BROKERAGE_AVAILABLE':
       // Brokerage covers spending; conversions get full bracket space
       conversionAmount = min(rawConversionAmount, totalBracketSpace, traditionalBalance)

       // Determine tax payment source for conversions
       // Use actual TaxService calculation for federal + state
       taxEstimate = calculateConversionWithholding(conversionAmount, currentAGI, socialSecurityThisYear, taxState, taxParams)
       totalTaxNeeded = taxEstimate.totalTax

       IF brokerageBalance >= deficit + totalTaxNeeded:
           taxPaymentSource = 'BROKERAGE'
       ELSE IF savingsBalance >= totalTaxNeeded:
           taxPaymentSource = 'SAVINGS'
       ELSE:
           taxPaymentSource = 'WITHHOLD'
           // Apply penalty gross-up if under 59.5
           withholding = calculateWithholdingWithPenalty(conversionAmount, totalTaxNeeded, currentAge)

       withdrawals = {
           traditional: 0,
           roth: 0,
           brokerage: deficit + (taxPaymentSource == 'BROKERAGE' ? totalTaxNeeded : 0),
           savings: (taxPaymentSource == 'SAVINGS') ? totalTaxNeeded : 0
       }

7b. PHASE 1.5: BROKERAGE TRANSITION
   ELSE IF phase == 'BROKERAGE_TRANSITION':
       // Brokerage covers spending but is running low
       // Reduce conversion aggressiveness to preserve brokerage longer

       // Reduce conversion ceiling by one bracket OR apply 50% reduction
       reducedBracketSpace = totalBracketSpace * 0.5
       conversionAmount = min(rawConversionAmount, reducedBracketSpace, traditionalBalance)
       log(`Transition phase: reduced conversion from ${rawConversionAmount} to ${conversionAmount}`)

       // Same tax payment logic as Phase 1
       taxEstimate = calculateConversionWithholding(conversionAmount, currentAGI, socialSecurityThisYear, taxState, taxParams)
       totalTaxNeeded = taxEstimate.totalTax

       IF brokerageBalance >= deficit + totalTaxNeeded:
           taxPaymentSource = 'BROKERAGE'
       ELSE IF savingsBalance >= totalTaxNeeded:
           taxPaymentSource = 'SAVINGS'
       ELSE:
           taxPaymentSource = 'WITHHOLD'
           withholding = calculateWithholdingWithPenalty(conversionAmount, totalTaxNeeded, currentAge)

       withdrawals = {
           traditional: 0,
           roth: 0,
           brokerage: deficit + (taxPaymentSource == 'BROKERAGE' ? totalTaxNeeded : 0),
           savings: (taxPaymentSource == 'SAVINGS') ? totalTaxNeeded : 0
       }

8. PHASE 2: BROKERAGE DEPLETED - SURVIVAL SPENDING FIRST
   ELSE IF phase == 'BROKERAGE_DEPLETED':
       // **CRITICAL: Survival spending has FIRST claim on bracket space**
       // Conversions are optional tax optimization; spending is non-negotiable
       //
       // Withdrawal order in Phase 2:
       //   1. Traditional (up to bracket space - to fill low brackets)
       //   2. Roth (for remaining spending above bracket space)
       //   3. Savings (last resort emergency fund)

       // Step 8a: Determine Traditional spending based on age and bracket space
       IF currentAge < 59.5:
           // Early withdrawal penalty makes Traditional expensive
           // Only use Traditional if Roth is insufficient
           IF rothBalance >= deficit:
               traditionalForSpending = 0  // Roth can cover it, avoid 10% penalty
           ELSE:
               // Must use Traditional despite penalty - survival trumps optimization
               traditionalForSpending = min(deficit - rothBalance, traditionalBalance)
       ELSE:
           // No penalty - use Traditional up to bracket space for spending
           // This fills low brackets with spending before using tax-free Roth
           traditionalForSpending = min(totalBracketSpace, deficit, traditionalBalance)

       // Step 8b: Calculate remaining bracket space AFTER spending allocation
       remainingBracketSpace = max(0, totalBracketSpace - traditionalForSpending)

       // Step 8c: Calculate effective rate AFTER spending allocation
       rateAfterSpending = calculateEffectiveRate(
           currentAGI + traditionalForSpending,
           socialSecurityThisYear,
           ltcgIncome
       )

       // Step 8d: Determine conversion amount from REMAINING bracket space
       // ONLY convert if rate after spending is still below ceiling
       IF rateAfterSpending >= ceilingResult.conversionCeiling:
           // Spending already filled (or exceeded) target bracket
           // NO conversions this year
           conversionAmount = 0
           log(`Skipping conversions: spending already at ${(rateAfterSpending * 100).toFixed(1)}% effective rate`)
       ELSE:
           // Some bracket space remains for conversions
           conversionAmount = min(
               rawConversionAmount,
               remainingBracketSpace,
               traditionalBalance - traditionalForSpending
           )

       // Step 8e: Determine tax payment source for conversions (if any)
       IF conversionAmount > 0:
           // Use actual TaxService calculation for federal + state
           taxEstimate = calculateConversionWithholding(conversionAmount, currentAGI, socialSecurityThisYear, taxState, taxParams)
           totalTaxNeeded = taxEstimate.totalTax

           IF savingsBalance >= totalTaxNeeded:
               taxPaymentSource = 'SAVINGS'
           ELSE:
               taxPaymentSource = 'WITHHOLD'
               withholding = calculateWithholdingWithPenalty(conversionAmount, totalTaxNeeded, currentAge)
       ELSE:
           taxPaymentSource = 'NONE'  // No conversion, no tax to fund
           totalTaxNeeded = 0

       // Step 8f: Roth covers remaining spending deficit
       rothForSpending = min(deficit - traditionalForSpending, rothBalance)

       // Step 8g: Savings for taxes and any remaining spending shortfall
       savingsForTaxes = (taxPaymentSource == 'SAVINGS') ? totalTaxNeeded : 0
       savingsForSpending = max(0, deficit - traditionalForSpending - rothForSpending)

       withdrawals = {
           traditional: traditionalForSpending,
           roth: rothForSpending,
           brokerage: 0,
           savings: savingsForTaxes + savingsForSpending
       }

8c. PHASE 3: ROTH DEPLETED - SURVIVAL MODE
   ELSE IF phase == 'ROTH_DEPLETED':
       // Roth is nearly empty - Traditional is primary source regardless of bracket efficiency
       // This is survival mode - no tax optimization, just meet spending needs

       // NO conversions in this phase - would be counterproductive
       conversionAmount = 0
       taxPaymentSource = 'NONE'
       totalTaxNeeded = 0

       // Traditional covers as much spending as possible
       traditionalForSpending = min(deficit, traditionalBalance)

       // Savings covers any remaining deficit
       savingsForSpending = min(deficit - traditionalForSpending, savingsBalance)

       // If still not enough, log a deficit warning
       IF traditionalForSpending + savingsForSpending < deficit:
           log(`ROTH_DEPLETED: Spending deficit of ${deficit - traditionalForSpending - savingsForSpending}`)

       withdrawals = {
           traditional: traditionalForSpending,
           roth: 0,  // Roth is depleted
           brokerage: 0,
           savings: savingsForSpending
       }

       log('Phase 3 (ROTH_DEPLETED): Traditional is primary source, no conversions')

9. VERIFY EFFECTIVE RATE INVARIANT (CRITICAL)
   // After allocating both conversions AND traditional spending,
   // verify we haven't exceeded the target effective rate
   totalTaxableActivity = conversionAmount + withdrawals.traditional
   effectiveRateAfterAllocation = calculateEffectiveRate(
       currentAGI + totalTaxableActivity,
       socialSecurityThisYear,
       ltcgIncome
   )

   IF effectiveRateAfterAllocation > ceilingResult.conversionCeiling + EPSILON:
       // Invariant violated - reduce CONVERSIONS first (NOT spending!)
       // Spending is non-negotiable survival; conversions are optional tax optimization
       originalConversion = conversionAmount
       excessRate = effectiveRateAfterAllocation - ceilingResult.conversionCeiling
       reductionNeeded = estimateReductionForRate(excessRate)
       conversionAmount = max(0, conversionAmount - reductionNeeded)
       // Log this adjustment for debugging
       log(`Invariant fix: reduced conversion by ${reductionNeeded} to maintain effective rate`)
       log(`Spending is non-negotiable; conversions reduced from ${originalConversion} to ${conversionAmount}`)

       // CRITICAL: Recalculate tax amounts with new conversion amount
       // The tax payment source and withholding were calculated for original amount
       IF conversionAmount > 0:
           taxEstimate = calculateConversionWithholding(
               conversionAmount,  // NEW reduced amount
               currentAGI,
               socialSecurityThisYear,
               taxState,
               taxParams
           )
           totalTaxNeeded = taxEstimate.totalTax

           // Re-evaluate tax payment source with new (smaller) tax amount
           IF phase == 'BROKERAGE_AVAILABLE' OR phase == 'BROKERAGE_TRANSITION':
               IF brokerageBalance >= deficit + totalTaxNeeded:
                   taxPaymentSource = 'BROKERAGE'
               ELSE IF savingsBalance >= totalTaxNeeded:
                   taxPaymentSource = 'SAVINGS'
               ELSE:
                   taxPaymentSource = 'WITHHOLD'
           ELSE:
               IF savingsBalance >= totalTaxNeeded:
                   taxPaymentSource = 'SAVINGS'
               ELSE:
                   taxPaymentSource = 'WITHHOLD'
       ELSE:
           // Conversion reduced to zero - no tax to fund
           taxPaymentSource = 'NONE'
           totalTaxNeeded = 0

       // Re-verify
       newTotalTaxable = conversionAmount + withdrawals.traditional
       newEffectiveRate = calculateEffectiveRate(currentAGI + newTotalTaxable, socialSecurityThisYear, ltcgIncome)
       assert(newEffectiveRate <= ceilingResult.conversionCeiling + EPSILON)

       // CRITICAL: Update withdrawals object if tax payment source changed
       // The withdrawals were calculated for the original conversion amount
       IF phase == 'BROKERAGE_AVAILABLE' OR phase == 'BROKERAGE_TRANSITION':
           IF taxPaymentSource == 'BROKERAGE':
               // Brokerage now pays for spending + reduced tax
               withdrawals.brokerage = deficit + totalTaxNeeded
               withdrawals.savings = 0
           ELSE IF taxPaymentSource == 'SAVINGS':
               // Brokerage pays only for spending, savings pays reduced tax
               withdrawals.brokerage = deficit
               withdrawals.savings = totalTaxNeeded
           ELSE:  // WITHHOLD or NONE
               // No external tax payment needed
               withdrawals.brokerage = deficit
               withdrawals.savings = 0
       ELSE:  // BROKERAGE_DEPLETED phase
           IF taxPaymentSource == 'SAVINGS':
               withdrawals.savings = savingsForSpending + totalTaxNeeded
           ELSE IF taxPaymentSource == 'NONE':
               withdrawals.savings = savingsForSpending
           // WITHHOLD case: savings unchanged, withholding handles tax

       log(`Updated withdrawals after invariant fix: brokerage=${withdrawals.brokerage}, savings=${withdrawals.savings}`)

10. RECORD WITHHOLDING (if applicable)
   IF taxPaymentSource == 'WITHHOLD':
       // The conversion amount is gross; net to Roth is reduced
       // Use actual federal + state tax calculation
       taxEstimate = calculateConversionWithholding(conversionAmount, currentAGI, socialSecurityThisYear, taxState, taxParams)

       // Apply early withdrawal penalty gross-up if under 59.5
       withholding = calculateWithholdingWithPenalty(conversionAmount, taxEstimate.totalTax, currentAge)
       conversionWithholding = withholding.grossWithholding
       netConversionToRoth = withholding.netToRoth

       log(`Withholding ${conversionWithholding} from conversion (federal: ${taxEstimate.federalTax}, state: ${taxEstimate.stateTax}, penalty: ${withholding.penaltyAmount})`)
   ELSE:
       conversionWithholding = 0
       netConversionToRoth = conversionAmount

11. BUILD RESULT
    return {
        phase,
        conversionAmount,              // Gross amount leaving Traditional
        conversionWithholding,         // Amount withheld for taxes (if any)
        netConversionToRoth,           // Net amount arriving in Roth
        taxPaymentSource,
        withdrawals,
        conversionCeiling: ceilingResult.conversionCeiling,
        projectedRMDBracket: ceilingResult.projectedRMDBracket,
        effectiveTarget: targetResult.effectiveTarget,
        effectiveRateAfterAllocation,  // For verification/logging
        bracketSpaceUsed: {
            byConversion: conversionAmount,
            byTraditionalSpending: withdrawals.traditional,
            remaining: totalBracketSpace - conversionAmount - withdrawals.traditional
        }
    }
```

---

## Tax Payment Funding

**Problem:** Roth conversions create federal and state tax liability. This tax must be paid somehow.

**Options (in preference order):**

1. **Brokerage** (Best)
   - Pay taxes from brokerage account
   - Conversion goes 100% to Roth
   - Only works if brokerage has sufficient funds after spending

2. **Savings** (Good)
   - Pay taxes from savings/cash
   - Conversion goes 100% to Roth
   - Maintains emergency fund principle but reduces it

3. **Withhold from Conversion** (Acceptable)
   - Withhold taxes directly from the conversion
   - $100k conversion at 22% → $78k to Roth, $22k to IRS
   - Less efficient (less money goes to Roth) but keeps plan balanced

4. **Increase Deficit** (NOT ALLOWED)
   - Do NOT create unfunded tax liability
   - This would break internal consistency

**Implementation:** See `TaxOptimizedYearPlan` type definition above, which includes:
- `taxPaymentSource: 'BROKERAGE' | 'SAVINGS' | 'WITHHOLD'`
- `conversionWithholding: number`
- `netConversionToRoth: number`

---

## Integration with SimulationEngine.tsx

### Current Flow (simplified):
```
1. Project incomes
2. Calculate taxes
3. Process RMDs
4. Execute Roth conversions (calculates amount internally)
5. Calculate expenses
6. Execute withdrawals (uses fixed order from assumptions)
7. Process inflows
8. Grow accounts
```

### New Flow:
```
1. Project incomes
2. Calculate preliminary taxes (for bracket space calculation)
3. Process RMDs (if applicable)
4. IF taxOptimizationEnabled AND isRetired:
       plan = planTaxOptimizedYear(deficit, accounts, ...)
   ELSE:
       plan = null  // Use existing logic

5. Execute Roth conversions:
       IF plan:
           Use plan.conversionAmount
       ELSE:
           Use existing bracket-filling logic

6. Execute withdrawals:
       IF plan:
           Use plan.withdrawals (specific amounts per account type)
       ELSE:
           Use existing withdrawal order logic

7. Process inflows
8. Grow accounts
```

### Changes to RothConversionService.ts

Add an optional parameter for pre-calculated conversion amount:

```typescript
export function executeRothConversions(
    input: RothConversionInput,
    logs: string[],
    preCalculatedAmount?: number  // NEW: If provided, use this instead of calculating
): RothConversionResult {

    if (preCalculatedAmount !== undefined) {
        // Skip the bracket headroom calculation
        // Just execute the conversion for the specified amount
        return executeConversionForAmount(preCalculatedAmount, input, logs);
    }

    // Existing logic for when tax optimization is OFF
    // ...
}
```

### Changes to WithdrawalService.ts

Add support for a withdrawal plan:

```typescript
export function executeWithdrawals(
    deficit: number,
    accounts: AnyAccount[],
    // ... existing params
    withdrawalPlan?: TaxOptimizedYearPlan['withdrawals']  // NEW
): WithdrawalResult {

    if (withdrawalPlan) {
        // Execute withdrawals according to plan
        return executeWithdrawalPlan(withdrawalPlan, accounts, ...);
    }

    // Existing logic using withdrawal order from assumptions
    // ...
}
```

---

## Edge Cases and Special Handling

### 1. Already Past RMD Age
- No conversions (RMDs are mandatory withdrawals)
- Traditional spending fills bracket space after RMD
- Roth covers remainder

### 2. Traditional Balance Below Target
- No conversions needed
- Still use Traditional for spending up to bracket space (unless penalty makes it illogical)

### 3. No Traditional Balance
- Skip all conversion logic
- Use Roth/Brokerage/Savings for spending

### 4. No Roth Balance (Phase 2)
- Must use Traditional even above optimal bracket
- Log warning about suboptimal situation

### 5. Deficit Exceeds All Available Funds
- This is a plan failure scenario
- Existing deficit debt tracking handles this

### 6. Social Security Tax Torpedo

The SS tax torpedo is now handled explicitly via `calculateEffectiveRateConversionLimit()`:
- Uses `calculateEffectiveConversionTax()` from helpers.ts
- Binary searches for conversion amount where effective rate = target rate
- Ensures we never convert when effective rate exceeds projected RMD rate

**Key Insight:** The effective rate can be 40%+ even in the "22% bracket" if SS torpedo is in effect. We must always use effective rate, never nominal bracket rate.

### 6b. RMD Interaction with Tax Optimization

**How RMDs affect the calculation:**

RMDs (Required Minimum Distributions) are mandatory Traditional withdrawals that start at age 73-75. They:
- Count as ordinary income (included in `currentAGI`)
- Reduce Traditional balance automatically
- Fill bracket space before any voluntary Traditional spending or conversions

**RMD Flow:**
```
1. SimulationEngine processes RMDs BEFORE calling planTaxOptimizedYear()
2. RMD amount is included in currentAGI passed to the optimizer
3. The optimizer sees reduced bracket space due to RMD income
4. Conversions = 0 by policy (see "RMD Age Behavior" section)
5. Traditional spending fills any remaining bracket space after RMD
```

**Example:**
```
At age 75:
  - Traditional balance: $800,000
  - RMD divisor: 24.6
  - RMD amount: $800,000 / 24.6 = $32,520
  - This $32,520 is in currentAGI when planTaxOptimizedYear() is called
  - If target bracket ceiling is $63,475 and SS is $30,000:
    - Total fixed income: $30,000 + $32,520 = $62,520
    - Remaining bracket space: $63,475 - $62,520 = $955
    - Very little room for additional Traditional spending
```

**Important:** The `currentAGI` parameter passed to `planTaxOptimizedYear()` must INCLUDE:
- RMD amount (already withdrawn)
- Social Security (passed separately but affects effective rate)
- Pension income
- Dividends/interest from taxable accounts
- Any other ordinary income

### 7. RMD Age Behavior (Policy Choice - Not Law)

**Decision:** Skip Roth conversions after RMD age starts BY DEFAULT.

**Rationale:**
- RMDs are mandatory Traditional withdrawals
- After RMDs start, the Traditional balance is already being drawn down
- Doing conversions ON TOP of RMDs would stack taxable income
- The strategy shifts from "convert early" to "let RMDs naturally deplete"

**What Happens Instead:**
- RMDs fill lower brackets automatically
- Any bracket space above RMD is left unused (or could be filled with Traditional spending)
- Roth is preserved for spending above bracket space

**When Post-RMD Conversions WOULD Make Sense:**
- RMDs alone do not fill the target bracket (low balance)
- State tax arbitrage (moving to lower-tax state)
- Widow(er) penalty looming (filing status change coming)
- Estate planning (reducing Traditional for heirs)

**Configuration Flags:**
```typescript
// Add to AssumptionsState
interface TaxOptimizationSettings {
    enabled: boolean;
    allowPostRMDConversions?: boolean;  // Default: false
    acaSubsidyAware?: boolean;          // Default: true for ages < 65
}
```

**Test Assertion:**
```typescript
// Verify this is a policy choice, not an accident
test('post-RMD years do not convert by design', () => {
    const year = simulationAtAge75;
    expect(year.rothConversion).toBe(0);
    expect(year.logs).toContain('Post-RMD conversions disabled by policy');
});
```

This is documented as an explicit policy choice that may be made configurable in the future.

### 8. Inflation-Adjusted Mode
When `inflationAdjusted` is true:
- Use real growth rate (nominal - inflation)
- Tax brackets are in today's dollars
- Don't inflate future bracket ceilings

When `inflationAdjusted` is false:
- Use nominal growth rate
- Need to inflate tax brackets to future years for comparison

### 9. Growth Rate Timing Assumption

The projection formula `projectBalanceAtRMD()` assumes conversions occur at year-start (before growth). This means:

```
Year N balance = (Year N-1 balance - conversion) × (1 + growth)
```

**Important:** Ensure `SimulationEngine.tsx` applies operations in this order:
1. Calculate conversion amount
2. Execute conversion (reduce Traditional)
3. Apply growth to remaining balance

If the actual simulation applies growth before conversions, the projection will be slightly optimistic (actual balance will be higher than projected).

**Consistency Check:** The order of operations in `SimulationEngine.tsx` should match the order assumed in `projectBalanceAtRMD()`. If they differ, add a correction factor or adjust the projection formula.

---

## Helper Functions Needed

### `getRMDDivisor(age: number): number`
Returns the RMD distribution period for a given age. Already exists in RMD data.

### `getRMDStartAge(birthYear: number): number`
Returns 73 or 75 depending on birth year. Already exists.

### `getBracketForIncome(taxableIncome: number, taxParams: TaxParameters): number`
Returns the marginal bracket rate for a given income level.

### `getFixedIncomeAtRMD(incomes: AnyIncome[], rmdYear: number): number`
Projects Social Security and pension income at RMD age. Needs to:
- Find SS income objects and get their benefit amount
- Find pension income objects and get their amount
- Account for inflation if applicable

### `getAcaCliffThreshold(filingStatus, year): number`
Get the ACA subsidy cliff threshold (400% FPL) for a given year and filing status.
Values should be updated annually when FPL is published (typically January).

```typescript
function getAcaCliffThreshold(
    filingStatus: 'single' | 'married_filing_jointly',
    year: number
): number {
    // Base FPL values by year (update annually when published)
    // 400% FPL = threshold where ACA subsidies phase out completely
    const FPL_BASE: Record<number, { single: number; couple: number }> = {
        2024: { single: 15_060, couple: 20_440 },
        2025: { single: 15_650, couple: 21_150 },  // Estimated
        2026: { single: 16_100, couple: 21_750 },  // Estimated ~3% inflation
    };

    // Use most recent known year if future year requested
    const knownYears = Object.keys(FPL_BASE).map(Number).sort((a, b) => b - a);
    const useYear = knownYears.find(y => y <= year) || knownYears[0];
    const fpl = FPL_BASE[useYear];

    const baseFPL = filingStatus === 'single' ? fpl.single : fpl.couple;

    // 400% FPL is the cliff
    return baseFPL * 4;
}

// Example results:
// 2024 single: $60,240
// 2024 MFJ:    $81,760
// 2025 single: $62,600 (estimated)
```

---

## Testing Strategy

### Unit Tests for Each Function

1. **calculateEffectiveRateConversionLimit**
   - No SS (falls back to simple bracket calc)
   - SS torpedo in effect (effective rate >> nominal bracket)
   - Already above target rate (return 0)
   - Binary search convergence

2. **calculateIdealTargetBalance**
   - Low fixed income (lots of room)
   - High fixed income (no room in target bracket)
   - Different RMD ages (73 vs 75)

3. **projectBalanceAtRMD**
   - Verify growth math
   - Conversions exceed balance (should floor at 0)
   - Zero years remaining

4. **calculateDynamicConversionCeiling**
   - Case where 12% is achievable (should stay at 12%)
   - Case where ceiling needs to rise (iterate to equilibrium)
   - **Verify ceiling only rises ONE bracket per iteration**
   - **Verify ceiling never exceeds 32%**
   - Already at RMD age (no conversions)

5. **calculateTargetTraditionalBalance / calculateConversionThisYear**
   - Above target (needs conversions)
   - Below target (no conversions)
   - **Verify damping: never more than 20% of excess in one year**
   - **Verify bracket cap is respected**

6. **planTaxOptimizedYear**
   - Phase 1: Brokerage available
   - Phase 2: Brokerage depleted
   - Early withdrawal penalty handling
   - Edge cases (no Traditional, no Roth, etc.)
   - **Tax payment source selection**
   - **Withholding calculation when no other funds**

### Anti-Oscillation Tests (CRITICAL)

These tests ensure the algorithm is stable year-over-year:

1. **Ceiling Stability Test**
   ```
   Run 5-year simulation
   Assert: conversionCeiling changes by at most ONE bracket between any two years
   Assert: conversionCeiling generally non-decreasing UNLESS structural change occurs

   // Structural changes that allow ceiling decrease:
   const STRUCTURAL_CHANGE_EVENTS = [
       'SS_BENEFITS_START',
       'SS_BENEFITS_CHANGE',
       'PENSION_START',
       'PENSION_STOP',
       'FILING_STATUS_CHANGE',
       'SPOUSE_DEATH'
   ];

   // When ceiling decreases, require explanation:
   if (currentCeiling < previousCeiling) {
       assert(year.structuralChanges.length > 0);
       assert(previousCeiling - currentCeiling <= ONE_BRACKET);
       console.log(`Ceiling decreased: ${previousCeiling} → ${currentCeiling} due to: ${year.structuralChanges}`);
   }
   ```

2. **Conversion Amount Stability Test**
   ```
   Run 5-year simulation with stable inputs (same expenses, growth)
   Assert: conversionAmount doesn't vary by more than 30% year-over-year
   Assert: No year has conversion > 2× previous year
   ```

3. **No Wild Swings Test**
   ```
   Given: $1M Traditional, 20 years to RMD
   Run simulation
   Assert: Year 1 conversion < $100k (not trying to do it all at once)
   Assert: Conversion amounts are roughly similar across years
   ```

### Effective Rate Tests (CRITICAL)

These tests ensure we stop converting at the right point:

1. **SS Torpedo Respect Test**
   ```
   Given: $30k AGI, $35k SS, target rate 22%
   Calculate effective rate conversion limit
   Assert: Returns much less than naive bracket space
   Assert: At returned limit, effective rate ≈ 22% (not 15%)
   ```

2. **Conversion Stops at Effective Rate Test**
   ```
   Given: Scenario where SS torpedo is active
   Run planTaxOptimizedYear
   Assert: effectiveRateAtConversion <= projectedRMDBracket
   Assert: effectiveRateAtConversion is checked, not nominal bracket
   ```

3. **LTCG Bump Zone Test**
   ```typescript
   test('detects LTCG bump zone and stops converting', () => {
       // Setup: Ordinary income at $44k, LTCG of $20k
       // $1 more ordinary income pushes LTCG from 0% to 15%
       const result = coarseToFineSearch(
           0.22,  // target 22%
           traditionalBalance: 100_000,
           ordinaryIncome: 44_000,
           ltcgIncome: 20_000,
           socialSecurity: 0,
           taxParams
       );

       // Should detect the bump zone
       expect(result.edgeType).toBe('LTCG_BUMP');
       // Should return amount that keeps LTCG in 0% bracket
       expect(result.amount).toBeLessThan(5_000);
   });
   ```

### Survival Spending Priority Tests (CRITICAL)

These tests ensure spending always comes before conversions:

1. **Spending Fills Bracket - No Conversions**
   ```typescript
   test('conversions are zero when spending fills target bracket', () => {
       const plan = planTaxOptimizedYear({
           deficit: 60_000, rothBalance: 0, traditionalBalance: 500_000, conversionCeiling: 0.22
       });
       expect(plan.withdrawals.traditional).toBe(60_000);
       expect(plan.conversionAmount).toBeLessThanOrEqual(3_000);  // ~$3k bracket space left
   });
   ```

2. **Spending Exceeds Bracket - Still Withdraws**
   ```typescript
   test('withdraws for spending even if it exceeds target bracket', () => {
       const plan = planTaxOptimizedYear({
           deficit: 80_000, rothBalance: 10_000, traditionalBalance: 500_000, conversionCeiling: 0.22
       });
       expect(plan.withdrawals.traditional + plan.withdrawals.roth).toBe(80_000);
       expect(plan.conversionAmount).toBe(0);  // Already over ceiling
       expect(plan.effectiveRateAfterAllocation).toBeGreaterThan(0.22);  // Survival trumps bracket
   });
   ```

3. **Invariant Reduces Conversions Not Spending**
   ```typescript
   test('invariant violation reduces conversions, not spending', () => {
       const plan = planTaxOptimizedYear({/* setup that triggers invariant */});
       expect(plan.withdrawals.traditional).toBe(40_000);  // Spending unchanged
       expect(plan.conversionAmount).toBeLessThan(30_000);  // Conversion reduced
   });
   ```

### State Tax Integration Tests

1. **Uses Actual State Tax Calculation**
   ```typescript
   test('withholding includes actual state tax', () => {
       // Setup: California resident
       const taxState = { residenceState: 'CA', filingStatus: 'single' };
       const result = calculateConversionWithholding(
           conversionAmount: 100_000,
           currentAGI: 50_000,
           socialSecurity: 0,
           taxState,
           taxParams
       );

       // Should include both federal and CA state tax
       expect(result.federalTax).toBeGreaterThan(0);
       expect(result.stateTax).toBeGreaterThan(0);  // CA has income tax
       expect(result.totalTax).toBe(result.federalTax + result.stateTax);
   });

   test('no-income-tax state has zero state tax', () => {
       const taxState = { residenceState: 'TX', filingStatus: 'single' };
       const result = calculateConversionWithholding(
           conversionAmount: 100_000,
           currentAGI: 50_000,
           socialSecurity: 0,
           taxState,
           taxParams
       );

       expect(result.stateTax).toBe(0);  // Texas has no income tax
       expect(result.totalTax).toBe(result.federalTax);
   });
   ```

2. **Early Withdrawal Penalty Gross-Up**
   ```typescript
   test('withholding is grossed up for under-59.5', () => {
       // Setup: $100k conversion, $22k federal, $9k state = $31k total tax
       const result = calculateWithholdingWithPenalty(
           conversionAmount: 100_000,
           totalTax: 31_000,  // Federal + state from actual calculation
           age: 55
       );

       // With 10% penalty: $31,000 / 0.90 = $34,444
       expect(result.grossWithholding).toBeCloseTo(34_444, 0);
       expect(result.penaltyAmount).toBeCloseTo(3_444, 0);
       expect(result.netToRoth).toBeCloseTo(65_556, 0);
   });

   test('no penalty gross-up at 59.5+', () => {
       const result = calculateWithholdingWithPenalty(
           conversionAmount: 100_000,
           totalTax: 31_000,
           age: 60
       );

       expect(result.grossWithholding).toBe(31_000);
       expect(result.penaltyAmount).toBe(0);
       expect(result.netToRoth).toBe(69_000);
   });
   ```

### Calculation Order Invariant Tests (CRITICAL)

These tests verify the survival-first priority works correctly:

1. **Effective Rate Invariant Test (With Spending Exception)**
   ```typescript
   test('effective rate respects ceiling OR is due to mandatory spending', () => {
       for (const year of simulation) {
           if (year.phase === 'TAX_OPTIMIZED') {
               const effectiveRate = calculateEffectiveRateAfterAllocation(
                   year.conversion + year.traditionalSpending,
                   year.socialSecurity,
                   year.ltcgIncome
               );

               // Either: rate is within ceiling
               // OR: rate exceeds ceiling but conversions are 0 (spending-only)
               const withinCeiling = effectiveRate <= year.conversionCeiling + EPSILON;
               const spendingOnlyExcess = effectiveRate > year.conversionCeiling && year.conversion === 0;

               expect(withinCeiling || spendingOnlyExcess).toBe(true);

               // If spending alone exceeds ceiling, verify it was necessary
               if (spendingOnlyExcess) {
                   expect(year.logs).toContain('Spending required exceeds bracket ceiling');
               }
           }
       }
   });
   ```

2. **Conversion Reduces First Test (Not Spending)**
   ```typescript
   test('when invariant would be violated, conversion reduces not spending', () => {
       // Setup: scenario where conversion + spending would exceed effective rate target
       // The system should reduce conversion, NOT spending (spending is survival)
       const plan = planTaxOptimizedYear({
           deficit: 50_000,          // Non-negotiable spending need
           rawConversionAmount: 40_000,
           totalBracketSpace: 60_000  // Less than spending + conversion
       });

       // Spending is preserved (survival is non-negotiable)
       expect(plan.withdrawals.traditional).toBeGreaterThanOrEqual(
           Math.min(50_000, plan.traditionalBalance)
       );

       // Conversion is reduced to fit remaining space
       expect(plan.conversionAmount).toBeLessThan(40_000);
   });
   ```

3. **Spending Can Exceed Ceiling When Necessary**
   ```typescript
   test('spending exceeds ceiling when Roth insufficient', () => {
       // Setup: need $100k spending, only $20k Roth, target bracket $50k
       const plan = planTaxOptimizedYear({
           deficit: 100_000,
           rothBalance: 20_000,
           traditionalBalance: 500_000,
           conversionCeiling: 0.22  // ~$63k bracket
       });

       // Must withdraw from Traditional to survive
       expect(plan.withdrawals.traditional).toBe(80_000);  // $100k - $20k Roth

       // This WILL exceed the 22% bracket, but it's mandatory
       expect(plan.effectiveRateAfterAllocation).toBeGreaterThan(0.22);

       // NO conversions when spending already exceeds ceiling
       expect(plan.conversionAmount).toBe(0);
   });
   ```

### Tax Funding Invariant Tests (CRITICAL)

1. **No Unfunded Tax Liability Test**
   ```typescript
   test('conversion taxes are always funded', () => {
       for (const year of simulation) {
           const actualTax = calculateActualConversionTax(year.conversion);
           const fundedTax = year.taxPaymentFromBrokerage +
                            year.taxPaymentFromSavings +
                            year.conversionWithholding;
           expect(fundedTax).toBeGreaterThanOrEqual(actualTax - EPSILON);
       }
   });
   ```

2. **Withholding Accuracy Test**
   ```typescript
   test('withholding includes safety buffer', () => {
       // When withholding is the only option
       const plan = planWithOnlyTraditionalBalance();
       const actualTax = calculateActualConversionTax(plan.conversion);
       const withholding = plan.conversionWithholding;

       // Withholding should be >= actual tax (includes 3% buffer)
       expect(withholding).toBeGreaterThanOrEqual(actualTax);
       expect(withholding).toBeLessThanOrEqual(actualTax * 1.05); // Not excessive
   });
   ```

### Savings Interest Double-Counting Invariant (CRITICAL)

This test catches the class of bug where interest is counted twice (once in income, once in account growth):

```typescript
test('savings interest is not double counted', () => {
    for (const year of simulation) {
        const expectedInterest = year.accounts
            .filter(a => a.type === 'SAVINGS' || a.type === 'BROKERAGE')
            .reduce((sum, a) => sum + (a.balanceStart * a.interestRate), 0);

        expect(year.cashflow.interestIncome).toBeCloseTo(expectedInterest, 2);

        // Also verify accounts don't grow by more than:
        // contributions + interest - withdrawals
        for (const account of year.accounts) {
            const maxGrowth = account.contributions +
                             (account.balanceStart * account.interestRate) -
                             account.withdrawals;
            const actualGrowth = account.balanceEnd - account.balanceStart;
            expect(actualGrowth).toBeLessThanOrEqual(maxGrowth + EPSILON);
        }
    }
});

// Run across multi-year scenarios with partial withdrawals
test('savings interest correct with partial withdrawals', () => {
    // Setup: savings with $100k, withdraw $50k mid-year
    // Interest should be on average balance, not start or end
    // This is the exact class of bug that caused issues before
});
```

### ACA Cliff Tests

1. **ACA Cliff Respects Subsidy Threshold**
   ```typescript
   test('caps conversions to stay under 400% FPL when ACA-aware', () => {
       // Setup: Single filer under 65, ACA cliff at ~$58,320
       const plan = planTaxOptimizedYear({
           age: 55,
           currentAGI: 30_000,
           socialSecurityThisYear: 0,  // Not yet receiving SS
           rawConversionAmount: 50_000,  // Would push to $80k
           acaSubsidyAware: true
       });

       // Should cap to stay under ACA cliff
       const totalMAGI = plan.currentAGI + plan.conversionAmount;
       expect(totalMAGI).toBeLessThan(58_320 - 1_000);  // $1k buffer
       expect(plan.conversionAmount).toBeLessThan(50_000);
   });

   test('ignores ACA cliff when disabled', () => {
       const plan = planTaxOptimizedYear({
           age: 55,
           currentAGI: 30_000,
           rawConversionAmount: 50_000,
           acaSubsidyAware: false  // Disabled
       });

       // No ACA cap applied
       expect(plan.conversionAmount).toBe(50_000);
   });

   test('ACA cliff ignored after age 65', () => {
       const plan = planTaxOptimizedYear({
           age: 66,  // Medicare eligible
           currentAGI: 30_000,
           rawConversionAmount: 50_000,
           acaSubsidyAware: true
       });

       // Age 65+ ignores ACA cliff
       expect(plan.conversionAmount).toBe(50_000);
   });
   ```

### Phase Transition Tests

1. **Brokerage Transition Phase Detection**
   ```typescript
   test('enters BROKERAGE_TRANSITION when 0.5-2 years of expenses remain', () => {
       const plan = planTaxOptimizedYear({ deficit: 60_000, brokerageBalance: 90_000 });
       expect(plan.phase).toBe('BROKERAGE_TRANSITION');
   });

   test('reduces conversions during transition phase', () => {
       const normal = planTaxOptimizedYear({ deficit: 60_000, brokerageBalance: 200_000 });
       const transition = planTaxOptimizedYear({ deficit: 60_000, brokerageBalance: 90_000 });
       expect(transition.conversionAmount).toBeLessThan(normal.conversionAmount);
   });
   ```

2. **Roth Depleted Phase Detection**
   ```typescript
   test('enters ROTH_DEPLETED when Roth < 0.5 years expenses', () => {
       const plan = planTaxOptimizedYear({ deficit: 60_000, brokerageBalance: 0, rothBalance: 20_000 });
       expect(plan.phase).toBe('ROTH_DEPLETED');
   });

   test('no conversions in ROTH_DEPLETED phase', () => {
       const plan = planTaxOptimizedYear({ deficit: 60_000, brokerageBalance: 0, rothBalance: 10_000 });
       expect(plan.phase).toBe('ROTH_DEPLETED');
       expect(plan.conversionAmount).toBe(0);
       expect(plan.withdrawals.traditional).toBe(60_000);
   });
   ```

### Dynamic Damping Tests

1. **Damping Factor Varies With Years Until RMD**
   ```typescript
   test('conservative damping with many years remaining', () => {
       expect(getDampingFactor(20)).toBe(0.15);  // 15% of excess
       expect(getDampingFactor(15)).toBe(0.15);
   });

   test('moderate damping with medium years remaining', () => {
       expect(getDampingFactor(10)).toBe(0.20);
       expect(getDampingFactor(7)).toBe(0.25);
       expect(getDampingFactor(5)).toBe(0.30);
   });

   test('aggressive damping with few years remaining', () => {
       expect(getDampingFactor(3)).toBe(0.40);
       expect(getDampingFactor(2)).toBe(0.50);
       expect(getDampingFactor(1)).toBe(0.50);
   });
   ```

2. **Conversion Amount Respects Damping**
   ```typescript
   test('conversion limited by damping factor', () => {
       const result = calculateConversionThisYear({
           currentBalance: 1_000_000, effectiveTarget: 400_000, yearsUntilRMD: 20
       });
       expect(result).toBeLessThanOrEqual(600_000 * 0.15);  // $90k max (15% of excess)
   });
   ```

### Fast-Path Tests

```typescript
test('uses simple bracket math when SS=0 and LTCG=0', () => {
    const result = calculateEffectiveRateConversionLimit({
        currentAGI: 5_000, socialSecurityBenefits: 0, ltcgIncome: 0
    });
    expect(result.maxConversion).toBeGreaterThan(80_000);  // Full bracket space
    expect(result.edgeType).toBe('BRACKET_EDGE');
});

test('uses coarse-to-fine when SS present', () => {
    const result = calculateEffectiveRateConversionLimit({
        currentAGI: 5_000, socialSecurityBenefits: 30_000, ltcgIncome: 0
    });
    expect(result.maxConversion).toBeLessThan(60_000);  // Reduced by torpedo
});
```

### Invariant Recalculation Tests

```typescript
test('recalculates tax payment after invariant fix reduces conversion', () => {
    const plan = planTaxOptimizedYear({
        socialSecurityThisYear: 30_000, savingsBalance: 15_000, brokerageBalance: 0
    });
    if (plan.conversionAmount < 50_000) {
        expect(plan.taxPaymentSource).toBe('SAVINGS');  // Now affordable from savings
    }
});

test('conversion reduced to zero sets taxPaymentSource to NONE', () => {
    const plan = planTaxOptimizedYear({ socialSecurityThisYear: 40_000, deficit: 70_000 });
    if (plan.conversionAmount === 0) {
        expect(plan.taxPaymentSource).toBe('NONE');
    }
});
```

### Golden Master Snapshot Tests

**IMPORTANT:** Golden master tests require explicit review gates to prevent silent regressions.

**Review Gate Requirements:**
- Tests fail if snapshot changes without `--accept-changes` flag
- Changes must log key metrics for manual review
- CI should block on snapshot changes until reviewed

```typescript
// vitest.config.ts or test setup
const SNAPSHOT_REVIEW_METRICS = [
    'lifetimeTaxes',
    'peakMarginalRate',
    'maxSingleYearConversion',
    'yearBrokerageDepleted',
    'finalTraditionalBalance'
];

function logSnapshotMetrics(simulation: SimulationYear[]) {
    console.log('=== SNAPSHOT METRICS FOR REVIEW ===');
    console.log(`Lifetime Taxes: $${calculateLifetimeTaxes(simulation).toLocaleString()}`);
    console.log(`Peak Marginal Rate: ${(findPeakMarginalRate(simulation) * 100).toFixed(1)}%`);
    console.log(`Max Single-Year Conversion: $${findMaxConversion(simulation).toLocaleString()}`);
    console.log(`Year Brokerage Depleted: ${findBrokerageDepletionYear(simulation)}`);
    console.log(`Final Traditional Balance: $${simulation[simulation.length - 1].traditionalBalance.toLocaleString()}`);
    console.log('===================================');
}
```

1. **FIRE Scenario Snapshot**
   ```
   Given: Reference scenario ($841k Trad, $581k Brokerage, $213k Roth, retire at 40)
   Run full simulation with tax optimization ON

   // Log metrics for review
   logSnapshotMetrics(simulation);

   Snapshot:
     - Year-by-year conversion amounts
     - Year-by-year withdrawal sources
     - Traditional balance trajectory
     - Total lifetime taxes

   Assert: Matches saved snapshot
   On mismatch: Log metric deltas, require --accept-changes to update
   ```

2. **Traditional Retiree Snapshot**
   ```
   Given: $500k Trad, $200k Brokerage, retire at 65, SS at 67
   Run full simulation

   logSnapshotMetrics(simulation);

   Snapshot: Same as above
   Assert: Matches saved snapshot
   ```

3. **Snapshot Change Detection**
   ```typescript
   test('snapshot changes are flagged for review', () => {
       const result = runSnapshot('FIRE_scenario');

       if (result.changed) {
           console.log('SNAPSHOT CHANGED - Review required:');
           console.log(`Lifetime taxes: ${result.old.lifetimeTaxes} → ${result.new.lifetimeTaxes}`);
           console.log(`Delta: ${result.new.lifetimeTaxes - result.old.lifetimeTaxes}`);

           if (!process.env.ACCEPT_SNAPSHOT_CHANGES) {
               throw new Error('Snapshot changed. Run with ACCEPT_SNAPSHOT_CHANGES=1 after review.');
           }
       }
   });
   ```

### Integration Tests

1. **Full Simulation with Reference Scenario**
   - $841k Trad, $581k Brokerage, $213k Roth
   - Retire at 40, SS at 67
   - Verify conversions happen in gap years
   - Verify brokerage used for spending in Phase 1
   - Verify Roth becomes primary spending source in Phase 2
   - **Verify no year has effective rate > projected RMD rate**

2. **Comparison: Optimization ON vs OFF**
   - Run same scenario both ways
   - Verify lifetime taxes are lower (or equal) with optimization
   - Verify no deficits in either case
   - **Verify success rate is maintained or improved**

3. **Tax Payment Funding Test**
   - Scenario with limited brokerage
   - Verify taxes are funded (not left as unfunded liability)
   - Verify withholding is applied when no other source available

---

## UI Updates (WithdrawalTab.tsx)

Replace placeholder values with real calculations:

```typescript
const optimizationSummary = useMemo(() => {
    if (!taxOptimizationEnabled || simulation.length === 0) return null;

    // Get first retirement year from simulation
    const retirementYear = simulation.find(y => y.activeMilestones?.includes(BUILTIN_MILESTONE_IDS.RETIRE));
    if (!retirementYear) return null;

    // Run the ceiling calculation for display
    const ceilingResult = calculateDynamicConversionCeiling(...);
    const targetResult = calculateTargetTraditionalBalance(...);

    return {
        effectiveTarget: targetResult.effectiveTarget,
        projectedRMDBracket: ceilingResult.projectedRMDBracket,
        conversionCeiling: ceilingResult.conversionCeiling,
        idealTarget: ceilingResult.idealTargetBalance,
        isIdealAchievable: targetResult.idealTarget <= targetResult.realisticTarget
    };
}, [taxOptimizationEnabled, simulation, ...]);
```

Display:
```
Target Traditional Balance: $487,000 at age 73
Projected RMD Bracket: 22%
Converting up to: 22% bracket
Status: On track to reach target
```

Or if unachievable:
```
Target Traditional Balance: $4.3M at age 73 (ideal would be $400k)
Projected RMD Bracket: 35%
Converting up to: 32% bracket
Status: Converting maximum possible - RMDs will be in high bracket
```

---

## Resolved Questions

1. **Should we cap conversions based on available cash to pay taxes?**
   - **RESOLVED:** Yes. See "Tax Payment Funding" section.
   - Priority: Brokerage → Savings → Withhold from conversion
   - Never create unfunded tax liability

2. **How to handle state taxes in ceiling calculation?**
   - **RESOLVED:** Use federal brackets only for ceiling calculation.
   - State taxes are calculated using actual TaxService marginal rate when withholding.
   - Future enhancement: State-specific ceiling adjustment.

3. **Should conversion ceiling ever exceed 32%?**
   - **RESOLVED:** No. Hard cap at 32% regardless of RMD projection.
   - Even if RMDs will be 37%, converting at 35% provides limited benefit for high current-year tax cost.

4. **How to handle circular dependency between conversions and spending?**
   - **RESOLVED:** See Critical Design Principles #5.
   - Fixed calculation order: survival spending first, conversions get remaining space
   - Traditional spending fills bracket space (up to deficit) before conversions
   - Invariant assertion after allocation; reduce conversions if violated (not spending)

5. **Should conversions continue after RMD age?**
   - **RESOLVED:** No, by default. See "RMD Age Behavior" section.
   - This is a policy choice, documented as such
   - Future flag: `allowPostRMDConversions` for edge cases

## Limitations & Future Work

The following are intentional scope boundaries for the initial implementation:

| # | Limitation | Impact | Future Enhancement |
|---|------------|--------|-------------------|
| 1 | **Roth Conversion Lot Tracking** - No 5-year rule tracking | May overestimate available Roth in early years | Track lots with dates |
| 2 | **Brokerage Lot Selection** - Uses average cost basis | Misses tax-loss harvesting opportunities | Track individual lots |
| 3 | **Growth Rate Timing** - End-of-year application | Slight timing differences (self-canceling) | — |
| 4 | **ACA Cliff** - Single/MFJ thresholds only | May miss household-size nuances | Full FPL calculations |
| 5 | **State Tax Arbitrage** - No planned-move detection | May convert in high-tax state | Add state change events |
| 6 | **Widow(er) Penalty** - No filing status change handling | Suboptimal post-spouse-death optimization | Detect death events |
| 7 | **NIIT** - Not modeled in conversion ceiling | Underestimates rates at high incomes | Include in effective rate |
| 8 | **MFJ Handling** - Spec focuses on single filer | MFJ has different brackets/thresholds | Extend all calculations |

**SS Taxation Thresholds (for reference):**
- Single: 0% up to $25k, 50% to $34k, 85% above
- MFJ: 0% up to $32k, 50% to $44k, 85% above

---

## Implementation Order

1. **Create types**
   - ConversionCeilingResult, TargetBalanceResult, TaxOptimizedYearPlan
   - Update Phase type to include all four phases
   - Add TaxOptimizationSettings with `acaSubsidyAware` flag

2. **Implement helper functions**
   - `calculateSimpleBracketSpace()` - for fast-path
   - `getDampingFactor()` - dynamic damping based on years remaining
   - `getAcaCliffThreshold()` - ACA subsidy cliff thresholds
   - getRMDDivisor wrapper

3. **Implement calculateIdealTargetBalance**

4. **Implement projectBalanceAtRMD**

5. **Implement calculateEffectiveRateConversionLimit**
   - Add fast-path for SS=0 and LTCG=0 cases
   - Implement coarse-to-fine search with correct edge type thresholds

6. **Implement calculateDynamicConversionCeiling** (with tests)
   - Verify bracket progression caps
   - Verify 32% hard ceiling

7. **Implement calculateTargetTraditionalBalance** (with tests)
   - Integrate dynamic damping
   - Verify three-way min() logic

8. **Implement planTaxOptimizedYear** (with tests)
   - Implement all four phases (BROKERAGE_AVAILABLE, BROKERAGE_TRANSITION, BROKERAGE_DEPLETED, ROTH_DEPLETED)
   - Add ACA cliff ceiling (Step 6b)
   - Implement invariant check with recalculation (Step 9)
   - Verify survival spending priority

9. **Integrate with SimulationEngine**
   - Verify operation order matches timing assumption
   - Pass conversion amount to RothConversionService
   - Pass withdrawal plan to WithdrawalService

10. **Update RothConversionService** to accept pre-calculated amount

11. **Update WithdrawalService** to accept withdrawal plan

12. **Update UI** with real values
    - Optimization summary display
    - Phase indicators
    - Conversion ceiling and target balance

13. **Unit tests** for each function
    - ACA cliff tests
    - Phase transition tests
    - Dynamic damping tests
    - Fast-path tests
    - Invariant recalculation tests

14. **Integration tests** with reference scenario
    - Full simulation comparison (ON vs OFF)
    - Lifetime tax verification
    - Success rate comparison

---

## Implementation Approach: Test-Driven Development

**Recommendation:** Implement using TDD (Test-Driven Development). The test cases in this document are well-specified enough to drive the implementation.

### TDD Workflow

```
1. Write failing test based on spec (e.g., getDampingFactor tests from Section 5)
2. Run tests → they fail
3. Implement function to match spec
4. Run tests → they pass
5. Refactor if needed, ensure tests still pass
```

**Example:** For `getDampingFactor()`, write tests based on the spec in Section 5, then implement the function. The spec already defines exact input/output pairs.

### Suggested TDD Order

```
Phase 1: Core Calculation Functions (with unit tests)
├── 1. getDampingFactor() + tests
├── 2. getAcaCliffThreshold() + tests
├── 3. calculateSimpleBracketSpace() + tests
├── 4. calculateEffectiveRateWithLTCG() + tests
├── 5. coarseToFineSearch() + tests (including fast-path)
├── 6. calculateEffectiveRateConversionLimit() + tests
├── 7. calculateIdealTargetBalance() + tests
├── 8. projectBalanceAtRMD() + tests
├── 9. calculateDynamicConversionCeiling() + tests
├── 10. calculateConversionThisYear() + tests
└── 11. calculateTargetTraditionalBalance() + tests

Phase 2: Tax Calculation Functions (with unit tests)
├── 12. calculateConversionWithholding() + tests
└── 13. calculateWithholdingWithPenalty() + tests

Phase 3: Master Planning Function (with unit tests)
└── 14. planTaxOptimizedYear() + tests
    ├── Phase detection tests
    ├── ACA cliff tests
    ├── Survival spending priority tests
    ├── Invariant recalculation tests
    └── Phase transition tests

Phase 4: Integration (with integration tests)
├── 15. Integrate with SimulationEngine
├── 16. Update RothConversionService
├── 17. Update WithdrawalService
└── 18. Golden master snapshot tests

Phase 5: UI (manual testing)
└── 19. Update WithdrawalTab.tsx
```

### Key Test Files to Create

```
src/services/simulation/__tests__/
├── TaxOptimizedWithdrawal.test.ts           # Unit tests for all calculation functions
├── TaxOptimizedWithdrawal.integration.test.ts  # Integration with SimulationEngine
└── TaxOptimizedWithdrawal.snapshot.test.ts     # Golden master tests
```

### Benefits of TDD Approach

1. **Catches spec deviations early** - Tests encode the expected behavior from the spec
2. **Enables safe refactoring** - Can restructure code confidently
3. **Documents behavior** - Tests serve as executable documentation
4. **Reduces debugging time** - Failures pinpoint exactly what broke
5. **Builds confidence** - Green tests confirm correctness before integration
