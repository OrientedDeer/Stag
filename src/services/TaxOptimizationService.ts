/**
 * Tax Optimization Service
 *
 * Analyzes tax situation and provides recommendations for reducing
 * lifetime tax burden through contributions, conversions, and timing.
 */

import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { AssumptionsState, getRetirementAge, getLifeExpectancy, getBirthYear } from '../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../components/Objects/Taxes/TaxContext';
import { AnyIncome, WorkIncome } from '../components/Objects/Income/models';
import { InvestedAccount } from '../components/Objects/Accounts/models';
import * as TaxService from '../components/Objects/Taxes/TaxService';
import {
    get401kLimit,
    getHSALimit,
    calculateContributionTaxSavings
} from '../data/ContributionLimits';

// ============================================================================
// Constants
// ============================================================================

/** Minimum contribution gap to recommend 401k increase */
const MIN_401K_GAP_FOR_RECOMMENDATION = 1000;

/** Minimum tax savings to recommend 401k increase */
const MIN_401K_SAVINGS_FOR_RECOMMENDATION = 100;

/** Minimum contribution gap to recommend HSA increase */
const MIN_HSA_GAP_FOR_RECOMMENDATION = 500;

/** Minimum tax savings to recommend HSA increase */
const MIN_HSA_SAVINGS_FOR_RECOMMENDATION = 50;

/** Bracket headroom threshold for bracket management recommendation */
const BRACKET_HEADROOM_THRESHOLD = 10000;

/** Minimum conversion amount to consider for Roth recommendation */
const MIN_ROTH_CONVERSION_AMOUNT = 5000;

/** Minimum target rate for Roth conversions (always fill at least to 22% bracket) */
const MIN_CONVERSION_TARGET_RATE = 0.22;

/** Fallback retirement tax rate when simulation data unavailable */
const FALLBACK_RETIREMENT_TAX_RATE = 0.22;

/** Fallback annual growth rate for investment projections */
const FALLBACK_GROWTH_RATE = 0.07;

/** Impact thresholds for 401k recommendations */
const IMPACT_HIGH_401K_THRESHOLD = 2000;
const IMPACT_MEDIUM_401K_THRESHOLD = 500;

/** Impact thresholds for HSA recommendations */
const IMPACT_HIGH_HSA_THRESHOLD = 1000;
const IMPACT_MEDIUM_HSA_THRESHOLD = 300;

// ============================================================================
// Types
// ============================================================================

export interface MarginalRateBreakdown {
    federal: number;
    state: number;
    fica: number;
    combined: number;
}

export interface TaxAnalysis {
    year: number;
    age: number;
    grossIncome: number;
    taxableIncome: number;
    federalTax: number;
    stateTax: number;
    ficaTax: number;
    totalTax: number;
    effectiveRate: number;
    marginalRate: MarginalRateBreakdown;
    federalBracket: number;        // Current federal bracket %
    federalHeadroom: number;       // $ until next federal bracket
    preTaxContributions: {
        current401k: number;
        limit401k: number;
        currentHSA: number;
        limitHSA: number;
    };
}

export type RecommendationCategory = 'contribution' | 'conversion' | 'timing' | 'withdrawal';
export type RecommendationImpact = 'high' | 'medium' | 'low';

export interface TaxRecommendation {
    id: string;
    title: string;
    description: string;
    category: RecommendationCategory;
    impact: RecommendationImpact;
    estimatedAnnualSavings: number;
    actionItems: string[];
}

export interface RothConversionOpportunity {
    year: number;
    age: number;
    marginalRate: number;
    optimalConversionAmount: number;  // Amount to fill bracket
    taxCost: number;                  // Immediate tax owed
    bracketAfter: number;             // Bracket % after conversion
}

export interface RothConversionResult {
    conversionAmount: number;
    immediateTaxCost: number;
    newFederalBracket: number;
    headroomRemaining: number;

    // Explicit comparison of the two paths
    traditional: {
        startingAmount: number;           // Original amount in traditional
        valueAtRetirement: number;        // Grown value at retirement
        taxAtWithdrawal: number;          // Tax paid when withdrawing
        afterTaxValue: number;            // What you actually get to spend
    };
    roth: {
        amountAfterConversionTax: number; // Net wealth effect (conversion minus tax paid)
        valueAtRetirement: number;        // Grown value at retirement (tax-free)
        taxAtWithdrawal: number;          // $0 - Roth is tax-free
        afterTaxValue: number;            // What you actually get to spend
    };

    // Summary
    benefit: number;                      // Roth after-tax - Traditional after-tax

    // Data used for calculation (for transparency)
    dataUsed: {
        currentTaxRate: number;           // Tax rate paid on conversion
        retirementTaxRate: number;        // Median effective rate in retirement
        annualGrowthRate: number;         // Growth rate from assumptions
        yearsUntilRetirement: number;
    };
}

export interface RothAnalysis {
    mode: 'contribution' | 'conversion';
    amount: number;
    currentEffectiveRate: number;
    retirementMarginalRate: number;
    breakEvenRate: number;
    growthYears: number;
    growthRate: number;

    traditional: {
        startingAmount: number;
        valueAtWithdrawal: number;
        taxAtWithdrawal: number;
        afterTaxValue: number;
    };
    roth: {
        amountAfterTax: number;
        valueAtWithdrawal: number;
        afterTaxValue: number;
    };

    benefit: number;
    verdict: 'roth' | 'traditional' | 'even';
    reason: string;

    optimalAmount: number | null;  // Amount that maximizes Roth benefit, null if Roth never wins
    optimalVerdict: 'all-roth' | 'all-traditional' | 'optimal';
}

export interface TaxProjection {
    year: number;
    age: number;
    grossIncome: number;
    effectiveRate: number;
    marginalRate: number;
    federalBracket: number;
    isRetired: boolean;
    isLowTaxYear: boolean;  // Good for Roth conversions
}

// ============================================================================
// Main Analysis Functions
// ============================================================================

/**
 * Analyze current tax situation for a specific year in the simulation.
 */
export function analyzeTaxSituation(
    simulationYear: SimulationYear,
    assumptions: AssumptionsState,
    taxState: TaxState
): TaxAnalysis {
    const { year, incomes } = simulationYear;
    const age = year - getBirthYear(assumptions.milestones);

    // Get gross income and deductions
    const grossIncome = TaxService.getGrossIncome(incomes, year);
    const preTaxDeductions = TaxService.getPreTaxExemptions(incomes, year, age);

    // Get tax amounts from simulation (already calculated)
    const federalTax = simulationYear.taxDetails.fed;
    const stateTax = simulationYear.taxDetails.state;
    const ficaTax = simulationYear.taxDetails.fica;
    const totalTax = federalTax + stateTax + ficaTax;

    // Calculate effective rate
    const effectiveRate = grossIncome > 0 ? totalTax / grossIncome : 0;

    // Get marginal rate breakdown
    const marginal = TaxService.getCombinedMarginalRate(
        grossIncome,
        preTaxDeductions,
        taxState,
        year,
        assumptions,
        true // Include FICA for earned income
    );

    // Get contribution info
    const current401k = get401kContributions(incomes, year, age);
    const currentHSA = getHSAContributions(incomes, year);

    return {
        year,
        age,
        grossIncome,
        taxableIncome: Math.max(0, grossIncome - preTaxDeductions),
        federalTax,
        stateTax,
        ficaTax,
        totalTax,
        effectiveRate,
        marginalRate: {
            federal: marginal.federal,
            state: marginal.state,
            fica: marginal.fica,
            combined: marginal.combined
        },
        federalBracket: marginal.federal * 100, // Convert to percentage
        federalHeadroom: marginal.federalHeadroom,
        preTaxContributions: {
            current401k,
            limit401k: get401kLimit(year, age),
            currentHSA,
            limitHSA: getHSALimit(year, age, 'individual') // Default to individual
        }
    };
}

/**
 * Generate tax optimization recommendations based on current situation.
 */
export function generateRecommendations(
    analysis: TaxAnalysis,
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
    hasTraditionalBalance: boolean = false
): TaxRecommendation[] {
    const recommendations: TaxRecommendation[] = [];

    // 1. 401k Optimization
    const rec401k = generate401kRecommendation(analysis);
    if (rec401k) recommendations.push(rec401k);

    // 2. HSA Optimization
    const recHSA = generateHSARecommendation(analysis);
    if (recHSA) recommendations.push(recHSA);

    // 3. Bracket Management
    const recBracket = generateBracketRecommendation(analysis);
    if (recBracket) recommendations.push(recBracket);

    // 4. Roth Conversion Windows (if has traditional balance)
    if (hasTraditionalBalance) {
        const windows = findRothConversionWindows(simulation, assumptions);
        // Calculate retirement tax rate for the recommendation
        const retirementAge = getRetirementAge(assumptions.milestones);
        const retirementYear = getBirthYear(assumptions.milestones) + retirementAge;
        const retirementTaxRate = getMedianRetirementTaxRate(simulation, retirementYear);
        const recRoth = generateRothConversionRecommendation(windows, retirementTaxRate);
        if (recRoth) recommendations.push(recRoth);
    }

    // Sort by estimated savings (high impact first)
    recommendations.sort((a, b) => b.estimatedAnnualSavings - a.estimatedAnnualSavings);

    return recommendations;
}

/**
 * Calculate the income threshold where marginal rate reaches or exceeds the target rate.
 * Returns the maximum income you can have while staying below the target rate.
 */
export function getIncomeThresholdForRate(
    targetRate: number,
    params: { brackets: Array<{ threshold: number; rate: number }> }
): number {
    // Find the first bracket where rate >= targetRate
    for (let i = 0; i < params.brackets.length; i++) {
        const bracket = params.brackets[i];
        if (bracket.rate >= targetRate) {
            // Return the threshold of this bracket (income stays below this to avoid this rate)
            return bracket.threshold;
        }
    }
    // If no bracket meets target rate, return Infinity (can convert unlimited)
    return Infinity;
}

/**
 * Calculate median effective tax rate during retirement from simulation.
 * EXCLUDES Roth conversion taxes to get the "base" retirement tax rate.
 */
export function getMedianRetirementTaxRate(simulation: SimulationYear[], retirementYear: number): number {
    const retirementYears = simulation.filter(s => s.year >= retirementYear);

    if (retirementYears.length === 0) return FALLBACK_RETIREMENT_TAX_RATE;

    const effectiveRates = retirementYears.map(simYear => {
        // Exclude Roth conversion tax to get the "base" retirement tax rate
        const conversionTax = simYear.rothConversion?.taxCost || 0;
        const baseTax = (simYear.taxDetails.fed || 0) +
                       (simYear.taxDetails.state || 0) +
                       (simYear.taxDetails.fica || 0) - conversionTax;
        const income = simYear.cashflow.totalIncome;
        return income > 0 ? Math.max(0, baseTax) / income : 0;
    });

    effectiveRates.sort((a, b) => a - b);
    const mid = Math.floor(effectiveRates.length / 2);
    return effectiveRates.length % 2 === 0
        ? (effectiveRates[mid - 1] + effectiveRates[mid]) / 2
        : effectiveRates[mid];
}

/**
 * Find years with low marginal rates suitable for Roth conversions.
 * Calculates optimal conversion amount based on retirement tax rate.
 */
export function findRothConversionWindows(
    simulation: SimulationYear[],
    assumptions: AssumptionsState
): RothConversionOpportunity[] {
    const opportunities: RothConversionOpportunity[] = [];
    const retirementAge = getRetirementAge(assumptions.milestones);
    const birthYear = getBirthYear(assumptions.milestones);
    const retirementYear = birthYear + retirementAge;

    // Get the median retirement tax rate and use the higher of calculated vs minimum
    const calculatedRate = getMedianRetirementTaxRate(simulation, retirementYear);
    const retirementTaxRate = Math.max(MIN_CONVERSION_TARGET_RATE, calculatedRate);

    for (const simYear of simulation) {
        const age = simYear.year - birthYear;

        // Only consider post-retirement years (when income typically drops)
        if (age < retirementAge) continue;

        // Calculate taxable income
        const grossIncome = TaxService.getGrossIncome(simYear.incomes, simYear.year);
        const preTaxDeductions = TaxService.getPreTaxExemptions(simYear.incomes, simYear.year, age);
        const taxableIncome = Math.max(0, grossIncome - preTaxDeductions);

        // Get federal tax parameters
        const fedParams = TaxService.getTaxParameters(
            simYear.year,
            'Single', // Simplified - should come from taxState
            'federal',
            undefined,
            assumptions
        );

        if (!fedParams) continue;

        // Get current bracket info
        const marginalInfo = TaxService.getMarginalTaxRate(taxableIncome, fedParams);

        // Only show opportunities where current rate < retirement rate
        if (marginalInfo.rate < retirementTaxRate) {
            // Find the income threshold where rate reaches retirement rate
            // Convert up to this point - anything below retirement rate is beneficial
            const targetIncomeThreshold = getIncomeThresholdForRate(retirementTaxRate, fedParams);

            // Optimal amount = threshold - current income (how much room we have)
            const optimalAmount = Math.max(0, targetIncomeThreshold - taxableIncome);

            // Calculate actual tax cost using bracket math
            let taxCost = 0;
            if (optimalAmount > 0) {
                const taxBefore = TaxService.calculateTax(taxableIncome, 0, {
                    ...fedParams,
                    standardDeduction: 0
                });
                const taxAfter = TaxService.calculateTax(taxableIncome + optimalAmount, 0, {
                    ...fedParams,
                    standardDeduction: 0
                });
                taxCost = taxAfter - taxBefore;
            }

            // Get the bracket you'd be in after optimal conversion
            const afterConversionBracket = TaxService.getMarginalTaxRate(
                taxableIncome + optimalAmount,
                fedParams
            );

            opportunities.push({
                year: simYear.year,
                age,
                marginalRate: marginalInfo.rate,
                optimalConversionAmount: optimalAmount,
                taxCost,
                bracketAfter: afterConversionBracket.rate * 100
            });
        }
    }

    return opportunities;
}

/**
 * Calculate the impact of a Roth conversion using actual simulation data.
 */
export function calculateRothConversion(
    conversionAmount: number,
    currentTaxableIncome: number,
    taxState: TaxState,
    year: number,
    assumptions: AssumptionsState,
    simulation: SimulationYear[]
): RothConversionResult {
    const fedParams = TaxService.getTaxParameters(
        year,
        taxState.filingStatus,
        'federal',
        undefined,
        assumptions
    );

    const retirementAge = getRetirementAge(assumptions.milestones);
    const birthYear = getBirthYear(assumptions.milestones);
    const lifeExpectancy = getLifeExpectancy(assumptions.milestones);
    const currentAge = year - birthYear;

    // Calculate growth horizon: years the money will compound before withdrawal
    // Pre-retirement: grows until retirement
    // At/post retirement: still grows - use midpoint of remaining life as withdrawal estimate
    const yearsUntilRetirement = currentAge < retirementAge
        ? retirementAge - currentAge
        : Math.max(1, Math.floor((lifeExpectancy - currentAge) / 2));

    const retirementYear = birthYear + retirementAge;
    const retirementYears = simulation.filter(s => s.year >= retirementYear);

    // Calculate marginal tax rate on additional income during retirement
    // Uses marginal rate (not effective) because a Traditional withdrawal ADDS to taxable income
    let retirementTaxRate = FALLBACK_RETIREMENT_TAX_RATE;
    if (retirementYears.length > 0) {
        const marginalRates = retirementYears.map(simYear => {
            const simAge = simYear.year - birthYear;
            const fedParams = TaxService.getTaxParameters(
                simYear.year,
                taxState.filingStatus,
                'federal',
                undefined,
                assumptions
            );
            if (!fedParams) return FALLBACK_RETIREMENT_TAX_RATE;
            const grossIncome = TaxService.getGrossIncome(simYear.incomes, simYear.year);
            const preTaxDeductions = TaxService.getPreTaxExemptions(simYear.incomes, simYear.year, simAge);
            // Subtract standard deduction to get actual taxable income (matches IRS calculation)
            const taxableIncome = Math.max(0, grossIncome - preTaxDeductions - fedParams.standardDeduction);
            const bracket = TaxService.getMarginalTaxRate(taxableIncome, fedParams);
            return bracket.rate;
        });
        // Use median marginal rate to avoid outliers
        marginalRates.sort((a, b) => a - b);
        const mid = Math.floor(marginalRates.length / 2);
        retirementTaxRate = marginalRates.length % 2 === 0
            ? (marginalRates[mid - 1] + marginalRates[mid]) / 2
            : marginalRates[mid];
    }

    // Calculate actual growth rate from simulation data
    let annualGrowthRate = (assumptions.investments?.returnRates?.ror / 100) || FALLBACK_GROWTH_RATE;
    if (simulation.length >= 2) {
        // Calculate compound annual growth rate from invested assets
        const getInvestedTotal = (simYear: SimulationYear) =>
            simYear.accounts
                .filter(acc => acc instanceof InvestedAccount)
                .reduce((sum, acc) => sum + acc.amount, 0);

        const firstYear = simulation[0];
        const lastYear = simulation[simulation.length - 1];
        const startValue = getInvestedTotal(firstYear);
        const years = lastYear.year - firstYear.year;

        if (startValue > 0 && years > 0) {
            // Use the assumption rate since CAGR from balances includes contributions
            // The assumption rate is already what the simulation uses
            annualGrowthRate = (assumptions.investments?.returnRates?.ror / 100) || FALLBACK_GROWTH_RATE;
        }
    }

    // Calculate current marginal tax rate for the conversion
    let currentTaxRate = FALLBACK_RETIREMENT_TAX_RATE;
    let immediateTaxCost = conversionAmount * FALLBACK_RETIREMENT_TAX_RATE;
    let newBracketRate = 22;
    let headroomRemaining = 0;

    if (fedParams) {
        // Apply standard deduction to get actual taxable income (matches IRS calculation)
        const actualTaxableIncome = Math.max(0, currentTaxableIncome - fedParams.standardDeduction);
        const currentBracket = TaxService.getMarginalTaxRate(actualTaxableIncome, fedParams);
        currentTaxRate = currentBracket.rate;

        const newTaxableIncome = Math.max(0, currentTaxableIncome + conversionAmount - fedParams.standardDeduction);
        const newBracket = TaxService.getMarginalTaxRate(newTaxableIncome, fedParams);
        newBracketRate = newBracket.rate * 100;
        headroomRemaining = newBracket.headroom;

        // Calculate exact tax cost using bracket math (standard deduction applied via fedParams)
        const taxBefore = TaxService.calculateTax(currentTaxableIncome, 0, fedParams);
        const taxAfter = TaxService.calculateTax(currentTaxableIncome + conversionAmount, 0, fedParams);
        immediateTaxCost = taxAfter - taxBefore;
        // Update current tax rate to be the effective rate on the conversion
        currentTaxRate = conversionAmount > 0 ? immediateTaxCost / conversionAmount : 0;
    }

    // === TRADITIONAL PATH ===
    // Keep money in traditional account, grows tax-deferred, taxed at withdrawal
    const traditionalStart = conversionAmount;
    const traditionalAtRetirement = traditionalStart * Math.pow(1 + annualGrowthRate, yearsUntilRetirement);
    const traditionalTaxAtWithdrawal = traditionalAtRetirement * retirementTaxRate;
    const traditionalAfterTax = traditionalAtRetirement - traditionalTaxAtWithdrawal;

    // === ROTH PATH ===
    // Full amount goes to Roth, but tax must be paid from somewhere.
    // To compare fairly, we account for the opportunity cost of paying tax now:
    // - The tax payment could have been invested and grown
    // - Net effect: like having (conversionAmount - tax) growing tax-free
    // This gives the mathematically equivalent result to paying tax from other funds
    // Note: rothNetContribution represents net wealth effect, not actual Roth balance
    const rothNetContribution = conversionAmount - immediateTaxCost;
    const rothAtRetirement = rothNetContribution * Math.pow(1 + annualGrowthRate, yearsUntilRetirement);
    const rothTaxAtWithdrawal = 0; // Roth withdrawals are tax-free
    const rothAfterTax = rothAtRetirement; // Same as growth since no tax

    // === BENEFIT ===
    // Positive = Roth is better, Negative = Traditional is better
    const benefit = rothAfterTax - traditionalAfterTax;

    return {
        conversionAmount,
        immediateTaxCost,
        newFederalBracket: newBracketRate,
        headroomRemaining,

        traditional: {
            startingAmount: traditionalStart,
            valueAtRetirement: traditionalAtRetirement,
            taxAtWithdrawal: traditionalTaxAtWithdrawal,
            afterTaxValue: traditionalAfterTax
        },
        roth: {
            amountAfterConversionTax: rothNetContribution, // Net wealth after paying tax (for comparison)
            valueAtRetirement: rothAtRetirement,
            taxAtWithdrawal: rothTaxAtWithdrawal,
            afterTaxValue: rothAfterTax
        },

        benefit,

        dataUsed: {
            currentTaxRate,
            retirementTaxRate,
            annualGrowthRate,
            yearsUntilRetirement
        }
    };
}

/**
 * Calculate the break-even future tax rate where Roth and Traditional produce identical after-tax values.
 * For contributions: equals the current marginal rate.
 * For conversions: equals the effective rate on the conversion amount (immediateTaxCost / amount).
 */
export function calculateBreakEvenRate(
    currentTaxableIncome: number,
    amount: number,
    mode: 'contribution' | 'conversion',
    taxState: TaxState,
    year: number,
    assumptions: AssumptionsState
): number {
    const fedParams = TaxService.getTaxParameters(
        year,
        taxState.filingStatus,
        'federal',
        undefined,
        assumptions
    );

    if (!fedParams) return FALLBACK_RETIREMENT_TAX_RATE;

    if (mode === 'contribution') {
        // For new contributions, break-even is the marginal rate (rate on the next dollar)
        const actualTaxableIncome = Math.max(0, currentTaxableIncome - fedParams.standardDeduction);
        const bracket = TaxService.getMarginalTaxRate(actualTaxableIncome, fedParams);
        return bracket.rate;
    } else {
        // For conversions, break-even is the effective rate on the conversion amount
        const taxBefore = TaxService.calculateTax(currentTaxableIncome, 0, fedParams);
        const taxAfter = TaxService.calculateTax(currentTaxableIncome + amount, 0, fedParams);
        const immediateTaxCost = taxAfter - taxBefore;
        return amount > 0 ? immediateTaxCost / amount : 0;
    }
}

/** Step size for optimal amount search */
const OPTIMAL_SEARCH_STEP = 500;
/** Minimum search max if computed max is too low */
const OPTIMAL_SEARCH_MIN_MAX = 5000;

/**
 * Find the optimal Roth amount by stepping through amounts and computing
 * total benefit at each level. Returns the amount with peak benefit.
 *
 * For each candidate amount X:
 *   - taxNow = incremental tax from converting/contributing X at current year
 *   - grownAmount = X * (1+r)^n
 *   - taxLater = incremental tax from withdrawing grownAmount at withdrawal year
 *   - benefit = taxLater - taxNow * (1+r)^n
 *     (equivalent to: Roth after-tax value - Traditional after-tax value)
 *
 * Returns the X that maximizes benefit, or null if benefit is never positive.
 */
export function findOptimalRothAmount(
    mode: 'contribution' | 'conversion',
    growthYears: number,
    currentTaxableIncome: number,
    taxState: TaxState,
    year: number,
    assumptions: AssumptionsState,
    simulation: SimulationYear[],
    maxAmount: number
): { optimalAmount: number | null; optimalVerdict: 'all-roth' | 'all-traditional' | 'optimal' } {
    const birthYear = getBirthYear(assumptions.milestones);
    const growthRate = (assumptions.investments?.returnRates?.ror / 100) || FALLBACK_GROWTH_RATE;
    const growthFactor = Math.pow(1 + growthRate, growthYears);

    // Get current year tax params
    const fedParamsNow = TaxService.getTaxParameters(
        year, taxState.filingStatus, 'federal', undefined, assumptions
    );
    if (!fedParamsNow) return { optimalAmount: null, optimalVerdict: 'all-traditional' };

    // Get withdrawal year tax params and base income
    const withdrawalYear = year + growthYears;
    const withdrawalSimYear = simulation.find(s => s.year === withdrawalYear)
        || simulation[simulation.length - 1];
    if (!withdrawalSimYear) return { optimalAmount: null, optimalVerdict: 'all-traditional' };

    const simAge = withdrawalSimYear.year - birthYear;
    const fedParamsWithdrawal = TaxService.getTaxParameters(
        withdrawalSimYear.year, taxState.filingStatus, 'federal', undefined, assumptions
    );
    if (!fedParamsWithdrawal) return { optimalAmount: null, optimalVerdict: 'all-traditional' };

    const grossIncomeWithdrawal = TaxService.getGrossIncome(withdrawalSimYear.incomes, withdrawalSimYear.year);
    const preTaxWithdrawal = TaxService.getPreTaxExemptions(withdrawalSimYear.incomes, withdrawalSimYear.year, simAge);
    const baseWithdrawalIncome = Math.max(0, grossIncomeWithdrawal - preTaxWithdrawal);

    // Base tax amounts (no conversion/contribution)
    const baseTaxNow = TaxService.calculateTax(currentTaxableIncome, 0, fedParamsNow);
    const baseTaxWithdrawal = TaxService.calculateTax(baseWithdrawalIncome, 0, fedParamsWithdrawal);

    // For contribution mode, current marginal rate is fixed
    let fixedMarginalRate = 0;
    if (mode === 'contribution') {
        const actualTaxableNow = Math.max(0, currentTaxableIncome - fedParamsNow.standardDeduction);
        const bracket = TaxService.getMarginalTaxRate(actualTaxableNow, fedParamsNow);
        fixedMarginalRate = bracket.rate;
    }

    const searchMax = Math.max(OPTIMAL_SEARCH_MIN_MAX, maxAmount);
    const step = Math.max(OPTIMAL_SEARCH_STEP, Math.floor(searchMax / 1000) * OPTIMAL_SEARCH_STEP);

    let bestAmount = 0;
    let bestBenefit = 0;
    let everPositive = false;
    let everNegative = false;

    for (let x = step; x <= searchMax; x += step) {
        // Tax cost now
        let taxNow: number;
        if (mode === 'contribution') {
            taxNow = x * fixedMarginalRate;
        } else {
            const taxAfterConversion = TaxService.calculateTax(currentTaxableIncome + x, 0, fedParamsNow);
            taxNow = taxAfterConversion - baseTaxNow;
        }

        // Tax cost at withdrawal
        const grownAmount = x * growthFactor;
        const taxAfterWithdrawal = TaxService.calculateTax(baseWithdrawalIncome + grownAmount, 0, fedParamsWithdrawal);
        const taxLater = taxAfterWithdrawal - baseTaxWithdrawal;

        // Benefit: how much more you'd pay in Traditional vs Roth (positive = Roth wins)
        // Roth after-tax = (x - taxNow) * growthFactor
        // Trad after-tax = x * growthFactor - taxLater
        // benefit = Roth - Trad = taxLater - taxNow * growthFactor
        const benefit = taxLater - taxNow * growthFactor;

        if (benefit > bestBenefit) {
            bestBenefit = benefit;
            bestAmount = x;
        }
        if (benefit > 0) everPositive = true;
        if (benefit < 0) everNegative = true;
    }

    if (!everPositive) {
        return { optimalAmount: null, optimalVerdict: 'all-traditional' };
    }

    // Only report 'all-roth' if benefit was positive at every tested amount
    if (!everNegative) {
        return { optimalAmount: null, optimalVerdict: 'all-roth' };
    }

    // Mixed: return the amount with peak benefit
    return { optimalAmount: bestAmount, optimalVerdict: 'optimal' };
}

/**
 * Analyze Roth vs Pre-Tax decision for both new contributions and conversions.
 * Uses explicit growth years (user-controlled) rather than auto-calculated.
 */
export function analyzeRothVsPreTax(
    amount: number,
    mode: 'contribution' | 'conversion',
    growthYears: number,
    currentTaxableIncome: number,
    taxState: TaxState,
    year: number,
    assumptions: AssumptionsState,
    simulation: SimulationYear[],
    maxAmount: number
): RothAnalysis {
    const fedParams = TaxService.getTaxParameters(
        year,
        taxState.filingStatus,
        'federal',
        undefined,
        assumptions
    );

    const birthYear = getBirthYear(assumptions.milestones);

    // Growth rate from assumptions
    const growthRate = (assumptions.investments?.returnRates?.ror / 100) || FALLBACK_GROWTH_RATE;

    // Calculate current tax cost based on mode
    let immediateTaxCost: number;
    let currentEffectiveRate: number;

    if (mode === 'contribution') {
        // For contributions, tax cost is the marginal rate on this amount
        if (fedParams) {
            const actualTaxableIncome = Math.max(0, currentTaxableIncome - fedParams.standardDeduction);
            const bracket = TaxService.getMarginalTaxRate(actualTaxableIncome, fedParams);
            currentEffectiveRate = bracket.rate;
            immediateTaxCost = amount * currentEffectiveRate;
        } else {
            currentEffectiveRate = FALLBACK_RETIREMENT_TAX_RATE;
            immediateTaxCost = amount * currentEffectiveRate;
        }
    } else {
        // For conversions, use bracket math (same as calculateRothConversion)
        if (fedParams) {
            const taxBefore = TaxService.calculateTax(currentTaxableIncome, 0, fedParams);
            const taxAfter = TaxService.calculateTax(currentTaxableIncome + amount, 0, fedParams);
            immediateTaxCost = taxAfter - taxBefore;
            currentEffectiveRate = amount > 0 ? immediateTaxCost / amount : 0;
        } else {
            currentEffectiveRate = FALLBACK_RETIREMENT_TAX_RATE;
            immediateTaxCost = amount * currentEffectiveRate;
        }
    }

    // Traditional path: full amount grows tax-deferred, taxed at withdrawal
    const traditionalStart = amount;
    const traditionalAtWithdrawal = traditionalStart * Math.pow(1 + growthRate, growthYears);

    // Calculate actual tax on the withdrawal using bracket math at the withdrawal year.
    // This correctly handles cases where income is below the standard deduction.
    const withdrawalYear = year + growthYears;
    let traditionalTaxAtWithdrawal = traditionalAtWithdrawal * FALLBACK_RETIREMENT_TAX_RATE;
    const withdrawalSimYear = simulation.find(s => s.year === withdrawalYear)
        || simulation[simulation.length - 1];
    if (withdrawalSimYear) {
        const simAge = withdrawalSimYear.year - birthYear;
        const simFedParams = TaxService.getTaxParameters(
            withdrawalSimYear.year,
            taxState.filingStatus,
            'federal',
            undefined,
            assumptions
        );
        if (simFedParams) {
            const grossIncome = TaxService.getGrossIncome(withdrawalSimYear.incomes, withdrawalSimYear.year);
            const preTaxDeductions = TaxService.getPreTaxExemptions(withdrawalSimYear.incomes, withdrawalSimYear.year, simAge);
            // Base income before the Traditional withdrawal (fedParams includes standard deduction)
            const baseIncome = Math.max(0, grossIncome - preTaxDeductions);
            const taxBefore = TaxService.calculateTax(baseIncome, 0, simFedParams);
            const taxAfter = TaxService.calculateTax(baseIncome + traditionalAtWithdrawal, 0, simFedParams);
            traditionalTaxAtWithdrawal = taxAfter - taxBefore;
        }
    }

    // Derive effective withdrawal rate for display
    const retirementMarginalRate = traditionalAtWithdrawal > 0
        ? traditionalTaxAtWithdrawal / traditionalAtWithdrawal
        : FALLBACK_RETIREMENT_TAX_RATE;

    // Break-even rate
    const breakEvenRate = calculateBreakEvenRate(currentTaxableIncome, amount, mode, taxState, year, assumptions);

    const traditionalAfterTax = traditionalAtWithdrawal - traditionalTaxAtWithdrawal;

    // Roth path: pay tax now, remainder grows tax-free
    const rothAfterTax = amount - immediateTaxCost;
    const rothAtWithdrawal = rothAfterTax * Math.pow(1 + growthRate, growthYears);
    const rothAfterTaxValue = rothAtWithdrawal; // Tax-free

    // Benefit: positive = Roth wins
    const benefit = rothAfterTaxValue - traditionalAfterTax;

    // Verdict and reason
    let verdict: 'roth' | 'traditional' | 'even';
    let reason: string;
    const modeLabel = mode === 'contribution' ? 'Choosing Roth' : `Converting at age ${year - birthYear}`;
    const tradLabel = mode === 'contribution' ? 'pre-tax' : 'traditional';

    if (Math.abs(benefit) < 1) {
        verdict = 'even';
        reason = 'Both options produce the same after-tax value.';
    } else if (benefit > 0) {
        verdict = 'roth';
        reason = `${modeLabel} saves ${formatDollars(benefit)} because your current rate (${(currentEffectiveRate * 100).toFixed(1)}%) is lower than your projected withdrawal rate (${(retirementMarginalRate * 100).toFixed(1)}%).`;
    } else {
        verdict = 'traditional';
        reason = `Keeping ${tradLabel} saves ${formatDollars(Math.abs(benefit))} because your current rate (${(currentEffectiveRate * 100).toFixed(1)}%) is higher than your projected withdrawal rate (${(retirementMarginalRate * 100).toFixed(1)}%).`;
    }

    // Calculate optimal amount
    const { optimalAmount, optimalVerdict } = findOptimalRothAmount(
        mode, growthYears, currentTaxableIncome, taxState, year, assumptions, simulation, maxAmount
    );

    return {
        mode,
        amount,
        currentEffectiveRate,
        retirementMarginalRate,
        breakEvenRate,
        growthYears,
        growthRate,
        traditional: {
            startingAmount: traditionalStart,
            valueAtWithdrawal: traditionalAtWithdrawal,
            taxAtWithdrawal: traditionalTaxAtWithdrawal,
            afterTaxValue: traditionalAfterTax
        },
        roth: {
            amountAfterTax: rothAfterTax,
            valueAtWithdrawal: rothAtWithdrawal,
            afterTaxValue: rothAfterTaxValue
        },
        benefit,
        verdict,
        reason,
        optimalAmount,
        optimalVerdict
    };
}

/** Format dollars for reason strings */
function formatDollars(value: number): string {
    return '$' + Math.round(value).toLocaleString();
}

/**
 * Generate tax projections for all years in simulation.
 */
export function generateTaxProjections(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
    taxState: TaxState
): TaxProjection[] {
    const projections: TaxProjection[] = [];
    const retirementAge = getRetirementAge(assumptions.milestones);

    for (const simYear of simulation) {
        const age = simYear.year - getBirthYear(assumptions.milestones);

        const grossIncome = TaxService.getGrossIncome(simYear.incomes, simYear.year);
        const preTaxDeductions = TaxService.getPreTaxExemptions(simYear.incomes, simYear.year, age);
        const totalTax = simYear.taxDetails.fed + simYear.taxDetails.state + simYear.taxDetails.fica;
        const effectiveRate = grossIncome > 0 ? totalTax / grossIncome : 0;

        const marginal = TaxService.getCombinedMarginalRate(
            grossIncome,
            preTaxDeductions,
            taxState,
            simYear.year,
            assumptions,
            age < retirementAge // FICA only for working years
        );

        const isRetired = age >= retirementAge;
        // Low tax year: retired and in 12% or lower federal bracket
        const isLowTaxYear = isRetired && marginal.federal <= 0.12;

        projections.push({
            year: simYear.year,
            age,
            grossIncome,
            effectiveRate,
            marginalRate: marginal.combined,
            federalBracket: marginal.federal * 100,
            isRetired,
            isLowTaxYear
        });
    }

    return projections;
}

// ============================================================================
// Helper Functions
// ============================================================================

function get401kContributions(incomes: AnyIncome[], year: number, age?: number): number {
    return incomes
        .filter((inc): inc is WorkIncome => inc instanceof WorkIncome)
        .reduce((sum, inc) => {
            const effective = age !== undefined
                ? inc.getEffective401k(year, age)
                : { preTax: inc.preTax401k, roth: inc.roth401k };
            return sum +
                inc.getProratedAnnual(effective.preTax, year) +
                inc.getProratedAnnual(effective.roth, year);
        }, 0);
}

function getHSAContributions(incomes: AnyIncome[], year: number): number {
    return incomes
        .filter((inc): inc is WorkIncome => inc instanceof WorkIncome)
        .reduce((sum, inc) => {
            return sum + inc.getProratedAnnual(inc.hsaContribution, year);
        }, 0);
}

function generate401kRecommendation(analysis: TaxAnalysis): TaxRecommendation | null {
    const { current401k, limit401k } = analysis.preTaxContributions;
    const gap = limit401k - current401k;

    // Only recommend if there's meaningful headroom
    if (gap < MIN_401K_GAP_FOR_RECOMMENDATION) return null;

    const savings = calculateContributionTaxSavings(
        current401k,
        limit401k,
        analysis.marginalRate.federal + analysis.marginalRate.state
    );

    if (savings.taxSavings < MIN_401K_SAVINGS_FOR_RECOMMENDATION) return null;

    const impact: RecommendationImpact =
        savings.taxSavings >= IMPACT_HIGH_401K_THRESHOLD ? 'high' :
        savings.taxSavings >= IMPACT_MEDIUM_401K_THRESHOLD ? 'medium' : 'low';

    return {
        id: '401k-increase',
        title: 'Increase 401(k) Contributions',
        description: `You're contributing $${current401k.toLocaleString()}/year to your 401(k), ` +
            `but the limit is $${limit401k.toLocaleString()}. ` +
            `Increasing contributions could reduce your taxable income.`,
        category: 'contribution',
        impact,
        estimatedAnnualSavings: Math.round(savings.taxSavings),
        actionItems: [
            `Increase 401(k) by $${Math.round(gap).toLocaleString()} to max out`,
            `Estimated tax savings: $${Math.round(savings.taxSavings).toLocaleString()}/year`,
            `Your marginal rate: ${(analysis.marginalRate.combined * 100).toFixed(1)}%`
        ]
    };
}

function generateHSARecommendation(analysis: TaxAnalysis): TaxRecommendation | null {
    const { currentHSA, limitHSA } = analysis.preTaxContributions;
    const gap = limitHSA - currentHSA;

    // Only recommend if there's meaningful headroom
    if (gap < MIN_HSA_GAP_FOR_RECOMMENDATION) return null;

    // HSA has triple tax advantage: pre-tax, grows tax-free, tax-free withdrawals for medical
    const combinedRate = analysis.marginalRate.federal +
        analysis.marginalRate.state +
        analysis.marginalRate.fica;

    const savings = calculateContributionTaxSavings(
        currentHSA,
        limitHSA,
        combinedRate
    );

    if (savings.taxSavings < MIN_HSA_SAVINGS_FOR_RECOMMENDATION) return null;

    const impact: RecommendationImpact =
        savings.taxSavings >= IMPACT_HIGH_HSA_THRESHOLD ? 'high' :
        savings.taxSavings >= IMPACT_MEDIUM_HSA_THRESHOLD ? 'medium' : 'low';

    return {
        id: 'hsa-increase',
        title: 'Maximize HSA Contributions',
        description: `Your HSA contributions are $${currentHSA.toLocaleString()}/year, ` +
            `below the $${limitHSA.toLocaleString()} limit. ` +
            `HSAs offer a triple tax advantage: pre-tax contributions, tax-free growth, ` +
            `and tax-free withdrawals for medical expenses.`,
        category: 'contribution',
        impact,
        estimatedAnnualSavings: Math.round(savings.taxSavings),
        actionItems: [
            `Increase HSA by $${Math.round(gap).toLocaleString()} to max out`,
            `Estimated tax savings: $${Math.round(savings.taxSavings).toLocaleString()}/year`,
            `HSA contributions avoid income tax AND FICA taxes`
        ]
    };
}

function generateBracketRecommendation(analysis: TaxAnalysis): TaxRecommendation | null {
    const { federalHeadroom, federalBracket } = analysis;

    // Only relevant if close to next bracket
    if (federalHeadroom > BRACKET_HEADROOM_THRESHOLD || federalHeadroom === Infinity) return null;

    return {
        id: 'bracket-management',
        title: 'Near Tax Bracket Boundary',
        description: `You're $${Math.round(federalHeadroom).toLocaleString()} away from the ` +
            `next federal tax bracket. Consider timing income or deductions to stay ` +
            `in the ${federalBracket}% bracket.`,
        category: 'timing',
        impact: 'medium',
        estimatedAnnualSavings: 0, // Depends on actions taken
        actionItems: [
            `Current bracket: ${federalBracket}%`,
            `Headroom: $${Math.round(federalHeadroom).toLocaleString()}`,
            `Consider deferring income or accelerating deductions`
        ]
    };
}

function generateRothConversionRecommendation(
    windows: RothConversionOpportunity[],
    retirementTaxRate?: number
): TaxRecommendation | null {
    // Find the best window (lowest rate with meaningful headroom)
    const bestWindows = windows
        .filter(w => w.optimalConversionAmount > MIN_ROTH_CONVERSION_AMOUNT)
        .sort((a, b) => a.marginalRate - b.marginalRate)
        .slice(0, 3);

    if (bestWindows.length === 0) return null;

    const best = bestWindows[0];
    const retirementRateStr = retirementTaxRate !== undefined
        ? `${(retirementTaxRate * 100).toFixed(0)}%`
        : 'higher';

    return {
        id: 'roth-conversion-window',
        title: 'Roth Conversion Opportunity',
        description: `You have ${bestWindows.length} year(s) where your tax bracket is below your ` +
            `projected retirement rate (${retirementRateStr}). Converting traditional funds to Roth ` +
            `at lower rates reduces lifetime taxes.`,
        category: 'conversion',
        impact: 'high',
        estimatedAnnualSavings: 0, // Long-term benefit, not immediate savings
        actionItems: [
            `Best year: Age ${best.age} (${(best.marginalRate * 100).toFixed(0)}% bracket → ${best.bracketAfter.toFixed(0)}% after)`,
            `Optimal conversion: $${Math.round(best.optimalConversionAmount).toLocaleString()} (fills brackets below retirement rate)`,
            `Estimated tax cost: $${Math.round(best.taxCost).toLocaleString()}`,
            `Use the calculator below to explore different amounts and ages`
        ]
    };
}

/**
 * Check if simulation has traditional (pre-tax) retirement account balance.
 */
export function hasTraditionalRetirementBalance(simulation: SimulationYear[]): boolean {
    if (simulation.length === 0) return false;

    const currentYear = simulation[0];
    return currentYear.accounts.some(acc =>
        acc instanceof InvestedAccount &&
        (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
    );
}
