import { describe, it, expect, beforeEach } from 'vitest';
import { createSecurePassphraseStore, createSecureSecretsStore } from '../../electron/secure-passphrase.js';

function makeFs() {
  const files = new Map();
  return {
    files,
    writeFileSync: (p, d) => files.set(p, d),
    readFileSync: (p) => files.get(p),
    existsSync: (p) => files.has(p),
    unlinkSync: (p) => files.delete(p)
  };
}

function makeSafeStorage({ available = true, backend = 'keychain' } = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (s) => Buffer.from('ENC:' + s.split('').reverse().join('')),
    decryptString: (b) => b.toString().slice(4).split('').reverse().join('')
  };
}

describe('electron/secure-passphrase.js', () => {
  let fsImpl;
  beforeEach(() => { fsImpl = makeFs(); });

  it('stores only encrypted bytes and round-trips the passphrase', () => {
    const store = createSecurePassphraseStore({ safeStorage: makeSafeStorage(), userDataPath: '/u', fsImpl });
    expect(store.save('correct horse battery')).toBe(true);
    expect(fsImpl.files.get(store.filePath).toString()).not.toContain('correct horse battery');
    expect(store.get()).toBe('correct horse battery');
  });

  it('refuses to save when OS encryption is unavailable', () => {
    const store = createSecurePassphraseStore({ safeStorage: makeSafeStorage({ available: false }), userDataPath: '/u', fsImpl });
    expect(store.isAvailable()).toBe(false);
    expect(store.save('abc')).toBe(false);
    expect(fsImpl.files.size).toBe(0);
  });

  it('refuses the Linux basic_text fallback backend (hardcoded key)', () => {
    const store = createSecurePassphraseStore({ safeStorage: makeSafeStorage({ backend: 'basic_text' }), userDataPath: '/u', fsImpl });
    expect(store.isAvailable()).toBe(false);
    expect(store.save('abc')).toBe(false);
  });

  it('rejects empty or non-string passphrases', () => {
    const store = createSecurePassphraseStore({ safeStorage: makeSafeStorage(), userDataPath: '/u', fsImpl });
    expect(store.save('')).toBe(false);
    expect(store.save(null)).toBe(false);
  });

  it('clear removes the file and get returns null; failures are reported', () => {
    const store = createSecurePassphraseStore({ safeStorage: makeSafeStorage(), userDataPath: '/u', fsImpl });
    store.save('abc');
    expect(store.clear()).toBe(true);
    expect(store.get()).toBeNull();
    store.save('abc');
    fsImpl.unlinkSync = () => { throw new Error('EPERM'); };
    expect(store.clear()).toBe(false);
  });

  it('get returns null on corrupt data instead of throwing', () => {
    const ss = makeSafeStorage();
    ss.decryptString = () => { throw new Error('bad'); };
    const store = createSecurePassphraseStore({ safeStorage: ss, userDataPath: '/u', fsImpl });
    fsImpl.files.set(store.filePath, Buffer.from('x'));
    expect(store.get()).toBeNull();
  });

  describe('createSecureSecretsStore', () => {
    it('stores secrets encrypted in OS keychain and retrieves them by key', () => {
      const secrets = createSecureSecretsStore({ safeStorage: makeSafeStorage(), userDataPath: '/u', fsImpl });
      expect(secrets.isAvailable()).toBe(true);
      expect(secrets.save('ai.apiKey', 'sk-ant-test-key-12345')).toBe(true);
      // Plaintext must never be in file
      expect(fsImpl.files.get(secrets.filePath).toString()).not.toContain('sk-ant-test-key-12345');
      expect(secrets.get('ai.apiKey')).toBe('sk-ant-test-key-12345');
    });

    it('manages multiple independent secrets and allows clearing single key', () => {
      const secrets = createSecureSecretsStore({ safeStorage: makeSafeStorage(), userDataPath: '/u', fsImpl });
      secrets.save('key1', 'val1');
      secrets.save('key2', 'val2');
      expect(secrets.get('key1')).toBe('val1');
      expect(secrets.get('key2')).toBe('val2');

      secrets.clear('key1');
      expect(secrets.get('key1')).toBeNull();
      expect(secrets.get('key2')).toBe('val2');
    });

    it('clears entire store when clear is called without a key', () => {
      const secrets = createSecureSecretsStore({ safeStorage: makeSafeStorage(), userDataPath: '/u', fsImpl });
      secrets.save('k', 'v');
      expect(secrets.clear()).toBe(true);
      expect(secrets.get('k')).toBeNull();
    });

    it('returns false/null on invalid inputs or when encryption is unavailable', () => {
      const secrets = createSecureSecretsStore({ safeStorage: makeSafeStorage({ available: false }), userDataPath: '/u', fsImpl });
      expect(secrets.isAvailable()).toBe(false);
      expect(secrets.save('k', 'v')).toBe(false);
      expect(secrets.get('k')).toBeNull();
    });
  });
});

