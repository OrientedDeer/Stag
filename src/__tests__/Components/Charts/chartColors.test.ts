/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { resolveColor } from '../../../components/Charts/chartColors';

// Regression for the default-theme sunbursts rendering black: tokens are
// authored in oklch(), which d3-color (Nivo's childColor brighter/darker +
// contrast labels) cannot parse. resolveColor must hand back an rgb() string.
describe('resolveColor: oklch → rgb (default-theme chart colors)', () => {
  it('converts an oklch() string to a non-black, d3-parseable rgb()', () => {
    // ~blue-500 (the --c-accent-soft token used by "Invested"/"Utilities").
    const out = resolveColor('oklch(0.623 0.214 259.815)');
    expect(out).toMatch(/^rgb\(/);
    const [r, g, b] = out.match(/\d+/g)!.map(Number);
    expect(r + g + b).toBeGreaterThan(30); // not black
    expect(b).toBeGreaterThan(r); // blue-dominant
  });

  it('accepts percent lightness and an alpha channel', () => {
    const out = resolveColor('oklch(62.3% 0.214 259.815 / 0.5)');
    expect(out).toMatch(/^rgba\(.*0\.5\)$/);
  });

  it('passes rgb/hex through untouched (already d3-parseable)', () => {
    expect(resolveColor('#ffc030')).toBe('#ffc030');
    expect(resolveColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
  });

  it('falls back to a grey for an empty value rather than throwing', () => {
    expect(resolveColor(undefined)).toBe('#888888');
  });
});
