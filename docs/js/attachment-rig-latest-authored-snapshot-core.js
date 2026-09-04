// Latest user-authored attachment-rig snapshot from the 2026-09-04 Animation Author export.
// The export currently serializes derived character posterior positions and creature
// ground offsets as zero placeholders. Those zero families are deliberately NOT
// treated as authored data here.
(() => {
  'use strict';

  const SNAPSHOT_VERSION = 'hobunji-rig-user-export-2026-09-04T02:12:48.704Z';
  const OVERRIDES = {"tletingan::male":{"posteriorRule":{"heightPercentOffset":8.937643126516525,"heightPercentFromFloor":28.437643126516516,"defaultRuleVersion":5},"anchors":{"shoulderPerch":{"x":-0.15455811538461542,"y":0.48195,"z":0},"leftHandShoulder":{"x":0.22446044985888036,"y":0.3793571379113177,"z":0},"rightHandShoulder":{"x":-0.2448354156580218,"y":0.38762174012713624,"z":0}},"anatomy":{"portraitVerticalPlacementRatio":0.69,"portraitScale":0.85,"handScale":0.95,"footScale":0.95,"armLengthHeightPercentOffset":6,"version":1},"shoulderPerchRule":{"portraitVerticalPlacementRatio":0.69,"portraitModelHeight":0.85}},"engh-sho::male":{"posteriorRule":{"heightPercentOffset":-22.925114784416632,"heightPercentFromFloor":37.574885215583386,"defaultRuleVersion":5},"anchors":{"shoulderPerch":{"x":-0.2115295187159422,"y":0.6813045758748404,"z":0},"leftHandShoulder":{"x":0.2446796266991158,"y":0.6838406837818225,"z":0},"rightHandShoulder":{"x":-0.28930388062923146,"y":0.7000103424366998,"z":0}},"anatomy":{"portraitVerticalPlacementRatio":1.1,"portraitScale":0.95,"handScale":1.45,"footScale":1.25,"armLengthHeightPercentOffset":0,"version":1},"shoulderPerchRule":{"portraitVerticalPlacementRatio":1.1,"portraitModelHeight":0.95}},"mao-ao::male":{"posteriorRule":{"heightPercentOffset":-12.906132973935925,"heightPercentFromFloor":47.59386702606408,"defaultRuleVersion":4},"anchors":{"shoulderPerch":{"x":-0.2006533796199832,"y":0.6234902368619534,"z":0},"leftHandShoulder":{"x":0.18901455966160707,"y":0.6441947637751073,"z":0},"rightHandShoulder":{"x":-0.21163248394065837,"y":0.6455541403639915,"z":0}},"anatomy":{"portraitVerticalPlacementRatio":1.1,"portraitScale":0.8,"handScale":1.2,"footScale":1.05,"armLengthHeightPercentOffset":5,"version":1},"shoulderPerchRule":{"portraitVerticalPlacementRatio":1.1}},"mao-ao::female":{"posteriorRule":{"heightPercentOffset":-6.86685977205737,"heightPercentFromFloor":48.63314022794264,"defaultRuleVersion":5},"anchors":{"shoulderPerch":{"x":-0.14923510597360837,"y":0.4721927183587378,"z":0},"leftHandShoulder":{"x":0.15802543281954162,"y":0.6123901450249363,"z":0},"rightHandShoulder":{"x":-0.1791580043530983,"y":0.6148654543328562,"z":0}},"anatomy":{"portraitVerticalPlacementRatio":1.05,"portraitScale":0.8,"handScale":1.15,"footScale":1.025,"armLengthHeightPercentOffset":5,"version":1},"shoulderPerchRule":{"portraitVerticalPlacementRatio":1.05,"portraitModelHeight":1}},"kenkari::male":{"posteriorRule":{"heightPercentOffset":8.13373809954061,"heightPercentFromFloor":13.133738099540613,"defaultRuleVersion":5},"anchors":{"shoulderPerch":{"x":-0.18055321970300925,"y":0.2796199399496049,"z":0},"leftHandShoulder":{"x":0.17819817802695415,"y":0.27810760526210354,"z":0},"rightHandShoulder":{"x":-0.18055321970300925,"y":0.2806045705813891,"z":0}},"anatomy":{"portraitVerticalPlacementRatio":0.51,"portraitScale":0.75,"handScale":1,"footScale":1,"armLengthHeightPercentOffset":0,"version":1},"shoulderPerchRule":{"portraitVerticalPlacementRatio":0.51,"portraitModelHeight":0.75}},"kenkari::female":{"posteriorRule":{"heightPercentOffset":16.99675435046502,"heightPercentFromFloor":18.49675435046502,"defaultRuleVersion":5},"anchors":{"shoulderPerch":{"x":-0.12331214301269552,"y":0.2212216457140902,"z":0},"leftHandShoulder":{"x":0.16936315183698947,"y":0.21736535606615187,"z":0},"rightHandShoulder":{"x":-0.152092307435453,"y":0.21357246118307222,"z":0}},"anatomy":{"portraitVerticalPlacementRatio":0.51,"portraitScale":0.75,"handScale":0.93,"footScale":1,"armLengthHeightPercentOffset":2.5,"version":1},"shoulderPerchRule":{"portraitVerticalPlacementRatio":0.51,"portraitModelHeight":0.75}},"tletingan::female":{"posteriorRule":{"heightPercentOffset":-0.8735593215106686,"heightPercentFromFloor":21.62644067848934,"defaultRuleVersion":5},"anchors":{"shoulderPerch":{"x":-0.15767922666458786,"y":0.36829341919016667,"z":0},"leftHandShoulder":{"x":0.19339659287777322,"y":0.38426858848533485,"z":0},"rightHandShoulder":{"x":-0.19326419458235525,"y":0.38220450093854685,"z":0}},"anatomy":{"portraitVerticalPlacementRatio":0.62,"portraitScale":0.85,"handScale":0.925,"footScale":1.025,"armLengthHeightPercentOffset":5,"version":1},"shoulderPerchRule":{"portraitVerticalPlacementRatio":0.62,"portraitModelHeight":0.85}},"mashtzarr::male":{"posteriorRule":{"heightPercentOffset":2.6880202107561746,"heightPercentFromFloor":28.18802021075617,"defaultRuleVersion":5},"anchors":{"shoulderPerch":{"x":-0.34002625715438967,"y":0.626590204929038,"z":0},"leftHandShoulder":{"x":0.3574141798122501,"y":0.5621839806716179,"z":0},"rightHandShoulder":{"x":-0.38790571007816155,"y":0.5709160879627874,"z":0}},"anatomy":{"portraitVerticalPlacementRatio":0.75,"portraitScale":1.18,"handScale":1,"footScale":1.175,"armLengthHeightPercentOffset":4,"version":1},"shoulderPerchRule":{"portraitVerticalPlacementRatio":0.75,"portraitModelHeight":1}},"mashtzarr::female":{"posteriorRule":{"heightPercentOffset":5.393267764969498,"heightPercentFromFloor":28.893267764969494,"defaultRuleVersion":5},"anchors":{"shoulderPerch":{"x":-0.2116267975555845,"y":0.6264459490183858,"z":0},"leftHandShoulder":{"x":0.2980599709989775,"y":0.5776632143882874,"z":0},"rightHandShoulder":{"x":-0.23738814386776136,"y":0.5741088067402718,"z":0}},"anatomy":{"portraitVerticalPlacementRatio":0.73,"portraitScale":1.18,"handScale":0.95,"footScale":1,"armLengthHeightPercentOffset":0,"version":1},"shoulderPerchRule":{"portraitVerticalPlacementRatio":0.73,"portraitModelHeight":1}},"engh-sho::female":{"posteriorRule":{"heightPercentOffset":-5.570190604064765,"heightPercentFromFloor":40.92980939593523,"defaultRuleVersion":5},"anchors":{"shoulderPerch":{"x":-0.1946207511064788,"y":0.6917376416065568,"z":0},"leftHandShoulder":{"x":0.18369683796485248,"y":0.6467456179064074,"z":0},"rightHandShoulder":{"x":-0.24108869039640451,"y":0.6495198023830328,"z":0}},"anatomy":{"portraitVerticalPlacementRatio":0.96,"portraitScale":0.95,"handScale":1.3,"footScale":1.17,"armLengthHeightPercentOffset":2,"version":1},"shoulderPerchRule":{"portraitVerticalPlacementRatio":0.96,"portraitModelHeight":0.95}}};
  const ALIASES = Object.freeze({ 'rakakoan::male': 'kenkari::male', 'rakakoan::female': 'kenkari::female', 'ghoul::male': 'mao-ao::male', 'ghoul::female': 'mao-ao::female' });
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const finite = value => Number.isFinite(Number(value));
  const zeroPosition = value => ['x', 'y', 'z'].every(axis => finite(value?.[axis]) && Math.abs(Number(value[axis])) <= 1e-12);
  const hasNonZeroOffsets = offsets => offsets && Object.values(offsets).some(value => finite(value) && Math.abs(Number(value)) > 1e-12);

  function applyOne(target, authored) {
    if (!target || !authored) return;
    target.posteriorRule ||= {};
    Object.assign(target.posteriorRule, clone(authored.posteriorRule));
    target.anchors ||= {};
    for (const name of ['shoulderPerch', 'leftHandShoulder', 'rightHandShoulder']) {
      target.anchors[name] ||= { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
      target.anchors[name].position = clone(authored.anchors[name]);
    }
    target.anatomy = { ...(target.anatomy || {}), ...clone(authored.anatomy) };
    target.shoulderPerchRule = { ...(target.shoulderPerchRule || {}), ...clone(authored.shoulderPerchRule), recalculateOnPreview: false, authoredFixed: true };
    target.handShoulderRule = { source: 'user-export-2026-09-04', coordinateSpace: 'character-visual-local', version: 1 };
  }

  function applyToLibrary(library) {
    if (!library?.characters) return false;
    for (const [key, authored] of Object.entries(OVERRIDES)) {
      if (library.characters[key]) applyOne(library.characters[key], authored);
    }
    for (const [alias, source] of Object.entries(ALIASES)) {
      if (library.characters[alias] && library.characters[source]) {
        const keepSpecies = library.characters[alias].species;
        const keepGender = library.characters[alias].gender;
        library.characters[alias] = clone(library.characters[source]);
        if (keepSpecies) library.characters[alias].species = keepSpecies;
        if (keepGender) library.characters[alias].gender = keepGender;
      }
    }
    return true;
  }

  function posteriorReferenceHeight(profile, runtimeProfile) {
    const bindingHeight = Number(runtimeProfile?.anchors?.posterior?.portraitBinding?.referenceModelHeight
      ?? profile?.anchors?.posterior?.portraitBinding?.referenceModelHeight
      ?? runtimeProfile?.posteriorRule?.portraitBinding?.referenceModelHeight
      ?? profile?.posteriorRule?.portraitBinding?.referenceModelHeight);
    if (bindingHeight > 0) return bindingHeight;
    const explicit = Number(profile?.shoulderPerchRule?.portraitModelHeight);
    if (explicit > 0) return explicit;
    const scale = Number(profile?.anatomy?.portraitScale);
    return scale > 0 ? 0.9 * scale : 0.9;
  }

  function repairPosteriorExport(profile, runtimeProfile) {
    const anchor = profile?.anchors?.posterior;
    if (!anchor?.position || !zeroPosition(anchor.position)) return;
    const live = runtimeProfile?.resolvedPosteriorPosition;
    if (finite(live?.y) && Math.abs(Number(live.y)) > 1e-12) {
      anchor.position = { x: Number(live.x) || 0, y: Number(live.y), z: Number(live.z) || 0 };
      anchor.exportDerivedFrom = 'live-resolved-posterior';
      return;
    }
    const binding = runtimeProfile?.anchors?.posterior?.portraitBinding
      ?? profile?.anchors?.posterior?.portraitBinding
      ?? runtimeProfile?.posteriorRule?.portraitBinding
      ?? profile?.posteriorRule?.portraitBinding;
    if (finite(binding?.referencePosition?.y) && Math.abs(Number(binding.referencePosition.y)) > 1e-12) {
      anchor.position = clone(binding.referencePosition);
      anchor.exportDerivedFrom = 'portrait-binding-reference-position';
      return;
    }
    const percent = Number(profile?.posteriorRule?.heightPercentFromFloor);
    const height = posteriorReferenceHeight(profile, runtimeProfile);
    if (Number.isFinite(percent) && height > 0) {
      anchor.position = { x: 0, y: height * percent / 100, z: 0 };
      anchor.exportDerivedFrom = 'posteriorRule.heightPercentFromFloor';
      anchor.exportReferenceModelHeight = height;
    }
  }

  function repairSerializedExport(data) {
    const profiles = data?.profiles || data;
    const runtime = window.HOBUNJI_ATTACHMENT_RIG_PROFILES || {};
    for (const [key, profile] of Object.entries(profiles?.characters || {})) {
      repairPosteriorExport(profile, runtime.characters?.[key]);
    }
    for (const [kind, profile] of Object.entries(profiles?.creatures || {})) {
      const offsets = profile?.groundOffsets;
      const allZero = offsets && Object.values(offsets).every(value => finite(value) && Math.abs(Number(value)) <= 1e-12);
      const source = runtime.creatures?.[kind]?.groundOffsets;
      if (allZero && hasNonZeroOffsets(source)) {
        profile.groundOffsets = clone(source);
        profile.groundOffsetsExportDerivedFrom = 'runtime-master-profile';
      }
    }
    data.exportGuard ||= {};
    data.exportGuard.latestAuthoredSnapshot = SNAPSHOT_VERSION;
    data.exportGuard.zeroDerivedPlaceholdersSuppressed = true;
    return data;
  }

  function installExportGuard() {
    const base = window.serializeAttachmentRigLibrary;
    if (typeof base !== 'function') return false;
    if (base.__hobunjiLatestAuthoredExportGuard) return true;
    const wrapped = function latestAuthoredSerializeAttachmentRigLibrary() {
      return repairSerializedExport(base.apply(this, arguments));
    };
    wrapped.__hobunjiLatestAuthoredExportGuard = true;
    window.serializeAttachmentRigLibrary = wrapped;
    return true;
  }

  function importIntoAnimationAuthor() {
    if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return false;
    if (window.__hobunjiLatestAuthoredSnapshotImported) return true;
    const input = document.getElementById('maaImportInput');
    const profiles = window.HOBUNJI_ATTACHMENT_RIG_PROFILES;
    if (!input || !profiles || typeof File !== 'function') return false;
    const payload = {
      schema: 'hobunji.attachment-rig-profiles.v10',
      exportedAt: '2026-09-04T02:12:48.704Z',
      profiles: clone(profiles),
      importedFrom: SNAPSHOT_VERSION,
    };
    const file = new File([JSON.stringify(payload)], 'hobunji_attachment_rig_latest_authored.json', { type: 'application/json' });
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    } catch (_) {
      try { Object.defineProperty(input, 'files', { configurable: true, value: [file] }); } catch (_) { return false; }
    }
    window.__hobunjiLatestAuthoredSnapshotImported = true;
    input.dispatchEvent(new Event('change', { bubbles: false }));
    return true;
  }

  function apply() {
    const applied = applyToLibrary(window.HOBUNJI_ATTACHMENT_RIG_PROFILES);
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.latestAuthoredSnapshot = {
      version: SNAPSHOT_VERSION,
      applied,
      zeroPosteriorPositionsIgnored: true,
      zeroCreatureGroundOffsetsIgnored: true,
    };
    window.ProceduralHandFrameDriver?.syncNow?.();
    return applied;
  }

  window.HOBUNJI_ATTACHMENT_RIG_LATEST_AUTHORED = Object.freeze({
    version: SNAPSHOT_VERSION,
    overrides: OVERRIDES,
    apply,
    repairSerializedExport,
  });

  apply();
  let attempts = 0;
  const timer = setInterval(() => {
    apply();
    const exportReady = installExportGuard();
    const importReady = importIntoAnimationAuthor();
    if ((exportReady && importReady) || ++attempts >= 600) clearInterval(timer);
  }, 50);
})();