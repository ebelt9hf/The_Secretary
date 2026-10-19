import fs from 'fs';
import path from 'path';

const FILE_NAME = 'secretary-vault-passphrase.bin';

/**
 * Creates an OS-keychain-backed store for the vault passphrase.
 * Uses Electron `safeStorage` (Windows DPAPI, macOS Keychain, Linux libsecret/kwallet).
 * The passphrase is never written in plaintext; if the OS cannot encrypt, saving is refused.
 */
export function createSecurePassphraseStore({ safeStorage, userDataPath, fsImpl = fs }) {
  const filePath = path.join(userDataPath, FILE_NAME);

  function isAvailable() {
    try {
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) return false;
      // On Linux without a keyring Electron falls back to a hardcoded key ("basic_text"): refuse it.
      if (typeof safeStorage.getSelectedStorageBackend === 'function') {
        if (safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function save(passphrase) {
    if (typeof passphrase !== 'string' || !passphrase) return false;
    if (!isAvailable()) return false;
    try {
      const encrypted = safeStorage.encryptString(passphrase);
      fsImpl.writeFileSync(filePath, encrypted, { mode: 0o600 });
      return true;
    } catch (e) {
      return false;
    }
  }

  function get() {
    if (!isAvailable()) return null;
    try {
      if (!fsImpl.existsSync(filePath)) return null;
      return safeStorage.decryptString(fsImpl.readFileSync(filePath)) || null;
    } catch (e) {
      return null;
    }
  }

  function clear() {
    try {
      if (fsImpl.existsSync(filePath)) fsImpl.unlinkSync(filePath);
      return !fsImpl.existsSync(filePath);
    } catch (e) {
      return false;
    }
  }

  return { isAvailable, save, get, clear, filePath };
}

const SECRETS_FILE_NAME = 'secretary-vault-secrets.bin';

/**
 * Creates an OS-keychain-backed store for arbitrary sensitive secrets (e.g. AI API keys).
 * Uses Electron `safeStorage`. The secret dictionary is encrypted as JSON before writing.
 */
export function createSecureSecretsStore({ safeStorage, userDataPath, fsImpl = fs }) {
  const filePath = path.join(userDataPath, SECRETS_FILE_NAME);

  function isAvailable() {
    try {
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) return false;
      if (typeof safeStorage.getSelectedStorageBackend === 'function') {
        if (safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function _readAll() {
    if (!isAvailable() || !fsImpl.existsSync(filePath)) return {};
    try {
      const raw = fsImpl.readFileSync(filePath);
      const decrypted = safeStorage.decryptString(raw);
      return JSON.parse(decrypted) || {};
    } catch (e) {
      return {};
    }
  }

  function _writeAll(data) {
    if (!isAvailable()) return false;
    try {
      const jsonStr = JSON.stringify(data);
      const encrypted = safeStorage.encryptString(jsonStr);
      fsImpl.writeFileSync(filePath, encrypted, { mode: 0o600 });
      return true;
    } catch (e) {
      return false;
    }
  }

  function save(key, value) {
    if (!key || typeof key !== 'string') return false;
    if (typeof value !== 'string') return false;
    const all = _readAll();
    all[key] = value;
    return _writeAll(all);
  }

  function get(key) {
    if (!key || typeof key !== 'string') return null;
    const all = _readAll();
    return all[key] !== undefined ? all[key] : null;
  }

  function clear(key) {
    if (!key) {
      try {
        if (fsImpl.existsSync(filePath)) fsImpl.unlinkSync(filePath);
        return true;
      } catch (e) { return false; }
    }
    const all = _readAll();
    delete all[key];
    return _writeAll(all);
  }

  return { isAvailable, save, get, clear, filePath };
}

