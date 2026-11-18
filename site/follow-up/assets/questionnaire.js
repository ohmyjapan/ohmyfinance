(()=>{
 'use strict';
 const $=id=>document.getElementById(id),slug=location.pathname.split('/')[2],base='/follow-up/'+encodeURIComponent(slug)+'/api/';
 const labels={unanswered:'未回答',confirm:'この内容で確認',change:'修正・追加の希望',discuss:'相談して決めたい'};
 let state=null,index=0,review=false,intro=false,dirty=false,version=0,timer=null,saving=null,conflict=false,toastTimer,pendingSave=null,recoveryDraft=null,sheetAnimation=null,sheetTurn=0,introFrame=null;
 let sessionEpoch=0,baseResponse=null,recoveryConflicts=[],recoveryApplied=false;
 const introMotion=matchMedia('(prefers-reduced-motion: reduce)');
 const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
 const editing=()=>state?.role==='customer';
 function renderChoices(){const selected=answer().status;for(const button of document.querySelectorAll('[data-decision]')){button.setAttribute('aria-pressed',String(button.dataset.decision===selected));button.disabled=!editing()}}
 function resetSheet(){sheetTurn++;sheetAnimation?.cancel();sheetAnimation=null;$('topic-screen').querySelector('.topic-content').inert=false;$('next').disabled=false}
 function notify(text){$('notice').textContent=text;$('notice').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('notice').hidden=true,7000)}
 async function api(path,body){
  const epoch=sessionEpoch;
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if(epoch!==sessionEpoch)throw Error('ログイン状態が変わりました。');
  if(response.status===401&&state)expireSession();
  let data;try{data=await response.json()}catch{throw Error('通信を確認してください。入力はこの画面に残っています。')}
  if(!response.ok)throw Object.assign(new Error(data.error||'保存できませんでした。'),{status:response.status});
  if(epoch!==sessionEpoch)throw Error('ログイン状態が変わりました。');return data;
 }
 const meaningful=value=>typeof value==='string'?Boolean(value.trim()):false;
 function firstUnanswered(){return state.document.topics.findIndex(t=>answer(t).status==='unanswered')}
 function hasProgress(){const r=state.response;return state.submissions.length>0||Object.values(r.respondent).some(meaningful)||meaningful(r.extra)||state.document.topics.some(t=>{const a=answer(t);return a.status!=='unanswered'||meaningful(a.comment)||Object.values(a.fields).some(meaningful)})}
 function updateUnanswered(){const count=state.document.topics.filter(t=>answer(t).status==='unanswered').length;$('unanswered-count').textContent=count?'未回答が'+count+'件あります。未回答のまま送信できます。':'すべてのカードに回答しています。';$('review-unanswered').hidden=!count}
 function captureRecovery(force=false){
  if(!editing()||!dirty&&!force)return;
  const response=structuredClone(state.response),acknowledged=structuredClone(baseResponse);
  // Preserve unresolved local alternatives across another authentication expiry.
  for(const item of recoveryConflicts){if(readPath(response,item.path)===item.server)writePath(response,item.path,item.local);writePath(acknowledged,item.path,item.previous)}
  const previousRecovery=recoveryDraft&&recoveryDraft.documentVersion!==state.documentVersion?recoveryDraft:null;
  recoveryDraft={...structuredClone(draft()),...(previousRecovery?{previousRecovery}:{}),response,baseResponse:acknowledged,view:{intro,review,topicId:state.document.topics[index]?.id}};
 }
 function showLogin(message){
  sessionEpoch++;clearTimeout(timer);timer=null;saving=null;pendingSave=null;state=null;baseResponse=null;dirty=false;conflict=false;recoveryConflicts=[];recoveryApplied=false;
  clearPrivateView();$('recovery-conflicts').replaceChildren();$('recovery-message').textContent='';$('workspace').hidden=true;$('workspace').inert=false;$('save-bar').hidden=true;$('logout').hidden=true;$('recovery-notice').hidden=true;$('login-screen').hidden=false;$('attest').checked=false;$('submit').disabled=false;$('login-status').textContent=message;
 }
 function expireSession(){captureRecovery(true);showLogin('ログインの有効期限が切れました。未保存の入力はこのタブに保持しています。再ログインして再開してください。')}
 function readPath(response,path){let value=response;for(const key of path)value=value?.[key];return value??(path.at(-1)==='status'?'unanswered':'')}
 function writePath(response,path,value){let target=response;for(const key of path.slice(0,-1))target=target[key]??=(key===path[1]&&path[0]==='answers'?{status:'unanswered',comment:'',fields:{}}:{});target[path.at(-1)]=value}
 function recoveryPaths(){
  const paths=Object.keys(state.response.respondent).map(key=>({path:['respondent',key],label:({company:'会社名',name:'ご回答者名',email:'メール',position:'部署・役職'})[key]||key}));
  paths.push({path:['extra'],label:'全体へのご希望'});
  for(const topic of state.document.topics){for(const key of ['status','comment'])paths.push({path:['answers',topic.id,key],label:topic.title+' / '+(key==='status'?'回答':'補足')});for(const field of topic.fields||[])paths.push({path:['answers',topic.id,'fields',field.id],label:topic.title+' / '+field.label})}return paths;
 }
 function renderRecovery(){
  $('recovery-notice').hidden=!recoveryDraft||!editing();$('recovery-conflicts').replaceChildren();$('recovery-current-document').hidden=true;
  if(!recoveryDraft||!editing())return;
  if(recoveryDraft.documentVersion!==state.documentVersion){$('recovery-message').textContent='確認内容が更新されたため、前回の入力は自動反映していません。未保存の入力をダウンロードし、現在のカードと読み合わせて必要な内容を入力してください。前回の入力はこのタブに保持します。';$('recovery-current-document').hidden=false;return}
  $('recovery-message').textContent=recoveryConflicts.length?'別の画面でも変更された項目があります。現在の回答と前回の入力を比べ、項目ごとに選んでください。選び終えるまで自動保存を待ちます。':'前回の未保存の入力を復元しました。サーバーへの保存が完了するまで、このタブに保持します。';
  for(const item of recoveryConflicts){const row=node('section',undefined,'recovery-conflict');row.dataset.recoveryPath=item.path.join('.');row.append(node('h3',item.label));for(const [choice,title,value]of [['server','現在の回答',readPath(state.response,item.path)],['local','前回の未保存の入力',item.local]]){row.append(node('p',title+'：'+(item.path.at(-1)==='status'?labels[value]:value||'（空欄）')));const button=node('button',title+'を使う','quiet');button.type='button';button.dataset.recoveryChoice=choice;button.onclick=()=>resolveRecovery(item,choice);row.append(button)}$('recovery-conflicts').append(row)}
 }
 function resolveRecovery(item,choice){
  if(!editing())return;
  if(choice==='local')writePath(state.response,item.path,item.local);
  recoveryConflicts=recoveryConflicts.filter(other=>other!==item);changed();renderCurrentView();renderRecovery();
 }
 function renderCurrentView(){if(intro)openIntroduction();else if(review)openReview();else renderTopic()}
 function restoreRecovery(){
  if(!recoveryDraft||!editing())return;
  const view=recoveryDraft.view;
  if(recoveryDraft.documentVersion===state.documentVersion){
   recoveryConflicts=[];
   for(const item of recoveryPaths()){const local=readPath(recoveryDraft.response,item.path),previous=readPath(recoveryDraft.baseResponse,item.path),server=readPath(state.response,item.path);if(local===previous||local===server)continue;if(server===previous)writePath(state.response,item.path,local);else recoveryConflicts.push({...item,local,server,previous})}
   recoveryApplied=true;changed();
  }
  if(view?.review)openReview();else if(view?.intro&&state.document.introduction)openIntroduction();else{const i=state.document.topics.findIndex(t=>t.id===view?.topicId);openTopic(i<0?0:i)}
  $('attest').checked=false;renderRecovery();
 }
 function setSave(text,error=false){$('save-status').textContent=text;$('save-status').classList.toggle('error',error)}
 function answer(topic=state.document.topics[index]){return state.response.answers[topic.id]||{status:'unanswered',comment:'',fields:{}}}
 function editAnswer(key,value){const topic=state.document.topics[index],a=answer();a[key]=value;state.response.answers[topic.id]=a;changed()}
 function changed(){if(!editing())return;dirty=true;version++;updateUnanswered();if(recoveryConflicts.length)renderRecovery();$('attest').checked=false;setSave(recoveryConflicts.length?'前回の入力との違いを確認してください。':'変更を保存しています…');clearTimeout(timer);if(recoveryConflicts.length)return;timer=setTimeout(()=>save().catch(()=>{}),650)}
 async function save(){
  clearTimeout(timer);if(!editing()||!dirty)return;
  if(recoveryConflicts.length)throw Error('前回の入力との違いを、項目ごとに選んでください。');
  if(conflict)throw Error('別の画面の更新があります。入力内容を手元に保存してから読み直してください。');
  const epoch=sessionEpoch;
  if(saving){await saving;if(epoch===sessionEpoch)return save();return}
  pendingSave??={serial:version,payload:{requestId:crypto.randomUUID(),documentVersion:state.documentVersion,revision:state.revision,response:structuredClone(state.response)}};
  const {serial,payload}=pendingSave;
  const operation=api('save',payload).then(result=>{
   if(epoch!==sessionEpoch)return;
   state.revision=result.revision;baseResponse=structuredClone(payload.response);pendingSave=null;if(version===serial)dirty=false;
   if(!dirty&&recoveryApplied){recoveryDraft=recoveryDraft?.previousRecovery||null;recoveryApplied=false;renderRecovery()}
   setSave(dirty?'変更を保存しています…':'✓ サーバーに保存済み');$('retry-save').hidden=true;
  }).catch(error=>{if(epoch===sessionEpoch){if(error.status>=400&&error.status<500)pendingSave=null;if(error.status===409)conflict=true;setSave(error.message,true);$('retry-save').hidden=false}throw error}).finally(()=>{if(saving===operation)saving=null});
  saving=operation;await operation;if(epoch===sessionEpoch&&dirty)return save();
 }
 function renderNav(){
  document.documentElement.classList.toggle('introduction-active',intro);document.body.classList.toggle('introduction-active',intro);refreshClayMotion();
  const topics=state.document.topics,count=topics.filter(t=>answer(t).status!=='unanswered').length;
  $('progress-label').textContent=count===topics.length?'ひと通り確認できました':'カードをひとつずつ確認';$('progress-fill').style.width=(count/topics.length*100)+'%';$('topic-nav').replaceChildren();
  if(state.document.introduction){const b=node('button','はじめに・目標と役割','intro-nav');b.dataset.view='introduction';b.classList.toggle('active',intro);b.setAttribute('aria-current',intro?'step':'false');b.onclick=openIntroduction;$('topic-nav').append(b)}
  const groups=new Map();topics.forEach((t,i)=>{const id=t.groupId||t.id;if(!groups.has(id))groups.set(id,{label:t.groupLabel||t.shortTitle||t.title,indices:[]});groups.get(id).indices.push(i)});
  for(const [id,g]of groups){const b=node('button'),title=node('span',g.label),all=g.indices.every(i=>answer(topics[i]).status==='confirm'),some=g.indices.some(i=>answer(topics[i]).status!=='unanswered'),mark=node('span',all?'✓':some?'•':'','nav-state'),active=!intro&&!review&&g.indices.includes(index);b.dataset.group=id;b.append(title,mark);b.classList.toggle('active',active);b.setAttribute('aria-current',active?'step':'false');b.onclick=()=>openTopic(g.indices[0]);$('topic-nav').append(b)}
 }
 function renderIntroduction(){
  const content=state.document.introduction;$('introduction-screen').hidden=true;
  if(!content)return;
  for(const [id,key]of [['introduction-eyebrow','eyebrow'],['introduction-title','title'],['introduction-lead','lead'],['introduction-goal','goal'],['introduction-review-title','reviewTitle'],['introduction-review-text','reviewText'],['introduction-start','startLabel']])$(id).textContent=content[key];
  $('introduction-flow').replaceChildren();for(const step of content.steps){const item=node('li');item.append(node('h3',step.title),node('p',step.text));$('introduction-flow').append(item)}
  $('introduction-roles').replaceChildren();for(const role of content.roles){const item=node('section',undefined,'introduction-role');item.append(node('h3',role.name),node('p',role.text));$('introduction-roles').append(item)}
 }
 function layoutIntroduction(){
  if(!intro)return;
  const header=document.querySelector('header').getBoundingClientRect().height,available=Math.max(1,innerHeight-header),panels=[...document.querySelectorAll('[data-intro-panel]')];
  $('introduction-screen').style.setProperty('--intro-header-height',header+'px');
  const sizes=panels.map(panel=>({panel,height:panel.querySelector('.scene-frame').getBoundingClientRect().height}));
  const motionDistance=Math.round(available*1.9),completedDistance=Math.round(available);
  for(const {panel,height}of sizes){panel.classList.toggle('scene-flowing',introMotion.matches||height>available+4);panel.style.setProperty('--scene-frame-height',height+'px');panel.style.setProperty('--scene-motion-distance',motionDistance+'px');panel.style.setProperty('--scene-scroll-distance',(motionDistance+completedDistance)+'px')}
 }
 function updateIntroductionScroll(){
  introFrame=null;if(!intro)return;
  const header=document.querySelector('header').getBoundingClientRect().height,available=Math.max(1,innerHeight-header),limit=n=>Math.min(1,Math.max(0,n));let current=0,mostVisible=-1;
  const rows=[...document.querySelectorAll('[data-intro-panel]')].map(panel=>{const rect=panel.getBoundingClientRect(),frame=panel.querySelector('.scene-frame').getBoundingClientRect(),flowing=panel.classList.contains('scene-flowing'),range=flowing?rect.height-available:rect.height-frame.height,progress=limit((header-rect.top)/Math.max(1,range)),motionRange=flowing?range:parseFloat(panel.style.getPropertyValue('--scene-motion-distance'))||range,motionProgress=limit((header-rect.top)/Math.max(1,motionRange));return{panel,frame,progress,motionProgress,animations:[...panel.querySelectorAll('.clay-motion')].flatMap(e=>e.getAnimations())}});
  rows.forEach(({panel,frame,progress,motionProgress,animations},i)=>{const visible=Math.max(0,Math.min(frame.bottom,innerHeight)-Math.max(frame.top,header)),enter=limit((innerHeight-frame.top)/(available*.65)),leave=limit((frame.bottom-header)/(available*.4)),visibility=introMotion.matches?1:Math.min(enter,leave);panel.style.setProperty('--scene-progress',progress);panel.style.setProperty('--scene-visibility',visibility);panel.style.setProperty('--scene-offset',((1-visibility)*30)+'px');for(const animation of animations){if(introMotion.matches)animation.cancel();else{animation.pause();animation.currentTime=motionProgress*1000}}if(visible>mostVisible){mostVisible=visible;current=i}});
  for(const button of document.querySelectorAll('.introduction-pagination [data-intro-scene]'))button.setAttribute('aria-current',Number(button.dataset.introScene)===current?'step':'false');
 }
 function scheduleIntroductionScroll(){if(intro&&introFrame===null)introFrame=requestAnimationFrame(updateIntroductionScroll)}
 function refreshClayMotion(){if(intro)scheduleIntroductionScroll();else{cancelAnimationFrame(introFrame);introFrame=null}}
 function resizeIntroduction(){if(introMotion.matches)for(const element of document.querySelectorAll('.clay-motion'))for(const animation of element.getAnimations())animation.cancel();if(intro){layoutIntroduction();scheduleIntroductionScroll()}}
 function scrollIntroductionTo(i){document.querySelectorAll('[data-intro-panel]')[i].scrollIntoView({block:'start',behavior:introMotion.matches?'auto':'smooth'})}
 window.addEventListener('scroll',scheduleIntroductionScroll,{passive:true});window.addEventListener('resize',resizeIntroduction,{passive:true});introMotion.addEventListener('change',resizeIntroduction);document.addEventListener('visibilitychange',scheduleIntroductionScroll);
 for(const button of document.querySelectorAll('[data-intro-scene]'))button.onclick=()=>scrollIntroductionTo(Number(button.dataset.introScene));
 function openIntroduction(){resetSheet();intro=true;review=false;$('introduction-screen').hidden=false;$('chapter-context').hidden=true;$('topic-screen').hidden=true;$('review-screen').hidden=true;renderNav();layoutIntroduction();window.scrollTo({top:0,behavior:'auto'});$('introduction-title').focus({preventScroll:true});scheduleIntroductionScroll()}
 function renderTopic(){
  const topic=state.document.topics[index],a=answer();$('topic-context').textContent=topic.groupLabel||topic.shortTitle||topic.title;$('topic-status').textContent=labels[a.status];$('topic-title').textContent=topic.title;$('topic-intro').textContent=topic.intro||'';$('topic-intro').hidden=!topic.intro;$('topic-question').textContent=topic.question;$('topic-question').hidden=!topic.question;const illustrated=state.document.presentation==='statement-cards';$('card-art').hidden=!illustrated;if(illustrated)$('card-art-image').src='/follow-up/assets/card-illustrations-v1/'+encodeURIComponent(topic.id)+'.webp';else $('card-art-image').removeAttribute('src');
  const group=state.document.groups?.find(g=>g.id===topic.groupId);$('chapter-context').hidden=!group?.goal;$('chapter-title').textContent=group?.title||'';$('chapter-goal').textContent=group?.goal||'';$('topic-responsibility').textContent=topic.responsibility||'';$('topic-responsibility').hidden=!topic.responsibility;
  $('points').replaceChildren();topic.lines.forEach(text=>{const p=node('div',undefined,'point');p.append(node('p',text));$('points').append(p)});
  renderChoices();
  $('comment').value=a.comment;$('comment').disabled=!editing();$('comment-area').open=Boolean(a.comment)||['change','discuss'].includes(a.status);$('topic-fields').replaceChildren();
  for(const f of topic.fields||[]){const label=node('label',f.label,'field-label');if(f.hint)label.append(node('small',f.hint));let input;
   if(f.options){input=node('select');input.append(new Option('選択してください',''));for(const option of f.options)input.append(new Option(option,option))}
   else if(f.multiline){input=node('textarea');input.rows=3;input.maxLength=2000}
   else{input=node('input');input.type=f.type==='date'?'date':'text';input.maxLength=2000}
   input.id='field-'+f.id;input.value=a.fields[f.id]||'';input.disabled=!editing();input.addEventListener('input',()=>{const next=answer();next.fields={...next.fields,[f.id]:input.value};state.response.answers[topic.id]=next;changed()});label.append(input);$('topic-fields').append(label)
  }
  $('previous').disabled=index===0&&!state.document.introduction;$('previous').textContent=index===0&&state.document.introduction?'← はじめに':'← 前のカード';$('next').textContent=index===state.document.topics.length-1?'回答をまとめて確認 →':'保存';renderNav();
 }
 function openTopic(i){resetSheet();index=i;intro=false;review=false;$('introduction-screen').hidden=true;$('topic-screen').hidden=false;$('review-screen').hidden=true;renderTopic();window.scrollTo({top:0,behavior:'auto'})}
 function reviewSummary(){
  updateUnanswered();
  $('review-summary').replaceChildren();let groupId=null;state.document.topics.forEach((t,i)=>{const group=t.groupId||t.id;if(group!==groupId){$('review-summary').append(node('h2',t.groupLabel||t.shortTitle||t.title,'review-group-heading'));groupId=group}const a=answer(t),entry=node('details',undefined,'review-entry'),summary=node('summary'),status=node('span',labels[a.status],'summary-status'+(a.status==='unanswered'?' unanswered':''));summary.append(node('strong',t.title),status);entry.append(summary);
   const body=node('div',undefined,'review-body');body.append(node('p',t.lines.join('\n')));const dl=node('dl');for(const f of t.fields||[])if(a.fields[f.id])dl.append(node('dt',f.label),node('dd',a.fields[f.id]));if(a.comment)dl.append(node('dt','補足・ご希望'),node('dd',a.comment));body.append(dl);const edit=node('button','この項目を開く →','edit-link');edit.onclick=()=>openTopic(i);body.append(edit);entry.append(body);$('review-summary').append(entry)
  });
  $('submission-history').textContent=state.submissions.length?'送信済み：'+state.submissions.map(s=>new Date(s.submitted_at).toLocaleString('ja-JP')+'（回答版 '+s.response_revision+'）').join('\n'):'まだ送信していません。入力内容は途中保存されています。';
 }
 function openReview(){resetSheet();intro=false;review=true;$('introduction-screen').hidden=true;$('chapter-context').hidden=true;$('topic-screen').hidden=true;$('review-screen').hidden=false;for(const [id,key]of [['company','company'],['respondent-name','name'],['email','email'],['position','position']]){$(id).value=state.response.respondent[key]||'';$(id).disabled=!editing()}$('extra').value=state.response.extra;$('extra').disabled=!editing();$('submit-area').hidden=!editing();$('admin-notice').hidden=editing();reviewSummary();renderNav();window.scrollTo({top:0,behavior:'auto'})}
 function loaded(data){
  sessionEpoch++;clearTimeout(timer);state=data;baseResponse=structuredClone(data.response);dirty=false;version=0;conflict=false;pendingSave=null;saving=null;recoveryConflicts=[];recoveryApplied=false;
  $('workspace').inert=false;$('login-screen').hidden=true;$('workspace').hidden=false;$('save-bar').hidden=false;$('logout').hidden=false;$('retry-save').hidden=true;$('attest').checked=false;$('definition-notice').hidden=!data.needsReconfirmation;
  setSave(editing()?'✓ サーバーに保存済み':'管理者として閲覧しています');renderIntroduction();
  const first=firstUnanswered();index=first<0?0:first;
  if(!editing()||hasProgress()&&first<0)openReview();else if(!hasProgress()&&data.document.introduction)openIntroduction();else openTopic(index);
  if(data.needsReconfirmation&&editing())changed();restoreRecovery();renderRecovery();
 }
 function clearPrivateView(){resetSheet();intro=false;refreshClayMotion();cancelAnimationFrame(introFrame);introFrame=null;document.documentElement.classList.remove('introduction-active');document.body.classList.remove('introduction-active');for(const panel of document.querySelectorAll('[data-intro-panel]'))panel.removeAttribute('style');for(const button of document.querySelectorAll('.introduction-pagination [data-intro-scene]'))button.removeAttribute('aria-current');$('introduction-screen').hidden=true;$('introduction-screen').style.removeProperty('--intro-header-height');for(const panel of document.querySelectorAll('[data-intro-panel]'))panel.classList.remove('scene-flowing');$('chapter-context').hidden=true;$('card-art').hidden=true;$('card-art-image').removeAttribute('src');for(const button of document.querySelectorAll('[data-decision]')){button.setAttribute('aria-pressed','false');button.disabled=true}for(const e of $('workspace').querySelectorAll('input,textarea,select')){if(e.type==='radio'||e.type==='checkbox')e.checked=false;else e.value=''}for(const id of ['topic-context','topic-status','topic-title','topic-intro','topic-question','topic-responsibility','chapter-title','chapter-goal','introduction-eyebrow','introduction-title','introduction-lead','introduction-goal','introduction-flow','introduction-roles','introduction-review-title','introduction-review-text','introduction-start','points','topic-fields','topic-nav','review-summary','submission-history'])$(id).replaceChildren()}
 $('login-form').onsubmit=async event=>{event.preventDefault();$('login-button').disabled=true;$('login-status').classList.remove('error');$('login-status').textContent='確認しています…';try{await api('login',{password:$('password').value,role:$('admin-login').checked?'admin':'customer'});$('password').value='';loaded(await api('state'))}catch(error){$('login-status').textContent=error.message;$('login-status').classList.add('error')}finally{$('login-button').disabled=false}};
 $('logout').onclick=async()=>{
  const epoch=sessionEpoch;$('workspace').inert=true;
  try{try{await save()}catch{captureRecovery()}if(epoch!==sessionEpoch)return;await api('logout',{});if(epoch!==sessionEpoch)return;showLogin(recoveryDraft?'退出しました。未保存の入力はこのタブに保持しています。再ログインして再開できます。':'退出しました。パスワードで再開できます。')}
  catch(error){if(epoch===sessionEpoch)notify(error.message)}finally{if(epoch===sessionEpoch)$('workspace').inert=false}
 };
 $('review-unanswered').onclick=()=>{const first=firstUnanswered();if(first>=0)openTopic(first)};
 $('recovery-current-document').onclick=()=>openTopic(Math.max(0,firstUnanswered()));
 for(const button of document.querySelectorAll('[data-decision]'))button.onclick=()=>{const value=button.dataset.decision;editAnswer('status',value);$('topic-status').textContent=labels[value];$('comment-area').open||=value!=='confirm';renderChoices();renderNav()};
 $('comment').oninput=()=>editAnswer('comment',$('comment').value);
 for(const [id,key]of [['company','company'],['respondent-name','name'],['email','email'],['position','position']])$(id).oninput=()=>{state.response.respondent[key]=$(id).value;$(id).setCustomValidity('');changed()};
 $('extra').oninput=()=>{state.response.extra=$('extra').value;changed()};
 $('introduction-start').onclick=()=>openTopic(index);
 $('introduction-skip').onclick=()=>openTopic(index);
 $('previous').onclick=()=>index===0&&state.document.introduction?openIntroduction():openTopic(Math.max(0,index-1));
 $('next').onclick=async()=>{
  const session=state,turn=sheetTurn,from=index;$('next').disabled=true;
  try{
   await save();if(state!==session||sheetTurn!==turn)return;
   const paper=$('topic-screen').querySelector('.topic-content');paper.inert=true;
   sheetAnimation=paper.animate([{transform:'translate(0,0) rotate(0deg)',opacity:1},{transform:'translate(12px,8px) rotate(-1deg)',opacity:1,offset:.25},{transform:'translate(70px,85px) rotate(5deg)',opacity:0}],{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:320,easing:'cubic-bezier(.35,0,.8,.45)'});
   await sheetAnimation.finished.catch(()=>{});if(state!==session||sheetTurn!==turn)return;
   if(from===state.document.topics.length-1)openReview();else openTopic(from+1);
  }catch(error){if(state===session)notify(error.message)}finally{if(sheetTurn===turn){sheetAnimation=null;$('topic-screen').querySelector('.topic-content').inert=false;$('next').disabled=false}}
 };
 for(const id of ['review-open','go-review'])$(id).onclick=()=>{openReview();save().catch(()=>{})};
 $('retry-save').onclick=()=>{const epoch=sessionEpoch;save().then(()=>{if(epoch===sessionEpoch)notify('保存しました。')}).catch(error=>{if(epoch===sessionEpoch)notify(error.message)})};
 function download(text,name,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([text],{type})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 const draft=()=>({format:'omf-followup-draft-v1',document:state.document,documentVersion:state.documentVersion,response:state.response,revision:state.revision,savedToServer:!dirty,exportedAt:new Date().toISOString()});
 $('download-unsaved').onclick=()=>download(JSON.stringify(draft(),null,2),'OMF-入力内容.json','application/json');
 $('download-recovery').onclick=()=>{if(editing()&&recoveryDraft)download(JSON.stringify(recoveryDraft,null,2),'OMF-前回の未保存入力.json','application/json')};
 $('export-json').onclick=async()=>{const epoch=sessionEpoch;try{await save();if(epoch!==sessionEpoch)return;const exported=await api('export');if(epoch!==sessionEpoch)return;download(JSON.stringify(exported,null,2),'OMF-回答と送信履歴.json','application/json')}catch(error){if(epoch===sessionEpoch)notify(error.message)}};
 $('export-text').onclick=()=>{const r=state.response,lines=[state.document.title,'ご回答者：'+r.respondent.company+' / '+r.respondent.name,'回答版：'+state.revision,''];state.document.topics.forEach(t=>{const a=answer(t);lines.push(t.title,'状態：'+labels[a.status],...t.lines.map(x=>'・'+x));for(const f of t.fields||[])if(a.fields[f.id])lines.push(f.label+'：'+a.fields[f.id]);if(a.comment)lines.push('補足：'+a.comment);lines.push('')});lines.push('全体のご希望：',r.extra||'（記入なし）');download(lines.join('\n'),'OMF-確認内容.txt')};
 $('print').onclick=()=>{openReview();for(const d of document.querySelectorAll('.review-entry'))d.open=true;window.print()};
 $('submit').onclick=async()=>{if(!editing())return;for(const id of ['company','respondent-name','email']){const input=$(id);if(input.required)input.setCustomValidity(input.value.trim()?'':'入力してください。');if(!input.checkValidity()){input.focus();input.reportValidity();return}}if(!$('attest').checked){notify('最後の確認欄にチェックしてください。');return}if(!$('email').checkValidity()){$('email').reportValidity();return}const attestedState=state,attestedVersion=version;$('submit').disabled=true;$('workspace').inert=true;try{await save();if(state!==attestedState||version!==attestedVersion||!$('attest').checked)throw Error('入力内容が変わりました。もう一度内容を確認して、送信してください。');const result=await api('submit',{documentVersion:state.documentVersion,revision:state.revision,attested:true});if(state!==attestedState)return;state.submissions=[{id:result.id,response_revision:state.revision,submitted_at:result.submittedAt},...state.submissions.filter(x=>x.id!==result.id)];reviewSummary();notify('ご回答ありがとうございます。内容を受け付けました。')}catch(error){if(state===attestedState)notify(error.message)}finally{if(state===attestedState){$('workspace').inert=false;$('submit').disabled=false}}};
 window.addEventListener('beforeunload',event=>{if(dirty||recoveryDraft){event.preventDefault();event.returnValue=''}});
 api('state').then(loaded).catch(error=>{if(error.status!==401)$('login-status').textContent=error.message});
})();
