# Budget Tracking Feature - Design Document

## Overview

A new "Budget" tab that bridges the gap between Stag's projections and real-world spending/saving. Users can track actual monthly spending against their budget (defined by Expense objects), monitor account balances, and see how their behavior affects their projected year-end outcomes.

**Core Philosophy**: Separate what you can control (spending, saving behavior) from what you can't (market returns). Show "Am I doing what I said I would?" rather than "Did the market cooperate?"

---

## Data Model

### New Context: BudgetContext

```typescript
interface BudgetState {
  // Monthly snapshots of actual data
  months: MonthlySnapshot[];

  // Transaction import settings
  importSettings: {
    dateColumn: string;
    amountColumn: string;
    descriptionColumn: string;
    categoryMappings: CategoryMapping[]; // auto-categorization rules
  };
}

interface MonthlySnapshot {
  id: string;
  month: number; // 1-12
  year: number;

  // Actual spending by expense ID (maps to existing Expense objects)
  spending: Record<string, number>; // expenseId -> actual amount

  // Account balances at end of month
  accountBalances: Record<string, number>; // accountId -> balance

  // Raw transactions (optional, for reconciliation)
  transactions?: Transaction[];

  // Reconciliation status
  reconciled: boolean;
  discrepancy?: number; // difference between calculated and actual balance

  // Notes
  notes?: string;
}

interface Transaction {
  id: string;
  date: Date;
  description: string;
  amount: number;
  expenseId?: string; // which expense category
  accountId?: string; // which account it came from
  statementDate?: Date; // credit card statement date (for timing)
}

interface CategoryMapping {
  pattern: string; // regex or contains match
  expenseId: string; // auto-assign to this expense
}
```

### Relationship to Existing Models

- **Expenses**: Each Expense object becomes a budget category. The `getAnnualAmount()` is the budget. For annual expenses, we divide by 12 for monthly budget.
- **Accounts**: Track actual balances against these. Compare to simulation's expected balances.
- **Simulation**: Use Year 1 results to get expected monthly progression (prorated).

---

## UI Structure

### New Tab: "Budget" (between Current and Future)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [Current]  [Budget]  [Future]                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─── Month Selector ───┐    ┌─── Year Progress ───────────────────┐   │
│  │ ◀ January 2026 ▶     │    │ [====........] 2/12 months tracked  │   │
│  └──────────────────────┘    └─────────────────────────────────────┘   │
│                                                                         │
│  ┌─── Quick Stats ──────────────────────────────────────────────────┐  │
│  │  Budget: $4,500  │  Spent: $4,123  │  Under by: $377 ✓           │  │
│  │  Expected Savings: $2,000  │  Actual: $2,150  │  Ahead: $150 ✓   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  [Overview] [Spending] [Accounts] [Transactions] [Import]               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Sub-tabs within Budget:

#### 1. Overview
- Year-to-date summary
- Goal progress (on track for year-end?)
- Spending vs budget trend chart (6 months)
- Key insights ("You've been $200/mo under on dining - nice!")

#### 2. Spending (Monthly Budget vs Actual)
```
┌─────────────────────────────────────────────────────────────────────┐
│ Category          │ Budget   │ Actual   │ Diff      │ Progress     │
├───────────────────┼──────────┼──────────┼───────────┼──────────────┤
│ 🏠 Rent           │ $1,800   │ $1,800   │ $0        │ [==========] │
│ 🍎 Groceries      │ $600     │ $542     │ -$58 ✓    │ [========  ] │
│ 🍽️ Dining Out     │ $200     │ $287     │ +$87 ⚠    │ [==========]▶│
│ 🐕 Pet            │ $100     │ $45      │ -$55 ✓    │ [====      ] │
│ 📺 Subscriptions* │ $50      │ $50      │ $0        │ [==========] │
│ ⚡ Utilities      │ $150     │ $178     │ +$28 ⚠    │ [==========]▶│
├───────────────────┼──────────┼──────────┼───────────┼──────────────┤
│ TOTAL             │ $2,900   │ $2,902   │ +$2       │              │
└─────────────────────────────────────────────────────────────────────┘
* Annual expense, showing 1/12 of yearly budget

[+ Add Spending Entry]  [Import from CSV]
```

#### 3. Accounts (Balance Tracking)
```
┌─────────────────────────────────────────────────────────────────────┐
│ Account Balance Tracker - January 2026                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Account          │ Start    │ Expected │ Actual   │ Status         │
├──────────────────┼──────────┼──────────┼──────────┼────────────────┤
│ Checking         │ $5,000   │ $4,800   │ $4,756   │ -$44 (ok)      │
│ Emergency Fund   │ $15,000  │ $15,500  │ $15,500  │ ✓ On track     │
│ Brokerage        │ $45,000  │ $46,200* │ $44,800  │ -$1,400 (mkt)  │
│ 401k             │ $120,000 │ $122,000*│ $119,500 │ -$2,500 (mkt)  │
├──────────────────┼──────────┼──────────┼──────────┼────────────────┤
│ Net Worth        │ $185,000 │ $188,500 │ $184,556 │                │
└─────────────────────────────────────────────────────────────────────┘
* Includes expected market growth - shortfall may be market, not behavior

┌─── Behavior Check ──────────────────────────────────────────────────┐
│ Did you invest what you planned?                                    │
│ Expected contribution: $1,500  │  Actual: $1,500  │  ✓ On track    │
└─────────────────────────────────────────────────────────────────────┘

[Update Balances]
```

#### 4. Transactions (Optional Detail View)
- List of imported transactions
- Category assignment (click to assign to expense)
- Search/filter
- Reconciliation helper

#### 5. Import
- CSV upload
- Column mapping
- Auto-categorization rules setup
- Google Sheets link (future?)

---

## Spreadsheet View (Year at a Glance)

A dedicated view showing the full year month-by-month:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ 2026 Account Balances                                                    [Projected →] │
├──────────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┬──────────┤
│ Account      │ Jan    │ Feb    │ Mar    │ Apr    │ May    │ Jun    │ Jul... │ Dec      │
├──────────────┼────────┼────────┼────────┼────────┼────────┼────────┼────────┼──────────┤
│ Checking     │ $4,756 │ $4,890 │        │        │        │        │ (proj) │ $5,200   │
│ Emergency    │ $15.5k │ $16.0k │        │        │        │        │ (proj) │ $18,000  │
│ Brokerage    │ $44.8k │ $46.2k │        │        │        │        │ (proj) │ $52,000  │
│ 401k         │ $119.5k│ $122k  │        │        │        │        │ (proj) │ $140,000 │
├──────────────┼────────┼────────┼────────┼────────┼────────┼────────┼────────┼──────────┤
│ Net Worth    │ $184.5k│ $189k  │ (proj) │ (proj) │ (proj) │ (proj) │ (proj) │ $215,200 │
└──────────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┴──────────┘

Legend: [Actual] [Projected based on budget] [Original simulation estimate]
```

---

## Key Workflows

### Monthly Workflow (5-10 minutes)

1. **Import transactions** (or manually enter spending totals)
2. **Categorize** any unassigned transactions
3. **Enter account balances** from banking apps
4. **Review** budget vs actual, see insights
5. **See updated projection** for year-end

### Credit Card Statement Timing

To solve the "1 month delay" problem, offer two modes:
- **Transaction Date**: Use actual transaction dates (real-time but harder to reconcile)
- **Statement Date**: Use credit card statement dates (matches your current workflow)

Let user choose per account, or auto-detect based on import.

### Reconciliation Helper

When actual balance ≠ calculated balance:
```
┌─── Reconciliation ──────────────────────────────────────────────────┐
│ Checking account is off by -$46                                     │
│                                                                     │
│ Possible causes:                                                    │
│ • Missing transaction around Jan 15-20 (~$46)?                      │
│ • Pending transaction not yet posted?                               │
│ • Bank fee or interest?                                             │
│                                                                     │
│ [Add adjustment entry]  [Mark as reconciled anyway]  [Investigate]  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Integration with Simulation

### Expected Values Calculation

From the simulation's Year 1 results, we can derive expected monthly values:

```typescript
// Pseudocode
function getExpectedBalance(accountId: string, month: number): number {
  const startBalance = simulation.year0.accounts[accountId];
  const endBalance = simulation.year1.accounts[accountId];
  const monthlyChange = (endBalance - startBalance) / 12;
  return startBalance + (monthlyChange * month);
}

function getExpectedSpending(expenseId: string, month: number): number {
  const expense = expenses.find(e => e.id === expenseId);
  const annual = expense.getAnnualAmount();
  if (expense.frequency === 'annual') {
    // Annual expense: show 1/12 as monthly "budget"
    return annual / 12;
  }
  return expense.getMonthlyAmount();
}
```

### Projection Updates

When user enters actual data, we can show:
- "If you continue at this spending rate, year-end will be X instead of Y"
- "You're $500 ahead on savings - keep it up!"

---

## Open Questions

1. **Utilities Input**: You mentioned utilities change monthly and don't have CSV. Should we have a quick "enter this month's utilities" flow separate from CSV import?
  Yeah, or if the import ends up being a custome google sheet we could just add a field/tab for utilities.

2. **Multiple Bank Accounts**: Do you have multiple checking/credit cards? Need multi-account CSV import?
  Yeah, I want it to support multiple credit cards.

3. **Category Granularity**: You mentioned wanting more granular categories but it being a headache. Should we:
   - Use existing Expenses as-is (coarse)

4. **Historical Data**: Do you want to import past months from your spreadsheet, or start fresh?
  - Maybe I'll seperately work on something it import my historic data, but I think we should focus on someone elses 

5. **Mobile**: Will you use this on mobile? Affects UI density choices.
  - Good question. I think we shouldn't expect this to be used on mobile. Maybe maybe viewing stuff if we have charts. But this should be designed as a desktop feature and if we find we can make minor tweaks to make viewing on mobile better later then we can do that later.
---

## Implementation Phases

### Phase 1: Core Structure
- BudgetContext and data model
- New Budget tab with sub-navigation
- Manual spending entry per category
- Manual account balance entry
- Basic budget vs actual view

### Phase 2: Visualization
- Spending trend charts
- Account balance spreadsheet view
- Goal progress indicators
- Year-end projection updates

### Phase 3: Import & Automation
- CSV import with column mapping
- Auto-categorization rules
- Reconciliation helper
- Transaction list view

### Phase 4: Polish
- Insights/suggestions
- Credit card statement date handling
- Historical data import
- Google Sheets integration (maybe)

---

## Feedback Needed

Does this capture what you're looking for? Specifically:

1. Is the sub-tab structure (Overview/Spending/Accounts/Transactions/Import) intuitive?
  yeah.
2. Is the "behavior vs market" separation for account tracking what you had in mind?
 - Yeah, I think so.
3. For the spreadsheet view - horizontal months or vertical months?
 - I think one row for each month and one column for each account/expense
4. Any features missing or over-engineered?
  - nothing coming to mind but I want to state that while we have a decent set of input field classes, some of the screens I am imagining may be better served by finding a good library for react spreadsheet/google sheets style inputs/fields. It's possible this screen is going to be too complex for all of the nice padding and detailing present on the other tabs. That being said I would prefer if it were at least using a similar color palette if nothing else.
