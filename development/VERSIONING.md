# Versioning Guidelines

This document outlines how versioning is managed across the Secretary codebase.

---

## 1. Version Policy & When to Bump

- **Increase Version with Each Commit to `main`**: Version numbers, cache-buster query strings (`?v=X.X.X`), and release links **MUST** be increased with every commit to the `main` branch.
- **Increment Levels**:
  - **Patch version** (`--patch`, `X.Y.Z`): Standard default for bug fixes, tweaks, and incremental commits.
  - **Minor version** (`--minor`, `X.Y.0`): New features, major UI enhancements, or capability additions.
  - **Major version** (`--major`, `X.0.0`): Major structural changes or breaking architecture updates.
- **Git Hook Automation**: A Git pre-commit hook (`.githooks/pre-commit`) automatically verifies that every commit to `main` increments the patch version if not already bumped manually.

---

## 2. Automated Version Bumping

Instead of manually editing dozens of `<link>` and `<script>` tags, use the automated helper script:

```bash
# Bump to a specific version:
python3 development/bump_version.py 2.7.1

# Or bump semver increment:
python3 development/bump_version.py --patch
python3 development/bump_version.py --minor
python3 development/bump_version.py --major

# Check consistency across all files:
python3 development/bump_version.py --check
```

---

## 3. All Files Managed by Versioning

When bumping the version, the following places must remain in parity:

1. **`package.json`**: `"version": "X.Y.Z"`
2. **`package-lock.json`**: Root package `"version": "X.Y.Z"` and `packages[""].version`
3. **`app.html`, `note-window.html`, `secretary-window.html`**:
   - Landing screen version hint element: `<p id="connect-version-hint" data-version="X.Y.Z">Version X.Y.Z</p>`
   - Cache-busting query params on all local CSS & JS tags: `<link ... href="css/...css?v=X.Y.Z">` and `<script src="js/...js?v=X.Y.Z"></script>`
4. **`README.md`**: Download links (`https://github.com/ebelt9hf/The_Secretary/releases/download/vX.Y.Z/Secretary-X.Y.Z-...`) and binary filenames.
