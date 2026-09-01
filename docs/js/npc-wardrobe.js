// NPC Wardrobe — the "keep or return" side of clothing gifts (see
// js/npc-gifting.js), plus the container UI for browsing/taking items back
// out. Design (see the task this was built for):
//   - Each NPC accepts a gifted garment only if it shares a trait with
//     their OWN default outfit (snapshotted once at boot, before any
//     reroll could have touched it) — otherwise it's handed straight back.
//   - Accepted garments go into that NPC's wardrobe container. Everything
//     they own ends up visible there, including whatever they're currently
//     wearing — but worn items aren't reachable/removable except by taking
//     them from the "Currently Worn" list, and even then the change is
//     cosmetic-only until their next reroll (see rerollForSleep).
//   - The worn outfit itself is only re-chosen from the wardrobe pool when
//     the NPC goes to sleep (game.js edge-detects the schedule activity
//     transitioning into "sleeping" and calls rerollForSleep).
//
// Scope note: an NPC's `equippedCosmetics` array has no per-entry slot
// metadata in the database schema (unlike a player clothing-gear entry,
// which always carries `.slot` — see js/equipment-panel.js's
// makeClothingGearEntry). Stored/gifted items DO carry `.slot` (they came
// from the player's own gear), so the reroll below can safely place a
// stored item into a real slot; picking which of the NPC's *current*
// cosmetics to displace for that slot instead falls back to a keyword
// guess over the cosmetic id (see guessSlot). This is an approximation,
// not a rendering-accurate slot resolver.
(() => {
  'use strict';
  if (window.NpcWardrobe) return;

  let deps = null;
  const stored = {}; // npcId -> [clothing instance] — persisted (see serialize/restore).
  const defaultTraitSets = {}; // npcId -> Set(trait ids) — snapshotted once, never touched again.

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
    if (accepted) {
      const list = stored[npcId] || (stored[npcId] = []);
      list.push({ ...instance, uid: 'wcloth_' + Math.random().toString(36).slice(2, 10) });
      deps?.saveMemberWorldData?.();
    }
    return { accepted };
  }

  // ── Contents / taking items back out ────────────────────────────
  function getWardrobeContents(npcId) {
    const walker = findWalker(npcId);
    const rec = walker?.rec;
    const dyeRef = primaryDyeRef(rec);
    const worn = (rec?.equippedCosmetics || []).map(cosmeticId => ({
      uid: 'worn_' + cosmeticId, cosmeticId, colorA: dyeRef, worn: true,
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

  // ── Bedtime reroll ───────────────────────────────────────────────
  function guessSlot(cosmeticId) {
    const id = cosmeticId.toLowerCase();
    if (/hat|kasa|helmet|headband/.test(id)) return 'hat';
    if (/hood/.test(id)) return 'hood';
    if (/poncho|cloak|wrap|overwear/.test(id)) return 'overwear';
    return 'torso';
  }

  const TIER_WEIGHT = { loved: 4, liked: 2, neutral: 1, disliked: 0.3, hated: 0.05 };
  function weightFor(npcGifts, traits) {
    const has = (list) => (list || []).some(t => traits.includes(t));
    if (has(npcGifts?.hated)) return TIER_WEIGHT.hated;
    if (has(npcGifts?.loved)) return TIER_WEIGHT.loved;
    if (has(npcGifts?.disliked)) return TIER_WEIGHT.disliked;
    if (has(npcGifts?.liked)) return TIER_WEIGHT.liked;
    return TIER_WEIGHT.neutral;
  }
  function weightedPick(candidates, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return candidates[0];
    let roll = Math.random() * total;
    for (let i = 0; i < candidates.length; i++) { roll -= weights[i]; if (roll <= 0) return candidates[i]; }
    return candidates[candidates.length - 1];
  }

  // Called from game.js once per NPC whose schedule activity just
  // transitioned into "sleeping". For each slot that has at least one
  // stored candidate, weighted-picks between "keep the current outfit" and
  // each stored candidate (weights from the NPC's own gifts.* reaction, so
  // they gravitate toward loved/liked garments over time) and, on a swap,
  // moves the displaced current piece into storage and re-baked the live
  // avatar texture in place (see js/png-plane-avatar.js's
  // refreshSinglePlaneAvatarModel — the same call the ambient portrait-life
  // system already uses for expression changes).
  async function rerollForSleep(npcId) {
    const walker = findWalker(npcId);
    const rec = walker?.rec;
    if (!rec) return false;
    const npcGifts = rec.gifts || {};
    const bySlot = {};
    for (const item of (stored[npcId] || [])) (bySlot[item.slot || guessSlot(item.cosmeticId)] ||= []).push(item);
    let changed = false;

    for (const [slot, candidates] of Object.entries(bySlot)) {
      if (!candidates.length) continue;
      const options = [null, ...candidates]; // null = keep current outfit for this slot.
      const weights = options.map(opt => opt
        ? weightFor(npcGifts, window.ItemTraits?.computeItemTraits(opt.cosmeticId, opt) || [])
        : TIER_WEIGHT.neutral);
      const winner = weightedPick(options, weights);
      if (!winner) continue;

      const currentIdx = (rec.equippedCosmetics || []).findIndex(id => guessSlot(id) === slot);
      const displacedId = currentIdx !== -1 ? rec.equippedCosmetics[currentIdx] : null;
      if (displacedId === winner.cosmeticId) continue;

      if (currentIdx !== -1) rec.equippedCosmetics.splice(currentIdx, 1, winner.cosmeticId);
      else (rec.equippedCosmetics || (rec.equippedCosmetics = [])).push(winner.cosmeticId);
      if (winner.colorA?.dyeId) rec.appliedDyes = { ...(rec.appliedDyes || {}), [slot.toUpperCase()]: winner.colorA.dyeId };

      const list = stored[npcId] || (stored[npcId] = []);
      list.splice(list.findIndex(i => i.uid === winner.uid), 1);
      if (displacedId) list.push({ uid: 'wcloth_' + Math.random().toString(36).slice(2, 10), cosmeticId: displacedId, slot, colorA: primaryDyeRef(rec) });
      changed = true;
    }

    if (changed) {
      await refreshWalkerAppearance(walker);
      deps?.saveMemberWorldData?.();
    }
    return changed;
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
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#9fb2cc;margin:10px 0 6px">Currently Worn (changes only at bedtime)</div>
        <div>${worn.length ? worn.map(rowHtml).join('') : '<p style="color:#9fb2cc;font-size:12px">Nothing on hand.</p>'}</div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#9fb2cc;margin:14px 0 6px">Stored</div>
        <div>${storedItems.length ? storedItems.map(rowHtml).join('') : '<p style="color:#9fb2cc;font-size:12px">Nothing stored yet — gift them clothing they\'ll wear.</p>'}</div>
      `;
      panel.querySelector('#npcWardrobeClose').addEventListener('click', closeWardrobePanel);
      panel.querySelectorAll('.npc-wardrobe-take').forEach(btn => btn.addEventListener('click', () => {
        takeFromWardrobe(npcId, btn.dataset.uid);
        deps?.showToast?.('Took ' + (btn.dataset.label || 'the garment') + ' from the wardrobe.', true);
        render();
      }));
    }

    function rowHtml(item) {
      const label = item.label || prettifyCosmeticId(item.cosmeticId);
      const swatch = item.colorA?.hex ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${item.colorA.hex};margin-right:6px"></span>` : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #26384f;border-radius:9px;margin-bottom:6px">
        <span style="flex:1;font-size:12.5px">${swatch}${label}</span>
        ${item.worn ? '<span style="font-size:10px;color:#9fb2cc">worn</span>' : `<button class="npc-wardrobe-take" data-uid="${item.uid}" data-label="${label}" style="border:1px solid rgba(106,167,255,.4);background:rgba(106,167,255,.16);color:#edf4ff;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer">Take</button>`}
      </div>`;
    }

    render();
    document.body.appendChild(overlay);
  }

  // ── Save/load ────────────────────────────────────────────────────
  function serialize() { return stored; }
  function restore(data) {
    Object.keys(stored).forEach(k => delete stored[k]);
    if (data && typeof data === 'object') Object.assign(stored, data);
  }

  window.NpcWardrobe = {
    init,
    offerClothing,
    getWardrobeContents,
    takeFromWardrobe,
    rerollForSleep,
    openWardrobePanel,
    closeWardrobePanel,
    serialize,
    restore,
  };
})();
