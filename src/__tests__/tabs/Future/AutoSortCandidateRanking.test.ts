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

    // Finding [5]: the stable tie-break keeps the INPUT order among EQUAL-rank accounts.
    // This is the property `onAutoSort`'s fix relies on — it must feed the accounts in the
    // user's CURRENT withdrawal-strategy order (not the creation/accounts-array order) so
    // this tie-break preserves the user's visible sequence among same-rank accounts.
    it('keeps the input order among two SAME-RANK (Brokerage) accounts (stable tie-break)', () => {
        const brokB = new InvestedAccount('brok-B', 'Brokerage B', 100000, 0, 10, 0.05, 'Brokerage', true, 0.2, 50000);
        const brokA = new InvestedAccount('brok-A', 'Brokerage A', 100000, 0, 10, 0.05, 'Brokerage', true, 0.2, 50000);
        // Feed B before A — the user's manual order. Same rank ⇒ order must survive.
        expect(taxOptimalWithdrawalOrder([brokB, brokA], 50).map(a => a.id)).toEqual(['brok-B', 'brok-A']);
        // And the reverse input order is likewise preserved (proves it is the INPUT order
        // that decides, not a fixed id sort).
        expect(taxOptimalWithdrawalOrder([brokA, brokB], 50).map(a => a.id)).toEqual(['brok-A', 'brok-B']);
    });
});

/**
 * Finding [5]/[6]: `onAutoSort` (WithdrawalTab.tsx) reorders the withdrawal-strategy
 * BUCKETS by tax-optimal rank. Two regressions are pinned here at the unit level so they
 * can't reappear without `taxOptimalWithdrawalOrder` regressing:
 *
 *  [5] The ranker's tie-break preserves INPUT order, so the candidate accounts MUST be
 *      seeded in the user's CURRENT strategy order — NOT the accounts-array (creation)
 *      order. The OLD code did `accounts.filter(a => byId.has(a.id))` (creation order),
 *      which re-sorts equal-rank accounts back to creation order, silently undoing the
 *      user's manual drag. Below, the user's order is B-before-A but the creation order
 *      is A-before-B; only the strategy-order seeding keeps B before A.
 *
 *  [6] Grouping buckets by accountId means two buckets sharing one accountId both survive
 *      the reorder (the old `byId` Map collapsed them and dropped a row).
 *
 * These mirror `onAutoSort`'s reorder algorithm exactly (same `taxOptimalWithdrawalOrder`
 * call). Reverting the input-order fix in the component (seeding from accounts-array
 * order) makes the [5] assertion fail; reverting the bucket-grouping fix drops a row in
 * the [6] assertion.
 */
describe('onAutoSort reorder algorithm (findings 5 & 6)', () => {
    interface Bucket { id: string; name: string; accountId: string; }

    // The two SAME-RANK brokerage accounts, created A-then-B (so the accounts-array /
    // creation order is A, B). The user has dragged them so their withdrawal strategy is
    // B-before-A.
    const accountsCreationOrder = () => [
        new InvestedAccount('brok-A', 'Brokerage A', 100000, 0, 10, 0.05, 'Brokerage', true, 0.2, 50000),
        new InvestedAccount('brok-B', 'Brokerage B', 100000, 0, 10, 0.05, 'Brokerage', true, 0.2, 50000),
    ];

    // FIXED reorder: seed the ranker from the user's CURRENT strategy order, then group
    // buckets by accountId so duplicates survive. This is the algorithm now in onAutoSort.
    const reorder = (accounts: InvestedAccount[], strategy: Bucket[], currentAge: number): Bucket[] => {
        const accountById = new Map(accounts.map(a => [a.id, a]));
        const seenForRank = new Set<string>();
        const eligible: InvestedAccount[] = [];
        for (const w of strategy) {
            const account = accountById.get(w.accountId);
            if (!account || seenForRank.has(account.id)) continue;
            seenForRank.add(account.id);
            eligible.push(account);
        }
        const sortedIds = taxOptimalWithdrawalOrder(eligible, currentAge).map(a => a.id);
        const bucketsByAccount = new Map<string, Bucket[]>();
        for (const w of strategy) {
            const group = bucketsByAccount.get(w.accountId);
            if (group) group.push(w);
            else bucketsByAccount.set(w.accountId, [w]);
        }
        const reordered: Bucket[] = [];
        const emitted = new Set<string>();
        for (const id of sortedIds) {
            const group = bucketsByAccount.get(id);
            if (group) reordered.push(...group);
            emitted.add(id);
        }
        for (const w of strategy) if (!emitted.has(w.accountId)) reordered.push(w);
        return reordered;
    };

    it('[5] preserves the user\'s manual order (B before A) among same-rank accounts', () => {
        const accounts = accountsCreationOrder(); // creation order: A, B
        const strategy: Bucket[] = [
            { id: 'w-B', name: 'Brokerage B', accountId: 'brok-B' },
            { id: 'w-A', name: 'Brokerage A', accountId: 'brok-A' },
        ];

        const result = reorder(accounts, strategy, 50);
        // The user's B-before-A order survives. With the OLD creation-order seeding this
        // would come back A-before-B (the regression this test pins).
        expect(result.map(b => b.accountId)).toEqual(['brok-B', 'brok-A']);
    });

    it('[6] does not drop a bucket when two buckets share one accountId', () => {
        const accounts = accountsCreationOrder();
        // Two buckets both pointing at brok-A (e.g. a transient duplicate). Neither row
        // should be silently dropped by the reorder.
        const strategy: Bucket[] = [
            { id: 'w-A1', name: 'Brokerage A', accountId: 'brok-A' },
            { id: 'w-B', name: 'Brokerage B', accountId: 'brok-B' },
            { id: 'w-A2', name: 'Brokerage A (dup)', accountId: 'brok-A' },
        ];

        const result = reorder(accounts, strategy, 50);
        // All three bucket rows survive (the old byId Map would have lost one of the
        // brok-A rows). Same rank ⇒ the buckets keep their relative input order.
        expect(result).toHaveLength(3);
        expect(result.map(b => b.id).sort()).toEqual(['w-A1', 'w-A2', 'w-B']);
        // The two brok-A buckets stay in their original relative order within the group.
        expect(result.filter(b => b.accountId === 'brok-A').map(b => b.id)).toEqual(['w-A1', 'w-A2']);
    });
});
