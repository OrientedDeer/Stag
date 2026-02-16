# Stag - Roadmap

## Pending User Testing

These features are complete but need validation:

- **ESPP Accounts** - Lot tracking, tax calculations, withdrawal preferences

---

## High Priority

### Tax Optimization System ([#28](https://github.com/OrientedDeer/Stag/issues/28))

A unified "Tax Optimization" toggle on the withdrawal screen that intelligently minimizes lifetime taxes while maintaining plan success rate.

**Goals:**
- Primary: Minimize lifetime taxes
- Secondary: Maintain or improve Monte Carlo success rate (avoid the trap where tax optimization increases plan failures)

**Core Algorithm:**

1. **Calculate Target Traditional Balance** at RMD age (73-75)
   - Input: Expected fixed income (SS, pensions), tax brackets, life expectancy
   - Output: Ideal Traditional balance that keeps RMDs + income within optimal bracket
   - Auto-calculate optimal target bracket based on lifetime tax + success rate

2. **Multi-Year Roth Conversion Planning** (pre-retirement)
   - Spread conversions over years to reach target balance (better than one large conversion)
   - Each year: convert up to bracket headroom
   - Prefer steady conversions over large single-year conversions

3. **Smart Withdrawal Execution** (retirement)
   - Each year: Calculate "bracket space" = Target bracket ceiling − Fixed income
   - Fill bracket space from Traditional (or do Roth conversions if still above target)
   - Take remaining needs from Roth (tax-free)
   - Use brokerage strategically (prefer long-term lots, factor in short-term cost)

4. **Success Rate Guard**
   - Compare success rate with optimization ON vs OFF
   - If success rate drops >2%: dial back aggressiveness (reduce early-year conversions, preserve liquidity)

**Files to Modify:**

| File | Changes |
|------|---------|
| `services/simulation/TaxOptimizedWithdrawal.ts` | **NEW** - Core algorithm (~400 lines) |
| `tabs/Future/WithdrawalTab.tsx` | Add toggle, hide manual ordering when ON, show optimization summary |
| `components/Objects/Assumptions/AssumptionsContext.tsx` | Add `taxOptimizationEnabled`, remove `rothConversionTargetBracket` |
| `components/Objects/Assumptions/SimulationEngine.tsx` | Call smart withdrawal when enabled |
| `services/simulation/RothConversionService.ts` | Accept conversion schedule from optimizer |
| `services/TaxOptimizationService.ts` | Add lifetime tax calculation, strategy comparison |
| `services/simulation/WithdrawalService.ts` | Add lot-aware brokerage logic |

**Important - Inflation Handling:**
- Respect `inflationAdjusted` toggle: when ON, inflate brackets/ceilings to future years; when OFF, use nominal values

**Implementation Order:**
1. AssumptionsContext - Add toggle
2. TaxOptimizedWithdrawal.ts - Core algorithm (new file)
3. SimulationEngine - Integration point
4. WithdrawalTab UI - Toggle and summary display
5. Lot-aware brokerage - WithdrawalService enhancement
6. Success rate guard - Monte Carlo integration
7. Tests - Unit and integration

### Testing/Debug Tab — Remaining

- Emergency Fund Tracking - Target vs actual, months of expenses

---

## Recently Completed

- **Partial-Year Simulation** ([#26](https://github.com/OrientedDeer/Stag/issues/26)) - First simulation year scales contributions by remaining months; fixed double-counting growth bug
- **Withdrawal Strategy: "None"** - Explicit option that skips strategy calculation and just spends listed expenses
- **Fixed Real / Percentage Spending Caps** - These strategies now enforce their budget by trimming discretionary spending (previously informational only)
- **Tax-Optimized Withdrawals** - Moved behind the Experimental Features toggle; auto-disabled when experimental is turned off
- **Budget UX** - Collapsible settings sections (minimized by default), last-import date indicator, year progress color scheme update
- **Mobile Chart X-Axis Labels** - Viewport-aware tick thinning targets ~6-8 labels on mobile vs ~10-12 on desktop across all charts
- **Deficit Warning Banner** - Error-severity AlertBanner on OverviewTab when simulation generates uncovered deficits, showing first year and max shortfall with actionable suggestions
- **5-Year Roth Conversion Tracking** - Proper IRS ordering rules for early Roth withdrawals: contributions first (free), then conversions FIFO (10% penalty within 5 years), then earnings (taxable + penalty)
- **Roth vs Pre-Tax Analysis Panel** - New calculator on Tax tab with contribution/conversion modes, explicit growth years, break-even rate, and auto-optimal amount detection (experimental)
- **Tab Visibility Restructure** - Tax, Scenarios, and Ratios tabs are now always visible; Testing tab moved behind experimental toggle
- **Debug Tabs Expansion** - Added 5 new Testing tab groups: Withdrawals, Accounts, Income & Expenses, Cash Flow, Validation (15 new debug sections total)
- **Roth Conversion Tax Fix** - Fixed $0 tax cost bug where conversion tax didn't account for Traditional withdrawal income in the same year
- **Withdrawal Balance Guard** - Fixed phantom money bug where Roth conversions and expense withdrawals could overdraw the same account (now respects prior outflows)
- **Chart Layout Stability** - Info banners on cashflow chart no longer shift the chart when appearing/disappearing
- **ESPP Support** - Full Employee Stock Purchase Plan account tracking with lot-level detail, qualifying/disqualifying disposition tax handling, configurable withdrawal preferences
- **Budget Tracking** - Track actual spending vs projections with CSV import, auto-categorization rules, monthly snapshots, spending trends analysis
- **Cloud Backup with Client-Side Encryption** - Optional zero-knowledge cloud backup using AES-256-GCM encryption (Web Crypto API, no dependencies). OAuth sign-in via Google/GitHub through AWS Cognito, pre-signed S3 URLs, passphrase never stored. Unified Data Management panel in sidebar consolidates local file export/import, QR code transfer, and cloud backup

---

## Later

### Features
- RSU (Restricted Stock Unit) support — see detailed breakdown below
- Tutorial / walkthrough for new users
  - Should wait until the app is essentially feature-complete to avoid constant updates
- ~~Optional localStorage encryption~~ — Covered by cloud backup encryption (CryptoService exists for local encrypted export if needed)

### RSU (Restricted Stock Unit) Support

Full stock compensation modeling: grant tracking, vesting schedules, tax withholding at vest, post-vest capital gains, and withdrawal integration.

#### Step 1: Data Model — `RSUAccount` and `RSULot`

Create `RSUAccount` extending `BaseAccount` in `models.tsx`, following the ESPP pattern with lot-level tracking:

- **RSULot fields:**
  - `id`, `grantDate` (when grant was issued)
  - `vestDate` (when this tranche vested)
  - `fmvAtVest` (FMV per share at vest = ordinary income per share)
  - `shares` (shares in this tranche)
  - `costBasis` (fmvAtVest × shares — basis for future capital gains)

- **RSUAccount fields:**
  - `lots: RSULot[]` — each vesting tranche becomes one lot
  - `linkedIncomeId: string | null` — link to the WorkIncome providing grants
  - `customROR?: number` — per-account stock return override
  - `stockTicker?: string`, `currentSharePrice?: number`
  - `withdrawalPreference` — lot sale ordering (FIFO, long-term-first, etc.)

- **Methods:** `addLot()`, `removeSoldShares()`, `increment()` (grow aggregate value, keep lot cost bases fixed), `getEligibleLots()`, `calculateSaleTax()` (lot-level short-term vs long-term gains)

- Add `RSUAccount` to the `AnyAccount` union, `reconstitute*()` functions, and `AccountContext` reducer

#### Step 2: Income Configuration — WorkIncome RSU Fields

Add RSU configuration on `WorkIncome` (parallel to existing ESPP fields):

- `rsuGrantShares: number` — shares granted per year (or total unvested)
- `rsuVestingSchedule: 'cliff-1yr' | 'graded-4yr' | 'graded-3yr' | 'custom'`
- `rsuVestFrequency: 'quarterly' | 'semi-annual' | 'annual'`
- `rsuExpectedStockGrowth: number` — annual stock appreciation for projections
- `rsuAccountId: string | null` — linked RSUAccount
- `rsuWithholdingRate: number` — tax withholding % at vest (default ~37% for supplemental income)

Add `getAnnualRSUVestShares(year)` method that returns the number of shares vesting in a given year based on the schedule.

#### Step 3: SimulationEngine — Vesting and Income

In the yearly simulation loop (after income processing, near ESPP purchase logic):

1. **Calculate vesting** — Determine how many shares vest this year from the schedule
2. **Compute ordinary income** — `vestShares × fmvAtVest` (use stock growth projection from prior year's price)
3. **Apply tax withholding** — Reduce shares received by withholding rate (company sells shares to cover taxes); track withheld amount as tax prepayment
4. **Create RSULot** — Add lot with `vestDate = currentYear`, `costBasis = fmvAtVest × netShares`
5. **Add to income tracking** — RSU vest income should appear in the income breakdown and feed into tax calculations (ordinary income)

#### Step 4: TaxService Integration

- RSU vest income is **supplemental wages** — taxed as ordinary income at the marginal rate
- Withholding at vest acts as estimated tax payment (reduce tax owed)
- Post-vest sales follow standard capital gains rules:
  - **Short-term** if sold within 1 year of vest date
  - **Long-term** if held 1+ year after vest date
  - Gain = sale price − cost basis (FMV at vest)
- Integrate with existing `calculateCapitalGainsTax()` for stacking

#### Step 5: Withdrawal Integration

Add RSUAccount handling in the SimulationEngine withdrawal section (alongside InvestedAccount and ESPPAccount):

1. Check `withdrawalPreference` for lot ordering
2. Use iterative net-target calculation (same pattern as ESPP)
3. Separate ordinary income (if N/A for RSU post-vest), short-term gains, and long-term gains
4. Track capital gains taxes for display
5. Respect any minimum holding period setting

#### Step 6: UI — Account Form and Income Configuration

- **RSU Account form** — Similar to ESPP: ticker, current price, lot table, withdrawal preference dropdown
- **WorkIncome RSU section** — Grant size, schedule type, vest frequency, expected growth, withholding rate, linked account picker
- **Lot display** — Show vest date, shares, cost basis, current value, gain/loss, holding period status (short-term / long-term)

#### Step 7: Serialization (QR/Import-Export)

- Add RSUAccount and RSULot field mappings to `qrUtils.ts` (shortened keys)
- Add WorkIncome RSU fields to the key maps
- Add default stripping (empty lots, default withholding rate, etc.)
- Add `reconstitute` support for RSUAccount/RSULot deserialization

#### Step 8: Testing

- **Unit tests for RSUAccount:** lot addition, share removal by preference, increment growth, cost basis preservation
- **Unit tests for vesting schedules:** cliff (0 shares for N years then all), graded (quarterly/annual tranches), multi-grant overlap
- **Tax tests:** ordinary income at vest, short-term vs long-term gains on sale, withholding offset
- **Integration tests:** multi-year simulation with RSU grants, stock growth, vesting, withdrawal, and tax calculation end-to-end
- **Golden master snapshot** updates to include RSU scenarios

#### Considerations

- Multiple overlapping grants (e.g., annual refresh grants with 4-year vesting) — each grant is independent, lots accumulate
- Stock price decline below vest price — lots can have negative unrealized gains (loss harvesting opportunity)
- Interaction with existing capital gains tracking in InvestedAccount — ensure gains stack correctly in tax calculation
- RSU income should appear in the Testing/Debug "Income & Expenses" panel
- Consider whether RSU vesting income triggers Roth conversion optimization changes

### Performance Sweeps

Many pages exceed the 150ms render threshold, triggering React warnings. Target improvements:

- **Memoization audit** — Review expensive computations in render paths; add `useMemo`/`useCallback` where missing
- **Context splitting** — Large contexts (SimulationContext, AssumptionsContext) trigger widespread re-renders; consider splitting into smaller, focused contexts
- **Chart optimization** — Nivo charts are heavy; investigate lazy loading, virtualization for large datasets, or lighter chart libraries for simple visualizations
- **Simulation caching** — Cache intermediate simulation results; avoid full re-runs when only display options change
- **Component code-splitting** — Lazy load heavy tabs (Testing, Scenarios, Monte Carlo) that aren't immediately visible
- **Profile specific pages** — Use React DevTools Profiler to identify worst offenders:
  - Future tab (runs simulation on mount)
  - Monte Carlo tab (heavy computation)
  - Testing tab (many debug panels)
  - Budget tab (transaction table rendering)

### Technical Debt
- Screen reader testing
- Monte Carlo performance testing
