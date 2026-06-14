# Roth Conversion Strategy — Finalization Sign-off (#89)

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

- **SS-aware self-liquidate terminal** (`69a944c`). The residual Traditional drawdown is
  valued by stacking it on the retiree's projected late-life Social Security + fixed
  income and charging the marginal (torpedo-inclusive) rate. Old SS=0 under-priced the
  residual's true in-life exit and made the DP under-convert in SS-heavy plans. Bequeath
  unchanged.
- **Default flipped to bracket-aware DP** (`ef60b19`). `rothConversionStrategy` defaults to
  `dp-precomputed` (production-derives the max-wealth bracket-aware objective). rate-match
  code is fully retained as a selectable non-default fallback — a one-line revert restores
  it as default, or seeds a user-facing "conservative mode" / full delete later.
- **#89 regression test** reframed to **wealth-optimality**, not "never drains": on a
  synthetic high-growth shape (where the old min-tax objective over-drained to ~$0), the
  bracket-aware plan's harvest-aware after-tax terminal wealth is **≥ the full-drain
  alternative** — it does not convert past the wealth peak. (Draining a residual whose real
  exit rate is high is wealth-positive and *correct*; over-draining under min-tax was the
  bug.)

## Evidence (artifact-robust only)

The closed-loop (annual re-solve) evaluation was run offline over seeded stochastic paths
(iid lognormal + historical block-bootstrap, real SS, mortality-table longevity). The
verdict rests on the two evidence points that are **independent of the harness's
re-anchoring artifact**:

1. **S2/iid low-growth tie, N=50 (validated mechanics).** Closed-loop bracket-aware vs
   rate-match: median **−$6k** (−0.3% on ~$1.8M, inside Monte-Carlo noise), 10th-percentile
   **+$15k** (closed-loop slightly *ahead* on the downside), failure **0% both**. The
   closed-loop mechanics were validated here against the deterministic plan within ~8%.
   → In the one corner where rate-match was competitive, the annual re-solve **ties** it and
   is not worse on the tail. rate-match is not needed for downside protection.

2. **Depletion-stress floor (open-loop, N=50).** In the high-spend depletion cell, the
   *non-adaptive open-loop* bracket-aware plan fails **36%** vs rate-match's **34%** —
   within ~2pp. So bracket-aware does **not** carry elevated ruin risk versus rate-match
   even before the annual re-solve helps. → The "future-hedging" branch is not triggered.

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
