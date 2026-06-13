/**
 * Regression: opening the dropdown with the KEYBOARD must position (and thus
 * render) the options panel.
 *
 * The options panel only renders once `dropdownPosition` is computed, and that
 * computation used to live solely in the button's `onClick`. Headless UI opens
 * its listbox from `keydown` (Space/Enter/Arrows) and preventDefaults the key,
 * so the synthetic click never fired for keyboard users — the chevron rotated
 * to "open" but the panel had no position and never appeared. The button now
 * also computes the position on those keydowns.
 *
 * Headless UI's listbox state machine can't be driven open by jsdom synthetic
 * events, so we can't assert the panel end-to-end here. Instead we assert the
 * fix's mechanism: a keyboard open triggers the same position measurement a
 * click does (a measurement that was absent before the fix).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CustomDropdown } from '../../../components/Layout/InputFields/CustomDropdown';

describe('CustomDropdown keyboard opening', () => {
    function setup() {
        const onChange = vi.fn();
        render(
            <CustomDropdown
                label="Account Type"
                value="Savings"
                onChange={onChange}
                options={['Savings', 'Property', 'Debt']}
            />
        );
        const button = screen.getByRole('button');
        // Spy on the position measurement the fix relies on.
        const measure = vi.spyOn(button, 'getBoundingClientRect');
        return { button, measure };
    }

    it.each([' ', 'Enter', 'ArrowDown', 'ArrowUp'])(
        'measures the button position when opened with %s (so the panel can render)',
        (key) => {
            const { button, measure } = setup();
            button.focus();
            fireEvent.keyDown(button, { key });
            expect(measure).toHaveBeenCalled();
        }
    );

    it('does not measure on an unrelated key (e.g. Tab moves focus away)', () => {
        const { button, measure } = setup();
        button.focus();
        fireEvent.keyDown(button, { key: 'Tab' });
        expect(measure).not.toHaveBeenCalled();
    });

    it('still measures on click (the original mouse path is unbroken)', () => {
        const { button, measure } = setup();
        fireEvent.click(button);
        expect(measure).toHaveBeenCalled();
    });
});
