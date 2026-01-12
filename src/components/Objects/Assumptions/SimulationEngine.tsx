// src/components/Simulation/SimulationEngine.ts
import { AnyAccount, DebtAccount, InvestedAccount, PropertyAccount, SavedAccount } from "../../Objects/Accounts/models";
import { AnyExpense, LoanExpense, MortgageExpense } from "../Expense/models";
import { AnyIncome, WorkIncome, FutureSocialSecurityIncome, PassiveIncome } from "../../Objects/Income/models";
import { AssumptionsState } from "./AssumptionsContext";
import { TaxState } from "../../Objects/Taxes/TaxContext";
import * as TaxService from "../../Objects/Taxes/TaxService";
import { calculateAIME, extractEarningsFromSimulation, calculateEarningsTestReduction } from "../../../services/SocialSecurityCalculator";
import { getFRA } from "../../../data/SocialSecurityData";
import { calculateStrategyWithdrawal, WithdrawalResult } from "../../../services/WithdrawalStrategies";

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
    const currentAge = assumptions.demographics.startAge + (year - assumptions.demographics.startYear);
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
            const retirementYear = assumptions.demographics.startYear +
                (assumptions.demographics.retirementAge - assumptions.demographics.startAge);

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

        if (inc instanceof FutureSocialSecurityIncome) {
            // If user has reached claiming age and PIA hasn't been calculated yet
            if (currentAge === inc.claimingAge && inc.calculatedPIA === 0) {
                try {
                    // Extract earnings from all previous simulation years
                    const earningsHistory = extractEarningsFromSimulation(previousSimulation);

                    // Calculate AIME/PIA based on top 35 years
                    // Use inflation rate as wage growth rate (wages typically track inflation)
                    const birthYear = assumptions.demographics.startYear - assumptions.demographics.startAge;
                    const wageGrowthRate = assumptions.macro.inflationRate / 100;
                    const aimeCalc = calculateAIME(earningsHistory, year, inc.claimingAge, birthYear, wageGrowthRate);

                    // Set end date to life expectancy
                    const endDate = new Date(Date.UTC(
                        assumptions.demographics.startYear + (assumptions.demographics.lifeExpectancy - assumptions.demographics.startAge),
                        0, 1
                    ));

                    logs.push(`Social Security benefits calculated: $${aimeCalc.adjustedBenefit.toFixed(2)}/month at age ${inc.claimingAge}`);
                    logs.push(`  AIME: $${aimeCalc.aime.toFixed(2)}, PIA: $${aimeCalc.pia.toFixed(2)}`);

                    // Create new income with calculated PIA
                    return new FutureSocialSecurityIncome(
                        inc.id,
                        inc.name,
                        inc.claimingAge,
                        aimeCalc.adjustedBenefit,
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

        return inc.increment(assumptions);
    });

    // Apply earnings test to FutureSocialSecurityIncome if claiming before FRA
    const incomesWithEarningsTest = nextIncomes.map(inc => {
        if (inc instanceof FutureSocialSecurityIncome && inc.calculatedPIA > 0) {
            const birthYear = assumptions.demographics.startYear - assumptions.demographics.startAge;
            const fra = getFRA(birthYear);

            // Only apply test if before FRA
            if (currentAge < fra) {
                const earnedIncome = TaxService.getEarnedIncome(nextIncomes, year);
                const annualSSBenefit = inc.getProratedAnnual(inc.amount, year);
                const wageGrowthRate = assumptions.macro.inflationRate / 100;

                const earningsTest = calculateEarningsTestReduction(
                    annualSSBenefit,
                    earnedIncome,
                    currentAge,
                    fra,
                    year,
                    wageGrowthRate
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

    const nextExpenses = expenses.map(exp => exp.increment(assumptions));

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
                    new Date(`${year}-12-31`)
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
    // Formula: Gross - PreTax(401k/HSA/Insurance) - PostTax(Roth) - Taxes - Bills
    let discretionaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions - totalTax - totalLivingExpenses;
    let withdrawalPenalties = 0;

    // ------------------------------------------------------------------
    // RETIREMENT WITHDRAWAL STRATEGY
    // ------------------------------------------------------------------
    let strategyWithdrawalResult: WithdrawalResult | undefined;

    if (isRetired) {
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
        const retirementStartYear = assumptions.demographics.startYear +
            (assumptions.demographics.retirementAge - assumptions.demographics.startAge);
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
            console.log(`Deficit of $${deficit.toFixed(4)} treated as zero due to floating point precision.`);
            deficit = 0;
        }

        // Update discretionary cash:
        // - If we covered the deficit, discretionaryCash becomes 0
        // - If we couldn't fully cover deficit, discretionaryCash stays negative
        discretionaryCash = -deficit;

        if (isRetired && strategyWithdrawalExecuted > 0) {
            logs.push(`💰 Strategy withdrawal executed: $${strategyWithdrawalExecuted.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }
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

    // 5b. Priority Waterfall (Surplus Only) - ONLY DURING ACCUMULATION PHASE
    // In retirement, we don't accumulate - we only withdraw enough for expenses
    if (!isRetired) {
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
    const nextAccounts = accounts.map(acc => {
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
        strategyWithdrawal: strategyWithdrawalResult
    };
}