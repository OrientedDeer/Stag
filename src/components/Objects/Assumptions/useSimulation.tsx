import { simulateOneYear, SimulationYear } from './SimulationEngine';
import * as TaxService from '../../Objects/Taxes/TaxService';
import { WorkIncome, getIncomeActiveMultiplier } from '../Income/models';
import { AnyAccount, InvestedAccount } from '../Accounts/models';
import { AnyIncome } from '../Income/models';
import { AnyExpense } from '../Expense/models';
import { AssumptionsState, getLifeExpectancy, getBirthYear, getRetirementAge } from './AssumptionsContext';
import { TaxState } from '../Taxes/TaxContext';
import { BaselineProjections } from '../../../services/simulation/types';
import { getRMDStartAge } from '../../../data/RMDData';
import { buildDPYearContexts, planConversionsViaDP, DPPlan } from '../../../services/simulation/RothConversionDP';

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

    // Get passive income at RMD year (rental, dividends, interest — excludes RMD-sourced).
    // This matches the filter YearSolver uses for current-year passive, so the projection
    // is consistent with what the ceiling calculator expects.
    const passiveAtRMD = rmdYearData.incomes
        .filter(inc =>
            (inc as any).className === 'PassiveIncome' &&
            (inc as any).sourceType !== 'RMD')
        .reduce((sum, inc) => sum + (inc.getAnnualAmount?.(rmdYear) ?? 0), 0);

    return { traditionalBalanceAtRMD, ssAtRMD, pensionAtRMD, passiveAtRMD, rmdYear };
}

/**
 * Per-year forward projection sub-simulation.
 *
 * Runs from `currentSimYear` forward to the user's RMD year, doing only
 * standard-deduction-headroom (0% bracket) Roth conversions. Returns the
 * BaselineProjections snapshot at RMD year, which the main sim feeds into
 * the rate-match algorithm so that "future marginal rate at RMD" is
 * decoupled from the live, depleting Traditional balance.
 *
 * Capped at the RMD year per user direction — only `traditionalBalanceAtRMD`
 * (and SS/pension/passive at RMD) feed back into the main sim, so projecting
 * past that point is wasted work.
 *
 * Recursion guard: this sub-sim runs in 'std-ded-only' mode, which makes
 * `calculateDynamicConversionCeiling` short-circuit and never re-enter
 * `runProjectionSubsim`.
 */
function runProjectionSubsim(
    currentSimYear: number,
    currentAccounts: AnyAccount[],
    currentIncomes: AnyIncome[],
    currentExpenses: AnyExpense[],
    timelineSoFar: SimulationYear[],
    previousActiveMilestones: string[],
    milestoneReachYears: Map<string, number>,
    assumptions: AssumptionsState,
    taxState: TaxState,
    birthYear: number,
): BaselineProjections | undefined {
    const rmdYear = birthYear + getRMDStartAge(birthYear);
    const yearsToProject = rmdYear - currentSimYear;
    if (yearsToProject <= 0) return undefined;

    // Shallow-copy in-flight collections so the sub-sim doesn't mutate main-sim
    // state (account `amount` etc. are mutated in place by simulateOneYear).
    const subTimeline: SimulationYear[] = [...timelineSoFar];
    runSimulationLoop({
        previousSimYear: currentSimYear,
        yearsToRun: yearsToProject,
        currentAccounts: [...currentAccounts],
        currentIncomes: [...currentIncomes],
        currentExpenses: [...currentExpenses],
        timeline: subTimeline,
        previousActiveMilestones: [...previousActiveMilestones],
        milestoneReachYears: new Map(milestoneReachYears),
        assumptions,
        taxState,
        conversionMode: 'std-ded-only',
        // No baselineProvider — std-ded-only mode short-circuits rate-match,
        // so a baseline projection would be unused. This also breaks any
        // theoretical recursion.
    });

    return extractBaselineProjections(subTimeline, birthYear) ?? undefined;
}

/**
 * Per-year loop body extracted from `runSimulation`. Lets the main sim and
 * `runProjectionSubsim` share the same iteration logic without re-running
 * year-0 setup (year-0 synthesis, partial-year payroll, EOY projection
 * injection) on mid-trajectory state.
 */
function runSimulationLoop(args: {
    previousSimYear: number;
    yearsToRun: number;
    currentAccounts: AnyAccount[];
    currentIncomes: AnyIncome[];
    currentExpenses: AnyExpense[];
    timeline: SimulationYear[];
    previousActiveMilestones: string[];
    milestoneReachYears: Map<string, number>;
    assumptions: AssumptionsState;
    taxState: TaxState;
    yearlyReturns?: number[];
    conversionMode: 'rate-match' | 'std-ded-only';
    baselineProvider?: (
        simulationYear: number,
        currentAccounts: AnyAccount[],
        currentIncomes: AnyIncome[],
        currentExpenses: AnyExpense[],
        timeline: SimulationYear[],
        previousActiveMilestones: string[],
        milestoneReachYears: Map<string, number>,
    ) => BaselineProjections | undefined;
    /** Pre-solved DP conversion plan; keyed by simulation year. */
    dpConversionPlan?: Map<number, number>;
    /** Per-year DP solver debug strings; keyed by simulation year. */
    dpDebugByYear?: Map<number, string[]>;
}): void {
    let { currentAccounts, currentIncomes, currentExpenses, previousActiveMilestones } = args;
    const { milestoneReachYears, timeline, assumptions, taxState, yearlyReturns,
            previousSimYear, yearsToRun, conversionMode, baselineProvider, dpConversionPlan, dpDebugByYear } = args;

    for (let i = 1; i <= yearsToRun; i++) {
        const simulationYear = previousSimYear + i;
        const returnOverride = yearlyReturns ? yearlyReturns[i - 1] : undefined;

        const baseline = baselineProvider?.(
            simulationYear, currentAccounts, currentIncomes, currentExpenses,
            timeline, previousActiveMilestones, milestoneReachYears,
        );

        const result = simulateOneYear(
            simulationYear,
            currentIncomes,
            currentExpenses,
            currentAccounts,
            assumptions,
            taxState,
            timeline,
            returnOverride,
            previousActiveMilestones,
            milestoneReachYears,
            baseline,
            conversionMode,
            dpConversionPlan,
            dpDebugByYear,
        );

        timeline.push(result);

        currentIncomes = result.incomes;
        currentExpenses = result.expenses;
        currentAccounts = result.accounts;
        previousActiveMilestones = result.activeMilestones || [];

        result.milestoneEvents?.forEach(event => {
            if (!milestoneReachYears.has(event.milestoneId)) {
                milestoneReachYears.set(event.milestoneId, event.yearReached);
            }
        });
    }
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
    conversionMode: 'rate-match' | 'std-ded-only' = 'rate-match',
    useRollingBaseline: boolean = false,
    dpConversionPlan?: Map<number, number>,
    dpDebugByYear?: Map<number, string[]>,
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
                earlyWithdrawalPenalty: (yearZero.taxDetails.earlyWithdrawalPenalty ?? 0) * remainingFraction,
                longTermCapitalGains: (yearZero.taxDetails.longTermCapitalGains ?? 0) * remainingFraction,
            },
            isEndOfYearProjection: true,
            logs: [],
        };
        timeline.push(eoyYear);
    }

    // --- STEP 2: RUN FUTURE SIMULATION ---
    // Build the rolling baseline provider when in rate-match mode and rolling
    // baselines are requested (used by `runSimulationWithOptimization`). Each
    // year, the provider runs a forward sub-sim from the in-flight state to RMD
    // year doing only std-ded-headroom conversions, then extracts baseline
    // projections to feed into the rate-match conversion ceiling. This decouples
    // "future marginal at RMD" from the live, depleting Trad balance.
    const rmdYear = birthYear + getRMDStartAge(birthYear);
    const baselineProvider = useRollingBaseline
        && conversionMode === 'rate-match'
        && assumptions.investments.taxOptimizationEnabled
        ? (
            simulationYear: number,
            subAccounts: AnyAccount[],
            subIncomes: AnyIncome[],
            subExpenses: AnyExpense[],
            subTimeline: SimulationYear[],
            subActiveMilestones: string[],
            subReachYears: Map<string, number>,
        ) => {
            if (simulationYear >= rmdYear) return undefined;
            return runProjectionSubsim(
                simulationYear - 1, // sub-sim starts AFTER previous year, ends at rmdYear
                subAccounts, subIncomes, subExpenses,
                subTimeline, subActiveMilestones, subReachYears,
                assumptions, taxState, birthYear,
            );
        }
        : undefined;

    runSimulationLoop({
        previousSimYear: startYear,
        yearsToRun: effectiveYearsToRun,
        currentAccounts: adjustedAccounts,
        currentIncomes: yearZero.incomes,
        currentExpenses: yearZero.expenses,
        timeline,
        previousActiveMilestones: [],
        milestoneReachYears: new Map(),
        assumptions,
        taxState,
        yearlyReturns,
        conversionMode,
        baselineProvider,
        dpConversionPlan,
        dpDebugByYear,
    });

    return timeline;
};

/**
 * Run simulation with rolling per-year baseline sub-simulations for accurate
 * Roth conversion decisions.
 *
 * For each year of the main run, before deciding the conversion ceiling, a
 * forward sub-simulation projects from the in-flight state to RMD year doing
 * only standard-deduction-headroom (0% bracket) conversions. The resulting
 * `traditionalBalanceAtRMD` (and SS/pension/passive at RMD) feed into the
 * rate-match algorithm, decoupling "future marginal rate at RMD" from the
 * live, depleting Trad balance. This replaces the older two-pass approach
 * that used a single zero-conversion baseline for the entire run.
 *
 * When tax optimization is disabled, this falls through to a plain
 * single-pass `runSimulation` with no baselines and no conversions.
 */
export const runSimulationWithOptimization = (
    yearsToRun: number = 30,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    yearlyReturns?: number[],
    referenceDate?: Date,
): SimulationYear[] => {
    const strategy = assumptions.investments.rothConversionStrategy ?? 'rate-match';
    const taxOptOn = assumptions.investments.taxOptimizationEnabled;

    if (strategy === 'dp-precomputed' && taxOptOn) {
        // Pass 1 — full-horizon std-ded-only baseline. Conversions limited to
        // the always-free standard-deduction headroom; everything else
        // (withdrawals, RMDs, taxes, income) reflects the deterministic plan.
        //
        // Override the strategy to 'rate-match' for the baseline pass —
        // otherwise selectConversionStrategy dispatches to planConversionDP,
        // which sees no dpConversionPlan and skips conversion entirely. We
        // want std-ded-only conversions in the baseline (which is what
        // conversionMode='std-ded-only' inside the rate-match path produces),
        // not zero conversions.
        const baselineAssumptions: AssumptionsState = {
            ...assumptions,
            investments: { ...assumptions.investments, rothConversionStrategy: 'rate-match' },
        };
        const baselineTimeline = runSimulation(
            yearsToRun, accounts, incomes, expenses, baselineAssumptions, taxState,
            yearlyReturns, referenceDate,
            /* conversionMode */ 'std-ded-only',
            /* useRollingBaseline */ false,
            /* dpConversionPlan */ undefined,
        );

        // Pass 2 — solve the DP over the baseline trajectory.
        const birthYear = getBirthYear(assumptions.milestones);
        const retirementYear = birthYear + getRetirementAge(assumptions.milestones);
        const contexts = buildDPYearContexts(baselineTimeline, assumptions, taxState, retirementYear);

        // Critical: the DP only solves retirement years onward, so its forward
        // sweep needs the trad balance AT RETIREMENT, not today. Pulling
        // accounts.vestedAmount here would feed today's balance into year 0
        // of the contexts (= retirement year), missing pre-retirement growth
        // and 401k contributions. Pull from the baseline timeline instead —
        // that's already simulated through the full pre-retirement period.
        const startSimYear = baselineTimeline.find(y => y.year === retirementYear)
            ?? baselineTimeline.find(y => y.year > retirementYear)
            ?? baselineTimeline[0];
        const startingTradBalance = startSimYear
            ? startSimYear.accounts
                .filter((a): a is InvestedAccount =>
                    a instanceof InvestedAccount &&
                    (a.taxType === 'Traditional 401k' || a.taxType === 'Traditional IRA'))
                .reduce((sum, a) => sum + a.vestedAmount, 0)
            : 0;
        const dpPlan: DPPlan = planConversionsViaDP({
            contexts,
            currentTradBalance: startingTradBalance,
        });

        // Pass 3 — final sim with the DP plan. The DP strategy in YearSolver
        // looks up `input.dpConversionPlan` per year. conversionMode is moot
        // for DP (it does not use the rate-match bracket walker).
        const finalTimeline = runSimulation(
            yearsToRun, accounts, incomes, expenses, assumptions, taxState,
            yearlyReturns, referenceDate,
            /* conversionMode */ 'rate-match',
            /* useRollingBaseline */ false,
            /* dpConversionPlan */ dpPlan.conversionsByYear,
            /* dpDebugByYear */ dpPlan.diagnostics.perYearDebug,
        );

        // Append solver summary to year-0 logs so the user can see DP setup
        // (grid, totals) in the year inspector for the simulation start year.
        if (finalTimeline.length > 0) {
            finalTimeline[0].logs.push(...dpPlan.diagnostics.summaryLogs);
        }
        return finalTimeline;
    }

    // Default: rate-match with rolling per-year sub-sim baselines.
    return runSimulation(
        yearsToRun, accounts, incomes, expenses, assumptions, taxState,
        yearlyReturns, referenceDate,
        /* conversionMode */ 'rate-match',
        /* useRollingBaseline */ true,
    );
};