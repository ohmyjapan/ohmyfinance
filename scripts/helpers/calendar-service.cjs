const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict'),mongoose=require('mongoose');
const root=path.resolve(__dirname,'../..');
module.exports=async uri=>{
 await mongoose.connect(uri);assert.equal(mongoose.connection.name,'calendar_payment_recovery');const cache=new Map();
 function load(file){if(cache.has(file))return cache.get(file);const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(name=>{if(name.endsWith('/config/database'))return{ensureConnection:async()=>assert.equal(mongoose.connection.name,'calendar_payment_recovery')};if(name.startsWith('.'))return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name))+'.ts');return require(name);},module,module.exports);cache.set(file,module.exports);return module.exports;}
 const Payment=load('server/models/Payment.ts').Payment,Transaction=load('server/models/Transaction.ts').default,Receipt=load('server/models/Receipt.ts').default;
 await Promise.all([Payment.init(),Transaction.init(),Receipt.init()]);return{Payment,Transaction,Receipt,service:load('server/services/calendarPaymentService.ts'),transactions:load('server/services/transactionService.ts'),archive:load('server/services/transactionArchiveService.ts'),close:()=>mongoose.disconnect()};
};

// Actual route/auth/membership code with every financial data access forbidden.
module.exports.loadSetupDashboard = () => {
 const touched=[],cache=new Map(),deny=name=>new Proxy({},{get(_,key){touched.push(name+'.'+String(key));throw Error('Unexpected financial read')}});
 const stubs={
  h3:require('h3'),mongoose,
  'server/config/database.ts':{ensureConnection:async()=>{touched.push('connect')}},
  'server/services/authService.ts':{verifyAccessToken:()=>{throw Error('Unexpected token verification')}},
  'server/services/tokenBlacklistService.ts':{isBlacklisted:()=>{throw Error('Unexpected blacklist lookup')}},
  'server/models/Transaction.ts':{__esModule:true,default:deny('Transaction'),activeTransactionFilter:()=>{throw Error('Unexpected financial filter')}},
  'server/models/Receipt.ts':{__esModule:true,default:deny('Receipt')},
  'server/models/Payment.ts':{Payment:deny('Payment')},
  'server/models/Organization.ts':{__esModule:true,default:deny('Organization')},
  'server/models/User.ts':{__esModule:true,default:{findById:id=>{touched.push('User.'+id);return{lean:async()=>({_id:id,name:'Synthetic',email:'setup@example.invalid'})}}}}
 };
 function load(file){
  if(stubs[file])return stubs[file];if(cache.has(file))return cache.get(file);
  assert(['server/api/dashboard/stats.ts','server/middleware/auth.ts','server/services/ledgerAccessService.ts'].includes(file),file);
  const module={exports:{}},code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)(id=>load(id.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(file),id))+'.ts':id),module,module.exports);
  cache.set(file,module.exports);return module.exports;
 }
 return{handler:load('server/api/dashboard/stats.ts').default,touched};
};
