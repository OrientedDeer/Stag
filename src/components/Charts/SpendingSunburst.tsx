import { useMemo, useState } from 'react';
import { ResponsiveSunburst } from '@nivo/sunburst';
import { AnyExpense, RentExpense, MortgageExpense, FoodExpense, TransportExpense, HealthcareExpense, VacationExpense, LoanExpense, DependentExpense } from '../Objects/Expense/models';
import { AnyIncome, WorkIncome } from '../Objects/Income/models';
import { AnyAccount } from '../Objects/Accounts/models';
import { PriorityBucket } from '../Objects/Assumptions/AssumptionsContext';
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
      const employeeSavings = grossIncome - totalExpenses - totalTaxes;
      if (employeeSavings > 0) {
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
              const targetBalance = monthlyExpenses * (bucket.capValue ?? 0);
              const currentBalance = accounts.find(a => a.id === bucket.accountId)?.amount ?? 0;
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
  }, [expenses, year, startAge, incomes, showSavings, showTaxes, grossIncome, totalExpenses, totalTaxes, monthlyExpenses, annualFedTax, annualStateTax, annualFicaTax, priorities, accounts]);

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

  if (spendingSunburstData.children.length === 0) return null;

  const activeTotal = activeSpendingData.children.reduce(
    (sum, cat) => sum + (cat.children?.length
      ? cat.children.reduce((s, i) => s + i.value, 0)
      : (cat as any).value || 0), 0
  );

  return (
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
            {formatCompactCurrency(activeTotal, { forceExact })}
          </span>
        </div>
        <ResponsiveSunburst
          key={`spending-sunburst-${importKey}`}
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
          arcLabel={(node) => `${((node.value / activeTotal) * 100).toFixed(0)}%`}
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
  );
};
