import { AnyAccount, RSUAccount } from '../components/Objects/Accounts/models';
import { AnyIncome, WorkIncome, FERSPensionIncome, CSRSPensionIncome, FutureSocialSecurityIncome } from '../components/Objects/Income/models';
import { AnyExpense } from '../components/Objects/Expense/models';
import { AssumptionsState } from '../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../components/Objects/Taxes/TaxContext';

/**
 * Simple hash function for change detection.
 * Not cryptographic - just needs to be fast and produce different values for different inputs.
 */
export function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
}

/**
 * Serialize income-specific fields that affect simulation.
 * Different income types have different fields that matter for calculation.
 */
function serializeIncomeFields(income: AnyIncome): Record<string, unknown> {
    const base = {
        id: income.id,
        amount: income.getAnnualAmount(),
        name: income.name,
        className: income.constructor.name,
        startDate: income.startDate?.toISOString(),
        endDate: income.end_date?.toISOString(),
        startMilestoneId: income.startMilestoneId,
        endMilestoneId: income.endMilestoneId,
    };

    if (income instanceof WorkIncome) {
        return {
            ...base,
            pensionSystem: income.pensionSystem,
            preTax401k: income.preTax401k,
            roth401k: income.roth401k,
            employerMatch: income.employerMatch,
            employerMatchType: income.employerMatchType,
            employerMatchPercent: income.employerMatchPercent,
            employerMatchMax: income.employerMatchMax,
            autoMax401k: income.autoMax401k,
            hsaContribution: income.hsaContribution,
            esppContributionType: income.esppContributionType,
            esppContributionAmount: income.esppContributionAmount,
            rsuVestingSchedule: income.rsuVestingSchedule,
            rsuGrantShares: income.rsuGrantShares,
            rsuVestFrequency: income.rsuVestFrequency,
            rsuExpectedStockGrowth: income.rsuExpectedStockGrowth,
            rsuAccountId: income.rsuAccountId,
            rsuWithholdingRate: income.rsuWithholdingRate,
        };
    }

    if (income instanceof FERSPensionIncome) {
        return {
            ...base,
            yearsOfService: income.yearsOfService,
            high3Salary: income.high3Salary,
            retirementAge: income.retirementAge,
            birthYear: income.birthYear,
            autoCalculateHigh3: income.autoCalculateHigh3,
            linkedIncomeId: income.linkedIncomeId,
        };
    }

    if (income instanceof CSRSPensionIncome) {
        return {
            ...base,
            yearsOfService: income.yearsOfService,
            high3Salary: income.high3Salary,
            retirementAge: income.retirementAge,
            autoCalculateHigh3: income.autoCalculateHigh3,
            linkedIncomeId: income.linkedIncomeId,
        };
    }

    if (income instanceof FutureSocialSecurityIncome) {
        return {
            ...base,
            claimingAge: income.claimingAge,
        };
    }

    return base;
}

/**
 * Generates a hash of all simulation inputs for change detection.
 * Used to determine if simulation results are stale.
 */
export function getSimulationInputHash(
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState
): string {
    // Serialize inputs that affect simulation output
    // We use a simplified representation to avoid circular references
    const inputSnapshot = JSON.stringify({
        accounts: accounts.map(a => ({
            id: a.id,
            amount: a.amount,
            name: a.name,
            className: a.constructor.name,
            // RSU sale tax/eligibility depend on per-share price, the lot pool,
            // and the sell-order / holding-period settings — editing any of these
            // changes simulation output, so include them or the cache goes stale.
            ...(a instanceof RSUAccount
                ? {
                    currentSharePrice: a.currentSharePrice,
                    withdrawalPreference: a.withdrawalPreference,
                    minimumHoldingDays: a.minimumHoldingDays,
                    lots: a.lots.map(lot => ({
                        id: lot.id,
                        shares: lot.shares,
                        fmvAtVest: lot.fmvAtVest,
                        costBasis: lot.costBasis,
                        vestDate: lot.vestDate instanceof Date
                            ? lot.vestDate.getTime()
                            : lot.vestDate,
                    })),
                }
                : {}),
        })),
        incomes: incomes.map(serializeIncomeFields),
        expenses: expenses.map(e => ({
            id: e.id,
            amount: e.getAnnualAmount(),
            name: e.name,
            className: e.constructor.name,
            startMilestoneId: e.startMilestoneId,
            endMilestoneId: e.endMilestoneId,
            // Goal / cadence fields that steer the simulation but aren't captured
            // by getAnnualAmount() (a goal reports $0 there — it's funded as a
            // sinking-fund set-aside instead). Editing any of these changes sim
            // output, so they must invalidate the cache:
            //  - startDate     : when the expense/goal saving window opens
            //  - endDate        : a targetDate goal's target / a recurring goal's
            //                     "stop replacing it" date (also a loan's end)
            //  - dueMonth       : which month an annual expense / goal lump fires
            //  - goalType       : 'targetDate' vs 'recurring' (whether endDate applies)
            //  - intervalYears  : recurrence horizon driving a recurring goal's set-aside
            //  - goalAccountId  : the sinking-fund account a goal's funding routes to
            // Dates are local-midnight date-only values; serialize via getTime()
            // (one-to-one, timezone-safe) rather than toISOString().
            startDate: e.startDate instanceof Date ? e.startDate.getTime() : e.startDate,
            endDate: e.endDate instanceof Date ? e.endDate.getTime() : e.endDate,
            dueMonth: e.dueMonth,
            goalType: e.goalType,
            intervalYears: e.intervalYears,
            goalAccountId: e.goalAccountId,
        })),
        assumptions: {
            demographics: assumptions.demographics,
            macro: assumptions.macro,
            income: assumptions.income,
            expenses: assumptions.expenses,
            investments: assumptions.investments,
            priorities: assumptions.priorities,
            withdrawalStrategy: assumptions.withdrawalStrategy,
            milestones: assumptions.milestones,
        },
        taxState: {
            filingStatus: taxState.filingStatus,
            stateResidency: taxState.stateResidency,
            deductionMethod: taxState.deductionMethod,
        }
    });

    return hashString(inputSnapshot);
}
