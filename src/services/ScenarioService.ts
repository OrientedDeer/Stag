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
import { AssumptionsState, getRetirementAge, getBirthYear } from '../components/Objects/Assumptions/AssumptionsContext';
import { findFinancialIndependenceYear } from './MilestoneCalculator';
import { AnyAccount, DebtAccount, PropertyAccount } from '../components/Objects/Accounts/models';
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
 * Validate and transform a parsed scenario file for import.
 * Throws if validation fails.
 */
export function validateAndTransformScenarioImport(parsed: unknown): SavedScenario {
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid scenario file: not a valid object');
    }

    const obj = parsed as Record<string, unknown>;

    if (!obj.metadata || !obj.inputs) {
        throw new Error('Invalid scenario file: missing metadata or inputs');
    }

    const metadata = obj.metadata as Record<string, unknown>;
    if (!metadata.id || !metadata.name) {
        throw new Error('Invalid scenario file: missing required metadata fields');
    }

    // Generate a new ID to avoid conflicts with existing scenarios
    return {
        ...obj,
        metadata: {
            ...metadata,
            id: generateScenarioId(),
            name: `${metadata.name} (Imported)`,
            updatedAt: new Date().toISOString()
        },
        version: obj.version || SCENARIO_VERSION
    } as SavedScenario;
}

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
                resolve(validateAndTransformScenarioImport(parsed));
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

    // Find FI year — single-sourced on the canonical MilestoneCalculator
    // implementation (no local 0%→4% withdrawal-rate coercion).
    const fi = findFinancialIndependenceYear(simulation, assumptions);

    // Calculate retirement year from assumptions
    const retirementAge = getRetirementAge(assumptions.milestones);
    const retirementYear = getBirthYear(assumptions.milestones) + retirementAge;

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
        fiYear: fi?.year ?? null,
        fiAge: fi?.age ?? null,
        retirementYear,
        retirementAge,
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
 * Build a Map of year to net worth from simulation data.
 */
function buildNetWorthByYearMap(simulation: SimulationYear[]): Map<number, number> {
    return new Map(simulation.map(year => [year.year, calculateNetWorth(year.accounts)]));
}

/**
 * Calculate percentage difference safely (returns 0 if baseline is 0).
 */
function calculateDeltaPercent(delta: number, baseline: number): number {
    return baseline !== 0 ? (delta / Math.abs(baseline)) * 100 : 0;
}

/**
 * Compare two loaded scenarios and calculate differences.
 */
export const compareScenarios = (
    baseline: LoadedScenario,
    comparison: LoadedScenario
): ScenarioComparison => {
    const baselineMilestones = baseline.milestones;
    const comparisonMilestones = comparison.milestones;

    const fiYearDelta = (baselineMilestones.fiYear !== null && comparisonMilestones.fiYear !== null)
        ? comparisonMilestones.fiYear - baselineMilestones.fiYear
        : null;

    // legacyValueDelta / peakNetWorthDelta compare each plan at ITS OWN final year
    // (milestones are read off each simulation's last row). When the two plans have
    // different life expectancies these are NOT age-matched — comparing wealth at,
    // say, age 90 vs age 85 would be misleading, so we deliberately report each
    // plan's own end-of-plan figure and let the UI label the horizon mismatch.
    const legacyValueDelta = comparisonMilestones.legacyValue - baselineMilestones.legacyValue;
    const peakNetWorthDelta = comparisonMilestones.peakNetWorth - baselineMilestones.peakNetWorth;

    const baselineByYear = buildNetWorthByYearMap(baseline.simulation);
    const comparisonByYear = buildNetWorthByYearMap(comparison.simulation);

    // Union of years across both horizons: the timeline spans the FURTHEST plan.
    const allYears = [...new Set([...baselineByYear.keys(), ...comparisonByYear.keys()])].sort((a, b) => a - b);

    const netWorthByYear: YearComparison[] = allYears.map(year => {
        // Beyond a plan's own horizon its series is ABSENT (null), never 0 — the
        // shorter line must visibly END, not drop to a fake $0 collapse (#197).
        const baselineValue = baselineByYear.has(year) ? baselineByYear.get(year)! : null;
        const comparisonValue = comparisonByYear.has(year) ? comparisonByYear.get(year)! : null;
        const bothPresent = baselineValue !== null && comparisonValue !== null;
        const delta = bothPresent ? comparisonValue! - baselineValue! : null;
        return {
            year,
            baseline: baselineValue,
            comparison: comparisonValue,
            delta,
            deltaPercent: bothPresent ? calculateDeltaPercent(delta!, baselineValue!) : null
        };
    });

    return {
        baseline,
        comparison,
        differences: {
            fiYearDelta,
            legacyValueDelta,
            legacyValueDeltaPercent: calculateDeltaPercent(legacyValueDelta, baselineMilestones.legacyValue),
            peakNetWorthDelta,
            retirementReadinessDelta: 0,
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
