export interface Expense {
  id: string;
  name: string;
  amount: number;
  frequency: 'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually';
  endDate: Date;
}

// 2. Base Abstract Class
export abstract class BaseExpense implements Expense {
  constructor(
    public id: string,
    public name: string,
    public amount: number,
    public frequency: 'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually',
    public endDate: Date
  ) {}
}

// 3. Concrete Classes

export class DefaultExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually',
    endDate: Date
  ) {
    super(id, name, amount, frequency, endDate);
  }
}

export class SecondaryExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually',
    startDate: Date,
    endDate: Date
  ) {
    super(id, name, amount, frequency, endDate);
  }
}

// Union type for use in State Management
export type AnyExpense = DefaultExpense | SecondaryExpense;

export const EXPENSE_CATEGORIES = [
  'DefaultExpense',
  'SecondaryExpense',
] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export const EXPENSE_COLORS_BACKGROUND: Record<ExpenseCategory, string> = {
    DefaultExpense: "bg-chart-Fuchsia-50",
    SecondaryExpense: "bg-chart-Blue-50",
};

export const CLASS_TO_CATEGORY: Record<string, ExpenseCategory> = {
    [DefaultExpense.name]: 'DefaultExpense',
    [SecondaryExpense.name]: 'SecondaryExpense',
};

// Map Categories to their color palettes (using Tailwind classes)
export const CATEGORY_PALETTES: Record<ExpenseCategory, string[]> = {
	DefaultExpense: Array.from({ length: 100 }, (_, i) => `bg-chart-Fuchsia-${i + 1}`),
	SecondaryExpense: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
};