/**
 * Client-side encryption service using Web Crypto API.
 * Zero-knowledge: all encryption/decryption happens in the browser.
 * The server never sees plaintext data.
 */

export interface EncryptedBackup {
    version: 1;
    algorithm: 'AES-256-GCM';
    kdf: 'PBKDF2';
    iterations: number;
    salt: string;       // base64, random 16 bytes
    iv: string;         // base64, random 12 bytes
    ciphertext: string; // base64, encrypted data
    timestamp: string;  // ISO 8601 UTC
    checksum: string;   // SHA-256 hex of plaintext for post-decrypt verification
}

const ITERATIONS = 600_000; // OWASP recommendation for PBKDF2-SHA256
const SALT_LENGTH = 16;     // 128 bits
const IV_LENGTH = 12;       // 96 bits (recommended for AES-GCM)

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

async function sha256Hex(data: string): Promise<string> {
    const encoded = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(
    passphrase: string,
    salt: Uint8Array<ArrayBuffer>,
    iterations: number
): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypt plaintext with a passphrase using AES-256-GCM.
 * Returns a self-describing envelope with all parameters needed for decryption.
 */
export async function encrypt(plaintext: string, passphrase: string): Promise<EncryptedBackup> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await deriveKey(passphrase, salt, ITERATIONS);

    const encoded = new TextEncoder().encode(plaintext);
    const cipherBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
    );

    const checksum = await sha256Hex(plaintext);

    return {
        version: 1,
        algorithm: 'AES-256-GCM',
        kdf: 'PBKDF2',
        iterations: ITERATIONS,
        salt: arrayBufferToBase64(salt.buffer),
        iv: arrayBufferToBase64(iv.buffer),
        ciphertext: arrayBufferToBase64(cipherBuffer),
        timestamp: new Date().toISOString(),
        checksum,
    };
}

/**
 * Decrypt an encrypted backup envelope with the given passphrase.
 * Verifies checksum after decryption to ensure data integrity.
 * Throws on wrong passphrase or data corruption.
 */
export async function decrypt(envelope: EncryptedBackup, passphrase: string): Promise<string> {
    const salt = new Uint8Array(base64ToArrayBuffer(envelope.salt));
    const iv = new Uint8Array(base64ToArrayBuffer(envelope.iv));
    const ciphertext = base64ToArrayBuffer(envelope.ciphertext);

    const iterations = envelope.iterations || ITERATIONS;
    const key = await deriveKey(passphrase, salt, iterations);

    let plainBuffer: ArrayBuffer;
    try {
        plainBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );
    } catch {
        throw new Error('Decryption failed. Wrong passphrase or corrupted data.');
    }

    const plaintext = new TextDecoder().decode(plainBuffer);

    // Verify checksum if present
    if (envelope.checksum) {
        const actualChecksum = await sha256Hex(plaintext);
        if (actualChecksum !== envelope.checksum) {
            throw new Error('Checksum mismatch. Data may be corrupted.');
        }
    }

    return plaintext;
}
