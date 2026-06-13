# UX review — Tax / Budget / Planning pages (2026-06-12)

Findings from three parallel page reviews (Current→Taxes + projection Tax view;
the Budget tab and its six subtabs; the Plan group: Assumptions / Allocation /
Withdrawal). Companion to `ux-design-notes.md` (philosophy) and
`ux-implementation-plan.md` (the P1–P7 work already done this session).

**Through-line:** all three pages have the same shape — the math is correct,
the model is invisible — and most fixes reuse patterns already built:
ReceiptToast, provenance tooltips, CardSection, pre-delete impact summaries.
This is "finish applying the playbook," not new invention. The two exceptions
that need genuine design thought (tax-modeling modes, budget↔plan handshake)
get their own sections at the bottom.

---

## A. Correctness / model traps (not really "UI" — these silently produce wrong numbers)

### A1. Manual tax overrides flatten the entire projection — NEEDS A DESIGN, see §T
The fed/FICA/state override fields on Current→Taxes are flat dollar amounts,
and the same `taxState` is fed into EVERY simulated year
(`SimulationEngine.tsx:398` → `taxService/{federalTax,ficaTax,stateTax}.ts`).
Entering "my federal tax is $18,000" pins $18,000 at age 45, age 70, and every
retirement year — flattening the projection, Roth-conversion analysis, and
tax-optimization output. A warning is the floor; the real answer is giving the
user control over how taxes are modeled. **Full options analysis in §T below.**

### A2. History-tab edits are silently reverted
Budget→History (`HistoryTab.tsx:135-181`) lets you hand-edit a category's
spending via `UPDATE_SPENDING`, but `useAutoReconcile` (`BudgetTab.tsx:20`)
overwrites it from transactions whenever that month's transactions change —
two sources of truth, no indication which wins, contradicting the Spending
tab's own "automatically calculated from categorized transactions"
(`SpendingTab.tsx:554`). **Fix:** make History read-only for months that have
transactions (edit only empty/manual months, with an info note pointing to the
Transactions tab); or mark edited cells as "manual override" and warn reconcile
may revert. Read-only is cleaner and matches the established source-of-truth.
Effort: M.

### A3. Tax page can crash on an unguarded deref
`TaxesTab.tsx:69` reads `stateParams.standardDeduction` with no guard, while
the same value is guarded at `:342`. A state/year/filing combo present in the
DB for one year but not the selected `taxYear` makes `stateParams` undefined →
throw on render. **Fix:** `stateParams?.standardDeduction ?? 0` (or constrain
the year dropdown to years valid for the state). Effort: S. (Correctness, not
UX — fold into the next touch of that file.)

---

## B. ReceiptToast quartet — high-impact mutations with zero cross-tab feedback

All near-verbatim reuse of `useReceiptToast()`. Events → toast.

- **B1. CSV import** (`CSVImportModal.tsx:130-138`; rules side-effect in
  `transactions/useTransactionEditor.ts:65-101`): the highest-volume mutation
  in the app drops N transactions into a month AND can auto-create
  categorization rules that land invisibly on the Settings tab. Toast:
  "Imported 23 transactions to June 2026 · 4 rules created", `linkTo` Settings
  when rules were created. Effort: S.
- **B2. Single transaction delete** (`transactions/TransactionRow.tsx:369-374`):
  instant and irreversible, no confirm (while "Clear All" has a full dialog).
  Toast with an Undo callback ("Deleted 'AMAZON $42.10' · Undo") — lighter than
  a per-row modal for a high-frequency action. Effort: S (toast) — note: an
  undo needs the delete to be reversible; if the reducer can't restore, store
  the removed row in the toast's closure and re-dispatch an add.
- **B3. Allocation reorder / add / delete** (`PriorityTab.tsx:346-352`,
  `:734-742`): drag reorders and bucket deletes silently invalidate the cached
  projection. Toast "Allocation order changed — projection updated". Effort: S.
- **B4. Withdrawal-order reorder** (`WithdrawalTab.tsx:260-266`): same —
  reordering the burn order changes the projection with no acknowledgment.
  Effort: S.

Related, slightly bigger: **import undo** (`ResultStage.tsx:77-85`) — tag
imported transactions with a batch id so "Undo last import" can remove just
those (today the only recovery is Clear All, which also nukes manual entries).
Effort: M. Do after B1 if the toast-undo proves popular.

---

## C. Provenance tooltips — derived numbers that don't explain themselves

The projection Tax view is the gold standard here (Tax Base / Effective /
Marginal tooltips at `TaxOptimizationTab.tsx:132,216,343-356`); the pages below
lag it.

- **C1. Current→Taxes hero numbers** (`TaxesTab.tsx:273-283, 329-351, 361-366`):
  Effective Rate, each tax line, and Net Take Home are bare figures on the page
  where users actually tune filing status / deductions. Add the same `Tooltip`
  the projection side uses ("(Federal + FICA + State) ÷ Gross"; "Federal tax on
  AGI of $X after the $Y deduction"; the full Net Take Home subtraction). Also:
  Net Take Home subtracts a post-tax employer-match component that is never
  shown as a line (`:100` vs `:353-359`) — the column can't be reconciled by
  hand; show every subtracted piece. Effort: S.
- **C2. Allocation waterfall** (`PriorityTab.tsx:372-392, 716-721`): the
  `displayInfo` strings pack arithmetic into prose ("2x Expenses (Target: $60K
  - Current: $42K)" — the " - " reads like a typo), and the deducted/"left"
  figures have no tooltip explaining the `min(cost, remaining)` clamp, so a
  partially-funded bucket just shows a smaller number than typed with no reason.
  Replace prose math with a provenance tooltip ("Wanted $1,000 · $400 surplus
  left · funded $400"). Effort: S–M.
- **C3. Budget Overview pacing** (`OverviewTab.tsx:239-281, 388-403`): YTD and
  month tiles use plain `title=` text; give them the same "why" tooltips the
  Spending tab now has. The History "Avg" row divides by a hardcoded 12 even
  for partial years (`HistoryTab.tsx:71-82`) — label it "(of 12 months)" or
  tooltip the assumption. Effort: S–M.

---

## D. "Make the model visible" features (meatier — the model genuinely isn't shown)

- **D1. Withdrawal Order shows no consequence** (`WithdrawalBucketList.tsx:117-129`;
  build site `WithdrawalTab.tsx:269-281` where the simulation is in context):
  the page's entire purpose — ordering which accounts drain first — produces
  zero visible feedback; dragging changes nothing on screen. Derive from
  `simulation` the year/age each account is first tapped and when it depletes,
  show "Tapped age 62 → depleted age 71" per bucket, provenance-tooltip the
  depletion year. This is the largest invisible-model surface of the three
  pages. Effort: M.
- **D2. Milestones never show their resolved year**
  (`MilestoneModal.tsx:252-266`; data already exists at
  `useSimulation.tsx:189` as `milestoneReachYears`): "Net Worth ≥ 25× Expenses"
  never says WHEN the sim hits it. Thread the map in, render "→ reached 2034
  (age 47)" / "Not reached within plan", plus an "N expenses / M incomes
  triggered" tag (reuse the modal's existing `getMilestoneReferences`). Effort:
  M.

---

## E. Form heaviness & convention cleanup (lower priority)

- **E1. CardSection candidates:** Tax Manual-Overrides group (always-open,
  rarely-used advanced cluster — `TaxesTab.tsx:226-263`); Budget Settings'
  hand-rolled Rules/Formats collapsibles (`SettingsTab.tsx:87-105, 223-241`);
  AssumptionTab's flat 12-field "Advanced Settings" wall
  (`AssumptionTab.tsx:233-352`). The collapsed summary line doubles as
  legibility (e.g. overrides → "No overrides" / "2 overrides active").
- **E2. Styled-input violations (CLAUDE.md):** Budget Settings add/edit forms
  and the Transactions toolbar use native `<input>/<select>` and hand-built
  toggles (`SettingsTab.tsx:131-166, 404-430`; `Toolbar.tsx:147-158`;
  `TransactionRow.tsx` edit form + the native selection checkbox at `:302-321`).
  Migrate to ToggleInput/DropdownInput/NameInput (the multi-select grid checkbox
  is a defensible exception — make it a conscious one).
- **E3. Settings/format and rule deletes are instant & silent**
  (`SettingsTab.tsx:54-63, 279-284, 375-380`): lightweight confirm or
  ReceiptToast-with-undo; for a rule, an impact line ("won't change
  already-categorized transactions").
- **E4. `projectFuture` shown as two differently-labeled toggles** for one
  global setting (`OverviewTab.tsx:319-324` vs `SpendingTab.tsx:561-570`):
  unify the language + note "applies across the Budget tab."
- **E5. Experimental/DP tax controls face all users**
  (`TaxOptimizationControls.tsx:64-196`): the "Backward-induction DP …
  (experimental)" strategy + δ slider is researcher language; gate the
  `dp-precomputed` option behind `display.showDevTools`, leaving `rate-match`
  as the only default-visible algorithm.
- **E6. Trends ignores the month scrubber** (`TrendsTab.tsx:84-105`): hardcodes
  "trailing 6 months from today" while every sibling tab follows
  selectedMonth/Year — either anchor on the selection or label the fixed window.
- **E7. Empty-state copy drift:** Overview's getting-started points at the wrong
  tab for categorization (`OverviewTab.tsx:476-479`), Spending says "Current >
  Expenses" (`:541`) — verify against actual nav labels; thin pre-sim empty
  states on Priorities (`PriorityTab.tsx:758-762`) and the "run a full
  simulation first" card with no run button (`OptimizationSummaryCard.tsx:142`).
- **E8. Terminology drift:** "Tax Estimate" vs "Tax Settings" vs "Tax Snapshot";
  sidebar "Withdrawal" vs heading "Withdrawal Order"; inconsistent
  expand/collapse idioms across the Plan tabs (hand-rolled chevron vs native
  `<details>` vs CardSection). Standardize.

---

## What's already good (don't re-touch)
- The projection **TaxOptimizationTab** and **TaxOptimizationControls** "More
  info" disclosures are the bar — plain-language verdicts, honest SORR warnings,
  full provenance. Model the rest on them.
- **SpendingTab** (post this-session work): pacing "why" tooltips, mid-year
  proration, goal set-aside rows, "this month" denominators, honest
  waiting/unreachable states. FIRE purity respected.
- **ClearAllDialog** and **MilestoneModal pre-delete summary** are the correct
  destructive-action template; B2/E3/D-deletes should follow them.
- Transactions grouping (uncategorized / income / transfers-not-counted /
  reimbursement netting) is legible.

---

# §T. Tax modeling — design options (the override question is the tip of this)

The real problem isn't "warn the user"; it's that there's exactly ONE way to
intervene on taxes (a flat dollar replacement applied to all years) and it
serves several different user intents badly. We need to separate the intents
and give a small set of honest modeling choices.

## The intents — four distinct needs, and TWO of them vary over time
Splitting these is the whole point. Critically, two are legitimate
forward-looking PLAN INPUTS (taxes that change over time) — not "overrides" at
all — which the original scope/form framing missed entirely:

1. **Point-in-time correction (this year).** "I have my real tax numbers from my
   return — use them for the snapshot, project future years normally."
   → current-year-only dollar override.
2. **Scheduled change (a dated life event that changes tax treatment).**
   *"I'm moving from CA to TX at 60."* / filing-status changes (marriage,
   widowhood). A discrete switch at a future date/milestone. Relocating to a
   no-income-tax state in retirement is a flagship FIRE move with large,
   multi-decade consequences the app **currently cannot model at all** — there's
   one static `stateResidency`.
3. **Secular drift (the regime itself changes).** *"I think future taxes will be
   higher/lower."* / TCJA brackets sunsetting. A trend layered on the bracket
   structure over time — like an inflation assumption, but for tax level.
4. **Modeling fallback (I can't/don't use the engine's calc).** Unusual
   situation (credits, business income, consistently-off estimate) → a flat
   effective rate, or an adjustment to the engine's estimate.

Today's single flat-dollar-all-years field is a bad fit for ALL of these, and
the dollar×all-years combination is the one that's almost always wrong (a fixed
$18k in 2050 is meaningless under inflation; rates and factors scale, dollars
don't). #2 and #3 aren't override variants at all — they're tax inputs that need
a TIME dimension.

## What each intent needs

- **#2 Scheduled state move — highest FIRE value, cleanest scope.** Model state
  residency as a timeline, not a scalar: "CA until 2034, then TX," or a
  milestone-triggered change. Reuse the existing trigger/milestone machinery
  (the same date-or-milestone selector expenses and incomes already use). This
  is a real feature, not polish — arguably the single most valuable tax change
  for an early-retiree audience, and it generalizes to filing-status-over-time.
  The engine already resolves taxes per-year, so it "just" needs the resident
  state for year Y instead of a constant. Effort: M–L.
- **#3 Secular drift — a new assumption.** A "future tax regime" assumption
  alongside the macro knobs (inflation, growth): a real annual drift on brackets
  (±x%/yr in real terms) and/or a discrete step at a target year (model TCJA
  sunset as "brackets revert in 2026"). Answers "I think taxes will be higher"
  without a flat dollar. Effort: M.
- **#1 Current-year correction — scope the override.** Dollar overrides apply to
  the snapshot + year 0 only; existing stored overrides migrate to this (the
  safe read). Removes the silent-flatten trap immediately. Effort: S–M.
- **#4 Modeling fallback — a projection tax mode.** Full calculation (default) /
  flat effective rate (%) / adjustment factor (engine × user factor). Rate- and
  factor-based forms project sanely; the dollar replacement is confined to #1's
  current-year scope. Effort: M.

## Recommendation
Treat tax modeling as a small SUITE, sequenced by value-per-effort:
1. **Scope the current-year override (#1)** — kills the silent-flatten trap now;
   smallest change.
2. **Scheduled state move (#2)** — highest user value; reuse the trigger system.
   This is the headline feature, not an override tweak.
3. **Secular drift + adjustment-factor mode (#3 / #4)** — the "taxes will be
   higher" and "my taxes run high" needs, via a macro assumption + a projection
   mode.
Migration: any existing stored override → current-year-only.

Open questions before building: (a) does the scheduled state change live as a
new milestone-triggered residency field, or a dedicated "tax timeline" UI?
(b) drift as a single real %/yr, or a small set of named regimes (e.g. "TCJA
sunset 2026")? (c) is filing-status-over-time in scope with the state move or a
follow-up? (d) where do the projection-level knobs live — Assumptions, or a
dedicated Tax panel that also hosts the current-year overrides?

---

# §H. Budget ↔ Plan handshake — proposals (and how to not do it badly)

Budget answers "am I on track THIS YEAR." Plan/Projection answers "am I on track
to RETIRE." They never connect, which is the core gap for a FIRE app. But this
is easy to do badly — name the failure modes first.

## Failure modes to avoid
- **Heuristics that contradict the engine (the load-bearing one).** 25× spending
  is a rule of thumb; this app has a real year-by-year sim that models spending,
  taxes, inflation, and Roth conversions — so 25× will DISAGREE with the sim's
  own FI answer in most cases. Stating or designing around 25× undercuts the
  app's whole value prop and erodes trust the moment the two numbers differ. The
  handshake must connect to what the SIMULATION actually computes, never to a
  heuristic. (Decision, 2026-06-12.)
- **False precision.** Translating one month's budget variance into "retirement
  delayed 3 months" implies accuracy that doesn't exist; one bad month barely
  moves a 20-year projection. Overstating it breeds anxiety and distrust.
- **Over-coupling / performance.** Re-running the full simulation on every
  transaction edit is slow and conceptually wrong — the budget is *this year's
  actuals*, not a plan input.
- **Circular provenance confusion.** The budget's "expected by now" already
  comes FROM the plan (savings priorities + simulation). Some of the "handshake"
  is just making that existing origin visible, not inventing new math.

## Proposals, safe → ambitious
All compare actuals to what the SIM produces — no 25×, no rules of thumb.

**H-A — Provenance link (do this regardless; trivial, impossible to do badly).**
The budget's contribution targets already derive from the plan. Say so: an
info-blue callout on Spending's Annual Contributions section — "These targets
come from your retirement plan's savings priorities →" linking to Allocation.
Closes the "where do these numbers come from" gap with zero new math.
Effort: S.

**H-B — This-year actuals vs the plan's per-year assumption (recommended).** The
simulation already computes an assumed spending and savings figure for the
CURRENT year. The budget tracks your actuals for that same year. Compare the two
directly and directionally — "Spending $X this year vs the plan's assumed $Y" /
"Saving $X vs $Y, on pace / below" — an apples-to-apples, same-year comparison
the engine already produces. No heuristic, no re-sim, nothing that can contradict
the sim (it IS the sim's number). This is the honest middle: it connects the two
mental models using the engine's own figures. Place it on Budget Overview and/or
the Spending header. Effort: S–M. (Note the deliberate
annualized-average vs today's-active spending semantics —
`project_monthly_expenses_semantics` — and label which the comparison uses.)

**H-C — Re-sim with actuals as year-0 reality (the honest deep version).** Feed
YTD actuals into the projection as the current year's truth and let the SIM
recompute the outcome — FI date / portfolio longevity / milestone years. This is
the *right* ambitious version precisely because the answer comes from the real
engine, not a heuristic; it's the only thing that yields a true FI-date delta,
and it does so honestly. Caveats: don't recompute per-transaction (trigger on
demand or on tab focus); frame as "what-if: continue this year's pace," not an
always-on number; one bad month must not visibly move a 20-year result.
Effort: L. Hold until H-A/H-B are proven.

Dropped: the earlier "spending → FI number via 25×" idea — rejected per the
first failure mode; it would state a number that disagrees with the sim.

**Recommendation:** Ship **H-A** + **H-B** together — they make the budget↔plan
relationship legible by comparing actuals to the SIM's own per-year assumptions
(the FIRE question answered with the engine's numbers, not a rule of thumb). H-C
is the eventual deep integration when there's appetite.

Open questions for you: (a) Overview vs Spending-header placement for H-B (or
both)? (b) for H-B, at what granularity does the sim expose its "this year"
assumption — total annual spending, or per-category — and is the comparison
spending-only, savings-only, or both? (c) Is H-C (the re-sim) something you want
on the roadmap at all, or is the same-year actuals-vs-plan comparison the whole
story?

---

# §P. Progress tracking — projection memory & monthly net worth

A THIRD axis, distinct from both existing features: Scenarios are manual
what-if branches; HistoricalBacktestPanel is market-history backtesting ("would
my plan survive a 1966 sequence?"). This is the *track record* — did the
system's own past predictions match the reality that followed? Something the app
**accrues passively**, not something the user operates.

## What already exists (smaller than it looks)
- **Reality over time is free:** `amountHistory` (Record<accountId, dated
  balance snapshots>) — actual net worth at any past date is a sum across
  accounts, and it's already monthly-capable (entries are dated).
- **Capture plumbing exists:** ScenarioContext already snapshots full inputs and
  re-runs the sim. The ONLY missing piece: nothing freezes a prediction at a
  moment in time — the sim is always recomputed from today's inputs.

## The decision that defines it: freeze, don't re-derive
A prediction is only auditable if kept AS MADE. Re-running old inputs through
today's engine answers a different question ("what if I'd kept that plan") and
drifts with engine/assumption changes. So at snapshot time, freeze the projected
OUTPUT (net-worth-by-year curve + FI year + key milestone years). Tiny storage,
immutable once written.

## P-1. Projection memory (the passive loop)
- Once a month (on app-open if a month has elapsed; dedup so daily opens don't
  spam), quietly snapshot the current projection's frozen curve + timestamp.
  Zero user action; natural to piggyback on the backup cadence (self-hosting
  CouchDB is a durable home).
- **View — "the projection chart gains memory":** the existing net-worth
  projection chart gets a "show past projections" toggle overlaying faint
  vintage curves (1/2/3 yrs ago) with the ACTUAL net-worth line threading
  through. Same chart you already read, no new page. Plus the blunt scalar:
  "A year ago this predicted $X for today; two years ago $W. Actual: $Y."
- **Honesty note (must not get wrong):** a missed prediction has TWO causes —
  (1) assumptions were off (market/inflation surprise) and (2) you changed your
  plan since (job, baby, move, windfall). A naive overlay implies all gap is (1)
  and makes a good model look broken. Frame as "what past-you's plan projected
  for now," noting divergence reflects both. (V2 could decompose them.)
- Reuse: Networth.tsx / FanChart.tsx; amountHistory; the backup cadence.

## P-2. Month-by-month net worth (drift within the year)
- The sim is year-granular and STAYS that way — do NOT make the engine monthly.
  Actuals are already monthly (amountHistory); interpolate the annual projection
  down to a monthly "expected" path and let the real monthly line drift against
  it. The budget already does exactly this interpolation (`computeExpectedByNow`
  in SpendingTab — starting balance compounded over months + contributions
  ramped) — reuse that pattern for net worth.
- **View:** a clean month-by-month net worth chart, actual vs expected, with the
  running drift. Answers "my Jan prediction vs actual, and how they've drifted."
- Caveat: a flat linear interpolation is crude (net worth compounds; taxes and
  contributions are lumpy) — the computeExpectedByNow approach is the more honest
  one. Sparse balance updates make the actual line sparse (same as P-1).

## Naming
Rename HistoricalBacktestPanel (e.g. "Market Stress Test") so market-sequence
backtesting reads as distinct from this "projection track record."

## Open questions
(a) cadence — monthly vs quarterly; full curve vs a few horizon points?
(b) projection memory ON the existing net-worth chart (toggle) or its own
Progress view? (c) is P-2 its own chart or a zoom of the same view? (d)
decompose the two divergence causes now, or just the honest note for v1?

---

## Suggested sequencing
1. **Correctness traps first:** A2 (History read-only) + A3 (deref guard). A1 is
   gated on the §T decision — don't ship a band-aid you'll rip out.
2. **ReceiptToast quartet (B1–B4)** + the provenance tooltips (C1–C3): cheap,
   high-legibility, reuse what's built.
3. **§H-A + §H-B handshake** once you've answered the open questions.
4. **D1 (withdrawal consequences) + D2 (milestone years):** the meatier
   make-it-visible features.
5. **§P progress tracking:** the passive snapshot loop is mostly new plumbing on
   existing data (amountHistory + scenario capture); P-1 first, P-2 follows.
6. **§T tax suite:** scope the current-year override first (kills the A1 trap),
   then the **scheduled state move** (highest value), then drift + adjustment
   mode. Do after aligning on the §T open questions.
7. **E-series cleanup** opportunistically as those files are touched.
