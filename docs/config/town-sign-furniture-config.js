// Editable static town placements for the two authored hanging business signs.
(() => {
  'use strict';

  const placements = [ // Used by TownSignFurnitureRuntime; col/row are furniture centers on the town tile grid.
    {
      id: 'town_general_store_sign',
      key: 'generalStoreSign',
      label: "Funji & Son's General Store Sign",
      buildingId: 'bldg_3bhxe',
      entrance: { col: 37, row: 34 },
      offsetFromEntrance: { col: 0, row: 2 },
      col: 37,
      row: 36,
      rotYDeg: 90,
      localPostAxis: '+X',
      postAim: 'north',
    },
    {
      id: 'town_inn_sign',
      key: 'innSign',
      label: 'Inn Sign',
      buildingId: 'bldg_52zui',
      entrance: { col: 23, row: 21 },
      offsetFromEntrance: { col: -2, row: 0 },
      col: 21,
      row: 21,
      rotYDeg: 90,
      localPostAxis: '+X',
      postAim: 'north',
    },
  ];

  window.HOBUNJI_TOWN_SIGN_FURNITURE_CONFIG = {
    version: 1,
    mapId: 'map_hobunji_town',
    description: 'Editable authored-furniture placements for business signs. +X is the support-post side; rotYDeg 90 aims it toward world north (-Z).',
    placements,
  };
})();
