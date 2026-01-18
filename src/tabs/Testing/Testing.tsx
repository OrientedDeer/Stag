import { useState, useMemo, useContext, useEffect, useCallback } from 'react';
import { MortgageExpense } from '../../components/Objects/Expense/models';
import { CurrencyInput } from '../../components/Layout/InputFields/CurrencyInput';
import { PercentageInput } from '../../components/Layout/InputFields/PercentageInput';
import { NumberInput } from '../../components/Layout/InputFields/NumberInput';
import { DropdownInput } from '../../components/Layout/InputFields/DropdownInput';
import { ToggleInput } from '../../components/Layout/InputFields/ToggleInput';
import { AssumptionsContext } from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { WorkIncome, FutureSocialSecurityIncome, CurrentSocialSecurityIncome, PassiveIncome, FERSPensionIncome, CSRSPensionIncome } from '../../components/Objects/Income/models';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import { getSimulationInputHash } from '../../services/simulationHash';
import {
    getTaxParameters,
    calculateTax,
    getMarginalTaxRate,
    getGrossIncome,
    getPreTaxExemptions,
    getEarnedIncome,
    getFicaExemptions,
    getSocialSecurityBenefits,
    getTaxableSocialSecurityBenefits,
    getItemizedDeductions,
    getYesDeductions,
    getSALTCap,
    doesStateTaxSocialSecurity
} from '../../components/Objects/Taxes/TaxService';
import {
    extractEarningsFromSimulation,
    calculateAIME
} from '../../services/SocialSecurityCalculator';
import {
    getFRA,
    getClaimingAdjustment,
    getBendPoints,
    getWageBase
} from '../../data/SocialSecurityData';
import {
    getRMDStartAge,
    getDistributionPeriod,
    calculateRMD,
    isAccountSubjectToRMD,
    isRMDRequired,
    RMDCalculation
} from '../../data/RMDData';
import {
    getFERSMRA,
    checkFERSEligibility,
    calculateFERSBasicBenefit,
    getFERSCOLA,
    checkCSRSEligibility,
    calculateCSRSBasicBenefit,
    getCSRSCOLA,
    getFERSEarlyReduction,
    PENSION_SYSTEM_COMPARISON
} from '../../data/PensionData';

// Helper to format currency
const toCurrency = (num: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);

const toCurrencyShort = (num: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);

// ============================================================================
// SIMULATION DEBUG TAB
// ============================================================================
function SimulationDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation, inputHash: storedInputHash, dispatch: dispatchSimulation } = useContext(SimulationContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);
    const [selectedYear, setSelectedYear] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const retirementAge = assumptions.demographics.retirementAge;
    const currentYear = new Date().getFullYear();
    const startAge = currentYear - assumptions.demographics.birthYear;

    // Auto-recalculation logic (same as FutureTab)
    const currentInputHash = useMemo(() =>
        getSimulationInputHash(accounts, incomes, expenses, assumptions, taxState),
        [accounts, incomes, expenses, assumptions, taxState]
    );

    const isSimulationStale = useMemo(() => {
        if (simulation.length === 0) return false;
        if (!storedInputHash) return true;
        return storedInputHash !== currentInputHash;
    }, [storedInputHash, currentInputHash, simulation.length]);

    const executeSimulation = useCallback(() => {
        return runSimulation(
            assumptions.demographics.lifeExpectancy - startAge,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );
    }, [assumptions, accounts, incomes, expenses, taxState]);

    const handleRecalculate = useCallback(() => {
        setIsLoading(true);
        setTimeout(() => {
            const newSimulation = executeSimulation();
            dispatchSimulation({
                type: 'SET_SIMULATION_WITH_HASH',
                payload: { simulation: newSimulation, inputHash: currentInputHash }
            });
            setIsLoading(false);
        }, 50);
    }, [executeSimulation, dispatchSimulation, currentInputHash]);

    // Auto-recalculate on mount if data exists but no simulation
    useEffect(() => {
        const hasData = accounts.length > 0 || incomes.length > 0 || expenses.length > 0;
        const hasNoSimulation = simulation.length === 0;

        if (hasData && hasNoSimulation) {
            handleRecalculate();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Auto-run simulation after 500ms of being stale
    useEffect(() => {
        if (!isSimulationStale || isLoading) return;

        const timer = setTimeout(() => {
            handleRecalculate();
        }, 500);

        return () => clearTimeout(timer);
    }, [isSimulationStale, currentInputHash, isLoading, handleRecalculate]);

    // Analyze simulation for issues
    const analysis = useMemo(() => {
        if (simulation.length === 0) return null;

        const issues: Array<{ year: number; age: number; type: string; message: string; severity: 'error' | 'warning' | 'info' }> = [];
        const yearData: Array<{
            year: number;
            age: number;
            isRetired: boolean;
            totalIncome: number;
            totalExpenses: number;
            totalWithdrawals: number;
            discretionary: number;
            accountBalances: Record<string, number>;
            workIncomes: Array<{ name: string; amount: number; contrib401k: number; employerMatch: number }>;
            socialSecurityIncome: number;
            interestIncome: Array<{ name: string; amount: number }>;
            withdrawalDetail: Record<string, number>;
            bucketDetail: Record<string, number>;
            taxDetails: { fed: number; state: number; fica: number; capitalGains: number };
            logs: string[];
        }> = [];

        simulation.forEach((simYear, idx) => {
            const age = startAge + idx;
            const isRetired = age >= retirementAge;

            // Extract data
            const totalWithdrawals = simYear.cashflow.withdrawals || 0;
            const withdrawalDetail = simYear.cashflow.withdrawalDetail || {};
            const bucketDetail = simYear.cashflow.bucketDetail || {};

            // Account balances
            const accountBalances: Record<string, number> = {};
            simYear.accounts.forEach(acc => {
                accountBalances[acc.name] = acc.amount;
            });

            // Work income details
            const workIncomes: Array<{ name: string; amount: number; contrib401k: number; employerMatch: number }> = [];
            let socialSecurityIncome = 0;
            const interestIncome: Array<{ name: string; amount: number }> = [];

            simYear.incomes.forEach(inc => {
                if (inc instanceof WorkIncome) {
                    workIncomes.push({
                        name: inc.name,
                        amount: inc.getProratedAnnual(inc.amount, simYear.year),
                        contrib401k: inc.getProratedAnnual(inc.preTax401k + inc.roth401k, simYear.year),
                        employerMatch: inc.getProratedAnnual(inc.employerMatch, simYear.year),
                    });
                } else if (inc instanceof FutureSocialSecurityIncome || inc instanceof CurrentSocialSecurityIncome) {
                    socialSecurityIncome += inc.getProratedAnnual(inc.amount, simYear.year);
                } else if (inc instanceof PassiveIncome && inc.sourceType === 'Interest') {
                    interestIncome.push({
                        name: inc.name,
                        amount: inc.getProratedAnnual(inc.amount, simYear.year),
                    });
                }
            });

            // Check for issues
            // 1. Deficit when there's money in accounts
            if (simYear.cashflow.discretionary < -1) {
                const totalAvailable = Object.values(accountBalances).reduce((sum, bal) => sum + bal, 0);
                if (totalAvailable > Math.abs(simYear.cashflow.discretionary)) {
                    issues.push({
                        year: simYear.year,
                        age,
                        type: 'DEFICIT_WITH_FUNDS',
                        message: `Deficit of ${toCurrencyShort(simYear.cashflow.discretionary)} but accounts have ${toCurrencyShort(totalAvailable)} available`,
                        severity: 'error'
                    });
                }
            }

            // 2. 401k contributions after retirement
            if (isRetired) {
                workIncomes.forEach(wi => {
                    if (wi.contrib401k > 0 || wi.employerMatch > 0) {
                        issues.push({
                            year: simYear.year,
                            age,
                            type: '401K_AFTER_RETIREMENT',
                            message: `${wi.name}: 401k contrib ${toCurrencyShort(wi.contrib401k)}, employer match ${toCurrencyShort(wi.employerMatch)} after retirement`,
                            severity: 'error'
                        });
                    }
                });

            }

            // 3. No withdrawals when in deficit and retired
            if (isRetired && simYear.cashflow.discretionary < -1 && totalWithdrawals === 0) {
                issues.push({
                    year: simYear.year,
                    age,
                    type: 'NO_WITHDRAWAL_IN_DEFICIT',
                    message: `Deficit of ${toCurrencyShort(simYear.cashflow.discretionary)} but no withdrawals made`,
                    severity: 'error'
                });
            }

            // 4. Alternating expense patterns (check against previous year)
            if (idx > 0) {
                const prevExpenseCount = simulation[idx - 1].expenses.length;
                const currExpenseCount = simYear.expenses.length;
                const prevExpenseTotal = simulation[idx - 1].cashflow.totalExpense;
                const currExpenseTotal = simYear.cashflow.totalExpense;

                // Check if this is the first year of retirement (transition year)
                const prevAge = startAge + idx - 1;
                const wasRetiredLastYear = prevAge >= retirementAge;
                const isFirstRetirementYear = isRetired && !wasRetiredLastYear;

                // Big swing in expense count or amount
                if (Math.abs(prevExpenseCount - currExpenseCount) > 2) {
                    issues.push({
                        year: simYear.year,
                        age,
                        type: 'EXPENSE_COUNT_CHANGE',
                        message: `Expense count changed from ${prevExpenseCount} to ${currExpenseCount}`,
                        severity: 'info'
                    });
                }
                // Skip expense swing warning for:
                // - First year of retirement (expected drop in 401k, FICA, etc.)
                // - Guyton-Klinger guardrail triggers (prosperity/austerity adjustments)
                const hasGKTrigger = (simYear.logs || []).some(log =>
                    log.includes('GK Prosperity') || log.includes('GK Austerity')
                );
                if (!isFirstRetirementYear && !hasGKTrigger && prevExpenseTotal > 0 && Math.abs(currExpenseTotal - prevExpenseTotal) / prevExpenseTotal > 0.5) {
                    issues.push({
                        year: simYear.year,
                        age,
                        type: 'EXPENSE_AMOUNT_SWING',
                        message: `Expenses swung from ${toCurrencyShort(prevExpenseTotal)} to ${toCurrencyShort(currExpenseTotal)}`,
                        severity: 'warning'
                    });
                }
            }

            yearData.push({
                year: simYear.year,
                age,
                isRetired,
                totalIncome: simYear.cashflow.totalIncome,
                totalExpenses: simYear.cashflow.totalExpense,
                totalWithdrawals,
                discretionary: simYear.cashflow.discretionary,
                accountBalances,
                workIncomes,
                socialSecurityIncome,
                interestIncome,
                withdrawalDetail,
                bucketDetail,
                taxDetails: {
                    fed: simYear.taxDetails.fed,
                    state: simYear.taxDetails.state,
                    fica: simYear.taxDetails.fica,
                    capitalGains: simYear.taxDetails.capitalGains,
                },
                logs: simYear.logs || [],
            });
        });

        return { issues, yearData };
    }, [simulation, startAge, retirementAge]);

    if (simulation.length === 0 || isLoading) {
        return (
            <div className="text-center py-8 text-gray-400">
                {isLoading ? 'Running simulation...' : 'No simulation data. Waiting for data...'}
            </div>
        );
    }

    const selectedYearData = selectedYear !== null
        ? analysis?.yearData.find(y => y.year === selectedYear)
        : null;

    return (
        <div className="space-y-6">
            {/* Current Configuration */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">Current Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-gray-400">Start Age:</span>
                        <span className="ml-2 text-white">{startAge}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Retirement Age:</span>
                        <span className="ml-2 text-white">{retirementAge}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Accounts:</span>
                        <span className="ml-2 text-white">{accounts.length}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Withdrawal Strategy:</span>
                        <span className="ml-2 text-white">{assumptions.withdrawalStrategy?.length || 0} buckets</span>
                    </div>
                </div>
                {assumptions.withdrawalStrategy && assumptions.withdrawalStrategy.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-800">
                        <span className="text-gray-400 text-sm">Withdrawal Order: </span>
                        {assumptions.withdrawalStrategy.map((bucket, idx) => {
                            const acc = accounts.find(a => a.id === bucket.accountId);
                            return (
                                <span key={bucket.accountId} className="text-xs bg-gray-800 px-2 py-1 rounded mr-2">
                                    {idx + 1}. {acc?.name || 'Unknown'}
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Issues Summary */}
            {analysis && analysis.issues.length > 0 && (
                <div className="bg-red-900/20 p-4 rounded-xl border border-red-800">
                    <h3 className="text-lg font-bold text-red-400 mb-3">
                        Issues Found ({analysis.issues.length})
                    </h3>
                    <div className="max-h-60 overflow-y-auto space-y-2">
                        {analysis.issues.map((issue, idx) => (
                            <div
                                key={idx}
                                className={`text-sm p-2 rounded cursor-pointer hover:bg-gray-800 ${
                                    issue.severity === 'error' ? 'bg-red-900/30 text-red-300' :
                                    issue.severity === 'warning' ? 'bg-yellow-900/30 text-yellow-300' :
                                    'bg-blue-900/30 text-blue-300'
                                }`}
                                onClick={() => setSelectedYear(issue.year)}
                            >
                                <span className="font-mono">{issue.year} (Age {issue.age})</span>
                                <span className="mx-2 text-gray-500">|</span>
                                <span className="font-semibold">{issue.type}</span>
                                <span className="mx-2 text-gray-500">|</span>
                                <span>{issue.message}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Year-by-Year Data Table */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <h3 className="text-lg font-bold text-white p-4 border-b border-gray-800">
                    Simulation Data (Click row for details)
                </h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-800 sticky top-0">
                            <tr>
                                <th className="p-2 text-left text-gray-400">Year</th>
                                <th className="p-2 text-left text-gray-400">Age</th>
                                <th className="p-2 text-left text-gray-400">Phase</th>
                                <th className="p-2 text-right text-gray-400">Income</th>
                                <th className="p-2 text-right text-gray-400">Expenses</th>
                                <th className="p-2 text-right text-gray-400">Withdrawals</th>
                                <th className="p-2 text-right text-gray-400">Discretionary</th>
                                <th className="p-2 text-right text-gray-400">Total Assets</th>
                            </tr>
                        </thead>
                        <tbody>
                            {analysis?.yearData.map(row => {
                                const totalAssets = Object.values(row.accountBalances).reduce((sum, bal) => sum + bal, 0);
                                const hasIssue = analysis.issues.some(i => i.year === row.year);
                                return (
                                    <tr
                                        key={row.year}
                                        className={`border-t border-gray-800 cursor-pointer hover:bg-gray-800 ${
                                            selectedYear === row.year ? 'bg-blue-900/30' : ''
                                        } ${hasIssue ? 'bg-red-900/10' : ''}`}
                                        onClick={() => setSelectedYear(row.year)}
                                    >
                                        <td className="p-2 font-mono">{row.year}</td>
                                        <td className="p-2">{row.age}</td>
                                        <td className="p-2">
                                            <span className={`px-2 py-0.5 rounded text-xs ${
                                                row.isRetired ? 'bg-amber-900/50 text-amber-300' : 'bg-green-900/50 text-green-300'
                                            }`}>
                                                {row.isRetired ? 'Retired' : 'Working'}
                                            </span>
                                        </td>
                                        <td className="p-2 text-right font-mono text-green-400">{toCurrencyShort(row.totalIncome)}</td>
                                        <td className="p-2 text-right font-mono text-red-400">{toCurrencyShort(row.totalExpenses)}</td>
                                        <td className="p-2 text-right font-mono text-purple-400">
                                            {row.totalWithdrawals > 0 ? toCurrencyShort(row.totalWithdrawals) : '-'}
                                        </td>
                                        <td className={`p-2 text-right font-mono ${row.discretionary < 0 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                                            {toCurrencyShort(row.discretionary)}
                                        </td>
                                        <td className="p-2 text-right font-mono text-blue-400">{toCurrencyShort(totalAssets)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Selected Year Details */}
            {selectedYearData && (
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                    <h3 className="text-lg font-bold text-white mb-4">
                        Year {selectedYearData.year} Details (Age {selectedYearData.age})
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Account Balances */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Account Balances</h4>
                            <div className="space-y-1 text-sm">
                                {Object.entries(selectedYearData.accountBalances).map(([name, bal]) => (
                                    <div key={name} className="flex justify-between">
                                        <span className="text-gray-400">{name}</span>
                                        <span className="font-mono text-white">{toCurrencyShort(bal)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Work Income Details */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Work Income</h4>
                            {selectedYearData.workIncomes.length === 0 ? (
                                <span className="text-gray-500 text-sm">No work income</span>
                            ) : (
                                <div className="space-y-2 text-sm">
                                    {selectedYearData.workIncomes.map(wi => (
                                        <div key={wi.name} className="border-b border-gray-700 pb-2">
                                            <div className="font-semibold text-white">{wi.name}</div>
                                            <div className="flex justify-between text-gray-400">
                                                <span>Salary:</span>
                                                <span className="font-mono">{toCurrencyShort(wi.amount)}</span>
                                            </div>
                                            <div className={`flex justify-between ${wi.contrib401k > 0 && selectedYearData.isRetired ? 'text-red-400' : 'text-gray-400'}`}>
                                                <span>401k Contrib:</span>
                                                <span className="font-mono">{toCurrencyShort(wi.contrib401k)}</span>
                                            </div>
                                            <div className={`flex justify-between ${wi.employerMatch > 0 && selectedYearData.isRetired ? 'text-red-400' : 'text-gray-400'}`}>
                                                <span>Employer Match:</span>
                                                <span className="font-mono">{toCurrencyShort(wi.employerMatch)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Other Income (Social Security + Interest) */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Other Income</h4>
                            <div className="space-y-2 text-sm">
                                {/* Social Security */}
                                <div className="flex justify-between text-gray-400">
                                    <span>Social Security:</span>
                                    <span className={`font-mono ${selectedYearData.socialSecurityIncome > 0 ? 'text-cyan-400' : 'text-gray-500'}`}>
                                        {selectedYearData.socialSecurityIncome > 0 ? toCurrencyShort(selectedYearData.socialSecurityIncome) : '-'}
                                    </span>
                                </div>
                                {/* Interest Income */}
                                {selectedYearData.interestIncome.length === 0 ? (
                                    <div className="flex justify-between text-gray-400">
                                        <span>Interest Income:</span>
                                        <span className="font-mono text-gray-500">-</span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="text-gray-400 mt-2">Interest Income:</div>
                                        {selectedYearData.interestIncome.map(ii => (
                                            <div key={ii.name} className="flex justify-between pl-2">
                                                <span className="text-gray-500">{ii.name}</span>
                                                <span className="font-mono text-yellow-400">{toCurrencyShort(ii.amount)}</span>
                                            </div>
                                        ))}
                                        <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
                                            <span className="text-gray-400">Total Interest:</span>
                                            <span className="font-mono text-yellow-400">
                                                {toCurrencyShort(selectedYearData.interestIncome.reduce((sum, ii) => sum + ii.amount, 0))}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Withdrawals */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Withdrawals</h4>
                            {Object.keys(selectedYearData.withdrawalDetail).length === 0 ? (
                                <span className="text-gray-500 text-sm">No withdrawals</span>
                            ) : (
                                <div className="space-y-1 text-sm">
                                    {Object.entries(selectedYearData.withdrawalDetail).map(([name, amt]) => (
                                        <div key={name} className="flex justify-between">
                                            <span className="text-gray-400">{name}</span>
                                            <span className="font-mono text-purple-400">{toCurrencyShort(amt)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Bucket Allocations */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Priority Buckets</h4>
                            {Object.keys(selectedYearData.bucketDetail).length === 0 ? (
                                <span className="text-gray-500 text-sm">No allocations</span>
                            ) : (
                                <div className="space-y-1 text-sm">
                                    {Object.entries(selectedYearData.bucketDetail).map(([id, amt]) => {
                                        const acc = accounts.find(a => a.id === id);
                                        return (
                                            <div key={id} className="flex justify-between">
                                                <span className="text-gray-400">{acc?.name || id}</span>
                                                <span className="font-mono text-green-400">{toCurrencyShort(amt)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tax Breakdown */}
                    <div className="mt-4 bg-gray-800 p-3 rounded-lg">
                        <h4 className="font-semibold text-gray-300 mb-2">Tax Breakdown</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                                <span className="text-gray-400">Federal Tax:</span>
                                <span className={`ml-2 font-mono ${selectedYearData.taxDetails.fed > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.fed)}
                                </span>
                            </div>
                            <div>
                                <span className="text-gray-400">State Tax:</span>
                                <span className={`ml-2 font-mono ${selectedYearData.taxDetails.state > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.state)}
                                </span>
                            </div>
                            <div>
                                <span className="text-gray-400">FICA:</span>
                                <span className={`ml-2 font-mono ${selectedYearData.taxDetails.fica > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.fica)}
                                </span>
                            </div>
                            <div>
                                <span className="text-gray-400">Cap Gains Tax:</span>
                                <span className={`ml-2 font-mono ${selectedYearData.taxDetails.capitalGains > 0 ? 'text-lime-400' : 'text-gray-500'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.capitalGains)}
                                </span>
                            </div>
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-500">
                            Note: Federal tax includes income tax on Traditional withdrawals + early withdrawal penalties.
                            Capital gains tax is from brokerage withdrawals only.
                            {selectedYearData.isRetired && selectedYearData.taxDetails.fed > 0 && selectedYearData.taxDetails.capitalGains === 0 && (
                                <span className="text-amber-400 block mt-1">
                                    Federal tax in retirement with $0 cap gains may indicate Traditional account withdrawals or income above standard deduction.
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Logs */}
                    {selectedYearData.logs.length > 0 && (
                        <div className="mt-4 bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Simulation Logs</h4>
                            <div className="text-xs font-mono space-y-1 max-h-40 overflow-y-auto">
                                {selectedYearData.logs.map((log, idx) => (
                                    <div key={idx} className="text-gray-400">{log}</div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================================================
// MORTGAGE TESTING TAB (Original)
// ============================================================================
function MortgageTestingTab() {
    const { state: assumptions } = useContext(AssumptionsContext);

    // --- Inputs State ---
    const [valuation, setValuation] = useState(500000);
    const [startingLoan, setStartingLoan] = useState(400000);
    const [apr, setApr] = useState(6.5);
    const [propertyTaxRate, setPropertyTaxRate] = useState(0.85);
    const [propertyDeduction, setPropertyDeduction] = useState(89850);
    const [insuranceRate, setInsuranceRate] = useState(0.56);
    const [repairsRate, setRepairsRate] = useState(0.75);
    const [term, setTerm] = useState(30);
    const [extraPayment, setExtraPayment] = useState(0);
    const [pmi, setPmi] = useState(0);
    const [hoa, setHoa] = useState(0);
    const [utilities, setUtilities] = useState(0);

    // --- Simulation ---
    const simulationData = useMemo(() => {
        const rows = [];

        // 1. Create Initial Mortgage Object
        // We use today as start date
        const startDate = new Date();

        let currentMortgage = new MortgageExpense(
            'debug-mortgage',
            'Debug Mortgage',
            'Monthly',
            valuation,
            startingLoan, // Current Balance (starts full)
            startingLoan, // Starting Balance
            apr,
            term,
            propertyTaxRate,
            propertyDeduction,
            repairsRate,
            utilities,
            insuranceRate,
            pmi,
            hoa,
            'No', // Tax Deductible (not used for this sim display)
            0,
            'none',
            startDate,
            0,
            extraPayment
        );

        // 2. Loop for 30 years (or Term)
        for (let year = 1; year <= (term+5); year++) {
            // Capture Start-of-Year State
            const startValuation = currentMortgage.valuation;
            const startBalance = currentMortgage.loan_balance;

            // Calculate 'Escrow' and other non-P&I expenses for the year
            // These are based on the valuation/rates of the CURRENT year object
            const annualPropTax = Math.max(0, startValuation - currentMortgage.valuation_deduction) * (currentMortgage.property_taxes / 100);
            const annualInsurance = startValuation * (currentMortgage.home_owners_insurance / 100);
            const annualRepairs = startValuation * (currentMortgage.maintenance / 100);
            const annualPMI = startValuation * (currentMortgage.pmi / 100);
            const annualHOA = currentMortgage.hoa_fee * 12;
            const annualUtilities = currentMortgage.utilities * 12;

            // Advance Time
            const nextMortgage = currentMortgage.increment(assumptions);

            // Calculate Deltas from Increment
            // MortgageExpense.increment() stores the total interest paid in 'tax_deductible' of the NEW object
            const interestPaid = nextMortgage.tax_deductible;
            const principalPaid = startBalance - nextMortgage.loan_balance;

            // Total P&I actually paid (approximate via sum, accurate to what happened in simulation)
            const totalPIPaid = interestPaid + principalPaid;

            const totalAnnualCost = totalPIPaid + annualPropTax + annualInsurance + annualRepairs + annualPMI + annualHOA + annualUtilities;

            rows.push({
                year,
                valuation: startValuation,
                startBalance,
                interestPaid,
                principalPaid,
                propertyTax: annualPropTax,
                insurance: annualInsurance,
                repairs: annualRepairs,
                pmi: annualPMI,
                hoa: annualHOA,
                totalCost: totalAnnualCost,
                endBalance: nextMortgage.loan_balance
            });

            // Update for next iteration
            currentMortgage = nextMortgage;

            // Optional: optimization to stop if paid off early
            //if (currentMortgage.loan_balance <= 0 && principalPaid <= 0) break;
        }

        return rows;
    }, [valuation, startingLoan, apr, propertyTaxRate, propertyDeduction, insuranceRate, repairsRate, pmi, hoa, utilities, term, extraPayment, assumptions]);

    return (
        <>
            <h3 className="text-xl font-bold mb-4 text-white">
                Mortgage Full Simulation
            </h3>

            {/* --- Inputs Grid --- */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
                    <CurrencyInput label="Home Valuation" value={valuation} onChange={setValuation} />
                    <CurrencyInput label="Starting Loan" value={startingLoan} onChange={setStartingLoan} />
                    <PercentageInput label="Interest Rate" value={apr} onChange={setApr} />
                    <NumberInput label="Term (Years)" value={term} onChange={setTerm} />

                    <PercentageInput label="Property Tax Rate" value={propertyTaxRate} onChange={setPropertyTaxRate} />
                    <CurrencyInput label="Prop. Tax Deduction" value={propertyDeduction} onChange={setPropertyDeduction} />
                    <PercentageInput label="Insurance Rate" value={insuranceRate} onChange={setInsuranceRate} />
                    <PercentageInput label="Repairs/Maint. Rate" value={repairsRate} onChange={setRepairsRate} />

                    <PercentageInput label="PMI Rate" value={pmi} onChange={setPmi} />
                    <CurrencyInput label="Monthly HOA" value={hoa} onChange={setHoa} />
                    <CurrencyInput label="Monthly Utilities" value={utilities} onChange={setUtilities} />
                    <CurrencyInput label="Extra Payment / Mo" value={extraPayment} onChange={setExtraPayment} />
                </div>

                {/* --- Results Table --- */}
                <div className="rounded-xl border border-gray-800 overflow-hidden shadow-2xl overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider font-semibold">
                            <tr>
                                <th className="p-4 border-b border-gray-800">Year</th>
                                <th className="p-4 border-b border-gray-800 text-right">Valuation</th>
                                <th className="p-4 border-b border-gray-800 text-right text-red-400">Interest</th>
                                <th className="p-4 border-b border-gray-800 text-right text-emerald-400">Principal</th>
                                <th className="p-4 border-b border-gray-800 text-right text-orange-400">Taxes</th>
                                <th className="p-4 border-b border-gray-800 text-right text-yellow-400">Ins/Maint</th>
                                <th className="p-4 border-b border-gray-800 text-right">PMI/HOA</th>
                                <th className="p-4 border-b border-gray-800 text-right font-bold text-white">Total Outflow</th>
                                <th className="p-4 border-b border-gray-800 text-right text-blue-400">Remaining Bal</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800 bg-gray-950">
                            {simulationData.map((row) => (
                                <tr key={row.year} className="hover:bg-gray-900/40 transition-colors">
                                    <td className="p-4 font-mono text-gray-500">{row.year}</td>
                                    <td className="p-4 text-right font-mono text-gray-300">{toCurrency(row.valuation)}</td>
                                    <td className="p-4 text-right font-mono text-red-500/80">{toCurrency(row.interestPaid)}</td>
                                    <td className="p-4 text-right font-mono text-emerald-500/80">{toCurrency(row.principalPaid)}</td>
                                    <td className="p-4 text-right font-mono text-orange-500/80">{toCurrency(row.propertyTax)}</td>
                                    <td className="p-4 text-right font-mono text-yellow-500/80">{toCurrency(row.insurance + row.repairs)}</td>
                                    <td className="p-4 text-right font-mono text-gray-400">{toCurrency(row.pmi + row.hoa)}</td>
                                    <td className="p-4 text-right font-mono font-bold text-gray-200 bg-gray-900/20">{toCurrency(row.totalCost)}</td>
                                    <td className="p-4 text-right font-mono text-blue-400 font-semibold">{toCurrency(row.endBalance)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
        </>
    );
}

// ============================================================================
// TAX DEBUG TAB
// ============================================================================
function TaxDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation } = useContext(SimulationContext);
    const { state: taxState } = useContext(TaxContext);
    const [selectedYear, setSelectedYear] = useState<number | null>(null);

    // Inputs for "what-if" scenarios
    const [filingStatus, setFilingStatus] = useState(taxState.filingStatus);
    const [additionalIncome, setAdditionalIncome] = useState(0);
    const [additionalDeductions, setAdditionalDeductions] = useState(0);
    const [focusYear, setFocusYear] = useState(new Date().getFullYear());

    const currentYear = new Date().getFullYear();
    const startAge = currentYear - assumptions.demographics.birthYear;

    // Calculate detailed tax info for each simulation year
    const taxData = useMemo(() => {
        if (simulation.length === 0) return [];

        return simulation.map((simYear, idx) => {
            const age = startAge + idx;
            const year = simYear.year;
            const incomes = simYear.incomes;
            const expenses = simYear.expenses;

            // Get tax parameters using the selected filing status
            const fedParams = getTaxParameters(year, filingStatus, 'federal', undefined, assumptions);
            const stateParams = getTaxParameters(year, filingStatus, 'state', taxState.stateResidency, assumptions);

            if (!fedParams) return null;

            // Income calculations (add additional income for what-if scenarios)
            // Include Roth conversions as they are taxable income
            const rothConversionAmount = simYear.rothConversion?.amount || 0;
            const baseGrossIncome = getGrossIncome(incomes, year) + rothConversionAmount;
            const grossIncome = baseGrossIncome + additionalIncome;
            const earnedIncome = getEarnedIncome(incomes, year) + additionalIncome;
            const preTaxDeductions = getPreTaxExemptions(incomes, year);
            const aboveLineDeductions = getYesDeductions(expenses, year) + additionalDeductions;
            const totalPreTax = preTaxDeductions + aboveLineDeductions;

            // Social Security
            const ssBenefits = getSocialSecurityBenefits(incomes, year);
            const agiExcludingSS = grossIncome - ssBenefits - totalPreTax;
            const taxableSS = getTaxableSocialSecurityBenefits(ssBenefits, agiExcludingSS, taxState.filingStatus);

            // AGI and deductions
            const agi = grossIncome - ssBenefits + taxableSS - totalPreTax;
            const itemizedDeductions = getItemizedDeductions(expenses, year);
            const saltCap = getSALTCap(year, taxState.filingStatus);
            const standardDeduction = fedParams.standardDeduction;
            const stateStandardDeduction = stateParams?.standardDeduction || 0;

            // Determine which deduction is better
            const usingItemized = itemizedDeductions > standardDeduction;
            const appliedDeduction = Math.max(itemizedDeductions, standardDeduction);

            // Taxable income
            const taxableIncome = Math.max(0, agi - appliedDeduction);

            // Calculate federal tax bracket by bracket
            const bracketBreakdown: Array<{ rate: number; amount: number; tax: number }> = [];
            let remainingIncome = taxableIncome;
            for (let i = 0; i < fedParams.brackets.length && remainingIncome > 0; i++) {
                const bracket = fedParams.brackets[i];
                const nextBracket = fedParams.brackets[i + 1];
                const upperLimit = nextBracket ? nextBracket.threshold : Infinity;
                const bracketSize = upperLimit - bracket.threshold;
                const amountInBracket = Math.min(remainingIncome, bracketSize);

                if (amountInBracket > 0) {
                    bracketBreakdown.push({
                        rate: bracket.rate,
                        amount: amountInBracket,
                        tax: amountInBracket * bracket.rate
                    });
                }
                remainingIncome -= amountInBracket;
            }

            const federalTax = bracketBreakdown.reduce((sum, b) => sum + b.tax, 0);
            const effectiveRate = taxableIncome > 0 ? federalTax / taxableIncome : 0;
            const marginalInfo = getMarginalTaxRate(taxableIncome, fedParams);

            // State tax - handle Social Security exemptions
            // Most states don't tax SS; those that do use the federal taxable portion
            let stateAdjustedGross = grossIncome - totalPreTax;
            if (ssBenefits > 0) {
                if (doesStateTaxSocialSecurity(taxState.stateResidency)) {
                    // States that tax SS: use only the taxable portion (like federal AGI)
                    stateAdjustedGross = agi;
                } else {
                    // States that don't tax SS: exclude SS benefits entirely
                    stateAdjustedGross = grossIncome - ssBenefits - totalPreTax;
                }
            }
            const stateTaxableIncome = stateParams ? Math.max(0, stateAdjustedGross - (stateParams.standardDeduction || 0)) : 0;
            const stateTax = stateParams ? calculateTax(stateAdjustedGross, 0, { ...stateParams, standardDeduction: stateParams.standardDeduction || 0 }) : 0;

            // FICA
            const ficaExemptions = getFicaExemptions(incomes, year);
            const ficaTaxableBase = Math.max(0, earnedIncome - ficaExemptions);
            const ssWageBase = fedParams.socialSecurityWageBase;
            const ssTax = Math.min(ficaTaxableBase, ssWageBase) * fedParams.socialSecurityTaxRate;
            const medicareTax = ficaTaxableBase * fedParams.medicareTaxRate;
            const totalFica = ssTax + medicareTax;

            // Capital gains from simulation
            const capitalGainsTax = simYear.taxDetails?.capitalGains || 0;

            return {
                year,
                age,
                grossIncome,
                earnedIncome,
                ssBenefits,
                taxableSS,
                preTaxDeductions,
                aboveLineDeductions,
                agi,
                standardDeduction,
                itemizedDeductions,
                usingItemized,
                appliedDeduction,
                saltCap,
                taxableIncome,
                bracketBreakdown,
                federalTax,
                effectiveRate,
                marginalInfo,
                stateTaxableIncome,
                stateTax,
                stateStandardDeduction,
                ficaTaxableBase,
                ssWageBase,
                ssTax,
                medicareTax,
                totalFica,
                capitalGainsTax,
                totalTax: federalTax + stateTax + totalFica + capitalGainsTax,
                fedParams,
                stateParams
            };
        }).filter(Boolean);
    }, [simulation, startAge, taxState, assumptions, filingStatus, additionalIncome, additionalDeductions]);

    // Calculate standalone "what-if" scenario for the focus year
    const whatIfCalc = useMemo(() => {
        const fedParams = getTaxParameters(focusYear, filingStatus, 'federal', undefined, assumptions);
        const stateParams = getTaxParameters(focusYear, filingStatus, 'state', taxState.stateResidency, assumptions);
        if (!fedParams) return null;

        const grossIncome = additionalIncome;
        const taxableIncome = Math.max(0, grossIncome - fedParams.standardDeduction - additionalDeductions);

        // Federal tax calculation
        let federalTax = 0;
        let remainingIncome = taxableIncome;
        const bracketBreakdown: Array<{ rate: number; amount: number; tax: number }> = [];

        for (let i = 0; i < fedParams.brackets.length && remainingIncome > 0; i++) {
            const bracket = fedParams.brackets[i];
            const nextBracket = fedParams.brackets[i + 1];
            const upperLimit = nextBracket ? nextBracket.threshold : Infinity;
            const bracketSize = upperLimit - bracket.threshold;
            const amountInBracket = Math.min(remainingIncome, bracketSize);

            if (amountInBracket > 0) {
                bracketBreakdown.push({
                    rate: bracket.rate,
                    amount: amountInBracket,
                    tax: amountInBracket * bracket.rate
                });
                federalTax += amountInBracket * bracket.rate;
            }
            remainingIncome -= amountInBracket;
        }

        // FICA
        const ssWageBase = fedParams.socialSecurityWageBase;
        const ssTax = Math.min(grossIncome, ssWageBase) * fedParams.socialSecurityTaxRate;
        const medicareTax = grossIncome * fedParams.medicareTaxRate;

        // State tax
        const stateTaxableIncome = stateParams ? Math.max(0, grossIncome - (stateParams.standardDeduction || 0) - additionalDeductions) : 0;
        const stateTax = stateParams ? calculateTax(grossIncome, additionalDeductions, stateParams) : 0;

        const totalTax = federalTax + ssTax + medicareTax + stateTax;
        const effectiveRate = grossIncome > 0 ? totalTax / grossIncome : 0;
        const marginalInfo = getMarginalTaxRate(taxableIncome, fedParams);

        return {
            grossIncome,
            standardDeduction: fedParams.standardDeduction,
            additionalDeductions,
            taxableIncome,
            bracketBreakdown,
            federalTax,
            ssWageBase,
            ssTax,
            medicareTax,
            stateTaxableIncome,
            stateTax,
            totalTax,
            effectiveRate,
            marginalInfo
        };
    }, [focusYear, filingStatus, additionalIncome, additionalDeductions, assumptions, taxState.stateResidency]);

    if (simulation.length === 0) {
        return (
            <div className="text-center py-8 text-gray-400">
                No simulation data. Run a simulation first.
            </div>
        );
    }

    const selectedData = selectedYear !== null
        ? taxData.find(d => d?.year === selectedYear)
        : null;

    return (
        <div className="space-y-6">
            {/* Inputs Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 bg-gray-900 p-6 rounded-xl border border-gray-800">
                <DropdownInput
                    label="Filing Status"
                    value={filingStatus}
                    onChange={(val) => setFilingStatus(val as typeof filingStatus)}
                    options={[
                        { value: 'Single', label: 'Single' },
                        { value: 'Married Filing Jointly', label: 'Married Filing Jointly' },
                        { value: 'Married Filing Separately', label: 'Married Filing Separately' },
                        { value: 'Head of Household', label: 'Head of Household' }
                    ]}
                />
                <CurrencyInput
                    label="Additional Income"
                    value={additionalIncome}
                    onChange={setAdditionalIncome}
                    tooltip="Add hypothetical income to see tax impact"
                />
                <CurrencyInput
                    label="Additional Deductions"
                    value={additionalDeductions}
                    onChange={setAdditionalDeductions}
                    tooltip="Add hypothetical deductions to see tax savings"
                />
                <NumberInput
                    label="Focus Year"
                    value={focusYear}
                    onChange={setFocusYear}
                />
            </div>

            {/* What-If Calculator Results */}
            {additionalIncome > 0 && whatIfCalc && (
                <div className="bg-linear-to-r from-purple-900/30 to-blue-900/30 p-4 rounded-xl border border-purple-700/50">
                    <h3 className="text-lg font-bold text-purple-300 mb-3">What-If Calculator ({focusYear})</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                            <span className="text-gray-400">Gross Income:</span>
                            <span className="ml-2 font-mono text-green-400">{toCurrencyShort(whatIfCalc.grossIncome)}</span>
                        </div>
                        <div>
                            <span className="text-gray-400">Std Deduction:</span>
                            <span className="ml-2 font-mono text-white">{toCurrencyShort(whatIfCalc.standardDeduction)}</span>
                        </div>
                        <div>
                            <span className="text-gray-400">Taxable Income:</span>
                            <span className="ml-2 font-mono text-white">{toCurrencyShort(whatIfCalc.taxableIncome)}</span>
                        </div>
                        <div>
                            <span className="text-gray-400">Marginal Rate:</span>
                            <span className="ml-2 font-mono text-amber-400">{(whatIfCalc.marginalInfo.rate * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm mt-3 pt-3 border-t border-purple-700/30">
                        <div>
                            <span className="text-gray-400">Federal:</span>
                            <span className="ml-2 font-mono text-amber-400">{toCurrencyShort(whatIfCalc.federalTax)}</span>
                        </div>
                        <div>
                            <span className="text-gray-400">State:</span>
                            <span className="ml-2 font-mono text-yellow-400">{toCurrencyShort(whatIfCalc.stateTax)}</span>
                        </div>
                        <div>
                            <span className="text-gray-400">SS Tax:</span>
                            <span className="ml-2 font-mono text-orange-400">{toCurrencyShort(whatIfCalc.ssTax)}</span>
                        </div>
                        <div>
                            <span className="text-gray-400">Medicare:</span>
                            <span className="ml-2 font-mono text-orange-400">{toCurrencyShort(whatIfCalc.medicareTax)}</span>
                        </div>
                        <div>
                            <span className="text-white font-semibold">Total Tax:</span>
                            <span className="ml-2 font-mono text-red-400 font-bold">{toCurrencyShort(whatIfCalc.totalTax)}</span>
                            <span className="ml-1 text-xs text-gray-400">({(whatIfCalc.effectiveRate * 100).toFixed(1)}%)</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Summary Header */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">Tax Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-gray-400">Filing Status:</span>
                        <span className="ml-2 text-white">{filingStatus}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">State:</span>
                        <span className="ml-2 text-white">{taxState.stateResidency}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Deduction Method:</span>
                        <span className="ml-2 text-white">{taxState.deductionMethod}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Current Year:</span>
                        <span className="ml-2 text-white">{currentYear}</span>
                    </div>
                </div>
            </div>

            {/* Year-by-Year Tax Table */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <h3 className="text-lg font-bold text-white p-4 border-b border-gray-800">
                    Tax Breakdown by Year (Click for details)
                </h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-800 sticky top-0">
                            <tr>
                                <th className="p-2 text-left text-gray-400">Year</th>
                                <th className="p-2 text-left text-gray-400">Age</th>
                                <th className="p-2 text-right text-gray-400">Gross Income</th>
                                <th className="p-2 text-right text-gray-400">Taxable</th>
                                <th className="p-2 text-right text-gray-400">Federal</th>
                                <th className="p-2 text-right text-gray-400">State</th>
                                <th className="p-2 text-right text-gray-400">FICA</th>
                                <th className="p-2 text-right text-gray-400">Cap Gains</th>
                                <th className="p-2 text-right text-gray-400">Total</th>
                                <th className="p-2 text-right text-gray-400">Eff. Rate</th>
                                <th className="p-2 text-right text-gray-400">Marginal</th>
                            </tr>
                        </thead>
                        <tbody>
                            {taxData.map(row => row && (
                                <tr
                                    key={row.year}
                                    className={`border-t border-gray-800 cursor-pointer hover:bg-gray-800 ${
                                        selectedYear === row.year ? 'bg-blue-900/30' : ''
                                    }`}
                                    onClick={() => setSelectedYear(row.year)}
                                >
                                    <td className="p-2 font-mono">{row.year}</td>
                                    <td className="p-2">{row.age}</td>
                                    <td className="p-2 text-right font-mono text-green-400">{toCurrencyShort(row.grossIncome)}</td>
                                    <td className="p-2 text-right font-mono text-gray-300">{toCurrencyShort(row.taxableIncome)}</td>
                                    <td className="p-2 text-right font-mono text-amber-400">{toCurrencyShort(row.federalTax)}</td>
                                    <td className="p-2 text-right font-mono text-yellow-400">{toCurrencyShort(row.stateTax)}</td>
                                    <td className="p-2 text-right font-mono text-orange-400">{toCurrencyShort(row.totalFica)}</td>
                                    <td className="p-2 text-right font-mono text-lime-400">{toCurrencyShort(row.capitalGainsTax)}</td>
                                    <td className="p-2 text-right font-mono text-red-400 font-semibold">{toCurrencyShort(row.totalTax)}</td>
                                    <td className="p-2 text-right font-mono text-gray-400">{(row.effectiveRate * 100).toFixed(1)}%</td>
                                    <td className="p-2 text-right font-mono text-gray-400">{(row.marginalInfo.rate * 100).toFixed(0)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Selected Year Details */}
            {selectedData && (
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                    <h3 className="text-lg font-bold text-white mb-4">
                        Year {selectedData.year} Details (Age {selectedData.age})
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Income Breakdown */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Income</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Gross Income:</span>
                                    <span className="font-mono text-green-400">{toCurrencyShort(selectedData.grossIncome)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Earned Income:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.earnedIncome)}</span>
                                </div>
                                {selectedData.ssBenefits > 0 && (
                                    <>
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">SS Benefits:</span>
                                            <span className="font-mono text-cyan-400">{toCurrencyShort(selectedData.ssBenefits)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Taxable SS ({((selectedData.taxableSS / selectedData.ssBenefits) * 100).toFixed(0)}%):</span>
                                            <span className="font-mono text-cyan-300">{toCurrencyShort(selectedData.taxableSS)}</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Deductions */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Deductions</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Pre-Tax (401k, etc):</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.preTaxDeductions)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Above-Line:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.aboveLineDeductions)}</span>
                                </div>
                                <div className="flex justify-between border-t border-gray-700 pt-1">
                                    <span className="text-gray-400">AGI:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.agi)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Standard Ded:</span>
                                    <span className={`font-mono ${!selectedData.usingItemized ? 'text-emerald-400' : 'text-gray-500'}`}>
                                        {toCurrencyShort(selectedData.standardDeduction)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Itemized Ded:</span>
                                    <span className={`font-mono ${selectedData.usingItemized ? 'text-emerald-400' : 'text-gray-500'}`}>
                                        {toCurrencyShort(selectedData.itemizedDeductions)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">SALT Cap:</span>
                                    <span className="font-mono text-gray-400">{toCurrencyShort(selectedData.saltCap)}</span>
                                </div>
                                <div className="flex justify-between border-t border-gray-700 pt-1">
                                    <span className="text-gray-300 font-medium">Taxable Income:</span>
                                    <span className="font-mono text-white font-semibold">{toCurrencyShort(selectedData.taxableIncome)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Federal Tax Brackets */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Federal Brackets</h4>
                            <div className="space-y-1 text-sm">
                                {selectedData.bracketBreakdown.map((bracket, i) => (
                                    <div key={i} className="flex justify-between">
                                        <span className="text-gray-400">{(bracket.rate * 100).toFixed(0)}% on {toCurrencyShort(bracket.amount)}:</span>
                                        <span className="font-mono text-amber-400">{toCurrencyShort(bracket.tax)}</span>
                                    </div>
                                ))}
                                <div className="flex justify-between border-t border-gray-700 pt-1">
                                    <span className="text-gray-300 font-medium">Total Federal:</span>
                                    <span className="font-mono text-amber-400 font-semibold">{toCurrencyShort(selectedData.federalTax)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Effective Rate:</span>
                                    <span className="font-mono text-gray-300">{(selectedData.effectiveRate * 100).toFixed(2)}%</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Marginal Rate:</span>
                                    <span className="font-mono text-gray-300">{(selectedData.marginalInfo.rate * 100).toFixed(0)}%</span>
                                </div>
                                {selectedData.marginalInfo.headroom < Infinity && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Headroom:</span>
                                        <span className="font-mono text-gray-300">{toCurrencyShort(selectedData.marginalInfo.headroom)}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* State Tax */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">State Tax ({taxState.stateResidency})</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Standard Ded:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.stateStandardDeduction)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Taxable Income:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.stateTaxableIncome)}</span>
                                </div>
                                <div className="flex justify-between border-t border-gray-700 pt-1">
                                    <span className="text-gray-300 font-medium">State Tax:</span>
                                    <span className="font-mono text-yellow-400 font-semibold">{toCurrencyShort(selectedData.stateTax)}</span>
                                </div>
                            </div>
                        </div>

                        {/* FICA */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">FICA / Payroll</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">FICA Taxable:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.ficaTaxableBase)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">SS Wage Base:</span>
                                    <span className="font-mono text-gray-400">{toCurrencyShort(selectedData.ssWageBase)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Social Security (6.2%):</span>
                                    <span className="font-mono text-orange-400">{toCurrencyShort(selectedData.ssTax)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Medicare (1.45%):</span>
                                    <span className="font-mono text-orange-400">{toCurrencyShort(selectedData.medicareTax)}</span>
                                </div>
                                <div className="flex justify-between border-t border-gray-700 pt-1">
                                    <span className="text-gray-300 font-medium">Total FICA:</span>
                                    <span className="font-mono text-orange-400 font-semibold">{toCurrencyShort(selectedData.totalFica)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Capital Gains */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Capital Gains</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Cap Gains Tax:</span>
                                    <span className="font-mono text-lime-400">{toCurrencyShort(selectedData.capitalGainsTax)}</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-2">
                                    From brokerage account withdrawals. Taxed at preferential long-term rates (0/15/20%).
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Total Summary */}
                    <div className="mt-4 p-3 bg-gray-800 rounded-lg">
                        <div className="flex justify-between items-center">
                            <span className="text-lg font-semibold text-white">Total Tax Burden</span>
                            <span className="text-xl font-mono text-red-400 font-bold">{toCurrencyShort(selectedData.totalTax)}</span>
                        </div>
                        <div className="text-sm text-gray-400 mt-1">
                            {((selectedData.totalTax / selectedData.grossIncome) * 100).toFixed(1)}% of gross income
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// SOCIAL SECURITY DEBUG TAB
// ============================================================================
function SocialSecurityDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation } = useContext(SimulationContext);
    const { incomes } = useContext(IncomeContext);

    const defaultBirthYear = assumptions.demographics.birthYear;

    // Inputs for what-if scenarios
    const [birthYearOverride, setBirthYearOverride] = useState(defaultBirthYear);
    const [priorYearsWorked, setPriorYearsWorked] = useState(0);
    const [priorAvgSalary, setPriorAvgSalary] = useState(0);
    const [wageGrowthRate, setWageGrowthRate] = useState(2.5);
    const [highlightClaimingAge, setHighlightClaimingAge] = useState(67);

    const birthYear = birthYearOverride;
    const currentYear = new Date().getFullYear();

    // Find Social Security income objects
    const ssIncomes = useMemo(() => {
        return incomes.filter(inc =>
            inc instanceof FutureSocialSecurityIncome || inc instanceof CurrentSocialSecurityIncome
        );
    }, [incomes]);

    // Build prior earnings from inputs
    const priorEarnings = useMemo(() => {
        if (priorYearsWorked <= 0 || priorAvgSalary <= 0) return [];
        const earnings = [];
        const startYear = currentYear - priorYearsWorked;
        for (let i = 0; i < priorYearsWorked; i++) {
            const year = startYear + i;
            const wageBase = getWageBase(year, wageGrowthRate / 100, true);
            earnings.push({
                year,
                amount: Math.min(priorAvgSalary, wageBase)
            });
        }
        return earnings;
    }, [priorYearsWorked, priorAvgSalary, currentYear, wageGrowthRate]);

    // Extract earnings from simulation + prior earnings
    const earningsHistory = useMemo(() => {
        const simEarnings = simulation.length > 0
            ? extractEarningsFromSimulation(simulation, undefined, true)
            : [];

        // Merge prior earnings with simulation earnings (prior takes precedence for overlapping years)
        const mergedMap = new Map<number, number>();
        priorEarnings.forEach(e => mergedMap.set(e.year, e.amount));
        simEarnings.forEach(e => {
            if (!mergedMap.has(e.year)) {
                mergedMap.set(e.year, e.amount);
            }
        });

        return Array.from(mergedMap.entries())
            .map(([year, amount]) => ({ year, amount }))
            .sort((a, b) => a.year - b.year);
    }, [simulation, priorEarnings]);

    // Calculate AIME for different claiming ages
    const claimingAnalysis = useMemo(() => {
        if (earningsHistory.length === 0) return null;

        const ages = [62, 63, 64, 65, 66, 67, 68, 69, 70];
        const fra = getFRA(birthYear);
        const calculationYear = birthYear + 62;

        return ages.map(age => {
            const result = calculateAIME(earningsHistory, calculationYear, age, birthYear, wageGrowthRate / 100, true);
            const adjustmentFactor = getClaimingAdjustment(age, fra);
            return {
                age,
                aime: result.aime,
                pia: result.pia,
                adjustedBenefit: result.adjustedBenefit,
                adjustmentFactor,
                annualBenefit: result.adjustedBenefit * 12,
                bendPoints: result.bendPoints,
                indexYear: result.indexYear
            };
        });
    }, [earningsHistory, birthYear, wageGrowthRate]);

    // Get detailed breakdown for the highlighted claiming age
    const detailedBreakdown = useMemo(() => {
        if (earningsHistory.length === 0) return null;
        const calculationYear = birthYear + 62;
        return calculateAIME(earningsHistory, calculationYear, highlightClaimingAge, birthYear, wageGrowthRate / 100, true);
    }, [earningsHistory, birthYear, highlightClaimingAge, wageGrowthRate]);

    const fra = getFRA(birthYear);
    const bendPoints = getBendPoints(birthYear + 62, wageGrowthRate / 100, true);

    return (
        <div className="space-y-6">
            {/* Inputs Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 bg-gray-900 p-6 rounded-xl border border-gray-800">
                <NumberInput
                    label="Birth Year"
                    value={birthYearOverride}
                    onChange={setBirthYearOverride}
                    tooltip="Override birth year for what-if analysis"
                />
                <NumberInput
                    label="Prior Years Worked"
                    value={priorYearsWorked}
                    onChange={setPriorYearsWorked}
                    tooltip="Years worked before simulation starts"
                />
                <CurrencyInput
                    label="Prior Avg Salary"
                    value={priorAvgSalary}
                    onChange={setPriorAvgSalary}
                    tooltip="Average salary during prior years"
                />
                <PercentageInput
                    label="Wage Growth Rate"
                    value={wageGrowthRate}
                    onChange={setWageGrowthRate}
                    tooltip="Assumed wage growth for projections"
                />
                <DropdownInput
                    label="Highlight Age"
                    value={highlightClaimingAge.toString()}
                    onChange={(v) => setHighlightClaimingAge(parseInt(v))}
                    options={[62, 63, 64, 65, 66, 67, 68, 69, 70].map(a => ({
                        value: a.toString(),
                        label: a === fra ? `${a} (FRA)` : a.toString()
                    }))}
                />
            </div>

            {/* Configuration */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">Social Security Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-gray-400">Birth Year:</span>
                        <span className="ml-2 text-white">{birthYear}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Full Retirement Age:</span>
                        <span className="ml-2 text-white">{fra}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Years of Earnings:</span>
                        <span className="ml-2 text-white">{earningsHistory.length}</span>
                        {priorYearsWorked > 0 && (
                            <span className="ml-1 text-xs text-cyan-400">({priorYearsWorked} prior)</span>
                        )}
                    </div>
                    <div>
                        <span className="text-gray-400">SS Income Objects:</span>
                        <span className="ml-2 text-white">{ssIncomes.length}</span>
                    </div>
                </div>
                {ssIncomes.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-800">
                        <span className="text-gray-400 text-sm">Current SS Incomes: </span>
                        {ssIncomes.map((inc, idx) => (
                            <span key={idx} className="text-xs bg-cyan-900/50 px-2 py-1 rounded mr-2">
                                {inc.name}: {toCurrencyShort(inc.amount)}/mo
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Bend Points Info */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">PIA Bend Points (Year {birthYear + 62})</h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="bg-gray-800 p-3 rounded-lg">
                        <div className="text-cyan-400 font-semibold">First Bend Point</div>
                        <div className="text-2xl font-mono text-white">{toCurrencyShort(bendPoints.first)}</div>
                        <div className="text-xs text-gray-400">90% of AIME up to this amount</div>
                    </div>
                    <div className="bg-gray-800 p-3 rounded-lg">
                        <div className="text-cyan-400 font-semibold">Second Bend Point</div>
                        <div className="text-2xl font-mono text-white">{toCurrencyShort(bendPoints.second)}</div>
                        <div className="text-xs text-gray-400">32% of AIME between bend points</div>
                    </div>
                    <div className="bg-gray-800 p-3 rounded-lg">
                        <div className="text-cyan-400 font-semibold">Above Second</div>
                        <div className="text-2xl font-mono text-white">15%</div>
                        <div className="text-xs text-gray-400">of AIME above second bend point</div>
                    </div>
                </div>
            </div>

            {/* Claiming Age Comparison */}
            {claimingAnalysis && (
                <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                    <h3 className="text-lg font-bold text-white p-4 border-b border-gray-800">
                        Benefit by Claiming Age
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-800">
                                <tr>
                                    <th className="p-2 text-left text-gray-400">Claiming Age</th>
                                    <th className="p-2 text-right text-gray-400">AIME</th>
                                    <th className="p-2 text-right text-gray-400">PIA (at FRA)</th>
                                    <th className="p-2 text-right text-gray-400">Adjustment</th>
                                    <th className="p-2 text-right text-gray-400">Monthly Benefit</th>
                                    <th className="p-2 text-right text-gray-400">Annual Benefit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {claimingAnalysis.map(row => (
                                    <tr
                                        key={row.age}
                                        className={`border-t border-gray-800 cursor-pointer hover:bg-gray-800 ${
                                            row.age === highlightClaimingAge ? 'bg-purple-900/30 ring-1 ring-purple-500' :
                                            row.age === fra ? 'bg-cyan-900/20' : ''
                                        }`}
                                        onClick={() => setHighlightClaimingAge(row.age)}
                                    >
                                        <td className="p-2 font-mono">
                                            {row.age}
                                            {row.age === highlightClaimingAge && (
                                                <span className="ml-2 text-xs bg-purple-900/50 px-1 rounded text-purple-400">Selected</span>
                                            )}
                                            {row.age === fra && row.age !== highlightClaimingAge && (
                                                <span className="ml-2 text-xs bg-cyan-900/50 px-1 rounded text-cyan-400">FRA</span>
                                            )}
                                            {row.age === 70 && row.age !== highlightClaimingAge && (
                                                <span className="ml-2 text-xs bg-green-900/50 px-1 rounded text-green-400">MAX</span>
                                            )}
                                        </td>
                                        <td className="p-2 text-right font-mono text-white">{toCurrencyShort(row.aime)}</td>
                                        <td className="p-2 text-right font-mono text-gray-400">{toCurrencyShort(row.pia)}</td>
                                        <td className={`p-2 text-right font-mono ${
                                            row.adjustmentFactor < 1 ? 'text-red-400' :
                                            row.adjustmentFactor > 1 ? 'text-green-400' : 'text-white'
                                        }`}>
                                            {(row.adjustmentFactor * 100).toFixed(1)}%
                                        </td>
                                        <td className="p-2 text-right font-mono text-cyan-400 font-semibold">
                                            {toCurrencyShort(row.adjustedBenefit)}
                                        </td>
                                        <td className="p-2 text-right font-mono text-cyan-300">
                                            {toCurrencyShort(row.annualBenefit)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Earnings History */}
            {earningsHistory.length > 0 && (
                <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                    <h3 className="text-lg font-bold text-white p-4 border-b border-gray-800">
                        Earnings History (from Simulation)
                    </h3>
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-800 sticky top-0">
                                <tr>
                                    <th className="p-2 text-left text-gray-400">Year</th>
                                    <th className="p-2 text-right text-gray-400">Earnings</th>
                                    <th className="p-2 text-right text-gray-400">SS Wage Base</th>
                                    <th className="p-2 text-right text-gray-400">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {earningsHistory.map(record => {
                                    const wageBase = getWageBase(record.year, 0.025, true);
                                    const atMax = record.amount >= wageBase * 0.99;
                                    return (
                                        <tr key={record.year} className="border-t border-gray-800">
                                            <td className="p-2 font-mono">{record.year}</td>
                                            <td className="p-2 text-right font-mono text-green-400">
                                                {toCurrencyShort(record.amount)}
                                            </td>
                                            <td className="p-2 text-right font-mono text-gray-400">
                                                {toCurrencyShort(wageBase)}
                                            </td>
                                            <td className="p-2 text-right">
                                                {atMax ? (
                                                    <span className="text-xs bg-green-900/50 px-2 py-0.5 rounded text-green-400">At Max</span>
                                                ) : (
                                                    <span className="text-xs text-gray-500">
                                                        {((record.amount / wageBase) * 100).toFixed(0)}% of max
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="p-3 border-t border-gray-800 text-xs text-gray-500">
                        Top 35 years of indexed earnings are used to calculate AIME. Earnings after age 60 are not indexed.
                    </div>
                </div>
            )}

            {/* Detailed PIA Breakdown */}
            {detailedBreakdown && (
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                    <h3 className="text-lg font-bold text-white mb-3">PIA Calculation Breakdown</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">AIME Calculation</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Index Year (Age 60):</span>
                                    <span className="font-mono text-white">{detailedBreakdown.indexYear}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Top 35 Earnings Sum:</span>
                                    <span className="font-mono text-white">
                                        {toCurrencyShort(detailedBreakdown.indexedEarnings.reduce((a, b) => a + b, 0))}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">÷ 420 months:</span>
                                    <span className="font-mono text-cyan-400 font-semibold">
                                        {toCurrencyShort(detailedBreakdown.aime)}/mo
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">PIA Formula</h4>
                            <div className="space-y-1 text-sm font-mono">
                                <div className="text-gray-400">
                                    90% × min({toCurrencyShort(detailedBreakdown.aime)}, {toCurrencyShort(detailedBreakdown.bendPoints.first)})
                                </div>
                                <div className="text-gray-400">
                                    + 32% × amount between ${detailedBreakdown.bendPoints.first} and ${detailedBreakdown.bendPoints.second}
                                </div>
                                <div className="text-gray-400">
                                    + 15% × amount above ${detailedBreakdown.bendPoints.second}
                                </div>
                                <div className="flex justify-between border-t border-gray-700 pt-1 mt-2">
                                    <span className="text-gray-300">= PIA:</span>
                                    <span className="text-cyan-400 font-semibold">{toCurrencyShort(detailedBreakdown.pia)}/mo</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {simulation.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                    No simulation data. Run a simulation to calculate Social Security benefits.
                </div>
            )}
        </div>
    );
}

// ============================================================================
// RMD DEBUG TAB
// ============================================================================
function RMDDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation } = useContext(SimulationContext);
    const { accounts } = useContext(AccountContext);

    const defaultBirthYear = assumptions.demographics.birthYear;

    // Inputs for what-if scenarios
    const [birthYearOverride, setBirthYearOverride] = useState(defaultBirthYear);
    const [additionalBalance, setAdditionalBalance] = useState(0);
    const [growthRate, setGrowthRate] = useState(6);
    const [focusAge, setFocusAge] = useState(75);

    const birthYear = birthYearOverride;
    const currentYear = new Date().getFullYear();
    const startYear = assumptions.demographics.priorYearMode ? currentYear - 1 : currentYear;
    const startAge = startYear - birthYear;

    // Get RMD-eligible accounts
    const rmdAccounts = useMemo(() => {
        return accounts.filter(acc => 'taxType' in acc && isAccountSubjectToRMD(acc.taxType));
    }, [accounts]);

    // Calculate standalone what-if RMD projection
    const whatIfProjection = useMemo(() => {
        if (additionalBalance <= 0) return null;

        const rmdStartAge = getRMDStartAge(birthYear);
        const projections = [];
        let balance = additionalBalance;

        for (let age = rmdStartAge; age <= 95; age++) {
            const distributionPeriod = getDistributionPeriod(age);
            const rmdAmount = calculateRMD(balance, age);
            const percentOfBalance = balance > 0 ? (rmdAmount / balance) * 100 : 0;

            projections.push({
                age,
                balance,
                distributionPeriod,
                rmdAmount,
                percentOfBalance
            });

            // Grow balance after RMD withdrawal
            balance = (balance - rmdAmount) * (1 + growthRate / 100);
            if (balance < 100) break;
        }

        return projections;
    }, [additionalBalance, birthYear, growthRate]);

    // Calculate RMD data for each year
    const rmdData = useMemo(() => {
        if (simulation.length === 0) return [];

        const rmdStartAge = getRMDStartAge(birthYear);

        return simulation.map((simYear, idx) => {
            const age = startAge + idx;
            const required = isRMDRequired(age, birthYear);
            const distributionPeriod = getDistributionPeriod(age);

            // Get account balances from simulation
            const accountBreakdown: RMDCalculation[] = [];
            let totalRMD = 0;
            let totalTraditionalBalance = 0;

            // Find RMD-eligible accounts in simulation
            simYear.accounts.forEach(simAcc => {
                const originalAccount = accounts.find(a => a.id === simAcc.id);
                if (originalAccount && 'taxType' in originalAccount && isAccountSubjectToRMD(originalAccount.taxType)) {
                    // RMD is based on prior year-end balance
                    // For first year, we use current balance; otherwise use prior year
                    const priorYearBalance = idx > 0
                        ? simulation[idx - 1].accounts.find(a => a.id === simAcc.id)?.amount || 0
                        : simAcc.amount;

                    const rmdAmount = required ? calculateRMD(priorYearBalance, age) : 0;
                    totalRMD += rmdAmount;
                    totalTraditionalBalance += simAcc.amount;

                    accountBreakdown.push({
                        accountName: simAcc.name,
                        accountId: simAcc.id,
                        priorYearBalance,
                        distributionPeriod,
                        rmdAmount
                    });
                }
            });

            return {
                year: simYear.year,
                age,
                required,
                distributionPeriod,
                totalRMD,
                totalTraditionalBalance,
                accountBreakdown,
                rmdStartAge
            };
        });
    }, [simulation, accounts, startAge, birthYear]);

    const rmdStartAge = getRMDStartAge(birthYear);

    return (
        <div className="space-y-6">
            {/* Inputs Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 bg-gray-900 p-6 rounded-xl border border-gray-800">
                <NumberInput
                    label="Birth Year"
                    value={birthYearOverride}
                    onChange={setBirthYearOverride}
                    tooltip="Override birth year to test different RMD start ages"
                />
                <CurrencyInput
                    label="Test Balance"
                    value={additionalBalance}
                    onChange={setAdditionalBalance}
                    tooltip="Enter a balance to see projected RMDs"
                />
                <PercentageInput
                    label="Growth Rate"
                    value={growthRate}
                    onChange={setGrowthRate}
                    tooltip="Assumed annual growth rate for projections"
                />
                <NumberInput
                    label="Focus Age"
                    value={focusAge}
                    onChange={setFocusAge}
                    tooltip="Age to highlight in the table"
                />
            </div>

            {/* What-If RMD Projection */}
            {whatIfProjection && whatIfProjection.length > 0 && (
                <div className="bg-linear-to-r from-amber-900/30 to-orange-900/30 p-4 rounded-xl border border-amber-700/50">
                    <h3 className="text-lg font-bold text-amber-300 mb-3">
                        What-If RMD Projection ({toCurrencyShort(additionalBalance)} starting balance, {growthRate}% growth)
                    </h3>
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-amber-900/30 sticky top-0">
                                <tr>
                                    <th className="p-2 text-left text-amber-300">Age</th>
                                    <th className="p-2 text-right text-amber-300">Balance (BOY)</th>
                                    <th className="p-2 text-right text-amber-300">Dist. Period</th>
                                    <th className="p-2 text-right text-amber-300">RMD Amount</th>
                                    <th className="p-2 text-right text-amber-300">% of Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {whatIfProjection.map(row => (
                                    <tr
                                        key={row.age}
                                        className={`border-t border-amber-800/30 ${
                                            row.age === focusAge ? 'bg-amber-900/40 ring-1 ring-amber-500' : ''
                                        }`}
                                    >
                                        <td className="p-2 font-mono">
                                            {row.age}
                                            {row.age === rmdStartAge && (
                                                <span className="ml-2 text-xs bg-amber-900/50 px-1 rounded text-amber-400">Start</span>
                                            )}
                                        </td>
                                        <td className="p-2 text-right font-mono text-white">{toCurrencyShort(row.balance)}</td>
                                        <td className="p-2 text-right font-mono text-gray-400">{row.distributionPeriod.toFixed(1)}</td>
                                        <td className="p-2 text-right font-mono text-amber-400 font-semibold">{toCurrencyShort(row.rmdAmount)}</td>
                                        <td className="p-2 text-right font-mono text-gray-400">{row.percentOfBalance.toFixed(1)}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Configuration */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">RMD Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-gray-400">Birth Year:</span>
                        <span className="ml-2 text-white">{birthYear}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">RMD Start Age:</span>
                        <span className="ml-2 text-white">{rmdStartAge}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">RMD-Eligible Accounts:</span>
                        <span className="ml-2 text-white">{rmdAccounts.length}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Current Age:</span>
                        <span className="ml-2 text-white">{startAge}</span>
                    </div>
                </div>
                {rmdAccounts.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-800">
                        <span className="text-gray-400 text-sm">Traditional Accounts: </span>
                        {rmdAccounts.map((acc, idx) => (
                            <span key={idx} className="text-xs bg-amber-900/50 px-2 py-1 rounded mr-2">
                                {acc.name}: {toCurrencyShort(acc.amount)}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* RMD Start Age Rules */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">SECURE Act 2.0 RMD Rules</h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className={`bg-gray-800 p-3 rounded-lg ${birthYear <= 1950 ? 'ring-2 ring-amber-500' : ''}`}>
                        <div className="text-amber-400 font-semibold">Born 1950 or earlier</div>
                        <div className="text-2xl font-mono text-white">Age 72</div>
                    </div>
                    <div className={`bg-gray-800 p-3 rounded-lg ${birthYear > 1950 && birthYear <= 1959 ? 'ring-2 ring-amber-500' : ''}`}>
                        <div className="text-amber-400 font-semibold">Born 1951-1959</div>
                        <div className="text-2xl font-mono text-white">Age 73</div>
                    </div>
                    <div className={`bg-gray-800 p-3 rounded-lg ${birthYear >= 1960 ? 'ring-2 ring-amber-500' : ''}`}>
                        <div className="text-amber-400 font-semibold">Born 1960 or later</div>
                        <div className="text-2xl font-mono text-white">Age 75</div>
                    </div>
                </div>
            </div>

            {/* RMD Table by Year - from Simulation */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <h3 className="text-lg font-bold text-white p-4 border-b border-gray-800">
                    RMD by Year (From Your Simulation)
                    <span className="ml-2 text-xs font-normal text-gray-500">
                        Based on your Traditional 401k/IRA accounts
                    </span>
                </h3>
                {rmdData.length === 0 || rmdAccounts.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">
                        {simulation.length === 0 ? (
                            <p>No simulation data. Run a simulation first to see RMD projections for your accounts.</p>
                        ) : rmdAccounts.length === 0 ? (
                            <p>No Traditional 401k or Traditional IRA accounts found. RMDs only apply to pre-tax retirement accounts.</p>
                        ) : (
                            <p>No RMD data available.</p>
                        )}
                        <p className="mt-2 text-sm">Use the "Test Balance" input above to see a standalone RMD projection.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-800 sticky top-0">
                                <tr>
                                    <th className="p-2 text-left text-gray-400">Year</th>
                                    <th className="p-2 text-left text-gray-400">Age</th>
                                    <th className="p-2 text-right text-gray-400">Distribution Period</th>
                                    <th className="p-2 text-right text-gray-400">Traditional Balance</th>
                                    <th className="p-2 text-right text-gray-400">Required RMD</th>
                                    <th className="p-2 text-right text-gray-400">% of Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rmdData.map(row => (
                                    <tr
                                        key={row.year}
                                        className={`border-t border-gray-800 ${
                                            row.age === row.rmdStartAge ? 'bg-amber-900/20' : ''
                                        } ${!row.required ? 'opacity-50' : ''}`}
                                    >
                                        <td className="p-2 font-mono">{row.year}</td>
                                        <td className="p-2">
                                            {row.age}
                                            {row.age === row.rmdStartAge && (
                                                <span className="ml-2 text-xs bg-amber-900/50 px-1 rounded text-amber-400">RMD Starts</span>
                                            )}
                                        </td>
                                        <td className="p-2 text-right font-mono text-gray-400">
                                            {row.required ? row.distributionPeriod.toFixed(1) : '-'}
                                        </td>
                                        <td className="p-2 text-right font-mono text-white">
                                            {toCurrencyShort(row.totalTraditionalBalance)}
                                        </td>
                                        <td className="p-2 text-right font-mono text-amber-400 font-semibold">
                                            {row.required ? toCurrencyShort(row.totalRMD) : '-'}
                                        </td>
                                        <td className="p-2 text-right font-mono text-gray-400">
                                            {row.required && row.totalTraditionalBalance > 0
                                                ? `${((row.totalRMD / row.totalTraditionalBalance) * 100).toFixed(1)}%`
                                                : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Distribution Period Table */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">IRS Uniform Lifetime Table (Excerpt)</h3>
                <div className="grid grid-cols-4 md:grid-cols-6 gap-2 text-sm">
                    {[73, 75, 80, 85, 90, 95].map(age => (
                        <div key={age} className={`bg-gray-800 p-2 rounded text-center ${
                            startAge === age ? 'ring-2 ring-amber-500' : ''
                        }`}>
                            <div className="text-gray-400 text-xs">Age {age}</div>
                            <div className="font-mono text-white">{getDistributionPeriod(age).toFixed(1)}</div>
                            <div className="text-xs text-amber-400">
                                {(100 / getDistributionPeriod(age)).toFixed(1)}%
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-3 text-xs text-gray-500">
                    Distribution Period = Life expectancy factor. RMD = Prior Year Balance ÷ Distribution Period.
                    The percentage shown is the effective withdrawal rate for that age.
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// TAX BRACKET VISUALIZATION TAB
// ============================================================================
function TaxBracketVisualizationTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation } = useContext(SimulationContext);
    const { state: taxState } = useContext(TaxContext);

    const currentYear = new Date().getFullYear();
    const birthYear = assumptions.demographics.birthYear;

    // Selector state
    const [filingStatus, setFilingStatus] = useState(taxState.filingStatus);

    // Build bracket visualization data for each simulation year
    const bracketData = useMemo(() => {
        if (simulation.length === 0) return [];

        return simulation.slice(0, 40).map((simYear) => {
            const year = simYear.year;
            const age = year - birthYear;
            const fedParams = getTaxParameters(year, filingStatus, 'federal', undefined, assumptions);
            if (!fedParams) return null;

            // Get taxable income from simulation
            // Include Roth conversions as they are taxable income
            const rothConversionAmount = simYear.rothConversion?.amount || 0;
            const grossIncome = getGrossIncome(simYear.incomes, year) + rothConversionAmount;
            const preTaxDeductions = getPreTaxExemptions(simYear.incomes, year, age);
            const aboveLineDeductions = getYesDeductions(simYear.expenses, year);
            const totalPreTax = preTaxDeductions + aboveLineDeductions;

            // Social Security adjustments
            const ssBenefits = getSocialSecurityBenefits(simYear.incomes, year);
            const agiExcludingSS = grossIncome - ssBenefits - totalPreTax;
            const taxableSS = getTaxableSocialSecurityBenefits(ssBenefits, agiExcludingSS, filingStatus);
            const agi = grossIncome - ssBenefits + taxableSS - totalPreTax;

            const taxableIncome = Math.max(0, agi - fedParams.standardDeduction);

            // Calculate how income fills each bracket
            const bracketFill: Array<{
                rate: number;
                threshold: number;
                nextThreshold: number;
                bracketSize: number;
                amountInBracket: number;
                percentFilled: number;
                taxFromBracket: number;
            }> = [];

            let remainingIncome = taxableIncome;
            let totalTax = 0;

            for (let i = 0; i < fedParams.brackets.length; i++) {
                const bracket = fedParams.brackets[i];
                const nextBracket = fedParams.brackets[i + 1];
                const nextThreshold = nextBracket ? nextBracket.threshold : Infinity;
                const bracketSize = nextThreshold - bracket.threshold;
                const amountInBracket = Math.min(Math.max(0, remainingIncome), bracketSize);
                const percentFilled = bracketSize === Infinity ? 0 : (amountInBracket / bracketSize) * 100;
                const taxFromBracket = amountInBracket * bracket.rate;

                bracketFill.push({
                    rate: bracket.rate,
                    threshold: bracket.threshold,
                    nextThreshold,
                    bracketSize,
                    amountInBracket,
                    percentFilled,
                    taxFromBracket
                });

                totalTax += taxFromBracket;
                remainingIncome -= amountInBracket;
            }

            // Find current marginal bracket
            const marginalBracket = bracketFill.find(b => b.amountInBracket > 0 && b.amountInBracket < b.bracketSize)
                || bracketFill.filter(b => b.amountInBracket > 0).pop();

            return {
                year,
                age,
                grossIncome,
                taxableIncome,
                bracketFill,
                totalTax,
                effectiveRate: taxableIncome > 0 ? totalTax / taxableIncome : 0,
                marginalRate: marginalBracket?.rate || 0,
                standardDeduction: fedParams.standardDeduction
            };
        }).filter(Boolean);
    }, [simulation, birthYear, filingStatus, assumptions]);

    // Bracket colors
    const bracketColors: Record<number, string> = {
        0.10: 'bg-green-600',
        0.12: 'bg-green-500',
        0.22: 'bg-yellow-500',
        0.24: 'bg-orange-500',
        0.32: 'bg-red-500',
        0.35: 'bg-red-600',
        0.37: 'bg-red-700'
    };

    if (simulation.length === 0) {
        return <div className="text-gray-400 text-center py-8">No simulation data. Run a simulation first.</div>;
    }

    return (
        <div className="space-y-6">
            {/* Selector Controls */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <DropdownInput
                    label="Filing Status"
                    value={filingStatus}
                    onChange={(val) => setFilingStatus(val as typeof filingStatus)}
                    options={[
                        { value: 'Single', label: 'Single' },
                        { value: 'Married Filing Jointly', label: 'Married Filing Jointly' },
                        { value: 'Married Filing Separately', label: 'Married Filing Separately' }
                    ]}
                />
            </div>

            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4">Tax Bracket Visualization</h3>
                <p className="text-gray-400 text-sm mb-4">
                    Shows how your income fills federal tax brackets each year. Each bar represents one year of the simulation.
                </p>

                {/* Legend */}
                <div className="flex flex-wrap gap-3 mb-6">
                    {Object.entries(bracketColors).map(([rate, color]) => (
                        <div key={rate} className="flex items-center gap-1">
                            <div className={`w-4 h-4 rounded ${color}`} />
                            <span className="text-xs text-gray-300">{(parseFloat(rate) * 100).toFixed(0)}%</span>
                        </div>
                    ))}
                </div>

                {/* Year-by-year bracket visualization */}
                <div className="space-y-2 max-h-125 overflow-y-auto pl-2">
                    {bracketData.map((data: any) => (
                        <div key={data.year} className="flex items-center gap-2 pr-2">
                            {/* Year/Age label */}
                            <div className="w-24 text-right text-xs text-gray-400 shrink-0">
                                {data.year} (Age {data.age})
                            </div>

                            {/* Bracket bar */}
                            <div className="flex-1 h-6 bg-gray-800 rounded overflow-hidden flex">
                                {data.bracketFill.filter((b: any) => b.amountInBracket > 0).map((b: any, i: number) => {
                                    const widthPercent = data.taxableIncome > 0
                                        ? (b.amountInBracket / data.taxableIncome) * 100
                                        : 0;
                                    return (
                                        <div
                                            key={i}
                                            className={`${bracketColors[b.rate] || 'bg-gray-600'} h-full`}
                                            style={{ width: `${widthPercent}%` }}
                                            title={`${(b.rate * 100).toFixed(0)}%: ${toCurrencyShort(b.amountInBracket)}`}
                                        />
                                    );
                                })}
                            </div>

                            {/* Stats */}
                            <div className="w-32 text-right text-xs shrink-0">
                                <span className="text-gray-300">{toCurrencyShort(data.taxableIncome)}</span>
                                <span className="text-gray-500 ml-1">@ {(data.marginalRate * 100).toFixed(0)}%</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Detailed breakdown for selected years */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4">Bracket Details by Year</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-700">
                                <th className="text-left p-2 text-gray-400">Year</th>
                                <th className="text-left p-2 text-gray-400">Age</th>
                                <th className="text-right p-2 text-gray-400">Gross</th>
                                <th className="text-right p-2 text-gray-400">Std Ded</th>
                                <th className="text-right p-2 text-gray-400">Taxable</th>
                                <th className="text-right p-2 text-gray-400">Fed Tax</th>
                                <th className="text-right p-2 text-gray-400">Effective</th>
                                <th className="text-right p-2 text-gray-400">Marginal</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bracketData.slice(0, 20).map((data: any) => (
                                <tr key={data.year} className="border-b border-gray-800 hover:bg-gray-800/50">
                                    <td className="p-2 text-white">{data.year}</td>
                                    <td className="p-2 text-gray-300">{data.age}</td>
                                    <td className="p-2 text-right text-gray-300">{toCurrencyShort(data.grossIncome)}</td>
                                    <td className="p-2 text-right text-gray-400">{toCurrencyShort(data.standardDeduction)}</td>
                                    <td className="p-2 text-right text-white">{toCurrencyShort(data.taxableIncome)}</td>
                                    <td className="p-2 text-right text-red-400">{toCurrencyShort(data.totalTax)}</td>
                                    <td className="p-2 text-right text-amber-400">{(data.effectiveRate * 100).toFixed(1)}%</td>
                                    <td className="p-2 text-right text-orange-400">{(data.marginalRate * 100).toFixed(0)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Bracket thresholds over time */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-2">
                    Federal Bracket Thresholds Over Time ({filingStatus})
                </h3>
                <p className="text-gray-400 text-sm mb-4">
                    {assumptions.macro.inflationAdjusted
                        ? `Shows how tax bracket thresholds inflate based on ${assumptions.macro.inflationRate}% assumed inflation rate.`
                        : 'Inflation adjustment is disabled. Bracket thresholds remain at current year values.'}
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-700">
                                <th className="text-left p-2 text-gray-400">Year</th>
                                <th className="text-right p-2 text-gray-400">Std Ded</th>
                                {[10, 12, 22, 24, 32, 35, 37].map(rate => (
                                    <th key={rate} className="text-right p-2">
                                        <span className={`px-2 py-0.5 rounded text-xs ${bracketColors[rate / 100] || 'bg-gray-600'} text-white`}>
                                            {rate}%
                                        </span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {(() => {
                                const years: number[] = [];
                                for (let y = currentYear; y <= currentYear + 30; y += 5) {
                                    years.push(y);
                                }
                                // Also add specific simulation years
                                if (bracketData.length > 0) {
                                    [0, 10, 20, 30].forEach(offset => {
                                        const d = bracketData[offset];
                                        if (d && !years.includes(d.year)) {
                                            years.push(d.year);
                                        }
                                    });
                                }
                                years.sort((a, b) => a - b);

                                return years.slice(0, 10).map(year => {
                                    const params = getTaxParameters(year, filingStatus, 'federal', undefined, assumptions);
                                    if (!params) return null;

                                    return (
                                        <tr key={year} className="border-b border-gray-800 hover:bg-gray-800/50">
                                            <td className="p-2 text-white font-medium">{year}</td>
                                            <td className="p-2 text-right text-green-400">{toCurrencyShort(params.standardDeduction)}</td>
                                            {params.brackets.map((bracket, i) => {
                                                const nextBracket = params.brackets[i + 1];
                                                return (
                                                    <td key={i} className="p-2 text-right text-gray-300">
                                                        {toCurrencyShort(bracket.threshold)}
                                                        {nextBracket && (
                                                            <span className="text-gray-500 text-xs ml-1">
                                                                → {toCurrencyShort(nextBracket.threshold - 1)}
                                                            </span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                });
                            })()}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
}

// ============================================================================
// PENSION DEBUG TAB
// ============================================================================
function PensionDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation } = useContext(SimulationContext);
    const { incomes } = useContext(IncomeContext);

    const birthYear = assumptions.demographics.birthYear;

    // Find pension incomes
    const fersPensions = incomes.filter(inc => inc instanceof FERSPensionIncome) as FERSPensionIncome[];
    const csrsPensions = incomes.filter(inc => inc instanceof CSRSPensionIncome) as CSRSPensionIncome[];
    const hasPensions = fersPensions.length > 0 || csrsPensions.length > 0;

    // Get work incomes for potential High-3 calculation
    const workIncomes = incomes.filter(inc => inc instanceof WorkIncome) as WorkIncome[];

    // FERS calculations
    const fersDetails = useMemo(() => {
        return fersPensions.map(pension => {
            const mra = getFERSMRA(birthYear);
            const eligibility = checkFERSEligibility(pension.retirementAge, pension.yearsOfService, birthYear);
            const baseBenefit = calculateFERSBasicBenefit(pension.yearsOfService, pension.high3Salary, pension.retirementAge);
            const earlyReduction = getFERSEarlyReduction(pension.retirementAge);
            const reducedBenefit = baseBenefit * earlyReduction * (1 - eligibility.reductionPercent / 100);

            // Simulate COLA growth
            const colaProjection: Array<{ age: number; year: number; cola: number; benefit: number }> = [];
            let projectedBenefit = reducedBenefit;
            const inflationRate = assumptions.macro.inflationRate / 100;

            for (let age = pension.retirementAge; age <= assumptions.demographics.lifeExpectancy; age++) {
                const cola = getFERSCOLA(inflationRate, age);
                if (age > pension.retirementAge) {
                    projectedBenefit *= (1 + cola);
                }
                colaProjection.push({
                    age,
                    year: birthYear + age,
                    cola: cola * 100,
                    benefit: projectedBenefit
                });
            }

            return {
                pension,
                mra,
                eligibility,
                baseBenefit,
                earlyReduction,
                reducedBenefit,
                colaProjection
            };
        });
    }, [fersPensions, birthYear, assumptions]);

    // CSRS calculations
    const csrsDetails = useMemo(() => {
        return csrsPensions.map(pension => {
            const eligibility = checkCSRSEligibility(pension.retirementAge, pension.yearsOfService);
            const baseBenefit = calculateCSRSBasicBenefit(pension.yearsOfService, pension.high3Salary);
            const reducedBenefit = baseBenefit * (1 - eligibility.reductionPercent / 100);

            // Simulate COLA growth
            const colaProjection: Array<{ age: number; year: number; cola: number; benefit: number }> = [];
            let projectedBenefit = reducedBenefit;
            const inflationRate = assumptions.macro.inflationRate / 100;

            for (let age = pension.retirementAge; age <= assumptions.demographics.lifeExpectancy; age++) {
                const cola = getCSRSCOLA(inflationRate);
                if (age > pension.retirementAge) {
                    projectedBenefit *= (1 + cola);
                }
                colaProjection.push({
                    age,
                    year: birthYear + age,
                    cola: cola * 100,
                    benefit: projectedBenefit
                });
            }

            return {
                pension,
                eligibility,
                baseBenefit,
                reducedBenefit,
                colaProjection
            };
        });
    }, [csrsPensions, birthYear, assumptions]);

    // High-3 tracking from simulation
    const high3Tracking = useMemo(() => {
        if (simulation.length === 0 || workIncomes.length === 0) return null;

        const salaryHistory: Array<{ year: number; age: number; salary: number }> = [];

        simulation.forEach((simYear) => {
            const year = simYear.year;
            const age = year - birthYear;

            simYear.incomes.forEach(inc => {
                if (inc instanceof WorkIncome) {
                    salaryHistory.push({
                        year,
                        age,
                        salary: inc.amount
                    });
                }
            });
        });

        // Calculate running High-3
        const high3History: Array<{ year: number; age: number; high3: number; salaries: number[] }> = [];
        for (let i = 2; i < salaryHistory.length; i++) {
            const lastThree = [salaryHistory[i - 2].salary, salaryHistory[i - 1].salary, salaryHistory[i].salary];
            const high3 = lastThree.reduce((a, b) => a + b, 0) / 3;
            high3History.push({
                year: salaryHistory[i].year,
                age: salaryHistory[i].age,
                high3,
                salaries: lastThree
            });
        }

        return { salaryHistory, high3History };
    }, [simulation, workIncomes, birthYear]);

    if (!hasPensions && workIncomes.length === 0) {
        return (
            <div className="text-gray-400 text-center py-8">
                <p>No pension or work income data to analyze.</p>
                <p className="text-sm mt-2">Add a FERS or CSRS pension to see detailed calculations.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* FERS vs CSRS Comparison */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4">Pension System Comparison</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-gray-800 p-4 rounded-lg">
                        <h4 className="font-semibold text-cyan-400 mb-2">FERS</h4>
                        <ul className="text-sm text-gray-300 space-y-1">
                            <li>• {PENSION_SYSTEM_COMPARISON.FERS.basicBenefitFormula}</li>
                            <li>• COLA: {PENSION_SYSTEM_COMPARISON.FERS.cola}</li>
                            <li>• Social Security: {PENSION_SYSTEM_COMPARISON.FERS.socialSecurity}</li>
                            <li>• Supplement: {PENSION_SYSTEM_COMPARISON.FERS.supplement}</li>
                        </ul>
                    </div>
                    <div className="bg-gray-800 p-4 rounded-lg">
                        <h4 className="font-semibold text-amber-400 mb-2">CSRS</h4>
                        <ul className="text-sm text-gray-300 space-y-1">
                            <li>• {PENSION_SYSTEM_COMPARISON.CSRS.basicBenefitFormula}</li>
                            <li>• COLA: {PENSION_SYSTEM_COMPARISON.CSRS.cola}</li>
                            <li>• Social Security: {PENSION_SYSTEM_COMPARISON.CSRS.socialSecurity}</li>
                            <li>• Max Benefit: {PENSION_SYSTEM_COMPARISON.CSRS.maxBenefit}</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* FERS Pensions */}
            {fersDetails.map((detail, idx) => (
                <div key={idx} className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                    <h3 className="text-lg font-semibold text-cyan-400 mb-4">
                        FERS Pension: {detail.pension.name}
                    </h3>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">Years of Service</div>
                            <div className="text-xl font-bold text-white">{detail.pension.yearsOfService}</div>
                        </div>
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">High-3 Salary</div>
                            <div className="text-xl font-bold text-white">{toCurrencyShort(detail.pension.high3Salary)}</div>
                        </div>
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">Retirement Age</div>
                            <div className="text-xl font-bold text-white">{detail.pension.retirementAge}</div>
                        </div>
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">MRA (Birth {birthYear})</div>
                            <div className="text-xl font-bold text-white">{detail.mra}</div>
                        </div>
                    </div>

                    {/* Benefit Calculation Breakdown */}
                    <div className="bg-gray-800 p-4 rounded mb-4">
                        <h4 className="font-semibold text-white mb-3">Benefit Calculation</h4>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-400">Multiplier ({detail.pension.retirementAge >= 62 && detail.pension.yearsOfService >= 20 ? '1.1%' : '1.0%'})</span>
                                <span className="text-gray-300">{detail.pension.retirementAge >= 62 && detail.pension.yearsOfService >= 20 ? '1.1%' : '1.0%'} per year</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Base Benefit ({detail.pension.yearsOfService} years × High-3)</span>
                                <span className="text-white font-semibold">{toCurrency(detail.baseBenefit)}/year</span>
                            </div>
                            {detail.earlyReduction < 1 && (
                                <div className="flex justify-between text-red-400">
                                    <span>Early Retirement Reduction</span>
                                    <span>-{((1 - detail.earlyReduction) * 100).toFixed(0)}%</span>
                                </div>
                            )}
                            {detail.eligibility.reductionPercent > 0 && (
                                <div className="flex justify-between text-red-400">
                                    <span>MRA+10 Reduction</span>
                                    <span>-{detail.eligibility.reductionPercent}%</span>
                                </div>
                            )}
                            <div className="flex justify-between border-t border-gray-700 pt-2">
                                <span className="text-green-400 font-semibold">Final Annual Benefit</span>
                                <span className="text-green-400 font-bold">{toCurrency(detail.reducedBenefit)}/year</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Monthly</span>
                                <span className="text-gray-300">{toCurrency(detail.reducedBenefit / 12)}/month</span>
                            </div>
                        </div>
                    </div>

                    {/* Eligibility */}
                    <div className={`p-3 rounded mb-4 ${detail.eligibility.eligible ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                        <div className={`font-semibold ${detail.eligibility.eligible ? 'text-green-400' : 'text-red-400'}`}>
                            {detail.eligibility.message}
                        </div>
                    </div>

                    {/* COLA Projection */}
                    <div className="bg-gray-800 p-4 rounded">
                        <h4 className="font-semibold text-white mb-3">COLA Projection (Inflation: {assumptions.macro.inflationRate}%)</h4>
                        <div className="text-xs text-gray-400 mb-2">
                            {"FERS COLA: None before age 62. After 62: Full if CPI ≤ 2%, 2% if 2-3%, CPI-1% if > 3%"}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-700">
                                        <th className="text-left p-2 text-gray-400">Age</th>
                                        <th className="text-left p-2 text-gray-400">Year</th>
                                        <th className="text-right p-2 text-gray-400">COLA</th>
                                        <th className="text-right p-2 text-gray-400">Annual Benefit</th>
                                        <th className="text-right p-2 text-gray-400">Monthly</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.colaProjection.slice(0, 15).map((row: any) => (
                                        <tr key={row.age} className={`border-b border-gray-800 ${row.age === 62 ? 'bg-cyan-900/20' : ''}`}>
                                            <td className="p-2 text-white">{row.age}</td>
                                            <td className="p-2 text-gray-300">{row.year}</td>
                                            <td className="p-2 text-right text-cyan-400">{row.cola.toFixed(1)}%</td>
                                            <td className="p-2 text-right text-white">{toCurrencyShort(row.benefit)}</td>
                                            <td className="p-2 text-right text-gray-300">{toCurrencyShort(row.benefit / 12)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ))}

            {/* CSRS Pensions */}
            {csrsDetails.map((detail, idx) => (
                <div key={idx} className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                    <h3 className="text-lg font-semibold text-amber-400 mb-4">
                        CSRS Pension: {detail.pension.name}
                    </h3>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">Years of Service</div>
                            <div className="text-xl font-bold text-white">{detail.pension.yearsOfService}</div>
                        </div>
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">High-3 Salary</div>
                            <div className="text-xl font-bold text-white">{toCurrencyShort(detail.pension.high3Salary)}</div>
                        </div>
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">Retirement Age</div>
                            <div className="text-xl font-bold text-white">{detail.pension.retirementAge}</div>
                        </div>
                    </div>

                    {/* Benefit Calculation Breakdown */}
                    <div className="bg-gray-800 p-4 rounded mb-4">
                        <h4 className="font-semibold text-white mb-3">CSRS Benefit Calculation</h4>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-400">First 5 years @ 1.5%</span>
                                <span className="text-gray-300">{toCurrency(Math.min(detail.pension.yearsOfService, 5) * detail.pension.high3Salary * 0.015)}</span>
                            </div>
                            {detail.pension.yearsOfService > 5 && (
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Years 6-10 @ 1.75%</span>
                                    <span className="text-gray-300">{toCurrency(Math.min(detail.pension.yearsOfService - 5, 5) * detail.pension.high3Salary * 0.0175)}</span>
                                </div>
                            )}
                            {detail.pension.yearsOfService > 10 && (
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Years 11+ @ 2.0%</span>
                                    <span className="text-gray-300">{toCurrency((detail.pension.yearsOfService - 10) * detail.pension.high3Salary * 0.02)}</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span className="text-gray-400">Base Benefit</span>
                                <span className="text-white font-semibold">{toCurrency(detail.baseBenefit)}/year</span>
                            </div>
                            <div className="flex justify-between text-xs text-gray-500">
                                <span>Max (80% of High-3)</span>
                                <span>{toCurrency(detail.pension.high3Salary * 0.8)}</span>
                            </div>
                            {detail.eligibility.reductionPercent > 0 && (
                                <div className="flex justify-between text-red-400">
                                    <span>Early Retirement Reduction</span>
                                    <span>-{detail.eligibility.reductionPercent}%</span>
                                </div>
                            )}
                            <div className="flex justify-between border-t border-gray-700 pt-2">
                                <span className="text-green-400 font-semibold">Final Annual Benefit</span>
                                <span className="text-green-400 font-bold">{toCurrency(detail.reducedBenefit)}/year</span>
                            </div>
                        </div>
                    </div>

                    {/* Eligibility */}
                    <div className={`p-3 rounded mb-4 ${detail.eligibility.eligible ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                        <div className={`font-semibold ${detail.eligibility.eligible ? 'text-green-400' : 'text-red-400'}`}>
                            {detail.eligibility.message}
                        </div>
                    </div>

                    {/* COLA Projection */}
                    <div className="bg-gray-800 p-4 rounded">
                        <h4 className="font-semibold text-white mb-3">COLA Projection (Inflation: {assumptions.macro.inflationRate}%)</h4>
                        <div className="text-xs text-gray-400 mb-2">
                            CSRS receives full CPI COLA regardless of age.
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-700">
                                        <th className="text-left p-2 text-gray-400">Age</th>
                                        <th className="text-left p-2 text-gray-400">Year</th>
                                        <th className="text-right p-2 text-gray-400">COLA</th>
                                        <th className="text-right p-2 text-gray-400">Annual Benefit</th>
                                        <th className="text-right p-2 text-gray-400">Monthly</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.colaProjection.slice(0, 15).map((row: any) => (
                                        <tr key={row.age} className="border-b border-gray-800">
                                            <td className="p-2 text-white">{row.age}</td>
                                            <td className="p-2 text-gray-300">{row.year}</td>
                                            <td className="p-2 text-right text-amber-400">{row.cola.toFixed(1)}%</td>
                                            <td className="p-2 text-right text-white">{toCurrencyShort(row.benefit)}</td>
                                            <td className="p-2 text-right text-gray-300">{toCurrencyShort(row.benefit / 12)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ))}

            {/* High-3 Tracking from Work Income */}
            {high3Tracking && high3Tracking.high3History.length > 0 && (
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                    <h3 className="text-lg font-semibold text-white mb-4">High-3 Salary Tracking (From Simulation)</h3>
                    <p className="text-sm text-gray-400 mb-4">
                        Your High-3 is the average of your highest 3 consecutive years of salary.
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-700">
                                    <th className="text-left p-2 text-gray-400">Year</th>
                                    <th className="text-left p-2 text-gray-400">Age</th>
                                    <th className="text-right p-2 text-gray-400">Year -2</th>
                                    <th className="text-right p-2 text-gray-400">Year -1</th>
                                    <th className="text-right p-2 text-gray-400">Current</th>
                                    <th className="text-right p-2 text-gray-400">High-3 Avg</th>
                                </tr>
                            </thead>
                            <tbody>
                                {high3Tracking.high3History.map((row: any) => (
                                    <tr key={row.year} className="border-b border-gray-800 hover:bg-gray-800/50">
                                        <td className="p-2 text-white">{row.year}</td>
                                        <td className="p-2 text-gray-300">{row.age}</td>
                                        <td className="p-2 text-right text-gray-400">{toCurrencyShort(row.salaries[0])}</td>
                                        <td className="p-2 text-right text-gray-400">{toCurrencyShort(row.salaries[1])}</td>
                                        <td className="p-2 text-right text-gray-300">{toCurrencyShort(row.salaries[2])}</td>
                                        <td className="p-2 text-right text-green-400 font-semibold">{toCurrencyShort(row.high3)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// ROTH CONVERSIONS DEBUG TAB
// ============================================================================
function RothConversionsDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation } = useContext(SimulationContext);
    const { accounts } = useContext(AccountContext);

    const birthYear = assumptions.demographics.birthYear;
    const retirementAge = assumptions.demographics.retirementAge;

    // Get all years with Roth conversions
    const conversionData = useMemo(() => {
        if (simulation.length === 0) return [];

        return simulation.map((simYear) => {
            const age = simYear.year - birthYear;
            const isRetired = age >= retirementAge;
            const hasConversion = simYear.rothConversion && simYear.rothConversion.amount > 0;

            // Get withdrawal amounts from cashflow
            const totalWithdrawals = simYear.cashflow.withdrawals || 0;

            // Calculate income breakdown
            // totalIncome = regular income + withdrawals (does NOT include conversions)
            const totalTax = simYear.taxDetails.fed + simYear.taxDetails.state + simYear.taxDetails.fica;
            const conversionAmount = simYear.rothConversion?.amount || 0;
            const conversionTax = simYear.rothConversion?.taxCost || 0;

            // Base income = total income (already excludes conversions since we reverted that fix)
            const baseIncome = simYear.cashflow.totalIncome;

            // Regular income = income from sources OTHER than withdrawals (SS, pensions, interest, wages)
            // We calculate this directly from income objects to avoid issues with tax-free vs taxable withdrawals
            const regularIncome = simYear.incomes.reduce((sum, inc) => {
                const amount = inc.getAnnualAmount ? inc.getAnnualAmount(simYear.year) : (inc.amount || 0);
                return sum + amount;
            }, 0);

            // Taxable income base includes conversions (for effective rate calculation)
            const taxableIncomeBase = baseIncome + conversionAmount;

            // Calculate effective rates
            const baseEffectiveRate = baseIncome > 0 ? ((totalTax - conversionTax) / baseIncome) : 0;
            const conversionEffectiveRate = conversionAmount > 0 ? (conversionTax / conversionAmount) : 0;
            // Combined rate uses taxable income base (includes conversion)
            const combinedEffectiveRate = taxableIncomeBase > 0 ? (totalTax / taxableIncomeBase) : 0;

            // RMD info if available
            const rmdAmount = simYear.rmdDetails?.totalWithdrawn || 0;

            return {
                year: simYear.year,
                age,
                isRetired,
                hasConversion,
                regularIncome,
                withdrawals: totalWithdrawals,
                rmdAmount,
                baseIncome,
                conversionAmount,
                totalIncome: simYear.cashflow.totalIncome,
                taxableIncomeBase, // Includes conversion for effective rate calc
                baseTax: totalTax - conversionTax,
                conversionTax,
                totalTax,
                baseEffectiveRate,
                conversionEffectiveRate,
                combinedEffectiveRate,
                fromAccounts: simYear.rothConversion?.fromAccounts || {},
                toAccounts: simYear.rothConversion?.toAccounts || {},
                withdrawalDetail: simYear.cashflow.withdrawalDetail || {},
                logs: simYear.logs.filter(log =>
                    log.includes('Roth') ||
                    log.includes('conversion') ||
                    log.includes('withdraw') ||
                    log.includes('RMD')
                )
            };
        });
    }, [simulation, birthYear, retirementAge]);

    // Summary stats
    const summary = useMemo(() => {
        const conversions = conversionData.filter(d => d.hasConversion);
        const totalConverted = conversions.reduce((sum, d) => sum + d.conversionAmount, 0);
        const totalTaxPaid = conversions.reduce((sum, d) => sum + d.conversionTax, 0);
        const avgConversionRate = totalConverted > 0 ? (totalTaxPaid / totalConverted) : 0;

        return {
            totalYearsWithConversions: conversions.length,
            totalConverted,
            totalTaxPaid,
            avgConversionRate,
            firstConversionYear: conversions[0]?.year,
            lastConversionYear: conversions[conversions.length - 1]?.year
        };
    }, [conversionData]);

    // Get Traditional and Roth accounts for context
    const traditionalAccounts = accounts.filter(acc =>
        'taxType' in acc && (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
    );
    const rothAccounts = accounts.filter(acc =>
        'taxType' in acc && (acc.taxType === 'Roth 401k' || acc.taxType === 'Roth IRA')
    );

    // Filter state
    const [showOnlyConversions, setShowOnlyConversions] = useState(false);
    const [showRetiredOnly, setShowRetiredOnly] = useState(true);

    if (simulation.length === 0) {
        return <div className="text-gray-400 text-center py-8">No simulation data. Run a simulation first.</div>;
    }

    const yearsWithConversions = conversionData.filter(d => d.hasConversion);

    // Apply filters
    const filteredData = conversionData.filter(d => {
        if (showRetiredOnly && !d.isRetired) return false;
        if (showOnlyConversions && !d.hasConversion) return false;
        return true;
    });

    return (
        <div className="space-y-6">
            {/* Filter Controls */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4">Filters & Controls</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <ToggleInput
                        label="Show Only Conversion Years"
                        enabled={showOnlyConversions}
                        setEnabled={setShowOnlyConversions}
                        tooltip="Filter to only show years where Roth conversions occurred"
                    />
                    <ToggleInput
                        label="Show Only Retirement Years"
                        enabled={showRetiredOnly}
                        setEnabled={setShowRetiredOnly}
                        tooltip="Filter to only show years after retirement"
                    />
                </div>
            </div>

            {/* Configuration Status */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4">Roth Conversion Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <span className="text-gray-400 text-sm">Auto Conversions</span>
                        <p className={`font-semibold ${assumptions.investments.autoRothConversions ? 'text-green-400' : 'text-red-400'}`}>
                            {assumptions.investments.autoRothConversions ? 'Enabled' : 'Disabled'}
                        </p>
                    </div>
                    <div>
                        <span className="text-gray-400 text-sm">Traditional Accounts</span>
                        <p className="text-white font-semibold">{traditionalAccounts.length}</p>
                    </div>
                    <div>
                        <span className="text-gray-400 text-sm">Roth Accounts</span>
                        <p className="text-white font-semibold">{rothAccounts.length}</p>
                    </div>
                    <div>
                        <span className="text-gray-400 text-sm">Retirement Age</span>
                        <p className="text-white font-semibold">{retirementAge}</p>
                    </div>
                </div>
            </div>

            {/* Summary Stats */}
            {yearsWithConversions.length > 0 && (
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                    <h3 className="text-lg font-semibold text-white mb-4">Conversion Summary</h3>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div>
                            <span className="text-gray-400 text-sm">Years with Conversions</span>
                            <p className="text-white font-semibold text-xl">{summary.totalYearsWithConversions}</p>
                        </div>
                        <div>
                            <span className="text-gray-400 text-sm">Total Converted</span>
                            <p className="text-green-400 font-semibold text-xl">{toCurrencyShort(summary.totalConverted)}</p>
                        </div>
                        <div>
                            <span className="text-gray-400 text-sm">Total Tax Paid</span>
                            <p className="text-red-400 font-semibold text-xl">{toCurrencyShort(summary.totalTaxPaid)}</p>
                        </div>
                        <div>
                            <span className="text-gray-400 text-sm">Avg Conversion Rate</span>
                            <p className="text-amber-400 font-semibold text-xl">{(summary.avgConversionRate * 100).toFixed(1)}%</p>
                        </div>
                        <div>
                            <span className="text-gray-400 text-sm">Conversion Period</span>
                            <p className="text-white font-semibold">{summary.firstConversionYear} - {summary.lastConversionYear}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Year-by-Year Conversion Details */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4">Year-by-Year Analysis</h3>
                <p className="text-gray-400 text-sm mb-4">
                    Income breakdown: Regular = SS/pensions/interest | Withdrawals = 401k/IRA pulls | Conv = Roth conversion.
                    Base Income = Regular + Withdrawals (excludes conversion).
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-700">
                                <th className="text-left p-2 text-gray-400">Year</th>
                                <th className="text-left p-2 text-gray-400">Age</th>
                                <th className="text-right p-2 text-gray-400">Regular</th>
                                <th className="text-right p-2 text-gray-400">Withdrawals</th>
                                <th className="text-right p-2 text-gray-400">Conversion</th>
                                <th className="text-right p-2 text-gray-400">Taxable Inc</th>
                                <th className="text-right p-2 text-gray-400">Total Tax</th>
                                <th className="text-right p-2 text-gray-400">Conv Tax</th>
                                <th className="text-right p-2 text-gray-400">Conv Rate</th>
                                <th className="text-right p-2 text-gray-400">Combined</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredData
                                .slice(0, 40)
                                .map(row => (
                                    <tr
                                        key={row.year}
                                        className={`border-b border-gray-800 hover:bg-gray-800/50 ${row.hasConversion ? 'bg-blue-900/20' : ''}`}
                                    >
                                        <td className="p-2 text-white">{row.year}</td>
                                        <td className="p-2 text-gray-300">{row.age}</td>
                                        <td className="p-2 text-right text-gray-400">{toCurrencyShort(row.regularIncome)}</td>
                                        <td className={`p-2 text-right ${row.withdrawals > 0 ? 'text-purple-400' : 'text-gray-600'}`}>
                                            {row.withdrawals > 0 ? toCurrencyShort(row.withdrawals) : '-'}
                                        </td>
                                        <td className={`p-2 text-right font-semibold ${row.hasConversion ? 'text-blue-400' : 'text-gray-600'}`}>
                                            {row.hasConversion ? toCurrencyShort(row.conversionAmount) : '-'}
                                        </td>
                                        <td className="p-2 text-right text-white" title={`Cash: ${toCurrencyShort(row.totalIncome)}, Taxable: ${toCurrencyShort(row.taxableIncomeBase)}`}>
                                            {toCurrencyShort(row.taxableIncomeBase)}
                                        </td>
                                        <td className="p-2 text-right text-red-400">{toCurrencyShort(row.totalTax)}</td>
                                        <td className={`p-2 text-right ${row.hasConversion ? 'text-red-400' : 'text-gray-600'}`}>
                                            {row.hasConversion ? toCurrencyShort(row.conversionTax) : '-'}
                                        </td>
                                        <td className={`p-2 text-right font-semibold ${row.hasConversion ? 'text-amber-400' : 'text-gray-600'}`}>
                                            {row.hasConversion ? `${(row.conversionEffectiveRate * 100).toFixed(1)}%` : '-'}
                                        </td>
                                        <td className={`p-2 text-right font-semibold ${
                                            row.combinedEffectiveRate > 0.5 ? 'text-red-500' :
                                            row.combinedEffectiveRate > 0.3 ? 'text-orange-400' : 'text-green-400'
                                        }`}>
                                            {(row.combinedEffectiveRate * 100).toFixed(1)}%
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Account Flow Details */}
            {yearsWithConversions.length > 0 && (
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                    <h3 className="text-lg font-semibold text-white mb-4">Conversion Flow by Year</h3>
                    <div className="space-y-4 max-h-100 overflow-y-auto">
                        {yearsWithConversions.map(row => (
                            <div key={row.year} className="bg-gray-800 p-3 rounded-lg">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="font-semibold text-white">{row.year} (Age {row.age})</span>
                                    <span className="text-blue-400">{toCurrencyShort(row.conversionAmount)} converted</span>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <span className="text-xs text-gray-400 uppercase">From (Traditional)</span>
                                        {Object.entries(row.fromAccounts).map(([name, amount]) => (
                                            <div key={name} className="flex justify-between text-sm">
                                                <span className="text-gray-300">{name}</span>
                                                <span className="text-red-400">-{toCurrencyShort(amount as number)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div>
                                        <span className="text-xs text-gray-400 uppercase">To (Roth)</span>
                                        {Object.entries(row.toAccounts).map(([name, amount]) => (
                                            <div key={name} className="flex justify-between text-sm">
                                                <span className="text-gray-300">{name}</span>
                                                <span className="text-green-400">+{toCurrencyShort(amount as number)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="mt-2 text-xs text-gray-400">
                                    Tax: {toCurrencyShort(row.conversionTax)} ({(row.conversionEffectiveRate * 100).toFixed(1)}% rate)
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Diagnostic: High Tax Rate Years */}
            {(() => {
                const highTaxYears = conversionData.filter(d => d.combinedEffectiveRate > 0.4 && d.isRetired);
                if (highTaxYears.length === 0) return null;

                return (
                    <div className="bg-red-900/20 border border-red-800 p-4 rounded-lg">
                        <h3 className="text-lg font-semibold text-red-400 mb-4">⚠️ High Effective Tax Rate Years</h3>
                        <p className="text-gray-400 text-sm mb-4">
                            These years have combined effective tax rates above 40%. This may indicate an issue with tax calculations or unusually large conversions.
                        </p>
                        <div className="space-y-2">
                            {highTaxYears.slice(0, 10).map(row => (
                                <div key={row.year} className="bg-gray-900 p-3 rounded flex justify-between items-center">
                                    <div>
                                        <span className="text-white font-semibold">{row.year}</span>
                                        <span className="text-gray-400 ml-2">(Age {row.age})</span>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-red-400 font-semibold">{(row.combinedEffectiveRate * 100).toFixed(1)}% effective</div>
                                        <div className="text-xs text-gray-400">
                                            Base: {toCurrencyShort(row.baseIncome)} |
                                            Conv: {toCurrencyShort(row.conversionAmount)} |
                                            Tax: {toCurrencyShort(row.totalTax)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })()}

            {/* No Conversions Message */}
            {yearsWithConversions.length === 0 && (
                <div className="bg-gray-900 p-8 rounded-lg border border-gray-800 text-center">
                    <p className="text-gray-400">
                        {assumptions.investments.autoRothConversions
                            ? 'No Roth conversions were performed in the simulation. This could be because you have no Traditional accounts, no Roth accounts, or the tax brackets were already filled.'
                            : 'Auto Roth Conversions are disabled. Enable them in Assumptions → Investments to see conversion analysis.'}
                    </p>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// MAIN TESTING COMPONENT WITH TABS
// ============================================================================
const TESTING_TABS = ['Simulation Debug', 'Tax Debug', 'Tax Brackets', 'Social Security', 'Pensions', 'RMDs', 'Roth Conversions', 'Mortgage'];

export default function Testing() {
    const [activeTab, setActiveTab] = useState(() => {
        const saved = localStorage.getItem('stag_testing_tab');
        return saved && TESTING_TABS.includes(saved) ? saved : 'Simulation Debug';
    });

    // Persist tab selection
    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        localStorage.setItem('stag_testing_tab', tab);
    };

    return (
        <div className="w-full min-h-screen bg-gray-950 text-gray-100 p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto">
                <h2 className="text-3xl font-bold mb-4 text-fuchsia-500">
                    Testing & Debugging
                </h2>

                {/* Tab Navigation */}
                <div className="bg-gray-900 rounded-lg overflow-hidden mb-4 flex border border-gray-800">
                    {TESTING_TABS.map(tab => (
                        <button
                            key={tab}
                            onClick={() => handleTabChange(tab)}
                            className={`flex-1 font-semibold p-3 transition-colors duration-200 ${
                                activeTab === tab
                                    ? 'text-green-300 bg-gray-800 border-b-2 border-green-300'
                                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                {activeTab === 'Simulation Debug' && <SimulationDebugTab />}
                {activeTab === 'Tax Debug' && <TaxDebugTab />}
                {activeTab === 'Tax Brackets' && <TaxBracketVisualizationTab />}
                {activeTab === 'Social Security' && <SocialSecurityDebugTab />}
                {activeTab === 'Pensions' && <PensionDebugTab />}
                {activeTab === 'RMDs' && <RMDDebugTab />}
                {activeTab === 'Roth Conversions' && <RothConversionsDebugTab />}
                {activeTab === 'Mortgage' && <MortgageTestingTab />}
            </div>
        </div>
    );
}