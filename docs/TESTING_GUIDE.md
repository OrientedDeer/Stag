# Testing Guide - New Features

Use this checklist to review recent features. Add notes in the "Notes" sections as you test.

---

## 1. Dashboard Enhancements

### 1.1 Summary Metric Cards (2x2 grid)
- [ ] Gross Income displays correctly (annual)
- [ ] Total Taxes displays correctly (annual)
- [ ] Savings Rate calculates correctly (% of gross income)
- [ ] Expenses displays correctly (monthly)
- [ ] Colors are appropriate (green=income, red=taxes, blue=savings, orange=expenses)
- [ ] Cards only show when setup is complete (has income, expenses, accounts)

**Notes:**
```


```

### 1.2 Expense Breakdown Pie Chart
- [ ] Pie chart displays when expenses exist
- [ ] Categories are correctly grouped (Housing, Food, Transportation, etc.)
- [ ] Percentages on chart are accurate
- [ ] Hover tooltips show category name and annual amount
- [ ] Legend shows top categories
- [ ] Colors are distinct and readable

**Notes:**
```


```

### 1.3 Dashboard Layout (7-column grid)
- [ ] Desktop: Numbers (2 col) | Expense (2 col) | NetWorth (3 col, full height)
- [ ] Desktop: Cashflow (4 col) spans under Numbers + Expense
- [ ] Mobile: Stacks correctly (Numbers → Expense → NetWorth → Cashflow)
- [ ] NetWorth appears before Cashflow on mobile
- [ ] No overlapping or layout breaks at different screen sizes

**Notes:**
```


```

### 1.4 NetWorth Card
- [ ] Displays current net worth correctly
- [ ] Historical chart renders (if history exists)
- [ ] Assets and liabilities breakdown is accurate
- [ ] Height is appropriate (not too tall)

**Notes:**
```


```

### 1.5 Cashflow Sankey Chart
- [ ] Shows income sources on left
- [ ] Shows tax breakdown correctly
- [ ] Shows expense categories on right
- [ ] Flows are proportional to amounts
- [ ] Hover shows correct values

**Notes:**
```


```

---

## 2. Monte Carlo Simulation

### 2.1 Configuration
- [ ] Number of simulations slider works
- [ ] Volatility/standard deviation inputs work
- [ ] Start/stop simulation controls work
- [ ] Configuration persists after page reload

**Notes:**
```


```

### 2.2 Results Display
- [ ] Fan chart shows percentile bands (10th, 25th, 50th, 75th, 90th)
- [ ] Success rate percentage displays
- [ ] Summary statistics are accurate
- [ ] Chart is readable and not cluttered

**Notes:**
```


```

### 2.3 Performance
- [ ] Simulation runs without freezing UI
- [ ] Progress indicator shows during calculation
- [ ] Results appear in reasonable time

**Notes:**
```


```

---

## 3. Scenario Comparison

### 3.1 Scenario Management
- [ ] Can create new scenario
- [ ] Can duplicate existing scenario
- [ ] Can rename scenario
- [ ] Can delete scenario
- [ ] Scenarios persist after reload

**Notes:**
```


```

### 3.2 Scenario Editing
- [ ] Can modify assumptions in a scenario
- [ ] Changes don't affect other scenarios
- [ ] Can switch between scenarios easily

**Notes:**
```


```

### 3.3 Comparison View
- [ ] Side-by-side comparison works
- [ ] Difference summary shows key differences
- [ ] Charts overlay correctly (if applicable)

**Notes:**
```


```

---

## 4. Withdrawal Strategies

### 4.1 Strategy Selection
- [ ] Can select different withdrawal strategies
- [ ] Options include: Fixed, Percentage, Guardrails, etc.
- [ ] Selection persists after reload

**Notes:**
```


```

### 4.2 Strategy Configuration
- [ ] Can configure strategy parameters
- [ ] Withdrawal order/priority works
- [ ] Tax-efficient withdrawal options work

**Notes:**
```


```

### 4.3 Impact on Projections
- [ ] Projections update when strategy changes
- [ ] Account balances reflect withdrawals correctly
- [ ] Tax implications are calculated

**Notes:**
```


```

---

## 5. Sidebar Navigation

### 5.1 Dropdown Behavior
- [ ] Clicking "Current" toggles dropdown only (doesn't navigate)
- [ ] Clicking "Future" toggles dropdown only (doesn't navigate)
- [ ] Sub-links navigate correctly
- [ ] Active state highlights current page

**Notes:**
```


```

---

## 6. Data Export

### 6.1 Export Formats
- [ ] JSON export works
- [ ] CSV export works
- [ ] Excel export works
- [ ] Exported data is accurate

**Notes:**
```


```

---

## 7. Responsive Design

### 7.1 Mobile View
- [ ] Dashboard stacks correctly
- [ ] Charts are readable on small screens
- [ ] Navigation works on mobile
- [ ] No horizontal scroll issues

**Notes:**
```


```

### 7.2 Tablet View
- [ ] Layout adapts appropriately
- [ ] Charts scale properly

**Notes:**
```


```

---

## 8. General Issues Found

### High Priority
```


```

### Medium Priority
```


```

### Low Priority / Nice to Have
```


```

---

## Summary

**Date Tested:** _______________

**Overall Status:** [ ] Ready for release  [ ] Needs fixes  [ ] Major issues

**Key Blockers:**
```


```

**Next Steps:**
```


```
