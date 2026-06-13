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

    /**
     * Bug #7: editor can add a no-op tax event.
     *
     * When there is no valid value to commit (stateOptions and filingOptions are
     * both empty, so value='' on the first render of the add form), the "Add"
     * button must be disabled so the user gets clear feedback that no event can
     * be saved.  Before the fix the Button had no disabled prop — it looked
     * clickable even though addEvent returned early — so toBeDisabled() failed.
     * After the fix, disabled={!value || (!triggerDate && !triggerMilestoneId)}
     * evaluates to true and the button carries the HTML disabled attribute.
     *
     * Approach: disabled-button fallback (documented).  Toggling TriggerSelector
     * into a state where both triggerDate AND triggerMilestoneId are undefined is
     * not achievable in jsdom because TriggerSelector's handleModeChange always
     * calls onMilestoneChange(defaultMilestoneId) when switching to milestone
     * mode, so the milestoneId is never left undefined by the component itself.
     * The !value branch of the disabled condition is therefore the reliable test
     * surface: it fires when there are no options to choose from, produces a
     * disabled button (not just a silently no-op click), and correctly represents
     * the intent — the button should be visually inert whenever nothing valid
     * can be committed.
     */
    it('disables the Add button when there is no valid value to commit', () => {
        const onChange = vi.fn();
        render(
            <TaxLifeEventsEditor
                events={[]}
                onChange={onChange}
                milestones={[]}
                stateOptions={[]}   // no states → value defaults to ''
                filingOptions={[]}
            />
        );

        fireEvent.click(screen.getByText('+ Add a tax change'));

        const addButton = screen.getByRole('button', { name: 'Add' });
        // The Add button must be disabled — clicking it should not create a
        // no-op event with an empty value.
        expect(addButton).toBeDisabled();

        // Confirm onChange is also not called even if addEvent fires.
        fireEvent.click(addButton);
        expect(onChange).not.toHaveBeenCalled();
    });
});
