import XLSX from 'xlsx';
export const ownerId='111111111111111111111111',accountId='222222222222222222222222',customerId='333333333333333333333333';
export function fixture(overrides={}) {
 const headers=['日付','区別','金額','顧客','支払い方法','カード番号','仕入れ先','区分','備考','','番号'];
 const row=(label,card='Test card',flow='支出')=>[44294,flow,1234,label,'カード',card,'Synthetic shop','商品代金','Memo','Unlabelled legal name',4548296520346];
 const ws=XLSX.utils.aoa_to_sheet([headers,row('Alias'),row('Alias'),row('Customer code','Sub card'),row('Alias'),row('Alias'),row('Alias'),row('Other'),row(''),row('個人'),row('法人','Other card'),row('Alias','Test card','入金'),['bad date','支出',1,'Alias','カード','Test card','Synthetic shop']]);
 for(let i=2;i<=12;i++) ws['A'+i].z='m/d/yy';
 ws.K2.z='0.0000E+00';ws.L2={t:'n',v:2468,f:'C2*2'};ws['!ref']='A1:L13';
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'data');XLSX.utils.book_append_sheet(wb,ws,'archive');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Freeform'],['Preserve this']]),'notes');XLSX.utils.book_append_sheet(wb,{},'empty');
 return {bytes:XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),config:{ownerId,title:'Synthetic learning source',sourceUrl:'https://docs.google.com/spreadsheets/d/synthetic/edit#gid=0',primarySheet:'data',accountBindings:[{accountId,labels:['Test card','Sub card']}],customerAliases:[{customerId,name:'Synthetic customer',labels:['Alias','Customer code']}],...overrides}};
}
