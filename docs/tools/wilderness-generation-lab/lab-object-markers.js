(() => {
  'use strict';

  const THREE = window.THREE;
  const TerrainPreview = window.TerrainPreview;
  const Preview = window.WildernessLabPreview;
  if (!THREE || !TerrainPreview || !Preview) return;

  const COLORS = Object.freeze({
    copse: 0x72451e,
    fallenLog: 0x8a5725,
    stump: 0x7a471f,
    bush: 0x39e84f,
    fruitBush: 0x7ed957,
    mushroomPatch: 0xf4f0d8,
    beehive: 0xd69a26,
    foragePlant: 0xff6fcf,
    rareHerb: 0x8af56b,
    treasureDigspot: 0xffd328,
    diggableRockOre: 0xc8ced3,
    undiggableBoulder: 0x46484d,
    submergedPillar: 0x3e4146,
    statue: 0x303237,
    structure: 0x8a5b2b,
    structureRoof: 0x5c3522,
    caveOpening: 0x171717,
    secretCaveOpening: 0x0c0f14,
    animalDen: 0x4b2d18,
    rootTotem: 0x3bb6a8,
    prey: 0xf3fff1,
    packPredator: 0xff4b4b,
    ambushPredator: 0xff9b38,
    omnivore: 0xb47a38,
    fallback: 0xff00ff,
  });

  let currentMarkerGroup = null; // Detached and disposed before each regenerated preview.
  let attachToken = 0; // Incremented per render so delayed scene-attachment attempts cannot add stale markers.

  function surfaceYAt(merged, x, z) {
    if (!merged) return TerrainPreview.NORMAL_TOP || 0;
    const c = Math.max(0, Math.min(merged.cols - 1, Math.floor(x))); // Tile lookup underneath the marker center.
    const r = Math.max(0, Math.min(merged.rows - 1, Math.floor(z))); // Tile lookup underneath the marker center.
    const tile = merged.tiles.get(`${c},${r}`);
    let y = TerrainPreview.NORMAL_TOP || 0;
    if (tile?.type === 'ramp') y += (Number(tile.rampElevation) || 0) * TerrainPreview.PLATEAU_UNIT;
    else y += (Number(tile?.elevTier) || 0) * TerrainPreview.PLATEAU_UNIT;
    y += TerrainPreview.sampleVisualHeight?.(merged.visualHeights, x, z, merged.cols, merged.rows) || 0;
    return y;
  }

  function markerVerticalScale(merged) {
    const span = Math.max(Number(merged?.cols) || 1, Number(merged?.rows) || 1); // Full-zone span drives deliberate authoring exaggeration.
    return Math.max(8, Math.min(16, span / 24)); // Huge wilderness maps need markers far taller than physical scale to remain legible from the fit camera.
  }

  function removeCurrentMarkers() {
    attachToken++;
    if (!currentMarkerGroup) return;
    currentMarkerGroup.parent?.remove(currentMarkerGroup);
    const geometries = new Set();
    const materials = new Set();
    currentMarkerGroup.traverse(node => {
      if (!node.isMesh) return;
      if (node.geometry) geometries.add(node.geometry);
      if (Array.isArray(node.material)) node.material.forEach(material => materials.add(material));
      else if (node.material) materials.add(node.material);
    });
    geometries.forEach(geometry => geometry.dispose?.());
    materials.forEach(material => material.dispose?.());
    currentMarkerGroup = null;
  }

  function addPart(partsByColor, color, x, y, z, sx, sy, sz) {
    const key = Number(color) >>> 0; // Numeric color key groups thousands of cubes into a handful of InstancedMeshes.
    if (!partsByColor.has(key)) partsByColor.set(key, []);
    partsByColor.get(key).push({ x, y, z, sx, sy, sz });
  }

  function addObjectAssembly(parts, object, merged, yScale) {
    const type = object?.type || 'fallback';
    const width = Math.max(1, Number(object?.w) || 1); // Multi-tile objects preserve their authored footprint in X/Z only.
    const depth = Math.max(1, Number(object?.h) || 1);
    const x = Number(object?.x || 0) + width * 0.5;
    const z = Number(object?.y || 0) + depth * 0.5;
    const groundY = surfaceYAt(merged, x, z);
    const color = COLORS[type] ?? COLORS.fallback;
    const cube = (partColor, px, localY, pz, sx, sy, sz) => addPart(parts, partColor, px, groundY + localY * yScale, pz, sx, sy * yScale, sz); // Vertical-only exaggeration keeps the marker rooted on its actual tile.
    const stack = (partColor, px, pz, count, stackWidth, cubeHeight, baseOffset = 0) => {
      for (let i = 0; i < count; i++) cube(partColor, px, baseOffset + cubeHeight * (i + 0.5), pz, stackWidth, cubeHeight, stackWidth);
    };

    switch (type) {
      case 'copse':
        stack(COLORS.copse, x, z, 3, 0.90, 0.28); // Nearly one tile wide, but intentionally many world units tall at wilderness scale.
        break;
      case 'fallenLog':
        for (let i = -1; i <= 1; i++) cube(COLORS.fallenLog, x + i * 0.28, 0.17, z, 0.30, 0.34, 0.48);
        break;
      case 'stump':
        stack(COLORS.stump, x, z, 2, 0.58, 0.22);
        break;
      case 'bush':
      case 'fruitBush': {
        const bushColor = type === 'fruitBush' ? COLORS.fruitBush : COLORS.bush;
        cube(bushColor, x, 0.22, z, 0.56, 0.44, 0.56);
        cube(bushColor, x - 0.27, 0.18, z + 0.20, 0.38, 0.36, 0.38);
        cube(bushColor, x + 0.27, 0.18, z - 0.20, 0.38, 0.36, 0.38);
        break;
      }
      case 'mushroomPatch':
        cube(COLORS.mushroomPatch, x - 0.20, 0.12, z, 0.24, 0.24, 0.24);
        cube(COLORS.mushroomPatch, x + 0.18, 0.09, z + 0.17, 0.20, 0.18, 0.20);
        cube(COLORS.mushroomPatch, x + 0.05, 0.08, z - 0.22, 0.18, 0.16, 0.18);
        break;
      case 'beehive':
        cube(COLORS.beehive, x, 0.13, z, 0.48, 0.26, 0.48);
        cube(COLORS.beehive, x, 0.34, z, 0.38, 0.18, 0.38);
        cube(COLORS.beehive, x, 0.50, z, 0.28, 0.14, 0.28);
        break;
      case 'foragePlant':
      case 'rareHerb': {
        const plantColor = type === 'rareHerb' ? COLORS.rareHerb : COLORS.foragePlant;
        cube(plantColor, x, 0.10, z, 0.22, 0.20, 0.22);
        cube(plantColor, x - 0.20, 0.07, z + 0.12, 0.16, 0.14, 0.16);
        cube(plantColor, x + 0.20, 0.07, z - 0.12, 0.16, 0.14, 0.16);
        break;
      }
      case 'treasureDigspot':
        cube(COLORS.treasureDigspot, x, 0.055, z, 0.72, 0.11, 0.72);
        cube(COLORS.treasureDigspot, x, 0.19, z, 0.24, 0.27, 0.24);
        break;
      case 'diggableRockOre':
      case 'undiggableBoulder': {
        const rockColor = type === 'diggableRockOre' ? COLORS.diggableRockOre : COLORS.undiggableBoulder;
        cube(rockColor, x, 0.24, z, 0.58, 0.48, 0.58);
        cube(rockColor, x - 0.26, 0.15, z + 0.19, 0.34, 0.30, 0.34);
        cube(rockColor, x + 0.24, 0.13, z - 0.20, 0.30, 0.26, 0.30);
        break;
      }
      case 'statue':
        cube(COLORS.statue, x, 0.12, z, 0.70, 0.24, 0.70);
        stack(COLORS.statue, x, z, 3, 0.40, 0.36, 0.24);
        break;
      case 'submergedPillar':
        stack(COLORS.submergedPillar, x, z, 4, 0.48, 0.34);
        break;
      case 'caveOpening':
      case 'secretCaveOpening': {
        const caveColor = type === 'secretCaveOpening' ? COLORS.secretCaveOpening : COLORS.caveOpening;
        cube(caveColor, x - 0.30, 0.34, z, 0.30, 0.68, 0.34);
        cube(caveColor, x + 0.30, 0.34, z, 0.30, 0.68, 0.34);
        cube(caveColor, x, 0.72, z, 0.88, 0.24, 0.34);
        break;
      }
      case 'animalDen':
        cube(COLORS.animalDen, x - 0.32, 0.18, z, 0.36, 0.36, 0.54);
        cube(COLORS.animalDen, x + 0.32, 0.18, z, 0.36, 0.36, 0.54);
        cube(COLORS.animalDen, x, 0.42, z, 0.96, 0.24, 0.54);
        cube(COLORS.animalDen, x - 0.38, 0.08, z + 0.32, 0.30, 0.16, 0.30);
        cube(COLORS.animalDen, x + 0.38, 0.08, z + 0.32, 0.30, 0.16, 0.30);
        break;
      case 'rootTotem':
        cube(COLORS.rootTotem, x, 0.12, z, 0.72, 0.24, 0.72);
        stack(COLORS.rootTotem, x, z, 3, 0.36, 0.34, 0.24);
        break;
      case 'structure': {
        const sx = Math.max(0.8, Math.min(4.5, width * 0.78));
        const sz = Math.max(0.8, Math.min(4.5, depth * 0.78));
        cube(COLORS.structure, x - sx * 0.34, 0.32, z, sx * 0.28, 0.64, sz);
        cube(COLORS.structure, x + sx * 0.34, 0.32, z, sx * 0.28, 0.64, sz);
        cube(COLORS.structure, x, 0.32, z - sz * 0.34, sx * 0.48, 0.64, sz * 0.28);
        cube(COLORS.structure, x, 0.32, z + sz * 0.34, sx * 0.48, 0.64, sz * 0.28);
        cube(COLORS.structureRoof, x, 0.75, z, sx, 0.22, sz);
        break;
      }
      default:
        cube(color, x, 0.22, z, 0.48, 0.44, 0.48);
        cube(color, x - 0.30, 0.12, z, 0.22, 0.24, 0.22);
        cube(color, x + 0.30, 0.12, z, 0.22, 0.24, 0.22);
        break;
    }
  }

  function addAnimalAssembly(parts, agent, merged, index, yScale) {
    const anchor = agent?.denAnchor;
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
    const kind = agent.kind || 'fallback';
    const color = COLORS[kind] ?? COLORS.fallback;
    const angle = index * 2.399963; // Golden-angle scatter keeps animals assigned to one den from perfectly overlapping.
    const radius = 0.18 + 0.06 * (index % 3);
    const x = anchor.x + Math.cos(angle) * radius;
    const z = anchor.y + Math.sin(angle) * radius;
    const groundY = surfaceYAt(merged, x, z);
    addPart(parts, color, x, groundY + 0.16 * yScale, z, 0.36, 0.32 * yScale, 0.44);
    addPart(parts, color, x, groundY + 0.39 * yScale, z - 0.14, 0.28, 0.20 * yScale, 0.28);
  }

  function buildMarkerGroup(workspace, merged) {
    const partsByColor = new Map(); // Color bucket -> individual cube transforms rendered with instancing.
    const objectCounts = {};
    const yScale = markerVerticalScale(merged); // One map-size-aware exaggeration factor is shared by every marker in this render.
    for (const object of workspace?.objects || []) {
      objectCounts[object.type || 'unknown'] = (objectCounts[object.type || 'unknown'] || 0) + 1;
      addObjectAssembly(partsByColor, object, merged, yScale);
    }
    const animalCounts = {};
    const agents = workspace?.animalActivity?.agents || [];
    agents.forEach((agent, index) => {
      animalCounts[agent.kind || 'unknown'] = (animalCounts[agent.kind || 'unknown'] || 0) + 1;
      addAnimalAssembly(partsByColor, agent, merged, index, yScale);
    });
    const group = new THREE.Group();
    group.name = 'wilderness_lab_object_cube_markers';
    const geometry = new THREE.BoxGeometry(1, 1, 1); // Every marker remains an assembly made only from cubes.
    let cubeCount = 0;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    for (const [color, parts] of partsByColor) {
      if (!parts.length) continue;
      const material = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
      const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
      mesh.name = `marker_cubes_${color.toString(16).padStart(6, '0')}`;
      mesh.frustumCulled = false;
      parts.forEach((part, i) => {
        position.set(part.x, part.y, part.z);
        scale.set(part.sx, part.sy, part.sz);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      cubeCount += parts.length;
    }
    group.userData.markerStats = { objectCounts, animalCounts, cubeCount, verticalScale: yScale };
    return group;
  }

  function colorCss(type) {
    const color = COLORS[type] ?? COLORS.fallback;
    return `#${color.toString(16).padStart(6, '0')}`;
  }

  function updateLegend(stats) {
    const stage = document.getElementById('stage');
    if (!stage) return;
    let legend = document.getElementById('cubeMarkerLegend');
    if (!legend) {
      legend = document.createElement('div');
      legend.id = 'cubeMarkerLegend';
      Object.assign(legend.style, {
        position: 'absolute', left: '9px', bottom: '9px', zIndex: '6', maxWidth: '58%', maxHeight: '28%', overflow: 'auto',
        background: 'rgba(4,8,13,.80)', border: '1px solid rgba(255,255,255,.13)', borderRadius: '9px', padding: '6px 7px',
        fontSize: '9px', lineHeight: '1.35', pointerEvents: 'none', backdropFilter: 'blur(4px)', color: '#dbeafe',
      });
      stage.appendChild(legend);
    }
    const chips = [];
    for (const [type, count] of Object.entries(stats.objectCounts).sort((a, b) => b[1] - a[1])) chips.push(`<span style="white-space:nowrap"><i style="display:inline-block;width:8px;height:8px;background:${colorCss(type)};border:1px solid rgba(255,255,255,.3);margin-right:3px"></i>${type} ${count}</span>`);
    for (const [kind, count] of Object.entries(stats.animalCounts).sort((a, b) => b[1] - a[1])) chips.push(`<span style="white-space:nowrap"><i style="display:inline-block;width:8px;height:8px;background:${colorCss(kind)};border:1px solid rgba(255,255,255,.3);margin-right:3px"></i>${kind} ${count}</span>`);
    legend.innerHTML = `<b>Cube object markers · vertical ×${stats.verticalScale.toFixed(1)} · ${stats.cubeCount.toLocaleString()} cubes</b><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${chips.join('')}</div>`;
  }

  function attachMarkerGroup(group, token, attempts = 0) {
    if (token !== attachToken) return;
    const scene = [...(window.__wildernessLabScenes || [])][0];
    if (!scene) {
      if (attempts < 20) requestAnimationFrame(() => attachMarkerGroup(group, token, attempts + 1));
      return;
    }
    currentMarkerGroup = group;
    scene.add(group);
    window.__wildernessLabMarkerStats = group.userData.markerStats;
    updateLegend(group.userData.markerStats);
    console.log('[WildernessLab] cube markers:', group.userData.markerStats);
  }

  const originalRenderWorkspace = Preview.renderWorkspace.bind(Preview); // Terrain renderer remains authoritative; markers are a post-render schematic layer.
  Preview.renderWorkspace = (workspace, rootId, winterSettings) => {
    removeCurrentMarkers();
    const merged = originalRenderWorkspace(workspace, rootId, winterSettings);
    const markerGroup = buildMarkerGroup(workspace, merged);
    const token = attachToken;
    attachMarkerGroup(markerGroup, token);
    return merged;
  };

  Preview.getMarkerStats = () => window.__wildernessLabMarkerStats || null;
  Preview.markerColors = COLORS;
})();