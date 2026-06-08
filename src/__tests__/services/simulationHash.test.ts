/**
 * Tests for simulationHash utilities
 *
 * Tests the hash functions used for simulation change detection.
 */

import { describe, it, expect } from 'vitest';
import { hashString, getSimulationInputHash } from '../../services/simulationHash';
import { AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';

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
 * Minimal mock expense that matches AnyExpense interface expectations
 */
function createMockExpense(overrides: Partial<{ id: string; name: string; amount: number }> = {}) {
    const amount = overrides.amount ?? 2000;
    return {
        id: overrides.id ?? 'exp-1',
        name: overrides.name ?? 'Test Expense',
        startMilestoneId: undefined,
        endMilestoneId: undefined,
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

            const hash1 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions, taxState);
            const hash2 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions, taxState);

            expect(hash1).toBe(hash2);
        });

        it('should be consistent across multiple calls', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hashes = Array.from({ length: 5 }, () =>
                getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions, taxState)
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

            const hash1 = getSimulationInputHash(accounts1 as any, incomes as any, expenses as any, assumptions, taxState);
            const hash2 = getSimulationInputHash(accounts2 as any, incomes as any, expenses as any, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when account name changes', () => {
            const accounts1 = [createMockAccount({ name: 'Account A' })];
            const accounts2 = [createMockAccount({ name: 'Account B' })];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = getSimulationInputHash(accounts1 as any, incomes as any, expenses as any, assumptions, taxState);
            const hash2 = getSimulationInputHash(accounts2 as any, incomes as any, expenses as any, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when account is added', () => {
            const accounts1 = [createMockAccount()];
            const accounts2 = [createMockAccount(), createMockAccount({ id: 'acc-2', name: 'Second' })];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = getSimulationInputHash(accounts1 as any, incomes as any, expenses as any, assumptions, taxState);
            const hash2 = getSimulationInputHash(accounts2 as any, incomes as any, expenses as any, assumptions, taxState);

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

            const hash1 = getSimulationInputHash(accounts as any, incomes1 as any, expenses as any, assumptions, taxState);
            const hash2 = getSimulationInputHash(accounts as any, incomes2 as any, expenses as any, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when income name changes', () => {
            const accounts = [createMockAccount()];
            const incomes1 = [createMockIncome({ name: 'Job A' })];
            const incomes2 = [createMockIncome({ name: 'Job B' })];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = getSimulationInputHash(accounts as any, incomes1 as any, expenses as any, assumptions, taxState);
            const hash2 = getSimulationInputHash(accounts as any, incomes2 as any, expenses as any, assumptions, taxState);

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

            const hash1 = getSimulationInputHash(accounts as any, incomes as any, expenses1 as any, assumptions, taxState);
            const hash2 = getSimulationInputHash(accounts as any, incomes as any, expenses2 as any, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when expense name changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses1 = [createMockExpense({ name: 'Rent' })];
            const expenses2 = [createMockExpense({ name: 'Mortgage' })];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = getSimulationInputHash(accounts as any, incomes as any, expenses1 as any, assumptions, taxState);
            const hash2 = getSimulationInputHash(accounts as any, incomes as any, expenses2 as any, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
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

            const hash1 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions1, taxState);
            const hash2 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions2, taxState);

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

            const hash1 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions1, taxState);
            const hash2 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions2, taxState);

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

            const hash1 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions1, taxState);
            const hash2 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions2, taxState);

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

            const hash1 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions, taxState1);
            const hash2 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions, taxState2);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when state residency changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState1 = createMockTaxState({ stateResidency: 'CA' });
            const taxState2 = createMockTaxState({ stateResidency: 'TX' });

            const hash1 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions, taxState1);
            const hash2 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions, taxState2);

            expect(hash1).not.toBe(hash2);
        });

        it('should return different hash when deduction method changes', () => {
            const accounts = [createMockAccount()];
            const incomes = [createMockIncome()];
            const expenses = [createMockExpense()];
            const assumptions = createMockAssumptions();
            const taxState1 = createMockTaxState({ deductionMethod: 'Standard' });
            const taxState2 = createMockTaxState({ deductionMethod: 'Itemized' });

            const hash1 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions, taxState1);
            const hash2 = getSimulationInputHash(accounts as any, incomes as any, expenses as any, assumptions, taxState2);

            expect(hash1).not.toBe(hash2);
        });
    });

    describe('edge cases', () => {
        it('should return valid hash for empty arrays', () => {
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash = getSimulationInputHash([] as any, [] as any, [] as any, assumptions, taxState);

            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);
        });

        it('should return same hash for empty arrays consistently', () => {
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = getSimulationInputHash([] as any, [] as any, [] as any, assumptions, taxState);
            const hash2 = getSimulationInputHash([] as any, [] as any, [] as any, assumptions, taxState);

            expect(hash1).toBe(hash2);
        });

        it('should return different hash for empty vs non-empty arrays', () => {
            const accounts = [createMockAccount()];
            const assumptions = createMockAssumptions();
            const taxState = createMockTaxState();

            const hash1 = getSimulationInputHash([] as any, [] as any, [] as any, assumptions, taxState);
            const hash2 = getSimulationInputHash(accounts as any, [] as any, [] as any, assumptions, taxState);

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

            const hash1 = getSimulationInputHash([account1, account2] as any, incomes as any, expenses as any, assumptions, taxState);
            const hash2 = getSimulationInputHash([account2, account1] as any, incomes as any, expenses as any, assumptions, taxState);

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

            const hash1 = getSimulationInputHash(accounts as any, [income1, income2] as any, expenses as any, assumptions, taxState);
            const hash2 = getSimulationInputHash(accounts as any, [income2, income1] as any, expenses as any, assumptions, taxState);

            expect(hash1).not.toBe(hash2);
        });
    });
});
