import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WithdrawalBucketList, type BucketDetail } from '../../../../tabs/Future/withdrawal/WithdrawalBucketList';

const noop = () => {};
const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

function makeBucket(over: Partial<BucketDetail>): BucketDetail {
    return {
        id: 'w1',
        name: 'Brokerage',
        accountId: 'acc1',
        account: undefined,
        badge: { label: 'Cap Gains', color: 'bg-accent' },
        balance: 100000,
        ...over,
    };
}

describe('WithdrawalBucketList — burn-order consequence line (D1)', () => {
    it('renders "Tapped age X → depleted age Y" when the sim depletes the account', () => {
        const buckets = [makeBucket({
            timeline: {
                tappedYear: 2040,
                tappedAge: 62,
                depletedYear: 2049,
                depletedAge: 71,
                depletedDrawAmount: 40000,
                depletedBalanceBefore: 35000,
            },
        })];

        render(
            <WithdrawalBucketList
                taxOptimizationEnabled={false}
                buckets={buckets}
                onDragEnd={noop}
                onAutoSort={noop}
                isBusy={false}
                formatMoney={fmt}
            />
        );

        expect(screen.getByText('Tapped age 62 → depleted age 71')).toBeInTheDocument();
    });

    it('says the account lasts the plan when tapped but never depleted', () => {
        const buckets = [makeBucket({
            timeline: { tappedYear: 2040, tappedAge: 62 },
        })];

        render(
            <WithdrawalBucketList
                taxOptimizationEnabled={false}
                buckets={buckets}
                onDragEnd={noop}
                onAutoSort={noop}
                isBusy={false}
                formatMoney={fmt}
            />
        );

        expect(screen.getByText('Tapped age 62 → lasts the rest of the plan')).toBeInTheDocument();
    });

    it('says not tapped when the account is never drawn in the plan', () => {
        const buckets = [makeBucket({ timeline: {} })];

        render(
            <WithdrawalBucketList
                taxOptimizationEnabled={false}
                buckets={buckets}
                onDragEnd={noop}
                onAutoSort={noop}
                isBusy={false}
                formatMoney={fmt}
            />
        );

        expect(screen.getByText('Not tapped within the plan')).toBeInTheDocument();
    });

    it('does not render the order list when tax optimization is enabled', () => {
        const buckets = [makeBucket({ timeline: { tappedYear: 2040, tappedAge: 62 } })];

        render(
            <WithdrawalBucketList
                taxOptimizationEnabled={true}
                buckets={buckets}
                onDragEnd={noop}
                onAutoSort={noop}
                isBusy={false}
                formatMoney={fmt}
            />
        );

        expect(screen.queryByText('Tapped age 62 → lasts the rest of the plan')).not.toBeInTheDocument();
        expect(screen.getByText(/Manual withdrawal ordering is disabled/)).toBeInTheDocument();
    });
});

describe('WithdrawalBucketList — Auto sort button (#154)', () => {
    const twoBuckets = () => [
        makeBucket({ id: 'w1', name: 'Brokerage', accountId: 'acc1' }),
        makeBucket({ id: 'w2', name: 'Savings', accountId: 'acc2' }),
    ];

    function renderList(over: Partial<Parameters<typeof WithdrawalBucketList>[0]>) {
        return render(
            <WithdrawalBucketList
                taxOptimizationEnabled={false}
                buckets={twoBuckets()}
                onDragEnd={noop}
                onAutoSort={noop}
                isBusy={false}
                formatMoney={fmt}
                {...over}
            />
        );
    }

    it('shows the Auto sort button in manual mode and fires onAutoSort on click', () => {
        const onAutoSort = vi.fn();
        renderList({ onAutoSort });
        const btn = screen.getByRole('button', { name: /auto sort/i });
        fireEvent.click(btn);
        expect(onAutoSort).toHaveBeenCalledTimes(1);
    });

    it('disables the button and shows "Sorting…" while busy', () => {
        renderList({ isBusy: true });
        const btn = screen.getByRole('button', { name: /sorting/i });
        expect(btn).toBeDisabled();
    });

    it('hides the button when Tax Optimization owns the order', () => {
        renderList({ taxOptimizationEnabled: true });
        expect(screen.queryByRole('button', { name: /auto sort/i })).not.toBeInTheDocument();
    });

    it('hides the button when there is nothing to sort (≤1 account)', () => {
        renderList({ buckets: [makeBucket({ id: 'w1', accountId: 'acc1' })] });
        expect(screen.queryByRole('button', { name: /auto sort/i })).not.toBeInTheDocument();
    });
});
