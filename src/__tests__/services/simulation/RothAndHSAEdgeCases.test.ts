/**
 * Edge-case withdrawal tax invariants ported from the removed WithdrawalService
 * tests, but pointed at the live planWithdrawals path. These cover tax-logic
 * cases that the end-to-end Scenario suite does not exercise:
 *   - Roth contribution / conversion / earnings tax treatment under 59.5
 *   - HSA penalty rules
 *   - Traditional early-withdrawal penalty + gross-up
 *   - Floating-point cleanup
 */
import { describe, it, expect } from 'vitest';
import { planWithdrawals, createAccountSnapshot } from '../../../services/simulation/WithdrawalPlanner';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2025;

function makeAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(1960, 65, 90),
    };
}

function makeTaxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Virginia',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: YEAR,
    };
}

function makeRoth(
    balance: number,
    regularContributions: number,
    conversionHistory: { year: number; amount: number }[] = []
): InvestedAccount {
    // regularContributions is derived: costBasis - sum(conversionHistory).
    const totalConv = conversionHistory.reduce((s, c) => s + c.amount, 0);
    const costBasis = regularContributions + totalConv;
    return new InvestedAccount(
        'roth1',
        'Roth IRA',
        balance,
        0,
        0,
        0,
        'Roth IRA',
        true,
        0.2,
        costBasis,
        undefined,
        conversionHistory,
    );
}

describe('Roth withdrawal tax treatment under 59.5', () => {
    it('regular contributions withdraw penalty-free', () => {
        // $50k balance, all regular contributions, no conversions, no earnings
        const roth = makeRoth(50000, 50000);
        const snapshot = createAccountSnapshot(roth);

        const result = planWithdrawals(
            10000,
            [snapshot],
            50, // under 59.5
            YEAR,
            makeTaxState(),
            0,
            makeAssumptions(),
        );

        expect(result.totalPenalties).toBe(0);
        expect(result.remainingDeficit).toBeLessThan(1);
    });

    it('applies 10% penalty when conversions are withdrawn within 5 years', () => {
        // $50k balance = $30k regular contributions + $20k from a 2023 conversion.
        // At 2025, conversion is 2 years old (< 5) so withdrawing past the
        // $30k contribution layer must trigger the 5-year-rule penalty.
        const roth = makeRoth(50000, 30000, [{ year: 2023, amount: 20000 }]);
        const snapshot = createAccountSnapshot(roth);

        const result = planWithdrawals(
            40000,
            [snapshot],
            50,
            YEAR,
            makeTaxState(),
            0,
            makeAssumptions(),
        );

        expect(result.totalPenalties).toBeGreaterThan(0);
        expect(
            result.decisions.some(d => d.description?.includes('5-year rule')),
        ).toBe(true);
    });

    it('taxes earnings as ordinary income', () => {
        // $60k balance, $40k cost basis → $20k earnings. Withdraw $50k forces
        // us into earnings ($30k regular + $20k from earnings).
        const roth = makeRoth(60000, 40000);
        const snapshot = createAccountSnapshot(roth);

        const result = planWithdrawals(
            50000,
            [snapshot],
            50,
            YEAR,
            makeTaxState(),
            0,
            makeAssumptions(),
        );

        expect(result.totalTax).toBeGreaterThan(0);
    });

    it('applies 10% penalty to earnings', () => {
        const roth = makeRoth(60000, 40000);
        const snapshot = createAccountSnapshot(roth);

        const result = planWithdrawals(
            50000,
            [snapshot],
            50,
            YEAR,
            makeTaxState(),
            0,
            makeAssumptions(),
        );

        expect(result.totalPenalties).toBeGreaterThan(0);
    });
});

describe('HSA penalty rules', () => {
    it('no penalty after age 65', () => {
        const hsa = new InvestedAccount('hsa1', 'HSA', 10000, 0, 0, 0, 'HSA');
        const snapshot = createAccountSnapshot(hsa);

        const result = planWithdrawals(
            5000,
            [snapshot],
            65,
            YEAR,
            makeTaxState(),
            0,
            makeAssumptions(),
        );

        expect(result.totalPenalties).toBe(0);
    });

    it('applies 20% penalty before age 65 (non-medical assumption)', () => {
        // planWithdrawals does not model medical-vs-non-medical use; it
        // conservatively treats all pre-65 HSA withdrawals as non-medical.
        const hsa = new InvestedAccount('hsa1', 'HSA', 10000, 0, 0, 0, 'HSA');
        const snapshot = createAccountSnapshot(hsa);

        const result = planWithdrawals(
            5000,
            [snapshot],
            55,
            YEAR,
            makeTaxState(),
            0,
            makeAssumptions(),
        );

        expect(result.totalPenalties).toBeGreaterThan(0);
    });
});

describe('Traditional early withdrawal under 59.5', () => {
    it('applies 10% penalty', () => {
        const traditional = new InvestedAccount(
            'trad1',
            'Traditional IRA',
            100000,
            0,
            0,
            0,
            'Traditional IRA',
        );
        const snapshot = createAccountSnapshot(traditional);

        const result = planWithdrawals(
            10000,
            [snapshot],
            50,
            YEAR,
            makeTaxState(),
            0,
            makeAssumptions(),
        );

        expect(result.totalPenalties).toBeGreaterThan(0);
    });

    it('grosses up to cover the deficit when penalty applies', () => {
        // To net $10k after a 10% penalty + income tax, gross must exceed $10k.
        const traditional = new InvestedAccount(
            'trad1',
            'Traditional IRA',
            100000,
            0,
            0,
            0,
            'Traditional IRA',
        );
        const snapshot = createAccountSnapshot(traditional);

        const result = planWithdrawals(
            10000,
            [snapshot],
            50,
            YEAR,
            makeTaxState(),
            0,
            makeAssumptions(),
        );

        expect(result.totalGross).toBeGreaterThan(10000);
        expect(result.remainingDeficit).toBeLessThan(1);
    });
});

describe('floating-point cleanup', () => {
    it('settles tiny deficits to near-zero', () => {
        const savings = new SavedAccount('sav1', 'Savings', 50000, 0);
        const snapshot = createAccountSnapshot(savings);

        const result = planWithdrawals(
            10000.001,
            [snapshot],
            65,
            YEAR,
            makeTaxState(),
            0,
            makeAssumptions(),
        );

        expect(Math.abs(result.remainingDeficit)).toBeLessThan(1);
    });

    it('settles tiny surpluses to near-zero', () => {
        const savings = new SavedAccount('sav1', 'Savings', 50000, 0);
        const snapshot = createAccountSnapshot(savings);

        const result = planWithdrawals(
            9999.999,
            [snapshot],
            65,
            YEAR,
            makeTaxState(),
            0,
            makeAssumptions(),
        );

        expect(Math.abs(result.remainingDeficit)).toBeLessThan(1);
    });
});
