// Prone-state physical motion exclusivity for player and hostile entities.
//
// The gameplay state machine already makes prone pre-empt player movement and
// hostile AI. This tiny resource-tick adapter clears transient impulse state
// that would otherwise be frozen while prone and resume after recovery.
(() => {
  'use strict';

  const RS = window.ResourceSystem;
  if (!RS?.tick || RS.__proneMotionExclusivityInstalled) return;

  let clearCount = 0;

  function clearTransientMotion(entity) {
    if (!entity?.prone) return false;
    entity.vx = 0;
    entity.vy = 0;
    entity.knockbackT = 0;
    entity.knockbackVX = 0;
    entity.knockbackVY = 0;
    clearCount++;
    return true;
  }

  const previousTick = RS.tick.bind(RS);
  RS.tick = function proneMotionExclusiveTick(entity, dt, options) {
    clearTransientMotion(entity);
    const result = previousTick(entity, dt, options);
    clearTransientMotion(entity);
    return result;
  };
  RS.__proneMotionExclusivityInstalled = true;

  window.HobunjiProneMotionExclusivity = Object.freeze({
    clearTransientMotion,
    getDebug() { return { clearCount }; },
  });
})();