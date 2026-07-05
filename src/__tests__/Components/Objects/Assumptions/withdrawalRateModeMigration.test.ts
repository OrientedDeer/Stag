import { describe, it, expect } from 'vitest';
import {
  migrateAssumptions,
  defaultAssumptions,
} from '../../../../components/Objects/Assumptions/AssumptionsContext';

/**
 * `investments.withdrawalRateMode` migration (Guyton-Klinger auto rate mode).
 *
 * Saves written before the field existed have an `investments` section without
 * `withdrawalRateMode`. migrateAssumptions must infer intent from the saved
 * rate: a rate that differs from the default (4.0) was set deliberately →
 * 'manual' (so the user's GK band doesn't silently move); a still-default rate
 * → 'auto' (the new engine-derived behavior). Explicit saved values are
 * preserved as-is.
 */
describe('migrateAssumptions — investments.withdrawalRateMode', () => {
  /** A pre-field investments section, as old localStorage would have it. */
  const legacyInvestments = (withdrawalRate: number) => {
    const inv = JSON.parse(JSON.stringify(defaultAssumptions.investments)) as Record<string, unknown>;
    delete inv.withdrawalRateMode;
    inv.withdrawalRate = withdrawalRate;
    return inv;
  };

  it('fresh defaults are auto', () => {
    expect(defaultAssumptions.investments.withdrawalRateMode).toBe('auto');
    // Garbage / absent saved data falls back to the defaults object → auto.
    expect(migrateAssumptions(null, defaultAssumptions).investments.withdrawalRateMode).toBe('auto');
  });

  it('backfills MANUAL when the saved rate was customized (deliberate choice)', () => {
    const saved = JSON.parse(JSON.stringify({
      ...defaultAssumptions,
      investments: legacyInvestments(5.5),
    }));
    expect(saved.investments.withdrawalRateMode).toBeUndefined();

    const migrated = migrateAssumptions(saved, defaultAssumptions);

    expect(migrated.investments.withdrawalRateMode).toBe('manual');
    // The customized rate itself survives the merge.
    expect(migrated.investments.withdrawalRate).toBe(5.5);
  });

  it('backfills AUTO when the saved rate is still the default (4.0)', () => {
    const saved = JSON.parse(JSON.stringify({
      ...defaultAssumptions,
      investments: legacyInvestments(4.0),
    }));

    const migrated = migrateAssumptions(saved, defaultAssumptions);

    expect(migrated.investments.withdrawalRateMode).toBe('auto');
  });

  it('backfills AUTO when the whole investments section is missing', () => {
    const saved = JSON.parse(JSON.stringify(defaultAssumptions)) as Record<string, unknown>;
    delete saved.investments;

    const migrated = migrateAssumptions(saved, defaultAssumptions);

    expect(migrated.investments.withdrawalRateMode).toBe('auto');
  });

  it('preserves an explicitly saved manual mode even at the default rate', () => {
    const saved = JSON.parse(JSON.stringify({
      ...defaultAssumptions,
      investments: { ...legacyInvestments(4.0), withdrawalRateMode: 'manual' },
    }));

    const migrated = migrateAssumptions(saved, defaultAssumptions);

    expect(migrated.investments.withdrawalRateMode).toBe('manual');
  });

  it('preserves an explicitly saved auto mode even with a customized rate', () => {
    const saved = JSON.parse(JSON.stringify({
      ...defaultAssumptions,
      investments: { ...legacyInvestments(6.2), withdrawalRateMode: 'auto' },
    }));

    const migrated = migrateAssumptions(saved, defaultAssumptions);

    expect(migrated.investments.withdrawalRateMode).toBe('auto');
    expect(migrated.investments.withdrawalRate).toBe(6.2);
  });
});
