import { AssumptionsState } from "../Assumptions/AssumptionsContext";
import { parseDate, parseDateRequired, hasClassName } from "../modelUtils";

export type ExpenseFrequency = 'Weekly' | 'Monthly' | 'Annually';

export interface Expense {
  id: string;
  name: string;
  amount: number;
  frequency: ExpenseFrequency;
  startDate?: Date;
  endDate?: Date;
  isDiscretionary?: boolean; // If true, can be cut during Guyton-Klinger guardrail triggers
}

// 2. Base Abstract Class
export abstract class BaseExpense implements Expense {
  constructor(
    public id: string,
    public name: string,
    public amount: number,
    public frequency: ExpenseFrequency,
    public startDate?: Date,
    public endDate?: Date,
    public isDiscretionary: boolean = false, // Can be cut during Guyton-Klinger guardrail triggers
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

  /**
   * Returns a new expense with the amount adjusted by the given ratio.
   * Used for Guyton-Klinger guardrail adjustments.
   * @param ratio - Multiplier for the amount (e.g., 0.9 for 10% cut, 1.1 for 10% increase)
   */
  abstract adjustAmount(ratio: number): AnyExpense;

  /**
   * Helper to get the general inflation rate from assumptions.
   * Returns 0 if inflationAdjusted is false.
   */
  protected getGeneralInflation(assumptions: AssumptionsState): number {
    return (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
  }
}

/**
 * SimpleExpense - Base class for expenses that only need general inflation adjustment.
 *
 * This consolidates the common pattern shared by: VacationExpense, SubscriptionExpense,
 * EmergencyExpense, TransportExpense, FoodExpense, and OtherExpense.
 */
export abstract class SimpleExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: ExpenseFrequency,
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, amount, frequency, startDate, endDate);
  }

  /**
   * Subclasses must implement this to create a new instance of themselves.
   */
  protected abstract createInstance(
    id: string,
    name: string,
    amount: number,
    frequency: ExpenseFrequency,
    startDate?: Date,
    endDate?: Date,
  ): AnyExpense;

  increment(assumptions: AssumptionsState): AnyExpense {
    const generalInflation = this.getGeneralInflation(assumptions);
    const result = this.createInstance(
      this.id,
      this.name,
      this.amount * (1 + generalInflation),
      this.frequency,
      this.startDate,
      this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  adjustAmount(ratio: number): AnyExpense {
    const result = this.createInstance(
      this.id,
      this.name,
      this.amount * ratio,
      this.frequency,
      this.startDate,
      this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }
}

// 3. Concrete Classes

export class RentExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    public payment: number,
    public utilities: number,
    frequency: ExpenseFrequency,
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, payment + utilities, frequency, startDate, endDate);
  }

  increment(assumptions: AssumptionsState): RentExpense {
    const rentInflation = assumptions.expenses.rentInflation / 100;
    const generalInflation = this.getGeneralInflation(assumptions);

    const newPayment = this.payment * (1 + rentInflation + generalInflation);
    const newUtilities = this.utilities * (1 + generalInflation);

    const result = new RentExpense(
      this.id, this.name, newPayment, newUtilities, this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  adjustAmount(ratio: number): RentExpense {
    const result = new RentExpense(
      this.id, this.name, this.payment * ratio, this.utilities * ratio, this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }
}

export class MortgageExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    frequency: ExpenseFrequency,
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

    const interest_payment = loan_balance * r;
    const principal_payment = (loan_balance > 0 ? fixed_amortization : 0) - interest_payment;

    const property_tax_payment = (valuation - valuation_deduction) * property_taxes / 100 / 12;
    const pmi_payment = (loan_balance/valuation)<=.8 ? valuation * pmi / 100 / 12: 0;
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
    let totalInterestPaid = 0;

    // Simulate 12 monthly payments
    const standardPI = this.calculatePrincipalAndInterest();

    for (let i = 0; i < 12; i++) {
      if (balance <= 0) break;

      const interest = balance * monthlyRate;
      const totalMonthlyPay = standardPI + this.extra_payment;
      const principal = Math.min(balance, totalMonthlyPay - interest);

      balance -= principal;
      totalInterestPaid += interest;
    }

    const generalInflation = this.getGeneralInflation(assumptions);
    const housingAppreciation = assumptions.expenses.housingAppreciation / 100;

    const newValuation = this.valuation * (1 + housingAppreciation + generalInflation);
    const newUtilities = this.utilities * (1 + generalInflation);
    const newHoa = this.hoa_fee * (1 + generalInflation);
    const newDeduction = this.valuation_deduction * (1 + housingAppreciation + generalInflation);

    if (balance < 0.005) {
      balance = 0;
    }

    // Auto-remove PMI when equity reaches 20%
    let nextPmi = this.pmi;
    if (newValuation > 0 && balance > 0) {
      const equity = (newValuation - balance) / newValuation;
      if (equity >= 0.2) {
        nextPmi = 0;
      }
    } else if (balance <= 0) {
      nextPmi = 0;
    }

    const nextYearMortgage = new MortgageExpense(
      this.id, this.name, this.frequency,
      newValuation, balance, this.starting_loan_balance,
      this.apr, this.term_length, this.property_taxes, newDeduction,
      this.maintenance, newUtilities, this.home_owners_insurance, nextPmi, newHoa,
      this.is_tax_deductible, this.tax_deductible, this.linkedAccountId,
      this.startDate, this.payment, this.extra_payment, this.endDate
    );

    nextYearMortgage.tax_deductible = totalInterestPaid;
    nextYearMortgage.isDiscretionary = this.isDiscretionary;

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

    // FIX 1: Trust that 'this.loan_balance' is already the correct starting balance for this year.
    // We DO NOT skip months based on (year - purchaseYear) because the simulation 
    // has already incremented/reduced the balance for previous years.
    let balance = this.loan_balance;

    const monthlyRate = this.apr / 100 / 12;
    const numPayments = this.term_length * 12;

    // Calculate the Standard P&I + Extra Payment Target (Same as before)
    const standardMonthlyPI = this.starting_loan_balance * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
    const targetMonthlyPayment = standardMonthlyPI + this.extra_payment;

    // Isolate the Escrow Amount (Taxes, HOA, Insurance)
    // We assume 'this.amount' is the Total Monthly Payment (P&I + Escrow)
    let monthlyEscrow = 0;
    if (this.loan_balance <= 0) {
      monthlyEscrow = this.amount; // If loan is paid off, entire payment is escrow
    }
    else {
      monthlyEscrow = this.amount - targetMonthlyPayment;
    }

    // Handle partial first year
    const startMonth = (year === purchaseYear) ? purchaseMonth : 0;

    let totalInterest = 0;
    let totalPrincipal = 0;
    let totalPayment = 0;

    for (let month = startMonth; month < 12; month++) {
      if (balance <= 0) {
        totalPayment += monthlyEscrow * (12 - month); // Pay only escrow for remaining months
        break;
      }
      const interest = balance * monthlyRate;
      
      // Calculate Principal (Cap at remaining balance)
      const expectedPrincipal = targetMonthlyPayment - interest;
      const principal = Math.min(balance, expectedPrincipal);
      
      // FIX 2: Calculate the ACTUAL payment for this specific month.
      // If it's the final month, we only pay Principal + Interest + Escrow, 
      // NOT the full 'this.amount'.
      const actualPayment = principal + interest + monthlyEscrow;

      balance -= principal;
      
      totalPayment += actualPayment;
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

  /**
   * Mortgages are contractual obligations and cannot be adjusted.
   * Returns the same mortgage unchanged.
   */
  adjustAmount(_ratio: number): MortgageExpense {
    // Mortgages are fixed contractual obligations - cannot scale them
    // If someone marks a mortgage as discretionary, we just ignore the adjustment
    return this;
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
    frequency: ExpenseFrequency,
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
    const effectiveEndDate = endDate || (() => {
      const end = new Date(effectiveStartDate);
      end.setFullYear(end.getFullYear() + 10);
      return end;
    })();

    super(id, name, amount, frequency, effectiveStartDate, effectiveEndDate);

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
    const result = new LoanExpense(
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
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  calculateAnnualAmortization(year: number): { totalInterest: number, totalPrincipal: number, totalPayment: number } {
    const loanStartYear = this.startDate ? this.startDate.getUTCFullYear() : new Date().getUTCFullYear();
    if (year < loanStartYear) {
        return { totalInterest: 0, totalPrincipal: 0, totalPayment: 0 };
    }

    const loanEndYear = this.endDate ? this.endDate.getUTCFullYear() : null;
    if (loanEndYear !== null && year > loanEndYear) {
        return { totalInterest: 0, totalPrincipal: 0, totalPayment: 0 };
    }

    let balance = this.amount; // Balance at start of the year
    let totalInterest = 0;
    let totalPrincipal = 0;

    const monthlyRate = this.apr / 100 / 12;
    
    const startMonth = (year === loanStartYear) ? (this.startDate ? this.startDate.getUTCMonth() : 0) : 0;
    const endMonth = (loanEndYear === year) ? (this.endDate ? this.endDate.getUTCMonth() : 11) : 11;

    for (let month = startMonth; month <= endMonth; month++) {
        if (balance <= 0) {
            break;
        }

        const interest = this.interest_type === 'Compounding' && this.apr > 0 ? balance * monthlyRate : 0;
        
        // Determine the payment for this month
        // It's either the full payment, or just enough to clear the balance
        const paymentThisMonth = Math.min(this.payment, balance + interest);
        
        let principalPaid = paymentThisMonth - interest;
        
        // Ensure we don't overpay principal
        if (principalPaid > balance) {
            principalPaid = balance;
        }
        
        totalInterest += interest;
        totalPrincipal += principalPaid;
        balance -= principalPaid;
    }
    
    const totalPayment = totalPrincipal + totalInterest;

    return { totalInterest, totalPrincipal, totalPayment };
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
    return Math.round(months);
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

  /**
   * Loans are contractual obligations and cannot be adjusted.
   * Returns the same loan unchanged.
   */
  adjustAmount(_ratio: number): LoanExpense {
    // Loans are fixed contractual obligations - cannot scale them
    return this;
  }
}

export class DependentExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: ExpenseFrequency,
    public is_tax_deductible: 'Yes' | 'No' | 'Itemized',
    public tax_deductible: number,
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, amount, frequency, startDate, endDate);
  }

  increment(assumptions: AssumptionsState): DependentExpense {
    const generalInflation = this.getGeneralInflation(assumptions);
    const result = new DependentExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency,
      this.is_tax_deductible, this.tax_deductible, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  adjustAmount(ratio: number): DependentExpense {
    const result = new DependentExpense(
      this.id, this.name, this.amount * ratio, this.frequency,
      this.is_tax_deductible, this.tax_deductible, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }
}

export class HealthcareExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: ExpenseFrequency,
    public is_tax_deductible: 'Yes' | 'No' | 'Itemized',
    public tax_deductible: number,
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, amount, frequency, startDate, endDate);
  }

  increment(assumptions: AssumptionsState): HealthcareExpense {
    const inflation = assumptions.macro.healthcareInflation / 100;
    const result = new HealthcareExpense(
      this.id, this.name, this.amount * (1 + inflation), this.frequency,
      this.is_tax_deductible, this.tax_deductible, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  adjustAmount(ratio: number): HealthcareExpense {
    const result = new HealthcareExpense(
      this.id, this.name, this.amount * ratio, this.frequency,
      this.is_tax_deductible, this.tax_deductible, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }
}

export class VacationExpense extends SimpleExpense {
  protected createInstance(
    id: string, name: string, amount: number, frequency: ExpenseFrequency, startDate?: Date, endDate?: Date
  ): VacationExpense {
    return new VacationExpense(id, name, amount, frequency, startDate, endDate);
  }
}

export class SubscriptionExpense extends SimpleExpense {
  protected createInstance(
    id: string, name: string, amount: number, frequency: ExpenseFrequency, startDate?: Date, endDate?: Date
  ): SubscriptionExpense {
    return new SubscriptionExpense(id, name, amount, frequency, startDate, endDate);
  }
}

export class EmergencyExpense extends SimpleExpense {
  protected createInstance(
    id: string, name: string, amount: number, frequency: ExpenseFrequency, startDate?: Date, endDate?: Date
  ): EmergencyExpense {
    return new EmergencyExpense(id, name, amount, frequency, startDate, endDate);
  }
}

export class TransportExpense extends SimpleExpense {
  protected createInstance(
    id: string, name: string, amount: number, frequency: ExpenseFrequency, startDate?: Date, endDate?: Date
  ): TransportExpense {
    return new TransportExpense(id, name, amount, frequency, startDate, endDate);
  }
}

export class FoodExpense extends SimpleExpense {
  protected createInstance(
    id: string, name: string, amount: number, frequency: ExpenseFrequency, startDate?: Date, endDate?: Date
  ): FoodExpense {
    return new FoodExpense(id, name, amount, frequency, startDate, endDate);
  }
}

export class OtherExpense extends SimpleExpense {
  protected createInstance(
    id: string, name: string, amount: number, frequency: ExpenseFrequency, startDate?: Date, endDate?: Date
  ): OtherExpense {
    return new OtherExpense(id, name, amount, frequency, startDate, endDate);
  }
}

export class CharityExpense extends BaseExpense {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: ExpenseFrequency,
    public is_tax_deductible: 'Yes' | 'No' | 'Itemized',
    public tax_deductible: number,
    startDate?: Date,
    endDate?: Date,
  ) {
    super(id, name, amount, frequency, startDate, endDate);
    this.isDiscretionary = true; // Charity is typically discretionary
  }

  increment(assumptions: AssumptionsState): CharityExpense {
    const generalInflation = this.getGeneralInflation(assumptions);
    const result = new CharityExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency,
      this.is_tax_deductible, this.tax_deductible, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  adjustAmount(ratio: number): CharityExpense {
    const result = new CharityExpense(
      this.id, this.name, this.amount * ratio, this.frequency,
      this.is_tax_deductible, this.tax_deductible, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }
}

export type AnyExpense = RentExpense | MortgageExpense | LoanExpense | DependentExpense | HealthcareExpense | VacationExpense | EmergencyExpense | TransportExpense | FoodExpense | OtherExpense | CharityExpense | SubscriptionExpense;

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
  'Subscription',
  'Emergency',
  'Transport',
  'Food',
  'Charity',
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
  Subscription: "bg-chart-Cyan-50",
  Emergency: "bg-chart-Fuchsia-50",
  Transport: "bg-chart-Blue-50",
  Food: "bg-chart-Yellow-50",
  Charity: "bg-chart-Orange-50",
  Other: "bg-chart-Red-50",
};

export const CLASS_TO_CATEGORY: Record<string, ExpenseCategory> = {
  [RentExpense.name]: 'Rent',
  [MortgageExpense.name]: 'Mortgage',
  [LoanExpense.name]: 'Loan',
  [DependentExpense.name]: 'Dependent',
  [HealthcareExpense.name]: 'Healthcare',
  [VacationExpense.name]: 'Vacation',
  [SubscriptionExpense.name]: 'Subscription',
  [EmergencyExpense.name]: 'Emergency',
  [TransportExpense.name]: 'Transport',
  [FoodExpense.name]: 'Food',
  [CharityExpense.name]: 'Charity',
  [OtherExpense.name]: 'Other',
};

// Map Categories to their color palettes (using Tailwind classes)
// Uses 5-step gradients (1, 25, 50, 75, 100) defined in :root for SVG access
const PALETTE_STEPS = [1, 25, 50, 75, 100];
export const CATEGORY_PALETTES: Record<ExpenseCategory, string[]> = {
  Rent: PALETTE_STEPS.map(i => `bg-chart-Fuchsia-${i}`),
  Mortgage: PALETTE_STEPS.map(i => `bg-chart-Fuchsia-${i}`),
  Loan: PALETTE_STEPS.map(i => `bg-chart-Blue-${i}`),
  Dependent: PALETTE_STEPS.map(i => `bg-chart-Yellow-${i}`),
  Healthcare: PALETTE_STEPS.map(i => `bg-chart-Red-${i}`),
  Vacation: PALETTE_STEPS.map(i => `bg-chart-Green-${i}`),
  Subscription: PALETTE_STEPS.map(i => `bg-chart-Cyan-${i}`),
  Emergency: PALETTE_STEPS.map(i => `bg-chart-Fuchsia-${i}`),
  Transport: PALETTE_STEPS.map(i => `bg-chart-Blue-${i}`),
  Food: PALETTE_STEPS.map(i => `bg-chart-Yellow-${i}`),
  Charity: PALETTE_STEPS.map(i => `bg-chart-Orange-${i}`),
  Other: PALETTE_STEPS.map(i => `bg-chart-Red-${i}`),
};

export function reconstituteExpense(data: unknown): AnyExpense | null {
    if (!hasClassName(data)) return null;

    const startDate = parseDateRequired(data.startDate);
    const endDate = parseDate(data.end_date);
    const frequency = (data.frequency as ExpenseFrequency) || 'Monthly';
    const id = String(data.id ?? '');
    const name = String(data.name ?? 'Unnamed Expense');
    const amount = Number(data.amount) || 0;
    const isDiscretionary = (data.isDiscretionary as boolean) ?? false;

    let expense: AnyExpense | null = null;

    switch (data.className) {
        case 'HousingExpense':
        case 'RentExpense':
            expense = new RentExpense(
                id, name, Number(data.payment) || 0, Number(data.utilities) || 0,
                frequency, startDate, endDate
            );
            break;
        case 'MortgageExpense':
            expense = new MortgageExpense(
                id, name, frequency,
                Number(data.valuation) || 0, Number(data.loan_balance) || 0,
                Number(data.starting_loan_balance) || 0, Number(data.apr) || 0,
                Number(data.term_length) || 0, Number(data.property_taxes) || 0,
                Number(data.valuation_deduction) || 0, Number(data.maintenance) || 0,
                Number(data.utilities) || 0, Number(data.home_owners_insurance) || 0,
                Number(data.pmi) || 0, Number(data.hoa_fee) || 0,
                (data.is_tax_deductible as 'Yes' | 'No' | 'Itemized') || 'No',
                Number(data.tax_deductible) || 0, String(data.linkedAccountId ?? ''),
                startDate, Number(data.payment) || 0, Number(data.extra_payment) || 0, endDate
            );
            break;
        case 'LoanExpense':
            expense = new LoanExpense(
                id, name, amount, frequency, Number(data.apr) || 0,
                (data.interest_type as 'Compounding' | 'Simple') || 'Simple',
                Number(data.payment) || 0,
                (data.is_tax_deductible as 'Yes' | 'No' | 'Itemized') || 'No',
                Number(data.tax_deductible) || 0, String(data.linkedAccountId ?? ''),
                startDate, endDate
            );
            break;
        case 'DependentExpense':
            expense = new DependentExpense(
                id, name, amount, frequency,
                (data.is_tax_deductible as 'Yes' | 'No' | 'Itemized') || 'No',
                Number(data.tax_deductible) || 0, startDate, endDate
            );
            break;
        case 'HealthcareExpense':
            expense = new HealthcareExpense(
                id, name, amount, frequency,
                (data.is_tax_deductible as 'Yes' | 'No' | 'Itemized') || 'No',
                Number(data.tax_deductible) || 0, startDate, endDate
            );
            break;
        case 'VacationExpense':
            expense = new VacationExpense(id, name, amount, frequency, startDate, endDate);
            break;
        case 'SubscriptionExpense':
            expense = new SubscriptionExpense(id, name, amount, frequency, startDate, endDate);
            break;
        case 'EmergencyExpense':
            expense = new EmergencyExpense(id, name, amount, frequency, startDate, endDate);
            break;
        case 'TransportExpense':
            expense = new TransportExpense(id, name, amount, frequency, startDate, endDate);
            break;
        case 'FoodExpense':
            expense = new FoodExpense(id, name, amount, frequency, startDate, endDate);
            break;
        case 'OtherExpense':
            expense = new OtherExpense(id, name, amount, frequency, startDate, endDate);
            break;
        case 'CharityExpense':
            expense = new CharityExpense(
                id, name, amount, frequency,
                (data.is_tax_deductible as 'Yes' | 'No' | 'Itemized') || 'Itemized',
                Number(data.tax_deductible) || 0, startDate, endDate
            );
            break;
        default:
            return null;
    }

    if (expense) {
        expense.isDiscretionary = isDiscretionary;
    }

    return expense;
}