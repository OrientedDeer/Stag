import { AssumptionsState } from "../Assumptions/AssumptionsContext";

export interface Expense {
  id: string;
  name: string;
  amount: number;
  frequency: 'Weekly' | 'Monthly' | 'Annually';
  startDate?: Date;
  endDate?: Date;
}

// 2. Base Abstract Class
export abstract class BaseExpense implements Expense {
  constructor(
    public id: string,
    public name: string,
    public amount: number,
    public frequency: 'Weekly' | 'Monthly' | 'Annually',
    public startDate?: Date,
    public endDate?: Date,
  ) { }
  getProratedAnnual(value: number, year?: number): number {
    let annual = 0;
    switch (this.frequency) {
      case 'Weekly': annual = value * 52; break;
      case 'Monthly': annual = value * 12; break;
      case 'Annually': annual = value; break;
      default: annual = 0;
    }

    if (year !== undefined) {
      return annual * getExpenseActiveMultiplier(this, year);
    }

    return annual;
  }

  getProratedMonthly(value: number, year?: number): number {
    return this.getProratedAnnual(value, year) / 12;
  }

  // --- REFACTORED MAIN METHODS ---

  getAnnualAmount(year?: number): number {
    return this.getProratedAnnual(this.amount, year);
  }

  getMonthlyAmount(year?: number): number {
    return this.getProratedMonthly(this.amount, year);
  }
}

// 3. Concrete Classes

export class RentExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    public payment: number, // New field
    public utilities: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, payment + utilities, frequency, startDate, endDate);
  }
  increment(assumptions: AssumptionsState): RentExpense {
    const rentInflation = assumptions.expenses.rentInflation / 100;
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    // Inflate the components
    const newPayment = this.payment * (1 + rentInflation + generalInflation);
    const newUtilities = this.utilities * (1 + generalInflation);

    return new RentExpense(
      this.id,
      this.name,
      newPayment,
      newUtilities,
      this.frequency,
      this.startDate,
      this.endDate
    );
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
    startDate?: Date,
    public payment: number = 0,
    public extra_payment: number = 0,
    endDate?: Date,
  ) {
    const r = apr / 100 / 12;
    const n = term_length * 12;
    const fixed_amortization = starting_loan_balance * ((r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));

    const interest_payment = starting_loan_balance * r;
    const principal_payment = fixed_amortization - interest_payment;

    const property_tax_payment = (valuation - valuation_deduction) * property_taxes / 100 / 12;
    const pmi_payment = valuation * pmi / 100;
    const repair_payment = maintenance / 100 / 12 * valuation;
    const home_owners_insurance_payment = home_owners_insurance / 100 / 12 * valuation;

    payment = principal_payment + property_tax_payment + pmi_payment + hoa_fee + repair_payment + utilities + home_owners_insurance_payment + interest_payment + extra_payment;
    tax_deductible = interest_payment;

    super(id, name, payment, frequency, startDate, endDate);
    this.payment = payment;
    this.tax_deductible = tax_deductible;
  }
  increment(assumptions: AssumptionsState): MortgageExpense {
    const monthlyRate = this.apr / 100 / 12;
    let balance = this.loan_balance;
    let totalPrincipalPaid = 0;
    let totalInterestPaid = 0;

    // 1. Internal Loop: Simulate 12 monthly payments
    // We need to calculate the Fixed P&I portion because 'this.payment' includes Escrow
    const standardPI = this.calculatePrincipalAndInterest();

    for (let i = 0; i < 12; i++) {
      if (balance <= 0) break;

      const interest = balance * monthlyRate;
      const totalMonthlyPay = standardPI + this.extra_payment;

      // Principal is the remainder of the payment after interest
      const principal = Math.min(balance, totalMonthlyPay - interest);

      balance -= principal;
      totalPrincipalPaid += principal;
      totalInterestPaid += interest;
    }

    // 2. Inflation & Appreciation
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    const housingAppreciation = assumptions.expenses.housingAppreciation / 100;

    const newValuation = this.valuation * (1 + housingAppreciation + generalInflation);

    // Inflate escrow items (Utilities & HOA are fixed amounts, Insurance/Maintenance are rates)
    // Note: Since Insurance/Maintenance are calculated as % of Valuation, 
    // they essentially "inflate" automatically as the house value rises. 
    // We keep the rates constant here to avoid double-counting inflation.
    const newUtilities = this.utilities * (1 + housingAppreciation + generalInflation);
    const newHoa = this.hoa_fee * (1 + housingAppreciation + generalInflation);
    const newDeduction = this.valuation_deduction * (1 + housingAppreciation + generalInflation);

    // 3. Create Next Year's Object
    const nextYearMortgage = new MortgageExpense(
      this.id,
      this.name,
      this.frequency as 'Weekly' | 'Monthly' | 'Annually',
      newValuation,        // Updated Home Value
      balance,             // Updated Loan Balance
      this.starting_loan_balance, // Keep constant for amortization math
      this.apr,
      this.term_length,
      this.property_taxes, // Rate stays constant
      newDeduction,
      this.maintenance,    // Rate stays constant
      newUtilities,        // Inflated $
      this.home_owners_insurance, // Rate stays constant
      this.pmi,
      newHoa,              // Inflated $
      this.is_tax_deductible,
      this.tax_deductible, // Placeholder, see below
      this.linkedAccountId,
      this.startDate,
      this.payment,        // Placeholder
      this.extra_payment,
      this.endDate
    );

    // FIX: The constructor automatically recalculates tax_deductible based on the START of the loan.
    // We must manually overwrite it with the actual interest paid this year.
    nextYearMortgage.tax_deductible = totalInterestPaid;

    return nextYearMortgage;
  }

  // Helper method required for the grow calculation
  private calculatePrincipalAndInterest(): number {
    if (this.apr === 0) return this.starting_loan_balance / (this.term_length * 12);

    const r = this.apr / 100 / 12;
    const n = this.term_length * 12;
    return this.starting_loan_balance * ((r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
  }


  calculateAnnualAmortization(year: number): { totalInterest: number, totalPrincipal: number, totalPayment: number } {
    const purchaseYear = this.startDate != null ? this.startDate.getUTCFullYear() : new Date().getUTCFullYear();
    const purchaseMonth = this.startDate != null ? this.startDate.getUTCMonth() : new Date().getUTCMonth();

    if (year < purchaseYear) {
      return { totalInterest: 0, totalPrincipal: 0, totalPayment: 0 };
    }

    let balance = this.loan_balance;
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
    const start = new Date(this.startDate != null ? this.startDate : new Date());

    // If target is before purchase, the loan didn't exist yet (return 0)
    if (targetDate.getUTCDate() < start.getUTCDate()) return 0;

    // Calculate months elapsed
    const monthsElapsed =
      (targetDate.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (targetDate.getUTCMonth() - start.getUTCMonth());

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
    public linkedAccountId: string,
    startDate?: Date,
    endDate?: Date,
  ) {

    const effectiveStartDate = startDate || new Date();

    if (!endDate) {
      endDate = new Date(effectiveStartDate);
      endDate.setFullYear(endDate.getFullYear() + 10);
    }

    super(id, name, amount, frequency, effectiveStartDate, endDate);

    if (!this.payment) {
      this.payment = this.calculatePaymentFromEndDate();
    }
  }
  increment(_assumptions: AssumptionsState): LoanExpense {
    let balance = this.amount; // In LoanExpense, 'amount' tracks the current balance
    const monthlyRate = this.apr / 100 / 12;

    // 1. Internal Loop: 12 Months
    for (let i = 0; i < 12; i++) {
      if (balance <= 0) break;

      let interest = 0;
      if (this.interest_type === 'Compounding' && this.apr > 0) {
        interest = balance * monthlyRate;
      }

      // Logic: Payment covers interest first, then principal
      // this.payment is the total monthly payment
      const principal = Math.min(balance, this.payment - interest);

      // If payment is too low to cover interest, balance grows (negative amortization)
      // Otherwise balance shrinks
      balance = balance - principal;
    }

    // 2. Return new state
    return new LoanExpense(
      this.id,
      this.name,
      balance, // New Balance
      this.frequency,
      this.apr,
      this.interest_type,
      this.payment, // Payment stays fixed
      this.is_tax_deductible,
      this.tax_deductible,
      this.linkedAccountId,
      this.startDate,
      this.endDate
    );
  }
  calculatePaymentFromEndDate(): number {
    const months = this.getMonthsUntilPaidOff();
    if (months <= 0) return this.amount;

    if (this.apr === 0) {
      return this.amount / months;
    }
    const monthlyRate = this.apr / 100 / 12;
    const payment = this.amount * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
    return parseFloat(payment.toFixed(2));
  }

  calculateEndDateFromPayment(payment: number): Date {
    const months = this.calculateMonthsFromPayment(payment);
    const newEndDate = new Date(this.startDate!);
    newEndDate.setMonth(newEndDate.getMonth() + months);
    return newEndDate;
  }

  calculateMonthsFromPayment(payment: number): number {
    if (this.apr === 0) {
      return payment > 0 ? this.amount / payment : Infinity;
    }
    const monthlyRate = this.apr / 100 / 12;
    if (payment <= this.amount * monthlyRate) {
      return Infinity;
    }
    const months = -Math.log(1 - (this.amount * monthlyRate) / payment) / Math.log(1 + monthlyRate);
    return Math.ceil(months);
  }

  getMonthsUntilPaidOff(): number {
    if (!this.endDate || !this.startDate) return 0;
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  }

  getAnnualAmount(year?: number): number {
    return this.getProratedAnnual(this.payment, year);
  }

  getMonthlyAmount(year?: number): number {
    return this.getProratedAnnual(this.payment, year) / 12;
  }
}

export class DependentExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    public is_tax_deductible: 'Yes' | 'No' | 'Itemized',
    public tax_deductible: number,
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, amount, frequency, startDate, endDate);
  }
  increment(assumptions: AssumptionsState): DependentExpense {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    return new DependentExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency,
      this.is_tax_deductible, this.tax_deductible, this.startDate, this.endDate
    );
  }
}

export class HealthcareExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    public is_tax_deductible: 'Yes' | 'No' | 'Itemized',
    public tax_deductible: number,
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, amount, frequency, startDate, endDate);
  }
  increment(assumptions: AssumptionsState): HealthcareExpense {
    const inflation = assumptions.macro.healthcareInflation / 100;
    return new HealthcareExpense(
      this.id, this.name, this.amount * (1 + inflation), this.frequency,
      this.is_tax_deductible, this.tax_deductible, this.startDate, this.endDate
    );
  }
}

export class VacationExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, amount, frequency, startDate, endDate);
  }
  increment(assumptions: AssumptionsState): VacationExpense {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    return new VacationExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency, this.startDate, this.endDate
    );
  }
}

export class EmergencyExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, amount, frequency, startDate, endDate);
  }
  increment(assumptions: AssumptionsState): VacationExpense {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    return new VacationExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency, this.startDate, this.endDate
    );
  }
}

export class TransportExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, amount, frequency, startDate, endDate);
  }
  increment(assumptions: AssumptionsState): VacationExpense {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    return new VacationExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency, this.startDate, this.endDate
    );
  }
}

export class FoodExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, amount, frequency, startDate, endDate);
  }
  increment(assumptions: AssumptionsState): VacationExpense {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    return new VacationExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency, this.startDate, this.endDate
    );
  }
}

export class OtherExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: 'Weekly' | 'Monthly' | 'Annually',
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, amount, frequency, startDate, endDate);
  }
  increment(assumptions: AssumptionsState): VacationExpense {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    return new VacationExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency, this.startDate, this.endDate
    );
  }
}

export type AnyExpense = RentExpense | MortgageExpense | LoanExpense | DependentExpense | HealthcareExpense | VacationExpense | EmergencyExpense | TransportExpense | FoodExpense | OtherExpense;

export function getExpenseActiveMultiplier(expense: BaseExpense, year: number): number {
  const expenseStartDate = expense.startDate ? new Date(expense.startDate) : new Date();
  const startYear = expenseStartDate.getUTCFullYear();

  const safeEndDate = expense.endDate ? new Date(expense.endDate) : null;
  const endYear = safeEndDate ? safeEndDate.getUTCFullYear() : null;

  if (startYear > year) return 0;
  if (endYear !== null && endYear < year) return 0;

  const startMonthIndex = (startYear < year) ? 0 : expenseStartDate.getUTCMonth();

  const endMonthIndex = (safeEndDate && endYear === year)
    ? safeEndDate.getUTCMonth()
    : 11;

  const monthsActive = endMonthIndex - startMonthIndex + 1;

  return Math.max(0, monthsActive) / 12;
}

export function isExpenseActiveInCurrentMonth(expense: AnyExpense): boolean {
  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth();

  const expenseStartDate = expense.startDate != null ? expense.startDate : new Date();
  const expenseStartYear = expenseStartDate.getUTCFullYear();
  const expenseStartMonth = expenseStartDate.getUTCMonth();

  const currentMonthStart = new Date(currentYear, currentMonth, 1);
  const expenseEffectiveStart = new Date(expenseStartYear, expenseStartMonth, 1);

  if (expenseEffectiveStart > currentMonthStart) {
    return false;
  }

  if (expense.endDate) {
    const expenseEndDate = new Date(expense.endDate);
    const expenseEndYear = expenseEndDate.getUTCFullYear();
    const expenseEndMonth = expenseEndDate.getUTCMonth();

    const expenseEffectiveEnd = new Date(expenseEndYear, expenseEndMonth + 1, 0);

    if (expenseEffectiveEnd < currentMonthStart) {
      return false;
    }
  }
  return true;
};

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