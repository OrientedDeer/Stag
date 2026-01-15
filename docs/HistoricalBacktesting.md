# Historical Backtesting & Market Data

This document explains how Stag uses historical market data to test retirement plans and inform Monte Carlo simulations.

## Overview

Historical backtesting answers the question: **"If I had retired in any year since 1928, would my plan have worked?"**

Instead of guessing future returns, we replay actual market history to see how your retirement plan would have performed across every possible 30-year (or other length) period.

---

## Data Sources

### Historical Returns (1928-2024)

All data is stored in `src/data/HistoricalReturns.ts` and sourced from:

| Asset Class | Source | Description |
|-------------|--------|-------------|
| **S&P 500** | [NYU Stern (Damodaran)](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html) | Total returns including dividends reinvested |
| **10-Year Treasury** | NYU Stern (Damodaran) | Total bond returns |
| **Inflation (CPI)** | [US Inflation Calculator](https://www.usinflationcalculator.com/inflation/historical-inflation-rates/) | Annual CPI change |

### Historical Statistics

From 1928-2024:

| Metric | Stocks (S&P 500) | Bonds (10-Year Treasury) | Inflation (CPI) |
|--------|------------------|--------------------------|-----------------|
| Mean Annual Return | ~11.8% | ~5.0% | ~3.0% |
| Standard Deviation | ~19.6% | ~7.7% | ~3.9% |
| Best Year | +52.6% (1954) | +32.8% (1982) | +14.4% (1947) |
| Worst Year | -43.8% (1931) | -17.8% (2022) | -9.9% (1932) |

---

## How Backtesting Works

### The Algorithm

For each possible starting year (1928, 1929, ... up to `lastYear - retirementYears`):

1. **Start with initial portfolio balance**
2. **For each year of retirement:**
   - Apply blended return: `(stockAllocation × stockReturn) + (bondAllocation × bondReturn)`
   - Subtract annual withdrawal (optionally inflation-adjusted)
   - Track if balance hits zero (failure)
3. **Record outcome:** success/failure, final balance, lowest balance

### Blended Portfolio Returns

The backtest uses a stock/bond allocation you specify (e.g., 60% stocks / 40% bonds):

```
yearReturn = (0.60 × SP500_RETURNS[year]) + (0.40 × BOND_RETURNS[year])
```

This models a simple rebalanced portfolio.

### Inflation-Adjusted Withdrawals

When enabled, withdrawals increase each year by that year's actual inflation rate:

```
withdrawal[year] = initialWithdrawal × cumulativeInflation[year]
```

This simulates maintaining constant purchasing power.

---

## Interpreting Results

### Success Rate

**What it means:** The percentage of historical periods where your portfolio lasted the entire retirement.

| Success Rate | Interpretation |
|--------------|----------------|
| 95%+ | Very robust - survived nearly all historical periods |
| 80-95% | Good - failed only in worst historical scenarios |
| 60-80% | Concerning - consider lower withdrawal or longer accumulation |
| <60% | High risk - plan needs adjustment |

### Notable Historical Periods

The backtest highlights specific periods:

| Start Year | Event | Why It Matters |
|------------|-------|----------------|
| **1966** | Stagflation Era | Worst 30-year retirement start. High inflation + poor returns. |
| **1929** | Great Depression | Market crashed 80%+ over 3 years |
| **2000** | Dot-Com Crash | Tech bubble burst, followed by 2008 crisis |
| **2008** | Financial Crisis | 37% single-year drop |
| **1982** | Bull Market Start | One of the best times to retire (hindsight!) |

### What "Failure" Means

A period "fails" when the portfolio balance hits $0 before retirement ends. This doesn't mean you'd be destitute—it means your planned withdrawal strategy wouldn't have survived that specific historical sequence.

---

## Monte Carlo Integration

### How Historical Data Informs Monte Carlo

The Monte Carlo simulation uses historical statistics as default inputs:

| Setting | Historical Basis |
|---------|------------------|
| Mean Return | S&P 500 average (nominal or real based on inflation setting) |
| Volatility | S&P 500 standard deviation (~19.6%) |

### Nominal vs Real Returns

The preset automatically adjusts based on your inflation setting:

- **Inflation Adjustment ON:** Uses **nominal** returns (~11.8%) because the simulation will subtract inflation
- **Inflation Adjustment OFF:** Uses **real** returns (~8.5%) which are already inflation-adjusted

### Monte Carlo vs Historical Backtest

| Aspect | Monte Carlo | Historical Backtest |
|--------|-------------|---------------------|
| **Returns** | Random draws from distribution | Actual historical sequences |
| **Scenarios** | 100-1000 synthetic paths | ~67 actual 30-year periods |
| **Captures** | Range of possible futures | What actually happened |
| **Best for** | Probability estimation | Stress testing against real events |

**Use both:** Monte Carlo shows the range of possibilities; historical backtest shows if you'd survive known worst cases.

---

## Code Architecture

### Key Files

| File | Purpose |
|------|---------|
| `src/data/HistoricalReturns.ts` | Raw data + helper functions |
| `src/services/HistoricalBacktest.ts` | Backtest engine |
| `src/tabs/Future/tabs/HistoricalBacktestPanel.tsx` | UI component |
| `src/services/MonteCarloTypes.ts` | Presets using historical stats |

### Key Functions

```typescript
// Run backtest for a single starting year
runSingleBacktest(startYear: number, config: BacktestConfig): BacktestResult

// Run backtest across all valid starting years
runHistoricalBacktest(config: BacktestConfig): BacktestSummary

// Get blended stock/bond return for a year
getBlendedReturn(year: number, stockAllocation: number): number

// Get real (inflation-adjusted) return
getRealReturn(nominalReturn: number, inflation: number): number
```

---

## Limitations

1. **Past ≠ Future:** Historical success doesn't guarantee future success
2. **US-Only:** Data is US stocks/bonds; international diversification not modeled
3. **Simple Rebalancing:** Assumes annual rebalancing to target allocation
4. **No Taxes:** Backtest doesn't account for tax drag on withdrawals
5. **Fixed Allocation:** Doesn't model glide paths or dynamic allocation

---

## References

- [Trinity Study](https://en.wikipedia.org/wiki/Trinity_study) - Original safe withdrawal rate research
- [FICalc](https://ficalc.app/) - Similar historical backtesting tool
- [cFIREsim](https://cfiresim.com/) - Comprehensive retirement simulator
- [Early Retirement Now](https://earlyretirementnow.com/safe-withdrawal-rate-series/) - Deep dive on withdrawal rates
