// Latest intentional Mao-ao Rig Coordinates edits from the 2026-09-05 export.
//
// IMPORTANT: the source export also contained unrelated/stale values. This file
// is deliberately allowlisted to the only intended rig families from that
// export: Mao-ao left/right hand-shoulder placement and arm length. It must not
// import posterior, perch, portrait, hand/foot scale, full-character scale,
// creature, alias, or any non-Mao-ao changes.
(() => {
  'use strict';

  const VERSION = 'mao-ao-shoulders-2026-09-05-v1'; // Exposed below for diagnostics and stale-cache checks.
  const AUTHORED = Object.freeze({
    'mao-ao::male': Object.freeze({
      leftHandShoulder: Object.freeze({ x: 0.1525554542608865, y: 0.6292184955362587, z: 0 }),
      rightHandShoulder: Object.freeze({ x: -0.22929652083051758, y: 0.6455541403639915, z: 0 }),
      armLengthHeightPercentOffset: 0,
    }),
    'mao-ao::female': Object.freeze({
      leftHandShoulder: Object.freeze({ x: 0.1771042396564939, y: 0.6511546407522855, z: 0 }),
      rightHandShoulder: Object.freeze({ x: -0.23898599170593354, y: 0.646996571654354, z: 0 }),
      armLengthHeightPercentOffset: 5,
    }),
  });

  const clonePosition = value => ({ x: Number(value.x), y: Number(value.y), z: Number(value.z) });

  function applyOne(profile, authored) {
    if (!profile || !authored) return false;
    profile.anchors ||= {};
    for (const anchorName of ['leftHandShoulder', 'rightHandShoulder']) {
      profile.anchors[anchorName] ||= {
        position: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
      profile.anchors[anchorName].position = clonePosition(authored[anchorName]);
    }
    profile.anatomy ||= {};
    profile.anatomy.armLengthHeightPercentOffset = Number(authored.armLengthHeightPercentOffset) || 0;
    return true;
  }

  function applyToLibrary(library = window.HOBUNJI_ATTACHMENT_RIG_PROFILES) {
    const characters = library?.characters;
    if (!characters) return false;
    let applied = 0; // Reported below so mobile diagnostics can verify both Mao-ao profiles were touched.
    for (const [key, authored] of Object.entries(AUTHORED)) {
      if (applyOne(characters[key], authored)) applied += 1;
    }
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.maoAoShoulderAuthoring = `${VERSION}:${applied}`;
    return applied === Object.keys(AUTHORED).length;
  }

  window.HobunjiMaoAoShoulderAuthoring = Object.freeze({ version: VERSION, authored: AUTHORED, applyToLibrary });

  if (!applyToLibrary()) {
    let attempts = 0; // Retries only until the shared attachment-rig library is constructed.
    const timer = setInterval(() => {
      if (applyToLibrary() || ++attempts >= 400) clearInterval(timer);
    }, 50);
  }
})();
