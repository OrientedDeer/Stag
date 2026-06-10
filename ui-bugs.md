# Expense / Goal creation flow — bug list

Found while exercising **Add Expense / goal** on the Dashboard + Budget.
Primary files: `AddExpenseModal.tsx`, `ExpenseCard.tsx`,
`Layout/InputFields/TriggerSelector.tsx`, `Budget/budgetUtils.ts`,
`Expense/models.tsx`.

## Systemic audit (shared components — these aren't Expense-only)
- **#3 toggle submits the form — FIXED.** `Layout/InputFields/ToggleInput.tsx`'s
  `<button>` had no `type`, so it defaulted to `type="submit"`; inside every
  modal's `<form onSubmit>` *any* toggle saved/closed the modal. Added
  `type="button"`. Blast radius: AddAccountModal, AddExpenseModal, ExpenseCard,
  AccountCard, and the WorkIncome/FERS/CSRS/ESPP field groups. (Tooltip &
  TriggerSelector buttons already set a type — ToggleInput was the only offender.)
- **#2 date/milestone keyboard race — shared.** `TriggerSelector.tsx` is used by
  AddIncomeModal, AddExpenseModal, IncomeCard, ExpenseCard → one fix covers all 4.
- **#1 UTC date display off-by-one — shared pattern.** `Date.UTC(year, 0, 1)`
  defaults appear in AddExpenseModal (start) and AddIncomeModal (pension start);
  rendered via local accessors they show as Dec-31-prior in US timezones. Part of
  the repo's unresolved date/UTC convention.

## Confirmed — root cause located

1. **Start date defaults to 12-31-2025 instead of today.**
   `AddExpenseModal.tsx:147` defaults `startDate` to
   `new Date(Date.UTC(currentYear, 0, 1))` = Jan 1 this year, which renders in a
   US (negative-UTC) timezone as **Dec 31 of the prior year**. Two issues:
   (a) the default should be **today**, not Jan-1; (b) UTC-midnight date shown
   via local accessors → off-by-one. Ties into the repo's open date/UTC
   convention question (main tip: "date convention UNRESOLVED").

8. **End date defaults to ~2081 instead of ~1 year out.**
   Default end date comes from a life-expectancy milestone
   (`getDefaultDate` → `new Date(birthYear + ageCond.value, 0, 1)`,
   `AddExpenseModal.tsx:38-40`). For a one-time / short goal it should default to
   **~1 year from today**, not end-of-plan.

## Likely — file identified, needs the exact line

2. **End-date calendar: typing a 2-digit year jumps to milestone selection.**
   `TriggerSelector.tsx` (the date-or-milestone input). After ~2 keystrokes the
   selection flips to a milestone instead of letting you finish typing `2026`.
   Keyboard/`onChange` handling races the milestone dropdown.

3. **Toggling "Discretionary" (with a name entered) closes the modal as if Saved.
   — FIXED (systemic).** `ToggleInput.tsx` button lacked `type="button"` → it
   defaulted to submit inside the modal `<form>`. Affected every toggle in every
   modal/card, not just discretionary. See systemic audit above.

## Model / UX design

4. **Post-creation "frequency" toggle is confusing for a one-time goal.**
   `ExpenseCard.tsx` shows a Monthly/… frequency toggle even for a one-time
   "save $10k by date" goal. Frequency shouldn't apply to a target-date goal
   (hide or lock it).

5. **Can't see or change the expense "kind" after creation.**
   No UI to view/switch `goalType` (recurring ↔ save-by-date ↔ plain expense) on
   `ExpenseCard`. You're locked into whatever was picked at creation.

## Budget / data integrity — needs repro + trace

6. **Phantom fund: a fund showed in Budget but not in the accounts list.**
   A goal links/creates a fund account (`goalAccountId`). It appeared in Budget
   but not in the accounts list → creation/listing inconsistency. Trace
   goal→fund-account creation + which list each view reads.

7. **(Unconfirmed) Budget annual goal amount may be wrong.**
   A ~1.5-year goal seemed to fund ~$5k/yr. `budgetUtils.ts:34-46`: sinkingFund
   → amount/12 monthly; long-term goals return 0 (funded via savings). Possible
   mismatch between the goal horizon and the per-year set-aside — or user error.
   Need a concrete repro: goal amount, horizon, observed vs expected.

## Simulation

9. **Goal doesn't appear in the Future cashflow charts at all.**
   Not as a monthly set-aside, not as a lump in ~1.5 yrs. Goals return 0 from
   `getAnnualAmount` (funded via a savings priority + fund account); if that
   wiring isn't created, the goal is invisible to the projection. Related to #6
   (the fund) and how goals feed the sim.

## Likely shared roots
- **#1, #8 (and maybe #2)** → date defaults + the unresolved UTC convention.
- **#6, #9** → goal ↔ fund-account wiring (created? listed? fed to sim?).
- **#4, #5** → the goal-"kind" model isn't surfaced/editable in the UI.

---

## Progress / resolution

Fixed & committed:
- **#3** ToggleInput `type="button"` (systemic across all modal toggles) — `419e0c1`
- **#2** TriggerSelector mid-typing → Milestone flip (Income + Expense) — `b79fdd2`
- **#1** start date → today (local) — `305dc87`
- **#8** "Save by date" goal target → ~1yr (was End-of-Plan ~2080) — `305dc87`
- **#4 / #5** ExpenseCard: hide frequency for goals; show goal kind read-only — `4f4e0a5`

Re-test (believed resolved as symptoms of the root fixes):
- **#7** `getGoalMonthlySetAside` math is correct (`amount/months`). The tiny/odd
  per-year figure was the target defaulting to ~2080 → fixed by #8. Not a bug.
- **#9** a goal targeted at ~2080 has a ~$15/mo set-aside and a lump 55 yrs out →
  invisible near-term. With #8 (target ~1yr) the set-aside + lump are near-term;
  the sim already handles goals (SimulationEngine.tsx:339, 529-533). Re-test.
- **#6** no code hides a goal-fund `SavedAccount` from AccountTab (it groups by
  `instanceof`, fund is a SavedAccount → Cash category). Likely a partial
  creation from #3 (toggle submitting mid-setup). Re-test; need a repro if it
  recurs.

Modal sweep (Account/Income) — same lens applied:
- **AddAccountModal** — date params use `new Date()` (today); no Jan-1 default
  bug. Toggles fixed by #3; date inputs fixed by #2.
- **AddIncomeModal** — no Jan-1 `startDate` default bug. Pension start used
  `Date.UTC(retirementYear,0,1)` (Dec-31-prior display) → changed to local. FERS
  & CSRS. Toggles/date inputs covered by #3/#2.
- **AddESPPLotModal (follow-up)** — uses `new Date(grantDate)`/`new Date(purchaseDate)`
  on `YYYY-MM-DD` strings (UTC-parse off-by-one footgun) at lines ~52-53, 87-88.
  Niche; not fixed yet.

Known remaining gap (not a quick fix — needs a goal-feature pass):
- **Goal edits don't re-sync the funding priority.** The linked savings-priority
  `capValue` (monthly set-aside) is computed once at creation
  (`getGoalMonthlySetAside`) and stored in assumptions. Editing the goal's
  amount/interval/target later does NOT update it, so funding goes stale. This
  underlies real #5 editability and any future #7 drift. Also: full kind-switch
  (recurring ↔ save-by-date) needs to re-wire the fund/priority.
