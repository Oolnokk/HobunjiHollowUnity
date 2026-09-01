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
      .map(npcId => ({ npcId, rec: deps.npcWalkers.find(w => w.rec?.id === npcId)?.rec, ...window.ProceduralTasks.friendshipTierProgress(npcId) }))
      .sort((a, b) => b.favor - a.favor)
      .forEach(({ npcId, rec, tier, favor, next }) => {
        const name = rec?.name || npcId;
        const progressNote = next != null ? `${next - favor} favor to Tier ${tier + 1}` : 'max tier';
        const row = document.createElement('div');
        row.className = 'shop-row';
        row.innerHTML = `
          <div class="sh-icon">💬</div>
          <div class="sh-info">
            <div class="sh-name">${deps.esc(name)} — Friendship Tier ${tier}</div>
            <div class="sh-desc">${favor} favor (${progressNote})</div>
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
