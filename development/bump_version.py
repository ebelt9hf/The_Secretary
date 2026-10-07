#!/usr/bin/env python3
"""
Bump Version Script for Secretary Repository

Synchronizes the application version across all project files:
1. package.json ("version": "X.Y.Z")
2. package-lock.json ("version": "X.Y.Z")
3. app.html (landing page #connect-version-hint and ?v=X.Y.Z cache busters)
4. README.md (release binary links and tags)

Usage:
  python3 development/bump_version.py 2.7.1
  python3 development/bump_version.py --minor
  python3 development/bump_version.py --major
  python3 development/bump_version.py --patch
  python3 development/bump_version.py --check
"""

import sys
import re
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def get_current_version() -> str:
    pkg_file = ROOT / "package.json"
    with open(pkg_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("version", "1.0.0")

def compute_next_version(current: str, bump_type: str) -> str:
    parts = [int(p) for p in current.split(".")]
    while len(parts) < 3:
        parts.append(0)
    major, minor, patch = parts[0], parts[1], parts[2]
    
    if bump_type == "--major":
        return f"{major + 1}.0.0"
    elif bump_type == "--minor":
        return f"{major}.{minor + 1}.0"
    elif bump_type == "--patch":
        return f"{major}.{minor}.{patch + 1}"
    else:
        # Direct version string
        clean = bump_type.lstrip("v")
        if not re.match(r"^\d+\.\d+\.\d+$", clean):
            print(f"Error: Invalid version string format '{bump_type}'. Expected X.Y.Z")
            sys.exit(1)
        return clean

def update_package_json(version: str):
    pkg_file = ROOT / "package.json"
    content = pkg_file.read_text(encoding="utf-8")
    new_content = re.sub(r'("version"\s*:\s*)"[0-9]+\.[0-9]+\.[0-9]+"', rf'\g<1>"{version}"', content, count=1)
    pkg_file.write_text(new_content, encoding="utf-8")
    print(f"  ✓ package.json -> {version}")

def update_package_lock_json(version: str):
    lock_file = ROOT / "package-lock.json"
    if not lock_file.exists():
        return
    content = lock_file.read_text(encoding="utf-8")
    # Replace root version and packages[""].version
    new_content = re.sub(r'("version"\s*:\s*)"[0-9]+\.[0-9]+\.[0-9]+"', rf'\g<1>"{version}"', content, count=2)
    lock_file.write_text(new_content, encoding="utf-8")
    print(f"  ✓ package-lock.json -> {version}")

def update_app_html(version: str):
    for filename in ["app.html", "note-window.html", "secretary-window.html"]:
        html_file = ROOT / filename
        if not html_file.exists():
            continue
        content = html_file.read_text(encoding="utf-8")
        
        # 1. Update cache busters ?v=X.X.X
        new_content = re.sub(r'\?v=[0-9]+\.[0-9]+\.[0-9]+', f'?v={version}', content)
        
        # 2. Update landing page connect-version-hint if present
        hint_pattern = r'(<p\s+id="connect-version-hint"\s+data-version=")[^"]*(".*?>)Version\s+[^<]*(</p>)'
        new_content = re.sub(
            hint_pattern,
            rf'\g<1>{version}\g<2>Version {version}\g<3>',
            new_content
        )
        
        html_file.write_text(new_content, encoding="utf-8")
        print(f"  ✓ {filename} (cache busters) -> {version}")

def update_readme(version: str):
    readme_file = ROOT / "README.md"
    if not readme_file.exists():
        return
    content = readme_file.read_text(encoding="utf-8")
    
    # Update release download URLs and asset file names
    content = re.sub(r'/releases/download/v[0-9]+\.[0-9]+\.[0-9]+/', f'/releases/download/v{version}/', content)
    content = re.sub(r'Secretary-[0-9]+\.[0-9]+\.[0-9]+', f'Secretary-{version}', content)
    
    readme_file.write_text(content, encoding="utf-8")
    print(f"  ✓ README.md (release links) -> v{version}")

def check_parity() -> bool:
    curr = get_current_version()
    mismatches = []
    
    for filename in ["app.html", "note-window.html", "secretary-window.html"]:
        html_file = ROOT / filename
        if not html_file.exists():
            continue
        content = html_file.read_text(encoding="utf-8")
        busting_tags = re.findall(r'\?v=([0-9]+\.[0-9]+\.[0-9]+)', content)
        stale_tags = [v for v in busting_tags if v != curr]
        if stale_tags:
            mismatches.append(f"{filename} has {len(stale_tags)} cache busters not matching {curr} (found: {set(stale_tags)})")
            
    html_file = ROOT / "app.html"
    content = html_file.read_text(encoding="utf-8")
    hint_match = re.search(r'id="connect-version-hint"\s+data-version="([^"]*)"', content)
    if hint_match and hint_match.group(1) != curr:
        mismatches.append(f"app.html landing version hint is '{hint_match.group(1)}' but package.json is '{curr}'")
        
    if mismatches:
        print(f"❌ Version discrepancies found (current package.json: {curr}):")
        for m in mismatches:
            print(f"  - {m}")
        return False
    else:
        print(f"✓ All files consistent with version {curr}")
        return True

def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 development/bump_version.py <version|--patch|--minor|--major|--check>")
        sys.exit(1)
        
    arg = sys.argv[1]
    if arg == "--check":
        consistent = check_parity()
        sys.exit(0 if consistent else 1)
        
    curr = get_current_version()
    new_ver = compute_next_version(curr, arg)
    print(f"Bumping version from {curr} to {new_ver}...")
    
    update_package_json(new_ver)
    update_package_lock_json(new_ver)
    update_app_html(new_ver)
    update_readme(new_ver)
    print(f"\n🎉 Successfully bumped project version to {new_ver} across all files!")

if __name__ == "__main__":
    main()
