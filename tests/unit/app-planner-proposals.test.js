import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Planner Agent Proposals Engine (app-planner.js & app-storage.js)', () => {
  let plannerScope;

  beforeEach(() => {
    global.document = document;
    global.window = window;
    document.body.innerHTML = '';
    vi.restoreAllMocks();

    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');

    // Create container element
    const panel = document.createElement('div');
    panel.id = 'planner-panel';
    document.body.appendChild(panel);

    // Provide mocked dependencies
    const setupCode = `
      var plannerEvents = [];
      window.plannerEvents = plannerEvents;
      window.todosManifest = [];
      window.manifest = [];
      window.selectedPlannerEventId = null;
      window.plannerRightSidebarCollapsed = false;
      window.plannerActivePaneTab = 'unassigned';
      window.plannerRightPaneWidth = 320;
      window._plannerRightPaneWidth = 320;
      window.plannerViewMode = 'week';
      window.currentPlannerWeekStart = new Date(2026, 8, 14); // Monday Sept 14, 2026
      window.plannerDisplayDateOverride = null;
      window.plannerInitialFocusDate = null;
      window.plannerDaysCount = 7;
      window.plannerWorkingDays = [1, 2, 3, 4, 5];
      window.currentLang = 'en';
      window.workStartTime = '09:00';
      window.workEndTime = '18:00';
      window.plannerContextMenu = null;
      window.plannerContextMenuHandlers = [];
      window.isDailyReviewDateReviewed = function() { return false; };
      window.getAppLocale = function() { return 'en-US'; };
      window.closePlannerContextMenu = function() {};
      window.renderCalendarGrid = function() {};
      window._initPlannerPaneResizeHandle = function() {};
      window.renderPlannerSidePaneContent = function() {};
      window.getPlannerUnassignedTodos = function() { return []; };
      window.getPlannerNotDoneTodos = function() { return []; };
      window.getPlannerDaysToDisplay = function() { return [new Date(2026, 8, 14)]; };
      window.getPlannerWeeklyStats = function() { return { totalHours: 0, callHours: 0, workHours: 0, prepHours: 0 }; };
      window.populateTagEditor = vi.fn();
      window.pruneUnusedAutoCreatedColleagues = vi.fn();
      window.pushPlannerUndoState = vi.fn();
      window.saveManifest = vi.fn();
      window.timeToMinutes = function(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      window.minutesToTime = function(mins) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      };
      window.parseLocalDateValue = function(s) {
        if (!s) return new Date();
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
      };
      window.formatLocalDateValue = function(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
      };
      window._calcDurationMins = function(start, end) {
        if (!start || !end) return 30;
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        return (eh * 60 + em) - (sh * 60 + sm);
      };
      window.escA = function(s) { return String(s || '').replace(/"/g, '&quot;'); };
      window.escH = function(s) { return String(s || '').replace(/</g, '&lt;'); };
      window.jq = function(s) { return JSON.stringify(s); };
      window._plannerText = function(k, def) { return window.t(k) || def; };
      window._plannerTabLabel = function(lbl, count) { return lbl + ' (' + count + ')'; };
      window.inferPlannerEventType = function() { return 'work'; };
      window.toast = vi.fn();
      window.t = function(key) {
        const dict = {
          'planner.panel': 'Planner',
          'planner.blockLabel': 'Proposed Event',
          'planner.proposedByAgent': 'Agent',
          'planner.proposalAccepted': 'Proposal accepted and added to planner',
          'planner.proposalDismissed': 'Proposal dismissed',
          'planner.proposalsLabel': 'Agent Proposals',
          'planner.toggleProposalsTooltip': 'Toggle Agent Proposals visibility on planner grid',
          'planner.proposedBadge': 'Proposed',
          'planner.moreOptionsTooltip': 'More options',
          'common.collapseSidebar': 'Collapse sidebar',
          'common.expandSidebar': 'Expand sidebar'
        };
        return dict[key] || key;
      };
      window.savePlanner = vi.fn().mockResolvedValue(true);
      window.openPlanEventModal = vi.fn();
      window.broadcastSync = vi.fn();
      window.StorageAPI = {
        hasPlannerProposals: vi.fn().mockResolvedValue(true),
        readPlannerProposals: vi.fn(),
        writePlannerProposals: vi.fn().mockResolvedValue(true),
        writePlanner: vi.fn().mockResolvedValue(true),
        writeNoteContent: vi.fn().mockResolvedValue(true)
      };
    `;

    const runFunc = new Function(setupCode + '\n' + plannerCode + '\nreturn window;');
    plannerScope = runFunc();
  });

  describe('normalizePlannerProposals', () => {
    it('handles arrays and wrapped objects correctly', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      
      const fromArray = normalize([
        { id: 'p1', title: 'Session 1', date: '2026-09-15', startTime: '10:00', endTime: '11:00' }
      ]);
      expect(fromArray).toHaveLength(1);
      expect(fromArray[0].id).toBe('p1');
      expect(fromArray[0].title).toBe('Session 1');

      const fromObject = normalize({
        _notice: 'Do not delete',
        version: 1,
        proposals: [
          { id: 'p2', title: 'Session 2', date: '2026-09-16', startTime: '14:00', endTime: '15:00' }
        ]
      });
      expect(fromObject).toHaveLength(1);
      expect(fromObject[0].id).toBe('p2');
    });

    it('deduplicates proposals by ID and keeps the latest entry', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      const raw = [
        { id: 'agent-101', title: 'Draft v1', date: '2026-09-16', startTime: '09:00', endTime: '10:00' },
        { id: 'agent-102', title: 'Other Event', date: '2026-09-16', startTime: '11:00', endTime: '12:00' },
        { id: 'agent-101', title: 'Draft v2 Updated', date: '2026-09-16', startTime: '09:30', endTime: '10:30' }
      ];

      const result = normalize(raw);
      expect(result).toHaveLength(2);
      const p101 = result.find(p => p.id === 'agent-101');
      expect(p101.title).toBe('Draft v2 Updated');
      expect(p101.startTime).toBe('09:30');
    });

    it('automatically flags proposals as accepted if matching proposalId exists in current plannerEvents', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      const currentEvents = [
        { id: 'evt-1', proposalId: 'agent-already-accepted', title: 'Already in Planner' }
      ];
      const raw = [
        { id: 'agent-already-accepted', title: 'Already in Planner', date: '2026-09-16', status: 'pending' },
        { id: 'agent-pending-new', title: 'New Proposal', date: '2026-09-16', status: 'pending' }
      ];

      const result = normalize(raw, currentEvents);
      expect(result).toHaveLength(2);
      expect(result.find(p => p.id === 'agent-already-accepted').status).toBe('accepted');
      expect(result.find(p => p.id === 'agent-pending-new').status).toBe('pending');
    });

    it('sanitizes date, times, durations and fallback titles', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      const raw = [
        { id: '', title: '', date: 'invalid-date', startTime: '9:00', duration: 45 }
      ];

      const result = normalize(raw);
      expect(result).toHaveLength(1);
      const item = result[0];
      expect(item.id).toMatch(/^prop-/);
      expect(item.title).toBe('Proposed Event');
      expect(item.startTime).toBe('09:00');
      expect(item.endTime).toBe('09:45');
      expect(item.type).toBe('work');
      expect(item.status).toBe('pending');
    });

    it('handles flexible duration inputs (units, decimals, ISO 8601, full-day variance 1440 & 1439)', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      const raw = [
        { id: 'p-1.5h', date: '2026-09-15', startTime: '14:00', duration: '1.5h' },
        { id: 'p-45m', date: '2026-09-15', startTime: '09:00', duration: '45m' },
        { id: 'p-1h30', date: '2026-09-15', startTime: '10:00', duration: '1h 30m' },
        { id: 'p-clock', date: '2026-09-15', startTime: '11:00', duration: '01:15' },
        { id: 'p-iso', date: '2026-09-15', startTime: '16:00', duration: 'PT45M' },
        { id: 'p-1440', date: '2026-09-16', duration: 1440 },
        { id: 'p-1439', date: '2026-09-17', duration: 1439 },
        { id: 'p-allday-str', date: '2026-09-18', duration: 'all-day' }
      ];

      const result = normalize(raw);
      expect(result).toHaveLength(8);

      const p15 = result.find(p => p.id === 'p-1.5h');
      expect(p15.startTime).toBe('14:00');
      expect(p15.endTime).toBe('15:30');
      expect(p15.duration).toBe(90);

      const p45 = result.find(p => p.id === 'p-45m');
      expect(p45.startTime).toBe('09:00');
      expect(p45.endTime).toBe('09:45');
      expect(p45.duration).toBe(45);

      const p130 = result.find(p => p.id === 'p-1h30');
      expect(p130.startTime).toBe('10:00');
      expect(p130.endTime).toBe('11:30');
      expect(p130.duration).toBe(90);

      const pClock = result.find(p => p.id === 'p-clock');
      expect(pClock.startTime).toBe('11:00');
      expect(pClock.endTime).toBe('12:15');
      expect(pClock.duration).toBe(75);

      const pIso = result.find(p => p.id === 'p-iso');
      expect(pIso.startTime).toBe('16:00');
      expect(pIso.endTime).toBe('16:45');
      expect(pIso.duration).toBe(45);

      const p1440 = result.find(p => p.id === 'p-1440');
      expect(p1440.startTime).toBe('00:00');
      expect(p1440.endTime).toBe('23:59');
      expect(p1440.duration).toBe(1440);
      expect(p1440.allDay).toBe(true);

      const p1439 = result.find(p => p.id === 'p-1439');
      expect(p1439.startTime).toBe('00:00');
      expect(p1439.endTime).toBe('23:59');
      expect(p1439.duration).toBe(1439);
      expect(p1439.allDay).toBe(true);

      const pAllDay = result.find(p => p.id === 'p-allday-str');
      expect(pAllDay.startTime).toBe('00:00');
      expect(pAllDay.endTime).toBe('23:59');
      expect(pAllDay.allDay).toBe(true);
    });
  });

  describe('parsePlannerDuration', () => {
    it('correctly parses numbers (integers, decimals as hours, full-day 1440 & 1439 variance)', () => {
      const parse = plannerScope.parsePlannerDuration;
      expect(parse(45)).toBe(45);
      expect(parse(60)).toBe(60);
      expect(parse(1440)).toBe(1440);
      expect(parse(1439)).toBe(1439);
      expect(parse(1.5)).toBe(90);
      expect(parse(0.5)).toBe(30);
      expect(parse(2.5)).toBe(150);
    });

    it('correctly parses unit strings and hour-minute combinations', () => {
      const parse = plannerScope.parsePlannerDuration;
      expect(parse('45m')).toBe(45);
      expect(parse('45min')).toBe(45);
      expect(parse('45 mins')).toBe(45);
      expect(parse('90 minutes')).toBe(90);
      expect(parse('2h')).toBe(120);
      expect(parse('1.5 hrs')).toBe(90);
      expect(parse('1h 30m')).toBe(90);
      expect(parse('1h30')).toBe(90);
      expect(parse('1 hour 30 mins')).toBe(90);
      expect(parse('2 hours and 15 minutes')).toBe(135);
    });

    it('correctly parses clock format HH:MM and ISO 8601', () => {
      const parse = plannerScope.parsePlannerDuration;
      expect(parse('01:30')).toBe(90);
      expect(parse('00:45')).toBe(45);
      expect(parse('23:59')).toBe(1439);
      expect(parse('24:00')).toBe(1440);
      expect(parse('PT1H30M')).toBe(90);
      expect(parse('PT45M')).toBe(45);
      expect(parse('P1D')).toBe(1440);
    });

    it('correctly parses all-day / full-day keywords and falls back gracefully', () => {
      const parse = plannerScope.parsePlannerDuration;
      expect(parse('all-day')).toBe(1440);
      expect(parse('all day')).toBe(1440);
      expect(parse('full day')).toBe(1440);
      expect(parse('1d')).toBe(1440);
      expect(parse('ganztägig')).toBe(1440);
      expect(parse('toute la journée')).toBe(1440);
      expect(parse(null, 30)).toBe(30);
      expect(parse(undefined, 45)).toBe(45);
      expect(parse('invalid-string', 30)).toBe(30);
    });

    it('safely rejects malicious and adversarial duration inputs without throwing or stalling', () => {
      const parse = plannerScope.parsePlannerDuration;

      // Special number edge cases
      expect(parse(NaN, 30)).toBe(30);
      expect(parse(Infinity, 30)).toBe(30);
      expect(parse(-Infinity, 30)).toBe(30);
      expect(parse(-45, 30)).toBe(30);
      expect(parse(0, 30)).toBe(30);
      expect(parse(1e308, 30)).toBe(1440);
      expect(parse(999999999, 30)).toBe(1440);

      // Negative string durations
      expect(parse('-45m', 30)).toBe(30);
      expect(parse('-1h', 30)).toBe(30);
      expect(parse('-01:30', 30)).toBe(30);

      // Type spoofing & non-primitives
      expect(parse({}, 30)).toBe(30);
      expect(parse([], 30)).toBe(30);
      expect(parse(true, 30)).toBe(30);
      expect(parse(false, 30)).toBe(30);
      expect(parse(() => 60, 30)).toBe(30);
      expect(parse(Symbol('evil'), 30)).toBe(30);

      // Malicious payloads (XSS, SQLi, command injection)
      expect(parse('<script>alert(1)</script>', 30)).toBe(30);
      expect(parse("'; DROP TABLE planner; --", 30)).toBe(30);
      expect(parse('{"$gt": ""}', 30)).toBe(30);
      expect(parse('__proto__', 30)).toBe(30);
      expect(parse('constructor', 30)).toBe(30);

      // ReDoS / catastrophic backtracking protection on oversized strings
      const hugeString = '1' + ' '.repeat(500) + 'hours';
      expect(parse(hugeString, 30)).toBe(30);
      const longA = 'a'.repeat(1000);
      expect(parse(longA, 30)).toBe(30);
    });
  });

  describe('Adversarial and Malicious Proposals Normalization (Database Safety)', () => {
    it('handles non-array, null, or corrupted root proposal objects safely', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      expect(normalize(null)).toEqual([]);
      expect(normalize(undefined)).toEqual([]);
      expect(normalize('malicious string')).toEqual([]);
      expect(normalize(12345)).toEqual([]);
      expect(normalize(true)).toEqual([]);
      expect(normalize({ proposals: 'not an array' })).toEqual([]);
      expect(normalize({ events: null })).toEqual([]);
    });

    it('filters out corrupt and non-object array items', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      const corruptList = [
        null,
        undefined,
        42,
        'string item',
        true,
        false,
        [],
        () => {},
        { id: 'valid-1', title: 'Valid Event', date: '2026-09-15', startTime: '10:00', duration: 45 }
      ];

      const result = normalize(corruptList);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('valid-1');
      expect(result[0].title).toBe('Valid Event');
    });

    it('prevents prototype pollution and keeps global Object prototype pristine', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      const payload = JSON.parse('{"__proto__": {"polluted": "yes"}, "proposals": [{"id": "p-proto", "title": "Test"}]}');
      
      const result = normalize(payload);
      expect(result).toHaveLength(1);
      expect(({}).polluted).toBeUndefined();
      expect(Object.prototype.polluted).toBeUndefined();
    });

    it('sanitizes malicious dates, times, and field injections to protect storage and database integrity', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      const maliciousItems = [
        {
          id: '../../etc/passwd',
          title: '<script>alert("XSS")</script>',
          date: '2026-99-99', // invalid month and day
          startTime: '99:99', // invalid clock time
          endTime: '-01:00', // invalid clock time
          duration: -100, // negative duration
          type: '; DROP TABLE events; --', // malicious type
          description: '<img src=x onerror=alert(1)>',
          source: 'A'.repeat(500),
          collaborators: [null, undefined, {}, ['nested'], 12345, 'Alice', '<script>alert(1)</script>']
        }
      ];

      const result = normalize(maliciousItems);
      expect(result).toHaveLength(1);
      const sanitized = result[0];

      // ID is bounded
      expect(sanitized.id).toBe('../../etc/passwd');
      expect(sanitized.title).toBe('<script>alert("XSS")</script>');
      
      // Date falls back to a valid ISO format YYYY-MM-DD
      expect(sanitized.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      
      // Times fall back to safe defaults
      expect(sanitized.startTime).toBe('10:00');
      expect(sanitized.endTime).toBe('10:30');
      expect(sanitized.duration).toBe(30);

      // Type falls back to a valid category
      expect(['call', 'sync', 'prep', 'todo', 'work', 'ooo', 'custom']).toContain(sanitized.type);

      // Source is bounded
      expect(sanitized.source.length).toBeLessThanOrEqual(100);

      // Collaborators are sanitized to strings, objects/nulls filtered out
      expect(sanitized.collaborators).toEqual(['12345', 'Alice', '<script>alert(1)</script>']);

      // Ensure full JSON serialization succeeds without throwing
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('clamps extreme durations within single-day bounds (1 to 1440 mins)', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      const raw = [
        { id: 'p-huge', date: '2026-09-15', startTime: '10:00', duration: 999999 },
        { id: 'p-zero', date: '2026-09-15', startTime: '10:00', duration: 0 },
        { id: 'p-neg', date: '2026-09-15', startTime: '10:00', duration: -60 }
      ];

      const result = normalize(raw);
      expect(result).toHaveLength(3);

      const pHuge = result.find(p => p.id === 'p-huge');
      expect(pHuge.duration).toBe(1440);

      const pZero = result.find(p => p.id === 'p-zero');
      expect(pZero.duration).toBe(30); // falls back to 30

      const pNeg = result.find(p => p.id === 'p-neg');
      expect(pNeg.duration).toBe(30); // falls back to 30
    });

    it('guards against massive proposal entry floods (DoS protection cap at 1000 items)', () => {
      const normalize = plannerScope.normalizePlannerProposals;
      const massiveProposals = [];
      for (let i = 0; i < 3000; i++) {
        massiveProposals.push({
          id: `flood-${i}`,
          title: `Flooded Event ${i}`,
          date: '2026-09-15',
          startTime: '10:00',
          duration: 30
        });
      }

      const result = normalize(massiveProposals);
      // Caps strictly to MAX_PLANNER_PROPOSALS_CAP (1000 items)
      expect(result.length).toBeLessThanOrEqual(1000);
      expect(result.length).toBe(1000);
      // Preserves the latest proposals
      expect(result[result.length - 1].id).toBe('flood-2999');
    });

    it('caps rendered proposal blocks per day to prevent DOM node explosion', () => {
      const dayProposals = [];
      for (let i = 0; i < 150; i++) {
        dayProposals.push({
          id: `day-flood-${i}`,
          title: `Day Flood ${i}`,
          date: '2026-09-14',
          startTime: '10:00',
          endTime: '10:30',
          duration: 30,
          status: 'pending'
        });
      }

      plannerScope.showPlannerProposals = true;
      plannerScope.setPlannerProposals(dayProposals);
      const html = plannerScope.renderPlannerEventsForDayHTML('2026-09-14');
      // Check that proposed-event count is capped at 50
      const matches = html.match(/class="[^"]*proposed-event/g) || [];
      expect(matches.length).toBeLessThanOrEqual(50);
      expect(matches.length).toBe(50);
    });
  });

  describe('togglePlannerProposalsView', () => {
    it('toggles showPlannerProposals state and renders planner', () => {
      expect(plannerScope.showPlannerProposals).toBe(false);
      plannerScope.togglePlannerProposalsView();
      expect(plannerScope.showPlannerProposals).toBe(true);

      plannerScope.togglePlannerProposalsView();
      expect(plannerScope.showPlannerProposals).toBe(false);
    });
  });

  describe('quickAcceptPlannerProposal', () => {
    it('creates an event in plannerEvents and updates proposal status to accepted', async () => {
      plannerScope.plannerEvents.length = 0;
      plannerScope.setPlannerProposals([
        {
          id: 'prop-quick-1',
          title: 'Quick Sync',
          date: '2026-09-15',
          startTime: '11:00',
          endTime: '11:30',
          type: 'sync',
          description: 'Sync with agent',
          collaborators: ['Alice'],
          status: 'pending'
        }
      ]);

      await plannerScope.quickAcceptPlannerProposal('prop-quick-1');

      expect(plannerScope.plannerEvents).toHaveLength(1);
      const addedEvent = plannerScope.plannerEvents[0];
      expect(addedEvent.title).toBe('Quick Sync');
      expect(addedEvent.proposalId).toBe('prop-quick-1');
      expect(addedEvent.collaborators).toEqual(['Alice']);
      expect(plannerScope.StorageAPI.writePlanner).toHaveBeenCalled();

      const proposal = plannerScope.getPlannerProposals().find(p => p.id === 'prop-quick-1');
      expect(proposal.status).toBe('accepted');
      expect(plannerScope.StorageAPI.writePlannerProposals).toHaveBeenCalled();
      expect(plannerScope.toast).toHaveBeenCalledWith('Proposal accepted and added to planner');
    });
  });

  describe('dismissPlannerProposal', () => {
    it('marks proposal status as dismissed and persists file', async () => {
      plannerScope.setPlannerProposals([
        {
          id: 'prop-dismiss-1',
          title: 'Unwanted Event',
          date: '2026-09-15',
          status: 'pending'
        }
      ]);

      await plannerScope.dismissPlannerProposal('prop-dismiss-1');

      const proposal = plannerScope.getPlannerProposals().find(p => p.id === 'prop-dismiss-1');
      expect(proposal.status).toBe('dismissed');
      expect(plannerScope.StorageAPI.writePlannerProposals).toHaveBeenCalled();
      expect(plannerScope.toast).toHaveBeenCalledWith('Proposal dismissed');
    });
  });

  describe('openPlanEventModalFromProposal', () => {
    it('opens plan event modal with prefilled proposal fields', () => {
      plannerScope.setPlannerProposals([
        {
          id: 'prop-modal-1',
          title: 'Architecture Review',
          date: '2026-09-17',
          startTime: '15:00',
          endTime: '16:00',
          type: 'work',
          description: 'Deep dive into design',
          collaborators: ['Bob'],
          source: 'Agent Copilot',
          status: 'pending'
        }
      ]);

      plannerScope.openPlanEventModalFromProposal('prop-modal-1');

      const titleInput = document.getElementById('pe-title');
      const dateInput = document.getElementById('pe-date');
      const contextInput = document.getElementById('pe-context');

      expect(titleInput).not.toBeNull();
      expect(titleInput.value).toBe('Architecture Review');
      expect(dateInput.value).toBe('2026-09-17');
      expect(contextInput.value).toBe('Deep dive into design');
    });
  });

  describe('loadPlannerProposals', () => {
    it('automatically creates planner-proposals.json with standard schema when file does not exist', async () => {
      plannerScope.StorageAPI.hasPlannerProposals.mockResolvedValue(false);
      plannerScope.StorageAPI.writePlannerProposals.mockResolvedValue(true);

      await plannerScope.loadPlannerProposals();

      expect(plannerScope.getPlannerProposals()).toEqual([]);
      expect(plannerScope.StorageAPI.writePlannerProposals).toHaveBeenCalledWith(expect.objectContaining({
        _notice: expect.stringContaining('Do NOT delete or overwrite'),
        version: 1,
        proposals: []
      }));
    });

    it('loads and normalizes existing proposals when file exists', async () => {
      plannerScope.StorageAPI.hasPlannerProposals.mockResolvedValue(true);
      plannerScope.StorageAPI.readPlannerProposals.mockResolvedValue({
        version: 1,
        proposals: [
          { id: 'prop-1', title: 'Code Review', date: '2026-09-16', startTime: '10:00', endTime: '11:00', status: 'pending' }
        ]
      });

      await plannerScope.loadPlannerProposals();

      expect(plannerScope.getPlannerProposals()).toHaveLength(1);
      expect(plannerScope.getPlannerProposals()[0].title).toBe('Code Review');
    });
  });

  describe('Storage persistence notice preserving', () => {
    it('includes default append-only _notice when creating or persisting file', async () => {
      plannerScope.setPlannerProposals([
        { id: 'p1', title: 'Test', date: '2026-09-15', status: 'pending' }
      ]);
      plannerScope.StorageAPI.readPlannerProposals.mockResolvedValue(null);

      await plannerScope.persistPlannerProposals();

      expect(plannerScope.StorageAPI.writePlannerProposals).toHaveBeenCalledWith(expect.objectContaining({
        _notice: expect.stringContaining('Do NOT delete or overwrite'),
        version: 1,
        proposals: plannerScope.getPlannerProposals()
      }));
    });

    it('preserves custom _notice if present in existing file', async () => {
      plannerScope.setPlannerProposals([
        { id: 'p2', title: 'Test 2', date: '2026-09-16', status: 'pending' }
      ]);
      plannerScope.StorageAPI.readPlannerProposals.mockResolvedValue({
        _notice: 'Custom Notice from Agent',
        version: 2,
        proposals: []
      });

      await plannerScope.persistPlannerProposals();

      expect(plannerScope.StorageAPI.writePlannerProposals).toHaveBeenCalledWith(expect.objectContaining({
        _notice: 'Custom Notice from Agent',
        version: 2,
        proposals: plannerScope.getPlannerProposals()
      }));
    });
  });

  describe('External Agent Settings UI & Copy Functionality', () => {
    it('populates textarea with formatted guidelines for mail-to-planner external agents', () => {
      const initCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-init.js'), 'utf8');
      const promptsCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-prompts.js'), 'utf8');

      const textarea = document.createElement('textarea');
      textarea.id = 'prefs-external-agent-prompt';
      document.body.appendChild(textarea);

      const runFunc = new Function(`
        window.settings = { username: 'Etienne' };
        window.toast = vi.fn();
        window.t = function(k) { return k; };
        window.normalizeLanguageCode = function(c) { return c || 'en'; };
        window.applyLocalizedUI = function() {};
        window.deepMerge = function(a, b) { return Object.assign({}, a, b); };
        ${promptsCode}
        ${initCode}
        return window;
      `);

      const initScope = runFunc();
      initScope.updateExternalAgentPromptDisplay();

      expect(textarea.value).toContain('# External AI Agent Guidelines: Extracting Calendar Events from Email into Secretary');
      expect(textarea.value).toContain('planner-proposals.json');
      expect(textarea.value).toContain('on behalf of user "Etienne"');
    });

    it('copies external agent guidelines to clipboard on button click', async () => {
      const initCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-init.js'), 'utf8');
      const textarea = document.createElement('textarea');
      textarea.id = 'prefs-external-agent-prompt';
      textarea.value = 'Sample Guidelines Content';
      document.body.appendChild(textarea);

      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: writeTextMock
        },
        configurable: true
      });

      const runFunc = new Function(`
        window.settings = {};
        window.toast = vi.fn();
        window.t = function(k) { return k === 'prefs.agentPromptCopied' ? 'Guidelines copied!' : k; };
        window.normalizeLanguageCode = function(c) { return c || 'en'; };
        window.applyLocalizedUI = function() {};
        window.deepMerge = function(a, b) { return Object.assign({}, a, b); };
        ${initCode}
        return window;
      `);

      const initScope = runFunc();
      await initScope.copyExternalAgentPrompt();

      expect(writeTextMock).toHaveBeenCalledWith('Sample Guidelines Content');
      expect(initScope.toast).toHaveBeenCalledWith('Guidelines copied!');
    });
  });
});
