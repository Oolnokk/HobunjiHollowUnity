// Feeds Random Test Ruin runtime controls directly into the game's ordinary
// world interaction input-list popup. It also exposes V50 stone ladders as real
// nearby interactions instead of leaving their unnamed rung meshes opaque.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const LADDER_RANGE = 1.7;
  const SEMANTIC_RESCAN_MS = 250;
  const SLOT_ACTIONS = ['action1', 'action2', 'action3', 'itemAction1', 'itemAction2'];
  const TOUCH_BUTTON_IDS = ['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2'];
  const INPUT_CLAIM_OWNER = 'dev-random-ruin'; // Shared input-ownership registry key; explicit Action 1 interactions can suppress combat without hardcoding ruin logic into the weapon system.
  const GridTileAccessors = window.GridTileAccessors;
  const DS = window.DynamicSurfaces;
  const DevSpawner = window.DevSpawner;
  if (!GridTileAccessors || !DS || !DevSpawner) return;

  let deps = null;
  let lastRows = [];
  let lastAnchor = null;
  let lastRowsSignature = ''; // Used to ask the normal action bar for a rebuild only when nearby ruin interactions actually change.
  let preparedRoot = null;
  let ladders = [];
  let lastSemanticScanAt = -Infinity; // Used to discover V50 interactables that are appended after the ruin root first appears.

  const nativeDevInit = DevSpawner.init;
  DevSpawner.init = function (injectedDeps) {
    deps = injectedDeps;
    return nativeDevInit.call(this, injectedDeps);
  };

  function inRuin() {
    return GridTileAccessors.getCurrentArea?.() === MAP_ID;
  }

  function activeScene() {
    return GridTileAccessors.getActiveScene?.() || null;
  }

  function ruinRoot() {
    const scene = activeScene();
    return scene?.children?.find?.(object => /^dev_v50_ruin_/.test(object?.name || '')) || null;
  }

  function matrixFromForeign(object) {
    object?.updateWorldMatrix?.(true, false);
    object?.updateMatrixWorld?.(true);
    const elements = object?.matrixWorld?.elements;
    if (!elements || elements.length < 16) return null;
    return new THREE.Matrix4().fromArray(Array.from(elements, Number));
  }

  function worldPosition(object) {
    const matrix = matrixFromForeign(object);
    return matrix ? new THREE.Vector3().setFromMatrixPosition(matrix) : null;
  }

  function playerWorldPosition() {
    if (deps?.player && Number.isFinite(deps.TILE) && deps.TILE) {
      return new THREE.Vector3(deps.player.x / deps.TILE, Number(deps.playerMesh?.position?.y) || 0, deps.player.y / deps.TILE);
    }
    const scene = activeScene();
    for (const name of ['player_root', 'player']) {
      const object = scene?.getObjectByName?.(name);
      const pos = object && worldPosition(object);
      if (pos) return pos;
    }
    let found = null;
    scene?.traverse?.(object => {
      if (found || !(object.userData?.isPlayer || object.userData?.playerCharacter)) return;
      found = worldPosition(object);
    });
    return found;
  }

  // A pixel/raycast normally hits a ladder rung or rail, not the tagged Group.
  // Walk upward until we reach the semantic V50 gameplay owner.
  function resolveInteractionOwner(object) {
    for (let node = object; node; node = node.parent) {
      const d = node.userData || {};
      if (
        d.generatedAccessType === 'stoneLadder' ||
        d.generatedAccessType === 'stoneStair' ||
        d.transitDoor || d.activatorType || d.pushable || d.interactive3D ||
        d.elevatorWellSocket || d.staticPuzzleDais || d.mechanismId
      ) return node;
      if (/^dev_v50_ruin_/.test(node.name || '')) break;
    }
    return null;
  }

  function semanticKind(object) {
    const d = object?.userData || {};
    if (d.generatedAccessType === 'stoneLadder') return 'ladder';
    if (d.generatedAccessType === 'stoneStair') return 'stair';
    if (d.transitDoor) return 'transitdoor';
    if (d.activatorType) return String(d.activatorType).toLowerCase();
    if (d.pushable) return String(d.previewMotion?.type || 'pushblock').toLowerCase();
    if (d.elevatorWellSocket) return 'elevatorsocket';
    if (d.staticPuzzleDais) return 'platform';
    if (d.interactive3D) return 'interactive';
    if (d.mechanismId) return String(d.previewMotion?.type || 'mechanism').toLowerCase();
    return '';
  }

  function tagLadder(root, index) {
    if (!root) return;
    if (!root.name) root.name = `dev_ruin_stone_ladder_${index + 1}`;
    root.userData.devRuinInteractionType = 'stoneLadder';
    root.userData.interactive3D = true;
    let part = 0;
    root.traverse?.(object => {
      if (object === root || !object.isMesh) return;
      part++;
      if (!object.name) object.name = `${root.name}_part_${part}`;
      object.userData.devRuinInteractionType = 'stoneLadderPart';
      object.userData.devRuinInteractionRootName = root.name;
    });
  }

  function prepareSemanticObjects(now = performance.now()) {
    const root = ruinRoot();
    if (root !== preparedRoot) {
      preparedRoot = root;
      ladders = [];
      lastSemanticScanAt = -Infinity;
    }
    if (!root?.traverse || now - lastSemanticScanAt < SEMANTIC_RESCAN_MS) return;
    lastSemanticScanAt = now;
    const discoveredLadders = []; // Used to replace the live ladder list after each throttled V50 hierarchy rescan.
    root.traverse(object => {
      if (object.userData?.generatedAccessType === 'stoneLadder') discoveredLadders.push(object);
    });
    ladders = discoveredLadders;
    ladders.forEach(tagLadder);
  }

  function kindMatches(kind, owner) {
    const ownerKind = semanticKind(owner);
    const hay = `${kind} ${ownerKind}`.toLowerCase();
    if (kind.includes('ladder')) return ownerKind === 'ladder';
    if (kind.includes('stair')) return ownerKind === 'stair';
    if (kind.includes('transit') || kind.includes('door')) return hay.includes('door');
    if (kind.includes('cube')) return hay.includes('cube') || !!owner?.userData?.interactive3D;
    if (kind.includes('brazier')) return hay.includes('brazier');
    if (kind.includes('glyph')) return hay.includes('glyph');
    if (kind.includes('obelisk')) return hay.includes('obelisk');
    if (kind.includes('push') || kind.includes('block')) return hay.includes('push') || hay.includes('block');
    if (kind.includes('platform') || kind.includes('dais')) return hay.includes('platform') || hay.includes('dais');
    return true;
  }

  function nearestOwnerForKind(kind = '') {
    const root = ruinRoot();
    if (!root?.traverse) return null;
    const player = playerWorldPosition();
    let best = null;
    let bestDist = Infinity;
    root.traverse(object => {
      const owner = resolveInteractionOwner(object);
      if (!owner || owner !== object || !kindMatches(kind, owner)) return;
      const pos = worldPosition(owner);
      const dist = player && pos ? (pos.x - player.x) ** 2 + (pos.z - player.z) ** 2 : 0;
      if (dist < bestDist) { bestDist = dist; best = owner; }
    });
    return best;
  }

  function nearestLadder() {
    prepareSemanticObjects();
    const player = playerWorldPosition();
    if (!player) return null;
    let best = null;
    let bestDist = LADDER_RANGE * LADDER_RANGE;
    for (const ladder of ladders) {
      const pos = worldPosition(ladder);
      if (!pos) continue;
      const dist = (pos.x - player.x) ** 2 + (pos.z - player.z) ** 2;
      if (dist <= bestDist) { bestDist = dist; best = { ladder, distance:Math.sqrt(dist) }; }
    }
    return best;
  }

  function supportCandidatesForLadder(ladder) {
    const matrix = matrixFromForeign(ladder);
    if (!matrix) return [];
    const e = matrix.elements;
    const origin = new THREE.Vector3(e[12], e[13], e[14]);
    const axis = new THREE.Vector3(e[0], 0, e[2]);
    if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
    axis.normalize();
    const scaleY = Math.max(1e-5, Math.hypot(e[4], e[5], e[6]));
    const height = Math.max(.25, Number(ladder.userData?.ladderHeight) || .8) * scaleY;
    const expectedTop = origin.y;
    const expectedBottom = origin.y - height;
    const candidates = [];
    const lateral = new THREE.Vector3(-axis.z, 0, axis.x); // Along the ladder's wall: a prop right beside the top can hide the straight-out probes.
    for (const sign of [-1, 1]) {
      for (const [offset, side] of [[.34, 0], [.52, 0], [.72, 0], [.94, 0], [1.16, 0], [1.45, 0], [.72, .45], [.72, -.45], [1.16, .6], [1.16, -.6]]) {
        const x = origin.x + axis.x * offset * sign + lateral.x * side;
        const z = origin.z + axis.z * offset * sign + lateral.z * side;
        const support = DS.sampleSupport?.(x, z, { minY:expectedBottom - .65, maxY:expectedTop + .65, pad:.02 });
        if (!support || !Number.isFinite(Number(support.y))) continue;
        const blocker = DS.blockerAt?.(x, z, { radius:.18, actorHeight:1.25 }) || null;
        candidates.push({ x, z, y:Number(support.y), supportId:support.id || null, blocked:!!blocker, blockerId:blocker?.id || null, offset, sign });
      }
    }
    return { candidates, expectedTop, expectedBottom };
  }

  // Nearest unblocked spot at the same floor height around a blocked landing.
  function freeLandingNear(ladder, landing) {
    const pos = worldPosition(ladder);
    if (!pos) return null;
    let best = null;
    for (const radius of [.45, .7, .95, 1.2, 1.5, 1.8]) {
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2, x = pos.x + Math.cos(a) * radius, z = pos.z + Math.sin(a) * radius;
        const support = DS.sampleSupport?.(x, z, { minY:landing.y - .2, maxY:landing.y + .2, pad:.02 });
        if (!support || Math.abs(Number(support.y) - landing.y) > .15) continue;
        if (DS.blockerAt?.(x, z, { radius:.18, actorHeight:1.25 })) continue;
        const d = (x - landing.x) ** 2 + (z - landing.z) ** 2;
        if (!best || d < best.d) best = { x, z, y:Number(support.y), supportId:support.id || null, blocked:false, offset:radius, sign:landing.sign, d };
      }
      if (best) return best;
    }
    return null;
  }

  function chooseLadderEndpoints(ladder) {
    const resolved = supportCandidatesForLadder(ladder);
    if (!resolved?.candidates?.length) return null;
    // Unblocked landings first, but never let a blocked upper (or lower) side
    // drop that side entirely: both endpoints used to come from the one clear
    // side, collapse to the same height, and refuse the climb.
    const rank = (list, targetY) => [...list].sort((a, b) => (a.blocked - b.blocked) || Math.abs(a.y - targetY) - Math.abs(b.y - targetY) || a.offset - b.offset);
    const pool = resolved.candidates;
    const topSorted = rank(pool, resolved.expectedTop).filter(candidate => Math.abs(candidate.y - resolved.expectedTop) < .45).concat(rank(pool, resolved.expectedTop));
    const bottomSorted = rank(pool, resolved.expectedBottom).filter(candidate => Math.abs(candidate.y - resolved.expectedBottom) < .45).concat(rank(pool, resolved.expectedBottom));
    let top = topSorted[0] || null;
    let bottom = bottomSorted.find(candidate => !top || candidate.sign !== top.sign || Math.abs(candidate.y - top.y) > .15) || bottomSorted[0] || null;
    if (!top || !bottom) return null;
    if (top.y < bottom.y) [top, bottom] = [bottom, top];
    if (top.blocked) top = freeLandingNear(ladder, top) || top; // e.g. a V50 display coffin filling a small dais right at the ladder head.
    if (Math.abs(top.y - bottom.y) < .12) return null;
    return { top, bottom };
  }

  function climbLadder(ladder) {
    if (!deps?.player || !deps.TILE) return false;
    const endpoints = chooseLadderEndpoints(ladder);
    if (!endpoints) {
      deps.showToast?.('The ladder endpoints could not be resolved.', false);
      return false;
    }
    const currentSupport = DS.sampleSupport?.(deps.player.x / deps.TILE, deps.player.y / deps.TILE, { minY:-8, maxY:12, pad:.02 });
    const currentY = Number.isFinite(Number(currentSupport?.y)) ? Number(currentSupport.y) : Number(deps.playerMesh?.position?.y) || 0;
    const midpoint = (endpoints.top.y + endpoints.bottom.y) * .5;
    const target = currentY >= midpoint ? endpoints.bottom : endpoints.top;
    const deltaY=Math.abs(target.y-currentY);
    const playerX=deps.player.x/deps.TILE, playerZ=deps.player.y/deps.TILE;
    const animated=window.ClimbSystem?.startScriptedWorldClimb?.({
      endX:target.x*deps.TILE,
      endY:target.z*deps.TILE,
      startWorldY:currentY,
      endWorldY:target.y,
      hopCount:Math.max(3,Math.ceil(deltaY/.38)+1),
      facingAngle:Math.atan2(target.z-playerZ,target.x-playerX),
    });
    if(!animated&&!window.DevRandomRuin?.setPlayerWorldPoint?.({ x:target.x, y:target.y, z:target.z }, { grounded:true })) return false;
    return true;
  }

  function controlWorldPoint(control, owner) {
    const point = control?.point;
    if (Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.z))) {
      return new THREE.Vector3(Number(point.x), Number(point.y) || 0, Number(point.z));
    }
    return owner ? worldPosition(owner) : null;
  }

  function horizontalDistanceToOwner(owner, player, fallbackPoint = null) {
    if (owner && player) {
      try {
        owner.updateWorldMatrix?.(true, true);
        owner.updateMatrixWorld?.(true);
        const box = new THREE.Box3().setFromObject(owner); // Range is measured from the visible tower/cube surface, matching how its collision feels.
        if (!box.isEmpty()) {
          const nearestX = Math.max(box.min.x, Math.min(player.x, box.max.x));
          const nearestZ = Math.max(box.min.z, Math.min(player.z, box.max.z));
          return Math.hypot(nearestX - player.x, nearestZ - player.z);
        }
      } catch (_) {}
    }
    return fallbackPoint && player ? Math.hypot(fallbackPoint.x - player.x, fallbackPoint.z - player.z) : Infinity;
  }

  function providerRows(now = performance.now()) {
    const player = playerWorldPosition();
    if (!player) return [];
    const providers = [
      ['interior', window.DevRandomRuin],
      ['prototype', window.DevRandomRuinPrototypeHooks],
      ['simple', window.DevRandomRuinSimplePuzzles],
    ];
    const rows = [];
    const seen = new Set();
    for (const [source, provider] of providers) {
      const controls = provider?.getInteractionControls?.() || [];
      for (let index = 0; index < controls.length; index++) {
        const control = controls[index];
        if (!control || (typeof control.onPress !== 'function' && typeof control.onHoldStart !== 'function')) continue;
        const kind = String(control.kind || 'interactive').toLowerCase();
        // Glyphs and ignition props are intentionally hit-driven. Never leak
        // the generator's DEV toggle into the ordinary interaction list.
        if (kind.includes('glyph') || kind === 'brazier' || kind === 'torch') continue;
        const owner = control.promptRoot || control.object || (control.point ? ruinRoot() : nearestOwnerForKind(kind)); // Towers can explicitly anchor prompts to the cube/top segment players are looking at.
        const point = controlWorldPoint(control, owner);
        const distance = control.point
          ? (point ? Math.hypot(point.x - player.x, point.z - player.z) : Infinity)
          : horizontalDistanceToOwner(owner, player, point);
        const range = Math.max(.1, Number(control.range) || LADDER_RANGE);
        if (distance > range) continue;
        const labelValue = typeof control.label === 'function' ? control.label() : control.label;
        const label = String(labelValue || 'Interact');
        const identity = `${kind}|${owner?.id || owner?.name || ''}|${label}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        rows.push({
          key:`${source}|${index}|${identity}`,
          kind,
          label,
          touchIcon:control.touchIcon || '✋',
          owner,
          distance,
          priority:Number(control.priority)||0,
          inputAction:control.claimAction1===true?'action1':(control.inputAction || null), // claimAction1 is an opt-in contextual override: the shared registry suppresses weapon Action 1 while this visible interaction owns it.
          nativeInput:control.nativeInput === true,
          onPress:control.onPress,
          onHoldStart:control.onHoldStart,
          onHoldEnd:control.onHoldEnd,
          seenAt:now,
          source,
        });
      }
    }
    return rows;
  }

  // Rows that are not aim targets: a swinging rope is caught by proximity,
  // riding controls follow the player, and the exit is a spot, not an object.
  const AMBIENT_KINDS = new Set(['ropegrab', 'roperelease', 'ropebrake', 'exit']);
  const promptAnchor = new THREE.Object3D(); // One plain anchor (no scale/rotation) so the list sits at camera height beside what is aimed at, never at an object's pivot (door pivots sit at the top of the frame).
  promptAnchor.name = 'dev_ruin_interaction_prompt_anchor';
  let focusDebug = null;

  // Ledge climbing: parity with the game's cliff climb (same scripted hop
  // animation), for ruin ledges too tall to step onto (0.42u step limit) but
  // within reach — e.g. a lowered V50 dais still stands ~1.5u proud.
  const LEDGE_MIN_RISE = .44;
  const LEDGE_MAX_RISE = 1.75;
  const LEDGE_REACH = 1.35; // How far ahead of the player the ledge edge may be.
  const cfg = (path, fallback) => window.DevRandomRuinConfig?.get?.(path, fallback) ?? fallback; // docs/config/random-ruin/ruin-config.json (climb.*).

  function openAt(x, z, half = .2) {
    const grid = GridTileAccessors.getActiveGrid?.();
    const tile = grid?.[Math.floor(z)]?.[Math.floor(x)];
    if (!tile || tile.type === 'rock') return false;
    return !window.AreaFootprintBlockers?.blocksBox?.(GridTileAccessors.getCurrentArea?.(), x, z, half);
  }

  // facingOnly: the forward-dodge climb only takes a ledge the player faces
  // (within ~50°), like cliffs.
  function nearestLedge(options = {}) {
    const player = playerWorldPosition();
    const facing = Number(deps?.player?.angle);
    if (!player || deps?.player?.climbing) return null;
    const baseY = Number(window.DevRandomRuin?.getPlayerSupportY?.());
    const floorY = Number.isFinite(baseY) ? baseY : player.y;
    let best = null;
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8, dx = Math.cos(angle), dz = Math.sin(angle);
      if (options.facingOnly && Number.isFinite(facing) && Math.abs(Math.atan2(Math.sin(angle - facing), Math.cos(angle - facing))) > cfg('climb.facingToleranceDeg', 50) * Math.PI / 180) continue;
      for (let t = .25; t <= cfg('climb.ledgeReach', LEDGE_REACH); t += .1) {
        const x = player.x + dx * t, z = player.z + dz * t;
        const support = DS.sampleSupport?.(x, z, { minY:floorY - 8, maxY:floorY + cfg('climb.ledgeMaxRise', LEDGE_MAX_RISE) + .05, pad:.02 });
        const rise = Number(support?.y) - floorY;
        if (!(rise > .2)) { if (!openAt(x, z, .05) && t > .3) break; continue; } // Solid wall before any ledge: nothing to climb here.
        if (rise < cfg('climb.ledgeMinRise', LEDGE_MIN_RISE) || rise > cfg('climb.ledgeMaxRise', LEDGE_MAX_RISE)) break; // A step (walkable) or a wall too tall to climb.
        if (window.DevRandomRuinSimplePuzzles?.isNoClimbSurface?.(support.id)) break; // Rope platforms/balconies/vaults: reached only by rope.
        if (/^devruin-mech-/.test(String(support.id || ''))) break; // Puzzle machinery (a raised dais the glyphs bring down, bridges, stairs) moves only through its puzzle.
        const land = { x:x + dx * .45, z:z + dz * .45 };
        const landSupport = DS.sampleSupport?.(land.x, land.z, { minY:floorY - 8, maxY:floorY + cfg('climb.ledgeMaxRise', LEDGE_MAX_RISE) + .05, pad:.02 });
        if (!landSupport || Math.abs(Number(landSupport.y) - Number(support.y)) > .2 || !openAt(land.x, land.z)) break;
        if (!best || t < best.t) best = { t, x, z, land, topY:Number(support.y), floorY, dx, dz, angle };
        break;
      }
    }
    return best;
  }

  window.ClimbSystem?.registerWorldClimbProvider?.(() => {
    if (!inRuin()) return null;
    const ledge = nearestLedge({ facingOnly:true });
    return ledge ? { kind:'ruinLedge', ledge, start:() => climbLedge(ledge) } : null;
  });

  function climbLedge(ledge) {
    if (!ledge || !deps?.player || !deps.TILE) return false;
    const animated = window.ClimbSystem?.startScriptedWorldClimb?.({
      endX:ledge.land.x * deps.TILE, endY:ledge.land.z * deps.TILE,
      startWorldY:ledge.floorY, endWorldY:ledge.topY,
      hopCount:cfg('climb.hops', 2), shortHops:true, // Ruin variant: a quick two-hop mantle.
      facingAngle:ledge.angle,
    });
    if (!animated) return !!window.DevRandomRuin?.setPlayerWorldPoint?.({ x:ledge.land.x, y:ledge.topY, z:ledge.land.z }, { grounded:true });
    return true;
  }

  function ownerBox(owner) {
    if (!owner) return null;
    try {
      owner.updateWorldMatrix?.(true, true);
      const box = new THREE.Box3().setFromObject(owner);
      return box.isEmpty() ? null : box.expandByScalar(.12);
    } catch (_) { return null; }
  }

  // Same reticle focus normal gameplay uses (climb branches, nests): the
  // interaction ray picks one aimed object; only its actions are listed.
  function focusRows(rows) {
    const ambient = rows.filter(row => AMBIENT_KINDS.has(row.kind));
    const aimed = rows.filter(row => !AMBIENT_KINDS.has(row.kind));
    const owners = [...new Set(aimed.map(row => row.owner).filter(Boolean))];
    const candidates = owners.map(owner => ({ type:'devRuinInteraction', id:owner.uuid || owner.id, data:owner, box:ownerBox(owner) })).filter(candidate => candidate.box);
    let focus = candidates.length ? window.RangedWeapons?.focusCandidates?.(candidates, 6) || null : null;
    // A control whose object sits inside another's box (a brazier on a dais
    // pedestal) always lost to the bigger box the ray enters first; when the
    // ray also reaches a nested candidate, that smaller one is the target.
    if (focus?.candidate?.box) {
      const outer = focus.candidate.box;
      const nested = candidates.filter(candidate => candidate !== focus.candidate && outer.containsBox(candidate.box));
      const inner = nested.length ? window.RangedWeapons.focusCandidates(nested, 6) : null;
      if (inner) focus = inner;
    }
    let focusedOwner = focus?.candidate?.data || null;
    const hasRay = !!window.RangedWeapons?.focusCandidates && candidates.length && focus !== null;
    if (!focusedOwner && !window.RangedWeapons?.focusCandidates) { // No reticle system available: nearest object only.
      focusedOwner = aimed.slice().sort((a, b) => a.distance - b.distance)[0]?.owner || null;
    }
    focusDebug = { candidates:candidates.length, focused:focusedOwner?.name || null, point:focus?.point ? { x:+focus.point.x.toFixed(2), y:+focus.point.y.toFixed(2), z:+focus.point.z.toFixed(2) } : null, hasRay:!!hasRay };
    if (focusedOwner) window.DebugHitboxes?.noteInteractionFocus?.(focus);
    const chosen = focusedOwner ? aimed.filter(row => row.owner === focusedOwner) : [];
    placePromptAnchor(focusedOwner, focus?.point || null, chosen.length ? chosen : ambient);
    return [...chosen, ...ambient];
  }

  function placePromptAnchor(owner, aimPoint, rows) {
    const scene = activeScene();
    if (!scene) return;
    if (promptAnchor.parent !== scene) scene.add(promptAnchor);
    const player = playerWorldPosition();
    let x = aimPoint?.x, z = aimPoint?.z;
    if (!Number.isFinite(x)) {
      const box = ownerBox(owner || rows[0]?.owner);
      if (box && player) { x = Math.max(box.min.x, Math.min(player.x, box.max.x)); z = Math.max(box.min.z, Math.min(player.z, box.max.z)); }
      else if (player) { x = player.x; z = player.z; }
    }
    const floorY = Number(window.DevRandomRuin?.getPlayerSupportY?.()) || 0;
    const camera = deps?.getActiveCamera?.();
    const cameraY = camera?.getWorldPosition ? camera.getWorldPosition(new THREE.Vector3()).y : floorY + 1.5;
    const y = Math.max(floorY + .9, Math.min(floorY + 2.4, cameraY)); // Camera level, kept within reach of the player's own body.
    if (Number.isFinite(x) && Number.isFinite(z)) promptAnchor.position.set(x, y, z);
    promptAnchor.updateMatrixWorld(true);
  }

  function currentRows(now = performance.now()) {
    const rows = providerRows(now); // Contextual actions only: glyphs are shot with the ordinary ranged input, so no "Fire <weapon>" row is added near them.
    // Ledges are climbed with a forward dodge (see the ClimbSystem world-climb
    // provider below), like cliffs; no listed prompt.
    const ladderHit = nearestLadder();
    if (ladderHit && !rows.some(row => row.owner === ladderHit.ladder || row.kind === 'ladder')) {
      rows.push({
        key:`ladder|${ladderHit.ladder.id}`,
        kind:'ladder',
        label:'Climb Stone Ladder',
        touchIcon:'🪜',
        owner:ladderHit.ladder,
        distance:ladderHit.distance,
        onPress:() => climbLadder(ladderHit.ladder),
        seenAt:now,
        source:'semantic-ladder',
      });
    }
    const focusedRows=focusRows(rows);
    rows.length=0;rows.push(...focusedRows);
    const slotActions=SLOT_ACTIONS; // Nearby world interactions own the ordinary five physical arch slots just like NPC/furniture context actions; attacks/items return as soon as the interaction leaves range.
    const touchButtonIds=TOUCH_BUTTON_IDS;
    const sorted=rows.sort((a, b) => b.priority - a.priority || a.distance - b.distance || b.seenAt - a.seenAt);
    const reserved=new Set(sorted.filter(row=>!row.nativeInput&&SLOT_ACTIONS.includes(row.inputAction)).map(row=>row.inputAction)); // Explicit controls such as Grab Rope reserve their physical slot before generic nearby rows are assigned.
    const availableSlots=slotActions.filter(action=>!reserved.has(action)); // Prevents two rows from both claiming Action 1 and fighting over the same arch button.
    let slotIndex=0;
    const mapped=[];
    for(let index=0;index<sorted.length;index++){
      const entry=sorted[index];
      if(entry.inputAction){
        const fixedIndex=SLOT_ACTIONS.indexOf(entry.inputAction); // Explicit semantic inputs own their matching physical touch button unless they are native/pass-through prompts such as Dodge.
        mapped.push({ ...entry, action:`dev_ruin_world_fixed_${entry.inputAction}_${index}`, touchButtonId:entry.nativeInput?null:(fixedIndex>=0?TOUCH_BUTTON_IDS[fixedIndex]:null) });
        continue;
      }
      const inputAction=availableSlots[slotIndex++];
      if(!inputAction)continue; // Native rows may exceed five, but only five contextual actions can own the five physical arch slots.
      const fixedIndex=SLOT_ACTIONS.indexOf(inputAction);
      mapped.push({ ...entry, inputAction, action:`dev_ruin_world_${fixedIndex}`, touchButtonId:TOUCH_BUTTON_IDS[fixedIndex]||null });
    }
    return mapped;
  }

  function currentDevice() {
    const device = window.ActionPromptUI?.getLastInputDevice?.();
    if (device === 'controller' || device === 'touch') return device;
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches;
    if (coarsePointer || Number(navigator.maxTouchPoints) > 0) return 'touch';
    return 'desktop';
  }

  function bindingFor(action, device = currentDevice()) {
    if (device === 'touch') return '';
    const bindings = window.InputBindings?.getCurrentBindings?.();
    return bindings?.[device]?.[action] || '';
  }

  function bindingLabel(action, device = currentDevice(), touchIcon = '✋') {
    if (device === 'touch') return touchIcon;
    const binding = bindingFor(action, device);
    return window.InputBindings?.buttonLabel?.(binding, device) || binding || '';
  }

  function inputColor(action) {
    return window.ActionArchSlotColors?.inputColors?.[action] || '#B8C5C0';
  }

  function syncInputClaims(rows) {
    const registry=window.WorldActionInputClaims;
    if(!registry)return;
    const claims=rows.filter(row=>!row.nativeInput&&row.inputAction).map(row=>({
      actionId:row.inputAction,
      label:row.label,
      priority:1000+(Number(row.priority)||0), // World interactions intentionally outrank ordinary gameplay for an explicitly claimed input while remaining below menus/selectors in game.js.
      onPress:()=>{
        if(typeof row.onHoldStart==='function')row.onHoldStart();
        else row.onPress?.();
      },
      onRelease:()=>row.onHoldEnd?.(),
    }));
    registry.setClaims(INPUT_CLAIM_OWNER,claims);
  }


  // Distance is deliberately left out: rows are already sorted by it, so an
  // order change still changes the signature, while plain movement (which
  // changed distance.toFixed(2) on nearly every 80 ms pass) no longer forces a
  // full refreshActionBar rebuild at 12.5 Hz whenever the player walks.
  function rowSignature(rows) {
    return rows.map(row => [
      row.kind,row.label,row.inputAction,row.nativeInput===true?'native':'claim',
      row.owner?.uuid||row.owner?.id||row.owner?.name||'',
    ].join(':')).join('|');
  }

  function actionButtonsFromRows(rows) {
    return rows.map((row,index) => ({
      icon:row.touchIcon||'✋',
      label:row.label,
      action:row.action,
      style:index===0?'primary':'secondary',
      allowed:true,
      worldInteraction:true,
      promptRoot:promptAnchor, // Game.js's own popup pass anchors to the same camera-level point.
      inputAction:row.inputAction, // Normal refreshActionBar uses this exact semantic slot for popup glyph/color and physical arch placement.
      nativeInput:row.nativeInput===true, // Native Dodge rows stay in the floating list but are excluded from the five arch buttons.
    }));
  }

  function syncWorldPopup(rows) {
    const popup=window.WorldPopupText;
    if(!popup?.syncInteractionPrompts)return;
    const buttons=actionButtonsFromRows(rows);
    const root=promptAnchor.parent?promptAnchor:(rows[0]?.owner||lastAnchor||ruinRoot()||null);
    const device=currentDevice();
    const promptInputs=buttons.map(button=>({
      actionId:button.inputAction||'',
      label:button.inputAction?bindingLabel(button.inputAction,device,button.icon):'',
      color:button.inputAction?inputColor(button.inputAction):'#B8C5C0',
    }));
    popup.syncInteractionPrompts({
      buttons,
      root,
      enabled:inRuin()&&rows.length>0,
      scene:activeScene(),
      promptInputs,
      showInputHints:true,
      isWorldInteraction:button=>button?.worldInteraction===true,
    }); // Directly mirrors the normal action-bar popup path so proximity changes cannot leave the arch claimed while the floating list is stale or absent.
  }

  function refreshRows(requestActionBar = false) {
    if (!inRuin()) {
      const hadRows=lastRows.length>0;
      lastRows=[];
      lastAnchor=null;
      lastRowsSignature='';
      window.WorldActionInputClaims?.clearClaims?.(INPUT_CLAIM_OWNER);
      window.WorldPopupText?.clearInteractionPrompts?.();
      if(hadRows&&requestActionBar)deps?.refreshActionBar?.();
      return [];
    }
    prepareSemanticObjects();
    const rows=currentRows();
    const signature=rowSignature(rows);
    const changed=signature!==lastRowsSignature;
    const hadRows=lastRows.length>0;
    lastRows=rows;
    lastRowsSignature=signature;
    lastAnchor=rows[0]?.owner||nearestOwnerForKind(rows[0]?.kind)||ruinRoot()||null;
    syncInputClaims(rows);
    // Keep the floating list live while the ruin has rows, and clear it once
    // when they go away. Syncing an empty list every frame wiped prompts the
    // ordinary action bar owns (a corpse's Loot) and made them flicker.
    if(rows.length||hadRows)syncWorldPopup(rows);
    if(changed&&requestActionBar)deps?.refreshActionBar?.(); // The normal action bar still owns the physical arch layout; direct popup sync is idempotent with its own WorldPopupText pass.
    return rows;
  }

  function renderWorldList() {
    refreshRows(true);
  }


  let lastInteractionListAt=-Infinity; // Proximity/floating-prompt discovery is UI work, not physics; keep controller edge polling per-frame but rebuild rows at 12.5 Hz.
  DS.addBeforeRenderClient(() => {
    const now=performance.now();
    if(now-lastInteractionListAt>=80){
      lastInteractionListAt=now;
      renderWorldList(now);
    }
  });

  window.DevRandomRuinInteractions = Object.freeze({
    resolveInteractionOwner,
    climbStoneLadder:climbLadder, // Canonical authored-stone-ladder action; uses ClimbSystem's cliff-style hop animation.
    debugLadders() { // Diagnostics: every stone ladder's support probes and the endpoints climbLadder would use.
      prepareSemanticObjects(-Infinity);
      return ladders.map(ladder => { const pos = worldPosition(ladder), r = supportCandidatesForLadder(ladder); return { name:ladder.name, pos, height:ladder.userData?.ladderHeight, expectedTop:r.expectedTop, expectedBottom:r.expectedBottom, candidates:(r.candidates || []).map(c => ({ x:c.x, z:c.z, sign:c.sign, offset:c.offset, y:+c.y.toFixed(2), blocked:c.blocked, blockerId:c.blockerId, supportId:c.supportId })), endpoints:chooseLadderEndpoints(ladder) }; });
    },
    nearestLedge, // Diagnostics: the ledge a forward dodge would climb (pass { facingOnly:true } for the dodge rule).
    climbLedge,
    refresh:renderWorldList,
    getActionButtons() {
      return actionButtonsFromRows(refreshRows(false)); // Called from game.js's ordinary building-interior action provider path.
    },
    invoke(index = 0) {
      const row = lastRows[index];
      if (!row) return false;
      row.onPress?.();
      return true;
    },
    snapshot() {
      return {
        active:inRuin(),
        nativeProviderMode:true,
        normalActionBarProvider:true,
        customPromptBridgeInstalled:false,
        providerCount:[window.DevRandomRuin, window.DevRandomRuinPrototypeHooks, window.DevRandomRuinSimplePuzzles].filter(provider => typeof provider?.getInteractionControls === 'function').length,
        ladderCount:ladders.length,
        rows:lastRows.map(row => ({ label:row.label, kind:row.kind, action:row.action, inputAction:row.inputAction, inputActionId:row.inputAction, nativeInput:row.nativeInput===true, input:bindingLabel(row.inputAction, currentDevice(), row.touchIcon), distance:Number.isFinite(row.distance) ? +row.distance.toFixed(3) : null, owner:row.owner?.name||row.owner?.id||null })),
        ownerName:lastAnchor?.name || null,
        ownerKind:semanticKind(lastAnchor),
        worldPopupVisible:lastRows.length>0,
        focus:focusDebug,
        promptAnchor:{ x:+promptAnchor.position.x.toFixed(2), y:+promptAnchor.position.y.toFixed(2), z:+promptAnchor.position.z.toFixed(2) },
        inputClaims:window.WorldActionInputClaims?.snapshot?.()||null,
      };
    },
  });
})();
