import type { ReactNode } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SimulationYear } from '../../../../components/Objects/Assumptions/SimulationEngine';
import { OverviewTab } from '../../../../tabs/Future/tabs/OverviewTab';
import { DebtAccount, InvestedAccount, PropertyAccount, SavedAccount } from '../../../../components/Objects/Accounts/models';
import { LoanExpense, MortgageExpense } from '../../../../components/Objects/Expense/models';
import { CurrentSocialSecurityIncome, FutureSocialSecurityIncome } from '../../../../components/Objects/Income/models';

// -----------------------------------------------------------------------------
// 1. Mocks
// -----------------------------------------------------------------------------

// Minimal shape of the chart point data the slice tooltip reads back.
type TooltipPointData = Record<string, number | string | boolean>;
type SliceTooltipArg = { slice?: { points?: Array<{ data: TooltipPointData }> } };
type SliceTooltipFn = (arg: SliceTooltipArg) => ReactNode;

// Shape of the serialized nivo `data` prop the mock chart re-emits as JSON.
type ChartSeries = { id: string; data: Array<TooltipPointData & { y: number }> };

// Captured so tooltip tests can render the slice tooltip directly (#143).
let capturedSliceTooltip: SliceTooltipFn | undefined;

// Mock the Nivo Chart. We just want to know what 'data' it received.
vi.mock('@nivo/line', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- nivo's data prop is loosely typed in tests
  ResponsiveLine: ({ data, sliceTooltip }: any) => {
    capturedSliceTooltip = sliceTooltip;
    return (
      <div data-testid="mock-chart">
        {/* We serialize the data to JSON so we can read it in our assertions */}
        {JSON.stringify(data)}
      </div>
    );
  },
}));

// ChartTooltipPortal renders into a portal/document.body — stub it to inline so the
// tooltip's rendered text is queryable within the test container.
vi.mock('../../../../components/Charts/ChartTooltipPortal', () => ({
  ChartTooltipPortal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// Mock the RangeSlider. We replace the complex slider with simple inputs
// so we can easily trigger 'onChange' without fighting mouse events.
vi.mock('../../../../components/Layout/InputFields/RangeSlider', () => ({
  RangeSlider: ({ onChange, min, max }: any) => (
    <div data-testid="mock-slider">
      <span>Min: {min}, Max: {max}</span>
      <button
        data-testid="trigger-range-change"
        onClick={() => onChange([2026, 2027])} // Hardcode a change for testing
      >
        Change Range
      </button>
    </div>
  ),
}));

// Toggled by individual tests to exercise the "qualifies for SS" gate.
let mockQualifiesForSocialSecurity = false;

// Mock the AssumptionsContext
vi.mock('../../../../components/Objects/Assumptions/AssumptionsContext', () => ({
  useAssumptions: () => ({
    assumptions: {
      demographics: {
        startAge: 30,
        startYear: 2024,
      },
      macro: {
        inflationRate: 3,
      },
      income: {
        qualifiesForSocialSecurity: mockQualifiesForSocialSecurity,
      },
      milestones: [
        { id: 'BUILTIN_BIRTH', name: 'Birth', conditions: [{ type: 'YEAR', operator: '=', value: 1990 }] },
        { id: 'BUILTIN_RETIRE', name: 'Retire', conditions: [{ type: 'AGE', operator: '>=', value: 65 }] },
        { id: 'BUILTIN_END_OF_PLAN', name: 'End of Plan', conditions: [{ type: 'AGE', operator: '>=', value: 90 }] },
      ],
    },
  }),
  getBirthYear: () => 1990,
}));

// -----------------------------------------------------------------------------
// 2. Helper Functions (Data Generation)
// -----------------------------------------------------------------------------

const createMockYear = (year: number): SimulationYear => ({
    year,
    incomes: [],
    expenses: [],
    accounts: [],
    cashflow: { totalIncome: 0, totalExpense: 0, livingExpenses: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
    logs: [],
});

describe('OverviewTab', () => {

    it('renders the slider and chart container', () => {
        render(<OverviewTab simulationData={[]} />);
        
        expect(screen.getByTestId('mock-slider')).toBeInTheDocument();
        expect(screen.getByTestId('mock-chart')).toBeInTheDocument();
    });

    it('correctly aggregates assets and debts for the chart', () => {
        // Setup: Create 1 year of data with various account types
        const year2025 = createMockYear(2025);
        
        // Add Assets
        year2025.accounts.push(new InvestedAccount('inv1', 'Stocks', 100000, 0, 0, 0, 'Brokerage', true, 0));
        year2025.accounts.push(new SavedAccount('sav1', 'Cash', 20000));
        year2025.accounts.push(new PropertyAccount('prop1', 'House', 300000, 'Financed', 250000, 250000, 'mort1'));
        year2025.accounts.push(new DebtAccount('debt1', 'Student Loan', 15000, 'loan1', 5));

        // Add Debts (Expenses)
        // Note: Your code looks for LoanExpense and MortgageExpense specifically
        year2025.expenses.push(new LoanExpense('loan1', 'Student Loan', 15000, 'Monthly', 5, 'Compounding', 0, 'No', 0, 'debt1', new Date())); // Assuming signature matches your model
        // Mock a mortgage expense roughly matching your model's expected shape
    
        const mortgage = new MortgageExpense('mort1', 'Home Loan', 'Monthly', 300000, 250000, 250000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Yes', 0, 'prop1', new Date());
        year2025.expenses.push(mortgage);

        render(<OverviewTab simulationData={[year2025]} />);

        const chartDataStr = screen.getByTestId('mock-chart').textContent;
        const chartData: ChartSeries[] = JSON.parse(chartDataStr || '[]');

        // Check Invested Series
        const investedSeries = chartData.find(s => s.id === 'Invested')!;
        expect(investedSeries.data[0].y).toBe(100000);

        // Check Saved Series
        const savedSeries = chartData.find(s => s.id === 'Saved')!;
        expect(savedSeries.data[0].y).toBe(20000);

        // Check Property Series
        const propertySeries = chartData.find(s => s.id === 'Property')!;
        expect(propertySeries.data[0].y).toBe(300000);

        // Check Debt Series (Should be negative)
        // Debt includes: DebtAccount (15000) + MortgageExpense (250000) = 265000
        // Note: LoanExpense is NOT double-counted — DebtAccount already tracks the linked balance
        const debtSeries = chartData.find(s => s.id === 'Debt')!;
        expect(debtSeries.data[0].y).toBe(-265000);
    });

    // #143: the Net Worth tooltip leads with VESTED net worth. The plotted asset/debt
    // bands stay GROSS, but each point embeds the year's Unvested employer match so the
    // tooltip can net it out and also surface the gross figure. A separate "Net Worth"
    // (Vested) line is plotted so the headline has a visible anchor on the chart.
    it('embeds Unvested, keeps the asset bands gross, and plots a Vested Net Worth line', () => {
        const year2025 = createMockYear(2025);
        // InvestedAccount args: (id, name, amount, employerBalance, tenureYears,
        //   expenseRatio, taxType, isContributionEligible, vestedPerYear, ...)
        // 40k employer, 1yr at 20%/yr graded => 20% vested => 32k unvested.
        year2025.accounts.push(new InvestedAccount('inv1', '401k', 100000, 40000, 1, 0.1, 'Traditional 401k', true, 0.2));
        year2025.accounts.push(new SavedAccount('sav1', 'Cash', 20000));

        render(<OverviewTab simulationData={[year2025]} />);
        const chartData: ChartSeries[] = JSON.parse(screen.getByTestId('mock-chart').textContent || '[]');

        // The four gross bands plus the Vested "Net Worth" emphasis line — Unvested is
        // NOT its own series.
        const seriesIds = chartData.map(s => s.id).sort();
        expect(seriesIds).toEqual(['Debt', 'Invested', 'Net Worth', 'Property', 'Saved']);

        // Bands remain GROSS: the full 100k 401k balance is in Invested.
        const investedSeries = chartData.find(s => s.id === 'Invested')!;
        expect(investedSeries.data[0].y).toBe(100000);

        // Every point carries the year's Unvested figure for the tooltip.
        const point = investedSeries.data[0];
        expect(point.Unvested).toBe(32000);

        // Gross net worth = sum of bands = 100k + 20k + 0 - 0 = 120k.
        // Vested = gross - unvested = 120k - 32k = 88k (what the tooltip headlines).
        const num = (v: number | string | boolean | undefined) => (typeof v === 'number' ? v : 0);
        const gross = num(point.Invested) + num(point.Saved) + num(point.Property) + num(point.Debt);
        expect(gross).toBe(120000);
        expect(gross - num(point.Unvested)).toBe(88000);

        // The "Net Worth" line plots the Vested figure (88k), so the tooltip headline
        // lands on a visible mark — matching the Dashboard's lead-with-Vested pattern.
        const netWorthSeries = chartData.find(s => s.id === 'Net Worth')!;
        expect(netWorthSeries.data[0].y).toBe(88000);
    });

    // #143: render the slice tooltip itself and assert it leads with VESTED net worth
    // and surfaces the Unvested + Gross Net Worth lines (mirroring the Dashboard card).
    it('tooltip leads with Vested net worth and shows Unvested + Gross', () => {
        const year2025 = createMockYear(2025);
        year2025.accounts.push(new InvestedAccount('inv1', '401k', 100000, 40000, 1, 0.1, 'Traditional 401k', true, 0.2));
        year2025.accounts.push(new SavedAccount('sav1', 'Cash', 20000));

        render(<OverviewTab simulationData={[year2025]} />);
        expect(capturedSliceTooltip).toBeTypeOf('function');

        const chartData: ChartSeries[] = JSON.parse(screen.getByTestId('mock-chart').textContent || '[]');
        const investedSeries = chartData.find(s => s.id === 'Invested')!;
        // CustomTooltip destructures { slice } from its argument.
        const arg: SliceTooltipArg = { slice: { points: [{ data: investedSeries.data[0] }] } };

        render(<>{capturedSliceTooltip!(arg)}</>);

        // Unvested line is present (32k), Net Worth headline is VESTED (88k = 120k - 32k),
        // and the Gross Net Worth (120k) is surfaced.
        expect(screen.getByText('Unvested:')).toBeInTheDocument();
        expect(screen.getByText('Net Worth:')).toBeInTheDocument();
        expect(screen.getByText('Gross Net Worth:')).toBeInTheDocument();
        // formatCompactCurrency: < $100K renders exact, >= $100K uses the K suffix.
        expect(screen.getByText('$32,000')).toBeInTheDocument();  // unvested
        expect(screen.getByText('$88,000')).toBeInTheDocument();  // vested net worth
        expect(screen.getByText('$120.0K')).toBeInTheDocument();  // gross net worth
    });

    it('filters data based on the range slider', async () => {
        // Setup: Create 5 years of data (2025 - 2029)
        const data = [2025, 2026, 2027, 2028, 2029].map(year => createMockYear(year));

        render(<OverviewTab simulationData={data} />);

        // 1. Initial State: Should likely show all data or the default range logic
        // We know the default max is min + 32, so it should show all 5 years initially.
        let chartData = JSON.parse(screen.getByTestId('mock-chart').textContent || '[]');
        expect(chartData[0].data).toHaveLength(5); // 2025, 26, 27, 28, 29

        // 2. Interaction: Simulate changing the slider to 2026-2027
        // (Using our mock button which triggers onChange([2026, 2027]))
        fireEvent.click(screen.getByTestId('trigger-range-change'));

        // 3. Verify Filtering
        chartData = JSON.parse(screen.getByTestId('mock-chart').textContent || '[]');
        const points = chartData[0].data;

        expect(points).toHaveLength(2);
        expect(points[0].x).toBe('2026');
        expect(points[1].x).toBe('2027');
    });

    it('handles empty simulation data without crashing', () => {
        render(<OverviewTab simulationData={[]} />);
        
        // Should just render empty chart data
        const chartData = JSON.parse(screen.getByTestId('mock-chart').textContent || '[]');
        expect(chartData).toHaveLength(5); // 4 gross bands + the Vested "Net Worth" line
        expect(chartData[0].data).toHaveLength(0); // No data points
    });

    it('sets the correct min and max on the slider', () => {
        const data = [createMockYear(2025), createMockYear(2035)];
        render(<OverviewTab simulationData={data} />);

        const sliderText = screen.getByTestId('mock-slider').textContent;
        expect(sliderText).toContain('Min: 2025');
        expect(sliderText).toContain('Max: 2035');
    });

    // Regression coverage for the false "Social Security Not Configured" banner
    // (2026-06-24 review, #36): the check used `instanceof FutureSocialSecurityIncome`
    // only, so a user already collecting via a Current SS income still saw the
    // "add a Future Social Security income" prompt.
    describe('missing Social Security warning', () => {
        const WARNING = 'Social Security Not Configured';

        afterEach(() => { mockQualifiesForSocialSecurity = false; });

        it('shows the warning when SS is qualified but no SS income exists', () => {
            mockQualifiesForSocialSecurity = true;
            render(<OverviewTab simulationData={[createMockYear(2025)]} />);
            expect(screen.getByText(WARNING)).toBeInTheDocument();
        });

        it('does NOT show the warning when a Future SS income exists', () => {
            mockQualifiesForSocialSecurity = true;
            const year = createMockYear(2025);
            year.incomes.push(new FutureSocialSecurityIncome('ss1', 'Social Security', 67, 2000));
            render(<OverviewTab simulationData={[year]} />);
            expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
        });

        it('does NOT show the warning when a Current SS income exists (the #36 bug)', () => {
            mockQualifiesForSocialSecurity = true;
            const year = createMockYear(2025);
            year.incomes.push(new CurrentSocialSecurityIncome('ss1', 'Social Security', 2000, 'Monthly'));
            render(<OverviewTab simulationData={[year]} />);
            expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
        });

        it('does NOT show the warning when the user does not qualify for SS', () => {
            mockQualifiesForSocialSecurity = false;
            render(<OverviewTab simulationData={[createMockYear(2025)]} />);
            expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
        });
    });
});