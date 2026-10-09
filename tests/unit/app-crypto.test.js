import { describe, it, expect, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Zero-Knowledge CryptoEngine (js/app-crypto.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal(['js/app-crypto.js']);
  });

  it('generates random salts and initialization vectors', () => {
    const salt1 = window.CryptoEngine.generateSalt(16);
    const salt2 = window.CryptoEngine.generateSalt(16);
    expect(typeof salt1).toBe('string');
    expect(salt1.length).toBeGreaterThan(10);
    expect(salt1).not.toBe(salt2);

    const iv1 = window.CryptoEngine.generateIv(12);
    const iv2 = window.CryptoEngine.generateIv(12);
    expect(typeof iv1).toBe('string');
    expect(iv1).not.toBe(iv2);
  });

  it('derives a CryptoKey via PBKDF2 from a passphrase', async () => {
    const salt = window.CryptoEngine.generateSalt(16);
    const key = await window.CryptoEngine.deriveKey('master-secret-12345', salt, 1000);
    expect(key).toBeDefined();
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('encrypts and decrypts structured JSON note objects with AES-256-GCM', async () => {
    const salt = window.CryptoEngine.generateSalt(16);
    const key = await window.CryptoEngine.deriveKey('my-super-secret-password', salt, 1000);

    const note = {
      id: '2026-10-03_strategy',
      title: 'Secret Strategy Plan',
      contentHtml: '<h1>Top Secret</h1><p>Confidential architecture details.</p>',
      tags: ['Executive', 'Confidential'],
      pinned: true,
      updatedAt: 1791067853000
    };

    const encrypted = await window.CryptoEngine.encryptData(key, note);
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.ciphertext).not.toContain('Secret Strategy Plan');
    expect(encrypted.ciphertext).not.toContain('Confidential');

    const decrypted = await window.CryptoEngine.decryptData(key, encrypted);
    expect(decrypted).toEqual(note);
    expect(decrypted.title).toBe('Secret Strategy Plan');
  });

  it('sets up a new vault and verifies correct passphrase via Canary token', async () => {
    const passphrase = 'valid-user-master-passphrase-2026';
    const { vaultMeta, key } = await window.CryptoEngine.setupVault(passphrase, 1000);

    expect(vaultMeta.salt).toBeDefined();
    expect(vaultMeta.canaryIv).toBeDefined();
    expect(vaultMeta.canaryCiphertext).toBeDefined();
    expect(vaultMeta.algorithm).toBe('AES-GCM-256');

    // 1. Correct password verification
    const validCheck = await window.CryptoEngine.verifyPassphrase(passphrase, vaultMeta);
    expect(validCheck.valid).toBe(true);
    expect(validCheck.key).toBeDefined();

    // 2. Incorrect password verification
    const invalidCheck = await window.CryptoEngine.verifyPassphrase('wrong-passphrase', vaultMeta);
    expect(invalidCheck.valid).toBe(false);
    expect(invalidCheck.key).toBeUndefined();
  });

  it('fails decryption gracefully if ciphertext is tampered with (GCM auth tag validation)', async () => {
    const salt = window.CryptoEngine.generateSalt(16);
    const key = await window.CryptoEngine.deriveKey('secure-pass', salt, 1000);

    const payload = await window.CryptoEngine.encryptData(key, { secret: 'data' });

    // Tamper with ciphertext by corrupting last character
    const tamperedPayload = {
      iv: payload.iv,
      ciphertext: payload.ciphertext.slice(0, -4) + 'AAAA'
    };

    await expect(window.CryptoEngine.decryptData(key, tamperedPayload)).rejects.toThrow(/Decryption failed/);
  });

  it('rotates vault passphrase and re-encrypts all notes with new key', async () => {
    const oldPass = 'old-passphrase-123';
    const newPass = 'new-shiny-strong-passphrase-456';

    const { vaultMeta: oldVaultMeta, key: oldKey } = await window.CryptoEngine.setupVault(oldPass, 1000);

    const note1 = { id: 'note-1', title: 'Note One', contentHtml: '<p>First</p>' };
    const note2 = { id: 'note-2', title: 'Note Two', contentHtml: '<p>Second</p>' };

    const enc1 = await window.CryptoEngine.encryptData(oldKey, note1);
    const enc2 = await window.CryptoEngine.encryptData(oldKey, note2);

    const notesList = [
      { id: 'note-1', iv: enc1.iv, ciphertext: enc1.ciphertext },
      { id: 'note-2', iv: enc2.iv, ciphertext: enc2.ciphertext }
    ];

    const { newVaultMeta, newKey, reEncryptedNotes } = await window.CryptoEngine.rotateVaultPassphrase(
      oldPass,
      newPass,
      oldVaultMeta,
      notesList
    );

    expect(newVaultMeta.salt).not.toBe(oldVaultMeta.salt);
    expect(reEncryptedNotes.length).toBe(2);

    // Verify new password works
    const newVerification = await window.CryptoEngine.verifyPassphrase(newPass, newVaultMeta);
    expect(newVerification.valid).toBe(true);

    // Old password must fail on new vault
    const oldOnNewCheck = await window.CryptoEngine.verifyPassphrase(oldPass, newVaultMeta);
    expect(oldOnNewCheck.valid).toBe(false);

    // Verify re-encrypted notes can be decrypted with new key
    const decrypted1 = await window.CryptoEngine.decryptData(newKey, reEncryptedNotes[0]);
    const decrypted2 = await window.CryptoEngine.decryptData(newKey, reEncryptedNotes[1]);

    expect(decrypted1.title).toBe('Note One');
    expect(decrypted2.title).toBe('Note Two');
  });

  it('aborts rotateVaultPassphrase atomically if any note fails decryption', async () => {
    const oldPass = 'old-passphrase-atomic';
    const newPass = 'new-passphrase-atomic';

    const { vaultMeta: oldVaultMeta } = await window.CryptoEngine.setupVault(oldPass, 1000);

    const corruptNotesList = [
      { id: 'note-valid', iv: window.CryptoEngine.generateIv(), ciphertext: 'invalid-corrupt-data' }
    ];

    await expect(
      window.CryptoEngine.rotateVaultPassphrase(oldPass, newPass, oldVaultMeta, corruptNotesList)
    ).rejects.toThrow(/Passphrase rotation aborted/);
  });

  it('rejects master passphrases shorter than 10 characters', async () => {
    await expect(window.CryptoEngine.setupVault('short-6')).rejects.toThrow(/Passphrase must be at least 10 characters/);
  });

  it('always generates fresh, unique IVs for each encryption', async () => {
    const salt = window.CryptoEngine.generateSalt(16);
    const key = await window.CryptoEngine.deriveKey('my-super-secret-password-10', salt, 1000);
    const payload = { hello: 'world' };

    const enc1 = await window.CryptoEngine.encryptData(key, payload);
    const enc2 = await window.CryptoEngine.encryptData(key, payload);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it('strips prototype pollution keys (__proto__, constructor) on decryption', async () => {
    const salt = window.CryptoEngine.generateSalt(16);
    const key = await window.CryptoEngine.deriveKey('my-super-secret-password-10', salt, 1000);
    const maliciousJson = '{"title":"Malicious","__proto__":{"polluted":true},"constructor":{"polluted":true}}';

    // Encrypt raw JSON string
    const encrypted = await window.CryptoEngine.encryptData(key, maliciousJson);
    const decrypted = await window.CryptoEngine.decryptData(key, encrypted);

    expect(decrypted.title).toBe('Malicious');
    expect(Object.prototype.polluted).toBeUndefined();
    expect(decrypted.__proto__).toBe(Object.prototype);
  });

  it('cleanPassphrase cleans surrounding whitespace, newlines, tabs, zero-width chars, and normalizes to NFC', () => {
    const raw = '\r\n\t  \uFEFF\u200Bsecret master passphrase 2026\u200C\u00A0 \n';
    const cleaned = window.CryptoEngine.cleanPassphrase(raw);
    expect(cleaned).toBe('secret master passphrase 2026');

    // Decomposed unicode (NFD) normalized to composed (NFC)
    const decomposed = 'caf\u0065\u0301-passphrase-2026'; // café in NFD
    const normalized = window.CryptoEngine.cleanPassphrase(decomposed);
    expect(normalized).toBe('café-passphrase-2026');
    expect(normalized).toBe('café-passphrase-2026'.normalize('NFC'));
  });

  it('verifies passphrases copy-pasted with newlines or cross-platform NFC/NFD encoding differences', async () => {
    const originalPass = 'café-secret-master-vault-2026';
    const { vaultMeta } = await window.CryptoEngine.setupVault(originalPass, 1000);

    // 1. Copy-pasted from web or electron with surrounding newlines and spaces
    const pastedWithNewlines = `\n  ${originalPass}\r\n  `;
    const check1 = await window.CryptoEngine.verifyPassphrase(pastedWithNewlines, vaultMeta);
    expect(check1.valid).toBe(true);
    expect(check1.key).toBeDefined();

    // 2. macOS native clipboard decomposing composed UTF-8 characters (NFD)
    const macOsNfdPasted = `\r\n${originalPass.normalize('NFD')}\n`;
    const check2 = await window.CryptoEngine.verifyPassphrase(macOsNfdPasted, vaultMeta);
    expect(check2.valid).toBe(true);
    expect(check2.key).toBeDefined();
  });
});

