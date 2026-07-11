/**
 * #204 — the persisted-summary cache key must be a stable, faithful fingerprint
 * of everything a Monte Carlo run's result depends on: identical inputs must
 * produce the SAME key (so a refresh restores), and any change that would alter
 * the result must produce a DIFFERENT key (so a stale summary never shows).
 * Transient config bookkeeping and float noise must NOT move the key.
 *
 * These are pure-function tests over `mcSummaryCacheKey` with producer-real
 * model instances — no mocking needed (the function only hashes its inputs).
 */
import { describe, it, expect } from 'vitest';
import { mcSummaryCacheKey } from '../../services/mcSummaryCache';
import type { MonteCarloConfig } from '../../services/MonteCarloTypes';
import { SavedAccount } from '../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import type { TaxState } from '../../components/Objects/Taxes/TaxContext';

function createConfig(overrides: Partial<MonteCarloConfig> = {}): MonteCarloConfig {
    return {
        enabled: true,
        numScenarios: 100,
        returnMean: 7,
        returnStdDev: 15,
        seed: 12345,
        preset: 'custom',
        ...overrides,
    };
}

const assumptions = {
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(1970, 65, 90),
};

const taxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'Virginia',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: new Date().getFullYear(),
};

const accounts = () => [new SavedAccount('a1', 'Cash', 100_000, 2)];
const incomes = () => [new PassiveIncome('i1', 'Dividends', 10_000, 'Annually', 'No', 'Dividend')];
const expenses = () => [new FoodExpense('e1', 'Groceries', 20_000, 'Annually')];

const key = (config: MonteCarloConfig, accs = accounts()) =>
    mcSummaryCacheKey(config, accs, incomes(), expenses(), assumptions, taxState);

describe('mcSummaryCacheKey', () => {
    it('is identical for identical inputs', () => {
        expect(key(createConfig())).toBe(key(createConfig()));
    });

    it('absorbs float noise within 4dp on returnMean (same key)', () => {
        const a = key(createConfig({ returnMean: 7 }));
        const b = key(createConfig({ returnMean: 7.00000049 }));
        expect(b).toBe(a);
    });

    it('absorbs float noise within 4dp on returnStdDev (same key)', () => {
        const a = key(createConfig({ returnStdDev: 15 }));
        const b = key(createConfig({ returnStdDev: 15.00000021 }));
        expect(b).toBe(a);
    });

    it('a real returnMean change (beyond 4dp) moves the key', () => {
        expect(key(createConfig({ returnMean: 7.01 }))).not.toBe(key(createConfig({ returnMean: 7 })));
    });

    it('a changed account balance moves the key', () => {
        const base = key(createConfig());
        const changed = key(createConfig(), [new SavedAccount('a1', 'Cash', 200_000, 2)]);
        expect(changed).not.toBe(base);
    });

    it('a changed numScenarios moves the key', () => {
        expect(key(createConfig({ numScenarios: 500 }))).not.toBe(key(createConfig({ numScenarios: 100 })));
    });

    it('a changed seed moves the key', () => {
        expect(key(createConfig({ seed: 999 }))).not.toBe(key(createConfig({ seed: 12345 })));
    });

    it('toggling compareToBaseline moves the key', () => {
        expect(key(createConfig({ compareToBaseline: true }))).not.toBe(
            key(createConfig({ compareToBaseline: false })),
        );
    });

    it('ignores transient tracking / UI-only config fields (same key)', () => {
        const base = key(createConfig());
        // preset is UI tracking; enabled is a mode gate; last* are the Tab's
        // inflation/ROR sync bookkeeping — none change the run's result.
        const withNoise = key(createConfig({
            preset: 'historical',
            enabled: false,
            lastInflationAdjusted: true,
            lastInflationRate: 2.6,
            lastRor: 9,
        }));
        expect(withNoise).toBe(base);
    });
});
