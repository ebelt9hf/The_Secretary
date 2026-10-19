import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note Image Captions & AI Perfect Note Integration', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-prompts.js',
      'js/app-llm.js',
      'js/app-overlay.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="edit-textarea" contenteditable="true"></div>
      <div id="note-image-lightbox">
        <div class="note-image-lightbox-container">
          <img id="note-image-lightbox-img" src="" alt="preview">
        </div>
      </div>
    `;
  });

  describe('Editor UI Caption Management (toggleOrFocusImageCaption)', () => {
    it('wraps an image in a figure and creates an editable caption below it', () => {
      const editor = document.getElementById('edit-textarea');
      editor.innerHTML = '<img id="test-img-1" src="test.png" style="width:500px;" alt="Architecture diagram">';
      const img = document.getElementById('test-img-1');

      const caption = toggleOrFocusImageCaption(img, editor);
      expect(caption).not.toBeNull();
      expect(caption.tagName.toLowerCase()).toBe('figcaption');
      expect(caption.classList.contains('note-image-caption')).toBe(true);
      expect(caption.getAttribute('contenteditable')).toBe('true');
      expect(caption.getAttribute('data-placeholder')).toBe('Add image caption...');

      const figure = img.closest('.note-image-figure');
      expect(figure).not.toBeNull();
      expect(figure.tagName.toLowerCase()).toBe('figure');
      expect(figure.contains(img)).toBe(true);
      expect(figure.contains(caption)).toBe(true);
      expect(figure.style.width).toBe('500px');
    });

    it('focuses existing caption when toggleOrFocusImageCaption is called again', () => {
      const editor = document.getElementById('edit-textarea');
      editor.innerHTML = `
        <figure class="note-image-figure">
          <img id="test-img-2" src="test2.png">
          <figcaption class="note-image-caption" contenteditable="true">Initial caption</figcaption>
        </figure>
      `;
      const img = document.getElementById('test-img-2');

      const caption = toggleOrFocusImageCaption(img, editor);
      expect(caption.textContent).toBe('Initial caption');
      expect(document.activeElement).toBe(caption);
    });

    it('removes empty caption when Backspace is pressed in it', () => {
      const editor = document.getElementById('edit-textarea');
      editor.innerHTML = `
        <figure class="note-image-figure">
          <img id="test-img-3" src="test3.png">
          <figcaption class="note-image-caption" contenteditable="true"></figcaption>
        </figure>
      `;
      const img = document.getElementById('test-img-3');
      const caption = toggleOrFocusImageCaption(img, editor);

      const backspaceEvent = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
      caption.dispatchEvent(backspaceEvent);

      const figure = img.closest('.note-image-figure');
      expect(figure.querySelector('.note-image-caption')).toBeNull();
    });

    it('creates paragraph below figure when Enter is pressed in caption', () => {
      const editor = document.getElementById('edit-textarea');
      editor.innerHTML = `
        <figure class="note-image-figure">
          <img id="test-img-4" src="test4.png">
          <figcaption class="note-image-caption" contenteditable="true">System Overview</figcaption>
        </figure>
      `;
      const img = document.getElementById('test-img-4');
      const caption = toggleOrFocusImageCaption(img, editor);

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      caption.dispatchEvent(enterEvent);

      const figure = img.closest('.note-image-figure');
      expect(figure.nextSibling).not.toBeNull();
      expect(figure.nextSibling.tagName.toLowerCase()).toBe('p');
    });
  });

  describe('Image Resize Toolbar & Deletion', () => {
    it('creates toolbar with Caption button and localized tooltip', () => {
      const editor = document.getElementById('edit-textarea');
      editor.innerHTML = '<img id="test-img-5" src="test5.png">';
      const img = document.getElementById('test-img-5');

      selectEditorImage(img, editor);

      const toolbar = document.querySelector('.img-resize-toolbar');
      expect(toolbar).not.toBeNull();

      const captionBtn = toolbar.querySelector('.img-caption-btn');
      expect(captionBtn).not.toBeNull();
      expect(captionBtn.textContent).toContain('Caption');
      expect(captionBtn.title).toBe('Add or edit image caption');
      expect(captionBtn.title).not.toBe(captionBtn.textContent.trim());

      hideImageActiveOverlay();
    });

    it('removes entire figure when delete button is clicked on selected image', () => {
      const editor = document.getElementById('edit-textarea');
      editor.innerHTML = `
        <figure class="note-image-figure">
          <img id="test-img-6" src="test6.png">
          <figcaption class="note-image-caption">Remove me with figure</figcaption>
        </figure>
      `;
      const img = document.getElementById('test-img-6');

      selectEditorImage(img, editor);

      const delBtn = document.querySelector('.editor-img-delete-btn');
      expect(delBtn).not.toBeNull();
      delBtn.click();

      expect(editor.querySelector('.note-image-figure')).toBeNull();
      expect(editor.querySelector('img')).toBeNull();
    });
  });

  describe('HTML Sanitization (sanitizePastedHTML)', () => {
    it('preserves figure and figcaption elements when pasting HTML', () => {
      const inputHtml = `
        <figure class="note-image-figure" style="max-width:100%;width:600px">
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="Sample Diagram">
          <figcaption class="note-image-caption" contenteditable="true" data-placeholder="Add image caption...">High level pipeline</figcaption>
        </figure>
      `;

      const sanitized = sanitizePastedHTML(inputHtml);
      expect(sanitized).toContain('<figure');
      expect(sanitized).toContain('note-image-figure');
      expect(sanitized).toContain('<figcaption');
      expect(sanitized).toContain('High level pipeline');
    });
  });

  describe('LLM Note Content Preparation (prepareNoteContentForLLM)', () => {
    it('extracts existing figure caption into placeholder so LLM sees caption context', () => {
      const noteHtml = `
        <h2>Architecture</h2>
        <figure class="note-image-figure">
          <img src="notes/_assets/img_123.png" alt="Service Mesh">
          <figcaption class="note-image-caption">Microservices architecture topology</figcaption>
        </figure>
      `;

      const textForLLM = LLMService.prepareNoteContentForLLM(noteHtml);
      expect(textForLLM).toContain('[IMAGE_1: figure image with caption: "Microservices architecture topology" (see attached vision payload)]');
    });
  });

  describe('Proposal Image & Caption Restoration (restoreOriginalImagesToProposal)', () => {
    it('replaces [IMAGE_1: New refined caption] with figure containing the new caption', () => {
      const origHtml = '<img src="notes/_assets/img_abc.png" alt="Graph">';
      const proposalHtml = '<p>Executive synthesis</p>\n[IMAGE_1: Refined Q3 conversion funnel diagram]\n<p>Action items</p>';

      const restored = restoreOriginalImagesToProposal(origHtml, proposalHtml);
      expect(restored).toContain('note-image-figure');
      expect(restored).toContain('note-embedded-image-wrap');
      expect(restored).toContain('src="notes/_assets/img_abc.png"');
      expect(restored).toContain('<figcaption class="note-image-caption"');
      expect(restored).toContain('Refined Q3 conversion funnel diagram');
    });

    it('preserves original caption if proposal includes just [IMAGE_1]', () => {
      const origHtml = `
        <figure class="note-image-figure">
          <img src="notes/_assets/img_def.png" alt="Topology">
          <figcaption class="note-image-caption">Kubernetes cluster layout</figcaption>
        </figure>
      `;
      const proposalHtml = '<h2>Infrastructure</h2>\n[IMAGE_1]\n<p>Summary</p>';

      const restored = restoreOriginalImagesToProposal(origHtml, proposalHtml);
      expect(restored).toContain('note-image-figure');
      expect(restored).toContain('note-embedded-image-wrap');
      expect(restored).toContain('src="notes/_assets/img_def.png"');
      expect(restored).toContain('Kubernetes cluster layout');
    });

    it('preserves semantic figure and figcaption written directly by LLM', () => {
      const origHtml = '<img src="notes/_assets/img_xyz.png" alt="Whiteboard">';
      const proposalHtml = `
        <h2>Discussion Points</h2>
        <figure class="note-image-figure">[IMAGE_1]<figcaption class="note-image-caption">Brainstorming session whiteboard</figcaption></figure>
      `;

      const restored = restoreOriginalImagesToProposal(origHtml, proposalHtml);
      expect(restored).toContain('src="notes/_assets/img_xyz.png"');
      expect(restored).toContain('Brainstorming session whiteboard');
      expect(restored).not.toContain('[IMAGE_1]');
    });
  });

  describe('Perfect Note AI Prompt Instructions (AppPrompts)', () => {
    it('includes explicit instructions for adding, changing, and preserving image captions in buildPerfectNotePrompt', () => {
      const prompt = AppPrompts.buildPerfectNotePrompt({ targetLang: 'en' });
      expect(prompt).toContain('INLINE IMAGE PLACEMENT IN PROPOSALS (PRESERVE POSITIONING)');
      expect(prompt).toContain('Explanatory Captions');
      expect(prompt).toContain('Adding / Changing Captions');
      expect(prompt).toContain('note-image-caption');
    });

    it('includes caption guidelines in buildRefinePerfectNotePrompt', () => {
      const prompt = AppPrompts.buildRefinePerfectNotePrompt({ targetLang: 'en' });
      expect(prompt).toContain('VISION & MULTIMODAL INTEGRATION (STANDARD)');
      expect(prompt).toContain('note-image-caption');
    });

    it('includes caption guidelines in buildOptionCWithFeedbackPrompt', () => {
      const prompt = AppPrompts.buildOptionCWithFeedbackPrompt({ targetLang: 'en', feedback: 'More concise' });
      expect(prompt).toContain('VISION & INLINE IMAGES (STANDARD)');
      expect(prompt).toContain('note-image-caption');
    });
  });
});
