import { describe, it, expect } from 'vitest';
import { normalizeForDirtyCheck, hashBackupForDirtyCheck, cloudIsNewerThanLocal } from '../../../../components/Objects/CloudBackup/CloudBackupContext';
import type { PersistedMeta } from '../../../../components/Objects/CloudBackup/CloudBackupContext';
import type { BackupMetadata } from '../../../../services/cloud/CloudBackupService';

const meta = (over: Partial<BackupMetadata> = {}): BackupMetadata =>
    ({ exists: true, timestamp: '2026-06-04T12:00:00Z', size: 100, rev: '3-abc', ...over });
const local = (over: Partial<PersistedMeta> = {}): PersistedMeta =>
    ({ lastBackupTimestamp: '2026-06-04T12:00:00Z', linkedEmail: 'x@y.z', lastBackupHash: 'h', lastRev: '3-abc', ...over });

// Minimal backup-shaped payload with the assumptions.display block that carries
// both presentation-only prefs and the real-data hsaEligible flag.
const basePayload = () => ({
    version: 2,
    accounts: [{ id: '1', amount: 1000 }],
    assumptions: {
        macro: { inflationRate: 2.6 },
        display: {
            useCompactCurrency: false,
            showExperimentalFeatures: false,
            hsaEligible: true,
        },
    },
    budget: { months: [], importSettings: {} },
});

describe('normalizeForDirtyCheck', () => {
    it('ignores presentation-only display toggles', () => {
        const a = basePayload();
        const b = basePayload();
        b.assumptions.display.useCompactCurrency = true;
        b.assumptions.display.showExperimentalFeatures = true;

        // Same data, only display prefs differ -> identical normalized output.
        expect(normalizeForDirtyCheck(a)).toBe(normalizeForDirtyCheck(b));
    });

    it('still reflects hsaEligible changes (real math input, not presentation)', () => {
        const a = basePayload();
        const b = basePayload();
        b.assumptions.display.hsaEligible = false;

        expect(normalizeForDirtyCheck(a)).not.toBe(normalizeForDirtyCheck(b));
    });

    it('still reflects real data changes', () => {
        const a = basePayload();
        const b = basePayload();
        b.accounts[0].amount = 2000;

        expect(normalizeForDirtyCheck(a)).not.toBe(normalizeForDirtyCheck(b));
    });

    it('treats a serialized string and the live object identically', () => {
        const obj = basePayload();
        expect(normalizeForDirtyCheck(JSON.stringify(obj))).toBe(normalizeForDirtyCheck(obj));
    });

    it('does not mutate its input', () => {
        const obj = basePayload();
        normalizeForDirtyCheck(obj);
        expect(obj.assumptions.display.useCompactCurrency).toBe(false);
        expect(obj.assumptions.display).toHaveProperty('showExperimentalFeatures');
    });

    it('handles payloads without an assumptions.display block', () => {
        const obj = { version: 2, accounts: [] };
        expect(() => normalizeForDirtyCheck(obj)).not.toThrow();
        expect(normalizeForDirtyCheck(obj)).toBe(JSON.stringify(obj));
    });

    it('falls back to the raw input on invalid JSON', () => {
        expect(normalizeForDirtyCheck('not json')).toBe('not json');
    });
});

describe('hashBackupForDirtyCheck', () => {
    it('produces the same hash when only display prefs differ', async () => {
        const a = basePayload();
        const b = basePayload();
        b.assumptions.display.useCompactCurrency = true;

        const [ha, hb] = await Promise.all([
            hashBackupForDirtyCheck(a),
            hashBackupForDirtyCheck(JSON.stringify(b)),
        ]);
        expect(ha).toBe(hb);
    });
});

describe('cloudIsNewerThanLocal', () => {
    it('does not prompt when the cloud rev matches what we last synced', () => {
        expect(cloudIsNewerThanLocal(meta({ rev: '3-abc' }), local({ lastRev: '3-abc' }))).toBe(false);
    });

    it('prompts when the cloud rev differs (another device pushed)', () => {
        expect(cloudIsNewerThanLocal(meta({ rev: '5-def' }), local({ lastRev: '3-abc' }))).toBe(true);
    });

    it('never prompts when no cloud backup exists', () => {
        expect(cloudIsNewerThanLocal(meta({ exists: false }), local())).toBe(false);
    });

    it('prompts when this device has never synced but the cloud has data', () => {
        expect(cloudIsNewerThanLocal(meta(), local({ lastRev: null, lastBackupTimestamp: null }))).toBe(true);
    });

    it('falls back to timestamps when revs are unavailable', () => {
        // Cloud newer than local -> prompt.
        expect(cloudIsNewerThanLocal(
            meta({ rev: null, timestamp: '2026-06-04T13:00:00Z' }),
            local({ lastRev: null, lastBackupTimestamp: '2026-06-04T12:00:00Z' }),
        )).toBe(true);
        // Cloud same-or-older than local -> no prompt.
        expect(cloudIsNewerThanLocal(
            meta({ rev: null, timestamp: '2026-06-04T11:00:00Z' }),
            local({ lastRev: null, lastBackupTimestamp: '2026-06-04T12:00:00Z' }),
        )).toBe(false);
    });
});
