(()=>{
 'use strict';
 const $=id=>document.getElementById(id),slug=location.pathname.split('/')[2],base='/follow-up/'+encodeURIComponent(slug)+'/api/';
 const labels={unanswered:'未回答',confirm:'この内容で確認',change:'修正・追加の希望',discuss:'相談して決めたい'};
 let state=null,index=0,review=false,dirty=false,version=0,timer=null,saving=null,conflict=false,toastTimer;
 const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
 const editing=()=>state?.role==='customer';
 function notify(text){$('notice').textContent=text;$('notice').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('notice').hidden=true,7000)}
 async function api(path,body){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let data;try{data=await response.json()}catch{throw Error('通信を確認してください。入力はこの画面に残っています。')}if(!response.ok)throw Object.assign(new Error(data.error||'保存できませんでした。'),{status:response.status});return data}
 function setSave(text,error=false){$('save-status').textContent=text;$('save-status').classList.toggle('error',error)}
 function answer(topic=state.document.topics[index]){return state.response.answers[topic.id]||{status:'unanswered',comment:'',fields:{}}}
 function editAnswer(key,value){const topic=state.document.topics[index],a=answer();a[key]=value;state.response.answers[topic.id]=a;changed()}
 function changed(){if(!editing())return;dirty=true;version++;$('attest').checked=false;setSave('変更を保存しています…');clearTimeout(timer);timer=setTimeout(()=>save().catch(()=>{}),650)}
 async function save(){
  clearTimeout(timer);if(!editing()||!dirty)return;if(conflict)throw Error('別の画面の更新があります。入力内容を手元に保存してから読み直してください。');
  if(saving){await saving;return save()}
  const serial=version,payload={documentVersion:state.documentVersion,revision:state.revision,response:structuredClone(state.response)};
  saving=api('save',payload).then(result=>{state.revision=result.revision;if(version===serial)dirty=false;setSave(dirty?'変更を保存しています…':'✓ サーバーに保存済み');$('retry-save').hidden=true}).catch(error=>{if(error.status===409)conflict=true;setSave(error.message,true);$('retry-save').hidden=false;throw error}).finally(()=>{saving=null});
  await saving;if(dirty)return save();
 }
 function renderNav(){
  const topics=state.document.topics,count=topics.filter(t=>answer(t).status!=='unanswered').length;
  $('progress-label').textContent=count+' / '+topics.length+' 項目を選択';$('progress-fill').style.width=(count/topics.length*100)+'%';$('topic-nav').replaceChildren();
  topics.forEach((t,i)=>{const b=node('button'),n=node('span',String(i+1).padStart(2,'0'),'nav-number'),title=node('span',t.shortTitle||t.title),mark=node('span',answer(t).status==='confirm'?'✓':answer(t).status==='unanswered'?'':'•','nav-state');b.append(n,title,mark);b.classList.toggle('active',!review&&index===i);b.setAttribute('aria-current',!review&&index===i?'step':'false');b.onclick=()=>openTopic(i);$('topic-nav').append(b)})
 }
 function renderTopic(){
  const topic=state.document.topics[index],a=answer();$('topic-number').textContent=String(index+1).padStart(2,'0')+' / '+state.document.topics.length;$('topic-status').textContent=labels[a.status];$('topic-title').textContent=topic.title;$('topic-intro').textContent=topic.intro||'';$('topic-intro').hidden=!topic.intro;$('topic-question').textContent=topic.question;
  $('points').replaceChildren();topic.lines.forEach((text,i)=>{const p=node('div',undefined,'point');p.append(node('span',String(i+1).padStart(2,'0'),'point-index'),node('p',text));$('points').append(p)});
  for(const radio of document.querySelectorAll('[name=decision]')){radio.checked=radio.value===a.status;radio.disabled=!editing()}
  $('comment').value=a.comment;$('comment').disabled=!editing();$('topic-fields').replaceChildren();
  for(const f of topic.fields||[]){const label=node('label',f.label,'field-label');if(f.hint)label.append(node('small',f.hint));let input;
   if(f.options){input=node('select');input.append(new Option('選択してください',''));for(const option of f.options)input.append(new Option(option,option))}
   else if(f.multiline){input=node('textarea');input.rows=3;input.maxLength=2000}
   else{input=node('input');input.type=f.type==='date'?'date':'text';input.maxLength=2000}
   input.id='field-'+f.id;input.value=a.fields[f.id]||'';input.disabled=!editing();input.addEventListener('input',()=>{const next=answer();next.fields={...next.fields,[f.id]:input.value};state.response.answers[topic.id]=next;changed()});label.append(input);$('topic-fields').append(label)
  }
  $('previous').disabled=index===0;$('next').textContent=index===state.document.topics.length-1?'回答をまとめて確認 →':'保存して次へ →';renderNav();
 }
 function openTopic(i){index=i;review=false;$('topic-screen').hidden=false;$('review-screen').hidden=true;renderTopic();window.scrollTo({top:0,behavior:'auto'})}
 function reviewSummary(){
  $('review-summary').replaceChildren();state.document.topics.forEach((t,i)=>{const a=answer(t),entry=node('details',undefined,'review-entry'),summary=node('summary'),status=node('span',labels[a.status],'summary-status'+(a.status==='unanswered'?' unanswered':''));summary.append(node('span',String(i+1).padStart(2,'0')),node('strong',t.title),status);entry.append(summary);
   const body=node('div',undefined,'review-body');body.append(node('p',t.lines.join('\n')));const dl=node('dl');for(const f of t.fields||[])if(a.fields[f.id])dl.append(node('dt',f.label),node('dd',a.fields[f.id]));if(a.comment)dl.append(node('dt','補足・ご希望'),node('dd',a.comment));body.append(dl);const edit=node('button','この項目を開く →','edit-link');edit.onclick=()=>openTopic(i);body.append(edit);entry.append(body);$('review-summary').append(entry)
  });
  $('submission-history').textContent=state.submissions.length?'送信済み：'+state.submissions.map(s=>new Date(s.submitted_at).toLocaleString('ja-JP')+'（回答版 '+s.response_revision+'）').join('\n'):'まだ送信していません。入力内容は途中保存されています。';
 }
 function openReview(){review=true;$('topic-screen').hidden=true;$('review-screen').hidden=false;for(const [id,key]of [['company','company'],['respondent-name','name'],['email','email'],['position','position']]){$(id).value=state.response.respondent[key]||'';$(id).disabled=!editing()}$('extra').value=state.response.extra;$('extra').disabled=!editing();$('submit-area').hidden=!editing();$('admin-notice').hidden=editing();reviewSummary();renderNav();window.scrollTo({top:0,behavior:'auto'})}
 function loaded(data){state=data;dirty=false;version=0;conflict=false;$('login-screen').hidden=true;$('workspace').hidden=false;$('save-bar').hidden=false;$('logout').hidden=false;$('retry-save').hidden=true;setSave(editing()?'✓ サーバーに保存済み':'管理者として閲覧しています');if(editing())openTopic(index);else openReview()}
 $('login-form').onsubmit=async event=>{event.preventDefault();$('login-button').disabled=true;$('login-status').classList.remove('error');$('login-status').textContent='確認しています…';try{await api('login',{password:$('password').value,role:$('admin-login').checked?'admin':'customer'});$('password').value='';loaded(await api('state'))}catch(error){$('login-status').textContent=error.message;$('login-status').classList.add('error')}finally{$('login-button').disabled=false}};
 $('logout').onclick=async()=>{try{await save();await api('logout',{});state=null;$('workspace').hidden=true;$('save-bar').hidden=true;$('logout').hidden=true;$('login-screen').hidden=false;$('login-status').textContent='退出しました。パスワードで再開できます。'}catch(error){notify(error.message)}};
 for(const radio of document.querySelectorAll('[name=decision]'))radio.onchange=()=>{editAnswer('status',radio.value);$('topic-status').textContent=labels[radio.value];renderNav()};
 $('comment').oninput=()=>editAnswer('comment',$('comment').value);
 for(const [id,key]of [['company','company'],['respondent-name','name'],['email','email'],['position','position']])$(id).oninput=()=>{state.response.respondent[key]=$(id).value;changed()};
 $('extra').oninput=()=>{state.response.extra=$('extra').value;changed()};
 $('previous').onclick=()=>openTopic(Math.max(0,index-1));
 $('next').onclick=async()=>{try{await save();if(index===state.document.topics.length-1)openReview();else openTopic(index+1)}catch(error){notify(error.message)}};
 for(const id of ['review-open','go-review'])$(id).onclick=()=>{openReview();save().catch(()=>{})};
 $('retry-save').onclick=()=>save().then(()=>notify('保存しました。')).catch(error=>notify(error.message));
 function download(text,name,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([text],{type})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 const draft=()=>({format:'omf-followup-draft-v1',document:state.document,documentVersion:state.documentVersion,response:state.response,revision:state.revision,savedToServer:!dirty,exportedAt:new Date().toISOString()});
 $('download-unsaved').onclick=()=>download(JSON.stringify(draft(),null,2),'OMF-入力内容.json','application/json');
 $('export-json').onclick=async()=>{try{await save();download(JSON.stringify(await api('export'),null,2),'OMF-回答と送信履歴.json','application/json')}catch(error){notify(error.message)}};
 $('export-text').onclick=()=>{const r=state.response,lines=[state.document.title,'ご回答者：'+r.respondent.company+' / '+r.respondent.name,'回答版：'+state.revision,''];state.document.topics.forEach((t,i)=>{const a=answer(t);lines.push(String(i+1).padStart(2,'0')+' '+t.title,'状態：'+labels[a.status],...t.lines.map(x=>'・'+x));for(const f of t.fields||[])if(a.fields[f.id])lines.push(f.label+'：'+a.fields[f.id]);if(a.comment)lines.push('補足：'+a.comment);lines.push('')});lines.push('全体のご希望：',r.extra||'（記入なし）');download(lines.join('\n'),'OMF-確認内容.txt')};
 $('print').onclick=()=>{openReview();for(const d of document.querySelectorAll('.review-entry'))d.open=true;window.print()};
 $('submit').onclick=async()=>{if(!$('attest').checked){notify('最後の確認欄にチェックしてください。');return}if(!$('email').checkValidity()){$('email').reportValidity();return}$('submit').disabled=true;try{await save();const result=await api('submit',{documentVersion:state.documentVersion,revision:state.revision,attested:true});state.submissions=[{id:result.id,response_revision:state.revision,submitted_at:result.submittedAt},...state.submissions.filter(x=>x.id!==result.id)];reviewSummary();notify('ご回答ありがとうございます。内容を受け付けました。')}catch(error){notify(error.message)}finally{$('submit').disabled=false}};
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue=''}});
 api('state').then(loaded).catch(error=>{if(error.status!==401)$('login-status').textContent=error.message});
})();
