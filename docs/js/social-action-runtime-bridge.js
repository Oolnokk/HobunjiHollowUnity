// Runtime ownership bridge for Social Actions.
//
// The centered wheel is loaded early so it can add input bindings before game.js,
// while the real player leg/composer modules are installed later. This bridge
// records those real rigs as they are created, lets the Social Action wheel claim
// them without constructing duplicates, and makes ordinary stance/hand writers
// yield while a social dance owns the player pose.
(function (global) {
  'use strict';

  if (global.SocialActionRuntimeBridge?.installed) return;

  const REUSE_FLAG = '__hobunjiSocialDanceReuseExistingRig'; // Used only for a no-allocation handoff of the already-attached player rig into SocialActionWheel's private handle sets.
  const PLAYER_ID = 'player'; // Used by the rig-capture wrappers to distinguish the real player from NPC/preview attachments.
  const KURRAYA_ITEM_KEY = 'kurraya'; // Used by the player-only MusicMinigame start guard.
  const WEAPON_IDLE_CHANNEL = 'weapon-idle-stance-body-yaw'; // Suppressed while a social dance owns body orientation.
  const state = {
    playerLegHandle: null,
    playerHandRig: null,
    lastDancing: false,
    lastKurrayaOwned: null,
    claimedDanceKey: null,
    toolHolder: null,
    toolHolderWasVisible: null,
    lastOwnershipReason: 'waiting',
    legFacade: null,
    handFacade: null,
  };

  function socialDebug() {
    try { return global.SocialActionWheel?.getDebug?.() || null; }
    catch (_) { return null; }
  }

  function dancing() {
    return !!socialDebug()?.dancing;
  }

  function danceKey() {
    const dance = socialDebug()?.dancing;
    return dance ? `${dance.style || ''}|${dance.armStyle || ''}` : null;
  }

  function currentPlayerMesh() {
    return global.PlayerBodyTransformComposer?.getPlayerMesh?.() || null;
  }

  function isDescendantOf(node, ancestor) {
    for (let cursor = node; cursor; cursor = cursor.parent) if (cursor === ancestor) return true;
    return false;
  }

  function isPlayerRig(rig) {
    const playerMesh = currentPlayerMesh();
    if (!playerMesh || !rig) return false;
    return isDescendantOf(rig.group, playerMesh) || isDescendantOf(rig.parent, playerMesh);
  }

  function gameDeps() {
    return global.ProceduralHandAttachments?.gameDeps
      || global.Combat?.deps
      || null;
  }

  function inventory() {
    return gameDeps()?.inventory || null;
  }

  function ownsKurraya() {
    return Number(inventory()?.[KURRAYA_ITEM_KEY]) > 0;
  }

  function toast(message, good = true) {
    const showToast = gameDeps()?.showToast;
    if (typeof showToast === 'function') showToast(message, good);
    else global.__farmLog?.(`[Social Actions] ${message}`, good ? 'info' : 'warn');
  }

  function chainGlobal(name, install) {
    const existing = global[name];
    if (existing) {
      install(existing);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
    const previousGet = descriptor?.get;
    const previousSet = descriptor?.set;
    Object.defineProperty(global, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return previousGet ? previousGet.call(global) : stored; },
      set(value) {
        if (previousSet) previousSet.call(global, value);
        else stored = value;
        const resolved = previousGet ? previousGet.call(global) : stored;
        if (resolved) install(resolved);
      },
    });
  }

  function findNamedDescendant(root, matcher) {
    let found = null;
    root?.traverse?.(node => { if (!found && matcher(node)) found = node; });
    return found;
  }

  function discoveredPlayerLegRoot() {
    const playerMesh = currentPlayerMesh();
    return state.playerLegHandle?.group
      || findNamedDescendant(playerMesh, node => /_procedural_feet$/.test(String(node?.name || '')));
  }

  function playerLegFacade() {
    const handle = state.playerLegHandle;
    const group = discoveredPlayerLegRoot();
    if (!group) return null;
    if (!state.legFacade || state.legFacade.group !== group) {
      state.legFacade = {
        group,
        standingPosteriorY: handle?.standingPosteriorY,
        update() {},
        applyRecordedLegPose() {},
        dispose() {},
        getStandingPoseDebug: handle?.getStandingPoseDebug?.bind(handle),
        getSeatedPoseDebug: handle?.getSeatedPoseDebug?.bind(handle),
        __socialDanceReuseFacade: true,
      };
    }
    return state.legFacade;
  }

  function patchLegApi(api) {
    if (!api?.attach || api.attach.__socialRuntimeBridgeWrapped) return;
    const originalAttach = api.attach.bind(api);
    const wrapped = function socialRuntimeLegAttach(THREEArg, parent, options = {}) {
      if (options?.[REUSE_FLAG]) return playerLegFacade();
      const handle = originalAttach(THREEArg, parent, options);
      if (handle && String(options?.name || '').trim().toLowerCase() === PLAYER_ID) state.playerLegHandle = handle;
      return handle;
    };
    wrapped.__socialRuntimeBridgeWrapped = true;
    wrapped.__socialRuntimeBridgeOriginal = originalAttach;
    api.attach = wrapped;
  }

  function guardPlayerHandMethod(rig, methodName, blockedValue) {
    const current = rig?.[methodName];
    if (typeof current !== 'function' || current.__socialDanceOwnershipGuard) return;
    const original = current.bind(rig);
    const guarded = function socialDanceHandOwnershipGuard(...args) {
      if (dancing() && isPlayerRig(rig)) return blockedValue;
      return original(...args);
    };
    guarded.__socialDanceOwnershipGuard = true;
    guarded.__socialDanceOwnershipOriginal = original;
    rig[methodName] = guarded;
  }

  function guardPlayerHandRig(rig) {
    if (!rig || rig.__socialDanceOwnershipGuarded) return rig;
    guardPlayerHandMethod(rig, 'placeHandWorld', false);
    guardPlayerHandMethod(rig, 'setSideIdle', undefined);
    guardPlayerHandMethod(rig, 'useIdlePose', undefined);
    Object.defineProperty(rig, '__socialDanceOwnershipGuarded', { value: true, configurable: true });
    return rig;
  }

  function discoveredPlayerHandGroup() {
    const playerMesh = currentPlayerMesh();
    const left = findNamedDescendant(playerMesh, node => node?.name === 'left_hand_socket');
    const right = findNamedDescendant(playerMesh, node => node?.name === 'right_hand_socket');
    return left?.parent && left.parent === right?.parent ? left.parent : state.playerHandRig?.group || null;
  }

  function playerHandFacade() {
    const rig = state.playerHandRig;
    const group = discoveredPlayerHandGroup();
    if (!group) return null;
    if (!state.handFacade || state.handFacade.group !== group) {
      state.handFacade = {
        group,
        parent: rig?.parent || group.parent,
        avatarRoot: rig?.avatarRoot || null,
        speciesId: rig?.speciesId || null,
        gender: rig?.gender || null,
        placeHandWorld() { return false; },
        setSideIdle() {},
        useIdlePose() {},
        refreshModelProfile() {},
        dispose() {},
        getDebug() { return { mode: 'social-dance-reuse-facade' }; },
        __socialDanceReuseFacade: true,
      };
    }
    return state.handFacade;
  }

  function patchHandApi(api) {
    if (!api?.attach || api.attach.__socialRuntimeBridgeWrapped) return;
    const originalAttach = api.attach.bind(api);
    const wrapped = function socialRuntimeHandAttach(THREEArg, parent, options = {}) {
      if (options?.[REUSE_FLAG]) return playerHandFacade();
      const rig = guardPlayerHandRig(originalAttach(THREEArg, parent, options));
      const name = String(options?.name || '').trim().toLowerCase();
      if (rig && (name === PLAYER_ID || isPlayerRig(rig))) state.playerHandRig = rig;
      return rig;
    };
    wrapped.__socialRuntimeBridgeWrapped = true;
    wrapped.__socialRuntimeBridgeOriginal = originalAttach;
    api.attach = wrapped;
  }

  function patchComposer(api) {
    if (!api?.setChannel || api.setChannel.__socialRuntimeBridgeWrapped) return;
    const originalSetChannel = api.setChannel.bind(api);
    const originalClearChannel = api.clearChannel?.bind(api);
    api.setChannel = function socialRuntimeComposerSetChannel(name, contribution) {
      if (name === WEAPON_IDLE_CHANNEL && dancing()) {
        originalClearChannel?.(WEAPON_IDLE_CHANNEL);
        return false;
      }
      return originalSetChannel(name, contribution);
    };
    api.setChannel.__socialRuntimeBridgeWrapped = true;
    api.setChannel.__socialRuntimeBridgeOriginal = originalSetChannel;
  }

  function patchMusicMinigame(api) {
    if (!api?.beginPlayerSession || api.beginPlayerSession.__socialKurrayaOwnershipGuard) return;
    const originalBegin = api.beginPlayerSession.bind(api);
    api.beginPlayerSession = function ownedKurrayaPlayerSession(...args) {
      if (!ownsKurraya()) {
        toast('You need a Kurraya before you can play one.', false);
        syncKurrayaWedge();
        return false;
      }
      return originalBegin(...args);
    };
    api.beginPlayerSession.__socialKurrayaOwnershipGuard = true;
    api.beginPlayerSession.__socialKurrayaOwnershipOriginal = originalBegin;
  }

  function claimExistingRigsForDance() {
    const dance = socialDebug()?.dancing;
    if (!dance) return false;
    const key = danceKey();
    if (state.claimedDanceKey === key) return true;
    const playerMesh = currentPlayerMesh();
    const THREE = global.THREE;
    if (!playerMesh || !THREE) return false;

    // SocialActionWheel wraps both attach() methods at DOMContentLoaded. Calling
    // through that wrapper with REUSE_FLAG seeds its private handle sets while the
    // bridge's inner wrapper returns a facade over the already-existing rig.
    global.ProceduralLegAnimation?.attach?.(THREE, playerMesh, {
      name: 'social-dance-reuse',
      [REUSE_FLAG]: true,
    });
    global.ProceduralHandAttachments?.attach?.(THREE, playerMesh, {
      name: 'social-dance-reuse',
      [REUSE_FLAG]: true,
    });
    state.claimedDanceKey = key;
    state.lastOwnershipReason = `claimed ${key}`;
    return true;
  }

  function suppressHeldStanceForDance() {
    const composer = global.PlayerBodyTransformComposer;
    composer?.clearChannel?.(WEAPON_IDLE_CHANNEL);
    const holder = gameDeps()?.toolHolder || null;
    if (!holder) return;
    if (state.toolHolder !== holder) {
      state.toolHolder = holder;
      state.toolHolderWasVisible = holder.visible !== false;
    }
    holder.visible = false;
  }

  function restoreHeldStanceAfterDance() {
    if (state.toolHolder && state.toolHolderWasVisible != null) state.toolHolder.visible = !!state.toolHolderWasVisible;
    state.toolHolder = null;
    state.toolHolderWasVisible = null;
    state.claimedDanceKey = null;
  }

  function syncKurrayaWedge() {
    const owned = ownsKurraya();
    state.lastKurrayaOwned = owned;
    const sector = document.querySelector?.('.socialActionSector[data-social-index="0"]');
    if (!sector) return;
    sector.classList.toggle('blocked', !owned);
    sector.setAttribute('aria-disabled', owned ? 'false' : 'true');
    sector.setAttribute('aria-label', owned ? 'Play Kurraya' : 'Play Kurraya — requires a Kurraya');
    const label = sector.querySelector?.('.socialActionLabel');
    if (label) label.style.opacity = owned ? '' : '0.34';
  }

  function injectDebugStyle() {
    if (document.getElementById('socialActionRuntimeBridgeStyle')) return;
    const style = document.createElement('style');
    style.id = 'socialActionRuntimeBridgeStyle';
    style.textContent = '.socialActionSector.blocked.active{background:rgba(255,255,255,.055)!important}.socialActionSector.blocked{filter:grayscale(1)}';
    document.head.appendChild(style);
  }

  function releaseHeldEquipmentAtDanceStart() {
    const deps = gameDeps();
    if (typeof deps?.putAwayHeldEquipment === 'function') {
      deps.putAwayHeldEquipment();
      state.lastOwnershipReason = 'dance put away held equipment';
      return true;
    }
    return false;
  }

  function frame() {
    const nowDancing = dancing();
    if (nowDancing) {
      if (!state.lastDancing) releaseHeldEquipmentAtDanceStart();
      claimExistingRigsForDance();
      suppressHeldStanceForDance();
    } else if (state.lastDancing) {
      restoreHeldStanceAfterDance();
      state.lastOwnershipReason = 'dance released';
    }
    state.lastDancing = nowDancing;
    syncKurrayaWedge();
    global.requestAnimationFrame(frame);
  }

  // Hands are already fully bootstrapped before character-action-locks.js loads,
  // so this becomes the final attach wrapper before game.js creates the player.
  chainGlobal('ProceduralHandAttachments', patchHandApi);
  // Legs/composer/music are assigned later; chain their globals so the capture and
  // guards exist before game.js can create or use the corresponding runtime.
  chainGlobal('ProceduralLegAnimation', patchLegApi);
  chainGlobal('PlayerBodyTransformComposer', patchComposer);
  chainGlobal('MusicMinigame', patchMusicMinigame);

  injectDebugStyle();
  global.SocialActionRuntimeBridge = {
    installed: true,
    ownsKurraya,
    getDebug() {
      return {
        dancing: dancing(),
        kurrayaOwned: ownsKurraya(),
        playerLegCaptured: !!discoveredPlayerLegRoot(),
        playerHandCaptured: !!discoveredPlayerHandGroup(),
        claimedDanceKey: state.claimedDanceKey,
        toolHolderSuppressed: !!state.toolHolder,
        lastOwnershipReason: state.lastOwnershipReason,
      };
    },
  };
  global.requestAnimationFrame(frame);
})(window);
