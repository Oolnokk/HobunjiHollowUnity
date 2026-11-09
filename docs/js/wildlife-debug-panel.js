(() => {
  'use strict';

  // Wildlife/genotype debug panel (🧬 Wildlife dev tab) — lists every
  // den pack genotype rolled so far this session, with a per-den
  // Teleport button. Extracted out of game.js following the same
  // window.<Namespace> + init(deps) pattern as its sibling systems.
  let deps = null;

  function syncWildlifeTabVisibility() {
    const tab = document.querySelector('.mp-tab[data-mpanel="wildlife"]'); // Wildlife menu tab; hidden whenever Dev Mode is disabled.
    if (!tab) return;
    const devModeToggle = document.getElementById('settingDevMode'); // Existing authoritative Dev Mode checkbox used to decide tab visibility.
    const devMode = devModeToggle ? devModeToggle.checked : !!deps?.isDevMode?.(); // Falls back to injected game state if the Settings control is unavailable.
    tab.style.display = devMode ? '' : 'none';

    if (!devMode && tab.classList.contains('active')) {
      const settingsTab = document.querySelector('.mp-tab[data-mpanel="settings"]'); // Safe visible fallback when Dev Mode is switched off from the Wildlife pane.
      settingsTab?.click();
    }
  }

  function bindDevModeVisibility() {
    const devModeToggle = document.getElementById('settingDevMode'); // Bound once so Wildlife visibility updates immediately when Dev Mode changes.
    if (devModeToggle && devModeToggle.dataset.wildlifeTabBound !== '1') {
      devModeToggle.dataset.wildlifeTabBound = '1';
      devModeToggle.addEventListener('change', syncWildlifeTabVisibility);
    }
    syncWildlifeTabVisibility();
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindDevModeVisibility, { once: true });
    } else {
      bindDevModeVisibility();
    }
  }

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
      <div>Animal den anchors: <b>${census.denCount}</b></div>
      <div>Drenkirra nest selections: <b>${census.nestTreesSelected}/${census.nestTreeCap}</b> (minimum ${census.minimumSeparationTiles} tiles apart)</div>
      <div>Resident/populated nest trees: <b>${census.nestTreesResident}/${census.nestTreesAlive}</b></div>
      <div style="opacity:.72">Selected tiles: ${census.selectedNestTiles?.length ? census.selectedNestTiles.map(tile => `(${tile.col},${tile.row})`).join(', ') : 'none yet — distant regions add nests as they stream in'}</div>
    </div>`;
  }

  function renderNestingSpeciesAudit() {
    const audit = window.WildlifeSpawn?.nestingSpeciesAudit?.() || []; // Live registrations, not a hardcoded list of imagined nesting animals.
    if (!audit.length) return '';
    const failed = audit.filter(entry => !entry.ok);
    const rows = audit.map(entry => {
      const offspring = entry.exempt ? 'offspring item exempt' : entry.itemKey || 'MISSING OFFSPRING';
      const status = entry.ok ? '✓' : '⚠';
      const issues = entry.ok ? '' : ' — ' + [
        !entry.registered ? 'species absent' : null,
        !entry.guardianRegistered ? 'guardian absent' : null,
        !entry.offspringMapped ? 'unusable baby/egg' : null,
        !entry.hasGenetics ? 'no inherited-coat renderer' : null,
      ].filter(Boolean).join(', ');
      return `<div>${status} ${deps.esc(entry.kind)} → ${deps.esc(entry.guardianKey || '(no guardian)')} · ${deps.esc(offspring)}${deps.esc(issues)}</div>`;
    }).join('');
    return `<div style="padding:8px 10px;margin-bottom:8px;border:1px solid rgba(106,167,255,.3);border-radius:6px;font-size:12px">
      <div style="font-weight:600;margin-bottom:3px">Nesting Species / Offspring — ${audit.length - failed.length}/${audit.length} valid</div>
      ${rows}
    </div>`;
  }

  function renderDenTurnoverCensus() {
    const zoneId = deps.getCurrentArea?.();
    if (!zoneId || !deps._isZoneArea?.(zoneId)) return '';
    const records = window.WildlifeSpawn.denTurnoverDebug?.(zoneId) || [];
    if (!records.length) return '';
    const rows = records.map(record => {
      const days = record.entered ? (record.queued ? ' · collapse queued until you leave the wilderness' : ` · collapses in <b>${record.daysRemaining}</b> day(s)`) : ' · no timer';
      const clutch = record.motherDefeated ? ' · Den-Mother defeated' : '';
      const site = Number.isFinite(Number(record.x)) && Number.isFinite(Number(record.y)) ? `(${record.x},${record.y})` : '(generated site)';
      return `<div><b>${deps.esc(record.name || record.denId)}</b>: ${deps.esc(record.stage)} · generation ${record.generation} · site ${deps.esc(site)}${days}${clutch}</div>`;
    }).join('');
    return `<div style="padding:8px 10px;margin-bottom:8px;background:rgba(196,151,84,.08);border:1px solid rgba(196,151,84,.3);border-radius:6px;font-size:12px">
      <div style="font-weight:600;color:#e5e7eb;margin-bottom:2px">Den Turnover — ${deps.esc(zoneId)}</div>
      ${rows}
    </div>`;
  }

  function renderRoamingHerdCensus() {
    const zoneId = deps.getCurrentArea?.();
    if (!zoneId || !deps._isZoneArea?.(zoneId)) return '';
    const census = window.WildlifeSpawn.roamingHerdCensus?.(zoneId);
    if (!census?.configuredHerds) return '';
    const rows = census.herds.map(herd =>
      `<div><b>${deps.esc(herd.herdKey)}</b>: ${herd.adults} adults · ${herd.mothers} Herd-Mother · ${herd.carriedBabies} carried babies · ${herd.sleeping} sleeping</div>`
    ).join('');
    return `<div style="padding:8px 10px;margin-bottom:8px;background:rgba(133,190,120,.08);border:1px solid rgba(133,190,120,.28);border-radius:6px;font-size:12px">
      <div style="font-weight:600;color:#e5e7eb;margin-bottom:2px">Roaming Herd Census — ${deps.esc(zoneId)}</div>
      <div>Configured: <b>${census.configuredHerds}</b> herd(s) · species: ${census.species.map(deps.esc).join(', ') || 'none'}</div>
      ${rows || '<div style="opacity:.72">No living herd members spawned yet.</div>'}
    </div>`;
  }

  function renderCaveGeometryCensus() {
    const cave = window.CaveSiteSystem?.debugSnapshot?.(); // Existing mobile Wildlife tab exposes the latest cave geometry changes without a console.
    if (!cave?.caveCount) return '';
    const plan = cave.currentPlan; // Interior-only details come from the same generated plan used by actual cave mechanics.
    return `<div style="padding:8px 10px;margin-bottom:8px;border:1px solid rgba(196,151,84,.3);border-radius:6px;font-size:12px">
      <div style="font-weight:600">Cave Geometry</div>
      <div>Ordinary caves: <b>${cave.caveCount}</b> · independent Puzzle Caves: <b>${cave.puzzleCaveCount||0}</b> (cliff ${cave.outdoorPuzzleCaveCount||0}, behind rock ${cave.rockPuzzleCaveCount||0})</div>
      <div>${deps.esc(cave.latestChange)}</div>
      ${plan ? `<div>Solid rim: ${plan.outerRimTileCount} tiles · wall height: ${plan.wallHeightScale}× · embedded ruin tunnel: ${plan.ruinEntrance ? 'yes' : 'none'}</div>` : ''}
    </div>`;
  }

  function renderTzatzulCensus() {
    const flight = window.TzatzulFlightRuntime?.debugSnapshot?.(); // Existing flight owner supplies everything this mobile panel reports.
    if (!flight) return '';
    const spires = window.TzatzulCliffSites?.snapshot?.(); // Real cave-spire geometry and generation errors for mobile.
    const wings = window.TzatzulLiveVisuals?.snapshot?.(); // Actual wing mesh load/pose state, not an assumed successful render.
    const nest = window.TzatzulNestEncounter?.debugSnapshot?.(); // Real miniboss counters, available without DevTools.
    const arena = window.TzatzulNestInterior?.debugSnapshot?.(); // Displays actual wall and spike geometry counts.
    const area = deps?.getCurrentArea?.();
    const inhabitants = (flight.birds || []).filter(bird => bird.area === area);
    const fmt = value => deps.esc(String(value ?? 'none'));
    const live = inhabitants.map(bird =>
      '<div>' + fmt(bird.id) + ' · ' + fmt(bird.phase) + ' · ' + fmt(bird.pose)
      + (bird.target ? ' · target ' + fmt(bird.target) : '')
      + (bird.nestMinutesLeft != null ? ' · emerges in ' + fmt(bird.nestMinutesLeft) + ' game min' : '') + '</div>').join('');
    return '<div style="padding:8px 10px;margin-bottom:8px;border:1px solid rgba(145,179,222,.3);border-radius:6px;font-size:12px">'
      + '<div style="font-weight:600">Tzatzul flight / cliff roosts</div>'
      + '<div>Living: <b>' + flight.active + '</b> · launched: ' + flight.flights
      + ' · swoops: ' + flight.swoops + ' · hits/misses: ' + flight.hits + '/' + flight.misses + '</div>'
      + '<div>Scout legs: ' + (flight.scouts || 0) + ' · nest stays: ' + (flight.nestStays || 0)
      + ' · flee drops: ' + (flight.fleeDrops || 0) + '</div>'
      + '<div>Live wing rigs: ' + (wings?.liveRigs ?? 0) + ' · failed loads: ' + (wings?.loadFailures ?? 0) + '</div>'
      + '<div>Inaccessible nest spires: ' + (flight.roosts?.find(record => record.area === area)?.count || 0) + '</div>'
      + '<div>Nest arenas: ' + (arena?.arenas?.length || 0) + ' · rock perches: ' + (arena?.rockMeshes || 0)
      + ' · stone spike layers: ' + (arena?.spikeMeshes || 0) + '</div>'
      + '<div>Nest dives: ' + (nest?.dives || 0) + ' · wall hits: ' + (nest?.wallHits || 0)
      + ' · sharp spike hits: ' + (nest?.spikeHits || 0) + ' · stored remains: ' + (nest?.deposited || 0)
      + ' · overflow meals: ' + (nest?.overflowMeals || 0) + '</div>'
      + (nest?.lastImpact ? '<div>Last collision: ' + fmt(nest.lastImpact.kind)
        + ' · unused dive: ' + fmt((nest.lastImpact.deficitTiles || 0).toFixed(2)) + ' tiles</div>' : '')
      + (nest?.encounters || []).filter(encounter => encounter.mapId === area)
        .map(encounter => '<div>Mother HP: ' + fmt(encounter.motherHealth)
          + ' · hatchlings: ' + fmt(encounter.hatchlingsAlive)
          + ' · eggs: ' + fmt(encounter.eggs) + ' · remains: ' + fmt(encounter.victims)
          + ' · ' + fmt(encounter.phase) + '</div>').join('')
      + (spires?.lastError ? '<div style="color:#f3b98c">Spire: ' + fmt(spires.lastError) + '</div>' : '')
      + (live || '<div style="opacity:.72">No adult Tzatzul encountered here yet.</div>')
      + (wings?.lastError ? '<div style="color:#f3b98c">Rig: ' + fmt(wings.lastError) + '</div>' : '')
      + '</div>';
  }

  function renderPingdortCensus() {
    const area = deps?.getCurrentArea?.();
    if (!window.PingdortRegistration?.ZONES?.includes(area)) return '';
    const status = window.PingdortFlocks?.debugSnapshot?.(); // Native live roster and per-egg clutch states, not guessed biome populations.
    const record = status?.habitats?.find(item => item.area === area);
    const network = window.CliffRouteNetwork?.forArea?.(area);
    const karst = area === 'map_southern_cloud_forest'
      ? window.CloudForestRuntimeV2?.lastKarstReport : null; // Last-generated map report is labelled explicitly because older saves may differ.
    const fmt = value => deps.esc(String(value ?? 'unknown'));
    const liveNests = record?.nests || [];
    const nestRows = liveNests.map(nest =>
      '<div>' + fmt(nest.id) + ' · minicliff Y ' + fmt(nest.y)
      + ' · eggs ' + fmt(nest.remaining) + ' · living flock '
      + fmt(nest.flockLoaded ? Math.max(0, 3 - (nest.deadSlots?.length || 0)) : 'streamed out')
      + ' · losses today ' + fmt(nest.deadSlots?.length || 0) + '</div>').join('');
    return '<div style="padding:8px 10px;margin-bottom:8px;border:1px solid rgba(177,184,143,.35);border-radius:6px;font-size:12px">'
      + '<div style="font-weight:600">Pingdort nests / cliff wildlife</div>'
      + '<div>Live birds: <b>' + fmt(record?.liveBirds || 0) + '</b> · nest sites: '
      + fmt(liveNests.length) + ' · minicliffs: ' + fmt(network?.balconies?.length || 0)
      + ' · climb routes valid: ' + fmt(network?.verification?.ok ?? 'not built') + '</div>'
      + '<div>Eggs collected: ' + fmt(status?.eggsCollected || 0)
      + ' · flock deaths: ' + fmt(status?.flockDeaths || 0)
      + ' · shelf checks without a network: ' + fmt(status?.missingShelves || 0) + '</div>'
      + (karst ? '<div>Last Cloud Forest generation: ' + fmt(karst.towers)
        + ' limestone pillars in ' + fmt(karst.clusters) + ' clusters (seed '
        + fmt(karst.seed) + ')</div>' : '')
      + (nestRows || '<div style="opacity:.72">No current minicliff nests. Check that this zone has finished generating its cliff routes.</div>')
      + '</div>';
  }

  function renderWildlifeDebugPanel() {
    syncWildlifeTabVisibility();
    const container = document.getElementById('wildlifeDenList');
    if (!container) return;
    const censusHtml = renderDenNestCensus() + renderNestingSpeciesAudit() + renderDenTurnoverCensus() + renderRoamingHerdCensus() + renderCaveGeometryCensus() + renderTzatzulCensus() + renderPingdortCensus();
    if (!window.WildlifeSpawn.getDenGenotypes().size) {
      container.innerHTML = censusHtml + '<div style="opacity:.6;padding:8px 0">No den-family genotypes generated yet this session. Roaming herds are reported separately above because they do not belong to caverns.</div>';
      return;
    }
    const swatch = (hex, size) => `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:3px;background:${deps.esc(hex)};vertical-align:middle;margin-right:4px;border:1px solid rgba(255,255,255,.3)"></span>`;
    const rows = [];
    // Den family genotypes use one base+patterns format; Uumkao'ii's old
    // fur/plates records are normalized read-only before this mobile panel.
    for (const [key, storedGenotype] of window.WildlifeSpawn.getDenGenotypes()) {
      const sepIdx = key.lastIndexOf('|');
      const cavernMapId = sepIdx >= 0 ? key.slice(0, sepIdx) : key;
      const family = sepIdx >= 0 ? key.slice(sepIdx + 1) : 'gar-wolf';
      const zoneId = window.WildlifeSpawn.denCavernZoneOf(cavernMapId) || '(unknown zone)';
      const den = deps._zoneLayouts.get(zoneId)?.dens?.find(d => window.WildlifeSpawn.denCavernMapId(zoneId, d.id) === cavernMapId);
      const denLabel = den ? den.id : cavernMapId.replace(`map_i_den_${zoneId}_`, '');
      const genotype = window.CreatureGenetics.normalizeLegacyGenotype?.(family, storedGenotype) || storedGenotype; // Old dens retain original genes without mutation.
      const patternIds = window.CreatureGenetics.PATTERN_DEFS[family] || [];
      const baseColor = genotype?.base?.color;
      const baseHtml = baseColor ? `${swatch(baseColor, 13)}${deps.esc(window.CreatureGenetics.paletteName(baseColor))}` : '(no base)';
      const patternHtml = patternIds.map(id => {
        const layer = genotype?.[id];
        const on = layer?.enabled !== false && layer?.copies > 0;
        return `<span style="opacity:${on ? 1 : 0.35}">${on ? swatch(layer.color, 10) : ''}${deps.esc(id)}</span>`;
      }).join(' &middot; ');
      const bodyHtml = `<div style="margin-top:3px">Base: ${baseHtml}</div>
          <div style="margin-top:2px">Patterns: ${patternHtml || '(none)'}</div>`;
      // Which live creatures are currently using this exact genotype
      // object, if any are spawned right now — confirms the whole pack
      // (and its Den-Mother) really do share one roll.
      const aliveKinds = new Set();
      for (const c of deps.hostileObjects) if (c.genotype === storedGenotype) aliveKinds.add(c.creatureKey);
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

  window.WildlifeDebugPanel = { init, render: renderWildlifeDebugPanel, syncVisibility: syncWildlifeTabVisibility };
})();
