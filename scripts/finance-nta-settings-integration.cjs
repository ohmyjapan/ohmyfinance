const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url');
async function main(){
 assert.equal(process.env.OMF_NTA_SETTINGS_FIXTURE,'owned');
 const root=path.resolve(__dirname,'..'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-nta-settings-owned-'));
 let local;
 try{
  const {startResearchSettings}=await import(pathToFileURL(path.join(root,'research-worker/settings.mjs')).href),{Vault}=await import(pathToFileURL(path.join(root,'collector/vault.mjs')).href);
  const config={},key='Ab12345CD6789';let changes=0;local=await startResearchSettings(directory,config,async()=>changes++);
  const origin=new URL(local.url).origin,post=async(value,requestOrigin=origin)=>fetch(local.url,{method:'POST',headers:{'Content-Type':'application/json',Origin:requestOrigin},body:JSON.stringify({applicationId:value})});
  const accepted=await post(key);assert.equal(accepted.status,200,'nta-settings:official-alphanumeric-id');assert.equal((await accepted.json()).saved,true);
  assert.equal((await new Vault(directory).read()).ntaApplicationId,key,'nta-settings:literal-private-vault');assert.equal(config.ntaApplicationId,key);assert.equal(changes,1);
  const form=await(await fetch(local.url)).text(),pattern=/\bid="id"[^>]*\bpattern="([^"]+)"/.exec(form)?.[1],mode=/\bid="id"[^>]*\binputmode="([^"]+)"/.exec(form)?.[1];assert.ok(pattern);assert.ok(new RegExp('^(?:'+pattern+')$').test(key),'nta-settings:browser-accepts-letters');assert.notEqual(mode,'numeric','nta-settings:keyboard-accepts-letters');
  for(const bad of['short','Ab12345CD67890','Ab12345CD678!','\uFF21b12345CD6789']){const r=await post(bad);assert.equal(r.status,400,'nta-settings:invalid-id');await r.text();}
  const denied=await post('Cd12345EF6789','https://example.invalid');assert.equal(denied.status,403,'nta-settings:origin-stays-private');await denied.text();
  assert.equal((await new Vault(directory).read()).ntaApplicationId,key);assert.equal(changes,1);
  console.log('PASS native private NTA settings: official alphanumeric ID, real Vault, served form keyboard/pattern, invalid IDs and foreign origin');
 }finally{if(local)local.close();assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('omf-nta-settings-owned-'));await fs.rm(directory,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});
