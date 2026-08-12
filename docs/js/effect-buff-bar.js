(() => {
  'use strict';

  // Shared timed-effect renderer. Alchemy and cooking register independent
  // providers so neither system owns or overwrites the other's HUD entries.
  const providers = new Map(); // Used to gather active effects by source id.
  let lastRenderKey = ''; // Used to avoid rebuilding unchanged icon markup.

  function registerProvider(sourceId, provider) {
    if (!sourceId || typeof provider !== 'function') return false;
    providers.set(String(sourceId), provider);
    refresh(true);
    return true;
  }

  function unregisterProvider(sourceId) {
    const removed = providers.delete(String(sourceId)); // Used to report whether a provider existed.
    if (removed) refresh(true);
    return removed;
  }

  function activeEntries() {
    const entries = []; // Used to flatten every provider into one stable HUD list.
    for (const [sourceId, provider] of providers) {
      let supplied = [];
      try { supplied = provider() || []; }
      catch (error) { window.__farmLog?.(`[buff-bar] ${sourceId} provider failed: ${error.message}`, 'error'); }
      for (const raw of supplied) {
        if (!raw || !(Number(raw.remainingS) > 0)) continue;
        const key = String(raw.key || raw.id || 'effect'); // Used to namespace duplicate potion/food effect ids.
        entries.push({
          ...raw,
          sourceId,
          domId: `${sourceId}:${key}`,
          kind: raw.kind === 'bane' ? 'bane' : 'boon',
          durationS: Math.max(0.001, Number(raw.durationS) || Number(raw.remainingS) || 1),
          remainingS: Math.max(0, Number(raw.remainingS) || 0),
          stacks: Math.max(1, Math.floor(Number(raw.stacks) || 1)),
        });
      }
    }
    return entries;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function refresh(forceRebuild = false) {
    const bar = document.getElementById('buffBar'); // Used as the existing top-right effect container.
    if (!bar) return;
    const entries = activeEntries(); // Used for both icon markup and countdown fill updates.
    const renderKey = entries.map(entry => `${entry.domId}:${entry.stacks}:${entry.label}:${entry.icon}:${entry.kind}`).join('|');
    if (forceRebuild || renderKey !== lastRenderKey) {
      lastRenderKey = renderKey;
      bar.innerHTML = entries.map(entry => {
        const sourceLabel = entry.sourceLabel || entry.sourceId; // Used in the accessible tooltip.
        const stackBadge = entry.stacks > 1 ? `<span class="buff-icon-stacks">${entry.stacks}</span>` : '';
        return `<div class="buff-icon ${entry.kind}" data-buff="${escapeHtml(entry.domId)}" title="${escapeHtml(`${entry.label} · ${sourceLabel} · ${entry.stacks} stack${entry.stacks === 1 ? '' : 's'}`)}">
          <span class="buff-icon-glyph">${escapeHtml(entry.icon || '✦')}</span>${stackBadge}
          <div class="buff-icon-track"><div class="buff-icon-fill" data-fill="${escapeHtml(entry.domId)}"></div></div>
        </div>`;
      }).join('');
    }
    bar.style.display = entries.length ? 'flex' : 'none';
    for (const entry of entries) {
      const fill = [...bar.querySelectorAll('.buff-icon-fill[data-fill]')].find(candidate => candidate.dataset.fill === entry.domId); // Used to animate this effect's remaining duration without interpolating ids into a CSS selector.
      if (fill) fill.style.width = `${Math.max(0, Math.min(100, entry.remainingS / entry.durationS * 100))}%`;
    }
  }

  window.EffectBuffBar = {
    registerProvider,
    unregisterProvider,
    refresh,
    getEntries: activeEntries,
  };
})();
