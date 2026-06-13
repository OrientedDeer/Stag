import { useContext, useRef, useState, useMemo, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { IncomeContext } from '../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../components/Objects/Expense/ExpenseContext';
import { AccountContext } from '../components/Objects/Accounts/AccountContext';
import { defaultData } from '../data/defaultData';
import { TaxContext } from '../components/Objects/Taxes/TaxContext';
import { AssumptionsContext, getBirthYear } from '../components/Objects/Assumptions/AssumptionsContext';
import { WorkIncome, AnyIncome } from '../components/Objects/Income/models';
import { TAX_DATABASE } from '../data/TaxData';
import { calculateFederalTaxFromIncomes, calculateFicaTax, calculateStateTax } from '../components/Objects/Taxes/TaxService';
import { useFileManager } from '../components/Objects/Accounts/useFileManager';
import { formatCompactCurrency } from './Future/tabs/FutureUtils';
import { AlertBanner } from '../components/Layout/AlertBanner';

const TaxBreakdownSunburst = lazy(() =>
  import('../components/Charts/TaxBreakdownSunburst').then(m => ({ default: m.TaxBreakdownSunburst }))
);
const SpendingSunburst = lazy(() =>
  import('../components/Charts/SpendingSunburst').then(m => ({ default: m.SpendingSunburst }))
);
const AssetSunburst = lazy(() =>
  import('../components/Charts/AssetSunburst').then(m => ({ default: m.AssetSunburst }))
);
const NetWorthCard = lazy(() =>
  import('../components/Charts/Networth').then(m => ({ default: m.NetWorthCard }))
);
const CashflowSankey = lazy(() =>
  import('../components/Charts/CashflowSankey').then(m => ({ default: m.CashflowSankey }))
);

const ChartSkeleton = ({ heightClass }: { heightClass: string }) => (
  <div className={`bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle p-4 ${heightClass} animate-pulse`} />
);

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
                      inc.rsuVestingSchedule, inc.rsuGrantShares, inc.rsuVestFrequency,
                      inc.rsuExpectedStockGrowth, inc.rsuAccountId, inc.rsuWithholdingRate,
                      inc.pensionSystem, inc.startMilestoneId, inc.endMilestoneId
                  );
              }
          }
          return inc;
      }), [rawIncomes, year, startAge]);

      const { annualFedTax, annualStateTax, annualFicaTax } = useMemo(() => {
          const fedParams = TAX_DATABASE.federal[year]?.[taxState.filingStatus];
          const stateParams = TAX_DATABASE.states[taxState.stateResidency]?.[year]?.[taxState.filingStatus];

          let fed = fedParams ? calculateFederalTaxFromIncomes(taxState, incomes, expenses, 0, year, assumptions) : 0;
          let state = stateParams ? calculateStateTax(taxState, incomes, expenses, year, assumptions) : 0;
          let fica = fedParams ? calculateFicaTax(taxState, incomes, year, assumptions) : 0;

          if (taxState.fedOverride !== null) fed = taxState.fedOverride;
          if (taxState.ficaOverride !== null) fica = taxState.ficaOverride;
          if (taxState.stateOverride !== null) state = taxState.stateOverride;

          return { annualFedTax: fed, annualStateTax: state, annualFicaTax: fica };
      }, [taxState, incomes, expenses, year, assumptions]);

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
    <div className='w-full min-h-full flex bg-surface-base justify-center pt-6 pb-24'>
      <div className="w-full px-4 sm:px-8 max-w-screen-2xl">
        <div className="flex flex-col gap-4 p-4 max-w-screen-2xl mx-auto w-full">
          <div className="flex justify-between items-end border-b border-border-subtle pb-4">
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
              <p className="text-warning-bright/70 mb-4 text-sm">
                To see your financial projections and cash flow chart, please add data to the following sections:
              </p>
              <div className="flex flex-wrap gap-3">
                {!hasAccounts && (
                  <Link
                    to="/current/accounts"
                    className="px-4 py-2 bg-warning-soft/10 hover:bg-warning-soft/20 border border-warning-soft/50 rounded-xl text-warning-bright text-sm font-semibold transition-all"
                  >
                    + Add Accounts or Import
                  </Link>
                )}
                {!hasIncomes && (
                  <Link
                    to="/current/income"
                    className="px-4 py-2 bg-warning-soft/10 hover:bg-warning-soft/20 border border-warning-soft/50 rounded-xl text-warning-bright text-sm font-semibold transition-all"
                  >
                    + Add Income
                  </Link>
                )}
                {!hasExpenses && (
                  <Link
                    to="/current/expense"
                    className="px-4 py-2 bg-warning-soft/10 hover:bg-warning-soft/20 border border-warning-soft/50 rounded-xl text-warning-bright text-sm font-semibold transition-all"
                  >
                    + Add Expenses
                  </Link>
                )}
                {isPristine && (
                  <>
                    <button
                      onClick={loadDefaultData}
                      className="px-4 py-2 bg-info-tint/10 hover:bg-info-tint/20 border border-info-strong/50 rounded-xl text-info-bright text-sm font-semibold transition-all"
                    >
                      + Add Default Data
                    </button>
                    <button
                      onClick={handleImportClick}
                      className="px-4 py-2 bg-positive-soft/10 hover:bg-positive-soft/20 border border-positive-soft/50 rounded-xl text-positive-bright text-sm font-semibold transition-all"
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
                      <div className="bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle p-3 text-center">
                        <p className="text-xs text-content-muted uppercase tracking-wide mb-1">Gross Income</p>
                        <p className="text-lg font-bold text-positive">{formatCompactCurrency(dashboardMetrics.grossIncome, { forceExact })}</p>
                        <p className="text-xs text-content-subtle">per year</p>
                      </div>
                      <div className="bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle p-3 text-center">
                        <p className="text-xs text-content-muted uppercase tracking-wide mb-1">Total Taxes</p>
                        <p className="text-lg font-bold text-negative">{formatCompactCurrency(dashboardMetrics.totalTaxes, { forceExact })}</p>
                        <p className="text-xs text-content-subtle">per year</p>
                      </div>
                      <div className="bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle p-3 text-center">
                        <p className="text-xs text-content-muted uppercase tracking-wide mb-1">Savings Rate</p>
                        <p className={`text-lg font-bold ${dashboardMetrics.savingsRate >= 0 ? 'text-info' : 'text-cat-orange'}`}>
                          {dashboardMetrics.savingsRate.toFixed(1)}%
                        </p>
                        <p className="text-xs text-content-subtle">of gross income</p>
                      </div>
                      <div className="bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle p-3 text-center">
                        <p className="text-xs text-content-muted uppercase tracking-wide mb-1">Expenses</p>
                        <p className="text-lg font-bold text-cat-orange">{formatCompactCurrency(dashboardMetrics.monthlyExpenses, { forceExact })}</p>
                        {/* Annualized average (annual total / 12) — deliberately different from
                            Budget/Allocation's "this month" figures, which use today's active expenses. */}
                        <p className="text-xs text-content-subtle">avg/mo this year</p>
                      </div>
                    </div>

                    {/* Tax Breakdown */}
                    <Suspense fallback={<ChartSkeleton heightClass="h-56" />}>
                      <TaxBreakdownSunburst
                        annualFedTax={annualFedTax}
                        annualStateTax={annualStateTax}
                        annualFicaTax={annualFicaTax}
                        importKey={importKey}
                        forceExact={forceExact}
                      />
                    </Suspense>
                  </div>

                  {/* Row 2: Spending Sunburst + Asset Sunburst */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Spending Sunburst */}
                    {hasExpenses && (
                      <Suspense fallback={<ChartSkeleton heightClass="h-80" />}>
                        <SpendingSunburst
                          expenses={expenses}
                          incomes={incomes}
                          accounts={accountCtx.accounts}
                          year={year}
                          startAge={startAge}
                          grossIncome={dashboardMetrics.grossIncome}
                          totalExpenses={dashboardMetrics.totalExpenses}
                          totalTaxes={dashboardMetrics.totalTaxes}
                          monthlyExpenses={dashboardMetrics.monthlyExpenses}
                          annualFedTax={annualFedTax}
                          annualStateTax={annualStateTax}
                          annualFicaTax={annualFicaTax}
                          priorities={assumptions.priorities || []}
                          importKey={importKey}
                          forceExact={forceExact}
                        />
                      </Suspense>
                    )}

                    {/* Asset Sunburst */}
                    {hasAccounts && (
                      <Suspense fallback={<ChartSkeleton heightClass="h-80" />}>
                        <AssetSunburst
                          accounts={accountCtx.accounts}
                          importKey={importKey}
                          forceExact={forceExact}
                        />
                      </Suspense>
                    )}
                  </div>
                </div>
              )}

              {/* Right column: Net Worth */}
              <div className={isSetupComplete ? 'lg:w-[42%] lg:shrink-0' : ''}>
                <Suspense fallback={<ChartSkeleton heightClass="h-96" />}>
                  <NetWorthCard key={`networth-${importKey}`}/>
                </Suspense>
              </div>
            </div>

            {/* Cash Flow Chart - full width */}
            <div className="bg-[var(--c-surface-raised)] rounded-2xl border border-border-subtle p-6 shadow-xl">
              <h2 className="text-xl font-bold text-content-emphasis mb-6">Yearly Cash Flow</h2>
              <div className="min-h-75 flex flex-col justify-center">
                {hasIncomes ? (
                  <Suspense fallback={<div className="h-[300px] animate-pulse bg-surface-raised/50 rounded-xl" />}>
                    <CashflowSankey
                      key={`sankey-${importKey}`}
                      incomes={incomes}
                      expenses={expenses}
                      year={year}
                      taxes={{ fed: annualFedTax, state: annualStateTax, fica: annualFicaTax }}
                      height={300}
                    />
                  </Suspense>
                ) : (
                  <div className='flex flex-col items-center justify-center text-center p-12 border-2 border-dashed border-border-subtle rounded-2xl'>
                    <div className="text-content-muted text-lg mb-2">No income data available</div>
                    <p className="text-content-muted text-sm max-w-xs">
                      The Sankey chart requires income data to visualize your cash flow.
                    </p>
                    <Link to="/current/income" className="mt-4 text-info hover:text-info-bright font-medium transition-colors">
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