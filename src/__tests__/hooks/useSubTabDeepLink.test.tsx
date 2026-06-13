import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useSubTabDeepLink } from '../../hooks/useSubTabDeepLink';

const TABS = ['Monthly', 'Annual', 'Longer term'] as const;

function Probe({ onTab }: { onTab: (tab: string) => void }) {
    useSubTabDeepLink(TABS, onTab);
    const location = useLocation();
    return <div data-testid="search">{location.search}</div>;
}

function renderAt(path: string, onTab: (tab: string) => void) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/page" element={<Probe onTab={onTab} />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('useSubTabDeepLink', () => {
    it('selects the linked tab and removes the param from the URL', () => {
        const onTab = vi.fn();
        const { getByTestId } = renderAt('/page?tab=Longer%20term', onTab);
        expect(onTab).toHaveBeenCalledWith('Longer term');
        expect(getByTestId('search').textContent).toBe('');
    });

    it('ignores unknown tab values but still cleans the URL', () => {
        const onTab = vi.fn();
        const { getByTestId } = renderAt('/page?tab=Nonsense', onTab);
        expect(onTab).not.toHaveBeenCalled();
        expect(getByTestId('search').textContent).toBe('');
    });

    it('does nothing without a tab param (saved-tab persistence wins)', () => {
        const onTab = vi.fn();
        renderAt('/page', onTab);
        expect(onTab).not.toHaveBeenCalled();
    });

    it('preserves unrelated search params while consuming tab', () => {
        const onTab = vi.fn();
        const { getByTestId } = renderAt('/page?other=1&tab=Monthly', onTab);
        expect(onTab).toHaveBeenCalledWith('Monthly');
        expect(getByTestId('search').textContent).toBe('?other=1');
    });
});
