const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),pinia=require('pinia');
module.exports=({fetch,authHeader})=>{
 pinia.setActivePinia(pinia.createPinia());
 const code=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../stores/shipment.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}},imports={pinia,'~/stores/user':{useUserStore:()=>({authHeader})}};
 new Function('require','module','exports','$fetch',code)(name=>{if(!Object.hasOwn(imports,name))throw Error('Unexpected dependency: '+name);return imports[name];},module,module.exports,fetch);
 return module.exports.useShipmentStore();
};
