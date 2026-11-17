#!/usr/bin/env node
'use strict';

// Regression: the neutral Loadout flail preview uses the production contact
// solver, without stepping an unequipped weapon's pendulum or mutating its mesh.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/weapon-sprite-assemblies.js', 'utf8'); // Exercise the shipped neutral matrix builder, not a copied formula.

function productionFunction(name) {
  const start = source.indexOf('  function ' + name + '('); // Finds the actual utility inside the weapon assembly runtime.
  assert(start >= 0, name + ' must remain in the assembly module');
  const end = source.indexOf('\n  }\n', start); // Its two-space function closing brace; nested scopes have deeper indentation.
  assert(end > start, name + ' must have a complete body');
  return source.slice(start, end + 5);
}

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  sub(other) { this.x -= other.x; this.y -= other.y; this.z -= other.z; return this; }
  add(other) { this.x += other.x; this.y += other.y; this.z += other.z; return this; }
  multiplyScalar(value) { this.x *= value; this.y *= value; this.z *= value; return this; }
  lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
  applyQuaternion(q) {
    const x = this.x, y = this.y; // The neutral solver rotates the connector only around the face-on Z axis.
    this.x = Math.cos(q.angle) * x - Math.sin(q.angle) * y;
    this.y = Math.sin(q.angle) * x + Math.cos(q.angle) * y;
    return this;
  }
}
class Quaternion {
  constructor() { this.angle = 0; }
  setFromAxisAngle(axis, angle) { assert.equal(axis.z, 1); this.angle = angle; return this; }
}
class Matrix4 {
  compose(position, rotation, scale) {
    this.position = position.clone(); this.rotation = rotation; this.scale = scale.clone(); return this;
  }
}
const THREE = { Vector3, Quaternion, Matrix4 }; // Minimal Three.js math API for deterministic geometry checks.
const names = ['anchor', 'pixelPoint', 'relativePartScale', 'connectorAxisScale', 'neutralPreviewMatrices'];
const implementation = names.map(productionFunction).join('\n'); // These are the original production functions, evaluated together.
const api = vm.runInNewContext('(() => {' + implementation + '; return { anchor, pixelPoint, neutralPreviewMatrices }; })()', { THREE });
const baseImage = { width: 450, height: 1204 }; // Real haft source coordinate system.
const headImage = { width: 30, height: 60 }; // Separately positioned flail-head sprite frame.
const unit = 0.5 / baseImage.width; // Canonical source-pixel-to-world width.
const shaftAnchor = { x: 225, y: 1203 }; // Socket on the business end of the held haft.
const headAnchor = { x: 15, y: 59 }; // Connector meets the bottom edge of the head's authored sprite.
const headLayer = { id: 'front', offsetPx: { x: 0, y: 0 } }; // The selected contact layer used by the production anchor solver.
function local(image, point, offset = null) { return api.pixelPoint(image, point, unit, offset, new Vector3()); }
function mapped(matrix, point) {
  const scaled = point.clone(); // Apply the same local scale/rotation/translation as Three's composed matrix.
  scaled.x *= matrix.scale.x; scaled.y *= matrix.scale.y; scaled.z *= matrix.scale.z;
  return scaled.applyQuaternion(matrix.rotation).add(matrix.position);
}
function samePoint(actual, expected, label) {
  assert(Math.abs(actual.x - expected.x) < 1e-8 && Math.abs(actual.y - expected.y) < 1e-8,
    label + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function check(rope, headVisual = null) {
  const chainImage = rope.type === 'rope'
    ? { width: 1, height: 161 } : { width: 16, height: 50 }; // Covers both generated rope and diagonal raster chain.
  const chainTop = rope.type === 'rope' ? { x: 0, y: 0 } : { x: 3, y: 1 };
  const chainBottom = rope.type === 'rope' ? { x: 0, y: 160 } : { x: 8, y: 46 };
  const headSpec = {
    scale: headVisual?.scale ?? 1, anchorSpace: 'layer', anchorLayer: 'front',
    layers: [headLayer], visualTransform: headVisual?.transform || null,
  }; // Pair-only scale/rotation/flip must not break connector contact.
  const state = {
    THREE, plane: { geometry: { parameters: { width: 0.5 } }, material: { map: { image: baseImage } } },
    config: { flail: { haftAnchor: shaftAnchor, chain: rope, head: headSpec } },
    chain: { userData: { hobunjiRuinRopeSprite: rope.type === 'rope' } },
    chainImage, chainTop, chainBottom, headAnchorImage: headImage, headAnchor,
  }; // No parent, world matrix or simulation state: a never-held weapon must still preview correctly.
  const result = api.neutralPreviewMatrices(state); // Production matrices must not mutate or attach either source mesh.
  assert(result?.chain && result?.headRoot, 'neutral flail pose is available without a gameplay holder');
  const shaftPoint = local(baseImage, shaftAnchor);
  samePoint(mapped(result.chain, local(chainImage, chainTop)), shaftPoint, 'connector top stays at shaft mount');
  const connectorEnd = mapped(result.chain, local(chainImage, chainBottom));
  const headContact = local(headImage, headAnchor, headLayer.offsetPx);
  if (headVisual?.transform) {
    const v = headVisual.transform; // Apply the actual head-artwork correction group to its anchor.
    headContact.x *= (v.scaleX || 1) * (v.flipX ? -1 : 1);
    headContact.y *= (v.scaleY || 1) * (v.flipY ? -1 : 1);
    headContact.applyQuaternion({ angle: -(v.rotation || 0) * Math.PI / 180 });
  }
  samePoint(mapped(result.headRoot, headContact), connectorEnd, 'head anchor meets connector end');
  assert.equal(state.chain.matrix, undefined, 'previewing leaves the live chain transform alone');
  return result;
}

check({ type: 'rope', scaleX: 1, scaleY: 1 });
check({ type: 'rope', scaleX: 1.3, scaleY: 1.5 },
  { scale: 1.2, transform: { scaleX: 1.25, scaleY: 0.4, flipX: true, flipY: true, rotation: 30 } });
check({ type: 'chain', scaleX: 1.2, scaleY: 0.7, mountLengthPx: 80 });
console.log('Neutral flail geometry: authored shaft, connector and transformed head contacts align.');
