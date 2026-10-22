// Closed Navi status and exact reply read state, shared by the server status service and the browser composables
// (docs/navi-status-read-state.md). Pure functions only: no I/O, no reply text, no financial values.
export const NAVI_STATUS_POLL_MS=4000
export const NAVI_READ_LIMIT=50
const TURN_ID=/^[-_.:a-zA-Z0-9]{1,100}$/,OBJECT_ID=/^[a-f0-9]{24}$/i,REQUEST_ID=/^[a-f0-9-]{36}$/
const version=v=>Number.isSafeInteger(v)&&v>0?v:0
const seenVersion=v=>Number.isSafeInteger(v)&&v>=0?v:-1
// A turn's delivered reply version: 1+ once a native writer saved a readable reply in its lease-checked write; 0 is a legacy reply
// saved before versions existed (unknown, never a new arrival).
export const naviReplyVersion=turn=>version(turn?.replyVersion)
// The highest version this actor's visible chat acknowledged; -1 is no read record (a legacy turn differs from one seen at 0).
export const naviSeenReplyVersion=turn=>seenVersion(turn?.seenReplyVersion)
export const naviReportVersion=research=>version(research?.reportVersion)
export const naviSeenResearchVersion=turn=>seenVersion(turn?.seenResearchVersion)
// A live reply readable in this view: a saved proposal on a turn that is not withheld for another company's teachings.
export const naviReadable=turn=>!!turn&&typeof turn==='object'&&!turn.withheld&&!!turn.proposal&&typeof turn.proposal==='object'
// Work under a native deadline: a reply being written or a research job (working, held by a worker's claim), the draft save after
// the owner's confirmation (confirming) and a report being applied (applying). Read from the deadline the native writers set (claim,
// heartbeat renewal, the confirm/apply lock) and the claim count, never the lease itself. 'active' while the deadline is ahead (the
// native finish and renewal accept only that); 'expired' once it passed (the next claim of a live worker may take the work over);
// 'exhausted' once it passed after the last claim the native claims allow (NAVI_CLAIM_LIMIT, as in claimAssistant,
// claimCompanyAssistant, claimChat and claimResearch: their next claim records a failure); 'missing' when such a state has no
// deadline at all (no claim takes it over). Null outside these states. Only 'active' is shown as progress; an expired deadline is not
// proof that an effect failed or must repeat, and status never sweeps, recovers, renews or writes it.
export const NAVI_CLAIM_LIMIT=2
export function naviWorkState(state,leaseUntil,attempts,now=Date.now()){
 if(!['working','confirming','applying'].includes(state))return null
 const deadline=leaseUntil instanceof Date?leaseUntil.getTime():typeof leaseUntil==='string'&&leaseUntil?Date.parse(leaseUntil):NaN
 if(!Number.isFinite(deadline))return 'missing'
 if(deadline>now)return 'active'
 return state==='working'&&Number.isSafeInteger(attempts)&&attempts>=NAVI_CLAIM_LIMIT?'exhausted':'expired'
}
// Counts over the live (already masked) turns of one conversation segment: delivered versions not yet seen, readable replies and
// legacy replies with neither a version nor a read record.
export function naviTurnSummary(turns){
 let unread=0,readable=0,legacyUnknown=0,latestUnread=null
 for(const t of Array.isArray(turns)?turns:[]){
  if(!naviReadable(t))continue
  readable++
  const v=naviReplyVersion(t),s=naviSeenReplyVersion(t)
  if(v>=1){if(s<v){unread++;latestUnread={turnId:String(t.id),replyVersion:v}}}
  else if(s<0)legacyUnknown++
 }
 return {unread,latestUnread,readable,legacyUnknown}
}
// The current research request is a chat message only while a live, visible turn of this segment started it; any other report (a
// manual request, a previous segment, a withheld turn) stays a research-page record. The newest linking turn is searched first.
export function naviLinkedResearch(turns,research){
 if(!research||typeof research.requestId!=='string'||!research.requestId)return null
 const list=Array.isArray(turns)?turns:[]
 let turn=null
 for(let i=list.length-1;i>=0&&!turn;i--){const t=list[i];if(t&&!t.withheld&&t?.research?.requestId===research.requestId)turn=t}
 if(!turn)return null
 const available=typeof research.report?.summary==='string',reportVersion=naviReportVersion(research)
 return {id:String(research._id??research.id),requestId:research.requestId,reportVersion,state:String(research.state||''),turnId:String(turn.id),available,unread:available&&reportVersion>=1&&naviSeenResearchVersion(turn)<reportVersion}
}
// The acknowledgement body: the exact conversation segment and the reply/report versions the client rendered. Nothing else is
// accepted (no actor, company, purchase or text): those come from the authenticated request and the server's own records.
export function naviReadRequest(body,options={}){
 const bad=reason=>{throw Object.assign(Error('Invalid read acknowledgement: '+reason),{naviRead:true})}
 if(!body||typeof body!=='object'||Array.isArray(body))bad('body')
 if(Object.keys(body).some(k=>!['conversationId','segment','replies','research'].includes(k)))bad('keys')
 if(typeof body.conversationId!=='string'||!OBJECT_ID.test(body.conversationId))bad('conversation')
 if(!Number.isSafeInteger(body.segment)||body.segment<0)bad('segment')
 let replies=[]
 if(body.replies!==undefined){
  if(!Array.isArray(body.replies)||!body.replies.length||body.replies.length>NAVI_READ_LIMIT)bad('replies')
  replies=body.replies.map(r=>{if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==2||typeof r.turnId!=='string'||!TURN_ID.test(r.turnId)||!Number.isSafeInteger(r.replyVersion)||r.replyVersion<0)bad('reply');return {turnId:r.turnId,replyVersion:r.replyVersion}})
  if(new Set(replies.map(r=>r.turnId)).size!==replies.length)bad('duplicate reply')
 }
 let research=null
 if(body.research!==undefined){
  const r=body.research
  if(options.research!==true||!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==4||typeof r.researchId!=='string'||!OBJECT_ID.test(r.researchId)||typeof r.requestId!=='string'||!REQUEST_ID.test(r.requestId)||!Number.isSafeInteger(r.reportVersion)||r.reportVersion<0||typeof r.turnId!=='string'||!TURN_ID.test(r.turnId))bad('research')
  research={researchId:r.researchId,requestId:r.requestId,reportVersion:r.reportVersion,turnId:r.turnId}
 }
 if(!replies.length&&!research)bad('empty')
 return {conversationId:body.conversationId,segment:body.segment,replies,research}
}
// The browser's status key: realm, actor, the token-selected company (the company conversation, or the owner masking view) and the
// purchase. A token refresh keeps the key; a different actor, company, realm or purchase is a different key.
export function naviStatusKey(target){
 if(!target)return ''
 const base=[String(target.realm||''),String(target.actorId||''),String(target.organizationId||'')]
 return JSON.stringify(target.realm==='purchase'?[...base,String(target.importId||''),Number(target.line)]:base)
}
// A status response belongs to the request target only when the server echoes the same realm, actor, company conversation and
// purchase (the owner masking company is the server-checked selection and may be null for a stale token selection).
export function naviStatusMatches(status,target){
 if(!status||!target||status.realm!==target.realm)return false
 const scope=status.scope||{}
 if(String(scope.actorId||'')!==String(target.actorId||''))return false
 if(target.realm==='company')return String(scope.organizationId||'')===String(target.organizationId||'')
 return target.realm!=='purchase'||(String(scope.importId||'')===String(target.importId||'')&&Number(scope.line)===Number(target.line))
}
// The closed launcher's indicator from server facts only: new replies (delivered versions not yet seen), a final reply that failed,
// queued, working or interrupted replies, a worker that must reconnect, linked research in progress, interrupted or failed, or a status
// that could not be read. Null is nothing to report (no indicator). Legacy replies never count as new; no percentage is invented. Progress is shown only
// for work under a live deadline (naviWorkState 'active'). An expired reply waits for a live worker's claim to take it over (or for
// the connection); an exhausted or deadline-less reply or research job, and an interrupted confirmation or report apply, point to the
// open chat, whose existing getters recover the confirmation/apply and show the native outcome. A reply's state says nothing about
// the outcome of its actions; their receipts stay in the chat.
export function naviIndicator(status,unknown=false){
 if(unknown)return {kind:'unknown',label:'状態を確認できません',short:'状態不明',count:0}
 if(!status)return null
 const count=(status.replies?.unread||0)+(status.research?.unread?1:0)
 if(count>0)return {kind:'new',label:'新しい回答 '+count+'件',short:'新着 '+count,count}
 const state=status.conversation?.state,work=status.conversation?.work,research=status.research?.state,researchWork=status.research?.work
 const reconnect={kind:'reconnect',label:'メッセージは保存済みです。AIへの接続が戻ると続けます',short:'接続待ち',count:0}
 const interrupted=(label,short)=>({kind:'interrupted',label,short,count:0})
 if(state==='failed')return {kind:'failed',label:'回答を取得できませんでした（もう一度取得できます）',short:'要再試行',count:0}
 if(state==='queued')return status.connected?{kind:'queued',label:'AIの受付を待っています',short:'受付待ち',count:0}:reconnect
 if(state==='working'){
  if(work==='active')return status.connected?{kind:'working',label:'回答を作成しています',short:'回答中',count:0}:reconnect
  if(work==='expired')return status.connected?interrupted('回答の作成が中断されました。AIが引き継ぐのを待っています','中断'):reconnect
  return interrupted('回答の作成が止まっています。会話を開いて確認してください','中断')
 }
 if(state==='confirming')return work==='active'?{kind:'working',label:'下書きへの反映を確認しています',short:'確認中',count:0}:interrupted('下書きへの反映の結果を確認できません。会話を開くと確認します','要確認')
 if(research==='queued')return {kind:'queued',label:'調査の受付を待っています',short:'調査待ち',count:0}
 if(research==='working'){
  if(researchWork==='active')return {kind:'working',label:'調査しています',short:'調査中',count:0}
  return interrupted(researchWork==='expired'?'調査が中断されました。調査担当の再開を待っています':'調査が止まっています。会話を開いて確認してください','調査中断')
 }
 if(research==='applying'&&researchWork!=='active')return interrupted('調査結果の反映の結果を確認できません。会話を開くと確認します','要確認')
 if(research==='failed')return {kind:'failed',label:'調査を完了できませんでした',short:'調査失敗',count:0}
 return null
}
// Data attributes on a live reply's own text element (never the avatar, header, history, memory or source detail): the exact
// versions the element renders, read back by the visibility check when it posts an acknowledgement.
export function naviReplyMark(turn){
 return naviReadable(turn)?{'data-navi-reply':'turn','data-navi-turn':String(turn.id),'data-navi-version':String(naviReplyVersion(turn)),'data-navi-seen':String(naviSeenReplyVersion(turn))}:{}
}
export function naviResearchMark(research,turns){
 const linked=naviLinkedResearch(turns,research)
 if(!linked||!linked.available)return {}
 const turn=(Array.isArray(turns)?turns:[]).find(t=>String(t?.id)===linked.turnId)
 return {'data-navi-reply':'research','data-navi-research':linked.id,'data-navi-request':linked.requestId,'data-navi-turn':linked.turnId,'data-navi-version':String(linked.reportVersion),'data-navi-seen':String(naviSeenResearchVersion(turn))}
}
