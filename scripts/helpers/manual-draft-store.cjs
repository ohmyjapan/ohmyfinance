// Client continuation test adapter. Real IndexedDB behavior is tested in Chrome.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const moduleSource=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../utils/manualDraftStore.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const loaded={exports:{}};new Function('module','exports',moduleSource)(loaded,loaded.exports);
module.exports=()=>{
 const actual=loaded.exports,rows=new Map(),copy=value=>structuredClone(value);
 const store={rows,
  async create(owner){const key=actual.newDraftKey(),row={id:actual.draftIdentity(owner,key),owner,key,state:'draft',revision:0,payload:null,previousPayloads:[],createdAt:new Date().toISOString()};rows.set(row.id,row);return copy(row)},
  async get(owner,key){return copy(rows.get(actual.draftIdentity(owner,key))||null)},
  async list(owner){return copy([...rows.values()].filter(row=>row.owner===owner&&['pending','rejected'].includes(row.state)))},
  async freeze(owner,key,payload){const id=actual.draftIdentity(owner,key),row=actual.freezeDraft(rows.get(id),copy(payload));rows.set(id,row);return copy(row)},
  async settle(owner,key,revision,state,transactionId){const id=actual.draftIdentity(owner,key),row=actual.settleDraft(rows.get(id),revision,state,transactionId);rows.set(id,row);return copy(row)}
 };
 return {...actual,manualDraftStore:store};
};
