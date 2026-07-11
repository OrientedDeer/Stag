import { describe, it, expect } from 'vitest';
import { buildCashflowSankeyData } from '../../../components/Charts/cashflowSankeyData';
import { CurrentSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { FoodExpense, VacationExpense } from '../../../components/Objects/Expense/models';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';

// #205 (a): composition provenance built through the REAL pure builder.
// - expense CATEGORY node → the individual expenses inside it, summing to the node total
// - withdrawal node → drawn amount + the account's remaining balance (context)
describe('CashflowSankey composition provenance (#205a)', () => {
    it('breaks a multi-expense category node into its individual expenses, summing to the node total', () => {
        // Two expenses in the SAME category (Vacation) so the category node is a real
        // aggregate, plus one lone Food expense that must NOT become drillable.
        const trip1 = new VacationExpense('v1', 'Europe Trip', 8000, 'Annually', new Date(2076, 0, 1));
        const trip2 = new VacationExpense('v2', 'Ski Trip', 4000, 'Annually', new Date(2076, 0, 1));
        const food = new FoodExpense('f1', 'Groceries', 10000, 'Annually', new Date(2076, 0, 1));

        const result = buildCashflowSankeyData({
            incomes: [new CurrentSocialSecurityIncome('ss', 'Social Security', 100000, 'Annually', new Date('2076-01-01'), undefined)],
            expenses: [trip1, trip2, food],
            year: 2076,
            taxes: { fed: 0, state: 0, fica: 0 },
            bucketAllocations: {},
            accounts: [],
            withdrawals: {},
        });

        expect(result.error).toBeNull();

        // The Vacation category aggregates two expenses → drillable breakdown.
        const vacation = result.provenance['Vacation'];
        expect(vacation).toBeDefined();
        expect(vacation!.direction).toBe('breakdown');
        const labels = vacation!.items.map(i => i.label).sort();
        expect(labels).toEqual(['Europe Trip', 'Ski Trip']);
        const itemsSum = vacation!.items.reduce((s, i) => s + i.value, 0);
        // Rows reconcile EXACTLY to the node's outflow total from Net Pay.
        const vacationNode = result.data.nodes.find(n => n.id === 'Vacation');
        expect(vacationNode).toBeDefined();
        const vacationInflow = result.data.links
            .filter(l => l.target === 'Vacation')
            .reduce((s, l) => s + l.value, 0);
        expect(itemsSum).toBeCloseTo(vacationInflow, 6);
        expect(itemsSum).toBeCloseTo(12000, 6);

        // A single-expense category is left to the leaf/flow panel (no trivial 1-row breakdown).
        expect(result.provenance['Food']).toBeUndefined();
    });

    it('gives a withdrawal node the drawn amount plus the account remaining balance', () => {
        const tradIRA = new InvestedAccount('acc-trad', 'Trad IRA', 310000, 0, 5, 0.0, 'Traditional IRA', true, 0.2);

        const result = buildCashflowSankeyData({
            incomes: [new CurrentSocialSecurityIncome('ss', 'Social Security', 40000, 'Annually', new Date('2076-01-01'), undefined)],
            expenses: [new FoodExpense('f1', 'Food', 10000, 'Annually', new Date(2076, 0, 1))],
            year: 2076,
            taxes: { fed: 0, state: 0, fica: 0 },
            bucketAllocations: {},
            accounts: [tradIRA],
            withdrawals: { 'acc-trad': 40000 },
        });

        expect(result.error).toBeNull();

        const withdraw = result.provenance['Withdraw: Trad IRA'];
        expect(withdraw).toBeDefined();
        expect(withdraw!.direction).toBe('breakdown');
        // Drawn amount (the node's own value) first, then the remaining balance context.
        const drawn = withdraw!.items.find(i => i.label === 'Withdrawn');
        const remaining = withdraw!.items.find(i => i.label === 'Remaining balance');
        expect(drawn?.value).toBeCloseTo(40000, 6);
        expect(remaining?.value).toBeCloseTo(310000, 6);
    });
});
