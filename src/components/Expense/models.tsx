export interface Expense {
  id: string;
  name: string;
  amount: number;
  frequency: 'Daily'| 'Weekly' | 'Monthly' | 'Annually';
}

// 2. Base Abstract Class
export abstract class BaseExpense implements Expense {
  constructor(
    public id: string,
    public name: string,
    public amount: number,
    public frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Annually',
  ) {}
}

// 3. Concrete Classes

export class RentExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    public payment: number, // New field
    public utilities: number,
    frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Annually',
  ) {
    super(id, name, payment + utilities, frequency);
  }
}

export class MortgageExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    public valuation: number,
    public loan_balance: number,
    public apr: number,
    public term_length: number,
    public property_taxes: number,
    public valuation_deduction: number,
    public maintenance: number,
    public utilities: number,
    public home_owners_insurance: number,
    public pmi: number,
    public hoa_fee: number,
    public is_tax_deductible: 'Yes' | 'No' | 'Itemized',
    public tax_deductible: number,
    public linkedAccountId: string,
    public payment: number = 0,
    public extra_payment: number = 0
  ) {
    const amoritization = loan_balance*(((apr/100/12)*((1+apr/100/12)**(12*term_length)))/(((1+apr/100/12)**(12*term_length))-1))
    const interest_payment = loan_balance * (apr/100/12)
    const principal_payment = amoritization - interest_payment
    const property_tax_payment = (valuation - valuation_deduction) * property_taxes /100 / 12
    const pmi_payment = valuation * pmi /100
    const repair_payment = maintenance / 100 / 12 * valuation
    const home_owners_insurance_payment = home_owners_insurance / 100 / 12 * valuation
    payment = principal_payment + property_tax_payment + pmi_payment + hoa_fee + repair_payment + utilities + home_owners_insurance_payment + interest_payment + extra_payment
    tax_deductible = interest_payment
    super(id, name, payment, frequency);
  }

  calculatePayment(): number {
    const amoritization = this.loan_balance*(((this.apr/100/12)*((1+this.apr/100/12)**(12*this.term_length)))/(((1+this.apr/100/12)**(12*this.term_length))-1))
    const interest_payment = this.loan_balance * (this.apr/100/12)
    const principal_payment = amoritization - interest_payment
    const property_tax_payment = (this.valuation - this.valuation_deduction) * this.property_taxes /100 / 12
    const pmi_payment = this.valuation * this.pmi /100 /12
    const repair_payment = this.maintenance / 100 / 12 * this.valuation
    const home_owners_insurance_payment = this.home_owners_insurance / 100 / 12 * this.valuation
    return principal_payment + property_tax_payment + pmi_payment + this.hoa_fee + repair_payment + this.utilities + home_owners_insurance_payment + interest_payment + this.extra_payment
  }
  calculateDeductible(): number {
    const interest_payment = this.loan_balance * (this.apr/100/12)
    return interest_payment
  }

  getPrincipalPayment(): number {
    const amoritization = this.loan_balance*(((this.apr/100/12)*((1+this.apr/100/12)**(12*this.term_length)))/(((1+this.apr/100/12)**(12*this.term_length))-1))
    const interest_payment = this.loan_balance * (this.apr/100/12)
    const principal_payment = amoritization - interest_payment
    return principal_payment;
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
    public payment: number,
    public is_tax_deductible: 'Yes' | 'No' | 'Itemized',
    public tax_deductible: number,
    public linkedAccountId: string
  ) {
    super(id, name, amount, frequency);
  }

}

export class DependentExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    public end_date: Date,
    public is_tax_deductible: 'Yes' | 'No' | 'Itemized',
    public tax_deductible: number
  ) {
    super(id, name, amount, frequency);
  }
}

export class HealthcareExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    public is_tax_deductible: 'Yes' | 'No' | 'Itemized',
    public tax_deductible: number
  ) {
    super(id, name, amount, frequency);
  }
}

export class VacationExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
  ) {
    super(id, name, amount, frequency);
  }
}

export class EmergencyExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
  ) {
    super(id, name, amount, frequency);
  }
}

export class TransportExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
  ) {
    super(id, name, amount, frequency);
  }
}

export class FoodExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually'
  ) {
    super(id, name, amount, frequency);
  }
}

export class OtherExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually'
  ) {
    super(id, name, amount, frequency);
  }
}

// Union type for use in State Management
export type AnyExpense = RentExpense | MortgageExpense | LoanExpense | DependentExpense | HealthcareExpense | VacationExpense | EmergencyExpense | OtherExpense;

export const EXPENSE_CATEGORIES = [
  'Rent',
  'Mortgage',
  'Loan',
  'Dependent',
  'Healthcare',
  'Vacation',
  'Emergency',
  'Transport',
  'Food',
  'Other'
] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export const EXPENSE_COLORS_BACKGROUND: Record<ExpenseCategory, string> = {
    Rent: "bg-chart-Fuchsia-50",
    Mortgage: "bg-chart-Blue-50",
    Loan: "bg-chart-Blue-50",
    Dependent: "bg-chart-Yellow-50",
    Healthcare: "bg-chart-Red-50",
    Vacation: "bg-chart-Green-50",
    Emergency: "bg-chart-Fuchsia-50",
    Transport: "bg-chart-Blue-50",
    Food: "bg-chart-Yellow-50",
    Other: "bg-chart-Red-50",
};

export const CLASS_TO_CATEGORY: Record<string, ExpenseCategory> = {
    [RentExpense.name]: 'Rent',
    [MortgageExpense.name]: 'Mortgage',
    [LoanExpense.name]: 'Loan',
    [DependentExpense.name]: 'Dependent',
    [HealthcareExpense.name]: 'Healthcare',
    [VacationExpense.name]: 'Vacation',
    [EmergencyExpense.name]: 'Emergency',
    [TransportExpense.name]: 'Transport',
    [FoodExpense.name]: 'Food',
    [OtherExpense.name]: 'Other',
};

// Map Categories to their color palettes (using Tailwind classes)
export const CATEGORY_PALETTES: Record<ExpenseCategory, string[]> = {
	Rent: Array.from({ length: 100 }, (_, i) => `bg-chart-Fuchsia-${i + 1}`),
	Mortgage: Array.from({ length: 100 }, (_, i) => `bg-chart-Fuchsia-${i + 1}`),
	Loan: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
	Dependent: Array.from({ length: 100 }, (_, i) => `bg-chart-Yellow-${i + 1}`),
	Healthcare: Array.from({ length: 100 }, (_, i) => `bg-chart-Red-${i + 1}`),
	Vacation: Array.from({ length: 100 }, (_, i) => `bg-chart-Green-${i + 1}`),
	Emergency: Array.from({ length: 100 }, (_, i) => `bg-chart-Fuchsia-${i + 1}`),
	Transport: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
	Food: Array.from({ length: 100 }, (_, i) => `bg-chart-Yellow-${i + 1}`),
	Other: Array.from({ length: 100 }, (_, i) => `bg-chart-Red-${i + 1}`),
};