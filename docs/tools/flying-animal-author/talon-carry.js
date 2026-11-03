// Editor-only payload previews. The attachment transform is shared with the rig.
window.createFlyingTalonEditor = function ({ root, rig, changed, showFlying }) {

  const api = window.FlyingAnimalRig;
  const get = id => document.getElementById(id);
  const type = get('talonType'), status = get('talonStatus'), fields = get('talonFields');
  const guide = new THREE.Group(); // Reparented whenever the animal preview is rebuilt.
  const frame = new THREE.Group(); // Carries the sample and the aligned hold-anchor axes.
  const socket = new THREE.AxesHelper(.15);
  const hold = new THREE.AxesHelper(.085);
  const samples = {}; // Preview assets are loaded once and switched by payload type.
  const controls = [];
  guide.add(socket, frame);
  frame.add(hold);
  guide.visible = false;

  function previewHumanoid() {
    const object = new THREE.Group(); // Neutral avatar stand-in with a shoulder mount.
    const material = new THREE.MeshBasicMaterial({ color: 0x9db9d7 });
    for (const [x,y,w,h] of [[0,.17,.16,.18],[0,-.08,.27,.3],[-.19,-.1,.08,.29],[.19,-.1,.08,.29],[-.07,-.36,.09,.26],[.07,-.36,.09,.26]]) {
      const part = new THREE.Mesh(new THREE.BoxGeometry(w,h,.09),material);
      part.position.set(x,y,0);
      object.add(part);
    }
    return { object, anchor: { position: { x: 0, y: .07, z: 0 } } };
  }

  async function previewAnimal() {
    const image = new Image(); // Use a real side-profile animal sprite.
    image.crossOrigin = 'anonymous';
    image.src = '../../assets/creaturesprites/gar-wolf_idle.png';
    await image.decode();
    const png = window.HobunjiSpritePngSurface;
    const material = png.makeMaterial(THREE, png.makeCanvasTexture(THREE, image, 'talon-animal'), 'talon-animal', { side: THREE.DoubleSide });
    const object = new THREE.Mesh(new THREE.PlaneGeometry(.55 * image.width / image.height, .55), material);
    return { object, anchor: { position: { x: 0, y: .09, z: 0 } } };
  }

  async function previewBurden() {
    const response = await fetch('../../config/furniture-authored/hronalWitchBomb.json');
    if (!response.ok) throw new Error('Could not load the authored Witch-bomb.');
    const data = await response.json();
    const anchor = data.carryable?.billboardAnchor; // Same hold anchor shown in the Furniture Editor.
    if (!anchor) throw new Error('The burden is missing its Furniture Editor hold anchor.');
    return { object: window.AuthoredFurniture.buildGroup(data), anchor };
  }

  function sampleFor(key) {
    if (!samples[key]) {
      const load = { humanoid: previewHumanoid, animal: previewAnimal, burden: previewBurden }[key];
      samples[key] = Promise.resolve().then(load).catch(error => { delete samples[key]; throw error; });
    }
    return samples[key];
  }

  function values(carry, group) {
    return group === 'socket' ? carry.socket : group === 'scale' ? carry.poses[type.value] : carry.poses[type.value][group];
  }

  let displayed = null, request = 0; // Reject results from an earlier dropdown selection.
  function refresh() {
    const bird = root();
    const key = type.value;
    guide.visible = !!(bird && key && displayed?.key === key);
    fields.hidden = !key;
    if (!bird || !key) return;
    if (guide.parent !== bird) bird.add(guide);
    const carry = rig().talonCarry ?? api.normalizeTalonCarry();
    for (const { input, group, axis } of controls) input.value = values(carry, group)[axis];
    socket.position.set(carry.socket.x, carry.socket.y, carry.socket.z);
    if (guide.visible) api.placeTalonPayload(frame, displayed.object, carry, key, displayed.anchor);
  }

  for (const [group, name, axes] of [
    ['socket', 'Talon grip', ['x','y','z']], ['position', 'Payload offset', ['x','y','z']],
    ['rotation', 'Payload rotation (°)', ['x','y','z']], ['scale', 'Payload scale', ['scale']],
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
      input.min = group === 'scale' ? '.1' : group === 'rotation' ? '-180' : '-4';
      input.max = group === 'rotation' ? '180' : '4';
      input.setAttribute('aria-label', name + (axis === 'scale' ? '' : ' ' + axis.toUpperCase()));
      label.append(axis === 'scale' ? '' : axis.toUpperCase(), input);
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

  type.addEventListener('change', async () => {
    const id = ++request, key = type.value;
    if (displayed) frame.remove(displayed.object);
    displayed = null;
    refresh();
    changed(false);
    if (!key) { status.textContent = ''; return; }
    showFlying();
    status.textContent = 'Loading payload preview…';
    try {
      const sample = await sampleFor(key);
      if (id !== request) return;
      displayed = { ...sample, key };
      frame.add(sample.object);
      status.textContent = key === 'burden' ? 'Hronal Witch-bomb · Furniture Editor hold anchor' :
        key === 'humanoid' ? 'Player / NPC scale mannequin · shoulder mount' : 'Gar-wolf · back mount';
      refresh();
      changed(false);
    } catch (error) {
      if (id === request) status.textContent = error.message;
    }
  });

  return { refresh, setPerched(perched) { guide.visible = !perched && !!type.value && displayed?.key === type.value; } };
};
