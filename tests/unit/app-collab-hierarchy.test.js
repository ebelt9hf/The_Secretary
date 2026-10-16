import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Colleague Map Hierarchy, Dedup, Top Boss, and Team Combobox', () => {
  beforeAll(() => {
    globalThis.window = globalThis;
    globalThis.document = window.document;
    globalThis.t = (key, params) => {
      const dict = {
        'team.topBossBadge': 'Top Leader',
        'team.bossPrefix': 'Boss: ' + (params?.name !== undefined ? params.name : ''),
        'team.noLeaderAssigned': 'No leader assigned',
        'team.noMatchingTeams': 'No matching teams found',
        'team.selectTeamPlaceholder': 'Select or search a team...',
        'team.selectTeamTooltip': 'Select a team for this colleague',
        'team.newTeamNamePrompt': 'New team name:',
        'team.managerLabel': 'Manager',
        'team.teamRole': 'Team',
        'team.assignToTeamTitle': 'Assign to a team',
        'editor.cancel': 'Cancel',
        'todo.save': 'Save'
      };
      return dict[key] !== undefined ? dict[key] : key;
    };
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.jq = (s) => JSON.stringify(s || '');
    globalThis.colorForGroup = () => ({ bg: '#3b82f6', text: '#ffffff' });
    globalThis.getAppSettingsRef = () => ({});
    globalThis.getCollaboratorRegistryState = () => ({ keys: [] });
    globalThis.setCollaboratorLabels = vi.fn();
    globalThis.openModal = vi.fn();
    globalThis.closeModal = vi.fn();
    globalThis.showCustomModal = vi.fn().mockResolvedValue(true);
    globalThis.renderTeamPanel = vi.fn();
    globalThis.renderBoard = vi.fn();
    globalThis.StorageAPI = {
      hasColleagues: vi.fn().mockResolvedValue(false),
      readColleagues: vi.fn().mockResolvedValue(null),
      writeColleagues: vi.fn().mockResolvedValue(true),
      getStorageEngine: vi.fn().mockReturnValue('local')
    };

    loadScriptsIntoGlobal([
      'js/app-state.js',
      'js/app-utils.js',
      'js/app-collab.js'
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.showPromptDialog = vi.fn().mockResolvedValue('Infrastructure Squad');
    document.body.innerHTML = `
      <div id="test-container"></div>
      <div id="modal-collab-details" style="display:none;">
        <div id="collab-details-modal-content"></div>
      </div>
    `;

    // 4-level organization setup:
    // Level 1: CEO Alice (manages team-exec)
    // Level 2: Bob VP (member of team-exec, manages team-eng), Sarah VP (member of team-exec)
    // Level 3: Charlie Lead (member of team-eng, manages team-core), David Lead (member of team-eng, manages team-frontend)
    // Level 4: Eve Dev (member of team-core), Frank Dev (member of team-frontend)
    globalThis.colleaguesDb = {
      version: 1,
      me: { id: 'me', label: 'CEO Alice', teamId: 'team-exec' },
      teams: [
        { id: 'team-exec', name: 'Executive Team', managerId: 'me' },
        { id: 'team-eng', name: 'Engineering Dept', managerId: 'col-vp-bob' },
        { id: 'team-core', name: 'Core Platform', managerId: 'col-lead-charlie' },
        { id: 'team-frontend', name: 'Frontend Team', managerId: 'col-lead-david' }
      ],
      colleagues: [
        { id: 'col-vp-bob', label: 'Bob VP', teamId: 'team-exec' },
        { id: 'col-vp-sarah', label: 'Sarah Product VP', teamId: 'team-exec' },
        { id: 'col-lead-charlie', label: 'Charlie Lead', teamId: 'team-eng' },
        { id: 'col-lead-david', label: 'David Lead', teamId: 'team-eng' },
        { id: 'col-dev-eve', label: 'Eve Dev', teamId: 'team-core' },
        { id: 'col-dev-frank', label: 'Frank Dev', teamId: 'team-frontend' }
      ]
    };

    globalThis.reindexColleaguesDb();
  });

  describe('Hierarchy & 4-Level Org Chart Dedup', () => {
    it('correctly identifies the top boss without virtual manager placed over them', () => {
      // 'me' (CEO Alice) manages team-exec, and has teamId: team-exec.
      // Her manager must be '' (no one above her), NOT 'virtual-manager-team-exec'.
      const ceoManager = globalThis.getColleagueManagerId('me');
      expect(ceoManager).toBe('');

      // Bob VP is member of team-exec, so reports to manager of team-exec ('me')
      const bobManager = globalThis.getColleagueManagerId('col-vp-bob');
      expect(bobManager).toBe('me');

      // Charlie Lead is manager of team-core, but member of team-eng. Manager of team-eng is Bob VP.
      const charlieManager = globalThis.getColleagueManagerId('col-lead-charlie');
      expect(charlieManager).toBe('col-vp-bob');

      // Eve Dev is member of team-core. Manager of team-core is Charlie Lead.
      const eveManager = globalThis.getColleagueManagerId('col-dev-eve');
      expect(eveManager).toBe('col-lead-charlie');
    });

    it('correctly identifies directs through the 4 levels', () => {
      // Directs of CEO: Bob VP and Sarah VP
      const ceoDirects = globalThis.getColleagueDirects('me');
      expect(ceoDirects.map(c => c.id).sort()).toEqual(['col-vp-bob', 'col-vp-sarah']);

      // Directs of Bob VP: Charlie Lead and David Lead
      const bobDirects = globalThis.getColleagueDirects('col-vp-bob');
      expect(bobDirects.map(c => c.id).sort()).toEqual(['col-lead-charlie', 'col-lead-david']);

      // Directs of Charlie Lead: Eve Dev
      const charlieDirects = globalThis.getColleagueDirects('col-lead-charlie');
      expect(charlieDirects.map(c => c.id)).toEqual(['col-dev-eve']);

      // Directs of Eve Dev: empty
      const eveDirects = globalThis.getColleagueDirects('col-dev-eve');
      expect(eveDirects).toEqual([]);
    });

    it('renders the complete org tree without duplicating any colleague', () => {
      const container = document.getElementById('test-container');
      globalThis.renderOrgView(container);

      // Verify CEO has the Top Leader badge rendered
      expect(container.textContent).toContain('Top Leader');
      expect(container.textContent).toContain('CEO Alice');

      // Check for node duplicates: each colleague card should appear exactly ONCE
      const allColleagueIds = ['me', 'col-vp-bob', 'col-vp-sarah', 'col-lead-charlie', 'col-lead-david', 'col-dev-eve', 'col-dev-frank'];
      for (const id of allColleagueIds) {
        const renderedCards = container.querySelectorAll(`[data-colleague-id="${id}"]`);
        expect(renderedCards.length).toBe(1);
      }

      // Verify no virtual manager node was rendered for the top team
      expect(container.textContent).not.toContain('Manager (Executive Team)');
    });

    it('only shows a team box when the node is actually the manager of that team', () => {
      // Eve Dev is an IC, not manager of any team
      const eveTeam = globalThis.getTeamManagedBy('col-dev-eve');
      expect(eveTeam).toBeNull();

      // Charlie Lead manages team-core
      const charlieTeam = globalThis.getTeamManagedBy('col-lead-charlie');
      expect(charlieTeam).toBeDefined();
      expect(charlieTeam.id).toBe('team-core');
    });
  });

  describe('Team Combobox Component', () => {
    it('highlights matching text with <strong> tags', () => {
      const res1 = globalThis.highlightTextMatch('Engineering Dept', 'eng');
      expect(res1).toContain('<strong');
      expect(res1).toContain('>Eng</strong>ineering Dept');

      const res2 = globalThis.highlightTextMatch('Platform Core', 'core');
      expect(res2).toContain('<strong');
      expect(res2).toContain('>Core</strong>');

      const resEmpty = globalThis.highlightTextMatch('Hello World', '');
      expect(resEmpty).toBe('Hello World');
    });

    it('resolves boss information for teams', () => {
      const execTeam = globalThis.colleaguesDb.teams.find(t => t.id === 'team-exec');
      const execBoss = globalThis.getTeamBossInfo(execTeam);
      expect(execBoss.hasBoss).toBe(true);
      expect(execBoss.label).toContain('CEO Alice');

      const noBossTeam = { id: 'team-empty', name: 'Empty Team', managerId: '' };
      const emptyBoss = globalThis.getTeamBossInfo(noBossTeam);
      expect(emptyBoss.hasBoss).toBe(false);
    });

    it('creates combobox element with search input and filters dynamically', () => {
      let selectedTeam = null;
      const combobox = globalThis.createTeamCombobox({
        currentTeamId: 'team-exec',
        onSelect: (id) => { selectedTeam = id; }
      });

      document.body.appendChild(combobox);

      const input = combobox.querySelector('.team-combobox-input');
      expect(input).toBeDefined();
      expect(input.value).toBe('Executive Team');

      // Focus opens dropdown
      input.dispatchEvent(new Event('focus'));
      const dropdown = combobox.querySelector('.team-combobox-dropdown');
      expect(dropdown.style.display).toBe('block');

      // Simulate typing query "plat"
      input.value = 'plat';
      input.dispatchEvent(new Event('input'));

      // Filtered items should show Core Platform
      const items = dropdown.querySelectorAll('.team-combobox-item');
      expect(items.length).toBe(1);
      expect(items[0].innerHTML).toContain('Plat');
      expect(items[0].textContent).toContain('Charlie Lead');

      // Click to select
      items[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(selectedTeam).toBe('team-core');
      expect(input.value).toBe('Core Platform');
      expect(dropdown.style.display).toBe('none');

      combobox.destroy();
      combobox.remove();
    });

    it('filters teams by boss name as well', () => {
      const combobox = globalThis.createTeamCombobox({
        currentTeamId: 'team-exec'
      });
      document.body.appendChild(combobox);

      const input = combobox.querySelector('.team-combobox-input');
      input.dispatchEvent(new Event('focus'));

      // Type "Bob"
      input.value = 'Bob';
      input.dispatchEvent(new Event('input'));

      const dropdown = combobox.querySelector('.team-combobox-dropdown');
      const items = dropdown.querySelectorAll('.team-combobox-item');
      expect(items.length).toBe(1);
      expect(items[0].textContent).toContain('Engineering Dept');
      expect(items[0].innerHTML).toContain('Bob');

      combobox.destroy();
      combobox.remove();
    });
  });

  describe('Colleague Modal and Team Creation Auto-Assign', () => {
    it('auto-assigns a newly created team to the colleague', async () => {
      // Open collaborator modal for Eve Dev
      globalThis.showCollaboratorModal('Eve Dev');

      const modalContent = document.getElementById('collab-details-modal-content');
      const mount = modalContent.querySelector('#collab-details-team-combobox-mount');
      expect(mount).toBeDefined();

      const createBtn = mount.querySelector('button.btn');
      expect(createBtn).toBeDefined();
      expect(createBtn.textContent).toBe('+');

      // Click create button
      await createBtn.click();

      // Check that a new team was added to colleaguesDb
      const newTeam = globalThis.colleaguesDb.teams.find(t => t.name === 'Infrastructure Squad');
      expect(newTeam).toBeDefined();

      // Check that Eve Dev was automatically assigned to the new team!
      const eve = globalThis.colleaguesDb.colleagues.find(c => c.id === 'col-dev-eve');
      expect(eve.teamId).toBe(newTeam.id);
    });
  });
});
