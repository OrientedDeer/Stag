import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TaxLifeEventsEditor } from '../../../../components/Objects/Taxes/TaxLifeEventsEditor';
import { TaxLifeEvent } from '../../../../components/Objects/Taxes/TaxContext';

const stateOptions = [{ value: 'California', label: 'California' }, { value: 'Texas', label: 'Texas' }];
const filingOptions = [{ value: 'Single', label: 'Single' }, { value: 'Married Filing Jointly', label: 'Married Filing Jointly' }];

function renderEditor(events: TaxLifeEvent[] = []) {
    const onChange = vi.fn();
    render(
        <TaxLifeEventsEditor
            events={events}
            onChange={onChange}
            milestones={[]}
            stateOptions={stateOptions}
            filingOptions={filingOptions}
        />
    );
    return { onChange };
}

describe('TaxLifeEventsEditor', () => {
    it('lists existing events with a human-readable description', () => {
        renderEditor([{ id: 'e1', kind: 'stateResidency', value: 'Texas', year: 2034 }]);
        expect(screen.getByText('Move to Texas in 2034')).toBeInTheDocument();
    });

    it('adds a year-triggered event from the add form defaults', () => {
        const { onChange } = renderEditor();
        fireEvent.click(screen.getByText('+ Add a tax change'));
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        const added = onChange.mock.calls[0][0] as TaxLifeEvent[];
        expect(added).toHaveLength(1);
        expect(added[0].kind).toBe('stateResidency');
        expect(added[0].value).toBe('California'); // first state option default
        expect(added[0].year).toBe(new Date().getFullYear() + 5); // default trigger year
    });

    it('removes an event', () => {
        const { onChange } = renderEditor([{ id: 'e1', kind: 'filingStatus', value: 'Married Filing Jointly', year: 2030 }]);
        fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
        expect(onChange).toHaveBeenCalledWith([]);
    });
});
