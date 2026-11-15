// One-time named Lich-heart rewards. KeyItemSystem owns character persistence; no world or Tothal-cycle flags are needed.
(() => {
  'use strict';

  const HEARTS = Object.freeze({
    hronal: Object.freeze({ bossId:'azgarlu', itemId:'azgarlu_lich_heart', furnitureKey:'flamingLichHeart', label:'Flaming Lich-heart', icon:'🔥' }),
    tothal: Object.freeze({ bossId:'nanahi', itemId:'nanahi_lich_heart', furnitureKey:'unsleepingLichHeart', label:'Unsleeping Lich-heart', icon:'❄️' }),
    kanthic: Object.freeze({ bossId:'imlao', itemId:'imlao_lich_heart', furnitureKey:'sightlessLichHeart', label:'Sightless Lich-heart', icon:'💠' }),
  }); // One authored relic per named guardian, shared by the sanctum, Key Items, and Attunement.

  function forType(theme) { return HEARTS[String(theme || '').toLowerCase()] || null; } // Used when selecting the physical reward for the current named lich.
  function has(theme) {
    const heart = forType(theme); // Only registered hearts contribute capacity; quest key-stones are independent world rewards.
    return !!heart && window.KeyItemSystem?.has?.(heart.itemId) === true;
  }
  function count() {
    return Object.keys(HEARTS).reduce((total, theme) => total + (has(theme) ? 1 : 0), 0); // At most three permanent points, regardless of repeated visits or grants.
  }
  function collect(theme) {
    const heart = forType(theme); // The sole authority for validating what the world pickup can grant.
    if (!heart) return { ok:false, granted:false, message:'Unknown Lich-heart.' };
    const result = window.KeyItemSystem?.grant?.(heart.itemId);
    if (!result?.ok) return result || { ok:false, granted:false, message:'Key Items are unavailable.' };
    if (result.granted) {
      // Ownership is already durable. A broken HUD/menu must not interrupt removal of the claimed world prop.
      try { window.EquipmentPanel?.buildEquipmentSlots?.(); } catch (error) {
        window.__farmLog?.('[lich-heart] Gear refresh failed: ' + String(error?.message || error), 'warn');
      }
      const cap = window.TrinketSystem?.capacity?.() ?? 8 + count(); // Immediate mobile-visible acquisition feedback.
      try { (window.Combat?.deps?.showToast || window.showToast)?.(`${heart.label} acquired. Attunement capacity +1 (${cap}).`, true); } catch (_) {}
      window.__farmLog?.(`[lich-heart] ${heart.bossId} claimed; permanent character attunement ${count()}/3`, 'world');
    }
    return result;
  }

  window.KeyItemSystem?.defineMany?.(Object.values(HEARTS).map(heart => ({
    id:heart.itemId, label:heart.label, icon:heart.icon, scope:'character',
    desc:'A recovered Harlyao Lich-heart. Permanently increases this character’s Attunement capacity by 1 and follows them between worlds.',
  }))); // Definitions are registered once, before any character/ruin interaction needs to query them.

  window.LichHeartSystem = Object.freeze({
    HEARTS, forType, has, count, collect,
    debugSnapshot:() => ({ acquired:Object.entries(HEARTS).filter(([theme]) => has(theme)).map(([,heart]) => heart.itemId), bonus:count(), capacity:window.TrinketSystem?.capacity?.() || 8 + count() }),
  }); // Exposed to the existing in-game diagnostics as well as the sanctum composer.
})();