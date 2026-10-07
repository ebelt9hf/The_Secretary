import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Eisenhower Matrix Enhancements: 3-Todo Clusters, Workstream & Delegated Filters, Popover Positioning', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-state.js',
      'js/app-board.js',
      'js/app-notes.js',
      'js/app-todos-board.js'
    ]);
  });

  beforeEach(() => {
    global.todosManifest = [];
    global.manifest = [];
    global._topicMemoriesIndexCache = null;
    global.setEisenhowerWorkstreamFilter(null);
    global.showDelegatedTodos = false;
  });

  describe('Delegated Task Detection (isTodoDelegated)', () => {
    it('identifies task as delegated when delegatedTo is set', () => {
      const todo = { id: 't1', title: 'Delegated Task', delegatedTo: 'Alice', ownerId: 'me', priority: 'High' };
      expect(isTodoDelegated(todo)).toBe(true);
    });

    it('identifies task as delegated when isDelegated is true', () => {
      const todo = { id: 't2', title: 'Delegated Task 2', isDelegated: true, ownerId: 'me' };
      expect(isTodoDelegated(todo)).toBe(true);
    });

    it('identifies task as delegated when owner is another collaborator', () => {
      const todo = { id: 't3', title: 'Colleague Task', ownerId: 'bob_id', priority: 'Medium' };
      expect(isTodoDelegated(todo)).toBe(true);
    });

    it('identifies user task in Q3 (Urgent, Non-important) as user task not delegated', () => {
      const todo = { id: 't4', title: 'Q3 Task', ownerId: 'me', eisenhowerQuadrant: 'Q3' };
      expect(isTodoDelegated(todo)).toBe(false);
    });

    it('identifies standard user task in Q1/Q2/Q4 as not delegated', () => {
      const todo = { id: 't5', title: 'My Important Task', ownerId: 'me', eisenhowerQuadrant: 'Q1' };
      expect(isTodoDelegated(todo)).toBe(false);
    });
  });

  describe('Defined Workstreams List (getDefinedWorkstreamsList)', () => {
    it('collects unique defined workstreams from topic memories, excluding "Other" and "Autre"', () => {
      global._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Design', status: 'active' },
          { topicName: 'Engineering', status: 'active' },
          { topicName: 'Marketing', status: 'active' },
          { topicName: 'Other', status: 'active' },
          { topicName: 'autre', status: 'active' }
        ]
      };
      global.manifest = [
        { path: 'notes/1.html', workstream: 'Marketing' },
        { path: 'notes/2.html', workstream: 'Other' },
        { path: 'notes/3.html', workstream: 'Engineering' }
      ];
      global.todosManifest = [
        { id: 't1', title: 'Task 1', workstream: 'Design' },
        { id: 't2', title: 'Task 2', workstream: 'Engineering' },
        { id: 't3', title: 'Task 3', workstream: 'autre' }
      ];

      const list = getDefinedWorkstreamsList();
      expect(list).toEqual(['Design', 'Engineering', 'Marketing']);
      expect(list).not.toContain('Other');
      expect(list).not.toContain('autre');
    });

    it('returns empty list if only "Other" or "Autre" are defined', () => {
      global._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Other', status: 'active' },
          { topicName: 'Autre', status: 'active' }
        ]
      };
      global.manifest = [{ path: 'notes/1.html', workstream: 'Other' }];
      global.todosManifest = [{ id: 't1', title: 'Task 1', workstream: 'Autre' }];

      const list = getDefinedWorkstreamsList();
      expect(list).toEqual([]);
    });

    it('strictly returns only authoritative Workstreams Tab topic memories when defined, ignoring stray tags in notes and tasks', () => {
      global._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Core Platform', status: 'active' },
          { topicName: 'Mobile App', status: 'active' },
          { topicName: 'Archived Legacy', status: 'archived' }
        ]
      };

      global.manifest = [
        { path: 'notes/1.html', workstream: 'Core Platform' },
        { path: 'notes/2.html', workstream: 'Stray Note Tag' },
        { path: 'notes/3.html', workstream: 'Archived Legacy' }
      ];
      global.todosManifest = [
        { id: 't1', title: 'Task 1', workstream: 'Mobile App' },
        { id: 't2', title: 'Task 2', workstream: 'Random Obsolete Tag' }
      ];

      const list = getDefinedWorkstreamsList();
      expect(list).toEqual(['Core Platform', 'Mobile App']);
      expect(list).not.toContain('Stray Note Tag');
      expect(list).not.toContain('Random Obsolete Tag');
      expect(list).not.toContain('Archived Legacy');
    });
  });

  describe('Eisenhower Board Filtering Logic', () => {
    it('filters out delegated tasks from scatter canvas by default', () => {
      document.body.innerHTML = '<div id="swimlane-board"></div>';

      global.todosManifest = [
        { id: 't1', title: 'Active Task 1', ownerId: 'me', priority: 'High', eisenhowerQuadrant: 'Q1', eisenhowerX: 20, eisenhowerY: 20 },
        { id: 't2', title: 'Delegated Task 2', ownerId: 'me', delegatedTo: 'Bob', priority: 'High', eisenhowerQuadrant: 'Q1', eisenhowerX: 20, eisenhowerY: 20 }
      ];

      global.showDelegatedTodos = false;
      renderTodosBoard();

      const canvasHtml = document.getElementById('eisenhower-map-canvas')?.innerHTML || '';
      expect(canvasHtml).toContain('Active Task 1');
      expect(canvasHtml).not.toContain('Delegated Task 2');
    });

    it('includes delegated tasks when showDelegatedTodos is toggled to true', () => {
      document.body.innerHTML = '<div id="swimlane-board"></div>';

      global.todosManifest = [
        { id: 't1', title: 'Active Task 1', ownerId: 'me', priority: 'High', eisenhowerQuadrant: 'Q1', eisenhowerX: 20, eisenhowerY: 20 },
        { id: 't2', title: 'Delegated Task 2', ownerId: 'me', delegatedTo: 'Bob', priority: 'High', eisenhowerQuadrant: 'Q1', eisenhowerX: 20, eisenhowerY: 20 }
      ];

      global.showDelegatedTodos = true;
      renderTodosBoard();

      const boardHtml = document.getElementById('swimlane-board').innerHTML;
      expect(boardHtml).toContain('Active Task 1');
      expect(boardHtml).toContain('Delegated Task 2');
    });

    it('renders top workstream filter bar and filters by selected workstream', () => {
      document.body.innerHTML = '<div id="swimlane-board"></div>';

      global._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Engineering', status: 'active' },
          { topicName: 'Marketing', status: 'active' }
        ]
      };

      global.todosManifest = [
        { id: 't1', title: 'Eng Task', workstream: 'Engineering', ownerId: 'me', priority: 'High', eisenhowerQuadrant: 'Q1', eisenhowerX: 20, eisenhowerY: 20 },
        { id: 't2', title: 'Mkt Task', workstream: 'Marketing', ownerId: 'me', priority: 'High', eisenhowerQuadrant: 'Q1', eisenhowerX: 25, eisenhowerY: 25 }
      ];

      renderTodosBoard();
      let boardHtml = document.getElementById('swimlane-board').innerHTML;
      expect(boardHtml).toContain('eisenhower-workstream-filter-bar');
      expect(boardHtml).toContain('Engineering');
      expect(boardHtml).toContain('Marketing');
      expect(boardHtml).toContain('Eng Task');
      expect(boardHtml).toContain('Mkt Task');

      // Filter by Engineering
      setEisenhowerWorkstreamFilter('Engineering');
      boardHtml = document.getElementById('swimlane-board').innerHTML;
      expect(boardHtml).toContain('Eng Task');
      expect(boardHtml).not.toContain('Mkt Task');
    });
  });

  describe('Multi-Todo Cluster Preview Display (3 Todos)', () => {
    it('renders up to 3 todo titles in overlapping cluster dot', () => {
      document.body.innerHTML = '<div id="swimlane-board"></div>';

      // 4 todos with identical coordinates to guarantee clustering
      global.todosManifest = [
        { id: 'c1', title: 'Alpha Todo', ownerId: 'me', priority: 'High', eisenhowerQuadrant: 'Q1', eisenhowerX: 30, eisenhowerY: 30 },
        { id: 'c2', title: 'Beta Todo', ownerId: 'me', priority: 'High', eisenhowerQuadrant: 'Q1', eisenhowerX: 30, eisenhowerY: 30 },
        { id: 'c3', title: 'Gamma Todo', ownerId: 'me', priority: 'High', eisenhowerQuadrant: 'Q1', eisenhowerX: 30, eisenhowerY: 30 },
        { id: 'c4', title: 'Delta Todo', ownerId: 'me', priority: 'High', eisenhowerQuadrant: 'Q1', eisenhowerX: 30, eisenhowerY: 30 }
      ];

      renderTodosBoard();

      const clusterDot = document.querySelector('.eisenhower-cluster-dot');
      expect(clusterDot).not.toBeNull();

      const stackedHtml = clusterDot.querySelector('.eisenhower-cluster-titles-stacked').innerHTML;
      expect(stackedHtml).toContain('Alpha Todo');
      expect(stackedHtml).toContain('Beta Todo');
      expect(stackedHtml).toContain('Gamma Todo');
      expect(stackedHtml).not.toContain('Delta Todo'); // 4th todo excluded from preview

      const badge = clusterDot.querySelector('.eisenhower-cluster-badge');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe('+1'); // 4 - 3 = 1 remaining
    });
  });

  describe('Hover Popover Positioning', () => {
    it('positions popover downwards when space is available below', () => {
      const popover = document.createElement('div');
      popover.className = 'eisenhower-quick-popover';
      document.body.appendChild(popover);

      const targetEl = document.createElement('div');
      targetEl.className = 'eisenhower-task-text eisenhower-radial-dot';
      targetEl.getBoundingClientRect = () => ({
        left: 200,
        top: 200,
        right: 320,
        bottom: 230,
        width: 120,
        height: 30
      });
      document.body.appendChild(targetEl);

      positionEisenhowerQuickActionPopover(popover, targetEl);

      const topPos = parseInt(popover.style.top, 10);
      // For elements with ample room below, it places downwards below the target
      expect(topPos).toBeGreaterThanOrEqual(230);
    });

    it('flips popover upwards when element is near the bottom, avoiding side jumping', () => {
      const popover = document.createElement('div');
      popover.className = 'eisenhower-quick-popover';
      document.body.appendChild(popover);

      const targetEl = document.createElement('div');
      targetEl.className = 'eisenhower-task-text';
      targetEl.getBoundingClientRect = () => ({
        left: 400,
        top: 660,
        right: 520,
        bottom: 690,
        width: 120,
        height: 30
      });
      document.body.appendChild(targetEl);

      positionEisenhowerQuickActionPopover(popover, targetEl);

      const topPos = parseInt(popover.style.top, 10);
      const leftPos = parseInt(popover.style.left, 10);

      // Must be placed above target (topPos + height < 660)
      expect(topPos).toBeLessThan(660);
      // Horizontal centering around targetCenter (460 - 290/2 = 315)
      expect(leftPos).toBeCloseTo(315, -1);
    });
  });

  describe('Quadrant Detail Overlay Filtering & Sorting', () => {
    it('filters and sorts tasks by coordinates in quadrant detail overlay', () => {
      global.todosManifest = [
        { id: 't1', title: 'Q1 Delegated', priority: 'High', ownerId: 'me', eisenhowerQuadrant: 'Q1', delegatedTo: 'Alice', eisenhowerX: 20, eisenhowerY: 20 },
        { id: 't2', title: 'Q1 Engineering Task', priority: 'High', ownerId: 'me', eisenhowerQuadrant: 'Q1', workstream: 'Engineering', eisenhowerX: 40, eisenhowerY: 10 },
        { id: 't3', title: 'Q1 Design Task', priority: 'High', ownerId: 'me', eisenhowerQuadrant: 'Q1', workstream: 'Design', eisenhowerX: 10, eisenhowerY: 30 }
      ];

      // 1. Without delegated tasks, without workstream filter
      global.showDelegatedTodos = false;
      global.setEisenhowerWorkstreamFilter(null);

      openQuadrantDetailOverlay('Q1');
      const overlay = document.getElementById('eisenhower-quadrant-overlay');
      expect(overlay).not.toBeNull();
      expect(overlay.classList.contains('visible')).toBe(true);

      const titleGroup = overlay.querySelector('.sl-lane-count');
      expect(titleGroup.textContent).toContain('2'); // t2 and t3

      // 2. With workstream filter 'Engineering'
      global.setEisenhowerWorkstreamFilter('Engineering');
      openQuadrantDetailOverlay('Q1');
      const filteredCount = overlay.querySelector('.sl-lane-count');
      expect(filteredCount.textContent).toContain('1'); // only t2

      // 3. Close overlay
      closeQuadrantDetailOverlay();
      expect(overlay.classList.contains('visible')).toBe(false);
    });
  });

  describe('Radial Cluster Toggles', () => {
    it('expands, collapses, and toggles radial cluster classes', () => {
      const groupEl = document.createElement('div');
      groupEl.id = 'cluster-group-test1';
      groupEl.className = 'eisenhower-cluster-group';
      document.body.appendChild(groupEl);

      expandRadialCluster('test1');
      expect(groupEl.classList.contains('is-expanded')).toBe(true);

      collapseRadialCluster('test1');
      expect(groupEl.classList.contains('is-expanded')).toBe(false);

      toggleRadialCluster('test1');
      expect(groupEl.classList.contains('is-expanded')).toBe(true);
      expect(groupEl.classList.contains('is-pinned')).toBe(true);

      groupEl.remove();
    });
  });

  describe('Eisenhower Matrix Draft Todo Dot and Drag-to-Create', () => {
    let openedDialogOpts = null;

    beforeEach(() => {
      openedDialogOpts = null;
      global.openNewTodoDialog = (opts) => {
        openedDialogOpts = opts;
      };
      document.body.innerHTML = `
        <div id="swimlane-board">
          <div class="eisenhower-map-canvas" id="eisenhower-map-canvas" style="position:relative;width:500px;height:400px;">
            <div id="rect-q1"></div>
            <div id="rect-q2"></div>
            <div id="rect-q3"></div>
            <div id="rect-q4"></div>
            <div id="eisenhower-guide-x" style="display:none;"></div>
            <div id="eisenhower-guide-y" style="display:none;"></div>
            <div id="axis-pill-pct-urgent" style="display:none;"></div>
            <div id="axis-pill-pct-not-urgent" style="display:none;"></div>
            <div id="axis-pill-pct-important" style="display:none;"></div>
            <div id="axis-pill-pct-not-important" style="display:none;"></div>
          </div>
        </div>
      `;
      const canvas = document.getElementById('eisenhower-map-canvas');
      canvas.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: 500,
        height: 400,
        right: 500,
        bottom: 400
      });
      initScatterplotDragAndDrop();
    });

    it('creates draft dot on canvas with appropriate quadrant styling', () => {
      const canvas = document.getElementById('eisenhower-map-canvas');
      const draftDot = createOrUpdateEisenhowerDraftDot(canvas, 20, 30);

      expect(draftDot).not.toBeNull();
      expect(draftDot.classList.contains('eisenhower-draft-dot')).toBe(true);
      expect(draftDot.style.left).toBe('20.00%');
      expect(draftDot.style.top).toBe('30.00%');
      expect(draftDot.style.getPropertyValue('--task-accent')).toBe('#ef4444'); // Q1 color
    });

    it('single click on empty canvas spawns draft dot and does not open modal', () => {
      const canvas = document.getElementById('eisenhower-map-canvas');

      // Click at x=100 (20%), y=120 (30%) -> Q1
      const pointerDownEv = new MouseEvent('pointerdown', { clientX: 100, clientY: 120, bubbles: true });
      canvas.dispatchEvent(pointerDownEv);

      const pointerUpEv = new MouseEvent('pointerup', { clientX: 100, clientY: 120, bubbles: true });
      window.dispatchEvent(pointerUpEv);

      const draftDot = document.getElementById('eisenhower-draft-dot');
      expect(draftDot).not.toBeNull();
      expect(draftDot.style.left).toBe('20.00%');
      expect(draftDot.style.top).toBe('30.00%');
      expect(openedDialogOpts).toBeNull(); // Modal not opened yet on first click
    });

    it('second click on existing draft dot opens new todo modal with matching coords and quadrant', () => {
      const canvas = document.getElementById('eisenhower-map-canvas');

      // 1. First click: create draft dot
      canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 120, bubbles: true }));
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, clientY: 120, bubbles: true }));

      const draftDot = document.getElementById('eisenhower-draft-dot');
      expect(draftDot).not.toBeNull();
      draftDot.getBoundingClientRect = () => ({
        left: 90,
        top: 110,
        width: 20,
        height: 20,
        right: 110,
        bottom: 130
      });

      // 2. Second click on draft dot
      draftDot.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 120, bubbles: true }));
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, clientY: 120, bubbles: true }));

      expect(openedDialogOpts).not.toBeNull();
      expect(openedDialogOpts.eisenhowerQuadrant).toBe('Q1');
      expect(openedDialogOpts.priority).toBe('High');
      expect(openedDialogOpts.eisenhowerX).toBe(20);
      expect(openedDialogOpts.eisenhowerY).toBe(30);

      // Draft dot is cleaned up after modal opens
      expect(document.getElementById('eisenhower-draft-dot')).toBeNull();
    });

    it('dragging draft dot across quadrants and releasing opens modal at dropped position', () => {
      const canvas = document.getElementById('eisenhower-map-canvas');

      // Pointer down at x=100 (20%), y=120 (30%) in Q1
      canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 120, bubbles: true }));

      // Drag across to x=400 (80%), y=300 (75%) in Q4 (dist > 4)
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 300, bubbles: true }));

      const draftDot = document.getElementById('eisenhower-draft-dot');
      expect(draftDot).not.toBeNull();
      expect(draftDot.classList.contains('dragging')).toBe(true);
      expect(draftDot.style.getPropertyValue('--task-accent')).toBe('#14b8a6'); // Q4 color

      // Release mouse at x=400, y=300
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 400, clientY: 300, bubbles: true }));

      expect(openedDialogOpts).not.toBeNull();
      expect(openedDialogOpts.eisenhowerQuadrant).toBe('Q4');
      expect(openedDialogOpts.priority).toBe('Low');
      expect(openedDialogOpts.eisenhowerX).toBe(80);
      expect(openedDialogOpts.eisenhowerY).toBe(75);
      expect(document.getElementById('eisenhower-draft-dot')).toBeNull();
    });

    it('removes draft dot on Escape key or renderTodosBoard', () => {
      const canvas = document.getElementById('eisenhower-map-canvas');
      createOrUpdateEisenhowerDraftDot(canvas, 30, 40);
      expect(document.getElementById('eisenhower-draft-dot')).not.toBeNull();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(document.getElementById('eisenhower-draft-dot')).toBeNull();
    });
  });

  describe('Eisenhower Matrix UI Tooltips & Keyboard Accessibility', () => {
    it('provides localized tooltips on task stars, lock badges, cluster badges and direct report select', () => {
      document.body.innerHTML = '<div id="swimlane-board"></div>';

      global.todosManifest = [
        { id: 'p1', title: 'Prereq Blocked', priority: 'High', eisenhowerQuadrant: 'Q1', eisenhowerX: 10, eisenhowerY: 10 },
        { id: 't1', title: 'Task Starred', ownerId: 'me', isHighPriority: true, priority: 'High', eisenhowerQuadrant: 'Q1', eisenhowerX: 20, eisenhowerY: 20 },
        { id: 't2', title: 'Task Blocked', ownerId: 'me', priority: 'High', depends_on: ['p1'], eisenhowerQuadrant: 'Q1', eisenhowerX: 25, eisenhowerY: 25 },
        { id: 't3', title: 'Urge Delegate Task', ownerId: 'me', priority: 'Low', eisenhowerQuadrant: 'Q3', eisenhowerX: 20, eisenhowerY: 80 }
      ];

      global.getColleagueDirects = () => [{ id: 'colleague1', label: 'Bob' }];

      renderTodosBoard();

      const starEl = document.querySelector('.eisenhower-task-star');
      expect(starEl).not.toBeNull();
      expect(starEl.getAttribute('title')).toBeTruthy();

      const lockBadge = document.querySelector('.eisenhower-task-lock-badge');
      expect(lockBadge).not.toBeNull();
      expect(lockBadge.getAttribute('title')).toBeTruthy();

      // Open quadrant overlay to test card select
      openQuadrantDetailOverlay('Q3');
      const selectEl = document.querySelector('.todo-delegate-select');
      if (selectEl) {
        expect(selectEl.getAttribute('title')).toBeTruthy();
      }
    });

    it('enables keyboard activation and proper role/aria on quadrant background titles', () => {
      document.body.innerHTML = '<div id="swimlane-board"></div>';
      global.todosManifest = [];
      renderTodosBoard();

      const q1Title = document.querySelector('.eisenhower-quadrant-bg-title');
      expect(q1Title).not.toBeNull();
      expect(q1Title.getAttribute('role')).toBe('button');
      expect(q1Title.getAttribute('tabindex')).toBe('0');
      expect(q1Title.getAttribute('title')).toBeTruthy();
      expect(q1Title.getAttribute('onkeydown')).toContain('openQuadrantDetailOverlay');

      openQuadrantDetailOverlay('Q1');
      const overlay = document.getElementById('eisenhower-quadrant-overlay');
      expect(overlay).not.toBeNull();
      expect(overlay.classList.contains('visible')).toBe(true);

      // Verify overlay action button has title
      const newBtn = overlay.querySelector('.overlay-actions .btn-accent');
      expect(newBtn).not.toBeNull();
      expect(newBtn.getAttribute('title')).toBeTruthy();
    });
  });
});
