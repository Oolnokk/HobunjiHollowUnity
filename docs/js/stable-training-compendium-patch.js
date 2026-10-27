(() => {
  'use strict';
  if (window.StableTrainingCompendiumPatch?.installed) return;

  const OLD_KICKER = 'Not active progression yet';
  const OLD_TEXT = 'Stable rows currently show a level value, but the Stable UI explicitly marks creature leveling as coming later. Do not expect that number to advance through normal play yet.';
  const NEW_KICKER = 'Companion training and tactics';
  const NEW_TEXT = 'Animal companions train up to level 30; mounts and shoulder pets retain a level 10 cap. All gain XP while active from role-specific activities. Mounts train through exploration, travel, and completed quests. Animal companions train through enemy defeats, buried treasure, bandit camps, Den-Mothers, and stolen den eggs or babies. Shoulder pets train through enemy defeats and positive Rapport gains. Each level grants a training point. Tap an animal in the Stable to expand its perk tree; companions also have species-specific combat training and a saved Tactical Loadout. Cycle each existing move’s relative frequency and effect focus, plus combat tempo. Relentless attacks more often at higher base Stamina cost; Measured conserves base Stamina with longer recovery. Cooldowns and special attack costs still apply.';

  function rewriteVisibleCopy() {
    const root = document.getElementById?.('mpCompendium');
    if (!root?.querySelectorAll) return false;
    let changed = false;
    for (const element of root.querySelectorAll('*')) {
      const text = String(element.textContent || '').trim();
      if (text === OLD_KICKER) { element.textContent = NEW_KICKER; changed = true; }
      else if (text === OLD_TEXT) { element.textContent = NEW_TEXT; changed = true; }
    }
    return changed;
  }

  function patchApi(api) {
    if (!api || api.__stableTrainingCopyPatched) return api;
    for (const methodName of ['install', 'render', 'open']) {
      const original = api[methodName];
      if (typeof original !== 'function') continue;
      api[methodName] = function stableTrainingCompendiumCopy(...args) {
        const result = original.apply(this, args);
        rewriteVisibleCopy();
        if (typeof window.queueMicrotask === 'function') window.queueMicrotask(rewriteVisibleCopy);
        return result;
      };
    }
    api.__stableTrainingCopyPatched = true;
    rewriteVisibleCopy();
    return api;
  }

  if (window.CompendiumUI) {
    patchApi(window.CompendiumUI);
  } else {
    let pending = null;
    try {
      Object.defineProperty(window, 'CompendiumUI', {
        configurable: true,
        enumerable: true,
        get() { return pending; },
        set(value) {
          pending = value;
          Object.defineProperty(window, 'CompendiumUI', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: patchApi(value),
          });
        },
      });
    } catch (_) {
      const timer = setInterval(() => {
        if (!window.CompendiumUI) return;
        clearInterval(timer);
        patchApi(window.CompendiumUI);
      }, 0);
    }
  }

  window.StableTrainingCompendiumPatch = {
    installed: true,
    rewriteVisibleCopy,
    oldKicker: OLD_KICKER,
    newKicker: NEW_KICKER,
  };
})();