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
    for (const walker of (deps.npcWalkers || [])) captureDefaultOutfitTraits(walker?.rec);
  }

  function findWalker(npcId) {
    return (deps?.npcWalkers || []).find(w => w.rec?.id === npcId) || null;
  }

  function findRecord(npcId) {
    return deps?.getNpcRecordById?.(npcId) || findWalker(npcId)?.rec || null; // Canonical record access keeps outfit persistence working even while an NPC has no live walker.
  }

  const TINT_KEYS_BY_SLOT = Object.freeze({
    hat: ['HAT'],
    hood: ['HOOD', 'HOOD_B'],
    torso: ['TORSO'],
    overwear: ['CLOTH', 'CLOTH_B'],
  }); // Maps wardrobe clothing slots to the NPC portrait tint channels used by authored appliedDyes.

  function tintKeysForSlot(slot) {
    return TINT_KEYS_BY_SLOT[slot] || [];
  }

  function dyeIdFromColor(colorLike) {
    if (!colorLike) return null;
    return typeof colorLike === 'string' ? colorLike : (colorLike.dyeId || null); // Stored NPC clothes may carry authored dye refs as strings while gifted player clothes carry color objects.
  }

  function clothingColorsFromWorn(rec, slot) {
    const [primaryKey, secondaryKey] = tintKeysForSlot(slot); // Resolves the currently worn article's actual dye channels instead of borrowing an unrelated appliedDyes entry.
    const dyes = rec?.appliedDyes || {}; // Read by default-outfit trait snapshots and when a worn garment is moved into storage.
    return {
      colorA: primaryKey ? (dyes[primaryKey] || null) : null,
      colorB: secondaryKey ? (dyes[secondaryKey] || null) : null,
    };
  }

  function applyClothingColorsToWorn(rec, slot, item) {
    const tintKeys = tintKeysForSlot(slot); // Controls which authored NPC dye channels belong to the clothing slot being replaced.
    if (!tintKeys.length) return;
    const nextDyes = { ...(rec?.appliedDyes || {}) }; // Preserves every unrelated body/clothing dye while replacing only this garment's channels.
    for (const tintKey of tintKeys) delete nextDyes[tintKey];
    const itemColors = [item?.colorA, item?.colorB]; // Gift/stored primary and secondary colors map in order to the slot's portrait tint keys.
    tintKeys.forEach((tintKey, index) => {
      const dyeId = dyeIdFromColor(itemColors[index]); // Accepts both player color objects and legacy/authored NPC dye-ref strings.
      if (dyeId) nextDyes[tintKey] = dyeId;
    });
    rec.appliedDyes = nextDyes;
  }

  function computeOutfitTraits(rec) {
    const traits = new Set();
    for (const cosmeticId of (rec?.equippedCosmetics || [])) {
      const slot = guessSlot(cosmeticId); // Associates the authored cosmetic with the same tint channel mapping used by rendering.
      const colors = clothingColorsFromWorn(rec, slot); // Ensures wardrobe acceptance sees only colors actually worn by this garment.
      const instance = { cosmeticId, slot, ...colors }; // Passed to ItemTraits so both primary/secondary worn dyes contribute their real traits.
      (window.ItemTraits?.computeItemTraits(cosmeticId, instance) || []).forEach(t => traits.add(t));
    }
    return traits;
  }

  function captureDefaultOutfitTraits(rec) {
    if (!rec?.id || defaultTraitSets[rec.id]) return false;
    defaultTraitSets[rec.id] = computeOutfitTraits(rec); // Immutable authored-style snapshot used for future clothing-gift acceptance, taken before saved/manual outfit overrides can mutate the record.
    return true;
  }

  function ensureDefaults(npcId, rec) {
    if (!defaultTraitSets[npcId] && rec) captureDefaultOutfitTraits(rec);
    return defaultTraitSets[npcId] || new Set();
  }

  function clothingWearability(rec, item) {
    const traits = window.ItemTraits?.computeItemTraits(item?.cosmeticId, item) || []; // Used to veto wearing any garment carrying an explicitly disliked/hated NPC trait.
    const hatedTrait = (rec?.gifts?.hated || []).find(trait => traits.includes(trait)); // Hated traits take precedence in refusal feedback when both bad tiers match.
    const dislikedTrait = (rec?.gifts?.disliked || []).find(trait => traits.includes(trait)); // Disliked traits also hard-veto wearing regardless of positive traits on the same garment.
    const blockedTrait = hatedTrait || dislikedTrait || null; // Single refusal reason used by gifting, wardrobe buttons, and manual Wear attempts.
    return {
      allowed: !blockedTrait,
      blockedTrait,
      tier: hatedTrait ? 'hated' : (dislikedTrait ? 'disliked' : null),
    };
  }

  // ── Gift acceptance ──────────────────────────────────────────────
  function offerClothing(npcId, instance) {
    const walker = findWalker(npcId);
    const rec = findRecord(npcId); // Gift targets normally have a walker, but canonical lookup keeps wardrobe mutation tied to persistent NPC data.
    const defaults = ensureDefaults(npcId, rec);
    const offeredTraits = window.ItemTraits?.computeItemTraits(instance.cosmeticId, instance) || [];
    // No default-trait data at all (should not happen once init() has run)
    // fails open rather than silently rejecting every gift forever.
    const accepted = defaults.size === 0 || offeredTraits.some(t => defaults.has(t));
    if (!accepted) return { accepted: false, worn: false };

    const list = stored[npcId] || (stored[npcId] = []);
    const gifted = { ...instance, uid: 'wcloth_' + Math.random().toString(36).slice(2, 10) }; // Stored copy keeps the player's original inventory identity out of NPC persistence.
    list.push(gifted);
    const wearability = clothingWearability(rec, gifted); // Gift preference is a hard wear veto even when the garment otherwise fits this NPC's wardrobe style.
    const worn = wearability.allowed ? equipStoredItemData(npcId, gifted.uid) : false; // Disliked/hated clothing stays stored instead of appearing on the NPC.
    if (worn) void refreshWalkerAppearance(walker);
    return { accepted: true, worn, wearBlockedBy: wearability.blockedTrait, wearBlockTier: wearability.tier };
  }
  // ── Contents / taking items back out ────────────────────────────
  function getWardrobeContents(npcId) {
    const walker = findWalker(npcId);
    const rec = findRecord(npcId);
    const worn = (rec?.equippedCosmetics || []).map((cosmeticId, index) => {
      const slot = guessSlot(cosmeticId); // Used by Store and the row preview to keep this worn article tied to its actual tint channel.
      return {
        uid: 'worn_' + index + '_' + cosmeticId,
        cosmeticId,
        slot,
        ...clothingColorsFromWorn(rec, slot),
        worn: true,
        label: prettifyCosmeticId(cosmeticId),
      };
    });
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
      ...clothingColorsFromWorn(rec, slot), // Keeps the displaced garment's own primary/secondary dyes so wearing it again restores its appearance.
    };
  }

  function equipStoredItemData(npcId, uid) {
    const walker = findWalker(npcId);
    const rec = findRecord(npcId); // Manual Wear mutates canonical NPC data first; the live walker is only needed for redraw.
    const list = stored[npcId] || [];
    const storedIdx = list.findIndex(item => item.uid === uid);
    if (!rec || storedIdx === -1) return false;

    const winner = list[storedIdx];
    if (!clothingWearability(rec, winner).allowed) return false; // Manual Wear obeys the same disliked/hated-trait veto as immediate gift try-on.
    const slot = winner.slot || guessSlot(winner.cosmeticId); // Gift/player slot wins; guessed slot is only a fallback for older persisted wardrobe items.
    const equipped = rec.equippedCosmetics || (rec.equippedCosmetics = []);
    const currentIdx = equipped.findIndex(id => guessSlot(id) === slot);
    const displacedId = currentIdx !== -1 ? equipped[currentIdx] : null;
    const displacedItem = displacedId ? storedCopyFromWorn(rec, displacedId, slot) : null; // Captures the old garment's dyes before this slot's tint channels are replaced.
    if (displacedId === winner.cosmeticId
      && dyeIdFromColor(displacedItem.colorA) === dyeIdFromColor(winner.colorA)
      && dyeIdFromColor(displacedItem.colorB) === dyeIdFromColor(winner.colorB)) return false; // Only an identical garment+dye is a no-op; a recolored copy of the worn cosmetic still swaps in.

    if (currentIdx !== -1) equipped.splice(currentIdx, 1, winner.cosmeticId);
    else equipped.push(winner.cosmeticId);
    list.splice(storedIdx, 1);
    if (displacedItem) list.push(displacedItem);
    applyClothingColorsToWorn(rec, slot, winner);
    recordOutfitOverride(npcId, rec);
    return true;
  }

  async function wearStoredItem(npcId, uid) {
    const walker = findWalker(npcId);
    const rec = findRecord(npcId); // Used for both the wear veto and player-facing naming if the NPC is temporarily offscreen.
    const item = (stored[npcId] || []).find(entry => entry.uid === uid); // Used to provide refusal feedback before the equip mutation path runs.
    const wearability = item ? clothingWearability(rec, item) : { allowed: false, blockedTrait: null, tier: null }; // Same hard veto used during gifting.
    if (!wearability.allowed) {
      const traitLabel = wearability.blockedTrait ? (window.ItemTraits?.getTraitLabel?.(wearability.blockedTrait) || wearability.blockedTrait) : 'that style'; // Player-facing reason avoids a silent dead Wear button.
      deps?.showToast?.(`${rec?.name || 'They'} won't wear it — they ${wearability.tier === 'hated' ? 'hate' : 'dislike'} ${traitLabel}.`, false);
      return false;
    }
    const changed = equipStoredItemData(npcId, uid);
    if (!changed) return false;
    await refreshWalkerAppearance(walker);
    deps?.saveMemberWorldData?.();
    return true;
  }

  function storeWornItemData(npcId, cosmeticId) {
    const walker = findWalker(npcId);
    const rec = findRecord(npcId); // Store updates the canonical outfit even when the associated NPC is not currently rendered.
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
    const guessedSpecies = String(rec?.species || '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, ''); // Used only as the same legacy-record fallback as makeNpcWalker when appearance.speciesId is absent.
    const authoredAppearance = (rec?.appearance && typeof rec.appearance === 'object') ? rec.appearance : {}; // Canonical source for every authored appearance field; rendered walker profiles intentionally do not retain this source object.
    const appearance = {
      ...authoredAppearance,
      speciesId: authoredAppearance.speciesId || guessedSpecies || undefined,
      gender: authoredAppearance.gender || (rec?.gender === 'female' ? 'female' : 'male'),
      cosmetics: authoredAppearance.cosmetics || {},
    }; // Fills only missing legacy identity fields while preserving body colors, deformation, cosmetics, and all other authored appearance data.
    const profile = window.NpcAvatarPreview.buildProfileFromNpcExport({
      name: rec?.name || rec?.id || 'npc',
      appearance,
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
      const wearability = item.worn ? { allowed: true } : clothingWearability(walker?.rec, item); // Stored rows show the same preference veto enforced by the Wear action.
      const wearButton = wearability.allowed
        ? `<button class="npc-wardrobe-wear" data-uid="${item.uid}" data-label="${label}" style="border:1px solid rgba(106,167,255,.4);background:rgba(106,167,255,.16);color:#edf4ff;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer">Wear</button>`
        : `<span style="font-size:10px;color:#d99696">won't wear</span>`;
      const buttons = item.worn
        ? `<button class="npc-wardrobe-store" data-cosmetic-id="${item.cosmeticId}" data-label="${label}" style="border:1px solid rgba(106,167,255,.4);background:rgba(106,167,255,.16);color:#edf4ff;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer">Store</button>`
        : `${wearButton}<button class="npc-wardrobe-take" data-uid="${item.uid}" data-label="${label}" style="border:1px solid rgba(106,167,255,.4);background:rgba(106,167,255,.16);color:#edf4ff;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer">Take</button>`;
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #26384f;border-radius:9px;margin-bottom:6px"><span style="flex:1;font-size:12.5px">${swatch}${label}</span>${buttons}</div>`;
    }
    render();
    document.body.appendChild(overlay);
  }

  // ── Save/load ────────────────────────────────────────────────────
  function applyOutfitOverrideToRecord(rec) {
    const outfit = rec?.id ? outfitOverrides[rec.id] : null; // Read by restore and the NPC spawn bridge so deferred/visitor walkers cannot miss a saved manual outfit.
    if (!rec || !outfit) return false;
    rec.equippedCosmetics = [...(outfit.equippedCosmetics || [])];
    rec.appliedDyes = { ...(outfit.appliedDyes || {}) };
    return true;
  }

  async function syncWalkerOutfit(walker) {
    if (!applyOutfitOverrideToRecord(walker?.rec)) return false; // Re-applies after async walker construction to close the restore-vs-spawn race.
    await refreshWalkerAppearance(walker);
    return true;
  }

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
    for (const npcId of Object.keys(outfitOverrides)) {
      const rec = findRecord(npcId); // Canonical lookup restores offscreen/deferred NPC data even when no walker exists yet.
      if (rec) applyOutfitOverrideToRecord(rec);
      const walker = findWalker(npcId);
      if (walker) void refreshWalkerAppearance(walker);
    }
  }
  window.NpcWardrobe = {
    init,
    offerClothing,
    getWardrobeContents,
    takeFromWardrobe,
    clothingWearability,
    wearStoredItem,
    storeWornItem,
    openWardrobePanel,
    closeWardrobePanel,
    captureDefaultOutfitTraits,
    applyOutfitOverrideToRecord,
    syncWalkerOutfit,
    serialize,
    restore,
  };
})();
