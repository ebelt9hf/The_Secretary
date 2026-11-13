import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('KnowledgeGraphViewer (Visual Knowledge Graph)', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-graph-view.js'
    ]);
  });

  it('builds nodes and links accurately from notes manifest and graph index', () => {
    const mockNotes = [
      { path: 'notes/note1.html', title: 'Strategy 2026', group_tags: ['Strategy'], workstream: 'Leadership' },
      { path: 'notes/note2.html', title: 'Budget Allocation', group_tags: ['Finance'], workstream: 'Leadership' },
      { path: 'notes/note3.html', title: 'Hiring Plan', group_tags: ['People'], workstream: 'HR' }
    ];

    const mockGraphIndex = {
      forwardLinks: {
        'notes/note1.html': ['notes/note2.html']
      },
      backlinks: {
        'notes/note2.html': ['notes/note1.html']
      }
    };

    const graphData = KnowledgeGraphViewer.buildGraphData(mockNotes, mockGraphIndex);

    expect(graphData).toBeDefined();
    expect(graphData.nodes.length).toBe(3);
    expect(graphData.links.length).toBe(1);

    const link = graphData.links[0];
    expect(link.source).toBe('notes/note1.html');
    expect(link.target).toBe('notes/note2.html');

    const node1 = graphData.nodes.find(n => n.id === 'notes/note1.html');
    expect(node1.degree).toBe(1);
    expect(node1.workstream).toBe('Leadership');
  });

  it('calculates simulation physics step and bounds coordinates', () => {
    const graphData = {
      nodes: [
        { id: 'a', x: 100, y: 100, vx: 5, vy: 5, degree: 1 },
        { id: 'b', x: 200, y: 200, vx: -5, vy: -5, degree: 1 }
      ],
      links: [
        { source: 'a', target: 'b' }
      ]
    };

    KnowledgeGraphViewer.stepSimulation(graphData, 800, 600, 0.1);

    expect(typeof graphData.nodes[0].x).toBe('number');
    expect(graphData.nodes[0].x).toBeGreaterThan(0);
    expect(graphData.nodes[0].x).toBeLessThan(800);
  });

  it('filters graph nodes and connected edges by workstream', () => {
    const graphData = {
      nodes: [
        { id: 'a', title: 'A', workstream: 'Eng' },
        { id: 'b', title: 'B', workstream: 'Eng' },
        { id: 'c', title: 'C', workstream: 'Marketing' }
      ],
      links: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' }
      ]
    };

    const filtered = KnowledgeGraphViewer.filterGraph(graphData, 'Eng');
    expect(filtered.nodes.length).toBe(2);
    expect(filtered.nodes.every(n => n.workstream === 'Eng')).toBe(true);
    expect(filtered.links.length).toBe(1);
    expect(filtered.links[0].source).toBe('a');
    expect(filtered.links[0].target).toBe('b');

    // 'all' returns all nodes and links
    const allFiltered = KnowledgeGraphViewer.filterGraph(graphData, 'all');
    expect(allFiltered.nodes.length).toBe(3);
    expect(allFiltered.links.length).toBe(2);
  });

  it('assigns distinctive colors based on workstream list', () => {
    const wsList = ['Eng', 'Design', 'Marketing'];
    const color1 = KnowledgeGraphViewer.getNodeColor('Eng', wsList);
    const color2 = KnowledgeGraphViewer.getNodeColor('Design', wsList);
    const fallbackColor = KnowledgeGraphViewer.getNodeColor('', wsList);

    expect(color1).toBeDefined();
    expect(color2).toBeDefined();
    expect(color1).not.toBe(color2);
    expect(fallbackColor).toBe('#64748b');
  });

  it('scales node radius proportionally with connectivity degree', () => {
    const mockNotes = [
      { path: 'notes/hub.html', title: 'Central Hub' },
      { path: 'notes/leaf1.html', title: 'Leaf 1' },
      { path: 'notes/leaf2.html', title: 'Leaf 2' },
      { path: 'notes/leaf3.html', title: 'Leaf 3' }
    ];

    const mockGraphIndex = {
      forwardLinks: {
        'notes/hub.html': ['notes/leaf1.html', 'notes/leaf2.html', 'notes/leaf3.html']
      }
    };

    const graphData = KnowledgeGraphViewer.buildGraphData(mockNotes, mockGraphIndex);
    const hubNode = graphData.nodes.find(n => n.id === 'notes/hub.html');
    const leafNode = graphData.nodes.find(n => n.id === 'notes/leaf1.html');

    expect(hubNode.degree).toBe(3);
    expect(leafNode.degree).toBe(1);
    expect(hubNode.radius).toBeGreaterThan(leafNode.radius);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (globalThis.KnowledgeGraphViewer) {
      if (globalThis.KnowledgeGraphViewer.animFrameId) {
        cancelAnimationFrame(globalThis.KnowledgeGraphViewer.animFrameId);
        globalThis.KnowledgeGraphViewer.animFrameId = null;
      }
      globalThis.KnowledgeGraphViewer.activeWorkstream = 'all';
      globalThis.KnowledgeGraphViewer.hoveredNodeId = null;
      globalThis.KnowledgeGraphViewer.selectedNodeId = null;
      globalThis.KnowledgeGraphViewer.zoom = 1;
      globalThis.KnowledgeGraphViewer.panX = 0;
      globalThis.KnowledgeGraphViewer.panY = 0;
    }
  });

  it('builds edges from production Map/Set noteGraphIndex structure', () => {
    const mockNotes = [
      { path: 'notes/a.html', title: 'Alpha', workstream: 'Eng' },
      { path: 'notes/b.html', title: 'Beta', workstream: 'Eng' },
      { path: 'notes/c.html', title: 'Gamma', workstream: 'Product' }
    ];

    const mapGraphIndex = {
      forwardLinks: new Map([
        ['notes/a.html', new Set(['notes/b.html', 'notes/c.html'])],
        ['notes/b.html', new Set(['notes/c.html'])]
      ]),
      backlinks: new Map([
        ['notes/b.html', new Set(['notes/a.html'])],
        ['notes/c.html', new Set(['notes/a.html', 'notes/b.html'])]
      ]),
      isHydrated: true
    };

    const graphData = KnowledgeGraphViewer.buildGraphData(mockNotes, mapGraphIndex);
    expect(graphData.nodes.length).toBe(3);
    expect(graphData.links.length).toBe(3);

    const nodeC = graphData.nodes.find(n => n.id === 'notes/c.html');
    expect(nodeC.degree).toBe(2);
    expect(nodeC.radius).toBe(Math.min(18, Math.max(5, 5 + 2 * 2)));
  });

  it('resets activeWorkstream to all when openGraphModal is called and hydrates unhydrated noteGraphIndex', async () => {
    document.body.innerHTML = `
      <div id="modal-knowledge-graph" class="modal-overlay">
        <div id="knowledge-graph-ws-pills"></div>
        <canvas id="knowledge-graph-canvas"></canvas>
      </div>
    `;
    globalThis.openModal = vi.fn();
    globalThis.closeModal = vi.fn();
    globalThis.manifest = [
      { path: 'notes/n1.html', title: 'One', workstream: 'Eng' },
      { path: 'notes/n2.html', title: 'Two', workstream: 'HR' }
    ];
    globalThis.noteGraphIndex = {
      forwardLinks: new Map(),
      backlinks: new Map(),
      isHydrated: false
    };
    globalThis.rebuildNoteGraphIndex = vi.fn(async () => {
      globalThis.noteGraphIndex = {
        forwardLinks: new Map([['notes/n1.html', new Set(['notes/n2.html'])]]),
        backlinks: new Map([['notes/n2.html', new Set(['notes/n1.html'])]]),
        isHydrated: true,
        includesDiskScan: true
      };
      return globalThis.noteGraphIndex;
    });

    KnowledgeGraphViewer.activeWorkstream = 'Eng';
    KnowledgeGraphViewer.openGraphModal();

    expect(KnowledgeGraphViewer.activeWorkstream).toBe('all');
    expect(KnowledgeGraphViewer.filteredGraphData.nodes.length).toBe(2);
    expect(globalThis.rebuildNoteGraphIndex).toHaveBeenCalledWith({ fetchDisk: true });

    await Promise.resolve();
    await Promise.resolve();

    expect(KnowledgeGraphViewer.activeGraphData.links.length).toBe(1);
    expect(KnowledgeGraphViewer.filteredGraphData.links.length).toBe(1);
  });

  it('resolves CSS text color for node labels instead of passing var(--text) to canvas fillStyle', () => {
    const fillStylesUsed = [];
    const fakeCtx = {
      _fillStyle: '#000000',
      set fillStyle(val) {
        // Mimic real HTML5 Canvas: ignore invalid CSS var(...) strings
        if (typeof val === 'string' && val.startsWith('var(')) return;
        this._fillStyle = val;
      },
      get fillStyle() {
        return this._fillStyle;
      },
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(() => fillStylesUsed.push({ op: 'fill', color: fakeCtx._fillStyle })),
      stroke: vi.fn(),
      fillText: vi.fn((text) => fillStylesUsed.push({ op: 'fillText', text, color: fakeCtx._fillStyle })),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      setTransform: vi.fn()
    };

    KnowledgeGraphViewer.canvas = { width: 800, height: 600 };
    KnowledgeGraphViewer.ctx = fakeCtx;
    KnowledgeGraphViewer.activeGraphData = { workstreams: ['Eng'] };
    KnowledgeGraphViewer.filteredGraphData = {
      nodes: [{ id: 'a', title: 'Alpha', workstream: 'Eng', x: 200, y: 200, radius: 7, degree: 1 }],
      links: []
    };

    KnowledgeGraphViewer.draw();

    const textOp = fillStylesUsed.find(op => op.op === 'fillText');
    expect(textOp).toBeDefined();
    expect(textOp.color).not.toBe('#6366f1');
  });

  it('handles 1000 notes efficiently in buildGraphData, stepSimulation, and draw', () => {
    const count = 1000;
    const notes = [];
    const forwardLinks = new Map();
    for (let i = 0; i < count; i++) {
      const path = `notes/note-${i}.html`;
      notes.push({
        path,
        title: `Note ${i}`,
        workstream: i % 5 === 0 ? 'Eng' : 'Product'
      });
      if (i > 0) {
        const targets = new Set([`notes/note-${i - 1}.html`]);
        if (i % 10 === 0 && i >= 10) targets.add(`notes/note-${i - 10}.html`);
        forwardLinks.set(path, targets);
      }
    }

    const graphData = KnowledgeGraphViewer.buildGraphData(notes, { forwardLinks, backlinks: new Map() });
    expect(graphData.nodes.length).toBe(1000);
    expect(graphData.links.length).toBeGreaterThan(1000);

    const t0 = performance.now();
    KnowledgeGraphViewer.stepSimulation(graphData, 900, 600, 0.1);
    const elapsedMs = performance.now() - t0;

    expect(elapsedMs).toBeLessThan(150);
    for (const n of graphData.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }

    let fillTextCalls = 0;
    const fakeCtx = {
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      font: '',
      textAlign: 'center',
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(() => { fillTextCalls++; }),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      setTransform: vi.fn()
    };

    KnowledgeGraphViewer.canvas = { width: 900, height: 600 };
    KnowledgeGraphViewer.ctx = fakeCtx;
    KnowledgeGraphViewer.activeGraphData = graphData;
    KnowledgeGraphViewer.filteredGraphData = graphData;
    KnowledgeGraphViewer.zoom = 1;
    KnowledgeGraphViewer.hoveredNodeId = 'notes/note-500.html';

    KnowledgeGraphViewer.draw();

    // Should cap/cull labels at 1000 nodes instead of drawing 1000 overlapping labels
    expect(fillTextCalls).toBeLessThan(150);
    expect(fillTextCalls).toBeGreaterThan(0);
  });
});
