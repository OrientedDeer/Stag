import { describe, it, expect } from 'vitest';
import {
  migrateAssumptions,
  defaultAssumptions,
} from '../../../../components/Objects/Assumptions/AssumptionsContext';

/**
 * P5 — `display.showDevTools` persistence migration.
 *
 * Saved data written before the flag existed has a `display` section without
 * `showDevTools`. migrateAssumptions/mergeSection must fill in the default
 * (false) rather than leaving it undefined, and must preserve an explicit
 * saved value.
 */
describe('migrateAssumptions — display.showDevTools', () => {
  // A pre-flag display section, exactly as old localStorage would have it.
  const legacyDisplay = {
    useCompactCurrency: false,
    showExperimentalFeatures: true,
    hsaEligible: false,
  };

  it('defaults showDevTools to false when missing from saved display settings', () => {
    const saved = JSON.parse(JSON.stringify({ ...defaultAssumptions, display: legacyDisplay }));
    expect(saved.display.showDevTools).toBeUndefined();

    const migrated = migrateAssumptions(saved, defaultAssumptions);

    expect(migrated.display.showDevTools).toBe(false);
    // The rest of the saved display section survives the merge untouched.
    expect(migrated.display.useCompactCurrency).toBe(false);
    expect(migrated.display.showExperimentalFeatures).toBe(true);
    expect(migrated.display.hsaEligible).toBe(false);
  });

  it('preserves an explicitly saved showDevTools=true', () => {
    const saved = JSON.parse(JSON.stringify({
      ...defaultAssumptions,
      display: { ...legacyDisplay, showDevTools: true },
    }));

    const migrated = migrateAssumptions(saved, defaultAssumptions);

    expect(migrated.display.showDevTools).toBe(true);
  });

  it('defaults showDevTools to false when the whole display section is missing', () => {
    const saved = JSON.parse(JSON.stringify(defaultAssumptions)) as Record<string, unknown>;
    delete saved.display;

    const migrated = migrateAssumptions(saved, defaultAssumptions);

    expect(migrated.display.showDevTools).toBe(false);
  });
});
