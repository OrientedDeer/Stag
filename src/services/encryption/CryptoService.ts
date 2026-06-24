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
    checksum: string;   // SHA-256 hex of the ciphertext (NOT plaintext) for corruption detection
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

    const ciphertext = arrayBufferToBase64(cipherBuffer);

    // Checksum is over the CIPHERTEXT, not the plaintext. Hashing the plaintext
    // would leak a confirmation/dictionary oracle to the backend (which persists
    // this envelope), breaking the zero-knowledge guarantee on low-entropy backups.
    // The AES-256-GCM auth tag already detects tampering; this only flags at-rest
    // corruption of the stored ciphertext before we attempt an expensive decrypt.
    const checksum = await sha256Hex(ciphertext);

    return {
        version: 1,
        algorithm: 'AES-256-GCM',
        kdf: 'PBKDF2',
        iterations: ITERATIONS,
        salt: arrayBufferToBase64(salt.buffer),
        iv: arrayBufferToBase64(iv.buffer),
        ciphertext,
        timestamp: new Date().toISOString(),
        checksum,
    };
}

/**
 * Decrypt an encrypted backup envelope with the given passphrase.
 * Verifies the ciphertext checksum (corruption detection) and relies on the
 * AES-256-GCM auth tag to reject any tampered or wrong-passphrase data.
 * Throws on wrong passphrase or data corruption.
 */
export async function decrypt(envelope: EncryptedBackup, passphrase: string): Promise<string> {
    const salt = new Uint8Array(base64ToArrayBuffer(envelope.salt));
    const iv = new Uint8Array(base64ToArrayBuffer(envelope.iv));
    const ciphertext = base64ToArrayBuffer(envelope.ciphertext);

    // Verify the ciphertext checksum up front. New envelopes hash the ciphertext.
    // A mismatch here means either corruption or a legacy envelope (checksum =
    // SHA-256 of plaintext); we don't reject solely on this, since the GCM auth
    // tag is the authoritative integrity check and the legacy case is handled
    // post-decrypt below.
    const ciphertextChecksumOk =
        !envelope.checksum || (await sha256Hex(envelope.ciphertext)) === envelope.checksum;

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

    // If the ciphertext checksum didn't match, this is either a legacy envelope
    // (checksum = SHA-256 of plaintext) or corruption. Decryption succeeded, so the
    // GCM tag already vouches for the ciphertext; only reject if it's also not a
    // valid legacy plaintext checksum.
    if (envelope.checksum && !ciphertextChecksumOk) {
        const legacyPlaintextChecksum = await sha256Hex(plaintext);
        if (legacyPlaintextChecksum !== envelope.checksum) {
            throw new Error('Checksum mismatch. Data may be corrupted.');
        }
    }

    return plaintext;
}
