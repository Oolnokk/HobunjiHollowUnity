(() => {
  'use strict';

  // Relationships menu tab — lists every NPC the player has talked to, with
  // their friendship tier/favor progress. Extracted out of game.js following
  // the same window.<Namespace> + init(deps) pattern as its sibling panel
  // renders. window.DialogueContent/window.ProceduralTasks are left as
  // direct references (already global by the time this ever renders), same
  // treatment other extractions give already-extracted sibling modules.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // Per-NPC chathead icon — the same head-cropped image ambient dialogue
  // shows floating above them in the world (see js/ambient-dialogue.js's
  // renderChatheadImage/buildChatheadProfile), rendered once onto an
  // offscreen canvas and cached as a data URL so re-opening/re-rendering
  // this tab doesn't redo the render for every NPC every time.
  const chatheadCache = new Map(); // npcId -> data URL ('' once resolved-but-unavailable, null while in flight)

  function ensureChathead(npcId, profile) {
    if (chatheadCache.has(npcId) || !profile || !window.AmbientDialogue?.renderChatheadImage) return;
    chatheadCache.set(npcId, null);
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    window.AmbientDialogue.renderChatheadImage(canvas, profile, { seatId: npcId })
      .then(ok => {
        chatheadCache.set(npcId, ok ? canvas.toDataURL() : '');
        renderRelationshipsPanel(); // Refresh now that this one NPC's chathead is ready.
      })
      .catch(() => chatheadCache.set(npcId, ''));
  }

  function chatheadIconHtml(npcId) {
    const cached = chatheadCache.get(npcId);
    return cached
      ? `<img class="sh-icon npc-chathead" src="${cached}" alt="">`
      : `<div class="sh-icon">💬</div>`;
  }

  function renderRelationshipsPanel() {
    const list = document.getElementById('relationshipsList');
    if (!list) return;
    list.innerHTML = '';
    const dlgState = window.DialogueContent?.npcDlgState;
    const knownIds = dlgState ? [...dlgState.keys()].filter(id => (dlgState.get(id).memory || []).length > 0) : [];
    if (!knownIds.length) {
      list.innerHTML = '<div class="delivery-row"><span class="dr-icon">💬</span><span class="dr-name">You haven\'t talked to anyone yet.</span><span class="dr-eta">—</span></div>';
      return;
    }
    knownIds
      .map(npcId => {
        const walker = deps.npcWalkers.find(w => w.rec?.id === npcId);
        return { npcId, rec: walker?.rec, profile: walker?.profile, ...window.ProceduralTasks.friendshipTierProgress(npcId) };
      })
      .sort((a, b) => b.favor - a.favor)
      .forEach(({ npcId, rec, profile, tier, favor, next }) => {
        ensureChathead(npcId, profile);
        const name = rec?.name || npcId;
        const favorDisplay = Math.round(favor * 10) / 10;
        const progressNote = next != null ? `${Math.round((next - favor) * 10) / 10} favor to Tier ${tier + 1}` : 'max tier';
        // Same renderer the dialogue box's heart readout uses (see
        // dialogue-content.js's renderRelationshipHearts) — the Friendship
        // Tier label and this heart row are two views of the identical
        // favor number/scale, not separate trackers.
        const heartsHtml = window.DialogueContent?.renderRelationshipHearts?.(rec) || '';
        const rapport = Math.max(0, Math.min(100, Number(window.NpcRapport?.get?.(npcId) || 0))); // Used to render the NPC's temporary daily social affinity without altering permanent friendship sorting.
        const rapportPct = Number.isFinite(rapport) ? rapport : 0; // Used as the clamped width/value for the 0–100 rapport bar.
        const row = document.createElement('div');
        row.className = 'shop-row';
        row.innerHTML = `
          ${chatheadIconHtml(npcId)}
          <div class="sh-info">
            <div class="sh-name">${deps.esc(name)} — Friendship Tier ${tier}${heartsHtml ? ` ${heartsHtml}` : ''}</div>
            <div class="sh-desc">${favorDisplay} favor (${progressNote})</div>
            <div class="sh-desc" style="margin-top:5px;display:flex;align-items:center;gap:7px">
              <span style="min-width:78px">Rapport ${Math.round(rapportPct)}/100</span>
              <span role="progressbar" aria-label="Daily rapport" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(rapportPct)}" style="display:inline-block;flex:1;min-width:72px;max-width:190px;height:7px;border:1px solid rgba(255,255,255,.2);border-radius:999px;overflow:hidden;background:rgba(0,0,0,.2)">
                <span style="display:block;height:100%;width:${rapportPct}%;background:currentColor;opacity:.72"></span>
              </span>
            </div>
            <div class="sh-desc">${discoveredGiftTraitsHtml(npcId)}</div>
          </div>
        `;
        list.appendChild(row);
      });
  }

  // Gift-preference traits actually learned about this NPC so far (see
  // js/npc-gifting.js's discoveredPrefs — recorded the moment a gift's
  // reaction reveals one, not spoiled from their gifts.json data up
  // front). Loved/liked render green, disliked/hated render red, same
  // color convention as the gift prompt's own dislike/hate warning.
  function discoveredGiftTraitsHtml(npcId) {
    const found = window.NpcGifting?.getDiscoveredGiftTraits?.(npcId);
    if (!found) return '';
    const label = id => deps.esc(window.ItemTraits?.getTraitLabel?.(id) || id);
    const group = (ids, color) => ids.length
      ? `<span style="color:${color}">${ids.map(label).join(', ')}</span>` : '';
    const parts = [
      group(found.loved, '#34d399'),
      group(found.liked, '#6aa7ff'),
      group(found.disliked, '#fbbf24'),
      group(found.hated, '#fb7185'),
    ].filter(Boolean);
    return parts.length ? `Known preferences: ${parts.join(' · ')}` : 'No known gift preferences yet — try gifting them something.';
  }

  window.RelationshipsPanel = {
    init,
    render: renderRelationshipsPanel,
  };
})();
