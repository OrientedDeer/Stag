/**
 * Historical Market Data (1928-2024)
 *
 * Sources:
 * - S&P 500 & Bonds: NYU Stern (Aswath Damodaran) https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html
 * - Inflation (CPI): US Inflation Calculator https://www.usinflationcalculator.com/inflation/historical-inflation-rates/
 *
 * All returns are annual total returns (including dividends/interest reinvested)
 */

// S&P 500 Total Returns (including dividends) by year
export const SP500_RETURNS: Record<number, number> = {
  1928: 43.81,
  1929: -8.30,
  1930: -25.12,
  1931: -43.84,
  1932: -8.64,
  1933: 49.98,
  1934: -1.19,
  1935: 46.74,
  1936: 31.94,
  1937: -35.34,
  1938: 29.28,
  1939: -1.10,
  1940: -10.67,
  1941: -12.77,
  1942: 19.17,
  1943: 25.06,
  1944: 19.03,
  1945: 35.82,
  1946: -8.43,
  1947: 5.20,
  1948: 5.70,
  1949: 18.30,
  1950: 30.81,
  1951: 23.68,
  1952: 18.15,
  1953: -1.21,
  1954: 52.56,
  1955: 32.60,
  1956: 7.44,
  1957: -10.46,
  1958: 43.72,
  1959: 12.06,
  1960: 0.34,
  1961: 26.64,
  1962: -8.81,
  1963: 22.61,
  1964: 16.42,
  1965: 12.40,
  1966: -9.97,
  1967: 23.80,
  1968: 10.81,
  1969: -8.24,
  1970: 3.56,
  1971: 14.22,
  1972: 18.76,
  1973: -14.31,
  1974: -25.90,
  1975: 37.00,
  1976: 23.83,
  1977: -6.98,
  1978: 6.51,
  1979: 18.52,
  1980: 31.74,
  1981: -4.70,
  1982: 20.42,
  1983: 22.34,
  1984: 6.15,
  1985: 31.24,
  1986: 18.49,
  1987: 5.81,
  1988: 16.54,
  1989: 31.48,
  1990: -3.06,
  1991: 30.23,
  1992: 7.49,
  1993: 9.97,
  1994: 1.33,
  1995: 37.20,
  1996: 22.68,
  1997: 33.10,
  1998: 28.34,
  1999: 20.89,
  2000: -9.03,
  2001: -11.85,
  2002: -21.97,
  2003: 28.36,
  2004: 10.74,
  2005: 4.83,
  2006: 15.61,
  2007: 5.48,
  2008: -36.55,
  2009: 25.94,
  2010: 14.82,
  2011: 2.10,
  2012: 15.89,
  2013: 32.15,
  2014: 13.52,
  2015: 1.38,
  2016: 11.77,
  2017: 21.61,
  2018: -4.23,
  2019: 31.21,
  2020: 18.02,
  2021: 28.47,
  2022: -18.04,
  2023: 26.06,
  2024: 24.88,
};

// 10-Year Treasury Bond Total Returns by year
export const BOND_RETURNS: Record<number, number> = {
  1928: 0.84,
  1929: 4.20,
  1930: 4.54,
  1931: -2.56,
  1932: 8.79,
  1933: 1.86,
  1934: 7.96,
  1935: 4.47,
  1936: 5.02,
  1937: 1.38,
  1938: 4.21,
  1939: 4.41,
  1940: 5.40,
  1941: -2.02,
  1942: 2.29,
  1943: 2.49,
  1944: 2.58,
  1945: 3.80,
  1946: 3.13,
  1947: 0.92,
  1948: 1.95,
  1949: 4.66,
  1950: 0.43,
  1951: -0.30,
  1952: 2.27,
  1953: 4.14,
  1954: 3.29,
  1955: -1.34,
  1956: -2.26,
  1957: 6.80,
  1958: -2.10,
  1959: -2.65,
  1960: 11.64,
  1961: 2.06,
  1962: 5.69,
  1963: 1.68,
  1964: 3.73,
  1965: 0.72,
  1966: 2.91,
  1967: -1.58,
  1968: 3.27,
  1969: -5.01,
  1970: 16.75,
  1971: 9.79,
  1972: 2.82,
  1973: 3.66,
  1974: 1.99,
  1975: 3.61,
  1976: 15.98,
  1977: 1.29,
  1978: -0.78,
  1979: 0.67,
  1980: -2.99,
  1981: 8.20,
  1982: 32.81,
  1983: 3.20,
  1984: 13.73,
  1985: 25.71,
  1986: 24.28,
  1987: -4.96,
  1988: 8.22,
  1989: 17.69,
  1990: 6.24,
  1991: 15.00,
  1992: 9.36,
  1993: 14.21,
  1994: -8.04,
  1995: 23.48,
  1996: 1.43,
  1997: 9.94,
  1998: 14.92,
  1999: -8.25,
  2000: 16.66,
  2001: 5.57,
  2002: 15.12,
  2003: 0.38,
  2004: 4.49,
  2005: 2.87,
  2006: 1.96,
  2007: 10.21,
  2008: 20.10,
  2009: -11.12,
  2010: 8.46,
  2011: 16.04,
  2012: 2.97,
  2013: -9.10,
  2014: 10.75,
  2015: 1.28,
  2016: 0.69,
  2017: 2.80,
  2018: -0.02,
  2019: 9.64,
  2020: 11.33,
  2021: -4.42,
  2022: -17.83,
  2023: 3.88,
  2024: -1.64,
};

// Annual CPI Inflation Rates by year
export const INFLATION_RATES: Record<number, number> = {
  1928: -1.7,
  1929: 0.0,
  1930: -2.3,
  1931: -9.0,
  1932: -9.9,
  1933: -5.1,
  1934: 3.1,
  1935: 2.2,
  1936: 1.5,
  1937: 3.6,
  1938: -2.1,
  1939: -1.4,
  1940: 0.7,
  1941: 5.0,
  1942: 10.9,
  1943: 6.1,
  1944: 1.7,
  1945: 2.3,
  1946: 8.3,
  1947: 14.4,
  1948: 8.1,
  1949: -1.2,
  1950: 1.3,
  1951: 7.9,
  1952: 1.9,
  1953: 0.8,
  1954: 0.7,
  1955: -0.4,
  1956: 1.5,
  1957: 3.3,
  1958: 2.8,
  1959: 0.7,
  1960: 1.7,
  1961: 1.0,
  1962: 1.0,
  1963: 1.3,
  1964: 1.3,
  1965: 1.6,
  1966: 2.9,
  1967: 3.1,
  1968: 4.2,
  1969: 5.5,
  1970: 5.7,
  1971: 4.4,
  1972: 3.2,
  1973: 6.2,
  1974: 11.0,
  1975: 9.1,
  1976: 5.8,
  1977: 6.5,
  1978: 7.6,
  1979: 11.3,
  1980: 13.5,
  1981: 10.3,
  1982: 6.2,
  1983: 3.2,
  1984: 4.3,
  1985: 3.6,
  1986: 1.9,
  1987: 3.6,
  1988: 4.1,
  1989: 4.8,
  1990: 5.4,
  1991: 4.2,
  1992: 3.0,
  1993: 3.0,
  1994: 2.6,
  1995: 2.8,
  1996: 3.0,
  1997: 2.3,
  1998: 1.6,
  1999: 2.2,
  2000: 3.4,
  2001: 2.8,
  2002: 1.6,
  2003: 2.3,
  2004: 2.7,
  2005: 3.4,
  2006: 3.2,
  2007: 2.8,
  2008: 3.8,
  2009: -0.4,
  2010: 1.6,
  2011: 3.2,
  2012: 2.1,
  2013: 1.5,
  2014: 1.6,
  2015: 0.1,
  2016: 1.3,
  2017: 2.1,
  2018: 2.4,
  2019: 1.8,
  2020: 1.2,
  2021: 4.7,
  2022: 8.0,
  2023: 4.1,
  2024: 2.9,
};

// Helper to calculate statistics from a record of yearly values
function calculateStats(data: Record<number, number>): { mean: number; stdDev: number; min: number; max: number } {
  const values = Object.values(data);
  const n = values.length;

  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);

  return { mean: Math.round(mean * 100) / 100, stdDev: Math.round(stdDev * 100) / 100, min, max };
}

// Pre-computed statistics for each asset class
export const HISTORICAL_STATS = {
  stocks: {
    ...calculateStats(SP500_RETURNS),
    startYear: Math.min(...Object.keys(SP500_RETURNS).map(Number)),
    endYear: Math.max(...Object.keys(SP500_RETURNS).map(Number)),
    description: 'S&P 500 Total Return (with dividends)',
  },
  bonds: {
    ...calculateStats(BOND_RETURNS),
    startYear: Math.min(...Object.keys(BOND_RETURNS).map(Number)),
    endYear: Math.max(...Object.keys(BOND_RETURNS).map(Number)),
    description: '10-Year Treasury Bond Total Return',
  },
  inflation: {
    ...calculateStats(INFLATION_RATES),
    startYear: Math.min(...Object.keys(INFLATION_RATES).map(Number)),
    endYear: Math.max(...Object.keys(INFLATION_RATES).map(Number)),
    description: 'Consumer Price Index (CPI) Annual Change',
  },
};

// Get all available years (intersection of all datasets)
export const AVAILABLE_YEARS = Object.keys(SP500_RETURNS)
  .map(Number)
  .filter(year => BOND_RETURNS[year] !== undefined && INFLATION_RATES[year] !== undefined)
  .sort((a, b) => a - b);

// Get return data for a specific year
export function getYearReturns(year: number): { stocks: number; bonds: number; inflation: number } | null {
  if (!SP500_RETURNS[year] || !BOND_RETURNS[year] || INFLATION_RATES[year] === undefined) {
    return null;
  }
  return {
    stocks: SP500_RETURNS[year],
    bonds: BOND_RETURNS[year],
    inflation: INFLATION_RATES[year],
  };
}

// Get a sequence of returns for a range of years
export function getReturnSequence(startYear: number, years: number): Array<{ year: number; stocks: number; bonds: number; inflation: number }> | null {
  const sequence: Array<{ year: number; stocks: number; bonds: number; inflation: number }> = [];

  for (let i = 0; i < years; i++) {
    const year = startYear + i;
    const returns = getYearReturns(year);
    if (!returns) return null; // Not enough data
    sequence.push({ year, ...returns });
  }

  return sequence;
}

// Calculate blended portfolio return for a given year
export function getBlendedReturn(year: number, stockAllocation: number): number | null {
  const returns = getYearReturns(year);
  if (!returns) return null;

  const bondAllocation = 1 - stockAllocation;
  return (stockAllocation * returns.stocks) + (bondAllocation * returns.bonds);
}

// Calculate real (inflation-adjusted) return
export function getRealReturn(nominalReturn: number, inflation: number): number {
  // Real return = ((1 + nominal) / (1 + inflation)) - 1
  return ((1 + nominalReturn / 100) / (1 + inflation / 100) - 1) * 100;
}

// Notable historical periods for highlighting in UI
export const NOTABLE_PERIODS = {
  worstStart: { year: 1966, description: 'Stagflation era - worst 30-year start' },
  greatDepression: { year: 1929, description: 'Great Depression began' },
  dotComCrash: { year: 2000, description: 'Dot-com bubble burst' },
  financialCrisis: { year: 2008, description: 'Global Financial Crisis' },
  bestDecade: { year: 1990, description: 'Best decade for stocks (1990s)' },
  highInflation: { year: 1980, description: 'Peak inflation era' },
};
