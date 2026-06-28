import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { WorkIncomeFields } from '../../../../components/Objects/Income/card/WorkIncomeFields';
import { WorkIncome, hasIncomeEnded } from '../../../../components/Objects/Income/models';
import { rsuGrantNeedsAccount, esppGrantNeedsAccount } from '../../../../components/Objects/Income/incomeCardUtils';
import type { InvestedAccount, RSUAccount, ESPPAccount } from '../../../../components/Objects/Accounts/models';

// Mirror IncomeCard's wiring: `needsRsuAccount`/`needsEsppAccount` are REQUIRED props,
// derived ONCE in IncomeCard as `!hasIncomeEnded(income) && …GrantNeedsAccount(…)` and
// passed down (the single source of the ended-job suppression rule). These helpers
// reproduce that derivation so each render exercises the real card path.
const needsRsu = (income: WorkIncome, rsuAccounts: RSUAccount[]) =>
    !hasIncomeEnded(income) && rsuGrantNeedsAccount(income, rsuAccounts);
const needsEspp = (income: WorkIncome, esppAccounts: ESPPAccount[]) =>
    !hasIncomeEnded(income) && esppGrantNeedsAccount(income, esppAccounts);

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
            needsRsuAccount={needsRsu(income, [])}
            needsEsppAccount={needsEspp(income, [])}
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
function makeRsuIncome(rsuAccountId: string | null, rsuGrantShares = 100): WorkIncome {
    const income = new WorkIncome(
        'inc-rsu', 'Engineer', 120_000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED', undefined, undefined, 0
    );
    income.rsuVestingSchedule = 'cliff-1yr';
    income.rsuGrantShares = rsuGrantShares;
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
            needsRsuAccount={needsRsu(income, rsuAccounts)}
            needsEsppAccount={needsEspp(income, [])}
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

    it('SHOWS the warning for a DANGLING account id (linked account was deleted) (#1)', () => {
        // The grant points at an id that is NOT among the existing accounts — the old
        // `!rsuAccountId` check treated the truthy id as "linked" and stayed silent.
        renderRsuCard(makeRsuIncome('deleted-acct'), [rsuAcct('rsu-1', 'My RSU')]);
        expect(screen.getByText('RSU grant has no linked account')).toBeInTheDocument();
    });

    it('does NOT show the warning for a 0-share grant (not an active grant) (#3)', () => {
        // A schedule with zero shares never vests — isActiveRSUGrant is false, so the
        // warning must not fire and send the user on a pointless account-linking errand.
        renderRsuCard(makeRsuIncome(null, 0), [rsuAcct('rsu-1', 'My RSU')]);
        expect(screen.queryByText('RSU grant has no linked account')).not.toBeInTheDocument();
    });

    it('renders the Add-RSU-account deep link at the card level when NO RSU accounts exist (#7)', () => {
        // The no-accounts branch renders <AddStockAccountLink> (a react-router Link), so
        // it needs a Router — this is the in-app no-accounts case the suite hadn't covered.
        render(
            <MemoryRouter>
                <WorkIncomeFields
                    income={makeRsuIncome(null)}
                    onFieldUpdate={() => {}}
                    contributionAccounts={[]}
                    esppAccounts={[]}
                    rsuAccounts={[]}
                    contributionWarnings={null}
                    onMatchAccountChange={() => {}}
                    needsRsuAccount={needsRsu(makeRsuIncome(null), [])}
                    needsEsppAccount={false}
                />
            </MemoryRouter>
        );
        expect(screen.getByText('RSU grant has no linked account')).toBeInTheDocument();
        const link = screen.getByRole('link', { name: 'Add RSU account' });
        expect(link).toHaveAttribute('href', '/current/accounts?tab=Invested');
    });
});

/**
 * #8 (review of #141) — the symmetric ESPP case: a configured ESPP contribution
 * with no linked account must surface the same card-level warning, not stay buried
 * in the collapsible ESPP section.
 */
function makeEsppIncome(esppAccountId: string | null, esppContributionAmount = 10): WorkIncome {
    const income = new WorkIncome(
        'inc-espp', 'Engineer', 120_000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED', undefined, undefined, 0
    );
    income.esppContributionType = 'PERCENTAGE';
    income.esppContributionAmount = esppContributionAmount;
    income.esppAccountId = esppAccountId;
    return income;
}

const esppAcct = (id: string, name: string) =>
    ({ id, name } as unknown as ESPPAccount);

function renderEsppCard(income: WorkIncome, esppAccounts: ESPPAccount[]) {
    return render(
        <WorkIncomeFields
            income={income}
            onFieldUpdate={() => {}}
            contributionAccounts={[]}
            esppAccounts={esppAccounts}
            rsuAccounts={[]}
            contributionWarnings={null}
            onMatchAccountChange={() => {}}
            needsRsuAccount={needsRsu(income, [])}
            needsEsppAccount={needsEspp(income, esppAccounts)}
        />
    );
}

describe('Card WorkIncomeFields — card-level missing-ESPP-account warning (#8)', () => {
    it('shows the card-level ESPP warning while the section is collapsed (account exists, none selected)', () => {
        renderEsppCard(makeEsppIncome(null), [esppAcct('espp-1', 'My ESPP')]);
        expect(screen.getByText('ESPP contribution has no linked account')).toBeInTheDocument();
    });

    it('SHOWS the ESPP warning for a dangling account id', () => {
        renderEsppCard(makeEsppIncome('deleted-acct'), [esppAcct('espp-1', 'My ESPP')]);
        expect(screen.getByText('ESPP contribution has no linked account')).toBeInTheDocument();
    });

    it('does NOT show the ESPP warning once an account is linked or when contribution is NONE', () => {
        renderEsppCard(makeEsppIncome('espp-1'), [esppAcct('espp-1', 'My ESPP')]);
        expect(screen.queryByText('ESPP contribution has no linked account')).not.toBeInTheDocument();

        const none = makeEsppIncome(null);
        none.esppContributionType = 'NONE';
        renderEsppCard(none, [esppAcct('espp-1', 'My ESPP')]);
        expect(screen.queryByText('ESPP contribution has no linked account')).not.toBeInTheDocument();
    });

    it('does NOT show the ESPP warning for a 0-amount contribution (mirrors RSU 0-share)', () => {
        // PERCENTAGE type but 0% — nothing is purchased, so no account is needed yet.
        renderEsppCard(makeEsppIncome(null, 0), [esppAcct('espp-1', 'My ESPP')]);
        expect(screen.queryByText('ESPP contribution has no linked account')).not.toBeInTheDocument();
    });

    it('renders the Add-ESPP-account deep link at the card level when NO ESPP accounts exist', () => {
        // No-accounts branch renders <AddStockAccountLink> (a react-router Link) → Router.
        render(
            <MemoryRouter>
                <WorkIncomeFields
                    income={makeEsppIncome(null)}
                    onFieldUpdate={() => {}}
                    contributionAccounts={[]}
                    esppAccounts={[]}
                    rsuAccounts={[]}
                    contributionWarnings={null}
                    onMatchAccountChange={() => {}}
                    needsRsuAccount={false}
                    needsEsppAccount={needsEspp(makeEsppIncome(null), [])}
                />
            </MemoryRouter>
        );
        expect(screen.getByText('ESPP contribution has no linked account')).toBeInTheDocument();
        const link = screen.getByRole('link', { name: 'Add ESPP account' });
        expect(link).toHaveAttribute('href', '/current/accounts?tab=Invested');
    });
});
