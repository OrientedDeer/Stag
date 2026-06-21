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
interface MockLink { source: string; target: string; value: number }

// Mock Nivo's ResponsiveSankey: render each node AND each link as a clickable
// button so a test can drive the chart's `onClick` (the real chart wires it to
// the drill-down panel). Forwards the click's coordinates as the second arg,
// mirroring Nivo's `(datum, event)` handler signature, so the panel's anchored-
// popover positioning path is exercised. Link clicks pass the source/target as
// node datum objects ({ id, label }), matching what Nivo hands a link onClick.
vi.mock('@nivo/sankey', () => ({
    ResponsiveSankey: ({ data, onClick }: { data: { nodes: MockNode[]; links: MockLink[] }; onClick?: (n: unknown, e: unknown) => void }) => {
        const labelById = new Map(data.nodes.map(n => [n.id, n.label]));
        return (
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
                {(data.links ?? []).map((link: MockLink) => (
                    <button
                        key={`${link.source}->${link.target}`}
                        data-testid={`link-${link.source}->${link.target}`}
                        // Mirror the shape Nivo passes for a link click.
                        onClick={(e) => onClick?.(
                            {
                                source: { id: link.source, label: labelById.get(link.source) },
                                target: { id: link.target, label: labelById.get(link.target) },
                                value: link.value,
                                formattedValue: '',
                            },
                            { clientX: e.clientX, clientY: e.clientY },
                        )}
                    >
                        link
                    </button>
                ))}
            </div>
        );
    },
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
        expect(screen.queryByRole('dialog')).toBeNull();

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

    it('toggles the panel closed when the same node is clicked again', () => {
        renderChart();
        const node = screen.getByTestId('node-Gross Pay');
        fireEvent.click(node);
        expect(screen.getByRole('dialog')).toBeTruthy();

        // Re-clicking the SAME node flags the click as a selection, so the
        // outside-click handler skips it and the toggle closes the panel — it must
        // stay closed (not close-then-reopen).
        fireEvent.click(node);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('dismisses on a press truly outside the chart and panel', async () => {
        renderChart();
        fireEvent.click(screen.getByTestId('node-Gross Pay'));
        expect(screen.getByRole('dialog')).toBeTruthy();

        // Wait for the deferred outside-press listener (useClickOutside) to attach.
        await new Promise(resolve => setTimeout(resolve, 0));

        // A press on the document body (outside both the popover and the chart)
        // dismisses the panel.
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('dismisses when clicking the chart\'s own empty area (not a node/link)', () => {
        renderChart();
        fireEvent.click(screen.getByTestId('node-Gross Pay'));
        expect(screen.getByRole('dialog')).toBeTruthy();

        // Clicking empty chart space — inside the chart container but not on a node
        // or link — closes the panel (previously this was treated as "inside" and
        // left the panel open, which felt inconsistent).
        fireEvent.click(screen.getByTestId('mock-sankey'));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('switches to a different node without closing (selection click is not a dismissal)', () => {
        renderChart();
        fireEvent.click(screen.getByTestId('node-Gross Pay'));
        expect(within(screen.getByRole('dialog')).getByText('Sources')).toBeTruthy();

        // Clicking a different node while the panel is open must SWITCH, not close.
        fireEvent.click(screen.getByTestId('node-Taxes'));
        const panel = screen.getByRole('dialog');
        expect(within(panel).getByText('Breakdown')).toBeTruthy();
        expect(within(panel).getByText('Federal Tax')).toBeTruthy();
    });

    it('reopens after a background-click close', () => {
        renderChart();
        fireEvent.click(screen.getByTestId('node-Gross Pay'));
        expect(screen.getByRole('dialog')).toBeTruthy();

        fireEvent.click(screen.getByTestId('mock-sankey'));
        expect(screen.queryByRole('dialog')).toBeNull();

        // A node click after dismissal must open the panel again.
        fireEvent.click(screen.getByTestId('node-Taxes'));
        expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('opens a flow panel for a leaf source node (its single connection)', () => {
        renderChart();
        // "Job A" is a leaf income node — no breakdown, but a single outflow into
        // Gross Pay. Clicking it traces that flow instead of doing nothing.
        fireEvent.click(screen.getByTestId('node-Job A'));

        const panel = screen.getByRole('dialog');
        expect(panel.getAttribute('aria-label')).toBe('Job A to Gross Pay flow');
        expect(within(panel).getByText('Flow')).toBeTruthy();
        // Job A is part of Gross Pay's inflow, so its share of Gross Pay shows.
        expect(within(panel).getByText('of Gross Pay')).toBeTruthy();
    });

    it('opens a flow panel when a link is clicked', () => {
        renderChart();
        // No panel until something is clicked.
        expect(screen.queryByRole('dialog')).toBeNull();

        // The Job A → Gross Pay link traces that one flow.
        fireEvent.click(screen.getByTestId('link-Job A->Gross Pay'));

        const panel = screen.getByRole('dialog');
        expect(panel.getAttribute('aria-label')).toBe('Job A to Gross Pay flow');
        expect(within(panel).getByText('Flow')).toBeTruthy();
        // Job A is one of three income lines feeding Gross Pay, so its share is < 100%.
        expect(within(panel).getByText('of Gross Pay')).toBeTruthy();
    });

    it('toggles the flow panel closed when the same link is clicked again', () => {
        renderChart();
        const link = screen.getByTestId('link-Job A->Gross Pay');
        fireEvent.click(link);
        expect(screen.getByRole('dialog')).toBeTruthy();

        fireEvent.click(link);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens a flow panel for a leaf destination (expense) node', () => {
        renderChart();
        // "Food" is a leaf expense node fed only by Net Pay — clicking it traces
        // that flow and shows its share of Net Pay's outflow.
        fireEvent.click(screen.getByTestId('node-Food'));

        const panel = screen.getByRole('dialog');
        expect(panel.getAttribute('aria-label')).toBe('Net Pay to Food flow');
        expect(within(panel).getByText('of Net Pay')).toBeTruthy();
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
