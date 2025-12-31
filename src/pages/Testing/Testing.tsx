import { useContext } from 'react';
import { AccountContext } from '../../components/Accounts/AccountContext';
import { IncomeContext } from '../../components/Income/IncomeContext';
import { ExpenseContext } from '../../components/Expense/ExpenseContext';
import { useSimulation } from '../../components/Assumptions/useSimulation';

// Import Models for formatting/instanceof checks
import { 
    PropertyAccount
} from '../../components/Accounts/models';
import { 
    MortgageExpense, 
} from '../../components/Expense/models';
import { AnyAccount as AccountType } from '../../components/Accounts/models';

export default function Testing() {
    // 1. Grab Current Data (for the "Current" column in tables)
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);

    // 2. Run the Simulation (Just 1 year for debugging)
    const timeline = useSimulation(1);
    const nextYearData = timeline[1] || null;

    // Helper to format currency
    const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

    return (
        <div className="p-6 space-y-8 bg-gray-50 min-h-screen">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-800">Simulation Debugger</h1>
                <div className="px-4 py-2 bg-blue-100 text-blue-800 rounded font-semibold text-sm">
                    {nextYearData ? "Simulation Active" : "Loading..."}
                </div>
            </div>

            {!nextYearData ? (
                <div className="text-gray-500 italic">Initializing Simulation Engine...</div>
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    
                    {/* LEFT COLUMN: Comparison Tables */}
                    <div className="space-y-6">
                        
                        {/* INCOMES */}
                        <div className="bg-white p-4 rounded shadow border border-gray-200">
                            <h3 className="font-bold text-lg mb-4 text-fuchsia-700">Incomes</h3>
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-100 font-semibold text-gray-600">
                                    <tr>
                                        <th className="p-2">Name</th>
                                        <th className="p-2 text-right">Current</th>
                                        <th className="p-2 text-right">Next Year</th>
                                        <th className="p-2 text-right">Growth</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {incomes.map((inc) => {
                                        const next = nextYearData.incomes.find(n => n.id === inc.id);
                                        if (!next) return null;
                                        const currAmount = inc.getAnnualAmount();
                                        const nextAmount = next.getAnnualAmount();
                                        return (
                                            <tr key={inc.id} className="border-b">
                                                <td className="p-2 font-medium">{inc.name}</td>
                                                <td className="p-2 text-right">{fmt(currAmount)}</td>
                                                <td className="p-2 text-right font-bold text-gray-800">{fmt(nextAmount)}</td>
                                                <td className="p-2 text-right text-green-600">
                                                    {((nextAmount / currAmount - 1) * 100).toFixed(2)}%
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* MONTHLY WITHHOLDINGS & TAXES */}
                        <div className="bg-white p-4 rounded shadow border border-gray-200">
                            <h3 className="font-bold text-lg mb-4 text-orange-600">Monthly Taxes & Deductions</h3>
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-100 font-semibold text-gray-600">
                                    <tr>
                                        <th className="p-2">Category</th>
                                        <th className="p-2 text-right">Annual</th>
                                        <th className="p-2 text-right">Monthly</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    <tr>
                                        <td className="p-2 font-medium">Federal Tax</td>
                                        <td className="p-2 text-right">{fmt(nextYearData.taxDetails.fed)}</td>
                                        <td className="p-2 text-right font-bold">{fmt(nextYearData.taxDetails.fed / 12)}</td>
                                    </tr>
                                    <tr>
                                        <td className="p-2 font-medium">State Tax</td>
                                        <td className="p-2 text-right">{fmt(nextYearData.taxDetails.state)}</td>
                                        <td className="p-2 text-right font-bold">{fmt(nextYearData.taxDetails.state / 12)}</td>
                                    </tr>
                                    <tr>
                                        <td className="p-2 font-medium">FICA (SS/Med)</td>
                                        <td className="p-2 text-right">{fmt(nextYearData.taxDetails.fica)}</td>
                                        <td className="p-2 text-right font-bold">{fmt(nextYearData.taxDetails.fica / 12)}</td>
                                    </tr>
                                    <tr>
                                        <td className="p-2 font-medium text-blue-600">Pre-Tax (401k/HSA)</td>
                                        <td className="p-2 text-right">{fmt(nextYearData.taxDetails.preTax)}</td>
                                        <td className="p-2 text-right font-bold">{fmt(nextYearData.taxDetails.preTax / 12)}</td>
                                    </tr>
                                    <tr>
                                        <td className="p-2 font-medium text-red-600">Insurance (Pre-Tax)</td>
                                        <td className="p-2 text-right">{fmt(nextYearData.taxDetails.insurance)}</td>
                                        <td className="p-2 text-right font-bold">{fmt(nextYearData.taxDetails.insurance / 12)}</td>
                                    </tr>
                                    <tr>
                                        <td className="p-2 font-medium text-blue-600">Post-Tax (Roth)</td>
                                        <td className="p-2 text-right">{fmt(nextYearData.taxDetails.postTax)}</td>
                                        <td className="p-2 text-right font-bold">{fmt(nextYearData.taxDetails.postTax / 12)}</td>
                                    </tr>
                                    <tr className="bg-orange-50 font-bold">
                                        <td className="p-2">TOTAL WITHHELD</td>
                                        <td className="p-2 text-right">
                                            {fmt(nextYearData.taxDetails.fed + nextYearData.taxDetails.state + nextYearData.taxDetails.fica + nextYearData.taxDetails.preTax + nextYearData.taxDetails.postTax + nextYearData.taxDetails.insurance)}
                                        </td>
                                        <td className="p-2 text-right">
                                            {fmt((nextYearData.taxDetails.fed + nextYearData.taxDetails.state + nextYearData.taxDetails.fica + nextYearData.taxDetails.preTax + nextYearData.taxDetails.postTax + nextYearData.taxDetails.insurance) / 12)}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* EXPENSES */}
                        <div className="bg-white p-4 rounded shadow border border-gray-200">
                            <h3 className="font-bold text-lg mb-4 text-red-700">Expenses</h3>
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-100 font-semibold text-gray-600">
                                    <tr>
                                        <th className="p-2">Name</th>
                                        <th className="p-2 text-right">Annual</th>
                                        <th className="p-2 text-right">Next Year</th>
                                        <th className="p-2 text-right">Change</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {expenses.map((exp) => {
                                        const next = nextYearData.expenses.find(n => n.id === exp.id);
                                        if (!next) return null;
                                        const currAmount = exp.getAnnualAmount();
                                        const nextAmount = next.getAnnualAmount();
                                        const diff = nextAmount - currAmount;
                                        
                                        let extraInfo = "";
                                        if (exp instanceof MortgageExpense && next instanceof MortgageExpense) {
                                            extraInfo = `(Bal: ${fmt(next.loan_balance)})`;
                                        }

                                        return (
                                            <tr key={exp.id} className="border-b">
                                                <td className="p-2 font-medium">
                                                    {exp.name} 
                                                    <div className="text-xs text-gray-400 font-normal">{exp.constructor.name}</div>
                                                </td>
                                                <td className="p-2 text-right">{fmt(currAmount)}</td>
                                                <td className="p-2 text-right font-bold text-gray-800">
                                                    {fmt(nextAmount)}
                                                    <div className="text-xs text-gray-500 font-normal">{extraInfo}</div>
                                                </td>
                                                <td className={`p-2 text-right ${diff > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                    {diff > 0 ? '+' : ''}{fmt(diff)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Summary & Logs */}
                    <div className="space-y-6">
                        {/* Summary Card */}
                        <div className="bg-slate-800 text-white p-6 rounded-lg shadow space-y-3">
                            <h3 className="text-xl font-bold border-b border-slate-600 pb-2">Next Year Summary</h3>
                            
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>Gross Income</div>
                                <div className="text-right font-mono">{fmt(nextYearData.cashflow.totalIncome)}</div>
                                
                                <div>Total Expenses (Tax+Living)</div>
                                <div className="text-right text-red-400 font-mono">-{fmt(nextYearData.cashflow.totalExpense)}</div>
                                
                                <div>Discretionary (Unused)</div>
                                <div className="text-right text-yellow-400 font-mono">{fmt(nextYearData.cashflow.discretionary)}</div>
                            </div>

                            <div className="pt-4 border-t border-slate-600">
                                <div className="flex justify-between items-end">
                                    <div>
                                        <div className="font-bold text-blue-400">Total Invested/Saved</div>
                                        <div className="text-xs text-slate-400">Your Contributions + Employer Match</div>
                                    </div>
                                    <div className="text-2xl font-bold font-mono text-blue-400">
                                        {fmt(nextYearData.cashflow.totalInvested)}
                                    </div>
                                </div>
                                <div className="text-right text-xs text-slate-500 mt-1">
                                    (User: {fmt(nextYearData.cashflow.investedUser)} + Match: {fmt(nextYearData.cashflow.investedMatch)})
                                </div>
                            </div>
                        </div>

                        {/* ACCOUNTS */}
                        <div className="bg-white p-4 rounded shadow border border-gray-200">
                            <h3 className="font-bold text-lg mb-4 text-blue-700">Accounts</h3>
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-100 font-semibold text-gray-600">
                                    <tr>
                                        <th className="p-2">Name</th>
                                        <th className="p-2 text-right">Current</th>
                                        <th className="p-2 text-right">Next Year</th>
                                        <th className="p-2 text-right">Diff</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accounts.map((acc) => {
                                        const next = nextYearData.accounts.find(n => n.id === acc.id);
                                        if (!next) return null;
                                        
                                        const getVal = (a: AccountType) => (a instanceof PropertyAccount) ? a.amount - a.loanAmount : a.amount;
                                        
                                        const currVal = getVal(acc);
                                        const nextVal = getVal(next);
                                        const diff = nextVal - currVal;

                                        return (
                                            <tr key={acc.id} className="border-b">
                                                <td className="p-2 font-medium">
                                                    {acc.name}
                                                    <div className="text-xs text-gray-400 font-normal">{acc.constructor.name}</div>
                                                </td>
                                                <td className="p-2 text-right">{fmt(currVal)}</td>
                                                <td className="p-2 text-right font-bold text-gray-800">{fmt(nextVal)}</td>
                                                <td className={`p-2 text-right ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {diff > 0 ? '+' : ''}{fmt(diff)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};