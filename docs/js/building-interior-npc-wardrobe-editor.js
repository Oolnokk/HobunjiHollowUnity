(() => {
  'use strict';

  if (window.BuildingInteriorNpcWardrobeEditor) return;

  const NPC_DATABASE_URL = '../../config/npcs/hobunji-starter-npc-database.json'; // Used to populate the selected furniture's NPC wardrobe owner dropdown.
  const METADATA_KEY = 'npcWardrobeFor'; // Used as the stable map-JSON field consumed by the runtime wardrobe interaction bridge.
  let npcRecords = []; // Used to resolve authored NPC ids into readable names in the furniture inspector.
  let lastSelection = null; // Used by mobile diagnostics and to keep status text meaningful immediately after an editor import rebuild.
  let statusEl = null; // Used to report assignment/import results without requiring console access.
  let ownerSelect = null; // Used to edit the selected furniture instance's wardrobe owner.
  let applyButton = null; // Used to commit the dropdown value through the editor's own JSON import path.

  function byId(id) { return document.getElementById(id); }

  function setStatus(message, tone = 'normal') {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = tone === 'error' ? '#ff9a9a' : tone === 'ok' ? '#85e09b' : '#9eacc3';
  }

  function readInterior() {
    byId('refreshExportBtn')?.click();
    const text = byId('exportText')?.value || '';
    if (!text.trim()) return null;
    try { return JSON.parse(text); }
    catch (error) {
      setStatus(`Could not read editor JSON: ${error.message}`, 'error');
      return null;
    }
  }

  function selectedAnchor() {
    const fields = byId('selFields'); // Used to distinguish a real furniture selection from stale inspector text.
    if (!fields || fields.classList.contains('hidden')) return null;
    const posText = byId('selPos')?.textContent || '';
    const positionMatch = /col\s+(-?\d+)\s*,\s*row\s+(-?\d+)/i.exec(posText);
    if (!positionMatch) return null;
    const labelText = byId('selLabel')?.textContent || '';
    const keyMatch = /\(([^()]+)\)\s*$/.exec(labelText);
    return {
      col: Number(positionMatch[1]),
      row: Number(positionMatch[2]),
      itemKey: keyMatch?.[1] || null,
    };
  }

  function selectedFurniture(interior = readInterior()) {
    const anchor = selectedAnchor(); // Used to map the closure-private editor selection back to its exported furniture record.
    if (!anchor || !interior?.furniture) return null;
    const matches = interior.furniture.filter(piece => Number(piece?.col) === anchor.col && Number(piece?.row) === anchor.row);
    return matches.find(piece => !anchor.itemKey || String(piece.itemKey) === anchor.itemKey) || matches[0] || null;
  }

  function ownerLabel(npcId) {
    const rec = npcRecords.find(npc => String(npc?.id) === String(npcId));
    return rec?.name || rec?.displayName || npcId || 'Unassigned';
  }

  function populateOwnerOptions() {
    if (!ownerSelect) return;
    const current = ownerSelect.value;
    ownerSelect.innerHTML = '<option value="">— Not an NPC wardrobe —</option>' + npcRecords
      .filter(npc => npc?.id)
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
      .map(npc => `<option value="${escapeHtml(npc.id)}">${escapeHtml(npc.name || npc.displayName || npc.id)} · ${escapeHtml(npc.id)}</option>`)
      .join('');
    if ([...ownerSelect.options].some(option => option.value === current)) ownerSelect.value = current;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function refreshSelectionUi() {
    const interior = readInterior();
    const piece = selectedFurniture(interior);
    const anchor = selectedAnchor();
    lastSelection = piece ? {
      id: piece.id || null,
      itemKey: piece.itemKey || null,
      col: Number(piece.col),
      row: Number(piece.row),
      npcWardrobeFor: piece[METADATA_KEY] || null,
    } : null;
    if (!ownerSelect || !applyButton) return;
    ownerSelect.disabled = !piece;
    applyButton.disabled = !piece;
    ownerSelect.value = piece?.[METADATA_KEY] || '';
    if (!piece) {
      setStatus(anchor ? 'The selected furniture could not be matched in the exported JSON.' : 'Select a furniture piece to assign an NPC wardrobe.');
      return;
    }
    const owner = piece[METADATA_KEY];
    setStatus(owner
      ? `${ownerLabel(owner)} uses this specific ${piece.itemKey || 'furniture'} instance as their wardrobe.`
      : 'This furniture is not assigned as an NPC wardrobe.');
  }

  function importInterior(interior) {
    const input = byId('importInput'); // Used to feed edited JSON through the editor's authoritative import/undo/rebuild path.
    if (!input) throw new Error('Editor import control is unavailable.');
    if (typeof DataTransfer !== 'function' || typeof File !== 'function') {
      throw new Error('This browser cannot programmatically hand the edited JSON back to the editor.');
    }
    const file = new File([JSON.stringify(interior, null, 2)], 'npc-wardrobe-edit.json', { type: 'application/json' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyAssignment() {
    const interior = readInterior();
    const piece = selectedFurniture(interior);
    if (!interior || !piece) {
      setStatus('Select a furniture piece before assigning a wardrobe.', 'error');
      return false;
    }
    const npcId = String(ownerSelect?.value || '').trim(); // Used as the authored NPC id stored on this one placed furniture instance.
    for (const other of (interior.furniture || [])) {
      if (other === piece) continue;
      if (npcId && String(other?.[METADATA_KEY] || '') === npcId) delete other[METADATA_KEY];
    }
    if (npcId) piece[METADATA_KEY] = npcId;
    else delete piece[METADATA_KEY];

    try {
      importInterior(interior);
      lastSelection = {
        id: piece.id || null,
        itemKey: piece.itemKey || null,
        col: Number(piece.col),
        row: Number(piece.row),
        npcWardrobeFor: npcId || null,
      };
      setStatus(npcId
        ? `Assigned ${ownerLabel(npcId)}. Any other wardrobe for that NPC in this interior was cleared.`
        : 'Removed this furniture’s NPC wardrobe assignment.', 'ok');
      return true;
    } catch (error) {
      setStatus(error.message, 'error');
      return false;
    }
  }

  async function loadNpcRecords() {
    try {
      const response = await fetch(NPC_DATABASE_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const database = await response.json();
      npcRecords = Array.isArray(database?.npcs) ? database.npcs : [];
      populateOwnerOptions();
      refreshSelectionUi();
    } catch (error) {
      setStatus(`NPC list failed to load (${error.message}). Existing assignments are still preserved.`, 'error');
    }
  }

  function installUi() {
    const selectionFields = byId('selFields'); // Used as the existing selected-furniture inspector container this additive section belongs to.
    if (!selectionFields || byId('npcWardrobeAssignmentSection')) return false;
    const section = document.createElement('div');
    section.id = 'npcWardrobeAssignmentSection';
    section.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.09)';
    section.innerHTML = `
      <div class="field">
        <label for="npcWardrobeOwner">NPC wardrobe</label>
        <select id="npcWardrobeOwner"><option value="">— Not an NPC wardrobe —</option></select>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="applyNpcWardrobeOwner" type="button">Apply wardrobe assignment</button>
      </div>
      <div id="npcWardrobeAssignmentStatus" class="hint" style="margin-top:6px">Select a furniture piece to assign an NPC wardrobe.</div>
      <div class="hint" style="margin-top:4px">The assignment belongs to this placed furniture instance, not its furniture type. One wardrobe per NPC per interior.</div>`;
    selectionFields.appendChild(section);
    ownerSelect = byId('npcWardrobeOwner');
    applyButton = byId('applyNpcWardrobeOwner');
    statusEl = byId('npcWardrobeAssignmentStatus');
    applyButton.addEventListener('click', applyAssignment);

    const selectionObserver = new MutationObserver(() => queueMicrotask(refreshSelectionUi)); // Used to follow the editor's private selectFurn() state through its visible inspector fields.
    const pos = byId('selPos');
    const label = byId('selLabel');
    selectionObserver.observe(selectionFields, { attributes: true, attributeFilter: ['class'] });
    if (pos) selectionObserver.observe(pos, { childList: true, characterData: true, subtree: true });
    if (label) selectionObserver.observe(label, { childList: true, characterData: true, subtree: true });

    loadNpcRecords();
    refreshSelectionUi();
    return true;
  }

  function bindingsSnapshot() {
    const interior = readInterior();
    return (interior?.furniture || [])
      .filter(piece => piece?.[METADATA_KEY])
      .map(piece => ({
        id: piece.id || null,
        itemKey: piece.itemKey || null,
        col: Number(piece.col),
        row: Number(piece.row),
        npcId: String(piece[METADATA_KEY]),
        npcName: ownerLabel(piece[METADATA_KEY]),
      }));
  }

  function boot() {
    if (!installUi()) setTimeout(boot, 50);
  }

  window.BuildingInteriorNpcWardrobeEditor = Object.freeze({
    metadataKey: METADATA_KEY,
    readInterior,
    selectedFurniture,
    applyAssignment,
    bindingsSnapshot,
    getLastSelection: () => lastSelection ? { ...lastSelection } : null,
  });
  window.__biaNpcWardrobeDebug = () => ({
    selected: lastSelection ? { ...lastSelection } : null,
    bindings: bindingsSnapshot(),
    npcCount: npcRecords.length,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
