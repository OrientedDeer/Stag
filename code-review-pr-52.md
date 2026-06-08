# Code Review — PR #52 — Outstanding Items

All 14 findings are resolved: #1–#6, #8, #10, #11, #13 were fixed and landed on
`main` (commit `27aebee`, full suite green / 3312 passing); #7, #9, #12 (date) and
#14 (surplus) were investigated and **withdrawn as not real bugs** (`parseDate`
stores local-midnight dates, so the original local accessors were correct; the
no-brokerage savings fallback intentionally parks surplus in savings). The full
write-up — all findings, the re-audit, and the date reversal — is in this file's
git history. Open items below.

---

## #8 — costBasis underwater-basis fix is only partial
**File:** `src/components/Objects/Accounts/models.tsx`

The committed fix removed the clamp in `reconstituteAccount`, so a *loaded*
account's `costBasis` may correctly exceed its current value (a valid underwater
position). But a separate per-step clamp during simulation —
`finalCostBasis = Math.max(0, Math.min(preGrowthCostBasis, grownTotal))`
(line 375) — still re-caps basis to current value on every `increment`, so the
underwater basis is **not** preserved once the simulation runs.

It's harmless (every gain consumer floors at 0, so no negative-gain leak) and
low-impact, but the fix is incomplete. **To do:** decide whether to extend the
same allowance into the increment path, or accept the limitation (basis correct
at load/display, re-capped during projection).

## Test-coverage gap — #4, #10, #11 have no dedicated regression test
#1, #2, #6 ship with regression tests that fail-without / pass-with the fix.
The three core-engine fixes below are only covered **indirectly** by the existing
suite, so a future refactor could silently regress them. Worth adding targeted
tests:
- **#4** ACA-cliff MAGI includes LTCG (`helpers.ts`)
- **#10** RMD reserved against the Traditional snapshot (`YearSolver.ts`)
- **#11** gross-up search bound widens for combined rates > ~67% (`WithdrawalPlanner.ts`)

## Date-only / timezone convention — UNRESOLVED, deferred to the next review

Date-only values are created with TWO conventions: `parseDate` (modelUtils.ts)
builds **local**-midnight dates, while many call sites build **UTC**-midnight
dates via `Date.UTC()` (form defaults in `AddExpenseModal`/`incomeFormTypes`,
pension + SS dates in `IncomeProjection`, ESPP in `AccountGrowth`). The reader
functions are correspondingly inconsistent (some `getUTC*`, some local), and the
"`parseDate` returns UTC" comments are stale.

Empirically (verified by running both constructions under a fixed TZ): in
US/negative-offset zones `getUTC*` reads **both** constructions correctly while
local breaks the `Date.UTC`-built ones; positive-offset zones flip and neither
accessor is universally correct. The real fix is to unify **creation and reads**
on one convention.

> Correction: an earlier draft of this note (and `pr-50.md` #2) said "standardize
> on local accessors" — that is **wrong**; in this app's timezone `getUTC*` is the
> safe read. Direction deliberately left open for the next (ultra) review to
> decide, since it spans creation sites + readers + parseDate + the stale tests.
