# Stag Financial Planning - Capabilities

A concise overview of everything Stag can track and model.

---

## Accounts (5 types)

| Type | Description |
|------|-------------|
| **Savings** | Savings accounts, CDs, money market with interest rate |
| **Invested** | 401k, IRA, Roth, HSA, Brokerage with vesting, employer match, expense ratio, custom ROR |
| **Property** | Real estate with appreciation and linked mortgage |
| **Debt** | Credit cards, personal loans, student loans with APR |
| **Deficit** | System-generated tracking when expenses exceed income |

---

## Income (6 types)

| Type | Description |
|------|-------------|
| **Work** | Salary with 401k/Roth/HSA contributions, employer match, insurance deductions |
| **Social Security (Projected)** | Future SS with claiming age adjustment (62-70) |
| **Social Security (Current)** | Already-claimed SS with COLA |
| **Social Security (Auto)** | Calculated from earnings history using SSA formula |
| **Passive** | Dividends, rental, royalties, interest |
| **Windfall** | One-time income (inheritance, bonuses, severance) |

---

## Expenses (10 types)

| Type | Description |
|------|-------------|
| **Rent** | Rent + utilities with separate inflation rates |
| **Mortgage** | Full amortization with principal/interest split, taxes, insurance, PMI, HOA |
| **Loan** | Auto, personal, student loans with payoff tracking |
| **Dependent** | Childcare, education, support |
| **Healthcare** | Medical expenses with healthcare inflation |
| **Vacation** | Travel costs (discretionary) |
| **Emergency** | One-time unexpected costs |
| **Transport** | Car, gas, insurance, maintenance, transit |
| **Food** | Groceries and dining |
| **Other** | Miscellaneous expenses |

---

## Tax Calculations

- **Federal**: 7 brackets, standard/itemized deductions, SALT cap ($10k/$40k)
- **State**: California, DC, Texas (extensible)
- **FICA**: Social Security (6.2%) + Medicare (1.45%/2.35%)
- **Capital Gains**: Long-term rates (0%, 15%, 20%)
- **Social Security Taxation**: 50%/85% thresholds based on combined income
- **HSA**: Triple tax advantage (pre-tax, tax-free growth, tax-free withdrawals)

---

## Retirement Features

- **Social Security**: Full SSA calculation (AIME, PIA, bend points, wage indexing)
- **Claiming Age**: Adjustments for ages 62-70 (reduced/delayed credits)
- **Earnings Test**: Benefit reduction for early claimers who work
- **Withdrawal Strategies**: Fixed Real, Percentage, Guyton-Klinger (dynamic)
- **Auto Roth Conversions**: Fill lower tax brackets in retirement (22% target)
- **Milestones**: 59.5 (penalty-free), 62 (SS), 65 (Medicare), 67 (FRA), 70 (max SS), 73 (RMDs)
- **FI Detection**: Automatic financial independence year calculation

---

## Analysis & Simulation

- **Monte Carlo**: 100-1000 scenarios with seeded PRNG, percentile bands, success rate
- **Historical Backtest**: Test against all 30-year periods since 1928 (S&P 500 + Treasury)
- **Scenario Comparison**: Save, load, compare multiple plans with delta analysis
- **Financial Ratios**: 10 metrics (savings rate, debt-to-income, etc.) with benchmarks
- **Tax Optimization**: Contribution tracking, Roth conversion windows, bracket recommendations

---

## Configurable Assumptions

| Category | Settings |
|----------|----------|
| **Demographics** | Current age, retirement age, life expectancy |
| **Growth Rates** | Inflation (2.6%), investment return (5.9%), healthcare inflation (3.9%) |
| **Income** | Salary growth, Social Security start age |
| **Expenses** | Lifestyle creep, housing appreciation, rent inflation |
| **Investments** | Withdrawal strategy, withdrawal rate, Guyton-Klinger guardrails |
| **Allocation** | Priority buckets (MAX, FIXED, MULTIPLE_OF_EXPENSES, REMAINDER) |

---

## Visualizations

- **Sankey Diagram**: Income → deductions → taxes → expenses → savings flow
- **Net Worth Chart**: Historical and projected net worth over time
- **Assets Stream**: Stacked area chart of all asset accounts
- **Debt Stream**: Debt payoff timeline
- **Icicle Charts**: Hierarchical breakdown of accounts, income, expenses
- **Fan Chart**: Monte Carlo percentile bands (10th, 25th, 50th, 75th, 90th)
- **Milestone Timeline**: Visual retirement timeline with key age markers

---

## Data Sources

- **Tax Brackets**: Federal + state data for 2024-2026
- **Contribution Limits**: IRS 401k/IRA/HSA limits with catch-up
- **Historical Returns**: S&P 500 + 10-Year Treasury (1928-2024)
- **Social Security**: Wage index, bend points, FRA tables

---

## What's NOT Tracked (Yet)

- RMDs (Required Minimum Distributions)
- Federal pensions (FERS/CSRS)
- Real estate rental income/depreciation
- AMT, NIIT, QBI deduction
- Medicare/long-term care costs
- International assets

---

*Last updated: January 2026*
