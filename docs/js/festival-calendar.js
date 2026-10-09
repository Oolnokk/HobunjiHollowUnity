// Shared festival definitions: calendar, layout conditions, editor, and runtime use one schedule.
(() => {
  'use strict';
  const festivals = [ // Civil dates; regional seasons remain anchored to the existing raw-world calendar.
    { id: 'hachutukara', name: 'Hachutukara', icon: '🎭', month: 1, day: 22, color: '#d19aef', description: 'Laugh at fear: silly animal masks, sweets, dancing, Hunundi’s story, and friendly duels.', activities: ['welcome', 'masks', 'sweets', 'story', 'dance', 'duel'], note: 'Placed in the longest otherwise empty interval, between Mountaindawn and Gorkunash.' },
    { id: 'gorkunash', name: 'Gorkunash', icon: '🍲', month: 5, day: 8, color: '#e9af60', description: 'Bring a fine cooked meal to the communal feast. Share music, dancing, and liquor.', activities: ['welcome', 'potluck', 'dance', 'music', 'liquor'], note: 'Middle week of Stormtide. FUTURE CONTENT: a solemn observance at Omgurku Great Camp, which does not exist yet.' },
    { id: 'tzizkhanash', name: 'Tzizkhanash', icon: '🕯️', month: 7, day: 22, color: '#a5c9db', description: 'Honor those lost and appreciate the peace in death. Offer a keepsake and choose a blessing lasting one full year.', activities: ['welcome', 'offering', 'remembrance'], note: 'Little wooden ancestor carvings. Mashtzarr become “engh-sho-ey,” as Kinami would put it.' },
    { id: 'five_blossoms', name: 'Feast of the Five Blossoms', icon: '🌸', month: 9, day: 15, color: '#f1aaca', description: 'The dry season has ended. Join the Five Blossom Dance and welcome the returning rain.', activities: ['welcome', 'dance', 'music'], note: 'First seven days after Deadgrass: raw season week 23, civil week 35.' },
    { id: 'mountaindawn', name: 'Mountaindawn', icon: '🎁', month: 10, day: 1, color: '#a8dbc8', description: 'Gifts have double their usual relationship effect. Every friend at three hearts or more has a rare, useful gift for you.', activities: ['welcome', 'gifts'], note: 'The week containing Shallowfrost 5. One return gift per NPC per festival year.' },
  ];
  const activityLabels = { welcome: 'Festival guide', masks: 'Choose an animal mask', sweets: 'Collect sweets', story: 'Hunundi’s story', dance: 'Join the dance', duel: 'Friendly duel', potluck: 'Contribute to the feast', music: 'Play music', liquor: 'Share festival liquor', offering: 'Make an ancestor offering', remembrance: 'Remember the departed', gifts: 'Mountaindawn gifts' }; // Shared editor and interaction labels.
  const blessings = { speed: { label: 'Light Steps', icon: '🍃', perLevel: 0.02, description: 'Movement speed' }, vigor: { label: 'Quiet Resolve', icon: '🌿', perLevel: 0.04, description: 'Stamina regeneration' }, goodwill: { label: 'Living Bonds', icon: '🤍', perLevel: 0.05, description: 'Positive Favor earned' } }; // Reusable stat IDs consumed by movement, vitals, and relationships.
  function ordinal(month, day) { return (month - 1) * 28 + day; }
  function forOrdinal(value) { return festivals.find(f => ((value - ordinal(f.month, f.day) + 336) % 336) < 7) || null; }
  function current() {
    const calendar = window.CalendarSystem; // Civil-midnight accessors installed by MapLayoutSystem.
    if (!calendar?.isInitialized?.()) return null;
    return forOrdinal(ordinal(calendar.monthNumber(), calendar.dayOfMonth()));
  }
  function forRawDay(day) { return window.CalendarSystem ? forOrdinal(window.CalendarSystem.dayOfYear(day)) : null; }
  window.FestivalCalendar = { festivals, activityLabels, blessings, ordinal, forOrdinal, forRawDay, current, get: id => festivals.find(f => f.id === id) || null };
})();
