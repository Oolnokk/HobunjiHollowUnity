// Authored quests and temporary training state. No borrowed unlock or loadout is saved.
(() => {
  'use strict';
  const content = window.CombatTutorialContent; // Shared lesson definitions used by routing, Tasks, and diagnostics.
  let deps = null; // Live game closures injected once by game.js.
  let session = null; // Ephemeral loan, actor, resources, and practice state; deliberately excluded from saves.
  let panel = null; // Mobile-friendly practice controls mounted only when needed.
  let bypassChat = false; // Lets one ordinary Spearhead conversation pass through the provider.
  let busy = false; // Serializes scene changes and prevents double-clicked quest/reward actions.
  let lastError = ''; // Visible diagnostic text retained after failed setup.

  function state(id) { return deps?.getQuestProgress?.()?.[id] || null; }
  function definition(id) { return content.quests.find(quest => quest.id === id); }
  function step() { return session?.quest.steps[session.index] || null; }
  function active() { return !!session && deps?.getArea() === content.ARENA; }
  function gate(quest) {
    if (quest.requires && state(quest.requires)?.status !== 'completed') return `Complete ${definition(quest.requires)?.title || quest.requires}`;
    if (quest.combat > (window.SkillSystem?.level?.('combat') || 0)) return `Combat level ${quest.combat}`;
    if (quest.mastery || quest.rangedMastery) {
      const eligible = Object.keys(deps?.getGear()?.tools || {}).filter(key => deps.getGear().tools[key] && deps.toolDefs[key]?.slots?.includes(quest.rangedMastery ? 'ranged' : 'weapon')); // Only owned weapons of the lesson's family qualify.
      if (!eligible.some(key => deps.mastery(key) >= (quest.mastery || quest.rangedMastery))) return `${quest.rangedMastery ? 'Ranged weapon' : 'Melee weapon'} Mastery ${quest.mastery || quest.rangedMastery}`;
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
  function lessonText(lesson) {
    if (!lesson) return '';
    const rank = session?.quest.mastery; // This lesson's newly relevant row, read from the same live progression catalog as Loadout.
    const weaponType = deps.toolDefs[lesson.weapon]?.dmgType || 'sharp'; // Borrowed shape's authored damage family selects the correct row.
    const options = rank && lesson.ability ? window.CombatProgression?.getTree?.(lesson.ability, weaponType)?.[rank - 1] : null; // No copied upgrade numbers to become stale after balancing.
    return lesson.text + (options?.length ? ` At rank ${rank}, this technique offers: ${options.map(option => `${option.label}: ${option.desc}`).join('; ')}.` : '');
  }
  function selectTree() {
    if (bypassChat) { bypassChat = false; return null; }
    if (active()) {
      const lesson = step(); // Current authored explanation always uses the real dialogue and cinematic camera.
      if (!lesson) return rewardTree();
      return tree('spearhead_lesson', [textNode('start', lessonText(lesson), 'practice'), { id: 'practice', type: 'end', combatTutorialPractice: true }]);
    }
    const nodes = []; // Four quests per page leaves room for navigation and normal conversation in the six-choice dialogue UI.
    for (let page = 0; page * 4 < content.quests.length; page++) {
      const choices = content.quests.slice(page * 4, page * 4 + 4).map(quest => {
        const locked = gate(quest); // Checked again on accept, never trusted from the rendered menu.
        return { label: `${quest.title.replace('Spearhead — ', '')}${locked ? ' — ' + locked : state(quest.id)?.status === 'completed' ? ' — Practice again' : state(quest.id)?.status === 'active' ? ' — Resume' : ' — Begin'}`, actions: [action('start', { questId: quest.id })] };
      });
      if ((page + 1) * 4 < content.quests.length) choices.push({ label: 'More lessons', next: `page${page + 1}` });
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
      : unknown.map(id => ({ label: `Learn ${window.Combat.abilities.get(id)?.label || id}`, actions: [action('reward', { abilityId: id })] }));
    return tree('spearhead_training_reward', [{ id: 'start', type: 'choice', text: session.replay ? 'Good practice. You have already received this lesson’s reward.' : unknown.length ? 'You have tried these techniques. Pick one to keep. The other techniques and borrowed weapons stay here.' : 'Well done. You already know every technique practiced here, or this was a weapon lesson. Your own equipment is ready upstairs.', choices }]);
  }
  function stopActions() {
    window.Combat?.input?.abortAllPresses?.();
    window.Combat?.cancelAllStaged?.();
    window.RangedWeapons?.cancelPlayerAction?.();
  }
  async function start(questId, walker) {
    const quest = definition(questId); // Validated authored quest, not arbitrary dialogue data.
    if (!deps || busy || session || !quest) return false;
    if (!window.TechniqueScrolls?.unlockAbility || quest.steps.some(lesson => lesson.ability && !window.Combat?.abilities?.get?.(lesson.ability))) { deps.toast('Combat techniques are still loading. Please try again.', false); return false; }
    const locked = gate(quest); // Prevents stale dialogue buttons bypassing a level/prerequisite gate.
    if (locked) { deps.toast(locked, false); return false; }
    if (!walker?.root) { deps.toast('Spearhead is not ready. Talk to him again.', false); return false; }
    busy = true;
    try {
      deps.closeDialogue();
      stopActions();
      session = { quest, index: 0, hits: 0, phase: 'loading', ammo: { specialAmmo: 8, rangedAmmoLoadouts: {}, unlockedSpecialAmmo: ['shrapnel', 'concussive'] }, replay: state(quest.id)?.status === 'completed', tried: new Set(), original: deps.capture(), walker, actor: { area: walker.area, c: walker.root.position.x - 0.5, r: walker.root.position.z - 0.5, pause: walker.pause }, target: null };
      // Resume at the saved card. Earlier verified exercises retain reward eligibility across reloads.
      if (!session.replay) {
        const previous = state(quest.id); // Unfinished sessions resume without persisting any temporary gear.
        session.index = Math.max(0, Math.min(quest.steps.length, Math.trunc(Number(previous?.step) || 0)));
        for (const lesson of quest.steps.slice(0, session.index)) if (lesson.ability) session.tried.add(lesson.ability);
        deps.getQuestProgress()[quest.id] = { status: 'active', step: session.index, progress: { kind: 'story', provider: 'spearhead', npcId: content.NPC_ID, npcName: 'Spearhead', title: quest.title, icon: '⚔', detail: 'Practice beneath the watchhouse. Talk to Spearhead to resume after leaving.', hidden: false } };
        saveProgress();
      }
      await deps.enterArena();
      walker.transferToArea(content.ARENA, { c: 8, r: 14 });
      walker.pause = Infinity;
      prepareStep();
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
    if (session.target) deps.removeTarget(session.target);
    session.target = null;
    session.hits = 0;
    session.phase = 'explain';
    const lesson = step(); // An absent card means all practice is complete and the reward is pending.
    if (lesson) {
      deps.resetPractice();
      deps.equip(lesson.weapon || 'hatchet');
      if (['hit', 'quickBonus', 'block', 'rangedHit'].includes(lesson.check)) {
        session.target = deps.spawnTarget(lesson);
        if (!session.target) throw new Error('The sparring partner could not be created.');
      }
    }
    saveProgress();
    render();
  }
  function onNode(node, context) {
    if (context.ended || !active() || !node?.combatTutorialPractice) return;
    session.phase = 'practice';
    session.walker.pause = Infinity;
    if (step()?.check === 'read') session.hits = 1;
    render();
  }
  function observe(kind, details = {}) {
    if (!active() || session.phase !== 'practice' || deps.dialogueOpen()) return false;
    const lesson = step(); // Events are emitted only at successful combat/defense commit points.
    if (!lesson || lesson.check !== kind) return false;
    if (details.target && details.target !== session.target) return false;
    if (lesson.ability && details.abilityId && lesson.ability !== details.abilityId) return false;
    if (['hit', 'quickBonus', 'rangedHit'].includes(kind) && !details.target) return false;
    session.hits = Math.min(lesson.count || 1, session.hits + 1);
    render();
    return true;
  }
  function hit(target, options = {}) {
    if (target !== session?.target) return;
    if (options.ranged) observe('rangedHit', { target });
    else if (options.abilityId) {
      observe('hit', { target, abilityId: options.abilityId });
      if (options.conditionBonusUsed) observe('quickBonus', { target, abilityId: options.abilityId });
    }
  }
  async function next() {
    if (busy || !active() || session.phase !== 'practice' || session.hits < (step()?.count || 1)) return false;
    busy = true;
    try {
      if (step().ability) session.tried.add(step().ability);
      session.index++;
      prepareStep();
      await deps.openDialogue(session.walker);
      return true;
    } catch (error) { lastError = error.message; deps.toast(lastError, false); return false; }
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
  function render() {
    if (typeof document === 'undefined' || !deps) return;
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'combatTutorialPanel';
      panel.setAttribute('aria-label', 'Combat training');
      panel.style.cssText = 'position:fixed;left:50%;top:58px;transform:translateX(-50%);width:min(390px,88vw);max-height:35vh;overflow:auto;z-index:130;background:rgba(22,28,29,.94);color:#f6e8c6;border:1px solid #bdab7b;border-radius:10px;padding:10px;font:14px system-ui;box-shadow:0 3px 14px #0008;';
      document.body.appendChild(panel);
      panel.addEventListener('pointerdown', event => event.stopPropagation());
      panel.addEventListener('pointerup', event => event.stopPropagation());
      panel.addEventListener('click', event => {
        const operation = event.target.closest('button')?.dataset.operation; // Delegated controls survive per-step HUD updates.
        if (operation === 'next') void next();
        else if (operation === 'listen' && session && !busy) void deps.openDialogue(session.walker);
        else if (operation === 'leave' && !busy) { busy = true; void leave(true).finally(() => { busy = false; }); }
        else if (operation === 'reset' && session && !busy) { prepareStep(); void deps.openDialogue(session.walker); }
        else if (operation === 'debug') { const output = panel.querySelector('pre'); output.hidden = !output.hidden; output.textContent = diagnosticsText(); }
      });
    }
    const visible = deps.getArea() === content.ARENA && !deps.dialogueOpen(); // Explanations use the existing dialogue instead of overlapping two panels.
    panel.hidden = !visible;
    if (!visible) return;
    const lesson = step(); // Authored strings are assigned with textContent below.
    panel.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = session ? `${session.quest.title} · ${lesson?.title || 'Choose your reward'}` : 'Watchhouse practice arena';
    panel.append(title);
    const description = document.createElement('p');
    description.style.margin = '6px 0';
    description.textContent = session ? lesson ? `${lessonText(lesson)} (${session.hits}/${lesson.count || 1})` : 'Speak to Spearhead to finish this session.' : 'Training resumes by speaking with Spearhead upstairs. Borrowed equipment is never carried over from an earlier visit.';
    panel.append(description);
    const controls = session ? [['listen', lesson ? 'Hear explanation' : 'Choose reward'], ['next', 'Next lesson'], ['reset', 'Retry lesson'], ['leave', 'Leave training'], ['debug', 'Diagnostics']] : [['leave', 'Return upstairs'], ['debug', 'Diagnostics']];
    for (const [operation, label] of controls) {
      const button = document.createElement('button'); // Large touch targets avoid requiring developer tools or keyboard input.
      button.type = 'button'; button.textContent = label; button.dataset.operation = operation;
      button.style.cssText = 'min-height:36px;margin:3px;padding:6px 10px;';
      button.disabled = busy || operation === 'next' && (!lesson || session.phase !== 'practice' || session.hits < (lesson.count || 1)) || operation === 'reset' && !lesson;
      panel.append(button);
    }
    const output = document.createElement('pre');
    output.hidden = true; output.style.cssText = 'white-space:pre-wrap;font-size:11px;user-select:text;'; panel.append(output);
  }
  function update() {
    if (!deps) return;
    if (session && session.phase !== 'loading' && deps.getArea() !== content.ARENA && session.phase !== 'leaving') { void leave(false); return; }
    if (active()) {
      session.walker.pause = Infinity;
      if (session.target) {
        session.target.combatTutorialHostile = !!step()?.hostile && session.phase === 'practice' && !deps.dialogueOpen(); // Sparring pauses while Spearhead is explaining.
        deps.maintainTarget(session.target, step());
      }
    }
    const visible = deps.getArea() === content.ARENA && !deps.dialogueOpen(); // Only visibility transitions redraw; no permanent DOM writes while playing.
    if ((!panel && visible) || (panel && panel.hidden === visible)) render();
  }
  function diagnosticsText() {
    return `Spearhead combat tutorial\nQuest: ${session?.quest.id || 'none'}\nStep: ${step()?.id || 'none'}\nPhase: ${session?.phase || 'idle'}\nVerified actions: ${session?.hits || 0}/${step()?.count || 1}\nLoan weapon: ${deps?.equipment.weapon || 'none'}\nTried: ${[...(session?.tried || [])].join(', ')}\nLast error: ${lastError || 'none'}\nLatest change: Watchhouse arena, level-gated training, temporary equipment and one learned technique per eligible session.`;
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
    originalEquipment: () => session?.original || null,
    loanAmmo: () => active() ? session.ammo : null,
    loanRangedMastery: () => active() ? session.quest.rangedMastery || 1 : null,
    debugSnapshot: () => ({ quest: session?.quest.id || null, step: step()?.id || null, phase: session?.phase || null, hits: session?.hits || 0, tried: [...(session?.tried || [])], lastError }),
  };
})();
