import { EnemyPreview } from './preview.js?v=20261028a';
const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'hobunji.enemyLoadoutWorkshop.v1';
const state = {
  kind: 'bandit:grunt',
  tab: 'weapons',
  data: null,
  busy: false,
  history: [],
  selected: null,
  ready: false,
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 4500);
}
function log(text) {
  const area = $('log');
  area.textContent = (
    area.textContent +
    '\n' +
    new Date().toLocaleTimeString() +
    ' · ' +
    text
  ).slice(-18000);
  area.scrollTop = area.scrollHeight;
}
const preview = new EnemyPreview($('stage'), log);
preview.onTimeline = (p, phase) => {
  if (document.activeElement !== $('scrub')) $('scrub').value = p;
  if ($('phaseLabel').textContent !== phase)
    $('phaseLabel').textContent = phase;
};
function setBusy(value) {
  state.busy = value;
  $('poolPanel').inert = value;
  $('ruleEditor').disabled = value;
  $('tier').disabled = value;
  $('townValue').disabled = value;
  $('seed').disabled = value;
  for (const id of [
    'rollBtn',
    'replayBtn',
    'batchBtn',
    'importBtn',
    'applyRuleBtn',
    'resetRuleBtn',
  ])
    $(id).disabled = value;
  for (const button of document.querySelectorAll('.enemy-button,.history-card'))
    button.disabled = value;
}
function rules() {
  return window.EnemyLoadoutRules.snapshot();
}
function rule() {
  return rules().rules[state.kind] || {};
}
function persist(data) {
  window.EnemyLoadoutRules.set(data);
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    $('draftState').textContent = 'Draft saved on this device';
  } catch (_) {
    $('draftState').textContent = 'Draft in memory · export to keep';
  }
  updateRuleJson();
  $('ruleBadge').textContent = Object.keys(rule()).length
    ? 'Authored pools'
    : 'Game defaults';
}
function mutate(fn) {
  const data = rules();
  data.rules[state.kind] ||= {};
  fn(data.rules[state.kind]);
  if (!Object.keys(data.rules[state.kind]).length)
    delete data.rules[state.kind];
  try {
    persist(data);
  } catch (e) {
    toast(e.message);
    throw e;
  }
}
function pathGet(obj, path) {
  return path.reduce((v, k) => v?.[k], obj);
}
function pathSet(obj, path, value) {
  let target = obj;
  for (const key of path.slice(0, -1)) target = target[key] ||= {};
  if (value === undefined) {
    delete target[path.at(-1)];
    for (let i = path.length - 2; i >= 0; i--) {
      const p = path.slice(0, i + 1);
      if (Object.keys(pathGet(obj, p) || {}).length === 0) {
        let o = obj;
        for (const k of p.slice(0, -1)) o = o[k];
        delete o[p.at(-1)];
      }
    }
  } else target[path.at(-1)] = value;
}
function updateRuleJson() {
  if (document.activeElement !== $('ruleEditor'))
    $('ruleEditor').value = JSON.stringify(rule(), null, 2);
  $('ruleError').textContent = '';
}
function labelFor(id) {
  return (
    state.optionLabels?.get(id) ||
    state.data?.species[id]?.label ||
    window.AlchemySystem?.RECIPE_DEFS?.[id]?.label ||
    state.data?.shapes[id]?.label ||
    state.data?.metals[id]?.label ||
    window.Combat?.previewAbilities?.[id]?.label ||
    preview.cosmetics?.optionCache?.get(id)?.label ||
    preview.cosmetics?.optionCache?.get('appearance::' + id)?.label ||
    id.replace(/^dye:CLOTH:/, '').replaceAll('_', ' ')
  );
}
function library() {
  const filter = $('enemySearch').value.trim().toLowerCase();
  const list = $('enemyList');
  list.replaceChildren();
  let group = '';
  for (const type of window.EnemyLoadoutSourceData.types) {
    if (filter && !type.label.toLowerCase().includes(filter)) continue;
    if (type.group !== group) {
      list.append(el('div', 'enemy-group', type.group));
      group = type.group;
    }
    const b = el(
      'button',
      'enemy-button' + (state.kind === type.id ? ' active' : ''),
      type.label,
    );
    b.dataset.enemy = type.id;
    b.onclick = () => selectKind(type.id);
    b.disabled = state.busy;
    list.append(b);
  }
  $('typeCount').textContent = window.EnemyLoadoutSourceData.types.length;
}
function pool(
  title,
  path,
  defaults,
  catalog = [],
  hint = 'Relative weights · 0 excludes a choice',
  chanceDefault = null,
) {
  const value = pathGet(rule(), path);
  const isClothing = path[0] === 'clothing';
  const enabled = value != null;
  const weights = enabled ? (isClothing ? value.items : value) : defaults;
  const box = el('section', 'pool' + (enabled ? '' : ' disabled'));
  const header = el('div', 'pool-head');
  const label = el('label');
  const toggle = el('input');
  toggle.type = 'checkbox';
  toggle.checked = enabled;
  label.append(toggle, document.createTextNode(title));
  header.append(label, el('span', 'native', enabled ? 'OVERRIDE' : 'NATIVE'));
  box.append(header, el('p', 'pool-hint', hint));
  const setPool = (next) =>
    mutate((r) =>
      pathSet(
        r,
        path,
        isClothing
          ? { chance: value?.chance ?? chanceDefault ?? 1, items: next }
          : next,
      ),
    );
  toggle.onchange = () => {
    mutate((r) =>
      pathSet(
        r,
        path,
        toggle.checked
          ? isClothing
            ? { chance: chanceDefault ?? 1, items: clone(defaults) }
            : clone(defaults)
          : undefined,
      ),
    );
    renderPools();
  };
  if (isClothing) {
    const line = el('label', 'chance', 'Slot chance');
    const n = el('input');
    n.type = 'number';
    n.min = '0';
    n.max = '1';
    n.step = '.05';
    n.value = enabled ? value.chance : chanceDefault;
    n.disabled = !enabled;
    n.onchange = () => {
      mutate((r) => {
        pathGet(r, path).chance = Number(n.value);
      });
      renderPools();
    };
    line.append(n);
    box.append(line);
  }
  const all = Object.entries(weights || {});
  const total = all.reduce((n, [, w]) => n + Number(w), 0);
  const list = el('div', 'weight-list');
  for (const [id, weight] of all) {
    const row = el('div', 'weight-row');
    const name = el('span', 'name', labelFor(id));
    name.title = id;
    if (path[0] === 'dyes') {
      const color = id.startsWith('#') ? id : state.dyeColors?.get(id);
      if (color) {
        const swatch = el('i', 'swatch');
        swatch.style.backgroundColor = color;
        name.prepend(swatch);
      }
    }
    const input = el('input');
    input.type = 'number';
    input.min = '0';
    input.max = '1000000';
    input.step = '.1';
    input.value = weight;
    input.disabled = !enabled;
    input.setAttribute('aria-label', title + ' weight for ' + id);
    input.onchange = () => {
      const next = { ...weights, [id]: Number(input.value) };
      try {
        setPool(next);
        renderPools();
      } catch (_) {
        input.value = weight;
      }
    };
    const remove = el('button', null, '×');
    remove.title = 'Remove ' + id;
    remove.disabled = !enabled;
    remove.onclick = () => {
      const next = { ...weights };
      delete next[id];
      if (!Object.values(next).some((w) => w > 0)) {
        toast('Keep at least one positive choice, or disable the override.');
        return;
      }
      setPool(next);
      renderPools();
    };
    row.append(
      name,
      input,
      el(
        'span',
        'percent',
        total ? ((weight / total) * 100).toFixed(0) + '%' : '—',
      ),
      remove,
    );
    list.append(row);
  }
  box.append(list);
  if (enabled) {
    const line = el('div', 'add-choice');
    const idInput = el('input');
    idInput.placeholder = 'Choose or type an ID…';
    idInput.setAttribute('aria-label', 'Add ' + title + ' choice');
    const listId = 'choices-' + path.join('-');
    const datalist = el('datalist');
    datalist.id = listId;
    for (const id of [...new Set(catalog)]) {
      const option = el('option');
      option.value = id;
      option.label = labelFor(id);
      datalist.append(option);
    }
    idInput.setAttribute('list', listId);
    const add = el('button', null, '+');
    add.title = 'Add weighted choice';
    add.onclick = () => {
      const id = idInput.value.trim();
      if (!id) return;
      if (
        !catalog.includes(id) &&
        !(path[0] === 'dyes' && /^#[0-9a-f]{6}$/i.test(id))
      ) {
        toast('Choose an ID from the available catalog.');
        return;
      }
      setPool({ ...weights, [id]: 1 });
      renderPools();
    };
    line.append(idInput, add, datalist);
    box.append(line);
  }
  $('poolPanel').append(box);
}
function scalar(title, key, fallback) {
  const box = el('section', 'pool');
  const label = el('label', 'chance', title);
  const check = el('input');
  check.type = 'checkbox';
  check.checked = rule()[key] != null;
  const input = el('input');
  input.type = 'number';
  input.min = '0';
  input.max = '1';
  input.step = '.05';
  input.value = rule()[key] ?? fallback;
  input.disabled = !check.checked;
  check.onchange = () => {
    mutate((r) => {
      if (check.checked) r[key] = Number(input.value);
      else delete r[key];
    });
    renderPools();
  };
  input.onchange = () => {
    try {
      mutate((r) => {
        r[key] = Number(input.value);
      });
    } catch (_) {
      renderPools();
    }
  };
  label.prepend(check);
  label.append(input);
  box.append(label);
  $('poolPanel').append(box);
}
function renderPools() {
  if (!state.ready) return;
  $('poolPanel').replaceChildren();
  const d = window.EnemyLoadoutSourceData.defaults(state.kind, state.data);
  const current = state.selected?.roster?.appearance || {};
  const species = current.speciesId || Object.keys(d.species)[0];
  const gender = current.gender || 'male';
  const fighter = window
    .getPortraitFighters()
    .find((f) => f.speciesId === species && f.gender === gender);
  const opts = preview.cosmetics.optionCache;
  const cosmeticIds = [...opts.keys()];
  const dyeIds =
    window.ScratchbonesAccount?.getDyeCatalog?.().map((dye) => dye.id) ||
    Object.keys(d.dyes);
  const note = $('specialNote');
  note.textContent = d.lich
    ? 'Liches keep their tradition’s spell AI. Primary/summon toggles affect that AI; the viewport previews the shared casting gesture.'
    : d.mount
      ? 'Mount: ' +
        d.mount +
        '. The preview uses the compound rider/body renderer.'
      : 'Native clothing rolls retain species restrictions, forced headwear, armor and pants rules. Overriding a slot deliberately replaces that slot’s native roll.';
  if (state.tab === 'weapons') {
    if (d.lich) {
      $('poolPanel').append(
        el(
          'p',
          'help',
          'Liches carry an invisible casting tool, rather than a visible melee weapon. Their tradition’s primary spell and summon can be enabled in Attacks. Use Clothing and Species & dyes to author the caster’s appearance.',
        ),
      );
      updateRuleJson();
      return;
    }
    const nativeShapes = state.kind.startsWith('bandit:')
      ? window.WeaponTrustBanditLoadouts?.allowedMeleeShapes(species)
      : null;
    const nativeWeapons = nativeShapes?.length
      ? Object.fromEntries(nativeShapes.map((id) => [id, 1]))
      : d.weapons;
    pool(
      'Melee weapon shape',
      ['weapons'],
      nativeWeapons,
      Object.keys(state.data.shapes).filter((k) =>
        state.data.shapes[k].slots.includes('weapon'),
      ),
    );
    const metalDefaults = {};
    if (
      d.tribe ||
      state.kind.startsWith('maskbound:') ||
      state.kind.includes('skeleton')
    )
      metalDefaults.nativeCopper = 1;
    else {
      const range = state.data.gang.weaponMetalTierRangeByRank[d.rank] || [
        1, 2,
      ];
      for (const [id, m] of Object.entries(state.data.metals))
        if (m.tier >= range[0] && m.tier <= range[1] + Number($('tier').value))
          metalDefaults[id] = 1;
    }
    pool(
      'Weapon metal',
      ['metals'],
      metalDefaults,
      Object.keys(state.data.metals).filter((k) => state.data.metals[k].tier),
    );
    scalar(
      'Chance of ranged weapon',
      'rangedChance',
      d.tribe || d.lich || state.kind.startsWith('maskbound:')
        ? 0
        : state.data.gang.rangedWeaponChanceByRank[d.rank] || 0,
    );
    pool(
      'Ranged weapon',
      ['ranged'],
      state.selected?.culturalLoadout?.ranged?.weights ||
        state.data.gang.rangedWeaponWeightsByRank[d.rank] || {
          crossbow: 1,
          scatterbow: 1,
        },
      Object.keys(window.RangedWeapons.config),
    );
    if (state.kind === 'bandit:flasker') {
      const recipes = window.BanditCombat.availableFlaskRecipeIds();
      pool(
        'Throwable flask recipes',
        ['flasks'],
        Object.fromEntries(recipes.map((id) => [id, 1])),
        recipes,
        'Samples without replacement from the selected recipes. See the rolled flask list in the enemy record.',
      );
      const box = el('div', 'pool');
      const label = el('label', 'chance', 'Flasks per enemy');
      const count = el('input');
      count.type = 'number';
      count.min = 1;
      count.max = Math.min(12, recipes.length);
      count.value =
        rule().flaskCount ?? state.data.gang.flasker?.loadoutSize ?? 2;
      count.onchange = () => {
        mutate((r) => {
          r.flaskCount = Number(count.value);
        });
      };
      label.append(count);
      box.append(label);
      $('poolPanel').append(box);
    }
  } else if (state.tab === 'clothing') {
    for (const slot of ['hat', 'hood', 'torso', 'overwear', 'pants']) {
      let def = d.clothing[slot] || { chance: 0, items: { none: 1 } };
      if (state.kind.startsWith('bandit:') || d.tribe) {
        const ids = state.data.gang.clothingPool.itemsBySlot[slot];
        if (ids) {
          const items = window.BanditCombat.clothingCandidates(
            state.data.species[species],
            gender,
            slot,
            ids,
            state.data.gang.clothingPool.banditExclusiveIds,
          );
          def = {
            ...def,
            items: Object.keys(items).length ? items : { none: 1 },
          };
        }
      }
      const candidates = cosmeticIds.filter((id) => {
        const o = opts.get(id);
        return (
          (o.slot === slot || (slot === 'overwear' && o.slot === 'arm')) &&
          (!fighter || window.resolveOptionLayers(o, fighter).length)
        );
      });
      if (slot === 'pants') candidates.push('pants_basic', 'draped_pants');
      pool(
        slot[0].toUpperCase() + slot.slice(1),
        ['clothing', slot],
        def.items,
        ['none', ...candidates, ...Object.keys(def.items)],
        'Native choices shown for the rolled species/gender. Overrides replace this slot after class guarantees.',
        def.chance,
      );
    }
    if (state.kind === 'harlyao-skeleton')
      $('poolPanel').prepend(
        el(
          'p',
          'help',
          'Native Harlyao Skeletons also wear town-value-scaled metal armor. The full record includes alloy and Temper.',
        ),
      );
  } else if (state.tab === 'appearance') {
    for (const [slot, key] of [
      ['hairFront', 'hairFrontOptions'],
      ['hairBack', 'hairBackOptions'],
      ['hairSide', 'hairSideOptions'],
      ['hairSideL', 'hairSideLOptions'],
      ['facialHair', 'facialHairOptions'],
      ['eyes', 'eyesOptions'],
      ['upperFace', 'upperFaceOptions'],
    ]) {
      const allowed = (preview.cosmetics[key] || [])
        .filter(
          (o) =>
            o.id === 'none' ||
            (fighter && window.resolveOptionLayers(o, fighter).length),
        )
        .map((o) =>
          o.id === 'none'
            ? 'none'
            : [...opts.entries()].find(([, entry]) => entry === o)?.[0] || o.id,
        );
      pool(
        slot,
        ['appearance', slot],
        Object.fromEntries(allowed.map((id) => [id, 1])),
        allowed,
        'Native appearance is species-weighted. Enable to replace this appearance slot.',
      );
    }
  } else if (state.tab === 'identity') {
    pool('Species', ['species'], d.species, Object.keys(state.data.species));
    pool(
      'Gender',
      ['genders'],
      Object.fromEntries(
        (state.data.species[species]?.genders || Object.keys(d.genders)).map(
          (gender) => [gender, 1],
        ),
      ),
      ['male', 'female'],
      'Species with one authored gender retain that restriction.',
    );
    for (const slot of [
      'A',
      'B',
      'C',
      'HOOD',
      'HOOD_B',
      'HOOD_C',
      'HAT',
      'HAT_B',
      'TORSO',
      'TORSO_B',
      'CLOTH',
      'CLOTH_B',
      'PANTS',
      'PANTS_B',
    ])
      pool(
        slot.startsWith('A') || ['B', 'C'].includes(slot)
          ? 'Body color ' + slot
          : 'Dye · ' + slot,
        ['dyes', slot],
        slot === 'HOOD_C' && state.kind.startsWith('maskbound:')
          ? { '#7F00FF': 1 }
          : d.dyes,
        [...dyeIds, ...Object.keys(d.dyes)],
        'Dye IDs or an exact #RRGGBB color. HOOD_C is mask dye color 3.',
      );
  } else if (state.tab === 'attacks') {
    if (d.lich) {
      for (const ability of ['primary', 'summon']) {
        const line = el('label', 'toggle-line');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = rule().specialAttacks?.[ability] !== false;
        input.onchange = () =>
          mutate((r) => {
            r.specialAttacks ||= {};
            r.specialAttacks[ability] = input.checked;
          });
        line.append(
          input,
          document.createTextNode(
            ability === 'primary'
              ? 'Allow tradition’s primary spell'
              : 'Allow skeleton summoning',
          ),
        );
        $('poolPanel').append(line);
      }
    } else
      for (const slot of ['tap1', 'tap2', 'hold1', 'hold2'])
        pool(
          slot,
          ['attacks', slot],
          slot === 'tap1' && state.selected
            ? {
                [state.selected.definition.banditAbilityLoadout?.tap1 ||
                'swingCombo']: 1,
              }
            : d.attacks[slot],
          window.EnemyLoadoutRules.attackChoices[slot],
          'Only occupied and supported slots are played by the enemy AI.',
        );
  }
  updateRuleJson();
}
async function selectKind(kind) {
  if (state.busy) return;
  state.kind = kind;
  const type = window.EnemyLoadoutSourceData.types.find((t) => t.id === kind);
  $('enemyTitle').textContent = type.label;
  $('family').textContent = type.group.toUpperCase() + ' / LOADOUT PREVIEW';
  library();
  $('ruleBadge').textContent = Object.keys(rule()).length
    ? 'Authored pools'
    : 'Game defaults';
  renderPools();
  await roll(false);
}
function fact(label, value, wide = false) {
  const n = el('div', 'fact' + (wide ? ' wide' : ''));
  n.append(el('small', null, label), el('strong', null, value || 'None'));
  return n;
}
function showRecord(record) {
  state.selected = record;
  const a = record.roster.appearance,
    def = record.definition;
  $('actorTag').textContent = (a.speciesId + ' / ' + a.gender).toUpperCase();
  const facts = $('rollFacts');
  facts.replaceChildren(
    fact('Species', a.speciesId),
    fact('Gender', a.gender),
    fact('Health / Stamina', def.maxHealth + ' / ' + def.maxStamina),
    fact('Weapon', def.weaponKey),
    fact('Ranged', def.rangedWeaponKey),
    fact('Outfit', record.roster.equippedCosmetics.join(', '), true),
    fact('Mount', record.mountSpecies),
    fact(
      'Attacks',
      Object.entries(def.banditAbilityLoadout || {})
        .filter(([, v]) => v)
        .map(([k, v]) => k + ': ' + v)
        .join(' · '),
      true,
    ),
    fact(
      'Dyes',
      Object.entries(record.roster.appliedDyes || {})
        .map(([k, v]) => k + ': ' + labelFor(v))
        .join(' · '),
      true,
    ),
  );
  if (record.roster.metalArmorItems?.length)
    facts.append(
      fact(
        'Armor',
        record.roster.metalArmorItems
          .map((item) => item.label + ' · Temper ' + item.temperXp)
          .join(' / '),
        true,
      ),
    );
  const select = $('attackChoice');
  select.replaceChildren();
  for (const entry of preview.attackOptions()) {
    const o = el('option', null, entry.label);
    o.value = entry.id;
    select.append(o);
  }
  const compact = { ...record };
  delete compact.thumbnail;
  $('rollJson').textContent = JSON.stringify(compact, null, 2);
  renderHistory();
  renderPools();
}
function renderHistory() {
  const h = $('history');
  h.replaceChildren();
  $('historyCount').textContent = state.history.length;
  state.history.forEach((record, index) => {
    const b = el(
      'button',
      'history-card' + (record === state.selected ? ' active' : ''),
    );
    if (record.thumbnail) {
      const img = el('img');
      img.src = record.thumbnail;
      img.alt =
        record.roster.appearance.speciesId +
        ' ' +
        record.roster.appearance.gender +
        ' outfit';
      b.append(img);
    }
    b.append(
      el('small', null, '#' + (index + 1) + ' · ' + record.seed),
      el('small', null, record.definition.weaponKey),
    );
    b.disabled = state.busy;
    b.onclick = async () => {
      setBusy(true);
      $('stageMessage').textContent = 'Restoring this exact enemy…';
      try {
        await preview.restore(record);
        showRecord(record);
      } catch (e) {
        log(e.stack);
        toast(e.message);
      } finally {
        setBusy(false);
        $('stageMessage').textContent = '';
      }
    };
    h.append(b);
  });
}
async function roll(newSeed = true, batch = 1) {
  if (state.busy || !state.ready) return;
  setBusy(true);
  let succeeded = false;
  const rootSeed = $('seed').value.trim() || 'hollow';
  try {
    for (let i = 0; i < batch; i++) {
      const seed =
        batch > 1
          ? rootSeed + '-' + (i + 1)
          : newSeed
            ? 'hollow-' +
              crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
            : rootSeed;
      $('seed').value = seed;
      $('stageMessage').textContent =
        'Rolling ' +
        (batch > 1 ? i + 1 + ' / ' + batch + ' · ' : '') +
        'building the complete enemy…';
      const record = await preview.roll(
        state.kind,
        Number($('tier').value),
        seed,
      );
      state.history.push(record);
      if (state.history.length > 32) state.history.shift();
      showRecord(record);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    log('Rolled ' + state.kind + ' · seed ' + $('seed').value);
    succeeded = true;
  } catch (e) {
    log(e.stack || e.message);
    $('stageMessage').textContent = e.message;
    toast('Preview failed. Diagnostics contain the load error.');
  } finally {
    setBusy(false);
    if (succeeded) $('stageMessage').textContent = '';
  }
}
async function download(name, data, type = 'application/json') {
  const blob =
    data instanceof Blob
      ? data
      : new Blob(
          [
            typeof data === 'string'
              ? data
              : JSON.stringify(data, null, 2) + '\n',
          ],
          { type },
        );
  const a = el('a');
  a.download = name;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
$('enemySearch').oninput = () => {
  if (state.ready) library();
};
$('rollBtn').onclick = () => roll(true);
$('replayBtn').onclick = () => roll(false);
$('batchBtn').onclick = () => roll(false, 8);
$('townValue').onchange = () => roll(false);
$('tier').onchange = () => {
  renderPools();
  roll(false);
};
for (const b of document.querySelectorAll('[data-tab]'))
  b.onclick = () => {
    state.tab = b.dataset.tab;
    for (const x of document.querySelectorAll('[data-tab]'))
      x.classList.toggle('active', x === b);
    renderPools();
  };
$('fitBtn').onclick = () => preview.fit();
for (const b of document.querySelectorAll('[data-view]'))
  b.onclick = () => preview.view(b.dataset.view === 'back');
$('orbitBtn').onclick = () => {
  if (!preview.controls) return;
  preview.controls.autoRotate = !preview.controls.autoRotate;
  $('orbitBtn').setAttribute(
    'aria-pressed',
    String(preview.controls.autoRotate),
  );
};
$('gridToggle').onchange = () => {
  if (preview.grid) preview.grid.visible = $('gridToggle').checked;
};
$('bonesToggle').onchange = () =>
  window.ProceduralLegAnimation?.setShowBones($('bonesToggle').checked);
$('motion').onchange = () => {
  preview.motion = $('motion').value;
};
$('playbackSpeed').onchange = () => {
  preview.speed = Number($('playbackSpeed').value);
};
$('attackBtn').onclick = () => {
  preview.play($('attackChoice').value);
  preview.paused = false;
  $('pauseBtn').textContent = 'Pause';
};
$('loopAttack').onchange = () => {
  preview.loop = $('loopAttack').checked;
};
$('pauseBtn').onclick = () => {
  preview.paused = !preview.paused;
  $('pauseBtn').textContent = preview.paused ? 'Resume' : 'Pause';
  $('pauseBtn').setAttribute('aria-pressed', String(preview.paused));
};
$('scrub').oninput = () => {
  preview.paused = false;
  preview.play($('attackChoice').value, Number($('scrub').value), true);
};
$('captureBtn').onclick = () => {
  if (preview.renderer)
    preview.renderer.domElement.toBlob((blob) =>
      download('enemy-preview.png', blob, 'image/png'),
    );
};
$('resetRuleBtn').onclick = () => {
  const data = rules();
  delete data.rules[state.kind];
  persist(data);
  renderPools();
  toast('This enemy now uses the original generator.');
};
$('applyRuleBtn').onclick = () => {
  try {
    const parsed = JSON.parse($('ruleEditor').value);
    const data = rules();
    data.rules[state.kind] = parsed;
    persist(data);
    renderPools();
    toast('Rule applied. Roll to preview it.');
  } catch (e) {
    $('ruleError').textContent = e.message;
  }
};
$('exportBtn').onclick = async () => {
  if (!state.ready) return;
  const data = rules();
  window.EnemyLoadoutRules.validate(data);
  await download('enemy-loadouts.json', data);
  toast(
    'Exported spawn rules. Install the file at docs/config/combat/enemy-loadouts.json.',
  );
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const f = $('importFile').files[0];
  if (!f) return;
  try {
    persist(JSON.parse(await f.text()));
    renderPools();
    toast('Imported rules. Roll to preview them.');
  } catch (e) {
    toast('Import rejected: ' + e.message);
  } finally {
    $('importFile').value = '';
  }
};
$('exportRollBtn').onclick = () => {
  if (!state.selected) return;
  const data = { ...state.selected };
  delete data.thumbnail;
  download(
    'enemy-' + data.kind.replaceAll(':', '-') + '-' + data.seed + '.json',
    data,
  );
};
$('copyRollBtn').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('rollJson').textContent);
    toast('Enemy JSON copied');
  } catch (_) {
    toast('Clipboard unavailable. Use Export this enemy.');
  }
};
$('copyLogBtn').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('log').textContent);
    toast('Diagnostics copied');
  } catch (_) {
    toast('Select and copy the diagnostics text.');
  }
};
$('clearHistory').onclick = () => {
  state.history = [];
  renderHistory();
};
window.addEventListener('pagehide', () => preview.dispose(), { once: true });
window.addEventListener('error', (e) => log(e.message));
window.addEventListener('unhandledrejection', (e) =>
  log(e.reason?.stack || e.reason),
);
window.EnemyLoadoutWorkshop = { state, preview, roll, selectKind, rules };
(async () => {
  try {
    setBusy(true);
    state.data = await preview.init();
    state.optionLabels = new Map();
    for (const [id, o] of preview.cosmetics.optionCache) {
      state.optionLabels.set(id, o.label);
      state.optionLabels.set(o.id, o.label);
    }
    state.dyeColors = new Map();
    for (const dye of window.ScratchbonesAccount?.getDyeCatalog?.() ||
      window.SCRATCHBONES_CONFIG.game.dyes.catalog ||
      []) {
      state.optionLabels.set(dye.id, dye.label);
      if (dye.hex) state.dyeColors.set(dye.id, dye.hex);
    }
    state.ready = true;
    let draft;
    try {
      draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    } catch (_) {}
    if (draft) {
      try {
        persist(draft);
      } catch (e) {
        log('Stored draft rejected: ' + e.message);
      }
    } else $('draftState').textContent = 'Repository rules loaded';
    setBusy(false);
    await selectKind(state.kind);
  } catch (e) {
    log(e.stack || e.message);
    $('stageMessage').textContent = 'Workshop could not start: ' + e.message;
    $('draftState').textContent = 'Runtime load failed · see diagnostics';
    setBusy(false);
  }
})();
