// src/components/Taxes/TaxService.ts
import { AnyExpense } from '../Expense/models';
import { AnyIncome, WorkIncome } from '../Income/models';
import { TaxParameters } from './TaxData';

export function getEarnedAnnualIncome(incomes: AnyIncome[]): number {
  return incomes
    .filter(inc => inc instanceof WorkIncome)
    .reduce((acc, inc) => {
      if (inc.frequency === 'Monthly') return acc + (inc.amount * 12);
      if (inc.frequency === 'Weekly') return acc + (inc.amount * 52);
      return acc + inc.amount;
    }, 0);
}

export function getAnnualDeductionByType(expenses: AnyExpense[], type: 'Yes' | 'Itemized'): number {
  return expenses.reduce((total, exp) => {
    if ('is_tax_deductible' in exp && exp.is_tax_deductible === type && 'tax_deductible' in exp) {
      const amount = (exp as any).tax_deductible || 0;
      const multiplier = { Daily: 365, Weekly: 52, Monthly: 12, Annually: 1 }[exp.frequency] || 0;
      return total + (amount * multiplier);
    }
    return total;
  }, 0);
}

export function getTotalAnnualDeductions(expenses: AnyExpense[]): number {
  return expenses.reduce((total, exp) => {
    // Type guard/check: Only process if it has the deduction fields and is marked 'Yes'
    if ('is_tax_deductible' in exp && exp.is_tax_deductible === 'Yes' && 'tax_deductible' in exp) {
      const amount = (exp as any).tax_deductible || 0;
      
      switch (exp.frequency) {
        case 'Daily': return total + (amount * 365);
        case 'Weekly': return total + (amount * 52);
        case 'Monthly': return total + (amount * 12);
        case 'Annually': return total + amount;
        default: return total;
      }
    }
    return total;
  }, 0);
}

export function calculateFicaTax(earnedIncome: number, params: TaxParameters): number {
  // Social Security is capped at the wage base
  const ssTax = Math.min(earnedIncome, params.socialSecurityWageBase) * params.socialSecurityTaxRate;
  
  // Medicare is uncapped (simplified - ignoring the 0.9% Additional Medicare Tax for >$200k)
  const medicareTax = earnedIncome * params.medicareTaxRate;
  
  return ssTax + medicareTax;
}

export function calculateTax(grossIncome: number, params: TaxParameters): number {
  const taxableIncome = Math.max(0, grossIncome - params.standardDeduction);
  let totalTax = 0;

  for (let i = 0; i < params.brackets.length; i++) {
    const current = params.brackets[i];
    const next = params.brackets[i + 1];
    const upperLimit = next ? next.threshold : Infinity;

    if (taxableIncome > current.threshold) {
      const amountInBracket = Math.min(taxableIncome, upperLimit) - current.threshold;
      totalTax += amountInBracket * current.rate;
    }
  }
  return totalTax;
}

export function getTotalAnnualIncome(incomes: AnyIncome[]): number {
  return incomes.reduce((acc, inc) => {
    if (inc.frequency === 'Monthly') return acc + (inc.amount * 12);
    if (inc.frequency === 'Weekly') return acc + (inc.amount * 52);
    return acc + inc.amount;
  }, 0);
}