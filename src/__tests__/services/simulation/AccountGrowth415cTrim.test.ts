/**
 * Regression tests for two §415(c) combined-401k-limit edge cases surfaced in
 * the engine review (LOW severity).
 *
 * ISSUE 1 — processInflows' §415(c) running total uses the NET userInflows
 *   balance for the destination account. When that account is BOTH a
 *   contribution destination AND drained earlier in the same year (RMD /
 *   in-service withdrawal / Roth conversion), executeYearPlan / processRMDs have
 *   already written a NEGATIVE userInflows entry. Reading it as `currentSelf`
 *   understates prior additions, so the §415(c) trim under-fires and the account
 *   ends up over-funded above the combined limit.
 *
 * ISSUE 2 — buildCashflowDetail recomputes userPreTax401k / userRoth401k from the
 *   RAW `inc.preTax401k / inc.roth401k`, ignoring the §415(c) trim that
 *   processInflows applied to the employee deferral. When two jobs route into one
 *   401k and their combined deferrals exceed §415(c), the Sankey shows the full
 *   untrimmed deferral, so the deposited (capped) deferral != the chart's inflow
 *   — Net Pay inflow ≠ outflow.
 */
import { describe, it, expect } from 'vitest';
import { processInflows } from '../../../services/simulation/AccountGrowth';
import { buildCashflowDetail } from '../../../services/simulation/CashflowDetailBuilder';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { AssumptionsState, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { WithdrawalState } from '../../../services/simulation/types';
import { get415cLimit } from '../../../data/ContributionLimits';

function createWithdrawalState(overrides: Partial<WithdrawalState> = {}): WithdrawalState {
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
        ...overrides,
    };
}

const assumptions: AssumptionsState = {
    ...defaultAssumptions,
    macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
};

// A WorkIncome that defers `preTax` + `roth` (ANNUAL, since frequency is Annually)
// into matchAccountId, plus a fixed-dollar employer match.
function work401k(
    id: string,
    salary: number,
    preTax: number,
    roth: number,
    employerMatch: number,
    matchAccountId: string,
): WorkIncome {
    return new WorkIncome(
        id, `Job ${id}`, salary, 'Annually', 'Yes',
        preTax,         // preTax401k (per period; Annually => 1 period => annual)
        0,              // insurance
        roth,           // roth401k
        employerMatch,  // employerMatch
        matchAccountId,
        null,           // taxType
        'FIXED',        // contributionGrowthStrategy
        new Date('2020-01-01'),
        undefined,
        0,              // hsaContribution
    );
}

describe('§415(c) trim — drained-and-contributing account (Issue 1)', () => {
    const YEAR = 2025;
    const AGE = 35; // below RMD age; no catch-up
    const limit415c = get415cLimit(YEAR, AGE, false); // 70000 for 2025

    it('trims combined additions to §415(c) even when the account was drained earlier this year', () => {
        // One Traditional 401k that this year is also the source of an in-service
        // withdrawal / RMD / conversion. SimulationEngine has already written a
        // negative userInflows entry for that drain BEFORE processInflows runs.
        const account = new InvestedAccount('trad', 'Traditional 401k', 500000, 0, 0, 0, 'Traditional 401k');

        // Employee defers 40k, employer matches 35k => 75k combined additions,
        // 5k over the 70k §415(c) limit. The match should be trimmed by 5k.
        const income = work401k('j1', 200000, 40000, 0, 35000, 'trad');

        const ws = createWithdrawalState({
            // A $30k in-service withdrawal / RMD already drained the account this
            // year (negative userInflows), exactly as executeYearPlan / processRMDs write it.
            userInflows: { trad: -30000 },
        });

        processInflows(
            [income], [account], assumptions, YEAR, ws,
            0, undefined, 0, AGE, [],
        );

        // The combined POSITIVE additions deposited this year (employee deferral +
        // employer match) must not exceed §415(c). The negative withdrawal stays in
        // the net balance but must NOT be counted as a "prior addition" that masks
        // the trim.
        const depositedSelf = (ws.userInflows.trad ?? 0) - (-30000); // back out the pre-existing drain
        const depositedMatch = ws.employerInflows.trad ?? 0;
        const combinedAdditions = depositedSelf + depositedMatch;

        expect(combinedAdditions).toBeLessThanOrEqual(limit415c + 0.5);
        // Specifically: employee 40k kept, match trimmed 35k -> 30k.
        expect(depositedSelf).toBeCloseTo(40000, 2);
        expect(depositedMatch).toBeCloseTo(30000, 2);
    });

    it('still trims when two incomes feed one drained account and their deferrals alone exceed §415(c)', () => {
        const account = new InvestedAccount('trad', 'Traditional 401k', 500000, 0, 0, 0, 'Traditional 401k');
        // Two jobs, each deferring 40k => 80k employee deferral alone, 10k over.
        const j1 = work401k('j1', 200000, 40000, 0, 0, 'trad');
        const j2 = work401k('j2', 200000, 40000, 0, 0, 'trad');

        const ws = createWithdrawalState({
            userInflows: { trad: -50000 }, // drained earlier this year
        });

        processInflows(
            [j1, j2], [account], assumptions, YEAR, ws,
            0, undefined, 0, AGE, [],
        );

        const depositedSelf = (ws.userInflows.trad ?? 0) - (-50000);
        expect(depositedSelf).toBeLessThanOrEqual(limit415c + 0.5);
        expect(depositedSelf).toBeCloseTo(limit415c, 2); // trimmed to exactly 70k
    });

    it('does not over-trim when the account was NOT drained (control)', () => {
        const account = new InvestedAccount('trad', 'Traditional 401k', 500000, 0, 0, 0, 'Traditional 401k');
        const income = work401k('j1', 200000, 40000, 0, 35000, 'trad');
        const ws = createWithdrawalState(); // no prior drain

        processInflows(
            [income], [account], assumptions, YEAR, ws,
            0, undefined, 0, AGE, [],
        );

        expect(ws.userInflows.trad).toBeCloseTo(40000, 2);
        expect(ws.employerInflows.trad).toBeCloseTo(30000, 2); // 35k match trimmed by 5k
    });
});

describe('Sankey employee-deferral §415(c) trim (Issue 2)', () => {
    const YEAR = 2025;
    const AGE = 35;
    const limit415c = get415cLimit(YEAR, AGE, false); // 70000

    it('buildCashflowDetail reflects the TRIMMED employee deferral, not the raw deferral', () => {
        // Two jobs each deferring 40k pre-tax into the SAME Traditional 401k.
        // Combined 80k employee deferral > 70k §415(c) -> processInflows trims to 70k.
        const account = new InvestedAccount('trad', 'Traditional 401k', 100000, 0, 0, 0, 'Traditional 401k');
        const j1 = work401k('j1', 200000, 40000, 0, 0, 'trad');
        const j2 = work401k('j2', 200000, 40000, 0, 0, 'trad');

        const ws = createWithdrawalState();
        const inflowResult = processInflows([j1, j2], [account], assumptions, YEAR, ws, 0, undefined, 0, AGE, []);

        // Engine deposited the trimmed amount:
        expect(ws.userInflows.trad).toBeCloseTo(limit415c, 2);
        expect(inflowResult.userContributions.trad).toBeCloseTo(limit415c, 2);

        const detail = buildCashflowDetail({
            incomes: [j1, j2],
            expenses: [],
            accounts: [account],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            employerInflows: ws.employerInflows,
            userContributions: inflowResult.userContributions,
        });

        // The Sankey's pre-tax deferral must equal what was actually deposited
        // (70k), NOT the raw 80k. Before the fix this is 80k.
        expect(detail.userPreTax401k).toBeCloseTo(limit415c, 2);
        expect(detail.userRoth401k).toBeCloseTo(0, 2);
    });

    it('splits the trimmed deferral across pre-tax and Roth by the account taxType', () => {
        // Roth 401k destination: combined Roth deferral 80k > 70k, trimmed to 70k.
        const account = new InvestedAccount('roth', 'Roth 401k', 100000, 0, 0, 0, 'Roth 401k');
        const j1 = work401k('j1', 200000, 0, 40000, 0, 'roth');
        const j2 = work401k('j2', 200000, 0, 40000, 0, 'roth');

        const ws = createWithdrawalState();
        const inflowResult = processInflows([j1, j2], [account], assumptions, YEAR, ws, 0, undefined, 0, AGE, []);
        expect(ws.userInflows.roth).toBeCloseTo(limit415c, 2);

        const detail = buildCashflowDetail({
            incomes: [j1, j2],
            expenses: [],
            accounts: [account],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            employerInflows: ws.employerInflows,
            userContributions: inflowResult.userContributions,
        });

        expect(detail.userRoth401k).toBeCloseTo(limit415c, 2);
        expect(detail.userPreTax401k).toBeCloseTo(0, 2);
    });

    it('untrimmed case is unchanged: pre-tax + Roth deferrals to their own accounts (control)', () => {
        // No §415(c) breach. Pre-tax routes to a Traditional 401k, Roth to a Roth 401k.
        // The deposited amounts equal the raw deferrals and split by account taxType.
        const tradAccount = new InvestedAccount('trad', 'Traditional 401k', 100000, 0, 0, 0, 'Traditional 401k');
        const rothAccount = new InvestedAccount('roth', 'Roth 401k', 50000, 0, 0, 0, 'Roth 401k');
        const jTrad = work401k('jTrad', 200000, 20000, 0, 0, 'trad');
        const jRoth = work401k('jRoth', 200000, 0, 5000, 0, 'roth');

        const ws = createWithdrawalState();
        const inflowResult = processInflows([jTrad, jRoth], [tradAccount, rothAccount], assumptions, YEAR, ws, 0, undefined, 0, AGE, []);

        const detail = buildCashflowDetail({
            incomes: [jTrad, jRoth],
            expenses: [],
            accounts: [tradAccount, rothAccount],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            employerInflows: ws.employerInflows,
            userContributions: inflowResult.userContributions,
        });

        expect(detail.userPreTax401k).toBeCloseTo(20000, 2);
        expect(detail.userRoth401k).toBeCloseTo(5000, 2);
    });

    it('falls back to raw per-income fields when userContributions is omitted (back-compat)', () => {
        // Callers that do not pass userContributions (e.g. legacy or non-trimmed
        // paths) keep the prior behavior: deferral summed from raw inc fields.
        const account = new InvestedAccount('trad', 'Traditional 401k', 100000, 0, 0, 0, 'Traditional 401k');
        const j1 = work401k('j1', 200000, 18000, 4000, 0, 'trad');

        const detail = buildCashflowDetail({
            incomes: [j1],
            expenses: [],
            accounts: [account],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            // no userContributions
        });

        expect(detail.userPreTax401k).toBeCloseTo(18000, 2);
        expect(detail.userRoth401k).toBeCloseTo(4000, 2);
    });
});
