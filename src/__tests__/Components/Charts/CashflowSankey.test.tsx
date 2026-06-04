import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { CashflowSankey } from '../../../components/Charts/CashflowSankey';
import { PassiveIncome, CurrentSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { SavedAccount, InvestedAccount } from '../../../components/Objects/Accounts/models';
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
});
