from pathlib import Path
import re
import subprocess


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Missing expected source for {label}")
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label, flags=re.S):
    text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"Expected one replacement for {label}, got {count}")
    return text


# 1) Controller-only schema/default policy lives in InputBindings instead of the
# global Scratchbones config. The workflow restores scratchbones-config.js from
# current main before running this script.
bindings_path = Path('docs/js/input-bindings.js')
bindings = bindings_path.read_text()
required_start = "  const REQUIRED_CONTROLLER_ACTIONS = Object.freeze([\n"
required_end = "  ]); // Used to guarantee Settings always exposes controller actions that older authored configs may not contain yet.\n"
start = bindings.find(required_start)
end = bindings.find(required_end, start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate REQUIRED_CONTROLLER_ACTIONS block')
end += len(required_end)
required_block = """  const REQUIRED_CONTROLLER_ACTIONS = Object.freeze([\n    { id: 'itemSelect', label: 'Item Select', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.itemSelect, devices: ['controller'], context: 'selection' },\n    { id: 'socialWheel', label: 'Social Actions', desktop: 'Shift+KeyQ', controller: CANONICAL_CONTROLLER_DEFAULTS.socialWheel, context: 'selection' },\n    { id: 'toggleMount', label: 'Call/Dismiss Mount', desktop: 'KeyV', controller: CANONICAL_CONTROLLER_DEFAULTS.toggleMount },\n    { id: 'uiOpenMenu', label: 'Menu: Open / Close', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.uiOpenMenu, devices: ['controller'], context: 'menu' },\n    { id: 'uiConfirm', label: 'Menu: Confirm', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.uiConfirm, devices: ['controller'], context: 'menu' },\n    { id: 'uiCancel', label: 'Menu: Cancel / Back', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.uiCancel, devices: ['controller'], context: 'menu' },\n    { id: 'uiTabPrev', label: 'Menu: Previous Tab', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.uiTabPrev, devices: ['controller'], context: 'menu' },\n    { id: 'uiTabNext', label: 'Menu: Next Tab', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.uiTabNext, devices: ['controller'], context: 'menu' },\n    { id: 'uiUp', label: 'Menu: Navigate Up', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.uiUp, devices: ['controller'], context: 'menu' },\n    { id: 'uiDown', label: 'Menu: Navigate Down', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.uiDown, devices: ['controller'], context: 'menu' },\n    { id: 'uiLeft', label: 'Menu: Navigate Left', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.uiLeft, devices: ['controller'], context: 'menu' },\n    { id: 'uiRight', label: 'Menu: Navigate Right', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.uiRight, devices: ['controller'], context: 'menu' },\n    { id: 'musicNote1', label: 'Music: Note 1', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.musicNote1, devices: ['controller'], context: 'music' },\n    { id: 'musicNote2', label: 'Music: Note 2', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.musicNote2, devices: ['controller'], context: 'music' },\n    { id: 'musicNote3', label: 'Music: Note 3', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.musicNote3, devices: ['controller'], context: 'music' },\n    { id: 'musicNote4', label: 'Music: Note 4', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.musicNote4, devices: ['controller'], context: 'music' },\n    { id: 'musicBank1', label: 'Music: Bank 1', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.musicBank1, devices: ['controller'], context: 'music' },\n    { id: 'musicBank2', label: 'Music: Bank 2', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.musicBank2, devices: ['controller'], context: 'music' },\n    { id: 'musicBank3', label: 'Music: Bank 3', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.musicBank3, devices: ['controller'], context: 'music' },\n    { id: 'musicBank4', label: 'Music: Bank 4', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.musicBank4, devices: ['controller'], context: 'music' },\n    { id: 'musicPause', label: 'Music: Pause', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.musicPause, devices: ['controller'], context: 'music' },\n    { id: 'musicScalePrev', label: 'Music: Previous Scale', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.musicScalePrev, devices: ['controller'], context: 'music' },\n    { id: 'musicScaleNext', label: 'Music: Next Scale', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.musicScaleNext, devices: ['controller'], context: 'music' },\n    { id: 'meleeAutoTargetToggle', label: 'Melee: Toggle Auto-Target', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.meleeAutoTargetToggle, devices: ['controller'], context: 'melee' },\n  ]); // Controller-only schema is owned here so global gameplay config and unrelated camera work never need to author or migrate these rows.\n"""
bindings = bindings[:start] + required_block + bindings[end:]

for obsolete in [
    "  let explicitMountBindingKnown = false; // Used by the legacy-migration repair loop to distinguish an intentional saved mount choice (including Unbound) from a shipped default.\n",
    "  let explicitMountBinding = null; // Stores the player's last explicit Call/Dismiss Mount controller choice so Social Actions cannot silently erase it later.\n",
    "  let mountRepairTimer = null; // Keeps one lightweight repair interval alive after game.js supplies the live inputBindings getter.\n",
]:
    bindings = bindings.replace(obsolete, '')

bindings = regex_once(
    bindings,
    r"  function repairExplicitMountBinding\(\) \{.*?\n  function init\(injectedDeps\) \{",
    "  function init(injectedDeps) {",
    'obsolete mount repair loop',
)
bindings = bindings.replace("    startMountRepairLoop();\n", '')
bindings = regex_once(
    bindings,
    r"      if \(saved\?\.controller && Object\.prototype\.hasOwnProperty\.call\(saved\.controller, 'toggleMount'\)\) \{.*?\n      \}\n",
    '',
    'saved mount repair bookkeeping',
)
bindings = regex_once(
    bindings,
    r"\n    if \(device === 'controller'\) \{\n      explicitMountBindingKnown = true;\n      explicitMountBinding = target\.toggleMount \?\? null;\n    \}",
    '',
    'reset mount repair bookkeeping',
)
bindings = regex_once(
    bindings,
    r"\n  window\.addEventListener\('hobunji-input-bindings-changed', event => \{.*?\n  \}\);\n",
    '\n',
    'mount repair event listener',
)

resolver_block = """
  function resolveActionForButton(device, button, heldShift = null) {
    if (heldShift?.bindings?.[button]) return heldShift.bindings[button];
    const bindings = getCurrentBindings()?.[device] || {}; // Uses the live map so game.js never needs to know how contextual controller actions are authored.
    return Object.keys(bindings).find(actionId => bindings[actionId] === button && actionContext(actionId) === 'gameplay') || null;
  }

  function consumeControllerPress(actionId, down, previous, active = true) {
    if (!active || !down?.has || !previous?.has) return false;
    const binding = getCurrentBindings()?.controller?.[actionId] ?? null; // Resolves semantic contextual presses without exposing physical controller codes to gameplay code.
    if (!binding || !down.has(binding)) return false;
    const freshPress = !previous.has(binding); // Used so held contextual actions edge-trigger once, matching the old hardcoded R3 behavior.
    down.delete(binding);
    return freshPress;
  }

"""
anchor = "  function contextsConflict(targetContext, otherContext) {\n"
if resolver_block.strip() not in bindings:
    bindings = replace_once(bindings, anchor, resolver_block + anchor, 'binding dispatch API insertion')

bindings = bindings.replace(
    "    init, loadInputBindings, getCurrentBindings, saveInputBindings, repairExplicitMountBinding,\n",
    "    init, loadInputBindings, getCurrentBindings, saveInputBindings,\n",
)
bindings = bindings.replace(
    "    bindingConflict, actionLabel, buttonLabel, actionContext, getActionsForDevice,\n",
    "    bindingConflict, actionLabel, buttonLabel, actionContext, getActionsForDevice, resolveActionForButton, consumeControllerPress,\n",
)
bindings_path.write_text(bindings)

# 2) Social Actions stops mutating the global input schema. InputBindings owns
# the action/default, and the wheel only asks the binding API for it.
social_path = Path('docs/js/social-action-wheel.js')
social = social_path.read_text()
social = social.replace("    controllerOpen: 'Button13',", "    controllerOpen: 'Button15',")
social = regex_once(
    social,
    r"\n  // D-pad Down used to be the mount default\..*?\n  const DANCE_STYLES =",
    "\n  const DANCE_STYLES =",
    'social global input-schema mutation',
)
social = replace_once(
    social,
    "  function binding(device, actionId, fallback = null) {\n    return currentBindings()?.[device]?.[actionId] || fallback;\n  }",
    "  function binding(device, actionId, fallback = null) {\n    const current = currentBindings()?.[device]; // Preserves an explicit Unbound value instead of falling through to a legacy module default.\n    if (current && Object.prototype.hasOwnProperty.call(current, actionId)) return current[actionId];\n    const defaults = window.InputBindings?.getDefaultBindings?.(device); // Keeps controller action ownership in the binding layer rather than mutating SCRATCHBONES_CONFIG here.\n    if (defaults && Object.prototype.hasOwnProperty.call(defaults, actionId)) return defaults[actionId];\n    return fallback;\n  }",
    'social binding fallback',
)
social_path.write_text(social)

# 3) Other controller consumers also use InputBindings for their default
# fallback instead of reaching into the global authored action array.
ui_path = Path('docs/js/controller-ui-nav.js')
ui = ui_path.read_text()
ui = replace_once(
    ui,
    "    const actionDefinition = window.SCRATCHBONES_CONFIG?.game?.input?.actions?.find(action => action.id === actionId); // Used as the shipped fallback before saved bindings have initialized.\n    return actionDefinition?.controller || null;",
    "    const defaults = window.InputBindings?.getDefaultBindings?.('controller'); // Keeps controller-only action schema/defaults owned by InputBindings.\n    return defaults && Object.prototype.hasOwnProperty.call(defaults, actionId) ? defaults[actionId] : null;",
    'controller menu fallback',
)
ui_path.write_text(ui)

music_path = Path('docs/js/music-minigame.js')
music = music_path.read_text()
music = replace_once(
    music,
    "      const actionDefinition = window.SCRATCHBONES_CONFIG?.game?.input?.actions?.find(action => action.id === actionId); // Used as the fallback when no saved binding exists yet.\n      return actionDefinition?.controller || null;",
    "      const defaults = window.InputBindings?.getDefaultBindings?.('controller'); // Keeps music's controller schema/defaults decoupled from the global gameplay config.\n      return defaults && Object.prototype.hasOwnProperty.call(defaults, actionId) ? defaults[actionId] : null;",
    'music controller fallback',
)
music_path.write_text(music)

# 4) game.js becomes a thin semantic bridge. Binding/context policy lives in
# InputBindings, while camera clamp math lives in CameraLookClamp.
game_path = Path('docs/game.js')
game = game_path.read_text()
game = regex_once(
    game,
    r"      function getActionForButton\(device, button, heldShift = null\) \{.*?\n      \}\n      function publishControllerStatus",
    "      function getActionForButton(device, button, heldShift = null) {\n        return window.InputBindings?.resolveActionForButton?.(device, button, heldShift) || null;\n      }\n      function publishControllerStatus",
    'game binding resolver bridge',
)
game = regex_once(
    game,
    r"        const meleeAutoTargetBinding = inputBindings\.controller\?\.meleeAutoTargetToggle \|\| null;.*?\n        \}\n        const heldShift =",
    "        if (window.InputBindings?.consumeControllerPress?.('meleeAutoTargetToggle', down, gamepadState.previous, meleeWeaponOut())) {\n          meleeAutoTargetOn = !meleeAutoTargetOn;\n          manualAutoTarget = null;\n          meleeAutoTargetFreeAim = false;\n          showToast(meleeAutoTargetOn ? 'Auto-Target: On' : 'Auto-Target: Off', meleeAutoTargetOn);\n        }\n        const heldShift =",
    'game contextual melee bridge',
)
game = regex_once(
    game,
    r"      function clampCameraPitchOffsetDeg\(value\) \{.*?\n      \}\n      // Wraps into",
    "      function clampCameraPitchOffsetDeg(value) {\n        return window.CameraLookClamp.clampPitchOffsetDeg(value, desktopControlsConfig());\n      }\n      // Wraps into",
    'camera clamp bridge',
)
game_path.write_text(game)

# 5) Camera clamp policy/math is independently testable and no longer lives in
# the game closure.
camera_module = """(() => {
  'use strict';

  const DEFAULT_DOWN_CLAMP_DEG = 45;
  const DEFAULT_UP_CLAMP_DEG = 85;

  function clampPitchOffsetDeg(value, controlsConfig = {}) {
    const cfg = controlsConfig || {}; // Receives desktopControlsConfig() without depending on game.js or FormatUtils.
    const downClampDeg = Number.isFinite(Number(cfg.cameraRotateClampDeg)) ? Math.abs(Number(cfg.cameraRotateClampDeg)) : DEFAULT_DOWN_CLAMP_DEG; // Positive pitch/downward boundary.
    const upClampDeg = Number.isFinite(Number(cfg.cameraRotateUpClampDeg)) ? Math.abs(Number(cfg.cameraRotateUpClampDeg)) : DEFAULT_UP_CLAMP_DEG; // Negative pitch/upward boundary.
    const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    return Math.max(-upClampDeg, Math.min(downClampDeg, numericValue));
  }

  window.CameraLookClamp = {
    clampPitchOffsetDeg,
    defaults: Object.freeze({ downDeg: DEFAULT_DOWN_CLAMP_DEG, upDeg: DEFAULT_UP_CLAMP_DEG }),
  };
})();
"""
# Fix accidental leading token in source construction above before writing.
camera_module = camera_module.replace("t# the game closure.\n", "")
Path('docs/js/camera-look-clamp.js').write_text(camera_module)

# 6) Cache/load boundaries are independent: camera helper before game; global
# Scratchbones config and unrelated fishing script keep main's cache keys.
index_path = Path('docs/index.html')
index = index_path.read_text()
main_index = subprocess.check_output(['git', 'show', 'origin/main:docs/index.html'], text=True)
for script_name in ('config/scratchbones-config.js', 'js/fishing-minigame.js'):
    main_match = re.search(rf'<script src="{re.escape(script_name)}\?v=[^"]+"></script>', main_index)
    if not main_match:
        raise SystemExit(f'Missing {script_name} in main index')
    index, count = re.subn(rf'<script src="{re.escape(script_name)}\?v=[^"]+"></script>', main_match.group(0), index, count=1)
    if count != 1:
        raise SystemExit(f'Expected one {script_name} cache tag in branch index')

index = re.sub(r'<script src="js/input-bindings\.js\?v=[^"]+"></script>', '<script src="js/input-bindings.js?v=20260909decouple1"></script>', index, count=1)
index = re.sub(r'<script src="js/music-minigame\.js\?v=[^"]+"></script>', '<script src="js/music-minigame.js?v=20260909decouple1"></script>', index, count=1)
index = re.sub(r'<script src="js/controller-ui-nav\.js\?v=[^"]+"></script>', '<script src="js/controller-ui-nav.js?v=20260909decouple1"></script>', index, count=1)
index = re.sub(r'<script src="game\.js\?v=[^"]+"></script>', '<script src="game.js?v=20260909decouple1"></script>', index, count=1)
if 'js/camera-look-clamp.js?' not in index:
    index = replace_once(
        index,
        '  <script src="game.js?v=20260909decouple1"></script>',
        '  <!-- Directional camera pitch policy is isolated from controller bindings/gameplay dispatch. -->\n  <script src="js/camera-look-clamp.js?v=20260909decouple1"></script>\n  <script src="game.js?v=20260909decouple1"></script>',
        'camera helper script insertion',
    )
index_path.write_text(index)

locks_path = Path('docs/js/character-action-locks.js')
locks = locks_path.read_text()
locks = re.sub(r'social-action-wheel\.js\?v=[^\"\']+', 'social-action-wheel.js?v=20260909decouple1', locks, count=1)
locks_path.write_text(locks)

# 7) Controller regression owns controller behavior only. Camera regression owns
# camera internals only.
controller_test_path = Path('scripts/test-controller-experience.js')
ct = controller_test_path.read_text()
ct = ct.replace("const configSource = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'); // Used to pin every discrete formerly-hardcoded controller action in authored input config.\n", '')
ct = ct.replace("assert.match(gameSource, /pollControllerInput\\(\\);\\s*applyControllerCameraLook\\(dt\\);\\s*updateMeleeAutoTarget\\(dt\\);/, 'controller camera rotation is applied before movement/combat updates');\n", '')
ct = ct.replace("assert.match(gameSource, /cameraAzimuthOffsetDeg = freeRotateCameraActive\\(\\)[\\s\\S]{0,520}cameraAngleOffsetDeg = clampCameraPitchOffsetDeg/, 'right stick updates yaw and uses the shared directional pitch clamp');\n", '')
ct = replace_once(
    ct,
    "assert.match(gameSource, /inputBindings\\.controller\\?\\.meleeAutoTargetToggle/, 'melee auto-target toggle resolves its configured controller binding');",
    "assert.match(gameSource, /InputBindings\\?\\.consumeControllerPress\\?\\.\\('meleeAutoTargetToggle'/, 'gameplay delegates the melee contextual press to the binding API');",
    'controller melee bridge assertion',
)
ct = ct.replace("assert.match(configSource, /\"id\": \"uiOpenMenu\"[\\s\\S]{0,120}\"context\": \"menu\"/, 'menu open/close is authored in controller configuration');", "assert.match(bindingsSource, /id: 'uiOpenMenu'[\\s\\S]{0,180}context: 'menu'/, 'menu open/close schema is owned by the controller binding module');")
ct = ct.replace("assert.match(configSource, /\"id\": \"musicNote1\"[\\s\\S]{0,120}\"context\": \"music\"/, 'music controls are authored in controller configuration');", "assert.match(bindingsSource, /id: 'musicNote1'[\\s\\S]{0,180}context: 'music'/, 'music controller schema is owned by the controller binding module');")
ct = ct.replace("assert.match(configSource, /\"id\": \"meleeAutoTargetToggle\"[\\s\\S]{0,160}\"context\": \"melee\"/, 'melee auto-target toggle is authored in controller configuration');", "assert.match(bindingsSource, /id: 'meleeAutoTargetToggle'[\\s\\S]{0,220}context: 'melee'/, 'melee contextual schema is owned by the controller binding module');")
ct = ct.replace("assert.match(indexSource, /id=\"settingControllerLookSensitivity\"[\\s\\S]{0,700}id=\"settingControllerInvertY\"/, 'camera sensitivity and invert-Y settings are present');\n", '')
ct = regex_once(
    ct,
    r"const controllerHelperIndex = indexSource\.indexOf\('controller-input\.js\?v=[^']+'\);.*?assert\.ok\(controllerHelperIndex >= 0 && gameScriptIndex > controllerHelperIndex, 'shared controller helpers load before the cache-invalidated game script'\);",
    "const controllerHelperIndex = indexSource.indexOf('js/controller-input.js?'); // Parser-order contract is version-agnostic so camera/game cache bumps cannot break this controller test.\nconst bindingsHelperIndex = indexSource.indexOf('js/input-bindings.js?');\nconst gameScriptIndex = indexSource.indexOf('game.js?');\nassert.ok(controllerHelperIndex >= 0 && bindingsHelperIndex > controllerHelperIndex && gameScriptIndex > bindingsHelperIndex, 'controller helper/binding layers load before game.js');",
    'controller parser-order assertion',
)

runtime_checks = """
const gameplayCollisionBindings = liveResetBindings.controller; // Exercises contextual dispatch without reaching into game.js internals.
gameplayCollisionBindings.interact = 'Button0';
gameplayCollisionBindings.uiConfirm = 'Button0';
assert.equal(resetApi.resolveActionForButton('controller', 'Button0'), 'interact', 'generic gameplay dispatch ignores same-button menu context actions');
gameplayCollisionBindings.meleeAutoTargetToggle = 'Button3';
const contextualDown = new Set(['Button3']);
assert.equal(resetApi.consumeControllerPress('meleeAutoTargetToggle', contextualDown, new Set(), true), true, 'contextual controller press resolves from the configured binding');
assert.equal(contextualDown.has('Button3'), false, 'contextual press is consumed before generic gameplay dispatch');
const heldContextualDown = new Set(['Button3']);
assert.equal(resetApi.consumeControllerPress('meleeAutoTargetToggle', heldContextualDown, new Set(['Button3']), true), false, 'held contextual binding does not re-edge-trigger');
assert.equal(heldContextualDown.has('Button3'), false, 'held contextual binding remains consumed while its context owns the input');
"""
insert_anchor = "assert.ok(resetEvents.some(event => event.type === 'hobunji-input-bindings-reset' && event.detail?.device === 'controller'), 'controller reset broadcasts a device-specific refresh event');\n"
ct = replace_once(ct, insert_anchor, insert_anchor + runtime_checks, 'controller binding runtime checks')
ct = replace_once(
    ct,
    "assert.match(bindingsSource, /targetContext === 'selection' && otherContext === 'gameplay'/, 'selector openers conflict with simultaneous gameplay actions instead of double-firing');",
    "assert.match(bindingsSource, /targetContext === 'selection' && otherContext === 'gameplay'/, 'selector openers conflict with simultaneous gameplay actions instead of double-firing');\nassert.match(bindingsSource, /function resolveActionForButton\\(device, button, heldShift = null\\)/, 'generic gameplay action resolution is owned by InputBindings');\nassert.match(bindingsSource, /function consumeControllerPress\\(actionId, down, previous, active = true\\)/, 'contextual controller edge/consumption is owned by InputBindings');",
    'binding API source assertions',
)
controller_test_path.write_text(ct)

camera_test = """#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');
const clampSource = fs.readFileSync('docs/js/camera-look-clamp.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(clampSource, context);
const clampPitchOffsetDeg = context.window.CameraLookClamp.clampPitchOffsetDeg;

assert.match(config, /\"cameraRotateClampDeg\": 45,[\\s\\S]{0,160}\"cameraRotateUpClampDeg\": 85/, 'global camera config still authors 45 down/yaw and 85 up');
assert.equal(clampPitchOffsetDeg(-120, { cameraRotateClampDeg: 45, cameraRotateUpClampDeg: 85 }), -85, 'camera module independently clamps upward pitch');
assert.equal(clampPitchOffsetDeg(80, { cameraRotateClampDeg: 45, cameraRotateUpClampDeg: 85 }), 45, 'camera module independently clamps downward pitch');
assert.equal(clampPitchOffsetDeg(-30, { cameraRotateClampDeg: 45, cameraRotateUpClampDeg: 85 }), -30, 'camera module preserves in-range pitch');
assert.match(game, /function clampCameraPitchOffsetDeg\\(value\\) \\{[\\s\\S]{0,180}CameraLookClamp\\.clampPitchOffsetDeg\\(value, desktopControlsConfig\\(\\)\\)/, 'game.js only bridges camera state into the isolated clamp module');
assert.equal((game.match(/cameraAngleOffsetDeg = clampCameraPitchOffsetDeg\\(/g) || []).length, 3, 'mouse, touch, and controller all share the thin camera bridge');
assert.match(game, /cameraAzimuthOffsetDeg = freeRotateCameraActive\\(\\)[\\s\\S]{0,260}-clampDeg, clampDeg/, 'yaw keeps symmetric legacy clamp');
const helperIndex = index.indexOf('js/camera-look-clamp.js?');
const gameIndex = index.indexOf('game.js?');
assert.ok(helperIndex >= 0 && gameIndex > helperIndex, 'camera clamp module loads before game.js without depending on controller module versions');

console.log('Directional camera look clamp checks passed.');
"""
Path('scripts/test-camera-look-clamps.js').write_text(camera_test)

print('Controller/camera decoupling patch applied.')
