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
  const GridTileAccessors = window.GridTileAccessors;
  const DS = window.DynamicSurfaces;
  const DevSpawner = window.DevSpawner;
  if (!GridTileAccessors || !DS || !DevSpawner) return;

  const controllerDown = new Map();
  let deps = null;
  let lastRows = [];
  let lastAnchor = null;
  let ownsWorldList = false;
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
    for (const sign of [-1, 1]) {
      for (const offset of [.34, .52, .72, .94, 1.16]) {
        const x = origin.x + axis.x * offset * sign;
        const z = origin.z + axis.z * offset * sign;
        const support = DS.sampleSupport?.(x, z, { minY:expectedBottom - .65, maxY:expectedTop + .65, pad:.02 });
        if (!support || !Number.isFinite(Number(support.y))) continue;
        const blocker = DS.blockerAt?.(x, z, { radius:.18, actorHeight:1.25 }) || null;
        candidates.push({ x, z, y:Number(support.y), supportId:support.id || null, blocked:!!blocker, offset, sign });
      }
    }
    return { candidates, expectedTop, expectedBottom };
  }

  function chooseLadderEndpoints(ladder) {
    const resolved = supportCandidatesForLadder(ladder);
    if (!resolved?.candidates?.length) return null;
    const usable = resolved.candidates.filter(candidate => !candidate.blocked);
    const pool = usable.length >= 2 ? usable : resolved.candidates;
    const topSorted = [...pool].sort((a, b) => Math.abs(a.y - resolved.expectedTop) - Math.abs(b.y - resolved.expectedTop) || a.offset - b.offset);
    const bottomSorted = [...pool].sort((a, b) => Math.abs(a.y - resolved.expectedBottom) - Math.abs(b.y - resolved.expectedBottom) || a.offset - b.offset);
    let top = topSorted[0] || null;
    let bottom = bottomSorted.find(candidate => !top || candidate.sign !== top.sign || Math.abs(candidate.y - top.y) > .15) || bottomSorted[0] || null;
    if (!top || !bottom) return null;
    if (top.y < bottom.y) [top, bottom] = [bottom, top];
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
    deps.player.x = target.x * deps.TILE;
    deps.player.y = target.z * deps.TILE;
    deps.player.vx = 0;
    deps.player.vy = 0;
    if (deps.playerMesh?.position) deps.playerMesh.position.y = target.y;
    deps._snapCameraTarget?.();
    deps.showToast?.(target === endpoints.top ? 'Climbed up the stone ladder.' : 'Climbed down the stone ladder.', true);
    return true;
  }

  function controlWorldPoint(control, owner) {
    const point = control?.point;
    if (Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.z))) {
      return new THREE.Vector3(Number(point.x), Number(point.y) || 0, Number(point.z));
    }
    return owner ? worldPosition(owner) : null;
  }

  function providerRows(now = performance.now()) {
    const player = playerWorldPosition();
    if (!player) return [];
    const providers = [
      ['interior', window.DevRandomRuin],
      ['prototype', window.DevRandomRuinPrototypeHooks],
    ];
    const rows = [];
    const seen = new Set();
    for (const [source, provider] of providers) {
      const controls = provider?.getInteractionControls?.() || [];
      for (let index = 0; index < controls.length; index++) {
        const control = controls[index];
        if (!control || typeof control.onPress !== 'function') continue;
        const kind = String(control.kind || 'interactive').toLowerCase();
        const owner = control.object || (control.point ? ruinRoot() : nearestOwnerForKind(kind));
        const point = controlWorldPoint(control, owner);
        const distance = point ? Math.hypot(point.x - player.x, point.z - player.z) : Infinity;
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
          onPress:control.onPress,
          seenAt:now,
          source,
        });
      }
    }
    return rows;
  }

  function currentRows(now = performance.now()) {
    const rows = providerRows(now);
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
    return rows
      .sort((a, b) => a.distance - b.distance || b.seenAt - a.seenAt)
      .slice(0, SLOT_ACTIONS.length)
      .map((entry, index) => ({ ...entry, inputAction:SLOT_ACTIONS[index], action:`dev_ruin_world_${index}`, touchButtonId:TOUCH_BUTTON_IDS[index] }));
  }

  function currentDevice() {
    const device = window.ActionPromptUI?.getLastInputDevice?.();
    if (device === 'controller' || device === 'touch') return device;
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

  function clearTouchButtons() {
    for (const id of TOUCH_BUTTON_IDS) {
      const button = document.getElementById(id);
      if (!button?.dataset?.devRuinOwned) continue;
      delete button.dataset.devRuinOwned;
      delete button.dataset.devRuinRow;
    }
  }

  function syncTouchButtons(rows, device) {
    clearTouchButtons();
    if (device !== 'touch') return;
    rows.forEach((row, index) => {
      const button = document.getElementById(row.touchButtonId);
      if (!button) return;
      button.dataset.devRuinOwned = '1';
      button.dataset.devRuinRow = String(index);
      button.dataset.action = row.action;
      button.setAttribute('aria-label', row.label);
      button.style.display = '';
      button.disabled = false;
      button.textContent = row.touchIcon || '✋';
    });
  }

  function renderWorldList() {
    if (!inRuin()) {
      lastRows = [];
      clearTouchButtons();
      if (ownsWorldList) window.WorldPopupText?.clearInteractionPrompts?.();
      ownsWorldList = false;
      lastAnchor = null;
      preparedRoot = null;
      ladders = [];
      lastSemanticScanAt = -Infinity;
      return;
    }
    prepareSemanticObjects();
    const rows = currentRows();
    lastRows = rows;
    const device = currentDevice();
    syncTouchButtons(rows, device);
    if (!rows.length || !window.WorldPopupText?.syncInteractionPrompts) {
      if (ownsWorldList) window.WorldPopupText?.clearInteractionPrompts?.();
      ownsWorldList = false;
      return;
    }
    const anchor = rows[0].owner || nearestOwnerForKind(rows[0].kind) || ruinRoot();
    if (!anchor) return;
    lastAnchor = anchor;
    const promptInputs = rows.map(row => ({
      actionId:row.inputAction,
      label:bindingLabel(row.inputAction, device, row.touchIcon),
      color:inputColor(row.inputAction),
    }));
    const buttons = rows.map(row => ({
      worldInteraction:true,
      label:row.label,
      action:row.action,
      inputAction:row.inputAction,
      promptRoot:row.owner || anchor,
    }));
    window.WorldPopupText.syncInteractionPrompts({
      buttons,
      root:anchor,
      scene:activeScene(),
      enabled:true,
      showInputHints:true,
      promptInputs,
    });
    ownsWorldList = true;
  }

  function keyboardMatches(binding, event) {
    if (!binding) return false;
    const parts = String(binding).split('+').map(part => part.trim()).filter(Boolean);
    const code = parts.pop();
    const required = new Set(parts);
    return event.code === code &&
      !!event.shiftKey === required.has('Shift') &&
      !!event.ctrlKey === required.has('Control') &&
      !!event.altKey === required.has('Alt') &&
      !!event.metaKey === required.has('Meta');
  }

  window.addEventListener('keydown', event => {
    if (!inRuin() || !lastRows.length) return;
    const row = lastRows.find(entry => keyboardMatches(bindingFor(entry.inputAction, 'desktop'), event));
    if (!row) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try { row.onPress?.(); } catch (error) { console.warn('[Random Test Ruin interactions] action failed', error); }
  }, true);

  function controllerBindingDown(binding) {
    if (!binding) return false;
    let index = null;
    if (/^Button\d+$/.test(binding)) index = Number(binding.slice(6));
    else if (binding === 'LeftTrigger') index = 6;
    else if (binding === 'RightTrigger') index = 7;
    if (!Number.isInteger(index)) return false;
    for (const pad of navigator.getGamepads?.() || []) if (pad?.buttons?.[index]?.pressed) return true;
    return false;
  }

  function pollController() {
    if (!inRuin()) { controllerDown.clear(); return; }
    for (const row of lastRows) {
      const binding = bindingFor(row.inputAction, 'controller');
      const down = controllerBindingDown(binding);
      const wasDown = controllerDown.get(row.inputAction) === true;
      if (down && !wasDown) {
        try { row.onPress?.(); } catch (error) { console.warn('[Random Test Ruin interactions] controller action failed', error); }
      }
      controllerDown.set(row.inputAction, down);
    }
  }

  document.addEventListener('pointerdown', event => {
    const button = event.target?.closest?.('[data-dev-ruin-owned="1"]');
    if (!button || !inRuin()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('pointerup', event => {
    const button = event.target?.closest?.('[data-dev-ruin-owned="1"]');
    if (!button || !inRuin()) return;
    const index = Number(button.dataset.devRuinRow);
    const row = Number.isInteger(index) ? lastRows[index] : null;
    event.preventDefault();
    event.stopImmediatePropagation();
    try { row?.onPress?.(); } catch (error) { console.warn('[Random Test Ruin interactions] touch action failed', error); }
  }, true);

  DS.addBeforeRenderClient(() => {
    renderWorldList();
    pollController();
  });

  window.DevRandomRuinInteractions = Object.freeze({
    resolveInteractionOwner,
    refresh:renderWorldList,
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
        customPromptBridgeInstalled:false,
        providerCount:[window.DevRandomRuin, window.DevRandomRuinPrototypeHooks].filter(provider => typeof provider?.getInteractionControls === 'function').length,
        ladderCount:ladders.length,
        rows:lastRows.map(row => ({ label:row.label, kind:row.kind, inputAction:row.inputAction, input:bindingLabel(row.inputAction, currentDevice(), row.touchIcon), distance:Number.isFinite(row.distance) ? +row.distance.toFixed(3) : null })),
        ownerName:lastAnchor?.name || null,
        ownerKind:semanticKind(lastAnchor),
        worldPopupVisible:ownsWorldList,
      };
    },
  });
})();
