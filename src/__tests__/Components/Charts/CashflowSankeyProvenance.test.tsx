import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CashflowSankey } from '../../../components/Charts/CashflowSankey';
import { WorkIncome, CurrentSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsContext, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import type { CashflowDetail } from '../../../services/simulation/types';

// Mock ResizeObserver
class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}
(globalThis as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock;

interface MockNode { id: string; label: string; color: string }

// Mock Nivo's ResponsiveSankey: render each node as a clickable button so a
// test can drive the chart's `onClick` (the real chart wires it to the
// provenance drill-down panel). Forwards the click's coordinates as the second
// arg, mirroring Nivo's `(node, event)` handler signature, so the panel's
// anchored-popover positioning path is exercised.
vi.mock('@nivo/sankey', () => ({
    ResponsiveSankey: ({ data, onClick }: { data: { nodes: MockNode[] }; onClick?: (n: unknown, e: unknown) => void }) => (
        <div data-testid="mock-sankey">
            {data.nodes.map((node: MockNode) => (
                <button
                    key={node.id}
                    data-testid={`node-${node.id}`}
                    // Mirror the shape Nivo passes for a node click (datum + event).
                    onClick={(e) => onClick?.({ ...node, value: 100000, formattedValue: '' }, { clientX: e.clientX, clientY: e.clientY })}
                >
                    {node.label}
                </button>
            ))}
        </div>
    ),
}));

const mockAssumptions = {
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(2001, 65, 90),
    display: { useCompactCurrency: false, showExperimentalFeatures: false, hsaEligible: false },
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AssumptionsContext.Provider value={{ state: mockAssumptions, dispatch: () => {} }}>
        {children}
    </AssumptionsContext.Provider>
);

describe('CashflowSankey provenance drill-down', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderChart = () => {
        // Two work incomes + a Social Security income all feed the "Gross Pay" node.
        // (When cashflowDetail is supplied the chart reads its values, not these,
        // but the income objects still drive node identity.)
        const job1 = new WorkIncome('inc-1', 'Job A', 60000, 'Annually', 'Yes', 0, 0, 0, 0, '', null);
        const job2 = new WorkIncome('inc-2', 'Job B', 40000, 'Annually', 'Yes', 0, 0, 0, 0, '', null);
        const ss = new CurrentSocialSecurityIncome('inc-ss', 'Social Security', 20000, 'Annually', new Date('2030-01-01'), undefined);
        const expense = new FoodExpense('exp-food', 'Food', 12000, 'Annually', new Date('2030-01-01'));

        const cashflowDetail: CashflowDetail = {
            incomeBySource: [
                { name: 'Job A', amount: 60000, kind: 'work' },
                { name: 'Job B', amount: 40000, kind: 'work' },
                { name: 'Social Security', amount: 20000, kind: 'ss' },
            ],
            userPreTax401k: 0,
            userRoth401k: 0,
            employerMatchPreTax: 0,
            employerMatchRoth: 0,
            insurance: 0,
            mortgagePrincipal: 0,
            mortgageInterestEscrow: 0,
            expensesByCategory: { Food: 12000 },
            brokerageLTCGFromGross: 0,
        };

        return render(
            <CashflowSankey
                incomes={[job1, job2, ss]}
                expenses={[expense]}
                year={2030}
                taxes={{ fed: 10000, state: 2000, fica: 5000 }}
                cashflowDetail={cashflowDetail}
                height={400}
            />,
            { wrapper },
        );
    };

    it('opens a panel listing source objects when a composite node is clicked', () => {
        renderChart();

        // No panel until a node is clicked.
        expect(screen.queryByText('Close detail panel')).toBeNull();

        fireEvent.click(screen.getByTestId('node-Gross Pay'));

        // Panel shows the three income sources that compose Gross Pay.
        const panel = screen.getByRole('dialog');
        expect(within(panel).getByText('Job A')).toBeTruthy();
        expect(within(panel).getByText('Job B')).toBeTruthy();
        expect(within(panel).getByText('Social Security')).toBeTruthy();
        // Gross Pay reads its inputs, so the header labels it "Sources".
        expect(within(panel).getByText('Sources')).toBeTruthy();
    });

    it('breaks Taxes down into its components', () => {
        renderChart();
        fireEvent.click(screen.getByTestId('node-Taxes'));

        const panel = screen.getByRole('dialog');
        expect(within(panel).getByText('Federal Tax')).toBeTruthy();
        expect(within(panel).getByText('State Tax')).toBeTruthy();
        expect(within(panel).getByText('FICA Tax')).toBeTruthy();
        // Taxes is a same-column sub-split, so the header labels it "Breakdown".
        expect(within(panel).getByText('Breakdown')).toBeTruthy();
    });

    it('dismisses the panel when the close button is clicked', () => {
        renderChart();
        fireEvent.click(screen.getByTestId('node-Gross Pay'));
        expect(screen.getByLabelText('Close detail panel')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Close detail panel'));
        expect(screen.queryByLabelText('Close detail panel')).toBeNull();
    });

    it('toggles the panel closed when the same node is clicked again', () => {
        renderChart();
        fireEvent.click(screen.getByTestId('node-Gross Pay'));
        expect(screen.getByLabelText('Close detail panel')).toBeTruthy();

        fireEvent.click(screen.getByTestId('node-Gross Pay'));
        expect(screen.queryByLabelText('Close detail panel')).toBeNull();
    });

    it('does not open a panel for a leaf source node', () => {
        renderChart();
        // "Job A" is a leaf income node — it has no provenance breakdown.
        fireEvent.click(screen.getByTestId('node-Job A'));
        expect(screen.queryByLabelText('Close detail panel')).toBeNull();
    });

    it('labels Net Pay as Destinations (where take-home flows)', () => {
        renderChart();
        fireEvent.click(screen.getByTestId('node-Net Pay'));

        const panel = screen.getByRole('dialog');
        // Net Pay shows downstream outputs, so the header labels it "Destinations".
        expect(within(panel).getByText('Destinations')).toBeTruthy();
        // Food expense is one of the take-home destinations.
        expect(within(panel).getByText('Food')).toBeTruthy();
    });

    it('dismisses the panel on Escape', () => {
        renderChart();
        fireEvent.click(screen.getByTestId('node-Gross Pay'));
        expect(screen.getByRole('dialog')).toBeTruthy();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
