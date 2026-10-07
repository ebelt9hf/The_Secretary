import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Notes Editor Link Hover Menu & Note Linking Autocomplete', () => {
  beforeAll(() => {
    // Provide necessary globals for editor environment
    globalThis.t = (key) => key;
    globalThis.currentNote = { id: 'note_source_1', path: 'notes/source.md', title: 'Source Note' };
    globalThis.manifest = [
      { id: 'note_source_1', path: 'notes/source.md', title: 'Source Note', date: '2026-09-01' },
      { id: 'note_target_2', path: 'notes/target.md', title: 'Project Roadmap', date: '2026-09-02' },
      { id: 'note_target_3', path: 'notes/design.md', title: 'UI Architecture', date: '2026-09-03' }
    ];
    globalThis.plannerEvents = [];

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-notes.js',
      'js/app-planner.js',
      'js/app-collab.js',
      'js/app-overlay.js',
      'js/app-chat.js'
    ]);

    document.execCommand = vi.fn((cmd, showUI, val) => {
      const sel = window.getSelection();
      const target = document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : (document.getElementById('edit-textarea') || document.body);

      let range = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0) : null;
      if (range && target && !target.contains(range.commonAncestorContainer)) {
        range = null;
      }
      if (!range && target) {
        range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
      }
      if (range) {
        if (cmd === 'insertHTML' && val) {
          const frag = range.createContextualFragment(val);
          range.deleteContents();
          range.insertNode(frag);
        } else if (cmd === 'insertText' && val) {
          range.deleteContents();
          range.insertNode(document.createTextNode(val));
        }
      }
      return true;
    });
    document.queryCommandState = vi.fn(() => false);
  });

  describe('Interactive Link Hover Action Menu', () => {
    it('creates hover menu with Open, Edit, Copy, and Remove actions for external links', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      const link = document.createElement('a');
      link.href = 'https://antigravity.google.com';
      link.textContent = 'Antigravity IDE';
      editor.appendChild(link);
      document.body.appendChild(editor);

      showEditorLinkHoverMenu(link, editor);

      const menu = document.querySelector('.editor-link-hover-menu');
      expect(menu).not.toBeNull();
      expect(menu.classList.contains('active')).toBe(true);

      const preview = menu.querySelector('.editor-link-preview-text');
      expect(preview).not.toBeNull();
      expect(preview.textContent).toContain('https://antigravity.google.com');

      const buttons = menu.querySelectorAll('.editor-link-hover-btn');
      // Open, Edit, Copy, Remove
      expect(buttons.length).toBe(4);

      hideEditorLinkHoverMenu();
      expect(menu.classList.contains('active')).toBe(false);

      editor.remove();
    });

    it('creates hover menu with Open Note and Remove Link actions for note links', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      const link = document.createElement('a');
      link.className = 'note-link wiki-link';
      link.dataset.noteId = 'note_target_2';
      link.dataset.notePath = 'notes/target.md';
      link.textContent = '📝 Project Roadmap';
      editor.appendChild(link);
      document.body.appendChild(editor);

      showEditorLinkHoverMenu(link, editor);

      const menu = document.querySelector('.editor-link-hover-menu');
      expect(menu).not.toBeNull();
      expect(menu.classList.contains('active')).toBe(true);

      const preview = menu.querySelector('.editor-link-preview-text');
      expect(preview.textContent).toBe('📝 Project Roadmap');

      const buttons = menu.querySelectorAll('.editor-link-hover-btn');
      // Open Note, Remove Link
      expect(buttons.length).toBe(2);

      hideEditorLinkHoverMenu();
      editor.remove();
    });

    it('unwraps link element correctly preserving text', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      const p = document.createElement('p');
      p.innerHTML = 'Visit <a href="https://example.com" id="test-link">Example Website</a> today.';
      editor.appendChild(p);
      document.body.appendChild(editor);

      const link = document.getElementById('test-link');
      unwrapLinkElement(link, editor);

      expect(p.querySelector('a')).toBeNull();
      expect(p.textContent).toBe('Visit Example Website today.');

      editor.remove();
    });

    it('copies link URL to clipboard and triggers notification', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
        writable: true
      });

      const link = document.createElement('a');
      link.href = 'https://deepmind.google/technologies/gemini/';
      copyLinkElementUrl(link);

      expect(writeText).toHaveBeenCalledWith('https://deepmind.google/technologies/gemini/');
    });

    it('openNoteFromLink navigates to resolved note path', () => {
      let openedPath = null;
      globalThis.openNestedNote = (path) => { openedPath = path; };

      const link = document.createElement('a');
      link.dataset.notePath = 'notes/target.md';
      openNoteFromLink(link);

      expect(openedPath).toBe('notes/target.md');
    });
  });

  describe('Note Linking Logic and insertLinkedNoteWikiLink', () => {
    it('inserts active interactive note link HTML element', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      document.body.appendChild(editor);

      insertLinkedNoteWikiLink({
        id: 'note_target_2',
        path: 'notes/target.md',
        title: 'Project Roadmap'
      });

      const link = editor.querySelector('a.note-link');
      expect(link).not.toBeNull();
      expect(link.getAttribute('data-note-id')).toBe('note_target_2');
      expect(link.getAttribute('data-note-path')).toBe('notes/target.md');
      expect(link.textContent).toContain('Project Roadmap');

      editor.remove();
    });
  });

  describe('/note Fast Command and Autocomplete', () => {
    it('shows note-link autocomplete suggestions when typing /note', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      document.body.appendChild(editor);

      // Trigger autocomplete with query "Roadmap"
      showAutocompleteSuggestions(editor, 'note-link', 'roadmap', 0);

      const dropdown = document.getElementById('editor-autocomplete-list');
      expect(dropdown).not.toBeNull();

      const items = dropdown.querySelectorAll('.editor-autocomplete-item');
      expect(items.length).toBe(1);
      expect(items[0].textContent).toContain('Project Roadmap');

      closeAutocomplete();
      expect(document.getElementById('editor-autocomplete-list')).toBeNull();

      editor.remove();
    });

    it('escape key cancels autocomplete and leaves typed text as-is', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      editor.textContent = 'Here is /note road';
      document.body.appendChild(editor);

      showAutocompleteSuggestions(editor, 'note-link', 'road', 8);
      expect(document.getElementById('editor-autocomplete-list')).not.toBeNull();

      const escEvent = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      const handled = handleAutocompleteKeydown(escEvent);

      expect(handled).toBe(true);
      expect(document.getElementById('editor-autocomplete-list')).toBeNull();
      expect(editor.textContent).toBe('Here is /note road');

      editor.remove();
    });
  });

  describe('AI Agent Note Linking in Note Editor', () => {
    it('mdToPreviewHTML converts wiki-links [[Note Title]] to interactive note links', () => {
      const md = 'See our plans in [[Project Roadmap]] for details.';
      // Provide marked mock if needed or rely on fallback
      if (typeof marked === 'undefined') {
        globalThis.marked = { parse: (text) => `<p>${text}</p>` };
      }
      const html = mdToPreviewHTML(md);
      expect(html).toContain('note-link wiki-link');
      expect(html).toContain('data-note-id="note_target_2"');
      expect(html).toContain('data-note-path="notes/target.md"');
      expect(html).toContain('Project Roadmap');
    });

    it('renderAiSuggestions renders inline note proposal when agent proposes link_note', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.innerHTML = '<p>We need to align with the roadmap discussion.</p>';
      document.body.appendChild(editor);

      renderAiSuggestions({
        general_comment: 'Link the relevant note',
        suggested_actions: [
          {
            action: 'link_note',
            properties: {
              target_string: 'roadmap',
              title: 'Project Roadmap',
              id: 'note_target_2',
              path: 'notes/target.md'
            }
          }
        ]
      }, globalThis.currentNote);

      const proposal = editor.querySelector('.inline-note-proposal');
      expect(proposal).not.toBeNull();
      expect(proposal.getAttribute('data-note-title')).toBe('Project Roadmap');
      expect(proposal.getAttribute('data-note-id')).toBe('note_target_2');

      const acceptBtn = proposal.querySelector('.btn-accept');
      expect(acceptBtn).not.toBeNull();

      // Accept the proposal
      acceptInlineProposal(acceptBtn);

      // Verify the proposal was replaced by the interactive note link
      const link = editor.querySelector('a.note-link');
      expect(link).not.toBeNull();
      expect(link.getAttribute('data-note-id')).toBe('note_target_2');
      expect(link.getAttribute('data-note-path')).toBe('notes/target.md');
      expect(link.textContent).toContain('Project Roadmap');

      editor.remove();
    });

    it('AIChatController.executeSuggestion executes link_note and inserts link into editor', async () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      editor.innerHTML = '<p>Existing notes content.</p>';
      document.body.appendChild(editor);

      if (typeof AIChatController !== 'undefined' && AIChatController.executeSuggestion) {
        AIChatController.saveCurrentConversation = vi.fn();
        globalThis.toast = vi.fn();

        await AIChatController.executeSuggestion({
          action: 'link_note',
          properties: {
            title: 'UI Architecture',
            id: 'note_target_3',
            path: 'notes/design.md'
          }
        });

        const link = editor.querySelector('a.note-link');
        expect(link).not.toBeNull();
        expect(link.getAttribute('data-note-id')).toBe('note_target_3');
        expect(link.getAttribute('data-note-path')).toBe('notes/design.md');
        expect(link.textContent).toContain('UI Architecture');
      }

      editor.remove();
    });

    it('AIChatController.executeSuggestion converts [[Title]] in text_correction into note links', async () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      editor.innerHTML = '<p>Refer to project info.</p>';
      document.body.appendChild(editor);

      if (typeof AIChatController !== 'undefined' && AIChatController.executeSuggestion) {
        AIChatController.saveCurrentConversation = vi.fn();
        globalThis.toast = vi.fn();

        await AIChatController.executeSuggestion({
          action: 'text_correction',
          properties: {
            target: 'project info',
            replacement: '[[Project Roadmap]]'
          }
        });

        const link = editor.querySelector('a.note-link');
        expect(link).not.toBeNull();
        expect(link.getAttribute('data-note-id')).toBe('note_target_2');
        expect(link.textContent).toContain('Project Roadmap');
      }

      editor.remove();
    });
  });

  describe('Link Editing and Management', () => {
    it('editLinkElement updates href and normalizes www. prefix with https://', async () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      const link = document.createElement('a');
      link.href = 'https://old-url.com';
      link.textContent = 'Visit Link';
      editor.appendChild(link);
      document.body.appendChild(editor);

      globalThis.showPromptDialog = vi.fn().mockResolvedValue('www.new-url.com');
      const inputSpy = vi.fn();
      editor.addEventListener('input', inputSpy);

      await editLinkElement(link, editor);

      expect(link.getAttribute('href')).toBe('https://www.new-url.com');
      expect(link.textContent).toBe('Visit Link');
      expect(inputSpy).toHaveBeenCalled();

      editor.remove();
    });

    it('editLinkElement updates link text when text was the previous URL', async () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      const link = document.createElement('a');
      link.setAttribute('href', 'https://initial-site.com');
      link.textContent = 'https://initial-site.com';
      editor.appendChild(link);
      document.body.appendChild(editor);

      globalThis.showPromptDialog = vi.fn().mockResolvedValue('https://updated-site.com');

      await editLinkElement(link, editor);

      expect(link.getAttribute('href')).toBe('https://updated-site.com');
      expect(link.textContent).toBe('https://updated-site.com');

      editor.remove();
    });

    it('editLinkElement leaves link unchanged when prompt is cancelled or empty', async () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      const link = document.createElement('a');
      link.setAttribute('href', 'https://keep-unchanged.com');
      link.textContent = 'Unchanged';
      editor.appendChild(link);
      document.body.appendChild(editor);

      globalThis.showPromptDialog = vi.fn().mockResolvedValue(null);

      await editLinkElement(link, editor);

      expect(link.getAttribute('href')).toBe('https://keep-unchanged.com');
      expect(link.textContent).toBe('Unchanged');

      editor.remove();
    });
  });

  describe('Rich Text Link Formatting & Pasting Options', () => {
    it('formatRichTextInEditor creates link with URL when text is selected', async () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      editor.innerHTML = '<p>Check out Google Search today.</p>';
      document.body.appendChild(editor);

      // Select 'Google Search'
      const p = editor.querySelector('p');
      const textNode = p.firstChild;
      const range = document.createRange();
      range.setStart(textNode, 10);
      range.setEnd(textNode, 23);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      globalThis.showPromptDialog = vi.fn().mockResolvedValue('https://google.com');

      formatRichTextInEditor(editor, 'link');

      // Wait for promise resolution
      await new Promise(r => setTimeout(r, 20));

      const link = editor.querySelector('a');
      expect(link).not.toBeNull();
      expect(link.getAttribute('href')).toBe('https://google.com');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.textContent).toBe('Google Search');

      editor.remove();
    });

    it('formatRichTextInEditor auto-prefixes www. with https://', async () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      editor.innerHTML = '<p>Useful Site</p>';
      document.body.appendChild(editor);

      const p = editor.querySelector('p');
      const range = document.createRange();
      range.selectNodeContents(p.firstChild);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      globalThis.showPromptDialog = vi.fn().mockResolvedValue('www.example.org');

      formatRichTextInEditor(editor, 'link');
      await new Promise(r => setTimeout(r, 20));

      const link = editor.querySelector('a');
      expect(link).not.toBeNull();
      expect(link.getAttribute('href')).toBe('https://www.example.org');

      editor.remove();
    });

    it('handleRichTextInputShortcuts handles Ctrl+K for link and formatting keys', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      document.body.appendChild(editor);

      globalThis.showPromptDialog = vi.fn().mockResolvedValue('https://example.com');

      // Test Ctrl+K
      const eventK = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
      const handledK = handleRichTextInputShortcuts(eventK, editor);
      expect(handledK).toBe(true);
      expect(eventK.defaultPrevented).toBe(true);

      // Test Ctrl+B (bold)
      const eventB = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true });
      const handledB = handleRichTextInputShortcuts(eventB, editor);
      expect(handledB).toBe(true);
      expect(eventB.defaultPrevented).toBe(true);

      // Test Ctrl+I (italic)
      const eventI = new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, cancelable: true });
      const handledI = handleRichTextInputShortcuts(eventI, editor);
      expect(handledI).toBe(true);
      expect(eventI.defaultPrevented).toBe(true);

      // Test Ctrl+U (underline)
      const eventU = new KeyboardEvent('keydown', { key: 'u', ctrlKey: true, cancelable: true });
      const handledU = handleRichTextInputShortcuts(eventU, editor);
      expect(handledU).toBe(true);
      expect(eventU.defaultPrevented).toBe(true);

      // Test Ctrl+Shift+H (mark)
      const eventH = new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, shiftKey: true, cancelable: true });
      const handledH = handleRichTextInputShortcuts(eventH, editor);
      expect(handledH).toBe(true);
      expect(eventH.defaultPrevented).toBe(true);

      // Test Ctrl+Shift+X (strike)
      const eventX = new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, shiftKey: true, cancelable: true });
      const handledX = handleRichTextInputShortcuts(eventX, editor);
      expect(handledX).toBe(true);
      expect(eventX.defaultPrevented).toBe(true);

      editor.remove();
    });

    it('handleImagePaste converts Markdown links [Text](url) into HTML anchors', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      document.body.appendChild(editor);
      editor.focus();

      const mdText = '[DeepMind](https://deepmind.google)';
      const pasteEvent = {
        preventDefault: vi.fn(),
        clipboardData: {
          items: [
            {
              type: 'text/plain',
              getAsString: (cb) => cb(mdText)
            }
          ]
        },
        currentTarget: editor
      };

      handleImagePaste(pasteEvent);

      const link = editor.querySelector('a');
      expect(link).not.toBeNull();
      expect(link.getAttribute('href')).toBe('https://deepmind.google');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.textContent).toBe('DeepMind');

      editor.remove();
    });

    it('handleImagePaste wraps active text selection when raw URL is pasted', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      editor.innerHTML = '<p>Click on this link for more.</p>';
      document.body.appendChild(editor);
      editor.focus();

      // Select 'this link'
      const textNode = editor.querySelector('p').firstChild;
      const range = document.createRange();
      range.setStart(textNode, 9);
      range.setEnd(textNode, 18);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      const rawUrl = 'https://vitest.dev';
      const pasteEvent = {
        preventDefault: vi.fn(),
        clipboardData: {
          items: [
            {
              type: 'text/plain',
              getAsString: (cb) => cb(rawUrl)
            }
          ]
        },
        currentTarget: editor
      };

      handleImagePaste(pasteEvent);

      const link = editor.querySelector('a');
      expect(link).not.toBeNull();
      expect(link.getAttribute('href')).toBe('https://vitest.dev');
      expect(link.textContent).toBe('this link');

      editor.remove();
    });

    it('handleImagePaste creates anchor from raw URL when no text is selected', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      document.body.appendChild(editor);
      editor.focus();

      const rawUrl = 'https://nodejs.org';
      const pasteEvent = {
        preventDefault: vi.fn(),
        clipboardData: {
          items: [
            {
              type: 'text/plain',
              getAsString: (cb) => cb(rawUrl)
            }
          ]
        },
        currentTarget: editor
      };

      handleImagePaste(pasteEvent);

      const link = editor.querySelector('a');
      expect(link).not.toBeNull();
      expect(link.getAttribute('href')).toBe('https://nodejs.org');
      expect(link.textContent).toBe('https://nodejs.org');

      editor.remove();
    });

    it('formatRichText rejects link, h3, table, and checklist in edit-summary', async () => {
      const summary = document.createElement('div');
      summary.id = 'edit-summary';
      summary.contentEditable = 'true';
      document.body.appendChild(summary);

      globalThis.toast = vi.fn();

      // Focus summary
      globalThis._lastFocusedEditor = summary;

      await formatRichText('link');
      expect(globalThis.toast).toHaveBeenCalledWith(expect.stringMatching(/unauthorized|not allowed/i), true);

      globalThis.toast.mockClear();
      await formatRichText('h3');
      expect(globalThis.toast).toHaveBeenCalledWith(expect.stringMatching(/unauthorized|not allowed/i), true);

      globalThis.toast.mockClear();
      await formatRichText('table');
      expect(globalThis.toast).toHaveBeenCalledWith(expect.stringMatching(/unauthorized|not allowed/i), true);

      globalThis.toast.mockClear();
      await formatRichText('checklist');
      expect(globalThis.toast).toHaveBeenCalledWith(expect.stringMatching(/unauthorized|not allowed/i), true);

      summary.remove();
    });

    it('insertNoteLink invokes openLinkNotePicker on button click', () => {
      globalThis.openLinkNotePicker = vi.fn();
      const testBtn = document.createElement('button');
      testBtn.id = 'fmt-link-note-btn';
      document.body.appendChild(testBtn);

      insertNoteLink(testBtn);
      expect(globalThis.openLinkNotePicker).toHaveBeenCalledWith(testBtn, expect.objectContaining({
        activeNoteId: globalThis.currentNote?.id
      }));

      testBtn.remove();
    });
  });

  describe('Rich Text Core Formatting Options', () => {
    it('executes heading, list, blockquote, and clear format commands', () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      editor.contentEditable = 'true';
      editor.innerHTML = '<p>Sample Text</p>';
      document.body.appendChild(editor);
      editor.focus();

      formatRichTextInEditor(editor, 'h1');
      expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, '<h1>');

      formatRichTextInEditor(editor, 'h2');
      expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, '<h2>');

      formatRichTextInEditor(editor, 'blockquote');
      expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, '<blockquote>');

      formatRichTextInEditor(editor, 'ul');
      expect(document.execCommand).toHaveBeenCalledWith('insertUnorderedList', false);

      formatRichTextInEditor(editor, 'ol');
      expect(document.execCommand).toHaveBeenCalledWith('insertOrderedList', false);

      formatRichTextInEditor(editor, 'h3');
      expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, '<h3>');

      formatRichTextInEditor(editor, 'clear');
      expect(document.execCommand).toHaveBeenCalledWith('removeFormat', false);
      expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, '<p>');

      editor.remove();
    });
  });
});
