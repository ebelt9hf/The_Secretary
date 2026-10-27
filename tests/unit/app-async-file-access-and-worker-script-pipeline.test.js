import { describe, it, expect, beforeEach, vi } from 'vitest';

// Load dependencies
import '../../js/app-idb.js';
import '../../js/app-storage.js';
import '../../js/app-bridge.js';
import '../../js/app-sync-worker.js';
import '../../js/app-sync-pipeline.js';
import '../../js/app-calendar-sync.js';

describe('Async File Access Architecture & Separate Worker Thread Script Pipeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    StorageAPI.clearNoteCache();
    StorageAPI.setStorageEngine('filesystem');
    StorageAPI.setConnectorStatus('synced', null);
  });

  describe('Planner Proposals 2-Tier Async Storage Path', () => {
    /**
     * 1. Protected Behavior: Verifies StorageAPI.writePlannerProposals caches in IDB before writing to connector.
     * 2. Regression Target: Writing planner proposals only to connector without IDB caching.
     * 3. Coverage Overlap / Redundancy: None; planner proposals storage tier is isolated to this test.
     * 4. Production Code Footprint: None; exercises production StorageAPI.writePlannerProposals.
     */
    it('persists planner-proposals.json to IndexedDB Tier 1 before writing to connector', async () => {
      const putRecordSpy = vi.spyOn(VaultIDBStorage, 'putRecord').mockResolvedValue(true);
      const writeFileSpy = vi.fn().mockResolvedValue(true);
      globalThis.writeFile = writeFileSpy;

      const payload = {
        _notice: 'IMPORTANT FOR AGENTS: Do NOT delete or overwrite existing proposed events.',
        version: 1,
        proposals: [
          { id: 'agent-prop-1', title: 'Deep Work Session', date: '2026-10-22', type: 'work' }
        ]
      };

      await StorageAPI.writePlannerProposals(payload);

      // Verify Tier 1 (IndexedDB) write
      expect(putRecordSpy).toHaveBeenCalledWith('docs', expect.objectContaining({
        id: 'planner:proposals',
        kind: 'planner',
        docId: 'proposals',
        data: payload
      }));

      // Verify Tier 2 Connector write
      expect(writeFileSpy).toHaveBeenCalledWith('planner-proposals.json', JSON.stringify(payload, null, 2));
      expect(StorageAPI.getConnectorStatus().status).toBe('synced');
    });

    /**
     * 1. Protected Behavior: Ensures readPlannerProposals reads from connector and synchronizes back to IDB.
     * 2. Regression Target: Failing to update local IDB cache upon reading external proposals.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('reads planner proposals from connector and updates IndexedDB cache', async () => {
      const mockData = {
        version: 1,
        proposals: [{ id: 'p-1', title: 'Sprint Review', date: '2026-10-23' }]
      };
      globalThis.readFile = vi.fn().mockResolvedValue(JSON.stringify(mockData));
      const putRecordSpy = vi.spyOn(VaultIDBStorage, 'putRecord').mockResolvedValue(true);

      const result = await StorageAPI.readPlannerProposals();
      expect(result).toEqual(mockData);
      expect(putRecordSpy).toHaveBeenCalledWith('docs', expect.objectContaining({
        id: 'planner:proposals',
        data: mockData
      }));
    });

    /**
     * 1. Protected Behavior: Falls back to IndexedDB cache when planner-proposals.json is absent on disk (web mode).
     * 2. Regression Target: Throwing NotFoundError instead of serving cached proposals in web environments.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('falls back to Tier 1 IndexedDB if connector file is not found (e.g. pure web mode)', async () => {
      const mockCached = {
        version: 1,
        proposals: [{ id: 'cached-1', title: 'Cached Meeting', date: '2026-10-24' }]
      };
      const notFoundErr = new Error('File not found');
      notFoundErr.name = 'NotFoundError';
      globalThis.readFile = vi.fn().mockRejectedValue(notFoundErr);

      vi.spyOn(VaultIDBStorage, 'getRecord').mockResolvedValue({
        id: 'planner:proposals',
        data: mockCached
      });

      const result = await StorageAPI.readPlannerProposals();
      expect(result).toEqual(mockCached);
    });

    /**
     * 1. Protected Behavior: Non-blocking asynchronous file existence check via StorageAPI.hasPlannerProposals.
     * 2. Regression Target: Invoking blocking sync calls or failing to query fileExists.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('checks planner proposals existence asynchronously via hasPlannerProposals', async () => {
      globalThis.fileExists = vi.fn().mockResolvedValue(true);
      const exists = await StorageAPI.hasPlannerProposals();
      expect(exists).toBe(true);
      expect(globalThis.fileExists).toHaveBeenCalledWith('planner-proposals.json');
    });
  });

  describe('Separate Thread / Web Worker Calendar & Shell Script Results Pipeline', () => {
    /**
     * 1. Protected Behavior: Worker parser normalizes durations (e.g. '30m' -> 30) and defaults status to 'pending'.
     * 2. Regression Target: Breaking duration string normalization or status assignment inside SyncWorkerEngine.
     * 3. Coverage Overlap / Redundancy: None; verifies worker thread execution contract.
     * 4. Production Code Footprint: None.
     */
    it('SyncWorkerEngine parses and normalizes JSON calendar proposals in worker', async () => {
      const jsonText = JSON.stringify({
        version: 1,
        proposals: [
          { id: 'worker-prop-1', title: 'Architecture Review', date: '2026-10-25', startTime: '14:00', duration: 45, type: 'work' },
          { id: 'worker-prop-2', title: '1-on-1 Sync', date: '2026-10-25', startTime: '15:00', duration: '30m', type: 'sync' }
        ]
      });

      const items = await SyncWorkerEngine.parseCalendarResults(jsonText, 'json', { existingEvents: [] });
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        id: 'worker-prop-1',
        title: 'Architecture Review',
        type: 'work',
        duration: 45,
        status: 'pending'
      });
      expect(items[1]).toMatchObject({
        id: 'worker-prop-2',
        title: '1-on-1 Sync',
        type: 'sync',
        duration: 30,
        status: 'pending'
      });
    });

    /**
     * 1. Protected Behavior: Worker parsing of RFC 5545 ICS calendar content with type inference and duration math.
     * 2. Regression Target: Inaccurate ICS date-time math or failure to infer event types from summary text.
     * 3. Coverage Overlap / Redundancy: Distinguishes from main-thread calendar parser by testing worker pipeline.
     * 4. Production Code Footprint: None.
     */
    it('SyncWorkerEngine parses RFC 5545 ICS calendar content in worker', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Secretary//Test//EN',
        'BEGIN:VEVENT',
        'UID:evt-unique-worker-999',
        'DTSTART:20261026T090000Z',
        'DTEND:20261026T100000Z',
        'SUMMARY:Client Demo Call',
        'DESCRIPTION:Demoing Secretary calendar pipeline',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const items = await SyncWorkerEngine.parseCalendarResults(icsText, 'ics', { name: 'Work Outlook' });
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Client Demo Call');
      expect(items[0].type).toBe('call'); // inferred from title 'call'
      expect(items[0].source).toBe('Work Outlook');
      expect(items[0].duration).toBe(60);
    });

    /**
     * 1. Protected Behavior: SyncPipeline exposes parseCalendarResults and dispatches message to worker.
     * 2. Regression Target: Protocol message name mismatch (PARSE_CALENDAR_RESULTS) or broken promise bridge.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('SyncPipeline exposes parseCalendarResults and dispatches to worker', async () => {
      const sendSpy = vi.spyOn(SyncPipeline, '_send').mockResolvedValue([
        { id: 'pipeline-1', title: 'Worker Parsed Proposal' }
      ]);

      const res = await SyncPipeline.parseCalendarResults('{"proposals":[]}', 'json');
      expect(sendSpy).toHaveBeenCalledWith('PARSE_CALENDAR_RESULTS', {
        content: '{"proposals":[]}',
        fileType: 'json',
        options: {}
      });
      expect(res).toEqual([{ id: 'pipeline-1', title: 'Worker Parsed Proposal' }]);
    });

    /**
     * 1. Protected Behavior: CalendarSyncService delegates heavy calendar parsing to background Web Worker.
     * 2. Regression Target: UI thread lockups from regressing to synchronous main-thread ICS parsing.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('CalendarSyncService.parseResultsInWorker delegates to Web Worker pipeline', async () => {
      const mockResult = [{ id: 'p-worker-delegate', title: 'Delegated Worker Event', date: '2026-10-27' }];
      globalThis.SyncPipeline = {
        parseCalendarResults: vi.fn().mockResolvedValue(mockResult)
      };

      const parsed = await CalendarSyncService.parseResultsInWorker('{"proposals":[]}', 'proposals.json', []);
      expect(globalThis.SyncPipeline.parseCalendarResults).toHaveBeenCalled();
      expect(parsed).toEqual(mockResult);
    });
  });

  describe('Non-blocking Shell Script Execution in Background Process/Thread', () => {
    /**
     * 1. Protected Behavior: Verifies AppBridge.calendarSync public interface contract exists and is exposed.
     * 2. Regression Target: Renaming or dropping isSupported or runLocalSyncScript on AppBridge.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('AppBridge exposes calendarSync interface and verifies availability', () => {
      expect(AppBridge.calendarSync).toBeDefined();
      expect(typeof AppBridge.calendarSync.isSupported).toBe('function');
      expect(typeof AppBridge.calendarSync.runLocalSyncScript).toBe('function');
    });

    /**
     * 1. Protected Behavior: Invokes electronAPI.runCalendarSyncScript with active workspace directory asynchronously.
     * 2. Regression Target: Passing invalid workspace path or failing to await background process completion.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('executes shell script asynchronously without blocking via AppBridge.calendarSync', async () => {
      globalThis.electronAPI = {
        runCalendarSyncScript: vi.fn().mockResolvedValue({
          success: true,
          code: 0,
          stdout: '✓ Successfully synchronized 2 new calendar events',
          stderr: ''
        })
      };

      const isSupported = AppBridge.calendarSync.isSupported();
      expect(isSupported).toBe(true);

      const res = await CalendarSyncService.runLocalSyncScript('/Users/test/Workspace');
      expect(globalThis.electronAPI.runCalendarSyncScript).toHaveBeenCalledWith('/Users/test/Workspace');
      expect(res.success).toBe(true);
    });

    /**
     * 1. Protected Behavior: Gracefully handles shell script execution failure without unhandled exceptions.
     * 2. Regression Target: Unhandled promise rejection crashing the renderer on denied macOS calendar permissions.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('handles shell script execution error gracefully without throwing unhandled exceptions', async () => {
      globalThis.electronAPI = {
        runCalendarSyncScript: vi.fn().mockResolvedValue({
          success: false,
          code: 1,
          stdout: '',
          error: 'Calendar permission denied in macOS System Settings'
        })
      };

      const res = await CalendarSyncService.runLocalSyncScript();
      expect(res.success).toBe(false);
      expect(res.error).toContain('Calendar permission denied');
    });

    /**
     * 1. Protected Behavior: Handles Windows PowerShell execution results gracefully via runLocalSyncScript.
     * 2. Regression Target: Unhandled rejection or bad status handling when running PowerShell on Windows.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('handles Windows PowerShell execution results gracefully via runLocalSyncScript', async () => {
      globalThis.electronAPI = {
        runCalendarSyncScript: vi.fn().mockResolvedValue({
          success: true,
          code: 0,
          stdout: '✓ Successfully synchronized 3 new calendar events into planner-proposals.json',
          stderr: ''
        })
      };

      const res = await CalendarSyncService.runLocalSyncScript('C:\\Users\\test\\Workspace');
      expect(globalThis.electronAPI.runCalendarSyncScript).toHaveBeenCalledWith('C:\\Users\\test\\Workspace');
      expect(res.success).toBe(true);
    });
  });
});
