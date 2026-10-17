const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),file=path.join(root,'server/services/financeIntakeActionService.ts');
function load(){
 const calls=[];
 const intake={};
 for(const name of ['listRecords','readRecord','readSheet','previewImport','listBatches','listTemplates'])intake[name]=async(...args)=>{calls.push({name,args});return name==='listRecords'?{records:[{id:'one',revision:1,values:{merchant:'ＡＢＣ'},archived:false}],counts:{total:1}}:{native:name,args};};
 const module={exports:{}};
 const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(compiled,{module,exports:module.exports,require:id=>id==='./financeIntakeService'?intake:id==='./financeIntakeResearchService'?{researchView:async(...args)=>{calls.push({name:'researchView',args});return{research:{state:'ready',verified:false}};}}:id==='./financeService'?{fail:(status,message)=>{throw Object.assign(Error(message),{statusCode:status});}}:(()=>{throw Error('Unexpected dependency '+id);})()},{timeout:1000});
 return{...module.exports,calls,intake};
}
test('intake pages have their own context; legacy draft pages retain theirs',async()=>{
 const {assistantPage}=await import(pathToFileURL(path.join(root,'shared/finance-assistant.mjs')).href);
 assert.equal(assistantPage('/intake'),'intake','navi-intake:page-context');
 assert.equal(assistantPage('/intake/'+'a'.repeat(24)),'intake');
 assert.equal(assistantPage('/intake/payments'),'intake-payments');
 assert.equal(assistantPage('/mapping-draft/'+'b'.repeat(24)+'/2'),'draft');
 assert.equal(assistantPage('/reports'),'reports');
});
test('catalogue exposes seven workspace reads and no intake write or generic proxy',t=>{
 if(!fs.existsSync(file)){t.skip('New adapter module absent on baseline');return;}
 const {intakeActions}=load();
 assert.equal(intakeActions.length,7);
 for(const a of intakeActions){assert.equal(a.effect,'read');assert.deepEqual([...a.modes],['workspace']);assert.equal(a.targeted,false);assert.equal(a.inputSchema.additionalProperties,false);assert.equal(a.inputSchema.properties.ownerId,undefined);}
 assert.equal(intakeActions.some(a=>/create|save|confirm|archive|apply|http|shell/.test(a.name)),false);
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
 const unit={code:0,text:'# pass 6\n# fail 0'},api={code:0,text:'6 Navi intake API groups passed'};
 assert.equal(validateFixtureResults(unit,api),true);
 assert.equal(validateFixtureResults(unit,{code:0,text:'0 Navi intake API groups passed'}),false);
 assert.equal(validateFixtureResults({code:0,text:'# pass 0\n# fail 0'},api),false);
 assert.equal(validateFixtureResults(unit,{...api,code:1}),false);
});
