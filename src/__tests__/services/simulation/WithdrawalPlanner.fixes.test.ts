/**
 * Reviewed-bug fixes for WithdrawalPlanner.planWithdrawals.
 *
 * Bug #7  — State marginal rate frozen at initial income (stale across iterations).
 * Bug #14 — Unguarded gross-up `1/(1-rate)` can divide by <= 0 → Infinity/NaN.
 *
 * (Bug #3 — LTCG rate off gross vs taxable — was REVERTED: passing gross is a
 *  conservative gross-up proxy; a taxable-income lookup returns the 0% floor rate
 *  and under-withdraws when gains spill into 15%. See WithdrawalPlanner.getLTCGRate.)
 * (Bug #9 — brokerage short/long split — is NEEDS-CROSS-FILE: the snapshot only
 *  carries an averaged gainRatio with no lot holding-period data, and YearSolver
 *  hardcodes STCG=0 when computing the authoritative federal tax, so it can't be
 *  fixed inside WithdrawalPlanner alone. Not covered here.)
 */

import { describe, it, expect } from 'vitest';

import {
    planWithdrawals,
    createAccountSnapshot,
    grossUpDivisor,
} from '../../../services/simulation/WithdrawalPlanner';
import { AccountBalanceSnapshot } from '../../../services/simulation/types';
import { InvestedAccount, RSUAccount } from '../../../components/Objects/Accounts/models';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2025;

function taxStateFor(stateResidency: string): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency,
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: YEAR,
    };
}

// =============================================================================
// BUG #7: state marginal rate must update as running income rises
// =============================================================================
// California Single 2025 brackets jump from low rates near the bottom to 0.093
// at taxable income >= 70,607. A large Traditional withdrawal lifts running
// income across those brackets; the state portion of the marginal rate used to
// gross up a subsequent HSA withdrawal must reflect the HIGHER state bracket,
// not the frozen initial one.
describe('Bug #7: state marginal rate recomputes per-iteration (not frozen)', () => {
    function buildSnapshots(): AccountBalanceSnapshot[] {
        // Traditional: large balance so a big withdrawal lifts income across CA brackets.
        const trad = new InvestedAccount(
            'trad-1', 'Traditional IRA', 1000000,
            0, 10, 0.07, 'Traditional IRA',
        );
        // HSA: tapped AFTER traditional; its gross-up uses the (now-higher) marginal rate.
        const hsa = new InvestedAccount(
            'hsa-1', 'HSA', 200000,
            0, 10, 0.07, 'HSA',
        );
        return [createAccountSnapshot(trad), createAccountSnapshot(hsa)];
    }

    it('grosses up the later HSA withdrawal using the elevated CA state rate', () => {
        const snapshots = buildSnapshots();

        // Start with low income (~$5k) so the FROZEN state rate would be the 1% bracket.
        // The large traditional withdrawal pushes running income into CA's 9.3% bracket
        // (taxable >= 70,607) before the HSA is tapped.
        const result = planWithdrawals(
            120000,           // big net need → large traditional draw, then HSA
            snapshots,
            66,               // age >= 65 → no HSA penalty, isolates marginal-rate effect
            YEAR,
            taxStateFor('California'),
            5000,             // low initial ordinary income
            undefined,
        );

        const hsaW = result.withdrawals.find(w => w.source === 'hsa');
        expect(hsaW).toBeDefined();
        expect(hsaW!.gross).toBeGreaterThan(0);

        // HSA tax = gross * (fedMarginal + stateMarginal). At this income level the
        // CA marginal rate is 0.093 (frozen bug would use ~0.01). The fed marginal
        // is 0.22 (taxable ~ running income - 15,750, in the 22% band). So the
        // implied state component must be ~0.093, not ~0.01.
        const impliedCombined = hsaW!.tax / hsaW!.gross;
        const fedMarginalAtHSA = 0.22;
        const impliedState = impliedCombined - fedMarginalAtHSA;

        // With the fix the state component reflects the high bracket.
        expect(impliedState).toBeGreaterThan(0.05);
        // Frozen-rate bug would have left it near the 1% bottom bracket.
        expect(impliedState).not.toBeLessThan(0.05);
    });
});

// =============================================================================
// BUG #14: guarded gross-up divisor
// =============================================================================
describe('Bug #14: gross-up divisor is guarded against >= 1 effective rates', () => {
    it('keeps the divisor positive when the effective rate reaches/exceeds 1', () => {
        // Buggy formula: 1 - effectiveRate.
        // At 0.95 → 0.05 (positive but tiny), at 1.0 → 0 (div by zero → Infinity),
        // at 1.2 → -0.2 (negative gross). The guard floors at 0.01.
        expect(1 - 0.95).toBeCloseTo(0.05, 6);

        // Degenerate cases the bug exposed:
        expect(Number.isFinite(100 / (1 - 1.0))).toBe(false);   // Infinity
        expect(100 / (1 - 1.2)).toBeLessThan(0);                // negative gross

        // Guarded divisor stays finite and positive in every case.
        expect(grossUpDivisor(0.95)).toBeGreaterThan(0);
        expect(grossUpDivisor(1.0)).toBe(0.01);
        expect(grossUpDivisor(1.2)).toBe(0.01);

        const gross = 100 / grossUpDivisor(1.2);
        expect(Number.isFinite(gross)).toBe(true);
        expect(gross).toBeGreaterThan(0);
    });

    it('produces a finite, positive HSA gross even at the highest real marginal rate', () => {
        // Sanity: a top-bracket retiree under 65 (37% fed + CA 0.123 + 20% penalty
        // ≈ 0.69 effective). Should stay finite — and remain finite even if rates
        // were pathological, thanks to the guard.
        const hsa = new InvestedAccount(
            'hsa-2', 'HSA', 500000,
            0, 10, 0.07, 'HSA',
        );
        const result = planWithdrawals(
            50000,
            [createAccountSnapshot(hsa)],
            60,                       // < 65 → 20% HSA penalty
            YEAR,
            taxStateFor('California'),
            2000000,                  // top federal + top CA bracket
            undefined,
        );

        expect(Number.isFinite(result.totalGross)).toBe(true);
        expect(Number.isFinite(result.totalTax)).toBe(true);
        expect(Number.isNaN(result.totalGross)).toBe(false);
        const hsaW = result.withdrawals.find(w => w.source === 'hsa')!;
        expect(Number.isFinite(hsaW.gross)).toBe(true);
        expect(hsaW.gross).toBeGreaterThan(0);
    });
});

// =============================================================================
// §1211(b): a NET realized capital loss offsets at most $3,000 of other income.
// The cap must apply to the year's AGGREGATE (totalSTCG + totalLTCG), not per
// bucket or per sale — a both-underwater RSU pool otherwise piped a loss many
// times the limit into the unfloored SS-taxability and state-tax bases.
// =============================================================================
describe('§1211(b): RSU net capital loss capped at $3,000 on the aggregate', () => {
    it('caps the combined ST+LT loss when BOTH buckets are underwater', () => {
        // Two 1,000-share lots, $40 basis, current price $25 → -$15/sh each. One
        // long-term (vested 2023), one short-term (vested Jan 2025). FIFO sells
        // both, realizing an LT loss AND an ST loss; raw net is ~-$27k.
        const ltLot = { id: 'lt', grantDate: new Date(2022, 0, 1), vestDate: new Date(2023, 0, 1), fmvAtVest: 40, shares: 1000, costBasis: 40000 };
        const stLot = { id: 'st', grantDate: new Date(2025, 0, 1), vestDate: new Date(2025, 0, 1), fmvAtVest: 40, shares: 1000, costBasis: 40000 };
        const rsu = new RSUAccount('rsu-1', 'Company RSU', 50000, [ltLot, stLot], null, undefined, 'CO', 25, 'fifo', 0);

        const result = planWithdrawals(
            45000, [createAccountSnapshot(rsu, new Date(YEAR, 5, 15))], 66, YEAR,
            taxStateFor('Texas'), 0, undefined,
        );

        // Both buckets sold at a loss...
        expect(result.totalSTCG).toBeLessThan(0);
        expect(result.totalLTCG).toBeLessThan(0);
        // ...but the NET reported loss is the §1211 cap, not the raw ~-$27k.
        expect(result.totalSTCG + result.totalLTCG).toBeCloseTo(-3000, 0);
    });
});
