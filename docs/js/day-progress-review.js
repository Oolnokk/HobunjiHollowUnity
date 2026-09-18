(() => {
  'use strict';

  if (Number(window.DayProgressReview?.version) >= 1) return;

  const STORAGE_VERSION = 1; // Used to invalidate incompatible persisted daily-ledger shapes cleanly.
  const STORAGE_PREFIX = 'hobunji_day_progress_review_v1'; // Used to keep one resumable ledger per world.
  const CIVIL_MIDNIGHT_HOUR = 24; // Continuous review-clock midnight; public CalendarSystem.getHour intentionally wraps this same instant to 0.
  const NATURAL_WRITE_MAX = 0.02; // Mirrors CalendarSystem's natural-frame write discriminator so explicit time skips remain untouched.
  const PASSAGE_FIRST_TICK_MS = 1000; // Mirrors CalendarSystem's private first sleep/wait tick so this review-aware confirm preserves pacing.
  const PASSAGE_TICK_DECAY = 0.8; // Mirrors CalendarSystem's private 20% per-hour acceleration for sleep/wait.
  const PLAYER_ACTION_LOCK_ID = 'player'; // Used to suppress movement/tools/actions while the midnight review owns the screen.
  const REVIEW_STYLE_ID = 'hobunji-day-progress-review-style'; // Used to make injected review styles idempotent.
  const REVIEW_ROOT_ID = 'hobunjiDayProgressReview'; // Used to reuse one full-screen modal across every midnight.
  const DEBUG_BUTTON_ID = 'dayProgressReviewDebugButton'; // Used to keep the mobile-accessible test control idempotent.
  const DEBUG_PANEL_ID = 'devSpawnPanel'; // Existing in-game Dev Tools panel receiving the review test button.
  const CHANGE_SUMMARY = 'Fixed midnight review triggering and post-midnight ledger ownership against the full-day clock\'s wrapped 0-23 display hour.'; // Exposed in debug output as the latest change summary.

  let calendarApi = null; // Captured CalendarSystem namespace used by civil-time checks and formatting.
  let calendarDeps = null; // Captured CalendarSystem.init dependencies used by the review-aware sleep/wait passage runner.
  let activeReviewPromise = null; // Shared promise returned to every caller while one midnight review is already open.
  let activeReviewResolve = null; // Resolver used by the Continue button to release the paused clock/passage.
  let activeReviewLock = null; // CharacterActionLocks handle held while the review modal is visible.
  let activeReviewMarksDay = true; // Controls whether closing the current modal consumes the real midnight review for this civil day.
  let activeReviewPreviousReviewedDayKey = null; // Preserves the real reviewed-day marker while a debug-only preview is open.
  let calendarNaturalWriteScale = 1; // Cached CalendarSystem natural clock multiplier used by the per-frame midnight gate without rebuilding a debug snapshot.
  let revealGeneration = 0; // Incremented to invalidate an older staged reveal when a review closes or is fast-forwarded.
  let fastForwardReveal = false; // Set by a tap during the reveal so all remaining rows appear immediately.
  let persistTimer = 0; // Debounces high-frequency Rapport changes before writing the ledger to localStorage.
  let debugObserver = null; // Watches for the dev panel when it is constructed after this module loads.
  let state = null; // In-memory persisted review state for the active world and civil day.
  const decoratedRelationshipMemories = new WeakSet(); // Prevents wrapping the same NPC memory array more than once.

  function log(message, level = 'info') {
    const logger = window.__farmLog || ((text) => console.log(text)); // Existing mobile-visible game log used for review diagnostics.
    try { logger(`[day-review] ${message}`, level); }
    catch (_) { console.log(`[day-review] ${message}`); }
  }

  function finiteNumber(value, fallback = 0) {
    const numeric = Number(value); // Normalized numeric candidate returned when finite.
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function roundedDisplayNumber(value) {
    const numeric = finiteNumber(value, 0); // Number normalized before compact display rounding.
    const rounded = Math.round(numeric * 10) / 10; // One-decimal precision keeps fractional Rapport readable without noise.
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function formatNumber(value) {
    const numeric = roundedDisplayNumber(value); // Rounded value rendered with locale separators below.
    return Number.isInteger(numeric) ? numeric.toLocaleString() : numeric.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function signedNumber(value) {
    const numeric = roundedDisplayNumber(value); // Signed relationship/XP value used by review rows.
    return `${numeric > 0 ? '+' : numeric < 0 ? '−' : ''}${formatNumber(Math.abs(numeric))}`;
  }

  function worldId() {
    return String(window.__hobunjiPlayerProfile?.worldId || 'session');
  }

  function storageKey() {
    return `${STORAGE_PREFIX}:${worldId()}`;
  }

  function representedHour(time01 = calendarDeps?.calendar?.time01) {
    const morningHour = finiteNumber(calendarDeps?.MORNING_HOUR, 6); // Internal rollover hour used as the continuous clock origin.
    const clockHours = Math.max(0.000001, finiteNumber(calendarDeps?.NIGHT_HOUR, morningHour + 24) - morningHour); // Full represented day span; Sky Dome expands this to 24 hours before CalendarSystem init completes.
    return morningHour + finiteNumber(time01, 0) * clockHours;
  }

  function rawDay() {
    return Math.floor(finiteNumber(calendarDeps?.calendar?.day ?? calendarApi?.timeDebugSnapshot?.()?.rawDay, 1));
  }

  function civilOrdinal() {
    const day = rawDay(); // Raw 06:00→06:00 simulation day serving as the civil-day base.
    return day + (representedHour() >= CIVIL_MIDNIGHT_HOUR ? 1 : 0);
  }

  function currentDayKey() {
    return `${worldId()}:${civilOrdinal()}`;
  }

  function emptyAggregateBucket() {
    return {};
  }

  function emptyLedger(dayKey = currentDayKey()) {
    return {
      dayKey,
      currency: { money: 0, motes: 0, other: emptyAggregateBucket() },
      masteryXp: emptyAggregateBucket(),
      skillXp: emptyAggregateBucket(),
      petXp: emptyAggregateBucket(),
      relationships: {},
      items: emptyAggregateBucket(),
    };
  }

  function defaultState() {
    return {
      version: STORAGE_VERSION,
      worldId: worldId(),
      dayKey: currentDayKey(),
      reviewedDayKey: null,
      ledger: emptyLedger(),
    };
  }

  function normalizeLoadedState(candidate) {
    const fallback = defaultState(); // Fresh state used when persisted data is absent or malformed.
    if (!candidate || candidate.version !== STORAGE_VERSION || candidate.worldId !== worldId()) return fallback;
    const loadedLedger = candidate.ledger && typeof candidate.ledger === 'object' ? candidate.ledger : emptyLedger(candidate.dayKey); // Persisted ledger reused when structurally present.
    return {
      version: STORAGE_VERSION,
      worldId: worldId(),
      dayKey: String(candidate.dayKey || loadedLedger.dayKey || currentDayKey()),
      reviewedDayKey: candidate.reviewedDayKey ? String(candidate.reviewedDayKey) : null,
      ledger: {
        dayKey: String(loadedLedger.dayKey || candidate.dayKey || currentDayKey()),
        currency: {
          money: Math.max(0, finiteNumber(loadedLedger.currency?.money, 0)),
          motes: Math.max(0, finiteNumber(loadedLedger.currency?.motes, 0)),
          other: loadedLedger.currency?.other && typeof loadedLedger.currency.other === 'object' ? loadedLedger.currency.other : {},
        },
        masteryXp: loadedLedger.masteryXp && typeof loadedLedger.masteryXp === 'object' ? loadedLedger.masteryXp : {},
        skillXp: loadedLedger.skillXp && typeof loadedLedger.skillXp === 'object' ? loadedLedger.skillXp : {},
        petXp: loadedLedger.petXp && typeof loadedLedger.petXp === 'object' ? loadedLedger.petXp : {},
        relationships: loadedLedger.relationships && typeof loadedLedger.relationships === 'object' ? loadedLedger.relationships : {},
        items: loadedLedger.items && typeof loadedLedger.items === 'object' ? loadedLedger.items : {},
      },
    };
  }

  function loadState() {
    if (state && state.worldId === worldId()) return state;
    try {
      const raw = window.localStorage?.getItem(storageKey()); // Serialized daily ledger restored after reloads during the same day.
      state = normalizeLoadedState(raw ? JSON.parse(raw) : null);
    } catch (error) {
      log(`ledger load failed: ${error?.message || error}`, 'warn');
      state = defaultState();
    }
    syncLedgerDay();
    return state;
  }

  function flushPersist() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = 0;
    }
    if (!state) return;
    try { window.localStorage?.setItem(storageKey(), JSON.stringify(state)); }
    catch (error) { log(`ledger save failed: ${error?.message || error}`, 'warn'); }
  }

  function queuePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = 0;
      flushPersist();
    }, 350);
  }

  function syncLedgerDay() {
    if (!state) return;
    const dayKey = currentDayKey(); // Live civil-day key compared to the persisted ledger's owner.
    if (state.dayKey === dayKey && state.ledger?.dayKey === dayKey) return;
    state.dayKey = dayKey;
    state.ledger = emptyLedger(dayKey);
    queuePersist();
  }

  function ensureStateForRecording() {
    loadState();
    syncLedgerDay();
    return state;
  }

  function parseRewardText(text) {
    const original = String(text ?? '').trim(); // Untouched reward text retained as a fallback display label.
    const normalized = original.replace(/,/g, ''); // Commas removed so numeric parsing works for large gains.
    if (!normalized || /^\s*[−-]/.test(normalized)) return { positive: false, amount: 0, label: original, text: original };

    const prefixMatch = normalized.match(/^\s*\+?\s*(\d+(?:\.\d+)?)\s*(.*)$/); // Common "+5 Farming XP" / "+24g" reward shape.
    if (prefixMatch) {
      const amount = finiteNumber(prefixMatch[1], 0); // Parsed positive quantity used for aggregation.
      const label = String(prefixMatch[2] || '').trim() || original; // Remaining reward label grouped across repeated awards.
      return { positive: amount > 0, amount, label, text: original };
    }

    const suffixMatch = normalized.match(/^(.*?)\s+[x×]\s*(\d+(?:\.\d+)?)\s*$/i); // Alternate "Pine Log x2" item-count shape.
    if (suffixMatch) {
      const amount = finiteNumber(suffixMatch[2], 0); // Parsed trailing quantity used for item aggregation.
      const label = String(suffixMatch[1] || '').trim() || original; // Item name preceding the trailing count.
      return { positive: amount > 0, amount, label, text: original };
    }

    return { positive: true, amount: 1, label: original, text: original };
  }

  function rewardBucket(kind, text) {
    const normalizedKind = String(kind || ''); // Popup reward kind mapped into one day-review category.
    const normalizedText = String(text || ''); // Reward label inspected for sub-types such as pet XP or motes.
    if (normalizedKind === 'currency') return /\bmotes?\b/i.test(normalizedText) ? 'motes' : /\b(?:gold|coins?|money)\b|\d\s*g\b/i.test(normalizedText) ? 'money' : 'otherCurrency';
    if (normalizedKind === 'masteryXp') return 'masteryXp';
    if (normalizedKind === 'skillXp') return /\b(?:Mount|Shoulder\s+Pet|Companion|Animal)\s+XP\b/i.test(normalizedText) ? 'petXp' : 'skillXp';
    if (normalizedKind === 'loot') return 'items';
    return null;
  }

  function cleanAggregateLabel(bucket, parsed) {
    const rawLabel = String(parsed.label || parsed.text || '').trim(); // Parsed trailing text normalized into a readable row label.
    if (bucket === 'money') return 'Money';
    if (bucket === 'motes') return 'Motes of Prowess';
    if (rawLabel.toLowerCase() === 'g') return 'Money';
    return rawLabel.replace(/^[-–—:\s]+|[-–—:\s]+$/g, '') || String(parsed.text || 'Gain');
  }

  function addAggregate(bucket, label, amount, sampleText = '') {
    const key = String(label || sampleText || 'Gain'); // Stable aggregation key combining repeated same-label rewards.
    const current = bucket[key] || { label: key, amount: 0, events: 0, sampleText: String(sampleText || '') }; // Existing row totals extended in place.
    current.amount = finiteNumber(current.amount, 0) + Math.max(0, finiteNumber(amount, 0));
    current.events = Math.max(0, Math.floor(finiteNumber(current.events, 0))) + 1;
    current.sampleText = current.sampleText || String(sampleText || '');
    bucket[key] = current;
  }

  function recordReward(kind, text) {
    const bucketName = rewardBucket(kind, text); // Review category selected from the popup reward's existing semantic kind/text.
    if (!bucketName) return;
    const parsed = parseRewardText(text); // Positive amount/label parsed from the existing player-visible reward text.
    if (!parsed.positive || !(parsed.amount > 0)) return;
    const reviewState = ensureStateForRecording(); // Current-day ledger receiving this gain.
    const ledger = reviewState.ledger; // Short alias used by the category-specific aggregation below.
    const label = cleanAggregateLabel(bucketName, parsed); // Human-readable row label shared by repeated rewards.

    if (bucketName === 'money') ledger.currency.money += parsed.amount;
    else if (bucketName === 'motes') ledger.currency.motes += parsed.amount;
    else if (bucketName === 'otherCurrency') addAggregate(ledger.currency.other, label, parsed.amount, parsed.text);
    else addAggregate(ledger[bucketName], label, parsed.amount, parsed.text);
    queuePersist();
  }

  function relationshipEntry(npcId) {
    const reviewState = ensureStateForRecording(); // Current-day ledger owning per-NPC relationship totals.
    const id = String(npcId || ''); // Stable NPC key used for daily Favor/Rapport aggregation.
    if (!id) return null;
    const existing = reviewState.ledger.relationships[id] || { npcId: id, favorDelta: 0, rapportDelta: 0 }; // Existing relationship row extended in place.
    reviewState.ledger.relationships[id] = existing;
    return existing;
  }

  function recordRapport(npcId, amount) {
    const delta = finiteNumber(amount, 0); // Actually-applied Rapport delta emitted by the relationship memory stream.
    if (!delta) return;
    const entry = relationshipEntry(npcId); // Per-NPC daily row receiving the Rapport delta.
    if (!entry) return;
    entry.rapportDelta = finiteNumber(entry.rapportDelta, 0) + delta;
    queuePersist();
  }

  function recordFavor(npcId, amount) {
    const delta = finiteNumber(amount, 0); // Actually-applied permanent Favor delta measured from authoritative relationship snapshots.
    if (!delta) return;
    const entry = relationshipEntry(npcId); // Per-NPC daily row receiving the Favor delta.
    if (!entry) return;
    entry.favorDelta = finiteNumber(entry.favorDelta, 0) + delta;
    queuePersist();
  }

  function decorateRelationshipState(npcId, relationshipState) {
    const memory = relationshipState?.memory; // NpcRapport's central event stream, written after every clamped Rapport adjustment.
    if (!Array.isArray(memory) || decoratedRelationshipMemories.has(memory)) return relationshipState;
    const originalPush = memory.push; // Existing Generic HUD / native push wrapper preserved beneath the day ledger observer.
    Object.defineProperty(memory, 'push', {
      configurable: true,
      writable: true,
      value: function dayProgressReviewMemoryPush(...entries) {
        const result = originalPush.apply(this, entries); // Existing memory storage and HUD popup behavior run first.
        for (const event of entries) {
          if (event?.type !== 'rapport') continue;
          const amount = finiteNumber(event.amount, 0); // Applied Rapport amount recorded without treating midnight rollover as a new daily gain.
          if (amount) recordRapport(npcId, amount);
        }
        return result;
      },
    });
    decoratedRelationshipMemories.add(memory);
    return relationshipState;
  }

  function favorMap(dialogue) {
    const result = {}; // NPC-id → permanent Favor snapshot used to catch direct and spillover Favor mutations.
    if (!dialogue) return result;
    try {
      const snapshot = dialogue.npcRelationshipsSnapshot?.(); // Authoritative relationship serializer includes spillover-changed NPCs as well as the direct target.
      for (const [npcId, relationship] of Object.entries(snapshot || {})) {
        const favor = Number(relationship?.favor); // Permanent Favor value diffed around adjustNpcFavor.
        if (Number.isFinite(favor)) result[String(npcId)] = favor;
      }
    } catch (error) {
      log(`favor snapshot failed: ${error?.message || error}`, 'warn');
    }
    return result;
  }

  function diffFavorMaps(before, after) {
    const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]); // Every directly or indirectly changed NPC candidate.
    for (const npcId of ids) {
      const beforeValue = finiteNumber(before?.[npcId], 0); // Favor before the authoritative mutation.
      const afterValue = finiteNumber(after?.[npcId], 0); // Favor after direct + spillover mutation.
      const delta = afterValue - beforeValue; // Actual permanent Favor change attributed to this NPC.
      if (delta) recordFavor(npcId, delta);
    }
  }

  function patchDialogueContent(dialogue) {
    if (!dialogue || dialogue.__dayProgressReviewPatched) return dialogue;

    if (typeof dialogue.getNpcDlgState === 'function') {
      const originalGetState = dialogue.getNpcDlgState.bind(dialogue); // Existing Rapport settlement / Generic HUD getter chain preserved beneath this observer.
      dialogue.getNpcDlgState = function dayProgressReviewGetState(npcId, ...args) {
        return decorateRelationshipState(String(npcId || ''), originalGetState(npcId, ...args));
      };
    }

    if (typeof dialogue.adjustNpcFavor === 'function') {
      const originalAdjustFavor = dialogue.adjustNpcFavor.bind(dialogue); // Existing Favor clamping, Love Potion multiplier, memory, spillover, and popup path preserved.
      dialogue.adjustNpcFavor = function dayProgressReviewAdjustFavor(npcId, amount, reason, ...args) {
        const before = favorMap(dialogue); // Whole relationship snapshot catches recursive spillover that bypasses the exported wrapper.
        const result = originalAdjustFavor(npcId, amount, reason, ...args);
        const after = favorMap(dialogue); // Post-mutation snapshot supplies actually-applied per-NPC changes.
        diffFavorMaps(before, after);
        return result;
      };
    }

    dialogue.__dayProgressReviewPatched = true;
    return dialogue;
  }

  function patchWorldPopupText(api) {
    if (!api || api.__dayProgressReviewPatched || typeof api.queueReward !== 'function') return api;
    const originalQueueReward = api.queueReward.bind(api); // Existing centered reward queue remains authoritative for visible reward behavior.
    api.queueReward = function dayProgressReviewQueueReward(kind, text, options = {}) {
      const result = originalQueueReward(kind, text, options);
      recordReward(kind, text);
      return result;
    };
    api.__dayProgressReviewPatched = true;
    return api;
  }

  function hookGlobal(globalName, patcher) {
    const current = window[globalName]; // Already-loaded namespace patched immediately when available.
    if (current) patcher(current);
    const descriptor = Object.getOwnPropertyDescriptor(window, globalName); // Existing lazy getter/setter contract preserved when another compatibility module owns it.
    if (descriptor && !descriptor.configurable) return;
    if (descriptor?.set || descriptor?.get) {
      Object.defineProperty(window, globalName, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return descriptor.get ? descriptor.get.call(window) : undefined; },
        set(value) {
          descriptor.set?.call(window, value);
          const resolved = descriptor.get ? descriptor.get.call(window) : value; // Namespace value after the prior setter has had a chance to transform it.
          patcher(resolved);
        },
      });
      return;
    }
    let value = descriptor?.value; // Backing namespace used until the later parser-blocking script assigns the real API.
    Object.defineProperty(window, globalName, {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return value; },
      set(next) {
        value = next;
        patcher(next);
      },
    });
  }

  function naturalClockScale() {
    return calendarNaturalWriteScale > 0 ? calendarNaturalWriteScale : 1;
  }

  function passageOwnsClock() {
    const backdropOpen = !!document.querySelector?.('.time-passage-backdrop.open'); // Existing CalendarSystem passage modal is the authoritative selector/transition ownership signal.
    const iris = document.querySelector?.('.time-iris-overlay'); // Existing sleep/wait iris checked for its active inline display state.
    return backdropOpen || iris?.style?.display === 'block';
  }

  function crossesCivilMidnight(fromHour, toHour) {
    const from = finiteNumber(fromHour, NaN); // Starting continuous represented hour used by both natural and sleep/wait crossing checks.
    const to = finiteNumber(toHour, NaN); // Proposed continuous represented hour used by both natural and sleep/wait crossing checks.
    return Number.isFinite(from) && Number.isFinite(to) && from < CIVIL_MIDNIGHT_HOUR && to >= CIVIL_MIDNIGHT_HOUR;
  }

  function shouldPauseNaturalMidnight(fromHour, toHour) {
    loadState();
    if (!crossesCivilMidnight(fromHour, toHour)) return false;
    const dayKey = currentDayKey(); // Day being completed before the clock is permitted to cross midnight.
    return state.reviewedDayKey !== dayKey;
  }

  function installNaturalMidnightGate(calendar) {
    if (!calendar || calendar.__dayProgressReviewTimeGate) return false;
    const descriptor = Object.getOwnPropertyDescriptor(calendar, 'time01'); // CalendarSystem's existing configurable natural-rate accessor wrapped below.
    if (!descriptor?.get || !descriptor?.set || descriptor.configurable === false) {
      log('calendar time01 accessor unavailable; natural-midnight review gate was not installed', 'warn');
      return false;
    }

    Object.defineProperty(calendar, 'time01', {
      configurable: true,
      enumerable: descriptor.enumerable !== false,
      get() { return descriptor.get.call(calendar); },
      set(nextValue) {
        const before = finiteNumber(descriptor.get.call(calendar), 0); // Current backing value before CalendarSystem applies its own scaling.
        const numeric = Number(nextValue); // Proposed write used to recognize normal frame drift without blocking explicit passage jumps.
        if (!Number.isFinite(numeric)) return descriptor.set.call(calendar, nextValue);
        const delta = numeric - before; // Raw frame delta compared with CalendarSystem's same natural-write threshold.
        const isNaturalFrameWrite = window.__hobunjiGameStarted === true && delta > 0 && delta <= NATURAL_WRITE_MAX;
        if (!isNaturalFrameWrite || passageOwnsClock()) return descriptor.set.call(calendar, nextValue);
        if (activeReviewPromise) return; // Natural clock remains pinned immediately before midnight until Continue resolves the review.

        const scaledNext = before + delta * naturalClockScale(); // Exact value CalendarSystem's underlying setter would accept for this frame.
        const fromHour = representedHour(before); // Continuous start hour used because public CalendarSystem.getHour wraps midnight to 0.
        const toHour = representedHour(scaledNext); // Continuous scaled destination used to detect the actual 24:00 crossing.
        if (shouldPauseNaturalMidnight(fromHour, toHour)) {
          requestMidnightReview({ source: 'natural', day: calendarDeps?.calendar?.day, time01: before });
          return;
        }
        descriptor.set.call(calendar, nextValue);
      },
    });

    Object.defineProperty(calendar, '__dayProgressReviewTimeGate', { configurable: true, value: true });
    log('natural midnight clock gate installed');
    return true;
  }

  function activeClockHours() {
    return finiteNumber(calendarDeps?.NIGHT_HOUR, 30) - finiteNumber(calendarDeps?.MORNING_HOUR, 6);
  }

  function delayMs(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, finiteNumber(ms, 0))));
  }

  function renderPassageTick(kind, remainingHours) {
    const title = document.getElementById('timePassageTitle'); // Existing passage heading updated to preserve CalendarSystem's current progress presentation.
    const live = document.getElementById('timePassageLive'); // Existing live date/time line updated after each review-aware hour.
    const hours = document.getElementById('timePassageHours'); // Existing remaining-hour count updated after each review-aware hour.
    if (title) title.textContent = `${kind === 'sleep' ? 'Sleeping' : 'Waiting'}…`;
    if (live) live.textContent = calendarApi?.formatCalendarDateTimeFull?.(calendarDeps?.calendar?.day, calendarDeps?.calendar?.time01) || '';
    if (hours) hours.textContent = `${remainingHours} ${remainingHours === 1 ? 'hour' : 'hours'}`;
  }

  async function advanceOnePassageHour(kind) {
    const calendar = calendarDeps?.calendar; // Shared calendar state advanced by exactly one represented hour.
    if (!calendar || !calendarApi?.previewAfterHours) return;
    const startDay = finiteNumber(calendar.day, 1); // Raw simulation day before this passage hour.
    const startTime = finiteNumber(calendar.time01, 0); // Normalized clock position before this passage hour.
    const target = calendarApi.previewAfterHours(1, startDay, startTime); // CalendarSystem's own exact one-hour destination.
    const fromHour = representedHour(startTime); // Continuous starting hour; player-facing getHour() wraps 24:00 to 0:00.
    const toHour = target.day === startDay ? representedHour(target.time01) : fromHour; // Same-raw-day target hour; raw rollover at 06:00 is not a civil midnight.

    if (target.day === startDay && crossesCivilMidnight(fromHour, toHour)) {
      await requestMidnightReview({ source: kind, day: startDay, time01: startTime });
    }

    if (target.day === startDay) {
      calendar.time01 = target.time01;
      return;
    }

    calendar.time01 = startTime + 1 / activeClockHours();
    const timeoutAt = performance.now() + 1800; // Same visible-failure bound used by CalendarSystem's private passage runner.
    while ((finiteNumber(calendar.day, startDay) < target.day || finiteNumber(calendar.time01, 0) >= 1) && performance.now() < timeoutAt) {
      await new Promise(resolve => setTimeout(resolve, 30)); // Condition-wait for game.js's private day-rollover to finish, not genuine per-frame work.
    }
    if (finiteNumber(calendar.day, startDay) < target.day) throw new Error(`day rollover stalled at raw day ${calendar.day}; expected ${target.day}`);
    calendar.time01 = target.time01;
  }

  async function advancePassageHours(kind, totalHours) {
    const hours = Math.max(1, Math.round(finiteNumber(totalHours, 1))); // Selected sleep/wait duration advanced one represented hour at a time.
    let tickDurationMs = PASSAGE_FIRST_TICK_MS; // Current black-screen hold duration shortened after each displayed hour.
    renderPassageTick(kind, hours);
    for (let elapsed = 1; elapsed <= hours; elapsed++) {
      await delayMs(tickDurationMs);
      await advanceOnePassageHour(kind);
      const remaining = hours - elapsed; // Remaining selected hours displayed after this completed tick.
      renderPassageTick(kind, remaining);
      tickDurationMs *= PASSAGE_TICK_DECAY;
    }
  }

  function restorePlayerAfterSleep() {
    const player = window.PlayerSocialPoses?.getPlayerEntity?.(); // Existing player-runtime boundary used by CalendarSystem's own sleep restoration.
    if (!player) return;
    if (Number.isFinite(player.maxHealth)) player.health = player.maxHealth;
    if (Number.isFinite(player.maxStamina)) player.stamina = player.maxStamina;
  }

  function persistCalendarSnapshot() {
    const activeWorldId = window.__hobunjiPlayerProfile?.worldId; // Active save-world id whose calendar snapshot is updated after a custom passage run.
    if (!activeWorldId || !calendarDeps?.calendar) return;
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null'); // Existing save metadata preserved except for the active world's calendar fields.
      const world = (meta?.worlds || []).find(entry => entry.id === activeWorldId); // Active world record receiving the advanced clock state.
      if (!world) return;
      const calendar = calendarDeps.calendar; // Current authoritative calendar values serialized below.
      world.calendar = {
        day: calendar.day,
        time01: calendar.time01,
        weather: calendar.weather,
        isRaining: calendar.isRaining,
        rainStrength: calendar.rainStrength,
        nextRainWindows: calendar.nextRainWindows,
        lastRainDay: calendar.lastRainDay,
      };
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
    } catch (error) {
      log(`calendar save failed after passage: ${error?.message || error}`, 'warn');
    }
  }

  function releaseCalendarPassageFallback() {
    const locks = window.CharacterActionLocks?.getDebug?.() || []; // Active lock records searched only if the normal Cancel cleanup button is unavailable.
    for (const lock of locks) if (lock?.owner === 'calendar-time-passage') window.CharacterActionLocks?.release?.(lock.token);
  }

  function closePassageUiFallback() {
    document.querySelector?.('.time-passage-backdrop')?.classList?.remove('open', 'transitioning');
    releaseCalendarPassageFallback();
  }

  async function runReviewAwarePassage(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!calendarApi || !calendarDeps?.calendar) return;
    const debug = calendarApi.timeDebugSnapshot?.() || {}; // Existing modal state supplies the selected sleep/wait kind and duration.
    const kind = debug.modalKind === 'sleep' ? 'sleep' : debug.modalKind === 'wait' ? 'wait' : null; // Active passage kind required before taking over Confirm.
    if (!kind) return;
    const slider = document.getElementById('timePassageSlider'); // Existing duration input remains the single source of truth for selected hours.
    const selectedHours = Math.max(1, Math.round(finiteNumber(slider?.value ?? debug.selectedHours, 1))); // Current selected duration captured before transition begins.
    const confirm = document.getElementById('timePassageConfirm'); // Existing Confirm button disabled during the review-aware passage run.
    const cancel = document.getElementById('timePassageCancel'); // Existing Cancel listener reused afterward for private timer/lock cleanup.
    const backdrop = document.querySelector?.('.time-passage-backdrop'); // Existing passage modal switched into its normal transitioning presentation.
    if (confirm?.dataset.dayProgressReviewRunning === '1') return;
    if (confirm) {
      confirm.dataset.dayProgressReviewRunning = '1';
      confirm.disabled = true;
    }
    backdrop?.classList?.add('transitioning');

    try {
      await calendarApi.runScreenTransition?.(async () => {
        await advancePassageHours(kind, selectedHours);
        if (kind === 'sleep') restorePlayerAfterSleep();
        persistCalendarSnapshot();
        window.WeatherFX?.updateRainState?.();
        window.dispatchEvent?.(new CustomEvent('hobunji-time-passage', {
          detail: { kind, hours: selectedHours, day: calendarDeps.calendar.day, time01: calendarDeps.calendar.time01 },
        }));
      });
      log(`${kind} advanced ${selectedHours}h with midnight review gate`);
    } catch (error) {
      log(`${kind} passage failed: ${error?.message || error}`, 'error');
    } finally {
      if (confirm) {
        delete confirm.dataset.dayProgressReviewRunning;
        confirm.disabled = false;
      }
      if (cancel) cancel.click();
      else closePassageUiFallback();
    }
  }

  function installPassageConfirmGate() {
    const confirm = document.getElementById('timePassageConfirm'); // Existing CalendarSystem button intercepted in capture phase before its private listener.
    if (!confirm || confirm.dataset.dayProgressReviewGate === '1') return false;
    confirm.dataset.dayProgressReviewGate = '1';
    confirm.addEventListener('click', runReviewAwarePassage, true);
    log('sleep/wait confirm gate installed');
    return true;
  }

  function patchCalendarSystem(api) {
    if (!api || api.__dayProgressReviewPatched || typeof api.init !== 'function') return api;
    const originalInit = api.init; // Existing CalendarSystem initialization preserved before review hooks are installed.
    api.init = function dayProgressReviewCalendarInit(injectedDeps, ...args) {
      const result = originalInit.call(this, injectedDeps, ...args);
      calendarApi = api;
      calendarDeps = injectedDeps;
      const reportedScale = finiteNumber(api.timeDebugSnapshot?.()?.naturalClockScale, 1); // Existing CalendarSystem multiplier cached once so the natural setter stays cheap every frame.
      calendarNaturalWriteScale = reportedScale > 0 ? reportedScale : 1;
      loadState();
      syncLedgerDay();
      installNaturalMidnightGate(injectedDeps?.calendar);
      installPassageConfirmGate();
      installDebugButton();
      return result;
    };
    api.__dayProgressReviewPatched = true;
    calendarApi = api;
    return api;
  }

  function relationshipRate() {
    const authored = window.SCRATCHBONES_CONFIG?.game?.socialRelationships?.rapportToFavorRate; // Same authored rate used by NpcRapport.settle at midnight.
    const rate = finiteNumber(authored, 0.10); // Default kept in sync with npc-social-relationship-bridge-v2.js.
    return Math.max(0, rate);
  }

  function rapportConversion(rapport, rate = relationshipRate()) {
    return Math.round(Math.max(0, finiteNumber(rapport, 0)) * Math.max(0, finiteNumber(rate, 0)));
  }

  function npcDisplayName(npcId) {
    const id = String(npcId || ''); // Stable relationship id resolved to a live authored display name when possible.
    const walkers = window.__hobunjiFurnitureDebug?.getNpcWalkers?.() || []; // Existing live-walker debug seam works without desktop devtools.
    const walker = Array.isArray(walkers) ? walkers.find(entry => String(entry?.rec?.id || '') === id) : null; // Current live NPC record preferred for player-facing name.
    if (walker?.rec?.name) return String(walker.rec.name);
    const candidateCollections = [window.NPC_DB, window.NPC_DATABASE, window.npcDatabase, window.npcRecords]; // Common authored NPC registries checked without coupling to one private game.js symbol.
    for (const collection of candidateCollections) {
      const record = Array.isArray(collection)
        ? collection.find(entry => String(entry?.id || '') === id)
        : collection?.[id]; // Matching authored record used when an NPC is not currently spawned.
      if (record?.name) return String(record.name);
    }
    return id.split(/[_-]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || 'Unknown NPC';
  }

  function currentRelationshipSnapshot(npcId) {
    const relationship = window.DialogueContent?.getNpcDlgState?.(npcId); // Pre-midnight state read while the old social day is still active.
    return {
      favor: finiteNumber(relationship?.favor, 0),
      rapport: Math.max(0, finiteNumber(relationship?.rapport, 0)),
    };
  }

  function aggregateRows(bucket) {
    return Object.values(bucket || {})
      .filter(row => finiteNumber(row?.amount, 0) > 0)
      .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')))
      .map(row => ({ label: String(row.label || 'Gain'), amount: finiteNumber(row.amount, 0), sampleText: String(row.sampleText || '') }));
  }

  function buildReviewSnapshot(meta = {}) {
    const reviewState = ensureStateForRecording(); // Current-day ledger frozen into a display snapshot before midnight mutates relationships.
    flushPersist();
    const ledger = JSON.parse(JSON.stringify(reviewState.ledger)); // Immutable copy prevents later reward events from changing an open review.
    const rate = relationshipRate(); // Actual authored Rapport→Favor conversion rate shown and used for preview math.
    const relationships = Object.values(ledger.relationships || {})
      .filter(entry => finiteNumber(entry?.favorDelta, 0) || finiteNumber(entry?.rapportDelta, 0))
      .map(entry => {
        const current = currentRelationshipSnapshot(entry.npcId); // Live pre-midnight totals used for exact upcoming conversion visualization.
        const conversion = rapportConversion(current.rapport, rate); // Same Math.round formula NpcRapport.settle uses after midnight.
        return {
          npcId: String(entry.npcId || ''),
          name: npcDisplayName(entry.npcId),
          favorDelta: finiteNumber(entry.favorDelta, 0),
          rapportDelta: finiteNumber(entry.rapportDelta, 0),
          favorBeforeConversion: current.favor,
          rapportBeforeConversion: current.rapport,
          conversion,
          favorAfterConversion: current.favor + conversion,
          conversionRate: rate,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      dayKey: reviewState.dayKey,
      source: String(meta.source || 'midnight'),
      dateLabel: calendarApi?.formatCalendarDateFull?.() || `Day ${civilOrdinal()}`,
      nextDateLabel: calendarApi?.formatCalendarDateFull?.(rawDay() + 1) || `Day ${civilOrdinal() + 1}`,
      currency: {
        money: finiteNumber(ledger.currency?.money, 0),
        motes: finiteNumber(ledger.currency?.motes, 0),
        other: aggregateRows(ledger.currency?.other),
      },
      masteryXp: aggregateRows(ledger.masteryXp),
      skillXp: aggregateRows(ledger.skillXp),
      petXp: aggregateRows(ledger.petXp),
      relationships,
      items: aggregateRows(ledger.items),
    };
  }

  function injectReviewStyles() {
    if (document.getElementById(REVIEW_STYLE_ID)) return;
    const style = document.createElement('style'); // All review layout/animation rules kept with the module instead of expanding global CSS.
    style.id = REVIEW_STYLE_ID;
    style.textContent = `
      #${REVIEW_ROOT_ID}{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;padding:14px;background:rgba(5,6,8,.96);color:#f5efe2;font-family:"KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace;text-shadow:0 2px 3px rgba(0,0,0,.9);overflow:auto;overscroll-behavior:contain}
      #${REVIEW_ROOT_ID}.open{display:flex}
      .day-review-panel{width:min(760px,96vw);max-height:94vh;overflow:auto;padding:24px 22px 20px;border:1px solid rgba(230,207,157,.28);background:linear-gradient(180deg,rgba(26,24,21,.94),rgba(11,11,12,.96));box-shadow:0 18px 70px rgba(0,0,0,.58)}
      .day-review-kicker{text-align:center;font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.68}
      .day-review-title{text-align:center;margin:6px 0 3px;font-size:clamp(30px,8vw,54px);font-weight:400;line-height:1}
      .day-review-date{text-align:center;font-size:clamp(12px,3vw,15px);opacity:.78;margin-bottom:20px}
      .day-review-section{margin:18px 0 0}
      .day-review-section-title{font-size:clamp(16px,4vw,21px);font-weight:400;border-bottom:1px solid rgba(230,207,157,.22);padding-bottom:6px;margin-bottom:8px;letter-spacing:.04em}
      .day-review-row,.day-review-card,.day-review-section-title{transition:opacity .28s ease,transform .28s cubic-bezier(.2,.75,.2,1);opacity:1;transform:translateY(0)}
      .day-review-pending{opacity:0;transform:translateY(10px)}
      .day-review-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;min-height:34px;padding:5px 4px;font-size:clamp(13px,3.4vw,16px)}
      .day-review-value{font-variant-numeric:tabular-nums;font-weight:700}
      .day-review-money{color:#f0c96f}.day-review-motes{color:#bca6ff}.day-review-mastery{color:#87c8ff}.day-review-skill{color:#9de08a}.day-review-pet{color:#f2a7db}.day-review-item{color:#eee4cf}
      .day-review-empty{opacity:.48;font-style:italic}
      .day-review-card{padding:10px 12px;margin:8px 0;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.025)}
      .day-review-person{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:clamp(15px,4vw,19px)}
      .day-review-deltas{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;font-size:13px}
      .day-review-favor{color:#ff9bc8}.day-review-rapport{color:#ffd84d}.day-review-positive{color:#70df83}.day-review-negative{color:#ff7777}
      .day-review-conversion{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.07);transition:opacity .3s ease,transform .3s ease}
      .day-review-orb{min-width:72px;text-align:center;font-size:12px;line-height:1.2}
      .day-review-orb strong{display:block;font-size:19px}
      .day-review-flow{position:relative;height:8px;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.06)}
      .day-review-flow::before{content:'••••••';position:absolute;left:-35%;top:-8px;letter-spacing:8px;color:#ffd84d;font-size:18px;white-space:nowrap;opacity:.85}
      .day-review-conversion.revealed .day-review-flow::before{animation:dayReviewFlow 1.1s ease-in-out 1 forwards}
      .day-review-formula{grid-column:1/-1;text-align:center;font-size:12px;opacity:.72;margin-top:2px}
      .day-review-actions{display:flex;justify-content:center;margin-top:22px}
      .day-review-continue{min-width:min(280px,80vw);min-height:46px;border:1px solid rgba(230,207,157,.5);background:rgba(111,84,45,.8);color:#fff;font:400 18px "KhymeryyanRomanLetters+Numbers","DM Mono",monospace;cursor:pointer;opacity:0;pointer-events:none;transform:translateY(8px);transition:opacity .25s ease,transform .25s ease}
      .day-review-continue.ready{opacity:1;pointer-events:auto;transform:translateY(0)}
      .day-review-hint{text-align:center;margin-top:8px;font-size:11px;opacity:.42;min-height:1em}
      @keyframes dayReviewFlow{0%{left:-35%;opacity:.25}65%{left:52%;opacity:1}100%{left:105%;opacity:.2}}
      @media(max-width:520px){.day-review-panel{padding:19px 14px 16px}.day-review-person{align-items:flex-start;flex-direction:column}.day-review-deltas{justify-content:flex-start}.day-review-conversion{grid-template-columns:78px 1fr 78px}}
      @media(prefers-reduced-motion:reduce){.day-review-row,.day-review-card,.day-review-section-title,.day-review-continue{transition-duration:.06s}.day-review-conversion.revealed .day-review-flow::before{animation-duration:.12s}}
    `;
    document.head.appendChild(style);
  }

  function ensureReviewUi() {
    injectReviewStyles();
    let root = document.getElementById(REVIEW_ROOT_ID); // Reused modal root created on the first midnight review.
    if (root) return root;
    root = document.createElement('div');
    root.id = REVIEW_ROOT_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Day progress review');
    root.innerHTML = `
      <div class="day-review-panel">
        <div class="day-review-kicker">Day Complete</div>
        <h2 class="day-review-title">Progress Review</h2>
        <div class="day-review-date" id="dayReviewDate"></div>
        <div id="dayReviewContent"></div>
        <div class="day-review-actions"><button class="day-review-continue" id="dayReviewContinue" type="button">Continue</button></div>
        <div class="day-review-hint" id="dayReviewHint">Tap to reveal all</div>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener('pointerdown', event => {
      if (event.target?.closest?.('#dayReviewContinue')) return;
      if (activeReviewPromise && !document.getElementById('dayReviewContinue')?.classList.contains('ready')) fastForwardReveal = true;
    });
    root.addEventListener('keydown', event => {
      if (!activeReviewPromise) return;
      if ((event.key === 'Enter' || event.key === ' ') && !document.getElementById('dayReviewContinue')?.classList.contains('ready')) {
        event.preventDefault();
        fastForwardReveal = true;
      }
    });
    document.getElementById('dayReviewContinue')?.addEventListener('click', finishActiveReview);
    return root;
  }

  function gainRows(snapshot) {
    const rows = []; // Ordered Currency/XP rows revealed dramatically one at a time.
    if (snapshot.currency.money > 0) rows.push({ label: 'Money', value: `+${formatNumber(snapshot.currency.money)}g`, className: 'day-review-money' });
    if (snapshot.currency.motes > 0) rows.push({ label: 'Motes of Prowess', value: `+${formatNumber(snapshot.currency.motes)}`, className: 'day-review-motes' });
    for (const row of snapshot.currency.other) rows.push({ label: row.label, value: `+${formatNumber(row.amount)}`, className: 'day-review-money' });
    for (const row of snapshot.masteryXp) rows.push({ label: row.label, value: `+${formatNumber(row.amount)}`, className: 'day-review-mastery' });
    for (const row of snapshot.skillXp) rows.push({ label: row.label, value: `+${formatNumber(row.amount)}`, className: 'day-review-skill' });
    for (const row of snapshot.petXp) rows.push({ label: row.label, value: `+${formatNumber(row.amount)}`, className: 'day-review-pet' });
    return rows;
  }

  function htmlEscape(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function relationshipDeltaHtml(label, value, valueClass) {
    const delta = roundedDisplayNumber(value); // Net daily relationship delta rendered only when non-zero.
    if (!delta) return '';
    const directionClass = delta > 0 ? 'day-review-positive' : 'day-review-negative'; // Green/red direction color independent of Favor/Rapport value color.
    return `<span class="${valueClass}">${htmlEscape(label)} <b class="${directionClass}">${htmlEscape(signedNumber(delta))}</b></span>`;
  }

  function sectionHtml(title, bodyHtml) {
    return `<section class="day-review-section"><h3 class="day-review-section-title day-review-pending">${htmlEscape(title)}</h3>${bodyHtml}</section>`;
  }

  function buildReviewHtml(snapshot) {
    const gains = gainRows(snapshot); // Currency/mastery/skill/pet rows shown in the first section.
    const gainHtml = gains.length
      ? gains.map(row => `<div class="day-review-row day-review-pending"><span>${htmlEscape(row.label)}</span><span class="day-review-value ${row.className}">${htmlEscape(row.value)}</span></div>`).join('')
      : '<div class="day-review-row day-review-empty day-review-pending"><span>No currency or experience gained</span><span>—</span></div>';

    const relationshipHtml = snapshot.relationships.length
      ? snapshot.relationships.map(entry => {
          const favorDelta = relationshipDeltaHtml('Favor', entry.favorDelta, 'day-review-favor'); // Direct permanent Favor change for this NPC.
          const rapportDelta = relationshipDeltaHtml('Rapport', entry.rapportDelta, 'day-review-rapport'); // Net temporary Rapport change for this NPC.
          const deltas = [favorDelta, rapportDelta].filter(Boolean).join(''); // Compact row of every relationship value that actually changed.
          const percent = Math.round(entry.conversionRate * 1000) / 10; // Authored conversion rate rendered as a readable percentage.
          const conversion = entry.rapportBeforeConversion > 0
            ? `<div class="day-review-conversion day-review-pending" data-day-review-conversion>
                <span class="day-review-orb day-review-rapport"><strong>${htmlEscape(formatNumber(entry.rapportBeforeConversion))}</strong>Rapport</span>
                <span class="day-review-flow" aria-hidden="true"></span>
                <span class="day-review-orb day-review-favor"><strong>+${htmlEscape(formatNumber(entry.conversion))}</strong>Favor</span>
                <span class="day-review-formula">${htmlEscape(formatNumber(entry.rapportBeforeConversion))} Rapport × ${htmlEscape(formatNumber(percent))}% → +${htmlEscape(formatNumber(entry.conversion))} Favor</span>
              </div>`
            : '';
          return `<article class="day-review-card day-review-pending"><div class="day-review-person"><strong>${htmlEscape(entry.name)}</strong><span class="day-review-deltas">${deltas || '<span class="day-review-empty">No net change</span>'}</span></div>${conversion}</article>`;
        }).join('')
      : '<div class="day-review-row day-review-empty day-review-pending"><span>No Favor or Rapport changes</span><span>—</span></div>';

    const itemHtml = snapshot.items.length
      ? snapshot.items.map(row => `<div class="day-review-row day-review-pending"><span class="day-review-item">${htmlEscape(row.label)}</span><span class="day-review-value">+${htmlEscape(formatNumber(row.amount))}</span></div>`).join('')
      : '<div class="day-review-row day-review-empty day-review-pending"><span>No items received</span><span>—</span></div>';

    return [
      sectionHtml('Currency & Experience', gainHtml),
      sectionHtml('Relationships', relationshipHtml),
      sectionHtml('Received Items', itemHtml),
    ].join('');
  }

  function revealDelay() {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; // Accessibility preference shortens staged pauses without removing ordering.
    return reduced ? 45 : 310;
  }

  async function revealReview(snapshot) {
    const generation = ++revealGeneration; // Token invalidated if another review/fast cleanup supersedes this reveal loop.
    const root = ensureReviewUi(); // Active full-screen review containing all pending reveal elements.
    const date = document.getElementById('dayReviewDate'); // Date line identifies the day whose progress is being closed out.
    const content = document.getElementById('dayReviewContent'); // Section host replaced with this review's frozen snapshot.
    const continueButton = document.getElementById('dayReviewContinue'); // Hidden until every staged element has been revealed.
    const hint = document.getElementById('dayReviewHint'); // Touch-friendly fast-forward hint hidden once reveal completes.
    if (date) date.textContent = snapshot.dateLabel;
    if (content) content.innerHTML = buildReviewHtml(snapshot);
    if (continueButton) continueButton.classList.remove('ready');
    if (hint) hint.textContent = 'Tap to reveal all';
    fastForwardReveal = false;
    root.classList.add('open');
    root.tabIndex = -1;
    root.focus({ preventScroll: true });

    const revealables = [...root.querySelectorAll('.day-review-pending')]; // Section titles, rows, cards, and conversion lines revealed in DOM order.
    for (const element of revealables) {
      if (generation !== revealGeneration) return;
      element.classList.remove('day-review-pending');
      if (element.matches?.('[data-day-review-conversion]')) {
        element.classList.add('revealed');
        if (!fastForwardReveal) await delayMs(revealDelay() * 1.8);
      } else if (!fastForwardReveal) {
        await delayMs(revealDelay());
      }
    }

    if (generation !== revealGeneration) return;
    continueButton?.classList.add('ready');
    if (hint) hint.textContent = '';
    continueButton?.focus?.({ preventScroll: true });
  }

  function acquireReviewLock() {
    if (activeReviewLock) return;
    activeReviewLock = window.CharacterActionLocks?.acquire?.({
      owner: 'day-progress-review',
      reason: 'midnight day progress review',
      participants: [PLAYER_ACTION_LOCK_ID],
      channels: ['movement', 'tools', 'actions'],
    }) || null;
  }

  function releaseReviewLock() {
    activeReviewLock?.release?.();
    activeReviewLock = null;
  }

  function finishActiveReview() {
    if (!activeReviewPromise || !document.getElementById('dayReviewContinue')?.classList.contains('ready')) return;
    const completedDayKey = state?.dayKey || currentDayKey(); // Civil day marked reviewed so the next natural frame is allowed across midnight exactly once.
    if (state) state.reviewedDayKey = activeReviewMarksDay ? completedDayKey : activeReviewPreviousReviewedDayKey;
    flushPersist();
    revealGeneration += 1;
    document.getElementById(REVIEW_ROOT_ID)?.classList.remove('open');
    releaseReviewLock();
    const resolve = activeReviewResolve; // Captured resolver released after active-state fields are cleared.
    activeReviewResolve = null;
    activeReviewPromise = null;
    activeReviewMarksDay = true;
    activeReviewPreviousReviewedDayKey = null;
    resolve?.(true);
  }

  function showSnapshot(snapshot, options = {}) {
    if (activeReviewPromise) return activeReviewPromise;
    activeReviewMarksDay = options.markReviewed !== false;
    activeReviewPreviousReviewedDayKey = state?.reviewedDayKey ?? null;
    acquireReviewLock();
    activeReviewPromise = new Promise(resolve => { activeReviewResolve = resolve; });
    revealReview(snapshot).catch(error => {
      log(`review reveal failed: ${error?.message || error}`, 'error');
      fastForwardReveal = true;
      document.querySelectorAll?.(`#${REVIEW_ROOT_ID} .day-review-pending`).forEach(element => element.classList.remove('day-review-pending'));
      document.getElementById('dayReviewContinue')?.classList.add('ready');
    });
    return activeReviewPromise;
  }

  function requestMidnightReview(meta = {}) {
    loadState();
    syncLedgerDay();
    const dayKey = currentDayKey(); // Civil day being closed out by this midnight boundary.
    if (state.reviewedDayKey === dayKey) return Promise.resolve(false);
    if (activeReviewPromise) return activeReviewPromise;
    const snapshot = buildReviewSnapshot(meta); // Frozen pre-midnight totals and relationship conversion values shown to the player.
    log(`opening ${meta.source || 'midnight'} review for ${snapshot.dateLabel}`);
    return showSnapshot(snapshot);
  }

  function sampleSnapshot() {
    return {
      dayKey: 'debug-sample',
      source: 'debug',
      dateLabel: 'Debug Sample — Day Progress Review',
      nextDateLabel: 'Tomorrow',
      currency: { money: 428, motes: 7, other: [] },
      masteryXp: [{ label: 'Hatchet Mastery', amount: 3 }],
      skillXp: [{ label: 'Farming XP', amount: 24 }, { label: 'Fishing XP', amount: 11 }],
      petXp: [{ label: 'Brindle Mount XP', amount: 9 }, { label: 'Miri Shoulder Pet XP', amount: 4 }],
      relationships: [
        { npcId: 'debug_friend', name: 'Example Friend', favorDelta: 2, rapportDelta: 18, favorBeforeConversion: 4, rapportBeforeConversion: 37, conversion: 4, favorAfterConversion: 8, conversionRate: 0.10 },
        { npcId: 'debug_rival', name: 'Example Rival', favorDelta: -1, rapportDelta: -6, favorBeforeConversion: 1, rapportBeforeConversion: 8, conversion: 1, favorAfterConversion: 2, conversionRate: 0.10 },
      ],
      items: [{ label: 'Pine Log', amount: 12 }, { label: 'Cloudberry', amount: 3 }, { label: 'Old Combat Manual', amount: 1 }],
    };
  }

  function showSampleReview() {
    if (activeReviewPromise) return activeReviewPromise;
    loadState();
    return showSnapshot(sampleSnapshot(), { markReviewed: false });
  }

  function resetLedger() {
    state = defaultState();
    flushPersist();
    log('daily review ledger reset');
    return debugSnapshot();
  }

  function debugSnapshot() {
    loadState();
    return {
      version: 1,
      installed: true,
      changeSummary: CHANGE_SUMMARY,
      worldId: worldId(),
      rawDay: rawDay(),
      civilOrdinal: civilOrdinal(),
      representedHour: representedHour(),
      wrappedDisplayHour: finiteNumber(calendarApi?.getHour?.(), NaN),
      currentDayKey: currentDayKey(),
      ledgerDayKey: state?.dayKey || null,
      reviewedDayKey: state?.reviewedDayKey || null,
      blocking: !!activeReviewPromise,
      naturalGateInstalled: !!calendarDeps?.calendar?.__dayProgressReviewTimeGate,
      passageGateInstalled: document.getElementById('timePassageConfirm')?.dataset?.dayProgressReviewGate === '1',
      ledger: state ? JSON.parse(JSON.stringify(state.ledger)) : null,
    };
  }

  function installDebugButton() {
    if (document.getElementById(DEBUG_BUTTON_ID)) return true;
    const panel = document.getElementById(DEBUG_PANEL_ID); // Existing Settings-gated Dev Tools panel used for mobile testing without a console.
    if (!panel) return false;
    const button = document.createElement('button'); // One-tap sample review trigger appended without modifying the dev panel's source module.
    button.id = DEBUG_BUTTON_ID;
    button.type = 'button';
    button.textContent = '🌙 Test Day Review';
    button.title = 'Show a sample midnight progress review without changing the real daily ledger.';
    button.style.cssText = 'margin:8px 0;min-height:40px;padding:7px 10px;border:1px solid rgba(220,200,155,.45);border-radius:8px;background:rgba(48,40,30,.75);color:#fff;font:inherit;cursor:pointer;';
    button.addEventListener('click', () => showSampleReview());
    panel.appendChild(button);
    return true;
  }

  function observeDebugPanel() {
    if (installDebugButton() || debugObserver || typeof MutationObserver !== 'function') return;
    debugObserver = new MutationObserver(() => {
      if (!installDebugButton()) return;
      debugObserver.disconnect();
      debugObserver = null;
    });
    debugObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  hookGlobal('WorldPopupText', patchWorldPopupText);
  hookGlobal('DialogueContent', patchDialogueContent);
  hookGlobal('CalendarSystem', patchCalendarSystem);
  observeDebugPanel();
  window.addEventListener?.('pagehide', flushPersist);
  window.addEventListener?.('beforeunload', flushPersist);

  window.DayProgressReview = Object.freeze({
    version: 1,
    requestMidnightReview,
    shouldPauseNaturalMidnight,
    isBlocking: () => !!activeReviewPromise,
    debugSnapshot,
    showSampleReview,
    resetLedger,
    _test: Object.freeze({ parseRewardText, rewardBucket, representedHour, crossesCivilMidnight, rapportConversion }),
  });
  window.__dayProgressReviewDebug = Object.freeze({ snapshot: debugSnapshot, showCurrent: () => showSnapshot(buildReviewSnapshot({ source: 'debug-current' }), { markReviewed: false }), showSample: showSampleReview, reset: resetLedger });
})();