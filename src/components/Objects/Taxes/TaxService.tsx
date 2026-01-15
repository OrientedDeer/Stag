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
} from "../../Objects/Assumptions/AssumptionsContext";

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

	if (year < 2018) {
		// Pre-TCJA: No cap (return a high number)
		return Infinity;
	}

	if (year >= 2018 && year <= 2024) {
		// TCJA cap
		return isMFS ? 5000 : 10000;
	}

	if (year >= 2025 && year <= 2029) {
		// OBBBA raised cap with 1% annual increase starting 2026
		const baseCapJoint = 40000;
		const baseCapMFS = 20000;
		const yearsOfIncrease = Math.max(0, year - 2025);
		const inflationFactor = Math.pow(1.01, yearsOfIncrease);
		const cap = isMFS ? baseCapMFS : baseCapJoint;
		return Math.round(cap * inflationFactor);
	}

	// 2030+: Reverts to original TCJA cap
	return isMFS ? 5000 : 10000;
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
		return acc + inc.getProratedAnnual(inc.amount, year);
	}, 0);
}

export function getPreTaxExemptions(incomes: AnyIncome[], year: number): number {
	return incomes
		.filter((inc) => inc instanceof WorkIncome)
		.reduce((acc, inc) => {
			return (
				acc +
				inc.getProratedAnnual(inc.preTax401k, year) +
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
 * Combined Income = AGI + Nontaxable Interest + 50% of SS Benefits
 *
 * Thresholds (2024):
 * Single:
 *   < $25,000: 0% taxable
 *   $25,000-$34,000: Up to 50% taxable
 *   > $34,000: Up to 85% taxable
 *
 * Married Filing Jointly:
 *   < $32,000: 0% taxable
 *   $32,000-$44,000: Up to 50% taxable
 *   > $44,000: Up to 85% taxable
 */
export function getTaxableSocialSecurityBenefits(
	totalSSBenefits: number,
	agi: number,
	filingStatus: FilingStatus
): number {
	if (totalSSBenefits === 0) return 0;

	// Combined income = AGI + Nontaxable Interest + 50% of SS Benefits
	// For simplicity, we're not tracking nontaxable interest separately
	const combinedIncome = agi + (totalSSBenefits * 0.5);

	// Thresholds based on filing status
	// Single and Married Filing Separately use lower thresholds
	// Married Filing Jointly uses higher thresholds
	const thresholds = filingStatus === 'Single' || filingStatus === 'Married Filing Separately'
		? { first: 25000, second: 34000 }
		: { first: 32000, second: 44000 }; // Married Filing Jointly

	// No SS benefits are taxable
	if (combinedIncome < thresholds.first) {
		return 0;
	}

	// Up to 50% of SS benefits are taxable
	if (combinedIncome < thresholds.second) {
		const excessAboveFirst = combinedIncome - thresholds.first;
		const taxable50Percent = Math.min(excessAboveFirst * 0.5, totalSSBenefits * 0.5);
		return Math.min(taxable50Percent, totalSSBenefits);
	}

	// Up to 85% of SS benefits are taxable
	const excessAboveSecond = combinedIncome - thresholds.second;
	const tier1Amount = (thresholds.second - thresholds.first) * 0.5; // 50% of tier 1
	const tier2Amount = excessAboveSecond * 0.85; // 85% of tier 2
	const totalTaxable = tier1Amount + tier2Amount;

	// Cap at 85% of total benefits
	return Math.min(totalTaxable, totalSSBenefits * 0.85);
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
	const incomePreTaxDeductions = getPreTaxExemptions(incomes, year);
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

	const stateStandardDeduction = stateParams.standardDeduction || 0;

	// Handle Auto: pick whichever results in lower tax
	if (state.deductionMethod === "Auto") {
		const taxWithStandard = calculateTax(annualGross, totalPreTaxDeductions, {
			...stateParams,
			standardDeduction: stateStandardDeduction,
		});
		const taxWithItemized = calculateTax(annualGross, totalPreTaxDeductions, {
			...stateParams,
			standardDeduction: itemizedTotal,
		});
		return Math.min(taxWithStandard, taxWithItemized);
	}

	const stateAppliedMainDeduction =
		state.deductionMethod === "Standard"
			? stateStandardDeduction
			: itemizedTotal;

	return calculateTax(annualGross, totalPreTaxDeductions, {
		...stateParams,
		standardDeduction: stateAppliedMainDeduction,
	});
}

export function calculateFederalTax(
	state: TaxState,
	incomes: AnyIncome[],
	expenses: AnyExpense[],
	year: number,
	assumptions?: AssumptionsState
) {
	if (state.fedOverride !== null) {
		return state.fedOverride;
	}

	const annualGross = getGrossIncome(incomes, year);
	const incomePreTaxDeductions = getPreTaxExemptions(incomes, year);
	const stateTax = calculateStateTax(
		state,
		incomes,
		expenses,
		year,
		assumptions
	);
	const expenseAboveLineDeductions = getYesDeductions(expenses, year);
	const totalPreTaxDeductions =
		incomePreTaxDeductions + expenseAboveLineDeductions;

	// Get Social Security benefits first
	const totalSSBenefits = getSocialSecurityBenefits(incomes, year);

	// Calculate AGI EXCLUDING Social Security for taxability calculation
	// The IRS formula for "Combined Income" uses AGI before adding SS benefits
	const nonSSGross = annualGross - totalSSBenefits;
	const agiExcludingSS = nonSSGross - totalPreTaxDeductions;

	// Calculate taxable portion of SS benefits
	const taxableSSBenefits = getTaxableSocialSecurityBenefits(
		totalSSBenefits,
		agiExcludingSS,  // Pass AGI WITHOUT SS benefits
		state.filingStatus
	);

	// Adjust gross income for SS taxation
	// annualGross includes the full SS benefits, but only the taxable portion should be included
	// So we subtract the full amount and add back only the taxable portion
	const adjustedGross = annualGross - totalSSBenefits + taxableSSBenefits;

	// Apply SALT cap to state tax deduction
	// Cap varies by year: $10k (2018-2024), $40k (2025-2029), $10k (2030+)
	const saltCap = getSALTCap(year, state.filingStatus);
	const cappedStateTax = Math.min(stateTax, saltCap);
	const itemizedTotal = getItemizedDeductions(expenses, year) + cappedStateTax;
	const fedParams = getTaxParameters(
		year,
		state.filingStatus,
		"federal",
		undefined,
		assumptions
	);

	if (!fedParams) return 0;

	const fedStandardDeduction = fedParams.standardDeduction;

	// Handle Auto: pick whichever results in lower tax
	if (state.deductionMethod === "Auto") {
		const taxWithStandard = calculateTax(adjustedGross, totalPreTaxDeductions, {
			...fedParams,
			standardDeduction: fedStandardDeduction,
		});
		const taxWithItemized = calculateTax(adjustedGross, totalPreTaxDeductions, {
			...fedParams,
			standardDeduction: itemizedTotal,
		});
		return Math.min(taxWithStandard, taxWithItemized);
	}

	const fedAppliedMainDeduction =
		state.deductionMethod === "Standard" ? fedStandardDeduction : itemizedTotal;

	return calculateTax(adjustedGross, totalPreTaxDeductions, {
		...fedParams,
		standardDeduction: fedAppliedMainDeduction,
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
        const fallbackGross = netNeeded / (0.7 - penaltyRate);
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
        // Note: The basic $10k SALT cap is enforced in calculateFederalTax().
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

    for (let i = 0; i < 50; i++) {
        const mid = (low + high) / 2;
        const netResult = calculateNetFromGross(mid);

        if (Math.abs(netResult - netNeeded) <= 0.005) {
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