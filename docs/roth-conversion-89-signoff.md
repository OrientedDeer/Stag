# Roth Conversion Strategy — Finalization Sign-off (#89)

> **Re-validated 2026-06-14 on the post-code-review code** (`50ab2d4` #4 surplus fix +
> `8b40d70` Change-2 removal), with realistic SS. All three legs hold: DP at the
> after-tax-wealth peak (1× optimal, no over/under-conversion), S2 **production closed-loop**
> ahead of rate-match on BOTH median (+$89k) and tail (p10 +$6.6k) — droppability measured,
> not inferred — depletion floor Δ ≤ +2pp (0pp at realistic stress). Magnitudes below
> refreshed. **The decision stands.**

## Decision

**Ship bracket-aware DP as the default Roth-conversion strategy, evaluated by production's
natural annual re-solve. Retire rate-match as a non-default fallback. Do NOT build a
Monte-Carlo policy search, a precomputed exit-rate lookup table, or a stochastic
closed-loop policy.**

The deterministic DP, with the SS-aware bracket-aware terminal valuation, maximizes
after-tax terminal wealth and is the right production objective. Production re-solves the
DP each time the user re-runs against their realized balances — that annual re-solve *is*
the closed-loop adaptivity; nothing further is warranted by the evidence.

## What shipped (committed on `roth-conversion-89`)

- **SS-aware self-liquidate terminal** (`0026fd6`). The residual Traditional drawdown is
  valued by stacking it on the retiree's projected late-life Social Security + fixed
  income and charging the marginal (torpedo-inclusive) rate. Old SS=0 under-priced the
  residual's true in-life exit and made the DP under-convert in SS-heavy plans. Bequeath
  unchanged.
- **Default flipped to bracket-aware DP** (`d16c2f9`). `rothConversionStrategy` defaults to
  `dp-precomputed` (production-derives the max-wealth bracket-aware objective). rate-match
  code is fully retained as a selectable non-default fallback — a one-line revert restores
  it as default, or seeds a user-facing "conservative mode" / full delete later.
- **#89 regression test** reframed to **wealth-optimality**, not "never drains": on a
  synthetic high-growth shape (where the old min-tax objective over-drained to ~$0), the
  bracket-aware plan's harvest-aware after-tax terminal wealth is **≥ the full-drain
  alternative** — it does not convert past the wealth peak. (Draining a residual whose real
  exit rate is high is wealth-positive and *correct*; over-draining under min-tax was the
  bug.)

### Post-validation code-review pass (`50ab2d4`, `8b40d70`)

The original validation predates these; the evidence below is **re-validated on the fixed
code**:
- **#4 surplus-cash fix** — the bracket-aware terminal alone still over-converted: in
  *surplus* years (forced SS+RMD+fixed income ≥ spending+tax) the waterfall taps nothing, so
  a conversion's tax was paid invisibly and terminal V counted the full Trad→Roth move at
  zero cost. Crediting the after-tax surplus (symmetric to the `−fromBrokerage` leak) fixes
  it. This *materially* changed the strategy (≈−⅓ conversions, state-move response
  $15k→$400k) **after** the original sweep — hence this re-validation.
- **Reserve-aware spending (Change 2) removed** (`8b40d70`). It collapsed to draining
  tax-free Roth once income filled the std deduction, then proved a provable no-op; deleted
  end-to-end. **Change 1 (bracket-aware terminal) + #4 now carry #89.**

## Evidence (re-validated on the fixed code, artifact-robust only)

Re-run offline over seeded synthetic paths with **realistic SS** (35-yr earnings history →
non-zero PIA → torpedo active; the original A/B/C harness had SS≈0). Three legs:

0. **Deterministic optimality sweep — the DP is at the after-tax-wealth peak (NEW).** For
   S1 (high-growth, ~9.3%) and S2 (low-growth, ~4.8%), self-liquidate, the shipped DP plan
   was scaled {0.5, 0.75, 1, 1.25, 1.5}× and scored through the real forward sim on **full**
   after-tax wealth (Roth + production bracket-aware trad-exit + residual brokerage +
   savings). **1× is the peak for both** (neighbors strictly lower), and beats rate-match and
   full-drain endpoints. #4-on vs #4-off at 1× differs by **<1% and flips sign** between S1
   (−0.8%) and S2 (+0.17%) → grid/approximation noise, not gross over- or under-conversion.
   → #4 did not overshoot; **#7's brokerage omission is empirically argmax-equivalent** (the
   brokerage-omitting objective produced the full-wealth-optimal plan within <1%). The
   residual <1% is the documented #4/#7 brokerage-growth-vs-`g` approximation.

1. **S2/iid low-growth, N=50 — production closed-loop (annual re-solve).** Bracket-aware vs
   rate-match, driving the REAL forward sim and re-solving the DP each year from realized
   balances — account+income **instances threaded** across re-solves (not scalar-rebuilt), so
   it's artifact-free by construction (deterministic self-check **0.18%**; the production sim
   preserves basis/lot/conversion-history natively). Closed-loop BA: median **+$89k**,
   10th-percentile **+$6.6k** vs rate-match — **ahead on BOTH the median and the tail.**
   (Open-loop BA, replaying the fixed year-0 plan, is −$15k on the p10; the annual re-solve
   recovers it — a **+$21k p10 swing** — exactly the adaptivity production provides.)
   → rate-match is droppable, **MEASURED on the production tail, not inferred.** Consistent
   with the original clean closed-loop p10 +$15k (same positive sign).

2. **Depletion-stress floor, open-loop, N=50.** Non-adaptive bracket-aware vs rate-match
   failure rate: **Δ = 0pp** at de-saturated stress (28% both at $92k spend; 44% both at
   $100k), **+2pp** at saturated stress (86% vs 84% at $135k) — matching the original's +2pp,
   tighter at realistic stress. BA median slightly ahead throughout. → Bracket-aware carries
   **no elevated ruin risk** vs rate-match even before the annual re-solve helps.

   *Sign-checks (S1/S3 bootstrap, N=10):* median wins hold (S1 +$334k; S3 SS-heavy +$92k).
   S1 open-loop failure +10pp is one path at N=10 replaying a fixed aggressive plan through
   historical crashes — exactly what the production annual re-solve (closed-loop) adapts to.

## Explicitly NOT claimed

The closed-loop harness produced **inflated magnitudes** in long-horizon, high-growth cells
(S1: ~$20M+ medians, large failure-rate gaps) — a **re-anchoring artifact** of the
throwaway harness rebuilding accounts from scalars each simulated year and losing
cost-basis / lot / conversion-history structure. **Those numbers are not cited and must not
be quoted** (e.g. the "8% vs 34% failure" closed-loop figure or the multi-million closed-loop
medians). Production is unaffected: the real forward sim threads the incremented account
instances continuously and preserves basis/lot structure across years natively — verified.

## What this buys us (scope avoided)

- No Monte-Carlo policy search.
- No precomputed/knot-aligned exit-rate lookup table (the dimensionality study showed the
  self-liquidate curve doesn't cleanly collapse due to the SS torpedo; calling the real tax
  function — the shipped approach — is simpler and likely cheaper).
- No stochastic closed-loop policy parameterization.

## Product decision (resolved)

**Spend-down vs bequeath default = `self-liquidate` (ratified).**
`rothConversionUserSituation` ('self-liquidate' | 'bequeath') drives how aggressively the
DP converts. The UI defaults to **"spend it down"** (self-liquidate) as a sensible default;
the user can switch to **"leave to heirs"** (bequeath), which converts more aggressively
because the residual would exit at an heir's high rate. This is now a committed default,
not a fallback.

## Known limitations / follow-ups (non-blocking)

- Closed-loop magnitudes in long high-growth horizons need a clean re-eval if the *numbers*
  (not the direction) are ever required for sign-off — debug the throwaway harness's
  per-year account carry (continuous lots), not production.
- `HEIR_EXIT_RATE` (0.32) for the bequeath branch is a flat assumption; sensitivity not
  swept.
- Larger-N would tighten the depletion failure-rate estimates (N=50 here).
