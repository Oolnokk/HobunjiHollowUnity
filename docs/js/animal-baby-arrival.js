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
  const starts = ['bo', 'bu', 'ba', 'bi', 'mo', 'mu', 'mi', 'ma', 'po', 'pu', 'pi', 'pa', 'no', 'nu', 'ni', 'na', 'ki', 'ko', 'ku', 'ke', 'lo', 'lu', 'li', 'la', 'to', 'tu', 'ti', 'ta', 'fu', 'fi', 'fa', 'pe', 'be', 'chi', 'chu', 'shi', 'wa', 'wi']; // Soft initial syllables used by generateName.
  const finishes = ['bo', 'bu', 'bi', 'ba', 'mo', 'mu', 'mi', 'ma', 'po', 'pu', 'pi', 'pa', 'no', 'nu', 'ni', 'na', 'ko', 'ku', 'ki', 'ka', 'lo', 'lu', 'li', 'la', 'to', 'tu', 'ti', 'ta', 'chi', 'chu', 'shi', 'fie', 'bee', 'bun', 'bit', 'kin', 'let', 'pop', 'puff']; // Cutesy nickname endings used by generateName.
  const speciesEmoji = { grehlr: '🐺', 'gar-wolf': '🐺', nelk: '🦎', puktuk: '🐇', nazgraku: '🐐', drenkirra: '🐾', uumkaoii: '🦆', 'voorg-ass': '🐴', voorgass: '🐴', honeyfuzzle: '🐝', moot: '🐂' }; // Hatch visuals use species hints where there is no portrait available.
  const CHANGE = 'Nursery births/deployments and Stable babies offer cute names; successful incubator maturation shows an evolution-style reveal.'; // Mobile debug snapshot change log.
  let active = null; // Modal currently borrowing input focus, if any.
  let root = null; // Lazily created overlay so feature loading never touches the opening screen.
  let expiry = null; // The automatic end timer for an incubation reveal.
  let wakeTimer = null; // Only one deferred wake is needed when many babies arrive in a single tick.
  let actionLock = null; // Prevents player movement and attacks while the modal is active.
  let previousFocus = null; // Restores keyboard focus on completing the queue.
  let lastEvent = null; // Most recent arrival/celebration for mobile diagnostics.

  const choose = (items, rng) => items[Math.min(items.length - 1, Math.max(0, Math.floor(rng() * items.length)))]; // Used by name generation with injectable randomness.

  function generateName(rng = Math.random) {
    const first = choose(starts, rng); // Opening syllable chosen with the caller's random source.
    const second = rng() < 0.24 ? first : choose(finishes, rng); // Reduplication produces Mimi / Bobo style names.
    const tail = rng() < 0.19 ? choose(['ie', 'o', 'y', 'kins', 'bean'], rng) : ''; // Occasional familiar nickname endings.
    const name = (first + second + tail).slice(0, NAME_MAX);
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
      '#'+ROOT_ID+'{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(12,10,21,.78);backdrop-filter:blur(5px);padding:18px;box-sizing:border-box;color:#fff;overscroll-behavior:contain}',
      '#'+ROOT_ID+'[hidden]{display:none!important}',
      '#'+ROOT_ID+' .aba-card{position:relative;box-sizing:border-box;width:min(440px,100%);padding:24px 22px 20px;text-align:center;background:linear-gradient(155deg,#30253e,#161a25);border:2px solid #e7bf88;border-radius:20px;box-shadow:0 22px 80px #000c,0 0 38px #f6cf9e30}',
      '#'+ROOT_ID+' .aba-kicker{color:#ffdfad;letter-spacing:.12em;text-transform:uppercase;font-size:12px;font-weight:800}',
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
    if (queue.length) { showNext(); return; }
    actionLock?.release?.();
    actionLock = null;
    const previous = previousFocus; // Target from before the whole arrival batch.
    previousFocus = null;
    if (previous?.isConnected) previous.focus?.({ preventScroll: true });
  }

  function renderName(item) {
    root.setAttribute('aria-label', 'Name your new baby animal');
    const card = document.createElement('form'); // Submitting is the only operation that persists the edited name.
    card.className = 'aba-card';
    card.innerHTML = '<div class="aba-kicker">🐣 New arrival</div><h2>Name your little one!</h2><p></p><label for="animalBabyNameInput">Baby’s name</label><input id="animalBabyNameInput" name="babyName" type="text" maxlength="30" autocomplete="off" required><div class="aba-error" role="status"></div><div class="aba-actions"><button class="aba-primary" type="submit" data-ctrl-default>Keep this name</button><button type="button" data-ctrl-cancel>Later</button><button type="button" class="aba-reroll">🎲 Another</button></div>';
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

  function showNext() {
    if (active || !queue.length || !ensureRoot()) return;
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
    if (!active && !wakeTimer) wakeTimer = setTimeout(() => { wakeTimer = null; showNext(); }, 0); // Complete saves first and coalesce same-tick arrivals.
    return true;
  }

  function requestName(entry, options = {}) {
    if (!entry?.id || typeof options.commit !== 'function') return false;
    const kindLabel = window.CREATURE_DB?.[entry.kind]?.label || window.CreatureGenetics?.defaultLivestockName?.(entry.kind) || 'animal'; // Uses existing species names where possible.
    return enqueue({ type: 'name', id: String(entry.id), scope: options.scope || 'nursery', kindLabel, commit: options.commit, refresh: options.refresh });
  }

  function celebrateMaturation(entry) {
    if (!entry?.id) return false;
    return enqueue({ type: 'maturation', id: String(entry.id), name: String(entry.name || 'Your animal'), kind: String(entry.kind || '') });
  }

  function debugSnapshot() {
    return { mostRecentChange: CHANGE, active: active ? { type: active.type, id: active.id } : null,
      queued: queue.map(item => ({ type: item.type, id: item.id, scope: item.scope })),
      lastEvent, locked: !!actionLock, rootVisible: !!root && !root.hidden };
  }

  window.AnimalBabyArrival = { requestName, celebrateMaturation, generateName, debugSnapshot };
  window.__animalBabyArrivalDebug = { snapshot: debugSnapshot, showTestMaturation: () => celebrateMaturation({ id: 'preview', name: 'Bubbi', kind: 'puktuk' }) };
})();
