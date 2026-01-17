import { AssumptionsState } from "../Assumptions/AssumptionsContext";

export interface Expense {
  id: string;
  name: string;
  amount: number;
  frequency: 'Weekly' | 'Monthly' | 'Annually';
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
    public frequency: 'Weekly' | 'Monthly' | 'Annually',
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

    const result = new RentExpense(
      this.id,
      this.name,
      newPayment,
      newUtilities,
      this.frequency,
      this.startDate,
      this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  adjustAmount(ratio: number): RentExpense {
    const result = new RentExpense(
      this.id,
      this.name,
      this.payment * ratio,
      this.utilities * ratio,
      this.frequency,
      this.startDate,
      this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
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

    const interest_payment = loan_balance * r;
    const principal_payment = (loan_balance > 0 ? fixed_amortization : 0) - interest_payment;

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
    // Utilities and HOA are operating costs tied to general inflation (CPI), not housing appreciation.
    const newUtilities = this.utilities * (1 + generalInflation);
    const newHoa = this.hoa_fee * (1 + generalInflation);
    // Valuation deduction follows property value
    const newDeduction = this.valuation_deduction * (1 + housingAppreciation + generalInflation);

    if (balance < 0.005) {
      balance = 0;
    }

    // 4. Auto-remove PMI when equity reaches 20% (LTV <= 80%)
    // PMI is typically required until the homeowner has 20% equity
    let nextPmi = this.pmi;
    if (newValuation > 0 && balance > 0) {
      const equity = (newValuation - balance) / newValuation;
      if (equity >= 0.2) {
        nextPmi = 0; // Remove PMI once 20% equity is reached
      }
    } else if (balance <= 0) {
      // Loan is paid off, no PMI needed
      nextPmi = 0;
    }

    // 5. Create Next Year's Object
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
      nextPmi,             // PMI removed when equity >= 20%
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
    const result = new VacationExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  adjustAmount(ratio: number): VacationExpense {
    const result = new VacationExpense(
      this.id, this.name, this.amount * ratio, this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }
}

export class SubscriptionExpense extends BaseExpense {
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
  increment(assumptions: AssumptionsState): SubscriptionExpense {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    const result = new SubscriptionExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  adjustAmount(ratio: number): SubscriptionExpense {
    const result = new SubscriptionExpense(
      this.id, this.name, this.amount * ratio, this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
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
  increment(assumptions: AssumptionsState): EmergencyExpense {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    const result = new EmergencyExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  adjustAmount(ratio: number): EmergencyExpense {
    const result = new EmergencyExpense(
      this.id, this.name, this.amount * ratio, this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
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
  increment(assumptions: AssumptionsState): TransportExpense {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    const result = new TransportExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  adjustAmount(ratio: number): TransportExpense {
    const result = new TransportExpense(
      this.id, this.name, this.amount * ratio, this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
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
  increment(assumptions: AssumptionsState): FoodExpense {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    const result = new FoodExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  adjustAmount(ratio: number): FoodExpense {
    const result = new FoodExpense(
      this.id, this.name, this.amount * ratio, this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
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
  increment(assumptions: AssumptionsState): OtherExpense {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    const result = new OtherExpense(
      this.id, this.name, this.amount * (1 + generalInflation), this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }

  adjustAmount(ratio: number): OtherExpense {
    const result = new OtherExpense(
      this.id, this.name, this.amount * ratio, this.frequency, this.startDate, this.endDate
    );
    result.isDiscretionary = this.isDiscretionary;
    return result;
  }
}

export class CharityExpense extends BaseExpense {
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
    this.isDiscretionary = true; // Charity is typically discretionary
  }
  increment(assumptions: AssumptionsState): CharityExpense {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
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
export const CATEGORY_PALETTES: Record<ExpenseCategory, string[]> = {
  Rent: Array.from({ length: 100 }, (_, i) => `bg-chart-Fuchsia-${i + 1}`),
  Mortgage: Array.from({ length: 100 }, (_, i) => `bg-chart-Fuchsia-${i + 1}`),
  Loan: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
  Dependent: Array.from({ length: 100 }, (_, i) => `bg-chart-Yellow-${i + 1}`),
  Healthcare: Array.from({ length: 100 }, (_, i) => `bg-chart-Red-${i + 1}`),
  Vacation: Array.from({ length: 100 }, (_, i) => `bg-chart-Green-${i + 1}`),
  Subscription: Array.from({ length: 100 }, (_, i) => `bg-chart-Cyan-${i + 1}`),
  Emergency: Array.from({ length: 100 }, (_, i) => `bg-chart-Fuchsia-${i + 1}`),
  Transport: Array.from({ length: 100 }, (_, i) => `bg-chart-Blue-${i + 1}`),
  Food: Array.from({ length: 100 }, (_, i) => `bg-chart-Yellow-${i + 1}`),
  Charity: Array.from({ length: 100 }, (_, i) => `bg-chart-Orange-${i + 1}`),
  Other: Array.from({ length: 100 }, (_, i) => `bg-chart-Red-${i + 1}`),
};

export function reconstituteExpense(data: any): AnyExpense | null {
    if (!data || !data.className) return null;
    
    // For startDate, if it's a string, create a local date. Otherwise, treat as already a Date object (or Date.now())
    const startDateValue = data.startDate || Date.now();
    const startDate = typeof startDateValue === 'string' ? new Date(startDateValue) : new Date(startDateValue);

    // For endDate, if it's a string, create a local date. Otherwise, treat as already a Date object.
    const endDateValue = data.end_date;
    const endDate = endDateValue ? (typeof endDateValue === 'string' ? new Date(endDateValue) : new Date(endDateValue)) : undefined;

    const base = {
        id: data.id,
        name: data.name || "Unnamed Expense",
        amount: Number(data.amount) || 0,
        frequency: data.frequency || 'Monthly',
        startDate: startDate,
        endDate: endDate,
        isDiscretionary: data.isDiscretionary ?? false
    };

    let expense: AnyExpense | null = null;

    switch (data.className) {
        case 'HousingExpense':
            expense = new RentExpense(base.id, base.name, data.payment || 0, data.utilities || 0, base.frequency, base.startDate, base.endDate);
            break;
        case 'RentExpense':
            expense = new RentExpense(base.id, base.name, data.payment || 0, data.utilities || 0, base.frequency, base.startDate, base.endDate);
            break;
        case 'MortgageExpense':
            expense = new MortgageExpense(base.id, base.name, base.frequency, data.valuation || 0, data.loan_balance || 0, data.starting_loan_balance || 0, data.apr || 0, data.term_length || 0, data.property_taxes || 0, data.valuation_deduction || 0, data.maintenance || 0, data.utilities || 0, data.home_owners_insurance || 0, data.pmi || 0, data.hoa_fee || 0, data.is_tax_deductible || 'No', data.tax_deductible || 0, data.linkedAccountId || '', base.startDate, data.payment || 0, data.extra_payment || 0, base.endDate);
            break;
        case 'LoanExpense':
            expense = new LoanExpense(base.id, base.name, base.amount, base.frequency, data.apr || 0, data.interest_type || 'Simple', data.payment || 0, data.is_tax_deductible || 'No', data.tax_deductible || 0, data.linkedAccountId || '', base.startDate, base.endDate);
            break;
        case 'DependentExpense':
            expense = new DependentExpense(base.id, base.name, base.amount, base.frequency, data.is_tax_deductible || 'No', data.tax_deductible || 0, base.startDate, base.endDate);
            break;
        case 'HealthcareExpense':
            expense = new HealthcareExpense(base.id, base.name, base.amount, base.frequency, data.is_tax_deductible || 'No', data.tax_deductible || 0, base.startDate, base.endDate);
            break;
        case 'VacationExpense':
            expense = new VacationExpense(base.id, base.name, base.amount, base.frequency, base.startDate, base.endDate);
            break;
        case 'SubscriptionExpense':
            expense = new SubscriptionExpense(base.id, base.name, base.amount, base.frequency, base.startDate, base.endDate);
            break;
        case 'EmergencyExpense':
            expense = new EmergencyExpense(base.id, base.name, base.amount, base.frequency, base.startDate, base.endDate);
            break;
        case 'TransportExpense':
            expense = new TransportExpense(base.id, base.name, base.amount, base.frequency, base.startDate, base.endDate);
            break;
        case 'FoodExpense':
            expense = new FoodExpense(base.id, base.name, base.amount, base.frequency, base.startDate, base.endDate);
            break;
        case 'OtherExpense':
            expense = new OtherExpense(base.id, base.name, base.amount, base.frequency, base.startDate, base.endDate);
            break;
        case 'CharityExpense':
            expense = new CharityExpense(base.id, base.name, base.amount, base.frequency, data.is_tax_deductible || 'Itemized', data.tax_deductible || 0, base.startDate, base.endDate);
            break;
        default:
            return null;
    }

    // Set discretionary flag after creation
    if (expense) {
        expense.isDiscretionary = base.isDiscretionary;
    }

    return expense;
}