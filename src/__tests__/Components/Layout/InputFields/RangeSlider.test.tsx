import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RangeSlider } from '../../../../components/Layout/InputFields/RangeSlider';

describe('RangeSlider Component', () => {

    it('renders a single slider correctly', () => {
        render(<RangeSlider label="Volume" value={50} onChange={() => {}} />);

        expect(screen.getByLabelText('Volume')).toBeInTheDocument();
        expect(screen.getByText('50')).toBeInTheDocument();
        
        const inputs = screen.getAllByRole('slider');
        expect(inputs).toHaveLength(1);
    });

    it('calls onChange for a single slider', () => {
        const handleChange = vi.fn();
        render(<RangeSlider label="Volume" value={50} onChange={handleChange} />);

        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '75' } });

        expect(handleChange).toHaveBeenCalledWith(75);
    });

    it('renders a dual slider correctly', () => {
        render(<RangeSlider label="Price Range" value={[10, 90]} onChange={() => {}} />);

        expect(screen.getByLabelText('Price Range')).toBeInTheDocument();
        expect(screen.getByText('10 - 90')).toBeInTheDocument();

        const inputs = screen.getAllByRole('slider');
        expect(inputs).toHaveLength(2);
    });

    it('calls onChange for the min handle of a dual slider', () => {
        const handleChange = vi.fn();
        render(<RangeSlider label="Price Range" value={[10, 90]} onChange={handleChange} />);

        const [minSlider] = screen.getAllByRole('slider');
        fireEvent.change(minSlider, { target: { value: '25' } });

        expect(handleChange).toHaveBeenCalledWith([25, 90]);
    });

    it('calls onChange for the max handle of a dual slider', () => {
        const handleChange = vi.fn();
        render(<RangeSlider label="Price Range" value={[10, 90]} onChange={handleChange} />);

        const [, maxSlider] = screen.getAllByRole('slider');
        fireEvent.change(maxSlider, { target: { value: '75' } });

        expect(handleChange).toHaveBeenCalledWith([10, 75]);
    });

    it('uses the formatTooltip function', () => {
        render(<RangeSlider label="Year" value={[2025, 2050]} onChange={() => {}} formatTooltip={(v) => `Year ${v}`} />);

        expect(screen.getByText('Year 2025 - Year 2050')).toBeInTheDocument();
    });
    
    it('visually hides the header when hideHeader is true, but keeps it accessible', () => {
        render(<RangeSlider label="Hidden Label" value={50} onChange={() => {}} hideHeader={true} />);

        // 1. Accessibility Check: Screen readers MUST still find this text.
        const labelText = screen.getByText('Hidden Label');
        expect(labelText).toBeInTheDocument();

        // 2. Visual Check: It should be hidden using the 'sr-only' class.
        // We find the parent container of the label, which has the class applied.
        // The label text is inside a <label>, which is inside the <div> with 'sr-only'.
        const headerContainer = labelText.closest('div');
        expect(headerContainer).toHaveClass('sr-only');
    });

    it('respects min, max, and step props', () => {
        render(<RangeSlider value={5} min={0} max={10} step={1} onChange={() => {}} />);
        const slider = screen.getByRole('slider');
        expect(slider).toHaveAttribute('min', '0');
        expect(slider).toHaveAttribute('max', '10');
        expect(slider).toHaveAttribute('step', '1');
    });
});
