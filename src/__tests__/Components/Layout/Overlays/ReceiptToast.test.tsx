import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { ReceiptToastProvider, useReceiptToast, ReceiptToastOptions } from '../../../../components/Layout/Overlays/ReceiptToast';

/** Button that fires a toast with the given options when clicked. */
const ShowToastButton = ({ options }: { options: ReceiptToastOptions }) => {
    const { show } = useReceiptToast();
    return (
        <button type="button" onClick={() => show(options)}>
            trigger
        </button>
    );
};

const renderWithProvider = (options: ReceiptToastOptions) =>
    render(
        <MemoryRouter>
            <ReceiptToastProvider>
                <ShowToastButton options={options} />
            </ReceiptToastProvider>
        </MemoryRouter>
    );

describe('ReceiptToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows a toast with the message and role="status"', () => {
        renderWithProvider({ message: 'Created something elsewhere' });

        fireEvent.click(screen.getByText('trigger'));

        const toast = screen.getByRole('status');
        expect(toast).toHaveTextContent('Created something elsewhere');
    });

    it('renders a link when linkTo is provided', () => {
        renderWithProvider({
            message: 'Created mortgage expense',
            linkTo: '/current/expense',
            linkLabel: 'Review',
        });

        fireEvent.click(screen.getByText('trigger'));

        const link = screen.getByRole('link', { name: 'Review' });
        expect(link).toHaveAttribute('href', '/current/expense');
    });

    it('defaults the link label to "View"', () => {
        renderWithProvider({ message: 'Created loan expense', linkTo: '/current/expense' });

        fireEvent.click(screen.getByText('trigger'));

        expect(screen.getByRole('link', { name: 'View' })).toBeInTheDocument();
    });

    it('dismisses a toast when the dismiss button is clicked', () => {
        renderWithProvider({ message: 'Dismiss me' });

        fireEvent.click(screen.getByText('trigger'));
        expect(screen.getByRole('status')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Dismiss notification'));
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('auto-dismisses after ~8 seconds', () => {
        renderWithProvider({ message: 'Short lived' });

        fireEvent.click(screen.getByText('trigger'));
        expect(screen.getByRole('status')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(7999);
        });
        expect(screen.getByRole('status')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('stacks toasts, keeping at most 3 (oldest dropped)', () => {
        const Trigger = () => {
            const { show } = useReceiptToast();
            return (
                <button
                    type="button"
                    onClick={() => {
                        show({ message: 'first' });
                        show({ message: 'second' });
                        show({ message: 'third' });
                        show({ message: 'fourth' });
                    }}
                >
                    trigger-many
                </button>
            );
        };
        render(
            <MemoryRouter>
                <ReceiptToastProvider>
                    <Trigger />
                </ReceiptToastProvider>
            </MemoryRouter>
        );

        fireEvent.click(screen.getByText('trigger-many'));

        const toasts = screen.getAllByRole('status');
        expect(toasts).toHaveLength(3);
        expect(screen.queryByText('first')).not.toBeInTheDocument();
        expect(screen.getByText('second')).toBeInTheDocument();
        expect(screen.getByText('third')).toBeInTheDocument();
        expect(screen.getByText('fourth')).toBeInTheDocument();
    });

    it('renders an action button and runs onAction when clicked', () => {
        const onAction = vi.fn();
        renderWithProvider({
            message: 'Deleted "AMAZON" $42.10',
            actionLabel: 'Undo',
            onAction,
        });

        fireEvent.click(screen.getByText('trigger'));

        const undo = screen.getByRole('button', { name: 'Undo' });
        expect(undo).toBeInTheDocument();

        fireEvent.click(undo);
        expect(onAction).toHaveBeenCalledTimes(1);
        // clicking the action also dismisses the toast
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('does not render an action button without onAction', () => {
        renderWithProvider({ message: 'No action', actionLabel: 'Undo' });

        fireEvent.click(screen.getByText('trigger'));

        expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    });

    it('is a no-op outside the provider (default context)', () => {
        const Standalone = () => {
            const { show } = useReceiptToast();
            return (
                <button type="button" onClick={() => show({ message: 'nowhere' })}>
                    trigger
                </button>
            );
        };
        render(<Standalone />);

        expect(() => fireEvent.click(screen.getByText('trigger'))).not.toThrow();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
