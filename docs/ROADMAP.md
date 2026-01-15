# Stag Financial Planning Application - Feature Roadmap

## Executive Summary

This roadmap outlines a strategic plan for evolving Stag from a solid personal financial planning tool into a comprehensive retirement planning platform with advanced analytics, excellent UX, and sophisticated modeling capabilities.

**Current State**: Well-architected application with strong fundamentals in tax calculation, mortgage amortization, long-term simulation, and data visualization. The codebase is clean, type-safe, and well-tested.

**Target Audience**: Public users (open source/free tool for others to use)

---

## Phase 1: Retirement & Withdrawal Engine ✅ COMPLETE

- **1.1 Social Security Integration** ✅ - FutureSS/CurrentSS income types, claiming age calculator (62-70), tax treatment, earnings test
- **1.2 Advanced Withdrawal Strategies** ✅ - Fixed Real, Percentage-Based, Guyton-Klinger dynamic strategies with full simulation integration
  - Configurable GK guardrails (upper/lower thresholds, adjustment %)
  - GK applies 10% cuts/increases to discretionary expenses
  - Warning system when discretionary expenses insufficient for GK cuts
  - Historical backtest uses selected withdrawal strategy
- **1.3 Withdrawal Strategy UI** ✅ - Drag-and-drop account ordering, tax badges, WithdrawalTab
- **1.4 Retirement Milestone Tracker** ✅ - Visual timeline, milestone cards, key age badges (59.5, 62, 65, 67, 70, 73), FI detection
- **1.5 RMDs** ⏸️ Deferred to Phase 5

**Future Enhancement**: ~~SSA CSV Import for actual earnings history~~ ✅ Implemented as SSA XML Import (see Pending User Testing)

---

## Phase 2: Mobile & UI Polish ✅ COMPLETE

- **2.1 Mobile-First Responsive Design** ✅ - Responsive modals, charts, padding
- **2.2 Input Validation** ✅ - Built into input components, date range validation
- **2.2.1 Collapsible Cards** ✅ - Cards default collapsed, expand on click
- **2.2.2 Auto Deduction Method** ✅ - Auto-selects standard vs itemized
- **2.3 Tooltips & Help System** ✅ - Tooltip component, help text on complex fields
- **2.4 Confirmation Dialogs** ✅ - ConfirmDialog component for delete operations
- **2.5 Loading States** ✅ - LoadingSpinner, LoadingOverlay components
- **2.6 TypeScript Type Safety** ✅ - Removed all @ts-ignore instances
- **2.7 Performance Optimization** ✅ - Debounced localStorage (500ms), memoized context values, CSS tab switching
- **2.8 Assumptions Tab Reorganization** ✅ - Essential settings visible, collapsible advanced section

**Remaining**: ~~Inconsistent button styling~~ ✅ Fixed (EditHistoryModal, ExpenseCard)

---

## Phase 3: Monte Carlo & Real-World Data ✅ COMPLETE

### 3.1 Monte Carlo Simulation Engine ✅ COMPLETE

**Files created**:
- `src/services/MonteCarloEngine.ts` - Simulation engine
- `src/services/MonteCarloTypes.ts` - Type definitions
- `src/services/MonteCarloAggregator.ts` - Results aggregation
- `src/services/RandomGenerator.ts` - Seeded PRNG with Box-Muller
- `src/components/Objects/Assumptions/MonteCarloContext.tsx` - State management
- `src/tabs/Future/tabs/MonteCarloTab.tsx` - UI tab
- `src/tabs/Future/tabs/MonteCarloDebugPanel.tsx` - Debug panel
- `src/components/Charts/FanChart.tsx` - Percentile visualization

**Features**:
- Run 100-1000 scenarios with configurable return mean/std dev
- Seeded PRNG for reproducibility
- Success rate calculation (% of scenarios lasting to life expectancy)
- Fan chart with 10/25/50/75/90 percentile bands
- Debug panel for troubleshooting

---

### 3.2 Historical Market Data Integration ✅ COMPLETE

**Files created**:
- `src/data/HistoricalReturns.ts` - S&P 500, 10-Year Treasury, and CPI data (1928-2024)
- `src/services/HistoricalBacktest.ts` - Historical backtesting engine
- `src/tabs/Future/tabs/HistoricalBacktestPanel.tsx` - Backtest UI component

**Features implemented**:
- Historical data from NYU Stern (Damodaran) with stocks, bonds, and inflation
- Monte Carlo presets using historical statistics (nominal ~11.8%, real ~8.5%)
- Historical backtesting: test plan against all 30-year periods since 1928
- Success rate calculation with notable period highlighting (1966, 1929, 2000, etc.)
- Configurable stock/bond allocation, withdrawal rates, inflation adjustment

---

## Phase 4: Advanced Analytics & Reporting

### 4.1 Tax Optimization Recommendations ✅ COMPLETE (Pending User Testing)

**Files created**:
- `src/data/ContributionLimits.ts` - IRS 401k/IRA/HSA limits by year with catch-up calculations
- `src/services/TaxOptimizationService.ts` - Core analysis, recommendations, Roth simulation
- `src/tabs/Future/tabs/TaxOptimizationTab.tsx` - Tax tab UI

**Files modified**:
- `TaxService.tsx` - Added `getMarginalTaxRate()`, `getCombinedMarginalRate()`, HSA in exemptions
- `Income/models.tsx` - Added `hsaContribution` field to WorkIncome
- `AddIncomeModal.tsx`, `IncomeCard.tsx` - HSA input field

**Features implemented**:
- Current tax situation analysis (effective rate, marginal rate, federal bracket, headroom)
- Contribution status tracking (401k, HSA progress bars)
- Actionable recommendations with impact ratings (high/medium/low)
- Roth conversion calculator with lifetime savings estimate
- Tax rate projections table (year-by-year with retirement status badges)
- HSA contribution tracking with triple tax advantage (pre-tax + FICA-exempt)

**Unit tests**: 26 new tests for contribution limits and marginal rate calculations

---

### 4.2 Scenario Comparison Tool ✅ COMPLETE (Pending User Testing)

**Files created**:
- `src/services/ScenarioTypes.ts` - Type definitions (SavedScenario, LoadedScenario, ScenarioComparison, MilestonesSummary)
- `src/services/ScenarioService.ts` - localStorage CRUD, state capture, milestone calculation, comparison logic
- `src/components/Objects/Scenarios/ScenarioContext.tsx` - State management with reducer
- `src/components/Objects/Scenarios/ScenarioManager.tsx` - Save/import/export UI
- `src/components/Objects/Scenarios/ScenarioCard.tsx` - Individual scenario display
- `src/tabs/Future/tabs/ScenarioComparisonTab.tsx` - Main comparison tab
- `src/tabs/Future/tabs/SideBySideView.tsx` - Side-by-side comparison layout
- `src/tabs/Future/tabs/OverlaidChartView.tsx` - Combined net worth chart
- `src/tabs/Future/tabs/DifferenceSummary.tsx` - Delta cards for key milestones

**Features implemented**:
- Save current plan as named scenario (stored in localStorage)
- Import/export scenarios as JSON files
- Compare any two scenarios (or saved scenario vs current plan)
- Three comparison views: Side-by-Side, Overlaid Chart, Key Differences
- Key metrics: FI year delta, legacy value delta, peak net worth, year-by-year comparison
- Visual indicators (green = better, red = worse)

**Unit tests**: 21 new tests for ScenarioService (localStorage CRUD, milestone calculation, comparison logic)

---

### 4.3 PDF Report Generation 🚧 IN PROGRESS - Might remove this, not sure I care enough.

**Status**: Basic implementation complete, needs refinement

**Implemented**:
- `@react-pdf/renderer` + `html2canvas` for client-side PDF generation
- Summary report with key metrics, retirement readiness, Monte Carlo results (if available)
- Net worth projection chart captured from hidden DOM element
- PDF button in Data tab (hidden behind Experimental Features toggle)

**Needs Work**:
- Chart capture quality/sizing improvements
- Additional report sections (cashflow analysis, tax summary, detailed projections)
- Better styling and layout refinement
- Error handling edge cases

---

### 4.4 Budget Tracking (Actual vs Projected) ⬜ NOT STARTED

**Implementation**:
1. Transaction logging (manual entry or CSV import)
2. Compare actual spending vs assumptions with variance alerts
3. Category breakdown with progress bars
4. Option to auto-adjust assumptions based on actual data

**Note**: Bank import via standard Excel/Google Sheet template preferred over direct Plaid integration

---

### 4.5 Financial Ratio Analysis ✅ COMPLETE (Pending User Testing)

**Files created**:
- `src/services/FinancialRatioService.ts` - Ratio calculations with benchmarks
- `src/tabs/Future/tabs/FinancialRatiosTab.tsx` - UI component
- `src/__tests__/services/FinancialRatioService.test.ts` - 26 unit tests

**Ratios implemented**:
- Savings Rate, Expense Ratio
- Emergency Fund (months), Liquidity Ratio
- Debt-to-Income, Debt-to-Assets
- Net Worth to Income, Investment Allocation
- Net Worth Growth Rate, Asset Growth Rate

**Features**:
- Color-coded ratings (Excellent/Good/Fair/Poor/Critical)
- Overall Financial Health Score
- Year selector for historical comparison
- Trend table showing ratios over time
- Benchmarks and explanations for each ratio

---

## Phase 5: Future Considerations

### 5.1 Federal Pension Support (FERS/CSRS) ⬜ NOT STARTED

**Complexity:** Medium-High | **Effort:** ~800-1200 lines | **Impact:** Medium (federal employees)

**Pattern Reference:** Follows `FutureSocialSecurityIncome` implementation in `models.tsx:379-408`

---

**Income Classes to Create (in `src/components/Objects/Income/models.tsx`):**

| Class | Purpose | Key Properties |
|-------|---------|----------------|
| `FutureFERSIncome` | Auto-calculated at separation | `separationAge`, `yearsOfService`, `high3Average`, `calculatedMonthlyBenefit`, `hasSupplementaryBenefit` |
| `FutureCSRSIncome` | Auto-calculated at separation | Same as FERS, no supplement |
| `CurrentFederalPensionIncome` | Already receiving (manual entry) | `amount`, `pensionType: 'FERS' \| 'CSRS'` |

---

**Benefit Formulas:**

```
FERS: Monthly = (High-3 / 12) × Years × Rate
  - Rate = 1.0% (standard)
  - Rate = 1.1% (if age 62+ with 20+ years)

CSRS: Monthly = (High-3 / 12) × Years × Tiered Rate
  - First 5 years: 1.5%
  - Next 5 years: 1.75%
  - Remaining years: 2.0%
  - Maximum: 80% of High-3

FERS Supplement (bridge to age 62):
  Monthly = Estimated SS PIA × (Federal Years / 40)
  - Subject to SS earnings test
  - No COLA
  - Ends at age 62
```

---

**COLA Implementation (critical difference from SS):**

```typescript
// FERS COLA (capped, frozen before 62)
increment(assumptions, currentAge) {
  const cpi = assumptions.macro.inflationRate / 100;
  let cola: number;

  if (cpi <= 0.02) cola = cpi;           // Full if ≤2%
  else if (cpi <= 0.03) cola = 0.02;     // Cap at 2% if 2-3%
  else cola = cpi - 0.01;                // CPI-1% if >3%

  // No COLA before age 62 for early retirees
  if (currentAge < 62) cola = 0;

  return this.amount * (1 + cola);
}

// CSRS COLA (full CPI, like Social Security)
increment(assumptions) {
  const cpi = assumptions.macro.inflationRate / 100;
  return this.amount * (1 + cpi);
}
```

---

**SimulationEngine Integration (pattern from SS at lines 295-336):**

```typescript
// Add after Social Security handling in simulateOneYear()
if (inc instanceof FutureFERSIncome || inc instanceof FutureCSRSIncome) {
  if (currentAge === inc.separationAge && inc.calculatedMonthlyBenefit === 0) {
    const high3 = inc.high3Average || calculateHigh3FromWorkIncome(previousSimulation);
    const years = inc.yearsOfService;

    let monthly: number;
    if (inc instanceof FutureFERSIncome) {
      const rate = (currentAge >= 62 && years >= 20) ? 0.011 : 0.01;
      monthly = (high3 / 12) * years * rate;
    } else {
      // CSRS tiered calculation with 80% cap
      monthly = calculateCSRSBenefit(high3, years);
    }

    return new FutureFERSIncome(..., monthly, year, ...);
  }
}
```

---

**Implementation Plan:**

| File | Purpose | Priority |
|------|---------|----------|
| `src/data/FederalPensionData.ts` (NEW) | MRA table, formula constants, COLA rules | P0 |
| `src/services/FederalPensionCalculator.ts` (NEW) | FERS/CSRS benefit calculation | P0 |
| `src/components/Objects/Income/models.tsx` | Add 3 new income classes | P0 |
| `SimulationEngine.tsx` | Add calculation triggers at separation age | P0 |
| `AddIncomeModal.tsx` | Add federal pension UI form | P1 |
| `IncomeCard.tsx` | Add federal pension display | P1 |
| `src/__tests__/services/FederalPensionCalculator.test.ts` (NEW) | Unit tests (~25 tests) | P1 |
| `src/services/FederalPensionImportService.ts` (NEW) | HR-11 parser (optional) | P3 |

---

**Key Differences from Social Security:**

| Aspect | Social Security | Federal Pension |
|--------|-----------------|-----------------|
| Activation | Claiming age (62-70) | Separation age (varies) |
| Formula | AIME/PIA (35 years) | High-3 × Years × Rate |
| COLA | Full CPI | FERS: Capped; CSRS: Full |
| COLA Before 62 | Applied | FERS: Frozen |
| Supplement | None | FERS Supplement (bridge) |
| Data Source | SSA XML import | Manual or HR-11 import |

---

**TSP Note:** Use existing 401k tax types. TSP has identical limits ($23,500 + catch-up).
Federal matching: 1% auto + 100% match on first 3% + 50% match on next 2% = up to 5% total.

**V1 Scope Limitations:**
- Skip disability retirement scenarios
- Skip special provisions (LEO, firefighters, ATC)
- Manual High-3 entry (defer HR-11 import to v2)

---

### 5.2 Required Minimum Distributions (RMDs) ⬜ NOT STARTED

**Complexity:** Medium | **Effort:** ~500-800 lines | **Impact:** High (affects most retirement savers)

**Current State:**
- Account types already support Traditional 401k, Traditional IRA, Roth 401k (all subject to RMDs)
- Age 73 milestone exists in `MilestoneCalculator.ts:48` but no actual calculation
- Withdrawal strategies are deficit-driven only - no "forced withdrawal" concept

**IRS Rules (SECURE 2.0):**
- RMD starts at age 73 (2023-2032), age 75 (2033+)
- Calculation: `Prior Year Dec 31 Balance / Life Expectancy Factor`
- Accounts subject: Traditional 401k, Traditional IRA, Roth 401k
- Accounts exempt: Roth IRA, HSA, Brokerage
- 25% penalty on shortfall (10% if corrected)

**Implementation Plan:**

| File | Purpose |
|------|---------|
| `src/data/RMDTables.ts` (NEW) | IRS Uniform Lifetime Table (divisors by age 72-120) |
| `src/services/RMDCalculator.ts` (NEW) | Calculate RMD per account, aggregate, handle tax treatment |
| `SimulationEngine.tsx` | Force RMD withdrawals, track satisfaction, apply penalty |
| `OverviewTab.tsx` | RMD warning banner, shortfall alerts |
| `DataTab.tsx` | RMD column in year-by-year table |

**V1 Scope Limitations:**
- Skip inherited IRA rules (10-year rule complexity)
- Skip spouse beneficiary special rules
- Skip "still working" exception for employer plans
- Use Uniform Lifetime Table only (not Single Life Expectancy)

---

### 5.3 Real Estate Enhancements ⬜ NOT STARTED

**Complexity:** High (many sub-features) | **Impact:** Medium (niche audience)

**Current State:**
- `PropertyAccount` exists with basic appreciation tracking
- `MortgageExpense` is comprehensive (escrow, amortization, tax deduction)
- `PassiveIncome` supports rental income with rent inflation
- **Missing:** Depreciation, property sale scenarios, 1031 exchanges, capital gains recapture

**Enhancement Tiers:**

| Tier | Feature | Description | Effort |
|------|---------|-------------|--------|
| 1 | **Property Sale** | Add `saleYear` to PropertyAccount, handle proceeds/taxes | Medium |
| 1 | **Depreciation** | Track depreciable basis, 27.5-year schedule, recapture | Medium |
| 1 | **Capital Gains** | Primary residence exclusion ($250k/$500k), recapture rates | Medium |
| 1 | **Rental Expenses** | Vacancy, management fees, repairs (separate from mortgage) | Low |
| 2 | **1031 Exchanges** | Deferred tax tracking, identification/exchange periods | High |
| 2 | **Multi-Property** | Portfolio view, aggregated rental income | Medium |
| 2 | **Cost Segregation** | Component depreciation (structure vs fixtures) | High |
| 3 | **Advanced** | RE professional status, REITs, Opportunity Zones, ARM/HELOC | High |

**Property Sale Implementation (Tier 1):**
```
PropertyAccount changes:
- saleYear?: number
- costBasis: number (original purchase price)
- improvements: number (capital improvements add to basis)
- accumulatedDepreciation: number (reduces basis on sale)

SimulationEngine changes:
- Detect sale year, calculate gain/loss
- Apply Section 121 exclusion if primary residence
- Calculate depreciation recapture (25% rate)
- Pay off linked mortgage, add net proceeds to investments

TaxService changes:
- Add 25% depreciation recapture rate
- Handle $250k/$500k exclusion logic
```

**Recommendation:** Start with Property Sale + Depreciation (Tier 1) as foundation for other features.

---

### 5.4 Other Future Considerations

- **Smarter Roth Conversion Target Rate**: Currently, auto Roth conversions use a fixed 22% target bracket. A future enhancement could calculate the actual expected marginal tax rate in retirement based on projected income (Social Security, pensions, RMDs). This would make conversions more accurate for users with unusually high or low retirement income. The 22% assumption is reasonable for most users since it's the bracket many retirees face when withdrawing from Traditional accounts.
- **Retirement Account Contribution Limits**: Enforce 401k/IRA contribution caps ($23,500 for 401k, $7,000 for IRA in 2024), Roth IRA income phase-outs (MAGI limits), catch-up contributions at 50+, auto-inflate limits when inflation adjustment is enabled
- **Private Pension/Annuity**: Defined benefit plans, immediate/deferred annuities (non-federal)
- **HSA Optimization**: Non-qualified expense planning
- **Medicare/Long-term Care**: Cost estimation
- **Collaboration**: Multi-user accounts, advisor sharing
- **Advanced Tax**: AMT, NIIT, tax-loss harvesting, QBI deduction
- **Data Integration**: Plaid API, brokerage sync
- **Asset Allocation**: Stock/bond splits, glidepath auto-adjustment
- **Sequence Risk Visualization**: Interactive bad-years-early vs late comparison

---

## Security & Privacy

### Data Storage Disclaimer ✅
- Dismissible banner on Dashboard explaining local storage
- Reminds users to use Export for backups

### Optional Encryption ⬜ NOT STARTED
- User-set password encrypts all localStorage data
- Uses Web Crypto API (PBKDF2 + AES-GCM)
- Password entry on return visits
- Export files remain unencrypted (user's choice to share)
- "Forgot password" = data reset only (no recovery)

**Note**: Encryption is optional to keep the tool accessible. Users who want encryption can enable it; others can use the tool without friction.

---

## Technical Debt

### Code Quality
- ✅ Removed all @ts-ignore instances
- ✅ 401k max tracking logic - TRACK_ANNUAL_MAX now caps at IRS limits with age-based catch-up
- ✅ SALT deductibility logic - Enforces TCJA cap ($10k 2018-2024), OBBBA cap ($40k 2025-2029), revert ($10k 2030+)

### Testing
- Current: ~80% coverage, 701 unit tests (30 test files)
- Goal: 90%+ coverage
- ✅ Test suite cleanup: Consolidated 4 SS tax test files → 1, fixed TypeScript errors
- ✅ Playwright E2E tests: 54 tests across 13 test files
  - `e2e/setup-flow.spec.ts`: Account, income, expense setup flows
  - `e2e/persistence.spec.ts`: localStorage persistence across reload
  - `e2e/account-management.spec.ts`: Savings, invested, property, debt account types
  - `e2e/income-setup.spec.ts`: Work, Social Security, passive income types
  - `e2e/import-export.spec.ts`: Data export/import functionality
  - `e2e/simulation.spec.ts`: Future projections and simulation
  - `e2e/edit-operations.spec.ts`: Editing accounts, income, expenses
  - `e2e/delete-operations.spec.ts`: Deleting items with confirmation
  - `e2e/tax-calculations.spec.ts`: Tax display and updates
  - `e2e/complete-journey.spec.ts`: Full end-to-end user journeys
  - `e2e/withdrawal-strategy.spec.ts`: Withdrawal tab navigation
  - `e2e/allocation.spec.ts`: Allocation/priority tab
  - `e2e/dashboard.spec.ts`: Dashboard navigation and display
- ⬜ Monte Carlo performance testing

### Accessibility
- ✅ ARIA labels on interactive elements
- ✅ WCAG AA color contrast audit
- ⬜ Screen reader testing

**Completed:**
- `useModalAccessibility` hook with focus trap, escape key, focus restoration
- AddAccountModal, AddIncomeModal, AddExpenseModal: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus management
- TopBar hamburger menu: `aria-label`
- Card expand/collapse buttons: `aria-expanded`, `aria-label` with item names
- Delete buttons: `aria-label` with item names (accounts, income, expenses)
- Edit history button: `aria-label`
- SVG icons: `aria-hidden="true"` to hide from screen readers
- Color contrast audit: Replaced `text-gray-500` (4.1:1 ratio) and `text-gray-600` (2.6:1 ratio) with `text-gray-400` (6.3:1 ratio) across 37 files to meet WCAG AA 4.5:1 requirement

**Remaining:**
- Form errors need `aria-describedby` connection (low priority)

---

## Next Steps (Recommended Order)

1. ~~**Phase 3.2**: Historical Market Data Integration~~ ✅ COMPLETE
2. ~~**Phase 1.2**: Guyton-Klinger Full Integration~~ ✅ COMPLETE
3. ~~**Phase 4.1**: Tax Optimization Recommendations~~ ✅ COMPLETE (Pending User Testing)
4. ~~**Phase 4.2**: Scenario Comparison Tool~~ ✅ COMPLETE (Pending User Testing)
5. ~~**Playwright E2E Tests**: Critical user flows~~ ✅ COMPLETE (54 tests across 13 files)
6. **Phase 4.3-4.5**: As needed based on feedback

---

## Open Questions

1. ~~**Historical Data**: Focus on S&P 500 only, or add bonds/real estate/international?~~ ✅ Implemented with S&P 500 + 10-Year Treasury bonds
2. **Budget Tracking**: Excel/Google Sheet import vs direct bank integration (Plaid)?


## User Feedback Backlog

### Bug Fixes (Priority 1)
- ✅ **Tooltip cutoff** - Tooltips get cut off on some add modals
- ✅ **Vesting UI for brokerage** - Vested schedule shouldn't show for brokerage accounts
- ✅ **Number overflow** - Numbers overflow containers; investigate text scaling
- ✅ **Chart tooltip cutoff** - Chart tooltips can get cut off at edges
- ✅ **Icicle chart % calculation** - Was using net worth instead of total assets as denominator
- ✅ **Withdrawal rounding surplus** - Small rounding amounts were flowing to priority allocations
- ✅ **GK guardrail precision** - Floating point display showing 19.999999 instead of 20

### UX Improvements (Priority 2)
- ✅ **100% vested shortcut** - Make it easier to indicate fully vested (checkbox or button)
- ✅ **Icicle chart percentages** - Add percentages to icicle chart tooltips
- ✅ **Allocation screen clarity** - Add tooltips or explanatory text to allocation screen

### Feature Enhancements (Priority 3)
- ✅ **Custom ROR per account** - Override global assumptions with per-account return rates
- ✅ **Bi-weekly pay** - Add bi-weekly frequency option for income
- ✅ **Discretionary expenses** - Mark expenses as discretionary for smarter Guyton-Klinger withdrawals

### New Features (Priority 4)
- ⬜ **Federal pension** - Add FERS/CSRS pension with auto High-3 calculation, FERS Supplement bridge payment, tiered CSRS formula (see Phase 5.1 for full details)
- ✅ **Excel export** - Export data to Excel with multiple sheets (9 sheets: Summary, Accounts, Income, Expenses, Taxes, Cashflow, Withdrawals, Monte Carlo, Current State)

### Pending User Testing (Priority 0)
- ⬜ **Tax Optimization Tab** - Phase 4.1 complete, needs user testing (Tax tab in Future page). Goals/recommendations need to be vetted for accuracy.
- ⬜ **401k Max Tracking** - TRACK_ANNUAL_MAX strategy now caps at IRS limits with catch-up contributions
- ⬜ **SALT Cap** - State tax deduction now capped per TCJA/OBBBA ($10k→$40k→$10k by year)
- ⬜ **Scenario Comparison Tool** - Phase 4.2 complete, needs user testing (Scenarios tab in Future page)
- ⬜ **Financial Ratios Tab** - Phase 4.5 complete, needs user testing (Ratios tab in Future page). Benchmarks/ratings need to be vetted for accuracy.
- ⬜ **Excel Export** - Export button in Data tab. Generates 9-sheet Excel file with currency formatting. Verify data accuracy and formatting in Excel/Google Sheets.
- ⬜ **SSA Earnings Import** - Import SSA XML from ssa.gov/myaccount on FutureSocialSecurityIncome card. Parses earnings history for accurate AIME/PIA calculation. Verify imported data appears and affects SS benefit calculation.

**Note:** Tax, Scenarios, Ratios tabs, and PDF export are hidden behind an "Experimental Features" toggle in Advanced Settings.

---

## Testing Round 2 - January 2026

### Bug Fixes (P1)
- ✅ **Dashboard metric cards not respecting number format** - Fixed: All metric cards pass forceExact to formatCompactCurrency
- ✅ **Dashboard expense tooltip not respecting number format** - Fixed: Pie chart tooltip uses formatCompactCurrency with forceExact
- ✅ **Dashboard empty state misalignment** - Fixed: Uses 2-column layout with items-start when setup incomplete
- ✅ **Allocation tab title mismatch** - Fixed: Title now says "Allocation" to match sidebar
- ✅ **Scenario comparison shows assets not net worth** - Fixed: calculateNetWorth now subtracts PropertyAccount.loanAmount (mortgage balance) from net worth
- ✅ **Mortgage PMI not stopping at 20% equity** - PMI auto-removes when LTV reaches 80% (equity >= 20%)
- ✅ **Mortgage costs inflating when inflation off** - Fixed: Utilities/HOA now only inflate with general inflation, not housing appreciation
- ✅ **Deficit/negative net worth handling** - Fixed: OverviewTab now includes DebtAccount (incl. DeficitDebtAccount) in debt calculation for charts

### UX Improvements (P2)
- ✅ **Dashboard metric cards center alignment** - Fixed: Added text-center to all metric cards
- ✅ **NetWorth card height** - Fixed: Added h-full and flex-1 to expand with grid
- ✅ **Mobile sidebar behavior** - Fixed: Sidebar overlays on mobile with backdrop; auto-closes on link click or backdrop tap
- ✅ **Monte Carlo tab persistence** - Fixed: Sub-tab selection saved to localStorage
- ✅ **Scenario rename functionality** - Fixed: Click scenario name to rename inline
- ✅ **Scenario comparison cleanup** - Fixed: Removed % diff sublabel, replaced with descriptive text; removed "Years Ahead/Behind" card
- ✅ **Scenario comparison width** - Fixed: Added max-w-4xl to summary panels grid
- ✅ **JSON export warning** - Fixed: Added note clarifying JSON/CSV are read-only exports

### Feature Enhancements (P3)
- ✅ **Scenario assumption editing** - Added modal to edit inflation, investment returns, withdrawal rate, retirement age, life expectancy on saved scenarios
- ✅ **Withdrawal debug panel** - Added collapsible debug panel in WithdrawalTab with 10-year projection table
- ✅ **Layout AB test** - Tested 9-column layout; reverted to 7-column (user preferred original)

---

## Testing Round 3 - User Feedback

### 401k Contribution Limit Enforcement (P1)
- ✅ **401k over-contribution warning (income)** - Added amber warning in IncomeCard when 401k/HSA contributions exceed IRS limits
- ✅ **401k over-contribution warning (allocation)** - Added amber warning in PriorityTab when allocation exceeds IRS limits
- ✅ **Allocation max respects yearly limit** - MAX type now auto-sets to IRS limit for 401k/IRA/HSA accounts
- ✅ **Auto-lock 401k max** - Input is disabled and shows "Auto-set to IRS limit" for accounts with contribution limits

### UX Improvements (P2)
- ✅ **Priority editing is limited** - Improved priority type labels (Max Out, Fixed, Emergency Fund Target, Everything Remaining)
- ✅ **Remove linked account field** - Replaced with warning banner only when expense link is missing
- ✅ **Rename "Savings" to "Cash"** - Changed account type label from "Savings" to "Cash" in all UI locations
- ✅ **Better retirement age suggestion** - Added tooltips explaining demographics fields and their purpose
- ✅ **History screen improvements** - Fixed delete logic: now allows deleting any entry except the last one (preserves at least one data point)

### Tooltips & Help (P3)
- ✅ **Pay frequency tooltip** - Added tooltip explaining frequency is just for annual conversion
- ⬜ **Clippy-style tutorial** - Consider guided onboarding/tutorial system

### Income Features (P3)
- ✅ **Semi-monthly pay frequency** - Added semi-monthly (24x/year) pay option to income frequency dropdown


User feedback
- Add a charity expense
- Add state taxes for North Carolina and Virginia
- Add a social security slider so someone can state I think social security will be x% funded by the time I retire. This should be in assumptions