# Dead Code Cleanup — Knip Findings

Generated from `npm run knip:prod` (production-mode Knip — ignores test files as legitimate callers, so test-only code surfaces here as dead).

Re-run anytime: `npm run knip` (default — keeps tests as callers) or `npm run knip:prod`.

Each item below is a candidate, not a confirmed deletion. Always verify before removing — Knip can miss dynamic imports, lazy-loaded routes, default-export aliasing, etc.

---

## Cleanup pass — completed

### `src/services/simulation/TaxOptimizedWithdrawal.ts`
- ~~`calculateTargetTraditionalBalance` — dead. Removed.~~ ✅
- ~~`TargetBalanceResult` — dead alongside above. Removed.~~ ✅
- ~~`calculateConversionThisYear` — cascade dead. Removed.~~ ✅
- ~~`RMD_DIVISORS` — internal-only. Dropped `export`.~~ ✅

### `src/services/simulation/WithdrawalPlanner.ts`
- ~~`classifyAccount` — internal-only. Dropped `export`.~~ ✅
- ~~`hasEarlyWithdrawalPenalty` — internal-only. Dropped `export`.~~ ✅
- ~~`planRMDWithdrawal` — RMD planning was inlined into `YearSolver.ts:1148`. Removed.~~ ✅

### `src/services/simulation/IncomeClassifier.ts`
- ~~`getTotalPensionIncome`, `getTotalEarnedIncome`, `getTotalWageIncome` — all dead. Removed.~~ ✅

### `src/services/simulation/SurplusAllocator.ts`
- ~~`getDefaultSurplusSettings` — dead. Removed.~~ ✅

### `src/services/HistoricalBacktest.ts`
- ~~`findSafeWithdrawalRate` — dead. Removed.~~ ✅

### `src/components/Objects/Taxes/TaxService.tsx`
- ~~`SALT_CAP`, `SALT_CAP_MFS` — legacy constants superseded by `SALT_CAP_TCJA_*` / `SALT_CAP_OBBBA_*`. Removed.~~ ✅
- ~~`calculateNIIT` — NIIT is computed inline at TaxService.tsx:526. Removed.~~ ✅

### `src/components/Objects/Budget/budgetUtils.ts`
- ~~`getCurrentlyActiveExpenses`, `generateMonthId`, `formatPercent`, `getStatusColor`, `getIncomeTransactions`, `getReimbursementTransactions` — all dead. Removed.~~ ✅

### `src/components/Objects/Accounts/QRTransfer/qrUtils.ts`
- ~~`MAX_QR_DATA_SIZE` — internal-only. Dropped `export`.~~ ✅
- `dateToDays`, `daysToDate`, `shortenKeys`, `expandKeys`, `stripDefaults` — kept exported; tests in `src/__tests__/services/QRUtils.test.ts` consume them directly. Legitimate test scaffolding.

### `src/data/HistoricalReturns.ts`
- ~~`SP500_RETURNS`, `BOND_RETURNS` — internal-only. Dropped `export`.~~ ✅
- ~~`getYearReturns` — internal-only. Dropped `export`.~~ ✅
- ~~`getReturnSequence`, `getRealReturn` — dead. Removed.~~ ✅

### `src/data/SocialSecurityData.tsx`
- ~~`WAGE_INDEX_FACTORS`, `BEND_POINTS`, `SS_WAGE_BASE`, `FRA_BY_BIRTH_YEAR`, `EARNINGS_TEST_LIMITS` — all internal-only. Dropped `export`.~~ ✅

### `src/data/PensionData.tsx`
- ~~`FERS_MRA_BY_BIRTH_YEAR` — internal-only. Dropped `export`.~~ ✅

### `src/data/ContributionLimits.ts`
- ~~`CONTRIBUTION_LIMITS` — internal-only. Dropped `export`.~~ ✅

### `src/components/Objects/Accounts/models.tsx`
- ~~`BaseAccount` — abstract base extended only inside the same file. Dropped `export`.~~ ✅

### `src/components/Objects/Expense/models.tsx`
- ~~`SimpleExpense` — abstract base extended only inside the same file. Dropped `export`.~~ ✅

### `src/components/Objects/Assumptions/AssumptionsContext.tsx`
- ~~`DEFAULT_BIRTH_YEAR`, `DEFAULT_RETIREMENT_AGE`, `DEFAULT_LIFE_EXPECTANCY` — internal-only. Dropped `export`.~~ ✅

### `src/hooks/usePersistedReducer.ts`
- ~~`useContextValue`, `createClassSerializer` — dead. Removed (plus unused `useMemo` import).~~ ✅

### `src/services/TaxOptimizationService.ts`
- ~~`analyzeRMDTaxPressure`, `generateRMDPressureRecommendation` — internal-only. Dropped `export`.~~ ✅
- A pile of constants (`MIN_401K_GAP_FOR_RECOMMENDATION`, etc.) for the not-yet-reimplemented tax optimizer remain — kept as scaffolding per `TAX_OPTIMIZATION_SPEC.md`.

---

## Still pending — riskier candidates

### Unused files (production mode)
- ~~`src/App.css` — empty file. Removed.~~ ✅
- ~~`src/components/Layout/CollapsibleSection.tsx` — orphan. Removed.~~ ✅
- ~~`src/components/Layout/Icons/index.ts` — barrel; consumers import directly from `ChevronIcon`. Removed.~~ ✅
- ~~`src/components/Layout/InputFields/SegmentedInput.tsx` — orphan. Removed.~~ ✅
- ~~`src/components/Objects/Accounts/QRTransfer/index.ts` — barrel; consumers import directly. Removed.~~ ✅
- `infrastructure/lambda/index.mjs` — outside the Vite build entry. Likely deployed independently as AWS Lambda; leaving alone.

The remaining unused-files entries from `knip:prod` (`e2e/*`, `src/__tests__/integration/helpers/*`, `src/setupTests.ts`) are legitimate test scaffolding — should be filtered via `knip.json` if we want a cleaner report.

### Unused dependencies (`package.json`)
- `@nivo/core` — verify; per-chart packages may pull it transitively.
- `@nivo/pie` — no chart in the app uses pie. Likely safe to drop.
- `@rollup/rollup-linux-x64-gnu` — platform-specific build dep, possibly required on the deploy box. **Do not remove without testing the deploy.**
- `cloc` — line-counting CLI. Listed as a runtime dep; probably should be a devDep, or removed entirely.

### Unused devDependencies
- `@tailwindcss/postcss` — Tailwind v4 uses `@tailwindcss/vite` already. Verify.
- `@types/html2canvas` — html2canvas now ships its own types.
- `autoprefixer`, `postcss` — Tailwind v4 may not need explicit PostCSS pipeline. Verify.
- `lint-staged` — hooks may invoke it via husky's `prepare`; if no `.lintstagedrc` exists, drop.

---

## False-positive categories worth a `knip.json` filter

If we want a cleaner report next time, add a `knip.json` ignoring:
- `default` exports on tab/chart components imported by name elsewhere — Knip flags these as unused even when the file is imported (16+ occurrences).
- e2e and integration test helpers (`e2e/fixtures/test-data.ts`, `e2e/helpers/app-helpers.ts`, `src/__tests__/integration/helpers/*`) — intentional shared scaffolding.
- Domain types intentionally re-exported for downstream typing (`AssetStreamData`, `DebtStreamData`, etc.) — review case by case.

---

## Workflow

1. Pick one category at a time.
2. Open the file, verify zero callers via `grep -rn "<name>" src/`.
3. If Knip is right, delete the export and any tests pinned to it.
4. Re-run `npm run knip:prod` and `npm run test:ci` to confirm nothing broke.
5. Commit.
