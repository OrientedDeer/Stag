import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { RSUFields } from '../../../../components/Objects/Income/card/RSUFields';
import { ESPPFields } from '../../../../components/Objects/Income/card/ESPPFields';
import { WorkIncome } from '../../../../components/Objects/Income/models';

/**
 * #141 — the missing-RSU/ESPP-account warnings on the income CARD deep-link to
 * the Accounts › Invested sub-tab (where the +Add RSU / +Add ESPP buttons live).
 * The shared AddStockAccountLink renders a react-router <Link>, so each test
 * wraps the field component in a MemoryRouter.
 *
 * RSUFields/ESPPFields are now value-based shared components (#140), so these
 * pass the field values + showAccountLink (the card-side behavior) directly.
 * The card sets showAccountLink; the modal omits it (text-only — covered in
 * WorkIncomeFieldsModal.test.tsx's "no deep link" case).
 */

function makeIncome(): WorkIncome {
    return new WorkIncome(
        'inc-1', 'My Job', 100_000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED', undefined, undefined, 0
    );
}

describe('#141 RSU card warning — Add Account deep link', () => {
    it('renders an "Add RSU account" link to /current/accounts?tab=Invested when no RSU account exists', () => {
        const income = makeIncome();
        income.rsuVestingSchedule = 'cliff-1yr';
        income.rsuGrantShares = 100;

        render(
            <MemoryRouter>
                <RSUFields values={income} onUpdate={() => {}} rsuAccounts={[]} idPrefix={income.id} showAccountLink />
            </MemoryRouter>
        );

        expect(screen.getByText('No RSU Account')).toBeInTheDocument();
        const link = screen.getByRole('link', { name: 'Add RSU account' });
        expect(link).toHaveAttribute('href', '/current/accounts?tab=Invested');
    });
});

describe('#141 ESPP card warning — Add Account deep link', () => {
    it('renders an "Add ESPP account" link to /current/accounts?tab=Invested when no ESPP account exists', () => {
        const income = makeIncome();
        income.esppContributionType = 'PERCENTAGE';
        income.esppContributionAmount = 10;

        render(
            <MemoryRouter>
                <ESPPFields values={income} onUpdate={() => {}} esppAccounts={[]} idPrefix={income.id} showAccountLink />
            </MemoryRouter>
        );

        expect(screen.getByText('No ESPP Account')).toBeInTheDocument();
        const link = screen.getByRole('link', { name: 'Add ESPP account' });
        expect(link).toHaveAttribute('href', '/current/accounts?tab=Invested');
    });

    it('converted the raw-Tailwind warning box to an AlertBanner (no raw bg-warning-tint div wrapper)', () => {
        const income = makeIncome();
        income.esppContributionType = 'PERCENTAGE';
        income.esppContributionAmount = 10;

        const { container } = render(
            <MemoryRouter>
                <ESPPFields values={income} onUpdate={() => {}} esppAccounts={[]} idPrefix={income.id} showAccountLink />
            </MemoryRouter>
        );

        // The old hand-rolled box used `rounded-lg`; the AlertBanner uses `rounded-xl`.
        expect(container.querySelector('div.rounded-lg')).toBeNull();
    });
});
