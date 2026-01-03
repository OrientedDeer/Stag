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
    startDate?: Date,
    end_date?: Date,
  ) {
    super(id, name, amount, frequency, "No", startDate, end_date);
  }
  increment (assumptions: AssumptionsState): SocialSecurityIncome {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    return new SocialSecurityIncome(
      this.id,
      this.name,
      this.amount * (1 + generalInflation),
      this.frequency,
      this.claimingAge,
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
    public sourceType: 'Dividend' | 'Rental' | 'Royalty' | 'Other',
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

export type AnyIncome = WorkIncome | SocialSecurityIncome | PassiveIncome | WindfallIncome;

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