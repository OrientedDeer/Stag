import { useContext, useRef, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ResponsivePie } from '@nivo/pie';
import { IncomeContext } from '../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../components/Objects/Expense/ExpenseContext';
import { AccountContext } from '../components/Objects/Accounts/AccountContext';
import { NetWorthCard } from '../components/Charts/Networth';
import { defaultData } from '../data/defaultData';
import { TaxContext } from '../components/Objects/Taxes/TaxContext';
import { AssumptionsContext } from '../components/Objects/Assumptions/AssumptionsContext';
import { TAX_DATABASE } from '../data/TaxData';
import { calculateFederalTax, calculateFicaTax, calculateStateTax } from '../components/Objects/Taxes/TaxService';
import { CashflowSankey } from '../components/Charts/CashflowSankey';
import { useFileManager } from '../components/Objects/Accounts/useFileManager';
import { formatCompactCurrency } from './Future/tabs/FutureUtils';
import { AlertBanner } from '../components/Layout/AlertBanner';
import {
  RentExpense,
  MortgageExpense,
  FoodExpense,
  TransportExpense,
  HealthcareExpense,
  VacationExpense,
  LoanExpense,
  DependentExpense,
  AnyExpense,
} from '../components/Objects/Expense/models';

// Helper to get expense category from class type
const getExpenseCategory = (exp: AnyExpense): string => {
  if (exp instanceof RentExpense || exp instanceof MortgageExpense) return 'Housing';
  if (exp instanceof FoodExpense) return 'Food';
  if (exp instanceof TransportExpense) return 'Transportation';
  if (exp instanceof HealthcareExpense) return 'Healthcare';
  if (exp instanceof VacationExpense) return 'Entertainment';
  if (exp instanceof LoanExpense) return 'Debt';
  if (exp instanceof DependentExpense) return 'Dependents';
  return 'Other';
};

export default function Dashboard() {
  const incomeCtx = useContext(IncomeContext);
  const expenseCtx = useContext(ExpenseContext);
  const accountCtx = useContext(AccountContext);
  const { expenses } = useContext(ExpenseContext);
  const { state: taxState } = useContext(TaxContext);
  const { state: assumptions } = useContext(AssumptionsContext);
  const { handleGlobalImport, importKey } = useFileManager();
  const forceExact = assumptions.display?.useCompactCurrency === false;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debug logging for import key propagation
  console.log('[Dashboard] render with importKey:', importKey, 'incomes:', incomeCtx.incomes.length, 'expenses:', expenseCtx.expenses.length);

  const hasIncomes = incomeCtx.incomes.length > 0;
  const hasExpenses = expenseCtx.expenses.length > 0;
  const hasAccounts = accountCtx.accounts.length > 0;
  const isSetupComplete = hasIncomes && hasExpenses && hasAccounts;
  const isPristine = !hasIncomes && !hasExpenses && !hasAccounts;

  // Disclaimer banner state
  const [showDisclaimer, setShowDisclaimer] = useState(
    () => localStorage.getItem('stag_disclaimer_dismissed') !== 'true'
  );

  const dismissDisclaimer = () => {
    localStorage.setItem('stag_disclaimer_dismissed', 'true');
    setShowDisclaimer(false);
  };

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

  // Calculate dashboard metrics
  const dashboardMetrics = useMemo(() => {
    const grossIncome = incomes.reduce((sum, inc) => sum + inc.getAnnualAmount(), 0);
    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.getAnnualAmount(), 0);
    const totalTaxes = annualFedTax + annualStateTax + annualFicaTax;
    const savingsRate = grossIncome > 0
      ? ((grossIncome - totalExpenses - totalTaxes) / grossIncome) * 100
      : 0;
    const monthlyExpenses = totalExpenses / 12;

    return { grossIncome, totalTaxes, savingsRate, monthlyExpenses, totalExpenses };
  }, [incomes, expenses, annualFedTax, annualStateTax, annualFicaTax]);

  // Group expenses by category for pie chart
  const expenseByCategory = useMemo(() => {
    const categoryMap = new Map<string, number>();
    expenses.forEach(exp => {
      const cat = getExpenseCategory(exp);
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + exp.getAnnualAmount());
    });
    return Array.from(categoryMap.entries())
      .map(([id, value]) => ({ id, value, label: id }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  // Color palette for expense categories
  const categoryColors: Record<string, string> = {
    'Housing': '#6366f1',
    'Food': '#22c55e',
    'Transportation': '#f59e0b',
    'Healthcare': '#ef4444',
    'Entertainment': '#a855f7',
    'Utilities': '#3b82f6',
    'Insurance': '#14b8a6',
    'Debt': '#f43f5e',
    'Education': '#8b5cf6',
    'Other': '#6b7280',
  };

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
    <div className='w-full min-h-full flex bg-gray-950 justify-center pt-6 pb-24'>
      <div className="w-full px-4 sm:px-8 max-w-screen-2xl">
        <div className="flex flex-col gap-4 p-4 max-w-screen-2xl mx-auto w-full">
          <div className="flex justify-between items-end border-b border-gray-800 pb-4">
            <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          </div>

          {/* Data Storage Disclaimer */}
          {showDisclaimer && (
            <AlertBanner severity="info" onDismiss={dismissDisclaimer}>
              <span className="text-sm">
                <strong>Your data is stored locally in your browser.</strong>{' '}
                Use Export (on Accounts) to back up your data. It is not sent to any server and will be lost if you clear browser data.
              </span>
            </AlertBanner>
          )}

          {/* Setup Warning Card */}
          {!isSetupComplete && (
            <AlertBanner severity="warning" title="Finish Setting Up">
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
                      Import Data
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
            </AlertBanner>
          )}

          {/*
            Desktop (lg+): 7-column grid
            ┌───────────┬───────────┬─────────────────┐
            │ Numbers   │ Expense   │                 │
            │   2 cols  │  2 cols   │   NetWorth      │
            ├───────────┴───────────┤    3 cols       │
            │     Cashflow          │   (full height) │
            │      4 cols           │                 │
            └───────────────────────┴─────────────────┘

            Mobile: stacked (Numbers → Expense → NetWorth → Cashflow)
          */}
          <div key={`dashboard-charts-${importKey}`} className={`grid grid-cols-1 gap-4 items-start ${isSetupComplete ? 'lg:grid-cols-7' : 'lg:grid-cols-2'}`}>
            {/* Summary Metric Cards - 2x2 grid */}
            {isSetupComplete && (
              <div className="order-1 lg:col-span-2 lg:row-span-1 grid grid-cols-2 gap-3">
                <div className="bg-[#18181b] rounded-xl border border-gray-800 p-3 text-center">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Gross Income</p>
                  <p className="text-lg font-bold text-emerald-400">{formatCompactCurrency(dashboardMetrics.grossIncome, { forceExact })}</p>
                  <p className="text-xs text-gray-500">per year</p>
                </div>
                <div className="bg-[#18181b] rounded-xl border border-gray-800 p-3 text-center">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Total Taxes</p>
                  <p className="text-lg font-bold text-red-400">{formatCompactCurrency(dashboardMetrics.totalTaxes, { forceExact })}</p>
                  <p className="text-xs text-gray-500">per year</p>
                </div>
                <div className="bg-[#18181b] rounded-xl border border-gray-800 p-3 text-center">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Savings Rate</p>
                  <p className={`text-lg font-bold ${dashboardMetrics.savingsRate >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                    {dashboardMetrics.savingsRate.toFixed(1)}%
                  </p>
                  <p className="text-xs text-gray-500">of gross income</p>
                </div>
                <div className="bg-[#18181b] rounded-xl border border-gray-800 p-3 text-center">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Expenses</p>
                  <p className="text-lg font-bold text-orange-400">{formatCompactCurrency(dashboardMetrics.monthlyExpenses, { forceExact })}</p>
                  <p className="text-xs text-gray-500">per month</p>
                </div>
              </div>
            )}

            {/* Expense Category Breakdown */}
            {isSetupComplete && hasExpenses && expenseByCategory.length > 0 && (
              <div className="order-2 lg:col-span-2 lg:row-span-1 bg-[#18181b] rounded-xl border border-gray-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-bold text-gray-200">Expense Breakdown</h2>
                  <div className="flex flex-wrap gap-2 justify-end">
                    {expenseByCategory.slice(0, 4).map(cat => (
                      <div key={cat.id} className="flex items-center gap-1 text-xs text-gray-400">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: categoryColors[cat.id] || '#6b7280' }}
                        />
                        {cat.id}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="h-32">
                  <ResponsivePie
                    key={`pie-${importKey}`}
                    data={expenseByCategory}
                    margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
                    innerRadius={0.5}
                    padAngle={2}
                    cornerRadius={4}
                    activeOuterRadiusOffset={8}
                    colors={({ id }) => categoryColors[String(id)] || '#6b7280'}
                    borderWidth={0}
                    enableArcLinkLabels={false}
                    arcLabelsSkipAngle={30}
                    arcLabelsTextColor="#fff"
                    arcLabel={d => `${((d.value / dashboardMetrics.totalExpenses) * 100).toFixed(0)}%`}
                    tooltip={({ datum }) => (
                      <div className="bg-gray-900 px-3 py-2 rounded-lg border border-gray-700 shadow-lg">
                        <p className="text-sm font-semibold text-white">{String(datum.id)}</p>
                        <p className="text-sm text-gray-300">{formatCompactCurrency(datum.value, { forceExact })}/yr</p>
                      </div>
                    )}
                    theme={{
                      labels: { text: { fontSize: 10, fontWeight: 600 } },
                    }}
                  />
                </div>
              </div>
            )}

            {/* Net Worth - spans full height on desktop, order-3 on mobile (before cashflow) */}
            <div className={`order-3 h-full ${isSetupComplete ? 'lg:col-span-3 lg:row-span-2 lg:col-start-5 lg:row-start-1' : 'lg:col-span-1'}`}>
              <NetWorthCard key={`networth-${importKey}`}/>
            </div>

            {/* Cash Flow Chart - order-4 on mobile (last) */}
            <div className={`order-4 bg-[#18181b] rounded-2xl border border-gray-800 p-6 shadow-xl ${isSetupComplete ? 'lg:col-span-4 lg:row-start-2' : 'lg:col-span-1'}`}>
              <h2 className="text-xl font-bold text-gray-200 mb-6">Yearly Cash Flow</h2>
              <div className="min-h-75 flex flex-col justify-center">
                {hasIncomes ? (
                  (() => {
                    console.log('[Dashboard] Rendering CashflowSankey with:', {
                      importKey,
                      incomesCount: incomes.length,
                      expensesCount: expenses.length,
                      incomeIds: incomes.map(i => i.id).join(',')
                    });
                    return (
                      <CashflowSankey
                        key={`sankey-${importKey}`}
                        incomes={incomes}
                        expenses={expenses}
                        year={year}
                        taxes={{ fed: annualFedTax, state: annualStateTax, fica: annualFicaTax }}
                        height={300}
                      />
                    );
                  })()
                ) : (
                  <div className='flex flex-col items-center justify-center text-center p-12 border-2 border-dashed border-gray-800 rounded-2xl'>
                    <div className="text-gray-400 text-lg mb-2">No income data available</div>
                    <p className="text-gray-400 text-sm max-w-xs">
                      The Sankey chart requires income data to visualize your cash flow.
                    </p>
                    <Link to="/current/income" className="mt-4 text-blue-400 hover:text-blue-300 font-medium transition-colors">
                      Add Income Now →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}