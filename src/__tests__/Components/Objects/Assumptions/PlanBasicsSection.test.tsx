import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PlanBasicsSection from '../../../../components/Objects/Assumptions/PlanBasicsSection';
import {
    AssumptionsContext,
    defaultAssumptions,
    BUILTIN_MILESTONE_IDS,
} from '../../../../components/Objects/Assumptions/AssumptionsContext';
import type { AssumptionsState } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import type { CustomMilestone } from '../../../../services/simulation/types';

const CURRENT_YEAR = new Date().getFullYear();

// Invented, non-default numbers so we know the values came from the seeded
// milestones and not from the built-in defaults (1990 / 65 / 90).
const seededMilestones: CustomMilestone[] = [
    { id: BUILTIN_MILESTONE_IDS.BIRTH, name: 'Birth', conditions: [{ type: 'YEAR', operator: '=', value: 1987 }] },
    { id: BUILTIN_MILESTONE_IDS.RETIRE, name: 'Retire', conditions: [{ type: 'AGE', operator: '>=', value: 58 }] },
    { id: BUILTIN_MILESTONE_IDS.END_OF_PLAN, name: 'End of Plan', conditions: [{ type: 'AGE', operator: '>=', value: 93 }] },
];

function renderSection({
    milestones = seededMilestones,
    onOpenMilestones,
}: {
    milestones?: CustomMilestone[];
    onOpenMilestones?: () => void;
} = {}) {
    const dispatch = vi.fn();
    const state: AssumptionsState = { ...defaultAssumptions, milestones };
    render(
        <AssumptionsContext.Provider value={{ state, dispatch }}>
            <PlanBasicsSection onOpenMilestones={onOpenMilestones} />
        </AssumptionsContext.Provider>
    );
    return { dispatch };
}

describe('PlanBasicsSection values and captions', () => {
    it('renders the three values from the seeded built-in milestones', () => {
        renderSection();

        expect(screen.getByLabelText('Birth Year')).toHaveValue('1987');
        expect(screen.getByLabelText('Retirement Age')).toHaveValue('58');
        expect(screen.getByLabelText('Life Expectancy')).toHaveValue('93');
    });

    it('anchors each value with a derived caption', () => {
        renderSection();

        // Age today = current year − birth year
        expect(screen.getByText(`Age ${CURRENT_YEAR - 1987} in ${CURRENT_YEAR}`)).toBeInTheDocument();
        // Retirement year = birth year + retirement age
        expect(screen.getByText('Retires in 2045')).toBeInTheDocument();
        // Plan end year = birth year + life expectancy
        expect(screen.getByText('Plan ends 2080')).toBeInTheDocument();
    });
});

describe('PlanBasicsSection editing', () => {
    it('dispatches UPDATE_MILESTONE on the Birth milestone when the birth year changes', () => {
        const { dispatch } = renderSection();

        fireEvent.change(screen.getByLabelText('Birth Year'), { target: { value: '1992' } });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_MILESTONE',
            payload: {
                id: BUILTIN_MILESTONE_IDS.BIRTH,
                name: 'Birth',
                conditions: [{ type: 'YEAR', operator: '=', value: 1992 }],
            },
        });
    });

    it('dispatches UPDATE_MILESTONE on the Retire milestone when the retirement age changes', () => {
        const { dispatch } = renderSection();

        fireEvent.change(screen.getByLabelText('Retirement Age'), { target: { value: '62' } });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_MILESTONE',
            payload: {
                id: BUILTIN_MILESTONE_IDS.RETIRE,
                name: 'Retire',
                conditions: [{ type: 'AGE', operator: '>=', value: 62 }],
            },
        });
    });

    it('dispatches UPDATE_MILESTONE on the End of Plan milestone when life expectancy changes', () => {
        const { dispatch } = renderSection();

        fireEvent.change(screen.getByLabelText('Life Expectancy'), { target: { value: '97' } });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_MILESTONE',
            payload: {
                id: BUILTIN_MILESTONE_IDS.END_OF_PLAN,
                name: 'End of Plan',
                conditions: [{ type: 'AGE', operator: '>=', value: 97 }],
            },
        });
    });
});

describe('PlanBasicsSection validation', () => {
    it('flags a life expectancy at or below the retirement age without coercing it', () => {
        const milestones: CustomMilestone[] = [
            seededMilestones[0],
            { id: BUILTIN_MILESTONE_IDS.RETIRE, name: 'Retire', conditions: [{ type: 'AGE', operator: '>=', value: 70 }] },
            { id: BUILTIN_MILESTONE_IDS.END_OF_PLAN, name: 'End of Plan', conditions: [{ type: 'AGE', operator: '>=', value: 65 }] },
        ];
        renderSection({ milestones });

        expect(screen.getByText('Must exceed retirement age (70)')).toBeInTheDocument();
        // The invalid value still displays — no silent clamping
        expect(screen.getByLabelText('Life Expectancy')).toHaveValue('65');
    });

    it('flags a birth year outside 1900–current year', () => {
        const milestones: CustomMilestone[] = [
            { id: BUILTIN_MILESTONE_IDS.BIRTH, name: 'Birth', conditions: [{ type: 'YEAR', operator: '=', value: 1850 }] },
            seededMilestones[1],
            seededMilestones[2],
        ];
        renderSection({ milestones });

        expect(screen.getByText(`Enter a year between 1900 and ${CURRENT_YEAR}`)).toBeInTheDocument();
    });
});

describe('PlanBasicsSection custom-milestone row', () => {
    it('counts only non-built-in milestones and opens the manager on click', () => {
        const onOpenMilestones = vi.fn();
        const milestones: CustomMilestone[] = [
            ...seededMilestones,
            { id: 'MILE-1', name: 'Coast FIRE', conditions: [{ type: 'NET_WORTH', operator: '>=', value: 500000 }] },
            { id: 'MILE-2', name: 'Debt Free', conditions: [{ type: 'TOTAL_DEBT', operator: '<=', value: 0 }] },
        ];
        renderSection({ milestones, onOpenMilestones });

        expect(screen.getByText('2 custom milestones')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Manage custom milestones/ }));
        expect(onOpenMilestones).toHaveBeenCalledTimes(1);
    });

    it('shows a singular count with no custom milestones beyond one', () => {
        const milestones: CustomMilestone[] = [
            ...seededMilestones,
            { id: 'MILE-1', name: 'Coast FIRE', conditions: [{ type: 'NET_WORTH', operator: '>=', value: 500000 }] },
        ];
        renderSection({ milestones });

        expect(screen.getByText('1 custom milestone')).toBeInTheDocument();
    });
});
