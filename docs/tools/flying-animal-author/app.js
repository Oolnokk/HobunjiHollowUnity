(() => {
  'use strict';

  const get = id => document.getElementById(id); // Editor controls and preview surfaces.
  const status = get('status'); // Mobile-visible diagnostics for loading and saving.
  try {
    start();
  } catch (error) {
    status.textContent = `Preview could not start. ${error.message}`;
  }

  function start() {
    const rigAPI = window.FlyingAnimalRig; // Shared rig validation and rendering.
    const draftKey = 'hobunji_flying_animal_rig_v1'; // Local editor draft.
    const canvas = get('viewport'), diagram = get('wings');
    const debug = get('debug'); // Preview transforms shown without devtools.
    const ctx = diagram.getContext('2d');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(39, 1, 0.01, 100);
    const radians = Math.PI / 180; // UI angles are in degrees.
    window.PerpRotation.init({
      angleDiff: (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b)),
    });

    const fields = { flying: get('flying'), perched: get('perched'), wings: get('wingPath') }; // Asset path inputs.
    const labels = { // Display names and increments for the authored controls.
      leftHinge: ['Left hinge', .001], rightHinge: ['Right hinge', .001],
      wingScale: ['Wing scale', .01], wingHeight: ['Wing height', .01], wingOffset: ['Wing fore/aft offset', .01], wingCenter: ['Body crossing on wings', .001],
      flapUp: ['Upstroke (°)', 1], flapDown: ['Downstroke (°)', 1], flapHz: ['Flaps per second', .1],
      glideAngle: ['Glide angle (°)', 1], yawDeadzone: ['Yaw deadzone (°)', .5], pitchDeadzone: ['X-axis deadzone (°)', .5],
    };
    const controls = {}; // Map rig keys to their range and readout.
    let rig = rigAPI.normalize(rigAPI.defaults), images, assembly; // Current validated draft and its decoded assets.
    let loadId = 0, loading = false, activeHinge = null; // Latest asset request and captured drag.
    let needsRender = true; // Refresh static poses only when the view changes.

    function showSettings() {
      for (const [key, field] of Object.entries(fields)) field.value = rig[key];
      for (const [key, { range, output }] of Object.entries(controls)) {
        range.value = rig[key];
        output.value = rig[key];
      }
    }

    function saveDraft() {
      try {
        localStorage.setItem(draftKey, JSON.stringify(rig));
        status.textContent = 'Preview ready. Draft saved on this browser.';
      } catch {
        status.textContent = 'Preview ready. Browser draft storage is unavailable. Export JSON to keep the rig.';
      }
    }

    function drawHinges() {
      const image = images.wings; // Use the source art's aspect ratio for pointer coordinates.
      diagram.width = Math.min(800, image.width);
      diagram.height = Math.round(diagram.width * image.height / image.width);
      ctx.drawImage(image, 0, 0, diagram.width, diagram.height);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rig.wingCenter * diagram.width, 0);
      ctx.lineTo(rig.wingCenter * diagram.width, diagram.height);
      ctx.stroke();
      for (const [key, tip, color] of [['leftHinge', .07, '#6af0ff'], ['rightHinge', .93, '#ff91d9']]) {
        const x = rig[key] * diagram.width, y = diagram.height * .45; // Fore-aft axis and bone guide.
        ctx.strokeStyle = ctx.fillStyle = color;
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, diagram.height);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(tip * diagram.width, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, Math.max(7, diagram.width * .016), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const perchCanvas = get('perchBody'), perchLine = get('perchLine'); // Perched sprite editing surface and active line.
    const perchContext = perchCanvas.getContext('2d'); // Draw the unwarped source and both guides.
    const splineAPI = window.AnimalShoulderSpline; // Shared curve evaluation for guides and mesh deformation.
    let perchDrag = null, perchDirty = false; // Captured handle and pending mesh update.

    function perchPadding() { return perchLine.value === 'afterPoints' ? rigAPI.perchPosePadding : 0; }

    function drawPerchSpline() {
      const image = images.perched;
      const width = perchCanvas.width;
      const sourceHeight = width * image.height / image.width;
      const padding = perchPadding();
      const workspaceHeight = Math.ceil(sourceHeight * (1 + 2 * padding));
      if (perchCanvas.height !== workspaceHeight) perchCanvas.height = workspaceHeight;
      perchContext.clearRect(0, 0, width, workspaceHeight);
      perchContext.drawImage(image, 0, padding * sourceHeight, width, sourceHeight);
      if (padding) {
        perchContext.strokeStyle = '#788b9f';
        perchContext.lineWidth = 1;
        perchContext.setLineDash([5, 5]);
        perchContext.strokeRect(.5, padding * sourceHeight, width - 1, sourceHeight);
        perchContext.setLineDash([]);
      }
      const displayY = y => (y + padding) * sourceHeight;
      const lines = rig.perchSpline ?? rigAPI.normalizePerchSpline();
      const active = perchLine.value;
      const inactive = active === 'beforePoints' ? 'afterPoints' : 'beforePoints';
      for (const key of [inactive, active]) {
        const points = lines[key];
        perchContext.strokeStyle = perchContext.fillStyle = key === 'beforePoints' ? '#6af0ff' : '#ff91d9';
        perchContext.lineWidth = key === active ? 3 : 1;
        perchContext.beginPath();
        for (let i = 0; i <= 60; i++) {
          const point = splineAPI.splinePoint(points, i / 60);
          perchContext.lineTo(point.x * width, displayY(point.y));
        }
        perchContext.stroke();
        if (key !== active) continue;
        for (const point of points) {
          perchContext.beginPath();
          perchContext.arc(point.x * width, displayY(point.y), width * .012, 0, Math.PI * 2);
          perchContext.fill();
        }
      }
    }

    function rebuild(nextRig, nextImages) {
      const nextAssembly = rigAPI.create(nextRig, nextImages); // Keep the working preview if the replacement fails.
      assembly?.dispose();
      rig = nextRig;
      images = nextImages;
      assembly = nextAssembly;
      scene.add(assembly.root);
      talonEditor.refresh();
      drawHinges();
      perchCanvas.width = Math.min(800, images.perched.width);
      perchDirty = false;
      drawPerchSpline();
      needsRender = true;
      get('save').disabled = false;
    }

    function decode(path) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load ${path}`));
        image.src = new URL('../../assets/' + path, document.baseURI).href;
      });
    }

    async function load(raw) {
      const id = ++loadId; // A late response must never replace a newer selection.
      loading = true;
      try {
        const nextRig = rigAPI.normalize(raw);
        status.textContent = 'Loading sprites…';
        const entries = await Promise.all(Object.keys(fields).map(async key => [key, await decode(nextRig[key])]));
        if (id !== loadId) return;
        rebuild(nextRig, Object.fromEntries(entries));
        showSettings();
        saveDraft();
      } catch (error) {
        if (id === loadId) status.textContent = error.message;
      } finally {
        if (id === loadId) loading = false;
      }
    }

    function setNumber(key, value) {
      if (!assembly || loading || value === rig[key]) return;
      if (key === 'leftHinge') value = Math.min(value, rig.rightHinge - .01);
      if (key === 'rightHinge') value = Math.max(value, rig.leftHinge + .01);
      rebuild(rigAPI.normalize({ ...rig, [key]: value }), images);
      controls[key].range.value = rig[key];
      controls[key].output.value = rig[key];
    }

    for (const [key, [label, step]] of Object.entries(labels)) {
      const wrapper = document.createElement('label');
      const output = document.createElement('output'), range = document.createElement('input');
      const [min, max] = rigAPI.limits[key];
      range.type = 'range';
      Object.assign(range, { min, max, step });
      wrapper.append(label, output, range);
      get('settings').append(wrapper);
      controls[key] = { range, output };
      range.addEventListener('input', () => setNumber(key, range.valueAsNumber));
      range.addEventListener('change', () => { if (assembly && !loading) saveDraft(); });
    }

    function wingU(event) {
      const rect = diagram.getBoundingClientRect();
      return (event.clientX - rect.left) / rect.width;
    }

    diagram.addEventListener('pointerdown', event => {
      if (!assembly || loading || activeHinge || event.button !== 0) return;
      const u = wingU(event); // Choose the nearest root, even with a finger covering it.
      const key = Math.abs(u - rig.leftHinge) < Math.abs(u - rig.rightHinge) ? 'leftHinge' : 'rightHinge';
      activeHinge = { key, pointerId: event.pointerId };
      diagram.setPointerCapture(event.pointerId);
      setNumber(key, Math.round(u * 1000) / 1000);
    });
    diagram.addEventListener('pointermove', event => {
      if (activeHinge?.pointerId === event.pointerId) setNumber(activeHinge.key, Math.round(wingU(event) * 1000) / 1000);
    });
    diagram.addEventListener('lostpointercapture', event => {
      if (activeHinge?.pointerId !== event.pointerId) return;
      activeHinge = null;
      if (!loading) saveDraft();
    });

    get('sprites').addEventListener('submit', event => {
      event.preventDefault();
      load({ ...rig, ...Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()])) });
    });
    get('reset').addEventListener('click', () => load(rigAPI.defaults));
    get('open').addEventListener('click', () => get('file').click());
    get('file').addEventListener('change', async event => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        await load(JSON.parse(await file.text()));
      } catch (error) {
        status.textContent = `Invalid rig JSON. ${error.message}`;
      }
    });
    get('save').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(rig, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = rig.flying.split('/').pop().replace(/\.png$/i, '') + '-rig.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    const pose = get('pose'), orbit = get('orbit'), elevation = get('elevation'); // Independent camera and animation controls.
    function showPerched() {
      pose.value = 'perched';
      viewChanged();
    }

    function editPerchSpline(spline) {
      rig.perchSpline = spline;
      perchDirty = true;
      drawPerchSpline();
      showPerched();
    }

    perchLine.addEventListener('change', () => {
      if (!assembly) return;
      drawPerchSpline();
      showPerched();
    });
    get('previewPerch').addEventListener('click', showPerched);
    get('copyPerchBind').addEventListener('click', () => {
      if (!assembly || loading) return;
      editPerchSpline(rigAPI.normalizePerchSpline({ beforePoints: rig.perchSpline?.beforePoints }));
      saveDraft();
    });

    perchCanvas.addEventListener('pointerdown', event => {
      if (!assembly || loading || perchDrag || event.button !== 0) return;
      const bounds = perchCanvas.getBoundingClientRect();
      const spline = rig.perchSpline ?? rigAPI.normalizePerchSpline();
      const key = perchLine.value;
      const padding = perchPadding();
      const sourceHeight = bounds.width * images.perched.height / images.perched.width;
      let distance = 23, index = -1; // Hit radius is in CSS pixels for touch.
      spline[key].forEach((point, i) => {
        const candidate = Math.hypot(bounds.left + point.x * bounds.width - event.clientX,
          bounds.top + (point.y + padding) * sourceHeight - event.clientY);
        if (candidate < distance) {
          distance = candidate;
          index = i;
        }
      });
      if (index < 0) return;
      const followBind = key === 'beforePoints' && spline.beforePoints.every((point, i) =>
        point.x === spline.afterPoints[i].x && point.y === spline.afterPoints[i].y);
      perchDrag = { pointerId: event.pointerId, index, key, spline, followBind };
      perchCanvas.setPointerCapture(event.pointerId);
      showPerched();
    });
    perchCanvas.addEventListener('pointermove', event => {
      if (perchDrag?.pointerId !== event.pointerId || loading) return;
      const { index, key, spline, followBind } = perchDrag;
      const bounds = perchCanvas.getBoundingClientRect();
      const unit = value => Math.max(0, Math.min(1, value));
      const padding = perchPadding();
      const sourceHeight = bounds.width * images.perched.height / images.perched.width;
      const y = (event.clientY - bounds.top) / sourceHeight - padding;
      const point = { x: unit((event.clientX - bounds.left) / bounds.width),
        y: Math.max(-padding, Math.min(1 + padding, y)) };
      spline[key][index] = point;
      if (followBind) spline.afterPoints[index] = { ...point };
      editPerchSpline(spline);
    });
    perchCanvas.addEventListener('lostpointercapture', event => {
      if (perchDrag?.pointerId !== event.pointerId) return;
      perchDrag = null;
      if (!loading) saveDraft();
    });

    const talonEditor = window.createFlyingTalonEditor({
      root: () => assembly?.pitch,
      rig: () => rig,
      changed(save) {
        needsRender = true;
        if (save) saveDraft();
      },
      showFlying() {
        if (pose.value === 'perched') pose.value = 'glide';
        viewChanged();
      },
    });

    function viewChanged() {
      get('orbitValue').value = orbit.value + '°';
      get('elevationValue').value = elevation.value + '°';
      needsRender = true;
    }
    for (const input of [pose, orbit, elevation]) input.addEventListener('input', viewChanged);
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
      elevation.value = button.dataset.view;
      viewChanged();
    }));
    debug.parentElement.addEventListener('toggle', viewChanged);
    new ResizeObserver(viewChanged).observe(canvas);

    renderer.setAnimationLoop(ms => {
      if (!assembly || !canvas.clientWidth || !canvas.clientHeight || document.hidden || (!needsRender && pose.value !== 'flap')) return;
      const birdScale = talonEditor.applyPreviewState(pose.value === 'perched');
      assembly.root.scale.setScalar(birdScale);
      if (perchDirty) {
        assembly.setPerchSpline(rig.perchSpline);
        perchDirty = false;
      }
      if (needsRender) {
        const width = canvas.clientWidth, height = canvas.clientHeight;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        const bodyHalfWidth = Math.max(images.flying.width / images.flying.height, images.perched.width / images.perched.height) / 2;
        const wingHalfSpan = images.wings.width / images.wings.height * rig.wingScale * Math.max(rig.wingCenter, 1 - rig.wingCenter);
        const wingReach = Math.hypot(wingHalfSpan, rig.wingScale / 2 + Math.abs(rig.wingOffset), rig.wingHeight);
        const posedBounds = pose.value === 'perched' ? assembly.perched.geometry.boundingSphere : null;
        const posedExtent = posedBounds ? posedBounds.center.length() + posedBounds.radius : 0;
        const extent = Math.max(Math.hypot(bodyHalfWidth, 0.5), wingReach, posedExtent) * Math.max(1, birdScale); // Keep wide or offset wings inside the orbit view.
        const radius = Math.max(3.4, extent / Math.sin(camera.fov * radians / 2) * 1.12) * Math.max(1, 1 / camera.aspect);
        const azimuth = orbit.valueAsNumber * radians, altitude = elevation.valueAsNumber * radians;
        camera.position.set(radius * Math.sin(azimuth) * Math.cos(altitude), radius * Math.sin(altitude), radius * Math.cos(azimuth) * Math.cos(altitude));
        camera.up.set(-Math.sin(azimuth) * Math.sin(altitude), Math.cos(altitude), -Math.cos(azimuth) * Math.sin(altitude));
        camera.lookAt(0, 0, 0);
        needsRender = false;
      }
      assembly.update(camera, pose.value, ms / 1000, talonEditor.isCarrying());
      if (debug.parentElement.open) {
        const message = `${pose.value} · yaw ${(assembly.yaw.rotation.y / radians).toFixed(1)}° · X correction ${(assembly.pitch.rotation.x / radians).toFixed(1)}° · ${pose.value === 'perched' ? (rig.perchSpline ? '7 body spline points' : 'default body pose') : 'two wing bones'}`;
        if (debug.textContent !== message) debug.textContent = message;
      }
      renderer.render(scene, camera);
    });

    showSettings();
    viewChanged();
    let draft = rig;
    try {
      const stored = localStorage.getItem(draftKey);
      if (stored) draft = rigAPI.normalize(JSON.parse(stored));
    } catch { /* An unavailable or invalid draft falls back to the repository preset. */ }
    load(draft);
  }
})();
