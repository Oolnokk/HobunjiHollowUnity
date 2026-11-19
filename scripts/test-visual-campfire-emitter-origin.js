#!/usr/bin/env node
'use strict';

// Execute the real authored-furniture VFX implementation with a small Three.js
// stand-in. Sixteen candle tips must be able to share one canonical campfire
// emitter instead of requiring their own ad-hoc PointsMaterial animation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class BufferAttribute {
  constructor(array) { this.array = array; }
  setXYZ(index, x, y, z) { this.array.set([x, y, z], index * 3); }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.disposed = false; }
  setAttribute(key, attribute) { this.attributes[key] = attribute; }
  dispose() { this.disposed = true; }
}
class PointsMaterial {
  constructor(options) { Object.assign(this, options); this.disposed = false; }
  dispose() { this.disposed = true; }
}
class Points {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.userData = {};
    this.position = { set() {} };
    this.visible = false;
  }
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  applyQuaternion() { return this; } // Straight-up campfire emission orientation.
}
class Quaternion { setFromEuler() { return this; } }
class Color {
  constructor(value) { this.set(value); }
  set(value) {
    const rgb = parseInt(String(value).replace('#', ''), 16) || 0;
    this.r = ((rgb >> 16) & 255) / 255;
    this.g = ((rgb >> 8) & 255) / 255;
    this.b = (rgb & 255) / 255;
    return this;
  }
  clone() { const clone = new Color('#000000'); Object.assign(clone, { r: this.r, g: this.g, b: this.b }); return clone; }
  lerp(other, t) {
    this.r += (other.r - this.r) * t;
    this.g += (other.g - this.g) * t;
    this.b += (other.b - this.b) * t;
    return this;
  }
}
const THREE = {
  BufferAttribute, BufferGeometry, PointsMaterial, Points, Vector3, Quaternion, Color,
  Matrix4: class {}, Euler: class {},
}; // The live emitter path only needs these Three primitives.
const window = { THREE };
vm.runInNewContext(fs.readFileSync('docs/js/authored-furniture-runtime.js', 'utf8'), { window, THREE });
const campfire = JSON.parse(fs.readFileSync('docs/config/furniture-authored/campfire.json', 'utf8'));
const source = campfire.particleEmitters.find(entry => entry.type === 'fire');
assert(source, 'player-built campfire has an authored fire definition');
const root = {
  userData: {},
  children: [],
  add(object) { this.children.push(object); },
  remove(object) { this.children = this.children.filter(child => child !== object); },
}; // Independent fixture root, as used by the ambient-furniture emitter.
const flame = { ...JSON.parse(JSON.stringify(source)),
  attachedPartId: null,
  position: { x: 0, y: 0, z: 0 },
  emissionOrigins: [{ x: 2, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }],
  rate: 4, lifetime: 2, radius: 0,
}; // Copies source behavior, changing just anchors and test-controlled spawn rate.
const visual = window.AuthoredFurniture.createEmitterVisual(root, flame, 8);
assert.equal(root.children.length, 1, 'a multi-wick fire uses one Points draw');
visual.update(0.5, true);
assert.equal(visual.points.visible, true, 'particle emission begins when activated');
const positions = visual.points.geometry.attributes.position.array;
assert(Math.abs(positions[0] - 2) < 0.1, 'the first canonical particle spawns at wick one');
assert(Math.abs(positions[3] - 4) < 0.1, 'the next canonical particle spawns at wick two');
assert.equal(visual.points.geometry.attributes.position.array.length, 24, 'one shared eight-particle buffer is allocated');
visual.dispose();
assert.equal(root.children.length, 0, 'fixture cleanup removes shared VFX');
assert.equal(visual.points.geometry.disposed, true, 'fixture cleanup releases geometry');
assert.equal(visual.points.material.disposed, true, 'fixture cleanup releases material');
console.log('canonical campfire multi-origin emitter and GPU cleanup passed');
