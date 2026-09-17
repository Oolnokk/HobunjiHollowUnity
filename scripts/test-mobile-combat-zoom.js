#!/usr/bin/env node
'use strict';

// Regression for the Stage 2 RAF-ownership migration: mobile-combat-zoom.js
// used to own a permanent RAF that ran forever on desktop too (an empty,
// wasted callback every frame). It now registers once with the shared
// RuntimeFrameScheduler and is disabled outright on non-coarse-pointer
// viewports instead (see docs/architecture/runtime-frame-scheduler.md).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/mobile-combat-zoom.js', 'utf8');
assert(!source.includes('requestAnimationFrame('), 'mobile combat zoom must no longer own a direct requestAnimationFrame( call site');
assert(source.includes("window.RuntimeFrameScheduler.register(SCHEDULER_ID"), 'mobile combat zoom must register with the shared scheduler');
assert(source.includes("RuntimeFrameScheduler.setEnabled(SCHEDULER_ID, mobileQuery.matches)"), 'mobile combat zoom must flip its subscriber via setEnabled on pointer-type change');

function buildContext({ coarsePointer }) {
  const registered = new Map(); // id -> { fn, options }
  const setEnabledCalls = [];
  const dispatchedEvents = [];
  const mediaListeners = [];

  const zoomOptions = [
    { id: 'a', value: '1.25' },
    { id: 'b', value: '1.75' },
    { id: 'c', value: '2' },
  ];
  const select = {
    options: zoomOptions,
    value: null,
    appendChild(option) { zoomOptions.push(option); this.options = zoomOptions; },
    dispatchEvent(event) { dispatchedEvents.push(event); },
  };

  const context = {
    console,
    Math, Number, Array, Object, String,
    performance: { now: () => 0 },
    window: null,
    document: {
      getElementById(id) {
        if (id === 'settingZoom') return select;
        if (id === 'threeContainer') return { clientWidth: 1000, clientHeight: 500 };
        return null;
      },
      createElement() { return { style: {} }; },
    },
    THREE: {
      Vector3: class Vector3 {
        constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
        clone() { return new Vector3(this.x, this.y, this.z); }
        sub(o) { this.x -= o.x; this.y -= o.y; this.z -= o.z; return this; }
        add(o) { this.x += o.x; this.y += o.y; this.z += o.z; return this; }
        multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
        normalize() { const len = Math.hypot(this.x, this.y, this.z) || 1; this.x /= len; this.y /= len; this.z /= len; return this; }
        lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
        dot(o) { return this.x * o.x + this.y * o.y + this.z * o.z; }
        crossVectors(a, b) {
          this.x = a.y * b.z - a.z * b.y;
          this.y = a.z * b.x - a.x * b.z;
          this.z = a.x * b.y - a.y * b.x;
          return this;
        }
      },
      MathUtils: { degToRad: deg => deg * Math.PI / 180 },
    },
    Event: class Event { constructor(type, opts) { this.type = type; this.opts = opts; } },
    matchMedia(query) {
      const mql = {
        matches: coarsePointer,
        addEventListener(type, fn) { mediaListeners.push({ query, type, fn }); },
      };
      return mql;
    },
  };
  context.window = context;
  context.RuntimeFrameScheduler = {
    register(id, fn, options) { registered.set(id, { fn, options }); },
    setEnabled(id, enabled) { setEnabledCalls.push({ id, enabled }); const r = registered.get(id); if (r) r.options.enabled = enabled; },
  };
  context.Combat = { deps: { getCurrentArea: () => 'zone', hostileObjects: [] } };
  context.__hobunjiGameStarted = true;
  context.__climbDebug = {
    getCameraDebug: () => ({ camPos: { x: 0, y: 5, z: 10 }, camTarget: { x: 0, y: 0, z: 0 } }),
    isPaused: () => false,
    isMenuOpen: () => false,
    isDialogueOpen: () => false,
  };
  context.WorldPopupText = { avatarCentroidWorld: () => new context.THREE.Vector3(0, 1, 0) };
  context.SCRATCHBONES_CONFIG = { game: { camera: { defaultMode: 'default', modes: { default: { fovDeg: 42 } } } } };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'mobile-combat-zoom.js' });
  return { context, registered, setEnabledCalls, dispatchedEvents, mediaListeners, select };
}

// Case 1: desktop (fine pointer) — the subscriber registers but starts disabled,
// matching "disable outright" rather than "run an empty callback forever".
{
  const { registered } = buildContext({ coarsePointer: false });
  const entry = registered.get('mobile-combat-zoom');
  assert(entry, 'registers with the scheduler even on desktop');
  assert.equal(entry.options.enabled, false, 'starts disabled on a fine-pointer (desktop) viewport');
  assert.equal(entry.options.owner, 'MobileCombatZoom');
}

// Case 2: mobile (coarse pointer) — starts enabled, and the scheduled frame
// reproduces the original frame()'s behavior: dependenciesReady gate,
// one-time initialization to the out-of-combat zoom, and the scan-interval
// throttle around solveTargetZoom().
{
  const { context, registered, select } = buildContext({ coarsePointer: true });
  const entry = registered.get('mobile-combat-zoom');
  assert.equal(entry.options.enabled, true, 'starts enabled on a coarse-pointer (mobile) viewport');

  const scheduledFrame = entry.fn;
  scheduledFrame({ timestamp: 0 });
  assert.equal(context.MobileCombatZoom.getState().active, true, 'first scheduled frame initializes to the mobile default zoom');
  assert.equal(context.MobileCombatZoom.getState().currentZoom, 2.0, 'initializes to the 200% out-of-combat zoom');
  assert(select.value, 'applyZoom actually drove the settings zoom select on first frame');

  // No hostiles -> target stays at the out-of-combat zoom; lerp keeps it there.
  scheduledFrame({ timestamp: 16 });
  assert.equal(context.MobileCombatZoom.getState().targetZoom, 2.0, 'stays at out-of-combat zoom with no hostiles present');

  // A close hostile pulls target zoom toward combat framing once the scan fires.
  context.Combat.deps.hostileObjects = [{
    health: 10, areaId: 'zone', avatarRef: { group: { parent: {} } },
  }];
  scheduledFrame({ timestamp: 100 }); // >= SCAN_INTERVAL_MS (70) since the previous scan at t=0.
  assert(context.MobileCombatZoom.getState().targetZoom < 2.0, 'a relevant nearby hostile narrows the target zoom toward combat framing');
  assert.equal(context.MobileCombatZoom.getState().influencingHostiles, 1, 'the hostile is counted as influencing framing');
}

// Case 3: menu/dialogue suspension must be preserved exactly — zoom freezes
// and the next scan is forced immediate once suspension ends.
{
  const { context, registered } = buildContext({ coarsePointer: true });
  const scheduledFrame = registered.get('mobile-combat-zoom').fn;
  scheduledFrame({ timestamp: 0 });
  context.__climbDebug.isMenuOpen = () => true;
  const before = context.MobileCombatZoom.getState().currentZoom;
  scheduledFrame({ timestamp: 200 });
  assert.equal(context.MobileCombatZoom.getState().currentZoom, before, 'zoom stays frozen while a menu suspends automatic framing');
  assert.equal(context.MobileCombatZoom.getState().influencingHostiles, 0, 'suspension clears the influencing-hostiles debug count');
}

// Case 4: the matchMedia 'change' listener flips the scheduler's enabled
// state live instead of the subscriber checking isMobileViewport() itself
// every frame.
{
  const { mediaListeners, setEnabledCalls } = buildContext({ coarsePointer: false });
  assert.equal(mediaListeners.length, 1, 'listens for one pointer-type change event');
  mediaListeners[0].fn(); // Simulates the media query flipping to coarse.
  // The stub matchMedia always returns the same `matches` value it was
  // constructed with, so this call proves the listener at least reaches
  // setEnabled with the query's current .matches value.
  assert.equal(setEnabledCalls.length, 1, 'the change handler calls RuntimeFrameScheduler.setEnabled exactly once');
  assert.equal(setEnabledCalls[0].id, 'mobile-combat-zoom');
}

console.log('mobile combat zoom scheduler migration passed');
