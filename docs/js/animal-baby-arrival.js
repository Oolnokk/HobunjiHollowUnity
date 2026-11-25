(() => {
  'use strict';
  if (window.AnimalBabyArrival) return;

  // One focus-owning queue handles arrivals and incubation celebrations without
  // replacing the Nursery, Stable, or incubator's persistence authorities.
  const ROOT_ID = 'animalBabyArrivalOverlay'; // Unique modal reused between consecutive arrivals.
  const STYLE_ID = 'animalBabyArrivalStyles'; // Prevents duplicate styles across game sessions.
  const NAME_MAX = 30; // Matches Nursery and Stable's existing rename-field limit.
  const queue = []; // FIFO of new-baby naming requests and finished-incubation celebrations.
  const suggested = new Set(); // Avoids suggesting identical names during one batch.
  const syllables = ['ba', 'be', 'bi', 'bo', 'bu', 'da', 'de', 'di', 'do', 'du', 'fa', 'fe', 'fi', 'fo', 'fu', 'ga', 'ge', 'gi', 'go', 'gu', 'ka', 'ke', 'ki', 'ko', 'ku', 'la', 'le', 'li', 'lo', 'lu', 'ma', 'me', 'mi', 'mo', 'mu', 'na', 'ne', 'ni', 'no', 'nu', 'pa', 'pe', 'pi', 'po', 'pu', 'sa', 'se', 'si', 'so', 'su', 'ta', 'te', 'ti', 'to', 'tu', 'wa', 'we', 'wi', 'wo', 'chi', 'chu', 'sha', 'shi', 'shu']; // Simple spoken syllables for either position in a baby's name.
  const finalConsonants = ['n', 'm', 't', 'k', 'b', 'g', 'p']; // Optional single-letter codas; b, g and p broaden the existing clipped-name sound.
  const speciesEmoji = { grehlr: '🐺', 'gar-wolf': '🐺', nelk: '🦎', puktuk: '🐇', nazgraku: '🐐', drenkirra: '🐾', uumkaoii: '🦆', 'voorg-ass': '🐴', voorgass: '🐴', honeyfuzzle: '🐝', moot: '🐂' }; // Hatch visuals use species hints where there is no portrait available.
  const CHANGE = 'Animal arrival screens wait for a safe area; blocked arrivals retry once per in-game hour.'; // Mobile debug snapshot change log.
  let active = null; // Modal currently borrowing input focus, if any.
  let root = null; // Lazily created overlay so feature loading never touches the opening screen.
  let expiry = null; // The automatic end timer for an incubation reveal.
  let wakeTimer = null; // Only one deferred wake is needed when many babies arrive in a single tick.
  const CLOCK_POLL_MS = 250; // Only a pending deferred queue samples the clock; danger scans occur on hour changes.
  let deferredHour = null; // Absolute game-hour bucket of the last blocked attempt.
  let deferredReason = null; // Explains the most recent blocked attempt in mobile diagnostics.
  let actionLock = null; // Prevents player movement and attacks while the modal is active.
  let previousFocus = null; // Restores keyboard focus on completing the queue.
  let lastEvent = null; // Most recent arrival/celebration for mobile diagnostics.
  let lastPortrait = null; // Tracks loading/success/failure for the most recent naming portrait in mobile debug snapshots.

  const choose = (items, rng) => items[Math.min(items.length - 1, Math.max(0, Math.floor(rng() * items.length)))]; // Used by name generation with injectable randomness.

  function generateName(rng = Math.random) {
    const first = choose(syllables, rng); // First plain syllable, from the shared pronounceable inventory.
    const second = rng() < 0.24 ? first : choose(syllables, rng); // Retains Mimi/Bobo-style reduplication.
    const ending = rng() < 0.28 ? choose(finalConsonants, rng) : ''; // A consonant, never a nickname suffix.
    const name = (first + second + ending).slice(0, NAME_MAX);
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function nextName() {
    let name = generateName(); // Default proposed name for the next baby.
    for (let attempts = 0; attempts < 12 && suggested.has(name); attempts++) name = generateName();
    suggested.add(name);
    if (suggested.size > 100) suggested.clear();
    return name;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Scoped animation/modal rules apply to both overlay modes.
    style.id = STYLE_ID;
    style.textContent = [
      '#'+ROOT_ID+'{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(12,10,21,.78);backdrop-filter:blur(5px);padding:18px;box-sizing:border-box;color:#fff;overflow-y:auto;overscroll-behavior:contain}',
      '#'+ROOT_ID+'[hidden]{display:none!important}',
      '#'+ROOT_ID+' .aba-card{position:relative;box-sizing:border-box;width:min(440px,100%);max-height:calc(100dvh - 36px);overflow-y:auto;margin:auto;padding:24px 22px 20px;text-align:center;background:linear-gradient(155deg,#30253e,#161a25);border:2px solid #e7bf88;border-radius:20px;box-shadow:0 22px 80px #000c,0 0 38px #f6cf9e30}',
      '#'+ROOT_ID+' .aba-kicker{color:#ffdfad;letter-spacing:.12em;text-transform:uppercase;font-size:12px;font-weight:800}',
      '#'+ROOT_ID+' .aba-heading{display:flex;align-items:center;justify-content:center;gap:14px;margin:10px 0 12px}',
      '#'+ROOT_ID+' .aba-heading h2{margin:0;text-align:left}',
      '#'+ROOT_ID+' .aba-portrait{flex:0 0 94px;width:94px;height:94px;display:grid;place-items:center;overflow:hidden;border-radius:14px;border:1px solid #b7a3c7;background:radial-gradient(circle at 50% 36%,#57456b,#1a1927)}',
      '#'+ROOT_ID+' .aba-chathead{display:block;position:static;inset:auto;width:100%;height:100%;max-width:100%;max-height:100%;image-rendering:pixelated}',
      '#'+ROOT_ID+' .aba-chathead[hidden]{display:none}',
      '#'+ROOT_ID+' .aba-chathead-fallback{font-size:11px;line-height:1.2;padding:8px;color:#f3dfc6}',
      '#'+ROOT_ID+' .aba-chathead-fallback[hidden]{display:none}',
      '#'+ROOT_ID+' h2{font-size:clamp(22px,5vw,30px);margin:10px 0;line-height:1.15}',
      '#'+ROOT_ID+' p{font-size:14px;line-height:1.5;opacity:.9;margin:8px 0 16px}',
      '#'+ROOT_ID+' label{display:block;text-align:left;margin:14px 0 6px;font-weight:700}',
      '#'+ROOT_ID+' input{display:block;box-sizing:border-box;width:100%;font:700 21px system-ui,sans-serif;text-align:center;color:#fff;background:#100f19;border:2px solid #b4a2c4;border-radius:10px;padding:12px;outline-offset:3px}',
      '#'+ROOT_ID+' input:focus{border-color:#ffe1ad}',
      '#'+ROOT_ID+' .aba-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;margin-top:18px}',
      '#'+ROOT_ID+' button{font:700 15px system-ui,sans-serif;min-height:44px;min-width:110px;padding:9px 14px;border-radius:10px;border:1px solid #d8c6dc;color:#fff;background:#4a4056;cursor:pointer}',
      '#'+ROOT_ID+' button.aba-primary{color:#201721;background:#ffe1ad;border-color:#ffe1ad}',
      '#'+ROOT_ID+' button:focus-visible{outline:3px solid #fff;outline-offset:3px}',
      '#'+ROOT_ID+' .aba-error{min-height:1em;color:#ffb6a9;font-size:12px}',
      '#'+ROOT_ID+' .aba-evolution{position:relative;height:185px;display:grid;place-items:center;isolation:isolate;overflow:hidden}',
      '#'+ROOT_ID+' .aba-evolution:before{content:"";position:absolute;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,#fff 0%,#fff4ad7a 28%,#a9a2ff55 55%,transparent 70%);animation:aba-glow 2.7s ease-in-out both}',
      '#'+ROOT_ID+' .aba-evolution:after{content:"✦  ✧  ✦  ✧  ✦";position:absolute;color:#ffde8a;font-size:35px;letter-spacing:8px;animation:aba-sparks 2.7s ease-in-out both}',
      '#'+ROOT_ID+' .aba-egg,#'+ROOT_ID+' .aba-grown{position:absolute;line-height:1;font-size:104px;filter:drop-shadow(0 0 18px #fff7);animation-duration:2.7s;animation-fill-mode:both}',
      '#'+ROOT_ID+' .aba-egg{animation-name:aba-baby}',
      '#'+ROOT_ID+' .aba-grown{animation-name:aba-adult}',
      '@keyframes aba-baby{0%,14%{opacity:1;transform:scale(.68)}30%{opacity:1;transform:scale(.96)}47%{opacity:1;filter:brightness(0) invert(1)}58%,100%{opacity:0;transform:scale(1.22)}}',
      '@keyframes aba-adult{0%,46%{opacity:0;transform:scale(.55);filter:brightness(0) invert(1)}62%{opacity:1;transform:scale(1.22);filter:brightness(0) invert(1)}80%,100%{opacity:1;transform:scale(1);filter:drop-shadow(0 0 18px #fff7)}}',
      '@keyframes aba-glow{0%{opacity:.18;transform:scale(.4)}50%{opacity:1;transform:scale(1.8)}70%{opacity:.9;transform:scale(1.45)}100%{opacity:.2;transform:scale(.8)}}',
      '@keyframes aba-sparks{0%,34%{opacity:0;transform:rotate(0deg) scale(.3)}55%{opacity:1;transform:rotate(45deg) scale(1.7)}100%{opacity:0;transform:rotate(95deg) scale(2)}}',
      '@media(prefers-reduced-motion:reduce){#'+ROOT_ID+' .aba-evolution:before,#'+ROOT_ID+' .aba-evolution:after,#'+ROOT_ID+' .aba-egg,#'+ROOT_ID+' .aba-grown{animation:none!important}#'+ROOT_ID+' .aba-egg{display:none}#'+ROOT_ID+' .aba-grown{opacity:1;transform:none}}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function ensureRoot() {
    if (root && root.isConnected) return root;
    if (!document?.body) return null;
    ensureStyles();
    root = document.createElement('div'); // Root is the sole modal in the arrivals queue.
    root.id = ROOT_ID;
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Animal arrival');
    root.setAttribute('data-ctrl-panel', '');
    root.setAttribute('data-ctrl-modal', '');
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish();
      } else if (event.key === 'Tab') {
        const focusables = [...root.querySelectorAll('button:not([disabled]),input:not([disabled])')]; // Focus trap excludes the game underneath.
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    document.body.appendChild(root);
    return root;
  }

  function acquireFocus() {
    if (!root) return;
    if (!previousFocus) previousFocus = document.activeElement; // Restore what was focused before the queue opened.
    if (!actionLock) actionLock = window.CharacterActionLocks?.acquire?.({
      owner: 'animal-baby-arrival', reason: 'animal naming or incubation reveal',
      participants: ['player'], channels: ['movement', 'tools', 'actions'],
    }) || null;
    root.hidden = false;
  }

  function finish() {
    if (expiry) clearTimeout(expiry);
    expiry = null;
    active = null;
    if (root) { root.hidden = true; root.replaceChildren(); }
    if (queue.length) { showNext(); if (active) return; } // Release the old modal's lock if the next arrival must wait.
    actionLock?.release?.();
    actionLock = null;
    const previous = previousFocus; // Target from before the whole arrival batch.
    previousFocus = null;
    if (previous?.isConnected) previous.focus?.({ preventScroll: true });
  }

  async function drawBabyChathead(item, card) {
    const canvas = card.querySelector('.aba-chathead'); // The visible canvas is also the shared dialogue renderer's output target.
    const fallback = card.querySelector('.aba-chathead-fallback'); // An explicit non-emoji fallback if a species portrait cannot load.
    const chathead = window.AnimalChatheadFrame; // The existing authored crop and genotype-aware compositor, not a second portrait pipeline.
    canvas.setAttribute('aria-label', 'Baby ' + item.kindLabel + ' portrait');
    lastPortrait = { id: item.id, kind: item.kind, status: 'loading' };
    const unavailable = () => {
      if (active !== item) return; // Never update a newer dialog after an older portrait promise settles.
      canvas.hidden = true;
      fallback.hidden = false;
      lastPortrait = { id: item.id, kind: item.kind, status: 'unavailable' };
    };
    if (!item.kind || typeof chathead?.renderCreatureChathead !== 'function') { unavailable(); return; }
    try {
      const painted = await chathead.renderCreatureChathead(canvas, item.kind, { genotype: item.genotype });
      if (active !== item) return;
      if (!painted) { unavailable(); return; }
      lastPortrait = { id: item.id, kind: item.kind, status: 'ready' };
    } catch (error) {
      unavailable();
      window.__farmLog?.('[animal-arrival] Chathead failed: ' + String(error), 'warn');
    }
  }

  function renderName(item) {
    root.setAttribute('aria-label', 'Name your new baby animal');
    const card = document.createElement('form'); // Submitting is the only operation that persists the edited name.
    card.className = 'aba-card';
    card.innerHTML = '<div class="aba-kicker">New arrival</div><div class="aba-heading"><div class="aba-portrait"><canvas class="aba-chathead" width="128" height="128" role="img"></canvas><span class="aba-chathead-fallback" hidden>Portrait unavailable</span></div><h2>Name your little one!</h2></div><p></p><label for="animalBabyNameInput">Baby’s name</label><input id="animalBabyNameInput" name="babyName" type="text" maxlength="30" autocomplete="off" required><div class="aba-error" role="status"></div><div class="aba-actions"><button class="aba-primary" type="submit" data-ctrl-default>Keep this name</button><button type="button" data-ctrl-cancel>Later</button><button type="button" class="aba-reroll">Another name</button></div>';
    const input = card.querySelector('input'); // Editable default suggestion shown without an extra click.
    const error = card.querySelector('.aba-error'); // Inline validation feedback on mobile.
    card.querySelector('p').textContent = 'A new ' + item.kindLabel + ' joined your ' + (item.scope === 'stable' ? 'Stable' : 'Nursery') + '. Choose a name or use this suggestion.';
    input.value = nextName();
    card.addEventListener('submit', event => {
      event.preventDefault();
      const name = input.value.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX); // Matches existing field size and avoids blank names.
      if (!name) { error.textContent = 'Please enter a name, or choose Later.'; input.focus(); return; }
      try {
        if (item.commit?.(name) === false) { error.textContent = 'That animal is no longer available.'; return; }
        item.refresh?.();
        lastEvent = { type: 'named', id: item.id, scope: item.scope, name };
        finish();
      } catch (e) {
        error.textContent = 'Could not save the name. Please try again.';
        window.__farmLog?.('[animal-arrival] Save failed: ' + String(e), 'farm');
      }
    });
    card.querySelector('[data-ctrl-cancel]').addEventListener('click', finish); // No rename on cancel; original persisted name remains intact.
    card.querySelector('.aba-reroll').addEventListener('click', () => { input.value = nextName(); input.focus(); input.select(); });
    root.appendChild(card);
    void drawBabyChathead(item, card); // Painting is async; naming and controller focus never depend on network image latency.
    input.focus({ preventScroll: true });
    input.select();
  }

  function renderMaturation(item) {
    root.setAttribute('aria-label', 'Animal finished incubating');
    const card = document.createElement('div'); // Non-blocking auto-finishing celebration, not a save operation.
    card.className = 'aba-card';
    card.innerHTML = '<div class="aba-kicker">✨ Incubation complete!</div><h2></h2><div class="aba-evolution" aria-hidden="true"><span class="aba-egg">🐣</span><span class="aba-grown"></span></div><p>Your baby grew up and moved to its reserved barn trough!</p><div class="aba-actions"><button class="aba-primary" type="button" data-ctrl-default data-ctrl-cancel>Continue</button></div>';
    card.querySelector('h2').textContent = item.name + ' is all grown up!';
    card.querySelector('.aba-grown').textContent = speciesEmoji[item.kind] || '🐾';
    card.querySelector('button').addEventListener('click', finish);
    root.appendChild(card);
    card.querySelector('button').focus({ preventScroll: true });
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; // Honor players who disable motion.
    expiry = setTimeout(finish, reduced ? 900 : 3100);
  }

  function dangerReason() {
    const deps = window.Combat?.deps; // Live combat entities and player coordinates, not a scene traversal.
    const area = deps?.getCurrentArea?.() || window.GridTileAccessors?.getCurrentArea?.(); // Current player area.
    if (!area) return 'world-not-ready';
    if (/^map_i_(?:den_|town_mine_|.*(?:cave|cavern|ruin))/.test(area)
      || window.WildlifeSpawn?.denCavernZoneOf?.(area)
      || window.CavernGenerator?.isLocaleCavernMapId?.(area)) return 'dangerous-interior';
    const wilderness = /^map_(?:northern_cliffs|western_slope|eastern_mire|cloud_forest|dev_wilderness_chunk_lab)$/.test(area)
      || !!window.GridTileAccessors?.getZoneSceneInfo?.(area); // The live zone registry also covers generated exterior zones.
    if (!wilderness) return null;
    const player = deps?.player; // Positions are in world pixels on both axes.
    const chunkSize = Number(deps?.TILE) * Number(window.WildernessChunks?.constants?.CHUNK_TILES); // Use the streamer's actual chunk dimensions.
    if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y) || !(chunkSize > 0) || !deps?.hostileObjects) return 'world-not-ready';
    const cx = Math.floor(player.x / chunkSize), cy = Math.floor(player.y / chunkSize); // Player's current wilderness chunk.
    for (const foe of deps.hostileObjects) {
      if (!foe || !(foe.health > 0) || foe.areaId !== area || foe.isCompanion || foe._denHidden
        || foe.denDisplacedPrey || foe._hiveTucked || foe.isEncounterProxy || foe.state === 'dying' || foe.state === 'corpse'
        || foe._porakanekiPlannerControlled === true) continue;
      const phase = foe._territorialBehavior?.phase; // Warning and fighting wildlife are threats even if ordinarily neutral.
      if (!foe.isDenMother && !foe.isBandit && !foe.banditCompanion && phase !== 'warning' && phase !== 'fight'
        && foe.def?.hostile === false) continue;
      if (Math.floor(foe.x / chunkSize) === cx && Math.floor(foe.y / chunkSize) === cy) return 'hostile-in-chunk';
    }
    return null;
  }

  function scheduleWake(delay = 0) {
    if (wakeTimer !== null || active || !queue.length) return;
    wakeTimer = setTimeout(() => { wakeTimer = null; showNext(); }, delay);
  }

  function showNext() {
    if (active || !queue.length) return;
    const clock = window.CalendarSystem; // Authoritative monotonic game time, including midnight and time skips.
    const absoluteHour = clock?.getAbsoluteGameHour?.(); // Used solely to gate deferred danger checks.
    const hour = Number.isFinite(absoluteHour) ? Math.floor(absoluteHour) : null; // Integer game-hour bucket.
    if (hour === null || clock?.getNaturalGameHoursPerSecond?.() === 0) {
      deferredReason = 'clock-not-ready-or-time-passage';
      scheduleWake(CLOCK_POLL_MS);
      return;
    }
    if (deferredHour === hour) { scheduleWake(CLOCK_POLL_MS); return; }
    const reason = dangerReason(); // Initial arrivals are checked immediately; retries only after the clock advances.
    if (reason) {
      deferredHour = hour;
      deferredReason = reason;
      lastEvent = { type: 'deferred', id: queue[0].id, reason, hour };
      scheduleWake(CLOCK_POLL_MS);
      return;
    }
    deferredHour = null;
    deferredReason = null;
    if (!ensureRoot()) { scheduleWake(CLOCK_POLL_MS); return; }
    active = queue.shift(); // Only one prompt can borrow focus at once.
    acquireFocus();
    if (active.type === 'name') renderName(active);
    else renderMaturation(active);
    // The controller's panel discovery runs on a MutationObserver. Claim this
    // dialog now so a delayed reconcile cannot steal focus back to the Farm tab.
    window.ControllerUI?.focusPanel?.(root);
    lastEvent = { type: active.type, id: active.id, scope: active.scope || 'incubator' };
    window.__farmLog?.('[animal-arrival] ' + active.type + ' ' + active.id, 'farm');
  }

  function enqueue(item) {
    if (!item?.id || typeof document === 'undefined' || queue.length >= 64) return false;
    queue.push(item);
    scheduleWake(); // Complete saves first and coalesce same-tick arrivals; a deferred wake is never duplicated.
    return true;
  }

  function requestName(entry, options = {}) {
    if (!entry?.id || typeof options.commit !== 'function') return false;
    const kindLabel = window.CREATURE_DB?.[entry.kind]?.label || window.CreatureGenetics?.defaultLivestockName?.(entry.kind) || 'animal'; // Uses existing species names where possible.
    return enqueue({ type: 'name', id: String(entry.id), scope: options.scope || 'nursery', kind: String(entry.kind || '').toLowerCase().replace(/_/g, '-'), kindLabel, genotype: entry.genotype || entry.animalGenotype || entry.creatureGenotype || null, commit: options.commit, refresh: options.refresh });
  }

  function celebrateMaturation(entry) {
    if (!entry?.id) return false;
    return enqueue({ type: 'maturation', id: String(entry.id), name: String(entry.name || 'Your animal'), kind: String(entry.kind || '') });
  }

  function debugSnapshot() {
    return { mostRecentChange: CHANGE, active: active ? { type: active.type, id: active.id } : null,
      queued: queue.map(item => ({ type: item.type, id: item.id, scope: item.scope })),
      deferredHour, deferredReason, retryPending: wakeTimer !== null,
      lastEvent, lastPortrait, locked: !!actionLock, rootVisible: !!root && !root.hidden };
  }

  window.AnimalBabyArrival = { requestName, celebrateMaturation, generateName, debugSnapshot };
  window.__animalBabyArrivalDebug = { snapshot: debugSnapshot, showTestNaming: (kind = 'puktuk') => requestName({ id: 'preview-baby', kind }, { commit: () => true }), showTestMaturation: () => celebrateMaturation({ id: 'preview', name: 'Bubbi', kind: 'puktuk' }) };
})();
