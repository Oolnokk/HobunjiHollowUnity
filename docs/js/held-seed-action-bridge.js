// Held-seed input/reticle adapter.
//
// game.js deliberately hides the equipped tool and returns early from
// updateToolMesh() while an inventory item is held. Tool actions normally fire
// at the strike point inside that update loop, so a plant_* action queued while
// holding seeds can remain frozen until the player switches back to a tool.
// Planting is an item action, not a tool strike: intercept its semantic action
// input and use HobunjiInventoryActionMetadataBridge.tryPlantAction() directly.
(() => {
  'use strict';

  if (window.HobunjiHeldSeedActionBridge) return;

  const ARCH_IDS = ['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2']; // Used to map the five visible action-arch buttons back to semantic action1..action5 slots.
  const pointerStates = new Map(); // Used to distinguish an ordinary Plant tap from the existing drag-to-aim gesture.
  let cachedReticleMesh = null; // Used to avoid traversing the farm scene on every rendered frame once its unique wireframe tile reticle is found.
  let plantReticleMaterial = null; // Used to render a valid held-seed target with the game's normal gold reticle color.
  let previousRendererRender = null; // Used to preserve the existing renderer hook chain while adding the seed-validity visual override.

  function plantApi() {
    return window.HobunjiInventoryActionMetadataBridge || null;
  }

  function actionButtonFromEvent(event) {
    const direct = event?.target?.closest?.('button.abt'); // Used for ordinary pointer events whose target is the button or one of its icon children.
    if (direct?.dataset?.action?.startsWith('plant_')) return direct;
    const path = typeof event?.composedPath === 'function' ? event.composedPath() : []; // Used for pointer-capture/shadow-DOM cases where event.target is no longer the original action button.
    return path.find(node => node?.matches?.('button.abt') && node.dataset?.action?.startsWith('plant_')) || null;
  }

  function visiblePlantSlot() {
    if (typeof document === 'undefined') return null;
    for (let index = 0; index < ARCH_IDS.length; index++) {
      const button = document.getElementById(ARCH_IDS[index]); // Used to inspect the exact slot currently populated by refreshActionBar().
      const action = button?.dataset?.action || '';
      if (!button || button.classList.contains('abt-hidden') || !action.startsWith('plant_')) continue;
      return { button, action, slot: index + 1 };
    }
    return null;
  }

  function makePointerCancel(sourceEvent) {
    if (typeof PointerEvent === 'function') {
      return new PointerEvent('pointercancel', {
        bubbles: true,
        cancelable: true,
        pointerId: sourceEvent.pointerId,
        pointerType: sourceEvent.pointerType || 'touch',
        clientX: Number(sourceEvent.clientX) || 0,
        clientY: Number(sourceEvent.clientY) || 0,
      });
    }
    const fallback = new Event('pointercancel', { bubbles: true, cancelable: true }); // Used by older WebViews that implement pointer listeners but do not expose the PointerEvent constructor.
    for (const [key, value] of Object.entries({
      pointerId: sourceEvent.pointerId,
      pointerType: sourceEvent.pointerType || 'touch',
      clientX: Number(sourceEvent.clientX) || 0,
      clientY: Number(sourceEvent.clientY) || 0,
    })) {
      try { Object.defineProperty(fallback, key, { configurable: true, value }); } catch (_) { /* best-effort compatibility field */ }
    }
    return fallback;
  }

  function cleanNativeButtonState(button, sourceEvent) {
    if (!button?.dispatchEvent) return;
    const wasHidden = button.classList.contains('abt-hidden'); // Used to prevent game.js's pointercancel cleanup from firing the queued tool-swing action itself.
    button.classList.add('abt-hidden');
    try { button.dispatchEvent(makePointerCancel(sourceEvent)); }
    finally { if (!wasHidden) button.classList.remove('abt-hidden'); }
  }

  function dispatchPlant(action) {
    const api = plantApi(); // Used as the single public owner of planting validation, inventory mutation, persistence, and feedback.
    if (!api?.tryPlantAction || !String(action || '').startsWith('plant_')) return false;
    const result = api.tryPlantAction(action);
    return result?.handled !== false;
  }

  function installPointerDispatch() {
    if (typeof document === 'undefined' || document.__heldSeedPointerDispatchInstalled) return;
    document.__heldSeedPointerDispatchInstalled = true;

    document.addEventListener('pointerdown', event => {
      const button = actionButtonFromEvent(event);
      if (!button) return;
      pointerStates.set(event.pointerId, {
        button,
        x: Number(event.clientX) || 0,
        y: Number(event.clientY) || 0,
        moved: false,
      });
    }, true);

    document.addEventListener('pointermove', event => {
      const state = pointerStates.get(event.pointerId);
      if (!state || state.moved) return;
      const dx = (Number(event.clientX) || 0) - state.x;
      const dy = (Number(event.clientY) || 0) - state.y;
      if (Math.hypot(dx, dy) > 18) state.moved = true;
    }, true);

    document.addEventListener('pointercancel', event => {
      pointerStates.delete(event.pointerId);
    }, true);

    document.addEventListener('pointerup', event => {
      const state = pointerStates.get(event.pointerId);
      pointerStates.delete(event.pointerId);
      if (!state || state.moved) return; // Drag-to-aim remains owned by game.js and must not plant at the gesture's original tile.
      const button = actionButtonFromEvent(event) || state.button;
      const action = button?.dataset?.action || '';
      if (!action.startsWith('plant_')) return;

      // Do not filter on pointerType/isTrusted here. Some Android WebViews and
      // desktop touch emulation report coarse taps as mouse pointers; game.js
      // still receives those pointer events, so this bridge must claim the
      // semantic Plant action regardless of how the browser labels the pointer.
      // Dispatch first: if the planting owner is not initialized yet, leave the
      // event untouched so game.js retains its original fallback behavior.
      if (!dispatchPlant(action)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cleanNativeButtonState(button, event);
    }, true);
  }

  function currentDesktopBinding(slot) {
    const input = window.SCRATCHBONES_CONFIG?.game?.input || {}; // Used to preserve the user's configured semantic action bindings instead of hard-coding Space/Enter/etc.
    const actionId = `action${slot}`;
    const authored = Array.isArray(input.actions) ? input.actions.find(action => action?.id === actionId)?.desktop : null; // Used as the default binding for this semantic action slot.
    let saved = null; // Used to merge any locally remapped desktop input over the authored default.
    try { saved = JSON.parse(localStorage.getItem(input.storageKey || 'scratchbones.inputBindings.v1') || 'null'); }
    catch (_) { saved = null; }
    return saved?.desktop?.[actionId] || authored || null;
  }

  function installKeyboardDispatch() {
    if (typeof document === 'undefined' || document.__heldSeedKeyboardDispatchInstalled) return;
    document.__heldSeedKeyboardDispatchInstalled = true;
    document.addEventListener('keydown', event => {
      if (event.repeat) return;
      const plant = visiblePlantSlot(); // Used so keyboard follows the same slot the mobile arch and controller semantics expose right now.
      if (!plant || event.code !== currentDesktopBinding(plant.slot)) return;
      if (!dispatchPlant(plant.action)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  function isReticleMesh(object) {
    const p = object?.geometry?.parameters;
    if (!object?.isMesh || !p || !object.material?.wireframe) return false;
    return Math.abs(Number(p.width) - 1) < 0.0001
      && Math.abs(Number(p.height) - 0.06) < 0.0001
      && Math.abs(Number(p.depth) - 1) < 0.0001;
  }

  function reticleForScene(scene) {
    if (cachedReticleMesh?.parent && cachedReticleMesh.parent === scene) return cachedReticleMesh;
    cachedReticleMesh = null;
    scene?.traverse?.(object => {
      if (!cachedReticleMesh && isReticleMesh(object)) cachedReticleMesh = object;
    });
    return cachedReticleMesh;
  }

  function applyPlantReticle(scene) {
    const plant = visiblePlantSlot();
    if (!plant || plant.button.classList.contains('blocked')) return;
    const reticle = reticleForScene(scene); // Used only after refreshActionBar has already declared the selected seed valid on this exact target tile.
    if (!reticle || !window.THREE?.MeshBasicMaterial) return;
    if (!plantReticleMaterial) {
      plantReticleMaterial = new window.THREE.MeshBasicMaterial({
        color: 0xf9e28a,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
      });
    }
    reticle.material = plantReticleMaterial;
  }

  function installReticleRenderHook() {
    const prototype = window.THREE?.WebGLRenderer?.prototype;
    if (!prototype || prototype.__heldSeedReticleHookInstalled || typeof prototype.render !== 'function') return;
    previousRendererRender = prototype.render; // Used to chain after PlayerBodyTransformComposer/other renderer wrappers already installed by the loader.
    prototype.render = function heldSeedAwareRender(scene, camera, ...rest) {
      applyPlantReticle(scene);
      return previousRendererRender.call(this, scene, camera, ...rest);
    };
    prototype.__heldSeedReticleHookInstalled = true;
  }

  installPointerDispatch();
  installKeyboardDispatch();
  installReticleRenderHook();

  window.HobunjiHeldSeedActionBridge = {
    dispatchPlant,
    getDebug: () => {
      const plant = visiblePlantSlot(); // Used by Pixel-Probe-adjacent diagnostics without exposing private game.js state.
      return {
        visibleAction: plant?.action || null,
        slot: plant?.slot || null,
        blocked: plant ? plant.button.classList.contains('blocked') : null,
      };
    },
  };
})();
