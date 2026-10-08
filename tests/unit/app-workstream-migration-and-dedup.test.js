import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Workstream Canonical Deduplication & Multi-Hop Vault Migration Survival', () => {
  let virtualFS = new Map();

  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.window.AppBridge = {
      fs: {
        hasNativeFS: () => true,
        async readFile(pathStr) {
          if (virtualFS.has(pathStr)) return virtualFS.get(pathStr);
          const err = new Error(`File not found: ${pathStr}`);
          err.name = 'NotFoundError';
          throw err;
        },
        async writeFile(pathStr, content) {
          virtualFS.set(pathStr, String(content));
          return true;
        },
        async deleteFile(pathStr) {
          virtualFS.delete(pathStr);
          return true;
        },
        async fileExists(pathStr) {
          return virtualFS.has(pathStr);
        },
        async listFiles(subDir) {
          const prefix = subDir ? `${subDir}/` : '';
          const matches = [];
          for (const k of virtualFS.keys()) {
            if (k.startsWith(prefix)) {
              const rel = k.slice(prefix.length);
              if (!rel.includes('/')) {
                matches.push({ name: rel, isFile: true, isDirectory: false });
              }
            }
          }
          return matches;
        }
      }
    };

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-fs.js',
      'js/app-crypto.js',
      'js/app-firebase-sync.js',
      'js/app-topic-memory.js',
      'js/app-storage.js',
      'js/app-board.js',
      'js/app-todos-board.js'
    ]);
  });

  beforeEach(() => {
    virtualFS.clear();
    global.manifest = [];
    global.todosManifest = [];
    globalThis.manifest = [];
    globalThis.todosManifest = [];
    if (globalThis.window) {
      window.manifest = [];
      window.todosManifest = [];
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    if (typeof _topicMemoriesIndexCache !== 'undefined') {
      _topicMemoriesIndexCache = null;
    }
    if (typeof _topicMemoryFileCache !== 'undefined' && _topicMemoryFileCache instanceof Map) {
      _topicMemoryFileCache.clear();
    }
    window.StorageAPI.setStorageEngine('filesystem');
    window.StorageAPI.clearNoteCache();
    window.FirebaseSyncService.state.isUnlocked = false;
    window.FirebaseSyncService.state.masterKey = null;
    window.FirebaseSyncService.state.engine = 'filesystem';
    window.FirebaseSyncService.state.localCache.clear();
    if (window.FirebaseSyncService.state.manifestCache) {
      window.FirebaseSyncService.state.manifestCache.clear();
    }
    if (window.FirebaseSyncService.state.encryptedDocs) {
      window.FirebaseSyncService.state.encryptedDocs.clear();
    }
    if (window.FirebaseSyncService.state.docsCache) {
      window.FirebaseSyncService.state.docsCache.clear();
    }
  });

  describe('Bug 2: Workstream Canonical Deduplication in getKnownWorkstreamsList', () => {
    it('deduplicates lowercase keys and capitalized display names to single formatted workstream', () => {
      global._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Marketing', key: 'marketing', status: 'active' },
          { topicName: 'Strategic Planning', key: 'strategic_planning', status: 'active' }
        ]
      };

      const candidateNotes = [
        { id: 'n1', workstream: 'marketing' },
        { id: 'n2', workstream: 'Marketing' },
        { id: 'n3', workstream: 'strategic_planning' }
      ];

      global.todosManifest = [
        { id: 't1', workstream: 'marketing' },
        { id: 't2', workstream: 'Strategic Planning' }
      ];

      const list = getKnownWorkstreamsList(candidateNotes);

      // Must only contain 'Marketing' and 'Strategic Planning', without duplicates
      expect(list).toEqual(['Marketing', 'Strategic Planning']);
      expect(list).not.toContain('marketing');
      expect(list).not.toContain('strategic_planning');
    });

    it('populates workstream dropdown and selects matching canonical option for lowercase value', async () => {
      global._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Engineering', key: 'engineering', status: 'active' }
        ]
      };

      document.body.innerHTML = '<select id="todo-edit-workstream"></select>';
      await populateTodoWorkstreamDropdown('engineering');

      const select = document.getElementById('todo-edit-workstream');
      expect(select.options.length).toBe(2); // placeholder + Engineering
      expect(select.value).toBe('Engineering');
      expect(select.options[1].textContent).toBe('Engineering');
    });
  });

  describe('Bug 1: Topic Memory & Workstream Survival across Migrations', () => {
    it('preserves topic memories from filesystem -> Firebase -> Revert to Local -> Re-migrate to Firebase', async () => {
      // 1. Setup local filesystem with Topic Memories
      const topicIndex = {
        version: 1,
        topics: [
          { key: 'marketing', topicName: 'Marketing', status: 'active', summary: 'Marketing strategy' },
          { key: 'product_launch', topicName: 'Product Launch', status: 'active', summary: 'Q4 Product Launch' }
        ]
      };
      const marketingDossier = {
        key: 'marketing',
        topicName: 'Marketing',
        summary: 'Marketing strategy dossier',
        keyFacts: ['Campaign starts next Monday'],
        decisions: ['Approved budget $50k']
      };
      const launchDossier = {
        key: 'product_launch',
        topicName: 'Product Launch',
        summary: 'Q4 Product Launch dossier',
        keyFacts: ['Release date Nov 1st']
      };

      virtualFS.set('notes/manifest.json', JSON.stringify([
        { id: 'n1', path: 'notes/n1.html', title: 'Marketing Sync', workstream: 'Marketing' }
      ]));
      virtualFS.set('notes/n1.html', '<p>Marketing notes</p>');
      virtualFS.set('raw/topic-memories/index.json', JSON.stringify(topicIndex));
      virtualFS.set('raw/topic-memories/marketing.json', JSON.stringify(marketingDossier));
      virtualFS.set('raw/topic-memories/product_launch.json', JSON.stringify(launchDossier));

      // 2. First Migration: Filesystem -> Firebase Vault
      const pass = 'Vault-Roundtrip-Master-Passphrase-2026!';
      const migResult = await window.StorageAPI.migrateToFirebase(pass);
      expect(migResult.notesCount).toBe(1);

      // Verify data is now in Firebase
      const cloudIndex = await window.FirebaseSyncService.getDoc('topic_memories', 'index');
      expect(cloudIndex).not.toBeNull();
      expect(cloudIndex.topics).toHaveLength(2);
      expect(cloudIndex.topics[0].topicName).toBe('Marketing');

      const cloudMarketing = await window.FirebaseSyncService.getDoc('topic_memories', 'marketing');
      expect(cloudMarketing).not.toBeNull();
      expect(cloudMarketing.keyFacts).toContain('Campaign starts next Monday');

      // 3. Clear local workspace to simulate clean state before revert
      virtualFS.clear();
      expect(virtualFS.has('raw/topic-memories/index.json')).toBe(false);

      // 4. Migration Back: Revert from Firebase to Filesystem
      const revertResult = await window.StorageAPI.revertToFilesystem();
      expect(revertResult.notesCount).toBe(1);
      expect(window.StorageAPI.getStorageEngine()).toBe('filesystem');

      // Verify files were restored on disk
      expect(virtualFS.has('raw/topic-memories/index.json')).toBe(true);
      expect(virtualFS.has('raw/topic-memories/marketing.json')).toBe(true);
      expect(virtualFS.has('raw/topic-memories/product_launch.json')).toBe(true);

      const restoredIndex = JSON.parse(virtualFS.get('raw/topic-memories/index.json'));
      expect(restoredIndex.topics).toHaveLength(2);

      const restoredMarketing = JSON.parse(virtualFS.get('raw/topic-memories/marketing.json'));
      expect(restoredMarketing.keyFacts).toContain('Campaign starts next Monday');

      // Verify in-memory and localStorage caches are synchronized
      expect(_topicMemoriesIndexCache).toEqual(restoredIndex);

      // 5. Add a third workstream locally while on filesystem
      const devDossier = {
        key: 'core_dev',
        topicName: 'Core Development',
        summary: 'Core Dev dossier',
        keyFacts: ['Refactored storage engine']
      };
      await saveMajorTopicMemory('Core Development', devDossier);

      // 6. Second Migration: Reconcile / Migrate back to Firebase
      await window.FirebaseSyncService.setupVault(pass);
      const reconcileResult = await window.StorageAPI.reconcileLocalAndCloudVault(pass, 'merge_local_priority');
      expect(reconcileResult.success).toBe(true);

      // Verify that all 3 topic memories exist in Firebase without loss
      const reCloudIndex = await window.FirebaseSyncService.getDoc('topic_memories', 'index');
      expect(reCloudIndex.topics.length).toBeGreaterThanOrEqual(3);
      expect(reCloudIndex.topics.some(t => t.topicName === 'Core Development')).toBe(true);
      expect(reCloudIndex.topics.some(t => t.topicName === 'Marketing')).toBe(true);

      const reCloudDev = await window.FirebaseSyncService.getDoc('topic_memories', 'core_development');
      expect(reCloudDev).not.toBeNull();
      expect(reCloudDev.keyFacts).toContain('Refactored storage engine');
    });
  });
});
