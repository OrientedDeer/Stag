/**
 * #167: balance-target handling in the EOY contribution projection.
 *
 * TARGET (fund to a fixed dollar balance) and MULTIPLE_OF_EXPENSES (emergency
 * fund = N × monthly expenses) are balance targets: the projection adds the
 * gap to the target, or skips with 'balance-target-met' when already full.
 */
import { describe, it, expect } from 'vitest';
import { computeEOYBudgetContributions } from '../../services/eoyContributionProjection';
import { defaultAssumptions, type PriorityBucket } from '../../components/Objects/Assumptions/AssumptionsContext';
import { defaultTaxState } from '../../components/Objects/Taxes/TaxContext';
import { SavedAccount } from '../../components/Objects/Accounts/models';
import { OtherExpense } from '../../components/Objects/Expense/models';

const today = new Date(2026, 5, 15); // June 15, 2026
const rent = new OtherExpense('e1', 'Rent', 2000, 'Monthly', new Date(2024, 0, 1));

function project(priorities: PriorityBucket[], accounts: SavedAccount[]) {
    return computeEOYBudgetContributions(
        priorities,
        accounts,
        [], // incomes
        [rent],
        [], // budgetMonths
        defaultAssumptions,
        defaultTaxState,
        2026,
        today,
    );
}

describe('computeEOYBudgetContributions — TARGET balance targets', () => {
    it('adds the gap to the dollar target for an underfunded TARGET bucket', () => {
        const result = project(
            [{ id: 'p1', name: 'House fund', type: 'SAVINGS', accountId: 'hf1', capType: 'TARGET', capValue: 15000 }],
            [new SavedAccount('hf1', 'House Fund', 4000)],
        );

        expect(result.additions['hf1']).toBe(11000);
        const row = result.rows.find(r => r.accountId === 'hf1')!;
        expect(row.source).toBe('balance-target');
        expect(row.annualGoal).toBe(15000);
        expect(row.currentBalance).toBe(4000);
        expect(row.expectedRemaining).toBe(11000);
        expect(row.skipped).toBeUndefined();
    });

    it('skips a TARGET bucket already at/above target with balance-target-met', () => {
        const result = project(
            [{ id: 'p1', name: 'House fund', type: 'SAVINGS', accountId: 'hf1', capType: 'TARGET', capValue: 15000 }],
            [new SavedAccount('hf1', 'House Fund', 18000)],
        );

        expect(result.additions['hf1']).toBeUndefined();
        const row = result.rows.find(r => r.accountId === 'hf1')!;
        expect(row.source).toBe('balance-target');
        expect(row.expectedRemaining).toBe(0);
        expect(row.skipped).toBe('balance-target-met');
    });

    it('still derives the MULTIPLE_OF_EXPENSES target from monthly expenses', () => {
        // 3 months × $2,000 rent = $6,000 target; $1,000 held → $5,000 gap.
        const result = project(
            [{ id: 'p2', name: 'Rainy day', type: 'SAVINGS', accountId: 'ef1', capType: 'MULTIPLE_OF_EXPENSES', capValue: 3 }],
            [new SavedAccount('ef1', 'Emergency Fund', 1000)],
        );

        expect(result.additions['ef1']).toBe(5000);
        const row = result.rows.find(r => r.accountId === 'ef1')!;
        expect(row.source).toBe('balance-target');
        expect(row.annualGoal).toBe(6000);
    });
});
