// Imperial magic checkpoint: Spearhead's amulet, gate cutscenes, and Garanki's custody ledger.
// Player possessions stay in the canonical pack; custody and per-item registration are world-scoped story data.
(() => {
  'use strict';

  const STORY_KEY = 'townMagicCheckpoint'; // One nested Delver's Guild save field owns custody, registration and gate-dialogue history.
  const CHECKPOINT_MAP = 'map_hobunji_town'; // Uses the existing town cutscene stage, not a separate map.
  const WATCHMEN = Object.freeze(['spearhead_unumanuk', 'oddclaw_unumanuk']); // The two real NPC records appear together at the gate.
  let deps = null; // ArtifactCollection injects live inventory, pack clothing and canonical save/UI callbacks.
  let running = false; // Prevents overlapping gate scenes on repeated transitions.
  let lastError = null; // Surfaced through the mobile Dev Companion diagnostics.
  let lastChange = 'Added imperial magic detection, gate choices, and persistent Garanki custody.'; // Human-readable debugging history.
  let attempts = 0; // Bounds retry attempts if town is entered during another cinematic.
  let entryToken = 0; // Invalidates a queued gate check if a newer town entry supersedes it.
  let generatedUid = 0; // Used only to identify rare legacy cursed garments missing a persistent uid.

  function profile() { return window.__hobunjiPlayerProfile || null; }
  function guild() { return window.DelversGuild; }
  function opening() { return window.OpeningStoryCutscene; }
  function memberId() { return String(profile()?.characterId || 'owner'); } // Matches the world-member inventory owner, including farmhands.
  function read() {
    const collection = opening()?.getStory?.(profile())?.delversGuild?.[STORY_KEY] || {};
    const source = collection.members?.[memberId()] || {}; // One character's confiscated belongings cannot leak into another farmhand's pack.
    return {
      explained: source.explained === true,
      licenseExplained: source.licenseExplained === true,
      entries: Array.isArray(source.entries) ? source.entries.filter(entry => entry && typeof entry.id === 'string') : [],
      registered: Array.isArray(source.registered) ? [...new Set(source.registered.filter(id => typeof id === 'string'))] : [],
      registeredCounts: Object.fromEntries(Object.entries(source.registeredCounts || {})
        .filter(([id, count]) => id.startsWith('inventory:') && Number.isSafeInteger(count) && count > 0)), // Stackables lack per-instance IDs, so a lawful quantity is tracked separately from unique relics.
    };
  }
  function write(patch) {
    const p = profile();
    const history = opening()?.getStory?.(p);
    if (!p?.worldId || !history || !opening()?.updateStory) return false;
    const delversGuild = history.delversGuild || {}; // Preserve simultaneous Guild membership, trust and vault-quest state.
    const checkpoint = delversGuild[STORY_KEY] || {}; // The world record can hold several separate character custody ledgers.
    const members = checkpoint.members || {};
    return opening().updateStory(p, { delversGuild: {
      ...delversGuild, [STORY_KEY]: { ...checkpoint, members: { ...members, [memberId()]: { ...read(), ...patch } } },
    } });
  }
  function copy(value) { return JSON.parse(JSON.stringify(value)); } // Preserves every serializable cursed garment property, including colors/patterns.
  function savePack() {
    const saved = deps?.saveMemberWorldData?.(); // A known false result means persistent member storage rejected this character inventory.
    deps?.buildInventoryGrid?.();
    deps?.buildPackClothingSection?.();
    return saved !== false; // Older injected adapters return undefined on success; only explicit failure blocks escrow finalization.
  }
  function pack() { return deps?.getPackClothing?.() || []; }
  function identity(item, index) {
    if (!item.uid) item.uid = 'checkpoint-legacy-' + Date.now().toString(36) + '-' + (++generatedUid) + '-' + index; // Normalizes old cursed garment records before custody.
    return 'clothing:' + String(item.uid);
  }
  function magicKey(key) {
    const def = deps?.ITEM_DEFS?.[key];
    return window.HarlyaoRelics?.isBoundKey?.(key) === true ||
      def?.harlyaoBoundRelic === true || def?.magicalStatus === 'bound' || def?.magicalStatus === 'cursed' ||
      def?.bound === true || def?.cursed === true ||
      (Array.isArray(def?.tags) && def.tags.some(tag => /^(bound|cursed)$/i.test(tag))); // Accept future magical items with explicit catalog metadata.
  }
  function uniqueKey(key) {
    const def = deps?.ITEM_DEFS?.[key]; // Future systems can opt in when their key encodes a stable item-instance identity.
    return window.HarlyaoRelics?.isBoundKey?.(key) === true || def?.uniqueInventoryKey === true;
  }
  function pending() {
    if (!deps?.inventory || !Array.isArray(pack())) return [];
    const ledger = read();
    const registered = new Set(ledger.registered); // Unique relics can be cleared forever only by their exact instance key.
    const held = new Set(ledger.entries.map(entry => entry.id)); // A previously confiscated unique key cannot simultaneously exist in the pack.
    const excluded = new Set([...registered, ...held]); // Used by clothing with stable UIDs below.
    const items = [];
    for (const [key, amount] of Object.entries(deps.inventory)) {
      const total = Math.max(0, Math.floor(Number(amount) || 0));
      const id = 'inventory:' + key;
      const unique = uniqueKey(key); // Generic count inventory does not encode an individual item identity.
      const licensedCount = unique ? (registered.has(id) || held.has(id) ? total : 0)
        : Math.max(0, Math.floor(Number(ledger.registeredCounts[id]) || 0));
      const count = Math.max(0, total - licensedCount);
      if (count && magicKey(key)) items.push({ id, kind: 'inventory', key, count, label: deps.ITEM_DEFS?.[key]?.label || key });
    }
    pack().forEach((item, index) => {
      if (!item || !(item.cursed || item.bound)) return;
      // Existing cursed garments already have uids; old imports receive one on their first checkpoint inspection.
      const id = identity(item, index);
      if (!excluded.has(id)) items.push({ id, kind: 'clothing', item, label: String(item.label || item.cosmeticId || 'Cursed clothing') });
    });
    return items;
  }
  function reconcileCustody() {
    if (!deps?.inventory || !Array.isArray(pack())) return false;
    const held = read().entries;
    if (!held.length) return false;
    let repaired = false; // Repairs interrupted unique transfers or the explicitly recorded remainder of a stack transfer.
    let ledgerChanged = false; // Clears one-shot transfer markers after member-inventory recovery.
    const normalized = held.map(entry => {
      if (entry.kind === 'inventory' && uniqueKey(entry.key) && (Number(deps.inventory[entry.key]) || 0) > 0) {
        delete deps.inventory[entry.key]; repaired = true;
      }
      if (entry.kind === 'inventory' && !uniqueKey(entry.key) && entry.pendingRemoval) {
        const current = Math.max(0, Math.floor(Number(deps.inventory[entry.key]) || 0));
        const remaining = Math.max(0, Math.floor(Number(entry.pendingRemoval.remaining) || 0));
        const unsettled = Math.max(0, Math.floor(Number(entry.pendingRemoval.count) || 0));
        const excess = Math.min(unsettled, Math.max(0, current - remaining)); // Never erase an entire new stack just because the key is already in custody.
        if (excess) {
          const kept = current - excess;
          if (kept) deps.inventory[entry.key] = kept;
          else delete deps.inventory[entry.key];
          repaired = true;
        }
      }
      if (entry.kind === 'inventory' && !uniqueKey(entry.key) && entry.pendingRelease) {
        const current = Math.max(0, Math.floor(Number(deps.inventory[entry.key]) || 0));
        const previous = Math.max(0, Math.floor(Number(entry.pendingRelease.previous) || 0));
        const released = Math.max(0, Math.floor(Number(entry.pendingRelease.count) || 0));
        const excess = Math.min(released, Math.max(0, current - previous)); // Interrupted release restores escrow rather than duplicating registered stackables.
        if (excess) {
          const kept = current - excess;
          if (kept) deps.inventory[entry.key] = kept;
          else delete deps.inventory[entry.key];
          repaired = true;
        }
      }
      if (entry.kind === 'clothing') {
        const index = pack().findIndex(item => item?.uid && 'clothing:' + item.uid === entry.id);
        if (index >= 0) { pack().splice(index, 1); repaired = true; }
      }
      if (entry.pendingRemoval || entry.pendingRelease) {
        ledgerChanged = true;
        const { pendingRemoval, pendingRelease, ...complete } = entry; // One-shot transaction markers never replay after recovery.
        return complete;
      }
      return entry;
    });
    const memberSaved = !repaired || savePack(); // Do not erase transfer markers if saving the repaired player inventory failed.
    if (ledgerChanged && memberSaved && !write({ entries: normalized })) lastError = 'Could not finalize an interrupted custody transfer; retry on reload.';
    else if (ledgerChanged && !memberSaved) lastError = 'Repaired inventory could not be saved; keeping custody recovery markers for reload.';
    if (repaired) lastChange = 'Recovered an interrupted custody transfer without silently destroying a new stack.';
    return repaired;
  }
  function confiscate() {
    if (!deps?.inventory) return { ok: false, reason: 'not-ready' };
    reconcileCustody();
    const selected = pending();
    if (!selected.length) return { ok: true, count: 0 };
    const before = read();
    const joined = before.entries.map(entry => ({ ...entry })); // Existing stack types remain one custody row across repeat confiscations.
    for (const selection of selected) {
      const entry = selection.kind === 'inventory'
        ? { ...selection }
        : { id: selection.id, kind: 'clothing', label: selection.label, item: copy(selection.item) }; // Never retain a live pack object reference in the story record.
      if (selection.kind === 'inventory' && !uniqueKey(selection.key)) {
        const current = Math.max(0, Math.floor(Number(deps.inventory[selection.key]) || 0));
        entry.pendingRemoval = { count: selection.count, remaining: Math.max(0, current - selection.count) }; // Crash recovery can distinguish the confiscated excess from an already registered portion.
        const old = joined.findIndex(held => held.id === entry.id);
        if (old >= 0) {
          const existing = joined[old]; // Repeated contraband stacks add quantity rather than creating duplicate IDs.
          joined[old] = { ...existing, count: existing.count + entry.count, pendingRemoval: entry.pendingRemoval };
          continue;
        }
      }
      joined.push(entry);
    }
    if (!write({ entries: joined, explained: true, licenseExplained: before.licenseExplained || !!guild()?.isMember?.() })) {
      lastError = 'World custody ledger could not be saved; possessions remain with the player.';
      return { ok: false, reason: 'save' };
    }
    for (const entry of selected) {
      if (entry.kind === 'inventory') {
        const remaining = Math.max(0, (Math.floor(Number(deps.inventory[entry.key]) || 0) - entry.count));
        if (remaining) deps.inventory[entry.key] = remaining;
        else delete deps.inventory[entry.key]; // Unique keys go to zero; registered stack quantities stay in the pack.
      } else {
        const index = pack().indexOf(entry.item);
        if (index >= 0) pack().splice(index, 1);
      }
    }
    if (!savePack()) {
      lastError = 'Custody is recorded but the character inventory could not be saved. Recovery will retry at load.';
      deps.showToast?.('The inventory save failed. The custody transfer will be repaired when the world reloads.', false);
      return { ok: false, reason: 'member-save' };
    }
    if (joined.some(entry => entry.pendingRemoval)) {
      const completed = joined.map(({ pendingRemoval, ...entry }) => entry); // Finalize stack transactions after the character inventory has been persisted.
      if (!write({ entries: completed })) lastError = 'Custody saved, but stack transfer finalization will retry on the next load.';
    }
    lastChange = 'Spearhead forwarded ' + selected.length + ' magical item types to Garanki Gabu.';
    deps.showToast?.(selected.length + ' unregistered magical item' + (selected.length === 1 ? '' : 's') + ' placed in Garanki Gabu\'s custody.', true);
    return { ok: true, count: selected.length };
  }
  function disposition(entry) {
    // A mask containing a captive soul is not harmless contraband. Do not bypass the existing priest-only cure.
    if (entry.kind === 'clothing' && entry.item?.cursed?.kind === 'mask') return 'Held: a soul-bound mask requires a priest before release.';
    return null;
  }
  function registerAndReturn(id) {
    if (!guild()?.isMember?.()) return { ok: false, reason: 'license' };
    reconcileCustody(); // Recover a previous interrupted transfer before beginning another independent release.
    const before = read();
    const entry = before.entries.find(item => item.id === id);
    if (!entry) return { ok: false, reason: 'missing' };
    if (disposition(entry)) return { ok: false, reason: 'dangerous' };
    if (!deps?.inventory || !Array.isArray(pack())) return { ok: false, reason: 'not-ready' };
    if (entry.kind !== 'inventory' && entry.kind !== 'clothing') return { ok: false, reason: 'unknown-kind' };
    if (entry.kind === 'clothing' && pack().some(item => 'clothing:' + item?.uid === entry.id)) return { ok: false, reason: 'duplicate' };
    const previousCount = entry.kind === 'inventory' ? Math.max(0, Math.floor(Number(deps.inventory[entry.key]) || 0)) : 0; // Recovery baseline before a lawful release.
    const pendingEntries = before.entries.map(item => item.id === id
      ? { ...item, pendingRelease: { previous: previousCount, count: entry.count || 1 } }
      : item); // Save the pending return before moving any physical item out of Garanki's custody.
    if (!write({ entries: pendingEntries })) {
      lastError = 'Could not save the pending release; the belongings remain in custody.';
      return { ok: false, reason: 'save' };
    }
    if (entry.kind === 'inventory') {
      deps.inventory[entry.key] = previousCount + entry.count;
      window.HarlyaoRelics?.ensureBoundItemDef?.(entry.key); // Recreates the relic's pack label and enchantment data after an import.
    } else {
      pack().push(copy(entry.item));
    }
    const unique = entry.kind === 'inventory' ? uniqueKey(entry.key) : true; // Clothing already has a stable UID.
    const next = {
      entries: before.entries.filter(item => item.id !== id),
      registered: unique ? [...new Set([...before.registered, id])] : before.registered,
      registeredCounts: !unique ? {
        ...before.registeredCounts,
        [id]: Math.max(0, Number(before.registeredCounts[id]) || 0) + entry.count,
      } : before.registeredCounts,
    }; // Stackables are registered by permitted quantity, not by a blanket exemption for every new item of that type.
    // Save the item and its registration in that order; reconcileCustody repairs a crash before the second write.
    const memberSaved = savePack();
    if (!memberSaved || !write(next)) {
      if (entry.kind === 'inventory') {
        deps.inventory[entry.key] -= entry.count;
        if (deps.inventory[entry.key] <= 0) delete deps.inventory[entry.key];
      } else {
        const index = pack().findIndex(item => 'clothing:' + item?.uid === entry.id);
        if (index >= 0) pack().splice(index, 1);
      }
      savePack();
      write({ entries: before.entries }); // Best-effort clearing: on an interrupted write the next load reconciles the escrow marker.
      lastError = memberSaved ? 'Registration failed to save; the item remains in custody.' : 'Returned inventory failed to save; the item remains in custody.';
      return { ok: false, reason: memberSaved ? 'save' : 'member-save' };
    }
    lastChange = entry.label + ' registered and returned to its licensed owner.';
    deps.showToast?.('Registered and reclaimed ' + entry.label + '.', true);
    window.HarlyaoRelics?.render?.();
    return { ok: true, entry };
  }
  function renderCustody(list, ui) {
    const ledger = read();
    list.appendChild(ui.heading('Garanki Gabu — Confiscated belongings (' + ledger.entries.length + ')'));
    list.appendChild(ui.note('Spearhead forwards unregistered witchcraft here. Your Guild license permits individual registration, not automatic release. Registered items will not trigger his amulet again.'));
    if (!ledger.entries.length) { list.appendChild(ui.note('No confiscated belongings are currently held.')); return; }
    for (const entry of ledger.entries) {
      const withheld = disposition(entry);
      const licensed = guild()?.isMember?.() === true;
      const label = entry.label + (entry.count > 1 ? ' ×' + entry.count : '');
      const button = ui.button(withheld ? 'Requires priest' : licensed ? 'Register & reclaim' : 'Guild license required', () => registerAndReturn(entry.id), !!withheld || !licensed);
      list.appendChild(ui.row(entry.kind === 'inventory' ? '🗡️' : '👑', ui.esc ? ui.esc(label) : escapeHtml(label),
        ui.esc ? ui.esc(withheld || 'Awaiting legal registration') : escapeHtml(withheld || 'Awaiting legal registration'), [button]));
    }
    const details = document.createElement('details'); // Provides mobile copyable state without depending on devtools.
    const summary = document.createElement('summary');
    summary.textContent = 'Custody diagnostics';
    const report = document.createElement('pre');
    report.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px';
    report.textContent = JSON.stringify(debugSnapshot(), null, 2);
    details.append(summary, report);
    list.appendChild(details);
  }
  function escapeHtml(str) { return String(str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

  function speak(id, text, next = '__next__') {
    return { id, type: 'talk', speakerId: 'spearhead', addressedActorId: 'player', text, next,
      cameraMode: 'orbit', orbitActorIds: ['player', 'spearhead'], orbitAlternateFocus: true,
      orbitInitialZoomPercent: 115, orbitDistanceTiles: 2, orbitInstantCut: true };
  }
  function scene(records, col, row) {
    const ledger = read();
    const licensed = guild()?.isMember?.() === true;
    const name = String(profile()?.nickname || 'Farmer');
    const townGrid = deps?.getTownGrid?.(); // Existing town collision data determines valid gate staging tiles.
    const cols = townGrid?.[0]?.length || 60, rows = townGrid?.length || 50; // Live tile bounds for all four exterior town entrances.
    const arrivalC = Math.max(0, Math.min(cols - 1, Math.floor(Number(col) || 0)));
    const arrivalR = Math.max(0, Math.min(rows - 1, Math.floor(Number(row) || 0)));
    const entrances = [
      { edge: 'south', distance: rows - 1 - arrivalR, dc: 0, dr: -1, facing: 180 },
      { edge: 'north', distance: arrivalR, dc: 0, dr: 1, facing: 0 },
      { edge: 'west', distance: arrivalC, dc: 1, dr: 0, facing: 90 },
      { edge: 'east', distance: cols - 1 - arrivalC, dc: -1, dr: 0, facing: 270 },
    ]; // Inward heading also defines the direction opposite the player's back, independent of which gate is used.
    const approach = entrances.reduce((nearest, entry) => entry.distance < nearest.distance ? entry : nearest);
    const canStand = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows &&
      (!townGrid || (townGrid[y]?.[x] && !deps?.isSolidTile?.(townGrid[y][x]))); // Does not stage anyone in a wall or out of bounds.
    const stagedPlayer = [2, 3, 1, 0].map(distance => ({
      c: arrivalC + approach.dc * distance, r: arrivalR + approach.dr * distance,
    })).find(point => canStand(point.c, point.r)) || { c: arrivalC, r: arrivalR }; // Two tiles inward gives Spearhead room to inspect behind the player.
    const c = stagedPlayer.c, r = stagedPlayer.r;
    const occupied = new Set([c + ':' + r]); // Prevents every temporary cutscene stand-in from sharing a tile.
    const pickTile = offsets => {
      for (const [dc, dr] of offsets) {
        const x = c + dc, y = r + dr;
        if (occupied.has(x + ':' + y) || !canStand(x, y)) continue;
        occupied.add(x + ':' + y);
        return { c: x, r: y };
      }
      return { c, r }; // Only a completely blocked entrance uses the safe stationary stand-in fallback.
    };
    const tangentC = -approach.dr, tangentR = approach.dc; // Used to place watchmen on opposite sides of the inward path.
    const behindC = -approach.dc, behindR = -approach.dr; // Exact opposite of the player's incoming facing direction.
    const inspectTile = pickTile([
      [behindC, behindR], [behindC + tangentC, behindR + tangentR], [behindC - tangentC, behindR - tangentR],
      [tangentC, tangentR], [-tangentC, -tangentR],
    ]); // Reserve an actual behind-the-player destination before choosing either guard's starting tile.
    const spearheadTile = pickTile([
      [approach.dc + tangentC, approach.dr + tangentR],
      [approach.dc, approach.dr], [tangentC, tangentR], [approach.dc - tangentC, approach.dr - tangentR],
    ]);
    const oddclawTile = pickTile([
      [approach.dc - tangentC, approach.dr - tangentR],
      [approach.dc, approach.dr], [-tangentC, -tangentR], [approach.dc + tangentC, approach.dr + tangentR],
    ]);
    const facePlayer = point => window.CutscenePreviewHelpers?.cutscenePreviewAngleToward?.(point, stagedPlayer) ?? ((approach.facing + 180) % 360); // Both guards face the visitor; fallback reverses the player's inward heading.
    const stages = [{ id: 'magic_fade_in', type: 'fade', direction: 'in', duration: 0.35, next: '__next__' }];
    if (!ledger.explained) {
      stages.push({ id: 'magic_watchmen_braced', type: 'caption', speakerName: '', text: 'Spearhead and Oddclaw stand armed at the town gate, braced for a fight.', next: '__next__' });
      stages.push(speak('magic_greeting', 'Oh, it\'s you, ' + name + '. When my thing went off I was terrified.'));
      stages.push({ id: 'magic_what_thing', type: 'choice', speakerId: 'player', addressedActorId: 'spearhead', text: 'What do you say?',
        options: [{ text: 'What thing?', next: 'magic_explanation' }] });
      stages.push(speak('magic_explanation', 'I forget what it\'s called, but it\'s an amulet the Empire commissioned me with when I took over as guard captain. It detects magical imprints resulting from witchcraft. I don\'t mean to startle you, but there\'s HEAVY traces of magic coming off of you. Are you carrying something in your pack that might be enchanted?'));
    } else if (licensed && ledger.licenseExplained) {
      stages.push(speak('magic_repeat_license', 'More unregistered magical items, ' + name + '? I still have to confiscate them under imperial law. I\'ll have them brought straight to Professor Gabu, as usual.', 'magic_fade_out'));
    } else {
      stages.push(speak('magic_repeat_greeting', 'Ah, ' + name + '. You know the drill — my amulet has picked up unregistered witchcraft in your pack again. Are you carrying something enchanted?'));
    }
    if (!ledger.explained || !licensed || !ledger.licenseExplained) {
      if (licensed) {
        stages.push({ id: 'magic_license_choice', type: 'choice', speakerId: 'player', text: 'How do you answer?', options: [{ text: 'I have a license.', next: 'magic_license' }] });
        stages.push(speak('magic_license', 'Delver\'s Guild, you say? Well, I still can\'t legally let you walk around with that stuff unless it\'s officially registered... You know what? I\'ll have these brought to Professor Gabu for you. He\'ll look after them until you meet up with him next.', 'magic_fade_out'));
      } else {
        stages.push({ id: 'magic_item_choice', type: 'choice', speakerId: 'player', text: 'How do you answer?',
          options: [{ text: 'Yes.', next: 'magic_yes' }, { text: 'I don\'t know.', next: 'magic_dont_know' }] });
        stages.push(speak('magic_yes', ledger.explained ? 'Right, then. I\'ll have to take it into custody again.' : 'Ah, that explains it then.', ledger.explained ? 'magic_repeat_final' : 'magic_confiscation_law'));
        stages.push(speak('magic_dont_know', 'Oh, alright. I\'ll have to check your bag then. I don\'t mean to be intrusive, but it\'s the law.', 'magic_inspect_step'));
        stages.push({ id: 'magic_inspect_step', type: 'move', actorId: 'spearhead', targetWorld: inspectTile, speed: 'normal', next: 'magic_inspect_turn' });
        stages.push({ id: 'magic_inspect_turn', type: 'turn', actorId: 'spearhead', mode: 'actor', targetActorId: 'player', duration: 0.3, next: 'magic_inspect_found' });
        stages.push(speak('magic_inspect_found', ledger.explained ? 'Yep. More enchanted things. You know what happens next.' : 'Oh, yep. You\'ve got some enchanted stuff in here.', ledger.explained ? 'magic_repeat_final' : 'magic_confiscation_law'));
        if (!ledger.explained) {
          stages.push(speak('magic_confiscation_law', 'Law says I\'m supposed to confiscate this and send it to the higher-ups. Lots of paperwork, and both of us might get caught up in some nonsense investigation...'));
          stages.push(speak('magic_explain_garanki', 'But when that sort of thing happens, they just end up sending this stuff to the Delver\'s Guild headquarters in Kumapirra. You know there\'s this scholar, Garanki Gabu, who\'s staying right outside of town. My papers list him as a high-ranking member of the Delver\'s Guild. I\'m going to skip both the paperwork and the postage and bring these to him.'));
          stages.push(speak('magic_first_final', 'Then, if you ask him and you\'re lucky, he might let you join the Delver\'s Guild yourself. If none of this stuff is deemed too dangerous, they\'ll let you keep it, legally.', 'magic_fade_out'));
        } else {
          stages.push(speak('magic_repeat_final', 'I\'ll have these delivered to Garanki Gabu again. You can sort the registration out with him.', 'magic_fade_out'));
        }
      }
    }
    stages.push({ id: 'magic_fade_out', type: 'fade', direction: 'out', duration: 0.4, next: '__end__' });
    return {
      version: 6, title: 'Town Gate — Imperial Witchcraft Check',
      mapId: CHECKPOINT_MAP,
      actors: [
        { id: 'player', name, isPlayer: true, worldC: c, worldR: r, rotation: approach.facing, pose: 'standing' },
        { id: 'spearhead', name: 'Spearhead', npcId: WATCHMEN[0], npcRecord: records[0], worldC: spearheadTile.c, worldR: spearheadTile.r, rotation: facePlayer(spearheadTile), pose: 'standing', lookAtActorId: 'player' },
        { id: 'oddclaw', name: 'Oddclaw', npcId: WATCHMEN[1], npcRecord: records[1], worldC: oddclawTile.c, worldR: oddclawTile.r, rotation: facePlayer(oddclawTile), pose: 'standing', lookAtActorId: 'player' },
      ],
      stages,
    };
  }
  async function records() {
    const db = window.LocalDBOverrides ? await window.LocalDBOverrides.loadDatabase('npcDatabase')
      : await fetch('config/npcs/hobunji-starter-npc-database.json').then(res => { if (!res.ok) throw new Error('NPC database HTTP ' + res.status); return res.json(); });
    return WATCHMEN.map(id => {
      const record = db?.npcs?.find(npc => npc.id === id);
      if (!record) throw new Error('Missing imperial watchman NPC record: ' + id);
      return record;
    });
  }
  async function play(col, row, token = entryToken) {
    if (running || token !== entryToken || !deps?.inventory || !pending().length || !window.__hobunjiGameStarted) return false;
    if (!window.AuthoredCutsceneRuntime?.run) { lastError = 'The authored-cutscene runtime is unavailable.'; return false; }
    running = true;
    lastError = null;
    const owner = String(profile()?.worldId || '') + ':' + memberId(); // Protects a slow NPC fetch against a same-tab character/world switch.
    try {
      const cast = await records();
      if (token !== entryToken || owner !== String(profile()?.worldId || '') + ':' + memberId() ||
          deps.getCurrentArea?.() !== 'town' || !pending().length) return false;
      const payload = scene(cast, col, row);
      let finished = false; // Confiscation occurs only after a player continues the final conversation beat, never on skip.
      await window.AuthoredCutsceneRuntime.run(payload, {
        placePlayerAtFinalPosition: true, // Return the real avatar to the safe in-town gate tile established by the cinematic.
        onDialogueContinue(stage) {
          if (['magic_first_final', 'magic_repeat_final', 'magic_license', 'magic_repeat_license'].includes(stage?.id)) finished = true;
        },
      });
      if (!finished) return false;
      return confiscate().ok;
    } catch (error) {
      lastError = error?.message || String(error);
      window.__farmLog?.('[town-magic-checkpoint] ' + lastError, 'warn');
      return false;
    } finally { running = false; }
  }
  function onTownEntered({ fromArea, col, row } = {}) {
    if (!deps?.isExteriorArrival?.(fromArea) || !window.__hobunjiGameStarted) return false; // Exiting a town building is not crossing an imperial perimeter gate.
    const token = ++entryToken; // A later crossing cancels a stale timer, even if no contraband remains.
    if (!pending().length) return false;
    attempts = 0;
    const tryScene = () => {
      if (token !== entryToken || deps.getCurrentArea?.() !== 'town' || !pending().length) return;
      if (window.AuthoredCutsceneRuntime?.isActive?.()) {
        if (++attempts < 12) window.setTimeout(tryScene, 650); // Wait for an existing entrance cinematic to finish; never interrupt it.
        else lastError = 'The checkpoint is waiting for a clear cutscene slot; re-enter town to retry.';
        return;
      }
      void play(col, row, token);
    };
    window.setTimeout(tryScene, 750); // Let the town transition finish fading and establish the normal camera before the gate conversation.
    return true;
  }
  function hasCustody() { return read().entries.length > 0; } // Allows Garanki's private Guild conversation after a lawful confiscation.
  function bindInventoryDeps(injected) { deps = injected; } // Only called by ArtifactCollection.init after the game has canonical inventory data.
  function debugSnapshot() {
    const ledger = read();
    return {
      latestChange: lastChange, running, attempts, lastError, member: guild()?.isMember?.() === true,
      explained: ledger.explained, licenseExplained: ledger.licenseExplained,
      custody: ledger.entries.map(entry => ({ id: entry.id, label: entry.label, kind: entry.kind, count: entry.count || 1, blocked: !!disposition(entry) })),
      registeredCount: ledger.registered.length, pending: deps ? pending().map(entry => ({ id: entry.id, label: entry.label })) : [],
    };
  }
  window.TownMagicCheckpoint = Object.freeze({ bindInventoryDeps, hasCustody, pending, confiscate, registerAndReturn, renderCustody, scene, play, onTownEntered, reconcileCustody, debugSnapshot });
  document.addEventListener('hobunjiPlayerReady', () => { reconcileCustody(); });
  window.DevCompanion?.registerStateProvider?.('townMagicCheckpoint', debugSnapshot);
})();
