// Shared authored/procedural ruin-room definitions. V50 still owns topology,
// corridor construction, wall derivation and plateau geometry; this module
// supplies room masks and the same named placement/allowlist contract to both
// fixed templates and ordinary generated rooms.
(() => {
  'use strict';

  const SCHEMA = 'hobunji_ruin_room_library.v1';
  const STORAGE_KEY = 'hobunji.devRuinRoomLibrary.v1';
  const LIBRARY_URL = new URL('../config/ruin-room-authoring/room-library.json', new URL('.', document.currentScript?.src || document.baseURI)).href; // Resolve from this shared module so both docs/index.html and the nested editor iframe read the same repository library.
  const CATEGORIES = ['mechanisms', 'activators', 'decorations'];
  const claimsByPlan = new Map(); // Stable keys survive V50's JSON clone between generation and runtime composition.
  const diagnosticsByPlan = new Map(); // Shared claims/rejections are visible from the cloned gameplay metadata.
  const puzzleLinksByPlan = new Map();
  let library = { schema:SCHEMA, templates:[], proceduralProfiles:[] };
  let loadPromise = null;
  let nextNetworkId = 1; // Distinguishes active/recent generated layouts even when their room IDs and seeds are identical.
  let loadReport = { source:'defaults', errors:[], warnings:[] };

  const clone = value => JSON.parse(JSON.stringify(value));
  const idOf = value => String(value == null ? '' : value).trim();
  const positiveInt = (value, fallback) => {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  const list = value => Array.isArray(value) ? value.map(idOf).filter(Boolean) : [];
  const hash = value => {
    let out = 2166136261;
    for (const char of String(value)) {
      out ^= char.charCodeAt(0);
      out = Math.imul(out, 16777619);
    }
    return out >>> 0;
  };
  const rngFor = seed => {
    let state = hash(seed) || 0x6d2b79f5;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  };
  const weightedPick = (items, rng) => {
    const total = items.reduce((sum, entry) => sum + Math.max(0, Number(entry.weight) || 0), 0);
    if (!total) return null;
    let roll = rng() * total;
    for (const entry of items) {
      roll -= Math.max(0, Number(entry.weight) || 0);
      if (roll < 0) return entry;
    }
    return items[items.length - 1] || null;
  };
  const emptyAllowlist = () => ({ mechanisms:['*'], activators:['*'], decorations:['*'] });

  function normalizeSpot(raw, index, mode) {
    const point = raw && typeof raw === 'object' ? raw : {};
    const allow = point.allowlists || point.allow || {};
    return {
      id:idOf(point.id) || 'spot-' + (index + 1),
      label:idOf(point.label) || idOf(point.id) || 'Placement ' + (index + 1),
      x:Number(point.x ?? point.u ?? .5),
      z:Number(point.z ?? point.v ?? .5),
      coordinateMode:mode,
      required:point.required === true,
      maxUses:positiveInt(point.maxUses, 1),
      clearance:Math.max(0, Number(point.clearance) || 0),
      allowlists:{
        mechanisms:list(allow.mechanisms),
        activators:list(allow.activators),
        decorations:list(allow.decorations || allow.decor),
      },
    };
  }

  function normalizeTemplate(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const footprint = source.footprint || {};
    const rows = Array.isArray(footprint.rows) ? footprint.rows.map(row => String(row)) : [];
    const width = positiveInt(footprint.width, rows[0]?.length || 0);
    const height = positiveInt(footprint.height, rows.length);
    return {
      id:idOf(source.id),
      name:idOf(source.name) || idOf(source.id),
      enabled:source.enabled === true,
      weight:Math.max(0, Number(source.weight ?? 1) || 0),
      rotations:Array.isArray(source.rotations) ? source.rotations.map(Number).filter(value => [0,90,180,270].includes(value)) : [0],
      match:{
        minDoors:Math.max(0, Math.floor(Number(source.match?.minDoors) || 0)),
        maxDoors:Number.isFinite(Number(source.match?.maxDoors)) ? Math.max(0, Math.floor(Number(source.match.maxDoors))) : 99,
        roomIds:list(source.match?.roomIds),
      },
      footprint:{ width, height, rows },
      connections:Array.isArray(source.connections) ? source.connections.map((entry,index)=>({
        id:idOf(entry?.id) || 'connection-' + (index + 1),
        side:['north','east','south','west'].includes(entry?.side) ? entry.side : 'north',
        offset:Number(entry?.offset ?? 0),
        width:positiveInt(entry?.width, 1),
        kind:entry?.kind === 'entrance' ? 'entrance' : 'corridor',
        required:entry?.required !== false,
      })) : [],
      spots:Array.isArray(source.spots) ? source.spots.map((spot,index)=>normalizeSpot(spot,index,'cell')) : [],
      puzzleLinks:Array.isArray(source.puzzleLinks) ? source.puzzleLinks.map((link,index)=>({
        id:idOf(link?.id) || 'link-' + (index + 1),
        activatorSpot:idOf(link?.activatorSpot),
        mechanismSpot:idOf(link?.mechanismSpot),
        relation:idOf(link?.relation) || 'activates',
        required:link?.required !== false,
      })) : [],
    };
  }

  function normalizeProfile(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const match = source.match || {};
    return {
      id:idOf(source.id),
      name:idOf(source.name) || idOf(source.id),
      enabled:source.enabled !== false,
      weight:Math.max(0, Number(source.weight ?? 1) || 0),
      match:{
        minWidth:Math.max(1, Math.floor(Number(match.minWidth) || 1)),
        maxWidth:Number.isFinite(Number(match.maxWidth)) ? Math.max(1,Math.floor(Number(match.maxWidth))) : 999,
        minHeight:Math.max(1, Math.floor(Number(match.minHeight) || 1)),
        maxHeight:Number.isFinite(Number(match.maxHeight)) ? Math.max(1,Math.floor(Number(match.maxHeight))) : 999,
        minDoors:Math.max(0,Math.floor(Number(match.minDoors) || 0)),
        maxDoors:Number.isFinite(Number(match.maxDoors)) ? Math.max(0,Math.floor(Number(match.maxDoors))) : 99,
        sizeClasses:list(match.sizeClasses),
        roomIds:list(match.roomIds),
      },
      spots:Array.isArray(source.spots) ? source.spots.map((spot,index)=>normalizeSpot(spot,index,'normalized')) : [],
      puzzleLinks:Array.isArray(source.puzzleLinks) ? source.puzzleLinks.map((link,index)=>({
        id:idOf(link?.id) || 'link-' + (index + 1),
        activatorSpot:idOf(link?.activatorSpot),
        mechanismSpot:idOf(link?.mechanismSpot),
        relation:idOf(link?.relation) || 'activates',
        required:link?.required !== false,
      })) : [],
    };
  }

  function validateFootprint(footprint, label, errors) {
    const width = footprint.width, height = footprint.height, rows = footprint.rows;
    if (width < 3 || height < 3 || width > 48 || height > 48) {
      errors.push(label + ': footprint dimensions must be between 3 and 48 cells.');
      return false;
    }
    if (rows.length !== height || rows.some(row => row.length !== width || /[^#.]/.test(row))) {
      errors.push(label + ': footprint rows must be ' + width + ' cells wide and ' + height + ' rows high; use # for floor and . for void.');
      return false;
    }
    const floor = new Set();
    rows.forEach((row,z)=>[...row].forEach((cell,x)=>{if(cell==='#')floor.add(x+','+z);}));
    if (!floor.size) {
      errors.push(label + ': footprint needs at least one walkable cell.');
      return false;
    }
    const start = floor.values().next().value, queue = [start], seen = new Set([start]);
    while (queue.length) {
      const [x,z] = queue.shift().split(',').map(Number);
      for (const key of [(x+1)+','+z,(x-1)+','+z,x+','+(z+1),x+','+(z-1)]) {
        if (floor.has(key) && !seen.has(key)) { seen.add(key); queue.push(key); }
      }
    }
    if (seen.size !== floor.size) errors.push(label + ': walkable footprint must be one connected shape.');
    return seen.size === floor.size;
  }

  function validateSpots(definition, label, errors) {
    const ids = new Set();
    for (const spot of definition.spots || []) {
      if (!spot.id || ids.has(spot.id)) errors.push(label + ': placement spot ids must be non-empty and unique (' + spot.id + ').');
      ids.add(spot.id);
      if (definition.footprint?.rows) {
        const x = Math.floor(spot.x), z = Math.floor(spot.z);
        if (spot.coordinateMode === 'cell' && (z < 0 || z >= definition.footprint.height || x < 0 || x >= definition.footprint.width || definition.footprint.rows[z]?.[x] !== '#')) {
          errors.push(label + ': spot ' + spot.id + ' must be positioned on a walkable footprint cell.');
        }
      } else if (!Number.isFinite(spot.x) || !Number.isFinite(spot.z) || spot.x < 0 || spot.x > 1 || spot.z < 0 || spot.z > 1) {
        errors.push(label + ': procedural spot ' + spot.id + ' must use normalized x/z coordinates from 0 to 1.');
      }
      for (const category of CATEGORIES) {
        if (!Array.isArray(spot.allowlists[category])) errors.push(label + ': spot ' + spot.id + ' is missing its ' + category + ' allowlist.');
      }
    }
    return ids;
  }

  function validateLinks(definition, label, spotIds, errors) {
    const activators = new Set((definition.spots || []).filter(spot=>spot.allowlists.activators.length).map(spot=>spot.id));
    const mechanisms = new Set((definition.spots || []).filter(spot=>spot.allowlists.mechanisms.length).map(spot=>spot.id));
    for (const link of definition.puzzleLinks || []) {
      if (!spotIds.has(link.activatorSpot) || !spotIds.has(link.mechanismSpot)) errors.push(label + ': puzzle link ' + link.id + ' references a missing spot.');
      if (!activators.has(link.activatorSpot)) errors.push(label + ': puzzle link ' + link.id + ' starts at a spot without an activator allowlist.');
      if (!mechanisms.has(link.mechanismSpot)) errors.push(label + ': puzzle link ' + link.id + ' ends at a spot without a mechanism allowlist.');
    }
  }

  function normalizeLibrary(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const normalized = {
      schema:SCHEMA,
      version:1,
      templates:Array.isArray(source.templates) ? source.templates.map(normalizeTemplate) : [],
      proceduralProfiles:Array.isArray(source.proceduralProfiles) ? source.proceduralProfiles.map(normalizeProfile) : [],
    };
    const errors = [], ids = new Set();
    if (source.schema !== SCHEMA) errors.push('Room library schema must be '+SCHEMA+'.');
    if (source.version != null && Number(source.version) !== 1) errors.push('Unsupported room library version: '+source.version+'.');
    for (const template of normalized.templates) {
      if (!template.id || ids.has(template.id)) errors.push('Template ids must be non-empty and unique (' + template.id + ').');
      ids.add(template.id);
      validateFootprint(template.footprint, template.name || template.id || 'Template', errors);
      if (!template.rotations.length) errors.push(template.name + ': choose at least one allowed rotation.');
      const connectionIds = new Set();
      for (const connection of template.connections) {
        if (!connection.id || connectionIds.has(connection.id)) errors.push(template.name + ': connection ids must be non-empty and unique (' + connection.id + ').');
        connectionIds.add(connection.id);
      }
      const puzzleLinkIds = new Set();
      for (const link of template.puzzleLinks) {
        if (!link.id || puzzleLinkIds.has(link.id)) errors.push(template.name + ': puzzle link ids must be non-empty and unique (' + link.id + ').');
        puzzleLinkIds.add(link.id);
      }
      const spots = validateSpots(template, template.name || template.id, errors);
      validateLinks(template, template.name || template.id, spots, errors);
      for (const connection of template.connections) {
        const limit = connection.side === 'north' || connection.side === 'south' ? template.footprint.width : template.footprint.height;
        if (!Number.isFinite(connection.offset) || connection.offset < 0 || connection.offset > limit || connection.width < 1 || connection.offset - connection.width / 2 < 0 || connection.offset + connection.width / 2 > limit) {
          errors.push(template.name + ': connection ' + connection.id + ' does not fit along its ' + connection.side + ' edge.');
        }
      }
    }
    ids.clear();
    for (const profile of normalized.proceduralProfiles) {
      if (!profile.id || ids.has(profile.id)) errors.push('Procedural profile ids must be non-empty and unique (' + profile.id + ').');
      ids.add(profile.id);
      const spots = validateSpots(profile, profile.name || profile.id, errors);
      validateLinks(profile, profile.name || profile.id, spots, errors);
    }
    return { library:normalized, errors };
  }

  function rotateTemplate(template, rotation) {
    let rows = template.footprint.rows.slice(), width = template.footprint.width, height = template.footprint.height;
    let spots = template.spots.map(spot=>({...spot}));
    let connections = template.connections.map(connection=>({...connection}));
    const turns = rotation / 90;
    for (let turn=0; turn<turns; turn++) {
      const nextRows = Array.from({length:width},(_,z)=>Array.from({length:height},(_,x)=>rows[height-1-x][z]).join(''));
      rows = nextRows;
      spots = spots.map(spot=>({...spot,x:height-1-spot.z,z:spot.x}));
      connections = connections.map(connection=>{
        const side = ({north:'east',east:'south',south:'west',west:'north'})[connection.side];
        const offset = connection.side === 'east' || connection.side === 'west' ? height - connection.offset : connection.offset;
        return {...connection,side,offset};
      });
      [width,height] = [height,width];
    }
    return {...template,rotation,footprint:{width,height,rows},spots,connections};
  }

  function sideForDoor(door, room) {
    const axis = door.axis === 'z' ? 'z' : 'x';
    const boundary = Number(door.boundary), center = Number(door.center);
    if (axis === 'x') {
      if (Math.abs(boundary - room.col) < .01) return {side:'west',offset:center-room.row,width:Number(door.widthCells)||1};
      if (Math.abs(boundary - room.col-room.w) < .01) return {side:'east',offset:center-room.row,width:Number(door.widthCells)||1};
    } else {
      if (Math.abs(boundary - room.row) < .01) return {side:'north',offset:center-room.col,width:Number(door.widthCells)||1};
      if (Math.abs(boundary - room.row-room.h) < .01) return {side:'south',offset:center-room.col,width:Number(door.widthCells)||1};
    }
    return null;
  }

  function cellKey(x,z) { return x + ',' + z; }

  function connectionCellsFit(rows, connection) {
    const width = rows[0]?.length || 0, height = rows.length;
    const alongLimit = connection.side === 'north' || connection.side === 'south' ? width : height;
    const start = Math.floor(connection.offset - connection.width / 2);
    const end = Math.ceil(connection.offset + connection.width / 2);
    for (let along=start; along<end; along++) {
      const x = connection.side === 'west' ? 0 : connection.side === 'east' ? width-1 : along;
      const z = connection.side === 'north' ? 0 : connection.side === 'south' ? height-1 : along;
      if (rows[z]?.[x] !== '#') return false;
    }
    return true;
  }

  function connectionsFit(template, network, room) {
    const actual = [];
    for (const door of network.doorways || []) {
      if (door.from !== room.id && door.to !== room.id) continue;
      const side = sideForDoor(door, room);
      if (!side) return false;
      actual.push({...side,kind:'corridor'});
    }
    if (network.entrance?.roomId === room.id) {
      const entrance = network.entrance;
      actual.push({side:entrance.side,offset:Number(entrance.center)-(entrance.axis==='x'?room.row:room.col),width:Number(entrance.widthCells)||1,kind:'entrance'});
    }
    for (const door of actual) {
      const candidate = template.connections.find(connection=>connection.kind===door.kind&&connection.side===door.side&&Math.abs(connection.offset-door.offset)<=.51&&connection.width+.01>=door.width);
      if (!candidate || !connectionCellsFit(template.footprint.rows, candidate)) return false;
    }
    for (const connection of template.connections.filter(entry=>entry.required)) {
      if (!actual.some(door=>door.kind===connection.kind&&door.side===connection.side&&Math.abs(connection.offset-door.offset)<=.51&&connection.width<=door.width+.01)) return false;
    }
    return true;
  }

  function templateFits(template, network, room, rotation) {
    const oriented = rotateTemplate(template, rotation);
    if (oriented.footprint.width !== Number(room.w) || oriented.footprint.height !== Number(room.h)) return null;
    if (template.match.roomIds.length && !template.match.roomIds.includes(String(room.id))) return null;
    const doorCount = (network.doorways || []).filter(door=>door.from===room.id||door.to===room.id).length + (network.entrance?.roomId===room.id ? 1 : 0);
    if (doorCount < template.match.minDoors || doorCount > template.match.maxDoors) return null;
    if (!connectionsFit(oriented, network, room)) return null;
    const cells = new Set();
    oriented.footprint.rows.forEach((row,z)=>[...row].forEach((value,x)=>{if(value==='#')cells.add(cellKey(x,z));}));
    if (!cells.size) return null;
    const start = cells.values().next().value, queue = [start], seen = new Set([start]);
    while (queue.length) {
      const [x,z] = queue.shift().split(',').map(Number);
      for (const key of [cellKey(x+1,z),cellKey(x-1,z),cellKey(x,z+1),cellKey(x,z-1)]) {
        if (cells.has(key) && !seen.has(key)) {seen.add(key);queue.push(key);}
      }
    }
    return seen.size === cells.size ? oriented : null;
  }

  function templateCandidates(network, room) {
    const matches = [];
    for (const template of library.templates) {
      if (!template.enabled || template.weight <= 0) continue;
      for (const rotation of template.rotations) {
        const oriented = templateFits(template, network, room, rotation);
        if (oriented) matches.push({template,oriented,weight:template.weight});
      }
    }
    return matches;
  }

  function profileMatches(profile, room, doorCount) {
    const match = profile.match;
    return profile.enabled && profile.weight > 0 &&
      room.w >= match.minWidth && room.w <= match.maxWidth &&
      room.h >= match.minHeight && room.h <= match.maxHeight &&
      doorCount >= match.minDoors && doorCount <= match.maxDoors &&
      (!match.sizeClasses.length || match.sizeClasses.includes(String(room.sizeClass || ''))) &&
      (!match.roomIds.length || match.roomIds.includes(String(room.id)));
  }

  function makeSpots(definition, room, network) {
    const cs = Number(network.cellSize) || .5;
    const pad = Number(network.worldPad ?? 2); // Match dev-random-ruin-simple-puzzles.js cellWorld(): V50 world coordinates use a two-unit pad, not a centered grid origin.
    return definition.spots.map(spot=>{
      const x = spot.coordinateMode === 'cell' ? Number(spot.x)+.5 : Number(spot.x)*room.w;
      const z = spot.coordinateMode === 'cell' ? Number(spot.z)+.5 : Number(spot.z)*room.h;
      return {
        ...clone(spot),
        localCell:{x:room.col+x,z:room.row+z},
        world:{x:pad+(room.col+x)*cs,z:pad+(room.row+z)*cs},
      };
    });
  }

  function planForRoom(network, room, seed) {
    const rng = rngFor(seed + ':' + room.id);
    const templateVariants = templateCandidates(network, room);
    const templateGroups = new Map(); // Rotation count must not multiply a template's selection weight against procedural profiles.
    for (const variant of templateVariants) {
      let group = templateGroups.get(variant.template.id);
      if (!group) {group={template:variant.template,variants:[],weight:variant.template.weight,source:'template'};templateGroups.set(variant.template.id,group);}
      group.variants.push(variant.oriented);
    }
    const doorCount = (network.doorways || []).filter(door=>door.from===room.id||door.to===room.id).length + (network.entrance?.roomId===room.id ? 1 : 0);
    const profiles = library.proceduralProfiles.filter(profile=>profileMatches(profile,room,doorCount));
    const choices = [
      ...[...templateGroups.values()],
      ...profiles.map(profile=>({profile,weight:profile.weight,source:'procedural'})),
    ];
    const choice = weightedPick(choices,rng);
    if (choice?.source === 'template') {
      const oriented = choice.variants[Math.floor(rng()*choice.variants.length)];
      return {
        roomId:String(room.id),
        source:'template',
        templateId:choice.template.id,
        templateName:choice.template.name,
        rotation:oriented.rotation,
        footprint:clone(oriented.footprint),
        spots:makeSpots(oriented,room,network),
        puzzleLinks:clone(oriented.puzzleLinks),
      };
    }
    const profile = choice?.profile || null;
    return {
      roomId:String(room.id),
      source:'procedural',
      profileId:profile?.id || 'generated-default',
      profileName:profile?.name || 'Generated room defaults',
      rotation:0,
      footprint:null,
      spots:profile ? makeSpots(profile,room,network) : [],
      puzzleLinks:profile ? clone(profile.puzzleLinks) : [],
    };
  }

  function planStoreKey(plan) {
    const networkId = idOf(plan?.networkId);
    return networkId ? networkId + '|' + idOf(plan?.roomId) : plan;
  }

  function applyToNetwork(network, options = {}) {
    const floorSet = network?.floorSet;
    const setLike = floorSet && typeof floorSet.has === 'function' && typeof floorSet.delete === 'function' && typeof floorSet.values === 'function'; // V50 creates this Set in a same-origin iframe realm, so parent-realm instanceof checks are invalid.
    if (!network || !setLike || !Array.isArray(network.rooms)) {
      return {ok:false,applied:0,carvedCells:0,errors:['V50 supplied an unsupported room-network shape.']};
    }
    const plans = [], cutCells = [], errors = [];
    const seed = String(options.seed ?? network.seed ?? 'ruin');
    const networkId = 'ruin-room-network-' + (nextNetworkId++); // Unique to this generation; copied into V50 metadata for shared claim tracking.
    for (const room of network.rooms) {
      const plan = planForRoom(network,room,seed);
      plan.networkId = networkId;
      room.roomAuthoringPlan = plan; // V50 mechanism generation can consult the exact same room plan before creating an activator.
      if (plan.source === 'template' && plan.footprint) {
        for (let z=0;z<room.h;z++) for (let x=0;x<room.w;x++) {
          if (plan.footprint.rows[z]?.[x] === '#') continue;
          const key = cellKey(room.col+x,room.row+z);
          if (network.floorSet.has(key)) {
            network.floorSet.delete(key);
            cutCells.push([room.col+x,room.row+z,String(room.id)]);
          }
        }
      }
      plans.push(plan);
    }
    network.roomAuthoringPlans = plans;
    network.roomAuthoringCutCells = cutCells;
    network.roomAuthoringReport = {
      networkId,
      enabledTemplates:library.templates.filter(template=>template.enabled).length,
      templatesApplied:plans.filter(plan=>plan.source==='template').length,
      proceduralRooms:plans.filter(plan=>plan.source==='procedural').length,
      carvedCells:cutCells.length,
      seed,
    };
    for (const plan of plans) {
      const key = planStoreKey(plan);
      claimsByPlan.set(key,new Map());
      diagnosticsByPlan.set(key,{claims:[],rejections:[],links:[]});
      puzzleLinksByPlan.set(key,new Set());
    }
    return {ok:true,networkId,applied:plans.length,carvedCells:cutCells.length,plans,errors};
  }

  function roomPlan(network, roomId) {
    const room = network?.rooms?.find?.(entry=>String(entry.id)===String(roomId));
    return room?.roomAuthoringPlan || (network?.roomAuthoringPlans || []).find(plan=>String(plan.roomId)===String(roomId)) || null;
  }

  function isAllowed(spot, category, type) {
    const values = spot?.allowlists?.[category] || [];
    return values.includes('*') || values.includes('any') || values.includes(String(type));
  }

  function hasSpotClearance(plan, spot, claims) {
    const point = spot?.world;
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.z))) return true;
    for (const occupied of plan.spots || []) {
      if (occupied.id === spot.id || Number(claims.get(occupied.id)||0) <= 0) continue;
      const other = occupied.world;
      if (!other || !Number.isFinite(Number(other.x)) || !Number.isFinite(Number(other.z))) continue;
      const required = Math.max(0,Number(spot.clearance)||0) + Math.max(0,Number(occupied.clearance)||0);
      if (required > 0 && Math.hypot(Number(point.x)-Number(other.x),Number(point.z)-Number(other.z)) + 1e-6 < required) return false;
    }
    return true;
  }

  function canClaimSpotForPlan(plan, roomId, category, type, spotId = null) {
    if (!CATEGORIES.includes(category)) return false;
    if (!plan) return true;
    const key = planStoreKey(plan);
    const claims = claimsByPlan.get(key) || new Map();
    return (plan.spots || []).some(spot => {
      const used = Number(claims.get(spot.id) || 0);
      return (!spotId || spot.id === String(spotId)) && used < spot.maxUses && isAllowed(spot,category,type) && hasSpotClearance(plan,spot,claims);
    });
  }

  function claimSpotForPlan(plan, roomId, category, type, options = {}) {
    if (!CATEGORIES.includes(category)) return {ok:false,reason:'Unknown placement category: '+category};
    if (!plan) return {ok:true,spot:null,legacy:true};
    const key = planStoreKey(plan);
    let claims = claimsByPlan.get(key);
    if (!claims) { claims = new Map(); claimsByPlan.set(key,claims); }
    const requestedSpotId = idOf(options.spotId);
    const spot = (plan.spots || []).find(candidate =>
      (!requestedSpotId || candidate.id === requestedSpotId) && Number(claims.get(candidate.id) || 0) < candidate.maxUses && isAllowed(candidate,category,type) && hasSpotClearance(plan,candidate,claims));
    let report = diagnosticsByPlan.get(key);
    if (!report) { report = {claims:[],rejections:[],links:[]}; diagnosticsByPlan.set(key,report); }
    if (!spot) {
      const diagnostic = {roomId:String(roomId),category,type:String(type),reason:'No unclaimed spot allows this placement.'};
      report.rejections.push(diagnostic);
      return {ok:false,reason:diagnostic.reason,diagnostic};
    }
    claims.set(spot.id,(claims.get(spot.id)||0)+1);
    const claim = {roomId:String(roomId),networkId:idOf(plan.networkId)||null,spotId:spot.id,category,type:String(type),claimId:idOf(options.claimId)||null};
    report.claims.push(claim);
    return {ok:true,spot,claim};
  }

  function nextPuzzleLink(plan) {
    if (!plan?.puzzleLinks?.length) return null;
    const used = puzzleLinksByPlan.get(planStoreKey(plan)) || new Set();
    return plan.puzzleLinks.find(link=>!used.has(link.id)) || null;
  }

  function getNextPuzzleLinkForPlan(plan) {
    const link = nextPuzzleLink(plan);
    return link ? clone(link) : null;
  }

  function getSpotForPlan(plan, spotId) {
    const spot = (plan?.spots || []).find(entry=>entry.id===String(spotId||''));
    return spot ? clone(spot) : null;
  }

  function getAvailableSpotForPlan(plan, category, type, spotId = null) {
    const key = planStoreKey(plan);
    const claims = plan ? claimsByPlan.get(key) || new Map() : new Map();
    const spot = (plan?.spots || []).find(entry =>
      (!spotId || entry.id===String(spotId)) &&
      Number(claims.get(entry.id)||0) < entry.maxUses &&
      isAllowed(entry,category,type) &&
      hasSpotClearance(plan,entry,claims));
    return spot ? clone(spot) : null;
  }

  function canClaimPuzzleLinkForPlan(plan, roomId, mechanismType, activatorType) {
    if (!plan) return true;
    const link = nextPuzzleLink(plan);
    if (plan.puzzleLinks?.length && !link) return false;
    return canClaimSpotForPlan(plan,roomId,'mechanisms',mechanismType,link?.mechanismSpot)
      && canClaimSpotForPlan(plan,roomId,'activators',activatorType,link?.activatorSpot);
  }

  function claimPuzzleLinkForPlan(plan, roomId, mechanismType, activatorType, options = {}) {
    if (!plan) return {ok:true,legacy:true};
    const link = nextPuzzleLink(plan);
    if (plan.puzzleLinks?.length && !link) return {ok:false,reason:'No unclaimed authored puzzle relationship remains for this room.'};
    const mechanism = claimSpotForPlan(plan,roomId,'mechanisms',mechanismType,{claimId:idOf(options.claimId)+':mechanism',spotId:link?.mechanismSpot});
    if (!mechanism.ok) return {ok:false,reason:mechanism.reason,mechanism};
    const activator = claimSpotForPlan(plan,roomId,'activators',activatorType,{claimId:idOf(options.claimId)+':activator',spotId:link?.activatorSpot});
    if (!activator.ok) {
      releaseSpotForPlan(plan,mechanism.claim);
      return {ok:false,reason:activator.reason,mechanism,activator};
    }
    if (link) {
      const key = planStoreKey(plan);
      let used = puzzleLinksByPlan.get(key);
      if (!used) {used=new Set();puzzleLinksByPlan.set(key,used);}
      used.add(link.id);
    }
    const key = planStoreKey(plan);
    const report = diagnosticsByPlan.get(key) || {claims:[],rejections:[],links:[]};
    report.links ||= [];
    report.links.push({roomId:String(roomId),linkId:link?.id||null,relation:link?.relation||'activates',mechanismSpotId:mechanism.spot?.id||null,activatorSpotId:activator.spot?.id||null,mechanismType:String(mechanismType),activatorType:String(activatorType)});
    diagnosticsByPlan.set(key,report);
    return {ok:true,link:link?clone(link):null,mechanism,activator};
  }

  function releaseSpotForPlan(plan, claim) {
    if (!plan || !claim?.spotId) return false;
    const claims = claimsByPlan.get(planStoreKey(plan));
    if (!claims) return false;
    const count = Number(claims.get(String(claim.spotId)) || 0);
    if (count <= 0) return false;
    if (count === 1) claims.delete(String(claim.spotId));
    else claims.set(String(claim.spotId),count-1);
    const report = diagnosticsByPlan.get(planStoreKey(plan));
    if (report && claim.claimId) {
      const index = report.claims.findIndex(entry=>entry.claimId===claim.claimId);
      if (index >= 0) report.claims.splice(index,1); // A rolled-back atomic puzzle pair must not remain in the successful-claims log.
    }
    return true;
  }

  function canClaimSpot(network, roomId, category, type) {
    return canClaimSpotForPlan(roomPlan(network,roomId),roomId,category,type);
  }

  function claimSpot(network, roomId, category, type, options = {}) {
    return claimSpotForPlan(roomPlan(network,roomId),roomId,category,type,options);
  }

  function releaseSpot(network, claim) {
    return releaseSpotForPlan(roomPlan(network,claim?.roomId),claim);
  }

  function getDiagnostics(network) {
    const report = {claims:[],rejections:[],links:[],missingRequiredSpots:[],missingRequiredLinks:[]};
    const seen = new Set();
    const append = plan => {
      if (!plan) return;
      const key = planStoreKey(plan);
      if (seen.has(key)) return;
      seen.add(key);
      const entry = diagnosticsByPlan.get(key) || {claims:[],rejections:[],links:[]};
      const claims = claimsByPlan.get(key) || new Map();
      const usedLinks = puzzleLinksByPlan.get(key) || new Set();
      report.claims.push(...entry.claims);
      report.rejections.push(...entry.rejections);
      report.links.push(...(entry.links||[]));
      for (const spot of plan.spots || []) {
        if (spot.required && Number(claims.get(spot.id)||0) < 1) report.missingRequiredSpots.push({roomId:plan.roomId,spotId:spot.id,label:spot.label});
      }
      for (const link of plan.puzzleLinks || []) {
        if (link.required && !usedLinks.has(link.id)) report.missingRequiredLinks.push({roomId:plan.roomId,linkId:link.id,activatorSpot:link.activatorSpot,mechanismSpot:link.mechanismSpot});
      }
    };
    for (const plan of network?.roomAuthoringPlans || []) append(plan);
    for (const room of network?.rooms || []) append(room.roomAuthoringPlan);
    return clone(report);
  }


  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async()=>{
      let fileLibrary = null, stored = null;
      try {
        const response = await fetch(new URL(LIBRARY_URL,document.baseURI));
        if (response.ok) fileLibrary = await response.json();
      } catch (error) { loadReport.warnings.push('Room library file unavailable: '+String(error?.message||error)); }
      try {
        const value = localStorage.getItem(STORAGE_KEY);
        if (value) stored = JSON.parse(value);
      } catch (error) { loadReport.warnings.push('Saved local room library could not be read: '+String(error?.message||error)); }
      const candidate = stored || fileLibrary || {schema:SCHEMA,templates:[],proceduralProfiles:[]};
      const result = normalizeLibrary(candidate);
      if (result.errors.length) {
        loadReport.errors = result.errors.slice();
        library = normalizeLibrary(fileLibrary || {schema:SCHEMA,templates:[],proceduralProfiles:[]}).library;
      } else {
        library = result.library;
        loadReport.source = stored ? 'localStorage' : fileLibrary ? 'repository' : 'defaults';
      }
      return {library:clone(library),report:clone(loadReport)};
    })();
    return loadPromise;
  }

  function setLibrary(value, options = {}) {
    const result = normalizeLibrary(value);
    if (result.errors.length) return {ok:false,errors:result.errors};
    library = result.library;
    loadReport = {...loadReport,source:options.source || 'editor',errors:[],warnings:[]};
    if (options.persist === true) {
      try { localStorage.setItem(STORAGE_KEY,JSON.stringify(library)); }
      catch (error) { return {ok:false,errors:['Could not save room library in this browser: '+String(error?.message||error)]}; }
    }
    return {ok:true,library:clone(library),report:clone(loadReport)};
  }

  const ready = load();
  window.DevRandomRuinRoomAuthoring = Object.freeze({
    schema:SCHEMA,
    storageKey:STORAGE_KEY,
    ready,
    load,
    getLibrary:()=>clone(library),
    getLoadReport:()=>clone(loadReport),
    normalizeLibrary,
    validateLibrary:value=>normalizeLibrary(value).errors,
    setLibrary,
    applyToNetwork,
    roomPlan,
    canClaimSpot,
    claimSpot,
    releaseSpot,
    canClaimSpotForPlan,
    claimSpotForPlan,
    releaseSpotForPlan,
    canClaimPuzzleLinkForPlan,
    claimPuzzleLinkForPlan,
    getNextPuzzleLinkForPlan,
    getSpotForPlan,
    getAvailableSpotForPlan,
    getDiagnostics,
    categories:CATEGORIES.slice(),
  });
})();