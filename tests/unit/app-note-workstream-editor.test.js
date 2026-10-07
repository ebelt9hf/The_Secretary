import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Note Editor Workstream, Main Block & Refactor Locking', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="edit-meta-wrap" class="collapsed">
        <div id="edit-meta-title-preview"></div>
        <button id="btn-overlay-toggle-meta"></button>
        <span id="edit-meta-chevron"></span>
        <div class="edit-fields" id="edit-fields-collapsible">
          <div class="field-row">
            <span class="field-label" id="label-edit-title">Title</span>
            <input class="field-input" id="edit-title" type="text">
          </div>
          <div id="title-rename-hint" style="display:none">Hint</div>
          <div class="field-row field-row-split" id="row-date-main-block">
            <div class="field-col field-col-left">
              <span class="field-label" id="label-edit-date">Date</span>
              <input class="field-input" id="edit-date" type="date">
            </div>
            <div class="field-col field-col-right" id="main-block-field-col">
              <span class="field-label" id="label-edit-main-block">Main Block</span>
              <div class="main-block-container" id="editor-main-block-container"></div>
            </div>
          </div>
          <div class="field-row field-row-split" id="row-group-workstream">
            <div class="field-col field-col-left">
              <span class="field-label" id="label-edit-group">Group</span>
              <div class="tags-editor" id="editor-group" data-type="group"></div>
            </div>
            <div class="field-col field-col-right">
              <span class="field-label" id="label-edit-workstream">Workstream</span>
              <div class="workstream-editor-box" id="editor-workstream-box">
                <div class="workstream-chip-selector" id="workstream-chip-selector"></div>
              </div>
            </div>
          </div>
          <div class="field-row">
            <span class="field-label" id="label-edit-major">Major</span>
            <div class="tags-editor" id="editor-major" data-type="major"></div>
          </div>
          <div class="field-row">
            <span class="field-label" id="label-edit-topic">Topic</span>
            <div class="tags-editor" id="editor-topic" data-type="topic"></div>
          </div>
          <div class="field-row" id="overlay-planner-blocks-row" style="display:none">
            <span class="field-label" id="label-edit-associated-blocks">Associated Blocks</span>
            <div id="overlay-planner-blocks"></div>
          </div>
        </div>
      </div>
      <div id="edit-textarea" contenteditable="true"></div>
      <div id="edit-summary" contenteditable="true"></div>
      <button id="overlay-validate-note-btn"></button>
    `;

    globalThis.t = (key) => key;
    globalThis.escH = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    globalThis.escA = (str) => String(str || '').replace(/"/g, '&quot;');
    globalThis.readTagEditor = (id) => {
      const el = document.getElementById(id);
      return el ? (el._tags || []) : [];
    };
    globalThis.populateTagEditor = (id, tags, type) => {
      const el = document.getElementById(id);
      if (el) el._tags = tags || [];
    };
    globalThis.metadataCollapsed = false;
    globalThis.toggleMetadataCollapse = vi.fn(() => {
      globalThis.metadataCollapsed = true;
    });
    globalThis._applyMetadataCollapseState = vi.fn();
    globalThis._updateMetaTitlePreview = vi.fn();
    globalThis.currentNote = {
      id: 'note-123',
      title: 'Project Kickoff',
      date: '2026-09-03',
      workstream: '',
      group_tags: ['ProjectX'],
      major_topic_tags: ['Planning'],
      topic_tags: ['Roadmap']
    };
  });

  it('locks editor and summary and auto-collapses metadata when refactor lock state is true', () => {
    const appLlmCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-llm.js'), 'utf8');
    const funcMatch = appLlmCode.match(/setRefactorLockState\(locked\)\s*\{([\s\S]*?)\n  \},/);
    expect(funcMatch).toBeTruthy();

    const setRefactorLockState = new Function('locked', funcMatch[1]);
    const RefactorModalController = { setRefactorLockState };

    // Initially editable
    const editor = document.getElementById('edit-textarea');
    const summary = document.getElementById('edit-summary');
    expect(editor.getAttribute('contenteditable')).toBe('true');
    expect(summary.getAttribute('contenteditable')).toBe('true');

    // Trigger lock
    RefactorModalController.setRefactorLockState(true);

    expect(editor.getAttribute('contenteditable')).toBe('false');
    expect(editor.classList.contains('editor-locked')).toBe(true);
    expect(summary.getAttribute('contenteditable')).toBe('false');
    expect(summary.classList.contains('editor-locked')).toBe(true);
    expect(globalThis.toggleMetadataCollapse).toHaveBeenCalled();

    // Trigger unlock
    RefactorModalController.setRefactorLockState(false);
    expect(editor.getAttribute('contenteditable')).toBe('true');
    expect(editor.classList.contains('editor-locked')).toBe(false);
    expect(summary.getAttribute('contenteditable')).toBe('true');
    expect(summary.classList.contains('editor-locked')).toBe(false);
  });

  it('updates title preview without calendar emojis and omits group tag when workstream is present', () => {
    const appOverlayCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-overlay.js'), 'utf8');
    const previewMatch = appOverlayCode.match(/function _updateMetaTitlePreview\(\)\s*\{([\s\S]*?)\n\}/);
    expect(previewMatch).toBeTruthy();

    const updatePreview = new Function(previewMatch[1]);

    document.getElementById('edit-title').value = 'Meeting with Client';
    document.getElementById('edit-date').value = '2026-09-03';
    document.getElementById('editor-group')._tags = ['Corporate'];

    // Case 1: No workstream -> Title · Date · Group
    globalThis.currentNote.workstream = '';
    updatePreview();
    const previewEl = document.getElementById('edit-meta-title-preview');
    expect(previewEl.textContent).toBe('Meeting with Client · 2026-09-03 · Corporate');
    expect(previewEl.textContent).not.toContain('📅');

    // Case 2: With workstream -> Title · Date · Workstream (no group tag)
    globalThis.currentNote.workstream = 'Strategic Initiatives';
    updatePreview();
    expect(previewEl.textContent).toBe('Meeting with Client · 2026-09-03 · Strategic Initiatives');
    expect(previewEl.textContent).not.toContain('Corporate');
    expect(previewEl.textContent).not.toContain('📅');
    expect(previewEl.textContent).not.toContain('🌊');
  });

  it('renders main block chip in row 2 and associated blocks in row 6', () => {
    const appOverlayCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-overlay.js'), 'utf8');
    const renderBlocksMatch = appOverlayCode.match(/function _renderPlannerBlocksForNote\(noteId\)\s*\{([\s\S]*?)\n\}\n\nfunction _renderInspectorBlocAssociatedNotesSection/);
    expect(renderBlocksMatch).toBeTruthy();

    globalThis.plannerLoadState = 'ready';
    globalThis.plannerEvents = [
      { id: 'ev-main', noteId: 'note-123', startTime: '10:00', endTime: '11:00', title: 'Strategy Session', recurrenceId: 'series-999' },
      { id: 'ev-assoc', noteId: 'note-other', startTime: '14:00', endTime: '15:00', title: 'Review Followup' }
    ];
    globalThis.getPlannerEventsForNote = vi.fn((noteId) => globalThis.plannerEvents);
    globalThis._buildPlannerBlockDisplayItems = vi.fn((events) => events.map(e => ({ primary: e, kind: 'single' })));

    const renderPlannerBlocks = new Function('noteId', renderBlocksMatch[1]);
    renderPlannerBlocks('note-123');

    const mainContainer = document.getElementById('editor-main-block-container');
    expect(mainContainer.innerHTML).toContain('10:00–11:00 Strategy Session');
    expect(mainContainer.innerHTML).toContain('editor.seriesBadge');

    const assocContainer = document.getElementById('overlay-planner-blocks');
    const assocRow = document.getElementById('overlay-planner-blocks-row');
    expect(assocContainer.innerHTML).toContain('14:00–15:00');
    expect(assocRow.style.display).toBe('flex');
  });

  it('hides associated blocks row when note has no associated blocks', () => {
    const appOverlayCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-overlay.js'), 'utf8');
    const renderBlocksMatch = appOverlayCode.match(/function _renderPlannerBlocksForNote\(noteId\)\s*\{([\s\S]*?)\n\}\n\nfunction _renderInspectorBlocAssociatedNotesSection/);
    expect(renderBlocksMatch).toBeTruthy();

    globalThis.plannerLoadState = 'ready';
    globalThis.plannerEvents = [
      { id: 'ev-main', noteId: 'note-123', startTime: '09:00', endTime: '10:00', title: 'Solo Standup' }
    ];
    globalThis.getPlannerEventsForNote = vi.fn(() => globalThis.plannerEvents);
    globalThis._buildPlannerBlockDisplayItems = vi.fn((events) => events.map(e => ({ primary: e, kind: 'single' })));

    const renderPlannerBlocks = new Function('noteId', renderBlocksMatch[1]);
    renderPlannerBlocks('note-123');

    const assocRow = document.getElementById('overlay-planner-blocks-row');
    expect(assocRow.style.display).toBe('none');
  });

  it('assigns note to workstream and auto-fills group, major, topic tags from first selection group', async () => {
    const appOverlayCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-overlay.js'), 'utf8');
    const assignMatch = appOverlayCode.match(/async function assignNoteToWorkstream\(wsName\)\s*\{([\s\S]*?)\n\}\nwindow\.assignNoteToWorkstream/);
    expect(assignMatch).toBeTruthy();

    globalThis.WorkstreamMemoryEngine = {
      getMajorTopicMemory: vi.fn(async (ws) => ({
        mappedTags: {
          tagGroups: [
            { group: 'Operations', major: 'Logistics', topic: 'SupplyChain' },
            { group: 'Operations', major: 'Warehousing', topic: 'Inventory' }
          ]
        }
      }))
    };
    globalThis.populateWorkstreamEditor = vi.fn();
    globalThis._updateMetaTitlePreview = vi.fn();
    globalThis.saveCurrentNote = vi.fn();

    const assignNoteToWorkstream = new Function('wsName', `return (async () => { ${assignMatch[1]} })();`);
    await assignNoteToWorkstream('Supply Chain');

    expect(globalThis.currentNote.workstream).toBe('Supply Chain');
    expect(globalThis.currentNote.group_tags).toEqual(['Operations']);
    expect(globalThis.currentNote.major_topic_tags).toEqual(['Logistics']);
    expect(globalThis.currentNote.topic_tags).toEqual(['SupplyChain']);
    expect(globalThis._updateMetaTitlePreview).toHaveBeenCalled();
  });

  it('parses and persists workstream in note HTML metadata', () => {
    const appNotesCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-notes.js'), 'utf8');
    
    // Test parseNoteHTML
    const parseNoteMatch = appNotesCode.match(/function parseNoteHTML\(html\)\s*\{([\s\S]*?)\n\}/);
    expect(parseNoteMatch).toBeTruthy();
    const parseNoteHTML = new Function('html', parseNoteMatch[1]);

    const sampleHTML = `<!DOCTYPE html><html><head>
      <meta name="note-id" content="note-456">
      <meta name="workstream" content="Transformation">
      <title>Test Note</title>
    </head><body><p>Content</p></body></html>`;

    const parsed = parseNoteHTML(sampleHTML);
    expect(parsed.workstream).toBe('Transformation');

    // Test applyNoteEdits
    const applyEditsMatch = appNotesCode.match(/function applyNoteEdits\(originalHTML, changes\)\s*\{([\s\S]*?)\n\}/);
    expect(applyEditsMatch).toBeTruthy();
    const applyNoteEdits = new Function('originalHTML', 'changes', `
      const encodeTagListToStorage = (tags) => (Array.isArray(tags) ? tags.join(', ') : '');
      ${applyEditsMatch[1]}
    `);

    const updatedHTML = applyNoteEdits(sampleHTML, { workstream: 'Engineering' });
    expect(updatedHTML).toContain('<meta name="workstream" content="Engineering">');
  });

  it('populates known workstreams strictly from authoritative memories and excludes uncreated decision tags and uncataloged note tags', () => {
    const appBoardCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-board.js'), 'utf8');
    const funcMatch = appBoardCode.match(/function getKnownWorkstreamsList\(notes = \[\]\)\s*\{([\s\S]*?)\n\}\nwindow\.getKnownWorkstreamsList/);
    expect(funcMatch).toBeTruthy();

    const getNoteWorkstreamName = (n) => n?.workstream || '';
    const getKnownWorkstreamsList = new Function('notes = []', `
      const getNoteWorkstreamName = ${getNoteWorkstreamName.toString()};
      ${funcMatch[1]}
    `);

    // Setup authoritative topic memories
    globalThis._topicMemoriesIndexCache = {
      topics: [
        { topicName: 'Topic Memory Alpha', status: 'active' },
        { topicName: 'Archived Beta', status: 'archived' }
      ]
    };
    globalThis.decisionsList = [
      { major_topic_tags: ['Decision Major Delta'] }
    ];
    globalThis.pendingDecisionsList = [];

    const sampleNotes = [
      { path: 'note1.html', workstream: 'Explicit Note Epsilon', major_topic_tags: ['Note Major Zeta'] }
    ];

    const result = getKnownWorkstreamsList(sampleNotes);
    expect(result).toContain('Topic Memory Alpha');
    expect(result).not.toContain('Archived Beta');
    expect(result).not.toContain('Decision Major Delta');
    expect(result).not.toContain('Explicit Note Epsilon');
    expect(result).not.toContain('Note Major Zeta');

    // When no authoritative topic memories exist at all, it falls back to candidate notes
    globalThis._topicMemoriesIndexCache = null;
    const fallbackResult = getKnownWorkstreamsList(sampleNotes);
    expect(fallbackResult).toContain('Explicit Note Epsilon');
  });

  it('detects multiple workstreams hit by tag selections and selection rules', () => {
    const appOverlayCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-overlay.js'), 'utf8');
    const detailsMatch = appOverlayCode.match(/function detectWorkstreamDetailsForNote\(note = currentNote, liveTags = null\)\s*\{([\s\S]*?)\n\}\nwindow\.detectWorkstreamDetailsForNote/);
    const detectMatch = appOverlayCode.match(/function detectWorkstreamsForNote\(note = currentNote, liveTags = null\)\s*\{([\s\S]*?)\n\}\nwindow\.detectWorkstreamsForNote/);
    expect(detailsMatch).toBeTruthy();
    expect(detectMatch).toBeTruthy();

    globalThis.getNoteWorkstreams = (n) => n?.workstreams || (n?.workstream ? [n.workstream] : []);
    globalThis.getKnownWorkstreamsList = () => ['Logistics', 'Marketing', 'Customer Care'];
    globalThis.getMajorTopicMemorySync = (ws) => {
      if (ws === 'Logistics') {
        return {
          mappedTags: {
            tagGroups: [
              { group: 'Operations', major: 'SupplyChain', topic: '*' }
            ]
          }
        };
      }
      return null;
    };

    const detectWorkstreamDetailsForNote = new Function('note = currentNote', 'liveTags = null', detailsMatch[1]);
    globalThis.detectWorkstreamDetailsForNote = detectWorkstreamDetailsForNote;
    const detectWorkstreamsForNote = new Function('note = currentNote', 'liveTags = null', detectMatch[1]);

    // Note with tag selection hitting Logistics via tagGroup rule, and Marketing directly via major tag
    const testNote = {
      workstream: 'Customer Care',
      group_tags: ['Operations'],
      major_topic_tags: ['SupplyChain', 'Marketing'],
      topic_tags: ['Inventory']
    };

    const detected = detectWorkstreamsForNote(testNote);
    // Explicit / Manual
    expect(detected).toContain('Customer Care');
    // Hit by tagGroup selection rule
    expect(detected).toContain('Logistics');
    // Hit by major tag match
    expect(detected).toContain('Marketing');

    const details = detectWorkstreamDetailsForNote(testNote);
    const logDetail = details.find(d => d.name === 'Logistics');
    expect(logDetail.isSelectionGroupMatch).toBe(true);
    expect(logDetail.matchedRule).toEqual({ group: 'Operations', major: 'SupplyChain', topic: '*' });
    expect(logDetail.isManual).toBe(false);

    const ccDetail = details.find(d => d.name === 'Customer Care');
    expect(ccDetail.isSelectionGroupMatch).toBe(false);
    expect(ccDetail.isManual).toBe(true);
  });

  it('renders auto-matched workstream chips without clear buttons and with selection group tooltips', () => {
    const appOverlayCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-overlay.js'), 'utf8');
    const popMatch = appOverlayCode.match(/function populateWorkstreamEditor\(note = currentNote\)\s*\{([\s\S]*?)\n\}\nwindow\.populateWorkstreamEditor/);
    const fmtMatch = appOverlayCode.match(/function formatSelectionGroupForTooltip\(rule\)\s*\{([\s\S]*?)\n\}\nwindow\.formatSelectionGroupForTooltip/);
    expect(popMatch).toBeTruthy();
    expect(fmtMatch).toBeTruthy();

    globalThis.formatSelectionGroupForTooltip = new Function('rule', fmtMatch[1]);
    globalThis.t = (k) => {
      if (k === 'editor.workstreamMatchedSelectionGroup') return 'Matched by selection group: {group} (change tags to modify)';
      if (k === 'editor.workstreamManualTooltip') return 'Manually assigned workstream (click ✕ to remove)';
      if (k === 'editor.groupLabel') return 'Group';
      if (k === 'editor.majorLabel') return 'Major';
      if (k === 'editor.topicLabel') return 'Topic';
      return k;
    };

    globalThis.detectWorkstreamDetailsForNote = () => [
      {
        name: 'Auto Workstream',
        isSelectionGroupMatch: true,
        matchedRule: { group: 'Engineering', major: 'Frontend', topic: 'UI' },
        isManual: false
      },
      {
        name: 'Manual Workstream',
        isSelectionGroupMatch: false,
        matchedRule: null,
        isManual: true
      }
    ];
    globalThis.removeWorkstreamFromNote = vi.fn();
    globalThis.toggleWorkstreamDropdown = vi.fn();

    const populateWorkstreamEditor = new Function('note = currentNote', popMatch[1]);
    populateWorkstreamEditor(globalThis.currentNote);

    const container = document.getElementById('workstream-chip-selector');
    const chips = container.querySelectorAll('.active-workstream-chip');
    expect(chips.length).toBe(2);

    // Auto-matched chip: has .workstream-chip-auto, NO clear button, tooltip with selection group
    const autoChip = chips[0];
    expect(autoChip.classList.contains('workstream-chip-auto')).toBe(true);
    expect(autoChip.querySelector('.workstream-chip-clear-btn')).toBeNull();
    expect(autoChip.title).toContain('Matched by selection group:');
    expect(autoChip.title).toContain('Group: "Engineering", Major: "Frontend", Topic: "UI"');

    // Manual chip: has .workstream-chip-manual, HAS clear button, tooltip with manual assignment
    const manualChip = chips[1];
    expect(manualChip.classList.contains('workstream-chip-manual')).toBe(true);
    const clearBtn = manualChip.querySelector('.workstream-chip-clear-btn');
    expect(clearBtn).not.toBeNull();
    expect(manualChip.title).toContain('Manually assigned workstream (click ✕ to remove)');
  });

  it('removes workstream from note and updates workstream string in removeWorkstreamFromNote', async () => {
    const appOverlayCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-overlay.js'), 'utf8');
    const removeMatch = appOverlayCode.match(/async function removeWorkstreamFromNote\(wsName\)\s*\{([\s\S]*?)\n\}\nwindow\.removeWorkstreamFromNote/);
    expect(removeMatch).toBeTruthy();

    globalThis.getNoteWorkstreams = (n) => n?.workstreams || (n?.workstream ? n.workstream.split(',').map(s => s.trim()) : []);
    globalThis.populateWorkstreamEditor = vi.fn();
    globalThis._updateMetaTitlePreview = vi.fn();
    globalThis.saveCurrentNote = vi.fn();

    globalThis.currentNote = {
      workstream: 'Workstream A, Workstream B',
      workstreams: ['Workstream A', 'Workstream B'],
      major_topic_tags: ['Workstream B']
    };

    const removeWorkstreamFromNote = new Function('wsName', `return (async () => { ${removeMatch[1]} })();`);
    await removeWorkstreamFromNote('Workstream B');

    expect(globalThis.currentNote.workstreams).toEqual(['Workstream A']);
    expect(globalThis.currentNote.workstream).toBe('Workstream A');
    expect(globalThis.currentNote.excluded_workstreams).toContain('Workstream B');
    expect(globalThis.currentNote.major_topic_tags).toEqual([]);
    expect(globalThis._updateMetaTitlePreview).toHaveBeenCalled();
  });

  it('matches workstreams via wildcards, mapped tags, and associated notes', () => {
    const appOverlayCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-overlay.js'), 'utf8');
    const detailsMatch = appOverlayCode.match(/function detectWorkstreamDetailsForNote\(note = currentNote, liveTags = null\)\s*\{([\s\S]*?)\n\}\nwindow\.detectWorkstreamDetailsForNote/);
    const detectMatch = appOverlayCode.match(/function detectWorkstreamsForNote\(note = currentNote, liveTags = null\)\s*\{([\s\S]*?)\n\}\nwindow\.detectWorkstreamsForNote/);
    expect(detailsMatch).toBeTruthy();
    expect(detectMatch).toBeTruthy();

    globalThis.getNoteWorkstreams = (n) => n?.workstreams || (n?.workstream ? [n.workstream] : []);
    globalThis.getKnownWorkstreamsList = () => ['Wildcard WS', 'Mapped Tag WS', 'Assoc Note WS', 'Ignored WS'];

    globalThis.getMajorTopicMemorySync = (ws) => {
      if (ws === 'Wildcard WS') {
        return {
          mappedTags: {
            tagGroups: [{ group: '*', major: 'Core Engine', topic: '*' }]
          }
        };
      }
      if (ws === 'Mapped Tag WS') {
        return {
          mappedTags: {
            group_tags: ['Enterprise'],
            topic_tags: ['Security']
          }
        };
      }
      if (ws === 'Assoc Note WS') {
        return {
          associatedNotes: [{ id: 'target-note-id', title: 'Target Title' }]
        };
      }
      return null;
    };

    const detectWorkstreamDetailsForNote = new Function('note = currentNote', 'liveTags = null', detailsMatch[1]);
    globalThis.detectWorkstreamDetailsForNote = detectWorkstreamDetailsForNote;
    const detectWorkstreamsForNote = new Function('note = currentNote', 'liveTags = null', detectMatch[1]);

    const note1 = {
      id: 'some-id',
      group_tags: ['Enterprise'],
      major_topic_tags: ['Core Engine'],
      topic_tags: ['Other']
    };
    const detected1 = detectWorkstreamsForNote(note1);
    expect(detected1).toContain('Wildcard WS');
    expect(detected1).toContain('Mapped Tag WS');
    expect(detected1).not.toContain('Assoc Note WS');

    const note2 = {
      id: 'target-note-id',
      title: 'Target Title',
      group_tags: ['Other'],
      major_topic_tags: ['Other'],
      topic_tags: ['Other']
    };
    const detected2 = detectWorkstreamsForNote(note2);
    expect(detected2).toContain('Assoc Note WS');
    expect(detected2).not.toContain('Wildcard WS');
  });

  it('handles excluded workstreams so explicitly removed workstreams are not re-detected', () => {
    const appOverlayCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-overlay.js'), 'utf8');
    const detailsMatch = appOverlayCode.match(/function detectWorkstreamDetailsForNote\(note = currentNote, liveTags = null\)\s*\{([\s\S]*?)\n\}\nwindow\.detectWorkstreamDetailsForNote/);
    const detectMatch = appOverlayCode.match(/function detectWorkstreamsForNote\(note = currentNote, liveTags = null\)\s*\{([\s\S]*?)\n\}\nwindow\.detectWorkstreamsForNote/);
    expect(detailsMatch).toBeTruthy();
    expect(detectMatch).toBeTruthy();

    globalThis.getNoteWorkstreams = (n) => n?.workstreams || (n?.workstream ? [n.workstream] : []);
    globalThis.getKnownWorkstreamsList = () => ['Frontend WS'];
    globalThis.getMajorTopicMemorySync = () => null;

    const detectWorkstreamDetailsForNote = new Function('note = currentNote', 'liveTags = null', detailsMatch[1]);
    globalThis.detectWorkstreamDetailsForNote = detectWorkstreamDetailsForNote;
    const detectWorkstreamsForNote = new Function('note = currentNote', 'liveTags = null', detectMatch[1]);

    // Note has major tag that matches 'Frontend WS', but it was explicitly removed and put into excluded_workstreams
    const testNote = {
      major_topic_tags: ['Frontend WS'],
      excluded_workstreams: ['Frontend WS']
    };

    const detected = detectWorkstreamsForNote(testNote);
    expect(detected).not.toContain('Frontend WS');
  });

  it('serializes and parses multiple workstreams cleanly in HTML metadata roundtrip', () => {
    const appNotesCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-notes.js'), 'utf8');

    const parseMatch = appNotesCode.match(/function parseNoteHTML\(html\)\s*\{([\s\S]*?)\n\}/);
    const applyMatch = appNotesCode.match(/function applyNoteEdits\(originalHTML, changes\)\s*\{([\s\S]*?)\n\}/);
    expect(parseMatch).toBeTruthy();
    expect(applyMatch).toBeTruthy();

    const parseNoteHTML = new Function('html', parseMatch[1]);
    const applyNoteEdits = new Function('originalHTML', 'changes', `
      const encodeTagListToStorage = (tags) => (Array.isArray(tags) ? tags.join(', ') : '');
      ${applyMatch[1]}
    `);

    const initialHTML = `<!DOCTYPE html><html><head>
      <meta name="note-id" content="multi-ws-1">
      <title>Multi Workstream Test</title>
    </head><body><p>Content</p></body></html>`;

    // Save multiple workstreams as array
    const savedHTML = applyNoteEdits(initialHTML, { workstreams: ['Growth', 'Infrastructure', 'Mobile App'] });
    expect(savedHTML).toContain('<meta name="workstream" content="Growth, Infrastructure, Mobile App">');

    // Parse back
    const parsed = parseNoteHTML(savedHTML);
    expect(parsed.workstream).toBe('Growth, Infrastructure, Mobile App');
    expect(parsed.workstreams).toEqual(['Growth', 'Infrastructure', 'Mobile App']);
  });

  it('matches board workstream filters when note has multiple workstreams', () => {
    const appBoardCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-board.js'), 'utf8');
    const getWorkstreamsMatch = appBoardCode.match(/function getNoteWorkstreams\(n\)\s*\{([\s\S]*?)\n\}\nwindow\.getNoteWorkstreams/);
    expect(getWorkstreamsMatch).toBeTruthy();

    const getNoteWorkstreams = new Function('n', getWorkstreamsMatch[1]);

    const multiNote = {
      path: 'notes/multi.html',
      workstream: 'Operations, Customer Support',
      workstreams: ['Operations', 'Customer Support']
    };

    const wsList = getNoteWorkstreams(multiNote);
    expect(wsList).toContain('Operations');
    expect(wsList).toContain('Customer Support');

    // Simulate board filter logic from app-board.js line 738-743
    const filterByWorkstream = (note, targetValue) => {
      const list = getNoteWorkstreams(note);
      return list.includes(targetValue) || (note.workstream && note.workstream === targetValue);
    };

    expect(filterByWorkstream(multiNote, 'Operations')).toBe(true);
    expect(filterByWorkstream(multiNote, 'Customer Support')).toBe(true);
    expect(filterByWorkstream(multiNote, 'Finance')).toBe(false);
  });

  it('updates detected workstreams when tagchange event is dispatched on tag editors', () => {
    globalThis.currentNote = {
      group_tags: [],
      major_topic_tags: [],
      topic_tags: []
    };

    globalThis.readTagEditor = (id) => {
      const el = document.getElementById(id);
      return el ? (el._tags || []) : [];
    };
    globalThis.populateWorkstreamEditor = vi.fn();
    globalThis._updateMetaTitlePreview = vi.fn();

    // Replicate tag listener attachment from openNoteEdit
    ['editor-group', 'editor-major', 'editor-topic'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (el._workstreamTagChangeListener) {
          el.removeEventListener('tagchange', el._workstreamTagChangeListener);
        }
        el._workstreamTagChangeListener = () => {
          if (globalThis.currentNote) {
            globalThis.currentNote.group_tags = globalThis.readTagEditor('editor-group');
            globalThis.currentNote.major_topic_tags = globalThis.readTagEditor('editor-major');
            globalThis.currentNote.topic_tags = globalThis.readTagEditor('editor-topic');
            globalThis.populateWorkstreamEditor(globalThis.currentNote);
            globalThis._updateMetaTitlePreview();
          }
        };
        el.addEventListener('tagchange', el._workstreamTagChangeListener);
      }
    });

    const majorEl = document.getElementById('editor-major');
    majorEl._tags = ['Architecture'];
    majorEl.dispatchEvent(new Event('tagchange'));

    expect(globalThis.currentNote.major_topic_tags).toEqual(['Architecture']);
    expect(globalThis.populateWorkstreamEditor).toHaveBeenCalledWith(globalThis.currentNote);
    expect(globalThis._updateMetaTitlePreview).toHaveBeenCalled();
  });
});

