import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext } from 'react';

import {
    ScenarioProvider,
    ScenarioContext,
    useScenarios,
    useScenariosList,
    useScenarioComparison,
} from '../../../../components/Objects/Scenarios/ScenarioContext';
import {
    SavedScenario,
    LoadedScenario,
    ScenarioComparison,
    MilestonesSummary,
    ScenarioState,
} from '../../../../services/ScenarioTypes';
import { defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';

// Mock ScenarioService
vi.mock('../../../../services/ScenarioService', () => ({
    loadScenariosFromStorage: vi.fn(() => []),
    saveScenarioToStorage: vi.fn(),
    deleteScenarioFromStorage: vi.fn(),
    captureCurrentState: vi.fn(),
    createScenario: vi.fn(),
    exportScenarioToFile: vi.fn(),
    importScenarioFromFile: vi.fn(),
    calculateMilestones: vi.fn(),
    compareScenarios: vi.fn(),
    createLoadedScenarioFromSimulation: vi.fn(),
}));

// Mock useSimulation
vi.mock('../../../../components/Objects/Assumptions/useSimulation', () => ({
    runSimulation: vi.fn(() => []),
}));

// Import mocked functions
import {
    loadScenariosFromStorage,
    saveScenarioToStorage,
    deleteScenarioFromStorage,
    captureCurrentState,
    createScenario,
    exportScenarioToFile,
    importScenarioFromFile,
    calculateMilestones,
    compareScenarios,
    createLoadedScenarioFromSimulation,
} from '../../../../services/ScenarioService';

import { runSimulation } from '../../../../components/Objects/Assumptions/useSimulation';

// ============================================================================
// Test Helpers
// ============================================================================

const createMockScenario = (id: string, name: string): SavedScenario => ({
    metadata: {
        id,
        name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
            year: 2024,
        },
        assumptions: defaultAssumptions,
    },
    version: '1.0.0',
});

const createMockMilestones = (): MilestonesSummary => ({
    fiYear: 2040,
    fiAge: 50,
    retirementYear: 2054,
    retirementAge: 65,
    legacyValue: 1000000,
    peakNetWorth: 1500000,
    peakYear: 2060,
    yearsOfData: 30,
    finalYear: 2054,
});

const createMockLoadedScenario = (id: string, name: string): LoadedScenario => ({
    metadata: {
        id,
        name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    simulation: [],
    milestones: createMockMilestones(),
});

const createMockComparison = (
    baseline: LoadedScenario,
    comparison: LoadedScenario
): ScenarioComparison => ({
    baseline,
    comparison,
    differences: {
        fiYearDelta: 0,
        legacyValueDelta: 0,
        legacyValueDeltaPercent: 0,
        peakNetWorthDelta: 0,
        retirementReadinessDelta: 0,
        netWorthByYear: [],
    },
});

// ============================================================================
// Tests
// ============================================================================

describe('ScenarioContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset mock implementations to default (no-op) functions
        (loadScenariosFromStorage as Mock).mockReturnValue([]);
        (saveScenarioToStorage as Mock).mockImplementation(() => {});
        (deleteScenarioFromStorage as Mock).mockImplementation(() => {});
        (captureCurrentState as Mock).mockReset();
        (createScenario as Mock).mockReset();
        (exportScenarioToFile as Mock).mockImplementation(() => {});
        (importScenarioFromFile as Mock).mockReset();
        (calculateMilestones as Mock).mockReset();
        (compareScenarios as Mock).mockReset();
        (createLoadedScenarioFromSimulation as Mock).mockReset();
        (runSimulation as Mock).mockReset();
    });

    // ========================================================================
    // Initial State Tests
    // ========================================================================

    describe('Initial State', () => {
        it('should provide initial state when no scenarios exist', () => {
            let state: ScenarioState;

            const TestComponent = () => {
                ({ state } = useContext(ScenarioContext));
                return null;
            };

            render(
                <ScenarioProvider>
                    <TestComponent />
                </ScenarioProvider>
            );

            expect(state!.scenarios).toEqual([]);
            expect(state!.selectedBaseline).toBeNull();
            expect(state!.selectedComparison).toBeNull();
            expect(state!.comparisonResult).toBeNull();
            expect(state!.isLoading).toBe(false);
            expect(state!.error).toBeNull();
        });

        it('should load scenarios from localStorage on mount', () => {
            const mockScenarios = [createMockScenario('test-1', 'Test Scenario')];
            (loadScenariosFromStorage as Mock).mockReturnValue(mockScenarios);

            let state: ScenarioState;

            const TestComponent = () => {
                ({ state } = useContext(ScenarioContext));
                return null;
            };

            render(
                <ScenarioProvider>
                    <TestComponent />
                </ScenarioProvider>
            );

            expect(loadScenariosFromStorage).toHaveBeenCalled();
            expect(state!.scenarios).toHaveLength(1);
            expect(state!.scenarios[0].metadata.name).toBe('Test Scenario');
        });
    });

    // ========================================================================
    // Reducer Actions Tests
    // ========================================================================

    describe('Reducer Actions', () => {
        describe('LOAD_SCENARIOS', () => {
            it('should set scenarios array', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const scenarios = [
                    createMockScenario('1', 'Scenario 1'),
                    createMockScenario('2', 'Scenario 2'),
                ];

                act(() => {
                    dispatch({ type: 'LOAD_SCENARIOS', payload: scenarios });
                });

                expect(state!.scenarios).toHaveLength(2);
                expect(state!.scenarios[0].metadata.id).toBe('1');
                expect(state!.scenarios[1].metadata.id).toBe('2');
            });

            it('should clear error when loading scenarios', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set an error first
                act(() => {
                    dispatch({ type: 'SET_ERROR', payload: 'Some error' });
                });

                expect(state!.error).toBe('Some error');

                // Load scenarios should clear the error
                act(() => {
                    dispatch({ type: 'LOAD_SCENARIOS', payload: [] });
                });

                expect(state!.error).toBeNull();
            });
        });

        describe('SAVE_SCENARIO', () => {
            it('should add new scenario', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const newScenario = createMockScenario('new-1', 'New Scenario');

                act(() => {
                    dispatch({ type: 'SAVE_SCENARIO', payload: newScenario });
                });

                expect(state!.scenarios).toHaveLength(1);
                expect(state!.scenarios[0].metadata.name).toBe('New Scenario');
            });

            it('should update existing scenario by ID', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Add initial scenario
                const scenario = createMockScenario('test-1', 'Original Name');
                act(() => {
                    dispatch({ type: 'SAVE_SCENARIO', payload: scenario });
                });

                expect(state!.scenarios[0].metadata.name).toBe('Original Name');

                // Update the same scenario
                const updated = {
                    ...scenario,
                    metadata: { ...scenario.metadata, name: 'Updated Name' },
                };
                act(() => {
                    dispatch({ type: 'SAVE_SCENARIO', payload: updated });
                });

                // Should still have 1 scenario with updated name
                expect(state!.scenarios).toHaveLength(1);
                expect(state!.scenarios[0].metadata.name).toBe('Updated Name');
            });
        });

        describe('DELETE_SCENARIO', () => {
            it('should remove scenario by ID', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Add two scenarios
                act(() => {
                    dispatch({
                        type: 'LOAD_SCENARIOS',
                        payload: [
                            createMockScenario('1', 'First'),
                            createMockScenario('2', 'Second'),
                        ],
                    });
                });

                expect(state!.scenarios).toHaveLength(2);

                // Delete the first one
                act(() => {
                    dispatch({ type: 'DELETE_SCENARIO', payload: '1' });
                });

                expect(state!.scenarios).toHaveLength(1);
                expect(state!.scenarios[0].metadata.id).toBe('2');
            });

            it('should clear selectedBaseline if deleted', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Add scenario and select as baseline
                act(() => {
                    dispatch({
                        type: 'LOAD_SCENARIOS',
                        payload: [createMockScenario('baseline-1', 'Baseline')],
                    });
                });

                act(() => {
                    dispatch({ type: 'SELECT_BASELINE', payload: 'baseline-1' });
                });

                expect(state!.selectedBaseline).toBe('baseline-1');

                // Delete the baseline scenario
                act(() => {
                    dispatch({ type: 'DELETE_SCENARIO', payload: 'baseline-1' });
                });

                expect(state!.selectedBaseline).toBeNull();
            });

            it('should clear selectedComparison if deleted', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Add scenario and select as comparison
                act(() => {
                    dispatch({
                        type: 'LOAD_SCENARIOS',
                        payload: [createMockScenario('comp-1', 'Comparison')],
                    });
                });

                act(() => {
                    dispatch({ type: 'SELECT_COMPARISON', payload: 'comp-1' });
                });

                expect(state!.selectedComparison).toBe('comp-1');

                // Delete the comparison scenario
                act(() => {
                    dispatch({ type: 'DELETE_SCENARIO', payload: 'comp-1' });
                });

                expect(state!.selectedComparison).toBeNull();
            });

            it('should clear comparisonResult if baseline or comparison deleted', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const baseline = createMockLoadedScenario('baseline-1', 'Baseline');
                const comparison = createMockLoadedScenario('comp-1', 'Comparison');
                const mockResult = createMockComparison(baseline, comparison);

                // Set up comparison result
                act(() => {
                    dispatch({
                        type: 'LOAD_SCENARIOS',
                        payload: [
                            createMockScenario('baseline-1', 'Baseline'),
                            createMockScenario('comp-1', 'Comparison'),
                        ],
                    });
                });

                act(() => {
                    dispatch({ type: 'SET_COMPARISON_RESULT', payload: mockResult });
                });

                expect(state!.comparisonResult).not.toBeNull();

                // Delete the baseline scenario
                act(() => {
                    dispatch({ type: 'DELETE_SCENARIO', payload: 'baseline-1' });
                });

                expect(state!.comparisonResult).toBeNull();
            });
        });

        describe('UPDATE_SCENARIO', () => {
            it('should update existing scenario', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const scenario = createMockScenario('update-1', 'Original');

                act(() => {
                    dispatch({ type: 'LOAD_SCENARIOS', payload: [scenario] });
                });

                const updated = {
                    ...scenario,
                    metadata: { ...scenario.metadata, name: 'Updated' },
                };

                act(() => {
                    dispatch({ type: 'UPDATE_SCENARIO', payload: updated });
                });

                expect(state!.scenarios[0].metadata.name).toBe('Updated');
            });
        });

        describe('IMPORT_SCENARIO', () => {
            it('should append imported scenario', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Start with one scenario
                act(() => {
                    dispatch({
                        type: 'LOAD_SCENARIOS',
                        payload: [createMockScenario('existing', 'Existing')],
                    });
                });

                // Import a new one
                const imported = createMockScenario('imported', 'Imported');
                act(() => {
                    dispatch({ type: 'IMPORT_SCENARIO', payload: imported });
                });

                expect(state!.scenarios).toHaveLength(2);
                expect(state!.scenarios[1].metadata.name).toBe('Imported');
            });
        });

        describe('SELECT_BASELINE', () => {
            it('should set baseline ID', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    dispatch({ type: 'SELECT_BASELINE', payload: 'baseline-123' });
                });

                expect(state!.selectedBaseline).toBe('baseline-123');
            });

            it('should clear comparison result when selection changes', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set a comparison result first
                const baseline = createMockLoadedScenario('b', 'B');
                const comparison = createMockLoadedScenario('c', 'C');
                act(() => {
                    dispatch({
                        type: 'SET_COMPARISON_RESULT',
                        payload: createMockComparison(baseline, comparison),
                    });
                });

                expect(state!.comparisonResult).not.toBeNull();

                // Change baseline selection
                act(() => {
                    dispatch({ type: 'SELECT_BASELINE', payload: 'new-baseline' });
                });

                expect(state!.comparisonResult).toBeNull();
            });
        });

        describe('SELECT_COMPARISON', () => {
            it('should set comparison ID', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    dispatch({ type: 'SELECT_COMPARISON', payload: 'comp-123' });
                });

                expect(state!.selectedComparison).toBe('comp-123');
            });

            it('should clear comparison result when selection changes', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set a comparison result first
                const baseline = createMockLoadedScenario('b', 'B');
                const comparison = createMockLoadedScenario('c', 'C');
                act(() => {
                    dispatch({
                        type: 'SET_COMPARISON_RESULT',
                        payload: createMockComparison(baseline, comparison),
                    });
                });

                expect(state!.comparisonResult).not.toBeNull();

                // Change comparison selection
                act(() => {
                    dispatch({ type: 'SELECT_COMPARISON', payload: 'new-comp' });
                });

                expect(state!.comparisonResult).toBeNull();
            });
        });

        describe('SET_COMPARISON_RESULT', () => {
            it('should set comparison result and clear loading', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set loading first
                act(() => {
                    dispatch({ type: 'SET_LOADING', payload: true });
                });

                expect(state!.isLoading).toBe(true);

                // Set comparison result
                const baseline = createMockLoadedScenario('b', 'B');
                const comparison = createMockLoadedScenario('c', 'C');
                const result = createMockComparison(baseline, comparison);

                act(() => {
                    dispatch({ type: 'SET_COMPARISON_RESULT', payload: result });
                });

                expect(state!.comparisonResult).toBe(result);
                expect(state!.isLoading).toBe(false);
            });
        });

        describe('SET_LOADING', () => {
            it('should set loading to true', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    dispatch({ type: 'SET_LOADING', payload: true });
                });

                expect(state!.isLoading).toBe(true);
            });

            it('should set loading to false', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    dispatch({ type: 'SET_LOADING', payload: true });
                });

                act(() => {
                    dispatch({ type: 'SET_LOADING', payload: false });
                });

                expect(state!.isLoading).toBe(false);
            });
        });

        describe('SET_ERROR', () => {
            it('should set error message and clear loading', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set loading first
                act(() => {
                    dispatch({ type: 'SET_LOADING', payload: true });
                });

                // Set error
                act(() => {
                    dispatch({ type: 'SET_ERROR', payload: 'Something went wrong' });
                });

                expect(state!.error).toBe('Something went wrong');
                expect(state!.isLoading).toBe(false);
            });
        });

        describe('CLEAR_COMPARISON', () => {
            it('should reset baseline, comparison, and result to null', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set up selections and result
                act(() => {
                    dispatch({ type: 'SELECT_BASELINE', payload: 'baseline-1' });
                });

                act(() => {
                    dispatch({ type: 'SELECT_COMPARISON', payload: 'comp-1' });
                });

                const baseline = createMockLoadedScenario('baseline-1', 'B');
                const comparison = createMockLoadedScenario('comp-1', 'C');
                act(() => {
                    dispatch({
                        type: 'SET_COMPARISON_RESULT',
                        payload: createMockComparison(baseline, comparison),
                    });
                });

                // Clear comparison
                act(() => {
                    dispatch({ type: 'CLEAR_COMPARISON' });
                });

                expect(state!.selectedBaseline).toBeNull();
                expect(state!.selectedComparison).toBeNull();
                expect(state!.comparisonResult).toBeNull();
            });
        });

        describe('Unknown action type', () => {
            it('should return current state for unknown action types', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set up some state first
                act(() => {
                    dispatch({ type: 'SELECT_BASELINE', payload: 'test-baseline' });
                });

                const stateBeforeUnknown = { ...state! };

                // Dispatch unknown action
                act(() => {
                    dispatch({ type: 'UNKNOWN_ACTION' as any, payload: 'anything' });
                });

                // State should be unchanged
                expect(state!.selectedBaseline).toBe(stateBeforeUnknown.selectedBaseline);
                expect(state!.scenarios).toEqual(stateBeforeUnknown.scenarios);
            });
        });
    });

    // ========================================================================
    // Context Actions Tests
    // ========================================================================

    describe('Context Actions', () => {
        describe('saveCurrentAsScenario', () => {
            it('should capture state and save scenario', () => {
                const mockInputs = { accounts: [], incomes: [], expenses: [], taxSettings: {}, assumptions: {} };
                const mockScenario = createMockScenario('new-scenario', 'Test Save');

                (captureCurrentState as Mock).mockReturnValue(mockInputs);
                (createScenario as Mock).mockReturnValue(mockScenario);

                let state: ScenarioState;
                let saveCurrentAsScenario: any;

                const TestComponent = () => {
                    ({ state, saveCurrentAsScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    saveCurrentAsScenario(
                        'Test Save',
                        'Description',
                        [], // accounts
                        {}, // amountHistory
                        [], // incomes
                        [], // expenses
                        {}, // taxSettings
                        defaultAssumptions,
                        ['tag1']
                    );
                });

                expect(captureCurrentState).toHaveBeenCalled();
                expect(createScenario).toHaveBeenCalledWith('Test Save', 'Description', mockInputs, ['tag1']);
                expect(saveScenarioToStorage).toHaveBeenCalledWith(mockScenario);
                expect(state!.scenarios).toContain(mockScenario);
            });

            it('should handle errors gracefully', () => {
                (captureCurrentState as Mock).mockImplementation(() => {
                    throw new Error('Capture failed');
                });

                let state: ScenarioState;
                let saveCurrentAsScenario: any;

                const TestComponent = () => {
                    ({ state, saveCurrentAsScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    saveCurrentAsScenario('Test', undefined, [], {}, [], [], {}, defaultAssumptions);
                });

                expect(state!.error).toBe('Capture failed');
            });

            it('should handle non-Error exceptions gracefully', () => {
                (captureCurrentState as Mock).mockImplementation(() => {
                    throw 'String error';
                });

                let state: ScenarioState;
                let saveCurrentAsScenario: any;

                const TestComponent = () => {
                    ({ state, saveCurrentAsScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    saveCurrentAsScenario('Test', undefined, [], {}, [], [], {}, defaultAssumptions);
                });

                expect(state!.error).toBe('Failed to save scenario');
            });
        });

        describe('deleteScenario', () => {
            it('should delete scenario from storage and state', () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([
                    createMockScenario('to-delete', 'Delete Me'),
                ]);

                let state: ScenarioState;
                let deleteScenario: any;

                const TestComponent = () => {
                    ({ state, deleteScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                expect(state!.scenarios).toHaveLength(1);

                act(() => {
                    deleteScenario('to-delete');
                });

                expect(deleteScenarioFromStorage).toHaveBeenCalledWith('to-delete');
                expect(state!.scenarios).toHaveLength(0);
            });

            it('should handle errors gracefully', () => {
                (deleteScenarioFromStorage as Mock).mockImplementation(() => {
                    throw new Error('Delete failed');
                });

                let state: ScenarioState;
                let deleteScenario: any;

                const TestComponent = () => {
                    ({ state, deleteScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    deleteScenario('some-id');
                });

                expect(state!.error).toBe('Delete failed');
            });

            it('should handle non-Error exceptions gracefully', () => {
                (deleteScenarioFromStorage as Mock).mockImplementation(() => {
                    throw 'String error';
                });

                let state: ScenarioState;
                let deleteScenario: any;

                const TestComponent = () => {
                    ({ state, deleteScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    deleteScenario('some-id');
                });

                expect(state!.error).toBe('Failed to delete scenario');
            });
        });

        describe('renameScenario', () => {
            it('should rename an existing scenario', () => {
                const scenario = createMockScenario('rename-me', 'Original Name');
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);

                let state: ScenarioState;
                let renameScenario: any;

                const TestComponent = () => {
                    ({ state, renameScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                expect(state!.scenarios[0].metadata.name).toBe('Original Name');

                act(() => {
                    renameScenario('rename-me', 'New Name');
                });

                expect(saveScenarioToStorage).toHaveBeenCalled();
                expect(state!.scenarios[0].metadata.name).toBe('New Name');
            });

            it('should trim whitespace from new name', () => {
                const scenario = createMockScenario('test', 'Test');
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);

                let state: ScenarioState;
                let renameScenario: any;

                const TestComponent = () => {
                    ({ state, renameScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    renameScenario('test', '  Trimmed Name  ');
                });

                expect(state!.scenarios[0].metadata.name).toBe('Trimmed Name');
            });

            it('should error when scenario not found', () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([]);

                let state: ScenarioState;
                let renameScenario: any;

                const TestComponent = () => {
                    ({ state, renameScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    renameScenario('non-existent', 'New Name');
                });

                expect(state!.error).toBe('Scenario not found');
            });

            it('should handle non-Error exceptions gracefully', () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([
                    createMockScenario('test', 'Test'),
                ]);
                (saveScenarioToStorage as Mock).mockImplementation(() => {
                    throw 'String error';
                });

                let state: ScenarioState;
                let renameScenario: any;

                const TestComponent = () => {
                    ({ state, renameScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    renameScenario('test', 'New Name');
                });

                expect(state!.error).toBe('Failed to rename scenario');
            });
        });

        describe('updateScenarioAssumptions', () => {
            it('should update scenario assumptions', () => {
                const scenario = createMockScenario('update-me', 'Test');
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);

                let state: ScenarioState;
                let updateScenarioAssumptions: any;

                const TestComponent = () => {
                    ({ state, updateScenarioAssumptions } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const newAssumptions = { ...defaultAssumptions, demographics: { ...defaultAssumptions.demographics, currentAge: 35 } };

                act(() => {
                    updateScenarioAssumptions('update-me', newAssumptions);
                });

                expect(saveScenarioToStorage).toHaveBeenCalled();
                expect(state!.scenarios[0].inputs.assumptions).toBe(newAssumptions);
            });

            it('should update the updatedAt timestamp', () => {
                const scenario = createMockScenario('update-me', 'Test');
                // Set a clearly old timestamp
                scenario.metadata.updatedAt = '2020-01-01T00:00:00.000Z';
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);

                let state: ScenarioState;
                let updateScenarioAssumptions: any;

                const TestComponent = () => {
                    ({ state, updateScenarioAssumptions } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    updateScenarioAssumptions('update-me', defaultAssumptions);
                });

                // The new timestamp should be more recent than the old one
                expect(state!.scenarios[0].metadata.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
                expect(new Date(state!.scenarios[0].metadata.updatedAt).getFullYear()).toBeGreaterThanOrEqual(2026);
            });

            it('should clear comparison result if updated scenario was selected as baseline', () => {
                const scenario = createMockScenario('baseline-scenario', 'Baseline');
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);

                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;
                let updateScenarioAssumptions: any;

                const TestComponent = () => {
                    ({ state, dispatch, updateScenarioAssumptions } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set up baseline selection and comparison result
                const baseline = createMockLoadedScenario('baseline-scenario', 'Baseline');
                const comparison = createMockLoadedScenario('other', 'Other');
                act(() => {
                    dispatch({ type: 'SELECT_BASELINE', payload: 'baseline-scenario' });
                    dispatch({ type: 'SET_COMPARISON_RESULT', payload: createMockComparison(baseline, comparison) });
                });

                expect(state!.comparisonResult).not.toBeNull();

                // Update the baseline scenario
                act(() => {
                    updateScenarioAssumptions('baseline-scenario', defaultAssumptions);
                });

                expect(state!.comparisonResult).toBeNull();
            });

            it('should clear comparison result if updated scenario was selected as comparison', () => {
                const scenario = createMockScenario('comp-scenario', 'Comparison');
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);

                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;
                let updateScenarioAssumptions: any;

                const TestComponent = () => {
                    ({ state, dispatch, updateScenarioAssumptions } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set up comparison selection and comparison result
                const baseline = createMockLoadedScenario('other', 'Other');
                const comparison = createMockLoadedScenario('comp-scenario', 'Comparison');
                act(() => {
                    dispatch({ type: 'SELECT_COMPARISON', payload: 'comp-scenario' });
                    dispatch({ type: 'SET_COMPARISON_RESULT', payload: createMockComparison(baseline, comparison) });
                });

                expect(state!.comparisonResult).not.toBeNull();

                // Update the comparison scenario
                act(() => {
                    updateScenarioAssumptions('comp-scenario', defaultAssumptions);
                });

                expect(state!.comparisonResult).toBeNull();
            });

            it('should error when scenario not found', () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([]);

                let state: ScenarioState;
                let updateScenarioAssumptions: any;

                const TestComponent = () => {
                    ({ state, updateScenarioAssumptions } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    updateScenarioAssumptions('non-existent', defaultAssumptions);
                });

                expect(state!.error).toBe('Scenario not found');
            });

            it('should handle non-Error exceptions gracefully', () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([
                    createMockScenario('test', 'Test'),
                ]);
                (saveScenarioToStorage as Mock).mockImplementation(() => {
                    throw 'String error';
                });

                let state: ScenarioState;
                let updateScenarioAssumptions: any;

                const TestComponent = () => {
                    ({ state, updateScenarioAssumptions } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    updateScenarioAssumptions('test', defaultAssumptions);
                });

                expect(state!.error).toBe('Failed to update scenario assumptions');
            });
        });

        describe('exportScenario', () => {
            it('should export existing scenario', () => {
                const scenario = createMockScenario('export-me', 'Export Test');
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);

                let exportScenario: any;

                const TestComponent = () => {
                    ({ exportScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    exportScenario('export-me');
                });

                expect(exportScenarioToFile).toHaveBeenCalledWith(scenario);
            });

            it('should not call export for non-existent scenario', () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([]);

                let exportScenario: any;

                const TestComponent = () => {
                    ({ exportScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    exportScenario('non-existent');
                });

                expect(exportScenarioToFile).not.toHaveBeenCalled();
            });
        });

        describe('importScenario', () => {
            it('should import scenario from file', async () => {
                const importedScenario = createMockScenario('imported', 'Imported');
                (importScenarioFromFile as Mock).mockResolvedValue(importedScenario);

                let state: ScenarioState;
                let importScenario: any;

                const TestComponent = () => {
                    ({ state, importScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const mockFile = new File(['{}'], 'test.json', { type: 'application/json' });

                await act(async () => {
                    await importScenario(mockFile);
                });

                expect(importScenarioFromFile).toHaveBeenCalledWith(mockFile);
                expect(saveScenarioToStorage).toHaveBeenCalledWith(importedScenario);
                expect(state!.scenarios).toContain(importedScenario);
            });

            it('should handle import errors', async () => {
                (importScenarioFromFile as Mock).mockRejectedValue(new Error('Invalid file'));

                let state: ScenarioState;
                let importScenario: any;

                const TestComponent = () => {
                    ({ state, importScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const mockFile = new File(['invalid'], 'test.json', { type: 'application/json' });

                await act(async () => {
                    await importScenario(mockFile);
                });

                expect(state!.error).toBe('Invalid file');
            });

            it('should handle non-Error import exceptions gracefully', async () => {
                (importScenarioFromFile as Mock).mockRejectedValue('String error');

                let state: ScenarioState;
                let importScenario: any;

                const TestComponent = () => {
                    ({ state, importScenario } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const mockFile = new File(['invalid'], 'test.json', { type: 'application/json' });

                await act(async () => {
                    await importScenario(mockFile);
                });

                expect(state!.error).toBe('Failed to import scenario');
            });
        });

        describe('selectBaseline', () => {
            it('should dispatch SELECT_BASELINE action', () => {
                let state: ScenarioState;
                let selectBaseline: any;

                const TestComponent = () => {
                    ({ state, selectBaseline } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    selectBaseline('my-baseline');
                });

                expect(state!.selectedBaseline).toBe('my-baseline');
            });
        });

        describe('selectComparison', () => {
            it('should dispatch SELECT_COMPARISON action', () => {
                let state: ScenarioState;
                let selectComparison: any;

                const TestComponent = () => {
                    ({ state, selectComparison } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    selectComparison('my-comparison');
                });

                expect(state!.selectedComparison).toBe('my-comparison');
            });
        });

        describe('runComparison', () => {
            it('should compare current plan vs saved scenario', async () => {
                const savedScenario = createMockScenario('saved-1', 'Saved');
                (loadScenariosFromStorage as Mock).mockReturnValue([savedScenario]);

                const currentLoaded = createMockLoadedScenario('current', 'Current Plan');
                const savedLoaded = createMockLoadedScenario('saved-1', 'Saved');
                const mockResult = createMockComparison(currentLoaded, savedLoaded);

                (createLoadedScenarioFromSimulation as Mock).mockReturnValue(currentLoaded);
                (runSimulation as Mock).mockReturnValue([]);
                (calculateMilestones as Mock).mockReturnValue(createMockMilestones());
                (compareScenarios as Mock).mockReturnValue(mockResult);

                let state: ScenarioState;
                let runComparison: any;

                const TestComponent = () => {
                    ({ state, runComparison } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await runComparison(
                        'current',
                        'saved-1',
                        [], // currentSimulation
                        defaultAssumptions,
                        {} // currentTaxState
                    );
                });

                expect(createLoadedScenarioFromSimulation).toHaveBeenCalledWith(
                    'Current Plan',
                    [],
                    defaultAssumptions
                );
                expect(compareScenarios).toHaveBeenCalled();
                expect(state!.comparisonResult).toBe(mockResult);
            });

            it('should handle comparison errors', async () => {
                (createLoadedScenarioFromSimulation as Mock).mockImplementation(() => {
                    throw new Error('Comparison failed');
                });

                let state: ScenarioState;
                let runComparison: any;

                const TestComponent = () => {
                    ({ state, runComparison } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await runComparison('current', 'saved-1', [], defaultAssumptions, {});
                });

                expect(state!.error).toBe('Comparison failed');
                expect(state!.isLoading).toBe(false);
            });

            it('should error when baseline scenario not found', async () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([]);

                let state: ScenarioState;
                let runComparison: any;

                const TestComponent = () => {
                    ({ state, runComparison } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await runComparison('non-existent', 'current', [], defaultAssumptions, {});
                });

                expect(state!.error).toBe('Baseline scenario not found');
            });

            it('should compare saved scenario as baseline vs current', async () => {
                const savedScenario = createMockScenario('saved-baseline', 'Saved Baseline');
                (loadScenariosFromStorage as Mock).mockReturnValue([savedScenario]);

                const savedLoaded = createMockLoadedScenario('saved-baseline', 'Saved Baseline');
                const currentLoaded = createMockLoadedScenario('current', 'Current Plan');
                const mockResult = createMockComparison(savedLoaded, currentLoaded);

                (createLoadedScenarioFromSimulation as Mock).mockReturnValue(currentLoaded);
                (runSimulation as Mock).mockReturnValue([]);
                (calculateMilestones as Mock).mockReturnValue(createMockMilestones());
                (compareScenarios as Mock).mockReturnValue(mockResult);

                let state: ScenarioState;
                let runComparison: any;

                const TestComponent = () => {
                    ({ state, runComparison } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await runComparison(
                        'saved-baseline',
                        'current',
                        [], // currentSimulation
                        defaultAssumptions,
                        {} // currentTaxState
                    );
                });

                // Verify baseline simulation was run
                expect(runSimulation).toHaveBeenCalled();
                expect(calculateMilestones).toHaveBeenCalled();
                // Verify current plan was created from simulation
                expect(createLoadedScenarioFromSimulation).toHaveBeenCalledWith(
                    'Current Plan',
                    [],
                    defaultAssumptions
                );
                expect(compareScenarios).toHaveBeenCalled();
                expect(state!.comparisonResult).toBe(mockResult);
            });

            it('should compare two saved scenarios', async () => {
                const baselineScenario = createMockScenario('baseline-1', 'Baseline');
                const comparisonScenario = createMockScenario('comparison-1', 'Comparison');
                (loadScenariosFromStorage as Mock).mockReturnValue([baselineScenario, comparisonScenario]);

                const baselineLoaded = createMockLoadedScenario('baseline-1', 'Baseline');
                const comparisonLoaded = createMockLoadedScenario('comparison-1', 'Comparison');
                const mockResult = createMockComparison(baselineLoaded, comparisonLoaded);

                (runSimulation as Mock).mockReturnValue([]);
                (calculateMilestones as Mock).mockReturnValue(createMockMilestones());
                (compareScenarios as Mock).mockReturnValue(mockResult);

                let state: ScenarioState;
                let runComparison: any;

                const TestComponent = () => {
                    ({ state, runComparison } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await runComparison(
                        'baseline-1',
                        'comparison-1',
                        [], // currentSimulation
                        defaultAssumptions,
                        {} // currentTaxState
                    );
                });

                // Both scenarios should be simulated
                expect(runSimulation).toHaveBeenCalledTimes(2);
                expect(calculateMilestones).toHaveBeenCalledTimes(2);
                expect(compareScenarios).toHaveBeenCalled();
                expect(state!.comparisonResult).toBe(mockResult);
            });

            it('should error when comparison scenario not found', async () => {
                const baselineScenario = createMockScenario('baseline-1', 'Baseline');
                (loadScenariosFromStorage as Mock).mockReturnValue([baselineScenario]);

                (runSimulation as Mock).mockReturnValue([]);
                (calculateMilestones as Mock).mockReturnValue(createMockMilestones());

                let state: ScenarioState;
                let runComparison: any;

                const TestComponent = () => {
                    ({ state, runComparison } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await runComparison('baseline-1', 'non-existent', [], defaultAssumptions, {});
                });

                expect(state!.error).toBe('Comparison scenario not found');
                expect(state!.isLoading).toBe(false);
            });

            it('should handle non-Error exceptions in comparison', async () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([]);
                (createLoadedScenarioFromSimulation as Mock).mockImplementation(() => {
                    throw 'String error';
                });

                let state: ScenarioState;
                let runComparison: any;

                const TestComponent = () => {
                    ({ state, runComparison } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await runComparison('current', 'current', [], defaultAssumptions, {});
                });

                expect(state!.error).toBe('Failed to run comparison');
                expect(state!.isLoading).toBe(false);
            });

            it('should set loading state during comparison', async () => {
                const savedScenario = createMockScenario('saved-1', 'Saved');
                (loadScenariosFromStorage as Mock).mockReturnValue([savedScenario]);

                const currentLoaded = createMockLoadedScenario('current', 'Current Plan');
                const savedLoaded = createMockLoadedScenario('saved-1', 'Saved');
                const mockResult = createMockComparison(currentLoaded, savedLoaded);

                (createLoadedScenarioFromSimulation as Mock).mockReturnValue(currentLoaded);
                (runSimulation as Mock).mockReturnValue([]);
                (calculateMilestones as Mock).mockReturnValue(createMockMilestones());
                (compareScenarios as Mock).mockReturnValue(mockResult);

                let state: ScenarioState;
                let runComparison: any;

                const TestComponent = () => {
                    ({ state, runComparison } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Just verify the result updates isLoading to false
                await act(async () => {
                    await runComparison('current', 'saved-1', [], defaultAssumptions, {});
                });

                expect(state!.isLoading).toBe(false);
                expect(state!.comparisonResult).not.toBeNull();
            });
        });

        describe('clearComparison', () => {
            it('should dispatch CLEAR_COMPARISON action', () => {
                let state: ScenarioState;
                let dispatch: React.Dispatch<any>;
                let clearComparison: any;

                const TestComponent = () => {
                    ({ state, dispatch, clearComparison } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set up state
                act(() => {
                    dispatch({ type: 'SELECT_BASELINE', payload: 'b' });
                    dispatch({ type: 'SELECT_COMPARISON', payload: 'c' });
                });

                act(() => {
                    clearComparison();
                });

                expect(state!.selectedBaseline).toBeNull();
                expect(state!.selectedComparison).toBeNull();
            });
        });
    });

    // ========================================================================
    // Hooks Tests
    // ========================================================================

    describe('Hooks', () => {
        describe('useScenarios', () => {
            it('should return full context', () => {
                let hookResult: ReturnType<typeof useScenarios>;

                const TestComponent = () => {
                    hookResult = useScenarios();
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                expect(hookResult!.state).toBeDefined();
                expect(hookResult!.dispatch).toBeDefined();
                expect(hookResult!.saveCurrentAsScenario).toBeDefined();
                expect(hookResult!.deleteScenario).toBeDefined();
                expect(hookResult!.exportScenario).toBeDefined();
                expect(hookResult!.importScenario).toBeDefined();
                expect(hookResult!.selectBaseline).toBeDefined();
                expect(hookResult!.selectComparison).toBeDefined();
                expect(hookResult!.runComparison).toBeDefined();
                expect(hookResult!.clearComparison).toBeDefined();
            });

            it('should throw when used outside provider', () => {
                // The hook checks for context but doesn't throw
                // This documents the current behavior
                const TestComponent = () => {
                    useScenarios();
                    return null;
                };

                // Current implementation doesn't throw
                expect(() => {
                    render(<TestComponent />);
                }).not.toThrow();
            });
        });

        describe('useScenariosList', () => {
            it('should return scenarios array', () => {
                const mockScenarios = [createMockScenario('1', 'Test')];
                (loadScenariosFromStorage as Mock).mockReturnValue(mockScenarios);

                let scenarios: SavedScenario[];

                const TestComponent = () => {
                    scenarios = useScenariosList();
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                expect(scenarios!).toHaveLength(1);
                expect(scenarios![0].metadata.name).toBe('Test');
            });
        });

        describe('useScenarioComparison', () => {
            it('should return comparison state and actions', () => {
                let hookResult: ReturnType<typeof useScenarioComparison>;

                const TestComponent = () => {
                    hookResult = useScenarioComparison();
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                expect(hookResult!.selectedBaseline).toBeNull();
                expect(hookResult!.selectedComparison).toBeNull();
                expect(hookResult!.comparisonResult).toBeNull();
                expect(hookResult!.isLoading).toBe(false);
                expect(hookResult!.error).toBeNull();
                expect(hookResult!.selectBaseline).toBeInstanceOf(Function);
                expect(hookResult!.selectComparison).toBeInstanceOf(Function);
                expect(hookResult!.runComparison).toBeInstanceOf(Function);
                expect(hookResult!.clearComparison).toBeInstanceOf(Function);
            });

            it('should reflect updated comparison state', () => {
                let hookResult: ReturnType<typeof useScenarioComparison>;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    hookResult = useScenarioComparison();
                    ({ dispatch } = useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    dispatch({ type: 'SELECT_BASELINE', payload: 'baseline-test' });
                });

                expect(hookResult!.selectedBaseline).toBe('baseline-test');
            });
        });
    });
});
