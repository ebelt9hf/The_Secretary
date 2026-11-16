import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

/**
 * In-memory FileSystemDirectoryHandle / FileSystemWritableFileStream mock
 * exercising the real Web File System Access API path in js/app-fs.js.
 */
function createVirtualRootHandle(filesMap) {
  function makeDirHandle(prefix) {
    return {
      kind: 'directory',
      name: prefix || 'root',
      async getDirectoryHandle(name, opts = {}) {
        const nextPrefix = prefix ? `${prefix}/${name}` : name;
        const hasAny = Array.from(filesMap.keys()).some(k => k.startsWith(`${nextPrefix}/`));
        if (!hasAny && !opts.create) {
          const err = new Error(`Directory not found: ${nextPrefix}`);
          err.name = 'NotFoundError';
          throw err;
        }
        return makeDirHandle(nextPrefix);
      },
      async getFileHandle(name, opts = {}) {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        if (!filesMap.has(fullPath) && !opts.create) {
          const err = new Error(`File not found: ${fullPath}`);
          err.name = 'NotFoundError';
          throw err;
        }
        if (!filesMap.has(fullPath) && opts.create) {
          filesMap.set(fullPath, '');
        }
        return {
          kind: 'file',
          name,
          async getFile() {
            const content = filesMap.get(fullPath) ?? '';
            return {
              async text() {
                return String(content);
              }
            };
          },
          async createWritable() {
            let staged = '';
            let closed = false;
            return {
              async write(chunk) {
                if (closed) throw new Error('Stream already closed');
                staged += typeof chunk === 'string' ? chunk : String(chunk);
              },
              async close() {
                if (closed) return;
                closed = true;
                filesMap.set(fullPath, staged);
              },
              async abort() {
                closed = true;
              }
            };
          }
        };
      },
      async removeEntry(name) {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        if (!filesMap.has(fullPath)) {
          const err = new Error(`File not found: ${fullPath}`);
          err.name = 'NotFoundError';
          throw err;
        }
        filesMap.delete(fullPath);
      },
      async *entries() {
        const seen = new Set();
        const dirPrefix = prefix ? `${prefix}/` : '';
        for (const key of filesMap.keys()) {
          if (!key.startsWith(dirPrefix)) continue;
          const rest = key.slice(dirPrefix.length);
          const slashIdx = rest.indexOf('/');
          if (slashIdx === -1) {
            yield [rest, await this.getFileHandle(rest)];
          } else {
            const sub = rest.slice(0, slashIdx);
            if (!seen.has(sub)) {
              seen.add(sub);
              yield [sub, makeDirHandle(dirPrefix + sub)];
            }
          }
        }
      }
    };
  }
  return makeDirHandle('');
}

describe('Core Persistence Suite: Notes, Blocs, Colleagues, and Manifest', () => {
  const virtualDisk = new Map();

  beforeAll(() => {
    globalThis.window = globalThis.window || globalThis;
    globalThis.t = (k) => k;
    globalThis.toast = vi.fn();
    globalThis.broadcastSync = vi.fn();
    globalThis.renderPlanner = vi.fn();
    globalThis._debouncedRenderPlanner = vi.fn();
    globalThis.refreshOverlayPlannerBlocksIfOpen = vi.fn();
    globalThis.loadPlannerProposals = vi.fn().mockResolvedValue([]);
    globalThis.renderNotes = vi.fn();
    globalThis.renderBoard = vi.fn();
    globalThis.renderFilterChips = vi.fn();
    globalThis.manifest = [];
    globalThis.metadataBuffer = [];
    globalThis.plannerEvents = [];
    globalThis.colleaguesDb = { people: [], groups: [], settings: {} };

    loadScriptsIntoGlobal([
      'js/app-state.js',
      'js/app-utils.js',
      'js/app-fs.js',
      'js/app-storage.js',
      'js/app-notes.js',
      'js/app-planner.js',
      'js/app-collab.js'
    ]);
  });

  beforeEach(() => {
    virtualDisk.clear();
    globalThis.rootHandle = createVirtualRootHandle(virtualDisk);
    globalThis.window.rootHandle = globalThis.rootHandle;
    globalThis.window.AppBridge = { fs: { hasNativeFS: () => false } };
    globalThis.manifest = [];
    globalThis.metadataBuffer = [];
    globalThis.plannerEvents = [];
    globalThis.colleaguesDb = { people: [], groups: [], settings: {} };
    StorageAPI.clearNoteCache();
    StorageAPI.clearSyncQueue();
  });

  afterEach(() => {
    StorageAPI.clearSyncQueue();
    vi.restoreAllMocks();
  });

  /**
   * 1. Protected Behavior: Notes written via StorageAPI.writeNoteContent() persist through the Web FileSystemAccess
   *    writable stream to disk, survive cache eviction, reflect updates, and are removed on deleteNoteContent().
   * 2. Regression Target: Note saves silently failing, timing out, or staying only in RAM without reaching disk.
   * 3. Coverage Overlap / Redundancy: None; exercises the real app-fs.js FileSystemDirectoryHandle writable stream
   *    end-to-end across create, update, cold read, and delete.
   * 4. Production Code Footprint: None; exercises authentic StorageAPI and app-fs.js interfaces.
   */
  it('persists, updates, cold-reads, and deletes notes on disk via FileSystemAccess', async () => {
    const notePath = 'notes/note-suite-1.html';
    const initialHtml = '<!DOCTYPE html><html><body><h1>Initial Note</h1><p>First draft</p></body></html>';
    const updatedHtml = '<!DOCTYPE html><html><body><h1>Initial Note</h1><p>Updated draft</p></body></html>';

    await StorageAPI.writeNoteContent(notePath, initialHtml, { id: 'note-suite-1', title: 'Initial Note' });
    expect(virtualDisk.get(notePath)).toBe(initialHtml);

    // Update existing note
    await StorageAPI.writeNoteContent(notePath, updatedHtml, { id: 'note-suite-1', title: 'Initial Note' });
    expect(virtualDisk.get(notePath)).toBe(updatedHtml);

    // Evict RAM cache and verify cold read from disk
    StorageAPI.clearNoteCache();
    const readBack = await StorageAPI.readNoteContent(notePath);
    expect(readBack).toBe(updatedHtml);

    // Delete note and verify removal from disk
    await StorageAPI.deleteNoteContent(notePath, { id: 'note-suite-1' });
    expect(virtualDisk.has(notePath)).toBe(false);
  });

  /**
   * 1. Protected Behavior: Planner blocs saved via savePlanner() persist to planner.json on disk and reload
   *    intact via loadPlanner() with all event fields and linked note IDs preserved.
   * 2. Regression Target: Planner bloc edits failing to flush to planner.json or losing fields on reload.
   * 3. Coverage Overlap / Redundancy: None; tests full savePlanner -> disk -> loadPlanner round-trip.
   * 4. Production Code Footprint: None; exercises authentic savePlanner() and loadPlanner().
   */
  it('persists planner blocs to planner.json and reloads them intact', async () => {
    const bloc = {
      id: 'bloc-suite-1',
      title: 'Architecture Review',
      type: 'sync',
      date: '2026-11-16',
      startTime: '14:00',
      endTime: '15:00',
      noteId: 'note-suite-1',
      linkedNoteIds: ['note-suite-1']
    };
    globalThis.manifest = [{ id: 'note-suite-1', path: 'notes/note-suite-1.html', date: '2026-11-16' }];
    globalThis.plannerEvents = [bloc];

    await savePlanner();

    expect(virtualDisk.has('planner.json')).toBe(true);
    const savedRaw = JSON.parse(virtualDisk.get('planner.json'));
    expect(savedRaw.events).toHaveLength(1);
    expect(savedRaw.events[0]).toMatchObject({
      id: 'bloc-suite-1',
      title: 'Architecture Review',
      type: 'sync',
      date: '2026-11-16',
      startTime: '14:00',
      endTime: '15:00',
      noteId: 'note-suite-1'
    });

    // Clear in-memory events and reload from disk
    globalThis.plannerEvents = [];
    await loadPlanner();
    expect(globalThis.plannerEvents).toHaveLength(1);
    expect(globalThis.plannerEvents[0].title).toBe('Architecture Review');
    expect(globalThis.plannerEvents[0].noteId).toBe('note-suite-1');
  });

  /**
   * 1. Protected Behavior: Colleagues saved via saveColleaguesDb() persist to colleagues.json on disk and
   *    reload intact via loadColleaguesDb().
   * 2. Regression Target: Colleagues database changes failing to write to colleagues.json or corrupting on reload.
   * 3. Coverage Overlap / Redundancy: None; tests full saveColleaguesDb -> disk -> loadColleaguesDb round-trip.
   * 4. Production Code Footprint: None; exercises authentic saveColleaguesDb() and loadColleaguesDb().
   */
  it('persists colleagues database to colleagues.json and reloads it intact', async () => {
    globalThis.colleaguesDb = ensureColleaguesDbShape({
      colleagues: [
        { id: 'col-1', label: 'Alice Martin', role: 'Engineering Lead', email: 'alice@example.com', teamId: 'team-core' },
        { id: 'col-2', label: 'Bob Durand', role: 'Product Manager', email: 'bob@example.com', teamId: 'team-core' }
      ],
      teams: [{ id: 'team-core', name: 'Core Team', managerId: 'col-1' }]
    });

    await saveColleaguesDb();

    expect(virtualDisk.has('colleagues.json')).toBe(true);
    const savedColleagues = JSON.parse(virtualDisk.get('colleagues.json'));
    expect(savedColleagues.colleagues).toHaveLength(2);
    expect(savedColleagues.colleagues[0].label).toBe('Alice Martin');
    expect(savedColleagues.teams[0].name).toBe('Core Team');

    // Reset in-memory state and reload from disk
    globalThis.colleaguesDb = ensureColleaguesDbShape(null);
    await loadColleaguesDb();
    expect(globalThis.colleaguesDb.colleagues).toHaveLength(2);
    expect(globalThis.colleaguesDb.colleagues[1].label).toBe('Bob Durand');
  });

  /**
   * 1. Protected Behavior: Notes manifest saved via saveManifest({ force: true }) persists both
   *    notes/manifest.json and notes/metadata-buffer.json to disk and reloads intact via loadManifest().
   * 2. Regression Target: Manifest writes failing or dropping note metadata entries across reloads.
   * 3. Coverage Overlap / Redundancy: None; tests full saveManifest -> disk -> loadManifest round-trip.
   * 4. Production Code Footprint: None; exercises authentic saveManifest() and loadManifest().
   */
  it('persists notes/manifest.json and metadata-buffer.json and reloads manifest intact', async () => {
    globalThis.manifest = [
      {
        id: 'note-man-1',
        path: 'notes/note-man-1.html',
        title: 'Roadmap Q4',
        date: '2026-11-16',
        group_tags: ['Strategy'],
        major_topic_tags: ['Roadmap'],
        topic_tags: ['Q4'],
        extra_tags: []
      }
    ];

    await saveManifest({ force: true });

    expect(virtualDisk.has('notes/manifest.json')).toBe(true);
    expect(virtualDisk.has('notes/metadata-buffer.json')).toBe(true);
    const diskManifest = JSON.parse(virtualDisk.get('notes/manifest.json'));
    expect(diskManifest).toHaveLength(1);
    expect(diskManifest[0]).toMatchObject({
      id: 'note-man-1',
      path: 'notes/note-man-1.html',
      title: 'Roadmap Q4'
    });

    // Clear in-memory manifest & metadataBuffer and reload from disk
    globalThis.manifest = [];
    globalThis.metadataBuffer = [];
    await loadManifest();
    expect(globalThis.manifest).toHaveLength(1);
    expect(globalThis.manifest[0].title).toBe('Roadmap Q4');
    expect(globalThis.manifest[0].group_tags).toEqual(['Strategy']);
  });

  /**
   * 1. Protected Behavior: Concurrent/burst note writes to the same note coalesce so the latest content
   *    wins on disk without stale overwrites, and Unicode/special characters survive round-trip.
   * 2. Regression Target: Out-of-order async writes overwriting newer edits with older content or corrupting UTF-8.
   * 3. Coverage Overlap / Redundancy: None; tests burst coalescing + Unicode fidelity through real app-fs.js streams.
   * 4. Production Code Footprint: None; exercises authentic StorageAPI.writeNoteContent().
   */
  it('coalesces rapid burst note writes with latest content winning and preserves Unicode', async () => {
    const notePath = 'notes/note-burst-1.html';
    const v1 = '<html><body><h1>Draft 1</h1><p>Alpha</p></body></html>';
    const v2 = '<html><body><h1>Draft 2</h1><p>Café — naïve résumé 🚀</p></body></html>';

    const p1 = StorageAPI.writeNoteContent(notePath, v1, { id: 'note-burst-1', title: 'Draft 1' });
    const p2 = StorageAPI.writeNoteContent(notePath, v2, { id: 'note-burst-1', title: 'Draft 2' });
    await Promise.allSettled([p1, p2]);

    StorageAPI.clearNoteCache();
    expect(virtualDisk.get(notePath)).toBe(v2);
    expect(await StorageAPI.readNoteContent(notePath)).toBe(v2);
  });

  /**
   * 1. Protected Behavior: When a note disk write fails (e.g. permission/lock error), StorageAPI records an
   *    emergency recovery snapshot in .history/ and surfaces the error.
   * 2. Regression Target: Silent data loss when FileSystemWritableFileStream fails during save.
   * 3. Coverage Overlap / Redundancy: None; tests note-level failure path through real StorageAPI._processSyncQueue.
   * 4. Production Code Footprint: None; exercises authentic StorageAPI.writeNoteContent() and saveSnapshot().
   */
  it('surfaces error and records emergency .history/ snapshot when note disk write fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const notePath = 'notes/note-fail-1.html';
    const html = '<html><body><h1>Unsaved Work</h1><p>Critical content</p></body></html>';
    const snapSpy = vi.spyOn(StorageAPI, 'saveSnapshot').mockResolvedValue(true);

    const origGetDir = globalThis.rootHandle.getDirectoryHandle.bind(globalThis.rootHandle);
    vi.spyOn(globalThis.rootHandle, 'getDirectoryHandle').mockImplementation(async (name, opts) => {
      if (name === 'notes') {
        throw Object.assign(new Error('Disk locked'), { name: 'NotAllowedError' });
      }
      return origGetDir(name, opts);
    });

    await expect(
      StorageAPI.writeNoteContent(notePath, html, { id: 'note-fail-1', title: 'Unsaved Work' })
    ).rejects.toThrow('Disk locked');

    expect(snapSpy).toHaveBeenCalledWith(notePath, html, 'save-failed');
    warnSpy.mockRestore();
  });

  /**
   * 1. Protected Behavior: Planner bloc deletions and corrupt planner.json recovery behave safely across reloads.
   * 2. Regression Target: Deleted blocs reappearing from stale disk state or corrupt JSON crashing loadPlanner().
   * 3. Coverage Overlap / Redundancy: None; tests bloc deletion persistence and corrupt-file recovery.
   * 4. Production Code Footprint: None; exercises authentic savePlanner() and loadPlanner().
   */
  it('persists planner bloc deletions and recovers cleanly from corrupt planner.json', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.plannerEvents = [
      { id: 'bloc-a', title: 'Keep', type: 'work', date: '2026-11-16', startTime: '09:00', endTime: '10:00' },
      { id: 'bloc-b', title: 'Delete', type: 'work', date: '2026-11-16', startTime: '11:00', endTime: '12:00' }
    ];
    await savePlanner();

    // Delete bloc-b and save again
    globalThis.plannerEvents = globalThis.plannerEvents.filter(e => e.id !== 'bloc-b');
    await savePlanner();

    globalThis.plannerEvents = [];
    await loadPlanner();
    expect(globalThis.plannerEvents.map(e => e.id)).toEqual(['bloc-a']);

    // Corrupt planner.json on disk -> loadPlanner() recovers to []
    virtualDisk.set('planner.json', '{not-valid-json');
    await loadPlanner();
    expect(globalThis.plannerEvents).toEqual([]);
    warnSpy.mockRestore();
  });

  /**
   * 1. Protected Behavior: First-run loadColleaguesDb() initializes default colleagues.json when missing, and
   *    subsequent colleague additions/deletions persist cleanly.
   * 2. Regression Target: Missing colleagues.json causing null colleaguesDb or losing updates.
   * 3. Coverage Overlap / Redundancy: None; tests cold-start creation and mutation persistence.
   * 4. Production Code Footprint: None; exercises authentic loadColleaguesDb() and saveColleaguesDb().
   */
  it('initializes colleagues.json on cold start and persists colleague updates and removals', async () => {
    expect(virtualDisk.has('colleagues.json')).toBe(false);
    await loadColleaguesDb();
    expect(virtualDisk.has('colleagues.json')).toBe(true);
    expect(globalThis.colleaguesDb.colleagues).toEqual([]);

    globalThis.colleaguesDb.colleagues.push({ id: 'col-new', label: 'Clara Jensen', role: 'Design', teamId: 'team-my-own-team' });
    await saveColleaguesDb();

    globalThis.colleaguesDb = null;
    await loadColleaguesDb();
    expect(globalThis.colleaguesDb.colleagues.map(c => c.label)).toEqual(['Clara Jensen']);
  });

  /**
   * 1. Protected Behavior: Manifest persists even when legacy notes/manifest.js fails, and debounced
   *    saveManifest() flushes to disk.
   * 2. Regression Target: Legacy manifest.js error aborting notes/manifest.json persistence or debounced saves
   *    dropping updates.
   * 3. Coverage Overlap / Redundancy: None; tests manifest.js failure isolation and debounced saveManifest().
   * 4. Production Code Footprint: None; exercises authentic saveManifest().
   */
  it('persists notes/manifest.json even when notes/manifest.js write fails and flushes debounced saves', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(StorageAPI, 'writeNotesManifestJS').mockRejectedValue(new Error('manifest.js write failed'));

    globalThis.manifest = [
      { id: 'note-deb-1', path: 'notes/note-deb-1.html', title: 'Debounced Note', date: '2026-11-16' }
    ];

    vi.useFakeTimers();
    try {
      const p = saveManifest();
      await vi.advanceTimersByTimeAsync(2100);
      await p;
    } finally {
      vi.useRealTimers();
    }

    expect(virtualDisk.has('notes/manifest.json')).toBe(true);
    const saved = JSON.parse(virtualDisk.get('notes/manifest.json'));
    expect(saved.map(n => n.id)).toEqual(['note-deb-1']);
    warnSpy.mockRestore();
  });
});
