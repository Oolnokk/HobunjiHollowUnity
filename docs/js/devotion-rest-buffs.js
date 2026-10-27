(() => {
  'use strict';

  if (Number(window.DevotionRestBuffs?.version) >= 5) return;

  const CHANGE_SUMMARY = 'Prayer remains anchored in world space with action-slot-safe input hints, and temple benches now permit prayer throughout Anan, including Spirit Communion; Well Rested integration remains shared with food, potion, movement, and Stamina systems.'; // Used by mobile diagnostics to identify the latest integration layer.
  const CORE_URL = 'js/temple-prayer-rest-blessings.js?v=20261027ha2bea94'; // Used to load the single blessing/save/menu authority before installing integration-only fixes.
  const state = { coreLoaded: false, sitAliasInstalled: false, promptHookInstalled: false, movementHookInstalled: false, potionHooksInstalled: false, lastPromptAnchor: null, lastPrayerSlot: null, lastError: null }; // Used by the in-game diagnostic snapshot.
  let prayerPromptAnchor = null; // Reused world-space anchor that makes Pray float ahead of the player like a targeted-object interaction.

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function ensureCoreLoaded() {
    if (Number(window.TemplePrayerRestBlessings?.version) >= 3) { state.coreLoaded = true; return true; }
    if (document.querySelector?.('script[data-hobunji-temple-prayer-core="1"]')) return false;
    const script = document.createElement('script'); // Used to keep the already-authored core module authoritative instead of maintaining a second blessing engine.
    script.dataset.hobunjiTemplePrayerCore = '1';
    script.src = CORE_URL;
    script.async = false;
    script.addEventListener?.('load', () => { state.coreLoaded = true; installAll(); });
    script.addEventListener?.('error', () => { state.lastError = `Failed to load ${CORE_URL}`; });
    document.head?.appendChild(script);
    return false;
  }

  function installSitAlias() {
    const debug = window.__hobunjiFurnitureDebug;
    if (!debug) return false;
    if (!Object.prototype.hasOwnProperty.call(debug, 'sitState')) {
      Object.defineProperty(debug, 'sitState', { configurable: true, enumerable: true, get() { return debug.sitInteraction; } });
    }
    state.sitAliasInstalled = true;
    return true;
  }

  function prayerEligible() {
    return !!window.TemplePrayerRestBlessings?._test?.promptEligible?.();
  }

  function playerRoot() {
    const player = window.PlayerSocialPoses?.getPlayerEntity?.() || window.Combat?.deps?.player;
    return player?.root || player?.mesh || window.Combat?.deps?.playerMesh || null;
  }

  function prayerPromptRoot() {
    const root = playerRoot();
    if (!root?.position || !window.THREE?.Object3D) return root || null;
    if (!prayerPromptAnchor) {
      prayerPromptAnchor = new window.THREE.Object3D(); // Synthetic target root used only by WorldPopupText; it is repositioned from the live player each prompt sync.
      prayerPromptAnchor.name = 'templePrayerPromptAnchor';
    }
    const yaw = finite(root.rotation?.y, 0); // Matches the player's current world-facing direction so the prompt stays physically in front of the seated body.
    const forwardDistance = 1.05; // Keeps the list clear of the portrait while still reading as the currently targeted interaction.
    prayerPromptAnchor.position.set(
      finite(root.position.x) - Math.sin(yaw) * forwardDistance,
      finite(root.position.y) + 0.72,
      finite(root.position.z) - Math.cos(yaw) * forwardDistance,
    );
    state.lastPromptAnchor = { x: prayerPromptAnchor.position.x, y: prayerPromptAnchor.position.y, z: prayerPromptAnchor.position.z };
    return prayerPromptAnchor;
  }

  function action3Hint() {
    const button = document.getElementById?.('btnAction3');
    const desktop = String(button?.querySelector?.('.abt-key')?.textContent || '').replace(/[\[\]\s]/g, '');
    return desktop ? `${desktop} / Y` : 'Action 3 / Y';
  }

  function installFloatingPromptHook() {
    const popup = window.WorldPopupText;
    if (!popup?.syncInteractionPrompts) return false;
    if (popup.syncInteractionPrompts.__templePrayerWrapped) { state.promptHookInstalled = true; return true; }
    const original = popup.syncInteractionPrompts.bind(popup); // Used so Pray participates in the exact same floating targeted-object list as all other world interactions.
    const wrapped = function syncPrayerPrompt(options = {}) {
      if (!prayerEligible()) { state.lastPrayerSlot = null; return original(options); }
      const buttons = Array.isArray(options.buttons) ? [...options.buttons] : [];
      const promptInputs = Array.isArray(options.promptInputs) ? [...options.promptInputs] : [];
      let prayerSlot = buttons.findIndex(button => button?.action === 'temple_pray'); // Keeps promptInputs indexed to the actual action-bar slot instead of appending a mismatched hint row.
      if (prayerSlot < 0) {
        prayerSlot = buttons.length;
        buttons.push({ action: 'temple_pray', label: 'Pray', worldInteraction: true });
      } else {
        buttons[prayerSlot] = { ...buttons[prayerSlot], action: 'temple_pray', label: 'Pray', worldInteraction: true };
      }
      state.lastPrayerSlot = prayerSlot;
      while (promptInputs.length <= prayerSlot) promptInputs.push(null);
      promptInputs[prayerSlot] = { actionId: 'temple_pray', label: action3Hint(), color: '#c9a6ff' };
      return original({ ...options, root: prayerPromptRoot() || options.root, buttons, promptInputs });
    };
    wrapped.__templePrayerWrapped = true;
    popup.syncInteractionPrompts = wrapped;
    state.promptHookInstalled = true;
    return true;
  }

  function installMovementHook() {
    const combat = window.Combat;
    if (!combat?.getMovementSpeedMul) return false;
    if (combat.getMovementSpeedMul.__templeRestWrapped) { state.movementHookInstalled = true; return true; }
    const original = combat.getMovementSpeedMul.bind(combat); // Used to layer the small Well Rested speed bonus after every existing combat/equipment movement modifier.
    const wrapped = function restedMovementMultiplier(...args) {
      const restMultiplier = window.TemplePrayerRestBlessings?.movementSpeedMultiplier?.() || 1;
      return original(...args) * restMultiplier;
    };
    wrapped.__templeRestWrapped = true;
    combat.getMovementSpeedMul = wrapped;
    state.movementHookInstalled = true;
    return true;
  }

  function potionStackScale(effect) {
    if (!window.TemplePrayerRestBlessings?.isWellRested?.()) return 1;
    const baseStacks = Math.max(1, Math.floor(finite(effect?.potencyTier) + 1)); // Potion potency tiers are the potion system's discrete stack-equivalent for the requested one-third rounding rule.
    const extraStacks = Math.floor(baseStacks / 3); // Implements “+1/3 stacks, rounding down” literally rather than applying a blanket +33%.
    return (baseStacks + extraStacks) / baseStacks;
  }

  function installDebugHook() {
    if (!window.__farmDebugTools) return false;
    window.__farmDebugTools.prayerRestIntegrationSnapshot = debugSnapshot;
    return true;
  }

  function installAll() {
    try {
      ensureCoreLoaded();
      installSitAlias();
      installFloatingPromptHook();
      installMovementHook();
      state.potionHooksInstalled = !!window.AlchemySystem; // Alchemy owns all formulas and reads potionStackScale directly.
      installDebugHook();
    } catch (error) {
      state.lastError = String(error?.stack || error?.message || error);
      window.__farmLog?.(`[prayer/rest integration] ${state.lastError}`, 'warn');
    }
  }

  function debugSnapshot() {
    return {
      latestChange: CHANGE_SUMMARY,
      coreLoaded: !!window.TemplePrayerRestBlessings,
      prayerCore: window.TemplePrayerRestBlessings?.debugSnapshot?.() || null,
      promptEligible: prayerEligible(),
      action3Hint: action3Hint(),
      prayerSlot: state.lastPrayerSlot,
      promptAnchor: state.lastPromptAnchor,
      hooks: { sitAliasInstalled: state.sitAliasInstalled, promptHookInstalled: state.promptHookInstalled, movementHookInstalled: state.movementHookInstalled, potionHooksInstalled: state.potionHooksInstalled },
      lastError: state.lastError,
    };
  }

  installAll();
  const installTimer = window.setInterval(installAll, 250); // Used to catch game-owned debug/combat/alchemy objects that initialize after this parser-time compatibility bridge.

  window.DevotionRestBuffs = Object.freeze({
    version: 5,
    debugSnapshot,
    potionStackScale,
    _installTimer: installTimer,
  });
  window.__devotionRestDebug = debugSnapshot;
})();