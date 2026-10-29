// Farm plot groups on the player's own farm. In the Farm Editor, Tilled and Trench strokes build groups — a stroke that
// starts on an existing group of the same kind extends it, otherwise it starts a new one — listed in the "Family plots"
// section of the editor panel. A group can be given to your spouse and children (an ordered lineup: the first one free
// does the work, the others back them up) to keep dug, or tilled and seeded with a chosen crop. Seeds come out of Farm
// Storage; the work is done on the real farm tiles by js/npc-farm-plots.js.
//
// Painting into a group that already has someone assigned only designates the tile: they till or dig it themselves.
// A group with no one assigned is just painted terrain.
(() => {
  'use strict';
  if (window.FarmPlotEditor) return;

  const KIND_FOR_BRUSH = { tilled: 'till', trench: 'dig' };
  const CROPS = ['needlegrain', 'heftroot', 'garlink', 'ongyums', 'redberries', 'blueberries', 'yellowberries', 'blackMustard', 'greenMustard'];
  const SLOTS = 3;
  let deps = null;
  let plots = []; // { id, label, kind, tiles: [[c, r]], crop, workers: [npcId], hours: [from, to] }
  let activeId = null;
  let stroke = null;
  let loaded = false; // Until a layout has been applied (or a plot painted) a save must keep what is already stored.

  const uid = () => `fplot_${Math.random().toString(36).slice(2, 8)}`;
  const pane = () => document.getElementById('farmPlotsPane');
  function trimSeedBlocks(plot) {
    const owned = new Set(plot.tiles.map(([c, r]) => c + ',' + r)); // Seed-block memberships must always stay inside the parent field.
    const claimed = new Set(); // Prevent two seed priorities from claiming the same planting tile.
    for (const block of plot.seedBlocks || []) {
      block.tiles = block.tiles.filter(([c, r]) => {
        const key = c + ',' + r;
        if (!owned.has(key) || claimed.has(key)) return false;
        claimed.add(key);
        return true;
      });
    }
  }
  function normalizedSeedBlocks(raw, tiles) {
    const plot = { tiles, seedBlocks: [] }; // Temporary plot lets restore reuse the same membership validator as live edits.
    for (const block of Array.isArray(raw) ? raw : []) {
      if (!block || !block.id) continue;
      const seen = new Set(); // Duplicate seed identifiers have no extra planting priority.
      plot.seedBlocks.push({
        id: String(block.id),
        label: String(block.label || 'Seed block').slice(0, 48),
        tiles: Array.isArray(block.tiles) ? block.tiles.filter(t => Array.isArray(t) && t.length >= 2 && Number.isInteger(Number(t[0])) && Number.isInteger(Number(t[1]))).map(t => [Number(t[0]), Number(t[1])]) : [],
        seeds: (Array.isArray(block.seeds) ? block.seeds : []).filter(crop => {
          if (!CROPS.includes(crop) || seen.has(crop)) return false;
          seen.add(crop); return true;
        }),
      });
    }
    trimSeedBlocks(plot);
    return plot.seedBlocks;
  }

  function init(injected) { deps = injected || {}; render(); }

  function plotAt(c, r, kind) { return plots.find(p => (!kind || p.kind === kind) && p.tiles.some(t => t[0] === c && t[1] === r)) || null; }
  function removeTile(c, r) {
    let changed = false;
    for (const p of plots) {
      const n = p.tiles.length;
      p.tiles = p.tiles.filter(t => !(t[0] === c && t[1] === r));
      if (p.tiles.length !== n) { trimSeedBlocks(p); changed = true; }
    }
    if (changed) { plots = plots.filter(p => p.tiles.length); if (!plots.some(p => p.id === activeId)) activeId = null; }
    return changed;
  }

  // Family who can be assigned: the spouse and any children (those who have been born).
  function family() {
    const out = [];
    const spouse = window.RomanceSystem?.getSpouse?.();
    const name = id => window.RomanceSystem?.helpers?.npcName?.(id) || id;
    if (spouse?.npcId) out.push({ id: spouse.npcId, name: `${name(spouse.npcId)} (spouse)` });
    for (const child of window.RomanceFamily?.snapshot?.()?.children || []) {
      if (child?.id && child.phase === 'child') out.push({ id: child.id, name: `${child.name || child.id} (child)` });
    }
    return out;
  }

  // Called by FarmEditor for every terrain brush tile. Returns 'designate' when the tile joined a group that already has
  // workers (the editor then leaves the tile's terrain alone).
  function onTerrainPaint(c, r, brush) {
    loaded = true;
    const kind = KIND_FOR_BRUSH[brush];
    if (!kind) { if (removeTile(c, r)) { window.NpcFarmPlots?.registerFarmPlots?.(plots); render(); } return null; } // Non-plot brush still releases the live workers before the enclosing FarmEditor save.
    if (!stroke) {
      stroke = plotAt(c, r, kind);
      if (!stroke) {
        const n = plots.filter(p => p.kind === kind).length + 1;
        stroke = { id: uid(), label: `${kind === 'till' ? 'Family field' : 'Family trench'} ${n}`, kind, tiles: [], crop: '', seedBlocks: [], workers: [], hours: [8, 17] };
        plots.push(stroke);
      }
      activeId = stroke.id;
      render();
    }
    const other = plotAt(c, r);
    if (other && other !== stroke) removeTile(c, r);
    if (!stroke.tiles.some(t => t[0] === c && t[1] === r)) stroke.tiles.push([c, r]);
    return stroke.workers.length ? 'designate' : null;
  }
  function beginStroke() { stroke = null; }
  function endStroke() {
    if (!stroke) return;
    stroke = null;
    sync();
    render();
  }

  function sync() {
    window.NpcFarmPlots?.registerFarmPlots?.(plots);
    deps?.save?.();
  }

  function serialize() { return !loaded ? null : plots.map(p => ({ ...p, tiles: p.tiles.map(t => [...t]), seedBlocks: (p.seedBlocks || []).map(b => ({ ...b, tiles: b.tiles.map(t => [...t]), seeds: [...b.seeds] })), workers: [...p.workers], hours: [...p.hours] })); }
  function restore(saved) {
    loaded = true;
    plots = Array.isArray(saved) ? saved.filter(p => p?.id && Array.isArray(p.tiles)).map(p => ({
      id: String(p.id), label: p.label || 'Family plot', kind: p.kind === 'dig' ? 'dig' : 'till', tiles: p.tiles.map(t => [Number(t[0]), Number(t[1])]),
      crop: p.crop || '', seedBlocks: normalizedSeedBlocks(p.kind === 'dig' ? [] : p.seedBlocks, p.tiles.map(t => [Number(t[0]), Number(t[1])])), workers: Array.isArray(p.workers) ? p.workers.filter(Boolean) : [], hours: Array.isArray(p.hours) && p.hours.length === 2 ? p.hours.map(Number) : [8, 17],
    })) : [];
    // Older layouts may contain duplicated tile designations. Resolve them before
    // registering workers: a planting field wins over a trench to avoid crop loss.
    const owners = new Map(); // Tile key -> the one plot allowed to change this soil.
    for (const p of plots) for (const [c, r] of p.tiles) {
      if (!Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0) continue;
      const key = c + ',' + r;
      if (!owners.has(key) || (owners.get(key).kind === 'dig' && p.kind === 'till')) owners.set(key, p);
    }
    for (const p of plots) {
      const seen = new Set(); // Ignore repeated coordinates within a legacy plot.
      p.tiles = p.tiles.filter(([c, r]) => {
        const key = c + ',' + r;
        if (owners.get(key) !== p || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    for (const p of plots) trimSeedBlocks(p); // Overlap recovery may have transferred a seed block's tiles.
    if (!plots.some(p => p.id === activeId)) activeId = null;
    window.NpcFarmPlots?.registerFarmPlots?.(plots);
    render();
  }


  // Normal-play Farmwork UI edits the SAME plot records as the dev Farm Editor, without changing terrain.
  // A designation is just an assignment for a real NPC worker, never a free till/dig action.
  function createFamilyPlot(kind) {
    if (kind !== 'till' && kind !== 'dig') return null;
    loaded = true;
    const n = plots.filter(p => p.kind === kind).length + 1; // Display sequence, not a persistent identity.
    const spouseId = window.RomanceSystem?.getSpouse?.()?.npcId; // New groups are actionable as soon as the marriage exists.
    const plot = { id: uid(), label: `Family ${kind === 'till' ? 'field' : 'trench'} ${n}`, kind, tiles: [], crop: '', seedBlocks: [], workers: spouseId ? [spouseId] : [], hours: [8, 17] };
    plots.push(plot);
    activeId = plot.id;
    sync(); render();
    return plot.id;
  }
  function selectFamilyPlot(id) {
    if (!plots.some(p => p.id === id)) return false;
    activeId = id; render(); return true;
  }
  function deleteFamilyPlot(id) {
    if (!plots.some(p => p.id === id)) return false;
    loaded = true;
    plots = plots.filter(p => p.id !== id);
    if (activeId === id) activeId = plots[0]?.id || null;
    sync(); render(); return true;
  }
  function updateFamilyPlot(id, patch) {
    const p = plots.find(entry => entry.id === id); // Only a valid existing group may be edited from normal gameplay.
    if (!p || !patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
    const next = { ...p }; // Stage and validate all fields before updating the persisted plot; rejected edits are atomic.
    if (patch.label !== undefined) next.label = String(patch.label).trim().slice(0, 48) || p.label;
    if (patch.crop !== undefined && p.kind === 'till') {
      if (patch.crop && !CROPS.includes(patch.crop)) return false;
      next.crop = patch.crop;
    }
    if (patch.hours !== undefined) {
      if (!Array.isArray(patch.hours) || patch.hours.length !== 2) return false;
      const hours = patch.hours.map(Number); // Validate schedule intervals together so no half-updated shift can be saved.
      if (!hours.every(Number.isFinite) || hours.some(v => v < 0 || v > 24) || hours[0] >= hours[1]) return false;
      next.hours = hours;
    }
    if (patch.workers !== undefined) {
      if (!Array.isArray(patch.workers)) return false;
      const eligible = new Set(family().map(person => person.id)); // Reject arbitrary IDs without dropping the existing lineup.
      next.workers = [...new Set(patch.workers)].filter(id => eligible.has(id)).slice(0, SLOTS);
    }
    Object.assign(p, next);
    loaded = true; sync(); render(); return true;
  }
  function setFamilyTile(id, c, r, present, { deferSave = false } = {}) {
    const plot = plots.find(entry => entry.id === id);
    if (!plot || !Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0) return false;
    const exists = plot.tiles.some(t => t[0] === c && t[1] === r); // Painting a tile twice never toggles it unexpectedly.
    if (exists === !!present) return false;
    // Validate before transferring overlaps, so a rejected edit cannot change either plot.
    if (present && plot.tiles.length) {
      const cols = plot.tiles.map(t => t[0]), rows = plot.tiles.map(t => t[1]);
      if (Math.max(c, ...cols) - Math.min(c, ...cols) >= 7 || Math.max(r, ...rows) - Math.min(r, ...rows) >= 7) return false;
    }
    loaded = true;
    if (present) {
      // Remove overlapping designations without filtering out the NEW empty plot being painted.
      // removeTile() is for dev brush erasing and would discard this empty target before its first tile.
      for (const other of plots) if (other !== plot) {
        other.tiles = other.tiles.filter(t => t[0] !== c || t[1] !== r);
        trimSeedBlocks(other); // Transferring a farm tile also unassigns any former seed-block membership.
      }
      // Retain emptied source plots and their crop, hours and worker lineup. The player can reuse or explicitly delete them.
      plot.tiles.push([c, r]);
    } else {
      plot.tiles = plot.tiles.filter(t => t[0] !== c || t[1] !== r);
    }
    trimSeedBlocks(plot); // Removing an included tile may also remove it from a seed block.
    if (!deferSave) { sync(); render(); }
    return true;
  }
  function createSeedBlock(plotId) {
    const p = plots.find(entry => entry.id === plotId && entry.kind === 'till');
    if (!p) return null;
    const id = uid(); // Used by FarmworkUI to select the newly created block and by storage serialization.
    p.seedBlocks ||= [];
    p.seedBlocks.push({ id, label: 'Seed block ' + (p.seedBlocks.length + 1), tiles: [], seeds: [] });
    loaded = true; sync(); render();
    return id;
  }
  function deleteSeedBlock(plotId, blockId) {
    const p = plots.find(entry => entry.id === plotId && entry.kind === 'till');
    if (!p?.seedBlocks?.some(b => b.id === blockId)) return false;
    p.seedBlocks = p.seedBlocks.filter(b => b.id !== blockId);
    loaded = true; sync(); render(); return true;
  }
  function updateSeedBlock(plotId, blockId, patch) {
    const p = plots.find(entry => entry.id === plotId && entry.kind === 'till');
    const b = p?.seedBlocks?.find(entry => entry.id === blockId);
    if (!b || !patch || typeof patch !== 'object') return false;
    if (patch.seeds !== undefined && (!Array.isArray(patch.seeds) || patch.seeds.some(crop => !CROPS.includes(crop)) || new Set(patch.seeds).size !== patch.seeds.length)) return false;
    if (patch.label !== undefined) b.label = String(patch.label).trim().slice(0, 48) || b.label;
    if (patch.seeds !== undefined) b.seeds = [...patch.seeds]; // Ordered crop keys are the worker's seed preference, from Farm Storage.
    loaded = true; sync(); render(); return true;
  }
  function setSeedBlockTile(plotId, blockId, c, r, present, { deferSave = false } = {}) {
    const p = plots.find(entry => entry.id === plotId && entry.kind === 'till');
    const b = p?.seedBlocks?.find(entry => entry.id === blockId);
    if (!b || !Number.isInteger(c) || !Number.isInteger(r) || !p.tiles.some(t => t[0] === c && t[1] === r)) return false;
    const exists = b.tiles.some(t => t[0] === c && t[1] === r);
    if (exists === !!present) return false;
    if (present) {
      for (const other of p.seedBlocks) if (other !== b) other.tiles = other.tiles.filter(t => t[0] !== c || t[1] !== r);
      b.tiles.push([c, r]);
    } else b.tiles = b.tiles.filter(t => t[0] !== c || t[1] !== r);
    loaded = true;
    if (!deferSave) { sync(); render(); }
    return true;
  }
  function commitFamilyEdits() { loaded = true; sync(); render(); }
  function activeFamilyPlot() { return plots.find(p => p.id === activeId) || null; }

  const esc = text => String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function render() {
    const el = pane();
    if (!el) return;
    const people = family();
    let html = '';
    html += plots.map(p => `<div class="fed-btn ${p.id === activeId ? 'fed-active' : ''}" data-fplot="${p.id}" style="display:flex;justify-content:space-between;gap:6px;cursor:pointer">
      <span>${p.kind === 'till' ? '🌱' : '🕳️'} ${esc(p.label)} · ${p.tiles.length} tiles · ${p.workers.length ? 'assigned' : 'unassigned'}</span>
      <span data-fplotdel="${p.id}" title="Delete group">✕</span></div>`).join('') || '<div style="font-size:11px;opacity:.7;padding:2px 0">Paint Tilled or Trench tiles to start a group.</div>';
    const ap = plots.find(p => p.id === activeId);
    if (ap) {
      html += `<div style="margin-top:6px;display:grid;gap:4px">
        <input data-fplotfield="label" value="${esc(ap.label)}" aria-label="Group name">`;
      if (ap.kind === 'till') {
        html += `<select data-fplotfield="crop" aria-label="Crop to seed"><option value="">No seeding</option>${CROPS.map(c => `<option value="${c}" ${ap.crop === c ? 'selected' : ''}>${esc(deps?.cropLabel?.(c) || c)}</option>`).join('')}</select>`;
      }
      html += `<div style="display:flex;gap:4px"><input data-fplotfield="from" type="number" min="0" max="24" step="0.5" value="${ap.hours[0]}" aria-label="From hour" style="width:50%"><input data-fplotfield="to" type="number" min="0" max="24" step="0.5" value="${ap.hours[1]}" aria-label="Until hour" style="width:50%"></div>`;
      if (!people.length) html += '<div style="font-size:11px;opacity:.7">Marry, or have a child old enough to walk, to assign someone.</div>';
      for (let i = 0; i < SLOTS; i += 1) {
        html += `<select data-fplotworker="${i}" aria-label="${i === 0 ? 'Does the work' : `Backup ${i}`}"><option value="">${i === 0 ? 'Assign who does the work…' : `Backup ${i}…`}</option>${people.map(person => `<option value="${esc(person.id)}" ${ap.workers[i] === person.id ? 'selected' : ''}>${esc(person.name)}</option>`).join('')}</select>`;
      }
      html += `<div style="font-size:11px;opacity:.7">${ap.kind === 'till' ? 'They till the group and sow the chosen crop (seeds come from Farm Storage).' : 'They keep the trenches dug.'} Tiles you paint into an assigned group are theirs to work.</div></div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-fplot]').forEach(node => node.addEventListener('click', event => {
      if (event.target.closest('[data-fplotdel]')) return;
      activeId = node.dataset.fplot; render();
    }));
    el.querySelectorAll('[data-fplotdel]').forEach(node => node.addEventListener('click', event => {
      event.stopPropagation();
      plots = plots.filter(p => p.id !== node.dataset.fplotdel);
      if (activeId === node.dataset.fplotdel) activeId = null;
      sync(); render();
    }));
    if (!ap) return;
    el.querySelectorAll('[data-fplotfield]').forEach(input => input.addEventListener('change', () => {
      const field = input.dataset.fplotfield;
      if (field === 'label') ap.label = input.value.trim() || ap.label;
      else if (field === 'crop') ap.crop = input.value;
      else ap.hours = [Number(el.querySelector('[data-fplotfield="from"]').value) || 0, Number(el.querySelector('[data-fplotfield="to"]').value) || 0];
      sync(); render();
    }));
    el.querySelectorAll('[data-fplotworker]').forEach(select => select.addEventListener('change', () => {
      const lineup = [];
      el.querySelectorAll('[data-fplotworker]').forEach(node => { if (node.value && !lineup.includes(node.value)) lineup.push(node.value); });
      ap.workers = lineup;
      sync(); render();
    }));
  }

  window.FarmPlotEditor = { init, onTerrainPaint, beginStroke, endStroke, serialize, restore, render, plots: () => plots, family, cropOptions: () => CROPS.map(c => ({ value: c, label: deps?.cropLabel?.(c) || c })), createFamilyPlot, selectFamilyPlot, deleteFamilyPlot, updateFamilyPlot, setFamilyTile, createSeedBlock, deleteSeedBlock, updateSeedBlock, setSeedBlockTile, commitFamilyEdits, activeFamilyPlot };
})();
