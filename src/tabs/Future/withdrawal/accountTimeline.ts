import { type SimulationYear, type CustomMilestone } from '../../../services/simulation/types';
import { type AnyAccount } from '../../../components/Objects/Accounts/models';
import { getBirthYear } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type AccountTimeline } from './WithdrawalBucketList';

/**
 * Derive, per account, the first year it's tapped (drawn down) and the first
 * year it's depleted (drained to ~$0 while a draw occurred). The result is
 * keyed by `account.id` for O(1) lookup by the caller.
 *
 *  - "Tapped" = first projected year with a positive withdrawal from this
 *    account. Withdrawals are recorded in `cashflow.withdrawalDetail`, which the
 *    simulation engine keys by account ID (SimulationEngine populates it via
 *    `withdrawalDetail[account.id]`), so we look the draw up by `acc.id`.
 *  - "Depleted" = first year AT OR AFTER the first tap whose end-of-year balance
 *    snapshot falls to ~$0 (≤ $1, to absorb float dust) while a withdrawal
 *    occurred that year — i.e. the account was actively drained to empty. An
 *    account that's tapped but never hits ~$0 within the plan is reported as
 *    "tapped" only. Growth can lift a near-zero balance back up, so we take the
 *    FIRST year it bottoms out after being tapped.
 *  - Synthetic end-of-year projection rows (`isEndOfYearProjection`) are skipped
 *    so the reported year/age line up with real plan years.
 */
export function buildAccountTimeline(
    simulation: SimulationYear[],
    accounts: AnyAccount[],
    milestones: CustomMilestone[],
): Map<string, AccountTimeline> {
    const birthYear = getBirthYear(milestones);
    const rows = simulation
        .filter(y => !y.isEndOfYearProjection)
        .sort((a, b) => a.year - b.year);

    const timeline = new Map<string, AccountTimeline>();

    for (const acc of accounts) {
        let tappedYear: number | undefined;
        let depletedYear: number | undefined;
        let prevBalance: number | undefined;
        let depletedDrawAmount: number | undefined;
        let depletedBalanceBefore: number | undefined;

        for (const y of rows) {
            // withdrawalDetail is keyed by account ID (see jsdoc above).
            const draw = y.cashflow.withdrawalDetail?.[acc.id] ?? 0;
            const snapshot = y.accounts.find(a => a.id === acc.id);
            const balance = snapshot?.amount ?? 0;

            if (draw > 0 && tappedYear === undefined) {
                tappedYear = y.year;
            }
            if (tappedYear !== undefined && depletedYear === undefined && draw > 0 && balance <= 1) {
                depletedYear = y.year;
                depletedDrawAmount = draw;
                // Balance heading into the year that emptied it (the draw
                // plus what's left). Falls back to this year's draw.
                depletedBalanceBefore = prevBalance ?? draw;
            }
            prevBalance = balance;
        }

        timeline.set(acc.id, {
            tappedYear,
            tappedAge: tappedYear !== undefined ? tappedYear - birthYear : undefined,
            depletedYear,
            depletedAge: depletedYear !== undefined ? depletedYear - birthYear : undefined,
            depletedDrawAmount,
            depletedBalanceBefore,
        });
    }
    return timeline;
}
