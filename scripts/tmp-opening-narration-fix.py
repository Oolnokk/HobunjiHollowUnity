from pathlib import Path

path = Path('scripts/test-introduction-loading-and-framing.js')
text = path.read_text()
old = """    let continued=false;
    const done=session.complete(i===3?pendingAssets:undefined).then(()=>{continued=true;});
    if(i===0){
      assert.equal(stageText.style.opacity,'0','first words stay hidden before wind playback');
      clock+=9000;for(let tick=0;tick<5;tick++)await Promise.resolve();
      assert.equal(session.getDebug().ready,false,'page timer cannot finish before the wind begins');
      releaseWind();for(let tick=0;tick<5;tick++)await Promise.resolve();
      assert.equal(stageText.style.opacity,'1','first words fade in only after wind starts');
    }
    continueButton.events.get('click')();await Promise.resolve();assert.equal(continued,false,'early input cannot skip loading or minimum duration');
    clock+=2999;assert.equal(timers[0].at,clock+1);
    clock++;timers.shift().fn();for(let tick=0;tick<5;tick++)await Promise.resolve();
"""
new = """    let continued=false;
    const done=session.complete(i===3?pendingAssets:undefined).then(()=>{continued=true;});
    const flushMicrotasks=async(count=12)=>{for(let tick=0;tick<count;tick++)await Promise.resolve();};
    if(i===0){
      assert.equal(stageText.style.opacity,'0','first words stay hidden before wind playback');
      clock+=9000;await flushMicrotasks();
      assert.equal(session.getDebug().ready,false,'page timer cannot finish before the wind begins');
      assert.equal(timers.length,0,'no page-duration timer starts while waiting for audible wind');
      releaseWind();await flushMicrotasks();
      assert.equal(stageText.style.opacity,'1','first words fade in only after wind starts');
    } else await flushMicrotasks();
    continueButton.events.get('click')();await flushMicrotasks(2);assert.equal(continued,false,'early input cannot skip loading or minimum duration');
    await flushMicrotasks();
    const minimumAt=clock+3000;
    const minimumTimerIndex=timers.findIndex(timer=>timer.at===minimumAt);
    assert(minimumTimerIndex>=0,'authored three-second page timer is scheduled after the page becomes visible');
    clock+=2999;await flushMicrotasks(2);assert.equal(session.getDebug().ready,false,'page stays gated until its authored duration elapses');
    clock++;
    const [minimumTimer]=timers.splice(minimumTimerIndex,1);minimumTimer.fn();await flushMicrotasks();
"""
if old not in text:
    raise SystemExit('runtime loop target not found')
path.write_text(text.replace(old, new, 1))
