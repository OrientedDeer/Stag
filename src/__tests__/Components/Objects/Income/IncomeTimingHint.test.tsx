import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import IncomeCard from '../../../../components/Objects/Income/IncomeCard';
import { WorkIncome } from '../../../../components/Objects/Income/models';

/**
 * UI-sweep fix: a future-dated income used to render "$X/yr" in the list exactly
 * like a live one (while being absent from the Income Breakdown above). The
 * collapsed card now carries a muted "starts YYYY" badge (and "ended YYYY" for a
 * finished source). Contexts all have usable defaults, so the collapsed card
 * renders bare.
 */

function makeIncome(startDate?: Date, endDate?: Date): WorkIncome {
    const inc = new WorkIncome(
        'inc-1', 'Future Job', 100_000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED', undefined, undefined, 0
    );
    inc.startDate = startDate;
    inc.end_date = endDate;
    return inc;
}

const y = new Date().getFullYear();

describe('IncomeCard timing hint badge', () => {
    it('shows "starts YYYY" on a future-dated income', () => {
        render(<IncomeCard income={makeIncome(new Date(y + 9, 0, 1))} />);
        expect(screen.getByText(`starts ${y + 9}`)).toBeInTheDocument();
    });

    it('shows no hint on an active income', () => {
        render(<IncomeCard income={makeIncome(new Date(y - 2, 0, 1))} />);
        expect(screen.queryByText(/^starts \d{4}$/)).not.toBeInTheDocument();
        expect(screen.queryByText(/^ended \d{4}$/)).not.toBeInTheDocument();
    });

    it('shows "ended YYYY" on an income whose end date is past', () => {
        render(<IncomeCard income={makeIncome(new Date(y - 10, 0, 1), new Date(y - 2, 5, 15))} />);
        expect(screen.getByText(`ended ${y - 2}`)).toBeInTheDocument();
    });
});
