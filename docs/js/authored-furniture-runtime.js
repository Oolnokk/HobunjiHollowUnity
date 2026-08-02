// Loads and renders the rich per-piece furniture data authored by
// docs/tools/furniture-avatar-author/index.html (docs/config/furniture-authored/
// <furnitureKey>.json — schema hobunji_furniture_authored_runtime.v1), as
// opposed to docs/js/procedural-furniture.js's own small hardcoded CATALOG
// recipes. Both share the same part schema (buildPartMesh), so this module
// is a thin loader/cache + group builder on top of that, plus accessors for
// the interaction metadata (seat anchors, particle emitters, processing
// warps/timelines, livestock stomp attach points) the authoring tool now
// exports alongside geometry.
//
// Intentionally data-driven rather than tied to any specific furniture kind
// (chair/station/etc.) — any key with a docs/config/furniture-authored/*.json
// file works the same way, so decorative pieces (tables, beds, ...) can opt
// into real authored geometry and interactables later without a rewrite.
(function () {
  'use strict';

  const CONFIG_BASE = 'config/furniture-authored/';
  const _cache = new Map(); // furnitureKey -> Promise<data|null>, .__value set once resolved

  // Synchronous accessor for already-resolved data — callers that build
  // meshes on demand (placement, respawn-on-load) should `await load(key)`
  // once up front, then use this for the rest of that object's lifetime.
  function peek(furnitureKey) {
    const cached = _cache.get(furnitureKey);
    return cached && cached.__value !== undefined ? cached.__value : null;
  }

  function load(furnitureKey) {
    if (_cache.has(furnitureKey)) return _cache.get(furnitureKey);
    const promise = fetch(CONFIG_BASE + furnitureKey + '.json')
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data) => { promise.__value = data; return data; });
    _cache.set(furnitureKey, promise);
    return promise;
  }

  // Builds a full-fidelity THREE.Group from authored `parts`. Each child
  // mesh is tagged with its authored part id in userData so particle/warp/
  // stomp playback (see docs/game.js's processing-station VFX) can find its
  // target part later without re-walking the parts array.
  function buildGroup(data, baseColor) {
    const group = new THREE.Group();
    if (!data || !Array.isArray(data.parts)) return group;
    for (const part of data.parts) {
      const mesh = window.ProceduralFurniture.buildPartMesh(part, baseColor);
      mesh.userData.authoredPartId = part.id;
      group.add(mesh);
    }
    return group;
  }

  // index defaults to 0 (single-seat pieces like chairs/stools); bench-like
  // pieces carry one anchor per seat column, in authoring order.
  function seatAnchorFor(data, index) {
    const anchor = data && data.seatAnchors && data.seatAnchors[index || 0];
    if (!anchor) return null;
    return { position: Object.assign({}, anchor.position), rotation: Object.assign({}, anchor.rotation) };
  }

  function seatCount(data) {
    return data && Array.isArray(data.seatAnchors) ? data.seatAnchors.length : 0;
  }

  window.AuthoredFurniture = {
    load,
    peek,
    buildGroup,
    seatAnchorFor,
    seatCount,
  };
})();
