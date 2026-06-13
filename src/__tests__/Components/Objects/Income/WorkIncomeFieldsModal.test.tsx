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
        // employerMatch > 0 reveals the match account selector
        expect(screen.getByText('Match Account')).toBeInTheDocument();
    });

    it('hides the match account selector when there is no match', () => {
        render(<Harness />);

        fireEvent.click(screen.getByRole('button', { name: /401k & Match/ }));

        expect(screen.getByText('401k Contributions')).toBeInTheDocument();
        expect(screen.queryByText('Match Account')).not.toBeInTheDocument();
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
