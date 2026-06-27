import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WorkIncomeFields } from '../../../../components/Objects/Income/card/WorkIncomeFields';
import { WorkIncome } from '../../../../components/Objects/Income/models';
import type { InvestedAccount, RSUAccount } from '../../../../components/Objects/Accounts/models';

/**
 * Regression coverage for the #123 deferral-destination warning on the CARD
 * editor. The warning must render OUTSIDE the collapsible "401k & Match"
 * CardSection (which defaults to collapsed and unmounts its children), so a
 * dangling/empty destination is surfaced without the user expanding anything.
 * Previously the banner lived inside the section and was invisible while
 * collapsed — the leak it was meant to flag stayed hidden.
 */
function makeDeferralIncome(matchAccountId: string): WorkIncome {
    const income = new WorkIncome(
        'inc-1', 'My Job', 100_000, 'Annually', 'Yes',
        10_000, 0, 0, 0, '', null, 'FIXED', undefined, undefined, 0
    );
    income.autoMax401k = 'custom'; // a configured deferral ($10k pre-tax)
    income.matchAccountId = matchAccountId;
    income.employerMatch = 0; // no employer match — the reachable leak path
    return income;
}

const acct = (id: string, name: string) =>
    ({ id, name } as unknown as InvestedAccount);

function renderCard(income: WorkIncome, accounts: InvestedAccount[]) {
    return render(
        <WorkIncomeFields
            income={income}
            onFieldUpdate={() => {}}
            contributionAccounts={accounts}
            esppAccounts={[]}
            rsuAccounts={[]}
            contributionWarnings={null}
            onMatchAccountChange={() => {}}
        />
    );
}

describe('Card WorkIncomeFields — deferral-destination warning visibility', () => {
    it('shows the warning for an EMPTY destination while the 401k section is collapsed', () => {
        // Section is collapsed by default — do NOT expand it.
        renderCard(makeDeferralIncome(''), [acct('acc-1', 'My 401k')]);
        expect(screen.getByText('Destination Account Required')).toBeInTheDocument();
    });

    it('shows the warning for a DANGLING destination (deleted account) while collapsed', () => {
        // matchAccountId points at an account that is not in the list.
        renderCard(makeDeferralIncome('deleted-acc'), [acct('acc-1', 'My 401k')]);
        expect(screen.getByText('Destination Account Required')).toBeInTheDocument();
    });

    it('shows no warning when the deferral has a valid destination', () => {
        renderCard(makeDeferralIncome('acc-1'), [acct('acc-1', 'My 401k')]);
        expect(screen.queryByText('Destination Account Required')).not.toBeInTheDocument();
    });
});

/**
 * #141 — the "no linked RSU account" warning must surface at the CARD level
 * (outside the collapsible RSU section) so a user who configures an RSU grant
 * but never links an account sees it on card open, without also expanding the
 * RSU section. The in-section copy is suppressed in the card to avoid a duplicate.
 */
function makeRsuIncome(rsuAccountId: string | null): WorkIncome {
    const income = new WorkIncome(
        'inc-rsu', 'Engineer', 120_000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED', undefined, undefined, 0
    );
    income.rsuVestingSchedule = 'cliff-1yr';
    income.rsuGrantShares = 100;
    income.rsuAccountId = rsuAccountId;
    return income;
}

const rsuAcct = (id: string, name: string) =>
    ({ id, name } as unknown as RSUAccount);

function renderRsuCard(income: WorkIncome, rsuAccounts: RSUAccount[]) {
    return render(
        <WorkIncomeFields
            income={income}
            onFieldUpdate={() => {}}
            contributionAccounts={[]}
            esppAccounts={[]}
            rsuAccounts={rsuAccounts}
            contributionWarnings={null}
            onMatchAccountChange={() => {}}
        />
    );
}

describe('Card WorkIncomeFields — card-level missing-RSU-account warning (#141)', () => {
    it('shows the card-level warning while the RSU section is collapsed (account exists, none selected)', () => {
        // An RSU account exists but the grant links to none → the no-Link text branch
        // (no router needed). The RSU section is collapsed; the warning must still show.
        renderRsuCard(makeRsuIncome(null), [rsuAcct('rsu-1', 'My RSU')]);
        expect(screen.getByText('RSU grant has no linked account')).toBeInTheDocument();
    });

    it('does NOT show the card-level warning once an RSU account is linked', () => {
        renderRsuCard(makeRsuIncome('rsu-1'), [rsuAcct('rsu-1', 'My RSU')]);
        expect(screen.queryByText('RSU grant has no linked account')).not.toBeInTheDocument();
    });

    it('does NOT show the warning when the income has no RSU grant configured', () => {
        const noGrant = makeRsuIncome(null);
        noGrant.rsuVestingSchedule = 'NONE';
        renderRsuCard(noGrant, [rsuAcct('rsu-1', 'My RSU')]);
        expect(screen.queryByText('RSU grant has no linked account')).not.toBeInTheDocument();
    });
});
