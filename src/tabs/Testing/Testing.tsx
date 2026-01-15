import { useState, useMemo, useContext } from 'react';
import { MortgageExpense } from '../../components/Objects/Expense/models';
import { CurrencyInput } from '../../components/Layout/InputFields/CurrencyInput';
import { PercentageInput } from '../../components/Layout/InputFields/PercentageInput';
import { NumberInput } from '../../components/Layout/InputFields/NumberInput';
import { AssumptionsContext } from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { WorkIncome, FutureSocialSecurityIncome, CurrentSocialSecurityIncome, PassiveIncome } from '../../components/Objects/Income/models';

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
    const { simulation } = useContext(SimulationContext);
    const { accounts } = useContext(AccountContext);
    const [selectedYear, setSelectedYear] = useState<number | null>(null);

    const retirementAge = assumptions.demographics.retirementAge;
    const startAge = assumptions.demographics.startAge;

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
                // Skip expense swing warning for first year of retirement (expected drop in 401k, FICA, etc.)
                if (!isFirstRetirementYear && prevExpenseTotal > 0 && Math.abs(currExpenseTotal - prevExpenseTotal) / prevExpenseTotal > 0.5) {
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

    if (simulation.length === 0) {
        return (
            <div className="text-center py-8 text-gray-400">
                No simulation data. Go to the Future tab and run a simulation first.
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
// MAIN TESTING COMPONENT WITH TABS
// ============================================================================
const TESTING_TABS = ['Simulation Debug', 'Mortgage'];

export default function Testing() {
    const [activeTab, setActiveTab] = useState('Simulation Debug');

    return (
        <div className="w-full min-h-screen bg-gray-950 text-gray-100 p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto">
                <h2 className="text-3xl font-bold mb-4 text-fuchsia-500">
                    Testing & Debugging
                </h2>

                {/* Tab Navigation */}
                <div className="flex gap-2 mb-6 border-b border-gray-800 pb-2">
                    {TESTING_TABS.map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-2 rounded-t-lg font-semibold transition-colors ${
                                activeTab === tab
                                    ? 'bg-gray-800 text-white border-b-2 border-fuchsia-500'
                                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                {activeTab === 'Simulation Debug' && <SimulationDebugTab />}
                {activeTab === 'Mortgage' && <MortgageTestingTab />}
            </div>
        </div>
    );
}