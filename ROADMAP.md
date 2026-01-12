# Stag Financial Planning Application - Feature Roadmap

## Executive Summary

This roadmap outlines a strategic plan for evolving Stag from a solid personal financial planning tool into a comprehensive retirement planning platform with advanced analytics, excellent UX, and sophisticated modeling capabilities.

**Current State**: Well-architected application with strong fundamentals in tax calculation, mortgage amortization, long-term simulation, and data visualization. The codebase is clean, type-safe, and well-tested.

**Target Audience**: Public users (open source/free tool for others to use)

**User Priorities** (in order):
1. Withdrawal timeline & retirement features (Social Security integration)
2. Mobile improvements & general UI polish
3. Monte Carlo simulations & real-world data
4. Advanced analytics & reporting

---

## Phase 1: Retirement & Withdrawal Engine (PRIORITY 1)
**Timeline**: Immediate focus
**Complexity**: High (advanced financial modeling)
**Impact**: Highest - Core value proposition

### Current State
- ✅ Withdrawal infrastructure exists (`WithdrawalBucket[]` in AssumptionsContext)
- ✅ Basic withdrawal logic implemented in SimulationEngine (lines 109-231)
- ✅ Early withdrawal penalties (10% + tax for pre-59.5) working
- ✅ Three withdrawal strategies defined: 'Fixed Real', 'Percentage', 'Guyton Klinger'
- ✅ **Social Security integration COMPLETE** (FutureSS, CurrentSS, tax treatment, earnings test)
- ✅ **Withdrawal Strategy UI COMPLETE** (drag-and-drop reordering, tax badges)
- ✅ **Savings account interest income** as taxable income (future years)
- ✅ Advanced withdrawal strategies (Fixed Real, Percentage, Guyton-Klinger) implemented (not fully verified)
- ✅ **BOY Timing COMPLETE** - Contributions/withdrawals applied before growth (more accurate)
- ✅ **Withdrawal Gross-Up Fixed** - Solver properly handles tax + penalty for all account types:
  - Traditional 401k/IRA: Solver with penalty rate integrated
  - Early Roth (gains): Solver with 10% penalty for gains portion
  - Brokerage: Iterative solver for capital gains
- ✅ **Debug Screen Enhanced** - Shows Social Security income, interest income by account
- ✅ **Interest Income Bug Fixed** - No longer duplicates across years

### Features to Build

#### 1.1 Social Security Integration ✅ **COMPLETE**
**Files to modify**:
- `src/components/Objects/Income/models.tsx` - SocialSecurityIncome class
- `src/components/Objects/Assumptions/SimulationEngine.tsx` - Auto-activation logic
- `src/tabs/Current/IncomeTab.tsx` - Add Social Security income type to UI
- `src/components/Objects/Income/AddIncomeModal.tsx` - Social Security creation flow

**Implementation**:
1. Auto-activate SocialSecurityIncome when user reaches `socialSecurityStartAge` in simulation
2. Add claiming age calculator (62-70) with benefit adjustment (70% at 62, 108% at 67, 124% at 70)
3. Integrate with tax calculation (SS benefits are taxable based on combined income)
4. Add UI for adding Social Security income with:
   - Estimated monthly benefit input
   - Claiming age selector (62-70)
   - Auto-calculation of benefit based on claiming age
5. **Future Enhancement**: SSA CSV Import
   - Social Security Administration allows downloading earnings/benefit data as CSV
   - Support uploading SSA CSV file to automatically populate benefit history
   - Use actual earnings history to calculate more accurate benefit estimates
   - Parse work credits, earnings by year, and projected benefits

**Validation**: Run simulation with Social Security starting at age 67, verify income appears in cashflow charts

**Note**: Initially focusing on individual benefits only. Spousal/survivor benefits deferred to future phase.

---

#### 1.2 Advanced Withdrawal Strategies ✅ **COMPLETE** (not fully verified)
**Files created/modified**:
- `src/services/WithdrawalStrategies.ts` - NEW: Strategy calculation functions
- `src/__tests__/services/WithdrawalStrategies.test.ts` - NEW: 23 unit tests
- `src/components/Objects/Assumptions/SimulationEngine.tsx` - Integrated strategies into simulation

**Implementation** (DONE):
1. **Fixed Real Withdrawal**:
   - Calculate initial withdrawal amount (portfolio × rate)
   - Adjust for inflation each year using cumulative multiplier
   - Tracks initial portfolio across years

2. **Percentage-Based Withdrawal**:
   - Recalculate withdrawal as % of current portfolio each year
   - More conservative (portfolio lasts longer but variable income)

3. **Guyton-Klinger Dynamic Withdrawal**:
   - Start with target rate (e.g., 4%)
   - Apply guardrails (±20% from target rate):
     - If rate > target × 1.2: Skip inflation adjustment (portfolio dropped)
     - If rate < target × 0.8: 150% inflation adjustment (portfolio grew)
   - Track base withdrawal across years

**Integration**:
- Strategies trigger at retirement age
- Deficit-driven withdrawals serve as failsafe
- State tracked via `strategyWithdrawal` field in SimulationYear

**Validation**: Unit tests pass (23 tests). Manual verification of portfolio longevity differences pending.

---

#### 1.3 Withdrawal Strategy UI ✅ **COMPLETE**
**Files to create/modify**:
- `src/tabs/Future/WithdrawalTab.tsx` - NEW tab for managing withdrawal order
- `src/components/Objects/Assumptions/AssumptionsContext.tsx` - Already has WithdrawalBucket logic

**Implementation**:
1. Create drag-and-drop UI similar to PriorityTab for withdrawal buckets
2. Allow users to set account drawdown order:
   - Example: Brokerage → Roth IRA → Traditional 401k → HSA
3. Visual representation of tax impact per account type
4. Show "Tax-Efficient Withdrawal" recommendations:
   - Suggest withdrawing from taxable accounts first
   - Fill tax brackets with Traditional IRA withdrawals
   - Preserve Roth for last (tax-free growth)
5. Integrate with SimulationEngine's existing withdrawal logic (lines 109-231)

**Validation**: Set custom withdrawal order, verify simulation respects it during deficit years

---

#### 1.4 Retirement Milestone Tracker ✅ **COMPLETE**
**Files created/modified**:
- `src/services/MilestoneCalculator.ts` - Centralized milestone calculation service
- `src/tabs/Future/FutureTab.tsx` - Visual timeline, milestone cards, key badges

**Implementation** (DONE):
1. ✅ Visual progress timeline showing Current → Retirement → FI → Life expectancy
2. ✅ Milestone cards: Current age, Retirement, FI Target, Plan End
3. ✅ Key milestone badges: 59.5 (penalty-free), 62 (SS eligible), 65 (Medicare), 67 (full SS), 70 (max SS), 73 (RMDs)
4. ✅ `findFinancialIndependenceYear()` - FI detection based on withdrawal rate
5. ✅ Years until each milestone displayed

**Optional Future Enhancements**:
- "FI Number" (portfolio amount needed for FI)
- "Progress to FI %" (current portfolio / FI number)
- "Retirement readiness score"

**Validation**: Visual timeline updates when simulation recalculates ✅

---

#### 1.5 Required Minimum Distributions (RMDs) ⏸️ **DEFERRED**
*Moved to Phase 5 - Future Considerations*

---

## Phase 2: Mobile & UI Polish (PRIORITY 2)
**Timeline**: After Phase 1 core features
**Complexity**: Medium (CSS/responsive design)
**Impact**: High - Accessibility for all users

### Current Issues Identified
- ✅ ~~Modals overflow on mobile (`min-w-max` forces full width)~~ **FIXED**
- ✅ ~~Charts have fixed heights, not mobile-optimized~~ **FIXED**
- ✅ ~~No input validation with user-friendly error messages~~ **FIXED** (built into input components)
- ✅ ~~Cards show too much info by default~~ **FIXED** (collapsible cards)
- ✅ ~~Deduction method requires manual selection~~ **FIXED** (auto-select best deduction)
- ✅ ~~No tooltips or help text for complex fields~~ **FIXED** (tooltip system)
- ❌ Inconsistent button styling and spacing
- ✅ ~~No confirmation dialogs for destructive actions (delete)~~ **FIXED** (ConfirmDialog)
- ✅ ~~9 instances of `@ts-ignore` bypassing type safety~~ **FIXED** (proper type guards)
- ✅ ~~No loading states during simulation~~ **FIXED** (LoadingSpinner, LoadingOverlay)

### Features to Build

#### 2.1 Mobile-First Responsive Design ✅ **COMPLETE**
**Files modified**:
- ✅ `src/components/Objects/Accounts/AddAccountModal.tsx` - Fixed overlay + responsive grids
- ✅ `src/components/Objects/Income/AddIncomeModal.tsx` - Fixed overlay + responsive grids
- ✅ `src/components/Objects/Expense/AddExpenseModal.tsx` - Fixed overlay + responsive grids
- ✅ `src/components/Charts/*.tsx` - Chart responsiveness (margins, controls, text)
- ✅ All tabs (`src/tabs/**/*.tsx`) - Responsive padding (`px-4 sm:px-8`)

**Implementation**:
1. ✅ Replace `min-w-max` with responsive widths (`max-w-lg`, `p-4` padding)
2. ✅ Add mobile breakpoints (`sm:`, `lg:`) to modal grid layouts (2 cols on mobile)
3. ✅ Make charts responsive:
   - CashflowSankey: Responsive margins (80px on narrow, 150px on wide)
   - AssetsStreamChart: Controls stack on mobile, responsive margins
   - DebtStreamChart: Responsive margins
   - NetWorth: Responsive text sizes (`text-3xl sm:text-5xl`)
4. ⬜ Test on iPhone SE (375px), iPhone Pro (390px), iPad (768px)

**Validation**: Open on mobile device, verify no horizontal scroll, all buttons clickable

---

#### 2.2 Input Validation & Error Feedback ✅ **COMPLETE**
**Files modified**:
- `src/components/Layout/InputFields/PercentageInput.tsx` - Built-in range validation (0-100%)
- `src/components/Layout/InputFields/CurrencyInput.tsx` - Built-in non-negative validation
- `src/components/Layout/InputFields/NameInput.tsx` - Built-in non-empty, max length validation
- `src/components/Layout/InputFields/NumberInput.tsx` - Built-in range validation with onBlur clamping
- All `Add*Modal.tsx` components - Date validation (end date must be after start date)
- `IncomeCard.tsx`, `ExpenseCard.tsx` - Date validation on edit

**Implementation** (DONE):
1. ✅ Built validation directly into input components (validates on change/blur)
2. ✅ Error messages display under inputs (red text)
3. ✅ Claiming age clamps to 62-70 range on blur (not during typing)
4. ✅ Date range validation (end date must be after start date)
5. ✅ Contribution Growth dropdown hides when no contributions exist

**Validation**: Input components enforce constraints automatically ✅

---

#### 2.2.1 Collapsible Cards ✅ **COMPLETE**
**Files modified**:
- `src/components/Objects/Income/IncomeCard.tsx` - Collapsible with name + amount/frequency
- `src/components/Objects/Expense/ExpenseCard.tsx` - Collapsible with name + amount/frequency
- `src/components/Objects/Accounts/AccountCard.tsx` - Collapsible with name + amount

**Implementation** (DONE):
1. ✅ Cards default to collapsed state (show name + amount only)
2. ✅ Click anywhere on collapsed card to expand
3. ✅ Chevron icon rotates on expand/collapse
4. ✅ Frequency abbreviations (Monthly → "/mo", Weekly → "/wk", Annually → "/yr")
5. ✅ Special handling for FutureSocialSecurityIncome (shows "Auto-calculated" when no PIA)

**Validation**: Cards collapse by default, expand on click, all fields editable when expanded ✅

---

#### 2.2.2 Auto Deduction Method ✅ **COMPLETE**
**Files modified**:
- `src/components/Objects/Taxes/TaxContext.tsx` - Added 'Auto' to DeductionMethod type
- `src/components/Objects/Taxes/TaxService.tsx` - Auto-select logic in calculateFederalTax/calculateStateTax
- `src/tabs/Current/TaxesTab.tsx` - Dropdown UI with Auto/Standard/Itemized options

**Implementation** (DONE):
1. ✅ Added "Auto" deduction method (default)
2. ✅ Tax service calculates both standard and itemized, picks lower tax
3. ✅ UI shows dropdown with "Auto (Recommended)", "Standard", "Itemized"
4. ✅ Info text shows which method is being used when Auto is selected
5. ✅ Results section shows " - Auto" suffix when auto-selection is active

**Validation**: Auto mode correctly selects whichever deduction results in lower taxes ✅

---

#### 2.3 Tooltips & Help System ✅ **COMPLETE**
**Files created/modified**:
- `src/components/Layout/InputFields/Tooltip.tsx` - NEW reusable tooltip component
- `src/components/Layout/InputFields/StyleUI.tsx` - Added tooltip prop to InputGroup, StyledInput, StyledSelect, StyledDisplay
- `src/components/Layout/InputFields/*.tsx` - All input components now support tooltip prop
- `src/components/Objects/Accounts/AddAccountModal.tsx` - Tooltips for expense ratio, tax type, vesting, etc.
- `src/components/Objects/Accounts/AccountCard.tsx` - Same tooltips in card view
- `src/components/Objects/Expense/AddExpenseModal.tsx` - Tooltips for mortgage fields (PMI, property tax, etc.)
- `src/components/Objects/Income/AddIncomeModal.tsx` - Tooltips for 401k contributions, employer match, etc.

**Implementation** (DONE):
1. ✅ Created Tooltip component with hover/focus states and auto-positioning (top/bottom)
2. ✅ Added "?" icon next to field labels when tooltip prop is provided
3. ✅ Added help text to complex fields:
   - Expense Ratio: "Annual fee charged by fund. Example: 0.15% = $15 per $10,000 invested per year."
   - Vesting: "Percentage of employer match that vests each year. Example: 20% means fully vested after 5 years."
   - PMI: "Private Mortgage Insurance. Required if down payment < 20%. Usually 0.5-1% of loan annually."
   - Tax Type: "Brokerage (taxable), Traditional (pre-tax), Roth (post-tax, tax-free growth)"
   - Contribution Growth: "Fixed, Grow with Salary, or Track Annual Maximum"
   - And many more mortgage, loan, and income fields
4. ✅ Accessible via keyboard focus and hover

**Validation**: Hover over complex fields to see helpful tooltips ✅

---

#### 2.4 Confirmation Dialogs & Success Feedback ✅ **COMPLETE**
**Files created/modified**:
- `src/components/Layout/ConfirmDialog.tsx` - NEW reusable confirmation dialog component
- `src/components/Objects/Accounts/DeleteAccountUI.tsx` - Added confirmation before delete
- `src/components/Objects/Income/DeleteIncomeUI.tsx` - Added confirmation before delete
- `src/components/Objects/Expense/DeleteExpenseUI.tsx` - Added confirmation before delete

**Implementation** (DONE):
1. ✅ Created reusable `<ConfirmDialog>` component with:
   - Danger/warning/info variants
   - Escape key to cancel
   - Click outside to cancel
   - Focus on cancel button by default (safer)
   - Accessible (aria-modal, aria-labelledby, alertdialog role)
2. ✅ Added confirmation dialogs to all delete operations:
   - Account delete: Warns about linked expenses for debt/property accounts
   - Income delete: Warns about cashflow impact
   - Expense delete: Warns about linked accounts for mortgage/loan expenses
3. ⏸️ Toast notifications deferred (not needed for current use cases)

**Validation**: Click delete on any item, confirmation dialog appears with appropriate warning ✅

---

#### 2.5 Loading States & Progress Indicators ✅ **COMPLETE**
**Files created/modified**:
- `src/components/Layout/LoadingSpinner.tsx` - NEW reusable loading components
- `src/tabs/Future/FutureTab.tsx` - Added loading state during simulation

**Implementation** (DONE):
1. ✅ Created reusable loading components:
   - `LoadingSpinner` - Animated spinner with sm/md/lg sizes
   - `LoadingOverlay` - Full overlay with spinner and message
   - `Skeleton` - Placeholder loading animation for content
   - `ChartSkeleton` - Specialized skeleton for chart areas
2. ✅ Added loading spinner to "Recalculate" button
3. ✅ Disabled "Recalculate" button while simulation running
4. ✅ Added loading overlay to main content area during simulation
5. ✅ Auto-recalculate on mount shows loading state

**Validation**: Click "Recalculate", verify spinner shows on button and overlay appears on content ✅

---

#### 2.6 TypeScript Type Safety Improvements ✅ **COMPLETE**
**Files modified**:
- `src/components/Objects/Assumptions/SimulationEngine.tsx` - Exhaustive type check for account handling
- `src/components/Charts/CashflowSankey.tsx` - Added AnyIncome/AnyExpense types, removed matchIsRoth
- `src/tabs/Future/FutureTab.tsx` - Type narrowing for PropertyAccount.loanAmount
- `src/tabs/Future/tabs/CashflowTabs.tsx` - Added PropertyAccount instanceof check
- `src/tabs/Future/tabs/DataTab.tsx` - Added PropertyAccount instanceof check
- `src/tabs/Future/tabs/OverviewTab.tsx` - `as const` for dynamic property keys

**Implementation** (DONE):
1. ✅ Replaced `@ts-ignore` with proper `instanceof` type guards
2. ✅ Added exhaustive `never` check for account type handling
3. ✅ Used `as const` for literal type inference on dynamic keys
4. ✅ Added proper typing (AnyIncome, AnyExpense) to component props
5. ✅ Removed non-existent `matchIsRoth` property access
6. ✅ All 8 `@ts-ignore` instances removed from src/

**Validation**: Build passes, all 405 tests pass ✅

---

#### 2.7 Performance Optimization (Main Thread Blocking) ✅
**Problem**: Chrome DevTools showing 285-577ms long tasks on UI interactions:
- Opening Accounts/Income/Expense menus
- Switching between Future dashboard subtabs
- General state changes triggering cascading updates

**Root Causes Identified**:
1. **Synchronous localStorage writes** - Every context writes to localStorage on EVERY state change (6 contexts × JSON.stringify + setItem = 300-600ms blocking)
2. **Nivo charts mount/unmount** - Tab switches fully unmount heavy chart components
3. **No context value memoization** - Context values create new objects on every render
4. **No React.memo on tab components** - Components re-render unnecessarily

**Implementation** (COMPLETE):
1. Created `src/hooks/useDebouncedLocalStorage.ts` - 500ms debounce hook for localStorage writes
2. Updated all 6 contexts to use debounced localStorage:
   - `AccountContext.tsx` - Debounced + memoized context value
   - `IncomeContext.tsx` - Debounced + memoized context value
   - `ExpenseContext.tsx` - Debounced + memoized context value
   - `TaxContext.tsx` - Debounced + memoized context value
   - `AssumptionsContext.tsx` - Debounced + memoized context value
   - `SimulationContext.tsx` - Debounced + memoized context value
3. Updated `FutureTab.tsx` to use CSS-based tab switching (hidden class) instead of conditional rendering
4. Wrapped all tab components with React.memo:
   - `OverviewTab`, `CashflowTab`, `DebtTab`, `DataTab`, `AssetsTab`
   - `MilestoneCard`, `ProgressTimeline`, `MilestoneBadge`
5. Updated test files to account for debounced localStorage writes

**Validation**: Build passes, all 405 tests pass ✅

---

## Phase 3: Monte Carlo & Real-World Data (PRIORITY 3)
**Timeline**: After mobile improvements
**Complexity**: Very High (stochastic modeling, historical data)
**Impact**: Very High - Probabilistic planning

### Features to Build

#### 3.1 Monte Carlo Simulation Engine
**Files to create**:
- `src/components/Objects/Assumptions/MonteCarloEngine.tsx` - NEW simulation engine
- `src/tabs/Future/tabs/MonteCarloTab.tsx` - NEW tab for results

**Implementation**:
1. Run 1,000+ parallel simulations with variable returns:
   - Use historical S&P 500 return distribution (mean 10%, std dev 18%)
   - Randomly sample returns for each year
   - Apply sequence-of-returns risk (bad years early vs late)
2. Calculate success metrics:
   - % of simulations where portfolio lasts until life expectancy
   - Median portfolio value at death
   - 10th/50th/90th percentile outcomes
3. Visualize with fan chart showing:
   - Middle 50% of outcomes (dark band)
   - Middle 90% of outcomes (light band)
   - Median path (line)
4. Add user controls:
   - Number of simulations (1,000/5,000/10,000)
   - Return distribution parameters (mean, std dev)
   - Toggle historical vs user-defined returns

**Validation**: Run 1,000 simulations, verify success rate makes sense (e.g., 4% withdrawal = ~95% success)

---

#### 3.2 Historical Market Data Integration
**Files to create**:
- `src/data/HistoricalReturns.tsx` - S&P 500 annual returns (1926-2024)
- `src/data/HistoricalInflation.tsx` - CPI data (1926-2024)

**Implementation**:
1. Import 100 years of historical data from public sources:
   - S&P 500 total returns (dividends reinvested)
   - Consumer Price Index (CPI) inflation
   - Treasury bond yields (for bond allocation modeling)
2. Add "Historical Sequence" mode:
   - Simulate retirement starting in 1926, 1927, ..., 2024
   - Show which start years would have succeeded/failed
   - Famous failures: 1966 (sequence risk), 1929 (Great Depression), 2000 (dot-com)
3. Add toggle: "Use Historical Returns" vs "Use Assumed Returns"

**Validation**: Simulate 1966 retirement (worst case), verify portfolio depletion shows correctly

---

## Phase 4: Advanced Analytics & Reporting (PRIORITY 4)
**Timeline**: After Monte Carlo implementation
**Complexity**: Medium-High
**Impact**: High - Professional-grade output

### Features to Build

#### 4.1 Tax Optimization Recommendations
**Files to create**:
- `src/components/Optimization/TaxOptimizer.tsx` - NEW analysis engine
- `src/tabs/Future/tabs/TaxPlanningTab.tsx` - NEW tab

**Implementation**:
1. Analyze current tax situation and suggest improvements:
   - "Increase 401k to $23,000 to save $X in taxes"
   - "Consider Roth conversion while in 12% bracket"
   - "Max out HSA for triple tax advantage"
2. Calculate marginal tax rate (federal + state + FICA)
3. Show tax bracket projection over time:
   - Which years will you be in 12% vs 22% vs 24% bracket?
   - Optimal Roth conversion years (low income years)
4. Roth conversion calculator:
   - Input: Amount to convert
   - Output: Tax owed, long-term savings
5. Tax-loss harvesting recommendations (for taxable accounts)

**Validation**: Input scenario where Roth conversion makes sense, verify recommendation appears

---

#### 4.2 Scenario Comparison Tool
**Files to create**:
- `src/components/Objects/Scenarios/ScenarioContext.tsx` - NEW context for managing scenarios
- `src/tabs/Future/tabs/CompareTab.tsx` - NEW tab

**Implementation**:
1. Allow saving multiple scenarios:
   - "Baseline Plan"
   - "Retire at 62"
   - "Buy rental property"
   - "Max out 401k"
2. Side-by-side comparison view:
   - Portfolio value at retirement
   - FI year
   - Total lifetime taxes paid
   - Legacy value (estate at death)
3. Visual diff highlighting:
   - Green: Scenario performs better
   - Red: Scenario performs worse
4. Export comparison as PDF or share link

**Validation**: Create two scenarios, verify comparison shows differences clearly

---

#### 4.3 PDF Report Generation
**Files to create**:
- `src/utils/PDFGenerator.tsx` - Uses jsPDF or react-pdf
- `src/tabs/Future/ExportTab.tsx` - NEW tab for export options

**Implementation**:
1. Generate professional PDF financial plan including:
   - **Executive Summary**: FI year, retirement readiness, key metrics
   - **Net Worth Projection**: Chart + table
   - **Cashflow Analysis**: Sankey diagram for current year + next 5 years
   - **Tax Summary**: Lifetime taxes, marginal rates, optimization suggestions
   - **Monte Carlo Results**: Success rate, fan chart, percentile outcomes
   - **Account Details**: All accounts with balances and growth rates
   - **Assumptions**: All input assumptions clearly documented
2. Add customization options:
   - Include/exclude sections
   - Logo upload for personalization
   - Custom footer text
3. Export formats: PDF, CSV (raw data), JSON (backup)

**Validation**: Generate PDF, verify all charts render correctly and data is accurate

---

#### 4.4 Budget Tracking (Actual vs Projected)
**Files to create**:
- `src/components/Objects/Transactions/TransactionContext.tsx` - NEW context
- `src/tabs/Budget/BudgetTab.tsx` - NEW main tab

**Implementation**:
1. Add transaction logging:
   - Manual entry: Date, Amount, Category, Account
   - CSV import from bank (basic support)
2. Compare actual spending vs assumptions:
   - Projected: $600/month groceries
   - Actual: $720/month (20% over)
   - Variance alert: "Spending is above projection"
3. Category breakdown with progress bars:
   - Housing: $2,500/$2,500 (100%)
   - Food: $720/$600 (120% ⚠️)
   - Transportation: $400/$500 (80% ✅)
4. Update projections based on actual data:
   - "Use actual spending for future projections" toggle
   - Auto-adjust expense assumptions

**Validation**: Enter transactions, verify variance calculations and alerts

---

#### 4.5 Financial Ratio Analysis
**Files to create**:
- `src/components/Analytics/FinancialRatios.tsx` - Calculation engine
- `src/tabs/Dashboard.tsx` - Add ratio cards

**Implementation**:
1. Calculate and display key ratios:
   - **Savings Rate**: (Income - Taxes - Expenses) / Income
   - **Debt-to-Income**: Monthly debt payments / Monthly income
   - **Liquidity Ratio**: Liquid assets / Monthly expenses
   - **Net Worth Growth Rate**: YoY % change
   - **Investment Allocation**: % in stocks/bonds/cash/real estate
2. Add benchmarks and guidance:
   - Savings rate: Good >20%, Excellent >30%
   - Debt-to-income: Good <36%, Excellent <20%
   - Liquidity: Good 6 months, Excellent 12 months
3. Trend visualization (arrow up/down, color-coded)
4. Historical tracking (store monthly snapshots)

**Validation**: Verify ratios calculate correctly and benchmarks make sense

---

## Phase 5: Additional Features (Future Considerations)

### 5.1 Real Estate Features
- Multi-property support (primary, rental, vacation)
- Rental income modeling with vacancy rates
- Depreciation deductions (MACRS)
- 1031 exchange planning
- Cap rate and cash-on-cash return calculations

### 5.2 Advanced Retirement Features
- **Required Minimum Distributions (RMDs)**: Auto-trigger at age 73, IRS Uniform Lifetime Table, force withdrawals from Traditional accounts, 50% penalty if not taken
- Pension integration (defined benefit plans)
- Annuity modeling (immediate, deferred, variable)
- Health Savings Account (HSA) optimization for non-qualified expenses
- Medicare cost estimation
- Long-term care insurance planning
- Estate planning (inheritance, beneficiaries)

### 5.3 Collaboration & Sharing
- Multi-user accounts (household planning)
- Financial advisor sharing (read-only link)
- Version history and rollback
- Comments and notes on scenarios

### 5.4 Advanced Tax Features
- Alternative Minimum Tax (AMT) calculation
- Net Investment Income Tax (NIIT) 3.8%
- Capital gains tax optimization
- Tax-loss harvesting automation
- Qualified Business Income (QBI) deduction (Section 199A)

### 5.5 Data Integration
- Bank account linking (Plaid API)
- Brokerage account sync (read-only)
- Auto-update asset values
- Real-time net worth tracking

### 5.6 Asset Allocation Modeling
**Files to modify**:
- `src/components/Objects/Accounts/models.tsx` - Add allocation field to InvestedAccount
- `src/components/Objects/Assumptions/AssumptionsContext.tsx` - Add bond/stock split

**Implementation**:
1. Allow users to specify stock/bond allocation per account:
   - Example: 60% stocks (10% return, 18% std dev) / 40% bonds (4% return, 6% std dev)
2. Calculate blended return and risk:
   - Expected return = 0.6 * 10% + 0.4 * 4% = 7.6%
   - Risk = sqrt(0.6² * 18² + 0.4² * 6²) ≈ 11.5%
3. Add "Glidepath" feature:
   - Auto-adjust allocation with age (e.g., 80% stocks at 30, 40% stocks at 70)
   - Common rule: "110 - age" = stock %
4. Integrate with Monte Carlo (sample from blended distribution)

**Validation**: Set 60/40 allocation, verify returns in simulation match blended expectation

---

### 5.7 Sequence-of-Returns Risk Visualization
**Files to create**:
- `src/tabs/Future/tabs/SequenceRiskTab.tsx` - NEW tab

**Implementation**:
1. Show two scenarios with identical average returns but different sequences:
   - Scenario A: Bad years early (-20%, -10%, +5%, +15%, +20%)
   - Scenario B: Bad years late (+20%, +15%, +5%, -10%, -20%)
2. Demonstrate why Scenario A depletes portfolio faster (selling low)
3. Add interactive slider: "Move bad years earlier/later"
4. Calculate "sequence risk score" (0-100) based on withdrawal plan

**Validation**: Verify early bad years have worse outcomes than late bad years

---

## Technical Debt & Quality Improvements

### Code Quality
- ✅ Remove all 9 `@ts-ignore` instances (Phase 2.6)
- ⚠️ Implement 401k max tracking logic (TODO in models.tsx:105)
- ⚠️ Address SALT deductibility logic (TODO in TaxService.tsx:350)
- ⚠️ Delete `Testing copy.tsx` backup file
- ⚠️ Add comprehensive JSDoc comments to complex functions

### Testing
- Expand unit test coverage to 90%+ (currently ~80%)
- Add integration tests for simulation engine
- Add E2E tests with Playwright for critical user flows
- Performance testing for Monte Carlo (1,000+ simulations)

### Performance
- Lazy load charts (defer rendering until visible)
- Debounce input changes (wait 300ms before recalculating)
- Web Worker for Monte Carlo (don't block main thread)
- Memoize expensive calculations (e.g., tax brackets)

### Accessibility
- Add ARIA labels to all interactive elements
- Ensure WCAG AA color contrast (green on gray may fail)
- Keyboard navigation for all modals (focus trapping)
- Screen reader testing with NVDA/JAWS

---

## Implementation Strategy

### Recommended Order
1. ✅ **Phase 1.1**: Social Security (highest user value) - COMPLETE
2. ✅ **Phase 1.2**: Advanced withdrawal strategies - COMPLETE
3. ✅ **Phase 1.3**: Withdrawal strategy UI - COMPLETE
4. ✅ **Phase 2.2**: Input validation (prevents bad data) - COMPLETE
5. ✅ **Phase 2.1**: Mobile responsiveness - COMPLETE
6. ✅ **Phase 1.4**: Retirement milestone tracker - COMPLETE
7. ✅ **Phase 2.2.1**: Collapsible cards - COMPLETE
8. ✅ **Phase 2.2.2**: Auto deduction method - COMPLETE
9. ✅ **Phase 2.3**: Tooltips & help - COMPLETE
10. ✅ **Phase 2.4**: Confirmation dialogs - COMPLETE
11. ✅ **Phase 2.5**: Loading states - COMPLETE
12. ✅ **Phase 2.6**: TypeScript type safety (@ts-ignore cleanup) - COMPLETE
13. **Phase 2.7**: Performance optimization (localStorage debounce, memoization) ← **NEXT**
14. **Phase 3.1**: Monte Carlo engine (big lift)
14. **Phase 3.2**: Historical data integration
15. **Phase 4.1**: Tax optimization
16. **Phase 4.2**: Scenario comparison
17. **Phase 1.5**: RMDs (lower priority, in Phase 5)
18. **Phases 4.3-4.5**: As needed based on user feedback

---

## Success Metrics

Not sure I want to track user data. Might be good for deciding what to work on if this gets that popular.

### User Engagement
- Time spent in app (target: 15+ minutes per session)
- Return rate (target: 3+ sessions per month)
- Feature adoption (% of users using Monte Carlo, withdrawal planning, etc.)

### Technical Quality
- TypeScript strict mode with zero errors
- 90%+ test coverage
- Lighthouse score: 90+ (Performance, Accessibility, Best Practices)
- Zero `@ts-ignore` directives

### User Satisfaction
- Error rate <1% (caught by validation before submission)
- Mobile usability score >80% (via user testing)
- Feature requests tracked and prioritized

---

## Critical Files Reference

### Retirement Features
- `src/components/Objects/Income/models.tsx` - SocialSecurityIncome (line 139)
- `src/components/Objects/Assumptions/SimulationEngine.tsx` - Withdrawal logic (lines 109-231)
- `src/components/Objects/Assumptions/AssumptionsContext.tsx` - WithdrawalBucket, withdrawal strategies (lines 15-51)
- `src/tabs/Future/FutureTab.tsx` - FI detection (lines 68-94)

### UI Components
- `src/components/Inputs/StyledInput.tsx` - Input validation
- `src/components/Objects/*/Add*Modal.tsx` - All modals (9 files)
- `src/tabs/Dashboard.tsx` - Main landing page

### Tax & Calculation
- `src/components/Objects/Taxes/TaxService.tsx` - Tax calculation engine, SALT TODO (line 350)
- `src/data/TaxData.tsx` - Tax bracket data

### Charts
- `src/components/Charts/CashflowSankey.tsx` - Cashflow visualization
- `src/components/Charts/AssetsStreamChart.tsx` - Asset allocation stream
- `src/components/Charts/NetWorth.tsx` - Net worth trend

### Type Safety Issues
- 9 `@ts-ignore` instances across 7 files (see Phase 2.6)

---

## Verification Plan

### End-to-End Testing Scenarios

**Scenario 1: Retirement Planning**
1. Create user profile (age 40, plans to retire at 65)
2. Add Social Security income (claiming at 67)
3. Set up withdrawal strategy (Fixed Real, 4%)
4. Run simulation
5. Verify:
   - Social Security starts at age 67
   - Withdrawals follow strategy
   - Portfolio lasts until life expectancy
   - RMDs start at age 73

**Scenario 2: Mobile Experience**
1. Open app on iPhone SE (375px width)
2. Add account via modal
3. Navigate through all tabs
4. Generate chart
5. Verify:
   - No horizontal scroll
   - All buttons tappable (minimum 44x44px)
   - Modals don't overflow
   - Charts render correctly

**Scenario 3: Monte Carlo Validation**
1. Set up retirement plan
2. Run 1,000 simulations
3. Compare to deterministic result
4. Verify:
   - Median outcome ≈ deterministic outcome
   - 90% confidence interval makes sense
   - Fan chart renders correctly
   - Success rate calculation accurate

**Scenario 4: Tax Optimization**
1. Input scenario with low tax year (sabbatical)
2. Run tax optimizer
3. Verify:
   - Recommends Roth conversion
   - Calculates tax impact correctly
   - Shows long-term benefit

---

## Risks & Mitigations

### Risk 1: Monte Carlo Performance
**Issue**: Running 1,000+ simulations could freeze UI
**Mitigation**: Use Web Workers, show progress bar, allow cancellation

### Risk 2: Mobile Complexity
**Issue**: Financial data is dense, hard to display on small screens
**Mitigation**: Prioritize most important info, use progressive disclosure, allow desktop-only features

### Risk 3: Historical Data Accuracy
**Issue**: Historical returns may not reflect future performance
**Mitigation**: Clear disclaimers, allow user-defined distributions, show multiple scenarios

### Risk 4: Tax Law Changes
**Issue**: Tax brackets/rules change annually
**Mitigation**: Version tax data by year, add admin interface for updates, clear documentation

---

## Open Questions for User

1. **Social Security**: Should we support spousal benefits and survivor benefits, or start with individual only?
   - For now I'll focus on individual only. My simplistic thought it that if survivor benefits get used, I'd hope overall costs go down at the same rate that benefits are lost.
2. **Monte Carlo**: Is 1,000 simulations enough, or do you want 5,000-10,000 for better precision?
   - 1,000 is probably good, 100 might even be fine. I think this is just a performace question that'll be answered later.
3. **Historical Data**: Focus on S&P 500 only, or add bonds, real estate, international stocks?
   - Idk
4. **PDF Export**: Basic charts + data, or full professional report with branding?
   - Basic charts and data. Nothing professional.
5. **Budget Tracking**: Manual entry only, or attempt CSV import from banks?
   - Importing directly from banks would be a huge quality of life improvement for me, but it may be too hard.
   - If importing directly from a bank is too hard I think we should set up a standard excel/google sheet and have them enter data there and import that file. 
      - I doubt I'd make UI equal to google sheets.
