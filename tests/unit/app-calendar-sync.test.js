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

    it('validates calendar URLs and prevents SSRF / loopback addresses', () => {
      expect(CalendarSyncService.isValidCalendarUrl('webcal://example.com/cal.ics')).toBe(true);
      expect(CalendarSyncService.isValidCalendarUrl('https://example.com/cal.ics')).toBe(true);
      expect(CalendarSyncService.isValidCalendarUrl('http://example.com/cal.ics')).toBe(false); // Insecure http rejected
      expect(CalendarSyncService.isValidCalendarUrl('https://localhost/cal.ics')).toBe(false); // Loopback rejected
      expect(CalendarSyncService.isValidCalendarUrl('https://127.0.0.1/cal.ics')).toBe(false); // Loopback rejected
      expect(CalendarSyncService.isValidCalendarUrl('https://::1/cal.ics')).toBe(false); // IPv6 loopback rejected
      expect(CalendarSyncService.isValidCalendarUrl('not-a-url')).toBe(false);
      expect(CalendarSyncService.isValidCalendarUrl('')).toBe(false);
      expect(CalendarSyncService.isValidCalendarUrl(null)).toBe(false);
    });

    it('sanitizes URLs for logging without leaking query params or tokens', () => {
      const sanitized = CalendarSyncService.sanitizeUrlForLog('https://calendar.google.com/calendar/ical/user%40gmail.com/secret-12345/basic.ics?authuser=0&token=private-xyz#hash');
      expect(sanitized).toBe('https://calendar.google.com/calendar/ical/user%40gmail.com/secret-12345/basic.ics');
    });
  });

  describe('RFC 5545 ICS Parsing', () => {
    it('parses timed events with start and end times, converting UTC timestamps to local client time', () => {
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
      
      const expectedDate = new Date(Date.UTC(2026, 9, 20, 14, 30));
      const expY = expectedDate.getFullYear();
      const expM = String(expectedDate.getMonth() + 1).padStart(2, '0');
      const expD = String(expectedDate.getDate()).padStart(2, '0');
      const expH = String(expectedDate.getHours()).padStart(2, '0');
      const expMin = String(expectedDate.getMinutes()).padStart(2, '0');
      
      expect(ev.date).toBe(`${expY}-${expM}-${expD}`);
      expect(ev.startTime).toBe(`${expH}:${expMin}`);
      expect(ev.duration).toBe(60);
      expect(ev.type).toBe('call'); // Inferred from "Call"
      expect(ev.source).toBe('WebCal: Work');
      expect(ev.status).toBe('pending');
      expect(ev.allDay).toBe(false);
    });

    it('preserves floating wall-clock times when not marked with Z (UTC)', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:floating-local-time-999',
        'DTSTART:20261020T091500',
        'DTEND:20261020T104500',
        'SUMMARY:Client Presentation & Strategy Call',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const events = CalendarSyncService.parseICS(ics);
      expect(events).toHaveLength(1);
      expect(events[0].date).toBe('2026-10-20');
      expect(events[0].startTime).toBe('09:15');
      expect(events[0].endTime).toBe('10:45');
      expect(events[0].duration).toBe(90);
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
    it('generates the correct zero-dependency local macOS sync script command', () => {
      const cmd = CalendarSyncService.getLocalSyncCommand('/Users/alice/MyWorkspace');
      expect(cmd).toBe('./development/sync_local_calendar.sh "/Users/alice/MyWorkspace"');

      const defaultCmd = CalendarSyncService.getLocalSyncCommand();
      expect(defaultCmd).toBe('./development/sync_local_calendar.sh');
    });

    it('generates the correct zero-dependency local Windows PowerShell sync script command', () => {
      const cmd = CalendarSyncService.getLocalSyncCommand('C:\\Users\\alice\\MyWorkspace', 'win');
      expect(cmd).toBe('powershell.exe -ExecutionPolicy Bypass -File .\\development\\sync_local_calendar.ps1 -Workspace "C:\\Users\\alice\\MyWorkspace"');

      const defaultCmd = CalendarSyncService.getLocalSyncCommand('', 'win');
      expect(defaultCmd).toBe('powershell.exe -ExecutionPolicy Bypass -File .\\development\\sync_local_calendar.ps1');
    });

    it('detects Windows platform via isWindows() correctly', () => {
      expect(typeof CalendarSyncService.isWindows).toBe('function');
      const isWinSpy = vi.spyOn(CalendarSyncService, 'isWindows').mockReturnValue(true);
      expect(CalendarSyncService.getLocalSyncCommand('C:\\Test')).toContain('powershell.exe');
      isWinSpy.mockRestore();
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
    it('renders dedicated Calendar Sync in Step 3 of SetupWizardController with provider guides and test button', () => {
      const tutorialCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-tutorial.js'), 'utf8');
      const mockWindow = {
        settings: { ui: { colors: { accent: '#4f46e5' } }, ai: {} },
        t: (k) => k,
        escH: (s) => s || '',
        localStorage: { getItem: vi.fn(), setItem: vi.fn() },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        open: vi.fn()
      };

      const fn = new Function('window', 'document', 'settings', 't', 'escH', `${tutorialCode}; return window.SetupWizardController;`);
      const wizard = fn(mockWindow, document, mockWindow.settings, mockWindow.t, mockWindow.escH);

      expect(wizard).toBeDefined();
      wizard.currentStep = 2; // Step 3 (Calendar Sync)
      const html = wizard.renderStepCalendar();

      // Check input and test button
      expect(html).toContain('wizard-calendar-feed-input');
      expect(html).toContain('SetupWizardController.testCalendarFeed()');
      expect(html).toContain('setupWizard.stepCalendarDesc');

      // Check provider tabs and deep link buttons
      expect(html).toContain('SetupWizardController.selectCalendarGuide(\'outlook\')');
      expect(html).toContain('SetupWizardController.selectCalendarGuide(\'google\')');
      expect(html).toContain('SetupWizardController.selectCalendarGuide(\'apple\')');
      expect(html).toContain('SetupWizardController.selectCalendarGuide(\'corporate\')');
      expect(html).toContain('SetupWizardController.openCalendarProviderPortal(\'outlook\')');

      // Check portal opener
      wizard.openCalendarProviderPortal('outlook');
      expect(mockWindow.open).toHaveBeenCalledWith(
        'https://outlook.office.com/mail/options/calendar/SharedCalendars',
        '_blank',
        'noopener,noreferrer'
      );
    });

    it('renders corporate local sync controls (download script, folder, file) when corporate guide is selected', () => {
      const tutorialCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-tutorial.js'), 'utf8');
      const mockWindow = {
        settings: { ui: { colors: { accent: '#4f46e5' } }, ai: {} },
        t: (k) => k,
        escH: (s) => s || '',
        localStorage: { getItem: vi.fn(), setItem: vi.fn() },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        open: vi.fn()
      };

      const fn = new Function('window', 'document', 'settings', 't', 'escH', `${tutorialCode}; return window.SetupWizardController;`);
      const wizard = fn(mockWindow, document, mockWindow.settings, mockWindow.t, mockWindow.escH);

      wizard.currentStep = 2;
      wizard.state.activeCalendarGuideTab = 'corporate';
      const html = wizard.renderStepCalendar();

      expect(html).toContain('wizard-btn-download-sync-script');
      expect(html).toContain('SetupWizardController.downloadSyncScript()');
      expect(html).toContain('wizard-btn-connect-agent-folder');
      expect(html).toContain('SetupWizardController.connectCorporateFolder()');
      expect(html).toContain('wizard-btn-select-agent-file');
      expect(html).toContain('SetupWizardController.selectCorporateFile()');
      expect(html).toContain('./development/sync_local_calendar.sh');
      expect(html).toContain('wizard-local-proposals-status');
      expect(html).toContain('wizard-external-agent-linked-box');
    });

    it('provides returning user sign-in entrypoint in modal header and opens cloud sync setup in signin tab', () => {
      const tutorialCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-tutorial.js'), 'utf8');
      const mockOpenModal = vi.fn();
      const mockSwitchSyncSetupTab = vi.fn();
      const mockWindow = {
        settings: { ui: { colors: { accent: '#4f46e5' } }, ai: {} },
        t: (k) => k,
        escH: (s) => s || '',
        localStorage: { getItem: vi.fn(), setItem: vi.fn() },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        openModal: mockOpenModal,
        switchSyncSetupTab: mockSwitchSyncSetupTab
      };

      const fn = new Function('window', 'document', 'settings', 't', 'escH', 'openModal', 'switchSyncSetupTab', `${tutorialCode}; return window.SetupWizardController;`);
      const wizard = fn(mockWindow, document, mockWindow.settings, mockWindow.t, mockWindow.escH, mockOpenModal, mockSwitchSyncSetupTab);

      const closeSpy = vi.spyOn(wizard, 'close').mockImplementation(() => {});
      wizard.openCloudSignIn();

      expect(closeSpy).toHaveBeenCalled();
      expect(mockOpenModal).toHaveBeenCalledWith('modal-cloud-sync-setup');
      expect(mockSwitchSyncSetupTab).toHaveBeenCalledWith('signin');
    });

    it('delegates wizard corporate calendar actions to CalendarSyncService', async () => {
      const tutorialCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-tutorial.js'), 'utf8');
      const mockDownload = vi.spyOn(CalendarSyncService, 'downloadSyncScript').mockResolvedValue(true);
      const mockLink = vi.spyOn(CalendarSyncService, 'linkExternalAgentFolder').mockResolvedValue(true);
      const mockDisconnect = vi.spyOn(CalendarSyncService, 'disconnectExternalAgentFolder').mockImplementation(() => {});

      const mockWindow = {
        settings: { ui: { colors: { accent: '#4f46e5' } }, ai: {} },
        t: (k) => k,
        escH: (s) => s || '',
        localStorage: { getItem: vi.fn(), setItem: vi.fn() },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        CalendarSyncService
      };

      const fn = new Function('window', 'document', 'settings', 't', 'escH', 'CalendarSyncService', `${tutorialCode}; return window.SetupWizardController;`);
      const wizard = fn(mockWindow, document, mockWindow.settings, mockWindow.t, mockWindow.escH, CalendarSyncService);
      wizard.render = vi.fn();

      wizard.downloadSyncScript();
      expect(mockDownload).toHaveBeenCalled();

      await wizard.connectCorporateFolder();
      expect(mockLink).toHaveBeenCalled();
      expect(wizard.render).toHaveBeenCalled();

      wizard.disconnectCorporateFolder();
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe('External Agent File Access, Script Download & Session Cleanup', () => {
    it('provides valid sync shell script content containing JXA fallback', () => {
      const script = CalendarSyncService.getSyncScriptContent();
      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain('planner-proposals.json');
      expect(script).toContain('osascript -l JavaScript');
      expect(script).toContain('inferType');
    });

    it('downloads the sync shell script via temporary blob URL and anchor trigger', async () => {
      const createObjectURLMock = vi.fn().mockReturnValue('blob:http://localhost/mock-uuid');
      const revokeObjectURLMock = vi.fn();
      global.URL.createObjectURL = createObjectURLMock;
      global.URL.revokeObjectURL = revokeObjectURLMock;

      let clicked = false;
      let downloadAttr = '';
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') {
          el.click = () => {
            clicked = true;
            downloadAttr = el.download;
          };
        }
        return el;
      });

      window.toast = vi.fn();
      await CalendarSyncService.downloadSyncScript();

      expect(createObjectURLMock).toHaveBeenCalled();
      expect(clicked).toBe(true);
      expect(downloadAttr).toBe('sync_local_calendar.sh');
    });

    it('downloads sync_local_calendar.ps1 on Windows platform', async () => {
      let clicked = false;
      let downloadAttr = '';
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') {
          el.click = () => {
            clicked = true;
            downloadAttr = el.download;
          };
        }
        return el;
      });

      window.toast = vi.fn();
      await CalendarSyncService.downloadSyncScript('win');

      expect(clicked).toBe(true);
      expect(downloadAttr).toBe('sync_local_calendar.ps1');
    });

    it('handles direct upload of external agent proposals JSON file', async () => {
      const mockMerge = vi.spyOn(CalendarSyncService, '_mergeIntoProposals').mockResolvedValue({ added: 2, skipped: 0 });
      window.toast = vi.fn();

      const jsonContent = JSON.stringify({
        version: 1,
        proposals: [
          { id: 'p-ext-1', title: 'External Call', date: '2026-10-21', startTime: '10:00', duration: 45 },
          { id: 'p-ext-2', title: 'External Sync', date: '2026-10-21', startTime: '11:00', duration: 30 }
        ]
      });

      const mockFile = {
        name: 'planner-proposals.json',
        text: vi.fn().mockResolvedValue(jsonContent)
      };

      await CalendarSyncService.handleExternalFile(mockFile);

      expect(mockMerge).toHaveBeenCalled();
      expect(CalendarSyncService._externalLoadedInfo).toEqual({
        type: 'file',
        name: 'planner-proposals.json',
        count: 2
      });
      expect(window.toast).toHaveBeenCalled();
    });

    it('handles direct upload of calendar ICS file as external input', async () => {
      const mockMerge = vi.spyOn(CalendarSyncService, '_mergeIntoProposals').mockResolvedValue({ added: 1, skipped: 0 });
      window.toast = vi.fn();

      const icsContent = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:ext-ics-1',
        'DTSTART:20261022T090000Z',
        'DTEND:20261022T100000Z',
        'SUMMARY:Client Roadmap Sync',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const mockFile = {
        name: 'export.ics',
        text: vi.fn().mockResolvedValue(icsContent)
      };

      await CalendarSyncService.handleExternalFile(mockFile);

      expect(mockMerge).toHaveBeenCalled();
      expect(CalendarSyncService._externalLoadedInfo).toEqual({
        type: 'file',
        name: 'export.ics',
        count: 1
      });
    });

    it('links external results folder and syncs proposals from planner-proposals.json', async () => {
      const mockFileContent = JSON.stringify({
        proposals: [{ id: 'p-folder-1', title: 'Meeting from folder', date: '2026-10-22' }]
      });
      const mockFile = {
        text: vi.fn().mockResolvedValue(mockFileContent)
      };
      const mockFileHandle = {
        getFile: vi.fn().mockResolvedValue(mockFile)
      };
      const mockDirHandle = {
        name: 'AgentResults',
        getFileHandle: vi.fn().mockResolvedValue(mockFileHandle)
      };

      window.showDirectoryPicker = vi.fn().mockResolvedValue(mockDirHandle);
      const mockMerge = vi.spyOn(CalendarSyncService, '_mergeIntoProposals').mockResolvedValue({ added: 1, skipped: 0 });

      await CalendarSyncService.linkExternalAgentFolder();

      expect(CalendarSyncService._externalFolderHandle).toBe(mockDirHandle);
      expect(mockMerge).toHaveBeenCalled();
      expect(CalendarSyncService._externalLoadedInfo).toEqual({
        type: 'folder',
        name: 'AgentResults',
        count: 1
      });

      // Disconnect
      CalendarSyncService.disconnectExternalAgentFolder();
      expect(CalendarSyncService._externalFolderHandle).toBeNull();
      expect(CalendarSyncService._externalLoadedInfo).toBeNull();
    });

    it('clears external agent session, folder handle, and timers on user logoff', () => {
      CalendarSyncService._externalFolderHandle = { name: 'MyWorkspace' };
      CalendarSyncService._externalLoadedInfo = { type: 'folder', name: 'MyWorkspace', count: 5 };
      CalendarSyncService._externalFolderTimer = setInterval(() => {}, 10000);

      CalendarSyncService.clearExternalAgentSession();

      expect(CalendarSyncService._externalFolderHandle).toBeNull();
      expect(CalendarSyncService._externalLoadedInfo).toBeNull();
      expect(CalendarSyncService._externalFolderTimer).toBeNull();
    });
  });
});

