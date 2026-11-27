// Single registry of every THREE.Layers bit the game uses (window.HobunjiRenderLayers).
//
// Three.js gives each Object3D a 32-bit layer mask; a camera only draws
// objects that share at least one bit with camera.layers. This game uses
// layers as *pass selectors*: the world render pipeline (js/world-render-pipeline.js)
// and the held-object replays (js/held-object-render-order.js) switch the
// camera to one layer at a time to redraw a subset of the scene with a
// different material (outline shell, depth-only, stencil stamp, ...).
//
// Before this file each module hard-coded its own numbers, so two modules
// could pick the same bit without knowing it. Read numbers from here
// (`window.HobunjiRenderLayers.SHELL_OUTLINE`, with a numeric fallback only
// for isolated editor/test pages that do not load this file) and add new
// layers to LAYERS below with an owner and a one-line purpose.
//
// Debugging: `HobunjiRenderLayers.describe(camera.layers.mask)` or
// `HobunjiRenderLayers.describeObject(mesh)` turns a mask into names.
//
// Loaded from index.html straight after three.js, before every module that
// uses layers.
(() => {
  'use strict';

  if (window.HobunjiRenderLayers) return;

  // `transient: true` means the bit is only set for the duration of one
  // synchronous render pass and cleared before the pass returns, so two
  // transient users of the same bit cannot see each other's objects. A
  // permanent (non-transient) bit is set on objects for their lifetime.
  const LAYERS = Object.freeze({
    WORLD: Object.freeze({ bit: 0, owner: 'three.js default', purpose: 'Everything drawn by the main colour pass.' }),
    SHELL_OUTLINE: Object.freeze({ bit: 1, owner: 'world-render-pipeline.js (markShellOutline)', purpose: 'Volumetric meshes that get the black inverted-hull outline pass. Never PNG planes (their art has ink).' }),
    TARGET_HIGHLIGHT: Object.freeze({ bit: 2, owner: 'world-render-pipeline.js (setTargetHighlights)', purpose: 'The reticle target object drawn with the green/red highlight shell.' }),
    MATERIAL_SEAM_ID: Object.freeze({ bit: 3, owner: 'world-render-pipeline.js (markMaterialSeamId / markTerrainSeamId)', purpose: 'Furniture parts and terrain tiles drawn into the material-ID buffer for seam outlines (off by default). Also used by farm-tile-render-batches / terrain-render-chunks / player-house-elevation to recognise ground meshes.' }),
    PNG_OCCLUDER: Object.freeze({ bit: 4, owner: 'png-plane-outline-occluder.js', purpose: 'PNG avatars/held items replayed depth-only before the outline passes so outlines behind them are hidden.' }),
    MIST_REDRAW: Object.freeze({ bit: 5, owner: 'cloud-forest-fog.js', purpose: 'Mist cylinders redrawn over the outline passes.' }),
    WORLD_TEXT_OVERLAY: Object.freeze({ bit: 6, owner: 'outline-render-performance.js', purpose: 'Depth-disabled world text (popups, chatheads) drawn after the composite.' }),
    KANTHIC_GLYPH_DEPTH: Object.freeze({ bit: 7, owner: 'cloud-forest-fog.js', purpose: 'Dedicated lighting quad and occupied-room emissive glyph redraw; never a base-world or held-object replay.' }),
    FRONT_PORTRAIT_MASK: Object.freeze({ bit: 24, owner: 'held-object-render-order.js', transient: true, purpose: 'Stencil stamp of an actor\'s front art so its own held gear can be masked. Shares the bit with SCORE_ACTOR_DEPTH (both transient).' }),
    SCORE_ACTOR_DEPTH: Object.freeze({ bit: 24, owner: 'outline-render-performance.js', transient: true, purpose: 'Colourless actor silhouettes for the puzzle-score overlay (outlines-off path only).' }),
    PORTRAIT_WATER_MASK: Object.freeze({ bit: 25, owner: 'held-object-render-order.js', transient: true, purpose: 'Colourless actor silhouettes for water tint. Shares the bit with PERCEPTION_MODE.' }),
    PERCEPTION_MODE: Object.freeze({ bit: 25, owner: 'perception-mode.js', purpose: 'Perception Mode silhouettes drawn after the composite.' }),
    FOOT_WATER_MASK: Object.freeze({ bit: 26, owner: 'held-object-render-order.js / procedural-feet-outline-parity.js', purpose: 'Procedural feet that translucent water may repaint.' }),
    WATER_REPLAY: Object.freeze({ bit: 27, owner: 'held-object-render-order.js', purpose: 'Water surfaces replayed over held items/feet.' }),
    GROUND_REPLAY: Object.freeze({ bit: 28, owner: 'held-object-render-order.js', purpose: 'Ground/grass replayed to rebuild depth under held items.' }),
    HELD_OVERLAY: Object.freeze({ bit: 29, owner: 'held-object-render-order.js', purpose: 'Held weapons/tools/hands drawn once after the reconstructed depth.' }),
    TARGET_ALPHA_FILL: Object.freeze({ bit: 30, owner: 'outline-render-performance.js', transient: true, purpose: 'Alpha-cutout target cards drawn as filled silhouettes. Shares the bit with HIDDEN_HELPERS.' }),
    HIDDEN_HELPERS: Object.freeze({ bit: 30, owner: 'foliage-generator.js', purpose: 'Invisible helper meshes kept out of normal rendering and default raycasts.' }),
    OVERLAY_ONLY_LIGHT: Object.freeze({ bit: 31, owner: 'furniture-light-registry.js / farmhouse-flat-lighting.js', purpose: 'Local lights kept as overlay data and out of WebGL\'s light list.' }),
  });

  const api = { LAYERS };
  for (const [name, entry] of Object.entries(LAYERS)) api[name] = entry.bit;

  // Bit -> names (several names share a bit, see `transient` above).
  const namesByBit = new Map();
  for (const [name, entry] of Object.entries(LAYERS)) {
    if (!namesByBit.has(entry.bit)) namesByBit.set(entry.bit, []);
    namesByBit.get(entry.bit).push(name);
  }

  api.mask = (...bits) => bits.reduce((m, bit) => (m | (1 << bit)) >>> 0, 0);
  api.describe = mask => {
    const value = Number(mask) >>> 0;
    if (value === 0xFFFFFFFF) return ['ALL'];
    const out = [];
    for (let bit = 0; bit < 32; bit++) {
      if (value & (1 << bit)) out.push(namesByBit.has(bit) ? namesByBit.get(bit).join('|') : `UNREGISTERED_${bit}`);
    }
    return out;
  };
  api.describeObject = object => api.describe(object?.layers?.mask ?? 0);

  window.HobunjiRenderLayers = Object.freeze(api);
})();
