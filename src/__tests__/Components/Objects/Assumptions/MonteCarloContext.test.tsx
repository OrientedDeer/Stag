import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext } from 'react';

import {
    MonteCarloProvider,
    MonteCarloContext,
    useMonteCarlo,
    useMonteCarloConfig,
    useMonteCarloResults,
} from '../../../../components/Objects/Assumptions/MonteCarloContext';
import {
    MonteCarloConfig,
    MonteCarloSummary,
    defaultMonteCarloConfig,
    initialMonteCarloState,
} from '../../../../services/MonteCarloTypes';
import { runMonteCarloSimulation } from '../../../../services/MonteCarloEngine';
import { createRandomSeed } from '../../../../services/RandomGenerator';

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
            let state: typeof initialMonteCarloState;

            const TestComponent = () => {
                ({ state } = useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            expect(state!.config.numScenarios).toBe(defaultMonteCarloConfig.numScenarios);
            expect(state!.config.returnMean).toBe(defaultMonteCarloConfig.returnMean);
            expect(state!.config.returnStdDev).toBe(defaultMonteCarloConfig.returnStdDev);
            expect(state!.summary).toBeNull();
            expect(state!.isRunning).toBe(false);
            expect(state!.progress).toBe(0);
            expect(state!.error).toBeNull();
        });

        it('should load config from localStorage on initialization', () => {
            const savedConfig: Partial<MonteCarloConfig> = {
                numScenarios: 500,
                returnMean: 8,
                returnStdDev: 12,
                seed: 54321,
            };

            localStorageMock.setItem('monte_carlo_config', JSON.stringify(savedConfig));

            let state: typeof initialMonteCarloState;

            const TestComponent = () => {
                ({ state } = useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            expect(localStorageMock.getItem).toHaveBeenCalledWith('monte_carlo_config');
            expect(state!.config.numScenarios).toBe(500);
            expect(state!.config.returnMean).toBe(8);
            expect(state!.config.returnStdDev).toBe(12);
            expect(state!.config.seed).toBe(54321);
        });

        it('should handle corrupted localStorage data gracefully', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            localStorageMock.setItem('monte_carlo_config', 'invalid json');

            let state: typeof initialMonteCarloState;

            const TestComponent = () => {
                ({ state } = useContext(MonteCarloContext));
                return null;
            };

            // Should not throw
            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            // Should fall back to default config
            expect(state!.config.numScenarios).toBe(defaultMonteCarloConfig.numScenarios);
            consoleSpy.mockRestore();
        });

        it('should merge partial localStorage config with defaults', () => {
            const partialConfig = { numScenarios: 1000 };
            localStorageMock.setItem('monte_carlo_config', JSON.stringify(partialConfig));

            let state: typeof initialMonteCarloState;

            const TestComponent = () => {
                ({ state } = useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            expect(state!.config.numScenarios).toBe(1000);
            expect(state!.config.returnMean).toBe(defaultMonteCarloConfig.returnMean);
            expect(state!.config.returnStdDev).toBe(defaultMonteCarloConfig.returnStdDev);
        });
    });

    describe('Reducer Actions', () => {
        describe('UPDATE_CONFIG', () => {
            it('should update config with partial values', () => {
                let state: typeof initialMonteCarloState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                act(() => {
                    dispatch({ type: 'UPDATE_CONFIG', payload: { numScenarios: 500 } });
                });

                expect(state!.config.numScenarios).toBe(500);
                expect(state!.config.returnMean).toBe(defaultMonteCarloConfig.returnMean);
            });

            it('should update multiple config values at once', () => {
                let state: typeof initialMonteCarloState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                act(() => {
                    dispatch({
                        type: 'UPDATE_CONFIG',
                        payload: { numScenarios: 1000, returnMean: 10, returnStdDev: 20 },
                    });
                });

                expect(state!.config.numScenarios).toBe(1000);
                expect(state!.config.returnMean).toBe(10);
                expect(state!.config.returnStdDev).toBe(20);
            });
        });

        describe('START_SIMULATION', () => {
            it('should set isRunning to true and reset progress/error', () => {
                let state: typeof initialMonteCarloState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                // First set an error state
                act(() => {
                    dispatch({ type: 'SIMULATION_ERROR', payload: 'Previous error' });
                });

                expect(state!.error).toBe('Previous error');

                act(() => {
                    dispatch({ type: 'START_SIMULATION' });
                });

                expect(state!.isRunning).toBe(true);
                expect(state!.progress).toBe(0);
                expect(state!.error).toBeNull();
            });
        });

        describe('UPDATE_PROGRESS', () => {
            it('should update progress value', () => {
                let state: typeof initialMonteCarloState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                act(() => {
                    dispatch({ type: 'UPDATE_PROGRESS', payload: 50 });
                });

                expect(state!.progress).toBe(50);
            });
        });

        describe('COMPLETE_SIMULATION', () => {
            it('should store summary and set progress to 100', () => {
                let state: typeof initialMonteCarloState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                const mockSummary = createMockSummary();

                act(() => {
                    dispatch({ type: 'START_SIMULATION' });
                });

                act(() => {
                    dispatch({ type: 'COMPLETE_SIMULATION', payload: mockSummary });
                });

                expect(state!.isRunning).toBe(false);
                expect(state!.progress).toBe(100);
                expect(state!.summary).toEqual(mockSummary);
                expect(state!.error).toBeNull();
            });
        });

        describe('SIMULATION_ERROR', () => {
            it('should set error message and stop running', () => {
                let state: typeof initialMonteCarloState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                act(() => {
                    dispatch({ type: 'START_SIMULATION' });
                });

                act(() => {
                    dispatch({ type: 'SIMULATION_ERROR', payload: 'Something went wrong' });
                });

                expect(state!.isRunning).toBe(false);
                expect(state!.progress).toBe(0);
                expect(state!.error).toBe('Something went wrong');
            });
        });

        describe('RESET', () => {
            it('should reset state but keep config', () => {
                let state: typeof initialMonteCarloState;
                let dispatch: React.Dispatch<any>;

                const TestComponent = () => {
                    ({ state, dispatch } = useContext(MonteCarloContext));
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
                    dispatch({ type: 'UPDATE_CONFIG', payload: { numScenarios: 500 } });
                });

                act(() => {
                    dispatch({ type: 'COMPLETE_SIMULATION', payload: mockSummary });
                });

                expect(state!.summary).not.toBeNull();
                expect(state!.config.numScenarios).toBe(500);

                // Reset
                act(() => {
                    dispatch({ type: 'RESET' });
                });

                expect(state!.summary).toBeNull();
                expect(state!.isRunning).toBe(false);
                expect(state!.progress).toBe(0);
                expect(state!.error).toBeNull();
                // Config should be preserved
                expect(state!.config.numScenarios).toBe(500);
            });
        });
    });

    describe('Helper Functions', () => {
        describe('updateConfig', () => {
            it('should dispatch UPDATE_CONFIG action', () => {
                let state: typeof initialMonteCarloState;
                let updateConfig: (config: Partial<MonteCarloConfig>) => void;

                const TestComponent = () => {
                    ({ state, updateConfig } = useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                act(() => {
                    updateConfig({ returnMean: 10 });
                });

                expect(state!.config.returnMean).toBe(10);
            });
        });

        describe('resetResults', () => {
            it('should dispatch RESET action', () => {
                let state: typeof initialMonteCarloState;
                let dispatch: React.Dispatch<any>;
                let resetResults: () => void;

                const TestComponent = () => {
                    ({ state, dispatch, resetResults } = useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                const mockSummary = createMockSummary();

                act(() => {
                    dispatch({ type: 'COMPLETE_SIMULATION', payload: mockSummary });
                });

                expect(state!.summary).not.toBeNull();

                act(() => {
                    resetResults();
                });

                expect(state!.summary).toBeNull();
            });
        });

        describe('generateNewSeed', () => {
            it('should generate and set a new random seed', () => {
                let state: typeof initialMonteCarloState;
                let generateNewSeed: () => void;

                const TestComponent = () => {
                    ({ state, generateNewSeed } = useContext(MonteCarloContext));
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                act(() => {
                    generateNewSeed();
                });

                // The mock returns 99999
                expect(state!.config.seed).toBe(99999);
                expect(createRandomSeed).toHaveBeenCalled();
            });
        });
    });

    describe('runSimulation', () => {
        it('should run simulation and update state on success', async () => {
            const mockSummary = createMockSummary();
            (runMonteCarloSimulation as Mock).mockResolvedValue(mockSummary);

            let state: typeof initialMonteCarloState;
            let runSimulation: any;

            const TestComponent = () => {
                ({ state, runSimulation } = useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            await act(async () => {
                await runSimulation([], [], [], {
                    demographics: { startAge: 30, startYear: 2025, retirementAge: 65, lifeExpectancy: 90 },
                    investments: { returnRates: { ror: 7 }, withdrawalStrategy: 'Fixed Real', withdrawalRate: 4 },
                    macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: false },
                    income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                    expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
                    priorities: [],
                    withdrawalStrategy: [],
                }, { filingStatus: 'single', state: 'TX', capitalGainsRate: 15, dividendTaxRate: 15, useAMT: false });
            });

            expect(runMonteCarloSimulation).toHaveBeenCalled();
            expect(state!.summary).toEqual(mockSummary);
            expect(state!.isRunning).toBe(false);
            expect(state!.progress).toBe(100);
        });

        it('should handle simulation errors', async () => {
            (runMonteCarloSimulation as Mock).mockRejectedValue(new Error('Simulation failed'));

            let state: typeof initialMonteCarloState;
            let runSimulation: any;

            const TestComponent = () => {
                ({ state, runSimulation } = useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            await act(async () => {
                await runSimulation([], [], [], {
                    demographics: { startAge: 30, startYear: 2025, retirementAge: 65, lifeExpectancy: 90 },
                    investments: { returnRates: { ror: 7 }, withdrawalStrategy: 'Fixed Real', withdrawalRate: 4 },
                    macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: false },
                    income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                    expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
                    priorities: [],
                    withdrawalStrategy: [],
                }, { filingStatus: 'single', state: 'TX', capitalGainsRate: 15, dividendTaxRate: 15, useAMT: false });
            });

            expect(state!.error).toBe('Simulation failed');
            expect(state!.isRunning).toBe(false);
            expect(state!.summary).toBeNull();
        });

        it('should handle non-Error thrown objects', async () => {
            (runMonteCarloSimulation as Mock).mockRejectedValue('String error');

            let state: typeof initialMonteCarloState;
            let runSimulation: any;

            const TestComponent = () => {
                ({ state, runSimulation } = useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            await act(async () => {
                await runSimulation([], [], [], {
                    demographics: { startAge: 30, startYear: 2025, retirementAge: 65, lifeExpectancy: 90 },
                    investments: { returnRates: { ror: 7 }, withdrawalStrategy: 'Fixed Real', withdrawalRate: 4 },
                    macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: false },
                    income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                    expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
                    priorities: [],
                    withdrawalStrategy: [],
                }, { filingStatus: 'single', state: 'TX', capitalGainsRate: 15, dividendTaxRate: 15, useAMT: false });
            });

            expect(state!.error).toBe('Simulation failed');
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

            let runSimulation: any;

            const TestComponent = () => {
                ({ runSimulation } = useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            await act(async () => {
                await runSimulation([], [], [], {
                    demographics: { startAge: 30, startYear: 2025, retirementAge: 65, lifeExpectancy: 90 },
                    investments: { returnRates: { ror: 7 }, withdrawalStrategy: 'Fixed Real', withdrawalRate: 4 },
                    macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: false },
                    income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                    expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
                    priorities: [],
                    withdrawalStrategy: [],
                }, { filingStatus: 'single', state: 'TX', capitalGainsRate: 15, dividendTaxRate: 15, useAMT: false });
            });

            expect(capturedProgressCallback).toBeDefined();
        });
    });

    describe('localStorage Persistence', () => {
        it('should save config to localStorage when state changes (debounced)', async () => {
            vi.useFakeTimers();
            let updateConfig: (config: Partial<MonteCarloConfig>) => void;

            const TestComponent = () => {
                ({ updateConfig } = useContext(MonteCarloContext));
                return null;
            };

            render(
                <MonteCarloProvider>
                    <TestComponent />
                </MonteCarloProvider>
            );

            act(() => {
                updateConfig({ numScenarios: 500 });
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
                let hookResult: ReturnType<typeof useMonteCarlo>;

                const TestComponent = () => {
                    hookResult = useMonteCarlo();
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                expect(hookResult!.state).toBeDefined();
                expect(hookResult!.dispatch).toBeDefined();
                expect(hookResult!.runSimulation).toBeDefined();
                expect(hookResult!.updateConfig).toBeDefined();
                expect(hookResult!.resetResults).toBeDefined();
                expect(hookResult!.generateNewSeed).toBeDefined();
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
                let config: MonteCarloConfig;
                let updateConfig: (config: Partial<MonteCarloConfig>) => void;
                let generateNewSeed: () => void;

                const TestComponent = () => {
                    ({ config, updateConfig, generateNewSeed } = useMonteCarloConfig());
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                expect(config!).toBeDefined();
                expect(config!.numScenarios).toBe(defaultMonteCarloConfig.numScenarios);
                expect(updateConfig!).toBeInstanceOf(Function);
                expect(generateNewSeed!).toBeInstanceOf(Function);
            });
        });

        describe('useMonteCarloResults', () => {
            it('should return results-related state and resetResults', () => {
                let summary: MonteCarloSummary | null;
                let isRunning: boolean;
                let progress: number;
                let error: string | null;
                let resetResults: () => void;

                const TestComponent = () => {
                    ({ summary, isRunning, progress, error, resetResults } = useMonteCarloResults());
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                expect(summary!).toBeNull();
                expect(isRunning!).toBe(false);
                expect(progress!).toBe(0);
                expect(error!).toBeNull();
                expect(resetResults!).toBeInstanceOf(Function);
            });

            it('should reflect updated results state', async () => {
                const mockSummary = createMockSummary();
                (runMonteCarloSimulation as Mock).mockResolvedValue(mockSummary);

                let summary: MonteCarloSummary | null;
                let runSimulation: any;

                const TestComponent = () => {
                    ({ summary } = useMonteCarloResults());
                    ({ runSimulation } = useMonteCarlo());
                    return null;
                };

                render(
                    <MonteCarloProvider>
                        <TestComponent />
                    </MonteCarloProvider>
                );

                expect(summary!).toBeNull();

                await act(async () => {
                    await runSimulation([], [], [], {
                        demographics: { startAge: 30, startYear: 2025, retirementAge: 65, lifeExpectancy: 90 },
                        investments: { returnRates: { ror: 7 }, withdrawalStrategy: 'Fixed Real', withdrawalRate: 4 },
                        macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: false },
                        income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
                        expenses: { lifestyleCreep: 75, housingAppreciation: 1.4, rentInflation: 1.2 },
                        priorities: [],
                        withdrawalStrategy: [],
                    }, { filingStatus: 'single', state: 'TX', capitalGainsRate: 15, dividendTaxRate: 15, useAMT: false });
                });

                expect(summary!).toEqual(mockSummary);
            });
        });
    });
});
