# SimulationEngine Audit Report

## 1. Current State Audit

### Line Counts & Complexity
| File | Lines | Complexity |
|------|-------|------------|
| `TaxOptimizedWithdrawal.ts` | 1,722 | **Very High** - largest file |
| `SimulationEngine.tsx` | 862 | **High** - main orchestrator |
| `WithdrawalService.ts` | 742 | Medium-High |
| `RothConversionService.ts` | 621 | Medium |
| `AccountGrowth.ts` | 431 | Medium |
| `helpers.ts` | 422 | Medium |
| `SpendingStrategy.ts` | 304 | Low-Medium |
| `MilestoneEvaluator.ts` | 305 | Low-Medium |
| `IncomeProjection.ts` | 298 | Low |
| `RMDService.ts` | 180 | Low |
| `types.ts` | 145 | Low (type definitions) |
| **Total** | **6,032** | |

### Main Entry Point
```typescript
export function simulateOneYear(
    year: number,
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    accounts: AnyAccount[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    previousSimulation: SimulationYear[] = [],
    returnOverride?: number,
    previousActiveMilestones: string[] = [],
    previousMilestoneReachYears: Map<string, number> = new Map(),
    baselineProjections?: BaselineProjections
): SimulationYear
```
**11 parameters** - borderline acceptable

### Inputs
- `incomes: AnyIncome[]` - Work, SS, pensions, passive, windfalls
- `expenses: AnyExpense[]` - Fixed, mortgage, loans
- `accounts: AnyAccount[]` - Brokerage, Traditional, Roth, HSA, Saved, ESPP, Property, Debt
- `assumptions: AssumptionsState` - All user assumptions (macro, withdrawal strategy, tax optimization settings)
- `taxState: TaxState` - Filing status, state residency, overrides
- `previousSimulation: SimulationYear[]` - History for strategy calculations
- `returnOverride?: number` - For Monte Carlo
- `previousActiveMilestones` / `previousMilestoneReachYears` - Milestone state

### Output: SimulationYear
```typescript
interface SimulationYear {
    year: number;
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    accounts: AnyAccount[];
    cashflow: {
        totalIncome, totalExpense, livingExpenses, discretionary,
        investedUser, investedMatch, totalInvested,
        bucketAllocations, bucketDetail, withdrawals, withdrawalDetail
    };
    taxDetails: { fed, state, fica, preTax, insurance, postTax, capitalGains, niit };
    logs: string[];
    strategyWithdrawal?: StrategyResult;
    strategyAdjustment?: AdjustmentResult;
    rothConversion?: ConversionResult;
    rmdDetails?: RMDDetails;
    milestoneEvents: MilestoneEvent[];
    activeMilestones: string[];
}
```

### External Services Called
| Service | Functions Used |
|---------|----------------|
| `TaxService` | `getGrossIncome`, `getPreTaxExemptions`, `getPostTaxExemptions`, `calculateFicaTax`, `calculateFederalTaxFromIncomes`, `calculateUnifiedStateTax`, `getTaxParameters`, `getSocialSecurityBenefits`, `calculateTotalFederalTax` |
| `WithdrawalService` | `executeWithdrawals`, `processDeficitDebt` |
| `RMDService` | `processRMDs` |
| `RothConversionService` | `executeRothConversions` |
| `TaxOptimizedWithdrawal` | `planTaxOptimizedYear`, `getAcaCliffThreshold` |
| `SpendingStrategy` | `applyLifestyleCreep`, `calculateStrategyTarget`, `enforceSpendingCap`, `applyProsperitySpending` |
| `AccountGrowth` | `processInflows`, `growAccounts` |
| `MilestoneEvaluator` | `evaluateAllMilestones`, `isActiveByMilestone` |
| `IncomeProjection` | `projectIncomes` |
| `helpers` | `estimateFixedIncomeAtRMD` |

### Modes/Branches
1. **Retired vs Working** - `isRetired` gates withdrawal/Roth conversion logic
2. **Tax Optimization** - `assumptions.investments.taxOptimizationEnabled` enables `planTaxOptimizedYear`
3. **Withdrawal Strategies** - None, Needs Based, Fixed Real, Percentage, Guardrails
4. **Monte Carlo** - `returnOverride` parameter for varied returns
5. **ACA Subsidy Awareness** - `currentAge < 65` gates ACA cliff logic

### Pain Points (Functions with >8 parameters)
| Function | Params | Location |
|----------|--------|----------|
| `planTaxOptimizedYear` | **16** | TaxOptimizedWithdrawal.ts:1265 |
| `calculateDynamicConversionCeiling` | **15** | TaxOptimizedWithdrawal.ts:796 |
| `simulateOneYear` | **11** | SimulationEngine.tsx:66 |

---

## 2. Feature Inventory

| Feature | Sub-features | Status |
|---------|--------------|--------|
| **Withdrawals** | Basic ordering, tax-optimized, penalty-aware (pre-59.5), lot-aware FIFO | Fully implemented |
| **RMDs** | Traditional IRA, 401k, SECURE 2.0 age rules (72/73/75) | Fully implemented |
| **Roth Conversions** | Manual amount, bracket-filling, SS torpedo optimization | Fully implemented |
| **Social Security** | Claiming age (62-70), benefit adjustment, taxability (0/50/85%), earnings test | Fully implemented |
| **Pensions** | FERS (1%/1.1%), CSRS (tiered), FERS Supplement, early reductions, COLA | Fully implemented |
| **Income Streams** | Work, rental, dividends, interest, royalty, windfalls, ESPP | Fully implemented |
| **Accounts** | Brokerage (lot-aware FIFO), Traditional, Roth, HSA, Saved, ESPP (qualifying/disqualifying), Property, Debt | Fully implemented |
| **Federal Tax** | SS taxability, LTCG stacking, STCG as ordinary, NIIT | Fully implemented |
| **State Tax** | 5+ states, SS exemptions, senior deductions | Fully implemented |
| **FICA** | SS wage base cap, Medicare | Fully implemented |
| **Expenses** | Fixed, mortgage amortization, loans, inflation-adjusted, lifestyle creep | Fully implemented |
| **Deficits** | Deficit debt accumulation, interest accrual | Fully implemented |
| **Monte Carlo** | Multiple runs with return variance | Fully implemented |
| **Milestones** | Age-based, net worth, debt payoff, custom triggers | Fully implemented |
| **Spending Strategies** | Fixed Real, Percentage, Guardrails (with prosperity/cap) | Fully implemented |
| **ACA Subsidies** | Cliff awareness for under-65 retirees | Fully implemented |
| **Spousal modeling** | — | Not implemented |
| **Estate/inheritance** | — | Not implemented |
| **Healthcare costs** | Insurance as WorkIncome deduction only | Partial |

---

## 3. Year-by-Year Flow (Actual Order)

```
1. MILESTONE EVALUATION
   └─ evaluateAllMilestones() → determines isRetired, filters incomes/expenses

2. PROJECT INCOMES
   └─ projectIncomes() → grows salaries, SS earnings test, pension COLAs

3. LIFESTYLE CREEP (if applicable)
   └─ applyLifestyleCreep() → increases discretionary expenses

4. WITHDRAWAL STRATEGY TARGET
   └─ calculateStrategyTarget() → Fixed Real/Percentage/Guardrails target

5. PRELIMINARY TAX CALCULATION
   └─ calculateFederalTaxFromIncomes(), calculateUnifiedStateTax(), calculateFicaTax()
   └─ Estimates Traditional withdrawals for SS taxability

6. PROCESS RMDs (if applicable)
   └─ processRMDs() → calculates and executes required distributions

7. TAX OPTIMIZATION PLANNING (if enabled & retired)
   └─ planTaxOptimizedYear() → determines optimal conversion + withdrawal plan

8. EXECUTE ROTH CONVERSIONS (if optimized)
   └─ executeRothConversions() → moves Traditional → Roth

9. CALCULATE LIVING EXPENSES
   └─ Mortgage amortization, loan payments, other expenses

10. ENFORCE SPENDING CAPS / PROSPERITY SPENDING
    └─ enforceSpendingCap(), applyProsperitySpending()

11. EXECUTE WITHDRAWALS
    └─ executeWithdrawals() → covers deficit from accounts

12. UNIFIED TAX CALCULATION (final)
    └─ calculateTotalFederalTax() → SOURCE OF TRUTH for federal tax
    └─ Includes actual LTCG/STCG from withdrawals

13. BINARY SEARCH FOR RESIDUAL DEFICIT
    └─ If unified tax > preliminary, find exact withdrawal needed

14. PROCESS DEFICIT DEBT
    └─ processDeficitDebt() → accumulates unpayable deficit

15. PROCESS INFLOWS
    └─ processInflows() → 401k contributions, employer match, bucket allocations

16. GROW ACCOUNTS
    └─ growAccounts() → applies returns, updates balances

17. RETURN SimulationYear
```

**Key ordering dependencies:**
- RMDs must happen before Roth conversions (RMDs can't be converted)
- Tax optimization planning needs income + RMD amounts
- Final tax calculation needs actual withdrawal amounts (LTCG/STCG)
- Account growth happens last (uses withdrawal-adjusted balances)

---

## 4. Service Boundaries

| Service | Public Functions | Input | Output | Pure? |
|---------|-----------------|-------|--------|-------|
| **WithdrawalService** | `executeWithdrawals`, `processDeficitDebt` | accounts, deficit, taxState, age, withdrawalState | mutates withdrawalState, returns accounts/discretionaryCash | No - Mutates withdrawalState |
| **RMDService** | `processRMDs` | accounts, incomes, assumptions, taxState, withdrawalState | rmdDetails, rmdIncomes; mutates withdrawalState | No - Mutates withdrawalState |
| **RothConversionService** | `executeRothConversions`, `getTraditionalAccountsForConversion`, `getRothAccountsForConversion`, `findOptimalConversionWithSSTorpedo` | accounts, incomes, expenses, taxState, withdrawalState | conversionResult, deposits, tax increases | No - Mutates withdrawalState |
| **TaxOptimizedWithdrawal** | `planTaxOptimizedYear` + 14 helper functions | deficit, accountBalances, age, taxParams, settings | `TaxOptimizedYearPlan` with withdrawals + conversion | Yes - Pure |
| **AccountGrowth** | `processInflows`, `growAccounts` | accounts, incomes, withdrawalState, assumptions | nextAccounts, inflowResult | Yes - Pure (creates new accounts) |
| **SpendingStrategy** | `applyLifestyleCreep`, `calculateStrategyTarget`, `enforceSpendingCap`, `applyProsperitySpending` | expenses, assumptions, previousSimulation | modified expenses, target amounts | Yes - Pure |
| **IncomeProjection** | `projectIncomes` | incomes, accounts, assumptions, logs | nextIncomes, allIncomes | Yes - Pure |
| **MilestoneEvaluator** | `evaluateAllMilestones`, `isActiveByMilestone`, `calculateNetWorth`, etc. | milestones, accounts, expenses, age | activeMilestones, newlyReached | Yes - Pure |

---

## 5. Known Problems / Tech Debt

### TODOs in Codebase
| Location | Issue |
|----------|-------|
| `SimulationEngine.tsx:55` | "TODO: Future SimulationEngine rewrite should consider iteration/convergence" |
| `helpers.ts:224` | "TODO: ARCHITECTURAL ARTIFACT - ELIMINATE IN SIMULATIONENGINE REWRITE" |
| `RMDService.ts:114` | "TODO: Verify all income types are included" |
| `RMDService.ts:118` | "TODO: implement income-based SS exemption phaseout" |
| `RothConversionService.ts:165,403,589` | Same income type verification TODO |
| `RothConversionService.ts:407,593` | Same income-based SS exemption TODO |

### Architectural Issues
1. **WithdrawalState mutation** - Several services mutate a shared `withdrawalState` object rather than returning results
2. **Tax→Withdrawal→Tax circular dependency** - Documented in SimulationEngine, handled with "best effort" approximation
3. **planTaxOptimizedYear has 16 parameters** - Candidate for parameter object refactor
4. **calculateDynamicConversionCeiling has 15 parameters** - Same

---

## 6. Test Coverage

| Service | Test File | Test Count | Coverage Quality |
|---------|-----------|------------|------------------|
| **TaxOptimizedWithdrawal** | 2 files | **259** (222+30+7) | Excellent - comprehensive |
| **helpers** | helpers.test.ts | **111** | Excellent |
| **SpendingStrategy** | SpendingStrategy.test.ts | **66** | Good |
| **RothConversionService** | RothConversionService.test.ts | **52** | Good |
| **WithdrawalService** | WithdrawalService.test.ts | **50** | Good |
| **AccountGrowth** | AccountGrowth.test.ts | **40** | Good |
| **IncomeProjection** | IncomeProjection.test.ts | **28** | Adequate |
| **RMDService** | RMDService.test.ts | **18** | Adequate |
| **estimateFixedIncomeAtRMD** | estimateFixedIncomeAtRMD.test.ts | **16** | Good |
| **MilestoneEvaluator** | MilestoneEvaluator.test.ts | exists | Need to verify count |
| **MilestoneCalculator** | MilestoneCalculator.test.ts | **16** | Adequate |

**Total: 640+ tests for simulation services**

### Test Quality Assessment
Most tests are DIRECT unit tests with specific expected values. The services are well-tested individually.

---

## 7. Summary

### Good News
- Architecture is already modularized into focused services
- Test coverage is strong (640+ tests)
- Features are comprehensive and fully implemented
- SimulationEngine is already a "thin orchestrator"

### Candidates for Refactoring
1. `TaxOptimizedWithdrawal.ts` (1,722 lines) - could split into smaller modules
2. `planTaxOptimizedYear` (16 params) - needs parameter object
3. `calculateDynamicConversionCeiling` (15 params) - needs parameter object
4. `WithdrawalState` mutation pattern - could be made pure

### Not Implemented (Future Features)
- Spousal modeling (joint filing, separate SS records)
- Estate/inheritance planning
- Detailed healthcare cost modeling
