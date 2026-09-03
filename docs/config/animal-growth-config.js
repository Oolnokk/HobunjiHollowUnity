(() => {
  'use strict';

  // Single tuning surface for the Growth Tonic + animal age lifecycle.
  // Shop prices intentionally stay in config/shops/shop-stock.json so the
  // Loot & Shop editor remains the economy source of truth.
  window.ANIMAL_GROWTH_CONFIG = Object.freeze({
    item: Object.freeze({
      key: 'growthTonic',
      label: 'Growth Tonic',
      icon: '🌱',
      category: 'processed',
      sellPrice: 0,
      tags: Object.freeze(['Livestock', 'Animal Care']),
      description: 'Matures one baby animal into an adult. Stable babies can be grown directly when equipping them.',
      spriteIcon: 'bottle_potion.png',
      spriteColor: 0x78b85a,
    }),
    stages: Object.freeze({
      baby: 'baby',
      adult: 'adult',
      legacyStableDefault: 'adult',
      newStableDefault: 'baby',
    }),
    stable: Object.freeze({
      growAndEquipOnRoleClick: true,
    }),
  });
})();
