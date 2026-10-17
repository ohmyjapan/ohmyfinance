const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),file=path.join(root,'server/services/financeIntakeActionService.ts');
function load(){
 const calls=[];
 const intake={};
 for(const name of ['listRecords','readRecord','readSheet','previewImport','listBatches','listTemplates'])intake[name]=async(...args)=>{calls.push({name,args});return name==='listRecords'?{records:[{id:'one',revision:1,values:{merchant:'ＡＢＣ'},archived:false}],counts:{total:1}}:{native:name,args};};
 const rows={},models={initializeIntake:async()=>{}};
 for(const name of ['IntakeRecord','IntakeBatch','IntakeTemplate','IntakeResearch'])models[name]=Object.fromEntries(['findOne','find'].map(method=>[method,query=>{calls.push({name,query});const chain={select:()=>chain,limit:()=>chain,lean:async()=>rows[name]??(method==='find'?[]:null)};return chain;}]));
 const module={exports:{}};
 const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(compiled,{module,exports:module.exports,require:id=>id==='./financeIntakeService'?intake:id==='../models/FinanceIntake'?models:id==='./financeIntakeResearchService'?{researchView:async(...args)=>{calls.push({name:'researchView',args});return{research:{state:'ready',verified:false}};}}:id==='./financeService'?{fail:(status,message)=>{throw Object.assign(Error(message),{statusCode:status});}}:(()=>{throw Error('Unexpected dependency '+id);})()},{timeout:1000});
 return{...module.exports,calls,intake,rows};
}
test('intake pages have their own context; legacy draft pages retain theirs',async()=>{
 const {assistantPage}=await import(pathToFileURL(path.join(root,'shared/finance-assistant.mjs')).href);
 assert.equal(assistantPage('/intake'),'intake','navi-intake:page-context');
 assert.equal(assistantPage('/intake/'+'a'.repeat(24)),'intake');
 assert.equal(assistantPage('/intake/payments'),'intake-payments');
 assert.equal(assistantPage('/mapping-draft/'+'b'.repeat(24)+'/2'),'draft');
 assert.equal(assistantPage('/reports'),'reports');
});
test('catalogue exposes fourteen named workspace actions with no generic proxy or owner input',t=>{
 if(!fs.existsSync(file)){t.skip('New adapter module absent on baseline');return;}
 const {intakeActions}=load();
 assert.equal(intakeActions.length,14);assert.equal(intakeActions.filter(a=>a.effect==='read').length,7);
 for(const a of intakeActions){assert.deepEqual([...a.modes],['workspace']);assert.equal(a.targeted,false);assert.equal(a.inputSchema.additionalProperties,false);assert.equal(a.inputSchema.properties.ownerId,undefined);}
 assert.equal(intakeActions.some(a=>/http|shell|query|eval/.test(a.name)),false);
});
test('frozen selection fills only missing resource arguments and does not mutate the selection',t=>{
 if(!fs.existsSync(file)){t.skip('New adapter module absent on baseline');return;}
 const {intakeActionArgs}=load(),selected={recordId:'a'.repeat(24),documentId:'b'.repeat(24),sheet:'Orders',headerRow:2};
 const args=intakeActionArgs('get_intake_record',{},selected);selected.recordId='c'.repeat(24);
 assert.equal(args.recordId,'a'.repeat(24),'navi-intake:frozen-record');
 assert.equal(intakeActionArgs('get_intake_record',{recordId:'d'.repeat(24)},selected).recordId,'d'.repeat(24));
 const sheet=intakeActionArgs('read_intake_sheet',{},selected);assert.equal(sheet.documentId,'b'.repeat(24));assert.equal(sheet.sheet,'Orders');assert.equal(sheet.headerRow,2);
 assert.equal(intakeActionArgs('list_accounts',{},selected).recordId,undefined);
});
test('record and existing-sheet reads use the claimed owner and native operations',async t=>{
 if(!fs.existsSync(file)){t.skip('New adapter module absent on baseline');return;}
 const {intakeActions,calls}=load(),scope={ownerId:'claimed-owner'};
 const record=intakeActions.find(a=>a.name==='get_intake_record');
 await record.run(scope,{recordId:'a'.repeat(24),ownerId:'injected-owner'});
 assert.equal(calls[0].name,'readRecord');assert.equal(calls[0].args[0],'claimed-owner','navi-intake:claimed-owner');
 await intakeActions.find(a=>a.name==='read_intake_sheet').run(scope,{documentId:'b'.repeat(24),sheet:'Orders',headerRow:3});
 assert.equal(calls[1].name,'readSheet');assert.equal(calls[1].args[2],'Orders');assert.equal(calls[1].args[3],3);
 assert.throws(()=>record.run(scope,{}),e=>e.statusCode===400);
});
test('search normalizes text without pretending bounded counts cover all history',async t=>{
 if(!fs.existsSync(file)){t.skip('New adapter module absent on baseline');return;}
 const {intakeActions}=load(),result=await intakeActions.find(a=>a.name==='list_intake_records').run({ownerId:'owner'},{search:'abc',limit:1});
 assert.equal(result.records[0].id,'one');assert.equal(result.nativePopulationLimit,5000);assert.equal(result.matchingLoadedRecords,1);
});
test('fixture refuses zero-group and skipped-test success claims',async()=>{
 const {validateFixtureResults}=await import(pathToFileURL(path.join(root,'scripts/zoomer-fixtures/omf-navi-intake.mjs')).href);
 const unit={code:0,text:'# pass 9\n# fail 0\n# skipped 0'},api={code:0,text:'15 Navi intake API groups passed'};
 assert.equal(validateFixtureResults(unit,api),true);
 assert.equal(validateFixtureResults(unit,{code:0,text:'0 Navi intake API groups passed'}),false);
 assert.equal(validateFixtureResults({code:0,text:'# pass 0\n# fail 0'},api),false);
 assert.equal(validateFixtureResults(unit,{...api,code:1}),false);
 assert.equal(validateFixtureResults({...unit,text:unit.text.replace('skipped 0','skipped 1')},api),false);
 assert.equal(validateFixtureResults({...unit,code:'SIGTERM'},api),false);
});
test('expired intake writes without proof remain unresolved, never failed before write',async()=>{
 const {intakeActionOutcome,unresolvedIntakeAction,intakeRequestId}=load();
 const op={name:'patch_intake_record',operationId:'abcd'.repeat(8),intakeArgs:{recordId:'a'.repeat(24),revision:2,values:{notes:'confirmed instruction'}}};
 assert.equal(await intakeActionOutcome('owner',op),null);
 assert.equal(unresolvedIntakeAction(op).state,'unresolved');assert.equal(unresolvedIntakeAction(op).recoveryOwner,'user');
 assert.match(intakeRequestId(op.operationId),/^[a-f0-9-]{36}$/);assert.equal(intakeRequestId(op.operationId),intakeRequestId(op.operationId));
});
test('import markers distinguish completed batch, partial rows and optional template',async()=>{
 const {intakeActionOutcome,rows,calls}=load(),op={name:'apply_intake_import',operationId:'1'.repeat(32),intakeArgs:{documentId:'a'.repeat(24)}};
 rows.IntakeRecord=[{_id:'record-one'}];let r=await intakeActionOutcome('owned-user',op);assert.equal(r.state,'unresolved');assert.equal(r.receipt.nativeResourceIds.partial,true);
 assert.ok(calls.every(c=>!c.query||c.query.ownerId==='owned-user'));
 rows.IntakeRecord=[];rows.IntakeTemplate={_id:'template-one'};r=await intakeActionOutcome('owned-user',op);assert.equal(r.state,'unresolved');assert.equal(r.receipt.nativeResourceIds.templateId,'template-one');
 rows.IntakeBatch={_id:'batch-one',documentId:'a'.repeat(24),counts:{new:1}};r=await intakeActionOutcome('owned-user',op);assert.equal(r.state,'done');assert.equal(r.receipt.nativeResourceIds.batchId,'batch-one');
});
test('record confirmation requires both native markers and queue recovery survives research rollover',async()=>{
 const {intakeActionOutcome,intakeRequestId,rows}=load(),op={name:'confirm_intake_research',operationId:'2'.repeat(32),intakeArgs:{recordId:'a'.repeat(24)}};
 rows.IntakeRecord={_id:op.intakeArgs.recordId,history:[{operation:{operationId:op.operationId,name:op.name,revision:7},researchId:'research-one',verified:false}]};
 let r=await intakeActionOutcome('owner',op);assert.equal(r.state,'unresolved');assert.equal(r.receipt.acceptedRevision,7);assert.equal(r.receipt.nativeResourceIds.recordSaved,true);
 rows.IntakeResearch={confirmed:{operation:{operationId:op.operationId,name:op.name}},history:[]};r=await intakeActionOutcome('owner',op);assert.equal(r.state,'done');assert.equal(r.receipt.nativeResourceIds.verified,false);
 op.name='start_intake_research';rows.IntakeResearch={_id:'research-one',requestId:'newer-request',history:[{requestId:intakeRequestId(op.operationId),operation:{operationId:op.operationId,name:op.name,revision:4}}]};
 r=await intakeActionOutcome('owner',op);assert.equal(r.outcome,'queued');assert.equal(r.receipt.acceptedRevision,4);
});
