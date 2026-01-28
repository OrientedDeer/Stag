# Tax Optimization Implementation Review

## Overview

This document contains review feedback on `TAX_OPTIMIZATION_IMPLEMENTATION.md` and `TAX_OPTIMIZATION_SPEC.md`. Use this to guide implementation changes.

---

## Critical Issues (Fix Before Implementation)

### 1. ACA Subsidy Cliff Awareness (FIRE-Critical)

**Problem:** For early retirees under 65, ACA subsidies are based on MAGI. The cliff at 400% FPL can cost $10-20k+ if crossed. A conversion pushing from 399% to 401% FPL is catastrophically expensive. This is not modeled.

**Solution:** Add optional ACA-aware mode that caps conversions to stay under the subsidy cliff.

```typescript
// Add to AssumptionsState or TaxOptimizationSettings
interface TaxOptimizationSettings {
    enabled: boolean;
    allowPostRMDConversions?: boolean;
    acaSubsidyAware?: boolean;  // NEW: Cap conversions to preserve ACA subsidies
}

// In calculateDynamicConversionCeiling or planTaxOptimizedYear:
function applyAcaCeiling(
    conversionLimit: number,
    currentAGI: number,
    socialSecurity: number,
    currentAge: number,
    acaSubsidyAware: boolean
): number {
    if (!acaSubsidyAware || currentAge >= 65) {
        return conversionLimit;
    }
    
    // 2024 ACA cliff for single filer ~$58,320 (400% FPL)
    // This should be parameterized and inflation-adjusted
    const ACA_CLIFF_THRESHOLD = 58_320;
    
    // MAGI includes 100% of SS for ACA purposes (different from tax!)
    const currentMAGI = currentAGI + socialSecurity;
    const roomUnderCliff = Math.max(0, ACA_CLIFF_THRESHOLD - currentMAGI);
    
    // Leave $1,000 buffer to avoid accidentally crossing
    const safeRoom = Math.max(0, roomUnderCliff - 1_000);
    
    return Math.min(conversionLimit, safeRoom);
}
```

**Location:** Add to `planTaxOptimizedYear()` after calculating `rawConversionAmount`.

---

### 2. Recalculate Tax After Invariant Fix (Bug)

**Problem:** In step 9, if the invariant fails and conversions are reduced, the tax estimates, `taxPaymentSource`, and `withdrawals` were calculated based on the original (higher) conversion amount. These become stale.

**Solution:** After reducing conversions in the invariant fix, recalculate tax-related values.

```typescript
// Step 9: VERIFY EFFECTIVE RATE INVARIANT
// ... existing code that reduces conversionAmount ...

if (conversionAmount < originalConversionAmount) {
    // MUST recalculate tax estimates with reduced conversion
    if (conversionAmount === 0) {
        taxPaymentSource = 'NONE';
        totalTaxNeeded = 0;
        conversionWithholding = 0;
        netConversionToRoth = 0;
    } else {
        // Recalculate tax on reduced amount
        taxEstimate = calculateConversionWithholding(
            conversionAmount, currentAGI, socialSecurityThisYear, taxState, taxParams
        );
        totalTaxNeeded = taxEstimate.totalTax;
        
        // Re-evaluate tax payment source - reduced conversion might not need withholding
        if (phase === 'BROKERAGE_AVAILABLE') {
            if (brokerageBalance >= deficit + totalTaxNeeded) {
                taxPaymentSource = 'BROKERAGE';
            } else if (savingsBalance >= totalTaxNeeded) {
                taxPaymentSource = 'SAVINGS';
            } else {
                taxPaymentSource = 'WITHHOLD';
            }
        } else {
            // Phase 2 logic
            if (savingsBalance >= totalTaxNeeded) {
                taxPaymentSource = 'SAVINGS';
            } else {
                taxPaymentSource = 'WITHHOLD';
            }
        }
        
        // Recalculate withholding if applicable
        if (taxPaymentSource === 'WITHHOLD') {
            const withholding = calculateWithholdingWithPenalty(
                conversionAmount, totalTaxNeeded, currentAge
            );
            conversionWithholding = withholding.grossWithholding;
            netConversionToRoth = withholding.netToRoth;
        } else {
            conversionWithholding = 0;
            netConversionToRoth = conversionAmount;
        }
    }
    
    // Update withdrawal amounts if taxPaymentSource changed
    // ... update withdrawals object accordingly ...
}
```

**Location:** Step 9-10 in `planTaxOptimizedYear()`.

---

### 3. Dynamic Damping Factor Based on Years Remaining

**Problem:** The fixed 20% damping factor is too conservative when time is short. With 3 years until RMD, you need 33%+ per year to hit target.

**Solution:** Make damping a function of years remaining.

```typescript
// Replace this:
const dampedMax = (currentBalance - effectiveTarget) * 0.20;

// With this:
function getDampingFactor(yearsUntilRMD: number): number {
    if (yearsUntilRMD >= 15) return 0.15;  // Very conservative when lots of time
    if (yearsUntilRMD >= 10) return 0.20;
    if (yearsUntilRMD >= 7)  return 0.25;
    if (yearsUntilRMD >= 5)  return 0.30;
    if (yearsUntilRMD >= 3)  return 0.40;
    return 0.50;  // Aggressive when time is very short
}

const dampingFactor = getDampingFactor(yearsUntilRMD);
const dampedMax = (currentBalance - effectiveTarget) * dampingFactor;
```

**Location:** `calculateConversionThisYear()` function.

---

### 4. Phase Transition Smoothing (Avoid Cliff Behavior)

**Problem:** Phase 1→2 transition is binary. If brokerage has $70k and deficit is $68k, you deplete brokerage this year and enter Phase 2 with no cushion. Conversions may have been over-aggressive.

**Solution:** Add a transition zone.

```typescript
// Replace this:
IF brokerageBalance >= deficit:
    phase = 'BROKERAGE_AVAILABLE'
ELSE:
    phase = 'BROKERAGE_DEPLETED'

// With this:
type Phase = 'BROKERAGE_AVAILABLE' | 'BROKERAGE_TRANSITION' | 'BROKERAGE_DEPLETED';

function determinePhase(brokerageBalance: number, deficit: number): Phase {
    const brokerageYears = brokerageBalance / deficit;
    
    if (brokerageYears >= 2.0) {
        return 'BROKERAGE_AVAILABLE';
    } else if (brokerageYears >= 0.5) {
        return 'BROKERAGE_TRANSITION';
    } else {
        return 'BROKERAGE_DEPLETED';
    }
}

// In Phase BROKERAGE_TRANSITION:
// - Use brokerage for spending (like Phase 1)
// - BUT reduce conversion ceiling by one bracket OR
// - Apply additional damping to conversion amounts
// This smooths the transition and preserves some Traditional for Phase 2
```

**Location:** Step 5 in `planTaxOptimizedYear()`, add new handling for transition phase.

---

## Important Additions

### 5. Handle Roth Depletion (Phase 3)

**Problem:** Plan assumes Roth becomes primary spending source in Phase 2, but doesn't handle Roth running out first.

**Solution:** Add explicit Phase 3.

```typescript
type Phase = 'BROKERAGE_AVAILABLE' | 'BROKERAGE_TRANSITION' | 'BROKERAGE_DEPLETED' | 'ROTH_DEPLETED';

// In phase determination:
if (brokerageBalance < deficit * 0.5 && rothBalance < deficit) {
    phase = 'ROTH_DEPLETED';
}

// Phase 3 handling:
IF phase === 'ROTH_DEPLETED':
    // Survival mode - Traditional is primary source regardless of bracket efficiency
    // Log warning about suboptimal tax situation
    log('WARNING: Roth depleted - using Traditional above optimal bracket');
    
    traditionalForSpending = Math.min(deficit, traditionalBalance);
    rothForSpending = Math.min(deficit - traditionalForSpending, rothBalance);
    savingsForSpending = deficit - traditionalForSpending - rothForSpending;
    
    // No conversions when Roth is depleted - no point
    conversionAmount = 0;
```

**Location:** Add to `planTaxOptimizedYear()` phase handling.

---

### 6. Fast-Path for Simple Cases (Performance)

**Problem:** Coarse-to-fine search is only needed when SS torpedo or LTCG bump zone is possible. Gap years with zero SS and zero realized gains can use simple bracket math.

**Solution:** Add fast-path check.

```typescript
function calculateEffectiveRateConversionLimit(
    currentAGI: number,
    socialSecurityBenefits: number,
    ltcgIncome: number,
    targetEffectiveRate: number,
    taxParams: TaxParameters,
    taxState: TaxState
): EffectiveRateLimitResult {
    
    // FAST PATH: No discontinuities possible
    if (socialSecurityBenefits === 0 && ltcgIncome === 0) {
        const simpleBracketSpace = calculateSimpleBracketSpace(
            currentAGI, 
            targetEffectiveRate, 
            taxParams, 
            taxState
        );
        return {
            maxConversion: simpleBracketSpace,
            effectiveRateAtMax: targetEffectiveRate,
            bracketAtMax: targetEffectiveRate,
            edgeType: null
        };
    }
    
    // SLOW PATH: Use coarse-to-fine search for discontinuities
    return coarseToFineSearch(
        targetEffectiveRate,
        traditionalBalance,
        currentAGI,
        socialSecurityBenefits,
        ltcgIncome,
        taxParams
    );
}
```

**Location:** `calculateEffectiveRateConversionLimit()`.

---

## Tax Rule Corrections

### 7. Fix Edge Type Detection Thresholds

**Problem:** Current thresholds may misclassify edge types.

```typescript
// Current (potentially wrong):
if (rate - rateBefore > 0.15) {
    edgeType = 'SS_TORPEDO';
} else if (rate - rateBefore > 0.10) {
    edgeType = 'LTCG_BUMP';
}

// Corrected:
// SS torpedo can cause 22% × 1.85 = 40.7% effective marginal rate at peak
// LTCG bump is exactly 15% (difference between 0% and 15% LTCG rates)
if (rate - rateBefore > 0.25) {
    edgeType = 'SS_TORPEDO';  // 25%+ jump indicates SS torpedo
} else if (rate - rateBefore > 0.12 && ltcgIncome > 0) {
    edgeType = 'LTCG_BUMP';   // ~15% jump with LTCG present
} else {
    edgeType = 'BRACKET_EDGE';
}
```

**Location:** `coarseToFineSearch()` edge type detection.

---

### 8. Document SS Taxation Thresholds

**Requirement:** Ensure `calculateEffectiveConversionTax()` uses correct SS taxation formula.

```typescript
// Combined Income = AGI + tax-exempt interest + 50% of SS benefits
// For simplicity, if no tax-exempt interest:
const combinedIncome = currentAGI + conversionAmount + (socialSecurity * 0.5);

// Single filer thresholds:
const SS_THRESHOLD_1 = 25_000;  // 50% taxable above this
const SS_THRESHOLD_2 = 34_000;  // 85% taxable above this

// MFJ thresholds:
const SS_THRESHOLD_1_MFJ = 32_000;
const SS_THRESHOLD_2_MFJ = 44_000;

function calculateTaxableSS(
    socialSecurityBenefits: number,
    combinedIncome: number,
    filingStatus: 'single' | 'married_filing_jointly'
): number {
    const threshold1 = filingStatus === 'single' ? SS_THRESHOLD_1 : SS_THRESHOLD_1_MFJ;
    const threshold2 = filingStatus === 'single' ? SS_THRESHOLD_2 : SS_THRESHOLD_2_MFJ;
    
    if (combinedIncome <= threshold1) {
        return 0;
    } else if (combinedIncome <= threshold2) {
        // 50% of excess over threshold1, capped at 50% of benefits
        return Math.min(
            (combinedIncome - threshold1) * 0.5,
            socialSecurityBenefits * 0.5
        );
    } else {
        // 85% of excess over threshold2, plus amount from middle bracket
        // Capped at 85% of benefits
        const middleBracketTax = (threshold2 - threshold1) * 0.5;
        const upperBracketTax = (combinedIncome - threshold2) * 0.85;
        return Math.min(
            middleBracketTax + upperBracketTax,
            socialSecurityBenefits * 0.85
        );
    }
}
```

**Location:** Verify this logic exists in `helpers.ts` or add to `TaxOptimizedWithdrawal.ts`.

---

## Documentation Notes (Add to Spec)

### 9. Known Limitations to Document

Add a "Known Limitations" section to the implementation doc:

```markdown
## Known Limitations

### Not Modeled (Future Enhancements)

1. **IRMAA Medicare Surcharges** - For ages 65+, Medicare Part B/D premiums 
   increase based on MAGI from two years prior. High conversion years at 
   ages 63-64 can trigger IRMAA surcharges. Consider adding IRMAA-aware 
   ceiling reduction for ages 63+.

2. **Net Investment Income Tax (NIIT)** - Adds 3.8% tax on investment income 
   above $200k MAGI. Affects effective rate on conversions for high-income years.

3. **Traditional IRA Basis (Non-Deductible Contributions)** - If someone has 
   non-deductible contributions, that basis converts tax-free. Due to pro-rata 
   rule, actual tax is: `taxable = amount × (1 - basis/totalBalance)`. This 
   could make conversions more attractive than calculated.

4. **State Tax Arbitrage** - Moving from high-tax to low-tax state may warrant 
   delaying conversions until after move.

5. **Widow(er) Penalty** - Filing status change after spouse death significantly 
   changes brackets. May warrant more aggressive pre-death conversions.
```

---

### 10. Growth Rate Timing Assumption

Add clarification about when conversions are assumed to occur:

```markdown
### Timing Assumptions

The projection formula `projectBalanceAtRMD()` assumes conversions occur at 
year-start (before growth). This means:

```
Year N balance = (Year N-1 balance - conversion) × (1 + growth)
```

Ensure `SimulationEngine.tsx` applies operations in this order:
1. Calculate conversion amount
2. Execute conversion (reduce Traditional)
3. Apply growth to remaining balance

If the actual simulation applies growth before conversions, the projection 
will be slightly optimistic (actual balance will be higher than projected).
```

---

## Test Cases to Add

### 11. New Test Cases

```typescript
// ACA Cliff Test
test('respects ACA subsidy cliff when enabled', () => {
    const plan = planTaxOptimizedYear({
        currentAge: 55,
        currentAGI: 50_000,
        socialSecurity: 0,
        acaSubsidyAware: true
    });
    
    // Should cap conversion to stay under ~$58k MAGI
    expect(plan.conversionAmount).toBeLessThanOrEqual(8_000);
});

// Phase Transition Test
test('reduces conversions during brokerage transition phase', () => {
    // Brokerage covers 1.5 years of expenses
    const plan = planTaxOptimizedYear({
        deficit: 68_000,
        brokerageBalance: 100_000,  // ~1.5 years
    });
    
    expect(plan.phase).toBe('BROKERAGE_TRANSITION');
    // Should be more conservative than full Phase 1
});

// Roth Depletion Test
test('enters survival mode when Roth depleted', () => {
    const plan = planTaxOptimizedYear({
        deficit: 68_000,
        brokerageBalance: 0,
        rothBalance: 10_000,
        traditionalBalance: 500_000
    });
    
    expect(plan.phase).toBe('ROTH_DEPLETED');
    expect(plan.conversionAmount).toBe(0);
    expect(plan.withdrawals.traditional).toBeGreaterThan(0);
});

// Dynamic Damping Test
test('increases damping factor as RMD approaches', () => {
    const conversion20Years = calculateConversionThisYear({
        yearsUntilRMD: 20,
        currentBalance: 1_000_000,
        effectiveTarget: 400_000
    });
    
    const conversion3Years = calculateConversionThisYear({
        yearsUntilRMD: 3,
        currentBalance: 1_000_000,
        effectiveTarget: 400_000
    });
    
    // 3-year scenario should be more aggressive
    expect(conversion3Years).toBeGreaterThan(conversion20Years * 1.5);
});

// Invariant Recalculation Test
test('recalculates tax payment after invariant fix reduces conversion', () => {
    // Setup scenario where invariant fix reduces conversion
    // from amount requiring withholding to amount payable from savings
    const plan = planTaxOptimizedYear({
        conversionAmount: 100_000,  // Would require withholding
        savingsBalance: 15_000,     // Can cover tax on smaller conversion
        // ... setup that triggers invariant violation
    });
    
    // After reduction, should use savings instead of withholding
    if (plan.conversionAmount < 50_000) {
        expect(plan.taxPaymentSource).not.toBe('WITHHOLD');
    }
});
```

---

## Implementation Order Update

Revise implementation order to include these changes:

```markdown
## Implementation Order

1. **Create types** (add Phase 3, ACA settings)
2. **Implement helper functions** (add getDampingFactor, applyAcaCeiling)
3. **Implement calculateIdealTargetBalance**
4. **Implement projectBalanceAtRMD**
5. **Implement calculateEffectiveRateConversionLimit** (with fast-path)
6. **Implement calculateDynamicConversionCeiling** (with fixed edge detection)
7. **Implement calculateTargetTraditionalBalance** (with dynamic damping)
8. **Implement planTaxOptimizedYear** (with phase transitions, invariant recalc)
9. **Add ACA cliff logic** (if acaSubsidyAware enabled)
10. **Integrate with SimulationEngine**
11. **Update services** (RothConversionService, WithdrawalService)
12. **Update UI** with real values
13. **Unit tests** for each function
14. **Integration tests** with new edge cases
```

---

## Summary Checklist

- [ ] Add ACA subsidy cliff awareness (optional feature)
- [ ] Fix invariant recalculation bug (recalc tax after reducing conversion)
- [ ] Implement dynamic damping based on years remaining
- [ ] Add phase transition smoothing (BROKERAGE_TRANSITION)
- [ ] Add Phase 3 handling (ROTH_DEPLETED)
- [ ] Add fast-path for simple cases (no SS, no LTCG)
- [ ] Fix edge type detection thresholds
- [ ] Verify SS taxation formula in helpers
- [ ] Document known limitations (IRMAA, NIIT, basis, state arbitrage)
- [ ] Document growth rate timing assumption
- [ ] Add new test cases
