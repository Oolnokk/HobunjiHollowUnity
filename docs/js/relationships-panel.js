(() => {
  'use strict';

  // Relationships menu tab — lists every NPC the player has talked to, with
  // their friendship tier/favor progress. Extracted out of game.js following
  // the same window.<Namespace> + init(deps) pattern as its sibling panel
  // renders. window.DialogueContent/window.ProceduralTasks are left as
  // direct references (already global by the time this ever renders), same
  // treatment other extractions give already-extracted sibling modules.
  let deps = null;
  function init(injectedDeps) {
    deps = injectedDeps;
    ensureKeepsakeStyles();
  }

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

  // Keepsakes are deliberately a display-only, auto-packed grid. Mabinogi's
  // inventory made visually large/awkward items consume correspondingly large
  // rectangular footprints; here we reuse that visual language without adding
  // manual inventory management to a relationship-history screen.
  const KEEPSAKE_GRID_COLUMNS = 6;
  const KEEPSAKE_MIN_ROWS = 4;
  const KEEPSAKE_TARGET_CELLS = 5;
  const KEEPSAKE_MAX_ITEM_CELLS = 4;
  const keepsakeProviders = new Set(); // Extra systems (quests/hearts/etc.) register providers here instead of patching this renderer.
  const spriteAspectCache = new Map(); // sprite URL -> natural width/height ratio; used to derive each keepsake's tile footprint.
  let keepsakeRerenderQueued = false;
  let keepsakeStylesInstalled = false;

  function ensureKeepsakeStyles() {
    if (keepsakeStylesInstalled || document.getElementById('relationshipKeepsakeStyles')) return;
    keepsakeStylesInstalled = true;
    const style = document.createElement('style');
    style.id = 'relationshipKeepsakeStyles';
    style.textContent = `
      #relationshipsList .relationship-row {
        display: grid;
        grid-template-columns: minmax(0, 1.18fr) minmax(210px, .82fr);
        align-items: stretch;
        gap: 0;
        padding: 0;
        overflow: hidden;
      }
      #relationshipsList .relationship-summary {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
      }
      #relationshipsList .relationship-keepsakes {
        min-width: 0;
        padding: 7px 8px 8px;
        border-left: 1px solid var(--border);
        background: rgba(0, 0, 0, .10);
      }
      #relationshipsList .relationship-keepsakes-title {
        margin-bottom: 5px;
        font-size: 8px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      #relationshipsList .relationship-keepsake-grid {
        --ks-cell: clamp(17px, 1.45vw, 25px);
        position: relative;
        display: grid;
        grid-template-columns: repeat(${KEEPSAKE_GRID_COLUMNS}, var(--ks-cell));
        grid-auto-rows: var(--ks-cell);
        width: calc(${KEEPSAKE_GRID_COLUMNS} * var(--ks-cell));
        max-width: 100%;
        min-height: calc(${KEEPSAKE_MIN_ROWS} * var(--ks-cell));
        border: 1px solid rgba(255, 255, 255, .08);
        border-radius: 7px;
        overflow: hidden;
        background-color: rgba(0, 0, 0, .13);
        background-image:
          linear-gradient(to right, rgba(255,255,255,.055) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(255,255,255,.055) 1px, transparent 1px);
        background-size: var(--ks-cell) var(--ks-cell);
      }
      #relationshipsList .relationship-keepsake-item {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        min-height: 0;
        padding: 2px;
        pointer-events: auto;
      }
      #relationshipsList .relationship-keepsake-item img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        object-position: center;
        user-select: none;
        -webkit-user-drag: none;
        transition: filter .16s ease, opacity .16s ease, transform .16s ease;
      }
      #relationshipsList .relationship-keepsake-item.locked img {
        filter: brightness(0);
        opacity: .90;
      }
      #relationshipsList .relationship-keepsake-item.unlocked img {
        filter: none;
        opacity: 1;
      }
      #relationshipsList .relationship-keepsake-item.unlocked:hover img {
        transform: scale(1.04);
      }
      #relationshipsList .relationship-keepsake-fallback {
        width: 74%;
        height: 74%;
        border-radius: 38% 22% 42% 28%;
        background: #000;
        opacity: .85;
      }
      @media (max-width: 760px) {
        #relationshipsList .relationship-row {
          grid-template-columns: minmax(0, 1fr) minmax(160px, .72fr);
        }
        #relationshipsList .relationship-keepsake-grid {
          --ks-cell: clamp(14px, 3.3vw, 20px);
        }
      }
    `;
    document.head?.appendChild(style);
  }

  function scheduleKeepsakeRerender() {
    if (keepsakeRerenderQueued) return;
    keepsakeRerenderQueued = true;
    const run = () => {
      keepsakeRerenderQueued = false;
      renderRelationshipsPanel();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  function spriteAspectRatio(sprite) {
    const src = String(sprite || '').trim();
    if (!src) return 1;
    const cached = spriteAspectCache.get(src);
    if (Number.isFinite(cached) && cached > 0) return cached;
    if (cached === null) return 1;

    spriteAspectCache.set(src, null);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const width = Number(image.naturalWidth) || 1;
      const height = Number(image.naturalHeight) || 1;
      spriteAspectCache.set(src, Math.max(.15, Math.min(6, width / height)));
      scheduleKeepsakeRerender();
    };
    image.onerror = () => {
      spriteAspectCache.set(src, 1);
      scheduleKeepsakeRerender();
    };
    image.src = src;
    return 1;
  }

  function footprintForKeepsake(keepsake) {
    const explicitW = Number(keepsake?.gridW);
    const explicitH = Number(keepsake?.gridH);
    if (Number.isFinite(explicitW) && Number.isFinite(explicitH) && explicitW > 0 && explicitH > 0) {
      return {
        w: Math.max(1, Math.min(KEEPSAKE_GRID_COLUMNS, Math.round(explicitW))),
        h: Math.max(1, Math.min(KEEPSAKE_MAX_ITEM_CELLS, Math.round(explicitH))),
      };
    }

    const ratio = spriteAspectRatio(keepsake?.sprite);
    const w = Math.max(1, Math.min(KEEPSAKE_MAX_ITEM_CELLS, Math.round(Math.sqrt(KEEPSAKE_TARGET_CELLS * ratio))));
    const h = Math.max(1, Math.min(KEEPSAKE_MAX_ITEM_CELLS, Math.round(Math.sqrt(KEEPSAKE_TARGET_CELLS / ratio))));
    return { w: Math.min(KEEPSAKE_GRID_COLUMNS, w), h };
  }

  function weaponTrustKeepsakes(npcId) {
    const trust = window.WeaponTrustVisits;
    const gifts = Array.isArray(trust?.config?.gifts) ? trust.config.gifts : [];
    if (!gifts.length) return [];

    // Combat exposes the same mutable TOOL_ITEM_DEFS table used by inventory,
    // equipment, smithing and ranged dual-role setup. Resolve the gift's actual
    // item definition from shape + metal so the keepsake automatically uses the
    // canonical weapon sprite instead of maintaining a second asset map here.
    const toolDefs = window.Combat?.deps?.TOOL_ITEM_DEFS || {};
    const definitions = Object.entries(toolDefs);
    return gifts
      .filter(gift => gift?.npcId === npcId)
      .map(gift => {
        const exact = definitions.find(([, def]) => def?.shapeKey === gift.shapeKey && def?.metalKey === gift.giftMetalKey);
        const shapeFallback = exact || definitions.find(([, def]) => def?.shapeKey === gift.shapeKey);
        const [itemKey, def] = shapeFallback || ['', null];
        return {
          id: `weapon-trust:${gift.id}`,
          npcId,
          label: def?.label || gift.dialogueLabel || gift.shapeKey || 'Keepsake',
          sprite: def?.sprite || '',
          unlocked: !!trust.giftCompleted?.(gift),
          source: 'weapon-trust',
          itemKey,
        };
      });
  }

  function normalizeKeepsake(raw, npcId, providerIndex, itemIndex) {
    if (!raw || (raw.npcId != null && raw.npcId !== npcId)) return null;
    const id = String(raw.id || `provider-${providerIndex}:${npcId}:${itemIndex}`);
    return {
      ...raw,
      id,
      npcId,
      label: String(raw.label || 'Keepsake'),
      sprite: String(raw.sprite || ''),
      unlocked: !!raw.unlocked,
    };
  }

  function getKeepsakesForNpc(npcId) {
    const all = weaponTrustKeepsakes(npcId);
    let providerIndex = 0;
    for (const provider of keepsakeProviders) {
      try {
        const provided = provider(npcId);
        const items = Array.isArray(provided) ? provided : (provided ? [provided] : []);
        items.forEach((item, itemIndex) => {
          const normalized = normalizeKeepsake(item, npcId, providerIndex, itemIndex);
          if (normalized) all.push(normalized);
        });
      } catch (err) {
        window.__farmLog?.(`[Relationships] Keepsake provider failed: ${err?.message || err}`, 'error', 'ui');
      }
      providerIndex++;
    }

    const seen = new Set();
    return all.filter(item => {
      const normalized = normalizeKeepsake(item, npcId, -1, seen.size);
      if (!normalized || seen.has(normalized.id)) return false;
      seen.add(normalized.id);
      Object.assign(item, normalized);
      return true;
    });
  }

  function packKeepsakes(keepsakes) {
    const prepared = keepsakes.map((keepsake, originalIndex) => ({
      keepsake,
      originalIndex,
      ...footprintForKeepsake(keepsake),
    }));
    // Larger/less-flexible shapes first produces the compact "fit around each
    // other" arrangement the user wants while remaining deterministic.
    prepared.sort((a, b) => (b.w * b.h) - (a.w * a.h) || Math.max(b.w, b.h) - Math.max(a.w, a.h) || a.originalIndex - b.originalIndex);

    const occupied = [];
    const placements = [];
    const cellTaken = (row, col) => !!occupied[row]?.[col];
    const canPlace = (row, col, w, h) => {
      if (col + w > KEEPSAKE_GRID_COLUMNS) return false;
      for (let r = row; r < row + h; r++) {
        for (let c = col; c < col + w; c++) if (cellTaken(r, c)) return false;
      }
      return true;
    };
    const occupy = (row, col, w, h) => {
      for (let r = row; r < row + h; r++) {
        if (!occupied[r]) occupied[r] = [];
        for (let c = col; c < col + w; c++) occupied[r][c] = true;
      }
    };

    for (const item of prepared) {
      let placed = false;
      for (let row = 0; !placed; row++) {
        for (let col = 0; col < KEEPSAKE_GRID_COLUMNS; col++) {
          if (!canPlace(row, col, item.w, item.h)) continue;
          occupy(row, col, item.w, item.h);
          placements.push({ ...item, row, col });
          placed = true;
          break;
        }
      }
    }

    const rows = Math.max(KEEPSAKE_MIN_ROWS, ...placements.map(item => item.row + item.h), 0);
    return { placements, rows };
  }

  function escAttr(value) {
    return deps?.esc ? deps.esc(String(value ?? '')) : String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }

  function keepsakesHtml(npcId) {
    const keepsakes = getKeepsakesForNpc(npcId);
    const { placements, rows } = packKeepsakes(keepsakes);
    const itemsHtml = placements.map(({ keepsake, row, col, w, h }) => {
      const unlocked = keepsake.unlocked;
      const title = unlocked ? keepsake.label : 'Locked keepsake';
      const sprite = keepsake.sprite
        ? `<img src="${escAttr(keepsake.sprite)}" alt="" loading="eager">`
        : '<span class="relationship-keepsake-fallback" aria-hidden="true"></span>';
      return `<div class="relationship-keepsake-item ${unlocked ? 'unlocked' : 'locked'}" data-keepsake-id="${escAttr(keepsake.id)}" data-keepsake-source="${escAttr(keepsake.source || '')}" style="grid-column:${col + 1} / span ${w};grid-row:${row + 1} / span ${h}" title="${escAttr(title)}" aria-label="${escAttr(title)}">${sprite}</div>`;
    }).join('');

    return `
      <div class="relationship-keepsakes">
        <div class="relationship-keepsakes-title">Keepsakes</div>
        <div class="relationship-keepsake-grid" style="grid-template-rows:repeat(${rows}, var(--ks-cell))" data-keepsake-count="${keepsakes.length}">
          ${itemsHtml}
        </div>
      </div>
    `;
  }

  function registerKeepsakeProvider(provider) {
    if (typeof provider !== 'function') return () => {};
    keepsakeProviders.add(provider);
    scheduleKeepsakeRerender();
    return () => {
      keepsakeProviders.delete(provider);
      scheduleKeepsakeRerender();
    };
  }

  function debugKeepsakes(npcId = null) {
    const ids = npcId
      ? [npcId]
      : [...new Set((window.WeaponTrustVisits?.config?.gifts || []).map(gift => gift?.npcId).filter(Boolean))];
    const report = {};
    for (const id of ids) {
      report[id] = packKeepsakes(getKeepsakesForNpc(id)).placements.map(item => ({
        id: item.keepsake.id,
        unlocked: item.keepsake.unlocked,
        sprite: item.keepsake.sprite,
        footprint: `${item.w}x${item.h}`,
        at: `${item.col},${item.row}`,
      }));
    }
    window.__farmLog?.(`[Relationships] Keepsake layout ${JSON.stringify(report)}`, 'info', 'ui');
    return report;
  }

  function renderRelationshipsPanel() {
    const list = document.getElementById('relationshipsList');
    if (!list) return;
    ensureKeepsakeStyles();
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
        row.className = 'shop-row relationship-row';
        row.dataset.npcId = npcId;
        row.innerHTML = `
          <div class="relationship-summary">
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
          </div>
          ${keepsakesHtml(npcId)}
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

  // Trust gifts can complete while the relationship panel is closed. If a
  // future UI path leaves it open, this still flips the silhouette immediately
  // from black to its normal sprite without waiting for a menu reopen.
  document.addEventListener('hobunji-weapon-trust-gift', scheduleKeepsakeRerender);

  window.RelationshipsPanel = {
    init,
    render: renderRelationshipsPanel,
    registerKeepsakeProvider,
    getKeepsakesForNpc,
    debugKeepsakes,
  };
})();
