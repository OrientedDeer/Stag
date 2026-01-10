# Test Quality Review

This document identifies tests that may not be adequately testing the actual logic and should be improved.

## Summary

Most tests are well-written with specific expected values and meaningful assertions. However, some tests use weak assertions that don't verify correctness - they just check that *something* was returned.

---

## ⚠️ Tests That Need Improvement

### **TaxService.test.tsx** - MULTIPLE WEAK TESTS

**Issue**: Many tests use `toBeGreaterThan(0)` or `toBeDefined()` instead of verifying actual tax calculations.

#### Line 22-27: `should return tax parameters for a given year and filing status`
```typescript
const params = getTaxParameters(2024, 'Single', 'federal', undefined, mockAssumptions);
expect(params).toBeDefined();
expect(params?.brackets).toBeDefined();
expect(params?.standardDeduction).toBeGreaterThan(0);
```
**Problem**: Doesn't verify the *correct* tax brackets or standard deduction for Single 2024 filing. Just checks that some number > 0 exists.

**Recommendation**: Verify specific bracket values:
```typescript
expect(params?.standardDeduction).toBe(14600); // Actual 2024 single standard deduction
expect(params?.brackets[0].rate).toBe(10);
expect(params?.brackets[0].min).toBe(0);
expect(params?.brackets[0].max).toBe(11600);
```

#### Line 29-34: State tax parameters
```typescript
const params = getTaxParameters(2024, 'Single', 'state', 'DC', mockAssumptions);
expect(params).toBeDefined();
expect(params?.brackets).toBeDefined();
```
**Problem**: Same issue - doesn't verify DC's actual tax rates.

#### Line 36-40: Missing state data
```typescript
const params = getTaxParameters(2024, 'Single', 'state', 'InvalidState', mockAssumptions);
expect(params).toBeNull();
```
**Note**: This one is actually fine - null check is appropriate.

#### Line 44-65: `getGrossIncome`
```typescript
const grossIncome = getGrossIncome(incomes, 2024);
expect(grossIncome).toBeGreaterThan(0);
```
**Problem**: Should calculate the expected value. We have 60k + 24k income, so expect 84k.

#### Line 67-88: `getPreTaxExemptions`
```typescript
const preTax = getPreTaxExemptions(incomes, 2024);
expect(preTax).toBeGreaterThan(0);
```
**Problem**: Should verify it equals 5000 (the preTax401k amount), not just > 0.

#### Line 90-100: `getPostTaxExemptions`
Same issue - should verify exact amount (5000 roth401k).

#### Line 102-113: `getPostTaxEmployerMatch`
Should verify it equals 2500 (the employerMatch amount).

#### Line 115-144: `calculateFicaTax`
```typescript
const ficaTax = calculateFicaTax(taxState, incomes, 2024, mockAssumptions);
expect(ficaTax).toBeGreaterThan(0);
expect(ficaTax).toBeLessThan(totalGrossIncome); // At least somewhat bounded
```
**Problem**: FICA has specific rates (7.65% up to wage base). With 60k salary:
- Social Security: 60k * 0.062 = $3,720
- Medicare: 60k * 0.0145 = $870
- Total: $4,590

Should verify this calculation.

#### Line 146-169: `calculateStateTax`
```typescript
const stateTax = calculateStateTax(taxState, incomes, expenses, 2024, mockAssumptions);
expect(stateTax).toBeGreaterThan(0);
```
**Problem**: Should calculate expected DC tax on the taxable income.

#### Line 171-195: `calculateFederalTax`
```typescript
const fedTax = calculateFederalTax(taxState, incomes, expenses, 2024, mockAssumptions);
expect(fedTax).toBeGreaterThan(0);
```
**Problem**: Should calculate expected federal tax through the brackets.

#### Line 197-237: `calculateTax` (progressive brackets)
```typescript
const tax = calculateTax(100000, 0, params);
expect(tax).toBeGreaterThan(0);
expect(tax).toBeLessThan(100000);
```
**Problem**: Should calculate the actual progressive tax:
- $0-$11,600 @ 10% = $1,160
- $11,600-$47,150 @ 12% = $4,266
- $47,150-$100,000 @ 22% = $11,627
- Total = $17,053

#### Line 285-296: `applyCredits`
```typescript
const taxAfterCredits = applyCredits(5000, 1000);
expect(taxAfterCredits).toBe(4000);
```
**Note**: This one is GOOD - tests exact calculation.

#### Line 298-310: `getItemizedDeductions`
```typescript
const deductions = getItemizedDeductions([mortgage], 2024);
expect(deductions).toBeGreaterThanOrEqual(0);
```
**Problem**: Should calculate expected mortgage interest deduction based on the mortgage parameters.

#### Line 312-325: `calculateGrossWithdrawal`
Just checks that result exists and has properties. Should verify the actual tax calculation on the withdrawal amount.

---

### **SimulationEngine.test.tsx** - SEVERAL WEAK TESTS

#### Line 91-137: `should handle withdrawal from Traditional 401k with tax calculation`
```typescript
expect(result.accounts[0]).toBeDefined();
expect(result.accounts[0].amount).toBeGreaterThan(0);
expect(result.taxDetails).toBeDefined();
```
**Problem**: Only verifies that data structures exist. Doesn't verify:
- Correct withdrawal amount
- Correct tax calculation on withdrawal
- Correct penalty if applicable
- Correct final account balance

**Recommendation**: Calculate expected values:
```typescript
// Starting: 10k IRA, 5k expense
// Withdrawal needed: 5k
// Tax on 5k: calculate based on brackets
// Early withdrawal penalty: 5k * 0.10 = 500 (if under 59.5)
// Net received: withdrawal - tax - penalty
// Final balance: 10k - withdrawal
expect(result.accounts[0].amount).toBeCloseTo(expectedBalance);
expect(result.taxDetails.fed).toBeCloseTo(expectedTax);
```

#### Line 195-239: `should handle tax-free withdrawal from Roth IRA`
Same issue - just checks existence, not correctness.

#### Line 241-289: `should handle DebtAccount with linked loan and payment`
```typescript
expect(result.accounts[0]).toBeDefined();
```
**Problem**: Doesn't verify that the debt was actually reduced by payments.

#### Line 291-351: `should handle PropertyAccount with mortgage`
```typescript
expect(result.accounts[0]).toBeDefined();
expect(result.accounts[0].constructor.name).toBe('PropertyAccount');
```
**Problem**: Doesn't verify property appreciation or mortgage balance reduction.

#### Line 353-369: `should handle unknown account types gracefully`
```typescript
expect(result.accounts[0].amount).toBeGreaterThan(1000);
```
**Problem**: Weak assertion - should verify exact growth: 1000 * (1 + 2.5%) = 1025.

#### Line 371-394: `should handle withdrawal from SavedAccount`
Same existence-only checks.

#### Line 396-437: `should handle employer match correctly`
```typescript
expect(result.accounts[0].amount).toBeGreaterThan(10000);
expect(result.cashflow.investedMatch).toBeGreaterThan(2400);
```
**Problem**: Should calculate exact expected values:
- Start: 10k
- Growth: 10k * 1.10 = 11k
- Contributions: 5k pretax + 2.5k match = 7.5k
- Expected: 11k + 7.5k = 18.5k (minus expense ratio)

---

### **CriticalLogic.test.tsx** - TREND-BASED TESTS

#### Line 32-95: `Zero-Growth Baseline: Net Worth should change by (Income - Expenses)`
```typescript
expect(calculateNetWorth(result[1].accounts)).toBeGreaterThan(initialNetWorth);
expect(calculateNetWorth(result[2].accounts)).toBeGreaterThan(calculateNetWorth(result[1].accounts));
```
**Issue**: Uses trend comparisons instead of exact values.

**Note**: This is actually ACCEPTABLE for an integration test, but the comment says "This is an approximation because taxes are not accounted for" - which suggests the test author knew it wasn't precise.

**Recommendation**: Add a more precise unit test that verifies:
```typescript
// Net worth change = Income - Taxes - Expenses
const year0NetWorth = calculateNetWorth(result[0].accounts);
const year1NetWorth = calculateNetWorth(result[1].accounts);
const actualChange = year1NetWorth - year0NetWorth;
const expectedChange = result[1].cashflow.totalIncome
                      - result[1].cashflow.totalExpense;
expect(actualChange).toBeCloseTo(expectedChange, 0);
```

---

### **Models Reconstitution Tests** - SHALLOW CHECKS

Multiple files have reconstitution tests that only check `instanceof`:

#### Income/models.test.tsx (Line 145-164)
#### Expense/models.test.tsx (Line 238-271)
#### Accounts/models.test.tsx (Line 226-274)

```typescript
it('should create various income types correctly', () => {
    const workData = { className: 'WorkIncome', id: 'w1', amount: 95000 };
    expect(reconstituteIncome(workData)).toBeInstanceOf(WorkIncome);
});
```

**Problem**: Only verifies the class type, not that the data was correctly transferred.

**Recommendation**: Verify field values:
```typescript
const reconstituted = reconstituteIncome(workData);
expect(reconstituted).toBeInstanceOf(WorkIncome);
expect(reconstituted?.id).toBe('w1');
expect(reconstituted?.amount).toBe(95000);
// Verify other fields have sensible defaults if not provided
```

---

## ✅ Well-Written Tests (Examples)

### Accounts/models.test.tsx - Line 53-61
```typescript
it('should grow based on RoR, subtracting expense ratio', () => {
    const acc = new InvestedAccount('i1', 'Brokerage', 10000, 0, 5, 0.5, 'Brokerage', true, 0.2);
    const nextYear = acc.increment(assumptions, 1000);

    // Expected: 10000 * (1 + (10 - 0.5)/100) + 1000 = 10950 + 1000 = 11950
    expect(nextYear.amount).toBeCloseTo(11950);
});
```
**Good**: Clear formula in comment, exact expected value.

### Accounts/models.test.tsx - Line 73-122
The vesting logic tests have detailed comments explaining the math at each step.

### SimulationEngine.test.tsx - Line 45-89
```typescript
it('should grow a $1000 account by exactly 10% annually', () => {
    // Year 1: Should be $1,100 ($1000 * 1.10)
    expect(year1.accounts[0].amount).toBeCloseTo(1100, 2);
    // Year 2: Should be $1,210 ($1100 * 1.10)
    expect(year2.accounts[0].amount).toBeCloseTo(1210, 2);
});
```
**Good**: Tests compound growth with specific values.

---

## Recommendations

### High Priority (Should fix)
1. **TaxService.test.tsx**: Rewrite all tax calculation tests to verify actual amounts, not just > 0
   - Calculate expected FICA (7.65% of earned income)
   - Calculate expected federal tax through brackets
   - Calculate expected state tax
   - Verify gross withdrawal solver math

2. **SimulationEngine.test.tsx**: Add specific value checks for withdrawal scenarios
   - Traditional IRA withdrawal with tax/penalty
   - Roth IRA tax-free withdrawal (verify no tax)
   - Debt reduction verification
   - Property appreciation and mortgage paydown

### Medium Priority (Would be nice)
3. **Reconstitution tests**: Verify data integrity, not just instanceof
4. **CriticalLogic.test.tsx**: Add precise net worth change calculations

### Low Priority
5. Component/UI tests are fine as-is (they're testing interaction, not business logic)

---

## Testing Anti-Patterns Found

1. **"Hope-driven testing"**: `expect(result).toBeGreaterThan(0)` - hopes something came back
2. **"Existence testing"**: `expect(result).toBeDefined()` - checks it exists, not if it's correct
3. **"Shallow instanceof"**: Only checking class type without verifying the data
4. **"Trend testing"**: Checking year2 > year1 without knowing if the values are correct
5. **Missing calculation comments**: Some tests verify numbers without explaining where they come from

---

## Total Tests: 250
- **Well-written tests with specific values**: ~200 (80%)
- **Weak tests that need improvement**: ~40 (16%)
- **Borderline/acceptable for integration tests**: ~10 (4%)

The majority of tests are good, but the TaxService tests in particular need significant improvement since they're testing critical financial calculations with almost no verification of correctness.
