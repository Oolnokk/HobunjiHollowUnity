'use strict';
// Regression: while dual wield is active (the player's normal state) enchantmentTargets() redirected EVERY
// source target to a dual-wield clone. Dual wield only clones the held plane and its direct-child overlay
// layers, so a flail head's layers (parented under their own head rig) found no clone and the target list
// came back empty: no enchantment motes on any flail. Run: node scripts/test-weapon-enchantment-targets-dual-wield.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/weapon-sprite-assemblies.js', 'utf8');
const registry = fs.readFileSync('docs/config/weapon-sprite-assemblies.js', 'utf8');
const window = { RuntimeFrameScheduler: { register() {} } };
vm.runInNewContext(registry, { window });
vm.runInNewContext(source, {
  window, document: { currentScript: { src: 'https://example.test/js/weapon-sprite-assemblies.js' } }, URL,
  setTimeout: () => {}, performance: { now: () => 100 },
  location: { href: 'https://example.test/game.html', pathname: '/game.html' },
});
const api = window.HobunjiWeaponSpriteAssemblies;
assert.equal(typeof api.dualWieldEnchantmentTargets, 'function', 'the pure dual-wield target selector is exported');

class Node {
  constructor(name, userData = {}) { this.name = name; this.userData = userData; this.children = []; this.parent = null; }
  add(child) { child.parent = this; this.children.push(child); return child; }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
}
const mask = n => ({ indices: Uint32Array.from([n]), matchedMetalPixels: 1 });

// --- A flail: the held plane has dual-wield roots; the head layers hang off a separate head rig. ---
{
  const root = new Node('root');
  const plane = root.add(new Node('plane'));
  const mainRoot = plane.add(new Node('dual_wield_main_root'));
  mainRoot.add(new Node('dual_wield_main_weapon', { hobunjiDualWieldDuplicate: true }));
  const offRoot = plane.add(new Node('dual_wield_off_root'));
  offRoot.add(new Node('dual_wield_off_weapon', { hobunjiDualWieldDuplicate: true }));
  const headRoot = root.add(new Node('flail_head'));
  const parts = ['back', 'handle', 'front'].map(id => headRoot.add(new Node(id)));
  const targets = parts.map((part, i) => ({ plane: part, mask: mask(i) }));
  const result = api.dualWieldEnchantmentTargets(plane, targets);
  assert.equal(result.length, 3, 'every visible flail head layer still emits while dual wield is active');
  assert.deepEqual([...result.map(t => t.plane.name)], ['back', 'handle', 'front'], 'head layers keep their own source meshes');
}

// --- A static layered weapon: base plane + a direct-child overlay, both cloned for main and off hand. ---
{
  const plane = new Node('plane');
  const overlay = plane.add(new Node('overlay', { hobunjiWeaponAssemblyPart: true }));
  const mainRoot = plane.add(new Node('dual_wield_main_root'));
  const offRoot = plane.add(new Node('dual_wield_off_root'));
  const mainBase = mainRoot.add(new Node('main_base', { hobunjiDualWieldDuplicate: true }));
  const offBase = offRoot.add(new Node('off_base', { hobunjiDualWieldDuplicate: true }));
  const mainOverlay = mainBase.add(new Node('main_overlay', { hobunjiDualWeaponSourceLayer: overlay }));
  const offOverlay = offBase.add(new Node('off_overlay', { hobunjiDualWeaponSourceLayer: overlay }));
  const result = api.dualWieldEnchantmentTargets(plane, [{ plane, mask: mask(1) }, { plane: overlay, mask: mask(2) }]);
  const planes = new Set(result.map(t => t.plane));
  assert.equal(result.length, 4, 'base and overlay each emit from both visible copies');
  assert(planes.has(mainBase) && planes.has(offBase) && planes.has(mainOverlay) && planes.has(offOverlay));
  assert(!planes.has(plane) && !planes.has(overlay), 'hidden source layers never emit while their clones exist');
}

// --- An overlay whose clones have not been built yet must not fall back to the hidden source. ---
{
  const plane = new Node('plane');
  const overlay = plane.add(new Node('overlay', { hobunjiWeaponAssemblyPart: true }));
  const result = api.dualWieldEnchantmentTargets(plane, [{ plane: overlay, mask: mask(1) }]);
  assert.equal(result.length, 0, 'a cloneable layer waits for its copies instead of emitting from the hidden midpoint');
}
console.log('weapon enchantment targets under dual wield: PASS');
