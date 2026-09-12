(() => {
  'use strict';
  if (window.StableTrainingCompendiumPatch?.installed) return;

  const OLD_KICKER = 'Not active progression yet';
  const OLD_TEXT = 'Stable rows currently show a level value, but the Stable UI explicitly marks creature leveling as coming later. Do not expect that number to advance through normal play yet.';
  const NEW_KICKER = 'Level 10 animal training';
  const NEW_TEXT = 'Stabled companions, mounts, and shoulder pets gain XP while active, up to level 10. Each level grants a training point. Tap an animal in the Stable to expand its perk tree; companions also have species-specific combat training.';

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
        queueMicrotask?.(rewriteVisibleCopy);
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
