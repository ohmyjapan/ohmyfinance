const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vue=require('vue');
const {parse,compileScript}=require('@vue/compiler-sfc');
const {compile}=require('@vue/compiler-dom');
const {renderToString}=require('vue/server-renderer');
const filename=path.resolve(__dirname,'../../components/receipt/ReceiptMatchDialog.vue');
const {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
const script=compileScript(descriptor,{id:'receipt-dialog-regression'});
const compiled=ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const render=new Function('Vue',compile(descriptor.template.content,{mode:'function',prefixIdentifiers:true}).code)(vue);

module.exports=async({receipt,authHeader,fetch})=>{
  let mounted;const emitted=[];const module={exports:{}};
  const imports={vue:{...vue,onMounted:fn=>{mounted=fn;}},'~/stores/user':{useUserStore:()=>({authHeader})},'lucide-vue-next':new Proxy({},{get:()=>()=>null})};
  new Function('require','module','exports','useI18n','$fetch',compiled)(name=>{
    if(!Object.hasOwn(imports,name))throw Error('Unexpected dependency: '+name);return imports[name];
  },module,module.exports,()=>({t:key=>key,locale:vue.ref('ja')}),fetch);
  const props={receipt};
  const state=module.exports.default.setup(props,{expose:()=>{},emit:(...args)=>emitted.push(args)});
  await mounted();
  const app=vue.createSSRApp({setup:()=>({...state,...props}),render});
  for(const name of ['StatusBadge','LinkIcon','FileText','Search','CheckCircle'])app.component(name,{render:()=>null});
  return {state,emitted,html:await renderToString(app)};
};
