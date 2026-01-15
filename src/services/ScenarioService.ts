/**
 * Service for managing scenarios: CRUD operations, serialization, and comparison logic
 */

import {
    SavedScenario,
    ScenarioMetadata,
    ScenarioInputs,
    MilestonesSummary,
    LoadedScenario,
    ScenarioComparison,
    YearComparison,
    SCENARIO_VERSION,
    SCENARIOS_STORAGE_KEY
} from './ScenarioTypes';
import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { AssumptionsState } from '../components/Objects/Assumptions/AssumptionsContext';
import { AnyAccount, DebtAccount, InvestedAccount, PropertyAccount } from '../components/Objects/Accounts/models';
import { TaxState } from '../components/Objects/Taxes/TaxContext';
import { AmountHistoryEntry } from '../components/Objects/Accounts/AccountContext';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique ID for scenarios
 */
export const generateScenarioId = (): string => {
    return `scenario_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Calculate net worth from accounts
 * Assets = all account amounts except DebtAccount
 * Liabilities = DebtAccount amounts + PropertyAccount.loanAmount (mortgage balance)
 */
const calculateNetWorth = (accounts: AnyAccount[]): number => {
    const assets = accounts.reduce((total, acc) => {
        if (acc instanceof DebtAccount) return total;
        return total + acc.amount;
    }, 0);
    const liabilities = accounts.reduce((total, acc) => {
        if (acc instanceof DebtAccount) return total + acc.amount;
        // PropertyAccount tracks mortgage balance in loanAmount field
        if (acc instanceof PropertyAccount) return total + acc.loanAmount;
        return total;
    }, 0);
    return assets - liabilities;
};

// ============================================================================
// localStorage CRUD Operations
// ============================================================================

/**
 * Load all scenarios from localStorage
 */
export const loadScenariosFromStorage = (): SavedScenario[] => {
    try {
        const stored = localStorage.getItem(SCENARIOS_STORAGE_KEY);
        if (!stored) return [];

        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return [];

        return parsed;
    } catch (e) {
        console.error('Error loading scenarios from storage:', e);
        return [];
    }
};

/**
 * Save all scenarios to localStorage
 */
const saveScenariosToStorage = (scenarios: SavedScenario[]): void => {
    try {
        localStorage.setItem(SCENARIOS_STORAGE_KEY, JSON.stringify(scenarios));
    } catch (e) {
        console.error('Error saving scenarios to storage:', e);
        // Check if it's a quota exceeded error
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
            throw new Error('Storage quota exceeded. Please delete some scenarios to make room.');
        }
        throw e;
    }
};

/**
 * Save a single scenario to localStorage
 */
export const saveScenarioToStorage = (scenario: SavedScenario): void => {
    const scenarios = loadScenariosFromStorage();
    const existingIndex = scenarios.findIndex(s => s.metadata.id === scenario.metadata.id);

    if (existingIndex >= 0) {
        // Update existing
        scenarios[existingIndex] = {
            ...scenario,
            metadata: {
                ...scenario.metadata,
                updatedAt: new Date().toISOString()
            }
        };
    } else {
        // Add new
        scenarios.push(scenario);
    }

    saveScenariosToStorage(scenarios);
};

/**
 * Delete a scenario from localStorage
 */
export const deleteScenarioFromStorage = (id: string): void => {
    const scenarios = loadScenariosFromStorage();
    const filtered = scenarios.filter(s => s.metadata.id !== id);
    saveScenariosToStorage(filtered);
};

/**
 * Get a single scenario by ID
 */
export const getScenarioById = (id: string): SavedScenario | null => {
    const scenarios = loadScenariosFromStorage();
    return scenarios.find(s => s.metadata.id === id) || null;
};

// ============================================================================
// State Capture
// ============================================================================

/**
 * Capture the current application state as scenario inputs
 */
export const captureCurrentState = (
    accounts: AnyAccount[],
    amountHistory: Record<string, AmountHistoryEntry[]>,
    incomes: any[],
    expenses: any[],
    taxSettings: TaxState,
    assumptions: AssumptionsState
): ScenarioInputs => {
    return {
        accounts: accounts.map(a => ({ ...a, className: a.constructor.name })),
        incomes: incomes.map(i => ({ ...i, className: i.constructor.name })),
        expenses: expenses.map(e => ({ ...e, className: e.constructor.name })),
        taxSettings,
        assumptions,
        amountHistory: Object.entries(amountHistory).map(([accountId, history]) => ({
            accountId,
            history
        }))
    };
};

/**
 * Create a new scenario from the current state
 */
export const createScenario = (
    name: string,
    description: string | undefined,
    inputs: ScenarioInputs,
    tags?: string[]
): SavedScenario => {
    const now = new Date().toISOString();

    const metadata: ScenarioMetadata = {
        id: generateScenarioId(),
        name,
        description,
        createdAt: now,
        updatedAt: now,
        tags
    };

    return {
        metadata,
        inputs,
        version: SCENARIO_VERSION
    };
};

// ============================================================================
// File Export/Import
// ============================================================================

/**
 * Export a scenario to a JSON file
 */
export const exportScenarioToFile = (scenario: SavedScenario): void => {
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stag_scenario_${scenario.metadata.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

/**
 * Import a scenario from a JSON file
 */
export const importScenarioFromFile = async (file: File): Promise<SavedScenario> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const parsed = JSON.parse(content);

                // Validate the scenario structure
                if (!parsed.metadata || !parsed.inputs) {
                    throw new Error('Invalid scenario file: missing metadata or inputs');
                }

                if (!parsed.metadata.id || !parsed.metadata.name) {
                    throw new Error('Invalid scenario file: missing required metadata fields');
                }

                // Generate a new ID to avoid conflicts with existing scenarios
                const importedScenario: SavedScenario = {
                    ...parsed,
                    metadata: {
                        ...parsed.metadata,
                        id: generateScenarioId(), // New ID for import
                        name: `${parsed.metadata.name} (Imported)`,
                        updatedAt: new Date().toISOString()
                    },
                    version: parsed.version || SCENARIO_VERSION
                };

                resolve(importedScenario);
            } catch (e) {
                reject(new Error(`Failed to parse scenario file: ${e instanceof Error ? e.message : 'Unknown error'}`));
            }
        };

        reader.onerror = () => {
            reject(new Error('Failed to read file'));
        };

        reader.readAsText(file);
    });
};

// ============================================================================
// Milestone Calculation
// ============================================================================

/**
 * Find the year of financial independence from simulation data
 * FI is when investment withdrawals at the configured rate can cover expenses
 */
const findFinancialIndependenceYear = (
    simulation: SimulationYear[],
    assumptions: AssumptionsState
): { year: number | null; age: number | null } => {
    for (let i = 1; i < simulation.length; i++) {
        const lastYear = simulation[i - 1];
        const currentYear = simulation[i];

        const lastYearInvestments = lastYear.accounts
            .filter(acc => acc instanceof InvestedAccount)
            .reduce((sum, acc) => sum + acc.amount, 0);

        // FI is reached when withdrawal can cover expenses
        const withdrawalRate = assumptions.investments?.withdrawalRate || 4;
        if (lastYearInvestments * (withdrawalRate / 100) > currentYear.cashflow.totalExpense) {
            const age = assumptions.demographics.startAge + (currentYear.year - assumptions.demographics.startYear);
            return { year: currentYear.year, age };
        }
    }
    return { year: null, age: null };
};

/**
 * Calculate key milestones from simulation data
 */
export const calculateMilestones = (
    simulation: SimulationYear[],
    assumptions: AssumptionsState
): MilestonesSummary => {
    if (simulation.length === 0) {
        return {
            fiYear: null,
            fiAge: null,
            retirementYear: null,
            retirementAge: null,
            legacyValue: 0,
            peakNetWorth: 0,
            peakYear: 0,
            yearsOfData: 0,
            finalYear: 0
        };
    }

    // Find FI year
    const fi = findFinancialIndependenceYear(simulation, assumptions);

    // Calculate retirement year from assumptions
    const retirementYear = assumptions.demographics.startYear +
        (assumptions.demographics.retirementAge - assumptions.demographics.startAge);

    // Find peak net worth and year
    let peakNetWorth = -Infinity;
    let peakYear = simulation[0].year;

    for (const year of simulation) {
        const netWorth = calculateNetWorth(year.accounts);
        if (netWorth > peakNetWorth) {
            peakNetWorth = netWorth;
            peakYear = year.year;
        }
    }

    // Get final year data
    const finalYearData = simulation[simulation.length - 1];
    const legacyValue = calculateNetWorth(finalYearData.accounts);

    return {
        fiYear: fi.year,
        fiAge: fi.age,
        retirementYear,
        retirementAge: assumptions.demographics.retirementAge,
        legacyValue,
        peakNetWorth,
        peakYear,
        yearsOfData: simulation.length,
        finalYear: finalYearData.year
    };
};

// ============================================================================
// Comparison Logic
// ============================================================================

/**
 * Compare two loaded scenarios and calculate differences
 */
export const compareScenarios = (
    baseline: LoadedScenario,
    comparison: LoadedScenario
): ScenarioComparison => {
    const baselineMilestones = baseline.milestones;
    const comparisonMilestones = comparison.milestones;

    // Calculate FI year delta (positive means comparison is later)
    let fiYearDelta: number | null = null;
    if (baselineMilestones.fiYear !== null && comparisonMilestones.fiYear !== null) {
        fiYearDelta = comparisonMilestones.fiYear - baselineMilestones.fiYear;
    }

    // Calculate legacy value difference
    const legacyValueDelta = comparisonMilestones.legacyValue - baselineMilestones.legacyValue;
    const legacyValueDeltaPercent = baselineMilestones.legacyValue !== 0
        ? (legacyValueDelta / Math.abs(baselineMilestones.legacyValue)) * 100
        : 0;

    // Calculate peak net worth difference
    const peakNetWorthDelta = comparisonMilestones.peakNetWorth - baselineMilestones.peakNetWorth;

    // Calculate "retirement readiness" as years of expenses covered at retirement
    // This is a simplified metric
    const retirementReadinessDelta = 0; // TODO: calculate based on runway at retirement

    // Build year-by-year comparison
    const netWorthByYear: YearComparison[] = [];

    // Create maps for quick lookup
    const baselineByYear = new Map<number, number>();
    const comparisonByYear = new Map<number, number>();

    for (const year of baseline.simulation) {
        baselineByYear.set(year.year, calculateNetWorth(year.accounts));
    }
    for (const year of comparison.simulation) {
        comparisonByYear.set(year.year, calculateNetWorth(year.accounts));
    }

    // Get all unique years
    const allYears = new Set([...baselineByYear.keys(), ...comparisonByYear.keys()]);
    const sortedYears = Array.from(allYears).sort((a, b) => a - b);

    for (const year of sortedYears) {
        const baselineValue = baselineByYear.get(year) ?? 0;
        const comparisonValue = comparisonByYear.get(year) ?? 0;
        const delta = comparisonValue - baselineValue;
        const deltaPercent = baselineValue !== 0
            ? (delta / Math.abs(baselineValue)) * 100
            : 0;

        netWorthByYear.push({
            year,
            baseline: baselineValue,
            comparison: comparisonValue,
            delta,
            deltaPercent
        });
    }

    return {
        baseline,
        comparison,
        differences: {
            fiYearDelta,
            legacyValueDelta,
            legacyValueDeltaPercent,
            peakNetWorthDelta,
            retirementReadinessDelta,
            netWorthByYear
        }
    };
};

/**
 * Create a LoadedScenario from simulation data
 * Used when comparing the current state as a scenario
 */
export const createLoadedScenarioFromSimulation = (
    name: string,
    simulation: SimulationYear[],
    assumptions: AssumptionsState
): LoadedScenario => {
    const now = new Date().toISOString();

    return {
        metadata: {
            id: 'current',
            name,
            createdAt: now,
            updatedAt: now
        },
        simulation,
        milestones: calculateMilestones(simulation, assumptions)
    };
};
