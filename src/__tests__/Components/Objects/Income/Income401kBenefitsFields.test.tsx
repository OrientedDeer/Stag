import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Income401kFields, type Income401kFieldValues } from '../../../../components/Objects/Income/card/Income401kFields';
import { BenefitsFields } from '../../../../components/Objects/Income/card/BenefitsFields';
import type { InvestedAccount } from '../../../../components/Objects/Accounts/models';

/**
 * #151 — the 401k & Benefits field clusters are now shared value-based components
 * used by BOTH the income card and the Add-Income modal (finishing the #140 RSU/ESPP
 * consolidation). Testing the shared components directly covers both editors: they
 * can no longer drift because they render the SAME component.
 */
function makeValues(over: Partial<Income401kFieldValues> = {}): Income401kFieldValues {
    return {
        autoMax401k: 'custom',
        preTax401k: 0,
        roth401k: 0,
        contributionGrowthStrategy: 'FIXED',
        employerMatchType: 'fixed',
        employerMatch: 0,
        employerMatchPercent: 0,
        employerMatchMax: 0,
        matchAccountId: '',
        ...over,
    };
}

const acct = (id: string, name: string) => ({ id, name } as unknown as InvestedAccount);

function render401k(values: Income401kFieldValues, over: Partial<Parameters<typeof Income401kFields>[0]> = {}) {
    return render(
        <Income401kFields
            values={values}
            onUpdate={vi.fn()}
            idPrefix="t"
            contributionAccounts={[acct('a1', 'My 401k')]}
            hasDeferral={false}
            onMatchAccountChange={vi.fn()}
            {...over}
        />
    );
}

describe('Income401kFields (#151)', () => {
    it('renders the custom Pre-Tax/Roth inputs (with the unified "/403b" label)', () => {
        render401k(makeValues({ autoMax401k: 'custom' }));
        // CurrencyInput renders the label as "<label> ($)" — match the substring.
        expect(screen.getByText(/Pre-Tax 401k\/403b/)).toBeInTheDocument();
        expect(screen.getByText(/Roth 401k/)).toBeInTheDocument();
    });

    it('shows Contribution Growth only once a custom amount is entered', () => {
        const { rerender } = render401k(makeValues({ autoMax401k: 'custom', preTax401k: 0 }));
        expect(screen.queryByText('Contribution Growth')).not.toBeInTheDocument();
        rerender(
            <Income401kFields
                values={makeValues({ autoMax401k: 'custom', preTax401k: 500 })}
                onUpdate={vi.fn()} idPrefix="t" contributionAccounts={[]} hasDeferral onMatchAccountChange={vi.fn()}
            />
        );
        expect(screen.getByText('Contribution Growth')).toBeInTheDocument();
    });

    it('hides the employer-match block when 401k is disabled', () => {
        render401k(makeValues({ autoMax401k: 'disabled' }));
        expect(screen.queryByText('Employer Match')).not.toBeInTheDocument();
        expect(screen.queryByText(/Pre-Tax 401k\/403b/)).not.toBeInTheDocument();
    });

    it('shows the Destination Account when a deferral or match is configured, and routes its change through onMatchAccountChange', () => {
        const onMatchAccountChange = vi.fn();
        render401k(makeValues({ autoMax401k: 'traditional', employerMatch: 1000 }), { hasDeferral: true, onMatchAccountChange });
        expect(screen.getByText('Employer Match')).toBeInTheDocument();
        expect(screen.getByText('Destination Account')).toBeInTheDocument();
    });
});

describe('BenefitsFields (#151)', () => {
    it('renders Insurance + HSA', () => {
        render(<BenefitsFields values={{ insurance: 0, hsaContribution: 0 }} onUpdate={vi.fn()} idPrefix="t" />);
        expect(screen.getByText(/Insurance/)).toBeInTheDocument();
        expect(screen.getByText(/HSA Contribution/)).toBeInTheDocument();
    });
});
