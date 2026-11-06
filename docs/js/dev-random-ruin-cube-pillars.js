// Random Test Ruin: linked cube pillar pairs ("rotate the cubes until they match"), post-generation.
//
// V50's createLinkedDoorCubePair (docs/tools/debris-ifier/debrisifier-v50-source.js) is pinned
// byte-for-byte by tests, so it cannot be edited. At ruin scale (x/z expanded by RUIN_TILE_SCALE, y
// untouched) its output has three faults that this pass corrects after generation:
//
//   1. Placement. The pillars stand beside the door at a spacing fixed for a 3-cell doorway, but
//      doorways are 3, 5 or 6 cells wide, so on the wider ones the cubes land inside the arch posts,
//      and anywhere they stand in the wall line. Now each arch post is rebuilt as a housing (a base,
//      a cap and two side walls, like the projectile-target pillars) cut into three compartments,
//      one thin cube in each, entirely within the post's own footprint. V50's cap plates (the thin
//      slab on top of every cube) are lifted out of the rotating cube and stretched wall to wall as
//      fixed shelves, so each cube turns freely between two shelves. Compartments are open on both
//      faces: both sides of these doors are walkable, so the cubes read from either.
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
  const CAP_THICK = .055;       // V50's cap plate on top of each cube.
  const CAP_OVERHANG = 1.12;    // The cap is wider than the body by this factor.
  const CUBE_SCALE = .85;       // World scale of a cube. A cube turning in its compartment sweeps its diagonal, so it stays under the slot width.
  const SYMBOL_WORLD = .24;     // Edge of the face symbol, in world units.
  // Housing, in world units. A compartment holds one cube plus the shelf over it; the three stack on a base block.
  const POST_WIDTH = .8, WALL = .11, BASE_H = .42, CELLS = 3;
  const INNER_W = POST_WIDTH - WALL * 2;              // Slot width: also the shelf width.
  const CELL_H = (CUBE + CAP_THICK) * CUBE_SCALE;     // One cube plus its shelf.
  const WINDOW_H = CELLS * CELL_H;
  const CELL_PITCH = CUBE + CAP_THICK;                // Same spacing, in cube-local units, so each cube rests on the shelf below.
  const POST_GAP = .1;          // Fallback only: clear space between the arch's outer edge and a cube, in V50 units.
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

  // The arch group standing exactly where the pair's door does, or null.
  function archFor(pair) {
    const door = pair.userData.linkedMechanismRoot, siblings = pair.parent?.children;
    if (!door || !siblings) return null;
    let found = null, nearest = Infinity;
    for (const object of siblings) {
      if (!object.userData?.archFootprint) continue;
      const distance = Math.hypot(object.position.x - door.position.x, object.position.z - door.position.z);
      if (distance < nearest) { nearest = distance; found = object; }
    }
    return nearest < .05 ? found : null; // The arch stands exactly where its door does.
  }

  // Replaces one box post of an arch with a housing: a base, a cap and two side walls around three
  // compartments that run through the post's depth. Authored in world units; the arch group carries tileScale on x/z.
  function buildHousing(arch, post, centerX, depthWorld, clearH, tileScale) {
    const group = new THREE.Group(), material = post.material;
    group.name = 'ruin-cube-post-housing';
    const box = (w, h, d, x, y) => { // World-unit size and x; the arch group carries tileScale on x and z.
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w / tileScale, h, d / tileScale), material);
      mesh.position.set(x / tileScale, y, 0);
      mesh.castShadow = post.castShadow; mesh.receiveShadow = post.receiveShadow;
      group.add(mesh);
      return mesh;
    };
    const topH = clearH - BASE_H - WINDOW_H, sideX = (POST_WIDTH - WALL) / 2;
    box(POST_WIDTH, BASE_H, depthWorld, 0, BASE_H / 2);
    box(WALL, WINDOW_H, depthWorld, -sideX, BASE_H + WINDOW_H / 2);
    box(WALL, WINDOW_H, depthWorld, sideX, BASE_H + WINDOW_H / 2);
    box(POST_WIDTH, topH, depthWorld, 0, BASE_H + WINDOW_H + topH / 2);
    group.position.set(centerX, 0, 0);
    arch.remove(post);
    post.geometry?.dispose?.();
    arch.add(group);
    return group;
  }

  // Lifts a cube's cap plate out of the rotating segment and stretches it across the slot as a fixed shelf.
  function shelve(pillar, segment, depthWorld) {
    const meshes = segment.children.filter(child => child.isMesh && !child.userData?.furnitureDecal);
    const cap = meshes.length > 1 ? meshes.reduce((thin, mesh) => geometryHeight(mesh) < geometryHeight(thin) ? mesh : thin) : null;
    if (!cap) return;
    const width = cap.geometry?.parameters?.width || CUBE * CAP_OVERHANG; // The cap is square: local width == local depth.
    const worldPerLocal = pillar.scale.x * pillar.userData.devRuinTileScale; // Local x/z -> world.
    cap.position.set(0, segment.position.y + cap.position.y, 0);
    cap.scale.set(INNER_W / (width * worldPerLocal), 1, depthWorld / (width * worldPerLocal));
    segment.remove(cap);
    pillar.add(cap); // Parented to the pillar, not the segment: it no longer turns with the cube.
    cap.userData.devRuinCubeShelf = true;
  }

  // Height of a mesh's own geometry. BoxGeometry parameters are gone once the stone pass has swapped in
  // stretch-mapped geometry, so fall back to the bounding box.
  function geometryHeight(mesh) {
    const geometry = mesh?.geometry;
    if (!geometry) return NaN;
    if (Number(geometry.parameters?.height) > 0) return Number(geometry.parameters.height);
    if (!geometry.boundingBox) geometry.computeBoundingBox?.();
    const box = geometry.boundingBox;
    return box ? (box.max.y - box.min.y) * (Math.abs(mesh.scale?.y) || 1) : NaN;
  }

  // Rebuilds both posts of the pair's arch as housings and seats each pillar in its slot. Returns false
  // (touching nothing) if the arch is not the plain three-box frame this expects.
  function houseInArch(pair, pillars, arch, tileScale) {
    const width = Number(arch.userData.archFootprint.width), depth = Number(arch.userData.archFootprint.depth);
    const sameFacing = Math.abs(Math.atan2(Math.sin(pair.rotation.y - arch.rotation.y), Math.cos(pair.rotation.y - arch.rotation.y))) < 1e-3;
    if (!(width > 0) || !(depth > 0) || !sameFacing || pillars.length !== 2) return false;
    const posts = arch.children.filter(child => child.isMesh && Math.abs(child.position.x) > width * .3);
    const lintel = arch.children.find(child => child.isMesh && Math.abs(child.position.x) < 1e-6);
    if (posts.length !== 2 || !lintel || !posts[0].material) return false;
    const columnW = Math.max(.22, width * .11), clearH = geometryHeight(posts[0]);
    if (!(clearH > BASE_H + WINDOW_H) || pillars.some(pillar => pillar.children.length !== CELLS)) return false;
    const wide = POST_WIDTH / tileScale; // Housing width in arch units; grows outward so the opening and door slab stay put.
    const growth = Math.max(0, wide - columnW);
    const innerEdge = width / 2 - columnW;
    const centers = [-1, 1].map(side => side * (innerEdge + Math.max(wide, columnW) / 2));
    const left = posts.find(candidate => candidate.position.x < 0), right = posts.find(candidate => candidate.position.x > 0);
    if (!left || !right) return false;
    buildHousing(arch, left, centers[0], depth * tileScale, clearH, tileScale);
    buildHousing(arch, right, centers[1], depth * tileScale, clearH, tileScale);
    if (growth > 0 && lintel.scale) lintel.scale.x *= (width + growth * 2) / width; // The lintel still spans the wider posts.
    const lift = arch.position.y - pair.position.y; // Both rest on the floor; this keeps them level if their origins ever differ.
    const sideScale = CUBE_SCALE / tileScale;
    for (const pillar of pillars) {
      const side = pillar.position.x < 0 ? 0 : 1;
      pillar.scale.set(sideScale, CUBE_SCALE, sideScale);
      pillar.userData.devRuinTileScale = tileScale;
      pillar.position.set(centers[side], BASE_H + lift, 0);
      pillar.children.forEach((segment, cell) => {
        segment.position.y = cell * CELL_PITCH; // One cube per compartment, structural base cube first.
        shelve(pillar, segment, depth * tileScale);
      });
    }
    return true;
  }

  function normalizePair(pair, tileScale) {
    const data = pair.userData;
    const segments = data.rotatingSegments.map(entry => entry?.segment).filter(Boolean);
    const pillars = [...new Set(segments.map(segment => segment.parent).filter(Boolean))].sort((a, b) => a.position.x - b.position.x);
    const sideScale = CUBE_SCALE / tileScale; // x/z get tileScale from the ruin, so this keeps width = height in the world.
    const arch = archFor(pair);
    if (!(arch && houseInArch(pair, pillars, arch, tileScale))) {
      // No plain arch to house them in: keep V50's spot, but clear of the arch if there is one.
      const archWidth = arch ? Number(arch.userData.archFootprint.width) : null;
      for (const pillar of pillars) {
        pillar.scale.set(sideScale, CUBE_SCALE, sideScale);
        if (archWidth) {
          const clear = archWidth / 2 + POST_GAP + CUBE * CAP_OVERHANG / 2 * sideScale;
          const side = Math.sign(pillar.position.x) || 1;
          pillar.position.x = side * Math.max(Math.abs(pillar.position.x), clear);
        }
      }
    }
    const materials = FACES.map(faceMaterial);
    const symbol = SYMBOL_WORLD / CUBE_SCALE; // Local size; the pillar scale makes it SYMBOL_WORLD square.
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

  window.DevRandomRuinCubePillars = Object.freeze({ normalize, FACES, SYMBOL_WORLD, CUBE_SCALE, POST_WIDTH, WALL, INNER_W, BASE_H, WINDOW_H, CELLS, CELL_H, CELL_PITCH });
})();
