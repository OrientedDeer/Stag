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
import { parseDate, parseDateRequired, hasClassName } from "../modelUtils";

export type ContributionGrowthStrategy = 'FIXED' | 'GROW_WITH_SALARY' | 'TRACK_ANNUAL_MAX';
export type AutoMax401kOption = 'disabled' | 'custom' | 'traditional' | 'roth';
export type ESPPContributionType = 'NONE' | 'PERCENTAGE' | 'FIXED';
export type PensionSystem = 'NONE' | 'FERS' | 'CSRS';
export type EmployerMatchType = 'fixed' | 'percent';

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
  /** Discriminator for type checking that survives minification and serialization */
  public className: string = '';
  constructor(
    public id: string,
    public name: string,
    public amount: number,
    public frequency: IncomeFrequency,
    public earned_income: "Yes" | "No",
    public startDate?: Date,
    public end_date?: Date,
    public annualGrowthRate: number = 0.03,
    public startMilestoneId?: string,  // Start income when this milestone is reached
    public endMilestoneId?: string,    // End income when this milestone is reached
  ) {}
  // Number of pay periods per year implied by this income's frequency.
  getPeriodsPerYear(): number {
    switch (this.frequency) {
      case 'Weekly': return 52;
      case 'Bi-Weekly': return 26;
      case 'Semi-Monthly': return 24;
      case 'Monthly': return 12;
      case 'Annually': return 1;
      default: return 0;
    }
  }

  // Convert an annual figure (e.g. an IRS contribution limit) into the per-period
  // unit that per-period fields like preTax401k are stored in.
  annualToPerPeriod(annualValue: number): number {
    const periods = this.getPeriodsPerYear();
    return periods > 0 ? annualValue / periods : annualValue;
  }

  getProratedAnnual(value: number, year?: number): number {
    const annual = value * this.getPeriodsPerYear();

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
    // ESPP configuration
    public esppContributionType: ESPPContributionType = 'NONE',
    public esppContributionAmount: number = 0,      // % of salary (1-15) or fixed $/period
    public esppDiscountPercent: number = 15,        // Typical ESPP discount (5-15%)
    public esppHasLookback: boolean = true,         // Lookback provision (purchase at lower of grant/purchase price)
    public esppOfferingPeriodMonths: number = 6,    // Typical is 6 months
    public esppAccountId: string | null = null,     // Linked ESPP account
    public esppExpectedStockGrowth: number = 7,     // Expected annual stock growth for lookback modeling
    public pensionSystem: PensionSystem = 'NONE',   // Which pension system this job is covered by
    startMilestoneId?: string,
    endMilestoneId?: string,
    public employerMatchType: EmployerMatchType = 'fixed',
    public employerMatchPercent: number = 0,
    public employerMatchMax: number = 0,  // Annual cap in dollars (0 = no cap)
  ) {
    super(id, name, amount, frequency, earned_income, startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'WorkIncome';
  }

  getEffectiveAnnualEmployerMatch(year?: number): number {
    if (this.employerMatchType === 'percent') {
      const annualSalary = this.getProratedAnnual(this.amount, year);
      const matchAmount = annualSalary * (this.employerMatchPercent / 100);
      if (this.employerMatchMax > 0) {
        const activeMult = year !== undefined ? getIncomeActiveMultiplier(this as unknown as AnyIncome, year) : 1;
        return Math.min(matchAmount, this.employerMatchMax * activeMult);
      }
      return matchAmount;
    }
    return this.getProratedAnnual(this.employerMatch, year);
  }
  increment (assumptions: AssumptionsState, year?: number, age?: number): WorkIncome {
    const salaryGrowth = assumptions.income.salaryGrowth / 100;
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
          const inflationAdjusted = assumptions.macro.inflationAdjusted;
          // Contributions are stored per pay period, so cap against per-period limits.
          const limit401k = this.annualToPerPeriod(get401kLimit(year, age, inflationAdjusted));
          const limitHSA = this.annualToPerPeriod(getHSALimit(year, age, 'individual', inflationAdjusted));

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
      // The IRS limit is annual; store it per pay period to match the field's unit.
      const perPeriodLimit = this.annualToPerPeriod(get401kLimit(year, age, assumptions.macro.inflationAdjusted));
      if (this.autoMax401k === 'traditional') {
        newPreTax = perPeriodLimit;
        newRoth = 0;
      } else {
        newPreTax = 0;
        newRoth = perPeriodLimit;
      }
    }

    // 4. Grow Insurance Cost
    // Insurance grows with salary (it's a payroll deduction)
    const newInsurance = this.insurance * (1 + salaryGrowth + generalInflation);

    // ESPP contribution grows with salary if percentage-based
    let newESPPAmount = this.esppContributionAmount;
    if (this.esppContributionType === 'PERCENTAGE') {
      // Percentage stays the same, effective amount grows with salary
      newESPPAmount = this.esppContributionAmount;
    } else if (this.esppContributionType === 'FIXED' && this.contributionGrowthStrategy === 'GROW_WITH_SALARY') {
      // Fixed amount can optionally grow with salary
      newESPPAmount = this.esppContributionAmount * (1 + salaryGrowth + generalInflation);
    }

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
      this.autoMax401k,
      this.esppContributionType,
      newESPPAmount,
      this.esppDiscountPercent,
      this.esppHasLookback,
      this.esppOfferingPeriodMonths,
      this.esppAccountId,
      this.esppExpectedStockGrowth,
      this.pensionSystem,
      this.startMilestoneId,
      this.endMilestoneId,
      this.employerMatchType,
      this.employerMatchPercent,
      this.employerMatchMax,
    );
  }

  /**
   * Get the effective 401k contributions for a given year/age, applying autoMax401k if enabled
   * @param inflationAdjusted - If true, projects limits for future years with inflation. Defaults to true.
   */
  getEffective401k(year: number, age: number, inflationAdjusted: boolean = true): { preTax: number; roth: number } {
    if (this.autoMax401k === 'disabled') {
      return { preTax: 0, roth: 0 };
    }
    if (this.autoMax401k === 'custom') {
      return { preTax: this.preTax401k, roth: this.roth401k };
    }
    // The IRS limit is annual; preTax401k/roth401k are stored per pay period, so spread
    // the limit across the income's pay periods. Consumers re-annualize via getProratedAnnual.
    const perPeriodLimit = this.annualToPerPeriod(get401kLimit(year, age, inflationAdjusted));
    if (this.autoMax401k === 'traditional') {
      return { preTax: perPeriodLimit, roth: 0 };
    } else {
      return { preTax: 0, roth: perPeriodLimit };
    }
  }

  /**
   * Get the annual ESPP contribution based on contribution type and salary
   */
  getAnnualESPPContribution(year?: number): number {
    if (this.esppContributionType === 'NONE') {
      return 0;
    }

    const annualSalary = this.getAnnualAmount(year);

    if (this.esppContributionType === 'PERCENTAGE') {
      // esppContributionAmount is a percentage (e.g., 10 for 10%)
      return annualSalary * (this.esppContributionAmount / 100);
    } else {
      // FIXED: esppContributionAmount is per-period, convert to annual
      return this.getProratedAnnual(this.esppContributionAmount, year);
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
    startMilestoneId?: string,
    endMilestoneId?: string,
  ) {
    super(id, name, amount, frequency, "No", startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'SocialSecurityIncome';
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
      this.end_date,
      this.startMilestoneId,
      this.endMilestoneId
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
    startMilestoneId?: string,
    endMilestoneId?: string,
  ) {
    super(id, name, amount, frequency, earned_income, startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'PassiveIncome';
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
      this.isReinvested,
      this.startMilestoneId,
      this.endMilestoneId
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
    startMilestoneId?: string,
    endMilestoneId?: string,
  ) {
    super(id, name, amount, frequency, earned_income, startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'WindfallIncome';
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
      this.end_date,
      this.startMilestoneId,
      this.endMilestoneId
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
    startMilestoneId?: string,
    endMilestoneId?: string,
  ) {
    // Social Security is never considered "earned income" for tax purposes
    super(id, name, amount, frequency, "No", startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'CurrentSocialSecurityIncome';
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
      this.end_date,
      this.startMilestoneId,
      this.endMilestoneId
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
    public calculatedPIA: number = 0,  // Monthly benefit at claiming (feeds amount)
    public calculationYear: number = 0,  // Year when PIA was calculated
    startDate?: Date,
    end_date?: Date,
    startMilestoneId?: string,
    endMilestoneId?: string,
    public projectedPIA: number = 0,  // Monthly benefit for planning (does NOT feed amount)
  ) {
    // Amount is annual (calculatedPIA × 12)
    // Social Security is never considered "earned income" for tax purposes
    super(id, name, calculatedPIA * 12, 'Annually', "No", startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'FutureSocialSecurityIncome';
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
      this.end_date,
      this.startMilestoneId,
      this.endMilestoneId,
      this.projectedPIA * (1 + cola)  // Keep projectedPIA in sync with COLA
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
    startMilestoneId?: string,
    endMilestoneId?: string,
  ) {
    // Amount is the calculated annual benefit
    super(id, name, calculatedBenefit, 'Annually', "No", startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'FERSPensionIncome';
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
      this.linkedIncomeId,
      this.startMilestoneId,
      this.endMilestoneId
    );
  }

  /**
   * Get total annual income including FERS Supplement
   */
  getTotalAnnualAmount(year?: number): number {
    const base = this.getAnnualAmount(year);
    if (base <= 0) return 0;
    // Prorate the FERS supplement with the same active-year multiplier as the base
    // benefit, so a mid-year start prorates both identically (matches getProratedAnnual).
    const activeMult = year !== undefined ? getIncomeActiveMultiplier(this as unknown as AnyIncome, year) : 1;
    return base + (this.fersSupplement || 0) * activeMult;
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
    startMilestoneId?: string,
    endMilestoneId?: string,
  ) {
    // Amount is the calculated annual benefit
    super(id, name, calculatedBenefit, 'Annually', "No", startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'CSRSPensionIncome';
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
      this.linkedIncomeId,
      this.startMilestoneId,
      this.endMilestoneId
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
    // Date-only values come from parseDate, which returns UTC dates (see modelUtils
    // contract). Read with getUTC* so the active window doesn't shift by a month/year
    // in negative timezones.
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
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-indexed

    const incomeStartDate = income.startDate != null ? income.startDate : new Date();
    // Stored date-only values are UTC-midnight; read them with getUTC* (today stays
    // local since it's a true instant). Both sides feed local new Date(y, m, 1)
    // month-boundary comparisons, so the bases stay consistent.
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
// Uses 5-step gradients (1, 25, 50, 75, 100) defined in :root for SVG access
const PALETTE_STEPS = [1, 25, 50, 75, 100];
export const CATEGORY_PALETTES: Record<IncomeCategory, string[]> = {
	Work: PALETTE_STEPS.map(i => `bg-chart-Fuchsia-${i}`),
	SocialSecurity: PALETTE_STEPS.map(i => `bg-chart-Blue-${i}`),
	Pension: PALETTE_STEPS.map(i => `bg-chart-Green-${i}`),
	Passive: PALETTE_STEPS.map(i => `bg-chart-Yellow-${i}`),
	Windfall: PALETTE_STEPS.map(i => `bg-chart-Red-${i}`),
};

export function reconstituteIncome(data: unknown): AnyIncome | null {
    if (!hasClassName(data)) return null;

    const startDate = parseDateRequired(data.startDate);
    const endDate = parseDate(data.end_date);
    const frequency = (data.frequency as IncomeFrequency) || 'Monthly';
    const id = String(data.id ?? '');
    const name = String(data.name ?? 'Unnamed Income');
    const amount = Number(data.amount) || 0;
    const earned_income = (data.earned_income as "Yes" | "No") || "No";
    const startMilestoneId = data.startMilestoneId ? String(data.startMilestoneId) : undefined;
    const endMilestoneId = data.endMilestoneId ? String(data.endMilestoneId) : undefined;

    switch (data.className) {
        case 'WorkIncome': {
            // Map old 'none' value to 'custom' for backwards compatibility
            const autoMax401k = data.autoMax401k === 'none' ? 'custom' : (data.autoMax401k || 'custom');
            return new WorkIncome(
                id, name, amount, frequency, earned_income,
                Number(data.preTax401k) || 0, Number(data.insurance) || 0,
                Number(data.roth401k) || 0, Number(data.employerMatch) || 0,
                String(data.matchAccountId ?? ''), (data.taxType as TaxType) || null,
                (data.contributionGrowthStrategy as ContributionGrowthStrategy) || 'FIXED',
                startDate, endDate, Number(data.hsaContribution) || 0, autoMax401k as AutoMax401kOption,
                (data.esppContributionType as ESPPContributionType) || 'NONE',
                Number(data.esppContributionAmount) || 0,
                Number(data.esppDiscountPercent ?? 15),
                (data.esppHasLookback as boolean) ?? true,
                Number(data.esppOfferingPeriodMonths ?? 6),
                data.esppAccountId ? String(data.esppAccountId) : null,
                Number(data.esppExpectedStockGrowth ?? 7),
                (data.pensionSystem as PensionSystem) || 'NONE',
                startMilestoneId, endMilestoneId,
                (data.employerMatchType as EmployerMatchType) || 'fixed',
                Number(data.employerMatchPercent) || 0,
                Number(data.employerMatchMax) || 0,
            );
        }
        case 'SocialSecurityIncome':
            return new SocialSecurityIncome(
                id, name, amount, frequency, Number(data.claimingAge) || 67,
                Number(data.fullRetirementAgeBenefit) || 0, startDate, endDate,
                startMilestoneId, endMilestoneId
            );
        case 'PassiveIncome':
            return new PassiveIncome(
                id, name, amount, frequency, earned_income,
                (data.sourceType as PassiveIncome['sourceType']) || 'Other',
                startDate, endDate, (data.isReinvested as boolean) ?? false,
                startMilestoneId, endMilestoneId
            );
        case 'WindfallIncome':
            return new WindfallIncome(id, name, amount, frequency, earned_income, startDate, endDate,
                startMilestoneId, endMilestoneId);
        case 'CurrentSocialSecurityIncome':
            return new CurrentSocialSecurityIncome(id, name, amount, frequency, startDate, endDate,
                startMilestoneId, endMilestoneId);
        case 'FutureSocialSecurityIncome':
            return new FutureSocialSecurityIncome(
                id, name, Number(data.claimingAge) || 67,
                Number(data.calculatedPIA) || 0, Number(data.calculationYear) || 0,
                startDate, endDate, startMilestoneId, endMilestoneId,
                Number(data.projectedPIA) || 0  // Preserve projectedPIA across save/reload
            );
        case 'FERSPensionIncome':
            return new FERSPensionIncome(
                id, name, Number(data.yearsOfService) || 0, Number(data.high3Salary) || 0,
                Number(data.retirementAge) || 62, Number(data.birthYear) || 1970,
                Number(data.calculatedBenefit) || 0, Number(data.fersSupplement) || 0,
                Number(data.estimatedSSAt62) || 0, startDate, endDate,
                (data.autoCalculateHigh3 as boolean) || false,
                data.linkedIncomeId ? String(data.linkedIncomeId) : null,
                startMilestoneId, endMilestoneId
            );
        case 'CSRSPensionIncome':
            return new CSRSPensionIncome(
                id, name, Number(data.yearsOfService) || 0, Number(data.high3Salary) || 0,
                Number(data.retirementAge) || 55, Number(data.calculatedBenefit) || 0,
                startDate, endDate, (data.autoCalculateHigh3 as boolean) || false,
                data.linkedIncomeId ? String(data.linkedIncomeId) : null,
                startMilestoneId, endMilestoneId
            );
        default:
            return null;
    }
}