import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Planner Agent Proposals & Timezone Normalization Engine', () => {
  let plannerScope;
  let CalendarSyncService;
  let SyncWorkerEngine;

  beforeEach(() => {
    global.document = document;
    global.window = window;
    document.body.innerHTML = '';
    vi.restoreAllMocks();

    // Mock minimal DOM & environment
    const panel = document.createElement('div');
    panel.id = 'planner-panel';
    document.body.appendChild(panel);

    window.plannerEvents = [];
    window.todosManifest = [];
    window.manifest = [];
    window.selectedPlannerEventId = null;
    window.plannerRightSidebarCollapsed = false;
    window.plannerActivePaneTab = 'unassigned';
    window.plannerRightPaneWidth = 320;
    window._plannerRightPaneWidth = 320;
    window.plannerViewMode = 'week';
    window.currentPlannerWeekStart = new Date(2026, 8, 14);
    window.currentLang = 'en';
    window.workStartTime = '09:00';
    window.workEndTime = '18:00';
    window.t = (k) => k;
    window.timeToMinutes = (timeStr) => {
      if (!timeStr) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    window.minutesToTime = (mins) => {
      const h = String(Math.floor(mins / 60) % 24).padStart(2, '0');
      const m = String(mins % 60).padStart(2, '0');
      return `${h}:${m}`;
    };
    window.parsePlannerDuration = (raw, defVal = null) => {
      if (raw === null || raw === undefined) return defVal;
      const num = parseInt(raw, 10);
      return isNaN(num) ? defVal : num;
    };
    window.formatLocalDateValue = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    // Load app-planner.js
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');
    const plannerEval = new Function('window', 'document', 'globalThis', `
      ${plannerCode}
      return {
        normalizePlannerProposals,
        parseICSDateTime,
        parseICSContent,
        parseDateTimeInTimezone: typeof parseDateTimeInTimezone !== 'undefined' ? parseDateTimeInTimezone : null,
        convertEventToLocalTime: typeof convertEventToLocalTime !== 'undefined' ? convertEventToLocalTime : null
      };
    `);
    plannerScope = plannerEval(window, document, window);

    // Load app-calendar-sync.js
    window.settings = { calendarSync: { enabled: true, feeds: [] } };
    const calSyncCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-calendar-sync.js'), 'utf8');
    const calSyncEval = new Function('window', 'globalThis', 'settings', 't', `
      ${calSyncCode}
      return window.CalendarSyncService;
    `);
    CalendarSyncService = calSyncEval(window, window, window.settings, window.t);

    // Load app-sync-worker.js
    const syncWorkerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-sync-worker.js'), 'utf8');
    const workerEval = new Function('self', 'globalThis', `
      ${syncWorkerCode}
      return self.SyncWorkerEngine;
    `);
    SyncWorkerEngine = workerEval(globalThis, globalThis);
  });

  describe('Proposal Timezone Normalization in normalizePlannerProposals', () => {
    it('normalizes proposals with IANA timezone into local client time', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      // Propose meeting at 10:00 AM New York time (America/New_York)
      // When converted to local time (e.g. Vienna/Paris UTC+1 in winter, UTC-5 in NY -> +6h difference)
      const raw = [
        {
          id: 'agent-tz-001',
          title: 'Transatlantic Architecture Review',
          date: '2026-11-12',
          startTime: '10:00',
          endTime: '11:00',
          timezone: 'America/New_York',
          type: 'call',
          status: 'pending'
        }
      ];

      const res = normalize(raw);
      expect(res).toHaveLength(1);
      const prop = res[0];

      // Original timezone metadata should be preserved
      expect(prop.timezone).toBe('America/New_York');
      expect(prop.originalTimezone).toBe('America/New_York');
      expect(prop.originalStartTime).toBe('10:00');

      // The local date and time should match the converted instant
      const localD = new Date('2026-11-12T10:00:00-05:00');
      const pad = (n) => String(n).padStart(2, '0');
      const expectedLocalDate = `${localD.getFullYear()}-${pad(localD.getMonth() + 1)}-${pad(localD.getDate())}`;
      const expectedLocalStart = `${pad(localD.getHours())}:${pad(localD.getMinutes())}`;

      expect(prop.date).toBe(expectedLocalDate);
      expect(prop.startTime).toBe(expectedLocalStart);
      expect(prop.duration).toBe(60);
    });

    it('correctly handles midnight crossing when timezone conversion shifts to the next day', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      // 22:00 in America/New_York on 2026-11-12 is 04:00 on 2026-11-13 in Europe/Paris (+6h)
      const raw = [
        {
          id: 'agent-tz-midnight',
          title: 'Late Night US Sync',
          date: '2026-11-12',
          startTime: '22:00',
          endTime: '23:00',
          timezone: 'America/New_York',
          type: 'sync',
          status: 'pending'
        }
      ];

      const res = normalize(raw);
      expect(res).toHaveLength(1);
      const prop = res[0];

      const localD = new Date('2026-11-12T22:00:00-05:00');
      const pad = (n) => String(n).padStart(2, '0');
      const expectedLocalDate = `${localD.getFullYear()}-${pad(localD.getMonth() + 1)}-${pad(localD.getDate())}`;
      const expectedLocalStart = `${pad(localD.getHours())}:${pad(localD.getMinutes())}`;

      expect(prop.date).toBe(expectedLocalDate);
      expect(prop.startTime).toBe(expectedLocalStart);
    });

    it('parses and converts ISO 8601 strings with offsets in startTime and startDateTime', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      const raw = [
        {
          id: 'agent-iso-utc',
          title: 'Global All-Hands',
          startDateTime: '2026-11-12T14:00:00Z',
          endDateTime: '2026-11-12T15:00:00Z',
          type: 'call'
        },
        {
          id: 'agent-iso-offset',
          title: 'Tokyo Morning Kickoff',
          date: '2026-11-12',
          startTime: '09:00+09:00',
          endTime: '10:00+09:00',
          type: 'sync'
        }
      ];

      const res = normalize(raw);
      expect(res).toHaveLength(2);

      // Verify UTC event
      const d1 = new Date('2026-11-12T14:00:00Z');
      const pad = (n) => String(n).padStart(2, '0');
      const expD1Date = `${d1.getFullYear()}-${pad(d1.getMonth() + 1)}-${pad(d1.getDate())}`;
      const expD1Time = `${pad(d1.getHours())}:${pad(d1.getMinutes())}`;
      expect(res[0].date).toBe(expD1Date);
      expect(res[0].startTime).toBe(expD1Time);

      // Verify Tokyo event
      const d2 = new Date('2026-11-12T09:00:00+09:00');
      const expD2Date = `${d2.getFullYear()}-${pad(d2.getMonth() + 1)}-${pad(d2.getDate())}`;
      const expD2Time = `${pad(d2.getHours())}:${pad(d2.getMinutes())}`;
      expect(res[1].date).toBe(expD2Date);
      expect(res[1].startTime).toBe(expD2Time);
    });

    it('leaves floating local events untouched when no timezone is specified', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      const raw = [
        {
          id: 'agent-floating-local',
          title: 'Local Focus Block',
          date: '2026-11-12',
          startTime: '10:00',
          endTime: '11:30',
          type: 'work'
        }
      ];

      const res = normalize(raw);
      expect(res).toHaveLength(1);
      expect(res[0].date).toBe('2026-11-12');
      expect(res[0].startTime).toBe('10:00');
      expect(res[0].endTime).toBe('11:30');
      expect(res[0].duration).toBe(90);
    });
  });

  describe('RFC 5545 ICS Timezone Extraction in CalendarSyncService', () => {
    it('parses DTSTART with TZID parameter and converts to local client time', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:tz-event-123',
        'DTSTART;TZID=America/New_York:20261112T100000',
        'DTEND;TZID=America/New_York:20261112T110000',
        'SUMMARY:New York Client Presentation',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const events = CalendarSyncService.parseICS(ics, { name: 'Corporate' });
      expect(events).toHaveLength(1);
      const ev = events[0];

      const localD = new Date('2026-11-12T10:00:00-05:00');
      const pad = (n) => String(n).padStart(2, '0');
      const expectedDate = `${localD.getFullYear()}-${pad(localD.getMonth() + 1)}-${pad(localD.getDate())}`;
      const expectedTime = `${pad(localD.getHours())}:${pad(localD.getMinutes())}`;

      expect(ev.date).toBe(expectedDate);
      expect(ev.startTime).toBe(expectedTime);
      expect(ev.duration).toBe(60);
      expect(ev.timezone).toBe('America/New_York');
    });
  });

  describe('SyncWorkerEngine Timezone Normalization', () => {
    it('normalizes proposals in worker thread preserving timezone conversions', () => {
      const res = SyncWorkerEngine.normalizeProposals([
        {
          id: 'worker-prop-tz',
          title: 'Remote Strategy Session',
          date: '2026-11-12',
          startTime: '14:00',
          duration: 45,
          timezone: 'America/New_York'
        }
      ]);

      expect(res).toHaveLength(1);
      const prop = res[0];

      const localD = new Date('2026-11-12T14:00:00-05:00');
      const pad = (n) => String(n).padStart(2, '0');
      const expectedDate = `${localD.getFullYear()}-${pad(localD.getMonth() + 1)}-${pad(localD.getDate())}`;
      const expectedTime = `${pad(localD.getHours())}:${pad(localD.getMinutes())}`;

      expect(prop.date).toBe(expectedDate);
      expect(prop.startTime).toBe(expectedTime);
      expect(prop.timezone).toBe('America/New_York');
    });
  });
});
