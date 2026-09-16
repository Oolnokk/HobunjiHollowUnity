(() => {
  'use strict';

  // Keeps wilderness Porakaneki on the same BanditCombat entity path as arena
  // hunters while hardening the asynchronous builder boundary. In particular,
  // an area/scene change while portrait construction is awaiting must not leave
  // a scene-parented PNG avatar with no live hostile entity driving it.
  let deps = null; // Captured BanditCombat dependencies used to pin builds to the requested wilderness zone.

  function isPorakanekiRequest(options) {
    return !!options?.extra?.isPorakanekiHunter;
  }

  function detachEntitySceneObjects(entity) {
    if (!entity) return;
    entity.avatarRef?.group?.parent?.remove?.(entity.avatarRef.group);
    entity.groundShadow?.parent?.remove?.(entity.groundShadow);
    entity._banditToolHolder?.parent?.remove?.(entity._banditToolHolder);
    entity._banditRangedToolHolder?.parent?.remove?.(entity._banditRangedToolHolder);
  }

  function installSceneAwareDispose(entity) {
    const avatarRef = entity?.avatarRef; // Avatar handle whose dispose path is used by stale-build rejection in PorakanekiCamps.
    if (!avatarRef || avatarRef.__porakanekiSceneAwareDispose) return;
    const originalDispose = typeof avatarRef.dispose === 'function' ? avatarRef.dispose.bind(avatarRef) : null; // Existing PNG geometry/material cleanup preserved after scene detachment.
    avatarRef.dispose = function porakanekiSceneAwareDispose() {
      detachEntitySceneObjects(entity);
      originalDispose?.();
    };
    avatarRef.__porakanekiSceneAwareDispose = true;
  }

  function primeNeutralHandoff(entity) {
    if (!entity) return;
    const def = entity.def; // Shared bandit definition temporarily muted until PorakanekiCamps applies its authored neutral speed/target next planner tick.
    if (def) {
      entity._porakanekiAggroRangePx ??= Number(def.aggroRangePx) || 0;
      entity._porakanekiBaseMoveSpeed ??= Number(def.moveSpeed) || 0;
      def.aggroRangePx = 0;
    }
    entity._porakanekiPlannerControlled = true;
    entity.state = 'return';
    entity.homeX = Number.isFinite(entity.x) ? entity.x : 0;
    entity.homeY = Number.isFinite(entity.y) ? entity.y : 0;
    entity._banditAction?.cancel?.();
    entity._banditAction = null;
    entity._rangedAction?.cancel?.();
    entity._rangedAction = null;
    entity._rangedMode = false;
    entity.wanderTarget = { x: entity.homeX, y: entity.homeY };
    entity.wanderT = 9999;
    entity._porakanekiMaterializationReady = true;
  }

  function install(api = window.BanditCombat) {
    if (!api || api.__porakanekiMaterializationGuardInstalled) return !!api?.__porakanekiMaterializationGuardInstalled;
    const originalInit = typeof api.init === 'function' ? api.init.bind(api) : null; // Original dependency injection retained under the guard wrapper.
    const originalMakeEntity = typeof api.makeEntity === 'function' ? api.makeEntity.bind(api) : null; // Shared arena/bandit builder delegated to after zone options are pinned.
    if (!originalMakeEntity) return false;

    if (originalInit) {
      api.init = function porakanekiGuardedBanditInit(injectedDeps) {
        deps = injectedDeps;
        return originalInit(injectedDeps);
      };
    }

    api.makeEntity = async function porakanekiGuardedMakeEntity(...args) {
      const options = args[5] || {}; // Sixth BanditCombat.makeEntity argument carries Porakaneki marker, zone, and build overrides.
      if (!isPorakanekiRequest(options)) return originalMakeEntity(...args);

      const zoneId = String(options.zoneId || ''); // Requested camp zone remains stable even if the player's active area changes while portraits await.
      const zoneRuntime = zoneId ? deps?.zoneScenes?.get?.(zoneId) : null; // Prebuilt zone scene/grid used instead of whatever scene is active after the await.
      const zoneGrid = zoneRuntime?.grid || options.grid || null; // Requested-zone grid passed through to BanditCombat placement and entity metadata.
      const forwardedArgs = [...args]; // Copy preserves every existing builder argument while replacing only the options object below.
      const guardedOptions = { ...options }; // Options clone receives stable scene/grid dimensions without mutating the caller's object.
      if (zoneRuntime?.scene) guardedOptions.scene = zoneRuntime.scene;
      if (zoneGrid) {
        guardedOptions.grid = zoneGrid;
        guardedOptions.rows ??= zoneGrid.length;
        guardedOptions.cols ??= zoneGrid[0]?.length;
      }
      forwardedArgs[5] = guardedOptions;

      const entity = await originalMakeEntity(...forwardedArgs); // Real shared builder still owns roster, PNG avatar, tools, shadow, and combat entity construction.
      if (!entity) return null;
      installSceneAwareDispose(entity);

      const activeAreaAfterBuild = deps?.getCurrentArea?.() || null; // Detects navigation that completed while asynchronous portrait construction was in flight.
      if (zoneId && activeAreaAfterBuild && activeAreaAfterBuild !== zoneId) {
        entity.avatarRef?.dispose?.();
        window.__farmLog?.(`[porakaneki] discarded stale materialization for ${zoneId}; active area is ${activeAreaAfterBuild}.`, 'wildlife');
        return null;
      }

      // PorakanekiCamps publishes the returned entity to hostileObjects before
      // its next 5 Hz planner update. Return it already neutral so the ordinary
      // per-frame hostile loop can never observe the builder's default idle /
      // aggro-capable bandit state during that handoff interval.
      primeNeutralHandoff(entity);
      return entity;
    };

    api.__porakanekiMaterializationGuardInstalled = true;
    return true;
  }

  function watchNamespace(name, installer) {
    if (installer(window[name])) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Existing global descriptor is preserved if BanditCombat is assigned after this bridge loads.
    if (descriptor && !descriptor.configurable) return;
    let assigned = descriptor?.value; // Deferred namespace value reinstalled as a normal writable global once first assigned.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get: () => assigned,
      set(value) {
        assigned = value;
        Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value });
        installer(value);
      },
    });
  }

  window.PorakanekiMaterializationGuard = Object.freeze({ version: 1, install });
  watchNamespace('BanditCombat', install);
})();
