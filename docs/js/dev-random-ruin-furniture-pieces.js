// Random Test Ruin pieces authored as ordinary furniture
// (docs/config/furniture-authored/*.json, editable in the Furniture Author):
//
//   ruinDoorSeal     one plain circle on each face of a door: its decal
//                    glows OFF (red) while the door is locked and ON (white)
//                    once it can be opened.
//   ruinGlyphTarget  stone plaque with a glyph rune, mounted over each
//                    projectile target face in place of V50's placeholder
//                    inn-sign decals: OFF (orange) until struck, ON (green).
//   ruinGreatDoor    the sanctum door (built by js/dev-random-ruin-sanctum.js).
//   ruinBlueBrazierBowl, ruinStandingBrazier, ruinSanctumLadder,
//   ruinSanctumCoffin, ruinDungeonChestT1-4, ruinRewardPlate
//                    props the sanctum, chest and rope-payoff modules build
//                    via solid(); each keeps its old procedural builder as a
//                    fallback until the JSON has loaded.
//
// Glow colours, textures, sizes and positions all come from those files via
// the shared decal glow support in js/furniture-decal-runtime.js; this module
// only places the pieces and feeds each one its OFF/ON state every frame.
(() => {
  'use strict';

  const A = window.AuthoredFurniture;
  const DS = window.DynamicSurfaces;
  if (!window.THREE || !A?.load || !DS) return;

  const MAP_ID = 'map_i_dev_random_ruin';
  const KEYS = ['ruinDoorSeal', 'ruinGlyphTarget', 'ruinGreatDoor',
    'ruinBlueBrazierBowl', 'ruinStandingBrazier', 'ruinSanctumLadder', 'ruinSanctumCoffin',
    'ruinDungeonChestT1', 'ruinDungeonChestT2', 'ruinDungeonChestT3', 'ruinDungeonChestT4', 'ruinRewardPlate',
    'ruinDisplayPedestal', 'ruinDisplayCoffin'];
  const DISPLAY_SKINS = { displayPedestal:'ruinDisplayPedestal', stoneCoffin:'ruinDisplayCoffin' }; // V50 generatedDisplayType -> authored skin.
  for (const key of KEYS) A.load(key);

  const tracked = new Set(); // { group, state:() => 0..1, flash?:() => 0..1 }
  const pendingSeals = []; // attachSeal() calls made before ruinDoorSeal.json finished loading.
  let sealedRoot = null;

  function ready(key) { return !!A.peek(key); }

  function build(key) {
    const data = A.peek(key);
    if (!data) return null;
    const group = A.buildGroup(data);
    group.userData.ruinFurnitureKey = key;
    group.traverse(node => { node.userData.devRuinFootprintIgnore = true; }); // Visual overlays; collision stays with the piece they decorate.
    return group;
  }

  // Solid prop: keeps collision (the ruin's footprint scan sees its meshes).
  function solid(key) {
    const data = A.peek(key);
    if (!data) return null;
    const group = A.buildGroup(data);
    group.userData.ruinFurnitureKey = key;
    return group;
  }

  // Moves authored parts under a new pivot at `pivotPos` (group-local),
  // keeping where they render. Used for chest hinges and similar.
  function pivotParts(group, partIds, pivotPos, name = 'pivot') {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.copy(pivotPos);
    group.add(pivot);
    for (const id of partIds) {
      const mesh = group.userData.meshById?.get?.(id);
      if (!mesh) continue;
      mesh.parent?.remove(mesh);
      mesh.position.sub(pivotPos);
      pivot.add(mesh);
    }
    return pivot;
  }

  // Bounds of an object's own meshes in its local frame (skips item sprites).
  function localMeshBounds(object) {
    object.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(object.matrixWorld).invert();
    const box = new THREE.Box3(), part = new THREE.Box3(), matrix = new THREE.Matrix4();
    const meshes = [];
    object.traverse(node => {
      if (!node.isMesh || node.userData?.isSurfaceItemSprite || !node.geometry) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      matrix.multiplyMatrices(inverse, node.matrixWorld);
      box.union(part.copy(node.geometry.boundingBox).applyMatrix4(matrix));
      meshes.push(node);
    });
    return { box, meshes };
  }

  // Replaces V50's generated display pedestals / stone coffins with their
  // authored skins, scaled to the generated bounds. The V50 meshes are
  // hidden (their collision comes from the skin via the next solid scan).
  function skinDisplays(root, scope = 'dev-random-ruin-interior') {
    const skins = [];
    root?.traverse?.(object => {
      const key = DISPLAY_SKINS[object.userData?.generatedDisplayType];
      if (!key || object.userData.devRuinDisplaySkin || !ready(key)) return;
      const { box, meshes } = localMeshBounds(object);
      if (box.isEmpty() || !meshes.length) return;
      const skin = solid(key);
      const authored = new THREE.Box3().setFromObject(skin);
      const size = box.getSize(new THREE.Vector3()), from = authored.getSize(new THREE.Vector3());
      skin.scale.set(size.x / (from.x || 1), size.y / (from.y || 1), size.z / (from.z || 1));
      skin.position.set((box.min.x + box.max.x) / 2, box.min.y - authored.min.y * skin.scale.y, (box.min.z + box.max.z) / 2);
      for (const mesh of meshes) mesh.visible = false;
      object.add(skin);
      object.userData.devRuinDisplaySkin = skin;
      skins.push(skin);
    });
    for (const skin of skins) window.DevRandomRuinTileOccupancy?.scanSolids?.(skin, scope); // Only the new skins; the rest of the ruin was scanned at generation.
    return skins.length;
  }

  function track(group, state, flash = null) {
    if (group) tracked.add({ group, state, flash });
    return group;
  }

  function inScene(object) {
    for (let node = object; node; node = node.parent) if (node.isScene) return true;
    return false;
  }

  // Seal centred on a door panel, spanning its thickness so the front/back
  // decals sit just proud of both faces. Rides the panel as it moves.
  function attachSeal(panel, state) {
    if (!panel?.isMesh) return null;
    if (!ready('ruinDoorSeal')) { pendingSeals.push([panel, state]); return null; }
    if (panel.userData.devRuinDoorSeal) return panel.userData.devRuinDoorSeal;
    const seal = build('ruinDoorSeal');
    if (!seal) return null;
    const geometry = panel.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox, size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    panel.updateWorldMatrix(true, false);
    const ws = panel.getWorldScale(new THREE.Vector3());
    const thinX = size.x * ws.x < size.z * ws.z; // Door slab's thin axis in panel space.
    const thickness = (thinX ? size.x * ws.x : size.z * ws.z) + .012;
    const plateDepth = Number(A.peek('ruinDoorSeal')?.parts?.[0]?.transform?.sz) || .02;
    seal.position.copy(center);
    if (thinX) {
      seal.rotation.y = Math.PI / 2;
      seal.scale.set(1 / ws.z, 1 / ws.y, thickness / plateDepth / ws.x);
    } else {
      seal.scale.set(1 / ws.x, 1 / ws.y, thickness / plateDepth / ws.z);
    }
    panel.add(seal);
    panel.userData.devRuinDoorSeal = seal;
    return track(seal, state);
  }

  // Replaces each placeholder decal mesh with a glyph plaque of the same
  // size, standing where the decal stood.
  function mountGlyphPlaques(decalMeshes, state, flash) {
    if (!ready('ruinGlyphTarget')) return [];
    const plaque = A.peek('ruinGlyphTarget').parts?.[0]?.transform || { sx:.5, sy:.5 };
    const mounted = [];
    for (const mesh of decalMeshes || []) {
      if (!mesh?.parent || mesh.userData.devRuinGlyphPlaque) continue;
      const params = mesh.geometry?.parameters || {};
      const w = Number(params.width) || .5, h = Number(params.height) || .5;
      const group = build('ruinGlyphTarget');
      if (!group) break;
      group.position.copy(mesh.position);
      group.quaternion.copy(mesh.quaternion);
      group.scale.set(w / (Number(plaque.sx) || .5), h / (Number(plaque.sy) || .5), 1);
      mesh.parent.add(group);
      mesh.visible = false;
      mesh.userData.devRuinGlyphPlaque = group;
      mounted.push(track(group, state, flash));
    }
    return mounted;
  }

  // Locked (0) while a door is sealed, gated by a puzzle, or held shut from
  // outside (ossuary lock, rope plate) and still closed; otherwise open (1).
  function doorState(mechanismId) {
    return () => {
      const info = window.DevRandomRuin?.mechanismInfo?.(mechanismId);
      if (!info) return 1;
      if (info.progress > .5) return 1;
      if (info.locked) return 0;
      if (info.gated || info.externalTarget != null) return 0;
      return 1;
    };
  }

  function sealRuinDoors(root) {
    root.traverse(object => {
      const d = object.userData || {};
      const isStone = d.previewMotion?.type === 'stoneDoor' && d.mechanismId;
      if (!isStone && !d.transitDoor) return;
      const panel = (object.children || []).find(child => child?.isMesh && child.geometry) || null;
      if (panel) attachSeal(panel, isStone ? doorState(String(d.mechanismId)) : () => 1); // Hallway exit doors always open by hand.
    });
  }

  const flashWhite = new THREE.Color(0xffffff);
  DS.addBeforeRenderClient(() => {
    const now = performance.now();
    const root = window.DevRandomRuin?.getRuntimeContext?.()?.root || null;
    if (root && root !== sealedRoot && ready('ruinDoorSeal') && window.GridTileAccessors?.getCurrentArea?.() === MAP_ID) {
      sealedRoot = root;
      sealRuinDoors(root);
      skinDisplays(root); // Displays the sanctum composer did not already skin.
    }
    if (pendingSeals.length && ready('ruinDoorSeal')) for (const [panel, state] of pendingSeals.splice(0)) attachSeal(panel, state);
    const decals = window.FurnitureDecalRuntime;
    for (const entry of tracked) {
      if (!inScene(entry.group)) { if (!entry.group.parent) tracked.delete(entry); continue; }
      decals?.setGlowState?.(entry.group, entry.state());
      decals?.updateGlow?.(entry.group, now);
      const flash = entry.flash ? entry.flash() : 0; // Glyph targets flash white on the hit frame.
      if (flash > 0) for (const mesh of entry.group.userData.glowDecalMeshes || []) mesh.material.color.lerp(flashWhite, flash);
    }
  });

  window.DevRandomRuinFurniturePieces = Object.freeze({
    KEYS, ready, build, solid, pivotParts, skinDisplays, track, attachSeal, mountGlyphPlaques,
    snapshot:() => ({
      loaded:Object.fromEntries(KEYS.map(key => [key, ready(key)])),
      tracked:[...tracked].map(entry => ({ key:entry.group.userData.ruinFurnitureKey, state:+Number(entry.state()).toFixed(2), inScene:inScene(entry.group) })),
    }),
  });
})();
