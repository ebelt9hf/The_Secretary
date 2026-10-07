import { describe, it, expect, beforeEach } from 'vitest';
import { createSecurePassphraseStore } from '../../electron/secure-passphrase.js';

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
});
