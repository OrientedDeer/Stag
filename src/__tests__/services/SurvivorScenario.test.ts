/**
 * Survivor-scenario composer (fp-review F3b) — the widow's penalty.
 *
 * The composer assembles the scenario from EXISTING mechanisms, so these tests
 * pin the two seams and the regression guard:
 *   - resolveTaxEventsForYear: filing status resolves to Single from deathYear
 *     on (same latest-fires-wins semantics as a scheduled event), gated on the
 *     household currently being MFJ;
 *   - runSimulationLoop: at deathYear (exactly once) the smaller SS benefit is
 *     dropped and expenses are scaled by expenseFactor — asserted on REAL
 *     engine output (runSimulation), no hand-fabricated SimulationYear shapes;
 *   - everything OFF ⇒ byte-identical simulation (regression guard);
 *   - persistence: the config is plain data that survives the JSON
 *     (localStorage) and QR shorten/expand key paths.
 */
import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState, resolveTaxEventsForYear } from '../../components/Objects/Taxes/TaxContext';
import { type SurvivorScenario, activeSurvivorScenario, applySurvivorTransition } from '../../services/simulation/SurvivorScenario';
import { type AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { type AnyIncome, CurrentSocialSecurityIncome, FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { type AnyExpense, FoodExpense, LoanExpense } from '../../components/Objects/Expense/models';
import { type SimulationYear } from '../../services/simulation/types';
import * as TaxService from '../../components/Objects/Taxes/TaxService';
import { shortenKeys, expandKeys } from '../../components/Objects/Accounts/QRTransfer/qrUtils';

const NOW = new Date().getFullYear();
const BY = NOW - 62, RA = 62, LE = 92;
const DEATH_YEAR = NOW + 10;
const REF_DATE = new Date(NOW, 5, 15); // fixed mid-June reference for byte-stable runs

// MFJ retired household, TX (no state tax), inflation OFF so amounts are exact,
// no conversion optimizer (composition is optimizer-independent). TWO already-
// claimed SS benefits: $30k/yr (survives) and $18k/yr (dropped at deathYear).
function makeCoupleScenario(): {
    accounts: AnyAccount[]; incomes: AnyIncome[]; expenses: AnyExpense[];
    assumptions: AssumptionsState; taxState: TaxState; yearsToRun: number;
} {
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(BY, RA, LE),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 5 },
            taxOptimizationEnabled: false,
            autoRothConversions: false,
        },
        withdrawalStrategy: [
            { id: 'ws-cash', name: 'Cash', accountId: 'acc-cash' },
            { id: 'ws-brk', name: 'Brokerage', accountId: 'acc-brk' },
            { id: 'ws-trad', name: 'Traditional', accountId: 'acc-trad' },
            { id: 'ws-roth', name: 'Roth', accountId: 'acc-roth' },
        ],
    };
    const taxState: TaxState = {
        filingStatus: 'Married Filing Jointly',
        stateResidency: 'TX',
        deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null,
        year: NOW,
    };
    return {
        accounts: [
            new InvestedAccount('acc-trad', 'Traditional 401k', 800_000, 0, 30, 0, 'Traditional 401k', false, 1.0, 800_000),
            new InvestedAccount('acc-brk', 'Brokerage', 300_000, 0, 10, 0, 'Brokerage', false, 1.0, 150_000),
            new InvestedAccount('acc-roth', 'Roth IRA', 50_000, 0, 10, 0, 'Roth IRA', false, 1.0, 50_000),
            new SavedAccount('acc-cash', 'Cash', 50_000, 0),
        ],
        incomes: [
            new CurrentSocialSecurityIncome('inc-ss-a', 'SS (larger)', 2_500, 'Monthly', new Date(NOW - 1, 0, 1)),
            new CurrentSocialSecurityIncome('inc-ss-b', 'SS (smaller)', 1_500, 'Monthly', new Date(NOW - 1, 0, 1)),
        ],
        expenses: [
            new FoodExpense('exp-living', 'Living Expenses', 80_000, 'Annually', new Date(NOW, 0, 1)),
        ],
        assumptions, taxState, yearsToRun: LE - RA,
    };
}

const survivorOn = (overrides: Partial<SurvivorScenario> = {}): SurvivorScenario =>
    ({ enabled: true, deathYear: DEATH_YEAR, expenseFactor: 0.8, ...overrides });

function run(sc: ReturnType<typeof makeCoupleScenario>, survivorScenario?: SurvivorScenario): SimulationYear[] {
    return runSimulation(
        sc.yearsToRun, sc.accounts, sc.incomes, sc.expenses, sc.assumptions,
        { ...sc.taxState, survivorScenario },
        undefined, { referenceDate: REF_DATE },
    );
}

const yearRow = (timeline: SimulationYear[], year: number): SimulationYear =>
    timeline.find(y => y.year === year && !y.isEndOfYearProjection)!;
const realYears = (timeline: SimulationYear[]): SimulationYear[] =>
    timeline.filter(y => !y.isEndOfYearProjection);
const ssIds = (row: SimulationYear): string[] =>
    row.incomes.filter(i => i.className.includes('SocialSecurity')).map(i => i.id).sort();

describe('survivor composition fires at the death year (real engine output)', () => {
    const sc = makeCoupleScenario();
    const timeline = run(sc, survivorOn());

    it('keeps both SS benefits before the death year, only the larger from it on', () => {
        expect(ssIds(yearRow(timeline, DEATH_YEAR - 1))).toEqual(['inc-ss-a', 'inc-ss-b']);
        expect(ssIds(yearRow(timeline, DEATH_YEAR))).toEqual(['inc-ss-a']);
        const last = realYears(timeline)[realYears(timeline).length - 1];
        expect(ssIds(last)).toEqual(['inc-ss-a']); // stays dropped for the whole horizon
    });

    it('household SS benefits drop from $48k to the larger $30k (no COLA — exact)', () => {
        const before = TaxService.getSocialSecurityBenefits(yearRow(timeline, DEATH_YEAR - 1).incomes, DEATH_YEAR - 1);
        const after = TaxService.getSocialSecurityBenefits(yearRow(timeline, DEATH_YEAR).incomes, DEATH_YEAR);
        expect(before).toBeCloseTo(48_000, 6);
        expect(after).toBeCloseTo(30_000, 6);
    });

    it('scales expenses by expenseFactor exactly once (not compounding)', () => {
        expect(yearRow(timeline, DEATH_YEAR - 1).cashflow.livingExpenses).toBeCloseTo(80_000, 6);
        expect(yearRow(timeline, DEATH_YEAR).cashflow.livingExpenses).toBeCloseTo(64_000, 6);
        // A `>=`-style re-application would compound 0.8 every year — pin one-shot.
        expect(yearRow(timeline, DEATH_YEAR + 5).cashflow.livingExpenses).toBeCloseTo(64_000, 6);
    });
});

describe('the filing-status flip reaches the engine through resolveTaxEventsForYear', () => {
    // Isolate the flip: ONE SS income and expenseFactor 1 make the SS/expense
    // half of the composition an identity, so any divergence is the Single
    // brackets/deduction alone.
    const one = makeCoupleScenario();
    one.incomes = [one.incomes[0]];
    const base = run(one);
    const widowed = run(one, survivorOn({ expenseFactor: 1 }));

    it('years before the death year are untouched', () => {
        for (const y of realYears(base)) {
            if (y.year >= DEATH_YEAR) continue;
            expect(yearRow(widowed, y.year).taxDetails.fed).toBeCloseTo(y.taxDetails.fed, 6);
            expect(yearRow(widowed, y.year).cashflow.livingExpenses).toBeCloseTo(y.cashflow.livingExpenses, 6);
        }
    });

    it('survivor years pay materially more federal tax on the same real income (widow\'s penalty)', () => {
        const sumFedFrom = (t: SimulationYear[]) => realYears(t)
            .filter(y => y.year >= DEATH_YEAR)
            .reduce((s, y) => s + y.taxDetails.fed + (y.taxDetails.irmaa ?? 0), 0);
        expect(sumFedFrom(widowed)).toBeGreaterThan(sumFedFrom(base) + 1_000);
    });
});

describe('regression guard — everything OFF is byte-identical', () => {
    it('enabled:false composes nothing', () => {
        const sc = makeCoupleScenario();
        const off = run(sc, { enabled: false, deathYear: DEATH_YEAR, expenseFactor: 0.8 });
        const absent = run(makeCoupleScenario());
        expect(JSON.stringify(off)).toBe(JSON.stringify(absent));
    });

    it('an enabled scenario on a non-MFJ household composes nothing (MFJ gate)', () => {
        const sc = makeCoupleScenario();
        sc.taxState = { ...sc.taxState, filingStatus: 'Single' };
        const on = run(sc, survivorOn());
        const sc2 = makeCoupleScenario();
        sc2.taxState = { ...sc2.taxState, filingStatus: 'Single' };
        const off = run(sc2);
        expect(JSON.stringify(on)).toBe(JSON.stringify(off));
    });
});

describe('resolveTaxEventsForYear — the filing-status seam', () => {
    const mfjBase = (survivorScenario?: SurvivorScenario, taxEvents?: TaxState['taxEvents']): TaxState => ({
        filingStatus: 'Married Filing Jointly',
        stateResidency: 'TX',
        deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null,
        year: NOW,
        taxEvents,
        survivorScenario,
    });
    const noReaches = new Map<string, number>();

    it('resolves Single from deathYear on, MFJ before', () => {
        const s = mfjBase(survivorOn());
        expect(resolveTaxEventsForYear(s, DEATH_YEAR - 1, noReaches).filingStatus).toBe('Married Filing Jointly');
        expect(resolveTaxEventsForYear(s, DEATH_YEAR, noReaches).filingStatus).toBe('Single');
        expect(resolveTaxEventsForYear(s, DEATH_YEAR + 20, noReaches).filingStatus).toBe('Single');
    });

    it('disabled or non-MFJ returns the base unchanged (same reference)', () => {
        const off = mfjBase({ enabled: false, deathYear: DEATH_YEAR });
        expect(resolveTaxEventsForYear(off, DEATH_YEAR + 1, noReaches)).toBe(off);
        const single: TaxState = { ...mfjBase(survivorOn()), filingStatus: 'Single' };
        expect(resolveTaxEventsForYear(single, DEATH_YEAR + 1, noReaches)).toBe(single);
    });

    it('participates in latest-fires-wins with scheduled filing-status events', () => {
        // A user event scheduled AFTER the death year wins from its own year on.
        const s = mfjBase(survivorOn(), [
            { id: 'ev-late', kind: 'filingStatus', value: 'Married Filing Jointly', year: DEATH_YEAR + 5 },
        ]);
        expect(resolveTaxEventsForYear(s, DEATH_YEAR + 4, noReaches).filingStatus).toBe('Single');
        expect(resolveTaxEventsForYear(s, DEATH_YEAR + 5, noReaches).filingStatus).toBe('Married Filing Jointly');
        // An EARLIER event is overridden from the death year on.
        const s2 = mfjBase(survivorOn(), [
            { id: 'ev-early', kind: 'filingStatus', value: 'Married Filing Separately', year: DEATH_YEAR - 3 },
        ]);
        expect(resolveTaxEventsForYear(s2, DEATH_YEAR - 1, noReaches).filingStatus).toBe('Married Filing Separately');
        expect(resolveTaxEventsForYear(s2, DEATH_YEAR, noReaches).filingStatus).toBe('Single');
    });
});

describe('applySurvivorTransition — SS survivor rule + expense scaling details', () => {
    it('keeps an unclaimed FutureSocialSecurityIncome when its projected benefit is the larger', () => {
        // Unclaimed Future SS: amount = calculatedPIA×12 = 0, but projectedPIA
        // says $3,500/mo — larger than the spouse's claimed $18k/yr, so the
        // FUTURE benefit survives (the survivor can still claim it later).
        const future = new FutureSocialSecurityIncome('inc-fut', 'SS (future, larger)', 67, 0, 0, undefined, undefined, undefined, undefined, 3_500);
        const claimed = new CurrentSocialSecurityIncome('inc-cur', 'SS (claimed, smaller)', 1_500, 'Monthly');
        const { incomes } = applySurvivorTransition([future, claimed], [], 1);
        expect(incomes.map(i => i.id)).toEqual(['inc-fut']);
    });

    it('a single SS income is kept (the survivor keeps it)', () => {
        const only = new CurrentSocialSecurityIncome('inc-only', 'SS', 2_000, 'Monthly');
        const { incomes } = applySurvivorTransition([only], [], 0.8);
        expect(incomes.map(i => i.id)).toEqual(['inc-only']);
    });

    it('contractual loans are not scaled; other expenses are', () => {
        const food = new FoodExpense('exp-food', 'Food', 1_000, 'Monthly');
        const loan = new LoanExpense('exp-loan', 'Car Loan', 20_000, 'Monthly', 5, 'Compounding', 450, 'No', 0, 'acc-loan', new Date(NOW, 0, 1));
        const { expenses } = applySurvivorTransition([], [food, loan], 0.8);
        expect(expenses.find(e => e.id === 'exp-food')!.amount).toBeCloseTo(800, 6);
        expect(expenses.find(e => e.id === 'exp-loan')).toBe(loan); // adjustAmount returns `this`
    });

    it('activeSurvivorScenario gates on enabled AND current-MFJ', () => {
        expect(activeSurvivorScenario({ filingStatus: 'Married Filing Jointly', survivorScenario: survivorOn() })).not.toBeNull();
        expect(activeSurvivorScenario({ filingStatus: 'Married Filing Jointly', survivorScenario: { enabled: false, deathYear: DEATH_YEAR } })).toBeNull();
        expect(activeSurvivorScenario({ filingStatus: 'Single', survivorScenario: survivorOn() })).toBeNull();
        expect(activeSurvivorScenario({ filingStatus: 'Married Filing Jointly' })).toBeNull();
    });
});

describe('persistence round-trip', () => {
    const taxState: TaxState = {
        filingStatus: 'Married Filing Jointly',
        stateResidency: 'DC',
        deductionMethod: 'Auto',
        fedOverride: null, ficaOverride: null, stateOverride: null,
        year: NOW,
        survivorScenario: { enabled: true, deathYear: DEATH_YEAR, expenseFactor: 0.8 },
    };

    it('survives the JSON (localStorage) path', () => {
        expect(JSON.parse(JSON.stringify(taxState)).survivorScenario)
            .toEqual({ enabled: true, deathYear: DEATH_YEAR, expenseFactor: 0.8 });
    });

    it('survives the QR shorten/expand key path (nested keys collide with no short key)', () => {
        const roundTripped = expandKeys(shortenKeys(taxState)) as TaxState;
        expect(roundTripped.survivorScenario).toEqual(taxState.survivorScenario);
        expect(roundTripped.filingStatus).toBe(taxState.filingStatus);
    });
});
