import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WithdrawalBucketList, BucketDetail } from '../../../../tabs/Future/withdrawal/WithdrawalBucketList';

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
                formatMoney={fmt}
            />
        );

        expect(screen.queryByText('Tapped age 62 → lasts the rest of the plan')).not.toBeInTheDocument();
        expect(screen.getByText(/Manual withdrawal ordering is disabled/)).toBeInTheDocument();
    });
});
