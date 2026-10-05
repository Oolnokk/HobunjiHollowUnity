from pathlib import Path
p = Path('docs/js/character-studio-pattern-integration.js')
s = p.read_text()
old = """      modeSelect.onchange = () => render(); // Changing preview mode does not destroy either authored treatment; Edit/Clear operate on the selected mode.
      row.querySelector('.cs-pattern-edit').onclick = () => openPopup(slot, modeSelect.value);
      row.querySelector('.cs-pattern-clear').onclick = () => clearMode(slot, modeSelect.value);"""
new = """      const clearButton = row.querySelector('.cs-pattern-clear');
      modeSelect.onchange = () => { // Mode selection is local UI state until Edit/Apply; do not snap back to the currently authored treatment.
        const pair = patternPairForSlot(work.clothingPatternPolicy, slot, modeSelect.value);
        row.querySelector('.cs-pattern-state').textContent = stateLabel(pair);
        clearButton.disabled = !(pair.primary || pair.overpass);
      };
      row.querySelector('.cs-pattern-edit').onclick = () => openPopup(slot, modeSelect.value);
      clearButton.onclick = () => clearMode(slot, modeSelect.value);"""
if old not in s:
    raise SystemExit('pattern mode selector anchor missing')
p.write_text(s.replace(old, new, 1))

t = Path('scripts/test-character-studio-pattern-integration.js')
ts = t.read_text()
needle = "assert.match(integration, /forcedOverpassBySlot/, 'integration preserves forced NPC overpasses');\n"
add = needle + "assert.match(integration, /modeSelect\\.onchange = \\(\\) => \\{/, 'mode selector stays on the user-selected weaving or verdigris mode');\n"
if needle not in ts:
    raise SystemExit('test insertion anchor missing')
t.write_text(ts.replace(needle, add, 1))
