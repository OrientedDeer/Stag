// src/components/Simulation/SimulationEngine.ts
import { AnyAccount, DebtAccount, DeficitDebtAccount, InvestedAccount, ESPPAccount, ESPPLot, PropertyAccount, SavedAccount, getESPPLotOrder } from "../../Objects/Accounts/models";
import { getESPPLimit } from "../../../data/ContributionLimits";
import { AnyExpense, LoanExpense, MortgageExpense } from "../Expense/models";
import { AnyIncome, WorkIncome, FutureSocialSecurityIncome, FERSPensionIncome, CSRSPensionIncome, PassiveIncome, getIncomeActiveMultiplier } from "../../Objects/Income/models";
import { calculateHigh3, checkFERSEligibility, checkCSRSEligibility } from "../../../data/PensionData";
import { calculateRMD, isAccountSubjectToRMD, isRMDRequired, RMDCalculation } from "../../../data/RMDData";
import { AssumptionsState } from "./AssumptionsContext";
import { TaxState } from "../../Objects/Taxes/TaxContext";
import * as TaxService from "../../Objects/Taxes/TaxService";
import { FilingStatus, TaxParameters } from "../../../data/TaxData";
import { calculateAIME, extractEarningsFromSimulation, calculateEarningsTestReduction } from "../../../services/SocialSecurityCalculator";
import { getFRA } from "../../../data/SocialSecurityData";
import { calculateStrategyWithdrawal, WithdrawalResult, GuardrailTrigger } from "../../../services/WithdrawalStrategies";
import { getIncomeThresholdForRate } from "../../../services/TaxOptimizationService";

// Define the shape of a single year's result
export interface SimulationYear {
    year: number;
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    accounts: AnyAccount[];
    cashflow: {
        totalIncome: number;
        totalExpense: number; // Taxes + Living Expenses + Payroll Deductions
        discretionary: number; // Unspent cash
        investedUser: number;  // User contributions + Saved Cash
        investedMatch: number; // Employer Match
        totalInvested: number; // Sum
        bucketAllocations: number; // Priority Bucket contributions
        bucketDetail: Record<string, number>; // Breakdown
        withdrawals: number; // Total withdrawn from accounts
        withdrawalDetail: Record<string, number>; // Per-account breakdown
    };
    taxDetails: {
        fed: number;
        state: number;
        fica: number;
        preTax: number;
        insurance: number;
        postTax: number;
        capitalGains: number; // Capital gains tax on brokerage withdrawals
    };
    logs: string[];
    // Withdrawal strategy tracking (for multi-year calculations)
    strategyWithdrawal?: WithdrawalResult;
    // Guyton-Klinger strategy adjustment tracking
    strategyAdjustment?: {
        guardrailTriggered: GuardrailTrigger;
        requiredAdjustment: number;      // $ amount GK wants to cut/add
        actualAdjustment: number;        // $ amount actually cut/added
        discretionaryAvailable: number;  // $ of discretionary expenses available
        warning?: string;                // Warning if cut couldn't be fully applied
    };
    // Auto Roth conversion tracking
    rothConversion?: {
        amount: number;                  // Total amount converted
        taxCost: number;                 // Tax paid on conversion
        taxAfter: number;               // Total federal tax after conversion
        fromAccounts: Record<string, number>;  // Amount from each Traditional account (by name)
        toAccounts: Record<string, number>;    // Amount to each Roth account (by name)
        fromAccountIds: Record<string, number>;  // Amount from each Traditional account (by id)
        toAccountIds: Record<string, number>;    // Amount to each Roth account (by id)
    };
    // Required Minimum Distribution tracking
    rmdDetails?: {
        totalRMD: number;                         // Total RMD required this year
        totalWithdrawn: number;                   // Actual amount withdrawn for RMD
        accountBreakdown: RMDCalculation[];       // Per-account RMD details
        shortfall: number;                        // Amount not withdrawn (if any)
        penalty: number;                          // 25% penalty on shortfall
    };
}

/**
 * Calculate the effective tax cost of a Roth conversion, including the SS "tax torpedo" effect.
 *
 * When you do a Roth conversion, you not only pay tax on the conversion itself,
 * but the additional income can push more of your Social Security benefits into
 * taxable territory. This creates an effective marginal rate higher than the
 * stated bracket rate.
 *
 * @param nonSSIncome - Income excluding Social Security
 * @param totalSSBenefits - Total Social Security benefits received
 * @param conversionAmount - Amount being converted from Traditional to Roth
 * @param filingStatus - Tax filing status
 * @param fedParams - Federal tax parameters
 * @returns Object with tax details including effective rate
 */
export function calculateEffectiveConversionTax(
    nonSSIncome: number,
    totalSSBenefits: number,
    conversionAmount: number,
    filingStatus: FilingStatus,
    fedParams: TaxParameters
): { taxBefore: number; taxAfter: number; taxIncrease: number; effectiveRate: number } {
    // Calculate tax WITHOUT conversion
    // TaxService.calculateTax expects gross income and will apply standard deduction internally
    const taxableSSBefore = TaxService.getTaxableSocialSecurityBenefits(
        totalSSBenefits,
        nonSSIncome,
        filingStatus
    );
    const grossIncomeBefore = nonSSIncome + taxableSSBefore;
    const taxBefore = TaxService.calculateTax(grossIncomeBefore, 0, fedParams);

    // Calculate tax WITH conversion
    // The conversion adds to AGI, which can increase taxable SS
    const newNonSSIncome = nonSSIncome + conversionAmount;
    const taxableSSAfter = TaxService.getTaxableSocialSecurityBenefits(
        totalSSBenefits,
        newNonSSIncome,
        filingStatus
    );
    const grossIncomeAfter = newNonSSIncome + taxableSSAfter;
    const taxAfter = TaxService.calculateTax(grossIncomeAfter, 0, fedParams);

    const taxIncrease = taxAfter - taxBefore;
    const effectiveRate = conversionAmount > 0 ? taxIncrease / conversionAmount : 0;

    return {
        taxBefore,
        taxAfter,
        taxIncrease,
        effectiveRate
    };
}

/**
 * Estimate the gross Traditional withdrawal needed to cover an expense deficit.
 * Used to reduce Roth conversion bracket headroom to avoid over-conversion.
 *
 * @param preliminaryCash - Cash available before Roth conversion (negative = deficit)
 * @param accounts - All accounts
 * @param withdrawalStrategy - Ordered list of accounts to withdraw from
 * @returns Estimated gross Traditional withdrawal amount
 */
function estimateTraditionalWithdrawalForExpenses(
    preliminaryCash: number,
    accounts: AnyAccount[],
    withdrawalStrategy: { accountId: string }[]
): number {
    // No deficit means no Traditional withdrawal needed
    if (preliminaryCash >= 0) return 0;

    const deficit = Math.abs(preliminaryCash);
    let estimatedTraditionalWithdrawal = 0;
    let remainingDeficit = deficit;

    // Walk through withdrawal strategy order
    for (const bucket of withdrawalStrategy) {
        if (remainingDeficit <= 0) break;

        const account = accounts.find(acc => acc.id === bucket.accountId);
        if (!account) continue;

        // Only estimate for Traditional accounts
        const isTraditional = account instanceof InvestedAccount &&
            (account.taxType === 'Traditional 401k' || account.taxType === 'Traditional IRA');

        if (isTraditional) {
            const availableBalance = (account as InvestedAccount).vestedAmount;
            if (availableBalance <= 0) continue;

            // Use conservative 25% effective tax rate for estimation
            // This means for every $1 net needed, we withdraw ~$1.33 gross
            const ESTIMATED_TAX_RATE = 0.25;
            const grossNeeded = remainingDeficit / (1 - ESTIMATED_TAX_RATE);

            // Cap at available balance
            const grossWithdrawal = Math.min(grossNeeded, availableBalance);
            estimatedTraditionalWithdrawal += grossWithdrawal;

            // Estimate net received from this withdrawal
            const netReceived = grossWithdrawal * (1 - ESTIMATED_TAX_RATE);
            remainingDeficit -= netReceived;
        } else {
            // Non-Traditional accounts (Roth, Saved, Brokerage) - estimate net received
            // For simplicity, assume these cover deficit 1:1 (Roth/Saved are tax-free)
            // Brokerage has cap gains but for estimation purposes, this is close enough
            let availableBalance = account.amount;
            if (account instanceof InvestedAccount) {
                availableBalance = account.vestedAmount;
            }
            const withdrawal = Math.min(remainingDeficit, availableBalance);
            remainingDeficit -= withdrawal;
        }
    }

    return estimatedTraditionalWithdrawal;
}

type TaxCategory = 'tax-deferred' | 'tax-free' | 'taxable' | 'mixed';

/**
 * Classify an account by its tax treatment for withdrawal ordering.
 */
function classifyAccountTaxCategory(account: AnyAccount): TaxCategory {
    if (account instanceof SavedAccount) return 'tax-free';
    if (account instanceof InvestedAccount) {
        switch (account.taxType) {
            case 'Traditional 401k':
            case 'Traditional IRA':
                return 'tax-deferred';
            case 'Roth 401k':
            case 'Roth IRA':
            case 'HSA':
                return 'tax-free';
            case 'Brokerage':
            default:
                return 'taxable';
        }
    }
    if (account instanceof ESPPAccount) return 'mixed';
    return 'taxable';
}

/**
 * Calculate how much Traditional (tax-deferred) withdrawal fits within
 * the user's target bracket ceiling without pushing into a higher bracket.
 */
function calculateTraditionalWithdrawalCap(
    totalGrossIncome: number,
    preTaxDeductions: number,
    rothConversionAmount: number,
    year: number,
    taxState: TaxState,
    assumptions: AssumptionsState
): number {
    const targetRate = assumptions.investments.taxOptimizedTargetBracket;
    const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
    if (!fedParams) return Infinity;

    const standardDeduction = fedParams.standardDeduction || 0;
    const baseTaxableIncome = (totalGrossIncome - preTaxDeductions) + rothConversionAmount;
    const bracketThreshold = getIncomeThresholdForRate(targetRate, fedParams);
    const maxGross = bracketThreshold + standardDeduction;

    return Math.max(0, maxGross - baseTaxableIncome);
}

/**
 * Perform automatic Roth conversions during retirement.
 * Converts from Traditional accounts (in withdrawal order) to Roth accounts (reverse order).
 */
function performAutoRothConversion(
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    _expenses: AnyExpense[],
    year: number,
    assumptions: AssumptionsState,
    taxState: TaxState,
    _previousSimulation: SimulationYear[],
    logs: string[],
    estimatedTraditionalWithdrawal: number = 0,
    priorInflows: Record<string, number> = {}
): SimulationYear['rothConversion'] | undefined {
    // Get federal tax parameters
    const fedParams = TaxService.getTaxParameters(
        year,
        taxState.filingStatus,
        'federal',
        undefined,
        assumptions
    );

    if (!fedParams) return undefined;

    // Calculate current taxable income with proper SS handling
    const grossIncome = TaxService.getGrossIncome(incomes, year);
    const preTaxDeductions = TaxService.getPreTaxExemptions(incomes, year);
    const standardDeduction = fedParams.standardDeduction || 0;

    // Handle Social Security taxation properly
    // SS is taxed at 0%, 50%, or 85% depending on "combined income"
    const totalSSBenefits = TaxService.getSocialSecurityBenefits(incomes, year);
    const nonSSGross = grossIncome - totalSSBenefits;
    const agiExcludingSS = nonSSGross - preTaxDeductions;
    const taxableSSBenefits = TaxService.getTaxableSocialSecurityBenefits(
        totalSSBenefits,
        agiExcludingSS,
        taxState.filingStatus
    );

    // AGI with only taxable portion of SS included
    const adjustedGross = nonSSGross + taxableSSBenefits;
    const taxableIncome = Math.max(0, adjustedGross - preTaxDeductions);

    // Use user-configured target bracket for conversions
    const retirementTaxRate = assumptions.investments.rothConversionTargetBracket;

    // Check effective rate on a test conversion to see if we should convert at all
    // The effective rate includes the SS "tax torpedo" effect
    // Include estimated Traditional withdrawal in the AGI for accurate effective rate check
    const testAgi = agiExcludingSS + estimatedTraditionalWithdrawal;
    const testConversionAmount = 1000; // Small amount to test effective rate
    const testEffectiveResult = calculateEffectiveConversionTax(
        testAgi,
        totalSSBenefits,
        testConversionAmount,
        taxState.filingStatus,
        fedParams
    );

    // Only convert if effective rate is below target rate
    // This accounts for both the marginal bracket rate AND the SS torpedo effect
    if (testEffectiveResult.effectiveRate >= retirementTaxRate) {
        return undefined;
    }

    // Calculate optimal conversion amount accounting for SS torpedo
    // Use binary search to find the amount where effective rate approaches target
    const targetIncomeThreshold = getIncomeThresholdForRate(retirementTaxRate, fedParams);

    // Reduce bracket headroom by estimated Traditional withdrawal for expenses
    // This prevents over-conversion when we know Traditional withdrawals will happen later
    const adjustedTaxableIncome = taxableIncome + estimatedTraditionalWithdrawal;
    let maxBracketAmount = Math.max(0, targetIncomeThreshold + standardDeduction - adjustedTaxableIncome);

    if (estimatedTraditionalWithdrawal > 0) {
        logs.push(`  Bracket headroom reduced by estimated expense withdrawal: $${estimatedTraditionalWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    }

    // If there's SS income, we need to find the point where effective rate hits target
    // This may be less than the bracket-filling amount due to SS torpedo
    let optimalAmount = maxBracketAmount;

    if (totalSSBenefits > 0 && maxBracketAmount > 0) {
        // Binary search for optimal amount where effective rate equals target
        // Include estimated Traditional withdrawal in the AGI for accurate SS torpedo calculation
        const adjustedAgiExcludingSS = agiExcludingSS + estimatedTraditionalWithdrawal;
        let low = 0;
        let high = maxBracketAmount;
        const tolerance = 100; // $100 precision is good enough

        while (high - low > tolerance) {
            const mid = (low + high) / 2;
            const midResult = calculateEffectiveConversionTax(
                adjustedAgiExcludingSS,
                totalSSBenefits,
                mid,
                taxState.filingStatus,
                fedParams
            );

            if (midResult.effectiveRate < retirementTaxRate) {
                low = mid;
            } else {
                high = mid;
            }
        }

        optimalAmount = Math.floor(low);
    }

    if (optimalAmount <= 0) return undefined;

    // Find Traditional accounts to convert FROM (in withdrawal order)
    const withdrawalOrder = assumptions.withdrawalStrategy || [];
    const traditionalAccounts: InvestedAccount[] = [];

    for (const bucket of withdrawalOrder) {
        const account = accounts.find(acc => acc.id === bucket.accountId);
        if (account instanceof InvestedAccount &&
            (account.taxType === 'Traditional 401k' || account.taxType === 'Traditional IRA')) {
            traditionalAccounts.push(account);
        }
    }

    // Also add any Traditional accounts not in withdrawal order
    for (const acc of accounts) {
        if (acc instanceof InvestedAccount &&
            (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA') &&
            !traditionalAccounts.includes(acc)) {
            traditionalAccounts.push(acc);
        }
    }

    // Find Roth accounts to convert TO (reverse order)
    const rothAccounts: InvestedAccount[] = [];

    // First add Roth accounts in reverse withdrawal order
    for (let i = withdrawalOrder.length - 1; i >= 0; i--) {
        const bucket = withdrawalOrder[i];
        const account = accounts.find(acc => acc.id === bucket.accountId);
        if (account instanceof InvestedAccount &&
            (account.taxType === 'Roth 401k' || account.taxType === 'Roth IRA')) {
            rothAccounts.push(account);
        }
    }

    // Also add any Roth accounts not in withdrawal order
    for (const acc of accounts) {
        if (acc instanceof InvestedAccount &&
            (acc.taxType === 'Roth 401k' || acc.taxType === 'Roth IRA') &&
            !rothAccounts.includes(acc)) {
            rothAccounts.push(acc);
        }
    }

    if (traditionalAccounts.length === 0 || rothAccounts.length === 0) {
        return undefined;
    }

    // Perform the conversion (calculate amounts but DON'T mutate accounts)
    let remainingToConvert = optimalAmount;
    const fromAccounts: Record<string, number> = {};
    const toAccounts: Record<string, number> = {};
    // Track by account ID for applying via userInflows
    const fromAccountIds: Record<string, number> = {};
    const toAccountIds: Record<string, number> = {};

    // Convert from Traditional accounts
    for (const tradAccount of traditionalAccounts) {
        if (remainingToConvert <= 0) break;

        // Account for any prior outflows (e.g., RMD withdrawals) already recorded
        const priorOutflow = priorInflows[tradAccount.id] || 0;
        const availableBalance = tradAccount.amount + Math.min(0, priorOutflow);
        if (availableBalance <= 0) continue;

        const convertAmount = Math.min(remainingToConvert, availableBalance);

        // Track withdrawal amount (don't mutate account directly!)
        fromAccounts[tradAccount.name] = (fromAccounts[tradAccount.name] || 0) + convertAmount;
        fromAccountIds[tradAccount.id] = (fromAccountIds[tradAccount.id] || 0) + convertAmount;
        remainingToConvert -= convertAmount;
    }

    const totalConverted = optimalAmount - remainingToConvert;

    if (totalConverted <= 0) return undefined;

    // Deposit to Roth accounts (fill first Roth in reverse order)
    let remainingToDeposit = totalConverted;
    for (const rothAccount of rothAccounts) {
        if (remainingToDeposit <= 0) break;

        // Track deposit amount (don't mutate account directly!)
        toAccounts[rothAccount.name] = (toAccounts[rothAccount.name] || 0) + remainingToDeposit;
        toAccountIds[rothAccount.id] = (toAccountIds[rothAccount.id] || 0) + remainingToDeposit;
        remainingToDeposit = 0;
    }

    // Calculate tax cost on the conversion (including SS torpedo effect)
    // Must include estimatedTraditionalWithdrawal in base income since those
    // withdrawals also add to taxable income in the same year
    const conversionTaxResult = calculateEffectiveConversionTax(
        agiExcludingSS + estimatedTraditionalWithdrawal,
        totalSSBenefits,
        totalConverted,
        taxState.filingStatus,
        fedParams
    );
    const taxCost = conversionTaxResult.taxIncrease;
    const taxAfter = conversionTaxResult.taxAfter;

    logs.push(`  From: ${Object.entries(fromAccounts).map(([name, amt]) => `${name}: $${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(', ')}`);
    logs.push(`  To: ${Object.entries(toAccounts).map(([name, amt]) => `${name}: $${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(', ')}`);

    return {
        amount: totalConverted,
        taxCost,
        taxAfter,
        fromAccounts,
        toAccounts,
        fromAccountIds,
        toAccountIds
    };
}

/**
 * Runs the simulation for a single timestep (1 year).
 * Takes "Year N" data and returns "Year N+1" data.
 */
export function simulateOneYear(
    year: number,
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    accounts: AnyAccount[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    previousSimulation: SimulationYear[] = [],
    returnOverride?: number
): SimulationYear {
    const logs: string[] = [];

    // Calculate current age for retirement checks
    const currentAge = year - assumptions.demographics.birthYear;
    const isRetired = currentAge >= assumptions.demographics.retirementAge;

    // 1. GROW (The Physics of Money)
    // Special handling for:
    // - FutureSocialSecurityIncome: Calculate PIA when reaching claiming age
    // - WorkIncome: End at retirement if no explicit end date set

    // Filter out previous year's interest and RMD income - they're regenerated fresh each year
    // Interest is based on current account balances, RMD is based on prior year balance and current age
    const regularIncomes = incomes.filter(inc => {
        if (inc instanceof PassiveIncome && (inc.sourceType === 'Interest' || inc.sourceType === 'RMD')) {
            return false;
        }
        return true;
    });

    const nextIncomes = regularIncomes.map(inc => {
        // End work income at retirement if no end date is set
        if (inc instanceof WorkIncome && isRetired && !inc.end_date) {
            // Return null to filter out, or set end date to retirement year
            // We'll set end date to the year before retirement so it stops
            const retirementYear = assumptions.demographics.birthYear + assumptions.demographics.retirementAge;

            // Create a new WorkIncome with end date set to end of pre-retirement year
            // IMPORTANT: Also zero out 401k contributions and employer match
            return new WorkIncome(
                inc.id,
                inc.name,
                0, // Zero out the income
                inc.frequency,
                inc.earned_income, // Keep earned_income flag
                0, // Zero out preTax401k
                0, // Zero out insurance
                0, // Zero out roth401k
                0, // Zero out employerMatch
                inc.matchAccountId,
                inc.taxType,
                inc.contributionGrowthStrategy,
                inc.startDate,
                new Date(Date.UTC(retirementYear - 1, 11, 31)) // End at Dec 31 of year before retirement
            );
        }

        // Handle FERS Pension - calculate High-3 and benefit at retirement age
        if (inc instanceof FERSPensionIncome) {
            // If pension has auto-calculate High-3 enabled, track salary history
            if (inc.autoCalculateHigh3 && inc.linkedIncomeId) {
                // Find the linked work income to get current salary
                const linkedIncome = incomes.find(i => i.id === inc.linkedIncomeId);
                if (linkedIncome instanceof WorkIncome) {
                    const currentSalary = linkedIncome.getAnnualAmount(year);
                    // Build salary history from previous simulation
                    const salaryHistory: number[] = previousSimulation
                        .map(simYear => {
                            const prevLinked = simYear.incomes.find(i => i.id === inc.linkedIncomeId);
                            if (prevLinked instanceof WorkIncome) {
                                return prevLinked.getAnnualAmount(simYear.year);
                            }
                            return 0;
                        })
                        .filter(s => s > 0);
                    salaryHistory.push(currentSalary);

                    // When reaching retirement age, calculate High-3 and benefit
                    if (currentAge === inc.retirementAge && inc.calculatedBenefit === 0) {
                        const high3 = calculateHigh3(salaryHistory);

                        // Calculate base benefit with actual High-3
                        const baseBenefit = (inc.retirementAge >= 62 && inc.yearsOfService >= 20 ? 0.011 : 0.01)
                            * inc.yearsOfService * high3;

                        // Check for early retirement reductions
                        const eligibility = checkFERSEligibility(inc.retirementAge, inc.yearsOfService, inc.birthYear);
                        const reductionFactor = 1 - (eligibility.reductionPercent / 100);
                        const actualBenefit = baseBenefit * reductionFactor;

                        logs.push(`[PENSION] FERS Pension started: High-3 calculated as $${high3.toLocaleString()}/yr from ${salaryHistory.length} years of salary history`);
                        if (eligibility.reductionPercent > 0) {
                            logs.push(`   Base benefit: $${baseBenefit.toLocaleString()}/yr, reduced by ${eligibility.reductionPercent}% (${eligibility.message})`);
                        }
                        logs.push(`   Annual benefit: $${actualBenefit.toLocaleString()}/yr`);

                        return new FERSPensionIncome(
                            inc.id, inc.name, inc.yearsOfService, high3,
                            inc.retirementAge, inc.birthYear, actualBenefit,
                            inc.fersSupplement, inc.estimatedSSAt62,
                            inc.startDate, inc.end_date,
                            inc.autoCalculateHigh3, inc.linkedIncomeId
                        );
                    }
                }
            }
            return inc.increment(assumptions, year, currentAge);
        }

        // Handle CSRS Pension - calculate High-3 and benefit at retirement age
        if (inc instanceof CSRSPensionIncome) {
            // If pension has auto-calculate High-3 enabled, track salary history
            if (inc.autoCalculateHigh3 && inc.linkedIncomeId) {
                // Find the linked work income to get current salary
                const linkedIncome = incomes.find(i => i.id === inc.linkedIncomeId);
                if (linkedIncome instanceof WorkIncome) {
                    const currentSalary = linkedIncome.getAnnualAmount(year);
                    // Build salary history from previous simulation
                    const salaryHistory: number[] = previousSimulation
                        .map(simYear => {
                            const prevLinked = simYear.incomes.find(i => i.id === inc.linkedIncomeId);
                            if (prevLinked instanceof WorkIncome) {
                                return prevLinked.getAnnualAmount(simYear.year);
                            }
                            return 0;
                        })
                        .filter(s => s > 0);
                    salaryHistory.push(currentSalary);

                    // When reaching retirement age, calculate High-3 and benefit
                    if (currentAge === inc.retirementAge && inc.calculatedBenefit === 0) {
                        const high3 = calculateHigh3(salaryHistory);

                        // Calculate CSRS base benefit with actual High-3
                        let baseBenefit = 0;
                        const first5 = Math.min(inc.yearsOfService, 5);
                        baseBenefit += first5 * high3 * 0.015;
                        if (inc.yearsOfService > 5) {
                            const next5 = Math.min(inc.yearsOfService - 5, 5);
                            baseBenefit += next5 * high3 * 0.0175;
                        }
                        if (inc.yearsOfService > 10) {
                            const remaining = inc.yearsOfService - 10;
                            baseBenefit += remaining * high3 * 0.02;
                        }
                        baseBenefit = Math.min(baseBenefit, high3 * 0.80); // Cap at 80%

                        // Check for early retirement reductions
                        const eligibility = checkCSRSEligibility(inc.retirementAge, inc.yearsOfService);
                        const reductionFactor = 1 - (eligibility.reductionPercent / 100);
                        const actualBenefit = baseBenefit * reductionFactor;

                        logs.push(`[PENSION] CSRS Pension started: High-3 calculated as $${high3.toLocaleString()}/yr from ${salaryHistory.length} years of salary history`);
                        if (eligibility.reductionPercent > 0) {
                            logs.push(`   Base benefit: $${baseBenefit.toLocaleString()}/yr, reduced by ${eligibility.reductionPercent}% (${eligibility.message})`);
                        }
                        logs.push(`   Annual benefit: $${actualBenefit.toLocaleString()}/yr`);

                        return new CSRSPensionIncome(
                            inc.id, inc.name, inc.yearsOfService, high3,
                            inc.retirementAge, actualBenefit,
                            inc.startDate, inc.end_date,
                            inc.autoCalculateHigh3, inc.linkedIncomeId
                        );
                    }
                }
            }
            return inc.increment(assumptions);
        }

        if (inc instanceof FutureSocialSecurityIncome) {
            // If user has reached claiming age and PIA hasn't been calculated yet
            if (currentAge === inc.claimingAge && inc.calculatedPIA === 0) {
                try {
                    // Extract earnings from simulation years + any imported SSA earnings history
                    // Also auto-generates prior earnings from job start dates (using current salary, flat)
                    // Priority: auto-generated < simulation < imported SSA (source of truth)
                    const inflationAdjusted = assumptions.macro.inflationAdjusted;
                    const earningsHistory = extractEarningsFromSimulation(
                        previousSimulation,
                        assumptions.demographics.priorEarnings,
                        inflationAdjusted,
                        incomes  // Pass current incomes to auto-generate prior earnings from job start dates
                    );

                    // Calculate AIME/PIA based on top 35 years
                    // Use inflation rate as wage growth rate (wages typically track inflation)
                    const birthYear = assumptions.demographics.birthYear;
                    const wageGrowthRate = assumptions.macro.inflationRate / 100;
                    const aimeCalc = calculateAIME(earningsHistory, year, inc.claimingAge, birthYear, wageGrowthRate, inflationAdjusted);

                    // Set end date to end of life expectancy year (assume death at end of year)
                    const endDate = new Date(Date.UTC(
                        birthYear + assumptions.demographics.lifeExpectancy,
                        11, 31  // December 31st
                    ));

                    // Apply SS funding percentage (allows users to model reduced benefits)
                    const fundingPercent = (assumptions.income?.socialSecurityFundingPercent ?? 100) / 100;
                    const adjustedMonthlyBenefit = aimeCalc.adjustedBenefit * fundingPercent;

                    logs.push(`Social Security benefits calculated: $${adjustedMonthlyBenefit.toFixed(2)}/month at age ${inc.claimingAge}`);
                    logs.push(`  AIME: $${aimeCalc.aime.toFixed(2)}, PIA: $${aimeCalc.pia.toFixed(2)}${fundingPercent < 1 ? `, Funding: ${fundingPercent * 100}%` : ''}`);

                    // Create new income with calculated PIA
                    return new FutureSocialSecurityIncome(
                        inc.id,
                        inc.name,
                        inc.claimingAge,
                        adjustedMonthlyBenefit,
                        year,
                        new Date(Date.UTC(year, 0, 1)),
                        endDate
                    );
                } catch (error) {
                    console.error('Error calculating Social Security benefits:', error);
                    logs.push(`[WARN] Error calculating Social Security benefits: ${error}`);
                    // Return original income unchanged if calculation fails
                    return inc.increment(assumptions);
                }
            }
        }

        // Pass year and age for WorkIncome to support TRACK_ANNUAL_MAX strategy
        if (inc instanceof WorkIncome) {
            return inc.increment(assumptions, year, currentAge);
        }

        return inc.increment(assumptions);
    });

    // Apply earnings test to FutureSocialSecurityIncome if claiming before FRA
    const incomesWithEarningsTest = nextIncomes.map(inc => {
        if (inc instanceof FutureSocialSecurityIncome && inc.calculatedPIA > 0) {
            const birthYear = assumptions.demographics.birthYear;
            const fra = getFRA(birthYear);

            // Only apply test if before FRA
            if (currentAge < fra) {
                const earnedIncome = TaxService.getEarnedIncome(nextIncomes, year);
                const annualSSBenefit = inc.getProratedAnnual(inc.amount, year);
                const wageGrowthRate = assumptions.macro.inflationRate / 100;
                const inflationAdjusted = assumptions.macro.inflationAdjusted;

                const earningsTest = calculateEarningsTestReduction(
                    annualSSBenefit,
                    earnedIncome,
                    currentAge,
                    fra,
                    year,
                    wageGrowthRate,
                    inflationAdjusted
                );

                if (earningsTest.appliesTest && earningsTest.amountWithheld > 0) {
                    // Calculate monthly reduced benefit
                    const monthlyReduced = earningsTest.reducedBenefit / 12;

                    logs.push(`[WARN] Earnings test applied: SS benefit reduced from $${(annualSSBenefit/12).toFixed(2)}/month to $${monthlyReduced.toFixed(2)}/month`);
                    logs.push(`  ${earningsTest.reason}`);
                    logs.push(`  Amount withheld: $${earningsTest.amountWithheld.toLocaleString()}/year`);
                    logs.push(`  Note: Withheld benefits would be recalculated at FRA (not yet implemented)`);

                    // Create new income with reduced amount (keep income object, just reduce amount)
                    return new FutureSocialSecurityIncome(
                        inc.id,
                        inc.name,
                        inc.claimingAge,
                        monthlyReduced,  // Reduced monthly benefit
                        inc.calculationYear,
                        inc.startDate,
                        inc.end_date
                    );
                }
            }
        }
        return inc;
    });

    let nextExpenses = expenses.map(exp => exp.increment(assumptions));

    // ------------------------------------------------------------------
    // LIFESTYLE CREEP (Apply during working years when salary increases)
    // ------------------------------------------------------------------
    if (!isRetired && assumptions.expenses.lifestyleCreep > 0) {
        // Calculate total REAL raise from WorkIncome (excluding inflation)
        // Lifestyle creep should only apply to real income growth, not inflation adjustments
        const salaryGrowthRate = assumptions.income.salaryGrowth / 100;
        let totalRaise = 0;
        for (const prevInc of incomes) {
            if (prevInc instanceof WorkIncome) {
                // Calculate real raise (just salary growth, not inflation)
                const realRaise = prevInc.amount * salaryGrowthRate;
                if (realRaise > 0) {
                    totalRaise += realRaise;
                }
            }
        }

        if (totalRaise > 0) {
            // Calculate lifestyle creep amount (annual)
            const lifestyleCreepAmount = totalRaise * (assumptions.expenses.lifestyleCreep / 100);

            // Calculate total discretionary expenses
            const discretionaryExpenses = nextExpenses.filter(exp => exp.isDiscretionary);
            const totalDiscretionary = discretionaryExpenses.reduce((sum, exp) => {
                return sum + exp.getAnnualAmount(year);
            }, 0);

            if (totalDiscretionary > 0 && lifestyleCreepAmount > 0) {
                // Apply proportional increase to discretionary expenses
                const increaseRatio = 1 + (lifestyleCreepAmount / totalDiscretionary);
                nextExpenses = nextExpenses.map(exp => {
                    if (exp.isDiscretionary) {
                        return exp.adjustAmount(increaseRatio);
                    }
                    return exp;
                });
                logs.push(`[FLOW] Lifestyle creep: Salary raise of $${totalRaise.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr → Discretionary expenses increased by $${lifestyleCreepAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr (${assumptions.expenses.lifestyleCreep}%)`);
            }
        }
    }

    // ------------------------------------------------------------------
    // GUYTON-KLINGER TARGET CALCULATION
    // Computes GK withdrawal target. Spending cap enforced after expenses are summed.
    // ------------------------------------------------------------------
    let strategyWithdrawalResult: WithdrawalResult | undefined;
    let strategyAdjustmentResult: SimulationYear['strategyAdjustment'] | undefined;

    if (isRetired && assumptions.investments.withdrawalStrategy === 'Guyton Klinger') {
        // Calculate total invested assets (for withdrawal calculations)
        const totalInvestedAssets = accounts.reduce((sum, acc) => {
            if (acc instanceof InvestedAccount || acc instanceof SavedAccount || acc instanceof ESPPAccount) {
                return sum + acc.amount;
            }
            return sum;
        }, 0);

        // Get previous year's withdrawal result for tracking
        const previousStrategyResult = previousSimulation.length > 0
            ? previousSimulation[previousSimulation.length - 1].strategyWithdrawal
            : undefined;

        // Calculate years in retirement (0 = first year)
        const retirementStartYear = assumptions.demographics.birthYear + assumptions.demographics.retirementAge;
        const yearsInRetirement = year - retirementStartYear;

        // Calculate years remaining for 15-year rule
        const yearsRemaining = assumptions.demographics.lifeExpectancy - currentAge;

        // Calculate strategy-based withdrawal with GK parameters
        strategyWithdrawalResult = calculateStrategyWithdrawal({
            strategy: 'Guyton Klinger',
            withdrawalRate: assumptions.investments.withdrawalRate,
            currentPortfolio: totalInvestedAssets,
            inflationRate: assumptions.macro.inflationRate,
            yearsInRetirement,
            previousWithdrawal: previousStrategyResult,
            gkUpperGuardrail: assumptions.investments.gkUpperGuardrail,
            gkLowerGuardrail: assumptions.investments.gkLowerGuardrail,
            gkAdjustmentPercent: assumptions.investments.gkAdjustmentPercent,
            yearsRemaining,
        });

        logs.push(`[INFO] Retirement withdrawal strategy: Guyton Klinger`);
        logs.push(`  Target withdrawal: $${strategyWithdrawalResult.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        logs.push(`  Portfolio value: $${totalInvestedAssets.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        logs.push(`  Effective rate: ${((strategyWithdrawalResult.amount / totalInvestedAssets) * 100).toFixed(2)}%`);

        // Log guardrail triggers (actual spending cap is enforced after expenses are summed)
        if (strategyWithdrawalResult.guardrailTriggered !== 'none') {
            if (strategyWithdrawalResult.guardrailTriggered === 'capital-preservation') {
                logs.push(`[CUT] GK Capital Preservation triggered: withdrawal target reduced by ${assumptions.investments.gkAdjustmentPercent}%`);
            } else if (strategyWithdrawalResult.guardrailTriggered === 'prosperity') {
                logs.push(`[FLOW] GK Prosperity triggered: withdrawal target increased by ${assumptions.investments.gkAdjustmentPercent}%`);
            }
        }
    }

    // Calculate interest income from savings accounts (before they grow)
    // Interest is based on beginning-of-year balance
    const interestIncomes: PassiveIncome[] = [];
    for (const acc of accounts) {
        if (acc instanceof SavedAccount && acc.apr > 0 && acc.amount > 0) {
            const interestEarned = acc.amount * (acc.apr / 100);
            if (interestEarned > 0.01) { // Skip tiny amounts
                interestIncomes.push(new PassiveIncome(
                    `interest-${acc.id}-${year}`,
                    `${acc.name} Interest`,
                    interestEarned,
                    'Annually',
                    'No',  // Not earned income (no FICA)
                    'Interest',
                    new Date(`${year}-01-01`),
                    new Date(`${year}-12-31`),
                    true  // isReinvested: interest stays in the account, not available as spendable cash
                ));
            }
        }
    }

    // Combine regular incomes with interest income for tax calculations
    const allIncomes = [...incomesWithEarningsTest, ...interestIncomes];

    // 2. TAXES & DEDUCTIONS (The Government)
    let totalGrossIncome = TaxService.getGrossIncome(allIncomes, year);
    const preTaxDeductions = TaxService.getPreTaxExemptions(incomesWithEarningsTest, year);
    const postTaxDeductions = TaxService.getPostTaxExemptions(incomesWithEarningsTest, year);

    // Calculate Insurance
    const totalInsuranceCost = incomesWithEarningsTest.reduce((sum, inc) => {
        if (inc instanceof WorkIncome) {
            return sum + inc.getProratedAnnual(inc.insurance, year);
        }
        return sum;
    }, 0);

    // Initial Tax Calculation (Before any withdrawals)
    // Use allIncomes to include interest income in tax calculations
    let fedTax = TaxService.calculateFederalTax(taxState, allIncomes, nextExpenses, year, assumptions);
    let stateTax = TaxService.calculateStateTax(taxState, allIncomes, nextExpenses, year, assumptions);
    const ficaTax = TaxService.calculateFicaTax(taxState, allIncomes, year, assumptions);
    let totalTax = fedTax + stateTax + ficaTax;

    // ------------------------------------------------------------------
    // WITHDRAWAL TRACKING VARIABLES (declared early for RMD use)
    // ------------------------------------------------------------------
    // CHANGED: Split inflows into User vs Employer to support vesting tracking
    const userInflows: Record<string, number> = {};
    const employerInflows: Record<string, number> = {};
    const esppLots: Record<string, ESPPLot[]> = {}; // ESPP lots to add to accounts
    let withdrawalTaxes = 0;
    let capitalGainsTaxTotal = 0; // Track capital gains tax separately for display
    let strategyWithdrawalExecuted = 0;
    let totalWithdrawals = 0;
    const withdrawalDetail: Record<string, number> = {}; // Track by account name for display

    // ------------------------------------------------------------------
    // REQUIRED MINIMUM DISTRIBUTIONS (RMD) - BEFORE Roth conversions
    // ------------------------------------------------------------------
    // RMDs must be taken from Traditional accounts starting at age 72-75 depending on birth year
    // The RMD amount is based on the PRIOR year's ending balance divided by life expectancy factor
    // IMPORTANT: RMD happens BEFORE Roth conversions so that:
    // 1. RMD income is included when calculating Roth conversion bracket headroom
    // 2. RMD cash is available to cover living expenses
    const birthYearForRMD = assumptions.demographics.birthYear;
    const rmdRequired = isRMDRequired(currentAge, birthYearForRMD);
    let rmdDetails: SimulationYear['rmdDetails'] = undefined;
    let rmdFedTax = 0;   // Federal tax on RMD (tracked separately for proper taxDetails breakdown)
    let rmdStateTax = 0; // State tax on RMD
    const rmdIncomes: PassiveIncome[] = []; // RMD income objects for tracking and Roth conversion visibility

    if (rmdRequired) {
        const rmdCalculations: RMDCalculation[] = [];
        let totalRMDRequired = 0;
        let totalRMDWithdrawn = 0;

        // Find Traditional accounts and calculate RMD for each
        for (const account of accounts) {
            if (!(account instanceof InvestedAccount)) continue;
            if (!isAccountSubjectToRMD(account.taxType)) continue;

            // Get prior year's ending balance for RMD calculation
            const priorYearSim = previousSimulation[previousSimulation.length - 1];
            let priorYearBalance = account.amount; // Default to current if no history

            if (priorYearSim) {
                const priorAccount = priorYearSim.accounts.find(a => a.id === account.id);
                if (priorAccount) {
                    priorYearBalance = priorAccount.amount;
                }
            }

            // Calculate RMD for this account
            const rmdAmount = calculateRMD(priorYearBalance, currentAge);
            if (rmdAmount <= 0) continue;

            rmdCalculations.push({
                accountName: account.name,
                accountId: account.id,
                priorYearBalance: priorYearBalance,
                distributionPeriod: priorYearBalance / rmdAmount,
                rmdAmount: rmdAmount
            });

            totalRMDRequired += rmdAmount;

            // Withdraw the RMD (entire amount is taxable as ordinary income)
            const availableBalance = account.vestedAmount;
            const actualWithdrawal = Math.min(rmdAmount, availableBalance);

            if (actualWithdrawal > 0) {
                // Create RMD income object - this makes RMD visible to Roth conversion
                // when it calculates bracket headroom via getGrossIncome(incomes, year)
                const rmdIncome = new PassiveIncome(
                    `rmd-${account.id}-${year}`,
                    `RMD from ${account.name}`,
                    actualWithdrawal,
                    'Annually',
                    'No',  // Not earned income (no FICA)
                    'RMD',
                    new Date(`${year}-01-01`),
                    new Date(`${year}-12-31`),
                    false  // isReinvested: false - RMD is available as spendable cash
                );
                rmdIncomes.push(rmdIncome);

                // Calculate marginal tax on RMD withdrawal for tracking purposes
                const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
                const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

                const currentFedIncome = totalGrossIncome - preTaxDeductions;

                // State income needs to exclude SS for states that don't tax it
                const totalSSBenefits = TaxService.getSocialSecurityBenefits(allIncomes, year);
                let currentStateIncome = totalGrossIncome - preTaxDeductions;
                if (totalSSBenefits > 0) {
                    if (TaxService.doesStateTaxSocialSecurity(taxState.stateResidency)) {
                        // States that tax SS: use taxable portion
                        const agiExcludingSS = totalGrossIncome - totalSSBenefits - preTaxDeductions;
                        const taxableSSBenefits = TaxService.getTaxableSocialSecurityBenefits(totalSSBenefits, agiExcludingSS, taxState.filingStatus);
                        currentStateIncome = totalGrossIncome - totalSSBenefits + taxableSSBenefits - preTaxDeductions;
                    } else {
                        // States that don't tax SS: exclude entirely
                        currentStateIncome = totalGrossIncome - totalSSBenefits - preTaxDeductions;
                    }
                }

                const stdDedFed = fedParams?.standardDeduction || 12950;
                const stdDedState = stateParams?.standardDeduction || 0;
                const currentFedDeduction = taxState.deductionMethod === 'Standard' ? stdDedFed : 0;
                const currentStateDeduction = taxState.deductionMethod === 'Standard' ? stdDedState : 0;

                // Calculate marginal tax on the RMD amount
                const fedApplied = { ...fedParams!, standardDeduction: currentFedDeduction };
                const stateApplied = { ...stateParams!, standardDeduction: currentStateDeduction };

                const fedBase = TaxService.calculateTax(currentFedIncome, 0, fedApplied);
                const fedNew = TaxService.calculateTax(currentFedIncome + actualWithdrawal, 0, fedApplied);
                const stateBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                const stateNew = TaxService.calculateTax(currentStateIncome + actualWithdrawal, 0, stateApplied);

                // Track federal and state RMD taxes separately for proper taxDetails breakdown
                const thisRmdFedTax = fedNew - fedBase;
                const thisRmdStateTax = stateNew - stateBase;
                rmdFedTax += thisRmdFedTax;
                rmdStateTax += thisRmdStateTax;

                // Update totalGrossIncome so it includes RMD for cash flow calculations
                totalGrossIncome += actualWithdrawal;

                // Apply withdrawal to account
                userInflows[account.id] = (userInflows[account.id] || 0) - actualWithdrawal;
                totalRMDWithdrawn += actualWithdrawal;

                // Track in withdrawal details
                totalWithdrawals += actualWithdrawal;
                withdrawalDetail[account.name] = (withdrawalDetail[account.name] || 0) + actualWithdrawal;

                logs.push(`📋 RMD from ${account.name}: $${actualWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })} (Tax: $${(thisRmdFedTax + thisRmdStateTax).toLocaleString(undefined, { maximumFractionDigits: 0 })})`);
            }
        }

        // Calculate shortfall and penalty
        const shortfall = Math.max(0, totalRMDRequired - totalRMDWithdrawn);
        const penalty = shortfall * 0.25; // 25% penalty on shortfall (SECURE Act 2.0)

        if (shortfall > 0) {
            logs.push(`[WARN] RMD shortfall: $${shortfall.toLocaleString(undefined, { maximumFractionDigits: 0 })} - Penalty: $${penalty.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }

        rmdDetails = {
            totalRMD: totalRMDRequired,
            totalWithdrawn: totalRMDWithdrawn,
            accountBreakdown: rmdCalculations,
            shortfall: shortfall,
            penalty: penalty
        };

        // Add RMD tax to fedTax and stateTax for proper breakdown
        // Penalty is added to federal tax (it's an IRS penalty)
        fedTax += rmdFedTax + penalty;
        stateTax += rmdStateTax;
        totalTax = fedTax + stateTax + ficaTax;
    }

    // Add RMD incomes to allIncomes so Roth conversion sees them when calculating bracket headroom
    // This is done by pushing to the array (arrays are mutable even when const)
    allIncomes.push(...rmdIncomes);

    // ------------------------------------------------------------------
    // AUTO ROTH CONVERSIONS (during retirement)
    // ------------------------------------------------------------------
    let rothConversionResult: SimulationYear['rothConversion'] = undefined;

    if (isRetired && assumptions.investments.autoRothConversions) {
        // Calculate preliminary discretionaryCash to estimate Traditional withdrawal needed
        // This is needed to reduce Roth conversion bracket headroom appropriately
        const preliminaryLivingExpenses = nextExpenses.reduce((sum, exp) => {
            if (exp instanceof MortgageExpense) {
                return sum + exp.calculateAnnualAmortization(year).totalPayment;
            }
            if (exp instanceof LoanExpense) {
                return sum + exp.calculateAnnualAmortization(year).totalPayment;
            }
            return sum + exp.getAnnualAmount(year);
        }, 0);

        const preliminaryReinvested = allIncomes
            .filter(inc => inc instanceof PassiveIncome && inc.isReinvested)
            .reduce((sum, inc) => sum + inc.getAnnualAmount(year), 0);

        const preliminaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions
            - totalTax - preliminaryLivingExpenses - preliminaryReinvested;

        // Estimate Traditional withdrawal needed to cover expense deficit (if any)
        let estimatedTraditionalWithdrawal = estimateTraditionalWithdrawalForExpenses(
            preliminaryCash,
            accounts,
            assumptions.withdrawalStrategy || []
        );

        // Cap estimate at bracket headroom when tax-optimized withdrawals are enabled
        if (assumptions.investments.taxOptimizedWithdrawals && estimatedTraditionalWithdrawal > 0) {
            const headroom = calculateTraditionalWithdrawalCap(
                totalGrossIncome, preTaxDeductions, 0, year, taxState, assumptions
            );
            estimatedTraditionalWithdrawal = Math.min(estimatedTraditionalWithdrawal, headroom);
        }

        // Skip conversion if under 59.5 and deficit would require early Roth gains (penalty)
        let skipConversion = false;
        if (currentAge < 59.5 && preliminaryCash < 0) {
            const deficit = Math.abs(preliminaryCash);
            const penaltyFreeSources = accounts.reduce((sum, acc) => {
                const priorOutflow = Math.min(0, userInflows[acc.id] || 0);
                const available = acc.amount + priorOutflow;
                if (available <= 0) return sum;
                if (acc instanceof SavedAccount) return sum + available;
                if (acc instanceof InvestedAccount) {
                    if (acc.taxType === 'Brokerage') return sum + available;
                    if (acc.taxType === 'Roth 401k' || acc.taxType === 'Roth IRA') return sum + Math.min(available, acc.costBasis);
                }
                if (acc instanceof ESPPAccount) return sum + available;
                return sum;
            }, 0);
            if (deficit > penaltyFreeSources) {
                skipConversion = true;
                logs.push(`[SKIP] Skipping Roth conversion: deficit $${deficit.toLocaleString(undefined, { maximumFractionDigits: 0 })} exceeds penalty-free sources $${penaltyFreeSources.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
            }
        }

        const conversionResult = skipConversion ? undefined : performAutoRothConversion(
            accounts,
            allIncomes,
            nextExpenses,
            year,
            assumptions,
            taxState,
            previousSimulation,
            logs,
            estimatedTraditionalWithdrawal,
            userInflows
        );

        if (conversionResult && conversionResult.amount > 0) {
            rothConversionResult = conversionResult;

            // Recalculate taxes with conversion added to income
            // The conversion amount is treated as ordinary income for TAX purposes
            // but is NOT added to totalGrossIncome because it's not actual cash flow
            fedTax = fedTax + conversionResult.taxCost;

            // State tax on conversion - calculate marginal tax properly
            // Need to account for SS exclusion in states that don't tax SS
            const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);
            let stateConversionTax = 0;
            if (stateParams) {
                // Calculate state-adjusted income (excluding SS for most states)
                const totalSSBenefits = TaxService.getSocialSecurityBenefits(allIncomes, year);
                let stateBaseIncome = totalGrossIncome - preTaxDeductions;
                if (totalSSBenefits > 0) {
                    if (TaxService.doesStateTaxSocialSecurity(taxState.stateResidency)) {
                        // States that tax SS: use taxable portion
                        const agiExcludingSS = totalGrossIncome - totalSSBenefits - preTaxDeductions;
                        const taxableSSBenefits = TaxService.getTaxableSocialSecurityBenefits(totalSSBenefits, agiExcludingSS, taxState.filingStatus);
                        stateBaseIncome = totalGrossIncome - totalSSBenefits + taxableSSBenefits - preTaxDeductions;
                    } else {
                        // States that don't tax SS: exclude entirely
                        stateBaseIncome = totalGrossIncome - totalSSBenefits - preTaxDeductions;
                    }
                }
                const stateStdDed = stateParams.standardDeduction || 0;
                const stateApplied = { ...stateParams, standardDeduction: stateStdDed };

                // Calculate marginal state tax on conversion
                const stateBaseTax = TaxService.calculateTax(stateBaseIncome, 0, stateApplied);
                const stateNewTax = TaxService.calculateTax(stateBaseIncome + conversionResult.amount, 0, stateApplied);
                stateConversionTax = stateNewTax - stateBaseTax;
            }
            stateTax = stateTax + stateConversionTax;
            totalTax = fedTax + stateTax + ficaTax;

            // NOTE: We do NOT add conversion amount to totalGrossIncome
            // The conversion is a transfer between accounts, not real income
            // Effective tax rate calculations should use (totalIncome + conversionAmount) as denominator

            logs.push(`🔄 Auto Roth Conversion: $${conversionResult.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
            logs.push(`  Tax cost: $${conversionResult.taxCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }
    }

    // Apply Roth conversion flows (if any)
    // Withdrawals from Traditional accounts (negative) and deposits to Roth accounts (positive)
    // Also track conversion deposits separately for 5-year rule tracking
    const conversionDeposits: Record<string, number> = {};
    if (rothConversionResult) {
        for (const [accountId, amount] of Object.entries(rothConversionResult.fromAccountIds)) {
            userInflows[accountId] = (userInflows[accountId] || 0) - amount; // Negative = withdrawal
        }
        for (const [accountId, amount] of Object.entries(rothConversionResult.toAccountIds)) {
            userInflows[accountId] = (userInflows[accountId] || 0) + amount; // Positive = deposit
            conversionDeposits[accountId] = (conversionDeposits[accountId] || 0) + amount;
        }
    }

    // 3. LIVING EXPENSES (The Bills)
    let totalLivingExpenses = nextExpenses.reduce((sum, exp) => {
        if (exp instanceof MortgageExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        if (exp instanceof LoanExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        return sum + exp.getAnnualAmount(year);
    }, 0);

    // 4. CASHFLOW (The Wallet)
    // Formula: Gross - PreTax(401k/HSA/Insurance) - PostTax(Roth) - Taxes - Bills - Reinvested

    // Calculate reinvested income (e.g., savings account interest that stays in the account)
    // This income is taxable but not available as spendable cash
    const reinvestedIncome = allIncomes
        .filter(inc => inc instanceof PassiveIncome && inc.isReinvested)
        .reduce((sum, inc) => sum + inc.getAnnualAmount(year), 0);

    let discretionaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions - totalTax - totalLivingExpenses - reinvestedIncome;
    let withdrawalPenalties = 0;

    // ------------------------------------------------------------------
    // GUYTON-KLINGER SPENDING CAP
    // If GK is active, the target withdrawal IS the budget. If the deficit
    // exceeds the GK target, trim discretionary expenses to stay within it.
    // ------------------------------------------------------------------
    if (strategyWithdrawalResult && assumptions.investments.withdrawalStrategy === 'Guyton Klinger' && discretionaryCash < 0) {
        const deficit = Math.abs(discretionaryCash);
        const gkBudget = strategyWithdrawalResult.amount;

        if (deficit > gkBudget) {
            const excessSpending = deficit - gkBudget;

            // Calculate total discretionary expenses
            const totalDiscretionary = nextExpenses.reduce((sum, exp) => {
                if (!exp.isDiscretionary) return sum;
                if (exp instanceof MortgageExpense) {
                    return sum + exp.calculateAnnualAmortization(year).totalPayment;
                }
                if (exp instanceof LoanExpense) {
                    return sum + exp.calculateAnnualAmortization(year).totalPayment;
                }
                return sum + exp.getAnnualAmount(year);
            }, 0);

            if (totalDiscretionary > 0) {
                const trimAmount = Math.min(excessSpending, totalDiscretionary);
                const cutRatio = 1 - (trimAmount / totalDiscretionary);

                nextExpenses = nextExpenses.map(exp => {
                    if (exp.isDiscretionary) {
                        return exp.adjustAmount(cutRatio);
                    }
                    return exp;
                });

                // Recalculate totalLivingExpenses and discretionaryCash after trimming
                totalLivingExpenses = nextExpenses.reduce((sum, exp) => {
                    if (exp instanceof MortgageExpense) {
                        return sum + exp.calculateAnnualAmortization(year).totalPayment;
                    }
                    if (exp instanceof LoanExpense) {
                        return sum + exp.calculateAnnualAmortization(year).totalPayment;
                    }
                    return sum + exp.getAnnualAmount(year);
                }, 0);
                discretionaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions - totalTax - totalLivingExpenses - reinvestedIncome;

                logs.push(`[TARGET] GK spending cap: trimmed discretionary by $${trimAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} to stay within $${gkBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })} budget`);

                if (trimAmount >= totalDiscretionary) {
                    logs.push(`[WARN] GK cap: all discretionary expenses eliminated but fixed expenses still exceed budget`);
                }

                strategyAdjustmentResult = {
                    guardrailTriggered: strategyWithdrawalResult.guardrailTriggered,
                    requiredAdjustment: excessSpending,
                    actualAdjustment: trimAmount,
                    discretionaryAvailable: totalDiscretionary,
                    warning: trimAmount < excessSpending
                        ? `GK budget is $${gkBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })} but fixed expenses alone create a $${(deficit - totalDiscretionary).toLocaleString(undefined, { maximumFractionDigits: 0 })} deficit. Consider reducing fixed expenses.`
                        : undefined,
                };
            } else {
                logs.push(`[WARN] GK spending cap: deficit ($${deficit.toLocaleString(undefined, { maximumFractionDigits: 0 })}) exceeds budget ($${gkBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })}) but no discretionary expenses to trim`);
                strategyAdjustmentResult = {
                    guardrailTriggered: strategyWithdrawalResult.guardrailTriggered,
                    requiredAdjustment: excessSpending,
                    actualAdjustment: 0,
                    discretionaryAvailable: 0,
                    warning: `GK budget is $${gkBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })} but no discretionary expenses to trim. All expenses are fixed.`,
                };
            }
        } else {
            logs.push(`[OK] GK spending cap: deficit ($${deficit.toLocaleString(undefined, { maximumFractionDigits: 0 })}) within budget ($${gkBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })})`);
        }
    }

    // ------------------------------------------------------------------
    // RETIREMENT WITHDRAWAL STRATEGY (for non-GK strategies)
    // ------------------------------------------------------------------
    if (isRetired && assumptions.investments.withdrawalStrategy !== 'Guyton Klinger' && assumptions.investments.withdrawalStrategy !== 'None') {
        // Calculate total invested assets (for withdrawal calculations)
        const totalInvestedAssets = accounts.reduce((sum, acc) => {
            if (acc instanceof InvestedAccount || acc instanceof SavedAccount || acc instanceof ESPPAccount) {
                return sum + acc.amount;
            }
            return sum;
        }, 0);

        // Get previous year's withdrawal result for tracking
        const previousStrategyResult = previousSimulation.length > 0
            ? previousSimulation[previousSimulation.length - 1].strategyWithdrawal
            : undefined;

        // Calculate years in retirement (0 = first year)
        const retirementStartYear = assumptions.demographics.birthYear + assumptions.demographics.retirementAge;
        const yearsInRetirement = year - retirementStartYear;

        // Calculate strategy-based withdrawal
        strategyWithdrawalResult = calculateStrategyWithdrawal(
            assumptions.investments.withdrawalStrategy,
            assumptions.investments.withdrawalRate,
            totalInvestedAssets,
            assumptions.macro.inflationRate,
            yearsInRetirement,
            previousStrategyResult
        );

        logs.push(`[INFO] Retirement withdrawal strategy: ${assumptions.investments.withdrawalStrategy}`);
        logs.push(`  Target withdrawal: $${strategyWithdrawalResult.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        logs.push(`  Portfolio value: $${totalInvestedAssets.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        logs.push(`  Effective rate: ${((strategyWithdrawalResult.amount / totalInvestedAssets) * 100).toFixed(2)}%`);
    }

    // ------------------------------------------------------------------
    // STRATEGY SPENDING CAP (Fixed Real / Percentage)
    // The strategy target IS the budget. If expenses exceed it, trim discretionary.
    // ------------------------------------------------------------------
    if (strategyWithdrawalResult && assumptions.investments.withdrawalStrategy !== 'Guyton Klinger' && assumptions.investments.withdrawalStrategy !== 'None' && discretionaryCash < 0) {
        const deficit = Math.abs(discretionaryCash);
        const budget = strategyWithdrawalResult.amount;

        if (deficit > budget) {
            const excessSpending = deficit - budget;

            const totalDiscretionary = nextExpenses.reduce((sum, exp) => {
                if (!exp.isDiscretionary) return sum;
                if (exp instanceof MortgageExpense) {
                    return sum + exp.calculateAnnualAmortization(year).totalPayment;
                }
                if (exp instanceof LoanExpense) {
                    return sum + exp.calculateAnnualAmortization(year).totalPayment;
                }
                return sum + exp.getAnnualAmount(year);
            }, 0);

            if (totalDiscretionary > 0) {
                const trimAmount = Math.min(excessSpending, totalDiscretionary);
                const cutRatio = 1 - (trimAmount / totalDiscretionary);

                nextExpenses = nextExpenses.map(exp => {
                    if (exp.isDiscretionary) {
                        return exp.adjustAmount(cutRatio);
                    }
                    return exp;
                });

                totalLivingExpenses = nextExpenses.reduce((sum, exp) => {
                    if (exp instanceof MortgageExpense) {
                        return sum + exp.calculateAnnualAmortization(year).totalPayment;
                    }
                    if (exp instanceof LoanExpense) {
                        return sum + exp.calculateAnnualAmortization(year).totalPayment;
                    }
                    return sum + exp.getAnnualAmount(year);
                }, 0);
                discretionaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions - totalTax - totalLivingExpenses - reinvestedIncome;

                logs.push(`[TARGET] ${assumptions.investments.withdrawalStrategy} spending cap: trimmed discretionary by $${trimAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} to stay within $${budget.toLocaleString(undefined, { maximumFractionDigits: 0 })} budget`);

                if (trimAmount < excessSpending) {
                    strategyAdjustmentResult = {
                        guardrailTriggered: 'capital-preservation',
                        requiredAdjustment: excessSpending,
                        actualAdjustment: trimAmount,
                        discretionaryAvailable: totalDiscretionary,
                        warning: `${assumptions.investments.withdrawalStrategy} budget is $${budget.toLocaleString(undefined, { maximumFractionDigits: 0 })} but fixed expenses alone create a $${(deficit - totalDiscretionary).toLocaleString(undefined, { maximumFractionDigits: 0 })} deficit. Consider reducing fixed expenses.`,
                    };
                }
            } else {
                logs.push(`[WARN] ${assumptions.investments.withdrawalStrategy} spending cap: deficit exceeds budget but no discretionary expenses to trim`);
                strategyAdjustmentResult = {
                    guardrailTriggered: 'capital-preservation',
                    requiredAdjustment: excessSpending,
                    actualAdjustment: 0,
                    discretionaryAvailable: 0,
                    warning: `${assumptions.investments.withdrawalStrategy} budget is $${budget.toLocaleString(undefined, { maximumFractionDigits: 0 })} but no discretionary expenses to trim. All expenses are fixed.`,
                };
            }
        } else {
            logs.push(`[OK] ${assumptions.investments.withdrawalStrategy} spending cap: deficit ($${deficit.toLocaleString(undefined, { maximumFractionDigits: 0 })}) within budget ($${budget.toLocaleString(undefined, { maximumFractionDigits: 0 })})`);
        }
    }

    // ------------------------------------------------------------------
    // WITHDRAWAL LOGIC (Deficit Manager)
    // ------------------------------------------------------------------
    // Note: RMD cash is already included in discretionaryCash via totalGrossIncome and totalTax
    // (totalGrossIncome includes RMD withdrawal, totalTax includes RMD tax)

    // Calculate deficit - withdraw what's needed to cover expenses (capped by strategy above)
    const deficitAmount = discretionaryCash < 0 ? Math.abs(discretionaryCash) : 0;
    let amountToWithdraw = deficitAmount;

    if (amountToWithdraw > 0) {
        let deficit = amountToWithdraw;

        // Build withdrawal iteration order
        const strategy = assumptions.withdrawalStrategy || [];
        let traditionalHeadroomRemaining = Infinity;
        interface PhasedBucket { accountId: string; name: string; id: string; cappedTraditional: boolean }
        let withdrawalBuckets: PhasedBucket[];

        if (assumptions.investments.taxOptimizedWithdrawals) {
            // Tax-optimized: cap Traditional accounts at bracket ceiling in user's order,
            // then overflow back to Traditional uncapped if deficit remains
            const rothConversionAmount = rothConversionResult?.amount || 0;
            traditionalHeadroomRemaining = calculateTraditionalWithdrawalCap(
                totalGrossIncome, preTaxDeductions, rothConversionAmount, year, taxState, assumptions
            );

            // Identify Traditional (tax-deferred) buckets for overflow pass
            const deferredBuckets = strategy.filter(b => {
                const acc = accounts.find(a => a.id === b.accountId);
                return acc && classifyAccountTaxCategory(acc) === 'tax-deferred';
            });

            // Use user's drag order with bracket cap on Traditional, then overflow
            withdrawalBuckets = [
                ...strategy.map(b => {
                    const acc = accounts.find(a => a.id === b.accountId);
                    const isDeferred = acc && classifyAccountTaxCategory(acc) === 'tax-deferred';
                    return { ...b, cappedTraditional: !!isDeferred };
                }),
                ...deferredBuckets.map(b => ({ ...b, cappedTraditional: false })),
            ];

            logs.push(`[TARGET] Tax-optimized withdrawals: target ${(assumptions.investments.taxOptimizedTargetBracket * 100).toFixed(0)}% bracket`);
            logs.push(`  Traditional headroom: $${traditionalHeadroomRemaining.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        } else {
            // Legacy sequential behavior
            withdrawalBuckets = strategy.map(b => ({ ...b, cappedTraditional: false }));
        }

        for (const bucket of withdrawalBuckets) {
            if (deficit <= 0.01) break;

            const account = accounts.find(acc => acc.id === bucket.accountId);
            if (!account) continue;

            let availableBalance = account.amount;
            if (account instanceof InvestedAccount) {
                availableBalance = account.vestedAmount; // Use the getter from models.tsx
            }
            // Subtract any prior outflows already recorded (e.g., RMD withdrawals, Roth conversions)
            // userInflows are negative for withdrawals, so subtracting a negative adds back
            const priorOutflow = userInflows[account.id] || 0;
            if (priorOutflow < 0) {
                availableBalance += priorOutflow; // priorOutflow is negative, so this reduces balance
            }
            if (availableBalance <= 0) continue;

            let withdrawAmount = 0;
            let taxHit = 0;

            // SCENARIO 1: Tax-Free (or partially tax-free for Roth early withdrawal)
            const isRoth = account instanceof InvestedAccount && (account.taxType === 'Roth 401k' || account.taxType === 'Roth IRA');
            const isHSA = account instanceof InvestedAccount && account.taxType === 'HSA';
            const isSaved = account instanceof SavedAccount;
            const isTaxFree = isSaved || isRoth || isHSA;
            const isEarly = currentAge < 59.5; // currentAge is calculated at function scope
            // Note: 55 rule and SEPP are complex exceptions, stick to 59.5 for now.

            if (isTaxFree) {
                // For Roth accounts with early withdrawal, we need to track that the
                // gains portion is taxable (contributions come out first tax-free)
                if (isRoth && isEarly && account instanceof InvestedAccount) {
                    // IRS Roth ordering rules (before 59.5):
                    // Step 1: Regular contributions — tax-free, penalty-free
                    // Step 2: Conversions (FIFO) — tax-free, 10% penalty if within 5 years
                    // Step 3: Earnings — taxable income + 10% penalty

                    const regularContribs = account.regularContributions;
                    const accountGains = account.unrealizedGains;
                    let usedFromBalance = 0;

                    // Step 1: Regular contributions (penalty-free, tax-free)
                    const step1Amount = Math.min(deficit, regularContribs, availableBalance);
                    deficit -= step1Amount;
                    usedFromBalance += step1Amount;

                    // Step 2: Conversions (FIFO, oldest first)
                    // Tax-free but 10% penalty if conversion is less than 5 years old
                    if (deficit > 0 && account.conversionHistory.length > 0) {
                        // Sort by year ascending (FIFO)
                        const sortedConversions = [...account.conversionHistory].sort((a, b) => a.year - b.year);
                        let conversionPenalty = 0;

                        for (const conversion of sortedConversions) {
                            if (deficit <= 0) break;
                            if (conversion.amount <= 0) continue;

                            const convWithdraw = Math.min(deficit, conversion.amount, availableBalance - usedFromBalance);
                            if (convWithdraw <= 0) break;

                            // 10% penalty if within 5 years of conversion
                            if ((year - conversion.year) < 5) {
                                conversionPenalty += convWithdraw * 0.10;
                            }

                            deficit -= convWithdraw;
                            usedFromBalance += convWithdraw;
                        }

                        if (conversionPenalty > 0) {
                            withdrawalPenalties += conversionPenalty;
                            // Penalty reduces net, so we need more gross to cover it
                            deficit += conversionPenalty;
                            logs.push(`[WARN] Roth 5-year rule: 10% penalty on $${(conversionPenalty / 0.10).toLocaleString(undefined, { maximumFractionDigits: 0 })} converted funds withdrawn early`);
                        }
                    }

                    // Step 3: Earnings — taxable income + 10% penalty
                    if (deficit > 0 && accountGains > 0) {
                        const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
                        const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

                        const currentFedIncome = totalGrossIncome - preTaxDeductions;
                        const currentStateIncome = totalGrossIncome - preTaxDeductions;
                        const stdDedFed = fedParams?.standardDeduction || 12950;
                        const stdDedState = stateParams?.standardDeduction || 0;
                        const currentFedDeduction = taxState.deductionMethod === 'Standard' ? stdDedFed : 0;
                        const currentStateDeduction = taxState.deductionMethod === 'Standard' ? stdDedState : 0;

                        // Use solver with 10% penalty to find gross gains withdrawal
                        const gainsResult = TaxService.calculateGrossWithdrawal(
                            deficit,
                            currentFedIncome,
                            currentFedDeduction,
                            currentStateIncome,
                            currentStateDeduction,
                            taxState,
                            year,
                            assumptions,
                            0.10 // 10% early withdrawal penalty
                        );

                        // Cap gross gains at available gains and remaining balance
                        const grossGainsWithdrawal = Math.min(gainsResult.grossWithdrawn, accountGains, availableBalance - usedFromBalance);

                        // Recalculate actual tax/penalty for the capped amount
                        const fedApplied = { ...fedParams!, standardDeduction: currentFedDeduction };
                        const stateApplied = { ...stateParams!, standardDeduction: currentStateDeduction };

                        const fedBase = TaxService.calculateTax(currentFedIncome, 0, fedApplied);
                        const fedNew = TaxService.calculateTax(currentFedIncome + grossGainsWithdrawal, 0, fedApplied);
                        const stateBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                        const stateNew = TaxService.calculateTax(currentStateIncome + grossGainsWithdrawal, 0, stateApplied);

                        const taxOnGains = (fedNew - fedBase) + (stateNew - stateBase);
                        const earlyPenalty = grossGainsWithdrawal * 0.10;

                        withdrawalTaxes += taxOnGains;
                        withdrawalPenalties += earlyPenalty;
                        totalGrossIncome += grossGainsWithdrawal;

                        logs.push(`[WARN] Early Roth withdrawal: $${grossGainsWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })} earnings taxed + 10% penalty`);

                        usedFromBalance += grossGainsWithdrawal;
                        const netFromGains = grossGainsWithdrawal - taxOnGains - earlyPenalty;
                        deficit -= netFromGains;
                    }

                    withdrawAmount = usedFromBalance;
                } else {
                    // Normal tax-free withdrawal (qualified Roth, HSA, or SavedAccount)
                    withdrawAmount = Math.min(deficit, availableBalance);
                    deficit -= withdrawAmount;
                }
            }
            
            
            // SCENARIO 2: Pre-Tax (Traditional 401k/IRA)
            else if (account instanceof InvestedAccount && (account.taxType === 'Traditional 401k' || account.taxType === 'Traditional IRA')) {
                // Phase 1 cap: skip if no headroom remains for capped Traditional
                if (bucket.cappedTraditional && traditionalHeadroomRemaining <= 0) continue;

                // Effective cap: headroom limit in Phase 1, balance limit otherwise
                const effectiveCap = bucket.cappedTraditional
                    ? Math.min(availableBalance, traditionalHeadroomRemaining)
                    : availableBalance;

                // 1. Calculate Baselines
                const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
                const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

                const currentFedIncome = totalGrossIncome - preTaxDeductions;
                const currentStateIncome = totalGrossIncome - preTaxDeductions;

                const stdDedFed = fedParams?.standardDeduction || 12950;
                const stdDedState = stateParams?.standardDeduction || 0;

                const currentFedDeduction = taxState.deductionMethod === 'Standard' ? stdDedFed : 0;
                const currentStateDeduction = taxState.deductionMethod === 'Standard' ? stdDedState : 0;

                // 2. Call Solver with penalty rate integrated
                const penaltyRate = isEarly ? 0.10 : 0;
                const result = TaxService.calculateGrossWithdrawal(
                    Math.min(deficit, effectiveCap),
                    currentFedIncome,
                    currentFedDeduction,
                    currentStateIncome,
                    currentStateDeduction,
                    taxState,
                    year,
                    assumptions,
                    penaltyRate
                );

                // Overdraft / Headroom Cap Check
                if (result.grossWithdrawn > effectiveCap) {
                    withdrawAmount = effectiveCap;

                    // Manual tax calc for the partial amount
                    const fedApplied = { ...fedParams!, standardDeduction: currentFedDeduction };
                    const stateApplied = { ...stateParams!, standardDeduction: currentStateDeduction };

                    // Fed Impact
                    const fedBase = TaxService.calculateTax(currentFedIncome, 0, fedApplied);
                    const fedNew = TaxService.calculateTax(currentFedIncome + withdrawAmount, 0, fedApplied);

                    // State Impact
                    const stateBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                    const stateNew = TaxService.calculateTax(currentStateIncome + withdrawAmount, 0, stateApplied);

                    taxHit = (fedNew - fedBase) + (stateNew - stateBase);

                    const actualPenalty = withdrawAmount * penaltyRate;
                    withdrawalPenalties += actualPenalty;

                    deficit -= (withdrawAmount - taxHit - actualPenalty);
                } else {
                    withdrawAmount = result.grossWithdrawn;
                    taxHit = result.totalTax;
                    withdrawalPenalties += result.penalty;

                    // Cash Received = Gross - Tax - Penalty = deficit (solver guarantees this)
                    deficit -= deficit; // Fully covered
                }

                // 3. Update Baselines
                totalGrossIncome += withdrawAmount;
                withdrawalTaxes += taxHit;

                // 4. Decrement Traditional headroom (gross amount consumed)
                if (bucket.cappedTraditional) {
                    traditionalHeadroomRemaining -= withdrawAmount;
                }
            }
            // SCENARIO 3: Brokerage (Capital Gains Tax)
            else if (account instanceof InvestedAccount && account.taxType === 'Brokerage') {
                // Brokerage withdrawals: only gains are taxed at capital gains rates
                // We need to gross up the withdrawal to cover the tax

                // Calculate the gains portion of the account (stays constant for proportional method)
                const gainsPortion = account.unrealizedGains / account.amount;

                // Get tax parameters for bracket calculation
                const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
                const currentFedIncome = totalGrossIncome - preTaxDeductions;
                const stdDedFed = fedParams?.standardDeduction || 12950;
                const currentFedDeduction = taxState.deductionMethod === 'Standard' ? stdDedFed : 0;
                const ordinaryTaxableIncome = Math.max(0, currentFedIncome - currentFedDeduction);

                // State tax parameters
                const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);
                const stdDedState = stateParams?.standardDeduction || 0;
                const currentStateDeduction = taxState.deductionMethod === 'Standard' ? stdDedState : 0;
                const stateApplied = { ...stateParams!, standardDeduction: currentStateDeduction };
                const currentStateIncome = totalGrossIncome - preTaxDeductions;

                // Use iterative approach to find gross withdrawal needed to net the deficit
                // Start with an estimate assuming ~15% effective cap gains rate on gains portion
                let grossWithdrawal = deficit / (1 - gainsPortion * 0.15);

                // Iterate to refine (capital gains brackets make this non-linear)
                for (let i = 0; i < 10; i++) {
                    const testWithdrawal = Math.min(grossWithdrawal, availableBalance);
                    const testAllocation = account.calculateWithdrawalAllocation(testWithdrawal);

                    // Calculate capital gains tax
                    const testCapGainsTax = TaxService.calculateCapitalGainsTax(
                        testAllocation.gains,
                        ordinaryTaxableIncome,
                        taxState,
                        year,
                        assumptions
                    );

                    // State capital gains tax
                    const stateBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                    const stateNew = TaxService.calculateTax(currentStateIncome + testAllocation.gains, 0, stateApplied);
                    const testStateCapGainsTax = stateNew - stateBase;

                    const testTotalTax = testCapGainsTax + testStateCapGainsTax;
                    const testNetReceived = testWithdrawal - testTotalTax;

                    // Check if we're close enough (within $1)
                    if (Math.abs(testNetReceived - deficit) < 1) {
                        grossWithdrawal = testWithdrawal;
                        break;
                    }

                    // Adjust withdrawal to converge on target
                    // Scale up or down based on ratio of needed vs received
                    if (testWithdrawal >= availableBalance) {
                        // Can't withdraw more, use what we have
                        grossWithdrawal = availableBalance;
                        break;
                    }

                    // Scale proportionally: if we got too little, increase; if too much, decrease
                    grossWithdrawal = testWithdrawal * (deficit / testNetReceived);
                }

                // Cap at available balance
                grossWithdrawal = Math.min(grossWithdrawal, availableBalance);
                const allocation = account.calculateWithdrawalAllocation(grossWithdrawal);

                // Final tax calculation
                const capitalGainsTax = TaxService.calculateCapitalGainsTax(
                    allocation.gains,
                    ordinaryTaxableIncome,
                    taxState,
                    year,
                    assumptions
                );

                const stateBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                const stateNew = TaxService.calculateTax(currentStateIncome + allocation.gains, 0, stateApplied);
                const stateCapGainsTax = stateNew - stateBase;

                taxHit = capitalGainsTax + stateCapGainsTax;
                withdrawAmount = grossWithdrawal;

                // Net received = withdrawal - tax on gains
                const netReceived = grossWithdrawal - taxHit;
                deficit -= netReceived;

                // Track capital gains tax separately for display
                capitalGainsTaxTotal += taxHit;

                if (allocation.gains > 0 || taxHit > 0) {
                    logs.push(`[FLOW] Brokerage withdrawal: $${grossWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })} ` +
                        `(Basis: $${allocation.basis.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                        `Gains: $${allocation.gains.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                        `Cap Gains Tax: $${taxHit.toLocaleString(undefined, { maximumFractionDigits: 0 })})`);
                }
            }
            // SCENARIO 4: ESPP Account (Mixed tax treatment: ordinary income + capital gains)
            else if (account instanceof ESPPAccount) {
                const saleDate = new Date(year, 6, 1); // Mid-year sale date for calculations

                // Check withdrawal preference - skip if set to "dont_sell_until_qualifying" and no qualifying lots
                if (account.withdrawalPreference === 'dont_sell_until_qualifying') {
                    const eligibleLots = account.getEligibleLots(saleDate);
                    const hasQualifying = eligibleLots.some(lot => account.calculateDispositionType(lot, saleDate) === 'qualifying');
                    if (!hasQualifying) {
                        logs.push(`[SKIP] ESPP ${account.name}: Skipping (no qualifying lots, preference set to wait)`);
                        continue; // Move to next account in withdrawal order
                    }
                }

                // Get lots eligible for sale based on minimum holding period
                const eligibleLots = account.getEligibleLots(saleDate);
                const eligibleShares = eligibleLots.reduce((sum, lot) => sum + lot.shares, 0);

                // If no eligible lots due to holding period restriction
                if (eligibleShares === 0 && account.minimumHoldingDays > 0) {
                    logs.push(`[SKIP] ESPP ${account.name}: Skipping (no lots meet ${account.minimumHoldingDays}-day holding requirement)`);
                    continue;
                }

                // If ESPP account has no lots yet, treat as simple withdrawal
                if (account.totalShares === 0) {
                    withdrawAmount = Math.min(deficit, availableBalance);
                    deficit -= withdrawAmount;
                    logs.push(`[FLOW] ESPP withdrawal (no lots): $${withdrawAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
                } else {
                    // ESPP sales have mixed tax treatment:
                    // - Discount portion: ordinary income (qualifying) or full discount as ordinary (disqualifying)
                    // - Remaining gain: capital gains (short-term or long-term)
                    const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
                    const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

                    const currentFedIncome = totalGrossIncome - preTaxDeductions;
                    const stdDedFed = fedParams?.standardDeduction || 12950;
                    const currentFedDeduction = taxState.deductionMethod === 'Standard' ? stdDedFed : 0;
                    const ordinaryTaxableIncome = Math.max(0, currentFedIncome - currentFedDeduction);

                    const currentStateIncome = totalGrossIncome - preTaxDeductions;
                    const stdDedState = stateParams?.standardDeduction || 0;
                    const currentStateDeduction = taxState.deductionMethod === 'Standard' ? stdDedState : 0;
                    const stateApplied = { ...stateParams!, standardDeduction: currentStateDeduction };

                    const lotOrder = getESPPLotOrder(account.withdrawalPreference);

                    // Calculate available balance from eligible shares only
                    const currentPrice = account.amount / account.totalShares;
                    const eligibleBalance = eligibleShares > 0 ? eligibleShares * currentPrice : availableBalance;
                    const effectiveAvailableBalance = account.minimumHoldingDays > 0 ? Math.min(availableBalance, eligibleBalance) : availableBalance;

                    // Use iterative approach to find gross withdrawal needed to net the deficit
                    // Assume ~20% effective total tax rate as starting estimate
                    let grossWithdrawal = deficit / 0.8;

                    // Iterate to refine
                    for (let i = 0; i < 10; i++) {
                        const testWithdrawal = Math.min(grossWithdrawal, effectiveAvailableBalance);
                        const sharesToSell = testWithdrawal / currentPrice;

                        // Calculate tax using ESPP's built-in method with lot order preference and eligible lots
                        const taxResult = account.calculateSaleTax(sharesToSell, currentPrice, saleDate, lotOrder, account.minimumHoldingDays > 0 ? eligibleLots : undefined);
                        const totalCapGains = taxResult.shortTermGains + taxResult.longTermGains;

                        // Federal tax on ordinary income portion
                        const fedBase = TaxService.calculateTax(currentFedIncome, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                        const fedNew = TaxService.calculateTax(currentFedIncome + taxResult.ordinaryIncome, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                        const ordinaryTax = fedNew - fedBase;

                        // State tax on ordinary income
                        const stateOrdBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                        const stateOrdNew = TaxService.calculateTax(currentStateIncome + taxResult.ordinaryIncome, 0, stateApplied);
                        const stateOrdinaryTax = stateOrdNew - stateOrdBase;

                        // Federal capital gains tax (long-term only; short-term taxed as ordinary)
                        const capGainsTax = TaxService.calculateCapitalGainsTax(
                            taxResult.longTermGains,
                            ordinaryTaxableIncome + taxResult.ordinaryIncome + taxResult.shortTermGains,
                            taxState,
                            year,
                            assumptions
                        );

                        // Short-term gains taxed as ordinary income
                        const fedShortBase = TaxService.calculateTax(currentFedIncome + taxResult.ordinaryIncome, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                        const fedShortNew = TaxService.calculateTax(currentFedIncome + taxResult.ordinaryIncome + taxResult.shortTermGains, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                        const shortTermTax = fedShortNew - fedShortBase;

                        // State capital gains tax (states typically tax all gains as ordinary)
                        const stateCapBase = TaxService.calculateTax(currentStateIncome + taxResult.ordinaryIncome, 0, stateApplied);
                        const stateCapNew = TaxService.calculateTax(currentStateIncome + taxResult.ordinaryIncome + totalCapGains, 0, stateApplied);
                        const stateCapGainsTax = stateCapNew - stateCapBase;

                        const testTotalTax = ordinaryTax + stateOrdinaryTax + capGainsTax + shortTermTax + stateCapGainsTax;
                        const testNetReceived = testWithdrawal - testTotalTax;

                        if (Math.abs(testNetReceived - deficit) < 1) {
                            grossWithdrawal = testWithdrawal;
                            break;
                        }

                        // Adjust estimate
                        if (testNetReceived > deficit) {
                            grossWithdrawal = testWithdrawal - (testNetReceived - deficit) * 0.8;
                        } else {
                            grossWithdrawal = testWithdrawal + (deficit - testNetReceived) * 1.2;
                        }
                    }

                    grossWithdrawal = Math.min(grossWithdrawal, effectiveAvailableBalance);
                    const sharesToSell = grossWithdrawal / currentPrice;
                    const taxResult = account.calculateSaleTax(sharesToSell, currentPrice, saleDate, lotOrder, account.minimumHoldingDays > 0 ? eligibleLots : undefined);
                    const totalCapGains = taxResult.shortTermGains + taxResult.longTermGains;

                    // Recalculate final taxes
                    const fedBase = TaxService.calculateTax(currentFedIncome, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                    const fedNew = TaxService.calculateTax(currentFedIncome + taxResult.ordinaryIncome, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                    const ordinaryTax = fedNew - fedBase;

                    const stateOrdBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                    const stateOrdNew = TaxService.calculateTax(currentStateIncome + taxResult.ordinaryIncome, 0, stateApplied);
                    const stateOrdinaryTax = stateOrdNew - stateOrdBase;

                    const capGainsTax = TaxService.calculateCapitalGainsTax(
                        taxResult.longTermGains,
                        ordinaryTaxableIncome + taxResult.ordinaryIncome + taxResult.shortTermGains,
                        taxState,
                        year,
                        assumptions
                    );

                    const fedShortBase = TaxService.calculateTax(currentFedIncome + taxResult.ordinaryIncome, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                    const fedShortNew = TaxService.calculateTax(currentFedIncome + taxResult.ordinaryIncome + taxResult.shortTermGains, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                    const shortTermTax = fedShortNew - fedShortBase;

                    const stateCapBase = TaxService.calculateTax(currentStateIncome + taxResult.ordinaryIncome, 0, stateApplied);
                    const stateCapNew = TaxService.calculateTax(currentStateIncome + taxResult.ordinaryIncome + totalCapGains, 0, stateApplied);
                    const stateCapGainsTax = stateCapNew - stateCapBase;

                    taxHit = ordinaryTax + stateOrdinaryTax + capGainsTax + shortTermTax + stateCapGainsTax;
                    withdrawAmount = grossWithdrawal;

                    const netReceived = grossWithdrawal - taxHit;
                    deficit -= netReceived;

                    // Track taxes - ordinary income and short-term gains go to withdrawal taxes, long-term cap gains tracked separately
                    withdrawalTaxes += ordinaryTax + stateOrdinaryTax + shortTermTax;
                    capitalGainsTaxTotal += capGainsTax + stateCapGainsTax;
                    totalGrossIncome += taxResult.ordinaryIncome + taxResult.shortTermGains;

                    logs.push(`[FLOW] ESPP withdrawal: $${grossWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })} ` +
                        `(Ordinary: $${taxResult.ordinaryIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                        `ST Gains: $${taxResult.shortTermGains.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                        `LT Gains: $${taxResult.longTermGains.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                        `Tax: $${taxHit.toLocaleString(undefined, { maximumFractionDigits: 0 })})`);
                }
            }
            // SCENARIO 5: Fallback for any other account type
            // Treat as simple withdrawal (no tax calculation - covers edge cases)
            else {
                withdrawAmount = Math.min(deficit, availableBalance);
                deficit -= withdrawAmount;
                logs.push(`[WARN] Fallback withdrawal from ${account.name}: ${withdrawAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
            }

            // Apply Withdrawal to USER inflows (assuming we drain user vested funds first)
            // Negative value = Withdrawal
            userInflows[account.id] = (userInflows[account.id] || 0) - withdrawAmount;

            // Track withdrawal for cashflow chart display
            if (withdrawAmount > 0) {
                totalWithdrawals += withdrawAmount;
                withdrawalDetail[account.name] = (withdrawalDetail[account.name] || 0) + withdrawAmount;
            }
        }

        // Final Adjustments
        totalTax += withdrawalTaxes + capitalGainsTaxTotal;

        // Track how much was actually withdrawn for strategy tracking
        strategyWithdrawalExecuted = amountToWithdraw - deficit;

        // FLOATING POINT CLEANUP
        // If the remaining deficit is less than half a penny, treat it as zero.
        // This prevents "-$0.00" errors in the UI or logic.
        if (Math.abs(deficit) < 0.005) {
            //This happens all the time, I got rid of the console spam //todo look into why this happens so much?
            deficit = 0;
        }

        // Update discretionary cash:
        // - If we covered the deficit, discretionaryCash becomes 0
        // - If we couldn't fully cover deficit, discretionaryCash stays negative
        discretionaryCash = -deficit;

        // Clean up small positive surplus from withdrawal solver rounding
        // The solver has ~$1 tolerance, which can create tiny surpluses that
        // shouldn't flow to priority allocations. Zero out amounts under $2.
        if (discretionaryCash > 0 && discretionaryCash < 2) {
            discretionaryCash = 0;
        }

        if (isRetired && strategyWithdrawalExecuted > 0) {
            logs.push(`💰 Strategy withdrawal executed: $${strategyWithdrawalExecuted.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }
    }

    // ------------------------------------------------------------------
    // DEFICIT DEBT TRACKING
    // ------------------------------------------------------------------
    // If there's still an uncovered deficit after all withdrawals, track it as debt
    const DEFICIT_DEBT_ID = 'system-deficit-debt';
    const DEFICIT_DEBT_NAME = 'Uncovered Deficit';
    let deficitDebtPayment = 0;

    // Find existing deficit debt account
    let existingDeficitDebt = accounts.find(
        acc => acc instanceof DeficitDebtAccount && acc.id === DEFICIT_DEBT_ID
    ) as DeficitDebtAccount | undefined;

    // If we have an uncovered deficit (negative discretionary cash), add to deficit debt
    if (discretionaryCash < 0) {
        const uncoveredDeficit = Math.abs(discretionaryCash);

        if (existingDeficitDebt) {
            // Add to existing debt
            existingDeficitDebt = new DeficitDebtAccount(
                DEFICIT_DEBT_ID,
                DEFICIT_DEBT_NAME,
                existingDeficitDebt.amount + uncoveredDeficit
            );
        } else {
            // Create new debt account
            existingDeficitDebt = new DeficitDebtAccount(
                DEFICIT_DEBT_ID,
                DEFICIT_DEBT_NAME,
                uncoveredDeficit
            );
        }

        logs.push(`[WARN] Uncovered deficit of $${uncoveredDeficit.toLocaleString(undefined, { maximumFractionDigits: 0 })} added to deficit debt`);
        logs.push(`  Total deficit debt: $${existingDeficitDebt.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

        // Deficit is now captured as debt, so reset discretionary cash to 0
        discretionaryCash = 0;
    }

    // ------------------------------------------------------------------
    // END WITHDRAWAL LOGIC
    // ------------------------------------------------------------------

    // 5. INFLOWS & BUCKETS (The Allocation of Surplus)
    const bucketDetail: Record<string, number> = {};
    let totalEmployerMatch = 0;
    let totalBucketAllocations = 0;

    // 5a. Payroll & Match
    incomesWithEarningsTest.forEach(inc => {
        if (inc instanceof WorkIncome && inc.matchAccountId) {
            // Prorate contributions based on how much of the year the income is active
            // This ensures contributions stop when the income ends (e.g., at retirement)
            const activeMultiplier = getIncomeActiveMultiplier(inc, year);
            if (activeMultiplier === 0) return; // Skip if income not active this year

            const currentSelf = userInflows[inc.matchAccountId] || 0;
            const currentMatch = employerInflows[inc.matchAccountId] || 0;

            const selfContribution = (inc.preTax401k + inc.roth401k) * activeMultiplier;
            const employerMatch = inc.employerMatch * activeMultiplier;

            totalEmployerMatch += employerMatch;

            // CHANGED: Separate the streams so InvestedAccount can track vesting
            userInflows[inc.matchAccountId] = currentSelf + selfContribution;
            employerInflows[inc.matchAccountId] = currentMatch + employerMatch;
        }
    });

    // 5a-2. ESPP Purchase Processing
    // Track total ESPP purchases to enforce $25k FMV annual limit
    let totalESPPFMVThisYear = 0;
    const esppLimit = getESPPLimit();

    incomesWithEarningsTest.forEach(inc => {
        if (!(inc instanceof WorkIncome)) return;
        if (inc.esppContributionType === 'NONE') return;
        if (!inc.esppAccountId) return;

        const activeMultiplier = getIncomeActiveMultiplier(inc, year);
        if (activeMultiplier === 0) return;

        // Calculate annual ESPP contribution
        const annualContribution = inc.getAnnualESPPContribution() * activeMultiplier;
        if (annualContribution <= 0) return;

        // Find the linked ESPP account
        const esppAccount = accounts.find(acc => acc.id === inc.esppAccountId && acc instanceof ESPPAccount) as ESPPAccount | undefined;
        if (!esppAccount) {
            logs.push(`[WARN] ESPP account ${inc.esppAccountId} not found for ${inc.name}`);
            return;
        }

        // Model ESPP as 2 purchases per year (typical 6-month offering periods)
        // Each purchase uses half the annual contribution
        const purchaseContribution = annualContribution / 2;
        const stockGrowthRate = inc.esppExpectedStockGrowth / 100;

        for (let purchaseNum = 0; purchaseNum < 2; purchaseNum++) {
            // Calculate dates for this purchase
            const grantMonth = purchaseNum * 6; // Jan or Jul
            const purchaseMonth = grantMonth + 5; // Jun or Dec
            const grantDate = new Date(Date.UTC(year, grantMonth, 1));
            const purchaseDate = new Date(Date.UTC(year, purchaseMonth, 28));

            // Assume FMV at grant equals current stock price (normalized to $100 for simplicity)
            // The simulation grows the account value, so lots track relative purchase details
            const fmvAtGrant = 100;

            // Model stock growth over offering period (6 months)
            const growthOverPeriod = Math.pow(1 + stockGrowthRate, 0.5);  // 6 months = 0.5 years
            const fmvAtPurchase = fmvAtGrant * growthOverPeriod;

            // Calculate purchase price with lookback
            let basePriceForDiscount: number;
            if (inc.esppHasLookback) {
                // With lookback: discount applied to lower of grant or purchase price
                basePriceForDiscount = Math.min(fmvAtGrant, fmvAtPurchase);
            } else {
                // No lookback: discount applied to purchase price only
                basePriceForDiscount = fmvAtPurchase;
            }

            const discountPercent = inc.esppDiscountPercent / 100;
            const purchasePrice = basePriceForDiscount * (1 - discountPercent);
            const discountAmount = basePriceForDiscount - purchasePrice;

            // Calculate shares purchased
            const shares = purchaseContribution / purchasePrice;
            const fmvOfShares = shares * fmvAtPurchase;

            // Check against $25k FMV annual limit
            if (totalESPPFMVThisYear + fmvOfShares > esppLimit) {
                const remainingFMV = Math.max(0, esppLimit - totalESPPFMVThisYear);
                if (remainingFMV <= 0) {
                    logs.push(`[WARN] ESPP: ${inc.name} hit $25k annual limit - purchase skipped`);
                    continue;
                }
                // Reduce shares to stay within limit
                const reducedShares = remainingFMV / fmvAtPurchase;
                const reducedContribution = reducedShares * purchasePrice;
                logs.push(`[WARN] ESPP: ${inc.name} purchase reduced to stay within $25k limit`);

                // Create the lot with reduced shares
                const lot: ESPPLot = {
                    id: `LOT-${year}-${purchaseNum}-${inc.id}`,
                    grantDate,
                    purchaseDate,
                    fmvAtGrant,
                    fmvAtPurchase,
                    purchasePrice,
                    shares: reducedShares,
                    totalCost: reducedContribution,
                    discountAmount
                };

                // Track the inflow (using purchase price as the cost basis)
                userInflows[esppAccount.id] = (userInflows[esppAccount.id] || 0) + (reducedShares * fmvAtPurchase);
                totalESPPFMVThisYear += remainingFMV;

                // Store lot to be added later when accounts are updated
                if (!esppLots[esppAccount.id]) esppLots[esppAccount.id] = [];
                esppLots[esppAccount.id].push(lot);
            } else {
                // Create the lot
                const lot: ESPPLot = {
                    id: `LOT-${year}-${purchaseNum}-${inc.id}`,
                    grantDate,
                    purchaseDate,
                    fmvAtGrant,
                    fmvAtPurchase,
                    purchasePrice,
                    shares,
                    totalCost: purchaseContribution,
                    discountAmount
                };

                // Track the inflow at FMV (actual value added to account)
                userInflows[esppAccount.id] = (userInflows[esppAccount.id] || 0) + fmvOfShares;
                totalESPPFMVThisYear += fmvOfShares;

                // Store lot to be added later when accounts are updated
                if (!esppLots[esppAccount.id]) esppLots[esppAccount.id] = [];
                esppLots[esppAccount.id].push(lot);

                logs.push(`[FLOW] ESPP: ${inc.name} purchased ${shares.toFixed(2)} shares @ $${purchasePrice.toFixed(2)} (${(discountPercent * 100).toFixed(0)}% discount${inc.esppHasLookback ? ' + lookback' : ''})`);
            }
        }
    });

    // 5b. Pay down deficit debt FIRST (before priority allocations)
    // This ensures deficit debt is paid off before any other surplus allocations
    if (discretionaryCash > 0 && existingDeficitDebt && existingDeficitDebt.amount > 0) {
        const payment = Math.min(discretionaryCash, existingDeficitDebt.amount);
        discretionaryCash -= payment;
        deficitDebtPayment = payment;

        logs.push(`💵 Paid down $${payment.toLocaleString(undefined, { maximumFractionDigits: 0 })} of deficit debt`);

        if (existingDeficitDebt.amount - payment <= 0) {
            logs.push(`  Deficit debt fully paid off!`);
        } else {
            logs.push(`  Remaining deficit debt: $${(existingDeficitDebt.amount - payment).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }
    }

    // 5c. Priority Waterfall (Surplus Only)
    // Allocate any remaining surplus to priority accounts (works in both accumulation and retirement)
    // During retirement, this allows storing excess income (e.g., SS surplus) for future expense spikes
    if (discretionaryCash > 0) {
        assumptions.priorities.forEach((priority) => {
            // Only allocate if we actually have cash left
            if (discretionaryCash <= 0 || !priority.accountId) return;

            let amountToContribute = 0;

            if (priority.capType === 'FIXED') {
                const yearlyCap = (priority.capValue || 0) * 12;
                amountToContribute = Math.min(yearlyCap, discretionaryCash);
            }
            else if (priority.capType === 'REMAINDER') {
                amountToContribute = discretionaryCash;
            }
            else if (priority.capType === 'MAX') {
                amountToContribute = Math.min(priority.capValue || 0, discretionaryCash);
            }
            else if (priority.capType === 'MULTIPLE_OF_EXPENSES') {
                const monthlyExpenses = totalLivingExpenses / 12;
                const target = monthlyExpenses * (priority.capValue || 0);

                const targetAccount = accounts.find(acc => acc.id === priority.accountId);
                const currentBalance = targetAccount ? targetAccount.amount : 0;

                let growthRate = 0;
                if (targetAccount instanceof SavedAccount || targetAccount instanceof DebtAccount) {
                    growthRate = targetAccount.apr;
                } else if (targetAccount instanceof InvestedAccount) {
                    growthRate = assumptions.investments.returnRates.ror;
                }

                const expectedGrowth = currentBalance * (growthRate / 100);
                const needed = target - (currentBalance + expectedGrowth);

                amountToContribute = Math.max(0, Math.min(needed, discretionaryCash));
            }

            if (amountToContribute > 0) {
                discretionaryCash -= amountToContribute;
                // Priorities are user-driven, so they go to userInflows
                userInflows[priority.accountId] = (userInflows[priority.accountId] || 0) + amountToContribute;
                bucketDetail[priority.accountId] = (bucketDetail[priority.accountId] || 0) + amountToContribute;
                totalBucketAllocations += amountToContribute;
            }
        });
    }

    // 6. LINKED DATA (Mortgages/Loans)
    const linkedData = new Map<string, { balance: number; value?: number }>();
    nextExpenses.forEach(exp => {
        if (exp instanceof MortgageExpense && exp.linkedAccountId) {
            linkedData.set(exp.linkedAccountId, { balance: exp.loan_balance, value: exp.valuation });
        } else if (exp instanceof LoanExpense && exp.linkedAccountId) {
            linkedData.set(exp.linkedAccountId, { balance: exp.amount });
        }
    });

    // 7. GROW ACCOUNTS (The compounding)
    let nextAccounts: AnyAccount[] = accounts.map(acc => {
        const userIn = userInflows[acc.id] || 0;
        const employerIn = employerInflows[acc.id] || 0;
        const totalIn = userIn + employerIn;

        const linkedState = linkedData.get(acc.id);

        if (acc instanceof PropertyAccount) {
            let finalLoanBalance = linkedState?.balance;
            if (finalLoanBalance !== undefined && totalIn > 0) {
                finalLoanBalance = Math.max(0, finalLoanBalance - totalIn);
            }
            return acc.increment(assumptions, { newLoanBalance: finalLoanBalance, newValue: linkedState?.value });
        }

        // Handle DeficitDebtAccount BEFORE DebtAccount (since it extends DebtAccount)
        if (acc instanceof DeficitDebtAccount) {
            // Apply payment from earlier in the year
            const newBalance = Math.max(0, acc.amount - deficitDebtPayment);
            // Return null if paid off (will be filtered out below)
            return acc.increment(assumptions, newBalance);
        }

        if (acc instanceof DebtAccount) {
            let finalBalance = linkedState?.balance ?? (acc.amount * (1 + acc.apr / 100));
            // Inflow for debt means PAYMENT (reducing balance)
            if (totalIn > 0) finalBalance = Math.max(0, finalBalance - totalIn);
            return acc.increment(assumptions, finalBalance);
        }

        if (acc instanceof InvestedAccount) {
            // CHANGED: Pass user/employer streams separately to handle vesting
            // Pass returnOverride for Monte Carlo simulations
            // Pass conversion deposits for 5-year rule tracking
            const convAmount = conversionDeposits[acc.id] || 0;
            return acc.increment(assumptions, userIn, employerIn, returnOverride, convAmount, year);
        }

        if (acc instanceof SavedAccount) {
            return acc.increment(assumptions, totalIn);
        }

        if (acc instanceof ESPPAccount) {
            // Grow the account (stock appreciation), passing return override for Monte Carlo
            let grownAccount = acc.increment(assumptions, returnOverride);

            // Add any new lots from this year's ESPP purchases
            // Note: addLot handles adding the FMV to the account amount, so we don't
            // separately add totalIn (which would double-count the purchase value)
            const newLots = esppLots[acc.id] || [];
            if (newLots.length > 0) {
                for (const lot of newLots) {
                    grownAccount = grownAccount.addLot(lot);
                }
            }

            return grownAccount;
        }

        // Exhaustive check: all AnyAccount types are handled above
        // This ensures TypeScript will error if a new account type is added
        const _exhaustiveCheck: never = acc;
        return _exhaustiveCheck;
    });

    // Handle deficit debt: either update existing, add new, or remove
    if (existingDeficitDebt) {
        const finalDeficitDebtBalance = existingDeficitDebt.amount - deficitDebtPayment;
        const hasDeficitDebtInAccounts = nextAccounts.some(acc => acc.id === DEFICIT_DEBT_ID);

        if (finalDeficitDebtBalance > 0) {
            if (hasDeficitDebtInAccounts) {
                // Replace with correct balance (handles case where new deficit was added)
                nextAccounts = nextAccounts.map(acc =>
                    acc.id === DEFICIT_DEBT_ID
                        ? new DeficitDebtAccount(DEFICIT_DEBT_ID, DEFICIT_DEBT_NAME, finalDeficitDebtBalance)
                        : acc
                );
            } else {
                // Add new deficit debt account (wasn't in original accounts)
                nextAccounts = [...nextAccounts, new DeficitDebtAccount(DEFICIT_DEBT_ID, DEFICIT_DEBT_NAME, finalDeficitDebtBalance)];
            }
        } else {
            // Fully paid off - remove from accounts
            nextAccounts = nextAccounts.filter(acc => acc.id !== DEFICIT_DEBT_ID);
        }
    }

    // 8. SUMMARY STATS
    const trueUserSaved = totalGrossIncome - totalTax - totalInsuranceCost - totalLivingExpenses - discretionaryCash;

    // Filter out RMD incomes from the returned array - RMD should only appear as a withdrawal
    // (in withdrawalDetail), not as income. The RMD income objects were only needed internally
    // so Roth conversion could see RMD when calculating bracket headroom.
    const returnedIncomes = allIncomes.filter(inc =>
        !(inc instanceof PassiveIncome && inc.sourceType === 'RMD')
    );

    return {
        year,
        incomes: returnedIncomes, // Includes regular incomes and interest (but not RMD - that's in withdrawalDetail)
        expenses: nextExpenses,
        accounts: nextAccounts,
        cashflow: {
            totalIncome: totalGrossIncome,
            totalExpense: totalLivingExpenses + totalTax + preTaxDeductions + postTaxDeductions,
            discretionary: discretionaryCash,
            investedUser: trueUserSaved,
            investedMatch: totalEmployerMatch,
            totalInvested: trueUserSaved + totalEmployerMatch,
            bucketAllocations: totalBucketAllocations,
            bucketDetail: bucketDetail,
            withdrawals: totalWithdrawals,
            withdrawalDetail: withdrawalDetail
        },
        taxDetails: {
            fed: fedTax + withdrawalTaxes + withdrawalPenalties,
            state: stateTax,
            fica: ficaTax,
            preTax: preTaxDeductions - totalInsuranceCost,
            insurance: totalInsuranceCost,
            postTax: postTaxDeductions,
            capitalGains: capitalGainsTaxTotal
        },
        logs,
        strategyWithdrawal: strategyWithdrawalResult,
        strategyAdjustment: strategyAdjustmentResult,
        rothConversion: rothConversionResult,
        rmdDetails: rmdDetails
    };
}