import React, { useContext, useState } from 'react';
import { AccountContext } from '../../components/Accounts/AccountContext';
import { IncomeContext } from '../../components/Income/IncomeContext';
import { ExpenseContext } from '../../components/Expense/ExpenseContext';
import { AssumptionsContext, PriorityBucket } from '../../components/Assumptions/AssumptionsContext';

// Import Models for instanceof checks and Types
import { 
    PropertyAccount, 
    DebtAccount, 
    InvestedAccount, 
    SavedAccount,
    AnyAccount
} from '../../components/Accounts/models';
import { 
    MortgageExpense, 
    LoanExpense,
    AnyExpense 
} from '../../components/Expense/models';
import { 
    WorkIncome,
    AnyIncome 
} from '../../components/Income/models';

const Testing = () => {
    // 1. Grab Live Data
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: assumptions } = useContext(AssumptionsContext);

    // State to hold the simulation result
    const [nextYearData, setNextYearData] = useState<{
        incomes: AnyIncome[];
        expenses: AnyExpense[];
        accounts: AnyAccount[];
        cashflow: {
            totalIncome: number;
            totalExpense: number;
            discretionary: number;
            invested: number;
        };
        debugLog: string[];
    } | null>(null);

    const runSimulation = () => {
        const logs: string[] = [];
        const log = (msg: string) => logs.push(msg);

        log("--- STARTING 1-YEAR SIMULATION ---");

        // STEP 1: GROW INCOMES
        log("Growing Incomes...");
        const nextIncomes = incomes.map(inc => inc.increment(assumptions));

        // STEP 2: GROW EXPENSES
        log("Growing Expenses...");
        const nextExpenses = expenses.map(exp => exp.increment(assumptions));

        // STEP 3: CALCULATE CASHFLOW
        // We use the NEXT year's income/expenses to determine what we can save in the NEXT year
        const totalIncome = nextIncomes.reduce((sum, inc) => sum + inc.getAnnualAmount(), 0);
        const totalExpense = nextExpenses.reduce((sum, exp) => sum + exp.getAnnualAmount(), 0);
        let discretionaryCash = totalIncome - totalExpense;
        
        log(`Total Income: $${Math.round(totalIncome)}`);
        log(`Total Expenses: $${Math.round(totalExpense)}`);
        log(`Discretionary Cash: $${Math.round(discretionaryCash)}`);

        // STEP 4: PREPARE ACCOUNT INFLOWS (The Bucket System)
        const accountInflows: Record<string, number> = {}; // AccountID -> Cash Amount

        // 4a. Employer Matches (These happen automatically)
        nextIncomes.forEach(inc => {
            if (inc instanceof WorkIncome && inc.matchAccountId) {
                const currentVal = accountInflows[inc.matchAccountId] || 0;
                accountInflows[inc.matchAccountId] = currentVal + inc.employerMatch;
                log(`-> Employer Match from ${inc.name}: $${Math.round(inc.employerMatch)} into Account ${inc.matchAccountId}`);
            }
        });

        // 4b. Priority Waterfall (User Savings)
        log("Processing Priorities...");
        if (assumptions.priorities.length === 0) {
            log("No priorities defined. Cash sits in wallet.");
        }

        assumptions.priorities.forEach((priority: PriorityBucket) => {
            if (!priority.accountId) return;
            if (discretionaryCash <= 0) {
                log(`Skipping priority '${priority.name}' - No cash left.`);
                return;
            }

            let amountToContribute = 0;

            if (priority.capType === 'FIXED') {
                amountToContribute = Math.min(priority.capValue || 0, discretionaryCash);
            } 
            else if (priority.capType === 'REMAINDER') {
                amountToContribute = discretionaryCash;
            }
            // Add other logic (MAX, etc) here later

            // Execute Transfer
            discretionaryCash -= amountToContribute;
            const currentVal = accountInflows[priority.accountId] || 0;
            accountInflows[priority.accountId] = currentVal + amountToContribute;
            
            log(`-> Priority '${priority.name}': Added $${Math.round(amountToContribute)} to Account ${priority.accountId}`);
        });

        // STEP 5: MAP LINKED DATA (Mortgage -> Property)
        log("Mapping Linked Data...");
        const linkedData = new Map<string, { balance: number; value?: number }>();

        nextExpenses.forEach(exp => {
            if (exp instanceof MortgageExpense && exp.linkedAccountId) {
                linkedData.set(exp.linkedAccountId, {
                    balance: exp.loan_balance,
                    value: exp.valuation 
                });
                log(`Linked Mortgage: Account ${exp.linkedAccountId} new balance is $${Math.round(exp.loan_balance)}`);
            }
            else if (exp instanceof LoanExpense && exp.linkedAccountId) {
                linkedData.set(exp.linkedAccountId, {
                    balance: exp.amount 
                });
                log(`Linked Loan: Account ${exp.linkedAccountId} new balance is $${Math.round(exp.amount)}`);
            }
        });

        // STEP 6: GROW ACCOUNTS
        log("Growing Accounts...");
        const nextAccounts = accounts.map(acc => {
            // Check for Linked Driver (Mortgage/Loan)
            const linkedState = linkedData.get(acc.id);

            if (acc instanceof PropertyAccount) {
                return acc.increment(assumptions, { 
                    newLoanBalance: linkedState?.balance, 
                    newValue: linkedState?.value 
                });
            }
            
            if (acc instanceof DebtAccount) {
                return acc.increment(assumptions, linkedState?.balance);
            }

            if (acc instanceof InvestedAccount || acc instanceof SavedAccount) {
                const inflow = accountInflows[acc.id] || 0;
                if (inflow > 0) log(`Growing ${acc.name} with inflow $${Math.round(inflow)}`);
                return acc.increment(assumptions, inflow);
            }

            // Fallback for types without specific grow logic (shouldn't happen with strict types)
            // @ts-ignore
            return acc.increment ? acc.increment(assumptions) : acc; 
        });

        setNextYearData({
            incomes: nextIncomes,
            expenses: nextExpenses,
            accounts: nextAccounts,
            cashflow: {
                totalIncome,
                totalExpense,
                discretionary: discretionaryCash,
                invested: totalIncome - totalExpense - discretionaryCash
            },
            debugLog: logs
        });
    };

    // Helper to format currency
    const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

    return (
        <div className="p-6 space-y-8 bg-gray-50 min-h-screen">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-800">Simulation Debugger</h1>
                <button 
                    onClick={runSimulation}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-semibold shadow"
                >
                    Run 1-Year Loop
                </button>
            </div>

            {!nextYearData ? (
                <div className="text-gray-500 italic">Click "Run 1-Year Loop" to see the future...</div>
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
                                    {incomes.map((inc, i) => {
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

                        {/* EXPENSES */}
                        <div className="bg-white p-4 rounded shadow border border-gray-200">
                            <h3 className="font-bold text-lg mb-4 text-red-700">Expenses</h3>
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-100 font-semibold text-gray-600">
                                    <tr>
                                        <th className="p-2">Name</th>
                                        <th className="p-2 text-right">Current</th>
                                        <th className="p-2 text-right">Next Year</th>
                                        <th className="p-2 text-right">Change</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {expenses.map((exp, i) => {
                                        const next = nextYearData.expenses.find(n => n.id === exp.id);
                                        if (!next) return null;
                                        const currAmount = exp.getAnnualAmount();
                                        const nextAmount = next.getAnnualAmount();
                                        const diff = nextAmount - currAmount;
                                        
                                        // Special check for Mortgage Balance
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

                        {/* ACCOUNTS */}
                        <div className="bg-white p-4 rounded shadow border border-gray-200">
                            <h3 className="font-bold text-lg mb-4 text-blue-700">Accounts</h3>
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-100 font-semibold text-gray-600">
                                    <tr>
                                        <th className="p-2">Name</th>
                                        <th className="p-2 text-right">Current</th>
                                        <th className="p-2 text-right">Next Year</th>
                                        <th className="p-2 text-right">Gain/Loss</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accounts.map((acc, i) => {
                                        const next = nextYearData.accounts.find(n => n.id === acc.id);
                                        if (!next) return null;
                                        
                                        // Helper to get total value (Asset - Liability for Property)
                                        const getVal = (a: AnyAccount) => {
                                            if (a instanceof PropertyAccount) return a.amount - a.loanAmount;
                                            return a.amount;
                                        }
                                        
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

                    {/* RIGHT COLUMN: Logs & Summary */}
                    <div className="space-y-6">
                        {/* Summary Card */}
                        <div className="bg-slate-800 text-white p-6 rounded-lg shadow">
                            <h3 className="text-xl font-bold mb-4">Cashflow Summary</h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>Total Income</div>
                                <div className="text-right text-green-400 font-mono">{fmt(nextYearData.cashflow.totalIncome)}</div>
                                
                                <div>Total Expenses</div>
                                <div className="text-right text-red-400 font-mono">{fmt(nextYearData.cashflow.totalExpense)}</div>
                                
                                <div className="border-t border-slate-600 pt-2 font-bold">Invested/Saved</div>
                                <div className="border-t border-slate-600 pt-2 text-right text-blue-400 font-mono font-bold">
                                    {fmt(nextYearData.cashflow.invested)}
                                </div>
                                
                                <div>Unused Cash</div>
                                <div className="text-right text-yellow-400 font-mono">{fmt(nextYearData.cashflow.discretionary)}</div>
                            </div>
                        </div>

                        {/* Logs Console */}
                        <div className="bg-gray-900 text-green-400 p-4 rounded shadow font-mono text-xs h-96 overflow-y-auto border border-gray-700">
                            <div className="mb-2 text-white font-bold border-b border-gray-700 pb-1">Execution Log</div>
                            {nextYearData.debugLog.map((line, i) => (
                                <div key={i} className="mb-1">
                                    <span className="text-gray-500 mr-2">[{i}]</span>
                                    {line}
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
};

export default Testing;