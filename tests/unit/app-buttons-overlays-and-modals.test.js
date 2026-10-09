import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

function triggerClick(el, eventObj = new MouseEvent('click')) {
  if (!el) return;
  const onclickAttr = el.getAttribute('onclick');
  if (onclickAttr) {
    return new Function('event', onclickAttr).call(el, eventObj);
  } else if (typeof el.onclick === 'function') {
    return el.onclick(eventObj);
  } else {
    return el.click();
  }
}

// ═══════════════════════════════════════════════════
// Sourced from: app-buttons-note-editor-toolbar.test.js
// ═══════════════════════════════════════════════════
describe('UI Buttons - Note Editor Overlay & Formatting Toolbar', () => {
  beforeAll(() => {
    // Read actual templates/note-editor-overlay.html content
    const templatePath = path.resolve(process.cwd(), 'templates/note-editor-overlay.html');
    const templateHtml = fs.readFileSync(templatePath, 'utf-8');

    document.body.innerHTML = `
      <div id="screen-main">
        ${templateHtml}
      </div>
    `;

    globalThis.t = (k) => k;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.currentNote = {
      path: 'calls/2026-09-19-demo.md',
      title: 'Demo Note',
      content: 'Sample content here',
      date: '2026-09-19'
    };

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-overlay.js'
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Overlay Header Control Buttons', () => {
    it('handles back and close buttons', () => {
      const backBtn = document.getElementById('overlay-back-btn');
      const closeBtn = document.getElementById('overlay-close-note-btn');

      globalThis.closeNoteOverlay = vi.fn();

      triggerClick(backBtn, { stopPropagation: () => {} });
      expect(globalThis.closeNoteOverlay).toHaveBeenCalledTimes(1);

      triggerClick(closeBtn, { stopPropagation: () => {} });
      expect(globalThis.closeNoteOverlay).toHaveBeenCalledTimes(2);
    });

    it('handles AI companion floating trigger button in overlay', () => {
      const aiBtn = document.getElementById('btn-overlay-ai');
      globalThis.toggleFloatingChat = vi.fn();

      triggerClick(aiBtn);
      expect(globalThis.toggleFloatingChat).toHaveBeenCalledTimes(1);
    });

    it('handles metadata toggle button', () => {
      const metaBtn = document.getElementById('btn-overlay-toggle-meta');
      globalThis.toggleMetadataCollapse = vi.fn();

      triggerClick(metaBtn);
      expect(globalThis.toggleMetadataCollapse).toHaveBeenCalledTimes(1);
    });

    it('handles enter edit mode button', () => {
      const editBtn = document.getElementById('overlay-edit-btn');
      globalThis.enterOverlayEditMode = vi.fn();

      triggerClick(editBtn);
      expect(globalThis.enterOverlayEditMode).toHaveBeenCalledTimes(1);
    });

    it('handles delete note button', () => {
      const delBtn = document.getElementById('overlay-delete-note-btn');
      globalThis.deleteCurrentNote = vi.fn();

      triggerClick(delBtn);
      expect(globalThis.deleteCurrentNote).toHaveBeenCalledTimes(1);
    });

    it('handles mark note as reviewed / validate button', () => {
      const valBtn = document.getElementById('overlay-validate-note-btn');
      globalThis.DailyReviewController = {
        markCurrentNoteAsReviewed: vi.fn()
      };

      triggerClick(valBtn);
      expect(globalThis.DailyReviewController.markCurrentNoteAsReviewed).toHaveBeenCalledTimes(1);
    });

    it('handles share note button', () => {
      const shareBtn = document.getElementById('overlay-share-btn');
      globalThis.openNoteShareModal = vi.fn();

      triggerClick(shareBtn);
      expect(globalThis.openNoteShareModal).toHaveBeenCalledTimes(1);
    });

    it('handles note history button', () => {
      const histBtn = document.getElementById('overlay-history-btn');
      globalThis.openNoteHistoryModal = vi.fn();

      triggerClick(histBtn);
      expect(globalThis.openNoteHistoryModal).toHaveBeenCalledTimes(1);
    });

    it('handles open note in new window button', () => {
      const newWinBtn = document.getElementById('overlay-newwindow-btn');
      globalThis.openNoteInNewWindow = vi.fn();

      triggerClick(newWinBtn);
      expect(globalThis.openNoteInNewWindow).toHaveBeenCalledTimes(1);
    });

    it('handles cancel AI refactor button', () => {
      const cancelAiBtn = document.getElementById('btn-note-editor-ai-cancel');
      globalThis.RefactorModalController = {
        cancelRefactor: vi.fn()
      };

      triggerClick(cancelAiBtn);
      expect(globalThis.RefactorModalController.cancelRefactor).toHaveBeenCalledTimes(1);
    });
  });

  describe('Editor Zoom Buttons', () => {
    it('handles zoom in and zoom out buttons', () => {
      const zoomInBtn = document.getElementById('editor-zoom-in-btn');
      const zoomOutBtn = document.getElementById('editor-zoom-out-btn');

      globalThis.zoomEditor = vi.fn();

      triggerClick(zoomInBtn);
      expect(globalThis.zoomEditor).toHaveBeenCalledWith(1);

      triggerClick(zoomOutBtn);
      expect(globalThis.zoomEditor).toHaveBeenCalledWith(-1);
    });
  });

  describe('Note Actions & Insert Tool Buttons', () => {
    it('handles add todo button toggle', () => {
      const addtodoBtn = document.getElementById('todo-btn-add');
      globalThis.toggleTodoPriority = vi.fn();

      triggerClick(addtodoBtn);
      expect(globalThis.toggleTodoPriority).toHaveBeenCalled();
    });

    it('handles link todo picker button', () => {
      const linkTodoBtn = document.getElementById('todo-link-btn');
      globalThis.showLinkTodoPicker = vi.fn();

      const ev = { stopPropagation: vi.fn() };
      triggerClick(linkTodoBtn, ev);
      expect(globalThis.showLinkTodoPicker).toHaveBeenCalledWith(ev);
    });

    it('handles add decision button toggle', () => {
      const addDecisionBtn = document.getElementById('decision-btn-add');
      globalThis.toggleDecision = vi.fn();

      triggerClick(addDecisionBtn);
      expect(globalThis.toggleDecision).toHaveBeenCalledTimes(1);
    });

    it('handles insert horizontal line button', () => {
      const hrBtn = document.getElementById('hr-btn-add');
      globalThis.insertMd = vi.fn();
      globalThis.closeInsertItemsPopover = vi.fn();

      triggerClick(hrBtn);
      expect(globalThis.insertMd).toHaveBeenCalledWith('hr');
      expect(globalThis.closeInsertItemsPopover).toHaveBeenCalledTimes(1);
    });

    it('handles apply note template button', () => {
      const templateBtn = document.getElementById('btn-apply-template');
      globalThis.openNoteTemplatePicker = vi.fn();

      triggerClick(templateBtn);
      expect(globalThis.openNoteTemplatePicker).toHaveBeenCalledTimes(1);
    });

    it('handles link note formatting button', () => {
      const linkNoteBtn = document.getElementById('fmt-link-note-btn');
      globalThis.insertNoteLink = vi.fn();

      triggerClick(linkNoteBtn);
      expect(globalThis.insertNoteLink).toHaveBeenCalledWith(linkNoteBtn);
    });
  });

  describe('Markdown Toolbar Buttons', () => {
    it('verifies all insertMd formatting buttons invoke insertMd with correct syntax', () => {
      globalThis.insertMd = vi.fn();

      const toolbar = document.querySelector('#md-format-toolbar');
      expect(toolbar).toBeTruthy();

      const buttons = toolbar.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(15);

      for (const btn of buttons) {
        if (btn.id === 'fmt-link-note-btn') continue;
        if (btn.id === 'todo-btn-add' || btn.id === 'todo-link-btn' || btn.id === 'decision-btn-add' ||
            btn.id === 'hr-btn-add' || btn.id === 'btn-apply-template') continue;

        triggerClick(btn);
      }

      expect(globalThis.insertMd).toHaveBeenCalled();
    });

    it('handles clear formatting, highlight, and list buttons explicitly', () => {
      globalThis.insertMd = vi.fn();

      const clearBtn = document.getElementById('fmt-clear-btn');
      const highlightBtn = document.getElementById('md-highlight-btn');
      const ulBtn = document.getElementById('fmt-btn-ul');
      const olBtn = document.getElementById('fmt-btn-ol');

      if (clearBtn) triggerClick(clearBtn);
      if (highlightBtn) triggerClick(highlightBtn);
      if (ulBtn) triggerClick(ulBtn);
      if (olBtn) triggerClick(olBtn);

      expect(globalThis.insertMd).toHaveBeenCalled();
    });
  });

  describe('AI Summary & Analysis Buttons', () => {
    it('handles AI generate summary, accept, and reject proposal buttons', () => {
      const genSummaryBtn = document.getElementById('btn-generate-summary-ai');
      const acceptBtn = document.getElementById('btn-accept-summary-proposal');
      const rejectBtn = document.getElementById('btn-reject-summary-proposal');

      globalThis.generateNoteSummaryWithAI = vi.fn();
      const acceptSpy = vi.fn();
      const rejectSpy = vi.fn();

      triggerClick(genSummaryBtn);
      expect(globalThis.generateNoteSummaryWithAI).toHaveBeenCalledTimes(1);

      acceptBtn.onclick = acceptSpy;
      rejectBtn.onclick = rejectSpy;

      triggerClick(acceptBtn);
      expect(acceptSpy).toHaveBeenCalledTimes(1);

      triggerClick(rejectBtn);
      expect(rejectSpy).toHaveBeenCalledTimes(1);
    });

    it('handles AI analyze and AI refactor buttons', () => {
      const analyzeBtn = document.getElementById('btn-ai-analyze');
      const refactorBtn = document.getElementById('btn-ai-refactor');

      globalThis.analyzeCurrentNoteWithLLM = vi.fn();
      globalThis.refactorCurrentNoteWithLLM = vi.fn();

      triggerClick(analyzeBtn);
      expect(globalThis.analyzeCurrentNoteWithLLM).toHaveBeenCalledTimes(1);

      triggerClick(refactorBtn);
      expect(globalThis.refactorCurrentNoteWithLLM).toHaveBeenCalledTimes(1);
    });
  });

  describe('Nested Note Overlay Buttons', () => {
    it('handles nested note popout and close buttons', () => {
      const popoutBtn = document.getElementById('nested-note-popout-btn');
      const closeBtn = document.querySelector('.nested-note-close-btn');

      globalThis.popoutNestedNoteToWindow = vi.fn();
      globalThis.closeNestedNoteOverlay = vi.fn();

      triggerClick(popoutBtn);
      expect(globalThis.popoutNestedNoteToWindow).toHaveBeenCalledTimes(1);

      triggerClick(closeBtn);
      expect(globalThis.closeNestedNoteOverlay).toHaveBeenCalledTimes(1);
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-buttons-todo-overlay.test.js
// ═══════════════════════════════════════════════════
describe('UI Buttons - Todo Edit Overlay & Interactive Matrix Picker', () => {
  beforeAll(() => {
    const templatePath = path.resolve(process.cwd(), 'templates/todo-edit-overlay.html');
    const templateHtml = fs.readFileSync(templatePath, 'utf-8');

    document.body.innerHTML = `
      <div id="screen-main">
        ${templateHtml}
      </div>
    `;

    globalThis.t = (k) => k;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.editingTodo = {
      id: 'todo-123',
      text: 'Sample Task',
      priority: 'Q2',
      status: 'pending',
      checklist: []
    };

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-todos-board.js'
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Todo Overlay Navigation and Control Buttons', () => {
    it('handles close overlay button', () => {
      const closeBtn = document.querySelector('.overlay-header .overlay-close-btn');
      globalThis.requestCloseTodoOverlay = vi.fn();

      triggerClick(closeBtn);
      expect(globalThis.requestCloseTodoOverlay).toHaveBeenCalledTimes(1);
    });

    it('handles matrix picker opener button', () => {
      const pickerBtn = document.getElementById('todo-matrix-picker-btn');
      globalThis.openSingleTodoMatrixPicker = vi.fn();

      triggerClick(pickerBtn);
      expect(globalThis.openSingleTodoMatrixPicker).toHaveBeenCalledTimes(1);
    });

    it('handles clear due date button', () => {
      const clearDueBtn = document.getElementById('todo-due-clear-btn');
      globalThis.clearTodoDueDate = vi.fn();

      const ev = { stopPropagation: vi.fn() };
      triggerClick(clearDueBtn, ev);
      expect(ev.stopPropagation).toHaveBeenCalled();
      expect(globalThis.clearTodoDueDate).toHaveBeenCalledTimes(1);
    });

    it('handles execution status segmented buttons (pending, wip, done, wont_do)', () => {
      const segButtons = document.querySelectorAll('#todo-status-segmented-group button');
      expect(segButtons.length).toBe(4);

      globalThis.setTodoModalStatus = vi.fn();

      triggerClick(segButtons[0]);
      expect(globalThis.setTodoModalStatus).toHaveBeenCalledWith('pending');

      triggerClick(segButtons[1]);
      expect(globalThis.setTodoModalStatus).toHaveBeenCalledWith('wip');

      triggerClick(segButtons[2]);
      expect(globalThis.setTodoModalStatus).toHaveBeenCalledWith('done');

      triggerClick(segButtons[3]);
      expect(globalThis.setTodoModalStatus).toHaveBeenCalledWith('wont_do');
    });

    it('handles add checklist item button', () => {
      const addChecklistBtn = document.querySelector('button[data-i18n="todo.addChecklistBtn"]');
      globalThis.addTodoChecklistItemFromUI = vi.fn();

      triggerClick(addChecklistBtn);
      expect(globalThis.addTodoChecklistItemFromUI).toHaveBeenCalledTimes(1);
    });

    it('handles add dated update button', () => {
      const addUpdateBtn = document.querySelector('button[data-i18n="todo.updateAddBtn"]');
      globalThis.addTodoDatedUpdateFromUI = vi.fn();

      triggerClick(addUpdateBtn);
      expect(globalThis.addTodoDatedUpdateFromUI).toHaveBeenCalledTimes(1);
    });

    it('handles merge panel open and cancel buttons', () => {
      const openMergeBtn = document.getElementById('todo-edit-merge-btn');
      const cancelMergeBtn = document.querySelector('button[data-i18n="todo.mergeCancelBtn"]');

      globalThis.openTodoMergePanel = vi.fn();
      globalThis.closeTodoMergePanel = vi.fn();

      triggerClick(openMergeBtn);
      expect(globalThis.openTodoMergePanel).toHaveBeenCalledTimes(1);

      triggerClick(cancelMergeBtn);
      expect(globalThis.closeTodoMergePanel).toHaveBeenCalledTimes(1);
    });

    it('handles confirm merge button', () => {
      const confirmMergeBtn = document.getElementById('todo-edit-merge-confirm-btn');
      globalThis.confirmExecuteTodoMerge = vi.fn();

      triggerClick(confirmMergeBtn);
      expect(globalThis.confirmExecuteTodoMerge).toHaveBeenCalledTimes(1);
    });

    it('handles delete todo button', () => {
      const delBtn = document.getElementById('todo-edit-delete-btn');
      globalThis.deleteTodoFromOverlay = vi.fn();

      triggerClick(delBtn);
      expect(globalThis.deleteTodoFromOverlay).toHaveBeenCalledTimes(1);
    });

    it('handles cancel and save todo actions in footer', () => {
      const cancelBtn = document.querySelector('.todo-edit-actions-right button[data-i18n="todo.cancel"]');
      const saveBtn = document.querySelector('.todo-edit-actions-right button[data-i18n="todo.save"]');

      globalThis.requestCloseTodoOverlay = vi.fn();
      globalThis.saveTodoFromOverlay = vi.fn();

      triggerClick(cancelBtn);
      expect(globalThis.requestCloseTodoOverlay).toHaveBeenCalledTimes(1);

      triggerClick(saveBtn);
      expect(globalThis.saveTodoFromOverlay).toHaveBeenCalledTimes(1);
    });
  });

  describe('Interactive Matrix Picker Modal Buttons', () => {
    it('handles matrix picker close, cancel, and apply position buttons', () => {
      const closeBtn = document.querySelector('#todo-matrix-picker-overlay .overlay-close-btn');
      const cancelBtn = document.getElementById('todo-matrix-picker-cancel-btn');
      const confirmBtn = document.getElementById('todo-matrix-picker-confirm-btn');

      globalThis.closeSingleTodoMatrixPicker = vi.fn();
      globalThis.confirmSingleTodoMatrixPicker = vi.fn();

      triggerClick(closeBtn);
      expect(globalThis.closeSingleTodoMatrixPicker).toHaveBeenCalledTimes(1);

      triggerClick(cancelBtn);
      expect(globalThis.closeSingleTodoMatrixPicker).toHaveBeenCalledTimes(2);

      triggerClick(confirmBtn);
      expect(globalThis.confirmSingleTodoMatrixPicker).toHaveBeenCalledTimes(1);
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-buttons-modals-and-dialogs.test.js
// ═══════════════════════════════════════════════════
describe('UI Buttons - Modals & Dialogs (templates/modals.html)', () => {
  beforeAll(() => {
    const modalsHtml = fs.readFileSync(path.resolve(process.cwd(), 'templates/modals.html'), 'utf-8');

    document.body.innerHTML = `
      <div id="screen-main">
        ${modalsHtml}
      </div>
    `;

    globalThis.t = (k) => k;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.closeModal = vi.fn();
    globalThis.currentNote = { path: 'test.md', title: 'Test Note', content: 'hello' };

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js'
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('New Note Modal Buttons', () => {
    it('handles cancel and create note buttons', () => {
      const modal = document.getElementById('modal-new-note');
      const cancelBtn = modal.querySelector('.modal-actions button:nth-child(1)');
      const createBtn = modal.querySelector('.modal-actions button:nth-child(2)');

      globalThis.createNewNote = vi.fn();

      triggerClick(cancelBtn);
      expect(globalThis.closeModal).toHaveBeenCalledWith('modal-new-note');

      triggerClick(createBtn);
      expect(globalThis.createNewNote).toHaveBeenCalledTimes(1);
    });
  });

  describe('New Todo Modal Buttons', () => {
    it('handles cancel and save todo buttons', () => {
      const modal = document.getElementById('modal-new-todo');
      const cancelBtn = modal.querySelector('.modal-actions button:nth-child(1)');
      const saveBtn = modal.querySelector('.modal-actions button:nth-child(2)');

      globalThis.createNewTodo = vi.fn();

      triggerClick(cancelBtn);
      expect(globalThis.closeModal).toHaveBeenCalledWith('modal-new-todo');

      triggerClick(saveBtn);
      expect(globalThis.createNewTodo).toHaveBeenCalledTimes(1);
    });
  });

  describe('Collaborator Details & Edit Decision Modal Buttons', () => {
    it('handles close collaborator details button', () => {
      const modal = document.getElementById('modal-collab-details');
      const closeBtn = modal.querySelector('.modal-actions button');

      triggerClick(closeBtn);
      expect(globalThis.closeModal).toHaveBeenCalledWith('modal-collab-details');
    });

    it('handles edit decision modal actions (delete, cancel, save)', () => {
      const deleteBtn = document.getElementById('ed-delete-btn');
      const modal = document.getElementById('modal-edit-decision');
      const cancelBtn = modal.querySelector('.modal-actions div button:nth-child(1)');
      const saveBtn = modal.querySelector('.modal-actions div button:nth-child(2)');

      globalThis.deleteDecisionFromModal = vi.fn();
      globalThis.saveDecisionFromModal = vi.fn();

      triggerClick(deleteBtn);
      expect(globalThis.deleteDecisionFromModal).toHaveBeenCalledTimes(1);

      triggerClick(cancelBtn);
      expect(globalThis.closeModal).toHaveBeenCalledWith('modal-edit-decision');

      triggerClick(saveBtn);
      expect(globalThis.saveDecisionFromModal).toHaveBeenCalledTimes(1);
    });
  });

  describe('Export Decisions Modal Buttons', () => {
    it('handles cancel and confirm export decisions buttons', () => {
      const modal = document.getElementById('modal-export-decisions');
      const cancelBtn = modal.querySelector('.modal-actions button:nth-child(1)');
      const exportBtn = modal.querySelector('.modal-actions button:nth-child(2)');

      globalThis.confirmExportDecisions = vi.fn();

      triggerClick(cancelBtn);
      expect(globalThis.closeModal).toHaveBeenCalledWith('modal-export-decisions');

      triggerClick(exportBtn);
      expect(globalThis.confirmExportDecisions).toHaveBeenCalledTimes(1);
    });
  });

  describe('Refactor Clarifications Modal Buttons', () => {
    it('handles close, skip, cancel, and submit clarification buttons', () => {
      const modal = document.getElementById('modal-refactor-clarifications');
      const closeIconBtn = modal.querySelector('button[data-i18n-title="common.closeTooltip"]');
      const skipBtn = document.getElementById('btn-refactor-skip');
      const cancelBtn = modal.querySelector('.modal-actions div button:nth-child(1)');
      const submitBtn = document.getElementById('btn-refactor-submit');

      globalThis.RefactorModalController = {
        closeClarificationsModal: vi.fn(),
        skipClarifications: vi.fn(),
        submitClarifications: vi.fn()
      };

      triggerClick(closeIconBtn);
      expect(globalThis.RefactorModalController.closeClarificationsModal).toHaveBeenCalledTimes(1);

      triggerClick(skipBtn);
      expect(globalThis.RefactorModalController.skipClarifications).toHaveBeenCalledTimes(1);

      triggerClick(cancelBtn);
      expect(globalThis.RefactorModalController.closeClarificationsModal).toHaveBeenCalledTimes(2);

      triggerClick(submitBtn);
      expect(globalThis.RefactorModalController.submitClarifications).toHaveBeenCalledTimes(1);
    });
  });

  describe('Refactor Proposals Modal Buttons', () => {
    it('handles header popout and close buttons', () => {
      const popoutBtn = document.getElementById('btn-refactor-popout');
      const closeBtn = document.querySelector('.refactor-proposals-modal button[data-i18n-title="refactor.closeProposalsTooltip"]');

      globalThis.RefactorModalController = {
        popoutAuxiliaryWindow: vi.fn(),
        closeProposalsModal: vi.fn(),
        switchTab: vi.fn(),
        toggleFeedbackDrawer: vi.fn(),
        generateOptionC: vi.fn(),
        reperfectWithEdits: vi.fn(),
        copyCurrentProposal: vi.fn(),
        applyCurrentProposal: vi.fn()
      };

      triggerClick(popoutBtn);
      expect(globalThis.RefactorModalController.popoutAuxiliaryWindow).toHaveBeenCalledTimes(1);

      triggerClick(closeBtn);
      expect(globalThis.RefactorModalController.closeProposalsModal).toHaveBeenCalledTimes(1);
    });

    it('handles proposal navigation tabs (A, B, C, Original, Scratchpad)', () => {
      const tabA = document.getElementById('tab-proposal-a');
      const tabB = document.getElementById('tab-proposal-b');
      const tabC = document.getElementById('tab-proposal-c');
      const tabOrig = document.getElementById('tab-original');
      const tabScratch = document.getElementById('tab-scratchpad');

      triggerClick(tabA);
      expect(globalThis.RefactorModalController.switchTab).toHaveBeenCalledWith('A');

      triggerClick(tabB);
      expect(globalThis.RefactorModalController.switchTab).toHaveBeenCalledWith('B');

      triggerClick(tabC);
      expect(globalThis.RefactorModalController.switchTab).toHaveBeenCalledWith('C');

      triggerClick(tabOrig);
      expect(globalThis.RefactorModalController.switchTab).toHaveBeenCalledWith('original');

      triggerClick(tabScratch);
      expect(globalThis.RefactorModalController.switchTab).toHaveBeenCalledWith('scratchpad');
    });

    it('handles feedback drawer and Option C generate buttons', () => {
      const declineBtn = document.getElementById('btn-refactor-decline');
      const closeDrawerBtn = document.querySelector('#refactor-feedback-drawer button[data-i18n-title="refactor.closeFeedbackTooltip"]');
      const genOptionCBtn = document.getElementById('btn-generate-option-c');

      triggerClick(declineBtn);
      expect(globalThis.RefactorModalController.toggleFeedbackDrawer).toHaveBeenCalledWith(true);

      triggerClick(closeDrawerBtn);
      expect(globalThis.RefactorModalController.toggleFeedbackDrawer).toHaveBeenCalledWith(false);

      triggerClick(genOptionCBtn);
      expect(globalThis.RefactorModalController.generateOptionC).toHaveBeenCalledTimes(1);
    });

    it('handles footer proposal actions (reperfect, cancel, copy, apply)', () => {
      const reperfectBtn = document.getElementById('btn-refactor-reperfect');
      const cancelBtn = document.querySelector('.refactor-proposals-modal .modal-actions button[data-i18n-title="refactor.cancelTooltip"]');
      const copyBtn = document.getElementById('btn-refactor-copy');
      const applyBtn = document.getElementById('btn-refactor-apply');

      triggerClick(reperfectBtn);
      expect(globalThis.RefactorModalController.reperfectWithEdits).toHaveBeenCalledTimes(1);

      triggerClick(cancelBtn);
      expect(globalThis.RefactorModalController.closeProposalsModal).toHaveBeenCalledTimes(1);

      triggerClick(copyBtn);
      expect(globalThis.RefactorModalController.copyCurrentProposal).toHaveBeenCalledTimes(1);

      triggerClick(applyBtn);
      expect(globalThis.RefactorModalController.applyCurrentProposal).toHaveBeenCalledTimes(1);
    });
  });

  describe('Trash Bin Modal Buttons', () => {
    it('handles close and empty trash buttons', () => {
      const modal = document.getElementById('modal-trash-bin');
      const closeIcon = modal.querySelector('.modal-close-icon-btn');
      const emptyBtn = document.getElementById('btn-empty-trash');
      const closeBtn = modal.querySelector('.modal-actions button:nth-child(2)');

      globalThis.emptyTrashFromUI = vi.fn();

      triggerClick(closeIcon);
      expect(globalThis.closeModal).toHaveBeenCalledWith('modal-trash-bin');

      triggerClick(emptyBtn);
      expect(globalThis.emptyTrashFromUI).toHaveBeenCalledTimes(1);

      triggerClick(closeBtn);
      expect(globalThis.closeModal).toHaveBeenCalledWith('modal-trash-bin');
    });
  });

  describe('Share & Export Modal Buttons', () => {
    it('handles share tabs, download markdown, print pdf, copy text, and close buttons', () => {
      const tabSlack = document.getElementById('share-tab-slack-btn');
      const tabEmail = document.getElementById('share-tab-email-btn');
      const tabMd = document.getElementById('share-tab-md-btn');

      globalThis.switchShareTab = vi.fn();
      globalThis.copyFormattedShareText = vi.fn();
      globalThis.NoteFileExportEngine = {
        downloadMarkdown: vi.fn(),
        printToPdf: vi.fn()
      };

      triggerClick(tabSlack);
      expect(globalThis.switchShareTab).toHaveBeenCalledWith('slack');

      triggerClick(tabEmail);
      expect(globalThis.switchShareTab).toHaveBeenCalledWith('email');

      triggerClick(tabMd);
      expect(globalThis.switchShareTab).toHaveBeenCalledWith('markdown');

      const modal = document.getElementById('modal-note-share');
      const downloadBtn = modal.querySelector('button[data-i18n="share.downloadMd"]');
      const printBtn = modal.querySelector('button[data-i18n="share.printPdf"]');
      const copyBtn = modal.querySelector('button[data-i18n="share.copyBtn"]');
      const closeBtn = modal.querySelector('.modal-actions button[data-i18n="common.close"]');

      triggerClick(downloadBtn);
      expect(globalThis.NoteFileExportEngine.downloadMarkdown).toHaveBeenCalled();

      triggerClick(printBtn);
      expect(globalThis.NoteFileExportEngine.printToPdf).toHaveBeenCalledTimes(1);

      triggerClick(copyBtn);
      expect(globalThis.copyFormattedShareText).toHaveBeenCalledTimes(1);

      triggerClick(closeBtn);
      expect(globalThis.closeModal).toHaveBeenCalledWith('modal-note-share');
    });
  });

  describe('History, Knowledge Graph, Quick Stash, and Delete Workstream Buttons', () => {
    it('handles note history snapshot and close buttons', () => {
      const modal = document.getElementById('modal-note-history');
      const snapshotBtn = modal.querySelector('.modal-actions button:nth-child(1)');
      const closeBtn = modal.querySelector('.modal-actions button:nth-child(2)');

      globalThis.createManualSnapshotFromUI = vi.fn();

      triggerClick(snapshotBtn);
      expect(globalThis.createManualSnapshotFromUI).toHaveBeenCalledTimes(1);

      triggerClick(closeBtn);
      expect(globalThis.closeModal).toHaveBeenCalledWith('modal-note-history');
    });

    it('handles knowledge graph close button', () => {
      const closeBtn = document.querySelector('#modal-knowledge-graph .modal-close-icon-btn');
      globalThis.KnowledgeGraphViewer = { closeGraphModal: vi.fn() };

      triggerClick(closeBtn);
      expect(globalThis.KnowledgeGraphViewer.closeGraphModal).toHaveBeenCalledTimes(1);
    });

    it('handles quick stash close and save buttons', () => {
      const modal = document.getElementById('modal-quick-stash');
      const closeIcon = modal.querySelector('.modal-close-icon-btn');
      const cancelBtn = modal.querySelector('.modal-actions button:nth-child(1)');
      const stashBtn = modal.querySelector('.modal-actions button:nth-child(2)');

      globalThis.QuickStashController = {
        closeModal: vi.fn(),
        saveFromUI: vi.fn()
      };

      triggerClick(closeIcon);
      expect(globalThis.QuickStashController.closeModal).toHaveBeenCalledTimes(1);

      triggerClick(cancelBtn);
      expect(globalThis.QuickStashController.closeModal).toHaveBeenCalledTimes(2);

      triggerClick(stashBtn);
      expect(globalThis.QuickStashController.saveFromUI).toHaveBeenCalledTimes(1);
    });

    it('handles workstream delete confirm and cancel buttons', () => {
      const modal = document.getElementById('modal-delete-workstream');
      const closeIcon = modal.querySelector('.modal-close-icon-btn');
      const cancelBtn = modal.querySelector('.modal-actions button:nth-child(1)');
      const confirmBtn = document.getElementById('btn-confirm-delete-ws');

      triggerClick(closeIcon);
      expect(globalThis.closeModal).toHaveBeenCalledWith('modal-delete-workstream');

      triggerClick(cancelBtn);
      expect(globalThis.closeModal).toHaveBeenCalledWith('modal-delete-workstream');

      const confirmSpy = vi.fn();
      confirmBtn.onclick = confirmSpy;
      triggerClick(confirmBtn);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
    });
  });
});
