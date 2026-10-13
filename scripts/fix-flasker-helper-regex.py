#!/usr/bin/env python3
from pathlib import Path

path = Path(__file__).with_name('apply-flasker-bandit-integration.py')
text = path.read_text()

old_regex = r'''    r"\n  const throwFlask = \{.*?\n  \};\n(?=\n  // Shared temporary throw animation)",'''
new_regex = r'''    r"\n  const throwFlask = \{.*?\n  \};[^\n]*\n(?=\n  // Shared temporary throw animation)",'''
if old_regex not in text:
    raise SystemExit('expected throwFlask regex was not found in integration helper')
text = text.replace(old_regex, new_regex, 1)

old_anchor = '''    "  // Fishing spears use the same arm/body path as the ordinary spinning\\n",'''
new_anchor = '''    "  // Fishing spears use the same arm/body path, but the weapon's in-plane\\n",'''
if old_anchor not in text:
    raise SystemExit('expected throwFlask alias anchor was not found in integration helper')
text = text.replace(old_anchor, new_anchor, 1)

old_replacement = '''    "  const throwFlask = weaponThrowSpin; // Throwing-flask necks are handles: every flask throw intentionally reuses the exact hatchet/dagger/Kylie spin throw.\\n\\n"
    "  // Fishing spears use the same arm/body path as the ordinary spinning\\n",'''
new_replacement = '''    "  const throwFlask = weaponThrowSpin; // Throwing-flask necks are handles: every flask throw intentionally reuses the exact hatchet/dagger/Kylie spin throw.\\n\\n"
    "  // Fishing spears use the same arm/body path, but the weapon's in-plane\\n",'''
if old_replacement not in text:
    raise SystemExit('expected throwFlask alias replacement was not found in integration helper')
text = text.replace(old_replacement, new_replacement, 1)

path.write_text(text)
print('Aligned throwFlask removal and alias insertion with the current shared animation source.')
