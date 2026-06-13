import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DateInput } from '../../../../components/Layout/InputFields/DateInput';

// Helpers to grab the three segments by their accessible labels.
const month = (): HTMLInputElement => screen.getByLabelText('MM') as HTMLInputElement;
const day = (): HTMLInputElement => screen.getByLabelText('DD') as HTMLInputElement;
const year = (): HTMLInputElement => screen.getByLabelText('YYYY') as HTMLInputElement;

describe('DateInput', () => {
    it('renders three segments with placeholders when value is undefined', () => {
        render(<DateInput label="Trigger" value={undefined} onChange={() => {}} />);
        expect(month().value).toBe('');
        expect(day().value).toBe('');
        expect(year().value).toBe('');
    });

    it('renders an existing date using LOCAL accessors', () => {
        // 2026-06-09 local. getMonth() is zero-based -> month 6.
        render(<DateInput label="Trigger" value={new Date(2026, 5, 9)} onChange={() => {}} />);
        expect(month().value).toBe('6');
        expect(day().value).toBe('9');
        expect(year().value).toBe('2026');
    });

    it('only fires onChange once all segments form a complete valid date', () => {
        const onChange = vi.fn();
        render(<DateInput label="Trigger" value={undefined} onChange={onChange} />);

        fireEvent.change(month(), { target: { value: '6' } });
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(day(), { target: { value: '9' } });
        expect(onChange).not.toHaveBeenCalled();

        // Partial year must not fire (this is the native-picker ejection bug).
        fireEvent.change(year(), { target: { value: '2' } });
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(year(), { target: { value: '20' } });
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(year(), { target: { value: '202' } });
        expect(onChange).not.toHaveBeenCalled();

        fireEvent.change(year(), { target: { value: '2026' } });
        expect(onChange).toHaveBeenCalledTimes(1);
        const got = onChange.mock.calls[0][0] as Date;
        expect(got.getFullYear()).toBe(2026);
        expect(got.getMonth()).toBe(5);
        expect(got.getDate()).toBe(9);
    });

    it('types a 4-digit year without the field resetting mid-entry', () => {
        const onChange = vi.fn();
        render(<DateInput label="Trigger" value={undefined} onChange={onChange} />);
        fireEvent.change(month(), { target: { value: '12' } });
        fireEvent.change(day(), { target: { value: '25' } });
        // Each keystroke leaves the prior digits intact (no controlled-reset eject).
        fireEvent.change(year(), { target: { value: '1' } });
        expect(year().value).toBe('1');
        fireEvent.change(year(), { target: { value: '19' } });
        expect(year().value).toBe('19');
        fireEvent.change(year(), { target: { value: '199' } });
        expect(year().value).toBe('199');
        fireEvent.change(year(), { target: { value: '1999' } });
        expect(year().value).toBe('1999');
        expect(onChange).toHaveBeenLastCalledWith(expect.any(Date));
    });

    it('does not fire onChange for an impossible date (Feb 30)', () => {
        const onChange = vi.fn();
        render(<DateInput label="Trigger" value={undefined} onChange={onChange} />);
        fireEvent.change(month(), { target: { value: '2' } });
        fireEvent.change(day(), { target: { value: '30' } });
        fireEvent.change(year(), { target: { value: '2026' } });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('strips non-digit characters from input', () => {
        render(<DateInput label="Trigger" value={undefined} onChange={() => {}} />);
        fireEvent.change(month(), { target: { value: 'a1b' } });
        expect(month().value).toBe('1');
    });

    it('arrow up increments the focused segment and fires when complete', () => {
        const onChange = vi.fn();
        render(<DateInput label="Trigger" value={new Date(2026, 5, 9)} onChange={onChange} />);
        const m = month();
        m.focus();
        fireEvent.keyDown(m, { key: 'ArrowUp' });
        expect(month().value).toBe('7');
        expect(onChange).toHaveBeenLastCalledWith(expect.any(Date));
        expect((onChange.mock.calls.at(-1)![0] as Date).getMonth()).toBe(6);
    });

    it('arrow up wraps month past 12 back to 1', () => {
        const onChange = vi.fn();
        render(<DateInput label="Trigger" value={new Date(2026, 11, 9)} onChange={onChange} />);
        const m = month();
        m.focus();
        fireEvent.keyDown(m, { key: 'ArrowUp' });
        expect(month().value).toBe('1');
    });

    // Run this with `TZ=Asia/Tokyo npx vitest run <this file>` to prove the
    // round-trip carries no UTC off-by-one east of GMT. The assertions below hold
    // in every timezone because the component constructs/reads dates with LOCAL
    // accessors only — under TZ=Asia/Tokyo a UTC parse would yield Dec 31 2025
    // for a Jan 1 2026 entry, and this test would catch that regression.
    it('round-trips a date with no timezone shift', () => {
        const onChange = vi.fn();
        render(<DateInput label="Trigger" value={undefined} onChange={onChange} />);
        fireEvent.change(month(), { target: { value: '1' } });
        fireEvent.change(day(), { target: { value: '1' } });
        fireEvent.change(year(), { target: { value: '2026' } });
        const got = onChange.mock.calls.at(-1)![0] as Date;
        // Jan 1 2026, not Dec 31 2025 (which is what a UTC parse would give east of GMT).
        expect(got.getFullYear()).toBe(2026);
        expect(got.getMonth()).toBe(0);
        expect(got.getDate()).toBe(1);

        // And the same Date renders back into the same segments.
        render(<DateInput label="Echo" value={got} onChange={() => {}} />);
        const echoYear = screen.getAllByLabelText('YYYY').at(-1) as HTMLInputElement;
        const echoMonth = screen.getAllByLabelText('MM').at(-1) as HTMLInputElement;
        const echoDay = screen.getAllByLabelText('DD').at(-1) as HTMLInputElement;
        expect(echoMonth.value).toBe('1');
        expect(echoDay.value).toBe('1');
        expect(echoYear.value).toBe('2026');
    });
});
