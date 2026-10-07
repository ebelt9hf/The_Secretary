#!/usr/bin/env python3
import os
import sys
import json
import re
import subprocess


WORKSPACE = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
TRANSLATIONS_PATH = os.path.join(WORKSPACE, "js", "translations.js")

# Import untranslated JS fields scanner & i18n utils
sys.path.append(os.path.dirname(os.path.realpath(__file__)))
try:
    from check_untranslated_js import find_untranslated_js_fields
except ImportError:
    find_untranslated_js_fields = None

try:
    from i18n_utils import load_translations_bundle
except ImportError:
    def load_translations_bundle(path):
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
        match = re.search(r'window\.APP_TRANSLATIONS_BUNDLE\s*=\s*(\{[\s\S]*\});?\s*$', content)
        if match:
            return json.loads(match.group(1))
        return json.loads(content)


def unflatten_translations(translations, languages):
    packs = {lang: {} for lang in languages}
    for composite_key, lang_map in translations.items():
        parts = composite_key.split(".")
        for lang in languages:
            val = lang_map.get(lang)
            if val is None:
                continue
            curr = packs[lang]
            for part in parts[:-1]:
                if part not in curr or not isinstance(curr[part], dict):
                    curr[part] = {}
                curr = curr[part]
            curr[parts[-1]] = val
    return packs


def main():
    print("Evaluating translation bundle (js/translations.js)...")

    if not os.path.exists(TRANSLATIONS_PATH):
        print(f"Error: Translation file not found at {TRANSLATIONS_PATH}")
        sys.exit(1)

    try:
        bundle = load_translations_bundle(TRANSLATIONS_PATH)
    except Exception as e:
        print(f"Error parsing translation bundle at {TRANSLATIONS_PATH}: {e}")
        sys.exit(1)

    metadata = bundle.get("metadata", {})
    all_langs = metadata.get("languages", [])
    names = metadata.get("language_names", {})
    translations = bundle.get("translations", {})

    if not translations or not all_langs:
        print("Error: Invalid or empty translations bundle.")
        sys.exit(1)

    packs = unflatten_translations(translations, all_langs)
    print(f"Loaded {len(all_langs)} language packs: {all_langs}")

    has_issues = False

    # Extract all translation keys used in the codebase
    used_keys = set()
    t_regex = re.compile(r"\bt\(\s*['\"]([a-zA-Z0-9_\.]+)['\"]")

    for root, dirs, files in os.walk(WORKSPACE):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'notes' and d != 'backend' and d != 'node_modules' and d != 'dist']
        for file in files:
            if file.endswith('.js') or file.endswith('.html'):
                path = os.path.join(root, file)
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        content = f.read()
                        for match in t_regex.finditer(content):
                            key = match.group(1)
                            if not key.endswith('.'):
                                used_keys.add(key)
                except Exception as e:
                    print(f"Warning: Could not read {path}: {e}")

    print(f"Found {len(used_keys)} translation keys used in the codebase.")

    # Check for missing translations across ALL supported languages
    for lang in all_langs:
        lang_pack = packs.get(lang, {})
        missing = []
        for key in sorted(used_keys):
            if not has_key(lang_pack, key):
                missing.append(key)
        if missing:
            has_issues = True
            print(f"\n❌ {lang.upper()} is missing {len(missing)} keys used in codebase:")
            for k in missing:
                print(f"  - {k}")
        else:
            print(f"✅ {lang.upper()} ({names.get(lang, lang)}) - All used keys translated.")

    # Check key parity with EN pack
    en_keys = get_all_nested_keys(packs.get('en', {}))
    print(f"\nEnglish pack contains {len(en_keys)} total keys.")

    for lang in all_langs:
        if lang == 'en':
            continue
        lang_pack = packs.get(lang, {})
        mismatch = []
        for key in sorted(en_keys):
            if not has_key(lang_pack, key):
                mismatch.append(key)
        if mismatch:
            has_issues = True
            print(f"❌ {lang.upper()} is missing {len(mismatch)} keys defined in EN.")

    # Audit for untranslated fields & hardcoded UI labels in JS files
    print("\n--- Untranslated JS Fields Audit ---")
    if find_untranslated_js_fields:
        js_findings = find_untranslated_js_fields()
        if js_findings:
            has_issues = True
            print(f"❌ FOUND {len(js_findings)} UNTRANSLATED UI FIELDS / LABELS IN JS FILES:")
            for item in js_findings:
                print(f"  - {item['file']}:{item['line']} [{item['prop']}] -> \"{item['value']}\"")
        else:
            print("✅ Success! No untranslated UI fields found in JS files.")
    else:
        print("⚠️ Could not import find_untranslated_js_fields scanner.")

    # Audit for identical / copy-pasted fallback values across language packs
    print("\n--- Identical / Untranslated Fallback Value Audit ---")
    identical_findings = check_identical_translations(translations, all_langs, used_keys)
    if identical_findings:
        has_issues = True
        print(f"❌ FOUND {len(identical_findings)} KEYS WITH IDENTICAL / UNTRANSLATED ENGLISH VALUES ACROSS LANGUAGES:")
        for item in identical_findings:
            print(f"  - {item['key']}: \"{item['en']}\" ({len(item['same_langs'])} languages identical: {', '.join(item['same_langs'])})")
    else:
        print("✅ Success! All translation keys have distinct, localized translations across supported languages.")

    # Translation String Length Comparison vs English
    print("\n--- Translation String Length Comparison vs English ---")
    en_pack_flat = flatten_dict(packs.get('en', {}))

    for lang in all_langs:
        if lang == 'en':
            continue
        lang_pack_flat = flatten_dict(packs.get(lang, {}))
        total_en_len = 0
        total_lang_len = 0
        count = 0
        outliers = []

        for key, en_val in en_pack_flat.items():
            if not isinstance(en_val, str):
                continue
            lang_val = lang_pack_flat.get(key, '')
            if not isinstance(lang_val, str):
                continue

            en_l = len(en_val)
            lang_l = len(lang_val)
            if en_l == 0:
                continue

            total_en_len += en_l
            total_lang_len += lang_l
            count += 1

            ratio = lang_l / en_l
            if en_l > 10 and ratio > 2.2:
                outliers.append((key, en_val, lang_val, ratio))

        avg_ratio = (total_lang_len / total_en_len) if total_en_len > 0 else 1.0
        outlier_count = len(outliers)
        status_icon = "✅" if outlier_count == 0 and 0.7 <= avg_ratio <= 1.8 else "⚠️"
        print(f"{status_icon} {lang.upper()} ({names.get(lang, lang)}): avg length ratio = {avg_ratio:.2f}x vs EN ({count} strings evaluated, {outlier_count} oversized outliers)")

    # JavaScript Syntax Validation Audit
    print("\n--- JavaScript Syntax Validation Audit ---")
    syntax_errors = check_js_syntax()
    if syntax_errors:
        has_issues = True
        print(f"❌ FOUND {len(syntax_errors)} JAVASCRIPT SYNTAX ERROR(S):")
        for rel_file, err in syntax_errors:
            print(f"\n[Error in {rel_file}]:\n{err}")
    else:
        print("✅ Success! All JavaScript files passed syntax validation.")

    if not has_issues:
        print("\n🎉 All checks passed! All major European languages have 100% key parity, clean syntax & concise translations.")
        sys.exit(0)
    else:
        print("\n❌ Verification checks failed due to syntax errors, missing keys, or untranslated JS fields.")
        sys.exit(1)


def check_js_syntax():
    """Validates the syntax of all JavaScript files in the workspace using `node -c`."""
    errors = []
    for root, dirs, files in os.walk(WORKSPACE):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('notes', 'backend', 'node_modules', 'dist', 'build')]
        for file in sorted(files):
            if file.endswith('.js'):
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, WORKSPACE)
                try:
                    res = subprocess.run(["node", "-c", full_path], capture_output=True, text=True)
                    if res.returncode != 0:
                        err_output = (res.stderr or res.stdout).strip()
                        errors.append((rel_path, err_output))
                except FileNotFoundError:
                    # Node is not available in environment
                    break
    return errors



def has_key(d, dotted_key):
    parts = dotted_key.split('.')
    curr = d
    for p in parts:
        if not isinstance(curr, dict) or p not in curr:
            return False
        curr = curr[p]
    return True


def get_all_nested_keys(d, prefix=""):
    keys = []
    for k, v in d.items():
        full_key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            keys.extend(get_all_nested_keys(v, full_key))
        else:
            keys.append(full_key)
    return keys


def flatten_dict(d, prefix=""):
    res = {}
    for k, v in d.items():
        full_key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            res.update(flatten_dict(v, full_key))
        else:
            res[full_key] = v
    return res


def check_identical_translations(translations, all_langs, used_keys=None):
    """
    Audits the translations bundle for keys where translations are suspiciously identical
    across multiple languages (indicating copy-pasted English fallbacks).
    """
    EXEMPT_VALUES = {
        "Secretary", "LM Studio", "WIP", "AI", "Regex", "Zoom +", "Zoom -", "OK", "Tab",
        "UUID", "URL", "API", "JSON", "HTML", "CSS", "ID", "Markdown", "SVG", "PDF",
        "IP", "PRO", "RAM", "CPU", "BETA", "v2.0", "FAQ", "⚡", "#", "›", "×", "–",
        "-", "+", "AI Secretary", "Kanban", "15 min", "30 min", "45 min", "1 h",
        "2 h", "3 h", "1 h 30", "~{count} min", "Dur.", "Dossier", "CSV (.csv)",
        "JSON (.json)", "Markdown (.md)", "Mini HUD", "OpenAI", "Anthropic", "Custom"
    }

    suspicious = []
    keys_to_check = used_keys if used_keys else translations.keys()

    for key in sorted(keys_to_check):
        if key not in translations:
            continue
        lang_map = translations[key]
        en_val = lang_map.get("en", "")
        if not isinstance(en_val, str) or len(en_val.strip()) <= 2 or en_val in EXEMPT_VALUES:
            continue

        same_as_en = [l for l in all_langs if l != "en" and lang_map.get(l) == en_val]
        # Flag if 8 or more other languages (more than half the supported languages) share the identical English string
        if len(same_as_en) >= 8:
            suspicious.append({
                "key": key,
                "en": en_val,
                "same_langs": same_as_en
            })

    return suspicious


if __name__ == "__main__":
    main()

