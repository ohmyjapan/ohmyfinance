import { normalizeMerchant } from './finance-draft.mjs';
const guide = { title: '弥生：通信費・クラウド利用料・発送費', url: 'https://www.yayoi-kk.co.jp/kaikei/oyakudachi/communication-cost/', checkedAt: '2026-09-12' };
const accountsGuide = { title: '弥生：勘定科目の選び方', url: 'https://www.yayoi-kk.co.jp/kaikei/oyakudachi/kanjokamoku/', checkedAt: '2026-09-12' };
const find = (refs, key, id) => (refs[key] || []).find(r => String(r._id || r.id) === String(id));
const cloud = /^(?:heroku(?:[ *]|$)|ngrok(?:[ .]|$)|mongodb ?cloud(?:[ *]|$)|claude\.ai subscription(?:[ *]|$)|fly\.io(?:[ *]|$)|(?:illustrator )?adobe(?:[ *]|$))/;
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
    if (cloud.test(merchant)) {
      rule = 'cloud-service'; sources = [guide];
      if (v.purpose === 'company') {
        alternatives = ['通信費','支払手数料','システム利用料'];
        categoryConcern = ['商品代金','상품대금','商品仕入','仕入高'].includes(selected.classification);
        const acceptable = !!account && account.isActive !== false && !account.parentId && account.type === 'expense' && alternatives.includes(account.name);
        status = acceptable && !categoryConcern ? 'consistent' : selected.account || history.some(e=>e.account==='仕入高') || categoryConcern ? 'review' : 'candidate';
        reason = 'クラウド・ソフトウェア利用料の表記と会社経費の分類があります。社内業務で使うサービスなら通信費が候補です。契約内容と会社の継続した方針により、支払手数料・システム利用料も選べます。仕入高は用途との再照合が必要です。';
        if (categoryConcern) reason += ' 区分も商品代金となっているため、サービス利用という内容との整合を確認します。';
        if (acceptable && !categoryConcern) reason = '選択した科目は、社内業務で使うサービスの処理として選べる範囲です。会社の継続した方針を尊重します。契約内容・業務利用・税処理の確認を代替する評価ではありません。';
      } else { status = 'review'; reason = 'サービス名は確認できますが、社内利用か顧客への提供かで処理の検討が変わります。カード・過去の選択だけでは用途を決めません。'; question = 'このサービスは社内業務用ですか、それとも顧客への提供分ですか？'; }
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
  const saved = draft.accountingResponse;
  const response = key && saved?.key === key && typeof saved.note === 'string' && saved.note.trim() ? { note:saved.note, at:saved.at || null } : null;
  return { version:1,key,rule,status:response ? 'reason_recorded' : status,baseStatus:status,needsAttention:status==='review' && !response,label:response ? '判断理由を記録済み' : ({unassessed:'会計評価の対象外',consistent:'科目の選択肢と整合',review:'会計上の再検討',candidate:'会計処理の候補'})[status],selected,history,reason,question:response ? '' : question,alternatives,sources,categoryConcern,response };
}
