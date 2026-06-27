import { describe, it, expect } from 'vitest';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { taxOptimalWithdrawalOrder } from '../../../services/simulation/WithdrawalPlanner';

/**
 * #154 Auto sort applies `taxOptimalWithdrawalOrder` — penalty-free accounts before
 * early-withdrawal-penalized ones (at the current age), and within each group by tax
 * type (cash → taxable → tax-deferred → tax-free). This fixes BOTH things in the
 * reported scenario: "Traditional first" (penalty) and "Roth before brokerage"
 * (tax-type). It's evaluated at the current age, so penalty deferral lapses at 59½.
 */
describe('taxOptimalWithdrawalOrder (#154 Auto sort)', () => {
    // Deliberately scrambled input so the sort has to do the work.
    const accounts = () => [
        new InvestedAccount('roth-1', 'Roth IRA', 200000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 120000),
        new InvestedAccount('trad-1', 'Traditional IRA', 500000, 0, 15, 0.05, 'Traditional IRA'),
        new InvestedAccount('brokerage-1', 'Brokerage', 400000, 0, 10, 0.05, 'Brokerage', true, 0.2, 250000),
        new SavedAccount('savings-1', 'Savings', 50000, 2.0),
    ];

    it('pre-59½: penalized Traditional last, and taxable Brokerage ahead of tax-free Roth', () => {
        const ids = taxOptimalWithdrawalOrder(accounts(), 50).map(a => a.id);
        // cash → taxable → tax-free(penalty-free) → tax-deferred(penalized, deferred)
        expect(ids).toEqual(['savings-1', 'brokerage-1', 'roth-1', 'trad-1']);
        expect(ids.indexOf('brokerage-1')).toBeLessThan(ids.indexOf('roth-1')); // #2 fix: taxable before tax-free
        expect(ids[ids.length - 1]).toBe('trad-1'); // penalty deferral
    });

    it('post-59½: nothing penalized → conventional taxable → tax-deferred → tax-free', () => {
        const ids = taxOptimalWithdrawalOrder(accounts(), 65).map(a => a.id);
        expect(ids).toEqual(['savings-1', 'brokerage-1', 'trad-1', 'roth-1']);
    });
});
