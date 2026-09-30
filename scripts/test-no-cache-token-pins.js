#!/usr/bin/env node
'use strict';

// Tests must not pin an exact ?v=<token> cache-bust string.
//
// Every edit to a docs/ module bumps its token (see scripts/check-cache-busts.js),
// so a test that asserts one exact `foo.js?v=<token>` string breaks the moment any
// later PR touches foo.js, even though nothing it tests changed. That produced
// hundreds of "Refresh … cache regression" / "Stop pinning … cache token" commits.
//
// To assert that a module is loaded, match any token instead:
//   assert.match(index, /music-system\.js\?v=[A-Za-z0-9_-]+/);
//
// The files below predate this check and are grandfathered at their current
// count. The count may only go down: unpin one and lower (or delete) its entry.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GRANDFATHERED = {
  'test-ambient-greeting-head-turn.js': 2,
  'test-animal-chathead-framing.js': 1,
  'test-animal-shoulder-rest.js': 5,
  'test-animation-author-portrait-anchor-integration.js': 1,
  'test-attachment-rig-latest-authored-snapshot.js': 2,
  'test-attack-animation-editor-history-grips.js': 1,
  'test-banubu-questline.js': 1,
  'test-blackout-travel-and-item-action.js': 1,
  'test-character-rig-scale.js': 3,
  'test-character-view-mode.js': 2,
  'test-clothing-weaving-system.js': 4,
  'test-cloud-forest-fog-depth.js': 2,
  'test-combat-reticle-visibility.js': 2,
  'test-contextual-potion-selector.js': 2,
  'test-controller-experience.js': 2,
  'test-controller-input-authority.js': 2,
  'test-controller-modern-flow-bridge.js': 1,
  'test-crop-billboard-presentation.js': 3,
  'test-crop-sprite-art.js': 1,
  'test-dev-random-ruin-integration.js': 10,
  'test-dialogue-syllable-cadence.js': 1,
  'test-drenkirra-vertical-aim.js': 1,
  'test-enemy-target-facing.js': 1,
  'test-entry-tunnel-door-furniture.js': 1,
  'test-entry-tunnel-wall-unmark.js': 1,
  'test-environment-surface-runtime.js': 1,
  'test-farm-menu-layout.js': 2,
  'test-foliage-furniture-wilderness.js': 1,
  'test-force-tothal-shift-regeneration.js': 1,
  'test-furniture-tankan-decals.js': 2,
  'test-harlyao-liches.js': 9,
  'test-harlyao-skeleton-species.js': 9,
  'test-harlyao-species.js': 2,
  'test-hat-xray-facing.js': 1,
  'test-held-seed-desktop-capture.js': 1,
  'test-house-pieces-registry-stability.js': 1,
  'test-interior-furniture-grid.js': 2,
  'test-inventory-character-effects.js': 3,
  'test-kurraya-transport-audio-sync.js': 3,
  'test-livestock-dialogue-modular.js': 1,
  'test-livestock-harvest-staging.js': 1,
  'test-merged-water-renderer.js': 2,
  'test-minion-enemies.js': 6,
  'test-music-system.js': 6,
  'test-music-track-gain-settings.js': 2,
  'test-named-animal-npc-species.js': 1,
  'test-natural-surface-loader-cache.js': 1,
  'test-netlify-cloud-save-static-preview.js': 1,
  'test-no-black-game-text.js': 1,
  'test-npc-held-equipment.js': 1,
  'test-onboarding-character-creation-handoff.js': 3,
  'test-onboarding-character-creation-life-preview.js': 1,
  'test-onboarding-character-creation-redesign.js': 1,
  'test-onboarding-character-creation-weapon-view-fix.js': 1,
  'test-onboarding-random-name.js': 1,
  'test-onboarding-switchbox-placement.js': 1,
  'test-onboarding-viewport-fit.js': 1,
  'test-porakaneki-camp-placement-policy.js': 1,
  'test-porakaneki-camp.js': 2,
  'test-porakaneki-map-markers.js': 1,
  'test-porakaneki-species.js': 2,
  'test-ranged-camera-focus.js': 1,
  'test-ranged-weapon-archetypes.js': 3,
  'test-ranged-weapons.js': 3,
  'test-reticle-hitbox-lunge-stop.js': 4,
  'test-rounded-pauldron.js': 1,
  'test-runtime-frame-scheduler.js': 1,
  'test-sleep-passage-action-bridge.js': 1,
  'test-spearhead-bounty-existing-posting.js': 2,
  'test-stable-animal-training-refinements.js': 3,
  'test-startup-asset-path-regressions.js': 2,
  'test-target-outline-alpha-cutout.js': 1,
  'test-trust-dialogue-heart-scale.js': 1,
  'test-wilderness-cliff-surface-parity.js': 2,
  'test-wilderness-map-load-recovery.js': 2,
};

// Built from pieces so this file doesn't match itself.
const PIN = new RegExp('\\?v' + '=[A-Za-z0-9]', 'g');

const failures = [];
for (const name of fs.readdirSync(__dirname).filter(n => /^test-.*\.js$/.test(n)).sort()) {
  const count = (fs.readFileSync(path.join(__dirname, name), 'utf8').match(PIN) || []).length;
  const allowed = GRANDFATHERED[name] || 0;
  if (count > allowed) {
    failures.push(`${name}: ${count} exact ?v= token pin(s)${allowed ? ` (grandfathered at ${allowed})` : ''}`);
  }
}

assert.deepEqual(failures, [], 'Match any cache token (e.g. /foo\\.js\\?v=[A-Za-z0-9_-]+/) instead of pinning one:\n  ' + failures.join('\n  '));
console.log('ok: no new exact cache-token pins in scripts/test-*.js');
