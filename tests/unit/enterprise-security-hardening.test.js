import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Enterprise Security Hardening Audit', () => {
  const rootDir = path.resolve(__dirname, '../../');

  it('Finding 3 & 6: HTML windows use strict Content-Security-Policy and zero external CDN scripts', () => {
    const htmlFiles = ['app.html', 'note-window.html', 'secretary-window.html'];

    for (const file of htmlFiles) {
      const fullPath = path.join(rootDir, file);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf8');

      // Zero external CDN scripts / stylesheets in <script> and <link>
      expect(content).not.toMatch(/<script[^>]*src=["']https?:\/\//i);
      expect(content).not.toMatch(/<link[^>]*href=["']https?:\/\//i);

      // Strictly loads local vendored assets
      expect(content).toContain('css/vendor/katex.min.css');
      expect(content).toContain('js/vendor/katex.min.js');
      expect(content).toContain('js/vendor/katex-auto-render.min.js');
      expect(content).toContain('js/vendor/dompurify.min.js');
      expect(content).toContain('js/vendor/marked.min.js');

      // Validates presence of Content-Security-Policy meta tag
      expect(content).toMatch(/<meta\s+http-equiv=["']Content-Security-Policy["']/i);
      expect(content).toContain("default-src 'self'");
      expect(content).toContain("object-src 'none'");

      // Finding 2: ensure sanitize: false is removed
      expect(content).not.toContain('sanitize: false');
    }
  });

  it('Finding 2: sanitizeHTML strips XSS payloads while preserving safe markdown and math', () => {
    // Load app-utils.js content to test sanitizeHTML in unit environment
    const appUtilsCode = fs.readFileSync(path.join(rootDir, 'js/app-utils.js'), 'utf8');
    const fnMatch = appUtilsCode.match(/function sanitizeHTML\(dirty[\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();

    // Evaluate sanitizeHTML in isolated scope
    const sanitizeHTML = new Function(`${fnMatch[0]}; return sanitizeHTML;`)();

    // 1. Script injection
    const dirtyScript = '<p>Normal text</p><script>alert("XSS")</script>';
    expect(sanitizeHTML(dirtyScript)).not.toContain('<script>');
    expect(sanitizeHTML(dirtyScript)).not.toContain('alert("XSS")');

    // 2. Onerror / event handler injection
    const dirtyImg = '<img src="x" onerror="stealSecrets()">';
    expect(sanitizeHTML(dirtyImg)).not.toContain('onerror');
    expect(sanitizeHTML(dirtyImg)).not.toContain('stealSecrets()');

    // 3. Javascript: protocol link
    const dirtyLink = '<a href="javascript:alert(1)">Click me</a>';
    expect(sanitizeHTML(dirtyLink)).not.toContain('javascript:');

    // 4. Safe tags and custom data attributes preserved
    const safeHtml = '<span class="note-todo" data-todo-id="t-1" data-note-id="n-1">Task 1</span>';
    const cleaned = sanitizeHTML(safeHtml);
    expect(cleaned).toContain('data-todo-id="t-1"');
    expect(cleaned).toContain('Task 1');
  });

  it('Finding 5: database.rules.json prevents public listing of pairing codes and licenses', () => {
    const rulesPath = path.join(rootDir, 'database.rules.json');
    const raw = fs.readFileSync(rulesPath, 'utf8');
    const jsonWithoutComments = raw.replace(/\/\/.*$/gm, '');
    const rules = JSON.parse(jsonWithoutComments);

    // pairing_codes must NOT be globally readable by any authenticated user
    const pairingRules = rules.rules.pairing_codes;
    expect(pairingRules['.read']).toBeUndefined(); // parent list cannot be read
    expect(pairingRules.$code['.read']).not.toBe('auth != null'); // individual keys cannot be read blindly
    expect(pairingRules.$code['.read']).toContain('data.exists()');

    // licenses must NOT be globally readable
    const licenseRules = rules.rules.licenses;
    expect(licenseRules['.read']).toBeUndefined();
    expect(licenseRules.$licenseKey['.read']).not.toBe('auth != null');
    expect(licenseRules.$licenseKey['.read']).toContain("data.child('ownerUid').val() === auth.uid");
  });

  it('Finding 1 & 7: electron/main.js enables sandbox, removes bypassCSP, and secures IPC permissions', () => {
    const mainPath = path.join(rootDir, 'electron/main.js');
    const mainCode = fs.readFileSync(mainPath, 'utf8');

    // All windows must have sandbox: true
    expect(mainCode).not.toContain('sandbox: false');
    expect(mainCode).toContain('sandbox: true');

    // Custom scheme must NOT bypass CSP
    expect(mainCode).not.toContain('bypassCSP: true');

    // Permission request handler must default to callback(false)
    expect(mainCode).toContain('callback(false);');
    expect(mainCode).not.toMatch(/if\s*\(allowed\.includes\(permission\)\)\s*\{\s*return callback\(true\);\s*\}\s*callback\(true\);/);

    // Privileged IPC handlers verify authorized sender
    expect(mainCode).toContain("isAuthorizedSender(event.sender)");
    expect(mainCode).toContain("isSafeWorkspaceDirectory(folderPath)");
  });
});
