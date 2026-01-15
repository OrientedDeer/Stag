/**
 * Tax Optimization Service
 *
 * Analyzes tax situation and provides recommendations for reducing
 * lifetime tax burden through contributions, conversions, and timing.
 */

import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { AssumptionsState } from '../components/Objects/Assumptions/AssumptionsContext';
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
    const age = assumptions.demographics.startAge + (year - assumptions.demographics.startYear);

    // Get gross income and deductions
    const grossIncome = TaxService.getGrossIncome(incomes, year);
    const preTaxDeductions = TaxService.getPreTaxExemptions(incomes, year);

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
    const current401k = get401kContributions(incomes, year);
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
        const retirementAge = assumptions.demographics.retirementAge;
        const startAge = assumptions.demographics.startAge;
        const startYear = assumptions.demographics.startYear;
        const retirementYear = startYear + (retirementAge - startAge);
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

    if (retirementYears.length === 0) return 0.22; // Fallback

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
    const retirementAge = assumptions.demographics.retirementAge;
    const startAge = assumptions.demographics.startAge;
    const startYear = assumptions.demographics.startYear;
    const retirementYear = startYear + (retirementAge - startAge);

    // Minimum target rate: always fill at least to the 22% bracket
    // This ensures we show conversion opportunities even when calculated effective retirement rate is low
    const MIN_CONVERSION_TARGET_RATE = 0.22;

    // Get the median retirement tax rate and use the higher of calculated vs minimum
    const calculatedRate = getMedianRetirementTaxRate(simulation, retirementYear);
    const retirementTaxRate = Math.max(MIN_CONVERSION_TARGET_RATE, calculatedRate);

    for (const simYear of simulation) {
        const age = startAge + (simYear.year - startYear);

        // Only consider post-retirement years (when income typically drops)
        if (age < retirementAge) continue;

        // Calculate taxable income
        const grossIncome = TaxService.getGrossIncome(simYear.incomes, simYear.year);
        const preTaxDeductions = TaxService.getPreTaxExemptions(simYear.incomes, simYear.year);
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

    const retirementAge = assumptions.demographics.retirementAge;
    const startAge = assumptions.demographics.startAge;
    const startYear = assumptions.demographics.startYear;
    const currentAge = startAge + (year - startYear);

    // Calculate years until retirement and years in retirement from simulation
    const yearsUntilRetirement = Math.max(0, retirementAge - currentAge);
    const retirementYear = startYear + (retirementAge - startAge);
    const retirementYears = simulation.filter(s => s.year >= retirementYear);

    // Calculate median effective tax rate during retirement from actual simulation
    let retirementTaxRate = 0.22; // Fallback
    if (retirementYears.length > 0) {
        const effectiveRates = retirementYears.map(simYear => {
            const totalTax = (simYear.taxDetails.fed || 0) +
                           (simYear.taxDetails.state || 0) +
                           (simYear.taxDetails.fica || 0);
            const income = simYear.cashflow.totalIncome;
            return income > 0 ? totalTax / income : 0;
        });
        // Use median to avoid outliers
        effectiveRates.sort((a, b) => a - b);
        const mid = Math.floor(effectiveRates.length / 2);
        retirementTaxRate = effectiveRates.length % 2 === 0
            ? (effectiveRates[mid - 1] + effectiveRates[mid]) / 2
            : effectiveRates[mid];
    }

    // Calculate actual growth rate from simulation data
    let annualGrowthRate = (assumptions.investments?.returnRates?.ror / 100) || 0.07; // Fallback
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
            annualGrowthRate = (assumptions.investments?.returnRates?.ror / 100) || 0.07;
        }
    }

    // Calculate current marginal tax rate for the conversion
    let currentTaxRate = 0.22; // Fallback
    let immediateTaxCost = conversionAmount * 0.22;
    let newBracketRate = 22;
    let headroomRemaining = 0;

    if (fedParams) {
        const currentBracket = TaxService.getMarginalTaxRate(currentTaxableIncome, fedParams);
        currentTaxRate = currentBracket.rate;

        const newTaxableIncome = currentTaxableIncome + conversionAmount;
        const newBracket = TaxService.getMarginalTaxRate(newTaxableIncome, fedParams);
        newBracketRate = newBracket.rate * 100;
        headroomRemaining = newBracket.headroom;

        // Calculate exact tax cost using bracket math
        const taxBefore = TaxService.calculateTax(currentTaxableIncome, 0, {
            ...fedParams,
            standardDeduction: 0
        });
        const taxAfter = TaxService.calculateTax(newTaxableIncome, 0, {
            ...fedParams,
            standardDeduction: 0
        });
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
 * Generate tax projections for all years in simulation.
 */
export function generateTaxProjections(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
    taxState: TaxState
): TaxProjection[] {
    const projections: TaxProjection[] = [];
    const retirementAge = assumptions.demographics.retirementAge;

    for (const simYear of simulation) {
        const age = assumptions.demographics.startAge +
            (simYear.year - assumptions.demographics.startYear);

        const grossIncome = TaxService.getGrossIncome(simYear.incomes, simYear.year);
        const preTaxDeductions = TaxService.getPreTaxExemptions(simYear.incomes, simYear.year);
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

function get401kContributions(incomes: AnyIncome[], year: number): number {
    return incomes
        .filter((inc): inc is WorkIncome => inc instanceof WorkIncome)
        .reduce((sum, inc) => {
            return sum +
                inc.getProratedAnnual(inc.preTax401k, year) +
                inc.getProratedAnnual(inc.roth401k, year);
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

    // Only recommend if there's meaningful headroom (>$1000)
    if (gap < 1000) return null;

    const savings = calculateContributionTaxSavings(
        current401k,
        limit401k,
        analysis.marginalRate.federal + analysis.marginalRate.state
    );

    if (savings.taxSavings < 100) return null;

    const impact: RecommendationImpact = savings.taxSavings >= 2000 ? 'high' :
        savings.taxSavings >= 500 ? 'medium' : 'low';

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

    // Only recommend if there's meaningful headroom (>$500)
    if (gap < 500) return null;

    // HSA has triple tax advantage: pre-tax, grows tax-free, tax-free withdrawals for medical
    const combinedRate = analysis.marginalRate.federal +
        analysis.marginalRate.state +
        analysis.marginalRate.fica;

    const savings = calculateContributionTaxSavings(
        currentHSA,
        limitHSA,
        combinedRate
    );

    if (savings.taxSavings < 50) return null;

    const impact: RecommendationImpact = savings.taxSavings >= 1000 ? 'high' :
        savings.taxSavings >= 300 ? 'medium' : 'low';

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

    // Only relevant if close to next bracket (within $10k)
    if (federalHeadroom > 10000 || federalHeadroom === Infinity) return null;

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
        .filter(w => w.optimalConversionAmount > 5000)
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
