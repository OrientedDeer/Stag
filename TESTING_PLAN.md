# Testing Plan for Uncovered Code Sections

**Current Coverage:** 62.77%
**Target Coverage:** 85%+

## Executive Summary

Coverage analysis reveals that **Context providers** and **useFileManager** are completely untested (0% coverage), while core business logic files have gaps. This plan prioritizes testing state management, data persistence, and critical business logic.

---

## Priority 1: Context Providers (0% Coverage)

### AccountContext.tsx (0% → 80%+)
**Lines:** 15-226
**Complexity:** High - State management with localStorage persistence

**Test Cases Needed:**
- [ ] Reducer actions:
  - `ADD_ACCOUNT` - adds account to state
  - `DELETE_ACCOUNT` - removes account by id
  - `UPDATE_ACCOUNT_FIELD` - updates specific account fields
  - `REORDER_ACCOUNTS` - drag-and-drop reordering
  - `ADD_AMOUNT_SNAPSHOT` - adds historical amount entry
  - `UPDATE_HISTORY_ENTRY` - modifies existing history entry
  - `DELETE_HISTORY_ENTRY` - removes history entry
  - `ADD_HISTORY_ENTRY` - adds new history entry
  - `SET_BULK_DATA` - imports full account dataset
- [ ] localStorage integration:
  - Persists state changes to localStorage
  - Loads state from localStorage on initialization
  - Handles corrupted localStorage data gracefully
  - Handles missing localStorage data
- [ ] Schema versioning:
  - Migrates old schema to CURRENT_SCHEMA_VERSION

**Estimated Test File Size:** ~200-250 lines

---

### SimulationContext.tsx (0% → 80%+)
**Lines:** 13-84
**Complexity:** Medium - Simpler context with serialization logic

**Test Cases Needed:**
- [ ] Reducer actions:
  - `SET_SIMULATION` - updates simulation state
- [ ] Data reconstitution:
  - `reconstituteSimulationYear` properly reconstructs accounts/incomes/expenses
  - Filters out invalid objects (returns null from reconstitute functions)
- [ ] localStorage integration:
  - Saves simulation with className metadata
  - Loads and reconstitutes simulation from localStorage
  - Handles missing/corrupted data
- [ ] useEffect serialization:
  - Adds className to nested objects before saving

**Estimated Test File Size:** ~100-120 lines

---

### ExpenseContext.tsx (0% → 80%+)
**Lines:** 32-137
**Complexity:** Medium - Similar to AccountContext but simpler

**Test Cases Needed:**
- [ ] Reducer actions (mirror AccountContext pattern):
  - `ADD_EXPENSE`
  - `DELETE_EXPENSE`
  - `UPDATE_EXPENSE_FIELD`
  - `SET_BULK_DATA`
  - `REORDER_EXPENSES` (if applicable)
- [ ] localStorage persistence
- [ ] Data reconstitution on load

**Estimated Test File Size:** ~120-150 lines

---

### IncomeContext.tsx (0% → 80%+)
**Lines:** 25-122
**Complexity:** Medium

**Test Cases Needed:**
- [ ] Reducer actions (mirror AccountContext pattern):
  - `ADD_INCOME`
  - `DELETE_INCOME`
  - `UPDATE_INCOME_FIELD`
  - `SET_BULK_DATA`
  - `REORDER_INCOMES` (if applicable)
- [ ] localStorage persistence
- [ ] Data reconstitution on load

**Estimated Test File Size:** ~120-150 lines

---

### TaxContext.tsx (0% → 80%+)
**Lines:** 27-79
**Complexity:** Low-Medium

**Test Cases Needed:**
- [ ] Reducer actions:
  - `SET_BULK_DATA` - imports tax settings
  - `UPDATE_TAX_FIELD` (if exists)
- [ ] localStorage persistence
- [ ] Default state initialization

**Estimated Test File Size:** ~80-100 lines

---

## Priority 2: File Management (0% Coverage)

### useFileManager.ts (0% → 85%+)
**Lines:** 23-91
**Complexity:** High - Import/Export logic with data validation

**Test Cases Needed:**
- [ ] `handleGlobalExport`:
  - Creates FullBackup object with all contexts
  - Includes className metadata for all objects
  - Generates valid JSON blob
  - Creates download with correct filename format
- [ ] `handleGlobalImport`:
  - Parses valid JSON backup
  - Reconstitutes accounts/incomes/expenses correctly
  - Dispatches SET_BULK_DATA to all contexts
  - Merges assumptions with defaults (partial backups)
  - Resets assumptions when missing from backup
  - Handles corrupted JSON gracefully (error alert)
  - Handles missing fields in backup data

**Estimated Test File Size:** ~150-180 lines

---

## Priority 3: Partially Covered Business Logic

### SimulationEngine.tsx (53.52% → 85%+)
**Lines Missing:** 141-150, 170, 178, 186, 290-293, 306

**Test Cases Needed:**
- [ ] Line 141-150: Edge case in asset/debt calculations
- [ ] Line 170: Specific account type handling
- [ ] Line 178: Deficit handling logic
- [ ] Line 186: Investment return calculations
- [ ] Line 290-293: Final year summary calculations
- [ ] Line 306: Error handling or edge case

**Estimated Additional Tests:** ~40-60 lines

---

### TaxService.tsx (83.33% → 90%+)
**Lines Missing:** 112, 136, 276, 334, 355

**Test Cases Needed:**
- [ ] Line 112: Tax bracket edge case
- [ ] Line 136: Deduction calculation edge case
- [ ] Line 276: State tax calculation edge case
- [ ] Line 334: Capital gains calculation edge case
- [ ] Line 355: Alternative minimum tax (AMT) calculation

**Estimated Additional Tests:** ~30-40 lines

---

### AssumptionsContext.tsx (73.68% → 90%+)
**Lines Missing:** 100, 113, 127, 138, 149, 160

**Test Cases Needed:**
- [ ] Line 100: Specific reducer action branch
- [ ] Line 113: Field update validation
- [ ] Line 127: Assumption reset logic
- [ ] Line 138: Default value fallback
- [ ] Line 149: Invalid JSON handling (already has test but may need enhancement)
- [ ] Line 160: Schema migration

**Estimated Additional Tests:** ~40-50 lines

---

### Expense models.tsx (81.79% → 95%+)
**Lines Missing:** 632, 787, 799-804

**Test Cases Needed:**
- [ ] Line 632: Specific expense calculation method
- [ ] Line 787: Edge case in expense growth calculation
- [ ] Lines 799-804: Alternative expense model logic

**Estimated Additional Tests:** ~20-30 lines

---

### Income models.tsx (96.55% → 100%)
**Lines Missing:** 35, 107-109

**Test Cases Needed:**
- [ ] Line 35: Income reconstitution edge case
- [ ] Lines 107-109: Income growth calculation edge case

**Estimated Additional Tests:** ~10-15 lines

---

### Account models.tsx (98.24% → 100%)
**Lines Missing:** 66

**Test Cases Needed:**
- [ ] Line 66: Account reconstitution or calculation edge case

**Estimated Additional Tests:** ~5-10 lines

---

## Implementation Timeline

### Phase 1: Context Testing (High Impact)
1. AccountContext.tsx
2. ExpenseContext.tsx
3. IncomeContext.tsx
4. TaxContext.tsx
5. SimulationContext.tsx

**Outcome:** Coverage jumps from 62.77% to ~75%

### Phase 2: File Management
6. useFileManager.ts

**Outcome:** Coverage reaches ~78-80%

### Phase 3: Business Logic Gaps
7. SimulationEngine.tsx missing lines
8. TaxService.tsx missing lines
9. AssumptionsContext.tsx missing lines
10. Models.tsx files missing lines

**Outcome:** Coverage reaches 85%+

---

## Testing Patterns to Follow

### Context Testing Template
```typescript
describe('ContextName', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should initialize with default state', () => { ... });
  it('should load state from localStorage', () => { ... });
  it('should save state to localStorage on changes', () => { ... });
  it('should handle ADD action', () => { ... });
  it('should handle UPDATE action', () => { ... });
  it('should handle DELETE action', () => { ... });
  it('should handle corrupted localStorage', () => { ... });
});
```

### File Manager Testing Template
```typescript
describe('useFileManager', () => {
  it('should export complete backup', () => { ... });
  it('should import and dispatch to all contexts', () => { ... });
  it('should handle missing assumptions in backup', () => { ... });
  it('should show error alert on invalid JSON', () => { ... });
});
```

---

## Success Metrics

- **Coverage Target:** 85%+ overall
- **All Priority 1 files:** 80%+ individual coverage
- **All Priority 2 files:** 85%+ individual coverage
- **All Priority 3 files:** 90%+ individual coverage

**Total Estimated Test Code:** ~1,200-1,500 new lines across 11 test files
