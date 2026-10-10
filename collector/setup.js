const key=location.hash.slice(1); history.replaceState(null,'','/');
const status=document.querySelector('#status');
const $=selector=>document.querySelector(selector);
let current={};
async function call(route,body) {
  const progress=['/pair','/protect','/unlock','/protect/reset'].includes(route)?setInterval(()=>refresh().catch(()=>{}),1500):null;
  try{
  const response=await fetch(route,{method:body?'POST':'GET',headers:{'X-Setup-Key':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json(); if(!response.ok)throw Error(data.error || 'Request failed');return data;
  }finally{if(progress)clearInterval(progress);}
}
// Login forms require an active protected connection. Explicit approval requests are not retried by this page.
function showProtection(data) {
  const unlocked=!!data.unlocked, transitioning=!!data.authorizing || !!data.locking, protectedBatch=unlocked && !transitioning && data.mode==='protected';
  const text=data.locking ? 'Closing the connection and its browser…'
    : data.authorizing ? 'Approve this action in OMF. Use Lock to cancel.'
    : data.legacy ? 'Your saved logins use the previous storage format. Connect to OMF and enable protection to upgrade them.'
    : !data.aclProtected ? 'Private directory permissions are not verified; protection and unlocking are refused until the collector is restarted with a verified directory.'
    : data.elevated ? 'The collector is running with administrator rights; restart it as a normal user.'
    : data.keyLost ? 'The protection key is no longer on this device.'
    : data.capability===false && !data.protected ? 'This PC has no protected key storage. Manual bank sign-in is available instead.'
    : !data.protected ? 'Enable protection to save encrypted logins on this PC.'
    : unlocked ? data.mode==='manual'?`Manual session until ${new Date(data.unlockUntil).toLocaleTimeString()}.`:'Connected. Automatic syncing is ready.'
    : data.paused ? 'Paused. Resume to collect again.' : data.reconnectNeeded?'Reconnect this PC through OMF to resume automatic syncing.':'Waiting to resume automatic syncing.';
  $('#protection-message').textContent=data.message ? `${text}\n${data.message}` : text;
  const approval=$('#omf-approval');approval.classList.toggle('hidden',!data.approvalUrl);
  if(data.approvalUrl)approval.href=data.approvalUrl;else approval.removeAttribute('href');
  const list=$('#protection-state');list.replaceChildren();
  for(const [label,value] of [['Protected',data.protected],['Unlocked',unlocked],['Mode',data.mode||'—'],['Due work in OMF',data.due],['Paused',data.paused],['Key storage',data.capability===null||data.capability===undefined?'unknown':data.capability?'available':'missing'],['Directory permissions',data.aclProtected===null?'checking':data.aclProtected?'verified':'NOT verified'],['Administrator rights',data.elevated],['Chrome found',data.chromeFound],['Test broker',data.testBroker]]) {
    const item=document.createElement('li'),name=document.createElement('b');name.textContent=label+': ';item.append(name,document.createTextNode(typeof value==='boolean'?(value?'yes':'no'):String(value)));list.append(item);
  }
  $('#protect').disabled=transitioning || !!data.busy || data.protected || data.legacy===false && data.capability===false || !data.aclProtected || !!data.elevated || unlocked;
  $('#unlock').disabled=transitioning || !!data.busy || !data.protected || unlocked || data.paused || data.mode==='manual';
  $('#lock').disabled=!!data.locking || (!unlocked && !data.authorizing);
  $('#pause').disabled=!!data.paused || data.legacy;
  $('#resume').disabled=!data.paused;
  $('#manual-mode').classList.toggle('hidden',!(data.mode!=='manual' && !data.protected));
  $('#manual-mode').disabled=unlocked || transitioning;
  $('#batch-start').classList.toggle('hidden',data.mode!=='manual');
  $('#batch-start').disabled=unlocked || transitioning || !!data.paused || !data.aclProtected || !!data.elevated;
  $('#reset-form').classList.toggle('hidden',!data.keyLost);
  for(const id of ['#mailbox-save','#aplus-save','#yayoi-save'])$(id).disabled=!protectedBatch || !!data.busy;
  $('#yayoi-open').disabled=!protectedBatch || !!data.busy || !data.yayoi?.hasCredentials;
  $('#mailbox-saved').textContent=data.mailbox?.hasCredentials?'Mailbox access saved. Enter all fields to replace it.':'No mailbox access saved.';
}
async function refresh() {
  const data=await call('/status');current=data;status.textContent=data.baseUrl?`Connected to ${data.baseUrl}`:(data.legacy?'Connect to OMF to upgrade the saved logins.':'Not connected to OMF.');
  showProtection(data);showYayoi(data.yayoi,data.busy,data);showAplus(data.aplus,data.busy,data);
  $('#url').value=data.baseUrl || '';
  $('#pair-save').disabled=!!data.authorizing || !!data.locking || !!data.unlocked;
  const main=$('#accounts');main.replaceChildren();
  for(const account of data.accounts) {
    const section=document.createElement('section'),title=document.createElement('h2'),note=document.createElement('p'),form=document.createElement('form');
    title.textContent=account.name;note.textContent=account.hasCredentials?'Login saved. Enter both fields to replace it.':'Enter the login for this Amex account.';
    const values={};
    for(const [name,label,type] of [['username','Amex user ID','text'],['password','Amex password','password']]) {
      const el=document.createElement('input'),l=document.createElement('label');el.id=account.id+name;el.type=type;el.required=true;el.autocomplete='off';l.htmlFor=el.id;l.textContent=label;form.append(l,el);values[name]=el;
    }
    const button=document.createElement('button');button.textContent='Save encrypted login';button.disabled=!(data.unlocked && data.mode==='protected') || !!data.busy;form.append(button);
    form.onsubmit=async e=>{e.preventDefault();button.disabled=true;try{await call('/credentials',{accountId:account.accountId,username:values.username.value,password:values.password.value});values.password.value='';values.username.value='';await refresh();}catch(error){status.textContent=error.message;button.disabled=false;}};
    section.append(title,note,form);main.append(section);
  }
}
$('#pair').onsubmit=async e=>{e.preventDefault();try{await call('/pair',{baseUrl:$('#url').value,token:$('#token').value});$('#token').value='';await refresh();}catch(error){status.textContent=error.message;}};
async function finishProtectionAction(button,failure) {
  try{await refresh();}catch(error){failure ||= error;button.disabled=false;}
  // Refresh the controls first; its status text must not erase the action's failure.
  if(failure)$('#protection-message').textContent=failure.message;
}
function action(id,route,body,confirmText) {
  $(id).onclick=async()=>{
    const button=$(id);button.disabled=true;let failure=null;
    if(['/protect','/unlock','/batch/start'].includes(route))showProtection({...current,authorizing:true});
    if(route==='/lock')showProtection({...current,locking:true});
    try{await call(route,body ? body() : {});}catch(error){failure=error;}
    finally{await finishProtectionAction(button,failure);}
  };
}
action('#protect','/protect');action('#unlock','/unlock');action('#lock','/lock');action('#pause','/pause');action('#resume','/resume');
action('#manual-mode','/mode',()=>({mode:'manual'}));action('#batch-start','/batch/start');
$('#reset-form').onsubmit=async e=>{e.preventDefault();const button=$('#reset');button.disabled=true;let failure=null;try{await call('/protect/reset',{confirm:$('#reset-confirm').value});$('#reset-confirm').value='';}catch(error){failure=error;}finally{button.disabled=false;await finishProtectionAction(button,failure);}};
$('#mailbox-form').onsubmit=async e=>{
  e.preventDefault();const button=$('#mailbox-save');button.disabled=true;
  const fields={clientId:$('#mailbox-client-id'),clientSecret:$('#mailbox-client-secret'),refreshToken:$('#mailbox-refresh-token'),mailbox:$('#mailbox-address')};
  try{await call('/mailbox',Object.fromEntries(Object.entries(fields).map(([name,el])=>[name,el.value])));$('#mailbox-status').textContent='Mailbox access saved on this PC.';await refresh();}
  catch(error){$('#mailbox-status').textContent=error.message;button.disabled=false;}
  finally{for(const el of Object.values(fields))el.value='';}
};
let yayoiTimer;
function showYayoi(data,busy,all=current) {
  $('#yayoi-saved').textContent=data.hasCredentials?'Login saved. Enter both fields to replace it.':'Enter the login you use for Yayoi.';
  $('#yayoi-status').textContent=data.message;
  const protectedBatch=!!all.unlocked && all.mode==='protected';
  $('#yayoi-save').disabled=!!busy || !protectedBatch;
  $('#yayoi-open').disabled=!!busy || !data.hasCredentials || !protectedBatch;
  clearTimeout(yayoiTimer);
  if(busy)yayoiTimer=setTimeout(()=>refreshYayoi().catch(showYayoiError),2000);
}
function showYayoiError(error) { $('#yayoi-status').textContent=error.message; }
async function refreshYayoi() {const data=await call('/yayoi/status');showYayoi(data.yayoi,data.busy,{...current,unlocked:data.unlocked});}
$('#yayoi-form').onsubmit=async e=>{
  e.preventDefault();const button=$('#yayoi-save'),username=$('#yayoi-username'),password=$('#yayoi-password');
  button.disabled=true;
  try {await call('/yayoi/credentials',{username:username.value,password:password.value});username.value='';password.value='';await refresh();}
  catch(error){showYayoiError(error);button.disabled=false;}
  finally{password.value='';}
};
$('#yayoi-open').onclick=async()=>{
  const button=$('#yayoi-open');button.disabled=true;
  try{await call('/yayoi/open',{});await refreshYayoi();}catch(error){showYayoiError(error);button.disabled=false;}
};
let aplusTimer;
function showAplus(data,busy,all=current) {
  $('#aplus-saved').textContent=data.hasCredentials?'Login saved. Enter both fields to replace it.':'Enter the login you use for My APLUS.';
  $('#aplus-save').disabled=!!busy || !(all.unlocked && all.mode==='protected');
  clearTimeout(aplusTimer);
  if(busy)aplusTimer=setTimeout(()=>refreshAplus().catch(error=>{$('#aplus-status').textContent=error.message;}),2000);
}
async function refreshAplus() {const data=await call('/aplus/status');showAplus(data.aplus,data.busy,{...current,unlocked:data.unlocked});}
$('#aplus-form').onsubmit=async e=>{
  e.preventDefault();const button=$('#aplus-save'),username=$('#aplus-username'),password=$('#aplus-password');
  button.disabled=true;
  try {await call('/aplus/credentials',{username:username.value,password:password.value});username.value='';password.value='';$('#aplus-status').textContent='Aplus login saved on this computer.';await refresh();}
  catch(error){$('#aplus-status').textContent=error.message;button.disabled=false;}
  finally{password.value='';}
};
refresh().catch(error=>{status.textContent=error.message;$('#protection-message').textContent=error.message;showYayoiError(error);$('#aplus-status').textContent=error.message;});
