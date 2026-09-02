(() => {
  'use strict';

  // Single tuning surface for the Shipping Box feature. Runtime modules should
  // read these values rather than embedding Shipping Box-specific numbers,
  // labels, action ids, timing rules, material policy, or permission names.
  // Geometry/per-part authored colors remain in config/furniture-authored/
  // shippingBox.json because that file is the furniture database itself.
  window.ShippingBoxConfig = {
    version: '2026-09-02.1',

    object: {
      id: 'sell_crate',
      type: 'sell_crate',
      icon: '📦',
      label: 'Shipping Box',
      authoredFurnitureKey: 'shippingBox',
      visualSource: 'authored-shipping-box',
      footprint: { width: 2, height: 1 },
      blocksMovement: true,
      centerOffset: { x: 1, z: 0.5 },
      lidLiftWhenOccupied: 0.06,
      parts: {
        body: 'shipping_box_body',
        lid: 'shipping_box_lid_panel',
        lock: 'shipping_box_lock',
        lidRimPrefix: 'shipping_box_lid_rim_',
      },
      fallback: {
        sourceCatalogKey: 'chest',
        stretchX: 2,
        baseColor: '#7b4c2b',
        minScale: 0.001,
        body: { size: [1.6, 0.38, 0.5], position: [0, 0.19, 0], color: '#7b4c2b' },
        lid: { size: [1.64, 0.08, 0.52], position: [0, 0.42, 0], color: '#915c35' },
        lock: { size: [0.12, 0.08, 0.03], position: [0, 0.39, 0.26], color: '#3d2a1d' },
      },
    },

    material: {
      // Every authored Shipping Box surface is forced onto this PNG after the
      // async load completes, then multiplied by its authored part color.
      texture: 'carved_smooth.png',
      textureBasePath: 'assets/textures/',
      forceTextureOnEveryPart: true,
      multiplyAuthoredColor: true,
      transparent: false,
      opacity: 1,
      wrap: 'repeat',
      center: [0.5, 0.5],
      repeat: [1, 1],
      rotationDeg: 0,
      // Must match native copper in tool-metal-recolor.js.
      copperVerdigris: '#3FAF9F',
    },

    lifecycle: {
      minCalendarDay: 1,
      pollMs: 500,
      timePassageEvent: 'hobunji-time-passage',
      resolveOnTimePassageKinds: ['wait', 'sleep'],
      farmContextAreas: ['farm', 'interior'],
      resolveIfAlreadyAwayAtMidnight: true,
      deliveryLogLimit: 12,
      reasons: {
        default: 'midnight settlement',
        alreadyAway: 'player already away from farm',
        leftFarm: 'left farm',
      },
    },

    inventory: {
      maxStack: 99,
      permissions: {
        withdraw: 'storage',
        alterFarm: 'alterFarm',
      },
    },

    actions: {
      deposit: 'obj_deposit',
      open: 'obj_open_shipping',
      legacyOpen: 'obj_show_bin',
      fallbackMenu: 'shipping',
    },

    farmUi: {
      listId: 'farmBuildingsList',
      canvasId: 'farmGlanceCanvas',
      noteId: 'farmBuildingsNote',
      cancelButtonId: 'farmCancelPlacementBtn',
      rowKind: 'shipping-box',
      rowClass: 'farm-row',
      nameClass: 'farm-row-name',
      noteClass: 'farm-note',
      moveButtonClass: 'settings-small-btn',
      moveButtonDataKey: 'shippingBoxMove',
      moveButtonText: 'Move',
      cursor: 'crosshair',
      planPrefix: '📜',
      placementPrompt: 'Click a tile on the map above to move the Shipping Box there.',
      defaultBuildingNote: 'Move a barn, or place an owned barn plan, by clicking the map above. Open House Layout to edit your house.',
      combinedBuildingNote: 'Move a barn or the Shipping Box by clicking the map above. Place owned barn plans here, or open House Layout to edit your house.',
      messages: {
        notReady: 'Shipping Box move system is not ready.',
        invalidTile: 'Choose a valid farm tile.',
        noFit: 'The Shipping Box will not fit there.',
        moved: 'Shipping Box moved.',
      },
    },

    interactionUi: {
      labels: {
        emptyFastAction: 'None',
        openOccupied: 'Open Box',
        openEmpty: 'Shipping',
        cannotDeposit: 'Cannot deposit that.',
        unknownAction: 'Unknown action.',
        emptyContents: 'Empty',
      },
      messages: {
        noItemPrefix: 'No ',
        noItemSuffix: ' to deposit.',
        depositedPrefix: 'Deposited ',
        depositedSuffix: ' into shipping box.',
      },
    },

    panel: {
      defaultSide: 'left',
      boxSide: 'right',
      allCategory: 'all',
      defaultAmount: 1,
      halfDivisor: 2,
      iconFallback: '📦',
      fontStack: "'KhymeryyanRomanLetters+Numbers', 'Pixelify Sans', 'DM Mono', monospace",
      monoFontStack: "'DM Mono', monospace",
      title: '📦 Shipping Box',
      debugButton: 'Debug',
      closeGlyph: '×',
      closeAriaLabel: 'Close shipping box',
      cameraBlockedText: 'camera input blocked',
      midnightReadyLabel: 'midnight-ready',
      pointerBlockedEvents: ['pointerdown','pointermove','pointerup','mousedown','mousemove','mouseup','touchstart','touchmove','touchend','wheel','contextmenu','click'],
      escapeKey: 'Escape',
      style: {
        paneWidth: 'min(96vw, calc(30 * var(--col)))',
        paneHeight: 'min(82vh, calc(16 * var(--row)))',
        mobilePaneWidth: '96vw',
        mobilePaneHeight: 'min(84vh, calc(16 * var(--row)))',
        zIndex: 120,
        backdrop: 'rgba(0, 0, 0, 0.22)',
        borderRadiusPx: 16,
        blurPx: 16,
        baseFont: 'clamp(12px, 1.55vmin, 16px)',
        smallFont: 'clamp(11px, 1.35vmin, 14px)',
        mediumFont: 'clamp(13px, 1.65vmin, 17px)',
        titleFont: 'clamp(16px, 2.05vmin, 20px)',
        buttonFont: 'clamp(12px, 1.45vmin, 15px)',
        iconFont: 'clamp(20px, 3vmin, 30px)',
        mobileBreakpointPx: 740,
      },
      text: {
        cannotShip: 'That item cannot be shipped.',
        withdrawDenied: "Only the farm's owner (or a granted farmhand) can take from storage.",
        boxEmpty: 'Shipping box is empty.',
        noFilterItems: 'No items in this filter.',
        selectItem: 'Select item',
        selectPackItem: 'Select an item from your pack.',
        rightFooter: 'Midnight marks items for sale. Leave the farm, Wait, or Sleep to resolve it.',
        detailName: 'Shipping Box Transfer',
        notSellable: 'Not sellable',
        detailEmpty: 'Move sellable goods from your pack into the Shipping Box. Each midnight marks everything already inside for sale; the marked shipment is actually collected when you leave the farm, Wait, or Sleep. Goods added after midnight wait for the next cutoff.',
        blockedSuffix: ' This item stays in your bag because the Shipping Box only accepts sellable goods.',
        shipOne: 'Ship 1',
        takeOne: 'Take 1',
        shipHalf: 'Ship Half',
        takeHalf: 'Take Half',
        shipStack: 'Ship Stack',
        takeStack: 'Take Stack',
      },
    },

    store: {
      categoryKey: 'sell',
      categoryLabel: 'Sell',
      insertBeforeCategoryKey: 'all',
      emptyMessage: 'No sellable items in your pack.',
      defaultDescription: 'Sell directly to Funji & Son.',
      sellOneLabel: 'Sell 1',
      sellStackLabel: 'Sell Stack',
      nothingToSellMessage: 'Nothing to sell.',
      soldPrefix: 'Sold ',
      stackQuantityToken: 'stack',
    },

    debug: {
      enabled: true,
      materialDiagnostics: true,
    },
  };
})();
