import { TaxType } from "../../Objects/Accounts/models";
import { AssumptionsState } from '../Assumptions/AssumptionsContext';

export type ContributionGrowthStrategy = 'FIXED' | 'GROW_WITH_SALARY' | 'TRACK_ANNUAL_MAX';

export interface Income {
  id: string;
  name: string;
  amount: number;
  frequency: 'Weekly' | 'Monthly' | 'Annually';
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
    public frequency: 'Weekly' | 'Monthly' | 'Annually',
    public earned_income: "Yes" | "No",
    public startDate?: Date,
    public end_date?: Date,
    public annualGrowthRate: number = 0.03,
    public isInflationAdjusted: boolean = true,
  ) {}
  getProratedAnnual(value: number, year?: number): number {
    let annual = 0;
    switch (this.frequency) {
      case 'Weekly': annual = value * 52; break;
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
    frequency: 'Weekly' | 'Monthly' | 'Annually',
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
  ) {
    super(id, name, amount, frequency, earned_income, startDate, end_date);
  }
  increment (assumptions: AssumptionsState): WorkIncome {
    const salaryGrowth = assumptions.income.salaryGrowth / 100;
    const healthcareInflation = assumptions.macro.healthcareInflation / 100;
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    // 1. Grow Salary
    const newAmount = this.amount * (1 + salaryGrowth + generalInflation);

    // 2. Grow Employer Match 
    // (Assuming match is a % of salary, so it grows at the same rate as salary)
    const newMatch = this.employerMatch * (1 + salaryGrowth + generalInflation);

    // 3. Grow Contributions (401k, Roth)
    let newPreTax = this.preTax401k;
    let newRoth = this.roth401k;

    switch (this.contributionGrowthStrategy) {
      case 'GROW_WITH_SALARY':
        newPreTax = this.preTax401k * (1 + salaryGrowth + generalInflation);
        newRoth = this.roth401k * (1 + salaryGrowth + generalInflation);
        break;
      case 'TRACK_ANNUAL_MAX':
        // TODO: Implement logic to fetch 401k max for the year.
        // For now, treating it as 'GROW_WITH_SALARY'
        newPreTax = this.preTax401k * (1 + salaryGrowth + generalInflation);
        newRoth = this.roth401k * (1 + salaryGrowth + generalInflation);
        break;
      case 'FIXED':
      default:
        // Values remain the same
        break;
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
      this.end_date
    );
  }
}

export class SocialSecurityIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
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
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    earned_income: "Yes" | "No",
    public sourceType: 'Dividend' | 'Rental' | 'Royalty' | 'Interest' | 'Other',
    startDate?: Date,
    end_date?: Date,
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
      case 'Dividend':
      case 'Royalty':
      case 'Other':
      default:
        // Default to general inflation to maintain purchasing power
        // (Unless you explicitly turned off inflation adjustment on the object)
        growthRate = this.isInflationAdjusted 
          ? assumptions.macro.inflationRate / 100 
          : 0;
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
      this.end_date
    );
  }
}

export class WindfallIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
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
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    startDate?: Date,
    end_date?: Date,
  ) {
    // Social Security is never considered "earned income" for tax purposes
    super(id, name, amount, frequency, "No", startDate, end_date);
  }

  increment(assumptions: AssumptionsState): CurrentSocialSecurityIncome {
    // COLA (Cost of Living Adjustment) tracks inflation
    const cola = assumptions.macro.inflationRate / 100;

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
    const cola = assumptions.macro.inflationRate / 100;

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

export type AnyIncome = WorkIncome | SocialSecurityIncome | CurrentSocialSecurityIncome | FutureSocialSecurityIncome | PassiveIncome | WindfallIncome;

/**
 * Calculate the year when Social Security benefits should start
 * @param startAge User's current age (from demographics)
 * @param startYear Current year (from demographics)
 * @param claimingAge Age when claiming SS (62-70)
 * @returns Year when SS benefits begin
 */
export function calculateSocialSecurityStartYear(
    startAge: number,
    startYear: number,
    claimingAge: number
): number {
    const yearsUntilClaiming = claimingAge - startAge;
    return startYear + yearsUntilClaiming;
}

/**
 * Calculate the start date for Social Security income
 * @param startAge User's current age (from demographics)
 * @param startYear Current year (from demographics)
 * @param claimingAge Age when claiming SS (62-70)
 * @param claimingMonth Month when claiming (0-11, defaults to 0 for January)
 * @returns Date object for when SS benefits begin
 */
export function calculateSocialSecurityStartDate(
    startAge: number,
    startYear: number,
    claimingAge: number,
    claimingMonth: number = 0
): Date {
    const year = calculateSocialSecurityStartYear(startAge, startYear, claimingAge);
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
  'Passive',
  'Windfall',
] as const;

export type IncomeCategory = typeof INCOME_CATEGORIES[number];

export const INCOME_COLORS_BACKGROUND: Record<IncomeCategory, string> = {
    Work: "bg-chart-Fuchsia-50",
    SocialSecurity: "bg-chart-Blue-50",
    Passive: "bg-chart-Yellow-50",
    Windfall: "bg-chart-Red-50",
};

export const CLASS_TO_CATEGORY: Record<string, IncomeCategory> = {
    [WorkIncome.name]: 'Work',
    [SocialSecurityIncome.name]: 'SocialSecurity',
    [CurrentSocialSecurityIncome.name]: 'SocialSecurity',
    [FutureSocialSecurityIncome.name]: 'SocialSecurity',
    [PassiveIncome.name]: 'Passive',
    [WindfallIncome.name]: 'Windfall'
};

// Map Categories to their color palettes (using Tailwind classes)
export const CATEGORY_PALETTES: Record<IncomeCategory, string[]> = {
	Work: Array.from({ length: 100 }, (_, i) => `bg-chart-Fuchsia-${i + 1}`),
	SocialSecurity: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
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
            return new WorkIncome(base.id, base.name, base.amount, base.frequency, base.earned_income, 
                data.preTax401k || 0, data.insurance || 0, data.roth401k || 0, data.employerMatch || 0, data.matchAccountId || null, data.taxType || null, data.contributionGrowthStrategy || 'FIXED', base.startDate, base.end_date);
        case 'SocialSecurityIncome':
            return new SocialSecurityIncome(base.id, base.name, base.amount, base.frequency, 
                data.claimingAge || 67, data.fullRetirementAgeBenefit || 0, base.startDate, base.end_date);
        case 'PassiveIncome':
            return new PassiveIncome(base.id, base.name, base.amount, base.frequency, base.earned_income, 
                data.sourceType || 'Other', base.startDate, base.end_date);
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
        default:
            return null;
    }
}