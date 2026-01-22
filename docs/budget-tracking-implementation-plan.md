# Budget Tracking - Implementation Plan

## Phase 1: Core Structure (Current Focus)

### Files to Create

| File | Purpose |
|------|---------|
| `src/components/Objects/Budget/BudgetContext.tsx` | State management for budget data (DONE) |
| `src/components/Objects/Budget/budgetUtils.ts` | Helper functions for budget calculations |
| `src/tabs/Budget/BudgetTab.tsx` | Main Budget tab with sub-navigation |
| `src/tabs/Budget/SpendingTab.tsx` | Monthly budget vs actual view |
| `src/tabs/Budget/AccountsTab.tsx` | Account balance tracking |
| `src/tabs/Budget/OverviewTab.tsx` | Summary stats and charts |
| `src/tabs/Budget/TransactionsTab.tsx` | Transaction list (Phase 3) |
| `src/tabs/Budget/ImportTab.tsx` | CSV import (Phase 3) |

### Files to Modify

| File | Changes |
|------|---------|
| `src/App.tsx` | Add BudgetProvider, add routes for /budget/* |
| `src/components/Layout/Overlays/Sidebar.tsx` | Add Budget section with sub-links |

### Data Flow

```
ExpenseContext (existing)     AccountContext (existing)     SimulationContext (existing)
       │                              │                              │
       │ getAnnualAmount()           │ accounts list                │ year 1 projections
       │                              │                              │
       └──────────────────────────────┴──────────────────────────────┘
                                      │
                                      ▼
                              BudgetContext (new)
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
              SpendingTab       AccountsTab       OverviewTab
           (budget vs actual)  (balance tracking)  (charts/goals)
```

### SpendingTab UI Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ◀ January 2026 ▶                                    [Year View] [Month]│
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ ┌─ Summary ─────────────────────────────────────────────────────────┐  │
│ │ Budget: $4,500    Spent: $4,123    Remaining: $377 ✓              │  │
│ └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│ ┌─ By Category ─────────────────────────────────────────────────────┐  │
│ │                                                                   │  │
│ │  [DataSheetGrid with columns:]                                    │  │
│ │  Category | Budget | Actual | Diff | Notes                        │  │
│ │  ─────────────────────────────────────────────────────            │  │
│ │  Rent        $1,800   $1,800    $0                                │  │
│ │  Groceries   $600     $542    -$58                                │  │
│ │  Dining      $200     $287    +$87                                │  │
│ │  ...                                                              │  │
│ │                                                                   │  │
│ └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### AccountsTab UI Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Account Balances - January 2026                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ ┌─ Behavior Check ──────────────────────────────────────────────────┐  │
│ │ Expected contributions this month: $1,500                          │  │
│ │ Actual contributions: $1,500  ✓ On track                          │  │
│ └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│ ┌─ Balances ────────────────────────────────────────────────────────┐  │
│ │                                                                   │  │
│ │  [DataSheetGrid with columns:]                                    │  │
│ │  Account | Last Month | Expected | Actual | Diff                  │  │
│ │  ─────────────────────────────────────────────────────            │  │
│ │  Checking    $5,000     $4,800    $4,756   -$44                   │  │
│ │  Savings     $15,000    $15,500   $15,500   $0                    │  │
│ │  Brokerage   $45,000    $46,200   $44,800  -$1,400 (mkt)          │  │
│ │  ...                                                              │  │
│ │                                                                   │  │
│ └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│ ┌─ Year View ───────────────────────────────────────────────────────┐  │
│ │ [Horizontal scrollable grid: Month rows × Account columns]        │  │
│ └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps (Phase 1)

### Step 1: BudgetContext ✅ DONE
- [x] Create BudgetContext.tsx with state management
- [x] Define MonthlySnapshot, Transaction, CategoryMapping types
- [x] Implement reducer with all actions
- [x] Add localStorage persistence

### Step 2: Budget Utilities
- [ ] Create budgetUtils.ts with:
  - `getExpectedMonthlyBudget(expense)` - returns monthly budget from Expense
  - `getExpectedAccountBalance(accountId, month, year, simulation)` - prorated from simulation
  - `getExpectedContribution(accountId, month, simulation)` - expected monthly contribution
  - `calculateBudgetSummary(month, expenses)` - total budget vs actual
  - `formatMonthYear(month, year)` - display helper

### Step 3: Update App.tsx
- [ ] Import BudgetProvider
- [ ] Wrap app with BudgetProvider
- [ ] Add routes:
  - `/budget` → BudgetTab (Overview)
  - `/budget/overview` → OverviewTab
  - `/budget/spending` → SpendingTab
  - `/budget/accounts` → AccountsTab
  - `/budget/transactions` → TransactionsTab (placeholder)
  - `/budget/import` → ImportTab (placeholder)

### Step 4: Update Sidebar
- [ ] Add Budget section between Current and Future
- [ ] Add sub-links: Overview, Spending, Accounts, Transactions, Import
- [ ] Create budget icon (clipboard/checklist style)

### Step 5: Create BudgetTab Shell
- [ ] Create BudgetTab.tsx as container
- [ ] Add sub-tab navigation (similar to FutureTab pattern)
- [ ] Route to appropriate sub-component

### Step 6: Create SpendingTab
- [ ] Month selector (prev/next arrows)
- [ ] Summary stats (total budget, spent, remaining)
- [ ] DataSheetGrid for category-by-category entry
- [ ] Auto-populate budget column from Expenses
- [ ] Save actual spending to BudgetContext

### Step 7: Create AccountsTab
- [ ] Behavior check section (contributions)
- [ ] DataSheetGrid for account balances
- [ ] Pull expected values from simulation
- [ ] Year-at-a-glance grid (rows=months, cols=accounts)

### Step 8: Create OverviewTab
- [ ] Quick stats cards
- [ ] Budget vs actual trend chart (last 6 months)
- [ ] Goal progress indicators
- [ ] Link to detailed views

---

## Phase 2: Visualization (Later)
- Spending trend charts using Nivo
- Account balance progression chart
- Goal progress bars
- Year-end projection updates based on actual spending

## Phase 3: Import & Automation (Later)
- CSV upload and parsing
- Column mapping UI
- Auto-categorization rules
- Transaction list with category assignment
- Reconciliation helper

---

## Questions Before Proceeding

1. **Month selector**: Should the default view be current month, or should we show a "get started" state if no data exists?

2. **Empty state**: When a user first visits Budget tab with no data, what should they see? Options:
   - A. "No data yet - start by entering this month's spending" with a button
   - B. Pre-populated grid with budget amounts from Expenses, actual amounts as 0
   - C. Onboarding wizard

3. **DataSheetGrid styling**: Should I try to match the existing dark theme exactly, or is a slightly different look for the spreadsheet acceptable?

4. **Expense filtering**: Should ALL expenses appear in the budget grid, or only certain types (e.g., exclude one-time expenses)?

---

## Ready to Proceed?

If this plan looks good, I'll continue with Step 2 (budgetUtils.ts) and then update App.tsx and Sidebar.
