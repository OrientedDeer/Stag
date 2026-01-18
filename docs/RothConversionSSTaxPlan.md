# Plan: Roth Conversion with Social Security Tax Consideration

## Problem

Currently, the Roth conversion logic calculates bracket headroom without properly accounting for Social Security's tiered taxation. SS income is taxed at 0%, 50%, or 85% depending on "combined income" thresholds, but the current code may be treating it as 100% taxable.

This matters because:
1. **Bracket headroom calculation is wrong** - If we think SS is 100% taxable, we underestimate available bracket space
2. **Tax torpedo effect is ignored** - A Roth conversion can push more SS income into taxable territory, creating an effective marginal rate higher than the stated bracket rate

## Background: SS Taxation Rules

**Combined Income** = AGI (excluding SS) + 50% of SS benefits + tax-exempt interest

| Filing Status | Combined Income | Taxable SS |
|---------------|-----------------|------------|
| Single | < $25,000 | 0% |
| Single | $25,000 - $34,000 | Up to 50% |
| Single | > $34,000 | Up to 85% |
| MFJ | < $32,000 | 0% |
| MFJ | $32,000 - $44,000 | Up to 50% |
| MFJ | > $44,000 | Up to 85% |

## Current Code Analysis

### Where Roth Conversion Calculates Bracket Headroom

**File:** `SimulationEngine.tsx` - `performAutoRothConversion()` function

```typescript
const grossIncome = TaxService.getGrossIncome(incomes, year);
// This likely includes FULL SS amount, not taxable portion
```

### Where SS Taxation is Calculated

**File:** `TaxService.tsx` - `getTaxableSocialSecurityBenefits()` function

This function correctly implements the IRS formula. We need to USE this function when calculating Roth conversion headroom.

## Implementation Plan

### Phase 1: Update `performAutoRothConversion` to Use Taxable SS

**Location:** `SimulationEngine.tsx`

1. Get total SS benefits from incomes
2. Calculate current taxable SS using `getTaxableSocialSecurityBenefits()`
3. Use taxable SS (not total SS) when calculating current taxable income
4. Calculate bracket headroom based on correct taxable income

```typescript
// Current (wrong):
const grossIncome = TaxService.getGrossIncome(incomes, year);
const taxableIncome = grossIncome - standardDeduction;

// Fixed:
const totalSSBenefits = TaxService.getSocialSecurityBenefits(incomes, year);
const nonSSIncome = grossIncome - totalSSBenefits;
const taxableSSBenefits = TaxService.getTaxableSocialSecurityBenefits(
    totalSSBenefits,
    nonSSIncome,
    filingStatus
);
const taxableIncome = nonSSIncome + taxableSSBenefits - standardDeduction;
```

### Phase 2: Account for "Tax Torpedo" Effect

When calculating how much to convert, we need to consider that:
- Adding $X of Roth conversion income may push more SS into taxable territory
- This creates an "effective" marginal rate higher than the stated bracket rate

**Example:**
- Person has $20k SS + $10k other income
- Combined income = $10k + $10k (50% of SS) = $20k
- At this level, 0% of SS is taxable
- If they do a $15k Roth conversion:
  - Combined income = $25k + $10k = $35k
  - Now up to 85% of SS is taxable
  - Effective marginal rate on the $15k conversion is HIGHER than the bracket rate

**Implementation approach:**

```typescript
function calculateEffectiveConversionTax(
    baseIncome: number,
    ssIncome: number,
    conversionAmount: number,
    filingStatus: FilingStatus,
    year: number
): { directTax: number, ssTaxIncrease: number, effectiveRate: number } {
    // Calculate tax WITHOUT conversion
    const baseTaxableSS = getTaxableSocialSecurityBenefits(ssIncome, baseIncome, filingStatus);
    const baseTaxableIncome = baseIncome + baseTaxableSS;
    const baseTax = calculateTax(baseTaxableIncome, ...);

    // Calculate tax WITH conversion
    const newTaxableSS = getTaxableSocialSecurityBenefits(ssIncome, baseIncome + conversionAmount, filingStatus);
    const newTaxableIncome = baseIncome + conversionAmount + newTaxableSS;
    const newTax = calculateTax(newTaxableIncome, ...);

    // The difference includes both direct tax AND SS tax torpedo
    const totalTaxIncrease = newTax - baseTax;
    const effectiveRate = totalTaxIncrease / conversionAmount;

    return {
        directTax: /* marginal bracket rate * conversionAmount */,
        ssTaxIncrease: totalTaxIncrease - directTax,
        effectiveRate
    };
}
```

### Phase 3: Update Bracket-Filling Logic

The current logic fills brackets up to a target rate (22%). With SS tax torpedo, we need to:

1. **Option A: Target effective rate instead of marginal rate**
   - Stop converting when effective rate (including SS torpedo) exceeds target
   - More conservative, may leave some bracket space unused

2. **Option B: Binary search for optimal conversion**
   - Find the conversion amount where effective marginal rate equals target
   - More complex but maximizes tax efficiency

**Recommended: Option A** (simpler, safer)

```typescript
// Instead of:
if (marginalRate >= MIN_CONVERSION_TARGET_RATE) break;

// Use:
const effectiveTax = calculateEffectiveConversionTax(...);
if (effectiveTax.effectiveRate >= MIN_CONVERSION_TARGET_RATE) break;
```

### Phase 4: Add Tests

**File:** `src/__tests__/integration/stories/RothConversionLadder.test.tsx`

Add tests for:
1. Roth conversion with no SS income (baseline)
2. Roth conversion with SS income below first threshold (0% taxable)
3. Roth conversion that crosses the 50% SS threshold
4. Roth conversion that crosses the 85% SS threshold
5. Verify tax torpedo is accounted for in conversion amount

## Files to Modify

1. **`SimulationEngine.tsx`** - `performAutoRothConversion()` function
   - Update taxable income calculation to use taxable SS, not total SS
   - Add tax torpedo consideration to bracket-filling logic

2. **`TaxService.tsx`** - May need new helper function
   - `calculateEffectiveConversionTax()` - calculates true tax cost including SS torpedo

3. **`RothConversionLadder.test.tsx`** - Add SS-aware tests

## Verification

1. Run existing Roth conversion tests (should still pass)
2. Run new SS-aware tests
3. Manual verification with scenarios:
   - Early retiree (55-62): No SS, should behave as before
   - Post-SS retiree (67+): Should see reduced conversions due to SS torpedo
   - Edge cases at SS threshold boundaries

## Complexity Considerations

- **Low complexity if we just fix the taxable income calculation (Phase 1)**
- **Medium complexity if we add tax torpedo awareness (Phase 2-3)**
- The tax torpedo effect can create effective marginal rates of 40-50%+ in the "torpedo zone"
- May want to add a user-facing indicator showing effective vs marginal rates
