import { describe, it, expect } from 'vitest';

import { RSUAccount, InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome, PassiveIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { buildCashflowDetail } from '../../../services/simulation/CashflowDetailBuilder';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import { buildCashflowSankeyData } from '../../../components/Charts/cashflowSankeyData';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

/**
 * #153 — Cashflow Sankey: the "Net Pay" node must balance on the first year an
 * RSU grant vests.
 *
 * The bug: an RSU vest is recognized at its FULL GROSS value as reinvested W-2
 * income, but only the NET shares (gross − sell-to-cover withholding) actually
 * land in the RSU account — the withheld slice was sold to pay tax. The Sankey
 * routed the GROSS amount both into Gross Pay AND back out of Net Pay to the
 * account, while the withholding was ALSO inside the Taxes node. So Net Pay's
 * inflow (gross − tax) was less than its outflow (gross reinvested) by exactly
 * the vest withholding → "Net Pay has $X inflows but $Y outflows" with Y − X ==
 * the withheld amount.
 *
 * The fix: the reinvested OUTFLOW (Net Pay → account) and the `remaining` close
 * use the NET (gross − withheld); the GROSS still flows into Gross Pay so the
 * withholding keeps a tax source. Gross Pay balances (gross in = net-to-NetPay +
 * withheld-to-Taxes) and Net Pay balances (net in = net reinvested out).
 *
 * Runs the REAL engine and feeds each SimulationYear through the same
 * `buildCashflowSankeyData` the chart uses, asserting the imbalance detector
 * reports NO Net-Pay imbalance on the vest year. (Deliberately uses a clean,
 * round, fabricated grant — 300 shares @ $40, 25% withholding — unrelated to any
 * real portfolio.)
 */
describe('#153 Cashflow Sankey — Net Pay balances on the first RSU vest year', () => {
    const BIRTH_YEAR = 1988; // working-age throughout the horizon
    const START_YEAR = new Date().getFullYear();
    // A one-year cliff anchored on the grant's fixed start date vests the next year.
    const VEST_YEAR = START_YEAR + 1;

    // Grant: 300 shares, 1-year cliff, $40/share flat (0% growth → FMV stays $40),
    // 25% sell-to-cover. Gross vest = $12,000; withheld = $3,000; net = $9,000.
    const WITHHOLDING_PCT = 25;

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'California',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: START_YEAR,
    };

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(BIRTH_YEAR, 65, 95),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 0 },
            taxOptimizationEnabled: false,
            autoRothConversions: false,
        },
        withdrawalStrategy: [],
        priorities: [],
    };

    function makeIncomes() {
        // Fixed-start job (no milestone) so the RSU grant anchors on startDate and
        // its 1-year cliff vests in VEST_YEAR.
        const inc = new WorkIncome(
            'rsu-job', 'Engineer', 150000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(START_YEAR, 0, 1),
        );
        inc.rsuVestingSchedule = 'cliff-1yr';
        inc.rsuGrantShares = 300;
        inc.rsuVestFrequency = 'quarterly';
        inc.rsuExpectedStockGrowth = 0;
        inc.rsuAccountId = 'rsu-acct';
        inc.rsuWithholdingRate = WITHHOLDING_PCT;
        return [inc];
    }
    const makeAccounts = () => [
        new RSUAccount('rsu-acct', 'Equity Grants', 0, [], 'rsu-job', undefined, 'ACME', 40),
        new InvestedAccount('acc-cash', 'Cash', 25000, 0, 10, 0, 'Brokerage', true, 1.0, 25000),
    ];
    const makeExpenses = () => [
        new FoodExpense('exp-living', 'Living', 48000, 'Annually', new Date(START_YEAR, 0, 1)),
    ];

    /** Map a SimulationYear into buildCashflowSankeyData exactly as CashflowTabs does. */
    function sankeyForYear(y: ReturnType<typeof runSimulation>[number]) {
        return buildCashflowSankeyData({
            incomes: y.incomes,
            expenses: y.expenses,
            year: y.year,
            taxes: y.taxDetails,
            bucketAllocations: y.cashflow.bucketDetail || {},
            accounts: y.accounts,
            withdrawals: y.cashflow.withdrawalDetail || {},
            rothConversion: y.rothConversion,
            cashflowDetail: y.cashflowDetail,
            livingExpenses: y.cashflow.livingExpenses,
        });
    }

    it('records the RSU vest reinvested-net = gross − withholding (builder)', () => {
        const sim = runSimulation(8, makeAccounts(), makeIncomes(), makeExpenses(), assumptions, taxState);

        const vest = sim.find(y => y.year === VEST_YEAR);
        expect(vest?.cashflowDetail, 'vest year should be an engine year with cashflowDetail').toBeDefined();

        const vestSource = vest!.cashflowDetail!.incomeBySource.find(
            s => s.kind === 'reinvested' && /RSU Vest/i.test(s.name),
        );
        expect(vestSource, 'a reinvested RSU vest income source in the vest year').toBeDefined();

        // Gross was recognized; net = gross × (1 − withholding%). This is the value
        // the Sankey routes OUT of Net Pay (the withheld slice went to Taxes).
        expect(vestSource!.amount, 'gross vest recognized').toBeGreaterThan(0);
        expect(vestSource!.reinvestedNet, 'reinvestedNet must be set for an RSU vest').toBeDefined();
        expect(vestSource!.reinvestedNet!).toBeCloseTo(
            vestSource!.amount * (1 - WITHHOLDING_PCT / 100),
            2,
        );
        // The net is strictly less than gross — the whole point.
        expect(vestSource!.reinvestedNet!).toBeLessThan(vestSource!.amount - 1);
    });

    it('labels the reinvested destination with the RSU ACCOUNT name, not the vest income name', () => {
        const sim = runSimulation(8, makeAccounts(), makeIncomes(), makeExpenses(), assumptions, taxState);

        const vest = sim.find(y => y.year === VEST_YEAR);
        const vestSource = vest!.cashflowDetail!.incomeBySource.find(
            s => s.kind === 'reinvested' && /RSU Vest/i.test(s.name),
        );
        expect(vestSource, 'a reinvested RSU vest income source in the vest year').toBeDefined();

        // The vest id is `rsu-vest-{accountId}-{incomeId}-{year}`; the Sankey destination
        // must resolve to the linked RSU account ('Equity Grants'), not the synthetic
        // vest-income name ('… RSU Vest'). With the explicit account-id map plumbed from
        // RSUVesting → SimulationEngine → buildCashflowDetail, this is an exact-id lookup.
        expect(vestSource!.accountName).toBe('Equity Grants');
        expect(vestSource!.accountName).not.toMatch(/RSU Vest/i);
    });

    it('reports NO Net Pay imbalance in any engine year, including the vest year (regression)', () => {
        const sim = runSimulation(8, makeAccounts(), makeIncomes(), makeExpenses(), assumptions, taxState);

        // Sanity: the vest actually fired (the RSU account holds net shares), so the
        // test genuinely exercises the reinvested-withholding path.
        const vest = sim.find(y => y.year === VEST_YEAR);
        const rsu = vest?.accounts.find(a => a instanceof RSUAccount) as RSUAccount | undefined;
        expect(rsu, 'RSU account present in the vest year').toBeDefined();
        expect(rsu!.totalShares, 'net vested shares landed in the RSU account').toBeGreaterThan(0);

        const engineYears = sim.filter(y => y.cashflowDetail);
        expect(engineYears.length, 'should have engine-projected years').toBeGreaterThan(0);

        for (const y of engineYears) {
            const { imbalances, error } = sankeyForYear(y);
            expect(error, `sankey build error in ${y.year}`).toBeNull();
            const netPay = imbalances.find(im => im.nodeName === 'Net Pay');
            expect(
                netPay,
                netPay
                    ? `Net Pay unbalanced in ${y.year}: in=${netPay.inflows.toFixed(2)} out=${netPay.outflows.toFixed(2)} Δ=${netPay.difference.toFixed(2)}`
                    : undefined,
            ).toBeUndefined();
            expect(
                imbalances,
                `unexpected Sankey imbalances in ${y.year}: ${JSON.stringify(imbalances)}`,
            ).toHaveLength(0);
        }
    });
});

/**
 * Re-review findings 4/5 — RSU-vest Sankey destination resolution by EXPLICIT id.
 *
 * The vest income id is `rsu-vest-${rsuAccount.id}-${inc.id}-${year}`. Both the
 * account id and the income id can contain hyphens, so reverse-engineering the
 * destination account from the vest id by PREFIX matching is genuinely ambiguous:
 *
 *   account id  'rsu'  + income id '2-eng'  →  vest id  'rsu-vest-rsu-2-eng-YYYY'
 *
 * That same vest id ALSO starts with `rsu-vest-rsu-2-` (the prefix of account
 * 'rsu-2'). The old longest-prefix resolver therefore picked 'rsu-2' — the WRONG
 * account — for a vest that genuinely belongs to 'rsu'. The proper fix carries the
 * source account id explicitly from the mint site (RSUVesting.ts) through the
 * engine to buildCashflowDetail, so resolution is an EXACT-id lookup with no
 * parsing and no instanceof gating.
 *
 * These tests drive the REAL engine so the vest id, the account-id map, and the
 * full plumbing are all exercised exactly as production builds them.
 */
describe('RSU-vest Sankey account resolution — explicit id (re-review 4/5)', () => {
    const BIRTH_YEAR = 1988;
    const START_YEAR = new Date().getFullYear();
    const VEST_YEAR = START_YEAR + 1;
    const WITHHOLDING_PCT = 25;

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'California',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: START_YEAR,
    };

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(BIRTH_YEAR, 65, 95),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 0 },
            taxOptimizationEnabled: false,
            autoRothConversions: false,
        },
        withdrawalStrategy: [],
        priorities: [],
    };

    /**
     * A WorkIncome with a 1-year-cliff RSU grant linked to `rsuAccountId`.
     * `id` is chosen so the minted vest id collides by prefix with another account.
     */
    function makeRsuJob(id: string, name: string, rsuAccountId: string) {
        const inc = new WorkIncome(
            id, name, 150000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(START_YEAR, 0, 1),
        );
        inc.rsuVestingSchedule = 'cliff-1yr';
        inc.rsuGrantShares = 300;
        inc.rsuVestFrequency = 'quarterly';
        inc.rsuExpectedStockGrowth = 0;
        inc.rsuAccountId = rsuAccountId;
        inc.rsuWithholdingRate = WITHHOLDING_PCT;
        return inc;
    }

    const cashAccount = () =>
        new InvestedAccount('acc-cash', 'Cash', 25000, 0, 10, 0, 'Brokerage', true, 1.0, 25000);
    const livingExpense = () =>
        new FoodExpense('exp-living', 'Living', 48000, 'Annually', new Date(START_YEAR, 0, 1));

    // Two RSU accounts whose ids collide on a prefix: 'rsu' is a textual prefix of
    // 'rsu-2'. The grant on 'rsu' has income id '2-eng', so its vest id is
    // 'rsu-vest-rsu-2-eng-YYYY' — which ALSO prefix-matches account 'rsu-2'.
    const makeCollisionAccounts = () => [
        new RSUAccount('rsu', 'Equity Grants A', 0, [], '2-eng', undefined, 'AAA', 40),
        new RSUAccount('rsu-2', 'Equity Grants B', 0, [], 'engb', undefined, 'BBB', 40),
    ];

    function vestSourceFor(
        sim: ReturnType<typeof runSimulation>,
        incomeName: string,
    ) {
        const vest = sim.find(y => y.year === VEST_YEAR);
        expect(vest?.cashflowDetail, 'vest year should be an engine year with cashflowDetail').toBeDefined();
        return vest!.cashflowDetail!.incomeBySource.find(
            s => s.kind === 'reinvested' && s.name === `${incomeName} RSU Vest`,
        );
    }

    it("resolves a vest whose id prefix-collides ('rsu' + income '2-eng' → 'rsu-vest-rsu-2-eng-*') to 'rsu', NOT 'rsu-2'", () => {
        // The grant belongs to account 'rsu' (income id '2-eng'). Account 'rsu-2' has
        // its OWN grant (income 'engb') so both vest the same year — exactly the
        // ambiguity the old longest-prefix resolver got wrong.
        const accounts = [...makeCollisionAccounts(), cashAccount()];
        const incomes = [
            makeRsuJob('2-eng', 'Engineer A', 'rsu'),
            makeRsuJob('engb', 'Engineer B', 'rsu-2'),
        ];
        const sim = runSimulation(4, accounts, incomes, [livingExpense()], assumptions, taxState);

        const a = vestSourceFor(sim, 'Engineer A');
        expect(a, 'a reinvested RSU vest source for Engineer A').toBeDefined();
        // The collision bug labelled this 'Equity Grants B' (the longer 'rsu-2' id).
        // The explicit-id map resolves it to 'rsu' → 'Equity Grants A'.
        expect(a!.accountName).toBe('Equity Grants A');
        expect(a!.accountName).not.toBe('Equity Grants B');
    });

    it("resolves a vest destined for 'rsu-2' to that account", () => {
        const accounts = [...makeCollisionAccounts(), cashAccount()];
        const incomes = [
            makeRsuJob('2-eng', 'Engineer A', 'rsu'),
            makeRsuJob('engb', 'Engineer B', 'rsu-2'),
        ];
        const sim = runSimulation(4, accounts, incomes, [livingExpense()], assumptions, taxState);

        const b = vestSourceFor(sim, 'Engineer B');
        expect(b, 'a reinvested RSU vest source for Engineer B').toBeDefined();
        expect(b!.accountName).toBe('Equity Grants B');
        expect(b!.accountName).not.toBe('Equity Grants A');
    });

    it('falls back to the raw vest income name when the destination account id is absent from the map (deleted account)', () => {
        // Drive buildCashflowDetail directly: a synthetic reinvested RSU-vest income
        // whose source account is NOT in the (empty) map — mirrors an account that was
        // deleted after the vest was minted. Resolution must fall back to the raw name.
        const detail = buildCashflowDetail({
            incomes: [
                new PassiveIncome(
                    `rsu-vest-gone-eng-${VEST_YEAR}`,
                    'Engineer C RSU Vest',
                    12000,
                    'Annually',
                    'Yes',
                    'RSU',
                    new Date(VEST_YEAR, 0, 1),
                    new Date(VEST_YEAR, 11, 31),
                    true, // isReinvested → routed through the reinvested-destination resolver
                ),
            ],
            expenses: [],
            accounts: [
                new RSUAccount('rsu', 'Equity Grants A', 0, [], '2-eng', undefined, 'AAA', 40),
            ],
            insurance: 0,
            year: VEST_YEAR,
            brokerageLTCGFromGross: 0,
            // The deleted account 'gone' is absent from this map → fallback to raw name.
            rsuVestAccountId: {},
        });
        const src = detail.incomeBySource.find(s => s.kind === 'reinvested');
        expect(src, 'a reinvested RSU vest source').toBeDefined();
        // Must be the raw vest name — NOT a stale prefix-matched account name.
        expect(src!.accountName).toBe('Engineer C RSU Vest');
    });
});

/**
 * Re-review finding [7] — reinvested-INTEREST Sankey destination resolution by
 * EXPLICIT id.
 *
 * The interest income id is `interest-${acc.id}-${year}`, and the source account
 * id is KNOWN at mint time (IncomeProjection.ts). Like the RSU-vest map, the
 * reinvested-interest destination is now carried explicitly via
 * `interestAccountIdByIncomeId` (keyed by the interest income id) and threaded
 * IncomeProjection → SimulationEngine → buildCashflowDetail, so resolution is an
 * EXACT-id lookup rather than a positional `split('-')` parse of the id string.
 *
 * The positional parse is hyphen-safe today (a single trailing year token, so
 * `slice(1, -1).join('-')` reconstructs even a hyphenated account id), so this is a
 * consistency/maintainability change — the parse is retained only as a fallback for
 * callers that don't pass the map. These tests pin: (a) the map drives resolution
 * (it can point somewhere the parse would NOT), (b) a hyphen-containing account id
 * resolves, and (c) the real engine threads the map end-to-end.
 */
import { SavedAccount } from '../../../components/Objects/Accounts/models';

describe('Reinvested-interest Sankey account resolution — explicit id (re-review 7)', () => {
    const YEAR = new Date().getFullYear();

    it('resolves the interest destination from the explicit map (map wins over the positional parse)', () => {
        // The interest id `interest-acct-real-2026` would positionally parse to account
        // id 'acct-real'. We put 'acct-real' in the accounts AND a DIFFERENT account
        // 'acct-mapped' in the map keyed by the income id. The map must win — proving
        // resolution goes through the explicit map, not the id-string parse.
        const detail = buildCashflowDetail({
            incomes: [
                new PassiveIncome(
                    `interest-acct-real-${YEAR}`,
                    'Savings Interest',
                    500,
                    'Annually',
                    'No',
                    'Interest',
                    new Date(YEAR, 0, 1),
                    new Date(YEAR, 11, 31),
                    true, // isReinvested → routed through the reinvested-destination resolver
                ),
            ],
            expenses: [],
            accounts: [
                new SavedAccount('acct-real', 'Parsed Account', 10000, 2),
                new SavedAccount('acct-mapped', 'Mapped Account', 10000, 2),
            ],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            // Map keyed by the interest income id → a DIFFERENT account than the parse.
            interestAccountIdByIncomeId: { [`interest-acct-real-${YEAR}`]: 'acct-mapped' },
        });
        const src = detail.incomeBySource.find(s => s.kind === 'reinvested');
        expect(src, 'a reinvested interest source').toBeDefined();
        // Pre-change there was no map and resolution always parsed the id → 'Parsed
        // Account'. With the map, it resolves by exact id → 'Mapped Account'.
        expect(src!.accountName).toBe('Mapped Account');
    });

    it('resolves a hyphen-containing account id from the map', () => {
        // An account id with internal hyphens, carried by the map → exact-id lookup.
        const detail = buildCashflowDetail({
            incomes: [
                new PassiveIncome(
                    `interest-my-hsa-2-${YEAR}`,
                    'My HSA Interest',
                    300,
                    'Annually',
                    'No',
                    'Interest',
                    new Date(YEAR, 0, 1),
                    new Date(YEAR, 11, 31),
                    true,
                ),
            ],
            expenses: [],
            accounts: [new SavedAccount('my-hsa-2', 'HSA Savings', 8000, 3)],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            interestAccountIdByIncomeId: { [`interest-my-hsa-2-${YEAR}`]: 'my-hsa-2' },
        });
        const src = detail.incomeBySource.find(s => s.kind === 'reinvested');
        expect(src, 'a reinvested interest source').toBeDefined();
        expect(src!.accountName).toBe('HSA Savings');
    });

    it('falls back to the positional parse when the income id is absent from the map', () => {
        // No map entry for this income → the resolver uses the (hyphen-safe) positional
        // parse `interest-{accountId}-{year}`, recovering account 'sav-1'.
        const detail = buildCashflowDetail({
            incomes: [
                new PassiveIncome(
                    `interest-sav-1-${YEAR}`,
                    'Emergency Fund Interest',
                    120,
                    'Annually',
                    'No',
                    'Interest',
                    new Date(YEAR, 0, 1),
                    new Date(YEAR, 11, 31),
                    true,
                ),
            ],
            expenses: [],
            accounts: [new SavedAccount('sav-1', 'Emergency Fund', 6000, 2)],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            // Map omitted entirely → exercises the positional-parse fallback.
        });
        const src = detail.incomeBySource.find(s => s.kind === 'reinvested');
        expect(src, 'a reinvested interest source').toBeDefined();
        expect(src!.accountName).toBe('Emergency Fund');
    });

    it('resolves a DUPLICATE account id FIRST-wins (matching the old accounts.find semantics) (re-review 3)', () => {
        // Re-review [3]: the accountById lookup must preserve the old
        // `accounts.find(a => a.id === X)` FIRST-wins behavior. A botched import /
        // QR-restore can duplicate an account id; the prior `new Map(accounts.map(...))`
        // kept the LAST entry, silently flipping the resolved destination.
        //
        // Two accounts share id 'dup'. The interest income's source account ('dup') is
        // carried by the map, so resolution goes through accountById.get('dup'). It must
        // pick the FIRST 'dup' ('First Account'), exactly as accounts.find() did — NOT
        // the LAST ('Second Account'), which the last-wins Map would have returned.
        const detail = buildCashflowDetail({
            incomes: [
                new PassiveIncome(
                    `interest-dup-${YEAR}`,
                    'Duped Interest',
                    400,
                    'Annually',
                    'No',
                    'Interest',
                    new Date(YEAR, 0, 1),
                    new Date(YEAR, 11, 31),
                    true, // isReinvested → routed through the reinvested-destination resolver
                ),
            ],
            expenses: [],
            accounts: [
                new SavedAccount('dup', 'First Account', 10000, 2),
                new SavedAccount('dup', 'Second Account', 20000, 3),
            ],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
            interestAccountIdByIncomeId: { [`interest-dup-${YEAR}`]: 'dup' },
        });
        const src = detail.incomeBySource.find(s => s.kind === 'reinvested');
        expect(src, 'a reinvested interest source').toBeDefined();
        // FIRST-wins: the old find() returned the first 'dup'. A last-wins Map would
        // resolve to 'Second Account' here (this assertion fails before the fix).
        expect(src!.accountName).toBe('First Account');
        expect(src!.accountName).not.toBe('Second Account');
    });

    it('threads the interest account-id map end-to-end through the real engine', () => {
        // Drive the REAL engine: a savings account earns interest, which projectIncomes
        // mints as a reinvested PassiveIncome and records in interestAccountIdByIncomeId.
        // SimulationEngine passes that map to buildCashflowDetail, so the reinvested
        // source resolves to the SAVINGS ACCOUNT name via the plumbed map.
        const BIRTH_YEAR = 1988;
        const START_YEAR = new Date().getFullYear();
        const ts: TaxState = {
            filingStatus: 'Single',
            stateResidency: 'California',
            deductionMethod: 'Standard',
            fedOverride: null,
            ficaOverride: null,
            stateOverride: null,
            year: START_YEAR,
        };
        const asmpt: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {},
            milestones: createBuiltinMilestones(BIRTH_YEAR, 65, 95),
            income: { ...defaultAssumptions.income, salaryGrowth: 0 },
            macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 0 },
                taxOptimizationEnabled: false,
                autoRothConversions: false,
            },
            withdrawalStrategy: [],
            priorities: [],
        };
        const accounts = [new SavedAccount('hys-1', 'High Yield Savings', 100000, 4)];
        const incomes = [
            new WorkIncome(
                'job', 'Engineer', 150000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED',
                new Date(START_YEAR, 0, 1),
            ),
        ];
        const expenses = [
            new FoodExpense('exp-living', 'Living', 48000, 'Annually', new Date(START_YEAR, 0, 1)),
        ];
        const sim = runSimulation(3, accounts, incomes, expenses, asmpt, ts);

        // Find an engine year whose cashflow detail carries the reinvested interest source.
        const interestSource = sim
            .map(y => y.cashflowDetail?.incomeBySource.find(
                s => s.kind === 'reinvested' && /Interest/i.test(s.name),
            ))
            .find(Boolean);
        expect(interestSource, 'a reinvested interest source from the real engine').toBeDefined();
        // Resolved via the plumbed interestAccountIdByIncomeId map → the account name.
        expect(interestSource!.accountName).toBe('High Yield Savings');
    });
});
