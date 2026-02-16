/**
 * Cloud backup service. Handles pre-signed URL fetching and encrypted blob upload/download.
 * Uses fetch() only - no AWS SDK needed in the browser.
 */

import { EncryptedBackup, encrypt, decrypt } from '../encryption/CryptoService';

export interface BackupMetadata {
    exists: boolean;
    timestamp: string | null;
    size: number | null;
}

/**
 * Request a pre-signed PUT URL from the API, then upload the encrypted backup to S3.
 */
export async function uploadBackup(
    apiEndpoint: string,
    accessToken: string,
    plaintext: string,
    passphrase: string
): Promise<{ timestamp: string }> {
    // Encrypt on the client side
    const envelope = await encrypt(plaintext, passphrase);
    const blob = JSON.stringify(envelope);

    // Get pre-signed PUT URL from Lambda
    const response = await fetch(`${apiEndpoint}/backup`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get upload URL: ${response.status} ${errorText}`);
    }

    const { uploadUrl } = await response.json();

    // Upload encrypted blob directly to S3 via pre-signed URL
    const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob,
    });

    if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.status}`);
    }

    return { timestamp: envelope.timestamp };
}

/**
 * Download and decrypt the backup from S3 via pre-signed GET URL.
 */
export async function downloadBackup(
    apiEndpoint: string,
    accessToken: string,
    passphrase: string
): Promise<string> {
    // Get pre-signed GET URL from Lambda
    const response = await fetch(`${apiEndpoint}/backup`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('No cloud backup found.');
        }
        const errorText = await response.text();
        throw new Error(`Failed to get download URL: ${response.status} ${errorText}`);
    }

    const { downloadUrl, metadata } = await response.json();

    if (!metadata?.exists) {
        throw new Error('No cloud backup found.');
    }

    // Download encrypted blob from S3
    const downloadResponse = await fetch(downloadUrl);

    if (!downloadResponse.ok) {
        throw new Error(`Download failed: ${downloadResponse.status}`);
    }

    const envelopeJson = await downloadResponse.text();
    const envelope: EncryptedBackup = JSON.parse(envelopeJson);

    // Decrypt on the client side
    return decrypt(envelope, passphrase);
}

/**
 * Check if a backup exists and get its metadata.
 */
export async function getBackupMetadata(
    apiEndpoint: string,
    accessToken: string
): Promise<BackupMetadata> {
    const response = await fetch(`${apiEndpoint}/backup`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        if (response.status === 404) {
            return { exists: false, timestamp: null, size: null };
        }
        throw new Error(`Failed to check backup: ${response.status}`);
    }

    const { metadata } = await response.json();

    return {
        exists: metadata?.exists ?? false,
        timestamp: metadata?.timestamp ?? null,
        size: metadata?.size ?? null,
    };
}

/**
 * Delete the cloud backup.
 */
export async function deleteBackup(
    apiEndpoint: string,
    accessToken: string
): Promise<void> {
    const response = await fetch(`${apiEndpoint}/backup`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete backup: ${response.status} ${errorText}`);
    }
}
