// Authored quests and temporary training state. No borrowed unlock or loadout is saved.
(() => {
  'use strict';
  const content = window.CombatTutorialContent; // Shared lesson definitions used by routing, Tasks, and diagnostics.
  let deps = null; // Live game closures injected once by game.js.
  let session = null; // Ephemeral loan, actor, resources, and practice state; deliberately excluded from saves.
  let panel = null; // Compact help/exit controls; all lesson instructions live in NPC dialogue.
  let bypassChat = false; // Lets one ordinary Spearhead conversation pass through the provider.
  let busy = false; // Serializes scene changes and prevents double-clicked quest/reward actions.
  let lastError = ''; // Visible diagnostic text retained after failed setup.
  let diagnosticsOpen = false; // Survives objective redraws so mobile diagnostics stay readable.

  function now() { return performance.now(); }
  function state(id) { return deps?.getQuestProgress?.()?.[id] || null; }
  function definition(id) { return content.quests.find(quest => quest.id === id); }
  function step() { return session?.quest.steps[session.index] || null; }
  function active() { return !!session && deps?.getArea() === content.ARENA; }
  function gate(quest) {
    if (quest.requires && state(quest.requires)?.status !== 'completed') return `Complete ${definition(quest.requires)?.title || quest.requires}`;
    if (quest.combat > (window.SkillSystem?.level?.('combat') || 0)) return `Combat level ${quest.combat}`;
    if (quest.mastery || quest.rangedMastery) {
      return window.CombatTutorialMastery.gate(quest, deps);
    }
    return '';
  }
  function saveProgress() {
    if (!session || session.replay) return;
    const saved = state(session.quest.id); // The same object read by TasksPanel and the member save path.
    saved.step = session.index;
    saved.progress.objective = step() ? `${session.index + 1}/${session.quest.steps.length}: ${step().title}` : 'Choose your training reward from Spearhead.';
    saved.progress.ready = !step();
    deps.save();
  }
  function tree(id, nodes, entryNode = 'start') { return { id, name: id, trigger: 'interact', priority: 100, entryNode, nodes }; }
  function textNode(id, text, next) { return { id, type: 'text', text, next }; }
  function action(operation, extra = {}) { return { type: 'combatTutorial', operation, ...extra }; }
  function controlHint(action) {
    const device = window.ActionPromptUI?.getLastInputDevice?.() || 'desktop'; // Touch buttons are already labelled on screen.
    if (device === 'touch') return '';
    const code = window.InputBindings?.getCurrentBindings?.()?.[device]?.[action];
    return code ? window.InputBindings.buttonLabel(code) : '';
  }
  function withControls(text) {
    const labelled = new Set(); // Only the first mention of each control gains its live key, keeping the prose readable.
    return String(text || '').replace(/\b(Weapon Action ([12])|(?<!Blink )Dodge)\b(?! \()/g, (match, _name, number) => {
      const action = number ? `action${number}` : 'dodge';
      if (labelled.has(action)) return match;
      labelled.add(action);
      const hint = controlHint(action); // Follows the player's rebinding and last-used device.
      return hint ? `${match} (${hint})` : match;
    });
  }
  function lessonText(lesson) {
    if (!lesson) return '';
    return withControls(lesson.text);
  }
  function abilityName(id) { return window.Combat?.abilities?.get?.(id)?.label || id; }
  function lessonPrefix() {
    const reason = session.reminder; // Why Spearhead is repeating the card: asked, idle, or a specific coaching line.
    if (reason === 'asked') return 'Of course. ';
    if (reason === 'idle') return 'Take your time. Once more: ';
    if (reason) return `${reason} Once more: `;
    if (session.resumed) return 'Welcome back. We will pick up where we left off. ';
    return session.index > 0 ? 'Well done. ' : '';
  }
  function selectTree() {
    if (bypassChat) { bypassChat = false; return null; }
    if (active()) {
      const lesson = step(); // Current authored explanation always uses the real dialogue and cinematic camera.
      if (!lesson) return rewardTree();
      if (session.phase === 'practice') { // The player walked up and talked mid-exercise: pause sparring and answer as a request.
        session.reminder = 'asked';
        session.phase = 'explain';
        stopActions();
        deps.pauseTarget?.(session.target);
      }
      return tree('spearhead_lesson', [textNode('start', `${lessonPrefix()}${lessonText(lesson)}`, 'practice'), { id: 'practice', type: 'end', combatTutorialPractice: true }]);
    }
    const offered = content.quests.filter(quest => { // Each Mastery family offers only its next rank, so locked future ranks do not bury the lessons a player can take.
      const family = quest.mastery ? 'mastery' : quest.rangedMastery ? 'rangedMastery' : null;
      if (!family) return true;
      const ranks = content.quests.filter(other => other[family]);
      return quest === (ranks.find(other => state(other.id)?.status !== 'completed') || ranks.at(-1));
    });
    const perPage = offered.length <= 5 ? 5 : 4; // Six dialogue choices: lessons, optional More lessons, and normal conversation.
    const nodes = [];
    for (let page = 0; page * perPage < offered.length; page++) {
      const choices = offered.slice(page * perPage, page * perPage + perPage).map(quest => {
        const locked = gate(quest); // Checked again on accept, never trusted from the rendered menu.
        return { disabled: !!locked, label: `${quest.title.replace('Spearhead — ', '')}${locked ? ' — ' + locked : state(quest.id)?.status === 'completed' ? ' — Practice again' : state(quest.id)?.status === 'active' ? ' — Resume' : ' — Begin'}`, actions: [action('start', { questId: quest.id })] };
      });
      if ((page + 1) * perPage < offered.length) choices.push({ label: 'More lessons', next: `page${page + 1}` });
      choices.push({ label: 'Talk about something else', actions: [action('chat')] });
      nodes.push({ id: page === 0 ? 'start' : `page${page}`, type: 'choice', text: 'There is a practice arena beneath the watchhouse. I can take you down and lend you what each lesson needs. Your first lesson needs no combat experience. What shall we work on?', choices });
    }
    return tree('spearhead_training_menu', nodes);
  }
  function rewardTree() {
    const tried = [...session.tried].filter(id => window.TechniqueScrolls?.manualForAbility?.(id)); // Only genuinely completed technique exercises can award an ability.
    const unknown = tried.filter(id => !window.TechniqueScrolls.isUnlocked(id)); // Never replace a known technique with a duplicate reward.
    const choices = session.replay || !unknown.length
      ? [{ label: 'Finish training', actions: [action('finish')] }]
      : unknown.map(id => {
        const kind = { quickAttack: 'Quick Attack', offensiveHold: 'Offensive Hold', defensiveHold: 'Defensive Hold' }[window.Combat.abilities.get(id)?.category]; // Reminds the player which Loadout slot the permanent pick fills.
        return { label: `Learn ${abilityName(id)}${kind ? ` (${kind})` : ''}`, actions: [action('reward', { abilityId: id })] };
      });
    return tree('spearhead_training_reward', [{ id: 'start', type: 'choice', text: session.replay ? 'Good practice. You have already received this lesson’s reward.' : unknown.length ? 'You have tried these techniques. Pick one to keep. The other techniques and borrowed weapons stay here.' : session.quest.mastery || session.quest.rangedMastery ? 'Good work. When you have decided, open the Loadout to choose your upgrade. Your own equipment is ready upstairs.' : 'Well done. You already know every technique practiced here. Your own equipment is ready upstairs.', choices }]);
  }
  function stopActions() {
    window.Combat?.input?.abortAllPresses?.();
    window.Combat?.cancelAllStaged?.();
    window.RangedWeapons?.cancelPlayerAction?.();
  }
  // questId may also be a quest object from another system -- e.g.
  // CombatTutorialContent.masteryQuestTemplate(rank) for a Mastery comparison
  // session (the generated trials from combat-tutorial-mastery.js) that is no
  // longer listed in Spearhead's own lesson menu.
  async function start(questId, walker) {
    let quest = questId && typeof questId === 'object' ? questId : definition(questId); // Validated authored quest, not arbitrary dialogue data.
    if (!deps || busy || session || !quest) return false;
    if (!window.TechniqueScrolls?.unlockAbility || quest.steps.some(lesson => lesson.ability && !window.Combat?.abilities?.get?.(lesson.ability))) { deps.toast('Combat techniques are still loading. Please try again.', false); return false; }
    const locked = gate(quest); // Prevents stale dialogue buttons bypassing a level/prerequisite gate.
    if (locked) { deps.toast(locked, false); return false; }
    if (!walker?.root) { deps.toast('Spearhead is not ready. Talk to him again.', false); return false; }
    busy = true;
    try {
      if (quest.mastery || quest.rangedMastery) quest = window.CombatTutorialMastery.build(quest, deps);
      deps.closeDialogue();
      stopActions();
      session = { quest, index: 0, hits: 0, phase: 'loading', lastProgressAt: now(), lastTickAt: now(), wrongHits: 0, ammo: { specialAmmo: 8, rangedAmmoLoadouts: {}, unlockedSpecialAmmo: ['shrapnel', 'concussive'] }, replay: state(quest.id)?.status === 'completed', tried: new Set(), original: deps.capture(), walker, actor: { area: walker.area, c: walker.root.position.x - 0.5, r: walker.root.position.z - 0.5, pause: walker.pause }, target: null };
      session.ammoBaseline = JSON.parse(JSON.stringify(deps.getGear()?.rangedAmmoLoadouts?.[quest.weapon] || { basicEffects: {}, specialSlots: {}, activeAmmo: 'basic' })); // Private preview copy; permanent ammunition selections never change.
      // Resume at the saved card. Earlier verified exercises retain reward eligibility across reloads.
      if (!session.replay) {
        const previous = state(quest.id); // Unfinished sessions resume without persisting any temporary gear.
        session.index = quest.signature && quest.signature !== previous?.progress?.trainingSignature ? 0 : Math.max(0, Math.min(quest.steps.length, Math.trunc(Number(previous?.step) || 0)));
        for (const lesson of quest.steps.slice(0, session.index)) if (lesson.ability) session.tried.add(lesson.ability);
        deps.getQuestProgress()[quest.id] = { status: 'active', step: session.index, progress: { trainingSignature: quest.signature || null, kind: 'story', provider: 'spearhead', npcId: content.NPC_ID, npcName: 'Spearhead', title: quest.title, icon: '⚔', detail: 'Practice beneath the watchhouse. Talk to Spearhead to resume after leaving.', hidden: false } };
        saveProgress();
      }
      const starting = session; // Owns scene travel and the async humanoid build through cancellation.
      await deps.enterArena();
      if (session !== starting) return false;
      walker.transferToArea(content.ARENA, { c: 8, r: 14 });
      walker.pause = Infinity;
      const target = await deps.spawnTarget(); // Oddclaw remains present throughout the sequential lesson.
      if (session !== starting || deps.getArea() !== content.ARENA) {
        if (target) deps.removeTarget(target);
        if (session === starting) await leave(false);
        return false;
      }
      if (!target) throw new Error('Oddclaw could not join the practice.');
      session.target = target;
      prepareStep();
      session.resumed = session.index > 0 && !session.replay; // Greets a returning player once instead of congratulating a step they did not just finish.
      await deps.openDialogue(walker);
      return true;
    } catch (error) {
      lastError = error?.message || String(error);
      await leave(false);
      deps.toast(`Training could not start: ${lastError}`, false);
      return false;
    } finally { busy = false; render(); }
  }
  function prepareStep() {
    stopActions();
    deps.pauseTarget?.(session.target);
    window.CombatProgression?.endPreview?.(session.previewHandle);
    session.previewHandle = null;
    session.hits = 0;
    session.phase = 'explain';
    session.reminder = false;
    session.resumed = false;
    session.feedback = '';
    session.lastProgressAt = now();
    session.lastTickAt = now();
    session.wrongHits = 0;
    const lesson = step(); // An absent card means all practice is complete and the reward is pending.
    if (lesson) {
      deps.resetPractice(lesson.startGap ?? (['hit', 'quickBonus', 'block'].includes(lesson.check) ? 1.2 : 2)); // Melee starts within reach instead of making new players guess they must close the gap.
      deps.equip(lesson.weapon || 'hatchet', lesson.equipSlot || (lesson.check === 'rangedHit' ? 'ranged' : 'weapon'));
      applyPreview(lesson);
      deps.resetTarget?.(session.target, lesson);
    }
    saveProgress();
    render();
  }
  function applyPreview(lesson) {
    const preview = lesson.preview; // Each generated stage describes the same live upgrade option it explains.
    if (!preview) return;
    if (preview.kind === 'melee') {
      session.previewHandle = window.CombatProgression.beginPreview(lesson.weapon, preview.ability, preview.rank, preview.index, { demonstration: preview.demonstration === true });
      if (!session.previewHandle) throw new Error('This weapon no longer qualifies for the upgrade preview.');
    } else {
      const ammo = JSON.parse(JSON.stringify(session.ammoBaseline)); // Earlier saved choices form the baseline for each ammunition trial.
      ammo.basicEffects ||= {}; ammo.specialSlots ||= {};
      if (preview.kind === 'basicAmmo') { ammo.basicEffects[preview.rank] = preview.optionId; ammo.activeAmmo = 'basic'; }
      else { ammo.specialSlots[preview.rank] = preview.optionId; ammo.activeAmmo = preview.optionId; }
      session.ammo.rangedAmmoLoadouts[lesson.weapon] = ammo;
      session.ammo.specialAmmo = 8;
    }
  }
  function onNode(node, context) {
    if (context.ended || !active() || !node?.combatTutorialPractice) return;
    beginPractice();
  }
  function beginPractice() {
    session.phase = 'practice';
    session.reminder = false;
    const lesson = step(); // Reassert the lesson's slot after dialogue or a manual weapon switch.
    if (lesson) deps.equip(lesson.weapon || 'hatchet', lesson.equipSlot || (lesson.check === 'rangedHit' ? 'ranged' : 'weapon'));
    if (lesson && lesson.check !== 'read') deps.faceTarget?.(session.target);
    session.walker.pause = Infinity;
    session.lastProgressAt = now();
    session.lastTickAt = now();
    session.wrongHits = 0;
    session.feedback = '';
    if (step()?.check === 'read') session.hits = 1;
    render();
  }
  function observe(kind, details = {}) {
    if (!active() || session.phase !== 'practice' || deps.dialogueOpen()) return false;
    const lesson = step(); // Events are emitted only at successful combat/defense commit points.
    if (!lesson || lesson.check !== kind || session.hits >= (lesson.count || 1)) return false;
    if (session.quest.weapon && deps.equipment[session.quest.family] !== session.quest.weapon) return false;
    if (lesson.preview && kind === 'rangedHit' && details.ammoId !== (lesson.preview.kind === 'specialAmmo' ? lesson.preview.optionId : 'basic')) return false;
    if (details.target && details.target !== session.target) return false;
    if (lesson.ability && details.abilityId && lesson.ability !== details.abilityId) return false;
    if (['hit', 'quickBonus', 'rangedHit'].includes(kind) && !details.target) return false;
    session.hits = Math.min(lesson.count || 1, session.hits + 1);
    session.lastProgressAt = now();
    session.wrongHits = 0;
    session.feedback = '';
    render();
    return true;
  }
  function hit(target, options = {}) {
    if (target !== session?.target) return;
    const before = session.hits; // Wrong attacks inform coaching without awarding progress.
    if (options.ranged) observe('rangedHit', { target, ammoId: options.ammoId });
    else if (options.abilityId) {
      observe('hit', { target, abilityId: options.abilityId });
      if (options.conditionBonusUsed) observe('quickBonus', { target, abilityId: options.abilityId });
    }
    if (active() && session.phase === 'practice' && !deps.dialogueOpen() && session.hits === before && session.hits < (step()?.count || 1)) {
      session.wrongHits++;
      session.feedback = coaching(step(), options);
      render();
    }
  }
  function coaching(lesson, options) {
    // Names what went wrong so repeated misses teach instead of only restarting the card.
    if (!lesson) return '';
    if (options.ranged) return lesson.check === 'rangedHit' ? 'Fire the previewed ammunition for this exercise.' : 'This exercise does not use your ranged weapon.';
    if (!lesson.ability) return lesson.check === 'dodge' ? 'No need to attack here. Just dodge.' : '';
    if (options.abilityId && options.abilityId !== lesson.ability) return `That was ${abilityName(options.abilityId)}. This exercise needs ${abilityName(lesson.ability)}.`;
    if (lesson.check === 'quickBonus') return `The ${abilityName(lesson.ability)} landed, but without its bonus. ${lesson.hint || ''}`.trim();
    if (lesson.check === 'block' || lesson.check === 'blink') return `No need to attack here. ${abilityName(lesson.ability)} is a defensive technique.`;
    return '';
  }
  async function next() {
    if (busy || !active() || !step() || session.phase !== 'practice' || session.hits < (step()?.count || 1)) return false;
    busy = true;
    try {
      if (step().ability) session.tried.add(step().ability);
      session.index++;
      prepareStep();
      await deps.openDialogue(session.walker);
      return true;
    } catch (error) { lastError = error.message; await leave(true); deps.toast(lastError, false); return false; }
    finally { busy = false; render(); }
  }
  async function finish(abilityId = null) {
    if (!active() || step() || busy) return false;
    if (abilityId && (!session.tried.has(abilityId) || !window.TechniqueScrolls?.manualForAbility?.(abilityId))) return false;
    const unknown = [...session.tried].filter(id => window.TechniqueScrolls?.manualForAbility?.(id) && !window.TechniqueScrolls.isUnlocked(id)); // Finish cannot skip an unclaimed choice through stale dialogue actions.
    if (!session.replay && unknown.length && !unknown.includes(abilityId)) return false;
    busy = true;
    try {
      if (!session.replay) {
        if (abilityId && !window.TechniqueScrolls.unlockAbility(abilityId, session.quest.title)) return false;
        const saved = state(session.quest.id); // Reward and completion share the canonical quest and technique persistence paths.
        saved.status = 'completed'; saved.reward = abilityId; saved.progress.hidden = true;
        deps.save();
      }
      await leave(true);
      return true;
    } finally { busy = false; render(); }
  }
  async function leave(returnUpstairs = true) {
    const ending = session; // Kept locally until cleanup has restored all temporary state.
    if (!ending) { if (returnUpstairs) await deps.exitArena(); return; }
    ending.phase = 'leaving';
    window.CombatProgression?.endPreview?.(ending.previewHandle);
    deps.closeDialogue();
    stopActions();
    if (ending.target) deps.removeTarget(ending.target);
    ending.walker.transferToArea(ending.actor.area, { c: ending.actor.c, r: ending.actor.r });
    ending.walker.pause = ending.actor.pause;
    deps.restore(ending.original);
    session = null;
    render();
    if (returnUpstairs && deps.getArea() === content.ARENA) await deps.exitArena();
  }
  function slotOverride(slot) {
    if (!active() || !step()) return undefined;
    // Empty loan slots stay empty even if the player changes their real Loadout during training.
    if (slot === 'tap1') return undefined;
    return step().slot === slot ? step().ability : null;
  }
  async function explainAgain(reason = 'asked') {
    if (busy || !active()) return;
    busy = true;
    session.reminder = reason;
    session.phase = 'explain';
    session.lastProgressAt = now();
    stopActions();
    deps.pauseTarget?.(session.target);
    try { await deps.openDialogue(session.walker); }
    catch (error) { lastError = error.message; }
    finally { busy = false; render(); }
  }
  function render() {
    if (typeof document === 'undefined' || !deps) return;
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'combatTutorialPanel';
      panel.setAttribute('aria-label', 'Training controls');
      panel.style.cssText = 'position:fixed;right:12px;top:84px;z-index:130;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:min(340px,90vw);';
      document.body.appendChild(panel);
      panel.addEventListener('pointerdown', event => event.stopPropagation());
      panel.addEventListener('pointerup', event => event.stopPropagation());
      panel.addEventListener('click', event => {
        const operation = event.target.closest('button')?.dataset.operation; // Touch controls never require a separate progression button.
        if (operation === 'listen') void explainAgain('asked'); // With no card left this reopens the reward choice.
        else if (operation === 'leave' && !busy) { busy = true; void leave(true).finally(() => { busy = false; render(); }); }
        else if (operation === 'debug') { diagnosticsOpen = !diagnosticsOpen; panel.dataset.key = ''; render(); }
      });
    }
    const visible = deps.getArea() === content.ARENA && !deps.dialogueOpen(); // Only dialogue presents lesson text.
    panel.hidden = !visible;
    panel.style.display = visible ? 'flex' : 'none';
    if (!visible) return;
    const key = objectiveKey(); // Skips DOM rebuilds when nothing the player can see has changed.
    if (panel.dataset.key === key) return;
    panel.dataset.key = key;
    const menu = document.getElementById('menuBtn')?.getBoundingClientRect?.(); // Sit just below the main menu button instead of covering it.
    if (menu?.bottom > 0) panel.style.top = `${Math.round(menu.bottom + 8)}px`;
    panel.replaceChildren();
    const card = objectiveCard();
    if (card) panel.append(card);
    const controls = session ? [['listen', 'Ask Spearhead'], ['leave', 'End training'], ['debug', 'Diagnostics']] : [['leave', 'Return upstairs']]; // Mobile help and exit remain accessible during practice.
    for (const [operation, label] of controls) {
      const button = document.createElement('button'); // Shared compact buttons, with comfortable touch targets.
      button.type = 'button'; button.textContent = label; button.dataset.operation = operation;
      button.style.cssText = operation === 'debug' ? 'min-height:40px;padding:6px 8px;font-size:11px;opacity:0.7;' : 'min-height:40px;padding:6px 10px;';
      button.disabled = busy;
      panel.append(button);
    }
    const output = document.createElement('pre'); // Opt-in diagnostics replace console-only troubleshooting on mobile.
    output.hidden = !diagnosticsOpen; output.textContent = diagnosticsOpen ? diagnosticsText() : ''; output.style.cssText = 'white-space:pre-wrap;font-size:11px;user-select:text;background:#16201e;color:white;padding:8px;'; panel.append(output);
  }
  function objectiveKey() {
    return JSON.stringify([!!session, busy, session?.quest.id, session?.index, session?.hits, session?.phase, session?.feedback, controlHint('action1'), controlHint('action2'), controlHint('dodge')]);
  }
  function objectiveCard() {
    // Compact reminder of the current exercise; the full explanation stays in Spearhead's dialogue.
    if (!session || session.phase === 'loading' || session.phase === 'leaving') return null;
    const lesson = step();
    const card = document.createElement('div');
    card.className = 'combat-tutorial-objective';
    card.style.cssText = 'flex:1 0 100%;box-sizing:border-box;max-width:320px;margin-left:auto;padding:8px 10px;border-radius:8px;background:rgba(14,30,22,0.88);border:1px solid rgba(255,255,255,0.22);color:#f4efe1;font-size:13px;line-height:1.35;text-align:left;';
    const line = (text, css) => { const el = document.createElement('div'); el.textContent = text; if (css) el.style.cssText = css; card.append(el); return el; };
    line(`${session.quest.title.replace('Spearhead — ', '')} · ${lesson ? `${session.index + 1}/${session.quest.steps.length}` : 'complete'}`, 'font-size:11px;opacity:0.75;');
    if (!lesson) {
      line('All exercises done', 'font-weight:bold;color:#a5e894;');
      line('Talk to Spearhead to finish.');
      return card;
    }
    line(lesson.title, 'font-weight:bold;color:#ffe394;');
    const count = lesson.count || 1;
    if (lesson.check === 'read') { line('Listen to Spearhead.'); return card; }
    if (session.hits >= count) { line('✓ Done!', 'font-weight:bold;color:#a5e894;'); return card; }
    if (lesson.goal) line(withControls(lesson.goal));
    if (count > 1) line(`${'●'.repeat(session.hits)}${'○'.repeat(count - session.hits)}  ${session.hits}/${count}`, 'letter-spacing:2px;color:#a5e894;');
    if (session.feedback) line(session.feedback, 'color:#ffbb88;');
    return card;
  }
  function update() {
    if (!deps) return;
    if (session && session.phase !== 'loading' && deps.getArea() !== content.ARENA && session.phase !== 'leaving') { void leave(false); return; }
    if (active()) {
      const tick = now(); // Shared game-loop clock; background tabs and dialogue do not consume coaching time.
      const elapsed = Math.max(0, tick - (session.lastTickAt || tick)); // Used to exclude pauses from the no-progress threshold.
      session.lastTickAt = tick;
      if (deps.dialogueOpen() || document.hidden || elapsed > 2000) session.lastProgressAt += elapsed;
      if (!busy && !deps.dialogueOpen() && !document.hidden && step()) {
        if (session.phase === 'practice' && session.hits >= (step().count || 1) && tick - session.lastProgressAt >= (step()?.preview ? 2500 : 700)) void next();
        else if (session.phase === 'practice' && session.wrongHits >= 4 && tick - session.lastProgressAt >= 8000) void explainAgain(session.feedback || 'Not quite.');
        else if (session.phase === 'practice' && tick - session.lastProgressAt >= 45000) void explainAgain('idle');
        // Closing the explanation early starts the exercise instead of reopening it; the objective card keeps the goal on screen.
        else if (session.phase === 'explain' && tick - session.lastProgressAt >= 1500) beginPractice();
      }
      session.walker.pause = Infinity;
      if (session.target) {
        session.target.combatTutorialHostile = !!step()?.hostile && session.phase === 'practice' && !deps.dialogueOpen(); // Sparring pauses while Spearhead is explaining.
        if (!session.target.combatTutorialHostile) deps.pauseTarget?.(session.target);
        deps.maintainTarget?.(session.target, step());
      }
    }
    const visible = deps.getArea() === content.ARENA && !deps.dialogueOpen(); // Visibility transitions and objective changes redraw; render() skips unchanged content.
    if ((!panel && visible) || (panel && (panel.hidden === visible || (visible && panel.dataset.key !== objectiveKey())))) render();
  }
  function diagnosticsText() {
    return `Spearhead combat tutorial\nQuest: ${session?.quest.id || 'none'}\nStep: ${step()?.id || 'none'}\nPartner: Oddclaw\nPhase: ${session?.phase || 'idle'}\nVerified actions: ${session?.hits || 0}/${step()?.count || 1}\nPreview weapon: ${session?.quest.weapon || 'none'}\nPreview choice: ${step()?.preview ? step().title : 'none'}\nLoan weapon: ${deps?.equipment.weapon || 'none'}\nTried: ${[...(session?.tried || [])].join(', ')}\nLast error: ${lastError || 'none'}\nFeedback: ${session?.feedback || 'none'}\nLatest change: On-screen objective card, live control labels, and specific coaching after missed attempts.`;
  }
  function init(injected) {
    deps = injected;
    window.DialogueContent.registerTreeProvider(content.NPC_ID, selectTree);
    window.DialogueContent.registerNodeEnterHandler(content.NPC_ID, onNode);
    window.DialogueContent.registerActionHandler('combatTutorial', (command, context) => {
      if (command.operation === 'chat') { bypassChat = true; window.DialogueContent.beginNpcConversation(context.npc); }
      else if (command.operation === 'start') void start(command.questId, context.walker || deps.getWalker());
      else if (command.operation === 'reward') void finish(command.abilityId);
      else if (command.operation === 'finish') void finish();
      return { skipNav: true };
    });
  }
  window.CombatTutorial = { init, active, update, observe, hit, start, next, finish, leave, gate, selectTree, onNode, slotOverride, diagnosticsText,
    questState: state, // Read by js/tutorial-unlock-visits.js to skip lessons the player already started.
    originalEquipment: () => session?.original || null,
    loanAmmo: () => active() ? session.ammo : null,
    loanRangedMastery: () => active() ? session.quest.rangedMastery || 1 : null,
    debugSnapshot: () => ({ quest: session?.quest.id || null, step: step()?.id || null, phase: session?.phase || null, hits: session?.hits || 0, weapon: session?.quest.weapon || null, preview: step()?.preview || null, steps: session?.quest.steps || [], tried: [...(session?.tried || [])], lastError }),
  };
})();
