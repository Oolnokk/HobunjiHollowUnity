// Binds equipped-weapon data to reusable lesson templates; never authors NPC tree branches.
(() => {
  'use strict';
  const intro = { // One explanation shared by every rank, weapon family and upgrade catalog.
    id: 'mastery_intro', title: '{{context:weaponName}} — Mastery {{context:rank}}', check: 'read', weapon: '{{context:weapon}}',
    text: '{{playerName}}, your [color=#d7b4ff]{{context:weaponName}}[/color] qualifies for Mastery {{context:rank}}. We will try each choice for {{context:scope}} on this weapon. Each exercise temporarily previews one choice from this rank; your existing earlier choices stay in effect. We will not spend motes or change your saved upgrades.',
  };
  const trials = { // Repeat-block expansion also works for recipes, shop demonstrations, or any unrelated activity.
    $each: 'options', as: 'option', template: {
      id: '{{context:option.id}}', title: '{{context:option.label}}', weapon: '{{context:weapon}}',
      ability: { $value: 'option.ability' }, slot: { $value: 'option.slot' }, check: { $value: 'option.check' },
      count: { $value: 'option.count' }, hostile: { $value: 'option.hostile' }, preview: { $value: 'option.preview' },
      text: 'With your {{context:weaponName}}, try [color=#d7b4ff]{{context:option.label}}[/color] for [color=#ffe394]{{context:option.abilityName}}[/color]. {{context:option.desc}} {{context:option.instruction}} Compare this choice with the others. This is a temporary preview.',
    },
  };
  function equipped(quest, deps) {
    const family = quest.rangedMastery ? 'ranged' : 'weapon'; // Use the relevant equipped slot, never another weapon in the bag.
    const weapon = deps.equipment[family]; // Stable item key selects both Mastery and saved upgrade choices.
    return { family, weapon, rank: quest.mastery || quest.rangedMastery, def: deps.toolDefs[weapon] };
  }
  function gate(quest, deps) {
    const selection = equipped(quest, deps); // One validator is used by menu visibility and acceptance.
    if (!selection.weapon || !selection.def?.slots?.includes(selection.family) || !deps.getGear()?.tools?.[selection.weapon] || deps.mastery(selection.weapon) < selection.rank) {
      return `Equip a ${quest.rangedMastery ? 'ranged' : 'melee'} weapon with Mastery ${selection.rank}`;
    }
    return '';
  }
  function build(quest, deps) {
    const { family, weapon, rank, def } = equipped(quest, deps); // Snapshot the exact weapon for every generated trial.
    const options = []; // Flattened live upgrade options become generated practice stages.
    if (family === 'ranged') {
      const catalog = rank % 2 ? window.RangedWeapons?.BASIC_AMMO_EFFECTS : Object.values(window.RangedWeapons?.SPECIAL_AMMO_TYPES || {}); // Use the actual ammo catalog shown in Loadout.
      for (const option of catalog || []) options.push({ id: `ammo_${option.id}`, label: option.label, desc: option.desc, abilityName: rank % 2 ? 'Basic ammunition' : 'Special ammunition', check: 'rangedHit', count: 1, hostile: rank % 2 === 0,
        instruction: 'Use Weapon Action 1 to load and fire, and hit Oddclaw. The preview ammunition is already selected.',
        preview: { kind: rank % 2 ? 'basicAmmo' : 'specialAmmo', rank, optionId: option.id } });
    } else {
      const seen = new Set(); // The same technique in two held slots only needs one set of trials.
      for (const slot of ['tap1', 'tap2', 'hold1', 'hold2']) {
        const ability = slot === 'tap1' ? ((def.comboStyle || def.animStyle) === 'thrust' ? 'pokeCombo' : 'swingCombo') : window.Combat?.loadout?.getSlot(slot); // Existing ownership-filtered loadout chooses the techniques the player actually uses.
        if (!ability || seen.has(ability)) continue;
        seen.add(ability);
        const row = window.CombatProgression?.getTree(ability, def.dmgType || 'sharp')?.[rank - 1]; // Live trees include the weapon's sharp/blunt distinctions.
        const check = ability === 'counterShield' ? 'block' : ability === 'blinkDodge' ? 'blink' : ability === 'opportunistJab' ? 'quickBonus' : 'hit'; // Preview completion uses the same real combat events as ordinary lessons.
        const instructions = { tap1: 'Tap Weapon Action 1 and land three hits on Oddclaw.', tap2: ability === 'opportunistJab' ? 'Tap Weapon Action 2 to catch Oddclaw during his windup or strike.' : 'Tap Weapon Action 2 and hit Oddclaw.', hold1: ability === 'acceleratingFlurry' ? 'Keep Weapon Action 1 held and land three hits.' : 'Hold Weapon Action 1 to wind up, then release and hit Oddclaw.', hold2: ability === 'blinkDodge' ? 'Hold Weapon Action 2 and move to perform a hop.' : ability === 'counterShield' ? 'Hold Weapon Action 2 and block Oddclaw’s attack.' : 'Hold Weapon Action 2 to use this technique and hit Oddclaw.' }; // Controls follow the player's actual slot assignment.
        for (const [index, option] of (row || []).entries()) options.push({ id: `${ability}_${index}`, label: option.label, desc: option.desc, ability, abilityName: window.Combat.abilities.get(ability)?.label || ability, slot, check,
          count: slot === 'tap1' || ability === 'acceleratingFlurry' ? 3 : 1, hostile: check === 'block' || check === 'quickBonus', instruction: instructions[slot], preview: { kind: 'melee', rank, index, ability } });
      }
    }
    if (!options.length) throw new Error('The equipped weapon’s upgrade choices are not ready.');
    const context = { weapon, weaponName: def.label || weapon, rank, options, scope: family === 'ranged' ? 'its ammunition' : 'your equipped techniques' }; // Reusable context placeholders keep the lesson template compact.
    const steps = window.DialogueTemplates.expand([intro, trials, { id: 'mastery_finish', title: 'Compare your choices', check: 'read', weapon: '{{context:weapon}}', text: 'You have tried the Mastery {{context:rank}} choices for your {{context:weaponName}}. Your permanent upgrades are unchanged. Open this weapon’s Loadout when you are ready to choose; normal prerequisites and costs still apply.' }], context); // One serial flow, independent of the NPC's permanent dialogue tree.
    for (const lesson of steps) lesson.equipSlot = family;
    return { ...quest, steps, weapon, family, context, signature: JSON.stringify([weapon, rank, options.map(option => [option.id, option.slot])]) };
  }
  window.CombatTutorialMastery = { gate, build };
})();
