/**
 * Cloud backup service. Encrypts client-side and stores the ciphertext blob
 * directly via the backend's /backup endpoint (CouchDB-backed). The server only
 * ever holds ciphertext it cannot read.
 *
 * Concurrency: the browser and the headless stag-feed process both write the
 * same per-user document, so writes carry the last-seen `rev` (CouchDB `_rev`,
 * opaque to us). The backend rejects a stale write with 409; callers must then
 * re-download and retry rather than clobber.
 */

import { type EncryptedBackup, encrypt, decrypt } from '../encryption/CryptoService';

export interface BackupMetadata {
    exists: boolean;
    timestamp: string | null;
    size: number | null;
    rev: string | null;
}

export interface DownloadResult {
    plaintext: string;
    rev: string | null;
}

export class BackupConflictError extends Error {
    constructor() {
        super('Cloud copy changed since your last sync. Restore first, then back up.');
        this.name = 'BackupConflictError';
    }
}

const MAX_BACKUP_SIZE = 5 * 1024 * 1024; // 5 MB

function authHeaders(idToken: string): Record<string, string> {
    return { Authorization: `Bearer ${idToken}` };
}

/**
 * Encrypt and upload the backup blob. Sends the last-seen `rev` for optimistic
 * locking; throws BackupConflictError on a 409 (someone wrote since we read).
 */
export async function uploadBackup(
    apiEndpoint: string,
    idToken: string,
    plaintext: string,
    passphrase: string,
    rev: string | null
): Promise<{ timestamp: string; rev: string | null }> {
    const envelope = await encrypt(plaintext, passphrase);
    const blob = JSON.stringify(envelope);

    const blobSize = new Blob([blob]).size;
    if (blobSize > MAX_BACKUP_SIZE) {
        const sizeMB = (blobSize / (1024 * 1024)).toFixed(2);
        throw new Error(
            `Backup size (${sizeMB} MB) exceeds the 5 MB limit. ` +
            `Try removing unused accounts or historical data to reduce the size.`
        );
    }

    const response = await fetch(`${apiEndpoint}/backup`, {
        method: 'POST',
        headers: {
            ...authHeaders(idToken),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ blob, rev }),
    });

    if (response.status === 409) {
        throw new BackupConflictError();
    }
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return { timestamp: data.timestamp ?? envelope.timestamp, rev: data.rev ?? null };
}

/**
 * Download and decrypt the backup. Returns the plaintext and the blob's current
 * `rev` so the caller can send it back on the next write.
 */
export async function downloadBackup(
    apiEndpoint: string,
    idToken: string,
    passphrase: string
): Promise<DownloadResult> {
    const response = await fetch(`${apiEndpoint}/backup`, {
        method: 'GET',
        headers: authHeaders(idToken),
    });

    if (response.status === 404) {
        throw new Error('No cloud backup found.');
    }
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Download failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    if (!data?.blob) {
        throw new Error('No cloud backup found.');
    }

    const envelope: EncryptedBackup = JSON.parse(data.blob);
    const plaintext = await decrypt(envelope, passphrase);
    return { plaintext, rev: data.rev ?? null };
}

/**
 * Check whether a backup exists and read its metadata (including current rev).
 *
 * This is polled on every sign-in AND every panel open, so it asks for metadata
 * only (`?meta=1`): a backend that understands the flag omits the (potentially
 * multi-MB) ciphertext blob and returns just { rev, timestamp, size }, saving
 * that whole download. An OLDER backend that predates the flag simply ignores
 * the unknown query param and returns the full document (blob included) — still
 * correct here, since we only read rev/timestamp/size and never touch the blob.
 * So the fallback is automatic: no separate request, nothing to break mid-
 * upgrade. Existence is determined by HTTP 200 vs 404 (a meta response carries
 * no blob by design), not by whether a blob field is present.
 */
export async function getBackupMetadata(
    apiEndpoint: string,
    idToken: string
): Promise<BackupMetadata> {
    const response = await fetch(`${apiEndpoint}/backup?meta=1`, {
        method: 'GET',
        headers: authHeaders(idToken),
    });

    if (response.status === 404) {
        return { exists: false, timestamp: null, size: null, rev: null };
    }
    if (!response.ok) {
        throw new Error(`Failed to check backup: ${response.status}`);
    }

    const data = await response.json();
    return {
        exists: true,
        timestamp: data.timestamp ?? null,
        size: data.size ?? null,
        rev: data.rev ?? null,
    };
}

/**
 * Delete the cloud backup.
 */
export async function deleteBackup(
    apiEndpoint: string,
    idToken: string
): Promise<void> {
    const response = await fetch(`${apiEndpoint}/backup`, {
        method: 'DELETE',
        headers: authHeaders(idToken),
    });

    if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        throw new Error(`Failed to delete backup: ${response.status} ${errorText}`);
    }
}
