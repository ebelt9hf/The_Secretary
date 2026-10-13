import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Interactive Tutorial Controller (app-tutorial.js)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tab-planner"></div>
      <div id="tab-todos-mode"></div>
      <div id="tab-retro"></div>
      <div id="tab-notes"></div>
      <div id="tab-decisions"></div>
      <div id="tab-team"></div>
      <div id="planner-grid-body"></div>
      <div id="note-edit-overlay" style="display:none;"></div>
      <textarea id="edit-textarea"></textarea>
      <button id="btn-insert-items"></button>
      <div class="topbar-title-wrap"></div>
    `;

    globalThis.switchTab = vi.fn().mockResolvedValue(true);
    globalThis.switchPrefsTab = vi.fn();
    globalThis.manifest = [];
    globalThis.plannerEvents = [];
    globalThis.saveManifest = vi.fn().mockResolvedValue(true);
    globalThis.savePlanner = vi.fn().mockResolvedValue(true);
    globalThis.renderPlanner = vi.fn();
    globalThis.openNoteOverlay = vi.fn().mockResolvedValue(true);
    globalThis.closeNoteOverlay = vi.fn();
    globalThis.formatLocalDateValue = vi.fn(() => '2026-10-13');
    globalThis.StorageAPI = {
      writeNoteContent: vi.fn().mockResolvedValue(true)
    };

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-tutorial.js'
    ]);
  });

  it('initializes 12 steps covering tabs, 15-minute block creation, and note tasks', () => {
    expect(TutorialController.steps.length).toBe(12);

    // Stage 1: Tabs
    expect(TutorialController.steps[0].id).toBe('welcome');
    expect(TutorialController.steps[1].id).toBe('planner-tab');
    expect(TutorialController.steps[1].tab).toBe('planner');
    expect(TutorialController.steps[2].id).toBe('todos-tab');
    expect(TutorialController.steps[2].tab).toBe('todos');
    expect(TutorialController.steps[3].id).toBe('retro-tab');
    expect(TutorialController.steps[3].tab).toBe('retro');
    expect(TutorialController.steps[4].id).toBe('notes-tab');
    expect(TutorialController.steps[4].tab).toBe('notes');
    expect(TutorialController.steps[5].id).toBe('decisions-tab');
    expect(TutorialController.steps[5].tab).toBe('decisions');
    expect(TutorialController.steps[6].id).toBe('team-tab');
    expect(TutorialController.steps[6].tab).toBe('team');

    // Stage 2: 15-minute block & note tasks
    expect(TutorialController.steps[7].id).toBe('create-block');
    expect(TutorialController.steps[8].id).toBe('open-block');
    expect(TutorialController.steps[9].id).toBe('note-todos');
    expect(TutorialController.steps[10].id).toBe('note-decisions');
    expect(TutorialController.steps[11].id).toBe('finish');
  });

  it('navigates through all tab steps and invokes switchTab correctly', async () => {
    TutorialController.start();
    expect(TutorialController.isActive).toBe(true);
    expect(TutorialController.currentStep).toBe(0);

    // Planner tab
    await TutorialController.goToStep(1);
    expect(TutorialController.currentStep).toBe(1);
    expect(globalThis.switchTab).toHaveBeenCalledWith('planner');

    // Todos tab
    await TutorialController.goToStep(2);
    expect(TutorialController.currentStep).toBe(2);
    expect(globalThis.switchTab).toHaveBeenCalledWith('todos');

    // Retro tab
    await TutorialController.goToStep(3);
    expect(TutorialController.currentStep).toBe(3);
    expect(globalThis.switchTab).toHaveBeenCalledWith('retro');

    // Notes tab
    await TutorialController.goToStep(4);
    expect(TutorialController.currentStep).toBe(4);
    expect(globalThis.switchTab).toHaveBeenCalledWith('notes');

    // Decisions / Workstreams tab
    await TutorialController.goToStep(5);
    expect(TutorialController.currentStep).toBe(5);
    expect(globalThis.switchTab).toHaveBeenCalledWith('decisions');

    // Team tab
    await TutorialController.goToStep(6);
    expect(TutorialController.currentStep).toBe(6);
    expect(globalThis.switchTab).toHaveBeenCalledWith('team');

    TutorialController.stop();
    expect(TutorialController.isActive).toBe(false);
  });

  it('ensures 15-minute block and pre-filled note with todo and decision instructions', async () => {
    const res = await TutorialController.ensureIntroBlockAndNote();
    expect(res).toBeDefined();
    expect(res.event).toBeDefined();
    expect(res.event.id).toBe('evt-intro-tutorial');
    expect(res.event.duration).toBe(15);
    expect(res.event.type).toBe('work');
    expect(plannerEvents.some(e => e.id === 'evt-intro-tutorial')).toBe(true);

    // Verify note is created with required tutorial tasks and decisions
    expect(res.note).toBeDefined();
    expect(res.note.id).toBe('note-intro-tutorial');
    expect(res.note.mainHTML).toContain('todo');
    expect(res.note.mainHTML).toContain('I will use the secretary from now on');
    expect(manifest.some(m => m.id === 'note-intro-tutorial')).toBe(true);
    expect(StorageAPI.writeNoteContent).toHaveBeenCalled();
  });

  it('opens note overlay when reaching interactive note steps', async () => {
    TutorialController.start();
    await TutorialController.goToStep(9); // note-todos
    expect(TutorialController.currentStep).toBe(9);
    expect(globalThis.openNoteOverlay).toHaveBeenCalledWith(
      expect.stringContaining('note-intro-tutorial'),
      null,
      null,
      false,
      null,
      expect.objectContaining({ sameWindow: true })
    );

    // Close note overlay on step backwards or skip
    const overlay = document.getElementById('note-edit-overlay');
    overlay.style.display = 'block';
    TutorialController.closeIntroNote();
    expect(globalThis.closeNoteOverlay).toHaveBeenCalledWith(true);

    TutorialController.stop();
  });

  it('supports interactive scheduleIntroBlock and openIntroBlock actions', async () => {
    TutorialController.start();
    await TutorialController.goToStep(7); // create-block
    expect(TutorialController.currentStep).toBe(7);

    // Call scheduleIntroBlock (as user clicking slot or button)
    await TutorialController.scheduleIntroBlock();
    expect(TutorialController.currentStep).toBe(8);
    expect(plannerEvents.some(e => e.id === 'evt-intro-tutorial')).toBe(true);
    expect(plannerEvents.find(e => e.id === 'evt-intro-tutorial').duration).toBe(15);

    // Call openIntroBlock (as user clicking card or button)
    await TutorialController.openIntroBlock();
    expect(TutorialController.currentStep).toBe(9);
    expect(globalThis.openNoteOverlay).toHaveBeenCalledWith(
      expect.stringContaining('note-intro-tutorial'),
      null,
      null,
      false,
      null,
      expect.objectContaining({ sameWindow: true })
    );

    TutorialController.stop();
  });

  it('marks tutorial as completed in localStorage upon finishing the last step', () => {
    TutorialController.start();
    TutorialController.currentStep = TutorialController.steps.length - 1;
    TutorialController.next();

    expect(TutorialController.isActive).toBe(false);
    expect(localStorage.getItem('secretary_tutorial_completed')).toBe('true');
  });
});
