import fs from 'fs';
import path from 'path';
import vm from 'vm';

const loadedScripts = new Set();

/**
 * Loads classic browser scripts into globalThis / window environment for unit testing.
 * @param {string[]} relativePaths - Array of relative file paths from project root
 */
export function loadScriptsIntoGlobal(relativePaths) {
  const projectRoot = process.cwd();

  if (!globalThis.window) {
    globalThis.window = globalThis;
  }
  if (!globalThis.settings) {
    globalThis.settings = { username: 'Me' };
  }
  if (!globalThis.todosManifest) {
    globalThis.todosManifest = [];
  }
  if (!globalThis.document) {
    globalThis.document = window.document;
  }

  for (const relPath of relativePaths) {
    const fullPath = path.resolve(projectRoot, relPath);
    if (loadedScripts.has(fullPath)) {
      continue;
    }

    let code = fs.readFileSync(fullPath, 'utf-8');
    
    // Replace top-level 'const ' and 'let ' declarations with 'var ' for vm context safety
    code = code.replace(/^(const|let)\s+([a-zA-Z0-9_$]+)/gm, 'var $2');

    vm.runInThisContext(code, { filename: fullPath });
    loadedScripts.add(fullPath);
  }
}
