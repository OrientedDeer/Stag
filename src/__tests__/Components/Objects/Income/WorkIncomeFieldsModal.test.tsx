import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WorkIncomeFields } from '../../../../components/Objects/Income/WorkIncomeFields';
import {
    getInitialFormState,
    IncomeFormState
} from '../../../../components/Objects/Income/incomeFormTypes';
import {
    get401kSummary,
    getBenefitsSummary,
    getESPPSummary,
    getPensionSummary
} from '../../../../components/Objects/Income/workIncomeSummaries';
import { ESPPAccount, InvestedAccount } from '../../../../components/Objects/Accounts/models';

describe('workIncomeSummaries', () => {
    const base = getInitialFormState();

    describe('get401kSummary', () => {
        it('returns None when 401k is disabled', () => {
            expect(get401kSummary({ ...base, autoMax401k: 'disabled' })).toBe('None');
        });

        it('labels auto-max modes', () => {
            expect(get401kSummary({ ...base, autoMax401k: 'traditional' })).toBe('Max Pre-Tax');
            expect(get401kSummary({ ...base, autoMax401k: 'roth' })).toBe('Max Roth');
        });

        it('shows custom contribution amounts', () => {
            expect(get401kSummary({ ...base, autoMax401k: 'custom' })).toBe('Custom ($0)');
            expect(get401kSummary({
                ...base, autoMax401k: 'custom', preTax401k: 10000, roth401k: 5000
            })).toBe('$10,000 pre-tax + $5,000 Roth');
        });

        it('appends fixed and percent employer match', () => {
            expect(get401kSummary({
                ...base, autoMax401k: 'traditional', employerMatchType: 'fixed', employerMatch: 5000
            })).toBe('Max Pre-Tax · $5,000 match');
            expect(get401kSummary({
                ...base, autoMax401k: 'traditional', employerMatchType: 'percent', employerMatchPercent: 4
            })).toBe('Max Pre-Tax · 4% match');
        });
    });

    describe('getBenefitsSummary', () => {
        it('returns None when no benefits are set', () => {
            expect(getBenefitsSummary({ insurance: 0, hsaContribution: 0 })).toBe('None');
        });

        it('lists insurance and HSA amounts', () => {
            expect(getBenefitsSummary({ insurance: 2400, hsaContribution: 1000 }))
                .toBe('$2,400 insurance · $1,000 HSA');
        });
    });

    describe('getESPPSummary', () => {
        it('returns None when ESPP is off', () => {
            expect(getESPPSummary({ esppContributionType: 'NONE', esppContributionAmount: 10 })).toBe('None');
        });

        it('formats percentage and fixed contributions', () => {
            expect(getESPPSummary({ esppContributionType: 'PERCENTAGE', esppContributionAmount: 10 }))
                .toBe('10% of salary');
            expect(getESPPSummary({ esppContributionType: 'FIXED', esppContributionAmount: 6000 }))
                .toBe('$6,000/yr');
        });
    });

    describe('getPensionSummary', () => {
        it('names the pension system or None', () => {
            expect(getPensionSummary('NONE')).toBe('None');
            expect(getPensionSummary('FERS')).toBe('FERS');
            expect(getPensionSummary('CSRS')).toBe('CSRS');
        });
    });
});

interface HarnessProps {
    initial?: Partial<IncomeFormState>;
    contributionAccounts?: InvestedAccount[];
    esppAccounts?: ESPPAccount[];
}

/** Stateful harness mirroring AddIncomeModal's form/updateForm wiring. */
function Harness({ initial, contributionAccounts = [], esppAccounts = [] }: HarnessProps) {
    const [form, setForm] = useState<IncomeFormState>({ ...getInitialFormState(), ...initial });
    function updateForm<K extends keyof IncomeFormState>(field: K, value: IncomeFormState[K]): void {
        setForm(prev => ({ ...prev, [field]: value }));
    }
    return (
        <WorkIncomeFields
            form={form}
            updateForm={updateForm}
            contributionAccounts={contributionAccounts}
            esppAccounts={esppAccounts}
        />
    );
}

describe('Modal WorkIncomeFields sections', () => {
    it('renders all four optional clusters collapsed by default', () => {
        render(<Harness />);

        for (const title of ['401k & Match', 'Benefits', 'ESPP', 'Pension']) {
            const header = screen.getByRole('button', { name: new RegExp(title) });
            expect(header).toHaveAttribute('aria-expanded', 'false');
        }
        // No inner inputs visible while collapsed
        expect(screen.queryByText('401k Contributions')).not.toBeInTheDocument();
        expect(screen.queryByText(/Insurance/)).not.toBeInTheDocument();
        expect(screen.queryByText('ESPP Contribution')).not.toBeInTheDocument();
        expect(screen.queryByText('Pension System')).not.toBeInTheDocument();
    });

    it('shows paystub-style summaries on the collapsed headers', () => {
        render(<Harness initial={{
            preTax401k: 10000,
            employerMatch: 5000,
            insurance: 2400,
            hsaContribution: 1000,
            esppContributionType: 'PERCENTAGE',
            esppContributionAmount: 10,
            pensionSystem: 'FERS'
        }} />);

        expect(screen.getByText('$10,000 pre-tax · $5,000 match')).toBeInTheDocument();
        expect(screen.getByText('$2,400 insurance · $1,000 HSA')).toBeInTheDocument();
        expect(screen.getByText('10% of salary')).toBeInTheDocument();
        expect(screen.getByText('FERS')).toBeInTheDocument();
    });

    it('expands the 401k section to reveal contribution and match fields', () => {
        render(<Harness initial={{ employerMatch: 5000 }} />);

        fireEvent.click(screen.getByRole('button', { name: /401k & Match/ }));

        expect(screen.getByText('401k Contributions')).toBeInTheDocument();
        // Default autoMax401k is 'custom', so the custom amount inputs show
        expect(screen.getByText(/Pre-Tax 401k\/403b/)).toBeInTheDocument();
        expect(screen.getByText(/Roth 401k/)).toBeInTheDocument();
        // a configured deferral or employer match reveals the destination selector
        expect(screen.getByText('Destination Account')).toBeInTheDocument();
    });

    it('hides the destination selector when there is no deferral and no match', () => {
        render(<Harness />);

        fireEvent.click(screen.getByRole('button', { name: /401k & Match/ }));

        expect(screen.getByText('401k Contributions')).toBeInTheDocument();
        expect(screen.queryByText('Destination Account')).not.toBeInTheDocument();
    });

    it('routes edits through updateForm and reflects them in the collapsed summary', () => {
        render(<Harness />);

        fireEvent.click(screen.getByRole('button', { name: /Benefits/ }));
        const [insuranceInput] = screen.getAllByRole('textbox');
        fireEvent.focus(insuranceInput);
        fireEvent.change(insuranceInput, { target: { value: '500' } });
        fireEvent.blur(insuranceInput);

        // Collapse again — summary reflects the edited form state
        fireEvent.click(screen.getByRole('button', { name: /Benefits/ }));
        expect(screen.getByText('$500 insurance')).toBeInTheDocument();
    });

    it('shows the missing-ESPP-account warning inside the expanded ESPP section', () => {
        render(<Harness initial={{ esppContributionType: 'PERCENTAGE', esppContributionAmount: 10 }} />);

        expect(screen.queryByText('No ESPP Account')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /ESPP/ }));
        expect(screen.getByText('No ESPP Account')).toBeInTheDocument();
    });
});

describe('Modal WorkIncomeFields deferral-destination validation (#123)', () => {
    // The modal used to hand-roll its own inline check that only fired on an
    // EMPTY matchAccountId. It now reuses the shared validation, so a deferral
    // pointing at a since-deleted account (a DANGLING id) must also surface the
    // banner — otherwise the #123 net-worth leak persists silently in the modal.
    const acct = (id: string, name: string): InvestedAccount =>
        new InvestedAccount(id, name, 0);

    // The banner renders OUTSIDE the collapsed 401k & Match section so it's visible
    // without expanding — which matters precisely for the dangling case: expanding
    // the section mounts the Destination dropdown, whose auto-select effect heals an
    // id that's no longer in its options. The realistic dangling state (a deleted
    // destination on a collapsed card) is asserted with the section left collapsed.

    it('shows the Destination-Account-Required banner for a DANGLING destination id (deleted account)', () => {
        // A pre-tax deferral whose matchAccountId points at an account that no longer
        // exists in contributionAccounts. The old inline modal check only fired on an
        // EMPTY id and would miss this; the shared dangling-aware helper catches it.
        render(<Harness
            initial={{ autoMax401k: 'custom', preTax401k: 1000, matchAccountId: 'deleted-acct' }}
            contributionAccounts={[acct('401k-1', 'My 401k')]}
        />);

        // Visible while the 401k section is still collapsed.
        expect(screen.getByRole('button', { name: /401k & Match/ }))
            .toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByText('Destination Account Required')).toBeInTheDocument();
        expect(screen.getByText(/no longer exists/)).toBeInTheDocument();
    });

    it('shows the banner for an empty destination (existing behavior preserved)', () => {
        render(<Harness
            initial={{ autoMax401k: 'custom', preTax401k: 1000, matchAccountId: '' }}
            contributionAccounts={[acct('401k-1', 'My 401k')]}
        />);

        expect(screen.getByText('Destination Account Required')).toBeInTheDocument();
        // The empty-id message, not the dangling one.
        expect(screen.getByText(/Choose a Destination Account/)).toBeInTheDocument();
    });

    it('does NOT show the banner when the destination resolves to a real account', () => {
        render(<Harness
            initial={{ autoMax401k: 'custom', preTax401k: 1000, matchAccountId: '401k-1' }}
            contributionAccounts={[acct('401k-1', 'My 401k')]}
        />);

        expect(screen.queryByText('Destination Account Required')).not.toBeInTheDocument();
    });

    it('does NOT show the banner when no deferral is configured (disabled)', () => {
        render(<Harness
            initial={{ autoMax401k: 'disabled', matchAccountId: 'deleted-acct' }}
            contributionAccounts={[acct('401k-1', 'My 401k')]}
        />);

        expect(screen.queryByText('Destination Account Required')).not.toBeInTheDocument();
    });
});
