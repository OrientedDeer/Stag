# Stag - Roadmap

## Pending User Testing

These features are complete but need validation:

- **ESPP Accounts** - Lot tracking, tax calculations, withdrawal preferences
- **Tax Optimization System** ([#28](https://github.com/OrientedDeer/Stag/issues/28)) - Roth conversion planning, smart withdrawal ordering, bracket-aware execution. Tests need updating.

---

## High Priority

### Tax-Adjusted Net Worth Comparison

- The headline "total balance" number doesn't tell the full story — $2M in Roth is worth more than $2M in Traditional because the Traditional money has a hidden tax liability
- Show a tax-adjusted net worth metric that discounts Traditional/pre-tax balances by estimated future tax rate
- Use this to demonstrate the real value of tax optimization: even if total nominal balances look similar with optimization ON vs OFF, the after-tax purchasing power can be significantly different
- Display on the withdrawal or overview tab as a comparison (e.g., "Effective after-tax wealth: $X with optimization vs $Y without")

---

## Recently Completed

- **Partial-Year Simulation** ([#26](https://github.com/OrientedDeer/Stag/issues/26)) - First simulation year scales contributions by remaining months; fixed double-counting growth bug
- **Tax-Optimized Withdrawals** - Moved behind the Experimental Features toggle; auto-disabled when experimental is turned off
- **Budget UX** - Collapsible settings sections (minimized by default), last-import date indicator, year progress color scheme update
- **Budget Tracking** - Track actual spending vs projections with CSV import, auto-categorization rules, monthly snapshots, spending trends analysis
- **Cloud Backup with Client-Side Encryption** - Optional zero-knowledge cloud backup using AES-256-GCM encryption (Web Crypto API, no dependencies). OAuth sign-in via Google/GitHub through AWS Cognito, pre-signed S3 URLs, passphrase never stored. Unified Data Management panel in sidebar consolidates local file export/import, QR code transfer, and cloud backup

---

## Later

### Features
- RSU (Restricted Stock Unit) support — see detailed breakdown below
- Tutorial / walkthrough for new users
  - Should wait until the app is essentially feature-complete to avoid constant updates

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
