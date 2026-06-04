import { createContext } from 'react';
import { BackupMetadata } from '../../../services/cloud/CloudBackupService';

export interface CloudBackupState {
    enabled: boolean;
    isAuthenticated: boolean;
    userEmail: string | null;
    lastBackupTimestamp: string | null;
    backupInProgress: boolean;
    restoreInProgress: boolean;
    checkingAuth: boolean;
    lastError: string | null;
    linkedEmail: string | null;
    lastBackupHash: string | null;
    currentDataHash: string | null;
    justSignedIn: boolean;
}

export interface CloudBackupContextValue extends CloudBackupState {
    signIn: () => Promise<void>;
    signOut: () => void;
    backup: (plaintext: string, passphrase: string) => Promise<void>;
    restore: (passphrase: string) => Promise<string>;
    deleteCloudData: () => Promise<void>;
    checkBackupStatus: () => Promise<BackupMetadata>;
    clearError: () => void;
    updateCurrentDataHash: (hash: string) => void;
    clearLinkedEmail: () => void;
    clearJustSignedIn: () => void;
}

export const BACKUP_META_KEY = 'cloud_backup_meta';

export interface PersistedMeta {
    lastBackupTimestamp: string | null;
    linkedEmail: string | null;
    lastBackupHash: string | null;
    // Last-seen CouchDB _rev of the cloud blob, for optimistic-locking writes.
    lastRev: string | null;
}

export function loadPersistedMeta(): PersistedMeta {
    try {
        const raw = localStorage.getItem(BACKUP_META_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                lastBackupTimestamp: parsed.lastBackupTimestamp ?? null,
                linkedEmail: parsed.linkedEmail ?? null,
                lastBackupHash: parsed.lastBackupHash ?? null,
                lastRev: parsed.lastRev ?? null,
            };
        }
    } catch { /* ignore */ }
    return { lastBackupTimestamp: null, linkedEmail: null, lastBackupHash: null, lastRev: null };
}

export function persistMeta(meta: PersistedMeta): void {
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify(meta));
}

// Decide whether the cloud backup is something this device hasn't already synced to,
// i.e. worth prompting the user to decrypt/restore on sign-in. Signing in when local
// data already matches the cloud should NOT nag — only a genuinely newer/different
// cloud blob (e.g. pushed from another device) should.
export function cloudIsNewerThanLocal(server: BackupMetadata, local: PersistedMeta): boolean {
    if (!server.exists) return false;
    // Never synced on this device, but the cloud has data -> offer it.
    if (!local.lastRev && !local.lastBackupTimestamp) return true;
    // Preferred signal: the CouchDB _rev changes iff the blob changed. If it matches
    // what we last synced to, local already reflects the cloud -> no prompt.
    if (server.rev && local.lastRev) return server.rev !== local.lastRev;
    // Fallback: compare the cloud blob's age against our last sync (the
    // "relative age of localStorage vs database" check).
    if (server.timestamp && local.lastBackupTimestamp) {
        return new Date(server.timestamp).getTime() > new Date(local.lastBackupTimestamp).getTime();
    }
    // Not enough info to be sure -> prompt, favoring data preservation.
    return true;
}

export async function sha256Hex(text: string): Promise<string> {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Presentation-only fields that live inside the persisted assumptions data but are
// pure UI preferences — toggling them is NOT a data change. They're still backed up
// and restored, but must be stripped before computing the dirty-detection hash so
// they don't trigger a spurious "Unsaved changes" prompt. (selectedMonth/selectedYear
// are handled separately — excluded from the backup payload entirely in useFileManager.)
const PRESENTATION_ONLY_DISPLAY_FIELDS = ['useCompactCurrency', 'showExperimentalFeatures'] as const;

// Produce the canonical string used for backup dirty-detection. Accepts either the
// serialized blob (backup/restore paths) or the live payload object, strips
// presentation-only fields, and returns deterministic JSON. Never mutates its input.
export function normalizeForDirtyCheck(payload: string | object): string {
    let data: any;
    try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch {
        // Not valid JSON (shouldn't happen for a real backup) — hash the raw input.
        return typeof payload === 'string' ? payload : JSON.stringify(payload);
    }
    const display = data?.assumptions?.display;
    if (display && typeof display === 'object') {
        const strippedDisplay = { ...display };
        for (const field of PRESENTATION_ONLY_DISPLAY_FIELDS) delete strippedDisplay[field];
        data = { ...data, assumptions: { ...data.assumptions, display: strippedDisplay } };
    }
    return JSON.stringify(data);
}

// Single entry point so every hash site (backup, restore, live diff) normalizes
// identically — diverging normalizations would make the data look permanently dirty.
export async function hashBackupForDirtyCheck(payload: string | object): Promise<string> {
    return sha256Hex(normalizeForDirtyCheck(payload));
}

const defaultContextValue: CloudBackupContextValue = {
    enabled: false,
    isAuthenticated: false,
    userEmail: null,
    lastBackupTimestamp: null,
    backupInProgress: false,
    restoreInProgress: false,
    checkingAuth: false,
    lastError: null,
    linkedEmail: null,
    lastBackupHash: null,
    currentDataHash: null,
    justSignedIn: false,
    signIn: async () => {},
    signOut: () => {},
    backup: async () => {},
    restore: async () => '',
    deleteCloudData: async () => {},
    checkBackupStatus: async () => ({ exists: false, timestamp: null, size: null, rev: null }),
    clearError: () => {},
    updateCurrentDataHash: () => {},
    clearLinkedEmail: () => {},
    clearJustSignedIn: () => {},
};

export const CloudBackupContext = createContext<CloudBackupContextValue>(defaultContextValue);
