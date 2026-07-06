/**
 * #189 (dev-only): the Testing tab's year-inspector "copy summary" added debt
 * balances as POSITIVE to the ACCOUNTS "Total" (so a $20k loan inflated net worth
 * by $20k instead of reducing it), and printed the per-period 401k fields (preTax401k,
 * roth401k, match, insurance, hsa) as if they were annual.
 */
import { describe, it, expect } from 'vitest';
import { generateYearSummaryText } from '../../../tabs/Testing/Testing';
import { InvestedAccount, DebtAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import type { SimulationYear } from '../../../services/simulation/types';

function makeSimYear(): SimulationYear {
    return {
        year: 2030,
        accounts: [
            new InvestedAccount('inv', '401k', 100000, 0, 5, 0.1, 'Traditional 401k', true, 0.2, 100000),
            new DebtAccount('debt', 'Car Loan', 20000, '', 5),
        ],
        incomes: [
            // Bi-weekly job: $2,000/period wage, $500/period pre-tax 401k → $13,000/yr.
            new WorkIncome('w1', 'Job', 2000, 'Bi-Weekly', 'Yes',
                500, 0, 0, 0, '', null, 'FIXED',
                new Date(2000, 0, 1), new Date(2040, 11, 31)),
        ],
        expenses: [],
        cashflow: {
            totalIncome: 52000,
            totalExpense: 40000,
            livingExpenses: 40000,
            discretionary: 0,
            investedUser: 0,
            investedMatch: 0,
            totalInvested: 0,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {},
        },
        taxDetails: {
            fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0,
            capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
        },
        logs: [],
    } as unknown as SimulationYear;
}

describe('generateYearSummaryText (#189)', () => {
    it('subtracts debt from the ACCOUNTS total (net worth), not adds it', () => {
        const text = generateYearSummaryText(makeSimYear(), 50, []);
        // 100,000 assets − 20,000 debt = 80,000 (the old code showed $120,000).
        expect(text).toContain('Total: $80,000');
        expect(text).not.toContain('Total: $120,000');
    });

    it('annualizes the per-period 401k fields', () => {
        const text = generateYearSummaryText(makeSimYear(), 50, []);
        // $500/period × 26 bi-weekly periods = $13,000 (not the per-period $500).
        expect(text).toContain('preTax401k: $13,000');
        expect(text).not.toContain('preTax401k: $500');
    });
});
