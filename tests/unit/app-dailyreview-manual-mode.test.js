import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Daily Review Manual Mode (When AI is disabled)', () => {
  let DailyReviewController;
  let mockStorageAPI;
  let writtenFiles;

  beforeEach(() => {
    writtenFiles = {};
    document.body.innerHTML = `
      <div id="daily-review-overlay" style="display:none;">
        <div id="dr-header-desc"></div>
        <div id="dr-step-title"></div>
        <div id="dr-step-date-select" style="display:none;"></div>
        <div id="dr-step-1" style="display:none;"></div>
        <div id="dr-step-2" style="display:none;"></div>
        <div id="dr-step-3" style="display:none;">
          <div id="dr-note-review-editor-container"></div>
          <div id="dr-note-review-list"></div>
        </div>
        <div id="dr-step-ai" style="display:none;">
          <div id="dr-ai-left-panel" style="flex: 1.8;">
            <h3 id="dr-step5-title"></h3>
            <p id="dr-step5-desc"></p>
            <div id="dr-ai-loading" style="display:none;">
              <div id="dr-ai-loading-title"></div>
              <div id="dr-ai-loading-details"></div>
              <button id="btn-dr-ai-cancel"><span>Annuler</span></button>
            </div>
            <div id="dr-ai-editor">
              <input type="text" id="dr-ai-summary-title" style="display:none;" />
              <div id="dr-ai-summary-content" style="display:none;"></div>
              <div class="dr-step5-tab-bar">
                <button type="button" id="dr-tab-summary-note" class="active"><span id="dr-tab-summary-note-label">Résumé</span></button>
                <button type="button" id="dr-tab-summaries-list"><span id="dr-tab-summaries-list-label">Notes</span></button>
                <button type="button" id="dr-tab-workstream-updates"><span id="dr-tab-workstream-updates-label">Workstreams</span></button>
              </div>
              <div id="dr-step5-tab-note">
                <div id="dr-step5-editor-container"></div>
              </div>
              <div id="dr-step5-tab-list" style="display:none;">
                <div id="dr-ai-meeting-summaries-list"></div>
                <span id="dr-step5-notes-count">0</span>
              </div>
              <div id="dr-step5-tab-workstreams" style="display:none;">
                <div id="dr-ai-workstream-updates-list"></div>
                <span id="dr-step5-ws-count">0</span>
              </div>
            </div>
          </div>
          <div id="dr-ai-suggestions-panel" style="display:flex;">
            <div id="dr-ai-suggestions-list"></div>
          </div>
        </div>
        <div id="dr-ai-regenerate-wrap" style="display:none;">
          <button id="btn-dr-ai-regenerate"></button>
        </div>
        <button id="btn-dr-prev"></button>
        <button id="btn-dr-next"></button>
      </div>
      <div id="note-edit-overlay" style="display:none;">
        <div class="overlay-panel">
          <div class="overlay-header-container">
            <span id="edit-meta-title-preview"></span>
            <button id="overlay-validate-note-btn"></button>
          </div>
          <div class="overlay-main-layout">
            <div id="note-edit">
              <div id="edit-meta-wrap">
                <input id="edit-title" />
              </div>
              <div id="edit-textarea" contenteditable="true"></div>
            </div>
            <div id="overlay-right-panel" class="collapsed"></div>
          </div>
        </div>
      </div>
    `;

    global.manifest = [
      {
        id: 'note-1',
        path: 'notes/meeting-1.html',
        title: 'Project Kickoff',
        date: '2026-09-07',
        group: 'Eng',
        summary: '<p>Discussed roadmap and milestones.</p>'
      },
      {
        id: 'note-2',
        path: 'notes/meeting-2.html',
        title: 'Design Review',
        date: '2026-09-07',
        group: 'Design',
        summary: '<p>Agreed on color palette and typography.</p>'
      }
    ];

    global.plannerEvents = [
      {
        id: 'ev-1',
        title: 'Project Kickoff',
        date: '2026-09-07',
        startTime: '09:00',
        endTime: '10:00',
        duration: 60,
        noteId: 'note-1',
        type: 'event'
      },
      {
        id: 'ev-2',
        title: 'Focus Sprint',
        date: '2026-09-07',
        startTime: '14:00',
        endTime: '16:00',
        duration: 120,
        type: 'event'
      }
    ];

    mockStorageAPI = {
      readNoteContent: vi.fn().mockImplementation(async (p) => {
        return writtenFiles[p] || '<main><p>Default note content</p></main>';
      }),
      writeNoteContent: vi.fn().mockImplementation(async (p, content) => {
        writtenFiles[p] = content;
        return true;
      })
    };
    global.StorageAPI = mockStorageAPI;

    // AI is strictly DISABLED
    global.LLMService = {
      isEnabled: () => false
    };
    global.settings = {
      ai: { enabled: false }
    };

    global.parseLocalDateValue = (s) => (s ? new Date(s + 'T00:00:00') : new Date());
    global.formatLocalDateValue = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
    global.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    global.escA = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    global.t = (key, params) => {
      const frMap = {
        'notes.dailySummary': 'Résumé quotidien',
        'dailyreview.stepManualSummaryTitle': 'Résumé quotidien',
        'dailyreview.stepManualSummaryDesc': 'Rédigez un résumé de votre journée. Les résumés de réunions sont affichés dans l\'onglet dédié.',
        'dailyreview.summarySectionDay': 'Résumé de la journée',
        'dailyreview.summarySectionProjects': 'Progrès par projet',
        'dailyreview.summarySectionPending': 'Sujets en attente ou nouveaux à aborder',
        'dailyreview.summarySectionReviewedNotes': `Notes et activités révisées (${params?.count ?? 0})`,
        'dailyreview.summarySectionTimeSpent': 'Temps passé par sujet',
        'dailyreview.summaryLargeBlockFlag': 'bloc de temps important',
        'dailyreview.noNotesReviewedToday': 'Aucune note créée ou révisée aujourd\'hui.',
        'dailyreview.readNoteBtn': 'Lire la note',
        'dailyreview.readNoteBtnTooltip': 'Ouvrir cette note en mode lecture dans une fenêtre séparée',
        'dailyreview.insertIntoSummaryBtn': 'Insérer dans le résumé',
        'dailyreview.insertIntoSummaryTooltip': 'Insérer le titre et le résumé de cette note dans votre note journalière',
        'dailyreview.noteInsertedToast': 'Note insérée dans le résumé',
        'dailyreview.noSummaryAvailable': 'Aucun résumé disponible.',
        'editor.openNoteTooltip': 'Ouvrir cette note en mode lecture',
        'dailyreview.stepIndicator': `Étape ${params?.current} sur ${params?.total}`,
        'dailyreview.stepAITitle': "Synthèse Quotidienne par l'IA",
        'dailyreview.stepAIDesc': "L'IA a agrégé les notes de toutes vos réunions du jour dans une note journalière structurée.",
        'dailyreview.cancelAISummaryBtn': 'Annuler',
        'dailyreview.cancelAISummaryTooltip': 'Annuler la génération du résumé quotidien',
        'dailyreview.summaryNoteTab': 'Résumé quotidien',
        'dailyreview.summaryNoteTooltip': 'Éditer le résumé quotidien',
        'dailyreview.summariesListTab': 'Résumés des notes',
        'dailyreview.summariesListTooltip': 'Afficher la liste des synthèses de notes',
        'dailyreview.workstreamUpdatesTab': 'Workstreams',
        'dailyreview.workstreamUpdatesTabTooltip': 'Afficher les mises à jour des Workstreams extraites des notes'
      };
      return frMap[key] || key;
    };
    global.getAppLanguage = () => 'fr';
    global.getAppLocale = () => 'fr-FR';
    global.toast = vi.fn();
    global.saveManifest = vi.fn().mockResolvedValue(true);
    global.rebuildIndexHTML = vi.fn().mockResolvedValue(true);
    global.parseNoteHTML = (html) => ({
      title: 'Daily Summary',
      mainHTML: html ? html.replace(/<\/?main>/g, '') : '',
      summary: ''
    });

    global.openNoteOverlay = vi.fn().mockImplementation(async (path) => {
      const raw = await mockStorageAPI.readNoteContent(path);
      const parsed = global.parseNoteHTML(raw);
      global.currentNote = {
        path,
        title: 'Résumé quotidien - 07/09/2026',
        id: 'summary-2026-09-07',
        mainHTML: parsed.mainHTML
      };
      const editArea = document.getElementById('edit-textarea');
      if (editArea) {
        editArea.innerHTML = parsed.mainHTML;
      }
    });

    const code = fs.readFileSync(path.resolve(__dirname, '../../js/app-dailyreview.js'), 'utf8');
    const fn = new Function('window', 'document', 'StorageAPI', 'StashService', 'LLMService', 'WorkstreamMemoryEngine', code + '\nreturn DailyReviewController;');
    DailyReviewController = fn(
      global,
      document,
      mockStorageAPI,
      { list: async () => [] },
      global.LLMService,
      { getTopicMemoriesCatalog: async () => [], getMajorTopicMemory: async () => null }
    );
  });

  it('sets step title and description to manual summary strings when AI is disabled', async () => {
    DailyReviewController.reviewDateValue = '2026-09-07';
    DailyReviewController.reviewDate = new Date('2026-09-07T00:00:00');

    DailyReviewController.setStepTitle(5);
    const titleEl = document.getElementById('dr-step-title');
    expect(titleEl.textContent).toBe('Résumé quotidien');

    await DailyReviewController.loadStep(5);
    const headerDesc = document.getElementById('dr-header-desc');
    expect(headerDesc.textContent).toContain('Rédigez un résumé de votre journée');

    const step5Title = document.getElementById('dr-step5-title');
    expect(step5Title.textContent).toBe('Résumé quotidien');

    const step5Desc = document.getElementById('dr-step5-desc');
    expect(step5Desc.textContent).toContain('Rédigez un résumé de votre journée');
  });

  it('hides AI suggestions panel, regenerate wrap, and workstream tab, and expands left panel', async () => {
    DailyReviewController.reviewDateValue = '2026-09-07';
    DailyReviewController.reviewDate = new Date('2026-09-07T00:00:00');

    await DailyReviewController.renderAISummaryStep();

    const sugPanel = document.getElementById('dr-ai-suggestions-panel');
    expect(sugPanel.style.display).toBe('none');

    const regenWrap = document.getElementById('dr-ai-regenerate-wrap');
    expect(regenWrap.style.display).toBe('none');

    const wsTabBtn = document.getElementById('dr-tab-workstream-updates');
    expect(wsTabBtn.style.display).toBe('none');

    const leftPanel = document.getElementById('dr-ai-left-panel');
    expect(leftPanel.style.flex).toBe('1 1 100%');
  });

  it('compiles structured manual template with clear sections, notes, and time spent', async () => {
    DailyReviewController.reviewDateValue = '2026-09-07';
    DailyReviewController.reviewDate = new Date('2026-09-07T00:00:00');
    DailyReviewController.todayNotes = global.manifest.slice();

    const summaryHTML = await DailyReviewController.compileManualDailySummary();

    // Check headings
    expect(summaryHTML).toContain('Résumé quotidien');
    expect(summaryHTML).toContain('Résumé de la journée');
    expect(summaryHTML).toContain('Progrès par projet');
    expect(summaryHTML).toContain('Sujets en attente ou nouveaux à aborder');
    expect(summaryHTML).toContain('Notes et activités révisées (2)');
    expect(summaryHTML).toContain('Project Kickoff');
    expect(summaryHTML).toContain('Design Review');
    expect(summaryHTML).toContain('Temps passé par sujet');
    expect(summaryHTML).toContain('Focus Sprint');
    expect(summaryHTML).toContain('bloc de temps important'); // 120min >= 90min
  });

  it('does not overwrite existing user summary content when mountStep5NoteEditor runs in manual mode', async () => {
    DailyReviewController.reviewDateValue = '2026-09-07';
    DailyReviewController.reviewDate = new Date('2026-09-07T00:00:00');
    DailyReviewController.todayNotes = global.manifest.slice();

    // User already wrote something
    const userWrittenContent = '<p>Mon résumé personnalisé que j\'ai rédigé manuellement.</p>';
    writtenFiles['notes/daily-summary-2026-09-07.html'] = `<main>${userWrittenContent}</main>`;

    await DailyReviewController.mountStep5NoteEditor();

    const editArea = document.getElementById('edit-textarea');
    expect(editArea.innerHTML).toContain('Mon résumé personnalisé');
    expect(editArea.innerHTML).not.toContain('Progrès par projet');
  });

  it('renders interactive meeting cards with localized hover tooltips and allows inserting note into summary', async () => {
    DailyReviewController.reviewDateValue = '2026-09-07';
    DailyReviewController.reviewDate = new Date('2026-09-07T00:00:00');
    DailyReviewController.todayNotes = global.manifest.slice();

    await DailyReviewController.refreshStep5SummariesList();

    const cardTitle = document.querySelector('.dr-card-title');
    expect(cardTitle).not.toBeNull();
    expect(cardTitle.title).toBeTruthy();

    const readBtn = document.querySelector('.dr-open-note-btn');
    expect(readBtn).not.toBeNull();
    expect(readBtn.title).toBe('Ouvrir cette note en mode lecture dans une fenêtre séparée');

    const insertBtn = document.querySelector('.dr-insert-note-btn');
    expect(insertBtn).not.toBeNull();
    expect(insertBtn.title).toBe('Insérer le titre et le résumé de cette note dans votre note journalière');

    // Mount editor first
    const editArea = document.getElementById('edit-textarea');
    editArea.innerHTML = '<h3>Notes et activités révisées</h3><ul></ul>';
    global.currentNote = {
      id: 'summary-2026-09-07',
      path: 'notes/daily-summary-2026-09-07.html',
      title: 'Résumé quotidien',
      mainHTML: editArea.innerHTML
    };

    // Click insert on meeting 1
    await DailyReviewController.insertNoteIntoSummary('notes/meeting-1.html');

    expect(editArea.innerHTML).toContain('Project Kickoff');
    expect(editArea.innerHTML).toContain('Discussed roadmap and milestones.');
    expect(global.toast).toHaveBeenCalledWith('Note insérée dans le résumé');
  });

  it('localizes Step 5 header, cancel button, and tab buttons with hover tooltips in localizeUI()', () => {
    DailyReviewController.localizeUI();

    const titleEl = document.getElementById('dr-step5-title');
    expect(titleEl.textContent).toBe('Résumé quotidien');

    const descEl = document.getElementById('dr-step5-desc');
    expect(descEl.textContent).toContain('Rédigez un résumé de votre journée');

    const cancelBtn = document.getElementById('btn-dr-ai-cancel');
    expect(cancelBtn.title).toBe('Annuler la génération du résumé quotidien');
    expect(cancelBtn.textContent).toBe('Annuler');

    const tabNote = document.getElementById('dr-tab-summary-note');
    expect(tabNote.title).toBe('Éditer le résumé quotidien');
    expect(document.getElementById('dr-tab-summary-note-label').textContent).toBe('Résumé quotidien');

    const tabList = document.getElementById('dr-tab-summaries-list');
    expect(tabList.title).toBe('Afficher la liste des synthèses de notes');
    expect(document.getElementById('dr-tab-summaries-list-label').textContent).toBe('Résumés des notes');

    const tabWs = document.getElementById('dr-tab-workstream-updates');
    expect(tabWs.title).toBe('Afficher les mises à jour des Workstreams extraites des notes');
    expect(document.getElementById('dr-tab-workstream-updates-label').textContent).toBe('Workstreams');
  });
});
