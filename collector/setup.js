const key=location.hash.slice(1); history.replaceState(null,'','/');
const $=selector=>document.querySelector(selector);
let current={};
async function call(route,body) {
  const progress=['/connect','/connect/resume','/protect','/unlock','/protect/reset'].includes(route)?setInterval(()=>refresh().catch(()=>{}),1500):null;
  try{
  const response=await fetch(route,{method:body?'POST':'GET',headers:{'X-Setup-Key':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json(); if(!response.ok)throw Error(data.error || 'Request failed');return data;
  }finally{if(progress)clearInterval(progress);}
}
// The one Connect action: OMF opens in the browser for the sign-in; this page only shows progress and offers Lock to
// cancel, Resume connection after an interruption, and a fresh Connect when the previous attempt expired. No OMF password,
// connection token or proof ever reaches this page; login forms need an active protected connection.
function connectText(data) {
  const connect=data.connect || {phase:'idle'}, unlocked=!!data.unlocked;
  if(data.locking)return 'Closing the connection and its browser…';
  if(data.authorizing)return !data.protected && connect.phase && connect.phase!=='idle' ? 'Finish signing in on the OMF page that opened, then choose the cards. Use Lock to cancel.' : 'Approve this action in OMF. Use Lock to cancel.';
  if(data.legacy)return 'Your saved logins use the previous storage format. Use Enable protection to upgrade them, or start the downloader on a new private directory to connect.';
  if(!data.aclProtected)return 'Private directory permissions are not verified; connecting and unlocking are refused until the collector is restarted with a verified directory.';
  if(data.elevated)return 'The collector is running with administrator rights; restart it as a normal user.';
  if(data.keyLost)return 'The protection key is no longer on this device.';
  if(connect.finishing)return 'Finishing the connection… This completes automatically while this PC is unlocked.';
  if(!data.protected) {
    if(!data.baseUrl)return 'This downloader package has no OMF address. Install the package staged for your OMF site.';
    if(connect.resumable)return 'A connection is waiting for the OMF sign-in. Resume it, or press Connect to OMF to start over.';
    if(connect.expired)return 'The previous connection attempt ended. Press Connect to OMF to start again.';
    return `Press Connect to OMF. ${data.baseUrl} opens in your browser: sign in once, choose the cards, and this PC is connected.`;
  }
  if(unlocked)return data.mode==='manual'?`Manual session until ${new Date(data.unlockUntil).toLocaleTimeString()}.`:'Connected. Automatic syncing is ready.';
  if(data.paused)return 'Paused. Resume to collect again.';
  return data.reconnectNeeded?'Reconnect this PC through OMF to resume automatic syncing.':'Waiting to resume automatic syncing.';
}
function showProtection(data) {
  const unlocked=!!data.unlocked, transitioning=!!data.authorizing || !!data.locking, protectedBatch=unlocked && !transitioning && data.mode==='protected', connect=data.connect || {};
  const text=connectText(data);
  $('#connect-message').textContent=data.message && !(!data.protected && !transitioning && !data.legacy) ? `${text}\n${data.message}` : text;
  const approval=$('#omf-approval');approval.classList.toggle('hidden',!data.approvalUrl);
  if(data.approvalUrl)approval.href=data.approvalUrl;else approval.removeAttribute('href');
  const list=$('#protection-state');list.replaceChildren();
  for(const [label,value] of [['OMF',data.baseUrl||'—'],['PC name',data.pcName||'—'],['Connected',data.protected],['Unlocked',unlocked],['Mode',data.mode||'—'],['Due work in OMF',data.due],['Paused',data.paused],['Directory permissions',data.aclProtected===null?'checking':data.aclProtected?'verified':'NOT verified'],['Administrator rights',data.elevated],['Chrome found',data.chromeFound],['Test broker',data.testBroker]]) {
    const item=document.createElement('li'),name=document.createElement('b');name.textContent=label+': ';item.append(name,document.createTextNode(typeof value==='boolean'?(value?'yes':'no'):String(value)));list.append(item);
  }
  $('#connect').classList.toggle('hidden',!!data.protected || !!data.legacy);
  $('#connect').disabled=transitioning || !!data.busy || !data.aclProtected || !!data.elevated || !data.baseUrl || unlocked || !!connect.finishing || !!data.keyLost;
  $('#connect-resume').classList.toggle('hidden',!connect.resumable || !!data.protected);
  $('#connect-resume').disabled=transitioning || !!data.busy;
  $('#protect').classList.toggle('hidden',!data.legacy);
  $('#protect').disabled=transitioning || !!data.busy || data.protected || !data.aclProtected || !!data.elevated || unlocked;
  $('#unlock').classList.toggle('hidden',!data.protected);
  $('#unlock').disabled=transitioning || !!data.busy || !data.protected || unlocked || data.paused || data.mode==='manual';
  $('#lock').disabled=!!data.locking || (!unlocked && !data.authorizing);
  $('#pause').disabled=!!data.paused || data.legacy;
  $('#resume').disabled=!data.paused;
  $('#manual-mode').classList.toggle('hidden',!(data.mode!=='manual' && !data.protected && !data.legacy && (connect.phase||'idle')==='idle'));
  $('#manual-mode').disabled=unlocked || transitioning;
  $('#batch-start').classList.toggle('hidden',data.mode!=='manual');
  $('#batch-start').disabled=unlocked || transitioning || !!data.paused || !data.aclProtected || !!data.elevated;
  $('#reset-form').classList.toggle('hidden',!data.keyLost);
  for(const id of ['#mailbox-save','#aplus-save','#yayoi-save'])$(id).disabled=!protectedBatch || !!data.busy;
  $('#yayoi-open').disabled=!protectedBatch || !!data.busy || !data.yayoi?.hasCredentials;
  $('#mailbox-saved').textContent=data.mailbox?.hasCredentials?'Mailbox access saved: the Amex login code is read automatically during a download.':'Login codes: manual. Amex emails a code at each download; enter it in the Chrome window when asked. Mailbox access is not saved on this PC.';
}
async function refresh() {
  const data=await call('/status');current=data;
  showProtection(data);showYayoi(data.yayoi,data.busy,data);showAplus(data.aplus,data.busy,data);
  const main=$('#accounts');main.replaceChildren();
  if(data.protected && !data.accounts.length) {
    const section=document.createElement('section'),title=document.createElement('h2'),note=document.createElement('p');
    title.textContent='Card logins';note.textContent='No card was selected for this PC. Add the card account in OMF → カード連携, then connect this PC again.';
    section.append(title,note);main.append(section);
  }
  for(const account of data.accounts) {
    const section=document.createElement('section'),title=document.createElement('h2'),note=document.createElement('p'),form=document.createElement('form');
    title.textContent=account.name;note.textContent=account.hasCredentials?'Login saved on this PC. Enter both fields to replace it.':'Enter the login for this Amex account once. It is encrypted on this PC and never sent to OMF.';
    const values={};
    for(const [name,label,type] of [['username','Amex user ID','text'],['password','Amex password','password']]) {
      const el=document.createElement('input'),l=document.createElement('label');el.id=account.id+name;el.type=type;el.required=true;el.autocomplete='off';l.htmlFor=el.id;l.textContent=label;form.append(l,el);values[name]=el;
    }
    const button=document.createElement('button');button.textContent='Save encrypted login';button.disabled=!(data.unlocked && data.mode==='protected') || !!data.busy;form.append(button);
    form.onsubmit=async e=>{e.preventDefault();button.disabled=true;try{await call('/credentials',{accountId:account.accountId,username:values.username.value,password:values.password.value});values.password.value='';values.username.value='';await refresh();}catch(error){note.textContent=error.message;button.disabled=false;}};
    section.append(title,note,form);main.append(section);
  }
}
async function finishProtectionAction(button,failure) {
  try{await refresh();}catch(error){failure ||= error;button.disabled=false;}
  // Refresh the controls first; its status text must not erase the action's failure.
  if(failure)$('#connect-message').textContent=failure.message;
}
function action(id,route,body) {
  $(id).onclick=async()=>{
    const button=$(id);button.disabled=true;let failure=null;
    if(['/connect','/connect/resume','/protect','/unlock','/batch/start'].includes(route))showProtection({...current,authorizing:true,connect:{...(current.connect||{}),phase:route.startsWith('/connect')?'requested':(current.connect||{}).phase}});
    if(route==='/lock')showProtection({...current,locking:true});
    try{await call(route,body ? body() : {});}catch(error){failure=error;}
    finally{await finishProtectionAction(button,failure);}
  };
}
action('#connect','/connect');action('#connect-resume','/connect/resume');action('#protect','/protect');action('#unlock','/unlock');action('#lock','/lock');action('#pause','/pause');action('#resume','/resume');
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
refresh().catch(error=>{$('#connect-message').textContent=error.message;showYayoiError(error);$('#aplus-status').textContent=error.message;});
