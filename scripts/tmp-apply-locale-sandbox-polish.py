from pathlib import Path

p = Path('docs/tools/locale-editor/locale-preview3d.js')
s = p.read_text()

def rep(old, new):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'expected one match, found {count}: {old[:90]!r}')
    s = s.replace(old, new, 1)

rep(
    "    await loadScript('../../js/terrain-preview.js', () => !!window.TerrainPreview?.buildMergedZoneGrid);",
    "    await loadScript('../../js/portrait-utils.js', () => !!window.getShadeFillCanvas && !!window.parseHexColor);\n    await loadScript('../../js/terrain-preview.js', () => !!window.TerrainPreview?.buildMergedZoneGrid);",
)

rep(
'''      new THREE.TextureLoader().load(`../../assets/textures/${override.texture}`, loaded => {
        loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping;
        if (Array.isArray(override.stretch) && override.stretch.length === 2) {
          loaded.repeat.set(1 / Math.max(0.05, override.stretch[0]), 1 / Math.max(0.05, override.stretch[1]));
        } else {
          const tileSize = Math.max(0.05, override.tileSize || 1);
          loaded.repeat.set(1 / tileSize, 1 / tileSize);
        }
        loaded.needsUpdate = true;
        material.map = loaded;
        material.color.set(0xffffff);
        material.needsUpdate = true;
      }, undefined, () => {});''',
'''      new THREE.TextureLoader().load(`../../assets/textures/${override.texture}`, loaded => {
        try {
          let finalTexture = loaded;
          const rgb = override.fillColor && window.parseHexColor?.(override.fillColor);
          if (rgb && typeof window.getShadeFillCanvas === 'function') {
            const tinted = window.getShadeFillCanvas(loaded.image, `${override.texture}|${override.fillColor}`, {
              mode: 'shadeFill', rgb: [rgb.r, rgb.g, rgb.b], options: window.getPortraitTintingConfig?.(),
            });
            finalTexture = new THREE.CanvasTexture(tinted);
            loaded.dispose?.();
          }
          finalTexture.wrapS = finalTexture.wrapT = THREE.RepeatWrapping;
          if (Array.isArray(override.stretch) && override.stretch.length === 2) {
            finalTexture.repeat.set(1 / Math.max(0.05, override.stretch[0]), 1 / Math.max(0.05, override.stretch[1]));
          } else {
            const tileSize = Math.max(0.05, override.tileSize || 1);
            finalTexture.repeat.set(1 / tileSize, 1 / tileSize);
          }
          finalTexture.needsUpdate = true;
          material.map = finalTexture;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        } catch (_) {}
      }, undefined, () => {});''',
)

start = s.index('  function scanFailureCandidates(workspace, locale, seed) {')
end = s.index('  function virtualInstance(locale, candidate) {', start)
s = s[:start] + '''  function findFailureCandidate(workspace, locale, seed, mode) {
    const Placement = window.LocaleTerrainPlacement;
    const root = rootMap(workspace);
    if (!root) return null;
    const scale = Math.max(1, Placement.inferGenerationScale(workspace));
    const compiled = Placement.compileLocale(locale, scale);
    if (!compiled) return null;
    const step = scale;
    const minC = -compiled.bounds.minC, minR = -compiled.bounds.minR;
    const maxC = root.cols - 1 - compiled.bounds.maxC, maxR = root.rows - 1 - compiled.bounds.maxR;
    const target = 0.52;
    let best = null;
    for (let r = minR; r <= maxR; r += step) {
      for (let c = minC; c <= maxC; c += step) {
        const result = Placement.evaluateCandidateForTest(workspace, locale, c, r, { scale, seed });
        if (result.ok) continue;
        const closeness = candidateCloseness(result, compiled);
        const item = { anchorC: c, anchorR: r, scale, result, closeness };
        if (mode === 'almost') {
          if (!best || closeness > best.closeness) best = item;
        } else {
          const distance = Math.abs(closeness - target);
          if (!best || distance < best.distance) best = { ...item, distance };
        }
      }
    }
    return best;
  }
''' + s[end:]

rep(
'''    const workspace = Generator.generateZoneWorkspace(zoneId, seed, []);
    const failures = scanFailureCandidates(workspace, locale, seed);
    if (scenario === 'random') {''',
'''    const workspace = Generator.generateZoneWorkspace(zoneId, seed, []);
    if (scenario === 'random') {''',
)
rep(
'''    const picked = chooseFailure(failures, scenario);
    if (!picked) return { workspace, instance: null, seed, kind: 'no-candidate', reason: 'No rejected candidates found on this seed' };''',
'''    const picked = findFailureCandidate(workspace, locale, seed, scenario);
    if (!picked) return { workspace, instance: null, seed, kind: 'no-candidate', reason: 'No rejected candidates found on this seed' };''',
)

marker = '  function addRuleOverlay(locale, instance, candidate, merged) {'
if s.count(marker) != 1:
    raise SystemExit('rule overlay marker missing')
helpers = '''  function renderAnchorMarkers(group, instance, merged, ghost) {
    for (const anchor of instance?.npcAnchors || []) {
      const x = Number(anchor.x) + 0.5, z = Number(anchor.y) + 0.5;
      const y = surfaceY(merged, x, z);
      if (anchor.npcId === 'banubu') {
        const material = new THREE.SpriteMaterial({ map: new THREE.TextureLoader().load('../../assets/creaturesprites/grehlr_idle.png'), transparent: true, opacity: ghost ? 0.58 : 1, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(2.2, 2.2 / 0.75, 1);
        sprite.position.set(x, y + sprite.scale.y * 0.5, z);
        group.add(sprite);
      } else {
        const material = new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: ghost, opacity: ghost ? 0.52 : 0.9 });
        const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.8, 10), material);
        marker.position.set(x, y + 0.4, z);
        group.add(marker);
      }
    }
    for (const connector of instance?.connectors || []) {
      const x = Number(connector.x) + 0.5, z = Number(connector.y) + 0.5;
      const y = surfaceY(merged, x, z) + 0.09;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.055, 8, 20), new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: ghost ? 0.48 : 0.92 }));
      ring.rotation.x = Math.PI * 0.5;
      ring.position.set(x, y, z);
      group.add(ring);
    }
  }

  function ghostCaveGroupWhenReady(token) {
    const started = performance.now();
    const poll = () => {
      if (token !== generationToken) return;
      const group = scene?.getObjectByName('animalDenEntrances');
      if (!group) { if (performance.now() - started < 2500) requestAnimationFrame(poll); return; }
      tintGhost(group, true);
    };
    poll();
  }

'''
s = s.replace(marker, helpers + marker, 1)

rep(
'''    for (const object of instance.objects || []) {
      if (object.key === 'cave_small' || locale.objects?.find(source => source.id === object.id)?.visual?.renderer === 'cave_small') continue;
      const loaded = await addGlbObject(group, object, merged, token, ghost);
      if (!loaded && token === generationToken) addFallbackObject(group, object, merged, ghost);
    }

    if (token !== generationToken) return;''',
'''    for (const object of instance.objects || []) {
      if (object.key === 'cave_small' || locale.objects?.find(source => source.id === object.id)?.visual?.renderer === 'cave_small') continue;
      const loaded = await addGlbObject(group, object, merged, token, ghost);
      if (!loaded && token === generationToken) addFallbackObject(group, object, merged, ghost);
    }
    renderAnchorMarkers(group, instance, merged, ghost);

    if (token !== generationToken) return;''',
)
rep(
'''    window.ZoneDenTotemFeatures.buildAnimalDenMeshes(scene, terrainRoot.userData.zGrid, [], PREVIEW_MAP_ID);
  }''',
'''    window.ZoneDenTotemFeatures.buildAnimalDenMeshes(scene, terrainRoot.userData.zGrid, [], PREVIEW_MAP_ID);
    if (ghost) ghostCaveGroupWhenReady(token);
  }''',
)

p.write_text(s)
