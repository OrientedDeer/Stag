import { AssumptionsState } from "../Assumptions/AssumptionsContext";
import { parseDate, hasClassName } from "../modelUtils";

// 1. Interface

export interface Account {
  id: string;
  name: string;
  amount: number;
}

// 2. Base Abstract Class
abstract class BaseAccount implements Account {
  constructor(
    public id: string,
    public name: string,
    public amount: number
  ) {}
}

// 3. Concrete Classes

export const TaxTypeEnum = ['Brokerage', 'Roth 401k', 'Traditional 401k', 'Roth IRA', 'Traditional IRA', 'HSA'] as const;
export type TaxType = typeof TaxTypeEnum[number];

// ESPP Lot interface for tracking individual share purchases
export interface ESPPLot {
  id: string;
  grantDate: Date;        // Start of the offering period
  purchaseDate: Date;     // End of the offering period when shares were purchased
  fmvAtGrant: number;     // Fair market value per share at grant date
  fmvAtPurchase: number;  // Fair market value per share at purchase date
  purchasePrice: number;  // Price paid per share (after discount)
  shares: number;         // Number of shares purchased
  totalCost: number;      // Cost basis (purchasePrice * shares)
  discountAmount: number; // Per-share discount (for tax calculation)
}

// Brokerage Lot interface for tracking individual contributions (simulation-internal, not persisted)
export interface BrokerageLot {
  purchaseYear: number;    // Year contribution was made
  costBasis: number;       // Original amount (never grows)
  currentValue: number;    // Market value (grows with returns)
}

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
    // Track Roth conversion amounts with the year they occurred (for 5-year rule)
    public conversionHistory: { year: number; amount: number }[] = [],
    // Simulation-internal lot tracking for brokerage accounts (not persisted)
    public lots: BrokerageLot[] = [],
  ) {
    super(id, name, amount);
  }

  // Total amount in costBasis that came from conversions
  get totalConversionBasis(): number {
    return this.conversionHistory.reduce((sum, c) => sum + c.amount, 0);
  }

  // Amount of costBasis that represents regular contributions (not conversions)
  get regularContributions(): number {
    return Math.max(0, this.costBasis - this.totalConversionBasis);
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

  // Calculate lot-aware withdrawal breakdown for brokerage accounts
  // Uses FIFO (First In, First Out) - sells oldest lots first
  // Returns short-term vs long-term gains based on holding period of each lot
  calculateLotAwareWithdrawal(withdrawAmount: number, currentYear: number): {
    shortTermGains: number; longTermGains: number; basisReturn: number
  } {
    // Fall back to simple method if no lots present
    if (this.lots.length === 0 || this.amount <= 0) {
      const allocation = this.calculateWithdrawalAllocation(withdrawAmount);
      return { shortTermGains: 0, longTermGains: allocation.gains, basisReturn: allocation.basis };
    }

    const totalLotValue = this.lots.reduce((sum, lot) => sum + lot.currentValue, 0);
    if (totalLotValue <= 0) {
      return { shortTermGains: 0, longTermGains: 0, basisReturn: withdrawAmount };
    }

    let shortTermGains = 0;
    let longTermGains = 0;
    let basisReturn = 0;
    let remainingToWithdraw = Math.min(withdrawAmount, totalLotValue);

    // FIFO: Sort lots by purchaseYear ascending (oldest first)
    const sortedLots = [...this.lots].sort((a, b) => a.purchaseYear - b.purchaseYear);

    for (const lot of sortedLots) {
      if (remainingToWithdraw <= 0) break;

      // How much to take from this lot
      const lotWithdraw = Math.min(lot.currentValue, remainingToWithdraw);
      remainingToWithdraw -= lotWithdraw;

      // Calculate basis and gain for this portion
      // Basis withdrawn is proportional to value withdrawn from this lot
      const lotWithdrawPct = lot.currentValue > 0 ? lotWithdraw / lot.currentValue : 0;
      const lotBasisWithdrawn = lot.costBasis * lotWithdrawPct;
      const lotGain = Math.max(0, lotWithdraw - lotBasisWithdrawn);

      basisReturn += lotBasisWithdrawn;

      // Long-term if held >= 2 years (conservative with year-only precision)
      // e.g., purchased 2022, sold 2024 → difference = 2 → definitely long-term
      // Using >= 2 avoids misclassifying short-term as long-term (Dec 2023 → Jan 2024 = 1 year diff but only 1 month held)
      if (currentYear - lot.purchaseYear >= 2) {
        longTermGains += lotGain;
      } else {
        shortTermGains += lotGain;
      }
    }

    return { shortTermGains, longTermGains, basisReturn };
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
    overrideReturnRate?: number,
    conversionAmount: number = 0,
    currentYear: number = 0
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

      // Reduce cost basis and conversion history proportionally on withdrawal (before growth)
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

    // Build updated conversion history
    let newConversionHistory = [...this.conversionHistory];

    // On withdrawal, reduce conversion history proportionally
    if (userContribution < 0 && this.amount > 0) {
      const withdrawalPct = Math.abs(userContribution) / this.amount;
      newConversionHistory = newConversionHistory
        .map(c => ({ year: c.year, amount: c.amount * (1 - withdrawalPct) }))
        .filter(c => c.amount > 0.01); // Remove negligible entries
    }

    // Add new conversion entry if applicable
    if (conversionAmount > 0 && currentYear > 0) {
      newConversionHistory.push({ year: currentYear, amount: conversionAmount });
    }

    // Lot lifecycle (Brokerage accounts only, simulation-internal)
    let newLots: BrokerageLot[] = [];
    if (this.taxType === 'Brokerage') {
      // Seed lot: first time we see an empty lots array with existing balance
      if (this.lots.length === 0 && this.amount > 0 && currentYear > 0) {
        newLots = [{ purchaseYear: currentYear - 2, costBasis: this.costBasis, currentValue: this.amount }];
      } else {
        newLots = [...this.lots];
      }

      if (userContribution < 0 && this.amount > 0) {
        // Withdrawal: FIFO - reduce oldest lots first
        let remainingToWithdraw = Math.abs(userContribution);

        // Sort by purchaseYear ascending (oldest first)
        newLots.sort((a, b) => a.purchaseYear - b.purchaseYear);

        // Reduce lots in FIFO order
        newLots = newLots.map(lot => {
          if (remainingToWithdraw <= 0) return lot;

          const withdrawFromLot = Math.min(lot.currentValue, remainingToWithdraw);
          remainingToWithdraw -= withdrawFromLot;

          // Reduce basis proportionally to value withdrawn
          const withdrawPct = lot.currentValue > 0 ? withdrawFromLot / lot.currentValue : 1;
          return {
            purchaseYear: lot.purchaseYear,
            costBasis: lot.costBasis * (1 - withdrawPct),
            currentValue: lot.currentValue - withdrawFromLot,
          };
        }).filter(lot => lot.currentValue >= 0.01); // Remove fully sold lots
      } else if (userContribution > 0 && currentYear > 0) {
        // Contribution: push a new lot
        newLots.push({ purchaseYear: currentYear, costBasis: userContribution, currentValue: userContribution });
      }

      // Derive costBasis from lot-level truth after FIFO processing.
      // The blended proportional reduction (line 244) diverges from FIFO lot accounting
      // because FIFO sells high-gain lots first, removing less basis than the blended ratio.
      if (newLots.length > 0) {
        preGrowthCostBasis = newLots.reduce((sum, lot) => sum + lot.costBasis, 0);
      }
    }

    // 5. Now apply growth to the adjusted (post-transaction) balances
    const preGrowthTotal = preGrowthUserBalance + preGrowthEmployerBalance;
    const grownTotal = preGrowthTotal * returnRate;
    const grownEmployerBalance = preGrowthEmployerBalance * returnRate;
    // Note: Cost basis does NOT grow with market returns - it only tracks contributions

    // Grow lots proportionally (costBasis stays fixed, currentValue grows)
    if (this.taxType === 'Brokerage' && newLots.length > 0) {
      newLots = newLots.map(lot => ({
        purchaseYear: lot.purchaseYear,
        costBasis: lot.costBasis,
        currentValue: lot.currentValue * returnRate,
      }));
    }

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
      this.customROR,
      newConversionHistory,
      newLots
    );
  }
}

/**
 * ESPP withdrawal preference - controls which lots are sold first
 */
export type ESPPWithdrawalPreference =
  | 'fifo'                        // First-in, first-out (default)
  | 'disqualifying_first'         // Sell disqualifying lots before qualifying
  | 'qualifying_first'            // Sell qualifying lots first (lower ordinary income)
  | 'dont_sell_until_qualifying'; // Skip ESPP in withdrawal order if no qualifying lots

export const ESPP_WITHDRAWAL_PREFERENCE_OPTIONS = [
  { value: 'fifo' as const, label: 'FIFO (First-In, First-Out)' },
  { value: 'disqualifying_first' as const, label: 'Disqualifying First' },
  { value: 'qualifying_first' as const, label: 'Qualifying First' },
  { value: 'dont_sell_until_qualifying' as const, label: "Don't Sell Until Qualifying" },
];

export type ESPPLotOrder = 'fifo' | 'disqualifying_first' | 'qualifying_first';

export function getESPPLotOrder(preference: ESPPWithdrawalPreference): ESPPLotOrder {
  if (preference === 'disqualifying_first') return 'disqualifying_first';
  if (preference === 'qualifying_first' || preference === 'dont_sell_until_qualifying') return 'qualifying_first';
  return 'fifo';
}

/**
 * ESPPAccount - Employee Stock Purchase Plan Account
 *
 * Tracks ESPP shares with lot-level detail for accurate tax treatment.
 * ESPP has special tax rules based on holding periods:
 * - Qualifying disposition: 2 years from grant + 1 year from purchase
 * - Disqualifying disposition: Sold before meeting both holding periods
 */
export class ESPPAccount extends BaseAccount {
  constructor(
    id: string,
    name: string,
    amount: number,
    public lots: ESPPLot[] = [],
    public linkedIncomeId: string | null = null,  // Link to WorkIncome with ESPP
    public customROR?: number, // Optional custom return rate (overrides global assumptions)
    public stockTicker?: string,                  // Company ticker (e.g., "AAPL")
    public currentSharePrice?: number,            // Current price per share
    public withdrawalPreference: ESPPWithdrawalPreference = 'fifo',  // Lot selling order
    public minimumHoldingDays: number = 0,        // Days before shares can be sold
  ) {
    super(id, name, amount);
  }

  /**
   * Sort lots based on withdrawal preference
   */
  private sortLots(
    lots: ESPPLot[],
    saleDate: Date,
    lotOrder: 'fifo' | 'disqualifying_first' | 'qualifying_first'
  ): ESPPLot[] {
    const byPurchaseDate = (a: ESPPLot, b: ESPPLot) =>
      new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime();

    if (lotOrder === 'fifo') {
      return [...lots].sort(byPurchaseDate);
    }

    const qualifyingFirst = lotOrder === 'qualifying_first';
    return [...lots].sort((a, b) => {
      const aQualifying = this.calculateDispositionType(a, saleDate) === 'qualifying';
      const bQualifying = this.calculateDispositionType(b, saleDate) === 'qualifying';
      if (aQualifying !== bQualifying) {
        return qualifyingFirst
          ? (aQualifying ? -1 : 1)
          : (aQualifying ? 1 : -1);
      }
      return byPurchaseDate(a, b);
    });
  }

  /**
   * Determine if a lot qualifies for preferential tax treatment.
   * Qualifying: 2 years from grant AND 1 year from purchase
   */
  calculateDispositionType(lot: ESPPLot, saleDate: Date): 'qualifying' | 'disqualifying' {
    const grantDate = new Date(lot.grantDate);
    const purchaseDate = new Date(lot.purchaseDate);

    // Two years from grant date
    const twoYearsFromGrant = new Date(grantDate);
    twoYearsFromGrant.setFullYear(twoYearsFromGrant.getFullYear() + 2);

    // One year from purchase date
    const oneYearFromPurchase = new Date(purchaseDate);
    oneYearFromPurchase.setFullYear(oneYearFromPurchase.getFullYear() + 1);

    if (saleDate >= twoYearsFromGrant && saleDate >= oneYearFromPurchase) {
      return 'qualifying';
    }
    return 'disqualifying';
  }

  /**
   * Calculate tax implications of selling ESPP shares.
   *
   * For disqualifying dispositions:
   * - Ordinary income = (FMV at purchase - purchase price) × shares = discount amount
   * - Capital gains = sale price - FMV at purchase (per share) × shares
   *
   * For qualifying dispositions:
   * - Ordinary income = lesser of: (1) discount at grant, or (2) actual gain
   * - Capital gains = remainder is long-term capital gains
   *
   * @param sharesToSell - Number of shares to sell
   * @param salePrice - Sale price per share
   * @param saleDate - Date of sale (used to determine qualifying vs disqualifying)
   * @param lotOrder - Order to sell lots: 'fifo', 'disqualifying_first', or 'qualifying_first'
   * @param eligibleLots - Optional pre-filtered list of lots (e.g., after minimum holding period filter)
   */
  calculateSaleTax(
    sharesToSell: number,
    salePrice: number, // Per share
    saleDate: Date,
    lotOrder: 'fifo' | 'disqualifying_first' | 'qualifying_first' = 'fifo',
    eligibleLots?: ESPPLot[]
  ): { ordinaryIncome: number; shortTermGains: number; longTermGains: number; lotsUsed: ESPPLot[] } {
    let ordinaryIncome = 0;
    let shortTermGains = 0;
    let longTermGains = 0;
    let remainingShares = sharesToSell;
    const lotsUsed: ESPPLot[] = [];

    // Use provided eligible lots or all lots
    const lotsToConsider = eligibleLots || this.lots;
    const sortedLots = this.sortLots(lotsToConsider, saleDate, lotOrder);

    for (const lot of sortedLots) {
      if (remainingShares <= 0) break;

      const sharesToUse = Math.min(remainingShares, lot.shares);
      const dispositionType = this.calculateDispositionType(lot, saleDate);
      const lotPurchaseDate = new Date(lot.purchaseDate);

      // Check if held over 1 year for capital gains treatment
      const oneYearFromPurchase = new Date(lotPurchaseDate);
      oneYearFromPurchase.setFullYear(oneYearFromPurchase.getFullYear() + 1);
      const isLongTerm = saleDate >= oneYearFromPurchase;

      if (dispositionType === 'disqualifying') {
        // Disqualifying: discount is ordinary income, rest is capital gain
        const discountPerShare = lot.fmvAtPurchase - lot.purchasePrice;
        ordinaryIncome += discountPerShare * sharesToUse;

        const gainBeyondDiscount = (salePrice - lot.fmvAtPurchase) * sharesToUse;
        if (isLongTerm) {
          longTermGains += gainBeyondDiscount;
        } else {
          shortTermGains += gainBeyondDiscount;
        }
      } else {
        // Qualifying: ordinary income is lesser of grant discount or actual gain
        // Per IRS rules for §423 ESPP qualifying dispositions:
        // Grant discount = 15% of FMV at grant (the statutory maximum)
        // This is capped at actual discount received to never exceed real benefit
        const statutoryDiscount = lot.fmvAtGrant * 0.15;
        const actualDiscount = lot.fmvAtGrant - lot.purchasePrice;
        const grantDiscountPerShare = Math.min(statutoryDiscount, actualDiscount);
        const grantDiscount = grantDiscountPerShare * sharesToUse;
        const actualGain = (salePrice - lot.purchasePrice) * sharesToUse;

        if (actualGain <= 0) {
          // Loss - no ordinary income, just capital loss
          longTermGains += actualGain; // Will be negative
        } else {
          const ordinaryPortion = Math.min(grantDiscount, actualGain);
          ordinaryIncome += ordinaryPortion;
          longTermGains += actualGain - ordinaryPortion;
        }
      }

      remainingShares -= sharesToUse;
      lotsUsed.push({ ...lot, shares: sharesToUse });
    }

    return { ordinaryIncome, shortTermGains, longTermGains, lotsUsed };
  }

  /**
   * Get total shares across all lots
   */
  get totalShares(): number {
    return this.lots.reduce((sum, lot) => sum + lot.shares, 0);
  }

  /**
   * Get total cost basis across all lots
   */
  get totalCostBasis(): number {
    return this.lots.reduce((sum, lot) => sum + lot.totalCost, 0);
  }

  /**
   * Get total unrealized gains
   */
  get unrealizedGains(): number {
    return Math.max(0, this.amount - this.totalCostBasis);
  }

  /**
   * Get count of qualifying vs disqualifying lots based on current date
   */
  getLotCounts(asOfDate: Date = new Date()): { qualifying: number; disqualifying: number } {
    let qualifying = 0;
    let disqualifying = 0;

    for (const lot of this.lots) {
      if (this.calculateDispositionType(lot, asOfDate) === 'qualifying') {
        qualifying++;
      } else {
        disqualifying++;
      }
    }

    return { qualifying, disqualifying };
  }

  /**
   * Get lots that are eligible for sale (meet minimum holding period)
   */
  getEligibleLots(asOfDate: Date = new Date()): ESPPLot[] {
    if (this.minimumHoldingDays <= 0) {
      return this.lots;
    }

    return this.lots.filter(lot => {
      const purchaseDate = new Date(lot.purchaseDate);
      const daysSincePurchase = (asOfDate.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysSincePurchase >= this.minimumHoldingDays;
    });
  }

  /**
   * Get total shares that are eligible for sale (meet minimum holding period)
   */
  getEligibleShares(asOfDate: Date = new Date()): number {
    return this.getEligibleLots(asOfDate).reduce((sum, lot) => sum + lot.shares, 0);
  }

  /**
   * Check if there are any qualifying lots available for sale
   */
  hasQualifyingLots(asOfDate: Date = new Date()): boolean {
    const eligibleLots = this.getEligibleLots(asOfDate);
    return eligibleLots.some(lot => this.calculateDispositionType(lot, asOfDate) === 'qualifying');
  }

  /**
   * Add a new lot from an ESPP purchase
   */
  addLot(lot: ESPPLot): ESPPAccount {
    const newLots = [...this.lots, lot];
    const newAmount = this.amount + (lot.fmvAtPurchase * lot.shares);

    return new ESPPAccount(
      this.id,
      this.name,
      newAmount,
      newLots,
      this.linkedIncomeId,
      this.customROR,
      this.stockTicker,
      this.currentSharePrice,
      this.withdrawalPreference,
      this.minimumHoldingDays
    );
  }

  /**
   * Remove shares from lots (FIFO) after a sale
   * @param lotOrder - Order to remove lots: 'fifo', 'disqualifying_first', or 'qualifying_first'
   */
  removeSoldShares(
    sharesToRemove: number,
    salePrice: number,
    saleDate?: Date,
    lotOrder: 'fifo' | 'disqualifying_first' | 'qualifying_first' = 'fifo'
  ): ESPPAccount {
    let remaining = sharesToRemove;
    const newLots: ESPPLot[] = [];
    const useSaleDate = saleDate || new Date();
    const sortedLots = this.sortLots(this.lots, useSaleDate, lotOrder);

    for (const lot of sortedLots) {
      if (remaining >= lot.shares) {
        // Use entire lot
        remaining -= lot.shares;
      } else if (remaining > 0) {
        // Partial lot - keep the remainder
        const remainingShares = lot.shares - remaining;
        newLots.push({
          ...lot,
          shares: remainingShares,
          totalCost: lot.purchasePrice * remainingShares,
        });
        remaining = 0;
      } else {
        // Keep the lot as-is
        newLots.push(lot);
      }
    }

    const saleProceeds = sharesToRemove * salePrice;
    const newAmount = this.amount - saleProceeds;

    return new ESPPAccount(
      this.id,
      this.name,
      Math.max(0, newAmount),
      newLots,
      this.linkedIncomeId,
      this.customROR,
      this.stockTicker,
      this.currentSharePrice,
      this.withdrawalPreference,
      this.minimumHoldingDays
    );
  }

  /**
   * Update a specific lot by ID
   */
  updateLot(lotId: string, updates: Partial<ESPPLot>): ESPPAccount {
    const newLots = this.lots.map(lot =>
      lot.id === lotId ? { ...lot, ...updates } : lot
    );

    // Recalculate amount based on lots if shares or FMV changed
    const totalLotValue = newLots.reduce((sum, lot) => sum + (lot.fmvAtPurchase * lot.shares), 0);

    return new ESPPAccount(
      this.id,
      this.name,
      totalLotValue > 0 ? totalLotValue : this.amount,
      newLots,
      this.linkedIncomeId,
      this.customROR,
      this.stockTicker,
      this.currentSharePrice,
      this.withdrawalPreference,
      this.minimumHoldingDays
    );
  }

  /**
   * Delete a lot by ID
   */
  deleteLot(lotId: string): ESPPAccount {
    const lotToDelete = this.lots.find(lot => lot.id === lotId);
    const newLots = this.lots.filter(lot => lot.id !== lotId);

    // Reduce amount by the lot's current value
    const lotValue = lotToDelete ? lotToDelete.fmvAtPurchase * lotToDelete.shares : 0;
    const newAmount = Math.max(0, this.amount - lotValue);

    return new ESPPAccount(
      this.id,
      this.name,
      newAmount,
      newLots,
      this.linkedIncomeId,
      this.customROR,
      this.stockTicker,
      this.currentSharePrice,
      this.withdrawalPreference,
      this.minimumHoldingDays
    );
  }

  /**
   * Increment the account value based on stock growth
   */
  increment(
    assumptions: AssumptionsState,
    overrideReturnRate?: number
  ): ESPPAccount {
    // Priority: overrideReturnRate (Monte Carlo) > customROR (per-account) > global assumptions
    let returnRate: number;
    if (overrideReturnRate !== undefined) {
      returnRate = 1 + overrideReturnRate / 100;
    } else if (this.customROR !== undefined) {
      returnRate = 1 + (this.customROR + (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0)) / 100;
    } else {
      returnRate = 1 + (assumptions.investments.returnRates.ror + (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0)) / 100;
    }

    // Grow the overall amount
    const newAmount = this.amount * returnRate;

    // Note: Lots retain their original cost basis - only the current FMV (amount) grows
    return new ESPPAccount(
      this.id,
      this.name,
      newAmount,
      this.lots,
      this.linkedIncomeId,
      this.customROR,
      this.stockTicker,
      this.currentSharePrice,
      this.withdrawalPreference,
      this.minimumHoldingDays
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
export type AnyAccount = SavedAccount | InvestedAccount | ESPPAccount | PropertyAccount | DebtAccount | DeficitDebtAccount;

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
    [ESPPAccount.name]: 'Invested',
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
 * Maps fields explicitly and provides defaults for missing fields.
 */
export function reconstituteAccount(data: unknown): AnyAccount | null {
    if (!hasClassName(data)) return null;

    const id = String(data.id ?? '');
    const name = String(data.name ?? 'Unnamed Account');
    const amount = Number(data.amount) || 0;

    switch (data.className) {
        case 'SavedAccount':
            return new SavedAccount(id, name, amount, Number(data.apr) || 0);

        case 'InvestedAccount': {
            const conversionHistory = Array.isArray(data.conversionHistory)
                ? data.conversionHistory.map((c: any) => ({ year: Number(c.year), amount: Number(c.amount) }))
                : [];
            return new InvestedAccount(
                id, name, amount,
                Number(data.employerBalance) || 0,
                Number(data.tenureYears) || 0,
                Number(data.expenseRatio ?? 0.1),
                (data.taxType as TaxType) ?? 'Brokerage',
                (data.isContributionEligible as boolean) ?? true,
                Number(data.vestedPerYear ?? 0.2),
                Number(data.costBasis ?? amount),
                data.customROR !== undefined ? Number(data.customROR) : undefined,
                conversionHistory
            );
        }

        case 'ESPPAccount': {
            const lotsData = Array.isArray(data.lots) ? data.lots : [];
            const lots: ESPPLot[] = lotsData.map((lot: Record<string, unknown>) => ({
                id: String(lot.id ?? ''),
                grantDate: parseDate(lot.grantDate, new Date()) as Date,
                purchaseDate: parseDate(lot.purchaseDate, new Date()) as Date,
                fmvAtGrant: Number(lot.fmvAtGrant) || 0,
                fmvAtPurchase: Number(lot.fmvAtPurchase) || 0,
                purchasePrice: Number(lot.purchasePrice) || 0,
                shares: Number(lot.shares) || 0,
                totalCost: Number(lot.totalCost) || 0,
                discountAmount: Number(lot.discountAmount) || 0,
            }));
            return new ESPPAccount(
                id, name, amount, lots,
                data.linkedIncomeId ? String(data.linkedIncomeId) : null,
                data.customROR !== undefined ? Number(data.customROR) : undefined,
                data.stockTicker ? String(data.stockTicker) : undefined,
                data.currentSharePrice !== undefined ? Number(data.currentSharePrice) : undefined,
                (data.withdrawalPreference as ESPPWithdrawalPreference) ?? 'fifo',
                Number(data.minimumHoldingDays) || 0
            );
        }

        case 'PropertyAccount':
            return new PropertyAccount(
                id, name, amount,
                (data.ownershipType as 'Financed' | 'Owned') ?? 'Owned',
                Number(data.loanAmount) || 0,
                Number(data.startingLoanBalance) || 0,
                String(data.linkedAccountId ?? '')
            );

        case 'DebtAccount':
            return new DebtAccount(
                id, name, amount,
                String(data.linkedAccountId ?? ''),
                Number(data.apr) || 0
            );

        case 'DeficitDebtAccount':
            return new DeficitDebtAccount(id, name, amount);

        default:
            console.warn(`Unknown account type: ${data.className}`);
            return null;
    }
}