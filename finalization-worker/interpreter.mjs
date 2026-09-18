import {spawn} from 'node:child_process';

// The application uses its configured local interpreter. Evidence is supplied
// as data; this process has no browser, shell, network or account tools.
export async function interpret(config,{system,schema,input,documents=[]},timeoutMs=120000) {
 if(!config.cliPath||!config.inferenceDirectory)throw Error('Workflow interpreter is not configured');
 const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','APPDATA','PROGRAMDATA','ComSpec'])if(process.env[k])env[k]=process.env[k];
 env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1';if(config.claudeConfigDirectory)env.CLAUDE_CONFIG_DIR=config.claudeConfigDirectory;
 const content=documents.map(d=>{
  if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(d.mimeType)||!Buffer.isBuffer(d.bytes)||d.bytes.length>10485760)throw Error('Unsupported workflow document');
  return {type:d.mimeType==='application/pdf'?'document':'image',source:{type:'base64',media_type:d.mimeType,data:d.bytes.toString('base64')}};
 });content.push({type:'text',text:JSON.stringify(input)});
 const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--json-schema',JSON.stringify(schema),'--tools','','--mcp-config','{"mcpServers":{}}','--strict-mcp-config','--setting-sources','','--settings','{"disableAllHooks":true}','--no-session-persistence','--system-prompt',system];
 return new Promise((resolve,reject)=>{
  const child=spawn(config.cliPath,args,{cwd:config.inferenceDirectory,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});let output='',settled=false;
  const done=(e,v)=>{if(settled)return;settled=true;clearTimeout(timer);e?reject(e):resolve(v)};
  const timer=setTimeout(()=>{child.kill();done(Error('Workflow interpretation timed out'))},timeoutMs);
  child.stdout.on('data',b=>{output+=b;if(output.length>3000000){child.kill();done(Error('Workflow interpretation too large'))}});child.stderr.resume();child.stdin.on('error',()=>{});
  child.once('error',()=>done(Error('Workflow interpreter unavailable')));
  child.once('close',code=>{if(code!==0)return done(Error('Workflow interpreter failed'));try{const result=output.split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s)).findLast(r=>r.type==='result');if(!result||result.is_error||!result.structured_output)throw Error();done(null,{value:result.structured_output,models:Object.keys(result.modelUsage||{})})}catch{done(Error('Invalid workflow interpretation'))}});
  child.stdin.end(JSON.stringify({type:'user',message:{role:'user',content}})+'\n');
 });
}
