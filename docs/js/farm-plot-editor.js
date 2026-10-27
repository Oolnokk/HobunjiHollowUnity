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

  function init(injected) { deps = injected || {}; render(); }

  function plotAt(c, r, kind) { return plots.find(p => (!kind || p.kind === kind) && p.tiles.some(t => t[0] === c && t[1] === r)) || null; }
  function removeTile(c, r) {
    let changed = false;
    for (const p of plots) {
      const n = p.tiles.length;
      p.tiles = p.tiles.filter(t => !(t[0] === c && t[1] === r));
      if (p.tiles.length !== n) changed = true;
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
    if (!kind) { if (removeTile(c, r)) render(); return null; }
    if (!stroke) {
      stroke = plotAt(c, r, kind);
      if (!stroke) {
        const n = plots.filter(p => p.kind === kind).length + 1;
        stroke = { id: uid(), label: `${kind === 'till' ? 'Family field' : 'Family trench'} ${n}`, kind, tiles: [], crop: '', workers: [], hours: [8, 17] };
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

  function serialize() { return !loaded ? null : plots.map(p => ({ ...p, tiles: p.tiles.map(t => [...t]), workers: [...p.workers], hours: [...p.hours] })); }
  function restore(saved) {
    loaded = true;
    plots = Array.isArray(saved) ? saved.filter(p => p?.id && Array.isArray(p.tiles)).map(p => ({
      id: String(p.id), label: p.label || 'Family plot', kind: p.kind === 'dig' ? 'dig' : 'till', tiles: p.tiles.map(t => [Number(t[0]), Number(t[1])]),
      crop: p.crop || '', workers: Array.isArray(p.workers) ? p.workers.filter(Boolean) : [], hours: Array.isArray(p.hours) && p.hours.length === 2 ? p.hours.map(Number) : [8, 17],
    })) : [];
    if (!plots.some(p => p.id === activeId)) activeId = null;
    window.NpcFarmPlots?.registerFarmPlots?.(plots);
    render();
  }

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

  window.FarmPlotEditor = { init, onTerrainPaint, beginStroke, endStroke, serialize, restore, render, plots: () => plots };
})();
