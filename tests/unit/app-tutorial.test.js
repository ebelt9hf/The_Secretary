import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Interactive Tutorial Controller (app-tutorial.js)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tab-planner"></div>
      <div id="tab-notes"></div>
      <div class="topbar-title-wrap"></div>
    `;

    globalThis.switchTab = vi.fn().mockResolvedValue(true);
    globalThis.switchPrefsTab = vi.fn();

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-tutorial.js'
    ]);
  });

  it('initializes steps with localized title/text keys and targets', () => {
    expect(TutorialController.steps.length).toBeGreaterThan(5);
    const firstStep = TutorialController.steps[0];
    expect(firstStep.titleKey).toBe('tutorial.step1Title');
    expect(firstStep.textKey).toBe('tutorial.step1Text');
  });

  it('navigates through steps and switches tabs appropriately', async () => {
    TutorialController.start();
    expect(TutorialController.isActive).toBe(true);
    expect(TutorialController.currentStep).toBe(0);

    await TutorialController.goToStep(1);
    expect(TutorialController.currentStep).toBe(1);
    expect(globalThis.switchTab).toHaveBeenCalledWith('planner');

    TutorialController.next();
    expect(TutorialController.currentStep).toBe(2);

    TutorialController.prev();
    expect(TutorialController.currentStep).toBe(1);

    TutorialController.stop();
    expect(TutorialController.isActive).toBe(false);
  });

  it('marks tutorial as completed in localStorage upon finishing the last step', () => {
    TutorialController.start();
    TutorialController.currentStep = TutorialController.steps.length - 1;
    TutorialController.next();

    expect(TutorialController.isActive).toBe(false);
    expect(localStorage.getItem('secretary_tutorial_completed')).toBe('true');
  });
});
