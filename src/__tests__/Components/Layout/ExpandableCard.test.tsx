import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ExpandableCard } from '../../../components/Layout/ExpandableCard';

/**
 * #141 — the `badge` slot must be visible on the COLLAPSED header (not only after
 * expanding), so an attention condition like a stock grant with no linked account
 * surfaces without the user opening the card. headerContent/headerActions render
 * only when expanded; the badge renders in both states.
 */
function renderCard(badge?: React.ReactNode) {
    return render(
        <ExpandableCard
            name="My Income"
            iconBg="bg-accent-soft"
            iconLabel="I"
            displayValue="$1,000"
            frequencySuffix="/mo"
            headerContent={<span>EXPANDED-ONLY-CONTENT</span>}
            headerActions={<span>EXPANDED-ONLY-ACTION</span>}
            badge={badge}
            ariaLabelType="income"
        >
            <div>body</div>
        </ExpandableCard>
    );
}

describe('ExpandableCard badge slot (#141)', () => {
    it('shows the badge while COLLAPSED, when headerContent/headerActions are not rendered', () => {
        renderCard(<span>NEEDS-ATTENTION</span>);
        // Collapsed by default — the expand control is present, the expanded-only
        // slots are not, but the badge IS.
        expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument();
        expect(screen.queryByText('EXPANDED-ONLY-CONTENT')).not.toBeInTheDocument();
        expect(screen.getByText('NEEDS-ATTENTION')).toBeInTheDocument();
    });

    it('keeps the badge visible after expanding', () => {
        renderCard(<span>NEEDS-ATTENTION</span>);
        fireEvent.click(screen.getByRole('button', { name: /expand/i }));
        expect(screen.getByText('EXPANDED-ONLY-CONTENT')).toBeInTheDocument();
        expect(screen.getByText('NEEDS-ATTENTION')).toBeInTheDocument();
    });

    it('renders no badge element when none is provided', () => {
        renderCard(undefined);
        expect(screen.queryByText('NEEDS-ATTENTION')).not.toBeInTheDocument();
    });
});
