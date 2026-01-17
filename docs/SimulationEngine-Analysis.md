# Simulation Engine Analysis

This document provides a line-by-line analysis of `SimulationEngine.tsx`, explaining what each step does and identifying potential issues.

---

## Overview

The `simulateOneYear()` function takes Year N data and returns Year N+1 data. It processes:
1. Income growth and special income calculations (SS, pensions)
2. Tax calculations
3. Living expenses
4. Cashflow (surplus/deficit)
5. Withdrawals from accounts (if deficit)
6. Priority allocations (if surplus)
7. Account growth

---

## Phase 1: GROW (Lines 267-505)
**"The Physics of Money"**

### 1.1 Filter Previous Interest Income (Lines 273-278)
```typescript
const regularIncomes = incomes.filter(inc => {
    if (inc instanceof PassiveIncome && inc.sourceType === 'Interest') {
        return false;
    }
    return true;
});
```
**Purpose:** Remove last year's interest income. Fresh interest income will be regenerated based on current account balances.

**Potential Issue:** None identified.

---

### 1.2 Increment Incomes (Lines 280-457)

Each income type is processed:

#### WorkIncome at Retirement (Lines 282-305)
- If retired and no explicit end date, zero out the income and 401k contributions
- Creates a new WorkIncome with $0 amount and end date set to Dec 31 of pre-retirement year

**Potential Issue:** The income is zeroed but the object still exists. This might cause confusion in income arrays.

#### FERS Pension (Lines 308-347)
- If `autoCalculateHigh3` is enabled, tracks salary history from previous simulation years
- At retirement age, calculates High-3 salary average and computes benefit
- Formula: `(1% or 1.1%) × years of service × High-3`

**Potential Issue:** None identified.

#### CSRS Pension (Lines 350-399)
- Similar to FERS but with different benefit formula
- First 5 years: 1.5%, Next 5 years: 1.75%, Remaining: 2%
- Capped at 80% of High-3

**Potential Issue:** None identified.

#### FutureSocialSecurityIncome (Lines 401-449)
- At claiming age, calculates PIA from earnings history
- Uses `extractEarningsFromSimulation()` to build top 35 years
- Applies SS funding percentage (for modeling reduced benefits)
- Creates end date at life expectancy

**Potential Issue:** None identified.

---

### 1.3 Earnings Test (Lines 460-505)
```typescript
const incomesWithEarningsTest = nextIncomes.map(inc => { ... });
```
- Applies to Social Security income before Full Retirement Age (FRA)
- Reduces SS benefits based on earned income above threshold
- Note: Withheld benefits recalculation at FRA is NOT yet implemented

**Potential Issue:** The comment says withheld benefits recalculation at FRA is "not yet implemented" - this could lead to incorrect lifetime SS benefits.

---

## Phase 2: Expense Adjustments (Lines 507-670)

### 2.1 Increment Expenses (Line 507)
```typescript
let nextExpenses = expenses.map(exp => exp.increment(assumptions));
```
Standard inflation/growth applied to all expenses.

---

### 2.2 Lifestyle Creep (Lines 512-549)
- Only during working years
- Calculates real raise (excluding inflation adjustment)
- Applies creep percentage to discretionary expenses proportionally

**Potential Issue:** Uses `salaryGrowthRate` from assumptions but calculates raise from `prevInc.amount * salaryGrowthRate`. This assumes the previous income hasn't already been incremented, which could be inconsistent.

---

### 2.3 Guyton-Klinger Strategy (Lines 557-670)
- Calculates withdrawal target based on portfolio and GK rules
- Checks guardrails (capital-preservation, prosperity)
- **Capital Preservation:** Cuts discretionary expenses by adjustment percent
- **Prosperity:** Increases discretionary expenses

**Key Point:** GK adjustments happen BEFORE tax calculations so expenses are adjusted first.

**Potential Issue:** If there are no discretionary expenses, prosperity increase is skipped but capital preservation cut attempts to reduce them anyway.

---

## Phase 3: Interest Income Generation (Lines 672-695)

```typescript
const interestIncomes: PassiveIncome[] = [];
for (const acc of accounts) {
    if (acc instanceof SavedAccount && acc.apr > 0 && acc.amount > 0) {
        const interestEarned = acc.amount * (acc.apr / 100);
        interestIncomes.push(new PassiveIncome(
            ...,
            true  // isReinvested
        ));
    }
}
```

**Purpose:** Creates interest income from savings accounts based on BOY balance.

**Key Point:** `isReinvested = true` means:
- Interest appears in gross income (for taxes)
- Interest is NOT available as spendable cash (excluded from discretionaryCash)

**Potential Issue:** None - this was recently fixed.

---

## Phase 4: TAXES & DEDUCTIONS (Lines 697-753)
**"The Government"**

### 4.1 Initial Tax Calculation (Lines 698-715)
```typescript
let totalGrossIncome = TaxService.getGrossIncome(allIncomes, year);
const preTaxDeductions = TaxService.getPreTaxExemptions(incomesWithEarningsTest, year);
const postTaxDeductions = TaxService.getPostTaxExemptions(incomesWithEarningsTest, year);
...
let fedTax = TaxService.calculateFederalTax(...);
let stateTax = TaxService.calculateStateTax(...);
const ficaTax = TaxService.calculateFicaTax(...);
```

**Key Observations:**
- `allIncomes` includes interest income for tax purposes
- `incomesWithEarningsTest` (excluding interest) is used for pre/post tax deductions

**Potential Issue:** Pre-tax exemptions use `incomesWithEarningsTest` but tax calculations use `allIncomes`. This is intentional but could be confusing.

---

### 4.2 Auto Roth Conversions (Lines 720-753)
- Only during retirement
- Calculates optimal conversion to fill tax brackets up to target rate (min 22%)
- Withdraws from Traditional accounts, deposits to Roth accounts
- Adds conversion tax cost to federal tax
- State tax on conversion uses effective rate approximation

**Key Points:**
- Conversion amount is NOT added to `totalGrossIncome` - it's a transfer, not income
- Tax cost IS added to total taxes

**Potential Issue (Line 742-743):**
```typescript
const stateConversionTax = conversionResult.amount * (stateTax / Math.max(1, totalGrossIncome));
```
This uses the effective state rate, but states that don't tax SS might have a different effective rate on the conversion. The actual conversion should be taxed at marginal state rate, not effective rate.

---

## Phase 5: LIVING EXPENSES (Lines 755-764)
**"The Bills"**

```typescript
const totalLivingExpenses = nextExpenses.reduce((sum, exp) => {
    if (exp instanceof MortgageExpense) {
        return sum + exp.calculateAnnualAmortization(year).totalPayment;
    }
    // ... similar for LoanExpense
    return sum + exp.getAnnualAmount(year);
}, 0);
```

**Potential Issue:** None identified.

---

## Phase 6: CASHFLOW (Lines 766-777)
**"The Wallet"**

```typescript
const reinvestedIncome = allIncomes
    .filter(inc => inc instanceof PassiveIncome && inc.isReinvested)
    .reduce((sum, inc) => sum + inc.getAnnualAmount(year), 0);

let discretionaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions
    - totalTax - totalLivingExpenses - reinvestedIncome;
```

**Formula:** `Discretionary = Gross - PreTax - PostTax - Taxes - Bills - Reinvested`

**Key Point:** Reinvested income (interest that stays in savings) is subtracted because it's not spendable.

---

## Phase 7: Non-GK Withdrawal Strategy (Lines 782-814)

For Fixed Real, Variable Percentage, and Floor-Ceiling strategies:
- Calculates target withdrawal based on portfolio and strategy rules
- Logs the strategy details

**Note:** This is just tracking - actual withdrawals happen based on deficit, not strategy target.

---

## Phase 8: WITHDRAWAL LOGIC (Lines 816-1278)
**"Deficit Manager"**

### 8.1 Setup (Lines 821-838)
- Initialize tracking variables for inflows, taxes, withdrawals
- Apply Roth conversion flows (from Traditional to Roth)

---

### 8.2 Required Minimum Distributions (Lines 840-953)

```typescript
if (rmdRequired) {
    // For each Traditional account subject to RMD:
    // 1. Get prior year balance
    // 2. Calculate RMD amount
    // 3. Withdraw and calculate tax
    // 4. Track shortfall and 25% penalty
}
discretionaryCash += rmdCashReceived;
```

**Key Points:**
- RMD is calculated on PRIOR year's ending balance
- RMD is taxed as ordinary income
- Net RMD cash (after tax) is added to discretionary cash
- 25% penalty on any shortfall

**Potential Issue (Lines 895-900):**
```typescript
const currentFedIncome = totalGrossIncome - preTaxDeductions;
const currentStateIncome = totalGrossIncome - preTaxDeductions;
```
Uses the same calculation for fed and state income, but state income should already exclude SS for most states (after the recent fix). This could cause over-taxation of RMDs at the state level.

---

### 8.3 Deficit Calculation (Lines 955-959)
```typescript
const deficitAmount = discretionaryCash < 0 ? Math.abs(discretionaryCash) : 0;
let amountToWithdraw = deficitAmount;
```

**Key Point:** Only withdraws what's needed, not the full strategy amount.

---

### 8.4 Withdrawal Loop (Lines 961-1278)

Loops through withdrawal strategy order:

#### Scenario 1: Tax-Free (Lines 983-1063)
- Roth (qualified), HSA, SavedAccount
- For early Roth withdrawal, tracks gains portion (taxable + 10% penalty)
- Contributions come out first (tax-free), then gains

**Potential Issue:** The cost basis tracking for early Roth withdrawals might not properly track multi-year contribution vs gains.

#### Scenario 2: Pre-Tax Traditional (Lines 1067-1129)
- Uses solver to find gross withdrawal needed for net deficit
- Applies 10% early withdrawal penalty if under 59.5
- Updates gross income and taxes

#### Scenario 3: Brokerage (Lines 1131-1229)
- Only gains portion is taxed at capital gains rates
- Uses iterative solver to find gross withdrawal for net deficit
- Tracks capital gains tax separately

**Potential Issue:** The capital gains calculation uses `account.unrealizedGains / account.amount` ratio, but this ratio changes as you withdraw. The iterative solver helps but may not perfectly converge.

#### Scenario 4: Fallback (Lines 1232-1236)
- For any unhandled account type
- Simple withdrawal with no tax calculation

---

### 8.5 Deficit Debt (Lines 1280-1318)
```typescript
if (discretionaryCash < 0) {
    // Add uncovered deficit to DeficitDebtAccount
}
discretionaryCash = 0;
```

**Purpose:** Tracks deficits that couldn't be covered by available accounts.

---

## Phase 9: INFLOWS & BUCKETS (Lines 1324-1410)
**"The Allocation of Surplus"**

### 9.1 Payroll & Match (Lines 1330-1344)
- Applies 401k contributions and employer match
- Separates user vs employer inflows for vesting tracking

### 9.2 Pay Down Deficit Debt (Lines 1346-1360)
- Prioritizes paying off deficit debt before priority allocations
- Uses surplus cash first

### 9.3 Priority Waterfall (Lines 1362-1410)
- Allocates remaining surplus to priority accounts
- Supports: FIXED, REMAINDER, MAX, MULTIPLE_OF_EXPENSES cap types

---

## Phase 10: LINKED DATA (Lines 1412-1420)

```typescript
const linkedData = new Map<string, { balance: number; value?: number }>();
nextExpenses.forEach(exp => {
    if (exp instanceof MortgageExpense && exp.linkedAccountId) {
        linkedData.set(exp.linkedAccountId, { balance: exp.loan_balance, value: exp.valuation });
    }
    // ... similar for LoanExpense
});
```

**Purpose:** Links mortgage/loan expenses to their property/debt accounts.

---

## Phase 11: GROW ACCOUNTS (Lines 1422-1490)
**"The Compounding"**

```typescript
let nextAccounts = accounts.map(acc => {
    const userIn = userInflows[acc.id] || 0;
    const employerIn = employerInflows[acc.id] || 0;
    const totalIn = userIn + employerIn;
    ...
    return acc.increment(...);
});
```

Account types handled:
- **PropertyAccount:** Updates loan balance and property value
- **DeficitDebtAccount:** Applies payment, removes if paid off
- **DebtAccount:** Updates balance with payments
- **InvestedAccount:** Grows with returns, tracks user/employer separately for vesting
- **SavedAccount:** Grows by APR

**Potential Issue:** The `returnOverride` parameter (for Monte Carlo) is only passed to InvestedAccount, not SavedAccount. SavedAccount APR should probably stay fixed though.

---

## Phase 12: SUMMARY STATS (Lines 1492-1527)

Returns the SimulationYear object with:
- `incomes`: All incomes including interest
- `expenses`: Updated expenses
- `accounts`: Updated account balances
- `cashflow`: Income, expenses, discretionary, investments, withdrawals
- `taxDetails`: Fed, state, FICA, capital gains
- `logs`: Debug messages
- Optional: `strategyWithdrawal`, `strategyAdjustment`, `rothConversion`, `rmdDetails`

---

## Identified Issues Summary

| Issue | Location | Severity | Status | Description |
|-------|----------|----------|--------|-------------|
| 1 | Line 489 | Low | Open | SS withheld benefits recalculation at FRA not implemented |
| 2 | Lines 742-768 | Medium | **FIXED** | State tax on Roth conversion now uses marginal rate with SS exclusion |
| 3 | Lines 921-936 | Medium | **FIXED** | RMD state tax calculation now properly excludes SS benefits |
| 4 | Lines 993-1057 | Low | Open | Early Roth cost basis tracking may be imprecise across years |
| 5 | Lines 1131-1229 | Low | Open | Brokerage gains ratio changes during withdrawal (iterative solver helps) |

---

## Order of Operations Summary

1. Filter out old interest income
2. Increment incomes (handle retirement, SS, pensions)
3. Apply earnings test to SS
4. Increment expenses
5. Apply lifestyle creep (working years)
6. **If GK strategy:** Calculate GK adjustments to expenses
7. Generate interest income from savings accounts
8. Calculate taxes (fed, state, FICA)
9. **If retired + auto conversions:** Perform Roth conversions, add tax cost
10. Calculate living expenses total
11. Calculate discretionary cash (gross - deductions - taxes - expenses - reinvested)
12. **If non-GK retired:** Calculate strategy withdrawal target (informational)
13. Apply Roth conversion account flows
14. **If RMD required:** Calculate and withdraw RMDs, add to discretionary cash
15. **If deficit:** Withdraw from accounts per strategy order
16. **If still deficit:** Track as deficit debt
17. Apply 401k contributions and employer match
18. **If surplus:** Pay down deficit debt first
19. **If still surplus:** Allocate to priority buckets
20. Update linked mortgage/loan data
21. Grow all accounts
22. Handle deficit debt account (add/update/remove)
23. Return SimulationYear result
