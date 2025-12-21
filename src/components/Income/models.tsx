export interface Income {
  id: string;
  name: string;
  amount: number;
  frequency: 'Weekly' | 'Monthly' | 'Annually';
  end_date: Date;
  earned_income: "Yes" | "No";
}

// 2. Base Abstract Class
export abstract class BaseIncome implements Income {
  constructor(
    public id: string,
    public name: string,
    public amount: number,
    public frequency: 'Weekly' | 'Monthly' | 'Annually',
    public end_date: Date,
    public earned_income: "Yes" | "No",
    public annualGrowthRate: number = 0.03,
    public isInflationAdjusted: boolean = true
  ) {}
}

// 3. Concrete Classes

export class WorkIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    end_date: Date,
    earned_income: "Yes" | "No",
    public preTax401k: number = 0,
    public insurance: number = 0,
    public roth401k: number = 0,
  ) {
    super(id, name, amount, frequency, end_date, earned_income);
  }
}

export class SocialSecurityIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    end_date: Date,
    earned_income: "Yes" | "No",
    public claimingAge: number
  ) {
    super(id, name, amount, frequency, end_date, earned_income);
  }
}

export class PassiveIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    end_date: Date,
    earned_income: "Yes" | "No",
    public sourceType: 'Dividend' | 'Rental' | 'Royalty' | 'Other'
  ) {
    super(id, name, amount, frequency, end_date, earned_income);
  }
}

export class WindfallIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    end_date: Date,
    earned_income: "Yes" | "No",
    public receipt_date: Date
  ) {
    super(id, name, amount, frequency, end_date, earned_income);
  }
}

// Union type for use in State Management
export type AnyIncome = WorkIncome | SocialSecurityIncome | PassiveIncome | WindfallIncome;

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