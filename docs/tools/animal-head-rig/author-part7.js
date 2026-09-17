'use strict';

// author-part6 has to install before this so its shoulder presentation helpers
// exist. This tiny final wrapper refreshes run1/split art only AFTER applyRecord
// has committed the newly selected record to state.baseRecord; otherwise a fast
// animal switch can briefly request the previous species' run1 frame.
const shoulderAwareApplyRecord=applyRecord; // Current applyRecord already restores the saved shoulder configuration.
applyRecord=function applyRecordThenRefreshShoulderFrame(record,index=-1){
  const result=shoulderAwareApplyRecord(record,index);
  clearShoulderFrameCache();
  refreshShoulderPresentation();
  return result;
};
