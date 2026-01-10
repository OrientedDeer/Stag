import { useContext, useRef } from 'react';
import { Link } from 'react-router-dom';
import { IncomeContext } from '../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../components/Objects/Expense/ExpenseContext';
import { AccountContext } from '../components/Objects/Accounts/AccountContext';
import { NetWorthCard } from '../components/Charts/Networth';
import { defaultData } from '../data/defaultData';
import { TaxContext } from '../components/Objects/Taxes/TaxContext';
import { TAX_DATABASE } from '../data/TaxData';
import { calculateFederalTax, calculateFicaTax, calculateStateTax } from '../components/Objects/Taxes/TaxService';
import { CashflowSankey } from '../components/Charts/CashflowSankey';
import { useFileManager } from '../components/Objects/Accounts/useFileManager';

export default function Dashboard() {
  const incomeCtx = useContext(IncomeContext);
  const expenseCtx = useContext(ExpenseContext);
  const accountCtx = useContext(AccountContext);
  const { expenses } = useContext(ExpenseContext);
  const { state: taxState } = useContext(TaxContext);
  const { handleGlobalImport } = useFileManager();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasIncomes = incomeCtx.incomes.length > 0;
  const hasExpenses = expenseCtx.expenses.length > 0;
  const hasAccounts = accountCtx.accounts.length > 0;
  const isSetupComplete = hasIncomes && hasExpenses && hasAccounts;
  const isPristine = !hasIncomes && !hasExpenses && !hasAccounts;

  const { incomes } = useContext(IncomeContext);
  
      const year = 2026;
  
      // Calculate taxes locally to pass them in
      const fedParams = TAX_DATABASE.federal[year]?.[taxState.filingStatus];
      const stateParams = TAX_DATABASE.states[taxState.stateResidency]?.[year]?.[taxState.filingStatus];
  
      let annualFedTax = fedParams ? calculateFederalTax(taxState, incomes, expenses, year) : 0;
      let annualStateTax = stateParams ? calculateStateTax(taxState, incomes, expenses, year) : 0;
      let annualFicaTax = fedParams ? calculateFicaTax(taxState, incomes, year) : 0;
  
      if (taxState.fedOverride !== null) annualFedTax = taxState.fedOverride;
      if (taxState.ficaOverride !== null) annualFicaTax = taxState.ficaOverride;
      if (taxState.stateOverride !== null) annualStateTax = taxState.stateOverride;
  

  const loadDefaultData = () => {
    // Use the same import mechanism as file import for consistency and error checking
    handleGlobalImport(JSON.stringify(defaultData));
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        handleGlobalImport(content);
      };
      reader.readAsText(file);
    }
    // Reset the input so the same file can be selected again
    if (event.target) {
      event.target.value = '';
    }
  };

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
                {isPristine && (
                  <>
                    <button
                      onClick={loadDefaultData}
                      className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/50 rounded-xl text-blue-200 text-sm font-semibold transition-all"
                    >
                      + Add Default Data
                    </button>
                    <button
                      onClick={handleImportClick}
                      className="px-4 py-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/50 rounded-xl text-green-200 text-sm font-semibold transition-all"
                    >
                      📥 Import Data
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Main Flow Chart - Spans 2 cols on large screens */}
            <div className="lg:col-span-3 bg-[#18181b] rounded-2xl border border-gray-800 p-6 shadow-xl">
              <h2 className="text-xl font-bold text-gray-200 mb-6">Yearly Cash Flow</h2>
              <div className="min-h-75 flex flex-col justify-center">
                {hasIncomes ? (
                  <CashflowSankey
                    incomes={incomes}
                    expenses={expenses}
                    year={year}
                    taxes={{ fed: annualFedTax, state: annualStateTax, fica: annualFicaTax }}
                    height={300}
                  />
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