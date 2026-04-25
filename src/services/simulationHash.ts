import { AnyAccount } from '../components/Objects/Accounts/models';
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
        })),
        incomes: incomes.map(serializeIncomeFields),
        expenses: expenses.map(e => ({
            id: e.id,
            amount: e.getAnnualAmount(),
            name: e.name,
            className: e.constructor.name,
            startMilestoneId: e.startMilestoneId,
            endMilestoneId: e.endMilestoneId,
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
