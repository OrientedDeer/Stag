import { AssumptionsState } from "../Assumptions/AssumptionsContext";

// 1. Interface}

export interface Account {
  id: string;
  name: string;
  amount: number;
}

// 2. Base Abstract Class
export abstract class BaseAccount implements Account {
  constructor(
    public id: string,
    public name: string,
    public amount: number
  ) {}
}

// 3. Concrete Classes

export const TaxTypeEnum = ['Brokerage', 'Roth 401k', 'Traditional 401k', 'Roth IRA', 'Traditional IRA', 'HSA'] as const;
export type TaxType = typeof TaxTypeEnum[number];

export class SavedAccount extends BaseAccount {
  constructor(
    id: string,
    name: string,
    amount: number,
    public apr: number = 0
  ) {
    super(id, name, amount);
  }

  increment (_assumptions: AssumptionsState, annualContribution: number = 0): SavedAccount {
    // BOY timing: Apply contribution first, then growth
    const amount = (this.amount + annualContribution) * (1 + this.apr/100);
    return new SavedAccount(this.id, this.name, amount, this.apr);
  }
}

export class InvestedAccount extends BaseAccount {
  constructor(
    id: string,
    name: string,
    amount: number,
    // New: Track the specific portion of 'amount' that came from the employer
    public employerBalance: number = 0,
    // New: How many years have we been accumulating/vesting?
    public tenureYears: number = 0,
    public expenseRatio: number = 0.1,
    public taxType: TaxType = 'Brokerage',
    public isContributionEligible: boolean = true,
    public vestedPerYear: number = 0.2, // 20% per year (5 year graded)
    // Track total contributions for capital gains calculation
    // costBasis = amount initially put in (contributions), gains = amount - costBasis
    public costBasis: number = amount, // Default to current amount for backwards compatibility
    // Optional custom return rate (overrides global assumptions)
    public customROR?: number, // undefined means use global assumptions
  ) {
    super(id, name, amount);
  }

  // Calculate unrealized gains (amount above cost basis)
  get unrealizedGains(): number {
    return Math.max(0, this.amount - this.costBasis);
  }

  // Calculate what portion of a withdrawal would be gains vs basis (proportional method)
  calculateWithdrawalAllocation(withdrawAmount: number): { basis: number; gains: number } {
    if (this.amount <= 0) return { basis: 0, gains: 0 };

    const gainsPortion = this.unrealizedGains / this.amount;
    const basisPortion = 1 - gainsPortion;

    return {
      basis: withdrawAmount * basisPortion,
      gains: withdrawAmount * gainsPortion,
    };
  }

  // Helper to calculate the current "Risk" (Unvested Amount)
  get nonVestedAmount(): number {
    // Cap vesting at 100% (1.0)
    const vestedPct = Math.min(1, this.tenureYears * this.vestedPerYear);
    return this.employerBalance * (1 - vestedPct);
  }

  get vestedAmount(): number {
    return this.amount - this.nonVestedAmount;
  }

  increment(
    assumptions: AssumptionsState,
    userContribution: number = 0,
    employerContribution: number = 0,
    overrideReturnRate?: number
  ): InvestedAccount {

    // 1. Calculate Growth Rate
    // Priority: overrideReturnRate (Monte Carlo) > customROR (per-account) > global assumptions
    let returnRate: number;
    if (overrideReturnRate !== undefined) {
      // overrideReturnRate is a percentage (e.g., 7 for 7%), already includes inflation if applicable
      // Still subtract expense ratio
      returnRate = 1 + (overrideReturnRate - this.expenseRatio) / 100;
    } else if (this.customROR !== undefined) {
      // Use per-account custom ROR (already a percentage, e.g., 7 for 7%)
      returnRate = 1 + (this.customROR + (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) - this.expenseRatio) / 100;
    } else {
      returnRate = 1 + (assumptions.investments.returnRates.ror + (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) - this.expenseRatio) / 100;
    }

    // 2. BOY timing: Apply contributions/withdrawals BEFORE growth
    // Calculate vesting using current year rate (tenureYears + 1)
    const newTenure = this.tenureYears + 1;
    const vestedPct = Math.min(1, newTenure * this.vestedPerYear);

    // Start with current (pre-growth) balances
    let preGrowthUserBalance = this.amount - this.employerBalance;
    let preGrowthEmployerBalance = this.employerBalance;
    let preGrowthCostBasis = this.costBasis;

    // 3. Apply employer contribution (before growth)
    preGrowthEmployerBalance += employerContribution;

    // 4. Handle user contribution/withdrawal (before growth)
    if (userContribution < 0) {
      // User is withdrawing
      const withdrawalAmount = Math.abs(userContribution);

      // Check if withdrawal exceeds user's equity (using pre-growth balance)
      if (withdrawalAmount > preGrowthUserBalance) {
        // User is over-withdrawing - need to tap into employer funds
        const shortfall = withdrawalAmount - preGrowthUserBalance;

        // Calculate vested employer amount accessible to user
        const vestedEmployerAmount = preGrowthEmployerBalance * vestedPct;

        // Can only withdraw from vested employer funds
        const allowedFromEmployer = Math.min(shortfall, vestedEmployerAmount);

        // Apply the withdrawal
        preGrowthEmployerBalance -= allowedFromEmployer;
        preGrowthUserBalance = 0; // User equity depleted
      } else {
        // Normal withdrawal - doesn't exceed user equity
        preGrowthUserBalance -= withdrawalAmount;
      }

      // Reduce cost basis proportionally on withdrawal (before growth)
      if (this.amount > 0) {
        const withdrawalPct = withdrawalAmount / this.amount;
        preGrowthCostBasis = this.costBasis * (1 - withdrawalPct);
      }
    } else {
      // User is contributing (or no change)
      preGrowthUserBalance += userContribution;

      // Add contributions to cost basis (vested employer contributions count as basis)
      const vestedEmployerContrib = employerContribution * vestedPct;
      preGrowthCostBasis = this.costBasis + userContribution + vestedEmployerContrib;
    }

    // 5. Now apply growth to the adjusted (post-transaction) balances
    const preGrowthTotal = preGrowthUserBalance + preGrowthEmployerBalance;
    const grownTotal = preGrowthTotal * returnRate;
    const grownEmployerBalance = preGrowthEmployerBalance * returnRate;
    // Note: Cost basis does NOT grow with market returns - it only tracks contributions

    // 6. Final safety checks
    let finalEmployerBalance = grownEmployerBalance;
    if (finalEmployerBalance > grownTotal) {
      finalEmployerBalance = Math.max(0, grownTotal);
    }

    // Cost basis can't exceed total amount or be negative
    const finalCostBasis = Math.max(0, Math.min(preGrowthCostBasis, grownTotal));

    return new InvestedAccount(
      this.id,
      this.name,
      grownTotal,
      finalEmployerBalance,
      newTenure,
      this.expenseRatio,
      this.taxType,
      this.isContributionEligible,
      this.vestedPerYear,
      finalCostBasis,
      this.customROR
    );
  }
}

export class PropertyAccount extends BaseAccount {
  constructor(
    id: string,
    name: string,
    amount: number,
    public ownershipType: 'Financed' | 'Owned',
    public loanAmount: number,
    public startingLoanBalance: number,
    public linkedAccountId: string,
    public apr: number = 0
  ) {
    super(id, name, amount);
  }
  increment(
      assumptions: AssumptionsState, 
      overrides?: { newLoanBalance?: number; newValue?: number }
  ): PropertyAccount {
    let nextValue: number;
    if (overrides?.newValue !== undefined) {
        nextValue = overrides.newValue;
    } else {
        nextValue = this.amount * (1 + assumptions.expenses.housingAppreciation / 100);
    }
    let nextLoan: number;
    if (overrides?.newLoanBalance !== undefined) {
        nextLoan = overrides.newLoanBalance;
    } else {
        nextLoan = this.loanAmount; 
    }

    return new PropertyAccount(
      this.id,
      this.name,
      nextValue,
      this.ownershipType,
      nextLoan, 
      this.startingLoanBalance,
      this.linkedAccountId
    );
  }
}

export class DebtAccount extends BaseAccount {
  constructor(
    id: string,
    name: string,
    amount: number,
    public linkedAccountId: string,
    public apr: number = 0
  ) {
    super(id, name, amount);
  }
  increment(
      _assumptions: AssumptionsState,
      overrideBalance?: number
  ): DebtAccount {
      const nextAmount = overrideBalance !== undefined
          ? overrideBalance
          : this.amount * (1 + this.apr / 100);

      return new DebtAccount(
          this.id,
          this.name,
          nextAmount,
          this.linkedAccountId,
          this.apr
      );
  }
}

/**
 * System-generated debt account for tracking uncovered deficits.
 * 0% APR, gets paid off before priority allocations.
 */
export class DeficitDebtAccount extends DebtAccount {
  constructor(id: string, name: string, amount: number) {
    super(id, name, amount, '', 0); // 0% APR, no linked account
  }

  increment(_assumptions: AssumptionsState, overrideBalance?: number): DeficitDebtAccount {
    const nextAmount = overrideBalance !== undefined ? overrideBalance : this.amount;
    return new DeficitDebtAccount(this.id, this.name, nextAmount);
  }
}

// Union type for use in State Management
export type AnyAccount = SavedAccount | InvestedAccount | PropertyAccount | DebtAccount | DeficitDebtAccount;

export const ACCOUNT_CATEGORIES = [
  'Cash',
  'Invested',
  'Property',
  'Debt',
] as const;

export type AccountCategory = typeof ACCOUNT_CATEGORIES[number];

export const ACCOUNT_COLORS_BACKGROUND: Record<AccountCategory, string> = {
    Cash: "bg-chart-Fuchsia-50",
    Invested: "bg-chart-Blue-50",
    Property: "bg-chart-Yellow-50",
    Debt: "bg-chart-Red-50",
  };

export const CLASS_TO_CATEGORY: Record<string, AccountCategory> = {
    [SavedAccount.name]: 'Cash',
    [InvestedAccount.name]: 'Invested',
    [PropertyAccount.name]: 'Property',
    [DebtAccount.name]: 'Debt',
    [DeficitDebtAccount.name]: 'Debt',
};

// Map Categories to their color palettes (using Tailwind classes for simplicity)
// Uses 5-step gradients (1, 25, 50, 75, 100) defined in :root for SVG access
const PALETTE_STEPS = [1, 25, 50, 75, 100];
export const CATEGORY_PALETTES: Record<AccountCategory, string[]> = {
	Cash: PALETTE_STEPS.map(i => `bg-chart-Fuchsia-${i}`),
	Invested: PALETTE_STEPS.map(i => `bg-chart-Blue-${i}`),
	Property: PALETTE_STEPS.map(i => `bg-chart-Yellow-${i}`),
	Debt: PALETTE_STEPS.map(i => `bg-chart-Red-${i}`),
};

/**
 * Robustly creates class instances from raw JSON.
 * Instead of Object.assign, we map fields explicitly and provide defaults for missing fields.
 */
export function reconstituteAccount(data: any): AnyAccount | null {
    if (!data || !data.className) return null;

    // Common base fields with defaults
    const id = data.id;
    const name = data.name ?? "Unnamed Account";
    const amount = Number(data.amount) ?? 0;

    switch (data.className) {
        case 'SavedAccount':
            return new SavedAccount(id, name, amount, data.apr ?? 0);
            
        case 'InvestedAccount':
            return new InvestedAccount(
                id,
                name,
                amount,
                data.employerBalance ?? 0,
                data.tenureYears ?? 0,
                data.expenseRatio ?? 0.1,
                data.taxType ?? 'Brokerage',
                data.isContributionEligible ?? true,
                data.vestedPerYear ?? 0.2,
                data.costBasis ?? amount, // Default to amount for backwards compatibility
                data.customROR // undefined means use global assumptions
            );
            
        case 'PropertyAccount':
            return new PropertyAccount(
                id,
                name,
                amount,
                data.ownershipType ?? 'Owned',
                data.loanAmount ?? 0,
                data.startingLoanBalance ?? 0,
                data.linkedAccountId
            );            
        case 'DebtAccount':
            return new DebtAccount(
                id,
                name,
                amount,
                data.linkedAccountId ?? '',
                data.apr ?? 0
            );

        case 'DeficitDebtAccount':
            return new DeficitDebtAccount(id, name, amount);

        default:
            console.warn(`Unknown account type: ${data.className}`);
            return null;
    }
}