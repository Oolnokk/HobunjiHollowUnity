// Editor-only payload previews. The attachment transform is shared with the rig.
window.createFlyingTalonEditor = function ({ root, rig, changed, showFlying }) {

  const api = window.FlyingAnimalRig;
  const get = id => document.getElementById(id);
  const type = get('talonType'), source = get('talonSource'), status = get('talonStatus'), fields = get('talonFields');
  const catalog = { // Sample identities are preview-only. Exported poses still apply by payload type.
    humanoid: [['garanki_gabu', 'Garanki Gabu'], ['aliri_ginju', 'Aliri Ginju'], ['kzubug', 'Kzubug']],
    animal: [['gar-wolf', 'Gar-wolf'], ['puktuk', 'Puktuk']],
    burden: [['hronalWitchBomb', 'Hronal Witch-bomb'], ['shattercaskBlasting', 'Blasting Shattercask'], ['keyStatue', 'Key Statue']],
  };
  let bestiary; // Shared tool catalog for wildlife geometry dimensions.
  let npcDatabase; // Load the NPC records once, when first needed.
  const guide = new THREE.Group(); // Reparented whenever the animal preview is rebuilt.
  const frame = new THREE.Group(); // Carries the sample and the aligned hold-anchor axes.
  const socket = new THREE.AxesHelper(.15);
  const hold = new THREE.AxesHelper(.085);
  const samples = {}; // Preview assets are loaded once and switched by payload type.
  const controls = [];
  guide.add(socket, frame);
  frame.add(hold);
  guide.visible = false;

  async function previewHumanoid(id) {
    npcDatabase ??= fetch('../../config/npcs/hobunji-starter-npc-database.json').then(response => {
      if (!response.ok) throw new Error('Could not load the NPC database.');
      return response.json();
    }).catch(error => { npcDatabase = null; throw error; });
    const { npcs } = await npcDatabase;
    const npc = npcs.find(record => record.id === id);
    if (!npc?.appearance) throw new Error('This NPC has no authored appearance.');
    const portraits = window.NpcAvatarPreview;
    await portraits.ensurePortraitCosmetics({ assetBase: '../../assets/', configBase: '../../config/' });
    const profile = portraits.buildProfileFromNpcExport(npc);
    if (!profile) throw new Error('Could not build the NPC portrait profile.');

    async function render(portraitView) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 200;
      await portraits.renderProfileToCanvas(canvas, profile, { portraitView });
      if (!canvas.getContext('2d').getImageData(0, 0, 200, 200).data.some((value, index) => index % 4 === 3 && value)) {
        throw new Error('The NPC portrait rendered blank. Check that its sprite assets are available.');
      }
      return canvas;
    }
    const front = await render('front'), back = await render('behind');
    const { speciesId, gender } = npc.appearance;
    const width = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.worldModelWidth ?? .9;
    const model = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE, front, {
      backCanvas: back, profile, speciesId, gender, npcRecord: npc, modelWidth: width, modelHeight: width,
    });
    const object = new THREE.Group(); // Match the furniture preview's floor-relative portrait origin.
    const height = model.userData.portraitModelHeight;
    model.position.y = height / 2;
    object.add(model);
    const rigProfile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters?.[`${speciesId}::${gender}`];
    const posterior = rigProfile?.anchors?.posterior;
    const y = window.HOBUNJI_ATTACHMENT_RIG_MATH.characterPosteriorY(rigProfile?.posteriorRule, height, model.userData.handAttachY);
    return { object, sizeLabel: `game portrait plane ${model.userData.portraitModelWidth.toFixed(2)} × ${height.toFixed(2)}`, anchor: { position: { x: posterior?.position?.x ?? 0,
      y: Number.isFinite(y) ? y : height / 2, z: posterior?.position?.z ?? 0 }, rotation: posterior?.rotationDeg } };
  }

  async function previewAnimal(id) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = `../../assets/creaturesprites/${id}_idle.png`;
    await image.decode();
    bestiary ??= fetch('../../config/creatures/hobunji-creature-bestiary.json').then(response => {
      if (!response.ok) throw new Error('Could not load game creature dimensions.');
      return response.json();
    }).catch(error => { bestiary = null; throw error; });
    const { creatures } = await bestiary;
    // Puktuk's runtime registration uses Gar-wolf's native 2.1-wide, legacy-aspect frame.
    const definition = creatures.find(record => record.id === id) ??
      (id === 'puktuk' ? creatures.find(record => record.id === 'gar-wolf') : null);
    if (!definition?.modelWidth || !definition.spriteAspect) throw new Error('This animal has no game plane dimensions.');
    const medium = window.HOBUNJI_ATTACHMENT_RIG_PROFILES.creatures?.[id]?.sizeScales?.medium;
    const width = definition.modelWidth * (medium?.x ?? 1);
    const height = definition.modelWidth * definition.spriteAspect * (medium?.y ?? 1);
    const model = window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE, image.src, {
      name: id, modelWidth: width, modelHeight: height,
    });
    const texture = model.frontPlane.material.map; // Seed the canonical shared map with the decoded image for a static Glide preview.
    if (!texture.image) { texture.image = image; texture.needsUpdate = true; }
    const object = new THREE.Group(); // Adapt the game's X-normal animal frame to the talon's Z-normal preview.
    model.group.rotation.y = -Math.PI / 2;
    object.add(model.group);
    return { object, sizeLabel: `medium game plane ${width.toFixed(2)} × ${height.toFixed(2)}`,
      anchor: { position: { x: 0, y: .09 * height / .55, z: 0 } } };
  }

  async function previewBurden(id) {
    const data = await window.AuthoredFurniture.load(id);
    if (!data) throw new Error('Could not load the authored furniture JSON.');
    const anchor = data.carryable?.billboardAnchor;
    if (!anchor) throw new Error('The burden is missing its Furniture Editor hold anchor.');
    const object = window.AuthoredFurniture.buildGroup(data);
    const patterns = []; // Wait for authored surface patterns before presenting the static sample.
    object.traverse(node => {
      if (node.userData.patternReady) patterns.push(node.userData.patternReady);
    });
    await Promise.all(patterns);
    // The Furniture Editor guide's size is for fitting to a humanoid carrier.
    // Keep the authored object's world dimensions when comparing it to the bird.
    return { object, anchor: { position: anchor.position, rotation: anchor.rotation }, sizeLabel: 'authored world size' };
  }

  function sampleFor(type, id) {
    const key = `${type}:${id}`;
    if (!samples[key]) {
      const load = { humanoid: previewHumanoid, animal: previewAnimal, burden: previewBurden }[type];
      samples[key] = Promise.resolve().then(() => load(id)).catch(error => { delete samples[key]; throw error; });
    }
    return samples[key];
  }

  function showScaleSummary(carry) {
    get('talonScales').textContent = `Bird scale · NPC ${carry.poses.humanoid.birdScale}× · Animal ${carry.poses.animal.birdScale}× · Burden ${carry.poses.burden.birdScale}×`;
  }

  function values(carry, group) {
    return group === 'socket' ? carry.socket : group === 'birdScale' ? carry.poses[type.value] : carry.poses[type.value][group];
  }

  let displayed = null, request = 0; // Reject results from an earlier dropdown selection.
  function refresh() {
    const bird = root();
    const key = type.value;
    guide.visible = !!(bird && key && displayed?.key === key);
    fields.hidden = !key;
    const carry = rig().talonCarry ?? api.normalizeTalonCarry();
    showScaleSummary(carry);
    if (!bird || !key) return;
    if (guide.parent !== bird) bird.add(guide);
    for (const { input, group, axis } of controls) input.value = values(carry, group)[axis];
    socket.position.set(carry.socket.x, carry.socket.y, carry.socket.z);
    if (guide.visible) api.placeTalonPayload(frame, displayed.object, carry, key, displayed.anchor);
  }

  for (const [group, name, axes] of [
    ['socket', 'Talon grip', ['x','y','z']], ['position', 'Payload offset', ['x','y','z']],
    ['rotation', 'Payload rotation (°)', ['x','y','z']], ['birdScale', 'Bird scale', ['birdScale']],
  ]) {
    const row = document.createElement('div'); // Group transforms by their reference frame.
    row.className = 'row';
    const title = document.createElement('strong');
    title.textContent = name;
    row.append(title);
    for (const axis of axes) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'number';
      input.step = group === 'rotation' ? '1' : '.01';
      input.min = group === 'birdScale' ? '.25' : group === 'rotation' ? '-180' : '-4';
      input.max = group === 'birdScale' ? '10' : group === 'rotation' ? '180' : '4';
      input.setAttribute('aria-label', name + (axis === 'birdScale' ? '' : ' ' + axis.toUpperCase()));
      label.append(axis === 'birdScale' ? '' : axis.toUpperCase(), input);
      row.append(label);
      controls.push({ input, group, axis });
      input.addEventListener('change', () => {
        if (!rig() || !type.value) return;
        const carry = api.normalizeTalonCarry(rig().talonCarry);
        if (Number.isFinite(input.valueAsNumber)) values(carry, group)[axis] = input.valueAsNumber;
        rig().talonCarry = api.normalizeTalonCarry(carry);
        refresh();
        changed(true);
      });
    }
    fields.append(row);
  }

  async function showSample() {
    const id = ++request, key = type.value;
    if (displayed) frame.remove(displayed.object);
    displayed = null;
    refresh();
    changed(false);
    if (!key) { status.textContent = ''; return; }
    showFlying();
    status.textContent = 'Loading payload preview…';
    try {
      const label = source.selectedOptions[0].textContent;
      const sample = await sampleFor(key, source.value);
      if (id !== request) return;
      displayed = { ...sample, key };
      frame.add(sample.object);
      status.textContent = label + (key === 'burden' ? ' · Furniture Editor hold anchor' :
        key === 'humanoid' ? ' · NPC portrait and posterior anchor' : ' · Animal portrait planes') + ' · ' + sample.sizeLabel;
      refresh();
      changed(false);
    } catch (error) {
      if (id === request) status.textContent = error.message;
    }
  }

  type.addEventListener('change', () => {
    source.replaceChildren(...(catalog[type.value] ?? []).map(([id, label]) => new Option(label, id)));
    source.parentElement.hidden = !type.value;
    showSample();
  });
  source.addEventListener('change', showSample);

  return {
    refresh,
    applyPreviewState(perched) {
      guide.visible = !perched && !!type.value && displayed?.key === type.value;
      return guide.visible ? rig().talonCarry?.poses[type.value]?.birdScale ?? 1 : 1;
    },
  };
};
