import { AnyExpense } from '../Expense/models';
import { AnyIncome, WorkIncome } from '../Income/models';
import { TaxParameters } from './TaxData';

// Helper to convert any frequency to Annual
const toAnnual = (amount: number, frequency: string) => {
    switch (frequency) {
        case 'Weekly': return amount * 52;
        case 'Monthly': return amount * 12;
        case 'Daily': return amount * 365;
        default: return amount;
    }
};

export function getGrossIncome(incomes: AnyIncome[]): number {
  return incomes.reduce((acc, inc) => acc + toAnnual(inc.amount, inc.frequency), 0);
}

export function getPreTaxExemptions(incomes:AnyIncome[]): number {
  return incomes.filter(inc => inc instanceof WorkIncome).reduce((acc, inc) => acc + toAnnual((inc.preTax401k + inc.insurance), inc.frequency), 0);
}

export function getPostTaxExemptions(incomes:AnyIncome[]): number {
  return incomes.filter(inc => inc instanceof WorkIncome).reduce((acc, inc) => acc + toAnnual((inc.roth401k), inc.frequency), 0);
}

export function getUnearnedIncome(incomes:AnyIncome[]): number{
  return incomes.filter(inc => inc.earned_income === 'No').reduce((acc, inc) => acc + toAnnual((inc.amount), inc.frequency), 0);
}

export function getEarnedIncome(incomes:AnyIncome[]): number{
  return incomes.filter(inc => inc.earned_income === 'Yes').reduce((acc, inc) => acc + toAnnual((inc.amount), inc.frequency), 0);
}

export function getItemizedDeductions(expenses: AnyExpense[]): number {
	return expenses
		.filter(
			(exp) => "is_tax_deductible" in exp && exp.is_tax_deductible === "Itemized"
		)
		.reduce(
			(val, exp) =>
				val + toAnnual((exp as any).tax_deductible || 0, exp.frequency),
			0
		);
}

export function getYesDeductions(expenses: AnyExpense[]): number {
	return expenses
		.filter(
			(exp) => "is_tax_deductible" in exp && exp.is_tax_deductible === "Yes"
		)
		.reduce(
			(val, exp) =>
				val + toAnnual((exp as any).tax_deductible || 0, exp.frequency),
			0
		);
}


export function calculateFicaTax(earnedGross: number, ficaExemptions: number, params: TaxParameters): number {
  const taxableBase = Math.max(0, earnedGross - ficaExemptions);
  const ssTax = Math.min(taxableBase, params.socialSecurityWageBase) * params.socialSecurityTaxRate;
  const medicareTax = taxableBase * params.medicareTaxRate;
  return ssTax + medicareTax;
}

export function calculateTax(grossIncome: number, preTaxDeductions: number, params: TaxParameters): number {
  const adjustedGross = Math.max(0, grossIncome - preTaxDeductions);
  const taxableIncome = Math.max(0, adjustedGross - params.standardDeduction);
  
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