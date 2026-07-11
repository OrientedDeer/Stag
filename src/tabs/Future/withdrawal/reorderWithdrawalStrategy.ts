import { type WithdrawalBucket } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type AnyAccount } from '../../../components/Objects/Accounts/models';
import { taxOptimalWithdrawalOrder } from '../../../services/simulation/WithdrawalPlanner';

/**
 * #154 "Auto sort" reorder logic, extracted from `WithdrawalTab`'s `onAutoSort` so the
 * real algorithm can be unit-tested directly (the test used to re-implement a private
 * copy of this, which let the component silently regress without failing a test).
 *
 * Reorders the withdrawal-strategy BUCKETS into the engine's tax-efficient withdrawal
 * ORDER for the given age:
 *
 *  Finding [5] — seed the ranker from the user's CURRENT withdrawal-strategy order (NOT
 *  the accounts-array / creation order), so `taxOptimalWithdrawalOrder`'s stable
 *  tie-break keeps the user's visible sequence among EQUAL-rank accounts (e.g. two
 *  brokerage accounts) instead of snapping them back to creation order. Each strategy
 *  bucket is resolved to its account in sequence, de-duped (an account shared by two
 *  buckets is ranked once).
 *
 *  Finding [6] — reorder the BUCKETS by grouping them under their accountId, so two
 *  buckets sharing one accountId BOTH survive (a prior byId Map collapsed them and
 *  dropped a row). Buckets keep their relative order within a group.
 *
 * Any bucket whose account isn't a sort candidate (e.g. a stale id the auto-sync
 * useEffect hasn't dropped yet) was never ranked, so it's appended AFTER the sorted
 * accounts in its original sequence rather than being silently dropped.
 */
export function reorderWithdrawalStrategyTaxOptimal(
    withdrawalStrategy: WithdrawalBucket[],
    accounts: AnyAccount[],
    currentAge: number,
): WithdrawalBucket[] {
    const accountById = new Map(accounts.map(a => [a.id, a]));

    // Finding [5]: rank the accounts in the user's CURRENT strategy order, de-duped.
    const seenForRank = new Set<string>();
    const eligible: AnyAccount[] = [];
    for (const w of withdrawalStrategy) {
        const account = accountById.get(w.accountId);
        if (!account || seenForRank.has(account.id)) continue;
        seenForRank.add(account.id);
        eligible.push(account);
    }
    const sortedIds = taxOptimalWithdrawalOrder(eligible, currentAge).map(a => a.id);

    // Finding [6]: group buckets by accountId so duplicate buckets survive the reorder.
    const bucketsByAccount = new Map<string, WithdrawalBucket[]>();
    for (const w of withdrawalStrategy) {
        const group = bucketsByAccount.get(w.accountId);
        if (group) group.push(w);
        else bucketsByAccount.set(w.accountId, [w]);
    }

    const reordered: WithdrawalBucket[] = [];
    const emitted = new Set<string>();
    for (const id of sortedIds) {
        const group = bucketsByAccount.get(id);
        if (group) reordered.push(...group);
        emitted.add(id);
    }
    // Defensive: append any stale/unranked-account buckets in their original sequence.
    for (const w of withdrawalStrategy) {
        if (!emitted.has(w.accountId)) reordered.push(w);
    }

    return reordered;
}
