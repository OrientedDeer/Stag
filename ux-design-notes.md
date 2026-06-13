# UX / design notes — 2026-06-12

Grounded in two sources: the app's structure (sidebar IA, tab inventory) and
the observed friction from real use this week (the goal-feature saga: nine
modal bugs in one sitting, "how is it supposed to get funded?", "I didn't
realize it went into the allocation tab", set-aside vs total confusion).

The through-line: **the app computes the right things but doesn't explain
itself.** Most of this week's confusion wasn't bugs — it was the model being
invisible. Ranked by leverage:

---

## 1. Show the plan at creation time (high impact, low effort)

Creating a goal silently: derived a monthly set-aside, created a fund
account, and (formerly) added an allocation bucket. The user had to go
hunting across three tabs to discover what had happened.

- **AddExpenseModal goal mode: live plan preview.** As amount/target change,
  show: "Sets aside **$278/mo** (Jun 2026 → Jan 2029) into a new
  '<name> (fund)' account. The $10,000 is spent at the target date."
  One line, derived from `getGoalMonthlySetAside` — kills the entire class
  of "what did that just do?" confusion.
- **Receipts for cross-tab side effects** — see §1b; goals are one instance
  of an app-wide pattern.

## 1b. Receipts: a general mechanism, not a goal feature

Inventory of actions that today create/change/delete artifacts in OTHER tabs
with no notice (verified against the code, not hypothetical):

- Goal create/delete (Expenses) → fund SavedAccount appears/vanishes under
  Accounts; budget contribution row appears; sim funding starts.
- Financed Property account (Accounts) → auto-creates a MortgageExpense in
  Expenses **with invented defaults** (6.23% APR, 30-yr term, escrow/PMI
  figures — `AddAccountModal.tsx:133-140`). The user is never told these
  numbers were assumed; the receipt should explicitly prompt review:
  "Created mortgage expense (assumed 6.23% APR, 30 yr) — review it."
- Debt account (Accounts) → auto-creates a LoanExpense in Expenses.
- The REVERSE direction too (found by auditing every cross-context dispatch,
  2026-06-12): Mortgage expense (Expenses) → auto-creates a PropertyAccount;
  Loan expense → auto-creates a DebtAccount. Any inventory of these flows
  must be built by grepping cross-context dispatches
  (`accountDispatch|expenseDispatch|incomeDispatch|assumptionsDispatch` used
  outside their home domain), not by reading individual modals.
- Deletions get receipts too — but with NO navigation link (links are for
  "go see the new thing"; after a delete there's nothing to navigate to).
  The pre-delete dialog warns, the post-delete toast confirms.
- **HARD CONSTRAINT (user, 2026-06-12): expense numbers stay pure.** This is
  a FIRE-planning app; "expenses" feeds the 25× math and the FI milestone.
  401k/brokerage/HSA contributions must NEVER be folded into expense totals
  or expense-tab views — they'd inflate the number users eyeball for
  retirement readiness. Contributions stay on the income (paystub model);
  heaviness there is solved with collapsed CardSections (401k & Match /
  Benefits / ESPP / Pension, each with a paystub-style summary line), not by
  reclassifying outflows. (Goal set-asides are the deliberate exception —
  they're committed spending toward a purchase, not retirement savings.)
- **Field syncs do NOT toast** (mortgage valuation ↔ property value, loan
  amount/APR ↔ debt account). Receipts are for rare structural events; a
  toast per edit would cause fatigue and train users to dismiss all
  receipts. Ongoing relationships get a STATIC disclosure instead: a
  tooltip on every synced field ("Synced with the linked property account's
  value — editing this updates your net worth"), both directions. Rule of
  thumb: events → toast; relationships → label at the point of edit.
- Account delete → deletes the linked mortgage/loan expense (the confirm
  dialog does warn — the one place this pattern is already handled).
- **Milestone delete (Assumptions) → every income/expense trigger referencing
  it silently resets to "End of Plan"** (`TriggerSelector.tsx:66-70`). The
  worst offender: user data quietly changes meaning with zero feedback.
  Deserves more than a receipt — a pre-delete impact summary ("3 expenses
  and 1 income reference this milestone — they'll reset to End of Plan").
- Account delete with dangling refs: withdrawal-strategy buckets and
  allocation priorities keep referencing the deleted account (budget renders
  "(missing)"). Pre-delete impact summary + cleanup offer.
- 401k/ESPP payroll routing on a WorkIncome → changes budget payroll-routed
  rows and which accounts receive growth.
- Visiting Allocation auto-removes legacy goal buckets (the 2026-06
  migration) — correct, but silent.

Mechanism: one small `ReceiptToast` service (message + optional link +
dismiss) used by all of the above, and a shared "impact summary" block for
the two delete flows. The Alert/Message styles in CLAUDE.md already define
the visual language (info-blue for receipts, yellow for impact warnings).

## 2. Answer "where did this number come from?" (high impact, medium effort)

Every hard question this week was a provenance question. The sim already
has the data (`logs`, `cashflowDetail`, `bucketDetail`); it's just not
reachable from the numbers users see.

- Budget pacing rows: add a "why" affordance — "expected $1,950 by June =
  $278/mo × 7 active months (started June)". The pacing states
  (waiting/on-track/behind) are good; the arithmetic behind them is opaque.
- Future charts: clicking a Sankey/stream node should name its source
  objects ("Goals: Car $3,300" → the Car expense). Even a tooltip listing
  the contributing objects would do.
- Dashboard vs Budget vs Allocation "monthly expenses" intentionally differ
  (annualized average vs today's active). Keep the difference, **label it**:
  "avg/mo this year" vs "this month". Unlabeled, it reads as a bug.

## 3. Split inputs from outputs in Future (medium impact, medium effort)

"Future" currently mixes plan *inputs* (Assumptions, Allocation, Withdrawal)
with projection *outputs* (Charts → 9 subtabs). Two different activities:
configuring the plan vs reading the results.

- Sidebar IA suggestion: **Plan** (Assumptions, Allocation, Withdrawal) and
  **Projection** (Overview, Cashflow, Assets, Debt, Data) with the analysis
  tools grouped (Monte Carlo + Backtest = "Risk", Tax + Scenarios =
  "Strategy", Ratios folded into Overview or Data).
- Naming: the sidebar says "Allocation", the component is "PriorityTab", the
  page heading says "Priorities", and users say "the allocation tab". Pick
  one ("Allocation" is the most self-explanatory; "Your Priorities" describes
  the mechanism, not the purpose).
- Nine flat subtabs is past the comfortable limit; grouping above gets the
  default view to ~5.

## 4. The goal/expense creation flow deserves its own shape (medium/medium)

AddExpenseModal is a 675-line all-cadence form; the nine-bug cluster was a
symptom. The cadence tabs already key the modal (good). Go one step further:

- Goal mode: a minimal three-field flow (Name, Total, Target date — or
  "every N years") + the plan preview from §1. No frequency, no
  discretionary toggle, no milestone selector — none of those apply.
- Native `<input type="date">` inside the TriggerSelector popover burned
  three fix iterations (year-typing). Consider dedicated D/M/Y segmented
  inputs or a tiny calendar component; native date inputs inside controlled
  React popovers are a recurring tax.
- Milestone options should show their resolved date: "@ Retirement (2042)" —
  currently the consequences of picking a milestone are invisible until the
  sim runs.

## 5. Debug surfaces should not face users (low effort, hygiene)

- The Sankey **imbalance warning banner** is an accounting self-check. Great
  diagnostic — move it behind the debug flag (or Testing tab) and show
  nothing user-facing; an end user can't act on "Expenses has $32,400
  inflows but $29,100 outflows".
- The **Testing tab** (7.2k lines) sits in the main sidebar. Gate it behind a
  setting ("Developer tools") so the default nav is Dashboard / Current /
  Budget / Plan / Projection.

## 6. Theme/chart color contract (low effort, prevents regressions)

The black-arc bug (oklch tokens unparseable by d3-color) was fixed with a JS
converter, but the contract is implicit. Add a unit test that walks every
`--color-chart-*` / `--c-cat-*` token in each theme and asserts
`resolveColor` returns a valid rgb — a new theme or token then can't silently
break charts again.

## 7. One ambitious idea: per-object timeline view

The sim is year-by-year but the UI is aggregate-first. The single most
tangible upgrade: click any object (account, expense, goal, income) anywhere
in the app → a panel showing **that object's life**: balance/amount
trajectory, start/end markers, events (goal purchase, loan payoff, SS claim,
RMD start), and which tabs it appears in. All the data exists per
`SimulationYear`; this is a lens, not new simulation. It would make
questions like this week's ("did my goal make it into the sim?") answerable
in one click instead of a cross-tab hunt.

---

## Suggested order

1. §1 goal-plan preview + creation receipts (closes out the goal saga properly)
2. §5 hide debug surfaces (one evening)
3. §2 budget pacing "why" tooltip + monthly-figure labels
4. §6 theme contract test
5. §3 Future IA split + naming (bigger; do when appetite exists)
6. §4 goal-specific creation flow + date-input replacement
7. §7 object timeline (the feature-sized one)
