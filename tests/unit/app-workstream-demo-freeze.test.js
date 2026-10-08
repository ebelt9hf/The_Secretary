import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Workstream / Decisions Tab Freeze & Demo Mode', () => {
  let renderRegisterView;
  let renderTeamPanel;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="team-panel" style="display:flex;"></div>
    `;
    vi.restoreAllMocks();

    window.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    window.escA = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    window.t = (k) => k;
    window.toast = vi.fn();
    window.getWsIcon = () => '<span>icon</span>';
    window.pendingDecisionsList = [];
    window.decisionsList = [];
    window.favoriteRegistryProjects = new Set();
    window.workstreamCustomOrder = [];
    window.selectedRegistryProject = null;
    window.activeCollabView = 'registry';
    window.activeWorkstreamSubTab = 'overview';
    window.isWorkstreamLoading = false;
    window._topicMemoriesIndexCache = { topics: [] }; // Empty topics index as in fresh demo mode
    window.REGISTRY_ALL_PROJECTS_KEY = '__ALL_PROJECTS__';
    window.REGISTRY_OTHER_PROJECTS_KEY = '__OTHER_WORKSTREAM__';

    // Mock WorkstreamMemoryEngine
    window.WorkstreamMemoryEngine = {
      getTopicMemoriesCatalog: vi.fn().mockResolvedValue([])
    };

    // Load app-collab
    const collabCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-collab.js'), 'utf8');
    const fn = new Function('window', 'document', 't', 'escH', 'escA', `
      ${collabCode}
      return {
        renderRegisterView,
        renderTeamPanel,
        setActiveCollabView: (v) => { activeCollabView = v; }
      };
    `);
    const exports = fn(window, document, window.t, window.escH, window.escA);
    renderRegisterView = exports.renderRegisterView;
    renderTeamPanel = exports.renderTeamPanel;
    exports.setActiveCollabView('registry');
    window.renderRegisterView = renderRegisterView;
    window.renderTeamPanel = renderTeamPanel;
  });

  it('does NOT trigger infinite recursive loop when registered workstreams is 0', async () => {
    const container = document.getElementById('team-panel');
    let renderCount = 0;

    // Spy on renderRegisterView to detect runaway recursion
    const originalRenderRegisterView = window.renderRegisterView;
    vi.spyOn(window, 'renderRegisterView').mockImplementation((...args) => {
      renderCount++;
      if (renderCount > 10) {
        throw new Error('Infinite loop detected in renderRegisterView! renderCount exceeded 10');
      }
      return originalRenderRegisterView(...args);
    });

    renderRegisterView(container);

    // Wait for any microtasks / promises to settle
    await new Promise(r => setTimeout(r, 50));

    // It should have executed at most once (or once initially and not re-triggered repeatedly when catalog is empty)
    expect(renderCount).toBeLessThanOrEqual(2);
    expect(window.WorkstreamMemoryEngine.getTopicMemoriesCatalog).toHaveBeenCalledTimes(1);
  });

  it('populates workstream tabs from settings.workstreams even if topic memories index is empty', () => {
    window.settings = {
      workstreams: [
        { id: 'ws-1', name: 'Product Launch', status: 'active' },
        { id: 'ws-2', name: 'Architecture & Security', status: 'active' }
      ]
    };
    const container = document.getElementById('team-panel');
    renderRegisterView(container);

    const tabs = Array.from(container.querySelectorAll('.workstream-tab-label')).map(el => el.textContent.trim());
    expect(tabs).toContain('Product Launch');
    expect(tabs).toContain('Architecture & Security');
  });

  it('createDemoVirtualDirectoryHandle provides raw/topic-memories index and dossiers', async () => {
    // If createDemoVirtualDirectoryHandle is already on global/window
    const getDemoHandle = window.createDemoVirtualDirectoryHandle || (() => {
      loadScriptsIntoGlobal([
        'js/app-state.js',
        'js/app-utils.js',
        'js/translations.js',
        'js/app-i18n.js',
        'js/app-bridge.js',
        'js/app-fs.js',
        'js/app-storage.js',
        'js/app-init.js'
      ]);
      return window.createDemoVirtualDirectoryHandle;
    })();

    const demoHandle = getDemoHandle();
    expect(demoHandle).toBeDefined();
    expect(demoHandle.name).toContain('Demo Workspace');
    
    // Check raw/topic-memories directory and files
    const rawDir = await demoHandle.getDirectoryHandle('raw');
    expect(rawDir).toBeDefined();
    const tmDir = await rawDir.getDirectoryHandle('topic-memories');
    expect(tmDir).toBeDefined();

    const indexHandle = await tmDir.getFileHandle('index.json');
    expect(indexHandle).toBeDefined();
    const indexFile = await indexHandle.getFile();
    const indexText = await indexFile.text();
    const indexParsed = JSON.parse(indexText);
    expect(Array.isArray(indexParsed.topics)).toBe(true);
    expect(indexParsed.topics.length).toBe(4);
    expect(indexParsed.topics.some(t => t.topicName === 'Product Launch')).toBe(true);

    const productHandle = await tmDir.getFileHandle('product_launch.json');
    expect(productHandle).toBeDefined();
    const productFile = await productHandle.getFile();
    const productData = JSON.parse(await productFile.text());
    expect(productData.topicName).toBe('Product Launch');
    expect(productData.keyFacts.length).toBeGreaterThan(0);
  });
});



