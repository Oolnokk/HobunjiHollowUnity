// Loads authored combat values after the synchronous combat defaults exist.
(() => {
  'use strict';

  const load = window.LocalDBOverrides
    ? window.LocalDBOverrides.loadDatabase('attackValues')
    : fetch('config/combat/attack-values.json?v=20260917charge3').then(response => response.ok ? response.json() : null);

  window.__attackValuesConfigPromise = load.then(config => {
    if (!config) return null;
    window.__attackValuesConfig = config;
    window.Combat?.applyTargetingConfig?.(config.targeting);
    window.Combat?.applyComboConfig?.(config.combo);
    window.Combat?.applyDeathMarkConfig?.(config.deathMark);
    window.Combat?.applyQuickAttackConfig?.(config.quickAttacks);
    window.Combat?.applyChargedBreakerConfig?.(config.chargedBreaker);
    window.Combat?.applyFlurryConfig?.(config.flurry);
    window.Combat?.applyCounterShieldConfig?.(config.counterShield);
    window.Combat?.animalAttacks?.applyConfig?.(config.creatureAttacks);
    window.RangedWeapons?.applyConfig?.(config.rangedWeapons);
    window.EnemyDodge?.applyConfig?.(config.bandit?.enemyDodge);
    window.dispatchEvent(new CustomEvent('hobunji-attack-values-loaded', { detail: config }));
    return config;
  }).catch(() => null);
})();

// Compatibility bootstrap for runtime modules extracted from this loader and
// impact-ragdoll-playback.js. index.html already loads this file at the exact
// parser-blocking point those integrations need: after their core dependencies
// exist, but before game.js constructs the player rig and initializes late
// systems. Keep the bootstrap tiny so each behavior remains independently
// owned/testable. A future index cleanup can replace these entries with normal
// script tags without changing any module API.
(() => {
  'use strict';

  // three.js r128 installs render() as an OWN method on every WebGLRenderer
  // instance. PlayerBodyTransformComposer intentionally hooks the prototype so
  // it can intercept every render pass, which means an untouched r128 instance
  // shadows that hook completely. Make future renderer instances delegate their
  // public render() lookup through the prototype while preserving the original
  // r128 implementation as a private bound function on each instance.
  function makeRendererPrototypeHookable() {
    const OriginalWebGLRenderer = window.THREE?.WebGLRenderer; // Used to construct the real r128 renderer inside the compatibility wrapper.
    if (!OriginalWebGLRenderer || OriginalWebGLRenderer.__hobunjiPrototypeHookable) return;

    const rendererPrototype = OriginalWebGLRenderer.prototype; // Used as the stable hook surface PlayerBodyTransformComposer wraps next.
    const preexistingPrototypeRender = rendererPrototype.render; // Preserved for Three builds that already expose prototype render().

    if (typeof rendererPrototype.render !== 'function') {
      rendererPrototype.render = function hobunjiBaseRendererRender(...args) {
        if (typeof this.__hobunjiBaseRendererRender === 'function') {
          return this.__hobunjiBaseRendererRender(...args);
        }
        return preexistingPrototypeRender?.apply(this, args);
      };
    }

    function HookableWebGLRenderer(...args) {
      const instance = new OriginalWebGLRenderer(...args); // Used as the renderer returned to game.js after its own render() is captured.
      if (Object.prototype.hasOwnProperty.call(instance, 'render') && typeof instance.render === 'function') {
        Object.defineProperty(instance, '__hobunjiBaseRendererRender', {
          configurable: true,
          value: instance.render.bind(instance),
        });
        delete instance.render;
      }
      return instance;
    }

    HookableWebGLRenderer.prototype = rendererPrototype;
    Object.setPrototypeOf(HookableWebGLRenderer, OriginalWebGLRenderer);
    HookableWebGLRenderer.__hobunjiPrototypeHookable = true;
    HookableWebGLRenderer.__hobunjiOriginalWebGLRenderer = OriginalWebGLRenderer;
    window.THREE.WebGLRenderer = HookableWebGLRenderer;
  }

  makeRendererPrototypeHookable();

  const modules = [
    ['js/text-entry-keybind-guard.js?v=20260901a', () => !!window.HobunjiTextInputGuard],
    ['js/controller-modern-flow-bridge.js?v=20260915a', () => Number(window.ControllerModernFlowBridge?.version) >= 1],
    ['js/player-body-transform-composer.js?v=20260910review1', () => !!window.PlayerBodyTransformComposer],
    ['js/player-body-attachment-bridge.js?v=20260918shoulderparity3', () => !!window.PlayerBodyAttachmentBridge],
    ['js/front-hat-head-facing.js?v=20260914nofacing1', () => !!window.HobunjiFrontHatHeadFacing],
    ['js/hat-xray-head-facing.js?v=20260914nofacing1', () => !!window.HobunjiHatXrayHeadFacing],
    ['js/town-player-body-elevation-bridge.js?v=20260810a', () => !!window.HobunjiTownBodyElevationBridge],
    ['js/animal-subtle-elevation-bridge.js?v=20260920furniture1', () => !!window.HobunjiAnimalSubtleElevation],
    ['js/porch-surface-material.js?v=20260905a', () => !!window.HobunjiPorchSurfaceMaterial],
    ['js/drunk-locomotion.js?v=20260924perf1', () => !!window.HobunjiDrunkWalk],
    ['js/crop-sprite-art.js?v=20260915cropscan1', () => !!window.HobunjiCropSpriteArt],
    ['js/heftroot-billboard-bridge.js?v=20260814a', () => !!window.HobunjiHeftrootBillboardBridge],
    ['js/crop-billboard-presentation.js?v=20260924perf1', () => !!window.HobunjiCropBillboardPresentation],
    ['js/crop-ready-presentation.js?v=20260818a', () => !!window.HobunjiCropReadyPresentation],
    ['js/mastery-policy.js?v=20260924levelup1', () => !!window.HobunjiMasteryPolicy],
    ['js/inventory-action-metadata-bridge.js?v=20260813b', () => !!window.HobunjiInventoryActionMetadataBridge],
    ['js/inventory-held-override.js?v=20260918blackstamina1', () => !!window.InventoryHeldOverride],
    ['js/clothing-weaving-system.js?v=20260924outline3', () => Number(window.ClothingWeavingSystem?.version) >= 1],
    ['js/clothing-weight-dodge-policy.js?v=20260913a', () => Number(window.ClothingWeightDodgePolicy?.version) >= 1],
    ['js/inventory-character-effects.js?v=20260915a', () => Number(window.InventoryCharacterEffects?.version) >= 1],
    ['js/inventory-gear-compact-effects.js?v=20260915b', () => Number(window.InventoryGearCompactEffects?.version) >= 2],
    ['js/combat/technique-scrolls.js?v=20260910manuals1', () => !!window.TechniqueScrolls],
    ['js/held-seed-action-bridge.js?v=20260813a', () => !!window.HobunjiHeldSeedActionBridge],
    ['js/held-seed-desktop-capture.js?v=20260814a', () => !!window.HobunjiHeldSeedDesktopCapture],
    ['js/held-item-action-input.js?v=20260910a', () => !!window.HeldItemActionInput],
    ['js/alcohol-gameplay-bridge.js?v=20260918blackstamina1', () => !!window.HobunjiDrunkGameplayBridge],
    ['js/npc-gifting.js?v=20260922wardrobe2', () => !!window.NpcGifting],
    ['js/favor-heart-balance.js?v=20260917points3', () => Number(window.NpcFavorBalance?.version) >= 1],
    ['js/npc-wardrobe.js?v=20260923review2', () => !!window.NpcWardrobe],
    ['js/clothing-weaving-npc-compat.js?v=20260913a', () => Number(window.ClothingWeavingNpcCompat?.version) >= 1],
    ['js/npc-furniture-wardrobe-bridge-v4.js?v=20260904placeholder2', () => Number(window.NpcFurnitureWardrobes?.version) >= 4],
    ['config/npcs/social-relations.js?v=20260904a', () => !!window.HobunjiNpcSocialRelationsConfig],
    ['js/npc-social-relationship-bridge-v2.js?v=20260914favor1', () => !!window.NpcRapport?.eventDriven],
    ['js/generic-hud-icons.js?v=20260915perf1', () => Number(window.HobunjiGenericHudIcons?.version) >= 1],
    ['js/hud-x-control-polish.js?v=20260915a', () => Number(window.HudXControlPolish?.version) >= 1],
    ['js/favor-popup-points-bridge.js?v=20260914b', () => Number(window.FavorPopupPointsBridge?.version) >= 2],
    ['js/sleep-passage-action-bridge.js?v=20260914a', () => Number(window.HobunjiSleepPassageActionBridge?.version) >= 1],
    ['js/day-progress-review.js?v=20260924perf1', () => Number(window.DayProgressReview?.version) >= 1],
    ['js/day-progress-review-relationship-ui.js?v=20260914a', () => Number(window.DayProgressReviewRelationshipUi?.version) >= 1],
    ['js/menu-tab-icon-only.js?v=20260915perf1', () => Number(window.HobunjiMenuTabIcons?.version) >= 1],
    ['js/npc-social-seating-bridge.js?v=20260904a', () => !!window.HobunjiNpcSocialSeating],
    ['js/performance-loop-optimizations.js?v=20260818a', () => !!window.HobunjiPerformanceLoopOptimizations],
    ['js/combat/enemy-target-facing.js?v=20260906a', () => Number(window.EnemyTargetFacing?.version) >= 1],
    ['js/combat/enemy-weapon-stances.js?v=20260903a', () => !!window.EnemyWeaponStances],
    ['js/npc-held-equipment-v4.js?v=20260923guardweapons1', () => Number(window.NpcHeldEquipment?.version) >= 4],
    ['js/combat/ranged-weapon-archetypes.js?v=20260920projectileport1-arcembed1-spearspin3-align1', () => Number(window.HobunjiRangedWeaponArchetypes?.version) >= 14],
    ['js/combat/ranged-camera-ray-authority.js?v=20260909perspectivepoint1', () => Number(window.HobunjiRangedCameraRayAuthority?.version) >= 2],
    ['js/combat/ranged-camera-focus.js?v=20260920rangecameraorbit2', () => Number(window.HobunjiRangedCameraFocus?.version) >= 10],
    ['js/combat/combat-camera-alignment-bridge.js?v=20260917charge3', () => Number(window.HobunjiCombatCameraAlignment?.version) >= 4],
    ['js/combat/ranged-dual-role-anim-style.js?v=20260918throwables1', () => Number(window.HobunjiDualRoleRangedAnimStyle?.version) >= 2],
    ['js/drunk-prone-composition-bridge.js?v=20260812b', () => !!window.HobunjiDrunkProneCompositionBridge],
    ['js/prone-motion-exclusivity.js?v=20260812a', () => !!window.HobunjiProneMotionExclusivity],
    ['js/footing-damage-recovery-bridge.js?v=20260812a', () => !!window.HobunjiFootingDamageRecovery],
    ['js/combat/combat-grehlr-burrow.js?v=20260817a', () => !!window.HobunjiGrehlrBurrow],
    ['js/combat/combat-grehlr-stink.js?v=20260822a', () => !!window.HobunjiGrehlrStink],
    ['js/combat/combat-corroded-health.js?v=20260817a', () => !!window.HobunjiCorrodedHealth],
    ['js/combat/enemy-combat-health-recovery.js?v=20260924combatheal2', () => Number(window.CombatHealthRecoveryPolicy?.version || window.EnemyCombatHealthRecoveryPolicy?.version) >= 2],
    ['js/combat/combat-death-mark.js?v=20260903a', () => !!window.HobunjiDeathMark],
    ['js/combat/combat-drenkirra-pellet.js?v=20260827treecover1', () => !!window.HobunjiDrenkirraPellet],
    ['js/combat/combat-grehlr-drenkirra-followup.js?v=20260826drenkirra1', () => !!window.HobunjiGrehlrDrenkirraFollowup],
    // Den locale runtime is an ordinary sibling module, not a script injected
    // from inside Puktuk registration. Keeping one parser-owned loader prevents
    // den setup from perturbing held-item/stance bootstrap ordering.
    ['js/den-locale-runtime.js?v=20260914c', () => Number(window.DenLocaleRuntime?.version) >= 4],
    ['js/puktuk-den-nest-registration.js?v=20260923review1', () => Number(window.PuktukDenNestRegistration?.version) >= 2],
    ['js/dev-arena-nest-spawner.js?v=20260914a', () => Number(window.DevArenaNestSpawner?.version) >= 1],
    ['js/wildlife-territorial.js?v=20260828animalvoices1', () => !!window.HobunjiTerritorialWildlife],
    ['js/wildlife-drenkirra-grazing.js?v=20260817a', () => !!window.HobunjiDrenkirraGrazing],
    ['js/wildlife-cloud-forest-behavior.js?v=20260829a', () => !!window.HobunjiCloudForestWildlife],
    ['js/wildlife-grehlr-foraging.js?v=20260829a', () => !!window.HobunjiGrehlrForaging],
  ];

  function loadModule(src, alreadyLoaded) {
    if (alreadyLoaded()) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}"></` + 'script>');
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    document.head.appendChild(script);
  }

  for (const [src, alreadyLoaded] of modules) loadModule(src, alreadyLoaded);
})();

