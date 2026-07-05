import { useContext, useMemo, useState } from 'react';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { formatCurrency } from '../../components/Objects/Budget/budgetUtils';
import { DateInput } from '../../components/Layout/InputFields/DateInput';
import { CurrencyInput } from '../../components/Layout/InputFields/CurrencyInput';
import { DropdownInput } from '../../components/Layout/InputFields/DropdownInput';
import { AlertBanner } from '../../components/Layout/AlertBanner';
import { computeStatementCompare, getKnownSources, statementDateOf } from './reconcile/reconcileUtils';

type CompareBasis = 'charges' | 'net';

const BASIS_OPTIONS = [
    { value: 'charges', label: 'New charges (spending only)' },
    { value: 'net', label: 'Net activity (charges − credits)' },
];

/** Money figures match within half a cent. */
const EPSILON = 0.005;

export default function ReconcileTab() {
    const { months } = useContext(BudgetContext);

    const knownSources = useMemo(() => getKnownSources(months), [months]);

    // Default to the first tagged source so results render immediately (rather
    // than flashing the untagged set, which source='' would match).
    const [source, setSource] = useState(() => knownSources[0] ?? '');
    const [startDate, setStartDate] = useState<Date | undefined>(undefined);
    const [endDate, setEndDate] = useState<Date | undefined>(undefined);
    const [statementAmount, setStatementAmount] = useState(0);
    const [basis, setBasis] = useState<CompareBasis>('charges');

    const result = useMemo(
        () => computeStatementCompare(months, { source, start: startDate, end: endDate }),
        [months, source, startDate, endDate],
    );

    const compareValue = basis === 'charges' ? result.charges : result.net;
    const difference = statementAmount - compareValue;
    const matches = Math.abs(difference) < EPSILON;
    const hasStatement = statementAmount > 0;
    const basisLabel = basis === 'charges' ? 'new charges' : 'net activity';
    const rangeInverted = !!startDate && !!endDate && startDate > endDate;

    if (knownSources.length === 0) {
        return (
            <div className="space-y-4">
                <div>
                    <h3 className="text-lg font-semibold text-white">Statement compare</h3>
                    <p className="text-sm text-content-muted">
                        Reconcile a card's transactions against its statement to spot anything missing.
                    </p>
                </div>
                <AlertBanner severity="info" title="No tagged transactions yet">
                    Tag transactions with a source / card first — on CSV import, in the Add/Edit
                    transaction form, or by selecting rows in the Transactions tab and using
                    “Set source.” Once transactions carry a source, pick it here to compare against a
                    statement.
                </AlertBanner>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-white">Statement compare</h3>
                <p className="text-sm text-content-muted">
                    Pick a card and a date range, then enter the total from your statement. If it
                    doesn't match your recorded transactions, you're probably missing some.
                </p>
            </div>

            {/* Controls */}
            <div className="bg-surface-overlay rounded-xl border border-border-default p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <DropdownInput
                    label="Source / card"
                    value={source}
                    onChange={setSource}
                    options={knownSources}
                />
                <DropdownInput
                    label="Compare against"
                    value={basis}
                    onChange={(v) => setBasis(v as CompareBasis)}
                    options={BASIS_OPTIONS}
                />
                <CurrencyInput
                    label="Statement total"
                    value={statementAmount}
                    onChange={setStatementAmount}
                />
                <DateInput label="From" value={startDate} onChange={setStartDate} />
                <DateInput label="To" value={endDate} onChange={setEndDate} />
            </div>

            {rangeInverted && (
                <AlertBanner severity="warning" size="sm">
                    The “From” date is after the “To” date — no transactions will match.
                </AlertBanner>
            )}

            {/* Recorded totals */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryStat label="Charges" value={result.charges} tone="neutral" />
                <SummaryStat label="Credits / payments" value={result.credits} tone="positive" />
                <SummaryStat label="Net activity" value={result.net} tone="neutral" />
                <div className="bg-surface-overlay rounded-xl border border-border-default p-3">
                    <div className="text-xs text-content-subtle">Transactions</div>
                    <div className="text-lg font-semibold text-white mt-1">{result.count}</div>
                </div>
            </div>

            {/* Verdict */}
            {!hasStatement ? (
                <AlertBanner severity="info" size="sm">
                    Enter your statement total above to compare it against your recorded {basisLabel} of{' '}
                    {formatCurrency(compareValue, { cents: true })}.
                </AlertBanner>
            ) : matches ? (
                <AlertBanner severity="success" title="Matches">
                    Your recorded {basisLabel} ({formatCurrency(compareValue, { cents: true })}) equals
                    your statement total. Nothing appears to be missing.
                </AlertBanner>
            ) : (
                <AlertBanner
                    severity="warning"
                    title={`Off by ${formatCurrency(Math.abs(difference), { cents: true })}`}
                >
                    {difference > 0 ? (
                        <>
                            Your statement is {formatCurrency(difference, { cents: true })} higher than your
                            recorded {basisLabel} ({formatCurrency(compareValue, { cents: true })}). You may
                            be missing transactions worth about {formatCurrency(difference, { cents: true })}.
                        </>
                    ) : (
                        <>
                            Your recorded {basisLabel} ({formatCurrency(compareValue, { cents: true })}) is{' '}
                            {formatCurrency(-difference, { cents: true })} higher than your statement total.
                            You may have extra or duplicated transactions.
                        </>
                    )}
                </AlertBanner>
            )}

            {/* Matched transactions */}
            <div className="bg-surface-overlay rounded-xl border border-border-default overflow-hidden">
                <div className="px-4 py-2 border-b border-border-default flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                        {source ? `“${source}” transactions` : 'Transactions'}
                        {(startDate || endDate) && (
                            <span className="text-content-subtle font-normal ml-2">
                                {startDate ? startDate.toLocaleDateString() : '…'} –{' '}
                                {endDate ? endDate.toLocaleDateString() : '…'}
                            </span>
                        )}
                    </span>
                    <span className="text-sm text-content-muted">{result.count} shown</span>
                </div>
                {result.count === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-content-muted">
                        No transactions tagged “{source}” in this range.
                    </div>
                ) : (
                    <div className="divide-y divide-border-default max-h-96 overflow-y-auto custom-scrollbar">
                        {result.transactions.map((t) => (
                            <div key={t.id} className="px-4 py-2 flex items-center gap-4 text-sm">
                                {/* #163: the statement axis (posted ?? date) — what the window
                                    filters/sorts on — with the swipe date noted when it differs. */}
                                <span className="w-16 text-content-muted">
                                    {statementDateOf(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </span>
                                {t.postedDate && (
                                    <span className="text-xs text-content-muted whitespace-nowrap">
                                        txn {new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </span>
                                )}
                                <span className="flex-1 text-white truncate">{t.description}</span>
                                <span className={t.amount > 0 ? 'text-positive font-medium' : 'text-white font-medium'}>
                                    {t.amount > 0 ? '+' : ''}{formatCurrency(Math.abs(t.amount), { cents: true })}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function SummaryStat({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone: 'neutral' | 'positive';
}) {
    return (
        <div className="bg-surface-overlay rounded-xl border border-border-default p-3">
            <div className="text-xs text-content-subtle">{label}</div>
            <div className={`text-lg font-semibold mt-1 ${tone === 'positive' ? 'text-positive' : 'text-white'}`}>
                {formatCurrency(value, { cents: true })}
            </div>
        </div>
    );
}
