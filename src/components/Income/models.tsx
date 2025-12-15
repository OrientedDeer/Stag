export interface Income {
  id: string;
  name: string;
  amount: number;
  frequency: 'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually' | 'Once';
  endDate: Date;
}

// 2. Base Abstract Class
export abstract class BaseIncome implements Income {
  constructor(
    public id: string,
    public name: string,
    public amount: number,
    public frequency: 'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually' | 'Once',
    public endDate: Date
  ) {}
}

// 3. Concrete Classes

export class WorkIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually' | 'Once',
    endDate: Date,
  ) {
    super(id, name, amount, frequency, endDate);
  }
}

export class SocialSecurityIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually' | 'Once',
    endDate: Date,
    public claimingAge: number
  ) {
    super(id, name, amount, frequency, endDate);
  }
}

export class PassiveIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually' | 'Once',
    endDate: Date,
    public sourceType: 'Dividend' | 'Rental' | 'Royalty' | 'Other'
  ) {
    super(id, name, amount, frequency, endDate);
  }
}

export class WindfallIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually' | 'Once',
    endDate: Date,
    public receiptDate: Date
  ) {
    super(id, name, amount, frequency, endDate);
  }
}

export class RSUIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually' | 'Once',
    endDate: Date,
    public vestingDate: Date
  ) {
    super(id, name, amount, frequency, endDate);
  }
}

// Union type for use in State Management
export type AnyIncome = WorkIncome | SocialSecurityIncome | PassiveIncome | WindfallIncome | RSUIncome;

export const INCOME_CATEGORIES = [
  'Work',
  'SocialSecurity',
  'Passive',
  'Windfall',
  'RSU',
] as const;

export type IncomeCategory = typeof INCOME_CATEGORIES[number];

export const INCOME_COLORS_BACKGROUND: Record<IncomeCategory, string> = {
    Work: "bg-chart-Fuchsia-50",
    SocialSecurity: "bg-chart-Blue-50",
    Passive: "bg-chart-Yellow-50",
    Windfall: "bg-chart-Red-50",
    RSU: "bg-chart-Green-50",
};

export const CLASS_TO_CATEGORY: Record<string, IncomeCategory> = {
    [WorkIncome.name]: 'Work',
    [SocialSecurityIncome.name]: 'SocialSecurity',
    [PassiveIncome.name]: 'Passive',
    [WindfallIncome.name]: 'Windfall',
    [RSUIncome.name]: 'RSU',
};

// Map Categories to their color palettes (using Tailwind classes)
export const CATEGORY_PALETTES: Record<IncomeCategory, string[]> = {
	Work: Array.from({ length: 100 }, (_, i) => `bg-chart-Fuchsia-${i + 1}`),
	SocialSecurity: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
	Passive: Array.from({ length: 100 }, (_, i) => `bg-chart-Yellow-${i + 1}`),
	Windfall: Array.from({ length: 100 }, (_, i) => `bg-chart-Red-${i + 1}`),
	RSU: Array.from({ length: 100 }, (_, i) => `bg-chart-Green-${i + 1}`),
};