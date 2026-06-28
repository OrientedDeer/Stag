import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { RSUFields } from '../../../../components/Objects/Income/card/RSUFields';
import { ESPPFields } from '../../../../components/Objects/Income/card/ESPPFields';
import { WorkIncome, hasIncomeEnded } from '../../../../components/Objects/Income/models';

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

// A fixed end date a full year in the PAST → hasIncomeEnded() reads true.
function pastEndDate(): Date {
    const today = new Date();
    return new Date(today.getFullYear() - 1, today.getMonth(), 15);
}

// A fixed end date well in the FUTURE → hasIncomeEnded() reads false (still active).
function futureEndDate(): Date {
    const today = new Date();
    return new Date(today.getFullYear() + 2, today.getMonth(), 15);
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

    it('suppresses the in-section missing-account banners when showMissingAccountWarning=false (#141)', () => {
        // The CARD renders a more prominent card-level copy outside the collapsible
        // RSU section, so it passes showMissingAccountWarning={false} to avoid a
        // duplicate. The grant fields still render; only the in-section banners go.
        const income = makeIncome();
        income.rsuVestingSchedule = 'cliff-1yr';
        income.rsuGrantShares = 100;

        // No router needed: suppressing the banner also removes the <Link> inside it.
        render(
            <RSUFields
                values={income}
                onUpdate={() => {}}
                rsuAccounts={[]}
                idPrefix={income.id}
                showAccountLink
                showMissingAccountWarning={false}
            />
        );

        expect(screen.queryByText('No RSU Account')).not.toBeInTheDocument();
        expect(screen.queryByText('RSU Account Not Linked')).not.toBeInTheDocument();
        // The cluster itself still renders (the schedule field label is present).
        expect(screen.getByText('Vesting Schedule')).toBeInTheDocument();
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

/**
 * finding 4 — an ENDED job (fixed end date in a PAST month) whose RSU/ESPP grant
 * has no linked account should NOT show the in-section missing-account banner: a
 * finished grant can no longer vest/purchase, so the warning is pure noise. The
 * `incomeEnded` prop (driven by hasIncomeEnded) folds into the existing
 * showMissingAccountWarning gate. An ACTIVE (or future-ending) job still warns.
 *
 * The Add-Income modal never passes incomeEnded, so the prop defaults false and
 * the modal warns exactly as before (the default-true cases above still pass).
 */
describe('finding 4 — suppress in-section missing-account banner for an ENDED job', () => {
    it('hides the "No RSU Account" banner for an ended job, keeps it for an active one', () => {
        const ended = makeIncome();
        ended.end_date = pastEndDate();
        ended.rsuVestingSchedule = 'cliff-1yr';
        ended.rsuGrantShares = 100;
        expect(hasIncomeEnded(ended)).toBe(true);

        const { unmount } = render(
            <RSUFields
                values={ended}
                onUpdate={() => {}}
                rsuAccounts={[]}
                idPrefix={ended.id}
                showAccountLink
                incomeEnded={hasIncomeEnded(ended)}
            />
        );
        // Ended job → banner suppressed even though the grant has no account.
        expect(screen.queryByText('No RSU Account')).not.toBeInTheDocument();
        // The grant cluster itself still renders (only the warning is gone).
        expect(screen.getByText('Vesting Schedule')).toBeInTheDocument();
        unmount();

        const active = makeIncome();
        active.end_date = futureEndDate();
        active.rsuVestingSchedule = 'cliff-1yr';
        active.rsuGrantShares = 100;
        expect(hasIncomeEnded(active)).toBe(false);

        render(
            <MemoryRouter>
                <RSUFields
                    values={active}
                    onUpdate={() => {}}
                    rsuAccounts={[]}
                    idPrefix={active.id}
                    showAccountLink
                    incomeEnded={hasIncomeEnded(active)}
                />
            </MemoryRouter>
        );
        // Active job → banner still rendered.
        expect(screen.getByText('No RSU Account')).toBeInTheDocument();
    });

    it('hides the "No ESPP Account" banner for an ended job, keeps it for an active one', () => {
        const ended = makeIncome();
        ended.end_date = pastEndDate();
        ended.esppContributionType = 'PERCENTAGE';
        ended.esppContributionAmount = 10;
        expect(hasIncomeEnded(ended)).toBe(true);

        const { unmount } = render(
            <ESPPFields
                values={ended}
                onUpdate={() => {}}
                esppAccounts={[]}
                idPrefix={ended.id}
                showAccountLink
                incomeEnded={hasIncomeEnded(ended)}
            />
        );
        // Ended job → banner suppressed.
        expect(screen.queryByText('No ESPP Account')).not.toBeInTheDocument();
        // The contribution cluster itself still renders.
        expect(screen.getByText('ESPP Contribution')).toBeInTheDocument();
        unmount();

        const active = makeIncome();
        active.end_date = futureEndDate();
        active.esppContributionType = 'PERCENTAGE';
        active.esppContributionAmount = 10;
        expect(hasIncomeEnded(active)).toBe(false);

        render(
            <MemoryRouter>
                <ESPPFields
                    values={active}
                    onUpdate={() => {}}
                    esppAccounts={[]}
                    idPrefix={active.id}
                    showAccountLink
                    incomeEnded={hasIncomeEnded(active)}
                />
            </MemoryRouter>
        );
        // Active job → banner still rendered.
        expect(screen.getByText('No ESPP Account')).toBeInTheDocument();
    });
});
