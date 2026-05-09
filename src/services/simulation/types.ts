import { AnyAccount } from "../../components/Objects/Accounts/models";
import { AnyExpense } from "../../components/Objects/Expense/models";
import { AnyIncome } from "../../components/Objects/Income/models";
import { WithdrawalResult, GuardrailTrigger } from "../WithdrawalStrategies";
import { RMDCalculation } from "../../data/RMDData";

/**
 * Per-source income line for cashflow display.
 * `kind` mirrors what classifyIncome would assign.
 */
export type CashflowIncomeKind = 'work' | 'ss' | 'pension' | 'passive' | 'reinvested' | 'rmd';

export interface CashflowIncomeSource {
    name: string;
    amount: number;
    kind: CashflowIncomeKind;
    /** For reinvested passive income: the account that holds the reinvested cash. */
    accountName?: string;
}

/**
 * Detailed cashflow breakdown the simulation has already computed but
 * historically wasn't surfaced. The Sankey chart uses these values directly
 * instead of re-deriving them from raw incomes/expenses (which led to drift).
 */
export interface CashflowDetail {
    /** Per-source income lines (post earnings test, post-classification). */
    incomeBySource: CashflowIncomeSource[];
    /** Pre-tax 401k contributions, summed across active work incomes. */
    userPreTax401k: number;
    /** Roth 401k contributions, summed across active work incomes. */
    userRoth401k: number;
    /** Employer match flowing into Traditional accounts. */
    employerMatchPreTax: number;
    /** Employer match flowing into Roth accounts (rare). */
    employerMatchRoth: number;
    /** Insurance payroll deduction (mirror of taxDetails.insurance). */
    insurance: number;
    /** Mortgage principal portion of total mortgage payment. */
    mortgagePrincipal: number;
    /** Mortgage interest + escrow portion of total mortgage payment. */
    mortgageInterestEscrow: number;
    /** Living expense totals by category (excludes mortgage; mortgage is split above). */
    expensesByCategory: Record<string, number>;
    /**
     * Long-term capital gains tax that the planner withheld from a brokerage/ESPP
     * gross-up. Conceptually this dollar amount never reached the user — the
     * brokerage routes it directly to the government when sizing the gross-up.
     *
     * Equals `sum(w.tax)` over withdrawals with `capitalGains` set. The Sankey
     * chart subtracts this from gross withdrawals on the inflow side so it
     * doesn't appear as residual "remaining" cash; SimulationEngine subtracts it
     * from `totalCashAvailable` when computing `trueUserSaved`, mirroring
     * YearSolver Step F's `actualLTCGTax` subtraction in `cashIn`.
     *
     * Zero when planner LTCG rate is 0 (low ordinary income) since no gross-up
     * was applied; auth LTCG in that case is captured by `unfundedDeficit`.
     */
    brokerageLTCGFromGross: number;
}

// Define the shape of a single year's result
export interface SimulationYear {
    year: number;
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    accounts: AnyAccount[];
    cashflow: {
        totalIncome: number;
        totalExpense: number; // Taxes + Living Expenses + Payroll Deductions
        livingExpenses: number; // Living expenses only (excluding taxes)
        discretionary: number; // Unspent cash
        investedUser: number;  // User contributions + Saved Cash
        investedMatch: number; // Employer Match
        totalInvested: number; // Sum
        bucketAllocations: number; // Priority Bucket contributions
        bucketDetail: Record<string, number>; // Breakdown
        withdrawals: number; // Total withdrawn from accounts
        withdrawalDetail: Record<string, number>; // Per-account breakdown
    };
    /** Detailed breakdown for the cashflow Sankey chart. */
    cashflowDetail?: CashflowDetail;
    taxDetails: {
        fed: number; // Federal income tax + early-withdrawal penalty (penalty is also broken out in earlyWithdrawalPenalty)
        state: number;
        fica: number;
        preTax: number;
        insurance: number;
        postTax: number;
        capitalGains: number; // Capital gains tax on brokerage/ESPP withdrawals only
        withdrawalOrdinaryTax: number; // Tax on Roth earnings (5-year rule), Traditional, HSA non-medical
        niit: number; // Net Investment Income Tax (3.8%)
        earlyWithdrawalPenalty?: number; // 10% early-withdrawal penalty (Traditional pre-59.5, Roth conversion 5-year rule). Already included in `fed`; surfaced separately for diagnostics.
        longTermCapitalGains?: number; // LTCG amount realized this year (for AGI-equivalent denominator in effective-rate calcs). Surfaces WithdrawalState.longTermCapitalGains.
    };
    logs: string[];
    // Withdrawal strategy tracking (for multi-year calculations)
    strategyWithdrawal?: WithdrawalResult;
    // Guyton-Klinger strategy adjustment tracking
    strategyAdjustment?: {
        guardrailTriggered: GuardrailTrigger;
        requiredAdjustment: number;      // $ amount GK wants to cut/add
        actualAdjustment: number;        // $ amount actually cut/added
        discretionaryAvailable: number;  // $ of discretionary expenses available
        warning?: string;                // Warning if cut couldn't be fully applied
    };
    // Auto Roth conversion tracking
    rothConversion?: {
        amount: number;                  // Total amount converted
        taxCost: number;                 // Tax paid on conversion (legacy: fed-only in V1, fed+state in V2 — prefer federalTaxCost/stateTaxCost)
        federalTaxCost: number;          // Federal-only tax increase from the conversion
        stateTaxCost: number;            // State-only tax increase from the conversion
        taxAfter: number;               // Total federal tax after conversion
        fromAccounts: Record<string, number>;  // Amount from each Traditional account (by name)
        toAccounts: Record<string, number>;    // Amount to each Roth account (by name)
        fromAccountIds: Record<string, number>;  // Amount from each Traditional account (by id)
        toAccountIds: Record<string, number>;    // Amount to each Roth account (by id)
    };
    // Required Minimum Distribution tracking
    rmdDetails?: {
        totalRMD: number;                         // Total RMD required this year
        totalWithdrawn: number;                   // Actual amount withdrawn for RMD
        accountBreakdown: RMDCalculation[];       // Per-account RMD details
        shortfall: number;                        // Amount not withdrawn (if any)
        penalty: number;                          // 25% penalty on shortfall
    };
    // Milestone tracking
    milestoneEvents?: MilestoneReachEvent[];      // Milestones reached this year
    activeMilestones?: string[];                   // All milestone IDs reached so far
    taxOptimizationTarget?: TaxOptimizationTarget;
    // Marks a synthetic "projected end of current year" data point inserted between Year 0 and Year 1
    isEndOfYearProjection?: boolean;
}

// Internal withdrawal tracking state passed between simulation phases
export interface WithdrawalState {
    userInflows: Record<string, number>;
    employerInflows: Record<string, number>;
    withdrawalTaxes: number;
    capitalGainsTaxTotal: number; // Capital gains tax from brokerage/ESPP withdrawals only
    withdrawalOrdinaryTaxTotal: number; // Tax from Roth earnings (5-year rule), Traditional, HSA non-medical
    strategyWithdrawalExecuted: number;
    totalWithdrawals: number;
    withdrawalDetail: Record<string, number>;
    withdrawalPenalties: number;
    totalGrossIncome: number;
    // Capital gains tracking
    longTermCapitalGains: number;
    shortTermCapitalGains: number;
    stateCapitalGainsTax: number;
    // Traditional withdrawal tracking for tax calculations
    traditionalWithdrawals: number;
}

// Milestone-based trigger types
export type MilestoneOperator = '>=' | '<=' | '=' | '>' | '<';

export type MilestoneConditionType =
    | 'NET_WORTH'              // Total assets - liabilities
    | 'LIQUID_NET_WORTH'       // Brokerage + Savings only (not retirement accounts)
    | 'TOTAL_DEBT'             // All debt accounts + loan balances
    | 'YEAR'                   // Fixed calendar year
    | 'AGE';                   // User's age

// What the right side of the condition compares against
export type MilestoneValueType =
    | 'FIXED'                  // Just a number (default)
    | 'EXPENSES'               // value × annual expenses (e.g., 25x for 4% rule) - living expenses only
    | 'EXPENSES_GROSSED_UP'    // value × (expenses / (1 - tax_rate)) - includes estimated taxes
    | 'MILESTONE_PLUS';        // milestone year/age + value offset

export interface MilestoneCondition {
    type: MilestoneConditionType;
    operator: MilestoneOperator;
    value: number;
    valueType?: MilestoneValueType;        // Default 'FIXED' for backwards compatibility
    referenceMilestoneId?: string;         // For MILESTONE_PLUS - which milestone to reference
}

export interface CustomMilestone {
    id: string;
    name: string;                      // "Coast FIRE", "Debt Free", etc.
    conditions: MilestoneCondition[];  // All must be met (AND logic)
    color?: string;                    // For timeline display
}

export interface MilestoneReachEvent {
    milestoneId: string;
    yearReached: number;
    ageReached: number;
}

/**
 * Baseline projections extracted from a deterministic simulation run.
 * Used to inform Roth conversion ceiling calculations.
 */
export interface BaselineProjections {
    /** Total Traditional balance at RMD start age */
    traditionalBalanceAtRMD: number;
    /** Projected Social Security income at RMD age (with COLA) */
    ssAtRMD: number;
    /** Projected pension income at RMD age (with COLA) */
    pensionAtRMD: number;
    /** Projected passive income at RMD age (rental, dividends, interest, etc. — excludes RMDs) */
    passiveAtRMD: number;
    /** The year when RMDs start */
    rmdYear: number;
}

// =============================================================================
// YEAR SOLVER TYPES (v2 Rewrite)
// =============================================================================

/**
 * Income classified by spendability for deficit calculation.
 */
export interface ClassifiedIncome {
    /** Cash available for expenses (work, SS, pensions, RMDs, rental) */
    spendable: number;
    /** Goes back into accounts, not available for spending (reinvested dividends) */
    reinvested: number;
    /** Required distributions - always spendable and taxable */
    rmdIncome: number;
    /** Roth conversions - taxable but NOT spendable (it's a transfer) */
    conversionIncome: number;
    /** Everything that appears on tax return */
    taxableTotal: number;
    /** Breakdown by source for logging/debugging */
    breakdown: {
        wages: number;
        socialSecurity: number;
        pensions: number;
        passive: number;
        rmd: number;
        reinvested: number;
    };
}

/**
 * Decision log entry for transparency.
 */
export interface DecisionLogEntry {
    category: 'withdrawal' | 'conversion' | 'contribution' | 'surplus' | 'tax' | 'rmd' | 'warning' | 'spending';
    account?: string;
    amount?: number;
    description: string;
}

/**
 * Tax payment source for conversions.
 */
export type ConversionTaxSource = 'SURPLUS' | 'BROKERAGE' | 'WITHHOLD';

/**
 * Account type for withdrawals.
 */
export type WithdrawalAccountType =
    | 'savings'
    | 'brokerage'
    | 'traditional_401k'
    | 'traditional_ira'
    | 'roth_401k'
    | 'roth_ira'
    | 'hsa'
    | 'espp';

/**
 * Individual planned withdrawal from an account.
 */
export interface PlannedWithdrawal {
    /** Account type for tax treatment */
    source: WithdrawalAccountType;
    /** Account ID */
    accountId: string;
    /** Account name (for logging) */
    accountName: string;
    /** Gross amount withdrawn */
    gross: number;
    /** Net amount received after tax/penalty */
    net: number;
    /** Capital gains breakdown (for brokerage/ESPP) */
    capitalGains?: {
        shortTerm: number;
        longTerm: number;
    };
    /** Early withdrawal penalty (if under 59.5) */
    penalty: number;
    /** Tax on this withdrawal */
    tax: number;
    /** Reason for withdrawal */
    reason: 'Required Minimum Distribution' | 'Spending deficit' | 'Conversion tax' | 'Healthcare expense' | 'ACA cliff Roth substitution';
}

/**
 * Planned Roth conversion.
 */
export interface PlannedConversion {
    /** Amount converted */
    amount: number;
    /** Source Traditional account ID */
    fromAccountId: string;
    /** Target Roth account ID */
    toAccountId: string;
    /** How the conversion tax is paid */
    taxSource: ConversionTaxSource;
    /** Total tax cost of conversion (federal + state + ACA subsidy lost) */
    taxAmount: number;
    /** Federal-only portion of the conversion tax (ordinary + SS torpedo + LTCG bump + NIIT) */
    federalTaxCost: number;
    /** State-only portion of the conversion tax */
    stateTaxCost: number;
    /** Net amount going to Roth (= amount when SURPLUS/BROKERAGE, < amount when WITHHOLD) */
    netToRoth: number;
    /** Reason/explanation */
    reason: string;
}

/**
 * Planned contribution (working years).
 */
export interface PlannedContribution {
    /** Account ID */
    accountId: string;
    /** Amount contributed */
    amount: number;
    /** Contribution type */
    type: 'employee_pretax' | 'employee_roth' | 'employer_match' | 'espp' | 'roth_ira' | 'savings';
}

/**
 * Planned surplus allocation.
 */
export interface PlannedSurplusAllocation {
    /** Account ID */
    accountId: string;
    /** Amount allocated */
    amount: number;
    /** Reason for allocation */
    reason: string;
}

/**
 * Tax summary for the year.
 */
export interface YearPlanTax {
    federal: number;
    state: number;
    fica: number;
    capitalGainsLT: number;
    capitalGainsST: number;
    /** Tax on Roth earnings (5-year rule), Traditional withdrawals, HSA non-medical */
    withdrawalOrdinaryTax: number;
    niit: number;
    penalties: number;
    total: number;
}

/**
 * Detailed breakdown of what's constraining Roth conversions for this year.
 * Used for debugging why conversions aren't meeting targets.
 */
export interface ConversionConstraints {
    /** Target bracket rate (e.g., 0.22 for 22%) */
    bracketCeiling: number;
    /** Dollar amount at top of target bracket */
    bracketTop: number;
    /** AGI before any conversion */
    currentAGI: number;
    /** Raw bracket space = bracketTop - currentAGI */
    rawBracketSpace: number;
    /** Amount lost to SS torpedo effect */
    ssTorpedoReduction: number;
    /** Amount lost to ACA cliff avoidance */
    acaCliffReduction: number;
    /** Final usable bracket space after all reductions */
    effectiveBracketSpace: number;
    /** Whether SS torpedo is affecting conversions */
    ssTorpedoTriggered: boolean;
    /** Whether ACA cliff avoidance is affecting conversions */
    acaCliffTriggered: boolean;
    /** Current MAGI for ACA calculation (if applicable) */
    currentMAGI?: number;
    /** ACA cliff threshold (if applicable) */
    acaCliffThreshold?: number;
    /** Brokerage gain ratio (unrealized gains / balance) — drives LTCG component of MAGI */
    brokerageGainRatio?: number;
}

/**
 * What caused the conversion limit to be reached this year.
 */
export type ConversionLimitingFactor =
    | 'BRACKET_CEILING'       // Hit target tax bracket ceiling
    | 'SS_TORPEDO'            // SS torpedo caused effective rate to spike
    | 'ACA_CLIFF'             // ACA cliff avoidance limited conversion
    | 'NO_BRACKET_SPACE'      // Already in or above target bracket
    | 'TRADITIONAL_DEPLETED'  // No Traditional balance left to convert
    | 'NOT_RETIRED'           // Not retired yet, no conversions
    | 'AT_RMD_AGE'            // At or past RMD age, no conversions
    | 'SPENDING_DEFICIT';      // Bracket space shared with Traditional spending withdrawals

/**
 * One step in the rate-match walk (debug-only).
 *
 * The rate-match walk considers each bracket from std-ded headroom upward and
 * decides whether to fill it. Each row records the inputs and decision so the
 * Roth Debug page can reproduce the algorithm's reasoning.
 */
export interface RateMatchWalkRow {
    /** Marginal rate of this chunk (0 for std-ded headroom, then bracket rates). */
    currentRate: number;
    /** Lower edge of this chunk's taxable-income window (post-stdDed). */
    chunkStart: number;
    /** Upper edge of this chunk's taxable-income window (post-stdDed). */
    chunkEnd: number;
    /** Dollars available in this chunk before the balance/cap clamp. */
    chunkSize: number;
    /** Projected RMD-year marginal rate if we convert up through this chunk. */
    futureMarginal: number;
    /** futureMarginal - currentRate (the rate gap). */
    gap: number;
    /** Decision: convert or stop. The first 'stop' row is the limiting factor. */
    decision: 'convert' | 'stop';
    /** Cumulative dollars converted including this chunk (only when decision='convert'). */
    cumulative: number;
}

/**
 * Tax optimization target information (for UI display).
 * Calculated by the V2 solver to show the user what the engine is targeting.
 */
export interface TaxOptimizationTarget {
    /** Years until RMD age */
    yearsUntilRMD: number;
    /** RMD start age */
    rmdStartAge: number;
    /** Top conversion rate the rate-match walk reached this year (e.g., 0.22) */
    targetBracketCeiling: number;
    /** Bracket space available this year */
    bracketSpaceThisYear: number;
    /** Projected SS at RMD age */
    ssAtRMD: number;
    /** Projected pension at RMD age */
    pensionAtRMD: number;
    /** Projected Traditional balance at RMD age given current conversion trajectory */
    projectedBalanceAtRMD?: number;
    /** What's limiting conversions this year */
    limitingFactor?: ConversionLimitingFactor;
    /** Detailed constraint breakdown for debugging */
    constraintDetails?: ConversionConstraints;
    /** Current Traditional balance at start of year */
    currentTraditionalBalance?: number;
    /** Actual conversion amount executed this year */
    actualConversion?: number;
    /** Bracket-by-bracket trace of the rate-match walk (for the Roth Debug page) */
    rateMatchWalk?: RateMatchWalkRow[];
}

/**
 * Complete plan for a simulation year (Phase 2 output).
 *
 * This is a PURE DATA STRUCTURE - no mutations, no side effects.
 * Phase 3 uses this to execute changes on cloned accounts.
 */
export interface YearPlan {
    /** Year being simulated */
    year: number;

    /** Whether this is a retirement year */
    isRetired: boolean;

    /** Classified income for the year */
    income: ClassifiedIncome;

    /** Planned withdrawals (includes RMDs) */
    withdrawals: PlannedWithdrawal[];

    /** Planned Roth conversion (null if none) */
    conversion: PlannedConversion | null;

    /** Planned contributions (working years) */
    contributions: PlannedContribution[];

    /** Planned surplus allocations */
    surplusAllocations: PlannedSurplusAllocation[];

    /** Amount allocated to pay down deficit debt from surplus */
    deficitDebtPayment: number;

    /** Tax summary */
    tax: YearPlanTax;

    /** Net surplus (positive) or unfunded deficit (negative) */
    surplus: number;

    /** Amount that couldn't be funded (when all accounts exhausted) */
    unfundedDeficit: number;

    /** Total living expenses for the year */
    totalExpenses: number;

    /** Spending strategy result (if applicable) */
    strategyResult?: WithdrawalResult;

    // Metadata

    /** Number of solver iterations */
    iterations: number;

    /** Whether the solver converged */
    converged: boolean;

    /** Decision log */
    decisions: DecisionLogEntry[];

    /** Tax optimization target (for UI display) */
    taxOptimizationTarget?: TaxOptimizationTarget;
}

/**
 * Account balance snapshot for withdrawal planning.
 */
export interface AccountBalanceSnapshot {
    accountId: string;
    accountName: string;
    accountType: WithdrawalAccountType;
    balance: number;
    vestedBalance: number;
    /** For brokerage: unrealized gains / balance */
    gainRatio: number;
    /** For Roth: contribution basis available for tax-free withdrawal */
    rothContributions?: number;
    /** For Roth: conversion history for 5-year rule */
    conversionHistory?: { year: number; amount: number }[];
    /** For ESPP: pre-computed per-lot disposition data */
    esppLots?: {
        lotId: string;
        shares: number;
        currentValuePerShare: number;
        purchasePricePerShare: number;
        dispositionType: 'qualifying' | 'disqualifying';
        ordinaryIncomePerShare: number;
        ltcgPerShare: number;
        totalValue: number;
    }[];
}

/**
 * Input for withdrawal planning.
 */
export interface WithdrawalPlannerInput {
    /** Net amount needed after taxes */
    netNeeded: number;
    /** Ordered list of accounts to tap (in priority order) */
    accountOrder: AccountBalanceSnapshot[];
    /** Current age for penalty calculations */
    currentAge: number;
    /** Current year */
    year: number;
    /** Current ordinary income (for marginal rate calculation) */
    currentOrdinaryIncome: number;
    /** Filing status */
    filingStatus: 'single' | 'married_filing_jointly' | 'married_filing_separately' | 'head_of_household';
    /** Federal tax parameters */
    fedParams: { brackets: { threshold: number; rate: number }[]; standardDeduction: number };
    /** State tax parameters (null if no state tax) */
    stateParams: { brackets: { threshold: number; rate: number }[]; standardDeduction: number } | null;
}

/**
 * Result from income classification.
 */
export interface IncomeClassificationResult {
    classified: ClassifiedIncome;
    logs: string[];
}
