const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict'),mongoose=require('mongoose');
const root=path.resolve(__dirname,'../..');
module.exports=async uri=>{
 await mongoose.connect(uri);
 assert.equal(mongoose.connection.name,'manual_save_recovery');
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);
  const module={exports:{}};cache.set(file,module.exports);
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)(name=>{
   if(name.endsWith('/config/database'))return {ensureConnection:async()=>assert.equal(mongoose.connection.name,'manual_save_recovery')};
   if(name.startsWith('.'))return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name))+'.ts');
   return require(name);
  },module,module.exports);
  cache.set(file,module.exports);return module.exports;
 }
 const Transaction=load('server/models/Transaction.ts').default,Receipt=load('server/models/Receipt.ts').default;
 await Promise.all([Transaction.init(),Receipt.init()]);
 return {Transaction,Receipt,manual:load('server/services/manualTransactionService.ts'),transactions:load('server/services/transactionService.ts'),archive:load('server/services/transactionArchiveService.ts'),close:()=>mongoose.disconnect()};
};
// A separate process exercises recovery without an in-memory result cache.
if(require.main===module){
 let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',value=>input+=value);
 process.stdin.on('end',async()=>{let loaded;try{const {uri,access,key,body}=JSON.parse(input);loaded=await module.exports(uri);console.log(JSON.stringify(await loaded.manual.createManualTransaction(access,key,body)))}catch(error){console.error(error.message);process.exitCode=1}finally{if(loaded)await loaded.close()}});
}
