// Responsive layout around the right-side Navi (owner feedback 2026-10-23: with Hyeni at the bottom right, shrinking the window made texts
// and numbers run out of their layout). Actual installed Google Chrome against the owned synthetic native app. Synthetic company rows with
// realistic yen/US$ amounts and long Japanese names are created through the same native company APIs the pages read, and deleted through
// them afterwards. Every check measures what a person sees: the page width, the painted range of every text against the card, pill or
// control that draws its box and against hidden-overflow clipping, nothing painted in Navi's reserved column, every seeded amount present
// in full, local table scrolling to the last column and a hit test of every actionable control. Each group runs to its end and reports its
// own result. No model, bank, mail, Slack or production calls.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),{existsSync}=require('node:fs');
const WIDTHS=[320,390,768,900,1024,1280,1440,1920],NORMAL=900,SHORT=600;
// Recorded synthetic inputs (no customer data): five company transactions in the current month, three invoices, three recurring payments.
const TRANSACTIONS=[
 {day:'03',type:'支出',status:'completed',amount:98765432,productName:'Synthetic layout 株式会社サンプル国際物流ホールディングス東日本統括支社 年間保守・クラウド運用契約',referenceNumber:'LAYOUT-2026-000001-EXPENSE-LONG-REFERENCE'},
 {day:'04',type:'支出',status:'pending',amount:23456789,productName:'Synthetic layout 大型倉庫賃料（関東第二物流センター・冷蔵区画を含む）'},
 {day:'05',type:'支出',status:'processing',amount:6234568,productName:'Synthetic layout 通関・国際配送手数料'},
 {day:'06',type:'入金',status:'completed',amount:187654321,productName:'Synthetic layout 海外販売代金 一括入金（北米・欧州・アジア太平洋）'},
 {day:'07',type:'入金',status:'pending',amount:58024580,productName:'Synthetic layout 国内卸売代金'}
];
const INVOICES=[
 {to:{name:'株式会社サンプル国際物流ホールディングス 東日本統括支社 経理部 御中'},from:{name:'Synthetic layout 株式会社'},items:[{description:'国際物流システム年間保守（全拠点・24時間対応）',quantity:1,unitPrice:11223344}],taxRate:10,status:'overdue',currency:'JPY'},
 {to:{name:'Synthetic Global Trading Company Limited (North America Regional Headquarters)'},from:{name:'Synthetic layout 株式会社'},items:[{description:'Cross-border logistics retainer',quantity:1,unitPrice:123456.78}],taxRate:10,status:'paid',currency:'USD'},
 {to:{name:'有限会社ロングネームテスト商事'},from:{name:'Synthetic layout 株式会社'},items:[{description:'Synthetic layout 月次コンサルティング',quantity:3,unitPrice:2345678}],taxRate:10,status:'draft',currency:'JPY'}
];
const RECURRING=[
 {name:'Synthetic layout クラウド会計・給与計算・経費精算サービス年間ライセンス（全社利用）',amount:1234567,currency:'JPY',transactionType:'支出',frequency:'monthly',customer:{name:'株式会社サンプルクラウドソリューションズ'},autoGenerate:false},
 {name:'Synthetic layout Overseas warehouse subscription',amount:12345.67,currency:'USD',transactionType:'支出',frequency:'monthly',customer:{name:'Synthetic Overseas Warehouse Inc.'},autoGenerate:false},
 {name:'Synthetic layout 保守サービス月額売上',amount:2345678,currency:'JPY',transactionType:'入金',frequency:'monthly',customer:{name:'株式会社サンプル顧客'},autoGenerate:false}
];
// Digit groups of the seeded values each page must show in full (totals 128,456,789 / 245,678,901; invoice totals after the native 10% tax;
// the tax report's net 117,222,112; the owner import's 1,234 line).
const PAGES=[
 {path:'/',name:'dashboard',amounts:['128,456,789','245,678,901']},
 {path:'/transactions',name:'transactions',amounts:['128,456,789','245,678,901']},
 // /analytics has a preexisting SSR500 (reading labels) before any layout edit. Its page stays unchanged and is explicitly outside this UI proof.
 {path:'/invoices',name:'invoices',amounts:['12,345,678','135,802.78','7,740,737']},
 {path:'/recurring',name:'recurring',amounts:['1,234,567','12,345.67','2,345,678']},
 {path:'/receipts',name:'receipts',amounts:[]},
 // /reports does not send the current auth header and renders no report. This preexisting data-load defect is recorded separately.
 {path:'/reports/tax',name:'tax',amounts:['245,678,901','128,456,789','117,222,112']},
 {path:'/mapping',name:'mapping',amounts:['1,234']}
];
const SHOTS=[[390,'closed-large'],[768,'closed-large'],[1024,'closed-large'],[1024,'open'],[1280,'closed-large'],[1440,'open'],[1440,'closed-small']];
const DRAFT='Synthetic layout draft 未送信のまま';

// In-page audit of the page content column at the current viewport. Text ranges are measured with Range.getClientRects, so a label cut by
// an ellipsis or by a card's hidden overflow counts by its real extent. Scrollable overflow (a local table scroller) is reachable and only
// its visible part is checked against the column.
function auditPage({amounts,column}){
 const root=document.querySelector('[data-page-content]');if(!root)return{texts:0,findings:[{kind:'no-page-content'}],amounts:{}};
 const de=document.documentElement,vw=de.clientWidth,content=root.getBoundingClientRect();
 const dock=document.querySelector('[data-assistant-dock]'),panel=document.querySelector('#omf-assistant'),open=!!dock&&dock.classList.contains('navi-dock-open');
 const navi=dock?(open&&panel?panel.getBoundingClientRect():dock.getBoundingClientRect()):null;
 const styles=new Map(),cs=e=>{let s=styles.get(e);if(!s){s=getComputedStyle(e);styles.set(e,s)}return s};
 const hiddenMemo=new Map(),hidden=e=>{if(!e||e===de)return false;if(hiddenMemo.has(e))return hiddenMemo.get(e);const s=cs(e),v=(e.classList&&e.classList.contains('sr-only'))||s.display==='none'||s.visibility==='hidden'||(s.clip&&s.clip!=='auto')||hidden(e.parentElement);hiddenMemo.set(e,v);return v};
 const describe=e=>{const cls=typeof e.className==='string'?e.className.trim().split(/\s+/).filter(c=>!c.includes(':')).slice(0,4).join('.'):'',data=[...e.attributes].map(a=>a.name).filter(n=>n.startsWith('data-')&&!n.startsWith('data-v-')).slice(0,2).join(',');return e.tagName.toLowerCase()+(data?'['+data+']':'')+(cls?'.'+cls:'')};
 const clear=c=>!c||c==='transparent'||/rgba\([^)]*,\s*0\)$/.test(c);
 const drawsBox=e=>{const s=cs(e);if(s.backgroundImage!=='none'||!clear(s.backgroundColor))return true;return ['Top','Right','Bottom','Left'].some(k=>parseFloat(s['border'+k+'Width'])>0&&s['border'+k+'Style']!=='none'&&!clear(s['border'+k+'Color']))};
 const pad=a=>{const r=a.getBoundingClientRect();return{left:r.left+a.clientLeft,top:r.top+a.clientTop,right:r.left+a.clientLeft+a.clientWidth,bottom:r.top+a.clientTop+a.clientHeight}};
 const round=r=>({left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom)});
 const findings=[],seen=new Set(),add=(kind,detail)=>{const key=kind+'|'+(detail.element||'')+'|'+(detail.text||'');if(seen.has(key))return;seen.add(key);if(findings.length<40)findings.push({kind,...detail})};
 if(de.scrollWidth>vw+1)add('page-overflow',{scrollWidth:de.scrollWidth,viewport:vw});
 for(const e of [root,root.parentElement,root.closest('main')])if(e&&/auto|scroll|hidden|clip/.test(cs(e).overflowX+cs(e).overflowY))add('nested-page-scroll',{element:describe(e),overflow:cs(e).overflowX+'/'+cs(e).overflowY});
 if(column&&navi&&navi.width>0&&navi.height>0&&navi.left<content.right-1)add('navi-covers-content',{navi:round(navi),contentRight:Math.round(content.right),open});
 // A rectangle owned by el: hidden-overflow clipping (unreachable), the box that should hold it, and the part a person can see now.
 const analyze=(el,r,self)=>{
  const out={clippedBy:null,outsideBox:null,visible:{left:r.left,right:r.right,top:r.top,bottom:r.bottom}};let boxDone=false;
  for(let a=self?el:el.parentElement;a&&a!==de;a=a.parentElement){
   const s=cs(a),hx=/hidden|clip/.test(s.overflowX),hy=/hidden|clip/.test(s.overflowY),sx=/auto|scroll/.test(s.overflowX),sy=/auto|scroll/.test(s.overflowY);
   if(hx||hy||sx||sy){const p=pad(a);
    // An inner table scroller already makes the offscreen part reachable. Its outer rounded card clips only the visible fragment.
    const v=out.visible;
    if(!out.clippedBy&&((hx&&(v.left<p.left-1||v.right>p.right+1))||(hy&&(v.top<p.top-3||v.bottom>p.bottom+3))))out.clippedBy=a;
    if(hx||sx){out.visible.left=Math.max(out.visible.left,p.left);out.visible.right=Math.min(out.visible.right,p.right)}
    if(hy||sy){out.visible.top=Math.max(out.visible.top,p.top);out.visible.bottom=Math.min(out.visible.bottom,p.bottom)}
    if(sx||sy)boxDone=true;
   }
   if(!boxDone&&a!==root&&root.contains(a)&&drawsBox(a)){boxDone=true;const b=a.getBoundingClientRect();if(r.left<b.left-1||r.right>b.right+1||r.top<b.top-4||r.bottom>b.bottom+4)out.outsideBox=a}
   if(a===root)boxDone=true;
  }
  return out;
 };
 const amountState=Object.fromEntries(amounts.map(a=>[a,{found:0,readable:0}]));let texts=0;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.data.trim()&&n.parentElement&&!['SCRIPT','STYLE','OPTION','TEXTAREA','NOSCRIPT'].includes(n.parentElement.tagName)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
 const range=document.createRange();
 for(let n=walker.nextNode();n;n=walker.nextNode()){
  const el=n.parentElement;if(hidden(el))continue;range.selectNodeContents(n);const rects=[...range.getClientRects()].filter(r=>r.width>.5&&r.height>.5);if(!rects.length)continue;texts++;
  const text=n.data.replace(/\s+/g,' ').trim();let ok=true;
  for(const r of rects){const x=analyze(el,r,true);
   if(x.clippedBy){ok=false;add('text-clipped',{element:describe(el),text:text.slice(0,48),by:describe(x.clippedBy),rect:round(r),clip:round(pad(x.clippedBy))})}
   if(x.outsideBox){ok=false;add('text-outside-box',{element:describe(el),text:text.slice(0,48),box:describe(x.outsideBox),rect:round(r),boxRect:round(x.outsideBox.getBoundingClientRect())})}
   const v=x.visible;if(v.right-v.left>.5&&v.bottom-v.top>.5){
    if(column&&v.right>content.right+1){ok=false;add('text-in-navi-column',{element:describe(el),text:text.slice(0,48),rect:round(v),contentRight:Math.round(content.right)})}
    if(v.right>vw+1||v.left<-1){ok=false;add('text-offscreen',{element:describe(el),text:text.slice(0,48),rect:round(v),viewport:vw})}
   }
  }
  for(const a of amounts)if(text.includes(a)){amountState[a].found++;if(ok)amountState[a].readable++}
 }
 for(const e of root.querySelectorAll('*')){
  if(hidden(e))continue;const b=e.getBoundingClientRect();if(b.width<1||b.height<1)continue;
  if(!/^(img|canvas|svg|input|select|button|textarea|video)$/i.test(e.tagName)&&!drawsBox(e))continue;
  const v=analyze(e,b,false).visible;if(v.right-v.left<=.5||v.bottom-v.top<=.5)continue;
  if(column&&v.right>content.right+1)add('box-in-navi-column',{element:describe(e),rect:round(v),contentRight:Math.round(content.right)});
  if(v.right>vw+1||v.left<-1)add('box-offscreen',{element:describe(e),rect:round(v),viewport:vw});
 }
 for(const a of amounts){if(!amountState[a].found)add('amount-missing',{text:a});else if(!amountState[a].readable)add('amount-not-readable',{text:a})}
 return{texts,content:round(content),navi:navi&&round(navi),open,compact:!!dock&&dock.classList.contains('navi-dock-compact'),scrollWidth:de.scrollWidth,viewport:vw,amounts:amountState,findings};
}

// In-page reachability: every actionable control and every table's last header cell is revealed the way a person can (local scrollers and
// the document only; a hidden-overflow ancestor is never scrolled) and must then be wholly inside every clipping ancestor and the
// viewport, with its centre hit-testing to itself.
function reachControls(){
 const root=document.querySelector('[data-page-content]'),de=document.documentElement,dock=document.querySelector('[data-assistant-dock]');
 const hidden=e=>{for(let a=e;a&&a!==de;a=a.parentElement){if(a.classList&&a.classList.contains('sr-only'))return true;const s=getComputedStyle(a);if(s.display==='none'||s.visibility==='hidden')return true}return false};
 const describe=e=>{const cls=typeof e.className==='string'?e.className.trim().split(/\s+/).filter(c=>!c.includes(':')).slice(0,3).join('.'):'',data=[...e.attributes].map(a=>a.name).filter(n=>n.startsWith('data-')&&!n.startsWith('data-v-')).slice(0,2).join(',');return e.tagName.toLowerCase()+(data?'['+data+']':'')+(cls?'.'+cls:'')};
 const pad=a=>{const r=a.getBoundingClientRect();return{left:r.left+a.clientLeft,top:r.top+a.clientTop,right:r.left+a.clientLeft+a.clientWidth,bottom:r.top+a.clientTop+a.clientHeight}};
 const controls=[...root.querySelectorAll('a[href],button,select,input:not([type=hidden]),textarea,summary')].filter(e=>e.getClientRects().length&&!hidden(e));
 const lastColumns=[...root.querySelectorAll('table')].map(t=>t.querySelector('thead tr > :last-child')).filter(e=>e&&e.getClientRects().length&&!hidden(e));
 const failures=[],scrolled=new Set();
 const check=(c,kind)=>{
  for(let a=c.parentElement;a&&a!==de;a=a.parentElement){const s=getComputedStyle(a);if(/auto|scroll/.test(s.overflowX)&&a.scrollWidth>a.clientWidth+1){const p=pad(a),r=c.getBoundingClientRect();if(r.right>p.right)a.scrollLeft+=Math.ceil(r.right-p.right)+2;else if(r.left<p.left)a.scrollLeft-=Math.ceil(p.left-r.left)+2;scrolled.add(a)}}
  let r=c.getBoundingClientRect();window.scrollBy({top:r.top+r.height/2-innerHeight/2,left:0,behavior:'instant'});r=c.getBoundingClientRect();
  let clip=null;for(let a=c.parentElement;a&&a!==de;a=a.parentElement){const s=getComputedStyle(a),x=s.overflowX!=='visible',y=s.overflowY!=='visible';if(x||y){const p=pad(a);if((x&&(r.left<p.left-2||r.right>p.right+2))||(y&&(r.top<p.top-2||r.bottom>p.bottom+2))){clip=a;break}}}
  const inView=r.left>=-1&&r.right<=de.clientWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1,cx=r.left+r.width/2,cy=r.top+r.height/2,hit=inView?document.elementFromPoint(cx,cy):null;
  const ok=!clip&&inView&&!!hit&&(hit===c||c.contains(hit)||hit.control===c);
  if(!ok)failures.push({kind,control:describe(c),text:(c.textContent||c.getAttribute('aria-label')||c.getAttribute('title')||'').replace(/\s+/g,' ').trim().slice(0,40),rect:{left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom)},clippedBy:clip&&describe(clip),hit:hit&&describe(hit),covered:hit&&hit!==c&&!c.contains(hit)?(dock&&dock.contains(hit)?'navi':'page'):null});
 };
 for(const c of controls)check(c,'control');for(const c of lastColumns)check(c,'last-column');
 window.scrollTo({top:0,left:0,behavior:'instant'});for(const a of scrolled)a.scrollLeft=0;
 return{controls:controls.length,lastColumns:lastColumns.length,failureCount:failures.length,failures:failures.slice(0,30)};
}

module.exports=async({root,origin,email,password,A,batchId,worker,pause,pass})=>{
 let puppeteer;try{puppeteer=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(root,'../collector/package.json'))('rebrowser-puppeteer-core')}
 const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe')].find(existsSync);
 assert.ok(executablePath,'layout:setup installed Chrome');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-layout-chrome-')),shots=process.env.OMF_LAYOUT_SCREENSHOTS;let browser,page;
 const errors=[],evidence={matrix:[],reach:[],boundaries:[],navi:{},locale:[],seeded:{},nativeObservations:{}},failed=[],created={transactions:[],invoices:[],recurring:[]};
 const wait=async(fn,args=[],label='condition',tries=300)=>{for(let i=0;i<tries;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw Error('layout:'+label)};
 const view=async(width,height)=>{await page.setViewport({width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await pause(150)};
 const shot=async name=>{if(shots){await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,name+'.png'),captureBeyondViewport:false})}};
 const store=name=>page.evaluate(name=>{const s=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get(name);return{size:s.size,open:s.open}},name);
 const api=(method,route,body)=>page.evaluate(async(method,route,body)=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user'),r=await fetch(route,{method,headers:{...user.authHeader,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),text=await r.text();let data=null;try{data=JSON.parse(text)}catch{}return{status:r.status,data,text:text.slice(0,240)}},method,route,body);
 const switchNative=organizationId=>page.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})});if(!r.ok)throw Error('layout:setup company switch '+r.status);const session=await r.json();const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+session.tokens.accessToken}});if(!p.ok)throw Error('layout:setup company profile '+p.status);user.acceptSession({...await p.json(),tokens:session.tokens},false)},organizationId);
 const ready=async p=>{
  if(p.name.endsWith('receipts'))return wait(()=>{const v=[...document.querySelectorAll('[data-library-stats] p')].map(e=>e.textContent.trim());return v.length>0&&!v.includes('—')},[],'ready-'+p.name);
  if(p.name.endsWith('mapping'))return wait(()=>document.querySelector('[data-page-content]')?.textContent.includes('Synthetic floating purchase'),[],'ready-'+p.name);
  return wait(amounts=>{const t=document.querySelector('[data-page-content]')?.textContent||'';return amounts.every(a=>t.includes(a))},[p.amounts],'ready-'+p.name);
 };
 const go=async p=>{await page.goto(origin+(p.name.endsWith('mapping')?p.path+'?import='+batchId:p.path),{waitUntil:'networkidle2'});try{await ready(p)}catch(e){if(shots){await shot('setup-'+p.name);await fs.writeFile(path.join(shots,'setup-'+p.name+'.json'),JSON.stringify(await page.evaluate(()=>({path:location.pathname,title:document.title,text:document.querySelector('[data-page-content]')?.textContent?.slice(0,1600),statCount:document.querySelectorAll('[data-page-content] [data-stat-card]').length,monoCount:document.querySelectorAll('[data-page-content] .font-mono').length})),null,2))}throw e}};
 const pickSize=async size=>{if((await store('assistant')).size===size)return;await page.click('[data-navi-size-toggle]');await wait(()=>document.querySelector('[data-navi-size-menu]')?.getClientRects().length>0,[],'size-menu');await page.click('[data-navi-size="'+size+'"]');await wait(s=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('assistant').size===s,[size],'size-'+size)};
 const openNavi=async()=>{await page.click('[data-assistant-toggle]');await wait(()=>document.querySelector('#omf-assistant')?.getBoundingClientRect().height>0,[],'navi-open')};
 const closeNavi=async()=>{await page.click('[data-assistant-close]');await wait(()=>document.querySelector('[data-assistant-toggle]')?.getClientRects().length>0,[],'navi-closed')};
 const audit=(p,width)=>page.evaluate(auditPage,{amounts:p.amounts,column:width>=768});
 const summarize=rows=>rows.filter(r=>r.findings.length).slice(0,12).map(r=>({page:r.page,viewport:r.viewport,state:r.state,findings:r.findings.slice(0,3)}));
 const group=async(name,fn)=>{try{await fn();pass(name)}catch(e){failed.push(name);console.log('FAIL '+name+': '+String(e&&e.message||e).replace(/\s+/g,' ').slice(0,2400))}};
 try{
  browser=await puppeteer.launch({executablePath,headless:true,pipe:true,userDataDir:path.join(directory,'profile'),args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});
  page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.setViewport({width:1440,height:NORMAL});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.type('#email',email);await page.type('#password',password);await page.$eval('button[type=submit]',e=>e.click());await wait(()=>location.pathname==='/'&&!!document.querySelector('[data-assistant-toggle]'),[],'setup login');
  await switchNative(A);
  const month=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit'}).format(new Date());
  for(const t of TRANSACTIONS){const {day,...body}=t,r=await api('POST','/api/transactions',{...body,date:month+'-'+day});assert.equal(r.status,200,'layout:setup transaction '+r.text);created.transactions.push(String(r.data._id))}
  for(const i of INVOICES){const r=await api('POST','/api/invoices',{...i,issueDate:month+'-01',dueDate:month+'-20'});assert.equal(r.status,200,'layout:setup invoice '+r.text);created.invoices.push(String(r.data.invoice.id))}
  for(const p of RECURRING){const r=await api('POST','/api/recurring',{...p,startDate:month+'-28'});assert.equal(r.status,200,'layout:setup recurring '+r.text);created.recurring.push(String(r.data.payment.id||r.data.payment._id))}
  evidence.seeded={month,transactions:created.transactions.length,invoices:created.invoices.length,recurring:created.recurring.length};
  const tax=await api('GET','/api/reports/tax?year='+new Date().getFullYear()),stats=await api('GET','/api/transactions/stats');
  assert.equal(tax.status,200,'layout:setup native tax read');assert.equal(stats.status,200,'layout:setup native stats read');
  evidence.nativeObservations={tax:tax.data.summary,stats:stats.data,limits:'Presentation only: seven rendered pages. Analytics SSR500 and general Reports missing auth header are baseline exclusions, with their page sources unchanged. Existing native tax classification is neither repaired nor certified here.'};
  // Tax uses its existing native classification, including preexisting Japanese-income handling. Never change accounting to fit a UI test.
  PAGES.find(p=>p.name==='tax').amounts=[...new Set([tax.data.summary.totalIncome,tax.data.summary.totalExpenses,tax.data.summary.netIncome].map(v=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(Math.abs(v))))];

  // 1. Every page, every sampled width, Navi closed at each size and open, normal and short heights.
  await group('layout:matrix every page keeps its texts and full amounts inside their cards, the page width and the column left of Navi',async()=>{
   for(const p of PAGES){
    await view(1440,NORMAL);await go(p);
    const states=[...['small','medium','large'].map(size=>({size,open:false,heights:size==='large'?[NORMAL,SHORT]:[NORMAL]})),{size:'large',open:true,heights:[NORMAL,SHORT]}];
    for(const s of states){
     await view(1440,NORMAL);if(s.open)await openNavi();else await pickSize(s.size);
     const state=s.open?'open':'closed-'+s.size;
     for(const height of s.heights)for(const width of WIDTHS){await view(width,height);const a=await audit(p,width);evidence.matrix.push({page:p.name,viewport:width+'x'+height,state,...a});if(height===NORMAL&&SHOTS.some(([w,st])=>w===width&&st===state))await shot(p.name+'-'+width+'x'+height+'-'+state)}
     if(s.open){await view(1440,NORMAL);await closeNavi()}
    }
   }
   const bad=evidence.matrix.filter(r=>r.findings.length);
   assert.equal(bad.length,0,'layout:matrix '+bad.length+'/'+evidence.matrix.length+' page states fail '+JSON.stringify(summarize(bad)));
  });

  // 2. The same page, resized across 1399/1400, 1023/1024 and 767/768 in both directions, with a typed search and an unsent Navi draft.
  await group('layout:boundaries same-page resizes keep the layout readable and the typed search, the unsent Navi draft and focus',async()=>{
   const p=PAGES[1],search='[data-page-content] input[type=text]';await view(1440,NORMAL);await go(p);await pickSize('large');
   await page.click(search);await page.type(search,'synthetic layout');
   const steps=[[1400,NORMAL],[1399,NORMAL],[1400,NORMAL],[1024,NORMAL],[1023,NORMAL],[1024,NORMAL],[768,NORMAL],[767,NORMAL],[768,NORMAL],[1440,NORMAL]];
   const state=()=>page.evaluate(sel=>({search:document.querySelector(sel).value,searchFocused:document.activeElement===document.querySelector(sel),draft:document.querySelector('#assistant-message')?.value??null,draftFocused:document.activeElement?.id==='assistant-message',expanded:document.querySelector('[data-assistant-toggle]').getAttribute('aria-expanded'),rows:document.querySelectorAll('[data-page-content] tbody tr').length}),search);
   const problems=[];
   for(const [w,h] of steps){await view(w,h);const a=await audit(p,w),s=await state();evidence.boundaries.push({phase:'closed',viewport:w+'x'+h,...s,findings:a.findings});if(a.findings.length||s.search!=='synthetic layout'||!s.searchFocused||s.rows!==5||s.expanded!=='false')problems.push({phase:'closed',viewport:w+'x'+h,state:s,findings:a.findings.slice(0,3)})}
   await worker('heartbeat');await openNavi();await wait(()=>!!document.querySelector('#assistant-message')&&!document.querySelector('#assistant-message').disabled,[],'boundaries composer');
   await page.click('#assistant-message');await page.type('#assistant-message',DRAFT);
   for(const [w,h] of [...steps,[1280,SHORT],[1280,NORMAL],[900,SHORT],[900,NORMAL]]){await view(w,h);const a=await audit(p,w),s=await state();evidence.boundaries.push({phase:'open',viewport:w+'x'+h,...s,findings:a.findings});if(a.findings.length||s.search!=='synthetic layout'||s.draft!==DRAFT||!s.draftFocused||s.rows!==5)problems.push({phase:'open',viewport:w+'x'+h,state:s,findings:a.findings.slice(0,3)})}
   await shot('boundaries-900x900-open');
   await page.keyboard.press('Escape');await wait(()=>document.querySelector('[data-assistant-toggle]')?.getAttribute('aria-expanded')==='false',[],'boundaries escape');
   const closed=await page.evaluate(sel=>({launcherFocused:!!document.activeElement?.hasAttribute('data-assistant-toggle'),search:document.querySelector(sel).value}),search);
   await openNavi();const reopened=await state();await closeNavi();
   evidence.boundaries.push({phase:'after',closed,reopenedDraft:reopened.draft});
   if(!closed.launcherFocused||closed.search!=='synthetic layout'||reopened.draft!==DRAFT)problems.push({phase:'after',closed,reopenedDraft:reopened.draft});
   assert.deepEqual(problems,[],'layout:boundaries '+JSON.stringify(problems).slice(0,2000));
  });

  // 3. Actionable controls and every table's last column, revealed the way a person can, hit-tested at the centre.
  await group('layout:reach every control and the last table column can be revealed and hit at the sampled widths, closed and open',async()=>{
   for(const p of PAGES){
    await view(1440,NORMAL);await go(p);await pickSize('large');
    for(const open of [false,true]){
     if(open){await view(1440,NORMAL);await openNavi()}
     for(const width of open?[768,1024,1280,1440]:[390,768,1024,1280,1440]){await view(width,NORMAL);if(!open)await page.mouse.move(0,0);const r=await page.evaluate(reachControls);evidence.reach.push({page:p.name,viewport:width+'x'+NORMAL,state:open?'open':'closed-large',...r})}
     if(open){await view(1440,NORMAL);await closeNavi()}
    }
   }
   const bad=evidence.reach.filter(r=>r.failureCount);
   assert.equal(bad.length,0,'layout:reach '+bad.length+'/'+evidence.reach.length+' page states fail '+JSON.stringify(bad.slice(0,10).map(r=>({page:r.page,viewport:r.viewport,state:r.state,failureCount:r.failureCount,first:r.failures.slice(0,3)}))));
  });

  // 4. Navi's own presentation is unchanged: closed sizes and their reserve, the tall rail, the header portrait, focus, persistence; a page
  // modal still covers the app header; the page keeps scrolling as the document.
  await group('layout:navi closed sizes, tall rail, portrait, focus and persisted size are unchanged; page modals cover the header; no nested page scroll',async()=>{
   const measure=()=>page.evaluate(()=>{const r=e=>{const b=e.getBoundingClientRect();return{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};const c=document.querySelector('[data-page-content]'),a=document.querySelector('#omf-assistant'),portrait=a.querySelector('header .navi-avatar');return{dock:r(document.querySelector('[data-assistant-dock]')),launcher:r(document.querySelector('[data-assistant-toggle]')),launcherRects:document.querySelector('[data-assistant-toggle]').getClientRects().length,panel:r(a),content:r(c),header:r(document.querySelector('[data-app-header]')),viewport:{width:innerWidth,height:innerHeight},padBottom:parseFloat(getComputedStyle(c).paddingBottom),portrait:portrait&&{...r(portrait),radius:getComputedStyle(portrait).borderRadius},focusInPanel:a.contains(document.activeElement),launcherFocused:!!document.activeElement?.hasAttribute('data-assistant-toggle')}});
   const problems=[],sizes={small:[88,98],medium:[170,182],large:[280,296]};await view(1440,NORMAL);await go(PAGES[1]);
   for(const [width,list] of [[1440,['small','medium','large']],[1024,['large']],[768,['small','large']]]){
    for(const size of list){await view(1440,NORMAL);await pickSize(size);await view(width,NORMAL);const m=await measure();evidence.navi['closed-'+size+'-'+width]=m;if(m.launcher.height<sizes[size][0]||m.launcher.height>sizes[size][1]||m.content.right>m.dock.left+1||m.viewport.height-m.dock.bottom>48)problems.push({case:'closed-'+size+'-'+width,launcher:m.launcher,dock:m.dock,contentRight:m.content.right})}
   }
   await view(767,NORMAL);let m=await measure();evidence.navi['closed-large-767']=m;if(m.launcher.height<200||m.launcher.height>216||Math.abs(m.padBottom-m.launcher.height)>1)problems.push({case:'closed-large-767 mobile size and page-end reserve',launcher:m.launcher,padBottom:m.padBottom});
   await view(1440,NORMAL);await openNavi();m=await measure();evidence.navi['open-1440']=m;
   if(m.launcherRects!==0||m.panel.height<.7*m.viewport.height||m.panel.top<m.header.bottom||m.panel.right>m.viewport.width-24||m.panel.left<m.content.right-1||!m.portrait||Math.abs(m.portrait.width-44)>1||m.portrait.radius!=='50%'||!m.focusInPanel)problems.push({case:'open-1440 rail',panel:m.panel,header:m.header,contentRight:m.content.right,portrait:m.portrait,launcherRects:m.launcherRects,focusInPanel:m.focusInPanel});
   await shot('navi-1440x900-open');await closeNavi();m=await measure();evidence.navi['closed-after-open']=m;if(m.launcher.height<280||m.launcher.height>296||!m.launcherFocused)problems.push({case:'close returns large launcher with focus',launcher:m.launcher,launcherFocused:m.launcherFocused});
   await pickSize('small');await page.reload({waitUntil:'networkidle2'});await ready(PAGES[1]);m=await measure();evidence.navi['small-after-reload']={size:(await store('assistant')).size,launcher:m.launcher};if((await store('assistant')).size!=='small'||m.launcher.height>98)problems.push({case:'size persists across reload',launcher:m.launcher});await pickSize('large');
   await view(1024,NORMAL);await go(PAGES.find(p=>p.name==='invoices'));await page.evaluate(()=>[...document.querySelectorAll('[data-page-content] button')].find(b=>b.textContent.includes('新規請求書')).click());await wait(()=>!!document.querySelector('[data-page-content] .fixed.inset-0.z-50'),[],'invoice modal');
   const modal=await page.evaluate(()=>{const o=document.querySelector('[data-page-content] .fixed.inset-0.z-50'),h=document.querySelector('[data-app-header]').getBoundingClientRect(),b=o.getBoundingClientRect(),hit=document.elementFromPoint(h.left+h.width/2,h.top+h.height/2);return{overlay:{left:b.left,top:b.top,width:b.width,height:b.height},viewport:{width:innerWidth,height:innerHeight},headerCovered:!!hit&&o.contains(hit)}});evidence.navi.modal=modal;await shot('invoice-modal-1024x900');
   if(!modal.headerCovered||modal.overlay.left!==0||modal.overlay.top!==0||Math.abs(modal.overlay.width-modal.viewport.width)>1||Math.abs(modal.overlay.height-modal.viewport.height)>1)problems.push({case:'inline page modal covers the viewport and the app header',modal});
   await page.mouse.click(4,NORMAL-4);await wait(()=>!document.querySelector('[data-page-content] .fixed.inset-0.z-50'),[],'invoice modal closed');
   await view(390,NORMAL);await go(PAGES[1]);const scroll=await page.evaluate(()=>{const c=document.querySelector('[data-page-content]'),before=c.getBoundingClientRect().top;window.scrollTo({top:300,behavior:'instant'});const after=c.getBoundingClientRect().top,moved=Math.round(before-after),out={documentScrolls:document.scrollingElement.scrollHeight>innerHeight,moved,scrollY};window.scrollTo({top:0,behavior:'instant'});return out});evidence.navi.scroll=scroll;
   if(!scroll.documentScrolls||scroll.moved!==300)problems.push({case:'page scrolls as the document',scroll});
   assert.deepEqual(problems,[],'layout:navi '+JSON.stringify(problems).slice(0,2000));
  });

  // 5. Korean labels and ko-KR money formats on four pages (run last: the locale cookie stays for the rest of this browser).
  await group('layout:locale Korean labels and formats stay inside their cards at tablet and desktop widths, closed and open',async()=>{
   const pages=[{...PAGES[0],path:'/ko',name:'ko-dashboard'},{...PAGES[1],path:'/ko/transactions',name:'ko-transactions'},{...PAGES.find(p=>p.name==='recurring'),path:'/ko/recurring',name:'ko-recurring'},{...PAGES.find(p=>p.name==='tax'),path:'/ko/reports/tax',name:'ko-tax'}];
   for(const p of pages){
    await view(1440,NORMAL);await go(p);assert.ok(await page.evaluate(()=>/[\uac00-\ud7af]/.test(document.querySelector('[data-page-content]').textContent)),'layout:setup Korean page '+p.path);
    for(const open of [false,true]){if(open)await openNavi();for(const width of [768,1024,1280]){await view(width,NORMAL);const a=await audit(p,width);evidence.locale.push({page:p.name,viewport:width+'x'+NORMAL,state:open?'open':'closed-large',...a});if(width===1024)await shot(p.name+'-1024x900-'+(open?'open':'closed-large'))}if(open){await view(1440,NORMAL);await closeNavi()}}
   }
   const bad=evidence.locale.filter(r=>r.findings.length);
   assert.equal(bad.length,0,'layout:locale '+bad.length+'/'+evidence.locale.length+' page states fail '+JSON.stringify(summarize(bad)));
  });
 }finally{
  try{
   if(page){
    for(const id of created.recurring){const r=await api('DELETE','/api/recurring/'+id);if(r.status!==200)errors.push('cleanup recurring '+r.status)}
    for(const id of created.invoices){const r=await api('DELETE','/api/invoices/'+id);if(r.status!==200)errors.push('cleanup invoice '+r.status)}
    for(const id of created.transactions){const r=await api('DELETE','/api/transactions/'+id);if(r.status!==200)errors.push('cleanup transaction '+r.status)}
   }
   if(shots){await fs.mkdir(shots,{recursive:true});await fs.writeFile(path.join(shots,'layout-evidence.json'),JSON.stringify({...evidence,errors,failed},null,1)+'\n')}
  }finally{
   if(browser)await browser.close();assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('omf-layout-chrome-'));await fs.rm(directory,{recursive:true,force:true});
  }
 }
 assert.deepEqual(errors,[],'layout:no-runtime-or-cleanup-errors');
 assert.deepEqual(failed,[],'layout: '+failed.length+' group(s) failed: '+failed.join(' | '));
};
