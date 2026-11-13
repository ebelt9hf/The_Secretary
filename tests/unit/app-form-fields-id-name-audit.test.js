import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import glob from 'glob';

describe('Form Fields id and name Deployment Audit', () => {
  const rootDir = path.resolve(__dirname, '../../');

  it('ensures all interactive form elements (<select>, <input>, <textarea>) have id or name attributes', () => {
    const htmlFiles = glob.sync('*.html', { cwd: rootDir });
    const jsFiles = glob.sync('js/*.js', { cwd: rootDir });
    const allFiles = [...htmlFiles, ...jsFiles];

    const ignoredFiles = ['vendor', 'firebase', 'app-prompts.js', 'app-state.js'];
    const pattern = /<(select|input|textarea)\b([^>]*?)>/gis;

    const violations = [];

    for (const relPath of allFiles) {
      if (ignoredFiles.some(ign => relPath.includes(ign))) {
        continue;
      }

      const fullPath = path.join(rootDir, relPath);
      if (!fs.existsSync(fullPath)) continue;

      const rawContent = fs.readFileSync(fullPath, 'utf8');

      // Strip comments (multi-line, single-line, HTML comments) iteratively until fixed point
      let cleanContent = rawContent;
      let prevContent;
      do {
        prevContent = cleanContent;
        cleanContent = cleanContent
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '')
          .replace(/<!--[\s\S]*?-->/g, '');
      } while (cleanContent !== prevContent);

      let match;
      while ((match = pattern.exec(cleanContent)) !== null) {
        const tag = match[1].toLowerCase();
        const attrs = match[2];

        const hasId = /\bid\s*=/i.test(attrs);
        const hasName = /\bname\s*=/i.test(attrs);

        if (!hasId && !hasName) {
          const lineNo = cleanContent.slice(0, match.index).split('\n').length;
          let snippet = match[0].replace(/\s+/g, ' ');
          if (snippet.length > 100) {
            snippet = snippet.slice(0, 100) + '...';
          }
          violations.push({
            file: relPath,
            line: lineNo,
            tag,
            snippet
          });
        }
      }
    }

    if (violations.length > 0) {
      const summary = violations
        .map(v => `  - ${v.file}:${v.line} <${v.tag}>: ${v.snippet}`)
        .join('\n');
      expect.fail(`Found ${violations.length} form element(s) missing both id and name attributes:\n${summary}`);
    }

    expect(violations.length).toBe(0);
  });
});

