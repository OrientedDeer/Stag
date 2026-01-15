import { AnyAccount } from '../components/Objects/Accounts/models';
import { AnyIncome } from '../components/Objects/Income/models';
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
        incomes: incomes.map(i => ({
            id: i.id,
            amount: i.getAnnualAmount(),
            name: i.name,
            className: i.constructor.name,
        })),
        expenses: expenses.map(e => ({
            id: e.id,
            amount: e.getAnnualAmount(),
            name: e.name,
            className: e.constructor.name,
        })),
        assumptions: {
            demographics: assumptions.demographics,
            macro: assumptions.macro,
            income: assumptions.income,
            expenses: assumptions.expenses,
            investments: assumptions.investments,
            priorities: assumptions.priorities,
            withdrawalStrategy: assumptions.withdrawalStrategy,
        },
        taxState: {
            filingStatus: taxState.filingStatus,
            stateResidency: taxState.stateResidency,
            deductionMethod: taxState.deductionMethod,
        }
    });

    return hashString(inputSnapshot);
}
