import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WorkIncomeFields } from '../../../../components/Objects/Income/card/WorkIncomeFields';
import { WorkIncome } from '../../../../components/Objects/Income/models';
import type { InvestedAccount } from '../../../../components/Objects/Accounts/models';

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
