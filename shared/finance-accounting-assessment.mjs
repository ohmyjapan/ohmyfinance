import { normalizeMerchant } from './finance-draft.mjs';
const guide = { title: '弥生：通信費・クラウド利用料・発送費', url: 'https://www.yayoi-kk.co.jp/kaikei/oyakudachi/communication-cost/', checkedAt: '2026-09-12' };
const accountsGuide = { title: '弥生：勘定科目の選び方', url: 'https://www.yayoi-kk.co.jp/kaikei/oyakudachi/kanjokamoku/', checkedAt: '2026-09-12' };
const find = (refs, key, id) => (refs[key] || []).find(r => String(r._id || r.id) === String(id));
const cloud = /^(?:heroku(?:[ *]|$)|ngrok(?:[ .]|$)|mongodb ?cloud(?:[ *]|$)|claude\.ai subscription(?:[ *]|$)|fly\.io(?:[ *]|$)|(?:illustrator )?adobe(?:[ *]|$))/;
const extendedCloud = /^(?:anthropic\* claude sub(?:scription)?(?:[ *]|$)|アドビ(?:\(株\)|株式会社)(?:[ ]|$)|digitalocean\.com(?:[ *]|$))/;
const telephone = /^(?:(?:\[btob\] *)?03plus|hisモバイル)(?:[ ]|$)/;
const parking = /^(?:三井のリパーク|関西国際空港 駐車場)/, insurance = /^東京海上日動(?:火災保険)?(?:[ ]|$)/;
const entertainment = /^(?:楽天ペイ )?カラオケラウンジ/, resaleStore = /^(?:ブックオフ(?:総合リユースストア)?|bookoff)(?:[ ?]|$)/;
const streaming = /^spotify(?:[ *]|$)/, shipping = /^(?:ヤマト運輸|yamato)(?:[ *]|$)/;
// Advisory accounting review. Descriptors identify a service family, never the actual use,
// tax treatment or a verified invoice. No selected value is changed by this function.
export function assessPurchaseAccounting(draft, references = draft.references || {}) {
  const v = draft.values || {}, source = draft.source || {}, merchant = normalizeMerchant(source.description);
  const account = find(references, 'accountCategories', v.accountCategoryId), sub = find(references, 'accountCategories', v.subAccountCategoryId), category = find(references, 'transactionCategories', v.transactionCategoryId);
  const selected = { account: account?.name || '', subsidiary: sub?.name || '', classification: category?.name || source.category || '' };
  const history = (draft.purchaseHistory?.examples || []).filter(e => e && typeof e.accountName === 'string').slice(0,5).map(e => ({ date:e.date, account:e.accountName, subsidiary:e.subAccountName || '' }));
  let rule = '', status = 'unassessed', reason = '', question = '', alternatives = [], sources = [], categoryConcern = false;
  if (source.kind === 'expense') {
    if (cloud.test(merchant) || extendedCloud.test(merchant)) {
      rule = 'cloud-service'; sources = [guide];
      if (v.purpose === 'company') {
        alternatives = ['通信費','支払手数料','システム利用料'];
        categoryConcern = ['商品代金','상품대금','商品仕入','仕入高'].includes(selected.classification);
        const acceptable = !!account && account.isActive !== false && !account.parentId && account.type === 'expense' && alternatives.includes(account.name);
        status = acceptable && !categoryConcern ? 'consistent' : selected.account || history.some(e=>e.account==='仕入高') || categoryConcern ? 'review' : 'candidate';
        reason = 'クラウド・ソフトウェア提供元の表記と会社経費の分類があります。社内業務で使うサービスの継続利用料なら通信費が候補です。買い切りライセンスや機器代は別途検討します。契約内容と会社の継続した方針により、支払手数料・システム利用料も選べます。仕入高は用途との再照合が必要です。';
        if (categoryConcern) reason += ' 区分も商品代金となっているため、サービス利用という内容との整合を確認します。';
        if (acceptable && !categoryConcern) reason = '選択した科目は、社内業務で使うサービスの処理として選べる範囲です。会社の継続した方針を尊重します。契約内容・業務利用・税処理の確認を代替する評価ではありません。';
      } else { status = 'review'; reason = 'サービス名は確認できますが、社内利用か顧客への提供かで処理の検討が変わります。カード・過去の選択だけでは用途を決めません。'; question = 'このサービスは社内業務用ですか、それとも顧客への提供分ですか？'; }
    } else if (telephone.test(merchant)) {
      rule = 'telephone-service'; sources = [guide];
      reason = '電話サービスの利用先表記です。会社の回線・通話料金なら通信費が候補です。端末購入代や別サービスが含まれる場合は明細を分けて検討します。利用先だけで請求内容・税率は確定しません。';
      if (v.purpose === 'company') {
        alternatives = ['通信費']; categoryConcern = ['商品代金','상품대금','商品仕入','仕入高'].includes(selected.classification);
        const acceptable = account?.name === '通信費' && account.isActive !== false && !account.parentId && account.type === 'expense';
        status = acceptable && !categoryConcern ? 'consistent' : selected.account || categoryConcern ? 'review' : 'candidate';
      } else { status = 'review'; question = '会社の業務回線の利用料ですか、それとも顧客分・その他の支払ですか？'; }
    } else if (parking.test(merchant)) {
      rule = 'parking-use'; status = 'review'; sources = [{title:'弥生：駐車場代の科目と利用目的',url:'https://www.yayoi-kk.co.jp/kaikei/oyakudachi/chushajodai-kanjokamoku/',checkedAt:'2026-09-12'}];
      reason = '営業・出張時の一時利用なら旅費交通費、事業用の月極契約なら地代家賃が候補です。車両費でまとめる継続した方針などもあり、駐車場名や空港という場所だけでは決めません。';
      question = '何の業務で使った駐車場ですか？一時利用か月極契約かも確認してください。';
    } else if (insurance.test(merchant)) {
      rule = 'insurance-coverage'; status = 'review'; sources = [{title:'弥生：事業用資産の損害保険料',url:'https://support.yayoi-kk.co.jp/business/faq_Subcontents.html?page_id=1271',checkedAt:'2026-09-12'}];
      reason = '保険会社の表記です。事業用資産の損害保険なら保険料が候補ですが、契約の種類・対象・期間を確認します。翌期以降の保障分は前払費用などの検討が必要です。過去の未確定勘定は処理済みの根拠になりません。';
      question = '何を対象にした保険で、保障期間はいつからいつまでですか？';
    } else if (entertainment.test(merchant)) {
      rule = 'entertainment-purpose'; status = 'review'; sources = [{title:'弥生：法人の接待交際費と利用目的',url:'https://support.yayoi-kk.co.jp/business/faq_Subcontents.html?page_id=1153',checkedAt:'2026-09-12'}];
      reason = 'カラオケラウンジの表記です。取引先の接待なら交際費が候補ですが、従業員向けの行事・私用では判断が変わります。支払金額や過去の会社経費という分類だけでは確定しません。';
      question = '誰と、どのような仕事上の目的で利用しましたか？';
    } else if (resaleStore.test(merchant)) {
      rule = 'retail-purchase-use'; status = 'review'; sources = [accountsGuide];
      reason = 'リユース店では複数の種類の商品を扱うため、店舗名から購入品を決めません。品目・金額・事業上の使い道を確認してから科目を検討します。';
      question = v.productName?.trim() ? '記録した購入品は、会社や顧客のためにどのように使いますか？' : '購入した品物と、会社や顧客のための使い道を教えてください。';
    } else if (streaming.test(merchant)) {
      rule = 'music-streaming'; status = 'review'; sources = [guide];
      reason = '音楽配信サービスの表記です。通信費は業務利用の場合の候補ですが、会社経費という過去の分類だけでは実際の利用目的を確認できません。';
      question = 'この利用料の業務上の使い道を教えてください。私用・混在ならその点も記録してください。';
    } else if (shipping.test(merchant)) {
      rule = 'shipping-purpose'; status = 'review'; sources = [guide,{title:'弥生：商品発送時の運賃',url:'https://www.yayoi-kk.co.jp/kaikei/oyakudachi/shiwakedaizenshu/example-130/',checkedAt:'2026-09-12'}];
      reason = '発送する商品の運賃は荷造運賃、業務書類の送付は通信費が候補です。仕入に伴う送料や顧客の立替分は別途検討します。利用先が配送会社であることだけでは決められません。';
      question = '販売商品の発送・仕入時の送料・書類送付・顧客の立替のどれですか？';
    } else if (v.purpose === 'company' && selected.account === '仕入高') {
      rule = 'company-purchase-account'; status = 'review'; sources = [accountsGuide];
      reason = '会社経費という用途と、販売する商品の購入に使う仕入高の組み合わせを再検討します。実際の購入目的を優先します。';
      question = '販売用の商品ですか、それとも会社で使う物・サービスですか？';
    }
  }
  const key = rule ? JSON.stringify([1,draft.importId || '',draft.line || 0,draft.sourceHash || '',rule,source.kind,merchant,source.purchaseDate || '',source.amount || 0,v.purpose || '',v.customerId || '',v.accountCategoryId || '',v.subAccountCategoryId || '',v.transactionCategoryId || '',v.productName || '',selected]) : '';
  const choices = v.purpose === 'company' && ['cloud-service','telephone-service'].includes(rule) && !(account && account.isActive !== false && !account.parentId && account.type === 'expense' && alternatives.includes(account.name))
    ? alternatives.flatMap(name => { const matches = (references.accountCategories || []).filter(a => a.name === name && a.type === 'expense' && a.isActive !== false && !a.parentId); return matches.length === 1 ? [{ id:String(matches[0]._id || matches[0].id), name }] : []; }).filter(a => /^[a-f0-9]{24}$/.test(a.id) && a.id !== v.accountCategoryId) : [];
  const saved = draft.accountingResponse;
  const response = key && saved?.key === key && typeof saved.note === 'string' && saved.note.trim() ? { note:saved.note, at:saved.at || null } : null;
  return { version:1,key,rule,status:response ? 'reason_recorded' : status,baseStatus:status,needsAttention:status==='review' && !response,label:response ? '判断理由を記録済み' : ({unassessed:'会計評価の対象外',consistent:'科目の選択肢と整合',review:'会計上の再検討',candidate:'会計処理の候補'})[status],selected,history,reason,question:response ? '' : question,alternatives,choices,sources,categoryConcern,response };
}

// Selecting a displayed candidate is a local edit; the existing draft save/approval path owns persistence.
export function applyAccountingChoice(values, assessment, id) {
  if (!assessment.choices?.some(choice => choice.id === id)) return false;
  values.accountCategoryId = id; values.subAccountCategoryId = ''; return true;
}
