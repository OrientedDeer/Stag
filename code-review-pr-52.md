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

## (Cross-reference) Date-only convention cleanup
The withdrawn date findings (#7/#9/#12) exposed a real *latent* issue that is not
in PR #52's changes: several pre-existing functions (`getExpenseActiveMultiplier`,
`getIncomeActiveMultiplier`, `isGoalDueInYear`, `getBalanceAtDate`) read
`parseDate`'s **local**-midnight dates with `getUTC*`, under comments wrongly
claiming `parseDate` returns UTC. Harmless for US-timezone users, but the
convention is backwards. This originated in PR #50 — see `code-review-pr-50.md`
#2 (standardize all date-only reads on local accessors).
