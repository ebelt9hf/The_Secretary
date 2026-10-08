import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { getDatabase, ref, set, get, onValue, remove, child } from 'firebase/database';

export const FirebaseBridge = {
  app: null,
  auth: null,
  db: null,
  currentUser: null,
  _activeListeners: new Map(),

  init(config) {
    if (!config || !config.apiKey) return false;
    try {
      const existing = getApps();
      this.app = existing.length > 0 ? existing[0] : initializeApp(config);
      this.auth = getAuth(this.app);
      this.db = getDatabase(this.app);
      return true;
    } catch (err) {
      console.warn('FirebaseBridge init failed:', err);
      return false;
    }
  },

  async ensureAuth() {
    if (!this.auth) return null;
    if (this.currentUser) return this.currentUser;

    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth, async (user) => {
        unsubscribe();
        if (user) {
          this.currentUser = user;
          resolve(user);
        } else {
          try {
            const cred = await signInAnonymously(this.auth);
            this.currentUser = cred.user;
            resolve(cred.user);
          } catch (e) {
            console.warn('Anonymous sign-in failed:', e);
            resolve(null);
          }
        }
      });
    });
  },

  async signInWithEmail(email, password) {
    if (!this.auth) return null;
    const cred = await signInWithEmailAndPassword(this.auth, email, password);
    this.currentUser = cred.user;
    return cred.user;
  },

  async signUpWithEmail(email, password) {
    if (!this.auth) return null;
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    this.currentUser = cred.user;
    return cred.user;
  },

  async signInWithGoogle() {
    if (!this.auth) return null;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(this.auth, provider);
    this.currentUser = cred.user;
    return cred.user;
  },

  async sendSignInLink(email, returnUrl) {
    if (!this.auth) return false;
    const actionCodeSettings = {
      url: returnUrl || (typeof window !== 'undefined' ? window.location.href : 'http://localhost'),
      handleCodeInApp: true
    };
    await sendSignInLinkToEmail(this.auth, email, actionCodeSettings);
    return true;
  },

  isSignInWithEmailLink(url) {
    if (!this.auth) return false;
    return isSignInWithEmailLink(this.auth, url || (typeof window !== 'undefined' ? window.location.href : ''));
  },

  async signInWithEmailLink(email, url) {
    if (!this.auth) return null;
    const cred = await signInWithEmailLink(this.auth, email, url || (typeof window !== 'undefined' ? window.location.href : ''));
    this.currentUser = cred.user;
    return cred.user;
  },

  async signOut() {
    if (!this.auth) return;
    await signOut(this.auth);
    this.currentUser = null;
  },

  async sendPasswordReset(email) {
    if (!this.auth) return;
    await sendPasswordResetEmail(this.auth, email);
  },

  getUser() {
    return this.currentUser || (this.auth ? this.auth.currentUser : null);
  },

  getUserId() {
    const u = this.getUser();
    return u ? u.uid : null;
  },

  async saveNoteMeta(userId, noteId, record) {
    if (!this.db || !userId || !noteId) return false;
    const metaRef = ref(this.db, `users/${userId}/vault/${noteId}/meta`);
    const payload = {
      ...record,
      schemaVersion: record?.schemaVersion !== undefined ? record.schemaVersion : 2,
      appVersion: record?.appVersion || '4.0.0'
    };
    await set(metaRef, payload);
    return true;
  },

  async saveNoteBody(userId, noteId, record) {
    if (!this.db || !userId || !noteId) return false;
    const bodyRef = ref(this.db, `users/${userId}/vault/${noteId}/body`);
    const payload = {
      ...record,
      schemaVersion: record?.schemaVersion !== undefined ? record.schemaVersion : 2,
      appVersion: record?.appVersion || '4.0.0'
    };
    await set(bodyRef, payload);
    return true;
  },

  async saveNote(userId, noteId, record) {
    if (!this.db || !userId || !noteId) return false;
    if (record && (record.meta || record.body)) {
      if (record.meta) await this.saveNoteMeta(userId, noteId, record.meta);
      if (record.body) await this.saveNoteBody(userId, noteId, record.body);
      return true;
    }
    const noteRef = ref(this.db, `users/${userId}/vault/${noteId}`);
    const payload = {
      ...record,
      schemaVersion: record?.schemaVersion !== undefined ? record.schemaVersion : 1,
      appVersion: record?.appVersion || '4.0.0'
    };
    await set(noteRef, payload);
    return true;
  },

  async deleteNote(userId, noteId, appVersion = '4.0.0') {
    if (!this.db || !userId || !noteId) return false;
    // Mark deleted on meta node (and also base note for legacy listeners)
    const metaRef = ref(this.db, `users/${userId}/vault/${noteId}/meta`);
    await set(metaRef, {
      id: noteId,
      deleted: true,
      updatedAt: Date.now(),
      schemaVersion: 2,
      appVersion
    });
    return true;
  },

  async getNoteMeta(userId, noteId) {
    if (!this.db || !userId || !noteId) return null;
    const snap = await get(ref(this.db, `users/${userId}/vault/${noteId}/meta`));
    return snap.exists() ? snap.val() : null;
  },

  async getNoteBody(userId, noteId) {
    if (!this.db || !userId || !noteId) return null;
    const snap = await get(ref(this.db, `users/${userId}/vault/${noteId}/body`));
    return snap.exists() ? snap.val() : null;
  },

  async getNote(userId, noteId) {
    if (!this.db || !userId || !noteId) return null;
    const noteRef = ref(this.db, `users/${userId}/vault/${noteId}`);
    const snapshot = await get(noteRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.val();
    return data;
  },

  async saveVaultMeta(userId, meta) {
    if (!this.db || !userId || !meta) return false;
    const metaRef = ref(this.db, `users/${userId}/vault_meta`);
    const payload = {
      ...meta,
      schemaVersion: meta?.schemaVersion !== undefined ? meta.schemaVersion : 1,
      appVersion: meta?.appVersion || '4.0.0'
    };
    await set(metaRef, payload);
    return true;
  },

  async getVaultMeta(userId) {
    if (!this.db || !userId) return null;
    const metaRef = ref(this.db, `users/${userId}/vault_meta`);
    const snapshot = await get(metaRef);
    return snapshot.exists() ? snapshot.val() : null;
  },

  async getAllNotes(userId) {
    if (!this.db || !userId) return [];
    const vaultRef = ref(this.db, `users/${userId}/vault`);
    const snapshot = await get(vaultRef);
    if (!snapshot.exists()) return [];
    const data = snapshot.val();
    return Object.entries(data).map(([id, val]) => {
      if (val && typeof val === 'object' && val.meta) {
        return { id, ...val };
      }
      return val;
    });
  },

  listenVault(userId, onUpdate, onError) {
    if (!this.db || !userId) return () => {};
    const vaultRef = ref(this.db, `users/${userId}/vault`);
    const unsubscribe = onValue(
      vaultRef,
      (snapshot) => {
        const val = snapshot.exists() ? snapshot.val() : {};
        if (typeof onUpdate === 'function') {
          onUpdate(val);
        }
      },
      (err) => {
        if (typeof onError === 'function') onError(err);
      }
    );
    this._activeListeners.set(userId, unsubscribe);
    return () => {
      unsubscribe();
      this._activeListeners.delete(userId);
    };
  },

  // ── Generic & Itemized encrypted documents (todos, planner, chat, colleagues, etc.) ──
  async saveDocItem(userId, kind, itemId, record) {
    if (!this.db || !userId || !kind || !itemId) return false;
    const docRef = ref(this.db, `users/${userId}/docs/${kind}/${itemId}`);
    await set(docRef, {
      ...record,
      schemaVersion: record?.schemaVersion !== undefined ? record.schemaVersion : 2,
      appVersion: record?.appVersion || '4.0.0'
    });
    return true;
  },

  async deleteDocItem(userId, kind, itemId, appVersion = '4.0.0') {
    if (!this.db || !userId || !kind || !itemId) return false;
    const docRef = ref(this.db, `users/${userId}/docs/${kind}/${itemId}`);
    await set(docRef, { id: itemId, deleted: true, updatedAt: Date.now(), schemaVersion: 2, appVersion });
    return true;
  },

  async getDocItem(userId, kind, itemId) {
    if (!this.db || !userId || !kind || !itemId) return null;
    const docRef = ref(this.db, `users/${userId}/docs/${kind}/${itemId}`);
    const snap = await get(docRef);
    return snap.exists() ? snap.val() : null;
  },

  async saveDoc(userId, docId, record) {
    if (!this.db || !userId || !docId) return false;
    const docRef = ref(this.db, `users/${userId}/docs/${docId}`);
    await set(docRef, {
      ...record,
      schemaVersion: record?.schemaVersion !== undefined ? record.schemaVersion : 1,
      appVersion: record?.appVersion || '4.0.0'
    });
    return true;
  },

  async deleteDoc(userId, docId, appVersion = '4.0.0') {
    if (!this.db || !userId || !docId) return false;
    const docRef = ref(this.db, `users/${userId}/docs/${docId}`);
    await set(docRef, { id: docId, deleted: true, updatedAt: Date.now(), schemaVersion: 1, appVersion });
    return true;
  },

  async getAllDocs(userId) {
    if (!this.db || !userId) return [];
    const snapshot = await get(ref(this.db, `users/${userId}/docs`));
    return snapshot.exists() ? Object.values(snapshot.val()) : [];
  },

  listenDocs(userId, onUpdate, onError) {
    if (!this.db || !userId) return () => {};
    const unsubscribe = onValue(
      ref(this.db, `users/${userId}/docs`),
      (snapshot) => {
        if (typeof onUpdate === 'function') onUpdate(snapshot.exists() ? snapshot.val() : {});
      },
      (err) => {
        if (typeof onError === 'function') onError(err);
      }
    );
    return unsubscribe;
  },

  // ── Encrypted binary assets (images). Ciphertext is chunked into separate nodes. ──
  ASSET_CHUNK_SIZE: 2 * 1024 * 1024,

  async saveAsset(userId, assetId, record) {
    if (!this.db || !userId || !assetId || !record) return false;
    const { ciphertext = '', ...meta } = record;
    const chunks = [];
    for (let i = 0; i < ciphertext.length; i += this.ASSET_CHUNK_SIZE) {
      chunks.push(ciphertext.slice(i, i + this.ASSET_CHUNK_SIZE));
    }
    // Chunks first, meta last: readers never observe a half-written asset.
    for (let i = 0; i < chunks.length; i++) {
      await set(ref(this.db, `users/${userId}/assets/${assetId}/chunks/${i}`), chunks[i]);
    }
    await set(ref(this.db, `users/${userId}/assets/${assetId}/meta`), {
      ...meta,
      chunkCount: chunks.length,
      schemaVersion: meta.schemaVersion !== undefined ? meta.schemaVersion : 1
    });
    return true;
  },

  async getAsset(userId, assetId) {
    if (!this.db || !userId || !assetId) return null;
    const metaSnap = await get(ref(this.db, `users/${userId}/assets/${assetId}/meta`));
    if (!metaSnap.exists()) return null;
    const meta = metaSnap.val();
    if (meta.deleted) return null;
    let ciphertext = '';
    for (let i = 0; i < (meta.chunkCount || 0); i++) {
      const snap = await get(ref(this.db, `users/${userId}/assets/${assetId}/chunks/${i}`));
      if (!snap.exists()) return null;
      ciphertext += snap.val();
    }
    return { ...meta, ciphertext };
  },

  async deleteAsset(userId, assetId) {
    if (!this.db || !userId || !assetId) return false;
    await remove(ref(this.db, `users/${userId}/assets/${assetId}`));
    return true;
  },

  async getAppInfo() {
    if (!this.db) return null;
    try {
      const infoRef = ref(this.db, 'app_info');
      const snapshot = await get(infoRef);
      return snapshot.exists() ? snapshot.val() : null;
    } catch (err) {
      console.warn('FirebaseBridge.getAppInfo failed:', err);
      return null;
    }
  },

  listenAppInfo(onUpdate, onError) {
    if (!this.db) return () => {};
    try {
      const infoRef = ref(this.db, 'app_info');
      const unsubscribe = onValue(
        infoRef,
        (snapshot) => {
          const val = snapshot.exists() ? snapshot.val() : null;
          if (typeof onUpdate === 'function') {
            onUpdate(val);
          }
        },
        (err) => {
          if (typeof onError === 'function') onError(err);
        }
      );
      this._activeListeners.set('app_info', unsubscribe);
      return () => {
        unsubscribe();
        this._activeListeners.delete('app_info');
      };
    } catch (err) {
      console.warn('FirebaseBridge.listenAppInfo failed:', err);
      return () => {};
    }
  }
};

if (typeof window !== 'undefined') {
  window.FirebaseBridge = FirebaseBridge;
}
if (typeof globalThis !== 'undefined') {
  globalThis.FirebaseBridge = FirebaseBridge;
}
