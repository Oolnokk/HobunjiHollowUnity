// Authored festival conversations. DialogueContent owns playback, tokens, choices and ambient presentation.
(() => {
  'use strict';
  const OLIPHANTI = new Set(['mashtzarr', 'mammakh', 'mammakhbuur']); // Mashtzarr and Mammakh are subspecies of Oliphanti; mammakhbuur is the existing asset ID.
  const EXCLUDED = new Set(['kinami_kunji', 'father_hunundi_hodu']);
  const trees = new Map(); // Content is compiled once per speaker/ancestry, not on every interaction.
  let deps = null;
  let entrance = null;
  let entranceMap = null;
  let hasBeenAbsent = false;
  let awayPresence = null, returnPresence = null;
  function active() { return window.FestivalSystem?.festival?.()?.id === 'gorkunash' && !!window.FestivalSystem?.festivalHours?.(); }
  function isOliphanti(species) { return OLIPHANTI.has(String(species || '').trim().toLowerCase()); }

  const conversations = {
    dzibim_khibu: oliphanti => [
      `This was the day ${oliphanti ? 'our' : 'my'} people took back what was ours. Blessed be Nao'ung, for blessed are the Oliphanti.`,
      ...(!oliphanti ? [
        "And you folks are blessed too. That's why the whole town is celebrating. Cause think about this:",
        "If we didn't put down the Omgurku, they'd probably rule over everyone else too.",
      ] : []),
      'I once read that the Omgurku are by far the most widespread of the barbarian peoples. The far-reaches, that whole chunk of the map with nothing on it. You can find Omgurku throughout.',
      "Those scholar-types think it's the extra legs, lets them go farther. And that's true.",
      'But the problem with Omgurku is that if they can go farther, they WILL.',
      "I don't know if you've heard, but there's this barbarian war going on throughout the highlands.",
      'Basically out there there are two barbarian peoples. The Porakaneki, and of course, like I said, the Omgurku.',
      "The Porakaneki are these cute little round fellas with round flat noses, never heard of them harming anyone not out of self defense. Now of course the Omgurku have decided that there's not enough room for them both to live in peace. Now they're trying to get rid of them all.",
      'To imagine that so many of those little guys are getting murdered, {{playerLocalNickname}}. We should be helping them.',
      "But I brought it up to Father Hunundi, and he said it isn't our war and we shouldn't pick a side.",
      'Sure, it’s not his war, but it’s our war. Me, my daughter, Hreesh, Kzubug, even that city slicker from the IKMC. Our ancestors all fought and died for freedom against those monsters.',
      'The war never ended, and we inherited it. Any Omgurku will tell you that...',
      "It doesn't end until either they're all dead, or we are.",
      { text: '*cries*', expression: 'frown', expressionHold: 10 },
      { text: "I'm sorry, I think I had a bit too much to drink. Thank you for listening.", expression: 'frown', expressionHold: 10 },
    ],
    foroji_funji: () => [
      "I've always loved this tradition. The food, the music, the dancing, the drinking.",
      "But to think we're here celebrating the day the Omgurku lost their empire...",
      'In a region where Omgurku outnumber us at least 5 to 1...',
      'In a town without any walls.',
      "Let alone that Hobunji Hollow is in a Naoungine parish, and it's Nao'ung who's said to have tricked them into leaving their city defenseless.",
      'How are we not dead right now?',
    ],
    hreesh: () => ["It's a day of victory, my friend. Eat!"],
    kzubug: () => [
      'I like to let my little girl go socialize at these events without her dad trailing her around, but sometimes it’s difficult.',
      'Especially on a day like today. Gorkunash is a day of celebration for everyone, but to the Oliphanti it means a lot more.',
      "Sloomi is my daughter, but she's not Oliphanti, like my other children who have unfortunately passed on.",
      'Gorkunash is both a day of celebration and a day of mourning for us. And for some of us, it is also a day of remorse.',
      "My little girl is blessed not to carry that weight, and I'd never wish it upon her.",
      "But at the same time, without Inishka and the other little ones, I feel like I'm standing here alone.",
      'Sometimes I think I should visit one of those Spirit Communions the Engh-sho hold in the dead of night.',
      'But then I realize that perhaps it’s best to move forward and not dwell too much in what was. I still have a living, breathing daughter to look after,',
      "And I know that even if I can't see them, the others are here by my side, watching me with love.",
    ],
    dzahiri_khibu: () => ["This festival can be rough on Dzibim. I wouldn't take anything he says too close to heart."],
    kinami_kunji: () => [
      { type: 'choice', text: '{{pool:Kinami Greetings}}', choices: [{ label: "Why aren't you at the festival?", next: 'n1' }, { label: 'Goodbye.', next: null }] },
      'Because I have nothing to celebrate. The mashtzarr say that we should be celebrating, because if they hadn’t defeated the Omgurku, we’d be next.',
      'That is an insult, and one that is completely unfounded. I will not tolerate it, let alone celebrate it.',
      'I cannot fathom how everyone else goes along with this. It is simply the mashtzarr parading themselves around like heroes.',
      'We did not need their help, and the way I see it, they have no right to even be here on our land.',
      "Even worse, it's the Oliphanti's fault that the Omgurku are even here.",
      'If the Oliphanti did what they were told and respected the powers that be in their own land, the Omgurku would have no reason to leave the Highplains and infest the rest of the continent.',
      'That is historical fact. Scholars call it the Omgurku Exodus. The Oliphanti burst a boil from within with their incomplacency and now the filth is splattered everywhere.',
      'The Mashtzarr and their kin are the villains in all this.',
      "And to think they claim our blessed Nao'ung had anything to do with this. That is simply blasphemy. He won't admit it, but this is obviously why Father Hunundi leaves town during the festival. The Father before him did the exact same thing.",
    ],
  };

  function compile(id, lines) {
    return {
      id, label: 'Gorkunash', trigger: 'interact', entryNode: 'n0',
      nodes: lines.map((line, index) => ({ id: `n${index}`, type: 'text', expression: 'neutral',
        next: index + 1 < lines.length ? `n${index + 1}` : null, ...(typeof line === 'string' ? { text: line } : line) })),
    };
  }
  function greetingVariant(rec, day = 0) {
    let hash = Math.trunc(Number(day) || 0);
    for (const ch of String(rec?.id || '')) hash = ((hash * 31) + ch.charCodeAt(0)) | 0;
    return ((hash % 3) + 3) % 3;
  }
  function festivalGreeting(rec, { standardGreeting, targetName, day, omitTargetName }) {
    const name = omitTargetName ? '' : `, ${targetName}`; // Preserve the ambient owner's low-favor nickname/name policy.
    return [
      `Happy Gorkunash${name}!`,
      `${String(standardGreeting || 'Hello').replace(/[.!?,\s]+$/, '')}, Happy Gorkunash!`,
      `It's Gorkunash${name}! Time to eat some good food and have some fun!`,
    ][greetingVariant(rec, day)];
  }
  function treeFor(rec, { world, defaultTree } = {}) {
    if (!active() || !rec?.id || rec.dead || rec.deceased) return null;
    // Authored quest/story trees retain their normal selection. Existing General Chat trees use this suffix.
    if (defaultTree && !String(defaultTree.id || '').endsWith('_fallback')) return null;
    if (rec.id === 'father_hunundi_hodu') return null;
    const oliphanti = isOliphanti(world?.playerSpecies);
    const key = `${rec.id}:${oliphanti}`;
    if (!trees.has(key)) {
      const special = conversations[rec.id];
      const standard = defaultTree?.nodes?.find(node => node.id === defaultTree.entryNode)?.text || 'Hello, {{playerLocalNickname}}!';
      const lines = special ? special(oliphanti) : [festivalGreeting(rec, { standardGreeting: standard, targetName: '{{playerLocalNickname}}' })];
      trees.set(key, compile(`gorkunash_${rec.id}_${oliphanti ? 'oliphanti' : 'other'}`, lines));
    }
    return trees.get(key);
  }
  function greetingFor(rec, context) {
    if (!active() || EXCLUDED.has(rec?.id) || rec?.dead || rec?.deceased) return null;
    return festivalGreeting(rec, context);
  }
  function homeTarget(rec) {
    const hour = Number(window.CalendarSystem?.getHour?.()) || 0;
    const stationId = hour >= 22 || hour < 6 ? rec.scheduleHooks?.defaultStationId : 'station_kinami_dayoff';
    const target = window.NpcScheduling?.resolveNpcStationTarget?.(stationId);
    // The existing upstairs home position also works while an interior's furniture stations are loading.
    return target || rec.scheduleHooks?.defaultPosition || null;
  }
  function hunundiPresence() {
    const map = deps?.getTownMap?.();
    if (map !== entranceMap) {
      entranceMap = map;
      const exit = map?.transitions?.find(spot => spot.id === 'sp_town_north');
      entrance = exit ? { area: 'town', c: exit.col, r: exit.row, label: exit.label } : null;
      awayPresence = entrance ? { active: false, entrance } : null;
      returnPresence = entrance ? { active: true, entrance } : null;
    }
    if (active()) { hasBeenAbsent = true; return awayPresence; }
    return hasBeenAbsent ? returnPresence : null; // A normal new game starts Hunundi at his schedule, rather than at the exit.
  }
  function init(injected) {
    deps = injected;
    trees.clear();
    entranceMap = null; hasBeenAbsent = false;
    window.NpcScheduling?.registerPresenceProvider?.('father_hunundi_hodu', hunundiPresence);
  }
  function diagnostics() {
    return { active: active(), hours: window.FestivalSystem?.gatheringHoursLabel?.() || '15:00–01:00', oliphanti: [...OLIPHANTI],
      specialSpeakers: Object.keys(conversations), excludedGreetings: [...EXCLUDED], hunundi: hunundiPresence() };
  }
  window.DialogueContent?.registerContextProvider?.('festival-dialogue', { treeFor, greetingFor });
  window.FestivalDialogue = { init, active, isOliphanti, homeTarget, diagnostics };
})();
