# Versioning Guidelines

This document outlines how versioning is managed across the Secretary codebase.

---

## 1. Version Policy & When to Bump

- **Explicit Command Only**: Version numbers, cache-buster query strings (`?v=X.X.X`), and release links **MUST ONLY** be increased when explicitly commanded by the user.
- **Do NOT bump versions** on regular feature or bugfix tasks unless explicitly requested.
- **When commanded to bump/release**:
  - **Major version** (`X.0.0`): Major structural changes or breaking architecture updates.
  - **Minor version** (`X.Y.0`): Feature additions or enhancements.
  - **Patch version** (`X.Y.Z`): Small bug fixes and tweaks.

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
3. **`app.html`**:
   - Landing screen version hint element: `<p id="connect-version-hint" data-version="X.Y.Z">Version X.Y.Z</p>`
   - Cache-busting query params on all local CSS & JS tags: `<link ... href="css/...css?v=X.Y.Z">` and `<script src="js/...js?v=X.Y.Z"></script>`
4. **`README.md`**: Download links (`https://github.com/ebelt9hf/The_Secretary/releases/download/vX.Y.Z/Secretary-X.Y.Z-...`) and binary filenames.
