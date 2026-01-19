# Stag - Roadmap

## Pending User Testing

These features are complete but need validation:

- **Tax Optimization Tab** - Recommendations need accuracy review
- **Scenario Comparison Tool** - Compare saved scenarios
- **Financial Ratios Tab** - Benchmarks need validation
- **SSA Earnings Import** - XML import for accurate SS calculation
- **Excel Export** - 9-sheet export in Data tab

*Note: Tax, Scenarios, Ratios tabs are behind "Experimental Features" toggle.*

---

## High Priority

### Testing/Debug Tab Enhancements

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
- [ ] Withdrawal Order - Which accounts drained, amounts from each, why
- [ ] Roth Conversions - Auto-conversion decisions, tax impact, optimal amounts
- [ ] Early Withdrawal Penalties - When 10% penalty applies, amounts
- [ ] Guyton-Klinger Details - Guardrail triggers, adjustment calculations

**Account Growth**
- [ ] Investment Returns - Year-by-year growth, nominal vs real returns
- [ ] Contribution Limits - 401k/IRA/HSA limits by year, catch-up contributions
- [ ] Employer Matching - Match calculations, vesting schedules

**Income & Expenses**
- [ ] Salary Projections - Growth rates, inflation adjustment, lifestyle creep
- [ ] Expense Breakdown - Fixed vs discretionary, inflation by category
- [ ] Healthcare Costs - Age-based inflation, Medicare transition

**Priority/Allocation**
- [ ] Priority Waterfall - Monthly allocation flow, caps hit, remainder
- [ ] Emergency Fund Tracking - Target vs actual, months of expenses

**Aggregate Views**
- [ ] Net Worth Timeline - Assets vs liabilities breakdown
- [ ] Cash Flow Summary - Income vs expenses vs savings by year
- [ ] Inflation Impact - Purchasing power erosion visualization

**Validation/Warnings**
- [ ] Data Consistency Checks - Impossible values, date conflicts
- [ ] Assumption Conflicts - Contradictory settings
- [ ] Missing Data Alerts - Required fields not filled

---

## Later

### UX
- 401k employer contribution UX improvements
- ESPP support

### Features
- Real estate enhancements (property sale, depreciation, capital gains)
- Budget tracking (actual vs projected)
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
- Tooltip jittering/flickering
- Roth conversion tax payment improvement
  - Currently grosses up Roth withdrawal to pay conversion tax
  - Consider grossing up the next account in withdrawal order instead

---

## Stats

- 835 unit tests, 54 E2E tests passing
