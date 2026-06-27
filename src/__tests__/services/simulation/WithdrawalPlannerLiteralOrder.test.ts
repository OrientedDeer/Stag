import { describe, it, expect } from 'vitest';
import { createOrderedSnapshots } from '../../../services/simulation/WithdrawalPlanner';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';

/**
 * #154 — `honorLiteralOrder` makes the ordered tier tap accounts in the user's
 * EXACT listed sequence, instead of the legacy penalty-aware re-bucketing
 * (non-penalized → savings → penalized). This is the bug behind "the 4th item is
 * tapped before the 2nd": with Tax Opt off, the user's order must be honored
 * top-to-bottom (the engine retirement-drawdown path passes the flag).
 */
describe('createOrderedSnapshots — honorLiteralOrder (#154)', () => {
    // An order deliberately OUT of penalty-bucket sequence: Savings first, then a
    // pre-59½ penalized Traditional, then a non-penalized Brokerage.
    const makeAccounts = () => [
        new SavedAccount('savings-1', 'Savings', 20000, 2.0),
        new InvestedAccount('trad-1', 'Traditional IRA', 1_500_000, 0, 15, 0.05, 'Traditional IRA'),
        new InvestedAccount('brokerage-1', 'Brokerage', 300000, 0, 10, 0.07, 'Brokerage', true, 0.2, 200000),
    ];
    const order = [{ accountId: 'savings-1' }, { accountId: 'trad-1' }, { accountId: 'brokerage-1' }];
    const AGE = 50; // < 59½ → the Traditional account carries an early-withdrawal penalty

    it('honors the user order top-to-bottom when honorLiteralOrder=true', () => {
        const snaps = createOrderedSnapshots(makeAccounts(), order, AGE, 2030, false, true);
        expect(snaps.map(s => s.accountId)).toEqual(['savings-1', 'trad-1', 'brokerage-1']);
    });

    it('LEGACY (flag off) re-buckets non-penalized → savings → penalized', () => {
        // Documents the old behavior the flag fixes: brokerage (non-penalized) jumps
        // ahead of savings, and the penalized Traditional is forced to the end — the
        // user's "4th before 2nd" symptom.
        const snaps = createOrderedSnapshots(makeAccounts(), order, AGE, 2030, false, false);
        expect(snaps.map(s => s.accountId)).toEqual(['brokerage-1', 'savings-1', 'trad-1']);
    });

    it('literal order still appends the #111 fallback tier for omitted sellable accounts', () => {
        // Order lists only savings; brokerage + traditional are omitted but sellable,
        // so they append AFTER the literal ordered tier (categorized) as the safety net.
        const snaps = createOrderedSnapshots(makeAccounts(), [{ accountId: 'savings-1' }], AGE, 2030, true, true);
        expect(snaps[0].accountId).toBe('savings-1'); // literal ordered tier first
        expect(snaps.map(s => s.accountId).sort()).toEqual(['brokerage-1', 'savings-1', 'trad-1']);
    });
});
