import { AnyExpense, MortgageExpense } from "../../Objects/Expense/models";
import { AnyIncome, WorkIncome, CurrentSocialSecurityIncome, FutureSocialSecurityIncome } from "../../Objects/Income/models";
import { TaxState } from "./TaxContext";
import {
	TaxParameters,
	TAX_DATABASE,
	getClosestTaxYear,
	max_year,
	FilingStatus,
	AuthorityData,
} from "../../../data/TaxData";
import { getExpenseActiveMultiplier } from "../../Objects/Expense/models";
import {
	AssumptionsState,
	defaultAssumptions,
	getBirthYear,
} from "../../Objects/Assumptions/AssumptionsContext";

// ============================================================================
// Constants
// ============================================================================

/** Tax years when TCJA SALT cap was in effect ($10k/$5k MFS) */
const TCJA_SALT_START_YEAR = 2018;
const TCJA_SALT_END_YEAR = 2024;

/** Tax years when OBBBA raised SALT cap ($40k/$20k MFS with 1% annual inflation) */
const OBBBA_SALT_START_YEAR = 2025;
const OBBBA_SALT_END_YEAR = 2029;

/** SALT cap amounts */
const SALT_CAP_TCJA_JOINT = 10000;
const SALT_CAP_TCJA_MFS = 5000;
const SALT_CAP_OBBBA_JOINT = 40000;
const SALT_CAP_OBBBA_MFS = 20000;
const SALT_CAP_ANNUAL_INCREASE = 0.01; // 1% annual increase under OBBBA

/** Social Security combined income thresholds for benefit taxation */
const SS_THRESHOLDS_SINGLE = { first: 25000, second: 34000 };
const SS_THRESHOLDS_JOINT = { first: 32000, second: 44000 };

/** Social Security taxation rates */
const SS_TIER1_TAXABLE_RATE = 0.5;  // 50% of excess taxable in tier 1
const SS_TIER2_TAXABLE_RATE = 0.85; // 85% of excess taxable in tier 2
const SS_MAX_TAXABLE_RATE = 0.85;   // Maximum 85% of benefits can be taxed

/** Binary search parameters for gross withdrawal solver */
const WITHDRAWAL_SOLVER_MAX_ITERATIONS = 50;
const WITHDRAWAL_SOLVER_TOLERANCE = 0.005;
const WITHDRAWAL_SOLVER_FALLBACK_TAX_RATE = 0.30;

/**
 * SALT (State and Local Tax) deduction cap.
 *
 * History:
 * - TCJA 2017 (effective 2018-2024): $10,000 cap ($5,000 MFS)
 * - One Big Beautiful Bill Act 2025 (effective 2025-2029): $40,000 cap ($20,000 MFS)
 *   with 1% annual increase starting 2026
 * - 2030+: Reverts to $10,000
 *
 * Note: The 2025 law includes income phase-outs starting at $500k MAGI, but we don't
 * implement those here for simplicity. The cap still provides a minimum of $10,000.
 */
export function getSALTCap(year: number, filingStatus: FilingStatus): number {
	const isMFS = filingStatus === 'Married Filing Separately';

	// Pre-TCJA: No cap
	if (year < TCJA_SALT_START_YEAR) {
		return Infinity;
	}

	// TCJA cap period (2018-2024)
	if (year >= TCJA_SALT_START_YEAR && year <= TCJA_SALT_END_YEAR) {
		return isMFS ? SALT_CAP_TCJA_MFS : SALT_CAP_TCJA_JOINT;
	}

	// OBBBA raised cap period (2025-2029) with 1% annual increase starting 2026
	if (year >= OBBBA_SALT_START_YEAR && year <= OBBBA_SALT_END_YEAR) {
		const yearsOfIncrease = Math.max(0, year - OBBBA_SALT_START_YEAR);
		const inflationFactor = Math.pow(1 + SALT_CAP_ANNUAL_INCREASE, yearsOfIncrease);
		const baseCap = isMFS ? SALT_CAP_OBBBA_MFS : SALT_CAP_OBBBA_JOINT;
		return Math.round(baseCap * inflationFactor);
	}

	// 2030+: Reverts to original TCJA cap
	return isMFS ? SALT_CAP_TCJA_MFS : SALT_CAP_TCJA_JOINT;
}

// Legacy constants for backward compatibility
export const SALT_CAP = 10000;
export const SALT_CAP_MFS = 5000;

export function getTaxParameters(
	year: number,
	filingStatus: FilingStatus,
	authority: "federal" | "state",
	stateResidency?: string,
	assumptions: AssumptionsState = {
		...defaultAssumptions,
		macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
	}
): TaxParameters | undefined {
	const inflation = assumptions.macro.inflationRate / 100;
	const inflationAdjusted = assumptions.macro.inflationAdjusted;

	let sourceData: AuthorityData;
	if (authority === "federal") {
		sourceData = TAX_DATABASE.federal;
	} else if (stateResidency && TAX_DATABASE.states[stateResidency]) {
		sourceData = TAX_DATABASE.states[stateResidency];
	} else {
		return undefined; // Or handle error appropriately
	}

	const closestYear = getClosestTaxYear(year);

	if (inflationAdjusted && year > max_year) {
		const baseYearParams = sourceData[max_year][filingStatus];
		if (!baseYearParams) return undefined;

		const yearsToCompound = year - max_year;
		const inflationMultiplier = Math.pow(1 + inflation, yearsToCompound);

		const inflatedBrackets = baseYearParams.brackets.map((bracket) => ({
			...bracket,
			threshold: Math.round(bracket.threshold * inflationMultiplier),
		}));

		return {
			...baseYearParams,
			standardDeduction: Math.round(
				baseYearParams.standardDeduction * inflationMultiplier
			),
			socialSecurityWageBase: Math.round(
				baseYearParams.socialSecurityWageBase * inflationMultiplier
			),
			brackets: inflatedBrackets,
		};
	}

	return sourceData[closestYear]?.[filingStatus];
}

export function getGrossIncome(incomes: AnyIncome[], year: number): number {
	return incomes.reduce((acc, inc) => {
		let currentIncome = inc.amount;
		if (inc instanceof WorkIncome && inc.taxType === "Roth 401k") {
			currentIncome += inc.employerMatch;
		}
		return acc + inc.getProratedAnnual(currentIncome, year);
	}, 0);
}

/**
 * Get pre-tax exemptions (401k, insurance, HSA) from work incomes.
 * @param useStoredValue - If true, reads stored preTax401k directly instead of calling getEffective401k().
 *                         Use true in simulation (after increment() has run), false for UI preview.
 */
export function getPreTaxExemptions(incomes: AnyIncome[], year: number, age?: number, useStoredValue: boolean = false): number {
	return incomes
		.filter((inc) => inc instanceof WorkIncome)
		.reduce((acc, inc) => {
			// Use stored value if requested (simulation context where increment() already computed correct value)
			// Otherwise use effective 401k for UI preview (where increment() hasn't run yet)
			const preTax401k = useStoredValue
				? inc.preTax401k
				: (age !== undefined ? inc.getEffective401k(year, age).preTax : inc.preTax401k);
			return (
				acc +
				inc.getProratedAnnual(preTax401k, year) +
				inc.getProratedAnnual(inc.insurance, year) +
				inc.getProratedAnnual(inc.hsaContribution, year)
			);
		}, 0);
}

export function getPostTaxEmployerMatch(
	incomes: AnyIncome[],
	year: number
): number {
	return incomes.reduce((acc, inc) => {
		if (inc instanceof WorkIncome && inc.taxType === "Roth 401k") {
			return acc + inc.getProratedAnnual(inc.employerMatch, year);
		}
		return acc;
	}, 0);
}

/**
 * Get post-tax exemptions (Roth 401k) from work incomes.
 * @param useStoredValue - If true, reads stored roth401k directly instead of calling getEffective401k().
 *                         Use true in simulation (after increment() has run), false for UI preview.
 */
export function getPostTaxExemptions(incomes: AnyIncome[], year: number, age?: number, useStoredValue: boolean = false): number {
	return incomes
		.filter((inc) => inc instanceof WorkIncome)
		.reduce((acc, inc) => {
			// Use stored value if requested (simulation context where increment() already computed correct value)
			// Otherwise use effective 401k for UI preview (where increment() hasn't run yet)
			const roth401k = useStoredValue
				? inc.roth401k
				: (age !== undefined ? inc.getEffective401k(year, age).roth : inc.roth401k);
			return acc + inc.getProratedAnnual(roth401k, year);
		}, 0);
}

export function getFicaExemptions(incomes: AnyIncome[], year: number): number {
	return incomes
		.filter((inc) => inc instanceof WorkIncome)
		.reduce((acc, inc) => {
			return (
				acc +
				inc.getProratedAnnual(inc.insurance, year) +
				inc.getProratedAnnual(inc.hsaContribution, year)
			);
		}, 0);
}

export function getEarnedIncome(incomes: AnyIncome[], year: number): number {
	return incomes
		.filter((inc) => inc.earned_income === "Yes")
		.reduce((acc, inc) => {
			return acc + inc.getProratedAnnual(inc.amount, year);
		}, 0);
}

/**
 * Get total Social Security benefits received in the year
 */
export function getSocialSecurityBenefits(incomes: AnyIncome[], year: number): number {
	return incomes
		.filter((inc) =>
			inc instanceof CurrentSocialSecurityIncome ||
			inc instanceof FutureSocialSecurityIncome
		)
		.reduce((acc, inc) => {
			return acc + inc.getProratedAnnual(inc.amount, year);
		}, 0);
}

/**
 * Calculate taxable portion of Social Security benefits
 *
 * Combined Income = otherIncome + taxExemptInterest + 50% of SS Benefits
 *
 * Thresholds (not inflation-adjusted since 1984/1993):
 * Single/MFS:
 *   < $25,000: 0% taxable
 *   $25,000-$34,000: Up to 50% taxable
 *   > $34,000: Up to 85% taxable
 *
 * Married Filing Jointly:
 *   < $32,000: 0% taxable
 *   $32,000-$44,000: Up to 50% taxable
 *   > $44,000: Up to 85% taxable
 *
 * @param totalSSBenefits - Gross Social Security benefits received
 * @param otherIncome - All taxable income EXCEPT SS. Must include:
 *                      - Wages and salaries
 *                      - Pension income
 *                      - Traditional IRA/401k withdrawals
 *                      - Roth conversions
 *                      - Long-term capital gains
 *                      - Short-term capital gains
 *                      - Qualified dividends
 *                      - Ordinary dividends
 *                      - Interest income
 *                      - Rental income
 *                      - Any other taxable income
 * @param taxExemptInterest - Municipal bond interest. Not taxed federally, but DOES count
 *                            toward SS combined income calculation. Pass 0 if not tracking.
 *                            TODO: System does not currently track tax-exempt interest separately.
 * @param filingStatus - Tax filing status (Single, MFJ, MFS)
 * @returns Taxable portion of SS benefits (0 to 85% of totalSSBenefits)
 */
export function getTaxableSocialSecurityBenefits(
	totalSSBenefits: number,
	otherIncome: number,
	taxExemptInterest: number,
	filingStatus: FilingStatus
): number {
	if (totalSSBenefits === 0) return 0;

	// Combined income = otherIncome + taxExemptInterest + 50% of SS Benefits
	const combinedIncome = otherIncome + taxExemptInterest + (totalSSBenefits * SS_TIER1_TAXABLE_RATE);

	// Select thresholds based on filing status
	const useSingleThresholds = filingStatus === 'Single' || filingStatus === 'Married Filing Separately';
	const thresholds = useSingleThresholds ? SS_THRESHOLDS_SINGLE : SS_THRESHOLDS_JOINT;

	// No SS benefits are taxable below first threshold
	if (combinedIncome < thresholds.first) {
		return 0;
	}

	// Up to 50% of SS benefits are taxable between first and second threshold
	if (combinedIncome < thresholds.second) {
		const excessAboveFirst = combinedIncome - thresholds.first;
		const taxable50Percent = Math.min(
			excessAboveFirst * SS_TIER1_TAXABLE_RATE,
			totalSSBenefits * SS_TIER1_TAXABLE_RATE
		);
		return Math.min(taxable50Percent, totalSSBenefits);
	}

	// Up to 85% of SS benefits are taxable above second threshold
	const excessAboveSecond = combinedIncome - thresholds.second;
	const tier1Amount = (thresholds.second - thresholds.first) * SS_TIER1_TAXABLE_RATE;
	const tier2Amount = excessAboveSecond * SS_TIER2_TAXABLE_RATE;
	const totalTaxable = tier1Amount + tier2Amount;

	// Cap at 85% of total benefits
	return Math.min(totalTaxable, totalSSBenefits * SS_MAX_TAXABLE_RATE);
}

export function getItemizedDeductions(
	expenses: AnyExpense[],
	year: number
): number {
	return expenses
		.filter(
			(exp) =>
				"is_tax_deductible" in exp &&
				exp.is_tax_deductible === "Itemized" &&
				getExpenseActiveMultiplier(exp, year) > 0
		)
		.reduce((val, exp) => {
			if (exp instanceof MortgageExpense) {
				var temp = exp.calculateAnnualAmortization(year).totalInterest;

				return val + temp;
			}
			return (
				val + exp.getProratedAnnual((exp as any).tax_deductible || 0, year)
			);
		}, 0);
}

export function getYesDeductions(expenses: AnyExpense[], year: number): number {
	return expenses
		.filter(
			(exp) =>
				"is_tax_deductible" in exp &&
				exp.is_tax_deductible === "Yes" &&
				getExpenseActiveMultiplier(exp, year) > 0
		)
		.reduce((val, exp) => {
			if (exp instanceof MortgageExpense) {
				return val + exp.calculateAnnualAmortization(year).totalInterest;
			}
			return (
				val + exp.getProratedAnnual((exp as any).tax_deductible || 0, year)
			);
		}, 0);
}

/**
 * Result of the unified federal tax calculation
 */
export interface TotalFederalTaxResult {
	taxableSS: number;      // Taxable portion of SS benefits
	ordinaryTax: number;    // Tax on ordinary income (wages, pensions, withdrawals, taxable SS, STCG)
	ltcgTax: number;        // Tax on long-term capital gains + qualified dividends
	niitTax: number;        // Net Investment Income Tax (3.8% on investment income above threshold)
	totalTax: number;       // ordinaryTax + ltcgTax + niitTax
}

/** NIIT thresholds by filing status */
const NIIT_THRESHOLDS: Record<FilingStatus, number> = {
	'Single': 200000,
	'Married Filing Jointly': 250000,
	'Married Filing Separately': 125000,
};

/** NIIT rate */
const NIIT_RATE = 0.038;

/**
 * Calculate Net Investment Income Tax (NIIT) as a standalone function.
 *
 * NIIT is 3.8% on the LESSER of:
 * - Net investment income (STCG + LTCG + dividends)
 * - MAGI exceeding threshold ($200k single, $250k MFJ, $125k MFS)
 *
 * Used by Option B post-hoc tax correction after withdrawals determine actual LTCG/STCG.
 *
 * @param magi - Modified Adjusted Gross Income (includes ordinary income, STCG, LTCG, taxable SS)
 * @param shortTermCapitalGains - Short-term capital gains realized
 * @param longTermCapitalGains - Long-term capital gains realized
 * @param filingStatus - Tax filing status
 * @returns NIIT amount
 */
export function calculateNIIT(
	magi: number,
	shortTermCapitalGains: number,
	longTermCapitalGains: number,
	filingStatus: FilingStatus
): number {
	const niitThreshold = NIIT_THRESHOLDS[filingStatus];
	const netInvestmentIncome = shortTermCapitalGains + longTermCapitalGains;

	if (netInvestmentIncome <= 0) return 0;

	const magiExcess = Math.max(0, magi - niitThreshold);
	if (magiExcess <= 0) return 0;

	// NIIT applies to the lesser of investment income or MAGI excess
	const niitBase = Math.min(netInvestmentIncome, magiExcess);
	return niitBase * NIIT_RATE;
}

/**
 * Unified federal tax calculation that handles all income types and their interactions.
 *
 * This function properly handles:
 * - Social Security taxability (provisional income calculation)
 * - STCG taxed as ordinary income (but counted as investment income for NIIT)
 * - LTCG stacking on top of ordinary income for bracket determination
 * - NIIT (3.8% on investment income above threshold)
 * - Standard deduction applied to ordinary income only
 *
 * Calculation order:
 * 1. Calculate provisional income for SS taxability
 * 2. Calculate taxable SS using getTaxableSocialSecurityBenefits
 * 3. Calculate taxable ordinary income (includes STCG)
 * 4. Calculate ordinary tax on taxable ordinary income
 * 5. Calculate LTCG tax where gains "stack" on top of ordinary taxable income
 * 6. Calculate NIIT on investment income above threshold
 *
 * @param ordinaryIncome - Wages, Traditional withdrawals, pensions, Roth conversions (NOT STCG)
 * @param socialSecurityBenefits - Gross SS benefits (we calculate taxable portion internally)
 * @param shortTermCapitalGains - STCG (taxed as ordinary income, but is investment income for NIIT)
 * @param longTermCapitalGains - LTCG + qualified dividends
 * @param preTaxDeductions - 401k, HSA contributions, etc.
 * @param filingStatus - Tax filing status
 * @param params - Federal tax parameters (brackets, standard deduction, LTCG brackets)
 */
export function calculateTotalFederalTax(
	ordinaryIncome: number,
	socialSecurityBenefits: number,
	shortTermCapitalGains: number,
	longTermCapitalGains: number,
	preTaxDeductions: number,
	filingStatus: FilingStatus,
	params: TaxParameters
): TotalFederalTaxResult {
	// =========================================================================
	// STEP 1: Calculate provisional income for SS taxability
	// =========================================================================
	// IRS formula: Provisional Income = AGI (excluding SS) + tax-exempt interest + 50% of SS
	// For simplicity, we don't track tax-exempt interest separately
	// Note: Both STCG and LTCG count toward provisional income
	const provisionalIncome = ordinaryIncome + shortTermCapitalGains + longTermCapitalGains + (socialSecurityBenefits * 0.5);

	// =========================================================================
	// STEP 2: Calculate taxable portion of Social Security
	// =========================================================================
	// TODO: Verify all income types are included (LTCG, STCG, dividends, etc.)
	const taxableSS = getTaxableSocialSecurityBenefits(
		socialSecurityBenefits,
		provisionalIncome - (socialSecurityBenefits * 0.5), // Pass otherIncome excluding SS
		0, // taxExemptInterest - not currently tracked
		filingStatus
	);

	// =========================================================================
	// STEP 3: Calculate taxable ordinary income (includes STCG)
	// =========================================================================
	// STCG is taxed as ordinary income, so include it here
	// Note: LTCG does NOT get the standard deduction - it stacks on top
	const totalOrdinaryIncome = ordinaryIncome + shortTermCapitalGains + taxableSS;
	const adjustedOrdinary = Math.max(0, totalOrdinaryIncome - preTaxDeductions);
	const taxableOrdinary = Math.max(0, adjustedOrdinary - params.standardDeduction);

	// =========================================================================
	// STEP 4: Calculate ordinary income tax (includes STCG)
	// =========================================================================
	let ordinaryTax = 0;
	for (let i = 0; i < params.brackets.length; i++) {
		const current = params.brackets[i];
		const next = params.brackets[i + 1];
		const upperLimit = next ? next.threshold : Infinity;

		if (taxableOrdinary > current.threshold) {
			const amountInBracket = Math.min(taxableOrdinary, upperLimit) - current.threshold;
			ordinaryTax += amountInBracket * current.rate;
		}
	}

	// =========================================================================
	// STEP 5: Calculate LTCG tax (stacks on top of ordinary income)
	// =========================================================================
	let ltcgTax = 0;
	if (longTermCapitalGains > 0 && params.capitalGainsBrackets) {
		const brackets = params.capitalGainsBrackets;
		let remainingGains = longTermCapitalGains;

		// LTCG stacks on top of taxable ordinary income for threshold purposes
		let incomeStack = taxableOrdinary;

		for (let i = 0; i < brackets.length && remainingGains > 0; i++) {
			const bracket = brackets[i];
			const nextBracket = brackets[i + 1];
			const upperLimit = nextBracket ? nextBracket.threshold : Infinity;

			// Skip if we're already past this bracket
			if (incomeStack >= upperLimit) continue;

			// How much room is left in this bracket?
			const bracketFloor = Math.max(incomeStack, bracket.threshold);
			const roomInBracket = upperLimit - bracketFloor;

			// How much of the gains fall in this bracket?
			const gainsInBracket = Math.min(remainingGains, roomInBracket);

			// Calculate tax for this portion
			ltcgTax += gainsInBracket * bracket.rate;

			// Move up the income stack and reduce remaining gains
			incomeStack += gainsInBracket;
			remainingGains -= gainsInBracket;
		}
	}

	// =========================================================================
	// STEP 6: Calculate NIIT (Net Investment Income Tax)
	// =========================================================================
	// NIIT is 3.8% on the LESSER of:
	// - Net investment income (STCG + LTCG + dividends - we don't track dividends separately)
	// - MAGI exceeding threshold ($200k single, $250k MFJ, $125k MFS)
	let niitTax = 0;
	const niitThreshold = NIIT_THRESHOLDS[filingStatus];
	const netInvestmentIncome = shortTermCapitalGains + longTermCapitalGains;

	if (netInvestmentIncome > 0) {
		// MAGI for NIIT purposes = AGI (roughly ordinaryIncome + STCG + LTCG + taxableSS - preTaxDeductions)
		// Note: MAGI has some adjustments but for simplicity we use AGI
		const magi = ordinaryIncome + shortTermCapitalGains + longTermCapitalGains + taxableSS - preTaxDeductions;
		const magiExcess = Math.max(0, magi - niitThreshold);

		if (magiExcess > 0) {
			// NIIT applies to the lesser of investment income or MAGI excess
			const niitBase = Math.min(netInvestmentIncome, magiExcess);
			niitTax = niitBase * NIIT_RATE;
		}
	}

	return {
		taxableSS,
		ordinaryTax,
		ltcgTax,
		niitTax,
		totalTax: ordinaryTax + ltcgTax + niitTax
	};
}

/**
 * Legacy tax calculation function for backwards compatibility.
 * Use calculateTotalFederalTax for new code that needs SS/LTCG/NIIT handling.
 *
 * @param grossIncome - Gross income before deductions
 * @param preTaxDeductions - 401k, HSA, etc.
 * @param params - Tax parameters
 * @returns Tax amount (ordinary income tax only, no SS/LTCG/NIIT)
 */
export function calculateTax(
	grossIncome: number,
	preTaxDeductions: number,
	params: TaxParameters
): number {
	// Use the new unified function with no SS, no STCG, no LTCG
	return calculateTotalFederalTax(
		grossIncome,
		0,  // no SS
		0,  // no STCG
		0,  // no LTCG
		preTaxDeductions,
		'Single',  // filing status doesn't matter when SS=0 and no investment income
		params
	).ordinaryTax;
}

/**
 * Calculate federal tax from income/expense objects using calculateTotalFederalTax.
 *
 * This function extracts all needed values from the income/expense arrays and
 * properly handles SS taxability, LTCG stacking, and NIIT through the unified
 * tax calculation.
 *
 * @param state - Tax state (filing status, overrides, deduction method)
 * @param incomes - Income objects (SS, pensions, work income)
 * @param expenses - Expense objects (for itemized deductions)
 * @param additionalOrdinaryIncome - Traditional withdrawals + Roth conversions + RMDs (default 0)
 * @param year - Tax year
 * @param assumptions - Assumptions for inflation adjustments
 * @param stcg - Short-term capital gains (default 0)
 * @param ltcg - Long-term capital gains (default 0)
 * @returns Federal tax amount
 */
export function calculateFederalTaxFromIncomes(
	state: TaxState,
	incomes: AnyIncome[],
	expenses: AnyExpense[],
	additionalOrdinaryIncome: number = 0,
	year: number,
	assumptions?: AssumptionsState,
	stcg: number = 0,
	ltcg: number = 0
): number {
	// DEBUG: Simple trace to see what years hit this function
	if (year === 2027) {
		console.log('>>> calculateFederalTaxFromIncomes CALLED for year 2027');
	}

	if (state.fedOverride !== null) {
		return state.fedOverride;
	}

	// Get gross income from income objects (excludes additional ordinary income)
	const incomeGross = getGrossIncome(incomes, year);

	// Calculate age from assumptions for auto-max 401k feature
	const age = assumptions?.milestones ? year - getBirthYear(assumptions.milestones) : undefined;

	// Get pre-tax deductions (401k, HSA, etc.)
	const incomePreTaxDeductions = getPreTaxExemptions(incomes, year, age);
	const expenseAboveLineDeductions = getYesDeductions(expenses, year);
	const totalPreTaxDeductions = incomePreTaxDeductions + expenseAboveLineDeductions;

	// DEBUG: Trace tax calculation for Year 2027
	if (year === 2027) {
		console.log('\n========== TAX TRACE: Year 2027 ==========');
		console.log('--- GROSS INCOME BREAKDOWN ---');
		incomes.forEach(inc => {
			const amt = inc.getProratedAnnual(inc.amount, year);
			if (amt > 0) {
				const reinvestFlag = 'isReinvested' in inc ? ` [reinvested=${(inc as any).isReinvested}]` : '';
				console.log(`  ${inc.name} (${inc.constructor.name}): $${amt.toFixed(2)}${reinvestFlag}`);
			}
		});
		console.log(`  TOTAL incomeGross: $${incomeGross.toFixed(2)}`);
		console.log(`  additionalOrdinaryIncome: $${additionalOrdinaryIncome.toFixed(2)}`);

		console.log('\n--- PRE-TAX DEDUCTIONS (from incomes) ---');
		incomes.filter(inc => inc.constructor.name === 'WorkIncome').forEach(inc => {
			const w = inc as any;
			const effective401k = age !== undefined ? w.getEffective401k(year, age) : { preTax: w.preTax401k, roth: w.roth401k };
			console.log(`  ${inc.name}:`);
			console.log(`    401k (pre-tax): $${inc.getProratedAnnual(effective401k.preTax, year).toFixed(2)}`);
			console.log(`    Insurance: $${inc.getProratedAnnual(w.insurance, year).toFixed(2)}`);
			console.log(`    HSA: $${inc.getProratedAnnual(w.hsaContribution || 0, year).toFixed(2)}`);
		});
		console.log(`  TOTAL incomePreTaxDeductions: $${incomePreTaxDeductions.toFixed(2)}`);

		console.log('\n--- ABOVE-LINE DEDUCTIONS (from expenses) ---');
		expenses.filter(exp => 'is_tax_deductible' in exp && (exp as any).is_tax_deductible === 'Yes').forEach(exp => {
			console.log(`  ${exp.name}: is_tax_deductible="${(exp as any).is_tax_deductible}", tax_deductible=$${(exp as any).tax_deductible}`);
		});
		console.log(`  TOTAL expenseAboveLineDeductions: $${expenseAboveLineDeductions.toFixed(2)}`);
		console.log(`  TOTAL totalPreTaxDeductions: $${totalPreTaxDeductions.toFixed(2)}`);
	}

	// Get Social Security benefits
	const totalSSBenefits = getSocialSecurityBenefits(incomes, year);

	// Calculate ordinary income (gross excluding SS, plus additional ordinary income)
	const nonSSGross = incomeGross - totalSSBenefits;
	const ordinaryIncome = nonSSGross + additionalOrdinaryIncome;

	// Get federal tax parameters
	const fedParams = getTaxParameters(
		year,
		state.filingStatus,
		"federal",
		undefined,
		assumptions
	);

	if (!fedParams) return 0;

	// Calculate state tax for SALT deduction
	const stateTax = additionalOrdinaryIncome > 0
		? calculateUnifiedStateTax(state, incomes, expenses, additionalOrdinaryIncome, year, assumptions)
		: calculateStateTax(state, incomes, expenses, year, assumptions);

	// Apply SALT cap
	const saltCap = getSALTCap(year, state.filingStatus);
	const cappedStateTax = Math.min(stateTax, saltCap);

	// Calculate itemized deductions
	const itemizedTotal = getItemizedDeductions(expenses, year) + cappedStateTax;

	// Helper to calculate tax with a specific deduction amount
	const calcTaxWithDeduction = (deductionAmount: number): number => {
		const paramsWithDeduction = {
			...fedParams,
			standardDeduction: deductionAmount
		};
		return calculateTotalFederalTax(
			ordinaryIncome,
			totalSSBenefits,
			stcg,
			ltcg,
			totalPreTaxDeductions,
			state.filingStatus,
			paramsWithDeduction
		).totalTax;
	};

	// DEBUG: Continue trace for Year 2027
	if (year === 2027) {
		const agi = ordinaryIncome - totalPreTaxDeductions;
		console.log('\n--- AGI CALCULATION ---');
		console.log(`  ordinaryIncome (nonSSGross + additional): $${ordinaryIncome.toFixed(2)}`);
		console.log(`  - totalPreTaxDeductions: $${totalPreTaxDeductions.toFixed(2)}`);
		console.log(`  = AGI: $${agi.toFixed(2)}`);

		console.log('\n--- DEDUCTION ---');
		console.log(`  deductionMethod: ${state.deductionMethod}`);
		console.log(`  standardDeduction: $${fedParams.standardDeduction.toFixed(2)}`);
		console.log(`  itemizedTotal: $${itemizedTotal.toFixed(2)}`);

		const taxableIncome = Math.max(0, agi - fedParams.standardDeduction);
		console.log(`  Taxable income (AGI - standard): $${taxableIncome.toFixed(2)}`);

		console.log('\n--- TAX BRACKETS (2026 frozen) ---');
		fedParams.brackets.forEach((b, i) => {
			const next = fedParams.brackets[i + 1];
			const upper = next ? next.threshold : 'Infinity';
			console.log(`  ${(b.rate * 100).toFixed(0)}%: $${b.threshold} - $${upper}`);
		});
	}

	// Handle Auto: pick whichever results in lower tax
	if (state.deductionMethod === "Auto") {
		const taxWithStandard = calcTaxWithDeduction(fedParams.standardDeduction);
		const taxWithItemized = calcTaxWithDeduction(itemizedTotal);
		const finalTax = Math.min(taxWithStandard, taxWithItemized);
		if (year === 2027) {
			console.log('\n--- FINAL TAX ---');
			console.log(`  taxWithStandard: $${taxWithStandard.toFixed(2)}`);
			console.log(`  taxWithItemized: $${taxWithItemized.toFixed(2)}`);
			console.log(`  FINAL (min): $${finalTax.toFixed(2)}`);
			console.log('==========================================\n');
		}
		return finalTax;
	}

	const appliedDeduction = state.deductionMethod === "Standard"
		? fedParams.standardDeduction
		: itemizedTotal;

	const finalTax = calcTaxWithDeduction(appliedDeduction);
	if (year === 2027) {
		console.log('\n--- FINAL TAX ---');
		console.log(`  appliedDeduction: $${appliedDeduction.toFixed(2)}`);
		console.log(`  FINAL TAX: $${finalTax.toFixed(2)}`);
		console.log('==========================================\n');
	}
	return finalTax;
}

export function calculateFicaTax(
	state: TaxState,
	incomes: AnyIncome[],
	year: number,
	assumptions?: AssumptionsState
): number {
	if (state.ficaOverride !== null) {
		return state.ficaOverride;
	}

	const earnedGross = getEarnedIncome(incomes, year);
	const ficaExemptions = getFicaExemptions(incomes, year);
	const fedParams = getTaxParameters(
		year,
		state.filingStatus,
		"federal",
		undefined,
		assumptions
	);

	if (!fedParams) return 0; // Or handle error appropriately

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
	year: number,
	assumptions?: AssumptionsState
) {
	if (state.stateOverride !== null) {
		return state.stateOverride;
	}

	const annualGross = getGrossIncome(incomes, year);
	// Calculate age from assumptions for auto-max 401k feature
	const age = assumptions?.milestones ? year - getBirthYear(assumptions.milestones) : undefined;
	const incomePreTaxDeductions = getPreTaxExemptions(incomes, year, age);
	const expenseAboveLineDeductions = getYesDeductions(expenses, year);
	const totalPreTaxDeductions =
		incomePreTaxDeductions + expenseAboveLineDeductions;

	const itemizedTotal = getItemizedDeductions(expenses, year);
	const stateParams = getTaxParameters(
		year,
		state.filingStatus,
		"state",
		state.stateResidency,
		assumptions
	);

	if (!stateParams) return 0;

	// Handle Social Security benefits for state tax
	// Use data-driven socialSecurityTreatment field, defaulting to 'exempt'
	const ssTreatment = stateParams.socialSecurityTreatment ?? 'exempt';
	const totalSSBenefits = getSocialSecurityBenefits(incomes, year);
	let adjustedGrossForState = annualGross;

	if (totalSSBenefits > 0) {
		if (ssTreatment === 'taxable') {
			// States that tax SS: use only the taxable portion (like federal)
			const nonSSGross = annualGross - totalSSBenefits;
			const agiExcludingSS = nonSSGross - totalPreTaxDeductions;
			// TODO: Verify all income types are included (LTCG, STCG, dividends, etc.)
			const taxableSSBenefits = getTaxableSocialSecurityBenefits(
				totalSSBenefits,
				agiExcludingSS,
				0, // taxExemptInterest - not currently tracked
				state.filingStatus
			);
			// Subtract full SS, add back only taxable portion
			adjustedGrossForState = annualGross - totalSSBenefits + taxableSSBenefits;
		} else if (ssTreatment === 'income-based') {
			// TODO: Implement income-based SS exemption for states like CO, CT, etc.
			// For now, treat as exempt (conservative approach)
			adjustedGrossForState = annualGross - totalSSBenefits;
		} else {
			// 'exempt' - States that don't tax SS: exclude SS benefits entirely
			adjustedGrossForState = annualGross - totalSSBenefits;
		}
	}

	// Apply senior deduction if applicable
	// For per-person deductions (like Virginia), MFJ gets double (assumes both spouses same age)
	let seniorDeductionAmount = 0;
	if (stateParams.seniorDeduction && age !== undefined) {
		const seniorAge = stateParams.seniorAge ?? 65;
		if (age >= seniorAge) {
			seniorDeductionAmount = stateParams.seniorDeduction;
			// Double for MFJ if this is a per-person deduction
			if (stateParams.seniorDeductionPerPerson && state.filingStatus === 'Married Filing Jointly') {
				seniorDeductionAmount *= 2;
			}
		}
	}

	const stateStandardDeduction = (stateParams.standardDeduction || 0) + seniorDeductionAmount;

	// Handle Auto: pick whichever results in lower tax
	if (state.deductionMethod === "Auto") {
		const taxWithStandard = calculateTax(adjustedGrossForState, totalPreTaxDeductions, {
			...stateParams,
			standardDeduction: stateStandardDeduction,
		});
		const taxWithItemized = calculateTax(adjustedGrossForState, totalPreTaxDeductions, {
			...stateParams,
			standardDeduction: itemizedTotal,
		});
		return Math.min(taxWithStandard, taxWithItemized);
	}

	const stateAppliedMainDeduction =
		state.deductionMethod === "Standard"
			? stateStandardDeduction
			: itemizedTotal;

	return calculateTax(adjustedGrossForState, totalPreTaxDeductions, {
		...stateParams,
		standardDeduction: stateAppliedMainDeduction,
	});
}

/**
 * Calculate state tax including additional ordinary income from withdrawals.
 *
 * @param state - Tax state
 * @param incomes - Original income objects
 * @param expenses - Expenses (for deductions)
 * @param additionalOrdinaryIncome - Traditional withdrawals + Roth conversions + RMDs
 * @param year - Tax year
 * @param assumptions - Assumptions for inflation adjustments
 * @returns State tax including all income sources
 */
export function calculateUnifiedStateTax(
	state: TaxState,
	incomes: AnyIncome[],
	expenses: AnyExpense[],
	additionalOrdinaryIncome: number,
	year: number,
	assumptions?: AssumptionsState
): number {
	if (state.stateOverride !== null) {
		return state.stateOverride;
	}

	const stateParams = getTaxParameters(
		year,
		state.filingStatus,
		"state",
		state.stateResidency,
		assumptions
	);

	if (!stateParams) return 0; // No state income tax

	// Get gross income from incomes + additional ordinary income
	const incomeGross = getGrossIncome(incomes, year);
	const annualGross = incomeGross + additionalOrdinaryIncome;

	// Calculate age from assumptions
	const age = assumptions?.milestones ? year - getBirthYear(assumptions.milestones) : undefined;
	const incomePreTaxDeductions = getPreTaxExemptions(incomes, year, age);
	const expenseAboveLineDeductions = getYesDeductions(expenses, year);
	const totalPreTaxDeductions = incomePreTaxDeductions + expenseAboveLineDeductions;

	// Handle Social Security benefits for state tax
	// Use data-driven socialSecurityTreatment field, defaulting to 'exempt'
	const ssTreatment = stateParams.socialSecurityTreatment ?? 'exempt';
	const totalSSBenefits = getSocialSecurityBenefits(incomes, year);
	let adjustedGross = annualGross;

	if (totalSSBenefits > 0) {
		if (ssTreatment === 'taxable') {
			// States that tax SS: use only the taxable portion (like federal)
			const nonSSGross = annualGross - totalSSBenefits;
			const agiExcludingSS = nonSSGross - totalPreTaxDeductions;
			// TODO: Verify all income types are included (LTCG, STCG, dividends, etc.)
			const taxableSSBenefits = getTaxableSocialSecurityBenefits(
				totalSSBenefits,
				agiExcludingSS,
				0, // taxExemptInterest - not currently tracked
				state.filingStatus
			);
			// Subtract full SS, add back only taxable portion
			adjustedGross = annualGross - totalSSBenefits + taxableSSBenefits;
		} else if (ssTreatment === 'income-based') {
			// TODO: Implement income-based SS exemption for states like CO, CT, etc.
			// For now, treat as exempt (conservative approach)
			adjustedGross = annualGross - totalSSBenefits;
		} else {
			// 'exempt' - States that don't tax SS: exclude SS benefits entirely
			adjustedGross = annualGross - totalSSBenefits;
		}
	}

	// Apply senior deduction if applicable
	// For per-person deductions (like Virginia), MFJ gets double (assumes both spouses same age)
	let seniorDeductionAmount = 0;
	if (stateParams.seniorDeduction && age !== undefined) {
		const seniorAge = stateParams.seniorAge ?? 65;
		if (age >= seniorAge) {
			seniorDeductionAmount = stateParams.seniorDeduction;
			// Double for MFJ if this is a per-person deduction
			if (stateParams.seniorDeductionPerPerson && state.filingStatus === 'Married Filing Jointly') {
				seniorDeductionAmount *= 2;
			}
		}
	}

	const itemizedTotal = getItemizedDeductions(expenses, year);
	const stateStandardDeduction = (stateParams.standardDeduction || 0) + seniorDeductionAmount;

	// Handle Auto: pick whichever results in lower tax
	if (state.deductionMethod === "Auto") {
		const taxWithStandard = calculateTax(adjustedGross, totalPreTaxDeductions, {
			...stateParams,
			standardDeduction: stateStandardDeduction,
		});
		const taxWithItemized = calculateTax(adjustedGross, totalPreTaxDeductions, {
			...stateParams,
			standardDeduction: itemizedTotal + seniorDeductionAmount,
		});
		return Math.min(taxWithStandard, taxWithItemized);
	}

	const stateAppliedMainDeduction =
		state.deductionMethod === "Standard" ? stateStandardDeduction : itemizedTotal + seniorDeductionAmount;

	return calculateTax(adjustedGross, totalPreTaxDeductions, {
		...stateParams,
		standardDeduction: stateAppliedMainDeduction,
	});
}

/**
 * Calculate capital gains tax on long-term gains.
 * Capital gains are taxed based on your total taxable income bracket.
 * The gains "stack on top" of ordinary income to determine the applicable rate.
 *
 * @param gains - Amount of long-term capital gains
 * @param ordinaryTaxableIncome - Taxable income from ordinary sources (after deductions)
 * @param taxState - Filing status and other tax state
 * @param year - Tax year
 * @param assumptions - Assumptions for inflation adjustments
 * @returns The tax owed on the capital gains
 */
export function calculateCapitalGainsTax(
    gains: number,
    ordinaryTaxableIncome: number,
    taxState: TaxState,
    year: number,
    assumptions?: AssumptionsState
): number {
    if (gains <= 0) return 0;

    const fedParams = getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
    if (!fedParams || !fedParams.capitalGainsBrackets) {
        // Fallback to flat 15% if no brackets available
        return gains * 0.15;
    }

    const brackets = fedParams.capitalGainsBrackets;
    let remainingGains = gains;
    let totalTax = 0;

    // Capital gains "stack on top" of ordinary income
    // So if ordinary income is $40k and gains are $20k, the first portion
    // of gains may be in a lower bracket, and the rest in a higher bracket
    let incomeLevel = Math.max(0, ordinaryTaxableIncome);

    for (let i = 0; i < brackets.length && remainingGains > 0; i++) {
        const currentBracket = brackets[i];
        const nextBracket = brackets[i + 1];
        const upperLimit = nextBracket ? nextBracket.threshold : Infinity;

        // Skip if we're already past this bracket
        if (incomeLevel >= upperLimit) continue;

        // How much room is left in this bracket?
        const roomInBracket = upperLimit - incomeLevel;

        // How much of the gains fall in this bracket?
        const gainsInBracket = Math.min(remainingGains, roomInBracket);

        // Calculate tax for this portion
        totalTax += gainsInBracket * currentBracket.rate;

        // Move up the income level and reduce remaining gains
        incomeLevel += gainsInBracket;
        remainingGains -= gainsInBracket;
    }

    return totalTax;
}

/**
 * Calculates Gross Withdrawal needed to net 'netNeeded'.
 * Now accepts INCOME (Gross - PreTax) and DEDUCTION amounts separately
 * to correctly handle the 0% tax zone (unused standard deduction).
 */
export function calculateGrossWithdrawal(
    netNeeded: number,
    currentFedIncome: number,      // Gross - PreTax401k/Ins (AGI-ish)
    currentFedDeduction: number,   // Standard Deduction or Itemized Total
    currentStateIncome: number,
    currentStateDeduction: number,
    taxState: TaxState,
    year: number,
    assumptions?: AssumptionsState,
    penaltyRate: number = 0        // Early withdrawal penalty rate (e.g., 0.10 for 10%)
): { grossWithdrawn: number; totalTax: number; penalty: number } {

    // 1. Get Parameters (for Brackets/Rates only)
    const fedParams = getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
    const stateParams = getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

    if (!fedParams || !stateParams) {
        const effectiveNetRate = (1 - WITHDRAWAL_SOLVER_FALLBACK_TAX_RATE) - penaltyRate;
        const fallbackGross = netNeeded / effectiveNetRate;
        const fallbackPenalty = fallbackGross * penaltyRate;
        return { grossWithdrawn: fallbackGross, totalTax: fallbackGross - netNeeded - fallbackPenalty, penalty: fallbackPenalty };
    }

    // 2. Forward Calculator
    const calculateNetFromGross = (grossGuess: number): number => {
        // We construct synthetic params using the EXACT deduction passed in.
        // This ensures we respect the Simulation's view of "Itemized vs Standard"
        
        // A. State Tax
        const stateParamsApplied = { ...stateParams, standardDeduction: currentStateDeduction };
        // We use preTaxDeductions=0 because 'currentStateIncome' already has them subtracted
        const stateTaxBase = calculateTax(currentStateIncome, 0, stateParamsApplied);
        const stateTaxNew = calculateTax(currentStateIncome + grossGuess, 0, stateParamsApplied);
        const marginalStateTax = stateTaxNew - stateTaxBase;

        // B. SALT Deductibility in gross withdrawal calculation
        // Note: The basic $10k SALT cap is enforced in calculateFederalTaxFromIncomes().
        // For this gross withdrawal solver, we intentionally ignore marginal SALT deductibility
        // because tracking remaining SALT headroom adds complexity and rarely impacts results
        // significantly. This conservative approach avoids under-withholding scenarios.

        // C. Federal Tax
        // Note: If we were deducting state tax, we'd subtract it from fedIncome here.
        const fedParamsApplied = { ...fedParams, standardDeduction: currentFedDeduction };
        const fedTaxBase = calculateTax(currentFedIncome, 0, fedParamsApplied);
        const fedTaxNew = calculateTax(currentFedIncome + grossGuess, 0, fedParamsApplied);
        const marginalFedTax = fedTaxNew - fedTaxBase;

        // D. Early withdrawal penalty (applied to gross)
        const penaltyAmount = grossGuess * penaltyRate;

        return grossGuess - marginalStateTax - marginalFedTax - penaltyAmount;
    };

    // 3. Binary Search
    let low = netNeeded;
    let high = netNeeded * 4; // Safe upper bound
    let grossSolution = high;

    for (let i = 0; i < WITHDRAWAL_SOLVER_MAX_ITERATIONS; i++) {
        const mid = (low + high) / 2;
        const netResult = calculateNetFromGross(mid);

        if (Math.abs(netResult - netNeeded) <= WITHDRAWAL_SOLVER_TOLERANCE) {
            grossSolution = mid;
            break;
        }

        if (netResult < netNeeded) {
            low = mid;
        } else {
            high = mid;
            grossSolution = mid;
        }
    }

    const finalPenalty = grossSolution * penaltyRate;
    return {
        grossWithdrawn: grossSolution,
        totalTax: grossSolution - netNeeded - finalPenalty,
        penalty: finalPenalty
    };
}

/**
 * Result of marginal tax rate calculation
 */
export interface MarginalRateResult {
    rate: number;           // Decimal rate (e.g., 0.22 for 22%)
    bracketStart: number;   // Taxable income where this bracket starts
    bracketEnd: number;     // Taxable income where this bracket ends (Infinity for top)
    headroom: number;       // $ remaining until next bracket
}

/**
 * Get the marginal tax rate for a given taxable income.
 *
 * @param taxableIncome - Income after deductions (not gross income)
 * @param params - Tax parameters containing brackets
 * @returns Marginal rate info including headroom to next bracket
 */
export function getMarginalTaxRate(
    taxableIncome: number,
    params: TaxParameters
): MarginalRateResult {
    // Handle zero or negative income
    if (taxableIncome <= 0) {
        const first = params.brackets[0];
        const second = params.brackets[1];
        return {
            rate: first.rate,
            bracketStart: first.threshold,
            bracketEnd: second ? second.threshold : Infinity,
            headroom: second ? second.threshold : Infinity
        };
    }

    // Find the bracket containing this income
    for (let i = 0; i < params.brackets.length; i++) {
        const current = params.brackets[i];
        const next = params.brackets[i + 1];
        const upperLimit = next ? next.threshold : Infinity;

        if (taxableIncome >= current.threshold && taxableIncome < upperLimit) {
            return {
                rate: current.rate,
                bracketStart: current.threshold,
                bracketEnd: upperLimit,
                headroom: upperLimit === Infinity ? Infinity : upperLimit - taxableIncome
            };
        }
    }

    // Fallback to top bracket
    const top = params.brackets[params.brackets.length - 1];
    return {
        rate: top.rate,
        bracketStart: top.threshold,
        bracketEnd: Infinity,
        headroom: Infinity
    };
}

/**
 * Get combined marginal tax rate (federal + state + FICA if applicable).
 *
 * @param grossIncome - Gross income before deductions
 * @param preTaxDeductions - 401k, HSA, etc.
 * @param taxState - Tax configuration
 * @param year - Tax year
 * @param assumptions - Assumptions for inflation adjustment
 * @param includesFICA - Whether to include FICA taxes (true for earned income)
 * @returns Combined marginal rate breakdown
 */
export function getCombinedMarginalRate(
    grossIncome: number,
    preTaxDeductions: number,
    taxState: TaxState,
    year: number,
    assumptions: AssumptionsState,
    includesFICA: boolean = true
): {
    federal: number;
    state: number;
    fica: number;
    combined: number;
    federalHeadroom: number;
} {
    const fedParams = getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
    const stateParams = getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

    const adjustedGross = Math.max(0, grossIncome - preTaxDeductions);
    const fedStdDed = fedParams?.standardDeduction || 14600;
    const stateStdDed = stateParams?.standardDeduction || 0;

    const fedTaxableIncome = Math.max(0, adjustedGross - fedStdDed);
    const stateTaxableIncome = Math.max(0, adjustedGross - stateStdDed);

    const fedMarginal = fedParams ? getMarginalTaxRate(fedTaxableIncome, fedParams) : { rate: 0, headroom: Infinity };
    const stateMarginal = stateParams ? getMarginalTaxRate(stateTaxableIncome, stateParams) : { rate: 0, headroom: Infinity };

    // FICA: 6.2% SS (up to wage base) + 1.45% Medicare
    let ficaRate = 0;
    if (includesFICA && fedParams) {
        const ssWageBase = fedParams.socialSecurityWageBase || 168600;
        if (grossIncome < ssWageBase) {
            ficaRate = fedParams.socialSecurityTaxRate + fedParams.medicareTaxRate;
        } else {
            // Only Medicare above wage base
            ficaRate = fedParams.medicareTaxRate;
        }
    }

    return {
        federal: fedMarginal.rate,
        state: stateMarginal.rate,
        fica: ficaRate,
        combined: fedMarginal.rate + stateMarginal.rate + ficaRate,
        federalHeadroom: fedMarginal.headroom
    };
}

/**
 * Calculate ESPP disposition tax breakdown.
 *
 * ESPP shares have special tax treatment based on holding periods:
 *
 * **Qualifying Disposition** (held 2 years from grant AND 1 year from purchase):
 * - Ordinary income = lesser of: (1) discount at grant price, or (2) actual gain
 * - Capital gains = remainder (long-term)
 *
 * **Disqualifying Disposition** (sold before meeting both holding periods):
 * - Ordinary income = FMV at purchase - purchase price (the "bargain element")
 * - Capital gains = sale price - FMV at purchase (can be short or long term)
 *
 * TODO: This function is exported and tested but not used in the app.
 * Either wire it up to the ESPP account UI (e.g., lot sale preview) or delete it.
 *
 * @param sharesToSell - Number of shares being sold
 * @param salePrice - Sale price per share
 * @param purchasePrice - Original purchase price per share
 * @param fmvAtGrant - Fair market value at grant date
 * @param fmvAtPurchase - Fair market value at purchase date
 * @param isQualifying - Whether this is a qualifying disposition
 * @param isLongTermCG - Whether capital gains portion qualifies as long-term (held >1 year from purchase)
 * @returns Tax breakdown with ordinary income and capital gains amounts
 */
export function calculateESPPDispositionTax(
    sharesToSell: number,
    salePrice: number,
    purchasePrice: number,
    fmvAtGrant: number,
    fmvAtPurchase: number,
    isQualifying: boolean,
    isLongTermCG: boolean
): {
    ordinaryIncome: number;
    shortTermCapitalGains: number;
    longTermCapitalGains: number;
    totalTaxableGain: number;
} {
    const totalSaleProceeds = sharesToSell * salePrice;
    const totalCostBasis = sharesToSell * purchasePrice;
    const totalGain = totalSaleProceeds - totalCostBasis;

    let ordinaryIncome = 0;
    let shortTermCapitalGains = 0;
    let longTermCapitalGains = 0;

    if (totalGain <= 0) {
        // Loss scenario - all goes to capital gains (loss)
        if (isLongTermCG) {
            longTermCapitalGains = totalGain;
        } else {
            shortTermCapitalGains = totalGain;
        }
    } else if (isQualifying) {
        // Qualifying disposition
        // Ordinary income = lesser of grant discount or actual gain
        const grantDiscount = fmvAtGrant * 0.15 * sharesToSell; // Typical 15% discount
        ordinaryIncome = Math.min(grantDiscount, totalGain);
        longTermCapitalGains = totalGain - ordinaryIncome; // Always long-term for qualifying
    } else {
        // Disqualifying disposition
        // Ordinary income = bargain element (discount at purchase)
        const bargainElement = (fmvAtPurchase - purchasePrice) * sharesToSell;
        ordinaryIncome = Math.max(0, bargainElement);

        // Capital gains = gain beyond the bargain element
        const capitalGain = totalGain - bargainElement;
        if (isLongTermCG) {
            longTermCapitalGains = capitalGain;
        } else {
            shortTermCapitalGains = capitalGain;
        }
    }

    return {
        ordinaryIncome,
        shortTermCapitalGains,
        longTermCapitalGains,
        totalTaxableGain: ordinaryIncome + shortTermCapitalGains + longTermCapitalGains
    };
}