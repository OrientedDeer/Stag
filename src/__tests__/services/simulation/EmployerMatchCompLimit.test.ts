/**
 * §401(a)(17): a plan may not take into account compensation above the annual
 * limit ($345k 2024, $350k 2025, $360k 2026 — IRS Notices 2023-75, 2024-80,
 * 2025-67). A percent-of-salary employer match must therefore be computed on
 * min(salary, limit), not on the full salary.
 */
import { describe, it, expect } from 'vitest';
import { processInflows } from '../../../services/simulation/AccountGrowth';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { type AssumptionsState, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type WithdrawalState } from '../../../services/simulation/types';
import { getCompensationLimit } from '../../../data/ContributionLimits';

function createWithdrawalState(): WithdrawalState {
    return {
        userInflows: {},
        employerInflows: {},
        withdrawalTaxes: 0,
        capitalGainsTaxTotal: 0,
        withdrawalOrdinaryTaxTotal: 0,
        strategyWithdrawalExecuted: 0,
        totalWithdrawals: 0,
        withdrawalDetail: {},
        withdrawalPenalties: 0,
        totalGrossIncome: 0,
        traditionalWithdrawals: 0,
        longTermCapitalGains: 0,
        shortTermCapitalGains: 0,
        stateCapitalGainsTax: 0,
    };
}

function percentMatchJob(salary: number, matchPercent: number, startDate = new Date(2020, 0, 1)): WorkIncome {
    const job = new WorkIncome(
        'j1', 'Job', salary, 'Annually', 'Yes',
        0, 0, 0, 0, 'trad', null, 'FIXED',
        startDate, undefined, 0,
    );
    job.employerMatchType = 'percent';
    job.employerMatchPercent = matchPercent;
    return job;
}

describe('getCompensationLimit (§401(a)(17))', () => {
    it('returns the published limits', () => {
        expect(getCompensationLimit(2024)).toBe(345_000);
        expect(getCompensationLimit(2025)).toBe(350_000);
        expect(getCompensationLimit(2026)).toBe(360_000);
    });

    it('holds the latest limit flat in real-dollar mode', () => {
        expect(getCompensationLimit(2035, false)).toBe(360_000);
    });

    it('projects future years in $5,000 steps, rounded down (§401(a)(17)(B))', () => {
        const projected = getCompensationLimit(2030);
        expect(projected % 5_000).toBe(0);
        expect(projected).toBeGreaterThan(360_000);
        expect(projected).toBeLessThanOrEqual(360_000 * Math.pow(1.025, 4));
    });
});

describe('percent employer match respects the §401(a)(17) compensation limit', () => {
    it('computes a 6% match on a $500k salary against $360k in 2026', () => {
        const job = percentMatchJob(500_000, 6);
        expect(job.getEffectiveAnnualEmployerMatch(2026)).toBeCloseTo(21_600, 2);
    });

    it('leaves salaries under the limit unchanged', () => {
        const job = percentMatchJob(200_000, 6);
        expect(job.getEffectiveAnnualEmployerMatch(2026)).toBeCloseTo(12_000, 2);
    });

    it('applies the limit to compensation actually paid in a partial first year', () => {
        // $600k/yr starting July 1 → $300k paid in 2026, under the $360k limit.
        const job = percentMatchJob(600_000, 6, new Date(2026, 6, 1));
        expect(job.getEffectiveAnnualEmployerMatch(2026)).toBeCloseTo(18_000, 2);
    });

    it('deposits the capped match in the simulation', () => {
        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
        };
        const account = new InvestedAccount('trad', 'Traditional 401k', 100_000, 0, 0, 0, 'Traditional 401k');
        const ws = createWithdrawalState();

        processInflows([percentMatchJob(500_000, 6)], [account], assumptions, 2026, ws, 0, undefined, 0, 45, []);

        expect(ws.employerInflows['trad']).toBeCloseTo(21_600, 2);
    });
});
