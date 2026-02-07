# Function Inventory for SimulationEngine Rewrite

> **CRITICAL RULE**: Never reimplement logic that already exists. Always import the existing function.

This inventory catalogs all existing functions relevant to the SimulationEngine rewrite. Before implementing any logic, search this document first.

**Total Functions Cataloged: 200+**

---

## Table of Contents
1. [Tax Calculations (47 functions)](#1-tax-calculations)
2. [Withdrawal Functions (24 functions)](#2-withdrawal-functions)
3. [RMD Functions (13 functions)](#3-rmd-functions)
4. [Roth Conversion Functions (32 functions)](#4-roth-conversion-functions)
5. [Spending Strategy & Inflation](#5-spending-strategy--inflation)
6. [Account Operations](#6-account-operations)
7. [Income Projection (SS, Pensions, COLA)](#7-income-projection-ss-pensions-cola)
8. [Property, Debt, ESPP](#8-property-debt-espp)
9. [Milestones](#9-milestones)
10. [Monte Carlo](#10-monte-carlo)

---

## 1. Tax Calculations

**47 functions total** across TaxService.tsx (24), TaxOptimizationService.ts (18), helpers.ts (4), TaxData.tsx (1)

### Core Tax Functions (TaxService.tsx)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| SALT deduction cap | `getSALTCap` | TaxService.tsx:64 | `(year: number, filingStatus: FilingStatus): number` | Yes | TCJA/OBBBA rules |
| Get tax parameters | `getTaxParameters` | TaxService.tsx:93 | `(year: number, filingStatus: FilingStatus, authority: "federal" \| "state", stateResidency?: string, assumptions?: AssumptionsState): TaxParameters \| undefined` | Yes | Brackets, deductions, with inflation |
| Gross income from objects | `getGrossIncome` | TaxService.tsx:144 | `(incomes: AnyIncome[], year: number): number` | Yes | Includes Roth 401k employer match |
| Pre-tax exemptions | `getPreTaxExemptions` | TaxService.tsx:154 | `(incomes: AnyIncome[], year: number, age?: number): number` | Yes | 401k, insurance, HSA |
| Post-tax employer match | `getPostTaxEmployerMatch` | TaxService.tsx:171 | `(incomes: AnyIncome[], year: number): number` | Yes | Roth 401k employer match |
| Post-tax exemptions | `getPostTaxExemptions` | TaxService.tsx:183 | `(incomes: AnyIncome[], year: number, age?: number): number` | Yes | Roth 401k contributions |
| FICA exemptions | `getFicaExemptions` | TaxService.tsx:195 | `(incomes: AnyIncome[], year: number): number` | Yes | Insurance + HSA |
| Earned income | `getEarnedIncome` | TaxService.tsx:207 | `(incomes: AnyIncome[], year: number): number` | Yes | Work-related only |
| SS benefits total | `getSocialSecurityBenefits` | TaxService.tsx:218 | `(incomes: AnyIncome[], year: number): number` | Yes | Extracts from income objects |
| Taxable SS benefits | `getTaxableSocialSecurityBenefits` | TaxService.tsx:264 | `(totalSSBenefits: number, otherIncome: number, taxExemptInterest: number, filingStatus: FilingStatus): number` | Yes | IRS combined income formula |
| Itemized deductions | `getItemizedDeductions` | TaxService.tsx:304 | `(expenses: AnyExpense[], year: number): number` | Yes | Mortgage interest, charity |
| Above-the-line deductions | `getYesDeductions` | TaxService.tsx:327 | `(expenses: AnyExpense[], year: number): number` | Yes | Marked as "Yes" |
| NIIT calculation | `calculateNIIT` | TaxService.tsx:381 | `(magi: number, shortTermCapitalGains: number, longTermCapitalGains: number, filingStatus: FilingStatus): number` | Yes | 3.8% on investment income |
| **Unified federal tax** | `calculateTotalFederalTax` | TaxService.tsx:426 | `(ordinaryIncome: number, socialSecurityBenefits: number, shortTermCapitalGains: number, longTermCapitalGains: number, preTaxDeductions: number, filingStatus: FilingStatus, params: TaxParameters): TotalFederalTaxResult` | **YES** | SS taxability + LTCG stacking + NIIT |
| Legacy tax calc | `calculateTax` | TaxService.tsx:554 | `(grossIncome: number, preTaxDeductions: number, params: TaxParameters): number` | Yes | Ordinary income only |
| Federal tax from objects | `calculateFederalTaxFromIncomes` | TaxService.tsx:588 | `(state: TaxState, incomes: AnyIncome[], expenses: AnyExpense[], additionalOrdinaryIncome?: number, year: number, assumptions?: AssumptionsState, stcg?: number, ltcg?: number): number` | Yes | High-level with SALT cap |
| FICA tax | `calculateFicaTax` | TaxService.tsx:674 | `(state: TaxState, incomes: AnyIncome[], year: number, assumptions?: AssumptionsState): number` | Yes | SS + Medicare |
| State tax | `calculateStateTax` | TaxService.tsx:705 | `(state: TaxState, incomes: AnyIncome[], expenses: AnyExpense[], year: number, assumptions?: AssumptionsState)` | Yes | State-specific SS treatment |
| Unified state tax | `calculateUnifiedStateTax` | TaxService.tsx:816 | `(state: TaxState, incomes: AnyIncome[], expenses: AnyExpense[], additionalOrdinaryIncome: number, year: number, assumptions?: AssumptionsState): number` | Yes | Includes additional income |
| Capital gains tax | `calculateCapitalGainsTax` | TaxService.tsx:929 | `(gains: number, ordinaryTaxableIncome: number, taxState: TaxState, year: number, assumptions?: AssumptionsState): number` | Yes | Bracket stacking |
| **Gross-up solver** | `calculateGrossWithdrawal` | TaxService.tsx:983 | `(netNeeded: number, currentFedIncome: number, currentFedDeduction: number, currentStateIncome: number, currentStateDeduction: number, taxState: TaxState, year: number, assumptions?: AssumptionsState, penaltyRate?: number): { grossWithdrawn: number; totalTax: number; penalty: number }` | **YES** | Binary search for net target |
| Marginal rate info | `getMarginalTaxRate` | TaxService.tsx:1084 | `(taxableIncome: number, params: TaxParameters): MarginalRateResult` | Yes | Bracket boundaries, headroom |
| Combined marginal rate | `getCombinedMarginalRate` | TaxService.tsx:1137 | `(grossIncome: number, preTaxDeductions: number, taxState: TaxState, year: number, assumptions: AssumptionsState, includesFICA?: boolean): { federal: number; state: number; fica: number; combined: number; federalHeadroom: number }` | Yes | Fed + state + FICA |
| ESPP disposition tax | `calculateESPPDispositionTax` | TaxService.tsx:1210 | `(sharesToSell: number, salePrice: number, purchasePrice: number, fmvAtGrant: number, fmvAtPurchase: number, isQualifying: boolean, isLongTermCG: boolean): { ordinaryIncome: number; shortTermCapitalGains: number; longTermCapitalGains: number; totalTaxableGain: number }` | Yes | Qualifying vs disqualifying |

### Tax Optimization Functions (TaxOptimizationService.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Taxable SS helper | `calculateTaxableSS` | TaxOptimizationService.ts:75 | `(ssIncome: number, combinedIncome: number, threshold50: number, threshold85: number): number` | Yes | SS torpedo calculations |
| SS torpedo additional tax | `calculateSSTorpedoAdditionalTax` | TaxOptimizationService.ts:115 | `(ssIncome: number, otherIncome: number, withdrawalAmount: number, marginalRate: number, filingStatus: FilingStatus): number` | Yes | Returns ADDITIONAL tax |
| Analyze tax situation | `analyzeTaxSituation` | TaxOptimizationService.ts:252 | `(simulationYear: SimulationYear, assumptions: AssumptionsState, taxState: TaxState): TaxAnalysis` | Yes | Comprehensive analysis |
| Generate recommendations | `generateRecommendations` | TaxOptimizationService.ts:317 | `(analysis: TaxAnalysis, simulation: SimulationYear[], assumptions: AssumptionsState, hasTraditionalBalance?: boolean): TaxRecommendation[]` | Yes | 401k, HSA, conversions |
| Income threshold for rate | `getIncomeThresholdForRate` | TaxOptimizationService.ts:358 | `(targetRate: number, params: { brackets: Array<{ threshold: number; rate: number }> }): number` | Yes | Max income at bracket |
| Median retirement tax rate | `getMedianRetirementTaxRate` | TaxOptimizationService.ts:378 | `(simulation: SimulationYear[], retirementYear: number): number` | Yes | Excludes conversion taxes |
| Find conversion windows | `findRothConversionWindows` | TaxOptimizationService.ts:404 | `(simulation: SimulationYear[], assumptions: AssumptionsState): RothConversionOpportunity[]` | Yes | Low-rate years |
| Break-even rate | `calculateBreakEvenRate` | TaxOptimizationService.ts:503 | `(currentTaxableIncome: number, amount: number, mode: 'contribution' \| 'conversion', socialSecurityBenefits: number, ltcgIncome: number, taxState: TaxState, year: number, assumptions: AssumptionsState, stateParams: TaxParameters \| null, acaOptions?: ACAOptions): number` | Yes | Roth vs Traditional |
| Find optimal Roth amount | `findOptimalRothAmount` | TaxOptimizationService.ts:568 | `(mode: 'contribution' \| 'conversion', growthYears: number, currentTaxableIncome: number, socialSecurityBenefits: number, ltcgIncome: number, taxState: TaxState, year: number, assumptions: AssumptionsState, simulation: SimulationYear[], maxAmount: number, stateParams: TaxParameters \| null, acaOptions?: ACAOptions): { optimalAmount: number \| null; optimalVerdict: string }` | Yes | Steps through amounts |
| Roth vs pre-tax analysis | `analyzeRothVsPreTax` | TaxOptimizationService.ts:717 | `(amount: number, mode: 'contribution' \| 'conversion', growthYears: number, ...): RothAnalysis` | Yes | Comprehensive comparison |
| Tax projections | `generateTaxProjections` | TaxOptimizationService.ts:913 | `(simulation: SimulationYear[], assumptions: AssumptionsState, taxState: TaxState): TaxProjection[]` | Yes | All years |
| 401k contributions | `get401kContributions` | TaxOptimizationService.ts:961 | `(incomes: AnyIncome[], year: number, age?: number): number` | Yes | Pre-tax + Roth |
| HSA contributions | `getHSAContributions` | TaxOptimizationService.ts:974 | `(incomes: AnyIncome[], year: number): number` | Yes | Extracts from incomes |
| 401k recommendation | `generate401kRecommendation` | TaxOptimizationService.ts:982 | `(analysis: TaxAnalysis): TaxRecommendation \| null` | Yes | If gap exists |
| HSA recommendation | `generateHSARecommendation` | TaxOptimizationService.ts:1018 | `(analysis: TaxAnalysis): TaxRecommendation \| null` | Yes | If gap exists |
| Bracket recommendation | `generateBracketRecommendation` | TaxOptimizationService.ts:1060 | `(analysis: TaxAnalysis): TaxRecommendation \| null` | Yes | Near bracket boundary |
| Conversion recommendation | `generateRothConversionRecommendation` | TaxOptimizationService.ts:1083 | `(windows: RothConversionOpportunity[], retirementTaxRate?: number): TaxRecommendation \| null` | Yes | Low-tax windows |
| Has Traditional balance | `hasTraditionalRetirementBalance` | TaxOptimizationService.ts:1121 | `(simulation: SimulationYear[]): boolean` | Yes | Any pre-tax balance |

### Tax Helpers (helpers.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Classify account tax type | `classifyAccountTaxCategory` | helpers.ts:10 | `(account: AnyAccount): TaxCategory` | Yes | tax-deferred/free/taxable/mixed |
| **Effective conversion tax** | `calculateEffectiveConversionTax` | helpers.ts:74 | `(nonSSIncome: number, totalSSBenefits: number, ltcgIncome: number, conversionAmount: number, filingStatus: FilingStatus, fedParams: TaxParameters, stateParams: TaxParameters \| null, acaOptions?: ACAOptions): EffectiveConversionTaxResult` | **YES** | SS torpedo + LTCG bump + NIIT + state + ACA |
| Estimate Traditional withdrawal | `estimateTraditionalWithdrawalForExpenses` | helpers.ts:258 | `(preliminaryCash: number, accounts: AnyAccount[], withdrawalStrategy: { accountId: string }[], bracketHeadroom?: number): number` | **ELIMINATE** | Circular dependency artifact |
| Fixed income at RMD | `estimateFixedIncomeAtRMD` | helpers.ts:364 | `(currentSSIncome: number, futureSS_PIA: number, currentPensionIncome: number, currentAge: number, rmdStartAge: number, ssClaimingAge?: number, ssCola?: number, pensionCola?: number): FixedIncomeAtRMDResult` | Yes | Projects SS + pension |

### Tax Data (TaxData.tsx)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Closest tax year | `getClosestTaxYear` | TaxData.tsx:864 | `(year: number): number` | Yes | For projections |

---

## 2. Withdrawal Functions

**24 functions total** across WithdrawalService.ts (3), TaxOptimizedWithdrawal.ts (15), WithdrawalTaxEstimation.ts (1), WithdrawalStrategies.ts (4)

### Core Withdrawal Service (WithdrawalService.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Execute withdrawals | `executeWithdrawals` | WithdrawalService.ts:70 | `(discretionaryCash: number, accounts: AnyAccount[], assumptions: AssumptionsState, taxState: TaxState, year: number, currentAge: number, preTaxDeductions: number, withdrawalState: WithdrawalState, rothConversionResult: SimulationYear['rothConversion'] \| undefined, isRetired: boolean, logs: string[], withdrawalPlan?: WithdrawalPlan): { discretionaryCash: number; logs: string[] }` | **Refactor** | MUTATES withdrawalState |
| Process deficit debt | `processDeficitDebt` | WithdrawalService.ts:560 | `(discretionaryCash: number, accounts: AnyAccount[], logs: string[]): DeficitDebtResult` | Yes | Creates DeficitDebtAccount |
| Execute withdrawal plan | `executeWithdrawalPlan` | WithdrawalService.ts:604 | `(discretionaryCash: number, accounts: AnyAccount[], assumptions: AssumptionsState, withdrawalState: WithdrawalState, plan: WithdrawalPlan, logs: string[]): { discretionaryCash: number; logs: string[] }` | Yes | Internal - executes pre-planned allocation |

### Tax-Optimized Withdrawal (TaxOptimizedWithdrawal.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Bracket progression | `getBracketProgression` | TaxOptimizedWithdrawal.ts:216 | `(taxParams: TaxParameters): number[]` | Yes | Capped at 32% |
| RMD divisor | `getRMDDivisor` | TaxOptimizedWithdrawal.ts:260 | `(age: number): number` | Yes | IRS table with extrapolation |
| Damping factor | `getDampingFactor` | TaxOptimizedWithdrawal.ts:288 | `(yearsUntilRMD: number): number` | Yes | 0.15-0.50 based on time |
| ACA cliff threshold | `getAcaCliffThreshold` | TaxOptimizedWithdrawal.ts:305 | `(filingStatus: 'single' \| 'married_filing_jointly', year: number): number` | Yes | 400% FPL |
| Effective conversion rate | `getEffectiveConversionRate` | TaxOptimizedWithdrawal.ts:335 | `(conversionAmount: number, ordinaryIncome: number, ltcgIncome: number, socialSecurity: number, taxParams: TaxParameters, taxState: TaxState, year: number, stateParams: TaxParameters \| null, acaOptions?: ACAOptions): number` | Yes | Marginal rate at amount |
| **Coarse-to-fine search** | `coarseToFineSearch` | TaxOptimizedWithdrawal.ts:400 | `(targetRate: number, traditionalBalance: number, currentAGI: number, socialSecurity: number, ltcgIncome: number, taxParams: TaxParameters, taxState: TaxState, year: number, stateParams: TaxParameters \| null, acaOptions: ACAOptions \| undefined, assumptions?: AssumptionsState): CoarseToFineSearchResult` | **YES** | Handles SS torpedo, LTCG bump, ACA cliff |
| Effective rate conversion limit | `calculateEffectiveRateConversionLimit` | TaxOptimizedWithdrawal.ts:608 | `(currentAGI: number, socialSecurityBenefits: number, ltcgIncome: number, targetEffectiveRate: number, traditionalBalance: number, taxParams: TaxParameters, taxState: TaxState, year: number, stateParams: TaxParameters \| null, acaOptions: ACAOptions \| undefined, assumptions?: AssumptionsState): EffectiveRateLimitResult` | Yes | Max conversion at target rate |
| Ideal target balance | `calculateIdealTargetBalance` | TaxOptimizedWithdrawal.ts:689 | `(pensionIncomeAtRMD: number, ssAtRMD: number, targetBracket: number, rmdStartAge: number, taxParams: TaxParameters, taxState: TaxState, stateParams: TaxParameters \| null, year: number): number` | Yes | Traditional balance for RMD bracket |
| Project balance at RMD | `projectBalanceAtRMD` | TaxOptimizedWithdrawal.ts:738 | `(currentBalance: number, yearsUntilRMD: number, annualConversionAmount: number, growthRate: number): number` | Yes | Iterative projection |
| **Dynamic conversion ceiling** | `calculateDynamicConversionCeiling` | TaxOptimizedWithdrawal.ts:796 | `(currentTraditionalBalance: number, yearsUntilRMD: number, pensionIncomeAtRMD: number, ssAtRMD: number, currentAGI: number, socialSecurityThisYear: number, ltcgIncome: number, growthRate: number, rmdStartAge: number, taxParams: TaxParameters, taxState: TaxState, stateParams?: TaxParameters \| null, acaOptions?: ACAOptions, baselineProjections?: BaselineProjections): ConversionCeilingResult` | **YES** | One bracket increase per iteration, 32% cap |
| Conversion this year | `calculateConversionThisYear` | TaxOptimizedWithdrawal.ts:993 | `(currentBalance: number, effectiveTarget: number, yearsUntilRMD: number, bracketSpaceThisYear: number, growthRate: number): number` | Yes | Three-way minimum |
| Target Traditional balance | `calculateTargetTraditionalBalance` | TaxOptimizedWithdrawal.ts:1053 | `(currentBalance: number, yearsUntilRMD: number, ceilingResult: ConversionCeilingResult, growthRate: number, currentAge?: number): TargetBalanceResult` | Yes | Ideal vs realistic |
| Withholding with penalty | `calculateWithholdingWithPenalty` | TaxOptimizedWithdrawal.ts:1147 | `(conversionAmount: number, totalTax: number, age: number): WithholdingWithPenaltyResult` | Yes | Early withdrawal penalty gross-up |
| Determine phase | `determinePhase` | TaxOptimizedWithdrawal.ts:1199 | `(brokerageBalance: number, rothBalance: number, deficit: number): Phase` | Yes | BROKERAGE_AVAILABLE/TRANSITION/DEPLETED |
| **Plan tax-optimized year** | `planTaxOptimizedYear` | TaxOptimizedWithdrawal.ts:1265 | `(deficit: number, accountBalances: AccountBalances, currentAge: number, rmdStartAge: number, currentAGI: number, socialSecurityThisYear: number, ltcgIncome: number, pensionIncomeAtRMD: number, ssAtRMD: number, growthRate: number, taxParams: TaxParameters, taxState: TaxState, settings: TaxOptimizationSettings, stateParams?: TaxParameters \| null, acaOptions?: ACAOptions, baselineProjections?: BaselineProjections): TaxOptimizedYearPlan` | **Refactor** | Master function - may integrate with new solver |

### Withdrawal Strategies (WithdrawalStrategies.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Fixed Real withdrawal | `calculateFixedRealWithdrawal` | WithdrawalStrategies.ts:62 | `(initialPortfolio: number, withdrawalRate: number, inflationRate: number, yearsInRetirement: number, currentPortfolio?: number): WithdrawalResult` | Yes | Initial × (1 + inflation)^years |
| Percentage withdrawal | `calculatePercentageWithdrawal` | WithdrawalStrategies.ts:104 | `(currentPortfolio: number, withdrawalRate: number): WithdrawalResult` | Yes | Portfolio × rate |
| **Guyton-Klinger withdrawal** | `calculateGuytonKlingerWithdrawal` | WithdrawalStrategies.ts:138 | `(params: GuytonKlingerParams): WithdrawalResult` | Yes | Capital preservation + prosperity rules |
| Strategy router | `calculateStrategyWithdrawal` | WithdrawalStrategies.ts:233 | `(strategyOrParams: string \| WithdrawalParams, withdrawalRate?: number, currentPortfolio?: number, inflationRate?: number, yearsInRetirement?: number, previousWithdrawal?: WithdrawalResult): WithdrawalResult` | Yes | Routes to correct strategy |

### Withdrawal Tax Estimation (WithdrawalTaxEstimation.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Estimate withdrawal tax | `estimateWithdrawalTax` | WithdrawalTaxEstimation.ts:45 | `(deficit: number, accounts: AnyAccount[], withdrawalOrder: WithdrawalBucket[], currentAge: number, filingStatus: FilingStatus, year: number): WithdrawalTaxEstimate` | Maybe | May be replaced by iterative solver |

---

## 3. RMD Functions

**13 functions + 3 interfaces + 3 constants**

### RMD Data (RMDData.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| RMD start age | `getRMDStartAge` | RMDData.ts:73 | `(birthYear: number): number` | Yes | 72/73/75 per SECURE 2.0 |
| Distribution period | `getDistributionPeriod` | RMDData.ts:87 | `(age: number): number` | Yes | IRS Uniform Lifetime Table |
| Calculate RMD | `calculateRMD` | RMDData.ts:108 | `(priorYearEndBalance: number, age: number): number` | Yes | balance / period |
| Account subject to RMD | `isAccountSubjectToRMD` | RMDData.ts:121 | `(taxType: string): boolean` | Yes | Traditional 401k/IRA only |
| RMD penalty | `calculateRMDPenalty` | RMDData.ts:130 | `(shortfall: number, correctedTimely?: boolean): number` | Yes | 25% or 10% if corrected |
| RMD required check | `isRMDRequired` | RMDData.ts:140 | `(currentAge: number, birthYear: number): boolean` | Yes | age >= start age |

### RMD Service (RMDService.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| **Process RMDs** | `processRMDs` | RMDService.ts:22 | `(year: number, accounts: AnyAccount[], allIncomes: AnyIncome[], assumptions: AssumptionsState, taxState: TaxState, previousSimulation: SimulationYear[], currentAge: number, totalGrossIncome: number, preTaxDeductions: number, withdrawalState: WithdrawalState, logs: string[]): RMDResult` | **Refactor** | MUTATES withdrawalState, creates PassiveIncome |

### RMD-Related in TaxOptimizedWithdrawal.ts

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| RMD divisors constant | `RMD_DIVISORS` | TaxOptimizedWithdrawal.ts:226 | `Record<number, number>` | Yes | Ages 72-95 |
| Get RMD divisor | `getRMDDivisor` | TaxOptimizedWithdrawal.ts:260 | `(age: number): number` | Yes | With extrapolation |
| Damping factor | `getDampingFactor` | TaxOptimizedWithdrawal.ts:288 | `(yearsUntilRMD: number): number` | Yes | Conversion aggressiveness |
| Effective rate limit | `calculateEffectiveRateConversionLimit` | TaxOptimizedWithdrawal.ts:608 | See Withdrawal section | Yes | For RMD bracket planning |
| Ideal target balance | `calculateIdealTargetBalance` | TaxOptimizedWithdrawal.ts:689 | See Withdrawal section | Yes | RMD in target bracket |
| Project balance at RMD | `projectBalanceAtRMD` | TaxOptimizedWithdrawal.ts:738 | See Withdrawal section | Yes | Balance projection |

---

## 4. Roth Conversion Functions

**32 functions total** across RothConversionService.ts (6), TaxOptimizedWithdrawal.ts (15), helpers.ts (3), TaxOptimizationService.ts (8)

### Roth Conversion Service (RothConversionService.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Get Traditional accounts | `getTraditionalAccountsForConversion` | RothConversionService.ts:20 | `(accounts: AnyAccount[], withdrawalOrder: WithdrawalBucket[]): InvestedAccount[]` | Yes | Ordered by strategy |
| Get Roth accounts | `getRothAccountsForConversion` | RothConversionService.ts:51 | `(accounts: AnyAccount[], withdrawalOrder: WithdrawalBucket[]): InvestedAccount[]` | Yes | Reverse order (last withdraw = first deposit) |
| **Find optimal with SS torpedo** | `findOptimalConversionWithSSTorpedo` | RothConversionService.ts:92 | `(agiExcludingSS: number, totalSSBenefits: number, maxBracketAmount: number, targetRate: number, filingStatus: FilingStatus, fedParams: TaxParameters, tolerance?: number): number` | **YES** | Binary search for torpedo effect |
| Perform auto conversion | `performAutoRothConversion` | RothConversionService.ts:135 | `(accounts: AnyAccount[], incomes: AnyIncome[], expenses: AnyExpense[], year: number, assumptions: AssumptionsState, taxState: TaxState, previousSimulation: SimulationYear[], logs: string[], estimatedTraditionalWithdrawal?: number, priorInflows?: Record<string, number>): SimulationYear['rothConversion'] \| undefined` | **Refactor** | Internal - may need Phase 2R integration |
| Execute pre-calculated | `executePreCalculatedConversion` | RothConversionService.ts:301 | `(conversionAmount: number, accounts: AnyAccount[], allIncomes: AnyIncome[], year: number, assumptions: AssumptionsState, taxState: TaxState, totalGrossIncome: number, preTaxDeductions: number, withdrawalState: WithdrawalState, logs: string[]): RothConversionResult` | Yes | MUTATES withdrawalState |
| **Execute Roth conversions** | `executeRothConversions` | RothConversionService.ts:481 | `(input: RothConversionInput, logs: string[], preCalculatedAmount?: number): RothConversionResult` | **Refactor** | Master function |

### Conversion Tax Helpers (helpers.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| **Effective conversion tax** | `calculateEffectiveConversionTax` | helpers.ts:74 | See Tax section | **YES** | SS torpedo + LTCG bump + NIIT + state + ACA |
| Estimate Traditional withdrawal | `estimateTraditionalWithdrawalForExpenses` | helpers.ts:258 | See Tax section | **ELIMINATE** | Circular dependency |
| Fixed income at RMD | `estimateFixedIncomeAtRMD` | helpers.ts:364 | See Tax section | Yes | For conversion ceiling |

### Tax Optimization Conversion Functions (TaxOptimizationService.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Income threshold for rate | `getIncomeThresholdForRate` | TaxOptimizationService.ts:358 | See Tax section | Yes | Bracket threshold |
| Median retirement tax rate | `getMedianRetirementTaxRate` | TaxOptimizationService.ts:378 | See Tax section | Yes | Target for conversions |
| Find conversion windows | `findRothConversionWindows` | TaxOptimizationService.ts:404 | See Tax section | Yes | Low-rate years |
| Break-even rate | `calculateBreakEvenRate` | TaxOptimizationService.ts:503 | See Tax section | Yes | Roth vs Traditional |
| Find optimal Roth amount | `findOptimalRothAmount` | TaxOptimizationService.ts:568 | See Tax section | Yes | Peak benefit |
| Roth vs pre-tax analysis | `analyzeRothVsPreTax` | TaxOptimizationService.ts:717 | See Tax section | Yes | Comprehensive |
| Conversion recommendation | `generateRothConversionRecommendation` | TaxOptimizationService.ts:1083 | See Tax section | Yes | Low-tax windows |
| Has Traditional balance | `hasTraditionalRetirementBalance` | TaxOptimizationService.ts:1121 | See Tax section | Yes | Check for conversions |

### Tax-Optimized Conversion Functions (TaxOptimizedWithdrawal.ts)

See Withdrawal section - these are shared between withdrawal and conversion planning.

---

## 5. Spending Strategy & Inflation

### Spending Strategy (SpendingStrategy.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Total living expenses | `calculateTotalLivingExpenses` | SpendingStrategy.ts:20 | `(expenses: AnyExpense[], year: number): number` | Yes | Sums all expenses |
| Total discretionary | `calculateTotalDiscretionary` | SpendingStrategy.ts:35 | `(expenses: AnyExpense[], year: number): number` | Yes | Only discretionary |
| Apply lifestyle creep | `applyLifestyleCreep` | SpendingStrategy.ts:51 | `(expenses: AnyExpense[], incomes: AnyIncome[], assumptions: AssumptionsState, year: number, isRetired: boolean, logs: string[]): AnyExpense[]` | Yes | % of raise → discretionary |
| Calculate strategy target | `calculateStrategyTarget` | SpendingStrategy.ts:101 | `(accounts: AnyAccount[], assumptions: AssumptionsState, previousSimulation: SimulationYear[], year: number, currentAge: number, logs: string[]): WithdrawalResult \| undefined` | Yes | Routes to strategy |
| Enforce spending cap | `enforceSpendingCap` | SpendingStrategy.ts:174 | `(expenses: AnyExpense[], strategyWithdrawalResult: WithdrawalResult, discretionaryCash: number, totalGrossIncome: number, preTaxDeductions: number, postTaxDeductions: number, totalTax: number, reinvestedIncome: number, year: number, assumptions: AssumptionsState, logs: string[]): { nextExpenses: AnyExpense[]; totalLivingExpenses: number; discretionaryCash: number; strategyAdjustmentResult: SimulationYear['strategyAdjustment'] }` | Yes | Trims discretionary |
| Apply prosperity spending | `applyProsperitySpending` | SpendingStrategy.ts:261 | `(expenses: AnyExpense[], currentTotalExpenses: number, budgetTarget: number, year: number, logs: string[]): { adjustedExpenses: AnyExpense[]; surplusToInvest: number; prosperityApplied: boolean }` | Yes | Increases discretionary |

### Expense Inflation (Expense/models.tsx)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| General expense | `SimpleExpense.increment` | models.tsx:109 | `(assumptions: AssumptionsState): AnyExpense` | Yes | × (1 + inflation) |
| Rent expense | `RentExpense.increment` | models.tsx:158 | `(assumptions: AssumptionsState): RentExpense` | Yes | rent + general inflation |
| Mortgage expense | `MortgageExpense.increment` | models.tsx:230 | `(assumptions: AssumptionsState): MortgageExpense` | Yes | 12-month simulation |
| Loan expense | `LoanExpense.increment` | models.tsx:477 | `(assumptions: AssumptionsState): LoanExpense` | Yes | 12-month simulation |
| Dependent expense | `DependentExpense.increment` | models.tsx:640 | `(assumptions: AssumptionsState): DependentExpense` | Yes | × (1 + inflation) |
| Healthcare expense | `HealthcareExpense.increment` | models.tsx:678 | `(assumptions: AssumptionsState): HealthcareExpense` | Yes | healthcareInflation |
| Charity expense | `CharityExpense.increment` | models.tsx:771 | `(assumptions: AssumptionsState): CharityExpense` | Yes | × (1 + inflation) |
| Adjust expense amount | `*.adjustAmount` | various | `(ratio: number): AnyExpense` | Yes | Mortgages/loans return unchanged |

---

## 6. Account Operations

### Account Growth (AccountGrowth.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Process all inflows | `processInflows` | AccountGrowth.ts:23 | `(incomesWithEarningsTest: AnyIncome[], accounts: AnyAccount[], assumptions: AssumptionsState, year: number, withdrawalState: WithdrawalState, discretionaryCash: number, existingDeficitDebt: DeficitDebtAccount \| undefined, totalLivingExpenses: number, currentAge: number, logs: string[]): InflowResult` | Yes | Payroll, match, ESPP, buckets |
| Grow all accounts | `growAccounts` | AccountGrowth.ts:305 | `(accounts: AnyAccount[], expenses: AnyExpense[], withdrawalState: WithdrawalState, conversionDeposits: Record<string, number>, esppLots: Record<string, ESPPLot[]>, deficitDebtPayment: number, existingDeficitDebt: DeficitDebtAccount \| undefined, assumptions: AssumptionsState, year: number, returnOverride: number \| undefined, logs: string[]): AnyAccount[]` | Yes | Calls each increment() |

### Account Models (Accounts/models.tsx)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Savings growth | `SavedAccount.increment` | models.tsx:56 | `(assumptions: AssumptionsState, annualContribution?: number): SavedAccount` | Yes | APR, BOY timing |
| Investment growth | `InvestedAccount.increment` | models.tsx:181 | `(assumptions: AssumptionsState, userContribution?: number, employerContribution?: number, overrideReturnRate?: number, conversionAmount?: number, currentYear?: number): InvestedAccount` | Yes | Vesting, lots, conversions |
| Proportional withdrawal | `InvestedAccount.calculateWithdrawalAllocation` | models.tsx:105 | `(withdrawAmount: number): { basis: number; gains: number }` | Yes | Fallback when no lots |
| **Lot-aware withdrawal** | `InvestedAccount.calculateLotAwareWithdrawal` | models.tsx:120 | `(withdrawAmount: number, currentYear: number): { shortTermGains: number; longTermGains: number; basisReturn: number }` | **YES** | FIFO lot selection |
| Non-vested amount | `InvestedAccount.nonVestedAmount` (getter) | models.tsx:171 | `get nonVestedAmount(): number` | Yes | Unvested employer |
| Vested amount | `InvestedAccount.vestedAmount` (getter) | models.tsx:177 | `get vestedAmount(): number` | Yes | Available for withdrawal |
| Property growth | `PropertyAccount.increment` | models.tsx:768 | `(assumptions: AssumptionsState, overrides?: { newLoanBalance?: number; newValue?: number }): PropertyAccount` | Yes | Appreciation |
| Debt growth | `DebtAccount.increment` | models.tsx:807 | `(assumptions: AssumptionsState, overrideBalance?: number): DebtAccount` | Yes | APR compounding |
| Deficit debt | `DeficitDebtAccount.increment` | models.tsx:834 | `(assumptions: AssumptionsState, overrideBalance?: number): DeficitDebtAccount` | Yes | 0% APR |

---

## 7. Income Projection (SS, Pensions, COLA)

### Social Security Calculator (SocialSecurityCalculator.tsx)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Extract earnings | `extractEarningsFromSimulation` | SocialSecurityCalculator.tsx:91 | `(simulation: SimulationYear[], importedSSAEarnings?: EarningsRecord[], inflationAdjusted?: boolean, currentIncomes?: AnyIncome[]): EarningsRecord[]` | Yes | Three-tier priority |
| Wage indexing | `applyWageIndexing` | SocialSecurityCalculator.tsx:188 | `(earnings: EarningsRecord, indexYear: number, wageGrowthRate?: number, inflationAdjusted?: boolean): number` | Yes | Index to age 60 |
| Calculate PIA | `calculatePIA` | SocialSecurityCalculator.tsx:224 | `(aime: number, year: number, wageGrowthRate?: number, inflationAdjusted?: boolean): number` | Yes | Bend points formula |
| Claiming adjustment | `applyClaimingAdjustment` | SocialSecurityCalculator.tsx:262 | `(pia: number, claimingAge: number, birthYear?: number): number` | Yes | Early/delayed factors |
| **Calculate AIME** | `calculateAIME` | SocialSecurityCalculator.tsx:291 | `(earningsHistory: EarningsRecord[], calculationYear: number, claimingAge: number, birthYear?: number, wageGrowthRate?: number, inflationAdjusted?: boolean): AIMECalculation` | Yes | Full AIME → PIA |
| Estimate from income | `estimateBenefitFromCurrentIncome` | SocialSecurityCalculator.tsx:369 | `(currentAge: number, retirementAge: number, annualIncome: number, birthYear: number, inflationAdjusted?: boolean): number` | Yes | Quick estimate |
| Validate earnings | `validateEarningsRecord` | SocialSecurityCalculator.tsx:415 | `(record: EarningsRecord, inflationAdjusted?: boolean): boolean` | Yes | vs wage base |
| **Earnings test reduction** | `calculateEarningsTestReduction` | SocialSecurityCalculator.tsx:443 | `(ssBenefit: number, earnedIncome: number, currentAge: number, fra: number, year: number, wageGrowthRate?: number, inflationAdjusted?: boolean): EarningsTestResult` | **YES** | $1/$2 or $1/$3 |

### Social Security Data (SocialSecurityData.tsx)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Claiming adjustment | `getClaimingAdjustment` | SocialSecurityData.tsx:319 | `(claimingAge: number, fra?: number): number` | Yes | Factor |
| Get FRA | `getFRA` | SocialSecurityData.tsx:344 | `(birthYear: number): number` | Yes | 65-67 |
| Yearly data lookup | `lookupYearlyData` | SocialSecurityData.tsx:354 | `<T>(data: Record<number, T>, year: number, projectFuture: (baseValue: T, growthMultiplier: number) => T, wageGrowthRate: number, inflationAdjusted: boolean): T` | Yes | Generic helper |
| Wage index factor | `getWageIndexFactor` | SocialSecurityData.tsx:386 | `(year: number, wageGrowthRate?: number, inflationAdjusted?: boolean): number` | Yes | With projection |
| Bend points | `getBendPoints` | SocialSecurityData.tsx:404 | `(year: number, wageGrowthRate?: number, inflationAdjusted?: boolean): { first: number; second: number }` | Yes | With projection |
| Wage base | `getWageBase` | SocialSecurityData.tsx:425 | `(year: number, wageGrowthRate?: number, inflationAdjusted?: boolean): number` | Yes | Max taxable |
| Earnings test limit | `getEarningsTestLimit` | SocialSecurityData.tsx:469 | `(year: number, wageGrowthRate?: number, inflationAdjusted?: boolean): { beforeFRA: number; yearOfFRA: number }` | Yes | With projection |

### Pension Data (PensionData.tsx)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| FERS MRA | `getFERSMRA` | PensionData.tsx:54 | `(birthYear: number): number` | Yes | 55-57 |
| FERS eligibility | `checkFERSEligibility` | PensionData.tsx:83 | `(age: number, yearsOfService: number, birthYear: number): FERSEligibilityResult` | Yes | Reduction % |
| FERS basic benefit | `calculateFERSBasicBenefit` | PensionData.tsx:133 | `(yearsOfService: number, high3: number, retirementAge: number): number` | Yes | 1.0% or 1.1% |
| FERS supplement | `calculateFERSSupplement` | PensionData.tsx:161 | `(yearsOfService: number, estimatedSSAt62: number): number` | Yes | Bridge to 62 |
| FERS COLA | `getFERSCOLA` | PensionData.tsx:183 | `(inflation: number, age: number): number` | Yes | Reduced rules |
| CSRS basic benefit | `calculateCSRSBasicBenefit` | PensionData.tsx:211 | `(yearsOfService: number, high3: number): number` | Yes | Graduated, 80% cap |
| CSRS eligibility | `checkCSRSEligibility` | PensionData.tsx:255 | `(age: number, yearsOfService: number): CSRSEligibilityResult` | Yes | Reduction % |
| CSRS COLA | `getCSRSCOLA` | PensionData.tsx:297 | `(inflation: number): number` | Yes | Full CPI |
| Calculate High-3 | `calculateHigh3` | PensionData.tsx:310 | `(salaryHistory: number[]): number` | Yes | Top 3 consecutive |
| Estimate High-3 | `estimateHigh3` | PensionData.tsx:338 | `(currentSalary: number, yearsUntilRetirement: number, salaryGrowthRate?: number): number` | Yes | Projects future |
| FERS early reduction | `getFERSEarlyReduction` | PensionData.tsx:363 | `(retirementAge: number): number` | Yes | 5% per year under 62 |

### Income Models (Income/models.tsx)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Work income growth | `WorkIncome.increment` | models.tsx:115 | `(assumptions: AssumptionsState, year?: number, age?: number): WorkIncome` | Yes | Salary, 401k, HSA, ESPP |
| SS increment | `FutureSocialSecurityIncome.increment` | models.tsx:517 | `(assumptions: AssumptionsState): FutureSocialSecurityIncome` | Yes | COLA |
| FERS benefit | `FERSPensionIncome.calculateBenefit` | models.tsx:574 | `(): number` | Yes | Instance method |
| FERS supplement | `FERSPensionIncome.calculateSupplement` | models.tsx:596 | `(): number` | Yes | Instance method |
| FERS increment | `FERSPensionIncome.increment` | models.tsx:613 | `(assumptions: AssumptionsState, year?: number, age?: number): FERSPensionIncome` | Yes | COLA |
| CSRS benefit | `CSRSPensionIncome.calculateBenefit` | models.tsx:687 | `(): number` | Yes | Instance method |
| CSRS increment | `CSRSPensionIncome.increment` | models.tsx:703 | `(assumptions: AssumptionsState): CSRSPensionIncome` | Yes | Full COLA |

---

## 8. Property, Debt, ESPP

### Mortgage/Loan (Expense/models.tsx)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Mortgage amortization | `MortgageExpense.calculateAnnualAmortization` | models.tsx:298 | `(year: number): { totalInterest: number, totalPrincipal: number, totalPayment: number }` | Yes | With escrow |
| Mortgage payment | `MortgageExpense.calculatePayment` | models.tsx:361 | `(): number` | Yes | P&I + escrow |
| Mortgage deductible | `MortgageExpense.calculateDeductible` | models.tsx:382 | `(): number` | Yes | Interest portion |
| Principal payment | `MortgageExpense.getPrincipalPayment` | models.tsx:397 | `(): number` | Yes | P&I - interest |
| Balance at date | `MortgageExpense.getBalanceAtDate` | models.tsx:411 | `(dateStr: string): number` | Yes | Iterates months |
| Loan amortization | `LoanExpense.calculateAnnualAmortization` | models.tsx:520 | `(year: number): { totalInterest: number, totalPrincipal: number, totalPayment: number }` | Yes | With compounding |
| Payment from end date | `LoanExpense.calculatePaymentFromEndDate` | models.tsx:568 | `(): number` | Yes | Standard formula |
| End date from payment | `LoanExpense.calculateEndDateFromPayment` | models.tsx:580 | `(payment: number): Date` | Yes | Inverse calc |
| Months from payment | `LoanExpense.calculateMonthsFromPayment` | models.tsx:587 | `(payment: number): number` | Yes | Infinity if too low |
| Months until paid | `LoanExpense.getMonthsUntilPaidOff` | models.tsx:599 | `(): number` | Yes | Date difference |

### ESPP (Accounts/models.tsx)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Disposition type | `ESPPAccount.calculateDispositionType` | models.tsx:431 | `(lot: ESPPLot, saleDate: Date): 'qualifying' \| 'disqualifying'` | Yes | 2yr + 1yr rules |
| **ESPP sale tax** | `ESPPAccount.calculateSaleTax` | models.tsx:466 | `(sharesToSell: number, salePrice: number, saleDate: Date, lotOrder?: 'fifo' \| 'disqualifying_first' \| 'qualifying_first', eligibleLots?: ESPPLot[]): { ordinaryIncome: number; shortTermGains: number; longTermGains: number; lotsUsed: ESPPLot[] }` | **YES** | Full tax breakdown |
| Lot counts | `ESPPAccount.getLotCounts` | models.tsx:552 | `(asOfDate?: Date): { qualifying: number; disqualifying: number }` | Yes | Count by type |
| Eligible lots | `ESPPAccount.getEligibleLots` | models.tsx:570 | `(asOfDate?: Date): ESPPLot[]` | Yes | Meets min holding |
| Eligible shares | `ESPPAccount.getEligibleShares` | models.tsx:585 | `(asOfDate?: Date): number` | Yes | Sum of eligible |
| Has qualifying | `ESPPAccount.hasQualifyingLots` | models.tsx:592 | `(asOfDate?: Date): boolean` | Yes | Any qualifying |
| Add lot | `ESPPAccount.addLot` | models.tsx:600 | `(lot: ESPPLot): ESPPAccount` | Yes | Immutable |
| Remove shares | `ESPPAccount.removeSoldShares` | models.tsx:622 | `(sharesToRemove: number, salePrice: number, saleDate?: Date, lotOrder?: string): ESPPAccount` | Yes | FIFO/qualifying/disqualifying first |
| Update lot | `ESPPAccount.updateLot` | models.tsx:672 | `(lotId: string, updates: Partial<ESPPLot>): ESPPAccount` | Yes | Partial updates |
| Delete lot | `ESPPAccount.deleteLot` | models.tsx:697 | `(lotId: string): ESPPAccount` | Yes | Removes and adjusts |
| ESPP increment | `ESPPAccount.increment` | models.tsx:722 | `(assumptions: AssumptionsState, overrideReturnRate?: number): ESPPAccount` | Yes | Stock growth |
| Total shares | `ESPPAccount.totalShares` (getter) | models.tsx:531 | `get totalShares(): number` | Yes | Sum of lots |
| Total cost basis | `ESPPAccount.totalCostBasis` (getter) | models.tsx:538 | `get totalCostBasis(): number` | Yes | Sum of lots |
| Unrealized gains | `ESPPAccount.unrealizedGains` (getter) | models.tsx:545 | `get unrealizedGains(): number` | Yes | amount - basis |

---

## 9. Milestones

### Milestone Evaluator (MilestoneEvaluator.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Calculate net worth | `calculateNetWorth` | MilestoneEvaluator.ts:19 | `(accounts: AnyAccount[], expenses: AnyExpense[]): number` | Yes | Assets - liabilities |
| Liquid net worth | `calculateLiquidNetWorth` | MilestoneEvaluator.ts:53 | `(accounts: AnyAccount[]): number` | Yes | Brokerage + Savings |
| Total debt | `calculateTotalDebt` | MilestoneEvaluator.ts:73 | `(accounts: AnyAccount[], expenses: AnyExpense[]): number` | Yes | All sources |
| Annual expenses | `calculateAnnualExpenses` | MilestoneEvaluator.ts:102 | `(expenses: AnyExpense[], year: number): number` | Yes | For conditions |
| Calculate target value | `calculateTargetValue` | MilestoneEvaluator.ts:127 | `(condition: MilestoneCondition, context: MilestoneContext): number \| null` | Yes | Internal |
| Evaluate condition | `evaluateCondition` | MilestoneEvaluator.ts:183 | `(condition: MilestoneCondition, context: MilestoneContext): boolean` | Yes | Internal |
| Evaluate milestone | `evaluateMilestone` | MilestoneEvaluator.ts:232 | `(milestone: CustomMilestone, context: MilestoneContext): boolean` | Yes | All conditions (AND) |
| **Evaluate all milestones** | `evaluateAllMilestones` | MilestoneEvaluator.ts:244 | `(milestones: CustomMilestone[], previouslyReached: Set<string>, context: MilestoneContext): { newlyReached: MilestoneReachEvent[]; activeMilestones: string[] }` | **YES** | Returns newly reached |
| **Is active by milestone** | `isActiveByMilestone` | MilestoneEvaluator.ts:286 | `(startMilestoneId: string \| undefined, endMilestoneId: string \| undefined, currentMilestones: Set<string>, previousMilestones?: Set<string>): boolean` | **YES** | Income/expense filtering |

### Milestone Calculator (MilestoneCalculator.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Find FI year | `findFinancialIndependenceYear` | MilestoneCalculator.ts:35 | `(simulation: SimulationYear[], assumptions: AssumptionsState): FIResult \| null` | Yes | Portfolio × rate ≥ expenses |
| Find milestone year | `findMilestoneReachYear` | MilestoneCalculator.ts:75 | `(simulation: SimulationYear[], milestoneId: string): { year: number; age: number } \| null` | Yes | Internal |
| Calculate milestones | `calculateMilestones` | MilestoneCalculator.ts:91 | `(assumptions: AssumptionsState, simulation: SimulationYear[]): MilestonesSummary` | Yes | For tracker UI |
| Years until | `yearsUntil` | MilestoneCalculator.ts:143 | `(currentAge: number, targetAge: number): number` | Yes | Simple calc |
| Format age | `formatAge` | MilestoneCalculator.ts:150 | `(age: number): string` | Yes | 59.5 → "59½" |

---

## 10. Monte Carlo

### Monte Carlo Engine (MonteCarloEngine.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Run single scenario | `runSingleScenario` | MonteCarloEngine.ts:24 | `(scenarioId: number, rng: SeededRandom, yearsToRun: number, config: MonteCarloConfig, accounts: AnyAccount[], incomes: AnyIncome[], expenses: AnyExpense[], assumptions: AssumptionsState, taxState: TaxState): ScenarioResult` | Yes | Single MC run |
| Run MC async | `runMonteCarloSimulation` | MonteCarloEngine.ts:76 | `async (config: MonteCarloConfig, accounts: AnyAccount[], incomes: AnyIncome[], expenses: AnyExpense[], assumptions: AssumptionsState, taxState: TaxState, onProgress?: ProgressCallback): Promise<MonteCarloSummary>` | Yes | Chunked for UI |
| Run MC sync | `runMonteCarloSimulationSync` | MonteCarloEngine.ts:130 | `(config: MonteCarloConfig, accounts: AnyAccount[], incomes: AnyIncome[], expenses: AnyExpense[], assumptions: AssumptionsState, taxState: TaxState): MonteCarloSummary` | Yes | For tests |
| Validate config | `validateConfig` | MonteCarloEngine.ts:168 | `(config: MonteCarloConfig): string \| null` | Yes | Error or null |
| Estimate run time | `estimateRunTime` | MonteCarloEngine.ts:190 | `(numScenarios: number, yearsToRun: number): number` | Yes | ~5ms per scenario-year |

### Monte Carlo Aggregator (MonteCarloAggregator.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Success rate | `calculateSuccessRate` | MonteCarloAggregator.ts:16 | `(scenarios: ScenarioResult[]): number` | Yes | % successful |
| Percentile value | `getPercentileValue` | MonteCarloAggregator.ts:28 | `(sortedValues: number[], percentile: number): number` | Yes | Linear interpolation |
| Calculate percentiles | `calculatePercentiles` | MonteCarloAggregator.ts:50 | `(scenarios: ScenarioResult[]): PercentileData` | Yes | p10/25/50/75/90 |
| Scenario at percentile | `findScenarioAtPercentile` | MonteCarloAggregator.ts:101 | `(scenarios: ScenarioResult[], percentile: number): ScenarioResult` | Yes | By final NW |
| Analyze scenario | `analyzeScenario` | MonteCarloAggregator.ts:124 | `(scenarioId: number, timeline: SimulationYear[], yearlyReturns: number[]): ScenarioResult` | Yes | Success, NW, depletion |
| Summarize scenarios | `summarizeScenarios` | MonteCarloAggregator.ts:163 | `(scenarios: ScenarioResult[], seed: number): MonteCarloSummary` | Yes | Full summary |
| Extract NW timeline | `extractNetWorthTimeline` | MonteCarloAggregator.ts:215 | `(scenario: ScenarioResult): YearlyPercentile[]` | Yes | For charts |
| Final NW stats | `calculateFinalNetWorthStats` | MonteCarloAggregator.ts:229 | `(scenarios: ScenarioResult[]): { min: number; max: number; mean: number; median: number; stdDev: number }` | Yes | Statistical summary |

### Random Generator (RandomGenerator.ts)

| Needed Logic | Existing Function | File:Line | Signature | Reuse? | Notes |
|--------------|-------------------|-----------|-----------|--------|-------|
| Seeded RNG class | `SeededRandom` | RandomGenerator.ts:5 | `class SeededRandom` | Yes | Mulberry32 |
| Next random | `SeededRandom.next` | RandomGenerator.ts:17 | `(): number` | Yes | [0, 1) |
| Normal distribution | `SeededRandom.normal` | RandomGenerator.ts:30 | `(mean: number, stdDev: number): number` | Yes | Box-Muller |
| Lognormal distribution | `SeededRandom.lognormal` | RandomGenerator.ts:47 | `(mean: number, stdDev: number): number` | Yes | Prevents < -100% |
| Generate returns | `SeededRandom.generateReturns` | RandomGenerator.ts:68 | `(years: number, meanReturn: number, stdDev: number): number[]` | Yes | Normal |
| Generate lognormal returns | `SeededRandom.generateLognormalReturns` | RandomGenerator.ts:90 | `(years: number, meanReturn: number, stdDev: number): number[]` | Yes | Realistic |
| Reset RNG | `SeededRandom.reset` | RandomGenerator.ts:113 | `(seed?: number): void` | Yes | To original seed |
| Get state | `SeededRandom.getState` | RandomGenerator.ts:120 | `(): number` | Yes | For save/restore |
| Create random seed | `createRandomSeed` | RandomGenerator.ts:129 | `(): number` | Yes | Math.random based |
| Calculate mean | `calculateMean` | RandomGenerator.ts:136 | `(values: number[]): number` | Yes | For validation |
| Calculate std dev | `calculateStdDev` | RandomGenerator.ts:140 | `(values: number[]): number` | Yes | For validation |

---

## Summary: Key Functions for New Solver

### Must Use (Critical)
| Function | Purpose |
|----------|---------|
| `calculateTotalFederalTax` | Unified tax calc with SS taxability + LTCG stacking + NIIT |
| `calculateEffectiveConversionTax` | Full conversion tax including torpedo/bump/ACA |
| `calculateGrossWithdrawal` | Binary search gross-up solver |
| `coarseToFineSearch` | Handles SS torpedo, LTCG bump, ACA cliff discontinuities |
| `calculateDynamicConversionCeiling` | One bracket per iteration, 32% cap |
| `InvestedAccount.calculateLotAwareWithdrawal` | FIFO lot selection for CG classification |
| `evaluateAllMilestones` | Determines retirement status |
| `isActiveByMilestone` | Filters active incomes/expenses |
| `calculateEarningsTestReduction` | SS benefit reduction while working |
| `findOptimalConversionWithSSTorpedo` | Binary search for SS torpedo |
| `ESPPAccount.calculateSaleTax` | Full ESPP disposition tax |

### May Need Refactoring
| Function | Reason |
|----------|--------|
| `executeWithdrawals` | Complex, MUTATES withdrawalState |
| `processRMDs` | Creates synthetic income, MUTATES withdrawalState |
| `executeRothConversions` | Master function, may need Phase 2R integration |
| `planTaxOptimizedYear` | Master function, may integrate with new solver |

### Functions to Eliminate
| Function | Reason |
|----------|--------|
| `estimateTraditionalWithdrawalForExpenses` | Circular dependency artifact |

---

## State Mutation Summary

| Category | Pattern |
|----------|---------|
| Account/Income/Expense models | **Immutable** - return new instances |
| WithdrawalState | **MUTATES** - passed through simulation |
| React Context reducers | **Immutable** - return new state |

**Stateful functions (3 total):**
- `executeWithdrawals` - modifies withdrawalState
- `processRMDs` - modifies withdrawalState
- `executePreCalculatedConversion` - modifies withdrawalState

All other functions are **pure** (no side effects).
