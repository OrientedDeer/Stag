# Stag - Roadmap

## Pending User Testing

These features are complete but need validation:

- **Budget Tracking Tab** - CSV import, category mappings, spending analysis
- **ESPP Accounts** - Lot tracking, tax calculations, withdrawal preferences
- **Tax Optimization Tab** - Recommendations need accuracy review
- **Scenario Comparison Tool** - Compare saved scenarios
- **Financial Ratios Tab** - Benchmarks need validation
- **SSA Earnings Import** - XML import for accurate SS calculation

*Note: Testing tab and experimental calculators (Roth Analysis panel) are behind "Experimental Features" toggle.*

---

## High Priority

### Testing/Debug Tab Enhancements

Available tabs: Simulation Debug, Tax Debug, Tax Brackets, Social Security, Pensions, RMDs, Roth Analysis, Ratios, Mortgage, QR Code, Withdrawals, Accounts, Income & Expenses, Cash Flow, Validation

**Tax Calculations**
- [x] Federal Tax - Bracket breakdown, marginal vs effective rates, deductions applied
- [x] State Tax - State-specific calculations, deduction differences
- [x] FICA/Payroll - Social Security wage base, Medicare surtax thresholds
- [x] Capital Gains - Short vs long-term, tax-loss harvesting opportunities
- [x] Tax Bracket Visualization - Show where income lands in brackets each year

**Retirement Income Sources**
- [x] Social Security - PIA calculation, bend points, claiming age impact
- [x] Pensions (FERS/CSRS) - High-3 tracking, years of service, COLA adjustments
- [x] RMDs - Table values, calculated amounts by account, aggregation rules

**Withdrawal Logic**
- [x] Withdrawal Order - Which accounts drained, amounts from each, why
- [ ] Roth Conversions - Auto-conversion decisions, tax impact, optimal amounts
- [x] Early Withdrawal Penalties - When 10% penalty applies, amounts
- [x] Guyton-Klinger Details - Guardrail triggers, adjustment calculations

**Account Growth**
- [x] Investment Returns - Year-by-year growth, nominal vs real returns
- [x] Contribution Limits - 401k/IRA/HSA limits by year, catch-up contributions
- [x] Employer Matching - Match calculations, vesting schedules

**Income & Expenses**
- [x] Salary Projections - Growth rates, inflation adjustment, lifestyle creep
- [x] Expense Breakdown - Fixed vs discretionary, inflation by category
- [x] Healthcare Costs - Age-based inflation, Medicare transition

**Priority/Allocation**
- [x] Priority Waterfall - Monthly allocation flow, caps hit, remainder
- [ ] Emergency Fund Tracking - Target vs actual, months of expenses

**Aggregate Views**
- [x] Net Worth Timeline - Assets vs liabilities breakdown
- [x] Cash Flow Summary - Income vs expenses vs savings by year
- [x] Inflation Impact - Purchasing power erosion visualization

**Validation/Warnings**
- [x] Data Consistency Checks - Impossible values, date conflicts
- [x] Assumption Conflicts - Contradictory settings
- [x] Missing Data Alerts - Required fields not filled

---

## Recently Completed

- **Roth vs Pre-Tax Analysis Panel** - New calculator on Tax tab with contribution/conversion modes, explicit growth years, break-even rate, tax rate sparkline, and auto-optimal amount detection (experimental)
- **Tab Visibility Restructure** - Tax, Scenarios, and Ratios tabs are now always visible; Testing tab moved behind experimental toggle
- **Debug Tabs Expansion** - Added 5 new Testing tab groups: Withdrawals, Accounts, Income & Expenses, Cash Flow, Validation (15 new debug sections total)
- **Roth Conversion Tax Fix** - Fixed $0 tax cost bug where conversion tax didn't account for Traditional withdrawal income in the same year
- **Withdrawal Balance Guard** - Fixed phantom money bug where Roth conversions and expense withdrawals could overdraw the same account (now respects prior outflows)
- **Chart Layout Stability** - Info banners on cashflow chart no longer shift the chart when appearing/disappearing
- **ESPP Support** - Full Employee Stock Purchase Plan account tracking with lot-level detail, qualifying/disqualifying disposition tax handling, configurable withdrawal preferences
- **Budget Tracking** - Track actual spending vs projections with CSV import, auto-categorization rules, monthly snapshots, spending trends analysis

---

## Later

### Features
- Real estate enhancements (property sale, depreciation, capital gains)
- Optional localStorage encryption
- Zero bracket harvesting (withdraw from Traditional tax-free when below standard deduction)
  - Needs design work on interaction with Auto Roth Conversions
- 5-year Roth conversion tracking
  - Converted amounts have a 5-year holding period before penalty-free withdrawal (if under 59½)
  - Each conversion starts its own 5-year clock
  - Would need to track conversion history by year and amount

### Technical Debt
- Screen reader testing
- Monte Carlo performance testing
- Roth conversion tax payment improvement
  - Currently grosses up Roth withdrawal to pay conversion tax
  - Consider grossing up the next account in withdrawal order instead
