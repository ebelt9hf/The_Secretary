import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Daily Review Combined Checklist & Summaries (app-retro.js)', () => {
  let translationsObj;

  beforeEach(() => {
    // Read translations.js to test retro.deepLabel across all 15 languages
    const transCode = fs.readFileSync(path.resolve(__dirname, '../../js/translations.js'), 'utf8');
    const fakeWindow = {};
    const transRunner = new Function('window', `
      ${transCode}
      return window.APP_TRANSLATIONS_BUNDLE.translations;
    `);
    translationsObj = transRunner(fakeWindow);
  });

  describe('retro.deepLabel Translation Parity', () => {
    const requiredLanguages = ['cs', 'de', 'en', 'es', 'fr', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'tr', 'uk'];

    it('has retro.deepLabel defined for all 15 supported languages', () => {
      expect(translationsObj['retro.deepLabel']).toBeDefined();
      for (const lang of requiredLanguages) {
        expect(translationsObj['retro.deepLabel'][lang]).toBeDefined();
        expect(typeof translationsObj['retro.deepLabel'][lang]).toBe('string');
        expect(translationsObj['retro.deepLabel'][lang].trim().length).toBeGreaterThan(0);
      }
      expect(translationsObj['retro.deepLabel']['de']).toBe('Deep Work');
      expect(translationsObj['retro.deepLabel']['en']).toBe('Deep Work');
      expect(translationsObj['retro.deepLabel']['fr']).toBe('Deep Work');
      expect(translationsObj['retro.deepLabel']['es']).toBe('Trabajo profundo');
      expect(translationsObj['retro.deepLabel']['cs']).toBe('Hluboká práce');
    });

    it('has retro.deepDesc defined for all 15 supported languages', () => {
      expect(translationsObj['retro.deepDesc']).toBeDefined();
      for (const lang of requiredLanguages) {
        expect(translationsObj['retro.deepDesc'][lang]).toBeDefined();
        expect(typeof translationsObj['retro.deepDesc'][lang]).toBe('string');
        expect(translationsObj['retro.deepDesc'][lang].trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe('renderRetroPanel UI Layout Structure', () => {
    let renderRetroPanel;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-02T10:00:00'));
      document.body.innerHTML = `
        <div id="retro-panel" class="retro-panel"></div>
      `;

      global.selectedRetroDate = new Date('2026-09-02T10:00:00'); // Wednesday
      global.manifest = [
        {
          id: 'summary-2026-08-31',
          path: 'notes/summary-2026-08-31.html',
          title: 'Tagesrückblick - 31/08/2026',
          date: '2026-08-31',
          major_topic_tags: ['Daily Summary'],
          summary: '<p>Key achievements on Monday</p>',
          preview: 'Key achievements on Monday'
        },
        {
          id: 'summary-2026-09-01',
          path: 'notes/summary-2026-09-01.html',
          title: 'Daily Summary - 01/09/2026',
          date: '2026-09-01',
          major_topic_tags: ['Daily Summary'],
          summary: '<div><h3>Review Title</h3><ul><li>Finished project architecture</li></ul></div>',
          preview: 'Finished project architecture'
        }
      ];

      global.todosManifest = [
        { id: 'todo-1', title: 'Task 1', priority: 'Done', modified: '2026-08-31', quadrant: 'Q1' },
        { id: 'todo-2', title: 'Task 2', priority: 'Urgent', quadrant: 'Q2', owner: 'Alice' }
      ];

      global.plannerEvents = [
        { id: 'ev-1', date: '2026-08-31', startTime: '09:00', endTime: '12:00', type: 'deep' },
        { id: 'ev-2', date: '2026-09-01', startTime: '14:00', endTime: '15:00', type: 'call' }
      ];

      global.StorageAPI = {
        readNoteContent: vi.fn().mockImplementation(async (filePath) => {
          if (filePath === 'notes/summary-2026-09-01.html') {
            return '<div class="prose"><h3>HTML Summary</h3><p>Full HTML details with scrollbar</p><ul><li>Item A</li><li>Item B</li></ul></div>';
          }
          return '<p>Monday full HTML content</p>';
        }),
        getNoteFromCache: vi.fn().mockReturnValue(null),
        list: vi.fn().mockResolvedValue([])
      };

      global.StashService = {
        list: vi.fn().mockResolvedValue([])
      };

      global.settings = {
        ui: {
          workingDays: [1, 2, 3, 4, 5]
        }
      };

      global.getAppLanguage = () => 'de';
      global.getAppLocale = () => 'de-DE';
      global.timeToMinutes = (timeStr) => {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      global.t = (key, params) => {
        if (key === 'week.dayNames') return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        if (translationsObj && translationsObj[key] && translationsObj[key]['de']) {
          let str = translationsObj[key]['de'];
          if (params) {
            Object.keys(params).forEach(p => { str = str.replace(new RegExp(`\\{${p}\\}`, 'g'), params[p]); });
          }
          return str;
        }
        return key;
      };
      global.escH = (s) => String(s || '');
      global.escA = (s) => String(s || '').replace(/"/g, '&quot;');
      global.formatLocalDateValue = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      global.isDateCoveredByOoo = (d) => {
        return (global.plannerEvents || []).some(ev => ev.type === 'ooo' && (ev.allDay || (!ev.startTime && !ev.endTime)) && d >= ev.date && d <= (ev.endDate || ev.date));
      };
      global.getCoveringOooEvent = (d) => {
        return (global.plannerEvents || []).find(ev => ev.type === 'ooo' && (ev.allDay || (!ev.startTime && !ev.endTime)) && d >= ev.date && d <= (ev.endDate || ev.date)) || null;
      };
      global.isDailyReviewDateReviewed = vi.fn().mockImplementation((d) => {
        return global.isDateCoveredByOoo(d);
      });
      global.openNoteOverlay = vi.fn();
      global.startDailyReview = vi.fn();
      global.window.startDailyReview = global.startDailyReview;

      const retroCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-retro.js'), 'utf8');
      const runner = new Function(`
        ${retroCode}
        return { renderRetroPanel, getRetroWeekBounds };
      `);
      const exportsObj = runner();
      renderRetroPanel = exportsObj.renderRetroPanel;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('renders combined section with tageszusammenfassung header and thin barplot on complete width', async () => {
      await renderRetroPanel();

      const panel = document.getElementById('retro-panel');
      expect(panel).not.toBeNull();

      // Combined section
      const combinedSection = panel.querySelector('.retro-summaries-section');
      expect(combinedSection).not.toBeNull();

      // 1. Header with icon and title
      const header = combinedSection.querySelector('.retro-summaries-header');
      expect(header).not.toBeNull();
      expect(header.textContent).toContain('Tageszusammenfassungen');

      // Badge count for daily summaries
      const badge = header.querySelector('#badge-summaries');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe('2');

      // 2. Thin barplot spanning complete width
      const barplotWrapper = combinedSection.querySelector('.retro-allocation-bar-container');
      expect(barplotWrapper).not.toBeNull();
      const thinBar = barplotWrapper.querySelector('#retro-stack-bar.thin');
      expect(thinBar).not.toBeNull();

      // Legend
      const legend = barplotWrapper.querySelector('#retro-stack-legend');
      expect(legend).not.toBeNull();
      expect(legend.textContent).toContain('Deep Work');
    });

    it('renders workdays on complete width with 1/6 space for day checklist cell and 5/6 for full HTML summaries', async () => {
      await renderRetroPanel();

      const workdaysList = document.getElementById('retro-workdays-list');
      expect(workdaysList).not.toBeNull();

      const rows = workdaysList.querySelectorAll('.retro-day-summary-row');
      expect(rows.length).toBeGreaterThanOrEqual(5); // 5 working days Monday-Friday

      // Verify row structure
      const firstRow = rows[0];
      const colLeft = firstRow.querySelector('.retro-day-summary-col-left');
      const colRight = firstRow.querySelector('.retro-day-summary-col-right');
      expect(colLeft).not.toBeNull();
      expect(colRight).not.toBeNull();

      // Left column contains day cell from checklist
      const dayCell = colLeft.querySelector('.retro-day-cell');
      expect(dayCell).not.toBeNull();
      expect(dayCell.querySelector('.planner-header-day')).not.toBeNull();
      expect(dayCell.querySelector('.planner-header-date')).not.toBeNull();

      // Right column contains full HTML summary card
      const summaryCard = colRight.querySelector('.retro-day-summary-card');
      expect(summaryCard).not.toBeNull();

      // Tuesday (2026-09-01) has a daily summary note
      const tuesdayRow = rows[1];
      const fullHtmlContainer = tuesdayRow.querySelector('.retro-summary-full-html');
      expect(fullHtmlContainer).not.toBeNull();
      expect(fullHtmlContainer.innerHTML).toContain('HTML Summary');
      expect(fullHtmlContainer.innerHTML).toContain('Full HTML details with scrollbar');

      // Unreviewed day has "Start Daily Review" action button
      const unreviewedRow = rows[2]; // Wednesday (2026-09-02)
      const startBtn = unreviewedRow.querySelector('.retro-start-day-review-btn');
      expect(startBtn).not.toBeNull();
      expect(startBtn.getAttribute('title')).toBeTruthy();
    });

    it('renders Debt (1/2) and Velocity (1/2) side-by-side in bottom grid', async () => {
      await renderRetroPanel();

      const panel = document.getElementById('retro-panel');
      const bottomGrid = panel.querySelector('.retro-bottom-grid');
      expect(bottomGrid).not.toBeNull();

      const debtCol = bottomGrid.querySelector('#retro-col-debt');
      const velocityCol = bottomGrid.querySelector('#retro-col-velocity');

      expect(debtCol).not.toBeNull();
      expect(velocityCol).not.toBeNull();

      expect(debtCol.textContent).toContain('Schulden');
      expect(velocityCol.textContent).toContain('Geschwindigkeit');

      // Debt and velocity items populated
      expect(debtCol.innerHTML).toContain('Task 2');
      expect(velocityCol.innerHTML).toContain('Task 1');
    });

    it('interactive buttons have hover tooltips satisfying title != textContent', async () => {
      await renderRetroPanel();

      const panel = document.getElementById('retro-panel');
      const buttons = panel.querySelectorAll('button');
      buttons.forEach(btn => {
        const title = btn.getAttribute('title');
        const text = btn.textContent.trim();
        expect(title).toBeTruthy();
        expect(title).not.toBe(text);
      });
    });

    it('marks OOO day with .is-ooo class, reduced height layout, auto-reviewed badge, and no start review button', async () => {
      // Thursday 2026-09-03 is full-day OOO
      global.plannerEvents.push({
        id: 'ev-ooo-thursday',
        date: '2026-09-03',
        type: 'ooo',
        allDay: true,
        title: 'Vacances d été'
      });

      await renderRetroPanel();

      const workdaysList = document.getElementById('retro-workdays-list');
      const rows = workdaysList.querySelectorAll('.retro-day-summary-row');

      // Thursday is index 3 (Monday=0, Tuesday=1, Wednesday=2, Thursday=3)
      const thursdayRow = rows[3];
      expect(thursdayRow).not.toBeNull();
      expect(thursdayRow.classList.contains('is-ooo')).toBe(true);

      // Left cell has .is-ooo and .reviewed
      const dayCell = thursdayRow.querySelector('.retro-day-cell');
      expect(dayCell.classList.contains('is-ooo')).toBe(true);
      expect(dayCell.classList.contains('reviewed')).toBe(true);
      expect(dayCell.getAttribute('onclick') || '').not.toContain('startDailyReview');

      // Right card has .is-ooo with title and badge, without start review button
      const summaryCard = thursdayRow.querySelector('.retro-day-summary-card');
      expect(summaryCard.classList.contains('is-ooo')).toBe(true);
      expect(summaryCard.textContent).toContain('Vacances d été');
      expect(summaryCard.querySelector('.retro-ooo-chip')).not.toBeNull();
      expect(summaryCard.querySelector('.retro-start-day-review-btn')).toBeNull();
      expect(summaryCard.textContent).not.toContain('No daily summary');
    });
  });
});

