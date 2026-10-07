import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('AppBridge Notifications & Planner Reminders', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-bridge.js',
      'js/app-planner.js'
    ]);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 14, 0, 0));
    PlannerReminderEngine.notifiedEventIds.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('provides AppBridge.notifications interface', async () => {
    expect(AppBridge.notifications).toBeDefined();
    expect(typeof AppBridge.notifications.show).toBe('function');
    expect(typeof AppBridge.notifications.isSupported).toBe('function');
    expect(typeof AppBridge.notifications.requestPermission).toBe('function');
  });

  it('PlannerReminderEngine identifies upcoming events within 10 minutes', () => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const futureDate = new Date(now.getTime() + 7 * 60000); // 7 minutes from now
    const hh = String(futureDate.getHours()).padStart(2, '0');
    const mm = String(futureDate.getMinutes()).padStart(2, '0');

    globalThis.plannerEvents = [
      {
        id: 'evt-upcoming-1',
        title: 'Strategy Review',
        date: todayStr,
        startTime: `${hh}:${mm}`,
        endTime: '23:59',
        allDay: false
      }
    ];

    let notifiedTitle = '';
    let notifiedBody = '';
    AppBridge.notifications.show = (title, opts) => {
      notifiedTitle = title;
      notifiedBody = opts.body;
      return true;
    };

    PlannerReminderEngine.checkUpcomingEvents();

    expect(PlannerReminderEngine.notifiedEventIds.has('evt-upcoming-1')).toBe(true);
    expect(notifiedBody).toContain('Strategy Review');
  });

  it('does not notify for events far in future, in past, or all-day', () => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const farFuture = new Date(now.getTime() + 60 * 60000); // 60 minutes
    const past = new Date(now.getTime() - 20 * 60000); // 20 minutes ago

    globalThis.plannerEvents = [
      {
        id: 'evt-far',
        title: 'Far Meeting',
        date: todayStr,
        startTime: `${String(farFuture.getHours()).padStart(2, '0')}:${String(farFuture.getMinutes()).padStart(2, '0')}`,
        allDay: false
      },
      {
        id: 'evt-past',
        title: 'Past Meeting',
        date: todayStr,
        startTime: `${String(past.getHours()).padStart(2, '0')}:${String(past.getMinutes()).padStart(2, '0')}`,
        allDay: false
      },
      {
        id: 'evt-allday',
        title: 'All Day Event',
        date: todayStr,
        allDay: true
      }
    ];

    let notifyCalled = false;
    AppBridge.notifications.show = () => {
      notifyCalled = true;
    };

    PlannerReminderEngine.checkUpcomingEvents();

    expect(notifyCalled).toBe(false);
    expect(PlannerReminderEngine.notifiedEventIds.size).toBe(0);
  });

  it('deduplicates notifications so the same event is not notified twice', () => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const futureDate = new Date(now.getTime() + 5 * 60000);
    const hh = String(futureDate.getHours()).padStart(2, '0');
    const mm = String(futureDate.getMinutes()).padStart(2, '0');

    globalThis.plannerEvents = [
      {
        id: 'evt-dup',
        title: 'Sprint Demo',
        date: todayStr,
        startTime: `${hh}:${mm}`,
        allDay: false
      }
    ];

    let count = 0;
    AppBridge.notifications.show = () => {
      count++;
    };

    PlannerReminderEngine.checkUpcomingEvents();
    PlannerReminderEngine.checkUpcomingEvents();

    expect(count).toBe(1);
  });
});
