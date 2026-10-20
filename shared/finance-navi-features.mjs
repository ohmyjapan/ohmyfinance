// OMF Navi feature catalogue: every real page group, mapped from pages/ and the sidebar, with what Navi can truthfully do there.
//   navi_tool    — the company conversation has named tools for this feature (listed in tools).
//   page_handoff — the page itself provides the feature; Navi can only point the user to it (it has no adapter).
//   unsupported  — Navi deliberately never links or acts here; reason says why. The page may still exist.
// Routes are fixed local paths. Navi never builds a URL from model or user text, never adds tokens, query strings or another
// company; a record route only takes a server-checked company record id.
import {validateCompanyCitations} from './finance-company-public-research.mjs';
const f=(id,group,label,labelKo,route,disposition,reason,source,extra={})=>Object.freeze({id,group,label,labelKo,route,disposition,reason,source,...extra});
const transactionTools=['list_company_transactions','get_company_transaction','list_company_transaction_choices','update_company_transaction','create_company_transaction','delete_company_transaction','find_company_transaction_patterns'];
const summaryTools=['get_company_finance_summary','get_company_profile'];
export const naviFeatures=Object.freeze([
 f('dashboard','dashboard','ダッシュボード','대시보드','/','navi_tool','選択中の会社の集計・最近の取引を表示します。Navi は保存済みの記録を通貨・種類・状態ごとに分けた期間集計と会社情報を読み取れます。画面の合計とは計算が異なることがあり、銀行残高ではありません。','pages/index.vue',{tools:summaryTools}),
 f('transactions','transactions','取引一覧','거래 목록','/transactions','navi_tool','会社の取引を読み取り、明示された指示で手入力の取引を作成・編集・削除し、同じ店の過去の分類を比較できます。カード取込・帳簿転記の行は削除しません。転記・証憑確認はできません。','pages/transactions/index.vue',{tools:transactionTools,recordRoute:'/transactions/:transactionId',recordSource:'pages/transactions/[id].vue'}),
 f('transaction-import','transactions','取引のインポート','거래 가져오기','/transactions/import','page_handoff','ファイルからの取引取込は画面で行います。Navi は取込を実行しません。','pages/transactions/import.vue'),
 f('transaction-upload','transactions','データのアップロード','데이터 업로드','/transactions/upload','page_handoff','明細ファイルのアップロードは画面で行います。','pages/transactions/upload.vue'),
 f('duplicates','transactions','重複の確認','중복 확인','/transactions/duplicates','page_handoff','重複候補の確認と整理は画面で行います。Navi は削除しません。','pages/transactions/duplicates.vue'),
 f('transaction-export','transactions','取引のCSV出力','거래 CSV 내보내기','/transactions','page_handoff','取引一覧の「エクスポート」ボタンで CSV を出力します。Navi はファイルを作成しません。','pages/transactions/index.vue'),
 f('mapping','mapping','明細マッピング','명세 매핑','/mapping','page_handoff','カード明細の分類確認は画面とその画面の Navi 会話で行います。この会社会話からは編集できません。','pages/mapping.vue'),
 f('mapping-drafts','mapping','取引の下書き','거래 초안','/mapping','page_handoff','下書きは明細マッピングの行から開きます。「この購入について」の会話で項目を保存できます。','pages/mapping-draft/[importId]/[line].vue'),
 f('learning','learning','学習ノート','학습 노트','/learning','page_handoff','明細マッピング用の学習ノートです。この会社会話で覚えた内容は Navi の「記憶」に別に保存されます。','pages/learning.vue'),
 f('connections','connections','カード連携','카드 연동','/connections','page_handoff','カード会社との接続と明細の取得は画面で行います。Navi は認証情報を扱いません。','pages/connections.vue',{sensitive:true}),
 f('collector-connect','connections','コレクターの接続','수집기 연결','/collector-connect','page_handoff','明細を取得するコレクターの接続設定です。鍵や認証は本人が画面で扱います。','pages/collector-connect.vue',{sensitive:true}),
 f('collector-approval','connections','コレクターの承認','수집기 승인',null,'unsupported','承認メールのリンクから開く専用画面です。Navi はリンクを作りません。','pages/collector-approval.vue',{sensitive:true}),
 f('intake','intake','購入受付','구매 접수','/intake','page_handoff','購入受付の作成・取込はその画面の Navi 会話か画面操作で行います。この会社会話からは編集できません。','pages/intake/index.vue',{recordSource:'pages/intake/[id].vue'}),
 f('intake-payments','intake','支払い照合','지불 대조','/intake/payments','page_handoff','受付と支払いの照合は画面で行います。','pages/intake/payments.vue'),
 f('invoices','invoices','請求書','청구서','/invoices','navi_tool','会社の請求書を読み取り、明示された指示で作成・編集（取引先・明細・振込先・税率・日付など）・削除できます。明示された指示で請求書から入金予定を1件だけ作成し、その紐付けと作成時の内容との違いを読み取れます（自動同期・入金確認ではありません）。送信・メール配信はしません。印刷用プレビューは画面で開き、ブラウザの印刷から PDF に保存します。','pages/invoices/index.vue',{tools:['list_company_invoices','get_company_invoice','update_company_invoice','create_company_invoice','delete_company_invoice','get_company_invoice_calendar','schedule_company_invoice_payment']}),
 f('calendar','calendar','支払いカレンダー','지불 캘린더','/calendar','navi_tool','会社の支払い予定を読み取り、明示された指示で予定を追加・編集・削除できます。カード会社の請求は削除せず非表示にします。請求書の入金予定は明示された指示で1件だけ作成し、既存の予定は上書きしません。送金・銀行への指示・入金の確認はできません。','pages/calendar/index.vue',{tools:['list_company_calendar_entries','get_company_calendar_entry','update_company_calendar_entry','create_company_calendar_entry','delete_company_calendar_entry','get_company_invoice_calendar','schedule_company_invoice_payment']}),
 f('receipts','receipts','領収書管理','영수증 관리','/receipts','navi_tool','Navi は保存済みの領収書の店名・日付・金額・税・読み取った明細と紐付けを読み取れます。読み取り結果は検証済みの購入ではありません。アップロード・OCR・紐付け・削除・CSV出力は画面で行います。','pages/receipts/index.vue',{tools:['list_company_receipts','get_company_receipt']}),
 f('receipt-upload','receipts','領収書のアップロード','영수증 업로드','/receipts/upload','page_handoff','領収書ファイルのアップロードは画面で行います。','pages/receipts/upload.vue'),
 f('vendors','parties','取引先','거래처','/vendors','page_handoff','取引先の登録・編集は画面で行います。','pages/vendors/index.vue'),
 f('settings','settings','一般設定','일반 설정','/settings','page_handoff','顧客・仕入先・カテゴリなどのマスタ設定は画面で行います。Navi は設定を変更しません。','pages/settings/index.vue'),
 f('organization-settings','settings','組織設定','조직 설정','/settings/organization','page_handoff','メンバーと権限の管理は画面で行います。Navi は会社名・住所・登録番号・通貨・期首月・タイムゾーンを読むだけで、メンバーや権限は読まず変えません。','pages/settings/organization.vue',{sensitive:true}),
 f('organization-switch','settings','会社の作成・参加','회사 생성·참여',null,'unsupported','会社の作成・参加・切替は本人が設定画面で行います。Navi は別の会社へ移動しません。','pages/settings/organization/new.vue, pages/settings/organization/join.vue',{sensitive:true}),
 f('security','settings','セキュリティ','보안','/settings/security','page_handoff','パスワード・二段階認証などは本人が画面で設定します。Navi は認証情報を扱いません。','pages/settings/security.vue',{sensitive:true}),
 f('api-settings','settings','API 設定','API 설정','/settings/api','page_handoff','API キーと連携の設定は本人が画面で行います。Navi はキーを読みません。','pages/settings/api.vue',{sensitive:true}),
 f('templates','settings','取込テンプレート','가져오기 템플릿','/templates','page_handoff','取込テンプレートの管理は画面で行います。','pages/templates/index.vue'),
 f('profile','settings','プロフィール','프로필','/profile','page_handoff','本人のプロフィールは画面で編集します。','pages/profile/index.vue'),
 f('budgets','budgets','予算','예산','/budgets','navi_tool','会社の予算と今期の支出（予算の通貨の完了済み経費）を読み取り、明示された指示で作成・編集・削除できます。','pages/budgets/index.vue',{tools:['list_company_budgets','get_company_budget','create_company_budget','update_company_budget','delete_company_budget']}),
 f('recurring','budgets','定期支払い','정기 지불','/recurring','navi_tool','会社の定期支払いを読み取り、明示された指示で作成・編集・削除し、読み取った回の未確定の予定取引を作成できます。予定は支払いの証明ではありません。','pages/recurring/index.vue',{tools:['list_company_recurring_payments','get_company_recurring_payment','create_company_recurring_payment','update_company_recurring_payment','delete_company_recurring_payment','generate_company_recurring_forecast']}),
 f('analytics','reports','分析','분석','/analytics','navi_tool','分析グラフは画面で確認します。Navi は通貨ごとに分けた期間集計を自分で読み取ります（画面のグラフは通貨を区別しません）。','pages/analytics/index.vue',{tools:summaryTools}),
 f('reports','reports','レポート','리포트','/reports','navi_tool','レポートは画面で作成・確認します。Navi は通貨・種類・状態ごとに分けた期間集計を読み取り、画面の合計値をそのまま助言には使いません。','pages/reports/index.vue',{tools:summaryTools}),
 f('tax-report','reports','税務レポート','세무 리포트','/reports/tax','page_handoff','税務レポートは保存済みの記帳の一覧で、控除可否などの税務判断ではありません。Navi は期間集計の事実を説明できますが、税務の判断は根拠と前提を示した提案にとどめます。','pages/reports/tax.vue'),
 f('purchase-workflow','purchase','購入・輸出の照合','구매·수출 대조','/purchase-workflow','page_handoff','購入・輸出の照合は画面で行います。','pages/purchase-workflow.vue'),
 f('shipments','purchase','配送追跡','배송 추적','/shipments','page_handoff','配送の追跡と詳細は画面で確認します。','pages/shipments.vue',{recordSource:'pages/shipment/[id].vue'}),
 f('research-evaluation','purchase','AI調査の評価','AI 조사 평가','/research-evaluation','page_handoff','AI 調査結果の評価は画面で行います。','pages/research-evaluation.vue'),
 f('audit','audit','監査ログ','감사 로그','/audit','page_handoff','操作の記録は画面で確認します。','pages/audit/index.vue'),
 f('support-report','audit','問題の報告（診断）','문제 보고(진단)',null,'page_handoff','OMF Navi パネル下部の「診断を作成」で診断 JSON を作成します。移動先の画面はありません。','components/finance/SupportReport.vue'),
 f('admin','admin','システム管理','시스템 관리','/admin/users','page_handoff','システム管理者だけが使う画面です。権限は画面側で確認されます。','pages/admin/users/index.vue, pages/admin/organizations/index.vue',{sensitive:true}),
 f('test-uploads','admin','アップロード試験画面','업로드 테스트 화면',null,'unsupported','開発用の試験画面です。業務には使いません。','pages/upload-test.vue, pages/file-upload.vue'),
 f('authentication','admin','ログイン・登録','로그인·가입',null,'unsupported','認証の画面です。Navi は本人確認や別アカウントへの切替をしません。','pages/login.vue, pages/auth/login.vue, pages/auth/register.vue, pages/auth/accept-invite.vue',{sensitive:true})
]);
const byId=new Map(naviFeatures.map(x=>[x.id,x]));
export const naviFeature=id=>typeof id==='string'?byId.get(id)||null:null;
export const naviFeatureNavigable=feature=>!!feature&&feature.disposition!=='unsupported'&&typeof feature.route==='string';
// Search by id, group, Japanese/Korean label or reason text. An empty query returns everything.
export function findNaviFeatures(query){const q=typeof query==='string'?query.normalize('NFKC').toLowerCase().trim():'';if(!q)return [...naviFeatures];return naviFeatures.filter(x=>[x.id,x.group,x.label,x.labelKo,x.reason].some(v=>String(v).normalize('NFKC').toLowerCase().includes(q)))}
// The current path's feature, for page-aware context. Unknown paths have none.
export function naviFeatureForPath(path){
 if(typeof path!=='string')return null;const p=path.split('?')[0].replace(/\/+$/,'')||'/';
 if(/^\/transactions\/[a-f0-9]{24}$/i.test(p))return byId.get('transactions');
 if(p.startsWith('/mapping-draft/'))return byId.get('mapping-drafts');
 if(/^\/shipment\//.test(p))return byId.get('shipments');
 if(/^\/intake\/[a-f0-9]{24}$/i.test(p))return byId.get('intake');
 if(p.startsWith('/admin/'))return byId.get('admin');
 return naviFeatures.find(x=>x.route===p&&x.id!=='transaction-export')||null;
}
// The only way a route leaves this module: a fixed catalogue path, or its record path with a 24-hex company record id.
export function naviFeatureRoute(id,recordId){const x=naviFeature(id);if(!naviFeatureNavigable(x))return null;if(recordId===undefined||recordId===null||recordId==='')return x.route;if(!x.recordRoute||typeof recordId!=='string'||!/^[a-f0-9]{24}$/i.test(recordId))return null;return x.recordRoute.replace(':transactionId',recordId)}
// Owner realm (the legacy owner workspace and purchase chats): which catalogue features the owner's named tools serve. A feature is a
// navi_tool here only for tools the current job actually carries (the intersection), so a narrower job never advertises a tool it
// lacks; company-conversation features (transactions/invoices/calendar) are pages from this realm, and unsupported stays unsupported.
const ownerRealmTools=Object.freeze({
 mapping:['get_mapping','get_draft','save_draft_fields','approve_draft','post_selected_approved_rows','get_purchase_history','get_registered_choices','get_research','start_purchase_research','remember_accounting_fields','remember_customer_purpose'],
 'mapping-drafts':['get_draft','save_draft_fields','apply_referenced_proposal','approve_draft','get_research','start_purchase_research'],
 learning:['set_memory_status'],
 connections:['get_card_sync_status','queue_card_sync','set_card_auto_sync'],
 intake:['list_intake_records','get_intake_record','create_intake_record','patch_intake_record','set_intake_archived','read_intake_sheet','preview_intake_import','apply_intake_import','list_intake_batches','list_intake_templates','save_intake_template','get_intake_research','start_intake_research','confirm_intake_research'],
 'intake-payments':['list_card_payment_matches','get_card_payment_match','get_record_payment_matches','confirm_card_allocation','release_card_allocation','reconfirm_card_allocation'],
 'purchase-workflow':['get_workflow_status','review_workflow_step']
});
const ownerRealmReasons=Object.freeze({
 connections:'割り当てられたカードの取得状況の確認、明細取得の予約、Aplus の自動取得の時刻設定ができます。予約は取得の完了ではありません。認証情報・コレクターの接続は画面で本人が行います。',
 'intake-payments':'割り当てられたカードの支払いと受付の配分を確認し、明示された指示で配分の確定・解除・再確認ができます。銀行明細の取込と銀行の配分は画面で行います。',
 'purchase-workflow':'割り当てられたカードの照合状況を確認し、明示された指示で要確認の工程を再確認に戻す・後で確認にできます。購入の承認・書類の作成は画面と処理ワーカーの結果です。'
});
export function naviRealmFeatures(realm,available,query){
 const have=new Set(Array.isArray(available)?available:[]),features=findNaviFeatures(query);
 if(realm!=='owner')return features.map(x=>({...x,tools:(x.tools||[]).filter(n=>have.has(n))}));
 return features.map(x=>{
  if(x.disposition==='unsupported')return {...x,tools:[]};
  const tools=(ownerRealmTools[x.id]||[]).filter(n=>have.has(n));
  if(tools.length)return {...x,disposition:'navi_tool',tools,reason:ownerRealmReasons[x.id]||x.reason};
  return {...x,disposition:'page_handoff',tools:[],reason:x.disposition==='navi_tool'?'この会社の記録は、その画面の会社の会話で Navi が扱います。この会話からは画面を案内します。':x.reason};
 });
}
// Owner reply link: one fixed catalogue page only (never a record id, a query or another company).
export function validateOwnerNavigation(n){
 if(n===undefined||n===null)return null;
 if(typeof n!=='object'||Array.isArray(n)||Object.keys(n).some(k=>k!=='feature'))throw Error('Invalid navigation');
 const feature=naviFeature(n.feature);if(!naviFeatureNavigable(feature))throw Error('Navigation must name a catalogue feature with a page');
 return {feature:feature.id};
}
// Company reply: an explanation (unclear/defer) with no field patch, up to 4000 characters, at most one catalogue pointer and
// at most eight source citations (source id, literal quote, claim). Citations are only a shape here: the server resolves each one
// against the captured sources of the same owner/company conversation and stores their actual URL/date/kind itself.
export function validateCompanyAssistantReply(input){
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['kind','summary','patch','quotes','navigation','citations'].includes(k))||!['unclear','defer'].includes(input.kind)||typeof input.summary!=='string'||!input.summary.trim()||input.summary.length>4000||!input.patch||typeof input.patch!=='object'||Object.keys(input.patch).length||!input.quotes||typeof input.quotes!=='object'||Object.keys(input.quotes).length)throw Error('A company conversation reply is an explanation without field changes');
 const result={kind:input.kind,summary:input.summary.trim(),patch:{},quotes:{}};
 if(input.citations!==undefined&&input.citations!==null){const citations=validateCompanyCitations(input.citations);if(citations.length)result.citations=citations}
 if(input.navigation!==undefined&&input.navigation!==null){
  const n=input.navigation;
  if(typeof n!=='object'||Array.isArray(n)||Object.keys(n).some(k=>!['feature','transactionId'].includes(k)))throw Error('Invalid navigation');
  const feature=naviFeature(n.feature);if(!naviFeatureNavigable(feature))throw Error('Navigation must name a catalogue feature with a page');
  if(n.transactionId!==undefined&&(!feature.recordRoute||typeof n.transactionId!=='string'||!/^[a-f0-9]{24}$/i.test(n.transactionId)))throw Error('Invalid navigation record');
  result.navigation={feature:feature.id,...(n.transactionId!==undefined?{transactionId:n.transactionId.toLowerCase()}:{})};
 }
 return result;
}
