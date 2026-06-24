/**
 * Social Security Administration (SSA) Historical Data
 *
 * This file contains official SSA data used for calculating Social Security benefits:
 * - Wage indexing factors (for adjusting historical earnings to current wage levels)
 * - Bend points (thresholds used in Primary Insurance Amount calculation)
 * - Maximum taxable earnings (Social Security wage base)
 * - Full Retirement Age by birth year
 *
 * Sources:
 * - SSA National Average Wage Index: https://www.ssa.gov/oact/cola/AWI.html
 * - SSA Bend Points: https://www.ssa.gov/oact/cola/bendpoints.html
 * - SSA Contribution and Benefit Base: https://www.ssa.gov/oact/cola/cbb.html
 */

/**
 * Average Wage Index Factors
 *
 * Used to index historical earnings to age-60 wage levels.
 * Formula: IndexedEarnings = ActualEarnings × (AvgWageAtAge60 / AvgWageInEarningYear)
 *
 * For earnings after age 60, no indexing is applied (factor = 1.0).
 * The indexing year is typically when the worker turns 60.
 *
 * Example: For someone turning 62 in 2024 (born 1962):
 * - They turned 60 in 2022
 * - 2022 Average Wage Index = $63,795.13
 * - For earnings in 2000 ($40,000): IndexedEarnings = $40,000 × (63795.13 / 32154.82) = $79,323
 */
const WAGE_INDEX_FACTORS: Record<number, number> = {
  // Historical data from SSA (actual values)
  1951: 2951.92,
  1952: 3098.68,
  1953: 3273.42,
  1954: 3293.80,
  1955: 3378.29,
  1956: 3594.55,
  1957: 3724.29,
  1958: 3784.05,
  1959: 3920.37,
  1960: 4050.21,
  1961: 4123.36,
  1962: 4304.62,
  1963: 4403.72,
  1964: 4598.99,
  1965: 4723.99,
  1966: 4965.38,
  1967: 5185.60,
  1968: 5580.78,
  1969: 5940.18,
  1970: 6334.04,
  1971: 6642.00,
  1972: 7168.35,
  1973: 7686.50,
  1974: 8251.89,
  1975: 8675.58,
  1976: 9249.13,
  1977: 9779.44,
  1978: 10556.03,
  1979: 11554.58,
  1980: 12696.77,
  1981: 13977.05,
  1982: 14878.34,
  1983: 15589.64,
  1984: 16555.07,
  1985: 17275.54,
  1986: 17962.59,
  1987: 18788.17,
  1988: 19793.23,
  1989: 20571.40,
  1990: 21458.48,
  1991: 21831.01,
  1992: 22577.16,
  1993: 23139.07,
  1994: 23829.05,
  1995: 24715.39,
  1996: 25821.08,
  1997: 27354.84,
  1998: 29010.71,
  1999: 30491.62,
  2000: 32154.82,
  2001: 32974.62,
  2002: 33544.66,
  2003: 34535.35,
  2004: 35797.14,
  2005: 36917.82,
  2006: 38744.11,
  2007: 40649.27,
  2008: 41639.48,
  2009: 40729.68,
  2010: 41641.61,
  2011: 42892.19,
  2012: 44321.67,
  2013: 44888.16,
  2014: 46199.29,
  2015: 47826.74,
  2016: 48617.80,
  2017: 50326.69,
  2018: 52145.80,
  2019: 54099.99,
  2020: 55628.60,
  2021: 58177.46,
  2022: 63795.13,
  2023: 66621.80,
  2024: 69846.57,
  // Projected from the 2024 actual at ~2.5% annual growth; SSA values for these years not yet published.
  2025: 71592.73,
  2026: 73382.55,
  2027: 75217.11,
  2028: 77097.54,
  2029: 79024.98,
  2030: 81000.60,
};

/**
 * Bend Points by Year
 *
 * Used in the Primary Insurance Amount (PIA) calculation formula:
 * PIA = (90% × first bend point) + (32% × amount between bend points) + (15% × amount above second bend point)
 *
 * Example for 2024:
 * If AIME = $5,000/month:
 * PIA = (0.90 × $1,115) + (0.32 × ($5,000 - $1,115)) + (0.15 × 0)
 *     = $1,003.50 + $1,243.20 + $0
 *     = $2,246.70/month
 */
const BEND_POINTS: Record<number, { first: number; second: number }> = {
  2000: { first: 531, second: 3202 },
  2001: { first: 561, second: 3381 },
  2002: { first: 592, second: 3567 },
  2003: { first: 606, second: 3653 },
  2004: { first: 612, second: 3689 },
  2005: { first: 627, second: 3779 },
  2006: { first: 656, second: 3955 },
  2007: { first: 680, second: 4100 },
  2008: { first: 711, second: 4288 },
  2009: { first: 744, second: 4483 },
  2010: { first: 761, second: 4586 },
  2011: { first: 749, second: 4517 },
  2012: { first: 767, second: 4624 },
  2013: { first: 791, second: 4768 },
  2014: { first: 816, second: 4917 },
  2015: { first: 826, second: 4980 },
  2016: { first: 856, second: 5157 },
  2017: { first: 885, second: 5336 },
  2018: { first: 895, second: 5397 },
  2019: { first: 926, second: 5583 },
  2020: { first: 960, second: 5785 },
  2021: { first: 996, second: 6002 },
  2022: { first: 1024, second: 6172 },
  2023: { first: 1115, second: 6721 },
  2024: { first: 1174, second: 7078 },
  2025: { first: 1226, second: 7391 },
  2026: { first: 1286, second: 7749 },
  // Projected from the 2026 actual at ~2.5% annual growth; SSA values for these years not yet published.
  2027: { first: 1318, second: 7943 },
  2028: { first: 1351, second: 8142 },
  2029: { first: 1385, second: 8346 },
  2030: { first: 1420, second: 8555 },
};

/**
 * Social Security Wage Base (Maximum Taxable Earnings)
 *
 * The maximum amount of earnings subject to Social Security tax each year.
 * Earnings above this cap are not taxed for Social Security and do not count toward benefit calculations.
 *
 * Example: In 2024, if you earn $200,000:
 * - Only $168,600 counts for Social Security tax
 * - Only $168,600 counts toward your benefit calculation
 */
const SS_WAGE_BASE: Record<number, number> = {
  2000: 76200,
  2001: 80400,
  2002: 84900,
  2003: 87000,
  2004: 87900,
  2005: 90000,
  2006: 94200,
  2007: 97500,
  2008: 102000,
  2009: 106800,
  2010: 106800,
  2011: 106800,
  2012: 110100,
  2013: 113700,
  2014: 117000,
  2015: 118500,
  2016: 118500,
  2017: 127200,
  2018: 128400,
  2019: 132900,
  2020: 137700,
  2021: 142800,
  2022: 147000,
  2023: 160200,
  2024: 168600,
  2025: 176100, // Projected
  2026: 184500,
  2027: 192600,
  2028: 201300,
  2029: 210400,
  2030: 219900,
};

/**
 * Full Retirement Age (FRA) by Birth Year
 *
 * The age at which you're entitled to 100% of your calculated Social Security benefit.
 * Claiming before FRA reduces benefits; claiming after FRA increases them.
 *
 * Birth Year → FRA (in years, decimal for months)
 * 1960+: 67 years
 * 1959: 66 years 10 months = 66.833...
 * 1958: 66 years 8 months = 66.666...
 * 1955-1956: 66 years 2 months = 66.166...
 * 1943-1954: 66 years
 */
const FRA_BY_BIRTH_YEAR: Record<number, number> = {
  1937: 65,
  1938: 65.167, // 65 years 2 months
  1939: 65.333, // 65 years 4 months
  1940: 65.5,   // 65 years 6 months
  1941: 65.667, // 65 years 8 months
  1942: 65.833, // 65 years 10 months
  1943: 66,
  1944: 66,
  1945: 66,
  1946: 66,
  1947: 66,
  1948: 66,
  1949: 66,
  1950: 66,
  1951: 66,
  1952: 66,
  1953: 66,
  1954: 66,
  1955: 66.167, // 66 years 2 months
  1956: 66.333, // 66 years 4 months
  1957: 66.5,   // 66 years 6 months
  1958: 66.667, // 66 years 8 months
  1959: 66.833, // 66 years 10 months
  1960: 67,
  1961: 67,
  1962: 67,
  1963: 67,
  1964: 67,
  1965: 67,
  1966: 67,
  1967: 67,
  1968: 67,
  1969: 67,
  1970: 67,
  1971: 67,
  1972: 67,
  1973: 67,
  1974: 67,
  1975: 67,
  1976: 67,
  1977: 67,
  1978: 67,
  1979: 67,
  1980: 67,
  1981: 67,
  1982: 67,
  1983: 67,
  1984: 67,
  1985: 67,
  1986: 67,
  1987: 67,
  1988: 67,
  1989: 67,
  1990: 67,
  1991: 67,
  1992: 67,
  1993: 67,
  1994: 67,
  1995: 67,
  1996: 67,
  1997: 67,
  1998: 67,
  1999: 67,
  2000: 67,
  2001: 67,
  2002: 67,
  2003: 67,
  2004: 67,
  2005: 67,
};

/**
 * Claiming Age Adjustment Factors
 *
 * Multipliers applied to PIA based on claiming age:
 * - Age 62: 70% (30% reduction for claiming 5 years early)
 * - Age 63: 75% (25% reduction)
 * - Age 64: 80% (20% reduction)
 * - Age 65: 86.7% (13.3% reduction)
 * - Age 66: 93.3% (6.7% reduction)
 * - Age 67 (FRA): 100% (no adjustment)
 * - Age 68: 108% (8% increase per year)
 * - Age 69: 116%
 * - Age 70: 124% (maximum, 24% increase)
 *
 * Early claiming (before FRA): ~6.67% reduction per year (actually 5/9 of 1% per month for first 36 months, then 5/12 of 1%)
 * Delayed claiming (after FRA): 8% increase per year (actually 2/3 of 1% per month)
 */
/**
 * Helper function to get claiming age adjustment factor.
 * Calculates the benefit adjustment based on claiming age relative to Full Retirement Age (FRA).
 *
 * Early claiming (before FRA):
 *   - First 36 months early: 5/9 of 1% reduction per month
 *   - Additional months early: 5/12 of 1% reduction per month
 *
 * Delayed claiming (after FRA):
 *   - 2/3 of 1% increase per month (8% per year)
 *
 * Valid claiming range: 62-70. Ages outside this range use the boundary values.
 */
export function getClaimingAdjustment(claimingAge: number, fra: number = 67): number {
  // Clamp to valid claiming range (62-70)
  const effectiveAge = Math.max(62, Math.min(70, claimingAge));

  const monthsFromFRA = (effectiveAge - fra) * 12;

  if (effectiveAge < fra) {
    // Early claiming reduction
    // First 36 months: 5/9 of 1% per month
    // Additional months: 5/12 of 1% per month
    const firstReduction = Math.min(36, Math.abs(monthsFromFRA)) * (5 / 9) * 0.01;
    const additionalReduction = Math.max(0, Math.abs(monthsFromFRA) - 36) * (5 / 12) * 0.01;
    return 1.0 - firstReduction - additionalReduction;
  } else {
    // Delayed claiming increase
    // 2/3 of 1% per month (8% per year)
    const increase = monthsFromFRA * (2 / 3) * 0.01;
    return 1.0 + increase;
  }
}

/**
 * Helper function to get Full Retirement Age for a birth year
 * Returns 67 for birth years 1960 and later
 */
export function getFRA(birthYear: number): number {
  if (birthYear >= 1960) return 67;
  if (birthYear < 1937) return 65;
  return FRA_BY_BIRTH_YEAR[birthYear] || 67;
}

/**
 * Generic helper to look up yearly data with future projection support.
 * Reduces code duplication across getWageIndexFactor, getBendPoints, getWageBase, etc.
 */
export function lookupYearlyData<T>(
  data: Record<number, T>,
  year: number,
  projectFuture: (baseValue: T, growthMultiplier: number) => T,
  wageGrowthRate: number,
  inflationAdjusted: boolean
): T {
  if (data[year]) {
    return data[year];
  }

  const years = Object.keys(data).map(Number);
  const latestYear = Math.max(...years);
  const earliestYear = Math.min(...years);

  if (year > latestYear) {
    const baseValue = data[latestYear];
    if (!inflationAdjusted) {
      return baseValue;
    }
    const yearsToProject = year - latestYear;
    const growthMultiplier = Math.pow(1 + wageGrowthRate, yearsToProject);
    return projectFuture(baseValue, growthMultiplier);
  }

  return data[earliestYear];
}

/**
 * Helper function to get wage index factor for a given year.
 * For future years beyond available data, projects based on wage growth.
 */
export function getWageIndexFactor(
  year: number,
  wageGrowthRate: number = 0.025,
  inflationAdjusted: boolean = true
): number {
  return lookupYearlyData(
    WAGE_INDEX_FACTORS,
    year,
    (base, multiplier) => Math.round(base * multiplier * 100) / 100,
    wageGrowthRate,
    inflationAdjusted
  );
}

/**
 * Helper function to get bend points for a given year.
 * For future years, uses projection based on wage growth.
 */
export function getBendPoints(
  year: number,
  wageGrowthRate: number = 0.025,
  inflationAdjusted: boolean = true
): { first: number; second: number } {
  return lookupYearlyData(
    BEND_POINTS,
    year,
    (base, multiplier) => ({
      first: Math.round(base.first * multiplier),
      second: Math.round(base.second * multiplier)
    }),
    wageGrowthRate,
    inflationAdjusted
  );
}

/**
 * Helper function to get wage base for a given year.
 * For future years, projects based on wage growth.
 */
export function getWageBase(
  year: number,
  wageGrowthRate: number = 0.025,
  inflationAdjusted: boolean = true
): number {
  return lookupYearlyData(
    SS_WAGE_BASE,
    year,
    (base, multiplier) => Math.round(base * multiplier / 100) * 100,
    wageGrowthRate,
    inflationAdjusted
  );
}

/**
 * Earnings Test Limits
 *
 * Annual earnings limits for the Social Security Retirement Earnings Test (RET).
 * If you claim benefits before Full Retirement Age (FRA) and continue working:
 * - Before FRA: $1 withheld for every $2 earned above limit
 * - Year of FRA (before month of FRA): $1 withheld for every $3 earned above higher limit
 * - After FRA: No earnings test applies
 *
 * Source: https://www.ssa.gov/oact/cola/rtea.html
 */
const EARNINGS_TEST_LIMITS: Record<number, { beforeFRA: number; yearOfFRA: number }> = {
  2020: { beforeFRA: 18240, yearOfFRA: 48600 },
  2021: { beforeFRA: 18960, yearOfFRA: 50520 },
  2022: { beforeFRA: 19560, yearOfFRA: 51960 },
  2023: { beforeFRA: 21240, yearOfFRA: 56520 },
  2024: { beforeFRA: 22320, yearOfFRA: 59520 },
  2025: { beforeFRA: 23400, yearOfFRA: 62160 },
  2026: { beforeFRA: 24480, yearOfFRA: 65160 },  // Official: SSA 2026 COLA fact sheet
  // Future projections based on wage growth
  2027: { beforeFRA: 25100, yearOfFRA: 66800 },
  2028: { beforeFRA: 25700, yearOfFRA: 68500 },
  2029: { beforeFRA: 26300, yearOfFRA: 70200 },
  2030: { beforeFRA: 27000, yearOfFRA: 72000 },
};

/**
 * Helper function to get earnings test limit for a given year.
 * For future years, projects based on wage growth.
 */
export function getEarningsTestLimit(
  year: number,
  wageGrowthRate: number = 0.025,
  inflationAdjusted: boolean = true
): { beforeFRA: number; yearOfFRA: number } {
  return lookupYearlyData(
    EARNINGS_TEST_LIMITS,
    year,
    (base, multiplier) => ({
      beforeFRA: Math.round(base.beforeFRA * multiplier / 100) * 100,
      yearOfFRA: Math.round(base.yearOfFRA * multiplier / 100) * 100
    }),
    wageGrowthRate,
    inflationAdjusted
  );
}
