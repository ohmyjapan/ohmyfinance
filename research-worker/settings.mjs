import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {Vault} from '../collector/vault.mjs';
export async function startResearchSettings(directory,config,onChange=async()=>{}) {
 const nonce=randomBytes(32).toString('hex'),vault=new Vault(directory);
 let origin;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+"'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  if(req.url!=='/setup/'+nonce||req.headers.host!==new URL(origin).host){res.writeHead(404);res.end();return}
  if(req.method==='POST'){
   if(req.headers.origin!==origin||req.headers['content-type']!=='application/json'){res.writeHead(403);res.end();return}
   try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>1000)throw Error()}
    const data=JSON.parse(body);if(!/^[0-9]{13}$/.test(data.applicationId||''))throw Error();
    const saved=await vault.update(current=>({...current,ntaApplicationId:data.applicationId}));
    Object.assign(config,saved);await onChange();res.setHeader('Content-Type','application/json');res.end('{"saved":true}');
   }catch{res.writeHead(400,{'Content-Type':'application/json'});res.end('{"saved":false}')}
   return;
  }
  if(req.method!=='GET'){res.writeHead(405);res.end();return}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>調査の接続設定 | OhMyFinance</title><style>body{font:15px system-ui,sans-serif;background:#f6f7f9;color:#243240;margin:0;padding:32px 18px}main{max-width:540px;margin:6vh auto;background:white;border:1px solid #e5e7eb;border-radius:18px;padding:28px}h1{font-size:22px}p{line-height:1.7;color:#617080}label{display:block;font-size:13px;margin:24px 0 8px}input,button{box-sizing:border-box;width:100%;border-radius:10px;padding:13px;font:inherit}input{border:1px solid #ccd2d8}button{margin-top:16px;background:#17685b;color:white;border:0;cursor:pointer}a{color:#17685b;font-size:13px}.status{font-size:13px}</style><main><p class="status">OhMyFinance · 調査の接続設定</p><h1>国税庁の登録情報を照合する</h1><p>インボイスWeb-APIの利用が承認されたアプリケーションIDを登録してください。IDはこの端末の暗号化された保存領域に保管します。</p><p class="status">'+(config.ntaApplicationId?'接続情報は設定済みです。変更する場合だけ入力してください。':'接続情報は未設定です。会社調査や資料の確認は利用できます。')+'</p><form id="form"><label for="id">アプリケーションID（13桁）</label><input id="id" type="password" inputmode="numeric" maxlength="13" pattern="[0-9]{13}" autocomplete="off" required><button>接続情報を保存</button></form><p id="status" role="status"></p><a href="https://www.invoice-kohyo.nta.go.jp/web-api/index.html" target="_blank" rel="noopener noreferrer">国税庁の利用手続きを確認 ↗</a></main><script nonce="'+nonce+'">document.getElementById("form").addEventListener("submit",async e=>{e.preventDefault();const input=document.getElementById("id"),status=document.getElementById("status");status.textContent="保存中…";try{const r=await fetch(location.pathname,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({applicationId:input.value})});if(!r.ok)throw Error();input.value="";status.textContent="保存しました。OMFから登録情報を照合できます。"}catch{status.textContent="保存できませんでした。13桁のIDを確認してください。"}})</script></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 return {url:origin+'/setup/'+nonce,close:()=>server.close()};
}
