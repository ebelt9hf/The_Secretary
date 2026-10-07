#!/usr/bin/env python3
"""
NPD (Native Package Distribution) Compiler for Apple (macOS) and Windows.

This script automates the compilation and packaging of Secretary into native
desktop application distributions for Apple (macOS) and Microsoft Windows,
organizing output binaries into versioned release folders and applying macOS
security remediations (ad-hoc code signing & Gatekeeper quarantine removal).

Workflow:
  1. Environment & Node/NPM check + iCloud Sync directory warning check
  2. Read application version from package.json (e.g. v1.0.0)
  3. Translation integrity verification (check_translations.py)
  4. Frontend production build (npm run build)
  5. Platform packaging via Electron Builder (Apple & Windows targets)
  6. Migration into platform-specific version subfolders:
       - Apple apps:   dist/v<version>/apple/
       - Windows apps: dist/v<version>/windows/
  7. Apple Security Remediations (codesign --force --deep --sign - & xattr -cr)
  8. Artifact summary & size reports

Usage:
  python3 development/compile_npd.py [options]

Examples:
  python3 development/compile_npd.py                       # Build Apple & Windows apps in dist/v1.0.0/
  python3 development/compile_npd.py --target apple         # Build macOS apps in dist/v1.0.0/apple/
  python3 development/compile_npd.py --target windows       # Build Windows apps in dist/v1.0.0/windows/
  python3 development/compile_npd.py --mode package         # Unpacked directory build
  python3 development/compile_npd.py --clean                # Clean dist/ output folder prior to building
"""

import argparse
import json
import os
import pathlib
import shutil
import stat
import subprocess
import sys
import time

# Base workspace directory (parent of development/)
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
WORKSPACE_DIR = SCRIPT_DIR.parent

# ANSI Color formatting
class Colors:
    HEADER = "\033[95m"
    OKBLUE = "\033[94m"
    OKCYAN = "\033[96m"
    OKGREEN = "\033[92m"
    WARNING = "\033[93m"
    FAIL = "\033[91m"
    ENDC = "\033[0m"
    BOLD = "\033[1m"
    UNDERLINE = "\033[4m"


def print_step(title: str):
    print(f"\n{Colors.BOLD}{Colors.OKBLUE}==> {title}{Colors.ENDC}")


def print_success(message: str):
    print(f"{Colors.OKGREEN}✓ {message}{Colors.ENDC}")


def print_warning(message: str):
    print(f"{Colors.WARNING}⚠️  {message}{Colors.ENDC}")


def print_error(message: str):
    print(f"{Colors.FAIL}❌ {message}{Colors.ENDC}")


def check_icloud_sync(workspace_dir: pathlib.Path):
    """Check if the workspace directory is located inside an iCloud Drive synced folder."""
    try:
        home_dir = pathlib.Path.home()
        resolved_path = str(workspace_dir.resolve())

        in_documents_or_desktop = (
            resolved_path.startswith(str(home_dir / "Documents")) or 
            resolved_path.startswith(str(home_dir / "Desktop")) or
            "Mobile Documents" in resolved_path or
            "com~apple~CloudDocs" in resolved_path
        )

        if in_documents_or_desktop:
            print_warning(
                "Workspace is located inside a Documents/Desktop folder which may be synced with iCloud Drive.\n"
                "   iCloud Drive may re-apply extended quarantine attributes (com.apple.fileprovider.fpfs#P).\n"
                "   If macOS blocks the app continuously, consider moving the workspace to ~/Developer or ~/Projects."
            )
    except Exception:
        pass


def check_rosetta_environment(targets: list):
    """
    Check if Rosetta 2 is installed on Apple Silicon (ARM64) macOS when building Windows targets.
    electron-builder cross-compilation uses x86_64 Wine binaries to package Windows apps on macOS.
    """
    if sys.platform != "darwin":
        return
    if "win" not in targets and "windows" not in targets:
        return

    import platform
    if platform.machine() == "arm64":
        try:
            res = subprocess.run(["arch", "-x86_64", "/usr/bin/true"], capture_output=True)
            if res.returncode != 0:
                print_warning(
                    "Rosetta 2 is missing on Apple Silicon macOS.\n"
                    "   Electron-builder cross-compilation requires Rosetta 2 to execute x86_64 Wine/rcedit binaries.\n"
                    "   Attempting automatic installation of Rosetta 2..."
                )
                inst = subprocess.run(["softwareupdate", "--install-rosetta", "--agree-to-license"])
                if inst.returncode == 0:
                    print_success("Rosetta 2 successfully installed.")
                else:
                    print_error(
                        "Rosetta 2 installation failed. Please run manually in Terminal:\n"
                        "   softwareupdate --install-rosetta --agree-to-license"
                    )
            else:
                print_success("Apple Silicon Rosetta 2 translation layer verified for x86_64 Wine cross-compilation.")
        except Exception:
            pass


def get_project_version() -> str:
    """Read version field from package.json in workspace root."""
    package_json_path = WORKSPACE_DIR / "package.json"
    if package_json_path.exists():
        try:
            with open(package_json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                ver = data.get("version", "1.0.0")
                return f"v{ver}" if not ver.startswith("v") else ver
        except Exception:
            pass
    return "v1.0.0"


def update_readme_release_links(version_tag: str):
    """Update release download links and filenames in README.md to match current version_tag."""
    readme_path = WORKSPACE_DIR / "README.md"
    if not readme_path.exists():
        return

    clean_version = version_tag.lstrip("v")
    try:
        content = readme_path.read_text(encoding="utf-8")
        import re
        updated_content = re.sub(
            r"Secretary-\d+\.\d+\.\d+",
            f"Secretary-{clean_version}",
            content
        )
        updated_content = re.sub(
            r"/releases/download/v\d+\.\d+\.\d+/",
            f"/releases/download/{version_tag}/",
            updated_content
        )
        if updated_content != content:
            readme_path.write_text(updated_content, encoding="utf-8")
            print_success(f"Updated README.md release links to {version_tag}")
    except Exception as exc:
        print_warning(f"Could not update README.md links: {exc}")


def find_executable(name: str) -> str:
    """Locate npm, npx, or node executables across OS environments."""
    found = shutil.which(name)
    if found:
        return found

    # Windows fallback locations
    if os.name == "nt":
        exts = [".cmd", ".exe", ".bat", ""]
        candidates = [
            os.path.join(r"C:\Program Files\nodejs", f"{name}{ext}"),
            os.path.join(r"C:\Program Files (x86)\nodejs", f"{name}{ext}"),
        ]
        local_appdata = os.environ.get("LOCALAPPDATA")
        if local_appdata:
            candidates.extend([
                os.path.join(local_appdata, "Programs", "nodejs", f"{name}{ext}"),
            ])
        for ext in exts:
            for cand in candidates:
                if os.path.exists(cand):
                    return cand

    return name


def run_command(cmd, cwd=WORKSPACE_DIR, env=None) -> bool:
    """Execute a shell/subprocess command with clean streaming output."""
    printable_cmd = " ".join(cmd) if isinstance(cmd, list) else cmd
    print(f"{Colors.OKCYAN}$ {printable_cmd}{Colors.ENDC}")

    run_env = os.environ.copy()
    if env:
        run_env.update(env)

    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            env=run_env,
            shell=isinstance(cmd, str) and os.name == "nt",
            check=True
        )
        return proc.returncode == 0
    except subprocess.CalledProcessError as err:
        print_error(f"Command failed with exit code {err.returncode}: {printable_cmd}")
        return False
    except Exception as exc:
        print_error(f"Failed to execute command '{printable_cmd}': {exc}")
        return False


def format_bytes(size: int) -> str:
    """Format bytes into human-readable representation."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} TB"


def organize_platform_artifacts(dist_dir: pathlib.Path, version_tag: str, target: str) -> pathlib.Path:
    """
    Move compiled platform binaries from dist/ root into version subfolders:
      dist/v<version>/apple/  (for mac / apple)
      dist/v<version>/windows/ (for win / windows)
    """
    time.sleep(1)  # Brief pause for filesystem flush
    version_dir = dist_dir / version_tag
    platform_name = "apple" if target in ["mac", "apple"] else "windows"
    target_dir = version_dir / platform_name
    target_dir.mkdir(parents=True, exist_ok=True)

    moved_count = 0
    for item in list(dist_dir.iterdir()):
        # Ignore version_dir itself, web assets, and configuration files
        if item.name == version_tag or item.name in ["assets", "app.html", "css", "js", "icon.svg", "icon.png", "icon.ico", "icon.icns", "builder-effective-config.yaml", "builder-debug.yml"]:
            continue
        if item.name.startswith("v") and item.is_dir():
            continue

        item_name_lower = item.name.lower()
        should_move = False

        if target in ["mac", "apple"]:
            if (
                item_name_lower.endswith(".dmg")
                or item_name_lower.endswith(".pkg")
                or item_name_lower.endswith(".app")
                or item_name_lower.startswith("mac")
                or "mac" in item_name_lower
                or item_name_lower == "secretary.app"
                or item_name_lower == ".icon-icns"
                or item_name_lower == "latest-mac.yml"
                or (item_name_lower.endswith(".blockmap") and "mac" in item_name_lower)
            ):
                # Ensure we don't accidentally grab windows files
                if not (item_name_lower.endswith(".exe") or "win" in item_name_lower or "setup" in item_name_lower):
                    should_move = True
        elif target in ["win", "windows"]:
            if (
                item_name_lower.endswith(".exe")
                or item_name_lower.startswith("win")
                or "win" in item_name_lower
                or "win-unpacked" in item_name_lower
                or "setup" in item_name_lower
                or item_name_lower == "latest.yml"
                or (item_name_lower.endswith(".blockmap") and ("win" in item_name_lower or "setup" in item_name_lower))
            ):
                # Ensure we don't accidentally grab mac files
                if not (item_name_lower.endswith(".dmg") or item_name_lower.endswith(".pkg") or item_name_lower.endswith(".app") or "mac" in item_name_lower):
                    should_move = True

        if should_move:
            dest_path = target_dir / item.name
            clean_target_path(dest_path)
            shutil.move(str(item), str(dest_path))
            moved_count += 1

    return target_dir


def _clear_readonly_and_retry(func, path, _exc_info):
    """shutil.rmtree error handler: clear the read-only bit and retry (Windows-safe)."""
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        pass


def _rmtree_robust(target_path: pathlib.Path):
    """shutil.rmtree with a read-only handler, compatible across Python versions."""
    try:
        # Python 3.12+ renamed the handler kwarg to onexc; onerror is deprecated.
        shutil.rmtree(target_path, onexc=_clear_readonly_and_retry)
    except TypeError:
        shutil.rmtree(target_path, onerror=_clear_readonly_and_retry)


def clean_target_path(target_path: pathlib.Path):
    """Robustly clean a directory or file, removing macOS immutable flags & permission locks.

    Cross-platform: on Windows we rely on shutil + read-only clearing (no chmod/rm/chflags
    binaries exist there); on POSIX we keep the chmod/chflags fast path.
    """
    if not target_path.exists():
        return
    is_windows = os.name == "nt"
    if target_path.is_dir():
        try:
            if sys.platform == "darwin":
                # Unlock macOS flags (immutable/uchg/schg) on all contents
                subprocess.run(["chflags", "-R", "nouchg,noschg", str(target_path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if not is_windows:
                # Ensure write/execute permissions so rmtree can traverse & delete files
                subprocess.run(["chmod", "-R", "u+rwX", str(target_path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            _rmtree_robust(target_path)
        except Exception:
            if is_windows:
                shutil.rmtree(target_path, ignore_errors=True)
            else:
                subprocess.run(["rm", "-rf", str(target_path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            if sys.platform == "darwin":
                subprocess.run(["chflags", "nouchg,noschg", str(target_path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            os.chmod(str(target_path), stat.S_IWRITE if is_windows else 0o777)
            target_path.unlink()
        except Exception:
            if is_windows:
                try:
                    os.chmod(str(target_path), stat.S_IWRITE)
                    target_path.unlink()
                except Exception:
                    pass
            else:
                subprocess.run(["rm", "-f", str(target_path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def clean_dist_directory(dist_dir: pathlib.Path):
    """Clean existing dist folder completely before starting compilation."""
    if dist_dir.exists():
        print_step("Cleaning previous build output and temporary files in dist/")
        clean_target_path(dist_dir)
        print_success("Cleaned dist/ directory.")

    # Always ensure dist directory exists fresh
    dist_dir.mkdir(parents=True, exist_ok=True)


def apply_macos_security_remediations(apple_dir: pathlib.Path):
    """
    Apply macOS security remediations to compiled .app bundles:
      1. Force ad-hoc code signature across all nested frameworks (codesign --force --deep --sign -)
      2. Strip Gatekeeper quarantine attributes (xattr -cr)
    """
    if sys.platform != "darwin":
        return

    print_step("Applying macOS Security Remediations (Code Signing & Quarantine Removal)")

    app_bundles = []
    if (apple_dir / "Secretary.app").exists():
        app_bundles.append(apple_dir / "Secretary.app")

    for root, dirs, files in os.walk(apple_dir):
        for d in dirs:
            if d.endswith(".app"):
                app_path = pathlib.Path(root) / d
                if app_path not in app_bundles:
                    app_bundles.append(app_path)

    if not app_bundles:
        # Check if zip exists and unzip temporary app bundle to sign/clean
        zip_files = list(apple_dir.glob("*.zip"))
        for zip_file in zip_files:
            print(f"Extracting {zip_file.name} to apply macOS security remediations...")
            unzip_bin = find_executable("unzip")
            if unzip_bin:
                run_command([unzip_bin, "-q", str(zip_file), "-d", str(apple_dir)])
                if (apple_dir / "Secretary.app").exists():
                    app_bundles.append(apple_dir / "Secretary.app")

    for app in app_bundles:
        print(f"\nProcessing macOS App Bundle: {app.relative_to(WORKSPACE_DIR)}")
        
        # 1. Force ad-hoc code signature
        codesign_cmd = ["codesign", "--force", "--deep", "--sign", "-", str(app)]
        if run_command(codesign_cmd):
            print_success("Applied forced ad-hoc code signature across nested frameworks (codesign --force --deep --sign -)")
        else:
            print_warning("Ad-hoc codesign completed with warnings.")

        # 2. Strip macOS quarantine attributes
        xattr_cmd = ["xattr", "-cr", str(app)]
        if run_command(xattr_cmd):
            print_success("Stripped Gatekeeper quarantine attributes (xattr -cr)")
        else:
            print_warning("xattr removal completed with warnings.")


def cleanup_mounted_dmg_volumes():
    """
    Unmount and detach any lingering Secretary DMG virtual disk volumes from /Volumes.
    When electron-builder creates or packages DMG files, macOS mounts virtual disk images
    which Finder displays as desktop icons on the right side of the screen.
    """
    if sys.platform != "darwin":
        return

    try:
        import re
        mount_points = []
        res = subprocess.run(["hdiutil", "info"], capture_output=True, text=True)
        if res.returncode == 0:
            mount_points.extend(re.findall(r"(/Volumes/Secretary[^\n\r]*)", res.stdout))

        volumes_dir = pathlib.Path("/Volumes")
        if volumes_dir.exists():
            for v in volumes_dir.iterdir():
                if v.is_dir() and "secretary" in v.name.lower():
                    mount_points.append(str(v))

        for mp in set(mount_points):
            subprocess.run(["hdiutil", "detach", mp, "-force"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def get_github_token(token_arg: str = None, token_file_arg: str = None) -> str:
    """
    Retrieve GitHub Personal Access Token (PAT) from CLI args, environment variables,
    token files, or git remote configuration. Never hardcode tokens in the codebase.
    """
    if token_arg:
        return token_arg.strip()

    if token_file_arg:
        token_path = pathlib.Path(token_file_arg).expanduser().resolve()
        if token_path.exists():
            try:
                return token_path.read_text(encoding="utf-8").strip()
            except Exception:
                pass

    # Environment variables
    for env_var in ["GITHUB_TOKEN", "GH_TOKEN", "GITHUB_PAT"]:
        token = os.environ.get(env_var)
        if token and token.strip():
            return token.strip()

    # Workspace secret token files (ignored by git)
    for secret_file in [WORKSPACE_DIR / ".github_token", WORKSPACE_DIR / ".env"]:
        if secret_file.exists():
            try:
                content = secret_file.read_text(encoding="utf-8")
                for line in content.splitlines():
                    line = line.strip()
                    if line.startswith("GITHUB_TOKEN=") or line.startswith("GH_TOKEN="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif not line.startswith("#") and line.startswith("github_pat_"):
                        return line
            except Exception:
                pass

    # User home directory secret token files
    home = pathlib.Path.home()
    for home_secret in [home / ".github_token", home / ".config" / "github_token"]:
        if home_secret.exists():
            try:
                token = home_secret.read_text(encoding="utf-8").strip()
                if token:
                    return token
            except Exception:
                pass

    # Fallback: Extract from git remote origin URL if embedded (https://user:pat@github.com/...)
    try:
        res = subprocess.check_output(["git", "remote", "get-url", "origin"], text=True, cwd=WORKSPACE_DIR).strip()
        import re
        match = re.search(r"https://[^:]+:([^@]+)@github\.com", res)
        if match:
            return match.group(1).strip()
    except Exception:
        pass

    return None


def get_github_repo(repo_arg: str = None) -> str:
    """Determine repository slug (owner/repo)."""
    if repo_arg:
        return repo_arg.strip()

    try:
        res = subprocess.check_output(["git", "remote", "get-url", "origin"], text=True, cwd=WORKSPACE_DIR).strip()
        import re
        match = re.search(r"github\.com[:/]([^/]+/[^/\.]+?)(?:\.git)?$", res)
        if match:
            return match.group(1).strip()
    except Exception:
        pass

    return "ebelt9hf/secretary"


def collect_release_artifacts(version_dir: pathlib.Path) -> list:
    """
    Collect compiled distributable release packages (.dmg, .zip, setup .exe, .pkg, .AppImage, .deb, .rpm)
    from version_dir for GitHub Releases.
    
    Strictly excludes:
      - Unpacked application directories (e.g. win-unpacked, win-arm64-unpacked, mac-arm64, Secretary.app)
      - Raw internal executables (e.g. Secretary.exe, elevate.exe inside unpacked folders)
      - Blockmaps (.blockmap)
      - Metadata and update YAMLs (latest.yml, latest-mac.yml, builder-debug.yml)
      - Web assets and intermediate build files
    """
    artifacts = []
    if not version_dir.exists():
        return artifacts

    allowed_exts = {".dmg", ".zip", ".exe", ".pkg", ".appimage", ".deb", ".rpm"}
    
    # We inspect only top-level files in version_dir and its immediate platform subdirectories (apple, windows, linux)
    search_dirs = [version_dir]
    for sub in version_dir.iterdir():
        if sub.is_dir() and sub.name.lower() in ["apple", "windows", "win", "mac", "darwin", "linux"]:
            search_dirs.append(sub)

    seen_names = set()

    for s_dir in search_dirs:
        for item in s_dir.iterdir():
            # NEVER enter subdirectories (such as win-unpacked/, mac-arm64/, Secretary.app/)
            if not item.is_file():
                continue

            name_lower = item.name.lower()
            ext_lower = item.suffix.lower()

            # Ignore blockmaps, configs, metadata YAMLs, and debug logs
            if name_lower.endswith(".blockmap") or ext_lower in [".yml", ".yaml", ".json", ".txt", ".html", ".map"]:
                continue

            if ext_lower not in allowed_exts:
                continue

            # For .exe: only include standalone setup/installer binaries (e.g. 'Secretary Setup 2.4.0.exe')
            # and strictly exclude raw unpacked application executables (e.g. 'Secretary.exe', 'elevate.exe')
            if ext_lower == ".exe":
                if name_lower in ["secretary.exe", "elevate.exe"]:
                    continue
                if "setup" not in name_lower and "installer" not in name_lower and not any(char.isdigit() for char in item.name):
                    continue

            if item.name not in seen_names:
                seen_names.add(item.name)
                artifacts.append(item)

    artifacts.sort(key=lambda p: p.name)
    return artifacts


def upload_to_github_release(repo_slug: str, tag_name: str, token: str, artifact_files: list, draft: bool = False, prerelease: bool = False) -> bool:
    """
    Upload compiled platform binaries to GitHub Release using GitHub REST API.
    Supports stream/chunk upload and replacing existing release assets.
    """
    import urllib.request
    import urllib.error
    import json

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "Secretary-NPD-Compiler",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    print_step(f"Uploading Release Assets to GitHub ({repo_slug} @ {tag_name})")

    # 1. Query existing release
    release_url = f"https://api.github.com/repos/{repo_slug}/releases/tags/{tag_name}"
    req = urllib.request.Request(release_url, headers=headers, method="GET")

    release_data = None
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status == 200:
                release_data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print_error(f"Failed to query GitHub release: HTTP {e.code} - {e.reason}")
            return False

    # 2. Create release if missing
    if not release_data:
        print(f"Release '{tag_name}' not found on GitHub. Creating new release...")
        create_url = f"https://api.github.com/repos/{repo_slug}/releases"
        payload = json.dumps({
            "tag_name": tag_name,
            "target_commitish": "main",
            "name": f"Secretary {tag_name}",
            "body": f"Release {tag_name} for Secretary Native Desktop Application.",
            "draft": draft,
            "prerelease": prerelease,
        }).encode("utf-8")

        create_headers = dict(headers)
        create_headers["Content-Type"] = "application/json"

        req = urllib.request.Request(create_url, data=payload, headers=create_headers, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                release_data = json.loads(resp.read().decode("utf-8"))
                print_success(f"Created GitHub Release {tag_name} (ID: {release_data.get('id')})")
        except urllib.error.HTTPError as e:
            print_error(f"Failed to create GitHub release: HTTP {e.code} - {e.reason}")
            return False

    release_id = release_data.get("id")
    upload_url_template = release_data.get("upload_url", "")
    upload_base_url = upload_url_template.split("{")[0] if "{" in upload_url_template else f"https://uploads.github.com/repos/{repo_slug}/releases/{release_id}/assets"

    # Map existing assets for overwrite
    existing_assets = {asset["name"]: asset["id"] for asset in release_data.get("assets", [])}

    all_uploaded = True
    for file_path in artifact_files:
        filename = file_path.name
        file_size = file_path.stat().st_size
        size_str = format_bytes(file_size)

        uploaded = False
        max_retries = 3

        for attempt in range(1, max_retries + 1):
            # Refresh asset list on each attempt in case a previous attempt created a partial asset
            try:
                get_rel_req = urllib.request.Request(
                    f"https://api.github.com/repos/{repo_slug}/releases/{release_id}",
                    headers=headers,
                )
                with urllib.request.urlopen(get_rel_req) as gresp:
                    cur_rel_data = json.loads(gresp.read().decode("utf-8"))
                    cur_assets = {a["name"]: a["id"] for a in cur_rel_data.get("assets", [])}
            except Exception:
                cur_assets = existing_assets

            if filename in cur_assets:
                asset_id = cur_assets[filename]
                delete_url = f"https://api.github.com/repos/{repo_slug}/releases/assets/{asset_id}"
                print(f"Asset '{filename}' exists on release. Removing existing asset before upload...")
                del_req = urllib.request.Request(delete_url, headers=headers, method="DELETE")
                try:
                    with urllib.request.urlopen(del_req) as resp:
                        pass
                except Exception as exc:
                    print_warning(f"Failed deleting existing asset '{filename}': {exc}")

            retry_msg = f" (Attempt {attempt}/{max_retries})" if attempt > 1 else ""
            print(f"Uploading {filename} ({size_str}) to GitHub Release {tag_name}{retry_msg}...")

            try:
                import requests
                req_headers = {
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "Secretary-NPD-Compiler",
                    "Content-Type": "application/octet-stream",
                    "X-GitHub-Api-Version": "2022-11-28",
                }
                upload_url = f"{upload_base_url}?name={filename}"
                with open(file_path, "rb") as f:
                    res = requests.post(upload_url, data=f, headers=req_headers, timeout=(30, 300))
                    if res.status_code in [200, 201]:
                        print_success(f"Uploaded '{filename}' ({size_str}) successfully!")
                        uploaded = True
                        break
                    else:
                        print_error(f"Failed uploading '{filename}': HTTP {res.status_code} - {res.text}")
            except Exception as exc:
                print_warning(f"Network error during upload of '{filename}': {exc}")

            if not uploaded and attempt < max_retries:
                time.sleep(3 * attempt)

        if not uploaded:
            all_uploaded = False

    return all_uploaded


def compile_npd(
    targets,
    mode="dist",
    clean=False,
    skip_checks=False,
    use_version_dirs=True,
    upload_github=False,
    github_token=None,
    github_token_file=None,
    github_repo=None,
    draft=False,
    prerelease=False
):
    start_time = time.time()
    version_tag = get_project_version()

    print(f"{Colors.BOLD}{Colors.HEADER}")
    print("=" * 65)
    print("      SECRETARY NPD (Native Package Distribution) COMPILER      ")
    print("=" * 65)
    print(f"{Colors.ENDC}")

    print(f"Application Version: {version_tag}")
    print(f"Target Platforms   : {', '.join(targets)}")
    print(f"Build Mode         : {mode} ({'Distributable Installers' if mode == 'dist' else 'Unpacked Binaries'})")
    print(f"GitHub Upload      : {'Enabled' if upload_github else 'Disabled'}")
    print(f"Workspace Root     : {WORKSPACE_DIR}")

    # 1. Tooling & Environment Verification + iCloud Check
    print_step("1/5 Validating Toolchain Environment")
    npm_bin = find_executable("npm")
    npx_bin = find_executable("npx")

    if not npm_bin or not shutil.which("npm"):
        print_error("npm command-line tool not found. Please install Node.js and NPM.")
        sys.exit(1)

    print_success(f"Node.js & NPM verified: {npm_bin}")
    cleanup_mounted_dmg_volumes()
    check_icloud_sync(WORKSPACE_DIR)
    check_rosetta_environment(targets)
    update_readme_release_links(version_tag)

    node_modules = WORKSPACE_DIR / "node_modules"
    if not node_modules.exists():
        print_warning("node_modules folder missing. Running 'npm install'...")
        if not run_command([npm_bin, "install"]):
            print_error("npm install failed. Stopping compilation.")
            sys.exit(1)
    else:
        print_success("node_modules directory found.")

    # 2. Clean previous build output & temp files in dist/
    dist_dir = WORKSPACE_DIR / "dist"
    if clean:
        clean_dist_directory(dist_dir)
    else:
        dist_dir.mkdir(parents=True, exist_ok=True)

    # 3. Translation Parity Validation
    print_step("2/5 Checking Translation Key Parity across 15 European Languages")
    check_translations_script = SCRIPT_DIR / "check_translations.py"

    if skip_checks:
        print_warning("Skipping translation verification (--skip-checks passed).")
    elif check_translations_script.exists():
        if not run_command([sys.executable, str(check_translations_script)]):
            print_error("Translation verification failed! Ensure 100% key parity before compilation.")
            sys.exit(1)
        print_success("Translation check passed with 100% language parity.")
    else:
        print_warning("check_translations.py script not found. Skipping translation check.")

    # 4. Vite Frontend Production Build
    print_step("3/5 Compiling Frontend Bundle (Vite Build)")
    if not run_command([npm_bin, "run", "build"]):
        print_error("Frontend Vite build failed. Stopping NPD compilation.")
        sys.exit(1)
    print_success("Frontend bundle successfully compiled into dist/")

    # 5. Native Packaging (Apple & Windows) & Immediate Migration into Version Subfolders
    print_step(f"4/5 Packaging Native Desktop Apps for: {', '.join(targets)}")

    build_results = {}

    for target in targets:
        print(f"\n{Colors.BOLD}---> Compiling target: {target.upper()}{Colors.ENDC}")
        
        # Build command flags for electron-builder
        builder_args = [npx_bin or "npx", "electron-builder"]
        if target in ["mac", "apple"]:
            builder_args.append("--mac")
        elif target in ["win", "windows"]:
            builder_args.append("--win")
        else:
            print_error(f"Unknown target platform: {target}")
            continue

        if mode == "package":
            builder_args.append("--dir")

        print(f"Executing Electron Builder for {target.upper()}...")
        success = run_command(builder_args)
        build_results[target] = success

        if success:
            print_success(f"Compilation for {target.upper()} finished successfully!")
            if use_version_dirs:
                saved_path = organize_platform_artifacts(dist_dir, version_tag, target)
                print_success(f"Moved {target.upper()} apps into version directory: {saved_path}")
                if target in ["mac", "apple"]:
                    apply_macos_security_remediations(saved_path)
                    cleanup_mounted_dmg_volumes()
        else:
            print_error(f"Compilation for {target.upper()} encountered errors.")

    # 6. Artifact Inspection & Summary
    print_step("5/5 Compilation Summary & Located Applications")
    elapsed = time.time() - start_time
    all_passed = all(build_results.values()) and len(build_results) > 0

    version_dir = dist_dir / version_tag if use_version_dirs else dist_dir

    if version_dir.exists():
        print(f"\n{Colors.BOLD}Applications Location Overview:{Colors.ENDC}")
        
        if "mac" in targets:
            apple_folder = version_dir / "apple" if use_version_dirs else version_dir
            print(f"\n  🍎 {Colors.BOLD}Apple (macOS) Apps Location:{Colors.ENDC} {apple_folder}")
            if apple_folder.exists() and list(apple_folder.glob("*")):
                for p in apple_folder.glob("*"):
                    size_str = format_bytes(p.stat().st_size) if p.is_file() else "Directory / App Bundle"
                    print(f"     • {p.relative_to(WORKSPACE_DIR)} ({size_str})")
            else:
                print_warning(f"  No Apple applications found in {apple_folder}")

        if "win" in targets:
            win_folder = version_dir / "windows" if use_version_dirs else version_dir
            print(f"\n  🪟 {Colors.BOLD}Windows Apps Location:{Colors.ENDC} {win_folder}")
            if win_folder.exists() and list(win_folder.glob("*")):
                for p in win_folder.glob("*"):
                    size_str = format_bytes(p.stat().st_size) if p.is_file() else "Directory / Unpacked Executable"
                    print(f"     • {p.relative_to(WORKSPACE_DIR)} ({size_str})")
            else:
                print_warning(f"  No Windows applications found in {win_folder}")

    # 7. Upload to GitHub Release (If requested)
    if all_passed and upload_github:
        token = get_github_token(github_token, github_token_file)
        if not token:
            print_error("GitHub Personal Access Token (PAT) not found.")
            print("  To upload releases to GitHub, provide a token using one of:")
            print("    • Environment variable: export GITHUB_TOKEN=your_pat")
            print("    • CLI argument: --github-token your_pat")
            print("    • Token file argument: --github-token-file /path/to/token")
            print("    • Secret file: ~/.github_token or .github_token (ignored by git)")
            sys.exit(1)

        repo_slug = get_github_repo(github_repo)
        release_artifacts = collect_release_artifacts(version_dir)
        if not release_artifacts:
            print_warning("No release artifacts (.dmg, .zip, .exe, .pkg) found to upload.")
        else:
            upload_success = upload_to_github_release(
                repo_slug=repo_slug,
                tag_name=version_tag,
                token=token,
                artifact_files=release_artifacts,
                draft=draft,
                prerelease=prerelease
            )
            if upload_success:
                print_success(f"All release binaries uploaded to GitHub Release {version_tag}!")
            else:
                print_warning("Some release assets failed to upload to GitHub.")

    print(f"\n{'=' * 65}")
    if all_passed:
        print(f"{Colors.BOLD}{Colors.OKGREEN}🎉 NPD COMPILATION COMPLETED SUCCESSFULLY in {elapsed:.2f}s!{Colors.ENDC}")
        print(f"Release version binaries are stored in: {version_dir}")
        if "mac" in targets:
            print("\n💡 macOS Security Launch Note:")
            print("  If macOS Gatekeeper prevents opening Secretary.app, run:")
            print("    xattr -cr /Applications/Secretary.app")
            print("    codesign --force --deep --sign - /Applications/Secretary.app")
    else:
        print(f"{Colors.BOLD}{Colors.FAIL}❌ NPD COMPILATION COMPLETED WITH ERRORS in {elapsed:.2f}s{Colors.ENDC}")
        for t, status in build_results.items():
            status_text = f"{Colors.OKGREEN}PASSED{Colors.ENDC}" if status else f"{Colors.FAIL}FAILED{Colors.ENDC}"
            print(f"  • {t.upper()}: {status_text}")
        sys.exit(1)


def parse_targets(target_arg: str):
    """Normalize target arguments into a canonical list ['mac', 'win']."""
    raw_list = [t.strip().lower() for t in target_arg.split(",") if t.strip()]
    normalized = set()
    
    for item in raw_list:
        if item in ["all", "both"]:
            normalized.add("mac")
            normalized.add("win")
        elif item in ["apple", "mac", "macos", "darwin"]:
            normalized.add("mac")
        elif item in ["windows", "win", "win32"]:
            normalized.add("win")
        else:
            print_warning(f"Unrecognized target: '{item}'. Defaulting to 'mac' and 'win'.")
            normalized.add("mac")
            normalized.add("win")
            
    return sorted(list(normalized))


def main():
    parser = argparse.ArgumentParser(
        description="Compile NPD (Native Package Distribution) for Apple (macOS) and Windows."
    )
    parser.add_argument(
        "-t", "--target",
        default="all",
        help="Target platform(s): 'all', 'apple' (macOS), 'windows' (win), or comma-separated 'apple,windows'"
    )
    parser.add_argument(
        "-m", "--mode",
        choices=["dist", "package"],
        default="dist",
        help="'dist' for standalone installers/distributable binaries, 'package' for unpacked executable directories."
    )
    parser.add_argument(
        "-c", "--clean",
        action="store_true",
        help="Clean the dist/ output folder prior to building."
    )
    parser.add_argument(
        "--skip-checks",
        action="store_true",
        help="Skip translation verification checks before building."
    )
    parser.add_argument(
        "--no-version-dir",
        action="store_true",
        help="Disable organizing outputs into version subdirectories (e.g. dist/v1.0.0/)."
    )
    parser.add_argument(
        "-u", "--upload-github", "--upload",
        action="store_true",
        dest="upload_github",
        help="Upload compiled release binaries (.dmg, .zip, .exe, .pkg) to GitHub Releases."
    )
    parser.add_argument(
        "--github-token",
        default=None,
        help="GitHub Personal Access Token (PAT). If omitted, loaded from GITHUB_TOKEN env var, secret file, or git remote."
    )
    parser.add_argument(
        "--github-token-file",
        default=None,
        help="Path to file containing GitHub Personal Access Token (PAT)."
    )
    parser.add_argument(
        "--github-repo",
        default=None,
        help="GitHub repository slug (e.g. 'ebelt9hf/secretary'). Auto-detected from git remote origin if omitted."
    )
    parser.add_argument(
        "--draft",
        action="store_true",
        help="Mark the GitHub release as a draft."
    )
    parser.add_argument(
        "--prerelease",
        action="store_true",
        help="Mark the GitHub release as a pre-release."
    )

    args = parser.parse_args()
    targets = parse_targets(args.target)

    compile_npd(
        targets=targets,
        mode=args.mode,
        clean=args.clean,
        skip_checks=args.skip_checks,
        use_version_dirs=not args.no_version_dir,
        upload_github=args.upload_github,
        github_token=args.github_token,
        github_token_file=args.github_token_file,
        github_repo=args.github_repo,
        draft=args.draft,
        prerelease=args.prerelease
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print_warning("\nCompilation interrupted by user (Ctrl+C). Exiting.")
        sys.exit(130)

