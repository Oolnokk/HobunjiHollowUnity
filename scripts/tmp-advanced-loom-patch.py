from pathlib import Path
import json
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, found {count}')
    return text.replace(old, new, 1)


def replace_between(text, start_anchor, end_anchor, replacement, label, search_start=0):
    start = text.find(start_anchor, search_start)
    if start < 0:
        raise RuntimeError(f'{label}: start anchor missing')
    end = text.find(end_anchor, start)
    if end < 0:
        raise RuntimeError(f'{label}: end anchor missing')
    return text[:start] + replacement + text[end:]


# game.js: keep the legacy loom key/save shape but rename/resize it; add a new
# Advanced Loom item whose blueprint metadata is carried into the generic
# blueprint catalog and whose interaction tells the shared loom UI its tier.
game_path = 'docs/game.js'
game = read(game_path)
old_loom = "        loom:          { itemKey: 'loomFurniture',          icon: '🧶', name: 'Small Loom',           modelFile: 'loom_small.glb',               price: 45, fw: 1, fd: 2, color: 0x8a6a3a, area: 'interior', desc: 'A small loom for weaving cloth.' },"
new_loom = "        loom:          { itemKey: 'loomFurniture',          icon: '🧶', name: 'Simple Loom',          modelFile: 'loom_small.glb',               price: 45, fw: 1, fd: 1, color: 0x8a6a3a, area: 'interior', desc: 'A compact loom for ordinary single-pattern weaving.' },\n        advancedLoom:  { itemKey: 'advancedLoomFurniture',  icon: '🧶', name: 'Advanced Loom',        modelFile: 'loom_small.glb',               price: 72, fw: 1, fd: 2, color: 0x76502f, area: 'interior', desc: 'A full-sized loom that can weave a second overpass pattern.', moteOnly: true, masteryUnlockId: 'advancedLoomBlueprint' },"
game = replace_once(game, old_loom, new_loom, 'decorative loom defs')

catalog_start = game.index('      const FURNITURE_BLUEPRINT_CATALOG = [')
catalog_end = game.index('      ];', catalog_start)
catalog = game[catalog_start:catalog_end]
catalog = replace_once(
    catalog,
    "        desc: item.desc,\n",
    "        desc: item.desc,\n        moteOnly: !!item.moteOnly, // Used to keep Mote-only mastery blueprints out of the gold Carpenter inventory.\n        masteryUnlockId: item.masteryUnlockId || null, // Used by CraftingPanel to treat the world-scoped mastery purchase as permanent blueprint ownership.\n",
    'blueprint mastery metadata',
)
game = game[:catalog_start] + catalog + game[catalog_end:]

game = replace_once(
    game,
    "        if (o.key === 'loom') return makeLoomInteractable(); // Player-placed house looms use the same core reticle/action path as beds and hearths.",
    "        if (o.key === 'loom') return makeLoomInteractable(false); // Simple Loom keeps the ordinary one-pattern weaving rules.\n        if (o.key === 'advancedLoom') return makeLoomInteractable(true); // Advanced Loom opts the shared panel into overpass authoring and doubled overpass costs.",
    'player loom interactions',
)
game = replace_once(game, '      function makeLoomInteractable() {', '      function makeLoomInteractable(advanced = false) {', 'loom interactable signature')
game = replace_once(
    game,
    "            const opened = openLoom(); // Synchronous: the panel creates immediately; its sprite preview continues asynchronously inside the module.",
    "            const opened = openLoom(null, { advanced }); // Synchronous: the physical loom decides whether overpass controls/cost rules are available; preview work remains asynchronous inside the module.",
    'loom open capability',
)
game = replace_once(
    game,
    "        loomFurniture: () => makeLoomInteractable(), // Map-authored looms share the same core interaction object as player-placed house looms.",
    "        loomFurniture: () => makeLoomInteractable(false), // Map-authored Simple Looms share the same ordinary interaction object as player-placed ones.\n        advancedLoomFurniture: () => makeLoomInteractable(true), // Map-authored Advanced Looms opt into overpass weaving through the same interaction path.",
    'building loom interactions',
)
write(game_path, game)

# Clothing weaving: slot 2 of the already-supported pattern stack becomes a
# player-authored Advanced Loom overpass. It shares Dye C with the base motif;
# only wool consumption changes, exactly as requested.
weave_path = 'docs/js/clothing-weaving-system.js'
w = read(weave_path)
w = replace_once(w, '  const VERSION = 2;', '  const VERSION = 3;', 'weaving version')
w = replace_once(
    w,
    "  function weavingHasAnyPattern(weaving) {\n    if (!weaving) return false;\n    if (forcedOverpassPatternForWeaving(weaving)) return true; // Lets an NPC policy put its mark onto default/unpatterned clothing without fabricating a permanent slot-1 pattern.\n    if (weaving.layers) return Object.keys(weaving.layers).some(role => weavingPatternsForRole(weaving, role).length > 0);\n    return weavingPatternsForRole(weaving, null).length > 0;\n  }\n",
    "  function weavingHasAnyPattern(weaving) {\n    if (!weaving) return false;\n    if (forcedOverpassPatternForWeaving(weaving)) return true; // Lets an NPC policy put its mark onto default/unpatterned clothing without fabricating a permanent slot-1 pattern.\n    if (weaving.layers) return Object.keys(weaving.layers).some(role => weavingPatternsForRole(weaving, role).length > 0);\n    return weavingPatternsForRole(weaving, null).length > 0;\n  }\n\n  function weavingHasOverpass(weaving) {\n    if (!weaving) return false;\n    if (weaving.layers) return Object.values(weaving.layers).some(entry => normalizePatternStack(entry?.patterns || []).length > 1);\n    return normalizePatternStack(weaving.patterns || []).length > 1; // Used by Advanced Loom cost/gating logic without treating NPC-only forced overpasses as player-authored second patterns.\n  }\n",
    'overpass detector',
)
w = replace_once(w, '  function openLoom(reweaveUid = null) {', "  function openLoom(reweaveUid = null, options = {}) {\n    const advanced = !!options?.advanced; // Used to expose the second pattern slot only when the interaction came from an Advanced Loom.", 'open loom capability')
w = replace_once(
    w,
    "    const reweaveItems = (gearInventory()?.clothingItems || []).filter(item => item && isCraftableCloth(item)); // Permanent Gear garments are the only reweave targets; Pack clothing remains world-scoped and untouched.\n    const reweaveItem = reweaveUid ? reweaveItems.find(item => item.uid === reweaveUid) || null : null;",
    "    const allReweaveItems = (gearInventory()?.clothingItems || []).filter(item => item && isCraftableCloth(item)); // Permanent Gear garments are the only reweave targets; Pack clothing remains world-scoped and untouched.\n    const requestedReweaveItem = reweaveUid ? allReweaveItems.find(item => item.uid === reweaveUid) || null : null; // Used to reject a direct attempt to edit an overpass garment on the Simple Loom without silently deleting slot 2.\n    if (requestedReweaveItem && weavingHasOverpass(requestedReweaveItem.weaving) && !advanced) {\n      equipmentDeps?.showToast?.('An Advanced Loom is required to reweave a garment with an overpass pattern.', false);\n      return false;\n    }\n    const reweaveItems = allReweaveItems.filter(item => advanced || !weavingHasOverpass(item.weaving)); // Simple Loom never offers a garment whose second saved pattern it cannot edit.\n    const reweaveItem = reweaveUid ? reweaveItems.find(item => item.uid === reweaveUid) || null : null;",
    'reweave advanced gating',
)
w = replace_once(
    w,
    "      layerPatterns: {}, // role -> {pattern, patternId, patternLabel, swapPatternColors}. Sticky across blueprint switches; the swap flag belongs to this garment layer, not the reusable pattern.\n",
    "      layerPatterns: {}, // role -> {pattern, patternId, patternLabel, swapPatternColors}. Sticky across blueprint switches; the swap flag belongs to this garment layer, not the reusable pattern.\n      overpassPatterns: {}, // role -> {pattern, patternId, patternLabel}. Used only by Advanced Looms as visual pattern stack slot 2.\n",
    'overpass state',
)

state_fn = w.index('    function weavingFromState() {')
loop_start = w.index('      for (const { role, key } of patternRoles()) {', state_fn)
loop_end = w.index('      const weaving = Object.keys(layers).length', loop_start)
new_state_loop = '''      for (const { role, key } of patternRoles()) {
        const entry = state.layerPatterns[key];
        if (!entry) continue;
        // Keep the library id as provenance, but snapshot the full pattern
        // into the literal garment so deleting/renaming the library source
        // cannot mutate an already-crafted or reweaved item.
        const pattern = entry.pattern || (entry.patternId ? window.PatternLibrary?.getById?.(entry.patternId) : null);
        if (!pattern) continue;
        const overpassEntry = advanced ? state.overpassPatterns[key] : null; // Advanced Loom's second visual pattern for this exact garment role.
        const overpassPattern = overpassEntry?.pattern || (overpassEntry?.patternId ? window.PatternLibrary?.getById?.(overpassEntry.patternId) : null);
        const patterns = overpassPattern ? [clone(pattern), clone(overpassPattern)] : [clone(pattern)]; // Slot 2 is already rendered as the compositor's overpass.
        const swapPatternColors = !!entry.swapPatternColors; // Stored beside this garment layer so base/trim can swap independently without changing the source pattern.
        layers[key] = {
          pattern: clone(pattern),
          patterns,
          ...(entry.patternId ? { patternLibraryId: entry.patternId } : {}),
          patternLabel: entry.patternLabel || 'Custom',
          ...(overpassEntry?.patternId ? { overpassPatternLibraryId: overpassEntry.patternId } : {}),
          ...(overpassPattern ? { overpassPatternLabel: overpassEntry?.patternLabel || 'Custom' } : {}),
          ...(swapPatternColors ? { swapPatternColors: true } : {}),
        };
      }
'''
w = w[:loop_start] + new_state_loop + w[loop_end:]

# Seed both saved stack slots when reweaving at an Advanced Loom.
seed_anchor = '    function seedReweavePatternsFromItem() {'
seed_start = w.index(seed_anchor)
seed_end = w.index('    const overlay = document.createElement', seed_start)
seed_old = w[seed_start:seed_end]
seed_new = '''    function seedReweavePatternsFromItem() {
      if (!isReweave || state.reweaveSeededUid === reweaveItem.uid) return;
      state.layerPatterns = {};
      state.overpassPatterns = {};
      const savedWeaving = reweaveItem.weaving;
      if (savedWeaving) {
        for (const { role, key } of patternRoles()) {
          const stored = savedWeaving.layers
            ? weavingEntryForRole(savedWeaving, role)
            : (savedWeaving.pattern || savedWeaving.patterns ? { pattern: savedWeaving.pattern, patterns: savedWeaving.patterns, patternLabel: 'Custom' } : null);
          if (!stored) continue;
          const patternId = stored.patternLibraryId || '';
          const stack = normalizePatternStack(stored.patterns?.length ? stored.patterns : (stored.pattern || (patternId ? window.PatternLibrary?.getById?.(patternId) : null)));
          const primaryPattern = stack[0] || null; // Saved pattern stack slot 1 remains the ordinary pattern.
          if (primaryPattern) {
            state.layerPatterns[key] = {
              pattern: clone(primaryPattern),
              patternId,
              patternLabel: stored.patternLabel || (patternId ? window.PatternLibrary?.listAvailable?.().find(entry => entry.id === patternId)?.label : null) || 'Custom',
              swapPatternColors: !!stored.swapPatternColors,
            };
          }
          if (advanced && stack[1]) {
            const overpassPatternId = stored.overpassPatternLibraryId || ''; // Used to preserve library provenance for the optional second pattern.
            state.overpassPatterns[key] = {
              pattern: clone(stack[1]),
              patternId: overpassPatternId,
              patternLabel: stored.overpassPatternLabel || (overpassPatternId ? window.PatternLibrary?.listAvailable?.().find(entry => entry.id === overpassPatternId)?.label : null) || 'Custom',
            };
          }
        }
      }
      state.reweaveSeededUid = reweaveItem.uid;
    }

'''
w = w[:seed_start] + seed_new + w[seed_end:]

w = replace_once(
    w,
    '        <div class="loomcraft-head"><h2>🧶 Loom</h2><button class="loomcraft-close" type="button" aria-label="Close">✕</button></div>',
    '        <div class="loomcraft-head"><h2>🧶 ${advanced ? \'Advanced Loom\' : \'Simple Loom\'}</h2><button class="loomcraft-close" type="button" aria-label="Close">✕</button></div>',
    'loom title',
)
w = replace_once(
    w,
    "            <div class=\"loomcraft-card\"><h3>Weaving pattern</h3><div data-pattern-layers><span class=\"loomcraft-note\">Loading…</span></div><div class=\"loomcraft-note\">Uses the same saved/unlocked pattern library and authoring workflow as mastered-tool verdigris removal. Each layer's motif is baked into this crafted item; only its third dye color remains freely changeable afterward.</div></div>",
    "            <div class=\"loomcraft-card\"><h3>Weaving pattern</h3><div data-pattern-layers><span class=\"loomcraft-note\">Loading…</span></div><div class=\"loomcraft-note\">Uses the same saved/unlocked pattern library and authoring workflow as mastered-tool verdigris removal. Each layer's motif is baked into this crafted item; only its third dye color remains freely changeable afterward.${advanced ? ' Advanced Loom: add an optional overpass pattern above the base motif; any overpass doubles the wool cost.' : ''}</div></div>",
    'advanced pattern note',
)

# Keep an authored base-pattern edit from discarding the selected overpass in its live preview.
w = replace_once(
    w,
    "        const base = weavingFromState() || { layers: {} };\n        const weaving = { layers: { ...base.layers, [roleKey]: { pattern: patternData, ...(swapPatternColors ? { swapPatternColors: true } : {}) } } };",
    "        const base = weavingFromState() || { layers: {} };\n        const currentLayer = base.layers?.[roleKey] || {}; // Used to retain Advanced Loom pattern stack slot 2 while previewing edits to slot 1.\n        const currentStack = normalizePatternStack(currentLayer.patterns?.length ? currentLayer.patterns : currentLayer.pattern);\n        const weaving = { layers: { ...base.layers, [roleKey]: { ...currentLayer, pattern: patternData, patterns: currentStack[1] ? [patternData, currentStack[1]] : [patternData], swapPatternColors: !!swapPatternColors } } };",
    'pattern editor overpass preservation',
)

controls_anchor = "      patternLayersEl.innerHTML = '';\n"
controls_pos = w.index(controls_anchor, w.index('    async function refreshPatternLayerControls()')) + len(controls_anchor)
controls_end = w.index('      state.layersReady = true;', controls_pos)
new_controls = '''      for (const { role, key } of patternRoles()) {
        const row = document.createElement('div');
        row.className = 'loomcraft-pattern-layer';
        const label = document.createElement('label');
        label.textContent = patternRoles().length > 1 ? layerLabel(role) : 'Pattern library';
        row.appendChild(label);
        const select = document.createElement('select');
        populatePatternSelect(select, state.layerPatterns[key]?.patternId);
        row.appendChild(select);
        let overpassSelect = null; // Advanced Loom-only second pattern selector for this garment role.
        if (advanced) {
          const overpassLabel = document.createElement('label');
          overpassLabel.textContent = 'Overpass pattern';
          row.appendChild(overpassLabel);
          overpassSelect = document.createElement('select');
          populatePatternSelect(overpassSelect, state.overpassPatterns[key]?.patternId);
          overpassSelect.disabled = !state.layerPatterns[key];
          overpassSelect.onchange = () => {
            const patternId = overpassSelect.value;
            if (!patternId) delete state.overpassPatterns[key];
            else state.overpassPatterns[key] = { pattern: clone(window.PatternLibrary?.getById?.(patternId)), patternId, patternLabel: overpassSelect.selectedOptions[0]?.textContent || 'None' };
            refreshPreview();
          };
          row.appendChild(overpassSelect);
        }
        const swapWrap = document.createElement('label'); // Holds the per-layer cloth/pattern color-swap control outside PatternAuthoring.
        swapWrap.className = 'loomcraft-pattern-swap';
        const swapCheck = document.createElement('input'); // Writes only state.layerPatterns[key].swapPatternColors; base and trim therefore remain independent.
        swapCheck.type = 'checkbox';
        swapCheck.checked = !!state.layerPatterns[key]?.swapPatternColors;
        swapCheck.disabled = !state.layerPatterns[key];
        const swapText = document.createElement('span'); // Labels which resolved garment layer this independent swap applies to.
        swapText.textContent = `Swap ${role ? layerLabel(role).toLowerCase() : 'cloth'} ↔ pattern colors`;
        swapWrap.appendChild(swapCheck);
        swapWrap.appendChild(swapText);
        row.appendChild(swapWrap);
        select.onchange = () => {
          const patternId = select.value;
          const keepSwap = !!swapCheck.checked; // Carries this garment-layer choice across library-pattern changes without touching the pattern data.
          if (!patternId) {
            delete state.layerPatterns[key];
            delete state.overpassPatterns[key]; // An overpass is always pattern stack slot 2 and therefore cannot exist without slot 1.
            if (overpassSelect) { overpassSelect.value = ''; overpassSelect.disabled = true; }
            swapCheck.checked = false;
            swapCheck.disabled = true;
          } else {
            state.layerPatterns[key] = { pattern: clone(window.PatternLibrary?.getById?.(patternId)), patternId, patternLabel: select.selectedOptions[0]?.textContent || 'None', swapPatternColors: keepSwap };
            if (overpassSelect) overpassSelect.disabled = false;
            swapCheck.disabled = false;
          }
          refreshPreview();
        };
        swapCheck.onchange = () => {
          const entry = state.layerPatterns[key]; // Existing selected/custom pattern entry receives only the garment-specific swap flag.
          if (!entry) { swapCheck.checked = false; return; }
          entry.swapPatternColors = !!swapCheck.checked;
          refreshPreview();
        };
        const actions = document.createElement('div');
        actions.className = 'loomcraft-pattern-actions';
        const authorBtn = document.createElement('button');
        authorBtn.type = 'button';
        authorBtn.textContent = 'Author custom pattern…';
        authorBtn.onclick = () => openLayerPatternAuthor(role, key);
        actions.appendChild(authorBtn);
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Plain cloth';
        clearBtn.onclick = () => {
          delete state.layerPatterns[key];
          delete state.overpassPatterns[key];
          select.value = '';
          if (overpassSelect) { overpassSelect.value = ''; overpassSelect.disabled = true; }
          swapCheck.checked = false;
          swapCheck.disabled = true;
          refreshPreview();
        };
        actions.appendChild(clearBtn);
        row.appendChild(actions);
        patternLayersEl.appendChild(row);
      }
'''
w = w[:controls_pos] + new_controls + w[controls_end:]

w = replace_once(
    w,
    "      const cost = isReweave ? reweaveMaterialCost(reweaveItem) : (WOOL_COST_BY_SLOT[bp.slot] || 1);",
    "      const baseCost = isReweave ? reweaveMaterialCost(reweaveItem) : (WOOL_COST_BY_SLOT[bp.slot] || 1); // Ordinary Simple Loom price before the Advanced Loom overpass multiplier.\n      const cost = baseCost * (weavingHasOverpass(weaving) ? 2 : 1); // Any player-authored overpass doubles craft/reweave wool exactly once, regardless of garment layer count.",
    'preview overpass cost',
)
w = replace_once(
    w,
    "      overlay.querySelector('[data-material-note]').textContent = `${material.label}: ${owned} owned · ${cost} required${isReweave ? ' to reweave (half craft cost, rounded up)' : ''}.`;",
    "      overlay.querySelector('[data-material-note]').textContent = `${material.label}: ${owned} owned · ${cost} required${isReweave ? ' to reweave' : ''}${weavingHasOverpass(weaving) ? ' (2× for overpass)' : (isReweave ? ' (half craft cost, rounded up)' : '')}.`;",
    'material note cost',
)
w = replace_once(
    w,
    "      craft.textContent = isReweave ? `Reweave · ${cost} ${material.label}` : 'Craft';",
    "      craft.textContent = isReweave ? `Reweave · ${cost} ${material.label}` : `Craft · ${cost} ${material.label}`;",
    'craft button cost',
)
w = replace_once(w, "    reweaveSelect.onchange = () => openLoom(reweaveSelect.value || null);", "    reweaveSelect.onchange = () => openLoom(reweaveSelect.value || null, { advanced });", 'reweave mode preservation')
w = replace_once(
    w,
    "      if (isReweave) reweaveFromLoom(reweaveItem, selectedMaterial(), dyeById(state.dyeC), weavingFromState(), dyeById(state.dyeB));\n      else craftFromLoom(state, selectedBlueprint(), selectedMaterial(), dyeById, hasSecondary(), weavingFromState());",
    "      if (isReweave) reweaveFromLoom(reweaveItem, selectedMaterial(), dyeById(state.dyeC), weavingFromState(), dyeById(state.dyeB), advanced);\n      else craftFromLoom(state, selectedBlueprint(), selectedMaterial(), dyeById, hasSecondary(), weavingFromState(), advanced);",
    'submit advanced capability',
)
w = replace_once(w, '  function craftFromLoom(state, bp, material, dyeById, hasSecondary, weaving) {', '  function craftFromLoom(state, bp, material, dyeById, hasSecondary, weaving, advanced = false) {', 'craft signature')
w = replace_once(
    w,
    "    const cost = WOOL_COST_BY_SLOT[bp.slot] || 1;\n    const inventory = equipmentDeps?.inventory;",
    "    const baseCost = WOOL_COST_BY_SLOT[bp.slot] || 1; // Used by Simple Loom crafting and as the Advanced Loom overpass base price.\n    if (weavingHasOverpass(weaving) && !advanced) { equipmentDeps?.showToast?.('An Advanced Loom is required to weave an overpass pattern.', false); return false; }\n    const cost = baseCost * (weavingHasOverpass(weaving) ? 2 : 1);\n    const inventory = equipmentDeps?.inventory;",
    'craft overpass enforcement',
)
w = replace_once(w, '    openLoom();\n    return true;\n  }\n\n  function reweaveFromLoom(item, material, patternDye, weaving, secondaryDye = null) {', "    openLoom(null, { advanced });\n    return true;\n  }\n\n  function reweaveFromLoom(item, material, patternDye, weaving, secondaryDye = null, advanced = false) {", 'reopen advanced after craft')
w = replace_once(
    w,
    "    const cost = reweaveMaterialCost(item);\n    const inventory = equipmentDeps?.inventory;",
    "    const baseCost = reweaveMaterialCost(item); // Regular reweaving price before Advanced Loom's requested overpass multiplier.\n    if (weavingHasOverpass(weaving) && !advanced) { equipmentDeps?.showToast?.('An Advanced Loom is required to reweave an overpass pattern.', false); return false; }\n    const cost = baseCost * (weavingHasOverpass(weaving) ? 2 : 1);\n    const inventory = equipmentDeps?.inventory;",
    'reweave overpass enforcement',
)
w = replace_once(w, '    openLoom(item.uid);\n    return true;\n  }', '    openLoom(item.uid, { advanced });\n    return true;\n  }', 'reopen advanced after reweave')
write(weave_path, w)

# CraftingPanel: Mote-purchased blueprint ownership is a world mastery unlock,
# not a per-character inventory scroll.
craft_path = 'docs/js/crafting-panel.js'
c = read(craft_path)
c = replace_once(
    c,
    '  // Blueprints are a permanent, reusable unlock (bought once from the\n',
    "  function ownsBlueprint(bp) {\n    if ((deps.inventory[bp?.key] || 0) > 0) return true;\n    return !!(bp?.masteryUnlockId && window.CraftingMasterySystem?.hasUnlock?.(bp.masteryUnlockId)); // World-scoped Mote purchases behave as permanent blueprint ownership for every member of that world.\n  }\n\n  // Blueprints are a permanent, reusable unlock (bought once from the\n",
    'crafting mastery ownership helper',
)
c = replace_once(c, "    if ((deps.inventory[bp.key] || 0) < 1) { deps.showToast('No blueprint to build from.', false); return; }", "    if (!ownsBlueprint(bp)) { deps.showToast('No blueprint to build from.', false); return; }", 'crafting blueprint guard')
c = replace_once(c, "    const owned = visible.filter(bp => (deps.inventory[bp.key] || 0) > 0);", "    const owned = visible.filter(ownsBlueprint);", 'crafting owned filter')
c = replace_once(
    c,
    "    ['js/crafting-mastery-system.js?v=20261005craft2', () => Number(window.CraftingMasterySystem?.version) >= 2],",
    "    ['js/crafting-mastery-system.js?v=20261005craft2', () => Number(window.CraftingMasterySystem?.version) >= 2],\n    ['js/advanced-loom-system.js?v=20261005loom1', () => Number(window.AdvancedLoomSystem?.version) >= 1],",
    'advanced loom loader',
)
write(craft_path, c)

# Carpenter: Mote-only blueprints must never appear in the gold store even
# though they live in the same shared generic blueprint catalog.
carp_path = 'docs/js/carpenter-shop.js'
cp = read(carp_path)
cp = replace_once(cp, '    if (!bp) return;', '    if (!bp || bp.moteOnly) return;', 'carpenter buy guard')
cp = replace_once(cp, 'deps.FURNITURE_BLUEPRINT_CATALOG.filter(bp => window.ConditionRegistry.entryEligible(bp, world)).forEach(bp => {', 'deps.FURNITURE_BLUEPRINT_CATALOG.filter(bp => !bp.moteOnly && window.ConditionRegistry.entryEligible(bp, world)).forEach(bp => {', 'carpenter mote filter')
write(carp_path, cp)

# Grid/editor metadata: the old key remains save-compatible but is now a
# genuinely compact 1x1 Simple Loom; Advanced Loom retains the full 1x2 frame.
grid_path = 'docs/js/interior-furniture-grid.js'
grid = read(grid_path)
grid, n = re.subn(r"loomFurniture\s*:\s*\[\s*1\s*,\s*2\s*\]", "loomFurniture: [1, 1], advancedLoomFurniture: [1, 2]", grid, count=1)
if n != 1:
    raise RuntimeError(f'interior grid loom footprint: expected 1, found {n}')
write(grid_path, grid)

# Authored runtime: shrink every old loom transform into the center of a 1x1
# tile, while preserving its proportions/material assignments.
loom_path = Path('docs/config/furniture-authored/loom.json')
loom = json.loads(loom_path.read_text(encoding='utf-8'))
loom['footprint'] = {'w': 1, 'd': 1}
for part in loom.get('parts', []):
    tr = part.get('transform', {})
    tr['x'] = round(float(tr.get('x', 0)) * 0.74, 4)
    tr['y'] = round(float(tr.get('y', 0)) * 0.62, 4)
    tr['z'] = round(float(tr.get('z', 0)) * 0.43, 4)
    tr['sx'] = round(float(tr.get('sx', 1)) * 0.74, 4)
    tr['sy'] = round(float(tr.get('sy', 1)) * 0.62, 4)
    tr['sz'] = round(float(tr.get('sz', 1)) * 0.74, 4)
loom_path.write_text(json.dumps(loom, indent=2) + '\n', encoding='utf-8')

# Create the full-size Advanced Loom authored frame by scaling from the original
# dimensions rather than the newly-shrunk Simple Loom. Extra mid rails make it
# immediately distinguishable from the starter frame.
def furniture_part(pid, kind, name, x, y, z, sx, sy, sz, color, tint):
    return {
        'id': pid, 'kind': kind, 'name': name,
        'transform': {'x': x, 'y': y, 'z': z, 'rx': 0, 'ry': 0, 'rz': 0, 'sx': sx, 'sy': sy, 'sz': sz},
        'color': color, 'segments': 4, 'taperAxis': 'y', 'topScaleX': 0.92, 'topScaleZ': 0.92,
        'bottomScaleX': 1, 'bottomScaleZ': 1, 'topSkewX': 0, 'topSkewZ': 0, 'innerScale': 0.68,
        'basinDepth': 0.18, 'liquidContainerId': None, 'liquidLevel': 0.5, 'wonkiness': 0.015,
        'materialRole': 'wood', 'materialTexture': 'carved_smooth.png', 'materialRotationDeg': 0,
        'materialCapTexture': None, 'materialCapRotationDeg': 0, 'materialFillEnabled': False,
        'materialFillColor': None, 'materialFillMode': 'never', 'surfaceOpacity': 1,
        'substanceColor': '#6b4a28' if kind == 'legSquare' else '#8b6540', 'substanceFillOpacity': 0,
        'timelineUseSubstanceColor': False, 'textureDataUrl': None, 'textureName': '', 'textureTransparent': True,
        'textureTileSize': 1, 'tint': tint,
    }
advanced = {
    'schema': 'hobunji_furniture_authored_runtime.v1', 'key': 'advancedLoom',
    'sourceSchema': 'hobunji_furniture_surface_author.v58', 'footprint': {'w': 1, 'd': 2},
    'parts': [
        furniture_part('advanced_loom_leg_nw','legSquare','Advanced Loom Leg',-0.32,0.825,-0.82,0.12,1.65,0.12,'#654426',0.8),
        furniture_part('advanced_loom_leg_ne','legSquare','Advanced Loom Leg',0.32,0.825,-0.82,0.12,1.65,0.12,'#654426',0.8),
        furniture_part('advanced_loom_leg_sw','legSquare','Advanced Loom Leg',-0.32,0.825,0.82,0.12,1.65,0.12,'#654426',0.8),
        furniture_part('advanced_loom_leg_se','legSquare','Advanced Loom Leg',0.32,0.825,0.82,0.12,1.65,0.12,'#654426',0.8),
        furniture_part('advanced_loom_top_n','box','Advanced Loom Top Rail',0,1.55,-0.82,0.82,0.09,0.12,'#76502f',0.9),
        furniture_part('advanced_loom_low_n','box','Advanced Loom Lower Rail',0,0.26,-0.82,0.82,0.09,0.12,'#76502f',0.9),
        furniture_part('advanced_loom_top_s','box','Advanced Loom Top Rail',0,1.55,0.82,0.82,0.09,0.12,'#76502f',0.9),
        furniture_part('advanced_loom_low_s','box','Advanced Loom Lower Rail',0,0.26,0.82,0.82,0.09,0.12,'#76502f',0.9),
        furniture_part('advanced_loom_mid_n','box','Advanced Loom Overpass Rail',0,1.08,-0.82,0.72,0.06,0.08,'#92704d',1.0),
        furniture_part('advanced_loom_mid_s','box','Advanced Loom Overpass Rail',0,1.08,0.82,0.72,0.06,0.08,'#92704d',1.0),
    ],
    'seatAnchors': [], 'particleEmitters': [], 'processingWarps': [], 'processTimelines': [], 'stompAttachPoints': [],
}
Path('docs/config/furniture-authored/advancedLoom.json').write_text(json.dumps(advanced, indent=2) + '\n', encoding='utf-8')

index_path = Path('docs/config/furniture-authored/index.json')
index = json.loads(index_path.read_text(encoding='utf-8'))
if not any(row.get('key') == 'advancedLoom' for row in index.get('furniture', [])):
    loom_i = next((i for i, row in enumerate(index['furniture']) if row.get('key') == 'loom'), len(index['furniture']) - 1)
    index['furniture'].insert(loom_i + 1, {'key': 'advancedLoom', 'file': 'config/furniture-authored/advancedLoom.json'})
index_path.write_text(json.dumps(index, indent=2) + '\n', encoding='utf-8')

# Lightweight editor parity for authoring existing maps/interiors.
for path in ['docs/tools/building-interior-author/index.html', 'docs/tools/map-editor/index.html']:
    p = Path(path)
    if not p.exists():
        continue
    text = p.read_text(encoding='utf-8')
    text = text.replace("label:'Small Loom'", "label:'Simple Loom'").replace('label: \'Small Loom\'', "label: 'Simple Loom'")
    text = text.replace('Small Loom', 'Simple Loom')
    p.write_text(text, encoding='utf-8')

print('Advanced Loom patch applied successfully.')
