// Resolves which NPC interaction (urgent story, turn-in, favor, shop, or conversation) opens.
// World staging/camera/tool holster remain owned by game.js; this module owns only the entry choice.
(() => {
  'use strict';
  let deps = null; // Injected accessors for store/carpenter station checks and item labels.
  const priorityProviders = new Map(); // Features may request an authored tree before procedural offers and merchant shortcuts.
  let lastDecision = 'none'; // Mobile diagnostics: most recent entry-route selection, without a console.
  let attempts = 0; // Mobile diagnostics: conversations resolved through this module.

  function init(injectedDeps) { deps = injectedDeps; }
  function registerPriorityProvider(id, predicate) {
    if (!id || typeof predicate !== 'function') return false;
    priorityProviders.set(String(id), predicate);
    return true;
  }

  async function route(rec, walker) {
    attempts++;
    const dc = window.DialogueContent;
    if (!dc) return false;
    if (dc.hasQueuedConversationTree?.(rec?.id)) {
      lastDecision = 'queued';
      dc.beginNpcConversation(rec);
      return true;
    }
    for (const [id, predicate] of priorityProviders) {
      let claimed = false;
      try { claimed = predicate(rec) === true; }
      catch (error) { console.warn('[npc-dialogue-router] Priority provider failed:', id, error); }
      if (!claimed) continue;
      lastDecision = 'priority:' + id;
      dc.beginNpcConversation(rec);
      return true;
    }
    // From the original game.js conversation dispatch: preserve the relative order
    // of turn-ins, coaching, fresh requests, favors and station/shop shortcuts.
        if (window.DialogueContent?.hasQueuedConversationTree?.(rec?.id)) { window.DialogueContent.beginNpcConversation(rec); return; }

        // Task turn-in — checked before everything else (including a fresh
        // request/favor ask): if this NPC posted/asked a quest that's now
        // sitting ready in the player's log, offer to hand it over right
        // here rather than piling a new ask on top of an already-completed
        // one.
        const _turnInTask = rec?.id ? window.ProceduralTasks.getTurnInReadyTaskForNpc(rec.id) : null;
        if (_turnInTask) {
          const _commissionPrompt = _turnInTask.commission ? window.NpcCraftingCommissionDelivery?.turnInPrompt?.(_turnInTask) : null; // Crafting jobs carry a real garment/furniture deliverable, not fetch items.
          const _turnInLabel = (_turnInTask.items || []).map(it => `${deps.ITEM_DEFS?.[it.itemKey]?.label || it.itemKey} ×${it.qty}`).join(', '); // Ordinary request/favor items still use their existing labels.
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: _commissionPrompt?.text || 'Ah — did you bring what I asked for?',
            choices: [
              { label: _commissionPrompt?.label || (_turnInLabel ? `Here's your ${_turnInLabel}.` : 'Here is what you asked for.'), actions: [{ type: 'turnInTask', taskId: _turnInTask.id }] },
              { label: 'Not yet.', actions: [] },
            ],
          });
          return;
        }

        if (rec?.id === 'spearhead_unumanuk' && window.CombatTutorial?.active()) {
          window.DialogueContent?.beginNpcConversation(rec); // Resume active coaching unless a finished task was just handed in; never replace training with a new request/favor.
          return;
        }

        // Named quest-givers — replaces the old bulletin board. Once a
        // request has been announced (see ProceduralTasks.
        // maybeRefreshRequestPostings, and the purple ambient greeting/
        // compass '!' that flags it before this point), the first
        // conversation after that proposes the job in the NPC's own voice.
        // Checked ahead of the generic favor ask below since a named
        // quest-giver's own request always takes priority over a random
        // favor roll.
        const _requestOffer = rec?.id ? await window.ProceduralTasks.maybeProposeRequest(rec) : null;
        if (_requestOffer) {
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: _requestOffer.askText,
            choices: [
              { label: "I'll help.", actions: [{ type: 'acceptRequest', taskId: _requestOffer.task.id }] },
              { label: 'Not right now.', actions: [{ type: 'declineRequest', taskId: _requestOffer.task.id }] },
            ],
          });
          return;
        }

        // Trusted-NPC favors — checked ahead of every other fast-path
        // (including the merchant shop shortcuts below, so shopkeepers can
        // ask for favors too, not just villagers with an authored dialogue
        // tree) whenever the NPC currently has, or freshly rolls, a favor to
        // ask — gated by friendship tier. Same synthetic choice-node
        // shortcut the shop fast-paths use. See maybeOfferFavor.
        const _favorTask = window.ProceduralTasks.maybeOfferFavor(rec);
        if (_favorTask) {
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: window.ProceduralTasks.favorAskLine(_favorTask),
            choices: [
              { label: "I'll help.", actions: [{ type: 'acceptFavor', taskId: _favorTask.id }] },
              { label: 'Not right now.', actions: [{ type: 'declineFavor', taskId: _favorTask.id }] },
            ],
          });
          return;
        }

        // These synthetic pre-choice screens are a fast-path shortcut for
        // when the NPC happens to be caught right at their counter — a
        // quicker single-tap route to the shop than navigating their own
        // dialogue tree. They are NOT the reliable path: that fast-path
        // condition (idle, exact station, label match) is easy to miss if
        // the NPC has stepped away or is mid-transition, which is why every
        // shopkeeper below also gets a real "openShop" choice baked into
        // their own dialogueTrees — reachable through ordinary conversation
        // any time, with no station/idle requirement at all.
        if (deps.isGeneralStoreNpcOnDuty?.(walker)) {
          const cfg = deps.generalStoreButtonConfig?.() || {};
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: cfg.shopGreeting || 'What can I do for you?',
            choices: [
              { label: cfg.buyChoiceLabel || 'Buy', actions: [{ type: 'openShop', pool: 'generalStoreWares' }] },
              { label: cfg.chatChoiceLabel || 'Chat', actions: [{ type: 'startChat' }] },
            ],
          });
          return;
        }

        if (deps.isCarpenterNpcOnDuty?.(walker)) {
          const cfg = deps.carpenterButtonConfig?.() || {};
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: cfg.shopGreeting || 'What can I do for you?',
            choices: [
              { label: cfg.buyChoiceLabel || 'Buy', actions: [{ type: 'openShop', pool: 'carpenterBarnPlans' }] },
              { label: cfg.chatChoiceLabel || 'Chat', actions: [{ type: 'startChat' }] },
            ],
          });
          return;
        }

        // Jubmir the traveling trader — unlike the General Store/Carpenter,
        // he isn't tied to a shop counter (he wanders per his schedule), so
        // this choice is offered any time you talk to him at all rather
        // than being station-gated. "Chat" re-enters his normal dialogue
        // tree exactly like the General Store's Chat option does.
        if (rec?.id === 'jubmir') {
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: 'What can I do for you?',
            choices: [
              { label: 'See Wares', actions: [{ type: 'openShop', pool: 'jubmirWares' }] },
              { label: 'Chat', actions: [{ type: 'startChat' }] },
            ],
          });
          return;
        }
    lastDecision = 'ordinary';
    dc.beginNpcConversation(rec);
    return true;
  }

  function debugSnapshot() {
    return { attempts, lastDecision, priorityProviderIds: [...priorityProviders.keys()], initialized: !!deps };
  }
  window.NpcDialogueEntryRouter = Object.freeze({ init, registerPriorityProvider, route, debugSnapshot });
  window.DevCompanion?.registerStateProvider?.('npcDialogueEntryRouter', debugSnapshot);
})();
