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
    createLoadedScenarioFromSimulation,
    validateAndTransformScenarioImport
} from '../../services/ScenarioService';
import {
    SavedScenario,
    SCENARIOS_STORAGE_KEY,
    SCENARIO_VERSION
} from '../../services/ScenarioTypes';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { defaultAssumptions, AssumptionsState, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { InvestedAccount, SavedAccount, PropertyAccount } from '../../components/Objects/Accounts/models';
import { FoodExpense } from '../../components/Objects/Expense/models';

// The canonical findFinancialIndependenceYear (single-sourced from
// MilestoneCalculator) reads each year's real `expenses` array and grosses it up
// 15% for taxes — not `cashflow.totalExpense`. $60k of living expenses grossed
// up = $70,588 needed, matching the thresholds the FI tests below assert.
const fiLivingExpenses = () => [
    new FoodExpense('food', 'Living', 60000, 'Annually', new Date(2000, 0, 1)),
];

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
            livingExpenses: 0,
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
                capitalGains: 0,
                withdrawalOrdinaryTax: 0,
                niit: 0
            },
            logs: []
        });
    }

    return simulation;
};

const createTestAssumptions = (): AssumptionsState => ({
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(1989, 65, 90), // Age 35 in 2024
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

    describe('financial independence calculation', () => {
        it('should find FI year when investments × withdrawalRate > expenses', () => {
            // Setup: $2M investments × 4% = $80k > $60k expenses
            const assumptions = createTestAssumptions();

            const simulation: SimulationYear[] = [
                {
                    year: 2024,
                    incomes: [],
                    expenses: [],
                    accounts: [
                        new InvestedAccount('inv-1', '401k', 2000000, 0, 0, 0.1, 'Traditional 401k', true)
                    ],
                    cashflow: {
                        totalIncome: 100000,
                        totalExpense: 60000,
                        livingExpenses: 60000,
                        discretionary: 0,
                        investedUser: 0,
                        investedMatch: 0,
                        totalInvested: 0,
                        bucketAllocations: 0,
                        bucketDetail: {},
                        withdrawals: 0,
                        withdrawalDetail: {}
                    },
                    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
                    logs: []
                },
                {
                    year: 2025,
                    incomes: [],
                    expenses: [],
                    accounts: [
                        new InvestedAccount('inv-1', '401k', 2100000, 0, 0, 0.1, 'Traditional 401k', true)
                    ],
                    cashflow: {
                        totalIncome: 100000,
                        totalExpense: 60000, // $2M × 4% = $80k > $60k = FI achieved!
                        livingExpenses: 60000,
                        discretionary: 0,
                        investedUser: 0,
                        investedMatch: 0,
                        totalInvested: 0,
                        bucketAllocations: 0,
                        bucketDetail: {},
                        withdrawals: 0,
                        withdrawalDetail: {}
                    },
                    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
                    logs: []
                }
            ];

            simulation.forEach(y => { y.expenses = fiLivingExpenses(); });
            const milestones = calculateMilestones(simulation, assumptions);

            // 2024 invested $2M × 4% = $80k ≥ $60k/0.85 = $70,588 → FI in 2025.
            expect(milestones.fiYear).toBe(2025);
            // Age = 2025 - 1989 (birthYear from createTestAssumptions) = 36
            expect(milestones.fiAge).toBe(36);
        });

        it('should return null FI when investments × withdrawalRate < expenses', () => {
            // Setup: $500k investments × 4% = $20k < $60k expenses
            const assumptions = createTestAssumptions();

            const simulation: SimulationYear[] = [
                {
                    year: 2024,
                    incomes: [],
                    expenses: [],
                    accounts: [
                        new InvestedAccount('inv-1', '401k', 500000, 0, 0, 0.1, 'Traditional 401k', true)
                    ],
                    cashflow: {
                        totalIncome: 100000,
                        totalExpense: 60000,
                        livingExpenses: 60000,
                        discretionary: 0,
                        investedUser: 0,
                        investedMatch: 0,
                        totalInvested: 0,
                        bucketAllocations: 0,
                        bucketDetail: {},
                        withdrawals: 0,
                        withdrawalDetail: {}
                    },
                    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
                    logs: []
                },
                {
                    year: 2025,
                    incomes: [],
                    expenses: [],
                    accounts: [
                        new InvestedAccount('inv-1', '401k', 550000, 0, 0, 0.1, 'Traditional 401k', true)
                    ],
                    cashflow: {
                        totalIncome: 100000,
                        totalExpense: 60000, // $500k × 4% = $20k < $60k = NOT FI
                        livingExpenses: 60000,
                        discretionary: 0,
                        investedUser: 0,
                        investedMatch: 0,
                        totalInvested: 0,
                        bucketAllocations: 0,
                        bucketDetail: {},
                        withdrawals: 0,
                        withdrawalDetail: {}
                    },
                    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
                    logs: []
                }
            ];

            simulation.forEach(y => { y.expenses = fiLivingExpenses(); });
            const milestones = calculateMilestones(simulation, assumptions);

            // 2024 invested $500k × 4% = $20k < $70,588 needed → never FI.
            expect(milestones.fiYear).toBeNull();
            expect(milestones.fiAge).toBeNull();
        });

        it('should find FI year achieved in later year (not immediately)', () => {
            // FI not achieved until year 4 when investments finally exceed 4% threshold
            const assumptions = createTestAssumptions();

            const simulation: SimulationYear[] = [
                {
                    year: 2024,
                    incomes: [],
                    expenses: [],
                    accounts: [
                        new InvestedAccount('inv-1', '401k', 500000, 0, 0, 0.1, 'Traditional 401k', true)
                    ],
                    cashflow: {
                        totalIncome: 100000,
                        totalExpense: 60000,
                        livingExpenses: 60000,
                        discretionary: 0,
                        investedUser: 0,
                        investedMatch: 0,
                        totalInvested: 0,
                        bucketAllocations: 0,
                        bucketDetail: {},
                        withdrawals: 0,
                        withdrawalDetail: {}
                    },
                    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
                    logs: []
                },
                {
                    year: 2025,
                    incomes: [],
                    expenses: [],
                    accounts: [
                        new InvestedAccount('inv-1', '401k', 800000, 0, 0, 0.1, 'Traditional 401k', true)
                    ],
                    cashflow: {
                        totalIncome: 100000,
                        totalExpense: 60000, // $500k × 4% = $20k < $60k = NOT FI
                        livingExpenses: 60000,
                        discretionary: 0,
                        investedUser: 0,
                        investedMatch: 0,
                        totalInvested: 0,
                        bucketAllocations: 0,
                        bucketDetail: {},
                        withdrawals: 0,
                        withdrawalDetail: {}
                    },
                    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
                    logs: []
                },
                {
                    year: 2026,
                    incomes: [],
                    expenses: [],
                    accounts: [
                        new InvestedAccount('inv-1', '401k', 1200000, 0, 0, 0.1, 'Traditional 401k', true)
                    ],
                    cashflow: {
                        totalIncome: 100000,
                        totalExpense: 60000, // $800k × 4% = $32k < $60k = NOT FI
                        livingExpenses: 60000,
                        discretionary: 0,
                        investedUser: 0,
                        investedMatch: 0,
                        totalInvested: 0,
                        bucketAllocations: 0,
                        bucketDetail: {},
                        withdrawals: 0,
                        withdrawalDetail: {}
                    },
                    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
                    logs: []
                },
                {
                    year: 2027,
                    incomes: [],
                    expenses: [],
                    accounts: [
                        new InvestedAccount('inv-1', '401k', 1800000, 0, 0, 0.1, 'Traditional 401k', true)
                    ],
                    cashflow: {
                        totalIncome: 100000,
                        totalExpense: 60000, // $1.2M × 4% = $48k < $60k = NOT FI
                        livingExpenses: 60000,
                        discretionary: 0,
                        investedUser: 0,
                        investedMatch: 0,
                        totalInvested: 0,
                        bucketAllocations: 0,
                        bucketDetail: {},
                        withdrawals: 0,
                        withdrawalDetail: {}
                    },
                    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
                    logs: []
                },
                {
                    year: 2028,
                    incomes: [],
                    expenses: [],
                    accounts: [
                        new InvestedAccount('inv-1', '401k', 2200000, 0, 0, 0.1, 'Traditional 401k', true)
                    ],
                    cashflow: {
                        totalIncome: 100000,
                        totalExpense: 60000, // $1.8M × 4% = $72k > $60k = FI ACHIEVED!
                        livingExpenses: 60000,
                        discretionary: 0,
                        investedUser: 0,
                        investedMatch: 0,
                        totalInvested: 0,
                        bucketAllocations: 0,
                        bucketDetail: {},
                        withdrawals: 0,
                        withdrawalDetail: {}
                    },
                    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
                    logs: []
                }
            ];

            simulation.forEach(y => { y.expenses = fiLivingExpenses(); });
            const milestones = calculateMilestones(simulation, assumptions);

            // FI achieved in 2028 when previous year (2027) investments of $1.8M × 4% = $72k ≥ $70,588 needed
            expect(milestones.fiYear).toBe(2028);
            // Age = 2028 - 1989 = 39
            expect(milestones.fiAge).toBe(39);
        });
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

    // #197 — when the two plans have genuinely different horizons the shorter
    // leg must simply STOP: its tail years read null (a gap the line ends at),
    // never a fabricated $0. The union timeline spans the FURTHEST horizon, and
    // deltas are only computed for years both plans reach.
    describe('different horizons (#197)', () => {
        it('does NOT zero-fill the shorter series tail — it reads null', () => {
            const assumptions = createTestAssumptions();
            // Baseline runs 10 years (2024-2033); comparison only 5 (2024-2028).
            const baseline = createLoadedScenarioFromSimulation('Long', createMockSimulation(10), assumptions);
            const comparison = createLoadedScenarioFromSimulation('Short', createMockSimulation(5), assumptions);

            const result = compareScenarios(baseline, comparison);
            const byYear = result.differences.netWorthByYear;

            // Union timeline spans the FURTHEST horizon (10 years, not min=5).
            expect(byYear).toHaveLength(10);
            expect(byYear[byYear.length - 1].year).toBe(2033);

            // Tail years (2029-2033): comparison absent → null, NOT 0. Baseline
            // still has real net worth, so the OLD `?? 0` would have fabricated a
            // $0 collapse here.
            const tail = byYear.filter(y => y.year >= 2029);
            expect(tail).toHaveLength(5);
            tail.forEach(y => {
                expect(y.comparison).toBeNull();
                expect(y.baseline).not.toBeNull();
                expect(y.baseline).toBeGreaterThan(0);
                // No delta across a year only one plan reaches (different ages).
                expect(y.delta).toBeNull();
                expect(y.deltaPercent).toBeNull();
            });

            // No year fabricates comparison === 0 while baseline is non-zero.
            const zeroFillArtifacts = byYear.filter(y => y.comparison === 0 && y.baseline !== null && y.baseline !== 0);
            expect(zeroFillArtifacts).toEqual([]);
        });

        it('computes overlap-year deltas but leaves legacyValueDelta at each plan\'s own final year', () => {
            const assumptions = createTestAssumptions();
            const baseline = createLoadedScenarioFromSimulation('Long', createMockSimulation(10), assumptions);
            const comparison = createLoadedScenarioFromSimulation('Short', createMockSimulation(5), assumptions);

            const result = compareScenarios(baseline, comparison);
            const byYear = result.differences.netWorthByYear;

            // Overlap years (2024-2028): identical growth curve → delta 0.
            const overlap = byYear.filter(y => y.year <= 2028);
            expect(overlap).toHaveLength(5);
            overlap.forEach(y => {
                expect(y.baseline).not.toBeNull();
                expect(y.comparison).not.toBeNull();
                expect(y.delta).toBe(0);
            });

            // legacyValueDelta is each plan's OWN final-year net worth, NOT an
            // age-matched 2033-vs-2033 read: baseline ends richer at 2033, the
            // comparison ends at its own 2028 — the delta reflects that gap.
            expect(result.differences.legacyValueDelta).toBe(
                comparison.milestones.legacyValue - baseline.milestones.legacyValue
            );
            expect(comparison.milestones.finalYear).toBe(2028);
            expect(baseline.milestones.finalYear).toBe(2033);
            // Comparison (shorter, so lower final net worth) is behind baseline.
            expect(result.differences.legacyValueDelta).toBeLessThan(0);
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
            cashflow: { totalIncome: 0, totalExpense: 0, livingExpenses: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
            taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
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
            cashflow: { totalIncome: 0, totalExpense: 0, livingExpenses: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
            taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
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
            cashflow: { totalIncome: 0, totalExpense: 0, livingExpenses: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
            taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
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
            cashflow: { totalIncome: 0, totalExpense: 0, livingExpenses: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
            taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
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
            cashflow: { totalIncome: 0, totalExpense: 0, livingExpenses: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
            taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0 },
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

// =============================================================================
// validateAndTransformScenarioImport Tests
// =============================================================================

describe('validateAndTransformScenarioImport', () => {
    const createValidInput = () => ({
        metadata: {
            id: 'original-id',
            name: 'Test Scenario',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z'
        },
        inputs: {
            accounts: [],
            incomes: [],
            expenses: [],
            taxSettings: {},
            assumptions: {}
        },
        version: '1.0.0'
    });

    describe('invalid input types', () => {
        it('should throw "not a valid object" for null input', () => {
            expect(() => validateAndTransformScenarioImport(null))
                .toThrow('Invalid scenario file: not a valid object');
        });

        it('should throw "not a valid object" for undefined input', () => {
            expect(() => validateAndTransformScenarioImport(undefined))
                .toThrow('Invalid scenario file: not a valid object');
        });

        it('should throw "not a valid object" for string input', () => {
            expect(() => validateAndTransformScenarioImport('not an object'))
                .toThrow('Invalid scenario file: not a valid object');
        });

        it('should throw "not a valid object" for number input', () => {
            expect(() => validateAndTransformScenarioImport(12345))
                .toThrow('Invalid scenario file: not a valid object');
        });
    });

    describe('missing required fields', () => {
        it('should throw "missing metadata or inputs" when metadata is missing', () => {
            const input = { inputs: { accounts: [] } };
            expect(() => validateAndTransformScenarioImport(input))
                .toThrow('Invalid scenario file: missing metadata or inputs');
        });

        it('should throw "missing metadata or inputs" when inputs is missing', () => {
            const input = { metadata: { id: '1', name: 'Test' } };
            expect(() => validateAndTransformScenarioImport(input))
                .toThrow('Invalid scenario file: missing metadata or inputs');
        });

        it('should throw "missing required metadata fields" when metadata.id is missing', () => {
            const input = {
                metadata: { name: 'Test' },
                inputs: { accounts: [] }
            };
            expect(() => validateAndTransformScenarioImport(input))
                .toThrow('Invalid scenario file: missing required metadata fields');
        });

        it('should throw "missing required metadata fields" when metadata.name is missing', () => {
            const input = {
                metadata: { id: '1' },
                inputs: { accounts: [] }
            };
            expect(() => validateAndTransformScenarioImport(input))
                .toThrow('Invalid scenario file: missing required metadata fields');
        });
    });

    describe('valid input transformation', () => {
        it('should return SavedScenario with new ID for valid input', () => {
            const input = createValidInput();
            const result = validateAndTransformScenarioImport(input);

            expect(result.metadata.id).not.toBe('original-id');
            expect(result.metadata.id).toContain('scenario_');
        });

        it('should add "(Imported)" suffix to name', () => {
            const input = createValidInput();
            const result = validateAndTransformScenarioImport(input);

            expect(result.metadata.name).toBe('Test Scenario (Imported)');
        });

        it('should set updatedAt to current time', () => {
            const input = createValidInput();
            const beforeTime = new Date().toISOString();
            const result = validateAndTransformScenarioImport(input);
            const afterTime = new Date().toISOString();

            expect(result.metadata.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
            expect(result.metadata.updatedAt >= beforeTime).toBe(true);
            expect(result.metadata.updatedAt <= afterTime).toBe(true);
        });

        it('should use SCENARIO_VERSION default when version is missing', () => {
            const input = createValidInput();
            delete (input as any).version;

            const result = validateAndTransformScenarioImport(input);

            expect(result.version).toBe(SCENARIO_VERSION);
        });

        it('should preserve original version when provided', () => {
            const input = createValidInput();
            input.version = '2.5.0';

            const result = validateAndTransformScenarioImport(input);

            expect(result.version).toBe('2.5.0');
        });

        it('should preserve other metadata fields', () => {
            const input = createValidInput();
            input.metadata.createdAt = '2023-06-15T12:00:00.000Z';
            (input.metadata as any).description = 'A test description';
            (input.metadata as any).tags = ['tag1', 'tag2'];

            const result = validateAndTransformScenarioImport(input);

            expect(result.metadata.createdAt).toBe('2023-06-15T12:00:00.000Z');
            expect(result.metadata.description).toBe('A test description');
            expect(result.metadata.tags).toEqual(['tag1', 'tag2']);
        });

        it('should preserve inputs object', () => {
            const input = createValidInput();
            input.inputs.accounts = [{ id: 'acc1', name: 'Test Account' }] as any;

            const result = validateAndTransformScenarioImport(input);

            expect(result.inputs.accounts).toEqual([{ id: 'acc1', name: 'Test Account' }]);
        });
    });
});
