# Remaining Test Issues

The following tests still match the "weak testing" patterns identified in the original review (e.g., `toBeGreaterThan(0)`, `toBeInstanceOf` without data verification).

## 1. TaxService.test.tsx

While most calculations are now precise, these specific test cases still use weak assertions:

### `getFicaExemptions` (Lines ~258)
```typescript
it('should calculate FICA exemptions when present', () => {
    // ...
    expect(exemptions).toBeGreaterThanOrEqual(0); 
});
Fix: Calculate the expected value (Should be 0 in this case as Traditional 401k is not FICA exempt, or setup a scenario where it is).
getEarnedIncome (Lines ~266)

it('should calculate total earned income', () => {
    // ...
    expect(earned).toBeGreaterThanOrEqual(0);
});
Fix: Verify it equals 100000 (the input income).
getItemizedDeductions (Lines ~291)


it('should calculate itemized deductions', () => {
    // ...
    expect(deductions).toBeGreaterThanOrEqual(0);
});
Fix: Calculate the specific expected deduction based on mortgage interest + taxes (limited to 10k SALT) + other itemizable expenses.
calculateFederalTax (Itemized Scenario - Lines ~368)


it('should calculate federal tax with itemized deductions', () => {
    // ...
    expect(fedTax).toBeGreaterThan(0);
});
Fix: Calculate the exact expected tax. This is a critical path for the "Itemized" logic which is currently not being verified for correctness, only existence.


2. CriticalLogic.test.tsx
Zero-Growth Baseline (Lines ~84)
expect(calculateNetWorth(result[1].accounts)).toBeGreaterThan(initialNetWorth);

Fix: The review recommended changing this trend check to a precise delta check:
const actualChange = year1NetWorth - year0NetWorth;
const expectedChange = income - expenses; // (Since growth is 0)
expect(actualChange).toBeCloseTo(expectedChange);
3. Reconstitution Tests (Data Integrity)
The review noted that reconstitution tests should check that data was preserved, not just the class type.

src/__tests__/Components/Objects/Income/models.test.tsx

Current:
expect(reconstituteIncome(workData)).toBeInstanceOf(WorkIncome);

Fix:
const inc = reconstituteIncome(workData);
expect(inc).toBeInstanceOf(WorkIncome);
expect(inc.amount).toBe(95000);
expect(inc.id).toBe('w1');
src/__tests__/Components/Objects/Expense/models.test.tsx

Current:
expect(reconstituteExpense(rentData)).toBeInstanceOf(RentExpense);
expect(reconstituteExpense(mortgageData)).toBeInstanceOf(MortgageExpense);
// ... etc

Fix: Verify at least one data field (e.g., amount, payment, id) for every reconstituted expense type to ensure the internal mapper is actually mapping properties, not just instantiating empty classes.

4. SimulationEngine.test.tsx
should handle PropertyAccount with mortgage (Lines ~275)
Current:
expect(resultAccount.loanAmount).toBeLessThan(250000);

Fix: Calculate the exact amortization for the year.
expect(resultAccount.loanAmount).toBeCloseTo(expectedLoanBalance);