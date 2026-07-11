import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, type EncryptedBackup } from '../../../services/encryption/CryptoService';

describe('CryptoService', () => {
    const sampleData = JSON.stringify({
        version: 1,
        accounts: [{ name: 'Checking', balance: 5000 }],
        incomes: [{ name: 'Salary', amount: 80000 }],
        expenses: [{ name: 'Rent', amount: 2000 }],
        taxSettings: { filingStatus: 'single' },
        assumptions: { retirementAge: 65 },
    });

    const passphrase = 'my-secure-passphrase-2024!';

    it('should round-trip encrypt then decrypt to original data', async () => {
        const encrypted = await encrypt(sampleData, passphrase);
        const decrypted = await decrypt(encrypted, passphrase);
        expect(decrypted).toBe(sampleData);
    });

    it('should produce a valid EncryptedBackup envelope', async () => {
        const encrypted = await encrypt(sampleData, passphrase);

        expect(encrypted.version).toBe(1);
        expect(encrypted.algorithm).toBe('AES-256-GCM');
        expect(encrypted.kdf).toBe('PBKDF2');
        expect(encrypted.iterations).toBe(600_000);
        expect(encrypted.salt).toBeTruthy();
        expect(encrypted.iv).toBeTruthy();
        expect(encrypted.ciphertext).toBeTruthy();
        expect(encrypted.timestamp).toBeTruthy();
        expect(encrypted.checksum).toBeTruthy();

        // Timestamp should be valid ISO 8601
        expect(new Date(encrypted.timestamp).toISOString()).toBe(encrypted.timestamp);

        // Checksum should be a 64-char hex string (SHA-256)
        expect(encrypted.checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should throw on wrong passphrase', async () => {
        const encrypted = await encrypt(sampleData, passphrase);
        await expect(decrypt(encrypted, 'wrong-passphrase')).rejects.toThrow(
            'Decryption failed. Wrong passphrase or corrupted data.'
        );
    });

    it('should throw on corrupted ciphertext', async () => {
        const encrypted = await encrypt(sampleData, passphrase);
        // Corrupt the ciphertext by changing a character
        const corrupted: EncryptedBackup = {
            ...encrypted,
            ciphertext: encrypted.ciphertext.slice(0, -4) + 'AAAA',
        };
        await expect(decrypt(corrupted, passphrase)).rejects.toThrow();
    });

    it('should detect checksum mismatch', async () => {
        const encrypted = await encrypt(sampleData, passphrase);
        // Tamper with checksum
        const tampered: EncryptedBackup = {
            ...encrypted,
            checksum: '0'.repeat(64),
        };
        // This will either fail decryption (if ciphertext is fine but checksum doesn't match)
        // or throw a checksum mismatch
        await expect(decrypt(tampered, passphrase)).rejects.toThrow('Checksum mismatch');
    });

    it('should produce different ciphertext for different passphrases', async () => {
        const encrypted1 = await encrypt(sampleData, 'passphrase-one');
        const encrypted2 = await encrypt(sampleData, 'passphrase-two');

        expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
        expect(encrypted1.salt).not.toBe(encrypted2.salt);
    });

    it('should produce different ciphertext for same passphrase (random salt/iv)', async () => {
        const encrypted1 = await encrypt(sampleData, passphrase);
        const encrypted2 = await encrypt(sampleData, passphrase);

        // Random salt and IV should differ each time
        expect(encrypted1.salt).not.toBe(encrypted2.salt);
        expect(encrypted1.iv).not.toBe(encrypted2.iv);
        expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);

        // But both should decrypt to the same plaintext
        const decrypted1 = await decrypt(encrypted1, passphrase);
        const decrypted2 = await decrypt(encrypted2, passphrase);
        expect(decrypted1).toBe(decrypted2);
    });

    it('should handle empty string encryption', async () => {
        const encrypted = await encrypt('', passphrase);
        const decrypted = await decrypt(encrypted, passphrase);
        expect(decrypted).toBe('');
    });

    it('should handle large data', async () => {
        const largeData = JSON.stringify({ data: 'x'.repeat(100_000) });
        const encrypted = await encrypt(largeData, passphrase);
        const decrypted = await decrypt(encrypted, passphrase);
        expect(decrypted).toBe(largeData);
    });

    it('should handle unicode characters', async () => {
        const unicodeData = JSON.stringify({ name: '退職金 pension 年金 401(k)' });
        const encrypted = await encrypt(unicodeData, passphrase);
        const decrypted = await decrypt(encrypted, passphrase);
        expect(decrypted).toBe(unicodeData);
    });
});
