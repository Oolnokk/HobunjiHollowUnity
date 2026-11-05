// Random Test Ruin: linked cube pillar pairs ("rotate the cubes until they match"), post-generation.
//
// V50's createLinkedDoorCubePair (docs/tools/debris-ifier/debrisifier-v50-source.js) is pinned
// byte-for-byte by tests, so it cannot be edited. At ruin scale (x/z expanded by RUIN_TILE_SCALE, y
// untouched) its output has three faults that this pass corrects after generation:
//
//   1. Spacing. The pillars are placed for a 3-cell doorway (cellSize*1.5+.34 from the door centre),
//      but doorways are 3, 5 or 6 cells wide, so on the wider ones the cubes land inside the arch
//      posts. Spacing now follows the actual arch.
//   2. Proportions. The cubes become 0.88 x 0.44 x 0.88 slabs and their decals stretch with them.
//      Each pillar is rescaled so the cubes are true cubes, and the face symbols are square.
//   3. Symbols. The four faces are the inn and general-store sign decals plus a mirror of each, so
//      which face is turned toward you -- the whole puzzle -- is barely readable. Each face is now a
//      distinct UI icon (assets/hud/generic_icons), the same four on every cube, so "solved" means
//      the same icon facing out on all of them.
//
// Called from applyUnlitRuinMaterials (js/dev-random-ruin-interior-map.js), which runs on the ground
// floor and, as prepareMaterials, on every native upper floor, before controls and collision exist.
(() => {
  'use strict';
  if (!window.THREE) return;

  const CUBE = .44;             // V50 cube edge, in its own units.
  const CAP_OVERHANG = 1.12;    // The cap is wider than the body by this factor.
  const CUBE_HEIGHT_SCALE = 1.5; // Taller than V50's .44 so a stack reads against a 2.35 doorway; width follows to stay square.
  const SYMBOL_WORLD = .46;     // Edge of the face symbol, in world units.
  const POST_GAP = .1;          // Clear space between the arch's outer edge and a cube, in V50 units.
  const ICON_BASE = 'assets/hud/generic_icons/';
  // Four silhouettes that stay distinct at a glance: a U, a diagonal sprig, a T-like glyph and a framed peak.
  const FACES = Object.freeze([
    { id:'horseshoe', file:'icon_horseshoe.png' },
    { id:'wheat', file:'icon_wheat.png' },
    { id:'tbu', file:'icon_tbu.png' },
    { id:'map', file:'icon_map.png' },
  ]);

  const textures = new Map(); // face id -> shared canvas texture; the PNG fills in when it loads.

  function drawFace(canvas, image) {
    const ctx = canvas.getContext('2d'), size = canvas.width, inset = size * .06, radius = size * .14;
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.moveTo(inset + radius, inset);
    ctx.arcTo(size - inset, inset, size - inset, size - inset, radius);
    ctx.arcTo(size - inset, size - inset, inset, size - inset, radius);
    ctx.arcTo(inset, size - inset, inset, inset, radius);
    ctx.arcTo(inset, inset, size - inset, inset, radius);
    ctx.closePath();
    ctx.fillStyle = '#d2c9b4'; // Pale carved plaque: the icons are black strokes, and solved tints the plaque.
    ctx.fill();
    ctx.lineWidth = size * .035;
    ctx.strokeStyle = '#8a816d';
    ctx.stroke();
    if (!image || !image.width || !image.height) return;
    const fit = Math.min((size * .66) / image.width, (size * .66) / image.height);
    ctx.drawImage(image, (size - image.width * fit) / 2, (size - image.height * fit) / 2, image.width * fit, image.height * fit);
  }

  function faceTexture(face) {
    if (textures.has(face.id)) return textures.get(face.id);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    drawFace(canvas, null);
    const Surface = window.HobunjiSpritePngSurface; // The shared PNG-plane path: same colour management as every other authored sprite.
    const name = 'ruin-cube-face-' + face.id;
    const texture = Surface?.makeCanvasTexture ? Surface.makeCanvasTexture(THREE, canvas, name) : new THREE.CanvasTexture(canvas);
    textures.set(face.id, texture);
    const image = new Image();
    image.crossOrigin = 'anonymous'; // Set before src: a tainted canvas would silently fail to upload.
    image.onload = () => { drawFace(canvas, image); texture.needsUpdate = true; };
    image.src = ICON_BASE + face.file;
    return texture;
  }

  // One material per face for a pair. V50 tints decalMaterials between baseColor and activeColor as the
  // puzzle solves, so the plaque (white x tint) glows while the black icon stays black.
  function faceMaterial(face) {
    const texture = faceTexture(face), name = 'ruin-cube-face-' + face.id;
    const overrides = { side:THREE.DoubleSide, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 };
    const Surface = window.HobunjiSpritePngSurface;
    const material = Surface?.makeMaterial
      ? Surface.makeMaterial(THREE, texture, name, overrides)
      : new THREE.MeshBasicMaterial({ map:texture, transparent:true, ...overrides });
    material.userData = Object.assign(material.userData || {}, { baseColor:'#ffffff', activeColor:'#66aaff', decalImagePath:ICON_BASE + face.file, decalRuntime:'ruin-cube-face' });
    return material;
  }

  // Width of the arch the pair belongs to (V50 units), or null if it cannot be found.
  function archWidthFor(pair) {
    const door = pair.userData.linkedMechanismRoot, siblings = pair.parent?.children;
    if (!door || !siblings) return null;
    let width = null, nearest = Infinity;
    for (const object of siblings) {
      const footprint = object.userData?.archFootprint;
      if (!footprint) continue;
      const distance = Math.hypot(object.position.x - door.position.x, object.position.z - door.position.z);
      if (distance < nearest) { nearest = distance; width = Number(footprint.width) || null; }
    }
    return nearest < .05 ? width : null; // The arch stands exactly where its door does.
  }

  function normalizePair(pair, tileScale) {
    const data = pair.userData;
    const segments = data.rotatingSegments.map(entry => entry?.segment).filter(Boolean);
    const pillars = [...new Set(segments.map(segment => segment.parent).filter(Boolean))];
    const sideScale = CUBE_HEIGHT_SCALE / tileScale; // x/z get tileScale from the ruin, so this keeps width = height in the world.
    const archWidth = archWidthFor(pair);
    for (const pillar of pillars) {
      pillar.scale.set(sideScale, CUBE_HEIGHT_SCALE, sideScale);
      if (archWidth) {
        const clear = archWidth / 2 + POST_GAP + CUBE * CAP_OVERHANG / 2 * sideScale;
        const side = Math.sign(pillar.position.x) || 1;
        pillar.position.x = side * Math.max(Math.abs(pillar.position.x), clear); // Only ever pushes outward.
      }
    }
    const materials = FACES.map(faceMaterial);
    const symbol = SYMBOL_WORLD / CUBE_HEIGHT_SCALE; // Local size; the pillar scale makes it SYMBOL_WORLD square.
    for (const segment of segments) {
      const planes = segment.children.filter(child => child.userData?.furnitureDecal);
      planes.forEach((plane, index) => {
        const face = FACES[index % FACES.length];
        plane.geometry?.dispose?.();
        plane.geometry = new THREE.PlaneGeometry(symbol, symbol);
        plane.material = materials[index % FACES.length];
        plane.userData.decalImagePath = ICON_BASE + face.file;
        plane.userData.decalIdentity = 'cube_face_' + face.id;
      });
    }
    data.decalMaterials = materials; // V50's solved tint now reaches what actually renders.
    data.devRuinCubePillarsNormalized = true;
  }

  function normalize(root, options = {}) {
    const tileScale = Math.max(1, Number(options.tileScale) || 2);
    let pairs = 0;
    root?.traverse?.(object => {
      const data = object.userData;
      if (data?.activatorType !== 'linkedCubePillars' || !Array.isArray(data.rotatingSegments) || data.devRuinCubePillarsNormalized) return;
      normalizePair(object, tileScale);
      pairs++;
    });
    return pairs;
  }

  for (const face of FACES) faceTexture(face); // Start the four PNG loads now, so no plaque is ever blank when a ruin is entered.

  window.DevRandomRuinCubePillars = Object.freeze({ normalize, FACES, SYMBOL_WORLD, CUBE_HEIGHT_SCALE });
})();
