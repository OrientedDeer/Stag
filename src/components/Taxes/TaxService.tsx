import { AnyExpense, MortgageExpense } from "../Expense/models";
import { AnyIncome, WorkIncome } from "../Income/models";
import { TaxState } from "./TaxContext";
import { TaxParameters, TAX_DATABASE } from "./TaxData";
import { getExpenseActiveMultiplier } from '../Expense/models';

export function getGrossIncome(incomes: AnyIncome[], year: number): number {
	return incomes.reduce((acc, inc) => {
		let currentIncome = inc.amount;
		if (
			inc instanceof WorkIncome &&
			inc.taxType === "Roth 401k"
		) {
			currentIncome += inc.employerMatch;
 		}
		return acc + inc.getProratedAnnual(inc.amount, year)
	}, 0);
}

export function getPreTaxExemptions(incomes: AnyIncome[], year: number): number {
	return incomes
		.filter((inc) => inc instanceof WorkIncome)
		.reduce(
			(acc, inc) => {
				return acc + inc.getProratedAnnual(inc.preTax401k, year) + inc.getProratedAnnual(inc.insurance, year);
			},
			0
		);
}

export function getPostTaxEmployerMatch(incomes: AnyIncome[], year: number): number {
	return incomes.reduce((acc, inc) => {
		if (
			inc instanceof WorkIncome &&
			inc.taxType === "Roth 401k"
		) {
			return acc + inc.getProratedAnnual(inc.employerMatch, year);
 		}
		return acc
	}, 0);
}

export function getPostTaxExemptions(incomes: AnyIncome[], year: number): number {
	return incomes
		.filter((inc) => inc instanceof WorkIncome)
		.reduce((acc, inc) => {
			return acc + inc.getProratedAnnual(inc.roth401k, year);
		}, 0);
}

export function getFicaExemptions(incomes: AnyIncome[], year: number): number {
	return incomes
		.filter((inc) => inc instanceof WorkIncome)
		.reduce((acc, inc) => {
			return acc + inc.getProratedAnnual(inc.insurance, year);
		}, 0);
}

export function getEarnedIncome(incomes: AnyIncome[], year: number): number {
	return incomes
		.filter((inc) => inc.earned_income === "Yes")
		.reduce((acc, inc) => {
			return acc + inc.getProratedAnnual(inc.amount, year);
		}, 0);
}

export function getItemizedDeductions(
	expenses: AnyExpense[],
	year: number
): number {
	return expenses
		.filter(
			(exp) =>
				"is_tax_deductible" in exp && exp.is_tax_deductible === "Itemized" && getExpenseActiveMultiplier(exp, year) > 0
		)
		.reduce(
			(val, exp) => {
				if (exp instanceof MortgageExpense) {
					var temp = exp.calculateAnnualAmortization(year).totalInterest;

					return val + temp;
				}
				return val + exp.getProratedAnnual((exp as any).tax_deductible || 0, year)
			},
			0
		);
}

export function getYesDeductions(expenses: AnyExpense[], year: number): number {
	return expenses
		.filter(
			(exp) => "is_tax_deductible" in exp && exp.is_tax_deductible === "Yes" && getExpenseActiveMultiplier(exp, year) > 0
		)
		.reduce(
			(val, exp) => {
				if (exp instanceof MortgageExpense) {
					return val + exp.calculateAnnualAmortization(year).totalInterest;
				}
				return val + exp.getProratedAnnual((exp as any).tax_deductible || 0, year)
			},
			0
		);
}

export function calculateTax(
	grossIncome: number,
	preTaxDeductions: number,
	params: TaxParameters
): number {
	const adjustedGross = Math.max(0, grossIncome - preTaxDeductions);

	const taxableIncome = Math.max(0, adjustedGross - params.standardDeduction);

	let totalTax = 0;

	for (let i = 0; i < params.brackets.length; i++) {
		const current = params.brackets[i];

		const next = params.brackets[i + 1];

		const upperLimit = next ? next.threshold : Infinity;

		if (taxableIncome > current.threshold) {
			const amountInBracket =
				Math.min(taxableIncome, upperLimit) - current.threshold;

			totalTax += amountInBracket * current.rate;
		}
	}

	return totalTax;
}

export function calculateFicaTax(
	state: TaxState,
	incomes: AnyIncome[],
	year: number
): number {
	if (state.ficaOverride !== null) {
		return state.ficaOverride;
	}

	const earnedGross = getEarnedIncome(incomes, year);

	const ficaExemptions = getFicaExemptions(incomes, year);

	const fedParams = TAX_DATABASE.federal[year][state.filingStatus];

	const taxableBase = Math.max(0, earnedGross - ficaExemptions);

	const ssTax =
		Math.min(taxableBase, fedParams.socialSecurityWageBase) *
		fedParams.socialSecurityTaxRate;

	const medicareTax = taxableBase * fedParams.medicareTaxRate;

	return ssTax + medicareTax;
}

export function calculateStateTax(
	state: TaxState,
	incomes: AnyIncome[],
	expenses: AnyExpense[],
	year: number
) {
	if (state.stateOverride !== null) {
		return state.stateOverride;
	}

	const annualGross = getGrossIncome(incomes, year);

	// 2. Deductions Logic

	const incomePreTaxDeductions = getPreTaxExemptions(incomes, year);

	const expenseAboveLineDeductions = getYesDeductions(expenses, year);

	const totalPreTaxDeductions =
		incomePreTaxDeductions + expenseAboveLineDeductions;

	// Standard vs Itemized Logic

	var itemizedTotal = getItemizedDeductions(expenses, year);

	const stateParams =
		TAX_DATABASE.states[state.stateResidency]?.[year]?.[state.filingStatus];

	const stateStandardDeduction = stateParams?.standardDeduction || 0;

	const stateAppliedMainDeduction =
		state.deductionMethod === "Standard"
			? stateStandardDeduction
			: itemizedTotal;

	const stateTax =
		state.stateOverride !== null
			? state.stateOverride
			: stateParams
			? calculateTax(annualGross, totalPreTaxDeductions, {
					...stateParams,
					standardDeduction: stateAppliedMainDeduction,
			  })
			: 0;

	return stateTax;
}

export function calculateFederalTax(
	state: TaxState,
	incomes: AnyIncome[],
	expenses: AnyExpense[],
	year: number
) {
	if (state.fedOverride !== null) {
		return state.fedOverride;
	}

	const annualGross = getGrossIncome(incomes, year);

	// 2. Deductions Logic

	const incomePreTaxDeductions = getPreTaxExemptions(incomes, year);

	const stateTax = calculateStateTax(state, incomes, expenses, year);

	const expenseAboveLineDeductions = getYesDeductions(expenses, year);

	const totalPreTaxDeductions =
		incomePreTaxDeductions + expenseAboveLineDeductions;

	// Standard vs Itemized Logic

	var itemizedTotal = getItemizedDeductions(expenses, year) + stateTax;

	const fedParams = TAX_DATABASE.federal[year][state.filingStatus];

	const fedStandardDeduction = fedParams.standardDeduction;

	const fedAppliedMainDeduction =
		state.deductionMethod === "Standard" ? fedStandardDeduction : itemizedTotal;

	const federalTax =
		state.fedOverride !== null
			? state.fedOverride
			: calculateTax(annualGross, totalPreTaxDeductions, {
					...fedParams,
					standardDeduction: fedAppliedMainDeduction,
			  });

	return federalTax;
}
