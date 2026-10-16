import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Calendar Synchronization Engine (WebCal & Local Helper)', () => {
  let CalendarSyncService;

  beforeEach(() => {
    vi.restoreAllMocks();
    window.settings = {
      calendarSync: {
        enabled: true,
        feeds: [],
        pollIntervalMinutes: 15,
        mode: 'proposals'
      }
    };
    window.t = (key) => key;

    const calendarSyncCode = fs.readFileSync(
      path.resolve(__dirname, '../../js/app-calendar-sync.js'),
      'utf8'
    );

    // Evaluate script
    const fn = new Function('window', 'globalThis', 'settings', 't', `${calendarSyncCode}; return window.CalendarSyncService;`);
    CalendarSyncService = fn(window, window, window.settings, window.t);
  });

  describe('URL Normalization & Validation', () => {
    it('normalizes webcal:// to https://', () => {
      const url = 'webcal://calendar.google.com/calendar/ical/user%40gmail.com/public/basic.ics';
      const normalized = CalendarSyncService.normalizeCalendarUrl(url);
      expect(normalized).toBe('https://calendar.google.com/calendar/ical/user%40gmail.com/public/basic.ics');
    });

    it('normalizes webcals:// to https://', () => {
      const url = 'webcals://outlook.office365.com/owa/calendar/test/reachcalendar.ics';
      const normalized = CalendarSyncService.normalizeCalendarUrl(url);
      expect(normalized).toBe('https://outlook.office365.com/owa/calendar/test/reachcalendar.ics');
    });

    it('preserves valid https:// URLs and trims whitespace', () => {
      const url = '   https://p01-caldav.icloud.com/published/2/test.ics   ';
      const normalized = CalendarSyncService.normalizeCalendarUrl(url);
      expect(normalized).toBe('https://p01-caldav.icloud.com/published/2/test.ics');
    });

    it('validates calendar URLs correctly', () => {
      expect(CalendarSyncService.isValidCalendarUrl('webcal://example.com/cal.ics')).toBe(true);
      expect(CalendarSyncService.isValidCalendarUrl('https://example.com/cal.ics')).toBe(true);
      expect(CalendarSyncService.isValidCalendarUrl('not-a-url')).toBe(false);
      expect(CalendarSyncService.isValidCalendarUrl('')).toBe(false);
      expect(CalendarSyncService.isValidCalendarUrl(null)).toBe(false);
    });
  });

  describe('RFC 5545 ICS Parsing', () => {
    it('parses timed events with start and end times', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
        'BEGIN:VEVENT',
        'UID:meeting-12345@google.com',
        'DTSTART:20261020T143000Z',
        'DTEND:20261020T153000Z',
        'SUMMARY:Project Architecture Sync & Call',
        'DESCRIPTION:Discuss next quarter roadmap and deliverables',
        'LOCATION:Zoom Conference Room',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const events = CalendarSyncService.parseICS(ics, { id: 'feed-1', name: 'Work' });
      expect(events).toHaveLength(1);
      const ev = events[0];
      expect(ev.title).toBe('Project Architecture Sync & Call');
      expect(ev.date).toBe('2026-10-20');
      expect(ev.startTime).toBe('14:30');
      expect(ev.endTime).toBe('15:30');
      expect(ev.duration).toBe(60);
      expect(ev.type).toBe('call'); // Inferred from "Call"
      expect(ev.source).toBe('WebCal: Work');
      expect(ev.status).toBe('pending');
      expect(ev.allDay).toBe(false);
    });

    it('parses all-day events correctly (YYYYMMDD)', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:holiday-67890@apple.com',
        'DTSTART;VALUE=DATE:20261025',
        'DTEND;VALUE=DATE:20261026',
        'SUMMARY:Company Annual Leave / Out of Office',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const events = CalendarSyncService.parseICS(ics, { id: 'feed-2', name: 'Personal' });
      expect(events).toHaveLength(1);
      const ev = events[0];
      expect(ev.title).toBe('Company Annual Leave / Out of Office');
      expect(ev.date).toBe('2026-10-25');
      expect(ev.startTime).toBe('00:00');
      expect(ev.endTime).toBe('23:59');
      expect(ev.duration).toBe(1440);
      expect(ev.allDay).toBe(true);
      expect(ev.type).toBe('ooo'); // Inferred from "Out of Office"
    });

    it('unfolds multiline headers per RFC 5545 specification', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:unfolded-111',
        'DTSTART:20261105T090000',
        'DTEND:20261105T100000',
        'SUMMARY:Very Long Summary That Has Been Unfolded',
        '  Across Multiple Lines In The',
        '\tICS File',
        'DESCRIPTION:Line 1 of description\\nLine 2 of description',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const events = CalendarSyncService.parseICS(ics);
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Very Long Summary That Has Been Unfolded Across Multiple Lines In TheICS File');
      expect(events[0].description).toBe('Line 1 of description\nLine 2 of description');
    });

    it('ignores cancelled events', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:cancelled-event-1',
        'DTSTART:20261022T110000',
        'DTEND:20261022T120000',
        'SUMMARY:Cancelled 1:1 Discussion',
        'STATUS:CANCELLED',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:active-event-2',
        'DTSTART:20261022T130000',
        'DTEND:20261022T140000',
        'SUMMARY:Active Team Standup',
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const events = CalendarSyncService.parseICS(ics);
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Active Team Standup');
      expect(events[0].type).toBe('sync');
    });
  });

  describe('Local Helper & Commands', () => {
    it('generates the correct local macOS sync script command', () => {
      const cmd = CalendarSyncService.getLocalSyncCommand('/Users/alice/MyWorkspace');
      expect(cmd).toBe('python3 development/sync_local_calendar.py --workspace "/Users/alice/MyWorkspace"');

      const defaultCmd = CalendarSyncService.getLocalSyncCommand();
      expect(defaultCmd).toBe('python3 development/sync_local_calendar.py');
    });
  });

  describe('Feed Management & Proposals Merge', () => {
    it('manages feeds in settings configuration', async () => {
      window.saveSettings = vi.fn().mockResolvedValue(true);

      const feed = await CalendarSyncService.addFeed({
        name: 'Client Project Calendar',
        url: 'https://outlook.office365.com/calendar.ics',
        syncImmediately: false
      });

      expect(feed.name).toBe('Client Project Calendar');
      expect(feed.enabled).toBe(true);

      let config = CalendarSyncService.getConfig();
      expect(config.feeds).toHaveLength(1);
      expect(config.feeds[0].id).toBe(feed.id);

      await CalendarSyncService.toggleFeed(feed.id, false);
      config = CalendarSyncService.getConfig();
      expect(config.feeds[0].enabled).toBe(false);

      await CalendarSyncService.removeFeed(feed.id);
      config = CalendarSyncService.getConfig();
      expect(config.feeds).toHaveLength(0);
    });

    it('merges proposals without duplicating existing IDs or accepted events', async () => {
      let savedPayload = null;
      global.StorageAPI = {
        readPlannerProposals: vi.fn().mockResolvedValue({
          version: 1,
          proposals: [
            { id: 'webcal-feed-existing-1', title: 'Already Logged', date: '2026-10-18', status: 'pending' }
          ]
        }),
        writePlannerProposals: vi.fn().mockImplementation((payload) => {
          savedPayload = payload;
          return Promise.resolve(true);
        })
      };

      global.plannerEvents = [
        { id: 'evt-100', proposalId: 'webcal-feed-already-accepted' }
      ];

      const newEvents = [
        { id: 'webcal-feed-existing-1', title: 'Already Logged', date: '2026-10-18' }, // Should be skipped (in proposals)
        { id: 'webcal-feed-already-accepted', title: 'Accepted Call', date: '2026-10-19' }, // Should be skipped (in plannerEvents)
        { id: 'webcal-feed-new-2', title: 'Brand New Meeting', date: '2026-10-20' } // Should be added!
      ];

      const result = await CalendarSyncService._mergeIntoProposals(newEvents);
      expect(result.added).toBe(1);
      expect(result.skipped).toBe(2);

      expect(global.StorageAPI.writePlannerProposals).toHaveBeenCalled();
      expect(savedPayload.proposals).toHaveLength(2);
      expect(savedPayload.proposals[1].id).toBe('webcal-feed-new-2');
    });
  });

  describe('Setup Wizard Calendar Integration', () => {
    it('renders calendar sync input in Step 2 of SetupWizardController', () => {
      const tutorialCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-tutorial.js'), 'utf8');
      const mockWindow = {
        settings: { ui: { colors: { accent: '#4f46e5' } }, ai: {} },
        t: (k) => k,
        escH: (s) => s || '',
        localStorage: { getItem: vi.fn(), setItem: vi.fn() },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };

      const fn = new Function('window', 'document', 'settings', 't', 'escH', `${tutorialCode}; return window.SetupWizardController;`);
      const wizard = fn(mockWindow, document, mockWindow.settings, mockWindow.t, mockWindow.escH);

      expect(wizard).toBeDefined();
      wizard.currentStep = 1; // Step 2 (Schedule)
      const html = wizard.renderStep2();

      expect(html).toContain('wizard-calendar-feed-input');
      expect(html).toContain('SetupWizardController.testCalendarFeed()');
      expect(html).toContain('setupWizard.calendarSyncTitle');
    });
  });
});
