import { describe, it, expect, beforeAll } from 'vitest';
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
});
