import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, type EncryptedBackup } from '../../../services/encryption/CryptoService';

/**
 * Zero-knowledge guarantees for the uploaded envelope.
 *
 * The envelope is JSON.stringify'd and POSTed to the backend, which persists it
 * next to the ciphertext. A backend operator must NOT be able to confirm a guessed
 * plaintext by hashing a candidate. So the serialized envelope must never contain
 * SHA-256(plaintext) — that would be a confirmation/dictionary oracle on
 * low-entropy or partially-known backups, contradicting the zero-knowledge header.
 */
describe('CryptoService zero-knowledge envelope', () => {
    const passphrase = 'my-secure-passphrase-2024!';

    async function sha256Hex(data: string): Promise<string> {
        const encoded = new TextEncoder().encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
        const hashArray = new Uint8Array(hashBuffer);
        return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    it('does not embed a hash of the plaintext in the uploaded envelope', async () => {
        // Low-entropy, fully-guessable plaintext: the exact case the oracle attacks.
        const plaintext = JSON.stringify({ accounts: [{ name: 'Checking', balance: 5000 }] });
        const encrypted = await encrypt(plaintext, passphrase);

        const plaintextHash = await sha256Hex(plaintext);

        // The serialized blob is what actually leaves the browser.
        const serialized = JSON.stringify(encrypted);
        expect(serialized).not.toContain(plaintextHash);
        // And specifically the checksum field must not be the plaintext hash.
        expect(encrypted.checksum).not.toBe(plaintextHash);
    });

    it('still round-trips encrypt then decrypt', async () => {
        const plaintext = JSON.stringify({ accounts: [{ name: 'Checking', balance: 5000 }] });
        const encrypted = await encrypt(plaintext, passphrase);
        const decrypted = await decrypt(encrypted, passphrase);
        expect(decrypted).toBe(plaintext);
    });

    it('rejects tampered ciphertext via the GCM auth tag', async () => {
        const plaintext = JSON.stringify({ accounts: [{ name: 'Checking', balance: 5000 }] });
        const encrypted = await encrypt(plaintext, passphrase);
        const corrupted: EncryptedBackup = {
            ...encrypted,
            ciphertext: encrypted.ciphertext.slice(0, -4) + 'AAAA',
        };
        await expect(decrypt(corrupted, passphrase)).rejects.toThrow();
    });

    it('keeps the checksum field a 64-char hex string', async () => {
        const plaintext = JSON.stringify({ accounts: [{ name: 'Checking', balance: 5000 }] });
        const encrypted = await encrypt(plaintext, passphrase);
        expect(encrypted.checksum).toMatch(/^[0-9a-f]{64}$/);
    });
});
