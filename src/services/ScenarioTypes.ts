/**
 * Type definitions for the Scenario Comparison feature
 */

import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';

/**
 * Metadata for a saved scenario
 */
export interface ScenarioMetadata {
    id: string;
    name: string;
    description?: string;
    createdAt: string;  // ISO date string for JSON serialization
    updatedAt: string;  // ISO date string for JSON serialization
    tags?: string[];
}

/**
 * The inputs saved for a scenario (not the simulation output)
 * Matches the FullBackup structure from useFileManager
 */
export interface ScenarioInputs {
    accounts: any[];         // Serialized accounts
    incomes: any[];          // Serialized incomes
    expenses: any[];         // Serialized expenses
    taxSettings: any;        // TaxState
    assumptions: any;        // AssumptionsState
    amountHistory?: any[];   // Optional account balance history
}

/**
 * A scenario saved to localStorage or file
 */
export interface SavedScenario {
    metadata: ScenarioMetadata;
    inputs: ScenarioInputs;
    version: string;  // For future compatibility
}

/**
 * A scenario that has been loaded and simulated
 */
export interface LoadedScenario {
    metadata: ScenarioMetadata;
    simulation: SimulationYear[];
    milestones: MilestonesSummary;
}

/**
 * Key milestones extracted from a simulation
 */
export interface MilestonesSummary {
    fiYear: number | null;           // Year financial independence reached
    fiAge: number | null;            // Age at FI
    retirementYear: number | null;   // Planned retirement year
    retirementAge: number | null;    // Planned retirement age
    legacyValue: number;             // Net worth at end of simulation
    peakNetWorth: number;            // Maximum net worth achieved
    peakYear: number;                // Year of peak net worth
    yearsOfData: number;             // Total simulation years
    finalYear: number;               // Last year of simulation
}

/**
 * Year-by-year net worth comparison data
 */
export interface YearComparison {
    year: number;
    baseline: number;
    comparison: number;
    delta: number;           // comparison - baseline
    deltaPercent: number;    // (delta / baseline) * 100
}

/**
 * Result of comparing two scenarios
 */
export interface ScenarioComparison {
    baseline: LoadedScenario;
    comparison: LoadedScenario;
    differences: {
        fiYearDelta: number | null;           // Positive = comparison reaches FI later
        legacyValueDelta: number;              // Positive = comparison has higher legacy
        legacyValueDeltaPercent: number;       // Percentage difference
        peakNetWorthDelta: number;             // Difference in peak net worth
        retirementReadinessDelta: number;      // Difference in years of runway
        netWorthByYear: YearComparison[];      // Year-by-year breakdown
    };
}

/**
 * State for the ScenarioContext
 */
export interface ScenarioState {
    scenarios: SavedScenario[];
    selectedBaseline: string | null;    // ID of baseline scenario
    selectedComparison: string | null;  // ID of comparison scenario
    comparisonResult: ScenarioComparison | null;
    isLoading: boolean;
    error: string | null;
}

/**
 * Actions for the ScenarioContext reducer
 */
export type ScenarioAction =
    | { type: 'LOAD_SCENARIOS'; payload: SavedScenario[] }
    | { type: 'SAVE_SCENARIO'; payload: SavedScenario }
    | { type: 'DELETE_SCENARIO'; payload: string }  // scenario ID
    | { type: 'UPDATE_SCENARIO'; payload: SavedScenario }
    | { type: 'IMPORT_SCENARIO'; payload: SavedScenario }
    | { type: 'SELECT_BASELINE'; payload: string | null }
    | { type: 'SELECT_COMPARISON'; payload: string | null }
    | { type: 'SET_COMPARISON_RESULT'; payload: ScenarioComparison | null }
    | { type: 'SET_LOADING'; payload: boolean }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'CLEAR_COMPARISON' };

/**
 * Current version for saved scenarios
 */
export const SCENARIO_VERSION = '1.0.0';

/**
 * localStorage key for scenarios
 */
export const SCENARIOS_STORAGE_KEY = 'stag_scenarios';
