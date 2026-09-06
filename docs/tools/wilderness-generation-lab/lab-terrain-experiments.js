(() => {
  'use strict';

  const TerrainPreview = window.TerrainPreview;
  const Features = window.WildernessLabFeatures;
  if (!TerrainPreview || !Features || TerrainPreview.__wildernessLabTerrainExperiments) return;
  TerrainPreview.__wildernessLabTerrainExperiments = true;

  let controlUiInstalled = false; // Prevents duplicate dynamically injected terrain controls after hot reloads.
  let regenerationTimer = 0; // Debounces auto-regeneration while the user drags an experimental range control.

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value)));
  }

  function smoothstep(value) {
    const t = clamp(value, 0, 1); // Shared smooth interpolation for basin walls and river shoulders.
    return t * t * (3 - 2 * t);
  }

  function hash01(a, b = 0, salt = 0) {
    let h = (2166136261 ^ Math.imul((a | 0) + salt, 374761393) ^ Math.imul((b | 0) + salt * 3, 668265263)) >>> 0; // Stable spatial hash keeps karst placement deterministic per generated layout.
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function numberValue(id, fallback) {
    const value = Number(document.getElementById(id)?.value); // Dynamic experimental controls are read at TerrainPreview merge time.
    return Number.isFinite(value) ? value : fallback;
  }

  function boolValue(id, fallback = false) {
    const input = document.getElementById(id); // Checkbox lookup is centralized so transforms remain usable during initial UI boot.
    return input ? !!input.checked : fallback;
  }

  function scheduleRegeneration() {
    if (!document.getElementById('autoGenerate')?.checked) return;
    clearTimeout(regenerationTimer);
    regenerationTimer = setTimeout(() => {
      const button = document.getElementById('generateBtn'); // Reuses the lab's authoritative generation path instead of calling generator internals here.
      if (button && !button.disabled) button.click();
    }, 280);
  }

  function makeRangeControl(id, label, min, max, step, value) {
    const row = document.createElement('div');
    row.className = 'control';
    row.innerHTML = `<label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><input id="${id}Num" type="number" min="${min}" max="${max}" step="${step}" value="${value}">`;
    const range = row.querySelector(`#${id}`);
    const number = row.querySelector(`#${id}Num`);
    const sync = (source, target) => {
      const next = clamp(source.value, Number(source.min), Number(source.max)); // Paired range/number inputs always share one clamped value.
      source.value = String(next);
      target.value = String(next);
      scheduleRegeneration();
    };
    range.addEventListener('input', () => sync(range, number));
    number.addEventListener('change', () => sync(number, range));
    return row;
  }

  function makeCheckboxControl(id, label, checked = false) {
    const row = document.createElement('div');
    row.className = 'control check';
    row.innerHTML = `<label for="${id}">${label}</label><input id="${id}" type="checkbox"${checked ? ' checked' : ''}>`;
    row.querySelector('input').addEventListener('change', scheduleRegeneration);
    return row;
  }

  function appendSection(host, title, help) {
    const divider = document.createElement('div');
    divider.className = 'divider';
    host.appendChild(divider);
    const heading = document.createElement('div');
    heading.innerHTML = `<b style="color:#dbeafe">${title}</b><div class="help" style="margin-top:4px">${help}</div>`;
    host.appendChild(heading);
  }

  function installControlUi() {
    if (controlUiInstalled) return;
    const terrainHost = document.getElementById('groupTerrain');
    const hydroHost = document.getElementById('groupHydro');
    const recipeSelect = document.getElementById('recipeSelect');
    if (!terrainHost || !hydroHost || !recipeSelect) {
      setTimeout(installControlUi, 50);
      return;
    }
    controlUiInstalled = true;

    appendSection(terrainHost, 'Great Basin spoon profile', 'Great Basin now keeps a high perimeter. From the entrance the basin descends gently toward a low point near the far end; the far rim drops into that low point much more steeply, like a miso-soup spoon. These controls only affect the Great Basin preset.');
    terrainHost.appendChild(makeRangeControl('labBasinLowPoint', 'Basin low point', 0.50, 0.92, 0.01, 0.78));
    terrainHost.appendChild(makeRangeControl('labBasinEntryCurve', 'Entrance decline curve', 0.35, 3.0, 0.05, 1.05));
    terrainHost.appendChild(makeRangeControl('labBasinFarWallWidth', 'Far steep wall width', 0.05, 0.38, 0.01, 0.17));
    terrainHost.appendChild(makeRangeControl('labBasinSideRimWidth', 'Side rim width', 0.04, 0.35, 0.01, 0.13));
    terrainHost.appendChild(makeRangeControl('labBasinFloorRatio', 'Basin floor height', 0.00, 0.45, 0.01, 0.08));

    appendSection(terrainHost, 'Karst towers', 'Isolated, small-footprint, single-level plateaus with very high sheer sides. Each tower is one flat elevation level internally — no nested staircase tiers.');
    terrainHost.appendChild(makeCheckboxControl('labKarstEnabled', 'Generate karst towers', false));
    terrainHost.appendChild(makeRangeControl('labKarstCount', 'Tower count', 0, 40, 1, 10));
    terrainHost.appendChild(makeRangeControl('labKarstMinTier', 'Minimum tower tier', 3, 32, 1, 10));
    terrainHost.appendChild(makeRangeControl('labKarstMaxTier', 'Maximum tower tier', 3, 32, 1, 18));
    terrainHost.appendChild(makeRangeControl('labKarstRadius', 'Footprint radius', 1, 4, 0.25, 1.5));
    terrainHost.appendChild(makeRangeControl('labKarstSpacing', 'Minimum spacing', 3, 24, 1, 8));

    appendSection(hydroHost, 'River canyon override', 'The generator already has fixed canyon carving internally: the river bed is aggressively lowered and its flat bank radius is hard-coded. Enable this authoring override to choose the elevation reduction and the width of the low riverbank explicitly.');
    hydroHost.appendChild(makeCheckboxControl('labRiverCarveEnabled', 'Override river carving', false));
    hydroHost.appendChild(makeRangeControl('labRiverCarveDepth', 'River carve depth (tiers)', 0, 16, 0.25, 3));
    hydroHost.appendChild(makeRangeControl('labRiverBankWidth', 'Low riverbank width', 0, 12, 0.25, 3.5));

    if (!recipeSelect.querySelector('option[value="karstTowers"]')) {
      const option = document.createElement('option');
      option.value = 'karstTowers';
      option.textContent = 'Karst tower field (spawn now)';
      const hybrid = recipeSelect.querySelector('option[value="hybridEscarpment"]'); // Experimental geographic recipes stay grouped together near the top.
      recipeSelect.insertBefore(option, hybrid || recipeSelect.children[1] || null);
    }

    const handleKarstRecipe = event => {
      if (recipeSelect.value !== 'karstTowers') return;
      event.preventDefault?.();
      event.stopImmediatePropagation();
      document.getElementById('labKarstEnabled').checked = true;
      document.getElementById('labKarstCount').value = '14';
      document.getElementById('labKarstCountNum').value = '14';
      document.getElementById('labKarstMinTier').value = '12';
      document.getElementById('labKarstMinTierNum').value = '12';
      document.getElementById('labKarstMaxTier').value = '22';
      document.getElementById('labKarstMaxTierNum').value = '22';
      document.getElementById('ctl_preset').value = 'custom';
      document.getElementById('ctl_plateaus').value = '0';
      document.getElementById('ctl_plateaus_num').value = '0';
      document.getElementById('ctl_ramps').value = '0';
      document.getElementById('ctl_ramps_num').value = '0';
      const button = document.getElementById('generateBtn');
      setTimeout(() => { if (button && !button.disabled) button.click(); }, 0);
    };
    recipeSelect.addEventListener('change', handleKarstRecipe, true);
    document.getElementById('applyRecipeBtn')?.addEventListener('click', handleKarstRecipe, true);
  }

  function inferGreatBasinEntrySide(workspace, merged) {
    const root = merged?.rootMap;
    const target = root?.generatorPreset?.greatBasinEntry?.target || root?.greatBasinEntry?.target; // Generator exports its chosen high-entry target with the preset metadata.
    if (!target) return 'north';
    const distances = [
      ['north', Math.abs(Number(target.y) || 0)],
      ['south', Math.abs((merged.rows - 1) - (Number(target.y) || 0))],
      ['west', Math.abs(Number(target.x) || 0)],
      ['east', Math.abs((merged.cols - 1) - (Number(target.x) || 0))],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][0];
  }

  function entryProgress(c, r, cols, rows, side) {
    if (side === 'south') return rows > 1 ? (rows - 1 - r) / (rows - 1) : 0;
    if (side === 'west') return cols > 1 ? c / (cols - 1) : 0;
    if (side === 'east') return cols > 1 ? (cols - 1 - c) / (cols - 1) : 0;
    return rows > 1 ? r / (rows - 1) : 0;
  }

  function crossProgress(c, r, cols, rows, side) {
    const vertical = side === 'north' || side === 'south'; // Side rims use the axis perpendicular to travel from entry to far end.
    return vertical ? (cols > 1 ? c / (cols - 1) : 0) : (rows > 1 ? r / (rows - 1) : 0);
  }

  function applyGreatBasinSpoonProfile(workspace, merged) {
    const root = merged?.rootMap;
    const preset = root?.generatorPreset;
    if (!(preset?.id === 'greatBasin' || preset?.greatBasinSpoon)) return { applied:false };

    const lowPoint = clamp(numberValue('labBasinLowPoint', 0.78), 0.50, 0.92); // Normalized distance from the entry to the basin's lowest longitudinal point.
    const entryCurve = clamp(numberValue('labBasinEntryCurve', 1.05), 0.35, 3.0); // Shapes the long gentle entry-side decline.
    const farWallWidth = clamp(numberValue('labBasinFarWallWidth', 0.17), 0.05, 0.38); // Fraction of map length reserved for the far steep wall.
    const sideRimWidth = clamp(numberValue('labBasinSideRimWidth', 0.13), 0.04, 0.35); // Fraction of cross-axis width held high along each side boundary.
    const floorRatio = clamp(numberValue('labBasinFloorRatio', 0.08), 0, 0.45); // Minimum fraction of the rim tier retained at the bowl floor.
    const entrySide = inferGreatBasinEntrySide(workspace, merged); // Keeps the spoon orientation tied to the actual generated entrance.
    let rimTier = 1;
    for (const tile of merged.tiles.values()) {
      const height = tile?.type === 'ramp' ? Number(tile.rampElevation) || 0 : Number(tile?.elevTier) || 0;
      rimTier = Math.max(rimTier, height);
    }
    const configuredTier = Number(document.getElementById('ctl_maxTier')?.value); // User-visible max tier remains the intended upper scale for the basin profile.
    if (Number.isFinite(configuredTier)) rimTier = Math.max(rimTier, configuredTier);
    const floorTier = rimTier * floorRatio;
    let changed = 0;

    for (const tile of merged.tiles.values()) {
      if (!tile) continue;
      const u = clamp(entryProgress(tile.c, tile.r, merged.cols, merged.rows, entrySide), 0, 1);
      const cross = clamp(crossProgress(tile.c, tile.r, merged.cols, merged.rows, entrySide), 0, 1);
      let longitudinal = 0;
      if (u <= lowPoint) {
        const t = u / Math.max(0.001, lowPoint);
        longitudinal = Math.pow(1 - smoothstep(t), entryCurve); // Long handle-side descent uses most of the map length and remains gentle.
      } else {
        const farStart = Math.max(lowPoint, 1 - farWallWidth);
        const t = clamp((u - farStart) / Math.max(0.001, 1 - farStart), 0, 1);
        longitudinal = Math.pow(smoothstep(t), 0.42); // Low exponent makes the far boundary climb abruptly out of the bowl.
      }
      const edgeDistance = Math.min(cross, 1 - cross);
      const sideRim = 1 - smoothstep(edgeDistance / Math.max(0.001, sideRimWidth)); // Both lateral boundaries stay high instead of collapsing with the bowl center.
      const factor = clamp(Math.max(longitudinal, sideRim), 0, 1);
      const tier = floorTier + (rimTier - floorTier) * factor;
      if (tile.type === 'ramp') tile.rampElevation = tier;
      else tile.elevTier = tier;
      tile.labGreatBasinSpoon = true;
      changed++;
    }

    const report = { applied:true, entrySide, rimTier, floorTier, lowPoint, farWallWidth, sideRimWidth, changedTiles:changed };
    workspace.wildernessLabFeatures = workspace.wildernessLabFeatures || {};
    workspace.wildernessLabFeatures.greatBasinSpoonPreview = report;
    return report;
  }

  function applyRiverCarveOverride(workspace, merged) {
    if (!boolValue('labRiverCarveEnabled', false)) return { applied:false };
    const depth = clamp(numberValue('labRiverCarveDepth', 3), 0, 16); // Requested reduction in plateau/elevation tiers from surrounding terrain to the river bed.
    const bankWidth = clamp(numberValue('labRiverBankWidth', 3.5), 0, 12); // Radius of the deliberately low walkable bank shelf outside the water cells.
    const riverTiles = [...merged.tiles.values()].filter(tile => tile?.type === 'river');
    if (!riverTiles.length || depth <= 0) return { applied:false, riverTiles:riverTiles.length, depth, bankWidth };

    const proposed = new Map(); // World-keyed minimum target heights prevent overlapping river segments from fighting each other.
    let touchedBanks = 0;
    const searchRadius = Math.max(2.5, bankWidth + 2.5);
    for (const river of riverTiles) {
      let sourceTier = 0;
      for (let rr = Math.max(0, Math.floor(river.r - searchRadius)); rr <= Math.min(merged.rows - 1, Math.ceil(river.r + searchRadius)); rr++) {
        for (let cc = Math.max(0, Math.floor(river.c - searchRadius)); cc <= Math.min(merged.cols - 1, Math.ceil(river.c + searchRadius)); cc++) {
          const candidate = merged.tiles.get(`${cc},${rr}`);
          if (!candidate || candidate.type === 'river' || candidate.type === 'stream' || candidate.type === 'waterfall') continue;
          const candidateTier = candidate.type === 'ramp' ? Number(candidate.rampElevation) || 0 : Number(candidate.elevTier) || 0;
          sourceTier = Math.max(sourceTier, candidateTier);
        }
      }
      const bedTier = Math.max(0, sourceTier - depth);
      proposed.set(`${river.c},${river.r}`, bedTier);
      if (bankWidth <= 0) continue;
      const shoulderRadius = bankWidth + 1.25;
      for (let rr = Math.max(0, Math.floor(river.r - shoulderRadius)); rr <= Math.min(merged.rows - 1, Math.ceil(river.r + shoulderRadius)); rr++) {
        for (let cc = Math.max(0, Math.floor(river.c - shoulderRadius)); cc <= Math.min(merged.cols - 1, Math.ceil(river.c + shoulderRadius)); cc++) {
          const dist = Math.hypot(cc - river.c, rr - river.r);
          if (dist > shoulderRadius) continue;
          const candidate = merged.tiles.get(`${cc},${rr}`);
          if (!candidate || candidate.type === 'river' || candidate.type === 'stream' || candidate.type === 'waterfall') continue;
          let target = sourceTier;
          if (dist <= bankWidth) target = Math.min(sourceTier, bedTier + Math.min(1, depth * 0.22)); // Main bank is a broad low shelf just above the water bed.
          else {
            const blend = smoothstep((dist - bankWidth) / Math.max(0.001, shoulderRadius - bankWidth));
            target = (bedTier + Math.min(1, depth * 0.22)) * (1 - blend) + sourceTier * blend; // One narrow outer shoulder eases back to untouched terrain.
          }
          const key = `${cc},${rr}`;
          const previous = proposed.get(key);
          if (previous === undefined || target < previous) proposed.set(key, target);
          touchedBanks++;
        }
      }
    }

    let changed = 0;
    for (const [key, target] of proposed) {
      const tile = merged.tiles.get(key);
      if (!tile) continue;
      if (tile.type === 'ramp') tile.rampElevation = target;
      else tile.elevTier = target;
      tile.labRiverCarved = true;
      changed++;
    }
    const report = { applied:true, depth, bankWidth, riverTiles:riverTiles.length, changedTiles:changed, bankSamples:touchedBanks };
    workspace.wildernessLabFeatures = workspace.wildernessLabFeatures || {};
    workspace.wildernessLabFeatures.riverCarvePreview = report;
    return report;
  }

  function karstSettings() {
    return {
      enabled: boolValue('labKarstEnabled', false),
      count: Math.round(clamp(numberValue('labKarstCount', 10), 0, 40)),
      minTier: clamp(numberValue('labKarstMinTier', 10), 3, 32),
      maxTier: clamp(numberValue('labKarstMaxTier', 18), 3, 32),
      radius: clamp(numberValue('labKarstRadius', 1.5), 1, 4),
      spacing: clamp(numberValue('labKarstSpacing', 8), 3, 24),
    };
  }

  function applyKarstTowers(workspace, merged) {
    const settings = karstSettings();
    if (!settings.enabled || settings.count <= 0) return { applied:false, ...settings };
    const minTier = Math.min(settings.minTier, settings.maxTier);
    const maxTier = Math.max(settings.minTier, settings.maxTier);
    const margin = Math.ceil(settings.radius + 2);
    const candidates = [];
    for (let r = margin; r < merged.rows - margin; r++) {
      for (let c = margin; c < merged.cols - margin; c++) {
        const center = merged.tiles.get(`${c},${r}`);
        if (!center || ['river','stream','waterfall','ramp','trench'].includes(center.type)) continue;
        let clear = true;
        for (let rr = Math.floor(r - settings.radius); rr <= Math.ceil(r + settings.radius) && clear; rr++) {
          for (let cc = Math.floor(c - settings.radius); cc <= Math.ceil(c + settings.radius); cc++) {
            if (Math.hypot(cc - c, rr - r) > settings.radius + 0.25) continue;
            const tile = merged.tiles.get(`${cc},${rr}`);
            if (!tile || ['river','stream','waterfall','ramp','trench'].includes(tile.type)) { clear = false; break; }
          }
        }
        if (!clear) continue;
        candidates.push({ c, r, score:hash01(c, r, 7717) });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = [];
    for (const candidate of candidates) {
      if (chosen.length >= settings.count) break;
      if (chosen.some(other => Math.hypot(other.c - candidate.c, other.r - candidate.r) < settings.spacing)) continue;
      chosen.push(candidate);
    }

    let changedTiles = 0;
    const towers = [];
    chosen.forEach((center, index) => {
      const heightRoll = hash01(center.c, center.r, 991 + index); // Each tower gets one constant top tier chosen deterministically within the requested range.
      const tier = minTier + (maxTier - minTier) * heightRoll;
      let footprintTiles = 0;
      for (let rr = Math.floor(center.r - settings.radius); rr <= Math.ceil(center.r + settings.radius); rr++) {
        for (let cc = Math.floor(center.c - settings.radius); cc <= Math.ceil(center.c + settings.radius); cc++) {
          const jitter = (hash01(cc, rr, 4123 + index) - 0.5) * 0.55; // Small boundary noise keeps tower footprints organic while retaining a single flat top level.
          if (Math.hypot(cc - center.c, rr - center.r) > settings.radius + jitter) continue;
          const tile = merged.tiles.get(`${cc},${rr}`);
          if (!tile || ['river','stream','waterfall','trench'].includes(tile.type)) continue;
          tile.elevTier = tier;
          tile.rampElevation = 0;
          if (tile.type === 'ramp') tile.type = 'grass';
          tile.labKarstTowerId = index + 1;
          footprintTiles++;
          changedTiles++;
        }
      }
      towers.push({ id:index + 1, c:center.c, r:center.r, tier:Number(tier.toFixed(2)), footprintTiles });
    });
    const report = { applied:true, ...settings, minTier, maxTier, towers, changedTiles };
    workspace.wildernessLabFeatures = workspace.wildernessLabFeatures || {};
    workspace.wildernessLabFeatures.karstTowersPreview = report;
    return report;
  }

  function updateTerrainBadge(reports) {
    const stage = document.getElementById('stage');
    if (!stage) return;
    let badge = document.getElementById('terrainExperimentBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'terrainExperimentBadge';
      Object.assign(badge.style, {
        position:'absolute', left:'9px', top:'52px', zIndex:'6', maxWidth:'48%', padding:'5px 7px', borderRadius:'8px',
        background:'rgba(4,8,13,.80)', border:'1px solid rgba(255,255,255,.13)', color:'#dbeafe', fontSize:'9px', lineHeight:'1.35', pointerEvents:'none'
      });
      stage.appendChild(badge);
    }
    const lines = [];
    if (reports.basin?.applied) lines.push(`🥄 Great Basin: ${reports.basin.entrySide} entry · rim ${reports.basin.rimTier.toFixed(1)} · floor ${reports.basin.floorTier.toFixed(1)}`);
    if (reports.river?.applied) lines.push(`🌊 River carve: −${reports.river.depth.toFixed(1)} tiers · bank ${reports.river.bankWidth.toFixed(1)} tiles`);
    if (reports.karst?.applied) lines.push(`⛰️ Karst: ${reports.karst.towers.length} towers · ${reports.karst.minTier.toFixed(0)}–${reports.karst.maxTier.toFixed(0)} tiers`);
    badge.style.display = lines.length ? 'block' : 'none';
    badge.innerHTML = lines.join('<br>');
  }

  const originalBuildMergedZoneGrid = TerrainPreview.buildMergedZoneGrid.bind(TerrainPreview); // Shared terrain merge remains authoritative; experiments only transform the merged heightfield afterward.
  TerrainPreview.buildMergedZoneGrid = (workspace, rootMapId) => {
    const merged = originalBuildMergedZoneGrid(workspace, rootMapId);
    if (!merged?.rootMap) return merged;
    const reports = {};
    reports.basin = applyGreatBasinSpoonProfile(workspace, merged); // First establish the intended high-rim spoon terrain.
    reports.river = applyRiverCarveOverride(workspace, merged); // Then rivers cut downward through that terrain.
    reports.karst = applyKarstTowers(workspace, merged); // Karst towers are final protrusions, intentionally rising above the surrounding terrain.
    merged.wildernessLabTerrainReports = reports;
    window.__wildernessLabTerrainReports = reports;
    setTimeout(() => updateTerrainBadge(reports), 0);
    return merged;
  };

  installControlUi();
})();