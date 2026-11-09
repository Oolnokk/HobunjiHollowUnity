'use strict';
// The full rig dump must report every node root-relative in a floor-anchored,
// UNSCALED pose frame (so game hostiles, the player, the Enemy Loadout Workshop
// and the Attack Animation Editor are directly diffable), find hands/feet by
// role, and surface real differences in its diff.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Minimal THREE stand-ins: column-major Matrix4 with the operations the dump uses.
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
class Q { constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; } }
class M4 {
  constructor() { this.e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  copy(m) { this.e = m.e.slice(); return this; }
  multiply(m) { const a = this.e, b = m.e, r = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let rI = 0; rI < 4; rI++) for (let k = 0; k < 4; k++) r[c * 4 + rI] += a[k * 4 + rI] * b[c * 4 + k]; this.e = r; return this; }
  invert() { const n = 4, a = []; for (let r = 0; r < n; r++) { a.push([]); for (let c = 0; c < n; c++) a[r].push(this.e[c * 4 + r]); for (let c = 0; c < n; c++) a[r].push(r === c ? 1 : 0); }
    for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r; [a[i], a[p]] = [a[p], a[i]]; const d = a[i][i]; for (let c = 0; c < 2 * n; c++) a[i][c] /= d; for (let r = 0; r < n; r++) if (r !== i) { const f = a[r][i]; for (let c = 0; c < 2 * n; c++) a[r][c] -= f * a[i][c]; } }
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) this.e[c * 4 + r] = a[r][n + c]; return this; }
  decompose(p, q, s) { const e = this.e; p.set(e[12], e[13], e[14]); const sx = Math.hypot(e[0], e[1], e[2]), sy = Math.hypot(e[4], e[5], e[6]), sz = Math.hypot(e[8], e[9], e[10]); s.set(sx, sy, sz);
    const m11 = e[0] / sx, m12 = e[4] / sy, m13 = e[8] / sz, m21 = e[1] / sx, m22 = e[5] / sy, m23 = e[9] / sz, m31 = e[2] / sx, m32 = e[6] / sy, m33 = e[10] / sz;
    const tr = m11 + m22 + m33; let x, y, z, w;
    if (tr > 0) { const k = 0.5 / Math.sqrt(tr + 1); w = 0.25 / k; x = (m32 - m23) * k; y = (m13 - m31) * k; z = (m21 - m12) * k; }
    else if (m11 > m22 && m11 > m33) { const k = 2 * Math.sqrt(1 + m11 - m22 - m33); w = (m32 - m23) / k; x = 0.25 * k; y = (m12 + m21) / k; z = (m13 + m31) / k; }
    else if (m22 > m33) { const k = 2 * Math.sqrt(1 + m22 - m11 - m33); w = (m13 - m31) / k; x = (m12 + m21) / k; y = 0.25 * k; z = (m23 + m32) / k; }
    else { const k = 2 * Math.sqrt(1 + m33 - m11 - m22); w = (m21 - m12) / k; x = (m13 + m31) / k; y = (m23 + m32) / k; z = 0.25 * k; }
    q.x = x; q.y = y; q.z = z; q.w = w; return this; }
}
class Node {
  constructor(name = '') { this.name = name; this.isObject3D = true; this.type = 'Object3D'; this.visible = true; this.children = []; this.parent = null;
    this.position = new V3(); this.quaternion = new Q(); this.scale = new V3(1, 1, 1); this.rotation = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.rotation.x = x; this.rotation.y = y; this.rotation.z = z; this.quaternion = new Q(0, Math.sin(y / 2), 0, Math.cos(y / 2)); } };
    this.matrixWorld = new M4(); }
  add(c) { c.parent = this; this.children.push(c); return c; }
  local() { const m = new M4(), q = this.quaternion, s = this.scale, p = this.position; const { x, y, z, w } = q;
    m.e = [(1 - 2 * (y * y + z * z)) * s.x, 2 * (x * y + z * w) * s.x, 2 * (x * z - y * w) * s.x, 0, 2 * (x * y - z * w) * s.y, (1 - 2 * (x * x + z * z)) * s.y, 2 * (y * z + x * w) * s.y, 0, 2 * (x * z + y * w) * s.z, 2 * (y * z - x * w) * s.z, (1 - 2 * (x * x + y * y)) * s.z, 0, p.x, p.y, p.z, 1]; return m; }
  updateWorldMatrix() { const chain = []; for (let n = this; n; n = n.parent) chain.unshift(n); const m = new M4(); for (const n of chain) m.multiply(n.local()); this.matrixWorld = m; }
  updateMatrixWorld() { this.updateWorldMatrix(); }
  traverse(visit) { visit(this); for (const c of this.children) c.traverse(visit); }
}
const win = { console };
win.window = win;
vm.createContext(win);
vm.runInContext(fs.readFileSync('docs/js/transform-dump-utils.js', 'utf8'), win);
vm.runInContext(fs.readFileSync('docs/js/rig-transform-dump.js', 'utf8'), win);
const api = win.HobunjiRigDump;
const near = (a, b, label, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${label}: ${a} vs ${b}`);

// Character body scaled 2x in Y under a floor frame yawed 90 degrees; a hand deep in the tree.
function build(yScale, handLocalX) {
  const world = new Node('scene');
  const body = world.add(new Node('player_root'));
  body.position.set(5, 0, 7); body.rotation.set(0, Math.PI / 2, 0); body.scale.set(1, yScale, 1);
  const hand = body.add(new Node('player_avatar_procedural_hands')).add(new Node('right_hand_socket')).add(new Node('right_hand_visual'));
  hand.position.set(handLocalX, 0.3, 0);
  const holder = world.add(new Node('banditToolHolder'));
  holder.position.set(5, 0.5, 6.7);
  const plane = holder.add(new Node('grip_marker')); plane.type = 'Mesh'; plane.isMesh = true; plane.geometry = { type: 'SphereGeometry' };
  const sprite = holder.add(new Node('sprite')); sprite.type = 'Mesh'; sprite.isMesh = true; sprite.geometry = { type: 'PlaneGeometry', parameters: { width: 0.5, height: 1.3 } };
  const frame = api.makeFrame(body, { x: 5, y: 0, z: 7 }, Math.PI / 2);
  return { body, hand, holder, sprite, frame };
}
const a = build(2, 0.4);
const dump = api.capture({ label: 'a', species: 'mashtzarr', gender: 'male', frame: a.frame, trees: [{ label: 'body', root: a.body }, { label: 'tool', root: a.holder }], anchors: { 'tool.holder': a.holder, 'tool.visual': api.firstMesh(a.holder) } });
assert.ok(dump, 'capture returns a dump');

// Root-relative is in the UNSCALED floor frame: the hand's local X (0.4) maps to the frame's +X even though
// the body is rotated 90 degrees and scaled 2x in Y; its local Y (0.3) becomes 0.6 (scaled once).
const hand = dump.anchors['hand.right'];
assert.ok(hand, 'hands are found by role without the caller naming them');
near(hand.root.position.x, 0.4, 'hand root x'); near(hand.root.position.y, 0.6, 'hand root y (scaled once)'); near(hand.root.position.z, 0, 'hand root z');
near(hand.root.scale.y, 2, 'hand inherited scale'); near(hand.world.position.x, 5, 'hand world x (body is at x=5, local +X points along -Z)', 1e-2);

// A scene-level sibling (the weapon holder) is reported in the same frame: holder at world (5,0.5,6.7) is
// 0.3 along the frame's -Z... frame +Z = world (sin 90, cos 90) = +X, so z_root = world dx.
near(dump.anchors['tool.holder'].root.position.y, 0.5, 'holder root y');
near(dump.anchors['tool.holder'].root.position.x, 0.3, 'holder root x: -dz in this yawed frame', 1e-2);
assert.equal(dump.anchors['tool.visual'].geometry.type, 'PlaneGeometry', 'weapon anchor is the sprite plane, not the grip marker sphere');

// Diff: identical rigs match; a body scaled differently (hand lifted) is reported with the right delta.
const same = api.diff(dump, api.capture({ label: 'b', frame: a.frame, trees: [{ label: 'body', root: a.body }, { label: 'tool', root: a.holder }], anchors: { 'tool.holder': a.holder, 'tool.visual': api.firstMesh(a.holder) } }));
assert.ok(same.rows.every(row => !row.differs), 'identical rigs produce no differences');
const b = build(2.5, 0.4);
const other = api.capture({ label: 'b', frame: b.frame, trees: [{ label: 'body', root: b.body }, { label: 'tool', root: b.holder }], anchors: { 'tool.holder': b.holder } });
const diff = api.diff(dump, other);
const handRow = diff.rows.find(row => row.key === 'hand.right');
assert.ok(handRow.differs, 'a taller body moves the hand');
near(handRow.delta.y, 0.3 * 2 - 0.3 * 2.5, 'hand y delta = first - second');
assert.ok(diff.rows.find(row => row.key === 'tool.visual').missing === 'second', 'an anchor present on one side only is reported missing');
assert.match(api.formatDiff(diff), /hand\.right\s+DIFF/, 'formatted diff names the differing anchor');
assert.match(api.formatText(dump), /--- anchors \(root-relative\) ---/, 'text report has the anchor table');

// Wiring: every preview that can be diffed loads the module and exposes a dump button.
for (const [file, needles] of [
  ['docs/index.html', ['js/rig-transform-dump.js', 'debugFullRigDumpBtn']],
  ['docs/tools/attack-animation-editor/index.html', ['js/rig-transform-dump.js', 'fullRigDumpBtn', 'compareRigDumpBtn']],
  ['docs/tools/enemy-loadout-editor/index.html', ['dumpRigBtn']],
  ['docs/tools/enemy-loadout-editor/preview.js', ['js/rig-transform-dump.js', 'js/character-dimensions.js']],
]) {
  const text = fs.readFileSync(file, 'utf8');
  for (const needle of needles) assert.ok(text.includes(needle), `${file} wires ${needle}`);
}

console.log('Rig transform dump: root-relative frame, role anchors, plane-mesh anchor, diff, and wiring in game / editor / workshop');
