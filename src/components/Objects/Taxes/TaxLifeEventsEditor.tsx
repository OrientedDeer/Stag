import { type ReactElement, useState } from 'react';
import { type TaxLifeEvent } from './TaxContext';
import { type CustomMilestone } from '../../../services/simulation/types';
import { DropdownInput } from '../../Layout/InputFields/DropdownInput';
import { TriggerSelector } from '../../Layout/InputFields/TriggerSelector';
import { Button } from '../../Layout/Primitives';

interface Props {
    events: TaxLifeEvent[];
    onChange: (events: TaxLifeEvent[]) => void;
    milestones: CustomMilestone[];
    stateOptions: { value: string; label: string }[];
    filingOptions: { value: string; label: string }[];
}

type Kind = 'stateResidency' | 'filingStatus';

/**
 * Editor for scheduled tax changes — "move to TX in 2034", "filing status →
 * Single when I retire". Each event has a kind, a new value, and a trigger
 * (a fixed year via the date picker, or a milestone). Year-granular: the date
 * picker's year is what's stored.
 */
export function TaxLifeEventsEditor({ events, onChange, milestones, stateOptions, filingOptions }: Props): ReactElement {
    const [adding, setAdding] = useState(false);
    const [kind, setKind] = useState<Kind>('stateResidency');
    const [value, setValue] = useState<string>(stateOptions[0]?.value ?? '');
    const [triggerDate, setTriggerDate] = useState<Date | undefined>(() => new Date(new Date().getFullYear() + 5, 0, 1));
    const [triggerMilestoneId, setTriggerMilestoneId] = useState<string | undefined>(undefined);

    const valueOptions = kind === 'stateResidency' ? stateOptions : filingOptions;
    const milestoneName = (id?: string) => milestones.find(m => m.id === id)?.name ?? 'a milestone';

    const describe = (e: TaxLifeEvent): string => {
        const what = e.kind === 'stateResidency' ? `Move to ${e.value}` : `Filing → ${e.value}`;
        const when = e.year !== undefined ? `in ${e.year}` : `at ${milestoneName(e.milestoneId)}`;
        return `${what} ${when}`;
    };

    const resetForm = () => {
        setAdding(false);
        setKind('stateResidency');
        setValue(stateOptions[0]?.value ?? '');
        setTriggerDate(new Date(new Date().getFullYear() + 5, 0, 1));
        setTriggerMilestoneId(undefined);
    };

    const onKindChange = (k: string) => {
        const next = k as Kind;
        setKind(next);
        setValue((next === 'stateResidency' ? stateOptions : filingOptions)[0]?.value ?? '');
    };

    const addEvent = () => {
        if (!value) return;
        if (!triggerDate && !triggerMilestoneId) return;
        const event: TaxLifeEvent = {
            id: `tax-${Date.now()}`,
            kind,
            value,
            ...(triggerDate ? { year: triggerDate.getFullYear() } : { milestoneId: triggerMilestoneId }),
        };
        onChange([...events, event]);
        resetForm();
    };

    const removeEvent = (id: string) => onChange(events.filter(e => e.id !== id));

    return (
        <div className="space-y-2">
            {events.length > 0 && (
                <ul className="space-y-1">
                    {events.map(e => (
                        <li key={e.id} className="flex items-center justify-between text-sm bg-surface-overlay/40 rounded-md px-3 py-1.5">
                            <span className="text-content-default">{describe(e)}</span>
                            <button
                                type="button"
                                onClick={() => removeEvent(e.id)}
                                aria-label={`Remove ${describe(e)}`}
                                className="text-negative-soft hover:text-negative text-lg leading-none px-1"
                            >
                                ×
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {adding ? (
                <div className="space-y-3 bg-surface-overlay/30 rounded-lg p-3">
                    <DropdownInput
                        label="Change"
                        value={kind}
                        onChange={onKindChange}
                        options={[
                            { value: 'stateResidency', label: 'Move to another state' },
                            { value: 'filingStatus', label: 'Change filing status' },
                        ]}
                    />
                    <DropdownInput
                        label={kind === 'stateResidency' ? 'New state' : 'New filing status'}
                        value={value}
                        onChange={setValue}
                        options={valueOptions}
                    />
                    <TriggerSelector
                        id="tax-event-trigger"
                        label="When"
                        date={triggerDate}
                        milestoneId={triggerMilestoneId}
                        milestones={milestones}
                        onDateChange={(d) => { setTriggerDate(d); if (d) setTriggerMilestoneId(undefined); }}
                        onMilestoneChange={(id) => { setTriggerMilestoneId(id); if (id) setTriggerDate(undefined); }}
                        tooltip="A fixed year (via the date picker — only the year is used) or a milestone."
                    />
                    <div className="flex gap-2 justify-end">
                        <Button onClick={resetForm} variant="secondary" size="sm">Cancel</Button>
                        <Button onClick={addEvent} variant="positive" size="sm" disabled={!value || (!triggerDate && !triggerMilestoneId)}>Add</Button>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="w-full text-xs font-medium text-info hover:text-info-bright transition-colors py-1.5 border border-border-subtle rounded-md hover:bg-surface-overlay/40"
                >
                    + Add a tax change
                </button>
            )}
        </div>
    );
}
