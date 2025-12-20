import { AnyIncome } from "../Income/models";

export interface Expense {
  id: string;
  name: string;
  amount: number;
  frequency: 'Daily'| 'Weekly' | 'Monthly' | 'Annually';
  inflation: number;
}

// 2. Base Abstract Class
export abstract class BaseExpense implements Expense {
  constructor(
    public id: string,
    public name: string,
    public amount: number,
    public frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Annually',
    public inflation: number 
  ) {}
}

// 3. Concrete Classes

export class HousingExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    public payment: number, // New field
    public utilities: number,
    public property_taxes: number,
    public maintenance: number,
    frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Annually',
    inflation: number,
  ) {
    super(id, name, payment + utilities + property_taxes + maintenance, frequency, inflation);
  }
}

export class LoanExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    public apr: number,
    public interest_type: 'Compounding' | 'Simple',
    public start_date: Date,
    public payment: number,
    public is_tax_deductible: 'Yes' | 'No',
    public tax_deductible: number,
    inflation: number,
    public linkedAccountId: string
  ) {
    super(id, name, amount, frequency, inflation);
  }
}

export class DependentExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    inflation: number,
    public start_date: Date,
    public end_date: Date,
    public is_tax_deductible: 'Yes' | 'No',
    public tax_deductible: number
  ) {
    super(id, name, amount, frequency, inflation);
  }
}

export class HealthcareExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    inflation: number,
  ) {
    super(id, name, amount, frequency, inflation);
  }
}

export class VacationExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    inflation: number
  ) {
    super(id, name, amount, frequency, inflation);
  }
}

export class EmergencyExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    inflation: number
  ) {
    super(id, name, amount, frequency, inflation);
  }
}

export class IncomeDeductionExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    public income: AnyIncome,
    inflation: number
  ) {
    super(id, name, amount, frequency, inflation);
  }
}

export class TransportExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    inflation: number
  ) {
    super(id, name, amount, frequency, inflation);
  }
}

export class OtherExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    inflation: number
  ) {
    super(id, name, amount, frequency, inflation);
  }
}

// Union type for use in State Management
export type AnyExpense = HousingExpense | LoanExpense | DependentExpense | HealthcareExpense | VacationExpense | EmergencyExpense | OtherExpense;

export const EXPENSE_CATEGORIES = [
  'Housing',
  'Loan',
  'Dependent',
  'Healthcare',
  'Vacation',
  'Emergency',
  'IncomeDeduction',
  'Transport',
  'Other'
] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export const EXPENSE_COLORS_BACKGROUND: Record<ExpenseCategory, string> = {
    Housing: "bg-chart-Fuchsia-50",
    Loan: "bg-chart-Blue-50",
    Dependent: "bg-chart-Blue-50",
    Healthcare: "bg-chart-Blue-50",
    Vacation: "bg-chart-Blue-50",
    Emergency: "bg-chart-Blue-50",
    IncomeDeduction: "bg-chart-Blue-50",
    Transport: "bg-chart-Blue-50",
    Other: "bg-chart-Blue-50",
};

export const CLASS_TO_CATEGORY: Record<string, ExpenseCategory> = {
    [HousingExpense.name]: 'Housing',
    [LoanExpense.name]: 'Loan',
    [DependentExpense.name]: 'Dependent',
    [HealthcareExpense.name]: 'Healthcare',
    [VacationExpense.name]: 'Vacation',
    [EmergencyExpense.name]: 'Emergency',
    [IncomeDeductionExpense.name]: 'IncomeDeduction',
    [TransportExpense.name]: 'Transport',
    [OtherExpense.name]: 'Other',
};

// Map Categories to their color palettes (using Tailwind classes)
export const CATEGORY_PALETTES: Record<ExpenseCategory, string[]> = {
	Housing: Array.from({ length: 100 }, (_, i) => `bg-chart-Fuchsia-${i + 1}`),
	Loan: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
	Dependent: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
	Healthcare: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
	Vacation: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
	Emergency: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
	IncomeDeduction: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
	Transport: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
	Other: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
};