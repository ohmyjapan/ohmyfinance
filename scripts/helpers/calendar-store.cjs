const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),pinia=require('pinia'),vue=require('vue');
module.exports=({fetch,user})=>{
 pinia.setActivePinia(pinia.createPinia());const code=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../stores/calendar.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}},imports={pinia,vue,'~/stores/user':{useUserStore:()=>user}};
 new Function('require','module','exports','$fetch',code)(name=>{if(!Object.hasOwn(imports,name))throw Error(name);return imports[name];},module,module.exports,fetch);
 return module.exports.useCalendarStore();
};
