#!/usr/bin/env node
'use strict';

// Gear particles (enchantment motes, weapon-layer fire) are drawn exactly once
// a frame, in the overlay render of the replay group holding their gear
// (js/held-object-render-order.js). They used to draw in the base pass, where
// the gear itself is suppressed, and again in EVERY group's overlay render
// (76 + 152 draws a frame for an enchanted dual flail on the user's device).
// Executes the shipped block against plain objects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/held-object-render-order.js'), 'utf8');
const start = source.indexOf('  // ── Gear particles: drawn once, after their own gear');
const end = source.indexOf('  function replayFrustumIntersects(', start);
assert.ok(start > 0 && end > start, 'gear particle block found');
const OVERLAY = 29;
const api = new Function(`
  const HELD_OVERLAY_LAYER = ${OVERLAY};
  const hasLayer = (o, layer) => ((o.layers.mask >>> layer) & 1) === 1;
  const isColorOnlyHeldVfx = node => (node.isSprite || node.isPoints) && node.material.depthWrite === false;
  function hideObjects(objects) { const states = new Map(); for (const o of objects) { if (!o || states.has(o)) continue; states.set(o, o.visible); o.visible = false; } return states; }
  function restoreVisibility(states) { for (const [o, v] of states) o.visible = v; }
  ${source.slice(start, end)}
  return { beginGearParticles, releaseUnreplayedGearParticles, showGroupGearParticles, endGearParticles,
    linkGearParticle, gearParticlesOf, needsParticleBounds, spriteWorldExtent,
    setEnabled: v => { gearParticlesOnceEnabled = v; }, skips: () => gearParticleSkips, managed: () => lastGearParticles };
`)();

function node(name, extra = {}) {
  const n = { name, children: [], parent: null, visible: true, layers: { mask: 1 }, ...extra,
    add(child) { child.parent = this; this.children.push(child); return child; },
    traverseVisible(fn) { if (!this.visible) return; fn(this); for (const c of this.children) c.traverseVisible(fn); } };
  return n;
}
const particle = name => node(name, { isSprite: true, material: { depthWrite: false }, layers: { mask: (1 | (1 << OVERLAY)) >>> 0 } });

// Main blade with motes; a flail head nested under the off-hand weapon, with its own motes.
const scene = node('scene', { isScene: true });
const mainBlade = scene.add(node('main_blade', { isMesh: true }));
const motesA = [particle('a1'), particle('a2'), particle('a3')];
const emitterA = mainBlade.add(node('weapon_enchantment_metal_particles'));
motesA.forEach(m => emitterA.add(m));
const offWeapon = scene.add(node('off_weapon', { isMesh: true }));
const flailHead = offWeapon.add(node('flail_head', { isMesh: true }));
const motesB = [particle('b1'), particle('b2')];
motesB.forEach(m => flailHead.add(m));
const worldOnly = mainBlade.add(particle('world_only')); worldOnly.layers.mask = 1; // Not on the overlay: untouched.
const solidChild = mainBlade.add(node('rope', { isMesh: true, material: { depthWrite: true }, layers: { mask: (1 | (1 << OVERLAY)) >>> 0 } })); // Writes depth: gear, not a particle.

const owners = [mainBlade, offWeapon, flailHead];
const hidden = api.beginGearParticles(owners);
assert.equal(api.managed(), 5, 'five overlay particles managed (not the world-only sprite or the depth-writing rope)');
for (const m of [...motesA, ...motesB]) assert.equal(m.visible, false, 'hidden for the base pass and the replay');
assert.equal(worldOnly.visible, true);
assert.equal(solidChild.visible, true);

// Group 1 holds the main blade and the off weapon; group 2 holds the flail head.
const shown1 = api.showGroupGearParticles([mainBlade, offWeapon]);
assert.deepEqual(shown1.map(m => m.name).sort(), ['a1', 'a2', 'a3'], 'the flail head\'s motes belong to their nearest owner, not the off weapon above it');
for (const m of motesB) assert.equal(m.visible, false, 'other groups\' particles stay hidden');
for (const m of shown1) m.visible = false; // What the overlay render's finally does.
const shown2 = api.showGroupGearParticles([flailHead]);
assert.deepEqual(shown2.map(m => m.name).sort(), ['b1', 'b2']);
for (const m of shown2) m.visible = false;
assert.equal(api.skips(), 5 + 2 + 3, 'base pass (5) plus each group skipping the other group\'s particles');

// Gear the replay culled keeps the old behaviour (visible for every remaining pass).
api.releaseUnreplayedGearParticles(new Set([mainBlade, offWeapon]));
for (const m of motesB) assert.equal(m.visible, true, 'unreplayed gear: particles visible again');
assert.equal(api.showGroupGearParticles([flailHead]), null, 'and no longer managed');

api.endGearParticles(hidden);
for (const m of [...motesA, ...motesB]) assert.equal(m.visible, true, 'restored after the replay');

// A frame that threw before endGearParticles is repaired at the next frame.
api.beginGearParticles(owners);
assert.equal(motesA[0].visible, false);
api.beginGearParticles([]); // Next frame, no participants.
assert.equal(motesA[0].visible, true, 'safety net restores particles left hidden by an interrupted frame');

// VFX parented outside its gear (the dungeon-fire plume rises from a weapon but lives in the scene):
// linked to the gear, it is managed exactly like a child particle, and unlinked when its owner disposes it.
const plume = scene.add(particle('plume'));
api.linkGearParticle(plume, mainBlade);
const withPlume = api.beginGearParticles(owners);
assert.equal(plume.visible, false, 'a linked particle is hidden for the base pass');
assert.deepEqual(api.showGroupGearParticles([mainBlade]).map(m => m.name).sort(), ['a1', 'a2', 'a3', 'plume'], 'and drawn in its gear\'s group overlay');
api.endGearParticles(withPlume);
assert.equal(plume.visible, true);
const detached = particle('detached'); api.linkGearParticle(detached, mainBlade); // Not in a scene: never managed.
api.endGearParticles(api.beginGearParticles(owners));
assert.equal(api.managed(), 6, 'motes + plume; a linked particle outside the scene is ignored');
api.linkGearParticle(plume, null); api.linkGearParticle(detached, null);
api.endGearParticles(api.beginGearParticles(owners));
assert.equal(api.managed(), 5, 'unlinked: no longer managed');

// Gear that does not x-ray (an NPC's weapon under the weapon budget): its particles are found so the
// replay can keep them out of every overlay render.
const npcWeapon = scene.add(node('npc_weapon', { isMesh: true }));
const npcFire = [npcWeapon.add(particle('npc_fire_1')), npcWeapon.add(particle('npc_fire_2'))];
assert.deepEqual(api.gearParticlesOf([npcWeapon]).map(m => m.name).sort(), ['npc_fire_1', 'npc_fire_2']);
assert.deepEqual(api.gearParticlesOf([node('bare_hand', { isMesh: true })]), [], 'gear without particles: nothing');

// Bounds: particles the base pass no longer draws join their group's scissor, unless a padded aura covers them.
emitterA.userData = { weaponEnchantmentVfx: true }; // weapon-enchantment-vfx.js's mote group.
assert.equal(api.needsParticleBounds(motesA[0], mainBlade), true, 'a mote without live aura padding needs its own bounds');
mainBlade.userData = { hobunjiHeldOverlayVfxPadding: 0.4 }; // The aura padding is measured over these motes.
assert.equal(api.needsParticleBounds(motesA[0], mainBlade), false, 'an enchantment mote is inside its plane\'s padded aura already');
const torchFlame = mainBlade.add(particle('torch_flame')); // Weapon-layer fire on the same, enchanted weapon.
assert.equal(api.needsParticleBounds(torchFlame, mainBlade), true, 'other particles are not covered by the mote padding');
mainBlade.children.splice(mainBlade.children.indexOf(torchFlame), 1);
mainBlade.userData = {}; emitterA.userData = {};
assert.equal(api.needsParticleBounds(worldOnly, mainBlade), false, 'world-only sprites still draw in the base pass');
const extent = api.spriteWorldExtent({ matrixWorld: { elements: [0.3,0,0,0, 0,0.4,0,0, 0,0,1,0, 5,6,7,1] } }, { set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
assert.ok(Math.abs(extent - 0.5) < 1e-9, 'sprite radius covers its 0.3 x 0.4 quad at any rotation or centre');
assert.match(source, /needsParticleBounds\(child, mesh\) && !includeParticleBounds\(child\)/, 'the replay scissor includes them');
assert.match(source, /const otherParticles = replayOthers\.length \? gearParticlesOf\(replayOthers\) : null;/, 'non-participant gear particles leave the overlays');

// A/B off: nothing is hidden.
api.setEnabled(false);
assert.equal(api.beginGearParticles(owners), null);
assert.equal(motesA[0].visible, true);

// Wiring: base pass, group overlay and snapshot/setter.
assert.match(source, /const gearParticlesHidden = beginGearParticles\(\[\.\.\.held, \.\.\.feet\]\);/);
assert.match(source, /const ownParticles = showGroupGearParticles\(group\.meshes\);/);
assert.match(source, /endGearParticles\(gearParticlesHidden\);/);
// One try/finally spans from hiding to the end of the replay: a throw anywhere in between shows them again
// before the render returns (not only at a later frame that reaches beginGearParticles).
const wrapped = source.slice(source.indexOf('const gearParticlesHidden = beginGearParticles('), source.indexOf('wrappedRender.__hobunjiHeldRenderOrderWrapped'));
assert.match(wrapped, /^const gearParticlesHidden = beginGearParticles\([^\n]*\n\s*try \{/, 'the try opens right after hiding');
assert.match(wrapped, /\} finally \{\n\s*endGearParticles\(gearParticlesHidden\);\n\s*\}\n\s*\}\s*$/, 'and its finally ends the wrapped render');
assert.match(source, /linkGearParticle, \/\/ \(particle, ownerGearMesh \| null\)/, 'linking is public (dungeon-fire.js)');
assert.match(source, /setGearParticlesOnceEnabled: value =>/);
console.log('held gear particles: hidden for the base pass, drawn once in their own group\'s overlay, nearest owner, culled-gear fallback, safety net');
