/**
 * Tests for simulationHash utilities
 *
 * Tests the hash functions used for simulation change detection.
 */

import { describe, it, expect } from 'vitest';
import { hashString, getSimulationInputHash } from '../../services/simulationHash';
import { AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { WorkIncome } from '../../components/Objects/Income/models';
import type { AnyAccount } from '../../components/Objects/Accounts/models';
import type { AnyIncome } from '../../components/Objects/Income/models';
import type { AnyExpense } from '../../components/Objects/Expense/models';

// =============================================================================
// Mock Objects
// =============================================================================

/**
 * Minimal mock account that matches AnyAccount interface expectations
 */
function createMockAccount(overrides: Partial<{ id: string; name: string; amount: number }> = {}) {
    return {
        id: overrides.id ?? 'acc-1',
        name: overrides.name ?? 'Test Account',
        amount: overrides.amount ?? 10000,
        constructor: { name: 'MockAccount' },
    };
}

/**
 * Minimal mock income that matches AnyIncome interface expectations
 */
function createMockIncome(overrides: Partial<{ id: string; name: string; amount: number }> = {}) {
    const amount = overrides.amount ?? 50000;
    return {
        id: overrides.id ?? 'inc-1',
        name: overrides.name ?? 'Test Income',
        startDate: null,
        end_date: null,
        startMilestoneId: undefined,
        endMilestoneId: undefined,
        getAnnualAmount: () => amount,
        constructor: { name: 'MockIncome' },
    };
}

/**
 * Real WorkIncome instance (so `income instanceof WorkIncome` in the hash's
 * serializer takes the WorkIncome branch — a plain mock never would). Built
 * with defaults, then any WorkIncome field is overridden so the sensitivity
 * tests can flip exactly one (insurance, matchAccountId, the ESPP config) and
 * assert it changes the hash.
 */
function createMockWorkIncome(overrides: Partial<WorkIncome> = {}): WorkIncome {
    // Positional args through matchAccountId (no default); everything after uses
    // constructor defaults, then `Object.assign` applies the overrides.
    const inc = new WorkIncome('inc-1', 'Test Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'match-acc');
    return Object.assign(inc, overrides);
}

/**
 * Minimal mock expense that matches AnyExpense interface expectations.
 *
 * Goal/cadence fields (startDate, endDate, dueMonth, goalType, intervalYears,
 * goalAccountId) are overridable so the sensitivity tests can flip a single one
 * and assert it changes the hash — these steer the sim but aren't reflected by
 * getAnnualAmount() (a goal reports $0 there).
 */
function createMockExpense(
    overrides: Partial<{
        id: string;
        name: string;
        amount: number;
        startDate: Date | undefined;
        endDate: Date | undefined;
        dueMonth: number | undefined;
        goalType: 'recurring' | 'targetDate' | undefined;
        intervalYears: number | undefined;
        goalAccountId: string | undefined;
    }> = {}
) {
    const amount = overrides.amount ?? 2000;
    return {
        id: overrides.id ?? 'exp-1',
        name: overrides.name ?? 'Test Expense',
        startMilestoneId: undefined,
        endMilestoneId: undefined,
        startDate: overrides.startDate,
        endDate: overrides.endDate,
        dueMonth: overrides.dueMonth,
        goalType: overrides.goalType,
        intervalYears: overrides.intervalYears,
        goalAccountId: overrides.goalAccountId,
        getAnnualAmount: () => amount,
        constructor: { name: 'MockExpense' },
    };
}

/**
 * Minimal mock assumptions state
 */
function createMockAssumptions(overrides: Partial<AssumptionsState> = {}): AssumptionsState {
    return {
        demographics: { birthYear: 1990, retirementAge: 65, lifeExpectancy: 90 },
        macro: {
            inflationRate: 3,
            healthcareInflation: 5,
            socialSecurityCOLA: 2,
        },
        income: { salaryGrowth: 3 },
        expenses: { expenseGrowth: 3 },
        investments: {
            returnRates: { ror: 7 },
            withdrawalStrategy: 'FixedReal',
            withdrawalRate: 4,
            autoRothConversions: false,
        },
        priorities: {},
        withdrawalStrategy: {},
        milestones: [],
        ...overrides,
    } as AssumptionsState;
}

/**
 * Minimal mock tax state
 */
function createMockTaxState(overrides: Partial<TaxState> = {}): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'CA',
        deductionMethod: 'Standard',
        ...overrides,
    } as TaxState;
}

/**
 * getSimulationInputHash only reads a handful of fields off each account/
 * income/expense (id, amount, name, constructor.name, plus a few type-specific
 * ones gated by `instanceof` — see simulationHash.ts). The mock factories
 * above are deliberately NOT real AnyAccount/AnyIncome/AnyExpense instances:
 * they duck-type just the fields the serializer reads and override
 * `constructor.name` directly to control the serialized className without
 * standing up every concrete subclass's full constructor. Route calls through
 * this single `unknown`-typed wrapper rather than casting `as any` at each of
 * the many call sites below.
 */
function hashInputs(
    accounts: unknown[],
    incomes: unknown[],
    expenses: unknown[],
    assumptions: AssumptionsState,
    taxState: TaxState
): string {
    return getSimulationInputHash(
        accounts as AnyAccount[],
        incomes as AnyIncome[],
        expenses as AnyExpense[],
        assumptions,
        taxState
    );
}

// =============================================================================
// hashString tests
// =============================================================================

describe('hashString', () => {
    describe('determinism', () => {
        it('should return same hash for same string', () => {
            const input = 'test string';
            const hash1 = hashString(input);
            const hash2 = hashString(input);
            expect(hash1).toBe(hash2);
        });

        it('should be consistent across multiple calls', () => {
            const input = 'consistent test';
            const hashes = Array.from({ length: 10 }, () => hashString(input));
            expect(new Set(hashes).size).toBe(1);
        });
    });

    describe('uniqueness', () => {
        it('should return different hashes for different strings', () => {
            const hash1 = hashString('string one');
            const hash2 = hashString('string two');
            expect(hash1).not.toBe(hash2);
        });

        it('should return different hashes for similar strings', () => {
            const hash1 = hashString('test');
            const hash2 = hashString('Test');
            const hash3 = hashString('test ');
            expect(hash1).not.toBe(hash2);
            expect(hash1).not.toBe(hash3);
            expect(hash2).not.toBe(hash3);
        });

        it('should return different hashes for strings with different lengths', () => {
            const hash1 = hashString('a');
            const hash2 = hashString('aa');
            const hash3 = hashString('aaa');
            expect(hash1).not.toBe(hash2);
            expect(hash2).not.toBe(hash3);
        });
    });

    describe('edge cases', () => {
        it('should return valid hash for empty string', () => {
            const hash = hashString('');
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);
        });

        it('should return valid hash for long string', () => {
            const longString = 'x'.repeat(10000);
            const hash = hashString(longString);
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);
        });

        it('should return valid hash for string with special characters', () => {
            const hash = hashString('!@#$%^&*()_+-=[]{}|;:,.<>?');
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);
        });

        it('should return valid hash for string with unicode', () => {
            const hash = hashString('日本語テスト 🎉');
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);
        });

        it('should return valid hash for string with newlines', () => {
            const hash = hashString('line1\nline2\nline3');
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);
        });
    });

    describe('format', () => {
        it('should return string in base-36 format', () => {
            const hash = hashString('test');
            // Base-36 contains only 0-9 and a-z (lowercase)
            // Also may have leading minus for negative numbers
            expect(hash).toMatch(/^-?[0-9a-z]+$/);
        });

        it('should return string type', () => {
            expect(typeof hashString('test')).toBe('string');
            expect(typeof hashString('')).toBe('string');
            expect(typeof hashString('a'.repeat(1000))).toBe('string');
        });
    });
});

// =============================================================================
// getSimulationInputHash tests
// =============================================================================

describe('getSimulationInputHash', () => {
    describe('determinism', () => {
        it('should return same hash for same inputs', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, expenses, assumptions, taxState);
            const hash2 = hashInputs(accounts, incomes, expenses, assumptions, taxState);

            expect(hash1).toBe(hash2);
        });

        it('should be consistent across multiple calls', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hashes = Array.from({ length: 5 }, () =>
                hashInputs(accounts, incomes, expenses, assumptions, taxState)
            );

            expect(new Set(hashes).size).toBe(1);
        });
    });

    describe('sensitivity to account changes', () => {
        it('should return different hash when account amount changes', () => {
            const accounts1 = [createMockAccount({ amount: 10000 })];
            const accounts2 = [createMockAccount({ amount: 20000 })];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts1, incomes, expenses, assumptions, taxState);
            const hash2 = hashInputs(accounts2, incomes, expenses, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when account name changes', () => {
            const accounts1 = [createMockAccount({ name: 'Account A' })];
            const accounts2 = [createMockAccount({ name: 'Account B' })];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts1, incomes, expenses, assumptions, taxState);
            const hash2 = hashInputs(accounts2, incomes, expenses, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when account is added', () => {
            const accounts1 = [createMockAccount()];
            const accounts2 = [createMockAccount(), createMockAccount({ id: 'acc-2', name: 'Second' })];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts1, incomes, expenses, assumptions, taxState);
            const hash2 = hashInputs(accounts2, incomes, expenses, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });
    });

    describe('sensitivity to income changes', () => {
        it('should return different hash when income amount changes', () => {
            const accounts = [createMockAccount()];
            const incomes1 = [createMockIncome({ amount: 50000 })];
            const incomes2 = [createMockIncome({ amount: 75000 })];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes1, expenses, assumptions, taxState);
            const hash2 = hashInputs(accounts, incomes2, expenses, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when income name changes', () => {
            const accounts = [createMockAccount()];
            const incomes1 = [createMockIncome({ name: 'Job A' })];
            const incomes2 = [createMockIncome({ name: 'Job B' })];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes1, expenses, assumptions, taxState);
            const hash2 = hashInputs(accounts, incomes2, expenses, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });
    });

    describe('sensitivity to expense changes', () => {
        it('should return different hash when expense amount changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses1 = [createMockExpense({ amount: 2000 })];
            const expenses2 = [createMockExpense({ amount: 3000 })];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, expenses1, assumptions, taxState);
            const hash2 = hashInputs(accounts, incomes, expenses2, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when expense name changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses1 = [createMockExpense({ name: 'Rent' })];
            const expenses2 = [createMockExpense({ name: 'Mortgage' })];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, expenses1, assumptions, taxState);
            const hash2 = hashInputs(accounts, incomes, expenses2, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        // Regression for #101: goalType / endDate / dueMonth / startDate (and the
        // related goal fields) feed the sim but weren't hashed, so editing them
        // left the cached result stale with no auto-refresh.
        it('should return different hash when expense startDate changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            // Two expenses differing ONLY in startDate.
            const expenses1 = [createMockExpense({ startDate: new Date(2030, 0, 1) })];
            const expenses2 = [createMockExpense({ startDate: new Date(2035, 0, 1) })];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, expenses1, assumptions, taxState);
            const hash2 = hashInputs(accounts, incomes, expenses2, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when expense endDate changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            // Two expenses differing ONLY in endDate (a goal's target date).
            const expenses1 = [createMockExpense({ endDate: new Date(2040, 0, 1) })];
            const expenses2 = [createMockExpense({ endDate: new Date(2045, 0, 1) })];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, expenses1, assumptions, taxState);
            const hash2 = hashInputs(accounts, incomes, expenses2, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when expense dueMonth changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            // Two expenses differing ONLY in dueMonth.
            const expenses1 = [createMockExpense({ dueMonth: 1 })];
            const expenses2 = [createMockExpense({ dueMonth: 7 })];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, expenses1, assumptions, taxState);
            const hash2 = hashInputs(accounts, incomes, expenses2, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when expense goalType changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            // Two expenses differing ONLY in goalType.
            const expenses1 = [createMockExpense({ goalType: 'targetDate' })];
            const expenses2 = [createMockExpense({ goalType: 'recurring' })];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, expenses1, assumptions, taxState);
            const hash2 = hashInputs(accounts, incomes, expenses2, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when goal intervalYears changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            // Two recurring goals differing ONLY in intervalYears (changes the
            // sinking-fund set-aside and the purchase cadence).
            const expenses1 = [createMockExpense({ goalType: 'recurring', intervalYears: 5 })];
            const expenses2 = [createMockExpense({ goalType: 'recurring', intervalYears: 10 })];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, expenses1, assumptions, taxState);
            const hash2 = hashInputs(accounts, incomes, expenses2, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when goalAccountId changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            // Two goals routing their sinking-fund to different accounts.
            const expenses1 = [createMockExpense({ goalType: 'targetDate', goalAccountId: 'acc-A' })];
            const expenses2 = [createMockExpense({ goalType: 'targetDate', goalAccountId: 'acc-B' })];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, expenses1, assumptions, taxState);
            const hash2 = hashInputs(accounts, incomes, expenses2, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return the SAME hash for identical expenses (no false invalidation)', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            // Same goal fields on both sides ⇒ stable hash (cache stays valid).
            const make = () => [createMockExpense({
                startDate: new Date(2030, 0, 1),
                endDate: new Date(2040, 0, 1),
                dueMonth: 7,
                goalType: 'targetDate' as const,
                goalAccountId: 'acc-A',
            })];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, make(), assumptions, taxState);
            const hash2 = hashInputs(accounts, incomes, make(), assumptions, taxState);

            expect(hash1).toBe(hash2);
        });
    });

    describe('sensitivity to assumptions changes', () => {
        it('should return different hash when inflation rate changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions1 = createMockAssumptions();
            const assumptions2 = createMockAssumptions({
                macro: { ...assumptions1.macro, inflationRate: 5 },
            } as Partial<AssumptionsState>);
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, expenses, assumptions1, taxState);
            const hash2 = hashInputs(accounts, incomes, expenses, assumptions2, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when retirement age changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions1 = createMockAssumptions();
            const assumptions2 = createMockAssumptions({
                demographics: { ...assumptions1.demographics, retirementAge: 60 },
            } as Partial<AssumptionsState>);
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, expenses, assumptions1, taxState);
            const hash2 = hashInputs(accounts, incomes, expenses, assumptions2, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when withdrawal strategy changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions1 = createMockAssumptions();
            const assumptions2 = createMockAssumptions({
                investments: { ...assumptions1.investments, withdrawalStrategy: 'Guyton Klinger' },
            } as Partial<AssumptionsState>);
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, incomes, expenses, assumptions1, taxState);
            const hash2 = hashInputs(accounts, incomes, expenses, assumptions2, taxState);

            expect(hash1).not.toBe(hash2);
        });
    });

    describe('sensitivity to taxState changes', () => {
        it('should return different hash when filing status changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState1 = createMockTaxState({ filingStatus: 'Single' });
            const taxState2 = createMockTaxState({ filingStatus: 'Married Filing Jointly' });

            const hash1 = hashInputs(accounts, incomes, expenses, assumptions, taxState1);
            const hash2 = hashInputs(accounts, incomes, expenses, assumptions, taxState2);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when state residency changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState1 = createMockTaxState({ stateResidency: 'CA' });
            const taxState2 = createMockTaxState({ stateResidency: 'TX' });

            const hash1 = hashInputs(accounts, incomes, expenses, assumptions, taxState1);
            const hash2 = hashInputs(accounts, incomes, expenses, assumptions, taxState2);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when deduction method changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState1 = createMockTaxState({ deductionMethod: 'Standard' });
            const taxState2 = createMockTaxState({ deductionMethod: 'Itemized' });

            const hash1 = hashInputs(accounts, incomes, expenses, assumptions, taxState1);
            const hash2 = hashInputs(accounts, incomes, expenses, assumptions, taxState2);

            expect(hash1).not.toBe(hash2);
        });

        // Regression for #180: these six TaxState fields all steer the projection
        // (current-year overrides + calibration carry-forward; scheduled
        // state/filing tax events; the survivor scenario) but were omitted from
        // the hash, so editing them left the cached result stale with no banner.
        const baseArgs = () => ({
            accounts: [createMockAccount()],
            incomes: [createMockIncome()],
            expenses: [createMockExpense()],
            assumptions: createMockAssumptions(),
        });

        it('should return different hash when fedOverride changes', () => {
            const { accounts, incomes, expenses, assumptions } = baseArgs();
            const t1 = createMockTaxState({ fedOverride: null });
            const t2 = createMockTaxState({ fedOverride: 5000 });
            expect(hashInputs(accounts, incomes, expenses, assumptions, t1))
                .not.toBe(hashInputs(accounts, incomes, expenses, assumptions, t2));
        });

        it('should return different hash when ficaOverride changes', () => {
            const { accounts, incomes, expenses, assumptions } = baseArgs();
            const t1 = createMockTaxState({ ficaOverride: null });
            const t2 = createMockTaxState({ ficaOverride: 1200 });
            expect(hashInputs(accounts, incomes, expenses, assumptions, t1))
                .not.toBe(hashInputs(accounts, incomes, expenses, assumptions, t2));
        });

        it('should return different hash when stateOverride changes', () => {
            const { accounts, incomes, expenses, assumptions } = baseArgs();
            const t1 = createMockTaxState({ stateOverride: null });
            const t2 = createMockTaxState({ stateOverride: 800 });
            expect(hashInputs(accounts, incomes, expenses, assumptions, t1))
                .not.toBe(hashInputs(accounts, incomes, expenses, assumptions, t2));
        });

        it('should return different hash when calibrateFutureYears toggles', () => {
            const { accounts, incomes, expenses, assumptions } = baseArgs();
            const t1 = createMockTaxState({ fedOverride: 5000, calibrateFutureYears: false });
            const t2 = createMockTaxState({ fedOverride: 5000, calibrateFutureYears: true });
            expect(hashInputs(accounts, incomes, expenses, assumptions, t1))
                .not.toBe(hashInputs(accounts, incomes, expenses, assumptions, t2));
        });

        it('should return different hash when a scheduled tax event is added/edited', () => {
            const { accounts, incomes, expenses, assumptions } = baseArgs();
            const t1 = createMockTaxState({ taxEvents: [] });
            const t2 = createMockTaxState({
                taxEvents: [{ id: 'ev-1', kind: 'stateResidency', value: 'TX', year: 2034 }],
            });
            const t3 = createMockTaxState({
                taxEvents: [{ id: 'ev-1', kind: 'stateResidency', value: 'FL', year: 2034 }],
            });
            const h1 = hashInputs(accounts, incomes, expenses, assumptions, t1);
            const h2 = hashInputs(accounts, incomes, expenses, assumptions, t2);
            const h3 = hashInputs(accounts, incomes, expenses, assumptions, t3);
            expect(h1).not.toBe(h2); // adding an event
            expect(h2).not.toBe(h3); // editing the destination state
        });

        it('should return different hash when the survivor scenario is enabled/edited', () => {
            const { accounts, incomes, expenses, assumptions } = baseArgs();
            const t1 = createMockTaxState({ survivorScenario: { enabled: false, deathYear: 2040 } });
            const t2 = createMockTaxState({ survivorScenario: { enabled: true, deathYear: 2040 } });
            const t3 = createMockTaxState({ survivorScenario: { enabled: true, deathYear: 2040, expenseFactor: 0.8 } });
            const h1 = hashInputs(accounts, incomes, expenses, assumptions, t1);
            const h2 = hashInputs(accounts, incomes, expenses, assumptions, t2);
            const h3 = hashInputs(accounts, incomes, expenses, assumptions, t3);
            expect(h1).not.toBe(h2); // enabling
            expect(h2).not.toBe(h3); // changing the expense factor
        });

        it('should NOT throw and stays stable on default data (taxEvents/survivorScenario undefined)', () => {
            const { accounts, incomes, expenses, assumptions } = baseArgs();
            // No taxEvents / survivorScenario set — the default-data shape.
            const t = createMockTaxState();
            const h1 = hashInputs(accounts, incomes, expenses, assumptions, t);
            const h2 = hashInputs(accounts, incomes, expenses, assumptions, t);
            expect(h1).toBe(h2);
            expect(typeof h1).toBe('string');
        });
    });

    // Regression for #180: WorkIncome hash omitted insurance, matchAccountId, and
    // the ESPP config (discount / lookback / offering period / linked account /
    // expected growth) — all consumed by the sim but not by getAnnualAmount().
    describe('sensitivity to WorkIncome field changes', () => {
        const baseArgs = () => ({
            accounts: [createMockAccount()],
            expenses: [createMockExpense()],
            assumptions: createMockAssumptions(),
            taxState: createMockTaxState(),
        });

        it('should return different hash when insurance changes', () => {
            const { accounts, expenses, assumptions, taxState } = baseArgs();
            const i1 = [createMockWorkIncome({ insurance: 2000 })];
            const i2 = [createMockWorkIncome({ insurance: 4000 })];
            expect(hashInputs(accounts, i1, expenses, assumptions, taxState))
                .not.toBe(hashInputs(accounts, i2, expenses, assumptions, taxState));
        });

        it('should return different hash when matchAccountId is re-pointed', () => {
            const { accounts, expenses, assumptions, taxState } = baseArgs();
            const i1 = [createMockWorkIncome({ matchAccountId: 'acc-A' })];
            const i2 = [createMockWorkIncome({ matchAccountId: 'acc-B' })];
            expect(hashInputs(accounts, i1, expenses, assumptions, taxState))
                .not.toBe(hashInputs(accounts, i2, expenses, assumptions, taxState));
        });

        it('should return different hash when esppDiscountPercent changes (15% -> 5%)', () => {
            const { accounts, expenses, assumptions, taxState } = baseArgs();
            const i1 = [createMockWorkIncome({ esppContributionType: 'PERCENTAGE', esppContributionAmount: 10, esppDiscountPercent: 15 })];
            const i2 = [createMockWorkIncome({ esppContributionType: 'PERCENTAGE', esppContributionAmount: 10, esppDiscountPercent: 5 })];
            expect(hashInputs(accounts, i1, expenses, assumptions, taxState))
                .not.toBe(hashInputs(accounts, i2, expenses, assumptions, taxState));
        });

        it('should return different hash when esppHasLookback toggles', () => {
            const { accounts, expenses, assumptions, taxState } = baseArgs();
            const i1 = [createMockWorkIncome({ esppHasLookback: true })];
            const i2 = [createMockWorkIncome({ esppHasLookback: false })];
            expect(hashInputs(accounts, i1, expenses, assumptions, taxState))
                .not.toBe(hashInputs(accounts, i2, expenses, assumptions, taxState));
        });

        it('should return different hash when esppOfferingPeriodMonths changes', () => {
            const { accounts, expenses, assumptions, taxState } = baseArgs();
            const i1 = [createMockWorkIncome({ esppOfferingPeriodMonths: 6 })];
            const i2 = [createMockWorkIncome({ esppOfferingPeriodMonths: 12 })];
            expect(hashInputs(accounts, i1, expenses, assumptions, taxState))
                .not.toBe(hashInputs(accounts, i2, expenses, assumptions, taxState));
        });

        it('should return different hash when esppAccountId is re-pointed', () => {
            const { accounts, expenses, assumptions, taxState } = baseArgs();
            const i1 = [createMockWorkIncome({ esppAccountId: 'espp-A' })];
            const i2 = [createMockWorkIncome({ esppAccountId: 'espp-B' })];
            expect(hashInputs(accounts, i1, expenses, assumptions, taxState))
                .not.toBe(hashInputs(accounts, i2, expenses, assumptions, taxState));
        });

        it('should return different hash when esppExpectedStockGrowth changes', () => {
            const { accounts, expenses, assumptions, taxState } = baseArgs();
            const i1 = [createMockWorkIncome({ esppExpectedStockGrowth: 7 })];
            const i2 = [createMockWorkIncome({ esppExpectedStockGrowth: 10 })];
            expect(hashInputs(accounts, i1, expenses, assumptions, taxState))
                .not.toBe(hashInputs(accounts, i2, expenses, assumptions, taxState));
        });

        it('should return the SAME hash for two identical WorkIncomes (no false invalidation)', () => {
            const { accounts, expenses, assumptions, taxState } = baseArgs();
            const make = () => [createMockWorkIncome({ insurance: 3000, esppDiscountPercent: 15 })];
            expect(hashInputs(accounts, make(), expenses, assumptions, taxState))
                .toBe(hashInputs(accounts, make(), expenses, assumptions, taxState));
        });
    });

    // Regression for #180: expense hash omitted is_tax_deductible / tax_deductible
    // — flipping a mortgage/medical expense to Itemized/Yes changes every year's
    // federal taxes (taxService/deductions.ts) but never marked the sim stale.
    describe('sensitivity to expense deductibility changes', () => {
        const deductibleExpense = (overrides: Record<string, unknown> = {}) => ({
            ...createMockExpense(),
            is_tax_deductible: 'No',
            tax_deductible: 0,
            ...overrides,
        });

        it('should return different hash when is_tax_deductible flips to Itemized', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();
            const e1 = [deductibleExpense({ is_tax_deductible: 'No' })];
            const e2 = [deductibleExpense({ is_tax_deductible: 'Itemized', tax_deductible: 8000 })];
            expect(hashInputs(accounts, incomes, e1, assumptions, taxState))
                .not.toBe(hashInputs(accounts, incomes, e2, assumptions, taxState));
        });

        it('should return different hash when tax_deductible amount changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();
            const e1 = [deductibleExpense({ is_tax_deductible: 'Itemized', tax_deductible: 5000 })];
            const e2 = [deductibleExpense({ is_tax_deductible: 'Itemized', tax_deductible: 9000 })];
            expect(hashInputs(accounts, incomes, e1, assumptions, taxState))
                .not.toBe(hashInputs(accounts, incomes, e2, assumptions, taxState));
        });
    });

    describe('edge cases', () => {
        it('should return valid hash for empty arrays', () => {
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash = hashInputs([], [], [], assumptions, taxState);

            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);
        });

        it('should return same hash for empty arrays consistently', () => {
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs([], [], [], assumptions, taxState);
            const hash2 = hashInputs([], [], [], assumptions, taxState);

            expect(hash1).toBe(hash2);
        });

        it('should return different hash for empty vs non-empty arrays', () => {
            const accounts = [createMockAccount()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs([], [], [], assumptions, taxState);
            const hash2 = hashInputs(accounts, [], [], assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });
    });

    describe('array order sensitivity', () => {
        it('should return different hash when account order changes', () => {
            const account1 = createMockAccount({ id: 'acc-1', name: 'First' });
            const account2 = createMockAccount({ id: 'acc-2', name: 'Second' });
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs([account1, account2], incomes, expenses, assumptions, taxState);
            const hash2 = hashInputs([account2, account1], incomes, expenses, assumptions, taxState);

            // JSON.stringify preserves array order, so different order = different hash
            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when income order changes', () => {
            const accounts = [createMockAccount()];
            const income1 = createMockIncome({ id: 'inc-1', name: 'Job 1' });
            const income2 = createMockIncome({ id: 'inc-2', name: 'Job 2' });
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = hashInputs(accounts, [income1, income2], expenses, assumptions, taxState);
            const hash2 = hashInputs(accounts, [income2, income1], expenses, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });
    });
});
