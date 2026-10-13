#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function runModule(path, extra = {}) {
  const sandbox = {
    window: {}, console, setTimeout, clearTimeout, setInterval, clearInterval,
    performance, Math, Number, Object, Array, Map, Set, WeakSet, Uint8Array,
    ...extra,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path, 'utf8'), sandbox, { filename: path });
  return sandbox;
}

const calendar = runModule('docs/js/calendar-system.js', {
  THREE: { Color: class Color { setHSL(){ return this; } } },
});
assert.equal(calendar.window.CalendarSystem.isInitialized(), false, 'calendar should begin uninitialized');
assert.equal(calendar.window.CalendarSystem.getHour(), 6, 'pre-init clock read should safely resolve to opening hour');
assert.equal(calendar.window.CalendarSystem.currentSeason().name, 'Stormtide', 'pre-init season read should use deterministic opening-day placeholder');
const timeDebug = calendar.window.CalendarSystem.timeDebugSnapshot();
assert.equal(timeDebug.initialized, false, 'pre-init time debug should explicitly report not-ready state');
assert.equal(timeDebug.rawDay, null, 'pre-init time debug should not invent live save state');
assert.equal(timeDebug.nextTothalShiftRawDay, null, 'pre-init time debug must not call shift math through null deps');

const wilderness = runModule('docs/js/wilderness-map.js');
assert.equal(wilderness.window.WildernessMap.getCompassWaypoint(), null, 'pre-init wilderness map should expose no waypoint instead of dereferencing null deps');

const hud = runModule('docs/js/hud-update.js');
assert.equal(hud.window.HudUpdate.contextualActionLabel('dig', { type: 'grass' }), 'Dig', 'pre-init dig label should fall back safely');
assert.equal(hud.window.HudUpdate.contextualActionLabel('raise', { type: 'grass' }), 'Raise', 'pre-init raise label should fall back safely');
assert.equal(hud.window.HudUpdate.contextualActionLabel('till', { type: 'grass' }), 'Till', 'pre-init till label should fall back safely');

console.log('startup init guards: ok');
