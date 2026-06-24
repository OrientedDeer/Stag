import { describe, it, expect } from 'vitest';
import {
  resolveBacktestStrategySettings,
  formatGuardrailAdjustmentLabel,
} from '../../../../tabs/Future/tabs/HistoricalBacktestPanel';

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
