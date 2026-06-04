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

export async function sha256Hex(text: string): Promise<string> {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
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
