const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict'),mongoose=require('mongoose');
const root=path.resolve(__dirname,'../..');
module.exports=async uri=>{
 await mongoose.connect(uri);assert.equal(mongoose.connection.name,'calendar_payment_recovery');const cache=new Map();
 function load(file){if(cache.has(file))return cache.get(file);const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(name=>{if(name.endsWith('/config/database'))return{ensureConnection:async()=>assert.equal(mongoose.connection.name,'calendar_payment_recovery')};if(name.startsWith('.'))return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name))+'.ts');return require(name);},module,module.exports);cache.set(file,module.exports);return module.exports;}
 const Payment=load('server/models/Payment.ts').Payment,Transaction=load('server/models/Transaction.ts').default,Receipt=load('server/models/Receipt.ts').default;
 await Promise.all([Payment.init(),Transaction.init(),Receipt.init()]);return{Payment,Transaction,Receipt,service:load('server/services/calendarPaymentService.ts'),transactions:load('server/services/transactionService.ts'),archive:load('server/services/transactionArchiveService.ts'),close:()=>mongoose.disconnect()};
};
