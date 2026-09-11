const key=location.hash.slice(1); history.replaceState(null,'','/');
const status=document.querySelector('#status');
async function call(route,body) {
  const response=await fetch(route,{method:body?'POST':'GET',headers:{'X-Setup-Key':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json(); if(!response.ok)throw Error(data.error || 'Request failed');return data;
}
async function refresh() {
  const data=await call('/status');status.textContent=data.message;showYayoi(data.yayoi,data.busy);
  document.querySelector('#url').value=data.baseUrl || '';
  const main=document.querySelector('#accounts');main.replaceChildren();
  for(const account of data.accounts) {
    const section=document.createElement('section'),title=document.createElement('h2'),note=document.createElement('p'),form=document.createElement('form');
    title.textContent=account.name;note.textContent=account.hasCredentials?'Login details saved. Enter both fields to replace them.':'Enter the login for this Amex account.';
    const values={};
    for(const [name,label,type] of [['username','Amex user ID','text'],['password','Amex password','password']]) {
      const el=document.createElement('input'),l=document.createElement('label');el.id=account.id+name;el.type=type;el.required=true;el.autocomplete='off';l.htmlFor=el.id;l.textContent=label;form.append(l,el);values[name]=el;
    }
    const button=document.createElement('button');button.textContent='Save encrypted login';form.append(button);
    form.onsubmit=async e=>{e.preventDefault();button.disabled=true;try{await call('/credentials',{accountId:account.id,username:values.username.value,password:values.password.value});values.password.value='';values.username.value='';await refresh();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
    section.append(title,note,form);main.append(section);
  }
}
document.querySelector('#pair').onsubmit=async e=>{e.preventDefault();try{await call('/pair',{baseUrl:document.querySelector('#url').value,token:document.querySelector('#token').value});document.querySelector('#token').value='';await refresh();}catch(error){status.textContent=error.message;}};


let yayoiTimer;
function showYayoi(data,busy) {
  document.querySelector('#yayoi-saved').textContent=data.hasCredentials?'Login saved. Enter both fields to replace it.':'Enter the login you use for Yayoi.';
  document.querySelector('#yayoi-status').textContent=data.message;
  document.querySelector('#yayoi-save').disabled=!!busy;
  document.querySelector('#yayoi-open').disabled=!!busy || !data.hasCredentials;
  clearTimeout(yayoiTimer);
  if(busy)yayoiTimer=setTimeout(()=>refreshYayoi().catch(showYayoiError),2000);
}
function showYayoiError(error) { document.querySelector('#yayoi-status').textContent=error.message; }
async function refreshYayoi() {const data=await call('/yayoi/status');showYayoi(data.yayoi,data.busy);}
document.querySelector('#yayoi-form').onsubmit=async e=>{
  e.preventDefault();const button=document.querySelector('#yayoi-save'),username=document.querySelector('#yayoi-username'),password=document.querySelector('#yayoi-password');
  button.disabled=true;
  try {await call('/yayoi/credentials',{username:username.value,password:password.value});username.value='';password.value='';await refreshYayoi();}
  catch(error){showYayoiError(error);button.disabled=false;}
  finally{password.value='';}
};
document.querySelector('#yayoi-open').onclick=async()=>{
  const button=document.querySelector('#yayoi-open');button.disabled=true;
  try{await call('/yayoi/open',{});await refreshYayoi();}catch(error){showYayoiError(error);button.disabled=false;}
};
refresh().catch(error=>{status.textContent=error.message;showYayoiError(error);});
