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
    public starting_loan_balance: number,
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
    public purchaseDate: Date,
    public payment: number = 0,
    public extra_payment: number = 0
  ) {
    // 1. Calculate the Fixed Monthly P&I using Starting Balance
    const r = apr / 100 / 12;
    const n = term_length * 12;
    const fixed_amortization = starting_loan_balance * ((r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));

    // 2. Initial breakdown (at start of loan)
    const interest_payment = starting_loan_balance * r;
    const principal_payment = fixed_amortization - interest_payment;

    // 3. Escrow items
    const property_tax_payment = (valuation - valuation_deduction) * property_taxes / 100 / 12;
    const pmi_payment = valuation * pmi / 100; // Note: Ensure this is monthly if pmi is annual %
    const repair_payment = maintenance / 100 / 12 * valuation;
    const home_owners_insurance_payment = home_owners_insurance / 100 / 12 * valuation;

    // 4. Total Payment
    payment = principal_payment + property_tax_payment + pmi_payment + hoa_fee + repair_payment + utilities + home_owners_insurance_payment + interest_payment + extra_payment;
    tax_deductible = interest_payment;

    super(id, name, payment, frequency);
    this.payment = payment;
    this.tax_deductible = tax_deductible;
  }

  calculateAnnualAmortization(year: number): { totalInterest: number, totalPrincipal: number, totalPayment: number } {
    const purchaseYear = this.purchaseDate.getUTCFullYear();
    const purchaseMonth = this.purchaseDate.getUTCMonth();

    if (year < purchaseYear) {
      return { totalInterest: 0, totalPrincipal: 0, totalPayment: 0 };
    }

    let balance = this.starting_loan_balance;
    let totalPayment = 0;
    const monthlyRate = this.apr / 100 / 12;
    const numPayments = this.term_length * 12;
    
    // Fixed P&I using starting balance
    const monthlyPayment = this.starting_loan_balance * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1) + this.extra_payment;

    // Fast-forward to the beginning of the target year
    const monthsToSkip = (year - purchaseYear) * 12 - purchaseMonth;
    if (monthsToSkip > 0) {
      for (let i = 0; i < monthsToSkip; i++) {
        const interest = balance * monthlyRate;
        const principal = monthlyPayment - interest;
        balance -= principal;
      }
    }

    const startMonth = (year === purchaseYear) ? purchaseMonth : 0;

    let totalInterest = 0;
    let totalPrincipal = 0;

    for (let month = startMonth; month < 12; month++) {
      if (balance <= 0) break;

      const interest = balance * monthlyRate;
      const principal = monthlyPayment - interest;

      balance -= principal;
      totalPayment += this.amount; // Uses the BaseExpense amount
      totalInterest += interest;
      totalPrincipal += principal;
    }

    return { totalInterest, totalPrincipal, totalPayment };
  }

  calculatePayment(): number {
    const r = this.apr / 100 / 12;
    const n = this.term_length * 12;
    
    // Fixed P&I Calculation (Always use starting_loan_balance)
    const fixed_amortization = this.starting_loan_balance * ((r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
    
    // Interest (Based on current balance)
    const interest_payment = this.loan_balance * r;
    
    // Principal (The remainder)
    const principal_payment = fixed_amortization - interest_payment;

    const property_tax_payment = (this.valuation - this.valuation_deduction) * this.property_taxes / 100 / 12;
    const pmi_payment = this.valuation * this.pmi / 100 / 12;
    const repair_payment = this.maintenance / 100 / 12 * this.valuation;
    const home_owners_insurance_payment = this.home_owners_insurance / 100 / 12 * this.valuation;
    
    return principal_payment + property_tax_payment + pmi_payment + this.hoa_fee + repair_payment + this.utilities + home_owners_insurance_payment + interest_payment + this.extra_payment;
  }

  calculateDeductible(): number {
    const interest_payment = this.loan_balance * (this.apr / 100 / 12);
    return interest_payment;
  }

  getPrincipalPayment(): number {
    const r = this.apr / 100 / 12;
    const n = this.term_length * 12;

    // Fixed P&I Calculation (Always use starting_loan_balance)
    // FIX: Switched from this.loan_balance to this.starting_loan_balance
    const fixed_amortization = this.starting_loan_balance * ((r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
    
    const interest_payment = this.loan_balance * r;
    
    // Result is the Principal portion of the *Standard* payment
    return fixed_amortization - interest_payment;
  }

  getBalanceAtDate(dateStr: string): number {
    const targetDate = new Date(dateStr);
    const start = new Date(this.purchaseDate);

    // If target is before purchase, the loan didn't exist yet (return 0)
    if (targetDate < start) return 0;

    // Calculate months elapsed
    const monthsElapsed =
      (targetDate.getFullYear() - start.getFullYear()) * 12 +
      (targetDate.getMonth() - start.getMonth());

    if (monthsElapsed <= 0) return this.starting_loan_balance;

    // Calculate Monthly P&I Payment (Principal + Interest only)
    const r = this.apr / 100 / 12;
    const n = this.term_length * 12;

    // Standard Formula for Fixed Monthly Payment using Starting Balance
    const piPayment = this.starting_loan_balance * ((r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));

    let balance = this.starting_loan_balance;

    // Iterate to find balance at specific month
    for (let i = 0; i < monthsElapsed; i++) {
      if (balance <= 0) return 0;
      const interest = balance * r;
      // We assume the payment made was the calculated PI payment + any defined extra payment
      const principal = (piPayment + this.extra_payment) - interest; 
      balance -= principal;
    }

    return balance > 0 ? balance : 0;
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
export type AnyExpense = RentExpense | MortgageExpense | LoanExpense | DependentExpense | HealthcareExpense | VacationExpense | EmergencyExpense | TransportExpense | FoodExpense | OtherExpense;

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