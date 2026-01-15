import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    generateScenarioId,
    loadScenariosFromStorage,
    saveScenarioToStorage,
    deleteScenarioFromStorage,
    getScenarioById,
    captureCurrentState,
    createScenario,
    calculateMilestones,
    compareScenarios,
    createLoadedScenarioFromSimulation
} from '../../services/ScenarioService';
import {
    SavedScenario,
    SCENARIOS_STORAGE_KEY
} from '../../services/ScenarioTypes';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { defaultAssumptions, AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';
import { InvestedAccount, SavedAccount, PropertyAccount } from '../../components/Objects/Accounts/models';

// --- Mock localStorage ---
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
            store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
            delete store[key];
        }),
        clear: vi.fn(() => {
            store = {};
        }),
        get length() {
            return Object.keys(store).length;
        },
        key: vi.fn((i: number) => Object.keys(store)[i] || null)
    };
})();

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock
});

// --- Test Helpers ---

const createMockScenario = (id: string, name: string): SavedScenario => ({
    metadata: {
        id,
        name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    inputs: {
        accounts: [],
        incomes: [],
        expenses: [],
        taxSettings: {
            filingStatus: 'Single',
            stateResidency: 'California',
            deductionMethod: 'Standard',
            fedOverride: null,
            ficaOverride: null,
            stateOverride: null,
            year: 2024
        },
        assumptions: defaultAssumptions
    },
    version: '1.0.0'
});

const createMockSimulation = (years: number, startYear: number = 2024): SimulationYear[] => {
    const simulation: SimulationYear[] = [];

    for (let i = 0; i < years; i++) {
        const year = startYear + i;
        const baseAmount = 100000 + (i * 50000); // Grows each year

        simulation.push({
            year,
            incomes: [],
            expenses: [],
            accounts: [
                new InvestedAccount(
                    `account-${i}`,
                    'Investment Account',
                    baseAmount,
                    0,      // employerBalance
                    0,      // tenureYears
                    0.1,    // expenseRatio
                    'Traditional 401k',  // taxType
                    true    // isContributionEligible
                ),
                new SavedAccount(
                    `savings-${i}`,
                    'Savings',
                    10000,
                    0
                )
            ],
            cashflow: {
                totalIncome: 100000,
                totalExpense: 60000,
                discretionary: 40000,
                investedUser: 20000,
                investedMatch: 5000,
                totalInvested: 25000,
                bucketAllocations: 0,
                bucketDetail: {},
                withdrawals: 0,
                withdrawalDetail: {}
            },
            taxDetails: {
                fed: 15000,
                state: 5000,
                fica: 7650,
                preTax: 20000,
                insurance: 2000,
                postTax: 0,
                capitalGains: 0
            },
            logs: []
        });
    }

    return simulation;
};

const createTestAssumptions = (): AssumptionsState => ({
    ...defaultAssumptions,
    demographics: {
        ...defaultAssumptions.demographics,
        startYear: 2024,
        startAge: 35,
        retirementAge: 65,
        lifeExpectancy: 90
    },
    investments: {
        ...defaultAssumptions.investments,
        withdrawalRate: 4
    }
});

// =============================================================================
// ID Generation Tests
// =============================================================================

describe('generateScenarioId', () => {
    it('should generate unique IDs', () => {
        const id1 = generateScenarioId();
        const id2 = generateScenarioId();

        expect(id1).not.toEqual(id2);
    });

    it('should start with "scenario_"', () => {
        const id = generateScenarioId();
        expect(id.startsWith('scenario_')).toBe(true);
    });
});

// =============================================================================
// localStorage CRUD Tests
// =============================================================================

describe('localStorage operations', () => {
    beforeEach(() => {
        localStorageMock.clear();
        vi.clearAllMocks();
    });

    describe('loadScenariosFromStorage', () => {
        it('should return empty array when no scenarios exist', () => {
            const scenarios = loadScenariosFromStorage();
            expect(scenarios).toEqual([]);
        });

        it('should load scenarios from storage', () => {
            const mockScenarios = [createMockScenario('1', 'Test 1')];
            localStorageMock.setItem(SCENARIOS_STORAGE_KEY, JSON.stringify(mockScenarios));

            const scenarios = loadScenariosFromStorage();
            expect(scenarios).toHaveLength(1);
            expect(scenarios[0].metadata.name).toBe('Test 1');
        });

        it('should handle invalid JSON gracefully', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            localStorageMock.setItem(SCENARIOS_STORAGE_KEY, 'invalid json');

            const scenarios = loadScenariosFromStorage();
            expect(scenarios).toEqual([]);
            consoleSpy.mockRestore();
        });
    });

    describe('saveScenarioToStorage', () => {
        it('should save a new scenario', () => {
            const scenario = createMockScenario('test-1', 'Test Scenario');

            saveScenarioToStorage(scenario);

            expect(localStorageMock.setItem).toHaveBeenCalled();
            const saved = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
            expect(saved).toHaveLength(1);
            expect(saved[0].metadata.name).toBe('Test Scenario');
        });

        it('should update existing scenario', () => {
            const scenario = createMockScenario('test-1', 'Original Name');
            saveScenarioToStorage(scenario);

            const updated = { ...scenario, metadata: { ...scenario.metadata, name: 'Updated Name' } };
            saveScenarioToStorage(updated);

            const scenarios = loadScenariosFromStorage();
            expect(scenarios).toHaveLength(1);
            expect(scenarios[0].metadata.name).toBe('Updated Name');
        });
    });

    describe('deleteScenarioFromStorage', () => {
        it('should delete a scenario', () => {
            const scenario1 = createMockScenario('test-1', 'Test 1');
            const scenario2 = createMockScenario('test-2', 'Test 2');
            saveScenarioToStorage(scenario1);
            saveScenarioToStorage(scenario2);

            deleteScenarioFromStorage('test-1');

            const scenarios = loadScenariosFromStorage();
            expect(scenarios).toHaveLength(1);
            expect(scenarios[0].metadata.id).toBe('test-2');
        });

        it('should handle deleting non-existent scenario', () => {
            const scenario = createMockScenario('test-1', 'Test');
            saveScenarioToStorage(scenario);

            // Should not throw
            deleteScenarioFromStorage('non-existent');

            const scenarios = loadScenariosFromStorage();
            expect(scenarios).toHaveLength(1);
        });
    });

    describe('getScenarioById', () => {
        it('should return scenario by ID', () => {
            const scenario = createMockScenario('test-1', 'Test');
            saveScenarioToStorage(scenario);

            const found = getScenarioById('test-1');
            expect(found).not.toBeNull();
            expect(found?.metadata.name).toBe('Test');
        });

        it('should return null for non-existent ID', () => {
            const found = getScenarioById('non-existent');
            expect(found).toBeNull();
        });
    });
});

// =============================================================================
// State Capture Tests
// =============================================================================

describe('captureCurrentState', () => {
    it('should capture state with className property', () => {
        const accounts = [new InvestedAccount('acc-1', 'Test', 1000, 0, 0, 0.1, 'Traditional 401k', true)];
        const incomes: any[] = [];
        const expenses: any[] = [];
        const taxSettings = { filingStatus: 'Single' as const, stateResidency: 'California', deductionMethod: 'Standard' as const, fedOverride: null, ficaOverride: null, stateOverride: null, year: 2024 };
        const assumptions = defaultAssumptions;

        const captured = captureCurrentState(accounts, {}, incomes, expenses, taxSettings, assumptions);

        expect(captured.accounts[0].className).toBe('InvestedAccount');
    });
});

describe('createScenario', () => {
    it('should create scenario with metadata', () => {
        const inputs = captureCurrentState([], {}, [], [], {
            filingStatus: 'Single',
            stateResidency: 'California',
            deductionMethod: 'Standard',
            fedOverride: null,
            ficaOverride: null,
            stateOverride: null,
            year: 2024
        }, defaultAssumptions);

        const scenario = createScenario('My Scenario', 'Description', inputs, ['tag1']);

        expect(scenario.metadata.name).toBe('My Scenario');
        expect(scenario.metadata.description).toBe('Description');
        expect(scenario.metadata.tags).toContain('tag1');
        expect(scenario.metadata.id).toContain('scenario_');
    });
});

// =============================================================================
// Milestone Calculation Tests
// =============================================================================

describe('calculateMilestones', () => {
    it('should return empty milestones for empty simulation', () => {
        const milestones = calculateMilestones([], defaultAssumptions);

        expect(milestones.fiYear).toBeNull();
        expect(milestones.legacyValue).toBe(0);
        expect(milestones.yearsOfData).toBe(0);
    });

    it('should calculate legacy value from final year', () => {
        const simulation = createMockSimulation(10);
        const assumptions = createTestAssumptions();

        const milestones = calculateMilestones(simulation, assumptions);

        // Net worth of last year (investments + savings)
        const lastYear = simulation[simulation.length - 1];
        const expectedNetWorth = lastYear.accounts.reduce((sum, acc) => sum + acc.amount, 0);
        expect(milestones.legacyValue).toBe(expectedNetWorth);
    });

    it('should calculate peak net worth', () => {
        const simulation = createMockSimulation(10);
        const assumptions = createTestAssumptions();

        const milestones = calculateMilestones(simulation, assumptions);

        // Peak should be the last year since it grows each year
        expect(milestones.peakYear).toBe(2033);
        expect(milestones.peakNetWorth).toBeGreaterThan(0);
    });

    it('should calculate retirement year from assumptions', () => {
        const simulation = createMockSimulation(10);
        const assumptions = createTestAssumptions();

        const milestones = calculateMilestones(simulation, assumptions);

        // Retirement year = startYear + (retirementAge - startAge) = 2024 + (65 - 35) = 2054
        expect(milestones.retirementYear).toBe(2054);
        expect(milestones.retirementAge).toBe(65);
    });
});

// =============================================================================
// Comparison Tests
// =============================================================================

describe('compareScenarios', () => {
    it('should compare two scenarios', () => {
        const baselineSimulation = createMockSimulation(5);
        const comparisonSimulation = createMockSimulation(5);
        const assumptions = createTestAssumptions();

        const baseline = createLoadedScenarioFromSimulation('Baseline', baselineSimulation, assumptions);
        const comparison = createLoadedScenarioFromSimulation('Comparison', comparisonSimulation, assumptions);

        const result = compareScenarios(baseline, comparison);

        expect(result.baseline.metadata.name).toBe('Baseline');
        expect(result.comparison.metadata.name).toBe('Comparison');
        expect(result.differences.netWorthByYear).toHaveLength(5);
    });

    it('should calculate delta for same scenarios as zero', () => {
        const simulation = createMockSimulation(5);
        const assumptions = createTestAssumptions();

        const baseline = createLoadedScenarioFromSimulation('Baseline', simulation, assumptions);
        const comparison = createLoadedScenarioFromSimulation('Comparison', simulation, assumptions);

        const result = compareScenarios(baseline, comparison);

        expect(result.differences.legacyValueDelta).toBe(0);
        expect(result.differences.peakNetWorthDelta).toBe(0);
        result.differences.netWorthByYear.forEach(y => {
            expect(y.delta).toBe(0);
        });
    });

    it('should show positive delta when comparison has more wealth', () => {
        const baselineSimulation = createMockSimulation(5);
        const assumptions = createTestAssumptions();

        // Create comparison with higher amounts
        const comparisonSimulation = baselineSimulation.map(year => ({
            ...year,
            accounts: year.accounts.map(acc => {
                if (acc instanceof InvestedAccount) {
                    return new InvestedAccount(
                        acc.id,
                        acc.name,
                        acc.amount + 50000, // Add 50k
                        0,      // employerBalance
                        0,      // tenureYears
                        0.1,    // expenseRatio
                        acc.taxType,
                        acc.isContributionEligible
                    );
                }
                return acc;
            })
        }));

        const baseline = createLoadedScenarioFromSimulation('Baseline', baselineSimulation, assumptions);
        const comparison = createLoadedScenarioFromSimulation('Comparison', comparisonSimulation, assumptions);

        const result = compareScenarios(baseline, comparison);

        expect(result.differences.legacyValueDelta).toBeGreaterThan(0);
        expect(result.differences.legacyValueDeltaPercent).toBeGreaterThan(0);
    });
});

describe('createLoadedScenarioFromSimulation', () => {
    it('should create loaded scenario with milestones', () => {
        const simulation = createMockSimulation(10);
        const assumptions = createTestAssumptions();

        const loaded = createLoadedScenarioFromSimulation('Test Plan', simulation, assumptions);

        expect(loaded.metadata.name).toBe('Test Plan');
        expect(loaded.metadata.id).toBe('current');
        expect(loaded.simulation).toHaveLength(10);
        expect(loaded.milestones.yearsOfData).toBe(10);
    });
});

// =============================================================================
// Net Worth Calculation Tests (PropertyAccount mortgage handling)
// =============================================================================

describe('net worth calculation with PropertyAccount', () => {
    it('should subtract PropertyAccount.loanAmount from net worth', () => {
        const assumptions = createTestAssumptions();

        // Create simulation with a property that has a mortgage
        const propertyValue = 500000;
        const mortgageBalance = 400000;

        const simulationWithProperty: SimulationYear[] = [{
            year: 2024,
            incomes: [],
            expenses: [],
            accounts: [
                new InvestedAccount('inv-1', '401k', 100000, 0, 0, 0.1, 'Traditional 401k', true),
                new PropertyAccount(
                    'property-1',
                    'Home',
                    propertyValue,  // Property value (asset)
                    'Financed',
                    mortgageBalance,  // Current loan balance (liability)
                    mortgageBalance,  // Starting loan balance
                    ''
                )
            ],
            cashflow: { totalIncome: 0, totalExpense: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
            taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0 },
            logs: []
        }];

        const loaded = createLoadedScenarioFromSimulation('With Property', simulationWithProperty, assumptions);

        // Net worth should be: 401k (100k) + Property Value (500k) - Mortgage (400k) = 200k
        const expectedNetWorth = 100000 + propertyValue - mortgageBalance;
        expect(loaded.milestones.legacyValue).toBe(expectedNetWorth);
    });

    it('should show correct delta when comparing scenarios with/without property', () => {
        const assumptions = createTestAssumptions();

        // Scenario A: No property, just investments
        const scenarioA: SimulationYear[] = [{
            year: 2024,
            incomes: [],
            expenses: [],
            accounts: [
                new InvestedAccount('inv-1', '401k', 200000, 0, 0, 0.1, 'Traditional 401k', true)
            ],
            cashflow: { totalIncome: 0, totalExpense: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
            taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0 },
            logs: []
        }];

        // Scenario B: Property with mortgage + investments
        // Property value: 500k, Mortgage: 400k, 401k: 100k
        // Net worth = 100k + 500k - 400k = 200k (same as scenario A)
        const scenarioB: SimulationYear[] = [{
            year: 2024,
            incomes: [],
            expenses: [],
            accounts: [
                new InvestedAccount('inv-1', '401k', 100000, 0, 0, 0.1, 'Traditional 401k', true),
                new PropertyAccount('property-1', 'Home', 500000, 'Financed', 400000, 400000, '')
            ],
            cashflow: { totalIncome: 0, totalExpense: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
            taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0 },
            logs: []
        }];

        const baseline = createLoadedScenarioFromSimulation('No Property', scenarioA, assumptions);
        const comparison = createLoadedScenarioFromSimulation('With Property', scenarioB, assumptions);

        const result = compareScenarios(baseline, comparison);

        // Both scenarios should have the same net worth (200k)
        expect(result.differences.legacyValueDelta).toBe(0);
        expect(result.differences.netWorthByYear[0].baseline).toBe(200000);
        expect(result.differences.netWorthByYear[0].comparison).toBe(200000);
    });

    it('should show property scenario as wealthier when equity exceeds investment difference', () => {
        const assumptions = createTestAssumptions();

        // Scenario A: Just investments (150k)
        const scenarioA: SimulationYear[] = [{
            year: 2024,
            incomes: [],
            expenses: [],
            accounts: [
                new InvestedAccount('inv-1', '401k', 150000, 0, 0, 0.1, 'Traditional 401k', true)
            ],
            cashflow: { totalIncome: 0, totalExpense: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
            taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0 },
            logs: []
        }];

        // Scenario B: Property with mortgage + less investments
        // Property value: 500k, Mortgage: 300k (200k equity), 401k: 50k
        // Net worth = 50k + 500k - 300k = 250k (more than scenario A's 150k)
        const scenarioB: SimulationYear[] = [{
            year: 2024,
            incomes: [],
            expenses: [],
            accounts: [
                new InvestedAccount('inv-1', '401k', 50000, 0, 0, 0.1, 'Traditional 401k', true),
                new PropertyAccount('property-1', 'Home', 500000, 'Financed', 300000, 400000, '')
            ],
            cashflow: { totalIncome: 0, totalExpense: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
            taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0 },
            logs: []
        }];

        const baseline = createLoadedScenarioFromSimulation('No Property', scenarioA, assumptions);
        const comparison = createLoadedScenarioFromSimulation('With Property', scenarioB, assumptions);

        const result = compareScenarios(baseline, comparison);

        // Property scenario should show +100k delta (250k - 150k)
        expect(result.differences.legacyValueDelta).toBe(100000);
        expect(result.differences.netWorthByYear[0].baseline).toBe(150000);
        expect(result.differences.netWorthByYear[0].comparison).toBe(250000);
    });
});
