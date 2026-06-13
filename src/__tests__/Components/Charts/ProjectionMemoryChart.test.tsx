import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ProjectionMemoryChart } from '../../../components/Charts/ProjectionMemoryChart';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { SimulationContext } from '../../../components/Objects/Assumptions/SimulationContext';

function renderChart(simulation: unknown[] = []) {
    render(
        <AccountContext.Provider value={{ accounts: [], amountHistory: {} }}>
            <SimulationContext.Provider value={{ simulation: simulation as never, inputHash: null, dispatch: () => {} }}>
                <ProjectionMemoryChart />
            </SimulationContext.Provider>
        </AccountContext.Provider>
    );
}

describe('ProjectionMemoryChart', () => {
    beforeEach(() => localStorage.clear());

    it('renders the heading and the two-causes note', () => {
        renderChart();
        expect(screen.getByText('Projection track record')).toBeInTheDocument();
        expect(screen.getByText(/changes you've made to your plan since/)).toBeInTheDocument();
    });

    it('shows an empty state when there is no projection or history', () => {
        renderChart();
        expect(screen.getByText(/No data yet/)).toBeInTheDocument();
    });
});
