import { useMemo, useState } from 'react';
import { ResponsiveSunburst } from '@nivo/sunburst';
import { type AnyExpense, RentExpense, MortgageExpense, FoodExpense, TransportExpense, HealthcareExpense, VacationExpense, LoanExpense, DependentExpense, getGoalFundAnnualSetAside, isLongTermGoal } from '../Objects/Expense/models';
import { type AnyIncome, WorkIncome } from '../Objects/Income/models';
import { type AnyAccount } from '../Objects/Accounts/models';
import { useChartTheme } from './useChartTheme';
import { ChartFrame } from "./ChartFrame";
import { SunburstLegend } from './SunburstLegend';
import { contrastInk, sunburstItemShade } from './chartColors';
import { type PriorityBucket, getBucketTargetBalance } from '../Objects/Assumptions/AssumptionsContext';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';

interface SpendingSunburstProps {
  expenses: AnyExpense[];
  incomes: AnyIncome[];
  accounts: AnyAccount[];
  year: number;
  startAge: number;
  grossIncome: number;
  totalExpenses: number;
  totalTaxes: number;
  monthlyExpenses: number;
  annualFedTax: number;
  annualStateTax: number;
  annualFicaTax: number;
  priorities: PriorityBucket[];
  importKey: string | number;
  forceExact: boolean;
}

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

// Fixed categorical slot per category (never cycled), drawn from the themeable
// series palette so every theme keeps slices distinct. The old map mixed status
// colors (Food=green, Transportation=yellow, Healthcare=red) with three
// near-identical purples (Housing/Entertainment/Dependents/Debt). Slots 3 (the
// elite theme's money gold — Savings uses --color-chart-money) and near-twin
// hue pairs within each theme are deliberately avoided; adjacency validated
// with the palette checker in both themes.
const categoryColors: Record<string, string> = {
  'Housing': 'var(--color-chart-series-1)',
  'Food': 'var(--color-chart-series-2)',
  'Transportation': 'var(--color-chart-series-4)',
  'Healthcare': 'var(--color-chart-series-7)',
  'Entertainment': 'var(--color-chart-series-8)',
  'Debt': 'var(--color-chart-series-11)',
  'Dependents': 'var(--color-chart-series-10)',
  'Other': 'var(--c-content-subtle)',
  'Savings': 'var(--color-chart-money)',
};

export const SpendingSunburst = ({
  expenses,
  incomes,
  accounts,
  year,
  startAge,
  grossIncome,
  totalExpenses,
  totalTaxes,
  monthlyExpenses,
  annualFedTax,
  annualStateTax,
  annualFicaTax,
  priorities,
  importKey,
  forceExact,
}: SpendingSunburstProps) => {
  const { resolve } = useChartTheme();
  const [showSavings, setShowSavings] = useState(() => localStorage.getItem('stag_show_savings') === 'true');
  const [showTaxes, setShowTaxes] = useState(() => localStorage.getItem('stag_show_taxes') === 'true');
  const [spendingDrilldown, setSpendingDrilldown] = useState<string | null>(null);

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
        color: categoryColors[category] || 'var(--c-content-subtle)',
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
          // yellow-600 — a duller yellow, distinct from Transportation's --c-warning-soft
          color: 'var(--c-warning-solid)',
          children: taxItems,
        });
      }
    }

    if (showSavings) {
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

      // Insurance is a payroll benefit, not savings — it leaves the paycheck and
      // doesn't accrue to the user. The sim's CashflowSankey routes it to
      // "Benefits", so exclude it from savings here (alongside taxes/expenses).
      const employeeSavings = grossIncome - totalExpenses - totalTaxes - totalInsurance;
      if (employeeSavings > 0) {
        const payrollAllocated = totalPreTax + totalRoth + totalHSA + totalMatch + totalESPP;
        let remaining = Math.max(0, employeeSavings - payrollAllocated);

        const savingsItems: { name: string; value: number }[] = [];
        if (totalPreTax > 0) savingsItems.push({ name: 'Pre-tax 401k', value: totalPreTax });
        if (totalRoth > 0) savingsItems.push({ name: 'Roth 401k', value: totalRoth });
        if (totalHSA > 0) savingsItems.push({ name: 'HSA', value: totalHSA });
        if (totalMatch > 0) savingsItems.push({ name: 'Employer Match', value: totalMatch });
        if (totalESPP > 0) savingsItems.push({ name: 'ESPP', value: totalESPP });

        // Long-term goal set-asides are COMMITTED transfers — taken before the
        // priority waterfall, mirroring the sim engine (which counts them with
        // living expenses and credits the fund directly). Months-prorated for
        // mid-year starts and the partial final year.
        for (const g of expenses) {
          if (!isLongTermGoal(g) || !g.goalAccountId) continue;
          const annual = getGoalFundAnnualSetAside(expenses, g.goalAccountId, year) ?? 0;
          if (annual <= 0) continue;
          const allocated = Math.min(Math.max(0, remaining), annual);
          if (allocated > 0) {
            savingsItems.push({ name: `${g.name} fund`, value: allocated });
            remaining -= allocated;
          }
        }

        for (const bucket of priorities) {
          if (remaining <= 0) break;
          // Legacy goal buckets are skipped — goal funding is committed above.
          if (getGoalFundAnnualSetAside(expenses, bucket.accountId, year) !== undefined) continue;
          let bucketCap: number;
          switch (bucket.capType) {
            case 'FIXED':
              bucketCap = (bucket.capValue ?? 0) * 12;
              break;
            case 'MAX':
              bucketCap = bucket.capValue ?? 0;
              break;
            case 'TARGET':
            case 'MULTIPLE_OF_EXPENSES': {
              // Balance target: fund the gap to the desired end balance.
              const targetBalance = getBucketTargetBalance(bucket, monthlyExpenses)!;
              const currentBalance = accounts.find(a => a.id === bucket.accountId)?.amount ?? 0;
              bucketCap = Math.max(0, targetBalance - currentBalance);
              break;
            }
            case 'REMAINDER':
              bucketCap = Infinity;
              break;
            default: {
              // Exhaustiveness guard: a forgotten CapType would otherwise
              // fail dangerous-open (Infinity cap swallows all surplus).
              const _exhaustive: never = bucket.capType;
              throw new Error(`Unhandled capType: ${_exhaustive as string}`);
            }
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
            color: 'var(--color-chart-money)',
            children: savingsItems,
          });
        }
      }
    }

    // Outer ring: give each item its own tint of the category color (largest
    // first, spread across the ramp) so adjacent siblings are distinguishable —
    // a single uniform childColor modifier rendered every sibling identically.
    const shaded = children.map(cat => {
      const base = resolve(cat.color);
      const items = [...cat.children].sort((a, b) => b.value - a.value);
      return {
        ...cat,
        children: items.map((item, i) => ({
          ...item,
          color: sunburstItemShade(base, i, items.length),
        })),
      };
    });

    return { name: 'Spending', children: shaded };
  }, [expenses, year, startAge, incomes, showSavings, showTaxes, grossIncome, totalExpenses, totalTaxes, monthlyExpenses, annualFedTax, annualStateTax, annualFicaTax, priorities, accounts, resolve]);

  const activeSpendingData = useMemo(() => {
    if (!spendingDrilldown) return spendingSunburstData;
    const cat = spendingSunburstData.children.find(c => c.name === spendingDrilldown);
    if (!cat) return spendingSunburstData;
    return {
      name: cat.name,
      children: cat.children.map(item => ({
        ...item, // keeps the item's own ramp tint
        children: [] as { name: string; value: number; color?: string }[],
      })),
    };
  }, [spendingSunburstData, spendingDrilldown]);

  if (spendingSunburstData.children.length === 0) return null;

  const activeTotal = activeSpendingData.children.reduce(
    (sum, cat) => sum + (cat.children?.length
      ? cat.children.reduce((s, i) => s + i.value, 0)
      : (cat as { value?: number }).value || 0), 0
  );

  return (
    <div className="bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-content-emphasis">
          {spendingDrilldown ? (
            <>
              <button onClick={() => setSpendingDrilldown(null)} className="text-content-subtle hover:text-content-default transition-colors">Spending</button>
              <span className="text-content-faint mx-1">/</span>
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
                  ? 'border-negative-soft/50 bg-negative-soft/10 text-negative'
                  : 'border-border-default bg-transparent text-content-subtle hover:text-content-muted'
              }`}
            >
              {showTaxes ? 'Taxes On' : '+ Taxes'}
            </button>
            <button
              onClick={() => setShowSavings(s => { localStorage.setItem('stag_show_savings', String(!s)); return !s; })}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                showSavings
                  ? 'border-positive-soft/50 bg-positive-soft/10 text-positive'
                  : 'border-border-default bg-transparent text-content-subtle hover:text-content-muted'
              }`}
            >
              {showSavings ? 'Savings On' : '+ Savings'}
            </button>
          </div>
        )}
      </div>
      <SunburstLegend
        entries={activeSpendingData.children.map(c => ({ name: c.name, color: c.color }))}
        className="mb-1"
      />
      <div className="h-64 relative">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="text-sm font-bold text-content-emphasis">
            {formatCompactCurrency(activeTotal, { forceExact })}
          </span>
        </div>
        <ChartFrame><ResponsiveSunburst
          key={`spending-sunburst-${importKey}`}
          data={activeSpendingData}
          margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
          id="name"
          value="value"
          cornerRadius={3}
          borderWidth={1}
          borderColor={{ theme: 'background' }}
          // Every datum (category AND item) carries its own color — items get a
          // spread tint ramp — so parent inheritance is disabled.
          inheritColorFromParent={false}
          colors={(node) => resolve((node.data as { color?: string })?.color || 'var(--c-content-subtle)')}
          enableArcLabels={true}
          arcLabelsSkipAngle={18}
          arcLabelsTextColor={(d) => contrastInk(d.color)}
          arcLabel={(node) => `${((node.value / activeTotal) * 100).toFixed(0)}%`}
          onClick={(node) => {
            if (!spendingDrilldown && node.depth === 1) {
              setSpendingDrilldown(String(node.id));
            }
          }}
          tooltip={({ id, value }) => (
            <div className="bg-surface-raised px-3 py-2 rounded-lg border border-border-default shadow-lg">
              <p className="text-sm font-semibold text-content-strong">{String(id)}</p>
              <p className="text-sm text-content-default">{formatCompactCurrency(value, { forceExact })}/yr</p>
            </div>
          )}
          theme={{
            labels: { text: { fontSize: 10, fontWeight: 600 } },
          }}
        /></ChartFrame>
      </div>
    </div>
  );
};
