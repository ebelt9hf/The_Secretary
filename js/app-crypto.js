'use strict';

/**
 * Secretary: Zero-Knowledge End-to-End Encryption Engine (E2EE)
 *
 * Implements client-side cryptographic primitives using the native Web Crypto API:
 * - PBKDF2 with HMAC-SHA-256 and 100,000+ iterations for key derivation.
 * - AES-256-GCM for authenticated symmetric encryption of notes, metadata, and assets.
 * - Canary verification for instant zero-knowledge password verification.
 * - Full vault passphrase rotation and re-encryption.
 */
const CryptoEngine = {
  KDF_ITERATIONS: 100000,
  KDF_HASH: 'SHA-256',
  CIPHER_ALGO: 'AES-GCM',
  KEY_LENGTH: 256,
  IV_LENGTH: 12, // 96-bit standard IV for AES-GCM
  SALT_LENGTH: 16, // 128-bit random salt
  CANARY_PAYLOAD: 'secretary-vault-verified-v4',

  _getCrypto() {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      return window.crypto;
    }
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
      return globalThis.crypto;
    }
    throw new Error('Web Crypto API (crypto.subtle) is not supported in this environment');
  },

  // ── Binary & Base64 Helpers ──
  arrayBufferToBase64(buffer) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(buffer).toString('base64');
    }
    const bytes = new Uint8Array(buffer);
    const CHUNK_SIZE = 0x8000; // 32KB chunks to avoid stack limits & excessive allocations
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
    }
    if (typeof btoa === 'function') {
      return btoa(binary);
    }
    throw new Error('No Base64 encoder available');
  },

  base64ToArrayBuffer(base64) {
    if (typeof atob === 'function') {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(base64, 'base64');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    throw new Error('No Base64 decoder available');
  },

  generateRandomBytes(length) {
    const cryptoObj = this._getCrypto();
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    return bytes;
  },

  generateSalt(length = 16) {
    return this.arrayBufferToBase64(this.generateRandomBytes(length));
  },

  generateIv(length = 12) {
    return this.arrayBufferToBase64(this.generateRandomBytes(length));
  },

  // ── Key Derivation (PBKDF2 -> AES-256-GCM) ──
  async deriveKey(passphrase, saltBase64, iterations = 100000) {
    if (!passphrase || typeof passphrase !== 'string') {
      throw new Error('Passphrase must be a non-empty string');
    }
    if (!saltBase64 || typeof saltBase64 !== 'string') {
      throw new Error('Salt must be a valid base64 string');
    }

    const cryptoObj = this._getCrypto();
    const enc = new TextEncoder();
    const passBuffer = enc.encode(passphrase);
    const saltBuffer = this.base64ToArrayBuffer(saltBase64);

    try {
      // 1. Import raw passphrase as PBKDF2 base key
      const baseKey = await cryptoObj.subtle.importKey(
        'raw',
        passBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );

      // 2. Derive 256-bit AES-GCM encryption key
      const derivedKey = await cryptoObj.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: saltBuffer,
          iterations: iterations || this.KDF_ITERATIONS,
          hash: this.KDF_HASH
        },
        baseKey,
        {
          name: this.CIPHER_ALGO,
          length: this.KEY_LENGTH
        },
        false, // non-exportable for maximum memory security
        ['encrypt', 'decrypt']
      );

      return derivedKey;
    } finally {
      // Defensive memory zeroization of raw passphrase bytes
      passBuffer.fill(0);
    }
  },

  // ── Encryption & Decryption (AES-256-GCM) ──
  async encryptData(key, data) {
    if (!key) throw new Error('CryptoKey is required for encryption');
    const cryptoObj = this._getCrypto();

    // In AES-GCM, IVs must ALWAYS be unique and cryptographically random per encryption
    const ivBytes = this.generateRandomBytes(this.IV_LENGTH);

    const rawString = typeof data === 'string' ? data : JSON.stringify(data);
    const enc = new TextEncoder();
    const plainBuffer = enc.encode(rawString);

    const cipherBuffer = await cryptoObj.subtle.encrypt(
      {
        name: this.CIPHER_ALGO,
        iv: ivBytes
      },
      key,
      plainBuffer
    );

    return {
      iv: this.arrayBufferToBase64(ivBytes.buffer),
      ciphertext: this.arrayBufferToBase64(cipherBuffer)
    };
  },

  async decryptData(key, payload) {
    if (!key) throw new Error('CryptoKey is required for decryption');
    if (!payload || !payload.iv || !payload.ciphertext) {
      throw new Error('Invalid encrypted payload: missing iv or ciphertext');
    }

    const cryptoObj = this._getCrypto();
    const ivBuffer = this.base64ToArrayBuffer(payload.iv);
    const cipherBuffer = this.base64ToArrayBuffer(payload.ciphertext);

    try {
      const decryptedBuffer = await cryptoObj.subtle.decrypt(
        {
          name: this.CIPHER_ALGO,
          iv: new Uint8Array(ivBuffer)
        },
        key,
        cipherBuffer
      );

      const dec = new TextDecoder();
      const plainString = dec.decode(decryptedBuffer);

      try {
        const parsed = JSON.parse(plainString);
        if (parsed && typeof parsed === 'object') {
          // Defend against prototype pollution
          delete parsed.__proto__;
          delete parsed.constructor;
          delete parsed.prototype;
        }
        return parsed;
      } catch (jsonErr) {
        return plainString;
      }
    } catch (err) {
      throw new Error('Decryption failed: incorrect password or corrupted ciphertext');
    }
  },

  cleanPassphrase(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/^[\s\uFEFF\u200B-\u200D\u00A0]+|[\s\uFEFF\u200B-\u200D\u00A0]+$/g, '')
      .normalize('NFC');
  },

  // ── Vault Lifecycle & Password Canary ──
  async setupVault(passphrase, iterations = 100000) {
    const cleanPass = this.cleanPassphrase(passphrase) || (typeof passphrase === 'string' ? passphrase.trim() : '');
    if (!cleanPass || cleanPass.length < 10) {
      throw new Error('Passphrase must be at least 10 characters long');
    }

    const salt = this.generateSalt(this.SALT_LENGTH);
    const key = await this.deriveKey(cleanPass, salt, iterations);

    // Create verification canary token
    const canaryPayload = {
      tag: this.CANARY_PAYLOAD,
      created: new Date().toISOString(),
      version: 4
    };
    const canaryEncrypted = await this.encryptData(key, canaryPayload);

    const vaultMeta = {
      salt,
      canaryIv: canaryEncrypted.iv,
      canaryCiphertext: canaryEncrypted.ciphertext,
      kdfIterations: iterations || this.KDF_ITERATIONS,
      algorithm: 'AES-GCM-256',
      createdAt: new Date().toISOString()
    };

    return {
      vaultMeta,
      key
    };
  },

  async verifyPassphrase(passphrase, vaultMeta) {
    if (!passphrase) {
      return { valid: false, error: 'Passphrase cannot be empty' };
    }
    if (!vaultMeta || !vaultMeta.salt || !vaultMeta.canaryIv || !vaultMeta.canaryCiphertext) {
      return { valid: false, error: 'Invalid vault metadata' };
    }

    const raw = typeof passphrase === 'string' ? passphrase : String(passphrase);
    const cleanedNfc = this.cleanPassphrase(raw);
    const trimmed = raw.trim();
    const cleanedNfd = cleanedNfc ? cleanedNfc.normalize('NFD') : '';
    const rawNfd = raw ? raw.normalize('NFD') : '';

    const candidates = [];
    if (cleanedNfc) candidates.push(cleanedNfc);
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
    if (!candidates.includes(raw)) candidates.push(raw);
    if (cleanedNfd && !candidates.includes(cleanedNfd)) candidates.push(cleanedNfd);
    if (rawNfd && !candidates.includes(rawNfd)) candidates.push(rawNfd);

    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const key = await this.deriveKey(candidate, vaultMeta.salt, vaultMeta.kdfIterations || this.KDF_ITERATIONS);
        const canaryData = await this.decryptData(key, {
          iv: vaultMeta.canaryIv,
          ciphertext: vaultMeta.canaryCiphertext
        });

        if (canaryData && canaryData.tag === this.CANARY_PAYLOAD) {
          return { valid: true, key, matchedPassphrase: candidate };
        }
      } catch (e) {
        // Continue to next candidate
      }
    }

    return { valid: false, error: 'Incorrect passphrase' };
  },

  async rotateVaultPassphrase(oldPassphrase, newPassphrase, vaultMeta, encryptedNotesList = []) {
    const verification = await this.verifyPassphrase(oldPassphrase, vaultMeta);
    if (!verification.valid || !verification.key) {
      throw new Error('Current passphrase verification failed');
    }
    const oldKey = verification.key;

    // 1. Setup new vault metadata and key
    const { vaultMeta: newVaultMeta, key: newKey } = await this.setupVault(newPassphrase);

    // 2. Re-encrypt all notes with the new key - strictly atomic with event loop yielding
    const reEncryptedNotes = [];
    for (let i = 0; i < encryptedNotesList.length; i++) {
      const note = encryptedNotesList[i];
      if (!note) continue;

      // Yield event loop every 20 records to prevent freezing UI
      if (i > 0 && i % 20 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      try {
        if (note.meta && note.meta.ciphertext) {
          // Schema v2 2-tier note
          const decMeta = await this.decryptData(oldKey, { iv: note.meta.iv, ciphertext: note.meta.ciphertext });
          const encMeta = await this.encryptData(newKey, decMeta);
          let newBody = null;
          if (note.body && note.body.ciphertext) {
            const decBody = await this.decryptData(oldKey, { iv: note.body.iv, ciphertext: note.body.ciphertext });
            const encBody = await this.encryptData(newKey, decBody);
            newBody = {
              ...note.body,
              iv: encBody.iv,
              ciphertext: encBody.ciphertext,
              updatedAt: Date.now()
            };
          }
          reEncryptedNotes.push({
            ...note,
            meta: {
              ...note.meta,
              iv: encMeta.iv,
              ciphertext: encMeta.ciphertext,
              updatedAt: Date.now()
            },
            body: newBody,
            updatedAt: Date.now()
          });
        } else if (note.ciphertext && note.iv) {
          // Schema v1 legacy note
          const decryptedContent = await this.decryptData(oldKey, {
            iv: note.iv,
            ciphertext: note.ciphertext
          });
          const newEncrypted = await this.encryptData(newKey, decryptedContent);
          reEncryptedNotes.push({
            ...note,
            iv: newEncrypted.iv,
            ciphertext: newEncrypted.ciphertext,
            updatedAt: Date.now()
          });
        }
      } catch (err) {
        throw new Error(`Passphrase rotation aborted: failed to re-encrypt note "${note.id || note.path}": ${err.message}`);
      }
    }

    return {
      newVaultMeta,
      newKey,
      reEncryptedNotes
    };
  }
};

if (typeof window !== 'undefined') {
  window.CryptoEngine = CryptoEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CryptoEngine };
}
