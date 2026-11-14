(() => {
  'use strict';

  // Shared timed-effect renderer. Alchemy and cooking register independent
  // providers so neither system owns or overwrites the other's HUD entries.
  const providers = new Map(); // Used to gather active effects by source id.
  let lastRenderKey = ''; // Used to avoid rebuilding unchanged icon markup.
  let lastBar = null; // Used to invalidate cached child references if the HUD root is replaced.
  const iconNodes = new Map(); // Used by refresh() to update countdowns without repeated DOM searches.
  const styleDebug = { refreshes: 0, rebuilds: 0, appliedWrites: 0, skippedWrites: 0 }; // Summarized in the mobile Pixel Probe report.

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
    styleDebug.refreshes++;
    const entries = activeEntries(); // Used for both icon markup and countdown fill updates.
    if (bar !== lastBar) { lastBar = bar; lastRenderKey = null; iconNodes.clear(); }
    const renderKey = entries.map(entry => `${entry.domId}:${entry.stacks}:${entry.label}:${entry.icon}:${entry.kind}:${entry.sourceLabel || entry.sourceId}:${entry.fractionLabel ? 'with-fraction' : 'without-fraction'}`).join('|'); // Presence changes need a badge node; changing the fraction text alone does not rebuild it.
    if (forceRebuild || renderKey !== lastRenderKey) {
      styleDebug.rebuilds++;
      lastRenderKey = renderKey;
      bar.innerHTML = entries.map(entry => {
        const sourceLabel = entry.sourceLabel || entry.sourceId; // Used in the accessible tooltip.
        const stackBadge = entry.stacks > 1 ? `<span class="buff-icon-stacks">${entry.stacks}</span>` : '';
        const fractionBadge = entry.fractionLabel ? `<span class="buff-icon-fraction" data-fraction="${escapeHtml(entry.domId)}" style="position:absolute;bottom:-1.2em;left:50%;transform:translateX(-50%);font-size:9px;white-space:nowrap;text-shadow:0 1px 2px #000">${escapeHtml(entry.fractionLabel)}</span>` : ''; // Timed festival meals show in-game hours left out of their ten-portion duration.
        return `<div class="buff-icon ${entry.kind}" data-buff="${escapeHtml(entry.domId)}" title="${escapeHtml(`${entry.label} · ${sourceLabel} · ${entry.stacks} stack${entry.stacks === 1 ? '' : 's'}`)}">
          <span class="buff-icon-glyph">${escapeHtml(entry.icon || '✦')}</span>${stackBadge}${fractionBadge}
          <div class="buff-icon-track"><div class="buff-icon-fill" data-fill="${escapeHtml(entry.domId)}"></div></div>
        </div>`;
      }).join('');
      iconNodes.clear();
      const fills = bar.querySelectorAll('.buff-icon-fill[data-fill]'); // Read only after structural rebuild, never during each countdown tick.
      const fractions = bar.querySelectorAll('.buff-icon-fraction[data-fraction]'); // Each fraction label is resolved once per markup revision.
      for (const fill of fills) iconNodes.set(fill.dataset.fill, { fill, fraction: null });
      for (const fraction of fractions) {
        const nodes = iconNodes.get(fraction.dataset.fraction);
        if (nodes) nodes.fraction = fraction;
      }
    }
    const display = entries.length ? 'flex' : 'none'; // Used to hide the strip without invalidating style on every refresh.
    if (bar.style.display !== display) { bar.style.display = display; styleDebug.appliedWrites++; }
    else styleDebug.skippedWrites++;
    for (const entry of entries) {
      const nodes = iconNodes.get(entry.domId); // Cached until the icon markup changes; includes both countdown and fraction-label nodes.
      if (!nodes) continue;
      const percentage = Math.round(Math.max(0, Math.min(100, entry.remainingS / entry.durationS * 100)) * 10) / 10; // Tenths of a percent avoid subpixel style churn for long buffs.
      const width = `${percentage}%`; // Used as the stable CSS width for unchanged active durations.
      if (nodes.fill) {
        if (nodes.fill.style.width !== width) { nodes.fill.style.width = width; styleDebug.appliedWrites++; }
        else styleDebug.skippedWrites++;
      }
      const fractionText = entry.fractionLabel || ''; // Used to retain live meal-fraction changes without rebuilding icons.
      if (nodes.fraction) {
        if (nodes.fraction.textContent !== fractionText) { nodes.fraction.textContent = fractionText; styleDebug.appliedWrites++; }
        else styleDebug.skippedWrites++;
      }
    }
  }

  window.EffectBuffBar = {
    registerProvider,
    unregisterProvider,
    refresh,
    getEntries: activeEntries,
    getDebug: () => ({ ...styleDebug, activeIcons: iconNodes.size }),
  };
})();
