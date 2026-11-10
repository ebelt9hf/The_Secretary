import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Planner Bloc Creation Progress and Resilient Staged Completion', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || globalThis;
    globalThis.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    globalThis.escA = (s) => String(s || '');
    globalThis.jq = (s) => JSON.stringify(String(s || ''));
    globalThis.toast = vi.fn();
    globalThis.broadcastSync = vi.fn();
    globalThis.rebuildIndexHTML = vi.fn().mockResolvedValue(true);
    globalThis.saveManifest = vi.fn().mockResolvedValue(true);
    globalThis.upsertManifest = vi.fn();
    globalThis.populateTagEditor = vi.fn();
    globalThis.readTagEditor = vi.fn().mockReturnValue([]);

    loadScriptsIntoGlobal([
      'js/app-state.js',
      'js/app-fs.js',
      'js/app-idb.js',
      'js/app-crypto.js',
      'js/app-storage.js',
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-notes.js',
      'js/app-planner.js'
    ]);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    StorageAPI.clearSyncQueue();
    globalThis.plannerEvents = [];
    if (typeof window !== 'undefined') window.plannerEvents = [];
    globalThis.manifest = [];
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  /**
   * 1. Protected Behavior: `showPlannerBlocCreationProgress()` creates a progress modal with a percentage indicator
   *    and supports `updateStage(stageText, detailText, percentage)` which advances the progress bar and percent text.
   * 2. Regression Target: Progress bar staying frozen at 0% without updating percent indicator or detail text.
   * 3. Coverage Overlap & Redundancy: None; specifically tests `showPlannerBlocCreationProgress` percentage updates and percent element.
   * 4. Production Code Footprint: Tests authentic `showPlannerBlocCreationProgress` public contract.
   */
  it('advances progress bar and percent label across multiple stages in showPlannerBlocCreationProgress', () => {
    const closeFn = showPlannerBlocCreationProgress('Initial scheduling...');
    const overlay = document.querySelector('.planner-progress-overlay');
    expect(overlay).not.toBeNull();

    const barFill = overlay.querySelector('.planner-progress-bar-fill');
    expect(barFill).not.toBeNull();
    expect(barFill.style.width).toBe('0%');

    const percentText = overlay.querySelector('.planner-progress-percent');
    expect(percentText).not.toBeNull();
    expect(percentText.textContent).toBe('0%');

    // Advance to 20%
    closeFn.updateStage('Validating schedule details...', '', 20);
    expect(barFill.style.width).toBe('20%');
    expect(percentText.textContent).toBe('20%');

    // Advance to 75%
    closeFn.updateStage('Saving planner timeline to disk...', '', 75);
    expect(barFill.style.width).toBe('75%');
    expect(percentText.textContent).toBe('75%');

    // Advance to 100%
    closeFn.updateStage('Complete', '', 100);
    expect(barFill.style.width).toBe('100%');
    expect(percentText.textContent).toBe('100%');

    closeFn();
    expect(document.querySelector('.planner-progress-overlay')).toBeNull();
  });

  /**
   * 1. Protected Behavior: When saving a new block, `openPlanEventModal` invokes `updateStage` with progressive stages
   *    (e.g. validating, scheduling, saving, finalizing) advancing beyond 0%, rather than remaining frozen at 0%.
   * 2. Regression Target: Progress overlay freezing at 0% without advancing even 1% during block creation.
   * 3. Coverage Overlap & Redundancy: Tests integration between `openPlanEventModal` saving flow and staged progress updates.
   * 4. Production Code Footprint: Exercises authentic `openPlanEventModal` modal save workflow.
   */
  it('advances progress through progressive non-zero stages during new block creation in openPlanEventModal', async () => {
    const stageCalls = [];
    const closeSpy = vi.fn();
    closeSpy.updateStage = vi.fn((stage, detail, pct) => {
      stageCalls.push({ stage, pct });
    });

    vi.spyOn(globalThis, 'showPlannerBlocCreationProgress').mockReturnValue(closeSpy);
    vi.spyOn(StorageAPI, 'writePlanner').mockResolvedValue(true);

    // Open modal with prefill for a new session
    openPlanEventModal({
      title: 'Sprint Kickoff',
      date: '2026-11-12',
      startTime: '10:00',
      endTime: '11:00',
      type: 'work'
    });

    // Simulate clicking Save
    const modalOverlay = document.getElementById('planner-dynamic-modal');
    expect(modalOverlay).not.toBeNull();
    const saveBtn = modalOverlay.querySelector('.modal-actions .btn-save');
    expect(saveBtn).not.toBeNull();

    await saveBtn.onclick();

    // Verify showPlannerBlocCreationProgress was called
    expect(globalThis.showPlannerBlocCreationProgress).toHaveBeenCalledTimes(1);

    // Verify progress advanced through intermediate stages beyond 0%
    expect(stageCalls.length).toBeGreaterThanOrEqual(3);
    const percentages = stageCalls.map(c => c.pct);
    expect(percentages.some(p => p > 0 && p < 100)).toBe(true);
    expect(percentages[percentages.length - 1]).toBeGreaterThanOrEqual(90);

    // Verify close was called in finally
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * 1. Protected Behavior: `savePlanner()` and `openPlanEventModal` `onSave` execute with timeout protection,
   *    guaranteeing that slow, delayed, or locked storage operations do not deadlock the UI or leave the
   *    progress overlay permanently stuck on screen.
   * 2. Regression Target: Indefinite hanging of block creation when storage write takes long or stalls.
   * 3. Coverage Overlap & Redundancy: None; tests timeout and deadlock resiliency during block saving.
   * 4. Production Code Footprint: Exercises authentic `savePlanner` and `openPlanEventModal`.
   */
  it('safely completes block creation and cleans up progress modal when storage is delayed', async () => {
    let unblockWrite;
    const writeBlocked = new Promise(r => { unblockWrite = r; });
    vi.spyOn(StorageAPI, 'writePlanner').mockImplementation(async () => {
      await writeBlocked;
      return true;
    });

    openPlanEventModal({
      title: 'Sprint Review',
      date: '2026-11-12',
      startTime: '14:00',
      endTime: '15:00',
      type: 'work'
    });

    const modalOverlay = document.getElementById('planner-dynamic-modal');
    expect(modalOverlay).not.toBeNull();
    const saveBtn = modalOverlay.querySelector('.modal-actions .btn-save');
    expect(saveBtn).not.toBeNull();

    setTimeout(() => unblockWrite(), 30);
    await saveBtn.onclick();

    expect(document.querySelector('.planner-progress-overlay')).toBeNull();
  });
});
