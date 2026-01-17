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

## Completed

### Recent Session
- [x] Tax Bracket Visualization tab - Year-by-year bracket fill visualization, marginal/effective rates
- [x] Pension Debug tab - FERS/CSRS calculation breakdown, High-3 tracking, COLA projections
- [x] Tax Debug tab - Federal bracket breakdown, state tax, FICA, capital gains with year-by-year view
- [x] Social Security Debug tab - AIME/PIA calculation, bend points, claiming age comparison, earnings history
- [x] RMD Debug tab - SECURE Act 2.0 rules, distribution periods, year-by-year RMD projections
- [x] Icicle chart color fixes - Added Cyan palette for Subscriptions, Orange for Charity
- [x] Icicle chart `inheritColorFromParent={false}` - Distributed colors now work correctly
- [x] Cap Gains Tax color - Changed from lime to amber in Sankey chart
- [x] Icicle chart labels - Simplified truncation, reduced skip thresholds
- [x] Testing debug tab - Added auto-recalculation (matches Charts tab behavior)
- [x] Testing tab infinite refresh - Fixed hash storage check
- [x] Income amount tooltip - Clarifies gross income before deductions
- [x] Priority default names - Use friendly labels (e.g., "Emergency Fund" not "MULTIPLE_OF_EXPENSES")
- [x] Expense discretionary defaults - Vacation, Subscription, Charity, Other default to discretionary
- [x] GK expense swing warning - Suppressed when Guyton-Klinger guardrails trigger
- [x] GK info banner - Added explanation of large spending swings on Assumptions tab
- [x] Growth rates info - Added note that rates are real (above inflation)
- [x] Assumptions error handling - Deep merge migration fills missing fields from defaults

### Bug Fixes (from GitHub Issue #3)
- [x] Leading zero in number inputs
- [x] Icicle Chart text overlap on account chart
- [x] Animation glitch when editing account/expense names
- [x] Contribution Eligible button sizing after page resize
- [x] Employee contributions toggle showing for non-employee accounts

### UX Improvements (from GitHub Issue #3)
- [x] Dropdown styling consistency (using @headlessui/react)
- [x] Enter key should exit edit mode
- [x] Hamburger menu left-side spacing
- [x] Buffer spacing below TAX LOGIC and "How Withdrawals Work"
- [x] Allocation page refactor - Redesigned as "Paycheck Allocator"

### Features
- [x] Streaming/subscription expense category
- [x] Lifestyle creep
- [x] Federal pension (FERS/CSRS)
- [x] RMDs (Required Minimum Distributions)

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
