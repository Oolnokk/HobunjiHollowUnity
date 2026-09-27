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

  function nearestGlyphGuidance() {
    const owner = nearestOwnerForKind('glyph');
    const player = playerWorldPosition(), point = owner && worldPosition(owner);
    if (!owner || !player || !point) return null;
    const distance = Math.hypot(point.x - player.x, point.z - player.z);
    const itemKey = window.RangedWeapons?.equippedRangedKey?.() || null;
    const range = itemKey && Number.isFinite(Number(deps?.TILE))
      ? (window.RangedWeapons?.playerLockRangePx?.(itemKey) || deps.TILE * 7) / deps.TILE
      : 7;
    if (distance > range) return null;
    return {
      key:`glyph-guidance|${owner.id}`,
      kind:'glyphTarget',
      label:itemKey ? (window.RangedWeapons?.playerActionLabel?.(itemKey) || 'Shoot Glyph Target') : 'Equip Ranged Weapon',
      touchIcon:'🎯',
      owner,
      distance,
      onPress:() => {
        if (!itemKey) return deps?.showToast?.('Equip a ranged weapon to strike this glyph.', false);
        if (window.Combat?.deps?.getActiveTool?.() !== 'ranged') return deps?.showToast?.('Switch to your ranged weapon, aim at the glyph, then fire.', false);
        window.RangedWeapons?.startPlayerAction?.(itemKey);
      },
      seenAt:performance.now(),
      source:'semantic-glyph',
    };
  }

  function currentRows(now = performance.now()) {
    const rows = providerRows(now);
    const glyph = nearestGlyphGuidance();
    if (glyph) rows.push(glyph);
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
    const activeTool=deps?.getActiveTool?.()||window.Combat?.deps?.getActiveTool?.()||null; // Used to preserve canonical attack/ammo actions while a weapon stance is active.
    const combatOwnsActionSlots=activeTool==='weapon'||activeTool==='ranged'; // Weapon/ranged stances reserve Action 1–3; ruin interactions move to Item Action 1–2 instead of replacing combat controls.
    const slotActions=combatOwnsActionSlots?SLOT_ACTIONS.slice(3):SLOT_ACTIONS;
    const touchButtonIds=combatOwnsActionSlots?TOUCH_BUTTON_IDS.slice(3):TOUCH_BUTTON_IDS;
    const fixedCount=rows.reduce((count,row)=>count+(row.inputAction?1:0),0);
    const sorted=rows
      .sort((a, b) => b.priority - a.priority || a.distance - b.distance || b.seenAt - a.seenAt)
      .slice(0, slotActions.length + fixedCount); // Fixed native inputs (currently Dodge) do not consume one of the available dynamic interaction slots.
    let slotIndex=0;
    return sorted.flatMap((entry,index)=>{
      if(entry.inputAction){
        const fixedIndex=SLOT_ACTIONS.indexOf(entry.inputAction); // Explicit semantic inputs (including Action 1) own their matching physical touch button unless they are native/pass-through prompts such as Dodge.
        return [{ ...entry, action:`dev_ruin_world_fixed_${entry.inputAction}_${index}`, touchButtonId:entry.nativeInput?null:(fixedIndex>=0?TOUCH_BUTTON_IDS[fixedIndex]:null) }];
      }
      const inputAction=slotActions[slotIndex];
      const touchButtonId=touchButtonIds[slotIndex]||null;
      if(!inputAction)return []; // Combat stance exposes only the two item-action interaction slots; lower-priority overflow stays visible again after combat is holstered.
      slotIndex++;
      return [{ ...entry, inputAction, action:`dev_ruin_world_${slotIndex-1}`, touchButtonId }];
    });
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

  function clearTouchButtons(keepIds = null) {
    let released=false; // Used to restore canonical action-bar state only when the ruin actually gives one or more touch slots back.
    for (const id of TOUCH_BUTTON_IDS) {
      if(keepIds?.has?.(id))continue;
      const button = document.getElementById(id);
      if (!button?.dataset?.devRuinOwned) continue;
      delete button.dataset.devRuinOwned;
      delete button.dataset.devRuinRow;
      released=true;
    }
    if(released)deps?.refreshActionBar?.(); // Rebuilds Shoot/Ammo/weapon/item actions after a contextual ruin prompt stops owning that physical button.
    return released;
  }

  function syncTouchButtons(rows, device) {
    const desiredIds=new Set(device==='touch'
      ? rows.filter(row=>!row.nativeInput&&row.touchButtonId).map(row=>row.touchButtonId)
      : []); // Tracks the exact physical buttons still owned this frame so stance changes release Action 1–3 without churning the whole HUD every 80 ms.
    clearTouchButtons(desiredIds);
    if (device !== 'touch') return;
    rows.forEach((row, index) => {
      if(row.nativeInput || !row.touchButtonId) return; // Rope release stays on the game's permanent Dodge button instead of masquerading as Action 1/2/3.
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
      window.WorldActionInputClaims?.clearClaims?.(INPUT_CLAIM_OWNER);
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
    syncInputClaims(rows); // Publishes explicit/dynamic world-input ownership before controller/gameplay dispatch for this frame.
    const device = currentDevice();
    syncTouchButtons(rows, device);
    if (!rows.length || !window.WorldPopupText?.syncInteractionPrompts) {
      if(!rows.length)window.WorldActionInputClaims?.clearClaims?.(INPUT_CLAIM_OWNER);
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
    const row = lastRows.find(entry => !entry.nativeInput && keyboardMatches(bindingFor(entry.inputAction, 'desktop'), event));
    if (!row) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(event.repeat)return;
    if(window.WorldActionInputClaims?.dispatch?.(row.inputAction,'press',{source:'keyboard'}))return;
    try {
      if (typeof row.onHoldStart === 'function') row.onHoldStart();
      else row.onPress?.();
    } catch (error) { console.warn('[Random Test Ruin interactions] action failed', error); }
  }, true);

  window.addEventListener('keyup', event => {
    if (!inRuin() || !lastRows.length) return;
    const row = lastRows.find(entry => !entry.nativeInput && keyboardMatches(bindingFor(entry.inputAction, 'desktop'), event));
    if (!row) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(window.WorldActionInputClaims?.dispatch?.(row.inputAction,'release',{source:'keyboard'}))return;
    try { row.onHoldEnd?.(); } catch (error) { console.warn('[Random Test Ruin interactions] hold release failed', error); }
  }, true);

  function controllerBindingDown(binding) {
    if (!binding) return false;
    return !!window.ControllerInput?.frame?.()?.isDown?.(binding); // Shared per-frame snapshot; ControllerInput is the only gamepad polling authority.
  }

  function pollController() {
    if (!inRuin()) { controllerDown.clear(); return; }
    if(window.WorldActionInputClaims)return; // Normal game controller dispatch now routes claimed inputs through the shared registry, preventing a second interaction fire from this legacy fallback poller.
    for (const row of lastRows) {
      if(row.nativeInput)continue; // Fixed contextual inputs (Dodge) remain owned by game.js and are only advertised here.
      const binding = bindingFor(row.inputAction, 'controller');
      const down = controllerBindingDown(binding);
      const wasDown = controllerDown.get(row.inputAction) === true;
      if (down && !wasDown) {
        try {
          if (typeof row.onHoldStart === 'function') row.onHoldStart();
          else row.onPress?.();
        } catch (error) { console.warn('[Random Test Ruin interactions] controller action failed', error); }
      } else if (!down && wasDown && typeof row.onHoldEnd === 'function') {
        try { row.onHoldEnd(); } catch (error) { console.warn('[Random Test Ruin interactions] controller hold release failed', error); }
      }
      controllerDown.set(row.inputAction, down);
    }
  }

  document.addEventListener('pointerdown', event => {
    const button = event.target?.closest?.('[data-dev-ruin-owned="1"]');
    if (!button || !inRuin()) return;
    const index = Number(button.dataset.devRuinRow);
    const row = Number.isInteger(index) ? lastRows[index] : null;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(!row)return;
    if(window.WorldActionInputClaims?.dispatch?.(row.inputAction,'press',{source:'touch'}))return;
    if (typeof row.onHoldStart === 'function') {
      try { row.onHoldStart(); } catch (error) { console.warn('[Random Test Ruin interactions] touch hold failed', error); }
    }
  }, true);

  function finishTouchRow(event) {
    const button = event.target?.closest?.('[data-dev-ruin-owned="1"]');
    if (!button || !inRuin()) return;
    const index = Number(button.dataset.devRuinRow);
    const row = Number.isInteger(index) ? lastRows[index] : null;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(!row)return;
    if(window.WorldActionInputClaims?.dispatch?.(row.inputAction,'release',{source:'touch'}))return;
    try {
      if (typeof row.onHoldEnd === 'function') row.onHoldEnd();
      else row.onPress?.();
    } catch (error) { console.warn('[Random Test Ruin interactions] touch action failed', error); }
  }
  document.addEventListener('pointerup', finishTouchRow, true);
  document.addEventListener('pointercancel', finishTouchRow, true);

  let lastInteractionListAt=-Infinity; // Proximity/floating-prompt discovery is UI work, not physics; keep controller edge polling per-frame but rebuild rows at 12.5 Hz.
  DS.addBeforeRenderClient(() => {
    const now=performance.now();
    if(now-lastInteractionListAt>=80){
      lastInteractionListAt=now;
      renderWorldList(now);
    }
    pollController();
  });

  window.DevRandomRuinInteractions = Object.freeze({
    resolveInteractionOwner,
    climbStoneLadder:climbLadder, // Canonical authored-stone-ladder action; uses ClimbSystem's cliff-style hop animation.
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
        providerCount:[window.DevRandomRuin, window.DevRandomRuinPrototypeHooks, window.DevRandomRuinSimplePuzzles].filter(provider => typeof provider?.getInteractionControls === 'function').length,
        ladderCount:ladders.length,
        rows:lastRows.map(row => ({ label:row.label, kind:row.kind, action:row.action, inputAction:row.inputAction, inputActionId:row.inputAction, nativeInput:row.nativeInput===true, input:bindingLabel(row.inputAction, currentDevice(), row.touchIcon), distance:Number.isFinite(row.distance) ? +row.distance.toFixed(3) : null, owner:row.owner?.name||row.owner?.id||null })),
        ownerName:lastAnchor?.name || null,
        ownerKind:semanticKind(lastAnchor),
        worldPopupVisible:ownsWorldList,
        inputClaims:window.WorldActionInputClaims?.snapshot?.()||null,
      };
    },
  });
})();
