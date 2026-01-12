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
- ⚠️ `SocialSecurityIncome` class exists but not integrated with simulation
- ⚠️ No UI for managing withdrawal strategy buckets
- ⚠️ Withdrawal strategies defined but not implemented
- ⚠️ No automatic Social Security activation at retirement age

### Features to Build

#### 1.1 Social Security Integration ⭐ **CRITICAL**
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

#### 1.2 Advanced Withdrawal Strategies ⭐ **CRITICAL**
**Files to modify**:
- `src/components/Objects/Assumptions/SimulationEngine.tsx` - Implement withdrawal algorithms
- `src/components/Objects/Assumptions/AssumptionsContext.tsx` - Already has types defined
- `src/tabs/Future/AssumptionTab.tsx` - Add UI for selecting strategy

**Implementation**:
1. **Fixed Real Withdrawal** (simplest, already partially implemented):
   - Calculate initial withdrawal amount (e.g., 4% of portfolio)
   - Adjust for inflation each year
   - Maintain constant purchasing power

2. **Percentage-Based Withdrawal**:
   - Recalculate withdrawal as % of current portfolio each year
   - More conservative (portfolio lasts longer but variable income)

3. **Guyton-Klinger Dynamic Withdrawal** (advanced):
   - Start with 4% (or user-defined)
   - Apply "guardrails": reduce withdrawals if portfolio drops significantly, increase if portfolio grows
   - Implement upper/lower bounds (e.g., +20%/-10% from initial)
   - Track portfolio performance and adjust annually

**UI Components**:
- Add strategy selector dropdown in AssumptionTab
- Show explanation of each strategy with example graphs
- Display current year's withdrawal amount in FutureTab

**Validation**: Compare all three strategies side-by-side, verify portfolio longevity differences

---

#### 1.3 Withdrawal Strategy UI ⭐ **HIGH**
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

#### 1.4 Retirement Milestone Tracker
**Files to modify**:
- `src/tabs/Future/FutureTab.tsx` - Already has FI detection (lines 68-94)
- `src/tabs/Future/tabs/OverviewTab.tsx` - Add milestone visualization

**Implementation**:
1. Enhance existing `findFinancialIndependenceYear()` function
2. Add visual timeline showing:
   - Current age → Retirement age → FI age → Life expectancy
   - Major milestones: 59.5 (penalty-free withdrawals), 62 (SS eligible), 65 (Medicare), 67 (full SS), 70 (max SS), 73 (RMDs)
3. Calculate and display:
   - "Years until retirement"
   - "FI Number" (portfolio size needed)
   - "Current progress to FI" (% of FI number achieved)
   - "Retirement readiness score"

**Validation**: Verify FI year updates when assumptions change

---

#### 1.5 Required Minimum Distributions (RMDs)
**Files to modify**:
- `src/components/Objects/Assumptions/SimulationEngine.tsx` - Add RMD calculation
- `src/data/TaxData.tsx` - Add RMD age and percentage tables

**Implementation**:
1. Auto-trigger RMDs at age 73 (SECURE Act 2.0)
2. Calculate RMD percentage based on IRS Uniform Lifetime Table
3. Force withdrawal from Traditional 401k/IRA accounts
4. Add to taxable income in simulation
5. Penalty calculation if RMD not taken (50% of shortfall)

**Validation**: Verify RMDs start at 73, increase with age, and are taxed correctly

---

## Phase 2: Mobile & UI Polish (PRIORITY 2)
**Timeline**: After Phase 1 core features
**Complexity**: Medium (CSS/responsive design)
**Impact**: High - Accessibility for all users

### Current Issues Identified
- ❌ Modals overflow on mobile (`min-w-max` forces full width)
- ❌ No input validation with user-friendly error messages
- ❌ No tooltips or help text for complex fields
- ❌ Inconsistent button styling and spacing
- ❌ No confirmation dialogs for destructive actions (delete)
- ❌ 9 instances of `@ts-ignore` bypassing type safety
- ❌ Charts have fixed heights, not mobile-optimized
- ❌ No loading states during simulation

### Features to Build

#### 2.1 Mobile-First Responsive Design
**Files to modify**:
- `src/components/Objects/*/Add*Modal.tsx` - All modal components
- `src/components/Charts/*.tsx` - All chart components
- `src/tabs/Dashboard.tsx`, `src/tabs/Future/FutureTab.tsx` - Grid layouts

**Implementation**:
1. Replace `min-w-max` with responsive widths (`max-w-md`, `max-w-lg`)
2. Add mobile breakpoints (`sm:`, `md:`, `lg:`) to all grid layouts
3. Make charts responsive:
   - CashflowSankey: Dynamic height based on viewport
   - AssetsStreamChart: Collapse legend on mobile
   - NetWorth: Stack cards vertically on mobile
4. Test on iPhone SE (375px), iPhone Pro (390px), iPad (768px)

**Validation**: Open on mobile device, verify no horizontal scroll, all buttons clickable

---

#### 2.2 Input Validation & Error Feedback
**Files to modify**:
- `src/components/Inputs/StyledInput.tsx` - Add error state support
- All `Add*Modal.tsx` components - Add validation logic

**Implementation**:
1. Create validation utility functions:
   - `validateName(name: string)` - Non-empty, max 50 chars
   - `validateAPR(apr: number)` - 0-100% range
   - `validateAmount(amount: number)` - Positive numbers only
   - `validateDateRange(start, end)` - End after start
2. Add error message display under inputs (red text, icon)
3. Disable "Add" button with tooltip explaining why
4. Add field-level validation on blur
5. Create `<ErrorMessage>` component for consistent styling

**Validation**: Try to create account with invalid data, verify clear error messages

---

#### 2.3 Tooltips & Help System
**Files to modify**:
- All tabs and modal components
- `src/components/Inputs/StyledInput.tsx` - Add tooltip support

**Implementation**:
1. Add tooltip component using Tailwind's `group` utility
2. Add help text to complex fields:
   - "Expense Ratio": "Annual fee charged by fund (e.g., 0.15% = $15 per $10k)"
   - "Vesting": "Time until employer match becomes yours"
   - "PMI": "Required if down payment < 20%"
   - "Standard vs Itemized": "Standard is simpler; Itemize if mortgage interest + SALT > $14,600"
3. Add "?" icon next to field labels
4. Use `aria-describedby` for screen readers

**Validation**: Hover over all complex fields, verify helpful tooltips appear

---

#### 2.4 Confirmation Dialogs & Success Feedback
**Files to modify**:
- All delete operations in `*Tab.tsx` components
- Create `src/components/UI/ConfirmDialog.tsx` and `src/components/UI/Toast.tsx`

**Implementation**:
1. Create reusable `<ConfirmDialog>` component (modal overlay)
2. Add to all delete operations:
   - "Delete Account" → "Are you sure? This will also delete linked expenses."
   - "Delete Income" → "Are you sure? This will affect your cashflow."
3. Create toast notification system:
   - Success: "Account added successfully"
   - Error: "Failed to import file. Invalid format."
   - Warning: "Mortgage loan amount exceeds property value"
4. Position toasts in top-right corner with auto-dismiss (5s)

**Validation**: Delete an account, verify confirmation dialog appears and is clear

---

#### 2.5 Loading States & Progress Indicators
**Files to modify**:
- `src/tabs/Future/FutureTab.tsx` - Add loading state during simulation
- `src/components/Charts/*.tsx` - Add loading skeletons

**Implementation**:
1. Add loading spinner when running simulation (30-40 year projection)
2. Show skeleton loaders for charts while data loads
3. Disable "Recalculate" button while simulation running
4. Add progress bar for long operations (0% → 100%)

**Validation**: Click "Recalculate", verify spinner shows during processing

---

#### 2.6 TypeScript Type Safety Improvements
**Files to modify**:
- `src/components/Objects/Assumptions/SimulationEngine.tsx` (line 343)
- `src/components/Charts/CashflowSankey.tsx` (lines 119, 125)
- `src/tabs/Future/FutureTab.tsx` (line 36)
- All files with `@ts-ignore` (9 instances total)

**Implementation**:
1. Create union types for account-specific properties:
   ```typescript
   type AccountWithLoan = PropertyAccount | DebtAccount;
   function hasLoan(acc: AnyAccount): acc is AccountWithLoan {
     return acc instanceof PropertyAccount || acc instanceof DebtAccount;
   }
   ```
2. Replace `@ts-ignore` with type guards
3. Add proper typing to chart tooltip parameters
4. Remove all 9 instances of `@ts-ignore`

**Validation**: Run `npm run type-check`, verify no errors

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
- Pension integration (defined benefit plans)
- Annuity modeling (immediate, deferred, variable)
- Health Savings Account (HSA) optimization
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
1. **Phase 1.1**: Social Security (highest user value)
2. **Phase 1.2**: Advanced withdrawal strategies
3. **Phase 1.3**: Withdrawal strategy UI
4. **Phase 2.2**: Input validation (prevents bad data)
5. **Phase 2.1**: Mobile responsiveness
6. **Phase 1.4**: Retirement milestone tracker
7. **Phase 2.3**: Tooltips & help
8. **Phase 2.4**: Confirmation dialogs
9. **Phase 3.1**: Monte Carlo engine (big lift)
10. **Phase 3.2**: Historical data integration
11. **Phase 4.1**: Tax optimization
12. **Phase 4.2**: Scenario comparison
13. **Phase 1.5**: RMDs (lower priority)
14. **Phases 3.3-4.5**: As needed based on user feedback

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
