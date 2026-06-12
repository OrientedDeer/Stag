# PR #58 Review — persistence, contexts, import/export, QR + cloud backup

Scope reviewed: `hooks/{usePersistedReducer,useDebouncedLocalStorage}.ts`,
`Accounts/{AccountContext,ImportKeyContext,useFileManager}.{ts,tsx}`,
`Budget/BudgetContext.tsx`, `Income/IncomeContext.tsx`, `Expense/ExpenseContext.tsx`,
`QRTransfer/qrUtils.ts`, `services/{CSVImportService,SSAImportService,backupMerge}.ts`,
`services/cloud/CloudBackupService.ts`.
Effort: xhigh (5+3+1 finder angles via sub-agents + verify + sweep). Reviewed
source ≈ `main`.

Status legend: ☐ open · ☑ fixed (test-backed) · ◇ cleanup (no failing test) · ⏸ deferred

## Resolution (2026-06-11)

Fixed test-first via 4 file-disjoint sub-agents + a reconciliation pass. Final
state: **3443 tests pass** (127 files); `tsc -b` clean; no new lint (only
pre-existing `react-refresh/only-export-components` + `no-explicit-any` in the
context files). All 12 correctness findings **and** cleanups #13–#15 fixed.

- **#1 ☑ / #4 ☑ / #6 ☑** `qrUtils` `flattenAssumptions`/`expandAssumptions`
  rebuilt to round-trip the real `AssumptionsState`: top-level `milestones` and
  the `withdrawalStrategy` **burn-order array** (flattened under a synthetic
  `burnOrder` key, distinct from the `investments.withdrawalStrategy` string),
  `demographics.priorEarnings`, and the 5 newer investments flags
  (`taxOptimizationEnabled`, `acaAware`, `rothConversion{Strategy,MinRateGap,DPBackloadDelta}`).
  Stopped emitting the phantom `withdrawalOrder`. New short keys added
  collision-checked; the 5 flags added to `ASSUMPTIONS_DEFAULTS` so they strip/restore.
- **#2 ☑** `projectedPIA` moved to a new unique short key `Pi`; `pp` now decodes
  unambiguously to `purchasePrice`, so ESPP lot cost basis survives QR import.
- **#3 ☑** `applyMapping` ids now `crypto.randomUUID()` (counter fallback) —
  unique within an import. Test: 500-row CSV → all ids distinct.
- **#5 ☑** `applyCategories` wraps `new RegExp` in try/catch (mirrors the
  reducer's `APPLY_CATEGORY_RULE` guard); an invalid saved rule no longer aborts
  the import.
- **#7 ☑** `useDebouncedLocalStorage` registers `pagehide` + `visibilitychange→hidden`
  listeners that flush the pending write synchronously; timer callback nulls the
  ref so the flush only writes when genuinely pending.
- **#8 ☑ / #12 ☑** `handleGlobalImport` now routes imported assumptions through
  `migrateAssumptions` (exported) instead of the bespoke spread — deep-merges
  every section incl. `display`. **Deeper bug found+fixed:** `migrateAssumptions`'
  legacy `birthYear→milestone` synthesis was **dead code** (it seeded `milestones`
  from `defaults.milestones`, so the `if (!existingIds.has(...))` guards never
  fired); now seeds `[]` when saved data lacks milestones, so legacy
  demographics actually populate Birth/Retire/End-of-Plan (fresh users still get
  identical built-ins — 44 AssumptionsContext tests still green).
- **#9 ☑** Budget date reconstitution extracted from `hydrateBudgetState` into
  exported `reconstituteBudgetState`; `handleGlobalImport` now dispatches it so
  imported transaction/month dates are real `Date`s (instant round-trip, no UTC
  date-only parsing).
- **#10 ☑** `BudgetContext.generateId` + inline `MOVE_TRANSACTION` minter +
  `backupMerge.generateMonthId` use `crypto.randomUUID()` (monotonic-counter
  fallback) — collision-free within a tick.
- **#11 ☑** `validateEarningsImport` now returns `valid: earnings.length > 0`
  (empty is the only hard block); benign warnings no longer flip `valid`. Two
  pre-existing tests that encoded the buggy `valid:false` were corrected.

New tests: `hooks/useDebouncedLocalStorage.test.tsx`,
`Budget/budgetImport.test.ts`, plus `PR #58 regressions` blocks in
`QRUtils.test.ts`, `CSVImportService.test.ts`, `SSAImportService.test.ts`,
`backupMerge.test.ts`, `useFileManager.test.tsx`. Eight pre-existing QR tests
that encoded the obsolete `withdrawalOrder` shape were corrected (marked
`PR #58: corrected`); no coverage deleted.

---

## Correctness findings

### 1. ☐ QR round-trip drops `milestones` → age timeline reset to defaults
`qrUtils.ts` `flattenAssumptions:222` / `expandAssumptions:250` predate the
milestone refactor. `milestones` (now the source of birthYear / retirementAge /
lifeExpectancy) is not special-cased in `flattenAssumptions`, so it's spread as
numeric-index keys (`flat['0']`, `flat['1']`, …); `expandAssumptions` never
re-emits it. A QR export→scan (`getBackupData()` carries the full live
assumptions → `createCompactBackup` → `compactAssumptions`) followed by
`handleGlobalImport` leaves `milestones = createBuiltinMilestones()` (birth 1990,
retire 65, life 90). **Every projected year is silently reset.** Fix: round-trip
the real top-level `milestones` array.

### 2. ☐ QR `pp` key collision corrupts ESPP lot `purchasePrice`
`qrUtils.ts` KEY_MAP maps **both** `purchasePrice` (ESPP lot, `:20`) and
`projectedPIA` (Social Security, `:36`) to short key `pp`. `REVERSE_KEY_MAP['pp']`
resolves to the last writer, `projectedPIA`, so `expandKeys` renames every lot's
`purchasePrice` → `projectedPIA` on import. `reconstituteAccount`
(`models.tsx:977`, `purchasePrice: Number(lot.purchasePrice) || 0`) then sees no
`purchasePrice` and sets it to **0**, destroying the lot's cost basis and all
ESPP gain/tax math. Fix: give `projectedPIA` a unique short key; keep `pp`
decoding to `purchasePrice` (legacy SS `projectedPIA` is recomputed, so losing
its legacy decode is harmless).

### 3. ☐ CSV import mints colliding transaction ids
`CSVImportService.ts:648`: `TXN-${Date.now()}-${Math.floor(Math.random()*10000)}`
runs inside a synchronous loop, so `Date.now()` is constant and only a 4-digit
random varies — ~99% collision probability for a ~300-row CSV. `BudgetContext`
`DELETE_TRANSACTION` (`filter(t => t.id !== id)`) and `UPDATE_TRANSACTION`
(`t.id === id`) act on **every** colliding twin, and React list keys collide.
Fix: per-import counter or `crypto.randomUUID()`.

### 4. ☐ QR round-trip drops the burn order (top-level `withdrawalStrategy` array)
`qrUtils.ts` `flattenAssumptions:226` special-cases a key named `withdrawalOrder`
that **does not exist** in `AssumptionsState`; the real burn order is the
top-level `withdrawalStrategy: WithdrawalBucket[]`, which falls into the object
branch and is lost. `expandAssumptions:288` re-emits the phantom `withdrawalOrder`
(nothing reads it). After import `withdrawalStrategy = []` (default), so
`SimulationEngine.tsx:384` (`assumptions.withdrawalStrategy.map(...)`) runs on an
empty array — the user's manual withdrawal order is silently reset. Fix:
flatten/expand the top-level `withdrawalStrategy` array under a distinct key from
the `investments.withdrawalStrategy` **string**.

### 5. ☐ One invalid saved regex rule crashes the whole CSV import
`CSVImportService.ts:822` (`applyCategories`) builds `new RegExp(rule.pattern, 'i')`
with **no** try/catch, unlike the guarded `BudgetContext` `APPLY_CATEGORY_RULE`
(`:329`). A saved category rule with an invalid pattern (`(`, `[a-`) throws
`SyntaxError` inside `.map`, aborting the entire import pipeline
(`useCSVImportFlow.ts:69,153`). Fix: wrap the regex build/test in try/catch
returning `false` (mirror the reducer).

### 6. ☐ QR round-trip drops `priorEarnings` and newer investments flags
`qrUtils.ts` `expandAssumptions:250` hardcodes a stale subset, dropping
`demographics.priorEarnings` (imported SSA earnings) and
`investments.{taxOptimizationEnabled,acaAware,rothConversionStrategy,rothConversionMinRateGap,rothConversionDPBackloadDelta}`.
These ride into the compact payload but are never restored, so import falls back
to defaults: SS PIA projection loses earnings history; Tax-Optimization / ACA /
Roth-strategy revert, silently changing the simulation. Fix: restore them in
`expandAssumptions` (or replace the bespoke allow-list with a generic
shorten/expand keyed off `defaultAssumptions`).

### 7. ☐ Debounced write lost on hard reload / tab close within 500ms
`useDebouncedLocalStorage.ts:36` schedules the write 500ms out; the unmount-flush
effect (`:52`) does **not** run on a real browser navigation/unload, and there is
no `beforeunload`/`pagehide` handler. Edit-then-reload (or close) inside the
window loses the change — most acute right after `handleGlobalImport`, where
users commonly reload to "make it take." Fix: flush synchronously on `pagehide`
(and/or `visibilitychange → hidden`).

### 8. ☐ Importing a legacy (pre-milestones) backup resets the age timeline
`useFileManager.ts:90` `handleGlobalImport` merges assumptions inline but never
runs the `birthYear/retirementAge/lifeExpectancy → milestone` migration that
`migrateAssumptions` performs on the localStorage path. Importing an older JSON
backup (demographics.birthYear, no `milestones`) takes `milestones` from
`...defaultAssumptions` (built-ins, birth 1990) and ignores the legacy birth
year. Fix: route imported assumptions through `migrateAssumptions` (single source
of truth) instead of the bespoke spread.

### 9. ☐ Budget import leaves transaction/month dates as strings
`useFileManager.ts:115` dispatches `budget` SET_BULK_DATA with the raw
`JSON.parse`'d payload, so `transactions[].date` / `createdAt` / `updatedAt` /
`statementDate` stay **strings** (typed `Date`); it bypasses `hydrateBudgetState`
(localStorage-only) and no reload follows (`window.location.reload` is commented
out, `:124`). The live post-import session holds string dates where `Date` is
expected — consumers that don't defensively wrap in `new Date(...)` mis-render
until a hard reload. Fix: reconstitute budget dates in the import payload (reuse
`hydrateBudgetState`'s date mapping).

### 10. ☐ MONTH-id collision when several months are created in one tick
`BudgetContext.tsx:29` `generateId('MONTH')` = `MONTH-${Date.now()}-${rand(1000)}`
(and `backupMerge.ts:138` `generateMonthId`). A CSV import spanning multiple new
months runs `getOrCreateMonth` several times in one synchronous tick; with
~1/1000 per pair two distinct months get the same id, and every id-keyed action
(UPDATE_MONTH, ADD/UPDATE/DELETE_TRANSACTION, UPDATE_SPENDING) then hits both.
Fix: monotonic counter / `crypto.randomUUID()` in both id minters.

### 11. ☐ `validateEarningsImport` blocks on benign warnings
`SSAImportService.ts:143` returns `valid: warnings.length === 0`, so a benign
"Found N future year(s) which will be ignored" warning (common — SSA exports list
the current partial year) flips `valid` to false, contradicting the documented
"doesn't block import" contract. Latent today (the caller checks `warnings.length`)
but wrong-by-contract. Fix: base `valid` only on truly blocking conditions
(e.g. `earnings.length === 0`).

### 12. ☐ `handleGlobalImport` doesn't deep-merge `display` (and arrays) with defaults
`useFileManager.ts:91`: macro/income/expenses/investments/demographics are
deep-merged with `defaultAssumptions`, but `display` is replaced wholesale by
`...data.assumptions`, so a backup predating a newer display field (e.g.
`hsaEligible`) leaves it `undefined` instead of defaulted. Subsumed by the
finding #8 fix (route through `migrateAssumptions`, which deep-merges every
section). Listed separately for completeness.

---

## Cleanup / lower-priority

- **13. ☑** `qrUtils.stripDefaults` now compares empty default **arrays**
  structurally, so `conversionHistory: []` / `lots: []` strip (and re-add via
  `restoreDefaults`) instead of bloating the payload. The intentional, tested
  null-stripping is retained. Test corrected: empty default array now strips +
  round-trips.
- **14. ☑** `AccountContext.exportData` now calls `URL.revokeObjectURL(url)` after
  `a.click()`, matching `useFileManager.handleGlobalExport`.
- **15. ☑** `compressData` builds the binary string in 32 KB chunks before
  `btoa`, avoiding the `String.fromCharCode(...bytes)` spread `RangeError` on
  large payloads. Regression test: a 379 KB deflated payload (proven to throw on
  the old spread) now compresses and round-trips.

---

## Refuted / by-design (checked, not bugs)

- **No crash importing a backup missing `withdrawalStrategy`/`milestones`.**
  `...defaultAssumptions` backfills both before `...data.assumptions` spreads, so
  `SimulationEngine.tsx:384`'s `.map` and `getBirthYear().find` never see
  undefined — the real failure is silent data **reset** (#1/#4/#8), not a crash.
- **`applyBalances` multi-target split setting a zero-weight account to 0 is
  by-design.** A 0-balance account inside a weighted split (e.g. a 401k pre-tax /
  Roth / employer split) correctly receives its proportional share of 0; it is not
  "wiping a standalone account" (a standalone account wouldn't be in the map).
- **`detectDuplicates` date comparison is consistent in-app.** Hydrated and
  freshly-parsed transaction dates are both local-instant `Date` objects that
  round-trip through `toISOString`/`new Date`, so `toDateString()` agrees; no
  UTC off-by-one on the in-app path.
- **`useDebouncedLocalStorage` unmount flush ordering is correct** — effect-A
  cleanup clears the timer, effect-B cleanup writes the latest value via refs.
