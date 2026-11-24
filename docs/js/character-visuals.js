// Character visuals: one enumeration of every drawn character, and the table of
// which visual systems cover which kind of character (window.CharacterVisuals).
//
// WHY THIS EXISTS
// The player, NPC walkers, enemies, creatures, companions, mounts and shoulder
// pets are all "characters" visually: PNG-plane portraits on rigs, with hands,
// pants, held tools/items, a ground shadow, outlines, and a response to the
// terrain and weather around them. Historically each visual system found its
// characters its own way (the composer's playerMesh, the planner's walker list,
// Combat's hostile/companion Sets, FarmAnimals' Set...) and many were written
// for the player first. This module is where a visual system asks "which
// characters are in this area?" so a new visual applies to every character by
// default, and where the coverage of each system is written down.
//
// RULE: a character visual is written for any character. If it can only serve
// the player today, add it to CAPABILITIES with `gap` explaining why, so the
// audit shows it, rather than adding another player-only path.
//
// API
//   KINDS                                  the character kinds below
//   registerProvider({ id, each(area, visit) })   visit(kind, root, entity, ownerRoot)
//   forEachCharacter(area, visit, kinds?)  live enumeration, no allocation per call
//   portraitMeshOf(root)                   the character's main PNG portrait mesh (cached)
//   CAPABILITIES                           system -> kinds covered, owner file, gaps
//   audit(area)                            counts by kind + capability table + player-only gaps
//
// game.js registers the provider (player, walkers, hostiles, companions,
// corpses, farm animals). Debug: `CharacterVisuals.audit()` in the console.
(() => {
  'use strict';

  if (window.CharacterVisuals) return;

  const KINDS = Object.freeze({
    PLAYER: 'player',
    NPC: 'npc', // Scheduled town/world NPC walkers.
    ENEMY: 'enemy', // Humanoid hostiles driven by BanditCombat (bandits, tribes, ghouls, skeletons, liches...).
    CREATURE: 'creature', // Hostile or wild animals.
    COMPANION: 'companion',
    MOUNT: 'mount',
    SHOULDER_PET: 'shoulderPet', // Companion perched on an owner character; ownerRoot is that character's root.
    CORPSE: 'corpse',
    FARM_ANIMAL: 'farmAnimal',
  });
  const ALL = Object.freeze(Object.values(KINDS));
  const HUMANOIDS = Object.freeze([KINDS.PLAYER, KINDS.NPC, KINDS.ENEMY]);
  const ANIMALS = Object.freeze([KINDS.CREATURE, KINDS.COMPANION, KINDS.MOUNT, KINDS.SHOULDER_PET, KINDS.CORPSE, KINDS.FARM_ANIMAL]);

  // Which character kinds each visual system serves. Keep this accurate when
  // you generalize or add a system; `gap` names what is still missing.
  const CAPABILITIES = Object.freeze([
    { id: 'held-tool-mesh', owner: 'character-held-tools.js', covers: HUMANOIDS,
      note: 'One factory builds every held tool/weapon plane. Mastery effects and metal plating come from the holder (player gear, enemy loadout), never implicitly from the player.' },
    { id: 'held-xray', owner: 'held-object-render-order.js', covers: [KINDS.PLAYER],
      gap: 'Held weapons, hands and feet x-ray through grass and nearby ground for the player and short species (porakaneki) only. Other NPCs and enemies draw their hands with ordinary depth, feet only within 6 tiles of the camera, and (by default, a user decision on 20 Nov 2026 after a GTX 1060 benchmark: ~11 ms a frame near a camp) their weapons and tools in the base pass with their bearer, fogged by mist like them. Settings → Render optimizations → "NPC and enemy weapons in the base pass" off gives every weapon x-ray again.' },
    { id: 'hat-overflow-plane', owner: 'hat-overflow-plane.js', covers: HUMANOIDS,
      note: 'Hat pixels past the portrait square ride the head bone on a bounds-free plane. Players/NPCs via the avatar builder, split bandit planes via attachToPlanes, compound riders via attach on the rider root.' },
    { id: 'held-bag-item-plane', owner: 'game.js (updateHeldItemHolder)', covers: [KINDS.PLAYER],
      gap: 'NPCs hold tools/weapons through npc-held-equipment-v4.js but never bag items (food, flasks, seeds).' },
    { id: 'procedural-hands', owner: 'procedural-hand-frame-driver.js', covers: HUMANOIDS,
      note: 'One managed rig per avatar; grips come from hand-tool-grips.js for any holder.' },
    { id: 'pants-garment', owner: 'pants-garment-renderer.js', covers: HUMANOIDS,
      note: 'Player mesh resolution is higher unless the "Player uses the NPC mesh cap" setting is on.' },
    { id: 'ground-shadow', owner: 'character-ground-shadow.js', covers: ALL.filter(kind => kind !== KINDS.SHOULDER_PET) },
    { id: 'portrait-life', owner: 'world-portrait-life.js', covers: [KINDS.PLAYER, KINDS.NPC],
      gap: 'Blink/breathing/default expression for walkers only; enemies keep a static portrait (animals blink via creature-blink.js).' },
    { id: 'outline-occlusion', owner: 'png-plane-outline-occluder.js', covers: ALL,
      note: 'Every PNG plane joins PNG_OCCLUDER so outlines behind any character are hidden.' },
    { id: 'rig-transform-layers', owner: 'rig-transform-layers.js', covers: ALL,
      note: 'Per-node pose channels/leases shared by every rig.' },
    { id: 'render-body-composition', owner: 'player-body-transform-composer.js', covers: [KINDS.PLAYER, KINDS.SHOULDER_PET],
      gap: 'Render-time world-space body composition (stance yaw, lean, deadzone correction, head aim, neck limit) is player-only; NPC/enemy rigs apply their poses directly through rig-transform-layers.js. The shoulder pet is covered as an attachment of the player.' },
    { id: 'terrain-height', owner: 'movement (player/NPC/enemy) + animal-subtle-elevation-bridge.js', covers: ALL,
      note: 'Humanoid Y is movement-owned (terrain, walkable supports). Creatures, companions, mounts, corpses and farm animals get the render-time lift; a shoulder pet inherits its owner.' },
    { id: 'water-tint', owner: 'held-object-render-order.js', covers: [...HUMANOIDS, KINDS.SHOULDER_PET],
      note: 'Front/back portrait planes under translucent water or slush are tinted; feet that stand in water stay under it.' },
    { id: 'mist-depth-occluder', owner: 'cloud-forest-avatar-depth-occluder.js', covers: ALL,
      note: 'Cloud Forest mist / Western Slope blowing snow: any character whose portrait does not write depth gets a depth-only silhouette so mist layers sit behind it consistently.' },
    { id: 'shoulder-pet-perch', owner: 'shoulder-pet-attachment-runtime.js', covers: [KINDS.PLAYER],
      gap: 'The runtime is owner-generic (create({ getOwnerMesh, getOwnerNeckJoint })), but only the player owns a shoulder pet in gameplay today.' },
    { id: 'carried-infant', owner: 'family-baby-burdens.js + config/family-baby-carry-pose.js + family-baby-limbs.js + shattercasks.js (solveCarryMount)', covers: [KINDS.PLAYER, KINDS.NPC],
      note: 'A carried family baby looks the same on any carrier: one shared cradle/back-stow pose solve on the carrier\'s own posterior, the same authored two-hand grips and elbows (NPCs through proceduralHeldItemTarget), back stow mounted on the carrier\'s portrait, and cloned kicking 3D hands/feet.' },
    { id: 'render-culling', owner: 'npc-view-frustum-cull.js, actor-render-occlusion.js', covers: [KINDS.NPC, KINDS.ENEMY, KINDS.CREATURE, KINDS.CORPSE],
      note: 'Render-only hiding of off-camera or covered characters; the player is never culled.' },
    { id: 'weather-wetness-snow-wind', owner: '(none)', covers: [],
      gap: 'No character shows rain wetness, snow on the body, or wind on clothing/fur. Absent for everyone, not player-only.' },
  ]);

  const providers = [];
  function registerProvider(spec) {
    if (!spec?.id || typeof spec.each !== 'function') throw new Error('CharacterVisuals.registerProvider needs { id, each }');
    const existing = providers.findIndex(provider => provider.id === spec.id);
    if (existing >= 0) providers.splice(existing, 1);
    providers.push({ id: spec.id, each: spec.each });
    return () => {
      const index = providers.findIndex(provider => provider.id === spec.id);
      if (index >= 0) providers.splice(index, 1);
    };
  }

  // visit(kind, root, entity, ownerRoot); return true from visit to stop early.
  // options.includeHidden: also hidden/detached characters (diagnostics only).
  function forEachCharacter(area, visit, kinds = null, options = null) {
    let stopped = false;
    const filtered = kinds ? (kind, root, entity, owner) => {
      if (stopped || !kinds.includes(kind)) return stopped;
      if (visit(kind, root, entity, owner) === true) stopped = true;
      return stopped;
    } : (kind, root, entity, owner) => {
      if (stopped) return true;
      if (visit(kind, root, entity, owner) === true) stopped = true;
      return stopped;
    };
    for (const provider of providers) {
      if (stopped) break;
      try { provider.each(area, filtered, options); }
      catch (error) { console.warn(`[CharacterVisuals] provider ${provider.id} failed`, error); }
    }
  }

  // The character's main PNG portrait mesh: the skinned/plain avatar mesh whose
  // materials are the shared avatar materials (player and NPC/enemy avatars all
  // use the npc_avatar_* material names). Cached per root; revalidated when the
  // cached mesh leaves the root (portrait rebuilds).
  const portraitCache = new WeakMap();
  function isUnder(object, root) {
    for (let node = object; node; node = node.parent) if (node === root) return true;
    return false;
  }
  function portraitScore(object) {
    if ((!object?.isMesh && !object?.isSkinnedMesh) || object.userData?.cloudForestAvatarDepthOccluder) return -1;
    const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
    let score = 0;
    for (const material of materials) {
      const name = String(material?.name || '');
      if (name.includes('npc_avatar_skinned_')) score += 8;
      else if (name.includes('npc_avatar_')) score += 4;
      if (material?.map) score += 1;
    }
    return materials.length ? score : -1;
  }
  function portraitMeshOf(root) {
    if (!root?.traverse) return null;
    const cached = portraitCache.get(root);
    if (cached && isUnder(cached, root)) return cached;
    let best = null;
    let bestScore = 0;
    root.traverse(object => {
      const score = portraitScore(object);
      if (score > bestScore) { best = object; bestScore = score; }
    });
    if (best) portraitCache.set(root, best);
    else portraitCache.delete(root);
    return best;
  }

  function audit(area = null) {
    const counts = {};
    for (const kind of ALL) counts[kind] = 0;
    if (area != null) forEachCharacter(area, kind => { counts[kind] = (counts[kind] || 0) + 1; });
    return {
      area,
      characters: counts,
      providers: providers.map(provider => provider.id),
      capabilities: CAPABILITIES.map(entry => ({
        id: entry.id,
        owner: entry.owner,
        covers: entry.covers.slice(),
        missing: ALL.filter(kind => !entry.covers.includes(kind)),
        playerOnly: entry.covers.length === 1 && entry.covers[0] === KINDS.PLAYER,
        note: entry.note || null,
        gap: entry.gap || null,
      })),
      playerOnly: CAPABILITIES.filter(entry => entry.covers.length && entry.covers.every(kind => kind === KINDS.PLAYER || kind === KINDS.SHOULDER_PET)).map(entry => entry.id),
    };
  }

  // ── "Why can't I see this character?" ───────────────────────────────────
  // For every character in the area: each portrait part's own and ancestor
  // visibility, world position, camera layer and frustum tests, material
  // state, and (captureVisibilityReport) whether it was actually in the main
  // pass's draw list, plus render hook / scope / replay errors. Read-only.
  function partsOf(root, entity) {
    const front = entity?.avatarRef?.frontPlane || null; // Animal/pet art: separate front and back planes.
    const back = entity?.avatarRef?.backPlane || null;
    if (front || back) return [['front', front], ['back', back]].filter(([, part]) => part);
    const portrait = portraitMeshOf(root);
    return portrait ? [['portrait', portrait]] : [];
  }
  const NEAR_TILES = 15; // Closer than this, "hidden on purpose" is reported as suspicious.
  const finite3 = v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  const round = v => Math.round(v * 100) / 100;
  function describePart(label, mesh, ctx) {
    const THREE = window.THREE;
    let hiddenBy = null, inScene = false;
    for (let node = mesh; node; node = node.parent) {
      if (node.visible === false && !hiddenBy) hiddenBy = node === mesh ? '(self)' : (node.name || node.type);
      if (node.isScene) inScene = node === ctx.scene;
    }
    const world = new THREE.Vector3();
    mesh.updateWorldMatrix?.(true, false);
    mesh.getWorldPosition?.(world);
    const det = mesh.matrixWorld?.determinant?.() ?? 1;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);
    let inFrustum = null;
    if (ctx.frustum && mesh.geometry) {
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere?.();
      const sphere = mesh.geometry.boundingSphere ? mesh.geometry.boundingSphere.clone().applyMatrix4(mesh.matrixWorld) : null;
      if (sphere && Number.isFinite(sphere.radius)) { sphere.radius += 1; inFrustum = ctx.frustum.intersectsSphere(sphere); } // Padded: skinned parts move off their bind pose.
    }
    const issues = [];
    if (hiddenBy) issues.push('hidden by ' + hiddenBy);
    if (!inScene) issues.push('not in the active scene');
    if (!finite3(world)) issues.push('non-finite position');
    if (!(Math.abs(det) > 1e-12)) issues.push('zero/invalid scale');
    if (ctx.camera && !ctx.camera.layers.test(mesh.layers)) issues.push(`layers 0x${(mesh.layers.mask >>> 0).toString(16)} not seen by camera`);
    if (inFrustum === false) issues.push('outside camera frustum');
    for (const m of materials) {
      if (m.visible === false) issues.push('material hidden');
      if (m.colorWrite === false) issues.push('colorWrite off');
      if (m.transparent && !(m.opacity > 0.01)) issues.push(`opacity ${m.opacity}`);
      if (m.map && !(m.map.image?.width > 0)) issues.push('texture not loaded');
    }
    if (ctx.drawn && !ctx.drawn.has(mesh) && !hiddenBy && inScene) issues.push('not in main-pass draw list');
    return {
      part: label,
      name: mesh.name || mesh.type,
      visibleSelf: mesh.visible !== false,
      hiddenBy,
      inScene,
      position: [round(world.x), round(world.y), round(world.z)],
      layers: '0x' + (mesh.layers.mask >>> 0).toString(16),
      inFrustum,
      drawnLastFrame: ctx.drawn ? ctx.drawn.has(mesh) : null,
      renderOrder: mesh.renderOrder,
      materials: materials.map(m => ({ name: m.name || m.type, visible: m.visible !== false, opacity: round(Number(m.opacity)), transparent: !!m.transparent,
        depthWrite: m.depthWrite !== false, depthTest: m.depthTest !== false, colorWrite: m.colorWrite !== false, alphaTest: m.alphaTest || 0 })),
      issues,
    };
  }
  function visibilityReport(options = {}) {
    const area = options.area ?? window.GridTileAccessors?.getCurrentArea?.() ?? null;
    const scene = options.scene ?? window.GridTileAccessors?.getActiveScene?.() ?? null;
    const camera = options.camera ?? window.WorldRenderPipeline?.camera ?? null;
    const THREE = window.THREE;
    let frustum = null;
    if (camera?.projectionMatrix && THREE?.Frustum) {
      camera.updateMatrixWorld?.(true);
      frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    const ctx = { scene, camera, frustum, drawn: options.drawn || null };
    const characters = [];
    if (area != null) forEachCharacter(area, (kind, root, entity) => {
      const parts = partsOf(root, entity).map(([label, mesh]) => describePart(label, mesh, ctx));
      let rootHiddenBy = null;
      for (let node = root; node; node = node.parent) if (node.visible === false) { rootHiddenBy = node.name || node.type; break; }
      // Wildlife the game hides on purpose (den, distance LOD, not streamed in yet).
      const intended = kind === KINDS.PLAYER ? null
        : entity?._denHidden ? 'resting in its den'
          : entity?._wildlifeVisualLodHidden ? 'far away (wildlife visual LOD)'
            : entity?.streamVisuals && !entity?._wildlifeVisualsReleased ? 'visuals not streamed in yet' : null;
      characters.push({ kind, name: entity?.def?.label || entity?.creatureKey || entity?.name || root?.name || kind, rootHiddenBy, parts, intended,
        issues: parts.length ? parts.flatMap(part => part.issues.map(issue => `${part.part}: ${issue}`)) : ['no portrait mesh found'] });
    }, null, { includeHidden: true });
    // Distance to the player decides whether "hidden on purpose" is believable:
    // an attacker beside the player should never be LOD- or den-hidden.
    const playerPart = characters.find(c => c.kind === KINDS.PLAYER)?.parts[0];
    for (const c of characters) {
      const part = c.parts[0];
      c.tilesFromPlayer = playerPart && part ? round(Math.hypot(part.position[0] - playerPart.position[0], part.position[2] - playerPart.position[2])) : null;
      c.hiddenByDesign = !!c.intended && !(c.tilesFromPlayer != null && c.tilesFromPlayer < NEAR_TILES);
    }
    const hooks = window.RenderHooks?.getDebug?.();
    const pipeline = window.WorldRenderPipeline?.snapshot?.();
    const held = (() => { try { return window.HeldObjectRenderOrder?.snapshot?.() || null; } catch (_) { return null; } })();
    return {
      at: new Date().toISOString(),
      area,
      cameraPosition: camera ? [round(camera.position.x), round(camera.position.y), round(camera.position.z)] : null,
      cameraFinite: camera ? finite3(camera.position) : null,
      characters,
      hookErrors: (hooks?.hooks || []).filter(hook => hook.errors).map(hook => ({ id: hook.id, errors: hook.errors, lastError: hook.lastError || null })),
      scopeErrors: (pipeline?.scopes || []).filter(scope => scope.errors).map(scope => ({ id: scope.id, errors: scope.errors, lastError: scope.lastError || null })),
      heldInvariantRepairs: held?.invariantRepairs ?? null,
    };
  }
  // Records what the next frame's main pass actually draws, then reports.
  async function captureVisibilityReport(options = {}) {
    const drawn = new Set();
    const pipeline = window.WorldRenderPipeline;
    let captured = false;
    let camera = null; // The camera the main pass actually used.
    const off = window.RenderHooks?.register?.({
      id: 'character-visibility-report', owner: 'character-visuals.js', order: 1e9 - 1,
      afterRender: ctx => {
        if (captured || pipeline?.currentPass?.() !== 'main') return;
        captured = true; // The main pass's first (base) render only.
        camera = ctx.camera || null;
        const list = ctx.renderer?.renderLists?.get?.(ctx.scene, ctx.depth || 0);
        for (const items of [list?.opaque, list?.transmissive, list?.transparent]) for (const item of items || []) drawn.add(item.object);
      },
    });
    try {
      for (let i = 0; i < 3 && !captured; i++) await new Promise(resolve => requestAnimationFrame(resolve));
    } finally { off?.(); }
    const report = visibilityReport({ camera: camera || undefined, ...options, drawn: captured ? drawn : null });
    report.text = [
      `Character visibility — ${report.at} — area ${report.area}; camera ${report.cameraFinite === false ? 'NON-FINITE ' : ''}${JSON.stringify(report.cameraPosition)}; main pass captured ${captured}`,
      ...report.characters.filter(c => !c.hiddenByDesign).map(c => `${c.kind} ${c.name}${c.tilesFromPlayer != null ? ` (${c.tilesFromPlayer} tiles)` : ''}: ${c.issues.length ? c.issues.join('; ') : 'ok'}${c.intended ? ` — flagged "${c.intended}" yet close to the player` : ''} ${c.parts.map(p => `[${p.part} ${p.name} pos ${p.position.join(',')} layers ${p.layers} drawn ${p.drawnLastFrame}]`).join(' ')}`),
      (byDesign => byDesign.length ? `hidden by design, far from the player: ${Object.entries(byDesign.reduce((acc, c) => { acc[c.intended] = (acc[c.intended] || 0) + 1; return acc; }, {})).map(([why, n]) => `${n} ${why}`).join(', ')}` : 'hidden by design: none')(report.characters.filter(c => c.hiddenByDesign)),
      `hook errors ${JSON.stringify(report.hookErrors)}; scope errors ${JSON.stringify(report.scopeErrors)}; held invariant repairs ${report.heldInvariantRepairs}`,
    ].join('\n');
    return report;
  }

  window.CharacterVisuals = Object.freeze({
    KINDS,
    ALL_KINDS: ALL,
    HUMANOID_KINDS: HUMANOIDS,
    ANIMAL_KINDS: ANIMALS,
    CAPABILITIES,
    registerProvider,
    forEachCharacter,
    portraitMeshOf,
    audit,
    visibilityReport,
    captureVisibilityReport,
  });
})();
