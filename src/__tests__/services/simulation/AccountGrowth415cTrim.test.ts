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

    it('splits a single income deferring BOTH pre-tax and Roth into one account by its own raw ratio', () => {
        // One job defers 18k pre-tax + 12k Roth (30k total) into ONE 401k account.
        // AccountGrowth sums both fields into a single deposit keyed by the destination
        // account. Splitting the deposit purely by the account's taxType would attribute
        // the whole 30k to one flow and make the other portion vanish from the Sankey.
        // The split must instead follow the income's own raw preTax401k : roth401k.
        const account = new InvestedAccount('trad', 'Traditional 401k', 100000, 0, 0, 0, 'Traditional 401k');
        const job = work401k('j1', 200000, 18000, 12000, 0, 'trad');

        const ws = createWithdrawalState();
        const inflowResult = processInflows([job], [account], assumptions, YEAR, ws, 0, undefined, 0, AGE, []);

        // Whole 30k is deposited into the single account (no §415(c) breach).
        const depositedTotal = inflowResult.userContributions.trad;
        expect(depositedTotal).toBeCloseTo(30000, 2);

        const detail = buildCashflowDetail({
            incomes: [job],
            expenses: [],
            accounts: [account],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            employerInflows: ws.employerInflows,
            userContributions: inflowResult.userContributions,
        });

        // BOTH deferral flows must be nonzero (the Roth portion no longer disappears),
        // they must match the income's own 18k/12k split, and sum to the deposited total.
        expect(detail.userPreTax401k).toBeCloseTo(18000, 2);
        expect(detail.userRoth401k).toBeCloseTo(12000, 2);
        expect(detail.userPreTax401k + detail.userRoth401k).toBeCloseTo(depositedTotal, 2);
    });

    it('preserves the §415(c)-trimmed total when a mixed pre-tax+Roth income is trimmed', () => {
        // One job defers 45k pre-tax + 45k Roth (90k) into ONE 401k. §415(c) (70k) trims
        // the deposit to 70k. The two flows must still split by the raw 45:45 ratio and
        // their sum must equal the deposited (trimmed) 70k — not the raw 90k.
        const account = new InvestedAccount('trad', 'Traditional 401k', 100000, 0, 0, 0, 'Traditional 401k');
        const job = work401k('j1', 300000, 45000, 45000, 0, 'trad');

        const ws = createWithdrawalState();
        const inflowResult = processInflows([job], [account], assumptions, YEAR, ws, 0, undefined, 0, AGE, []);
        const depositedTotal = inflowResult.userContributions.trad;
        expect(depositedTotal).toBeCloseTo(limit415c, 2); // 70k

        const detail = buildCashflowDetail({
            incomes: [job],
            expenses: [],
            accounts: [account],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            employerInflows: ws.employerInflows,
            userContributions: inflowResult.userContributions,
        });

        // 45:45 raw ratio -> 35k / 35k of the trimmed 70k.
        expect(detail.userPreTax401k).toBeCloseTo(limit415c / 2, 2);
        expect(detail.userRoth401k).toBeCloseTo(limit415c / 2, 2);
        expect(detail.userPreTax401k + detail.userRoth401k).toBeCloseTo(depositedTotal, 2);
    });

    it('attributes the per-job trimmed split when two jobs of DIFFERENT kinds share one over-limit 401k', () => {
        // j1 defers 40k PRE-TAX, j2 defers 40k ROTH, both into ONE Traditional 401k.
        // Combined 80k > 70k §415(c). The engine processes j1 first (40k pre-tax, under
        // the limit), then j2 breaches and is trimmed to 30k. So the engine actually
        // deposits 40k pre-tax + 30k Roth (the LAST job feeding the account eats the trim).
        //
        // The raw-ratio split (40:40 = 50/50) would wrongly show 35k pre-tax + 35k Roth.
        // Attributing from the per-income TRIMMED deferral must reflect the engine's
        // real 40k/30k split.
        const account = new InvestedAccount('trad', 'Traditional 401k', 100000, 0, 0, 0, 'Traditional 401k');
        const j1 = work401k('j1', 200000, 40000, 0, 0, 'trad');     // pre-tax
        const j2 = work401k('j2', 200000, 0, 40000, 0, 'trad');     // roth

        const ws = createWithdrawalState();
        const inflowResult = processInflows([j1, j2], [account], assumptions, YEAR, ws, 0, undefined, 0, AGE, []);

        // Engine deposited the trimmed total (70k) into the single account.
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
            // The per-income trimmed deferral the engine actually deposited.
            userContributionsByIncome: inflowResult.userContributionsByIncome,
        });

        // j1's 40k pre-tax survives whole; j2's 40k Roth is trimmed to 30k.
        expect(detail.userPreTax401k).toBeCloseTo(40000, 2);
        expect(detail.userRoth401k).toBeCloseTo(30000, 2);
        expect(detail.userPreTax401k + detail.userRoth401k).toBeCloseTo(limit415c, 2);
    });

    it('per-income split stays byte-identical to the raw-ratio path in the untrimmed common case', () => {
        // No §415(c) breach. Two jobs, mixed kinds, into one account but under the limit:
        // the per-income trimmed amounts equal the raw deferrals, so the result must match
        // exactly what the raw-ratio path produces (common case unchanged).
        const account = new InvestedAccount('trad', 'Traditional 401k', 100000, 0, 0, 0, 'Traditional 401k');
        const j1 = work401k('j1', 200000, 20000, 0, 0, 'trad');     // pre-tax
        const j2 = work401k('j2', 200000, 0, 5000, 0, 'trad');      // roth

        const ws = createWithdrawalState();
        const inflowResult = processInflows([j1, j2], [account], assumptions, YEAR, ws, 0, undefined, 0, AGE, []);

        const detail = buildCashflowDetail({
            incomes: [j1, j2],
            expenses: [],
            accounts: [account],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            employerInflows: ws.employerInflows,
            userContributions: inflowResult.userContributions,
            userContributionsByIncome: inflowResult.userContributionsByIncome,
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

    it('does not vanish/double-count deferral when two jobs SHARE an income id (import collision)', () => {
        // QR/JSON import reconstitutes incomes with id="" (the model default), so two
        // restored jobs feeding one 401k collide on the empty-string key. The engine's
        // per-income map (keyed by inc.id) then holds only the LAST writer's split, and
        // the per-income attribution loop — which reads that map once PER income — adds
        // the survivor's split for BOTH jobs: one job's deferral vanishes, the other
        // double-counts, and Net-Pay inflow ≠ outflow.
        //
        // Asymmetric kinds make the bug visible: j1 defers 30k PRE-TAX, j2 defers 10k
        // ROTH, both into ONE trad 401k, both id="". The map ends as {pre:0, roth:10k}
        // (j2 overwrote j1). The broken per-income loop yields 0 pre-tax + 20k Roth
        // (= 20k) instead of the deposited 40k. The fix detects the colliding feeder ids
        // and falls back to the per-ACCOUNT split (not keyed by id), which recovers the
        // real 30k pre-tax / 10k Roth.
        const account = new InvestedAccount('trad', 'Traditional 401k', 100000, 0, 0, 0, 'Traditional 401k');
        const j1 = work401k('', 200000, 30000, 0, 0, 'trad');   // pre-tax, empty id
        const j2 = work401k('', 200000, 0, 10000, 0, 'trad');   // roth, empty id (collides)

        const ws = createWithdrawalState();
        const inflowResult = processInflows([j1, j2], [account], assumptions, YEAR, ws, 0, undefined, 0, AGE, []);

        // No §415(c) breach (40k < 70k, no match): the whole 40k is deposited.
        const depositedTotal = inflowResult.userContributions.trad;
        expect(depositedTotal).toBeCloseTo(40000, 2);
        // The per-income map collided on "" — it holds ONLY j2's split, proving the
        // tier-1 source is unusable here and the builder must fall back.
        expect(inflowResult.userContributionsByIncome[''].preTax).toBeCloseTo(0, 2);
        expect(inflowResult.userContributionsByIncome[''].roth).toBeCloseTo(10000, 2);

        const detail = buildCashflowDetail({
            incomes: [j1, j2],
            expenses: [],
            accounts: [account],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            employerInflows: ws.employerInflows,
            userContributions: inflowResult.userContributions,
            userContributionsByIncome: inflowResult.userContributionsByIncome,
        });

        // Net-Pay deferral inflow equals the deposited total — nothing vanished or
        // double-counted — and the per-account fallback recovers the 30k/10k split.
        expect(detail.userPreTax401k + detail.userRoth401k).toBeCloseTo(depositedTotal, 2);
        expect(detail.userPreTax401k).toBeCloseTo(30000, 2);
        expect(detail.userRoth401k).toBeCloseTo(10000, 2);
    });

    it('does not double-count when a 401k feeder and a MATCHLESS side gig share id="" (incomplete-guard case)', () => {
        // The collision case the old feeder-only guard MISSED: a 401k feeder and a
        // matchless side gig BOTH reconstituted with id="". The side gig has no
        // matchAccountId, so processInflows never records a split for it — the
        // per-income map holds ONLY the feeder's entry under "". The old consumer
        // loop read map[inc.id] once PER WorkIncome, so the side gig (id="") read the
        // feeder's split a SECOND time and the Net-Pay deferral DOUBLED (60k vs 30k).
        //
        // The fix sums the per-income map's VALUES (one entry, counted once) instead
        // of looping incomes, so the matchless gig can't re-read the feeder's split.
        const account = new InvestedAccount('trad', 'Traditional 401k', 100000, 0, 0, 0, 'Traditional 401k');
        const feeder = work401k('', 200000, 30000, 0, 0, 'trad');   // 401k feeder, empty id
        const sideGig = work401k('', 40000, 0, 0, 0, '');           // matchless, empty id (collides)

        const ws = createWithdrawalState();
        const inflowResult = processInflows([feeder, sideGig], [account], assumptions, YEAR, ws, 0, undefined, 0, AGE, []);

        // Only the feeder deferred; the whole 30k is deposited.
        const depositedTotal = inflowResult.userContributions.trad;
        expect(depositedTotal).toBeCloseTo(30000, 2);

        const detail = buildCashflowDetail({
            incomes: [feeder, sideGig],
            expenses: [],
            accounts: [account],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            employerInflows: ws.employerInflows,
            userContributions: inflowResult.userContributions,
            userContributionsByIncome: inflowResult.userContributionsByIncome,
        });

        // Net-Pay deferral inflow equals the single deposited deferral — the matchless
        // gig did NOT double the feeder's 30k.
        expect(detail.userPreTax401k + detail.userRoth401k).toBeCloseTo(depositedTotal, 2);
        expect(detail.userPreTax401k).toBeCloseTo(30000, 2);
        expect(detail.userRoth401k).toBeCloseTo(0, 2);
    });

    it('shows $0 deferral when an active income has preTax401k>0 but an EMPTY matchAccountId and the maps are provided (#2 regression)', () => {
        // The wave-6 regression: an active income with preTax401k>0 but a CLEARED
        // matchAccountId (the linked account was deleted → IncomeCard sets it to '').
        // processInflows deposits NOTHING (no destination), so it passes EMPTY deposit
        // maps. The old guard keyed tier choice on Object.keys(map).length>0, so an
        // empty-but-PROVIDED map fell through to the RAW deferral and the Sankey showed
        // the full $18k that was never deposited. Gating on "was the map passed at all"
        // makes the deferral $0, matching the engine.
        const account = new InvestedAccount('trad', 'Traditional 401k', 100000, 0, 0, 0, 'Traditional 401k');
        // matchAccountId='' → no 401k destination; preTax401k=18k is configured but undeposited.
        const orphan = work401k('orphan', 200000, 18000, 0, 0, '');

        const ws = createWithdrawalState();
        const inflowResult = processInflows([orphan], [account], assumptions, YEAR, ws, 0, undefined, 0, AGE, []);

        // The engine deposited nothing — both maps are PROVIDED but EMPTY.
        expect(Object.keys(inflowResult.userContributions).length).toBe(0);
        expect(Object.keys(inflowResult.userContributionsByIncome).length).toBe(0);

        const detail = buildCashflowDetail({
            incomes: [orphan],
            expenses: [],
            accounts: [account],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            employerInflows: ws.employerInflows,
            userContributions: inflowResult.userContributions,
            userContributionsByIncome: inflowResult.userContributionsByIncome,
        });

        // No deposit happened, so the Sankey's 401k deferral inflow must be 0 — NOT
        // the raw 18k.
        expect(detail.userPreTax401k).toBeCloseTo(0, 2);
        expect(detail.userRoth401k).toBeCloseTo(0, 2);
    });
});
