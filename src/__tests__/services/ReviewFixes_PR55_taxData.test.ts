import { describe, it, expect } from 'vitest';
import { TAX_DATABASE } from '../../data/TaxData';

// PR#55 #3: The 2024 federal Single brackets previously used the IRS "+1"
// convention (47151/100526/191951/243726) while the model treats `threshold`
// as a continuous breakpoint (bracket walk uses `> current.threshold`). Every
// other row (2024 MFS, 2025/2026 Single) uses the plain breakpoint value, so
// 2024 Single was the lone outlier with each boundary $1 too high.
describe('PR#55 #3 — 2024 Single federal brackets use breakpoint convention', () => {
  it('2024 Single thresholds equal the breakpoint values', () => {
    const thresholds = TAX_DATABASE.federal[2024].Single.brackets.map((b) => b.threshold);
    expect(thresholds).toEqual([0, 11600, 47150, 100525, 191950, 243725, 609350]);
  });

  it('2024 Single and MFS share identical 22%/24%/32%/35% thresholds', () => {
    const single = TAX_DATABASE.federal[2024].Single.brackets;
    const mfs = TAX_DATABASE.federal[2024]['Married Filing Separately'].brackets;

    // The two rows differ only in the top 37% bracket; the 22/24/32/35 rate
    // boundaries should be identical.
    const sharedRates = [0.22, 0.24, 0.32, 0.35];
    for (const rate of sharedRates) {
      const s = single.find((b) => b.rate === rate)?.threshold;
      const m = mfs.find((b) => b.rate === rate)?.threshold;
      expect(s).toBe(m);
    }
  });
});
