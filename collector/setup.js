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
  showProtection(data);showYayoi(data.yayoi,data.busy,data);showAplus(data.aplus,data.busy,data);showSmsSource(data.smsSource,data.busy,data);
  const main=$('#accounts');main.replaceChildren();
  if(data.protected && !data.accounts.length) {
    const section=document.createElement('section'),title=document.createElement('h2'),note=document.createElement('p');
    title.textContent='Card logins';note.textContent='No card was selected for this PC. Add the card account in OMF → カード連携, then connect this PC again.';
    section.append(title,note);main.append(section);
  }
  for(const account of data.accounts) {
    const section=document.createElement('section'),title=document.createElement('h2'),note=document.createElement('p'),form=document.createElement('form');
    const issuer=account.provider==='aplus'?'My APLUS':'Amex';
    title.textContent=account.name;note.textContent=account.hasCredentials?'Login saved on this PC. Enter both fields to replace it.':`Enter the login for this ${issuer} account once. It is encrypted on this PC and never sent to OMF.`;
    const values={};
    for(const [name,label,type] of [['username',issuer==='Amex'?'Amex user ID':'My APLUS ID','text'],['password',issuer+' password','password']]) {
      const el=document.createElement('input'),l=document.createElement('label');el.id=account.id+name;el.type=type;el.required=true;el.autocomplete='off';l.htmlFor=el.id;l.textContent=label;form.append(l,el);values[name]=el;
    }
    const button=document.createElement('button');button.textContent='Save encrypted login';button.disabled=!(data.unlocked && data.mode==='protected') || !!data.busy;form.append(button);
    form.onsubmit=async e=>{e.preventDefault();button.disabled=true;try{await call('/credentials',{accountId:account.accountId,username:values.username.value,password:values.password.value});values.password.value='';values.username.value='';await refresh();}catch(error){note.textContent=error.message;button.disabled=false;}};
    section.append(title,note,form);main.append(section);
  }
  showBanks(data);
}
// Bank logins (plans omf-rakuten-auto-login-20261021 §3, omf-paypay-four-accounts-20261021): one section per bank account OMF grants
// to this PC (/status.banks, metadata only — a saved login is never read back). 楽天銀行 標準 gets the one-time ID/password form;
// PayPay銀行 標準 gets 店番号 (3 digits), 口座番号 (7 digits) and the login password, kept exactly as typed (text fields: leading zeros
// stay). Each is saved to /bank/credentials for exactly that account inside a protected connection; every field of the section is
// cleared after every attempt. Sections are keyed by account and re-created only when that account's own state changes, so a refresh
// after another account's save never erases what the person is typing; the save buttons follow the connection state on every refresh.
const BANK_FORMS={
  rakuten:{fields:[['user','楽天銀行 login ID','text',256],['password','楽天銀行 login password','password',256]],body:f=>({username:f.user.value,password:f.password.value}),
    first:'Enter the 楽天銀行 標準ログイン (法人ビジネス口座) login ID and password once. They are encrypted on this PC and never sent to OMF; downloads then sign in automatically.',
    saved:'Login saved on this PC. Downloads sign in automatically in the background; if the bank asks for an additional check, the same Chrome window is shown for you. Enter both fields to replace it.',
    refused:'The previous automatic sign-in was not confirmed. Check the bank window, then enter the current login ID and password to replace it; automatic sign-in stays off until then.'},
  paypay:{fields:[['branch','PayPay銀行 branch number (店番号, 3 digits)','text',3,'[0-9]{3}'],['account','PayPay銀行 account number (口座番号, 7 digits)','text',7,'[0-9]{7}'],['password','PayPay銀行 login password (ログインパスワード)','password',32]],body:f=>({branch:f.branch.value,account:f.account.value,password:f.password.value}),
    first:'Enter this PayPay銀行 標準ログイン account\'s branch number, account number and login password once. They are encrypted on this PC and never sent to OMF. Each download signs in once with them in the background, selects the requested period, saves the statement CSV once and signs out; if the account is signed in elsewhere or the bank asks for an additional check, the downloader stops and shows the Chrome window instead of overriding anything.',
    saved:'Login saved on this PC. Downloads sign in once with it in the background, save the statement CSV for the requested period and sign out. If the account is signed in elsewhere or the bank asks for an additional check, the same Chrome window is shown for you. Enter all three fields to replace it.',
    refused:'The previous automatic sign-in was not confirmed. Check the bank window, then enter the current branch number, account number and password to replace it; automatic sign-in stays off until then.',
    uncertain:'The previous automatic sign-in was not confirmed: the downloader cannot tell whether the bank accepted it (a downloaded file is not taken as proof; the bank may also have said that the account was signed in elsewhere). Automatic sign-in stays off for this account. If the saved login is correct, allow one more automatic sign-in with it below (nothing is typed again and no download starts until you request one in OMF); if it changed, enter all three fields to replace it.',
    refusedByBank:'The bank refused the saved login on the last attempt. If you changed the branch number, account number or password, enter all three to replace it. If the saved login is still current, allow one more automatic sign-in with it below instead of typing it again (nothing is typed again and no download starts until you request one in OMF). Automatic sign-in stays off until you do one of these.'}
};
let bankSections=new Map(),bankTimer;
function bankSection(bank,data) {
  const section=document.createElement('section'),title=document.createElement('h2'),note=document.createElement('p');
  section.dataset.bankLogin=bank.bankAccountId;note.dataset.bankLoginNote='';note.setAttribute('role','status');
  title.textContent=bank.name;
  const kind=bank.supported?BANK_FORMS[bank.provider]:null;
  if(!kind){note.textContent='Saved sign-in is not available for this bank or login type. When a download needs it, sign in in the Chrome window the downloader opens.';section.append(title,note);return {section};}
  // Plan P1: PayPay's block names its kind. An uncertain attempt or a bank refusal of the current saved login may be retried once with
  // that saved login on the owner's explicit request (plan omf-paypay-split-dates-retry-20261022); changed values are saved instead.
  note.textContent=bank.pending==='uncertain'&&kind.uncertain?kind.uncertain:bank.pending==='refused'&&kind.refusedByBank?kind.refusedByBank:bank.refused?kind.refused:bank.hasCredentials?kind.saved:kind.first;
  const form=document.createElement('form'),fields={};
  for(const [name,label,type,max,pattern] of kind.fields) {
    const el=document.createElement('input'),l=document.createElement('label');el.id='bank-'+bank.bankAccountId+'-'+name;el.type=type;el.required=true;el.autocomplete='off';el.maxLength=max;el.dataset.bankLoginField=name;
    if(name==='user')el.dataset.bankLoginUser='';if(name==='password')el.dataset.bankLoginPassword='';if(pattern){el.pattern=pattern;el.inputMode='numeric';}
    l.htmlFor=el.id;l.textContent=label;form.append(l,el);fields[name]=el;
  }
  const button=document.createElement('button');button.textContent='Save encrypted login';button.dataset.bankLoginSave='';form.append(button);
  const clear=()=>{for(const el of Object.values(fields))el.value='';};
  form.onsubmit=async e=>{
    e.preventDefault();button.disabled=true;button.dataset.saving='1';let failure=null;
    try{await call('/bank/credentials',{bankAccountId:bank.bankAccountId,...kind.body(fields)});}catch(error){failure=error;}
    finally{clear();delete button.dataset.saving;}
    if(failure){note.textContent=failure.message;button.disabled=false;return;}
    await refresh().catch(error=>{note.textContent=error.message;});
  };
  let retry=null;
  if((bank.pending==='uncertain'||bank.pending==='refused')&&kind.uncertain){
    retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='Allow one more sign-in with the saved login';retry.dataset.bankLoginRetry='';
    retry.onclick=async()=>{
      retry.disabled=true;retry.dataset.saving='1';let failure=null;
      try{await call('/bank/retry',{bankAccountId:bank.bankAccountId});}catch(error){failure=error;}
      finally{delete retry.dataset.saving;}
      if(failure){note.textContent=failure.message;retry.disabled=false;return;}
      await refresh().catch(error=>{note.textContent=error.message;});
    };
  }
  section.append(title,note,...(retry?[retry]:[]),form);return {section,button,retry};
}
function showBanks(data) {
  const main=$('#banks');
  const banks=Array.isArray(data.banks)?data.banks:[],protectedBatch=!!data.unlocked && data.mode==='protected';
  if(data.protected && !banks.length) {
    const section=document.createElement('section'),title=document.createElement('h2'),note=document.createElement('p');
    title.textContent='Bank logins';note.textContent='No bank account is allowed for this PC yet. In OMF → 支払い照合 → 銀行口座の接続・自動取得, allow this PC for the bank account, then reopen this screen.';
    section.append(title,note);main.replaceChildren(section);bankSections=new Map();return;
  }
  const next=new Map();
  for(const bank of banks) {
    const key=JSON.stringify([bank.bankAccountId,bank.name,bank.provider,bank.variant,bank.supported,bank.hasCredentials,bank.refused,bank.pending??null]),kept=bankSections.get(bank.bankAccountId);
    next.set(bank.bankAccountId,kept&&kept.key===key?kept:{key,...bankSection(bank,data)});
  }
  for(const entry of next.values())for(const control of [entry.button,entry.retry])if(control)control.disabled=!protectedBatch || !!data.busy || control.dataset.saving==='1';
  // While the collector is busy the save buttons wait; the bank sections alone are re-read until it is idle (typing is kept).
  clearTimeout(bankTimer);if(data.busy&&next.size)bankTimer=setTimeout(()=>call('/status').then(showBanks).catch(()=>{}),2000);
  // Only changed sections are swapped in place; a kept section is never detached (the person's typing and focus stay where they are).
  const wanted=[...next.values()].map(entry=>entry.section);
  for(const [i,section] of wanted.entries()){const at=main.children[i];if(at===section)continue;if(at&&!wanted.includes(at))at.replaceWith(section);else main.insertBefore(section,at||null);}
  while(main.children.length>wanted.length)main.lastElementChild.remove();
  bankSections=next;
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
// The statement-code SMS source (plan omf-auto-sync-build-20261014 §2 A11): the tablet serial, saved or removed through
// /sms-source inside a protected connection; /status.smsSource shows what is saved and whether adb was found.
function showSmsSource(data,busy,all=current) {
  const source=data||{};
  $('#sms-saved').textContent=(source.serial?`SMS source saved: tablet ${source.serial}. The statement code is read from its inbox during a download.`:'No SMS source saved. The My APLUS statement code is entered in Chrome.')+(source.adbFound===false?' adb was not found on this PC (install Android platform-tools before relying on it).':'');
  const protectedBatch=!!all.unlocked && all.mode==='protected';
  $('#sms-save').disabled=!!busy || !protectedBatch;
  $('#sms-remove').disabled=!!busy || !protectedBatch || !source.serial;
}
$('#sms-form').onsubmit=async e=>{
  e.preventDefault();const button=$('#sms-save'),serial=$('#sms-serial');
  button.disabled=true;
  try {await call('/sms-source',{serial:serial.value.trim()});serial.value='';$('#sms-status').textContent='SMS source saved on this computer.';await refresh();}
  catch(error){$('#sms-status').textContent=error.message;button.disabled=false;}
};
$('#sms-remove').onclick=async()=>{
  const button=$('#sms-remove');button.disabled=true;
  try {await call('/sms-source',{serial:null});$('#sms-status').textContent='SMS source removed.';await refresh();}
  catch(error){$('#sms-status').textContent=error.message;button.disabled=false;}
};
refresh().catch(error=>{$('#connect-message').textContent=error.message;showYayoiError(error);$('#aplus-status').textContent=error.message;$('#sms-status').textContent=error.message;});
