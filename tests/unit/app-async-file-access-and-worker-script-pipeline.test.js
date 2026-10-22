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

    it('checks planner proposals existence asynchronously via hasPlannerProposals', async () => {
      globalThis.fileExists = vi.fn().mockResolvedValue(true);
      const exists = await StorageAPI.hasPlannerProposals();
      expect(exists).toBe(true);
      expect(globalThis.fileExists).toHaveBeenCalledWith('planner-proposals.json');
    });
  });

  describe('Separate Thread / Web Worker Calendar & Shell Script Results Pipeline', () => {
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
    it('AppBridge exposes calendarSync interface and verifies availability', () => {
      expect(AppBridge.calendarSync).toBeDefined();
      expect(typeof AppBridge.calendarSync.isSupported).toBe('function');
      expect(typeof AppBridge.calendarSync.runLocalSyncScript).toBe('function');
    });

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
  });
});
