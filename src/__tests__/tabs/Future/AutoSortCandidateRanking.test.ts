import { describe, it, expect } from 'vitest';
import { InvestedAccount, SavedAccount, ESPPAccount, RSUAccount, ESPPLot, RSULot } from '../../../components/Objects/Accounts/models';
import { taxOptimalWithdrawalOrder } from '../../../services/simulation/WithdrawalPlanner';
import { WithdrawalBucket } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { reorderWithdrawalStrategyTaxOptimal } from '../../../tabs/Future/withdrawal/reorderWithdrawalStrategy';

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
 * #156: Auto sort ranks ESPP/RSU by their lots' GAIN CHARACTER at the sale date
 * (taxableTierRank), not the flat "taxable" category: favourable accounts (qualifying-heavy
 * ESPP, long-term-heavy or freshly-vested near-zero-gain RSU) tie with brokerage at tier 1;
 * unfavourable ones defer to tier 1.5 — after brokerage but BEFORE tax-deferred.
 * All numbers invented.
 */
describe('taxOptimalWithdrawalOrder — ESPP/RSU gain-character tier (#156)', () => {
    const SALE_DATE = new Date(2032, 5, 15);
    const yearsBefore = (y: number) => new Date(2032 - y, 5, 15);
    const monthsBefore = (m: number) => new Date(2032, 5 - m, 15);

    const esppLot = (purchaseDate: Date, shares: number): ESPPLot => {
        const grantDate = new Date(purchaseDate);
        grantDate.setMonth(grantDate.getMonth() - 6);
        return {
            id: 'lot', grantDate, purchaseDate,
            fmvAtGrant: 80, fmvAtPurchase: 85, purchasePrice: 72.25,
            shares, totalCost: 72.25 * shares, discountAmount: 12.75,
        };
    };
    const rsuLot = (vestDate: Date, fmvAtVest: number, shares: number): RSULot => ({
        id: 'lot', grantDate: yearsBefore(4), vestDate, fmvAtVest, shares, costBasis: fmvAtVest * shares,
    });

    const brokerage = () => new InvestedAccount('brok-1', 'Brokerage', 300000, 0, 10, 0.05, 'Brokerage', true, 0.2, 200000);
    const traditional = () => new InvestedAccount('trad-1', 'Traditional IRA', 500000, 0, 10, 0.05, 'Traditional IRA');

    it('disqualifying-heavy ESPP defers AFTER brokerage but BEFORE tax-deferred (tier 1.5)', () => {
        // ESPP bought 3 months ago — disqualifying → 1.5. Fed first so only the rank moves it.
        const espp = new ESPPAccount('espp-1', 'ESPP', 50000, [esppLot(monthsBefore(3), 500)], null, undefined, 'TICK', 100);
        const ids = taxOptimalWithdrawalOrder([espp, brokerage(), traditional()], 65, SALE_DATE).map(a => a.id);
        expect(ids).toEqual(['brok-1', 'espp-1', 'trad-1']);
    });

    it('qualifying-heavy ESPP TIES with brokerage (tier 1) and keeps the input order', () => {
        const espp = new ESPPAccount('espp-1', 'ESPP', 50000, [esppLot(yearsBefore(3), 500)], null, undefined, 'TICK', 100);
        // ESPP fed first → the stable tie-break keeps it ahead of the equal-rank brokerage.
        const ids = taxOptimalWithdrawalOrder([espp, brokerage(), traditional()], 65, SALE_DATE).map(a => a.id);
        expect(ids).toEqual(['espp-1', 'brok-1', 'trad-1']);
    });

    it('short-term-gain-heavy RSU defers behind brokerage; freshly-vested near-zero-gain RSU ties with it', () => {
        // Vested 6 months ago at $50, price $100 → big short-term gain → 1.5.
        const stRsu = new RSUAccount('rsu-st', 'RSU ST', 30000, [rsuLot(monthsBefore(6), 50, 300)], null, undefined, 'TICK', 100);
        // Vested 2 months ago at $98, price $100 → gain 2% of value < 5% de minimis → 1.
        const freshRsu = new RSUAccount('rsu-fresh', 'RSU fresh', 50000, [rsuLot(monthsBefore(2), 98, 500)], null, undefined, 'TICK', 100);
        const ids = taxOptimalWithdrawalOrder([stRsu, freshRsu, brokerage(), traditional()], 65, SALE_DATE).map(a => a.id);
        // De-minimis RSU ties at tier 1 (input order keeps it ahead of brokerage);
        // the short-term-heavy RSU sits between brokerage and Traditional.
        expect(ids).toEqual(['rsu-fresh', 'brok-1', 'rsu-st', 'trad-1']);
    });
});

/**
 * Finding [5]/[6]: `onAutoSort` (WithdrawalTab.tsx) reorders the withdrawal-strategy
 * BUCKETS by tax-optimal rank. The reorder logic is extracted into the pure, exported
 * `reorderWithdrawalStrategyTaxOptimal` (withdrawal/reorderWithdrawalStrategy.ts) and
 * `onAutoSort` CALLS it — so these tests drive the REAL component algorithm (not a
 * hand-maintained copy). Two regressions are pinned at the unit level:
 *
 *  [5] The ranker's tie-break preserves INPUT order, so the candidate accounts MUST be
 *      seeded in the user's CURRENT strategy order — NOT the accounts-array (creation)
 *      order. An older version did `accounts.filter(a => byId.has(a.id))` (creation
 *      order), which re-sorts equal-rank accounts back to creation order, silently
 *      undoing the user's manual drag. Below, the user's order is B-before-A but the
 *      creation order is A-before-B; only the strategy-order seeding keeps B before A.
 *      (To watch this fail-before: seed the ranker from the accounts-array order inside
 *      reorderWithdrawalStrategyTaxOptimal — [5] flips to A, B.)
 *
 *  [6] Grouping buckets by accountId means two buckets sharing one accountId both survive
 *      the reorder (an older `byId` Map collapsed them and dropped a row).
 *
 * Because these import the real exported function, regressing it (creation-order seeding
 * or a byId-collapse) fails the corresponding assertion here.
 */
describe('reorderWithdrawalStrategyTaxOptimal (onAutoSort reorder — findings 5 & 6)', () => {
    // The two SAME-RANK brokerage accounts, created A-then-B (so the accounts-array /
    // creation order is A, B). The user has dragged them so their withdrawal strategy is
    // B-before-A.
    const accountsCreationOrder = () => [
        new InvestedAccount('brok-A', 'Brokerage A', 100000, 0, 10, 0.05, 'Brokerage', true, 0.2, 50000),
        new InvestedAccount('brok-B', 'Brokerage B', 100000, 0, 10, 0.05, 'Brokerage', true, 0.2, 50000),
    ];

    it('[5] preserves the user\'s manual order (B before A) among same-rank accounts', () => {
        const accounts = accountsCreationOrder(); // creation order: A, B
        const strategy: WithdrawalBucket[] = [
            { id: 'w-B', name: 'Brokerage B', accountId: 'brok-B' },
            { id: 'w-A', name: 'Brokerage A', accountId: 'brok-A' },
        ];

        const result = reorderWithdrawalStrategyTaxOptimal(strategy, accounts, 50);
        // The user's B-before-A order survives. With creation-order seeding this would
        // come back A-before-B (the regression this test pins).
        expect(result.map(b => b.accountId)).toEqual(['brok-B', 'brok-A']);
    });

    it('[6] does not drop a bucket when two buckets share one accountId', () => {
        const accounts = accountsCreationOrder();
        // Two buckets both pointing at brok-A (e.g. a transient duplicate). Neither row
        // should be silently dropped by the reorder.
        const strategy: WithdrawalBucket[] = [
            { id: 'w-A1', name: 'Brokerage A', accountId: 'brok-A' },
            { id: 'w-B', name: 'Brokerage B', accountId: 'brok-B' },
            { id: 'w-A2', name: 'Brokerage A (dup)', accountId: 'brok-A' },
        ];

        const result = reorderWithdrawalStrategyTaxOptimal(strategy, accounts, 50);
        // All three bucket rows survive (a byId Map would have lost one of the brok-A
        // rows). Same rank ⇒ the buckets keep their relative input order.
        expect(result).toHaveLength(3);
        expect(result.map(b => b.id).sort()).toEqual(['w-A1', 'w-A2', 'w-B']);
        // The two brok-A buckets stay in their original relative order within the group.
        expect(result.filter(b => b.accountId === 'brok-A').map(b => b.id)).toEqual(['w-A1', 'w-A2']);
    });

    it('appends a stale bucket (account not in the candidate set) after the ranked ones', () => {
        const accounts = accountsCreationOrder();
        const strategy: WithdrawalBucket[] = [
            { id: 'w-stale', name: 'Deleted', accountId: 'gone' },
            { id: 'w-B', name: 'Brokerage B', accountId: 'brok-B' },
            { id: 'w-A', name: 'Brokerage A', accountId: 'brok-A' },
        ];

        const result = reorderWithdrawalStrategyTaxOptimal(strategy, accounts, 50);
        // Same-rank brokerages keep B-before-A; the unrankable stale bucket trails.
        expect(result.map(b => b.accountId)).toEqual(['brok-B', 'brok-A', 'gone']);
    });
});
