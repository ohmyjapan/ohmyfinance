// Only calendar metadata leaves this reader. It is also installed in the recording frame.
export function inspectDateControl(element,options={}){
  if(options.installAs){
    globalThis[options.installAs]=inspectDateControl;
    return;
  }
  // Prototype getters cannot be shadowed by named form controls. This same reader
  // serves date inspection, the recording overlay and replay submitter resolution.
  const readForm=control=>{
    const form=control?.tagName==='FORM'?control:control?.form;
    if(!form)return null;
    const submitter=['BUTTON','INPUT'].includes(control.tagName)&&['submit','image'].includes(control.type);
    if(options.requireSubmitter&&!submitter)return null;
    const get=name=>Object.getOwnPropertyDescriptor(HTMLFormElement.prototype,name).get.call(form);
    const action=options.submitter&&submitter&&control.hasAttribute('formaction')?control.formAction:get('action');
    const method=options.submitter&&submitter&&control.hasAttribute('formmethod')?control.formMethod:get('method');
    const url=new URL(action,document.baseURI);
    return {origin:url.origin,path:url.pathname,method:method.toUpperCase()};
  };
  if(options.formOnly)return readForm(element);
  const fail=()=>{throw new Error('unsupported-date-control');};
  const format=options.format||'iso';
  const component=['year','month','day'].includes(format);
  const normalize=value=>String(value).normalize('NFKC').trim();
  const number=value=>{
    const text=normalize(value);
    const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
    if(format==='month'){
      const index=months.findIndex(month=>month===text.toLowerCase()||month.slice(0,3)===text.toLowerCase());
      if(index>=0)return index+1;
    }
    const suffix={year:'年',month:'月',day:'日'}[format];
    const plain=suffix&&text.endsWith(suffix)?text.slice(0,-1).trim():text;
    if(!/^\d+$/.test(plain))return null;
    const n=Number(plain);
    if(format==='year')return /^20\d{2}$/.test(plain)?n:null;
    return n>=1&&n<=(format==='month'?12:31)?n:null;
  };
  const whole=value=>{
    const text=normalize(value);
    const iso=format==='compact'?text.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):format==='slash'?text.replaceAll('/','-'):text;
    if(!/^20\d{2}-\d{2}-\d{2}$/.test(iso))return null;
    const date=new Date(iso+'T00:00:00Z');
    return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:null;
  };
  if(!element||!['INPUT','SELECT'].includes(element.tagName))fail();
  if(element.tagName==='INPUT'&&component&&format==='year'&&element.maxLength>=0&&element.maxLength<4)fail();
  let calendarOptions;
  if(element.tagName==='SELECT'){
    if(!component||element.options.length>400)fail();
    calendarOptions=[...element.options].filter(option=>!option.disabled).map(option=>({value:option.value,calendar:number(option.label||option.textContent)})).filter(option=>option.calendar!==null);
    if(options.write!==undefined){
      const matches=calendarOptions.filter(option=>option.calendar===Number(options.write));
      if(matches.length!==1)fail();
      element.value=matches[0].value;
    }
  }else if(options.write!==undefined){
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if(!setter||['password','hidden'].includes(element.type))fail();
    setter.call(element,String(options.write));
  }
  if(options.write!==undefined){
    element.dispatchEvent(new Event('input',{bubbles:true}));
    element.dispatchEvent(new Event('change',{bubbles:true}));
  }
  let calendar;
  if(element.tagName==='SELECT'){
    const selected=element.selectedOptions[0];
    calendar=selected&&!selected.disabled?number(selected.label||selected.textContent):null;
  }else calendar=component?number(element.value):whole(element.value);
  if(calendar===null||calendar===undefined)fail();
  if(options.expected!==undefined&&calendar!==options.expected)throw new Error('date-input-mismatch');
  return {calendar,format,name:element.name,options:calendarOptions,form:readForm(element)};
}

export function sameSubmission(left,right){
  return !!left&&!!right&&left.origin===right.origin&&left.path===right.path&&left.method===right.method;
}

export function calendarPeriod(fields){
  const result={};
  for(const role of ['from','to']){
    const dates=fields.filter(field=>field.role===role);
    if(dates.length===1&&!['year','month','day'].includes(dates[0].format))result[role]=dates[0].calendar;
    else{
      const parts=['year','month','day'].map(part=>dates.filter(date=>date.format===part));
      if(dates.length!==3||parts.some(matches=>matches.length!==1))return null;
      result[role]=parts.map((matches,index)=>String(matches[0].calendar).padStart(index===0?4:2,'0')).join('-');
    }
    const date=new Date(result[role]+'T00:00:00Z');
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==result[role])return null;
  }
  return result.from<=result.to?result:null;
}

// Inspect only named date fields. Headers, other fields and request bytes are never retained.
export function submittedPeriod(request,fields){
  if(fields.some(field=>!field.name)||new Set(fields.map(field=>field.name)).size!==fields.length)return null;
  let values;
  if(request.method==='GET')values=new URL(request.url).searchParams;
  else if(request.method==='POST'&&/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.contentType||'')&&typeof request.body==='string'&&request.body.length<=65536)values=new URLSearchParams(request.body);
  else return null;
  const decoded=[];
  for(const field of fields){
    const entries=values.getAll(field.name);
    if(entries.length!==1)return null;
    const raw=entries[0];
    let calendar;
    if(field.options){
      const matches=field.options.filter(option=>option.value===raw);
      if(matches.length!==1)return null;
      calendar=matches[0].calendar;
    }else if(['year','month','day'].includes(field.format)){
      if(!/^\d+$/.test(raw))return null;
      calendar=Number(raw);
    }else calendar=field.format==='compact'?raw.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):field.format==='slash'?raw.replaceAll('/','-'):raw;
    decoded.push({...field,calendar});
  }
  return calendarPeriod(decoded);
}
