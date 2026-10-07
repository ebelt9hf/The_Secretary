#!/usr/bin/env python3
"""
Untranslated JS Fields Audit Tool for Secretary.

Scans JavaScript files in `js/` for hardcoded UI labels, titles, placeholders,
tooltips, button text, alert/confirm/prompt messages, and DOM textContent/innerText assignments
that should be internationalized with `t('key')`.
"""

import os
import sys
import re

WORKSPACE = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
JS_DIR = os.path.join(WORKSPACE, "js")

# Regex to detect UI property assignments, DOM assignments, setAttribute, and modal/toast calls with literal strings
PROP_PATTERN = re.compile(
    r"""(?:(?:\b(label|title|placeholder|tooltip|heading|buttonText|emptyText|headerText|statusText|ariaLabel|ariaDescription)\s*:\s*)|(?:\.(title|placeholder|textContent|innerText|ariaLabel)\s*=\s*)|(?:setAttribute\s*\(\s*['\"](title|placeholder|aria-label|aria-description)['\"]\s*,\s*)|(?:\b(alert|confirm|prompt|showToast|showNotification)\s*\(\s*))\s*['\"]([^'\"]{3,})['\"]""",
    re.IGNORECASE
)

# Regex for helper functions taking labels/titles (e.g., createKpiCard('icon', 'Title', ...), createStatusPill('status', 'Label'))
MULTI_ARG_HELPER = re.compile(
    r"""\b(createKpiCard|createKpiChip|createStatusPill|createBadge)\s*\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]{3,})['"]"""
)

# Values that are non-UI keywords, CSS properties, icon symbols, technical identifiers, or search syntax chips
EXCLUDED_VALUES = {
    'none', 'block', 'flex', 'grid', 'inline', 'inline-block', 'hidden', 'visible', 'absolute', 'relative',
    'fixed', 'sticky', 'auto', 'bold', 'italic', 'normal', 'center', 'left', 'right', 'top', 'bottom',
    'click', 'change', 'input', 'keydown', 'keyup', 'mousedown', 'mouseup', 'mouseover', 'mouseout',
    'scroll', 'resize', 'submit', 'blur', 'focus', 'contextmenu', 'dblclick', 'dragstart', 'drop',
    'sans équipe', 'NOTE', 'General', 'true', 'false', 'null', 'undefined'
}


def is_hardcoded_ui_label(prop, text):
    text_clean = text.strip()
    if not text_clean:
        return False
    # If it uses t('...') or t ("..."), it is translated
    if 't(' in text_clean or 't (' in text_clean:
        return False
    # Exclude string interpolation or variables
    if '${' in text_clean:
        return False
    # Exclude search syntax tokens (starting with ! or { or containing query tokens like !decision, !todo, !done)
    if text_clean.startswith('!') or text_clean.startswith('{') or '!decision' in text_clean or '!todo' in text_clean or '!done' in text_clean:
        return False
    # Exclude CSS / hex / hsl / var / pixels / rem / em
    if text_clean.startswith('var(') or text_clean.startswith('hsl(') or text_clean.startswith('#') or text_clean.endswith('px') or text_clean.endswith('rem') or text_clean.endswith('em'):
        return False
    # Exclude HTML tags, element IDs/classes, URLs, modal IDs (starting with modal-)
    if text_clean.startswith('<') or text_clean.startswith('#') or text_clean.startswith('.') or text_clean.startswith('http') or text_clean.startswith('modal-'):
        return False
    if text_clean in EXCLUDED_VALUES:
        return False
    # Exclude identifiers like 'app-notes', 'group', 'week' (all lowercase, no spaces, no punctuation)
    if re.match(r'^[a-z0-9_-]+$', text_clean) and not any(c in text_clean for c in ' :-,./'):
        return False
    # Must contain at least one letter
    if not re.search(r'[a-zA-ZáàâäéèêëíìîïóòôöúùûüçñÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÇÑ]', text_clean):
        return False
    return True


def find_untranslated_js_fields():
    findings = []
    if not os.path.exists(JS_DIR):
        return findings

    for filename in sorted(os.listdir(JS_DIR)):
        if not filename.endswith('.js') or filename in ('translations.js', 'app-i18n.js', 'firebase-bundle.js', 'firebase-config.js'):
            continue
        path = os.path.join(JS_DIR, filename)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        except Exception as e:
            print(f"Warning: Could not read {path}: {e}")
            continue

        for idx, line in enumerate(lines, 1):
            stripped = line.strip()
            # Ignore full-line comments
            if stripped.startswith('//') or stripped.startswith('/*') or stripped.startswith('*'):
                continue
            for m in PROP_PATTERN.finditer(line):
                groups = m.groups()
                val = groups[-1]
                prop = next((g for g in groups[:-1] if g is not None), "field")
                if is_hardcoded_ui_label(prop, val):
                    findings.append({
                        'file': filename,
                        'line': idx,
                        'prop': prop,
                        'value': val,
                        'code': stripped
                    })
            for m in MULTI_ARG_HELPER.finditer(line):
                fn_name, val = m.group(1), m.group(2)
                if is_hardcoded_ui_label(fn_name, val):
                    findings.append({
                        'file': filename,
                        'line': idx,
                        'prop': fn_name,
                        'value': val,
                        'code': stripped
                    })

    return findings


def main():
    print("Scanning JS files for untranslated fields and hardcoded UI labels...")
    findings = find_untranslated_js_fields()
    if findings:
        print(f"\n⚠️  FOUND {len(findings)} UNTRANSLATED UI FIELDS IN JS FILES:")
        print("=" * 60)
        for item in findings:
            print(f"  - {item['file']}:{item['line']} [{item['prop']}] -> \"{item['value']}\"")
        print("=" * 60)
        sys.exit(1)
    else:
        print("✅ Success! No untranslated UI fields found in JS files.")
        sys.exit(0)


if __name__ == "__main__":
    main()
