// Keep this function self-contained: it also runs inside the real Sheets browser.
export function matchSheetRows(rows,{terms,purchaseDate,windowed=true,exportMode,range}) {
 const day=Date.parse(purchaseDate),bounded=range==='A1:AZ50000';
 if(windowed&&(!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==purchaseDate))throw Error('Invalid purchase date');
 const normalize=v=>String(v).normalize('NFKC').toLowerCase().replace(/[ ,\t]/g,''),normalized=terms.map(normalize),matches=[];let count=0;
 const near=value=>{const m=String(value).match(/(\d{4})[年/.-]\s*(\d{1,2})[月/.-]\s*(\d{1,2})/);if(!m)return false;const year=Number(m[1]),month=Number(m[2]),dayOfMonth=Number(m[3]),at=Date.UTC(year,month-1,dayOfMonth),d=new Date(at);return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===dayOfMonth&&Math.abs(at-day)<=7*86400000};
 for(let i=0;i<rows.length;i++){if(!normalized.every(t=>normalize(rows[i].join(' | ')).includes(t))||windowed&&!rows[i].some(near))continue;count++;if(matches.length<25)matches.push({row:i+1,values:rows[i]})}
 const limitation=exportMode==='google_query_csv'?'Google query export may omit values with a different type from their column. Empty cells and no matches do not prove absence in the original sheet. Row positions refer to this export; verify identifiers in the source sheet.':'';
 const coverage={version:1,terms,matchMode:'all_terms',range,dateWindow:windowed?{from:new Date(day-7*86400000).toISOString().slice(0,10),through:new Date(day+7*86400000).toISOString().slice(0,10),dateMatch:'any_parseable_date_cell'}:null,returnedCount:matches.length,rowLimitReached:bounded&&rows.length>=50000,absenceProven:false,limitations:['Keyword matches cover only the requested terms, not every possible purchase description.',...(windowed?['Rows without a parseable date in the requested window are excluded.']:[]),...(bounded?['Only columns A through AZ and the first 50000 rows were requested.']:[]),...(limitation?[limitation]:[])]};
 const result={exportMode,limitation,coverage,firstRows:rows.slice(0,3),matches,matchCount:count,truncated:count>matches.length,windowDays:windowed?7:null,totalRows:rows.length};
 while(JSON.stringify(result).length>8000&&matches.length){matches.pop();result.truncated=true;coverage.returnedCount=matches.length}
 while(JSON.stringify(result).length>8000&&result.firstRows.length)result.firstRows.pop();
 if(result.truncated)coverage.limitations.push('Some matching rows were omitted from the returned evidence.');
 return result;
}
