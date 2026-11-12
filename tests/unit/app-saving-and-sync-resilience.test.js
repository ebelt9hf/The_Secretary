import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Saving, Synchronization & Progress Resilience Architecture (Track A)', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || globalThis;
    globalThis.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    globalThis.escA = (s) => String(s || '');
    globalThis.jq = (s) => JSON.stringify(String(s || ''));
    globalThis.toast = vi.fn();
    globalThis.broadcastSync = vi.fn();
    globalThis.rebuildIndexHTML = vi.fn().mockResolvedValue(true);
    globalThis.saveManifest = vi.fn().mockResolvedValue(true);
    globalThis.upsertManifest = vi.fn();
    globalThis.populateTagEditor = vi.fn();
    globalThis.readTagEditor = vi.fn().mockReturnValue([]);

    loadScriptsIntoGlobal([
      'js/app-state.js',
      'js/app-fs.js',
      'js/app-idb.js',
      'js/app-crypto.js',
      'js/app-storage.js',
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-notes.js',
      'js/app-overlay.js',
      'js/app-planner.js',
      'js/app-firebase-sync.js'
    ]);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    StorageAPI.clearSyncQueue();
    StorageAPI.setStorageEngine('filesystem');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('Pillar 1: Two-Phase At-Least-Once Delivery in FirebaseSyncService.flushQueue', () => {
    /**
     * 1. Protected Behavior: flushQueue() does NOT remove items from pendingQueue until the bridge push resolves successfully.
     * 2. Regression Target: Dropping items prematurely from pendingQueue and setting status to SYNCED even when cloud push throws.
     * 3. Coverage Overlap: None; verifies atomic two-phase commit and retry scheduling for failed cloud note pushes.
     * 4. Production Code Footprint: Tests authentic FirebaseSyncService.flushQueue.
     */
    it('retains failed items in pendingQueue and sets error status when bridge.saveNote throws', async () => {
      FirebaseSyncService.state.engine = 'firebase';
      FirebaseSyncService.state.isUnlocked = true;
      FirebaseSyncService.state.userId = 'user_test_123';
      FirebaseSyncService.state.masterKey = 'mock_key';
      FirebaseSyncService.state.pendingQueue = new Map();
      FirebaseSyncService.state.pendingDocsQueue = new Map();
      FirebaseSyncService.state.pendingAssetsQueue = new Map();

      const noteToSync = {
        id: 'note-important-1',
        title: 'Executive Strategy',
        contentHtml: '<p>Critical Data</p>',
        updatedAt: 1000
      };
      FirebaseSyncService.state.pendingQueue.set('note-important-1', noteToSync);

      // Mock bridge to simulate network failure
      const mockBridge = {
        saveNote: vi.fn().mockRejectedValue(new Error('Firebase network connection timed out')),
        saveNoteMeta: vi.fn().mockRejectedValue(new Error('Firebase network connection timed out'))
      };
      vi.spyOn(FirebaseSyncService, '_getBridge').mockReturnValue(mockBridge);
      vi.spyOn(CryptoEngine, 'encryptData').mockResolvedValue({ iv: 'mock_iv', ciphertext: 'mock_cipher' });

      await FirebaseSyncService.flushQueue();

      // Verify the note was NOT dropped from pendingQueue
      expect(FirebaseSyncService.state.pendingQueue.has('note-important-1')).toBe(true);
      // Status must reflect error or scheduled retry, NOT falsely 'synced'
      expect(FirebaseSyncService.state.status).toBe(FirebaseSyncService.STATUS.ERROR);
      expect(FirebaseSyncService.state.lastError).toContain('Firebase network connection timed out');
      expect(FirebaseSyncService.state.cloudRetryTimer).not.toBeNull();

      if (FirebaseSyncService.state.cloudRetryTimer) {
        clearTimeout(FirebaseSyncService.state.cloudRetryTimer);
        FirebaseSyncService.state.cloudRetryTimer = null;
      }
    });

    /**
     * 1. Protected Behavior: Concurrent flushQueue() invocations are serialized so an in-flight cloud upload is never duplicated in parallel and newly queued revisions are flushed in order after the active pass completes.
     * 2. Regression Target: Two concurrent flushQueue() calls snapshotting and uploading the same item simultaneously or overwriting a newer revision out of order.
     * 3. Coverage Overlap: None; tests concurrency serialization of FirebaseSyncService.flushQueue.
     * 4. Production Code Footprint: Tests authentic FirebaseSyncService.flushQueue without test-only production flags.
     */
    it('serializes concurrent flushQueue calls so overlapping flushes do not upload the same note in parallel or out of order', async () => {
      FirebaseSyncService.state.engine = 'firebase';
      FirebaseSyncService.state.isUnlocked = true;
      FirebaseSyncService.state.userId = 'user_test_123';
      FirebaseSyncService.state.masterKey = 'mock_key';
      FirebaseSyncService.state.status = FirebaseSyncService.STATUS.SYNCING;
      FirebaseSyncService.state.pendingQueue = new Map();
      FirebaseSyncService.state.pendingDocsQueue = new Map();
      FirebaseSyncService.state.pendingAssetsQueue = new Map();

      let inFlightUploads = 0;
      let maxConcurrentUploads = 0;
      const uploadedOrder = [];
      let releaseFirstUpload = null;
      let markFirstUploadStarted = null;
      const firstUploadStarted = new Promise(resolve => { markFirstUploadStarted = resolve; });
      const firstUploadGate = new Promise(resolve => { releaseFirstUpload = resolve; });
      let callCount = 0;

      const mockBridge = {
        saveNoteMeta: vi.fn(async (_uid, id, encMeta) => {
          callCount++;
          inFlightUploads++;
          maxConcurrentUploads = Math.max(maxConcurrentUploads, inFlightUploads);
          uploadedOrder.push(`${id}@${encMeta.updatedAt}`);
          if (callCount === 1) {
            markFirstUploadStarted();
            await firstUploadGate;
          }
          inFlightUploads--;
        }),
        saveNoteBody: vi.fn().mockResolvedValue(undefined)
      };
      vi.spyOn(FirebaseSyncService, '_getBridge').mockReturnValue(mockBridge);
      vi.spyOn(CryptoEngine, 'encryptData').mockResolvedValue({ iv: 'mock_iv', ciphertext: 'mock_cipher' });

      FirebaseSyncService.state.pendingQueue.set('note-race-1', {
        id: 'note-race-1',
        title: 'Rev 1',
        contentHtml: '<p>v1</p>',
        updatedAt: 1000
      });

      const firstFlush = FirebaseSyncService.flushQueue();
      try {
        await firstUploadStarted;

        // Queue a newer revision while first flush is still in flight and trigger a second flush
        FirebaseSyncService.state.pendingQueue.set('note-race-1', {
          id: 'note-race-1',
          title: 'Rev 2',
          contentHtml: '<p>v2</p>',
          updatedAt: 2000
        });
        const secondFlush = FirebaseSyncService.flushQueue();

        // Neither should overlap concurrently
        expect(maxConcurrentUploads).toBe(1);
        expect(callCount).toBe(1);

        releaseFirstUpload();
        await Promise.all([firstFlush, secondFlush]);

        expect(maxConcurrentUploads).toBe(1);
        expect(uploadedOrder).toEqual(['note-race-1@1000', 'note-race-1@2000']);
        expect(FirebaseSyncService.state.pendingQueue.size).toBe(0);
      } finally {
        releaseFirstUpload();
        await firstFlush.catch(() => {});
      }
    });

    /**
     * 1. Protected Behavior: flushQueue() removes items from pendingQueue only upon successful cloud write acknowledgement.
     * 2. Regression Target: Items never being removed or corrupting queue state on success.
     * 3. Coverage Overlap: None; verifies successful two-phase flush commit.
     * 4. Production Code Footprint: Tests authentic FirebaseSyncService.flushQueue.
     */
    it('removes items from pendingQueue only when bridge push succeeds', async () => {
      FirebaseSyncService.state.engine = 'firebase';
      FirebaseSyncService.state.isUnlocked = true;
      FirebaseSyncService.state.userId = 'user_test_123';
      FirebaseSyncService.state.masterKey = 'mock_key';
      FirebaseSyncService.state.pendingQueue = new Map();
      FirebaseSyncService.state.pendingDocsQueue = new Map();
      FirebaseSyncService.state.pendingAssetsQueue = new Map();

      const noteToSync = {
        id: 'note-success-1',
        title: 'Success Note',
        contentHtml: '<p>Done</p>',
        updatedAt: 2000
      };
      FirebaseSyncService.state.pendingQueue.set('note-success-1', noteToSync);

      const mockBridge = {
        saveNote: vi.fn().mockResolvedValue(true)
      };
      vi.spyOn(FirebaseSyncService, '_getBridge').mockReturnValue(mockBridge);
      vi.spyOn(CryptoEngine, 'encryptData').mockResolvedValue({ iv: 'mock_iv', ciphertext: 'mock_cipher' });

      await FirebaseSyncService.flushQueue();

      expect(FirebaseSyncService.state.pendingQueue.has('note-success-1')).toBe(false);
      expect(FirebaseSyncService.state.status).toBe(FirebaseSyncService.STATUS.SYNCED);
      expect(FirebaseSyncService.state.lastError).toBeNull();
    });

    /**
     * 1. Protected Behavior: flushQueue() does NOT drop items from pendingQueue if vault is locked in Firebase mode.
     * 2. Regression Target: Accidental wipe of queued notes when flush is called after lockVault() or before passphrase entry.
     * 3. Coverage Overlap: None; specifically validates locked vault queue preservation.
     * 4. Production Code Footprint: Tests authentic FirebaseSyncService.flushQueue.
     */
    it('preserves pendingQueue when flushQueue is invoked while vault is locked', async () => {
      FirebaseSyncService.state.engine = 'firebase';
      FirebaseSyncService.state.isUnlocked = false;
      FirebaseSyncService.state.userId = 'user_test_cloud';
      FirebaseSyncService.state.masterKey = null;
      FirebaseSyncService.state.pendingQueue = new Map();

      const noteToSync = {
        id: 'note-locked-vault',
        title: 'Secret Note',
        contentHtml: '<p>Must not be lost</p>',
        updatedAt: 3000
      };
      FirebaseSyncService.state.pendingQueue.set('note-locked-vault', noteToSync);

      await FirebaseSyncService.flushQueue();

      // Pending note must still be present in queue waiting for vault unlock!
      expect(FirebaseSyncService.state.pendingQueue.has('note-locked-vault')).toBe(true);
    });

    /**
     * 1. Protected Behavior: lockVault() cancels active cloudRetryTimer and resets cloudRetryCount.
     * 2. Regression Target: Background cloud retry firing after vault lock and throwing unhandled crypto errors.
     * 3. Coverage Overlap: None; verifies timer cleanup on vault lock.
     * 4. Production Code Footprint: Tests authentic FirebaseSyncService.lockVault.
     */
    it('cancels active cloudRetryTimer and resets retry count on lockVault', () => {
      let fired = false;
      FirebaseSyncService.state.cloudRetryTimer = setTimeout(() => { fired = true; }, 5000);
      FirebaseSyncService.state.cloudRetryCount = 3;

      FirebaseSyncService.lockVault();

      expect(FirebaseSyncService.state.cloudRetryTimer).toBeNull();
      expect(FirebaseSyncService.state.cloudRetryCount).toBe(0);
      expect(FirebaseSyncService.state.isUnlocked).toBe(false);
    });
  });

  describe('Pillar 2: Cold-Cache Note Body Protection in listenVault', () => {
    /**
     * 1. Protected Behavior: listenVault does NOT overwrite existing local note body with empty string when remote note is metadata-only and note is cold in RAM.
     * 2. Regression Target: Wiping out note content to "" when receiving a remote metadata update (e.g. pinned state) on an un-cached note.
     * 3. Coverage Overlap: None; specifically validates defensive preservation of note body on metadata updates.
     * 4. Production Code Footprint: Tests authentic listenVault processing pipeline.
     */
    it('preserves existing local note body from IndexedDB when remote update is metadata-only', async () => {
      FirebaseSyncService.state.userId = 'user_test_123';
      FirebaseSyncService.state.masterKey = 'mock_key';
      FirebaseSyncService.state.localCache = new Map(); // cold cache: note is NOT in RAM!

      // Mock IndexedDB to contain the existing full note body
      vi.spyOn(VaultIDBStorage, 'getNote').mockResolvedValue({
        id: 'note-cold-1',
        title: 'Original Title',
        contentHtml: '<p>Priceless Research Content</p>',
        updatedAt: 500
      });

      const putNoteSpy = vi.spyOn(VaultIDBStorage, 'putNote').mockResolvedValue(true);
      vi.spyOn(CryptoEngine, 'decryptData').mockResolvedValue({
        id: 'note-cold-1',
        title: 'Updated Title',
        pinned: true,
        updatedAt: 600
      });

      let vaultListener = null;
      const mockBridge = {
        listenVault: vi.fn((userId, cb) => {
          vaultListener = cb;
          return () => {};
        })
      };
      vi.spyOn(FirebaseSyncService, '_getBridge').mockReturnValue(mockBridge);

      FirebaseSyncService.state.isUnlocked = true;
      FirebaseSyncService.listenRemoteVault();
      expect(vaultListener).not.toBeNull();

      // Remote doc has meta ciphertext (pinned change) but NO body ciphertext!
      const remoteNotesMap = {
        'note-cold-1': {
          meta: {
            id: 'note-cold-1',
            iv: 'meta_iv',
            ciphertext: 'meta_ciphertext',
            updatedAt: 600
          },
          body: null // No body sent over the wire!
        }
      };

      await vaultListener(remoteNotesMap);

      expect(putNoteSpy).toHaveBeenCalled();
      const savedDoc = putNoteSpy.mock.calls[0][0];
      // Note body MUST be preserved from IndexedDB, NOT wiped to empty string!
      expect(savedDoc.contentHtml).toBe('<p>Priceless Research Content</p>');
      expect(savedDoc.pinned).toBe(true);
    });
  });

  describe('Pillar 3: Unified Manifest Persistence Routing in StorageAPI', () => {
    /**
     * 1. Protected Behavior: StorageAPI.writeNotesManifest routes through writeDocEntity for atomic queue, cooperative supersession, and emergency snapshot recovery.
     * 2. Regression Target: Direct writeFile call bypassing the sync queue and lacking revision tracking.
     * 3. Coverage Overlap: None; verifies parity between notes manifest and other system manifests.
     * 4. Production Code Footprint: Tests authentic StorageAPI.writeNotesManifest.
     */
    it('routes notes/manifest.json writes through writeDocEntity queue in filesystem mode', async () => {
      const writeDocSpy = vi.spyOn(StorageAPI, 'writeDocEntity').mockResolvedValue(true);
      const manifestList = [{ id: 'note-1', title: 'Note 1' }];

      await StorageAPI.writeNotesManifest(manifestList);

      expect(writeDocSpy).toHaveBeenCalledWith(
        'notes',
        'manifest',
        'notes/manifest.json',
        manifestList
      );
    });
  });

  describe('Pillar 4: Bounded Timeout Resiliency in finalizeSaves and deleteCurrentNote', () => {
    /**
     * 1. Protected Behavior: finalizeSaves completes within bounded timeout even when filesystem writes hang.
     * 2. Regression Target: Indefinite application shutdown freeze at 60%.
     * 3. Coverage Overlap: None; verifies bounded exit wait.
     * 4. Production Code Footprint: Tests authentic finalizeSaves.
     */
    it('resolves finalizeSaves within bounded timeout even when an active write promise hangs', async () => {
      let unblock;
      const hangingPromise = new Promise(resolve => { unblock = resolve; });
      _activeWrites.add(hangingPromise);

      const start = Date.now();
      await finalizeSaves();
      const elapsed = Date.now() - start;

      // Must resolve within bounded timeout (<= 4500ms), not hang indefinitely
      expect(elapsed).toBeLessThan(4500);

      _activeWrites.delete(hangingPromise);
      unblock();
    });
  });

  describe('Pillar 5: Universal Watchdog Timer for Progress Modals', () => {
    /**
     * 1. Protected Behavior: showNoteDeletionProgress auto-dismisses after watchdog timeout if caller stalls.
     * 2. Regression Target: Deletion progress dialog permanently trapped on screen at 70%.
     * 3. Coverage Overlap: None; tests watchdog self-dismissal.
     * 4. Production Code Footprint: Tests authentic showNoteDeletionProgress contract.
     */
    it('auto-dismisses showNoteDeletionProgress when watchdog timer fires', () => {
      vi.useFakeTimers();
      try {
        const closeFn = showNoteDeletionProgress('Test Note');
        expect(document.querySelector('.note-deletion-progress-overlay')).not.toBeNull();

        // Advance timers past watchdog threshold (8 seconds)
        vi.advanceTimersByTime(8500);

        expect(document.querySelector('.note-deletion-progress-overlay')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * 1. Protected Behavior: showPlannerBlocCreationProgress auto-dismisses after watchdog timeout if saving deadlocks.
     * 2. Regression Target: Planner bloc creation modal permanently trapped on screen.
     * 3. Coverage Overlap: None; tests planner bloc creation watchdog.
     * 4. Production Code Footprint: Tests authentic showPlannerBlocCreationProgress contract.
     */
    it('auto-dismisses showPlannerBlocCreationProgress when watchdog timer fires', () => {
      vi.useFakeTimers();
      try {
        const closeFn = showPlannerBlocCreationProgress('Scheduling...');
        expect(document.querySelector('.planner-progress-overlay')).not.toBeNull();

        // Advance timers past watchdog threshold (10 seconds)
        vi.advanceTimersByTime(10500);

        expect(document.querySelector('.planner-progress-overlay')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * 1. Protected Behavior: All progress dialog controllers support polymorphic closure via both direct function invocation () and .close() method.
     * 2. Regression Target: Calling controller.close() or controller() throwing TypeError: controller is not a function or controller.close is not a function.
     * 3. Coverage Overlap: None; validates unified polymorphic controller interface across dialog variants.
     * 4. Production Code Footprint: Tests authentic progress dialog contracts.
     */
    it('supports polymorphic controller closure via both direct invocation and .close() across dialogs', () => {
      // 1. showNoteDeletionProgress
      const del1 = showNoteDeletionProgress('Note 1');
      expect(typeof del1.close).toBe('function');
      del1.close();
      expect(document.querySelector('.note-deletion-progress-overlay')).toBeNull();

      const del2 = showNoteDeletionProgress('Note 2');
      del2(); // direct callable invocation
      expect(document.querySelector('.note-deletion-progress-overlay')).toBeNull();

      // 2. showPlannerNoteGenerationProgress
      const pGen1 = showPlannerNoteGenerationProgress('Gen 1');
      expect(typeof pGen1.close).toBe('function');
      pGen1.close();
      expect(document.querySelector('.planner-progress-overlay')).toBeNull();

      const pGen2 = showPlannerNoteGenerationProgress('Gen 2');
      pGen2();
      expect(document.querySelector('.planner-progress-overlay')).toBeNull();

      // 3. showPlannerBlocCreationProgress
      const pBloc1 = showPlannerBlocCreationProgress('Bloc 1');
      expect(typeof pBloc1.close).toBe('function');
      pBloc1.close();
      expect(document.querySelector('.planner-progress-overlay')).toBeNull();

      const pBloc2 = showPlannerBlocCreationProgress('Bloc 2');
      pBloc2();
      expect(document.querySelector('.planner-progress-overlay')).toBeNull();

      // 4. showNoteCloseProgressDialog
      const nClose1 = showNoteCloseProgressDialog('Closing 1');
      expect(typeof nClose1).toBe('function');
      nClose1();
      expect(document.querySelector('.dialog-overlay')).toBeNull();

      const nClose2 = showNoteCloseProgressDialog('Closing 2');
      nClose2.close();
      expect(document.querySelector('.dialog-overlay')).toBeNull();
    });
  });
});
