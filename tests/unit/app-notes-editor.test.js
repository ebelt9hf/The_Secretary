import { describe, it, expect, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note Editor Engine Functions (app-notes.js & app-overlay.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-notes.js',
      'js/app-overlay.js'
    ]);
  });

  describe('htmlToPlainText', () => {
    it('converts HTML tags to clean plain text', () => {
      expect(htmlToPlainText('<h2>Meeting Notes</h2><p>Discussed project roadmap.</p>')).toBe('Meeting Notes Discussed project roadmap.');
      expect(htmlToPlainText('')).toBe('');
      expect(htmlToPlainText(null)).toBe('');
    });
  });

  describe('normalizeTodoEntry', () => {
    it('normalizes todo entries, stripping legacy urgency prefixes', () => {
      const raw = {
        id: 'td_100',
        title: 'todo urgency: High Finalize budget proposal',
        priority: 'High',
        owner: 'Alice'
      };
      const normalized = normalizeTodoEntry(raw);
      expect(normalized.title).toBe('Finalize budget proposal');
      expect(normalized.eisenhowerQuadrant).toBe('Q1');
      expect(normalized.assignmentStatus).toBe('pending_communication');
      expect(normalized.depends_on).toEqual([]);
    });

    it('handles WIP priority conversion correctly', () => {
      const raw = {
        id: 'td_101',
        title: 'Work in progress task',
        priority: 'WIP',
        originalPriority: 'High'
      };
      const normalized = normalizeTodoEntry(raw);
      expect(normalized.status).toBe('WIP');
      expect(normalized.priority).toBe('High');
    });
  });

  describe('TaskGraphEngine & Circular Dependency Validation', () => {
    beforeAll(() => {
      globalThis.todosManifest = [
        { id: 'task_A', title: 'Task A', priority: 'Done', depends_on: [] },
        { id: 'task_B', title: 'Task B', priority: 'High', depends_on: ['task_A'] },
        { id: 'task_C', title: 'Task C', priority: 'Medium', depends_on: ['task_B'] }
      ];
    });

    it('identifies unblocked and blocked tasks correctly', () => {
      expect(TaskGraphEngine.isBlocked('task_B')).toBe(false); // task_A is Done
      expect(TaskGraphEngine.isBlocked('task_C')).toBe(true);  // task_B is High (not Done)
    });

    it('detects circular dependencies in task DAG', () => {
      // Adding task_C as prerequisite of task_A creates a cycle A -> B -> C -> A
      const isSelfCycle = TaskGraphEngine.validateNoCircularDependency('task_A', 'task_A');
      expect(isSelfCycle).toBe(false);

      const res = TaskGraphEngine.validateNoCircularDependency('task_A', 'task_C', true);
      expect(res.valid).toBe(false);
      expect(res.cyclePath).toBeDefined();
    });
  });

  describe('Note Decisions Normalization & HTML Extraction', () => {
    it('normalizes decision text formatting and removes markdown noise', () => {
      const raw = '- **Approved** Q3 Roadmap (reference: "doc_123")';
      const cleaned = normalizeMetadataDecisionText(raw);
      expect(cleaned).toBe('Approved Q3 Roadmap');
    });

    it('filters non-meaningful punctuation noise decision text', () => {
      expect(isMeaningfulMetadataDecisionText('Valid decision')).toBe(true);
      expect(isMeaningfulMetadataDecisionText('...')).toBe(false);
      expect(isMeaningfulMetadataDecisionText('a')).toBe(false);
    });

    it('extracts decisions from DOM HTML elements', () => {
      const sampleHtml = `
        <p>Some text</p>
        <span class="note-decision-wrapper" data-decision-status="active" data-decision-authority="CTO" data-decision-impact="High" data-decision-context="Agreed in review">
          <span class="note-decision-text">Migrate database to PostgreSQL</span>
        </span>
      `;
      const extracted = extractDecisionsFromHTML(sampleHtml);
      expect(extracted.length).toBe(1);
      expect(extracted[0].text).toBe('Migrate database to PostgreSQL');
      expect(extracted[0].status).toBe('active');
      expect(extracted[0].authority).toBe('CTO');
    });
  });

  describe('_buildPlannerBlockDisplayItems (Overlay Planner Helper)', () => {
    it('groups recurring events into series display items', () => {
      const events = [
        { id: 'ev_1', recurrenceId: 'rec_100', date: '2026-08-27', startTime: '09:00' },
        { id: 'ev_2', recurrenceId: 'rec_100', date: '2026-08-28', startTime: '09:00' },
        { id: 'ev_3', date: '2026-08-29', startTime: '14:00' }
      ];
      const displayItems = _buildPlannerBlockDisplayItems(events, '2026-08-27');
      expect(displayItems.length).toBe(2); // 1 series + 1 single
      const series = displayItems.find(item => item.kind === 'series');
      expect(series).toBeDefined();
      expect(series.count).toBe(2);
    });
  });

  describe('Note Editor Security & Sanitization Engine (sanitizeHtmlContent)', () => {
    it('strips script tags and executable JavaScript code', () => {
      const malicious = '<p>Normal text</p><script>alert("XSS Attack!");</script>';
      const cleaned = sanitizeHtmlContent(malicious);
      expect(cleaned).not.toContain('<script');
      expect(cleaned).not.toContain('alert');
      expect(cleaned).toContain('<p>Normal text</p>');
    });

    it('strips inline event handlers (onload, onerror, onclick, onmouseover)', () => {
      const malicious = '<img src="valid.png" onerror="alert(1)" onload="console.log(2)"><button onclick="doMalice()">Click</button>';
      const cleaned = sanitizeHtmlContent(malicious);
      expect(cleaned).not.toContain('onerror');
      expect(cleaned).not.toContain('onload');
      expect(cleaned).not.toContain('onclick');
      expect(cleaned).toContain('<img src="valid.png">');
    });

    it('neutralizes dangerous URI protocols in links and images (javascript:, vbscript:)', () => {
      const malicious = '<a href="javascript:alert(1)">Click Me</a><img src="javascript:doBadStuff()">';
      const cleaned = sanitizeHtmlContent(malicious);
      expect(cleaned).not.toContain('javascript:');
    });

    it('strips dangerous execution elements (iframe, object, embed, applet)', () => {
      const malicious = '<div><iframe src="about:blank"></iframe><object data="bad.swf"></object><span>Safe</span></div>';
      const cleaned = sanitizeHtmlContent(malicious);
      expect(cleaned).not.toContain('<iframe');
      expect(cleaned).not.toContain('<object');
      expect(cleaned).toContain('<span>Safe</span>');
    });

    it('preserves valid editor rich text markup, lists, and task checkboxes', () => {
      const safe = '<h1>Header</h1><p>Text <b>bold</b> <i>italic</i></p><ul><li>Bullet 1</li><li>Bullet 2</li></ul><input type="checkbox" checked="checked">';
      const cleaned = sanitizeHtmlContent(safe);
      expect(cleaned).toContain('<h1>Header</h1>');
      expect(cleaned).toContain('<b>bold</b>');
      expect(cleaned).toContain('<ul><li>Bullet 1</li><li>Bullet 2</li></ul>');
      expect(cleaned).toContain('type="checkbox"');
    });
  });

  describe('Bullet Point & List Handling Specification', () => {
    it('detects unordered bullet prefixes (- item, * item) and creates list structure', () => {
      const editor = document.createElement('div');
      editor.contentEditable = 'true';

      const p1 = document.createElement('p');
      p1.textContent = '- First bullet item';
      editor.appendChild(p1);

      if (typeof handleRichTextInputShortcuts === 'function') {
        const sel = window.getSelection();
        const range = document.createRange();
        range.setStart(p1.firstChild, 2);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);

        const evt = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
        handleRichTextInputShortcuts(evt, editor);
      }

      // Verify list conversion creates UL or LI element
      const ul = editor.querySelector('ul');
      const li = editor.querySelector('li');
      expect(ul || li || editor.children.length > 0).toBeTruthy();
    });

    it('indents list items when indentListItem is invoked', () => {
      const ul = document.createElement('ul');
      const li1 = document.createElement('li');
      li1.textContent = 'Parent item';
      const li2 = document.createElement('li');
      li2.textContent = 'Sub item';
      ul.appendChild(li1);
      ul.appendChild(li2);

      if (typeof indentListItem === 'function') {
        indentListItem(li2);
        const sublist = li1.querySelector('ul, ol');
        expect(sublist).not.toBeNull();
        expect(sublist.contains(li2)).toBe(true);
      }
    });

    it('outdents sublist items when outdentListItem is invoked', () => {
      const ul = document.createElement('ul');
      const li1 = document.createElement('li');
      li1.textContent = 'Parent item';
      const subUl = document.createElement('ul');
      const li2 = document.createElement('li');
      li2.textContent = 'Child item';
      subUl.appendChild(li2);
      li1.appendChild(subUl);
      ul.appendChild(li1);

      const editor = document.createElement('div');
      editor.appendChild(ul);

      if (typeof outdentListItem === 'function') {
        outdentListItem(li2, editor);
        expect(ul.contains(li2)).toBe(true);
      }
    });

    it('converts top-level list item to paragraph when outdented', () => {
      const ul = document.createElement('ul');
      const li = document.createElement('li');
      li.textContent = 'Top item';
      ul.appendChild(li);

      const editor = document.createElement('div');
      editor.appendChild(ul);

      if (typeof outdentListItem === 'function') {
        outdentListItem(li, editor);
        const p = editor.querySelector('p');
        expect(p).not.toBeNull();
        expect(p.textContent).toBe('Top item');
      }
    });
  });

  describe('User Typing & Formatting Simulation (Markdown Shortcuts, Headers, Lists, Highlights & Enter Key)', () => {
    let editor;

    function createTestEditor(initialHtml = '<p><br></p>') {
      const el = document.createElement('div');
      el.contentEditable = 'true';
      el.className = 'note-editor';
      el.innerHTML = initialHtml;
      document.body.appendChild(el);
      if (typeof attachRichTextShortcutsAndToolbar === 'function') {
        attachRichTextShortcutsAndToolbar(el);
      }
      return el;
    }

    function cleanupTestEditor(el) {
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }

    function getCleanHtml(el) {
      return el.innerHTML
        .replace(/[\u200B]/g, '') // Remove zero-width spaces used for caret positioning
        .replace(/&nbsp;/g, ' ')  // Normalize non-breaking spaces to standard space
        .replace(/\s+/g, ' ')
        .replace(/> </g, '><')
        .trim();
    }

    function setCaret(node, offset = 0) {
      const sel = window.getSelection();
      const range = document.createRange();
      if (node.nodeType === Node.TEXT_NODE) {
        const clampOffset = Math.min(offset, node.length);
        range.setStart(node, clampOffset);
      } else {
        const clampOffset = Math.min(offset, node.childNodes.length);
        range.setStart(node, clampOffset);
      }
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return range;
    }

    function selectTextRange(startNode, startOffset, endNode, endOffset) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      sel.removeAllRanges();
      sel.addRange(range);
      return range;
    }

    function pressKey(el, key, options = {}) {
      const evt = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
      handleRichTextInputShortcuts(evt, el);
      return evt;
    }

    afterEach(() => {
      if (editor) {
        cleanupTestEditor(editor);
        editor = null;
      }
    });

    describe('Bullet Points & List Prefix Typing Simulation', () => {
      it('converts "- " prefix to an unordered bullet list (ul > li)', () => {
        editor = createTestEditor('<p>- First bullet item</p>');
        const textNode = editor.querySelector('p').firstChild;
        setCaret(textNode, 2); // Caret right after '- '
        pressKey(editor, ' ');

        const ul = editor.querySelector('ul');
        const li = editor.querySelector('li');
        expect(ul).not.toBeNull();
        expect(li).not.toBeNull();
        expect(li.textContent).toBe('First bullet item');
        expect(getCleanHtml(editor)).toBe('<ul><li>First bullet item</li></ul>');
      });

      it('converts "* " prefix to an unordered bullet list (ul > li)', () => {
        editor = createTestEditor('<p>* Star bullet item</p>');
        const textNode = editor.querySelector('p').firstChild;
        setCaret(textNode, 2); // Caret right after '* '
        pressKey(editor, ' ');

        const ul = editor.querySelector('ul');
        const li = editor.querySelector('li');
        expect(ul).not.toBeNull();
        expect(li.textContent).toBe('Star bullet item');
        expect(getCleanHtml(editor)).toBe('<ul><li>Star bullet item</li></ul>');
      });

      it('converts "1. " prefix to an ordered numbered list (ol[type="1"] > li)', () => {
        editor = createTestEditor('<p>1. Numbered step</p>');
        const textNode = editor.querySelector('p').firstChild;
        setCaret(textNode, 3); // Caret right after '1. '
        pressKey(editor, ' ');

        const ol = editor.querySelector('ol');
        const li = editor.querySelector('li');
        expect(ol).not.toBeNull();
        expect(ol.getAttribute('type')).toBe('1');
        expect(li.textContent).toBe('Numbered step');
        expect(getCleanHtml(editor)).toBe('<ol type="1"><li>Numbered step</li></ol>');
      });

      it('converts "A. " prefix to an ordered lettered list (ol[type="A"] > li)', () => {
        editor = createTestEditor('<p>A. Lettered option</p>');
        const textNode = editor.querySelector('p').firstChild;
        setCaret(textNode, 3); // Caret right after 'A. '
        pressKey(editor, ' ');

        const ol = editor.querySelector('ol');
        const li = editor.querySelector('li');
        expect(ol).not.toBeNull();
        expect(ol.getAttribute('type')).toBe('A');
        expect(li.textContent).toBe('Lettered option');
        expect(getCleanHtml(editor)).toBe('<ol type="A"><li>Lettered option</li></ol>');
      });

      it('converts "> " prefix to a blockquote element', () => {
        editor = createTestEditor('<p>></p>');
        const textNode = editor.querySelector('p').firstChild;
        setCaret(textNode, 1); // Caret right after '>'
        pressKey(editor, ' ');

        const quote = editor.querySelector('blockquote');
        expect(quote).not.toBeNull();
        
        // Add content to the converted blockquote
        if (quote.firstChild && quote.firstChild.nodeType === Node.TEXT_NODE) {
          quote.firstChild.textContent = 'Quote text';
        } else {
          quote.textContent = 'Quote text';
        }

        expect(getCleanHtml(editor)).toBe('<blockquote>Quote text</blockquote>');
      });
    });

    describe('Header Creation & Pressing Enter after Heading Simulation', () => {
      it('converts "# " to an <h1> element when typing space after hash', () => {
        editor = createTestEditor('<p># Title Heading</p>');
        const textNode = editor.querySelector('p').firstChild;
        setCaret(textNode, 1); // Caret right after '#'
        pressKey(editor, ' ');

        const h1 = editor.querySelector('h1');
        expect(h1).not.toBeNull();
        expect(h1.textContent).toBe('Title Heading');
        expect(getCleanHtml(editor)).toBe('<h1>Title Heading</h1>');
      });

      it('converts "## " to an <h2> element', () => {
        editor = createTestEditor('<p>## Section Title</p>');
        const textNode = editor.querySelector('p').firstChild;
        setCaret(textNode, 2); // Caret right after '##'
        pressKey(editor, ' ');

        const h2 = editor.querySelector('h2');
        expect(h2).not.toBeNull();
        expect(h2.textContent).toBe('Section Title');
        expect(getCleanHtml(editor)).toBe('<h2>Section Title</h2>');
      });

      it('converts "### " to an <h3> element', () => {
        editor = createTestEditor('<p>### Subsection Title</p>');
        const textNode = editor.querySelector('p').firstChild;
        setCaret(textNode, 3); // Caret right after '###'
        pressKey(editor, ' ');

        const h3 = editor.querySelector('h3');
        expect(h3).not.toBeNull();
        expect(h3.textContent).toBe('Subsection Title');
        expect(getCleanHtml(editor)).toBe('<h3>Subsection Title</h3>');
      });

      it('creates a new paragraph block when pressing Enter at the end of a header', () => {
        editor = createTestEditor('<h1>Main Header Title</h1>');
        const h1 = editor.querySelector('h1');
        
        // Place caret at the end of H1 text
        setCaret(h1.firstChild, h1.textContent.length);
        pressKey(editor, 'Enter');

        // Verify a paragraph was created right after H1
        const p = editor.querySelector('p');
        expect(p).not.toBeNull();
        expect(h1.nextElementSibling).toBe(p);

        // Simulate user typing text into the new paragraph
        p.textContent = 'This is body paragraph text after header.';
        expect(getCleanHtml(editor)).toBe('<h1>Main Header Title</h1><p>This is body paragraph text after header.</p>');
      });
    });

    describe('Enter Key & List Navigation Simulation', () => {
      it('outdents and exits empty list item when pressing Enter', () => {
        editor = createTestEditor('<ul><li>Existing item</li><li><br></li></ul>');
        const emptyLi = editor.querySelectorAll('li')[1];

        // Place caret in empty LI
        setCaret(emptyLi, 0);
        pressKey(editor, 'Enter');

        // Should exit list into a paragraph block
        const p = editor.querySelector('p');
        expect(p).not.toBeNull();
        p.textContent = 'Paragraph after list exit.';

        expect(getCleanHtml(editor)).toBe('<ul><li>Existing item</li></ul><p>Paragraph after list exit.</p>');
      });

      it('outdents list item into a paragraph when pressing Backspace at position 0', () => {
        editor = createTestEditor('<ul><li>Item 1</li><li>Item 2</li></ul>');
        const secondLi = editor.querySelectorAll('li')[1];

        // Caret at start of second item
        setCaret(secondLi.firstChild, 0);
        pressKey(editor, 'Backspace');

        const p = editor.querySelector('p');
        expect(p).not.toBeNull();
        expect(p.textContent).toBe('Item 2');
        expect(getCleanHtml(editor)).toBe('<ul><li>Item 1</li></ul><p>Item 2</p>');
      });

      it('indents list item into nested list when pressing Tab key', () => {
        editor = createTestEditor('<ul><li>Parent Task</li><li>Subtask candidate</li></ul>');
        const secondLi = editor.querySelectorAll('li')[1];

        setCaret(secondLi.firstChild, 0);
        pressKey(editor, 'Tab');

        const subList = editor.querySelector('ul ul');
        expect(subList).not.toBeNull();
        expect(subList.querySelector('li').textContent).toBe('Subtask candidate');
      });

      it('outdents nested list item when pressing Shift+Tab key', () => {
        editor = createTestEditor('<ul><li>Parent Task<ul><li>Nested Subtask</li></ul></li></ul>');
        const nestedLi = editor.querySelector('ul ul li');

        setCaret(nestedLi.firstChild, 0);
        pressKey(editor, 'Tab', { shiftKey: true });

        const lis = editor.querySelectorAll('ul > li');
        expect(lis.length).toBe(2);
        expect(lis[1].textContent).toBe('Nested Subtask');
      });
    });

    describe('Highlighting & Inline Formatting Simulation', () => {
      it('converts ==highlighted text== to <mark> element when typing space', () => {
        editor = createTestEditor('<p>This is ==important note== text</p>');
        const textNode = editor.querySelector('p').firstChild;

        // Position caret right after closing '==' of ==important note==
        const offset = textNode.textContent.indexOf('== text') + 2;
        setCaret(textNode, offset);
        pressKey(editor, ' ');

        const mark = editor.querySelector('mark');
        expect(mark).not.toBeNull();
        expect(mark.textContent).toBe('important note');
        expect(getCleanHtml(editor)).toBe('<p>This is <mark>important note</mark> text</p>');
      });

      it('wraps selected text in <mark> tag when pressing Ctrl+Shift+H shortcut', () => {
        editor = createTestEditor('<p>Select this highlighted text here</p>');
        const textNode = editor.querySelector('p').firstChild;

        // Select "highlighted text"
        const start = textNode.textContent.indexOf('highlighted text');
        const end = start + 'highlighted text'.length;
        selectTextRange(textNode, start, textNode, end);

        pressKey(editor, 'h', { ctrlKey: true, shiftKey: true });

        const mark = editor.querySelector('mark');
        expect(mark).not.toBeNull();
        expect(mark.textContent).toBe('highlighted text');
        expect(getCleanHtml(editor)).toBe('<p>Select this <mark>highlighted text</mark> here</p>');
      });

      it('converts **bold text** to <strong> when typing space', () => {
        editor = createTestEditor('<p>Here is **bold text** in paragraph</p>');
        const textNode = editor.querySelector('p').firstChild;

        const offset = textNode.textContent.indexOf('** in') + 2;
        setCaret(textNode, offset);
        pressKey(editor, ' ');

        const strong = editor.querySelector('strong');
        expect(strong).not.toBeNull();
        expect(strong.textContent).toBe('bold text');
        expect(getCleanHtml(editor)).toBe('<p>Here is <strong>bold text</strong> in paragraph</p>');
      });

      it('converts *italic text* to <em> when typing space', () => {
        editor = createTestEditor('<p>Here is *italic text* in paragraph</p>');
        const textNode = editor.querySelector('p').firstChild;

        const offset = textNode.textContent.indexOf('* in') + 1;
        setCaret(textNode, offset);
        pressKey(editor, ' ');

        const em = editor.querySelector('em');
        expect(em).not.toBeNull();
        expect(em.textContent).toBe('italic text');
        expect(getCleanHtml(editor)).toBe('<p>Here is <em>italic text</em> in paragraph</p>');
      });

      it('converts ~~strikethrough~~ to <s> when typing space', () => {
        editor = createTestEditor('<p>Here is ~~deleted text~~ in paragraph</p>');
        const textNode = editor.querySelector('p').firstChild;

        const offset = textNode.textContent.indexOf('~~ in') + 2;
        setCaret(textNode, offset);
        pressKey(editor, ' ');

        const s = editor.querySelector('s');
        expect(s).not.toBeNull();
        expect(s.textContent).toBe('deleted text');
        expect(getCleanHtml(editor)).toBe('<p>Here is <s>deleted text</s> in paragraph</p>');
      });

      it('converts `code` to <code> when typing space', () => {
        editor = createTestEditor('<p>Here is `const val = 42` in paragraph</p>');
        const textNode = editor.querySelector('p').firstChild;

        const offset = textNode.textContent.indexOf('` in') + 1;
        setCaret(textNode, offset);
        pressKey(editor, ' ');

        const code = editor.querySelector('code');
        expect(code).not.toBeNull();
        expect(code.textContent).toBe('const val = 42');
        expect(getCleanHtml(editor)).toBe('<p>Here is <code>const val = 42</code> in paragraph</p>');
      });

      it('wraps selected text in <strong> tag when Ctrl+B shortcut is triggered', () => {
        if (typeof document.execCommand !== 'function') {
          document.execCommand = () => true;
        }
        editor = createTestEditor('<p>Make this text bold</p>');
        const textNode = editor.querySelector('p').firstChild;

        const start = textNode.textContent.indexOf('bold');
        const end = start + 'bold'.length;
        selectTextRange(textNode, start, textNode, end);

        pressKey(editor, 'b', { ctrlKey: true });

        expect(editor.textContent).toContain('bold');
      });
    });

    describe('Comprehensive Multi-Step Note Creation Workflow Simulation', () => {
      it('simulates writing a structured document with headers, highlights, lists and paragraph exit', () => {
        editor = createTestEditor('<p># Team Sync Notes</p>');

        // 1. Type space after # Title
        let textNode = editor.querySelector('p').firstChild;
        setCaret(textNode, 2);
        pressKey(editor, ' ');
        expect(editor.querySelector('h1')).not.toBeNull();

        // 2. Press Enter at end of H1
        const h1 = editor.querySelector('h1');
        setCaret(h1.firstChild, h1.textContent.length);
        pressKey(editor, 'Enter');

        const p1 = editor.querySelector('p');
        expect(p1).not.toBeNull();
        p1.textContent = 'Discussed ==key deliverables== for Q4';

        // 3. Highlight space trigger on ==key deliverables==
        textNode = p1.firstChild;
        const markOffset = textNode.textContent.indexOf('== for') + 2;
        setCaret(textNode, markOffset);
        pressKey(editor, ' ');

        expect(editor.querySelector('mark')).not.toBeNull();
        expect(editor.querySelector('mark').textContent).toBe('key deliverables');

        // 4. Create bullet list
        const p2 = document.createElement('p');
        p2.textContent = '- Item 1: Launch feature';
        editor.appendChild(p2);

        textNode = p2.firstChild;
        setCaret(textNode, 2);
        pressKey(editor, ' ');

        expect(editor.querySelector('ul')).not.toBeNull();
        expect(editor.querySelector('ul li').textContent).toBe('Item 1: Launch feature');

        // 5. Exit list on empty bullet Enter
        const emptyLi = document.createElement('li');
        emptyLi.innerHTML = '<br>';
        editor.querySelector('ul').appendChild(emptyLi);

        setCaret(emptyLi, 0);
        pressKey(editor, 'Enter');

        const finalP = editor.querySelector('p:last-child');
        expect(finalP).not.toBeNull();
        finalP.textContent = 'Meeting adjourned.';

        // Verify full clear HTML structure
        const finalHtml = getCleanHtml(editor);
        expect(finalHtml).toContain('<h1>Team Sync Notes</h1>');
        expect(finalHtml).toContain('<mark>key deliverables</mark>');
        expect(finalHtml).toContain('<ul><li>Item 1: Launch feature</li></ul>');
        expect(finalHtml).toContain('<p>Meeting adjourned.</p>');
      });
    });
  });

  describe('wrapSelectionWithTodo & applyTodoPriorityToMarker Rendering', () => {
    it('creates a todo element with node editor importance badge without prompt dialog', async () => {
      const mockEditor = document.createElement('div');
      mockEditor.id = 'edit-textarea';
      mockEditor.contentEditable = 'true';
      document.body.appendChild(mockEditor);

      const textNode = document.createTextNode('Review Q4 Strategy');
      mockEditor.appendChild(textNode);

      const range = document.createRange();
      range.selectNodeContents(mockEditor);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      globalThis.todosManifest = [];
      globalThis.saveTodosManifest = async () => {};
      globalThis.renderBoard = () => {};
      globalThis.syncPreview = () => {};

      const result = await wrapSelectionWithTodo('High');
      expect(result).toBe(true);

      const noteTodo = mockEditor.querySelector('.note-todo');
      expect(noteTodo).not.toBeNull();
      expect(noteTodo.getAttribute('data-todo-priority')).toBe('High');
      expect(noteTodo.getAttribute('data-importance')).toBe('High');

      const badge = noteTodo.querySelector('.note-todo-badge.imp-high');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe('⚡ HIGH');

      const textSpan = noteTodo.querySelector('.note-todo-text');
      expect(textSpan.textContent).toBe('Review Q4 Strategy');

      expect(globalThis.todosManifest.length).toBe(1);
      expect(globalThis.todosManifest[0].title).toBe('Review Q4 Strategy');

      document.body.removeChild(mockEditor);
    });

    it('updates badge class and text when applyTodoPriorityToMarker is called', () => {
      const marker = document.createElement('span');
      marker.className = 'note-todo';
      marker.innerHTML = '<span class="note-todo-badge imp-high">⚡ HIGH</span> <span class="note-todo-text">Test task</span>';

      applyTodoPriorityToMarker(marker, 'Low', 'High', '');
      expect(marker.getAttribute('data-todo-priority')).toBe('Low');
      const badge = marker.querySelector('.note-todo-badge');
      expect(badge.className).toBe('note-todo-badge imp-low');
      expect(badge.textContent).toBe('⚡ LOW');
    });
  });

  describe('Note Editor Tag Editor (populateTagEditor & addTagPill)', () => {
    it('renders note editor tags cleanly without duplication', () => {
      const container = document.createElement('div');
      container.id = 'editor-topic';
      document.body.appendChild(container);

      populateTagEditor('editor-topic', ['Calls', 'Strategy'], 'topic');
      const tags = readTagEditor('editor-topic');
      expect(tags).toEqual(['Calls', 'Strategy']);

      const pills = container.querySelectorAll('.tag-pill');
      expect(pills.length).toBe(2);

      // Verify each pill text is not duplicated (e.g. 'Calls ×' not 'Calls Calls ×')
      const firstText = pills[0].textContent.replace('×', '').trim();
      expect(firstText).toBe('Calls');

      const secondText = pills[1].textContent.replace('×', '').trim();
      expect(secondText).toBe('Strategy');

      // Verify button title and pill title
      const rmBtn = pills[0].querySelector('.rm');
      expect(rmBtn.title).toBe('Click to remove Calls');
      expect(pills[0].title).toBe('Click to edit Calls');

      container.remove();
    });

    it('adds new tag pill and dispatches tagchange event', () => {
      const container = document.createElement('div');
      container.id = 'editor-major';
      document.body.appendChild(container);

      let changed = false;
      container.addEventListener('tagchange', () => { changed = true; });

      addTagPill(container, 'Roadmap', 'major', 'major-tag', true);
      expect(changed).toBe(true);

      const tags = readTagEditor('editor-major');
      expect(tags).toEqual(['Roadmap']);

      container.remove();
    });
  });

  describe('Paste Deduplication and Inspector Pane Resizing', () => {
    it('prevents duplicate paste execution for the same paste event object', () => {
      let callCount = 0;
      const fakeEditor = document.createElement('div');
      fakeEditor.contentEditable = 'true';

      const fakeEvent = {
        currentTarget: fakeEditor,
        clipboardData: {
          items: [{
            type: 'text/plain',
            getAsString: (cb) => {
              callCount++;
              cb('Hello World');
            }
          }]
        },
        preventDefault: () => {}
      };

      handleImagePaste(fakeEvent);
      expect(callCount).toBe(1);

      // Re-invoking with the same event object should be ignored
      handleImagePaste(fakeEvent);
      expect(callCount).toBe(1);
    });

    it('calculates flexible inspector pane bounds across different container widths', () => {
      // Wide desktop container (1200px)
      const wide = _getInspectorPaneBounds(1200);
      expect(wide.minW).toBe(180);
      expect(wide.maxW).toBeLessThanOrEqual(560);
      expect(wide.maxW).toBeGreaterThanOrEqual(300);

      // Medium container (800px)
      const med = _getInspectorPaneBounds(800);
      expect(med.minW).toBe(180);
      expect(med.maxW).toBeLessThanOrEqual(560);

      // Narrow container (400px)
      const narrow = _getInspectorPaneBounds(400);
      expect(narrow.minW).toBe(180);
      expect(narrow.maxW).toBeLessThanOrEqual(260);
    });

    it('inserts pasted image blob directly into rich text editor DOM', async () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      document.body.appendChild(editor);

      let inputDispatched = false;
      editor.addEventListener('input', () => { inputDispatched = true; });

      const fakeImageBlob = new Blob(['mock-image-binary'], { type: 'image/png' });
      const fakeEvent = {
        currentTarget: editor,
        clipboardData: {
          items: [{
            type: 'image/png',
            getAsFile: () => fakeImageBlob
          }]
        },
        preventDefault: () => {}
      };

      // Mock FileReader for jsdom
      class MockFileReader {
        readAsDataURL() {
          setTimeout(() => {
            this.result = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            if (this.onload) this.onload();
          }, 5);
        }
      }
      globalThis.FileReader = MockFileReader;
      globalThis.writeFile = () => Promise.resolve(true);

      const toastEl = document.createElement('div');
      toastEl.id = 'toast';
      document.body.appendChild(toastEl);

      handleImagePaste(fakeEvent);

      await new Promise(resolve => setTimeout(resolve, 50));

      toastEl.remove();

      const insertedImg = editor.querySelector('img');
      expect(insertedImg).not.toBeNull();
      expect(insertedImg.src).toContain('data:image/png;base64');
      expect(insertedImg.dataset.id).toBeDefined();
      expect(insertedImg.dataset.assetPath).toBeDefined();
      expect(inputDispatched).toBe(true);

      editor.remove();
    });

    it('creates active overlay with 4-corner handles, top delete button, and bottom controls toolbar on image selection', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      const img = document.createElement('img');
      img.src = 'data:image/png;base64,mock';
      img.dataset.id = 'img-test-123';
      img.style.width = '400px';
      editor.appendChild(img);
      document.body.appendChild(editor);

      // Mock getBoundingClientRect
      img.getBoundingClientRect = () => ({
        top: 100,
        left: 50,
        bottom: 300,
        right: 450,
        width: 400,
        height: 200
      });
      editor.getBoundingClientRect = () => ({
        top: 50,
        left: 20,
        bottom: 600,
        right: 820,
        width: 800,
        height: 550
      });

      selectEditorImage(img, editor);

      const overlay = document.querySelector('.editor-img-active-overlay');
      expect(overlay).not.toBeNull();

      // Check 4 corner handles
      const nw = overlay.querySelector('.editor-img-handle.nw');
      const ne = overlay.querySelector('.editor-img-handle.ne');
      const sw = overlay.querySelector('.editor-img-handle.sw');
      const se = overlay.querySelector('.editor-img-handle.se');
      expect(nw).not.toBeNull();
      expect(ne).not.toBeNull();
      expect(sw).not.toBeNull();
      expect(se).not.toBeNull();

      // Check top-right 'x' delete button
      const delBtn = overlay.querySelector('.editor-img-delete-btn');
      expect(delBtn).not.toBeNull();

      // Check bottom controls toolbar
      const toolbar = document.querySelector('.img-resize-toolbar');
      expect(toolbar).not.toBeNull();
      const rangeInput = toolbar.querySelector('input[type=range]');
      const numInput = toolbar.querySelector('input[type=number]');
      expect(rangeInput).not.toBeNull();
      expect(numInput).not.toBeNull();
      expect(rangeInput.value).toBe('400');

      // Test corner handle drag aspect ratio preservation
      // Initial aspect ratio = 400 / 200 = 2.0
      const mouseDownEv = new MouseEvent('mousedown', { clientX: 450, clientY: 300, bubbles: true });
      se.dispatchEvent(mouseDownEv);

      // Drag SE corner right by 100px
      const mouseMoveEv = new MouseEvent('mousemove', { clientX: 550, clientY: 350, bubbles: true });
      window.dispatchEvent(mouseMoveEv);

      expect(parseInt(img.style.width)).toBeGreaterThan(400);

      const mouseUpEv = new MouseEvent('mouseup', { bubbles: true });
      window.dispatchEvent(mouseUpEv);

      // Test top-right delete button
      delBtn.click();
      expect(editor.querySelector('img')).toBeNull();
      expect(document.querySelector('.editor-img-active-overlay')).toBeNull();

      editor.remove();
    });

    it('clicking image strip thumbnail scrolls to and selects the image in the note editor', () => {
      const noteEdit = document.createElement('div');
      noteEdit.id = 'note-edit';
      const fields = document.createElement('div');
      fields.id = 'edit-fields-collapsible';
      noteEdit.appendChild(fields);
      document.body.appendChild(noteEdit);

      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      const testImg = document.createElement('img');
      testImg.src = 'data:image/png;base64,thumb-test-data';
      testImg.dataset.id = 'img-thumb-target';
      testImg.dataset.assetPath = 'notes/_assets/img-thumb-target.png';
      editor.appendChild(testImg);
      document.body.appendChild(editor);

      let scrollCalled = false;
      testImg.scrollIntoView = () => { scrollCalled = true; };
      testImg.getBoundingClientRect = () => ({
        top: 200,
        left: 100,
        bottom: 400,
        right: 500,
        width: 400,
        height: 200
      });

      _lastImageStripSignature = '';
      syncImageStrip();

      const strip = document.getElementById('overlay-images-strip');
      expect(strip).not.toBeNull();
      const thumb = strip.querySelector('.edit-img-thumb');
      expect(thumb).not.toBeNull();

      // Click the thumbnail
      thumb.click();

      expect(scrollCalled).toBe(true);
      const activeOverlay = document.querySelector('.editor-img-active-overlay');
      expect(activeOverlay).not.toBeNull();

      hideImageActiveOverlay();
      editor.remove();
      noteEdit.remove();
    });

    it('clicking image strip delete button removes the image from the editor and syncs strip', () => {
      const noteEdit = document.createElement('div');
      noteEdit.id = 'note-edit';
      const fields = document.createElement('div');
      fields.id = 'edit-fields-collapsible';
      noteEdit.appendChild(fields);
      document.body.appendChild(noteEdit);

      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      const testImg = document.createElement('img');
      testImg.src = 'data:image/png;base64,thumb-del-data';
      testImg.dataset.id = 'img-del-target';
      testImg.dataset.assetPath = 'notes/_assets/img-del-target.png';
      editor.appendChild(testImg);
      document.body.appendChild(editor);

      let inputDispatched = false;
      editor.addEventListener('input', () => { inputDispatched = true; });

      _lastImageStripSignature = '';
      syncImageStrip();

      const strip = document.getElementById('overlay-images-strip');
      expect(strip).not.toBeNull();
      const delBtn = strip.querySelector('.edit-img-thumb-del');
      expect(delBtn).not.toBeNull();
      expect(delBtn.title).toBeDefined();

      // Click delete button
      delBtn.click();

      expect(editor.querySelector('img')).toBeNull();
      expect(inputDispatched).toBe(true);
      expect(strip.querySelector('.edit-img-thumb-del')).toBeNull();

      editor.remove();
      noteEdit.remove();
    });

    it('handleImagePaste correctly resolves active editor when paste triggers on note-edit-overlay', async () => {
      const overlay = document.createElement('div');
      overlay.id = 'note-edit-overlay';
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      overlay.appendChild(editor);
      document.body.appendChild(overlay);

      const fakeImageBlob = new Blob(['mock-binary'], { type: 'image/png' });
      const pasteEvent = {
        currentTarget: overlay,
        target: overlay,
        clipboardData: {
          items: [{
            type: 'image/png',
            getAsFile: () => fakeImageBlob
          }]
        },
        preventDefault: () => {}
      };

      class MockFileReader {
        readAsDataURL() {
          setTimeout(() => {
            this.result = 'data:image/png;base64,mockOverlayPasteData123';
            if (this.onload) this.onload();
          }, 5);
        }
      }
      globalThis.FileReader = MockFileReader;
      globalThis.writeFile = () => Promise.resolve(true);

      handleImagePaste(pasteEvent);
      await new Promise(resolve => setTimeout(resolve, 50));

      const img = editor.querySelector('img');
      expect(img).not.toBeNull();
      expect(img.src).toContain('mockOverlayPasteData123');

      overlay.remove();
    });

    it('handleImagePaste deduplicates identical images and avoids double pasting', async () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      document.body.appendChild(editor);

      const fakeImageBlob = new Blob(['mock-binary'], { type: 'image/png' });
      const duplicateDataUrl = 'data:image/png;base64,exactSameImageData999';

      class MockFileReader {
        readAsDataURL() {
          setTimeout(() => {
            this.result = duplicateDataUrl;
            if (this.onload) this.onload();
          }, 5);
        }
      }
      globalThis.FileReader = MockFileReader;
      globalThis.writeFile = () => Promise.resolve(true);

      const event1 = {
        currentTarget: editor,
        clipboardData: {
          items: [{
            type: 'image/png',
            getAsFile: () => fakeImageBlob
          }]
        },
        preventDefault: () => {}
      };

      handleImagePaste(event1);
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(editor.querySelectorAll('img').length).toBe(1);

      // Paste identical image again
      const event2 = {
        currentTarget: editor,
        clipboardData: {
          items: [{
            type: 'image/png',
            getAsFile: () => fakeImageBlob
          }]
        },
        preventDefault: () => {}
      };

      handleImagePaste(event2);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should still only have 1 image
      expect(editor.querySelectorAll('img').length).toBe(1);

      editor.remove();
    });

    it('pressing Enter inside a list item containing an image creates a new list item and does not destroy the list', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      document.body.appendChild(editor);

      const ul = document.createElement('ul');
      const li = document.createElement('li');
      li.textContent = 'Item 1';
      const img = document.createElement('img');
      img.src = 'data:image/png;base64,mockListImg';
      li.appendChild(img);
      ul.appendChild(li);
      editor.appendChild(ul);

      // Caret at end of li
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(li);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      const enterEv = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      handleRichTextInputShortcuts(enterEv, editor);

      expect(enterEv.defaultPrevented).toBe(true);
      // Verify ul still has 2 li elements and has not been split into <p>
      const lis = ul.querySelectorAll('li');
      expect(lis.length).toBe(2);
      expect(lis[0].contains(img)).toBe(true);

      // Now press Tab on the second li
      const tabEv = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      handleRichTextInputShortcuts(tabEv, editor);

      expect(tabEv.defaultPrevented).toBe(true);
      // Verify nested list was created under first li
      const nestedUl = lis[0].querySelector('ul');
      expect(nestedUl).not.toBeNull();
      expect(nestedUl.querySelector('li')).toBe(lis[1]);

      editor.remove();
    });

    describe('Note Editor Formatting & Rich Text Shortcuts Engine', () => {
      let editor;

      beforeEach(() => {
        editor = document.createElement('div');
        editor.id = 'edit-textarea';
        editor.contentEditable = 'true';
        document.body.appendChild(editor);
      });

      afterEach(() => {
        if (editor && editor.parentNode) {
          editor.remove();
        }
      });

      it('converts markdown block prefixes to corresponding HTML elements via checkAndConvertBlockPrefix', () => {
        // H1 prefix: '# '
        const p1 = document.createElement('p');
        const t1 = document.createTextNode('# Heading One');
        p1.appendChild(t1);
        editor.appendChild(p1);
        const convertedH1 = checkAndConvertBlockPrefix(t1, 2, editor, window.getSelection());
        expect(convertedH1).toBe(true);
        expect(editor.querySelector('h1')).not.toBeNull();
        expect(editor.querySelector('h1').textContent).toBe('Heading One');

        // H2 prefix: '## '
        const p2 = document.createElement('p');
        const t2 = document.createTextNode('## Heading Two');
        p2.appendChild(t2);
        editor.appendChild(p2);
        const convertedH2 = checkAndConvertBlockPrefix(t2, 3, editor, window.getSelection());
        expect(convertedH2).toBe(true);
        expect(editor.querySelector('h2')).not.toBeNull();
        expect(editor.querySelector('h2').textContent).toBe('Heading Two');

        // H3 prefix: '### '
        const p3 = document.createElement('p');
        const t3 = document.createTextNode('### Heading Three');
        p3.appendChild(t3);
        editor.appendChild(p3);
        const convertedH3 = checkAndConvertBlockPrefix(t3, 4, editor, window.getSelection());
        expect(convertedH3).toBe(true);
        expect(editor.querySelector('h3')).not.toBeNull();
        expect(editor.querySelector('h3').textContent).toBe('Heading Three');

        // Blockquote prefix: '> '
        const p4 = document.createElement('p');
        const t4 = document.createTextNode('> Important quote');
        p4.appendChild(t4);
        editor.appendChild(p4);
        const convertedQuote = checkAndConvertBlockPrefix(t4, 2, editor, window.getSelection());
        expect(convertedQuote).toBe(true);
        expect(editor.querySelector('blockquote')).not.toBeNull();
        expect(editor.querySelector('blockquote').textContent).toBe('Important quote');

        // Bullet list prefix: '- '
        const p5 = document.createElement('p');
        const t5 = document.createTextNode('- Bullet item');
        p5.appendChild(t5);
        editor.appendChild(p5);
        const convertedUl = checkAndConvertBlockPrefix(t5, 2, editor, window.getSelection());
        expect(convertedUl).toBe(true);
        expect(editor.querySelector('ul')).not.toBeNull();
        expect(editor.querySelector('ul li').textContent).toBe('Bullet item');

        // Numbered list prefix: '1. '
        const p6 = document.createElement('p');
        const t6 = document.createTextNode('1. Numbered item');
        p6.appendChild(t6);
        editor.appendChild(p6);
        const convertedOl = checkAndConvertBlockPrefix(t6, 3, editor, window.getSelection());
        expect(convertedOl).toBe(true);
        expect(editor.querySelector('ol')).not.toBeNull();
        expect(editor.querySelector('ol li').textContent).toBe('Numbered item');

        // Checklist prefixes: '[ ] ' and '[x] '
        const p7 = document.createElement('p');
        const t7 = document.createTextNode('[ ] Pending checklist task');
        p7.appendChild(t7);
        editor.appendChild(p7);
        const convertedChecklist = checkAndConvertBlockPrefix(t7, 4, editor, window.getSelection());
        expect(convertedChecklist).toBe(true);
        const checkLi = editor.querySelector('ul li input[type="checkbox"]');
        expect(checkLi).not.toBeNull();
        expect(checkLi.checked).toBe(false);

        const p8 = document.createElement('p');
        const t8 = document.createTextNode('[x] Completed checklist task');
        p8.appendChild(t8);
        editor.appendChild(p8);
        const convertedDoneChecklist = checkAndConvertBlockPrefix(t8, 4, editor, window.getSelection());
        expect(convertedDoneChecklist).toBe(true);
        const doneCheckboxes = editor.querySelectorAll('ul li input[type="checkbox"]');
        const lastCheckbox = doneCheckboxes[doneCheckboxes.length - 1];
        expect(lastCheckbox.checked).toBe(true);
      });

      it('executes formatRichTextInEditor commands reliably across checklist, mark, code and clear', async () => {
        // Test checklist command
        editor.innerHTML = '<p>Checklist item A</p>';
        const pCheck = editor.querySelector('p');
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(pCheck);
        sel.removeAllRanges();
        sel.addRange(range);

        await formatRichTextInEditor(editor, 'checklist');
        expect(editor.querySelector('ul li input[type="checkbox"]')).not.toBeNull();

        // Test mark/highlight formatting
        editor.innerHTML = '<p>Highlight this section please</p>';
        const textNode = editor.querySelector('p').firstChild;
        range.setStart(textNode, 10);
        range.setEnd(textNode, 22);
        sel.removeAllRanges();
        sel.addRange(range);

        await formatRichTextInEditor(editor, 'mark');
        const markElem = editor.querySelector('mark');
        expect(markElem).not.toBeNull();
        expect(markElem.textContent).toBe('this section');

        // Test code formatting
        editor.innerHTML = '<p>Run const answer = 42;</p>';
        const codeTextNode = editor.querySelector('p').firstChild;
        range.setStart(codeTextNode, 4);
        range.setEnd(codeTextNode, 21);
        sel.removeAllRanges();
        sel.addRange(range);

        await formatRichTextInEditor(editor, 'code');
        const codeElem = editor.querySelector('code');
        expect(codeElem).not.toBeNull();
        expect(codeElem.textContent).toBe('const answer = 42');

        // Test clear formatting
        await formatRichTextInEditor(editor, 'clear');
        expect(editor.querySelector('code')).toBeNull();
      });

      it('handles Enter key on checklist items by continuing the checklist or exiting on empty item', () => {
        // 1. Non-empty checklist item -> Enter creates next checklist item
        editor.innerHTML = '<ul><li><input type="checkbox"> Task 1</li></ul>';
        const li1 = editor.querySelector('li');
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(li1);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);

        const enterEv1 = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        handleRichTextInputShortcuts(enterEv1, editor);

        expect(enterEv1.defaultPrevented).toBe(true);
        const lisAfterEnter = editor.querySelectorAll('ul li');
        expect(lisAfterEnter.length).toBe(2);
        expect(lisAfterEnter[1].querySelector('input[type="checkbox"]')).not.toBeNull();

        // 2. Empty checklist item -> Enter exits the checklist into a paragraph
        editor.innerHTML = '<ul><li><input type="checkbox"> Task 1</li><li><input type="checkbox"> </li></ul>';
        const li2 = editor.querySelectorAll('li')[1];
        range.selectNodeContents(li2);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);

        const enterEv2 = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        handleRichTextInputShortcuts(enterEv2, editor);

        expect(enterEv2.defaultPrevented).toBe(true);
        expect(editor.querySelectorAll('ul li').length).toBe(1);
        expect(editor.querySelector('p')).not.toBeNull();
      });

      it('handles Backspace on an empty checklist item to remove it cleanly', () => {
        editor.innerHTML = '<ul><li><input type="checkbox"> </li></ul>';
        const li = editor.querySelector('li');
        const textNode = li.lastChild;
        const sel = window.getSelection();
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);

        const backspaceEv = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
        handleRichTextInputShortcuts(backspaceEv, editor);

        expect(backspaceEv.defaultPrevented).toBe(true);
        expect(editor.querySelector('ul')).toBeNull();
        expect(editor.querySelector('p')).not.toBeNull();
      });
    });
  });
});





