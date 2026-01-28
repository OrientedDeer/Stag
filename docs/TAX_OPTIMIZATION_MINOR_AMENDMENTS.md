# Tax Optimization - Minor Amendments (v3.1)

These are minor refinements to `TAX_OPTIMIZATION_IMPLEMENTATION.md`. Apply these during implementation.

---

## 1. Clarify Phase Control Flow (Step 8/8c)

**Issue:** The pseudocode nests `ROTH_DEPLETED` inside the `BROKERAGE_DEPLETED` else block, which is confusing.

**Fix:** When implementing, use explicit if/else-if chain for all four phases:

```typescript
// In planTaxOptimizedYear(), replace the nested structure with:

if (phase === 'BROKERAGE_AVAILABLE') {
    // Step 7: Full conversions, brokerage pays for everything
    // ... existing Step 7 logic ...
}
else if (phase === 'BROKERAGE_TRANSITION') {
    // Step 7b: Reduced conversions, preserve brokerage
    // ... existing Step 7b logic ...
}
else if (phase === 'BROKERAGE_DEPLETED') {
    // Step 8: Survival spending first, conversions get leftovers
    // ... existing Step 8 logic (8a through 8g) ...
}
else if (phase === 'ROTH_DEPLETED') {
    // Step 8c: Survival mode - Traditional primary, no conversions
    // ... existing Step 8c logic ...
}
```

**Location:** Lines 974-1135 in the implementation doc.

---

## 2. Update ACA Threshold Values

**Issue:** Document uses ~$58,320 as the ACA cliff. Actual 2024 value is ~$60,240, and 2025 is ~$62,000+.

**Fix:** Ensure `getAcaCliffThreshold()` uses accurate, annually-updated values:

```typescript
/**
 * Get the ACA subsidy cliff threshold (400% FPL) for a given year and filing status.
 * Values should be updated annually when FPL is published (typically January).
 */
function getAcaCliffThreshold(
    filingStatus: 'single' | 'married_filing_jointly',
    year: number
): number {
    // 2024 Federal Poverty Level base: $15,060 (single), $20,440 (couple)
    // 400% FPL = threshold where ACA subsidies phase out completely
    
    // Base FPL values by year (update annually)
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

**Location:** Add to helper functions section, update Step 6b to use accurate values.

---

## 3. Update Withdrawals After Invariant Fix

**Issue:** Step 9 recalculates `taxPaymentSource` after reducing conversions, but the `withdrawals` object may have stale values for tax-related withdrawals.

**Fix:** Add withdrawal updates after the tax recalculation in Step 9:

```typescript
// After line ~1185 in Step 9, add:

// CRITICAL: Update withdrawals object if tax payment source changed
// The withdrawals were calculated for the original conversion amount
if (conversionAmount < originalConversion) {
    if (phase === 'BROKERAGE_AVAILABLE' || phase === 'BROKERAGE_TRANSITION') {
        if (taxPaymentSource === 'BROKERAGE') {
            // Brokerage now pays for spending + reduced tax
            withdrawals.brokerage = deficit + totalTaxNeeded;
            withdrawals.savings = 0;
        } else if (taxPaymentSource === 'SAVINGS') {
            // Brokerage pays only for spending, savings pays reduced tax
            withdrawals.brokerage = deficit;
            withdrawals.savings = totalTaxNeeded;
        } else if (taxPaymentSource === 'WITHHOLD' || taxPaymentSource === 'NONE') {
            // No external tax payment needed
            withdrawals.brokerage = deficit;
            withdrawals.savings = 0;
        }
    } else {
        // BROKERAGE_DEPLETED phase
        if (taxPaymentSource === 'SAVINGS') {
            withdrawals.savings = savingsForSpending + totalTaxNeeded;
        } else if (taxPaymentSource === 'NONE') {
            withdrawals.savings = savingsForSpending;
        }
        // WITHHOLD case: savings unchanged, withholding handles tax
    }
    
    log(`Updated withdrawals after invariant fix: brokerage=${withdrawals.brokerage}, savings=${withdrawals.savings}`);
}
```

**Location:** Insert after the tax recalculation block in Step 9 (after line ~1185).

---

## 4. Implementation Approach: Test-Driven Development

**Recommendation:** Implement using TDD (Test-Driven Development). The test cases in the implementation doc are well-specified enough to drive the implementation.

### Suggested Order

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

### TDD Workflow for Each Function

```typescript
// Example: getDampingFactor()

// STEP 1: Write the test first
describe('getDampingFactor', () => {
    test('conservative damping with many years remaining', () => {
        expect(getDampingFactor(20)).toBe(0.15);
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
    
    test('handles zero and negative years', () => {
        expect(getDampingFactor(0)).toBe(0.50);
        expect(getDampingFactor(-1)).toBe(0.50);
    });
});

// STEP 2: Run tests (they fail)

// STEP 3: Implement the function
function getDampingFactor(yearsUntilRMD: number): number {
    if (yearsUntilRMD >= 15) return 0.15;
    if (yearsUntilRMD >= 10) return 0.20;
    if (yearsUntilRMD >= 7)  return 0.25;
    if (yearsUntilRMD >= 5)  return 0.30;
    if (yearsUntilRMD >= 3)  return 0.40;
    return 0.50;
}

// STEP 4: Run tests (they pass)

// STEP 5: Refactor if needed, ensure tests still pass
```

### Key Test Files to Create

```
src/services/simulation/__tests__/
├── TaxOptimizedWithdrawal.test.ts      # Unit tests for all calculation functions
├── TaxOptimizedWithdrawal.integration.test.ts  # Integration with SimulationEngine
└── TaxOptimizedWithdrawal.snapshot.test.ts     # Golden master tests
```

### Benefits of TDD Approach

1. **Catches spec deviations early** - Tests encode the expected behavior from the spec
2. **Enables safe refactoring** - Can restructure code confidently
3. **Documents behavior** - Tests serve as executable documentation
4. **Reduces debugging time** - Failures pinpoint exactly what broke
5. **Builds confidence** - Green tests confirm correctness before integration

---

## Summary Checklist

- [ ] Use explicit if/else-if for all four phases (not nested)
- [ ] Update `getAcaCliffThreshold()` with accurate 2024-2026 FPL values
- [ ] Add withdrawal updates after invariant fix recalculates tax
- [ ] Follow TDD approach: write tests first, then implement
- [ ] Create test files before implementation files
