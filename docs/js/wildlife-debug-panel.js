(() => {
  'use strict';

  // Wildlife/genotype debug panel (🧬 Wildlife dev tab) — lists every
  // den pack genotype rolled so far this session, with a per-den
  // Teleport button. Extracted out of game.js following the same
  // window.<Namespace> + init(deps) pattern as its sibling systems.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // "Nest trees should be about as common as gar-wolf dens" is a claim
  // about the CURRENT zone (see wildlife-spawn.js's eligibleNestBranches),
  // not something the per-den genotype list below shows directly — this
  // small readout makes it checkable against the actual live zone/seed.
  function renderDenNestCensus() {
    const zoneId = deps.getCurrentArea?.();
    if (!zoneId || !deps._isZoneArea?.(zoneId)) return '';
    const census = window.WildlifeSpawn.denNestCensus?.(zoneId);
    if (!census) return '';
    return `<div style="padding:8px 10px;margin-bottom:8px;background:rgba(106,167,255,.08);border:1px solid rgba(106,167,255,.25);border-radius:6px;font-size:12px">
      <div style="font-weight:600;color:#e5e7eb;margin-bottom:2px">Den / Nest Census — ${deps.esc(zoneId)}</div>
      <div>Gar-wolf dens generated: <b>${census.denCount}</b></div>
      <div>Drenkirra nest-tree cap (clamped to den count): <b>${census.nestTreeCap}</b></div>
      <div>Nest trees currently populated: <b>${census.nestTreesAlive}</b></div>
    </div>`;
  }

  function renderWildlifeDebugPanel() {
    const container = document.getElementById('wildlifeDenList');
    if (!container) return;
    const censusHtml = renderDenNestCensus();
    if (!window.WildlifeSpawn.getDenGenotypes().size) {
      container.innerHTML = censusHtml + '<div style="opacity:.6;padding:8px 0">No den packs generated yet this session — enter a wilderness zone with wild dens, or force a Tothal Shift below, to populate this list.</div>';
      return;
    }
    const swatch = (hex, size) => `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:3px;background:${deps.esc(hex)};vertical-align:middle;margin-right:4px;border:1px solid rgba(255,255,255,.3)"></span>`;
    const rows = [];
    // Keys are now `${cavernMapId}|${family}` (see getOrMakeDenGenotype)
    // since one den can independently hold a gar-wolf-family genotype
    // and a uumkaoii-family genotype at once — split that back apart to
    // display each family with its own shape (base+patterns vs
    // fur+plates) instead of assuming every entry is gar-wolf-shaped.
    for (const [key, genotype] of window.WildlifeSpawn.getDenGenotypes()) {
      const sepIdx = key.lastIndexOf('|');
      const cavernMapId = sepIdx >= 0 ? key.slice(0, sepIdx) : key;
      const family = sepIdx >= 0 ? key.slice(sepIdx + 1) : 'gar-wolf';
      const zoneId = window.WildlifeSpawn.denCavernZoneOf(cavernMapId) || '(unknown zone)';
      const den = deps._zoneLayouts.get(zoneId)?.dens?.find(d => window.WildlifeSpawn.denCavernMapId(zoneId, d.id) === cavernMapId);
      const denLabel = den ? den.id : cavernMapId.replace(`map_i_den_${zoneId}_`, '');
      let bodyHtml;
      if (family === 'uumkaoii') {
        const furColor = genotype.fur?.color, platesColor = genotype.plates?.color;
        bodyHtml = `<div style="margin-top:3px">Fur: ${furColor ? swatch(furColor, 13) + deps.esc(window.CreatureGenetics.paletteName(furColor)) : '(none)'}</div>
          <div style="margin-top:2px">Plates: ${platesColor ? swatch(platesColor, 13) + deps.esc(window.CreatureGenetics.paletteName(platesColor)) : '(none)'}</div>`;
      } else {
        const patternIds = window.CreatureGenetics.PATTERN_DEFS[family] || [];
        const baseColor = genotype.base?.color;
        const baseHtml = baseColor ? `${swatch(baseColor, 13)}${deps.esc(window.CreatureGenetics.paletteName(baseColor))}` : '(no base)';
        const patternHtml = patternIds.map(id => {
          const layer = genotype[id];
          const on = layer?.enabled && layer.copies > 0;
          return `<span style="opacity:${on ? 1 : 0.35}">${on ? swatch(layer.color, 10) : ''}${deps.esc(id)}</span>`;
        }).join(' &middot; ');
        bodyHtml = `<div style="margin-top:3px">Base: ${baseHtml}</div>
          <div style="margin-top:2px">Patterns: ${patternHtml || '(none)'}</div>`;
      }
      // Which live creatures are currently using this exact genotype
      // object, if any are spawned right now — confirms the whole pack
      // (and its Den-Mother) really do share one roll.
      const aliveKinds = new Set();
      for (const c of deps.hostileObjects) if (c.genotype === genotype) aliveKinds.add(c.creatureKey);
      const teleportBtn = den
        ? `<button class="settings-small-btn wildlife-den-teleport-btn" data-zone="${deps.esc(zoneId)}" data-den="${deps.esc(den.id)}" style="font-size:10px;padding:2px 8px">Teleport</button>`
        : '';
      rows.push(`<div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div>
          <div style="font-weight:600;color:#e5e7eb">${deps.esc(zoneId)} — den ${deps.esc(denLabel)} <span style="opacity:.5;font-weight:400">(${deps.esc(family)})</span>${aliveKinds.size ? ` <span style="opacity:.6;font-weight:400">(${[...aliveKinds].map(deps.esc).join(', ')} alive now)</span>` : ' <span style="opacity:.5;font-weight:400">(none alive right now)</span>'}</div>
          ${bodyHtml}
        </div>
        ${teleportBtn}
      </div>`);
    }
    container.innerHTML = censusHtml + rows.join('');
  }

  window.WildlifeDebugPanel = { init, render: renderWildlifeDebugPanel };
})();
