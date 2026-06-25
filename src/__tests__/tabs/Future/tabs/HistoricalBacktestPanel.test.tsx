import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  HistoricalBacktestPanel,
  resolveBacktestStrategySettings,
  formatGuardrailAdjustmentLabel,
} from '../../../../tabs/Future/tabs/HistoricalBacktestPanel';
import {
  AssumptionsContext,
  defaultAssumptions,
} from '../../../../components/Objects/Assumptions/AssumptionsContext';

// -----------------------------------------------------------------------------
// ISSUE 1: asymmetric guardrails in the GK label
//
// The label previously derived a single "±N%" guardrail figure from the UPPER
// guardrail only, which is wrong when upper/lower are configured independently.
// -----------------------------------------------------------------------------
describe('formatGuardrailAdjustmentLabel — asymmetric guardrails', () => {
  it('renders both bounds independently for asymmetric guardrails', () => {
    const label = formatGuardrailAdjustmentLabel({
      gkAdjustmentPercent: 10,
      gkUpperGuardrail: 1.3,
      gkLowerGuardrail: 0.85,
    });
    // Upper trigger is +30%, lower (boost) trigger is +15% — must show both.
    expect(label).toContain('+30%');
    expect(label).toContain('-15%');
    // And must NOT collapse the lower bound to the upper figure.
    expect(label).not.toContain('±30%');
  });

  it('still renders symmetric guardrails as the same magnitude on both sides', () => {
    const label = formatGuardrailAdjustmentLabel({
      gkAdjustmentPercent: 10,
      gkUpperGuardrail: 1.2,
      gkLowerGuardrail: 0.8,
    });
    expect(label).toContain('+20%');
    expect(label).toContain('-20%');
  });

  it('surfaces the adjustment percent', () => {
    const label = formatGuardrailAdjustmentLabel({
      gkAdjustmentPercent: 7,
      gkUpperGuardrail: 1.2,
      gkLowerGuardrail: 0.8,
    });
    expect(label).toContain('7%');
  });
});

// -----------------------------------------------------------------------------
// ISSUE 2: a legitimate 0 must survive (not get coerced to the fallback)
//
// A user can clear gkAdjustmentPercent (PercentageInput emits onChange(0)); the
// reducer doesn't clamp, so 0 is a real, reachable value. The panel previously
// read these with `|| default`, turning a real 0 into the default in both the
// config that RUNS and the displayed label.
// -----------------------------------------------------------------------------
describe('resolveBacktestStrategySettings — explicit 0 is preserved', () => {
  it('keeps an explicit gkAdjustmentPercent of 0 (does not fall back to 10)', () => {
    const resolved = resolveBacktestStrategySettings({
      withdrawalStrategy: 'Guyton Klinger',
      withdrawalRate: 4,
      gkUpperGuardrail: 1.2,
      gkLowerGuardrail: 0.8,
      gkAdjustmentPercent: 0,
    });
    expect(resolved.gkAdjustmentPercent).toBe(0);
  });

  it('keeps an explicit withdrawalRate of 0 (does not fall back to 4)', () => {
    const resolved = resolveBacktestStrategySettings({
      withdrawalStrategy: 'Fixed Real',
      withdrawalRate: 0,
      gkUpperGuardrail: 1.2,
      gkLowerGuardrail: 0.8,
      gkAdjustmentPercent: 10,
    });
    expect(resolved.withdrawalRate).toBe(0);
  });

  it('keeps explicit guardrails of 0 (does not fall back to 1.2 / 0.8)', () => {
    const resolved = resolveBacktestStrategySettings({
      withdrawalStrategy: 'Guyton Klinger',
      withdrawalRate: 4,
      gkUpperGuardrail: 0,
      gkLowerGuardrail: 0,
      gkAdjustmentPercent: 10,
    });
    expect(resolved.gkUpperGuardrail).toBe(0);
    expect(resolved.gkLowerGuardrail).toBe(0);
  });

  it('falls back to defaults when the investments object is missing', () => {
    const resolved = resolveBacktestStrategySettings(undefined);
    expect(resolved.withdrawalStrategy).toBe('Fixed Real');
    expect(resolved.withdrawalRate).toBe(4);
    expect(resolved.gkUpperGuardrail).toBe(1.2);
    expect(resolved.gkLowerGuardrail).toBe(0.8);
    expect(resolved.gkAdjustmentPercent).toBe(10);
  });

  it('falls back to defaults for fields that are genuinely undefined', () => {
    const resolved = resolveBacktestStrategySettings({
      // withdrawalStrategy / withdrawalRate omitted entirely
      gkUpperGuardrail: 1.3,
    });
    expect(resolved.withdrawalStrategy).toBe('Fixed Real');
    expect(resolved.withdrawalRate).toBe(4);
    expect(resolved.gkUpperGuardrail).toBe(1.3);
    expect(resolved.gkLowerGuardrail).toBe(0.8);
    expect(resolved.gkAdjustmentPercent).toBe(10);
  });
});

// -----------------------------------------------------------------------------
// ISSUE #117: surface that the backtest models GK differently from the projection
//
// The backtest runs a single-track, fixed-rate (rate × balance) GK, while the
// main projection runs a budget-anchored GK. Nothing told the user. A note must
// appear when (and only when) the GK strategy is selected.
// -----------------------------------------------------------------------------
function renderPanelWithStrategy(
  withdrawalStrategy: 'Fixed Real' | 'Guyton Klinger',
  gkOverrides?: { gkAdjustmentPercent?: number; gkUpperGuardrail?: number; gkLowerGuardrail?: number },
) {
  const state = {
    ...defaultAssumptions,
    investments: {
      ...defaultAssumptions.investments,
      withdrawalStrategy,
      ...gkOverrides,
    },
  };
  return render(
    <AssumptionsContext.Provider value={{ state, dispatch: () => null }}>
      <HistoricalBacktestPanel simulationData={[]} />
    </AssumptionsContext.Provider>,
  );
}

/**
 * The note's whitespace-collapsed full text. Reading the banner's `textContent`
 * (rather than getByText) survives the value interpolations splitting the copy
 * into multiple text nodes, e.g. `±{gkAdjustmentPercent}%`.
 */
function getNoteText(): string {
  const title = screen.getByText('How Guyton-Klinger is modeled here');
  // The banner root (title + body) is the title's grandparent in AlertBanner's
  // markup; its textContent holds the whole note.
  const banner = title.closest('div')?.parentElement ?? title;
  return (banner.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('HistoricalBacktestPanel — GK modeling-difference note (#117)', () => {
  it('shows the fixed-rate / single-track note when Guyton-Klinger is selected', () => {
    renderPanelWithStrategy('Guyton Klinger');
    expect(screen.getByText(/single-track/i)).toBeInTheDocument();
    expect(screen.getByText(/fixed-rate/i)).toBeInTheDocument();
    // It must contrast with the budget-anchored projection.
    expect(screen.getByText(/budget-anchored/i)).toBeInTheDocument();
  });

  it('does NOT show the note for a non-GK strategy', () => {
    renderPanelWithStrategy('Fixed Real');
    expect(screen.queryByText(/single-track/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/budget-anchored/i)).not.toBeInTheDocument();
  });

  // Review finding [0]: the projection HALF of the note must track the live GK
  // config too, not hardcode "±10% … ±20%". The projection's plan-anchored GK
  // reads the SAME gkAdjustmentPercent / gkUpper/LowerGuardrail off
  // assumptions.investments (SimulationEngine + WithdrawalStrategies), so with a
  // non-default, asymmetric config BOTH halves of the note must reflect it.
  it('reflects the live GK config on BOTH halves for a non-default asymmetric config', () => {
    renderPanelWithStrategy('Guyton Klinger', {
      gkAdjustmentPercent: 8,
      gkUpperGuardrail: 1.25, // upper trigger = +25%
      gkLowerGuardrail: 0.85, // lower trigger = -15%
    });
    const note = getNoteText();
    // Backtest half: the move size tracks the config.
    expect(note).toContain('±8% guardrail moves');
    // Projection half: the discretionary move AND the asymmetric guardrail band
    // must both come from config — never the frozen "±10% … ±20%" literals.
    expect(note).toContain('±8% discretionary adjustment');
    expect(note).toContain('+25% / -15%');
    // Guard against the regression: the old hardcoded literals must be gone.
    expect(note).not.toContain('±10% discretionary adjustment');
    expect(note).not.toContain('±20% guardrails');
  });
});
