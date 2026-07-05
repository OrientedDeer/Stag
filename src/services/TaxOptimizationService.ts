/**
 * Tax Optimization Service
 *
 * Analyzes tax situation and provides recommendations for reducing
 * lifetime tax burden through contributions, conversions, and timing.
 */

import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { AssumptionsState, getRetirementAge, getBirthYear } from '../components/Objects/Assumptions/AssumptionsContext';
import { TaxState, resolveTaxEventsForYear } from '../components/Objects/Taxes/TaxContext';
import { buildMilestoneReachYears } from './simulation/MilestoneEvaluator';
import { TaxParameters } from '../data/TaxData';
import { AnyIncome, WorkIncome } from '../components/Objects/Income/models';
import { InvestedAccount } from '../components/Objects/Accounts/models';
import * as TaxService from '../components/Objects/Taxes/TaxService';
import { getFicaTaxableBase } from '../components/Objects/Taxes/taxService/ficaTax';
import { isSSCoveredForFica } from '../components/Objects/Taxes/taxService/incomeAggregation';
import {
    get401kLimit,
    getHSALimit,
    calculateContributionTaxSavings
} from '../data/ContributionLimits';
import { getRMDStartAge, getDistributionPeriod, PEAK_RMD_DIVISOR } from '../data/RMDData';

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

/** Minimum federal-bracket gap (in absolute terms) to flag RMD pressure */
const RMD_PRESSURE_MIN_GAP = 0.04;

/** Federal-bracket gap considered "high impact" pressure */
const RMD_PRESSURE_HIGH_GAP = 0.10;

/** Minimum traditional balance at RMD age to consider pressure analysis */
const RMD_PRESSURE_MIN_BALANCE = 50000;


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

export interface RMDPressureAnalysis {
    /** True if there's a meaningful gap between current and RMD-age federal rates */
    hasPressure: boolean;
    /** Current combined fed+state ordinary marginal rate (excludes FICA — matches the rate that applies to deductible 401k contributions) */
    currentOrdinaryRate: number;
    /** Current federal marginal bracket rate */
    currentFederalBracket: number;
    /** RMD start age based on birth year */
    rmdStartAge: number;
    /** Calendar year when RMDs begin */
    rmdStartYear: number;
    /** Projected Traditional 401k + IRA balance at RMD start */
    traditionalBalanceAtRMD: number;
    /** Projected first-year RMD amount */
    estimatedFirstRMD: number;
    /** Projected combined fed+state ordinary marginal rate at RMD age */
    rmdAgeOrdinaryRate: number;
    /** Projected federal bracket at RMD age */
    rmdAgeFederalBracket: number;
    /** rmdAgeFederalBracket - currentFederalBracket */
    federalBracketGap: number;
    /** Latest working year where switching from Traditional to Roth still closes the gap (null if not computable) */
    switchoverYear: number | null;
    /** User's age in switchoverYear */
    switchoverAge: number | null;
    /** Estimated reduction in lifetime taxes if switching at switchoverYear */
    estimatedTaxImpact: number | null;
    /** Total Traditional 401k contributions that would be redirected to Roth */
    redirectedContributions: number | null;
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

    // FICA-eligible EARNED base for the marginal-rate FICA test, mirroring
    // calculateFicaTax: earned wages net of FICA exemptions. Passing this (rather
    // than letting earnedIncome default to grossIncome) keeps the 6.2% SS / 0.9%
    // surtax thresholds tied to wages, not total gross — so a still-working person
    // whose SS/pension/passive income pushes gross past a threshold while wages
    // stay below it doesn't wrongly lose the SS marginal component.
    const earnedBase = getFicaTaxableBase(incomes, year);
    // SS-covered earned base for the marginal SS test — excludes CSRS wages, which
    // are outside Social Security (#139). Skip the second pass when no CSRS job: the
    // SS-covered base then equals earnedBase (mirrors the ficaTax guard).
    const ssCoveredEarnedBase = incomes.some(inc => !isSSCoveredForFica(inc))
        ? getFicaTaxableBase(incomes.filter(isSSCoveredForFica), year)
        : earnedBase;

    // FICA is gated on whether there are FICA-eligible earned WAGES, NOT on age.
    // calculateFicaTax charges Social Security / Medicare payroll tax on the earned
    // wage base with no age cap — someone still drawing W-2 wages past retirement
    // age genuinely pays ~7.65% FICA. A retiree with zero wages → earnedBase 0 →
    // no FICA marginal naturally. Gating on age understated the marginal by ~7.65pt
    // for anyone working past retirement and biased 401k/bracket advice.
    const includesFICA = earnedBase > 0;

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
        includesFICA,
        earnedBase,
        ssCoveredEarnedBase
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
    hasTraditionalBalance: boolean = false,
    taxState?: TaxState
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
        const windows = findRothConversionWindows(simulation, assumptions, taxState);
        // Calculate retirement tax rate for the recommendation
        const retirementAge = getRetirementAge(assumptions.milestones);
        const retirementYear = getBirthYear(assumptions.milestones) + retirementAge;
        const retirementTaxRate = getMedianRetirementTaxRate(simulation, retirementYear);
        const recRoth = generateRothConversionRecommendation(windows, retirementTaxRate);
        if (recRoth) recommendations.push(recRoth);
    }

    // 5. RMD Tax Pressure → Roth 401k contribution recommendation
    if (taxState) {
        const pressure = analyzeRMDTaxPressure(simulation, assumptions, taxState);
        const recPressure = generateRMDPressureRecommendation(pressure);
        if (recPressure) recommendations.push(recPressure);
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
 * Projected combined (federal + state) marginal tax rate the Traditional balance
 * actually faces when withdrawn in this plan — i.e. the rate RMDs land in (#68).
 *
 * This is the SAME rate the Roth-conversion engine targets as its conversion
 * ceiling ("peak RMD → 22% bracket"), so haircutting the Traditional balance by
 * it keeps the tax-adjusted net-worth metric CONSISTENT with the conversion
 * strategy: converting at a rate at/below this no longer reads as an after-tax
 * loss (which it shouldn't). Valuing the deferred balance at a lower current-year
 * "cost to spend it now" rate made the metric fight the optimizer — raising the
 * DP back-load δ (fewer conversions) perversely raised after-tax net worth.
 *
 * Primary: a BALANCE-WEIGHTED combined marginal rate across the simulation's
 * RMD-era years where Traditional is still being drawn (getOrdinaryAGI already
 * folds in the actual RMD + taxable SS). Weighting by the Traditional balance
 * keeps high-balance early-RMD years dominant — a plain mean/median would let
 * late, nearly-drained low-bracket years drag the single applied rate below what
 * the bulk of the balance actually faced. Fallback: when the Traditional drains
 * before RMD age (e.g. aggressive conversions empty it), value the PEAK balance
 * at the rate a hypothetical RMD off it would face — so the haircut doesn't
 * collapse to 0% and flatter the drained plan. Returns null only when there is
 * no Traditional balance anywhere in the projection.
 */
export function getProjectedRMDMarginalRate(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
    taxState: TaxState,
): number | null {
    if (simulation.length === 0 || !assumptions.milestones) return null;

    const birthYear = getBirthYear(assumptions.milestones);
    const rmdStartYear = birthYear + getRMDStartAge(birthYear);
    // Resolve scheduled tax life events PER projected year (fp-review F3a): a scheduled
    // MFJ→Single switch or state move is priced by the engine in-horizon, so the RMD-era
    // rate this haircut applies must use the same per-year filing status / residency —
    // not the raw year-0 values for the whole projection.
    const reachYears = buildMilestoneReachYears(simulation);
    const effTaxAt = (year: number): TaxState => resolveTaxEventsForYear(taxState, year, reachYears);

    // Combined fed+state marginal rate on the top dollar of `ordinaryIncome`.
    const combinedMarginalAt = (year: number, ordinaryIncome: number): number => {
        const eff = effTaxAt(year);
        const fedParams = TaxService.getTaxParameters(year, eff.filingStatus, 'federal', undefined, assumptions);
        const stateParams = TaxService.getTaxParameters(year, eff.filingStatus, 'state', eff.stateResidency, assumptions);
        const fedRate = fedParams ? TaxService.getMarginalTaxRate(Math.max(0, ordinaryIncome - (fedParams.standardDeduction || 0)), fedParams).rate : 0;
        const stateRate = stateParams ? TaxService.getMarginalTaxRate(Math.max(0, ordinaryIncome - (stateParams.standardDeduction || 0)), stateParams).rate : 0;
        return fedRate + stateRate;
    };

    let weightedRateSum = 0;
    let weightSum = 0;
    let peakSimYear: SimulationYear | null = null;
    let peakBalance = 0;

    for (const simYear of simulation) {
        if (simYear.isEndOfYearProjection) continue;
        const tradBalance = getTraditionalBalance(simYear);
        if (tradBalance <= 0) continue;

        // RMD-era year: getOrdinaryAGI already includes the actual RMD + taxable
        // SS, so the marginal at (agi − std deduction) is the rate the top
        // Traditional dollars hit. Weight by the balance being taxed.
        if (simYear.year >= rmdStartYear) {
            const age = simYear.year - birthYear;
            const rate = combinedMarginalAt(simYear.year, getOrdinaryAGI(simYear, age, effTaxAt(simYear.year).filingStatus));
            weightedRateSum += rate * tradBalance;
            weightSum += tradBalance;
        }

        // Track the peak Traditional balance for the fallback (cheap — no AGI yet).
        if (tradBalance > peakBalance) {
            peakBalance = tradBalance;
            peakSimYear = simYear;
        }
    }

    if (weightSum > 0) return weightedRateSum / weightSum;

    // Fallback: Traditional drains before RMD age. Value its peak balance at the
    // marginal rate a hypothetical RMD off that balance would face. getOrdinaryAGI
    // runs only here (not per-year) since the peak's income is only needed now.
    if (!peakSimYear) return null;
    const peakAge = peakSimYear.year - birthYear;
    const otherAGI = Math.max(0, getOrdinaryAGI(peakSimYear, peakAge, effTaxAt(peakSimYear.year).filingStatus) - (peakSimYear.rmdDetails?.totalWithdrawn ?? 0));
    return combinedMarginalAt(peakSimYear.year, otherAGI + peakBalance / PEAK_RMD_DIVISOR);
}

/**
 * Ordinary AGI for a simulation year — the income that federal bracket thresholds
 * apply to, before the standard deduction. Built the way the engine's tax pipeline
 * is, so headroom/recommendation math lines up with the real projection:
 *
 * - `getGrossIncome(simYear.incomes)` excludes RMD-sourced PassiveIncomes (they're
 *   filtered out of the stored `incomes` array) and non-RMD Traditional withdrawals
 *   (those live in `cashflow.withdrawalDetail`), so both are added back here — they
 *   are ordinary income.
 * - Social Security is reduced from its full benefit to the taxable portion (≤85%).
 * - Capital gains / qualified dividends are intentionally NOT included: they're taxed
 *   on a separate schedule (`taxDetails.capitalGains`), not as ordinary income.
 *
 * Callers subtract the federal standard deduction to get bracket-space taxable income.
 *
 * @param includeConversion whether to add the year's modeled Roth conversion. Pass
 *   false (default) when estimating the room available *before* a conversion.
 */
export function getOrdinaryAGI(
    simYear: SimulationYear,
    age: number,
    filingStatus: TaxState['filingStatus'],
    includeConversion = false,
): number {
    const incomeFromObjects = TaxService.getGrossIncome(simYear.incomes, simYear.year);
    const ssBenefits = TaxService.getSocialSecurityBenefits(simYear.incomes, simYear.year);
    const preTaxDeductions = TaxService.getPreTaxExemptions(simYear.incomes, simYear.year, age);
    const rmd = simYear.rmdDetails?.totalWithdrawn ?? 0;
    const conversion = includeConversion ? (simYear.rothConversion?.amount ?? 0) : 0;

    // Non-RMD Traditional withdrawals: cross-reference withdrawalDetail (keyed by
    // account id) against this year's Traditional 401(k)/IRA accounts. RMDs are
    // not in withdrawalDetail, so this sum is already RMD-free.
    const traditionalAccountIds = new Set(
        simYear.accounts
            .filter((acc): acc is InvestedAccount =>
                acc instanceof InvestedAccount &&
                (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA'))
            .map(acc => acc.id)
    );
    let traditionalNonRMDWithdrawals = 0;
    for (const [id, amount] of Object.entries(simYear.cashflow.withdrawalDetail || {})) {
        if (traditionalAccountIds.has(id)) traditionalNonRMDWithdrawals += amount;
    }

    // AGI excluding SS is the provisional-income base for the SS-taxability calc.
    const agiExcludingSS = Math.max(
        0,
        incomeFromObjects - ssBenefits + rmd + traditionalNonRMDWithdrawals + conversion - preTaxDeductions
    );

    // Long-term capital gains are taxed on a separate schedule (not ordinary income),
    // but they DO count toward the IRS "combined income" that determines how much SS
    // is taxable — mirror the engine (YearSolver) and include them there only, not in
    // the returned ordinary AGI.
    const ltcgForProvisional = simYear.taxDetails.longTermCapitalGains ?? 0;
    const taxableSS = TaxService.getTaxableSocialSecurityBenefits(
        ssBenefits, agiExcludingSS + ltcgForProvisional, 0, filingStatus
    );
    return agiExcludingSS + taxableSS;
}

/**
 * Find years with low marginal rates suitable for Roth conversions.
 * Calculates optimal conversion amount based on retirement tax rate.
 */
export function findRothConversionWindows(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
    taxState?: TaxState
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

        // Federal tax parameters for this year + filing status.
        const filingStatus = taxState?.filingStatus ?? 'Single';
        const fedParams = TaxService.getTaxParameters(
            simYear.year,
            filingStatus,
            'federal',
            undefined,
            assumptions
        );

        // Federal params resolve for every filing status; silently skipping a
        // year would distort the analysis — crash loudly instead.
        if (!fedParams) {
            throw new Error(`No federal tax parameters for year ${simYear.year}`);
        }

        // Ordinary taxable income in the same space as the bracket thresholds
        // (i.e. post standard deduction). getOrdinaryAGI reduces SS to its taxable
        // portion and adds the RMD / Traditional withdrawals missing from
        // simYear.incomes; the conversion is excluded since we're sizing the room
        // available before converting.
        const ordinaryAGI = getOrdinaryAGI(simYear, age, filingStatus);
        const taxableIncome = Math.max(0, ordinaryAGI - fedParams.standardDeduction);

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

        // Build a complete tax base for the year so the effective rate is meaningful.
        // getGrossIncome() only counts income *objects* (work, SS, pension, passive).
        // It misses RMDs (filtered out of simYear.incomes), Roth conversions, and
        // non-RMD Traditional withdrawals — all taxed as ordinary income. Without these,
        // retirement years with big RMDs/conversions/withdrawals get tiny "income" but
        // real tax, producing nonsensical effective rates (e.g. 500%).
        const incomeFromObjects = TaxService.getGrossIncome(simYear.incomes, simYear.year);
        const conversionAmount = simYear.rothConversion?.amount ?? 0;
        const rmd = simYear.rmdDetails?.totalWithdrawn ?? 0;

        // Traditional non-RMD withdrawals: cross-reference withdrawalDetail (keyed by
        // account id) against the year's accounts to find Traditional 401(k)/IRA.
        // RMDs are not in withdrawalDetail, so this sum is already RMD-free.
        const traditionalAccountIds = new Set(
            simYear.accounts
                .filter((acc): acc is InvestedAccount =>
                    acc instanceof InvestedAccount &&
                    (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
                )
                .map(acc => acc.id)
        );
        let traditionalNonRMDWithdrawals = 0;
        for (const [id, amount] of Object.entries(simYear.cashflow.withdrawalDetail || {})) {
            if (traditionalAccountIds.has(id)) {
                traditionalNonRMDWithdrawals += amount;
            }
        }

        const grossIncome = incomeFromObjects + rmd + conversionAmount + traditionalNonRMDWithdrawals;

        const preTaxDeductions = TaxService.getPreTaxExemptions(simYear.incomes, simYear.year, age);
        const totalTax = simYear.taxDetails.fed + simYear.taxDetails.state + simYear.taxDetails.fica;
        const effectiveRate = grossIncome > 0 ? totalTax / grossIncome : 0;

        // FICA-eligible EARNED base (wages net of FICA exemptions), mirroring
        // calculateFicaTax. Pass it explicitly so the 6.2% SS / 0.9% surtax
        // thresholds key off wages, not total gross — see analyzeTaxSituation.
        const earnedBase = getFicaTaxableBase(simYear.incomes, simYear.year);
        const ssCoveredEarnedBase = simYear.incomes.some(inc => !isSSCoveredForFica(inc))
            ? getFicaTaxableBase(simYear.incomes.filter(isSSCoveredForFica), simYear.year)
            : earnedBase;

        // FICA is gated on FICA-eligible earned WAGES, NOT age — Social Security /
        // Medicare payroll tax has no age cap, so wages earned past retirement age
        // are still FICA-taxed (~7.65%). A retiree with no wages → earnedBase 0 →
        // no FICA marginal. See analyzeTaxSituation.
        const includesFICA = earnedBase > 0;

        const marginal = TaxService.getCombinedMarginalRate(
            incomeFromObjects,
            preTaxDeductions,
            taxState,
            simYear.year,
            assumptions,
            includesFICA,
            earnedBase,
            ssCoveredEarnedBase
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
// RMD Pressure Analysis
// ============================================================================

/**
 * Sum projected Traditional 401k + IRA balance for a given simulation year.
 */
function getTraditionalBalance(simYear: SimulationYear): number {
    return simYear.accounts
        .filter((acc): acc is InvestedAccount =>
            acc instanceof InvestedAccount &&
            (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
        )
        .reduce((sum, acc) => sum + acc.amount, 0);
}

/**
 * Sum Traditional 401k employee contributions for a working year (excludes employer match).
 * Returns the dollars per year that would be redirected to Roth if the user switched elections.
 */
function getTraditional401kElection(simYear: SimulationYear, age: number): number {
    return simYear.incomes
        .filter((inc): inc is WorkIncome => inc instanceof WorkIncome)
        .reduce((sum, inc) => {
            const eff = inc.getEffective401k(simYear.year, age);
            return sum + inc.getProratedAnnual(eff.preTax, simYear.year);
        }, 0);
}

/**
 * Find the bracket threshold that contains a given rate (federal). Returns the
 * upper bound of the highest bracket whose rate is at or below targetRate.
 * Used to compute the income ceiling that keeps you at or below targetRate.
 */
function getBracketCeilingForRate(
    targetRate: number,
    fedParams: { brackets: Array<{ threshold: number; rate: number }> }
): number {
    let ceiling = Infinity;
    for (let i = 0; i < fedParams.brackets.length; i++) {
        const bracket = fedParams.brackets[i];
        if (bracket.rate > targetRate) {
            // The PREVIOUS bracket's threshold is our ceiling — income up to this point
            // is taxed at <= targetRate
            ceiling = bracket.threshold;
            break;
        }
    }
    return ceiling;
}

/**
 * Analyze whether the user is on track to face a higher marginal tax rate at RMD age
 * than they pay today, suggesting they should redirect Traditional 401k contributions
 * to Roth.
 *
 * Returns null if analysis isn't applicable (no traditional balance projected, no RMD
 * year in simulation, etc.).
 */
function analyzeRMDTaxPressure(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
    taxState: TaxState
): RMDPressureAnalysis | null {
    if (simulation.length === 0 || !assumptions.milestones) return null;

    const birthYear = getBirthYear(assumptions.milestones);
    const rmdStartAge = getRMDStartAge(birthYear);
    const rmdStartYear = birthYear + rmdStartAge;

    // Find the simulation year corresponding to RMD start (or the first available year >= rmdStartAge)
    const rmdSimYear = simulation.find(s => s.year >= rmdStartYear);
    if (!rmdSimYear) return null;

    const tradBalanceAtRMD = getTraditionalBalance(rmdSimYear);
    if (tradBalanceAtRMD < RMD_PRESSURE_MIN_BALANCE) return null;

    // Estimated first RMD: prefer the simulation's actual rmdDetails if present,
    // otherwise derive from balance / distribution period
    const estimatedFirstRMD = rmdSimYear.rmdDetails?.totalRMD
        ?? (tradBalanceAtRMD / getDistributionPeriod(rmdStartAge));

    // Current year (first sim year) marginal — exclude FICA so it's comparable to retirement
    const currentSimYear = simulation[0];
    const currentAge = currentSimYear.year - birthYear;
    const currentGross = TaxService.getGrossIncome(currentSimYear.incomes, currentSimYear.year);
    const currentPreTax = TaxService.getPreTaxExemptions(currentSimYear.incomes, currentSimYear.year, currentAge);
    const currentMarginal = TaxService.getCombinedMarginalRate(
        currentGross, currentPreTax, taxState, currentSimYear.year, assumptions, false
    );

    // RMD-age marginal — also exclude FICA (RMDs/SS aren't FICA-taxed)
    const rmdAge = rmdSimYear.year - birthYear;
    const rmdGross = TaxService.getGrossIncome(rmdSimYear.incomes, rmdSimYear.year);
    const rmdPreTax = TaxService.getPreTaxExemptions(rmdSimYear.incomes, rmdSimYear.year, rmdAge);
    const rmdMarginal = TaxService.getCombinedMarginalRate(
        rmdGross, rmdPreTax, taxState, rmdSimYear.year, assumptions, false
    );

    const federalBracketGap = rmdMarginal.federal - currentMarginal.federal;
    const hasPressure = federalBracketGap >= RMD_PRESSURE_MIN_GAP;

    // Switchover year analysis (only meaningful if there's pressure)
    let switchoverYear: number | null = null;
    let switchoverAge: number | null = null;
    let estimatedTaxImpact: number | null = null;
    let redirectedContributions: number | null = null;

    if (hasPressure) {
        const result = findSwitchoverYear(
            simulation, assumptions, taxState,
            tradBalanceAtRMD, currentMarginal.federal, rmdSimYear, rmdStartAge
        );
        switchoverYear = result.year;
        switchoverAge = result.age;
        estimatedTaxImpact = result.estimatedTaxImpact;
        redirectedContributions = result.redirectedContributions;
    }

    return {
        hasPressure,
        currentOrdinaryRate: currentMarginal.combined,
        currentFederalBracket: currentMarginal.federal,
        rmdStartAge,
        rmdStartYear: rmdSimYear.year,
        traditionalBalanceAtRMD: tradBalanceAtRMD,
        estimatedFirstRMD,
        rmdAgeOrdinaryRate: rmdMarginal.combined,
        rmdAgeFederalBracket: rmdMarginal.federal,
        federalBracketGap,
        switchoverYear,
        switchoverAge,
        estimatedTaxImpact,
        redirectedContributions
    };
}

/**
 * Find the latest working year where switching from Traditional to Roth would
 * bring projected RMD-age federal marginal rate down to (or below) the current rate.
 *
 * Returns { year: null, ... } if no amount of switching closes the gap, or if there
 * are no Traditional 401k contributions to redirect.
 */
function findSwitchoverYear(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    currentTradAtRMD: number,
    currentFederalRate: number,
    rmdSimYear: SimulationYear,
    rmdStartAge: number
): { year: number | null; age: number | null; estimatedTaxImpact: number | null; redirectedContributions: number | null } {
    const birthYear = getBirthYear(assumptions.milestones);
    const ror = (assumptions.investments?.returnRates?.ror ?? (FALLBACK_GROWTH_RATE * 100)) / 100;

    // Collect Traditional 401k contributions per working year
    const contributions: { year: number; age: number; amount: number; fvAtRMD: number }[] = [];
    for (const simYear of simulation) {
        const age = simYear.year - birthYear;
        if (age >= rmdStartAge) break;
        const tradContrib = getTraditional401kElection(simYear, age);
        if (tradContrib > 0) {
            const yearsToRMD = (birthYear + rmdStartAge) - simYear.year;
            const fv = tradContrib * Math.pow(1 + ror, Math.max(0, yearsToRMD));
            contributions.push({ year: simYear.year, age, amount: tradContrib, fvAtRMD: fv });
        }
    }
    if (contributions.length === 0) {
        return { year: null, age: null, estimatedTaxImpact: null, redirectedContributions: null };
    }

    // Compute target balance: balance such that resulting RMD income keeps marginal at currentFederalRate
    const fedParams = TaxService.getTaxParameters(
        rmdSimYear.year, taxState.filingStatus, 'federal', undefined, assumptions
    );
    if (!fedParams) {
        return { year: null, age: null, estimatedTaxImpact: null, redirectedContributions: null };
    }

    const rmdAge = rmdSimYear.year - birthYear;
    const rmdGross = TaxService.getGrossIncome(rmdSimYear.incomes, rmdSimYear.year);
    const rmdPreTax = TaxService.getPreTaxExemptions(rmdSimYear.incomes, rmdSimYear.year, rmdAge);
    const rmdTaxableIncome = Math.max(0, rmdGross - rmdPreTax - fedParams.standardDeduction);

    // The current first-RMD is part of rmdTaxableIncome. Estimate non-RMD income.
    const currentFirstRMD = rmdSimYear.rmdDetails?.totalRMD
        ?? (currentTradAtRMD / getDistributionPeriod(rmdStartAge));
    const nonRMDTaxableIncome = Math.max(0, rmdTaxableIncome - currentFirstRMD);

    // Income ceiling that keeps marginal at currentFederalRate
    const targetIncomeCeiling = getBracketCeilingForRate(currentFederalRate, fedParams);
    if (targetIncomeCeiling === Infinity) {
        // Already in top bracket — switching doesn't help
        return { year: null, age: null, estimatedTaxImpact: null, redirectedContributions: null };
    }

    const targetRMD = Math.max(0, targetIncomeCeiling - nonRMDTaxableIncome);
    const targetBalance = targetRMD * getDistributionPeriod(rmdStartAge);
    const requiredReduction = currentTradAtRMD - targetBalance;

    if (requiredReduction <= 0) {
        // Already below target — no need to switch
        return { year: null, age: null, estimatedTaxImpact: null, redirectedContributions: null };
    }

    // Total possible reduction = sum of all FV at RMD
    const totalPossibleReduction = contributions.reduce((s, c) => s + c.fvAtRMD, 0);
    if (totalPossibleReduction < requiredReduction) {
        // Even switching all years isn't enough — recommend switching from current year
        const total = contributions.reduce((s, c) => s + c.amount, 0);
        return {
            year: contributions[0].year,
            age: contributions[0].age,
            estimatedTaxImpact: estimateLifetimeTaxImpact(totalPossibleReduction, currentFederalRate, rmdSimYear, fedParams, nonRMDTaxableIncome, rmdStartAge),
            redirectedContributions: total
        };
    }

    // Find the largest k such that sum(fvAtRMD for years >= k) >= requiredReduction.
    // Since contributions are ordered by year ascending, suffix sums decrease as we move forward.
    // Iterate from the latest year back; once suffix sum >= requiredReduction, that's our answer.
    let suffixSum = 0;
    let switchoverIdx = 0;
    for (let i = contributions.length - 1; i >= 0; i--) {
        suffixSum += contributions[i].fvAtRMD;
        if (suffixSum >= requiredReduction) {
            switchoverIdx = i;
            break;
        }
    }

    const switchYear = contributions[switchoverIdx].year;
    const switchAge = contributions[switchoverIdx].age;
    const totalRedirected = contributions.slice(switchoverIdx).reduce((s, c) => s + c.amount, 0);
    const reductionAtSwitch = contributions.slice(switchoverIdx).reduce((s, c) => s + c.fvAtRMD, 0);
    const taxImpact = estimateLifetimeTaxImpact(
        reductionAtSwitch, currentFederalRate, rmdSimYear, fedParams, nonRMDTaxableIncome, rmdStartAge
    );

    return {
        year: switchYear,
        age: switchAge,
        estimatedTaxImpact: taxImpact,
        redirectedContributions: totalRedirected
    };
}

/**
 * Rough estimate of lifetime tax savings from reducing the Traditional balance at RMD
 * by `reduction`. Assumes the reduced RMDs would have been taxed at the higher of
 * (currentFederalRate, marginal at the reduced RMD level).
 *
 * This is a single-year estimate scaled by remaining life expectancy at RMD age.
 * Intentionally simple — the recommendation says "approximate".
 */
function estimateLifetimeTaxImpact(
    reduction: number,
    currentFederalRate: number,
    rmdSimYear: SimulationYear,
    fedParams: TaxParameters,
    nonRMDTaxableIncome: number,
    rmdStartAge: number
): number {
    // Marginal rate AT the current RMD income level
    const grossIncome = nonRMDTaxableIncome + (rmdSimYear.rmdDetails?.totalRMD ?? 0);
    const bracket = TaxService.getMarginalTaxRate(grossIncome, fedParams);
    const rateGap = Math.max(0, bracket.rate - currentFederalRate);

    // Per-year RMD reduction = reduction / distribution period
    const distPeriod = getDistributionPeriod(rmdStartAge);
    const annualRMDReduction = reduction / distPeriod;
    const annualTaxSavings = annualRMDReduction * rateGap;

    // Approximate remaining life: 90 - rmdStartAge (typical assumption)
    const yearsOfRMDs = Math.max(1, 90 - rmdStartAge);
    return annualTaxSavings * yearsOfRMDs;
}

/**
 * Generate a recommendation flagging RMD tax pressure and suggesting Roth contributions.
 */
function generateRMDPressureRecommendation(
    pressure: RMDPressureAnalysis | null
): TaxRecommendation | null {
    if (!pressure || !pressure.hasPressure) return null;

    const currentPct = (pressure.currentFederalBracket * 100).toFixed(0);
    const rmdPct = (pressure.rmdAgeFederalBracket * 100).toFixed(0);
    const impact: RecommendationImpact =
        pressure.federalBracketGap >= RMD_PRESSURE_HIGH_GAP ? 'high' : 'medium';

    const balanceStr = '$' + Math.round(pressure.traditionalBalanceAtRMD).toLocaleString();
    const rmdStr = '$' + Math.round(pressure.estimatedFirstRMD).toLocaleString();

    const actionItems: string[] = [
        `At age ${pressure.rmdStartAge}, projected Traditional balance: ${balanceStr}`,
        `Required minimum distribution: ~${rmdStr}/year (taxed as ordinary income)`,
        `Current federal rate: ${currentPct}%  →  projected RMD-age rate: ${rmdPct}%`
    ];

    if (pressure.switchoverYear && pressure.switchoverAge) {
        const yearsAway = pressure.switchoverYear - new Date().getFullYear();
        const yearLabel = yearsAway <= 0
            ? 'now'
            : `starting in ${pressure.switchoverYear} (age ${pressure.switchoverAge})`;
        actionItems.push(`Switch 401(k) elections from Traditional to Roth ${yearLabel}`);
        if (pressure.redirectedContributions && pressure.redirectedContributions > 0) {
            actionItems.push(`This redirects ~$${Math.round(pressure.redirectedContributions).toLocaleString()} of total Traditional contributions to Roth`);
        }
    } else {
        actionItems.push(`Switch 401(k) elections from Traditional to Roth now`);
    }

    return {
        id: 'rmd-tax-pressure',
        title: 'Switch to Roth 401(k) Contributions',
        description: `Your current marginal rate (${currentPct}%) is well below your projected ` +
            `rate at RMD age (${rmdPct}%). Roth contributions today avoid that future tax.`,
        category: 'contribution',
        impact,
        estimatedAnnualSavings: pressure.estimatedTaxImpact && pressure.estimatedTaxImpact > 0
            ? Math.round(pressure.estimatedTaxImpact)
            : 0,
        actionItems
    };
}

// ============================================================================
// Roth/Pre-Tax Allocation Diagnostic (current contributions)
// ============================================================================

export type AllocationVerdict =
    | 'optimal'           // Current split is correct given the rate gap
    | 'should-be-roth'    // Currently mostly pre-tax but should be Roth
    | 'should-be-pretax'  // Currently mostly Roth but should be pre-tax
    | 'lean-roth'         // Already mostly Roth — fine, but consider going further
    | 'lean-pretax'       // Already mostly pre-tax — fine, but consider going further
    | 'either-fine';      // Rates are close enough that either choice works

export interface RothPreTaxAllocation {
    /** Current 401(k) employee contribution split for this year */
    current401kSplit: { preTax: number; roth: number };
    /** Total current 401(k) employee contributions */
    totalContribution: number;
    /** Roth fraction of current contributions (0..1) */
    rothFraction: number;
    /** Today's combined fed+state ordinary marginal rate (excludes FICA) */
    currentRate: number;
    /** Projected combined fed+state ordinary marginal rate at first RMD year (or median retirement if no RMDs) */
    futureRate: number;
    /** Whether the future rate is the actual first RMD year (vs a fallback) */
    futureRateBasis: 'rmd-year' | 'median-retirement';
    /** futureRate - currentRate */
    rateGap: number;
    verdict: AllocationVerdict;
}

/**
 * Analyze the user's current Roth vs Pre-Tax 401(k) split and produce a verdict.
 *
 * Returns null when the diagnostic doesn't apply (no work income with 401(k)
 * contributions in the current year).
 *
 * The comparison is "today's marginal rate on a deductible contribution" vs
 * "the marginal rate that would apply when those Traditional dollars come back
 * out as RMDs" — both fed+state, excluding FICA (FICA applies to wages but
 * not to RMDs, and 401(k) contributions don't avoid FICA).
 */
export function analyzeRothPreTaxAllocation(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
    taxState: TaxState
): RothPreTaxAllocation | null {
    if (simulation.length === 0 || !assumptions.milestones) return null;

    const currentSimYear = simulation[0];
    const birthYear = getBirthYear(assumptions.milestones);
    const age = currentSimYear.year - birthYear;

    // Sum current 401(k) employee contributions across all WorkIncomes
    let preTax = 0;
    let roth = 0;
    for (const inc of currentSimYear.incomes) {
        if (inc instanceof WorkIncome) {
            const eff = inc.getEffective401k(currentSimYear.year, age);
            preTax += inc.getProratedAnnual(eff.preTax, currentSimYear.year);
            roth += inc.getProratedAnnual(eff.roth, currentSimYear.year);
        }
    }
    const total = preTax + roth;
    if (total <= 0) return null;

    // Today's marginal rate (fed + state, no FICA — 401(k) contributions don't avoid FICA)
    const currentGross = TaxService.getGrossIncome(currentSimYear.incomes, currentSimYear.year);
    const currentPreTax = TaxService.getPreTaxExemptions(currentSimYear.incomes, currentSimYear.year, age);
    const currentMarginal = TaxService.getCombinedMarginalRate(
        currentGross, currentPreTax, taxState, currentSimYear.year, assumptions, false
    );

    // Future rate: prefer first RMD year. Fall back to median retirement rate.
    const rmdStartAge = getRMDStartAge(birthYear);
    const rmdSimYear = simulation.find(s => s.year - birthYear >= rmdStartAge);

    let futureRate: number;
    let futureRateBasis: RothPreTaxAllocation['futureRateBasis'];
    if (rmdSimYear) {
        const rmdAge = rmdSimYear.year - birthYear;
        const rmdGross = TaxService.getGrossIncome(rmdSimYear.incomes, rmdSimYear.year);
        const rmdPreTax = TaxService.getPreTaxExemptions(rmdSimYear.incomes, rmdSimYear.year, rmdAge);
        const rmdMarginal = TaxService.getCombinedMarginalRate(
            rmdGross, rmdPreTax, taxState, rmdSimYear.year, assumptions, false
        );
        futureRate = rmdMarginal.combined;
        futureRateBasis = 'rmd-year';
    } else {
        const retirementAge = getRetirementAge(assumptions.milestones);
        const retirementYear = birthYear + retirementAge;
        futureRate = getMedianRetirementTaxRate(simulation, retirementYear);
        futureRateBasis = 'median-retirement';
    }

    const rateGap = futureRate - currentMarginal.combined;
    const rothFraction = roth / total;

    let verdict: AllocationVerdict;
    const SIGNIFICANT_GAP = 0.02; // 2 percentage points
    if (Math.abs(rateGap) < SIGNIFICANT_GAP) {
        verdict = 'either-fine';
    } else if (rateGap > 0) {
        // Future > today → Roth wins
        if (rothFraction >= 0.95) verdict = 'optimal';
        else if (rothFraction >= 0.5) verdict = 'lean-roth';
        else verdict = 'should-be-roth';
    } else {
        // Today > future → Pre-Tax wins
        if (rothFraction <= 0.05) verdict = 'optimal';
        else if (rothFraction <= 0.5) verdict = 'lean-pretax';
        else verdict = 'should-be-pretax';
    }

    return {
        current401kSplit: { preTax, roth },
        totalContribution: total,
        rothFraction,
        currentRate: currentMarginal.combined,
        futureRate,
        futureRateBasis,
        rateGap,
        verdict
    };
}

// ============================================================================
// Conversion Plan Diagnostic
// ============================================================================

export interface ConversionScheduleEntry {
    year: number;
    age: number;
    amount: number;
    /** Combined federal + state tax increase from the conversion. FICA excluded (conversions aren't FICA-taxed). */
    taxCost: number;
    /** Combined fed + state marginal rate at the top of the conversion */
    marginalRate: number;
    /** Federal-only tax cost (for debugging) */
    federalTaxCost: number;
    /** State-only tax cost (for debugging) */
    stateTaxCost: number;
    /** Traditional 401(k) + IRA balance at the start of this year (for debugging) */
    traditionalBalanceStart: number;
    /** What the V2 solver was targeting and any limiting factor (for debugging) */
    limitingFactor: string | null;
    /** Bracket space available this year, before conversion (for debugging) */
    bracketSpaceAvailable: number | null;
    /** Target bracket ceiling the solver was aiming to fill (0..1, e.g. 0.22 = 22%). Null if no V2 target */
    targetBracketCeiling: number | null;
    /** Projected Traditional balance at RMD age given the current trajectory */
    projectedBalanceAtRMD: number | null;
}

export interface ConversionPlan {
    /** True if auto-conversions are active and producing a schedule */
    hasActiveSchedule: boolean;
    /** Schedule entries (only populated when hasActiveSchedule is true) */
    schedule: ConversionScheduleEntry[];
    /** Total dollars converted across all years */
    totalConverted: number;
    /** Total tax paid on conversions */
    totalTaxCost: number;
    /** First and last conversion ages (only when schedule is populated) */
    firstAge: number | null;
    lastAge: number | null;

    /** Estimated lifetime tax savings if conversions WERE turned on (for the teaser) */
    estimatedLifetimeSavings: number | null;
    /** Number of upcoming low-tax years where conversions would help */
    numLowTaxYears: number;
}

/**
 * Inspect the simulation for Roth conversion activity and / or estimate the
 * opportunity if conversions are not currently running.
 *
 * Returns null if the user has no Traditional balance (nothing to convert).
 */
export function analyzeConversionPlan(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
    taxState: TaxState
): ConversionPlan | null {
    if (simulation.length === 0 || !assumptions.milestones) return null;

    // Skip if no Traditional balance to work with
    if (!hasTraditionalRetirementBalance(simulation)) return null;

    const birthYear = getBirthYear(assumptions.milestones);

    // Collect any actual Roth conversions from the simulation (auto or manual).
    // Read federalTaxCost / stateTaxCost directly from the simulation rather than
    // recomputing — the engine is the source of truth.
    const schedule: ConversionScheduleEntry[] = [];
    let totalConverted = 0;
    let totalTaxCost = 0;
    for (let i = 0; i < simulation.length; i++) {
        const simYear = simulation[i];
        const conv = simYear.rothConversion;
        if (!conv || conv.amount <= 0) continue;

        const age = simYear.year - birthYear;
        const federalTaxCost = conv.federalTaxCost;
        const stateTaxCost = conv.stateTaxCost;
        const combinedTaxCost = federalTaxCost + stateTaxCost;

        // Marginal rates: derived from bracket lookups against the year's taxable income
        // INCLUDING the conversion. Conversions aren't stored as Income objects, so
        // getGrossIncome doesn't account for them — we have to add conv.amount manually
        // for the marginal lookup to reflect "the rate at the top of this year's conversion".
        // (Bracket lookup is direct math — no duplication of tax-cost logic.)
        const grossIncome = TaxService.getGrossIncome(simYear.incomes, simYear.year);
        const preTaxDeductions = TaxService.getPreTaxExemptions(simYear.incomes, simYear.year, age);
        const grossWithConversion = grossIncome + conv.amount;

        let federalMarginal = 0;
        const fedParams = TaxService.getTaxParameters(
            simYear.year, taxState.filingStatus, 'federal', undefined, assumptions
        );
        if (fedParams) {
            const fedTaxableIncome = Math.max(0, grossWithConversion - preTaxDeductions - fedParams.standardDeduction);
            federalMarginal = TaxService.getMarginalTaxRate(fedTaxableIncome, fedParams).rate;
        }

        let stateMarginal = 0;
        const stateParams = TaxService.getTaxParameters(
            simYear.year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions
        );
        if (stateParams) {
            const stateTaxableIncome = Math.max(0, grossWithConversion - preTaxDeductions - (stateParams.standardDeduction || 0));
            stateMarginal = TaxService.getMarginalTaxRate(stateTaxableIncome, stateParams).rate;
        }
        const combinedMarginal = federalMarginal + stateMarginal;

        // Debug: traditional balance at start of year (prior year's ending balance, or current if first year)
        const priorYear = i > 0 ? simulation[i - 1] : null;
        const traditionalBalanceStart = priorYear
            ? getTraditionalBalance(priorYear)
            : getTraditionalBalance(simYear);

        // Debug: solver-reported bracket diagnostics
        const target = simYear.taxOptimizationTarget;
        const limitingFactor = target?.limitingFactor ?? null;
        const bracketSpaceAvailable = target?.bracketSpaceThisYear ?? null;
        const targetBracketCeiling = target?.targetBracketCeiling ?? null;
        const projectedBalanceAtRMD = target?.projectedBalanceAtRMD ?? null;

        schedule.push({
            year: simYear.year,
            age,
            amount: conv.amount,
            taxCost: combinedTaxCost,
            marginalRate: combinedMarginal,
            federalTaxCost,
            stateTaxCost,
            traditionalBalanceStart,
            limitingFactor,
            bracketSpaceAvailable,
            targetBracketCeiling,
            projectedBalanceAtRMD
        });
        totalConverted += conv.amount;
        totalTaxCost += combinedTaxCost;
    }
    const hasActiveSchedule = schedule.length > 0;
    const firstAge = hasActiveSchedule ? schedule[0].age : null;
    const lastAge = hasActiveSchedule ? schedule[schedule.length - 1].age : null;

    // If a schedule is already running, no need to estimate the teaser opportunity
    if (hasActiveSchedule) {
        return {
            hasActiveSchedule,
            schedule,
            totalConverted,
            totalTaxCost,
            firstAge,
            lastAge,
            estimatedLifetimeSavings: null,
            numLowTaxYears: 0
        };
    }

    // No active schedule — estimate the opportunity for the teaser
    const windows = findRothConversionWindows(simulation, assumptions, taxState);
    if (windows.length === 0) {
        return {
            hasActiveSchedule: false,
            schedule: [],
            totalConverted: 0,
            totalTaxCost: 0,
            firstAge: null,
            lastAge: null,
            estimatedLifetimeSavings: 0,
            numLowTaxYears: 0
        };
    }

    // Estimate savings: for each window, the gap between the conversion-year rate
    // and the projected retirement rate, applied to the optimal conversion amount.
    // This is intentionally rough — we surface it as "approximately".
    const retirementAge = getRetirementAge(assumptions.milestones);
    const retirementYear = birthYear + retirementAge;
    const retirementRate = getMedianRetirementTaxRate(simulation, retirementYear);

    const estimatedLifetimeSavings = windows.reduce((sum, w) => {
        const rateGap = Math.max(0, retirementRate - w.marginalRate);
        return sum + w.optimalConversionAmount * rateGap;
    }, 0);

    return {
        hasActiveSchedule: false,
        schedule: [],
        totalConverted: 0,
        totalTaxCost: 0,
        firstAge: null,
        lastAge: null,
        estimatedLifetimeSavings,
        numLowTaxYears: windows.length
    };
}

// ============================================================================
// Helper Functions (exported for testing)
// ============================================================================

export function get401kContributions(incomes: AnyIncome[], year: number, age?: number): number {
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

export function getHSAContributions(incomes: AnyIncome[], year: number): number {
    return incomes
        .filter((inc): inc is WorkIncome => inc instanceof WorkIncome)
        .reduce((sum, inc) => {
            return sum + inc.getProratedAnnual(inc.hsaContribution, year);
        }, 0);
}

export function generate401kRecommendation(analysis: TaxAnalysis): TaxRecommendation | null {
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

export function generateHSARecommendation(analysis: TaxAnalysis): TaxRecommendation | null {
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

export function generateBracketRecommendation(analysis: TaxAnalysis): TaxRecommendation | null {
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

export function generateRothConversionRecommendation(
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
