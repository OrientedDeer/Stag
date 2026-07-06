import { TaxType } from "../../Objects/Accounts/models";
import { AssumptionsState } from '../Assumptions/AssumptionsContext';
import { get401kLimit, getHSALimit } from '../../../data/ContributionLimits';
import {
  getFERSCOLA,
  getCSRSCOLA,
  checkFERSEligibility,
  calculateFERSSupplement,
  getDisplayedFERSBenefit,
  getDisplayedCSRSBenefit,
} from '../../../data/PensionData';
import { parseDate, hasClassName, extractBaseFields, getActiveWindowMultiplier, isWindowActiveInCurrentMonth, hasWindowEnded } from "../modelUtils";
// isActiveRSUGrant lives in a leaf .ts module so importing the pure predicate
// elsewhere doesn't pull in the model graph or trip react-refresh on this .tsx.
// Imported here only for this file's own internal use (NOT re-exported — a
// non-component re-export from a .tsx would re-trigger react-refresh).
import { isActiveRSUGrant } from "./rsuGrant";

export type ContributionGrowthStrategy = 'FIXED' | 'GROW_WITH_SALARY' | 'TRACK_ANNUAL_MAX';
export type AutoMax401kOption = 'disabled' | 'custom' | 'traditional' | 'roth';
export type ESPPContributionType = 'NONE' | 'PERCENTAGE' | 'FIXED';
// RSU vesting schedules (v1). 'custom' (arbitrary per-tranche) is intentionally
// not supported — graded-4yr-quarterly covers the dominant real-world case.
export type RSUVestingSchedule = 'NONE' | 'cliff-1yr' | 'graded-3yr' | 'graded-4yr';
export type RSUVestFrequency = 'quarterly' | 'semi-annual' | 'annual';

export type PensionSystem = 'NONE' | 'FERS' | 'CSRS';
export type EmployerMatchType = 'fixed' | 'percent';

export type IncomeFrequency = 'Weekly' | 'Bi-Weekly' | 'Semi-Monthly' | 'Monthly' | 'Annually';

export interface Income {
  id: string;
  name: string;
  amount: number;
  frequency: IncomeFrequency;
  earned_income: "Yes" | "No";
  startDate?: Date;
  end_date?: Date;
}

// 2. Base Abstract Class
export abstract class BaseIncome implements Income {
  /** Discriminator for type checking that survives minification and serialization */
  public className: string = '';
  constructor(
    public id: string,
    public name: string,
    public amount: number,
    public frequency: IncomeFrequency,
    public earned_income: "Yes" | "No",
    public startDate?: Date,
    public end_date?: Date,
    public annualGrowthRate: number = 0.03,
    public startMilestoneId?: string,  // Start income when this milestone is reached
    public endMilestoneId?: string,    // End income when this milestone is reached
  ) {}
  // Number of pay periods per year implied by this income's frequency.
  getPeriodsPerYear(): number {
    switch (this.frequency) {
      case 'Weekly': return 52;
      case 'Bi-Weekly': return 26;
      case 'Semi-Monthly': return 24;
      case 'Monthly': return 12;
      case 'Annually': return 1;
      default: return 0;
    }
  }

  // Convert an annual figure (e.g. an IRS contribution limit) into the per-period
  // unit that per-period fields like preTax401k are stored in.
  annualToPerPeriod(annualValue: number): number {
    const periods = this.getPeriodsPerYear();
    return periods > 0 ? annualValue / periods : annualValue;
  }

  getProratedAnnual(value: number, year?: number): number {
    const annual = value * this.getPeriodsPerYear();

    // Apply the time-based multiplier if a year is requested
    if (year !== undefined) {
        return annual * getIncomeActiveMultiplier(this as unknown as AnyIncome, year);
    }

    return annual;
  }

  getProratedMonthly(value: number, year?: number): number {
    return this.getProratedAnnual(value, year) / 12;
  }

  // --- REFACTORED MAIN METHODS ---

  getAnnualAmount(year?: number): number {
    // Just reuse the generic helper with the main amount
    return this.getProratedAnnual(this.amount, year);
  }

  getMonthlyAmount(year?: number): number {
    return this.getProratedMonthly(this.amount, year);
  }
}

// 3. Concrete Classes

export class WorkIncome extends BaseIncome {
  // Non-enumerable memo for the RSU vest schedule (defined lazily via
  // Object.defineProperty in getRSUVestSchedule so it never serializes).
  // `declare` gives the type without emitting an enumerable class field.
  private declare _rsuScheduleCache?: { key: string; schedule: { yearOffset: number; shares: number }[] };

  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: IncomeFrequency,
    earned_income: "Yes" | "No",
    public preTax401k: number = 0,
    public insurance: number = 0,
    public roth401k: number = 0,
    public employerMatch: number = 0,
    public matchAccountId: string,
    public taxType: TaxType | null = null,
    public contributionGrowthStrategy: ContributionGrowthStrategy = 'FIXED',
    startDate?: Date,
    end_date?: Date,
    public hsaContribution: number = 0,  // HSA contribution (pre-tax + FICA-exempt)
    public autoMax401k: AutoMax401kOption = 'custom',  // Auto-max 401k: disabled, custom, traditional, or roth
    // ESPP configuration
    public esppContributionType: ESPPContributionType = 'NONE',
    public esppContributionAmount: number = 0,      // % of salary (1-15) or fixed $/period
    public esppDiscountPercent: number = 15,        // Typical ESPP discount (5-15%)
    public esppHasLookback: boolean = true,         // Lookback provision (purchase at lower of grant/purchase price)
    public esppOfferingPeriodMonths: number = 6,    // Typical is 6 months
    public esppAccountId: string | null = null,     // Linked ESPP account
    public esppExpectedStockGrowth: number = 7,     // Expected annual stock growth for lookback modeling
    // RSU configuration
    public rsuVestingSchedule: RSUVestingSchedule = 'NONE',  // Vesting schedule type
    public rsuGrantShares: number = 0,              // Total shares granted (vest over the schedule)
    public rsuVestFrequency: RSUVestFrequency = 'quarterly', // How often tranches vest
    public rsuExpectedStockGrowth: number = 7,      // Expected annual stock appreciation for FMV projection
    public rsuAccountId: string | null = null,      // Linked RSU account
    public rsuWithholdingRate: number = 37,         // Tax withholding % at vest (supplemental wages; default 37%)
    public pensionSystem: PensionSystem = 'NONE',   // Which pension system this job is covered by
    startMilestoneId?: string,
    endMilestoneId?: string,
    public employerMatchType: EmployerMatchType = 'fixed',
    public employerMatchPercent: number = 0,
    public employerMatchMax: number = 0,  // Annual cap in dollars (0 = no cap)
  ) {
    super(id, name, amount, frequency, earned_income, startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'WorkIncome';
  }

  getEffectiveAnnualEmployerMatch(year?: number): number {
    if (this.employerMatchType === 'percent') {
      const annualSalary = this.getProratedAnnual(this.amount, year);
      const matchAmount = annualSalary * (this.employerMatchPercent / 100);
      if (this.employerMatchMax > 0) {
        const activeMult = year !== undefined ? getIncomeActiveMultiplier(this as unknown as AnyIncome, year) : 1;
        return Math.min(matchAmount, this.employerMatchMax * activeMult);
      }
      return matchAmount;
    }
    return this.getProratedAnnual(this.employerMatch, year);
  }
  increment (assumptions: AssumptionsState, year?: number, age?: number): WorkIncome {
    const salaryGrowth = assumptions.income.salaryGrowth / 100;
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    // 1. Grow Salary
    const newAmount = this.amount * (1 + salaryGrowth + generalInflation);

    // 2. Grow Employer Match
    // (Assuming match is a % of salary, so it grows at the same rate as salary)
    const newMatch = this.employerMatch * (1 + salaryGrowth + generalInflation);

    // 3. Grow Contributions (401k, Roth, HSA)
    let newPreTax = this.preTax401k;
    let newRoth = this.roth401k;
    let newHSA = this.hsaContribution;

    switch (this.contributionGrowthStrategy) {
      case 'GROW_WITH_SALARY':
        newPreTax = this.preTax401k * (1 + salaryGrowth + generalInflation);
        newRoth = this.roth401k * (1 + salaryGrowth + generalInflation);
        newHSA = this.hsaContribution * (1 + salaryGrowth + generalInflation);
        break;
      case 'TRACK_ANNUAL_MAX':
        // Cap contributions at IRS annual limits
        if (year !== undefined && age !== undefined) {
          // Get annual limits (includes catch-up for age 50+/55+)
          const inflationAdjusted = assumptions.macro.inflationAdjusted;
          // Contributions are stored per pay period, so cap against per-period limits.
          const limit401k = this.annualToPerPeriod(get401kLimit(year, age, inflationAdjusted));
          const limitHSA = this.annualToPerPeriod(getHSALimit(year, age, 'individual', inflationAdjusted));

          // Combined 401k limit (pre-tax + Roth share same limit)
          // Grow current values first, then cap at limit
          const grownPreTax = this.preTax401k * (1 + salaryGrowth + generalInflation);
          const grownRoth = this.roth401k * (1 + salaryGrowth + generalInflation);
          const grownTotal401k = grownPreTax + grownRoth;

          if (grownTotal401k > limit401k) {
            // Cap at limit, maintaining ratio between pre-tax and Roth
            const ratio = grownTotal401k > 0 ? grownPreTax / grownTotal401k : 0.5;
            newPreTax = limit401k * ratio;
            newRoth = limit401k * (1 - ratio);
          } else {
            newPreTax = grownPreTax;
            newRoth = grownRoth;
          }

          // Cap HSA at limit
          const grownHSA = this.hsaContribution * (1 + salaryGrowth + generalInflation);
          newHSA = Math.min(grownHSA, limitHSA);
        } else {
          // Fallback to grow with salary if year/age not provided
          newPreTax = this.preTax401k * (1 + salaryGrowth + generalInflation);
          newRoth = this.roth401k * (1 + salaryGrowth + generalInflation);
          newHSA = this.hsaContribution * (1 + salaryGrowth + generalInflation);
        }
        break;
      case 'FIXED':
      default:
        // Values remain the same
        break;
    }

    // 3b. Apply auto-max 401k if enabled (overrides the above logic)
    if (this.autoMax401k === 'disabled') {
      // No 401k contributions
      newPreTax = 0;
      newRoth = 0;
    } else if ((this.autoMax401k === 'traditional' || this.autoMax401k === 'roth') && year !== undefined && age !== undefined) {
      // The IRS limit is annual; store it per pay period to match the field's unit.
      const perPeriodLimit = this.annualToPerPeriod(get401kLimit(year, age, assumptions.macro.inflationAdjusted));
      if (this.autoMax401k === 'traditional') {
        newPreTax = perPeriodLimit;
        newRoth = 0;
      } else {
        newPreTax = 0;
        newRoth = perPeriodLimit;
      }
    }

    // 4. Grow Insurance Cost
    // Insurance grows with salary (it's a payroll deduction)
    const newInsurance = this.insurance * (1 + salaryGrowth + generalInflation);

    // ESPP: for PERCENTAGE the stored value is a percent of salary — it stays
    // constant here and the dollar amount tracks salary at consumption time
    // (getAnnualESPPContribution). Only a FIXED per-period amount may grow.
    let newESPPAmount = this.esppContributionAmount;
    if (this.esppContributionType === 'FIXED' && this.contributionGrowthStrategy === 'GROW_WITH_SALARY') {
      newESPPAmount = this.esppContributionAmount * (1 + salaryGrowth + generalInflation);
    }

    return new WorkIncome(
      this.id,
      this.name,
      newAmount,
      this.frequency,
      this.earned_income,
      newPreTax,
      newInsurance,
      newRoth,
      newMatch,
      this.matchAccountId,
      this.taxType,
      this.contributionGrowthStrategy,
      this.startDate,
      this.end_date,
      newHSA,
      this.autoMax401k,
      this.esppContributionType,
      newESPPAmount,
      this.esppDiscountPercent,
      this.esppHasLookback,
      this.esppOfferingPeriodMonths,
      this.esppAccountId,
      this.esppExpectedStockGrowth,
      // RSU fields are share counts / rates, not dollar amounts — carry forward unchanged.
      this.rsuVestingSchedule,
      this.rsuGrantShares,
      this.rsuVestFrequency,
      this.rsuExpectedStockGrowth,
      this.rsuAccountId,
      this.rsuWithholdingRate,
      this.pensionSystem,
      this.startMilestoneId,
      this.endMilestoneId,
      this.employerMatchType,
      this.employerMatchPercent,
      this.employerMatchMax,
    );
  }

  /**
   * Get the effective 401k contributions for a given year/age, applying autoMax401k if enabled
   * @param inflationAdjusted - If true, projects limits for future years with inflation. Defaults to true.
   */
  getEffective401k(year: number, age: number, inflationAdjusted: boolean = true): { preTax: number; roth: number } {
    if (this.autoMax401k === 'disabled') {
      return { preTax: 0, roth: 0 };
    }
    if (this.autoMax401k === 'custom') {
      return { preTax: this.preTax401k, roth: this.roth401k };
    }
    // The IRS limit is annual; preTax401k/roth401k are stored per pay period, so spread
    // the limit across the income's pay periods. Consumers re-annualize via getProratedAnnual.
    const perPeriodLimit = this.annualToPerPeriod(get401kLimit(year, age, inflationAdjusted));
    if (this.autoMax401k === 'traditional') {
      return { preTax: perPeriodLimit, roth: 0 };
    } else {
      return { preTax: 0, roth: perPeriodLimit };
    }
  }

  /**
   * Get the annual ESPP contribution based on contribution type and salary
   */
  getAnnualESPPContribution(year?: number): number {
    if (this.esppContributionType === 'NONE') {
      return 0;
    }

    const annualSalary = this.getAnnualAmount(year);

    if (this.esppContributionType === 'PERCENTAGE') {
      // esppContributionAmount is a percentage (e.g., 10 for 10%)
      return annualSalary * (this.esppContributionAmount / 100);
    } else {
      // FIXED: esppContributionAmount is per-period, convert to annual
      return this.getProratedAnnual(this.esppContributionAmount, year);
    }
  }

  /**
   * Number of years over which the grant vests, per the schedule.
   */
  private getRSUVestingYears(): number {
    switch (this.rsuVestingSchedule) {
      case 'cliff-1yr': return 1;
      case 'graded-3yr': return 3;
      case 'graded-4yr': return 4;
      default: return 0;
    }
  }

  /**
   * Number of vesting events per year implied by the configured frequency.
   */
  private getRSUVestsPerYear(): number {
    switch (this.rsuVestFrequency) {
      case 'quarterly': return 4;
      case 'semi-annual': return 2;
      case 'annual': return 1;
      default: return 1;
    }
  }

  /**
   * Build the full vesting schedule for the grant as a list of tranches, each
   * with a fractional year offset from the grant date and the shares vesting
   * at that point.
   *
   * - cliff-1yr: 100% vests at the 1-year mark (frequency ignored — a cliff is
   *   a single event by definition).
   * - graded-3yr / graded-4yr: shares vest evenly across the period at the
   *   configured frequency (e.g. 4yr quarterly = 16 equal tranches at 0.25,
   *   0.5, ... 4.0 years).
   *
   * The grant is the WorkIncome's start date (startDate).
   */
  getRSUVestSchedule(): { yearOffset: number; shares: number }[] {
    if (!isActiveRSUGrant(this)) {
      return [];
    }

    // Memoize the tranche list, keyed on the schedule-defining inputs so a
    // mutated field invalidates the cache. Avoids rebuilding it on every
    // getAnnualRSUVestShares call (per account, per year, ×1000 in Monte Carlo).
    // The cache is held on a NON-ENUMERABLE property so it never leaks into the
    // QR / localStorage serializer (shortenKeys dumps all enumerable own keys).
    const cacheKey = `${this.rsuVestingSchedule}|${this.rsuGrantShares}|${this.rsuVestFrequency}`;
    const cache = this._rsuScheduleCache;
    if (cache && cache.key === cacheKey) {
      return cache.schedule;
    }

    const schedule = this.buildRSUVestSchedule();
    Object.defineProperty(this, '_rsuScheduleCache', {
      value: { key: cacheKey, schedule },
      enumerable: false,
      writable: true,
      configurable: true,
    });
    return schedule;
  }

  private buildRSUVestSchedule(): { yearOffset: number; shares: number }[] {
    const vestingYears = this.getRSUVestingYears();

    if (this.rsuVestingSchedule === 'cliff-1yr') {
      // A cliff vests all at once at the 1-year mark.
      return [{ yearOffset: 1, shares: this.rsuGrantShares }];
    }

    const vestsPerYear = this.getRSUVestsPerYear();
    const totalVests = vestingYears * vestsPerYear;
    const sharesPerVest = this.rsuGrantShares / totalVests;
    const periodFraction = 1 / vestsPerYear;

    const schedule: { yearOffset: number; shares: number }[] = [];
    for (let i = 1; i <= totalVests; i++) {
      schedule.push({ yearOffset: i * periodFraction, shares: sharesPerVest });
    }
    return schedule;
  }

  /**
   * Get the number of shares vesting in a given calendar year, based on the
   * grant date (startDate, or the milestone-resolved `anchorDate`) and the
   * vesting schedule. Returns 0 when RSUs aren't configured or there is no
   * anchor (no startDate and no anchorDate).
   */
  getAnnualRSUVestShares(year: number, anchorDate?: Date): number {
    return this.getRSUVestEventsForYear(year, anchorDate).reduce((sum, ev) => sum + ev.shares, 0);
  }

  /**
   * Resolve the individual vest events (date + shares) that land in a given
   * calendar year. Each tranche's vest date is the grant date advanced by its
   * fractional yearOffset (grant month-of-year carries over), so a mid-year
   * grant's quarterly vests bucket into the correct calendar years AND retain
   * their real vest month — used to stamp the lot's vestDate (long-term /
   * minimum-holding eligibility depend on the actual date, not Jan 1).
   *
   * The grant date (anchor) is normally the income's fixed `startDate`. For a
   * MILESTONE-started grant (`startDate` undefined, `startMilestoneId` set) the
   * caller passes `anchorDate` — Jan 1 of the milestone-resolved start year (see
   * RSUVesting.processRSUVesting / issue #131). With NEITHER a startDate nor an
   * anchor there is nothing to schedule against, so no events vest.
   *
   * Dates are constructed LOCAL (new Date(y, m, d)) — never via ISO strings —
   * to avoid the recurring date-only UTC off-by-one.
   */
  getRSUVestEventsForYear(year: number, anchorDate?: Date): { vestDate: Date; shares: number }[] {
    if (!isActiveRSUGrant(this)) {
      return [];
    }
    // Anchor on the explicit anchorDate (milestone-resolved start) when given,
    // else the fixed startDate. No anchor at all → nothing to vest against.
    const anchor = anchorDate ?? this.startDate;
    if (!anchor) return [];

    const grant = new Date(anchor);
    const grantYear = grant.getFullYear();
    const grantMonth = grant.getMonth();
    const grantDay = grant.getDate();

    const events: { vestDate: Date; shares: number }[] = [];
    for (const tranche of this.getRSUVestSchedule()) {
      // Vest date = grant date + yearOffset years. Resolve to an absolute
      // month index off the grant month so the calendar bucket and the real
      // vest month both come from the same computation.
      const totalMonths = grantMonth + Math.round(tranche.yearOffset * 12);
      const vestYear = grantYear + Math.floor(totalMonths / 12);
      if (vestYear !== year) continue;
      const vestMonth = ((totalMonths % 12) + 12) % 12;
      // Clamp the day to the vest month's length so a day-29–31 grant doesn't
      // overflow into the next month (e.g. a Jan-31 grant's Feb tranche would be
      // new Date(y, 1, 31) → Mar 3), which would shift the lot's short/long-term
      // and minimum-holding-period boundary by a few days.
      const lastDayOfVestMonth = new Date(vestYear, vestMonth + 1, 0).getDate();
      const vestDay = Math.min(grantDay, lastDayOfVestMonth);
      events.push({
        vestDate: new Date(vestYear, vestMonth, vestDay),
        shares: tranche.shares,
      });
    }
    return events;
  }
}

export class SocialSecurityIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: IncomeFrequency,
    public claimingAge: number,
    public fullRetirementAgeBenefit?: number, // Optional: store FRA benefit for reference
    startDate?: Date,
    end_date?: Date,
    startMilestoneId?: string,
    endMilestoneId?: string,
  ) {
    super(id, name, amount, frequency, "No", startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'SocialSecurityIncome';
  }

  /**
   * Calculate the benefit adjustment factor based on claiming age
   * Full Retirement Age (FRA) is 67 for people born in 1960 or later
   * @param claimingAge Age when benefits are claimed (62-70)
   * @returns Adjustment factor (e.g., 0.70 for age 62, 1.24 for age 70)
   */
  static calculateBenefitAdjustment(claimingAge: number): number {
    // Claiming before FRA (67) reduces benefits by ~6.67% per year
    // Claiming after FRA increases benefits by 8% per year (up to age 70)
    const FRA = 67;

    if (claimingAge < 62) return 0.70; // Minimum is age 62
    if (claimingAge >= 70) return 1.24; // Maximum is age 70

    if (claimingAge < FRA) {
      // Early claiming: ~6.67% reduction per year before FRA
      // Age 62: 70%, Age 63: 75%, Age 64: 80%, Age 65: 86.7%, Age 66: 93.3%, Age 67: 100%
      const yearsEarly = FRA - claimingAge;
      const reductionFactor = 0.0667; // ~6.67% per year (simplified)
      return Math.max(0.70, 1.0 - (yearsEarly * reductionFactor));
    } else {
      // Delayed claiming: 8% increase per year after FRA
      // Age 68: 108%, Age 69: 116%, Age 70: 124%
      const yearsDelayed = claimingAge - FRA;
      return 1.0 + (yearsDelayed * 0.08);
    }
  }

  /**
   * Calculate benefit amount based on FRA benefit and claiming age
   * @param fraBenefit Benefit amount at Full Retirement Age (67)
   * @param claimingAge Age when claiming (62-70)
   * @returns Adjusted benefit amount
   */
  static calculateBenefitFromFRA(fraBenefit: number, claimingAge: number): number {
    const adjustmentFactor = SocialSecurityIncome.calculateBenefitAdjustment(claimingAge);
    return fraBenefit * adjustmentFactor;
  }

  increment (assumptions: AssumptionsState): SocialSecurityIncome {
    const generalInflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    return new SocialSecurityIncome(
      this.id,
      this.name,
      this.amount * (1 + generalInflation),
      this.frequency,
      this.claimingAge,
      this.fullRetirementAgeBenefit ? this.fullRetirementAgeBenefit * (1 + generalInflation) : undefined,
      this.startDate,
      this.end_date,
      this.startMilestoneId,
      this.endMilestoneId
    );
  }
}

export class PassiveIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: IncomeFrequency,
    earned_income: "Yes" | "No",
    public sourceType: 'Dividend' | 'Rental' | 'Royalty' | 'Interest' | 'RMD' | 'RSU' | 'Other',
    startDate?: Date,
    end_date?: Date,
    public isReinvested: boolean = false,  // If true, income is taxable but not available as spendable cash (e.g., savings interest that stays in the account)
    startMilestoneId?: string,
    endMilestoneId?: string,
  ) {
    super(id, name, amount, frequency, earned_income, startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'PassiveIncome';
  }
  increment (assumptions: AssumptionsState): PassiveIncome {
    let growthRate = 0;

    // Smart defaults based on source
    switch (this.sourceType) {
      case 'Rental':
        // Rents tend to grow faster than general inflation
        growthRate = (assumptions.expenses.rentInflation + (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0)) / 100;
        break;
      case 'Interest':
        // Interest income is generated fresh each year based on account balance
        // It doesn't grow independently - the growth comes from the account balance increasing
        growthRate = 0;
        break;
      case 'RMD':
        // RMD income is regenerated each year based on account balance and age
        // It doesn't grow independently - the amount is recalculated each year
        growthRate = 0;
        break;
      case 'Dividend':
      case 'Royalty':
      case 'Other':
      default:
        // Default to general inflation to maintain purchasing power
        growthRate = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
        break;
    }

    return new PassiveIncome(
      this.id,
      this.name,
      this.amount * (1 + growthRate),
      this.frequency,
      this.earned_income,
      this.sourceType,
      this.startDate,
      this.end_date,
      this.isReinvested,
      this.startMilestoneId,
      this.endMilestoneId
    );
  }
}

export class WindfallIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: IncomeFrequency,
    earned_income: "Yes" | "No",
    startDate?: Date,
    end_date?: Date,
    startMilestoneId?: string,
    endMilestoneId?: string,
  ) {
    super(id, name, amount, frequency, earned_income, startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'WindfallIncome';
  }
  increment (assumptions: AssumptionsState): WindfallIncome {
    const inflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    // Only grow if the user marked it as inflation adjusted

    return new WindfallIncome(
      this.id,
      this.name,
      this.amount * (1 + inflation),
      this.frequency,
      this.earned_income,
      this.startDate,
      this.end_date,
      this.startMilestoneId,
      this.endMilestoneId
    );
  }
}

/**
 * CurrentSocialSecurityIncome
 *
 * For users who are already receiving Social Security benefits:
 * - Disability (SSDI)
 * - Survivor benefits
 * - Retirement benefits (already claimed)
 *
 * Amount is manually entered and grows with COLA (Cost of Living Adjustment).
 * COLA typically tracks inflation rate.
 */
export class CurrentSocialSecurityIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    amount: number,
    frequency: IncomeFrequency,
    startDate?: Date,
    end_date?: Date,
    startMilestoneId?: string,
    endMilestoneId?: string,
  ) {
    // Social Security is never considered "earned income" for tax purposes
    super(id, name, amount, frequency, "No", startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'CurrentSocialSecurityIncome';
  }

  increment(assumptions: AssumptionsState): CurrentSocialSecurityIncome {
    // COLA (Cost of Living Adjustment) tracks inflation
    const cola = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    return new CurrentSocialSecurityIncome(
      this.id,
      this.name,
      this.amount * (1 + cola),
      this.frequency,
      this.startDate,
      this.end_date,
      this.startMilestoneId,
      this.endMilestoneId
    );
  }
}

/**
 * FutureSocialSecurityIncome
 *
 * For future retirement benefits that will be automatically calculated
 * based on earnings history using SSA's AIME/PIA formula.
 *
 * Key features:
 * - Amount is calculated by SimulationEngine (not user-entered)
 * - Calculation triggered when user reaches claiming age
 * - Uses 35 highest earning years with wage indexing
 * - Start date = claiming age (auto-computed)
 * - End date = life expectancy (auto-set)
 *
 * calculatedPIA stores the monthly benefit amount.
 * When calculatedPIA = 0, the benefit hasn't been calculated yet.
 */
export class FutureSocialSecurityIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    public claimingAge: number,
    public calculatedPIA: number = 0,  // Monthly benefit at claiming (feeds amount)
    public calculationYear: number = 0,  // Year when PIA was calculated
    startDate?: Date,
    end_date?: Date,
    startMilestoneId?: string,
    endMilestoneId?: string,
    public projectedPIA: number = 0,  // Monthly benefit for planning (does NOT feed amount)
  ) {
    // Amount is annual (calculatedPIA × 12)
    // Social Security is never considered "earned income" for tax purposes
    super(id, name, calculatedPIA * 12, 'Annually', "No", startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'FutureSocialSecurityIncome';
  }

  increment(assumptions: AssumptionsState): FutureSocialSecurityIncome {
    // After benefits start, grow with COLA (inflation)
    const cola = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    return new FutureSocialSecurityIncome(
      this.id,
      this.name,
      this.claimingAge,
      this.calculatedPIA * (1 + cola),
      this.calculationYear,
      this.startDate,
      this.end_date,
      this.startMilestoneId,
      this.endMilestoneId,
      this.projectedPIA * (1 + cola)  // Keep projectedPIA in sync with COLA
    );
  }
}

/**
 * FERSPensionIncome
 *
 * Federal Employees Retirement System pension for federal employees hired after 1983.
 * FERS is a three-part retirement plan: Basic Benefit + Social Security + TSP.
 *
 * This class models the Basic Benefit component:
 * - Formula: Years of Service × High-3 × Multiplier (1% or 1.1%)
 * - COLA: Reduced (CPI-1% if inflation > 3%)
 * - FERS Supplement: Bridge payment from MRA to age 62
 *
 * The pension is auto-calculated when the user reaches retirement age.
 */
export class FERSPensionIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    public yearsOfService: number,
    public high3Salary: number,
    public retirementAge: number,
    public birthYear: number,
    public calculatedBenefit: number = 0,  // Annual benefit, calculated by simulation
    public fersSupplement: number = 0,      // Annual FERS Supplement (ends at 62)
    public estimatedSSAt62: number = 0,     // For calculating FERS Supplement
    startDate?: Date,
    end_date?: Date,
    public autoCalculateHigh3: boolean = false,  // If true, calculate High-3 from linked income
    public linkedIncomeId: string | null = null,  // Work income to track for High-3 calculation
    startMilestoneId?: string,
    endMilestoneId?: string,
  ) {
    // Amount is the calculated annual benefit
    super(id, name, calculatedBenefit, 'Annually', "No", startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'FERSPensionIncome';
  }

  /**
   * Calculate the FERS pension benefit
   * Called by SimulationEngine when retirement is reached
   *
   * Delegates to getDisplayedFERSBenefit so the simulation and the displayed
   * estimate share a single source of truth for the basic-benefit + MRA+10
   * reduction math (no risk of one drifting from the other).
   */
  calculateBenefit(): number {
    return getDisplayedFERSBenefit(
      this.yearsOfService,
      this.high3Salary,
      this.retirementAge,
      this.birthYear
    );
  }

  /**
   * Calculate FERS Supplement amount
   * Only available if retiring before age 62 with immediate unreduced retirement
   */
  calculateSupplement(): number {
    if (this.retirementAge >= 62) return 0;
    if (this.estimatedSSAt62 <= 0) return 0;

    // Check eligibility (MRA+10 retirees generally don't get supplement)
    const eligibility = checkFERSEligibility(
      this.retirementAge,
      this.yearsOfService,
      this.birthYear
    );

    // Only full retirees (no reduction) get the supplement
    if (eligibility.reductionPercent > 0) return 0;

    return calculateFERSSupplement(this.yearsOfService, this.estimatedSSAt62 / 12);
  }

  increment(assumptions: AssumptionsState, _year?: number, age?: number): FERSPensionIncome {
    const inflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;
    const currentAge = age || this.retirementAge;

    // FERS COLA is reduced compared to full CPI
    const cola = getFERSCOLA(inflation, currentAge);

    // FERS Supplement ends at age 62. The real FERS Annuity Supplement receives NO
    // COLA — it is a fixed bridge payment from retirement until 62 — so it must NOT
    // grow with `cola`. (The basic benefit below still gets the COLA.)
    const newSupplement = currentAge >= 62 ? 0 : this.fersSupplement;

    return new FERSPensionIncome(
      this.id,
      this.name,
      this.yearsOfService,
      this.high3Salary * (1 + inflation), // High-3 doesn't grow after retirement, but keep for reference
      this.retirementAge,
      this.birthYear,
      this.calculatedBenefit * (1 + cola),
      newSupplement,
      this.estimatedSSAt62 * (1 + inflation),
      this.startDate,
      this.end_date,
      this.autoCalculateHigh3,
      this.linkedIncomeId,
      this.startMilestoneId,
      this.endMilestoneId
    );
  }

  /**
   * Get total annual income including FERS Supplement
   */
  getTotalAnnualAmount(year?: number): number {
    const base = this.getAnnualAmount(year);
    if (base <= 0) return 0;
    // Prorate the FERS supplement with the same active-year multiplier as the base
    // benefit, so a mid-year start prorates both identically (matches getProratedAnnual).
    const activeMult = year !== undefined ? getIncomeActiveMultiplier(this as unknown as AnyIncome, year) : 1;
    return base + (this.fersSupplement || 0) * activeMult;
  }
}

/**
 * CSRSPensionIncome
 *
 * Civil Service Retirement System pension for federal employees hired before 1984.
 * CSRS is a standalone pension system with no Social Security coverage.
 *
 * Formula:
 * - 1.5% × High-3 × first 5 years
 * - 1.75% × High-3 × years 6-10
 * - 2.0% × High-3 × years 11+
 * - Maximum: 80% of High-3
 *
 * COLA: Full CPI adjustment
 */
export class CSRSPensionIncome extends BaseIncome {
  constructor(
    id: string,
    name: string,
    public yearsOfService: number,
    public high3Salary: number,
    public retirementAge: number,
    public calculatedBenefit: number = 0,  // Annual benefit, calculated by simulation
    startDate?: Date,
    end_date?: Date,
    public autoCalculateHigh3: boolean = false,  // If true, calculate High-3 from linked income
    public linkedIncomeId: string | null = null,  // Work income to track for High-3 calculation
    startMilestoneId?: string,
    endMilestoneId?: string,
  ) {
    // Amount is the calculated annual benefit
    super(id, name, calculatedBenefit, 'Annually', "No", startDate, end_date, 0.03, startMilestoneId, endMilestoneId);
    this.className = 'CSRSPensionIncome';
  }

  /**
   * Calculate the CSRS pension benefit
   * Called by SimulationEngine when retirement is reached
   *
   * Delegates to getDisplayedCSRSBenefit so the simulation and the displayed
   * estimate share a single source of truth for the basic-benefit +
   * early-retirement reduction math (no risk of one drifting from the other).
   */
  calculateBenefit(): number {
    return getDisplayedCSRSBenefit(
      this.yearsOfService,
      this.high3Salary,
      this.retirementAge
    );
  }

  increment(assumptions: AssumptionsState): CSRSPensionIncome {
    const inflation = (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0) / 100;

    // CSRS gets full COLA
    const cola = getCSRSCOLA(inflation);

    return new CSRSPensionIncome(
      this.id,
      this.name,
      this.yearsOfService,
      this.high3Salary, // Doesn't grow after retirement
      this.retirementAge,
      this.calculatedBenefit * (1 + cola),
      this.startDate,
      this.end_date,
      this.autoCalculateHigh3,
      this.linkedIncomeId,
      this.startMilestoneId,
      this.endMilestoneId
    );
  }
}

export type AnyIncome = WorkIncome | SocialSecurityIncome | CurrentSocialSecurityIncome | FutureSocialSecurityIncome | FERSPensionIncome | CSRSPensionIncome | PassiveIncome | WindfallIncome;

/**
 * Calculate the year when Social Security benefits should start
 * @param birthYear User's birth year
 * @param claimingAge Age when claiming SS (62-70)
 * @returns Year when SS benefits begin
 */
export function calculateSocialSecurityStartYear(
    birthYear: number,
    claimingAge: number
): number {
    return birthYear + claimingAge;
}

/**
 * Calculate the start date for Social Security income
 * @param birthYear User's birth year
 * @param claimingAge Age when claiming SS (62-70)
 * @param claimingMonth Month when claiming (0-11, defaults to 0 for January)
 * @returns Date object for when SS benefits begin
 */
export function calculateSocialSecurityStartDate(
    birthYear: number,
    claimingAge: number,
    claimingMonth: number = 0
): Date {
    const year = calculateSocialSecurityStartYear(birthYear, claimingAge);
    // Date-only value: build at LOCAL midnight (parseDate convention) so it reads
    // back as the same Y-M-D in any timezone.
    return new Date(year, claimingMonth, 1);
}

export function getIncomeActiveMultiplier(income: AnyIncome, year: number): number {
    return getActiveWindowMultiplier({ startDate: income.startDate, endDate: income.end_date }, year);
}

/**
 * Fraction of `year` (in twelfths) that the income is active WITHIN the sub-window
 * of months [fromMonthInclusive..December]. This is the TRUE month-interval overlap
 * of a partial-year tail with the income's active window — unlike
 * `min(remainingFraction, getIncomeActiveMultiplier)`, which double-counts a job that
 * ended EARLIER in the year (e.g. ended March, tail = Oct–Dec → real overlap 0, but
 * the min gives ~2 months). Mirrors getActiveWindowMultiplier's local-midnight,
 * inclusive month-boundary convention; a missing startDate is treated as "now",
 * a missing endDate as open-ended. `fromMonthInclusive` is a 0-indexed month.
 */
export function getIncomeActiveMonthOverlap(
    income: AnyIncome,
    year: number,
    fromMonthInclusive: number,
): number {
    const startDate = income.startDate ? new Date(income.startDate) : new Date();
    const startYear = startDate.getFullYear();
    const endDate = income.end_date ? new Date(income.end_date) : null;
    const endYear = endDate ? endDate.getFullYear() : null;

    if (startYear > year) return 0;
    if (endYear !== null && endYear < year) return 0;

    const windowStartMonth = (startYear < year) ? 0 : startDate.getMonth();
    const windowEndMonth = (endDate && endYear === year) ? endDate.getMonth() : 11;

    // Intersect the active window [windowStartMonth..windowEndMonth] with the
    // requested tail [fromMonthInclusive..11] (December = 11).
    const from = Math.max(0, fromMonthInclusive);
    const overlapStart = Math.max(windowStartMonth, from);
    const overlapEnd = Math.min(windowEndMonth, 11);
    return Math.max(0, overlapEnd - overlapStart + 1) / 12;
}

export function isIncomeActiveInCurrentMonth(income: AnyIncome): boolean {
    return isWindowActiveInCurrentMonth({ startDate: income.startDate, endDate: income.end_date });
}

// True when an income has definitively ENDED (fixed end date in a past month). Used
// to suppress the #141 missing-account warning on a finished job — its grant/ESPP can
// no longer vest, so the warning is pure noise. Conservative: a milestone-ended income
// (no fixed end_date) reads as not-ended and still warns.
export function hasIncomeEnded(income: AnyIncome): boolean {
    return hasWindowEnded({ startDate: income.startDate, endDate: income.end_date });
}

// True for any Social Security income: the base SocialSecurityIncome plus the two
// concrete variants (Current/Future). These are sibling classes that each extend
// BaseIncome directly — SocialSecurityIncome is NOT a superclass of the other two —
// so each must be matched explicitly. Also matches by `className` so reconstituted
// (deserialized) objects are caught even if their prototype chain was not restored.
export function isSocialSecurity(inc: { className?: string }): boolean {
    if (
        inc instanceof SocialSecurityIncome ||
        inc instanceof FutureSocialSecurityIncome ||
        inc instanceof CurrentSocialSecurityIncome
    ) {
        return true;
    }
    const className = inc.className;
    return (
        className === 'SocialSecurityIncome' ||
        className === 'FutureSocialSecurityIncome' ||
        className === 'CurrentSocialSecurityIncome'
    );
}

export const INCOME_CATEGORIES = [
  'Work',
  'SocialSecurity',
  'Pension',
  'Passive',
  'Windfall',
] as const;

export type IncomeCategory = typeof INCOME_CATEGORIES[number];

export const INCOME_COLORS_BACKGROUND: Record<IncomeCategory, string> = {
    Work: "bg-chart-Fuchsia-50",
    SocialSecurity: "bg-chart-Blue-50",
    Pension: "bg-chart-Green-50",
    Passive: "bg-chart-Yellow-50",
    Windfall: "bg-chart-Red-50",
};

export const CLASS_TO_CATEGORY: Record<string, IncomeCategory> = {
    [WorkIncome.name]: 'Work',
    [SocialSecurityIncome.name]: 'SocialSecurity',
    [CurrentSocialSecurityIncome.name]: 'SocialSecurity',
    [FutureSocialSecurityIncome.name]: 'SocialSecurity',
    [FERSPensionIncome.name]: 'Pension',
    [CSRSPensionIncome.name]: 'Pension',
    [PassiveIncome.name]: 'Passive',
    [WindfallIncome.name]: 'Windfall'
};

// Map Categories to their color palettes (using Tailwind classes)
// Uses 5-step gradients (1, 25, 50, 75, 100) defined in :root for SVG access
const PALETTE_STEPS = [1, 25, 50, 75, 100];
export const CATEGORY_PALETTES: Record<IncomeCategory, string[]> = {
	Work: PALETTE_STEPS.map(i => `bg-chart-Fuchsia-${i}`),
	SocialSecurity: PALETTE_STEPS.map(i => `bg-chart-Blue-${i}`),
	Pension: PALETTE_STEPS.map(i => `bg-chart-Green-${i}`),
	Passive: PALETTE_STEPS.map(i => `bg-chart-Yellow-${i}`),
	Windfall: PALETTE_STEPS.map(i => `bg-chart-Red-${i}`),
};

/**
 * Deterministic 32-bit string hash (djb2-style, base-36). Identical to the one
 * in simulationHash.ts but inlined here to keep this module free of an import
 * cycle (simulationHash imports from this file). Used only to mint a STABLE id
 * from an income's own content when the deserialized id is empty.
 */
function hashIncomeContent(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash; // 32-bit
    }
    return (hash >>> 0).toString(36);
}

/**
 * Mint a deterministic, content-derived id for an income whose deserialized id
 * is empty/missing (QR/JSON imports and very old backups can lack one). The id
 * must be:
 *  - DETERMINISTIC across reconstitutions of the SAME data, so getSimulationInputHash
 *    (which serializes income.id) is identical across reloads — a fresh RANDOM id
 *    would make the hash differ every load and trip a spurious staleness banner.
 *  - UNIQUE across DISTINCT imported incomes, so every inc.id-keyed consumer
 *    (CashflowDetailBuilder's per-income deferral map, RSU/ESPP lot ids) attributes
 *    each income separately instead of one clobbering another on a shared "" key.
 * It's derived from the income's identifying content (class + name + amount +
 * frequency + dates), which differs between distinct jobs. Two byte-identical
 * incomes that both lack an id still collide — a genuinely-ambiguous corner the
 * consumer guards still backstop — but that's vanishingly rare and harmless
 * (interchangeable rows), whereas the common "two different imported jobs" case
 * is now resolved at the source.
 */
function deriveStableIncomeId(data: Record<string, unknown>): string {
    const fingerprint = JSON.stringify([
        data.className,
        data.name,
        data.amount,
        data.frequency,
        data.startDate,
        data.end_date,
    ]);
    return `inc-${hashIncomeContent(fingerprint)}`;
}

export function reconstituteIncome(data: unknown): AnyIncome | null {
    if (!hasClassName(data)) return null;

    // Preserve a MISSING startDate as undefined — do NOT force-fill with new Date().
    // Milestone-started incomes (startMilestoneId set) carry startDate undefined BY
    // DESIGN; a wall-clock fallback would (a) re-anchor RSU vest schedules to the reload
    // instant so a milestone-anchored grant vests zero shares (resolveRSUAnchorDate short-
    // circuits on any truthy startDate), and (b) destabilize the simulation input hash
    // (startDate serializes as a fresh instant every reload). All startDate consumers are
    // undefined-safe and treat a missing start as "now", so the no-anchor case is unchanged.
    const startDate = parseDate(data.startDate);
    const endDate = parseDate(data.end_date);
    const frequency = (data.frequency as IncomeFrequency) || 'Monthly';
    const base = extractBaseFields(data, 'Unnamed Income');
    const { name, amount } = base;
    // A missing/empty deserialized id (old backups, QR/JSON imports) would otherwise
    // leave every imported income sharing id="" — corrupting inc.id-keyed consumers.
    // Mint a deterministic, content-derived id so the same data reconstitutes to the
    // same id (stable simulation hash) while distinct incomes stay unique.
    const id = base.id || deriveStableIncomeId(data);
    const earned_income = (data.earned_income as "Yes" | "No") || "No";
    const startMilestoneId = data.startMilestoneId ? String(data.startMilestoneId) : undefined;
    const endMilestoneId = data.endMilestoneId ? String(data.endMilestoneId) : undefined;

    switch (data.className) {
        case 'WorkIncome': {
            // Map old 'none' value to 'custom' for backwards compatibility
            const autoMax401k = data.autoMax401k === 'none' ? 'custom' : (data.autoMax401k || 'custom');
            return new WorkIncome(
                id, name, amount, frequency, earned_income,
                Number(data.preTax401k) || 0, Number(data.insurance) || 0,
                Number(data.roth401k) || 0, Number(data.employerMatch) || 0,
                String(data.matchAccountId ?? ''), (data.taxType as TaxType) || null,
                (data.contributionGrowthStrategy as ContributionGrowthStrategy) || 'FIXED',
                startDate, endDate, Number(data.hsaContribution) || 0, autoMax401k as AutoMax401kOption,
                (data.esppContributionType as ESPPContributionType) || 'NONE',
                Number(data.esppContributionAmount) || 0,
                Number(data.esppDiscountPercent ?? 15),
                (data.esppHasLookback as boolean) ?? true,
                Number(data.esppOfferingPeriodMonths ?? 6),
                data.esppAccountId ? String(data.esppAccountId) : null,
                Number(data.esppExpectedStockGrowth ?? 7),
                (data.rsuVestingSchedule as RSUVestingSchedule) || 'NONE',
                Number(data.rsuGrantShares) || 0,
                (data.rsuVestFrequency as RSUVestFrequency) || 'quarterly',
                Number(data.rsuExpectedStockGrowth ?? 7),
                data.rsuAccountId ? String(data.rsuAccountId) : null,
                Number(data.rsuWithholdingRate ?? 37),
                (data.pensionSystem as PensionSystem) || 'NONE',
                startMilestoneId, endMilestoneId,
                (data.employerMatchType as EmployerMatchType) || 'fixed',
                Number(data.employerMatchPercent) || 0,
                Number(data.employerMatchMax) || 0,
            );
        }
        case 'SocialSecurityIncome':
            return new SocialSecurityIncome(
                id, name, amount, frequency, Number(data.claimingAge) || 67,
                Number(data.fullRetirementAgeBenefit) || 0, startDate, endDate,
                startMilestoneId, endMilestoneId
            );
        case 'PassiveIncome':
            return new PassiveIncome(
                id, name, amount, frequency, earned_income,
                (data.sourceType as PassiveIncome['sourceType']) || 'Other',
                startDate, endDate, (data.isReinvested as boolean) ?? false,
                startMilestoneId, endMilestoneId
            );
        case 'WindfallIncome':
            return new WindfallIncome(id, name, amount, frequency, earned_income, startDate, endDate,
                startMilestoneId, endMilestoneId);
        case 'CurrentSocialSecurityIncome':
            return new CurrentSocialSecurityIncome(id, name, amount, frequency, startDate, endDate,
                startMilestoneId, endMilestoneId);
        case 'FutureSocialSecurityIncome':
            return new FutureSocialSecurityIncome(
                id, name, Number(data.claimingAge) || 67,
                Number(data.calculatedPIA) || 0, Number(data.calculationYear) || 0,
                startDate, endDate, startMilestoneId, endMilestoneId,
                Number(data.projectedPIA) || 0  // Preserve projectedPIA across save/reload
            );
        case 'FERSPensionIncome':
            return new FERSPensionIncome(
                id, name, Number(data.yearsOfService) || 0, Number(data.high3Salary) || 0,
                Number(data.retirementAge) || 62, Number(data.birthYear) || 1970,
                Number(data.calculatedBenefit) || 0, Number(data.fersSupplement) || 0,
                Number(data.estimatedSSAt62) || 0, startDate, endDate,
                (data.autoCalculateHigh3 as boolean) || false,
                data.linkedIncomeId ? String(data.linkedIncomeId) : null,
                startMilestoneId, endMilestoneId
            );
        case 'CSRSPensionIncome':
            return new CSRSPensionIncome(
                id, name, Number(data.yearsOfService) || 0, Number(data.high3Salary) || 0,
                Number(data.retirementAge) || 55, Number(data.calculatedBenefit) || 0,
                startDate, endDate, (data.autoCalculateHigh3 as boolean) || false,
                data.linkedIncomeId ? String(data.linkedIncomeId) : null,
                startMilestoneId, endMilestoneId
            );
        default:
            return null;
    }
}