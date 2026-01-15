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

- [x] **Assumptions error handling** - Added deep merge migration logic that fills in missing fields from defaults. Handles old localStorage data, invalid JSON, wrong types, and missing nested objects gracefully.

---

## Completed

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

### UX (needs brainstorming)
- 401k employer contribution UX improvements
- Gross Amount tooltip clarity
- ESPP support

### Features
- Real estate enhancements (property sale, depreciation, capital gains)
- Budget tracking (actual vs projected)
- Optional localStorage encryption
- Zero bracket harvesting (withdraw from Traditional tax-free when below standard deduction)
  - Needs design work on interaction with Auto Roth Conversions
  - Should zero bracket harvesting take priority over conversions?
  - Independent vs sequential calculation approach

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
