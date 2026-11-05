#!/usr/bin/env python3
"""
Auditing script to check that all interactive form elements (<select>, <input>, <textarea>)
have explicit 'id' or 'name' attributes to comply with accessibility standards and prevent
browser console warnings.
"""

import sys
import os
import glob
import re

def check_form_fields(base_dir=None):
    if base_dir is None:
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    
    files_to_check = []
    patterns = [
        os.path.join(base_dir, '*.html'),
        os.path.join(base_dir, 'templates', '*.html'),
        os.path.join(base_dir, 'js', '*.js'),
    ]
    for pat in patterns:
        files_to_check.extend(glob.glob(pat))
    
    ignored_keywords = ('vendor', 'firebase', 'app-prompts.js', 'app-state.js')
    violations = []

    pattern = re.compile(r'<(select|input|textarea)\b([^>]*?)>', re.IGNORECASE | re.DOTALL)

    for filepath in sorted(files_to_check):
        if any(ign in filepath for ign in ignored_keywords):
            continue
        
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        # Strip multi-line and single-line comments in JS/HTML
        cleaned = re.sub(r'/\*[\s\S]*?\*/', '', content)
        cleaned = re.sub(r'//.*$', '', cleaned, flags=re.MULTILINE)
        cleaned = re.sub(r'<!--[\s\S]*?-->', '', cleaned)

        for m in pattern.finditer(cleaned):
            tag = m.group(1).lower()
            attrs = m.group(2)

            has_id = bool(re.search(r'\bid\s*=', attrs, re.IGNORECASE))
            has_name = bool(re.search(r'\bname\s*=', attrs, re.IGNORECASE))

            if not has_id and not has_name:
                line_no = cleaned[:m.start()].count('\n') + 1
                snippet = m.group(0).replace('\n', ' ')
                if len(snippet) > 100:
                    snippet = snippet[:100] + '...'
                rel_path = os.path.relpath(filepath, base_dir)
                violations.append((rel_path, line_no, tag, snippet))

    return violations

def main():
    violations = check_form_fields()
    if violations:
        print(f"❌ Found {len(violations)} form element(s) missing both 'id' and 'name':")
        for filepath, line_no, tag, snippet in violations:
            print(f"  - {filepath}:{line_no} <{tag}>: {snippet}")
        sys.exit(1)
    else:
        print("✅ Success! All <select>, <input>, and <textarea> elements have 'id' or 'name' attributes.")
        sys.exit(0)

if __name__ == '__main__':
    main()
