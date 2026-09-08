const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bridgePath = path.join(root, 'docs/js/prologue-startup-entry-bridge.js');
const locksPath = path.join(root, 'docs/js/character-action-locks.js');
const bridge = fs.readFileSync(bridgePath, 'utf8');
const locks = fs.readFileSync(locksPath, 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(locks.includes("prologue-startup-entry-bridge.js?v=20260907a"), 'character-action-locks must load the startup entry bridge');
expect(bridge.includes("Object.getOwnPropertyDescriptor(window, 'ActionArcUI')"), 'bridge must chain onto the existing ActionArcUI assignment hook');
expect(bridge.includes('_deps = injectedDeps || null'), 'bridge must capture the normal ActionArcUI.init dependency bundle');
expect(bridge.includes('_deps.enterZone(RESCUE_MAP_ID, RESCUE_ENTRY_COL, RESCUE_ENTRY_ROW)'), 'rescue fallback must use the real enterZone function');
expect(bridge.includes("const RESCUE_MAP_ID = 'map_prologue_rescue'"), 'rescue fallback must target the dedicated authored rescue map');
expect(bridge.includes('const RESCUE_ENTRY_COL = 12') && bridge.includes('const RESCUE_ENTRY_ROW = 12'), 'rescue fallback must spawn near the center of the enlarged 15x15 clearing');
expect(bridge.includes('scheduleAttempt(RESCUE_RETRY_MS)'), 'rescue fallback must retry if the authored zone layout is not ready yet');
expect(bridge.includes('controllerTransitionInFlight()'), 'bridge must defer when PrologueSystem already owns a transition');
expect(!bridge.includes('__hobunjiGameStarted !== true'), 'startup entry bridge must not depend on the unreliable game-started readiness gate');
expect(bridge.includes('window.PrologueStartupEntryBridge'), 'bridge must expose mobile-visible debug state');

console.log('Prologue startup entry regression passed.');
