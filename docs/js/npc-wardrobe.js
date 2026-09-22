// NPC Wardrobe — clothing gifts plus the NPC's manually editable outfit.
// Accepted clothing is tried on immediately. The wardrobe is the player's
// corrective control: worn pieces can be stored immediately, and stored
// pieces can be worn immediately, with the live avatar rebaked in place.
//
// Acceptance still compares a gift against the NPC's OWN default outfit
// traits, snapshotted once at boot before any gifted clothing changes them.
// Current outfit overrides are persisted alongside stored garments so a
// manual correction survives save/load.
//
// Scope note: an NPC's `equippedCosmetics` array has no per-entry slot
// metadata. Gifted/player clothing does carry `.slot`, so equipping a stored
// item uses that real slot; identifying the slot of an already-worn cosmetic
// still falls back to guessSlot(cosmeticId).
(() => {
  'use strict';
  if (window.NpcWardrobe) return;

  let deps = null;
  const stored = {}; // npcId -> [clothing instance] persisted as the NPC's wardrobe contents.
  const outfitOverrides = {}; // npcId -> { equippedCosmetics, appliedDyes } persisted only after gifted/manual outfit changes.
  const defaultTraitSets = {}; // npcId -> Set(trait ids) snapshotted once so later gifted clothes never redefine taste.

  function init(injectedDeps) {
    deps = injectedDeps;
    for (const walker of (deps.npcWalkers || [])) {
      const rec = walker?.rec;
      if (rec?.id && !defaultTraitSets[rec.id]) defaultTraitSets[rec.id] = computeOutfitTraits(rec);
    }
  }

  function findWalker(npcId) {
    return (deps?.npcWalkers || []).find(w => w.rec?.id === npcId) || null;
  }

  function primaryDyeRef(rec) {
    return Object.values(rec?.appliedDyes || {}).find(Boolean) || null;
  }

  // Approximation noted at the top of the file: every equipped cosmetic is
  // colored with the NPC's first applied dye, since the schema doesn't
  // track which dye belongs to which cosmetic slot by cosmetic id alone.
  function computeOutfitTraits(rec) {
    const traits = new Set();
    const dyeRef = primaryDyeRef(rec);
    for (const cosmeticId of (rec?.equippedCosmetics || [])) {
      const instance = { cosmeticId, colorA: dyeRef };
      (window.ItemTraits?.computeItemTraits(cosmeticId, instance) || []).forEach(t => traits.add(t));
    }
    return traits;
  }

  function ensureDefaults(npcId, rec) {
    if (!defaultTraitSets[npcId] && rec) defaultTraitSets[npcId] = computeOutfitTraits(rec);
    return defaultTraitSets[npcId] || new Set();
  }

  // ── Gift acceptance ──────────────────────────────────────────────
  function offerClothing(npcId, instance) {
    const walker = findWalker(npcId);
    const defaults = ensureDefaults(npcId, walker?.rec);
    const offeredTraits = window.ItemTraits?.computeItemTraits(instance.cosmeticId, instance) || [];
    // No default-trait data at all (should not happen once init() has run)
    // fails open rather than silently rejecting every gift forever.
    const accepted = defaults.size === 0 || offeredTraits.some(t => defaults.has(t));
    if (!accepted) return { accepted: false, worn: false };

    const list = stored[npcId] || (stored[npcId] = []);
    const gifted = { ...instance, uid: 'wcloth_' + Math.random().toString(36).slice(2, 10) }; // Stored copy keeps the player's original inventory identity out of NPC persistence.
    list.push(gifted);
    const worn = equipStoredItemData(npcId, gifted.uid); // Accepted clothing is tried on immediately instead of waiting for a sleep transition.
    if (worn) void refreshWalkerAppearance(walker);
    return { accepted: true, worn };
  }
  // ── Contents / taking items back out ────────────────────────────
  function getWardrobeContents(npcId) {
    const walker = findWalker(npcId);
    const rec = walker?.rec;
    const dyeRef = primaryDyeRef(rec);
    const worn = (rec?.equippedCosmetics || []).map((cosmeticId, index) => ({
      uid: 'worn_' + index + '_' + cosmeticId, cosmeticId, slot: guessSlot(cosmeticId), colorA: dyeRef, worn: true,
      label: prettifyCosmeticId(cosmeticId),
    }));
    return { worn, stored: (stored[npcId] || []).map(item => ({ ...item, worn: false })) };
  }

  function prettifyCosmeticId(id) {
    const leaf = id.includes('::') ? id.split('::').pop() : id;
    return leaf.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function takeFromWardrobe(npcId, uid) {
    const list = stored[npcId] || [];
    const idx = list.findIndex(item => item.uid === uid);
    if (idx === -1) return false;
    const [item] = list.splice(idx, 1);
    const gearInventory = deps.getGearInventory();
    if (gearInventory) {
      gearInventory.clothingItems = gearInventory.clothingItems || [];
      gearInventory.clothingItems.push({ ...item, uid: 'gcloth_' + Math.random().toString(36).slice(2, 10) });
      deps.saveGearInventory?.();
    }
    deps?.saveMemberWorldData?.();
    return true;
  }

  // ── Immediate outfit editing ─────────────────────────────────────
  function guessSlot(cosmeticId) {
    const id = String(cosmeticId || '').toLowerCase();
    if (/hat|kasa|helmet|headband/.test(id)) return 'hat';
    if (/hood/.test(id)) return 'hood';
    if (/poncho|cloak|wrap|overwear/.test(id)) return 'overwear';
    return 'torso';
  }

  function recordOutfitOverride(npcId, rec) {
    if (!npcId || !rec) return;
    outfitOverrides[npcId] = {
      equippedCosmetics: [...(rec.equippedCosmetics || [])], // Persists the exact corrected worn list across reloads.
      appliedDyes: { ...(rec.appliedDyes || {}) }, // Persists dye changes made when a gifted/stored garment becomes worn.
    };
  }

  function storedCopyFromWorn(rec, cosmeticId, slot) {
    return {
      uid: 'wcloth_' + Math.random().toString(36).slice(2, 10), // Fresh wardrobe identity avoids collisions with player inventory and other stored copies.
      cosmeticId,
      slot,
      colorA: primaryDyeRef(rec),
    };
  }

  function equipStoredItemData(npcId, uid) {
    const walker = findWalker(npcId);
    const rec = walker?.rec;
    const list = stored[npcId] || [];
    const storedIdx = list.findIndex(item => item.uid === uid);
    if (!rec || storedIdx === -1) return false;

    const winner = list[storedIdx];
    const slot = winner.slot || guessSlot(winner.cosmeticId); // Gift/player slot wins; guessed slot is only a fallback for older persisted wardrobe items.
    const equipped = rec.equippedCosmetics || (rec.equippedCosmetics = []);
    const currentIdx = equipped.findIndex(id => guessSlot(id) === slot);
    const displacedId = currentIdx !== -1 ? equipped[currentIdx] : null;
    if (displacedId === winner.cosmeticId) return false;

    if (currentIdx !== -1) equipped.splice(currentIdx, 1, winner.cosmeticId);
    else equipped.push(winner.cosmeticId);
    list.splice(storedIdx, 1);
    if (displacedId) list.push(storedCopyFromWorn(rec, displacedId, slot));
    if (winner.colorA?.dyeId) rec.appliedDyes = { ...(rec.appliedDyes || {}), [slot.toUpperCase()]: winner.colorA.dyeId };
    recordOutfitOverride(npcId, rec);
    return true;
  }

  async function wearStoredItem(npcId, uid) {
    const walker = findWalker(npcId);
    const changed = equipStoredItemData(npcId, uid);
    if (!changed) return false;
    await refreshWalkerAppearance(walker);
    deps?.saveMemberWorldData?.();
    return true;
  }

  function storeWornItemData(npcId, cosmeticId) {
    const walker = findWalker(npcId);
    const rec = walker?.rec;
    const equipped = rec?.equippedCosmetics || [];
    const currentIdx = equipped.indexOf(cosmeticId);
    if (!rec || currentIdx === -1) return false;

    const slot = guessSlot(cosmeticId);
    equipped.splice(currentIdx, 1);
    const list = stored[npcId] || (stored[npcId] = []);
    list.push(storedCopyFromWorn(rec, cosmeticId, slot));
    recordOutfitOverride(npcId, rec);
    return true;
  }

  async function storeWornItem(npcId, cosmeticId) {
    const walker = findWalker(npcId);
    const changed = storeWornItemData(npcId, cosmeticId);
    if (!changed) return false;
    await refreshWalkerAppearance(walker);
    deps?.saveMemberWorldData?.();
    return true;
  }
  async function refreshWalkerAppearance(walker) {
    if (!walker?.avatarGroup?.userData?.frontTexture || !window.NpcAvatarPreview || !window.PNGPlaneAvatar) return;
    const rec = walker.rec;
    const profile = window.NpcAvatarPreview.buildProfileFromNpcExport({
      name: rec?.name || rec?.id || 'npc',
      appearance: walker.profile?.appearance || { speciesId: undefined, gender: rec?.gender === 'female' ? 'female' : 'male', cosmetics: {} },
      equippedCosmetics: rec?.equippedCosmetics || [],
      appliedDyes: rec?.appliedDyes || {},
    });
    if (!profile) return;
    walker.profile = profile;
    try {
      await window.NpcAvatarPreview.renderProfileToCanvas(walker.avatarFrontCanvas, profile, { forceEyesOpen: true });
      if (walker.avatarBackCanvas) await window.NpcAvatarPreview.renderProfileToCanvas(walker.avatarBackCanvas, profile, { portraitView: 'behind', forceEyesOpen: true });
      window.PNGPlaneAvatar.refreshSinglePlaneAvatarModel(walker.avatarGroup, walker.avatarFrontCanvas, { backCanvas: walker.avatarBackCanvas });
    } catch (e) { /* Best-effort — the data change already applied regardless of whether the redraw succeeded. */ }
  }

  // ── Container UI ─────────────────────────────────────────────────
  // Fully self-built overlay (no dependency on any pre-existing panel
  // markup in index.html) so this stays a self-contained addition.
  function closeWardrobePanel() {
    document.getElementById('npcWardrobeOverlay')?.remove();
  }

  function openWardrobePanel(npcId) {
    closeWardrobePanel();
    const walker = findWalker(npcId);
    const name = walker?.rec?.name || walker?.rec?.displayName || 'Their';
    const overlay = document.createElement('div');
    overlay.id = 'npcWardrobeOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(6,10,16,.72);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeWardrobePanel(); });

    const panel = document.createElement('div');
    panel.style.cssText = 'width:min(520px,92vw);max-height:80vh;overflow-y:auto;background:#111b28;color:#edf4ff;border:1px solid #26384f;border-radius:14px;padding:16px 18px;';
    overlay.appendChild(panel);

    function render() {
      const { worn, stored: storedItems } = getWardrobeContents(npcId);
      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h2 style="margin:0;font-size:15px;color:#6aa7ff">${name}'s Wardrobe</h2>
          <button id="npcWardrobeClose" style="border:none;background:transparent;color:#9fb2cc;font-size:18px;cursor:pointer">×</button>
        </div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#9fb2cc;margin:10px 0 6px">Currently Worn</div>
        <div>${worn.length ? worn.map(rowHtml).join('') : '<p style="color:#9fb2cc;font-size:12px">Nothing on hand.</p>'}</div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#9fb2cc;margin:14px 0 6px">Stored</div>
        <div>${storedItems.length ? storedItems.map(rowHtml).join('') : '<p style="color:#9fb2cc;font-size:12px">Nothing stored yet — gift them clothing they\'ll wear.</p>'}</div>
      `;
      panel.querySelector('#npcWardrobeClose').addEventListener('click', closeWardrobePanel);
      panel.querySelectorAll('.npc-wardrobe-store').forEach(btn => btn.addEventListener('click', async () => {
        if (await storeWornItem(npcId, btn.dataset.cosmeticId)) {
          deps?.showToast?.('Stored ' + (btn.dataset.label || 'the garment') + '. Outfit updated.', true);
          render();
        }
      }));
      panel.querySelectorAll('.npc-wardrobe-wear').forEach(btn => btn.addEventListener('click', async () => {
        if (await wearStoredItem(npcId, btn.dataset.uid)) {
          deps?.showToast?.('Put on ' + (btn.dataset.label || 'the garment') + '.', true);
          render();
        }
      }));
      panel.querySelectorAll('.npc-wardrobe-take').forEach(btn => btn.addEventListener('click', () => {
        takeFromWardrobe(npcId, btn.dataset.uid);
        deps?.showToast?.('Took ' + (btn.dataset.label || 'the garment') + ' from the wardrobe.', true);
        render();
      }));
    }
    function rowHtml(item) {
      const label = item.label || prettifyCosmeticId(item.cosmeticId);
      const swatch = item.colorA?.hex ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${item.colorA.hex};margin-right:6px"></span>` : '';
      const buttons = item.worn
        ? `<button class="npc-wardrobe-store" data-cosmetic-id="${item.cosmeticId}" data-label="${label}" style="border:1px solid rgba(106,167,255,.4);background:rgba(106,167,255,.16);color:#edf4ff;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer">Store</button>`
        : `<button class="npc-wardrobe-wear" data-uid="${item.uid}" data-label="${label}" style="border:1px solid rgba(106,167,255,.4);background:rgba(106,167,255,.16);color:#edf4ff;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer">Wear</button><button class="npc-wardrobe-take" data-uid="${item.uid}" data-label="${label}" style="border:1px solid rgba(106,167,255,.4);background:rgba(106,167,255,.16);color:#edf4ff;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer">Take</button>`;
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #26384f;border-radius:9px;margin-bottom:6px"><span style="flex:1;font-size:12.5px">${swatch}${label}</span>${buttons}</div>`;
    }
    render();
    document.body.appendChild(overlay);
  }

  // ── Save/load ────────────────────────────────────────────────────
  function serialize() {
    return { version: 2, stored, outfits: outfitOverrides };
  }
  function restore(data) {
    Object.keys(stored).forEach(k => delete stored[k]);
    Object.keys(outfitOverrides).forEach(k => delete outfitOverrides[k]);
    if (!data || typeof data !== 'object') return;

    const isV2 = Number(data.version) >= 2 && data.stored && typeof data.stored === 'object'; // Distinguishes stored+outfit saves from legacy npcId->items wardrobe saves.
    Object.assign(stored, isV2 ? data.stored : data);
    if (!isV2 || !data.outfits || typeof data.outfits !== 'object') return;
    Object.assign(outfitOverrides, data.outfits);
    for (const [npcId, outfit] of Object.entries(outfitOverrides)) {
      const walker = findWalker(npcId);
      const rec = walker?.rec;
      if (!rec || !outfit) continue;
      rec.equippedCosmetics = [...(outfit.equippedCosmetics || [])];
      rec.appliedDyes = { ...(outfit.appliedDyes || {}) };
      void refreshWalkerAppearance(walker);
    }
  }
  window.NpcWardrobe = {
    init,
    offerClothing,
    getWardrobeContents,
    takeFromWardrobe,
    wearStoredItem,
    storeWornItem,
    openWardrobePanel,
    closeWardrobePanel,
    serialize,
    restore,
  };
})();
