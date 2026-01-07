import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom'; // Helper for "toBeInTheDocument"
import { SimulationYear } from '../../../../components/Objects/Assumptions/SimulationEngine';
import { OverviewTab } from '../../../../tabs/Future/tabs/OverviewTab';

// --- 1. Mock the Heavy Chart Libraries ---
// This prevents "ResizeObserver is not defined" errors in the test console.
vi.mock('@nivo/line', () => ({
    ResponsiveLine: () => <div data-testid="nivo-chart">Mocked Line Chart</div>
}));

// --- 2. Create Minimal Mock Data ---
// We don't need real accounts, just the structure the tab expects (arrays to reduce)
const mockSimulationData: SimulationYear[] = [
    {
        year: 2025,
        accounts: [],
        expenses: [],
        incomes: [],
        cashflow: { 
            totalIncome: 100000, 
            totalExpense: 50000, 
            discretionary: 0, 
            investedUser: 0, 
            investedMatch: 0, 
            totalInvested: 0, 
            bucketAllocations: 0, 
            bucketDetail: {} 
        },
        taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0 },
        logs: []
    },
    {
        year: 2026,
        accounts: [],
        expenses: [],
        incomes: [],
        cashflow: { 
            totalIncome: 100000, 
            totalExpense: 50000, 
            discretionary: 0, 
            investedUser: 0, 
            investedMatch: 0, 
            totalInvested: 0, 
            bucketAllocations: 0, 
            bucketDetail: {} 
        },
        taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0 },
        logs: []
    }
];

describe('OverviewTab Component', () => {

    it('renders without crashing', () => {
        render(<OverviewTab simulationData={mockSimulationData} />);
        
        // 1. Check if the "Timeline" slider header is present
        expect(screen.getByText(/Timeline/i)).toBeInTheDocument();
    });

    it('renders the Nivo chart with data', () => {
        render(<OverviewTab simulationData={mockSimulationData} />);

        // 2. Check if our mocked chart actually appeared
        // This confirms your component successfully calculated "lineData" and tried to render the child
        expect(screen.getByTestId('nivo-chart')).toBeInTheDocument();
        expect(screen.getByText('Mocked Line Chart')).toBeInTheDocument();
    });

    it('handles empty data gracefully', () => {
        // 3. Edge Case: What if simulation is empty? (e.g., before run)
        // Your component should probably render, or at least not explode.
        render(<OverviewTab simulationData={[]} />);
        
        // It should likely still render the structure (or a "No Data" message if you added one)
        // Since your current code defaults minYear/maxYear, it should render safely.
        expect(screen.getByText(/Timeline/i)).toBeInTheDocument();
    });

});