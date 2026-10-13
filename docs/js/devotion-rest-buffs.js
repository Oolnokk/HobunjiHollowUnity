(() => {
  'use strict';

  if (Number(window.DevotionRestBuffs?.version) >= 2) return;

  const CHANGE_SUMMARY = 'Consolidated temple prayer/rest gameplay onto TemplePrayerRestBlessings; this bridge adds exact pew detection, floating Pray prompts, Well Rested movement speed, and rounded potion-tier bonuses.'; // Used by mobile diagnostics to identify the latest integration layer.
  const CORE_URL = 'js/temple-prayer-rest-blessings.js?v=20261013prayer2'; // Used to load the single blessing/save/menu authority before installing integration-only fixes.
  const state = { coreLoaded: false, sitAliasInstalled: false, promptHookInstalled: false, movementHookInstalled: false, potionHooksInstalled: false, lastError: null }; // Used by the in-game diagnostic snapshot.

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function ensureCoreLoaded() {
    if (window.TemplePrayerRestBlessings) { state.coreLoaded = true; return true; }
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
      if (!prayerEligible()) return original(options);
      const buttons = Array.isArray(options.buttons) ? [...options.buttons] : [];
      const promptInputs = Array.isArray(options.promptInputs) ? [...options.promptInputs] : [];
      if (!buttons.some(button => button?.action === 'temple_pray')) {
        buttons.push({ action: 'temple_pray', label: 'Pray', worldInteraction: true });
        promptInputs.push({ actionId: 'temple_pray', label: action3Hint(), color: '#c9a6ff' });
      }
      return original({ ...options, buttons, promptInputs });
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

  function boostedMagnitude(stat) {
    const now = performance.now() / 1000;
    return (window.AlchemySystem?.activeEffects || [])
      .filter(effect => effect?.expiresAt > now && (effect.stat === stat || effect.secondaryStat === stat))
      .reduce((sum, effect) => sum + finite(effect.magnitude) * potionStackScale(effect), 0);
  }

  function installPotionHooks() {
    const alchemy = window.AlchemySystem;
    if (!alchemy || state.potionHooksInstalled) return state.potionHooksInstalled;
    const positive = {
      getMovementSpeedMultiplier: 'movementSpeed', getSpeedMul: 'movementSpeed', getAttackSpeedMultiplier: 'attackSpeed',
      getOutgoingDamageMultiplier: 'outgoingDamage', getHealthRegenMultiplier: 'healthRegen', getStaminaRegenMultiplier: 'staminaRegen',
      getMaxFootingMultiplier: 'maxFooting', getMaxStaminaMultiplier: 'maxStamina', getPositiveFavorMultiplier: 'positiveFavor',
      getPerceptionMultiplier: 'perception', getFootingDamageMultiplier: 'footingDamage', getWorkSpeedMultiplier: 'workSpeed',
    }; // Used to recompute public potion multipliers from stored effect magnitudes with rounded Well Rested tier scaling.
    const inverse = { getStaminaSpendMultiplier: 'staminaSpend', getIncomingDamageAfflictionMultiplier: 'incomingDamageAffliction' }; // Used for potion stats whose magnitude reduces a burden rather than raising a multiplier.
    let wrappedCount = 0; // Used to report whether at least one current Alchemy public getter was successfully replaced.
    for (const [method, stat] of Object.entries(positive)) {
      if (typeof alchemy[method] !== 'function') continue;
      const wrapped = function roundedRestedPotionPositive() { return 1 + boostedMagnitude(stat); };
      wrapped.__templeRestPotionWrapped = true;
      alchemy[method] = wrapped;
      wrappedCount++;
    }
    for (const [method, stat] of Object.entries(inverse)) {
      if (typeof alchemy[method] !== 'function') continue;
      const wrapped = function roundedRestedPotionInverse() { return Math.max(0.2, 1 - boostedMagnitude(stat)); };
      wrapped.__templeRestPotionWrapped = true;
      alchemy[method] = wrapped;
      wrappedCount++;
    }
    state.potionHooksInstalled = wrappedCount > 0;
    return state.potionHooksInstalled;
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
      installPotionHooks();
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
      hooks: { sitAliasInstalled: state.sitAliasInstalled, promptHookInstalled: state.promptHookInstalled, movementHookInstalled: state.movementHookInstalled, potionHooksInstalled: state.potionHooksInstalled },
      lastError: state.lastError,
    };
  }

  installAll();
  const installTimer = window.setInterval(installAll, 250); // Used to catch game-owned debug/combat/alchemy objects that initialize after this parser-time compatibility bridge.

  window.DevotionRestBuffs = Object.freeze({
    version: 2,
    debugSnapshot,
    potionStackScale,
    _installTimer: installTimer,
  });
  window.__devotionRestDebug = debugSnapshot;
})();