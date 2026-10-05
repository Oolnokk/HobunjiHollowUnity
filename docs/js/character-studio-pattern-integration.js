// Character Studio pattern integration — embeds the shared Pattern Editor for authored NPC/player clothing.
// Used by docs/tools/character-studio/index.html only; runtime rendering consumes the exported clothingPatternPolicy through NpcWardrobe.
(() => {
  'use strict';
  if (window.CharacterStudioPatternIntegration) return;

  const SLOT_ORDER = Object.freeze(['hat', 'hood', 'pauldron', 'torso', 'overwear']); // Matches Character Studio's clothing order and the runtime wardrobe slot names.
  const SLOT_LABELS = Object.freeze({ hat: 'Hat', hood: 'Hood', pauldron: 'Pauldrons', torso: 'Torso', overwear: 'Overwear' }); // UI labels only.
  const TINT_KEYS = Object.freeze({ hat: ['HAT'], hood: ['HOOD', 'HOOD_B'], pauldron: ['PAULDRON'], torso: ['TORSO'], overwear: ['CLOTH', 'CLOTH_B'] }); // Maps authored dyes into temporary clothing items for preview rendering.
  const MESSAGE_READY = 'hobunji-pattern-editor-ready'; // Shared iframe handshake used by the embedded Pattern Editor.
  const MESSAGE_LOAD = 'hobunji-character-studio-pattern-load'; // Parent -> Pattern Editor payload containing the current primary/overpass pair.
  const MESSAGE_APPLY = 'hobunji-character-studio-pattern-apply'; // Pattern Editor -> parent payload returned by its Apply button.
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  let host = null; // Character Studio callbacks are installed after its main script has created the working record.
  let card = null; // Injected appearance-editor card containing per-slot authoring controls.
  let overlay = null; // Full-screen popup containing the existing standalone Pattern Editor in an iframe.
  let iframe = null; // Reused iframe so the heavy pattern tool only boots once per Character Studio session.
  let activeEdit = null; // {slot, mode, forcedOverpass} currently being edited in the shared tool.
  let queuedPayload = null; // Latest load payload, resent when the iframe announces readiness.

  function catalog() {
    return window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
  }

  function categoryForEquippedId(id) {
    const option = catalog().find(item => item?.id === id);
    if (option?.category) return String(option.category);
    const cached = window.ScratchbonesAccount?.getShopCatalog?.().find?.(item => item?.id === id);
    if (cached?.category) return String(cached.category);
    const text = String(id || '').toLowerCase();
    if (/pauldron|shoulder.?armor/.test(text)) return 'pauldron';
    if (/hood/.test(text)) return 'hood';
    if (/hat|kasa|helmet|headband/.test(text)) return 'hat';
    if (/poncho|cloak|wrap|overwear/.test(text)) return 'overwear';
    return 'torso';
  }

  function equippedBySlot(work) {
    const out = {};
    for (const id of (work?.equippedCosmetics || [])) {
      const slot = categoryForEquippedId(id);
      if (SLOT_ORDER.includes(slot)) out[slot] = id;
    }
    return out;
  }

  function baseNpcPolicy(npcId) {
    return clone(window.HobunjiNpcClothingPatterns?.npcs?.[npcId] || null); // Keeps Spearhead/Oddclaw's authored Tankan overpass visible before a local edit exists.
  }

  function initialPolicyForNpc(npc, explicitPolicy = null) {
    if (explicitPolicy && typeof explicitPolicy === 'object') return clone(explicitPolicy);
    const raw = npc?.avatarEditor?.rawExport || {};
    const nested = raw.clothingPatternPolicy || raw.profile?.clothingPatternPolicy || raw.avatarProfile?.clothingPatternPolicy || raw.npcProfile?.clothingPatternPolicy;
    if (nested && typeof nested === 'object') return clone(nested);
    if (npc?.clothingPatternPolicy && typeof npc.clothingPatternPolicy === 'object') return clone(npc.clothingPatternPolicy);
    return baseNpcPolicy(npc?.id) || { defaultClothing: {}, forcedOverpassBySlot: {} };
  }

  function normalizePolicy(policy) {
    const next = clone(policy) || {};
    next.defaultClothing = next.defaultClothing && typeof next.defaultClothing === 'object' ? next.defaultClothing : {};
    next.forcedOverpassBySlot = next.forcedOverpassBySlot && typeof next.forcedOverpassBySlot === 'object' ? next.forcedOverpassBySlot : {};
    return next;
  }

  function patternPairForSlot(policy, slot, mode) {
    const normalized = normalizePolicy(policy);
    const item = normalized.defaultClothing?.[slot] || null;
    if (mode === 'verdigris') {
      const treatment = item?.smithTreatment || null;
      const raw = Array.isArray(treatment?.patterns) ? treatment.patterns : (treatment?.pattern ? [treatment.pattern] : []);
      return { primary: clone(raw[0] || null), overpass: clone(raw[1] || null), forcedOverpass: false };
    }
    const weaving = item?.weaving || null;
    let stack = [];
    if (Array.isArray(weaving?.patterns)) stack = weaving.patterns;
    else if (weaving?.pattern) stack = [weaving.pattern];
    else {
      const entries = weaving?.layers && typeof weaving.layers === 'object' ? Object.values(weaving.layers) : [];
      const first = entries.find(entry => Array.isArray(entry?.patterns) && entry.patterns.length) || entries.find(entry => entry?.pattern);
      if (first) stack = Array.isArray(first.patterns) ? first.patterns : [first.pattern];
    }
    const forced = normalized.forcedOverpassBySlot?.[slot] || null;
    return {
      primary: clone(stack[0] || null),
      overpass: clone(forced?.pattern || stack[1] || null),
      forcedOverpass: !!forced?.pattern,
    };
  }

  function isMetalCapable(cosmeticId) {
    return !!window.MetalArmorSystem?.blueprintForId?.(cosmeticId); // Rounded pauldrons currently qualify; future registered armor automatically appears here too.
  }

  function modeForSlot(policy, slot, cosmeticId) {
    const item = policy?.defaultClothing?.[slot];
    if (isMetalCapable(cosmeticId) && item?.smithTreatment?.mode === 'pattern') return 'verdigris';
    return 'weaving';
  }

  function dyeColor(dyeId) {
    return dyeId ? { dyeId } : null;
  }

  function effectiveItemsForAvatar(avatarData, policy) {
    const normalized = normalizePolicy(policy);
    const equipped = equippedBySlot(avatarData);
    const dyes = avatarData?.appliedDyes || {};
    const items = [];
    for (const slot of SLOT_ORDER) {
      const cosmeticId = equipped[slot];
      if (!cosmeticId) continue;
      const authored = clone(normalized.defaultClothing?.[slot] || {});
      const tintKeys = TINT_KEYS[slot] || [];
      const item = {
        uid: authored.uid || `character_studio_${slot}`,
        cosmeticId,
        baseCosmeticId: authored.baseCosmeticId || cosmeticId,
        slot,
        colorA: authored.colorA ?? dyeColor(dyes[tintKeys[0]]),
        colorB: authored.colorB ?? dyeColor(dyes[tintKeys[1]]),
        ...authored,
        cosmeticId,
        slot,
      };
      const forced = normalized.forcedOverpassBySlot?.[slot];
      if (forced?.pattern) {
        item.weaving = {
          ...(clone(item.weaving) || {}),
          forcedOverpassPattern: clone(forced.pattern),
          ...(Array.isArray(forced.roles) && forced.roles.length ? { forcedOverpassRoles: clone(forced.roles) } : {}),
        };
        if (!item.colorC && forced.fallbackColorC) item.colorC = clone(forced.fallbackColorC);
      }
      if (item.smithTreatment?.mode === 'pattern' && isMetalCapable(item.baseCosmeticId)) {
        item.materialKind = 'metal';
        item.metalKey ||= 'nativeCopper';
        item.temperXp = Number.isFinite(Number(item.temperXp)) ? Number(item.temperXp) : 300;
      }
      items.push(item);
    }
    return items;
  }

  function decoratePreview(avatarData, policy) {
    let out = clone(avatarData) || {};
    const items = effectiveItemsForAvatar(out, policy);
    if (window.ClothingWeavingSystem?.decorateAvatarDataWithWovenItems) {
      out = window.ClothingWeavingSystem.decorateAvatarDataWithWovenItems(out, items);
    }
    if (window.MetalArmorSystem?.decorateAvatarDataWithMetalArmor) {
      out = window.MetalArmorSystem.decorateAvatarDataWithMetalArmor(out, items);
    }
    return out;
  }

  function ensureStyles() {
    if (document.getElementById('characterStudioPatternStyles')) return;
    const style = document.createElement('style');
    style.id = 'characterStudioPatternStyles';
    style.textContent = `
      .cs-pattern-list{display:flex;flex-direction:column;gap:7px}.cs-pattern-row{display:grid;grid-template-columns:minmax(120px,1fr) minmax(120px,170px) auto auto;gap:7px;align-items:center;padding:8px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.025)}
      .cs-pattern-name{min-width:0}.cs-pattern-name b{display:block;font-size:12px}.cs-pattern-name span{display:block;font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cs-pattern-state{font-size:10px;color:var(--muted);margin-top:3px}.cs-pattern-row select{padding:6px 7px}.cs-pattern-row button{padding:6px 8px;font-size:11px}
      .cs-pattern-overlay{position:fixed;inset:0;z-index:9700;background:rgba(3,7,12,.86);display:flex;align-items:center;justify-content:center;padding:12px}.cs-pattern-popup{width:min(1180px,100%);height:min(92vh,900px);display:flex;flex-direction:column;background:#081018;border:1px solid rgba(255,255,255,.18);border-radius:15px;box-shadow:0 24px 80px rgba(0,0,0,.7);overflow:hidden}.cs-pattern-popup-head{display:flex;align-items:center;gap:9px;padding:9px 11px;border-bottom:1px solid rgba(255,255,255,.12);background:#111b28}.cs-pattern-popup-head b{flex:1}.cs-pattern-popup iframe{border:0;flex:1;min-height:0;width:100%;background:#081018}.cs-pattern-popup-close{padding:5px 10px}
      @media(max-width:760px){.cs-pattern-row{grid-template-columns:1fr 1fr}.cs-pattern-row .cs-pattern-name{grid-column:1/-1}.cs-pattern-popup{height:96vh}.cs-pattern-overlay{padding:4px}}
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'cs-pattern-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `<div class="cs-pattern-popup"><div class="cs-pattern-popup-head"><b id="csPatternPopupTitle">Pattern Editor</b><span class="pill" id="csPatternPopupMode">—</span><button class="secondary cs-pattern-popup-close" type="button">✕ Close</button></div><iframe title="Shared Pattern Editor" src="../pattern-editor/index.html?embed=appearance"></iframe></div>`;
    document.body.appendChild(overlay);
    iframe = overlay.querySelector('iframe');
    overlay.querySelector('.cs-pattern-popup-close').onclick = closePopup;
    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) closePopup(); });
  }

  function closePopup() {
    if (overlay) overlay.hidden = true;
    activeEdit = null;
  }

  function postQueuedPayload() {
    if (!iframe?.contentWindow || !queuedPayload) return;
    iframe.contentWindow.postMessage({ type: MESSAGE_LOAD, ...clone(queuedPayload) }, location.origin);
  }

  function openPopup(slot, mode) {
    const work = host?.getWork?.();
    if (!work) return;
    ensureOverlay();
    const cosmeticId = equippedBySlot(work)[slot];
    if (!cosmeticId) return;
    const pair = patternPairForSlot(work.clothingPatternPolicy, slot, mode);
    activeEdit = { slot, mode, forcedOverpass: pair.forcedOverpass };
    queuedPayload = {
      slot,
      mode,
      name: `${host?.targetLabel?.() || 'Appearance'} — ${SLOT_LABELS[slot] || slot}`,
      primary: pair.primary,
      overpass: pair.overpass,
    };
    overlay.querySelector('#csPatternPopupTitle').textContent = `${SLOT_LABELS[slot] || slot} patterns`;
    overlay.querySelector('#csPatternPopupMode').textContent = mode === 'verdigris' ? 'Verdigris' : 'Weaving';
    overlay.hidden = false;
    postQueuedPayload(); // Also resent after the iframe's ready handshake in case it was still loading.
  }

  function setWorkPolicy(nextPolicy, message) {
    host?.setPatternPolicy?.(normalizePolicy(nextPolicy));
    host?.markPreviewDirty?.();
    render();
    if (message) host?.setStatus?.(message);
  }

  function ensureAuthoredItem(policy, slot, cosmeticId) {
    policy.defaultClothing ||= {};
    const old = clone(policy.defaultClothing[slot] || {});
    policy.defaultClothing[slot] = { ...old, cosmeticId, slot };
    return policy.defaultClothing[slot];
  }

  function applyPair(slot, mode, primary, overpass, forcedOverpass = false) {
    const work = host?.getWork?.();
    if (!work) return;
    const cosmeticId = equippedBySlot(work)[slot];
    if (!cosmeticId) return;
    const policy = normalizePolicy(work.clothingPatternPolicy);
    const item = ensureAuthoredItem(policy, slot, cosmeticId);
    if (mode === 'verdigris') {
      const patterns = [primary, overpass].filter(Boolean).slice(0, 2).map(clone);
      if (patterns.length) {
        item.baseCosmeticId = item.baseCosmeticId || cosmeticId;
        item.materialKind = 'metal';
        item.metalKey ||= 'nativeCopper';
        item.temperXp = Number.isFinite(Number(item.temperXp)) ? Number(item.temperXp) : 300;
        item.smithTreatment = { ...(clone(item.smithTreatment) || {}), mode: 'pattern', pattern: clone(patterns[0]), patterns };
      } else {
        delete item.smithTreatment;
      }
    } else {
      const patterns = [primary, overpass].filter(Boolean).slice(0, 2).map(clone);
      const previousForced = policy.forcedOverpassBySlot?.[slot];
      if (primary || (!overpass && item.weaving)) {
        if (patterns.length) item.weaving = { ...(clone(item.weaving) || {}), pattern: clone(primary || patterns[0]), patterns };
        else delete item.weaving;
      }
      if (forcedOverpass || previousForced?.pattern || (!primary && overpass)) {
        policy.forcedOverpassBySlot ||= {};
        if (overpass) {
          policy.forcedOverpassBySlot[slot] = {
            ...(clone(previousForced) || {}),
            label: previousForced?.label || 'Authored overpass',
            pattern: clone(overpass),
          };
        } else {
          delete policy.forcedOverpassBySlot[slot];
        }
        // Forced overpass is render policy rather than the garment's literal slot 2.
        if (item.weaving?.patterns) item.weaving.patterns = primary ? [clone(primary)] : [];
        if (item.weaving && !primary) delete item.weaving.pattern;
      } else if (policy.forcedOverpassBySlot?.[slot]) {
        delete policy.forcedOverpassBySlot[slot];
      }
    }
    setWorkPolicy(policy, `${SLOT_LABELS[slot] || slot} ${mode} pattern updated`);
  }

  function clearMode(slot, mode) {
    const work = host?.getWork?.();
    if (!work) return;
    const policy = normalizePolicy(work.clothingPatternPolicy);
    const item = policy.defaultClothing?.[slot];
    if (mode === 'verdigris') {
      if (item) delete item.smithTreatment;
    } else {
      if (item) delete item.weaving;
      if (policy.forcedOverpassBySlot) delete policy.forcedOverpassBySlot[slot];
    }
    setWorkPolicy(policy, `${SLOT_LABELS[slot] || slot} ${mode} patterns cleared`);
  }

  function stateLabel(pair) {
    if (pair.primary && pair.overpass) return pair.forcedOverpass ? 'Primary + forced overpass' : 'Primary + overpass';
    if (pair.overpass) return pair.forcedOverpass ? 'Forced overpass only' : 'Overpass only';
    if (pair.primary) return 'Primary only';
    return 'No pattern';
  }

  function render() {
    if (!card || !host) return;
    const work = host.getWork?.();
    const list = card.querySelector('.cs-pattern-list');
    if (!work || !list) return;
    const equipped = equippedBySlot(work);
    const rows = SLOT_ORDER.filter(slot => equipped[slot]).map(slot => {
      const cosmeticId = equipped[slot];
      const mode = modeForSlot(work.clothingPatternPolicy, slot, cosmeticId);
      const pair = patternPairForSlot(work.clothingPatternPolicy, slot, mode);
      const metal = isMetalCapable(cosmeticId);
      return `<div class="cs-pattern-row" data-slot="${slot}">
        <div class="cs-pattern-name"><b>${SLOT_LABELS[slot] || slot}</b><span>${cosmeticId}</span><div class="cs-pattern-state">${stateLabel(pair)}</div></div>
        <select class="cs-pattern-mode" aria-label="Pattern mode"><option value="weaving"${mode === 'weaving' ? ' selected' : ''}>Weaving</option>${metal ? `<option value="verdigris"${mode === 'verdigris' ? ' selected' : ''}>Verdigris</option>` : ''}</select>
        <button type="button" class="cs-pattern-edit">Edit…</button>
        <button type="button" class="secondary cs-pattern-clear"${(pair.primary || pair.overpass) ? '' : ' disabled'}>Clear</button>
      </div>`;
    }).join('');
    list.innerHTML = rows || '<div class="help">Equip clothing above to author weaving or verdigris patterns for it.</div>';
    for (const row of list.querySelectorAll('.cs-pattern-row')) {
      const slot = row.dataset.slot;
      const modeSelect = row.querySelector('.cs-pattern-mode');
      const clearButton = row.querySelector('.cs-pattern-clear');
      modeSelect.onchange = () => { // Mode selection is local UI state until Edit/Apply; do not snap back to the currently authored treatment.
        const pair = patternPairForSlot(work.clothingPatternPolicy, slot, modeSelect.value);
        row.querySelector('.cs-pattern-state').textContent = stateLabel(pair);
        clearButton.disabled = !(pair.primary || pair.overpass);
      };
      row.querySelector('.cs-pattern-edit').onclick = () => openPopup(slot, modeSelect.value);
      clearButton.onclick = () => clearMode(slot, modeSelect.value);
    }
  }

  function mount(nextHost) {
    host = nextHost || host;
    ensureStyles();
    ensureOverlay();
    const collections = document.getElementById('collectionsControls');
    const clothingCard = collections?.closest('.card');
    if (!clothingCard) return false;
    card = document.getElementById('characterStudioPatternCard');
    if (!card) {
      card = document.createElement('div');
      card.id = 'characterStudioPatternCard';
      card.className = 'card section';
      card.style.setProperty('--sec', '#9b7cff');
      card.style.setProperty('--secBg', 'rgba(155,124,255,.10)');
      card.innerHTML = `<div class="sectionTitle"><b>Clothing patterns</b><span class="sectionTag">shared pattern tool</span></div><div class="help" style="margin-bottom:8px">Author weaving or verdigris with the same Pattern Editor used elsewhere. Primary and overpass are edited together; existing NPC overpasses are loaded here too.</div><div class="cs-pattern-list"></div>`;
      clothingCard.insertAdjacentElement('afterend', card);
    }
    render();
    return true;
  }

  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== iframe?.contentWindow) return;
    const data = event.data || {};
    if (data.type === MESSAGE_READY) {
      postQueuedPayload();
      return;
    }
    if (data.type !== MESSAGE_APPLY || !activeEdit) return;
    applyPair(activeEdit.slot, activeEdit.mode, clone(data.primary || null), clone(data.overpass || null), activeEdit.forcedOverpass);
    closePopup();
  });

  window.CharacterStudioPatternIntegration = Object.freeze({
    mount,
    render,
    decoratePreview,
    effectiveItemsForAvatar,
    initialPolicyForNpc,
    normalizePolicy,
    patternPairForSlot,
    messages: Object.freeze({ ready: MESSAGE_READY, load: MESSAGE_LOAD, apply: MESSAGE_APPLY }),
  });
})();
