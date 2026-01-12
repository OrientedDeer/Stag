import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SimulationYear } from '../../../../components/Objects/Assumptions/SimulationEngine';
import { OverviewTab } from '../../../../tabs/Future/tabs/OverviewTab';
import { DebtAccount, InvestedAccount, PropertyAccount, SavedAccount } from '../../../../components/Objects/Accounts/models';
import { LoanExpense, MortgageExpense } from '../../../../components/Objects/Expense/models';

// -----------------------------------------------------------------------------
// 1. Mocks
// -----------------------------------------------------------------------------

// Mock the Nivo Chart. We just want to know what 'data' it received.
vi.mock('@nivo/line', () => ({
  ResponsiveLine: ({ data }: any) => (
    <div data-testid="mock-chart">
      {/* We serialize the data to JSON so we can read it in our assertions */}
      {JSON.stringify(data)}
    </div>
  ),
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
    },
  }),
}));

// -----------------------------------------------------------------------------
// 2. Helper Functions (Data Generation)
// -----------------------------------------------------------------------------

const createMockYear = (year: number): SimulationYear => ({
    year,
    incomes: [],
    expenses: [],
    accounts: [],
    cashflow: { totalIncome: 0, totalExpense: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0 },
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
        const chartData = JSON.parse(chartDataStr || '[]');

        // Check Invested Series
        const investedSeries = chartData.find((s: any) => s.id === 'Invested');
        expect(investedSeries.data[0].y).toBe(100000);

        // Check Saved Series
        const savedSeries = chartData.find((s: any) => s.id === 'Saved');
        expect(savedSeries.data[0].y).toBe(20000);

        // Check Property Series
        const propertySeries = chartData.find((s: any) => s.id === 'Property');
        expect(propertySeries.data[0].y).toBe(300000);

        // Check Debt Series (Should be negative)
        const debtSeries = chartData.find((s: any) => s.id === 'Debt');
        expect(debtSeries.data[0].y).toBe(-265000); // -(15000 + 250000)
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
        expect(points[0].x).toBe(2026);
        expect(points[1].x).toBe(2027);
    });

    it('handles empty simulation data without crashing', () => {
        render(<OverviewTab simulationData={[]} />);
        
        // Should just render empty chart data
        const chartData = JSON.parse(screen.getByTestId('mock-chart').textContent || '[]');
        expect(chartData).toHaveLength(4); // 4 keys (Invested, Saved, etc)
        expect(chartData[0].data).toHaveLength(0); // No data points
    });

    it('sets the correct min and max on the slider', () => {
        const data = [createMockYear(2025), createMockYear(2035)];
        render(<OverviewTab simulationData={data} />);

        const sliderText = screen.getByTestId('mock-slider').textContent;
        expect(sliderText).toContain('Min: 2025');
        expect(sliderText).toContain('Max: 2035');
    });
});