import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { RSUFields } from '../../../../components/Objects/Income/card/RSUFields';
import { ESPPFields } from '../../../../components/Objects/Income/card/ESPPFields';
import { WorkIncomeFields } from '../../../../components/Objects/Income/card/WorkIncomeFields';
import { WorkIncome, hasIncomeEnded } from '../../../../components/Objects/Income/models';
import { rsuGrantNeedsAccount, esppGrantNeedsAccount } from '../../../../components/Objects/Income/incomeCardUtils';

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
 * finding 4 / re-review 7 + 8 — an ENDED job (fixed end date in a PAST month) whose
 * RSU/ESPP grant has no linked account should NOT show the missing-account warning:
 * a finished grant can no longer vest/purchase, so the warning is pure noise. An
 * ACTIVE (or future-ending) job still warns.
 *
 * Production suppression is now a SINGLE source: IncomeCard derives
 * `needsRsuAccount`/`needsEsppAccount` (= `!incomeEnded && …GrantNeedsAccount(…)`) for
 * its header badge AND passes them DOWN to WorkIncomeFields, which uses them for the
 * card-level banners — so the header badge and the banner can never disagree (re-review
 * 8). The in-section RSU/ESPP banners are already off in the card via
 * showMissingAccountWarning={false}. So these cases render the real card-level path —
 * WorkIncomeFields with the derived booleans — exactly as IncomeCard wires it.
 *
 * Crucially, suppressing the BANNER must not suppress the editable grant SECTION: an
 * ended job still needs its grant fields accessible (to edit/correct the grant). Two
 * guarantees are pinned below: (a) the collapsible RSU/ESPP section + its summary line
 * stay present on the card for an ended job, and (b) the field clusters themselves
 * (RSUFields/ESPPFields, rendered directly) keep rendering the editable inputs — they
 * have no ended-job concept, so a regression that gated the cluster on "ended" would be
 * caught (finding 4 / re-review 4).
 *
 * The Add-Income modal renders a SEPARATE WorkIncomeFields (../WorkIncomeFields, no
 * `card/`) and never had an ended-job concept, so it warns exactly as before (the
 * default-true RSUFields/ESPPFields cases above still pass).
 */

// Mirror IncomeCard's wiring: derive the two booleans the way the card does and pass
// them down (this is the real single-source path the card uses). `incomeEnded` is also
// passed as the documented fallback.
function renderCard(income: WorkIncome) {
    const incomeEnded = hasIncomeEnded(income);
    return render(
        <MemoryRouter>
            <WorkIncomeFields
                income={income}
                onFieldUpdate={() => {}}
                contributionAccounts={[]}
                esppAccounts={[]}
                rsuAccounts={[]}
                contributionWarnings={null}
                onMatchAccountChange={() => {}}
                incomeEnded={incomeEnded}
                needsRsuAccount={!incomeEnded && rsuGrantNeedsAccount(income, [])}
                needsEsppAccount={!incomeEnded && esppGrantNeedsAccount(income, [])}
            />
        </MemoryRouter>
    );
}

// Fallback path: OMIT the derived booleans so WorkIncomeFields recomputes from
// `incomeEnded` + the predicates. Pins that the suppression still holds when a caller
// (e.g. a future surface) doesn't precompute the booleans.
function renderCardFallback(income: WorkIncome) {
    return render(
        <MemoryRouter>
            <WorkIncomeFields
                income={income}
                onFieldUpdate={() => {}}
                contributionAccounts={[]}
                esppAccounts={[]}
                rsuAccounts={[]}
                contributionWarnings={null}
                onMatchAccountChange={() => {}}
                incomeEnded={hasIncomeEnded(income)}
            />
        </MemoryRouter>
    );
}

describe('finding 4 / re-review 7 — card-level missing-account suppression for an ENDED job', () => {
    it('hides the RSU missing-account banner for an ended job, keeps it for an active one', () => {
        const ended = makeIncome();
        ended.end_date = pastEndDate();
        ended.rsuVestingSchedule = 'cliff-1yr';
        ended.rsuGrantShares = 100;
        expect(hasIncomeEnded(ended)).toBe(true);

        const { unmount } = renderCard(ended);
        // Ended job → card-level banner suppressed even though the grant has no account.
        expect(screen.queryByText('RSU grant has no linked account')).not.toBeInTheDocument();
        unmount();

        const active = makeIncome();
        active.end_date = futureEndDate();
        active.rsuVestingSchedule = 'cliff-1yr';
        active.rsuGrantShares = 100;
        expect(hasIncomeEnded(active)).toBe(false);

        renderCard(active);
        // Active job → card-level banner still rendered.
        expect(screen.getByText('RSU grant has no linked account')).toBeInTheDocument();
    });

    it('hides the ESPP missing-account banner for an ended job, keeps it for an active one', () => {
        const ended = makeIncome();
        ended.end_date = pastEndDate();
        ended.esppContributionType = 'PERCENTAGE';
        ended.esppContributionAmount = 10;
        expect(hasIncomeEnded(ended)).toBe(true);

        const { unmount } = renderCard(ended);
        // Ended job → card-level banner suppressed.
        expect(screen.queryByText('ESPP contribution has no linked account')).not.toBeInTheDocument();
        unmount();

        const active = makeIncome();
        active.end_date = futureEndDate();
        active.esppContributionType = 'PERCENTAGE';
        active.esppContributionAmount = 10;
        expect(hasIncomeEnded(active)).toBe(false);

        renderCard(active);
        // Active job → card-level banner still rendered.
        expect(screen.getByText('ESPP contribution has no linked account')).toBeInTheDocument();
    });

    // Fallback path (booleans omitted → WorkIncomeFields recomputes from incomeEnded).
    it('suppresses the banners for an ended job even when the derived booleans are omitted', () => {
        const ended = makeIncome();
        ended.end_date = pastEndDate();
        ended.rsuVestingSchedule = 'cliff-1yr';
        ended.rsuGrantShares = 100;
        ended.esppContributionType = 'PERCENTAGE';
        ended.esppContributionAmount = 10;
        expect(hasIncomeEnded(ended)).toBe(true);

        const { unmount } = renderCardFallback(ended);
        expect(screen.queryByText('RSU grant has no linked account')).not.toBeInTheDocument();
        expect(screen.queryByText('ESPP contribution has no linked account')).not.toBeInTheDocument();
        unmount();

        // …and still warns for an active job through the same fallback path.
        const active = makeIncome();
        active.end_date = futureEndDate();
        active.rsuVestingSchedule = 'cliff-1yr';
        active.rsuGrantShares = 100;
        active.esppContributionType = 'PERCENTAGE';
        active.esppContributionAmount = 10;
        renderCardFallback(active);
        expect(screen.getByText('RSU grant has no linked account')).toBeInTheDocument();
        expect(screen.getByText('ESPP contribution has no linked account')).toBeInTheDocument();
    });
});

/**
 * finding 4 / re-review 4 — RESTORED coverage. Suppressing the missing-account BANNER
 * for an ended job must NOT hide the editable grant SECTION/fields: the user still has
 * to be able to open and correct the grant on a finished income. The earlier rewrite
 * (render-the-whole-card) dropped the original positive assertions that the field
 * cluster still renders, so a regression that hides the ENTIRE grant section for an
 * ended job would no longer be caught. These tests pin both layers.
 */
describe('finding 4 / re-review 4 — ended job keeps its grant section/fields accessible', () => {
    it('keeps the RSU & ESPP card sections (summary lines) present for an ended job, only the banner is gone', () => {
        const ended = makeIncome();
        ended.end_date = pastEndDate();
        ended.rsuVestingSchedule = 'cliff-1yr';
        ended.rsuGrantShares = 100;
        ended.esppContributionType = 'PERCENTAGE';
        ended.esppContributionAmount = 10;
        expect(hasIncomeEnded(ended)).toBe(true);

        renderCard(ended);

        // Banner suppressed…
        expect(screen.queryByText('RSU grant has no linked account')).not.toBeInTheDocument();
        expect(screen.queryByText('ESPP contribution has no linked account')).not.toBeInTheDocument();
        // …but the collapsible grant SECTIONS are still on the card (titles + summary
        // lines), so the user can expand and edit the grant. A regression that hid the
        // whole section for an ended job would drop these.
        expect(screen.getByText('RSU')).toBeInTheDocument();
        expect(screen.getByText('ESPP')).toBeInTheDocument();
        expect(screen.getByText('100 sh · 1-yr cliff')).toBeInTheDocument(); // RSU summary
        expect(screen.getByText('10% of salary')).toBeInTheDocument(); // ESPP summary
    });

    it('renders the editable RSU field cluster regardless of ended state (RSUFields has no ended concept)', () => {
        // RSUFields is the value-based cluster the card mounts inside its RSU section.
        // It has no `incomeEnded` concept, so the editable grant fields render whether
        // or not the parent job has ended — pins that suppression lives ONLY at the
        // banner, never gating the cluster. Mirrors the original (pre-rewrite) assertion.
        const ended = makeIncome();
        ended.end_date = pastEndDate();
        ended.rsuVestingSchedule = 'cliff-1yr';
        ended.rsuGrantShares = 100;

        render(
            <MemoryRouter>
                <RSUFields
                    values={ended}
                    onUpdate={() => {}}
                    rsuAccounts={[]}
                    idPrefix={ended.id}
                    showAccountLink
                    showMissingAccountWarning={false}
                />
            </MemoryRouter>
        );

        // The editable grant field cluster renders.
        expect(screen.getByText('Vesting Schedule')).toBeInTheDocument();
        expect(screen.getByText('Grant Shares')).toBeInTheDocument();
    });

    it('renders the editable ESPP field cluster regardless of ended state (ESPPFields has no ended concept)', () => {
        const ended = makeIncome();
        ended.end_date = pastEndDate();
        ended.esppContributionType = 'PERCENTAGE';
        ended.esppContributionAmount = 10;

        render(
            <MemoryRouter>
                <ESPPFields
                    values={ended}
                    onUpdate={() => {}}
                    esppAccounts={[]}
                    idPrefix={ended.id}
                    showAccountLink
                    showMissingAccountWarning={false}
                />
            </MemoryRouter>
        );

        // The editable contribution field cluster renders. "Lookback" only shows once
        // the contribution type is set (not 'NONE'), so it pins the expanded cluster.
        expect(screen.getByText('ESPP Contribution')).toBeInTheDocument();
        expect(screen.getByText('Lookback')).toBeInTheDocument();
    });
});
