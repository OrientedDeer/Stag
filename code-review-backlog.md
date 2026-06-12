# Code-review backlog — deferred items from campaigns 1–7

Carried-over work recorded across `code-review-pr*.md`, re-verified against
`main` @ 84e82cf (2026-06-11). Each item lists: source, current state (checked,
not assumed), and a fix plan. Statuses: ☐ open · ☑ done (verified) · ✗ dropped.

Ground rules for working these: behavioral items get a red test first;
refactors get characterization tests verified green against the original code;
perf items get a measurement before and after (Monte Carlo path: N years ×
M trials). Don't loosen existing assertions without sign-off.

---

## A. Behavioral

### A1. ☑ (2026-06-12) DataTab shows MortgageExpense as payment×12, Sankey uses amortization
Source: PR #59 #4 follow-up note. Verified: DataTab (and its CSV export) now
pass `year.year` for all expenses, which fixed LoanExpense, but
`MortgageExpense.getAnnualAmount(year)` is the base date-prorated payment×12 —
the Sankey/engine path special-cases mortgages through
`calculateAnnualAmortization`, so table and chart can still disagree on
mortgage rows (e.g. payoff year, PMI drop-off year).
**Plan:** decide the single source of truth — fold the amortization-aware
annual amount into `MortgageExpense.getAnnualAmount(year)` itself (the deeper
fix, mirrors what PR #57 #2 did for LoanExpense) rather than teaching DataTab
the special case. Red test in `DataTab.test.tsx` mirroring the existing
LoanExpense payoff-year test, plus a model test on the mortgage payoff year.
Risk: callers that already apply the special case (Sankey/CashflowDetailBuilder)
must not double-apply — grep all `MortgageExpense` special-casing first.

### A2. ☑ (2026-06-12, cheap option) Tax parameters never deflate below the data range (pr55 #4, deferred)
Source: `code-review-pr55.md` #4 ("Plausible · Low", deferred as out of
scope/risky). Verified still true: `parameters.ts` inflates only when
`year > max_year`; `year=2019, inflationAdjusted=true` snaps to the 2024
table verbatim, understating historical tax.
**Plan (two options, pick one):**
- Cheap: document the inflate-up/never-deflate asymmetry in a comment +
  assert/clamp in one place, since the app is a forward-only projector.
- Full: symmetric deflation for `year < min(sourceData years)` using the same
  `Math.pow(1+inflation, yearDelta)` with negative delta; red test at 2019.
Recommendation: cheap option unless back-testing becomes a feature; the
campaign already judged the full fix risky for no current user value.

### A3. ☑ (2026-06-12, resolved as cleanup) `WorkIncome.increment` ESPP `PERCENTAGE` branch is a no-op (pr57 #13)
Source: `code-review-pr57.md` cleanup #13. Verified still present
(`Income/models.tsx` ~231: `newESPPAmount = this.esppContributionAmount;` —
assigns the value it already holds).
**Plan:** research intent BEFORE touching — if `esppContributionAmount` holds a
*percentage* for `PERCENTAGE` type, the no-op is semantically correct (the
percent shouldn't grow; the dollar amount derives from salary at consumption
time) and the fix is to delete the dead branch and keep the comment. If it
holds *dollars*, this is a real bug (percentage-based contributions stop
tracking salary growth) and needs a red test. Check every consumer of
`esppContributionAmount` + `esppContributionType` (AccountGrowth ESPP lot
purchases, IncomeProjection) to determine the unit, then act accordingly.

---

## B. Performance (measure first; matters at years × Monte Carlo trials)

### B1. ☐ `getTaxParameters` has no memoization (pr55 #9, second half)
Source: `code-review-pr55.md` #9 — reducer extraction landed (`73248f5`),
memoization deferred. Verified: no cache in `taxService/parameters.ts`; one
`calculateFederalTaxFromIncomes` triggers 2–3 parameter resolutions for the
same (year, status), each potentially an O(years) nearest-year scan, and the
solver calls tax functions inside convergence loops.
**Plan:** module-level `Map` keyed by
`(year, filingStatus, authority, state, inflationAdjusted, inflationRate)` —
the inflation inputs MUST be in the key or scenario comparisons with different
assumptions will cross-contaminate. Bound the cache (or clear per simulation
run). Characterization test: identical results with/without cache across the
existing pr55 parameter tests; benchmark a Monte Carlo run before/after.

### B2. ☐ SimulationEngine per-year hot-path scans (pr57 #14)
Source: `code-review-pr57.md` cleanup #14. Verified still present in
`SimulationEngine.tsx`: `accounts.find(...)` per withdrawal/conversion
(:48, :89-90, :580-581), `goalFundIds` Set rebuilt each year (:368),
`getBirthYear(assumptions.milestones)` milestone scan per year (:168).
(PR #59 #11's `activeFundedGoals` helper improved the goal loops but the
per-year Set rebuild remains.)
**Plan:** hoist `birthYear` out of the year loop; build a
`Map<accountId, account>` once per year (account identities change via
`increment()`, so per-year, not per-run); derive `goalFundIds` from the
already-computed `fundedGoals`. Pure refactor — full suite + a before/after
timing of a 1000-trial Monte Carlo to confirm it's worth keeping.

---

## C. Code-quality cleanups (mechanical, characterization-tested)

### C1. ☑ (2026-06-12) `reconstitute{Account,Income,Expense}` hand-roll base fields (pr57 #10)
Verified: `modelUtils.extractBaseFields()` exists and is tested, but
`Accounts/models.tsx:935`, `Income/models.tsx:~913`, `Expense/models.tsx:~1121`
still do `String(data.id ?? '')` etc. inline.
**Plan:** swap each to `extractBaseFields(data, '<default name>')`. Watch the
per-domain default names ("Unnamed Account" vs "Unnamed") — preserve exact
current defaults; QR/backup round-trip tests are the oracle.

### C2. ☑ (2026-06-12) MortgageExpense amortization formula duplicated (pr57 #11, half done)
Was 5 copies; verified now 2 copies of the `Math.pow(1 + monthlyRate, ...)`
payment formula plus a straight-line 0%-APR fallback, with
`calculatePrincipalAndInterest()` (:348) as the intended single home.
**Plan:** route the remaining inline copies through
`calculatePrincipalAndInterest()`; keep the 0%-APR guard in exactly one place.
Combines naturally with A1 (same class, same tests).

### C3. ☑ (2026-06-12) Expense/Income active-multiplier duplicates (pr57 #12)
Verified: `getExpenseActiveMultiplier` (`Expense/models.tsx:834`) and
`getIncomeActiveMultiplier` (`Income/models.tsx:814`) remain line-for-line
parallel implementations.
**Plan:** extract one shared window-multiplier helper in `modelUtils.ts`
taking `{startDate?, endDate?}`; both wrappers delegate. CRITICAL: this code
embeds the local-date convention (PR #57 #1) — run the suite under
`TZ=America/New_York` and `TZ=Australia/Sydney` after, like the campaign did.

---

## D. Housekeeping

### D1. ☐ husky pre-commit hook is inert
`.husky/pre-commit` is not executable, so git skips it on every commit
(warning visible on each commit). `chmod +x .husky/pre-commit` re-enables it —
but first read the hook and confirm we *want* it running (it may be why lint
debt accumulated; enabling a strict hook on a red-lint repo could block
commits). Decide: enable, soften, or delete.

---

## Closed during this research (recorded so they don't get re-flagged)

- ☑ pr57 #15 `LoanExpense.getMonthlyAmount` — now delegates to
  `getAnnualAmount(year)/12` (landed with PR #57 #2 in campaign 7).
- ☑ pr-51 #3 Sankey RMD double-count — fixed in the pr-51 third batch
  (RMD = income convention; "All PR #51 findings are now closed").
- ✗ pr-51 #14 state-tax gross-up — explicitly won't-do per pr-51 doc.
- ✗ pr56 FRA/integer-vs-fractional notes — refuted in pr56 doc, never open.

## Suggested order

1. A3 (research may reveal a real bug — cheapest to triage first)
2. A1 + C2 together (same class, shared tests)
3. C1, C3 (mechanical, low risk)
4. B1, B2 (need benchmarks; do when perf is felt)
5. A2 cheap option + D1 (minutes each, decision needed on D1)
