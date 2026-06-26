import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { CashflowSankey } from '../../../components/Charts/CashflowSankey';
import { PassiveIncome, CurrentSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { SavedAccount, InvestedAccount, DebtAccount } from '../../../components/Objects/Accounts/models';
import { AssumptionsContext, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';

// Mock ResizeObserver
class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverMock;

// Mock Nivo's ResponsiveSankey to capture the data it receives
let capturedSankeyData: { nodes: any[]; links: any[] } | null = null;

vi.mock('@nivo/sankey', () => ({
    ResponsiveSankey: ({ data }: { data: { nodes: any[]; links: any[] } }) => {
        capturedSankeyData = data;
        return <div data-testid="mock-sankey">Sankey Chart</div>;
    }
}));

const mockAssumptions = {
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(2001, 65, 90), // Born 2001, age 75 in 2076
    display: { useCompactCurrency: true, showExperimentalFeatures: false, hsaEligible: false }
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AssumptionsContext.Provider value={{
        state: mockAssumptions,
        dispatch: () => {}
    }}>
        {children}
    </AssumptionsContext.Provider>
);

describe('CashflowSankey', () => {
    beforeEach(() => {
        capturedSankeyData = null;
    });

    describe('RMD Year with Traditional Withdrawals', () => {
        it('should NOT show deficit when Traditional withdrawals cover expenses', () => {
            // Replicates a retiree scenario at age 75 in 2076
            // Key issue: The chart was showing a "Deficit" node that matched
            // the Traditional withdrawal amount, incorrectly treating the
            // withdrawal as a deficit source instead of an income source.

            // Income sources
            // CurrentSocialSecurityIncome constructor: id, name, amount, frequency, startDate, end_date
            const ssIncome = new CurrentSocialSecurityIncome(
                'inc-ss',
                'Social Security',
                36463,
                'Annually',
                new Date('2076-01-01'),
                undefined
            );

            // Interest income (reinvested - stays in savings account)
            const interestIncome = new PassiveIncome(
                'inc-interest',
                'Savings Interest',
                5728,
                'Annually',
                'No',  // earned_income
                'Interest',  // sourceType
                new Date('2076-01-01'),
                undefined,
                true  // Reinvested - THIS IS THE KEY DIFFERENCE
            );

            // Living expenses - set to $0 to demonstrate the bug
            // Even with $0 expenses, the Sankey shows a deficit because:
            // - Net pay: $76,793
            // - Bucket allocations: $76,116
            // - Reinvested income: $5,728
            // - remaining = $76,793 - $76,116 - $5,728 = -$5,051 (DEFICIT!)
            // The reinvested income is being double-counted as both:
            // 1. Part of net pay (added to gross, then through taxes to net)
            // 2. An outflow from net pay (subtracted in remaining calculation)
            const expense = new FoodExpense(
                'exp-food',
                'Living Expenses',
                0,  // $0 expenses to isolate the bug
                'Annually',
                new Date('2076-01-01')
            );

            // Accounts for reference
            const savingsAccount = new SavedAccount('acc-savings', 'Savings', 150000, 1.0);
            const brokerageAccount = new InvestedAccount(
                'acc-brokerage', 'Brokerage', 80000, 0, 10, 0, 'Brokerage', false, 1.0
            );

            // Taxes from the simulation
            const taxes = {
                fed: 38362,
                state: 12067,
                fica: 0,
                capitalGains: 0
            };

            // Withdrawals - this is the key data
            // The Traditional 401k withdrawal ($85,031) is from RMD
            const withdrawals = {
                'Trad 401k': 85031
            };

            // Bucket allocations - example surplus going to savings
            const bucketAllocations = {
                'acc-brokerage': 76116  // example surplus value
            };

            render(
                <CashflowSankey
                    incomes={[ssIncome, interestIncome]}
                    expenses={[expense]}
                    year={2076}
                    taxes={taxes}
                    withdrawals={withdrawals}
                    bucketAllocations={bucketAllocations}
                    accounts={[savingsAccount, brokerageAccount]}
                    height={400}
                />,
                { wrapper }
            );

            expect(capturedSankeyData).not.toBeNull();

            // Find if there's a "Deficit" node
            const deficitNode = capturedSankeyData!.nodes.find(
                (node: any) => node.id === 'Deficit'
            );

            // Find if there's a link from Deficit to Net Pay
            const deficitLink = capturedSankeyData!.links.find(
                (link: any) => link.source === 'Deficit'
            );

            // The chart should NOT show a deficit when withdrawals cover expenses
            // The Traditional withdrawal should flow through as income, not as deficit
            expect(
                deficitNode,
                'Sankey should NOT have a Deficit node when Traditional withdrawals cover expenses. ' +
                `Found nodes: ${capturedSankeyData!.nodes.map((n: any) => n.id).join(', ')}`
            ).toBeUndefined();

            expect(
                deficitLink,
                `Sankey should NOT have a Deficit link. ` +
                `Found links from: ${capturedSankeyData!.links.map((l: any) => `${l.source}->${l.target}`).join(', ')}`
            ).toBeUndefined();

            // Verify the Traditional withdrawal IS being shown as income
            const withdrawNode = capturedSankeyData!.nodes.find(
                (node: any) => node.id === 'Withdraw: Trad 401k'
            );
            expect(
                withdrawNode,
                'Sankey should have a withdrawal node for Trad 401k'
            ).toBeDefined();

            // Verify the withdrawal flows to Gross Pay
            const withdrawToGrossLink = capturedSankeyData!.links.find(
                (link: any) => link.source === 'Withdraw: Trad 401k' && link.target === 'Gross Pay'
            );
            expect(
                withdrawToGrossLink,
                'Traditional withdrawal should flow to Gross Pay'
            ).toBeDefined();
            expect(withdrawToGrossLink.value).toBe(85031);
        });
    });

    // #60 [4]: a surplus DEBT PAYDOWN bucket must render as "Pay Down: <name>" in
    // the debt/negative color — NOT "Save: <name>" in the savings/green color —
    // so the user doesn't misread debt reduction as money saved.
    describe('debt-paydown bucket labeling', () => {
        it('labels a DebtAccount bucket "Pay Down: <name>" in the negative color, not "Save:"/green', () => {
            const ssIncome = new CurrentSocialSecurityIncome('ss', 'Social Security', 40000, 'Annually', new Date('2076-01-01'), undefined);
            const expense = new FoodExpense('exp', 'Food', 10000, 'Annually', new Date(2076, 0, 1));
            const debt = new DebtAccount('acc-card', 'Credit Card', 5000, 'exp-card', 18);
            const brokerage = new InvestedAccount('acc-brok', 'Brokerage', 100000, 0, 10, 0.05, 'Brokerage');

            render(
                <CashflowSankey
                    incomes={[ssIncome]}
                    expenses={[expense]}
                    year={2076}
                    taxes={{ fed: 0, state: 0, fica: 0, capitalGains: 0 }}
                    withdrawals={{}}
                    bucketAllocations={{ 'acc-card': 4000, 'acc-brok': 6000 }}
                    accounts={[debt, brokerage]}
                    height={400}
                />,
                { wrapper }
            );

            expect(capturedSankeyData).not.toBeNull();
            const nodes = capturedSankeyData!.nodes;

            // [2] Node id is keyed on the unique account id; [5] the visible LABEL
            // carries "Pay Down:"; the color is the debt/negative color.
            const payDown = nodes.find((n: any) => n.id === 'Pay Down: acc-card');
            expect(payDown, `nodes: ${nodes.map((n: any) => n.id).join(', ')}`).toBeDefined();
            expect(payDown.label).toBe('Pay Down: Credit Card'); // [5] user sees this
            expect(payDown.color).toBe('var(--c-negative-soft)');

            // A real investment bucket still renders as "Save:" in the money color,
            // and its visible label is the plain account name.
            const save = nodes.find((n: any) => n.id === 'Save: acc-brok');
            expect(save).toBeDefined();
            expect(save.label).toBe('Brokerage');
            expect(save.color).toBe('var(--color-chart-money)');

            // The link target matches the node id, so the edge resolves.
            const payDownLink = capturedSankeyData!.links.find(
                (l: any) => l.target === 'Pay Down: acc-card'
            );
            expect(payDownLink, 'a link must target the debt node').toBeDefined();
            expect(payDownLink.value).toBe(4000);
        });

        it('[2] two buckets sharing a display name produce DISTINCT node ids (no Nivo collision)', () => {
            const ssIncome = new CurrentSocialSecurityIncome('ss', 'Social Security', 60000, 'Annually', new Date('2076-01-01'), undefined);
            const expense = new FoodExpense('exp', 'Food', 10000, 'Annually', new Date(2076, 0, 1));
            // Two DISTINCT debt accounts that happen to share the display name "Loan".
            const loanA = new DebtAccount('acc-a', 'Loan', 3000, 'exp-a', 6);
            const loanB = new DebtAccount('acc-b', 'Loan', 4000, 'exp-b', 8);

            // Render must NOT throw (a duplicate node id would make Nivo reject).
            expect(() => render(
                <CashflowSankey
                    incomes={[ssIncome]}
                    expenses={[expense]}
                    year={2076}
                    taxes={{ fed: 0, state: 0, fica: 0, capitalGains: 0 }}
                    withdrawals={{}}
                    bucketAllocations={{ 'acc-a': 3000, 'acc-b': 4000 }}
                    accounts={[loanA, loanB]}
                    height={400}
                />,
                { wrapper }
            )).not.toThrow();

            const nodes = capturedSankeyData!.nodes;
            // Distinct ids (keyed on account id), both labeled "Pay Down: Loan".
            expect(nodes.find((n: any) => n.id === 'Pay Down: acc-a')).toBeDefined();
            expect(nodes.find((n: any) => n.id === 'Pay Down: acc-b')).toBeDefined();
            const payDownLabels = nodes.filter((n: any) => n.label === 'Pay Down: Loan');
            expect(payDownLabels).toHaveLength(2);
            // No duplicate node ids in the whole graph.
            const ids = nodes.map((n: any) => n.id);
            expect(new Set(ids).size).toBe(ids.length);
        });
    });
});
