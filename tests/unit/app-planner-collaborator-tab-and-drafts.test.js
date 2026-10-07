import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Planner Collaborator Tab Autofill, Ghost Completion, and Draft Lifecycle', () => {
  let overlayScope;
  let plannerScope;

  beforeEach(() => {
    global.document = document;
    global.window = window;
    document.body.innerHTML = '';
    vi.restoreAllMocks();

    const overlayCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-overlay.js'), 'utf8');
    const collabCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-collab.js'), 'utf8');
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');

    const setupCode = `
      var colleaguesDb = {
        me: { id: 'me', label: 'Me' },
        teams: [],
        colleagues: [
          { id: 'col-alice', label: 'Alice Dupont' },
          { id: 'col-alan', label: 'Alan Walker' },
          { id: 'col-bob', label: 'Bob Martin' },
          { id: 'col-charlie', label: 'Charlie Brown' }
        ]
      };
      var rootHandle = null;
      window.rootHandle = null;
      window.saveColleaguesDb = vi.fn().mockResolvedValue(true);
      window.colleaguesDb = colleaguesDb;
      window.plannerEvents = [];
      window.plannerProposals = [];
      window.todosManifest = [];
      window.manifest = [];
      window.selectedPlannerEventId = null;
      window.plannerViewMode = 'week';
      window.currentPlannerWeekStart = new Date(2026, 8, 14);
      window.currentLang = 'en';
      window.showPlannerProposals = true;
      window.workStartTime = '09:00';
      window.workEndTime = '18:00';
      window.timeRangeStartMinutes = 540;
      window.timeRangeEndMinutes = 1140;
      window.defaultPlannerDuration = 30;
      window.getAppLocale = function() { return 'en-US'; };
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
      window.toast = vi.fn();
      window.savePlanner = vi.fn().mockResolvedValue(true);
      window.renderPlanner = vi.fn();
      window.removePlannerCreatePreview = vi.fn();
      window.clearDialogFormState = vi.fn();
      window.broadcastSync = vi.fn();
      window.StorageAPI = {
        hasPlannerProposals: vi.fn().mockResolvedValue(true),
        readPlannerProposals: vi.fn().mockResolvedValue({ proposals: [] }),
        writePlannerProposals: vi.fn().mockResolvedValue(true)
      };

      window.getTodoClassForTag = function(t) { return ''; };
      window.cleanTaskTitleText = function(t) { return t; };
      window.isUserCollaborator = function(name) { return name === 'Me' || name === 'me'; };
      window.t = function(key, params) {
        const dict = {
          'common.tabKey': 'Tab',
          'planner.addNewNamePlaceholder': 'Add new name...',
          'planner.peopleInputTitle': 'Type name, press Tab to autofill, Enter to add',
          'common.tabToAutofill': 'Press Tab to autofill ' + (params?.name || ''),
          'common.typeOrClickSuggestion': 'Type or click a suggestion',
          'team.collaboratorsLabel': 'Collaborators',
          'planner.draftBadge': 'Draft',
          'planner.savedAsDraft': 'Saved as draft in planner',
          'planner.draftDiscarded': 'Draft discarded',
          'planner.draftBannerTitle': 'Draft Block',
          'planner.draftBannerDesc': 'Unsaved block draft. Click Save to confirm or Cancel to delete.',
          'planner.editDraftTooltip': 'Edit block draft',
          'planner.discardDraftTooltip': 'Discard block draft',
          'planner.proposedByAgent': 'Agent',
          'planner.acceptProposalTooltip': 'Review & Accept',
          'planner.quickAcceptProposalTooltip': 'Quick Accept',
          'planner.dismissProposalTooltip': 'Dismiss',
          'editor.cancel': 'Cancel',
          'todo.save': 'Save',
          'planner.sync': 'Sync Up',
          'planner.call': 'Call',
          'planner.blockLabel': 'Event'
        };
        return dict[key] || key;
      };

      ${collabCode}
      if (typeof initColleagues === 'function') initColleagues(colleaguesDb);
      if (typeof reindexColleaguesDb === 'function') reindexColleaguesDb();
      ${overlayCode}
      ${plannerCode}

      return {
        populateCollaboratorMultiPicker,
        readCollaboratorMultiPicker,
        populateCollaboratorPicker,
        readCollaboratorPicker,
        openPlannerModal,
        openPlanEventModal,
        openPlanEventModalFromProposal,
        dismissPlannerProposal,
        renderPlannerEventsForDayHTML,
        togglePlannerProposalsView,
        getPlannerProposals,
        setPlannerProposals,
        persistPlannerProposals,
        normalizePlannerCollaboratorIds,
        colleaguesDb
      };
    `;

    const fn = new Function(setupCode);
    overlayScope = fn();
    plannerScope = overlayScope;
  });

  describe('populateCollaboratorMultiPicker Tab Autofill & Visual Hints', () => {
    it('creates an input wrapped with a ghost text completion layer', () => {
      const container = document.createElement('div');
      container.id = 'test-collab-list';
      document.body.appendChild(container);

      overlayScope.populateCollaboratorMultiPicker('test-collab-list', []);
      const wrap = container.querySelector('.tag-input-wrap');
      expect(wrap).toBeTruthy();

      const ghostText = wrap.querySelector('.tag-ghost-text');
      expect(ghostText).toBeTruthy();
      expect(ghostText.querySelector('.tag-ghost-prefix')).toBeTruthy();
      expect(ghostText.querySelector('.tag-ghost-suffix')).toBeTruthy();
      expect(ghostText.querySelector('.tag-ghost-tab-badge')).toBeTruthy();

      const input = wrap.querySelector('input.tag-add');
      expect(input).toBeTruthy();
      expect(input.title).toBe('Type name, press Tab to autofill, Enter to add');
    });

    it('updates ghost text suffix and badge when typing a matching prefix', () => {
      const container = document.createElement('div');
      container.id = 'test-collab-list';
      document.body.appendChild(container);

      overlayScope.populateCollaboratorMultiPicker('test-collab-list', []);
      const input = container.querySelector('input.tag-add');
      const ghostSuffix = container.querySelector('.tag-ghost-suffix');
      const ghostBadge = container.querySelector('.tag-ghost-tab-badge');

      input.value = 'Ali';
      input.dispatchEvent(new Event('input'));

      expect(ghostSuffix.textContent).toBe('ce Dupont');
      expect(ghostBadge.style.display).toBe('inline-flex');
    });

    it('marks the Tab candidate chip in the suggestions dropdown with a Tab badge', () => {
      const container = document.createElement('div');
      container.id = 'test-collab-list';
      document.body.appendChild(container);

      overlayScope.populateCollaboratorMultiPicker('test-collab-list', []);
      const input = container.querySelector('input.tag-add');

      input.value = 'Ali';
      input.dispatchEvent(new Event('input'));

      const dropdown = document.querySelector('.tag-suggest-dropdown');
      expect(dropdown).toBeTruthy();

      const candidateChip = dropdown.querySelector('.tag-suggest-chip.tab-candidate');
      expect(candidateChip).toBeTruthy();
      expect(candidateChip.textContent).toContain('Alice Dupont');
      expect(candidateChip.querySelector('.tag-tab-hint')).toBeTruthy();
      expect(candidateChip.querySelector('.tag-tab-hint').textContent).toContain('Tab');
    });

    it('pressing Tab autocompletes and adds the best matching colleague as a pill', () => {
      const container = document.createElement('div');
      container.id = 'test-collab-list';
      document.body.appendChild(container);

      overlayScope.populateCollaboratorMultiPicker('test-collab-list', []);
      const input = container.querySelector('input.tag-add');

      input.value = 'Ali';
      input.dispatchEvent(new Event('input'));

      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      const defaultPrevented = !input.dispatchEvent(tabEvent);

      expect(defaultPrevented).toBe(true);
      expect(input.value).toBe('');

      const pills = container.querySelectorAll('.tag-pill');
      expect(pills.length).toBe(1);
      expect(pills[0].dataset.colleagueId).toBe('col-alice');
      expect(pills[0].dataset.tag).toBe('Alice Dupont');
    });

    it('pressing Enter selects the best matching colleague rather than creating a new colleague tag', () => {
      const container = document.createElement('div');
      container.id = 'test-collab-list';
      document.body.appendChild(container);

      overlayScope.populateCollaboratorMultiPicker('test-collab-list', []);
      const input = container.querySelector('input.tag-add');

      input.value = 'Ali';
      input.dispatchEvent(new Event('input'));

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      const pills = container.querySelectorAll('.tag-pill');
      expect(pills.length).toBe(1);
      expect(pills[0].dataset.colleagueId).toBe('col-alice');
      expect(pills[0].dataset.tag).toBe('Alice Dupont');
      expect(input.value).toBe('');
      expect(overlayScope.colleaguesDb.colleagues.some(c => c.label === 'Ali')).toBe(false);
    });

    it('navigating with ArrowDown and ArrowUp allows selecting another colleague from the keyboard before autocompleting with Tab', () => {
      const container = document.createElement('div');
      container.id = 'test-collab-list';
      document.body.appendChild(container);

      overlayScope.populateCollaboratorMultiPicker('test-collab-list', []);
      const input = container.querySelector('input.tag-add');

      // 'a' matches Alan Walker, Alice Dupont, Bob Martin, Charlie Brown
      input.value = 'a';
      input.dispatchEvent(new Event('input'));

      const dropdown = document.querySelector('.tag-suggest-dropdown');
      expect(dropdown).toBeTruthy();

      // Top candidate is Alan Walker (starts with 'a', alphabetical)
      let activeChip = dropdown.querySelector('.tag-suggest-chip.active');
      expect(activeChip.textContent).toContain('Alan Walker');

      // Navigate down to select Alice Dupont
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));

      activeChip = dropdown.querySelector('.tag-suggest-chip.active');
      expect(activeChip).toBeTruthy();
      expect(activeChip.textContent).toContain('Alice Dupont');

      // Navigate down again to select Bob Martin
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      activeChip = dropdown.querySelector('.tag-suggest-chip.active');
      expect(activeChip.textContent).toContain('Bob Martin');

      // Navigate back up to Alice Dupont
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
      activeChip = dropdown.querySelector('.tag-suggest-chip.active');
      expect(activeChip.textContent).toContain('Alice Dupont');

      // Press Tab to autocomplete the arrow-selected colleague (Alice Dupont)
      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      const defaultPrevented = !input.dispatchEvent(tabEvent);

      expect(defaultPrevented).toBe(true);

      const pills = container.querySelectorAll('.tag-pill');
      expect(pills.length).toBe(1);
      expect(pills[0].dataset.tag).toBe('Alice Dupont');
      expect(pills[0].dataset.colleagueId).toBe('col-alice');
    });

    it('allows sequential autocompletion of multiple colleagues with Tab', () => {
      const container = document.createElement('div');
      container.id = 'test-collab-list';
      document.body.appendChild(container);

      overlayScope.populateCollaboratorMultiPicker('test-collab-list', []);
      const input = container.querySelector('input.tag-add');

      // Add first colleague with Tab
      input.value = 'Ali';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

      // Add second colleague with Tab
      input.value = 'Bob';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

      const pills = container.querySelectorAll('.tag-pill');
      expect(pills.length).toBe(2);
      expect(pills[0].dataset.tag).toBe('Alice Dupont');
      expect(pills[1].dataset.tag).toBe('Bob Martin');
      expect(input.value).toBe('');

      // Pressing Tab when input is empty allows normal focus navigation
      const emptyTabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      const defaultPrevented = !input.dispatchEvent(emptyTabEvent);
      expect(defaultPrevented).toBe(false);
    });

    it('autocompletes substring matches of existing colleagues instead of creating a new colleague', () => {
      const container = document.createElement('div');
      container.id = 'test-collab-list';
      document.body.appendChild(container);

      overlayScope.populateCollaboratorMultiPicker('test-collab-list', []);
      const input = container.querySelector('input.tag-add');

      // 'Brown' matches 'Charlie Brown'
      input.value = 'Brown';
      input.dispatchEvent(new Event('input'));

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

      const pills = container.querySelectorAll('.tag-pill');
      expect(pills.length).toBe(1);
      expect(pills[0].dataset.tag).toBe('Charlie Brown');
      expect(pills[0].dataset.colleagueId).toBe('col-charlie');
      expect(overlayScope.colleaguesDb.colleagues.some(c => c.label === 'Brown')).toBe(false);
    });

    it('supports Arrow navigation and Tab autocomplete in populateCollaboratorPicker (single picker)', () => {
      const container = document.createElement('div');
      container.id = 'test-single-picker';
      document.body.appendChild(container);

      overlayScope.populateCollaboratorPicker('test-single-picker', '', { allowEmpty: true, createOnType: true });
      const input = container.querySelector('input.tag-add');

      input.value = 'a';
      input.dispatchEvent(new Event('input'));

      const dropdown = document.querySelector('.tag-suggest-dropdown');
      expect(dropdown).toBeTruthy();

      // Navigate with ArrowDown
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));

      // Press Tab to autocomplete
      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      const defaultPrevented = !input.dispatchEvent(tabEvent);
      expect(defaultPrevented).toBe(true);

      const val = overlayScope.readCollaboratorPicker('test-single-picker');
      expect(val).toBe('col-alice');
    });
  });

  describe('Colleague Creation Lifecycle and Deferred DB Mutation', () => {
    it('does not mutate colleaguesDb when a new colleague name is entered in the picker UI', () => {
      const container = document.createElement('div');
      container.id = 'test-collab-list';
      document.body.appendChild(container);

      const initialCount = overlayScope.colleaguesDb.colleagues.length;
      overlayScope.populateCollaboratorMultiPicker('test-collab-list', []);
      const input = container.querySelector('input.tag-add');

      input.value = 'Brand New Person';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      // Pill exists in DOM
      const pills = container.querySelectorAll('.tag-pill');
      expect(pills.length).toBe(1);
      expect(pills[0].dataset.tag).toBe('Brand New Person');

      // Database is NOT mutated yet
      expect(overlayScope.colleaguesDb.colleagues.length).toBe(initialCount);
    });

    it('creates new colleagues in colleaguesDb only when normalizePlannerCollaboratorIds is called with allowCreate: true on save', () => {
      const container = document.createElement('div');
      container.id = 'test-collab-list';
      document.body.appendChild(container);

      overlayScope.populateCollaboratorMultiPicker('test-collab-list', []);
      const input = container.querySelector('input.tag-add');

      input.value = 'Dr. Gregory House';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      const selectedIds = overlayScope.readCollaboratorMultiPicker('test-collab-list');
      expect(selectedIds).toEqual(['Dr. Gregory House']);

      // Normalize with allowCreate: true (as done on planner event save)
      const normalized = overlayScope.normalizePlannerCollaboratorIds(selectedIds, { allowCreate: true });
      expect(normalized.length).toBe(1);

      const created = overlayScope.colleaguesDb.colleagues.find(c => c.label === 'Dr. Gregory House');
      expect(created).toBeTruthy();
      expect(created.id).toBe(normalized[0]);
    });
  });

  describe('Draft Block on Outside Click (Backdrop) & Cancel Discard', () => {
    it('saves a new event as draft in plannerProposals when clicking outside the modal', async () => {
      plannerScope.openPlanEventModal({
        date: '2026-09-16',
        startTime: '14:00',
        endTime: '15:00',
        type: 'sync',
        title: 'Weekly Strategy Sync'
      }, false);

      const modalOverlay = document.getElementById('planner-dynamic-modal');
      expect(modalOverlay).toBeTruthy();

      // Click outside (on the backdrop overlay)
      modalOverlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await new Promise(r => setTimeout(r, 50));

      const proposals = plannerScope.getPlannerProposals();
      expect(proposals.length).toBe(1);
      const draft = proposals[0];
      expect(draft.isDraft).toBe(true);
      expect(draft.source).toBe('Draft');
      expect(draft.title).toBe('Weekly Strategy Sync');
      expect(draft.type).toBe('sync');
      expect(draft.date).toBe('2026-09-16');
      expect(draft.startTime).toBe('14:00');
      expect(draft.endTime).toBe('15:00');

      // Modal is closed
      expect(document.getElementById('planner-dynamic-modal')).toBeNull();
    });

    it('saves a new event as draft in plannerProposals when pressing Escape key', async () => {
      plannerScope.openPlanEventModal({
        date: '2026-09-17',
        startTime: '16:00',
        endTime: '17:00',
        type: 'work',
        title: 'Deep Architecture Design'
      }, false);

      const modalOverlay = document.getElementById('planner-dynamic-modal');
      expect(modalOverlay).toBeTruthy();

      // Press Escape key
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      await new Promise(r => setTimeout(r, 50));

      const proposals = plannerScope.getPlannerProposals();
      const draft = proposals.find(p => p.title === 'Deep Architecture Design');
      expect(draft).toBeTruthy();
      expect(draft.isDraft).toBe(true);
      expect(draft.source).toBe('Draft');
      expect(draft.type).toBe('work');
      expect(draft.date).toBe('2026-09-17');
      expect(draft.startTime).toBe('16:00');
      expect(draft.endTime).toBe('17:00');

      // Modal is closed
      expect(document.getElementById('planner-dynamic-modal')).toBeNull();
    });

    it('renders draft cards without quick accept/decline hover buttons and with Draft badge', () => {
      const draftEvent = {
        id: 'draft-12345',
        title: 'Draft Client Interview',
        date: '2026-09-16',
        startTime: '10:00',
        endTime: '11:00',
        type: 'call',
        source: 'Draft',
        isDraft: true,
        status: 'pending'
      };

      plannerScope.togglePlannerProposalsView();
      plannerScope.setPlannerProposals([draftEvent]);
      const html = plannerScope.renderPlannerEventsForDayHTML('2026-09-16');

      expect(html).toContain('event-draft');
      expect(html).toContain('planner-draft-badge');
      expect(html).toContain('Draft');
      expect(html).toContain('Edit block draft');
      expect(html).toContain('Discard block draft');

      // Must NOT contain quick accept checkmark or dismiss X from agent proposals
      expect(html).not.toContain('quickAcceptProposalTooltip');
      expect(html).not.toContain('quickAcceptPlannerProposal');
    });

    it('clicking Cancel on a draft modal deletes the draft from proposals', async () => {
      const draft = {
        id: 'draft-999',
        title: 'Abandoned Draft',
        date: '2026-09-16',
        startTime: '09:00',
        endTime: '09:30',
        type: 'work',
        source: 'Draft',
        isDraft: true,
        status: 'pending'
      };
      plannerScope.setPlannerProposals([draft]);

      plannerScope.openPlanEventModalFromProposal('draft-999');

      const modalOverlay = document.getElementById('planner-dynamic-modal');
      expect(modalOverlay).toBeTruthy();
      expect(modalOverlay.innerHTML).toContain('Draft Block');

      const cancelBtn = modalOverlay.querySelector('.modal-actions .btn');
      expect(cancelBtn).toBeTruthy();
      expect(cancelBtn.textContent).toBe('Cancel');

      // Click Cancel
      cancelBtn.click();

      await new Promise(r => setTimeout(r, 50));

      const proposalsAfter = plannerScope.getPlannerProposals();
      expect(proposalsAfter.some(p => p.id === 'draft-999')).toBe(false);
      expect(document.getElementById('planner-dynamic-modal')).toBeNull();
    });
  });
});
