'use strict';

// Exercise the *shipped* replay-scissor projection with an invisible dual-wield
// source plane, visible displaced child blades, and live aura overdraw. This
// catches clipping that pooling-only VFX tests cannot detect.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'held-object-render-order.js'), 'utf8'); // Used to execute the production projection logic rather than a reimplementation.
const start = rendererSource.indexOf('  function replayScissorRect('); // Used to find the existing held replay projection contract.
const end = rendererSource.indexOf('  function restoreRendererScissor(', start); // Used to exclude unrelated WebGL state operations.
assert(start >= 0 && end > start, 'the production held-overlay scissor function exists');
const rectSource = rendererSource.slice(start, end); // Used by the isolated geometry-only projection harness.

const point = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } }); // Vector3 subset.
class Box {
  constructor() { this.min = point(); this.max = point(); }
  copy(box) { this.min = point(box.min.x, box.min.y, box.min.z); this.max = point(box.max.x, box.max.y, box.max.z); return this; }
  applyMatrix4(m) {
    for (const axis of ['x', 'y', 'z']) {
      this.min[axis] += m[axis] || 0;
      this.max[axis] += m[axis] || 0;
    }
    return this;
  }
  expandByScalar(padding) {
    for (const axis of ['x', 'y', 'z']) {
      this.min[axis] -= padding;
      this.max[axis] += padding;
    }
    return this;
  }
}
class Vector {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 0; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  applyMatrix4(matrix) {
    this.x += matrix.x || 0;
    this.y += matrix.y || 0;
    this.z += matrix.z || 0;
    return this;
  }
}
const extentStart = rendererSource.indexOf('  function spriteWorldExtent('); // The shipped billboard extent used for gear particles.
const extentSource = rendererSource.slice(extentStart, rendererSource.indexOf('  // Hides every gear particle', extentStart));
assert(extentStart > 0 && extentSource.length > 0, 'the production sprite extent function exists');
const projection = new Function('scissorDrawingSize', 'scissorViewport', 'scissorBox', 'scissorCorner', 'SCISSOR_MARGIN_PX', 'needsParticleBounds', // Projection scratch belongs to the real held renderer.
  'let scissorTargetWidth = 0, scissorTargetHeight = 0, lastReplayScissorCoverage = 1;\n' +
  extentSource + rectSource + '\nreturn replayScissorRect;'
)(new Vector(), new Vector(), new Box(), new Vector(), 4, child => child.drawnOnlyInReplay === true); // Which particles need bounds: test-held-gear-particles-once.js.
const renderer = {
  getRenderTarget: () => null,
  getDrawingBufferSize: out => out.set(1000, 1000, 0, 0),
  getCurrentViewport: out => out.set(0, 0, 1000, 1000),
};
const camera = { isOrthographicCamera: true, projectionMatrix: {}, matrixWorldInverse: {}, near: 0.1 }; // Identity orthographic projection maps local XY [-1,1] to the framebuffer.

function mesh(name, x, y, padding = 0, visible = true) {
  return {
    name, visible, isMesh: true,
    geometry: { boundingBox: { min: { x: -0.05, y: -0.05, z: -0.001 }, max: { x: 0.05, y: 0.05, z: 0.001 }, isEmpty: () => false } },
    matrixWorld: { x, y, z: 0, getMaxScaleOnAxis: () => 1 },
    userData: { hobunjiHeldOverlayVfxPadding: padding },
    children: [],
    traverseVisible(fn) {
      if (!this.visible) return;
      fn(this);
      for (const child of this.children) child.traverseVisible(fn);
    },
  };
}
const source = mesh('invisible source blade', 0, 0); // The source mesh belongs to the held-object registry even when its *material* is hidden.
const main = mesh('main duplicate', 0.65, 0, 0.3); // A live main-hand aura extends outside the source blade.
const off = mesh('offhand duplicate', -0.6, 0.2, 0.28); // Used to verify the left extreme is also included.
source.children.push(main, off);
const rect = new Vector(); // Used to inspect the actual projected scissor bounds from the production function.
assert.strictEqual(projection(renderer, camera, [source], rect), true);
assert(rect.x < 150, 'offhand aura must expand the scissor to the left of the hidden source blade');
assert(rect.x + rect.z > 900, 'main-hand aura must expand the scissor to the right of the hidden source blade');
assert(rect.y + rect.w > 730, 'offset offhand aura must extend the scissor vertically');

off.visible = false; // The hidden offhand copy must not enlarge replay coverage.
assert.strictEqual(projection(renderer, camera, [source], rect), true);
assert(rect.x > 450, 'hiding the offhand must remove its stale left-hand scissor enlargement');
off.visible = true;
main.userData.hobunjiHeldOverlayVfxPadding = 0; // Retired particles should not enlarge the replay rectangle.
off.userData.hobunjiHeldOverlayVfxPadding = 0;
assert.strictEqual(projection(renderer, camera, [source], rect), true);
assert(rect.x > 450 && rect.x + rect.z < 550, 'without live child particles the overlay should remain the original small rectangle');
// Dungeon Fire has a much taller world-up plume; it needs its own replay padding so ordinary
// enchantment particle updates cannot overwrite its clipping bounds.
main.userData.hobunjiDungeonFireVfxPadding = 0.75; // Independent live plume size for the player-held weapon.
assert.strictEqual(projection(renderer, camera, [source], rect), true);
assert(rect.x > 450 && rect.x + rect.z > 900 && rect.y + rect.w > 850,
  'world-up Dungeon Fire extends above the blade without widening the replay over the whole screen');
main.userData.hobunjiDungeonFireVfxPadding = 0; // Extinguishing Dungeon Fire must restore the original scissor budget.
assert.strictEqual(projection(renderer, camera, [source], rect), true);
assert(rect.x > 450 && rect.x + rect.z < 550,
  'extinguished Dungeon Fire does not permanently enlarge held-object scissoring');
// A gear particle the base pass no longer draws (a torch or flail flame rising past its weapon, no aura
// padding) is drawn only inside this scissor, so its billboard extent must be inside it too.
const flame = {
  name: 'torch flame', visible: true, isSprite: true, drawnOnlyInReplay: true, children: [], userData: {},
  matrixWorld: { elements: [0.05, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 1, 0, 0, 0.8, 0, 1] }, // 0.05-wide sprite 0.8 above the blade.
  traverseVisible(fn) { if (this.visible) fn(this); },
};
source.children.push(flame);
assert.strictEqual(projection(renderer, camera, [source], rect), true);
assert(rect.y + rect.w > 930, 'the flame\'s whole billboard (0.8 + its rotated half-diagonal) is inside the scissor');
assert(rect.x > 450 && rect.x + rect.z < 550, 'without widening it sideways');
flame.drawnOnlyInReplay = false; // Particles that still draw in the unclipped base pass do not enlarge the replay.
assert.strictEqual(projection(renderer, camera, [source], rect), true);
assert(rect.y + rect.w < 550, 'a base-pass particle leaves the scissor at the blade');
source.children.pop();
console.log('enchantment aura held-overlay bounds tests passed');
