import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

describe('Global Script Execution & Identifier Scope (app-fs.js, app-state.js, app-init.js)', () => {
  it('has no top-level const/let identifier collisions across script files loaded in app.html', () => {
    const htmlContent = fs.readFileSync(path.resolve(process.cwd(), 'app.html'), 'utf-8');
    const scriptSrcMatches = [...htmlContent.matchAll(/<script\s+src=["'](js\/[^"']+)["']/g)];
    const scriptPaths = scriptSrcMatches.map(m => m[1].split('?')[0]);

    const topLevelDeclarations = new Map();
    const collisions = [];

    for (const relPath of scriptPaths) {
      const fullPath = path.resolve(process.cwd(), relPath);
      if (!fs.existsSync(fullPath)) continue;

      const code = fs.readFileSync(fullPath, 'utf-8');
      const matches = [...code.matchAll(/^(?:const|let)\s+([a-zA-Z0-9_$]+)/gm)];

      for (const m of matches) {
        const identifier = m[1];
        if (topLevelDeclarations.has(identifier)) {
          collisions.push({
            identifier,
            firstFile: topLevelDeclarations.get(identifier),
            secondFile: relPath
          });
        } else {
          topLevelDeclarations.set(identifier, relPath);
        }
      }
    }

    expect(collisions).toEqual([]);
  });

  it('evaluates app-state.js and app-fs.js sequentially in VM without SyntaxError or undefined exports', () => {
    const stateCode = fs.readFileSync(path.resolve(process.cwd(), 'js/app-state.js'), 'utf-8');
    const fsCode = fs.readFileSync(path.resolve(process.cwd(), 'js/app-fs.js'), 'utf-8');

    const sandbox = { window: {}, console, localStorage: { getItem: () => null } };
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);

    // Evaluating stateCode then fsCode without modification
    expect(() => {
      vm.runInContext(stateCode, context, { filename: 'js/app-state.js' });
      vm.runInContext(fsCode, context, { filename: 'js/app-fs.js' });
    }).not.toThrow();

    expect(typeof sandbox.deepMerge).toBe('function');
    expect(typeof sandbox.fileExists).toBe('function');
  });
});
