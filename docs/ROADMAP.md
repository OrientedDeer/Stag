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

### Tax-Aware Withdrawal Splitting ([#28](https://github.com/OrientedDeer/Stag/issues/28))

The current withdrawal system drains accounts in a fixed user-defined order. With both Roth and Traditional accounts, draining Traditional first can push taxable income into high brackets unnecessarily. Needs a smarter strategy that splits withdrawals across account types to minimize total tax.

Considerations:
- Splitting Traditional withdrawals to stay within a target bracket, then pulling remainder from Roth
- Interaction with RMDs (mandatory Traditional withdrawals that can't be avoided)
- Interaction with Auto Roth Conversions (which already do bracket-filling)
- May need a new withdrawal strategy option ("Tax-Optimized") alongside existing Fixed Real / Percentage / Guyton-Klinger
- The withdrawal bucket priority list UI may need per-bucket caps or tax-aware grouping

### Partial-Year Simulation ([#26](https://github.com/OrientedDeer/Stag/issues/26))

Projections assume the current year has no remaining contributions or income growth. This is accurate in December but significantly underestimates in January (11 months of contributions ignored).

Considerations:
- Need to determine the fraction of the current year remaining (e.g., month-based)
- Scale current-year contributions, income, and expenses by remaining fraction
- Account contributions (401k, HSA, IRA) that have already been made vs. remaining
- Employer match calculations for partial year
- May need a "year-to-date contributions" input or auto-detect from account history
- First simulation year becomes a partial year; subsequent years remain full

### Expense Category Reassignment ([#25](https://github.com/OrientedDeer/Stag/issues/25))

Users cannot change an expense's category without deleting and recreating it. The category should be editable via the existing edit dropdown.

Considerations:
- Each expense class (MortgageExpense, LoanExpense, etc.) has different fields — changing category may require migrating or dropping class-specific data
- Need to decide: allow only within same "shape" (e.g., between discretionary categories) or allow full type changes?
- If full type changes are allowed, need a reconstitution step to swap the class instance

### Testing/Debug Tab — Remaining

- Emergency Fund Tracking - Target vs actual, months of expenses

---

## Recently Completed

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

---

## Later

### Features
- RSU (Restricted Stock Unit) support — see detailed breakdown below
- Tutorial / walkthrough for new users
  - Should wait until the app is essentially feature-complete to avoid constant updates
- Real estate enhancements (property sale, depreciation, capital gains)
- Optional localStorage encryption
- Zero bracket harvesting (withdraw from Traditional tax-free when below standard deduction)
  - Needs design work on interaction with Auto Roth Conversions

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

### Technical Debt
- Screen reader testing
- Monte Carlo performance testing
- Roth conversion tax payment improvement
  - Currently grosses up Roth withdrawal to pay conversion tax
  - Consider grossing up the next account in withdrawal order instead
