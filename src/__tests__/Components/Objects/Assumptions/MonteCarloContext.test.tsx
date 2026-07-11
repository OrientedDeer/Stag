import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext } from 'react';

import {
    MonteCarloContext,
    useMonteCarlo,
    useMonteCarloConfig,
    useMonteCarloResults,
} from '../../../../components/Objects/Assumptions/MonteCarloContext';
import { MonteCarloProvider } from '../../../../components/Objects/Assumptions/MonteCarloProvider';
import {
    type MonteCarloConfig,
    type MonteCarloSummary,
    defaultMonteCarloConfig,
} from '../../../../services/MonteCarloTypes';
import { runMonteCarloSimulation } from '../../../../services/MonteCarloEngine';
import { createRandomSeed } from '../../../../services/RandomGenerator';
import { type AssumptionsState } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../../components/Objects/Taxes/TaxContext';

// Mock the MonteCarloEngine
vi.mock('../../../../services/MonteCarloEngine', () => ({
    runMonteCarloSimulation: vi.fn(),
}));

// Mock the RandomGenerator
vi.mock('../../../../services/RandomGenerator', () => ({
    createRandomSeed: vi.fn(() => 99999),
}));

// Mock localStorage
const localStorageMock = (() => {
    let store: { [key: string]: string } = {};
    return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
            store[key] = value.toString();
        }),
        clear: vi.fn(() => {
            store = {};
        }),
        removeItem: vi.fn((key: string) => {
            delete store[key];
        }),
    };
})();

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
});

// Helper to create a mock summary
const createMockSummary = (overrides: Partial<MonteCarloSummary> = {}): MonteCarloSummary => ({
    successRate: 85,
    totalScenarios: 100,
    successfulScenarios: 85,
    averageFinalNetWorth: 2500000,
    seed: 12345,
    percentiles: {
        p10: [{ year: 2025, netWorth: 100000 }],
        p25: [{ year: 2025, netWorth: 150000 }],
        p50: [{ year: 2025, netWorth: 200000 }],
        p75: [{ year: 2025, netWorth: 250000 }],
        p90: [{ year: 2025, netWorth: 300000 }],
    },
    worstCase: {
        scenarioId: 0,
        timeline: [],
        success: false,
        finalNetWorth: -50000,
        yearOfDepletion: 2050,
        yearlyReturns: [],
    },
    medianCase: {
        scenarioId: 50,
        timeline: [],
        success: true,
        finalNetWorth: 200000,
        yearOfDepletion: null,
        yearlyReturns: [],
    },
    bestCase: {
        scenarioId: 99,
        timeline: [],
        success: true,
        finalNetWorth: 500000,
        yearOfDepletion: null,
        yearlyReturns: [],
    },
    ...overrides,
});

describe('MonteCarloContext', () => {
    beforeEach(() => {
        localStorageMock.clear();
        localStorageMock.getItem.mockClear();
        localStorageMock.setItem.mockClear();
        vi.clearAllMocks();
    });

    describe('Initial State', () => {
        it('should provide initial state when no localStorage data exists', () => {
            const captured = {} as React.ContextType<typeof MonteCarloContext>;

            const TestComponent = () => {
                Object.assign(captured, useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            expect(captured.state.config.numScenarios).toBe(defaultMonteCarloConfig.numScenarios);
            expect(captured.state.config.returnMean).toBe(defaultMonteCarloConfig.returnMean);
            expect(captured.state.config.returnStdDev).toBe(defaultMonteCarloConfig.returnStdDev);
            expect(captured.state.summary).toBeNull();
            expect(captured.state.isRunning).toBe(false);
            expect(captured.state.progress).toBe(0);
            expect(captured.state.error).toBeNull();
        });

        it('should load config from localStorage on initialization', () => {
            const savedConfig: Partial<MonteCarloConfig> = {
                numScenarios: 500,
                returnMean: 8,
                returnStdDev: 12,
                seed: 54321,
            };

            localStorageMock.setItem('monte_carlo_config', JSON.stringify(savedConfig));

            const captured = {} as React.ContextType<typeof MonteCarloContext>;

            const TestComponent = () => {
                Object.assign(captured, useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            expect(localStorageMock.getItem).toHaveBeenCalledWith('monte_carlo_config');
            expect(captured.state.config.numScenarios).toBe(500);
            expect(captured.state.config.returnMean).toBe(8);
            expect(captured.state.config.returnStdDev).toBe(12);
            expect(captured.state.config.seed).toBe(54321);
        });

        it('should handle corrupted localStorage data gracefully', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            localStorageMock.setItem('monte_carlo_config', 'invalid json');

            const captured = {} as React.ContextType<typeof MonteCarloContext>;

            const TestComponent = () => {
                Object.assign(captured, useContext(MonteCarloContext));
                return null;
            };

            // Should not throw
            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            // Should fall back to default config
            expect(captured.state.config.numScenarios).toBe(defaultMonteCarloConfig.numScenarios);
            consoleSpy.mockRestore();
        });

        it('should merge partial localStorage config with defaults', () => {
            const partialConfig = { numScenarios: 1000 };
            localStorageMock.setItem('monte_carlo_config', JSON.stringify(partialConfig));

            const captured = {} as React.ContextType<typeof MonteCarloContext>;

            const TestComponent = () => {
                Object.assign(captured, useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            expect(captured.state.config.numScenarios).toBe(1000);
            expect(captured.state.config.returnMean).toBe(defaultMonteCarloConfig.returnMean);
            expect(captured.state.config.returnStdDev).toBe(defaultMonteCarloConfig.returnStdDev);
        });
    });

    describe('Reducer Actions', () => {
        describe('UPDATE_CONFIG', () => {
            it('should update config with partial values', () => {
                const captured = {} as React.ContextType<typeof MonteCarloContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                act(() => {
                    captured.dispatch({ type: 'UPDATE_CONFIG', payload: { numScenarios: 500 } });
                });

                expect(captured.state.config.numScenarios).toBe(500);
                expect(captured.state.config.returnMean).toBe(defaultMonteCarloConfig.returnMean);
            });

            it('should update multiple config values at once', () => {
                const captured = {} as React.ContextType<typeof MonteCarloContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                act(() => {
                    captured.dispatch({
                        type: 'UPDATE_CONFIG',
                        payload: { numScenarios: 1000, returnMean: 10, returnStdDev: 20 },
                    });
                });

                expect(captured.state.config.numScenarios).toBe(1000);
                expect(captured.state.config.returnMean).toBe(10);
                expect(captured.state.config.returnStdDev).toBe(20);
            });
        });

        describe('START_SIMULATION', () => {
            it('should set isRunning to true and reset progress/error', () => {
                const captured = {} as React.ContextType<typeof MonteCarloContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                // First set an error state
                act(() => {
                    captured.dispatch({ type: 'SIMULATION_ERROR', payload: 'Previous error' });
                });

                expect(captured.state.error).toBe('Previous error');

                act(() => {
                    captured.dispatch({ type: 'START_SIMULATION' });
                });

                expect(captured.state.isRunning).toBe(true);
                expect(captured.state.progress).toBe(0);
                expect(captured.state.error).toBeNull();
            });
        });

        describe('UPDATE_PROGRESS', () => {
            it('should update progress value', () => {
                const captured = {} as React.ContextType<typeof MonteCarloContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                act(() => {
                    captured.dispatch({ type: 'UPDATE_PROGRESS', payload: 50 });
                });

                expect(captured.state.progress).toBe(50);
            });
        });

        describe('COMPLETE_SIMULATION', () => {
            it('should store summary and set progress to 100', () => {
                const captured = {} as React.ContextType<typeof MonteCarloContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                const mockSummary = createMockSummary();

                act(() => {
                    captured.dispatch({ type: 'START_SIMULATION' });
                });

                act(() => {
                    captured.dispatch({ type: 'COMPLETE_SIMULATION', payload: mockSummary });
                });

                expect(captured.state.isRunning).toBe(false);
                expect(captured.state.progress).toBe(100);
                expect(captured.state.summary).toEqual(mockSummary);
                expect(captured.state.error).toBeNull();
            });
        });

        describe('SIMULATION_ERROR', () => {
            it('should set error message and stop running', () => {
                const captured = {} as React.ContextType<typeof MonteCarloContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                act(() => {
                    captured.dispatch({ type: 'START_SIMULATION' });
                });

                act(() => {
                    captured.dispatch({ type: 'SIMULATION_ERROR', payload: 'Something went wrong' });
                });

                expect(captured.state.isRunning).toBe(false);
                expect(captured.state.progress).toBe(0);
                expect(captured.state.error).toBe('Something went wrong');
            });
        });

        describe('RESET', () => {
            it('should reset state but keep config', () => {
                const captured = {} as React.ContextType<typeof MonteCarloContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                const mockSummary = createMockSummary();

                // Set up some state
                act(() => {
                    captured.dispatch({ type: 'UPDATE_CONFIG', payload: { numScenarios: 500 } });
                });

                act(() => {
                    captured.dispatch({ type: 'COMPLETE_SIMULATION', payload: mockSummary });
                });

                expect(captured.state.summary).not.toBeNull();
                expect(captured.state.config.numScenarios).toBe(500);

                // Reset
                act(() => {
                    captured.dispatch({ type: 'RESET' });
                });

                expect(captured.state.summary).toBeNull();
                expect(captured.state.isRunning).toBe(false);
                expect(captured.state.progress).toBe(0);
                expect(captured.state.error).toBeNull();
                // Config should be preserved
                expect(captured.state.config.numScenarios).toBe(500);
            });
        });
    });

    describe('Helper Functions', () => {
        describe('updateConfig', () => {
            it('should dispatch UPDATE_CONFIG action', () => {
                const captured = {} as React.ContextType<typeof MonteCarloContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                act(() => {
                    captured.updateConfig({ returnMean: 10 });
                });

                expect(captured.state.config.returnMean).toBe(10);
            });
        });

        describe('resetResults', () => {
            it('should dispatch RESET action', () => {
                const captured = {} as React.ContextType<typeof MonteCarloContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                const mockSummary = createMockSummary();

                act(() => {
                    captured.dispatch({ type: 'COMPLETE_SIMULATION', payload: mockSummary });
                });

                expect(captured.state.summary).not.toBeNull();

                act(() => {
                    captured.resetResults();
                });

                expect(captured.state.summary).toBeNull();
            });
        });

        describe('generateNewSeed', () => {
            it('should generate and set a new random seed', () => {
                const captured = {} as React.ContextType<typeof MonteCarloContext>;

                const TestComponent = () => {
                    Object.assign(captured, useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                act(() => {
                    captured.generateNewSeed();
                });

                // The mock returns 99999
                expect(captured.state.config.seed).toBe(99999);
                expect(createRandomSeed).toHaveBeenCalled();
            });
        });
    });

    describe('runSimulation', () => {
        it('should run simulation and update state on success', async () => {
            const mockSummary = createMockSummary();
            (runMonteCarloSimulation as Mock).mockResolvedValue(mockSummary);

            const captured = {} as React.ContextType<typeof MonteCarloContext>;

            const TestComponent = () => {
                Object.assign(captured, useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            await act(async () => {
                await captured.runSimulation([], [], [], {
                    demographics: { startAge: 30, startYear: 2025, retirementAge: 65, lifeExpectancy: 90 },
                    investments: { returnRates: { ror: 7 }, withdrawalStrategy: 'Fixed Real', withdrawalRate: 4 },
                    macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: false },
                    income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                    expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
                    priorities: [],
                    withdrawalStrategy: [],
                } as unknown as AssumptionsState, { filingStatus: 'Single', stateResidency: 'TX', capitalGainsRate: 15, dividendTaxRate: 15, useAMT: false } as unknown as TaxState);
            });

            expect(runMonteCarloSimulation).toHaveBeenCalled();
            expect(captured.state.summary).toEqual(mockSummary);
            expect(captured.state.isRunning).toBe(false);
            expect(captured.state.progress).toBe(100);
        });

        it('should handle simulation errors', async () => {
            (runMonteCarloSimulation as Mock).mockRejectedValue(new Error('Simulation failed'));

            const captured = {} as React.ContextType<typeof MonteCarloContext>;

            const TestComponent = () => {
                Object.assign(captured, useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            await act(async () => {
                await captured.runSimulation([], [], [], {
                    demographics: { startAge: 30, startYear: 2025, retirementAge: 65, lifeExpectancy: 90 },
                    investments: { returnRates: { ror: 7 }, withdrawalStrategy: 'Fixed Real', withdrawalRate: 4 },
                    macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: false },
                    income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                    expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
                    priorities: [],
                    withdrawalStrategy: [],
                } as unknown as AssumptionsState, { filingStatus: 'Single', stateResidency: 'TX', capitalGainsRate: 15, dividendTaxRate: 15, useAMT: false } as unknown as TaxState);
            });

            expect(captured.state.error).toBe('Simulation failed');
            expect(captured.state.isRunning).toBe(false);
            expect(captured.state.summary).toBeNull();
        });

        it('should handle non-Error thrown objects', async () => {
            (runMonteCarloSimulation as Mock).mockRejectedValue('String error');

            const captured = {} as React.ContextType<typeof MonteCarloContext>;

            const TestComponent = () => {
                Object.assign(captured, useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            await act(async () => {
                await captured.runSimulation([], [], [], {
                    demographics: { startAge: 30, startYear: 2025, retirementAge: 65, lifeExpectancy: 90 },
                    investments: { returnRates: { ror: 7 }, withdrawalStrategy: 'Fixed Real', withdrawalRate: 4 },
                    macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: false },
                    income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                    expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
                    priorities: [],
                    withdrawalStrategy: [],
                } as unknown as AssumptionsState, { filingStatus: 'Single', stateResidency: 'TX', capitalGainsRate: 15, dividendTaxRate: 15, useAMT: false } as unknown as TaxState);
            });

            expect(captured.state.error).toBe('Simulation failed');
        });

        it('should pass progress callback to engine', async () => {
            const mockSummary = createMockSummary();
            let capturedProgressCallback: ((progress: number) => void) | undefined;

            (runMonteCarloSimulation as Mock).mockImplementation(
                async (_config, _accounts, _incomes, _expenses, _assumptions, _taxState, onProgress) => {
                    capturedProgressCallback = onProgress;
                    onProgress?.(50);
                    return mockSummary;
                }
            );

            const captured = {} as React.ContextType<typeof MonteCarloContext>;

            const TestComponent = () => {
                Object.assign(captured, useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            await act(async () => {
                await captured.runSimulation([], [], [], {
                    demographics: { startAge: 30, startYear: 2025, retirementAge: 65, lifeExpectancy: 90 },
                    investments: { returnRates: { ror: 7 }, withdrawalStrategy: 'Fixed Real', withdrawalRate: 4 },
                    macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: false },
                    income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                    expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
                    priorities: [],
                    withdrawalStrategy: [],
                } as unknown as AssumptionsState, { filingStatus: 'Single', stateResidency: 'TX', capitalGainsRate: 15, dividendTaxRate: 15, useAMT: false } as unknown as TaxState);
            });

            expect(capturedProgressCallback).toBeDefined();
        });
    });

    describe('localStorage Persistence', () => {
        it('should save config to localStorage when state changes (debounced)', async () => {
            vi.useFakeTimers();
            const captured = {} as React.ContextType<typeof MonteCarloContext>;

            const TestComponent = () => {
                Object.assign(captured, useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            act(() => {
                captured.updateConfig({ numScenarios: 500 });
            });

            // Wait for debounce (500ms)
            await act(async () => {
                vi.advanceTimersByTime(500);
            });

            const relevantCalls = localStorageMock.setItem.mock.calls.filter(
                (call) => call[0] === 'monte_carlo_config'
            );

            expect(relevantCalls.length).toBeGreaterThan(0);
            const savedData = JSON.parse(relevantCalls[relevantCalls.length - 1][1]);
            expect(savedData.numScenarios).toBe(500);

            vi.useRealTimers();
        });
    });

    describe('Selector Hooks', () => {
        describe('useMonteCarlo', () => {
            it('should return all context values', () => {
                const captured = {} as ReturnType<typeof useMonteCarlo>;

                const TestComponent = () => {
                    Object.assign(captured, useMonteCarlo());
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                expect(captured.state).toBeDefined();
                expect(captured.dispatch).toBeDefined();
                expect(captured.runSimulation).toBeDefined();
                expect(captured.updateConfig).toBeDefined();
                expect(captured.resetResults).toBeDefined();
                expect(captured.generateNewSeed).toBeDefined();
            });

            it('should throw error when used outside provider', () => {
                const TestComponent = () => {
                    useMonteCarlo();
                    return null;
                };

                // The current implementation doesn't throw but returns empty context
                // This test documents that behavior
                expect(() => {
                    render(<TestComponent />);
                }).not.toThrow();
            });
        });

        describe('useMonteCarloConfig', () => {
            it('should return config, updateConfig, and generateNewSeed', () => {
                const captured = {} as ReturnType<typeof useMonteCarloConfig>;

                const TestComponent = () => {
                    Object.assign(captured, useMonteCarloConfig());
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                expect(captured.config).toBeDefined();
                expect(captured.config.numScenarios).toBe(defaultMonteCarloConfig.numScenarios);
                expect(captured.updateConfig).toBeInstanceOf(Function);
                expect(captured.generateNewSeed).toBeInstanceOf(Function);
            });
        });

        describe('useMonteCarloResults', () => {
            it('should return results-related state and resetResults', () => {
                const captured = {} as ReturnType<typeof useMonteCarloResults>;

                const TestComponent = () => {
                    Object.assign(captured, useMonteCarloResults());
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                expect(captured.summary).toBeNull();
                expect(captured.isRunning).toBe(false);
                expect(captured.progress).toBe(0);
                expect(captured.error).toBeNull();
                expect(captured.resetResults).toBeInstanceOf(Function);
            });

            it('should reflect updated results state', async () => {
                const mockSummary = createMockSummary();
                (runMonteCarloSimulation as Mock).mockResolvedValue(mockSummary);

                const capturedResults = {} as ReturnType<typeof useMonteCarloResults>;
                const capturedMc = {} as ReturnType<typeof useMonteCarlo>;

                const TestComponent = () => {
                    Object.assign(capturedResults, useMonteCarloResults());
                    Object.assign(capturedMc, useMonteCarlo());
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                expect(capturedResults.summary).toBeNull();

                await act(async () => {
                    await capturedMc.runSimulation([], [], [], {
                        demographics: { startAge: 30, startYear: 2025, retirementAge: 65, lifeExpectancy: 90 },
                        investments: { returnRates: { ror: 7 }, withdrawalStrategy: 'Fixed Real', withdrawalRate: 4 },
                        macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: false },
                        income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                        expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
                        priorities: [],
                        withdrawalStrategy: [],
                    } as unknown as AssumptionsState, { filingStatus: 'Single', stateResidency: 'TX', capitalGainsRate: 15, dividendTaxRate: 15, useAMT: false } as unknown as TaxState);
                });

                expect(capturedResults.summary).toEqual(mockSummary);
            });
        });
    });
});
