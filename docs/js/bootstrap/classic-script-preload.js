(() => {
  'use strict';
  // Prewarm manifest requests without evaluating them. The normal parser-ordered
  // loader still executes each manifest and child at its original index position.
  const groups = [
    "farm",
    "world-surface",
    "wilderness-generation",
    "combat-main",
    "combat-enemies",
    "combat-config",
    "cooking-runtime",
    "alchemy-runtime",
    "wilderness-treasure",
    "farm-buildings",
    "ruin-puzzles",
    "wilderness-navigation",
    "weather-surfaces",
    "cave-sites",
    "wilderness-ruin-sites",
    "pre-game-render",
    "pre-game-item-art",
    "pre-game-services",
    "pre-game-diagnostics",
    "dialogue",
    "festival",
    "npc-schedule",
    "ruin-runtime",
    "spouse-social",
    "romance-runtime",
    "qol",
    "guild",
    "render"
]; // All 28 parser-ordered index groups, checked against index.html by test-classic-script-preload.js.
  const pathname = String(window.location?.pathname || ''); // Used to recognize immutable commit-pinned CDN URLs.
  const pinned = pathname.match(/(?:\/|@)([0-9a-f]{40})(?=\/docs(?:\/|$))/i); // RawGitHack /<sha>/docs/ and jsDelivr @<sha>/docs/ share a stable cache key.
  const token = pinned ? pinned[1].toLowerCase() : String(Date.now()); // Shared preload/loader query; mutable branch URLs retain per-navigation freshness.
  const state = { token, groupCount: groups.length, reached: 0, lastGroup: null }; // Accessible to the Dev Companion and startup-stall notice.
  window.HobunjiClassicScriptPreload = state; // Shared state consumed by classic-script-group-loader.js.

  for (const group of groups) {
    const link = document.createElement('link'); // Begins each tiny manifest request ahead of the parser waterfall.
    link.rel = 'preload';
    link.as = 'script';
    link.href = 'js/bootstrap/classic-groups/' + group + '.js?load=' + token;
    link.fetchPriority = 'low'; // Do not starve the critical game/Three.js scripts.
    document.head.appendChild(link);
  }

  // Browsers on mobile may show nothing while head scripts stall. This is
  // intentionally passive until loading has exceeded a generous threshold.
  const showSlowStartup = () => {
    if (document.readyState !== 'loading' || document.getElementById('hobunjiSlowStartup')) return;
    const notice = document.createElement('div'); // Small self-contained diagnostic, available without DevTools.
    notice.id = 'hobunjiSlowStartup';
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;z-index:2147483646;'
      + 'padding:9px 12px;background:#251d13;color:#fff;font:13px/1.4 system-ui,sans-serif;'
      + 'border:1px solid #8d734e;border-radius:6px;pointer-events:none';
    notice.textContent = 'Hobunji startup is still loading scripts (reached '
      + state.reached + '/' + state.groupCount + ' groups'
      + (state.lastGroup ? ', last: ' + state.lastGroup : '') + ').';
    (document.body || document.documentElement).appendChild(notice);
  };
  window.setTimeout(showSlowStartup, 15000);
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('hobunjiSlowStartup')?.remove();
  }, { once: true });
})();
