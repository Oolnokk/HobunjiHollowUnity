// Shared authored/procedural ruin-room definitions. V50 still owns topology,
// corridor construction, wall derivation and plateau geometry; this module
// supplies room masks and the same named placement/allowlist contract to both
// fixed templates and ordinary generated rooms.
(() => {
  'use strict';

  const SCHEMA = 'hobunji_ruin_room_library.v1';
  const STORAGE_KEY = 'hobunji.devRuinRoomLibrary.v1';
  const LIBRARY_URL = 'config/ruin-room-authoring/room-library.json';
  const CATEGORIES = ['mechanisms', 'activators', 'decorations'];
  const claimsByNetwork = new WeakMap();
  const diagnosticsByNetwork = new WeakMap();
  let library = { schema:SCHEMA, templates:[], proceduralProfiles:[] };
  let loadPromise = null;
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
    for (const template of normalized.templates) {
      if (!template.id || ids.has(template.id)) errors.push('Template ids must be non-empty and unique (' + template.id + ').');
      ids.add(template.id);
      validateFootprint(template.footprint, template.name || template.id || 'Template', errors);
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
      const candidate = template.connections.find(connection=>connection.kind===door.kind&&connection.side===door.side&&Math.abs(connection.offset-door.offset)<=.51&&connection.width<=door.width+.01);
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
    const worldWidth = Number(network.worldWidth) || 0, worldDepth = Number(network.worldDepth) || 0;
    return definition.spots.map(spot=>{
      const x = spot.coordinateMode === 'cell' ? Number(spot.x)+.5 : Number(spot.x)*room.w;
      const z = spot.coordinateMode === 'cell' ? Number(spot.z)+.5 : Number(spot.z)*room.h;
      return {
        ...clone(spot),
        localCell:{x:room.col+x,z:room.row+z},
        world:{x:(room.col+x)*cs-worldWidth/2,z:(room.row+z)*cs-worldDepth/2},
      };
    });
  }

  function planForRoom(network, room, seed) {
    const rng = rngFor(seed + ':' + room.id);
    const templates = templateCandidates(network, room);
    const templatePick = weightedPick(templates, rng);
    if (templatePick) {
      return {
        roomId:String(room.id),
        source:'template',
        templateId:templatePick.template.id,
        templateName:templatePick.template.name,
        rotation:templatePick.oriented.rotation,
        footprint:clone(templatePick.oriented.footprint),
        spots:makeSpots(templatePick.oriented,room,network),
        puzzleLinks:clone(templatePick.oriented.puzzleLinks),
      };
    }
    const doorCount = (network.doorways || []).filter(door=>door.from===room.id||door.to===room.id).length + (network.entrance?.roomId===room.id ? 1 : 0);
    const profiles = library.proceduralProfiles.filter(profile=>profileMatches(profile,room,doorCount));
    const profile = weightedPick(profiles,rng);
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

  function applyToNetwork(network, options = {}) {
    if (!network || !(network.floorSet instanceof Set) || !Array.isArray(network.rooms)) {
      return {ok:false,applied:0,carvedCells:0,errors:['V50 supplied an unsupported room-network shape.']};
    }
    const plans = [], cutCells = [], errors = [];
    const seed = String(options.seed ?? network.seed ?? 'ruin');
    for (const room of network.rooms) {
      const plan = planForRoom(network,room,seed);
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
      enabledTemplates:library.templates.filter(template=>template.enabled).length,
      templatesApplied:plans.filter(plan=>plan.source==='template').length,
      proceduralRooms:plans.filter(plan=>plan.source==='procedural').length,
      carvedCells:cutCells.length,
      seed,
    };
    claimsByNetwork.set(network,new Map());
    diagnosticsByNetwork.set(network,{claims:[],rejections:[]});
    return {ok:true,applied:plans.length,carvedCells:cutCells.length,plans,errors};
  }

  function roomPlan(network, roomId) {
    return (network?.roomAuthoringPlans || []).find(plan=>String(plan.roomId)===String(roomId)) || null;
  }

  function isAllowed(spot, category, type) {
    const values = spot?.allowlists?.[category] || [];
    return values.includes('*') || values.includes('any') || values.includes(String(type));
  }

  function canClaimSpot(network, roomId, category, type) {
    if (!CATEGORIES.includes(category)) return false;
    const plan = roomPlan(network,roomId);
    if (!plan) return true; // Legacy rooms remain fully compatible when no room plan is present.
    const claims = claimsByNetwork.get(network) || new Map();
    return plan.spots.some(spot=>{
      const used = Number(claims.get(String(roomId)+'|'+spot.id) || 0);
      return used < spot.maxUses && isAllowed(spot,category,type);
    });
  }

  function claimSpot(network, roomId, category, type, options = {}) {
    if (!CATEGORIES.includes(category)) return {ok:false,reason:'Unknown placement category: '+category};
    const plan = roomPlan(network,roomId);
    if (!plan) return {ok:true,spot:null,legacy:true};
    let claims = claimsByNetwork.get(network);
    if (!claims) {claims=new Map();claimsByNetwork.set(network,claims);}
    const spot = plan.spots.find(candidate=>{
      const used = Number(claims.get(String(roomId)+'|'+candidate.id) || 0);
      return used < candidate.maxUses && isAllowed(candidate,category,type);
    });
    if (!spot) {
      const diagnostic = {roomId:String(roomId),category,type:String(type),reason:'No unclaimed spot allows this placement.'};
      const report = diagnosticsByNetwork.get(network) || {claims:[],rejections:[]};
      report.rejections.push(diagnostic);
      diagnosticsByNetwork.set(network,report);
      return {ok:false,reason:diagnostic.reason,diagnostic};
    }
    const key = String(roomId)+'|'+spot.id;
    claims.set(key,(claims.get(key)||0)+1);
    const claim = {roomId:String(roomId),spotId:spot.id,category,type:String(type),claimId:idOf(options.claimId)||null};
    const report = diagnosticsByNetwork.get(network) || {claims:[],rejections:[]};
    report.claims.push(claim);
    diagnosticsByNetwork.set(network,report);
    return {ok:true,spot,claim};
  }

  function releaseSpot(network, claim) {
    if (!network || !claim?.roomId || !claim?.spotId) return false;
    const claims = claimsByNetwork.get(network);
    if (!claims) return false;
    const key = String(claim.roomId)+'|'+String(claim.spotId);
    const count = Number(claims.get(key)||0);
    if (count <= 0) return false;
    if (count === 1) claims.delete(key); else claims.set(key,count-1);
    return true;
  }

  function getDiagnostics(network) {
    const report = diagnosticsByNetwork.get(network) || {claims:[],rejections:[]};
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
    getDiagnostics,
    categories:CATEGORIES.slice(),
  });
})();