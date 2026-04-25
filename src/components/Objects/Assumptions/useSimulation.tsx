import { simulateOneYear, SimulationYear } from './SimulationEngine';
import * as TaxService from '../../Objects/Taxes/TaxService';
import { WorkIncome, getIncomeActiveMultiplier } from '../Income/models';
import { AnyAccount, InvestedAccount } from '../Accounts/models';
import { AnyIncome } from '../Income/models';
import { AnyExpense } from '../Expense/models';
import { AssumptionsState, getLifeExpectancy, getBirthYear } from './AssumptionsContext';
import { TaxState } from '../Taxes/TaxContext';
import { BaselineProjections } from '../../../services/simulation/types';
import { getRMDStartAge } from '../../../data/RMDData';

/**
 * Extract baseline projections from a simulation run WITHOUT Roth conversions.
 * These projections capture the actual simulated values at RMD age, including:
 * - Traditional balance with all contributions, growth, and withdrawals
 * - SS income with COLA applied
 * - Pension income with COLA applied
 */
export function extractBaselineProjections(
    simulation: SimulationYear[],
    birthYear: number
): BaselineProjections | null {
    const rmdStartAge = getRMDStartAge(birthYear);
    const rmdYear = birthYear + rmdStartAge;

    const rmdYearData = simulation.find(y => y.year === rmdYear);
    if (!rmdYearData) {
        // RMD year is beyond simulation range
        return null;
    }

    // Sum Traditional balances from all Traditional accounts
    const traditionalBalanceAtRMD = rmdYearData.accounts
        .filter(acc => acc instanceof InvestedAccount &&
            (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA'))
        .reduce((sum, acc) => sum + (acc as InvestedAccount).amount, 0);

    // Get SS at RMD year (already has COLA applied by simulation)
    const ssAtRMD = TaxService.getSocialSecurityBenefits(rmdYearData.incomes, rmdYear);

    // Get pension at RMD year (already has COLA applied)
    const pensionAtRMD = rmdYearData.incomes
        .filter(inc =>
            (inc as any).className === 'FERSPensionIncome' ||
            (inc as any).className === 'CSRSPensionIncome' ||
            (inc as any).className === 'PensionIncome')
        .reduce((sum, inc) => sum + (inc.getAnnualAmount?.(rmdYear) ?? 0), 0);

    return { traditionalBalanceAtRMD, ssAtRMD, pensionAtRMD, rmdYear };
}

export const runSimulation = (
    yearsToRun: number = 30,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    yearlyReturns?: number[],
    referenceDate?: Date,
    baselineProjections?: BaselineProjections
): SimulationYear[] => {
        
    // Calculate start year and current age from birth year
    // If priorYearMode is enabled, start simulation from last year (for verified data entry)
    const currentYear = new Date().getFullYear();
    const startYear = assumptions.demographics.priorYearMode
        ? currentYear - 1
        : currentYear;
    const birthYear = getBirthYear(assumptions.milestones);
    const startAge = startYear - birthYear;

    // --- LIFE EXPECTANCY CAP ---
    // Calculate how many years the user actually has left (derived from End of Plan milestone)
    const lifeExpectancy = getLifeExpectancy(assumptions.milestones);
    const yearsUntilDeath = Math.max(0, lifeExpectancy - startAge);

    // Run for the requested time, OR until death—whichever comes first.
    const effectiveYearsToRun = Math.min(yearsToRun, yearsUntilDeath);

    const timeline: SimulationYear[] = [];

    // --- STEP 0.5: RESOLVE autoMax401k ON WORK INCOMES ---
    // When autoMax401k is 'traditional' or 'roth', the stored preTax401k/roth401k values
    // are the user's custom values, not the IRS-limit-capped values. Resolve them now
    // so Year 0 incomes have effective values for Sankey charts and partial-year adjustments.
    const resolvedIncomes: AnyIncome[] = incomes.map(inc => {
        if (inc instanceof WorkIncome && inc.autoMax401k !== 'custom') {
            const effective = inc.getEffective401k(startYear, startAge);
            if (effective.preTax !== inc.preTax401k || effective.roth !== inc.roth401k) {
                return new WorkIncome(
                    inc.id, inc.name, inc.amount, inc.frequency,
                    inc.earned_income, effective.preTax, inc.insurance,
                    effective.roth, inc.employerMatch, inc.matchAccountId,
                    inc.taxType, inc.contributionGrowthStrategy,
                    inc.startDate, inc.end_date, inc.hsaContribution,
                    inc.autoMax401k, inc.esppContributionType,
                    inc.esppContributionAmount, inc.esppDiscountPercent,
                    inc.esppHasLookback, inc.esppOfferingPeriodMonths,
                    inc.esppAccountId, inc.esppExpectedStockGrowth,
                    inc.pensionSystem, inc.startMilestoneId, inc.endMilestoneId
                );
            }
        }
        return inc;
    });

    // --- STEP 1: CREATE YEAR 0 (Baseline) ---
    // Note: Interest income is NOT included in Year 0 to allow users to match
    // their actual tax situation. Interest is generated starting in Year 1.

    // Calculate current baseline metrics using existing TaxService logic
    // Resolved incomes have effective 401k values baked in, so useStoredValue=true is safe
    const currentGross = TaxService.getGrossIncome(resolvedIncomes, startYear);
    const currentPreTax = TaxService.getPreTaxExemptions(resolvedIncomes, startYear, startAge, true);
    const currentPostTax = TaxService.getPostTaxExemptions(resolvedIncomes, startYear, startAge, true);
    const currentInsurance = resolvedIncomes.reduce((sum, inc) =>
        inc instanceof WorkIncome ? sum + inc.getProratedAnnual(inc.insurance, startYear) : sum, 0
    );

    const currentFed = TaxService.calculateFederalTaxFromIncomes(taxState, resolvedIncomes, expenses, 0, startYear, assumptions);
    const currentState = TaxService.calculateStateTax(taxState, resolvedIncomes, expenses, startYear, assumptions);
    const currentFica = TaxService.calculateFicaTax(taxState, resolvedIncomes, startYear, assumptions);
    const currentTotalTax = currentFed + currentState + currentFica;

    const currentLivingExpenses = expenses.reduce((sum, exp) => sum + exp.getAnnualAmount(startYear), 0);

    // For Year 0, discretionary is what's left over from your current input data
    const currentDiscretionary = currentGross - currentPreTax - currentPostTax - currentTotalTax - currentLivingExpenses;

    const yearZero: SimulationYear = {
        year: startYear,
        incomes: [...resolvedIncomes],
        expenses: [...expenses],
        accounts: [...accounts],
        cashflow: {
            totalIncome: currentGross,
            totalExpense: currentLivingExpenses + currentTotalTax + currentPreTax + currentPostTax,
            livingExpenses: currentLivingExpenses,
            discretionary: currentDiscretionary,
            // In Year 0, we treat the input as "Static", so invested is effectively 0 or the sum of payroll deductions
            investedUser: currentPreTax + currentPostTax - currentInsurance,
            investedMatch: resolvedIncomes.reduce((sum, inc) => inc instanceof WorkIncome ? sum + inc.getEffectiveAnnualEmployerMatch() : sum, 0),
            totalInvested: (currentPreTax + currentPostTax - currentInsurance) +
                            resolvedIncomes.reduce((sum, inc) => inc instanceof WorkIncome ? sum + inc.getEffectiveAnnualEmployerMatch() : sum, 0),
            bucketAllocations: 0,
            bucketDetail: {}, // Initialize empty for Year 0
            withdrawals: 0,
            withdrawalDetail: {}
        },
        taxDetails: {
            fed: currentFed,
            state: currentState,
            fica: currentFica,
            preTax: currentPreTax - currentInsurance,
            insurance: currentInsurance,
            postTax: currentPostTax,
            capitalGains: 0,
            withdrawalOrdinaryTax: 0,
            niit: 0
        },
        logs: ["Baseline Year 0 initialized from current context data."]
    };

    timeline.push(yearZero);

    // --- STEP 1.5: PARTIAL-YEAR ADJUSTMENT ---
    // Apply remaining fraction of current year's growth and contributions
    // so Year 1 starts from projected end-of-year balances, not today's balances.
    const refDate = referenceDate ?? new Date();
    const currentMonth = refDate.getMonth(); // 0=Jan, 11=Dec
    const remainingFraction = (11 - currentMonth) / 12; // Jan→11/12, Dec→0/12

    let adjustedAccounts: AnyAccount[] = [...yearZero.accounts];

    if (remainingFraction > 0 && !assumptions.demographics.priorYearMode) {
        // Calculate partial-year payroll contributions per account
        const partialContributions: Record<string, { user: number; employer: number }> = {};

        yearZero.incomes.forEach(inc => {
            if (inc instanceof WorkIncome && inc.matchAccountId) {
                const activeMultiplier = getIncomeActiveMultiplier(inc, startYear);
                // Overlap between remaining months and income's active period
                const effectiveFraction = Math.min(remainingFraction, activeMultiplier);
                if (effectiveFraction <= 0) return;

                const userContrib = (inc.preTax401k + inc.roth401k) * effectiveFraction;
                const employerContrib = inc.getEffectiveAnnualEmployerMatch() * effectiveFraction;

                const existing = partialContributions[inc.matchAccountId] || { user: 0, employer: 0 };
                partialContributions[inc.matchAccountId] = {
                    user: existing.user + userContrib,
                    employer: existing.employer + employerContrib,
                };
            }
        });

        // Apply partial-year contributions (no growth — Year 1 handles full-year growth)
        adjustedAccounts = adjustedAccounts.map(acc => {
            if (acc instanceof InvestedAccount) {
                const contribs = partialContributions[acc.id] || { user: 0, employer: 0 };
                if (contribs.user === 0 && contribs.employer === 0) return acc;

                const newAmount = acc.amount + contribs.user + contribs.employer;
                const newEmployerBalance = acc.employerBalance + contribs.employer;
                const newCostBasis = acc.costBasis + contribs.user + contribs.employer;

                return new InvestedAccount(
                    acc.id, acc.name, newAmount, newEmployerBalance,
                    acc.tenureYears, acc.expenseRatio, acc.taxType,
                    acc.isContributionEligible, acc.vestedPerYear, newCostBasis, acc.customROR,
                    acc.conversionHistory
                );
            }

            return acc;
        });
    }

    // --- STEP 1.75: INSERT END-OF-YEAR PROJECTION ---
    // Insert a synthetic data point representing projected balances at December 31 of the current year.
    // This prevents the "big jump" confusion between Year 0 (today) and Year 1 (end of next year).
    if (remainingFraction > 0 && !assumptions.demographics.priorYearMode) {
        const eoyYear: SimulationYear = {
            ...yearZero,
            accounts: adjustedAccounts,
            cashflow: {
                ...yearZero.cashflow,
                totalIncome: yearZero.cashflow.totalIncome * remainingFraction,
                totalExpense: yearZero.cashflow.totalExpense * remainingFraction,
                livingExpenses: yearZero.cashflow.livingExpenses * remainingFraction,
                investedUser: yearZero.cashflow.investedUser * remainingFraction,
                investedMatch: yearZero.cashflow.investedMatch * remainingFraction,
                totalInvested: yearZero.cashflow.totalInvested * remainingFraction,
                discretionary: yearZero.cashflow.discretionary * remainingFraction,
            },
            taxDetails: {
                ...yearZero.taxDetails,
                fed: yearZero.taxDetails.fed * remainingFraction,
                state: yearZero.taxDetails.state * remainingFraction,
                fica: yearZero.taxDetails.fica * remainingFraction,
            },
            isEndOfYearProjection: true,
            logs: [],
        };
        timeline.push(eoyYear);
    }

    // --- STEP 2: RUN FUTURE SIMULATION ---
    let currentIncomes = yearZero.incomes;
    let currentExpenses = yearZero.expenses;
    let currentAccounts: AnyAccount[] = adjustedAccounts;
    let previousActiveMilestones: string[] = [];
    let milestoneReachYears: Map<string, number> = new Map();

    // CHANGED: Use effectiveYearsToRun instead of yearsToRun
    for (let i = 1; i <= effectiveYearsToRun; i++) {
        const simulationYear = startYear + i;

        // Get return override for this year (if Monte Carlo mode)
        // yearlyReturns[0] is for year 1, yearlyReturns[1] is for year 2, etc.
        const returnOverride = yearlyReturns ? yearlyReturns[i - 1] : undefined;
        const result = simulateOneYear(
            simulationYear,
            currentIncomes,
            currentExpenses,
            currentAccounts,
            assumptions,
            taxState,
            timeline,  // Pass previous simulation history for SS calculation
            returnOverride,
            previousActiveMilestones,
            milestoneReachYears,
            baselineProjections
        );

        timeline.push(result);

        currentIncomes = result.incomes;
        currentExpenses = result.expenses;
        currentAccounts = result.accounts;
        previousActiveMilestones = result.activeMilestones || [];

        // Track when each milestone was first reached
        result.milestoneEvents?.forEach(event => {
            if (!milestoneReachYears.has(event.milestoneId)) {
                milestoneReachYears.set(event.milestoneId, event.yearReached);
            }
        });
    }

    return timeline;
};

/**
 * Run simulation with two-pass optimization for accurate Roth conversion decisions.
 *
 * Pass 1: Run WITHOUT Roth conversions to get accurate baseline projections
 *         (Traditional balance, SS, pension at RMD age with all contributions/COLA)
 *
 * Pass 2: Run WITH conversions, using Pass 1 projections to make informed decisions
 *
 * This produces more accurate conversion recommendations because it uses actual
 * simulated values instead of naive projections that miss future contributions,
 * COLA adjustments, and pre-RMD withdrawals.
 */
export const runSimulationWithOptimization = (
    yearsToRun: number = 30,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    yearlyReturns?: number[],
    referenceDate?: Date
): SimulationYear[] => {
    // Only do two-pass if tax optimization is enabled
    if (!assumptions.investments.taxOptimizationEnabled) {
        return runSimulation(
            yearsToRun, accounts, incomes, expenses, assumptions, taxState,
            yearlyReturns, referenceDate
        );
    }

    const birthYear = getBirthYear(assumptions.milestones);

    // PASS 1: Run WITHOUT Roth conversions to get baseline projections
    const baselineAssumptions: AssumptionsState = {
        ...assumptions,
        investments: {
            ...assumptions.investments,
            taxOptimizationEnabled: false,  // Disable conversions for baseline
            autoRothConversions: false,
        }
    };

    const baselineSimulation = runSimulation(
        yearsToRun, accounts, incomes, expenses, baselineAssumptions, taxState,
        yearlyReturns, referenceDate
    );

    // EXTRACT baseline projections from Pass 1
    const baselineProjections = extractBaselineProjections(baselineSimulation, birthYear);

    // PASS 2: Run WITH conversions, using baseline projections
    return runSimulation(
        yearsToRun, accounts, incomes, expenses, assumptions, taxState,
        yearlyReturns, referenceDate, baselineProjections ?? undefined
    );
};