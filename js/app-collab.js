// ── Secretary: Collaborative & Backlinks Features ──

let collaborativeDataCache = {}; // path -> { modified, decisions: [], mentions: [], delegations: [] }
let collaboratorsMap = {};       // name -> { agenda: [], delegations: [] }
let decisionsList = [];          // list of { text, noteId, noteTitle, notePath, date }
let activeCollabSubTab = 'registry'; // 'registry', 'waiting', or 'collaborator:[name]'
let collabSearchQuery = '';
let activeCollabView = 'org';
let selectedRegistryProject = '';
let expandedCollaborators = new Set();
let collabManagerSelection = new Set();
let teamManagerPaneOpen = true;
let decisionProjectsPaneOpen = true;
let _teamTodosLoadingRefreshTimer = null;
let activeTeamGroupTab = '__all__';
let activeTeamManagerTab = 'collaborators';
let teamPlannerPaneOpen = true;
let teamGroupInputMode = null; // null | 'create' | `rename:<groupId>`
let teamGroupInputValue = '';
let teamTabDragGroupId = null;
let teamGroupManagerDragId = null;
const REGISTRY_ALL_PROJECTS_KEY = '__all__';

const COLLEAGUES_DB_PATH = 'colleagues.json';
const COLLEAGUES_MIGRATION_MARKER_PATH = '.secretary/colleagues-migration-v1.done';
let _colleaguesSaveTimer = null;

try { teamManagerPaneOpen = (localStorage.getItem('secretaryTeamManagerPaneOpen') || '1') === '1'; } catch(e) {}
try { decisionProjectsPaneOpen = (localStorage.getItem('secretaryDecisionProjectsPaneOpen') || '1') === '1'; } catch(e) {}
try { teamPlannerPaneOpen = (localStorage.getItem('secretaryTeamPlannerPaneOpen') || '1') === '1'; } catch(e) {}

function refreshDecisionListFromMetadataIfAvailable() {
  if (typeof hasMetadataDecisionCoverage !== 'function' || typeof getAllMetadataDecisionEntries !== 'function') return false;
  if (!hasMetadataDecisionCoverage()) return false;
  decisionsList = getAllMetadataDecisionEntries();
  return true;
}

function toggleTeamManagerPane() {
  teamManagerPaneOpen = !teamManagerPaneOpen;
  try { localStorage.setItem('secretaryTeamManagerPaneOpen', teamManagerPaneOpen ? '1' : '0'); } catch(e) {}
  renderTeamPanel();
}

function toggleDecisionProjectsPane() {
  decisionProjectsPaneOpen = !decisionProjectsPaneOpen;
  try { localStorage.setItem('secretaryDecisionProjectsPaneOpen', decisionProjectsPaneOpen ? '1' : '0'); } catch(e) {}
  renderTeamPanel();
}

function toggleTeamPlannerPane() {
  teamPlannerPaneOpen = !teamPlannerPaneOpen;
  try { localStorage.setItem('secretaryTeamPlannerPaneOpen', teamPlannerPaneOpen ? '1' : '0'); } catch(e) {}
  renderTeamPanel();
}

function isTodoDataStillHydrating() {
  return todosLoadState === 'loading' || todosLoadState === 'partial';
}

function scheduleTeamTodosLoadingRefresh() {
  if (_teamTodosLoadingRefreshTimer) return;
  if (activeTab !== 'team') return;
  if (!isTodoDataStillHydrating()) return;
  _teamTodosLoadingRefreshTimer = setTimeout(() => {
    _teamTodosLoadingRefreshTimer = null;
    if (activeTab === 'team' && isTodoDataStillHydrating()) {
      renderTeamPanel();
    }
  }, 700);
}

function normalizeCollaboratorKey(name) {
  return (name || '').trim().toLowerCase();
}

function getDefaultMeLabel() {
  const username = (settings && typeof settings.username === 'string') ? settings.username.trim() : '';
  return username || 'Me';
}

function normalizeColleagueLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toColleagueSlug(value) {
  const base = normalizeColleagueLabel(value).toLowerCase();
  const cleaned = base
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'colleague';
}

function generateColleagueId(label = '') {
  const slug = toColleagueSlug(label);
  return `col-${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

function looksLikeSyntheticColleagueToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/^col-[a-z0-9-]+$/i.test(raw)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) return true;
  if (/^\d+$/.test(raw)) return true;
  return false;
}

function _colleagueLabelScore(label) {
  const text = String(label || '').trim();
  if (!text) return -1000;
  let score = 0;
  if (!looksLikeSyntheticColleagueToken(text)) score += 100;
  if (/[A-Z]/.test(text)) score += 10;
  if (/\s/.test(text)) score += 2;
  score -= Math.max(0, text.length - 24) * 0.2;
  return score;
}

function pickPreferredColleagueLabel(existing, candidate) {
  const a = normalizeColleagueLabel(existing);
  const b = normalizeColleagueLabel(candidate);
  if (!a) return b;
  if (!b) return a;
  const sa = _colleagueLabelScore(a);
  const sb = _colleagueLabelScore(b);
  if (sb > sa) return b;
  if (sa > sb) return a;
  return b.length < a.length ? b : a;
}

function scheduleColleaguesDbSave() {
  const isStorageReady = Boolean((typeof rootHandle !== 'undefined' && rootHandle) || (typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase'));
  if (!isStorageReady) return;
  if (_colleaguesSaveTimer) return;
  _colleaguesSaveTimer = setTimeout(async () => {
    _colleaguesSaveTimer = null;
    try {
      await saveColleaguesDb();
    } catch (e) {
      console.warn('Could not persist colleagues DB', e);
    }
  }, 120);
}

function ensureColleaguesDbShape(raw) {
  const meLabel = getDefaultMeLabel();
  const base = (raw && typeof raw === 'object') ? raw : {};
  const next = {
    version: 1,
    me: {
      id: 'me',
      label: normalizeColleagueLabel(base.me && base.me.label ? base.me.label : meLabel) || meLabel,
      teamId: base.me && base.me.teamId ? String(base.me.teamId).trim() : 'team-my-own-team',
    },
    colleagues: [],
    teams: Array.isArray(base.teams) ? base.teams.map(t => ({
      id: String(t.id).trim(),
      name: String(t.name).trim(),
      managerId: String(t.managerId || '').trim()
    })) : []
  };

  const seen = new Set(['me']);
  const incoming = Array.isArray(base.colleagues) ? base.colleagues : [];
  incoming.forEach(item => {
    if (!item || typeof item !== 'object') return;
    let id = String(item.id || '').trim();
    const label = normalizeColleagueLabel(item.label || item.name || '');
    if (!label) return;
    if (!id || id === 'me') id = generateColleagueId(label);
    if (seen.has(id)) return;
    seen.add(id);
    next.colleagues.push({
      id,
      label,
      teamId: item.teamId ? String(item.teamId).trim() : 'team-other-bucket'
    });
  });

  // Ensure default teams
  if (!next.teams.some(t => t.id === 'team-my-team')) {
    next.teams.push({ id: 'team-my-team', name: 'My Directs', managerId: 'me' });
  }
  if (!next.teams.some(t => t.id === 'team-my-own-team')) {
    next.teams.push({ id: 'team-my-own-team', name: 'My Peers', managerId: '' });
  }
  if (!next.teams.some(t => t.id === 'team-other-bucket')) {
    next.teams.push({ id: 'team-other-bucket', name: 'Other colleagues', managerId: '' });
  }

  // Force other bucket to never have a manager
  next.teams.forEach(t => {
    if (t.id === 'team-other-bucket') {
      t.managerId = '';
    }
  });

  // Force all colleagues to have a teamId, falling back to 'team-other-bucket'
  next.colleagues.forEach(c => {
    if (!c.teamId || !next.teams.some(t => t.id === c.teamId)) {
      c.teamId = 'team-other-bucket';
    }
  });

  next.colleagues.sort((a, b) => a.label.localeCompare(b.label));
  return next;
}

function getTeamDisplayName(teamOrId) {
  if (!teamOrId) return '';
  if (!colleaguesDb || !Array.isArray(colleaguesDb.teams)) {
    return typeof teamOrId === 'string' ? teamOrId : (teamOrId.name || '');
  }
  const team = typeof teamOrId === 'string' ? colleaguesDb.teams.find(t => t.id === teamOrId) : teamOrId;
  if (!team) return typeof teamOrId === 'string' ? teamOrId : '';
  
  const name = team.name || '';
  const nameLower = name.trim().toLowerCase();
  
  if (team.id === 'team-my-team' && (nameLower === 'my directs' || nameLower === 'my team' || nameLower === 'mon équipe' || nameLower === 'mes directs')) {
    return t('team.myDirects') || name;
  }
  if (team.id === 'team-my-own-team' && (nameLower === 'my peers' || nameLower === 'my own team' || nameLower === 'mes pairs' || nameLower === 'mes collègues')) {
    return t('team.myPeers') || name;
  }
  if (team.id === 'team-other-bucket' && (nameLower === 'other colleagues' || nameLower === 'other' || nameLower === 'autres collègues' || nameLower === 'autre')) {
    return t('team.otherColleagues') || name;
  }
  return name;
}

function reindexColleaguesDb() {
  if (!colleaguesDb || typeof colleaguesDb !== 'object') {
    colleaguesDb = ensureColleaguesDbShape(null);
  }
  colleaguesById = new Map();
  colleaguesByNormLabel = new Map();

  // Ensure default teams exist on colleaguesDb.teams
  if (!colleaguesDb.teams) colleaguesDb.teams = [];
  if (!colleaguesDb.teams.some(t => t.id === 'team-my-team')) {
    colleaguesDb.teams.push({ id: 'team-my-team', name: 'My Directs', managerId: 'me' });
  }
  if (!colleaguesDb.teams.some(t => t.id === 'team-my-own-team')) {
    colleaguesDb.teams.push({ id: 'team-my-own-team', name: 'My Peers', managerId: '' });
  }
  if (!colleaguesDb.teams.some(t => t.id === 'team-other-bucket')) {
    colleaguesDb.teams.push({ id: 'team-other-bucket', name: 'Other colleagues', managerId: '' });
  }

  // Force other bucket to never have a manager
  colleaguesDb.teams.forEach(t => {
    if (t.id === 'team-other-bucket') {
      t.managerId = '';
    }
  });

  const meRecord = {
    id: 'me',
    label: normalizeColleagueLabel(colleaguesDb.me && colleaguesDb.me.label ? colleaguesDb.me.label : getDefaultMeLabel()) || getDefaultMeLabel(),
    teamId: colleaguesDb.me && colleaguesDb.me.teamId ? String(colleaguesDb.me.teamId).trim() : 'team-my-own-team',
    role: colleaguesDb.me && colleaguesDb.me.role ? String(colleaguesDb.me.role).trim() : '',
    managerId: colleaguesDb.me && colleaguesDb.me.managerId ? String(colleaguesDb.me.managerId).trim() : '',
    reportsTo: colleaguesDb.me && colleaguesDb.me.reportsTo ? String(colleaguesDb.me.reportsTo).trim() : '',
    isManager: colleaguesDb.me && colleaguesDb.me.isManager !== undefined ? !!colleaguesDb.me.isManager : false
  };
  colleaguesDb.me = meRecord;
  colleaguesById.set('me', meRecord);
  colleaguesByNormLabel.set(normalizeCollaboratorKey(meRecord.label), meRecord);
  colleaguesByNormLabel.set('me', meRecord);

  const clean = [];
  const seen = new Set(['me']);
  (Array.isArray(colleaguesDb.colleagues) ? colleaguesDb.colleagues : []).forEach(item => {
    if (!item || typeof item !== 'object') return;
    const id = String(item.id || '').trim();
    const label = normalizeColleagueLabel(item.label || '');
    if (!id || !label || seen.has(id)) return;
    seen.add(id);
    const rec = {
      id,
      label,
      teamId: item.teamId ? String(item.teamId).trim() : 'team-other-bucket',
      role: item.role ? String(item.role).trim() : '',
      managerId: item.managerId ? String(item.managerId).trim() : '',
      reportsTo: item.reportsTo ? String(item.reportsTo).trim() : '',
      isManager: item.isManager !== undefined ? !!item.isManager : false
    };
    clean.push(rec);
    colleaguesById.set(id, rec);
    colleaguesByNormLabel.set(normalizeCollaboratorKey(label), rec);
  });
  clean.sort((a, b) => a.label.localeCompare(b.label));
  colleaguesDb.colleagues = clean;
}

// ── Hierarchy Helper Functions ──
function getColleagueManagerId(colleagueId) {
  if (!colleaguesDb) return '';
  const id = colleagueId || 'me';
  const rec = colleaguesById.get(id);
  if (!rec) return '';
  
  // 1. Explicit managerId / reportsTo directly on the colleague record
  if (rec.managerId && rec.managerId !== id) return rec.managerId;
  if (rec.reportsTo) {
    const resolvedId = resolveColleagueId(rec.reportsTo, { allowCreate: false, allowMe: true });
    if (resolvedId && resolvedId !== id) return resolvedId;
  }
  
  // 2. Fallback to team manager (excluding reporting to oneself)
  if (!rec.teamId) return '';
  const team = colleaguesDb.teams.find(t => t.id === rec.teamId);
  if (team) {
    if (team.managerId && team.managerId !== id) return team.managerId;
    if (team.id === 'team-other-bucket') return '';
    return 'virtual-manager-' + team.id;
  }
  return '';
}

function getColleagueManagerChain(colleagueId) {
  const chain = [];
  const visited = new Set();
  let current = colleagueId || 'me';
  while (current) {
    visited.add(current);
    const mgrId = getColleagueManagerId(current);
    if (!mgrId || visited.has(mgrId)) {
      break;
    }
    if (!mgrId.startsWith('virtual-manager-')) {
      chain.push(mgrId);
    }
    current = mgrId;
  }
  return chain;
}

function getColleaguePeers(colleagueId) {
  if (!colleaguesDb) return [];
  const id = colleagueId || 'me';
  const rec = colleaguesById.get(id);
  if (!rec || !rec.teamId) return [];
  const teamId = rec.teamId;
  
  const allMembers = [];
  if (colleaguesDb.me.teamId === teamId) allMembers.push(colleaguesDb.me);
  colleaguesDb.colleagues.forEach(c => {
    if (c.teamId === teamId) allMembers.push(c);
  });
  
  return allMembers.filter(m => m.id !== id);
}

function getColleagueDirects(colleagueId) {
  if (!colleaguesDb) return [];
  const id = colleagueId || 'me';
  
  if (typeof id === 'string' && id.startsWith('virtual-manager-')) {
    const teamId = id.substring('virtual-manager-'.length);
    const directs = [];
    if (colleaguesDb.me.teamId === teamId) directs.push(colleaguesDb.me);
    colleaguesDb.colleagues.forEach(c => {
      if (c.teamId === teamId) directs.push(c);
    });
    return directs;
  }
  
  const managedTeams = colleaguesDb.teams.filter(t => t.managerId === id);
  if (managedTeams.length === 0) return [];
  const managedTeamIds = new Set(managedTeams.map(t => t.id));
  
  const directs = [];
  if (managedTeamIds.has(colleaguesDb.me.teamId)) directs.push(colleaguesDb.me);
  colleaguesDb.colleagues.forEach(c => {
    if (managedTeamIds.has(c.teamId)) directs.push(c);
  });
  return directs.filter(d => d.id !== id);
}

function isColleagueImportant(colleagueId) {
  if (!colleagueId) return false;
  const rec = colleaguesById.get(colleagueId);
  const name = rec ? rec.label : colleagueId;
  
  // 1. Check if tagged with "VIP" or "Important" (case-insensitive)
  const labels = typeof getCollaboratorLabels === 'function' ? getCollaboratorLabels(name) : [];
  const hasVipTag = labels.some(l => {
    const cleanL = String(l || '').trim().toLowerCase();
    return cleanL === 'vip' || cleanL === 'important';
  });
  if (hasVipTag) return true;
  
  // 2. Check if in direct manager chain of the user "me"
  const chain = getColleagueManagerChain('me');
  if (chain.includes(colleagueId)) return true;
  
  return false;
}

function getUltimateManagerId(colleagueId) {
  const id = colleagueId || 'me';
  const chain = getColleagueManagerChain(id);
  if (chain.length === 0) {
    const mgrId = getColleagueManagerId(id);
    if (mgrId && mgrId.startsWith('virtual-manager-')) {
      return mgrId;
    }
    return id;
  }
  return chain[chain.length - 1];
}

function getAllColleagueRecords(options = {}) {
  const includeMe = options.includeMe !== false;
  const includeHidden = options.includeHidden === true;
  if (!colleaguesDb) {
    colleaguesDb = ensureColleaguesDbShape(null);
    reindexColleaguesDb();
  }
  const out = [];
  if (includeMe) out.push({ id: 'me', label: colleaguesDb.me.label });
  colleaguesDb.colleagues.forEach(rec => out.push({ id: rec.id, label: rec.label }));
  if (!includeHidden && typeof isCollaboratorHidden === 'function') {
    return out.filter(rec => rec.id === 'me' || !isCollaboratorHidden(rec.label));
  }
  return out;
}

function normalizePlannerCollaboratorIds(values, options = {}) {
  const allowCreate = options.allowCreate === true;
  const source = Array.isArray(values) ? values : [];
  return Array.from(new Set(source
    .map(value => resolveColleagueId(value, { allowCreate, allowMe: false }))
    .filter(Boolean)
    .filter(id => id !== 'me')));
}

function pruneUnusedAutoCreatedColleagues() {
  if (!colleaguesDb || !Array.isArray(colleaguesDb.colleagues)) return false;

  const usedIds = new Set();
  const usedLabels = new Set();

  // 1. Planner events
  if (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) {
    plannerEvents.forEach(e => {
      (Array.isArray(e.collaboratorIds) ? e.collaboratorIds : []).forEach(id => {
        if (id) usedIds.add(String(id).trim());
      });
      (Array.isArray(e.collaborators) ? e.collaborators : []).forEach(c => {
        if (c) usedLabels.add(String(c).trim().toLowerCase());
      });
    });
  }

  // 2. Manifest notes
  if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
    manifest.forEach(n => {
      (Array.isArray(n.topic_tags) ? n.topic_tags : []).forEach(t => {
        if (t) {
          usedIds.add(String(t).trim());
          usedLabels.add(String(t).trim().toLowerCase());
        }
      });
    });
  }

  // 3. Todos
  if (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) {
    todosManifest.forEach(t => {
      if (t.assignee) {
        usedIds.add(String(t.assignee).trim());
        usedLabels.add(String(t.assignee).trim().toLowerCase());
      }
      if (t.delegatedTo) {
        usedIds.add(String(t.delegatedTo).trim());
        usedLabels.add(String(t.delegatedTo).trim().toLowerCase());
      }
    });
  }

  // 4. Teams & managers
  if (Array.isArray(colleaguesDb.teams)) {
    colleaguesDb.teams.forEach(team => {
      if (team.managerId) usedIds.add(String(team.managerId).trim());
    });
  }

  let modified = false;
  colleaguesDb.colleagues = colleaguesDb.colleagues.filter(col => {
    if (!col || !col.id) return false;
    // Preserve any colleague who has custom configured metadata (role, custom team, bio, email, avatar, etc.)
    const hasCustomMetadata = Boolean(
      (col.role && String(col.role).trim()) ||
      (col.teamId && String(col.teamId).trim() && col.teamId !== 'team-my-own-team') ||
      (col.email && String(col.email).trim()) ||
      (col.bio && String(col.bio).trim()) ||
      (col.managerId && String(col.managerId).trim()) ||
      (col.avatar && String(col.avatar).trim())
    );
    if (hasCustomMetadata) return true;

    const id = String(col.id).trim();
    const label = String(col.label || '').trim().toLowerCase();
    const isUsed = usedIds.has(id) || (label && usedLabels.has(label));
    if (!isUsed) {
      modified = true;
      return false;
    }
    return true;
  });

  if (modified) {
    reindexColleaguesDb();
    scheduleColleaguesDbSave();
  }
  return modified;
}
window.pruneUnusedAutoCreatedColleagues = pruneUnusedAutoCreatedColleagues;

function getPlannerCollaboratorLabelsByIds(ids) {
  return normalizePlannerCollaboratorIds(ids, { allowCreate: false })
    .map(id => getColleagueLabelById(id, ''))
    .filter(Boolean);
}

function getColleagueLabelById(id, fallback = '') {
  const cleanId = String(id || '').trim();
  if (!cleanId) return fallback;
  if (!colleaguesById || !(colleaguesById instanceof Map) || colleaguesById.size === 0) {
    reindexColleaguesDb();
  }
  return (colleaguesById.get(cleanId) || {}).label || fallback;
}

function resolveColleagueId(value, options = {}) {
  const allowCreate = options.allowCreate === true;
  const allowMe = options.allowMe !== false;
  const raw = String(value || '').trim();
  if (!raw) return allowMe ? 'me' : '';

  if (!colleaguesDb) {
    colleaguesDb = ensureColleaguesDbShape(null);
    reindexColleaguesDb();
  }

  if (raw === 'me') return allowMe ? 'me' : '';
  if (colleaguesById && colleaguesById.has(raw)) return raw;

  const key = raw.toLowerCase();
  const byLabel = colleaguesByNormLabel && colleaguesByNormLabel.get(key);
  if (byLabel) {
    if (byLabel.id === 'me' && !allowMe) return '';
    return byLabel.id;
  }

  // Legacy alias fallback: map historical names to canonical colleague labels.
  if (typeof getCollaboratorAliasMap === 'function') {
    const aliases = getCollaboratorAliasMap();
    const aliasTarget = normalizeColleagueLabel((aliases && aliases[key]) || '');
    if (aliasTarget) {
      const aliasRec = colleaguesByNormLabel && colleaguesByNormLabel.get(aliasTarget.toLowerCase());
      if (aliasRec) {
        if (aliasRec.id === 'me' && !allowMe) return '';
        return aliasRec.id;
      }
    }
  }

  if (allowMe && isUserCollaborator(raw)) return 'me';
  if (!allowCreate) return '';

  const label = normalizeColleagueLabel(raw);
  if (!label) return allowMe ? 'me' : '';
  const id = generateColleagueId(label);
  colleaguesDb.colleagues.push({ id, label });
  colleaguesDb.colleagues.sort((a, b) => a.label.localeCompare(b.label));
  reindexColleaguesDb();
  scheduleColleaguesDbSave();
  return id;
}

function buildCanonicalColleagueSet() {
  const canonicalByKey = new Map();
  const idRemap = new Map();
  const canonical = [];

  (Array.isArray(colleaguesDb?.colleagues) ? colleaguesDb.colleagues : []).forEach(item => {
    if (!item || typeof item !== 'object') return;
    const id = String(item.id || '').trim();
    const label = normalizeColleagueLabel(item.label || '');
    if (!id || !label || id === 'me') return;

    const key = normalizeCollaboratorKey(label);
    if (!key || key === 'me') {
      idRemap.set(id, 'me');
      return;
    }

    const existing = canonicalByKey.get(key);
    if (!existing) {
      const rec = { 
        id, 
        label, 
        teamId: item.teamId ? String(item.teamId).trim() : 'team-other-bucket' 
      };
      canonicalByKey.set(key, rec);
      canonical.push(rec);
      idRemap.set(id, id);
      return;
    }

    existing.label = pickPreferredColleagueLabel(existing.label, label);
    if (item.teamId && item.teamId !== 'team-other-bucket') {
      existing.teamId = String(item.teamId).trim();
    }
    idRemap.set(id, existing.id);
  });

  canonical.sort((a, b) => a.label.localeCompare(b.label));
  return { canonical, idRemap };
}

async function dedupeColleaguesWorkspaceData(options = {}) {
  const persist = options.persist !== false;
  if (!colleaguesDb || typeof colleaguesDb !== 'object') return false;

  const { canonical, idRemap } = buildCanonicalColleagueSet();
  const prevColleagues = Array.isArray(colleaguesDb.colleagues) ? colleaguesDb.colleagues : [];
  const dbChanged = prevColleagues.length !== canonical.length
    || prevColleagues.some((rec, idx) => !canonical[idx] || rec.id !== canonical[idx].id || rec.label !== canonical[idx].label || rec.teamId !== canonical[idx].teamId);

  colleaguesDb.colleagues = canonical;
  reindexColleaguesDb();

  let todosChanged = false;
  if (Array.isArray(todosManifest)) {
    todosManifest.forEach(todo => {
      if (!todo || typeof todo !== 'object') return;
      const currentOwnerId = resolveColleagueId(todo.ownerId || todo.owner || 'me', { allowCreate: false, allowMe: true }) || 'me';
      const mappedOwnerId = idRemap.get(currentOwnerId) || currentOwnerId || 'me';
      const ownerLabel = getColleagueLabelById(mappedOwnerId, mappedOwnerId === 'me' ? getDefaultMeLabel() : String(todo.owner || '').trim());
      if (todo.ownerId !== mappedOwnerId) {
        todo.ownerId = mappedOwnerId;
        todosChanged = true;
      }
      if (todo.owner !== ownerLabel) {
        todo.owner = ownerLabel;
        todosChanged = true;
      }
    });
  }

  let plannerChanged = false;
  if (Array.isArray(plannerEvents)) {
    plannerEvents.forEach(event => {
      if (!event || typeof event !== 'object') return;
      const sourceIds = [];
      if (Array.isArray(event.collaboratorIds)) sourceIds.push(...event.collaboratorIds);
      if (Array.isArray(event.collaborators)) {
        event.collaborators.forEach(name => {
          const id = resolveColleagueId(name, { allowCreate: false, allowMe: false });
          if (id) sourceIds.push(id);
        });
      }

      const nextIds = Array.from(new Set(sourceIds
        .map(id => String(id || '').trim())
        .filter(Boolean)
        .map(id => idRemap.get(id) || id)
        .filter(id => id !== 'me' && !!getColleagueLabelById(id, ''))));
      const nextNames = nextIds
        .map(id => getColleagueLabelById(id, ''))
        .filter(Boolean);

      const prevIds = Array.isArray(event.collaboratorIds) ? event.collaboratorIds : [];
      const prevNames = Array.isArray(event.collaborators) ? event.collaborators : [];
      if (prevIds.length !== nextIds.length || prevIds.some((id, idx) => id !== nextIds[idx])) {
        event.collaboratorIds = nextIds;
        plannerChanged = true;
      }
      if (prevNames.length !== nextNames.length || prevNames.some((name, idx) => name !== nextNames[idx])) {
        event.collaborators = nextNames;
        plannerChanged = true;
      }
    });
  }

  if (!persist) return dbChanged || todosChanged || plannerChanged;

  if (dbChanged || todosChanged || plannerChanged) {
    await saveColleaguesDb();
  }
  if (todosChanged && typeof saveTodosManifest === 'function') {
    await saveTodosManifest();
  }
  if (plannerChanged && typeof savePlanner === 'function') {
    await savePlanner();
  }
  return dbChanged || todosChanged || plannerChanged;
}

async function saveColleaguesDb() {
  const isStorageReady = Boolean((typeof rootHandle !== 'undefined' && rootHandle) || (typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase'));
  if (!isStorageReady) return;
  if (!colleaguesDb) {
    colleaguesDb = ensureColleaguesDbShape(null);
  }
  reindexColleaguesDb();
  await StorageAPI.writeColleagues(colleaguesDb);
  if (typeof broadcastSync === 'function') {
    broadcastSync({ type: 'COLLEAGUES_UPDATED' });
  }
}

function mergeLegacyCollaboratorsIntoDb() {
  return false;
}

async function loadColleaguesDb() {
  colleaguesLoadState = 'loading';
  const meLabel = getDefaultMeLabel();
  const isStorageReady = Boolean((typeof rootHandle !== 'undefined' && rootHandle) || (typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase'));

  if (!isStorageReady) {
    colleaguesDb = ensureColleaguesDbShape({ me: { id: 'me', label: meLabel } });
    reindexColleaguesDb();
    colleaguesLoadState = 'ready';
    return colleaguesDb;
  }

  let raw = null;
  try {
    if (await StorageAPI.hasColleagues()) {
      raw = await StorageAPI.readColleagues();
    }
  } catch (e) {
    console.warn('Could not read colleagues DB, rebuilding', e);
  }

  colleaguesDb = ensureColleaguesDbShape(raw);
  if (settings && typeof settings.username === 'string') {
    colleaguesDb.me.label = meLabel;
  }
  reindexColleaguesDb();
  const changed = mergeLegacyCollaboratorsIntoDb();
  if (!raw || changed) {
    await saveColleaguesDb();
  }
  colleaguesLoadState = 'ready';
  return colleaguesDb;
}

async function migrateCollaboratorReferencesToIds() {
  let todosChanged = false;
  let plannerChanged = false;

  if (Array.isArray(todosManifest)) {
    todosManifest.forEach(todo => {
      if (!todo || typeof todo !== 'object') return;
      const nextOwnerId = resolveColleagueId(todo.ownerId || todo.owner || 'me', { allowCreate: false, allowMe: true }) || 'me';
      const nextOwner = getColleagueLabelById(nextOwnerId, nextOwnerId === 'me' ? getDefaultMeLabel() : (todo.owner || ''));
      if (todo.ownerId !== nextOwnerId) {
        todo.ownerId = nextOwnerId;
        todosChanged = true;
      }
      if (todo.owner !== nextOwner) {
        todo.owner = nextOwner;
        todosChanged = true;
      }
    });
  }

  if (Array.isArray(plannerEvents)) {
    plannerEvents.forEach(event => {
      if (!event || typeof event !== 'object') return;
      const source = [];
      if (Array.isArray(event.collaboratorIds)) source.push(...event.collaboratorIds);
      if (Array.isArray(event.collaborators)) source.push(...event.collaborators);
      const nextIds = Array.from(new Set(source
        .map(value => resolveColleagueId(value, { allowCreate: false, allowMe: false }))
        .filter(Boolean)));
      const nextNames = nextIds
        .map(id => getColleagueLabelById(id, ''))
        .filter(Boolean);
      const prevIds = Array.isArray(event.collaboratorIds) ? event.collaboratorIds : [];
      const prevNames = Array.isArray(event.collaborators) ? event.collaborators : [];
      if (prevIds.length !== nextIds.length || prevIds.some((id, i) => id !== nextIds[i])) {
        event.collaboratorIds = nextIds;
        plannerChanged = true;
      }
      if (prevNames.length !== nextNames.length || prevNames.some((name, i) => name !== nextNames[i])) {
        event.collaborators = nextNames;
        plannerChanged = true;
      }
    });
  }

  if (todosChanged && typeof saveTodosManifest === 'function') {
    await saveTodosManifest();
  }
  if (plannerChanged && typeof savePlanner === 'function') {
    await savePlanner();
  }
  if (todosChanged || plannerChanged) {
    await saveColleaguesDb();
  }
}

async function ensureColleaguesWorkspaceReady() {
  await loadColleaguesDb();
  await dedupeColleaguesWorkspaceData();

  const isStorageReady = Boolean((typeof rootHandle !== 'undefined' && rootHandle) || (typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase'));
  if (!isStorageReady) return;
  let hasMarker = false;
  try {
    hasMarker = await StorageAPI.hasColleaguesMigration();
  } catch (e) {
    hasMarker = false;
  }

  if (!hasMarker) {
    await migrateCollaboratorReferencesToIds();
    await dedupeColleaguesWorkspaceData();
    try {
      await StorageAPI.writeColleaguesMigration({ version: 1, doneAt: new Date().toISOString() });
    } catch (e) {
      console.warn('Could not persist colleagues migration marker', e);
    }
  }
}

function getAppSettingsRef() {
  let base = null;
  try {
    if (typeof settings !== 'undefined' && settings && typeof settings === 'object') {
      base = settings;
    }
  } catch (e) {
    // Ignore and fallback to window settings.
  }
  if (!base) {
    if (!window.settings || typeof window.settings !== 'object') window.settings = {};
    base = window.settings;
  }
  window.settings = base;
  return base;
}

function extractPlannerCollaborators(event) {
  if (!event || typeof event !== 'object') return [];
  const names = new Set();

  const addName = (value) => {
    if (!value) return;
    const clean = String(value).trim();
    if (!clean || isUserCollaborator(clean)) return;
    names.add(getCollaboratorDisplayName(clean));
  };

  if (Array.isArray(event.collaborators)) {
    event.collaborators.forEach(addName);
  } else if (typeof event.collaborators === 'string') {
    event.collaborators
      .split(/[;,/|]/)
      .map(x => x.trim())
      .forEach(addName);
  }

  if (names.size === 0 && event.type === 'sync' && typeof event.title === 'string' && /[;,/|]/.test(event.title)) {
    event.title
      .split(/[;,/|]/)
      .map(x => x.trim())
      .forEach(addName);
  }

  if (names.size === 0 && event.noteId && Array.isArray(manifest)) {
    const linkedNote = manifest.find(n => n && n.id === event.noteId);
    const isSyncNote = linkedNote && Array.isArray(linkedNote.group_tags)
      ? linkedNote.group_tags.some(g => (g || '').toLowerCase() === 'sync')
      : false;
    if (isSyncNote && Array.isArray(linkedNote.topic_tags)) {
      linkedNote.topic_tags.forEach(addName);
    }
  }

  return Array.from(names);
}

function comparePlannerEventsByStart(a, b) {
  return (a.date || '').localeCompare(b.date || '') || (a.startTime || '').localeCompare(b.startTime || '');
}

function getUpcomingCollaboratorPlannerEvents(name, options = {}) {
  const key = normalizeCollaboratorKey(name);
  if (!key) return [];
  const syncOnly = options.syncOnly === true;
  const todayStr = options.fromDate || formatLocalDateValue(new Date());
  if (!Array.isArray(plannerEvents)) return [];

  return plannerEvents
    .filter(e => {
      if (!e || !e.date || e.date < todayStr) return false;
      const isCollab = extractPlannerCollaborators(e).some(c => normalizeCollaboratorKey(c) === key);
      if (!isCollab) return false;
      if (syncOnly) return (e.type || '').toLowerCase() === 'sync';
      return true;
    })
    .sort(comparePlannerEventsByStart);
}

function getPlannerSeriesInfo(event) {
  if (!event || !event.recurrenceId || !Array.isArray(plannerEvents)) return null;
  const all = plannerEvents
    .filter(e => e && e.recurrenceId === event.recurrenceId)
    .sort(comparePlannerEventsByStart);
  if (all.length === 0) return null;

  const todayStr = formatLocalDateValue(new Date());
  const upcoming = all.filter(e => e.date >= todayStr);

  let cadence = '';
  if (all.length >= 2) {
    const d1 = new Date(`${all[0].date}T00:00:00`);
    const d2 = new Date(`${all[1].date}T00:00:00`);
    const dayDiff = Math.round((d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000));
    if (dayDiff === 7) cadence = t('team.cadenceEveryWeek');
    else if (dayDiff === 14) cadence = t('team.cadenceEvery2Weeks');
    else if (dayDiff === 1) cadence = t('team.cadenceEveryDay');
    else if (dayDiff > 1) cadence = t('team.cadenceEveryNDays', { count: dayDiff });
  }

  return {
    upcomingCount: upcoming.length,
    totalCount: all.length,
    cadence
  };
}

function getPlannerEventLinkedNote(event) {
  if (!event || (typeof manifest === 'undefined' || !Array.isArray(manifest))) return null;
  if (typeof getPlannerEventLinkedNoteIds === 'function') {
    const ids = getPlannerEventLinkedNoteIds(event);
    if (!ids.length) return null;
    return manifest.find(n => n && ids.includes(n.id)) || null;
  }
  return manifest.find(n => n && n.id === event.noteId) || null;
}

function openNoteFromCollaborator(path, collaboratorName = '') {
  if (!path) return;
  window._collabReturnContext = {
    restore: true,
    collaboratorName: collaboratorName || '',
    collabView: activeCollabView || 'team'
  };
  openNoteOverlay(path);
}

function assignTaskToCollaborator(name, options = {}) {
  if (options.closeModalFirst) closeModal('modal-collab-details');
  if (typeof window.openNewTodoForOwner === 'function') {
    window.openNewTodoForOwner(name, { priority: 'Q1', focusTitle: true });
    return;
  }
  if (typeof showNewTodo === 'function') showNewTodo();
}

function getCollaboratorAliasMap() {
  const settingsRef = getAppSettingsRef();
  if (!settingsRef.collaboratorAliases || typeof settingsRef.collaboratorAliases !== 'object') {
    settingsRef.collaboratorAliases = {};
  }
  return settingsRef.collaboratorAliases;
}

function getCollaboratorLabelsMap() {
  const settingsRef = getAppSettingsRef();
  if (!settingsRef.collaboratorLabels || typeof settingsRef.collaboratorLabels !== 'object') {
    settingsRef.collaboratorLabels = {};
  }
  const labelsMap = settingsRef.collaboratorLabels;
  Object.keys(labelsMap).forEach(key => {
    if (!Array.isArray(labelsMap[key])) labelsMap[key] = [];
    labelsMap[key] = Array.from(new Set(labelsMap[key].map(v => String(v || '').trim()).filter(Boolean)));
  });
  return labelsMap;
}

function getCollaboratorLabels(name) {
  const key = normalizeCollaboratorKey(name);
  if (!key) return [];
  const labelsMap = getCollaboratorLabelsMap();
  return Array.isArray(labelsMap[key]) ? [...labelsMap[key]] : [];
}

function setCollaboratorLabels(name, labels) {
  const key = normalizeCollaboratorKey(name);
  if (!key) return false;
  const labelsMap = getCollaboratorLabelsMap();
  const clean = Array.from(new Set((Array.isArray(labels) ? labels : []).map(v => String(v || '').trim()).filter(Boolean)));
  const prev = Array.isArray(labelsMap[key]) ? labelsMap[key] : [];
  const changed = clean.length !== prev.length || clean.some((v, idx) => v !== prev[idx]);
  if (!changed) return false;
  labelsMap[key] = clean;
  saveCollaboratorSettings();
  return true;
}

function addCollaboratorLabel(name, label) {
  const next = getCollaboratorLabels(name);
  const clean = String(label || '').trim();
  if (!clean || next.includes(clean)) return false;
  next.push(clean);
  return setCollaboratorLabels(name, next);
}

function removeCollaboratorLabel(name, label) {
  const clean = String(label || '').trim();
  if (!clean) return false;
  const next = getCollaboratorLabels(name).filter(v => v !== clean);
  return setCollaboratorLabels(name, next);
}

function renameCollaboratorLabel(name, oldLabel, newLabel) {
  const oldClean = String(oldLabel || '').trim();
  const newClean = String(newLabel || '').trim();
  if (!oldClean || !newClean || oldClean === newClean) return false;
  const next = getCollaboratorLabels(name);
  const idx = next.indexOf(oldClean);
  if (idx === -1) return false;
  next[idx] = newClean;
  return setCollaboratorLabels(name, next);
}

function getCollaboratorRegistryState() {
  const settingsRef = getAppSettingsRef();
  const current = settingsRef.collaboratorRegistry;
  let touched = false;
  if (!current || typeof current !== 'object') {
    settingsRef.collaboratorRegistry = { keys: [], initialized: false };
    touched = true;
  }

  const registry = settingsRef.collaboratorRegistry;
  if (!Array.isArray(registry.keys)) {
    registry.keys = [];
    touched = true;
  }
  if (typeof registry.initialized !== 'boolean') {
    registry.initialized = false;
    touched = true;
  }

  const cleaned = Array.from(new Set(
    registry.keys
      .map(normalizeCollaboratorKey)
      .filter(key => key && !isUserCollaborator(key))
  ));
  if (cleaned.length !== registry.keys.length || cleaned.some((k, idx) => k !== registry.keys[idx])) {
    registry.keys = cleaned;
    touched = true;
  }

  if (touched) saveCollaboratorSettings();
  return registry;
}

function getCollaboratorRegistryKeySet() {
  return new Set(getCollaboratorRegistryState().keys);
}

function setCollaboratorRegistryKeys(keys, options = {}) {
  const persist = options.persist !== false;
  const registry = getCollaboratorRegistryState();
  const cleaned = Array.from(new Set(
    (Array.isArray(keys) ? keys : [])
      .map(normalizeCollaboratorKey)
      .filter(key => key && !isUserCollaborator(key))
  ));
  const changed = cleaned.length !== registry.keys.length || cleaned.some((k, idx) => k !== registry.keys[idx]);
  if (!changed) return false;
  registry.keys = cleaned;
  if (persist) saveCollaboratorSettings();
  return true;
}

function markCollaboratorRegistryInitialized(options = {}) {
  const persist = options.persist !== false;
  const registry = getCollaboratorRegistryState();
  if (registry.initialized) return false;
  registry.initialized = true;
  if (persist) saveCollaboratorSettings();
  return true;
}

function addCollaboratorsToRegistry(names, options = {}) {
  const persist = options.persist !== false;
  const registry = getCollaboratorRegistryState();
  const next = new Set(registry.keys);
  let changed = false;
  (Array.isArray(names) ? names : []).forEach(name => {
    const key = normalizeCollaboratorKey(name);
    if (!key || isUserCollaborator(key) || next.has(key)) return;
    next.add(key);
    changed = true;
  });
  if (!changed) return false;
  registry.keys = Array.from(next);
  if (persist) saveCollaboratorSettings();
  return true;
}

function collectCollaboratorBootstrapCandidates() {
  return [];
}

function ensureCollaboratorRegistryBootstrapped() {
  const registry = getCollaboratorRegistryState();
  if (registry.initialized && registry.keys.length > 0) {
    return registry;
  }

  const candidates = collectCollaboratorBootstrapCandidates();
  const merged = new Set(registry.keys);
  candidates.forEach(name => {
    const key = normalizeCollaboratorKey(name);
    if (!key || isUserCollaborator(key)) return;
    merged.add(key);
  });

  const changedKeys = setCollaboratorRegistryKeys(Array.from(merged), { persist: false });
  const changedInit = markCollaboratorRegistryInitialized({ persist: false });
  if (changedKeys || changedInit) saveCollaboratorSettings();
  return getCollaboratorRegistryState();
}

function normalizeCollaboratorHiddenAgainstRegistry(options = {}) {
  const persist = options.persist !== false;
  const registry = ensureCollaboratorRegistryBootstrapped();
  const allowed = new Set(registry.keys);
  const settingsRef = getAppSettingsRef();
  if (!Array.isArray(settingsRef.hiddenCollaborators)) {
    settingsRef.hiddenCollaborators = [];
    if (persist) saveCollaboratorSettings();
    return;
  }
  const clean = Array.from(new Set(
    settingsRef.hiddenCollaborators
      .map(normalizeCollaboratorKey)
      .filter(key => key && allowed.has(key))
  ));
  const changed = clean.length !== settingsRef.hiddenCollaborators.length
    || clean.some((k, idx) => k !== settingsRef.hiddenCollaborators[idx]);
  if (!changed) return;
  settingsRef.hiddenCollaborators = clean;
  if (persist) saveCollaboratorSettings();
}

function getCollaboratorHiddenSet() {
  normalizeCollaboratorHiddenAgainstRegistry({ persist: false });
  const settingsRef = getAppSettingsRef();
  if (!Array.isArray(settingsRef.hiddenCollaborators)) {
    settingsRef.hiddenCollaborators = [];
  }
  const clean = settingsRef.hiddenCollaborators
    .map(x => normalizeCollaboratorKey(x))
    .filter(Boolean);
  settingsRef.hiddenCollaborators = Array.from(new Set(clean));
  return new Set(settingsRef.hiddenCollaborators);
}

function saveCollaboratorSettings() {
  if (typeof saveLocalSettings === 'function') {
    saveLocalSettings();
  }
}

function getCollaboratorDisplayName(name) {
  const key = normalizeCollaboratorKey(name);
  if (!key) return '';
  const aliases = getCollaboratorAliasMap();
  if (aliases[key] && aliases[key].trim()) return aliases[key].trim();
  const raw = (name || '').trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function getAllKnownCollaboratorNames() {
  if (colleaguesDb && Array.isArray(colleaguesDb.colleagues)) {
    return colleaguesDb.colleagues
      .map(c => c.label)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }
  const registry = ensureCollaboratorRegistryBootstrapped();
  return registry.keys
    .map(getCollaboratorDisplayName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function isCollaboratorHidden(name) {
  return getCollaboratorHiddenSet().has(normalizeCollaboratorKey(name));
}

function setCollaboratorsHidden(names, hidden) {
  addCollaboratorsToRegistry(names, { persist: false });
  const hiddenSet = getCollaboratorHiddenSet();
  names.forEach(name => {
    const key = normalizeCollaboratorKey(name);
    if (!key || isUserCollaborator(name)) return;
    if (hidden) hiddenSet.add(key);
    else hiddenSet.delete(key);
  });
  const settingsRef = getAppSettingsRef();
  settingsRef.hiddenCollaborators = Array.from(hiddenSet).sort();
  saveCollaboratorSettings();
}

function getVisibleCollaboratorNames() {
  return getAllKnownCollaboratorNames().filter(name => !isCollaboratorHidden(name));
}

function hideCollaborator(name) {
  setCollaboratorsHidden([name], true);
}

function unhideCollaborator(name) {
  setCollaboratorsHidden([name], false);
}

function getTeamGroupsState() {
  const settingsRef = getAppSettingsRef();
  if (!settingsRef.teamGroups || typeof settingsRef.teamGroups !== 'object') {
    settingsRef.teamGroups = { groups: [] };
  }
  if (!Array.isArray(settingsRef.teamGroups.groups)) {
    settingsRef.teamGroups.groups = [];
  }

  const seenIds = new Set();
  const normalizedGroups = [];
  settingsRef.teamGroups.groups.forEach((raw, idx) => {
    const name = String(raw?.name || '').trim();
    if (!name) return;
    let id = String(raw?.id || '').trim();
    if (!id || seenIds.has(id)) {
      id = `team-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
    }
    seenIds.add(id);
    const members = Array.isArray(raw?.members)
      ? Array.from(new Set(raw.members.map(normalizeCollaboratorKey).filter(Boolean)))
      : [];
    normalizedGroups.push({
      id,
      name,
      hidden: !!raw?.hidden,
      members
    });
  });
  settingsRef.teamGroups.groups = normalizedGroups;
  return settingsRef.teamGroups;
}

function saveTeamGroupsState() {
  saveCollaboratorSettings();
}

function getTeamGroupById(groupId) {
  if (!groupId || groupId === '__all__') return null;
  const state = getTeamGroupsState();
  return state.groups.find(g => g.id === groupId) || null;
}

function normalizeTeamGroupsUiState() {
  const state = getTeamGroupsState();
  const exists = state.groups.some(g => g.id === activeTeamGroupTab && !g.hidden);
  if (activeTeamGroupTab !== '__all__' && !exists) {
    activeTeamGroupTab = '__all__';
  }
}

function createTeamGroup(name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return { ok: false, reason: 'empty' };
  const state = getTeamGroupsState();
  const key = cleanName.toLowerCase();
  const exists = state.groups.some(g => g.name.trim().toLowerCase() === key);
  if (exists) return { ok: false, reason: 'duplicate' };

  state.groups.push({
    id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: cleanName,
    hidden: false,
    members: []
  });
  saveTeamGroupsState();
  return { ok: true };
}

function renameTeamGroup(groupId, nextName) {
  const group = getTeamGroupById(groupId);
  if (!group) return { ok: false, reason: 'missing' };
  const cleanName = String(nextName || '').trim();
  if (!cleanName) return { ok: false, reason: 'empty' };
  const state = getTeamGroupsState();
  const key = cleanName.toLowerCase();
  const exists = state.groups.some(g => g.id !== groupId && g.name.trim().toLowerCase() === key);
  if (exists) return { ok: false, reason: 'duplicate' };
  group.name = cleanName;
  saveTeamGroupsState();
  return { ok: true };
}

function setTeamGroupHidden(groupId, hidden) {
  const group = getTeamGroupById(groupId);
  if (!group) return;
  group.hidden = !!hidden;
  saveTeamGroupsState();
  normalizeTeamGroupsUiState();
}

function deleteTeamGroup(groupId) {
  const state = getTeamGroupsState();
  const idx = state.groups.findIndex(g => g.id === groupId);
  if (idx === -1) return;
  state.groups.splice(idx, 1);
  saveTeamGroupsState();
  normalizeTeamGroupsUiState();
}

function moveTeamGroupBefore(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const state = getTeamGroupsState();
  const sourceIdx = state.groups.findIndex(g => g.id === sourceId);
  const targetIdx = state.groups.findIndex(g => g.id === targetId);
  if (sourceIdx === -1 || targetIdx === -1) return;
  const [moved] = state.groups.splice(sourceIdx, 1);
  const nextTargetIdx = state.groups.findIndex(g => g.id === targetId);
  state.groups.splice(nextTargetIdx, 0, moved);
  saveTeamGroupsState();
}

function getCollaboratorGroupIds(name) {
  const state = getTeamGroupsState();
  const key = normalizeCollaboratorKey(name);
  if (!key) return [];
  return state.groups.filter(g => g.members.includes(key)).map(g => g.id);
}

function isCollaboratorInGroup(name, groupId) {
  const group = getTeamGroupById(groupId);
  if (!group) return false;
  return group.members.includes(normalizeCollaboratorKey(name));
}

function addCollaboratorToGroup(name, groupId) {
  const group = getTeamGroupById(groupId);
  if (!group) return false;
  const key = normalizeCollaboratorKey(name);
  if (!key) return false;
  addCollaboratorsToRegistry([name], { persist: false });
  if (group.members.includes(key)) return false;
  group.members.push(key);
  saveTeamGroupsState();
  return true;
}

function removeCollaboratorFromGroup(name, groupId) {
  const group = getTeamGroupById(groupId);
  if (!group) return false;
  const key = normalizeCollaboratorKey(name);
  const before = group.members.length;
  group.members = group.members.filter(k => k !== key);
  if (group.members.length === before) return false;
  saveTeamGroupsState();
  return true;
}

function removeCollaboratorFromAllGroups(name) {
  const key = normalizeCollaboratorKey(name);
  if (!key) return false;
  const state = getTeamGroupsState();
  let changed = false;
  state.groups.forEach(group => {
    const before = group.members.length;
    group.members = group.members.filter(k => k !== key);
    if (group.members.length !== before) changed = true;
  });
  if (changed) saveTeamGroupsState();
  return changed;
}

function getVisibleTeamGroups() {
  return getTeamGroupsState().groups.filter(g => !g.hidden);
}

function getCollaboratorsForActiveTeamGroup(sortedVisibleCollaborators) {
  if (activeTeamGroupTab === '__all__') return sortedVisibleCollaborators;
  const group = getTeamGroupById(activeTeamGroupTab);
  if (!group) return [];
  const set = new Set(group.members);
  return sortedVisibleCollaborators.filter(name => set.has(normalizeCollaboratorKey(name)));
}

let _activeContextMenuCloser = null;
function registerContextMenuCloser(closer) {
  if (_activeContextMenuCloser) {
    document.removeEventListener('click', _activeContextMenuCloser);
  }
  _activeContextMenuCloser = closer;
  if (closer) {
    document.addEventListener('click', closer);
  }
}

function onTeamGroupTabContextMenu(e, groupId) {
  e.preventDefault();
  const group = getTeamGroupById(groupId);
  if (!group) return;

  document.querySelectorAll('.note-card-context-menu, .label-nav-context-menu, .collab-card-context-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'note-card-context-menu collab-card-context-menu';
  menu.style.position = 'absolute';
  menu.style.top = `${e.pageY}px`;
  menu.style.left = `${e.pageX}px`;
  menu.style.zIndex = 2100;

  const makeBtn = (text, fn, danger = false) => {
    const btn = document.createElement('button');
    btn.className = `ctx-btn${danger ? ' danger' : ''}`;
    btn.textContent = text;
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      try { fn(); } catch (err) { console.warn(err); }
      menu.remove();
      registerContextMenuCloser(null);
    });
    return btn;
  };

  menu.appendChild(makeBtn(t('team.renameGroup'), () => {
    teamGroupInputMode = `rename:${group.id}`;
    teamGroupInputValue = group.name;
    renderTeamPanel();
  }));
  menu.appendChild(makeBtn(t('team.hideGroup'), () => {
    setTeamGroupHidden(group.id, true);
    renderTeamPanel();
  }));
  menu.appendChild(makeBtn(t('team.deleteGroup'), async () => {
    if (!await showConfirmDialog(t('team.confirmDeleteGroup', { name: group.name }), { isDanger: true })) return;
    deleteTeamGroup(group.id);
    renderTeamPanel();
  }, true));

  document.body.appendChild(menu);
  setTimeout(() => {
    const closer = ev => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        registerContextMenuCloser(null);
      }
    };
    registerContextMenuCloser(closer);
  }, 0);
}

function showTeamAssignDialog(colleagueName) {
  return new Promise(async (resolve) => {
    const cleanName = colleagueName.trim();
    if (!colleaguesDb) {
      colleaguesDb = ensureColleaguesDbShape(null);
      reindexColleaguesDb();
    }
    const targetId = (cleanName.toLowerCase() === (colleaguesDb.me.label || '').toLowerCase() || cleanName.toLowerCase() === 'me') 
      ? 'me' 
      : (colleaguesDb.colleagues.find(c => c.label.toLowerCase() === cleanName.toLowerCase())?.id || '');
    if (!targetId) {
      resolve(false);
      return;
    }
    const rec = colleaguesById.get(targetId);
    const currentTeamId = rec ? rec.teamId : 'team-other-bucket';
    const select = el('select', {
      className: 'dialog-input',
      style: { flex: '1', padding: '8px', background: 'var(--card-bg)', color: 'var(--text)', border: '1px solid var(--card-border)', borderRadius: '4px' }
    });

    const populateTeams = () => {
      select.innerHTML = '';
      colleaguesDb.teams.forEach(t => {
        const displayTeamName = getTeamDisplayName(t);
        const opt = el('option', { value: t.id }, displayTeamName);
        if (t.id === currentTeamId) opt.selected = true;
        select.appendChild(opt);
      });
    };
    populateTeams();

    const createTeamBtn = el('button', {
      className: 'btn btn-secondary',
      textContent: '+',
      style: { padding: '2px 10px' },
      title: t('team.createNewTeamTooltip') || t('team.newTeamNamePrompt') || 'Create new team',
      onClick: async () => {
        const teamName = await showPromptDialog(t('team.newTeamNamePrompt') || "Nom de la nouvelle équipe / New team name:");
        if (!teamName || !teamName.trim()) return;

        const newTeam = { id: 'team-' + Date.now(), name: teamName.trim(), managerId: '' };
        colleaguesDb.teams.push(newTeam);
        await saveColleaguesDb();
        reindexColleaguesDb();
        populateTeams();
        select.value = newTeam.id;
      }
    });

    const selectRow = el('div', { style: { display: 'flex', gap: '6px', marginBottom: '15px' } }, [select, createTeamBtn]);

    const modalResult = await showCustomModal({
      title: t('team.assignToTeamTitle', { name: cleanName }) || `Assign ${cleanName} to a team`,
      body: selectRow,
      width: '320px',
      actions: [
        { label: window.t('editor.cancel') || 'Cancel', title: window.t('common.cancelTooltip') || 'Cancel', value: false },
        {
          label: window.t('todo.save') || 'Save',
          title: window.t('common.saveTooltip') || 'Save',
          isPrimary: true,
          onClick: async () => {
            const newTeamId = select.value;
            if (targetId === 'me') {
              colleaguesDb.me.teamId = newTeamId;
            } else {
              const colRecord = colleaguesDb.colleagues.find(c => c.id === targetId);
              if (colRecord) colRecord.teamId = newTeamId;
            }

            if (newTeamId === 'team-other-bucket') {
              colleaguesDb.teams.forEach(t => {
                if (t.managerId === targetId) t.managerId = '';
              });
            }

            await saveColleaguesDb();
            reindexColleaguesDb();
            if (typeof renderTeamPanel === 'function') renderTeamPanel();
            if (typeof renderBoard === 'function') renderBoard();
            return true;
          }
        }
      ]
    });

    resolve(modalResult);
  });
}

function onCollaboratorCardContextMenu(e, name) {
  try {
    e.preventDefault();
    document.querySelectorAll('.note-card-context-menu, .label-nav-context-menu, .collab-card-context-menu').forEach(el => el.remove());
    const menu = document.createElement('div');
    menu.className = 'note-card-context-menu collab-card-context-menu';
    menu.style.position = 'absolute';
    menu.style.top = `${e.pageY}px`;
    menu.style.left = `${e.pageX}px`;
    menu.style.zIndex = 2100;

    const makeBtn = (text, fn, danger = false) => {
      const btn = document.createElement('button');
      btn.className = `ctx-btn${danger ? ' danger' : ''}`;
      btn.textContent = text;
      btn.addEventListener('click', async ev => {
        ev.stopPropagation();
        try { await fn(); } catch (err) { console.warn(err); }
        menu.remove();
        registerContextMenuCloser(null);
      });
      return btn;
    };

    const visibleGroups = getVisibleTeamGroups();

    menu.appendChild(makeBtn(t('team.renameCollaborator'), async () => { await window.renameCollaboratorGlobal(name); }));
    menu.appendChild(makeBtn(t('team.mergeColleague') || 'Merge colleague...', async () => { await window.mergeColleagueGlobal(name); }));
    menu.appendChild(makeBtn("Assign to team...", async () => { await showTeamAssignDialog(name); }));
    if (isCollaboratorHidden(name)) {
      menu.appendChild(makeBtn(t('team.unhideCollaborator'), async () => {
        unhideCollaborator(name);
        renderTeamPanel();
      }));
    } else {
      menu.appendChild(makeBtn(t('team.hideCollaborator'), async () => {
        hideCollaborator(name);
        toast(t('team.hiddenCollaboratorToast', { name }));
        renderTeamPanel();
      }));
    }

    menu.appendChild(makeBtn(t('team.deleteCollaboratorViewOnly'), async () => {
      const targetId = resolveColleagueId(name, { allowCreate: false, allowMe: false });
      const rec = targetId ? colleaguesById.get(targetId) : null;
      
      removeCollaboratorFromAllGroups(name);
      hideCollaborator(name);
      
      if (rec && rec.teamId && rec.teamId !== 'team-other-bucket') {
        rec.teamId = 'team-other-bucket';
        await saveColleaguesDb();
        reindexColleaguesDb();
        renderTeamPanel();
        if (typeof renderBoard === 'function') renderBoard();
        toast(t('team.removedFromTeamsToast', { name }) || `Removed ${name} from teams.`);
      } else {
        // Already in other bucket, delete entirely!
        await window.deleteColleagueEntirelyGlobal(name);
      }
    }, true));

    menu.appendChild(makeBtn(t('team.deleteColleagueEntirely') || 'Delete colleague entirely', async () => {
      await window.deleteColleagueEntirelyGlobal(name);
    }, true));

    if (visibleGroups.length > 0) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--card-border);margin:4px 0;';
      menu.appendChild(sep);

      const label = document.createElement('div');
      label.style.cssText = 'font-size:0.7rem;color:var(--text-muted);padding:3px 8px;text-transform:uppercase;letter-spacing:.05em;';
      label.textContent = t('team.addToGroup');
      menu.appendChild(label);

      visibleGroups.forEach(group => {
        const inGroup = isCollaboratorInGroup(name, group.id);
        menu.appendChild(makeBtn(`${inGroup ? '✓ ' : ''}${group.name}`, async () => {
          if (!inGroup) addCollaboratorToGroup(name, group.id);
          renderTeamPanel();
        }));
      });
    }

    if (activeTeamGroupTab !== '__all__' && isCollaboratorInGroup(name, activeTeamGroupTab)) {
      menu.appendChild(makeBtn(t('team.removeFromCurrentGroup'), async () => {
        removeCollaboratorFromGroup(name, activeTeamGroupTab);
        renderTeamPanel();
      }));
    }

    document.body.appendChild(menu);
    setTimeout(() => {
      const closer = ev => {
        if (!menu.contains(ev.target)) {
          menu.remove();
          registerContextMenuCloser(null);
        }
      };
      registerContextMenuCloser(closer);
    }, 0);
  } catch (err) {
    console.warn('Collaborator context menu failed', err);
  }
}

function renderCollaboratorManagerSidebar(parent, allNames, visibleNames, hiddenNames) {
  const sidebar = document.createElement('aside');
  sidebar.className = 'collab-manager-sidebar collapsible-sidebar';

  const paneHeader = document.createElement('div');
  paneHeader.className = 'collab-sidebar-toggle-header';
  paneHeader.title = teamManagerPaneOpen ? (t('common.collapseSidebar') || 'Click to collapse sidebar') : (t('common.expandSidebar') || 'Click to expand sidebar');
  paneHeader.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTeamManagerPane();
  });

  const paneHeaderLabel = document.createElement('span');
  paneHeaderLabel.className = 'collab-sidebar-toggle-label';
  paneHeaderLabel.textContent = t('team.optionsPanel');

  const paneHeaderChevron = document.createElement('span');
  paneHeaderChevron.className = 'collab-sidebar-toggle-chevron';
  paneHeaderChevron.textContent = teamManagerPaneOpen ? '‹' : '›';

  paneHeader.appendChild(paneHeaderLabel);
  paneHeader.appendChild(paneHeaderChevron);
  sidebar.appendChild(paneHeader);

  if (!teamManagerPaneOpen) {
    sidebar.classList.add('collapsed');
    sidebar.title = t('common.expandSidebar') || 'Click to expand sidebar';
    sidebar.addEventListener('click', () => {
      if (!teamManagerPaneOpen) toggleTeamManagerPane();
    });
    parent.appendChild(sidebar);
    return;
  }

  const paneTabs = document.createElement('div');
  paneTabs.className = 'md-tabs planner-pane-tabs dual';
  paneTabs.style.marginBottom = '0.35rem';

  const collabTabBtn = document.createElement('button');
  collabTabBtn.className = `md-tab planner-pane-tab-btn${activeTeamManagerTab === 'collaborators' ? ' active' : ''}`;
  collabTabBtn.textContent = t('team.collaboratorsLabel');
  collabTabBtn.addEventListener('click', () => {
    activeTeamManagerTab = 'collaborators';
    renderTeamPanel();
  });

  const teamsTabBtn = document.createElement('button');
  teamsTabBtn.className = `md-tab planner-pane-tab-btn${activeTeamManagerTab === 'teams' ? ' active' : ''}`;
  teamsTabBtn.textContent = t('team.teamsLabel');
  teamsTabBtn.addEventListener('click', () => {
    activeTeamManagerTab = 'teams';
    renderTeamPanel();
  });

  paneTabs.appendChild(collabTabBtn);
  paneTabs.appendChild(teamsTabBtn);
  sidebar.appendChild(paneTabs);

  if (activeTeamManagerTab === 'teams') {
    const teamsState = getTeamGroupsState();
    const title = document.createElement('div');
    title.className = 'collab-manager-title';
    title.textContent = t('team.teamsLabel');
    sidebar.appendChild(title);

    const helper = document.createElement('div');
    helper.className = 'collab-manager-helper';
    helper.textContent = t('team.teamManagerHelper');
    sidebar.appendChild(helper);

    const createRow = document.createElement('div');
    createRow.className = 'team-group-create-row';
    const input = document.createElement('input');
    input.className = 'collab-search-input';
    input.placeholder = t('team.newGroupPlaceholder');
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = t('team.addGroup');
    addBtn.addEventListener('click', () => {
      const result = createTeamGroup(input.value);
      if (!result.ok) {
        toast(result.reason === 'duplicate' ? t('team.groupDuplicate') : t('team.groupNameRequired'), true);
        return;
      }
      renderTeamPanel();
    });
    createRow.appendChild(input);
    createRow.appendChild(addBtn);
    sidebar.appendChild(createRow);

    const list = document.createElement('div');
    list.className = 'team-group-manager-list';

    teamsState.groups.forEach(group => {
      const row = document.createElement('div');
      row.className = 'team-group-manager-row';
      row.draggable = true;
      row.dataset.groupId = group.id;
      row.addEventListener('dragstart', ev => {
        teamGroupManagerDragId = group.id;
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', JSON.stringify({ type: 'team-group-order', groupId: group.id }));
      });
      row.addEventListener('dragend', () => {
        teamGroupManagerDragId = null;
      });
      row.addEventListener('dragover', ev => {
        ev.preventDefault();
      });
      row.addEventListener('drop', ev => {
        ev.preventDefault();
        if (!teamGroupManagerDragId || teamGroupManagerDragId === group.id) return;
        moveTeamGroupBefore(teamGroupManagerDragId, group.id);
        renderTeamPanel();
      });

      const nameEl = document.createElement('span');
      nameEl.className = 'team-group-manager-name';
      nameEl.textContent = `${group.name} (${group.members.length})`;
      row.appendChild(nameEl);

      const actions = document.createElement('div');
      actions.className = 'team-group-manager-actions';

      const renameBtn = document.createElement('button');
      renameBtn.className = 'btn';
      renameBtn.textContent = t('team.renameGroup');
      renameBtn.addEventListener('click', () => {
        teamGroupInputMode = `rename:${group.id}`;
        teamGroupInputValue = group.name;
        activeTeamGroupTab = group.hidden ? '__all__' : group.id;
        renderTeamPanel();
      });
      actions.appendChild(renameBtn);

      const hideBtn = document.createElement('button');
      hideBtn.className = 'btn';
      hideBtn.textContent = group.hidden ? t('team.unhideGroup') : t('team.hideGroup');
      hideBtn.addEventListener('click', () => {
        setTeamGroupHidden(group.id, !group.hidden);
        renderTeamPanel();
      });
      actions.appendChild(hideBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-danger';
      deleteBtn.textContent = t('team.deleteGroup');
      deleteBtn.addEventListener('click', async () => {
        if (!await showConfirmDialog(t('team.confirmDeleteGroup', { name: group.name }), { isDanger: true })) return;
        deleteTeamGroup(group.id);
        renderTeamPanel();
      });
      actions.appendChild(deleteBtn);

      row.appendChild(actions);
      list.appendChild(row);
    });

    if (teamsState.groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'collab-manager-empty';
      empty.textContent = t('team.noGroupsYet');
      sidebar.appendChild(empty);
    } else {
      sidebar.appendChild(list);
    }

    parent.appendChild(sidebar);
    return;
  }

  const title = document.createElement('div');
  title.className = 'collab-manager-title';
  title.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
  
  const titleText = document.createElement('span');
  titleText.textContent = t('team.collaboratorsLabel');
  title.appendChild(titleText);
  
  const addColleagueBtn = document.createElement('button');
  addColleagueBtn.className = 'btn btn-primary btn-xs';
  addColleagueBtn.textContent = '+';
  addColleagueBtn.title = t('team.addColleague') || 'Add Colleague';
  addColleagueBtn.style.padding = '1px 6px';
  addColleagueBtn.style.fontSize = '0.8rem';
  addColleagueBtn.addEventListener('click', async () => {
    const name = await showPromptDialog(t('team.enterColleagueName') || 'Enter the name of the new colleague:');
    if (!name) return;
    const cleanName = name.trim();
    if (!cleanName) return;
    
    const normName = cleanName.toLowerCase();
    if (colleaguesByNormLabel && colleaguesByNormLabel.has(normName)) {
      toast(t('team.colleagueAlreadyExists', { name: cleanName }) || `${cleanName} already exists`, true);
      return;
    }
    
    const id = resolveColleagueId(cleanName, { allowCreate: true });
    if (id) {
      toast(t('team.colleagueCreated', { name: cleanName }) || `Colleague ${cleanName} created!`);
      renderTeamPanel();
    }
  });
  title.appendChild(addColleagueBtn);
  sidebar.appendChild(title);

  const helper = document.createElement('div');
  helper.className = 'collab-manager-helper';
  helper.textContent = t('team.collabManagerHelper');
  sidebar.appendChild(helper);

  const renderSection = (sectionTitle, names, sectionKey) => {
    const section = document.createElement('section');
    section.className = 'collab-manager-section';

    const header = document.createElement('div');
    header.className = 'collab-manager-section-title';
    header.textContent = `${sectionTitle} (${names.length})`;
    section.appendChild(header);

    if (names.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'collab-manager-empty';
      empty.textContent = sectionKey === 'hidden' ? t('team.noHiddenCollaborators') : t('team.noVisibleCollaborators');
      section.appendChild(empty);
      return section;
    }

    const list = document.createElement('div');
    list.className = 'collab-manager-list';

    names.forEach(name => {
      const key = normalizeCollaboratorKey(name);
      const row = document.createElement('div');
      row.className = 'collab-manager-row';

      const head = document.createElement('div');
      head.className = 'collab-manager-row-head';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = collabManagerSelection.has(key);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) collabManagerSelection.add(key);
        else collabManagerSelection.delete(key);
      });

      const color = colorForGroup(name);
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.cssText = `background:${color.bg}; color:${color.text}; width:22px; height:22px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-weight:700; font-size:0.68rem;`;
      swatch.textContent = name.slice(0, 2).toUpperCase();

      const text = document.createElement('span');
      text.className = 'collab-manager-name';
      text.textContent = name;

      head.appendChild(checkbox);
      head.appendChild(swatch);
      head.appendChild(text);
      row.appendChild(head);

      const labelsWrap = document.createElement('div');
      labelsWrap.className = 'tags-editor collab-labels-editor';
      labelsWrap.title = t('team.collaboratorLabelsTitle') || 'Collaborator labels';

      const labels = getCollaboratorLabels(name);
      labels.forEach(label => {
        const chip = document.createElement('span');
        chip.className = 'tag-pill';
        chip.style.cursor = 'pointer';
        chip.textContent = label;
        chip.title = t('team.renameLabelHint') || 'Rename label';
        chip.addEventListener('click', async ev => {
          ev.preventDefault();
          ev.stopPropagation();
          const next = await showPromptDialog(
            t('team.renameLabelPrompt', { value: label }) || `Rename label "${label}"`,
            label,
            { okLabel: t('common.rename') || 'Rename', cancelLabel: t('editor.cancel') || 'Cancel' }
          );
          if (!next || !next.trim() || next.trim() === label) return;
          renameCollaboratorLabel(name, label, next.trim());
          renderTeamPanel();
        });

        const rm = document.createElement('button');
        rm.className = 'rm';
        rm.type = 'button';
        rm.textContent = '×';
        rm.title = t('common.remove') || 'Remove';
        rm.addEventListener('click', ev => {
          ev.preventDefault();
          ev.stopPropagation();
          removeCollaboratorLabel(name, label);
          renderTeamPanel();
        });
        chip.appendChild(rm);
        labelsWrap.appendChild(chip);
      });

      const addInput = document.createElement('input');
      addInput.className = 'tag-add';
      addInput.type = 'text';
      addInput.placeholder = t('team.addLabelPlaceholder') || 'Add label';
      addInput.addEventListener('click', ev => {
        ev.stopPropagation();
      });
      addInput.addEventListener('keydown', ev => {
        if (ev.key !== 'Enter' && ev.key !== ',') return;
        ev.preventDefault();
        ev.stopPropagation();
        const value = addInput.value.trim();
        if (!value) return;
        addCollaboratorLabel(name, value);
        renderTeamPanel();
      });
      labelsWrap.appendChild(addInput);
      row.appendChild(labelsWrap);

      list.appendChild(row);
    });

    section.appendChild(list);
    return section;
  };

  sidebar.appendChild(renderSection(t('team.visibleCollaborators'), visibleNames, 'visible'));

  const actions = document.createElement('div');
  actions.className = 'collab-manager-actions';

  const selectedVisible = visibleNames.filter(name => collabManagerSelection.has(normalizeCollaboratorKey(name)));
  const selectedHidden = hiddenNames.filter(name => collabManagerSelection.has(normalizeCollaboratorKey(name)));

  const hideBtn = document.createElement('button');
  hideBtn.className = 'btn';
  hideBtn.textContent = selectedVisible.length > 0 ? t('team.hideSelectedCount', { count: selectedVisible.length }) : t('team.hideSelected');
  hideBtn.disabled = selectedVisible.length === 0;
  hideBtn.addEventListener('click', () => {
    if (selectedVisible.length === 0) return;
    setCollaboratorsHidden(selectedVisible, true);
    selectedVisible.forEach(name => collabManagerSelection.delete(normalizeCollaboratorKey(name)));
    renderTeamPanel();
  });
  actions.appendChild(hideBtn);

  const showBtn = document.createElement('button');
  showBtn.className = 'btn';
  showBtn.textContent = selectedHidden.length > 0 ? t('team.showSelectedCount', { count: selectedHidden.length }) : t('team.showSelectedHidden');
  showBtn.disabled = selectedHidden.length === 0;
  showBtn.addEventListener('click', () => {
    if (selectedHidden.length === 0) return;
    setCollaboratorsHidden(selectedHidden, false);
    selectedHidden.forEach(name => collabManagerSelection.delete(normalizeCollaboratorKey(name)));
    renderTeamPanel();
  });
  actions.appendChild(showBtn);

  const showAllBtn = document.createElement('button');
  showAllBtn.className = 'btn btn-secondary';
  showAllBtn.textContent = t('team.showAllHiddenCount', { count: hiddenNames.length });
  showAllBtn.disabled = hiddenNames.length === 0;
  showAllBtn.addEventListener('click', () => {
    setCollaboratorsHidden(hiddenNames, false);
    hiddenNames.forEach(name => collabManagerSelection.delete(normalizeCollaboratorKey(name)));
    renderTeamPanel();
  });
  actions.appendChild(showAllBtn);

  const allSelected = [...visibleNames, ...hiddenNames].filter(name => collabManagerSelection.has(normalizeCollaboratorKey(name)));
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-danger';
  deleteBtn.style.cssText = 'margin-top:0.5rem;background:var(--danger,#ef4444);color:#fff;border-color:var(--danger,#ef4444);';
  deleteBtn.textContent = allSelected.length > 0 ? t('team.deleteSelectedCount', { count: allSelected.length }) : t('team.deleteSelected');
  deleteBtn.disabled = allSelected.length === 0;
  deleteBtn.addEventListener('click', async () => {
    if (allSelected.length === 0) return;
    const names = allSelected.join(', ');
    if (!await showConfirmDialog(t('team.confirmDeleteCollaboratorsViewOnly', { names }), { isDanger: true })) return;
    for (const name of allSelected) {
      collabManagerSelection.delete(normalizeCollaboratorKey(name));
      removeCollaboratorFromAllGroups(name);
      hideCollaborator(name);
    }
    renderTeamPanel();
  });
  actions.appendChild(deleteBtn);

  sidebar.appendChild(actions);
  sidebar.appendChild(renderSection(t('team.hiddenCollaborators'), hiddenNames, 'hidden'));

  parent.appendChild(sidebar);
}

// Re-index all notes when mounting a folder, using cached results where possible
async function indexCollaborativeData() {
  const currentPaths = new Set(manifest.map(n => n.path));
  
  // Clean cache of deleted files
  for (const path in collaborativeDataCache) {
    if (!currentPaths.has(path)) {
      delete collaborativeDataCache[path];
    }
  }
  
  // Filter entries that actually need indexing
  const entriesToProcess = manifest.filter(entry => {
    if (!entry.path) return false;
    const cached = collaborativeDataCache[entry.path];
    if (cached && cached.modified === entry.modified) {
      return false;
    }
    return true;
  });

  // Concurrent batches of 50
  const batchSize = 50;
  for (let i = 0; i < entriesToProcess.length; i += batchSize) {
    const batch = entriesToProcess.slice(i, i + batchSize);
    await Promise.all(batch.map(async (entry) => {
      try {
        if (await StorageAPI.hasNoteContent(entry.path)) {
          const html = await StorageAPI.readNoteContent(entry.path);
          const parsed = parseNoteContentForCollab(html, entry.path);
          collaborativeDataCache[entry.path] = {
            modified: entry.modified || '',
            ...parsed
          };
        }
      } catch (e) {
        console.warn('Could not index collaborative data for', entry.path, e);
      }
    }));
  }
  
  rebuildCollaborativeAggregates();
}

// Re-index a single note when saved/modified
async function updateNoteInCollabIndex(notePath) {
  try {
    const entry = getNoteByPath(notePath);
    if (!entry) return;
    
    if (await StorageAPI.hasNoteContent(notePath)) {
      const html = await StorageAPI.readNoteContent(notePath);
      const parsed = parseNoteContentForCollab(html, notePath);
      collaborativeDataCache[notePath] = {
        modified: entry.modified || new Date().toISOString(),
        ...parsed
      };
      
      rebuildCollaborativeAggregates();
      
      if (activeTab === 'team') {
        renderTeamPanel();
      }
    }
  } catch (e) {
    console.warn('Failed to update note in collab index', notePath, e);
  }
}

// Parse helper to extract @mentions, !decisions and To-do -> @delegations
function normalizeDecisionText(rawText) {
  if (!rawText) return '';
  let text = String(rawText);

  text = text.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  text = text.replace(/\((?:reference|r[ée]f[ée]rence|supersedes|remplace)\s*:\s*"[^"]*"\)\s*$/i, '');

  text = text
    .replace(/^[\s*\-\+\d\.)\]]+/, '')
    .replace(/^"+|"+$/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

function isMeaningfulDecisionText(text) {
  if (!text) return false;
  if (text.length < 4) return false;
  if (!/[A-Za-zÀ-ÿ0-9]/.test(text)) return false;
  const punctuationNoise = text.replace(/[A-Za-zÀ-ÿ0-9\s]/g, '');
  if (punctuationNoise.length > 0 && punctuationNoise.length >= text.length * 0.6) return false;
  return true;
}

function isValidMentionPrefix(line, atIndex) {
  if (atIndex <= 0) return true;
  const prev = line[atIndex - 1] || '';
  return /\s|[\(\[\{<>'"`]/.test(prev) || prev === '>';
}

function parseMentionAt(line, atIndex) {
  if (!line || atIndex < 0 || atIndex >= line.length || line[atIndex] !== '@') return null;
  if (!isValidMentionPrefix(line, atIndex)) return null;

  const tail = line.slice(atIndex + 1);
  if (tail.startsWith('"')) {
    const closeIdx = tail.indexOf('"', 1);
    if (closeIdx <= 1) return null;
    const quoted = tail.slice(1, closeIdx).trim();
    if (!quoted) return null;
    const nextChar = tail[closeIdx + 1] || '';
    if (nextChar && !/[\s,;:!?\)\]\}]/.test(nextChar)) return null;
    return {
      collaborator: quoted,
      start: atIndex,
      end: atIndex + 1 + closeIdx + 1
    };
  }

  const basic = tail.match(/^([a-zA-ZÀ-ÿ0-9_-]+)/);
  if (!basic) return null;
  const nextChar = tail[basic[1].length] || '';
  if (nextChar && !/[\s,;:!?\)\]\}]/.test(nextChar)) return null;
  if (nextChar === '.' && /[a-zA-Z0-9]/.test(tail[basic[1].length + 1] || '')) return null;
  return {
    collaborator: basic[1],
    start: atIndex,
    end: atIndex + 1 + basic[1].length
  };
}

function extractCollaboratorsFromEditorMarkdown(markdown) {
  const text = String(markdown || '');
  const names = [];
  let scanIdx = 0;
  while (scanIdx < text.length) {
    const atIdx = text.indexOf('@', scanIdx);
    if (atIdx === -1) break;
    const mention = parseMentionAt(text, atIdx);
    if (!mention) {
      scanIdx = atIdx + 1;
      continue;
    }
    scanIdx = mention.end;
    names.push(mention.collaborator);
  }
  return Array.from(new Set(names.map(normalizeCollaboratorKey).filter(Boolean))).map(getCollaboratorDisplayName);
}

window.registerCollaboratorsFromNoteHTML = function(html) {
  return false;
};

// Legacy alias (kept for any remaining callers)
window.registerCollaboratorsFromEditedMarkdown = function(markdown) {
  return false;
};

function parseNoteContentForCollab(html, path) {
  const parsed = parseNoteHTML(html);
  const doc = new DOMParser().parseFromString(`<div>${parsed.mainHTML || ''}</div>`, 'text/html');

  const decisions = [];
  const mentions = [];
  const delegations = [];

  // 1. Decisions
  doc.querySelectorAll('.note-decision-wrapper').forEach(el => {
    const status = (el.getAttribute('data-decision-status') || 'active').trim().toLowerCase();
    const textEl = el.querySelector('.note-decision-text');
    const rawText = (textEl ? textEl.textContent : (el.getAttribute('data-decision-text') || el.textContent || '')).trim();
    const text = normalizeDecisionText(rawText);
    if (isMeaningfulDecisionText(text)) {
      decisions.push({ text, status, isLinked: false });
    }
  });

  // 2. Delegations
  doc.querySelectorAll('.pill-delegation').forEach(el => {
    const colId = el.getAttribute('data-colleague-id') || '';
    let col = '';
    if (colId && typeof getColleagueLabelById === 'function') {
      col = getColleagueLabelById(colId);
    }
    if (!col) {
      const rawCol = el.getAttribute('data-owner') || el.getAttribute('data-colleague-label') || el.textContent.replace(/^⏳\s*Delegated to\s*/i, '').trim();
      const cleanCol = String(rawCol || '').replace(/^@/, '').trim();
      if (cleanCol && typeof resolveColleagueId === 'function') {
        const resolvedId = resolveColleagueId(cleanCol, { allowCreate: false, allowMe: false });
        if (resolvedId && typeof getColleagueLabelById === 'function') {
          col = getColleagueLabelById(resolvedId);
        }
      }
      if (!col) col = cleanCol;
    }
    if (!col) return;
    const parentText = (el.parentElement?.textContent || '').replace(el.textContent, '').trim();
    const isDone = el.closest('.note-todo-done') != null;
    const isWip = el.closest('[data-todo-status="WIP"]') != null;
    const status = isDone ? 'Done' : (isWip ? 'WIP' : 'Pending');
    delegations.push({ collaborator: col, colleagueId: colId, text: parentText || (typeof t === 'function' ? t('team.taskFallback') : 'Task'), status });
  });

  // 3. Mentions (excluding already-captured delegations)
  const delegationEls = new Set(doc.querySelectorAll('.pill-delegation'));
  doc.querySelectorAll('.pill-mention').forEach(el => {
    if (delegationEls.has(el)) return;
    const colId = el.getAttribute('data-colleague-id') || '';
    let col = '';
    if (colId && typeof getColleagueLabelById === 'function') {
      col = getColleagueLabelById(colId);
    }
    if (!col) {
      const rawCol = el.getAttribute('data-colleague-label') || el.textContent.replace(/^@/, '').trim();
      const cleanCol = String(rawCol || '').replace(/^@/, '').trim();
      if (cleanCol && typeof resolveColleagueId === 'function') {
        const resolvedId = resolveColleagueId(cleanCol, { allowCreate: false, allowMe: false });
        if (resolvedId && typeof getColleagueLabelById === 'function') {
          col = getColleagueLabelById(resolvedId);
        }
      }
      if (!col) col = cleanCol;
    }
    if (!col) return;
    const text = (el.parentElement?.textContent || '').replace(el.textContent, '').trim();
    if (text) mentions.push({ collaborator: col, colleagueId: colId, text });
  });

  return { decisions, mentions, delegations };
}

// Rebuild aggregates after changes
function rebuildCollaborativeAggregates() {
  collaboratorsMap = {};
  decisionsList = [];
  const discoveredCollaborators = new Set();

  const trackDiscoveredCollaborator = (name) => {
    const key = normalizeCollaboratorKey(name);
    if (!key || isUserCollaborator(key)) return;
    discoveredCollaborators.add(key);
  };

  const metadataDecisionCoverage = (typeof hasMetadataDecisionCoverage === 'function')
    ? hasMetadataDecisionCoverage()
    : false;
  if (metadataDecisionCoverage && typeof getAllMetadataDecisionEntries === 'function') {
    decisionsList = getAllMetadataDecisionEntries();
  }
  
  // Helper to get or create collaborator
  const getCol = name => {
    const cleanName = getCollaboratorDisplayName(name);
    if (!collaboratorsMap[cleanName]) {
      collaboratorsMap[cleanName] = { agenda: [], delegations: [] };
    }
    return collaboratorsMap[cleanName];
  };

  for (const [path, entry] of Object.entries(collaborativeDataCache)) {
    const note = getNoteByPath(path);
    if (!note) continue;
    
    const noteId = note.id || '';
    const noteTitle = note.title || path.split('/').pop().replace('.html', '');
    const noteDate = note.date || '';
    
    // Process Decisions (fallback path when metadata decisions are not ready yet)
    if (!metadataDecisionCoverage) {
      for (const d of entry.decisions || []) {
        decisionsList.push({
          text: d.text,
          status: d.status || 'active',
          isLinked: !!d.isLinked,
          noteId,
          noteTitle,
          notePath: path,
          date: noteDate,
          major_topic_tags: note.major_topic_tags || [],
          topic_tags: note.topic_tags || []
        });
      }
    }
    
    // Process Mentions (Agenda items)
    for (const m of entry.mentions || []) {
      if (isUserCollaborator(m.collaborator)) continue;
      const col = getCol(m.collaborator);
      col.agenda.push({
        text: m.text,
        noteId,
        noteTitle,
        notePath: path
      });
    }
    
    // Process Delegations
    for (const d of entry.delegations || []) {
      if (isUserCollaborator(d.collaborator)) continue;
      const col = getCol(d.collaborator);
      
      const matchedTodo = (typeof todosManifest !== 'undefined') ? todosManifest.find(t => 
        (t.title || '').trim().toLowerCase() === d.text.trim().toLowerCase() &&
        isSameCollaborator(t.owner, d.collaborator)
      ) : null;

      col.delegations.push({
        text: d.text,
        status: d.status,
        noteId,
        noteTitle,
        notePath: path,
        todoId: matchedTodo ? matchedTodo.id : ''
      });
    }
  }

  // Process global todosManifest for delegations
  if (typeof todosManifest !== 'undefined') {
    for (const todo of todosManifest) {
      if (!todo.owner) continue;
      const ownerClean = todo.owner.trim();
      if (isUserCollaborator(ownerClean)) continue;
      trackDiscoveredCollaborator(ownerClean);
      
      const col = getCol(ownerClean);
      const status = (todo.priority === 'Done') ? 'Done' : (isTodoWip(todo) ? 'WIP' : 'Pending');
      
      const existing = col.delegations.find(d => d.text.trim().toLowerCase() === (todo.title || '').trim().toLowerCase());
      if (existing) {
        if (!existing.todoId) existing.todoId = todo.id;
      } else {
        const linkedNote = todo.noteId ? getNoteById(todo.noteId) : null;
        col.delegations.push({
          text: todo.title || t('team.taskFallback'),
          status: status,
          noteId: todo.noteId || '',
          noteTitle: linkedNote ? linkedNote.title : (todo.noteId ? todo.noteId : t('team.boardTaskLabel')),
          notePath: linkedNote ? linkedNote.path : '',
          todoId: todo.id
        });
      }
    }
  }

  if (Array.isArray(plannerEvents)) {
    plannerEvents.forEach(event => {
      extractPlannerCollaborators(event).forEach(trackDiscoveredCollaborator);
    });
  }

  ensureCollaboratorRegistryBootstrapped();
}

// ─── Team Tab UI Renderers ──────────────────────────────────────────────────

/**
 * Evaluates whether a given note meets the selection of tags (mapped tags & rules) for a workstream.
 * @param {Object} note - The note object or metadata snippet containing tags & title.
 * @param {string} [topicName] - Target workstream topic name. Defaults to selectedRegistryProject.
 * @returns {boolean} True if the note matches the selection of tags for the workstream.
 */
function doesNoteMatchWorkstreamTags(note, topicName) {
  if (!note || typeof note !== 'object') return false;

  const targetTopic = topicName || (typeof selectedRegistryProject !== 'undefined' ? selectedRegistryProject : '');

  // If viewing all projects or no specific workstream context exists, default to true
  if (!targetTopic || (typeof REGISTRY_ALL_PROJECTS_KEY !== 'undefined' && targetTopic === REGISTRY_ALL_PROJECTS_KEY)) {
    return true;
  }

  const clean = s => String(s || '').trim().toLowerCase();
  const cleanTopicName = clean(targetTopic);

  const noteMajors = (note.major_topic_tags || []).map(clean).filter(Boolean);
  const noteGroups = (note.group_tags || []).map(clean).filter(Boolean);
  const noteTopics = (note.topic_tags || []).map(clean).filter(Boolean);
  const noteExtras = (note.extra_tags || []).map(clean).filter(Boolean);
  const noteTitle = clean(note.title);

  let memory = null;
  if (typeof getMajorTopicMemorySync === 'function') {
    memory = getMajorTopicMemorySync(targetTopic);
  }

  const mapped = memory?.mappedTags || {
    major_topic_tags: [targetTopic],
    group_tags: [],
    topic_tags: [],
    tagGroups: []
  };

  const assignedMajors = Array.from(new Set([cleanTopicName, ...(mapped.major_topic_tags || []).map(clean)])).filter(Boolean);
  const assignedGroups = (mapped.group_tags || []).map(clean).filter(Boolean);
  const assignedTopics = (mapped.topic_tags || []).map(clean).filter(Boolean);
  const tagGroups = Array.isArray(mapped.tagGroups) ? mapped.tagGroups : [];

  // 1. Check tagGroups rule matches
  if (typeof matchTagsToWorkstreamSelectionGroups === 'function') {
    const matchRes = matchTagsToWorkstreamSelectionGroups({ group_tags: noteGroups, major_topic_tags: noteMajors, topic_tags: noteTopics }, tagGroups);
    if (matchRes.matched) return true;
  } else if (tagGroups.length > 0) {
    const hasTagGroupMatch = tagGroups.some(tg => {
      if (!tg) return false;
      const g = clean(tg.group);
      const m = clean(tg.major);
      const t = clean(tg.topic);
      if (!g && !m && !t) return false;
      const matchG = !g || g === '*' || noteGroups.includes(g);
      const matchM = !m || m === '*' || noteMajors.includes(m);
      const matchT = !t || t === '*' || noteTopics.includes(t);
      return matchG && matchM && matchT;
    });
    if (hasTagGroupMatch) return true;
  }

  // 2. Check direct tag overlaps
  if (noteMajors.some(m => assignedMajors.includes(m))) return true;
  if (noteGroups.some(g => assignedGroups.includes(g))) return true;
  if (noteTopics.some(t => assignedTopics.includes(t))) return true;

  // 3. Check note title match
  if (cleanTopicName && noteTitle.includes(cleanTopicName)) return true;

  return false;
}
window.doesNoteMatchWorkstreamTags = doesNoteMatchWorkstreamTags;

/**
 * Formats a tag selection rule/group into a concise human-readable string.
 * @param {Object} rule - { group, major, topic }
 * @returns {string} e.g. "Calls / Leo", "Calls", or "All matching"
 */
function formatTagGroupSummary(rule) {
  if (!rule || typeof rule !== 'object') return '';
  const parts = [];
  if (rule.group && rule.group !== '*') parts.push(String(rule.group).trim());
  if (rule.major && rule.major !== '*') parts.push(String(rule.major).trim());
  if (rule.topic && rule.topic !== '*') parts.push(String(rule.topic).trim());
  if (parts.length === 0) {
    return (typeof t === 'function' && t('workstream.allMatching')) || 'All matching';
  }
  return parts.join(' / ');
}
window.formatTagGroupSummary = formatTagGroupSummary;

/**
 * Detects relationships (part_of, contains, matches) between a tag group rule and other workstreams.
 * @param {Object} rule - { group, major, topic }
 * @param {string} [currentWorkstreamName] - Current workstream name to avoid comparing against self.
 * @returns {Array<{ type: string, workstream: string, otherRule: Object, summary: string }>}
 */
function detectTagGroupHierarchy(rule, currentWorkstreamName = '') {
  if (!rule || typeof rule !== 'object') return [];
  const clean = s => String(s || '').trim().toLowerCase();
  const curG = clean(rule.group);
  const curM = clean(rule.major);
  const curT = clean(rule.topic);

  // If rule is unconfigured/empty, do not compute hierarchy
  if (!curG && !curM && !curT) return [];

  const curTopicName = clean(currentWorkstreamName);

  // Gather list of workstream topics from cache, index, or catalog
  const topicsList = [];
  if (typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache && Array.isArray(_topicMemoriesIndexCache.topics)) {
    _topicMemoriesIndexCache.topics.forEach(t => topicsList.push(t));
  } else if (typeof _topicMemoryFileCache !== 'undefined' && _topicMemoryFileCache instanceof Map) {
    _topicMemoryFileCache.forEach(v => topicsList.push(v));
  }

  const results = [];
  const seenWorkstreams = new Set();

  for (const topicMeta of topicsList) {
    if (!topicMeta) continue;
    const wsName = topicMeta.topicName || topicMeta.key;
    if (!wsName || clean(wsName) === curTopicName) continue;
    if (seenWorkstreams.has(clean(wsName))) continue;

    let mem = null;
    if (typeof getMajorTopicMemorySync === 'function') {
      mem = getMajorTopicMemorySync(wsName);
    }
    const mapped = mem?.mappedTags || topicMeta.mappedTags || { major_topic_tags: [], group_tags: [], topic_tags: [], tagGroups: [] };
    let otherGroups = Array.isArray(mapped.tagGroups) ? mapped.tagGroups : [];
    if (otherGroups.length === 0) {
      const g = (mapped.group_tags || [])[0] || '';
      const m = (mapped.major_topic_tags || [])[0] || '';
      const t = (mapped.topic_tags || [])[0] || '';
      if (g || m || t) {
        otherGroups = [{ group: g, major: m, topic: t }];
      }
    }

    for (const otherG of otherGroups) {
      if (!otherG) continue;
      const othG = clean(otherG.group);
      const othM = clean(otherG.major);
      const othT = clean(otherG.topic);

      const matchesField = (valSpecific, valBroad) => {
        if (!valBroad || valBroad === '*') return true;
        return valSpecific === valBroad;
      };

      // Exact match
      const isExact = (curG === othG) && (curM === othM) && (curT === othT);
      if (isExact) {
        seenWorkstreams.add(clean(wsName));
        results.push({
          type: 'matches',
          workstream: wsName,
          otherRule: otherG,
          summary: `${wsName}: ${formatTagGroupSummary(otherG)}`
        });
        break;
      }

      // Current rule is a subset of other (current is MORE SPECIFIC than other)
      const currentSatisfiesOther = matchesField(curG, othG) && matchesField(curM, othM) && matchesField(curT, othT);
      const isCurrentStrictSubset = currentSatisfiesOther && (
        (!othG && curG) || (!othM && curM) || (!othT && curT) ||
        (othG === '*' && curG !== '*') || (othM === '*' && curM !== '*') || (othT === '*' && curT !== '*')
      );

      if (isCurrentStrictSubset) {
        seenWorkstreams.add(clean(wsName));
        results.push({
          type: 'part_of',
          workstream: wsName,
          otherRule: otherG,
          summary: `${wsName}: ${formatTagGroupSummary(otherG)}`
        });
        break;
      }

      // Other rule is a subset of current (current is BROADER than other)
      const otherSatisfiesCurrent = matchesField(othG, curG) && matchesField(othM, curM) && matchesField(othT, curT);
      const isOtherStrictSubset = otherSatisfiesCurrent && (
        (!curG && othG) || (!curM && othM) || (!curT && othT) ||
        (curG === '*' && othG !== '*') || (curM === '*' && othM !== '*') || (curT === '*' && othT !== '*')
      );

      if (isOtherStrictSubset) {
        seenWorkstreams.add(clean(wsName));
        results.push({
          type: 'contains',
          workstream: wsName,
          otherRule: otherG,
          summary: `${wsName}: ${formatTagGroupSummary(otherG)}`
        });
        break;
      }
    }
  }

  return results;
}
window.detectTagGroupHierarchy = detectTagGroupHierarchy;

function renderTeamPanel() {
  refreshDecisionListFromMetadataIfAvailable();
  if (isTodoDataStillHydrating()) scheduleTeamTodosLoadingRefresh();

  const panel = document.getElementById('team-panel');
  if (!panel) return;
  
  // Clear the panel first
  panel.innerHTML = '';
  
  const fragment = document.createDocumentFragment();

  const container = document.createElement('div');
  container.style.cssText = 'flex:1; display:flex; flex-direction:column; min-height:0; overflow:hidden; width:100%;';
  container.className = 'collab-team-layout';
  fragment.appendChild(container);
  
  if (activeCollabView === 'org') {
    renderOrgView(container);
  } else if (activeCollabView === 'me') {
    renderMeView(container);
  } else {
    renderRegisterView(container);
  }

  panel.appendChild(fragment);
}

let orgZoomLevel = 1.0;
try {
  const savedZoom = localStorage.getItem('secretaryOrgZoomLevel');
  if (savedZoom) orgZoomLevel = parseFloat(savedZoom);
} catch(e) {}

let orgScrollLeft = 0;
let orgScrollTop = 0;
let orgHasStoredScrollPosition = false;
let isRestoringScroll = false;
try {
  const savedLeft = localStorage.getItem('secretaryOrgScrollLeft');
  const savedTop = localStorage.getItem('secretaryOrgScrollTop');
  if (savedLeft !== null && savedTop !== null) {
    orgScrollLeft = parseFloat(savedLeft);
    orgScrollTop = parseFloat(savedTop);
    orgHasStoredScrollPosition = true;
  }
} catch(e) {}

function saveOrgState() {
  try {
    localStorage.setItem('secretaryOrgZoomLevel', orgZoomLevel);
    localStorage.setItem('secretaryOrgScrollLeft', orgScrollLeft);
    localStorage.setItem('secretaryOrgScrollTop', orgScrollTop);
  } catch(e) {}
}

let orgSearchQuery = '';
let orgCollapsedNodes = new Set();

function renderOrgView(container) {
  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'stretch';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.position = 'relative';
  container.style.overflow = 'hidden';

  // 1. Create top bar with Search Input and Controls
  const topBar = document.createElement('div');
  topBar.className = 'org-topbar';
  topBar.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px 16px; border-bottom:1px solid var(--card-border); background:var(--card-bg-alt); gap:1rem; flex-wrap:wrap;';

  // Search input
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'display:flex; align-items:center; gap:8px; flex:1; max-width:400px; position:relative;';
  
  const cleanMeName = (colleaguesDb && colleaguesDb.me) ? (colleaguesDb.me.label || (t('team.meTab') || 'Me')) : (t('team.meTab') || 'Me');

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'topbar-search';
  searchInput.placeholder = '🔍 ' + (t('team.searchPlaceholder') || 'Search colleague or tag...');
  searchInput.value = orgSearchQuery;
  searchInput.style.cssText = 'width:100%; padding:6px 12px; font-size:0.85rem; border:1px solid var(--card-border); border-radius:4px; background:var(--card-bg); color:var(--text);';
  
  searchInput.addEventListener('input', () => {
    orgSearchQuery = searchInput.value.trim().toLowerCase();
    highlightOrgSearchMatches();
  });
  searchWrap.appendChild(searchInput);
  topBar.appendChild(searchWrap);

  // Floating controls panel
  const controlsWrap = document.createElement('div');
  controlsWrap.style.cssText = 'display:flex; align-items:center; gap:8px;';

  const zoomInBtn = document.createElement('button');
  zoomInBtn.className = 'btn btn-secondary';
  zoomInBtn.textContent = t('team.zoomIn') || 'Zoom +';
  zoomInBtn.addEventListener('click', () => {
    orgZoomLevel = Math.min(1.5, orgZoomLevel + 0.1);
    applyOrgZoom();
    saveOrgState();
  });
  
  const zoomOutBtn = document.createElement('button');
  zoomOutBtn.className = 'btn btn-secondary';
  zoomOutBtn.textContent = t('team.zoomOut') || 'Zoom -';
  zoomOutBtn.addEventListener('click', () => {
    orgZoomLevel = Math.max(0.4, orgZoomLevel - 0.1);
    applyOrgZoom();
    saveOrgState();
  });

  const fitAllBtn = document.createElement('button');
  fitAllBtn.className = 'btn btn-secondary';
  fitAllBtn.textContent = t('team.fitAll') || 'Fit All';
  fitAllBtn.title = t('team.zoomOutTrees') || 'Zoom out to see all trees';
  fitAllBtn.addEventListener('click', () => {
    orgZoomLevel = 0.5;
    applyOrgZoom();
    saveOrgState();
  });

  const centerMeBtn = document.createElement('button');
  centerMeBtn.className = 'btn btn-primary';
  centerMeBtn.textContent = t('team.centerMyTeam') || 'My Team';
  centerMeBtn.title = t('team.centerMyTeamTooltip', { name: cleanMeName }) || `Center view on ${cleanMeName} (me)`;
  centerMeBtn.addEventListener('click', () => {
    orgZoomLevel = 1.0;
    applyOrgZoom();
    saveOrgState();
    const meNode = document.querySelector('.org-node-me');
    if (meNode) {
      setTimeout(() => centerOnOrgNode(meNode), 100);
    }
  });

  const addColleagueBtn = document.createElement('button');
  addColleagueBtn.className = 'btn btn-primary';
  addColleagueBtn.innerHTML = '➕ ' + (t('team.addColleague') || 'Add Colleague');
  addColleagueBtn.addEventListener('click', async () => {
    const name = await showPromptDialog(t('team.enterColleagueName') || 'Enter the name of the new colleague:');
    if (!name) return;
    const cleanName = name.trim();
    if (!cleanName) return;
    
    const normName = cleanName.toLowerCase();
    if (colleaguesByNormLabel && colleaguesByNormLabel.has(normName)) {
      toast(t('team.colleagueAlreadyExists', { name: cleanName }) || `${cleanName} already exists`, true);
      return;
    }
    
    const id = resolveColleagueId(cleanName, { allowCreate: true });
    if (id) {
      toast(t('team.colleagueCreated', { name: cleanName }) || `Colleague ${cleanName} created!`);
      renderTeamPanel();
    }
  });

  const fragment = document.createDocumentFragment();

  controlsWrap.appendChild(zoomInBtn);
  controlsWrap.appendChild(zoomOutBtn);
  controlsWrap.appendChild(fitAllBtn);
  controlsWrap.appendChild(centerMeBtn);
  controlsWrap.appendChild(addColleagueBtn);
  topBar.appendChild(controlsWrap);
  fragment.appendChild(topBar);

  // 2. Create pan-viewport (holds draggable canvas)
  const viewport = document.createElement('div');
  viewport.className = 'org-pan-viewport';
  viewport.style.cssText = 'flex:1; width:100%; overflow:auto; position:relative; cursor:grab; background:var(--bg); user-select:none;';
  
  viewport.addEventListener('scroll', () => {
    if (!isRestoringScroll) {
      orgScrollLeft = viewport.scrollLeft;
      orgScrollTop = viewport.scrollTop;
      orgHasStoredScrollPosition = true;
      saveOrgState();
    }
  });
  
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'org-zoom-content';
  contentWrapper.style.cssText = 'transform-origin: 0 0; display:inline-block; padding:40px; min-width:100%; min-height:100%; box-sizing:border-box; transition:transform 0.15s ease-out;';
  
  const treesWrapper = document.createElement('div');
  treesWrapper.className = 'org-trees-wrapper';
  treesWrapper.style.cssText = 'display:flex; flex-direction:row; align-items:flex-start; gap:80px; justify-content:center;';

  contentWrapper.appendChild(treesWrapper);
  viewport.appendChild(contentWrapper);
  fragment.appendChild(viewport);

  // Drag-to-pan events
  let isDown = false;
  let startX, startY;
  let scrollLeft, scrollTop;

  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.org-node') || e.target.closest('button') || e.target.closest('input')) return;
    isDown = true;
    viewport.style.cursor = 'grabbing';
    startX = e.pageX - viewport.offsetLeft;
    startY = e.pageY - viewport.offsetTop;
    scrollLeft = viewport.scrollLeft;
    scrollTop = viewport.scrollTop;
  });

  viewport.addEventListener('pointerleave', () => {
    isDown = false;
    viewport.style.cursor = 'grab';
  });

  viewport.addEventListener('pointerup', () => {
    isDown = false;
    viewport.style.cursor = 'grab';
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - viewport.offsetLeft;
    const y = e.pageY - viewport.offsetTop;
    const walkX = (x - startX) * 1.5;
    const walkY = (y - startY) * 1.5;
    viewport.scrollLeft = scrollLeft - walkX;
    viewport.scrollTop = scrollTop - walkY;
  });

  // Apply active zoom
  function applyOrgZoom() {
    contentWrapper.style.transform = `scale(${orgZoomLevel})`;
  }
  applyOrgZoom();

  // Helper to center on a node
  function centerOnOrgNode(nodeEl) {
    const vpRect = viewport.getBoundingClientRect();
    const nodeRect = nodeEl.getBoundingClientRect();
    
    // Position of node relative to content wrapper
    const wrapperRect = contentWrapper.getBoundingClientRect();
    const nodeWrapperLeft = nodeEl.getBoundingClientRect().left - wrapperRect.left;
    const nodeWrapperTop = nodeEl.getBoundingClientRect().top - wrapperRect.top;
    
    const scaledX = nodeWrapperLeft * orgZoomLevel;
    const scaledY = nodeWrapperTop * orgZoomLevel;

    viewport.scrollTo({
      left: scaledX - (vpRect.width / 2) + (nodeRect.width / 2),
      top: scaledY - (vpRect.height / 2) + (nodeRect.height / 2),
      behavior: 'smooth'
    });
  }

  // 3. Render trees
  const mainRootId = getUltimateManagerId('me');
  
  const allRoots = new Set();
  allRoots.add(mainRootId);
  
  colleaguesDb.teams.forEach(t => {
    if (t.id === 'team-other-bucket') return;
    const managerId = t.managerId || ('virtual-manager-' + t.id);
    const rootId = getUltimateManagerId(managerId);
    if (rootId) {
      allRoots.add(rootId);
    }
  });

  // Render the main tree
  const mainTreeEl = renderNodeTree(mainRootId);
  if (mainTreeEl) treesWrapper.appendChild(mainTreeEl);

  // Render other unconnected trees
  allRoots.forEach(rootId => {
    if (rootId === mainRootId) return;
    const treeEl = renderNodeTree(rootId);
    if (treeEl) treesWrapper.appendChild(treeEl);
  });

  // Render "Other Bucket" / Unassigned Colleagues
  const unassignedColleagues = colleaguesDb.colleagues.filter(c => c.teamId === 'team-other-bucket' || !c.teamId);
  if (unassignedColleagues.length > 0) {
    const unassignedTree = document.createElement('div');
    unassignedTree.className = 'org-tree org-tree-unassigned';
    unassignedTree.style.cssText = 'display:flex; flex-direction:column; align-items:center;';
    
    const virtualNodeWrapper = document.createElement('div');
    virtualNodeWrapper.className = 'org-node-wrapper';
    virtualNodeWrapper.style.cssText = 'display:flex; flex-direction:column; align-items:center; position:relative;';
    
    const nodeEl = document.createElement('div');
    nodeEl.className = 'org-node org-node-virtual';
    nodeEl.style.cssText = 'border: 2px dashed var(--card-border); cursor:pointer; min-width:180px; padding:10px; border-radius:8px; background:var(--card-bg-alt); position:relative; text-align:center; display:flex; flex-direction:column; align-items:center;';
    
    const unassignedCountText = unassignedColleagues.length === 1 
      ? (t('team.colleagueCountSingle') || '1 colleague') 
      : (t('team.colleagueCount', { count: unassignedColleagues.length }) || `${unassignedColleagues.length} colleagues`);

    nodeEl.innerHTML = `
      <div class="org-node-avatar" style="background:var(--card-border); color:var(--text-muted); width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; margin-bottom:6px;">❔</div>
      <div class="org-node-name" style="font-weight:700; font-size:0.9rem; color:var(--text);">${escH(t('team.otherColleagues') || 'Other colleagues')}</div>
      <div class="org-node-title" style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${escH(unassignedCountText)}</div>
    `;
    
    const isCollapsed = orgCollapsedNodes.has('__unassigned__');
    
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'org-node-expand-btn';
    toggleBtn.style.cssText = 'position:absolute; bottom:-12px; left:50%; transform:translateX(-50%); width:20px; height:20px; border-radius:50%; border:1px solid var(--card-border); background:var(--card-bg); color:var(--text); display:flex; align-items:center; justify-content:center; font-size:0.8rem; font-weight:bold; cursor:pointer; line-height:1; padding:0; z-index:10;';
    toggleBtn.textContent = isCollapsed ? '+' : '−';
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isCollapsed) orgCollapsedNodes.delete('__unassigned__');
      else orgCollapsedNodes.add('__unassigned__');
      renderOrgView(container);
    });
    nodeEl.appendChild(toggleBtn);
    
    virtualNodeWrapper.appendChild(nodeEl);

    if (!isCollapsed) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'org-children';
      childrenContainer.style.cssText = 'display:flex; flex-direction:row; align-items:flex-start; gap:40px; margin-top:30px; position:relative;';
      
      unassignedColleagues.forEach(colleague => {
        const childWrapper = document.createElement('div');
        childWrapper.className = 'org-node-wrapper';
        childWrapper.style.cssText = 'display:flex; flex-direction:column; align-items:center; position:relative;';
        
        // Vertical line linking to virtual node
        const line = document.createElement('div');
        line.className = 'org-node-line-down';
        line.style.cssText = 'position:absolute; top:-30px; left:50%; width:2px; height:30px; background:var(--card-border);';
        childWrapper.appendChild(line);
        
        const childEl = renderCompactNodeCard(colleague.id);
        childWrapper.appendChild(childEl);
        childrenContainer.appendChild(childWrapper);
      });
      virtualNodeWrapper.appendChild(childrenContainer);
    }

    unassignedTree.appendChild(virtualNodeWrapper);
    treesWrapper.appendChild(unassignedTree);
  }

  container.appendChild(fragment);

  // Initial highlight and centering
  highlightOrgSearchMatches();
  
  if (orgHasStoredScrollPosition) {
    isRestoringScroll = true;
    viewport.scrollLeft = orgScrollLeft;
    viewport.scrollTop = orgScrollTop;
    setTimeout(() => {
      viewport.scrollLeft = orgScrollLeft;
      viewport.scrollTop = orgScrollTop;
      isRestoringScroll = false;
    }, 150);
  } else {
    const meNode = document.querySelector('.org-node-me');
    if (meNode) {
      setTimeout(() => centerOnOrgNode(meNode), 200);
    }
  }
}

function getTeamManagedBy(nodeId) {
  if (!colleaguesDb) return null;
  if (nodeId === 'me') {
    return colleaguesDb.teams.find(t => t.id === 'team-my-team');
  }
  if (typeof nodeId === 'string' && nodeId.startsWith('virtual-manager-')) {
    const teamId = nodeId.substring('virtual-manager-'.length);
    return colleaguesDb.teams.find(t => t.id === teamId);
  }
  // Check if this colleague is a manager of any team
  return colleaguesDb.teams.find(t => t.managerId === nodeId);
}

function showTeamSettingsModal(teamId) {
  const team = colleaguesDb.teams.find(t => t.id === teamId);
  if (!team) return;

  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.style.zIndex = 3000;

  const box = document.createElement('div');
  box.className = 'dialog-box';
  box.style.width = '350px';

  const title = document.createElement('div');
  title.className = 'dialog-message';
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '15px';
  const resolvedTeamName = getTeamDisplayName(team);
  title.textContent = t('team.settingsTitle', { name: resolvedTeamName }) || `Team Settings: ${resolvedTeamName}`;
  box.appendChild(title);

  // Rename Section
  const renameLabel = document.createElement('label');
  renameLabel.style.cssText = 'font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:4px;';
  renameLabel.textContent = t('team.renameLabel') || 'Team Name';
  box.appendChild(renameLabel);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'dialog-input';
  nameInput.style.cssText = 'width:100%; padding:8px; box-sizing:border-box; margin-bottom:15px; background:var(--card-bg); color:var(--text); border:1px solid var(--card-border); border-radius:4px;';
  nameInput.value = resolvedTeamName;
  box.appendChild(nameInput);

  // Leader / Manager Section
  const leaderLabel = document.createElement('label');
  leaderLabel.style.cssText = 'font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:4px;';
  leaderLabel.textContent = t('team.leaderLabel') || 'Team Leader / Manager';
  box.appendChild(leaderLabel);

  const selectRow = document.createElement('div');
  selectRow.style.cssText = 'display:flex; gap:6px; margin-bottom:20px;';

  const select = document.createElement('select');
  select.className = 'dialog-input';
  select.style.cssText = 'flex:1; padding:8px; box-sizing:border-box; background:var(--card-bg); color:var(--text); border:1px solid var(--card-border); border-radius:4px;';

  const populateOptions = () => {
    select.innerHTML = '';
    // Option: None
    const optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = t('team.notDefined') || 'Not set';
    if (!team.managerId) optNone.selected = true;
    select.appendChild(optNone);

    // Option: Me
    const optMe = document.createElement('option');
    optMe.value = 'me';
    optMe.textContent = (colleaguesDb.me.label || (t('team.meTab') || 'Me')) + ' (' + (t('team.meTab') || 'Me') + ')';
    if (team.managerId === 'me') optMe.selected = true;
    select.appendChild(optMe);

    // Options: Colleagues
    colleaguesDb.colleagues.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.label;
      if (team.managerId === c.id) opt.selected = true;
      select.appendChild(opt);
    });
  };
  populateOptions();
  selectRow.appendChild(select);

  // Add Colleague Quick Button
  const addColleagueBtn = document.createElement('button');
  addColleagueBtn.className = 'btn btn-secondary';
  addColleagueBtn.textContent = '+';
  addColleagueBtn.style.padding = '2px 10px';
  addColleagueBtn.title = t('team.addColleague') || 'Add Colleague';
  addColleagueBtn.onclick = async () => {
    const name = await showPromptDialog(t('team.enterColleagueName') || 'Enter the name of the new colleague:');
    if (!name) return;
    const cleanName = name.trim();
    if (!cleanName) return;
    
    const normName = cleanName.toLowerCase();
    if (colleaguesByNormLabel && colleaguesByNormLabel.has(normName)) {
      toast(t('team.colleagueAlreadyExists', { name: cleanName }) || `${cleanName} already exists`, true);
      return;
    }
    
    const id = resolveColleagueId(cleanName, { allowCreate: true });
    if (id) {
      toast(t('team.colleagueCreated', { name: cleanName }) || `Colleague ${cleanName} created!`);
      populateOptions();
      select.value = id;
    }
  };
  selectRow.appendChild(addColleagueBtn);
  box.appendChild(selectRow);

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = t('editor.cancel') || 'Cancel';
  cancelBtn.title = t('common.cancelTooltip') || 'Cancel';
  cancelBtn.onclick = () => {
    overlay.remove();
  };
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-save';
  saveBtn.textContent = t('todo.save') || 'Save';
  saveBtn.title = t('common.saveTooltip') || 'Save';
  saveBtn.onclick = async () => {
    const newName = nameInput.value.trim();
    const newManagerId = select.value;

    if (newName) {
      team.name = newName;
    }

    if (newManagerId !== team.managerId) {
      if (newManagerId) {
        colleaguesDb.teams.forEach(t => {
          if (t.id !== team.id && t.managerId === newManagerId) {
            t.managerId = '';
          }
        });
      }
      team.managerId = newManagerId;
    }

    await saveColleaguesDb();
    reindexColleaguesDb();
    overlay.remove();
    renderTeamPanel();
  };
  actions.appendChild(saveBtn);
  box.appendChild(actions);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function renderNodeTree(nodeId) {
  const isMe = nodeId === 'me';
  const isVirtualManager = typeof nodeId === 'string' && nodeId.startsWith('virtual-manager-');
  const rec = colleaguesById.get(nodeId);
  if (!rec && !isMe && !isVirtualManager) return null;

  const managedTeam = getTeamManagedBy(nodeId);

  const treeEl = document.createElement('div');
  treeEl.className = 'org-tree';
  treeEl.style.cssText = 'display:flex; flex-direction:column; align-items:center;';
  
  const teamBox = document.createElement('div');
  if (managedTeam) {
    teamBox.className = 'org-team-box';
    teamBox.style.cssText = 'border: 2px dashed var(--card-border); border-radius: 12px; padding: 24px; background: var(--card-bg-alt); display: flex; flex-direction: column; align-items: center; gap: 20px; position: relative; margin: 15px; transition: border-color 0.2s;';
    
    const teamLabel = document.createElement('div');
    teamLabel.style.cssText = 'position:absolute; top:-10px; left:20px; background:var(--bg); padding:2px 8px; font-size:0.75rem; font-weight:bold; color:var(--text-muted); border:1px solid var(--card-border); border-radius:4px; cursor:pointer; user-select:none;';
    const displayTeamName = getTeamDisplayName(managedTeam);
    teamLabel.textContent = displayTeamName;
    
    teamLabel.addEventListener('click', (e) => {
      e.stopPropagation();
      showTeamSettingsModal(managedTeam.id);
    });
    teamBox.appendChild(teamLabel);

    teamBox.addEventListener('click', (e) => {
      if (e.target === teamBox || (e.target.closest('.org-team-box') === teamBox && !e.target.closest('.org-node') && !e.target.closest('button'))) {
        showTeamSettingsModal(managedTeam.id);
      }
    });
  } else {
    teamBox.style.cssText = 'display:flex; flex-direction:column; align-items:center;';
  }

  const rootWrapper = document.createElement('div');
  rootWrapper.className = 'org-node-wrapper';
  rootWrapper.style.cssText = 'display:flex; flex-direction:column; align-items:center; position:relative;';
  
  const nodeEl = renderCompactNodeCard(nodeId);
  rootWrapper.appendChild(nodeEl);
  
  const directs = getColleagueDirects(nodeId);
  const isCollapsed = orgCollapsedNodes.has(nodeId);

  if (directs.length > 0) {
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'org-node-expand-btn';
    toggleBtn.style.cssText = 'position:absolute; bottom:-12px; left:50%; transform:translateX(-50%); width:20px; height:20px; border-radius:50%; border:1px solid var(--card-border); background:var(--card-bg); color:var(--text); display:flex; align-items:center; justify-content:center; font-size:0.8rem; font-weight:bold; cursor:pointer; line-height:1; padding:0; z-index:10;';
    toggleBtn.textContent = isCollapsed ? '+' : '−';
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isCollapsed) orgCollapsedNodes.delete(nodeId);
      else orgCollapsedNodes.add(nodeId);
      renderTeamPanel();
    });
    nodeEl.appendChild(toggleBtn);
  }

  teamBox.appendChild(rootWrapper);

  if (!isCollapsed && directs.length > 0) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'org-children';
    const cols = Math.min(5, directs.length);
    childrenContainer.style.cssText = `display:grid; grid-template-columns: repeat(${cols}, auto); gap:40px; margin-top:20px; position:relative; justify-content:center; align-items:start;`;
    
    directs.forEach(child => {
      const childTree = renderNodeTree(child.id);
      if (childTree) {
        const childWrapper = document.createElement('div');
        childWrapper.className = 'org-node-wrapper';
        childWrapper.style.cssText = 'display:flex; flex-direction:column; align-items:center; position:relative;';
        
        while (childTree.firstChild) {
          childWrapper.appendChild(childTree.firstChild);
        }
        childrenContainer.appendChild(childWrapper);
      }
    });
    teamBox.appendChild(childrenContainer);
  }
  
  treeEl.appendChild(teamBox);
  return treeEl;
}

function renderCompactNodeCard(nodeId) {
  const isMe = nodeId === 'me';
  const isVirtualManager = typeof nodeId === 'string' && nodeId.startsWith('virtual-manager-');
  if (isVirtualManager) {
    const teamId = nodeId.substring('virtual-manager-'.length);
    const team = colleaguesDb.teams.find(t => t.id === teamId);
    const teamName = getTeamDisplayName(team);
    
    const nodeEl = document.createElement('div');
    nodeEl.className = 'org-node org-node-virtual-manager';
    nodeEl.style.cssText = 'border: 2px dashed var(--card-border); cursor:pointer; min-width:180px; padding:10px; border-radius:8px; background:var(--card-bg-alt); position:relative; text-align:center; display:flex; flex-direction:column; align-items:center; box-sizing:border-box; transition: transform 0.15s ease, box-shadow 0.15s ease;';
    nodeEl.innerHTML = `
      <div class="org-node-avatar" style="background:var(--card-border); color:var(--text-muted); width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; margin-bottom:6px;">👑</div>
      <div class="org-node-name" style="font-weight:700; font-size:0.9rem; color:var(--text);">${escH(t('team.virtualManagerTitle', { teamName }) || `Manager (${teamName})`)}</div>
      <div class="org-node-title" style="font-size:0.75rem; color:var(--accent); font-weight:bold; margin-top:2px;">${escH(t('team.notDefined') || 'Not set')}</div>
    `;
    nodeEl.addEventListener('click', () => {
      showTeamSettingsModal(teamId);
    });
    return nodeEl;
  }

  const rec = colleaguesById.get(nodeId);
  const label = isMe ? colleaguesDb.me.label : (rec ? rec.label : nodeId);
  const color = colorForGroup(label);
  const teamId = isMe ? colleaguesDb.me.teamId : (rec ? rec.teamId : '');
  const team = colleaguesDb.teams.find(t => t.id === teamId);
  const displayTeamName = getTeamDisplayName(team);

  const nodeEl = document.createElement('div');
  nodeEl.className = 'org-node' + (isMe ? ' org-node-me' : '');
  nodeEl.style.cssText = 'border: 1px solid var(--card-border); cursor:pointer; min-width:180px; padding:10px; border-radius:8px; background:var(--card-bg); position:relative; text-align:center; display:flex; flex-direction:column; align-items:center; box-sizing:border-box; transition: transform 0.15s ease, box-shadow 0.15s ease;';
  
  nodeEl.dataset.colleagueId = nodeId;
  nodeEl.dataset.colleagueLabel = label;
  
  const tags = typeof getCollaboratorLabels === 'function' ? getCollaboratorLabels(label) : [];
  nodeEl.dataset.tags = tags.join(',');
  
  nodeEl.addEventListener('click', () => {
    showCollaboratorModal(isMe ? 'me' : label);
  });

  nodeEl.addEventListener('contextmenu', (e) => {
    if (isMe) return;
    e.preventDefault();
    if (typeof onCollaboratorCardContextMenu === 'function') {
      onCollaboratorCardContextMenu(e, label);
    }
  });

  const avatar = document.createElement('div');
  avatar.className = 'org-node-avatar';
  avatar.style.cssText = `background:${color.bg}; color:${color.text}; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; margin-bottom:6px;`;
  avatar.textContent = label.slice(0, 2).toUpperCase();
  nodeEl.appendChild(avatar);

  const nameEl = document.createElement('div');
  nameEl.className = 'org-node-name';
  nameEl.style.cssText = 'font-weight:700; font-size:0.9rem; color:var(--text);';
  nameEl.textContent = label + (isMe ? ' (Me)' : '');
  nodeEl.appendChild(nameEl);

  const managerChain = getColleagueManagerChain('me');
  const chainIndex = managerChain.indexOf(nodeId);
  
  if (chainIndex === 0) {
    const titleEl = document.createElement('div');
    titleEl.className = 'org-node-title';
    titleEl.style.cssText = 'font-size:0.75rem; color:var(--accent); font-weight:bold; margin-top:2px;';
    titleEl.textContent = `⭐ ${t('team.managerBadge') || 'Manager'}`;
    nodeEl.appendChild(titleEl);
  } else if (chainIndex > 0) {
    const titleEl = document.createElement('div');
    titleEl.className = 'org-node-title';
    titleEl.style.cssText = 'font-size:0.75rem; color:var(--accent); font-weight:bold; margin-top:2px;';
    titleEl.textContent = `⭐ Director (${chainIndex + 1}x)`;
    nodeEl.appendChild(titleEl);
  } else {
    const manages = colleaguesDb.teams.filter(t => t.managerId === nodeId);
    if (manages.length > 0) {
      const titleEl = document.createElement('div');
      titleEl.className = 'org-node-title';
      titleEl.style.cssText = 'font-size:0.75rem; color:var(--text-muted); margin-top:2px;';
      titleEl.textContent = t('team.managerBadge') || 'Manager';
      nodeEl.appendChild(titleEl);
    }
  }

  if (displayTeamName) {
    const teamEl = document.createElement('div');
    teamEl.className = 'org-node-team';
    teamEl.style.cssText = 'font-size:0.75rem; color:var(--text-muted); font-style:italic; margin-top:4px;';
    teamEl.textContent = displayTeamName;
    nodeEl.appendChild(teamEl);
  }

  return nodeEl;
}

function highlightOrgSearchMatches() {
  const nodes = document.querySelectorAll('.org-node');
  nodes.forEach(node => {
    node.classList.remove('org-node-match');
    node.style.borderColor = 'var(--card-border)';
    node.style.transform = 'none';
  });

  if (!orgSearchQuery) return;

  nodes.forEach(node => {
    const label = (node.dataset.colleagueLabel || '').toLowerCase();
    const tags = (node.dataset.tags || '').toLowerCase().split(',');
    
    const matchesLabel = label.includes(orgSearchQuery);
    const matchesTag = tags.some(t => t.includes(orgSearchQuery));
    
    if (matchesLabel || matchesTag) {
      node.classList.add('org-node-match');
      node.style.borderColor = 'var(--accent)';
      node.style.transform = 'scale(1.05)';
    }
  });
}

function renderMeView(container) {
  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.overflowY = 'auto';
  container.style.padding = '20px';
  container.style.boxSizing = 'border-box';
  container.style.gap = '1.5rem';

  const cleanName = colleaguesDb.me.label || (t('team.meTab') || 'Me');
  const color = colorForGroup(cleanName);
  const targetId = 'me';
  const currentTeamId = colleaguesDb.me.teamId || 'team-my-own-team';
  const currentTeam = colleaguesDb.teams.find(t => t.id === currentTeamId);
  const isManagerOfCurrentTeam = currentTeam ? currentTeam.managerId === 'me' : false;
  const collabTags = typeof getCollaboratorLabels === 'function' ? getCollaboratorLabels(cleanName) : [];

  // Manager Html
  const mgrId = getColleagueManagerId('me');
  let managerHtml = '';
  if (mgrId && !mgrId.startsWith('virtual-manager-')) {
    const mgrLabel = mgrId === 'me' ? (colleaguesDb.me.label) : (colleaguesById.get(mgrId)?.label || mgrId);
    const mgrNameForModal = mgrId === 'me' ? 'me' : mgrLabel;
    managerHtml = `👤 <a style="cursor:pointer; text-decoration:underline; color:var(--accent);" onclick="showCollaboratorModal('${escA(mgrNameForModal)}')">${escH(mgrLabel)}</a>`;
  } else {
    managerHtml = `<span style="color:var(--text-muted); font-style:italic;">None (Ultimate) / Non défini</span>`;
  }

  // Peers Html
  const peers = getColleaguePeers('me');
  let peersHtml = '';
  if (peers.length > 0) {
    peersHtml = peers.map(p => {
      const pName = p.id === 'me' ? 'me' : p.label;
      const label = p.id === 'me' ? `${p.label} (Me)` : p.label;
      return `<div style="display:flex; align-items:center; gap:4px; margin-bottom:4px;">👤 <a style="cursor:pointer; text-decoration:underline; color:var(--accent);" onclick="showCollaboratorModal('${escA(pName)}')">${escH(label)}</a></div>`;
    }).join('');
  } else {
    peersHtml = `<span style="color:var(--text-muted); font-style:italic;">No peers</span>`;
  }

  // Directs Html
  const directs = getColleagueDirects('me');
  let directsHtml = '';
  if (directs.length > 0) {
    directsHtml = directs.map(d => {
      const dName = d.id === 'me' ? 'me' : d.label;
      const label = d.id === 'me' ? `${d.label} (Me)` : d.label;
      return `<div style="display:flex; align-items:center; gap:4px; margin-bottom:4px;">👤 <a style="cursor:pointer; text-decoration:underline; color:var(--accent);" onclick="showCollaboratorModal('${escA(dName)}')">${escH(label)}</a></div>`;
    }).join('');
  } else {
    directsHtml = `<span style="color:var(--text-muted); font-style:italic;">No directs</span>`;
  }

  const cardHtml = `
    <div style="display:flex; align-items:center; border-bottom:1px solid var(--card-border); padding-bottom:1rem;">
      <span class="swatch" style="background:${color.bg}; color:${color.text}; width:48px; height:48px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-weight:700; font-size:1.3rem; margin-right: 1rem;">${cleanName.slice(0, 2).toUpperCase()}</span>
      <div>
        <h2 style="margin:0; font-size:1.6rem; color:var(--text);">${escH(cleanName)} <span style="font-size:1.1rem; color:var(--text-muted); font-weight:normal;">(Moi)</span></h2>
      </div>
    </div>

    <!-- Team & Role Settings -->
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem; border-bottom:1px solid var(--card-border); padding-bottom:1.5rem;">
      <div>
        <label style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:6px;">Team / Équipe</label>
        <div style="display:flex; gap:6px;">
          <select id="me-team-select" style="flex:1; padding:8px; border:1px solid var(--card-border); border-radius:4px; background:var(--card-bg); color:var(--text); font-size:0.9rem;">
            ${colleaguesDb.teams.map(team => {
              const displayTeamName = getTeamDisplayName(team);
              return `<option value="${team.id}" ${team.id === currentTeamId ? 'selected' : ''}>${escH(displayTeamName)}</option>`;
            }).join('')}
          </select>
          <button class="btn btn-secondary" id="me-create-team-btn" style="padding: 2px 10px; font-size: 0.95rem;" title="Create new team">+</button>
        </div>
      </div>
      <div>
        <label style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:6px;">Role / Rôle</label>
        <label id="me-is-manager-label" style="display:flex; align-items:center; gap:8px; cursor:${currentTeamId === 'team-other-bucket' ? 'default' : 'pointer'}; margin-top:10px; font-size:0.9rem; color:var(--text); opacity:${currentTeamId === 'team-other-bucket' ? 0.5 : 1}; pointer-events:${currentTeamId === 'team-other-bucket' ? 'none' : 'auto'};">
          <input type="checkbox" id="me-is-manager" ${isManagerOfCurrentTeam ? 'checked' : ''} ${currentTeamId === 'team-other-bucket' ? 'disabled' : ''} style="width:18px; height:18px;">
          <span>${escH(t('team.managerLabel') || 'Manager')}</span>
        </label>
      </div>
    </div>

    <!-- Tags Editor -->
    <div style="border-bottom:1px solid var(--card-border); padding-bottom:1.5rem;">
      <label style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:6px;">Tags (VIP, Important, Vite...)</label>
      <input type="text" id="me-tags-input" value="${escA(collabTags.join(', '))}" placeholder="Enter tags separated by commas..." style="width:100%; box-sizing:border-box; padding:8px; border:1px solid var(--card-border); border-radius:4px; background:var(--card-bg); color:var(--text); font-size:0.9rem;">
    </div>

    <!-- Reporting Hierarchy -->
    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:1.5rem; border-bottom:1px solid var(--card-border); padding-bottom:1.5rem;">
      <div>
        <label style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:6px;">Reports to / Manager</label>
        <div style="font-size:0.9rem; color:var(--text); margin-top:6px;">
          ${managerHtml}
        </div>
      </div>
      <div>
        <label style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:6px;">Peers / Pairs (My Peers)</label>
        <div style="font-size:0.9rem; color:var(--text); margin-top:6px; max-height: 120px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
          ${peersHtml}
        </div>
      </div>
      <div>
        <label style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:6px;">Direct Reports / Directs (My Directs)</label>
        <div style="font-size:0.9rem; color:var(--text); margin-top:6px; max-height: 120px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
          ${directsHtml}
        </div>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.style.cssText = 'max-width:800px; width:100%; margin:0 auto; display:flex; flex-direction:column; gap:1.5rem;';
  div.innerHTML = cardHtml;
  container.appendChild(div);

  // Attach Event Listeners
  const teamSelect = document.getElementById('me-team-select');
  const managerCheckbox = document.getElementById('me-is-manager');
  const tagsInput = document.getElementById('me-tags-input');
  const createTeamBtn = document.getElementById('me-create-team-btn');

  if (teamSelect) {
    teamSelect.addEventListener('change', async () => {
      const newTeamId = teamSelect.value;
      colleaguesDb.me.teamId = newTeamId;

      if (managerCheckbox) {
        const labelEl = document.getElementById('me-is-manager-label');
        if (newTeamId === 'team-other-bucket') {
          managerCheckbox.checked = false;
          managerCheckbox.disabled = true;
          if (labelEl) {
            labelEl.style.opacity = '0.5';
            labelEl.style.pointerEvents = 'none';
            labelEl.style.cursor = 'default';
          }
          const team = colleaguesDb.teams.find(t => t.id === newTeamId);
          if (team && team.managerId === 'me') team.managerId = '';
        } else {
          managerCheckbox.disabled = false;
          if (labelEl) {
            labelEl.style.opacity = '1';
            labelEl.style.pointerEvents = 'auto';
            labelEl.style.cursor = 'pointer';
          }
          const team = colleaguesDb.teams.find(t => t.id === newTeamId);
          managerCheckbox.checked = team ? team.managerId === 'me' : false;
        }
      }

      await saveColleaguesDb();
      reindexColleaguesDb();
      if (typeof renderTeamPanel === 'function') renderTeamPanel();
      if (typeof renderBoard === 'function') renderBoard();
    });
  }

  if (managerCheckbox) {
    managerCheckbox.addEventListener('change', async () => {
      const activeTeamId = teamSelect ? teamSelect.value : '';
      if (!activeTeamId || activeTeamId === 'team-other-bucket') return;

      const team = colleaguesDb.teams.find(t => t.id === activeTeamId);
      if (team) {
        if (managerCheckbox.checked) {
          team.managerId = 'me';
        } else {
          if (team.managerId === 'me') {
            team.managerId = '';
          }
        }
      }

      await saveColleaguesDb();
      reindexColleaguesDb();
      if (typeof renderTeamPanel === 'function') renderTeamPanel();
      if (typeof renderBoard === 'function') renderBoard();
    });
  }

  if (tagsInput) {
    tagsInput.addEventListener('change', async () => {
      const tags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
      setCollaboratorLabels(cleanName, tags);
      if (typeof renderTeamPanel === 'function') renderTeamPanel();
      if (typeof renderBoard === 'function') renderBoard();
    });
  }

  if (createTeamBtn) {
    createTeamBtn.addEventListener('click', async () => {
      const teamName = await showPromptDialog("Nom de la nouvelle équipe / New team name:");
      if (!teamName || !teamName.trim()) return;

      const newTeam = {
        id: 'team-' + Date.now(),
        name: teamName.trim(),
        managerId: ''
      };
      colleaguesDb.teams.push(newTeam);
      await saveColleaguesDb();
      reindexColleaguesDb();
      if (typeof renderTeamPanel === 'function') renderTeamPanel();
    });
  }
}

function renderTeamView(container) {
  const todosHydrating = isTodoDataStillHydrating();
  normalizeTeamGroupsUiState();
  const visibleGroups = getVisibleTeamGroups();
  const allCollabs = getAllKnownCollaboratorNames();
  const sortedCollabs = allCollabs.filter(name => !isCollaboratorHidden(name));
  const hiddenCollabs = allCollabs.filter(name => isCollaboratorHidden(name));
  const filteredCollabs = getCollaboratorsForActiveTeamGroup(sortedCollabs);

  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.alignItems = 'stretch';
  container.style.gap = '1rem';
  container.style.minHeight = '0';

  const mainArea = document.createElement('div');
  mainArea.className = 'collab-team-main';

  const groupTabs = document.createElement('div');
  groupTabs.className = 'collab-team-groups-tabs';

  const allTab = document.createElement('button');
  allTab.className = `md-tab${activeTeamGroupTab === '__all__' ? ' active' : ''}`;
  allTab.textContent = t('team.allColleaguesTab');
  allTab.addEventListener('click', () => {
    activeTeamGroupTab = '__all__';
    teamGroupInputMode = null;
    renderTeamPanel();
  });
  groupTabs.appendChild(allTab);

  visibleGroups.forEach(group => {
    const renameKey = `rename:${group.id}`;
    if (teamGroupInputMode === renameKey) {
      const input = document.createElement('input');
      input.className = 'collab-team-group-input';
      input.value = teamGroupInputValue || group.name;
      input.addEventListener('input', () => { teamGroupInputValue = input.value; });
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
          const result = renameTeamGroup(group.id, input.value);
          if (!result.ok) {
            toast(result.reason === 'duplicate' ? t('team.groupDuplicate') : t('team.groupNameRequired'), true);
            return;
          }
          teamGroupInputMode = null;
          teamGroupInputValue = '';
          renderTeamPanel();
        } else if (ev.key === 'Escape') {
          teamGroupInputMode = null;
          teamGroupInputValue = '';
          renderTeamPanel();
        }
      });
      input.addEventListener('blur', () => {
        teamGroupInputMode = null;
        teamGroupInputValue = '';
        renderTeamPanel();
      });
      groupTabs.appendChild(input);
      setTimeout(() => input.focus(), 0);
      return;
    }

    const tab = document.createElement('button');
    tab.className = `md-tab collab-team-group-tab${activeTeamGroupTab === group.id ? ' active' : ''}`;
    tab.textContent = group.name;
    tab.draggable = true;
    tab.dataset.groupId = group.id;
    tab.addEventListener('click', () => {
      activeTeamGroupTab = group.id;
      teamGroupInputMode = null;
      renderTeamPanel();
    });
    tab.addEventListener('contextmenu', ev => onTeamGroupTabContextMenu(ev, group.id));
    tab.addEventListener('dragstart', ev => {
      teamTabDragGroupId = group.id;
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', JSON.stringify({ type: 'team-group-order', groupId: group.id }));
    });
    tab.addEventListener('dragend', () => {
      teamTabDragGroupId = null;
      document.querySelectorAll('.collab-team-group-tab.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    tab.addEventListener('dragover', ev => {
      ev.preventDefault();
      tab.classList.add('drag-over');
    });
    tab.addEventListener('dragleave', () => tab.classList.remove('drag-over'));
    tab.addEventListener('drop', ev => {
      ev.preventDefault();
      tab.classList.remove('drag-over');

      let payload = null;
      try { payload = JSON.parse(ev.dataTransfer.getData('text/plain') || '{}'); } catch (err) {}
      if (payload?.type === 'collaborator-card' && payload?.name) {
        addCollaboratorToGroup(payload.name, group.id);
        renderTeamPanel();
        return;
      }
      if (teamTabDragGroupId && teamTabDragGroupId !== group.id) {
        moveTeamGroupBefore(teamTabDragGroupId, group.id);
        renderTeamPanel();
      }
    });

    groupTabs.appendChild(tab);
  });

  if (teamGroupInputMode === 'create') {
    const createInput = document.createElement('input');
    createInput.className = 'collab-team-group-input';
    createInput.placeholder = t('team.newGroupPlaceholder');
    createInput.value = teamGroupInputValue;
    createInput.addEventListener('input', () => { teamGroupInputValue = createInput.value; });
    createInput.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        const result = createTeamGroup(createInput.value);
        if (!result.ok) {
          toast(result.reason === 'duplicate' ? t('team.groupDuplicate') : t('team.groupNameRequired'), true);
          return;
        }
        teamGroupInputMode = null;
        teamGroupInputValue = '';
        renderTeamPanel();
      } else if (ev.key === 'Escape') {
        teamGroupInputMode = null;
        teamGroupInputValue = '';
        renderTeamPanel();
      }
    });
    createInput.addEventListener('blur', () => {
      teamGroupInputMode = null;
      teamGroupInputValue = '';
      renderTeamPanel();
    });
    groupTabs.appendChild(createInput);
    setTimeout(() => createInput.focus(), 0);
  }

  const addTab = document.createElement('button');
  addTab.className = 'md-tab collab-team-add-tab';
  addTab.textContent = '+';
  addTab.title = t('team.addGroup');
  addTab.addEventListener('click', () => {
    teamGroupInputMode = 'create';
    teamGroupInputValue = '';
    renderTeamPanel();
  });
  groupTabs.appendChild(addTab);

  mainArea.appendChild(groupTabs);

  const searchRow = document.createElement('div');
  searchRow.style.cssText = 'position:relative; margin:0.7rem 0 1rem 0;';

  const searchInput = document.createElement('input');
  searchInput.className = 'tag-add';
  searchInput.placeholder = t('team.searchOrCreateCollaborator') || 'Type to filter or create a colleague';
  searchInput.title = t('team.searchOrCreateCollaborator') || 'Type to filter or create a colleague';
  searchInput.value = collabSearchQuery || '';

  let searchDropdown = null;
  const closeSearchDropdown = () => {
    if (searchDropdown) {
      searchDropdown.remove();
      searchDropdown = null;
    }
  };

  const renderSearchDropdown = (filterRaw = '') => {
    const filter = String(filterRaw || '').trim().toLowerCase();
    const records = getAllKnownCollaboratorNames();
    const matches = !filter ? records : records.filter(name => name.toLowerCase().includes(filter));

    if (!searchDropdown) {
      searchDropdown = document.createElement('div');
      searchDropdown.className = 'tag-suggest-dropdown';
      document.body.appendChild(searchDropdown);
    }
    searchDropdown.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'tag-suggest-section';
    header.textContent = t('team.collaboratorsLabel') || 'Collaborators';
    searchDropdown.appendChild(header);

    if (filter && !records.some(name => name.toLowerCase() === filter)) {
      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.className = 'tag-suggest-chip suggestion';
      createBtn.textContent = `+ ${filterRaw.trim()}`;
      createBtn.title = t('common.pressEnterToAdd', { value: filterRaw.trim() }) || `Create ${filterRaw.trim()}`;
      createBtn.addEventListener('mousedown', ev => {
        ev.preventDefault();
        if (addCollaboratorsToRegistry([filterRaw.trim()])) {
          collabSearchQuery = filterRaw.trim();
        }
        closeSearchDropdown();
        renderTeamPanel();
      });
      const createRow = document.createElement('div');
      createRow.className = 'tag-suggest-chips';
      createRow.appendChild(createBtn);
      searchDropdown.appendChild(createRow);
    }

    const chips = document.createElement('div');
    chips.className = 'tag-suggest-chips';
    matches.forEach(name => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-suggest-chip';
      btn.textContent = name;
      btn.addEventListener('mousedown', ev => {
        ev.preventDefault();
        collabSearchQuery = name;
        closeSearchDropdown();
        renderTeamPanel();
      });
      chips.appendChild(btn);
    });

    if (chips.childElementCount > 0) {
      searchDropdown.appendChild(chips);
    } else {
      const empty = document.createElement('div');
      empty.className = 'tag-suggest-empty';
      empty.textContent = filter
        ? (t('common.pressEnterToAdd', { value: filterRaw.trim() }) || `Press Enter to add "${filterRaw.trim()}"`)
        : (t('team.noKnownCollaborators') || 'No known collaborators.');
      searchDropdown.appendChild(empty);
    }

    const rect = searchRow.getBoundingClientRect();
    searchDropdown.style.top = `${rect.bottom + 4}px`;
    searchDropdown.style.left = `${rect.left}px`;
    searchDropdown.style.minWidth = `${Math.max(320, rect.width)}px`;
  };

  searchInput.addEventListener('focus', () => renderSearchDropdown(searchInput.value));
  searchInput.addEventListener('input', () => {
    collabSearchQuery = searchInput.value;
    applySearchFilter();
    renderSearchDropdown(searchInput.value);
  });
  searchInput.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      closeSearchDropdown();
      searchInput.blur();
      return;
    }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const typed = searchInput.value.trim();
    if (!typed) return;
    const existing = getAllKnownCollaboratorNames().find(name => name.toLowerCase() === typed.toLowerCase());
    if (existing) {
      collabSearchQuery = existing;
    } else if (addCollaboratorsToRegistry([typed])) {
      collabSearchQuery = typed;
    }
    closeSearchDropdown();
    renderTeamPanel();
  });
  searchInput.addEventListener('blur', () => {
    setTimeout(() => closeSearchDropdown(), 140);
  });

  searchRow.appendChild(searchInput);
  mainArea.appendChild(searchRow);

  if (todosHydrating) {
    const loading = document.createElement('div');
    loading.style.cssText = 'margin:0 0 0.8rem 0; color:var(--text-muted); font-size:0.82rem; font-style:italic;';
    loading.innerHTML = `${escH(t('common.loading'))} ${escH(t('team.delegatedTasks').toLowerCase())}<span class="opb-loading-dots" aria-hidden="true"></span>`;
    mainArea.appendChild(loading);
  }

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:1.5rem; width:100%; padding-bottom:2rem;';

  const applySearchFilter = () => {
    const query = String(collabSearchQuery || '').trim().toLowerCase();
    [...grid.querySelectorAll('.collab-item-card[data-collaborator]')].forEach(card => {
      const name = String(card.dataset.collaborator || '').toLowerCase();
      card.style.display = !query || name.includes(query) ? '' : 'none';
    });
  };
  
  filteredCollabs.forEach(name => {
    const col = collaboratorsMap[name] || { agenda: [], delegations: [] };
    const card = document.createElement('div');
    card.className = 'collab-item-card';
    card.draggable = true;
    card.dataset.collaborator = name;
    card.style.cssText = 'padding:1.2rem; display:flex; flex-direction:column; gap:0.8rem;';
    card.title = t('team.openCollaboratorDetailsTitle');
    card.addEventListener('dragstart', ev => {
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData('text/plain', JSON.stringify({ type: 'collaborator-card', name }));
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('contextmenu', e => onCollaboratorCardContextMenu(e, name));
    card.addEventListener('dblclick', () => showCollaboratorModal(name));
    
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
    
    const nameWrap = document.createElement('div');
    nameWrap.style.cssText = 'display:flex; align-items:center; gap:0.6rem;';
    
    const color = colorForGroup(name);
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.cssText = `background:${color.bg}; color:${color.text}; width:28px; height:28px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-weight:700; font-size:0.8rem;`;
    swatch.textContent = name.slice(0, 2).toUpperCase();
    
    const nameEl = document.createElement('strong');
    nameEl.style.cssText = 'font-size:1.1rem; color:var(--text); text-transform:capitalize;';
    nameEl.textContent = name;
    
    nameWrap.appendChild(swatch);
    nameWrap.appendChild(nameEl);
    
    const upcomingSyncEvents = getUpcomingCollaboratorPlannerEvents(name, { syncOnly: true });
    const hasUpcomingSync = upcomingSyncEvents.length > 0;
    const nextSyncEvent = hasUpcomingSync ? upcomingSyncEvents[0] : null;
    const nextSyncSeries = nextSyncEvent ? getPlannerSeriesInfo(nextSyncEvent) : null;

    const actionsWrap = document.createElement('div');
    actionsWrap.style.cssText = 'display:flex; align-items:center; gap:0.4rem;';
    if (!hasUpcomingSync) {
      const syncBtn = document.createElement('button');
      syncBtn.className = 'btn team-action-btn';
      syncBtn.textContent = t('team.syncButton');
      syncBtn.title = t('team.syncButtonTitle');
      syncBtn.addEventListener('click', () => {
        createSyncNoteForCollaborator(name);
      });
      actionsWrap.appendChild(syncBtn);
    }
    
    headerRow.appendChild(nameWrap);
    headerRow.appendChild(actionsWrap);
    card.appendChild(headerRow);
    
    const syncMeta = document.createElement('div');
    syncMeta.style.cssText = 'font-size:0.8rem; color:var(--text-muted); display:flex; flex-direction:column; gap:0.2rem;';
    if (nextSyncEvent) {
      const nextSyncNote = getPlannerEventLinkedNote(nextSyncEvent);
      const cadence = nextSyncSeries && nextSyncSeries.cadence ? `, ${nextSyncSeries.cadence}` : '';
      const seriesText = nextSyncSeries
        ? t('team.instanceInSeries', { count: nextSyncSeries.upcomingCount, cadence })
        : t('team.singleBlock');
      if (nextSyncNote && nextSyncNote.path) {
        syncMeta.innerHTML = `
          <div><strong>${escH(t('team.nextSync'))}:</strong> <a style="cursor:pointer; text-decoration:underline; font-weight:600; color:var(--accent);" onclick="openNoteOverlay('${escA(nextSyncNote.path)}')">${escH(nextSyncEvent.date)} · ${escH(nextSyncEvent.startTime)} - ${escH(nextSyncEvent.endTime)}</a></div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${escH(seriesText)}</div>
        `;
      } else {
        syncMeta.innerHTML = `
          <div><strong>${escH(t('team.nextSync'))}:</strong> ${escH(nextSyncEvent.date)} · ${escH(nextSyncEvent.startTime)} - ${escH(nextSyncEvent.endTime)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${escH(seriesText)}</div>
        `;
      }
    } else {
      syncMeta.textContent = t('team.nextSyncNonePlanned');
    }
    card.appendChild(syncMeta);

    const delegatedTasks = (col.delegations || []).filter(d => (d.status || '').toLowerCase() !== 'done');

    const taskHeader = document.createElement('div');
    taskHeader.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:0.4rem; border-top:1px solid var(--card-border); padding-top:0.6rem; margin-top:0.4rem;';
    const taskHeaderTitle = document.createElement('div');
    taskHeaderTitle.style.cssText = 'font-size:0.82rem; font-weight:700; text-transform:uppercase; color:var(--text-muted);';
    taskHeaderTitle.textContent = `${t('team.delegatedTasks')} (${delegatedTasks.length})`;
    taskHeader.appendChild(taskHeaderTitle);
    card.appendChild(taskHeader);

    const assignTaskBtn = document.createElement('button');
    assignTaskBtn.className = 'btn team-action-btn team-assign-task-btn';
    assignTaskBtn.textContent = t('team.assignTask');
    assignTaskBtn.title = t('team.assignTaskTooltip');
    assignTaskBtn.addEventListener('click', () => assignTaskToCollaborator(name));

    if (delegatedTasks.length === 0) {
      if (todosHydrating) {
        const loadingTasks = document.createElement('div');
        loadingTasks.style.cssText = 'font-size:0.8rem; color:var(--text-muted); font-style:italic; margin:0.1rem 0 0.35rem 0;';
        loadingTasks.innerHTML = `${escH(t('common.loading'))}<span class="opb-loading-dots" aria-hidden="true"></span>`;
        card.appendChild(loadingTasks);
      }
      card.appendChild(assignTaskBtn);
    } else {
      const taskList = document.createElement('div');
      taskList.style.cssText = 'display:flex; flex-direction:column; gap:0.4rem; max-height:120px; overflow-y:auto;';
      delegatedTasks.slice(0, 5).forEach(d => {
        const item = document.createElement('div');
        item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; font-size:0.82rem; padding:4px 6px; background:var(--card-bg-alt); border-radius:4px; border:1px solid var(--card-border);';
        if (d.todoId) {
          item.style.cursor = 'pointer';
          item.addEventListener('click', () => openTodoOverlay(d.todoId));
        }
        
        const titleSpan = document.createElement('span');
        titleSpan.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; margin-right:0.5rem;';
        titleSpan.textContent = d.text || t('todo.newShort');
        
        const badgeSpan = document.createElement('span');
        const rawStatus = String(d.status || 'pending').toLowerCase();
        const statusClass = rawStatus === 'done'
          ? 'done'
          : rawStatus === 'wip'
            ? 'wip'
            : rawStatus === 'high'
              ? 'high'
              : rawStatus === 'medium'
                ? 'med'
                : rawStatus === 'low'
                  ? 'low'
                  : 'pending';
        const status = d.status || t('team.pendingStatus');
        badgeSpan.className = `sl-badge sl-badge-${statusClass}`;
        badgeSpan.style.cssText = 'font-size:0.65rem; padding:1px 4px;';
        badgeSpan.textContent = status;
        
        item.appendChild(titleSpan);
        item.appendChild(badgeSpan);
        taskList.appendChild(item);
      });
      if (delegatedTasks.length > 5) {
        const more = document.createElement('div');
        more.style.cssText = 'font-size:0.75rem; color:var(--text-muted); text-align:right;';
        more.textContent = t('team.moreTasks', { value: delegatedTasks.length - 5 });
        taskList.appendChild(more);
      }
      if (todosHydrating) {
        const loadingTail = document.createElement('div');
        loadingTail.style.cssText = 'font-size:0.72rem; color:var(--text-muted); text-align:right; font-style:italic;';
        loadingTail.innerHTML = `${escH(t('common.loading'))}<span class="opb-loading-dots" aria-hidden="true"></span>`;
        taskList.appendChild(loadingTail);
      }
      card.appendChild(taskList);
      card.appendChild(assignTaskBtn);
    }

    const isExpanded = false;

    if (isExpanded) {
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'collab-card-details';
      detailsDiv.style.cssText = 'display:flex; flex-direction:column; gap:0.8rem; border-top:1px solid var(--card-border); padding-top:0.8rem; margin-top:0.4rem;';

      // Query sync meetings explicitly (where group tag is Sync and topic tag matches name)
      const syncMeetings = manifest.filter(n => {
        const isSyncGroup = (n.group_tags || []).some(g => g.toLowerCase() === 'sync');
        const hasTopic = (n.topic_tags || []).some(t => t.toLowerCase() === name.toLowerCase());
        return isSyncGroup && hasTopic;
      });
      syncMeetings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      // Query other meetings where colleague is tagged or mentioned
      const taggedNotes = manifest.filter(n => {
        if (syncMeetings.some(sm => sm.id === n.id)) return false;
        const hasTopic = (n.topic_tags || []).some(t => t.toLowerCase() === name.toLowerCase());
        const cached = collaborativeDataCache[n.path];
        const hasMention = cached && (
          (cached.mentions || []).some(m => m.collaborator.toLowerCase() === name.toLowerCase()) ||
          (cached.delegations || []).some(d => d.collaborator.toLowerCase() === name.toLowerCase())
        );
        return hasTopic || hasMention;
      });
      taggedNotes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      // Query future planned blocs
      const todayStr = formatLocalDateValue(new Date());
      const nextBlocs = (typeof plannerEvents !== 'undefined')
        ? plannerEvents.filter(e => {
            const isCollab = extractPlannerCollaborators(e).some(c => normalizeCollaboratorKey(c) === normalizeCollaboratorKey(name));
            return isCollab && e.date >= todayStr;
          })
        : [];
      nextBlocs.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

      // Render Next Blocs
      const blocsHeader = document.createElement('div');
      blocsHeader.style.cssText = 'font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:-0.2rem;';
      blocsHeader.textContent = t('team.nextPlannedBlocks');
      detailsDiv.appendChild(blocsHeader);

      if (nextBlocs.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:0.78rem; color:var(--text-muted); font-style:italic;';
        empty.textContent = t('team.noUpcomingPlannedBlocks');
        detailsDiv.appendChild(empty);
      } else {
        const list = document.createElement('div');
        list.style.cssText = 'display:flex; flex-direction:column; gap:0.3rem; max-height:120px; overflow-y:auto;';
        nextBlocs.forEach(b => {
          const item = document.createElement('div');
          item.style.cssText = 'font-size:0.82rem; padding:4px 6px; background:var(--card-bg-alt); border-radius:4px; border:1px solid var(--card-border);';
          item.innerHTML = `<strong>${escH(b.title || t('team.blockLabel'))}</strong> <span style="font-size:0.7rem; color:var(--text-muted);">(${escH(b.date)} · ${escH(b.startTime)} - ${escH(b.endTime)})</span>`;
          list.appendChild(item);
        });
        detailsDiv.appendChild(list);
      }

      // Render Sync Meetings
      const syncHeader = document.createElement('div');
      syncHeader.style.cssText = 'font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:-0.2rem;';
      syncHeader.textContent = t('team.syncMeetingsLabel');
      detailsDiv.appendChild(syncHeader);

      if (syncMeetings.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:0.78rem; color:var(--text-muted); font-style:italic;';
        empty.textContent = t('team.noSyncMeetings');
        detailsDiv.appendChild(empty);
      } else {
        const list = document.createElement('div');
        list.style.cssText = 'display:flex; flex-direction:column; gap:0.3rem; max-height:120px; overflow-y:auto;';
        syncMeetings.forEach(n => {
          const item = document.createElement('div');
          item.style.cssText = 'font-size:0.82rem; padding:4px 6px; background:var(--card-bg-alt); border-radius:4px; border:1px solid var(--card-border);';
          item.innerHTML = `<a style="cursor:pointer; text-decoration:underline; font-weight:600; color:var(--accent);" onclick="openNoteOverlay('${escA(n.path)}')">${escH(n.title)}</a> <span style="font-size:0.7rem; color:var(--text-muted);">(${escH(n.date)})</span>`;
          list.appendChild(item);
        });
        detailsDiv.appendChild(list);
      }

      // Render Tagged Meetings
      const taggedHeader = document.createElement('div');
      taggedHeader.style.cssText = 'font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:-0.2rem;';
      taggedHeader.textContent = t('team.taggedMeetingsMentions');
      detailsDiv.appendChild(taggedHeader);

      if (taggedNotes.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:0.78rem; color:var(--text-muted); font-style:italic;';
        empty.textContent = t('team.noTagsOrMentions');
        detailsDiv.appendChild(empty);
      } else {
        const list = document.createElement('div');
        list.style.cssText = 'display:flex; flex-direction:column; gap:0.3rem; max-height:120px; overflow-y:auto;';
        taggedNotes.forEach(n => {
          const item = document.createElement('div');
          item.style.cssText = 'font-size:0.82rem; padding:4px 6px; background:var(--card-bg-alt); border-radius:4px; border:1px solid var(--card-border);';
          item.innerHTML = `<a style="cursor:pointer; text-decoration:underline; font-weight:600; color:var(--accent);" onclick="openNoteOverlay('${escA(n.path)}')">${escH(n.title)}</a> <span style="font-size:0.7rem; color:var(--text-muted);">(${escH(n.date)})</span>`;
          list.appendChild(item);
        });
        detailsDiv.appendChild(list);
      }

      card.appendChild(detailsDiv);
    }
    
    grid.appendChild(card);
  });

  if (filteredCollabs.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center; color:var(--text-muted); padding:3rem; width:100%;';
    if (activeTeamGroupTab !== '__all__') {
      empty.textContent = t('team.noCollaboratorsInGroup');
    } else {
      empty.textContent = hiddenCollabs.length > 0
        ? t('team.allCollaboratorsHidden')
        : t('team.noCollaborators');
    }
    mainArea.appendChild(empty);
  } else {
    mainArea.appendChild(grid);
  }

  applySearchFilter();

  container.appendChild(mainArea);
  renderCollaboratorManagerSidebar(container, allCollabs, sortedCollabs, hiddenCollabs);
}

function getTeamPlannerEventsForCollaborators(names) {
  const normalized = new Set((Array.isArray(names) ? names : [])
    .map(n => normalizeCollaboratorKey(n))
    .filter(Boolean));
  const today = formatLocalDateValue(new Date());
  if (!normalized.size || !Array.isArray(plannerEvents)) return [];

  return plannerEvents
    .filter(event => {
      if (!event || !event.date || event.date < today) return false;
      const collaborators = extractPlannerCollaborators(event).map(n => normalizeCollaboratorKey(n));
      return collaborators.some(n => normalized.has(n));
    })
    .sort((a, b) => {
      const byDate = String(a.date || '').localeCompare(String(b.date || ''));
      if (byDate !== 0) return byDate;
      const byTime = String(a.startTime || '').localeCompare(String(b.startTime || ''));
      if (byTime !== 0) return byTime;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
}

function openPlannerFromTeamEvent(eventId, date) {
  if (date) plannerInitialFocusDate = date;
  if (eventId) selectedPlannerEventId = eventId;
  switchTab('planner');
}

function renderTeamPlannerSidebar(parent, visibleCollaborators) {
  const sidebar = document.createElement('aside');
  sidebar.className = 'team-planner-sidebar collapsible-sidebar';

  const header = document.createElement('div');
  header.className = 'collab-sidebar-toggle-header';
  header.title = teamPlannerPaneOpen ? (t('common.collapseSidebar') || 'Click to collapse sidebar') : (t('common.expandSidebar') || 'Click to expand sidebar');
  header.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTeamPlannerPane();
  });

  const label = document.createElement('span');
  label.className = 'collab-sidebar-toggle-label';
  const plannerPanelLabel = t('planner.panel');
  label.textContent = (!plannerPanelLabel || plannerPanelLabel === 'planner.panel') ? 'Planner' : plannerPanelLabel;

  const chevron = document.createElement('span');
  chevron.className = 'collab-sidebar-toggle-chevron';
  chevron.textContent = teamPlannerPaneOpen ? '›' : '‹';

  header.appendChild(label);
  header.appendChild(chevron);
  sidebar.appendChild(header);

  if (!teamPlannerPaneOpen) {
    sidebar.classList.add('collapsed');
    sidebar.title = t('common.expandSidebar') || 'Click to expand sidebar';
    sidebar.addEventListener('click', () => {
      if (!teamPlannerPaneOpen) toggleTeamPlannerPane();
    });
    parent.appendChild(sidebar);
    return;
  }

  const body = document.createElement('div');
  body.className = 'team-planner-sidebar-body';

  const events = getTeamPlannerEventsForCollaborators(visibleCollaborators).slice(0, 25);
  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'collab-manager-empty';
    empty.textContent = t('team.noUpcomingPlannedBlocks') || 'No upcoming planned blocks.';
    body.appendChild(empty);
    sidebar.appendChild(body);
    parent.appendChild(sidebar);
    return;
  }

  events.forEach(event => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'team-planner-event-item';
    item.title = t('planner.openOnPlannerTooltip') || 'Open in planner';
    item.addEventListener('click', () => openPlannerFromTeamEvent(event.id, event.date));

    const title = document.createElement('div');
    title.className = 'team-planner-event-title';
    title.textContent = event.title || t('team.blockLabel');

    const meta = document.createElement('div');
    meta.className = 'team-planner-event-meta';
    const typeLabel = event.type || 'work';
    meta.textContent = `${event.date || ''} · ${event.startTime || ''}-${event.endTime || ''} · ${typeLabel}`;

    item.appendChild(title);
    item.appendChild(meta);
    body.appendChild(item);
  });

  const openPlannerBtn = document.createElement('button');
  openPlannerBtn.type = 'button';
  openPlannerBtn.className = 'btn team-action-btn team-action-btn-secondary';
  openPlannerBtn.textContent = t('planner.tab') || 'Open Planner';
  openPlannerBtn.addEventListener('click', () => switchTab('planner'));
  body.appendChild(openPlannerBtn);

  sidebar.appendChild(body);
  parent.appendChild(sidebar);
}

let registrySearchQuery = '';
let registryStatusFilter = 'all'; // 'all' | 'active' | 'proposed' | 'superseded'
let registryViewMode = 'cards'; // 'cards' | 'compact' | 'timeline' | 'kanban' | 'analytics'
let registryAuthorityFilter = 'all'; // 'all' | 'manager'
let registryImpactFilter = 'all'; // 'all' | 'high' | 'med' | 'low'
let favoriteRegistryProjects = new Set();
let pendingDecisionsList = [];
let _draggedWorkstreamTab = null;
let workstreamCustomOrder = [];

function getWsIcon(name, size = 15, className = "") {
  return typeof AppIcons !== "undefined" ? AppIcons.get(name, { size, className }) : "";
}
try {
  const savedOrder = localStorage.getItem('secretaryWorkstreamOrder');
  if (savedOrder) {
    const parsed = JSON.parse(savedOrder);
    if (Array.isArray(parsed)) workstreamCustomOrder = parsed;
  }
} catch (e) {}

function saveWorkstreamOrder(order) {
  workstreamCustomOrder = order;
  try {
    localStorage.setItem('secretaryWorkstreamOrder', JSON.stringify(order));
  } catch (e) {}
}


function openDecisionNoteOverlay(notePath) {
  window._collabReturnContext = { restore: true, collabView: 'registry' };
  if (typeof openNoteOverlay === 'function') openNoteOverlay(notePath);
}
window.openDecisionNoteOverlay = openDecisionNoteOverlay;

function copyDecisionToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      if (typeof toast === 'function') toast(t('team.decisionCopied') || 'Décision copiée dans le presse-papier !');
    }).catch(() => {});
  }
}
window.copyDecisionToClipboard = copyDecisionToClipboard;

function copyDecisionHashLink(decId) {
  const url = `${window.location.origin}${window.location.pathname}#tab=decisions&dec=${encodeURIComponent(decId)}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      if (typeof toast === 'function') toast(t('team.linkCopied') || 'Lien direct copié !');
    }).catch(() => {});
  }
}
window.copyDecisionHashLink = copyDecisionHashLink;

function toggleFavoriteProject(major) {
  if (favoriteRegistryProjects.has(major)) favoriteRegistryProjects.delete(major);
  else favoriteRegistryProjects.add(major);
  const container = document.querySelector('.collab-team-layout');
  if (container) renderRegisterView(container);
}
window.toggleFavoriteProject = toggleFavoriteProject;

async function promoteProposedDecisionToActive(decId) {
  let dec = pendingDecisionsList.find(d => (d.id && d.id === decId) || d.text === decId);
  if (!dec) dec = decisionsList.find(d => (d.id && d.id === decId) || d.text === decId);

  if (dec) {
    const decisionText = dec.text || decId;
    const notePaths = [];
    for (const n of [...(dec.takenNotes || []), ...(dec.linkedNotes || [])]) {
      if (n && n.notePath && !notePaths.includes(n.notePath)) notePaths.push(n.notePath);
    }
    if (!notePaths.length && dec.notePath) notePaths.push(dec.notePath);

    if (notePaths.length && typeof updateDecisionStatusInFile === 'function') {
      for (const p of notePaths) {
        try {
          await updateDecisionStatusInFile(p, decisionText, 'active');
          const meta = (typeof getMetaByPath === 'function') ? getMetaByPath(p) : null;
          if (meta && Array.isArray(meta.decisions) && typeof upsertMeta === 'function') {
            const updated = meta.decisions.map(d =>
              String(d.text || '').trim() === String(decisionText || '').trim()
                ? { ...d, status: 'active' }
                : d);
            upsertMeta({ ...meta, decisions: updated, decisionsReady: true, modified: new Date().toISOString() });
          }
        } catch (e) {
          console.error('Failed to update decision status in file:', p, e);
        }
      }
    }
  }

  const pendingIndex = pendingDecisionsList.findIndex(d => d.id === decId || d.text === decId);
  if (pendingIndex !== -1) {
    const item = pendingDecisionsList.splice(pendingIndex, 1)[0];
    item.status = 'active';
    item.date = new Date().toISOString().slice(0, 10);
    decisionsList.unshift(item);
  } else {
    const item = decisionsList.find(d => d.id === decId || d.text === decId);
    if (item) item.status = 'active';
  }
  if (typeof toast === 'function') toast(t('team.decisionValidated') || 'Décision validée et activée !');
  const container = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
  if (container) renderRegisterView(container);
}
window.promoteProposedDecisionToActive = promoteProposedDecisionToActive;

function openNewProposedDecisionDialog(defaultMajor = '') {
  const newDec = {
    id: `prop-${Date.now()}`,
    text: '',
    status: 'proposed',
    isLinked: false,
    noteId: '',
    noteTitle: t('team.proposedDecisionNoteTitle') || 'Décision proposée',
    notePath: '',
    date: new Date().toISOString().slice(0, 10),
    major_topic_tags: [(defaultMajor || (typeof selectedRegistryProject !== 'undefined' && selectedRegistryProject !== REGISTRY_ALL_PROJECTS_KEY ? selectedRegistryProject : 'General')) || 'General'],
    topic_tags: [],
    authority: 'team',
    impact: 'high',
    rationale: '',
    isNew: true
  };

  openEditDecisionModal(newDec);
}
window.openNewProposedDecisionDialog = openNewProposedDecisionDialog;

function openExportDecisionsModal() {
  if (typeof openModal === 'function') {
    openModal('modal-export-decisions');
  } else {
    const modal = document.getElementById('modal-export-decisions');
    if (modal) modal.classList.add('active');
  }
}
window.openExportDecisionsModal = openExportDecisionsModal;

function confirmExportDecisions() {
  const selectedFormat = document.querySelector('input[name="export-format"]:checked')?.value || 'md';
  if (selectedFormat === 'json') exportDecisionsAsJSON();
  else if (selectedFormat === 'csv') exportDecisionsAsCSV();
  else exportDecisionsAsMarkdown();

  if (typeof closeModal === 'function') {
    closeModal('modal-export-decisions');
  } else {
    const modal = document.getElementById('modal-export-decisions');
    if (modal) modal.classList.remove('active');
  }
  if (typeof toast === 'function') {
    toast(t('team.exportSuccessToast') || 'Fichier d\'exportation généré avec succès !');
  }
}
window.confirmExportDecisions = confirmExportDecisions;

function exportDecisionsAsMarkdown() {
  refreshDecisionListFromMetadataIfAvailable();
  const allDecs = [...pendingDecisionsList, ...decisionsList];
  let md = `# 📜 ${t('team.decisionsRegistryExportTitle') || 'Decisions Registry'} — ${new Date().toISOString().slice(0, 10)}\n\n`;
  
  allDecs.forEach((d, idx) => {
    const statusIcon = d.status === 'proposed' ? `⏳ ${t('team.filterProposed') || 'Proposed'}` : d.status === 'superseded' ? `↩ ${t('team.filterSuperseded') || 'Superseded'}` : `✓ ${t('team.filterActive') || 'Active'}`;
    const auth = d.authority === 'manager' ? ' [👔 Manager]' : '';
    const imp = d.impact === 'high' ? ' [🔴 High Impact]' : '';
    md += `### ${idx + 1}. ${d.text}\n`;
    md += `- **${t('team.status') || 'Status'}:** ${statusIcon}${auth}${imp}\n`;
    md += `- **${t('team.date') || 'Date'}:** ${d.date || 'N/A'}\n`;
    md += `- **${t('team.project') || 'Project'}:** ${(d.major_topic_tags || []).join(', ') || t('common.general') || 'General'}\n`;
    if (d.noteTitle) md += `- **${t('team.sourceNote') || 'Source'}:** ${d.noteTitle}\n`;
    md += `\n`;
  });

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `decisions-export-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
window.exportDecisionsAsMarkdown = exportDecisionsAsMarkdown;

function exportDecisionsAsJSON() {
  refreshDecisionListFromMetadataIfAvailable();
  const allDecs = [...pendingDecisionsList, ...decisionsList];
  const jsonStr = JSON.stringify(allDecs, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `decisions-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
window.exportDecisionsAsJSON = exportDecisionsAsJSON;

function exportDecisionsAsCSV() {
  refreshDecisionListFromMetadataIfAvailable();
  const allDecs = [...pendingDecisionsList, ...decisionsList];
  
  const headers = ['ID', 'Date', 'Statut', 'Autorite', 'Impact', 'Projet', 'Decision', 'Source'];
  const rows = allDecs.map(d => [
    `"${String(d.id || '').replace(/"/g, '""')}"`,
    `"${String(d.date || '').replace(/"/g, '""')}"`,
    `"${String(d.status || '').replace(/"/g, '""')}"`,
    `"${String(d.authority || '').replace(/"/g, '""')}"`,
    `"${String(d.impact || '').replace(/"/g, '""')}"`,
    `"${(Array.isArray(d.major_topic_tags) ? d.major_topic_tags.join('; ') : String(d.project || 'General')).replace(/"/g, '""')}"`,
    `"${String(d.text || '').replace(/"/g, '""')}"`,
    `"${String(d.noteTitle || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `decisions-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
window.exportDecisionsAsCSV = exportDecisionsAsCSV;

let editingDecisionRef = null;
let editingDecisionElement = null; // inline .note-decision-wrapper span when editing a note decision
let editingDecisionMode = 'registry'; // 'registry' | 'note'
let editingDecisionOriginalText = ''; // decision text at open time, used to match spans in note files
let editingDecisionAssocNotes = []; // working list of associated notes
let editingDecisionRemovedNotes = []; // notes removed during this modal session

// Note paths a (grouped) registry decision is recorded in, so edits can be written back to disk.
function _decisionNotePaths(dec) {
  const paths = [];
  const add = (p) => { const v = String(p || '').trim(); if (v && !paths.includes(v)) paths.push(v); };
  if (dec) {
    for (const n of [...(dec.takenNotes || []), ...(dec.linkedNotes || [])]) add(n && n.notePath);
    add(dec.notePath);
  }
  return paths;
}

// Notes that contain the decision currently being edited (deduped by note path).
function _decisionModalAssocNoteEntries() {
  const decText = editingDecisionRef?.text || '';
  if (!decText || typeof getAllMetadataDecisionEntries !== 'function') return [];
  const norm = decText.trim().toLowerCase();
  const byPath = new Map();
  for (const e of getAllMetadataDecisionEntries()) {
    if (String(e.text || '').trim().toLowerCase() !== norm) continue;
    if (e.notePath && !byPath.has(e.notePath)) byPath.set(e.notePath, e);
  }
  return Array.from(byPath.values());
}

function openEditDecisionModal(dec, options = {}) {
  if (!dec) return;
  editingDecisionRef = dec;
  editingDecisionElement = options.element || null;
  editingDecisionMode = options.mode || 'registry';
  editingDecisionOriginalText = dec.text || '';
  editingDecisionRemovedNotes = [];

  // Populate working list of associated notes
  const existingNotes = _decisionModalAssocNoteEntries();
  editingDecisionAssocNotes = [...existingNotes];

  // If in note mode and currentNote is open, ensure current note is in the list
  if (editingDecisionMode === 'note' && typeof currentNote !== 'undefined' && currentNote && currentNote.path) {
    if (!editingDecisionAssocNotes.some(n => n.notePath === currentNote.path)) {
      editingDecisionAssocNotes.push({
        notePath: currentNote.path,
        noteTitle: currentNote.title || currentNote.path.split('/').pop().replace('.html', ''),
        date: currentNote.date || '',
        isCurrentNote: true
      });
    }
  }

  const modal = document.getElementById('modal-edit-decision');
  if (!modal) return;

  const titleEl = document.getElementById('ed-dialog-title');
  if (titleEl) {
    titleEl.textContent = dec.isNew
      ? (t('team.addDecisionModalTitle') || 'Ajouter une décision')
      : (t('team.editDecisionModalTitle') || 'Modifier la décision');
  }

  const idInput = document.getElementById('ed-decision-id');
  const textInput = document.getElementById('ed-text');
  const statusSelect = document.getElementById('ed-status');
  const authoritySelect = document.getElementById('ed-authority');
  const impactSelect = document.getElementById('ed-impact');
  const rationaleArea = document.getElementById('ed-rationale');

  if (idInput) idInput.value = dec.id || dec.text || '';
  if (textInput) textInput.value = dec.text || '';
  if (statusSelect) statusSelect.value = dec.status || 'proposed';
  if (authoritySelect) authoritySelect.value = dec.authority || 'team';
  if (impactSelect) impactSelect.value = dec.impact || 'high';
  if (rationaleArea) rationaleArea.value = dec.rationale || dec.context || '';

  // Major Topic: multi-tag autocomplete reusing the note editor's tag editor (filtering dropdown).
  const majorTags = (Array.isArray(dec.major_topic_tags) && dec.major_topic_tags.length)
    ? dec.major_topic_tags
    : (editingDecisionMode === 'note' ? [] : ['General']);
  if (typeof populateTagEditor === 'function') {
    populateTagEditor('ed-major-topic', majorTags, 'major');
  }

  // Setup Note Linking Search
  setupDecisionNotePicker();

  // Associated notes (bloc-modal style)
  renderDecisionModalAssocNotes();

  // When opened from the note editor overlay (z-index 1000), lift the modal above it. Kept below the
  // tag-suggest dropdown (10050) and confirm dialog (99999) so those still render on top.
  modal.style.zIndex = editingDecisionMode === 'note' ? '5000' : '';

  if (typeof openModal === 'function') {
    openModal('modal-edit-decision');
  } else {
    modal.classList.add('active');
  }
}
window.openEditDecisionModal = openEditDecisionModal;

function setupDecisionNotePicker() {
  const searchInput = document.getElementById('ed-linked-notes-search');
  const dropdown = document.getElementById('ed-linked-notes-list');
  if (!searchInput || !dropdown) return;

  searchInput.value = '';
  dropdown.style.display = 'none';
  dropdown.innerHTML = '';

  const updateDropdown = () => {
    const query = searchInput.value.trim().toLowerCase();
    const existingPaths = new Set(editingDecisionAssocNotes.map(n => n.notePath));
    const allNotes = Array.isArray(manifest) ? manifest : [];
    const filtered = allNotes.filter(m => {
      if (!m || !m.path || existingPaths.has(m.path)) return false;
      if (!query) return true;
      const titleMatch = (m.title || '').toLowerCase().includes(query);
      const pathMatch = (m.path || '').toLowerCase().includes(query);
      const dateMatch = (m.date || '').toLowerCase().includes(query);
      return titleMatch || pathMatch || dateMatch;
    }).slice(0, 15);

    if (!filtered.length) {
      dropdown.innerHTML = `<div style="padding:8px 12px; font-size:0.8rem; color:var(--text-muted); text-align:center;">${escH(t('team.noNotesFound') || 'Aucune note trouvée')}</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = '';
    filtered.forEach(m => {
      const item = document.createElement('div');
      item.className = 'planner-dropdown-item';
      item.style.cssText = 'padding:6px 10px; cursor:pointer; font-size:0.82rem; display:flex; align-items:center; justify-content:space-between; gap:6px; border-bottom:1px solid var(--card-border); transition:background 0.15s;';
      item.innerHTML = `
        <span style="display:flex; align-items:center; gap:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; color:var(--text);">
          <span>📄</span>
          <span>${escH(m.title || m.path.split('/').pop().replace('.html', ''))}</span>
        </span>
        <span style="font-size:0.72rem; color:var(--text-muted); flex-shrink:0;">${escH(m.date || '')}</span>
      `;
      item.addEventListener('mouseenter', () => item.style.background = 'var(--card-bg-hover)');
      item.addEventListener('mouseleave', () => item.style.background = 'transparent');
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        editingDecisionAssocNotes.push({
          notePath: m.path,
          noteTitle: m.title || m.path.split('/').pop().replace('.html', ''),
          date: m.date || '',
          isNewLink: true
        });
        // If it was in removed list, un-remove it
        editingDecisionRemovedNotes = editingDecisionRemovedNotes.filter(r => r.notePath !== m.path);
        searchInput.value = '';
        dropdown.style.display = 'none';
        renderDecisionModalAssocNotes();
      });
      dropdown.appendChild(item);
    });
    dropdown.style.display = 'block';
  };

  searchInput.onfocus = () => updateDropdown();
  searchInput.oninput = () => updateDropdown();

  // Close dropdown on click outside
  const onDocClick = (e) => {
    const wrap = document.getElementById('ed-linked-notes-search-wrap');
    if (wrap && !wrap.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  };
  if (window._decisionNotePickerDocClick) {
    document.removeEventListener('click', window._decisionNotePickerDocClick);
  }
  window._decisionNotePickerDocClick = onDocClick;
  document.addEventListener('click', onDocClick);
}

function renderDecisionModalAssocNotes() {
  const field = document.getElementById('ed-assoc-notes-field');
  const container = document.getElementById('ed-assoc-notes-container');
  if (!field || !container) return;

  container.innerHTML = '';
  if (!editingDecisionAssocNotes.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:0.78rem; color:var(--text-muted); font-style:italic; padding:4px 0;';
    empty.textContent = t('team.noNotesAssociated') || 'Aucune note associée. Utilisez la recherche ci-dessus pour associer des notes.';
    container.appendChild(empty);
    return;
  }

  editingDecisionAssocNotes.forEach((e, idx) => {
    const box = document.createElement('div');
    box.className = 'planner-bloc-box note-type assoc-note';
    box.title = t('planner.openNote') || 'Open Note';
    box.style.cssText = 'margin-bottom:2px;';
    box.innerHTML = `
      <span class="bloc-icon">🔗</span>
      <span class="title-text">${escH(e.noteTitle || 'Untitled')}</span>
      <span class="meta-text">${escH(e.date || '')}</span>
      <button type="button" class="remove-btn" title="${t('planner.removeToChange') || 'Remove'}">✕</button>
    `;
    box.addEventListener('click', (ev) => {
      if (ev.target.closest('.remove-btn')) return;
      if (e.notePath) {
        if (typeof openDecisionNoteOverlay === 'function') openDecisionNoteOverlay(e.notePath);
        else if (typeof openNoteOverlay === 'function') openNoteOverlay(e.notePath);
      }
    });
    box.querySelector('.remove-btn').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const removed = editingDecisionAssocNotes.splice(idx, 1)[0];
      if (removed && !removed.isNewLink) {
        editingDecisionRemovedNotes.push(removed);
      }
      renderDecisionModalAssocNotes();
    });
    container.appendChild(box);
  });
}

async function saveDecisionFromModal() {
  if (!editingDecisionRef) {
    if (typeof closeModal === 'function') closeModal('modal-edit-decision');
    else document.getElementById('modal-edit-decision')?.classList.remove('active');
    return;
  }

  const textInput = document.getElementById('ed-text');
  const statusSelect = document.getElementById('ed-status');
  const authoritySelect = document.getElementById('ed-authority');
  const impactSelect = document.getElementById('ed-impact');
  const rationaleArea = document.getElementById('ed-rationale');
  const majorTags = (typeof readTagEditor === 'function') ? readTagEditor('ed-major-topic') : [];

  const textVal = textInput ? textInput.value.trim() : '';
  if (!textVal) {
    if (typeof toast === 'function') toast(t('team.decisionTitleRequired') || 'Veuillez saisir un intitulé de décision.');
    return;
  }

  const statusVal = statusSelect ? statusSelect.value : 'active';
  const authorityVal = authoritySelect ? authoritySelect.value : 'team';
  const impactVal = impactSelect ? impactSelect.value : 'high';
  const rationaleVal = rationaleArea ? rationaleArea.value.trim() : '';

  // ── Note-backed decision opened from note editor: write attributes back to the inline span and persist via the editor. ──
  if (editingDecisionMode === 'note' && editingDecisionElement) {
    if (typeof window.saveDecisionModalToNote === 'function') {
      window.saveDecisionModalToNote(editingDecisionElement, {
        status: statusVal,
        text: textVal,
        authority: authorityVal,
        impact: impactVal,
        major_topic_tags: majorTags,
        rationale: rationaleVal
      });
    }
  }

  // ── Handle unlinking notes ──
  for (const r of editingDecisionRemovedNotes) {
    if (r.notePath && typeof window.removeDecisionFromNoteFile === 'function') {
      await window.removeDecisionFromNoteFile(r.notePath, editingDecisionOriginalText || textVal);
    }
  }

  // ── Handle newly linked notes ──
  for (const n of editingDecisionAssocNotes) {
    if (n.isNewLink && n.notePath) {
      try {
        const originalHTML = await StorageAPI.readNoteContent(n.notePath);
        const parsed = parseNoteHTML(originalHTML);
        const badgeHTML = `<strong class="pill-decision pill-decision-${escH(statusVal)}" contenteditable="false">!decision:${escH(statusVal)}</strong>`;
        const decisionHTML = `<span class="note-decision-wrapper note-decision-draft" data-decision-status="${escH(statusVal)}" data-decision-text="${escH(textVal)}" data-decision-authority="${escH(authorityVal)}" data-decision-impact="${escH(impactVal)}" data-decision-major="${escH(encodeTagListToStorage(majorTags))}" data-decision-context="${escH(rationaleVal)}" contenteditable="false">${badgeHTML} <span class="note-decision-text" contenteditable="true">${escH(textVal)}</span></span>`;
        
        let newMainHTML = parsed.mainHTML || '';
        if (newMainHTML.includes('</ul>')) {
          newMainHTML = newMainHTML.replace(/<\/ul>([^<\/ul>]*)$/, `<li>${decisionHTML}</li></ul>$1`);
        } else {
          newMainHTML += `\n<p>${decisionHTML}</p>`;
        }
        
        const changes = {
          title: parsed.title,
          date: parsed.date || '',
          group_tags: parsed.group_tags || [],
          major_topic_tags: parsed.major_topic_tags || [],
          topic_tags: parsed.topic_tags || [],
          extra_tags: parsed.extra_tags || [],
          mainHTML: newMainHTML
        };
        const updatedHTML = applyNoteEdits(originalHTML, changes);
        await StorageAPI.writeNoteContent(n.notePath, updatedHTML);
        
        const meta = (typeof getMetaByPath === 'function') ? getMetaByPath(n.notePath) : null;
        if (meta && typeof extractDecisionsFromHTML === 'function' && typeof upsertMeta === 'function') {
          const decisions = extractDecisionsFromHTML(newMainHTML);
          upsertMeta({ ...meta, decisions, decisionsReady: true, modified: new Date().toISOString() });
        }
      } catch (err) {
        console.error('Failed to append decision to newly linked note:', n.notePath, err);
      }
    }
  }

  // ── Update existing note-backed decisions ──
  const notePaths = _decisionNotePaths(editingDecisionRef);
  for (const n of editingDecisionAssocNotes) {
    if (n.notePath && !n.isNewLink && !notePaths.includes(n.notePath)) notePaths.push(n.notePath);
  }

  if (notePaths.length && typeof window.updateDecisionInFile === 'function') {
    for (const p of notePaths) {
      await window.updateDecisionInFile(p, editingDecisionOriginalText, {
        status: statusVal,
        authority: authorityVal,
        impact: impactVal,
        major: majorTags,
        rationale: rationaleVal,
        newText: textVal
      });
    }
  }

  // Update in-memory reference
  editingDecisionRef.text = textVal;
  editingDecisionRef.status = statusVal;
  editingDecisionRef.authority = authorityVal;
  editingDecisionRef.impact = impactVal;
  editingDecisionRef.major_topic_tags = majorTags;
  editingDecisionRef.rationale = rationaleVal;

  if (editingDecisionRef.isNew) {
    delete editingDecisionRef.isNew;
    pendingDecisionsList.unshift({ ...editingDecisionRef });
  } else {
    const matchIndex = pendingDecisionsList.findIndex(d => d.id === editingDecisionRef.id || d.text === editingDecisionOriginalText);
    if (matchIndex !== -1) {
      pendingDecisionsList[matchIndex] = { ...pendingDecisionsList[matchIndex], ...editingDecisionRef };
    }
    const decIndex = decisionsList.findIndex(d => d.id === editingDecisionRef.id || d.text === editingDecisionOriginalText);
    if (decIndex !== -1) {
      decisionsList[decIndex] = { ...decisionsList[decIndex], ...editingDecisionRef };
    }
    if (matchIndex === -1 && decIndex === -1) {
      pendingDecisionsList.unshift({ ...editingDecisionRef });
    }
  }

  if (typeof toast === 'function') {
    toast(t('team.decisionSaved') || 'Décision enregistrée !');
  }

  editingDecisionRef = null;
  editingDecisionElement = null;
  editingDecisionMode = 'registry';

  if (typeof closeModal === 'function') {
    closeModal('modal-edit-decision');
  } else {
    document.getElementById('modal-edit-decision')?.classList.remove('active');
  }

  const container = document.querySelector('.collab-team-layout');
  if (container) renderRegisterView(container);
}
window.saveDecisionFromModal = saveDecisionFromModal;

window.deleteDecisionFromModal = async function() {
  if (!editingDecisionRef) return;
  const dec = editingDecisionRef;
  const decName = dec.text || t('team.thisDecision') || 'cette décision';
  const confirmMsg = t('team.confirmDeleteDecision', { name: decName }) || `Supprimer cette décision ?`;
  const ok = (typeof showConfirmDialog === 'function')
    ? await showConfirmDialog(confirmMsg, { isDanger: true, confirmLabel: t('common.delete') || 'Supprimer' })
    : confirm(confirmMsg);
  if (!ok) return;

  if (editingDecisionMode === 'note' && editingDecisionElement) {
    editingDecisionElement.remove();
    const editTa = document.getElementById('edit-textarea');
    if (editTa) {
      editTa.dispatchEvent(new Event('input', { bubbles: true }));
      if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    }
    editingDecisionRef = null;
    editingDecisionElement = null;
    editingDecisionMode = 'registry';
    if (typeof closeModal === 'function') closeModal('modal-edit-decision');
    else document.getElementById('modal-edit-decision')?.classList.remove('active');
    toast(t('team.decisionDeleted') || 'Décision supprimée.');
    return;
  }

  // Registry mode: remove from all note files containing this decision
  const norm = (dec.text || '').trim().toLowerCase();
  if (typeof getAllMetadataDecisionEntries === 'function' && typeof window.removeDecisionFromNoteFile === 'function') {
    const targets = getAllMetadataDecisionEntries().filter(e => String(e.text || '').trim().toLowerCase() === norm);
    const paths = [...new Set(targets.map(x => x.notePath).filter(Boolean))];
    for (const p of paths) await window.removeDecisionFromNoteFile(p, dec.text);
  }

  const pIdx = pendingDecisionsList.findIndex(d => d.id === dec.id || d.text === dec.text);
  if (pIdx !== -1) pendingDecisionsList.splice(pIdx, 1);

  const dIdx = decisionsList.findIndex(d => d.id === dec.id || d.text === dec.text);
  if (dIdx !== -1) decisionsList.splice(dIdx, 1);

  editingDecisionRef = null;
  editingDecisionElement = null;
  editingDecisionMode = 'registry';

  if (typeof closeModal === 'function') closeModal('modal-edit-decision');
  else document.getElementById('modal-edit-decision')?.classList.remove('active');

  if (typeof toast === 'function') toast(t('team.decisionDeleted') || 'Décision supprimée.');
  const container = document.querySelector('.collab-team-layout');
  if (container) renderRegisterView(container);
};

async function deleteDecisionItem(dec) {
  if (!dec) return;
  const decName = dec.text || t('team.thisDecision') || 'cette décision';
  const confirmMsg = t('team.confirmDeleteDecision', { name: decName }) || `Supprimer cette décision ?`;
  const ok = (typeof showConfirmDialog === 'function')
    ? await showConfirmDialog(confirmMsg, { isDanger: true, confirmLabel: t('common.delete') || 'Supprimer' })
    : confirm(confirmMsg);
  if (!ok) return;

  const norm = (dec.text || '').trim().toLowerCase();
  if (typeof getAllMetadataDecisionEntries === 'function' && typeof window.removeDecisionFromNoteFile === 'function') {
    const targets = getAllMetadataDecisionEntries().filter(e => String(e.text || '').trim().toLowerCase() === norm);
    const paths = [...new Set(targets.map(x => x.notePath).filter(Boolean))];
    for (const p of paths) await window.removeDecisionFromNoteFile(p, dec.text);
  }

  const pIdx = pendingDecisionsList.findIndex(d => d.id === dec.id || d.text === dec.text);
  if (pIdx !== -1) pendingDecisionsList.splice(pIdx, 1);

  const dIdx = decisionsList.findIndex(d => d.id === dec.id || d.text === dec.text);
  if (dIdx !== -1) decisionsList.splice(dIdx, 1);

  if (typeof toast === 'function') toast(t('team.decisionDeleted') || 'Décision supprimée.');
  const container = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
  if (container) renderRegisterView(container);
}
window.deleteDecisionItem = deleteDecisionItem;

function highlightDecisionFromHash() {
  const hash = window.location.hash || '';
  if (!hash.includes('dec=')) return;
  const match = hash.match(/dec=([^&]+)/);
  if (!match || !match[1]) return;
  const decId = decodeURIComponent(match[1]);
  
  setTimeout(() => {
    const card = document.getElementById(`dec-card-${decId}`) || Array.from(document.querySelectorAll('.decision-card-modern')).find(el => (el.dataset.decText || '').includes(decId));
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('decision-card-highlight-pulse');
      setTimeout(() => card.classList.remove('decision-card-highlight-pulse'), 3000);
    }
  }, 250);
}
window.highlightDecisionFromHash = highlightDecisionFromHash;


function createTodoFromDecision(decText) {
  if (typeof openNewTodoDialog === 'function') {
    openNewTodoDialog({
      title: `[Décision] ${decText}`,
      priority: 'High'
    });
  }
}
window.createTodoFromDecision = createTodoFromDecision;

let activeWorkstreamSubTab = 'overview'; // 'overview' | 'decisions' | 'tasks' | 'notes' | 'meetings' | 'chat'
let isWorkstreamLoading = false;
let workstreamLoadingName = '';
const REGISTRY_OTHER_PROJECTS_KEY = '__OTHER_WORKSTREAM__';

function openCreateWorkstreamModal(initialData = {}) {
  const existingOverlay = document.getElementById('modal-create-workstream');
  if (existingOverlay) existingOverlay.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-create-workstream';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';

  overlay.innerHTML = `
    <div class="modal-card" style="background:var(--card-bg); color:var(--text); border:1px solid var(--card-border); border-radius:14px; width:100%; max-width:760px; max-height:88vh; box-shadow:var(--shadow-lg); opacity:1; display:flex; flex-direction:column; overflow:hidden;">
      <!-- Fixed Header -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:18px 22px 14px 22px; border-bottom:1px solid var(--card-border); flex-shrink:0;">
        <h3 style="margin:0; font-size:1.1rem; font-weight:700; color:var(--text); display:flex; align-items:center; gap:8px;">
          <span>${getWsIcon('workstream', 18)}</span> <span>${escH(t('workstream.createModalTitle') || 'Create New Workstream')}</span>
        </h3>
        <button type="button" class="btn-icon" id="close-ws-modal" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.2rem;" title="${escA(t('common.close') || 'Close')}">✕</button>
      </div>

      <!-- Scrollable Content Body -->
      <div style="flex:1; overflow-y:auto; padding:18px 22px; display:flex; flex-direction:column; gap:16px;">
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:0.82rem; font-weight:600; color:var(--text-muted);">${escH(t('workstream.topicNameLabel') || 'Workstream / Topic Name:')} <span style="color:#ef4444;">*</span></label>
          <input type="text" id="ws-modal-topic-name" class="field-input" style="width:100%; padding:8px 10px; font-size:0.9rem; border-radius:6px; border:1px solid var(--field-border); background:var(--field-bg); color:var(--field-text);" placeholder="${escA(t('workstream.topicNamePlaceholder') || 'e.g. Q3 Marketing Launch, API V2 Migration...')}" title="${escA(t('workstream.topicNameTooltip') || 'Enter unique name for this workstream')}">
        </div>

        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:0.82rem; font-weight:600; color:var(--text-muted);">${escH(t('workstream.promptLabel') || 'Initial Context / Focus Instructions (Optional):')}</label>
          <textarea id="ws-modal-prompt" class="field-input" style="width:100%; min-height:54px; padding:8px 10px; font-size:0.85rem; border-radius:6px; border:1px solid var(--field-border); background:var(--field-bg); color:var(--field-text); line-height:1.4;" placeholder="${escA(t('workstream.promptPlaceholder') || 'Describe goals, key focus areas, or instructions for Secretary AI agent...')}" title="${escA(t('workstream.promptTooltip') || 'Optional prompt to guide Secretary AI synthesis')}"></textarea>
        </div>

        <!-- Tag Selection Group Definition (Required Wizard Step) -->
        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <label style="font-size:0.82rem; font-weight:700; color:var(--accent); display:flex; align-items:center; gap:6px;">
              <span>${getWsIcon('tag', 15)}</span> <span>${escH(t('workstream.addSelectionGroup') || 'Define Tag Selection Group')} <span style="color:#ef4444;">*</span></span>
            </label>
            <span style="font-size:0.75rem; color:var(--text-muted);">${escH(t('workstream.assignTagDesc') || 'Route matching decisions, tasks, and notes into this workstream.')}</span>
          </div>

          <div class="edit-fields" style="display:flex; flex-direction:column; gap:0.6rem; background:var(--card-bg-alt); border:1px solid var(--card-border); border-radius:8px; padding:12px;">
            <div class="field-row" style="display:flex; align-items:center; gap:0.8rem;">
              <span class="field-label" style="font-size:0.75rem; color:var(--text-muted); width:110px; flex-shrink:0; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">${escH(t('workstream.groupFieldLabel') || 'Group:')}</span>
              <div class="tags-editor" id="ws-create-tag-group" data-type="group" title="${escA(t('workstream.groupFieldLabel') || 'Group')}"></div>
            </div>

            <div class="field-row" style="display:flex; align-items:center; gap:0.8rem;">
              <span class="field-label" style="font-size:0.75rem; color:var(--text-muted); width:110px; flex-shrink:0; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">${escH(t('workstream.majorFieldLabel') || 'Major Topic:')}</span>
              <div class="tags-editor" id="ws-create-tag-major" data-type="major" title="${escA(t('workstream.majorFieldLabel') || 'Major Topic')}"></div>
            </div>

            <div class="field-row" style="display:flex; align-items:center; gap:0.8rem;">
              <span class="field-label" style="font-size:0.75rem; color:var(--text-muted); width:110px; flex-shrink:0; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">${escH(t('workstream.topicFieldLabel') || 'Topic:')}</span>
              <div class="tags-editor" id="ws-create-tag-topic" data-type="topic" title="${escA(t('workstream.topicFieldLabel') || 'Topic')}"></div>
            </div>
          </div>
          <!-- Tag Selection Group Hierarchy / Overlap Awareness Box -->
          <div id="ws-create-tag-hierarchy-box" style="display:none; border-radius:8px; padding:8px 12px; font-size:0.8rem; line-height:1.4; align-items:center; gap:8px;"></div>
        </div>

        <!-- Live Matching Notes Preview (Last 10 Notes) -->
        <div style="display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:0.8rem; font-weight:700; color:var(--accent); display:flex; align-items:center; gap:6px;">
              <span>${getWsIcon('fileText', 15)}</span> <span>${escH(t('workstream.matchingNotesPreviewTitle') || 'Matching Notes Preview (Last 10 notes):')}</span>
            </span>
            <span id="ws-create-matching-badge" style="font-size:0.75rem; background:rgba(var(--accent-rgb, 99, 102, 241), 0.15); color:var(--accent); padding:2px 8px; border-radius:10px; font-weight:600;">${escH(t('workstream.notesCount', { count: 0 }) || '0 notes')}</span>
          </div>

          <div id="ws-create-matching-notes-list" style="display:flex; flex-direction:column; gap:8px; max-height:220px; overflow-y:auto; padding:6px; border:1px solid var(--card-border); border-radius:8px; background:var(--card-bg-alt);">
            <!-- Live Note Blocs populated by updateCreateMatchingNotes() -->
          </div>
        </div>
      </div>

      <!-- Fixed Footer -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 22px; border-top:1px solid var(--card-border); flex-shrink:0; background:var(--card-bg); flex-wrap:wrap; gap:8px;">
        <button type="button" class="btn btn-secondary" id="btn-ws-cancel" style="font-size:0.82rem; padding:6px 14px;" title="${escA(t('common.cancel') || 'Cancel')}">${escH(t('common.cancel') || 'Cancel')}</button>
        <div style="display:flex; gap:8px; align-items:center;">
          <button type="button" class="btn btn-secondary" id="btn-ws-create-empty" style="font-size:0.82rem; padding:6px 14px;" title="${escA(t('workstream.createEmptyTooltip') || 'Create empty workstream memory dossier')}">${getWsIcon('fileText', 14)} ${escH(t('workstream.createEmpty') || 'Create Empty')}</button>
          <button type="button" class="btn btn-primary" id="btn-ws-create-ai" style="font-size:0.82rem; padding:6px 16px;" title="${escA(t('workstream.createAndFillTooltip') || 'Define scope and synthesize memory dossier with Secretary AI Agent')}">${getWsIcon('sparkles', 14)} ${escH(t('workstream.wizardNextToSynthesis') || 'Next: AI Synthesis & Scope →')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('#close-ws-modal');
  const cancelBtn = overlay.querySelector('#btn-ws-cancel');
  const emptyBtn = overlay.querySelector('#btn-ws-create-empty');
  const aiBtn = overlay.querySelector('#btn-ws-create-ai');
  const inputEl = overlay.querySelector('#ws-modal-topic-name');
  const promptEl = overlay.querySelector('#ws-modal-prompt');

  const groupContainer = overlay.querySelector('#ws-create-tag-group');
  const majorContainer = overlay.querySelector('#ws-create-tag-major');
  const topicContainer = overlay.querySelector('#ws-create-tag-topic');

  let groupEditor, majorEditor, topicEditor;

  const getContextValues = () => ({
    group: groupEditor?.getValue() || '',
    major: majorEditor?.getValue() || '',
    topic: topicEditor?.getValue() || ''
  });

  const updateCreateMatchingNotes = () => {
    const groupVal = (groupEditor?.getValue() || '').trim().toLowerCase();
    const majorVal = (majorEditor?.getValue() || '').trim().toLowerCase();
    const topicVal = (topicEditor?.getValue() || '').trim().toLowerCase();

    const notes = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : ((typeof notesManifest !== 'undefined' && Array.isArray(notesManifest)) ? notesManifest : []);
    
    let matchingNotes = [];
    if (!groupVal && !majorVal && !topicVal) {
      matchingNotes = notes.slice(0, 10);
    } else {
      matchingNotes = notes.filter(n => {
        if (!n) return false;
        const itemGs = (n.group_tags || []).map(t => String(t || '').trim().toLowerCase());
        const itemMs = (n.major_topic_tags || []).map(t => String(t || '').trim().toLowerCase());
        const itemTs = (n.topic_tags || []).map(t => String(t || '').trim().toLowerCase());

        const matchG = !groupVal || groupVal === '*' || itemGs.includes(groupVal);
        const matchM = !majorVal || majorVal === '*' || itemMs.includes(majorVal);
        const matchT = !topicVal || topicVal === '*' || itemTs.includes(topicVal);

        return matchG && matchM && matchT;
      });
    }

    const badgeEl = overlay.querySelector('#ws-create-matching-badge');
    if (badgeEl) badgeEl.textContent = t('workstream.notesCount', { count: matchingNotes.length }) || `${matchingNotes.length} notes`;

    // Evaluate tag selection hierarchy & containment
    const hierarchyBox = overlay.querySelector('#ws-create-tag-hierarchy-box');
    if (hierarchyBox) {
      const currentRule = { group: groupEditor?.getValue() || '', major: majorEditor?.getValue() || '', topic: topicEditor?.getValue() || '' };
      const currentWsName = inputEl?.value.trim() || '';
      const relations = detectTagGroupHierarchy(currentRule, currentWsName);
      if (relations.length > 0) {
        const primary = relations[0];
        let msg = '';
        let bg = 'rgba(99, 102, 241, 0.1)';
        let border = 'rgba(99, 102, 241, 0.3)';
        let color = 'var(--accent)';
        const tagsFormatted = formatTagGroupSummary(primary.otherRule);

        if (primary.type === 'part_of') {
          msg = (typeof t === 'function' && t('workstream.partOfWorkstream', { workstream: primary.workstream, tags: tagsFormatted })) || `Part of workstream: ${primary.workstream}: ${tagsFormatted}`;
          bg = 'rgba(59, 130, 246, 0.1)';
          border = 'rgba(59, 130, 246, 0.3)';
          color = '#2563eb';
        } else if (primary.type === 'contains') {
          msg = (typeof t === 'function' && t('workstream.includesWorkstream', { workstream: primary.workstream, tags: tagsFormatted })) || `Includes workstream: ${primary.workstream}: ${tagsFormatted}`;
          bg = 'rgba(245, 158, 11, 0.1)';
          border = 'rgba(245, 158, 11, 0.3)';
          color = '#d97706';
        } else {
          msg = (typeof t === 'function' && t('workstream.matchesWorkstream', { workstream: primary.workstream, tags: tagsFormatted })) || `Matches workstream: ${primary.workstream}: ${tagsFormatted}`;
          bg = 'rgba(16, 185, 129, 0.1)';
          border = 'rgba(16, 185, 129, 0.3)';
          color = '#059669';
        }

        hierarchyBox.style.display = 'flex';
        hierarchyBox.style.background = bg;
        hierarchyBox.style.border = `1px solid ${border}`;
        hierarchyBox.style.color = color;
        hierarchyBox.innerHTML = `<span>ℹ️</span> <span>${escH(msg)}</span>`;
      } else {
        hierarchyBox.style.display = 'none';
      }
    }

    const notesListEl = overlay.querySelector('#ws-create-matching-notes-list');
    if (notesListEl) {
      notesListEl.innerHTML = '';
      const displayNotes = matchingNotes.slice(0, 10);
      if (displayNotes.length === 0) {
        notesListEl.innerHTML = `<div style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:16px; font-style:italic;">${escH(t('workstream.noMatchingNotes') || 'No matching notes found for current selection.')}</div>`;
      } else {
        displayNotes.forEach(n => {
          const card = document.createElement('div');
          card.className = 'workstream-note-card';
          card.style.cssText = 'padding:8px 10px; cursor:pointer; background:var(--card-bg);';
          card.title = t('workstream.doubleClickToOpenNote') || 'Click or double-click to open note';

          let summaryText = '';
          if (n.summary) {
            summaryText = String(n.summary);
          } else if (typeof cachedPreviews !== 'undefined' && cachedPreviews[n.path]) {
            summaryText = String(cachedPreviews[n.path]);
          }

          const groupTag = n.group_tags?.[0] || '';
          const majorTag = n.major_topic_tags?.[0] || '';
          const topicTag = n.topic_tags?.[0] || '';

          card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
              <span style="font-weight:700; font-size:0.85rem; color:var(--text); line-height:1.3; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical;">${getWsIcon('fileText', 14)} ${escH(n.title || 'Untitled Note')}</span>
              <span style="font-size:0.7rem; color:var(--text-muted); flex-shrink:0;">${escH(n.date || '')}</span>
            </div>
            ${summaryText ? `<div class="workstream-note-summary" style="max-height:44px; overflow:hidden; font-size:0.75rem; color:var(--text-muted); margin:4px 0;">${escH(summaryText.slice(0, 150))}</div>` : ''}
            <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:2px;">
              ${groupTag ? `<span class="tag-pill group-tag" style="font-size:0.65rem; padding:1px 5px;">${getWsIcon('users', 11)} ${escH(groupTag)}</span>` : ''}
              ${majorTag ? `<span class="tag-pill major-tag" style="font-size:0.65rem; padding:1px 5px;">${getWsIcon('brain', 11)} ${escH(majorTag)}</span>` : ''}
              ${topicTag ? `<span class="tag-pill topic-tag" style="font-size:0.65rem; padding:1px 5px;">${getWsIcon('tag', 11)} ${escH(topicTag)}</span>` : ''}
            </div>
          `;
          card.addEventListener('dblclick', () => {
            if (n.path) openDecisionNoteOverlay(n.path);
          });
          card.addEventListener('click', (e) => {
            if (e.detail === 1 && n.path) {
              // Smooth single click preview option
            }
          });
          notesListEl.appendChild(card);
        });

        if (matchingNotes.length > 10) {
          const moreNotice = document.createElement('div');
          moreNotice.style.cssText = 'text-align:center; font-size:0.72rem; color:var(--text-muted); padding:4px 0; font-style:italic;';
          moreNotice.textContent = t('workstream.moreNotesOmitted', { count: matchingNotes.length - 10 }) || `(and ${matchingNotes.length - 10} more notes omitted from preview)`;
          notesListEl.appendChild(moreNotice);
        }
      }
    }
  };

  const initTopicName = initialData?.topicName || '';
  const initScope = initialData?.scope || initialData?.prompt || '';
  const initTags = initialData?.tags || {};

  groupEditor = setupWorkstreamSelectionTagEditor(groupContainer, initTags.group || '', 'group', () => updateCreateMatchingNotes(), getContextValues);
  majorEditor = setupWorkstreamSelectionTagEditor(majorContainer, initTags.major || '', 'major', () => updateCreateMatchingNotes(), getContextValues);
  topicEditor = setupWorkstreamSelectionTagEditor(topicContainer, initTags.topic || '', 'topic', () => updateCreateMatchingNotes(), getContextValues);

  if (initTopicName && inputEl) {
    inputEl.value = initTopicName;
  }
  if (initScope && promptEl) {
    promptEl.value = initScope;
  }

  inputEl?.addEventListener('input', () => {
    updateCreateMatchingNotes();
  });

  updateCreateMatchingNotes();
  if (initTopicName) {
    promptEl?.focus();
  } else {
    inputEl?.focus();
  }

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    groupEditor?.closeDropdown();
    majorEditor?.closeDropdown();
    topicEditor?.closeDropdown();
    document.querySelectorAll('.tag-suggest-dropdown').forEach(d => d.remove());
    overlay.remove();
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKeyDown);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  closeBtn?.addEventListener('click', close);
  cancelBtn?.addEventListener('click', close);

  const validateAndGetTagGroup = (name) => {
    const groupVal = (groupEditor?.getValue() || '').trim();
    const majorVal = (majorEditor?.getValue() || '').trim();
    const topicVal = (topicEditor?.getValue() || '').trim();

    if (!groupVal && !majorVal && !topicVal) {
      toast(t('workstream.tagGroupRequiredError') || 'Please configure at least one tag field to define this workstream');
      return null;
    }

    return {
      id: `rule_${Date.now()}`,
      group: groupVal,
      major: majorVal,
      topic: topicVal
    };
  };

  emptyBtn?.addEventListener('click', async () => {
    const name = inputEl?.value.trim();
    if (!name) {
      toast(t('workstream.nameRequired') || 'Workstream name required!');
      inputEl?.focus();
      return;
    }
    const rule = validateAndGetTagGroup(name);
    if (!rule) return;

    const existing = typeof getMajorTopicMemory === 'function' ? await getMajorTopicMemory(name, { skipAutoArchive: true }) : null;
    if (existing) {
      const wantOpen = confirm(t('workstream.existsConfirm', { name }) || `A workstream named "${name}" already exists. Would you like to open it instead of overwriting?`);
      if (wantOpen) {
        close();
        selectedRegistryProject = name;
        const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
        if (c) renderRegisterView(c);
        if (typeof initialData?.onCreated === 'function') {
          try { initialData.onCreated(name); } catch (e) { console.error('Error in onCreated callback:', e); }
        }
        window.dispatchEvent(new CustomEvent('workstream-created', { detail: { name } }));
        return;
      }
    }
    const initialPrompt = promptEl?.value.trim() || '';
    close();
    if (typeof WorkstreamMemoryEngine !== 'undefined') {
      await WorkstreamMemoryEngine.saveMajorTopicMemory(name, {
        summary: initialPrompt || `Workstream memory dossier for ${name}.`,
        mappedTags: {
          major_topic_tags: [rule.major].filter(Boolean),
          group_tags: [rule.group].filter(Boolean),
          topic_tags: [rule.topic].filter(Boolean),
          tagGroups: [rule]
        }
      });
      selectedRegistryProject = name;
      toast(`${t('workstream.createdToast') || 'Workstream memory created'}: "${name}"`);
      const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
      if (c) renderRegisterView(c);
      if (typeof initialData?.onCreated === 'function') {
        try { initialData.onCreated(name); } catch (e) { console.error('Error in onCreated callback:', e); }
      }
      window.dispatchEvent(new CustomEvent('workstream-created', { detail: { name } }));
    }
  });

  aiBtn?.addEventListener('click', async () => {
    const name = inputEl?.value.trim();
    if (!name) {
      toast(t('workstream.nameRequired') || 'Workstream name required!');
      inputEl?.focus();
      return;
    }
    const rule = validateAndGetTagGroup(name);
    if (!rule) return;

    const existing = typeof getMajorTopicMemory === 'function' ? await getMajorTopicMemory(name, { skipAutoArchive: true }) : null;
    if (existing) {
      const wantOpen = confirm(t('workstream.existsConfirm', { name }) || `A workstream named "${name}" already exists. Would you like to open it instead of overwriting?`);
      if (wantOpen) {
        close();
        selectedRegistryProject = name;
        const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
        if (c) renderRegisterView(c);
        if (typeof initialData?.onCreated === 'function') {
          try { initialData.onCreated(name); } catch (e) { console.error('Error in onCreated callback:', e); }
        }
        window.dispatchEvent(new CustomEvent('workstream-created', { detail: { name } }));
        return;
      }
    }
    const initialPrompt = promptEl?.value.trim() || '';
    close();

    // Save initial structure with tag rule
    if (typeof WorkstreamMemoryEngine !== 'undefined') {
      await WorkstreamMemoryEngine.saveMajorTopicMemory(name, {
        summary: initialPrompt || `Workstream memory dossier for ${name}.`,
        mappedTags: {
          major_topic_tags: [rule.major].filter(Boolean),
          group_tags: [rule.group].filter(Boolean),
          topic_tags: [rule.topic].filter(Boolean),
          tagGroups: [rule]
        }
      });
    }

    selectedRegistryProject = name;
    const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
    if (c) renderRegisterView(c);
    if (typeof initialData?.onCreated === 'function') {
      try { initialData.onCreated(name); } catch (e) { console.error('Error in onCreated callback:', e); }
    }
    window.dispatchEvent(new CustomEvent('workstream-created', { detail: { name } }));

    // Launch Interactive AI Synthesis Modal
    openWorkstreamSynthesisModal(name, { prompt: initialPrompt });
  });
}
window.openCreateWorkstreamModal = openCreateWorkstreamModal;
window.openWorkstreamDossier = (topicName) => {
  if (typeof DailyReviewController !== 'undefined' && DailyReviewController.openWorkstreamDossier) {
    DailyReviewController.openWorkstreamDossier(topicName);
  } else {
    if (typeof switchTab === 'function') switchTab('decisions');
    if (typeof openTopicMemoryModal === 'function') openTopicMemoryModal(topicName);
  }
};

/**
 * Interactive Workstream AI Synthesis Modal
 * Features: Live step progress loop, candidate scanning stats, interactive agent scoping questions form, and deep synthesis with progress bar and console log
 */
async function openWorkstreamSynthesisModal(topicName, options = {}) {
  if (!topicName) return;

  const existingOverlay = document.getElementById('modal-workstream-synthesis');
  if (existingOverlay) existingOverlay.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-workstream-synthesis';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';

  overlay.innerHTML = `
    <div class="modal-card" style="background:var(--card-bg); color:var(--text); border:1px solid var(--card-border); border-radius:14px; width:100%; max-width:820px; max-height:90vh; box-shadow:var(--shadow-lg); opacity:1; display:flex; flex-direction:column; overflow:hidden;" role="dialog" aria-modal="true" aria-labelledby="ws-synth-modal-title">
      
      <!-- Fixed Header with fixed Title -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:18px 22px 14px 22px; border-bottom:1px solid var(--card-border); flex-shrink:0;">
        <h3 id="ws-synth-modal-title" style="margin:0; font-size:1.15rem; font-weight:700; color:var(--text); display:flex; align-items:center; gap:8px;">
          <span>${getWsIcon('workstream', 18)}</span> <span>${escH(t('workstream.synthesisModalTitle') || 'Workstream AI Synthesis')}: <strong style="color:var(--accent);">"${escH(topicName)}"</strong></span>
        </h3>
        <button type="button" class="btn-icon" id="close-ws-synthesis-modal" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.2rem;" title="${escA(t('workstream.closeTooltip') || 'Close this dialog')}">✕</button>
      </div>

      <!-- Stepper Status Bar -->
      <div style="padding:14px 22px 0 22px; flex-shrink:0;">
        <div class="ws-synthesis-stepper" role="tablist">
          <div class="ws-synthesis-step active" id="ws-step-1" title="${escA(t('workstream.synthesisStepScanning') || '1. Scanning Notes')}">
            <span class="ws-synthesis-step-dot" aria-current="step">1</span>
            <span>${escH(t('workstream.synthesisStepScanning') || '1. Scanning Notes')}</span>
          </div>
          <span style="color:var(--text-muted); opacity:0.4;">→</span>
          <div class="ws-synthesis-step" id="ws-step-2" title="${escA(t('workstream.synthesisStepQuestions') || '2. Scope Clarifications')}">
            <span class="ws-synthesis-step-dot">2</span>
            <span>${escH(t('workstream.synthesisStepQuestions') || '2. Scope Clarifications')}</span>
          </div>
          <span style="color:var(--text-muted); opacity:0.4;">→</span>
          <div class="ws-synthesis-step" id="ws-step-3" title="${escA(t('workstream.synthesisStepSynthesizing') || '3. Deep Synthesis')}">
            <span class="ws-synthesis-step-dot">3</span>
            <span>${escH(t('workstream.synthesisStepSynthesizing') || '3. Deep Synthesis')}</span>
          </div>
          <span style="color:var(--text-muted); opacity:0.4;">→</span>
          <div class="ws-synthesis-step" id="ws-step-4" title="${escA(t('workstream.synthesisStepComplete') || '4. Memory Ready')}">
            <span class="ws-synthesis-step-dot">4</span>
            <span>${escH(t('workstream.synthesisStepComplete') || '4. Memory Ready')}</span>
          </div>
        </div>
      </div>

      <!-- Scrollable Main Body -->
      <div style="flex:1; overflow-y:auto; padding:8px 22px 18px 22px; display:flex; flex-direction:column; gap:14px;" id="ws-synthesis-body">
        <!-- Dynamic Content Slot (Scanning in Step 1, Form in Step 2, Progress bar + Console log in Step 3, Summary in Step 4) -->
        <div id="ws-synthesis-dynamic-slot" style="display:flex; flex-direction:column; gap:12px;">
          <!-- Populated by step controller -->
        </div>
      </div>

      <!-- Fixed Action Footer -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 22px; border-top:1px solid var(--card-border); flex-shrink:0; background:var(--card-bg);" id="ws-synthesis-footer">
        <button type="button" class="btn btn-secondary" id="btn-synthesis-cancel" style="font-size:0.82rem; padding:6px 14px;" title="${escA(t('common.cancel') || 'Cancel')}">${escH(t('common.cancel') || 'Cancel')}</button>
        <div style="display:flex; gap:8px; align-items:center;" id="ws-synthesis-footer-actions">
          <button type="button" class="btn btn-secondary" id="btn-synthesis-quick" style="font-size:0.82rem; padding:6px 14px;" title="${escA(t('workstream.synthesisQuickBtn') || 'Quick Synthesize')}">${getWsIcon('bolt', 14)} ${escH(t('workstream.synthesisQuickBtn') || 'Quick Synthesize')}</button>
          <button type="button" class="btn btn-primary" id="btn-synthesis-submit" style="font-size:0.82rem; padding:6px 18px;" title="${escA(t('workstream.synthesisConfirmBtn') || 'Synthesize Workstream')}">${getWsIcon('sparkles', 14)} ${escH(t('workstream.synthesisConfirmBtn') || 'Synthesize Workstream')}</button>
        </div>
      </div>

    </div>
  `;

  document.body.appendChild(overlay);

  const dynamicSlot = overlay.querySelector('#ws-synthesis-dynamic-slot');
  const footerActions = overlay.querySelector('#ws-synthesis-footer-actions');
  const cancelBtn = overlay.querySelector('#btn-synthesis-cancel');
  const closeBtn = overlay.querySelector('#close-ws-synthesis-modal');

  const setStep = (stepNum) => {
    for (let i = 1; i <= 4; i++) {
      const el = overlay.querySelector(`#ws-step-${i}`);
      if (!el) continue;
      el.classList.remove('active', 'done');
      const dot = el.querySelector('.ws-synthesis-step-dot');
      if (i < stepNum) {
        el.classList.add('done');
        if (dot) dot.removeAttribute('aria-current');
      } else if (i === stepNum) {
        el.classList.add('active');
        if (dot) dot.setAttribute('aria-current', 'step');
      } else {
        if (dot) dot.removeAttribute('aria-current');
      }
    }
  };

  const formatTimestamp = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKeyDown);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  closeBtn?.addEventListener('click', close);
  cancelBtn?.addEventListener('click', close);

  // Helper to render active processing screen with progress bar & console log below
  const renderProcessingScreen = (initialPercent = 15, initialLabel = 'Scanning notes manifest...', initialLog = '') => {
    const safePercent = Math.min(100, Math.max(0, parseInt(initialPercent, 10) || 0));
    dynamicSlot.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:14px; width:100%;">
        <div class="ws-synthesis-progress-container" role="progressbar" aria-valuenow="${safePercent}" aria-valuemin="0" aria-valuemax="100">
          <div class="ws-synthesis-progress-header">
            <div class="ws-synthesis-progress-label">
              <span class="ws-synthesis-spinner" aria-hidden="true"></span>
              <span id="ws-progress-stage-label">${escH(initialLabel)}</span>
            </div>
            <span class="ws-synthesis-progress-percent" id="ws-progress-percent">${safePercent}%</span>
          </div>
          <div class="ws-synthesis-progress-track">
            <div class="ws-synthesis-progress-fill" id="ws-progress-bar-fill" style="width:${safePercent}%;"></div>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:6px;">
          <div style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:6px;">
            <span>${getWsIcon('terminal', 14)}</span> <span>${escH(t('workstream.consoleLogTitle') || 'Console Activity Log')}</span>
          </div>
          <div class="ws-synthesis-console-box" id="ws-synthesis-console-stream">
            ${initialLog ? `<div class="ws-console-line active"><span class="ws-console-time">[${formatTimestamp()}]</span> <span class="ws-console-text">${escH(initialLog)}</span></div>` : ''}
          </div>
        </div>
      </div>
    `;
  };

  const addConsoleLog = (text, type = 'info') => {
    const consoleStream = overlay.querySelector('#ws-synthesis-console-stream');
    if (!consoleStream) return;
    const line = document.createElement('div');
    line.className = `ws-console-line ${type}`;
    if (type === 'thinking') {
      const formattedThinking = escH(text).replace(/\n/g, '<br>');
      line.innerHTML = `<span class="ws-console-time">[${formatTimestamp()}]</span> <span class="ws-console-text ws-thinking-text" style="color:var(--accent); font-style:italic;">🧠 ${formattedThinking}</span>`;
    } else {
      line.innerHTML = `<span class="ws-console-time">[${formatTimestamp()}]</span> <span class="ws-console-text">${escH(text)}</span>`;
    }
    consoleStream.appendChild(line);
    requestAnimationFrame(() => {
      consoleStream.scrollTop = consoleStream.scrollHeight;
    });
  };

  const updateProgress = (percent, stageLabel, logMessage, logType = 'active') => {
    const safePercent = Math.min(100, Math.max(0, parseInt(percent, 10) || 0));
    const fillEl = overlay.querySelector('#ws-progress-bar-fill');
    const percentEl = overlay.querySelector('#ws-progress-percent');
    const labelEl = overlay.querySelector('#ws-progress-stage-label');
    const containerEl = overlay.querySelector('.ws-synthesis-progress-container');
    if (containerEl) containerEl.setAttribute('aria-valuenow', String(safePercent));
    if (fillEl) fillEl.style.width = `${safePercent}%`;
    if (percentEl) percentEl.textContent = `${safePercent}%`;
    if (labelEl && stageLabel) labelEl.textContent = stageLabel;
    if (logMessage) addConsoleLog(logMessage, logType);
  };

  // Step 1: Initialize Scan
  setStep(1);
  renderProcessingScreen(15, 'Scanning notes manifest & rules...', `Initializing candidate scan for "${topicName}"...`);

  const memory = (typeof getMajorTopicMemory === 'function') ? await getMajorTopicMemory(topicName, { skipAutoArchive: true }) : null;
  const mapped = memory?.mappedTags || { major_topic_tags: [topicName], topic_tags: [], group_tags: [], tagGroups: [] };
  const allNotesList = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : ((typeof notesManifest !== 'undefined' && Array.isArray(notesManifest)) ? notesManifest : []);
  
  const assignedMajors = Array.from(new Set([topicName, ...(mapped.major_topic_tags || [])])).map(t => String(t).toLowerCase());
  const assignedGroups = (mapped.group_tags || []).map(t => String(t).toLowerCase());
  const assignedTopics = (mapped.topic_tags || []).map(t => String(t).toLowerCase());

  const candidateNotes = allNotesList.filter(n => {
    if (!n) return false;
    const noteMajors = (n.major_topic_tags || []).map(t => String(t).toLowerCase());
    const noteGroups = (n.group_tags || []).map(t => String(t).toLowerCase());
    const noteTopics = (n.topic_tags || []).map(t => String(t).toLowerCase());
    const noteTitle = String(n.title || '').toLowerCase();

    const matchRes = (typeof matchTagsToWorkstreamSelectionGroups === 'function')
      ? matchTagsToWorkstreamSelectionGroups(n, mapped.tagGroups)
      : null;
    const hasTagGroupMatch = matchRes ? matchRes.matched : (mapped.tagGroups || []).some(tg => {
      if (!tg) return false;
      const g = (tg.group || '').trim().toLowerCase();
      const m = (tg.major || '').trim().toLowerCase();
      const t = (tg.topic || '').trim().toLowerCase();
      if (!g && !m && !t) return false;
      const matchG = !g || g === '*' || noteGroups.includes(g);
      const matchM = !m || m === '*' || noteMajors.includes(m);
      const matchT = !t || t === '*' || noteTopics.includes(t);
      return matchG && matchM && matchT;
    });

    return hasTagGroupMatch || noteMajors.some(m => assignedMajors.includes(m)) || noteGroups.some(g => assignedGroups.includes(g)) || noteTopics.some(t => assignedTopics.includes(t)) || noteTitle.includes(topicName.toLowerCase());
  });

  updateProgress(45, 'Evaluating candidate notes & decisions...', `Found ${candidateNotes.length} matching candidate notes across configured tag rules.`);

  const allDec = (typeof getAllMetadataDecisionEntries === 'function') ? getAllMetadataDecisionEntries() : (typeof decisionsList !== 'undefined' ? decisionsList : []);
  const activeDecisions = allDec.filter(d => {
    if (!d) return false;
    const mTags = (d.major_topic_tags || []).map(t => String(t).toLowerCase());
    const gTags = (d.group_tags || []).map(t => String(t).toLowerCase());
    return mTags.some(m => assignedMajors.includes(m)) || gTags.some(g => assignedGroups.includes(g)) || String(d.text || '').toLowerCase().includes(topicName.toLowerCase());
  });

  updateProgress(75, 'Formulating scoping questions with Secretary AI...', `Identified ${activeDecisions.length} decisions associated with this workstream.`);

  // Generate Scoping Questions (Step 2)
  let scopingQuestionsRes = null;
  let isQuestionsFromAi = false;
  try {
    if (typeof LLMService !== 'undefined' && typeof LLMService.generateWorkstreamClarifyingQuestions === 'function') {
      scopingQuestionsRes = await LLMService.generateWorkstreamClarifyingQuestions(topicName, {
        notes: candidateNotes.slice(0, 10),
        decisions: activeDecisions,
        tasks: []
      });
    }
  } catch (_e) {}

  let scopingQuestions = [];
  if (scopingQuestionsRes && typeof scopingQuestionsRes === 'object' && Array.isArray(scopingQuestionsRes.questions)) {
    scopingQuestions = scopingQuestionsRes.questions;
    isQuestionsFromAi = !!scopingQuestionsRes.isAiGenerated;
  } else if (Array.isArray(scopingQuestionsRes)) {
    scopingQuestions = scopingQuestionsRes;
    isQuestionsFromAi = !!scopingQuestionsRes.isAiGenerated;
  }

  if (!Array.isArray(scopingQuestions) || scopingQuestions.length === 0) {
    isQuestionsFromAi = false;
    scopingQuestions = [
      {
        id: 'scope_focus',
        question: typeof t === 'function' ? (t('workstream.scopeQuestionFocus') || `Which core dimensions should define the scope of "${topicName}"?`) : `Which core dimensions should define the scope of "${topicName}"?`,
        multiSelect: true,
        options: [
          { id: 'deliverables', label: typeof t === 'function' ? (t('workstream.optDeliverables') || 'Key deliverables, milestones & active deadlines') : 'Key deliverables, milestones & active deadlines', selectedByDefault: true },
          { id: 'decisions_impact', label: typeof t === 'function' ? (t('workstream.optDecisions') || 'Strategic decisions taken & direct impacts') : 'Strategic decisions taken & direct impacts', selectedByDefault: true },
          { id: 'dependencies', label: typeof t === 'function' ? (t('workstream.optDependencies') || 'Cross-workstream dependencies & external blockers') : 'Cross-workstream dependencies & external blockers', selectedByDefault: true },
          { id: 'stakeholders', label: typeof t === 'function' ? (t('workstream.optStakeholders') || 'Key stakeholders, ownership & team governance') : 'Key stakeholders, ownership & team governance', selectedByDefault: false }
        ]
      },
      {
        id: 'scope_boundaries',
        question: typeof t === 'function' ? (t('workstream.scopeQuestionBoundaries') || 'How should historical context and boundaries be recorded?') : 'How should historical context and boundaries be recorded?',
        multiSelect: true,
        options: [
          { id: 'explicit_non_goals', label: typeof t === 'function' ? (t('workstream.optNonGoals') || 'Define explicit Out-of-Scope / Non-Goals to avoid scope creep') : 'Define explicit Out-of-Scope / Non-Goals to avoid scope creep', selectedByDefault: true },
          { id: 'include_escalations', label: typeof t === 'function' ? (t('workstream.optEscalations') || 'Document past escalations, critical incidents & resolved conflicts') : 'Document past escalations, critical incidents & resolved conflicts', selectedByDefault: true },
          { id: 'strict_recent', label: typeof t === 'function' ? (t('workstream.optRecentOnly') || 'Focus primarily on recent notes from the last 30 days') : 'Focus primarily on recent notes from the last 30 days', selectedByDefault: false }
        ]
      }
    ];
  }

  // Render Step 2: Scoping Questions Form
  setStep(2);

  const hasExistingMemory = !!(memory && (memory.summary || memory.scratchpad || (memory.keyFacts && memory.keyFacts.length > 0)));

  dynamicSlot.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <!-- Regeneration & Synthesis Strategy Selection Card -->
      <div class="ws-scope-question-card" style="border:1px solid var(--accent); background:rgba(99, 102, 241, 0.04); padding:12px 14px; border-radius:10px;">
        <div style="font-weight:700; font-size:0.88rem; color:var(--text); display:flex; align-items:center; justify-content:space-between;">
          <span style="display:flex; align-items:center; gap:6px;">
            ${getWsIcon('refresh', 16)} <strong>${escH(t('workstream.regenStrategyTitle') || 'Regeneration & Synthesis Mode')}</strong>
          </span>
          <span class="badge" style="font-size:0.7rem; background:var(--card-bg); border:1px solid var(--card-border); padding:2px 8px;">
            ${escH(hasExistingMemory ? (t('workstream.statusActive') || 'Active Memory Baseline') : (t('workstream.statusNew') || 'New Workstream'))}
          </span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:3px;">
          ${escH(t('workstream.regenStrategySubtitle') || 'How should the AI agent proceed when regenerating workstream memory?')}
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:10px; margin-top:10px;">
          <label class="ws-scope-radio-card selected" id="ws-mode-card-incremental" title="${escA(t('workstream.regenModeIncrementalTooltip') || 'Keep existing memory as baseline and review against new notes')}">
            <div style="display:flex; align-items:center; gap:8px; font-weight:700; font-size:0.84rem; color:var(--text);">
              <input type="radio" name="ws_synthesis_mode" value="incremental" checked style="accent-color:var(--accent);">
              <span>🔄 ${escH(t('workstream.regenModeIncrementalLabel') || 'Use current state as base & review against notes')}</span>
            </div>
            <div style="font-size:0.76rem; color:var(--text-muted); line-height:1.4; padding-left:24px;">
              ${escH(t('workstream.regenModeIncrementalDesc') || 'The agent preserves existing facts & decisions, updating and merging new insights from notes.')}
            </div>
          </label>
          <label class="ws-scope-radio-card" id="ws-mode-card-reset" title="${escA(t('workstream.regenModeResetTooltip') || 'Clear existing memory and generate clean from 0 using notes')}">
            <div style="display:flex; align-items:center; gap:8px; font-weight:700; font-size:0.84rem; color:var(--text);">
              <input type="radio" name="ws_synthesis_mode" value="reset" style="accent-color:var(--accent);">
              <span>🧹 ${escH(t('workstream.regenModeResetLabel') || 'Start from 0 (Rebuild clean from scratch)')}</span>
            </div>
            <div style="font-size:0.76rem; color:var(--text-muted); line-height:1.4; padding-left:24px;">
              ${escH(t('workstream.regenModeResetDesc') || 'The agent clears previous memory state and generates a fresh dossier solely from candidate notes and decisions.')}
            </div>
          </label>
        </div>
      </div>

      <!-- AI Question Source Banner -->
      <div class="ws-ai-source-banner ${isQuestionsFromAi ? 'ai-generated' : 'default-template'}" title="${escA(isQuestionsFromAi ? 'Questions tailored dynamically by AI' : 'Standard questions from template')}">
        <span style="display:flex; align-items:center; gap:6px;">
          ${isQuestionsFromAi ? getWsIcon('sparkles', 14) : getWsIcon('fileText', 14)}
          <strong>${escH(isQuestionsFromAi ? (t('workstream.questionsSourceAi') || 'Clarifying Questions generated by Secretary AI Agent') : (t('workstream.questionsSourceDefault') || 'Standard Scoping Template (AI Offline / Default Template)'))}</strong>
        </span>
        <span style="font-size:0.72rem; opacity:0.8;">${isQuestionsFromAi ? 'Tailored to candidate notes' : 'Default framework'}</span>
      </div>

      ${scopingQuestions.map((q, qIdx) => `
        <div class="ws-scope-question-card">
          <div style="font-weight:700; font-size:0.88rem; color:var(--text); display:flex; align-items:center; gap:6px;">
            <span>${getWsIcon('helpCircle', 14)}</span> <span>${escH(q.question)}</span>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:8px; margin-top:4px;">
            ${(q.options || []).map((opt, optIdx) => `
              <label class="ws-scope-checkbox-label" title="${escA(opt.label)}">
                <input type="checkbox" name="ws_q_${qIdx}" value="${escA(opt.id || opt.label)}" data-label="${escA(opt.label)}" ${opt.selectedByDefault ? 'checked' : ''}>
                <span>${escH(opt.label)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `).join('')}

      <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">
        <label style="font-size:0.82rem; font-weight:700; color:var(--text-muted);">${escH(t('workstream.synthesisFreeTextLabel') || 'Additional Scope Refinements & Instructions (Free text):')}</label>
        <textarea id="ws-synthesis-freetext" class="field-input" style="width:100%; min-height:70px; padding:10px; font-size:0.85rem; border-radius:8px; border:1px solid var(--card-border); background:var(--field-bg); color:var(--field-text); line-height:1.45;" placeholder="${escA(t('workstream.synthesisFreeTextPlaceholder') || 'Specify what is strictly in scope, non-goals, past incidents, or key priorities...')}" title="${escA(t('workstream.synthesisFreeTextLabel') || 'Scope instructions')}">${escH(options.prompt || '')}</textarea>
      </div>
    </div>
  `;

  // Handle strategy card radio selections
  overlay.querySelectorAll('input[name="ws_synthesis_mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      overlay.querySelectorAll('.ws-scope-radio-card').forEach(card => card.classList.remove('selected'));
      const activeCard = radio.closest('.ws-scope-radio-card');
      if (activeCard) activeCard.classList.add('selected');
    });
  });

  // Step 3 Execution
  const runSynthesisExecution = async (customAnswers, selectedMode = 'incremental') => {
    setStep(3);
    
    // Render only progress bar + console log below
    const isReset = selectedMode === 'reset';
    const initialLabel = isReset ? 'Secretary AI is rebuilding workstream memory from scratch (0)...' : 'Secretary AI is synthesizing & updating workstream memory...';
    const initialLog = isReset ? 'Deep synthesis triggered (Start from 0). Rebuilding memory clean from notes...' : 'Deep synthesis triggered (Incremental baseline). Merging updates with current state...';
    renderProcessingScreen(20, initialLabel, initialLog);

    if (footerActions) footerActions.innerHTML = `<span style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">Synthesizing... please wait</span>`;

    try {
      updateProgress(35, 'Analyzing candidate notes & context...', 'Parsing excerpts from top candidate notes...');

      let result = null;
      if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.synthesizeWorkstreamMemoryWithAI) {
        result = await WorkstreamMemoryEngine.synthesizeWorkstreamMemoryWithAI(topicName, {
          prompt: options.prompt || '',
          userScopeAnswers: customAnswers,
          synthesisMode: selectedMode,
          onProgress: (stage, data) => {
            if (stage === 'thinking' && data?.thinkingText) {
              addConsoleLog(data.thinkingText, 'thinking');
            } else if (stage === 'synthesizing') {
              updateProgress(70, 'Running neural LLM synthesis on deep contexts...', `Running LLM neural synthesis on ${data?.topNotesCount || 10} candidate notes...`);
              if (data?.thinkingText) {
                addConsoleLog(data.thinkingText, 'thinking');
              }
            }
          }
        });
      }

      updateProgress(90, 'Formatting Scope & Agent Memory...', 'Writing structured Scope, key facts, milestones, and agent memory dossier...');

      await new Promise(r => setTimeout(r, 400));
      updateProgress(100, 'Memory ready!', 'Synthesis complete! Scope and memory dossier saved.', 'success');

      setStep(4);

      const keyFactsCount = Array.isArray(result?.keyFacts) ? result.keyFacts.length : 0;
      const milestonesCount = Array.isArray(result?.activeMilestones) ? result.activeMilestones.length : 0;
      const decisionsCount = Array.isArray(result?.decisions) ? result.decisions.length : 0;
      const linkedNotesCount = Array.isArray(result?.associatedNotes) ? result.associatedNotes.length : 0;

      // Render Completion Screen
      dynamicSlot.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:14px; padding:16px; background:rgba(16, 185, 129, 0.08); border:1px solid rgba(16, 185, 129, 0.3); border-radius:12px;">
          <div style="font-weight:700; font-size:1.1rem; color:#10b981; display:flex; align-items:center; gap:8px;">
            <span>${getWsIcon('checkCircle', 18)}</span> <span>${escH(t('workstream.generatedToast') || 'Workstream memory synthesized successfully!')}</span>
          </div>
          <div style="font-size:0.85rem; color:var(--text); line-height:1.45;">
            ${escH(t('workstream.synthesisSuccessDesc') || 'Memory dossier, key facts, milestones, decisions and deep scratchpad updated successfully.')}
          </div>
          <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:4px;">
            <span class="badge" style="background:var(--card-bg); border:1px solid var(--card-border); padding:4px 10px; font-size:0.8rem; font-weight:600;">${getWsIcon('pin', 13)} ${keyFactsCount} ${escH(t('workstream.keyFactsMetric') || 'Key Facts')}</span>
            <span class="badge" style="background:var(--card-bg); border:1px solid var(--card-border); padding:4px 10px; font-size:0.8rem; font-weight:600;">${getWsIcon('flag', 13)} ${milestonesCount} ${escH(t('workstream.milestonesMetric') || 'Milestones')}</span>
            <span class="badge" style="background:var(--card-bg); border:1px solid var(--card-border); padding:4px 10px; font-size:0.8rem; font-weight:600;">${getWsIcon('decision', 13)} ${decisionsCount} ${escH(t('workstream.decisionsMetric') || 'Decisions')}</span>
            <span class="badge" style="background:var(--card-bg); border:1px solid var(--card-border); padding:4px 10px; font-size:0.8rem; font-weight:600;">${getWsIcon('fileText', 13)} ${linkedNotesCount} ${escH(t('workstream.linkedNotesMetric') || 'Linked Notes')}</span>
          </div>
        </div>
      `;

      if (footerActions) {
        footerActions.innerHTML = `
          <button type="button" class="btn btn-primary" id="btn-synthesis-view" style="font-size:0.85rem; padding:8px 22px; font-weight:700;" title="${escA(t('workstream.synthesisViewBtn') || 'Open Workstream')}">${getWsIcon('arrowRight', 14)} ${escH(t('workstream.synthesisViewBtn') || 'Open Workstream')}</button>
        `;
        overlay.querySelector('#btn-synthesis-view')?.addEventListener('click', () => {
          close();
          selectedRegistryProject = topicName;
          const navBtn = document.getElementById('tab-decisions');
          if (navBtn && typeof switchTab === 'function') switchTab('decisions');
          const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
          if (c) renderRegisterView(c);
        });
      }

      // Refresh background view if active
      const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
      if (c) renderRegisterView(c);

    } catch (err) {
      console.error('Synthesis failed:', err);
      updateProgress(100, 'Synthesis failed', `Error: ${err.message || err}`, 'error');
      dynamicSlot.innerHTML = `<div style="color:#ef4444; font-size:0.85rem; padding:16px; background:rgba(239,68,68,0.08); border-radius:8px; border:1px solid rgba(239,68,68,0.2);">Failed to synthesize workstream: ${escH(err.message || String(err))}</div>`;
      if (footerActions) {
        footerActions.innerHTML = `
          <button type="button" class="btn btn-secondary" id="btn-synthesis-retry" style="font-size:0.82rem; padding:6px 14px;" title="${escA(t('workstream.retryTooltip') || 'Rerun synthesis with AI agent')}">${getWsIcon('refresh', 14)} ${escH(t('workstream.retryBtn') || 'Retry')}</button>
        `;
        overlay.querySelector('#btn-synthesis-retry')?.addEventListener('click', () => {
          runSynthesisExecution(customAnswers, selectedMode);
        });
      }
    }
  };

  const submitBtn = overlay.querySelector('#btn-synthesis-submit');
  const quickBtn = overlay.querySelector('#btn-synthesis-quick');

  submitBtn?.addEventListener('click', () => {
    const selectedOptions = [];
    overlay.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
      selectedOptions.push(cb.getAttribute('data-label') || cb.value);
    });
    const freetext = overlay.querySelector('#ws-synthesis-freetext')?.value.trim() || '';
    const selectedMode = overlay.querySelector('input[name="ws_synthesis_mode"]:checked')?.value || 'incremental';

    const customScope = {
      focusDimensions: selectedOptions.length > 0 ? selectedOptions : ['Key deliverables', 'Strategic decisions', 'Cross-workstream dependencies'],
      userInstructions: freetext
    };
    runSynthesisExecution(customScope, selectedMode);
  });

  quickBtn?.addEventListener('click', () => {
    const freetext = overlay.querySelector('#ws-synthesis-freetext')?.value.trim() || options.prompt || '';
    const selectedMode = overlay.querySelector('input[name="ws_synthesis_mode"]:checked')?.value || 'incremental';
    runSynthesisExecution({ quick: true, instructions: freetext }, selectedMode);
  });
}
window.openWorkstreamSynthesisModal = openWorkstreamSynthesisModal;

/**
 * Edit Scratchpad Memory Modal (Dark & Light Theme Compliant with Tab Indentation Support)
 */
function openEditScratchpadModal(topicName, memory) {
  const existingModal = document.getElementById('modal-edit-scratchpad');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-edit-scratchpad';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';

  let currentMode = 'visual'; // 'visual' or 'code'

  overlay.innerHTML = `
    <div class="modal-card" style="background:var(--card-bg); color:var(--text); border:1px solid var(--card-border); border-radius:14px; width:100%; max-width:960px; max-height:90vh; padding:0; box-shadow:var(--shadow-lg); opacity:1; display:flex; flex-direction:column; overflow:hidden;" role="dialog" aria-modal="true" aria-labelledby="ws-scratchpad-title">
      
      <!-- Fixed Header with Mode Switcher -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 24px 12px 24px; border-bottom:1px solid var(--card-border); flex-shrink:0;">
        <div style="display:flex; align-items:center; gap:12px;">
          <h3 id="ws-scratchpad-title" style="margin:0; font-size:1.15rem; font-weight:700; color:var(--text); display:flex; align-items:center; gap:8px;">
            <span>${getWsIcon('fileText', 16)}</span> <span>${escH(t('workstream.scratchpadTitle') || 'Agent Scratchpad Memory')}: <strong style="color:var(--accent);">"${escH(topicName)}"</strong></span>
          </h3>
          <div style="display:flex; align-items:center; background:var(--card-bg-alt); border:1px solid var(--card-border); border-radius:6px; padding:2px; gap:2px;">
            <button type="button" class="btn btn-secondary active" id="btn-scratchpad-mode-visual" style="font-size:0.75rem; padding:3px 10px; height:24px; font-weight:600; line-height:1; border-radius:4px;" title="${escA(t('workstream.toggleEditorMode') || 'Switch between visual and HTML source editing modes')}">${getWsIcon('eye', 13)} ${escH(t('workstream.visualEditor') || 'Visual')}</button>
            <button type="button" class="btn btn-secondary" id="btn-scratchpad-mode-code" style="font-size:0.75rem; padding:3px 10px; height:24px; font-weight:600; line-height:1; border-radius:4px;" title="${escA(t('workstream.toggleEditorMode') || 'Switch between visual and HTML source editing modes')}">&lt;/&gt; ${escH(t('workstream.codeEditor') || 'HTML Source')}</button>
          </div>
        </div>
        <button type="button" class="btn-icon" id="close-scratchpad-modal" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.2rem;" title="${escA(t('workstream.closeTooltip') || 'Close this dialog')}">✕</button>
      </div>

      <!-- Scrollable Content Body -->
      <div style="flex:1; overflow-y:auto; padding:16px 24px; display:flex; flex-direction:column; gap:12px;">
        <div style="font-size:0.83rem; color:var(--text-muted); line-height:1.45;">
          ${escH(t('workstream.editScratchpadDesc') || 'This scratchpad stores persistent contextual notes and instructions utilized by the Secretary AI Agent when scanning and synthesizing this workstream.')}
        </div>

        <div style="display:flex; flex-direction:column; gap:6px; flex:1;">
          <!-- Visual WYSIWYG Editor Pane -->
          <div id="scratchpad-visual-container" class="workstream-scratchpad-container" style="min-height:480px; height:500px; padding:16px; border:1px solid var(--card-border); border-radius:8px; background:#ffffff !important; color:#1e293b !important; overflow-y:auto;">
            <div id="scratchpad-modal-editor" class="workstream-scratchpad-html-body" contenteditable="true" style="outline:none; min-height:450px;"></div>
          </div>

          <!-- HTML Code Editor Pane (Initially hidden) -->
          <div id="scratchpad-code-container" style="display:none; flex-direction:column; flex:1;">
            <textarea id="scratchpad-modal-content" class="field-input" style="width:100%; height:500px; min-height:480px; font-size:0.88rem; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace; padding:14px; border-radius:8px; border:1px solid var(--card-border); background:var(--field-bg); color:var(--field-text); line-height:1.55; box-shadow:inset 0 1px 2px rgba(0,0,0,0.06); resize:vertical;" placeholder="${escA(t('workstream.scratchpadPlaceholder') || 'Enter persistent agent memory HTML or scratchpad instructions for this workstream...')}" title="${escA(t('workstream.editScratchpadTooltip') || 'Agent memory scratchpad content')}"></textarea>
          </div>
        </div>
      </div>

      <!-- Fixed Footer -->
      <div style="display:flex; justify-content:flex-end; gap:8px; padding:14px 24px; border-top:1px solid var(--card-border); flex-shrink:0; background:var(--card-bg);">
        <button type="button" class="btn btn-secondary" id="btn-scratchpad-cancel" style="font-size:0.82rem; padding:6px 16px;" title="${escA(t('common.cancel') || 'Cancel')}">${escH(t('common.cancel') || 'Cancel')}</button>
        <button type="button" class="btn btn-primary" id="btn-scratchpad-save" style="font-size:0.82rem; padding:6px 20px;" title="${escA(t('workstream.saveScratchpadTooltip') || 'Save changes to agent scratchpad memory')}">${getWsIcon('check', 14)} ${escH(t('common.save') || 'Save Scratchpad')}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('#close-scratchpad-modal');
  const cancelBtn = overlay.querySelector('#btn-scratchpad-cancel');
  const saveBtn = overlay.querySelector('#btn-scratchpad-save');
  const visualBtn = overlay.querySelector('#btn-scratchpad-mode-visual');
  const codeBtn = overlay.querySelector('#btn-scratchpad-mode-code');
  const visualContainer = overlay.querySelector('#scratchpad-visual-container');
  const codeContainer = overlay.querySelector('#scratchpad-code-container');
  const visualEditor = overlay.querySelector('#scratchpad-modal-editor');
  const textareaEl = overlay.querySelector('#scratchpad-modal-content');

  const initialText = (memory?.scratchpad || '').trim();
  let initialHtml = initialText;
  if (initialText && !initialText.includes('<') && (initialText.includes('#') || initialText.includes('*') || initialText.includes('-'))) {
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
      initialHtml = marked.parse(initialText);
    }
  }

  if (visualEditor) visualEditor.innerHTML = initialHtml;
  if (textareaEl) textareaEl.value = initialHtml;

  const setMode = (mode) => {
    currentMode = mode;
    if (mode === 'visual') {
      visualEditor.innerHTML = textareaEl.value;
      visualContainer.style.display = 'block';
      codeContainer.style.display = 'none';
      visualBtn.classList.add('active');
      visualBtn.style.background = 'var(--accent)';
      visualBtn.style.color = '#ffffff';
      codeBtn.classList.remove('active');
      codeBtn.style.background = 'none';
      codeBtn.style.color = 'var(--text)';
      visualEditor.focus();
    } else {
      textareaEl.value = visualEditor.innerHTML;
      visualContainer.style.display = 'none';
      codeContainer.style.display = 'flex';
      codeBtn.classList.add('active');
      codeBtn.style.background = 'var(--accent)';
      codeBtn.style.color = '#ffffff';
      visualBtn.classList.remove('active');
      visualBtn.style.background = 'none';
      visualBtn.style.color = 'var(--text)';
      textareaEl.focus();
    }
  };

  // Default to visual active style
  visualBtn.style.background = 'var(--accent)';
  visualBtn.style.color = '#ffffff';
  codeBtn.style.background = 'none';
  codeBtn.style.color = 'var(--text)';

  if (typeof attachRichTextShortcutsAndToolbar === 'function' && visualEditor) {
    attachRichTextShortcutsAndToolbar(visualEditor);
  }

  visualBtn?.addEventListener('click', () => setMode('visual'));
  codeBtn?.addEventListener('click', () => setMode('code'));

  // Tab key indentation support in code view
  textareaEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textareaEl.selectionStart;
      const end = textareaEl.selectionEnd;
      const val = textareaEl.value;
      textareaEl.value = val.substring(0, start) + '  ' + val.substring(end);
      textareaEl.selectionStart = textareaEl.selectionEnd = start + 2;
    }
  });

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKeyDown);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  closeBtn?.addEventListener('click', close);
  cancelBtn?.addEventListener('click', close);

  saveBtn?.addEventListener('click', async () => {
    const finalContent = currentMode === 'visual' ? visualEditor.innerHTML : textareaEl.value;
    close();
    if (typeof saveMajorTopicMemory === 'function') {
      await saveMajorTopicMemory(topicName, {
        ...memory,
        scratchpad: finalContent
      });
      toast(`${t('common.saved') || 'Scratchpad memory updated!'}`);
      const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
      if (c) renderRegisterView(c);
    }
  });
}
window.openEditScratchpadModal = openEditScratchpadModal;

function getKnownWorkstreamTags(type) {
  const extraSet = new Set();
  if (typeof knownTagsForType === 'function') {
    (knownTagsForType(type) || []).forEach(t => t && extraSet.add(String(t).trim()));
  }

  const allNotesList = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : ((typeof notesManifest !== 'undefined' && Array.isArray(notesManifest)) ? notesManifest : []);
  allNotesList.forEach(n => {
    const list = type === 'group' ? (n.group_tags || []) : type === 'major' ? (n.major_topic_tags || []) : (n.topic_tags || []);
    list.forEach(t => t && extraSet.add(String(t).trim()));
  });

  const allTodos = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) ? todosManifest : ((typeof todosList !== 'undefined' && Array.isArray(todosList)) ? todosList : []);
  allTodos.forEach(t => {
    const list = type === 'group' ? (t.group_tags || []) : type === 'major' ? (t.major_topic_tags || []) : (t.topic_tags || []);
    list.forEach(item => item && extraSet.add(String(item).trim()));
  });

  if (typeof pendingDecisionsList !== 'undefined' && Array.isArray(pendingDecisionsList)) {
    pendingDecisionsList.forEach(d => {
      const list = type === 'group' ? (d.group_tags || []) : type === 'major' ? (d.major_topic_tags || []) : (d.topic_tags || []);
      list.forEach(item => item && extraSet.add(String(item).trim()));
    });
  }
  if (typeof decisionsList !== 'undefined' && Array.isArray(decisionsList)) {
    decisionsList.forEach(d => {
      const list = type === 'group' ? (d.group_tags || []) : type === 'major' ? (d.major_topic_tags || []) : (d.topic_tags || []);
      list.forEach(item => item && extraSet.add(String(item).trim()));
    });
  }

  return Array.from(extraSet).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function setupWorkstreamSelectionTagEditor(containerEl, initialVal, type, onTagSelect = null, getContextSelected = null) {
  if (!containerEl) return null;
  const tagCss = type === 'group' ? 'group-tag' : type === 'major' ? 'major-tag' : 'topic-tag';
  const tagBg = type === 'group' ? '#bfdbfe' : type === 'major' ? '#fde68a' : '#bbf7d0';
  const tagFg = type === 'group' ? '#1d4ed8' : type === 'major' ? '#9a3412' : '#166534';
  const typeIcon = type === 'group' ? getWsIcon('users', 11) : type === 'major' ? getWsIcon('brain', 11) : getWsIcon('tag', 11);

  containerEl.innerHTML = '';
  let currentVal = initialVal ? String(initialVal).trim() : '';

  const renderPill = (val) => {
    const existingPill = containerEl.querySelector('.tag-pill');
    if (existingPill) existingPill.remove();

    if (!val) return;
    if (typeof window.createTagPill === 'function') {
      const pill = window.createTagPill(val, {
        type,
        cssClass: val === '*' ? 'extra-tag' : '',
        icon: val === '*' ? getWsIcon('globe', 12) : typeIcon,
        title: t('common.clickToRemoveTag', { tag: val }) || 'Remove',
        onRemove: () => {
          pill.remove();
          currentVal = '';
          input.placeholder = t('common.addTagPlaceholder') || '+ Add tag...';
          input.focus();
          if (typeof onTagSelect === 'function') onTagSelect('');
        }
      });
      containerEl.insertBefore(pill, input);
      return;
    }

    const pill = document.createElement('span');
    pill.className = `tag-pill ${val === '*' ? 'extra-tag' : tagCss}`;
    pill.dataset.tag = val;
    pill.innerHTML = `<span>${val === '*' ? getWsIcon('globe', 12) + ' *' : typeIcon + ' ' + escH(val)}</span><button type="button" class="rm" title="${escA(t('common.clickToRemoveTag', { tag: val }) || 'Remove')}">✕</button>`;

    pill.querySelector('.rm')?.addEventListener('click', (e) => {
      e.stopPropagation();
      pill.remove();
      currentVal = '';
      input.placeholder = t('common.addTagPlaceholder') || '+ Add tag...';
      input.focus();
      if (typeof onTagSelect === 'function') onTagSelect('');
    });

    containerEl.insertBefore(pill, input);
  };

  const input = document.createElement('input');
  input.className = 'tag-add';
  input.placeholder = currentVal ? '' : (t('common.addTagPlaceholder') || '+ Add tag...');
  input.title = t('common.clickAndTypeToAddTag') || 'Click to choose tag';

  containerEl.appendChild(input);
  if (currentVal) renderPill(currentVal);

  let dropdown = null;

  function closeDropdown() {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
  }

  function isTagCoOccurring(tag) {
    if (!tag || tag === '*' || typeof getContextSelected !== 'function') return false;
    const ctx = getContextSelected();
    if (!ctx) return false;
    const otherG = (type !== 'group' && ctx.group && ctx.group !== '*') ? ctx.group.toLowerCase() : null;
    const otherM = (type !== 'major' && ctx.major && ctx.major !== '*') ? ctx.major.toLowerCase() : null;
    const otherT = (type !== 'topic' && ctx.topic && ctx.topic !== '*') ? ctx.topic.toLowerCase() : null;
    if (!otherG && !otherM && !otherT) return false;

    const notes = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : ((typeof notesManifest !== 'undefined' && Array.isArray(notesManifest)) ? notesManifest : []);
    const lowerTag = String(tag).toLowerCase();

    return notes.some(n => {
      const itemGs = (n.group_tags || []).map(t => String(t || '').toLowerCase());
      const itemMs = (n.major_topic_tags || []).map(t => String(t || '').toLowerCase());
      const itemTs = (n.topic_tags || []).map(t => String(t || '').toLowerCase());

      const hasThis = type === 'group' ? itemGs.includes(lowerTag) : type === 'major' ? itemMs.includes(lowerTag) : itemTs.includes(lowerTag);
      if (!hasThis) return false;

      if (otherG && !itemGs.includes(otherG)) return false;
      if (otherM && !itemMs.includes(otherM)) return false;
      if (otherT && !itemTs.includes(otherT)) return false;

      return true;
    });
  }

  function renderDropdown(filter) {
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'tag-suggest-dropdown';
      dropdown.style.zIndex = '10050';
      document.body.appendChild(dropdown);
    }
    dropdown.innerHTML = '';

    const fl = (filter || '').toLowerCase();
    const allKnown = getKnownWorkstreamTags(type);
    const matching = allKnown.filter(t => !fl || t.toLowerCase().includes(fl));

    function makeChip(tag, isAssigned) {
      const isCoOccurring = !isAssigned && isTagCoOccurring(tag);
      if (typeof window.makeTagChip === 'function') {
        return window.makeTagChip(tag, {
          isAssigned,
          isMatch: isCoOccurring,
          bg: isAssigned ? 'var(--accent)' : tagBg,
          fg: isAssigned ? 'var(--text-on-accent)' : tagFg,
          onRemove: () => {
            currentVal = '';
            const p = containerEl.querySelector('.tag-pill');
            if (p) p.remove();
            input.placeholder = t('common.addTagPlaceholder') || '+ Add tag...';
            closeDropdown();
            if (typeof onTagSelect === 'function') onTagSelect(currentVal);
          },
          onSelect: (selectedTag) => {
            currentVal = selectedTag;
            renderPill(selectedTag);
            input.value = '';
            input.placeholder = '';
            closeDropdown();
            if (typeof onTagSelect === 'function') onTagSelect(currentVal);
          }
        });
      }

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-suggest-chip ' + (isAssigned ? 'assigned' : 'suggestion') + (isCoOccurring ? ' matching-highlight' : '');
      chip.innerHTML = (isAssigned ? getWsIcon('check', 11) + ' ' : '') + (tag === '*' ? getWsIcon('globe', 11) + ' * (Wildcard)' : escH(tag));
      chip.style.background = isAssigned ? 'var(--accent)' : tagBg;
      chip.style.color = isAssigned ? 'var(--text-on-accent)' : tagFg;
      if (isCoOccurring) {
        chip.style.fontWeight = '700';
        chip.style.opacity = '1';
      }
      chip.title = isAssigned ? t('common.clickToRemoveTag', { tag }) : t('common.clickToAddTag', { tag });

      chip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (isAssigned) {
          currentVal = '';
          const p = containerEl.querySelector('.tag-pill');
          if (p) p.remove();
          input.placeholder = t('common.addTagPlaceholder') || '+ Add tag...';
        } else {
          currentVal = tag;
          renderPill(tag);
          input.value = '';
          input.placeholder = '';
        }
        closeDropdown();
        if (typeof onTagSelect === 'function') onTagSelect(currentVal);
      });
      return chip;
    }

    if (currentVal && (!fl || currentVal.toLowerCase().includes(fl))) {
      const sec = document.createElement('div');
      sec.className = 'tag-suggest-section';
      sec.textContent = t('common.assigned') || 'Assigned';
      dropdown.appendChild(sec);
      const row = document.createElement('div');
      row.className = 'tag-suggest-chips';
      row.appendChild(makeChip(currentVal, true));
      dropdown.appendChild(row);
    }

    const unassigned = matching.filter(t => t.toLowerCase() !== currentVal.toLowerCase());
    if (unassigned.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'tag-suggest-section';
      sec.textContent = t('common.other') || 'Existing Tags';
      dropdown.appendChild(sec);
      const row = document.createElement('div');
      row.className = 'tag-suggest-chips';
      unassigned.forEach(t => row.appendChild(makeChip(t, false)));
      dropdown.appendChild(row);
    }

    if (!currentVal && unassigned.length === 0) {
      const em = document.createElement('div');
      em.className = 'tag-suggest-empty';
      em.textContent = t('common.noExistingTagsYet') || 'No existing tags found';
      dropdown.appendChild(em);
    }

    if (typeof window.positionTagDropdown === 'function') {
      window.positionTagDropdown(dropdown, containerEl);
    } else {
      const rect = containerEl.getBoundingClientRect();
      const dropdownHeight = dropdown.offsetHeight || 180;
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
        dropdown.style.top = (rect.top - dropdownHeight - 4) + 'px';
      } else {
        dropdown.style.top = (rect.bottom + 4) + 'px';
      }
      dropdown.style.left = rect.left + 'px';
    }
  }

  input.addEventListener('focus', () => renderDropdown(input.value.trim()));
  input.addEventListener('input', () => renderDropdown(input.value.trim()));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      if (val === '*') {
        currentVal = '*';
        renderPill('*');
        input.value = '';
        input.placeholder = '';
        closeDropdown();
        if (typeof onTagSelect === 'function') onTagSelect('*');
        return;
      }
      // ONLY allow existing tags - creating new tags is disabled in workstream selection
      const allKnown = getKnownWorkstreamTags(type);
      const existing = allKnown.find(t => t.toLowerCase() === val.toLowerCase());
      if (existing) {
        currentVal = existing;
        renderPill(existing);
        input.value = '';
        input.placeholder = '';
        closeDropdown();
        if (typeof onTagSelect === 'function') onTagSelect(existing);
      } else {
        toast(`⚠️ "${val}" is not an existing tag`);
        input.value = '';
        if (dropdown) renderDropdown('');
      }
    } else if (e.key === 'Backspace' && !input.value) {
      if (currentVal) {
        currentVal = '';
        const p = containerEl.querySelector('.tag-pill');
        if (p) p.remove();
        input.placeholder = t('common.addTagPlaceholder') || '+ Add tag...';
        renderDropdown('');
        if (typeof onTagSelect === 'function') onTagSelect('');
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      closeDropdown();
    }, 200);
  });

  containerEl.addEventListener('click', () => {
    input.focus();
  });

  return {
    getValue: () => currentVal,
    setValue: (v) => {
      currentVal = v ? String(v).trim() : '';
      renderPill(currentVal);
      input.placeholder = currentVal ? '' : (t('common.addTagPlaceholder') || '+ Add tag...');
      if (!currentVal) {
        const p = containerEl.querySelector('.tag-pill');
        if (p) p.remove();
      }
    },
    closeDropdown
  };
}

function openAssignTagModal(topicName, memory, editGroupIndex = -1) {
  const existingModal = document.getElementById('modal-assign-tag');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-assign-tag';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';

  const currentMapped = memory?.mappedTags || { major_topic_tags: [], topic_tags: [], group_tags: [], tagGroups: [] };
  const currentTagGroups = Array.isArray(currentMapped.tagGroups) ? [...currentMapped.tagGroups] : [];

  const existingRule = (editGroupIndex >= 0 && currentTagGroups[editGroupIndex]) ? currentTagGroups[editGroupIndex] : null;
  const initialGroupVal = existingRule ? (existingRule.group || '') : '';
  const initialMajorVal = existingRule ? (existingRule.major || '') : '';
  const initialTopicVal = existingRule ? (existingRule.topic || '') : '';

  const isEditMode = editGroupIndex >= 0 && !!existingRule;

  overlay.innerHTML = `
    <div class="modal-card" style="background:var(--card-bg); color:var(--text); border:1px solid var(--card-border); border-radius:14px; width:100%; max-width:760px; max-height:88vh; box-shadow:var(--shadow-lg); opacity:1; display:flex; flex-direction:column; overflow:hidden;">
      
      <!-- Fixed Header -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:18px 22px 14px 22px; border-bottom:1px solid var(--card-border); flex-shrink:0;">
        <h3 style="margin:0; font-size:1.1rem; font-weight:700; color:var(--text); display:flex; align-items:center; gap:8px;">
          <span>🏷️</span> <span>${escH(isEditMode ? (t('workstream.editSelectionGroup') || 'Edit Selection Group') : (t('workstream.addSelectionGroup') || '+ New Selection Group'))}</span>
        </h3>
        <button type="button" class="btn-icon" id="close-assign-tag-modal" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.2rem;" title="${escA(t('common.close') || 'Close')}">✕</button>
      </div>

      <!-- Scrollable Body (Title stays fixed on top, remaining elements scroll) -->
      <div style="flex:1; overflow-y:auto; padding:18px 22px; display:flex; flex-direction:column; gap:14px;">
        <div style="font-size:0.83rem; color:var(--text-muted); line-height:1.4;">
          ${escH(t('workstream.selectionGroupsDesc') || 'Selection groups define which notes, tasks, and decisions belong to this workstream based on combinations of tags.')}
        </div>

        <!-- Note-Editor Style Tag Field Boxes (Groupe, Sujet Majeur, Sujet) -->
        <div class="edit-fields" style="display:flex; flex-direction:column; gap:0.6rem; background:var(--card-bg-alt); border:1px solid var(--card-border); border-radius:8px; padding:12px;">
          <!-- Field 1: Groupe -->
          <div class="field-row" style="display:flex; align-items:center; gap:0.8rem;">
            <span class="field-label" style="font-size:0.75rem; color:var(--text-muted); width:110px; flex-shrink:0; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">${escH(t('workstream.groupFieldLabel') || 'Group:')}</span>
            <div class="tags-editor" id="ws-tag-group" data-type="group" title="${escA(t('workstream.groupFieldLabel') || 'Group')}"></div>
          </div>

          <!-- Field 2: Sujet Majeur -->
          <div class="field-row" style="display:flex; align-items:center; gap:0.8rem;">
            <span class="field-label" style="font-size:0.75rem; color:var(--text-muted); width:110px; flex-shrink:0; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">${escH(t('workstream.majorFieldLabel') || 'Major Topic:')}</span>
            <div class="tags-editor" id="ws-tag-major" data-type="major" title="${escA(t('workstream.majorFieldLabel') || 'Major Topic')}"></div>
          </div>

          <!-- Field 3: Sujet -->
          <div class="field-row" style="display:flex; align-items:center; gap:0.8rem;">
            <span class="field-label" style="font-size:0.75rem; color:var(--text-muted); width:110px; flex-shrink:0; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">${escH(t('workstream.topicFieldLabel') || 'Topic:')}</span>
            <div class="tags-editor" id="ws-tag-topic" data-type="topic" title="${escA(t('workstream.topicFieldLabel') || 'Topic')}"></div>
          </div>
        </div>

        <!-- Tag Selection Group Hierarchy / Overlap Awareness Box -->
        <div id="ws-assign-tag-hierarchy-box" style="display:none; border-radius:8px; padding:8px 12px; font-size:0.8rem; line-height:1.4; align-items:center; gap:8px;"></div>

        <!-- Wildcard Warning Box (dynamically displayed when all fields are empty or wildcard) -->
        <div id="ws-wildcard-warning-box" style="display:none; background:rgba(245, 158, 11, 0.12); border:1px solid #f59e0b; border-radius:8px; padding:10px 12px; font-size:0.82rem; color:#d97706; line-height:1.4; align-items:center; gap:8px;">
          <span style="font-size:1.1rem; flex-shrink:0;">⚠️</span>
          <span id="ws-wildcard-warning-text">${escH(t('workstream.wildcardWarning') || 'Warning: This wildcard rule matches all notes, decisions, and tasks across your entire workspace.')}</span>
        </div>

        <!-- Live Matching Multi-Entity Preview (Notes, Decisions, Tasks) -->
        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
            <div class="ws-preview-segmented-tabs" id="ws-preview-segmented-tabs">
              <button type="button" class="ws-preview-segmented-tab active" data-tab="notes" title="${escA(t('workstream.matchingNotes') || 'Notes')}">
                <span>📄</span> <span>${escH(t('workstream.matchingNotes') || 'Notes')}</span>
                <span class="badge" id="ws-assign-notes-badge" style="font-size:0.7rem; padding:1px 6px; border-radius:10px; background:rgba(99,102,241,0.12); color:var(--accent);">0</span>
              </button>
              <button type="button" class="ws-preview-segmented-tab" data-tab="decisions" title="${escA(t('workstream.matchingDecisions') || 'Decisions')}">
                <span>⚖️</span> <span>${escH(t('workstream.matchingDecisions') || 'Decisions')}</span>
                <span class="badge" id="ws-assign-decisions-badge" style="font-size:0.7rem; padding:1px 6px; border-radius:10px; background:rgba(16,185,129,0.12); color:#10b981;">0</span>
              </button>
              <button type="button" class="ws-preview-segmented-tab" data-tab="tasks" title="${escA(t('workstream.matchingTasks') || 'Tasks')}">
                <span>☑️</span> <span>${escH(t('workstream.matchingTasks') || 'Tasks')}</span>
                <span class="badge" id="ws-assign-tasks-badge" style="font-size:0.7rem; padding:1px 6px; border-radius:10px; background:rgba(245,158,11,0.12); color:#f59e0b;">0</span>
              </button>
            </div>
            <span id="ws-assign-matching-badge" style="font-size:0.75rem; background:rgba(var(--accent-rgb, 99, 102, 241), 0.12); color:var(--accent); padding:2px 8px; border-radius:10px; font-weight:600;">${escH(t('workstream.coveredCount', { count: 0 }) || '0 covered')}</span>
          </div>

          <div id="ws-assign-matching-content-list" style="display:flex; flex-direction:column; gap:8px; max-height:220px; overflow-y:auto; padding:6px; border:1px solid var(--card-border); border-radius:8px; background:var(--card-bg-alt);">
            <!-- Live Blocs -->
          </div>
        </div>
      </div>

      <!-- Fixed Action Buttons Row -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 22px; border-top:1px solid var(--card-border); flex-shrink:0; background:var(--card-bg); flex-wrap:wrap; gap:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          ${isEditMode ? `
            <button type="button" class="btn btn-secondary" id="btn-delete-selection-group" style="font-size:0.82rem; padding:6px 14px; color:#ef4444;" title="${escA(t('workstream.deleteSelectionGroup') || 'Delete selection')}">🗑️ ${escH(t('workstream.deleteSelectionGroup') || 'Delete')}</button>
          ` : ''}
          <div id="ws-modal-matching-count" style="font-size:0.8rem; color:var(--text-muted); display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span>📄 <strong id="ws-matching-notes-num" style="color:var(--accent);">0</strong></span>
            <span>⚖️ <strong id="ws-matching-decisions-num" style="color:#10b981;">0</strong></span>
            <span>☑️ <strong id="ws-matching-tasks-num" style="color:#f59e0b;">0</strong></span>
          </div>
        </div>

        <div style="display:flex; gap:8px; align-items:center;">
          <button type="button" class="btn btn-secondary" id="btn-assign-tag-close" style="font-size:0.82rem; padding:6px 14px;" title="${escA(t('common.cancel') || 'Cancel')}">${escH(t('common.cancel') || 'Cancel')}</button>
          <button type="button" class="btn btn-primary" id="btn-assign-group-submit" style="font-size:0.82rem; padding:6px 18px;" title="${escA(t('workstream.saveSelectionGroup') || 'Save Selection')}">✓ ${escH(t('workstream.saveSelectionGroup') || 'Save Selection')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const groupContainer = overlay.querySelector('#ws-tag-group');
  const majorContainer = overlay.querySelector('#ws-tag-major');
  const topicContainer = overlay.querySelector('#ws-tag-topic');

  let groupEditor, majorEditor, topicEditor;
  let currentActivePreviewTab = 'notes';

  const getContextValues = () => ({
    group: groupEditor?.getValue() || '',
    major: majorEditor?.getValue() || '',
    topic: topicEditor?.getValue() || ''
  });

  const updateMatchingCount = () => {
    const groupVal = (groupEditor?.getValue() || '').trim().toLowerCase();
    const majorVal = (majorEditor?.getValue() || '').trim().toLowerCase();
    const topicVal = (topicEditor?.getValue() || '').trim().toLowerCase();

    const isAllEmpty = !groupVal && !majorVal && !topicVal;
    const isWildcardAll = (!groupVal || groupVal === '*') && (!majorVal || majorVal === '*') && (!topicVal || topicVal === '*');

    // Dynamic wildcard warning visibility and button state
    const warnBox = overlay.querySelector('#ws-wildcard-warning-box');
    if (warnBox) {
      warnBox.style.display = isWildcardAll ? 'flex' : 'none';
    }

    const submitBtn = overlay.querySelector('#btn-assign-group-submit');
    if (submitBtn) {
      if (isWildcardAll) {
        submitBtn.innerHTML = `⚠️ ${escH(t('workstream.saveWildcardSelection') || 'Match All Content (Wildcard)')}`;
        submitBtn.title = escA(t('workstream.saveWildcardSelectionTooltip') || 'Save selection group that matches all notes across workspace');
        submitBtn.style.background = '#d97706';
        submitBtn.style.borderColor = '#d97706';
        submitBtn.style.color = '#ffffff';
      } else {
        submitBtn.innerHTML = `✓ ${escH(t('workstream.saveSelectionGroup') || 'Save Selection')}`;
        submitBtn.title = escA(t('workstream.saveSelectionGroup') || 'Save Selection');
        submitBtn.style.background = 'var(--accent)';
        submitBtn.style.borderColor = 'var(--accent)';
        submitBtn.style.color = 'var(--btn-text, #ffffff)';
      }
    }

    const matchEntity = (item) => {
      if (!item) return false;
      if (isAllEmpty || isWildcardAll) return true;

      const itemGs = (item.group_tags || (item.group ? [item.group] : [])).map(t => String(t || '').trim().toLowerCase());
      const itemMs = (item.major_topic_tags || (item.major ? [item.major] : (item.workstream ? [item.workstream] : []))).map(t => String(t || '').trim().toLowerCase());
      const itemTs = (item.topic_tags || (item.topic ? [item.topic] : [])).map(t => String(t || '').trim().toLowerCase());

      const matchG = !groupVal || groupVal === '*' || itemGs.includes(groupVal);
      const matchM = !majorVal || majorVal === '*' || itemMs.includes(majorVal);
      const matchT = !topicVal || topicVal === '*' || itemTs.includes(topicVal);

      return matchG && matchM && matchT;
    };

    const notes = (typeof manifest !== 'undefined' && Array.isArray(manifest))
      ? manifest
      : ((typeof notesManifest !== 'undefined' && Array.isArray(notesManifest))
          ? notesManifest
          : ((typeof window !== 'undefined' && Array.isArray(window.manifest))
              ? window.manifest
              : ((typeof window !== 'undefined' && Array.isArray(window.notesManifest)) ? window.notesManifest : [])));
    const matchingNotes = isAllEmpty ? notes : notes.filter(matchEntity);

    const decListSource = (typeof decisionsList !== 'undefined' && Array.isArray(decisionsList) && decisionsList.length > 0)
      ? decisionsList
      : ((typeof window !== 'undefined' && Array.isArray(window.decisionsList))
          ? window.decisionsList
          : ((typeof decisionsList !== 'undefined' && Array.isArray(decisionsList)) ? decisionsList : []));
    const pendingListSource = (typeof pendingDecisionsList !== 'undefined' && Array.isArray(pendingDecisionsList) && pendingDecisionsList.length > 0)
      ? pendingDecisionsList
      : ((typeof window !== 'undefined' && Array.isArray(window.pendingDecisionsList))
          ? window.pendingDecisionsList
          : ((typeof pendingDecisionsList !== 'undefined' && Array.isArray(pendingDecisionsList)) ? pendingDecisionsList : []));
    const allDecisions = [...pendingListSource, ...decListSource];
    const matchingDecisions = isAllEmpty ? allDecisions : allDecisions.filter(matchEntity);

    const allTasks = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest) && todosManifest.length > 0)
      ? todosManifest
      : ((typeof todosList !== 'undefined' && Array.isArray(todosList) && todosList.length > 0)
          ? todosList
          : ((typeof window !== 'undefined' && Array.isArray(window.todosManifest))
              ? window.todosManifest
              : ((typeof window !== 'undefined' && Array.isArray(window.todosList))
                  ? window.todosList
                  : ((typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) ? todosManifest : []))));
    const matchingTasks = isAllEmpty ? allTasks : allTasks.filter(matchEntity);

    // Update badges
    const noteBadge = overlay.querySelector('#ws-assign-notes-badge');
    if (noteBadge) noteBadge.textContent = String(matchingNotes.length);
    const decBadge = overlay.querySelector('#ws-assign-decisions-badge');
    if (decBadge) decBadge.textContent = String(matchingDecisions.length);
    const taskBadge = overlay.querySelector('#ws-assign-tasks-badge');
    if (taskBadge) taskBadge.textContent = String(matchingTasks.length);

    const totalCovered = matchingNotes.length + matchingDecisions.length + matchingTasks.length;
    const topBadge = overlay.querySelector('#ws-assign-matching-badge');
    if (topBadge) topBadge.textContent = t('workstream.coveredCount', { count: totalCovered }) || `${totalCovered} covered`;

    // Evaluate tag selection hierarchy & containment
    const hierarchyBox = overlay.querySelector('#ws-assign-tag-hierarchy-box');
    if (hierarchyBox) {
      const currentRule = { group: groupVal, major: majorVal, topic: topicVal };
      const relations = detectTagGroupHierarchy(currentRule, topicName);
      if (relations.length > 0) {
        const primary = relations[0];
        let msg = '';
        let bg = 'rgba(99, 102, 241, 0.1)';
        let border = 'rgba(99, 102, 241, 0.3)';
        let color = 'var(--accent)';
        const tagsFormatted = formatTagGroupSummary(primary.otherRule);

        if (primary.type === 'part_of') {
          msg = (typeof t === 'function' && t('workstream.partOfWorkstream', { workstream: primary.workstream, tags: tagsFormatted })) || `Part of workstream: ${primary.workstream}: ${tagsFormatted}`;
          bg = 'rgba(59, 130, 246, 0.1)';
          border = 'rgba(59, 130, 246, 0.3)';
          color = '#2563eb';
        } else if (primary.type === 'contains') {
          msg = (typeof t === 'function' && t('workstream.includesWorkstream', { workstream: primary.workstream, tags: tagsFormatted })) || `Includes workstream: ${primary.workstream}: ${tagsFormatted}`;
          bg = 'rgba(245, 158, 11, 0.1)';
          border = 'rgba(245, 158, 11, 0.3)';
          color = '#d97706';
        } else {
          msg = (typeof t === 'function' && t('workstream.matchesWorkstream', { workstream: primary.workstream, tags: tagsFormatted })) || `Matches workstream: ${primary.workstream}: ${tagsFormatted}`;
          bg = 'rgba(16, 185, 129, 0.1)';
          border = 'rgba(16, 185, 129, 0.3)';
          color = '#059669';
        }

        hierarchyBox.style.display = 'flex';
        hierarchyBox.style.background = bg;
        hierarchyBox.style.border = `1px solid ${border}`;
        hierarchyBox.style.color = color;
        hierarchyBox.innerHTML = `<span>ℹ️</span> <span>${escH(msg)}</span>`;
      } else {
        hierarchyBox.style.display = 'none';
      }
    }

    const notesNumEl = overlay.querySelector('#ws-matching-notes-num');
    if (notesNumEl) notesNumEl.textContent = String(matchingNotes.length);
    const decNumEl = overlay.querySelector('#ws-matching-decisions-num');
    if (decNumEl) decNumEl.textContent = String(matchingDecisions.length);
    const taskNumEl = overlay.querySelector('#ws-matching-tasks-num');
    if (taskNumEl) taskNumEl.textContent = String(matchingTasks.length);

    const contentListEl = overlay.querySelector('#ws-assign-matching-content-list');
    if (!contentListEl) return;
    contentListEl.innerHTML = '';

    if (currentActivePreviewTab === 'notes') {
      const displayNotes = matchingNotes.slice(0, 10);
      if (displayNotes.length === 0) {
        contentListEl.innerHTML = `<div style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:16px; font-style:italic;">${escH(t('workstream.noMatchingNotes') || 'No matching notes found for current selection.')}</div>`;
      } else {
        displayNotes.forEach(n => {
          const card = document.createElement('div');
          card.className = 'workstream-note-card';
          card.style.cssText = 'padding:8px 10px; cursor:pointer; background:var(--card-bg);';
          card.title = t('workstream.doubleClickToOpenNote') || 'Double-click to open note';

          let summaryHtml = '';
          if (n.summary) {
            summaryHtml = n.summary;
          } else if (typeof cachedPreviews !== 'undefined' && cachedPreviews[n.path]) {
            const raw = cachedPreviews[n.path];
            summaryHtml = (typeof marked !== 'undefined' && typeof marked.parse === 'function') ? marked.parse(raw) : escH(raw);
          }

          const groupTag = n.group_tags?.[0] || '';
          const majorTag = n.major_topic_tags?.[0] || '';
          const topicTag = n.topic_tags?.[0] || '';

          card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
              <span style="font-weight:700; font-size:0.85rem; color:var(--text); line-height:1.3; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical;">${getWsIcon('fileText', 14)} ${escH(n.title || 'Untitled Note')}</span>
              <span style="font-size:0.7rem; color:var(--text-muted); flex-shrink:0;">${escH(n.date || '')}</span>
            </div>
            ${summaryHtml ? `<div class="workstream-note-summary" style="max-height:44px; overflow:hidden; font-size:0.75rem; color:var(--text-muted); margin:4px 0;">${summaryHtml}</div>` : ''}
            <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:2px;">
              ${groupTag ? `<span class="tag-pill group-tag" style="font-size:0.65rem; padding:1px 5px;">${getWsIcon('users', 11)} ${escH(groupTag)}</span>` : ''}
              ${majorTag ? `<span class="tag-pill major-tag" style="font-size:0.65rem; padding:1px 5px;">${getWsIcon('brain', 11)} ${escH(majorTag)}</span>` : ''}
              ${topicTag ? `<span class="tag-pill topic-tag" style="font-size:0.65rem; padding:1px 5px;">${getWsIcon('tag', 11)} ${escH(topicTag)}</span>` : ''}
            </div>
          `;
          card.addEventListener('dblclick', () => {
            if (n.path) openDecisionNoteOverlay(n.path);
          });
          contentListEl.appendChild(card);
        });
      }
    } else if (currentActivePreviewTab === 'decisions') {
      const displayDecisions = matchingDecisions.slice(0, 10);
      if (displayDecisions.length === 0) {
        contentListEl.innerHTML = `<div style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:16px; font-style:italic;">${escH(t('workstream.noMatchingDecisions') || 'No matching decisions found for current selection.')}</div>`;
      } else {
        displayDecisions.forEach(d => {
          const card = document.createElement('div');
          card.className = 'workstream-note-card';
          card.style.cssText = 'padding:8px 10px; background:var(--card-bg);';

          const groupTag = d.group_tags?.[0] || d.group || '';
          const majorTag = d.major_topic_tags?.[0] || d.major || '';
          const topicTag = d.topic_tags?.[0] || d.topic || '';

          card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
              <span style="font-weight:600; font-size:0.84rem; color:var(--text); line-height:1.3; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">⚖️ ${escH(d.text || d.title || 'Decision')}</span>
              <span class="badge" style="font-size:0.68rem; padding:1px 6px; border-radius:10px; background:rgba(16,185,129,0.12); color:#10b981; flex-shrink:0;">${escH(d.status || 'Active')}</span>
            </div>
            <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">
              ${groupTag ? `<span class="tag-pill group-tag" style="font-size:0.65rem; padding:1px 5px;">${getWsIcon('users', 11)} ${escH(groupTag)}</span>` : ''}
              ${majorTag ? `<span class="tag-pill major-tag" style="font-size:0.65rem; padding:1px 5px;">${getWsIcon('brain', 11)} ${escH(majorTag)}</span>` : ''}
              ${topicTag ? `<span class="tag-pill topic-tag" style="font-size:0.65rem; padding:1px 5px;">${getWsIcon('tag', 11)} ${escH(topicTag)}</span>` : ''}
            </div>
          `;
          contentListEl.appendChild(card);
        });
      }
    } else if (currentActivePreviewTab === 'tasks') {
      const displayTasks = matchingTasks.slice(0, 10);
      if (displayTasks.length === 0) {
        contentListEl.innerHTML = `<div style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:16px; font-style:italic;">${escH(t('workstream.noMatchingTasks') || 'No matching tasks found for current selection.')}</div>`;
      } else {
        displayTasks.forEach(tItem => {
          const card = document.createElement('div');
          card.className = 'workstream-note-card';
          card.style.cssText = 'padding:8px 10px; background:var(--card-bg);';

          const groupTag = tItem.group_tags?.[0] || tItem.group || '';
          const majorTag = tItem.major_topic_tags?.[0] || tItem.major || tItem.workstream || '';
          const topicTag = tItem.topic_tags?.[0] || tItem.topic || '';
          const isDone = Boolean(tItem.priority === 'Done' || tItem.status === 'completed' || tItem.completed === true || tItem.done === true);

          card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
              <span style="font-weight:600; font-size:0.84rem; color:var(--text); line-height:1.3; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; ${isDone ? 'text-decoration:line-through; opacity:0.7;' : ''}">☑️ ${escH(tItem.title || tItem.text || 'Task')}</span>
              <span style="font-size:0.7rem; color:var(--text-muted); flex-shrink:0;">${escH(tItem.dueDate || '')}</span>
            </div>
            <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">
              ${groupTag ? `<span class="tag-pill group-tag" style="font-size:0.65rem; padding:1px 5px;">${getWsIcon('users', 11)} ${escH(groupTag)}</span>` : ''}
              ${majorTag ? `<span class="tag-pill major-tag" style="font-size:0.65rem; padding:1px 5px;">${getWsIcon('brain', 11)} ${escH(majorTag)}</span>` : ''}
              ${topicTag ? `<span class="tag-pill topic-tag" style="font-size:0.65rem; padding:1px 5px;">${getWsIcon('tag', 11)} ${escH(topicTag)}</span>` : ''}
            </div>
          `;
          contentListEl.appendChild(card);
        });
      }
    }
  };

  // Preview tab switcher listeners
  overlay.querySelectorAll('.ws-preview-segmented-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      overlay.querySelectorAll('.ws-preview-segmented-tab').forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');
      currentActivePreviewTab = tabBtn.getAttribute('data-tab') || 'notes';
      updateMatchingCount();
    });
  });

  groupEditor = setupWorkstreamSelectionTagEditor(groupContainer, initialGroupVal, 'group', () => updateMatchingCount(), getContextValues);
  majorEditor = setupWorkstreamSelectionTagEditor(majorContainer, initialMajorVal, 'major', () => updateMatchingCount(), getContextValues);
  topicEditor = setupWorkstreamSelectionTagEditor(topicContainer, initialTopicVal, 'topic', () => updateMatchingCount(), getContextValues);

  updateMatchingCount();

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    groupEditor?.closeDropdown();
    majorEditor?.closeDropdown();
    topicEditor?.closeDropdown();
    document.querySelectorAll('.tag-suggest-dropdown').forEach(d => d.remove());
    overlay.remove();
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKeyDown);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelector('#close-assign-tag-modal')?.addEventListener('click', close);
  overlay.querySelector('#btn-assign-tag-close')?.addEventListener('click', close);

  const saveSelectionRule = async () => {
    const groupVal = (groupEditor?.getValue() || '').trim();
    const majorVal = (majorEditor?.getValue() || '').trim();
    const topicVal = (topicEditor?.getValue() || '').trim();

    const isWildcardAll = (!groupVal || groupVal === '*') && (!majorVal || majorVal === '*') && (!topicVal || topicVal === '*');
    if (isWildcardAll) {
      const confirmed = confirm(t('workstream.wildcardConfirm') || 'This selection group will match ALL notes, decisions, and tasks in your workspace. Are you sure you want to save this wildcard selection?');
      if (!confirmed) return;
    }

    close();
    if (typeof saveMajorTopicMemory === 'function') {
      const mapped = memory.mappedTags || { major_topic_tags: [], topic_tags: [], group_tags: [], tagGroups: [] };
      const tagGroups = Array.isArray(mapped.tagGroups) ? [...mapped.tagGroups] : [];

      const newRule = {
        id: existingRule?.id || `rule_${Date.now()}`,
        group: groupVal,
        major: majorVal,
        topic: topicVal
      };

      if (isEditMode && editGroupIndex >= 0 && editGroupIndex < tagGroups.length) {
        tagGroups[editGroupIndex] = newRule;
      } else {
        tagGroups.push(newRule);
      }

      mapped.tagGroups = tagGroups;

      await saveMajorTopicMemory(topicName, { ...memory, mappedTags: mapped });
      toast(`✨ ${t('common.saved') || 'Tag selection saved!'}`);
      const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
      if (c) renderRegisterView(c);
    }
  };

  overlay.querySelector('#btn-assign-group-submit')?.addEventListener('click', saveSelectionRule);

  overlay.querySelector('#btn-delete-selection-group')?.addEventListener('click', async () => {
    if (confirm(t('workstream.deleteSelectionConfirm') || 'Delete this selection group?')) {
      close();
      if (typeof saveMajorTopicMemory === 'function') {
        const mapped = memory.mappedTags || { major_topic_tags: [], topic_tags: [], group_tags: [], tagGroups: [] };
        const tagGroups = Array.isArray(mapped.tagGroups) ? [...mapped.tagGroups] : [];
        if (editGroupIndex >= 0 && editGroupIndex < tagGroups.length) {
          tagGroups.splice(editGroupIndex, 1);
        }
        mapped.tagGroups = tagGroups;
        await saveMajorTopicMemory(topicName, { ...memory, mappedTags: mapped });
        toast(`${t('common.saved') || 'Selection group removed'}`);
        const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
        if (c) renderRegisterView(c);
      }
    }
  });
}

function isFullTopicMemory(mem) {
  return !!(mem && (Array.isArray(mem.keyFacts) || Array.isArray(mem.activeMilestones) || Array.isArray(mem.decisions) || typeof mem.scratchpad === 'string' || mem.mappedTags));
}

function openDeleteWorkstreamModal(topicName) {
  if (!topicName) return;
  const modal = document.getElementById('modal-delete-workstream');
  if (!modal) {
    if (confirm((typeof t === 'function' ? t('workstream.deleteModalMessage', { name: topicName }) : '') || `Delete workstream "${topicName}"?`)) {
      if (typeof WorkstreamMemoryEngine !== 'undefined') {
        WorkstreamMemoryEngine.deleteTopicMemory(topicName).then(() => {
          toast(t('workstream.deletedToast') || 'Workstream memory deleted!');
          selectedRegistryProject = REGISTRY_OTHER_PROJECTS_KEY;
          if (typeof renderTeamPanel === 'function') renderTeamPanel();
          if (typeof renderNotesWorkstreamBar === 'function') renderNotesWorkstreamBar();
        });
      }
    }
    return;
  }

  const msgEl = document.getElementById('delete-ws-confirm-msg');
  if (msgEl) {
    const rawMsg = (typeof t === 'function' ? t('workstream.deleteModalMessage', { name: topicName }) : '') || `Are you sure you want to delete the workstream "${topicName}"?`;
    msgEl.textContent = rawMsg;
  }

  const confirmBtn = document.getElementById('btn-confirm-delete-ws');
  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      if (typeof closeModal === 'function') closeModal('modal-delete-workstream');
      if (typeof WorkstreamMemoryEngine !== 'undefined') {
        await WorkstreamMemoryEngine.deleteTopicMemory(topicName);
        toast(t('workstream.deletedToast') || 'Workstream memory deleted!');
        selectedRegistryProject = REGISTRY_OTHER_PROJECTS_KEY;
        if (typeof renderTeamPanel === 'function') renderTeamPanel();
        if (typeof renderNotesWorkstreamBar === 'function') renderNotesWorkstreamBar();
      }
    };
  }

  if (typeof openModal === 'function') {
    openModal('modal-delete-workstream');
  } else {
    modal.classList.add('active');
  }
}
window.openDeleteWorkstreamModal = openDeleteWorkstreamModal;

async function renderWorkstreamHeader(topicName, parentContainer, existingMemory = null) {
  if (!topicName || topicName === REGISTRY_ALL_PROJECTS_KEY || topicName === REGISTRY_OTHER_PROJECTS_KEY) return null;

  const validExisting = isFullTopicMemory(existingMemory) ? existingMemory : null;
  const memory = validExisting ||
    (typeof getMajorTopicMemorySync === 'function' ? getMajorTopicMemorySync(topicName) : null) ||
    (typeof getMajorTopicMemory === 'function' ? (await getMajorTopicMemory(topicName, { skipAutoArchive: true })) : null) || {
      topicName,
      summary: '',
      keyFacts: [],
      activeMilestones: [],
      decisions: [],
      openThreads: [],
      participants: [],
      associatedNotes: [],
      scratchpad: '',
      status: 'active',
      pinned: false,
      mappedTags: { major_topic_tags: [topicName], topic_tags: [], group_tags: [], tagGroups: [] }
    };

  const isArchived = memory?.status === 'archived';
  const isPinned = !!memory?.pinned;

  const headerCard = document.createElement('div');
  headerCard.className = 'workstream-dossier-header-bar';
  headerCard.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:nowrap; padding:8px 12px; margin:0 0 6px 0; border:1px solid var(--card-border); background:var(--card-bg-alt); border-radius:8px; flex-shrink:0;';

  headerCard.innerHTML = `
    <div style="display:flex; align-items:center; gap:6px; flex:1; min-width:0;">
      <span style="font-size:1.05rem; font-weight:700; color:var(--accent); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:inline-flex; align-items:center; gap:6px;">${getWsIcon('workstream', 18)} ${escH(topicName)}</span>
      <button type="button" class="btn-icon" id="btn-pin-ws" title="${escA(isPinned ? (t('workstream.unpinTooltip') || 'Unpin workstream') : (t('workstream.pinTooltip') || 'Pin workstream to top'))}" style="background:none; border:none; cursor:pointer; font-size:0.95rem; opacity:${isPinned ? '1' : '0.4'};">
        ${isPinned ? getWsIcon('starFilled', 16) : getWsIcon('star', 16)}
      </button>
      <span class="badge" style="font-size:0.7rem; padding:1px 6px; border-radius:10px; background:${isArchived ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)'}; color:${isArchived ? '#ef4444' : '#10b981'}; border:1px solid ${isArchived ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'};">
        ${isArchived ? (t('workstream.statusArchived') || 'Archived (>30d)') : (t('workstream.statusActive') || 'Active')}
      </span>
    </div>
    
    <div style="display:flex; align-items:center; gap:5px; flex-shrink:0;">
      <button type="button" class="btn btn-secondary" style="font-size:0.75rem; padding:4px 10px; font-weight:600; display:inline-flex; align-items:center; gap:4px; height:28px; line-height:1;" id="btn-generate-ai-ws" title="${escA(t('workstream.generateWithAITooltip') || 'Synthesize memory dossier using Secretary AI Agent')}">
        ${getWsIcon('sparkles', 14)} ${escH(t('workstream.aiSynthBtn') || 'Synthèse IA')}
      </button>
      <button type="button" class="btn btn-secondary" style="font-size:0.75rem; padding:4px 8px; font-weight:500; height:28px; display:inline-flex; align-items:center; gap:4px; line-height:1;" id="btn-toggle-archive-ws" title="${escA(isArchived ? (t('workstream.reactivateTooltip') || 'Reactivate workstream memory') : (t('workstream.archiveTooltip') || 'Archive workstream memory'))}">
        ${isArchived ? getWsIcon('folderOpen', 14) + ' ' + escH(t('workstream.reactivate') || 'Reactivate') : getWsIcon('archive', 14) + ' ' + escH(t('workstream.archive') || 'Archive')}
      </button>
      <button type="button" class="btn btn-secondary" style="font-size:0.75rem; padding:4px 8px; color:#ef4444; height:28px; display:inline-flex; align-items:center; justify-content:center; line-height:1;" id="btn-delete-ws" title="${escA(t('workstream.deleteTooltip') || 'Delete this workstream memory file')}">
        ${getWsIcon('trash', 14)}
      </button>
    </div>
  `;

  parentContainer.innerHTML = '';
  parentContainer.appendChild(headerCard);

  headerCard.querySelector('#btn-generate-ai-ws')?.addEventListener('click', () => {
    openWorkstreamSynthesisModal(topicName);
  });

  headerCard.querySelector('#btn-pin-ws')?.addEventListener('click', async () => {
    if (typeof saveMajorTopicMemory === 'function') {
      await saveMajorTopicMemory(topicName, {
        ...memory,
        pinned: !isPinned
      });
      toast(isPinned ? (t('workstream.unpinnedToast') || 'Workstream unpinned') : (t('workstream.pinnedToast') || 'Workstream pinned!'));
      if (typeof renderTeamPanel === 'function') renderTeamPanel();
    }
  });

  headerCard.querySelector('#btn-toggle-archive-ws')?.addEventListener('click', async () => {
    if (typeof WorkstreamMemoryEngine !== 'undefined') {
      if (isArchived) {
        await WorkstreamMemoryEngine.unarchiveTopicMemory(topicName);
        toast(t('workstream.reactivatedToast') || 'Workstream reactivated!');
      } else {
        await WorkstreamMemoryEngine.archiveTopicMemory(topicName);
        toast(t('workstream.archivedToast') || 'Workstream archived!');
      }
      if (typeof renderTeamPanel === 'function') renderTeamPanel();
    }
  });

  headerCard.querySelector('#btn-delete-ws')?.addEventListener('click', () => {
    openDeleteWorkstreamModal(topicName);
  });

  return memory;
}

async function renderWorkstreamOverviewTab(topicName, parentContainer, existingMemory = null) {
  if (!topicName || topicName === REGISTRY_ALL_PROJECTS_KEY || topicName === REGISTRY_OTHER_PROJECTS_KEY) return;

  const validExisting = isFullTopicMemory(existingMemory) ? existingMemory : null;
  const memory = validExisting ||
    (typeof getMajorTopicMemorySync === 'function' ? getMajorTopicMemorySync(topicName) : null) ||
    (typeof getMajorTopicMemory === 'function' ? (await getMajorTopicMemory(topicName, { skipAutoArchive: true })) : null) || {
      topicName,
      summary: '',
      keyFacts: [],
      activeMilestones: [],
      decisions: [],
      openThreads: [],
      participants: [],
      associatedNotes: [],
      scratchpad: '',
      status: 'active',
      pinned: false,
      mappedTags: { major_topic_tags: [topicName], topic_tags: [], group_tags: [], tagGroups: [] }
    };

  const overviewView = document.createElement('div');
  overviewView.className = 'workstream-overview-tab';
  overviewView.style.cssText = 'display:flex; flex-direction:column; gap:10px; width:100%;';

  const keyFactsList = Array.isArray(memory.keyFacts) ? memory.keyFacts : [];
  const milestonesList = Array.isArray(memory.activeMilestones) ? memory.activeMilestones : [];
  const openThreadsList = Array.isArray(memory.openThreads) ? memory.openThreads : (Array.isArray(memory.open_threads) ? memory.open_threads : []);
  const scratchpadText = (memory.scratchpad || '').trim();

  let scratchpadHtml = '';
  if (scratchpadText) {
    if (scratchpadText.includes('<') && (scratchpadText.includes('</') || scratchpadText.includes('/>') || scratchpadText.startsWith('<'))) {
      scratchpadHtml = scratchpadText;
    } else if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
      scratchpadHtml = marked.parse(scratchpadText);
    } else {
      scratchpadHtml = escH(scratchpadText).replace(/\n/g, '<br>');
    }
  }

  const mapped = memory.mappedTags || {};
  const tagGroups = Array.isArray(mapped.tagGroups) ? mapped.tagGroups : [];
  const groupTags = (mapped.group_tags || []).filter(Boolean);
  const majorTags = (mapped.major_topic_tags || []).filter(Boolean);
  const topicTags = (mapped.topic_tags || []).filter(Boolean);

  const hasWildcard = majorTags.includes('*') || groupTags.includes('*') || topicTags.includes('*') || tagGroups.some(tg => tg && (tg.group === '*' || tg.major === '*' || tg.topic === '*'));
  const isTagless = tagGroups.length === 0 && groupTags.length === 0 && majorTags.length === 0 && topicTags.length === 0;

  const hasScratchpadContent = !!scratchpadText;
  const scratchpadTooltip = hasScratchpadContent
    ? (t('workstream.clickToModify') || 'Click to modify')
    : (t('workstream.editScratchpadTooltip') || 'Click to view & edit agent memory scratchpad');

  const activeSynth = (typeof window !== 'undefined' && window._activeWorkstreamSyntheses) ? window._activeWorkstreamSyntheses.get(topicName) : null;
  const isSynthRunning = !!(activeSynth && activeSynth.status === 'running');

  overviewView.innerHTML = `
    ${isSynthRunning ? `
      <!-- Active Workstream AI Synthesis Live Progress & Console Log Stream Banner -->
      <div class="ws-overview-synthesis-banner" id="ws-overview-synthesis-banner" style="border:1px solid var(--accent); background:rgba(99, 102, 241, 0.06); padding:12px 14px; border-radius:10px; display:flex; flex-direction:column; gap:10px; margin-bottom:4px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:700; font-size:0.88rem; color:var(--text); display:flex; align-items:center; gap:8px;">
            <span class="ws-synthesis-spinner" style="width:14px; height:14px; border:2px solid var(--accent); border-top-color:transparent; border-radius:50%; display:inline-block; animation:spin 0.8s linear infinite;"></span>
            <span id="ws-overview-progress-label">${escH(activeSynth.label || 'Synthesizing workstream memory with Secretary AI...')}</span>
          </span>
          <span id="ws-overview-progress-percent" style="font-weight:700; font-size:0.82rem; color:var(--accent);">${activeSynth.percent || 15}%</span>
        </div>
        <div style="height:6px; background:var(--card-border); border-radius:4px; overflow:hidden;">
          <div id="ws-overview-progress-fill" style="height:100%; background:var(--accent); width:${activeSynth.percent || 15}%; transition:width 0.3s ease;"></div>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="font-size:0.72rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
            <span>${getWsIcon('terminal', 13)}</span> <span>${escH(t('workstream.consoleLogTitle') || 'Console Activity Log')}</span>
          </div>
          <div id="ws-overview-console-stream" class="ws-synthesis-console-box" style="max-height:140px; overflow-y:auto; font-family:var(--font-mono, monospace); font-size:0.75rem; background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:6px; border:1px solid var(--card-border);">
            ${(activeSynth.logs || []).map(log => `<div class="ws-console-line"><span class="ws-console-text">${escH(log)}</span></div>`).join('')}
          </div>
        </div>
      </div>
    ` : ''}

    <!-- Scope (Auto-saves on input/blur & rich HTML editable) -->
    <div style="display:flex; flex-direction:column; gap:4px;">
      <label for="ws-dossier-summary" style="font-size:0.78rem; font-weight:600; color:var(--text-muted); display:inline-flex; align-items:center; gap:5px;">
        ${getWsIcon('target', 14)} ${escH(t('workstream.summaryLabel') || 'Workstream Scope:')}
        ${isSynthRunning ? `<span style="font-size:0.72rem; color:var(--accent); font-weight:600; font-style:italic;">(${escH(t('workstream.scopeSynthesizing') || 'Synthesizing...')}...)</span>` : ''}
      </label>
      <div id="ws-dossier-summary" class="field-input workstream-scope-editable" contenteditable="true" style="width:100%; min-height:56px; max-height:220px; overflow-y:auto; font-size:0.84rem; padding:8px 12px; border-radius:6px; border:1px solid var(--card-border); background:var(--card-bg); color:var(--text); line-height:1.5; outline:none; box-sizing:border-box;" title="${escA(t('workstream.summaryInputTooltip') || 'Edit scope and boundaries for this workstream')}" data-placeholder="${escA(t('workstream.summaryPlaceholder') || '1-sentence explanation of the workstream, then bullet points defining in-scope and out-of-scope if needed...')}"></div>
    </div>

    <!-- Assigned Selection Groups Section -->
    <div style="display:flex; flex-direction:column; gap:6px; border:1px solid var(--card-border); border-radius:8px; padding:8px 10px; background:var(--card-bg);">
      <div style="display:flex; flex-direction:column; gap:2px;">
        <div style="font-weight:600; font-size:0.78rem; color:var(--text-muted);">
          ${getWsIcon('tag', 14)} ${escH(t('workstream.selectionGroups') || 'Assigned Selection Groups:')}
        </div>
        <div style="font-size:0.74rem; color:var(--text-muted); line-height:1.4;">
          ${escH(t('workstream.selectionGroupsDesc') || 'Selection groups define which notes, tasks, and decisions belong to this workstream based on combinations of tags.')}
        </div>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:6px; min-height:26px; align-items:center;">
        ${tagGroups.length > 0 ? tagGroups.map((tg, idx) => {
          const relations = detectTagGroupHierarchy(tg, topicName);
          const relInfo = relations.length > 0 ? relations[0] : null;
          let relBadgeHtml = '';
          if (relInfo) {
            const relText = `${relInfo.workstream}: ${formatTagGroupSummary(relInfo.otherRule)}`;
            const relPrefix = relInfo.type === 'part_of' ? '↳ ' : (relInfo.type === 'contains' ? '↱ ' : '≈ ');
            relBadgeHtml = `<span class="workstream-hierarchy-chip-hint" style="font-size:0.68rem; opacity:0.85; margin-left:4px; padding:1px 5px; border-radius:4px; background:rgba(0,0,0,0.06); font-weight:500;" title="${escA(relInfo.summary)}">${relPrefix}${escH(relText)}</span>`;
          }
          let isActiveMatch = false;
          if (typeof currentNote !== 'undefined' && currentNote) {
            if (typeof matchTagsToSelectionGroup === 'function') {
              isActiveMatch = matchTagsToSelectionGroup(currentNote, tg) && (tg.group || tg.major || tg.topic);
            } else {
              const noteGroups = currentNote.group_tags || [];
              const noteMajors = currentNote.major_topic_tags || [];
              const noteTopics = currentNote.topic_tags || [];
              const grpMatch = !tg.group || tg.group === '*' || noteGroups.some(g => String(g || '').toLowerCase() === String(tg.group || '').toLowerCase());
              const majMatch = !tg.major || tg.major === '*' || noteMajors.some(m => String(m || '').toLowerCase() === String(tg.major || '').toLowerCase());
              const topMatch = !tg.topic || tg.topic === '*' || noteTopics.some(t => String(t || '').toLowerCase() === String(tg.topic || '').toLowerCase());
              if (grpMatch && majMatch && topMatch && (tg.group || tg.major || tg.topic)) {
                isActiveMatch = true;
              }
            }
          }
          return `
          <div class="workstream-selection-chip ${isActiveMatch ? 'is-active-match' : ''}" data-index="${idx}" title="${escA(isActiveMatch ? ((t('workstream.activeSelectionGroupMatch') || 'Active selection group match') + ' - ' + (t('workstream.clickToEditSelection') || 'Click to edit')) : (t('workstream.clickToEditSelection') || 'Click to edit selection group'))}">
            ${isActiveMatch ? `<span style="color:var(--accent); font-weight:700; margin-right:2px;" title="${escA(t('workstream.matchedSelectionGroup') || 'Matched')}">✓</span>` : ''}
            ${tg.group ? `<span style="display:inline-flex; align-items:center; gap:3px;"><span style="opacity:0.85;">${getWsIcon('users', 11)}</span> <strong>${escH(tg.group)}</strong></span>` : ''}
            ${(tg.group && (tg.major || tg.topic)) ? `<span style="opacity:0.4;">·</span>` : ''}
            ${tg.major ? `<span style="display:inline-flex; align-items:center; gap:3px;"><span style="opacity:0.85;">${getWsIcon('brain', 11)}</span> <strong>${escH(tg.major)}</strong></span>` : ''}
            ${(tg.major && tg.topic) ? `<span style="opacity:0.4;">·</span>` : ''}
            ${tg.topic ? `<span style="display:inline-flex; align-items:center; gap:3px;"><span style="opacity:0.85;">${getWsIcon('tag', 11)}</span> <strong>${escH(tg.topic)}</strong></span>` : ''}
            ${(!tg.group && !tg.major && !tg.topic) ? `<span style="display:inline-flex; align-items:center; gap:3px;">${getWsIcon('globe', 12)} ${escH(t('workstream.allMatching') || 'All matching')}</span>` : ''}
            ${relBadgeHtml}
            <button type="button" class="workstream-selection-remove" data-index="${idx}" title="${escA(t('workstream.deleteSelectionGroup') || 'Delete selection')}">✕</button>
          </div>
        `}).join('') : `
          ${(isTagless || hasWildcard) ? `
            <span class="tag-pill" id="btn-wildcard-chip" style="cursor:pointer; font-weight:600; background:rgba(99, 102, 241, 0.12); color:var(--accent); border:1px dashed var(--accent); display:inline-flex; align-items:center; gap:5px;" title="${escA(t('workstream.wildcardChipTooltip') || 'Matches all content. Click to configure specific tags.')}">
              <span>${getWsIcon('globe', 12)} ${escH(t('workstream.allMatching') || 'All matching')}</span>
              <button type="button" class="rm workstream-wildcard-remove" style="background:none; border:none; color:inherit; cursor:pointer; padding:0 2px; line-height:1;" title="${escA(t('workstream.configureTags') || 'Configure tags')}">✕</button>
            </span>
          ` : `
            ${groupTags.map(gt => `
              <span class="tag-pill group-tag" title="${escA(t('workstream.deassociateTooltip') || 'Remove tag')}">
                <span>${getWsIcon('users', 11)} ${escH(gt)}</span>
                <button type="button" class="rm workstream-tag-remove" data-tag-type="group" data-tag="${escA(gt)}" title="${escA(t('workstream.deassociateTooltip') || 'Remove tag')}">✕</button>
              </span>
            `).join('')}

            ${majorTags.map(mt => `
              <span class="tag-pill major-tag" title="${escA(t('workstream.deassociateTooltip') || 'Remove tag')}">
                <span>${getWsIcon('brain', 11)} ${escH(mt)}</span>
                <button type="button" class="rm workstream-tag-remove" data-tag-type="major" data-tag="${escA(mt)}" title="${escA(t('workstream.deassociateTooltip') || 'Remove tag')}">✕</button>
              </span>
            `).join('')}

            ${topicTags.map(tt => `
              <span class="tag-pill topic-tag" title="${escA(t('workstream.deassociateTooltip') || 'Remove tag')}">
                <span>${getWsIcon('tag', 11)} ${escH(tt)}</span>
                <button type="button" class="rm workstream-tag-remove" data-tag-type="topic" data-tag="${escA(tt)}" title="${escA(t('workstream.deassociateTooltip') || 'Remove tag')}">✕</button>
              </span>
            `).join('')}
          `}
        `}

        <button type="button" class="workstream-tag-add-btn" id="btn-assign-tag-modal" title="${escA(t('workstream.addSelectionGroup') || '+ New Selection Group')}">
          <span style="font-size:0.85rem; font-weight:700; line-height:1;">+</span>
          <span>${escH(t('workstream.addSelectionGroupShort') || 'Add')}</span>
        </button>
      </div>
    </div>

    <!-- Split Content Row: Left = Main Points & Open Topics, Right = Pure White Scratchpad HTML -->
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; font-size:0.78rem; align-items:stretch;">
      
      <!-- Left Column: Main Points (Key Facts & Milestones) + Open Topics -->
      <div style="display:flex; flex-direction:column; gap:10px;">
        
        <!-- Main Points & Milestones Card -->
        <div style="display:flex; flex-direction:column; gap:8px; border:1px solid var(--card-border); border-radius:8px; padding:10px 12px; background:var(--card-bg); flex:1;">
          <div style="font-weight:700; font-size:0.8rem; color:var(--accent); display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--card-border); padding-bottom:6px;">
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <span>${getWsIcon('pin', 14)} ${escH(t('workstream.mainPoints') || 'Main Points')}</span>
              <span class="badge" style="font-size:0.68rem; padding:1px 6px; border-radius:10px; background:rgba(99,102,241,0.12); color:var(--accent);">${keyFactsList.length}</span>
            </span>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <span>${getWsIcon('flag', 14)} ${escH(t('workstream.activeMilestones') || 'Milestones')}</span>
              <span class="badge" style="font-size:0.68rem; padding:1px 6px; border-radius:10px; background:rgba(245,158,11,0.12); color:#f59e0b;">${milestonesList.length}</span>
            </span>
          </div>
          
          <div style="display:flex; flex-direction:column; gap:4px; min-height:105px; max-height:220px; overflow-y:auto; padding-right:4px;">
            ${keyFactsList.length > 0 ? keyFactsList.map((fact, fIdx) => {
              const factText = typeof fact === 'string' ? fact : (fact.title || fact.text || JSON.stringify(fact));
              return `
              <div class="ws-point-item" data-point-type="fact" data-point-idx="${fIdx}">
                <div class="ws-point-content">
                  <span style="color:var(--accent); font-weight:700; flex-shrink:0;">•</span>
                  <span class="ws-point-text ws-point-fact-text" style="cursor:pointer; flex:1;" title="${escA(t('workstream.clickToEditPoint') || 'Click to edit this point')}">${escH(factText)}</span>
                </div>
                <button type="button" class="ws-point-remove-btn ws-btn-rm-fact" data-fact-idx="${fIdx}" title="${escA(t('workstream.removeMainPoint') || 'Remove bullet point')}">✕</button>
              </div>
            `}).join('') : `<div style="color:var(--text-muted); font-style:italic; font-size:0.75rem; padding:4px 6px;">${escH(t('workstream.noKeyFacts') || 'No key facts recorded yet')}</div>`}

            ${milestonesList.length > 0 ? `
              <div style="margin-top:6px; padding-top:6px; border-top:1px dashed var(--card-border); display:flex; flex-direction:column; gap:4px;">
                ${milestonesList.map((m, mIdx) => {
                  const mText = typeof m === 'string' ? m : (m.title || m.text || 'Milestone');
                  return `
                  <div class="ws-point-item" data-point-type="milestone" data-point-idx="${mIdx}">
                    <div class="ws-point-content" style="font-weight:600;">
                      <span style="color:#f59e0b; flex-shrink:0;">${getWsIcon('flag', 13)}</span>
                      <span class="ws-point-text ws-point-milestone-text" style="cursor:pointer; flex:1;" title="${escA(t('workstream.clickToEditPoint') || 'Click to edit this point')}">${escH(mText)}</span>
                    </div>
                    <button type="button" class="ws-point-remove-btn ws-btn-rm-milestone" data-milestone-idx="${mIdx}" title="${escA(t('workstream.removeMilestone') || 'Remove milestone')}">✕</button>
                  </div>
                `}).join('')}
              </div>
            ` : ''}
          </div>

          <!-- Add Main Point / Milestone Form -->
          <form class="ws-inline-add-form" id="form-add-main-point">
            <select class="ws-inline-select" id="ws-main-point-type" title="${escA(t('workstream.pointType') || 'Type')}">
              <option value="fact">${escH(t('workstream.bulletPoint') || 'Bullet Point')}</option>
              <option value="milestone">${escH(t('workstream.milestone') || 'Milestone')}</option>
            </select>
            <input type="text" class="ws-inline-input" id="ws-main-point-input" placeholder="${escA(t('workstream.addMainPointPlaceholder') || 'Add bullet point or milestone...')}" title="${escA(t('workstream.addMainPointTooltip') || 'Add bullet point or milestone')}" autocomplete="off" />
            <button type="submit" class="btn btn-secondary ws-inline-add-btn" title="${escA(t('workstream.addMainPointTooltip') || 'Add bullet point or milestone')}">+</button>
          </form>
        </div>

        <!-- Open Topics & Questions Card -->
        <div style="display:flex; flex-direction:column; gap:8px; border:1px solid var(--card-border); border-radius:8px; padding:10px 12px; background:var(--card-bg); flex:1;">
          <div style="font-weight:700; font-size:0.8rem; color:var(--accent); display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--card-border); padding-bottom:6px;">
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <span>${getWsIcon('messageSquare', 14)} ${escH(t('workstream.openThreads') || 'Open Threads / Questions')}</span>
              <span class="badge" style="font-size:0.68rem; padding:1px 6px; border-radius:10px; background:rgba(239,68,68,0.12); color:#ef4444;">${openThreadsList.length}</span>
            </span>
          </div>

          <div style="display:flex; flex-direction:column; gap:4px; min-height:85px; max-height:180px; overflow-y:auto; padding-right:4px;">
            ${openThreadsList.length > 0 ? openThreadsList.map((thread, tIdx) => {
              const thText = typeof thread === 'string' ? thread : (thread.text || thread.title || JSON.stringify(thread));
              return `
              <div class="ws-point-item" data-point-type="thread" data-point-idx="${tIdx}">
                <div class="ws-point-content">
                  <span style="color:#ef4444; flex-shrink:0;">${getWsIcon('helpCircle', 13)}</span>
                  <span class="ws-point-text ws-point-thread-text" style="cursor:pointer; flex:1;" title="${escA(t('workstream.clickToEditThread') || 'Click to edit this question')}">${escH(thText)}</span>
                </div>
                <button type="button" class="ws-point-remove-btn ws-btn-rm-thread" data-thread-idx="${tIdx}" title="${escA(t('workstream.removeOpenTopic') || 'Remove open topic')}">✕</button>
              </div>
            `}).join('') : `<div style="color:var(--text-muted); font-style:italic; font-size:0.75rem; padding:4px 6px;">${escH(t('workstream.noOpenThreads') || 'No open topics or questions recorded yet')}</div>`}
          </div>

          <!-- Add Open Topic Form -->
          <form class="ws-inline-add-form" id="form-add-open-topic">
            <input type="text" class="ws-inline-input" id="ws-open-topic-input" placeholder="${escA(t('workstream.addOpenTopicPlaceholder') || 'Add an open topic or question...')}" title="${escA(t('workstream.addOpenTopicTooltip') || 'Add open topic or question')}" autocomplete="off" />
            <button type="submit" class="btn btn-secondary ws-inline-add-btn" title="${escA(t('workstream.addOpenTopicTooltip') || 'Add open topic or question')}">+</button>
          </form>
        </div>

      </div>

      <!-- Right Column: Pure White Scratchpad HTML Preview (Clickable anywhere to edit) -->
      <div id="ws-scratchpad-preview-box" class="workstream-scratchpad-box" style="display:flex; flex-direction:column; gap:6px; border:1px solid var(--card-border); border-radius:8px; padding:10px 12px; background:var(--card-bg); cursor:pointer; transition:all 0.15s ease;" title="${escA(scratchpadTooltip)}">
        <div style="font-weight:700; font-size:0.8rem; color:var(--accent); display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
          <span style="display:inline-flex; align-items:center; gap:6px;">
            <span>${getWsIcon('fileText', 14)}</span> <span>${escH(t('workstream.scratchpadPreview') || 'Scratchpad (Agent Memory)')}</span>
          </span>
        </div>

        <div class="workstream-scratchpad-container" style="flex:1;">
          ${scratchpadHtml ? `
            <div class="workstream-scratchpad-html-body">
              ${scratchpadHtml}
            </div>
          ` : `
            <div style="color:#64748b; font-style:italic; font-size:0.82rem; padding:20px 12px; text-align:center; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; min-height:180px;">
              <span style="font-size:1.4rem; opacity:0.6;">${getWsIcon('fileText', 24)}</span>
              <span>${escH(t('workstream.emptyScratchpad') || 'No agent memory notes recorded yet. Click to view or edit...')}</span>
            </div>
          `}
        </div>
      </div>

    </div>
  `;

  parentContainer.innerHTML = '';
  parentContainer.appendChild(overviewView);

  // Scratchpad preview click listener
  const scratchpadBox = overviewView.querySelector('#ws-scratchpad-preview-box');
  if (scratchpadBox) {
    scratchpadBox.addEventListener('click', () => openEditScratchpadModal(topicName, memory));
  }

  // Main Point & Milestone Add Form Submit Listener
  const mainPointForm = overviewView.querySelector('#form-add-main-point');
  if (mainPointForm) {
    mainPointForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inputEl = mainPointForm.querySelector('#ws-main-point-input');
      const typeSelect = mainPointForm.querySelector('#ws-main-point-type');
      const val = (inputEl?.value || '').trim();
      const type = typeSelect?.value || 'fact';

      if (!val) return;

      if (typeof saveMajorTopicMemory === 'function') {
        const updatedMem = { ...memory };
        if (type === 'milestone') {
          const currentMilestones = Array.isArray(updatedMem.activeMilestones) ? [...updatedMem.activeMilestones] : [];
          currentMilestones.push(val);
          updatedMem.activeMilestones = currentMilestones;
          await saveMajorTopicMemory(topicName, updatedMem);
          toast(t('workstream.milestoneAddedToast') || 'Milestone added');
        } else {
          const currentFacts = Array.isArray(updatedMem.keyFacts) ? [...updatedMem.keyFacts] : [];
          currentFacts.push(val);
          updatedMem.keyFacts = currentFacts;
          await saveMajorTopicMemory(topicName, updatedMem);
          toast(t('workstream.mainPointAddedToast') || 'Main point added');
        }

        const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
        if (c && typeof renderRegisterView === 'function') renderRegisterView(c);
      }
    });
  }

  // Remove Main Point (Fact) Listener
  overviewView.querySelectorAll('.ws-btn-rm-fact').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-fact-idx'), 10);
      if (isNaN(idx)) return;

      if (typeof saveMajorTopicMemory === 'function') {
        const currentFacts = Array.isArray(memory.keyFacts) ? [...memory.keyFacts] : [];
        if (idx >= 0 && idx < currentFacts.length) {
          currentFacts.splice(idx, 1);
          await saveMajorTopicMemory(topicName, { ...memory, keyFacts: currentFacts });
          toast(t('workstream.mainPointRemovedToast') || 'Main point removed');
          const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
          if (c && typeof renderRegisterView === 'function') renderRegisterView(c);
        }
      }
    });
  });

  // Remove Milestone Listener
  overviewView.querySelectorAll('.ws-btn-rm-milestone').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-milestone-idx'), 10);
      if (isNaN(idx)) return;

      if (typeof saveMajorTopicMemory === 'function') {
        const currentMilestones = Array.isArray(memory.activeMilestones) ? [...memory.activeMilestones] : [];
        if (idx >= 0 && idx < currentMilestones.length) {
          currentMilestones.splice(idx, 1);
          await saveMajorTopicMemory(topicName, { ...memory, activeMilestones: currentMilestones });
          toast(t('workstream.milestoneRemovedToast') || 'Milestone removed');
          const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
          if (c && typeof renderRegisterView === 'function') renderRegisterView(c);
        }
      }
    });
  });

  // Open Topic Add Form Submit Listener
  const openTopicForm = overviewView.querySelector('#form-add-open-topic');
  if (openTopicForm) {
    openTopicForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inputEl = openTopicForm.querySelector('#ws-open-topic-input');
      const val = (inputEl?.value || '').trim();

      if (!val) return;

      if (typeof saveMajorTopicMemory === 'function') {
        const currentThreads = Array.isArray(memory.openThreads)
          ? [...memory.openThreads]
          : (Array.isArray(memory.open_threads) ? [...memory.open_threads] : []);
        currentThreads.push(val);

        await saveMajorTopicMemory(topicName, {
          ...memory,
          openThreads: currentThreads,
          open_threads: currentThreads
        });

        toast(t('workstream.openTopicAddedToast') || 'Open topic added');
        const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
        if (c && typeof renderRegisterView === 'function') renderRegisterView(c);
      }
    });
  }

  // Remove Open Topic Listener
  overviewView.querySelectorAll('.ws-btn-rm-thread').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-thread-idx'), 10);
      if (isNaN(idx)) return;

      if (typeof saveMajorTopicMemory === 'function') {
        const currentThreads = Array.isArray(memory.openThreads)
          ? [...memory.openThreads]
          : (Array.isArray(memory.open_threads) ? [...memory.open_threads] : []);
        if (idx >= 0 && idx < currentThreads.length) {
          currentThreads.splice(idx, 1);
          await saveMajorTopicMemory(topicName, {
            ...memory,
            openThreads: currentThreads,
            open_threads: currentThreads
          });
          toast(t('workstream.openTopicRemovedToast') || 'Open topic removed');
          const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
          if (c && typeof renderRegisterView === 'function') renderRegisterView(c);
        }
      }
    });
  });

  // Inline editing for main points (facts), milestones, and open questions
  const setupInlinePointEditing = (element, type, idx, initialText) => {
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      if (element.querySelector('input')) return; // Already editing

      const originalText = initialText;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = originalText;
      input.className = 'ws-point-inline-edit';
      input.style.cssText = 'width:100%; font:inherit; color:inherit; background:transparent; border:1px solid var(--accent); border-radius:4px; padding:1px 5px; outline:none; box-sizing:border-box;';
      input.title = type === 'thread'
        ? (t('workstream.clickToEditThread') || 'Click to edit this question')
        : (t('workstream.clickToEditPoint') || 'Click to edit this point');

      let isFinished = false;

      const finishEdit = async (save) => {
        if (isFinished) return;
        isFinished = true;
        const newText = input.value.trim();

        if (save && newText && newText !== originalText) {
          element.textContent = newText;
          if (typeof saveMajorTopicMemory === 'function') {
            const updatedMem = { ...memory };
            if (type === 'fact') {
              const facts = Array.isArray(updatedMem.keyFacts) ? [...updatedMem.keyFacts] : [];
              if (idx >= 0 && idx < facts.length) {
                facts[idx] = newText;
                updatedMem.keyFacts = facts;
              }
            } else if (type === 'milestone') {
              const ms = Array.isArray(updatedMem.activeMilestones) ? [...updatedMem.activeMilestones] : [];
              if (idx >= 0 && idx < ms.length) {
                if (typeof ms[idx] === 'object' && ms[idx] !== null) {
                  ms[idx] = { ...ms[idx], title: newText, text: newText };
                } else {
                  ms[idx] = newText;
                }
                updatedMem.activeMilestones = ms;
              }
            } else if (type === 'thread') {
              const threads = Array.isArray(updatedMem.openThreads) ? [...updatedMem.openThreads] : (Array.isArray(updatedMem.open_threads) ? [...updatedMem.open_threads] : []);
              if (idx >= 0 && idx < threads.length) {
                if (typeof threads[idx] === 'object' && threads[idx] !== null) {
                  threads[idx] = { ...threads[idx], title: newText, text: newText };
                } else {
                  threads[idx] = newText;
                }
                updatedMem.openThreads = threads;
                updatedMem.open_threads = threads;
              }
            }

            await saveMajorTopicMemory(topicName, updatedMem);
            const updateMsg = type === 'thread' ? (t('workstream.questionUpdatedToast') || 'Question updated') : (t('workstream.pointUpdatedToast') || 'Point updated');
            if (typeof toast === 'function') {
              toast(updateMsg);
            } else if (typeof window !== 'undefined' && typeof window.toast === 'function') {
              window.toast(updateMsg);
            }
            const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
            if (c && typeof renderRegisterView === 'function') renderRegisterView(c);
          }
        } else {
          element.textContent = originalText;
        }
      };

      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') {
          ke.preventDefault();
          finishEdit(true);
        } else if (ke.key === 'Escape') {
          ke.preventDefault();
          finishEdit(false);
        }
      });

      input.addEventListener('blur', () => {
        finishEdit(true);
      });

      element.innerHTML = '';
      element.appendChild(input);
      input.focus();
      input.select();
    });
  };

  overviewView.querySelectorAll('.ws-point-fact-text').forEach(el => {
    const item = el.closest('.ws-point-item');
    const idx = parseInt(item?.getAttribute('data-point-idx'), 10);
    const initialText = el.textContent.trim();
    setupInlinePointEditing(el, 'fact', idx, initialText);
  });

  overviewView.querySelectorAll('.ws-point-milestone-text').forEach(el => {
    const item = el.closest('.ws-point-item');
    const idx = parseInt(item?.getAttribute('data-point-idx'), 10);
    const initialText = el.textContent.trim();
    setupInlinePointEditing(el, 'milestone', idx, initialText);
  });

  overviewView.querySelectorAll('.ws-point-thread-text').forEach(el => {
    const item = el.closest('.ws-point-item');
    const idx = parseInt(item?.getAttribute('data-point-idx'), 10);
    const initialText = el.textContent.trim();
    setupInlinePointEditing(el, 'thread', idx, initialText);
  });

  // Assign tag modal listener (+ button)
  const assignTagBtn = overviewView.querySelector('#btn-assign-tag-modal');
  if (assignTagBtn) {
    assignTagBtn.addEventListener('click', () => openAssignTagModal(topicName, memory, -1));
  }

  // Selection chips click listener (to edit)
  overviewView.querySelectorAll('.workstream-selection-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.workstream-selection-remove')) return;
      const idx = parseInt(chip.getAttribute('data-index'), 10);
      openAssignTagModal(topicName, memory, isNaN(idx) ? -1 : idx);
    });
  });

  // Remove selection group button listener
  overviewView.querySelectorAll('.workstream-selection-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (isNaN(idx)) return;
      if (typeof saveMajorTopicMemory === 'function') {
        const m = memory.mappedTags || { major_topic_tags: [], topic_tags: [], group_tags: [], tagGroups: [] };
        const groups = Array.isArray(m.tagGroups) ? [...m.tagGroups] : [];
        if (idx >= 0 && idx < groups.length) {
          groups.splice(idx, 1);
        }
        m.tagGroups = groups;
        await saveMajorTopicMemory(topicName, { ...memory, mappedTags: m });
        toast(`${t('common.saved') || 'Selection group removed'}`);
        const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
        if (c) renderRegisterView(c);
      }
    });
  });

  // Wildcard chip click listener
  overviewView.querySelectorAll('#btn-wildcard-chip, .workstream-wildcard-remove').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      openAssignTagModal(topicName, memory, -1);
    });
  });

  // Remove tag listener (legacy fallback)
  overviewView.querySelectorAll('.workstream-tag-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tagToRemove = btn.getAttribute('data-tag');
      const tagType = btn.getAttribute('data-tag-type');
      if (tagToRemove && typeof saveMajorTopicMemory === 'function') {
        const m = memory.mappedTags || { major_topic_tags: [], topic_tags: [], group_tags: [] };
        if (tagType === 'group') {
          m.group_tags = (m.group_tags || []).filter(t => t !== tagToRemove);
        } else if (tagType === 'topic') {
          m.topic_tags = (m.topic_tags || []).filter(t => t !== tagToRemove);
        } else {
          m.major_topic_tags = (m.major_topic_tags || []).filter(t => t !== tagToRemove);
        }
        await saveMajorTopicMemory(topicName, { ...memory, mappedTags: m });
        toast(t('common.saved') || 'Tag unassigned');
        const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
        if (c) renderRegisterView(c);
      }
    });
  });

  // Auto-Save summary on debounce & blur + dynamic contenteditable handling
  const summaryEl = overviewView.querySelector('#ws-dossier-summary');
  if (summaryEl) {
    let rawSummary = (memory?.summary || '').trim() || (memory?.oneSentenceSummary || '').trim();
    if (rawSummary && !rawSummary.includes('<') && (rawSummary.includes('\n') || rawSummary.includes('*') || rawSummary.includes('-'))) {
      if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
        summaryEl.innerHTML = marked.parse(rawSummary);
      } else {
        summaryEl.innerHTML = escH(rawSummary).replace(/\n/g, '<br>');
      }
    } else {
      summaryEl.innerHTML = rawSummary;
    }

    let summarySaveTimeout = null;
    const triggerAutoSaveSummary = async () => {
      const summaryHtml = summaryEl.innerHTML.trim();
      if (typeof saveMajorTopicMemory === 'function' && summaryHtml !== (memory?.summary || '')) {
        const plain = summaryEl.textContent ? summaryEl.textContent.trim().split(/(?<=[.!?])\s+/)[0].trim() : '';
        await saveMajorTopicMemory(topicName, {
          ...memory,
          summary: summaryHtml,
          oneSentenceSummary: plain,
          status: memory?.status === 'archived' ? 'archived' : 'active',
          pinned: !!memory?.pinned
        });
      }
    };

    summaryEl.addEventListener('input', () => {
      clearTimeout(summarySaveTimeout);
      summarySaveTimeout = setTimeout(triggerAutoSaveSummary, 800);
    });

    summaryEl.addEventListener('blur', () => {
      clearTimeout(summarySaveTimeout);
      triggerAutoSaveSummary();
    });

    if (typeof attachRichTextShortcutsAndToolbar === 'function') {
      attachRichTextShortcutsAndToolbar(summaryEl);
    }
  }

  // Subscribe to live synthesis progress events for this topic
  const onProgressEvent = (e) => {
    if (e.detail?.topicName === topicName) {
      const state = e.detail.state || (window._activeWorkstreamSyntheses ? window._activeWorkstreamSyntheses.get(topicName) : null);
      if (state) {
        const fill = overviewView.querySelector('#ws-overview-progress-fill');
        const pct = overviewView.querySelector('#ws-overview-progress-percent');
        const label = overviewView.querySelector('#ws-overview-progress-label');
        const consoleStream = overviewView.querySelector('#ws-overview-console-stream');

        if (fill) fill.style.width = `${state.percent || 15}%`;
        if (pct) pct.textContent = `${state.percent || 15}%`;
        if (label && state.label) label.textContent = state.label;
        if (consoleStream && Array.isArray(state.logs) && state.logs.length > 0) {
          const lastLog = state.logs[state.logs.length - 1];
          const line = document.createElement('div');
          line.className = 'ws-console-line';
          line.innerHTML = `<span class="ws-console-text">${escH(lastLog)}</span>`;
          consoleStream.appendChild(line);
          consoleStream.scrollTop = consoleStream.scrollHeight;
        }

        if (state.status === 'completed') {
          window.removeEventListener('workstream-synthesis-progress', onProgressEvent);
          const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
          if (c && typeof renderRegisterView === 'function') renderRegisterView(c);
        }
      }
    }
  };
  window.addEventListener('workstream-synthesis-progress', onProgressEvent);
}

async function renderWorkstreamDossierPanel(topicName, parentContainer) {
  return renderWorkstreamHeader(topicName, parentContainer);
}

function openAssociateNoteModal(topicName) {
  const existingModal = document.getElementById('modal-associate-note');
  if (existingModal) existingModal.remove();

  const notes = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : ((typeof notesManifest !== 'undefined' && Array.isArray(notesManifest)) ? notesManifest : []);

  const overlay = document.createElement('div');
  overlay.id = 'modal-associate-note';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';

  overlay.innerHTML = `
    <div class="modal-card" style="background:var(--card-bg); color:var(--text); border:1px solid var(--card-border); border-radius:12px; width:100%; max-width:560px; padding:20px; box-shadow:var(--shadow-lg); display:flex; flex-direction:column; gap:12px; max-height:85vh;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3 style="margin:0; font-size:1.1rem; font-weight:700; color:var(--text);">
          <span>${getWsIcon('fileText', 16)}</span> <span>${escH(t('workstream.associateNote') || '+ Associate Note')}: "${escH(topicName)}"</span>
        </h3>
        <button type="button" class="btn-icon" id="close-assoc-note-modal" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.2rem;" title="${escA(t('common.close') || 'Close')}">✕</button>
      </div>

      <input type="search" id="search-assoc-note-input" class="field-input" placeholder="Search note title..." title="Search notes by title" style="width:100%; padding:8px 12px; font-size:0.85rem; border-radius:6px; border:1px solid var(--field-border); background:var(--field-bg); color:var(--field-text);">

      <div id="assoc-notes-picker-list" style="display:flex; flex-direction:column; gap:6px; overflow-y:auto; flex:1; min-height:160px; max-height:340px;">
      </div>

      <div style="display:flex; justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" id="btn-assoc-note-close" style="font-size:0.82rem; padding:6px 14px;" title="${escA(t('common.close') || 'Close')}">${escH(t('common.close') || 'Close')}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKeyDown);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelector('#close-assoc-note-modal')?.addEventListener('click', close);
  overlay.querySelector('#btn-assoc-note-close')?.addEventListener('click', close);

  const listEl = overlay.querySelector('#assoc-notes-picker-list');
  const searchInput = overlay.querySelector('#search-assoc-note-input');

  const renderPicker = (query = '') => {
    if (!listEl) return;
    listEl.innerHTML = '';
    const q = query.toLowerCase().trim();
    const filtered = notes.filter(n => (n.title || '').toLowerCase().includes(q) || (n.path || '').toLowerCase().includes(q));

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:2rem; font-style:italic;">No matching notes found</div>`;
      return;
    }

    filtered.forEach(n => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border:1px solid var(--card-border); border-radius:6px; background:var(--card-bg); cursor:pointer; transition:background 0.15s ease;';
      item.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:2px; min-width:0; flex:1;">
          <span style="font-weight:600; font-size:0.85rem; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${getWsIcon('fileText', 14)} ${escH(n.title || 'Untitled Note')}</span>
          <span style="font-size:0.72rem; color:var(--text-muted);">${escH(n.path || '')}</span>
        </div>
        <button type="button" class="btn btn-primary" style="font-size:0.75rem; padding:3px 10px; flex-shrink:0;">+ Add</button>
      `;
      item.addEventListener('click', async () => {
        close();
        if (typeof getMajorTopicMemory === 'function') {
          const memory = await getMajorTopicMemory(topicName, { skipAutoArchive: true }) || { topicName, associatedNotes: [] };
          const currentNotes = Array.isArray(memory.associatedNotes) ? memory.associatedNotes : [];
          if (!currentNotes.some(x => (typeof x === 'string' ? x : x.path) === n.path)) {
            currentNotes.push({ id: n.id, title: n.title, path: n.path });
            await saveMajorTopicMemory(topicName, { ...memory, associatedNotes: currentNotes });
            toast(`${t('common.saved') || 'Note associated with'} "${topicName}"`);
            const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
            if (c) renderRegisterView(c);
          }
        }
      });
      listEl.appendChild(item);
    });
  };

  searchInput?.addEventListener('input', (e) => renderPicker(e.target.value));
  renderPicker('');
}

async function deassociateNoteFromWorkstream(topicName, notePathOrId) {
  if (!topicName || typeof getMajorTopicMemory !== 'function') return;
  const memory = await getMajorTopicMemory(topicName, { skipAutoArchive: true });
  if (memory) {
    const updatedAssoc = (memory.associatedNotes || []).filter(n => {
      const p = typeof n === 'string' ? n : (n.path || n.id);
      return p !== notePathOrId;
    });
    await saveMajorTopicMemory(topicName, { ...memory, associatedNotes: updatedAssoc });
    toast(t('common.saved') || 'Note de-associated from workstream!');
    const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
    if (c) renderRegisterView(c);
  }
}

async function deassociateDecisionFromWorkstream(topicName, decisionIdOrText) {
  let found = pendingDecisionsList.find(d => (d.id && d.id === decisionIdOrText) || d.text === decisionIdOrText);
  if (!found) found = decisionsList.find(d => (d.id && d.id === decisionIdOrText) || d.text === decisionIdOrText);
  if (found) {
    const originalMajors = found.major_topic_tags || [];
    const newMajors = originalMajors.filter(t => t !== topicName);
    found.major_topic_tags = newMajors;

    const notePaths = _decisionNotePaths(found);
    if (notePaths.length && typeof window.updateDecisionInFile === 'function') {
      for (const p of notePaths) {
        await window.updateDecisionInFile(p, found.text, {
          status: found.status || 'active',
          authority: found.authority || 'team',
          impact: found.impact || 'high',
          major: newMajors,
          rationale: found.rationale || found.context || '',
          newText: found.text
        });
      }
    }

    toast(t('common.saved') || 'Decision de-associated from workstream!');
    const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
    if (c) renderRegisterView(c);
  }
}

async function deassociateTaskFromWorkstream(topicName, taskIdOrTitle) {
  const rawTodos = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest))
    ? todosManifest
    : (typeof todosList !== 'undefined' && Array.isArray(todosList) ? todosList : []);
  const task = rawTodos.find(t => t && (t.id === taskIdOrTitle || t.title === taskIdOrTitle));
  if (task) {
    task.major_topic_tags = (task.major_topic_tags || []).filter(t => t !== topicName);
    task.topic_tags = (task.topic_tags || []).filter(t => t !== topicName);
    if (typeof saveTodos === 'function') {
      saveTodos();
    }
    toast(t('common.saved') || 'Task de-associated from workstream!');
    const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
    if (c) renderRegisterView(c);
  }
}

function doesItemMatchWorkstream(item, topicName, memory) {
  if (!topicName || topicName === REGISTRY_ALL_PROJECTS_KEY) return true;
  if (topicName === REGISTRY_OTHER_PROJECTS_KEY) return false;

  // 1. Check if explicitly in memory.associatedNotes (for notes)
  const assocList = Array.isArray(memory?.associatedNotes) ? memory.associatedNotes : [];
  const isManuallyAssoc = assocList.some(an => {
    if (!an) return false;
    const p = typeof an === 'string' ? an : (an.path || an.id);
    return p && (p === item?.path || p === item?.id || (item?.title && (an.title === item?.title || p === item?.title)));
  });
  if (isManuallyAssoc) return true;

  const mapped = memory?.mappedTags || {};
  const tagGroups = Array.isArray(mapped.tagGroups) ? mapped.tagGroups : [];

  const itemMajors = (item?.major_topic_tags || []).map(t => String(t || '').trim().toLowerCase());
  const itemGroups = (item?.group_tags || []).map(t => String(t || '').trim().toLowerCase());
  const itemTopics = (item?.topic_tags || []).map(t => String(t || '').trim().toLowerCase());

  const topicLower = topicName.toLowerCase();
  if (itemMajors.includes(topicLower)) return true;
  if (item?.workstream && String(item.workstream).toLowerCase().split(',').map(s => s.trim()).includes(topicLower)) return true;
  if (Array.isArray(item?.workstreams) && item.workstreams.some(w => String(w || '').trim().toLowerCase() === topicLower)) return true;

  if (typeof matchTagsToWorkstreamSelectionGroups === 'function') {
    const matchRes = matchTagsToWorkstreamSelectionGroups(item, tagGroups);
    if (matchRes.matched) return true;
  } else if (tagGroups.length > 0) {
    const hasMatch = tagGroups.some(tg => {
      if (!tg) return false;
      const g = String(tg.group || '').trim().toLowerCase();
      const m = String(tg.major || '').trim().toLowerCase();
      const t = String(tg.topic || '').trim().toLowerCase();
      if (!g && !m && !t) return false;
      const matchG = !g || g === '*' || itemGroups.includes(g);
      const matchM = !m || m === '*' || itemMajors.includes(m);
      const matchT = !t || t === '*' || itemTopics.includes(t);
      return matchG && matchM && matchT;
    });
    if (hasMatch) return true;
  }

  const groupTags = (mapped.group_tags || []).map(t => String(t || '').trim().toLowerCase());
  const majorTags = (mapped.major_topic_tags || []).map(t => String(t || '').trim().toLowerCase());
  const topicTags = (mapped.topic_tags || []).map(t => String(t || '').trim().toLowerCase());

  if (majorTags.includes('*') || groupTags.includes('*') || topicTags.includes('*')) return true;
  if (majorTags.some(m => itemMajors.includes(m))) return true;
  if (groupTags.some(g => itemGroups.includes(g))) return true;
  if (topicTags.some(t => itemTopics.includes(t))) return true;

  return false;
}
window.doesItemMatchWorkstream = doesItemMatchWorkstream;

function renderRegisterView(container) {
  let prevScrollTop = 0;
  const existingUnified = container?.querySelector?.('.decision-toolbar-unified') || document.querySelector('.decision-toolbar-unified');
  if (existingUnified) {
    prevScrollTop = existingUnified.scrollTop;
  }

  container.innerHTML = '';
  container.style.cssText = 'display:flex; flex-direction:column; gap:0; width:100%; height:100%; min-height:0; overflow:hidden;';
  
  refreshDecisionListFromMetadataIfAvailable();
  const decisionSource = [...pendingDecisionsList, ...decisionsList];
  const uncategorizedProjectLabel = t('team.uncategorizedDecisions') || 'Uncategorized';

  const registeredWorkstreams = new Set();
  if (typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache && Array.isArray(_topicMemoriesIndexCache.topics)) {
    _topicMemoriesIndexCache.topics.forEach(tm => {
      if (tm && tm.status !== 'archived') {
        const name = tm.topicName || tm.key;
        if (name) registeredWorkstreams.add(name);
      }
    });
  } else if (typeof localStorage !== 'undefined') {
    try {
      const cached = localStorage.getItem('secretary_topic_memories_index_v1');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.topics && Array.isArray(parsed.topics)) {
          parsed.topics.forEach(tm => {
            if (tm && tm.status !== 'archived') {
              const name = tm.topicName || tm.key;
              if (name) registeredWorkstreams.add(name);
            }
          });
        }
      }
    } catch (_) {}
  }

  if (typeof WorkstreamMemoryEngine !== 'undefined' && typeof WorkstreamMemoryEngine.getTopicMemoriesCatalog === 'function' && (!registeredWorkstreams.size)) {
    WorkstreamMemoryEngine.getTopicMemoriesCatalog().then(() => {
      const containerEl = document.getElementById('team-panel');
      if (containerEl && containerEl.style.display !== 'none' && activeCollabView === 'registry') {
        renderRegisterView(containerEl);
      }
    }).catch(() => {});
  }

  const decisionsByMajor = new Map();
  decisionsByMajor.set(uncategorizedProjectLabel, []);
  registeredWorkstreams.forEach(name => decisionsByMajor.set(name, []));

  for (const dec of decisionSource) {
    const majors = (dec?.major_topic_tags || []).map(x => String(x || '').trim()).filter(Boolean);
    let matchedAny = false;
    for (const major of majors) {
      if (decisionsByMajor.has(major)) {
        decisionsByMajor.get(major).push(dec);
        matchedAny = true;
      }
    }
    for (const wsName of registeredWorkstreams) {
      if (!majors.includes(wsName) && typeof doesItemMatchWorkstream === 'function' && doesItemMatchWorkstream(dec, wsName)) {
        const list = decisionsByMajor.get(wsName);
        if (list && !list.includes(dec)) {
          list.push(dec);
          matchedAny = true;
        }
      }
    }
    if (!matchedAny) {
      decisionsByMajor.get(uncategorizedProjectLabel).push(dec);
    }
  }

  const allMajors = Array.from(registeredWorkstreams).sort((a, b) => {
    const idxA = workstreamCustomOrder.indexOf(a);
    const idxB = workstreamCustomOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    const isPinnedA = favoriteRegistryProjects.has(a) || (typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache?.topics?.find(t => t.topicName === a || t.key === a)?.pinned);
    const isPinnedB = favoriteRegistryProjects.has(b) || (typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache?.topics?.find(t => t.topicName === b || t.key === b)?.pinned);
    if (isPinnedA && !isPinnedB) return -1;
    if (!isPinnedA && isPinnedB) return 1;
    return a.localeCompare(b);
  });

  if (!selectedRegistryProject || (selectedRegistryProject !== REGISTRY_ALL_PROJECTS_KEY && selectedRegistryProject !== REGISTRY_OTHER_PROJECTS_KEY && !allMajors.includes(selectedRegistryProject))) {
    selectedRegistryProject = allMajors[0] || REGISTRY_OTHER_PROJECTS_KEY;
  }

  const decisionsPerMajor = new Map();
  for (const major of allMajors) {
    const count = (decisionsByMajor.get(major) || []).length;
    decisionsPerMajor.set(major, count);
  }
  const otherDecisionsCount = (decisionsByMajor.get(uncategorizedProjectLabel) || []).length;
  decisionsPerMajor.set(uncategorizedProjectLabel, otherDecisionsCount);

  // 1. Sleek Top Horizontal Workstream Tabs Strip (.workstream-tabs-strip)
  const tabsStrip = document.createElement('div');
  tabsStrip.className = 'workstream-tabs-strip';
  tabsStrip.setAttribute('role', 'tablist');

  // Default "Other" Tab - always fixed on the left
  const otherTabBtn = document.createElement('div');
  otherTabBtn.className = `workstream-tab workstream-tab-other${selectedRegistryProject === REGISTRY_OTHER_PROJECTS_KEY ? ' active' : ''}`;
  otherTabBtn.setAttribute('role', 'tab');
  otherTabBtn.setAttribute('aria-selected', selectedRegistryProject === REGISTRY_OTHER_PROJECTS_KEY ? 'true' : 'false');
  otherTabBtn.title = t('workstream.otherTabTooltip') || 'View non-categorized decisions, tasks, and remaining work';
  otherTabBtn.innerHTML = `<span class="workstream-tab-label">${escH(t('workstream.otherTab') || 'Other')}</span>`;
  otherTabBtn.addEventListener('click', () => {
    selectedRegistryProject = REGISTRY_OTHER_PROJECTS_KEY;
    renderRegisterView(container);
  });
  otherTabBtn.addEventListener('dragover', (ev) => {
    if (_draggedWorkstreamTab) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      otherTabBtn.classList.add('drag-over-right');
    }
  });
  otherTabBtn.addEventListener('dragleave', () => {
    otherTabBtn.classList.remove('drag-over-right');
  });
  otherTabBtn.addEventListener('drop', (ev) => {
    ev.preventDefault();
    otherTabBtn.classList.remove('drag-over-right');
    if (_draggedWorkstreamTab) {
      const order = [...allMajors];
      const fromIdx = order.indexOf(_draggedWorkstreamTab);
      if (fromIdx !== -1) order.splice(fromIdx, 1);
      order.unshift(_draggedWorkstreamTab);
      saveWorkstreamOrder(order);
      renderRegisterView(container);
    }
  });
  tabsStrip.appendChild(otherTabBtn);

  // Workstream Tabs (draggable and reorderable)
  allMajors.forEach(major => {
    const isMajorPinned = favoriteRegistryProjects.has(major) || (typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache?.topics?.find(t => t.topicName === major || t.key === major)?.pinned);
    const tabBtn = document.createElement('div');
    tabBtn.className = `workstream-tab${selectedRegistryProject === major ? ' active' : ''}${isMajorPinned ? ' pinned' : ''}`;
    tabBtn.setAttribute('role', 'tab');
    tabBtn.setAttribute('aria-selected', selectedRegistryProject === major ? 'true' : 'false');
    tabBtn.draggable = true;
    tabBtn.title = t('collab.filterByProjectTooltip', { value: major });
    tabBtn.innerHTML = `<span class="workstream-tab-label">${escH(major)}</span>`;
    tabBtn.addEventListener('click', () => {
      selectedRegistryProject = major;
      renderRegisterView(container);
    });

    tabBtn.addEventListener('dragstart', (ev) => {
      _draggedWorkstreamTab = major;
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', JSON.stringify({ type: 'workstream-tab-order', name: major }));
      tabBtn.classList.add('dragging');
    });

    tabBtn.addEventListener('dragend', () => {
      _draggedWorkstreamTab = null;
      document.querySelectorAll('.workstream-tab').forEach(el => {
        el.classList.remove('dragging', 'drag-over', 'drag-over-left', 'drag-over-right');
      });
    });

    tabBtn.addEventListener('dragover', (ev) => {
      if (!_draggedWorkstreamTab || _draggedWorkstreamTab === major) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      const rect = tabBtn.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (ev.clientX < midX) {
        tabBtn.classList.add('drag-over-left');
        tabBtn.classList.remove('drag-over-right');
      } else {
        tabBtn.classList.add('drag-over-right');
        tabBtn.classList.remove('drag-over-left');
      }
    });

    tabBtn.addEventListener('dragleave', () => {
      tabBtn.classList.remove('drag-over-left', 'drag-over-right');
    });

    tabBtn.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const wasDropRight = tabBtn.classList.contains('drag-over-right');
      tabBtn.classList.remove('drag-over-left', 'drag-over-right');
      if (!_draggedWorkstreamTab || _draggedWorkstreamTab === major) return;

      const order = [...allMajors];
      const fromIdx = order.indexOf(_draggedWorkstreamTab);
      if (fromIdx !== -1) {
        order.splice(fromIdx, 1);
      }
      let targetIdx = order.indexOf(major);
      if (targetIdx !== -1) {
        if (wasDropRight) targetIdx++;
        order.splice(targetIdx, 0, _draggedWorkstreamTab);
      } else {
        order.push(_draggedWorkstreamTab);
      }
      saveWorkstreamOrder(order);
      renderRegisterView(container);
    });

    tabsStrip.appendChild(tabBtn);
  });

  // Sleek "+ New" tab displayed right after the last workstream tab
  const addTabBtn = document.createElement('div');
  addTabBtn.className = 'workstream-tab workstream-tab-add';
  addTabBtn.setAttribute('role', 'tab');
  addTabBtn.title = t('workstream.createTooltip') || 'Create new workstream memory dossier';
  addTabBtn.innerHTML = `<span class="workstream-tab-label" style="font-weight:700; font-size:1.05rem; line-height:1; display:inline-flex; align-items:center; justify-content:center;">+</span>`;
  addTabBtn.addEventListener('click', () => openCreateWorkstreamModal());
  tabsStrip.appendChild(addTabBtn);

  tabsStrip.addEventListener('dragover', (ev) => {
    if (_draggedWorkstreamTab) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
    }
  });

  tabsStrip.addEventListener('drop', (ev) => {
    if (ev.target === tabsStrip && _draggedWorkstreamTab) {
      ev.preventDefault();
      const order = [...allMajors];
      const fromIdx = order.indexOf(_draggedWorkstreamTab);
      if (fromIdx !== -1) order.splice(fromIdx, 1);
      order.push(_draggedWorkstreamTab);
      saveWorkstreamOrder(order);
      renderRegisterView(container);
    }
  });

  tabsStrip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) {
      const maxScrollLeft = tabsStrip.scrollWidth - tabsStrip.clientWidth;
      if (maxScrollLeft > 0) {
        tabsStrip.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }
  }, { passive: false });

  container.appendChild(tabsStrip);

  // 2. Main Container for Workstream Dossier Card + Sub-Tabs Content (Seamlessly connected to active tab)
  const unifiedContainer = document.createElement('div');
  unifiedContainer.className = 'decision-toolbar-unified';
  unifiedContainer.style.cssText = 'flex:1; display:flex; flex-direction:column; overflow-y:auto; overflow-x:hidden; background:var(--card-bg); border:1px solid var(--card-border); border-top:none; border-radius:0 0 10px 10px; padding:10px; gap:8px;';

  const restoreScrollPosition = () => {
    if (prevScrollTop > 0 && unifiedContainer) {
      unifiedContainer.scrollTop = prevScrollTop;
    }
  };

  // If Workstream is currently being created/synthesized in background, render pulsing loading card
  if (isWorkstreamLoading) {
    const loadingCard = document.createElement('div');
    loadingCard.style.cssText = 'padding: 2.5rem 1.5rem; border: 1px solid var(--accent); background: rgba(var(--accent-rgb), 0.08); border-radius: 12px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; margin: 16px auto; max-width: 480px; animation: decisionGlowPulse 1.5s infinite ease-in-out;';
    loadingCard.innerHTML = `
      <div class="ws-loading-spinner" aria-hidden="true"></div>
      <div style="font-weight: 700; font-size: 1.05rem; color: var(--accent); display:flex; align-items:center; gap:8px; justify-content:center;">${getWsIcon('bot', 20)} Secretary AI is synthesizing workstream "${escH(workstreamLoadingName)}"...</div>
      <div style="font-size: 0.85rem; color: var(--text-muted);">Scanning notes, extracting key facts, milestones, and decisions in the background.</div>
    `;
    unifiedContainer.appendChild(loadingCard);
    container.appendChild(unifiedContainer);
    return;
  }

  // Dedicated Top Slot for Workstream Header Panel (guarantees it stays at the TOP above sub-tabs)
  const headerSlot = document.createElement('div');
  headerSlot.className = 'workstream-header-slot';
  unifiedContainer.appendChild(headerSlot);

  // Read current active workstream memory synchronously from in-memory cache or index cache
  let currentWsMemory = (typeof getMajorTopicMemorySync === 'function') ? getMajorTopicMemorySync(selectedRegistryProject) : null;
  if (!currentWsMemory && typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache?.topics) {
    currentWsMemory = _topicMemoriesIndexCache.topics.find(t => t.topicName === selectedRegistryProject || t.key === selectedRegistryProject);
  }

  const isOther = selectedRegistryProject === REGISTRY_OTHER_PROJECTS_KEY;
  if (selectedRegistryProject && selectedRegistryProject !== REGISTRY_ALL_PROJECTS_KEY && !isOther) {
    renderWorkstreamHeader(selectedRegistryProject, headerSlot, currentWsMemory).then(mem => {
      if (mem) currentWsMemory = mem;
      restoreScrollPosition();
    }).catch(() => {});
  }

  // If viewing "Other" and active tab is "overview", default to "decisions"
  if (isOther && activeWorkstreamSubTab === 'overview') {
    activeWorkstreamSubTab = 'decisions';
  }

  // Gather Workstream Sub-Tab items
  let projectDecisions = [];
  if (selectedRegistryProject === REGISTRY_OTHER_PROJECTS_KEY) {
    projectDecisions = decisionsByMajor.get(uncategorizedProjectLabel) || [];
  } else if (selectedRegistryProject === REGISTRY_ALL_PROJECTS_KEY) {
    projectDecisions = decisionSource;
  } else {
    projectDecisions = decisionSource.filter(d => doesItemMatchWorkstream(d, selectedRegistryProject, currentWsMemory));
    if (projectDecisions.length === 0) {
      projectDecisions = decisionsByMajor.get(selectedRegistryProject) || [];
    }
  }

  let projectNotes = [];
  const allNotesList = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : ((typeof notesManifest !== 'undefined' && Array.isArray(notesManifest)) ? notesManifest : []);
  if (selectedRegistryProject === REGISTRY_OTHER_PROJECTS_KEY) {
    projectNotes = allNotesList.filter(n => !(n.major_topic_tags || []).some(t => allMajors.includes(t)));
  } else {
    projectNotes = allNotesList.filter(n => doesItemMatchWorkstream(n, selectedRegistryProject, currentWsMemory));
  }

  let projectTasks = [];
  const allTasksList = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) ? todosManifest : ((typeof todosList !== 'undefined' && Array.isArray(todosList)) ? todosList : []);
  if (selectedRegistryProject === REGISTRY_OTHER_PROJECTS_KEY) {
    projectTasks = allTasksList.filter(t => !(t.major_topic_tags || []).some(tag => allMajors.includes(tag)));
  } else {
    projectTasks = allTasksList.filter(t => doesItemMatchWorkstream(t, selectedRegistryProject, currentWsMemory));
  }

  // Sub-Tabs Bar (.workstream-subtabs-strip with sticky top positioned right below header)
  const subTabsStrip = document.createElement('div');
  subTabsStrip.className = 'workstream-subtabs-strip';
  subTabsStrip.style.cssText = 'position:sticky; top:-10px; z-index:10; background:var(--card-bg); margin:0 0 6px 0; padding:6px 0; border-bottom:1px solid var(--card-border);';

  let projectMeetingsData = { upcoming: [], past: [] };
  if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.getWorkstreamMeetings) {
    projectMeetingsData = WorkstreamMemoryEngine.getWorkstreamMeetings(selectedRegistryProject, { memory: currentWsMemory });
  }

  const toolbarBody = document.createElement('div');
  toolbarBody.className = 'decision-toolbar-body';
  toolbarBody.style.cssText = 'flex:1; min-height:540px; overflow:visible; padding:0.2rem 0;';

  // Helper to render Tasks Sub-tab view
  const renderTasksTabContent = () => {
    const tasksView = document.createElement('div');
    tasksView.className = 'workstream-tasks-view';
    tasksView.style.cssText = 'display:flex; flex-direction:column; gap:8px; width:100%; min-height:540px;';

    const tasksHeader = document.createElement('div');
    tasksHeader.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;';
    tasksHeader.innerHTML = `
      <div style="font-weight:700; font-size:0.9rem; color:var(--text); display:flex; align-items:center; gap:6px;">${getWsIcon('checkSquare', 16)} ${escH(t('workstream.subtabTasks') || 'Tasks')} (${projectTasks.length})</div>
    `;
    tasksView.appendChild(tasksHeader);

    if (projectTasks.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--text-muted); font-style:italic; font-size:0.85rem; padding:3rem 1rem; text-align:center; background:rgba(255,255,255,0.02); border-radius:8px; border:1px dashed var(--card-border); min-height:460px; display:flex; align-items:center; justify-content:center;';
      empty.textContent = t('workstream.noTasks') || 'No tasks associated with this workstream.';
      tasksView.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.style.cssText = 'display:flex; flex-direction:column; gap:6px;';

      projectTasks.forEach(tItem => {
        const item = document.createElement('div');
        item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--card-bg); border:1px solid var(--card-border); border-radius:8px; font-size:0.85rem; gap:10px; transition:background 0.15s ease;';
        const isComp = !!tItem.completed;
        const chkTooltip = isComp ? (t('tasks.markIncomplete') || 'Mark task as incomplete') : (t('tasks.markComplete') || 'Mark task as completed');
        item.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
            <input type="checkbox" ${isComp ? 'checked' : ''} class="workstream-task-checkbox" style="cursor:pointer;" title="${escA(chkTooltip)}">
            <span class="workstream-task-title" style="font-weight:600; color:var(--text); ${isComp ? 'text-decoration:line-through; opacity:0.7;' : ''}">${escH(tItem.title || tItem.text || 'Task')}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
            <span style="font-size:0.72rem; color:var(--text-muted);">${escH(tItem.dueDate || '')}</span>
            <button type="button" class="btn-icon btn-deassoc-task" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.85rem; padding:2px;" title="${escA(t('workstream.deassociateTooltip') || 'De-associate item from this workstream')}">✕</button>
          </div>
        `;

        const chk = item.querySelector('.workstream-task-checkbox');
        const titleSpan = item.querySelector('.workstream-task-title');
        chk?.addEventListener('change', () => {
          tItem.completed = chk.checked;
          if (titleSpan) {
            titleSpan.style.textDecoration = tItem.completed ? 'line-through' : 'none';
            titleSpan.style.opacity = tItem.completed ? '0.7' : '1';
          }
          chk.title = tItem.completed ? (t('tasks.markIncomplete') || 'Mark task as incomplete') : (t('tasks.markComplete') || 'Mark task as completed');
          if (typeof saveTodos === 'function') {
            saveTodos();
          }
        });

        item.querySelector('.btn-deassoc-task')?.addEventListener('click', () => {
          deassociateTaskFromWorkstream(selectedRegistryProject, tItem.id || tItem.title);
        });
        list.appendChild(item);
      });
      tasksView.appendChild(list);
    }
    toolbarBody.appendChild(tasksView);
  };

  // Helper to render Notes Sub-tab view
  const renderNotesTabContent = () => {
    const notesView = document.createElement('div');
    notesView.className = 'workstream-notes-view';
    notesView.style.cssText = 'display:flex; flex-direction:column; gap:10px; width:100%; min-height:540px;';

    const manualAssocList = Array.isArray(currentWsMemory?.associatedNotes) ? currentWsMemory.associatedNotes : [];
    const hasManualNotes = manualAssocList.length > 0;

    const notesHeader = document.createElement('div');
    notesHeader.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; flex-wrap:wrap; gap:6px;';
    notesHeader.innerHTML = `
      <div style="font-weight:700; font-size:0.9rem; color:var(--text); display:flex; align-items:center; gap:6px;">${getWsIcon('fileText', 16)} ${escH(t('workstream.subtabNotes') || 'Notes')} (${projectNotes.length})</div>
      <div style="display:flex; align-items:center; gap:6px;">
        ${hasManualNotes ? `
          <button type="button" class="btn btn-secondary" id="btn-clear-manual-notes" style="font-size:0.75rem; padding:3px 8px; color:var(--text-muted);" title="${escA(t('workstream.clearManualNotesTooltip') || 'Remove all manually associated notes to show only notes matching the tags')}">
            ${getWsIcon('broom', 13)} ${escH(t('workstream.clearManualNotes') || 'Clear Manual Notes')}
          </button>
        ` : ''}
        <button type="button" class="btn btn-secondary" id="btn-associate-note" style="font-size:0.75rem; padding:3px 10px; font-weight:600;" title="${escA(t('workstream.associateNote') || '+ Associate Note')}">
          ${escH(t('workstream.associateNote') || '+ Associate Note')}
        </button>
      </div>
    `;
    notesView.appendChild(notesHeader);

    notesHeader.querySelector('#btn-associate-note')?.addEventListener('click', () => openAssociateNoteModal(selectedRegistryProject));

    notesHeader.querySelector('#btn-clear-manual-notes')?.addEventListener('click', async () => {
      if (typeof getMajorTopicMemory === 'function' && typeof saveMajorTopicMemory === 'function') {
        const mem = await getMajorTopicMemory(selectedRegistryProject, { skipAutoArchive: true });
        if (mem) {
          await saveMajorTopicMemory(selectedRegistryProject, { ...mem, associatedNotes: [] });
          toast(`${t('workstream.manualNotesClearedToast') || 'Manual note associations cleared!'}`);
          const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
          if (c) renderRegisterView(c);
        }
      }
    });

    if (projectNotes.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--text-muted); font-style:italic; font-size:0.85rem; padding:3rem 1rem; text-align:center; background:rgba(255,255,255,0.02); border-radius:8px; border:1px dashed var(--card-border); min-height:460px; display:flex; align-items:center; justify-content:center;';
      empty.textContent = t('workstream.noNotes') || 'No associated notes found for this workstream.';
      notesView.appendChild(empty);
    } else {
      // 1. Sort notes chronologically by date (newest first)
      const sortedNotes = [...projectNotes].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      // 2. Group notes by ISO week
      const today = typeof getTodayDateString === 'function' ? getTodayDateString() : new Date().toISOString().slice(0, 10);
      const currentWeekKey = typeof getNoteWeekKey === 'function' ? getNoteWeekKey(today).key : '';
      const lastWeekDate = new Date();
      lastWeekDate.setDate(lastWeekDate.getDate() - 7);
      const lastWeekStr = lastWeekDate.toISOString().slice(0, 10);
      const lastWeekKey = typeof getNoteWeekKey === 'function' ? getNoteWeekKey(lastWeekStr).key : '';

      const weekGroups = new Map();
      sortedNotes.forEach(n => {
        const weekInfo = (typeof getNoteWeekKey === 'function') ? getNoteWeekKey(n.date) : { key: 'unknown', label: n.date || 'Other' };
        const wKey = weekInfo.key || 'unknown';
        if (!weekGroups.has(wKey)) {
          const label = (typeof getWeekLaneLabel === 'function') ? getWeekLaneLabel(wKey, currentWeekKey, lastWeekKey) : (weekInfo.label || wKey);
          weekGroups.set(wKey, { key: wKey, label, notes: [] });
        }
        weekGroups.get(wKey).notes.push(n);
      });

      // 3. Render each week section
      weekGroups.forEach(wg => {
        const section = document.createElement('div');
        section.className = 'workstream-week-section';

        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'workstream-week-header';
        sectionHeader.innerHTML = `
          <div class="workstream-week-title">
            <span>${getWsIcon('calendar', 14)}</span> <span>${escH(wg.label)}</span>
          </div>
          <span class="workstream-week-badge">${wg.notes.length}</span>
          <div class="workstream-week-divider"></div>
        `;
        section.appendChild(sectionHeader);

        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px; width:100%;';

        wg.notes.forEach(n => {
          const card = document.createElement('div');
          card.className = 'workstream-note-card';
          card.setAttribute('role', 'article');
          card.setAttribute('tabindex', '0');
          card.title = t('workstream.doubleClickToOpenNote') || 'Double-click to open note';

          let summaryHtml = '';
          if (n.summary) {
            summaryHtml = n.summary;
          } else if (typeof cachedPreviews !== 'undefined' && cachedPreviews[n.path]) {
            const raw = cachedPreviews[n.path];
            summaryHtml = (typeof marked !== 'undefined' && typeof marked.parse === 'function') ? marked.parse(raw) : escH(raw);
          }

          const groupTag = n.group_tags?.[0] || '';
          const majorTag = n.major_topic_tags?.[0] || '';
          const topicTag = n.topic_tags?.[0] || '';

          const isManuallyAssoc = manualAssocList.some(an => {
            if (!an) return false;
            const p = typeof an === 'string' ? an : (an.path || an.id);
            return p && (p === n.path || p === n.id || (n.title && (an.title === n.title || p === n.title)));
          });

          card.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:6px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <span style="font-weight:700; font-size:0.92rem; color:var(--text); line-height:1.3; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${getWsIcon('fileText', 14)} ${escH(n.title || 'Untitled Note')}</span>
                <button type="button" class="btn-icon btn-deassoc-note" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.9rem; padding:2px; flex-shrink:0; line-height:1;" title="${escA(t('workstream.deassociateTooltip') || 'De-associate item from this workstream')}">✕</button>
              </div>
              <div style="font-size:0.73rem; color:var(--text-muted);">${escH(n.date || '')}</div>
            </div>

            ${summaryHtml ? `
              <div class="workstream-note-summary">
                ${summaryHtml}
              </div>
            ` : ''}

            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap; margin-top:4px;">
              <div style="display:flex; gap:4px; flex-wrap:wrap; align-items:center;">
                ${isManuallyAssoc ? `
                  <span class="manual-assoc-badge btn-clear-single-manual" title="${escA(t('workstream.manualAssocBadgeTooltip') || 'Manually associated note. Click to remove manual association.')}">
                    <span>${getWsIcon('pin', 11)} ${escH(t('workstream.manualLabel') || 'Manual')}</span>
                    <span style="font-size:0.75rem; opacity:0.8; line-height:1;">✕</span>
                  </span>
                ` : ''}
                ${groupTag ? `<span class="tag-pill group-tag" style="font-size:0.68rem; padding:1px 6px;">${getWsIcon('users', 11)} ${escH(groupTag)}</span>` : ''}
                ${majorTag ? `<span class="tag-pill major-tag" style="font-size:0.68rem; padding:1px 6px;">${getWsIcon('brain', 11)} ${escH(majorTag)}</span>` : ''}
                ${topicTag ? `<span class="tag-pill topic-tag" style="font-size:0.68rem; padding:1px 6px;">${getWsIcon('tag', 11)} ${escH(topicTag)}</span>` : ''}
              </div>
            </div>
          `;

          card.addEventListener('dblclick', (e) => {
            if (e.target.closest('.btn-deassoc-note') || e.target.closest('.btn-clear-single-manual')) return;
            if (n.path) openDecisionNoteOverlay(n.path);
          });

          card.querySelector('.btn-clear-single-manual')?.addEventListener('click', (e) => {
            e.stopPropagation();
            deassociateNoteFromWorkstream(selectedRegistryProject, n.path || n.id || n.title);
          });

          card.querySelector('.btn-deassoc-note')?.addEventListener('click', (e) => {
            e.stopPropagation();
            deassociateNoteFromWorkstream(selectedRegistryProject, n.path || n.id);
          });

          grid.appendChild(card);
        });

        section.appendChild(grid);
        notesView.appendChild(section);
      });
    }
    toolbarBody.appendChild(notesView);
  };

  // Helper to render Decisions Sub-tab view
  const renderDecisionsTabContent = () => {
    const toolbarHeader = document.createElement('div');
    toolbarHeader.className = 'decision-toolbar-header';
    toolbarHeader.style.cssText = 'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.6rem; padding:0.4rem 0.6rem; border-bottom:1px solid var(--card-border); margin-bottom:8px;';

    // Left group: Search Input
    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'topbar-search decision-search-input';
    searchInput.placeholder = t('team.searchDecisionsPlaceholder') || 'Search decisions...';
    searchInput.title = t('team.searchDecisionsTitle') || 'Filter decisions';
    searchInput.value = registrySearchQuery;
    searchInput.style.cssText = 'min-width:160px; max-width:220px; padding:0.28rem 0.6rem; font-size:0.8rem; border-radius:6px;';
    searchInput.addEventListener('input', (e) => {
      registrySearchQuery = e.target.value;
      renderSubTabContent('decisions');
    });
    leftGroup.appendChild(searchInput);
    toolbarHeader.appendChild(leftGroup);

    // Center group: Status Filter & Manager Toggle
    const centerGroup = document.createElement('div');
    centerGroup.style.cssText = 'display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;';

    const statusPills = document.createElement('div');
    statusPills.className = 'axis-pills decision-filter-pills';
    statusPills.style.cssText = 'display:inline-flex; gap:2px; background:rgba(0,0,0,0.15); padding:2px; border-radius:6px;';

    const createStatusPill = (key, labelDefault, tooltip = '') => {
      const btn = document.createElement('button');
      btn.className = `axis-pill${registryStatusFilter === key ? ' active' : ''}`;
      btn.style.cssText = 'padding:2px 8px; font-size:0.75rem; border-radius:4px; border:none; cursor:pointer; display:inline-flex; align-items:center; gap:4px;';
      btn.innerHTML = labelDefault;
      if (tooltip) btn.title = tooltip;
      btn.addEventListener('click', () => {
        registryStatusFilter = key;
        renderSubTabContent('decisions');
      });
      return btn;
    };

    statusPills.appendChild(createStatusPill('all', escH(t('team.filterAll') || 'Toutes'), t('team.filterAllTooltip') || 'Show all decisions'));
    statusPills.appendChild(createStatusPill('active', escH(t('team.filterActive') || 'Actives'), t('team.filterActiveTooltip') || 'Show active decisions only'));
    statusPills.appendChild(createStatusPill('proposed', `${getWsIcon('clock', 12)} <span>${escH(t('team.filterProposed') || 'Proposées')}</span>`, t('team.filterProposedTooltip') || 'Show proposed decisions only'));
    statusPills.appendChild(createStatusPill('superseded', escH(t('team.filterSuperseded') || 'Remplacées'), t('team.filterSupersededTooltip') || 'Show superseded decisions only'));
    centerGroup.appendChild(statusPills);

    const mgrToggleBtn = document.createElement('button');
    mgrToggleBtn.className = `axis-pill${registryAuthorityFilter === 'manager' ? ' active' : ''}`;
    mgrToggleBtn.style.cssText = 'padding:2px 8px; font-size:0.75rem; border-radius:4px; border:none; cursor:pointer;';
    mgrToggleBtn.innerHTML = `${getWsIcon('briefcase', 12)} ${t('team.filterManager') || 'Manager'}`;
    mgrToggleBtn.title = t('team.filterManagerTooltip') || 'Filter management decisions';
    mgrToggleBtn.addEventListener('click', () => {
      registryAuthorityFilter = registryAuthorityFilter === 'manager' ? 'all' : 'manager';
      renderSubTabContent('decisions');
    });
    centerGroup.appendChild(mgrToggleBtn);
    toolbarHeader.appendChild(centerGroup);

    // Right group: View Switcher & Actions
    const rightGroup = document.createElement('div');
    rightGroup.style.cssText = 'display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;';

    const viewSwitcher = document.createElement('div');
    viewSwitcher.className = 'decision-view-switcher';
    viewSwitcher.style.cssText = 'display:inline-flex; gap:2px; background:rgba(0,0,0,0.15); padding:2px; border-radius:6px;';

    const createViewBtn = (modeKey, icon, labelDefault) => {
      const btn = document.createElement('button');
      btn.className = `decision-view-btn${registryViewMode === modeKey ? ' active' : ''}`;
      btn.style.cssText = 'padding:3px 8px; font-size:0.75rem; font-weight:600; border-radius:4px; cursor:pointer; border:none; background:transparent; color:var(--text-muted); transition:all 0.15s ease;';
      if (registryViewMode === modeKey) {
        btn.style.background = 'var(--accent)';
        btn.style.color = 'var(--text-on-accent)';
      }
      btn.innerHTML = `<span>${icon}</span> <span>${escH(labelDefault)}</span>`;
      btn.title = t('collab.switchViewTooltip', { value: labelDefault });
      btn.addEventListener('click', () => {
        registryViewMode = modeKey;
        renderSubTabContent('decisions');
      });
      return btn;
    };

    viewSwitcher.appendChild(createViewBtn('cards', getWsIcon('cards', 13), t('team.viewCards') || 'Cartes'));
    viewSwitcher.appendChild(createViewBtn('compact', getWsIcon('compact', 13), t('team.viewCompact') || 'Compact'));
    viewSwitcher.appendChild(createViewBtn('timeline', getWsIcon('timeline', 13), t('team.viewTimeline') || 'Frise'));
    viewSwitcher.appendChild(createViewBtn('kanban', getWsIcon('kanban', 13), t('team.viewKanban') || 'Kanban'));
    viewSwitcher.appendChild(createViewBtn('analytics', getWsIcon('analytics', 13), t('team.viewAnalytics') || 'Analytics'));
    rightGroup.appendChild(viewSwitcher);

    const newProposedBtn = document.createElement('button');
    newProposedBtn.className = 'decision-toolbar-btn-primary';
    newProposedBtn.style.cssText = 'padding:0.28rem 0.65rem; font-size:0.75rem; font-weight:600; border-radius:6px; cursor:pointer;';
    newProposedBtn.innerHTML = `<span>${getWsIcon('plus', 13)}</span> <span>${escH(t('team.proposeDecisionBtn') || 'Décision')}</span>`;
    newProposedBtn.title = t('team.proposeDecisionTooltip') || 'Ajouter une décision à prendre';
    newProposedBtn.addEventListener('click', () => openNewProposedDecisionDialog());
    rightGroup.appendChild(newProposedBtn);

    toolbarHeader.appendChild(rightGroup);
    toolbarBody.appendChild(toolbarHeader);

    const filterDecisions = (decs) => {
      return decs.filter(d => {
        if (registryStatusFilter === 'active' && d.status !== 'active') return false;
        if (registryStatusFilter === 'proposed' && d.status !== 'proposed') return false;
        if (registryStatusFilter === 'superseded' && d.status !== 'superseded') return false;
        if (registryAuthorityFilter === 'manager' && d.authority !== 'manager') return false;
        if (registryImpactFilter && registryImpactFilter !== 'all' && d.impact !== registryImpactFilter) return false;
        if (registrySearchQuery.trim()) {
          const q = registrySearchQuery.trim().toLowerCase();
          const textMatch = (d.text || '').toLowerCase().includes(q);
          const dateMatch = (d.date || '').toLowerCase().includes(q);
          const noteMatch = (d.takenNotes || []).some(n => (n.noteTitle || '').toLowerCase().includes(q));
          if (!textMatch && !dateMatch && !noteMatch) return false;
        }
        return true;
      });
    };

    const buildGroupedDecisions = (projectDecs) => {
      const groupedProjectDecs = [];
      const groupedByDecisionKey = new Map();
      for (const decision of projectDecs) {
        const key = `${decision.status || 'active'}::${(decision.text || '').trim().toLowerCase()}`;
        if (!groupedByDecisionKey.has(key)) {
          groupedByDecisionKey.set(key, {
            id: decision.id || key,
            status: decision.status || 'active',
            text: decision.text || '',
            authority: decision.authority || (decision.text.toLowerCase().includes('manager') ? 'manager' : 'team'),
            impact: decision.impact || 'high',
            taken: [],
            linked: []
          });
        }
        const bucket = groupedByDecisionKey.get(key);
        if (decision.isLinked) bucket.linked.push(decision);
        else bucket.taken.push(decision);
      }

      for (const bucket of groupedByDecisionKey.values()) {
        bucket.taken.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        bucket.linked.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        if (bucket.linked.length > 0 && bucket.taken.length > 0) {
          const canonical = bucket.taken[0];
          groupedProjectDecs.push({
            ...canonical,
            id: bucket.id,
            status: bucket.status,
            text: bucket.text,
            authority: bucket.authority,
            impact: bucket.impact,
            linkedNotes: bucket.linked,
            takenNotes: bucket.taken
          });
          continue;
        }
        if (bucket.taken.length > 0) {
          bucket.taken.forEach(item => groupedProjectDecs.push({ ...item, id: bucket.id, authority: bucket.authority, impact: bucket.impact, linkedNotes: [], takenNotes: [item] }));
          continue;
        }
        bucket.linked.forEach(item => groupedProjectDecs.push({ ...item, id: bucket.id, authority: bucket.authority, impact: bucket.impact, linkedNotes: [], takenNotes: [] }));
      }

      groupedProjectDecs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return filterDecisions(groupedProjectDecs);
    };

    const groupedDecisions = buildGroupedDecisions(projectDecisions);

    if (registryViewMode === 'analytics') {
      renderDecisionAnalyticsView(toolbarBody, projectDecisions);
    } else if (registryViewMode === 'kanban') {
      renderDecisionKanbanView(toolbarBody, groupedDecisions);
    } else if (registryViewMode === 'timeline') {
      renderDecisionTimelineView(toolbarBody, groupedDecisions);
    } else if (registryViewMode === 'compact') {
      renderDecisionCompactView(toolbarBody, groupedDecisions);
    } else {
      renderDecisionCardsList(toolbarBody, groupedDecisions);
    }
  };

  const renderSubTabContent = (tabKey) => {
    toolbarBody.innerHTML = '';
    if (!isOther && tabKey === 'overview') {
      renderWorkstreamOverviewTab(selectedRegistryProject, toolbarBody, currentWsMemory);
    } else if (tabKey === 'chat') {
      renderWorkstreamChatTab(selectedRegistryProject, toolbarBody, currentWsMemory);
    } else if (tabKey === 'meetings') {
      renderWorkstreamMeetingsTab(selectedRegistryProject, toolbarBody, currentWsMemory, projectMeetingsData);
    } else if (tabKey === 'tasks') {
      renderTasksTabContent();
    } else if (tabKey === 'notes') {
      renderNotesTabContent();
    } else {
      renderDecisionsTabContent();
    }
  };

  const switchWorkstreamSubTab = (tabKey) => {
    activeWorkstreamSubTab = tabKey;
    subTabsStrip.querySelectorAll('.workstream-subtab-btn').forEach(btn => {
      const k = btn.getAttribute('data-tab-key');
      const isActive = k === tabKey;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    renderSubTabContent(tabKey);
    if (tabKey === 'chat') {
      setTimeout(() => {
        subTabsStrip.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const chatInput = container.querySelector('#ws-chat-input');
        if (chatInput) chatInput.focus();
      }, 40);
    }
  };

  const createSubTabBtn = (tabKey, icon, labelText, count, tooltip = '') => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `workstream-subtab-btn${activeWorkstreamSubTab === tabKey ? ' active' : ''}`;
    btn.setAttribute('data-tab-key', tabKey);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', activeWorkstreamSubTab === tabKey ? 'true' : 'false');
    if (tooltip) btn.title = tooltip;
    const countBadge = (count !== '' && count !== undefined && count !== null) ? `<span style="font-size:0.72rem; opacity:0.85; background:rgba(0,0,0,0.2); padding:1px 6px; border-radius:8px;">${count}</span>` : '';
    btn.innerHTML = `<span>${icon}</span> <span>${escH(labelText)}</span> ${countBadge}`;
    btn.addEventListener('click', () => {
      if (activeWorkstreamSubTab === tabKey) return;
      switchWorkstreamSubTab(tabKey);
    });
    return btn;
  };

  if (!isOther) {
    subTabsStrip.appendChild(createSubTabBtn('overview', getWsIcon('fileText', 14), t('workstream.subtabOverview') || 'Dossier', '', t('workstream.subtabOverviewTooltip') || 'View workstream executive summary and context'));
  }
  subTabsStrip.appendChild(createSubTabBtn('decisions', getWsIcon('decision', 14), t('workstream.subtabDecisions') || 'Decisions', projectDecisions.length, t('workstream.subtabDecisionsTooltip') || 'View decisions for this workstream'));
  subTabsStrip.appendChild(createSubTabBtn('tasks', getWsIcon('checkSquare', 14), t('workstream.subtabTasks') || 'Tasks', projectTasks.length, t('workstream.subtabTasksTooltip') || 'View tasks for this workstream'));
  subTabsStrip.appendChild(createSubTabBtn('notes', getWsIcon('fileText', 14), t('workstream.subtabNotes') || 'Notes', projectNotes.length, t('workstream.subtabNotesTooltip') || 'View notes for this workstream'));
  subTabsStrip.appendChild(createSubTabBtn('meetings', getWsIcon('calendar', 14), t('workstream.subtabMeetings') || 'Meetings', projectMeetingsData.upcoming.length, t('workstream.subtabMeetingsTooltip') || 'View meetings for this workstream'));
  subTabsStrip.appendChild(createSubTabBtn('chat', getWsIcon('bot', 14), t('workstream.subtabCopilot') || 'Copilote IA', '', t('workstream.subtabCopilotTooltip') || 'Open AI Copilot for this workstream'));

  unifiedContainer.appendChild(subTabsStrip);

  // Initial render of the active subtab content
  renderSubTabContent(activeWorkstreamSubTab);

  unifiedContainer.appendChild(toolbarBody);
  container.appendChild(unifiedContainer);

  restoreScrollPosition();
  requestAnimationFrame(restoreScrollPosition);
  setTimeout(restoreScrollPosition, 60);
}

function renderDecisionCardsList(target, groupedProjectDecs) {
  if (groupedProjectDecs.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:var(--text-muted); font-style:italic; font-size:0.9rem; padding:3rem 1rem; text-align:center; background:rgba(255,255,255,0.02); border-radius:8px; border:1px dashed var(--card-border); min-height:460px; display:flex; align-items:center; justify-content:center;';
    empty.textContent = t('team.noDecisionsProject') || 'Aucune décision ne correspond aux critères.';
    target.appendChild(empty);
    return;
  }

  const cascade = document.createElement('div');
  cascade.style.cssText = 'display:flex; flex-direction:column; gap:0.9rem; min-height:460px;';

  groupedProjectDecs.forEach(d => {
    const card = document.createElement('div');
    card.className = `collab-item-card decision-card-modern${d.status === 'proposed' ? ' decision-card-proposed' : ''}`;
    card.setAttribute('role', 'article');
    card.setAttribute('tabindex', '0');
    
    let borderStyle = 'border-left: 4px solid #10b981; background:var(--card-bg);';
    if (d.status === 'proposed') borderStyle = 'border-left: 4px solid #f59e0b; background:color-mix(in srgb, #f59e0b 8%, var(--card-bg));';
    else if (d.status === 'superseded') borderStyle = 'opacity:0.75; border-left: 4px solid var(--text-muted); background:var(--card-bg-alt);';

    card.style.cssText = `border-radius:12px; padding:1rem 1.1rem; transition:all 0.2s cubic-bezier(0.16,1,0.3,1); position:relative; ${borderStyle}`;

    card.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openEditDecisionModal(d);
    });

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:0.5rem; flex-wrap:wrap;';

    const badgeGroup = document.createElement('div');
    badgeGroup.style.cssText = 'display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;';

    const badgeSpan = document.createElement('span');
    badgeSpan.className = d.status === 'proposed' ? 'pill-decision pill-decision-proposed' : d.status === 'superseded' ? 'pill-decision pill-decision-superseded' : 'pill-decision pill-decision-active';
    badgeSpan.style.cssText = 'margin:0; font-size:0.75rem; font-weight:600; padding:2px 8px; border-radius:6px; display:inline-flex; align-items:center; gap:4px;';
    badgeSpan.innerHTML = d.status === 'proposed' ? `${getWsIcon('clock', 12)} ${t('team.statusProposed') || 'À prendre / Proposée'}` : d.status === 'superseded' ? `${getWsIcon('undo', 12)} ${t('team.statusSuperseded') || 'Remplacée'}` : `${getWsIcon('check', 12)} ${t('team.statusActive') || 'Active'}`;
    badgeGroup.appendChild(badgeSpan);

    if (d.authority === 'manager') {
      const mgrBadge = document.createElement('span');
      mgrBadge.className = 'pill-authority-manager';
      mgrBadge.style.cssText = 'font-size:0.75rem; font-weight:600; padding:2px 8px; border-radius:6px;';
      mgrBadge.innerHTML = `${getWsIcon('briefcase', 12)} ${t('team.managerBadge') || 'Manager'}`;
      mgrBadge.title = t('team.authorityManagerTooltip') || 'Décision validée par la direction / management';
      badgeGroup.appendChild(mgrBadge);
    }

    if (d.impact === 'high') {
      const impBadge = document.createElement('span');
      impBadge.className = 'pill-impact-high';
      impBadge.style.cssText = 'font-size:0.75rem; font-weight:600; padding:2px 8px; border-radius:6px;';
      impBadge.innerHTML = `<span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#ef4444;"></span> ${t('team.impactHigh') || 'Impact Élevé'}`;
      badgeGroup.appendChild(impBadge);
    }

    topRow.appendChild(badgeGroup);

    const rightHeader = document.createElement('div');
    rightHeader.className = 'decision-card-actions';
    rightHeader.style.cssText = 'display:flex; align-items:center; gap:0.35rem;';

    if (d.status === 'proposed') {
      const valBtn = document.createElement('button');
      valBtn.className = 'decision-action-btn';
      valBtn.innerHTML = `<span>${getWsIcon('check', 13)}</span> <span>${escH(t('team.validateDecision') || 'Valider')}</span>`;
      valBtn.title = t('team.validateDecisionTooltip') || 'Valider et activer cette décision';
      valBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        promoteProposedDecisionToActive(d.id || d.text);
      });
      rightHeader.appendChild(valBtn);
    }

    const editBtn = document.createElement('button');
    editBtn.className = 'decision-action-btn';
    editBtn.innerHTML = `<span>${getWsIcon('pencil', 13)}</span> <span>${escH(t('common.edit') || 'Modifier')}</span>`;
    editBtn.title = t('team.editDecisionTitle') || 'Modifier cette décision';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditDecisionModal(d);
    });
    rightHeader.appendChild(editBtn);

    const todoBtn = document.createElement('button');
    todoBtn.className = 'decision-action-btn';
    todoBtn.innerHTML = `<span>${getWsIcon('checkSquare', 13)}</span> <span>${escH(t('team.createTodo') || 'Tâche')}</span>`;
    todoBtn.title = t('team.createTodoFromDecisionTooltip') || 'Créer une tâche issue de cette décision';
    todoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      createTodoFromDecision(d.text);
    });
    rightHeader.appendChild(todoBtn);

    const linkBtn = document.createElement('button');
    linkBtn.className = 'decision-action-btn';
    linkBtn.innerHTML = `<span>${getWsIcon('link', 13)}</span> <span>${escH(t('team.copyLink') || 'Lien')}</span>`;
    linkBtn.title = t('team.copyLinkTooltip') || 'Copier le lien direct vers cette décision';
    linkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyDecisionHashLink(d.id || d.text);
    });
    rightHeader.appendChild(linkBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'decision-action-btn decision-action-btn--danger';
    deleteBtn.innerHTML = `<span>${getWsIcon('trash', 13)}</span> <span>${escH(t('common.delete') || 'Supprimer')}</span>`;
    deleteBtn.title = t('team.deleteDecisionTooltip') || 'Supprimer cette décision';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteDecisionItem(d);
    });
    rightHeader.appendChild(deleteBtn);

    const dateEl = document.createElement('span');
    dateEl.style.cssText = 'font-size:0.75rem; color:var(--text-muted); font-weight:600; margin-left:0.3rem;';
    dateEl.textContent = d.date || '';
    rightHeader.appendChild(dateEl);

    topRow.appendChild(rightHeader);
    card.appendChild(topRow);

    const textEl = document.createElement('div');
    textEl.style.cssText = 'font-size:0.95rem; font-weight:600; color:var(--text); margin-top:0.45rem; line-height:1.45;';
    if (d.status === 'superseded') textEl.style.textDecoration = 'line-through';
    textEl.textContent = d.text;
    card.appendChild(textEl);

    if (d.noteTitle) {
      const refRow = document.createElement('div');
      refRow.style.cssText = 'font-size:0.78rem; color:var(--text-muted); margin-top:0.35rem; display:flex; align-items:center; flex-wrap:wrap; gap:0.3rem;';
      const takenSources = (d.takenNotes && d.takenNotes.length > 0) ? d.takenNotes : [d];
      
      const takenLabel = document.createElement('span');
      takenLabel.textContent = `${t('team.takenDuringMeeting') || 'Consignée pendant :'}`;
      refRow.appendChild(takenLabel);

      takenSources.forEach((note, idx) => {
        if (idx > 0) {
          const sep = document.createElement('span');
          sep.textContent = ',';
          refRow.appendChild(sep);
        }
        const link = document.createElement('a');
        link.style.cssText = 'cursor:pointer; text-decoration:underline; color:var(--accent); font-weight:500;';
        link.textContent = note.noteTitle || 'Note';
        link.title = t('editor.openNoteTitleTooltip', { title: note.noteTitle || '' });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          openDecisionNoteOverlay(note.notePath);
        });
        refRow.appendChild(link);
      });
      card.appendChild(refRow);
    }

    cascade.appendChild(card);
  });
  target.appendChild(cascade);
}

function renderDecisionCompactView(target, groupedProjectDecs) {
  if (groupedProjectDecs.length === 0) {
    target.innerHTML = `<div style="color:var(--text-muted); font-style:italic; font-size:0.9rem; padding:3rem 1rem; text-align:center; background:rgba(255,255,255,0.02); border-radius:8px; border:1px dashed var(--card-border); min-height:460px; display:flex; align-items:center; justify-content:center;">${t('team.noDecisionsProject') || 'Aucune décision ne correspond aux critères.'}</div>`;
    return;
  }

  const table = document.createElement('table');
  table.className = 'decision-compact-table';
  table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.85rem; min-height:460px;';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr style="border-bottom:2px solid var(--card-border); text-align:left; color:var(--text-muted);">
      <th style="padding:8px;">${escH(t('common.status') || 'Statut')}</th>
      <th style="padding:8px;">${escH(t('team.tabDecisions') || 'Décision')}</th>
      <th style="padding:8px;">${escH(t('team.authority') || 'Autorité')}</th>
      <th style="padding:8px;">${escH(t('planner.date') || 'Date')}</th>
      <th style="padding:8px;">${escH(t('team.actions') || 'Actions')}</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  groupedProjectDecs.forEach(d => {
    const tr = document.createElement('tr');
    tr.className = 'decision-compact-row';
    tr.style.cssText = 'border-bottom:1px solid var(--card-border); cursor:pointer; transition:background 0.15s ease;';
    tr.setAttribute('title', t('team.dblClickToEditDecision') || 'Double-cliquer pour modifier la décision');
    tr.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openEditDecisionModal(d);
    });

    const statusIconHtml = d.status === 'proposed'
      ? `${getWsIcon('clock', 12)} ${t('team.statusProposed') || 'Proposée'}`
      : d.status === 'superseded'
      ? `${getWsIcon('undo', 12)} ${t('team.statusSuperseded') || 'Remplacée'}`
      : `${getWsIcon('check', 12)} ${t('team.statusActive') || 'Active'}`;

    tr.innerHTML = `
      <td style="padding:8px;">
        <span class="${d.status === 'proposed' ? 'pill-decision pill-decision-proposed' : d.status === 'superseded' ? 'pill-decision pill-decision-superseded' : 'pill-decision pill-decision-active'}" style="font-size:0.72rem; padding:2px 6px; border-radius:4px;">
          ${statusIconHtml}
        </span>
      </td>
      <td style="padding:8px; font-weight:600; color:var(--text); ${d.status === 'superseded' ? 'text-decoration:line-through;' : ''}">
        ${escH(d.text)}
      </td>
      <td style="padding:8px;">
        ${d.authority === 'manager' ? `<span class="pill-authority-manager" style="font-size:0.72rem; padding:2px 6px; border-radius:4px; display:inline-flex; align-items:center; gap:3px;">${getWsIcon('briefcase', 11)} ${escH(t('team.managerBadge') || 'Manager')}</span>` : escH(t('team.teamRole') || 'Team')}
      </td>
      <td style="padding:8px; color:var(--text-muted); font-size:0.78rem;">${escH(d.date || '')}</td>
      <td style="padding:8px;">
        <button class="topbar-srch-btn" onclick="event.stopPropagation(); copyDecisionToClipboard('${escA(d.text)}')" title="${escA(t('team.copy') || 'Copier')}" style="padding:2px 5px; font-size:0.7rem;">${getWsIcon('copy', 12)}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  target.appendChild(table);
}

function renderDecisionTimelineView(target, groupedProjectDecs) {
  if (groupedProjectDecs.length === 0) {
    target.innerHTML = `<div style="color:var(--text-muted); font-style:italic; font-size:0.9rem; padding:3rem 1rem; text-align:center; background:rgba(255,255,255,0.02); border-radius:8px; border:1px dashed var(--card-border); min-height:460px; display:flex; align-items:center; justify-content:center;">${t('team.noDecisionsProject') || 'Aucune décision ne correspond aux critères.'}</div>`;
    return;
  }

  const container = document.createElement('div');
  container.className = 'decision-timeline-container';
  container.style.cssText = 'position:relative; padding-left:2rem; border-left:2px solid var(--card-border); display:flex; flex-direction:column; gap:1.2rem; margin-top:0.5rem;';

  groupedProjectDecs.forEach(d => {
    const node = document.createElement('div');
    node.className = 'decision-timeline-node';
    node.style.cssText = 'position:relative; background:var(--card-bg); border:1px solid var(--card-border); border-radius:10px; padding:0.85rem 1rem; cursor:pointer; transition:transform 0.15s ease, border-color 0.15s ease;';
    node.setAttribute('title', t('team.dblClickToEditDecision') || 'Double-cliquer pour modifier la décision');
    node.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openEditDecisionModal(d);
    });

    const dot = document.createElement('div');
    dot.className = 'timeline-node-dot';
    dot.style.cssText = `position:absolute; left:-2.45rem; top:1.1rem; width:12px; height:12px; border-radius:50%; background:${d.status === 'proposed' ? '#f59e0b' : d.status === 'superseded' ? 'var(--text-muted)' : '#10b981'}; border:2px solid var(--card-bg);`;
    node.appendChild(dot);

    const body = document.createElement('div');
    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-muted); font-weight:600; margin-bottom:0.25rem;">
        <span style="display:inline-flex; align-items:center; gap:4px;">${getWsIcon('calendar', 12)} ${escH(d.date || 'N/A')}</span>
        <span style="display:inline-flex; align-items:center; gap:4px;">${d.authority === 'manager' ? getWsIcon('briefcase', 12) + ' Manager' : 'Team'}</span>
      </div>
      <div style="font-size:0.92rem; font-weight:600; color:var(--text); ${d.status === 'superseded' ? 'text-decoration:line-through;' : ''}">${escH(d.text)}</div>
    `;
    node.appendChild(body);

    container.appendChild(node);
  });

  target.appendChild(container);
}

// ── Workstream AI Copilot Tab View ──

function buildWorkstreamSystemPrompt(topicName, memory = {}, options = {}) {
  const isOther = (topicName === REGISTRY_OTHER_PROJECTS_KEY);
  const langInfo = options.langInfo || { code: 'en', name: 'English' };

  if (isOther) {
    const allMajors = options.allMajors || (typeof decisionsByMajor !== 'undefined' ? Array.from(decisionsByMajor.keys()).filter(k => k !== uncategorizedProjectLabel) : []);
    const rawTodos = options.todosList || (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest) ? todosManifest : []);
    const allDec = options.decisionsList || (typeof getAllMetadataDecisionEntries === 'function' ? getAllMetadataDecisionEntries() : []);

    const activeTasks = rawTodos.filter(t => !t.completed);
    const uncategorizedTasks = activeTasks.filter(t => !(t.major_topic_tags || []).some(tag => allMajors.includes(tag)));
    const uncategorizedDecisions = (Array.isArray(allDec) ? allDec : []).filter(d => ((d.status || 'active') === 'active' || d.status === 'proposed') && !(d.major_topic_tags || []).some(tag => allMajors.includes(tag)));

    const workstreamsSummary = allMajors.map(wsName => {
      const wsMemory = (typeof getMajorTopicMemorySync === 'function' ? getMajorTopicMemorySync(wsName) : null) || {};
      const wsTasks = activeTasks.filter(t => (t.major_topic_tags || []).includes(wsName));
      const wsMilestones = (wsMemory.activeMilestones || []).map(m => typeof m === 'string' ? m : m.title);
      return {
        name: wsName,
        summary: wsMemory.oneSentenceSummary || wsMemory.summary || 'No summary registered',
        openTaskCount: wsTasks.length,
        topTasks: wsTasks.slice(0, 5),
        milestones: wsMilestones
      };
    });

    const totalOpenTasks = activeTasks.length;

    return `You are the Executive Portfolio Secretary AI Copilot. Your primary mission and purpose is to review all active workstreams, synthesize cross-workstream status, analyze remaining work across all workstreams and uncategorized items, and provide a comprehensive executive overview of remaining work, priorities, and potential bottlenecks.

You possess full access to all workstreams and remaining deliverables across the organization:

1. WORKSTREAM PORTFOLIO OVERVIEW (${workstreamsSummary.length} Workstreams):
${workstreamsSummary.map(ws => `• [${ws.name}] - Scope: ${ws.summary} | Remaining Tasks: ${ws.openTaskCount} | Milestones: ${ws.milestones.join(', ') || 'None'}`).join('\n') || 'No active workstreams'}

2. REMAINING WORK BREAKDOWN BY WORKSTREAM:
${workstreamsSummary.map(ws => `• ${ws.name} (${ws.openTaskCount} remaining tasks):\n` + (ws.topTasks.map(t => `  - ${t.title}${t.dueDate ? ' (Due: ' + t.dueDate + ')' : ''}`).join('\n') || '  - No open tasks')).join('\n') || 'None'}

3. UNCATEGORIZED / OTHER REMAINING WORK (${uncategorizedTasks.length} tasks, ${uncategorizedDecisions.length} decisions):
• Active Uncategorized Tasks:
${uncategorizedTasks.slice(0, 10).map(t => '  - ' + t.title + (t.dueDate ? ' (Due: ' + t.dueDate + ')' : '')).join('\n') || '  - None'}
• Active Uncategorized Decisions:
${uncategorizedDecisions.slice(0, 5).map(d => '  - [' + (d.status || 'active') + '] ' + (d.text || d.title)).join('\n') || '  - None'}

4. TOTAL REMAINING WORK SUMMARY:
• Total Open Tasks across organization: ${totalOpenTasks}
• Total Workstreams: ${workstreamsSummary.length}

EXCELLENCE & INTERACTION DIRECTIVES:
- MANDATORY LANGUAGE DIRECTIVE: You MUST formulate your entire response in ${langInfo.name}.
- Deliver crisp, executive-grade portfolio analysis, clear workstream progress review, remaining work estimate, and actionable priorities.
- If cross-workstream alignment or review is needed, proactively suggest scheduling a strategic meeting specifying attendees and agenda.
- When proposing a meeting, append a strict JSON block at the very end of your reply enclosed in \`\`\`json and \`\`\` with this exact schema:
{
  "suggestedMeetings": [
    {
      "title": "Meeting title in ${langInfo.name}",
      "targetParticipants": ["Name 1", "Name 2"],
      "durationMinutes": 30,
      "reason": "Strategic rationale in ${langInfo.name}",
      "agenda": ["Point 1", "Point 2", "Point 3"]
    }
  ]
}`;
  }

  const activeDec = (options.activeDec || []).filter(d => (d.status || 'active') === 'active' || (d.status === 'proposed'));
  const activeTasks = options.activeTasks || [];
  const meetingsData = options.meetingsData || { upcoming: [], past: [] };

  return `You are the dedicated Secretary AI Copilot and Executive Chief of Staff for the Workstream "${topicName}".
You possess full access to the strategic scope, decision log, open threads, active deliverables, and calendar events for this workstream:

1. WORKSTREAM SCOPE & BOUNDARIES:
${memory.summary || 'Not specified'}

2. KEY FACTS & CONTEXT (${(memory.keyFacts || []).length}):
${(memory.keyFacts || []).map(f => '- ' + f).join('\n') || 'None logged'}

3. ACTIVE MILESTONES & GOALS:
${(memory.activeMilestones || []).map(m => '- ' + (typeof m === 'string' ? m : m.title)).join('\n') || 'None'}

4. DECISION REGISTER (${activeDec.length}):
${activeDec.map(d => '- [' + (d.status || 'active') + '] ' + (d.text || d.title)).join('\n') || 'None'}

5. OPEN THREADS & BLOCKERS (${(memory.openThreads || []).length}):
${(memory.openThreads || []).map(q => '- ❓ ' + q).join('\n') || 'None'}

6. ACTIVE TASKS & DELIVERABLES (${activeTasks.length}):
${activeTasks.slice(0, 10).map(t => '- ' + t.title + (t.dueDate ? ' (Due: ' + t.dueDate + ')' : '')).join('\n') || 'None'}

7. STAKEHOLDERS & COLLABORATORS:
${(memory.participants || []).join(', ') || 'Team'}

8. PLANNER MEETINGS (Upcoming: ${meetingsData.upcoming.length}, Past: ${meetingsData.past.length}):
${meetingsData.upcoming.slice(0, 5).map(e => '- [' + e.date + ' ' + (e.startTime || '') + '] ' + e.title + ' (Attendees: ' + (e.collaborators || []).join(', ') + ')').join('\n') || 'No upcoming meetings scheduled'}

EXCELLENCE & INTERACTION DIRECTIVES:
- MANDATORY LANGUAGE DIRECTIVE: You MUST formulate your entire response in ${langInfo.name}.
- Deliver crisp, executive-grade, structured analyses, sharp strategic clarity, and directly actionable solutions.
- If an open question, milestone, or blocker requires multi-stakeholder alignment, proactively suggest scheduling a strategic meeting specifying attendees and an itemized agenda.
- When proposing a meeting, append a strict JSON block at the very end of your reply enclosed in \`\`\`json and \`\`\` with this exact schema:
{
  "suggestedMeetings": [
    {
      "title": "Meeting title in ${langInfo.name}",
      "targetParticipants": ["Name 1", "Name 2"],
      "durationMinutes": 30,
      "reason": "Strategic rationale in ${langInfo.name}",
      "agenda": ["Point 1", "Point 2", "Point 3"]
    }
  ]
}`;
}

if (typeof window !== 'undefined') {
  window.buildWorkstreamSystemPrompt = buildWorkstreamSystemPrompt;
}

async function renderWorkstreamChatTab(topicName, parentContainer, currentWsMemory) {
  parentContainer.innerHTML = '';
  const chatLayout = document.createElement('div');
  chatLayout.className = 'workstream-chat-layout';

  const isOther = (topicName === REGISTRY_OTHER_PROJECTS_KEY);
  const displayTopicName = isOther
    ? (t('workstream.otherTab') || 'Other')
    : (topicName === REGISTRY_ALL_PROJECTS_KEY ? (t('team.filterAll') || 'All') : (topicName || 'Workstream'));

  let chatData = { topicName, messages: [], thinkingEffort: 'medium' };
  try {
    if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.loadWorkstreamChat) {
      chatData = await WorkstreamMemoryEngine.loadWorkstreamChat(topicName);
    }
  } catch (err) {
    console.warn('Could not load workstream chat history:', err);
  }

  let currentEffort = chatData.thinkingEffort || 'medium';
  let isGenerating = false;
  let abortController = null;

  const starterChipsHTML = isOther ? `
    <button type="button" class="workstream-starter-chip" data-prompt="${escA(t('workstream.promptPortfolioOverview') || 'Overview of remaining work by workstream')}">${getWsIcon('target', 13)} ${escH(t('workstream.promptPortfolioOverview') || 'Overview of remaining work by workstream')}</button>
    <button type="button" class="workstream-starter-chip" data-prompt="${escA(t('workstream.promptCrossWorkstreamBlockers') || 'Synthesis of global blockers & risks')}">${getWsIcon('search', 13)} ${escH(t('workstream.promptCrossWorkstreamBlockers') || 'Synthesis of global blockers & risks')}</button>
    <button type="button" class="workstream-starter-chip" data-prompt="${escA(t('workstream.promptUnassignedTasks') || 'Uncategorized tasks & remaining work')}">${getWsIcon('checkSquare', 13)} ${escH(t('workstream.promptUnassignedTasks') || 'Uncategorized tasks & remaining work')}</button>
    <button type="button" class="workstream-starter-chip" data-prompt="${escA(t('workstream.promptPriorityNextSteps') || 'Priorities & next steps for progress')}">${getWsIcon('bolt', 13)} ${escH(t('workstream.promptPriorityNextSteps') || 'Priorities & next steps for progress')}</button>
  ` : `
    <button type="button" class="workstream-starter-chip" data-prompt="${escA(t('workstream.promptStateOfUnion') || 'État des lieux & Priorités')}">${getWsIcon('target', 13)} ${escH(t('workstream.promptStateOfUnion') || 'État des lieux & Priorités')}</button>
    <button type="button" class="workstream-starter-chip" data-prompt="${escA(t('workstream.promptOpenQuestions') || 'Blocages & Sujets ouverts')}">${getWsIcon('search', 13)} ${escH(t('workstream.promptOpenQuestions') || 'Blocages & Sujets ouverts')}</button>
    <button type="button" class="workstream-starter-chip" data-prompt="${escA(t('workstream.promptReviewMeetings') || 'Passer en revue les réunions')}">${getWsIcon('calendar', 13)} ${escH(t('workstream.promptReviewMeetings') || 'Passer en revue les réunions')}</button>
    <button type="button" class="workstream-starter-chip" data-prompt="${escA(t('workstream.promptSuggestMeetings') || 'Suggérer des réunions stratégiques')}">${getWsIcon('lightbulb', 13)} ${escH(t('workstream.promptSuggestMeetings') || 'Suggérer des réunions stratégiques')}</button>
    <button type="button" class="workstream-starter-chip" data-prompt="${escA(t('workstream.promptNextSteps') || 'Prochaines étapes concrètes')}">${getWsIcon('bolt', 13)} ${escH(t('workstream.promptNextSteps') || 'Prochaines étapes concrètes')}</button>
  `;

  chatLayout.innerHTML = `
    <div class="workstream-chat-header">
      <div style="display:flex; align-items:center; gap:8px; font-weight:700; color:var(--text);">
        <span>${getWsIcon('bot', 18)}</span>
        <span>${escH(t('workstream.copilotHeader') || 'Copilote IA :')} ${escH(displayTopicName)}</span>
        <span class="badge" style="font-size:0.68rem; padding:1px 6px; border-radius:10px; background:rgba(99, 102, 241, 0.12); color:var(--accent); border:1px solid rgba(99, 102, 241, 0.25);">Context-Aware</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <div style="display:inline-flex; align-items:center; gap:4px; font-size:0.75rem; color:var(--text-muted);">
          <span>${escH(t('common.thinkingEffort') || 'Effort:')}</span>
          <select id="ws-chat-effort-select" class="field-input" style="padding:2px 6px; font-size:0.72rem; border-radius:4px; height:24px;">
            <option value="low" ${currentEffort === 'low' ? 'selected' : ''}>Low</option>
            <option value="medium" ${currentEffort === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="high" ${currentEffort === 'high' ? 'selected' : ''}>High</option>
          </select>
        </div>
        <button type="button" class="btn btn-secondary" id="btn-clear-ws-chat" style="padding:2px 8px; font-size:0.72rem; height:24px;" title="${escA(t('workstream.clearChatTooltip') || 'Clear conversation history')}">
          ${getWsIcon('trash', 12)} ${escH(t('common.clear') || 'Clear')}
        </button>
      </div>
    </div>

    <div class="workstream-chat-history" id="ws-chat-history">
      <!-- Messages rendered here -->
    </div>

    <div class="workstream-chat-starters">
      ${starterChipsHTML}
    </div>

    <div class="workstream-chat-input-bar">
      <textarea id="ws-chat-input" class="workstream-chat-textarea" placeholder="${escA(t('workstream.chatPlaceholder') || 'Poser une question, demander une analyse ou ordonner une action...')}" rows="1"></textarea>
      <button type="button" class="btn btn-primary" id="btn-send-ws-chat" style="height:36px; padding:0 14px; font-weight:600; display:inline-flex; align-items:center; justify-content:center;" title="${escA(t('common.send') || 'Send')}">
        ${getWsIcon('send', 14)}
      </button>
    </div>
  `;

  parentContainer.appendChild(chatLayout);

  const historyEl = chatLayout.querySelector('#ws-chat-history');
  const inputEl = chatLayout.querySelector('#ws-chat-input');
  const sendBtn = chatLayout.querySelector('#btn-send-ws-chat');
  const effortSelect = chatLayout.querySelector('#ws-chat-effort-select');
  const clearBtn = chatLayout.querySelector('#btn-clear-ws-chat');

  effortSelect?.addEventListener('change', () => {
    currentEffort = effortSelect.value;
    chatData.thinkingEffort = currentEffort;
    if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.saveWorkstreamChat) {
      WorkstreamMemoryEngine.saveWorkstreamChat(topicName, chatData);
    }
  });

  clearBtn?.addEventListener('click', async () => {
    chatData.messages = [];
    if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.clearWorkstreamChat) {
      await WorkstreamMemoryEngine.clearWorkstreamChat(topicName);
    }
    renderMessages();
    toast(t('common.cleared') || 'Historique effacé');
  });

  const renderMessages = () => {
    if (!historyEl) return;
    historyEl.innerHTML = '';

    if (!chatData.messages || chatData.messages.length === 0) {
      const welcome = document.createElement('div');
      welcome.style.cssText = 'color:var(--text-muted); font-size:0.85rem; text-align:center; padding:2rem 1rem; display:flex; flex-direction:column; align-items:center; gap:8px; line-height:1.5;';
      const welcomeDescText = isOther
        ? (t('workstream.otherWelcomeDesc') || 'I review all workstreams to give you a clear overview of remaining work, priorities, and uncategorized tasks.')
        : (t('workstream.welcomeDesc') || 'Je connais l\'ensemble des objectifs, décisions, notes, tâches et réunions de cet axe de travail. Posez-moi une question ou utilisez les boutons rapides ci-dessous.');

      welcome.innerHTML = `
        <span style="opacity:0.85;">${getWsIcon('bot', 32)}</span>
        <div style="font-weight:700; color:var(--text);">${escH(displayTopicName)} — ${escH(t('workstream.copilotHeader') || 'Copilote IA')}</div>
        <div style="max-width:440px;">${escH(welcomeDescText)}</div>
      `;
      historyEl.appendChild(welcome);
      return;
    }

    chatData.messages.forEach(msg => {
      const msgWrap = document.createElement('div');
      msgWrap.className = `workstream-chat-msg ${msg.role === 'user' ? 'user' : 'assistant'}`;

      let rawContent = msg.content || '';
      if (msg.role === 'assistant') {
        rawContent = rawContent
          .replace(/```(?:json)?\s*\{[\s\S]*?"suggestedMeetings"[\s\S]*?\}\s*```/gi, '')
          .replace(/\{[\s\r\n]*"suggestedMeetings"[\s\S]*\}\s*$/gi, '')
          .trim();
      }

      let formattedBody = '';
      if (msg.role === 'assistant' && typeof marked !== 'undefined' && typeof marked.parse === 'function') {
        formattedBody = marked.parse(rawContent);
      } else {
        formattedBody = escH(rawContent).replace(/\n/g, '<br>');
      }

      msgWrap.innerHTML = `
        <div class="workstream-chat-bubble ${msg.role === 'user' ? 'workstream-chat-bubble-user' : 'workstream-chat-bubble-ai'}">
          ${formattedBody}
        </div>
      `;

      // Render any interactive suggested meeting cards from the assistant
      if (Array.isArray(msg.suggestedMeetings) && msg.suggestedMeetings.length > 0) {
        msg.suggestedMeetings.forEach(sug => {
          const card = document.createElement('div');
          card.className = 'workstream-suggested-card';
          card.style.cssText = 'margin-top:8px; border-left:3px solid var(--accent);';
          card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
              <span style="font-weight:700; font-size:0.88rem; color:var(--accent); display:inline-flex; align-items:center; gap:4px;">${getWsIcon('calendar', 13)} ${escH(sug.title || 'Réunion suggérée')}</span>
              <span class="badge" style="font-size:0.68rem; padding:1px 6px; display:inline-flex; align-items:center; gap:3px;">${getWsIcon('clock', 11)} ${sug.durationMinutes || 30} min</span>
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted);">${escH(sug.reason || '')}</div>
            <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:2px;">
              ${(sug.targetParticipants || []).map(p => `<span class="badge" style="font-size:0.68rem; padding:1px 6px; background:rgba(99,102,241,0.12); color:var(--accent);">${getWsIcon('user', 11)} ${escH(p)}</span>`).join('')}
            </div>
            ${Array.isArray(sug.agenda) && sug.agenda.length > 0 ? `
              <ul style="margin:4px 0 6px 16px; padding:0; font-size:0.8rem; color:var(--text);">
                ${sug.agenda.map(a => `<li>${escH(a)}</li>`).join('')}
              </ul>
            ` : ''}
            <button type="button" class="btn btn-primary btn-book-suggested" style="font-size:0.75rem; padding:4px 10px; font-weight:600; align-self:flex-start; margin-top:4px;" title="${escA(t('workstream.scheduleInPlanner') || 'Schedule in Planner')}">
              ${getWsIcon('calendar', 13)} ${escH(t('workstream.scheduleInPlanner') || 'Planifier dans le Planner')}
            </button>
          `;

          card.querySelector('.btn-book-suggested')?.addEventListener('click', () => {
            openScheduleMeetingModal(sug, topicName);
          });

          msgWrap.appendChild(card);
        });
      }

      historyEl.appendChild(msgWrap);
    });

    historyEl.scrollTop = historyEl.scrollHeight;
  };

  renderMessages();

  // Handle Starter chips
  chatLayout.querySelectorAll('.workstream-starter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const promptText = chip.getAttribute('data-prompt');
      if (promptText && inputEl) {
        inputEl.value = promptText;
        handleSendMessage();
      }
    });
  });

  // Handle Send Message
  const handleSendMessage = async () => {
    const text = (inputEl.value || '').trim();
    if (!text || isGenerating) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';

    chatData.messages.push({
      id: 'msg-' + Date.now(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    });

    renderMessages();
    if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.saveWorkstreamChat) {
      await WorkstreamMemoryEngine.saveWorkstreamChat(topicName, chatData);
    }

    isGenerating = true;
    sendBtn.innerHTML = getWsIcon('spinner', 14);
    sendBtn.disabled = true;

    // Loading indicator
    const thinkingBubble = document.createElement('div');
    thinkingBubble.className = 'workstream-chat-msg assistant';
    thinkingBubble.innerHTML = `
      <div class="workstream-chat-bubble workstream-chat-bubble-ai" style="display:flex; align-items:center; gap:8px; color:var(--text-muted); font-style:italic;">
        <span>⚙️</span>
        <span>${escH(t('workstream.loadingSuggestions') || 'Secretary Copilot réfléchit et analyse le contexte...')}</span>
      </div>
    `;
    historyEl.appendChild(thinkingBubble);
    historyEl.scrollTop = historyEl.scrollHeight;

    try {
      const memory = (currentWsMemory || (typeof getMajorTopicMemory === 'function' ? await getMajorTopicMemory(topicName, { skipAutoArchive: true }) : null)) || {};
      const meetingsData = (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.getWorkstreamMeetings)
        ? WorkstreamMemoryEngine.getWorkstreamMeetings(topicName, { memory })
        : { upcoming: [], past: [] };

      const allDec = (typeof getAllMetadataDecisionEntries === 'function') ? getAllMetadataDecisionEntries() : (typeof decisionsList !== 'undefined' ? decisionsList : []);
      const activeDec = (Array.isArray(allDec) ? allDec : []).filter(d => (d.status || 'active') === 'active' || (d.status === 'proposed'));

      const rawTodos = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) ? todosManifest : [];
      const activeTasks = rawTodos.filter(t => !t.completed);

      const langInfo = (function() {
        let lang = 'en';
        if (typeof settings !== 'undefined' && settings) {
          if (settings.ai && settings.ai.language && settings.ai.language !== 'auto') {
            lang = settings.ai.language;
          } else if (typeof detectTextLanguage === 'function') {
            const sample = `${topicName} ${memory.summary || ''} ${text}`;
            lang = detectTextLanguage(sample, settings.language || 'en');
          } else if (settings.language) {
            lang = settings.language;
          }
        }
        lang = String(lang).toLowerCase().split('-')[0];
        const names = (typeof APP_LANGUAGE_NAMES !== 'undefined') ? APP_LANGUAGE_NAMES : {
          en: 'English', de: 'Deutsch (German)', fr: 'Français (French)', cs: 'Čeština (Czech)',
          es: 'Español (Spanish)', hu: 'Magyar (Hungarian)', it: 'Italiano (Italian)', nl: 'Nederlands (Dutch)',
          pl: 'Polski (Polish)', pt: 'Português (Portuguese)', ro: 'Română (Romanian)', ru: 'Русский (Russian)',
          sv: 'Svenska (Swedish)', tr: 'Türkçe (Turkish)', uk: 'Українська (Ukrainian)'
        };
        const code = names[lang] ? lang : 'en';
        return { code, name: names[code] || 'English' };
      })();

      const systemPrompt = buildWorkstreamSystemPrompt(topicName, memory, {
        activeDec,
        activeTasks,
        meetingsData,
        langInfo,
        allMajors: (typeof decisionsByMajor !== 'undefined' ? Array.from(decisionsByMajor.keys()).filter(k => k !== uncategorizedProjectLabel) : []),
        todosList: rawTodos,
        decisionsList: allDec
      });

      const historyMessages = chatData.messages.slice(-6).map(m => ({ role: m.role, content: m.content }));
      const fullMessages = [
        { role: 'system', content: systemPrompt },
        ...historyMessages
      ];

      abortController = new AbortController();
      let res = null;
      if (typeof LLMService !== 'undefined' && typeof LLMService.chat === 'function') {
        res = await LLMService.chat(fullMessages, {
          reasoningEffort: currentEffort,
          signal: abortController.signal
        });
      }

      thinkingBubble.remove();

      let replyContent = res?.reply || 'Je suis à votre disposition pour analyser et faire avancer ce workstream.';
      let suggestedMeetingsList = [];

      const jsonMatch = replyContent.match(/```(?:json)?\s*(\{[\s\S]*?"suggestedMeetings"[\s\S]*?\})\s*```/i);
      if (res?.parsed && Array.isArray(res.parsed.suggestedMeetings)) {
        suggestedMeetingsList = res.parsed.suggestedMeetings;
      } else if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (Array.isArray(parsed.suggestedMeetings)) {
            suggestedMeetingsList = parsed.suggestedMeetings;
          }
        } catch (_e) {}
      }

      if (jsonMatch) {
        replyContent = replyContent.replace(jsonMatch[0], '').trim();
      } else {
        const bareJsonMatch = replyContent.match(/(\{[\s\r\n]*"suggestedMeetings"[\s\S]*\})\s*$/i);
        if (bareJsonMatch) {
          try {
            const parsed = JSON.parse(bareJsonMatch[1]);
            if (Array.isArray(parsed.suggestedMeetings)) {
              if (!suggestedMeetingsList.length) suggestedMeetingsList = parsed.suggestedMeetings;
              replyContent = replyContent.replace(bareJsonMatch[0], '').trim();
            }
          } catch (_e) {}
        }
      }

      chatData.messages.push({
        id: 'msg-' + Date.now(),
        role: 'assistant',
        content: replyContent,
        suggestedMeetings: suggestedMeetingsList,
        timestamp: new Date().toISOString()
      });

      renderMessages();
      if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.saveWorkstreamChat) {
        await WorkstreamMemoryEngine.saveWorkstreamChat(topicName, chatData);
      }

    } catch (err) {
      thinkingBubble.remove();
      toast(`Erreur : ${err.message || err}`, true);
    } finally {
      isGenerating = false;
      sendBtn.innerHTML = getWsIcon('send', 14);
      sendBtn.disabled = false;
    }
  };

  sendBtn?.addEventListener('click', handleSendMessage);
  inputEl?.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
  });
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
}

// ── Workstream Meetings Tab View ──

// ── Workstream Meetings Tab View & Helpers ──

async function getMeetingLinkedNotes(meetingEvent, topicName = '') {
  const rawPlanner = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) ? plannerEvents : [];
  const liveEvt = rawPlanner.find(e => e && e.id === meetingEvent?.id) || meetingEvent || {};

  const candidateIds = new Set();
  if (liveEvt.noteId) candidateIds.add(String(liveEvt.noteId).trim());
  if (Array.isArray(liveEvt.linkedNoteIds)) {
    liveEvt.linkedNoteIds.forEach(id => {
      if (id) candidateIds.add(String(id).trim());
    });
  }
  if (liveEvt.notePath) candidateIds.add(String(liveEvt.notePath).trim());

  if (liveEvt.linkedPrepEventId) {
    const prepEvt = rawPlanner.find(e => e && e.id === liveEvt.linkedPrepEventId);
    if (prepEvt) {
      if (prepEvt.noteId) candidateIds.add(String(prepEvt.noteId).trim());
      if (Array.isArray(prepEvt.linkedNoteIds)) {
        prepEvt.linkedNoteIds.forEach(id => {
          if (id) candidateIds.add(String(id).trim());
        });
      }
      if (prepEvt.notePath) candidateIds.add(String(prepEvt.notePath).trim());
    }
  }

  const manifestList = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : [];
  const resolvedNotes = [];

  candidateIds.forEach(cand => {
    if (!cand) return;
    const lower = cand.toLowerCase();
    const found = manifestList.find(n => {
      if (!n) return false;
      return String(n.id).toLowerCase() === lower ||
             String(n.path || '').toLowerCase() === lower ||
             String(n.path || '').toLowerCase().endsWith('/' + lower) ||
             String(n.path || '').toLowerCase().endsWith(lower) ||
             String(n.title || '').toLowerCase() === lower;
    });
    if (found && !resolvedNotes.some(rn => rn.path === found.path)) {
      resolvedNotes.push(found);
    }
  });

  // Fallback: Check if notes in manifest have matching eventId or same date + topic/title
  if (resolvedNotes.length === 0 && liveEvt.date) {
    const dateMatches = manifestList.filter(n => n && n.date === liveEvt.date);
    dateMatches.forEach(n => {
      const nTitle = String(n.title || '').toLowerCase();
      const eTitle = String(liveEvt.title || '').toLowerCase();
      const ws = String(topicName || '').toLowerCase();
      const nMajors = (n.major_topic_tags || []).map(t => String(t).toLowerCase());
      if (n.eventId === liveEvt.id || n.linkedEventId === liveEvt.id || (eTitle && nTitle.includes(eTitle)) || (ws && (nTitle.includes(ws) || nMajors.includes(ws)))) {
        if (!resolvedNotes.some(rn => rn.path === n.path)) {
          resolvedNotes.push(n);
        }
      }
    });
  }

  // Read contents of resolved notes
  const noteTexts = [];
  for (const n of resolvedNotes) {
    if (n && n.path && typeof StorageAPI !== 'undefined' && StorageAPI.readNoteContent) {
      try {
        const rawHtml = await StorageAPI.readNoteContent(n.path);
        let plain = '';
        if (typeof turndownService !== 'undefined') {
          plain = turndownService.turndown(rawHtml);
        } else if (rawHtml) {
          plain = rawHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                         .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                         .replace(/<[^>]+>/g, ' ')
                         .replace(/\s{2,}/g, ' ')
                         .trim();
        }
        if (plain) {
          noteTexts.push(`### Note: ${n.title || 'Untitled'} (${n.date || ''})\n${plain}`);
        }
      } catch (_e) {}
    }
  }

  return {
    notes: resolvedNotes,
    combinedText: noteTexts.join('\n\n---\n\n') || liveEvt.description || ''
  };
}

async function renderWorkstreamMeetingsTab(topicName, parentContainer, currentWsMemory, projectMeetingsData) {
  parentContainer.innerHTML = '';
  const meetingsLayout = document.createElement('div');
  meetingsLayout.className = 'workstream-meetings-container';
  meetingsLayout.style.cssText = 'display:flex; flex-direction:column; gap:12px; width:100%; min-height:540px;';

  const upcomingMeetings = projectMeetingsData?.upcoming || [];
  const pastMeetings = projectMeetingsData?.past || [];
  const allProvided = projectMeetingsData?.all || [...upcomingMeetings, ...pastMeetings];

  // Unique meetings map
  const allMeetingsMap = new Map();
  allProvided.forEach(m => {
    if (m && (m.id || m.title)) {
      const key = m.id || `${m.date}_${m.startTime}_${m.title}`;
      if (!allMeetingsMap.has(key)) {
        allMeetingsMap.set(key, m);
      }
    }
  });
  const allMeetings = Array.from(allMeetingsMap.values());

  // Top Section: Actions Bar
  const actionsBar = document.createElement('div');
  actionsBar.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; flex-wrap:wrap; gap:8px;';
  actionsBar.innerHTML = `
    <div style="font-weight:700; font-size:0.9rem; color:var(--text); display:flex; align-items:center; gap:6px;">
      ${getWsIcon('calendar', 16)} ${escH(t('workstream.subtabMeetings') || 'Meetings')} (${allMeetings.length})
    </div>
    <div style="display:flex; align-items:center; gap:6px;">
      <button type="button" class="btn btn-secondary" id="btn-refresh-meeting-sug" style="font-size:0.75rem; padding:3px 8px; color:var(--text-muted);" title="${escA(t('workstream.refreshSuggestionsTooltip') || 'Re-analyze workstream and refresh suggested meetings')}">
        ${getWsIcon('refresh', 13)} ${escH(t('common.refresh') || 'Actualiser')}
      </button>
      <button type="button" class="btn btn-secondary" id="btn-new-ws-meeting" style="font-size:0.75rem; padding:3px 10px; font-weight:600;" title="${escA(t('workstream.scheduleNewMeeting') || '+ Planifier une réunion')}">
        ${getWsIcon('plus', 13)} ${escH(t('workstream.scheduleNewMeetingShort') || '+ Planifier')}
      </button>
    </div>
  `;
  meetingsLayout.appendChild(actionsBar);

  actionsBar.querySelector('#btn-new-ws-meeting')?.addEventListener('click', () => {
    openScheduleMeetingModal({ title: `Point : ${topicName}`, targetParticipants: currentWsMemory?.participants || [], durationMinutes: 30 }, topicName);
  });

  // Suggested Section Container (Holds initial Banner, Progress bar, or Proposals)
  const suggestionsBox = document.createElement('div');
  suggestionsBox.id = 'ws-suggested-meetings-wrapper';
  suggestionsBox.style.cssText = 'display:flex; flex-direction:column; gap:10px;';
  meetingsLayout.appendChild(suggestionsBox);

  // Helper to persist updated suggestions to topic memory
  const persistSuggestions = async (newSuggestions) => {
    if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.saveMajorTopicMemory) {
      try {
        const fullMem = (await WorkstreamMemoryEngine.getMajorTopicMemory(topicName, { skipAutoArchive: true })) || currentWsMemory || {};
        await WorkstreamMemoryEngine.saveMajorTopicMemory(topicName, {
          ...fullMem,
          suggestedMeetings: newSuggestions
        });
      } catch (_e) {
        console.warn('Could not persist updated suggestions:', _e);
      }
    }
  };

  // Render Trigger Banner (Initial State before running review)
  const renderTriggerBanner = () => {
    suggestionsBox.innerHTML = `
      <div class="workstream-ai-review-banner">
        <div class="workstream-ai-review-banner-header">
          <div style="font-weight:700; font-size:0.88rem; color:var(--accent); display:flex; align-items:center; gap:6px;">
            <span>✨</span> <span>${escH(t('workstream.requestAiMeetingReview') || 'Request AI Meeting Review')}</span>
          </div>
          <button type="button" class="btn btn-primary" id="btn-request-ai-meeting-review" style="font-size:0.75rem; padding:4px 12px; font-weight:600;" title="${escA(t('workstream.requestAiMeetingReviewTooltip') || 'Analyze workstream blockers, milestones, and upcoming calendar to suggest strategic meetings')}">
            ${getWsIcon('sparkles', 13)} ${escH(t('workstream.requestAiMeetingReview') || 'Request AI Review')}
          </button>
        </div>
        <div class="workstream-ai-review-notice">
          <span>📅</span> <span>${escH(t('workstream.calendarUpToDateNotice') || 'Please ensure your calendar is up to date before requesting an AI review so upcoming meetings are properly taken into account.')}</span>
        </div>
      </div>
    `;

    suggestionsBox.querySelector('#btn-request-ai-meeting-review')?.addEventListener('click', () => {
      loadSuggestions(true);
    });
  };

  // Render Small Progress Bar (Loading State during analysis)
  const renderProgressBar = () => {
    suggestionsBox.innerHTML = `
      <div class="workstream-ai-progressbar-container">
        <div class="workstream-ai-progressbar-text">
          <span>${(typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('workstream', { size: 13 }) : ''}</span> <span>${escH(t('workstream.aiReviewingProgress') || 'AI is analyzing workstream memory and upcoming calendar events...')}</span>
        </div>
        <div class="workstream-ai-progressbar-track">
          <div class="workstream-ai-progressbar-fill"></div>
        </div>
      </div>
    `;
  };

  // Render Suggestion Cards (Completed State with proposals)
  const renderSuggestionCards = (suggestions) => {
    if (!suggestions || suggestions.length === 0) {
      suggestionsBox.innerHTML = `
        <div class="workstream-suggested-section">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:700; font-size:0.9rem; color:var(--accent); display:flex; align-items:center; gap:6px;">
              <span>💡</span> <span>${escH(t('workstream.suggestedMeetingsTitle') || 'Strategic Meetings Suggested by AI')}</span>
            </div>
          </div>
          <div style="font-size:0.82rem; color:var(--text-muted); font-style:italic; padding:4px 0;">
            ${escH(t('workstream.noProposalsNeeded') || 'No additional strategic meetings required at this time. All topics are on track or covered.')}
          </div>
        </div>
      `;
      return;
    }

    suggestionsBox.innerHTML = `
      <div class="workstream-suggested-section">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-weight:700; font-size:0.9rem; color:var(--accent); display:flex; align-items:center; gap:6px;">
            <span>💡</span> <span>${escH(t('workstream.suggestedMeetingsTitle') || 'Strategic Meetings Suggested by AI')}</span>
          </div>
        </div>
        <div id="ws-suggested-cards-container" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:10px;"></div>
      </div>
    `;

    const sugCardsContainer = suggestionsBox.querySelector('#ws-suggested-cards-container');
    if (!sugCardsContainer) return;

    let activeSuggestions = [...suggestions];

    activeSuggestions.forEach((sug, idx) => {
      const isEnrich = sug.proposalType === 'enrich_existing';
      const card = document.createElement('div');
      card.className = 'workstream-suggested-card';

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <span style="font-weight:700; font-size:0.88rem; color:var(--accent); display:inline-flex; align-items:center; gap:4px;">
            ${getWsIcon('calendar', 13)} ${escH(sug.title || (isEnrich ? t('workstream.proposedContext') : t('workstream.suggestedMeetingsTitle')))}
          </span>
          ${isEnrich ? `
            <span class="badge" style="font-size:0.68rem; padding:2px 6px; background:rgba(99,102,241,0.15); color:var(--accent); display:inline-flex; align-items:center; gap:3px;">
              ${getWsIcon('calendar', 11)} ${escH(t('workstream.existingUpcomingMeeting') || 'Upcoming meeting')}
            </span>
          ` : `
            <span class="badge" style="font-size:0.68rem; padding:1px 6px; display:inline-flex; align-items:center; gap:3px;">
              ${getWsIcon('clock', 11)} ${sug.durationMinutes || 30} min
            </span>
          `}
        </div>
        ${isEnrich && (sug.existingMeetingTitle || sug.existingMeetingDate) ? `
          <div style="font-size:0.78rem; font-weight:600; color:var(--accent); background:rgba(99,102,241,0.08); padding:3px 8px; border-radius:4px; display:inline-flex; align-items:center; gap:4px; width:fit-content;">
            <span>📅</span> <span>${escH(t('workstream.upcomingMeetingDetected') || 'Upcoming meeting covers this')}: <em>${escH(sug.existingMeetingTitle || '')} ${sug.existingMeetingDate ? `(${escH(sug.existingMeetingDate)})` : ''}</em></span>
          </div>
        ` : ''}
        <div style="font-size:0.8rem; color:var(--text-muted);">${escH(sug.reason || '')}</div>
        ${sug.proposedContext ? `
          <div style="font-size:0.8rem; background:rgba(99,102,241,0.05); border-left:3px solid var(--accent); padding:5px 8px; border-radius:4px; color:var(--text);">
            <strong style="font-size:0.75rem; color:var(--accent);">${escH(t('workstream.proposedContext') || 'Proposed context')}:</strong> ${escH(sug.proposedContext)}
          </div>
        ` : ''}
        ${Array.isArray(sug.targetParticipants) && sug.targetParticipants.length > 0 ? `
          <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:2px;">
            ${sug.targetParticipants.map(p => `<span class="badge" style="font-size:0.68rem; padding:1px 6px; background:rgba(99,102,241,0.12); color:var(--accent);">${getWsIcon('user', 11)} ${escH(p)}</span>`).join('')}
          </div>
        ` : ''}
        ${Array.isArray(sug.agenda) && sug.agenda.length > 0 ? `
          <ul style="margin:4px 0 6px 16px; padding:0; font-size:0.8rem; color:var(--text);">
            ${sug.agenda.map(a => `<li>${escH(a)}</li>`).join('')}
          </ul>
        ` : ''}
        <div style="display:flex; align-items:center; gap:8px; margin-top:6px; flex-wrap:wrap;">
          ${isEnrich ? `
            <button type="button" class="btn btn-primary btn-apply-context" style="font-size:0.75rem; padding:4px 10px; font-weight:600;" title="${escA(t('workstream.applyContextToMeetingTooltip') || 'Append this strategic context and agenda directly to the scheduled meeting')}">
              ${getWsIcon('check', 12)} ${escH(t('workstream.applyContextToMeeting') || 'Add Context to Meeting')}
            </button>
          ` : `
            <button type="button" class="btn btn-primary btn-book-suggested" style="font-size:0.75rem; padding:4px 10px; font-weight:600;" title="${escA(t('workstream.scheduleInPlanner') || 'Schedule in Planner')}">
              ${getWsIcon('calendar', 13)} ${escH(t('workstream.acceptProposal') || 'Accept & Schedule')}
            </button>
          `}
          <button type="button" class="btn btn-secondary btn-dismiss-proposal" style="font-size:0.75rem; padding:4px 8px; color:var(--text-muted);" title="${escA(t('workstream.dismissProposalTooltip') || 'Dismiss this meeting proposal')}">
            ${getWsIcon('trash', 12)} ${escH(t('workstream.dismissProposal') || 'Dismiss')}
          </button>
        </div>
      `;

      // Accept / Apply Context
      card.querySelector('.btn-apply-context')?.addEventListener('click', async () => {
        let matchedEvt = null;
        if (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) {
          if (sug.existingMeetingId) {
            matchedEvt = plannerEvents.find(e => e.id === sug.existingMeetingId);
          }
          if (!matchedEvt && sug.existingMeetingTitle) {
            matchedEvt = plannerEvents.find(e => (e.title || '').toLowerCase() === sug.existingMeetingTitle.toLowerCase());
          }
        }

        if (matchedEvt) {
          const contextLines = [
            sug.proposedContext ? `\n📌 Context: ${sug.proposedContext}` : '',
            Array.isArray(sug.agenda) && sug.agenda.length > 0 ? `\n📋 Agenda:\n${sug.agenda.map(a => `- ${a}`).join('\n')}` : ''
          ].filter(Boolean).join('\n');
          matchedEvt.description = (matchedEvt.description ? (matchedEvt.description + '\n' + contextLines) : contextLines).trim();
          if (typeof StorageAPI !== 'undefined' && StorageAPI.writePlanner) {
            await StorageAPI.writePlanner({ events: plannerEvents });
          }
        }

        if (typeof showToast === 'function') {
          showToast(t('workstream.contextAppliedSuccess') || 'Context successfully added to meeting');
        }

        activeSuggestions.splice(idx, 1);
        await persistSuggestions(activeSuggestions);
        renderSuggestionCards(activeSuggestions);
      });

      // Accept & Schedule new meeting
      card.querySelector('.btn-book-suggested')?.addEventListener('click', () => {
        openScheduleMeetingModal(sug, topicName);
        activeSuggestions.splice(idx, 1);
        persistSuggestions(activeSuggestions);
      });

      // Dismiss proposal
      card.querySelector('.btn-dismiss-proposal')?.addEventListener('click', async () => {
        activeSuggestions.splice(idx, 1);
        await persistSuggestions(activeSuggestions);
        renderSuggestionCards(activeSuggestions);
      });

      sugCardsContainer.appendChild(card);
    });
  };

  const existingSuggestions = Array.isArray(currentWsMemory?.suggestedMeetings) && currentWsMemory.suggestedMeetings.length > 0
    ? currentWsMemory.suggestedMeetings
    : (Array.isArray(projectMeetingsData?.suggestions) && projectMeetingsData.suggestions.length > 0 ? projectMeetingsData.suggestions : null);

  // Async load / refresh suggestions
  const loadSuggestions = async (forceRefresh = false) => {
    renderProgressBar();
    try {
      let suggestions = [];
      if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.suggestWorkstreamMeetingsWithAI) {
        suggestions = await WorkstreamMemoryEngine.suggestWorkstreamMeetingsWithAI(topicName, { memory: currentWsMemory, forceRefresh });
      }
      renderSuggestionCards(suggestions);
    } catch (e) {
      suggestionsBox.innerHTML = `
        <div class="workstream-suggested-section">
          <div style="font-size:0.82rem; color:#ef4444;">Erreur : ${escH(e.message || e)}</div>
        </div>
      `;
    }
  };

  if (existingSuggestions) {
    renderSuggestionCards(existingSuggestions);
  } else {
    renderTriggerBanner();
  }

  actionsBar.querySelector('#btn-refresh-meeting-sug')?.addEventListener('click', () => loadSuggestions(true));


  // Chronological Weekly Meetings Grid (Matching Notes view)
  if (allMeetings.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:var(--text-muted); font-style:italic; font-size:0.85rem; padding:3rem 1rem; text-align:center; background:rgba(255,255,255,0.02); border-radius:8px; border:1px dashed var(--card-border); min-height:460px; display:flex; align-items:center; justify-content:center;';
    empty.textContent = t('workstream.noMeetings') || 'Aucune réunion trouvée pour ce workstream.';
    meetingsLayout.appendChild(empty);
  } else {
    // 1. Sort meetings chronologically (newest first)
    const sortedMeetings = [...allMeetings].sort((a, b) => {
      const dCmp = (b.date || '').localeCompare(a.date || '');
      if (dCmp !== 0) return dCmp;
      return (b.startTime || '').localeCompare(a.startTime || '');
    });

    // 2. Group into ISO weeks
    const today = typeof getTodayDateString === 'function' ? getTodayDateString() : new Date().toISOString().slice(0, 10);
    const currentWeekKey = typeof getNoteWeekKey === 'function' ? getNoteWeekKey(today).key : '';
    const lastWeekDate = new Date();
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const lastWeekStr = lastWeekDate.toISOString().slice(0, 10);
    const lastWeekKey = typeof getNoteWeekKey === 'function' ? getNoteWeekKey(lastWeekStr).key : '';

    const weekGroups = new Map();
    sortedMeetings.forEach(m => {
      const weekInfo = (typeof getNoteWeekKey === 'function') ? getNoteWeekKey(m.date) : { key: 'unknown', label: m.date || 'Other' };
      const wKey = weekInfo.key || 'unknown';
      if (!weekGroups.has(wKey)) {
        const label = (typeof getWeekLaneLabel === 'function') ? getWeekLaneLabel(wKey, currentWeekKey, lastWeekKey) : (weekInfo.label || wKey);
        weekGroups.set(wKey, { key: wKey, label, meetings: [] });
      }
      weekGroups.get(wKey).meetings.push(m);
    });

    const rawPlanner = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) ? plannerEvents : [];
    const manifestList = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : [];

    // 3. Render each week section
    weekGroups.forEach(wg => {
      const section = document.createElement('div');
      section.className = 'workstream-week-section';

      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'workstream-week-header';
      sectionHeader.innerHTML = `
        <div class="workstream-week-title">
          <span>${getWsIcon('calendar', 14)}</span> <span>${escH(wg.label)}</span>
        </div>
        <span class="workstream-week-badge">${wg.meetings.length}</span>
        <div class="workstream-week-divider"></div>
      `;
      section.appendChild(sectionHeader);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px; width:100%;';

      wg.meetings.forEach(evt => {
        const liveEvt = rawPlanner.find(pe => pe && pe.id === evt.id) || evt;
        const card = document.createElement('div');
        card.className = 'workstream-note-card workstream-meeting-card';
        card.setAttribute('role', 'article');
        card.setAttribute('tabindex', '0');
        card.title = t('workstream.clickToOpenBlockModal') || 'Cliquer pour ouvrir le bloc dans le Planner';

        const collabs = [...(liveEvt.collaborators || []), ...(liveEvt.collaboratorIds || [])];
        const isPast = String(liveEvt.date || '') < today;
        const hasPrep = !!liveEvt.linkedPrepEventId || rawPlanner.some(pe => pe && pe.type === 'prep' && pe.prepForEventId === liveEvt.id);

        let statusBadge = '';
        if (isPast) {
          statusBadge = `<span class="badge" style="font-size:0.68rem; padding:1px 6px; background:rgba(255,255,255,0.06); color:var(--text-muted); display:inline-flex; align-items:center; gap:3px;">${getWsIcon('history', 11)} ${escH(t('workstream.pastMeetingsTitle') || 'Passée')}</span>`;
        } else if (hasPrep) {
          statusBadge = `<span class="badge workstream-prep-badge ready">${getWsIcon('check', 11)} ${escH(t('workstream.prepReady') || 'Prep prête')}</span>`;
        } else {
          statusBadge = `<span class="badge workstream-prep-badge missing">${getWsIcon('clock', 11)} ${escH(t('workstream.prepNeeded') || 'À préparer')}</span>`;
        }

        // Linked notes lookup for pill display
        const linkedNoteIds = new Set();
        if (liveEvt.noteId) linkedNoteIds.add(String(liveEvt.noteId).trim());
        if (Array.isArray(liveEvt.linkedNoteIds)) {
          liveEvt.linkedNoteIds.forEach(id => id && linkedNoteIds.add(String(id).trim()));
        }
        if (liveEvt.notePath) linkedNoteIds.add(String(liveEvt.notePath).trim());

        const matchingNotes = [];
        linkedNoteIds.forEach(cand => {
          const lower = cand.toLowerCase();
          const found = manifestList.find(n => n && (String(n.id).toLowerCase() === lower || String(n.path || '').toLowerCase() === lower || String(n.path || '').toLowerCase().endsWith('/' + lower) || String(n.path || '').toLowerCase().endsWith(lower) || String(n.title || '').toLowerCase() === lower));
          if (found && !matchingNotes.some(mn => mn.path === found.path)) matchingNotes.push(found);
        });

        // Summary / Agenda text snippet
        let summaryText = liveEvt.description || '';
        if (!summaryText && Array.isArray(liveEvt.agenda) && liveEvt.agenda.length > 0) {
          summaryText = liveEvt.agenda.join(' · ');
        }

        card.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
              <span style="font-weight:700; font-size:0.92rem; color:var(--text); line-height:1.3; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${getWsIcon('calendar', 14)} ${escH(liveEvt.title || 'Réunion')}</span>
              <div style="flex-shrink:0;">${statusBadge}</div>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <span>${getWsIcon('calendar', 11)} <strong>${escH(liveEvt.date || '')}</strong></span>
              ${liveEvt.startTime ? `<span>·</span> <span>${escH(liveEvt.startTime)}${liveEvt.endTime ? ' - ' + escH(liveEvt.endTime) : ''}</span>` : ''}
            </div>
          </div>

          ${summaryText ? `
            <div class="workstream-note-summary" style="font-size:0.8rem; color:var(--text-muted); line-height:1.35; max-height:48px; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">
              ${escH(summaryText)}
            </div>
          ` : ''}

          <div style="display:flex; flex-direction:column; gap:6px; margin-top:auto;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:4px; flex-wrap:wrap;">
              <div style="display:flex; gap:4px; flex-wrap:wrap; align-items:center;">
                ${collabs.map(c => `<span class="tag-pill group-tag" style="font-size:0.68rem; padding:1px 6px;">${getWsIcon('user', 11)} ${escH(c)}</span>`).join('')}
                ${matchingNotes.map(n => `
                  <span class="manual-assoc-badge linked-note-pill" data-path="${escA(n.path)}" title="${escA(t('editor.openNoteTitleTooltip', { title: n.title || 'Note' }))}">
                    <span>${getWsIcon('link', 11)} ${escH(n.title || 'Note')}</span>
                  </span>
                `).join('')}
              </div>
            </div>

            <div class="workstream-meeting-actions">
              <button type="button" class="btn btn-secondary btn-sync-meeting" title="${escA(t('workstream.syncMeetingNotesTooltip') || 'Synchroniser le compte-rendu')}">
                ${getWsIcon('download', 12)} ${escH(t('workstream.syncMeetingBtn') || 'Synchroniser')}
              </button>
              ${!isPast ? `
                <button type="button" class="btn btn-secondary btn-prep-meeting" style="color:var(--accent);" title="${escA(t('workstream.prepareMeetingTooltip') || t('workstream.prepareMeetingBtn') || 'Préparer')}">
                  ${getWsIcon('sparkles', 12)} ${escH(t('workstream.prepareMeetingBtn') || 'Préparer')}
                </button>
              ` : ''}
              <button type="button" class="btn btn-secondary btn-jump-planner" style="padding:3px 7px;" title="${escA(t('editor.jumpToPlannerTooltip') || 'Ouvrir dans le Planner')}">
                ${getWsIcon('externalLink', 11)} Planner
              </button>
            </div>
          </div>
        `;

        // Card click: open block modal
        card.addEventListener('click', (e) => {
          if (e.target.closest('button') || e.target.closest('.linked-note-pill')) return;
          const freshEvt = rawPlanner.find(pe => pe && pe.id === evt.id) || liveEvt;
          if (typeof openPlanEventModal === 'function') {
            openPlanEventModal(freshEvt);
          }
        });

        // Click on linked note pill
        card.querySelectorAll('.linked-note-pill').forEach(pill => {
          pill.addEventListener('click', (e) => {
            e.stopPropagation();
            const p = pill.getAttribute('data-path');
            if (p && typeof openDecisionNoteOverlay === 'function') {
              openDecisionNoteOverlay(p);
            }
          });
        });

        // Button Sync
        card.querySelector('.btn-sync-meeting')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const freshEvt = rawPlanner.find(pe => pe && pe.id === evt.id) || liveEvt;
          openPostMeetingSyncModal(freshEvt, topicName);
        });

        // Button Prep
        card.querySelector('.btn-prep-meeting')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const freshEvt = rawPlanner.find(pe => pe && pe.id === evt.id) || liveEvt;
          openMeetingPrepBriefingModal(freshEvt, topicName);
        });

        // Button Planner jump
        card.querySelector('.btn-jump-planner')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (typeof switchTab === 'function') {
            await switchTab('planner');
          }
        });

        grid.appendChild(card);
      });

      section.appendChild(grid);
      meetingsLayout.appendChild(section);
    });
  }

  parentContainer.appendChild(meetingsLayout);
}

// ── Meeting Prep & Agenda Briefing Modal ──

async function openMeetingPrepBriefingModal(meetingEvent, topicName) {
  const existing = document.getElementById('modal-meeting-prep-briefing');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-meeting-prep-briefing';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';

  const closeModal = () => {
    document.removeEventListener('keydown', handleEsc);
    overlay.remove();
  };

  const handleEsc = (e) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', handleEsc);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  overlay.innerHTML = `
    <div class="modal-card" style="background:var(--card-bg); color:var(--text); border:1px solid var(--card-border); border-radius:14px; width:100%; max-width:680px; max-height:88vh; box-shadow:var(--shadow-lg); display:flex; flex-direction:column; overflow:hidden;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--card-border); flex-shrink:0;">
        <h3 style="margin:0; font-size:1.05rem; font-weight:700; color:var(--text); display:flex; align-items:center; gap:8px;">
          <span>${getWsIcon('sparkles', 16)}</span> <span>${escH(t('workstream.agendaModalTitle') || 'Préparation de Réunion & Ordre du Jour (IA)')}</span>
        </h3>
        <button type="button" class="btn-icon" id="close-prep-briefing-modal" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.2rem;" title="${escA(t('common.close') || 'Close')}">✕</button>
      </div>

      <div style="flex:1; overflow-y:auto; padding:18px 20px; display:flex; flex-direction:column; gap:12px;" id="prep-briefing-body">
        <div style="font-size:0.85rem; color:var(--text-muted); font-style:italic; display:flex; align-items:center; gap:8px;">
          <span class="spin">⚙️</span>
          <span>${escH(t('workstream.loadingSuggestions') || 'Analyse des participants et génération de l\'ordre du jour...')}</span>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 20px; border-top:1px solid var(--card-border); background:var(--card-bg-alt); flex-shrink:0; flex-wrap:wrap; gap:8px;" id="prep-briefing-footer">
        <button type="button" class="btn btn-secondary" id="btn-copy-agenda" style="font-size:0.8rem; padding:6px 12px;" title="${escA(t('workstream.copyAgenda') || 'Copy Agenda')}">
          ${getWsIcon('copy', 13)} ${escH(t('workstream.copyAgenda') || 'Copier')}
        </button>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn btn-secondary" id="btn-inject-planner-desc" style="font-size:0.8rem; padding:6px 12px;" title="${escA(t('workstream.injectPlannerDesc') || 'Inject into Planner Description')}">
            ${getWsIcon('calendar', 13)} ${escH(t('workstream.injectPlannerDesc') || 'Description Planner')}
          </button>
          <button type="button" class="btn btn-primary" id="btn-inject-prep-note" style="font-size:0.8rem; padding:6px 14px; font-weight:600;" title="${escA(t('workstream.injectPrepNote') || 'Inject into Prep Note')}">
            ${getWsIcon('fileText', 13)} ${escH(t('workstream.injectPrepNote') || 'Créer / Mettre à jour Note de Prep')}
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#close-prep-briefing-modal')?.addEventListener('click', closeModal);

  const bodyEl = overlay.querySelector('#prep-briefing-body');

  let briefingData = null;
  try {
    if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.generateMeetingAgendaWithAI) {
      briefingData = await WorkstreamMemoryEngine.generateMeetingAgendaWithAI(topicName, meetingEvent);
    }
  } catch (e) {
    console.error('Error generating agenda briefing:', e);
  }

  if (!briefingData || !bodyEl) {
    if (bodyEl) bodyEl.innerHTML = `<div style="color:#ef4444; font-size:0.85rem;">Impossible de générer le briefing de réunion.</div>`;
    return;
  }

  bodyEl.innerHTML = `
    <div style="background:var(--card-bg-alt); border:1px solid var(--card-border); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:6px;">
      <div style="font-weight:700; font-size:0.95rem; color:var(--text); display:flex; align-items:center; gap:6px;">${getWsIcon('calendar', 14)} ${escH(meetingEvent.title || briefingData.title)}</div>
      <div style="font-size:0.78rem; color:var(--text-muted);">
        <span>${escH(meetingEvent.date || briefingData.date)} (${escH(meetingEvent.startTime || '')} - ${escH(meetingEvent.endTime || '')})</span> ·
        <span>Participants: <strong>${(briefingData.participants || []).join(', ') || 'Équipe'}</strong></span>
      </div>
    </div>

    <!-- Objective -->
    <div style="display:flex; flex-direction:column; gap:4px;">
      <label style="font-size:0.78rem; font-weight:700; color:var(--accent); display:flex; align-items:center; gap:5px;">${getWsIcon('target', 14)} Objectif de la réunion :</label>
      <div style="font-size:0.86rem; color:var(--text); background:rgba(99,102,241,0.06); padding:8px 12px; border-radius:6px; border:1px solid rgba(99,102,241,0.2);">
        ${escH(briefingData.objective || 'Alignement stratégique')}
      </div>
    </div>

    <!-- Talking Points -->
    <div style="display:flex; flex-direction:column; gap:6px;">
      <label style="font-size:0.78rem; font-weight:700; color:var(--text); display:flex; align-items:center; gap:5px;">${getWsIcon('list', 14)} Ordre du jour & Points à aborder :</label>
      <div style="display:flex; flex-direction:column; gap:4px;">
        ${(briefingData.talkingPoints || []).map(p => `
          <div style="display:flex; align-items:flex-start; gap:8px; font-size:0.84rem; color:var(--text); line-height:1.4;">
            <span style="color:var(--accent); font-weight:700;">•</span>
            <span>${escH(p)}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Decisions to Validate -->
    ${Array.isArray(briefingData.decisionsToValidate) && briefingData.decisionsToValidate.length > 0 ? `
      <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">
        <label style="font-size:0.78rem; font-weight:700; color:#10b981; display:flex; align-items:center; gap:5px;">${getWsIcon('decision', 14)} Décisions & Arbitrages à trancher :</label>
        <div style="display:flex; flex-direction:column; gap:4px;">
          ${briefingData.decisionsToValidate.map(d => `
            <div style="display:flex; align-items:flex-start; gap:8px; font-size:0.84rem; color:var(--text); line-height:1.4;">
              <span style="color:#10b981; font-weight:700;">✓</span>
              <span>${escH(d)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <!-- Risks & Blockers -->
    ${Array.isArray(briefingData.criticalTasksOrRisks) && briefingData.criticalTasksOrRisks.length > 0 ? `
      <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">
        <label style="font-size:0.78rem; font-weight:700; color:#f59e0b; display:flex; align-items:center; gap:5px;">${getWsIcon('alertTriangle', 14)} Points de vigilance & Risques :</label>
        <div style="display:flex; flex-direction:column; gap:4px;">
          ${briefingData.criticalTasksOrRisks.map(r => `
            <div style="display:flex; align-items:flex-start; gap:8px; font-size:0.84rem; color:var(--text); line-height:1.4;">
              <span style="color:#f59e0b; font-weight:700;">!</span>
              <span>${escH(r)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;

  // Action: Copy Agenda
  overlay.querySelector('#btn-copy-agenda')?.addEventListener('click', () => {
    const agendaText = `Ordre du Jour : ${meetingEvent.title || 'Réunion'}
Objectif : ${briefingData.objective}

Points à aborder :
${(briefingData.talkingPoints || []).map((p, i) => `${i+1}. ${p}`).join('\n')}

Décisions à trancher :
${(briefingData.decisionsToValidate || []).map(d => `- ${d}`).join('\n')}
`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(agendaText);
      toast(t('common.copied') || 'Ordre du jour copié !');
    }
  });

  // Action: Inject into Planner Description
  overlay.querySelector('#btn-inject-planner-desc')?.addEventListener('click', async () => {
    const agendaDesc = `🎯 Objectif : ${briefingData.objective}\n\n📋 Ordre du jour :\n${(briefingData.talkingPoints || []).map((p, i) => `${i+1}. ${p}`).join('\n')}`;
    meetingEvent.description = (meetingEvent.description ? meetingEvent.description + '\n\n' : '') + agendaDesc;
    if (typeof savePlanner === 'function') await savePlanner();
    else if (typeof StorageAPI !== 'undefined' && StorageAPI.writePlanner) await StorageAPI.writePlanner({ events: plannerEvents });
    toast(t('workstream.agendaInjectedToast') || 'Description du Planner mise à jour !');
    closeModal();
  });

  // Action: Inject into Prep Note
  overlay.querySelector('#btn-inject-prep-note')?.addEventListener('click', async () => {
    const prepNoteHtml = `<h1>Prep : ${escH(meetingEvent.title || 'Réunion')}</h1>
<p><strong>Workstream :</strong> ${escH(topicName)}</p>
<p><strong>Date & Heure :</strong> ${escH(meetingEvent.date || '')} (${escH(meetingEvent.startTime || '')} - ${escH(meetingEvent.endTime || '')})</p>
<p><strong>Participants :</strong> ${escH((briefingData.participants || []).join(', ') || 'Équipe')}</p>

<h2>🎯 Objectif Principal</h2>
<p>${escH(briefingData.objective)}</p>

<h2>📋 Ordre du Jour & Sujets à aborder</h2>
<ul>
  ${(briefingData.talkingPoints || []).map(p => `<li>${escH(p)}</li>`).join('\n  ')}
</ul>

<h2>⚖️ Décisions & Arbitrages à valider</h2>
<ul>
  ${(briefingData.decisionsToValidate || []).map(d => `<li>${escH(d)}</li>`).join('\n  ')}
</ul>

<h2>⚠️ Points de vigilance</h2>
<ul>
  ${(briefingData.criticalTasksOrRisks || []).map(r => `<li>${escH(r)}</li>`).join('\n  ')}
</ul>

<h2>📝 Notes de séance & Conclusions</h2>
<p><em>Prise de notes en direct...</em></p>
`;

    const noteId = (typeof generateNoteId === 'function') ? generateNoteId() : ('note-' + Date.now());
    const notePath = (typeof getCanonicalNotePath === 'function') ? getCanonicalNotePath(noteId) : `raw/notes/${noteId}.html`;

    const noteEntry = {
      id: noteId,
      path: notePath,
      title: `Prep : ${meetingEvent.title || 'Réunion'}`,
      date: meetingEvent.date || new Date().toISOString().slice(0, 10),
      group_tags: [],
      major_topic_tags: [topicName],
      topic_tags: ['Prep', 'Réunion'],
      summary: `<p>Préparation de réunion : ${briefingData.objective}</p>`,
      mainHTML: prepNoteHtml,
      modified: new Date().toISOString()
    };

    try {
      if (typeof StorageAPI !== 'undefined' && StorageAPI.writeNoteContent) {
        await StorageAPI.writeNoteContent(notePath, prepNoteHtml);
      }
      if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
        manifest.unshift(noteEntry);
        if (typeof StorageAPI !== 'undefined' && StorageAPI.writeManifest) {
          await StorageAPI.writeManifest(manifest);
        }
      }

      // Link to planner event
      meetingEvent.noteId = noteId;
      meetingEvent.linkedNoteIds = [noteId];
      if (typeof savePlanner === 'function') await savePlanner();
      else if (typeof StorageAPI !== 'undefined' && StorageAPI.writePlanner) await StorageAPI.writePlanner({ events: plannerEvents });

      toast(t('workstream.agendaInjectedToast') || 'Note de préparation créée et liée à la réunion !');
      closeModal();

      // Open note overlay
      if (typeof openNoteOverlay === 'function') {
        openNoteOverlay(notePath);
      }
    } catch (err) {
      toast(`Erreur création note : ${err.message || err}`, true);
    }
  });
}

// ── Schedule Meeting Modal ──

async function openScheduleMeetingModal(suggestion, topicName) {
  const existing = document.getElementById('modal-schedule-ws-meeting');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-schedule-ws-meeting';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';

  const closeModal = () => {
    document.removeEventListener('keydown', handleEsc);
    overlay.remove();
  };

  const handleEsc = (e) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', handleEsc);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  const toMins = (tStr) => {
    if (typeof timeToMinutes === 'function') return timeToMinutes(tStr);
    const parts = String(tStr || '').split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  };

  const toTimeStr = (mins) => {
    if (typeof minutesToTime === 'function') return minutesToTime(mins);
    const clamped = Math.max(0, Math.min(1439, Math.round(mins)));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const formatDisplayDate = (dStr) => {
    try {
      const d = new Date(dStr + 'T00:00:00');
      const lang = (typeof settings !== 'undefined' && settings?.language) || 'fr';
      return d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' });
    } catch (_e) {
      return dStr;
    }
  };

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getDay() === 6) tomorrow.setDate(tomorrow.getDate() + 2);
  else if (tomorrow.getDay() === 0) tomorrow.setDate(tomorrow.getDate() + 1);

  const todayStr = today.toISOString().slice(0, 10);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  let currentDateStr = tomorrowStr;

  let durationMins = parseInt(suggestion?.durationMinutes, 10) || 30;
  let currentStartMins = 600; // 10:00 default
  let hasPrep = false;
  let prepDurationMins = 30;

  // Try finding an initial free slot
  if (typeof PlannerEngine !== 'undefined' && typeof PlannerEngine.findAvailableGaps === 'function') {
    const gaps = PlannerEngine.findAvailableGaps(currentDateStr);
    if (gaps && gaps.length > 0) {
      currentStartMins = toMins(gaps[0].startTime || '10:00');
    }
  }

  overlay.innerHTML = `
    <div class="modal-card" style="background:var(--card-bg); color:var(--text); border:1px solid var(--card-border); border-radius:14px; width:100%; max-width:880px; max-height:92vh; box-shadow:var(--shadow-lg); display:flex; flex-direction:column; overflow:hidden;">
      <!-- Header -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid var(--card-border); flex-shrink:0;">
        <h3 style="margin:0; font-size:1.05rem; font-weight:700; color:var(--text); display:flex; align-items:center; gap:8px;">
          <span>${getWsIcon('calendar', 16)}</span> <span>${escH(t('workstream.scheduleInPlanner') || 'Planifier dans le Planner')}</span>
        </h3>
        <button type="button" class="btn-icon" id="close-schedule-modal" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.2rem; padding:4px 8px;" title="${escA(t('common.close') || 'Fermer')}">✕</button>
      </div>

      <!-- Body: 2 Columns (Form & Calendar Visualizer) -->
      <div style="flex:1; overflow-y:auto; padding:18px 20px; display:grid; grid-template-columns: 1.15fr 1fr; gap:18px;">
        
        <!-- Left: Form Controls -->
        <div style="display:flex; flex-direction:column; gap:12px;">
          
          <!-- Title -->
          <div style="display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:0.78rem; font-weight:600; color:var(--text-muted);">${escH(t('editor.title') || 'Titre de la réunion')} :</label>
            <input type="text" id="sch-title" class="field-input" style="width:100%; padding:8px 10px; font-size:0.85rem; border-radius:6px; border:1px solid var(--card-border);" value="${escA(suggestion?.title || `Point : ${topicName}`)}">
          </div>

          <!-- Date Navigation -->
          <div style="display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <label style="font-size:0.78rem; font-weight:600; color:var(--text-muted);">${escH(t('editor.date') || 'Date')} :</label>
              <div style="display:flex; gap:4px;">
                <button type="button" class="btn btn-secondary btn-quick-date" data-date="${todayStr}" style="font-size:0.72rem; padding:2px 7px;" title="${escA(t('planner.todayTooltip') || 'Aujourd\'hui')}">${escH(t('planner.today') || 'Aujourd\'hui')}</button>
                <button type="button" class="btn btn-secondary btn-quick-date" data-date="${tomorrowStr}" style="font-size:0.72rem; padding:2px 7px;" title="${escA(t('planner.tomorrowTooltip') || 'Demain')}">${escH(t('planner.tomorrow') || 'Demain')}</button>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <button type="button" class="btn btn-secondary" id="btn-date-prev" style="padding:7px 10px; font-size:0.85rem;" title="${escA(t('planner.prevDayTooltip') || 'Précédent')}">◀</button>
              <input type="date" id="sch-date" class="field-input" style="flex:1; padding:7px 10px; font-size:0.85rem; border-radius:6px; border:1px solid var(--card-border);" value="${escA(currentDateStr)}">
              <button type="button" class="btn btn-secondary" id="btn-date-next" style="padding:7px 10px; font-size:0.85rem;" title="${escA(t('planner.nextDayTooltip') || 'Suivant')}">▶</button>
            </div>
          </div>

          <!-- Time & Duration -->
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div style="display:flex; flex-direction:column; gap:4px;">
              <label style="font-size:0.78rem; font-weight:600; color:var(--text-muted);">${escH(t('planner.startTime') || 'Heure de début')} :</label>
              <input type="time" id="sch-time" class="field-input" style="padding:7px 10px; font-size:0.85rem; border-radius:6px; border:1px solid var(--card-border);" value="${toTimeStr(currentStartMins)}">
            </div>
            <div style="display:flex; flex-direction:column; gap:4px;">
              <label style="font-size:0.78rem; font-weight:600; color:var(--text-muted);">${escH(t('planner.durationLabel') || 'Durée')} :</label>
              <select id="sch-duration" class="field-input" style="padding:7px 10px; font-size:0.85rem; border-radius:6px; border:1px solid var(--card-border);">
                <option value="15" ${durationMins === 15 ? 'selected' : ''}>15 min</option>
                <option value="30" ${durationMins === 30 ? 'selected' : ''}>30 min</option>
                <option value="45" ${durationMins === 45 ? 'selected' : ''}>45 min</option>
                <option value="60" ${durationMins === 60 ? 'selected' : ''}>1h (60 min)</option>
                <option value="90" ${durationMins === 90 ? 'selected' : ''}>1h30 (90 min)</option>
              </select>
            </div>
          </div>

          <!-- Add Preparation Session Option -->
          <div style="background:var(--card-bg-alt); border:1px solid var(--card-border); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:8px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.84rem; font-weight:600; color:var(--text); margin:0;">
              <input type="checkbox" id="sch-prep-toggle" style="accent-color:var(--accent); cursor:pointer; width:15px; height:15px;">
              <span style="display:inline-flex; align-items:center; gap:5px;">
                ${getWsIcon('sparkles', 13)}
                <span>${escH(t('workstream.addPrepBefore') || 'Ajouter une préparation avant')}</span>
              </span>
            </label>
            <div id="sch-prep-options" style="display:none; align-items:center; justify-content:space-between; gap:8px; padding-top:4px; border-top:1px dashed var(--card-border); font-size:0.78rem;">
              <span style="color:var(--text-muted);">${escH(t('workstream.prepDuration') || 'Durée de préparation')} :</span>
              <div style="display:flex; gap:4px;">
                <button type="button" class="btn btn-secondary btn-prep-dur ${prepDurationMins === 15 ? 'btn-primary' : ''}" data-mins="15" style="padding:2px 8px; font-size:0.75rem;" title="${escA(t('planner.duration15m') || '15 min')}">15 min</button>
                <button type="button" class="btn btn-secondary btn-prep-dur ${prepDurationMins === 30 ? 'btn-primary' : ''}" data-mins="30" style="padding:2px 8px; font-size:0.75rem;" title="${escA(t('planner.duration30m') || '30 min')}">30 min</button>
                <button type="button" class="btn btn-secondary btn-prep-dur ${prepDurationMins === 45 ? 'btn-primary' : ''}" data-mins="45" style="padding:2px 8px; font-size:0.75rem;" title="${escA(t('planner.duration45m') || '45 min')}">45 min</button>
              </div>
            </div>
          </div>

          <!-- Suggested Available Slots -->
          <div style="display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:0.75rem; font-weight:600; color:var(--text-muted);">${escH(t('workstream.freeSlots') || 'Créneaux libres suggérés')} :</label>
            <div id="sch-free-slots-chips" style="display:flex; flex-wrap:wrap; gap:6px; min-height:26px;"></div>
          </div>

          <!-- Participants -->
          <div style="display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:0.78rem; font-weight:600; color:var(--text-muted);">${escH(t('planner.withWhom') || 'Participants')} :</label>
            <input type="text" id="sch-participants" class="field-input" style="width:100%; padding:7px 10px; font-size:0.82rem; border-radius:6px; border:1px solid var(--card-border);" value="${escA((suggestion?.targetParticipants || []).join(', '))}" placeholder="Ex: Alice, Bob">
          </div>

          <!-- Agenda / Notes -->
          <div style="display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:0.78rem; font-weight:600; color:var(--text-muted);">${escH(t('todo.description') || 'Ordre du jour proposé')} :</label>
            <textarea id="sch-agenda" class="field-input" style="width:100%; min-height:64px; padding:7px 10px; font-size:0.8rem; border-radius:6px; border:1px solid var(--card-border); line-height:1.4;">${escH(Array.isArray(suggestion?.agenda) ? suggestion.agenda.join('\n') : (suggestion?.reason || ''))}</textarea>
          </div>
        </div>

        <!-- Right: Day Calendar Visualizer & Drag-Drop Timeline -->
        <div style="display:flex; flex-direction:column; gap:6px; background:var(--card-bg-alt); border:1px solid var(--card-border); border-radius:10px; padding:12px; min-height:420px; overflow:hidden;">
          
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--card-border); padding-bottom:8px;">
            <div style="font-weight:700; font-size:0.86rem; color:var(--text); display:flex; align-items:center; gap:6px;">
              <span>${getWsIcon('calendar', 14)}</span>
              <span id="sch-visualizer-date-title">${escH(formatDisplayDate(currentDateStr))}</span>
            </div>
            <span style="font-size:0.72rem; color:var(--text-muted); font-style:italic;">${escH(t('workstream.dragDropHint') || 'Glissez pour déplacer')}</span>
          </div>

          <!-- Collision Warning Indicator -->
          <div id="sch-collision-warning" style="display:none; padding:4px 8px; border-radius:6px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); color:#ef4444; font-size:0.75rem; font-weight:600; align-items:center; gap:6px;">
            <span>⚠️</span> <span id="sch-collision-text">${escH(t('workstream.timeConflictWarning') || 'Chevauchement avec un événement')}</span>
          </div>

          <!-- Timeline Container (08:00 to 19:30) -->
          <div id="sch-timeline-wrapper" style="flex:1; position:relative; overflow-y:auto; max-height:430px; user-select:none; border-radius:6px; background:var(--card-bg); border:1px solid var(--card-border);">
            <div id="sch-timeline-canvas" style="position:relative; width:100%; height:550px; min-height:550px;">
              <!-- Grid lines & hours will be dynamically drawn -->
              <div id="sch-grid-lines" style="position:absolute; top:0; left:0; right:0; bottom:0; pointer-events:none;"></div>
              
              <!-- Existing events container -->
              <div id="sch-existing-events" style="position:absolute; top:0; left:52px; right:6px; bottom:0; pointer-events:none;"></div>

              <!-- Proposed Prep Block -->
              <div id="sch-proposed-prep" style="display:none; position:absolute; left:56px; right:10px; background:rgba(245,158,11,0.18); border:1.5px dashed #f59e0b; border-radius:6px; color:#f59e0b; padding:4px 8px; font-size:0.75rem; font-weight:700; z-index:5; box-sizing:border-box; transition:top 0.05s linear, height 0.05s linear; pointer-events:none;">
                <div style="display:flex; align-items:center; gap:4px;">
                  <span>${getWsIcon('sparkles', 12)}</span>
                  <span>Prep (<span id="sch-prep-time-badge"></span>)</span>
                </div>
              </div>

              <!-- Proposed Meeting Block (Draggable) -->
              <div id="sch-proposed-meeting" style="position:absolute; left:54px; right:8px; background:color-mix(in srgb, var(--accent) 22%, var(--card-bg)); border:2px solid var(--accent); border-radius:8px; color:var(--text); padding:6px 10px; font-size:0.8rem; z-index:10; box-shadow:var(--shadow-md); cursor:grab; box-sizing:border-box; touch-action:none;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                  <span id="sch-meeting-title-badge" style="font-weight:700; color:var(--accent); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:5px;">
                    ${getWsIcon('calendar', 13)} <span class="badge-text"></span>
                  </span>
                  <span id="sch-meeting-time-badge" class="badge" style="font-size:0.7rem; padding:1px 6px; background:var(--accent); color:#fff; font-weight:600; flex-shrink:0;"></span>
                </div>
                <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px; display:flex; align-items:center; gap:4px;">
                  <span>⇅ ${escH(t('workstream.dragDropHint') || 'Glisser pour déplacer')}</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- Footer -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 20px; border-top:1px solid var(--card-border); background:var(--card-bg-alt); flex-shrink:0;">
        <div style="font-size:0.78rem; color:var(--text-muted);" id="sch-summary-hint">
          <span id="sch-summary-time"></span>
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn btn-secondary" id="btn-cancel-schedule" style="font-size:0.8rem; padding:6px 14px;" title="${escA(t('common.cancel') || 'Cancel')}">${escH(t('common.cancel') || 'Cancel')}</button>
          <button type="button" class="btn btn-primary" id="btn-confirm-schedule" style="font-size:0.8rem; padding:6px 18px; font-weight:600;" title="${escA(t('workstream.scheduleInPlanner') || 'Schedule in Planner')}">
            ${getWsIcon('calendar', 13)} ${escH(t('workstream.scheduleInPlanner') || 'Planifier dans le Planner')}
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Timeline configuration: 08:00 (480) to 20:00 (1200) = 720 minutes
  const TIMELINE_START_MINS = 480; // 08:00
  const TIMELINE_END_MINS = 1200;  // 20:00
  const TIMELINE_TOTAL_MINS = TIMELINE_END_MINS - TIMELINE_START_MINS;
  const CANVAS_HEIGHT = 550;

  const minToY = (mins) => {
    const clamped = Math.max(TIMELINE_START_MINS, Math.min(TIMELINE_END_MINS, mins));
    return ((clamped - TIMELINE_START_MINS) / TIMELINE_TOTAL_MINS) * CANVAS_HEIGHT;
  };

  const yToMins = (y) => {
    const ratio = Math.max(0, Math.min(1, y / CANVAS_HEIGHT));
    const raw = TIMELINE_START_MINS + ratio * TIMELINE_TOTAL_MINS;
    // Snap to 15 minutes
    return Math.round(raw / 15) * 15;
  };

  // Draw background grid lines (every 60 min and 30 min)
  const gridLinesEl = overlay.querySelector('#sch-grid-lines');
  if (gridLinesEl) {
    gridLinesEl.innerHTML = '';
    for (let m = TIMELINE_START_MINS; m <= TIMELINE_END_MINS; m += 30) {
      const y = minToY(m);
      const isHour = m % 60 === 0;
      const row = document.createElement('div');
      row.style.cssText = `position:absolute; top:${y}px; left:0; right:0; height:1px; background:${isHour ? 'var(--card-border)' : 'rgba(255,255,255,0.04)'}; display:flex; align-items:center;`;
      if (isHour) {
        row.innerHTML = `<span style="position:absolute; left:6px; top:-8px; font-size:0.68rem; font-weight:600; color:var(--text-muted); font-variant-numeric:tabular-nums;">${toTimeStr(m)}</span>`;
      }
      gridLinesEl.appendChild(row);
    }
  }

  // DOM Elements
  const dateInput = overlay.querySelector('#sch-date');
  const timeInput = overlay.querySelector('#sch-time');
  const durationSelect = overlay.querySelector('#sch-duration');
  const prepToggle = overlay.querySelector('#sch-prep-toggle');
  const prepOptionsWrap = overlay.querySelector('#sch-prep-options');
  const titleInput = overlay.querySelector('#sch-title');
  const freeChipsContainer = overlay.querySelector('#sch-free-slots-chips');
  const existingEventsEl = overlay.querySelector('#sch-existing-events');
  const proposedMeetingEl = overlay.querySelector('#sch-proposed-meeting');
  const proposedPrepEl = overlay.querySelector('#sch-proposed-prep');
  const collisionWarningEl = overlay.querySelector('#sch-collision-warning');
  const collisionTextEl = overlay.querySelector('#sch-collision-text');
  const summaryTimeEl = overlay.querySelector('#sch-summary-time');
  const visualizerDateTitle = overlay.querySelector('#sch-visualizer-date-title');
  const canvasEl = overlay.querySelector('#sch-timeline-canvas');
  const timelineWrapper = overlay.querySelector('#sch-timeline-wrapper');

  // Render & Sync function
  const updateVisualizerAndState = () => {
    currentDateStr = dateInput?.value || currentDateStr;
    const timeVal = timeInput?.value || '10:00';
    currentStartMins = toMins(timeVal);
    durationMins = parseInt(durationSelect?.value, 10) || 30;
    hasPrep = !!prepToggle?.checked;

    if (visualizerDateTitle) {
      visualizerDateTitle.textContent = formatDisplayDate(currentDateStr);
    }

    // Existing events for this day
    const rawEvents = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) ? plannerEvents : [];
    const dayEvts = rawEvents.filter(e => e && e.date === currentDateStr && !(e.type === 'ooo' && e.allDay));

    if (existingEventsEl) {
      existingEventsEl.innerHTML = '';
      dayEvts.forEach(evt => {
        const evStart = toMins(evt.startTime || '09:00');
        const evEnd = toMins(evt.endTime || toTimeStr(evStart + 30));
        if (evEnd <= TIMELINE_START_MINS || evStart >= TIMELINE_END_MINS) return;

        const topY = minToY(evStart);
        const botY = minToY(evEnd);
        const height = Math.max(18, botY - topY);

        const evBox = document.createElement('div');
        evBox.style.cssText = `position:absolute; top:${topY}px; height:${height}px; left:0; right:0; background:rgba(255,255,255,0.06); border:1px solid var(--card-border); border-radius:6px; padding:2px 8px; font-size:0.72rem; color:var(--text-muted); overflow:hidden; box-sizing:border-box; display:flex; align-items:center; justify-content:space-between; opacity:0.85;`;
        evBox.innerHTML = `
          <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600;">${escH(evt.title || 'Événement')}</span>
          <span style="font-size:0.65rem; font-variant-numeric:tabular-nums; flex-shrink:0; opacity:0.8;">${escH(evt.startTime || '')} - ${escH(evt.endTime || '')}</span>
        `;
        existingEventsEl.appendChild(evBox);
      });
    }

    // Position Proposed Meeting Block
    const meetingEndMins = currentStartMins + durationMins;
    const meetingTopY = minToY(currentStartMins);
    const meetingBotY = minToY(meetingEndMins);
    const meetingHeight = Math.max(26, meetingBotY - meetingTopY);

    if (proposedMeetingEl) {
      proposedMeetingEl.style.top = `${meetingTopY}px`;
      proposedMeetingEl.style.height = `${meetingHeight}px`;
      
      const badgeText = proposedMeetingEl.querySelector('.badge-text');
      if (badgeText) badgeText.textContent = titleInput?.value || `Point : ${topicName}`;
      
      const timeBadge = proposedMeetingEl.querySelector('#sch-meeting-time-badge');
      if (timeBadge) timeBadge.textContent = `${toTimeStr(currentStartMins)} - ${toTimeStr(meetingEndMins)}`;
    }

    // Position Proposed Prep Block
    if (hasPrep && proposedPrepEl) {
      const prepStartMins = currentStartMins - prepDurationMins;
      const prepTopY = minToY(prepStartMins);
      const prepBotY = minToY(currentStartMins);
      const prepHeight = Math.max(20, prepBotY - prepTopY);

      proposedPrepEl.style.display = 'block';
      proposedPrepEl.style.top = `${prepTopY}px`;
      proposedPrepEl.style.height = `${prepHeight}px`;

      const prepBadge = proposedPrepEl.querySelector('#sch-prep-time-badge');
      if (prepBadge) prepBadge.textContent = `${toTimeStr(prepStartMins)} - ${toTimeStr(currentStartMins)}`;
    } else if (proposedPrepEl) {
      proposedPrepEl.style.display = 'none';
    }

    // Check Collisions
    const totalSlotStart = hasPrep ? (currentStartMins - prepDurationMins) : currentStartMins;
    const totalSlotEnd = meetingEndMins;

    const collidingEvt = dayEvts.find(ev => {
      const s = toMins(ev.startTime);
      const e = toMins(ev.endTime);
      return totalSlotStart < e && totalSlotEnd > s;
    });

    if (collidingEvt && collisionWarningEl) {
      collisionWarningEl.style.display = 'flex';
      if (collisionTextEl) {
        collisionTextEl.textContent = `${t('workstream.timeConflictWarning') || 'Chevauchement avec'} : "${collidingEvt.title || 'Événement'}" (${collidingEvt.startTime} - ${collidingEvt.endTime})`;
      }
      if (proposedMeetingEl) proposedMeetingEl.style.borderColor = '#ef4444';
    } else {
      if (collisionWarningEl) collisionWarningEl.style.display = 'none';
      if (proposedMeetingEl) proposedMeetingEl.style.borderColor = 'var(--accent)';
    }

    // Summary hint
    if (summaryTimeEl) {
      if (hasPrep) {
        summaryTimeEl.innerHTML = `✨ <strong>Prep :</strong> ${toTimeStr(totalSlotStart)} - ${toTimeStr(currentStartMins)} (${prepDurationMins} min) &nbsp;|&nbsp; 📅 <strong>Réunion :</strong> ${toTimeStr(currentStartMins)} - ${toTimeStr(meetingEndMins)} (${durationMins} min)`;
      } else {
        summaryTimeEl.innerHTML = `📅 <strong>Réunion :</strong> ${toTimeStr(currentStartMins)} - ${toTimeStr(meetingEndMins)} (${durationMins} min)`;
      }
    }

    // Render Free Slots Chips
    if (freeChipsContainer) {
      freeChipsContainer.innerHTML = '';
      const neededSpan = durationMins + (hasPrep ? prepDurationMins : 0);
      const freeSlots = [];
      
      for (let s = 540; s + neededSpan <= 1110 && freeSlots.length < 5; s += 30) {
        const e = s + neededSpan;
        const overlap = dayEvts.some(ev => {
          const evS = toMins(ev.startTime);
          const evE = toMins(ev.endTime);
          return s < evE && e > evS;
        });
        if (!overlap) {
          const meetingStart = hasPrep ? s + prepDurationMins : s;
          freeSlots.push(meetingStart);
        }
      }

      if (freeSlots.length > 0) {
        freeSlots.forEach(sMins => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'btn btn-secondary';
          chip.style.cssText = 'font-size:0.72rem; padding:2px 8px; font-weight:600;';
          chip.title = `${t('planner.suggestionTimeTooltip') || 'Choisir ce créneau'}: ${toTimeStr(sMins)}`;
          chip.textContent = toTimeStr(sMins);
          chip.addEventListener('click', () => {
            timeInput.value = toTimeStr(sMins);
            updateVisualizerAndState();
          });
          freeChipsContainer.appendChild(chip);
        });
      } else {
        freeChipsContainer.innerHTML = `<span style="font-size:0.72rem; color:var(--text-muted); font-style:italic;">${escH(t('workstream.noFreeSlotsFound') || 'Aucun créneau libre évident trouvé')}</span>`;
      }
    }
  };

  // Drag and Drop Logic on Proposed Meeting
  let isDragging = false;
  let dragStartY = 0;
  let dragStartMins = 0;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    dragStartY = e.clientY;
    dragStartMins = currentStartMins;
    if (proposedMeetingEl) {
      proposedMeetingEl.setPointerCapture(e.pointerId);
      proposedMeetingEl.style.cursor = 'grabbing';
      proposedMeetingEl.style.opacity = '0.92';
    }
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    const deltaY = e.clientY - dragStartY;
    const deltaMins = (deltaY / CANVAS_HEIGHT) * TIMELINE_TOTAL_MINS;
    let newStartMins = Math.round((dragStartMins + deltaMins) / 15) * 15;

    // Bounds check
    const minBound = hasPrep ? (TIMELINE_START_MINS + prepDurationMins) : TIMELINE_START_MINS;
    const maxBound = TIMELINE_END_MINS - durationMins;
    newStartMins = Math.max(minBound, Math.min(maxBound, newStartMins));

    if (newStartMins !== currentStartMins) {
      currentStartMins = newStartMins;
      if (timeInput) timeInput.value = toTimeStr(currentStartMins);
      updateVisualizerAndState();
    }
  };

  const onPointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;
    if (proposedMeetingEl) {
      try { proposedMeetingEl.releasePointerCapture(e.pointerId); } catch (_e) {}
      proposedMeetingEl.style.cursor = 'grab';
      proposedMeetingEl.style.opacity = '1';
    }
    updateVisualizerAndState();
  };

  proposedMeetingEl?.addEventListener('pointerdown', onPointerDown);
  proposedMeetingEl?.addEventListener('pointermove', onPointerMove);
  proposedMeetingEl?.addEventListener('pointerup', onPointerUp);
  proposedMeetingEl?.addEventListener('pointercancel', onPointerUp);

  // Click on empty space in canvas to move meeting
  canvasEl?.addEventListener('click', (e) => {
    if (isDragging) return;
    if (e.target.closest('#sch-proposed-meeting')) return;
    const rect = canvasEl.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    let clickedMins = yToMins(clickY);

    const minBound = hasPrep ? (TIMELINE_START_MINS + prepDurationMins) : TIMELINE_START_MINS;
    const maxBound = TIMELINE_END_MINS - durationMins;
    clickedMins = Math.max(minBound, Math.min(maxBound, clickedMins));

    if (timeInput) timeInput.value = toTimeStr(clickedMins);
    updateVisualizerAndState();
  });

  // Event Listeners for inputs
  dateInput?.addEventListener('change', updateVisualizerAndState);
  timeInput?.addEventListener('input', updateVisualizerAndState);
  durationSelect?.addEventListener('change', updateVisualizerAndState);
  titleInput?.addEventListener('input', () => {
    const badgeText = proposedMeetingEl?.querySelector('.badge-text');
    if (badgeText) badgeText.textContent = titleInput?.value || `Point : ${topicName}`;
  });

  prepToggle?.addEventListener('change', () => {
    if (prepOptionsWrap) {
      prepOptionsWrap.style.display = prepToggle.checked ? 'flex' : 'none';
    }
    updateVisualizerAndState();
  });

  overlay.querySelectorAll('.btn-prep-dur').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.btn-prep-dur').forEach(b => {
        b.classList.remove('btn-primary');
        b.classList.add('btn-secondary');
      });
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-secondary');
      prepDurationMins = parseInt(btn.getAttribute('data-mins'), 10) || 30;
      updateVisualizerAndState();
    });
  });

  // Quick Date Buttons
  overlay.querySelectorAll('.btn-quick-date').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.getAttribute('data-date');
      if (d && dateInput) {
        dateInput.value = d;
        updateVisualizerAndState();
      }
    });
  });

  overlay.querySelector('#btn-date-prev')?.addEventListener('click', () => {
    if (!dateInput) return;
    const d = new Date(dateInput.value + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    dateInput.value = d.toISOString().slice(0, 10);
    updateVisualizerAndState();
  });

  overlay.querySelector('#btn-date-next')?.addEventListener('click', () => {
    if (!dateInput) return;
    const d = new Date(dateInput.value + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    dateInput.value = d.toISOString().slice(0, 10);
    updateVisualizerAndState();
  });

  overlay.querySelector('#close-schedule-modal')?.addEventListener('click', closeModal);
  overlay.querySelector('#btn-cancel-schedule')?.addEventListener('click', closeModal);

  // Initial draw & scroll timeline to active slot
  updateVisualizerAndState();
  setTimeout(() => {
    if (timelineWrapper && proposedMeetingEl) {
      const topOffset = proposedMeetingEl.offsetTop - 80;
      timelineWrapper.scrollTop = Math.max(0, topOffset);
    }
  }, 60);

  // Confirm and save to Planner
  overlay.querySelector('#btn-confirm-schedule')?.addEventListener('click', async () => {
    const title = titleInput?.value?.trim() || `Point : ${topicName}`;
    const dateStr = dateInput?.value?.trim() || currentDateStr;
    const startTime = timeInput?.value?.trim() || toTimeStr(currentStartMins);
    const partsRaw = overlay.querySelector('#sch-participants')?.value?.trim() || '';
    const agendaRaw = overlay.querySelector('#sch-agenda')?.value?.trim() || '';

    const parts = partsRaw.split(',').map(s => s.trim()).filter(Boolean);
    const startMins = toMins(startTime);
    const endTime = toTimeStr(startMins + durationMins);

    const newMeetingEvt = {
      id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: 'call',
      title: title,
      date: dateStr,
      startTime: startTime,
      endTime: endTime,
      duration: durationMins,
      description: agendaRaw,
      workstream: topicName,
      major_topic_tags: [topicName],
      collaborators: parts,
      collaboratorIds: parts
    };

    if (typeof plannerEvents === 'undefined') window.plannerEvents = [];

    // If Prep session enabled, create linked prep event
    if (hasPrep) {
      const prepStartMins = startMins - prepDurationMins;
      const prepStartTime = toTimeStr(Math.max(0, prepStartMins));
      const prepEndTime = startTime;
      const prepEvt = {
        id: 'evt-' + Date.now() + '-prep-' + Math.random().toString(36).slice(2, 6),
        type: 'prep',
        title: `Prep : ${title}`,
        date: dateStr,
        startTime: prepStartTime,
        endTime: prepEndTime,
        duration: prepDurationMins,
        description: `Session de préparation pour : ${title}\nOrdre du jour :\n${agendaRaw}`,
        workstream: topicName,
        major_topic_tags: [topicName],
        prepForEventId: newMeetingEvt.id,
        collaborators: parts,
        collaboratorIds: parts
      };

      newMeetingEvt.linkedPrepEventId = prepEvt.id;
      plannerEvents.push(prepEvt);
    }

    plannerEvents.push(newMeetingEvt);

    if (typeof savePlanner === 'function') await savePlanner();
    else if (typeof StorageAPI !== 'undefined' && StorageAPI.writePlanner) await StorageAPI.writePlanner({ events: plannerEvents });
    if (typeof renderPlanner === 'function') renderPlanner();

    // If scheduling a suggested meeting, remove it from saved suggestions
    if (suggestion && topicName && typeof getMajorTopicMemory === 'function' && typeof saveMajorTopicMemory === 'function') {
      try {
        const mem = await getMajorTopicMemory(topicName, { skipAutoArchive: true });
        if (mem && Array.isArray(mem.suggestedMeetings) && mem.suggestedMeetings.length > 0) {
          const updatedSug = mem.suggestedMeetings.filter(s => s && s.title !== suggestion.title);
          await saveMajorTopicMemory(topicName, { ...mem, suggestedMeetings: updatedSug });
        }
      } catch (_e) {}
    }

    toast(t('workstream.meetingScheduledToast') || 'Réunion planifiée avec succès dans le Planner !');
    closeModal();

    const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
    if (c && typeof renderRegisterView === 'function') renderRegisterView(c);
  });
}

// ── Post-Meeting Sync Modal ──

async function openPostMeetingSyncModal(meetingEvent, topicName) {
  const existing = document.getElementById('modal-post-meeting-sync');
  if (existing) existing.remove();

  const rawPlanner = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) ? plannerEvents : [];
  const liveEvt = rawPlanner.find(e => e && e.id === meetingEvent?.id) || meetingEvent || {};

  const overlay = document.createElement('div');
  overlay.id = 'modal-post-meeting-sync';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';

  const closeModal = () => {
    document.removeEventListener('keydown', handleEsc);
    overlay.remove();
  };

  const handleEsc = (e) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', handleEsc);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  overlay.innerHTML = `
    <div class="modal-card" style="background:var(--card-bg); color:var(--text); border:1px solid var(--card-border); border-radius:14px; width:100%; max-width:640px; max-height:88vh; box-shadow:var(--shadow-lg); display:flex; flex-direction:column; overflow:hidden;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--card-border);">
        <h3 style="margin:0; font-size:1.05rem; font-weight:700; color:var(--text); display:flex; align-items:center; gap:8px;">
          <span>${getWsIcon('download', 16)}</span> <span>${escH(t('workstream.postMeetingSyncTitle') || 'Synchronisation Post-Réunion & Mémoire (IA)')}</span>
        </h3>
        <button type="button" class="btn-icon" id="close-post-sync-modal" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.2rem;" title="${escA(t('common.close') || 'Close')}">✕</button>
      </div>

      <div style="flex:1; overflow-y:auto; padding:18px 20px; display:flex; flex-direction:column; gap:12px;" id="post-sync-body">
        <div style="font-size:0.85rem; color:var(--text-muted); font-style:italic; display:flex; align-items:center; gap:8px;">
          <span class="spin">⚙️</span>
          <span>Lecture des notes de réunion et extraction des arbitrages...</span>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:8px; padding:12px 20px; border-top:1px solid var(--card-border); background:var(--card-bg-alt);">
        <button type="button" class="btn btn-secondary" id="btn-cancel-post-sync" style="font-size:0.8rem; padding:6px 12px;" title="${escA(t('common.cancel') || 'Cancel')}">${escH(t('common.cancel') || 'Cancel')}</button>
        <button type="button" class="btn btn-primary" id="btn-apply-post-sync" style="font-size:0.8rem; padding:6px 16px; font-weight:600;" title="${escA(t('workstream.applySyncUpdates') || 'Appliquer les mises à jour')}">${getWsIcon('download', 13)} ${escH(t('workstream.applySyncUpdates') || 'Appliquer les mises à jour')}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#close-post-sync-modal')?.addEventListener('click', closeModal);
  overlay.querySelector('#btn-cancel-post-sync')?.addEventListener('click', closeModal);

  const bodyEl = overlay.querySelector('#post-sync-body');

  // Read note content with robust multi-source resolution
  const linkedData = await getMeetingLinkedNotes(liveEvt, topicName);
  let noteText = linkedData.combinedText || liveEvt.description || liveEvt.title || '';

  let syncResult = null;
  try {
    if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.syncPostMeetingWithAI) {
      syncResult = await WorkstreamMemoryEngine.syncPostMeetingWithAI(topicName, liveEvt, noteText);
    }
  } catch (e) {
    console.error('Post meeting sync error:', e);
  }

  if (!syncResult || !bodyEl) {
    if (bodyEl) bodyEl.innerHTML = `<div style="color:#ef4444; font-size:0.85rem;">Aucune note exploitable trouvée pour cette réunion.</div>`;
    return;
  }

  const resThreads = Array.isArray(syncResult.resolvedThreads) ? syncResult.resolvedThreads : [];
  const valDecisions = Array.isArray(syncResult.validatedDecisions) ? syncResult.validatedDecisions : [];
  const newFacts = Array.isArray(syncResult.newFacts) ? syncResult.newFacts : [];
  const newTasks = Array.isArray(syncResult.newTasks) ? syncResult.newTasks : [];

  const notesListHtml = linkedData.notes.length > 0
    ? `<div style="font-size:0.75rem; color:var(--text-muted); display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:4px;">
        <span style="font-weight:600;">${escH(t('workstream.linkedNotesLabel') || 'Notes liées')} :</span>
        ${linkedData.notes.map(n => `<span style="color:var(--accent); font-weight:500; display:inline-flex; align-items:center; gap:3px;">${getWsIcon('link', 11)} ${escH(n.title || n.path)}</span>`).join(', ')}
      </div>`
    : '';

  bodyEl.innerHTML = `
    <div style="font-size:0.83rem; color:var(--text-muted); line-height:1.4;">
      Voici les ajustements proposés par l'IA d'après les notes de la réunion <strong>"${escH(liveEvt.title || 'Réunion')}"</strong> :
    </div>
    ${notesListHtml}

    ${resThreads.length > 0 ? `
      <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
        <label style="font-size:0.78rem; font-weight:700; color:#10b981; display:flex; align-items:center; gap:5px;">${getWsIcon('checkSquare', 14)} Clôturer les questions résolues :</label>
        ${resThreads.map((t, idx) => `
          <label style="display:flex; align-items:center; gap:8px; font-size:0.84rem; color:var(--text); cursor:pointer;">
            <input type="checkbox" checked class="chk-sync-thread" data-index="${idx}">
            <span>${escH(t)}</span>
          </label>
        `).join('')}
      </div>
    ` : ''}

    ${valDecisions.length > 0 ? `
      <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
        <label style="font-size:0.78rem; font-weight:700; color:var(--accent); display:flex; align-items:center; gap:5px;">${getWsIcon('decision', 14)} Valider les décisions actées (Passer en active) :</label>
        ${valDecisions.map((d, idx) => `
          <label style="display:flex; align-items:center; gap:8px; font-size:0.84rem; color:var(--text); cursor:pointer;">
            <input type="checkbox" checked class="chk-sync-decision" data-index="${idx}">
            <span>${escH(d)}</span>
          </label>
        `).join('')}
      </div>
    ` : ''}

    ${newFacts.length > 0 ? `
      <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
        <label style="font-size:0.78rem; font-weight:700; color:var(--text); display:flex; align-items:center; gap:5px;">${getWsIcon('pin', 14)} Nouveaux faits marquants à ajouter :</label>
        ${newFacts.map((f, idx) => `
          <label style="display:flex; align-items:center; gap:8px; font-size:0.84rem; color:var(--text); cursor:pointer;">
            <input type="checkbox" checked class="chk-sync-fact" data-index="${idx}">
            <span>${escH(f)}</span>
          </label>
        `).join('')}
      </div>
    ` : ''}

    ${newTasks.length > 0 ? `
      <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
        <label style="font-size:0.78rem; font-weight:700; color:#f59e0b; display:flex; align-items:center; gap:5px;">${getWsIcon('checkSquare', 14)} Nouvelles tâches à créer :</label>
        ${newTasks.map((t, idx) => `
          <label style="display:flex; align-items:center; gap:8px; font-size:0.84rem; color:var(--text); cursor:pointer;">
            <input type="checkbox" checked class="chk-sync-task" data-index="${idx}">
            <span>${escH(typeof t === 'string' ? t : t.title)} ${t.assignee ? `(${escH(t.assignee)})` : ''}</span>
          </label>
        `).join('')}
      </div>
    ` : ''}
  `;

  overlay.querySelector('#btn-apply-post-sync')?.addEventListener('click', async () => {
    try {
      const memory = (typeof getMajorTopicMemory === 'function') ? await getMajorTopicMemory(topicName, { skipAutoArchive: true }) : null;
      if (memory) {
        // Apply checked threads removal
        const checkedThreads = Array.from(overlay.querySelectorAll('.chk-sync-thread:checked')).map(el => resThreads[parseInt(el.getAttribute('data-index'), 10)]);
        if (checkedThreads.length > 0 && Array.isArray(memory.openThreads)) {
          memory.openThreads = memory.openThreads.filter(t => !checkedThreads.some(ct => String(t).toLowerCase().includes(String(ct).toLowerCase()) || String(ct).toLowerCase().includes(String(t).toLowerCase())));
        }

        // Apply checked decisions promotion
        const checkedDecisions = Array.from(overlay.querySelectorAll('.chk-sync-decision:checked')).map(el => valDecisions[parseInt(el.getAttribute('data-index'), 10)]);
        if (checkedDecisions.length > 0 && Array.isArray(memory.decisions)) {
          memory.decisions = memory.decisions.map(d => {
            if (checkedDecisions.some(cd => String(d.text).toLowerCase().includes(String(cd).toLowerCase()))) {
              return { ...d, status: 'active' };
            }
            return d;
          });
        }

        // Apply new facts
        const checkedFacts = Array.from(overlay.querySelectorAll('.chk-sync-fact:checked')).map(el => newFacts[parseInt(el.getAttribute('data-index'), 10)]);
        if (checkedFacts.length > 0) {
          memory.keyFacts = [...(memory.keyFacts || []), ...checkedFacts];
        }

        if (typeof saveMajorTopicMemory === 'function') {
          await saveMajorTopicMemory(topicName, memory);
        }

        // Apply new tasks to todosManifest
        const checkedTasks = Array.from(overlay.querySelectorAll('.chk-sync-task:checked')).map(el => newTasks[parseInt(el.getAttribute('data-index'), 10)]);
        if (checkedTasks.length > 0 && typeof todosManifest !== 'undefined') {
          checkedTasks.forEach(taskObj => {
            const taskTitle = typeof taskObj === 'string' ? taskObj : taskObj.title;
            const newTodo = {
              id: 'todo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              title: taskTitle,
              completed: false,
              workstream: topicName,
              major_topic_tags: [topicName],
              owner: taskObj.assignee || '',
              dueDate: taskObj.dueDate || ''
            };
            todosManifest.push(newTodo);
          });
          if (typeof saveTodos === 'function') saveTodos();
        }

        toast(t('workstream.syncSuccessToast') || 'Mémoire du workstream mise à jour avec succès !');
        closeModal();

        const c = document.querySelector('.collab-team-layout') || document.getElementById('team-panel');
        if (c) renderRegisterView(c);
      }
    } catch (e) {
      toast(`Erreur synchronisation : ${e.message || e}`, true);
    }
  });
}



function updateDecisionStatus(decIdOrText, newStatus) {
  let found = pendingDecisionsList.find(d => (d.id && d.id === decIdOrText) || d.text === decIdOrText);
  if (found) {
    found.status = newStatus;
  } else {
    found = decisionsList.find(d => (d.id && d.id === decIdOrText) || d.text === decIdOrText);
    if (found) {
      pendingDecisionsList.unshift({ ...found, status: newStatus });
    }
  }
  if (typeof toast === 'function') {
    const statusLabels = {
      active: t('team.filterActive') || 'Active',
      proposed: t('team.filterProposed') || 'Proposée',
      superseded: t('team.filterSuperseded') || 'Remplacée'
    };
    toast(t('team.decisionStatusUpdated', { status: statusLabels[newStatus] || newStatus }) || `Statut mis à jour : ${statusLabels[newStatus] || newStatus}`);
  }
  const container = document.querySelector('.collab-team-layout');
  if (container) renderRegisterView(container);
}
window.updateDecisionStatus = updateDecisionStatus;

// Persist a status change coming from the decision kanban.
// Note-backed decisions are written to their note file(s) (source of truth) and mirrored into the
// in-memory metadata buffer so the registry reflects the change instead of overwriting it on re-render.
async function persistKanbanDecisionStatus(dec, decIdOrText, newStatus) {
  const decisionText = (dec && dec.text) ? dec.text : decIdOrText;
  const notePaths = [];
  if (dec) {
    for (const n of [...(dec.takenNotes || []), ...(dec.linkedNotes || [])]) {
      if (n && n.notePath && !notePaths.includes(n.notePath)) notePaths.push(n.notePath);
    }
    if (!notePaths.length && dec.notePath) notePaths.push(dec.notePath);
  }

  if (notePaths.length && typeof updateDecisionStatusInFile === 'function') {
    for (const p of notePaths) {
      try {
        await updateDecisionStatusInFile(p, decisionText, newStatus);
        // Mirror the change into the metadata buffer so refreshDecisionListFromMetadataIfAvailable()
        // (called at the top of renderRegisterView) surfaces the new status rather than the old one.
        const meta = (typeof getMetaByPath === 'function') ? getMetaByPath(p) : null;
        if (meta && Array.isArray(meta.decisions) && typeof upsertMeta === 'function') {
          const updated = meta.decisions.map(d =>
            String(d.text || '').trim() === String(decisionText || '').trim()
              ? { ...d, status: newStatus }
              : d);
          upsertMeta({ ...meta, decisions: updated, decisionsReady: true });
        }
      } catch (e) {
        console.error('Failed to persist decision status from kanban:', p, e);
      }
    }
    if (typeof toast === 'function') {
      const statusLabels = {
        active: t('team.filterActive') || 'Active',
        proposed: t('team.filterProposed') || 'Proposée',
        superseded: t('team.filterSuperseded') || 'Remplacée'
      };
      toast(t('team.decisionStatusUpdated', { status: statusLabels[newStatus] || newStatus }) || `Statut mis à jour : ${statusLabels[newStatus] || newStatus}`);
    }
    const container = document.querySelector('.collab-team-layout');
    if (container) renderRegisterView(container);
  } else {
    // Registry-only (non note-backed) decision: fall back to the in-memory update path.
    updateDecisionStatus(decIdOrText, newStatus);
  }
}
window.persistKanbanDecisionStatus = persistKanbanDecisionStatus;

function renderDecisionKanbanView(target, groupedProjectDecs) {
  const board = document.createElement('div');
  board.className = 'decision-kanban-board';
  board.style.cssText = 'display:flex; gap:1rem; overflow-x:auto; padding-bottom:0.5rem; width:100%; height:100%; min-height:0;';

  const columns = [
    { key: 'proposed', title: `${getWsIcon('clock', 13)} ${t('team.statusProposed') || 'Proposées / À prendre'}`, items: groupedProjectDecs.filter(d => d.status === 'proposed'), color: '#f59e0b' },
    { key: 'active', title: `${getWsIcon('check', 13)} ${t('team.statusActive') || 'Actives'}`, items: groupedProjectDecs.filter(d => d.status === 'active'), color: '#10b981' },
    { key: 'superseded', title: `${getWsIcon('undo', 13)} ${t('team.statusSuperseded') || 'Remplacées'}`, items: groupedProjectDecs.filter(d => d.status === 'superseded'), color: 'var(--text-muted)' }
  ];

  columns.forEach(col => {
    const colEl = document.createElement('div');
    colEl.className = 'decision-kanban-column';
    colEl.style.cssText = 'flex:1; min-width:260px; background:rgba(0,0,0,0.12); border-radius:10px; padding:0.75rem; border:1px solid var(--card-border); display:flex; flex-direction:column; gap:0.75rem; transition:all 0.2s ease;';

    const header = document.createElement('div');
    header.style.cssText = 'font-weight:700; font-size:0.9rem; color:var(--text); display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--card-border); padding-bottom:0.4rem; flex-shrink:0;';
    header.innerHTML = `<span style="display:inline-flex; align-items:center; gap:5px;">${col.title}</span> <span style="font-size:0.75rem; opacity:0.8; background:rgba(255,255,255,0.1); padding:1px 6px; border-radius:10px;">${col.items.length}</span>`;
    colEl.appendChild(header);

    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'decision-kanban-dropzone';
    cardsContainer.style.cssText = 'display:flex; flex-direction:column; gap:0.6rem; flex:1; overflow-y:auto; min-height:100px; padding:2px;';

    cardsContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      colEl.classList.add('drag-over');
    });

    cardsContainer.addEventListener('dragleave', (e) => {
      if (!colEl.contains(e.relatedTarget)) {
        colEl.classList.remove('drag-over');
      }
    });

    cardsContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      colEl.classList.remove('drag-over');
      const decIdOrText = e.dataTransfer.getData('text/plain');
      if (decIdOrText) {
        const dec = groupedProjectDecs.find(d => (d.id && d.id === decIdOrText) || d.text === decIdOrText);
        persistKanbanDecisionStatus(dec, decIdOrText, col.key);
      }
    });

    if (col.items.length === 0) {
      cardsContainer.innerHTML = `<div style="font-size:0.8rem; color:var(--text-muted); font-style:italic; padding:1.5rem 0; text-align:center;">${escH(t('team.noDecisionsProject') || 'Aucune décision')}</div>`;
    } else {
      col.items.forEach(d => {
        const itemCard = document.createElement('div');
        itemCard.className = 'decision-kanban-card';
        itemCard.draggable = true;
        itemCard.style.cssText = `background:var(--card-bg); border-radius:8px; padding:0.75rem; border-left:4px solid ${col.color}; font-size:0.85rem; font-weight:600; color:var(--text); cursor:grab; ${d.status === 'superseded' ? 'text-decoration:line-through; opacity:0.8;' : ''}`;
        itemCard.setAttribute('title', t('team.dragToChangeStatus') || 'Glisser-déposer pour changer le statut, double-cliquer pour modifier');
        
        itemCard.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', d.id || d.text);
          e.dataTransfer.effectAllowed = 'move';
          itemCard.style.opacity = '0.4';
        });

        itemCard.addEventListener('dragend', () => {
          itemCard.style.opacity = '1';
        });

        itemCard.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          openEditDecisionModal(d);
        });

        const noteDisplay = d.noteTitle ? `<span style="color:var(--accent); font-weight:500; cursor:pointer; display:inline-flex; align-items:center; gap:3px;" onclick="event.stopPropagation(); if (typeof openDecisionNoteOverlay==='function') openDecisionNoteOverlay('${escA(d.notePath)}'); else if (typeof openNoteOverlay==='function') openNoteOverlay('${escA(d.notePath)}');" title="${escA(t('editor.openNoteTitleTooltip', { title: d.noteTitle }))}">${getWsIcon('link', 12)} ${escH(d.noteTitle)}</span>` : '';
        const impactBadge = d.impact === 'high' ? `<span class="pill-impact-high" style="font-size:0.68rem; padding:1px 5px; border-radius:4px; display:inline-flex; align-items:center; gap:3px;"><span style="width:5px; height:5px; border-radius:50%; background:#ef4444;"></span> High</span>` : '';
        const mgrBadge = d.authority === 'manager' ? `<span class="pill-authority-manager" style="font-size:0.68rem; padding:1px 5px; border-radius:4px; display:inline-flex; align-items:center; gap:3px;">${getWsIcon('briefcase', 11)} Manager</span>` : '';

        itemCard.innerHTML = `
          <div>${escH(d.text)}</div>
          <div style="font-size:0.72rem; color:var(--text-muted); margin-top:0.35rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
            <span style="display:inline-flex; align-items:center; gap:3px;">${getWsIcon('calendar', 11)} ${escH(d.date || '')}</span>
            <div style="display:flex; align-items:center; gap:4px;">
              ${impactBadge}
              ${mgrBadge}
            </div>
          </div>
          ${noteDisplay ? `<div style="font-size:0.72rem; margin-top:0.3rem;">${noteDisplay}</div>` : ''}
        `;
        cardsContainer.appendChild(itemCard);
      });
    }

    colEl.appendChild(cardsContainer);
    board.appendChild(colEl);
  });

  target.appendChild(board);
}

function renderDecisionAnalyticsView(target, decisionSource) {
  const activeCount = decisionSource.filter(d => d.status === 'active').length;
  const proposedCount = decisionSource.filter(d => d.status === 'proposed').length;
  const supersededCount = decisionSource.filter(d => d.status === 'superseded').length;
  const managerCount = decisionSource.filter(d => d.authority === 'manager').length;

  const dashboard = document.createElement('div');
  dashboard.style.cssText = 'display:flex; flex-direction:column; gap:1.25rem; width:100%;';

  const grid = document.createElement('div');
  grid.className = 'decision-analytics-grid';
  grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:1rem;';

  const createKpiCard = (icon, title, value, color) => `
    <div class="analytics-kpi-card" style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; padding:1.1rem; text-align:center;">
      <div style="font-size:1.8rem; margin-bottom:0.2rem;">${icon}</div>
      <div style="font-size:1.6rem; font-weight:800; color:${color};">${value}</div>
      <div style="font-size:0.8rem; color:var(--text-muted); font-weight:600; margin-top:0.2rem;">${escH(title)}</div>
    </div>
  `;

  grid.innerHTML = `
    ${createKpiCard(getWsIcon('check', 24), t('team.kpiActiveDecisions') || 'Active Decisions', activeCount, '#10b981')}
    ${createKpiCard(getWsIcon('clock', 24), t('team.kpiProposedDecisions') || 'To Decide / Proposed', proposedCount, '#f59e0b')}
    ${createKpiCard(getWsIcon('undo', 24), t('team.kpiSupersededDecisions') || 'Superseded Decisions', supersededCount, 'var(--text-muted)')}
    ${createKpiCard(getWsIcon('briefcase', 24), t('team.kpiManagementDecisions') || 'Management Decisions', managerCount, '#818cf8')}
  `;

  dashboard.appendChild(grid);

  const infoSection = document.createElement('div');
  infoSection.style.cssText = 'background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; padding:1.25rem; display:flex; flex-direction:column; gap:0.75rem;';
  infoSection.innerHTML = `
    <h4 style="margin:0; font-size:1.05rem; color:var(--text); font-weight:700; display:flex; align-items:center; gap:6px;">${getWsIcon('analytics', 16)} ${escH(t('team.registryHealthIndicators') || 'Registry Health Indicators')}</h4>
    <div style="font-size:0.88rem; color:var(--text-muted); line-height:1.5;">
      • <strong>${escH(t('team.stabilityRate') || 'Stability Rate')} :</strong> ${activeCount + supersededCount > 0 ? Math.round((activeCount / (activeCount + supersededCount)) * 100) : 100}% ${escH(t('team.stabilityRateDesc') || 'of recorded decisions remain active.')}<br>
      • <strong>${escH(t('team.managementCoverage') || 'Management Coverage')} :</strong> ${decisionSource.length > 0 ? Math.round((managerCount / decisionSource.length) * 100) : 0}% ${escH(t('team.managementCoverageDesc') || 'of decisions carry the Management validation badge.')}
    </div>
  `;
  dashboard.appendChild(infoSection);

  target.appendChild(dashboard);
}

async function createSyncNoteForCollaborator(name) {
  const col = collaboratorsMap[name] || { agenda: [], delegations: [] };
  const dateStr = new Date().toISOString().slice(0, 10);
  const lang = typeof getWorkingLanguage === 'function' ? getWorkingLanguage() : (typeof getNoteLanguage === 'function' ? getNoteLanguage() : 'en');
  
  const strings = {
    agendaPoints: t('team.syncNote.agendaPoints', { lang, fallback: "Agenda / Points to Discuss" }),
    discuterPointsEnCours: t('team.syncNote.discuterPointsEnCours', { lang, fallback: "Discuss points in progress with" }),
    suiviTachesDeleguees: t('team.syncNote.suiviTachesDeleguees', { lang, fallback: "Follow-up on Delegated Tasks (Waiting For)" }),
    suiviTask: t('team.syncNote.suiviTask', { lang, fallback: "Follow-up on task" }),
    meetingNotes: t('team.syncNote.meetingNotes', { lang, fallback: "Meeting Notes" })
  };

  // Format agenda items checklist
  let agendaMarkdown = '';
  if (col.agenda.length === 0) {
    agendaMarkdown = `- [ ] ${strings.discuterPointsEnCours} @${name}\n`;
  } else {
    for (const item of col.agenda) {
      agendaMarkdown += `- [ ] @${name} ${item.text} (ref: [[${item.noteTitle}]])\n`;
    }
  }

  const pendingDel = col.delegations.filter(d => (d.status || '').toLowerCase() !== 'done');
  
  // Also collect active delegated tasks from todosManifest
  const manifestDelTodos = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest))
    ? todosManifest.filter(t => t && t.priority !== 'Done' && (
        (t.owner && t.owner.toLowerCase() === name.toLowerCase()) ||
        (t.ownerId && t.ownerId.toLowerCase() === name.toLowerCase()) ||
        (t.delegatedTo && t.delegatedTo.toLowerCase() === name.toLowerCase()) ||
        (t.delegatedToColleagueId && t.delegatedToColleagueId.toLowerCase() === name.toLowerCase())
      ))
    : [];

  let delegationMarkdown = '';
  if (pendingDel.length > 0 || manifestDelTodos.length > 0) {
    delegationMarkdown = `\n# ${strings.suiviTachesDeleguees}\n`;
    for (const item of pendingDel) {
      delegationMarkdown += `- [ ] ${strings.suiviTask} @${name}: ${item.text} (ref: [[${item.noteTitle}]])\n`;
    }
    for (const tItem of manifestDelTodos) {
      const returnDateInfo = tItem.dueDate ? ` (Expected: ${tItem.dueDate})` : '';
      const latestUpdate = (Array.isArray(tItem.updates) && tItem.updates.length > 0)
        ? ` [${tItem.updates[tItem.updates.length - 1].type}: ${tItem.updates[tItem.updates.length - 1].text}]`
        : '';
      delegationMarkdown += `- [ ] ${strings.suiviTask} @${name}: ${tItem.title}${returnDateInfo}${latestUpdate}\n`;
    }
  }
  
  const content = `# ${strings.agendaPoints}\n${agendaMarkdown}${delegationMarkdown}\n# ${strings.meetingNotes}\n- \n`;
  
  // Open modal and prefill
  const modal = document.getElementById('modal-new-note');
  if (!modal) return;
  modal.classList.add('active');
  
  const titleEl = document.getElementById('nn-title');
  if (titleEl) titleEl.value = `Sync Point @${name}`;
  
  const dateEl = document.getElementById('nn-date');
  if (dateEl) dateEl.value = dateStr;
  
  const groupEl = document.getElementById('nn-group');
  if (groupEl) groupEl.value = 'Sync';
  
  const topicEl = document.getElementById('nn-topic');
  if (topicEl) topicEl.value = name;
  
  const contentEl = document.getElementById('nn-content');
  if (contentEl) contentEl.value = content;
  
  // Update preview
  showMdTab('write');
}

// ─── Bidirectional Backlinks Resolver ────────────────────────────────────────

async function getBacklinksForNote(targetNote) {
  if (!targetNote) return [];
  if (typeof window.getBacklinksForNote === 'function' && window.getBacklinksForNote !== getBacklinksForNote) {
    return await window.getBacklinksForNote(targetNote);
  }
  if (typeof noteGraphIndex !== 'undefined' && noteGraphIndex?.backlinks) {
    if (!noteGraphIndex.isHydrated && typeof rebuildNoteGraphIndex === 'function') {
      await rebuildNoteGraphIndex();
    }
    const sourcePaths = noteGraphIndex.backlinks.get(targetNote.path);
    if (sourcePaths && sourcePaths.size > 0 && typeof manifest !== 'undefined') {
      return Array.from(sourcePaths).map(p => manifest.find(n => n.path === p)).filter(Boolean);
    }
  }

  const targetTitleLower = (targetNote.title || '').toLowerCase().trim();
  if (!targetTitleLower || !targetNote.path) return [];
  
  const candidates = (typeof manifest !== 'undefined' ? manifest : []).filter(n => n.id !== targetNote.id);
  const backlinks = [];

  const batchSize = 50;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    await Promise.all(batch.map(async (n) => {
      try {
        let content = '';
        const cached = typeof noteContentCache !== 'undefined' ? noteContentCache[n.path] : null;
        if (cached && cached.modified === n.modified) {
          content = cached.rawContent || '';
        } else if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function') {
          const html = await StorageAPI.readNoteContent(n.path);
          if (typeof noteContentCache !== 'undefined') {
            const parsed = typeof parseNoteHTML === 'function' ? parseNoteHTML(html) : { mainHTML: html };
            noteContentCache[n.path] = {
              modified: n.modified || '',
              text: new DOMParser().parseFromString('<div>'+(parsed.mainHTML||'')+'</div>','text/html').body.textContent||'',
              rawContent: html
            };
          }
          content = html;
        }
        
        if (content && (content.toLowerCase().includes('data-path="' + targetNote.path.toLowerCase() + '"') ||
            content.toLowerCase().includes('[[' + targetTitleLower + ']]'))) {
          backlinks.push(n);
        }
      } catch (e) {
        console.warn('Failed to parse backlink candidate', n.path, e);
      }
    }));
  }
  return backlinks;
}

// Link helper called when clicking on a broken wiki-link
// Link helper called when clicking on a broken wiki-link
function createNoteFromBacklink(title) {
  const modal = document.getElementById('modal-new-note');
  if (!modal) return;
  modal.classList.add('active');
  
  const titleEl = document.getElementById('nn-title');
  if (titleEl) titleEl.value = title;
  
  const dateEl = document.getElementById('nn-date');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
}

// ─── Editor Autocomplete Component ──────────────────────────────────────────

let activeAutocompleteTextarea = null;
let autocompleteStartPos = 0;
let autocompleteType = '';
let autocompleteItems = [];
let autocompleteSelectedIndex = 0;
let autocompleteQuery = '';

function getCaretPositionInContentEditable(element) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return 0;
  const range = selection.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(element);
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  return preCaretRange.toString().length;
}

function setCaretPositionInContentEditable(element, offset) {
  const range = document.createRange();
  const selection = window.getSelection();
  
  let currentOffset = 0;
  let found = false;
  
  function traverse(node) {
    if (found) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (currentOffset + node.length >= offset) {
        range.setStart(node, offset - currentOffset);
        range.setEnd(node, offset - currentOffset);
        found = true;
      } else {
        currentOffset += node.length;
      }
    } else {
      for (let child of node.childNodes) {
        traverse(child);
      }
    }
  }
  
  traverse(element);
  if (found) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function handleEditorAutocomplete(event) {
  const target = event.target;
  if (!target) return;
  const rootEditor = target.closest('#edit-textarea, #nn-content');
  if (!rootEditor) return;
  
  const isRich = rootEditor.isContentEditable;
  let textBefore = '';
  let pos = 0;
  
  if (isRich) {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      
      let blockNode = range.endContainer;
      if (blockNode.nodeType === Node.TEXT_NODE) {
        blockNode = blockNode.parentNode;
      }
      
      const blockTags = ['p', 'li', 'h1', 'h2', 'h3', 'blockquote', 'div'];
      while (blockNode && blockNode !== rootEditor) {
        if (blockTags.includes(blockNode.tagName?.toLowerCase())) {
          break;
        }
        blockNode = blockNode.parentNode;
      }
      
      if (!blockNode || blockNode === rootEditor) {
        blockNode = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentNode : range.endContainer;
      }
      
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(blockNode);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      textBefore = preCaretRange.toString();
      pos = getCaretPositionInContentEditable(rootEditor);
    } else {
      const text = rootEditor.innerText || '';
      pos = getCaretPositionInContentEditable(rootEditor);
      textBefore = text.slice(0, pos);
    }
  } else {
    pos = rootEditor.selectionStart;
    textBefore = rootEditor.value.slice(0, pos);
  }
  
  // 1. !done @collaborator "task query
  const doneCollabTaskMatch = textBefore.match(/(?:\s|^)!done\s+@([a-zA-ZÀ-ÿ0-9_-]+)\s+"([^"]*)$/i);
  if (doneCollabTaskMatch) {
    const collaborator = doneCollabTaskMatch[1];
    const query = doneCollabTaskMatch[2].toLowerCase();
    showAutocompleteSuggestions(rootEditor, 'done-task-collab', query, pos - doneCollabTaskMatch[2].length, { collaborator });
    return;
  }
  
  // 2. !done "task query
  const doneTaskQuoteMatch = textBefore.match(/(?:\s|^)!done\s+"([^"]*)$/i);
  if (doneTaskQuoteMatch) {
    const query = doneTaskQuoteMatch[1].toLowerCase();
    showAutocompleteSuggestions(rootEditor, 'done-task-quote', query, pos - doneTaskQuoteMatch[1].length);
    return;
  }

  // 3. !done @query (collaborator search)
  const doneCollabMatch = textBefore.match(/(?:\s|^)!done\s+@([a-zA-ZÀ-ÿ0-9_-]*)$/i);
  if (doneCollabMatch) {
    const query = doneCollabMatch[1].toLowerCase();
    showAutocompleteSuggestions(rootEditor, 'done-user', query, pos - doneCollabMatch[1].length - 1);
    return;
  }

  // 4. !done task query (no @, no quote yet, just typing task text directly)
  const doneTaskDirectMatch = textBefore.match(/(?:\s|^)!done\s+([^@\s][^"]*)$/i);
  if (doneTaskDirectMatch) {
    const query = doneTaskDirectMatch[1].toLowerCase();
    showAutocompleteSuggestions(rootEditor, 'done-task-direct', query, pos - doneTaskDirectMatch[1].length);
    return;
  }

  // 5. !done (just typed !done or !done followed by space)
  const doneStartMatch = textBefore.match(/(?:\s|^)!done\s+$/i) || textBefore.match(/(?:\s|^)!done$/i);
  if (doneStartMatch) {
    showAutocompleteSuggestions(rootEditor, 'done-start', '', pos);
    return;
  }
  
  // Check for mention autocomplete e.g. @Alex or ->@Alex
  const quotedMentionMatch = textBefore.match(/(?:\s|^|->)@"([^"]*)$/);
  if (quotedMentionMatch) {
    const query = quotedMentionMatch[1].toLowerCase();
    showAutocompleteSuggestions(rootEditor, 'mention', query, pos - quotedMentionMatch[1].length - 2, { quoted: true });
    return;
  }

  const mentionMatch = textBefore.match(/(?:\s|^|->)@([a-zA-ZÀ-ÿ0-9_-]*)$/);
  if (mentionMatch) {
    const query = mentionMatch[1].toLowerCase();
    showAutocompleteSuggestions(rootEditor, 'mention', query, pos - mentionMatch[1].length - 1, { quoted: false });
    return;
  }
  
  // Match !decision:superseded "query
  const decisionQuoteMatch = textBefore.match(/(?:\s|^)!(decision|decsion):superseded\s+"([^"]*)$/i);
  if (decisionQuoteMatch) {
    const query = decisionQuoteMatch[2].toLowerCase();
    showAutocompleteSuggestions(rootEditor, 'decision-quote', query, pos - decisionQuoteMatch[2].length);
    return;
  }

  // Match !decision or !decsion (with or without status query) e.g. !decision:ac
  const decisionStatusMatch = textBefore.match(/(?:\s|^)!(decision|decsion)(?::([a-zA-Z]*))?$/i);
  if (decisionStatusMatch) {
    const query = (decisionStatusMatch[2] || '').toLowerCase();
    const matchLen = decisionStatusMatch[0].trimStart().length;
    showAutocompleteSuggestions(rootEditor, 'decision-status', query, pos - matchLen);
    return;
  }
  
  // Check for trigger autocomplete e.g. !decision or !todo or !done
  const exclMatch = textBefore.match(/(?:\s|^)!([a-zA-Z]*)$/);
  if (exclMatch) {
    const query = exclMatch[1].toLowerCase();
    if ('decision'.startsWith(query) || 'decsion'.startsWith(query) || 'todo'.startsWith(query) || 'done'.startsWith(query)) {
      showAutocompleteSuggestions(rootEditor, 'excl', query, pos - exclMatch[1].length - 1);
      return;
    }
  }

  // Check for todo autocomplete e.g. {todo
  const todoMatch = textBefore.match(/(?:\s|^)\{([a-zA-Z]*)$/);
  if (todoMatch) {
    const query = todoMatch[1].toLowerCase();
    if ('todo'.startsWith(query)) {
      showAutocompleteSuggestions(rootEditor, 'todo', query, pos - todoMatch[1].length - 1);
      return;
    }
  }

  // Fast command: /note [search string]
  const noteCmdMatch = textBefore.match(/(?:^|\s)\/note(?:\s+(.*))?$/i);
  if (noteCmdMatch) {
    const rawSearch = noteCmdMatch[1] || '';
    const query = rawSearch.toLowerCase();
    const matchLen = noteCmdMatch[0].replace(/^\s+/, '').length;
    showAutocompleteSuggestions(rootEditor, 'note-link', query, pos - matchLen);
    return;
  }
  
  closeAutocomplete();
}

function showAutocompleteSuggestions(textarea, type, query, startPos, extra = {}) {
  if (activeAutocompleteTextarea === textarea && 
      autocompleteType === type && 
      autocompleteStartPos === startPos && 
      autocompleteQuery === query) {
    return;
  }
  
  activeAutocompleteTextarea = textarea;
  autocompleteStartPos = startPos;
  autocompleteType = type;
  autocompleteQuery = query;

  if (type === 'decision-status' || type === 'decision-quote' || type === 'excl') {
    refreshDecisionListFromMetadataIfAvailable();
  }
  
  let items = [];
  if (type === 'mention') {
    const known = getVisibleCollaboratorNames();
    const filtered = known.filter(name => name.toLowerCase().includes(query));
    const asQuoted = !!extra.quoted;
    items = filtered.map(name => {
      const needsQuote = asQuoted || /\s/.test(name);
      const value = needsQuote ? `@"${name}" ` : `@${name} `;
      return { label: value.trim(), value };
    });
    if (query && !filtered.some(n => n.toLowerCase() === query)) {
      const value = asQuoted ? `@"${query}" ` : `@${query} `;
      items.push({ label: `➕ Add "${value.trim()}"`, value });
    }
  } else if (type === 'done-user') {
    const known = getVisibleCollaboratorNames();
    const filtered = known.filter(name => name.toLowerCase().includes(query));
    items = filtered.map(name => ({ label: `@${name}`, value: `@${name} "` }));
  } else if (type === 'done-task-collab') {
    const collaborator = extra.collaborator;
    let filteredTodos = todosManifest.filter(t => t.priority !== 'Done' && t.owner && t.owner.trim().toLowerCase() === collaborator.toLowerCase());
    if (query) {
      filteredTodos = filteredTodos.filter(t => (t.title || '').toLowerCase().includes(query));
    }
    const relatedNoteIds = new Set();
    if (currentNote) {
      relatedNoteIds.add(currentNote.id);
      const tags = (currentNote.group_tags || []).concat(currentNote.major_topic_tags || []).concat(currentNote.topic_tags || []);
      if (typeof getRelatedNotesForTags === 'function') {
        const relatedNotes = getRelatedNotesForTags(tags, currentNote.id, 9999);
        for (const rn of relatedNotes) {
          if (rn.id) relatedNoteIds.add(rn.id);
        }
      }
    }
    const relatedGroup = [];
    const otherGroup = [];
    filteredTodos.forEach(t => {
      if (t.noteId && relatedNoteIds.has(t.noteId)) relatedGroup.push(t);
      else otherGroup.push(t);
    });
    const sorted = relatedGroup.sort(compareTodoDates).concat(otherGroup.sort(compareTodoDates));
    items = sorted.map(t => ({ label: t.title, value: t.title + '" ' }));
  } else if (type === 'done-task-quote' || type === 'done-task-direct' || type === 'done-start') {
    let filteredTodos = todosManifest.filter(t => t.priority !== 'Done' && isUserTask(t));
    if (query) {
      filteredTodos = filteredTodos.filter(t => (t.title || '').toLowerCase().includes(query));
    }
    const relatedNoteIds = new Set();
    if (currentNote) {
      relatedNoteIds.add(currentNote.id);
      const tags = (currentNote.group_tags || []).concat(currentNote.major_topic_tags || []).concat(currentNote.topic_tags || []);
      if (typeof getRelatedNotesForTags === 'function') {
        const relatedNotes = getRelatedNotesForTags(tags, currentNote.id, 9999);
        for (const rn of relatedNotes) {
          if (rn.id) relatedNoteIds.add(rn.id);
        }
      }
    }
    const relatedGroup = [];
    const otherGroup = [];
    filteredTodos.forEach(t => {
      if (t.noteId && relatedNoteIds.has(t.noteId)) relatedGroup.push(t);
      else otherGroup.push(t);
    });
    const sorted = relatedGroup.sort(compareTodoDates).concat(otherGroup.sort(compareTodoDates));
    
    if (type === 'done-task-direct' || type === 'done-start') {
      items = sorted.map(t => ({ label: t.title, value: '"' + t.title + '" ' }));
    } else {
      items = sorted.map(t => ({ label: t.title, value: t.title + '" ' }));
    }
  } else if (type === 'decision-status') {
    const opts = [
      { label: '💡 !decision:active', value: '!decision:active ""', caretOffset: 18 },
      { label: '❌ !decision:superseded', value: '!decision:superseded ""', caretOffset: 22 }
    ];
    items = opts.filter(o => o.label.toLowerCase().includes(query.toLowerCase()));
  } else if (type === 'decision-quote') {
    const useMetadataSearch = typeof searchMetadataDecisionEntries === 'function' && refreshDecisionListFromMetadataIfAvailable();
    let filtered = useMetadataSearch
      ? searchMetadataDecisionEntries(query)
      : decisionsList;
    if (!useMetadataSearch && query) {
      filtered = decisionsList.filter(d => d.text.toLowerCase().includes(query));
    }
    const seen = new Set();
    const deduped = [];
    filtered.forEach(d => {
      const txt = d.text.trim();
      if (!seen.has(txt)) {
        seen.add(txt);
        deduped.push(d);
      }
    });
    deduped.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    items = deduped.map(d => ({
      label: d.text,
      value: d.text + '" '
    }));
  } else if (type === 'excl') {
    const decisionMatches = 'decision'.startsWith(query) || 'decsion'.startsWith(query);
    const todoMatches = 'todo'.startsWith(query);
    const doneMatches = 'done'.startsWith(query);
    if (decisionMatches) {
      if (query.length < 3) {
        items.push({ label: '💡 !decision', value: '!decision:' });
      } else {
        items.push(
          { label: '💡 !decision:active', value: '!decision:active ""', caretOffset: 18 },
          { label: '❌ !decision:superseded', value: '!decision:superseded ""', caretOffset: 22 }
        );
      }
    }
    if (doneMatches && query !== 'dec' && query !== 'decs' && query !== 'decsi' && query !== 'decsio' && query !== 'decision') {
      items.push({ label: '✅ !done', value: '!done ' });
    }
    if (todoMatches && query !== 'dec' && query !== 'decs' && query !== 'decsi' && query !== 'decsio' && query !== 'decision') {
      items.push(
        { label: '🔴 !todo High', value: '{todo:High|}', caretOffset: 11 },
        { label: '🟡 !todo Med', value: '{todo:Medium|}', caretOffset: 13 },
        { label: '🟢 !todo Low', value: '{todo:Low|}', caretOffset: 10 }
      );
    }
  } else if (type === 'todo') {
    items = [
      { label: `🔴 ${t('todo.priorityHigh') || 'High'} Priority Todo`, value: '{todo:High|}', caretOffset: 11 },
      { label: `🟡 ${t('todo.priorityMedium') || 'Medium'} Priority Todo`, value: '{todo:Medium|}', caretOffset: 13 },
      { label: `🟢 ${t('todo.priorityLow') || 'Low'} Priority Todo`, value: '{todo:Low|}', caretOffset: 10 }
    ];
  } else if (type === 'note-link') {
    const currentId = String(currentNote?.id || '').trim();
    const currentPath = String(currentNote?.path || '').trim();
    const notes = (typeof manifest !== 'undefined' && Array.isArray(manifest) ? manifest : [])
      .filter(n => {
        if (!n) return false;
        if (currentId && String(n.id || '').trim() === currentId) return false;
        if (currentPath && String(n.path || '').trim() === currentPath) return false;
        return true;
      })
      .filter(n => !query || (n.title || '').toLowerCase().includes(query))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    items = notes.map(note => ({
      label: `📝 ${note.title || (typeof t === 'function' ? t('common.untitledNote') : 'Untitled')} (${note.date || ''})`,
      value: note.title || 'Untitled',
      note: note,
      html: `<a href="#" class="note-link wiki-link" data-note-id="${escA(note.id || '')}" data-note-path="${escA(note.path || '')}" title="${escA(typeof t === 'function' ? t('editor.openNoteLinkTooltip') || 'Open note' : 'Open note')}: ${escA(note.title || '')}">📝 ${escH(note.title || 'Untitled')}</a>&nbsp;`
    }));
  }
  
  if (items.length === 0) {
    closeAutocomplete();
    return;
  }
  
  autocompleteItems = items;
  autocompleteSelectedIndex = 0;
  
  let dropdown = document.getElementById('editor-autocomplete-list');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'editor-autocomplete-list';
    dropdown.className = 'editor-autocomplete-dropdown';
    document.body.appendChild(dropdown);
  }
  
  renderAutocompleteDropdown();
  
  const coords = getCaretCoordinates(textarea, startPos);
  const dropdownHeight = dropdown.offsetHeight || 150;
  const dropdownWidth = dropdown.offsetWidth || 220;
  const viewportWidth = window.innerWidth || 1024;
  const viewportHeight = window.innerHeight || 768;

  const clampedLeft = Math.max(10, Math.min(viewportWidth - dropdownWidth - 10, Math.round(coords.left)));
  dropdown.style.left = `${clampedLeft}px`;

  const viewportCaretTop = coords.top;
  const spaceBelow = viewportHeight - (viewportCaretTop + 20);

  if (spaceBelow < dropdownHeight && viewportCaretTop > dropdownHeight) {
    dropdown.style.top = `${Math.max(10, Math.round(coords.top - dropdownHeight - 4))}px`;
  } else {
    dropdown.style.top = `${Math.max(10, Math.min(viewportHeight - dropdownHeight - 10, Math.round(coords.top + 20)))}px`;
  }
}

function renderAutocompleteDropdown() {
  const dropdown = document.getElementById('editor-autocomplete-list');
  if (!dropdown) return;
  
  dropdown.innerHTML = autocompleteItems.map((item, idx) => {
    const isSelected = idx === autocompleteSelectedIndex;
    return `
      <button class="editor-autocomplete-item${isSelected ? ' selected' : ''}" 
              onclick="selectAutocompleteItem(${idx}); event.preventDefault();">
        ${escH(item.label)}
      </button>
    `;
  }).join('');
}

function selectAutocompleteItem(idx) {
  if (!activeAutocompleteTextarea || idx < 0 || idx >= autocompleteItems.length) return;
  
  const item = autocompleteItems[idx];
  const ta = activeAutocompleteTextarea;
  const isRich = ta ? ta.isContentEditable : false;
  const pos = isRich ? getCaretPositionInContentEditable(ta) : (ta ? ta.selectionStart : 0);
  const val = isRich ? ta.innerText : (ta ? ta.value : '');
  
  let insertedValue = item.value;
  let todoId = null;
  let isDecision = false;
  
  if (isRich) {
    let htmlToInsert = null;
    let nodeToFocus = null;
    
    if (item.value.startsWith('{todo:')) {
      const priority = item.value.split(':')[1].split('|')[0] || 'Medium';
      todoId = typeof generateTodoId === 'function' ? generateTodoId() : 'todo-' + Math.random().toString(36).slice(2, 9);
      htmlToInsert = `<span class="note-todo note-todo-draft" data-todo-id="${todoId}" data-todo-priority="${priority}" contenteditable="false"><span class="todo-urgency-label" contenteditable="false">todo urgency: <span class="todo-urgency-value-wrapper"><span class="todo-urgency-value">${priority}</span><span class="todo-urgency-options"><span class="todo-urgency-opt" onclick="event.stopPropagation(); window.setTodoUrgencyInline(this, 'High')">High</span><span class="todo-urgency-opt" onclick="event.stopPropagation(); window.setTodoUrgencyInline(this, 'Medium')">Medium</span><span class="todo-urgency-opt" onclick="event.stopPropagation(); window.setTodoUrgencyInline(this, 'Low')">Low</span></span></span></span><span class="note-todo-text" contenteditable="true">Todo Title</span></span>`;
    } else if (item.value.startsWith('!decision')) {
      let status = 'active';
      if (item.value.includes(':')) {
        status = item.value.split(':')[1].split(' ')[0] || 'active';
      }
      status = status.replace(/[^a-zA-Z]/g, '');
      const badgeText = `!decision:${status}`;
      const badgeHTML = `<strong class="pill-decision pill-decision-${status}" contenteditable="false">${badgeText}</strong>`;
      htmlToInsert = `<span class="note-decision-wrapper note-decision-draft" data-decision-status="${status}" data-decision-text="" contenteditable="false">${badgeHTML} <span class="note-decision-text" contenteditable="true">Decision Title</span></span>`;
      isDecision = true;
    } else if (item.value.trim().startsWith('@') || item.value.trim().startsWith('@"')) {
      const cleanName = item.value.trim().replace(/^@"?|"?$/g, '');
      const id = typeof resolveColleagueId === 'function' ? resolveColleagueId(cleanName, { allowCreate: false, allowMe: false }) : '';
      const colIdAttr = id ? ` data-colleague-id="${id}"` : '';
      const displayName = typeof getCollaboratorDisplayName === 'function' ? getCollaboratorDisplayName(cleanName) : cleanName;
      htmlToInsert = `<span class="pill-mention" data-colleague-label="${displayName}"${colIdAttr} contenteditable="false">@${displayName}</span>&nbsp;`;
    } else if (item.html) {
      htmlToInsert = item.html;
    }

    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const textNode = range.endContainer;
      if (textNode.nodeType === Node.TEXT_NODE) {
        const queryLength = pos - autocompleteStartPos;
        const startOffset = Math.max(0, range.endOffset - queryLength);
        range.setStart(textNode, startOffset);
        range.setEnd(textNode, range.endOffset);
        range.deleteContents();
      }

      if (htmlToInsert) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlToInsert;
        
        let lastInserted = null;
        while (tempDiv.firstChild) {
          const child = tempDiv.firstChild;
          range.insertNode(child);
          lastInserted = child;
          
          range.setStartAfter(child);
          range.collapse(true);
        }
        
        if (lastInserted) {
          if (item.value.trim().startsWith('@') || item.value.trim().startsWith('@"')) {
            let hasContentAfter = false;
            let next = lastInserted.nextSibling;
            while (next) {
              if (next.nodeType === Node.ELEMENT_NODE || (next.nodeType === Node.TEXT_NODE && next.textContent.trim().length > 0)) {
                hasContentAfter = true;
                break;
              }
              next = next.nextSibling;
            }
            if (!hasContentAfter) {
              const spaceNode = document.createTextNode(' ');
              lastInserted.parentNode.insertBefore(spaceNode, lastInserted.nextSibling);
              lastInserted = spaceNode;
            }
          }

          sel.removeAllRanges();
          const newRange = document.createRange();
          newRange.setStartAfter(lastInserted);
          newRange.collapse(true);
          sel.addRange(newRange);
        }
        
        nodeToFocus = lastInserted?.closest?.('.note-todo-text, .note-decision-text') || lastInserted?.querySelector?.('.note-todo-text, .note-decision-text');
        if (!nodeToFocus && lastInserted && (lastInserted.classList?.contains('note-todo-text') || lastInserted.classList?.contains('note-decision-text'))) {
          nodeToFocus = lastInserted;
        }

        if (nodeToFocus) {
          setTimeout(() => {
            if (typeof window.focusAndSelectElementContents === 'function') {
              window.focusAndSelectElementContents(nodeToFocus);
            } else {
              nodeToFocus.focus();
            }
          }, 50);
        }
      } else {
        const textNode = document.createTextNode(item.value);
        range.insertNode(textNode);
        
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.setStartAfter(textNode);
        newRange.collapse(true);
        sel.addRange(newRange);
      }
      
      if (item.note) {
        if (currentNote?.id && typeof syncPlannerAssociationsFromNote === 'function') {
          syncPlannerAssociationsFromNote(currentNote.id, { addedNoteId: item.note.id })
            .then(() => {
              if (typeof _renderPlannerBlocksForNote === 'function') _renderPlannerBlocksForNote(currentNote.id);
            })
            .catch(err => console.warn('Could not sync planner note association from note link', err));
        }
        if (typeof renderInspectorPanel === 'function') renderInspectorPanel();
      }

      ta.dispatchEvent(new Event('input', { bubbles: true }));
      closeAutocomplete();
      ta.focus();

      if (item.value === '!decision:') {
        handleEditorAutocomplete({ target: ta });
      }
      return;
    }
  } else {
    let finalInsertedValue = insertedValue;
    if (item.note) {
      finalInsertedValue = `[[${item.note.title || item.value}]] `;
      if (currentNote?.id && typeof syncPlannerAssociationsFromNote === 'function') {
        syncPlannerAssociationsFromNote(currentNote.id, { addedNoteId: item.note.id })
          .then(() => {
            if (typeof _renderPlannerBlocksForNote === 'function') _renderPlannerBlocksForNote(currentNote.id);
          })
          .catch(err => console.warn('Could not sync planner note association from note link', err));
      }
      if (typeof renderInspectorPanel === 'function') renderInspectorPanel();
    }
    const newVal = val.slice(0, autocompleteStartPos) + finalInsertedValue + val.slice(pos);
    ta.value = newVal;
    let caretPos = autocompleteStartPos + finalInsertedValue.length;
    if (item.caretOffset !== undefined) {
      caretPos = autocompleteStartPos + item.caretOffset;
    }
    ta.selectionStart = ta.selectionEnd = caretPos;
    
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    closeAutocomplete();
    ta.focus();

    if (item.value === '!decision:') {
      handleEditorAutocomplete({ target: ta });
    }
  }
}

function closeAutocomplete() {
  const dropdown = document.getElementById('editor-autocomplete-list');
  if (dropdown) dropdown.remove();
  
  activeAutocompleteTextarea = null;
  autocompleteStartPos = 0;
  autocompleteType = '';
  autocompleteQuery = '';
  autocompleteItems = [];
}

// Intercept key events for autocomplete selection
function handleAutocompleteKeydown(e) {
  const dropdown = document.getElementById('editor-autocomplete-list');
  if (!dropdown) return false;
  
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    autocompleteSelectedIndex = (autocompleteSelectedIndex + 1) % autocompleteItems.length;
    renderAutocompleteDropdown();
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    autocompleteSelectedIndex = (autocompleteSelectedIndex - 1 + autocompleteItems.length) % autocompleteItems.length;
    renderAutocompleteDropdown();
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    selectAutocompleteItem(autocompleteSelectedIndex);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    closeAutocomplete();
    return true;
  }
  return false;
}

// Caret position finder for absolute positioning of the autocomplete dropdown
function getCaretCoordinates(element, position) {
  if (element.isContentEditable) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0).cloneRange();
      let rect = range.getBoundingClientRect();
      // If rect is empty, insert temporary character to get dimensions
      if (!rect || (rect.left === 0 && rect.top === 0)) {
        const span = document.createElement('span');
        span.appendChild(document.createTextNode('\u200b'));
        range.insertNode(span);
        rect = span.getBoundingClientRect();
        const parent = span.parentNode;
        parent.removeChild(span);
        parent.normalize();
      }
      return {
        left: rect.left,
        top: rect.top
      };
    }
    const elementRect = element.getBoundingClientRect();
    return { left: elementRect.left, top: elementRect.top };
  }

  const div = document.createElement('div');
  const style = window.getComputedStyle(element);
  
  // Copy all textarea font/layout properties to mirror div
  const properties = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'lineHeight', 'wordSpacing', 'letterSpacing', 'textTransform',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderStyle', 'boxSizing', 'width', 'height'
  ];
  
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  
  properties.forEach(prop => {
    div.style[prop] = style[prop];
  });
  
  // Add matching scroll offsets
  div.style.overflow = 'hidden';
  
  const text = element.value.substring(0, position);
  div.textContent = text;
  
  const span = document.createElement('span');
  span.textContent = element.value.substring(position) || '.';
  div.appendChild(span);
  
  document.body.appendChild(div);
  
  const rect = element.getBoundingClientRect();
  const spanLeft = span.offsetLeft;
  const spanTop = span.offsetTop;
  
  document.body.removeChild(div);
  
  return {
    left: rect.left + spanLeft - element.scrollLeft,
    top: rect.top + spanTop - element.scrollTop
  };
}

function showCollaboratorModal(name) {
  if (!name) return;
  const cleanName = name.trim().charAt(0).toUpperCase() + name.trim().slice(1);
  const color = colorForGroup(cleanName);
  const col = collaboratorsMap[cleanName] || { agenda: [], delegations: [] };

  const contentDiv = document.getElementById('collab-details-modal-content');
  if (!contentDiv) return;

  if (!colleaguesDb) {
    colleaguesDb = ensureColleaguesDbShape(null);
    reindexColleaguesDb();
  }

  const targetId = (cleanName.toLowerCase() === (colleaguesDb.me.label || '').toLowerCase() || name.toLowerCase() === 'me') ? 'me' : (colleaguesDb.colleagues.find(c => c.label.toLowerCase() === cleanName.toLowerCase())?.id || '');
  const rec = colleaguesById.get(targetId);
  const dbLabel = rec ? rec.label : cleanName;
  const currentTeamId = rec ? rec.teamId : 'team-other-bucket';

  const currentTeam = colleaguesDb.teams.find(t => t.id === currentTeamId);
  const isManagerOfCurrentTeam = currentTeam ? currentTeam.managerId === targetId : false;

  const collabTags = typeof getCollaboratorLabels === 'function' ? getCollaboratorLabels(dbLabel) : [];

  // Manager Html
  const mgrId = getColleagueManagerId(targetId);
  let managerHtml = '';
  if (mgrId && !mgrId.startsWith('virtual-manager-')) {
    const mgrLabel = mgrId === 'me' ? (colleaguesDb.me.label) : (colleaguesById.get(mgrId)?.label || mgrId);
    const mgrNameForModal = mgrId === 'me' ? 'me' : mgrLabel;
    managerHtml = `👤 <a style="cursor:pointer; text-decoration:underline; color:var(--accent);" onclick="closeModal('modal-collab-details'); showCollaboratorModal('${escA(mgrNameForModal)}')">${escH(mgrLabel)}</a>`;

    const userManagerChain = getColleagueManagerChain('me');
    const mgrIndex = userManagerChain.indexOf(mgrId);
    if (mgrIndex === 0) {
      managerHtml += ` <span class="sl-badge sl-badge-high" style="font-size:0.6rem; padding:1px 3px; margin-left:4px;">Manager</span>`;
    } else if (mgrIndex > 0) {
      managerHtml += ` <span class="sl-badge sl-badge-high" style="font-size:0.6rem; padding:1px 3px; margin-left:4px;">Grand Manager (${mgrIndex + 1}x)</span>`;
    }
  } else {
    managerHtml = `<span style="color:var(--text-muted); font-style:italic;">None (Ultimate) / Non défini</span>`;
  }

  // Peers Html
  const peers = getColleaguePeers(targetId);
  let peersHtml = '';
  if (peers.length > 0) {
    peersHtml = peers.map(p => {
      const pName = p.id === 'me' ? 'me' : p.label;
      const label = p.id === 'me' ? `${p.label} (Me)` : p.label;
      return `<div style="display:flex; align-items:center; gap:4px; margin-bottom:4px;">👤 <a style="cursor:pointer; text-decoration:underline; color:var(--accent);" onclick="closeModal('modal-collab-details'); showCollaboratorModal('${escA(pName)}')">${escH(label)}</a></div>`;
    }).join('');
  } else {
    peersHtml = `<span style="color:var(--text-muted); font-style:italic;">No peers</span>`;
  }

  // Directs Html
  const directs = getColleagueDirects(targetId);
  let directsHtml = '';
  if (directs.length > 0) {
    directsHtml = directs.map(d => {
      const dName = d.id === 'me' ? 'me' : d.label;
      const label = d.id === 'me' ? `${d.label} (Me)` : d.label;
      return `<div style="display:flex; align-items:center; gap:4px; margin-bottom:4px;">👤 <a style="cursor:pointer; text-decoration:underline; color:var(--accent);" onclick="closeModal('modal-collab-details'); showCollaboratorModal('${escA(dName)}')">${escH(label)}</a></div>`;
    }).join('');
  } else {
    directsHtml = `<span style="color:var(--text-muted); font-style:italic;">No directs</span>`;
  }

  const upcomingSyncEvents = getUpcomingCollaboratorPlannerEvents(cleanName, { syncOnly: true });
  const upcomingMeetings = getUpcomingCollaboratorPlannerEvents(cleanName, { syncOnly: false }).slice(0, 10);
  const upcomingNonSyncMeetings = upcomingMeetings.filter(e => (e.type || '').toLowerCase() !== 'sync');
  const hasUpcomingSync = upcomingSyncEvents.length > 0;
  const todayStr = formatLocalDateValue(new Date());

  const syncEventsForDisplay = [];
  const addedSyncKeys = new Set();
  for (const e of upcomingSyncEvents) {
    const key = e.recurrenceId ? `series:${e.recurrenceId}` : `single:${e.id || e.date || ''}:${e.startTime || ''}`;
    const countForKey = addedSyncKeys.has(key) ? 1 : 0;
    if (e.recurrenceId) {
      const currentCount = syncEventsForDisplay.filter(x => x.recurrenceId === e.recurrenceId).length;
      if (currentCount >= 4) continue;
      syncEventsForDisplay.push(e);
      addedSyncKeys.add(key);
    } else {
      if (countForKey >= 1) continue;
      syncEventsForDisplay.push(e);
      addedSyncKeys.add(key);
    }
    if (syncEventsForDisplay.length >= 10) break;
  }

  const linkedShownPaths = new Set();
  syncEventsForDisplay.forEach(e => {
    const linked = getPlannerEventLinkedNote(e);
    if (linked?.path) linkedShownPaths.add(linked.path);
  });
  upcomingNonSyncMeetings.forEach(e => {
    const linked = getPlannerEventLinkedNote(e);
    if (linked?.path) linkedShownPaths.add(linked.path);
  });

  const taggedNotes = manifest.filter(n => {
    if (!n?.date || n.date > todayStr) return false;
    const hasTopic = (n.topic_tags || []).some(t => normalizeCollaboratorKey(t) === normalizeCollaboratorKey(cleanName));
    const cached = collaborativeDataCache[n.path];
    const hasMention = cached && (
      (cached.mentions || []).some(m => normalizeCollaboratorKey(m.collaborator) === normalizeCollaboratorKey(cleanName)) ||
      (cached.delegations || []).some(d => normalizeCollaboratorKey(d.collaborator) === normalizeCollaboratorKey(cleanName))
    );
    return hasTopic || hasMention;
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const relatedNotesMap = new Map();
  taggedNotes
    .filter(n => !linkedShownPaths.has(n.path))
    .forEach(n => relatedNotesMap.set(n.path, n));
  const relatedNotes = Array.from(relatedNotesMap.values()).slice(0, 12);

  const pendingDelegations = (col.delegations || []).filter(d => (d.status || '').toLowerCase() !== 'done');

  const swatchHtml = `<span class="swatch" style="background:${color.bg}; color:${color.text}; width:36px; height:36px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-weight:700; font-size:1rem; margin-right: 0.8rem;">${cleanName.slice(0, 2).toUpperCase()}</span>`;
  const syncButtonHtml = hasUpcomingSync
    ? ''
    : `<button class="btn btn-primary" style="font-size:0.8rem; padding:6px 12px;" onclick="closeModal('modal-collab-details'); createSyncNoteForCollaborator('${escA(cleanName)}');">📝 Sync</button>`;

  let syncListHtml = '';
  const syncTop10 = syncEventsForDisplay;
  if (syncTop10.length === 0) {
    syncListHtml = `<div style="font-size:0.85rem; color:var(--text-muted); font-style:italic; margin-bottom:1rem;">No upcoming sync block in planner.</div>`;
  } else {
    const startOfWeek = (date) => {
      const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day);
      return d;
    };
    const formatInstanceLabel = (event) => {
      if (!event?.date) return `${event.startTime || ''} - ${event.endTime || ''}`.trim();
      const target = new Date(`${event.date}T00:00:00`);
      const now = new Date();
      const thisWeek = startOfWeek(now);
      const nextWeek = new Date(thisWeek); nextWeek.setDate(thisWeek.getDate() + 7);
      const weekAfter = new Date(thisWeek); weekAfter.setDate(thisWeek.getDate() + 14);
      let prefix = '';
      if (target >= thisWeek && target < nextWeek) prefix = 'This week';
      else if (target >= nextWeek && target < weekAfter) prefix = 'Next week';
      else prefix = event.date;
      return `${prefix} ${event.date} · ${event.startTime || ''} - ${event.endTime || ''}`.trim();
    };

    const seriesGroups = new Map();
    syncTop10.forEach(e => {
      const key = e.recurrenceId || `single:${e.id || e.date || ''}:${e.startTime || ''}`;
      if (!seriesGroups.has(key)) seriesGroups.set(key, []);
      seriesGroups.get(key).push(e);
    });
    const groupedItems = Array.from(seriesGroups.values())
      .map(list => list.sort(comparePlannerEventsByStart))
      .sort((a, b) => comparePlannerEventsByStart(a[0], b[0]));

    syncListHtml = `<div style="display:flex; flex-direction:column; gap:0.4rem; max-height:260px; overflow-y:auto; margin-bottom:1rem;">`;
    groupedItems.forEach(events => {
      const first = events[0];
      const title = first?.title || t('team.syncDefaultTitle');
      const isSeries = !!first?.recurrenceId;
      const info = isSeries ? getPlannerSeriesInfo(first) : null;
      const cadence = info && info.cadence ? ` (${info.cadence})` : '';

      const nextInstance = events[0] || null;
      const otherInstances = events.slice(1, 4);

      const renderInstance = (event, prefix = '') => {
        const linked = getPlannerEventLinkedNote(event);
        const label = `${prefix}${formatInstanceLabel(event)}`;
        if (linked?.path) {
          return `<a title="${escA(t('team.openSeriesInstanceTooltip'))}" style="cursor:pointer; text-decoration:underline; color:var(--accent);" onclick="closeModal('modal-collab-details'); openNoteFromCollaborator('${escA(linked.path)}', '${escA(dbLabel)}')">${escH(label)}</a>`;
        }
        return `<span title="${escA(t('team.noLinkedSeriesInstanceTooltip'))}" style="color:var(--text-muted);">${escH(label)}</span>`;
      };

      let cardHtml = `<div style="font-size:0.83rem; padding:8px; background:var(--card-bg-alt); border-radius:6px; border:1px solid var(--card-border);">`;
      cardHtml += `<div style="font-weight:700; color:var(--text);">${escH(title)}</div>`;

      if (nextInstance) {
        cardHtml += `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;"><strong>${escH(t('team.nextInstance'))}:</strong> ${renderInstance(nextInstance)}</div>`;
      }

      if (isSeries) {
        cardHtml += `<div style="font-size:0.74rem; color:var(--text-muted); margin-top:3px;">${escH(t('team.seriesLabel'))}${escH(cadence)}</div>`;
      }

      if (otherInstances.length > 0) {
        cardHtml += `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:5px;">${escH(t('team.otherInstances'))}:</div>`;
        otherInstances.forEach((evt, idx) => {
          cardHtml += `<div style="font-size:0.75rem; margin-top:2px;">${idx + 1}) ${renderInstance(evt)}</div>`;
        });
      }

      cardHtml += `</div>`;
      syncListHtml += cardHtml;
    });
    syncListHtml += `</div>`;
  }

  let meetingsHtml = '';
  if (upcomingNonSyncMeetings.length === 0) {
    meetingsHtml = `<div style="font-size:0.85rem; color:var(--text-muted); font-style:italic; margin-bottom:1rem;">${escH(t('team.noUpcomingMeetings'))}</div>`;
  } else {
    meetingsHtml = `<div style="display:flex; flex-direction:column; gap:0.4rem; max-height:260px; overflow-y:auto; margin-bottom:1rem;">`;
    upcomingNonSyncMeetings.forEach(e => {
      const linked = getPlannerEventLinkedNote(e);
      const when = `${e.date || ''} · ${e.startTime || ''} - ${e.endTime || ''}`;
      const typeLabel = (e.type || 'meeting').toUpperCase();
      const titleHtml = linked && linked.path
        ? `<a style="cursor:pointer; text-decoration:underline; font-weight:600; color:var(--accent);" onclick="closeModal('modal-collab-details'); openNoteFromCollaborator('${escA(linked.path)}', '${escA(dbLabel)}')">${escH(e.title || t('team.meetingLabel'))}</a>`
        : `<strong>${escH(e.title || t('team.meetingLabel'))}</strong>`;
      meetingsHtml += `<div style="font-size:0.83rem; padding:8px; background:var(--card-bg-alt); border-radius:6px; border:1px solid var(--card-border);">${titleHtml}<div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${escH(when)} · ${escH(typeLabel)}</div></div>`;
    });
    meetingsHtml += `</div>`;
  }

  let delegationsHtml = '';
  if (pendingDelegations.length === 0) {
    delegationsHtml = '';
  } else {
    delegationsHtml = `<div style="display:flex; flex-direction:column; gap:0.4rem; max-height:180px; overflow-y:auto; margin-bottom:1rem;">`;
    pendingDelegations.slice(0, 10).forEach(d => {
      const rawStatus = String(d.status || 'pending').toLowerCase();
      const statusClass = rawStatus === 'done'
        ? 'done'
        : rawStatus === 'wip'
          ? 'wip'
          : rawStatus === 'high'
            ? 'high'
            : rawStatus === 'medium'
              ? 'med'
              : rawStatus === 'low'
                ? 'low'
                : 'pending';
      const status = d.status || t('team.pendingStatus');
      if (d.todoId) {
        delegationsHtml += `<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.82rem; padding:6px; background:var(--card-bg-alt); border-radius:4px; border:1px solid var(--card-border); cursor:pointer;" onclick="closeModal('modal-collab-details'); openTodoOverlay('${escA(d.todoId)}');"><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; margin-right:0.5rem;">${escH(d.text || t('todo.newShort'))}</span><span class="sl-badge sl-badge-${statusClass}" style="font-size:0.65rem; padding:1px 4px;">${escH(status)}</span></div>`;
      } else {
        delegationsHtml += `<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.82rem; padding:6px; background:var(--card-bg-alt); border-radius:4px; border:1px solid var(--card-border);"><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; margin-right:0.5rem;">${escH(d.text || t('todo.newShort'))}</span><span class="sl-badge sl-badge-${statusClass}" style="font-size:0.65rem; padding:1px 4px;">${escH(status)}</span></div>`;
      }
    });
    delegationsHtml += `</div>`;
  }

  let relatedNotesHtml = '';
  if (relatedNotes.length === 0) {
    relatedNotesHtml = `<div style="font-size:0.85rem; color:var(--text-muted); font-style:italic;">${escH(t('team.noRelatedNotesYet'))}</div>`;
  } else {
    relatedNotesHtml = `<div style="display:flex; flex-direction:column; gap:0.4rem; max-height:220px; overflow-y:auto;">`;
    relatedNotes.forEach(n => {
      relatedNotesHtml += `<div style="font-size:0.82rem; padding:6px; background:var(--card-bg-alt); border-radius:4px; border:1px solid var(--card-border);"><a style="cursor:pointer; text-decoration:underline; font-weight:600; color:var(--accent);" onclick="closeModal('modal-collab-details'); openNoteFromCollaborator('${escA(n.path)}', '${escA(dbLabel)}')">${escH(n.title || n.path || t('board.newNoteShort'))}</a><span style="font-size:0.72rem; color:var(--text-muted); margin-left:6px;">${escH(n.date || '')}</span></div>`;
    });
    relatedNotesHtml += `</div>`;
  }

  contentDiv.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--card-border); padding-bottom:1rem; margin-bottom:1rem;">
      <div style="display:flex; align-items:center;">
        ${swatchHtml}
        <h2 style="margin:0; font-size:1.5rem; color:var(--text); text-transform:capitalize;">${escH(cleanName)}</h2>
      </div>
      <div style="display:flex; align-items:center; gap:0.5rem">
        ${syncButtonHtml}
        <div style="position:relative" class="collab-action-menu-container">
          <button class="btn btn-secondary" style="font-size:1rem; padding:2px 8px;" title="${escA(t('team.moreActions'))}" aria-label="${escA(t('team.moreActions'))}" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">⋮</button>
          <div class="collab-action-menu" style="display:none; position:absolute; right:0; top:100%; margin-top:4px; background:var(--card-bg); border:1px solid var(--card-border); border-radius:var(--radius-sm); z-index:1000; box-shadow:var(--shadow-lg); min-width:120px; text-align:left;">
              <div style="padding:8px 12px; cursor:pointer; font-size:0.85rem;" onmouseover="this.style.background='var(--card-bg-alt)'" onmouseout="this.style.background='transparent'" onclick="renameCollaboratorGlobal('${escA(dbLabel)}'); this.parentElement.style.display='none'">${escH(t('team.renameCollaborator'))}</div>
              ${targetId !== 'me' ? `
              <div style="padding:8px 12px; cursor:pointer; font-size:0.85rem;" onmouseover="this.style.background='var(--card-bg-alt)'" onmouseout="this.style.background='transparent'" onclick="mergeColleagueGlobal('${escA(dbLabel)}'); this.parentElement.style.display='none'">${escH(t('team.mergeColleague') || 'Merge colleague...')}</div>
              <div style="padding:8px 12px; cursor:pointer; font-size:0.85rem; color:var(--danger, #ef4444);" onmouseover="this.style.background='var(--card-bg-alt)'" onmouseout="this.style.background='transparent'" onclick="deleteCollaboratorGlobal('${escA(dbLabel)}'); this.parentElement.style.display='none'">${escH(t('team.deleteCollaboratorMentions'))}</div>
              <div style="padding:8px 12px; cursor:pointer; font-size:0.85rem; color:var(--danger, #ef4444);" onmouseover="this.style.background='var(--card-bg-alt)'" onmouseout="this.style.background='transparent'" onclick="deleteColleagueEntirelyGlobal('${escA(dbLabel)}'); this.parentElement.style.display='none'">${escH(t('team.deleteColleagueEntirely') || 'Delete colleague entirely')}</div>
              ` : ''}
          </div>
        </div>
      </div>
    </div>

    <!-- Team & Role Settings -->
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.2rem; margin-bottom:1rem; border-bottom:1px solid var(--card-border); padding-bottom:1rem;">
      <div>
        <label style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:4px;">Team / Équipe</label>
        <div style="display:flex; gap:6px;">
          <select id="collab-details-team-select" style="flex:1; padding:6px; border:1px solid var(--card-border); border-radius:4px; background:var(--card-bg); color:var(--text); font-size:0.85rem;">
            ${colleaguesDb.teams.map(team => {
              const displayTeamName = getTeamDisplayName(team);
              return `<option value="${team.id}" ${team.id === currentTeamId ? 'selected' : ''}>${escH(displayTeamName)}</option>`;
            }).join('')}
          </select>
          <button class="btn btn-secondary" id="collab-details-create-team-btn" style="padding: 2px 8px; font-size: 0.85rem;" title="Create new team">+</button>
        </div>
      </div>
      <div>
        <label style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:4px;">Role / Rôle</label>
        <label id="collab-details-is-manager-label" style="display:flex; align-items:center; gap:8px; cursor:${currentTeamId === 'team-other-bucket' ? 'default' : 'pointer'}; margin-top:8px; font-size:0.85rem; color:var(--text); opacity:${currentTeamId === 'team-other-bucket' ? 0.5 : 1}; pointer-events:${currentTeamId === 'team-other-bucket' ? 'none' : 'auto'};">
          <input type="checkbox" id="collab-details-is-manager" ${isManagerOfCurrentTeam ? 'checked' : ''} ${currentTeamId === 'team-other-bucket' ? 'disabled' : ''} style="width:16px; height:16px;">
          <span>${escH(t('team.managerLabel') || 'Manager')}</span>
        </label>
      </div>
    </div>

    <!-- Tags Editor -->
    <div style="margin-bottom:1rem; border-bottom:1px solid var(--card-border); padding-bottom:1rem;">
      <label style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:4px;">Tags (VIP, Important, Vite...)</label>
      <input type="text" id="collab-details-tags-input" value="${escA(collabTags.join(', '))}" placeholder="Enter tags separated by commas..." style="width:100%; box-sizing:border-box; padding:6px; border:1px solid var(--card-border); border-radius:4px; background:var(--card-bg); color:var(--text); font-size:0.85rem;">
    </div>

    <!-- Reporting Hierarchy -->
    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:1.2rem; margin-bottom:1rem; border-bottom:1px solid var(--card-border); padding-bottom:1rem;">
      <div>
        <label style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:4px;">Reports to / Manager</label>
        <div style="font-size:0.85rem; color:var(--text); margin-top:4px;">
          ${managerHtml}
        </div>
      </div>
      <div>
        <label style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:4px;">Peers / Pairs</label>
        <div style="font-size:0.85rem; color:var(--text); margin-top:4px; max-height: 80px; overflow-y:auto; display:flex; flex-direction:column; gap:4px;">
          ${peersHtml}
        </div>
      </div>
      <div>
        <label style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:4px;">Direct Reports / Directs</label>
        <div style="font-size:0.85rem; color:var(--text); margin-top:4px; max-height: 80px; overflow-y:auto; display:flex; flex-direction:column; gap:4px;">
          ${directsHtml}
        </div>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.45rem; border-top:1px solid var(--card-border); padding-top:0.8rem;">
      <div style="font-size:0.86rem; font-weight:700; text-transform:uppercase; color:var(--text-muted);">${escH(t('team.delegatedTasks'))} (${pendingDelegations.length})</div>
    </div>
    ${delegationsHtml}
    <button class="btn btn-primary team-assign-task-btn" onclick="closeModal('modal-collab-details'); assignTaskToCollaborator('${escA(dbLabel)}', { closeModalFirst: true });">${escH(t('team.assignTask'))}</button>

    <div style="font-size:0.86rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:0.45rem; border-top:1px solid var(--card-border); padding-top:0.8rem;">${escH(t('team.nextSyncMeetings'))} (${syncTop10.length})</div>
    ${syncListHtml}

    <div style="font-size:0.86rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:0.45rem; border-top:1px solid var(--card-border); padding-top:0.8rem;">${escH(t('team.otherUpcomingMeetings'))} (${upcomingNonSyncMeetings.length})</div>
    ${meetingsHtml}

    <div style="font-size:0.86rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:0.45rem; border-top:1px solid var(--card-border); padding-top:0.8rem;">${escH(t('team.pastRelatedNotes'))} (${relatedNotes.length})</div>
    ${relatedNotesHtml}
  `;

  openModal('modal-collab-details');

  // Attach Event Listeners for Colleague Details Panel
  const teamSelect = document.getElementById('collab-details-team-select');
  const managerCheckbox = document.getElementById('collab-details-is-manager');
  const tagsInput = document.getElementById('collab-details-tags-input');

  if (teamSelect) {
    teamSelect.addEventListener('change', async () => {
      const newTeamId = teamSelect.value;
      if (targetId === 'me') {
        colleaguesDb.me.teamId = newTeamId;
      } else {
        const colRecord = colleaguesDb.colleagues.find(c => c.id === targetId);
        if (colRecord) colRecord.teamId = newTeamId;
      }

      if (managerCheckbox) {
        const labelEl = document.getElementById('collab-details-is-manager-label');
        if (newTeamId === 'team-other-bucket') {
          managerCheckbox.checked = false;
          managerCheckbox.disabled = true;
          if (labelEl) {
            labelEl.style.opacity = '0.5';
            labelEl.style.pointerEvents = 'none';
            labelEl.style.cursor = 'default';
          }
          // Clear if they were manager
          const team = colleaguesDb.teams.find(t => t.id === newTeamId);
          if (team && team.managerId === targetId) team.managerId = '';
        } else {
          managerCheckbox.disabled = false;
          if (labelEl) {
            labelEl.style.opacity = '1';
            labelEl.style.pointerEvents = 'auto';
            labelEl.style.cursor = 'pointer';
          }
          const team = colleaguesDb.teams.find(t => t.id === newTeamId);
          managerCheckbox.checked = team ? team.managerId === targetId : false;
        }
      }

      await saveColleaguesDb();
      reindexColleaguesDb();
      if (typeof renderTeamPanel === 'function') renderTeamPanel();
      if (typeof renderBoard === 'function') renderBoard();
      showCollaboratorModal(name);
    });
  }

  if (managerCheckbox) {
    managerCheckbox.addEventListener('change', async () => {
      const activeTeamId = teamSelect ? teamSelect.value : '';
      if (!activeTeamId || activeTeamId === 'team-other-bucket') return;

      const team = colleaguesDb.teams.find(t => t.id === activeTeamId);
      if (team) {
        if (managerCheckbox.checked) {
          // If another colleague is manager, they are replaced.
          // Clear managers of this team
          colleaguesDb.teams.forEach(t => {
            if (t.id === activeTeamId) {
              t.managerId = targetId;
            }
          });
        } else {
          if (team.managerId === targetId) {
            team.managerId = '';
          }
        }
      }

      await saveColleaguesDb();
      reindexColleaguesDb();
      if (typeof renderTeamPanel === 'function') renderTeamPanel();
      if (typeof renderBoard === 'function') renderBoard();
      showCollaboratorModal(name);
    });
  }

  if (tagsInput) {
    tagsInput.addEventListener('change', async () => {
      const tags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
      setCollaboratorLabels(dbLabel, tags);
      if (typeof renderTeamPanel === 'function') renderTeamPanel();
      if (typeof renderBoard === 'function') renderBoard();
      showCollaboratorModal(name);
    });
  }

  const createTeamBtn = document.getElementById('collab-details-create-team-btn');
  if (createTeamBtn) {
    createTeamBtn.addEventListener('click', async () => {
      const teamName = await showPromptDialog("Nom de la nouvelle équipe / New team name:");
      if (!teamName || !teamName.trim()) return;

      const newTeam = {
        id: 'team-' + Date.now(),
        name: teamName.trim(),
        managerId: ''
      };
      colleaguesDb.teams.push(newTeam);
      await saveColleaguesDb();
      reindexColleaguesDb();
      if (typeof renderTeamPanel === 'function') renderTeamPanel();
      showCollaboratorModal(name);
    });
  }
}
window.showCollaboratorModal = showCollaboratorModal;

// --- Global Collaborator Rename & Delete ---

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function remapCollaboratorKeyAcrossSettings(oldName, newName) {
  const oldKey = normalizeCollaboratorKey(oldName);
  const newKey = normalizeCollaboratorKey(newName);
  if (!oldKey || !newKey || oldKey === newKey) return false;

  const settingsRef = getAppSettingsRef();
  let changed = false;

  const registry = getCollaboratorRegistryState();
  const registrySet = new Set(registry.keys);
  if (registrySet.has(oldKey)) {
    registrySet.delete(oldKey);
    changed = true;
  }
  if (!registrySet.has(newKey)) {
    registrySet.add(newKey);
    changed = true;
  }
  const nextRegistryKeys = Array.from(registrySet);
  if (nextRegistryKeys.length !== registry.keys.length || nextRegistryKeys.some((k, idx) => k !== registry.keys[idx])) {
    registry.keys = nextRegistryKeys;
    changed = true;
  }

  const aliases = getCollaboratorAliasMap();
  if (aliases[oldKey]) {
    if (!aliases[newKey]) aliases[newKey] = aliases[oldKey];
    delete aliases[oldKey];
    changed = true;
  }

  const labelsMap = getCollaboratorLabelsMap();
  if (Array.isArray(labelsMap[oldKey])) {
    const existing = Array.isArray(labelsMap[newKey]) ? labelsMap[newKey] : [];
    labelsMap[newKey] = Array.from(new Set([...existing, ...labelsMap[oldKey]]));
    delete labelsMap[oldKey];
    changed = true;
  }

  const hiddenSet = getCollaboratorHiddenSet();
  if (hiddenSet.has(oldKey)) {
    hiddenSet.delete(oldKey);
    hiddenSet.add(newKey);
    settingsRef.hiddenCollaborators = Array.from(hiddenSet).sort();
    changed = true;
  }

  const teamState = getTeamGroupsState();
  teamState.groups.forEach(group => {
    if (!Array.isArray(group.members) || group.members.length === 0) return;
    const before = group.members.join('|');
    group.members = Array.from(new Set(group.members.map(memberKey => memberKey === oldKey ? newKey : memberKey)));
    if (group.members.join('|') !== before) changed = true;
  });

  if (changed) {
    saveCollaboratorSettings();
  }
  return changed;
}

window.renameCollaboratorGlobal = async function(oldName) {
  const newName = await showPromptDialog(
    t('team.renameCollaboratorPrompt', { name: oldName }),
    oldName,
    { okLabel: t('team.renameCollaborator'), cancelLabel: t('editor.cancel') }
  );
  if (!newName || newName.trim() === '' || newName === oldName) return;
  const cleanNewName = newName.trim();

  const targetId = resolveColleagueId(oldName, { allowCreate: false, allowMe: false });
  if (!targetId) return;

  // 1. Rename in colleaguesDb
  const rec = colleaguesById.get(targetId);
  if (rec) {
    rec.label = cleanNewName;
  }

  // 2. Remap collaborator key across settings
  remapCollaboratorKeyAcrossSettings(oldName, cleanNewName);
  
  // 3. Update collaborator mentions in all notes (mentions etc)
  await updateCollaboratorInAllNotes(oldName, cleanNewName);

  // 4. Update tasks in todosManifest
  let todosChanged = false;
  if (Array.isArray(todosManifest)) {
    todosManifest.forEach(todo => {
      if (!todo || typeof todo !== 'object') return;
      const ownerId = resolveColleagueId(todo.ownerId || todo.owner || 'me', { allowCreate: false, allowMe: true }) || 'me';
      if (ownerId === targetId) {
        todo.owner = cleanNewName;
        todosChanged = true;
      }
    });
  }

  // 5. Update calendar events in plannerEvents
  let plannerChanged = false;
  if (Array.isArray(plannerEvents)) {
    plannerEvents.forEach(event => {
      if (!event || typeof event !== 'object') return;
      let changed = false;
      if (Array.isArray(event.collaborators)) {
        const idx = event.collaborators.findIndex(c => normalizeCollaboratorKey(c) === normalizeCollaboratorKey(oldName));
        if (idx !== -1) {
          event.collaborators[idx] = cleanNewName;
          changed = true;
        }
      }
      if (changed) plannerChanged = true;
    });
  }

  if (todosChanged && typeof saveTodosManifest === 'function') {
    await saveTodosManifest();
  }
  if (plannerChanged && typeof savePlanner === 'function') {
    await savePlanner();
  }

  // 6. Save DB, re-index, and dedupe
  await saveColleaguesDb();
  reindexColleaguesDb();
  await dedupeColleaguesWorkspaceData({ persist: true });

  // 7. Refresh UI
  closeModal('modal-collab-details');
  renderTeamPanel();
  if (typeof renderBoard === 'function') renderBoard();
};

window.deleteCollaboratorGlobal = async function(oldName) {
  const confirmed = await showConfirmDialog(
    t('team.confirmDeleteCollaboratorMentions', { name: oldName }),
    { isDanger: true, confirmLabel: t('team.deleteCollaboratorMentions') }
  );
  if (!confirmed) return;
  
  await updateCollaboratorInAllNotes(oldName, null);
  closeModal('modal-collab-details');
  renderTeamPanel();
  if (typeof renderBoard === 'function') renderBoard();
};

window.deleteColleagueEntirelyGlobal = async function(oldName) {
  const confirmed = await showConfirmDialog(
    t('team.deleteColleagueEntirelyConfirm', { name: oldName }) || `Are you sure you want to delete ${oldName} entirely? This will remove them from the database, clear their team assignments, and remove their mentions from all notes.`,
    { isDanger: true, confirmLabel: t('team.deleteColleagueEntirely') || "Delete Entirely" }
  );
  if (!confirmed) return;

  const targetId = resolveColleagueId(oldName, { allowCreate: false, allowMe: false });
  if (!targetId) return;

  // 1. Remove colleague record
  colleaguesDb.colleagues = colleaguesDb.colleagues.filter(c => c.id !== targetId);

  // 2. Clear managers of teams
  colleaguesDb.teams.forEach(t => {
    if (t.managerId === targetId) {
      t.managerId = '';
    }
  });

  // 3. Update settings and groups
  const oldKey = normalizeCollaboratorKey(oldName);
  const settingsRef = getAppSettingsRef();
  if (settingsRef) {
    const registry = getCollaboratorRegistryState();
    if (registry && Array.isArray(registry.keys)) {
      registry.keys = registry.keys.filter(k => k !== oldKey);
    }
    const aliases = getCollaboratorAliasMap();
    if (aliases && aliases[oldKey]) {
      delete aliases[oldKey];
    }
    const labelsMap = getCollaboratorLabelsMap();
    if (labelsMap && labelsMap[oldKey]) {
      delete labelsMap[oldKey];
    }
    const hiddenSet = getCollaboratorHiddenSet();
    if (hiddenSet && hiddenSet.has(oldKey)) {
      hiddenSet.delete(oldKey);
      settingsRef.hiddenCollaborators = Array.from(hiddenSet).sort();
    }
    const teamState = getTeamGroupsState();
    if (teamState && Array.isArray(teamState.groups)) {
      teamState.groups.forEach(group => {
        if (Array.isArray(group.members)) {
          group.members = group.members.filter(m => m !== oldKey);
        }
      });
    }
    saveCollaboratorSettings();
  }

  // 4. Update HTML notes (mentions etc)
  await updateCollaboratorInAllNotes(oldName, null);

  // 5. Update and save databases
  await saveColleaguesDb();
  reindexColleaguesDb();
  await dedupeColleaguesWorkspaceData({ persist: true });

  // 6. Refresh UI
  closeModal('modal-collab-details');
  renderTeamPanel();
  if (typeof renderBoard === 'function') renderBoard();
  toast(t('team.deleteSuccessToast', { name: oldName }) || `Colleague ${oldName} deleted entirely.`);
};

window.mergeColleagueGlobal = async function(primaryName) {
  const primaryId = resolveColleagueId(primaryName, { allowCreate: false, allowMe: true });
  if (!primaryId) return;

  // Get all potential source colleagues (excluding the primary colleague)
  const allColleagues = getAllColleagueRecords({ includeMe: true, includeHidden: true });
  const candidates = allColleagues.filter(c => c.id !== primaryId);

  if (candidates.length === 0) {
    await showAlertDialog(t('team.noOtherColleagues') || "There are no other colleagues to merge.");
    return;
  }

  // Create standard overlay modal for checkbox selection
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.style.zIndex = 3000;

  const box = document.createElement('div');
  box.className = 'dialog-box';
  box.style.width = '400px';

  const title = document.createElement('div');
  title.className = 'dialog-message';
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '10px';
  title.textContent = t('team.mergeIntoTitle', { name: primaryName }) || `Merge into ${primaryName}`;
  box.appendChild(title);

  // Warning text
  const warning = document.createElement('div');
  warning.style.cssText = 'font-size:0.8rem; background:var(--card-bg-alt); border-left:4px solid var(--accent); padding:8px; margin-bottom:12px; color:var(--text-muted); line-height:1.4;';
  warning.textContent = t('team.mergeIntoDescription', { name: primaryName }) || `Select colleagues to merge into "${primaryName}". All their tasks, planner events, team management, and note mentions will be remapped to "${primaryName}", and they will be deleted.`;
  box.appendChild(warning);

  // Search input
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'dialog-input';
  searchInput.placeholder = t('team.searchPlaceholderColleague') || 'Search colleague...';
  searchInput.style.cssText = 'width:100%; padding:8px; box-sizing:border-box; margin-bottom:8px; background:var(--card-bg); color:var(--text); border:1px solid var(--card-border); border-radius:4px;';
  box.appendChild(searchInput);

  // Selected names label
  const selectedSummary = document.createElement('div');
  selectedSummary.id = 'merge-selected-summary';
  selectedSummary.style.cssText = 'font-size:0.8rem; color:var(--accent); font-weight:600; margin-bottom:10px; display:none; max-height:40px; overflow-y:auto;';
  box.appendChild(selectedSummary);

  // Checkbox container
  const checkboxContainer = document.createElement('div');
  checkboxContainer.style.cssText = 'display:flex; flex-direction:column; gap:8px; max-height:200px; overflow-y:auto; border:1px solid var(--card-border); padding:8px; border-radius:4px; margin-bottom:20px; background:var(--card-bg);';

  candidates.forEach(c => {
    const row = document.createElement('label');
    row.className = 'merge-colleague-row';
    row.dataset.colleagueName = c.label.toLowerCase();
    row.style.cssText = 'display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.9rem; color:var(--text); padding:4px; border-radius:3px;';
    
    row.onmouseover = () => row.style.background = 'var(--card-bg-alt)';
    row.onmouseout = () => row.style.background = 'transparent';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = c.id;
    cb.dataset.name = c.label;
    cb.style.cssText = 'width:16px; height:16px; cursor:pointer;';
    
    const labelSpan = document.createElement('span');
    labelSpan.textContent = c.id === 'me' ? `${c.label} (Me)` : c.label;
    
    row.appendChild(cb);
    row.appendChild(labelSpan);
    checkboxContainer.appendChild(row);
  });
  box.appendChild(checkboxContainer);

  // Search logic: checked rows stay visible, unchecked rows are filtered
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    const rows = checkboxContainer.querySelectorAll('.merge-colleague-row');
    rows.forEach(r => {
      const cb = r.querySelector('input[type="checkbox"]');
      const name = r.dataset.colleagueName;
      if (cb.checked || name.includes(q)) {
        r.style.display = 'flex';
      } else {
        r.style.display = 'none';
      }
    });
  });

  // Selected summary logic
  const updateSelectedSummary = () => {
    const checkedBoxes = Array.from(checkboxContainer.querySelectorAll('input[type="checkbox"]:checked'));
    if (checkedBoxes.length > 0) {
      const names = checkedBoxes.map(cb => cb.dataset.name).join(', ');
      selectedSummary.textContent = `${t('team.selectedColleaguesLabel') || 'Selected:'} ${names}`;
      selectedSummary.style.display = 'block';
    } else {
      selectedSummary.textContent = '';
      selectedSummary.style.display = 'none';
    }
  };

  checkboxContainer.addEventListener('change', (e) => {
    if (e.target && e.target.type === 'checkbox') {
      updateSelectedSummary();
    }
  });

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = t('editor.cancel') || 'Cancel';
  cancelBtn.onclick = () => {
    overlay.remove();
  };
  actions.appendChild(cancelBtn);

  const mergeBtn = document.createElement('button');
  mergeBtn.className = 'btn btn-save';
  mergeBtn.textContent = t('team.mergeColleague') || 'Merge';
  mergeBtn.onclick = async () => {
    const checkedBoxes = Array.from(checkboxContainer.querySelectorAll('input[type="checkbox"]:checked'));
    if (checkedBoxes.length === 0) {
      await showAlertDialog(t('team.pleaseSelectColleague') || "Please select at least one colleague to merge.");
      return;
    }

    const selectedNames = checkedBoxes.map(cb => cb.dataset.name).join(', ');
    const confirmed = await showConfirmDialog(
      t('team.confirmMergePrompt', { names: selectedNames, target: primaryName }) || `Are you sure you want to merge ${selectedNames} into ${primaryName}? This action is permanent.`,
      { isDanger: true, confirmLabel: t('team.mergeColleague') || "Merge" }
    );
    if (!confirmed) return;

    toast(t('common.processing') || "Processing...");
    overlay.remove();

    let todosChanged = false;
    let plannerChanged = false;

    for (const cb of checkedBoxes) {
      const sourceId = cb.value;
      const sourceName = cb.dataset.name;

      if (sourceId === 'me') {
        await showAlertDialog("Cannot merge 'Me' (current user) into another colleague.");
        continue;
      }

      // 1. Rename collaborator key across settings
      remapCollaboratorKeyAcrossSettings(sourceName, primaryName);

      // 2. Update collaborator mentions in all notes
      await updateCollaboratorInAllNotes(sourceName, primaryName);

      // 3. Update database: remove source colleague record
      colleaguesDb.colleagues = colleaguesDb.colleagues.filter(c => c.id !== sourceId);

      // 4. Update team management: if source managed a team, transfer to primary
      colleaguesDb.teams.forEach(t => {
        if (t.managerId === sourceId) {
          if (primaryId && !colleaguesDb.teams.some(team => team.id !== t.id && team.managerId === primaryId)) {
            t.managerId = primaryId;
          } else {
            t.managerId = '';
          }
        }
      });

      // 5. Update tasks in todosManifest
      if (Array.isArray(todosManifest)) {
        todosManifest.forEach(todo => {
          if (!todo || typeof todo !== 'object') return;
          const ownerId = resolveColleagueId(todo.ownerId || todo.owner || 'me', { allowCreate: false, allowMe: true }) || 'me';
          if (ownerId === sourceId) {
            todo.ownerId = primaryId;
            todo.owner = primaryId === 'me' ? getDefaultMeLabel() : primaryName;
            todosChanged = true;
          }
        });
      }

      // 6. Update calendar events in plannerEvents
      if (Array.isArray(plannerEvents)) {
        plannerEvents.forEach(event => {
          if (!event || typeof event !== 'object') return;
          let changed = false;
          if (Array.isArray(event.collaboratorIds)) {
            const idx = event.collaboratorIds.indexOf(sourceId);
            if (idx !== -1) {
              event.collaboratorIds.splice(idx, 1);
              if (primaryId !== 'me' && !event.collaboratorIds.includes(primaryId)) {
                event.collaboratorIds.push(primaryId);
              }
              changed = true;
            }
          }
          if (Array.isArray(event.collaborators)) {
            const idx = event.collaborators.findIndex(c => normalizeCollaboratorKey(c) === normalizeCollaboratorKey(sourceName));
            if (idx !== -1) {
              event.collaborators.splice(idx, 1);
              if (primaryId !== 'me' && !event.collaborators.some(c => normalizeCollaboratorKey(c) === normalizeCollaboratorKey(primaryName))) {
                event.collaborators.push(primaryName);
              }
              changed = true;
            }
          }
          if (changed) plannerChanged = true;
        });
      }
    }

    if (todosChanged && typeof saveTodosManifest === 'function') {
      await saveTodosManifest();
    }
    if (plannerChanged && typeof savePlanner === 'function') {
      await savePlanner();
    }

    // 7. Save DB, re-index, and dedupe
    await saveColleaguesDb();
    reindexColleaguesDb();
    await dedupeColleaguesWorkspaceData({ persist: true });

    // 8. Refresh UI
    closeModal('modal-collab-details');
    renderTeamPanel();
    if (typeof renderBoard === 'function') renderBoard();
    toast(t('team.mergeSuccessToast', { name: primaryName }) || `Successfully merged selected colleagues into ${primaryName}.`);
  };
  actions.appendChild(mergeBtn);
  box.appendChild(actions);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
};

function showProgressModal(titleText, statusText) {
  let overlay = document.getElementById('progress-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'progress-modal-overlay';
    overlay.className = 'dialog-overlay';
    overlay.style.zIndex = 4000;

    const box = document.createElement('div');
    box.className = 'dialog-box';
    box.style.width = '350px';

    const title = document.createElement('div');
    title.id = 'progress-modal-title';
    title.style.fontWeight = 'bold';
    title.style.fontSize = '1.1rem';
    box.appendChild(title);

    const status = document.createElement('div');
    status.id = 'progress-modal-status';
    status.style.fontSize = '0.85rem';
    status.style.color = 'var(--text-muted)';
    box.appendChild(status);

    const barOuter = document.createElement('div');
    barOuter.style.cssText = 'width:100%; height:8px; background:var(--card-border); border-radius:4px; overflow:hidden;';
    
    const barInner = document.createElement('div');
    barInner.id = 'progress-modal-bar';
    barInner.style.cssText = 'width:0%; height:100%; background:var(--accent); transition:width 0.1s ease-out;';
    barOuter.appendChild(barInner);
    box.appendChild(barOuter);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  const pTitle = document.getElementById('progress-modal-title');
  if (pTitle) pTitle.textContent = titleText;
  const pStatus = document.getElementById('progress-modal-status');
  if (pStatus) pStatus.textContent = statusText;
  const pBar = document.getElementById('progress-modal-bar');
  if (pBar) pBar.style.width = '0%';
  return overlay;
}

function updateProgressModal(statusText, percent) {
  const status = document.getElementById('progress-modal-status');
  if (status) status.textContent = statusText;
  const bar = document.getElementById('progress-modal-bar');
  if (bar) bar.style.width = `${percent}%`;
}

function hideProgressModal() {
  const overlay = document.getElementById('progress-modal-overlay');
  if (overlay) overlay.remove();
}

async function updateCollaboratorInAllNotes(oldName, newName) {
  const affectedNotes = new Set();
  
  // Find affected notes using cache
  Object.keys(collaborativeDataCache).forEach(path => {
    const data = collaborativeDataCache[path];
    const hasDelegation = data.delegations?.some(d => d.collaborator.toLowerCase() === oldName.toLowerCase());
    const hasMention = data.mentions?.some(m => m.collaborator.toLowerCase() === oldName.toLowerCase());
    if (hasDelegation || hasMention) {
      affectedNotes.add(path);
    }
  });

  const total = affectedNotes.size;
  const operationName = newName === null 
    ? (t('team.deletingProgress') || 'Deleting') 
    : (t('team.mergingProgress') || 'Merging');
    
  showProgressModal(
    `${operationName} ${oldName}...`,
    total === 0 ? "Updating database..." : `Found ${total} affected notes. Starting...`
  );

  if (total === 0) {
    updateProgressModal("Done", 100);
    setTimeout(hideProgressModal, 300);
    return;
  }
  
  try {
    let idx = 0;
    for (const path of affectedNotes) {
      idx++;
      const percent = Math.round((idx / total) * 100);
      const filename = path.split('/').pop() || path;
      updateProgressModal(`Updating ${filename} (${idx}/${total})...`, percent);
      
      await updateNoteAtPath(path, (base) => {
        let updatedHtml = base.mainHTML || '';
        const oldNameRegexStr = escapeRegexLiteral(oldName);
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(updatedHtml, 'text/html');

        // 1. Update elements with onclick attribute referencing showCollaboratorModal('oldName')
        const allElements = doc.querySelectorAll('*');
        allElements.forEach(el => {
          const onclick = el.getAttribute('onclick');
          if (onclick) {
            const pattern = new RegExp(`showCollaboratorModal\\s*\\(\\s*['"]${oldNameRegexStr}['"]\\s*\\)`, 'i');
            if (pattern.test(onclick)) {
              if (newName) {
                const newOnclick = onclick.replace(pattern, `showCollaboratorModal('${newName.replace(/'/g, "\\'")}')`);
                el.setAttribute('onclick', newOnclick);
              } else {
                el.removeAttribute('onclick');
                if (el.classList.contains('pill-mention')) {
                  el.classList.remove('pill-mention');
                }
              }
            }
          }
        });

        // Helper text node walker
        const walkTextNodes = (node, fn) => {
          if (node.nodeType === Node.TEXT_NODE) {
            fn(node);
          } else {
            for (let i = 0; i < node.childNodes.length; i++) {
              walkTextNodes(node.childNodes[i], fn);
            }
          }
        };

        // 2. Walk all text nodes and replace references (case-insensitive) using boundary lookahead
        walkTextNodes(doc.body, (textNode) => {
          const originalText = textNode.nodeValue;
          let newText = originalText;
          
          if (newName) {
            const regex = new RegExp(`@${oldNameRegexStr}(?![a-zA-Z0-9_])`, 'gi');
            newText = newText.replace(regex, `@${newName}`);
          } else {
            const regex = new RegExp(`@${oldNameRegexStr}(?![a-zA-Z0-9_])`, 'gi');
            newText = newText.replace(regex, oldName);
          }
          
          if (newText !== originalText) {
            textNode.nodeValue = newText;
          }
        });

        updatedHtml = doc.body.innerHTML;
        
        let newTopics = base.topic_tags || [];
        const topicIdx = newTopics.findIndex(t => t.toLowerCase() === oldName.toLowerCase());
        if (topicIdx !== -1) {
            if (newName) {
                newTopics[topicIdx] = newName;
            } else {
                newTopics.splice(topicIdx, 1);
            }
        }
        
        return { mainHTML: updatedHtml, topic_tags: newTopics };
      });
      // Also update the index cache
      await updateNoteInCollabIndex(path);
    }
    
    // Refresh UI
    if (typeof renderBoard === 'function') renderBoard();
    if (typeof renderTeamPanel === 'function') renderTeamPanel();
    
    updateProgressModal("Done", 100);
    setTimeout(hideProgressModal, 300);
  } catch (err) {
    hideProgressModal();
    console.error("Error updating collaborators:", err);
    await showAlertDialog(t('team.updateCollaboratorsError', { message: err.message }));
  }
}

