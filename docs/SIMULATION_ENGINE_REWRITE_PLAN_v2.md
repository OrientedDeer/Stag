# SimulationEngine Rewrite Plan (v2)

## Problem Summary

The current simulation engine has fundamental ordering issues:
1. **Over-withdrawal loop**: Withdrew too much, then reinvested (wasteful round-trip)
2. **Blocked reinvestment overcorrection**: Fix broke legitimate RMD surplus handling
3. **Sequential decisions**: Withdrawals calculated before conversions, tax calculated without knowing both
4. **Circular dependency**: Tax ↔ Withdrawal ↔ Conversion creates approximation errors
5. **Binary search patch**: Only handles Traditional residual, not holistic
6. **Dual withdrawal paths**: `executeWithdrawalPlan` (no gross-up) vs `executeWithdrawals` (with gross-up) caused inconsistent behavior

## Design Principles

1. **Spending always first** — Living expenses must be covered before conversions
2. **No deficits for conversions** — Never create debt to fund Roth conversions
3. **Single withdrawal path** — One code path with consistent gross-up, regardless of basic vs tax-optimized
4. **Planning vs Execution separation** — Pure calculation during planning, mutations only after convergence
5. **Surplus handling** — User-defined allocation for excess cash (RMDs, SS, pension surplus)
6. **Spendable vs non-spendable income** — Reinvested interest and Roth conversions are never counted as spendable income
7. **Savings preservation** — Savings moved to end of withdrawal order, but preferred over penalized withdrawals
8. **Decision transparency** — Every withdrawal, conversion, and allocation includes a reason

---

## New Architecture

### Year Simulation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: CALCULATE KNOWNS (Pure, no iteration needed)           │
├─────────────────────────────────────────────────────────────────┤
│ 1. Evaluate milestones → determine isRetired                    │
│ 2. Project incomes (work, SS w/ earnings test, pensions, COLA)  │
│ 3. Separate spendable vs reinvested income                      │
│ 4. Calculate RMDs (required, non-negotiable)                    │
│ 5. Calculate fixed expenses (mortgage amort, loans, living)     │
│ 6. Apply lifestyle creep / spending strategy (GK guardrails)    │
│ 7. Calculate FICA tax (only depends on wages)                   │
│ 8. Calculate mortgage interest + escrow (for SALT deduction)    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
               ┌──────────────────────────────┐
               │ isRetired?                    │
               ├──────────┬───────────────────┤
               │ YES      │ NO                │
               ↓          ↓                   │
         PHASE 2R    PHASE 2W                 │
         (Retirement) (Working)               │
               │          │                   │
               ↓          ↓                   │
               └──────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: EXECUTE PLAN (Mutations happen here only)              │
├─────────────────────────────────────────────────────────────────┤
│ 1. Clone all accounts (never mutate originals)                  │
│ 2. Execute withdrawals (deduct from accounts)                   │
│ 3. Execute Roth conversion (move Traditional → Roth)            │
│ 4. Execute surplus allocation                                   │
│ 5. Process contributions (401k, employer match, ESPP)           │
│ 6. Apply investment growth to all accounts                      │
│ 7. Update property values and mortgage balances                 │
│ 8. Update debt balances                                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: BUILD OUTPUT                                           │
├─────────────────────────────────────────────────────────────────┤
│ 1. Assemble SimulationYear from YearPlan + new account states   │
│ 2. Attach decision log                                          │
│ 3. Return SimulationYear (pure output, no side effects)         │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 2W: Working Year Flow

Working years are simpler — no withdrawal/conversion decisions, just income → taxes → allocations.

```
PHASE 2W: WORKING YEAR (Pure planning, no mutations)
├─────────────────────────────────────────────────────────────────┤
│ 1. Calculate gross income (salary, bonuses, passive, dividends) │
│ 2. Calculate pre-tax deductions (401k, HSA, insurance)          │
│ 3. Calculate 401k contributions:                                │
│    - getEffective401k(year, age) for each WorkIncome            │
│    - Employer match based on salary + match formula              │
│    - Track Roth vs Traditional 401k split                       │
│ 4. Calculate ESPP contributions:                                │
│    - getAnnualESPPContribution() for each WorkIncome             │
│ 5. Calculate taxes:                                             │
│    - Federal (ordinary income, SS taxability, LTCG if any)      │
│    - State                                                      │
│    - FICA (already calculated in Phase 1)                       │
│ 6. Calculate net take-home:                                     │
│    netPay = gross - preTaxDeductions - tax - insurance           │
│ 7. Calculate paycheck allocations (priority buckets):           │
│    - Emergency fund up to target                                │
│    - Roth IRA contributions                                     │
│    - Brokerage (remainder)                                      │
│ 8. Calculate surplus/deficit:                                   │
│    surplus = netPay - expenses - bucketAllocations               │
│    If deficit (surplus < 0):                                    │
│      - First, reduce bucket allocations to zero                 │
│      - If still deficit, withdraw from savings                  │
│      - If still deficit, add to DeficitDebt                     │
│                                                                  │
│ OUTPUT: YearPlan { contributions, allocations, tax, surplus }    │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 2R: Retirement Year Solver

```
PHASE 2R: RETIREMENT YEAR SOLVER (Pure planning, no mutations)
├─────────────────────────────────────────────────────────────────┤
│ Inputs (all calculated in Phase 1):                             │
│   spendableIncome, rmdAmount, expenses, spendingTarget, fica    │
│   accounts (read-only snapshots), taxState, assumptions          │
│                                                                  │
│ Step A: Calculate base ordinary income                          │
│   ordinaryIncome = wages + pensions + RMDs + passive            │
│   ssIncome = taxable portion of SS (provisional income method)  │
│   NOTE: Initial SS taxability uses ordinary income only (LTCG=0)│
│         because withdrawals aren't planned yet. Step F rechecks │
│         with actual LTCG after withdrawals; loops if tier jumps.│
│         Provisional = ordinaryIncome + 50% SS + LTCG (when known)│
│   baseOrdinaryIncome = ordinaryIncome + ssIncome                │
│                                                                  │
│ Step B: Plan Roth conversion FIRST (if enabled)                 │
│   bracketSpace = ceilingIncome - baseOrdinaryIncome             │
│   conversionAmount = min(bracketSpace, pacingTarget, tradBal)   │
│   RECALCULATE SS TAXABILITY with conversion:                    │
│     newProvisional = ordinaryIncome + conversion + 50% SS       │
│     ssIncome = recalculate taxable SS portion                   │
│   allOrdinaryIncome = ordinaryIncome + ssIncome + conversion    │
│   Determine tax payment source: SURPLUS > BROKERAGE > WITHHOLD  │
│                                                                  │
│ Step C: Calculate ordinary tax (now fully determined)           │
│   ordinaryTax = federal(allOrdinaryIncome) + state              │
│   Determine LTCG rate based on allOrdinaryIncome                │
│   (0% if under $48,475, 15% if under $533,400, else 20%)        │
│                                                                  │
│ Step D: Calculate BASE deficit                                  │
│   baseDeficit = expenses + ordinaryTax + fica - spendableIncome │
│                 - rmdAmount                                      │
│   (If conversion tax paid from SURPLUS, add conversionTax here) │
│   (deficit may be negative → surplus from income/RMDs)          │
│                                                                  │
│ Step E: Plan withdrawals using ALGEBRAIC gross-up               │
│   For single-source withdrawals within one LTCG bracket:        │
│     Savings:     gross = baseDeficit (no tax)                   │
│     Brokerage:   gross = baseDeficit / (1 - gainRatio × ltcgRate)│
│     Traditional: gross = baseDeficit / (1 - marginalRate)       │
│     Roth:        gross = baseDeficit (tax-free contributions)   │
│                                                                  │
│   LTCG tax (if brokerage): gross × gainRatio × ltcgRate         │
│   Total tax = ordinaryTax + LTCG tax + fica + NIIT + penalties  │
│                                                                  │
│ Step F: Check for bracket crossing (rare — triggers loop)       │
│   If withdrawal would cross LTCG bracket (0%→15%) or            │
│   Traditional withdrawal crosses ordinary bracket or            │
│   LTCG pushes SS taxability to higher tier (0%→50%→85%):        │
│     Recalculate with new rates, loop back to Step E (max 3)     │
│                                                                  │
│ Step G: Calculate surplus                                       │
│   surplus = spendableIncome + rmdAmount + totalWithdrawals      │
│             - expenses - totalTax                                │
│   If surplus > 0: plan allocation per user priority             │
│   If surplus < 0: record as unfundedDeficit                     │
│                                                                  │
│ OUTPUT: YearPlan                                                │
└─────────────────────────────────────────────────────────────────┘
```

### Why Conversion Before Withdrawals?

The order matters because:
1. **Conversion amount depends on bracket space** — known from base ordinary income
2. **Conversion adds to ordinary income** — affects tax rates for everything else
3. **LTCG rate depends on ordinary income** — need to know conversion first
4. **Once conversion is decided, ordinary tax is fully determined**
5. **Only then can we calculate the base deficit for withdrawal planning**

### Algebraic Gross-Up (Primary Method)

**Critical insight:** Don't put LTCG tax in the deficit before grossing up — this causes double-counting and requires 8-10 iterations to converge.

Instead, use algebraic gross-up on the BASE deficit:

```typescript
// Base deficit excludes LTCG tax (which depends on withdrawal amount)
baseDeficit = expenses + ordinaryTax + fica - spendableIncome - rmdAmount

// Solve algebraically for brokerage
grossWithdrawal = baseDeficit / (1 - gainRatio × ltcgRate)
ltcgTax = grossWithdrawal × gainRatio × ltcgRate
totalTax = ordinaryTax + ltcgTax + fica

// Verify: grossWithdrawal - ltcgTax = baseDeficit ✓
```

This solves single-source withdrawals in **1 pass** with no iteration.

### Convergence Loop (Safety Net)

The loop is only needed when a withdrawal crosses a tax boundary:

1. **LTCG bracket crossing** — Brokerage gains push from 0% to 15%
2. **Ordinary bracket crossing** — Traditional withdrawal pushes into higher bracket
3. **Mixed sources** — First source depletes, second source has different tax treatment

Even then, 2-3 iterations max. If not converged by 3, use dampening:
```
estimatedRate = (lastRate + calculatedRate) / 2
```

**Rate recalculation:**
LTCG rates and marginal rates must be recalculated each iteration, NOT cached from the first pass. The reason: a Roth conversion or large withdrawal can push total income into a higher bracket, changing:
- LTCG rate (0% → 15% → 20%)
- Marginal ordinary income rate
- SS taxability (provisional income thresholds)

**Parameters:**
```typescript
const CONVERGENCE_THRESHOLD = 1.00;   // $1 tolerance (not $0.005 — sub-dollar precision is unnecessary)
const MAX_ITERATIONS = 10;            // If not converged by 10, use last value and log warning
```

**Non-convergence handling:**
1. Use the last calculated values
2. Add DecisionLogEntry: `"WARNING: Tax/withdrawal calculation did not converge after 10 iterations. Difference: $X."`
3. Continue simulation (don't halt)

---

## Income Classification

Income must be classified before deficit calculation:

```typescript
interface ClassifiedIncome {
  spendable: number;      // Cash available for expenses
  reinvested: number;     // Goes back into accounts (reinvested interest/dividends)
  rmdIncome: number;      // Required distributions (always spendable)
  conversionIncome: number; // Roth conversions (NEVER spendable, tax-only impact)
  taxableTotal: number;   // Everything that appears on tax return
}
```

**Rules:**
- Reinvested interest/dividends: taxable but NOT spendable
- RMD income: taxable AND spendable
- Roth conversion: taxable but NOT spendable (it's a transfer, not income)
- Rental income: taxable AND spendable
- ESPP income (if sold): taxable AND spendable

**The ONLY deficit formula used in the solver is:**
```
baseDeficit = expenses + ordinaryTax + fica - spendableIncome - rmdIncome
```

**CRITICAL: LTCG tax is NEVER added to the deficit.** It is solved algebraically inside the gross-up formula:
```
grossWithdrawal = baseDeficit / (1 - gainRatio × ltcgRate)
ltcgTax = grossWithdrawal × gainRatio × ltcgRate
```

`totalTax` (ordinaryTax + ltcgTax + fica + penalties) exists ONLY for:
- `YearPlan.tax.total` (reporting to UI)
- Step G surplus calculation: `surplus = cashIn - cashOut`

**It is NEVER used to recalculate the deficit.**

The convergence loop at Step F triggers ONLY when a **rate** changes:
- LTCG rate jumps (0% → 15% → 20%)
- Ordinary marginal rate jumps (bracket crossing from Traditional withdrawals)
- SS taxability tier jumps (0% → 50% → 85%)

When triggered, recalculate with the new RATE, then re-solve algebraically.
Do NOT recalculate the deficit with the new tax amount.

Tax calculation uses `taxableTotal` (which includes all of the above).

---

## Withdrawal Logic

### Single Unified Path

There is ONE withdrawal function. Both basic and tax-optimized modes use it. The only difference is which accounts are chosen and in what order.

```typescript
function planWithdrawals(
  netNeeded: number,
  accountOrder: AccountWithdrawalInfo[],  // Ordered list of accounts to tap
  taxContext: TaxContext                    // Current income, brackets, rates
): PlannedWithdrawal[]
```

**Basic mode:** `accountOrder` comes from user's configured withdrawal order.
**Tax-optimized mode:** `accountOrder` comes from the optimizer's recommended order (based on bracket analysis).

The function walks the list and for each account calculates gross from net using the correct formula for that account type.

### Gross-Up Formulas

**CRITICAL:** These formulas are applied to the **BASE deficit** (expenses + ordinaryTax + FICA - income), NOT to a deficit that already includes LTCG tax. Including LTCG tax in the deficit before grossing up causes double-counting and poor convergence.

**Savings/Checking:**
```
gross = net
tax = 0
```

**Brokerage (FIFO lot-aware):**
```
gainRatio = unrealizedGains / accountBalance
effectiveTaxRate = gainRatio × applicableFederalLTCGRate
gross = net / (1 - effectiveTaxRate)
```
Note: `gainRatio` is an approximation. Actual gains depend on which lots are sold (FIFO). For gross-up estimation this is close enough; the convergence loop corrects any error.

**State tax note:** Gross-up uses federal rates only. State tax impact is resolved by the convergence loop, which may require 1-3 additional iterations in states that tax capital gains (e.g., VA, CA). No-income-tax states (TX, FL, NV) may converge in 1 iteration.

**Traditional / Traditional 401k:**
```
marginalRate = current federal marginal rate + state marginal rate
penaltyRate = (age < 59.5) ? 0.10 : 0
gross = net / (1 - marginalRate - penaltyRate)
```

**Roth IRA / Roth 401k:**
```
# Follows IRS ordering: contributions → conversions → earnings
IF withdrawing contributions or 5-year+ conversions:
  gross = net (no tax)
ELSE IF withdrawing earnings or <5-year conversions AND age < 59.5:
  gross = net / (1 - marginalRate - 0.10)
```

**Note:** HSA is NOT part of the regular withdrawal order. HSA is handled as a separate pre-step for healthcare expenses only (see HSA Withdrawal Logic section).

### Account Drain Behavior

When an account balance is less than the net needed from it:
- Withdraw the entire balance (drain to $0)
- Calculate actual tax on the drained amount
- Remaining deficit passes to the next account in order

### Emergency Fund / Savings Treatment

Savings accounts are moved to the **end** of the user's configured withdrawal order, with one exception: savings is preferred over penalized withdrawals.

**Priority logic:**
1. Non-penalized accounts (in user's configured order)
2. Savings (even if user placed it earlier)
3. Penalized accounts (Traditional pre-59.5, Roth earnings pre-59.5)

**Example at age 45:**
- User's order: Brokerage → Savings → Traditional → Roth
- Effective order: Brokerage → Roth (contributions only) → **Savings** → Traditional (10% penalty) → Roth (earnings, 10% penalty)

Rationale: No one wants to pay a 10% penalty when they could use penalty-free savings. But savings is still preserved over other non-penalized sources.

### Cross-Account Tax Payment

**Unified concept:** Brokerage can pay tax for another account's event. This applies to:
1. **Traditional withdrawals** — pay withdrawal tax from brokerage instead of grossing up
2. **Roth conversions** — pay conversion tax from brokerage instead of withholding

When the tax optimizer evaluates these options, it compares the total tax cost:

**Example: Traditional withdrawal**
```
Option A: Traditional gross-up
  Withdraw $13,158 to net $10,000 (at 24% marginal)
  Tax cost: $3,158

Option B: Brokerage pays tax
  Withdraw $10,000 from Traditional (taxed as ordinary: $2,400)
  Sell $2,400 from brokerage to cover tax
  Brokerage tax: $2,400 × gainRatio × 15% = ~$180
  Total tax cost: $2,580
  Savings vs Option A: $578
```

**Example: Roth conversion**
```
Option A: Withhold from conversion
  Convert $50,000, withhold 22% ($11,000) for tax
  Net to Roth: $39,000

Option B: Brokerage pays tax
  Convert $50,000, full amount goes to Roth
  Sell $11,000 from brokerage to pay tax
  Brokerage tax: $11,000 × gainRatio × 15% = ~$825
  Total tax cost: $11,000 ordinary + $825 LTCG = $11,825
  But $50,000 in Roth vs $39,000 — extra $11,000 grows tax-free
```

The solver evaluates both when `taxOptimizationEnabled = true` and picks the lower-cost option.

---

## Roth Conversion Logic

```
IF retired AND taxOptimizationEnabled:

  0. Calculate target Traditional balance:
     targetBalance = calculateTargetTraditionalBalance(
       standardDeduction, expectedSS, expectedPension, rmdDivisor
     )
     # This is the balance we want to KEEP, not convert away

  1. Determine bracket ceiling:
     IF user.bracketCeilingOverride:
       ceiling = user.bracketCeilingOverride
     ELSE:
       ceiling = calculateDynamicCeiling(tradBalance, age, ssEstimate, pensionEstimate)

  2. Calculate bracket space:
     bracketSpace = ceiling - (ordinaryIncome + traditionalWithdrawals + taxableSS)

  3. If bracketSpace > 0:
     maxConversion = min(bracketSpace, traditionalBalance)
     conversionTax = calculate marginal tax on conversion

  4. Determine tax funding source (in priority order):
     IF surplus >= conversionTax:
       Convert maxConversion, pay tax from surplus cash
     ELSE IF brokerage >= conversionTax:
       Convert maxConversion, pay tax from brokerage
     ELSE IF settings.allowWithholding:
       Convert maxConversion × (1 - withholdingRate)
     ELSE:
       Skip conversion this year

  5. ACA cliff check (if age < 65 AND settings.acaAware):
     Three-variable interaction: conversion → tax → deficit → LTCG → MAGI

     magi = ordinaryIncome + conversion + capitalGains + taxableSS
     IF magi > acaCliffThreshold:
       Solve algebraically (assuming 0% LTCG rate):
         Let C = conversion, r = blendedTaxRate, g = gainRatio, E = expenses

         conversionTax = C × r
         baseDeficit = E + conversionTax = E + C×r
         LTCG = baseDeficit × g = (E + C×r) × g = E×g + C×r×g
         MAGI = C + LTCG = C + E×g + C×r×g = C(1 + r×g) + E×g

         Setting MAGI ≤ acaCliff - buffer:
         C(1 + r×g) + E×g ≤ acaCliff - buffer
         C ≤ (acaCliff - buffer - E×g) / (1 + r×g)

       The (1 + r×g) term captures the amplification: reducing conversion
       by $1 also reduces LTCG by r×g (conversion tax savings × gain ratio).

       Example: acaCliff=$62,500, E=$45,000, g=0.333, r=0.11
         C ≤ ($62,000 - $45,000×0.333) / (1 + 0.333×0.11)
         C ≤ $47,015 / 1.037 ≈ $45,340

       Log: "Conversion reduced from $X to $Y to stay under ACA cliff ($Z)."

  6. If conversion causes additional withdrawal need for tax:
     Add brokerage withdrawal to plan, re-enter convergence loop
```

### Dynamic Bracket Ceiling

Single-year greedy with forward-looking RMD projection — NOT multi-year optimization.

```typescript
function calculateDynamicCeiling(
  traditionalBalance: number,
  currentAge: number,
  lifeExpectancy: number,
  estimatedSSandPension: number
): number {
  // 1. Project RMDs from start age to life expectancy
  const rmdStartAge = getRMDStartAge(); // 73 or 75 per SECURE 2.0
  const projectedRMDs = projectRMDs(traditionalBalance, rmdStartAge, lifeExpectancy);
  const maxProjectedRMD = Math.max(...projectedRMDs);

  // 2. Find the bracket that peak RMD + other income would fill
  const peakIncome = maxProjectedRMD + estimatedSSandPension;
  const rmdBracket = getBracketForIncome(peakIncome);

  // 3. Target = that bracket's ceiling
  // Rationale: converting into the same bracket you'd be in during
  // peak RMDs means you pay the same rate now, but Roth growth is tax-free
  return rmdBracket.ceiling;
}
```

User can override with an explicit target bracket for more conservative conversion strategy.

### Target Balance Strategy (Core Optimization)

The goal is NOT to deplete Traditional accounts by RMD age. The goal is to reach an **optimal target balance** that:
1. Generates RMDs that fill the 0% tax bracket (standard deduction)
2. Avoids "wasting" tax-free space in retirement
3. Minimizes lifetime taxes

**Why keep some Traditional balance?**

If you convert everything to Roth before RMDs start:
- At age 75, your only ordinary income might be SS + small pension
- Standard deduction is ~$15,700 — you could have ~$15k of income taxed at 0%
- But with $0 Traditional, you withdraw from Roth (already tax-free) instead
- You "wasted" the 0% bracket space

**Calculate the target balance:**

```typescript
function calculateTargetTraditionalBalance(
  standardDeduction: number,      // ~$15,700 single, ~$31,400 MFJ (at RMD age)
  expectedSSIncome: number,       // Projected SS at RMD age
  expectedPensionIncome: number,  // Projected pension at RMD age
  rmdDivisorAtStart: number       // ~26.5 at age 73
): number {
  // How much ordinary income can we have at 0% effective rate?
  // (This is simplified — SS taxability complicates it)
  const taxFreeOrdinarySpace = standardDeduction;

  // How much of that space is already filled by other income?
  // Note: SS taxability depends on total income, so this is iterative in practice
  const otherOrdinaryIncome = expectedPensionIncome; // SS taxability calculated separately

  // Target RMD to fill remaining 0% space
  const targetRMD = Math.max(0, taxFreeOrdinarySpace - otherOrdinaryIncome);

  // Traditional balance that generates this RMD
  return targetRMD * rmdDivisorAtStart;
}
```

**Example:**
- Standard deduction at 73: $15,700 (single)
- Expected pension: $0
- Target RMD: $15,700
- RMD divisor at 73: 26.5
- **Target balance: $15,700 × 26.5 = $416,050**

With $1M Traditional today, convert down to ~$416k, not $0.

**Where do projected SS/pension values come from?**

The `expectedSSIncome` and `expectedPensionIncome` parameters are projected from current income to RMD age using COLA:

```typescript
// Use existing estimateFixedIncomeAtRMD() from helpers.ts
// It takes:
//   - Current SS income (or $0 if not yet claiming)
//   - Future SS PIA (from FutureSocialSecurityIncome if configured)
//   - Current pension income
//   - Current age, RMD start age, SS claiming age
//   - COLA rates (default 2%)
//
// Returns: { ssAtRMD, pensionAtRMD, yearsProjected }
```

If the user has a `FutureSocialSecurityIncome` configured, use the PIA × 12 projected forward with COLA to RMD age. If they have pension income (FERS, CSRS), project that forward with COLA as well.

### Time-Based Conversion Pacing (Growth-Adjusted)

Pacing spreads conversions evenly to reach the **target balance** (not $0) by RMD start.

```typescript
function calculateConversionAmount(
  traditionalBalance: number,
  targetBalance: number,          // From calculateTargetTraditionalBalance() - this is a FUTURE value
  currentAge: number,
  bracketSpace: number,           // From dynamic ceiling calculation
  expectedGrowthRate: number      // From assumptions
): number {
  // 1. Calculate years until RMDs start
  const rmdStartAge = getRMDStartAge();  // 73 or 75
  const yearsToRMD = Math.max(0, rmdStartAge - currentAge);

  // 2. Calculate present value of target balance
  // IMPORTANT: targetBalance is what we want at RMD age (future value)
  // We must discount it to present value before comparing to current balance
  const pvTargetBalance = yearsToRMD > 0 && expectedGrowthRate > 0
    ? targetBalance / Math.pow(1 + expectedGrowthRate, yearsToRMD)
    : targetBalance;

  // 3. Calculate excess balance (in today's dollars)
  const excessBalance = traditionalBalance - pvTargetBalance;

  // If already at or below PV of target, no conversion needed for pacing
  if (excessBalance <= 0) {
    // Still might convert to fill current bracket, but no pacing pressure
    return Math.min(bracketSpace, traditionalBalance);
  }

  // 4. Growth-adjusted annual target (PMT-style)
  let annualTarget: number;
  if (yearsToRMD <= 0) {
    annualTarget = Infinity;  // At/past RMD age, no pacing limit
  } else if (expectedGrowthRate <= 0) {
    annualTarget = excessBalance / yearsToRMD;
  } else {
    // PMT formula on EXCESS balance (not total balance)
    const r = expectedGrowthRate;
    const n = yearsToRMD;
    annualTarget = excessBalance * r / (1 - Math.pow(1 + r, -n));
  }

  // 5. Actual conversion = minimum of all constraints
  return Math.min(
    bracketSpace,         // Don't exceed target bracket
    annualTarget,         // Pacing limit
    traditionalBalance    // Can't convert more than exists
  );
}
```

**Example:**
- Age 55, Traditional $1M, target balance $416k (at age 73), RMD starts at 73 → 18 years
- PV of target balance: $416k / 1.07^18 = $123k
- Excess balance (today's dollars): $1M - $123k = $877k
- PMT at 7%: $877k × 0.07 / (1 - 1.07^-18) ≈ $85k/year
- Convert ~$85k/year to reach $416k by age 73

**Age 40 example:**
- Traditional $500k, target balance $416k (at age 73), 33 years to RMD
- PV of target balance: $416k / 1.07^33 = $44.6k
- Excess balance (today's dollars): $500k - $44.6k = $455.4k
- PMT at 7%: $455.4k × 0.07 / (1 - 1.07^-33) ≈ $35.7k/year
- Compare to "deplete to $0" formula: $39.2k/year
- Difference (~$3.5k/year) preserves the 0% bracket value

**Why this is better than "deplete to $0":**
- At age 73 with $416k Traditional: RMD ~$15.7k fills standard deduction at 0%
- At age 73 with $0 Traditional: "wasted" $15.7k of 0% bracket space
- Savings: avoided converting ~$3.5k/year × 33 years at 10-12% = avoided ~$11-14k in conversion taxes
- Those unconverted dollars become RMDs taxed at 0% instead

**Which growth rate to use:**
- Use the Traditional account's custom return rate if set
- Otherwise, use the global investment return rate from assumptions

**Edge cases:**
- At RMD age: yearsToRMD = 0 → annualTarget = Infinity → use bracket ceiling only
- Already below target: Skip conversion. If Traditional < target, future RMDs will already
  be small enough to fill the 0% bracket. Converting now at 10-12% is worse than RMDs at 0%.
  Example: $120k Traditional, $416k target, age 68 → RMDs at 73 will be ~$5k (0% tax).
  Log: "Skipped Roth conversion: Traditional balance ($X) below target ($Y)."
- Zero/negative growth: falls back to simple division
- Multiple Traditional accounts: sum balances for target calculation

---

## Surplus Handling

### When Surplus Occurs
- RMDs exceed spending needs
- Pension + SS fully covers expenses
- Working year with excess income

### Allocation (Reuses Paycheck Allocator)

Retirement surplus uses the same priority system as working-year paycheck allocation:

```
1. Pay down DeficitDebt first (if any exists)
2. Follow user's priority bucket order:
   - Emergency fund (savings) up to target
   - Roth IRA (ONLY if earned income this year)
   - Brokerage (default catch-all)
3. Any remaining surplus: Brokerage
```

Roth contribution from surplus is only attempted if:
1. User has earned income this year
2. Earned income ≥ surplus being allocated
3. Roth contribution room available

If no earned income, skip Roth in priority list silently.

---

## Deficit Debt

Preserved from current system:

1. **When `unfundedDeficit > 0`**: Increment DeficitDebtAccount running balance
2. **When `surplus > 0`**: Pay down DeficitDebt FIRST, before other allocations
3. **Interest**: No interest charged (tracking mechanism, not real debt). This represents "expenses you couldn't cover" — the simulation continues to show realistic future years rather than halting.

---

## ESPP Integration

ESPP accounts have unique tax treatment that the withdrawal planner must handle:

**During working years:**
- ESPP contributions calculated via `getAnnualESPPContribution()`
- New lots created at purchase price with grant date and purchase date

**During withdrawals:**
- `calculateDispositionType(lot, saleDate)` determines qualifying vs disqualifying
- Qualifying: ordinary income = lesser of (grant discount, actual gain), rest is LTCG
- Disqualifying: bargain element = ordinary income, rest is STCG or LTCG
- Lot order follows user preference: FIFO, disqualifying-first, or qualifying-first

**Gross-up for ESPP:**
More complex because tax treatment depends on lot type. The withdrawal planner uses `calculateSaleTax()` to determine the tax breakdown, then grosses up accordingly.

---

## Property & Mortgage Integration

**Property accounts:**
- Appreciate annually by housing appreciation rate from assumptions
- Do NOT generate cash flow (no rental income unless modeled as separate income)
- Contribute to net worth calculation
- Mortgage paydown tracked in Phase 3

**Mortgage expenses:**
- `calculateAnnualAmortization(year)` provides interest + principal split
- Interest portion feeds into itemized deductions (SALT cap applies)
- Principal portion reduces PropertyAccount loan balance
- Escrow items (taxes, insurance, HOA) are non-deductible expenses

**Loan expenses:**
- `calculateAnnualAmortization(year)` for annual P&I
- Interest may or may not be deductible depending on loan type
- Balance updates in Phase 3

---

## HSA Withdrawal Logic

HSA is used ONLY for qualified healthcare expenses. Never used for non-healthcare spending.

```typescript
function planHSAWithdrawal(
  healthcareExpenses: number,
  hsaBalance: number
): { hsaWithdrawal: number; remainingHealthcare: number } {
  const hsaWithdrawal = Math.min(healthcareExpenses, hsaBalance);
  return {
    hsaWithdrawal,
    remainingHealthcare: healthcareExpenses - hsaWithdrawal
  };
}
```

**In solver flow:**
1. Phase 1: Identify healthcare expenses separately
2. Phase 2: HSA covers healthcare first (tax-free)
3. Any uncovered healthcare becomes part of the general deficit

---

## Roth Withdrawal Ordering

Existing implementation in WithdrawalService.ts is preserved — no rebuild needed.

IRS ordering rules:
1. **Contributions first**: Tax-free, no penalty (tracked via `regularContributions`)
2. **Conversions second**: FIFO by year, 10% penalty if within 5-year rule (tracked via `conversionHistory`)
3. **Earnings last**: Taxed + 10% penalty if under 59.5

---

## Early Withdrawal Penalties

For Traditional/401k withdrawals before age 59.5, the 10% penalty is included in gross-up:

```typescript
function calculateEarlyWithdrawalCost(
  grossWithdrawal: number,
  marginalRate: number,
  age: number
): { tax: number; penalty: number; total: number } {
  const tax = grossWithdrawal * marginalRate;
  const penalty = age < 59.5 ? grossWithdrawal * 0.10 : 0;
  return { tax, penalty, total: tax + penalty };
}
```

The optimizer naturally avoids penalties by preferring brokerage/Roth when available. Traditional with penalty is only used when no other accounts can cover the deficit.

Decision log notes when penalty is taken: `"Withdrew $X from Traditional with 10% early withdrawal penalty ($Y). No penalty-free accounts available."`

Note: Rule 72(t) / SEPP is NOT modeled. That's user-specific and complex.

---

## Spending Strategies

### Guyton-Klinger Guardrails

Uses existing GK settings — no changes to thresholds or adjustment percentages.

```typescript
function applyGuardrails(
  priorYearEndPortfolio: number,
  baseSpending: number,
  settings: GuardrailSettings
): GuardrailsResult {
  const withdrawalRate = baseSpending / priorYearEndPortfolio;
  let adjusted = baseSpending;
  let hitCeiling = false, hitFloor = false;

  if (withdrawalRate < settings.ceilingRate) {
    adjusted = baseSpending * (1 + settings.ceilingAdjustment);
    hitCeiling = true;
  }
  if (withdrawalRate > settings.floorRate) {
    adjusted = baseSpending * (1 - settings.floorAdjustment);
    hitFloor = true;
  }

  return { baseSpending, adjustedSpending: adjusted, hitCeiling, hitFloor };
}
```

**Integration:**
1. Phase 1 calculates guardrails target using prior year-end portfolio
2. `maxDiscretionarySpending = guardrails.adjustedSpending - fixedExpenses`
3. If `fixedExpenses > guardrails.adjustedSpending`:
   - Withdraw to cover fixed expenses anyway
   - Log: `"WARNING: Fixed expenses ($X) exceed guardrails budget ($Y)."`

### Other Strategies

- **Needs Based**: deficit = expenses - income (no target, just cover the gap)
- **Fixed Real**: inflation-adjusted fixed amount per year
- **Percentage**: fixed % of portfolio
- All strategies use the same withdrawal machinery — they just set different spending targets

---

## Account State Flow

Accounts are NEVER mutated during planning. Phase 3 creates new account objects.

```typescript
function executePhase3(
  currentAccounts: AnyAccount[],   // Read-only
  yearPlan: YearPlan
): AnyAccount[] {
  // 1. Deep clone all accounts
  const nextAccounts = deepClone(currentAccounts);

  // 2. Apply withdrawals
  for (const w of yearPlan.withdrawals) {
    const account = findAccount(nextAccounts, w.accountId);
    account.withdraw(w.gross);  // Updates balance, costBasis, lots
  }

  // 3. Apply Roth conversion
  if (yearPlan.conversion) {
    const trad = findAccount(nextAccounts, yearPlan.conversion.fromAccountId);
    const roth = findAccount(nextAccounts, yearPlan.conversion.toAccountId);
    trad.withdraw(yearPlan.conversion.amount);
    roth.deposit(yearPlan.conversion.amount); // Track in conversionHistory
  }

  // 4. Apply surplus allocations
  for (const alloc of yearPlan.surplusAllocations) {
    const account = findAccount(nextAccounts, alloc.accountId);
    account.deposit(alloc.amount);
  }

  // 5. Apply contributions (working years)
  for (const contrib of yearPlan.contributions) {
    const account = findAccount(nextAccounts, contrib.accountId);
    account.deposit(contrib.amount);
  }

  // 6. Grow all accounts
  for (const account of nextAccounts) {
    account.increment(assumptions, yearPlan.returnOverride);
  }

  return nextAccounts;
}
```

Year-to-year flow in the outer simulation loop:
```typescript
let accounts = initialAccounts;
for (const year of simulationYears) {
  const result = simulateOneYear(year, accounts, incomes, expenses, ...);
  accounts = result.accounts;  // New objects, previous year unchanged
  results.push(result);
}
```

---

## State Transitions (Future Consideration)

Not implemented in v1 of the rewrite, but the architecture should not prevent these:

- **State residency change** (e.g., Virginia → Texas at 65): Would change `taxState.stateResidency` at a milestone. No architectural blocker.
- **Filing status change** (e.g., MFJ → Single after spouse death): Would change `taxState.filingStatus` at a milestone. No architectural blocker.
- **Account consolidation** (e.g., roll 401k → IRA at retirement): Future feature. Milestone-triggered account merge.

The milestone system already supports these trigger types — just need the actions.

---

## Decision Log

Always computed. UI decides whether to display.

```typescript
interface DecisionLogEntry {
  category: 'withdrawal' | 'conversion' | 'contribution' | 'surplus' | 'tax' | 'warning';
  account?: string;
  amount?: number;
  description: string;
}
```

**Examples:**
- `"Withdrew $15,000 from Traditional IRA to satisfy Required Minimum Distribution."`
- `"Withdrew $8,000 from Brokerage to cover spending deficit. LTCG: $2,400, STCG: $0."`
- `"Converted $25,000 from Traditional to Roth to fill 22% bracket. Tax ($4,200) paid from Brokerage."`
- `"Allocated $5,000 RMD surplus to emergency fund (target: $30,000, current: $25,000)."`
- `"Skipped Roth IRA surplus allocation: no earned income this year."`
- `"WARNING: Fixed expenses ($45,000) exceed guardrails budget ($40,000). Withdrawing to cover."`
- `"WARNING: Tax calculation did not converge after 10 iterations. Difference: $47."`

---

## Sankey Display Rules

**Gross withdrawals shown:** The full gross amount leaves the account. Tax (including LTCG) is a separate outflow. This ensures: `gross inflows = expenses + total tax outflows`. No phantom surplus.

**Withheld conversion tax:** When `taxSource = 'WITHHOLD'`, show the conversion as:
`Traditional ($gross) → splits to → Roth ($netToRoth) + Tax ($taxAmount)`

---

## YearPlan Output Structure

```typescript
interface YearPlan {
  // Withdrawals (includes RMDs as explicit entries)
  // RMD withdrawals appear with reason: "Required Minimum Distribution"
  //   Note: RMD has gross = net (no tax withheld at withdrawal)
  //   The RMD is taxed as ordinary income on the return, not at withdrawal time
  // Deficit-covering withdrawals appear with reason: "Spending deficit"
  withdrawals: {
    source: AccountType;
    accountId: string;
    gross: number;
    net: number;
    capitalGains?: {
      shortTerm: number;
      longTerm: number;
    };
    penalty: number;
    reason: string;  // "Required Minimum Distribution" | "Spending deficit" | etc.
  }[];

  // Roth conversion
  conversion: {
    amount: number;
    fromAccountId: string;
    toAccountId: string;
    taxSource: 'SURPLUS' | 'BROKERAGE' | 'WITHHOLD';
    taxAmount: number;
    netToRoth: number;  // amount - taxAmount when WITHHOLD, otherwise = amount
    reason: string;
  } | null;

  // UI NOTE: Sankey display for withheld conversion tax
  // When taxSource = 'WITHHOLD', show the conversion as:
  //   Traditional ($amount) → splits to → Roth ($netToRoth) + Tax ($taxAmount)
  // This makes the flow visually clear that tax was taken from the conversion.

  // Contributions (working years)
  contributions: {
    accountId: string;
    amount: number;
    type: 'employee_pretax' | 'employee_roth' | 'employer_match' | 'espp';
  }[];

  // Surplus allocations
  surplusAllocations: {
    accountId: string;
    amount: number;
    reason: string;
  }[];

  // Tax summary
  tax: {
    federal: number;
    state: number;
    fica: number;
    capitalGainsLT: number;
    capitalGainsST: number;
    niit: number;
    penalties: number;
    total: number;
  };

  // Cash flow
  surplus: number;
  unfundedDeficit: number;

  // Metadata
  iterations: number;
  converged: boolean;
  decisions: DecisionLogEntry[];
}
```

---

## Design Decisions (Resolved)

### Core Architecture
| # | Decision | Resolution |
|---|----------|------------|
| 1 | Time unit | Year (sufficient for long-term planning) |
| 2 | Account growth timing | End of year (grow after all transactions) |
| 3 | Code path | Single unified withdrawal path — tax optimization changes order, not execution |
| 4 | Purity | Pure function: input → output, accounts cloned not mutated |
| 5 | Web Worker | Nice to have, keep engine serializable, don't block on it |
| 6 | Validation | Fail fast: check for impossible scenarios before running |
| 7 | Optimizer lookahead | Single-year greedy with dynamic ceiling (NOT multi-year) |

### Tax & Optimization
| # | Decision | Resolution |
|---|----------|------------|
| 8 | Cross-account tax payment | Yes — brokerage can pay Traditional withdrawal taxes if cheaper |
| 9 | Conversion bracket ceiling | Both: dynamic calculation default, user override available |
| 10 | ACA cliff | Optional toggle, user setting to enable/disable |
| 11 | Early withdrawal penalty | Allow if tax-optimal (10% penalty if total cost < alternatives) |
| 12 | Minimum conversion threshold | None — convert even $1 if bracket space exists |
| 12a | Target balance strategy | Convert to optimal target balance (not $0) — preserve enough Traditional to fill 0% bracket during RMDs |

### Withdrawal Logic
| # | Decision | Resolution |
|---|----------|------------|
| 13 | Account drain | Drain to $0 when remaining balance < deficit |
| 14 | Roth ordering | Track and enforce strictly per IRS rules |
| 15 | Savings/emergency fund | Savings moved to end of user's configured order; preferred over penalized withdrawals |
| 16 | HSA treatment | Healthcare expenses only, never for general spending |
| 17 | Full income coverage | Still run conversion logic even with no spending deficit |

### Spending & Guardrails
| # | Decision | Resolution |
|---|----------|------------|
| 18 | GK timing | End of previous year portfolio value |
| 19 | GK overflow | Withdraw to cover fixed expenses + log warning |
| 20 | Inflation | Per-category where specified, generic rate otherwise |
| 21 | COLA timing | Start of year |

### Monte Carlo
| # | Decision | Resolution |
|---|----------|------------|
| 22 | Return distribution | Normal (current) |
| 23 | What varies | Only investment returns (not inflation, SS COLA, tax brackets) |

### Accounts & Debt
| # | Decision | Resolution |
|---|----------|------------|
| 24 | Account consolidation | Future feature, not blocking |
| 25 | Debt prioritization | If debt interest > expected return, prioritize payoff |

### Output
| # | Decision | Resolution |
|---|----------|------------|
| 26 | Decision log | Always computed, UI controls display |

---

## Files: What Changes

### DELETE
```
- Binary search residual logic (SimulationEngine current lines ~631-730)
- "Assume all Traditional" estimation (current line ~199)
- Separate executeWithdrawalPlan vs executeWithdrawals dual path
- TaxOptimizedWithdrawal.ts planTaxOptimizedYear (1,722 lines → replaced by YearSolver)
```

### KEEP (reuse as-is)
```
- TaxService.tsx — all tax calculation functions (well-tested, 2,768+ tests)
- calculateLotAwareWithdrawal — FIFO lot selection
- calculateGrossWithdrawal — algebraic gross-up (may use as reference)
- processRMDs — RMD calculation logic
- Roth IRS ordering rules in WithdrawalService
- SpendingStrategy.ts — GK guardrails, lifestyle creep
- MilestoneEvaluator.ts — milestone evaluation
- IncomeProjection.ts — income projection
- AccountGrowth.ts — account growth (growAccounts)
- ESPPAccount methods — disposition type, sale tax calculation
- MortgageExpense / LoanExpense — amortization calculations
```

### NEW FILES
```
- src/services/simulation/YearSolver.ts — Phase 2R convergence solver
- src/services/simulation/SurplusAllocator.ts — Phase 4 surplus handling
- src/services/simulation/WithdrawalPlanner.ts — unified withdrawal planning (single path)
- src/services/simulation/IncomeClassifier.ts — spendable vs reinvested vs conversion
```

### MODIFY
```
- SimulationEngine.tsx — rewrite as thin orchestrator calling Phases 1-4
- WithdrawalService.ts — simplify to pure execution (remove tax estimation, remove dual paths)
- RothConversionService.ts — simplify to pure execution
- types.ts — add YearPlan, ClassifiedIncome, DecisionLogEntry, PlannedWithdrawal
```

---

## Migration Path

1. **Phase A**: Build YearSolver alongside existing engine behind a feature flag
2. **Phase B**: Comprehensive testing — run both engines on same scenarios, compare outputs
3. **Phase C**: Switch default to new engine, keep old as fallback
4. **Phase D**: Remove old engine after confidence period

Feature flag: `assumptions.useNewEngine: boolean` (default false during development)

---

## Performance Considerations

**Monte Carlo impact:**
With convergence loops, worst-case execution count:
```
5 iterations × 50 years × 500 Monte Carlo runs = 125,000 solver executions
```

**Mitigation strategies:**
1. Most years won't need 5 iterations (income-covers-expenses = 1 iteration)
2. Retirement years with stable income converge in 1-2 iterations
3. Tax calculation is already well-optimized
4. Monte Carlo runs can be parallelized (Web Worker)
5. Fallback: Reduce default Monte Carlo runs if performance is unacceptable

**Monitoring:** Add timing telemetry during development to identify bottlenecks.

---

## Testing Strategy

### Unit Tests (per new file)

**YearSolver.ts:**
- Convergence with no withdrawals needed (income covers expenses)
- Convergence with brokerage-only withdrawals
- Convergence with Traditional withdrawals (bracket crossing)
- Convergence with mixed sources
- Non-convergence handling (hit max iterations)
- Dampening prevents oscillation

**WithdrawalPlanner.ts:**
- Gross-up accuracy for each account type
- Account drain behavior (withdraw remaining balance, pass deficit to next)
- Savings moved to end of non-penalized accounts (but before penalized)
- Cross-account tax payment comparison

**SurplusAllocator.ts:**
- RMD surplus → emergency fund → brokerage
- DeficitDebt paydown before other allocations
- Skip Roth when no earned income

**IncomeClassifier.ts:**
- Reinvested dividends classified as non-spendable
- Roth conversions classified as non-spendable
- RMDs classified as spendable
- Mixed income correctly split

### Integration Scenarios

```
Scenario 1: Early Retiree (age 40)
  Setup: Brokerage $200k (50% gains), Trad $500k, expenses $50k, no income
  Verify:
  - Brokerage tapped first (no penalty)
  - Traditional NOT tapped (10% penalty)
  - Roth conversion fills low brackets
  - Capital gains calculated on brokerage withdrawal
  - No phantom remaining

Scenario 2: RMD Surplus (age 75)
  Setup: Trad $1.5M, SS $30k/yr, pension $20k/yr, expenses $60k
  Verify:
  - RMD calculated correctly (~$58k at 75)
  - RMD + SS + pension > expenses → surplus
  - Surplus allocated per priority (emergency → brokerage)
  - No deficit despite high tax bill
  - Decision log explains surplus allocation

Scenario 3: Brokerage Depletion Year
  Setup: Brokerage $15k, Trad $500k, expenses $50k
  Verify:
  - Brokerage drained to $0 (not $47 dust)
  - Remaining deficit covered by next account in order
  - LTCG only on brokerage gains (not full amount)
  - Smooth transition, no spike in "remaining"

Scenario 4: Algebraic Gross-Up (formerly Convergence Stress Test)
  Setup: Age 62, pension $40k, expenses $70k
         Brokerage $400k (basis $150k, gains $250k)
         Traditional $900k, Roth $100k, Savings $30k
         SS $28k at 67 (not yet claiming)
  Verify:
  - Conversion decided FIRST ($79,050 to fill 22% bracket)
  - Ordinary tax fully determined ($17,651)
  - LTCG rate determined (15% — ordinary income exceeds $48,475)
  - Base deficit = $70k + $17,651 - $40k = $47,651
  - Algebraic gross-up: $47,651 / (1 - 0.625 × 0.15) = $52,580.41
  - LTCG tax = $52,580.41 × 0.625 × 0.15 = $4,929.41
  - Total tax = $22,580.41
  - Solved in 1 pass (no convergence loop needed)
  - Sankey balances: $92,580.41 in = $92,580.41 out

Scenario 5: GK Cap Binds + Traditional Below Target
  Setup: Age 68, SS $25k, prior portfolio $250k (severe crash)
         Brokerage $80k (basis $60k), Traditional $120k, Roth $30k
         Fixed expenses $42k, discretionary $18k
         GK-adjusted budget $38k (after multiple years of floor hits)
  Verify:
  - Fixed expenses ($42k) > GK budget ($38k) → discretionary eliminated
  - Engine still covers full $42k fixed (does NOT cap at GK budget)
  - Warning logged: "Fixed expenses exceed guardrails budget"
  - Traditional ($120k) < target ($416k) → no conversion
  - Conversion skip logged: "Traditional balance below target"
  - Brokerage withdrawal $17k at 0% LTCG
  - LTCG ($4,250) added to provisional income → SS still 0% taxable
  - Total tax = $0
  - Solved in 1 pass

Scenario 6: All Accounts Depleted
  Setup: Age 90, SS $28k, expenses $48k (nursing care)
         Brokerage $0, Traditional $0, Roth $0, Savings $2k
  Verify:
  - Savings drained to $0 (last resort used)
  - Remaining $18k deficit recorded in DeficitDebt
  - Warning logged: "Unfunded deficit of $18,000. All accounts exhausted."
  - No crash, no infinite loop
  - Simulation continues (doesn't halt)
  - No conversion attempted (no Traditional balance)
  - SS at 0% taxable (provisional $14k < $25k threshold)
  - Tax = $0
  - Solved in 1 pass

Scenario 7: Working Year
  Setup: Age 35, salary $120k, expenses $65k
         401k: 10% employee ($12k), 50% match on 6% ($3.6k)
         Emergency fund target $25k (current $15k)
         Buckets: Emergency → Roth IRA → Brokerage
  Verify:
  - 401k contribution = $12,000 (10% of salary)
  - Employer match = $3,600 (50% of first 6%)
  - FICA = $9,180 (on gross $120k, not taxable)
  - Federal tax = $15,220 (on $108k - $15.7k std deduction)
  - Net take-home = $83,600
  - Available for allocation = $18,600
  - Emergency fund topped up: $10,000 (to reach $25k target)
  - Roth IRA contribution: $7,000 (2025 limit)
  - Brokerage remainder: $1,600
  - No withdrawals, no conversion
  - Solved in 1 pass (no circular dependency)

Scenario 8: Roth Conversion with ACA Cliff
  Setup: Age 58, retired, $0 income, expenses $45k
         Brokerage $300k (33% gain ratio), Traditional $700k
         ACA cliff: $62,500 (400% FPL, single)
         Pacing target: $60,282, bracket space: $64,175
  Verify:
  - Without ACA: conversion = $60,282
  - Initial MAGI = $60,282 + $15k LTCG = $75,282 > cliff ❌
  - MAGI includes LTCG from withdrawal (not just conversion)
  - Algebraic solve accounts for conversion → tax → withdrawal → LTCG
  - Reduced conversion = $45,000
  - Final MAGI = $45,000 + $16,076 LTCG = $61,076 < $62,500 ✓
  - Decision log: "Conversion reduced from $60,282 to $45,000: MAGI would exceed ACA cliff"
  - LTCG still at 0% (ordinary + LTCG under $48,475)
  - Buffer maintained (~$500 under cliff)

Scenario 9: ESPP Withdrawal
  Setup: Age 45, retired, expenses $35k, ESPP $40k with two lots:
         Lot A: Qualifying (2022 purchase, 2021 grant), 100 shares
                Grant discount $5/share, current $200/share
         Lot B: Disqualifying (2024 purchase, 2024 grant), 50 shares
                FMV at purchase $40, purchase $34, current $400/share
  Verify:
  - Lot A (qualifying): ordinary = $500 (lesser of discount vs gain), LTCG = $16,500
  - Lot B (disqualifying): ordinary = $300 (bargain element), LTCG = $18,000
  - Ordinary income from ESPP affects tax bracket
  - LTCG stacks with other LTCG
  - Lot ordering follows config (FIFO, qualifying-first, disqualifying-first)
  - Use existing ESPP calculateDispositionType() and calculateSaleTax() functions

Scenario 10: Monte Carlo Consistency (Systems Test)
  Setup: Moderate scenario (not guaranteed success/failure), 100+ runs with fixed seed
  Verify:
  - Same seed produces identical results across two runs
  - No year in any run has NaN in any field
  - No account balance goes negative
  - DeficitDebt only increases when all accounts are $0
  - Success rate is reasonable (not 0% or 100% for moderate scenario)
  - Spread: 10th percentile < median < 90th percentile
  - Every run's every year has Sankey balance within $1
```

### Regression Tests

Run identical scenarios through old and new engine. Document differences:
- Expected differences (intentional improvements): surplus handling, phantom remaining fixed
- Unexpected differences: investigate before proceeding

Key metrics to compare:
- Final net worth at each age
- Total lifetime taxes paid
- Year accounts deplete
- Monte Carlo success rate

---

## Success Criteria

The rewrite is complete when ALL of the following are true:

### Correctness
- [ ] Zero phantom "remaining" balance in any simulation year
- [ ] Zero circular flows (withdraw + reinvest same account same year)
- [ ] Cashflow Sankey balances to $0 every year
- [ ] RMD withdrawals appear explicitly in YearPlan.withdrawals[]
- [ ] SS taxability correctly recalculated with conversion income

### Convergence
- [ ] All 10 integration scenarios converge in ≤5 iterations
- [ ] Non-convergence warning never appears for typical scenarios
- [ ] Dampening prevents oscillation in bracket-crossing cases

### Compatibility
- [ ] Monte Carlo success rate within ±2% of old engine (or documented reason for difference)
- [ ] All existing integration tests pass (or updated with documented reason)
- [ ] Feature flag allows switching between old and new engine

### Performance
- [ ] Full Monte Carlo (500 runs × 50 years) completes in <10 seconds
- [ ] Single simulation year completes in <50ms

### Testing
- [ ] All 10 integration scenarios pass with hand-verified expected values
- [ ] Unit tests for YearSolver, WithdrawalPlanner, SurplusAllocator, IncomeClassifier
- [ ] Regression tests document expected vs unexpected differences from old engine
