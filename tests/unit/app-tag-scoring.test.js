import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Bloc Editor Tag Scoring and Default Tag System', () => {
  let tokenizeTitle;
  let calculateTitleSimilarity;
  let computeTagScores;
  let populateTagEditor;
  let readTagEditor;

  let setManifest;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();

    const utilsCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-utils.js'), 'utf8');
    const overlayCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-overlay.js'), 'utf8');

    const env = new Function(`
      var window = globalThis;
      globalThis.window = globalThis;
      var t = (k, params) => k;
      var manifest = [];
      var todosManifest = [];
      ${utilsCode}
      ${overlayCode}
      return {
        tokenizeTitle: typeof tokenizeTitle !== 'undefined' ? tokenizeTitle : globalThis.tokenizeTitle,
        calculateTitleSimilarity: typeof calculateTitleSimilarity !== 'undefined' ? calculateTitleSimilarity : globalThis.calculateTitleSimilarity,
        computeTagScores: typeof computeTagScores !== 'undefined' ? computeTagScores : globalThis.computeTagScores,
        populateTagEditor: typeof populateTagEditor !== 'undefined' ? populateTagEditor : globalThis.populateTagEditor,
        readTagEditor: typeof readTagEditor !== 'undefined' ? readTagEditor : globalThis.readTagEditor,
        setManifest: (m) => { manifest = m; globalThis.manifest = m; }
      };
    `)();

    tokenizeTitle = env.tokenizeTitle;
    calculateTitleSimilarity = env.calculateTitleSimilarity;
    computeTagScores = env.computeTagScores;
    populateTagEditor = env.populateTagEditor;
    readTagEditor = env.readTagEditor;
    setManifest = env.setManifest;
  });

  it('tokenizes titles by removing stop words and punctuation', () => {
    expect(typeof tokenizeTitle).toBe('function');
    const tokens = tokenizeTitle('Sync with Alice on the Frontend Architecture!');
    expect(tokens).toContain('sync');
    expect(tokens).toContain('alice');
    expect(tokens).toContain('frontend');
    expect(tokens).toContain('architecture');
    expect(tokens).not.toContain('with');
    expect(tokens).not.toContain('on');
    expect(tokens).not.toContain('the');
  });

  it('calculates title similarity accurately for identical and related titles', () => {
    expect(typeof calculateTitleSimilarity).toBe('function');
    const scoreExact = calculateTitleSimilarity('Sprint 42 Planning', 'Sprint 42 Planning');
    expect(scoreExact).toBe(1.0);

    const scoreSimilar = calculateTitleSimilarity('Sprint 42 Planning Meeting', 'Sprint 42 Planning Review');
    expect(scoreSimilar).toBeGreaterThan(0.5);

    const scoreUnrelated = calculateTitleSimilarity('Dentist Appointment', 'Sprint 42 Planning');
    expect(scoreUnrelated).toBe(0);
  });

  it('computes tag scores with boosts from title similarity, keywords, and co-occurrence', () => {
    expect(typeof computeTagScores).toBe('function');
    const mockManifest = [
      {
        id: 'note_1',
        title: 'Weekly Leadership Alignment',
        group_tags: ['Leadership'],
        major_topic_tags: ['Strategy'],
        topic_tags: ['Alice', 'Bob']
      },
      {
        id: 'note_2',
        title: 'Front-End Architecture Discussion',
        group_tags: ['Engineering'],
        major_topic_tags: ['Architecture'],
        topic_tags: ['Charlie']
      }
    ];

    // Case 1: Title matches note_2 title -> 'Architecture' and 'Engineering' should score highest
    const scores = computeTagScores({
      type: 'major',
      candidates: ['Architecture', 'Strategy', 'Marketing'],
      title: 'Front-End Architecture Sync',
      selectedTags: [],
      associatedTags: new Set(),
      manifest: mockManifest
    });

    expect(scores['Architecture']).toBeGreaterThan(scores['Marketing'] || 0);
    expect(scores['Architecture']).toBeGreaterThan(scores['Strategy'] || 0);

    // Case 2: Selected group is 'Leadership' -> co-occurrence should boost 'Strategy'
    const coOccurScores = computeTagScores({
      type: 'major',
      candidates: ['Architecture', 'Strategy', 'Marketing'],
      title: '',
      selectedTags: ['Leadership'],
      associatedTags: new Set(),
      manifest: mockManifest
    });

    expect(coOccurScores['Strategy']).toBeGreaterThan(coOccurScores['Marketing'] || 0);
  });

  it('defaults to empty group tags for call blocks in openPlannerEventModal', () => {
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');

    // Extract the initialGroupTags logic from app-planner.js
    const match = plannerCode.match(/let initialGroupTags = event\.group_tags && event\.group_tags\.length[\s\S]*?;/);
    expect(match).toBeTruthy();
    const snippet = match[0];
    
    // It should NOT contain 'Calls' as fallback
    expect(snippet).not.toContain("'Calls'");
  });

  it('ranks tag suggestions and applies matching-highlight when typing in planner title', () => {
    const titleInput = document.createElement('input');
    titleInput.id = 'pe-title';
    titleInput.value = 'Front-End Architecture Review';
    document.body.appendChild(titleInput);

    const majorContainer = document.createElement('div');
    majorContainer.id = 'pe-major-tags';
    document.body.appendChild(majorContainer);

    const mockManifest = [
      {
        id: 'n1',
        title: 'Front-End Architecture Guidelines',
        group_tags: ['Engineering'],
        major_topic_tags: ['Architecture'],
        topic_tags: ['Devs']
      },
      {
        id: 'n2',
        title: 'Marketing Budget',
        group_tags: ['Finance'],
        major_topic_tags: ['Marketing'],
        topic_tags: ['Sales']
      }
    ];
    setManifest(mockManifest);

    populateTagEditor('pe-major-tags', [], 'major');
    const input = majorContainer.querySelector('input.tag-add');
    expect(input).toBeTruthy();

    input.focus();
    const dropdown = document.querySelector('.tag-suggest-dropdown');
    expect(dropdown).toBeTruthy();

    // Check that chips are rendered
    const chips = dropdown.querySelectorAll('.tag-suggest-chip');
    expect(chips.length).toBeGreaterThan(0);

    const archChip = Array.from(chips).find(c => c.textContent.includes('Architecture'));
    expect(archChip).toBeTruthy();
    expect(archChip.className).toContain('matching-highlight');
  });
});
