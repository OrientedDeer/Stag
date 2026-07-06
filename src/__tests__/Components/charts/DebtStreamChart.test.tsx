/**
 * #190: DebtStreamChart's rich per-year loan-breakdown tooltip never rendered.
 * @nivo/stream calls the per-datum `tooltip` with `{ layer }` and the whole-slice
 * tooltip with `{ slice }` (carrying `.index`). The chart wired its breakdown as
 * `tooltip={CustomTooltip}` where CustomTooltip read `{ index }`, so it always got
 * `undefined` → `trimmedData[undefined]` → null, and users saw nivo's generic
 * default. The `: any` on the tooltip arg hid the mismatch.
 *
 * Fixed to mirror AssetsStreamChart: enableStackTooltip + stackTooltip={CustomTooltip}
 * (reading slice.index) and tooltip={() => null}.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';

// Capture the props handed to the stream so we can exercise its tooltip wiring.
let captured: Record<string, unknown> = {};
vi.mock('@nivo/stream', () => ({
    ResponsiveStream: (props: Record<string, unknown>) => {
        captured = props;
        return <div data-testid="mock-stream" />;
    },
}));

import { DebtStreamChart } from '../../../components/Charts/DebtStreamChart';

const data = [
    { year: 2026, Mortgage: 300000, 'Car Loan': 20000 },
    { year: 2027, Mortgage: 285000, 'Car Loan': 15000 },
];
const keys = ['Mortgage', 'Car Loan'];

describe('DebtStreamChart tooltip wiring (#190)', () => {
    it('registers a stack tooltip (not the dead per-layer tooltip) that renders the year breakdown', () => {
        render(<DebtStreamChart data={data} keys={keys} />);

        // The whole-slice tooltip is the one nivo actually invokes for the hover card.
        expect(captured.enableStackTooltip).toBe(true);
        expect(typeof captured.stackTooltip).toBe('function');
        // The per-layer tooltip is silenced.
        const perLayer = captured.tooltip as (arg: unknown) => unknown;
        expect(typeof perLayer).toBe('function');
        expect(perLayer({ layer: {} })).toBeNull();

        // Exercise the stack tooltip with the slice shape nivo really passes.
        const StackTip = captured.stackTooltip as (arg: { slice: { index: number } }) => ReactElement;
        const Tip = () => StackTip({ slice: { index: 1 } });
        render(<Tip />);

        // 2027 slice: year header + both loans in the breakdown.
        expect(screen.getByText('2027')).toBeInTheDocument();
        expect(screen.getByText('Mortgage')).toBeInTheDocument();
        expect(screen.getByText('Car Loan')).toBeInTheDocument();
    });
});
