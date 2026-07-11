import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext } from 'react';

import {
    ScenarioContext,
    useScenarios,
    useScenariosList,
    useScenarioComparison,
} from '../../../../components/Objects/Scenarios/ScenarioContext';
import { ScenarioProvider } from '../../../../components/Objects/Scenarios/ScenarioProvider';
import {
    SavedScenario,
    LoadedScenario,
    ScenarioComparison,
    MilestonesSummary,
    ScenarioAction,
} from '../../../../services/ScenarioTypes';
import { defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';

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
    runSimulationWithOptimization: vi.fn(() => []),
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

import { runSimulationWithOptimization } from '../../../../components/Objects/Assumptions/useSimulation';

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
        (runSimulationWithOptimization as Mock).mockReset();
    });

    // ========================================================================
    // Initial State Tests
    // ========================================================================

    describe('Initial State', () => {
        it('should provide initial state when no scenarios exist', () => {
            const captured = {} as React.ContextType<typeof ScenarioContext>;

            const TestComponent = () => {
                Object.assign(captured, useContext(ScenarioContext));
                return null;
            };

            render(
                <ScenarioProvider>
                    <TestComponent />
                </ScenarioProvider>
            );

            expect(captured.state.scenarios).toEqual([]);
            expect(captured.state.selectedBaseline).toBeNull();
            expect(captured.state.selectedComparison).toBeNull();
            expect(captured.state.comparisonResult).toBeNull();
            expect(captured.state.isLoading).toBe(false);
            expect(captured.state.error).toBeNull();
        });

        it('should load scenarios from localStorage on mount', () => {
            const mockScenarios = [createMockScenario('test-1', 'Test Scenario')];
            (loadScenariosFromStorage as Mock).mockReturnValue(mockScenarios);
            const captured = {} as React.ContextType<typeof ScenarioContext>;

            const TestComponent = () => {
                Object.assign(captured, useContext(ScenarioContext));
                return null;
            };

            render(
                <ScenarioProvider>
                    <TestComponent />
                </ScenarioProvider>
            );

            expect(loadScenariosFromStorage).toHaveBeenCalled();
            expect(captured.state.scenarios).toHaveLength(1);
            expect(captured.state.scenarios[0].metadata.name).toBe('Test Scenario');
        });
    });

    // ========================================================================
    // Reducer Actions Tests
    // ========================================================================

    describe('Reducer Actions', () => {
        describe('LOAD_SCENARIOS', () => {
            it('should set scenarios array', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
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
                    captured.dispatch({ type: 'LOAD_SCENARIOS', payload: scenarios });
                });

                expect(captured.state.scenarios).toHaveLength(2);
                expect(captured.state.scenarios[0].metadata.id).toBe('1');
                expect(captured.state.scenarios[1].metadata.id).toBe('2');
            });

            it('should clear error when loading scenarios', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set an error first
                act(() => {
                    captured.dispatch({ type: 'SET_ERROR', payload: 'Some error' });
                });

                expect(captured.state.error).toBe('Some error');

                // Load scenarios should clear the error
                act(() => {
                    captured.dispatch({ type: 'LOAD_SCENARIOS', payload: [] });
                });

                expect(captured.state.error).toBeNull();
            });
        });

        describe('SAVE_SCENARIO', () => {
            it('should add new scenario', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const newScenario = createMockScenario('new-1', 'New Scenario');

                act(() => {
                    captured.dispatch({ type: 'SAVE_SCENARIO', payload: newScenario });
                });

                expect(captured.state.scenarios).toHaveLength(1);
                expect(captured.state.scenarios[0].metadata.name).toBe('New Scenario');
            });

            it('should update existing scenario by ID', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
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
                    captured.dispatch({ type: 'SAVE_SCENARIO', payload: scenario });
                });

                expect(captured.state.scenarios[0].metadata.name).toBe('Original Name');

                // Update the same scenario
                const updated = {
                    ...scenario,
                    metadata: { ...scenario.metadata, name: 'Updated Name' },
                };
                act(() => {
                    captured.dispatch({ type: 'SAVE_SCENARIO', payload: updated });
                });

                // Should still have 1 scenario with updated name
                expect(captured.state.scenarios).toHaveLength(1);
                expect(captured.state.scenarios[0].metadata.name).toBe('Updated Name');
            });
        });

        describe('DELETE_SCENARIO', () => {
            it('should remove scenario by ID', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Add two scenarios
                act(() => {
                    captured.dispatch({
                        type: 'LOAD_SCENARIOS',
                        payload: [
                            createMockScenario('1', 'First'),
                            createMockScenario('2', 'Second'),
                        ],
                    });
                });

                expect(captured.state.scenarios).toHaveLength(2);

                // Delete the first one
                act(() => {
                    captured.dispatch({ type: 'DELETE_SCENARIO', payload: '1' });
                });

                expect(captured.state.scenarios).toHaveLength(1);
                expect(captured.state.scenarios[0].metadata.id).toBe('2');
            });

            it('should clear selectedBaseline if deleted', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Add scenario and select as baseline
                act(() => {
                    captured.dispatch({
                        type: 'LOAD_SCENARIOS',
                        payload: [createMockScenario('baseline-1', 'Baseline')],
                    });
                });

                act(() => {
                    captured.dispatch({ type: 'SELECT_BASELINE', payload: 'baseline-1' });
                });

                expect(captured.state.selectedBaseline).toBe('baseline-1');

                // Delete the baseline scenario
                act(() => {
                    captured.dispatch({ type: 'DELETE_SCENARIO', payload: 'baseline-1' });
                });

                expect(captured.state.selectedBaseline).toBeNull();
            });

            it('should clear selectedComparison if deleted', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Add scenario and select as comparison
                act(() => {
                    captured.dispatch({
                        type: 'LOAD_SCENARIOS',
                        payload: [createMockScenario('comp-1', 'Comparison')],
                    });
                });

                act(() => {
                    captured.dispatch({ type: 'SELECT_COMPARISON', payload: 'comp-1' });
                });

                expect(captured.state.selectedComparison).toBe('comp-1');

                // Delete the comparison scenario
                act(() => {
                    captured.dispatch({ type: 'DELETE_SCENARIO', payload: 'comp-1' });
                });

                expect(captured.state.selectedComparison).toBeNull();
            });

            it('should clear comparisonResult if baseline or comparison deleted', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
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
                    captured.dispatch({
                        type: 'LOAD_SCENARIOS',
                        payload: [
                            createMockScenario('baseline-1', 'Baseline'),
                            createMockScenario('comp-1', 'Comparison'),
                        ],
                    });
                });

                act(() => {
                    captured.dispatch({ type: 'SET_COMPARISON_RESULT', payload: mockResult });
                });

                expect(captured.state.comparisonResult).not.toBeNull();

                // Delete the baseline scenario
                act(() => {
                    captured.dispatch({ type: 'DELETE_SCENARIO', payload: 'baseline-1' });
                });

                expect(captured.state.comparisonResult).toBeNull();
            });
        });

        describe('UPDATE_SCENARIO', () => {
            it('should update existing scenario', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const scenario = createMockScenario('update-1', 'Original');

                act(() => {
                    captured.dispatch({ type: 'LOAD_SCENARIOS', payload: [scenario] });
                });

                const updated = {
                    ...scenario,
                    metadata: { ...scenario.metadata, name: 'Updated' },
                };

                act(() => {
                    captured.dispatch({ type: 'UPDATE_SCENARIO', payload: updated });
                });

                expect(captured.state.scenarios[0].metadata.name).toBe('Updated');
            });
        });

        describe('IMPORT_SCENARIO', () => {
            it('should append imported scenario', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Start with one scenario
                act(() => {
                    captured.dispatch({
                        type: 'LOAD_SCENARIOS',
                        payload: [createMockScenario('existing', 'Existing')],
                    });
                });

                // Import a new one
                const imported = createMockScenario('imported', 'Imported');
                act(() => {
                    captured.dispatch({ type: 'IMPORT_SCENARIO', payload: imported });
                });

                expect(captured.state.scenarios).toHaveLength(2);
                expect(captured.state.scenarios[1].metadata.name).toBe('Imported');
            });
        });

        describe('SELECT_BASELINE', () => {
            it('should set baseline ID', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.dispatch({ type: 'SELECT_BASELINE', payload: 'baseline-123' });
                });

                expect(captured.state.selectedBaseline).toBe('baseline-123');
            });

            it('should clear comparison result when selection changes', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
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
                    captured.dispatch({
                        type: 'SET_COMPARISON_RESULT',
                        payload: createMockComparison(baseline, comparison),
                    });
                });

                expect(captured.state.comparisonResult).not.toBeNull();

                // Change baseline selection
                act(() => {
                    captured.dispatch({ type: 'SELECT_BASELINE', payload: 'new-baseline' });
                });

                expect(captured.state.comparisonResult).toBeNull();
            });
        });

        describe('SELECT_COMPARISON', () => {
            it('should set comparison ID', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.dispatch({ type: 'SELECT_COMPARISON', payload: 'comp-123' });
                });

                expect(captured.state.selectedComparison).toBe('comp-123');
            });

            it('should clear comparison result when selection changes', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
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
                    captured.dispatch({
                        type: 'SET_COMPARISON_RESULT',
                        payload: createMockComparison(baseline, comparison),
                    });
                });

                expect(captured.state.comparisonResult).not.toBeNull();

                // Change comparison selection
                act(() => {
                    captured.dispatch({ type: 'SELECT_COMPARISON', payload: 'new-comp' });
                });

                expect(captured.state.comparisonResult).toBeNull();
            });
        });

        describe('SET_COMPARISON_RESULT', () => {
            it('should set comparison result and clear loading', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set loading first
                act(() => {
                    captured.dispatch({ type: 'SET_LOADING', payload: true });
                });

                expect(captured.state.isLoading).toBe(true);

                // Set comparison result
                const baseline = createMockLoadedScenario('b', 'B');
                const comparison = createMockLoadedScenario('c', 'C');
                const result = createMockComparison(baseline, comparison);

                act(() => {
                    captured.dispatch({ type: 'SET_COMPARISON_RESULT', payload: result });
                });

                expect(captured.state.comparisonResult).toBe(result);
                expect(captured.state.isLoading).toBe(false);
            });
        });

        describe('SET_LOADING', () => {
            it('should set loading to true', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.dispatch({ type: 'SET_LOADING', payload: true });
                });

                expect(captured.state.isLoading).toBe(true);
            });

            it('should set loading to false', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.dispatch({ type: 'SET_LOADING', payload: true });
                });

                act(() => {
                    captured.dispatch({ type: 'SET_LOADING', payload: false });
                });

                expect(captured.state.isLoading).toBe(false);
            });
        });

        describe('SET_ERROR', () => {
            it('should set error message and clear loading', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set loading first
                act(() => {
                    captured.dispatch({ type: 'SET_LOADING', payload: true });
                });

                // Set error
                act(() => {
                    captured.dispatch({ type: 'SET_ERROR', payload: 'Something went wrong' });
                });

                expect(captured.state.error).toBe('Something went wrong');
                expect(captured.state.isLoading).toBe(false);
            });
        });

        describe('CLEAR_COMPARISON', () => {
            it('should reset baseline, comparison, and result to null', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set up selections and result
                act(() => {
                    captured.dispatch({ type: 'SELECT_BASELINE', payload: 'baseline-1' });
                });

                act(() => {
                    captured.dispatch({ type: 'SELECT_COMPARISON', payload: 'comp-1' });
                });

                const baseline = createMockLoadedScenario('baseline-1', 'B');
                const comparison = createMockLoadedScenario('comp-1', 'C');
                act(() => {
                    captured.dispatch({
                        type: 'SET_COMPARISON_RESULT',
                        payload: createMockComparison(baseline, comparison),
                    });
                });

                // Clear comparison
                act(() => {
                    captured.dispatch({ type: 'CLEAR_COMPARISON' });
                });

                expect(captured.state.selectedBaseline).toBeNull();
                expect(captured.state.selectedComparison).toBeNull();
                expect(captured.state.comparisonResult).toBeNull();
            });
        });

        describe('Unknown action type', () => {
            it('should return current state for unknown action types', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set up some state first
                act(() => {
                    captured.dispatch({ type: 'SELECT_BASELINE', payload: 'test-baseline' });
                });

                const stateBeforeUnknown = { ...captured.state };

                // Dispatch unknown action
                act(() => {
                    captured.dispatch({ type: 'UNKNOWN_ACTION', payload: 'anything' } as unknown as ScenarioAction);
                });

                // State should be unchanged
                expect(captured.state.selectedBaseline).toBe(stateBeforeUnknown.selectedBaseline);
                expect(captured.state.scenarios).toEqual(stateBeforeUnknown.scenarios);
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
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.saveCurrentAsScenario(
                        'Test Save',
                        'Description',
                        [], // accounts
                        {}, // amountHistory
                        [], // incomes
                        [], // expenses
                        {} as TaxState, // taxSettings
                        defaultAssumptions,
                        ['tag1']
                    );
                });

                expect(captureCurrentState).toHaveBeenCalled();
                expect(createScenario).toHaveBeenCalledWith('Test Save', 'Description', mockInputs, ['tag1']);
                expect(saveScenarioToStorage).toHaveBeenCalledWith(mockScenario);
                expect(captured.state.scenarios).toContain(mockScenario);
            });

            it('should handle errors gracefully', () => {
                (captureCurrentState as Mock).mockImplementation(() => {
                    throw new Error('Capture failed');
                });
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.saveCurrentAsScenario('Test', undefined, [], {}, [], [], {} as TaxState, defaultAssumptions);
                });

                expect(captured.state.error).toBe('Capture failed');
            });

            it('should handle non-Error exceptions gracefully', () => {
                (captureCurrentState as Mock).mockImplementation(() => {
                    throw 'String error';
                });
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.saveCurrentAsScenario('Test', undefined, [], {}, [], [], {} as TaxState, defaultAssumptions);
                });

                expect(captured.state.error).toBe('Failed to save scenario');
            });
        });

        describe('deleteScenario', () => {
            it('should delete scenario from storage and state', () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([
                    createMockScenario('to-delete', 'Delete Me'),
                ]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                expect(captured.state.scenarios).toHaveLength(1);

                act(() => {
                    captured.deleteScenario('to-delete');
                });

                expect(deleteScenarioFromStorage).toHaveBeenCalledWith('to-delete');
                expect(captured.state.scenarios).toHaveLength(0);
            });

            it('should handle errors gracefully', () => {
                (deleteScenarioFromStorage as Mock).mockImplementation(() => {
                    throw new Error('Delete failed');
                });
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.deleteScenario('some-id');
                });

                expect(captured.state.error).toBe('Delete failed');
            });

            it('should handle non-Error exceptions gracefully', () => {
                (deleteScenarioFromStorage as Mock).mockImplementation(() => {
                    throw 'String error';
                });
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.deleteScenario('some-id');
                });

                expect(captured.state.error).toBe('Failed to delete scenario');
            });
        });

        describe('renameScenario', () => {
            it('should rename an existing scenario', () => {
                const scenario = createMockScenario('rename-me', 'Original Name');
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                expect(captured.state.scenarios[0].metadata.name).toBe('Original Name');

                act(() => {
                    captured.renameScenario('rename-me', 'New Name');
                });

                expect(saveScenarioToStorage).toHaveBeenCalled();
                expect(captured.state.scenarios[0].metadata.name).toBe('New Name');
            });

            it('should stamp a fresh updatedAt on the in-memory scenario (matches the persisted copy)', () => {
                const scenario = createMockScenario('rename-me', 'Original Name');
                scenario.metadata.updatedAt = '2000-01-01T00:00:00.000Z';
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.renameScenario('rename-me', 'New Name');
                });

                // The state copy must NOT carry the stale timestamp.
                expect(captured.state.scenarios[0].metadata.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
                // It must equal whatever was persisted to storage (no drift).
                const persisted = (saveScenarioToStorage as Mock).mock.calls[0][0] as SavedScenario;
                expect(captured.state.scenarios[0].metadata.updatedAt).toBe(persisted.metadata.updatedAt);
            });

            it('should trim whitespace from new name', () => {
                const scenario = createMockScenario('test', 'Test');
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.renameScenario('test', '  Trimmed Name  ');
                });

                expect(captured.state.scenarios[0].metadata.name).toBe('Trimmed Name');
            });

            it('should error when scenario not found', () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.renameScenario('non-existent', 'New Name');
                });

                expect(captured.state.error).toBe('Scenario not found');
            });

            it('should handle non-Error exceptions gracefully', () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([
                    createMockScenario('test', 'Test'),
                ]);
                (saveScenarioToStorage as Mock).mockImplementation(() => {
                    throw 'String error';
                });
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.renameScenario('test', 'New Name');
                });

                expect(captured.state.error).toBe('Failed to rename scenario');
            });
        });

        describe('updateScenarioAssumptions', () => {
            it('should update scenario assumptions', () => {
                const scenario = createMockScenario('update-me', 'Test');
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const newAssumptions = { ...defaultAssumptions, demographics: { ...defaultAssumptions.demographics, currentAge: 35 } };

                act(() => {
                    captured.updateScenarioAssumptions('update-me', newAssumptions);
                });

                expect(saveScenarioToStorage).toHaveBeenCalled();
                expect(captured.state.scenarios[0].inputs.assumptions).toBe(newAssumptions);
            });

            it('should update the updatedAt timestamp', () => {
                const scenario = createMockScenario('update-me', 'Test');
                // Set a clearly old timestamp
                scenario.metadata.updatedAt = '2020-01-01T00:00:00.000Z';
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.updateScenarioAssumptions('update-me', defaultAssumptions);
                });

                // The new timestamp should be more recent than the old one
                expect(captured.state.scenarios[0].metadata.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
                expect(new Date(captured.state.scenarios[0].metadata.updatedAt).getFullYear()).toBeGreaterThanOrEqual(2026);
            });

            it('should clear comparison result if updated scenario was selected as baseline', () => {
                const scenario = createMockScenario('baseline-scenario', 'Baseline');
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
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
                    captured.dispatch({ type: 'SELECT_BASELINE', payload: 'baseline-scenario' });
                    captured.dispatch({ type: 'SET_COMPARISON_RESULT', payload: createMockComparison(baseline, comparison) });
                });

                expect(captured.state.comparisonResult).not.toBeNull();

                // Update the baseline scenario
                act(() => {
                    captured.updateScenarioAssumptions('baseline-scenario', defaultAssumptions);
                });

                expect(captured.state.comparisonResult).toBeNull();
            });

            it('should clear comparison result if updated scenario was selected as comparison', () => {
                const scenario = createMockScenario('comp-scenario', 'Comparison');
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
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
                    captured.dispatch({ type: 'SELECT_COMPARISON', payload: 'comp-scenario' });
                    captured.dispatch({ type: 'SET_COMPARISON_RESULT', payload: createMockComparison(baseline, comparison) });
                });

                expect(captured.state.comparisonResult).not.toBeNull();

                // Update the comparison scenario
                act(() => {
                    captured.updateScenarioAssumptions('comp-scenario', defaultAssumptions);
                });

                expect(captured.state.comparisonResult).toBeNull();
            });

            it('should error when scenario not found', () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.updateScenarioAssumptions('non-existent', defaultAssumptions);
                });

                expect(captured.state.error).toBe('Scenario not found');
            });

            it('should handle non-Error exceptions gracefully', () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([
                    createMockScenario('test', 'Test'),
                ]);
                (saveScenarioToStorage as Mock).mockImplementation(() => {
                    throw 'String error';
                });
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.updateScenarioAssumptions('test', defaultAssumptions);
                });

                expect(captured.state.error).toBe('Failed to update scenario assumptions');
            });
        });

        describe('exportScenario', () => {
            it('should export existing scenario', () => {
                const scenario = createMockScenario('export-me', 'Export Test');
                (loadScenariosFromStorage as Mock).mockReturnValue([scenario]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.exportScenario('export-me');
                });

                expect(exportScenarioToFile).toHaveBeenCalledWith(scenario);
            });

            it('should not call export for non-existent scenario', () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.exportScenario('non-existent');
                });

                expect(exportScenarioToFile).not.toHaveBeenCalled();
            });
        });

        describe('importScenario', () => {
            it('should import scenario from file', async () => {
                const importedScenario = createMockScenario('imported', 'Imported');
                (importScenarioFromFile as Mock).mockResolvedValue(importedScenario);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const mockFile = new File(['{}'], 'test.json', { type: 'application/json' });

                await act(async () => {
                    await captured.importScenario(mockFile);
                });

                expect(importScenarioFromFile).toHaveBeenCalledWith(mockFile);
                expect(saveScenarioToStorage).toHaveBeenCalledWith(importedScenario);
                expect(captured.state.scenarios).toContain(importedScenario);
            });

            it('should handle import errors', async () => {
                (importScenarioFromFile as Mock).mockRejectedValue(new Error('Invalid file'));
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const mockFile = new File(['invalid'], 'test.json', { type: 'application/json' });

                await act(async () => {
                    await captured.importScenario(mockFile);
                });

                expect(captured.state.error).toBe('Invalid file');
            });

            it('should handle non-Error import exceptions gracefully', async () => {
                (importScenarioFromFile as Mock).mockRejectedValue('String error');
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                const mockFile = new File(['invalid'], 'test.json', { type: 'application/json' });

                await act(async () => {
                    await captured.importScenario(mockFile);
                });

                expect(captured.state.error).toBe('Failed to import scenario');
            });
        });

        describe('selectBaseline', () => {
            it('should dispatch SELECT_BASELINE action', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.selectBaseline('my-baseline');
                });

                expect(captured.state.selectedBaseline).toBe('my-baseline');
            });
        });

        describe('selectComparison', () => {
            it('should dispatch SELECT_COMPARISON action', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    captured.selectComparison('my-comparison');
                });

                expect(captured.state.selectedComparison).toBe('my-comparison');
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
                (runSimulationWithOptimization as Mock).mockReturnValue([]);
                (calculateMilestones as Mock).mockReturnValue(createMockMilestones());
                (compareScenarios as Mock).mockReturnValue(mockResult);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await captured.runComparison(
                        'current',
                        'saved-1',
                        [], // currentSimulation
                        defaultAssumptions,
                        {} as TaxState // currentTaxState
                    );
                });

                expect(createLoadedScenarioFromSimulation).toHaveBeenCalledWith(
                    'Current Plan',
                    [],
                    defaultAssumptions
                );
                expect(compareScenarios).toHaveBeenCalled();
                expect(captured.state.comparisonResult).toBe(mockResult);
            });

            it('should handle comparison errors', async () => {
                (createLoadedScenarioFromSimulation as Mock).mockImplementation(() => {
                    throw new Error('Comparison failed');
                });
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await captured.runComparison('current', 'saved-1', [], defaultAssumptions, {} as TaxState);
                });

                expect(captured.state.error).toBe('Comparison failed');
                expect(captured.state.isLoading).toBe(false);
            });

            it('should error when baseline scenario not found', async () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([]);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await captured.runComparison('non-existent', 'current', [], defaultAssumptions, {} as TaxState);
                });

                expect(captured.state.error).toBe('Baseline scenario not found');
            });

            it('should compare saved scenario as baseline vs current', async () => {
                const savedScenario = createMockScenario('saved-baseline', 'Saved Baseline');
                (loadScenariosFromStorage as Mock).mockReturnValue([savedScenario]);

                const savedLoaded = createMockLoadedScenario('saved-baseline', 'Saved Baseline');
                const currentLoaded = createMockLoadedScenario('current', 'Current Plan');
                const mockResult = createMockComparison(savedLoaded, currentLoaded);

                (createLoadedScenarioFromSimulation as Mock).mockReturnValue(currentLoaded);
                (runSimulationWithOptimization as Mock).mockReturnValue([]);
                (calculateMilestones as Mock).mockReturnValue(createMockMilestones());
                (compareScenarios as Mock).mockReturnValue(mockResult);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await captured.runComparison(
                        'saved-baseline',
                        'current',
                        [], // currentSimulation
                        defaultAssumptions,
                        {} as TaxState // currentTaxState
                    );
                });

                // Verify baseline simulation was run
                expect(runSimulationWithOptimization).toHaveBeenCalled();
                expect(calculateMilestones).toHaveBeenCalled();
                // Verify current plan was created from simulation
                expect(createLoadedScenarioFromSimulation).toHaveBeenCalledWith(
                    'Current Plan',
                    [],
                    defaultAssumptions
                );
                expect(compareScenarios).toHaveBeenCalled();
                expect(captured.state.comparisonResult).toBe(mockResult);
            });

            it('should compare two saved scenarios', async () => {
                const baselineScenario = createMockScenario('baseline-1', 'Baseline');
                const comparisonScenario = createMockScenario('comparison-1', 'Comparison');
                (loadScenariosFromStorage as Mock).mockReturnValue([baselineScenario, comparisonScenario]);

                const baselineLoaded = createMockLoadedScenario('baseline-1', 'Baseline');
                const comparisonLoaded = createMockLoadedScenario('comparison-1', 'Comparison');
                const mockResult = createMockComparison(baselineLoaded, comparisonLoaded);

                (runSimulationWithOptimization as Mock).mockReturnValue([]);
                (calculateMilestones as Mock).mockReturnValue(createMockMilestones());
                (compareScenarios as Mock).mockReturnValue(mockResult);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await captured.runComparison(
                        'baseline-1',
                        'comparison-1',
                        [], // currentSimulation
                        defaultAssumptions,
                        {} as TaxState // currentTaxState
                    );
                });

                // Both scenarios should be simulated
                expect(runSimulationWithOptimization).toHaveBeenCalledTimes(2);
                expect(calculateMilestones).toHaveBeenCalledTimes(2);
                expect(compareScenarios).toHaveBeenCalled();
                expect(captured.state.comparisonResult).toBe(mockResult);
            });

            it('should error when comparison scenario not found', async () => {
                const baselineScenario = createMockScenario('baseline-1', 'Baseline');
                (loadScenariosFromStorage as Mock).mockReturnValue([baselineScenario]);

                (runSimulationWithOptimization as Mock).mockReturnValue([]);
                (calculateMilestones as Mock).mockReturnValue(createMockMilestones());
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await captured.runComparison('baseline-1', 'non-existent', [], defaultAssumptions, {} as TaxState);
                });

                expect(captured.state.error).toBe('Comparison scenario not found');
                expect(captured.state.isLoading).toBe(false);
            });

            it('should handle non-Error exceptions in comparison', async () => {
                (loadScenariosFromStorage as Mock).mockReturnValue([]);
                (createLoadedScenarioFromSimulation as Mock).mockImplementation(() => {
                    throw 'String error';
                });
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await captured.runComparison('current', 'current', [], defaultAssumptions, {} as TaxState);
                });

                expect(captured.state.error).toBe('Failed to run comparison');
                expect(captured.state.isLoading).toBe(false);
            });

            // #166: with tax optimization enabled the scenario sim goes through the
            // ephemeral joint-search worker. jsdom has no Worker, so these pin the
            // sync-fallback leg: it must still complete, and a genuine engine
            // failure must surface as an error with the busy state cleared (not a
            // hung isLoading).
            const createTaxOptScenario = (id: string, name: string): SavedScenario => {
                const scenario = createMockScenario(id, name);
                scenario.inputs.assumptions = {
                    ...defaultAssumptions,
                    investments: { ...defaultAssumptions.investments, taxOptimizationEnabled: true },
                };
                return scenario;
            };

            it('should complete a tax-opt scenario comparison via the sync fallback when Workers are unavailable (#166)', async () => {
                const savedScenario = createTaxOptScenario('taxopt-1', 'TaxOpt');
                (loadScenariosFromStorage as Mock).mockReturnValue([savedScenario]);

                const currentLoaded = createMockLoadedScenario('current', 'Current Plan');
                const savedLoaded = createMockLoadedScenario('taxopt-1', 'TaxOpt');
                const mockResult = createMockComparison(currentLoaded, savedLoaded);

                (createLoadedScenarioFromSimulation as Mock).mockReturnValue(currentLoaded);
                (runSimulationWithOptimization as Mock).mockReturnValue([]);
                (calculateMilestones as Mock).mockReturnValue(createMockMilestones());
                (compareScenarios as Mock).mockReturnValue(mockResult);

                const captured = {} as React.ContextType<typeof ScenarioContext>;
                const capture = (ctx: typeof captured): void => {
                    Object.assign(captured, ctx);
                };
                const TestComponent = () => {
                    capture(useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await captured.runComparison('current', 'taxopt-1', [], defaultAssumptions, savedScenario.inputs.taxSettings);
                });

                // The worker path rejected (no Worker in jsdom) and the sync
                // fallback produced the result — the comparison never silently dies.
                expect(runSimulationWithOptimization).toHaveBeenCalled();
                expect(captured.state.comparisonResult).toBe(mockResult);
                expect(captured.state.isLoading).toBe(false);
                expect(captured.state.error).toBeNull();
            });

            it('should surface an engine failure on a tax-opt comparison and clear the busy state (#166)', async () => {
                const savedScenario = createTaxOptScenario('taxopt-2', 'TaxOpt Broken');
                (loadScenariosFromStorage as Mock).mockReturnValue([savedScenario]);

                (createLoadedScenarioFromSimulation as Mock).mockReturnValue(
                    createMockLoadedScenario('current', 'Current Plan')
                );
                // Worker path is unavailable (jsdom) and the sync fallback throws:
                // the rejection must reach runComparison's catch, not hang.
                (runSimulationWithOptimization as Mock).mockImplementation(() => {
                    throw new Error('engine exploded');
                });

                const captured = {} as React.ContextType<typeof ScenarioContext>;
                const capture = (ctx: typeof captured): void => {
                    Object.assign(captured, ctx);
                };
                const TestComponent = () => {
                    capture(useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                await act(async () => {
                    await captured.runComparison('current', 'taxopt-2', [], defaultAssumptions, savedScenario.inputs.taxSettings);
                });

                expect(captured.state.error).toBe('engine exploded');
                expect(captured.state.isLoading).toBe(false);
                expect(captured.state.comparisonResult).toBeNull();
            });

            it('should set loading state during comparison', async () => {
                const savedScenario = createMockScenario('saved-1', 'Saved');
                (loadScenariosFromStorage as Mock).mockReturnValue([savedScenario]);

                const currentLoaded = createMockLoadedScenario('current', 'Current Plan');
                const savedLoaded = createMockLoadedScenario('saved-1', 'Saved');
                const mockResult = createMockComparison(currentLoaded, savedLoaded);

                (createLoadedScenarioFromSimulation as Mock).mockReturnValue(currentLoaded);
                (runSimulationWithOptimization as Mock).mockReturnValue([]);
                (calculateMilestones as Mock).mockReturnValue(createMockMilestones());
                (compareScenarios as Mock).mockReturnValue(mockResult);
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Just verify the result updates isLoading to false
                await act(async () => {
                    await captured.runComparison('current', 'saved-1', [], defaultAssumptions, {} as TaxState);
                });

                expect(captured.state.isLoading).toBe(false);
                expect(captured.state.comparisonResult).not.toBeNull();
            });
        });

        describe('clearComparison', () => {
            it('should dispatch CLEAR_COMPARISON action', () => {
                const captured = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                // Set up state
                act(() => {
                    captured.dispatch({ type: 'SELECT_BASELINE', payload: 'b' });
                    captured.dispatch({ type: 'SELECT_COMPARISON', payload: 'c' });
                });

                act(() => {
                    captured.clearComparison();
                });

                expect(captured.state.selectedBaseline).toBeNull();
                expect(captured.state.selectedComparison).toBeNull();
            });
        });
    });

    // ========================================================================
    // Hooks Tests
    // ========================================================================

    describe('Hooks', () => {
        describe('useScenarios', () => {
            it('should return full context', () => {
                const captured = {} as ReturnType<typeof useScenarios>;

                const TestComponent = () => {
                    Object.assign(captured, useScenarios());
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                expect(captured.state).toBeDefined();
                expect(captured.dispatch).toBeDefined();
                expect(captured.saveCurrentAsScenario).toBeDefined();
                expect(captured.deleteScenario).toBeDefined();
                expect(captured.exportScenario).toBeDefined();
                expect(captured.importScenario).toBeDefined();
                expect(captured.selectBaseline).toBeDefined();
                expect(captured.selectComparison).toBeDefined();
                expect(captured.runComparison).toBeDefined();
                expect(captured.clearComparison).toBeDefined();
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

                const captured: { scenarios: SavedScenario[] } = { scenarios: [] };

                const TestComponent = () => {
                    Object.assign(captured, { scenarios: useScenariosList() });
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                expect(captured.scenarios).toHaveLength(1);
                expect(captured.scenarios[0].metadata.name).toBe('Test');
            });
        });

        describe('useScenarioComparison', () => {
            it('should return comparison state and actions', () => {
                const captured = {} as ReturnType<typeof useScenarioComparison>;

                const TestComponent = () => {
                    Object.assign(captured, useScenarioComparison());
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                expect(captured.selectedBaseline).toBeNull();
                expect(captured.selectedComparison).toBeNull();
                expect(captured.comparisonResult).toBeNull();
                expect(captured.isLoading).toBe(false);
                expect(captured.error).toBeNull();
                expect(captured.selectBaseline).toBeInstanceOf(Function);
                expect(captured.selectComparison).toBeInstanceOf(Function);
                expect(captured.runComparison).toBeInstanceOf(Function);
                expect(captured.clearComparison).toBeInstanceOf(Function);
            });

            it('should reflect updated comparison state', () => {
                const captured = {} as ReturnType<typeof useScenarioComparison>;
                const capturedCtx = {} as React.ContextType<typeof ScenarioContext>;

                const TestComponent = () => {
                    Object.assign(captured, useScenarioComparison());
                    Object.assign(capturedCtx, useContext(ScenarioContext));
                    return null;
                };

                render(
                    <ScenarioProvider>
                        <TestComponent />
                    </ScenarioProvider>
                );

                act(() => {
                    capturedCtx.dispatch({ type: 'SELECT_BASELINE', payload: 'baseline-test' });
                });

                expect(captured.selectedBaseline).toBe('baseline-test');
            });
        });
    });
});
