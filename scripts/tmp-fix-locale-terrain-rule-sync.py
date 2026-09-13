from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch target: {label}')
    return text.replace(old, new, 1)

# Main Locale Editor: keep terrain rules in the actual workspace model and expose
# a tiny mutation bridge for the terrain-authoring sidecar.
path = Path('docs/tools/locale-editor/index.html')
s = path.read_text(encoding='utf-8')

s = replace_once(s,
"""    connectors: [],    // { id, col, row, side, label }\n    placement: { mode: 'fixed', maxInstances: 1, allowedZones: [], clearanceTiles: 2, requiresFlatGround: true, floorMode: 'footprint', minDistanceFromEntry: 0, sameSectorAsEntry: false, alwaysVisibleOnMap: false, groundOnly: false, notes: '' },\n""",
"""    connectors: [],    // { id, col, row, side, label }\n    terrainAnchors: {}, // Runtime terrain probes; mirrored into placement for editor persistence.\n    embeddedTiles: {},  // Runtime embedded-host cells; mirrored into placement for editor persistence.\n    placement: { mode: 'fixed', maxInstances: 1, allowedZones: [], clearanceTiles: 2, requiresFlatGround: true, floorMode: 'footprint', minDistanceFromEntry: 0, sameSectorAsEntry: false, alwaysVisibleOnMap: false, groundOnly: false, notes: '', terrainAnchors: {}, embeddedTiles: {} },\n""", 'makeLocale terrain fields')

s = replace_once(s,
"""    meta: Object.assign({ createdAt: nowIso(), updatedAt: nowIso() }, raw.meta || {})\n  });\n  for (const [k, v] of Object.entries(raw.tiles || {})) {\n""",
"""    meta: Object.assign({ createdAt: nowIso(), updatedAt: nowIso() }, raw.meta || {})\n  });\n  // placement.* is the editor-persisted source of truth when present. Older locale\n  // documents that only have top-level runtime fields are migrated into it here.\n  const rawPlacement = raw.placement || {};\n  const hasPlacementAnchors = Object.prototype.hasOwnProperty.call(rawPlacement, 'terrainAnchors');\n  const hasPlacementEmbedded = Object.prototype.hasOwnProperty.call(rawPlacement, 'embeddedTiles');\n  const terrainAnchors = JSON.parse(JSON.stringify((hasPlacementAnchors ? rawPlacement.terrainAnchors : raw.terrainAnchors) || {}));\n  const embeddedTiles = JSON.parse(JSON.stringify((hasPlacementEmbedded ? rawPlacement.embeddedTiles : raw.embeddedTiles) || {}));\n  m.terrainAnchors = terrainAnchors;\n  m.embeddedTiles = embeddedTiles;\n  m.placement.terrainAnchors = JSON.parse(JSON.stringify(terrainAnchors));\n  m.placement.embeddedTiles = JSON.parse(JSON.stringify(embeddedTiles));\n  for (const [k, v] of Object.entries(raw.tiles || {})) {\n""", 'sanitize terrain fields')

s = replace_once(s,
"""    tiles: m.tiles, objects: m.objects, npcAnchors: m.npcAnchors, connectors: m.connectors,\n    placement: m.placement, meta: m.meta\n""",
"""    tiles: m.tiles, objects: m.objects, npcAnchors: m.npcAnchors, connectors: m.connectors,\n    terrainAnchors: m.terrainAnchors || {}, embeddedTiles: m.embeddedTiles || {},\n    placement: m.placement, meta: m.meta\n""", 'buildExport terrain fields')

s = replace_once(s,
"""window._localeEditorBridge = {\n  getWorkspace: () => JSON.parse(JSON.stringify(ws)),\n  loadLocale: (data) => {\n""",
"""window._localeEditorBridge = {\n  getWorkspace: () => JSON.parse(JSON.stringify(ws)),\n  setTerrainRules: (localeId, rules) => {\n    const m = ws.locales.find(locale => locale.id === localeId);\n    if (!m) return false;\n    const terrainAnchors = JSON.parse(JSON.stringify(rules?.terrainAnchors || {}));\n    const embeddedTiles = JSON.parse(JSON.stringify(rules?.embeddedTiles || {}));\n    m.terrainAnchors = terrainAnchors;\n    m.embeddedTiles = embeddedTiles;\n    m.placement = m.placement || {};\n    m.placement.terrainAnchors = JSON.parse(JSON.stringify(terrainAnchors));\n    m.placement.embeddedTiles = JSON.parse(JSON.stringify(embeddedTiles));\n    renderValidation();\n    renderJson();\n    return true;\n  },\n  loadLocale: (data) => {\n""", 'editor bridge terrain setter')

path.write_text(s, encoding='utf-8')

# Terrain-authoring sidecar: workspace rules beat stale sidecar cache, and every
# brush edit is mirrored immediately into the real workspace object.
path = Path('docs/tools/locale-editor/terrain-placement.js')
s = path.read_text(encoding='utf-8')

s = replace_once(s,
"""  function rulesFromLocale(locale) {\n    const placement = locale?.placement || {}; // Placement object is the persistence-compatible home for editor-side terrain rules.\n    return {\n      terrainAnchors: clone(placement.terrainAnchors || locale?.terrainAnchors || {}),\n      embeddedTiles: clone(placement.embeddedTiles || locale?.embeddedTiles || {}),\n    };\n  }\n\n  function ensureRules(locale) {\n""",
"""  function rulesFromLocale(locale) {\n    const placement = locale?.placement || {}; // Placement object is the persistence-compatible home for editor-side terrain rules.\n    const hasPlacementAnchors = Object.prototype.hasOwnProperty.call(placement, 'terrainAnchors');\n    const hasPlacementEmbedded = Object.prototype.hasOwnProperty.call(placement, 'embeddedTiles');\n    return {\n      terrainAnchors: clone((hasPlacementAnchors ? placement.terrainAnchors : locale?.terrainAnchors) || {}),\n      embeddedTiles: clone((hasPlacementEmbedded ? placement.embeddedTiles : locale?.embeddedTiles) || {}),\n    };\n  }\n\n  function hasPersistedRuleFields(locale) {\n    const placement = locale?.placement || {};\n    return Object.prototype.hasOwnProperty.call(placement, 'terrainAnchors') || Object.prototype.hasOwnProperty.call(placement, 'embeddedTiles');\n  }\n\n  function sameRules(a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }\n\n  function syncRulesToMainLocale(localeId, rules) {\n    try { bridge()?.setTerrainRules?.(localeId, clone(rules)); }\n    catch (error) { debug(`workspace terrain-rule sync failed: ${error.message}`); }\n  }\n\n  function ensureRules(locale) {\n""", 'sidecar authoritative helpers')

s = replace_once(s,
"""    rules.embeddedTiles = rules.embeddedTiles || {};\n    return rules;\n  }\n\n  function mergedLocale(locale) {\n""",
"""    rules.embeddedTiles = rules.embeddedTiles || {};\n    return rules;\n  }\n\n  function reconcileRulesFromLocale(locale) {\n    if (!locale?.id) return { terrainAnchors: {}, embeddedTiles: {} };\n    const fromLocale = rulesFromLocale(locale);\n    // Once a workspace locale explicitly carries persisted terrain fields, it is\n    // authoritative. This prevents an obsolete sidecar cache from resurrecting\n    // rules after loading/reloading a newer repo locale.\n    if (hasPersistedRuleFields(locale)) {\n      if (!sameRules(store.byLocale[locale.id], fromLocale)) {\n        store.byLocale[locale.id] = fromLocale;\n        saveRuleStore();\n      }\n    } else if (!store.byLocale[locale.id]) {\n      store.byLocale[locale.id] = fromLocale;\n      saveRuleStore();\n    }\n    const rules = ensureRules(locale);\n    syncRulesToMainLocale(locale.id, rules);\n    return rules;\n  }\n\n  function mergedLocale(locale) {\n""", 'sidecar reconcile function')

s = replace_once(s,
"""    saveRuleStore();\n    syncWorkspaceStorage();\n    draw();\n    updateStats();\n  }\n\n  function clearRules() {\n""",
"""    syncRulesToMainLocale(locale.id, rules);\n    saveRuleStore();\n    syncWorkspaceStorage();\n    draw();\n    updateStats();\n  }\n\n  function clearRules() {\n""", 'paint sync to main locale')

s = replace_once(s,
"""    store.byLocale[locale.id] = { terrainAnchors: {}, embeddedTiles: {} };\n    saveRuleStore();\n    syncWorkspaceStorage();\n""",
"""    store.byLocale[locale.id] = { terrainAnchors: {}, embeddedTiles: {} };\n    syncRulesToMainLocale(locale.id, store.byLocale[locale.id]);\n    saveRuleStore();\n    syncWorkspaceStorage();\n""", 'clear sync to main locale')

old_seed = """  function seedStoreFromWorkspace() {\n    const workspace = workspaceSnapshot();\n    if (!workspace) return;\n    let changed = false; // New persisted nested rules are imported into sidecar store without overwriting edits already made this session.\n    for (const locale of workspace.locales || []) {\n      if (store.byLocale[locale.id]) continue;\n      const fromLocale = rulesFromLocale(locale);\n      if (Object.keys(fromLocale.terrainAnchors).length || Object.keys(fromLocale.embeddedTiles).length) {\n        store.byLocale[locale.id] = fromLocale;\n        changed = true;\n      }\n    }\n    if (changed) saveRuleStore();\n  }\n"""
new_seed = """  function seedStoreFromWorkspace() {\n    const workspace = workspaceSnapshot();\n    if (!workspace) return;\n    for (const locale of workspace.locales || []) reconcileRulesFromLocale(locale);\n  }\n"""
s = replace_once(s, old_seed, new_seed, 'seed store reconciliation')

s = replace_once(s,
"""      if (locale) ensureRules(locale);\n      draw();\n""",
"""      if (locale) reconcileRulesFromLocale(locale);\n      draw();\n""", 'active-locale reconciliation')

path.write_text(s, encoding='utf-8')

# 3D preview: persisted workspace fields are primary; sidecar is migration-only.
path = Path('docs/tools/locale-editor/locale-preview3d.js')
s = path.read_text(encoding='utf-8')
old = """    const output = clone(locale);\n    const stored = sidecarRules(locale.id);\n    const placement = output.placement || {};\n    output.terrainAnchors = clone(stored?.terrainAnchors || placement.terrainAnchors || output.terrainAnchors || {});\n    output.embeddedTiles = clone(stored?.embeddedTiles || placement.embeddedTiles || output.embeddedTiles || {});\n"""
new = """    const output = clone(locale);\n    const stored = sidecarRules(locale.id);\n    const placement = output.placement || {};\n    const hasPlacementAnchors = Object.prototype.hasOwnProperty.call(placement, 'terrainAnchors');\n    const hasPlacementEmbedded = Object.prototype.hasOwnProperty.call(placement, 'embeddedTiles');\n    output.terrainAnchors = clone((hasPlacementAnchors ? placement.terrainAnchors : (output.terrainAnchors || stored?.terrainAnchors)) || {});\n    output.embeddedTiles = clone((hasPlacementEmbedded ? placement.embeddedTiles : (output.embeddedTiles || stored?.embeddedTiles)) || {});\n    output.placement = { ...placement, terrainAnchors: clone(output.terrainAnchors), embeddedTiles: clone(output.embeddedTiles) };\n"""
s = replace_once(s, old, new, 'preview workspace-first rule merge')
path.write_text(s, encoding='utf-8')

# Regression assertions for the synchronization contract.
path = Path('scripts/test-banubu-cave-locale.js')
s = path.read_text(encoding='utf-8')
s = replace_once(s,
"""const localeEditorPreview = fs.readFileSync(path.join(repoRoot, 'docs/tools/locale-editor/locale-preview3d.js'), 'utf8');\n""",
"""const localeEditorPreview = fs.readFileSync(path.join(repoRoot, 'docs/tools/locale-editor/locale-preview3d.js'), 'utf8');\nconst localeEditorIndex = fs.readFileSync(path.join(repoRoot, 'docs/tools/locale-editor/index.html'), 'utf8');\nconst localeTerrainEditor = fs.readFileSync(path.join(repoRoot, 'docs/tools/locale-editor/terrain-placement.js'), 'utf8');\n""", 'test file reads')
s = replace_once(s,
"""assert(localeEditorPreview.includes('const bounds = compiled?.footprint || compiled?.bounds'), 'Locale Editor preview camera must orbit the painted locale footprint');\n\nconsole.log('Banubu cliff-base authoring + terrain/runtime regression checks passed');\n""",
"""assert(localeEditorPreview.includes('const bounds = compiled?.footprint || compiled?.bounds'), 'Locale Editor preview camera must orbit the painted locale footprint');\nassert(localeEditorPreview.includes("hasPlacementAnchors ? placement.terrainAnchors"), '3D preview must prefer the active workspace terrain rules over stale sidecar cache');\nassert(localeEditorPreview.includes("output.placement = { ...placement, terrainAnchors: clone(output.terrainAnchors)"), '3D preview debug/runtime locale must serialize one synchronized terrain-rule set');\nassert(localeEditorIndex.includes('setTerrainRules: (localeId, rules) =>'), 'main Locale Editor bridge must allow terrain authoring to mutate the live workspace locale');\nassert(localeEditorIndex.includes('m.terrainAnchors = terrainAnchors;') && localeEditorIndex.includes('m.placement.terrainAnchors = JSON.parse(JSON.stringify(terrainAnchors));'), 'main Locale Editor must mirror runtime and persisted terrain fields');\nassert(localeTerrainEditor.includes('reconcileRulesFromLocale(locale)'), 'terrain sidecar must reconcile stale cache against persisted workspace rules');\nassert(localeTerrainEditor.includes('syncRulesToMainLocale(locale.id, rules);'), 'terrain brush edits must update the live workspace locale immediately');\n\nconsole.log('Banubu cliff-base authoring + terrain/runtime regression checks passed');\n""", 'sync regression assertions')
path.write_text(s, encoding='utf-8')
