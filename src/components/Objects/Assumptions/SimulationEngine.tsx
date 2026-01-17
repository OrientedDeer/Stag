// src/components/Simulation/SimulationEngine.ts
import { AnyAccount, DebtAccount, DeficitDebtAccount, InvestedAccount, PropertyAccount, SavedAccount } from "../../Objects/Accounts/models";
import { AnyExpense, LoanExpense, MortgageExpense } from "../Expense/models";
import { AnyIncome, WorkIncome, FutureSocialSecurityIncome, FERSPensionIncome, CSRSPensionIncome, PassiveIncome } from "../../Objects/Income/models";
import { calculateHigh3 } from "../../../data/PensionData";
import { calculateRMD, isAccountSubjectToRMD, isRMDRequired, RMDCalculation } from "../../../data/RMDData";
import { AssumptionsState } from "./AssumptionsContext";
import { TaxState } from "../../Objects/Taxes/TaxContext";
import * as TaxService from "../../Objects/Taxes/TaxService";
import { calculateAIME, extractEarningsFromSimulation, calculateEarningsTestReduction } from "../../../services/SocialSecurityCalculator";
import { getFRA } from "../../../data/SocialSecurityData";
import { calculateStrategyWithdrawal, WithdrawalResult, GuardrailTrigger } from "../../../services/WithdrawalStrategies";
import { getMedianRetirementTaxRate, getIncomeThresholdForRate } from "../../../services/TaxOptimizationService";

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
    previousSimulation: SimulationYear[],
    logs: string[]
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

    // Calculate current taxable income
    const grossIncome = TaxService.getGrossIncome(incomes, year);
    const preTaxDeductions = TaxService.getPreTaxExemptions(incomes, year);
    const taxableIncome = Math.max(0, grossIncome - preTaxDeductions);

    // Get retirement tax rate from previous simulation or use fallback
    const retirementAge = assumptions.demographics.retirementAge;
    const currentYear = new Date().getFullYear();
    const startYear = assumptions.demographics.priorYearMode
        ? currentYear - 1
        : currentYear;
    const startAge = startYear - assumptions.demographics.birthYear;
    const retirementYear = startYear + (retirementAge - startAge);

    // Minimum target rate: always fill at least to the 22% bracket
    // This ensures we do conversions even when calculated effective retirement rate is low
    const MIN_CONVERSION_TARGET_RATE = 0.22;

    // Use the higher of: minimum target rate OR calculated retirement effective rate
    // This way, if someone has high retirement income (25% effective rate), we'd target 25%
    let retirementTaxRate = MIN_CONVERSION_TARGET_RATE;
    if (previousSimulation.length >= 5) {
        const calculatedRate = getMedianRetirementTaxRate(previousSimulation, retirementYear);
        retirementTaxRate = Math.max(MIN_CONVERSION_TARGET_RATE, calculatedRate);
    }

    // Get current marginal rate
    const marginalInfo = TaxService.getMarginalTaxRate(taxableIncome, fedParams);

    // Only convert if current marginal rate is below target rate
    // This ensures we fill up lower brackets before hitting the target
    if (marginalInfo.rate >= retirementTaxRate) {
        return undefined;
    }

    // Calculate optimal conversion amount (fill brackets up to retirement rate)
    const targetIncomeThreshold = getIncomeThresholdForRate(retirementTaxRate, fedParams);
    const optimalAmount = Math.max(0, targetIncomeThreshold - taxableIncome);

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

        const availableBalance = tradAccount.amount;
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

    // Calculate tax cost on the conversion
    const taxBefore = TaxService.calculateTax(taxableIncome, 0, {
        ...fedParams,
        standardDeduction: 0
    });
    const taxAfter = TaxService.calculateTax(taxableIncome + totalConverted, 0, {
        ...fedParams,
        standardDeduction: 0
    });
    const taxCost = taxAfter - taxBefore;

    logs.push(`  From: ${Object.entries(fromAccounts).map(([name, amt]) => `${name}: $${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(', ')}`);
    logs.push(`  To: ${Object.entries(toAccounts).map(([name, amt]) => `${name}: $${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(', ')}`);

    return {
        amount: totalConverted,
        taxCost,
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

    // Filter out previous year's interest income - it's regenerated fresh based on current account balances
    const regularIncomes = incomes.filter(inc => {
        if (inc instanceof PassiveIncome && inc.sourceType === 'Interest') {
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
                        // Calculate benefit with actual High-3
                        const actualBenefit = (inc.retirementAge >= 62 && inc.yearsOfService >= 20 ? 0.011 : 0.01)
                            * inc.yearsOfService * high3;
                        logs.push(`🏛️ FERS Pension started: High-3 calculated as $${high3.toLocaleString()}/yr from ${salaryHistory.length} years of salary history`);
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
                        // Calculate CSRS benefit with actual High-3
                        let actualBenefit = 0;
                        const first5 = Math.min(inc.yearsOfService, 5);
                        actualBenefit += first5 * high3 * 0.015;
                        if (inc.yearsOfService > 5) {
                            const next5 = Math.min(inc.yearsOfService - 5, 5);
                            actualBenefit += next5 * high3 * 0.0175;
                        }
                        if (inc.yearsOfService > 10) {
                            const remaining = inc.yearsOfService - 10;
                            actualBenefit += remaining * high3 * 0.02;
                        }
                        actualBenefit = Math.min(actualBenefit, high3 * 0.80); // Cap at 80%

                        logs.push(`🏛️ CSRS Pension started: High-3 calculated as $${high3.toLocaleString()}/yr from ${salaryHistory.length} years of salary history`);
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
                    const inflationAdjusted = assumptions.macro.inflationAdjusted;
                    const earningsHistory = extractEarningsFromSimulation(
                        previousSimulation,
                        assumptions.demographics.priorEarnings,
                        inflationAdjusted
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
                    logs.push(`⚠️ Error calculating Social Security benefits: ${error}`);
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

                    logs.push(`⚠️ Earnings test applied: SS benefit reduced from $${(annualSSBenefit/12).toFixed(2)}/month to $${monthlyReduced.toFixed(2)}/month`);
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
                logs.push(`📈 Lifestyle creep: Salary raise of $${totalRaise.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr → Discretionary expenses increased by $${lifestyleCreepAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr (${assumptions.expenses.lifestyleCreep}%)`);
            }
        }
    }

    // ------------------------------------------------------------------
    // GUYTON-KLINGER EXPENSE ADJUSTMENT (Must happen BEFORE expenses are summed)
    // ------------------------------------------------------------------
    let strategyWithdrawalResult: WithdrawalResult | undefined;
    let strategyAdjustmentResult: SimulationYear['strategyAdjustment'] | undefined;

    if (isRetired && assumptions.investments.withdrawalStrategy === 'Guyton Klinger') {
        // Calculate total invested assets (for withdrawal calculations)
        const totalInvestedAssets = accounts.reduce((sum, acc) => {
            if (acc instanceof InvestedAccount || acc instanceof SavedAccount) {
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

        logs.push(`📊 Retirement withdrawal strategy: Guyton Klinger`);
        logs.push(`  Target withdrawal: $${strategyWithdrawalResult.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        logs.push(`  Portfolio value: $${totalInvestedAssets.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        logs.push(`  Effective rate: ${((strategyWithdrawalResult.amount / totalInvestedAssets) * 100).toFixed(2)}%`);

        // Check if a guardrail was triggered
        if (strategyWithdrawalResult.guardrailTriggered !== 'none') {
            const adjustmentPercent = assumptions.investments.gkAdjustmentPercent / 100;
            const baseWithdrawal = strategyWithdrawalResult.baseAmount;
            const requiredAdjustment = baseWithdrawal * adjustmentPercent;

            // Calculate total discretionary expenses
            const discretionaryExpenses = nextExpenses.filter(exp => exp.isDiscretionary);
            const totalDiscretionary = discretionaryExpenses.reduce((sum, exp) => {
                if (exp instanceof MortgageExpense) {
                    return sum + exp.calculateAnnualAmortization(year).totalPayment;
                }
                if (exp instanceof LoanExpense) {
                    return sum + exp.calculateAnnualAmortization(year).totalPayment;
                }
                return sum + exp.getAnnualAmount(year);
            }, 0);

            let actualAdjustment = 0;
            let warning: string | undefined;

            if (strategyWithdrawalResult.guardrailTriggered === 'capital-preservation') {
                // Need to CUT discretionary expenses
                if (requiredAdjustment > totalDiscretionary) {
                    // Can't cut enough - apply what we can and warn
                    actualAdjustment = totalDiscretionary;
                    warning = `Guyton-Klinger Capital Preservation requires cutting $${requiredAdjustment.toLocaleString(undefined, { maximumFractionDigits: 0 })}, but only $${totalDiscretionary.toLocaleString(undefined, { maximumFractionDigits: 0 })} in discretionary expenses available. Consider marking more expenses as discretionary or choosing a different strategy.`;
                    logs.push(`⚠️ GK Capital Preservation: Cannot fully apply 10% cut`);
                    logs.push(`  Required: $${requiredAdjustment.toLocaleString(undefined, { maximumFractionDigits: 0 })}, Available: $${totalDiscretionary.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
                } else {
                    actualAdjustment = requiredAdjustment;
                    logs.push(`📉 GK Capital Preservation triggered: Cutting discretionary expenses by $${actualAdjustment.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
                }

                // Apply proportional cut to discretionary expenses
                if (actualAdjustment > 0 && totalDiscretionary > 0) {
                    const cutRatio = 1 - (actualAdjustment / totalDiscretionary);
                    nextExpenses = nextExpenses.map(exp => {
                        if (exp.isDiscretionary) {
                            return exp.adjustAmount(cutRatio);
                        }
                        return exp;
                    });
                }
            } else if (strategyWithdrawalResult.guardrailTriggered === 'prosperity') {
                // INCREASE discretionary expenses
                actualAdjustment = requiredAdjustment;
                logs.push(`📈 GK Prosperity triggered: Increasing discretionary expenses by $${actualAdjustment.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

                // Apply proportional increase to discretionary expenses
                if (totalDiscretionary > 0) {
                    const increaseRatio = 1 + (actualAdjustment / totalDiscretionary);
                    nextExpenses = nextExpenses.map(exp => {
                        if (exp.isDiscretionary) {
                            return exp.adjustAmount(increaseRatio);
                        }
                        return exp;
                    });
                } else {
                    // No discretionary expenses to increase - just log it
                    logs.push(`  Note: No discretionary expenses to increase`);
                    actualAdjustment = 0;
                }
            }

            strategyAdjustmentResult = {
                guardrailTriggered: strategyWithdrawalResult.guardrailTriggered,
                requiredAdjustment,
                actualAdjustment,
                discretionaryAvailable: totalDiscretionary,
                warning,
            };
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
    // AUTO ROTH CONVERSIONS (during retirement)
    // ------------------------------------------------------------------
    let rothConversionResult: SimulationYear['rothConversion'] = undefined;

    if (isRetired && assumptions.investments.autoRothConversions) {
        const conversionResult = performAutoRothConversion(
            accounts,
            allIncomes,
            nextExpenses,
            year,
            assumptions,
            taxState,
            previousSimulation,
            logs
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

    // 3. LIVING EXPENSES (The Bills)
    const totalLivingExpenses = nextExpenses.reduce((sum, exp) => {
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
    // RETIREMENT WITHDRAWAL STRATEGY (for non-GK strategies)
    // Note: Guyton-Klinger is handled earlier so it can adjust expenses
    // ------------------------------------------------------------------
    if (isRetired && assumptions.investments.withdrawalStrategy !== 'Guyton Klinger') {
        // Calculate total invested assets (for withdrawal calculations)
        const totalInvestedAssets = accounts.reduce((sum, acc) => {
            if (acc instanceof InvestedAccount || acc instanceof SavedAccount) {
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

        logs.push(`📊 Retirement withdrawal strategy: ${assumptions.investments.withdrawalStrategy}`);
        logs.push(`  Target withdrawal: $${strategyWithdrawalResult.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        logs.push(`  Portfolio value: $${totalInvestedAssets.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        logs.push(`  Effective rate: ${((strategyWithdrawalResult.amount / totalInvestedAssets) * 100).toFixed(2)}%`);
    }

    // ------------------------------------------------------------------
    // WITHDRAWAL LOGIC (Deficit Manager)
    // ------------------------------------------------------------------

    // CHANGED: Split inflows into User vs Employer to support vesting tracking
    const userInflows: Record<string, number> = {};
    const employerInflows: Record<string, number> = {};
    let withdrawalTaxes = 0;
    let capitalGainsTaxTotal = 0; // Track capital gains tax separately for display
    let strategyWithdrawalExecuted = 0;
    let totalWithdrawals = 0;
    const withdrawalDetail: Record<string, number> = {}; // Track by account name for display

    // Apply Roth conversion flows (if any)
    // Withdrawals from Traditional accounts (negative) and deposits to Roth accounts (positive)
    if (rothConversionResult) {
        for (const [accountId, amount] of Object.entries(rothConversionResult.fromAccountIds)) {
            userInflows[accountId] = (userInflows[accountId] || 0) - amount; // Negative = withdrawal
        }
        for (const [accountId, amount] of Object.entries(rothConversionResult.toAccountIds)) {
            userInflows[accountId] = (userInflows[accountId] || 0) + amount; // Positive = deposit
        }
    }

    // ------------------------------------------------------------------
    // REQUIRED MINIMUM DISTRIBUTIONS (RMD)
    // ------------------------------------------------------------------
    // RMDs must be taken from Traditional accounts starting at age 72-75 depending on birth year
    // The RMD amount is based on the PRIOR year's ending balance divided by life expectancy factor
    const birthYearForRMD = assumptions.demographics.birthYear;
    const rmdRequired = isRMDRequired(currentAge, birthYearForRMD);
    let rmdDetails: SimulationYear['rmdDetails'] = undefined;
    let rmdTaxTotal = 0;
    let rmdCashReceived = 0; // Net cash after tax from RMD withdrawals

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
                // Calculate tax on RMD withdrawal (treated as ordinary income)
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

                // Calculate tax on the RMD amount
                const fedApplied = { ...fedParams!, standardDeduction: currentFedDeduction };
                const stateApplied = { ...stateParams!, standardDeduction: currentStateDeduction };

                const fedBase = TaxService.calculateTax(currentFedIncome, 0, fedApplied);
                const fedNew = TaxService.calculateTax(currentFedIncome + actualWithdrawal, 0, fedApplied);
                const stateBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                const stateNew = TaxService.calculateTax(currentStateIncome + actualWithdrawal, 0, stateApplied);

                const rmdTax = (fedNew - fedBase) + (stateNew - stateBase);
                rmdTaxTotal += rmdTax;
                totalGrossIncome += actualWithdrawal;

                // Apply withdrawal to account
                userInflows[account.id] = (userInflows[account.id] || 0) - actualWithdrawal;
                totalRMDWithdrawn += actualWithdrawal;

                // Track net cash received from RMD
                const netCash = actualWithdrawal - rmdTax;
                rmdCashReceived += netCash;

                // Track in withdrawal details
                totalWithdrawals += actualWithdrawal;
                withdrawalDetail[account.name] = (withdrawalDetail[account.name] || 0) + actualWithdrawal;

                logs.push(`📋 RMD from ${account.name}: $${actualWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })} (Tax: $${rmdTax.toLocaleString(undefined, { maximumFractionDigits: 0 })})`);
            }
        }

        // Calculate shortfall and penalty
        const shortfall = Math.max(0, totalRMDRequired - totalRMDWithdrawn);
        const penalty = shortfall * 0.25; // 25% penalty on shortfall (SECURE Act 2.0)

        if (shortfall > 0) {
            logs.push(`⚠️ RMD shortfall: $${shortfall.toLocaleString(undefined, { maximumFractionDigits: 0 })} - Penalty: $${penalty.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }

        rmdDetails = {
            totalRMD: totalRMDRequired,
            totalWithdrawn: totalRMDWithdrawn,
            accountBreakdown: rmdCalculations,
            shortfall: shortfall,
            penalty: penalty
        };

        // Add RMD tax and penalty to total tax
        totalTax += rmdTaxTotal + penalty;
    }

    // RMD cash helps cover the deficit (net of tax)
    // Increase discretionary cash by the net RMD amount received
    discretionaryCash += rmdCashReceived;

    // Calculate deficit - only withdraw what's needed to cover expenses
    // The strategy result is tracked for informational purposes but we only
    // withdraw to cover actual deficits, not the full strategy amount
    const deficitAmount = discretionaryCash < 0 ? Math.abs(discretionaryCash) : 0;
    let amountToWithdraw = deficitAmount;

    if (amountToWithdraw > 0) {
        let deficit = amountToWithdraw;

        // Loop through Withdrawal Strategy
        const strategy = assumptions.withdrawalStrategy || [];

        for (const bucket of strategy) {
            if (deficit <= 0.01) break;

            const account = accounts.find(acc => acc.id === bucket.accountId);
            if (!account) continue;

            let availableBalance = account.amount;
            if (account instanceof InvestedAccount) {
                availableBalance = account.vestedAmount; // Use the getter from models.tsx
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
                    // Roth follows "ordering rules": contributions first, then conversions, then gains
                    // Simplified: withdraw from cost basis first (tax-free), then gains (taxable)
                    const costBasis = account.costBasis;
                    const accountGains = account.unrealizedGains;

                    // How much can we withdraw tax-free from contributions?
                    const taxFreeWithdrawal = Math.min(deficit, costBasis, availableBalance);
                    let remainingDeficit = deficit - taxFreeWithdrawal;

                    if (remainingDeficit > 0 && accountGains > 0) {
                        // Need to dip into gains - these are taxed + 10% penalty
                        // Use solver to find gross gains withdrawal needed to net remainingDeficit
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
                            remainingDeficit,
                            currentFedIncome,
                            currentFedDeduction,
                            currentStateIncome,
                            currentStateDeduction,
                            taxState,
                            year,
                            assumptions,
                            0.10 // 10% early withdrawal penalty
                        );

                        // Cap gross gains at available gains
                        const grossGainsWithdrawal = Math.min(gainsResult.grossWithdrawn, accountGains, availableBalance - taxFreeWithdrawal);

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

                        logs.push(`⚠️ Early Roth withdrawal: $${grossGainsWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })} gains taxed + 10% penalty`);

                        withdrawAmount = taxFreeWithdrawal + grossGainsWithdrawal;
                        const netFromGains = grossGainsWithdrawal - taxOnGains - earlyPenalty;
                        deficit -= (taxFreeWithdrawal + netFromGains);
                    } else {
                        // All from contributions - completely tax-free
                        withdrawAmount = taxFreeWithdrawal;
                        deficit -= taxFreeWithdrawal;
                    }
                } else {
                    // Normal tax-free withdrawal (qualified Roth, HSA, or SavedAccount)
                    withdrawAmount = Math.min(deficit, availableBalance);
                    deficit -= withdrawAmount;
                }
            }
            
            
            // SCENARIO 2: Pre-Tax (Traditional 401k/IRA)
            else if (account instanceof InvestedAccount && (account.taxType === 'Traditional 401k' || account.taxType === 'Traditional IRA')) {
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
                    Math.min(deficit, availableBalance),
                    currentFedIncome,
                    currentFedDeduction,
                    currentStateIncome,
                    currentStateDeduction,
                    taxState,
                    year,
                    assumptions,
                    penaltyRate
                );

                // Overdraft Check
                if (result.grossWithdrawn > availableBalance) {
                    withdrawAmount = availableBalance;

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
                    logs.push(`📈 Brokerage withdrawal: $${grossWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })} ` +
                        `(Basis: $${allocation.basis.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                        `Gains: $${allocation.gains.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                        `Cap Gains Tax: $${taxHit.toLocaleString(undefined, { maximumFractionDigits: 0 })})`);
                }
            }
            // SCENARIO 4: Fallback for any other account type
            // Treat as simple withdrawal (no tax calculation - covers edge cases)
            else {
                withdrawAmount = Math.min(deficit, availableBalance);
                deficit -= withdrawAmount;
                logs.push(`⚠️ Fallback withdrawal from ${account.name}: ${withdrawAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
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

        logs.push(`⚠️ Uncovered deficit of $${uncoveredDeficit.toLocaleString(undefined, { maximumFractionDigits: 0 })} added to deficit debt`);
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
            const currentSelf = userInflows[inc.matchAccountId] || 0;
            const currentMatch = employerInflows[inc.matchAccountId] || 0;

            const selfContribution = inc.preTax401k + inc.roth401k;
            const employerMatch = inc.employerMatch;
            
            totalEmployerMatch += employerMatch;
            
            // CHANGED: Separate the streams so InvestedAccount can track vesting
            userInflows[inc.matchAccountId] = currentSelf + selfContribution;
            employerInflows[inc.matchAccountId] = currentMatch + employerMatch;
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
            return acc.increment(assumptions, userIn, employerIn, returnOverride);
        }

        if (acc instanceof SavedAccount) {
            return acc.increment(assumptions, totalIn);
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

    return {
        year,
        incomes: allIncomes, // Includes both regular incomes and interest income
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