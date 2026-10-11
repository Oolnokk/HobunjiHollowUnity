'use strict';
const assert = require('node:assert/strict'); // Validates real arch handlers below.
const fs = require('node:fs'); // Loads the production gesture owner.
const vm = require('node:vm'); // Executes the handlers without booting WebGL.
const source = fs.readFileSync('docs/game.js', 'utf8'); // Current runtime, never a copied implementation.
const start = source.indexOf('            el._abtDragInit = true;'); // Handler setup inside applyAbt.
const end = source.indexOf("            el.addEventListener('pointercancel', _abtUp);", start); // Last setup statement.
assert(start >= 0 && end > start);
const handlers = source.slice(start, end + "            el.addEventListener('pointercancel', _abtUp);".length); // Executed production setup.
function surface() {
  const listeners = new Map(); // Event callbacks keyed by type and capture phase.
  return {
    style: {}, dataset: {}, id: 'btnAction1',
    classList: { contains: () => false, add() {}, remove() {} },
    addEventListener(type, fn, options) {
      const capture = options === true || options?.capture === true; // Native listener identity includes capture.
      listeners.set(`${type}:${capture}`, fn);
    },
    removeEventListener(type, fn, options) {
      const key = `${type}:${options === true || options?.capture === true}`; // Removal must match the active registration.
      if (listeners.get(key) === fn) listeners.delete(key);
    },
    emit(type, event = {}) {
      event.type = type;
      for (const [key, fn] of [...listeners]) if (key.startsWith(type + ':')) fn(event);
    },
    listenerCount: () => listeners.size,
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 60, height: 60 }),
    setPointerCapture() { throw new Error('capture unavailable'); },
    remove() {},
  };
}
function setup(action = 'cut', tool = 'weapon', claimed = false) {
  const el = surface(), win = surface(), doc = surface(); // Separate UI and global event surfaces exercise capture fallback.
  const calls = []; // Ordered action callbacks distinguish attacks from cancellation.
  el.dataset.action = action;
  doc.body = { appendChild() {} };
  doc.createElement = surface;
  doc.getElementById = surface;
  doc.querySelectorAll = () => [];
  Object.assign(win, {
    Combat: { input: { pressStart: () => calls.push('press'), pressEnd: () => calls.push('release'), abortPress: () => calls.push('abort'), fireTap: () => calls.push('tap') } },
    HeldItemActionInput: { release: () => calls.push('item-release'), abort: () => calls.push('item-abort') },
    AlchemyFlasks: { aiming: true, setTargetFromVector() {}, cancelAim: () => calls.push('flask-cancel'), confirmThrow: () => calls.push('flask-throw') },
  });
  const ctx = { // Dependencies read by the actual production arch setup.
    el, window: win, document: doc, activeTool: tool, heldMode: 'tool', activeAction: null,
    actionHeldDown: false, mobileArchDragPointerId: null, mobileArchDragAngle: null,
    mobileArchCombatAim: null, toolActions: { weapon: ['cut', 'slash'] }, toolSwingT: 0,
    facingAngle: 0, targetAimAngle: 0, lastMoveAngle: 0, player: { angle: 0 },
    setTimeout: () => 1, clearTimeout() {}, clearInterval() {}, setInterval: () => 1,
    dispatchWorldInputClaim: (action, phase) => { calls.push(`claim:${phase}`); return claimed; },
    wouldStartCharge: () => false, isHoldToCommitAction: () => action === 'consume_held_item', beginHeldItemActionDescriptor: () => true,
    useActiveAction: () => calls.push('fire'), commitMeleeAttackFacing: () => calls.push('commit'),
    setMobileArchCombatAim: (pointerId, angle) => { ctx.mobileArchCombatAim = { pointerId, angle }; },
    clearMobileArchCombatAim: () => { ctx.mobileArchCombatAim = null; }, releaseMobileArchCombatAim() {},
    npcDialogueAction: () => 'talk', smithyAction: () => 'smithy', generalStoreAction: () => 'shop', carpenterAction: () => 'carpenter',
  };
  vm.createContext(ctx);
  vm.runInContext(handlers, ctx);
  return { ctx, el, win, doc, calls };
}
function event(pointerId, x, y) {
  return { pointerId, clientX: x, clientY: y, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
}
const melee = setup(); // Off-center press is deliberate; stationary jitter must not select a direction.
const down = event(7, 152, 130);
melee.el.emit('pointerdown', down);
assert(down.stopped && down.prevented);
melee.win.emit('pointermove', event(7, 153, 130));
assert.equal(melee.ctx.mobileArchDragAngle, null, 'edge press plus jitter is not an intentional drag');
const otherFinger = event(8, 190, 130); // Movement/camera finger must remain independently usable.
melee.win.emit('pointermove', otherFinger);
assert.equal(otherFinger.stopped, false);
const drag = event(7, 152, 180); // World direction derives from finger travel, not the button center.
melee.win.emit('pointermove', drag);
assert.equal(melee.ctx.mobileArchDragAngle, Math.PI / 2);
assert(drag.prevented && drag.stopped);
assert(!melee.calls.includes('release') && !melee.calls.includes('tap'));
melee.win.emit('pointerup', event(7, 152, 180));
assert.deepEqual(melee.calls.filter(c => c !== 'claim:press'), ['press', 'commit', 'release']);
assert.equal(melee.ctx.mobileArchDragPointerId, null);
assert.equal(melee.ctx.mobileArchDragAngle, null);
assert.equal(melee.win.listenerCount(), 0, 'temporary fallback listeners are removed');
melee.el.emit('lostpointercapture', event(7, 152, 180));
assert.equal(melee.calls.filter(c => c === 'release').length, 1);
for (const loss of ['pointercancel', 'lostpointercapture', 'blur', 'visibilitychange']) {
  const held = setup(); // Each ownership-loss path must abort a melee hold.
  held.el.emit('pointerdown', event(1, 130, 130));
  held.win.emit('pointermove', event(1, 160, 130));
  if (loss === 'lostpointercapture') held.el.emit(loss, event(1, 160, 130));
  else if (loss === 'visibilitychange') { held.doc.hidden = true; held.doc.emit(loss); }
  else held.win.emit(loss, event(1, 160, 130));
  assert(held.calls.includes('abort'), loss);
  assert(!held.calls.includes('release'), loss);
  assert.equal(held.ctx.mobileArchDragPointerId, null, loss);
}
const claim = setup('cut', 'weapon', true); // Context claims remain the authority even when dragged.
claim.el.emit('pointerdown', event(1, 130, 130));
claim.win.emit('pointermove', event(1, 190, 130));
assert.equal(claim.ctx.mobileArchDragAngle, null);
claim.win.emit('pointerup', event(1, 190, 130));
assert.deepEqual(claim.calls, ['claim:press', 'claim:release']);
for (const [action, canceled, expected] of [
  ['consume_held_item', true, 'item-abort'], ['consume_held_item', false, 'item-release'],
  ['alchemy_flask_primary', true, 'flask-cancel'], ['alchemy_flask_primary', false, 'flask-throw'],
  ['shoot', true, null], ['shoot', false, 'fire'],
]) {
  const held = setup(action, 'ranged'); // Consumables, flasks and shots share pointer cleanup without changing release semantics.
  held.el.emit('pointerdown', event(2, 130, 130));
  held.win.emit('pointermove', event(2, 170, 130));
  held.win.emit(canceled ? 'pointercancel' : 'pointerup', event(2, 170, 130));
  const actions = held.calls.filter(c => !c.startsWith('claim:')); // Claim probing does not represent gameplay effects.
  assert.deepEqual(actions, expected ? [expected] : []);
}
const cameraContext = { mobileArchDragPointerId: 5, window: { innerWidth: 400 } }; // Execute the actual camera input gate.
vm.createContext(cameraContext);
vm.runInContext(source.slice(source.indexOf('      function cameraDragRequested('), source.indexOf('      function hideCameraJoystick(')), cameraContext);
assert.equal(cameraContext.cameraDragRequested({ pointerId: 5, pointerType: 'touch', clientX: 300 }), false);
assert.equal(cameraContext.cameraDragRequested({ pointerId: 6, pointerType: 'touch', clientX: 300, target: { closest: () => ({}) } }), false);
assert.equal(cameraContext.cameraDragRequested({ pointerId: 6, pointerType: 'touch', clientX: 300 }), true);
console.log('Mobile arch pointer ownership, capture fallback, aim and cancellation passed.');
