// Bridges Random Test Ruin dev interactions into the game's ordinary world
// interaction input-list popup instead of the legacy single ActionPromptUI card.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const CAPTURE_TTL_MS = 260;
  const SLOT_ACTIONS = ['action1', 'action2', 'action3', 'itemAction1', 'itemAction2'];
  const GridTileAccessors = window.GridTileAccessors;
  const DS = window.DynamicSurfaces;
  if (!GridTileAccessors || !DS) return;

  const captured = new Map();
  const controllerDown = new Map();
  let bridgeInstalled = false;
  let nativeShow = null;
  let nativeHide = null;
  let lastRows = [];
  let lastAnchor = null;
  let ownsWorldList = false;

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

  function worldPosition(object) {
    const out = new THREE.Vector3();
    try { object?.getWorldPosition?.(out); } catch (_) {}
    return out;
  }

  function playerWorldPosition() {
    const scene = activeScene();
    let playerObject = scene?.getObjectByName?.('player') || null;
    if (!playerObject && scene?.traverse) {
      scene.traverse(object => {
        if (!playerObject && (object.userData?.isPlayer || object.userData?.playerCharacter)) playerObject = object;
      });
    }
    return playerObject ? worldPosition(playerObject) : null;
  }

  function kindMatches(kind, owner) {
    const hay = `${kind} ${semanticKind(owner)}`.toLowerCase();
    if (kind.includes('ladder')) return semanticKind(owner) === 'ladder';
    if (kind.includes('stair')) return semanticKind(owner) === 'stair';
    if (kind.includes('transit') || kind.includes('door')) return hay.includes('door');
    if (kind.includes('cube')) return hay.includes('cube');
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
      const dist = player ? pos.distanceToSquared(player) : 0;
      if (dist < bestDist) { bestDist = dist; best = owner; }
    });
    return best;
  }

  function isDevRuinPrompt(options) {
    return inRuin() && String(options?.statusText || '').startsWith('DEV RUIN ·');
  }

  function installBridge() {
    if (bridgeInstalled) return true;
    const api = window.ActionPromptUI;
    if (!api?.showActionPrompt || !api?.hideActionPrompt) return false;
    nativeShow = api.showActionPrompt.bind(api);
    nativeHide = api.hideActionPrompt.bind(api);
    try {
      api.showActionPrompt = options => {
        if (!isDevRuinPrompt(options)) return nativeShow(options);
        const kind = String(options.statusText || '').slice('DEV RUIN ·'.length).trim().toLowerCase();
        const label = String(options.verb || 'Interact');
        const key = `${kind}|${label}`;
        captured.set(key, { key, kind, label, onPress:options.onPress, seenAt:performance.now() });
        nativeHide();
        return true;
      };
      api.hideActionPrompt = (...args) => nativeHide(...args);
      bridgeInstalled = true;
      return true;
    } catch (error) {
      console.warn('[Random Test Ruin interactions] could not wrap ActionPromptUI', error);
      return false;
    }
  }

  function currentRows(now = performance.now()) {
    for (const [key, entry] of captured) if (now - entry.seenAt > CAPTURE_TTL_MS) captured.delete(key);
    return [...captured.values()]
      .sort((a, b) => b.seenAt - a.seenAt)
      .slice(0, SLOT_ACTIONS.length)
      .map((entry, index) => ({ ...entry, inputAction:SLOT_ACTIONS[index], action:`dev_ruin_world_${index}` }));
  }

  function currentDevice() {
    const device = window.ActionPromptUI?.getLastInputDevice?.();
    return device === 'controller' ? 'controller' : 'desktop';
  }

  function bindingFor(action, device = currentDevice()) {
    const bindings = window.InputBindings?.getCurrentBindings?.();
    return bindings?.[device]?.[action] || '';
  }

  function bindingLabel(action, device = currentDevice()) {
    const binding = bindingFor(action, device);
    return window.InputBindings?.buttonLabel?.(binding, device) || binding || '';
  }

  function renderWorldList() {
    installBridge();
    if (!inRuin()) {
      captured.clear();
      lastRows = [];
      if (ownsWorldList) window.WorldPopupText?.clearInteractionPrompts?.();
      ownsWorldList = false;
      lastAnchor = null;
      return;
    }
    const rows = currentRows();
    lastRows = rows;
    if (!rows.length || !window.WorldPopupText?.syncInteractionPrompts) {
      if (ownsWorldList) window.WorldPopupText?.clearInteractionPrompts?.();
      ownsWorldList = false;
      return;
    }
    const anchor = nearestOwnerForKind(rows[0].kind) || ruinRoot();
    if (!anchor) return;
    lastAnchor = anchor;
    const device = currentDevice();
    const promptInputs = rows.map(row => bindingLabel(row.inputAction, device));
    const promptInputActions = rows.map(row => row.inputAction);
    const buttons = rows.map(row => ({
      worldInteraction:true,
      label:row.label,
      action:row.action,
      inputAction:row.inputAction,
    }));
    window.WorldPopupText.syncInteractionPrompts({
      buttons,
      root:anchor,
      scene:activeScene(),
      enabled:true,
      showInputHints:true,
      promptInputs,
      promptInputActions,
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
        bridgeInstalled,
        rows:lastRows.map(row => ({ label:row.label, kind:row.kind, inputAction:row.inputAction, input:bindingLabel(row.inputAction) })),
        ownerName:lastAnchor?.name || null,
        ownerKind:semanticKind(lastAnchor),
        worldPopupVisible:!!window.WorldPopupText?.interactionPromptGroup?.visible,
      };
    },
  });
})();
