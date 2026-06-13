import React, { useEffect, useRef, useState } from 'react';
import { Tooltip } from './Tooltip';

interface DateInputProps {
    label?: string;
    /**
     * The current value. Date-only — constructed/read with LOCAL accessors so it
     * never shifts a day across timezones (never via toISOString/UTC parsing).
     */
    value: Date | undefined;
    /**
     * Fires only when all three segments form a complete, valid date — partial
     * or invalid input (e.g. mid-typing a year, or 02/30) never fires a change.
     */
    onChange: (date: Date) => void;
    id?: string;
    tooltip?: string;
    error?: string;
    disabled?: boolean;
    /** Autofocus the month segment on mount (e.g. when revealed in a popup). */
    autoFocus?: boolean;
}

type Segment = 'month' | 'day' | 'year';

interface SegmentState {
    month: string;
    day: string;
    year: string;
}

const EMPTY: SegmentState = { month: '', day: '', year: '' };

// Pull the LOCAL month/day/year out of a Date into segment strings (no padding
// while editing; padding is applied on blur for display only).
function dateToSegments(date: Date | undefined): SegmentState {
    if (!date || isNaN(date.getTime())) return EMPTY;
    return {
        month: String(date.getMonth() + 1),
        day: String(date.getDate()),
        year: String(date.getFullYear()),
    };
}

// Build a LOCAL-midnight Date from segments, or undefined if the segments don't
// describe a real calendar date. Constructed with new Date(y, m-1, d) — never
// from a 'YYYY-MM-DD' string — to avoid the UTC off-by-one.
function segmentsToDate(seg: SegmentState): Date | undefined {
    const m = Number(seg.month);
    const d = Number(seg.day);
    const y = Number(seg.year);
    if (!seg.month || !seg.day || !seg.year) return undefined;
    if (seg.year.length < 4) return undefined; // year still being typed
    if (m < 1 || m > 12) return undefined;
    if (d < 1 || d > 31) return undefined;
    if (y < 1) return undefined;
    const date = new Date(y, m - 1, d);
    // Reject overflow (e.g. Feb 30 rolls forward to March) by round-tripping.
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
        return undefined;
    }
    return date;
}

const SEGMENT_ORDER: Segment[] = ['month', 'day', 'year'];
const MAX_LEN: Record<Segment, number> = { month: 2, day: 2, year: 4 };
const MAX_VAL: Record<Segment, number> = { month: 12, day: 31, year: 9999 };
const PLACEHOLDER: Record<Segment, string> = { month: 'MM', day: 'DD', year: 'YYYY' };

export const DateInput: React.FC<DateInputProps> = ({
    label,
    value,
    onChange,
    id,
    tooltip,
    error,
    disabled,
    autoFocus,
}) => {
    const [segments, setSegments] = useState<SegmentState>(() => dateToSegments(value));
    const refs: Record<Segment, React.RefObject<HTMLInputElement | null>> = {
        month: useRef<HTMLInputElement>(null),
        day: useRef<HTMLInputElement>(null),
        year: useRef<HTMLInputElement>(null),
    };

    // Mirror external value changes, but don't clobber the segments the user is
    // mid-editing when the parent hasn't received a complete date yet. We only
    // resync when the prop describes a different complete date than what's shown.
    useEffect(() => {
        const current = segmentsToDate(segments);
        const sameAsProp =
            (!value && !current) ||
            (value && current && value.getTime() === current.getTime());
        if (!sameAsProp) {
            setSegments(dateToSegments(value));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    useEffect(() => {
        if (autoFocus) refs.month.current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoFocus]);

    const commit = (next: SegmentState): void => {
        const date = segmentsToDate(next);
        if (date) onChange(date);
    };

    const focusSegment = (seg: Segment, select = true): void => {
        const el = refs[seg].current;
        if (!el) return;
        el.focus();
        if (select) el.select();
    };

    const moveTo = (seg: Segment, delta: 1 | -1): void => {
        const idx = SEGMENT_ORDER.indexOf(seg) + delta;
        const target = SEGMENT_ORDER[idx];
        if (target) focusSegment(target);
    };

    const handleChange = (seg: Segment) => (e: React.ChangeEvent<HTMLInputElement>): void => {
        // Keep digits only so the field never holds intermediate junk.
        const raw = e.target.value.replace(/\D/g, '').slice(0, MAX_LEN[seg]);
        const next = { ...segments, [seg]: raw };
        setSegments(next);
        commit(next);

        // Auto-advance once a segment is unambiguously full: either it hit its max
        // length, or (for month/day) the value can't accept another digit
        // (e.g. typing "5" for month → can't be 50-something, so jump ahead).
        const num = Number(raw);
        const maxLenReached = raw.length >= MAX_LEN[seg];
        const cannotGrow =
            seg !== 'year' && raw.length > 0 && num * 10 > MAX_VAL[seg];
        if (maxLenReached || cannotGrow) {
            moveTo(seg, 1);
        }
    };

    const handleKeyDown = (seg: Segment) => (e: React.KeyboardEvent<HTMLInputElement>): void => {
        const el = e.currentTarget;

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = e.key === 'ArrowUp' ? 1 : -1;
            const current = Number(segments[seg] || '0');
            const max = MAX_VAL[seg];
            const min = 1;
            let nextNum = current + step;
            if (nextNum > max) nextNum = min;
            if (nextNum < min) nextNum = max;
            const next = { ...segments, [seg]: String(nextNum) };
            setSegments(next);
            commit(next);
            return;
        }

        if (e.key === 'ArrowLeft' && el.selectionStart === 0) {
            e.preventDefault();
            moveTo(seg, -1);
            return;
        }

        if (e.key === 'ArrowRight' && el.selectionStart === el.value.length) {
            e.preventDefault();
            moveTo(seg, 1);
            return;
        }

        // Backspace at the start of an empty/at-start segment hops to the previous
        // one so the whole field deletes naturally right-to-left.
        if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
            e.preventDefault();
            moveTo(seg, -1);
            return;
        }

        // A separator keystroke advances to the next segment, like the native picker.
        if (e.key === '/' || e.key === '-' || e.key === '.') {
            e.preventDefault();
            moveTo(seg, 1);
        }
    };

    const handleBlur = (seg: Segment) => (): void => {
        // Pad month/day to two digits on blur for a tidy MM/DD display, but only
        // when there's a value — empty segments stay empty (placeholder shows).
        if ((seg === 'month' || seg === 'day') && segments[seg].length === 1) {
            setSegments(prev => ({ ...prev, [seg]: prev[seg].padStart(2, '0') }));
        }
    };

    const baseId = id ?? label?.toLowerCase().replace(/\s/g, '-');
    const labelId = baseId ? `${baseId}-label` : undefined;

    const segInput = (seg: Segment, width: string): React.ReactElement => (
        <input
            ref={refs[seg]}
            id={baseId ? `${baseId}-${seg}` : undefined}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={PLACEHOLDER[seg]}
            placeholder={PLACEHOLDER[seg]}
            value={segments[seg]}
            disabled={disabled}
            onChange={handleChange(seg)}
            onKeyDown={handleKeyDown(seg)}
            onBlur={handleBlur(seg)}
            onFocus={(e) => e.currentTarget.select()}
            className={`${width} bg-transparent border-none outline-none text-white text-md font-semibold text-center placeholder-content-faint p-0 m-0 disabled:opacity-50`}
        />
    );

    return (
        <div className="flex flex-col">
            <div
                className={`bg-surface-raised border rounded-md px-3 py-2 flex flex-col justify-center focus-within:ring-1 transition-all ${error ? 'border-negative-soft focus-within:ring-negative' : 'border-border-default focus-within:ring-positive-bright'}`}
            >
                {label && (
                    <span
                        id={labelId}
                        className="text-xs sm:text-sm text-content-muted font-medium mb-0.5 uppercase tracking-wide leading-tight flex items-center gap-1.5"
                        title={label}
                    >
                        {label}
                        {tooltip && <Tooltip text={tooltip} />}
                    </span>
                )}
                <div
                    role="group"
                    aria-labelledby={labelId}
                    className="flex items-center text-white text-md font-semibold"
                >
                    {segInput('month', 'w-7')}
                    <span className="text-content-faint select-none">/</span>
                    {segInput('day', 'w-7')}
                    <span className="text-content-faint select-none">/</span>
                    {segInput('year', 'w-12')}
                </div>
            </div>
            {error && <span className="text-negative text-xs mt-1">{error}</span>}
        </div>
    );
};
