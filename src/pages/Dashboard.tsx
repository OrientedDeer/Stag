import { useContext } from 'react';
import { Link } from 'react-router-dom';
import { IncomeContext } from '../components/Income/IncomeContext';
import { ExpenseContext } from '../components/Expense/ExpenseContext';
import { AccountContext } from '../components/Accounts/AccountContext';
import { NetWorthCard } from '../components/Charts/Networth';
import { CashflowChart } from '../components/Charts/CashflowChart'

export default function Dashboard() {
  const incomeCtx = useContext(IncomeContext);
  const expenseCtx = useContext(ExpenseContext);
  const accountCtx = useContext(AccountContext);

  const hasIncomes = incomeCtx.incomes.length > 0;
  const hasExpenses = expenseCtx.expenses.length > 0;
  const hasAccounts = accountCtx.accounts.length > 0;
  const isSetupComplete = hasIncomes && hasExpenses && hasAccounts;

  return (
    <div className='w-full min-h-full flex bg-gray-950 justify-center pt-6'>
      <div className="w-full px-8 max-w-screen-2xl">
        <div className="flex flex-col gap-4 p-4 max-w-screen-2xl mx-auto w-full">
          <div className="flex justify-between items-end border-b border-gray-800 pb-4">
            <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          </div>

          {/* Setup Warning Card */}
          {!isSetupComplete && (
            <div className="bg-amber-900/20 border border-amber-500/50 rounded-2xl p-6 mb-2 shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">🚧</span>
                <h2 className="text-xl font-bold text-amber-200">Finish Setting Up</h2>
              </div>
              <p className="text-amber-100/70 mb-4 text-sm">
                To see your financial projections and cash flow chart, please add data to the following sections:
              </p>
              <div className="flex flex-wrap gap-3">
                {!hasAccounts && (
                  <Link 
                    to="/current/accounts" 
                    className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/50 rounded-xl text-amber-200 text-sm font-semibold transition-all"
                  >
                    + Add Accounts or Import
                  </Link>
                )}
                {!hasIncomes && (
                  <Link 
                    to="/current/income" 
                    className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/50 rounded-xl text-amber-200 text-sm font-semibold transition-all"
                  >
                    + Add Income
                  </Link>
                )}
                {!hasExpenses && (
                  <Link 
                    to="/current/expense" 
                    className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/50 rounded-xl text-amber-200 text-sm font-semibold transition-all"
                  >
                    + Add Expenses
                  </Link>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Main Flow Chart - Spans 2 cols on large screens */}
            <div className="lg:col-span-3 bg-[#18181b] rounded-2xl border border-gray-800 p-6 shadow-xl">
              <h2 className="text-xl font-bold text-gray-200 mb-6">Yearly Cash Flow</h2>
              <div className="min-h-[300px] flex flex-col justify-center">
                {hasIncomes ? (
                  <CashflowChart/>
                ) : (
                  <div className='flex flex-col items-center justify-center text-center p-12 border-2 border-dashed border-gray-800 rounded-2xl'>
                    <div className="text-gray-500 text-lg mb-2">No income data available</div>
                    <p className="text-gray-600 text-sm max-w-xs">
                      The Sankey chart requires income data to visualize your cash flow.
                    </p>
                    <Link to="/current/income" className="mt-4 text-blue-400 hover:text-blue-300 font-medium transition-colors">
                      Add Income Now →
                    </Link>
                  </div>
                )}
              </div>
            </div>
            
            <div className="space-y-6 lg:col-span-2">
              <NetWorthCard/>
              {/* You could add more secondary cards here */}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}