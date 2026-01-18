import { TaxType } from "../../Objects/Accounts/models";
import { AssumptionsState } from '../Assumptions/AssumptionsContext';
import { get401kLimit, getHSALimit } from '../../../data/ContributionLimits';
import {
  calculateFERSBasicBenefit,
  calculateCSRSBasicBenefit,
  getFERSCOLA,
  getCSRSCOLA,
  checkFERSEligibility,
  checkCSRSEligibility,
  calculateFERSSupplement,
} from '../../../data/PensionData';

export type ContributionGrowthStrategy = 'FIXED' | 'GROW_WITH_SALARY' | 'TRACK_ANNUAL_MAX';
export type AutoMax401kOption = 'disabled' | 'custom' | 'traditional' | 'roth';

export type IncomeFrequency = 'Weekly' | 'Bi-Weekly' | 'Semi-Monthly' | 'Monthly' | 'Annually';

export interface Income {
  id: string;
  name: string;
  amount: number;
  frequency: IncomeFrequency;
  earned_income: "Yes" | "No";
  startDate?: Date;
  end_date?: Date;
}

// 2. Base Abstract Class
export abstract class BaseIncome implements Income {
  constructor(
    public id: string,
    public name: string,
    public amount: number,
    public frequency: IncomeFrequency,
    public earned_income: "Yes" | "No",
    public startDate?: Date,
    public end_date?: Date,
    public annualGrowthRate: number = 0.03,
  ) {}
  getProratedAnnual(value: number, year?: number): number {
    let annual = 0;
    switch (this.frequency) {
      case 'Weekly': annual = value * 52; break;
      case 'Bi-Weekly': annual = value * 26; break;
      case 'Semi-Monthly': annual = value * 24; break;
      case 'Monthly': annual = value * 12; break;
      case 'Annually': annual = value; break;
      default: annual = 0;
    }

    // Apply the time-based multiplier if a year is requested
    if (year !== undefined) {
        return annual * getIncomeActiveMultiplier(this as unknown as AnyIncome, year);
    }

    return annual;
  }

  getProratedMonthly(value: number, year?: number): number {
    return this.getProratedAnnual(value, year) / 12;
  }

  // --- REFACTORED MAIN METHODS ---

  getAnnualAmount(year?: number): number {
    // Just reuse the generic helper with the main amount
    return this.getProratedAnnual(this.amount, year);
  }

  getMonthlyAmount(year?: number): number {
    return this.getProratedMonthly(this.amount, year);
  }
}

// 3. Concrete Classes

export class WorkIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: IncomeFrequency,
    earned_income: "Yes" | "No",
    public preTax401k: number = 0,
    public insurance: number = 0,
    public roth401k: number = 0,
    public employerMatch: number = 0,
    public matchAccountId: string,
    public taxType: TaxType | null = null,
    public contributionGrowthStrategy: ContributionGrowthStrategy = 'FIXED',
    startDate?: Date,
    end_date?: Date,
    public hsaContribution: number = 0,  // HSA contribution (pre-tax + FICA-exempt)
    public autoMax401k: AutoMax401kOption = 'custom',  // Auto-max 401k: disabled, custom, traditional, or roth
  ) {
    super(id, name, amount, frequency, earned_income, startDate, end_date);
  }
  increment (assumptions: AssumptionsState, year?: number, age?: number): WorkIncome {
    const salaryGrowth = assumptions.income.salaryGrowth / 100;
    const healthcareInflation = assumptions.macro.healthcareInflation / 100;
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    // 1. Grow Salary
    const newAmount = this.amount * (1 + salaryGrowth + generalInflation);

    // 2. Grow Employer Match
    // (Assuming match is a % of salary, so it grows at the same rate as salary)
    const newMatch = this.employerMatch * (1 + salaryGrowth + generalInflation);

    // 3. Grow Contributions (401k, Roth, HSA)
    let newPreTax = this.preTax401k;
    let newRoth = this.roth401k;
    let newHSA = this.hsaContribution;

    switch (this.contributionGrowthStrategy) {
      case 'GROW_WITH_SALARY':
        newPreTax = this.preTax401k * (1 + salaryGrowth + generalInflation);
        newRoth = this.roth401k * (1 + salaryGrowth + generalInflation);
        newHSA = this.hsaContribution * (1 + salaryGrowth + generalInflation);
        break;
      case 'TRACK_ANNUAL_MAX':
        // Cap contributions at IRS annual limits
        if (year !== undefined && age !== undefined) {
          // Get annual limits (includes catch-up for age 50+/55+)
          const limit401k = get401kLimit(year, age);
          const limitHSA = getHSALimit(year, age, 'individual'); // Default to individual coverage

          // Combined 401k limit (pre-tax + Roth share same limit)
          // Grow current values first, then cap at limit
          const grownPreTax = this.preTax401k * (1 + salaryGrowth + generalInflation);
          const grownRoth = this.roth401k * (1 + salaryGrowth + generalInflation);
          const grownTotal401k = grownPreTax + grownRoth;

          if (grownTotal401k > limit401k) {
            // Cap at limit, maintaining ratio between pre-tax and Roth
            const ratio = grownTotal401k > 0 ? grownPreTax / grownTotal401k : 0.5;
            newPreTax = limit401k * ratio;
            newRoth = limit401k * (1 - ratio);
          } else {
            newPreTax = grownPreTax;
            newRoth = grownRoth;
          }

          // Cap HSA at limit
          const grownHSA = this.hsaContribution * (1 + salaryGrowth + generalInflation);
          newHSA = Math.min(grownHSA, limitHSA);
        } else {
          // Fallback to grow with salary if year/age not provided
          newPreTax = this.preTax401k * (1 + salaryGrowth + generalInflation);
          newRoth = this.roth401k * (1 + salaryGrowth + generalInflation);
          newHSA = this.hsaContribution * (1 + salaryGrowth + generalInflation);
        }
        break;
      case 'FIXED':
      default:
        // Values remain the same
        break;
    }

    // 3b. Apply auto-max 401k if enabled (overrides the above logic)
    if (this.autoMax401k === 'disabled') {
      // No 401k contributions
      newPreTax = 0;
      newRoth = 0;
    } else if ((this.autoMax401k === 'traditional' || this.autoMax401k === 'roth') && year !== undefined && age !== undefined) {
      const limit401k = get401kLimit(year, age);
      if (this.autoMax401k === 'traditional') {
        newPreTax = limit401k;
        newRoth = 0;
      } else {
        newPreTax = 0;
        newRoth = limit401k;
      }
    }

    // 4. Grow Insurance Cost
    // Health insurance usually outpaces regular inflation
    const newInsurance = this.insurance * (1 + healthcareInflation + generalInflation);

    return new WorkIncome(
      this.id,
      this.name,
      newAmount,
      this.frequency,
      this.earned_income,
      newPreTax,
      newInsurance,
      newRoth,
      newMatch,
      this.matchAccountId,
      this.taxType,
      this.contributionGrowthStrategy,
      this.startDate,
      this.end_date,
      newHSA,
      this.autoMax401k
    );
  }

  /**
   * Get the effective 401k contributions for a given year/age, applying autoMax401k if enabled
   */
  getEffective401k(year: number, age: number): { preTax: number; roth: number } {
    if (this.autoMax401k === 'disabled') {
      return { preTax: 0, roth: 0 };
    }
    if (this.autoMax401k === 'custom') {
      return { preTax: this.preTax401k, roth: this.roth401k };
    }
    const limit401k = get401kLimit(year, age);
    if (this.autoMax401k === 'traditional') {
      return { preTax: limit401k, roth: 0 };
    } else {
      return { preTax: 0, roth: limit401k };
    }
  }
}

export class SocialSecurityIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: IncomeFrequency,
    public claimingAge: number,
    public fullRetirementAgeBenefit?: number, // Optional: store FRA benefit for reference
    startDate?: Date,
    end_date?: Date,
  ) {
    super(id, name, amount, frequency, "No", startDate, end_date);
  }

  /**
   * Calculate the benefit adjustment factor based on claiming age
   * Full Retirement Age (FRA) is 67 for people born in 1960 or later
   * @param claimingAge Age when benefits are claimed (62-70)
   * @returns Adjustment factor (e.g., 0.70 for age 62, 1.24 for age 70)
   */
  static calculateBenefitAdjustment(claimingAge: number): number {
    // Claiming before FRA (67) reduces benefits by ~6.67% per year
    // Claiming after FRA increases benefits by 8% per year (up to age 70)
    const FRA = 67;

    if (claimingAge < 62) return 0.70; // Minimum is age 62
    if (claimingAge >= 70) return 1.24; // Maximum is age 70

    if (claimingAge < FRA) {
      // Early claiming: ~6.67% reduction per year before FRA
      // Age 62: 70%, Age 63: 75%, Age 64: 80%, Age 65: 86.7%, Age 66: 93.3%, Age 67: 100%
      const yearsEarly = FRA - claimingAge;
      const reductionFactor = 0.0667; // ~6.67% per year (simplified)
      return Math.max(0.70, 1.0 - (yearsEarly * reductionFactor));
    } else {
      // Delayed claiming: 8% increase per year after FRA
      // Age 68: 108%, Age 69: 116%, Age 70: 124%
      const yearsDelayed = claimingAge - FRA;
      return 1.0 + (yearsDelayed * 0.08);
    }
  }

  /**
   * Calculate benefit amount based on FRA benefit and claiming age
   * @param fraBenefit Benefit amount at Full Retirement Age (67)
   * @param claimingAge Age when claiming (62-70)
   * @returns Adjusted benefit amount
   */
  static calculateBenefitFromFRA(fraBenefit: number, claimingAge: number): number {
    const adjustmentFactor = SocialSecurityIncome.calculateBenefitAdjustment(claimingAge);
    return fraBenefit * adjustmentFactor;
  }

  increment (assumptions: AssumptionsState): SocialSecurityIncome {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    return new SocialSecurityIncome(
      this.id,
      this.name,
      this.amount * (1 + generalInflation),
      this.frequency,
      this.claimingAge,
      this.fullRetirementAgeBenefit ? this.fullRetirementAgeBenefit * (1 + generalInflation) : undefined,
      this.startDate,
      this.end_date
    );
  }
}

export class PassiveIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: IncomeFrequency,
    earned_income: "Yes" | "No",
    public sourceType: 'Dividend' | 'Rental' | 'Royalty' | 'Interest' | 'RMD' | 'Other',
    startDate?: Date,
    end_date?: Date,
    public isReinvested: boolean = false,  // If true, income is taxable but not available as spendable cash (e.g., savings interest that stays in the account)
  ) {
    super(id, name, amount, frequency, earned_income, startDate, end_date);
  }
  increment (assumptions: AssumptionsState): PassiveIncome {
    let growthRate = 0;

    // Smart defaults based on source
    switch (this.sourceType) {
      case 'Rental':
        // Rents tend to grow faster than general inflation
        growthRate = (assumptions.expenses.rentInflation + (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0)) / 100;
        break;
      case 'Interest':
        // Interest income is generated fresh each year based on account balance
        // It doesn't grow independently - the growth comes from the account balance increasing
        growthRate = 0;
        break;
      case 'RMD':
        // RMD income is regenerated each year based on account balance and age
        // It doesn't grow independently - the amount is recalculated each year
        growthRate = 0;
        break;
      case 'Dividend':
      case 'Royalty':
      case 'Other':
      default:
        // Default to general inflation to maintain purchasing power
        growthRate = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
        break;
    }

    return new PassiveIncome(
      this.id,
      this.name,
      this.amount * (1 + growthRate),
      this.frequency,
      this.earned_income,
      this.sourceType,
      this.startDate,
      this.end_date,
      this.isReinvested
    );
  }
}

export class WindfallIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: IncomeFrequency,
    earned_income: "Yes" | "No",
    startDate?: Date,
    end_date?: Date,
  ) {
    super(id, name, amount, frequency, earned_income, startDate, end_date);
  }
  increment (assumptions: AssumptionsState): WindfallIncome {
    const inflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    // Only grow if the user marked it as inflation adjusted

    return new WindfallIncome(
      this.id,
      this.name,
      this.amount * (1 + inflation),
      this.frequency,
      this.earned_income,
      this.startDate,
      this.end_date
    );
  }
}

/**
 * CurrentSocialSecurityIncome
 *
 * For users who are already receiving Social Security benefits:
 * - Disability (SSDI)
 * - Survivor benefits
 * - Retirement benefits (already claimed)
 *
 * Amount is manually entered and grows with COLA (Cost of Living Adjustment).
 * COLA typically tracks inflation rate.
 */
export class CurrentSocialSecurityIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: IncomeFrequency,
    startDate?: Date,
    end_date?: Date,
  ) {
    // Social Security is never considered "earned income" for tax purposes
    super(id, name, amount, frequency, "No", startDate, end_date);
  }

  increment(assumptions: AssumptionsState): CurrentSocialSecurityIncome {
    // COLA (Cost of Living Adjustment) tracks inflation
    const cola = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    return new CurrentSocialSecurityIncome(
      this.id,
      this.name,
      this.amount * (1 + cola),
      this.frequency,
      this.startDate,
      this.end_date
    );
  }
}

/**
 * FutureSocialSecurityIncome
 *
 * For future retirement benefits that will be automatically calculated
 * based on earnings history using SSA's AIME/PIA formula.
 *
 * Key features:
 * - Amount is calculated by SimulationEngine (not user-entered)
 * - Calculation triggered when user reaches claiming age
 * - Uses 35 highest earning years with wage indexing
 * - Start date = claiming age (auto-computed)
 * - End date = life expectancy (auto-set)
 *
 * calculatedPIA stores the monthly benefit amount.
 * When calculatedPIA = 0, the benefit hasn't been calculated yet.
 */
export class FutureSocialSecurityIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    public claimingAge: number,
    public calculatedPIA: number = 0,  // Monthly benefit, set by simulation
    public calculationYear: number = 0,  // Year when PIA was calculated
    startDate?: Date,
    end_date?: Date,
  ) {
    // Amount is annual (calculatedPIA × 12)
    // Social Security is never considered "earned income" for tax purposes
    super(id, name, calculatedPIA * 12, 'Annually', "No", startDate, end_date);
  }

  increment(assumptions: AssumptionsState): FutureSocialSecurityIncome {
    // After benefits start, grow with COLA (inflation)
    const cola = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    return new FutureSocialSecurityIncome(
      this.id,
      this.name,
      this.claimingAge,
      this.calculatedPIA * (1 + cola),
      this.calculationYear,
      this.startDate,
      this.end_date
    );
  }
}

/**
 * FERSPensionIncome
 *
 * Federal Employees Retirement System pension for federal employees hired after 1983.
 * FERS is a three-part retirement plan: Basic Benefit + Social Security + TSP.
 *
 * This class models the Basic Benefit component:
 * - Formula: Years of Service × High-3 × Multiplier (1% or 1.1%)
 * - COLA: Reduced (CPI-1% if inflation > 3%)
 * - FERS Supplement: Bridge payment from MRA to age 62
 *
 * The pension is auto-calculated when the user reaches retirement age.
 */
export class FERSPensionIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    public yearsOfService: number,
    public high3Salary: number,
    public retirementAge: number,
    public birthYear: number,
    public calculatedBenefit: number = 0,  // Annual benefit, calculated by simulation
    public fersSupplement: number = 0,      // Annual FERS Supplement (ends at 62)
    public estimatedSSAt62: number = 0,     // For calculating FERS Supplement
    startDate?: Date,
    end_date?: Date,
    public autoCalculateHigh3: boolean = false,  // If true, calculate High-3 from linked income
    public linkedIncomeId: string | null = null,  // Work income to track for High-3 calculation
  ) {
    // Amount is the calculated annual benefit
    super(id, name, calculatedBenefit, 'Annually', "No", startDate, end_date);
  }

  /**
   * Calculate the FERS pension benefit
   * Called by SimulationEngine when retirement is reached
   */
  calculateBenefit(): number {
    const baseBenefit = calculateFERSBasicBenefit(
      this.yearsOfService,
      this.high3Salary,
      this.retirementAge
    );

    // Check for early retirement reduction (MRA+10)
    const eligibility = checkFERSEligibility(
      this.retirementAge,
      this.yearsOfService,
      this.birthYear
    );

    const reductionFactor = 1 - (eligibility.reductionPercent / 100);
    return baseBenefit * reductionFactor;
  }

  /**
   * Calculate FERS Supplement amount
   * Only available if retiring before age 62 with immediate unreduced retirement
   */
  calculateSupplement(): number {
    if (this.retirementAge >= 62) return 0;
    if (this.estimatedSSAt62 <= 0) return 0;

    // Check eligibility (MRA+10 retirees generally don't get supplement)
    const eligibility = checkFERSEligibility(
      this.retirementAge,
      this.yearsOfService,
      this.birthYear
    );

    // Only full retirees (no reduction) get the supplement
    if (eligibility.reductionPercent > 0) return 0;

    return calculateFERSSupplement(this.yearsOfService, this.estimatedSSAt62 / 12);
  }

  increment(assumptions: AssumptionsState, _year?: number, age?: number): FERSPensionIncome {
    const inflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    const currentAge = age || this.retirementAge;

    // FERS COLA is reduced compared to full CPI
    const cola = getFERSCOLA(inflation, currentAge);

    // FERS Supplement ends at age 62
    const newSupplement = currentAge >= 62 ? 0 : this.fersSupplement * (1 + cola);

    return new FERSPensionIncome(
      this.id,
      this.name,
      this.yearsOfService,
      this.high3Salary * (1 + inflation), // High-3 doesn't grow after retirement, but keep for reference
      this.retirementAge,
      this.birthYear,
      this.calculatedBenefit * (1 + cola),
      newSupplement,
      this.estimatedSSAt62 * (1 + inflation),
      this.startDate,
      this.end_date,
      this.autoCalculateHigh3,
      this.linkedIncomeId
    );
  }

  /**
   * Get total annual income including FERS Supplement
   */
  getTotalAnnualAmount(year?: number): number {
    return this.getAnnualAmount(year) + (this.fersSupplement || 0);
  }
}

/**
 * CSRSPensionIncome
 *
 * Civil Service Retirement System pension for federal employees hired before 1984.
 * CSRS is a standalone pension system with no Social Security coverage.
 *
 * Formula:
 * - 1.5% × High-3 × first 5 years
 * - 1.75% × High-3 × years 6-10
 * - 2.0% × High-3 × years 11+
 * - Maximum: 80% of High-3
 *
 * COLA: Full CPI adjustment
 */
export class CSRSPensionIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    public yearsOfService: number,
    public high3Salary: number,
    public retirementAge: number,
    public calculatedBenefit: number = 0,  // Annual benefit, calculated by simulation
    startDate?: Date,
    end_date?: Date,
    public autoCalculateHigh3: boolean = false,  // If true, calculate High-3 from linked income
    public linkedIncomeId: string | null = null,  // Work income to track for High-3 calculation
  ) {
    // Amount is the calculated annual benefit
    super(id, name, calculatedBenefit, 'Annually', "No", startDate, end_date);
  }

  /**
   * Calculate the CSRS pension benefit
   * Called by SimulationEngine when retirement is reached
   */
  calculateBenefit(): number {
    const baseBenefit = calculateCSRSBasicBenefit(
      this.yearsOfService,
      this.high3Salary
    );

    // Check for early retirement reduction
    const eligibility = checkCSRSEligibility(
      this.retirementAge,
      this.yearsOfService
    );

    const reductionFactor = 1 - (eligibility.reductionPercent / 100);
    return baseBenefit * reductionFactor;
  }

  increment(assumptions: AssumptionsState): CSRSPensionIncome {
    const inflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    // CSRS gets full COLA
    const cola = getCSRSCOLA(inflation);

    return new CSRSPensionIncome(
      this.id,
      this.name,
      this.yearsOfService,
      this.high3Salary, // Doesn't grow after retirement
      this.retirementAge,
      this.calculatedBenefit * (1 + cola),
      this.startDate,
      this.end_date,
      this.autoCalculateHigh3,
      this.linkedIncomeId
    );
  }
}

export type AnyIncome = WorkIncome | SocialSecurityIncome | CurrentSocialSecurityIncome | FutureSocialSecurityIncome | FERSPensionIncome | CSRSPensionIncome | PassiveIncome | WindfallIncome;

/**
 * Calculate the year when Social Security benefits should start
 * @param birthYear User's birth year
 * @param claimingAge Age when claiming SS (62-70)
 * @returns Year when SS benefits begin
 */
export function calculateSocialSecurityStartYear(
    birthYear: number,
    claimingAge: number
): number {
    return birthYear + claimingAge;
}

/**
 * Calculate the start date for Social Security income
 * @param birthYear User's birth year
 * @param claimingAge Age when claiming SS (62-70)
 * @param claimingMonth Month when claiming (0-11, defaults to 0 for January)
 * @returns Date object for when SS benefits begin
 */
export function calculateSocialSecurityStartDate(
    birthYear: number,
    claimingAge: number,
    claimingMonth: number = 0
): Date {
    const year = calculateSocialSecurityStartYear(birthYear, claimingAge);
    return new Date(Date.UTC(year, claimingMonth, 1));
}

export function getIncomeActiveMultiplier(income: AnyIncome, year: number): number {
    const incomeStartDate = income.startDate ? new Date(income.startDate) : new Date();
    const startYear = incomeStartDate.getUTCFullYear();

    const safeEndDate = income.end_date ? new Date(income.end_date) : null;
    const endYear = safeEndDate ? safeEndDate.getUTCFullYear() : null;

    if (startYear > year) return 0;
    if (endYear !== null && endYear < year) return 0;

    const startMonthIndex = (startYear < year) ? 0 : incomeStartDate.getUTCMonth();

    const endMonthIndex = (safeEndDate && endYear === year)
        ? safeEndDate.getUTCMonth()
        : 11;

    const monthsActive = endMonthIndex - startMonthIndex + 1;

    return Math.max(0, monthsActive) / 12;
}

export function isIncomeActiveInCurrentMonth(income: AnyIncome): boolean {
    const today = new Date();
    const currentYear = today.getUTCFullYear();
    const currentMonth = today.getUTCMonth(); // 0-indexed

    const incomeStartDate = income.startDate != null ? income.startDate : new Date();
    const incomeStartYear = incomeStartDate.getUTCFullYear();
    const incomeStartMonth = incomeStartDate.getUTCMonth();

    const currentMonthStart = new Date(currentYear, currentMonth, 1);
    const incomeEffectiveStart = new Date(incomeStartYear, incomeStartMonth, 1);

    if (incomeEffectiveStart > currentMonthStart) {
        return false;
    }

    if (income.end_date) {
        const incomeEndDate = new Date(income.end_date);
        const incomeEndYear = incomeEndDate.getUTCFullYear();
        const incomeEndMonth = incomeEndDate.getUTCMonth();

        const incomeEffectiveEnd = new Date(incomeEndYear, incomeEndMonth + 1, 0); 

        if (incomeEffectiveEnd < currentMonthStart) {
            return false;
        }
    }
    return true;
};

export const INCOME_CATEGORIES = [
  'Work',
  'SocialSecurity',
  'Pension',
  'Passive',
  'Windfall',
] as const;

export type IncomeCategory = typeof INCOME_CATEGORIES[number];

export const INCOME_COLORS_BACKGROUND: Record<IncomeCategory, string> = {
    Work: "bg-chart-Fuchsia-50",
    SocialSecurity: "bg-chart-Blue-50",
    Pension: "bg-chart-Green-50",
    Passive: "bg-chart-Yellow-50",
    Windfall: "bg-chart-Red-50",
};

export const CLASS_TO_CATEGORY: Record<string, IncomeCategory> = {
    [WorkIncome.name]: 'Work',
    [SocialSecurityIncome.name]: 'SocialSecurity',
    [CurrentSocialSecurityIncome.name]: 'SocialSecurity',
    [FutureSocialSecurityIncome.name]: 'SocialSecurity',
    [FERSPensionIncome.name]: 'Pension',
    [CSRSPensionIncome.name]: 'Pension',
    [PassiveIncome.name]: 'Passive',
    [WindfallIncome.name]: 'Windfall'
};

// Map Categories to their color palettes (using Tailwind classes)
export const CATEGORY_PALETTES: Record<IncomeCategory, string[]> = {
	Work: Array.from({ length: 100 }, (_, i) => `bg-chart-Fuchsia-${i + 1}`),
	SocialSecurity: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
	Pension: Array.from({ length: 100 }, (_, i) => `bg-chart-Green-${i + 1}`),
	Passive: Array.from({ length: 100 }, (_, i) => `bg-chart-Yellow-${i + 1}`),
	Windfall: Array.from({ length: 100 }, (_, i) => `bg-chart-Red-${i + 1}`),
};

export function reconstituteIncome(data: any): AnyIncome | null {
    if (!data || !data.className) return null;
    
    const endDateValue = data.end_date;
    const endDate = endDateValue ? (typeof endDateValue === 'string' ? new Date(endDateValue) : new Date(endDateValue)) : undefined;
    const startDateValue = data.startDate || Date.now();
    const startDate = typeof startDateValue === 'string' ? new Date(startDateValue) : new Date(startDateValue);

    // Explicitly mapping fields ensures old saves don't break with new class structures
    const base = {
        id: data.id,
        name: data.name || "Unnamed Income",
        amount: Number(data.amount) || 0,
        frequency: data.frequency || 'Monthly',
        startDate: startDate,
        end_date: endDate,
        earned_income: data.earned_income || "No"
    };

    switch (data.className) {
        case 'WorkIncome':
            // Map old 'none' value to 'custom' for backwards compatibility
            const autoMax401k = data.autoMax401k === 'none' ? 'custom' : (data.autoMax401k || 'custom');
            return new WorkIncome(base.id, base.name, base.amount, base.frequency, base.earned_income,
                data.preTax401k || 0, data.insurance || 0, data.roth401k || 0, data.employerMatch || 0, data.matchAccountId || null, data.taxType || null, data.contributionGrowthStrategy || 'FIXED', base.startDate, base.end_date, data.hsaContribution || 0, autoMax401k);
        case 'SocialSecurityIncome':
            return new SocialSecurityIncome(base.id, base.name, base.amount, base.frequency, 
                data.claimingAge || 67, data.fullRetirementAgeBenefit || 0, base.startDate, base.end_date);
        case 'PassiveIncome':
            return new PassiveIncome(base.id, base.name, base.amount, base.frequency, base.earned_income,
                data.sourceType || 'Other', base.startDate, base.end_date, data.isReinvested ?? false);
        case 'WindfallIncome':
            return new WindfallIncome(base.id, base.name, base.amount, base.frequency, base.earned_income, base.startDate, base.end_date);
        case 'CurrentSocialSecurityIncome':
            return new CurrentSocialSecurityIncome(base.id, base.name, base.amount, base.frequency, base.startDate, base.end_date);
        case 'FutureSocialSecurityIncome':
            return new FutureSocialSecurityIncome(
                base.id,
                base.name,
                data.claimingAge || 67,
                data.calculatedPIA || 0,
                data.calculationYear || 0,
                base.startDate,
                base.end_date
            );
        case 'FERSPensionIncome':
            return new FERSPensionIncome(
                base.id,
                base.name,
                data.yearsOfService || 0,
                data.high3Salary || 0,
                data.retirementAge || 62,
                data.birthYear || 1970,
                data.calculatedBenefit || 0,
                data.fersSupplement || 0,
                data.estimatedSSAt62 || 0,
                base.startDate,
                base.end_date,
                data.autoCalculateHigh3 || false,
                data.linkedIncomeId || null
            );
        case 'CSRSPensionIncome':
            return new CSRSPensionIncome(
                base.id,
                base.name,
                data.yearsOfService || 0,
                data.high3Salary || 0,
                data.retirementAge || 55,
                data.calculatedBenefit || 0,
                base.startDate,
                base.end_date,
                data.autoCalculateHigh3 || false,
                data.linkedIncomeId || null
            );
        default:
            return null;
    }
}