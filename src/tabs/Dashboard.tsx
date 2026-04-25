import { useContext, useRef, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveSunburst } from '@nivo/sunburst';
import { IncomeContext } from '../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../components/Objects/Expense/ExpenseContext';
import { AccountContext } from '../components/Objects/Accounts/AccountContext';
import { NetWorthCard } from '../components/Charts/Networth';
import { defaultData } from '../data/defaultData';
import { TaxContext } from '../components/Objects/Taxes/TaxContext';
import { AssumptionsContext, getBirthYear } from '../components/Objects/Assumptions/AssumptionsContext';
import { WorkIncome, AnyIncome } from '../components/Objects/Income/models';
import { TAX_DATABASE } from '../data/TaxData';
import { calculateFederalTaxFromIncomes, calculateFicaTax, calculateStateTax } from '../components/Objects/Taxes/TaxService';
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
import {
  SavedAccount,
  InvestedAccount,
  ESPPAccount,
  PropertyAccount,
  DebtAccount,
} from '../components/Objects/Accounts/models';

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

  const { incomes: rawIncomes } = useContext(IncomeContext);

      const year = new Date().getFullYear();
      const startAge = year - getBirthYear(assumptions.milestones);

      // Resolve autoMax401k on WorkIncome objects so Sankey shows IRS-limit-capped values
      const incomes: AnyIncome[] = useMemo(() => rawIncomes.map(inc => {
          if (inc instanceof WorkIncome && inc.autoMax401k !== 'custom') {
              const effective = inc.getEffective401k(year, startAge);
              if (effective.preTax !== inc.preTax401k || effective.roth !== inc.roth401k) {
                  return new WorkIncome(
                      inc.id, inc.name, inc.amount, inc.frequency,
                      inc.earned_income, effective.preTax, inc.insurance,
                      effective.roth, inc.employerMatch, inc.matchAccountId,
                      inc.taxType, inc.contributionGrowthStrategy,
                      inc.startDate, inc.end_date, inc.hsaContribution,
                      inc.autoMax401k, inc.esppContributionType,
                      inc.esppContributionAmount, inc.esppDiscountPercent,
                      inc.esppHasLookback, inc.esppOfferingPeriodMonths,
                      inc.esppAccountId, inc.esppExpectedStockGrowth,
                      inc.pensionSystem, inc.startMilestoneId, inc.endMilestoneId
                  );
              }
          }
          return inc;
      }), [rawIncomes, year, startAge]);

      // Calculate taxes locally to pass them in
      const fedParams = TAX_DATABASE.federal[year]?.[taxState.filingStatus];
      const stateParams = TAX_DATABASE.states[taxState.stateResidency]?.[year]?.[taxState.filingStatus];

      let annualFedTax = fedParams ? calculateFederalTaxFromIncomes(taxState, incomes, expenses, 0, year, assumptions) : 0;
      let annualStateTax = stateParams ? calculateStateTax(taxState, incomes, expenses, year, assumptions) : 0;
      let annualFicaTax = fedParams ? calculateFicaTax(taxState, incomes, year, assumptions) : 0;
  
      if (taxState.fedOverride !== null) annualFedTax = taxState.fedOverride;
      if (taxState.ficaOverride !== null) annualFicaTax = taxState.ficaOverride;
      if (taxState.stateOverride !== null) annualStateTax = taxState.stateOverride;

  // Calculate dashboard metrics
  const dashboardMetrics = useMemo(() => {
    const employeeIncome = incomes.reduce((sum, inc) => sum + inc.getAnnualAmount(year), 0);
    const employerMatch = incomes.reduce((sum, inc) => {
      if (inc instanceof WorkIncome) return sum + inc.getEffectiveAnnualEmployerMatch(year);
      return sum;
    }, 0);
    const grossIncome = employeeIncome + employerMatch;
    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.getAnnualAmount(year), 0);
    const totalTaxes = annualFedTax + annualStateTax + annualFicaTax;
    const savingsRate = grossIncome > 0
      ? ((grossIncome - totalExpenses - totalTaxes) / grossIncome) * 100
      : 0;
    const monthlyExpenses = totalExpenses / 12;

    return { grossIncome, totalTaxes, savingsRate, monthlyExpenses, totalExpenses };
  }, [incomes, expenses, annualFedTax, annualStateTax, annualFicaTax, year]);

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
    'Dependents': '#8b5cf6',
    'Other': '#6b7280',
    'Savings': '#10b981',
  };

  // Spending sunburst toggles and drill-down
  const [showSavings, setShowSavings] = useState(() => localStorage.getItem('stag_show_savings') === 'true');
  const [showTaxes, setShowTaxes] = useState(() => localStorage.getItem('stag_show_taxes') === 'true');
  const [spendingDrilldown, setSpendingDrilldown] = useState<string | null>(null);
  const [assetDrilldown, setAssetDrilldown] = useState<string | null>(null);

  // Spending sunburst data (hierarchical: root → category → individual expenses)
  const spendingSunburstData = useMemo(() => {
    const categoryMap = new Map<string, { name: string; value: number }[]>();
    expenses.forEach(exp => {
      const cat = getExpenseCategory(exp);
      const amount = exp.getAnnualAmount(year);
      if (amount <= 0) return;
      if (!categoryMap.has(cat)) categoryMap.set(cat, []);
      categoryMap.get(cat)!.push({ name: exp.name, value: amount });
    });

    const children = Array.from(categoryMap.entries())
      .map(([category, items]) => ({
        name: category,
        color: categoryColors[category] || '#6b7280',
        children: items,
      }))
      .filter(c => c.children.length > 0)
      .sort((a, b) => {
        const sumA = a.children.reduce((s, i) => s + i.value, 0);
        const sumB = b.children.reduce((s, i) => s + i.value, 0);
        return sumB - sumA;
      });

    if (showTaxes) {
      const taxItems: { name: string; value: number }[] = [];
      if (annualFedTax > 0) taxItems.push({ name: 'Federal', value: annualFedTax });
      if (annualStateTax > 0) taxItems.push({ name: 'State', value: annualStateTax });
      if (annualFicaTax > 0) taxItems.push({ name: 'FICA', value: annualFicaTax });
      if (taxItems.length > 0) {
        children.push({
          name: 'Taxes',
          color: '#ef4444',
          children: taxItems,
        });
      }
    }

    if (showSavings) {
      const employeeSavings = dashboardMetrics.grossIncome - dashboardMetrics.totalExpenses - dashboardMetrics.totalTaxes;
      if (employeeSavings > 0) {
        // Break down savings by allocation from WorkIncome sources
        let totalPreTax = 0;
        let totalRoth = 0;
        let totalHSA = 0;
        let totalMatch = 0;
        let totalESPP = 0;
        let totalInsurance = 0;

        incomes.forEach(inc => {
          if (inc instanceof WorkIncome) {
            const effective = inc.getEffective401k(year, startAge);
            totalPreTax += inc.getProratedAnnual(effective.preTax, year);
            totalRoth += inc.getProratedAnnual(effective.roth, year);
            totalHSA += inc.getProratedAnnual(inc.hsaContribution, year);
            totalMatch += inc.getEffectiveAnnualEmployerMatch(year);
            totalESPP += inc.getAnnualESPPContribution(year);
            totalInsurance += inc.getProratedAnnual(inc.insurance, year);
          }
        });

        const payrollAllocated = totalPreTax + totalRoth + totalHSA + totalMatch + totalESPP + totalInsurance;
        let remaining = Math.max(0, employeeSavings - payrollAllocated);

        const savingsItems: { name: string; value: number }[] = [];
        if (totalPreTax > 0) savingsItems.push({ name: 'Pre-tax 401k', value: totalPreTax });
        if (totalRoth > 0) savingsItems.push({ name: 'Roth 401k', value: totalRoth });
        if (totalHSA > 0) savingsItems.push({ name: 'HSA', value: totalHSA });
        if (totalMatch > 0) savingsItems.push({ name: 'Employer Match', value: totalMatch });
        if (totalESPP > 0) savingsItems.push({ name: 'ESPP', value: totalESPP });
        if (totalInsurance > 0) savingsItems.push({ name: 'Insurance', value: totalInsurance });

        // Distribute remaining cash through priority buckets
        const priorities = assumptions.priorities || [];
        for (const bucket of priorities) {
          if (remaining <= 0) break;
          let bucketCap: number;
          switch (bucket.capType) {
            case 'FIXED':
              bucketCap = (bucket.capValue ?? 0) * 12;
              break;
            case 'MAX':
              bucketCap = bucket.capValue ?? 0;
              break;
            case 'MULTIPLE_OF_EXPENSES': {
              const targetBalance = (dashboardMetrics.monthlyExpenses) * (bucket.capValue ?? 0);
              const currentBalance = accountCtx.accounts.find(a => a.id === bucket.accountId)?.amount ?? 0;
              bucketCap = Math.max(0, targetBalance - currentBalance);
              break;
            }
            case 'REMAINDER':
            default:
              bucketCap = Infinity;
              break;
          }
          const allocated = Math.min(remaining, bucketCap);
          if (allocated > 0) {
            savingsItems.push({ name: bucket.name, value: allocated });
            remaining -= allocated;
          }
        }

        if (remaining > 0) savingsItems.push({ name: 'Unallocated', value: remaining });

        if (savingsItems.length > 0) {
          children.push({
            name: 'Savings',
            color: '#10b981',
            children: savingsItems,
          });
        }
      }
    }

    return { name: 'Spending', children };
  }, [expenses, year, startAge, incomes, showSavings, showTaxes, dashboardMetrics, annualFedTax, annualStateTax, annualFicaTax, assumptions.priorities, accountCtx.accounts]);

  // Helper to get account category
  const getAccountCategory = (acc: typeof accountCtx.accounts[0]): string => {
    if (acc instanceof SavedAccount) return 'Cash';
    if (acc instanceof InvestedAccount) return 'Invested';
    if (acc instanceof ESPPAccount) return 'Invested';
    if (acc instanceof PropertyAccount) return 'Property';
    return 'Other';
  };

  // Helper to get account display value (matches Gross Assets in Net Worth card)
  const getAccountValue = (acc: typeof accountCtx.accounts[0]): number => {
    return acc.amount;
  };

  const accountCategoryColors: Record<string, string> = {
    'Cash': '#a855f7',
    'Invested': '#3b82f6',
    'Property': '#f59e0b',
    'Other': '#6b7280',
  };

  // Asset sunburst data (hierarchical: root → category → individual accounts)
  const assetSunburstData = useMemo(() => {
    const categoryMap = new Map<string, { name: string; value: number }[]>();
    accountCtx.accounts.forEach(acc => {
      if (acc instanceof DebtAccount) return;
      const cat = getAccountCategory(acc);
      const value = getAccountValue(acc);
      if (value <= 0) return;
      if (!categoryMap.has(cat)) categoryMap.set(cat, []);

      if (acc instanceof InvestedAccount && acc.nonVestedAmount > 0) {
        const vested = acc.amount - acc.nonVestedAmount;
        if (vested > 0) categoryMap.get(cat)!.push({ name: `${acc.name} (Vested)`, value: vested });
        categoryMap.get(cat)!.push({ name: `${acc.name} (Unvested)`, value: acc.nonVestedAmount });
      } else {
        categoryMap.get(cat)!.push({ name: acc.name, value });
      }
    });

    const children = Array.from(categoryMap.entries())
      .map(([category, items]) => ({
        name: category,
        color: accountCategoryColors[category] || '#6b7280',
        children: items,
      }))
      .filter(c => c.children.length > 0)
      .sort((a, b) => {
        const sumA = a.children.reduce((s, i) => s + i.value, 0);
        const sumB = b.children.reduce((s, i) => s + i.value, 0);
        return sumB - sumA;
      });

    return { name: 'Assets', children };
  }, [accountCtx.accounts]);

  // Tax breakdown data (sunburst format)
  const taxBreakdownData = useMemo(() => {
    const children: { name: string; value: number; color: string }[] = [];
    if (annualFedTax > 0) children.push({ name: 'Federal', value: annualFedTax, color: '#ef4444' });
    if (annualStateTax > 0) children.push({ name: 'State', value: annualStateTax, color: '#f59e0b' });
    if (annualFicaTax > 0) children.push({ name: 'FICA', value: annualFicaTax, color: '#f97316' });
    return { name: 'Taxes', children };
  }, [annualFedTax, annualStateTax, annualFicaTax]);

  // Drilled-down sunburst data: when a category is selected, show only its children
  const activeSpendingData = useMemo(() => {
    if (!spendingDrilldown) return spendingSunburstData;
    const cat = spendingSunburstData.children.find(c => c.name === spendingDrilldown);
    if (!cat) return spendingSunburstData;
    return {
      name: cat.name,
      children: cat.children.map(item => ({
        ...item,
        color: cat.color,
        children: [] as { name: string; value: number }[],
      })),
    };
  }, [spendingSunburstData, spendingDrilldown]);

  const activeAssetData = useMemo(() => {
    if (!assetDrilldown) return assetSunburstData;
    const cat = assetSunburstData.children.find(c => c.name === assetDrilldown);
    if (!cat) return assetSunburstData;
    return {
      name: cat.name,
      children: cat.children.map(item => ({
        ...item,
        color: cat.color,
        children: [] as { name: string; value: number }[],
      })),
    };
  }, [assetSunburstData, assetDrilldown]);

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
                Use the Data panel in the sidebar to export or set up cloud backups. Local data will be lost if you clear browser data.
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
            Desktop (lg+):
            ┌──────────────────────────┬──────────────────┐
            │  Left column (stacked)   │  Net Worth       │
            │  ┌────────┬───────────┐  │                  │
            │  │Metrics │ Spending  │  │                  │
            │  ├────────┼───────────┤  │                  │
            │  │Assets  │ Tax       │  │                  │
            │  └────────┴───────────┘  │                  │
            ├──────────────────────────┴──────────────────┤
            │              Cashflow (full width)          │
            └─────────────────────────────────────────────┘
          */}
          <div key={`dashboard-charts-${importKey}`} className="flex flex-col gap-4">
            {/* Top section: left charts + right net worth */}
            <div className={`flex flex-col gap-4 ${isSetupComplete ? 'lg:flex-row' : ''}`}>
              {/* Left column - flows naturally */}
              {isSetupComplete && (
                <div className="flex-1 min-w-0 flex flex-col gap-4">
                  {/* Row 1: Metrics + Tax Breakdown */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Summary Metric Cards */}
                    <div className="grid grid-cols-2 gap-3">
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

                    {/* Tax Breakdown */}
                    {dashboardMetrics.totalTaxes > 0 && (
                      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h2 className="text-sm font-bold text-gray-200">Tax Breakdown</h2>
                          <div className="flex flex-wrap gap-2 justify-end">
                            {taxBreakdownData.children.map(t => (
                              <div key={t.name} className="flex items-center gap-1 text-xs text-gray-400">
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: t.color }}
                                />
                                {t.name}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="h-40 relative">
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                            <span className="text-sm font-bold text-gray-200">{formatCompactCurrency(dashboardMetrics.totalTaxes, { forceExact })}</span>
                          </div>
                          <ResponsiveSunburst
                            key={`tax-sunburst-${importKey}`}
                            data={taxBreakdownData}
                            margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
                            id="name"
                            value="value"
                            cornerRadius={3}
                            borderWidth={1}
                            borderColor={{ theme: 'background' }}
                            colors={(node) => (node.data as any)?.color || '#6b7280'}
                            enableArcLabels={true}
                            arcLabelsSkipAngle={15}
                            arcLabelsTextColor="#fff"
                            arcLabel={(node) => `${((node.value / dashboardMetrics.totalTaxes) * 100).toFixed(0)}%`}
                            tooltip={({ id, value }) => (
                              <div className="bg-gray-900 px-3 py-2 rounded-lg border border-gray-700 shadow-lg">
                                <p className="text-sm font-semibold text-white">{String(id)}</p>
                                <p className="text-sm text-gray-300">{formatCompactCurrency(value, { forceExact })}/yr</p>
                              </div>
                            )}
                            theme={{
                              labels: { text: { fontSize: 10, fontWeight: 600 } },
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Row 2: Spending Sunburst + Asset Sunburst */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Spending Sunburst */}
                    {hasExpenses && spendingSunburstData.children.length > 0 && (
                      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h2 className="text-sm font-bold text-gray-200">
                            {spendingDrilldown ? (
                              <>
                                <button onClick={() => setSpendingDrilldown(null)} className="text-gray-500 hover:text-gray-300 transition-colors">Spending</button>
                                <span className="text-gray-600 mx-1">/</span>
                                {spendingDrilldown}
                              </>
                            ) : 'Spending Breakdown'}
                          </h2>
                          {!spendingDrilldown && (
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => setShowTaxes(s => { localStorage.setItem('stag_show_taxes', String(!s)); return !s; })}
                                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                                  showTaxes
                                    ? 'border-red-500/50 bg-red-500/10 text-red-400'
                                    : 'border-gray-700 bg-transparent text-gray-500 hover:text-gray-400'
                                }`}
                              >
                                {showTaxes ? 'Taxes On' : '+ Taxes'}
                              </button>
                              <button
                                onClick={() => setShowSavings(s => { localStorage.setItem('stag_show_savings', String(!s)); return !s; })}
                                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                                  showSavings
                                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                                    : 'border-gray-700 bg-transparent text-gray-500 hover:text-gray-400'
                                }`}
                              >
                                {showSavings ? 'Savings On' : '+ Savings'}
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="h-64 relative">
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                            <span className="text-sm font-bold text-gray-200">
                              {formatCompactCurrency(
                                activeSpendingData.children.reduce((sum, cat) =>
                                  sum + (cat.children?.length
                                    ? cat.children.reduce((s, i) => s + i.value, 0)
                                    : (cat as any).value || 0), 0),
                                { forceExact }
                              )}
                            </span>
                          </div>
                          <ResponsiveSunburst
                            key={`spending-sunburst-${importKey}-${showSavings}-${showTaxes}-${spendingDrilldown}`}
                            data={activeSpendingData}
                            margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
                            id="name"
                            value="value"
                            cornerRadius={3}
                            borderWidth={1}
                            borderColor={{ theme: 'background' }}
                            colors={(node) => {
                              let current = node;
                              while (current.depth > 1 && current.parent) {
                                current = current.parent;
                              }
                              const catColor = (current.data as any)?.color;
                              if (catColor) {
                                if (node.depth > 1) return catColor + 'cc';
                                return catColor;
                              }
                              return '#6b7280';
                            }}
                            childColor={{ from: 'color', modifiers: [['brighter', 0.3]] }}
                            enableArcLabels={true}
                            arcLabelsSkipAngle={15}
                            arcLabelsTextColor="#fff"
                            arcLabel={(node) => {
                              const total = activeSpendingData.children.reduce(
                                (sum, cat) => sum + (cat.children?.length
                                  ? cat.children.reduce((s, i) => s + i.value, 0)
                                  : (cat as any).value || 0), 0
                              );
                              return `${((node.value / total) * 100).toFixed(0)}%`;
                            }}
                            onClick={(node) => {
                              if (!spendingDrilldown && node.depth === 1) {
                                setSpendingDrilldown(String(node.id));
                              }
                            }}
                            tooltip={({ id, value }) => (
                              <div className="bg-gray-900 px-3 py-2 rounded-lg border border-gray-700 shadow-lg">
                                <p className="text-sm font-semibold text-white">{String(id)}</p>
                                <p className="text-sm text-gray-300">{formatCompactCurrency(value, { forceExact })}/yr</p>
                              </div>
                            )}
                            theme={{
                              labels: { text: { fontSize: 10, fontWeight: 600 } },
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Asset Sunburst */}
                    {hasAccounts && assetSunburstData.children.length > 0 && (
                      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h2 className="text-sm font-bold text-gray-200">
                            {assetDrilldown ? (
                              <>
                                <button onClick={() => setAssetDrilldown(null)} className="text-gray-500 hover:text-gray-300 transition-colors">Assets</button>
                                <span className="text-gray-600 mx-1">/</span>
                                {assetDrilldown}
                              </>
                            ) : 'Asset Breakdown'}
                          </h2>
                          {!assetDrilldown && (
                            <div className="flex flex-wrap gap-2 justify-end">
                              {assetSunburstData.children.map(cat => (
                                <div key={cat.name} className="flex items-center gap-1 text-xs text-gray-400">
                                  <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: (cat as any).color || '#6b7280' }}
                                  />
                                  {cat.name}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="h-64 relative">
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                            <span className="text-sm font-bold text-gray-200">
                              {formatCompactCurrency(
                                activeAssetData.children.reduce((sum, cat) =>
                                  sum + (cat.children?.length
                                    ? cat.children.reduce((s, i) => s + i.value, 0)
                                    : (cat as any).value || 0), 0),
                                { forceExact }
                              )}
                            </span>
                          </div>
                          <ResponsiveSunburst
                            key={`asset-sunburst-${importKey}-${assetDrilldown}`}
                            data={activeAssetData}
                            margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
                            id="name"
                            value="value"
                            cornerRadius={3}
                            borderWidth={1}
                            borderColor={{ theme: 'background' }}
                            colors={(node) => {
                              let current = node;
                              while (current.depth > 1 && current.parent) {
                                current = current.parent;
                              }
                              const catColor = (current.data as any)?.color;
                              if (catColor) {
                                if (node.depth > 1) return catColor + 'cc';
                                return catColor;
                              }
                              return '#6b7280';
                            }}
                            childColor={{ from: 'color', modifiers: [['brighter', 0.3]] }}
                            enableArcLabels={true}
                            arcLabelsSkipAngle={15}
                            arcLabelsTextColor="#fff"
                            arcLabel={(node) => {
                              const total = activeAssetData.children.reduce(
                                (sum, cat) => sum + (cat.children?.length
                                  ? cat.children.reduce((s, i) => s + i.value, 0)
                                  : (cat as any).value || 0), 0
                              );
                              return `${((node.value / total) * 100).toFixed(0)}%`;
                            }}
                            onClick={(node) => {
                              if (!assetDrilldown && node.depth === 1) {
                                setAssetDrilldown(String(node.id));
                              }
                            }}
                            tooltip={({ id, value }) => (
                              <div className="bg-gray-900 px-3 py-2 rounded-lg border border-gray-700 shadow-lg">
                                <p className="text-sm font-semibold text-white">{String(id)}</p>
                                <p className="text-sm text-gray-300">{formatCompactCurrency(value, { forceExact })}</p>
                              </div>
                            )}
                            theme={{
                              labels: { text: { fontSize: 10, fontWeight: 600 } },
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Right column: Net Worth */}
              <div className={isSetupComplete ? 'lg:w-[42%] lg:shrink-0' : ''}>
                <NetWorthCard key={`networth-${importKey}`}/>
              </div>
            </div>

            {/* Cash Flow Chart - full width */}
            <div className="bg-[#18181b] rounded-2xl border border-gray-800 p-6 shadow-xl">
              <h2 className="text-xl font-bold text-gray-200 mb-6">Yearly Cash Flow</h2>
              <div className="min-h-75 flex flex-col justify-center">
                {hasIncomes ? (
                  <CashflowSankey
                    key={`sankey-${importKey}`}
                    incomes={incomes}
                    expenses={expenses}
                    year={year}
                    taxes={{ fed: annualFedTax, state: annualStateTax, fica: annualFicaTax }}
                    height={300}
                  />
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