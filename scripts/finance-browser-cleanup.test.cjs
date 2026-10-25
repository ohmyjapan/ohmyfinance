const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once,EventEmitter}=require('node:events');
const {closeOwnedBrowser}=require('./finance-browser-cleanup.cjs');
const bounds={graceMs:50,exitMs:5000};
const gone=child=>child.exitCode!=null||child.signalCode!=null;
const launch=()=>spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{windowsHide:true,stdio:'ignore'});
async function stop(child){if(!gone(child)){const done=once(child,'exit');child.kill();await done}}
const browserFor=(child,close)=>{let disconnects=0;return{process:()=>child,close,disconnect(){disconnects++},get disconnects(){return disconnects}}};

test('graceful shutdown observes the owned child exit and disconnects',async()=>{
 const child=launch();try{const browser=browserFor(child,async()=>{await stop(child)}),result=await closeOwnedBrowser(browser,bounds);assert.equal(result.forced,false,'cleanup:graceful-not-forced');assert.ok(gone(child),'cleanup:graceful-exit');assert.equal(browser.disconnects,1,'cleanup:disconnect')}finally{await stop(child)}
});
test('a stalled protocol close force-stops only the owned child and waits for its exit',async()=>{
 const child=launch(),other=launch();try{const browser=browserFor(child,()=>new Promise(()=>{}));let result;await assert.doesNotReject(async()=>{result=await closeOwnedBrowser(browser,bounds)},'cleanup:stalled-close-completes');assert.equal(result.forced,true,'cleanup:forced-recorded');assert.ok(gone(child),'cleanup:forced-exit-observed');assert.equal(gone(other),false,'cleanup:other-process-untouched');assert.equal(browser.disconnects,1,'cleanup:forced-disconnect')}finally{await stop(child);await stop(other)}
});
test('an already exited browser does not need another protocol close or kill',async()=>{
 const child=launch();await stop(child);let calls=0;const browser=browserFor(child,()=>{calls++;throw Error('must not close again')});const result=await closeOwnedBrowser(browser,bounds);assert.equal(calls,0,'cleanup:already-exited-no-close');assert.equal(result.forced,false);assert.equal(browser.disconnects,1);
});
test('a protocol error still cleans up its owned process and records the error kind',async()=>{
 const child=launch();try{const browser=browserFor(child,async()=>{throw new TypeError('synthetic protocol error')}),result=await closeOwnedBrowser(browser,bounds);assert.ok(gone(child),'cleanup:protocol-error-exit');assert.equal(result.forced,true);assert.equal(result.protocolError,'TypeError')}finally{await stop(child)}
});
test('a child exit can complete cleanup while the protocol close promise stays pending',async()=>{
 const child=launch();try{const browser=browserFor(child,()=>{child.kill();return new Promise(()=>{})}),result=await closeOwnedBrowser(browser,{graceMs:5000,exitMs:5000});assert.ok(gone(child),'cleanup:exit-completes-pending-protocol');assert.equal(result.forced,false);assert.equal(browser.disconnects,1)}finally{await stop(child)}
});
test('unverified exit fails and preserves the original test error',async()=>{
 const child=Object.assign(new EventEmitter(),{pid:12345,exitCode:null,signalCode:null,kill(){return false}}),primary=new assert.AssertionError({message:'synthetic primary assertion'}),browser=browserFor(child,()=>new Promise(()=>{}));await assert.rejects(closeOwnedBrowser(browser,{graceMs:5,exitMs:5,primaryError:primary}),error=>error instanceof AggregateError&&error.errors[0]===primary&&/did not exit/.test(error.errors[1].message),'cleanup:unverified-exit-keeps-primary');assert.equal(browser.disconnects,1);
});
test('an unowned browser is refused before protocol close or disconnect',async()=>{
 let calls=0;await assert.rejects(closeOwnedBrowser({process:()=>null,close(){calls++},disconnect(){calls++}},bounds),/Owned browser process required/,'cleanup:no-unowned-close');assert.equal(calls,0);
});
test('an ownership failure also retains an earlier test assertion',async()=>{
 const primary=new assert.AssertionError({message:'synthetic original test failure'});await assert.rejects(closeOwnedBrowser({process:()=>null},{...bounds,primaryError:primary}),error=>error instanceof AggregateError&&error.errors[0]===primary&&/Owned browser process required/.test(error.errors[1].message),'cleanup:ownership-keeps-primary');
});
