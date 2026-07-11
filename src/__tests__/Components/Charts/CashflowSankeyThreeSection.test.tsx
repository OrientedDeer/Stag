import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CashflowSankey } from '../../../components/Charts/CashflowSankey';
import { CurrentSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import {
    type AssumptionsState,
    AssumptionsContext,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import type { CashflowDetail, SimulationYear } from '../../../services/simulation/types';

// #205 (c): the three-section click panel — composition + "why" provenance +
// "how it evolves" trajectory. Uses a REAL simulation for the trajectory series and
// engine-shaped CashflowDetail for the "why" rows.

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}
(globalThis as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock;

interface MockNode { id: string; label: string; color: string }
interface MockLink { source: string; target: string; value: number }

// Mock Nivo's Sankey: render each node/link as a clickable button (mirrors the
// idiom in CashflowSankeyProvenance.test.tsx) so a test can drive onClick.
vi.mock('@nivo/sankey', () => ({
    ResponsiveSankey: ({ data, onClick }: { data: { nodes: MockNode[]; links: MockLink[] }; onClick?: (n: unknown, e: unknown) => void }) => {
        const labelById = new Map(data.nodes.map(n => [n.id, n.label]));
        return (
            <div data-testid="mock-sankey">
                {data.nodes.map((node: MockNode) => (
                    <button
                        key={node.id}
                        data-testid={`node-${node.id}`}
                        onClick={(e) => onClick?.({ ...node, value: 40000, formattedValue: '' }, { clientX: e.clientX, clientY: e.clientY })}
                    >
                        {node.label}
                    </button>
                ))}
                {(data.links ?? []).map((link: MockLink) => (
                    <button
                        key={`${link.source}->${link.target}`}
                        data-testid={`link-${link.source}->${link.target}`}
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
    milestones: createBuiltinMilestones(1960, 65, 90),
    display: { useCompactCurrency: false, showExperimentalFeatures: false, hsaEligible: false },
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AssumptionsContext.Provider value={{ state: mockAssumptions, dispatch: () => {} }}>
        {children}
    </AssumptionsContext.Provider>
);

// A retiree drawing a Traditional IRA to cover a spending deficit — yields a
// "Withdraw: Traditional IRA" node plus a withdrawal detail row with a reason.
const ira = new InvestedAccount('ira-1', 'Traditional IRA', 400000, 0, 5, 0.0, 'Traditional IRA', true, 0.2);
const ss = new CurrentSocialSecurityIncome('inc-ss', 'Social Security', 20000, 'Annually', new Date('2020-01-01'), undefined);
const expense = new FoodExpense('exp-food', 'Food', 12000, 'Annually', new Date('2020-01-01'));

const cashflowDetail: CashflowDetail = {
    incomeBySource: [{ name: 'Social Security', amount: 20000, kind: 'ss' }],
    userPreTax401k: 0,
    userRoth401k: 0,
    employerMatchPreTax: 0,
    employerMatchRoth: 0,
    insurance: 0,
    mortgagePrincipal: 0,
    mortgageInterestEscrow: 0,
    expensesByCategory: { Food: 12000 },
    brokerageLTCGFromGross: 0,
    withdrawals: [
        { accountId: 'ira-1', accountName: 'Traditional IRA', gross: 40000, tax: 8000, penalty: 0, net: 32000, reason: 'Spending deficit' },
    ],
};

/** Build a real multi-year timeline to feed the trajectory sparkline. */
function buildTimeline(): SimulationYear[] {
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(1960, 65, 90),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 } },
    };
    const taxState: TaxState = {
        filingStatus: 'Single', stateResidency: 'DC', deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null, year: 2024,
    };
    const acct = new InvestedAccount('ira-1', 'Traditional IRA', 400000, 0, 5, 0.0, 'Traditional IRA', true, 0.2);
    const exp = new FoodExpense('exp-food', 'Food', 12000, 'Annually', new Date('2020-01-01'));
    return runSimulation(5, [acct], [ss], [exp], {
        ...assumptions,
        withdrawalStrategy: [{ id: 'w1', name: 'IRA', accountId: 'ira-1' }],
    }, taxState);
}

const renderChart = (extra: Partial<React.ComponentProps<typeof CashflowSankey>> = {}) =>
    render(
        <CashflowSankey
            incomes={[ss]}
            expenses={[expense]}
            year={2025}
            taxes={{ fed: 4000, state: 1000, fica: 0, withdrawalOrdinaryTax: 4000 }}
            accounts={[ira]}
            withdrawals={{ 'ira-1': 40000 }}
            cashflowDetail={cashflowDetail}
            height={400}
            {...extra}
        />,
        { wrapper },
    );

describe('CashflowSankey three-section click panel (#205c)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders the withdrawal "why" rows (gross → tax → net) and the reason', () => {
        renderChart();
        fireEvent.click(screen.getByTestId('node-Withdraw: Traditional IRA'));

        const panel = screen.getByRole('dialog');
        // Section 2: why it's this size.
        expect(within(panel).getByText('Why it\'s this size')).toBeTruthy();
        expect(within(panel).getByText('Gross')).toBeTruthy();
        expect(within(panel).getByText('Tax')).toBeTruthy();
        expect(within(panel).getByText('Net received')).toBeTruthy();
        // The reason line from the real CashflowDetail row.
        expect(within(panel).getByText('Spending deficit')).toBeTruthy();
    });

    it('renders composition rows for a withdrawal node (Withdrawn + Remaining balance)', () => {
        renderChart();
        fireEvent.click(screen.getByTestId('node-Withdraw: Traditional IRA'));

        const panel = screen.getByRole('dialog');
        expect(within(panel).getByText('Withdrawn')).toBeTruthy();
        expect(within(panel).getByText('Remaining balance')).toBeTruthy();
    });

    it('renders composition rows for a category node (Gross Pay sources)', () => {
        renderChart();
        fireEvent.click(screen.getByTestId('node-Gross Pay'));

        const panel = screen.getByRole('dialog');
        expect(within(panel).getByText('Sources')).toBeTruthy();
        expect(within(panel).getByText('Social Security')).toBeTruthy();
        expect(within(panel).getByText('From Traditional IRA')).toBeTruthy();
    });

    it('hides the trajectory section in Dashboard mode (no simulationData)', () => {
        renderChart(); // no simulationData
        fireEvent.click(screen.getByTestId('node-Withdraw: Traditional IRA'));

        const panel = screen.getByRole('dialog');
        expect(within(panel).queryByText('How it evolves')).toBeNull();
    });

    it('shows the trajectory section when simulationData is passed', () => {
        renderChart({ simulationData: buildTimeline() });
        fireEvent.click(screen.getByTestId('node-Withdraw: Traditional IRA'));

        const panel = screen.getByRole('dialog');
        expect(within(panel).getByText('How it evolves')).toBeTruthy();
    });

    it('fires onSelectYear with the clicked sparkline year', () => {
        const timeline = buildTimeline();
        const onSelectYear = vi.fn();
        renderChart({ simulationData: timeline, onSelectYear });
        fireEvent.click(screen.getByTestId('node-Withdraw: Traditional IRA'));

        const panel = screen.getByRole('dialog');
        const targetYear = timeline.filter(sy => !sy.isEndOfYearProjection)[2].year;
        fireEvent.click(within(panel).getByTestId(`spark-year-${targetYear}`));
        expect(onSelectYear).toHaveBeenCalledWith(targetYear);
    });
});
