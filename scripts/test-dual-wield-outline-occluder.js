'use strict';
// Regression: dual-wield weapon copies inherit the PNG outline-occluder layer but own cloned
// materials. The occluder's depth-only replay strips colorWrite only from REGISTERED meshes, so an
// unregistered copy was drawn in full colour with no portrait stencil (weapon visible through the
// owner's front plane whenever a shoulder pet had stripped the owner's depth writes).
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const LAYER = 4;
function loadOccluder() {
  const sandbox = {
    THREE: { LessEqualDepth: 515 },
    window: {},
    console,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('docs/js/png-plane-outline-occluder.js', 'utf8'), sandbox);
  return sandbox.window.PngPlaneOutlineOccluder;
}

function fakeMesh(name) {
  const material = { colorWrite: true, depthWrite: false, depthTest: false, depthFunc: 0, alphaTest: 0.35 };
  const layers = { mask: 1, enable(l) { this.mask |= (1 << l); } };
  const mesh = { name, isMesh: true, material, layers, visible: true, parent: null };
  layers.enable(LAYER); // Inherited from the source plane, exactly like the dual-wield duplicate.
  return mesh;
}

function replay(occluder, meshes) {
  const scene = { isScene: true, visible: true };
  for (const mesh of meshes) mesh.parent = scene;
  const colorWritesDuringReplay = {};
  const camera = { layers: { mask: 1, set(l) { this.mask = 1 << l; } } };
  occluder.init({
    camera,
    renderer: {
      render() {
        for (const mesh of meshes) if (mesh.layers.mask & camera.layers.mask) colorWritesDuringReplay[mesh.name] = mesh.material.colorWrite;
      },
    },
  });
  occluder.renderDepth(scene);
  return colorWritesDuringReplay;
}

// Unregistered copy: draws in colour during the replay (the bug). Registered copy: colourless.
{
  const occluder = loadOccluder();
  const registered = fakeMesh('registered_copy');
  const unregistered = fakeMesh('unregistered_copy');
  occluder.registerDepthMesh(registered);
  const writes = replay(occluder, [registered, unregistered]);
  assert.strictEqual(writes.registered_copy, false, 'registered copy is depth-only in the occluder replay');
  assert.strictEqual(writes.unregistered_copy, true, 'an unregistered layer-4 copy would draw in colour (documents the hazard)');
  assert.strictEqual(registered.material.colorWrite, true, 'material state is restored after the replay');
}

// The dual-wield module registers both copies, and only when the source plane carries the occluder layer.
{
  const src = fs.readFileSync('docs/js/dual-wield-weapon-visuals.js', 'utf8');
  assert.match(src, /occluder\.registerDepthMesh\(mainMesh\);\s*occluder\.registerDepthMesh\(offMesh\);/, 'both duplicates register with the outline occluder');
  assert.match(src, /plane\.layers\?\.mask & \(1 << occluder\.LAYER\)/, 'registration is gated on the source plane carrying the occluder layer');
  assert.ok(src.indexOf('registerDepthMesh(mainMesh)') > src.indexOf('plane.add(mainRoot)'), 'copies register after they are attached');
}

console.log('dual wield outline occluder ok');
