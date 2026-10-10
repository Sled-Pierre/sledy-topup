'use strict';
/* Sledy Top-Up payment server. No dependencies. Needs Node 18+.  Run: node server.js */
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');

/* ---- tiny .env loader ---- */
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){
  const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}catch(e){}
const E=process.env;
const PORT=+E.PORT||8787,ORIGIN=E.ALLOWED_ORIGIN||'',ADMIN=E.ADMIN_TOKEN||'';
const MODE=E.MONCASH_MODE==='live'?'live':'sandbox';
const MC={id:E.MONCASH_CLIENT_ID||'',secret:E.MONCASH_CLIENT_SECRET||'',
  api:E.MONCASH_API_BASE||(MODE==='live'?'https://moncashbutton.digicelgroup.com/Api':'https://sandbox.moncashbutton.digicelgroup.com/Api'),
  gw:E.MONCASH_GATEWAY_BASE||(MODE==='live'?'https://moncashbutton.digicelgroup.com/Moncash-middleware':'https://sandbox.moncashbutton.digicelgroup.com/Moncash-middleware')};
const FEES={MonCash:+E.FEE_MONCASH||0,Natcash:+E.FEE_NATCASH||0};
const MINREC=+E.MIN_RECHARGE||150;
const METHODS={MonCash:!!(MC.id&&MC.secret),Natcash:false}; /* NatCash: add an adapter below when you have its merchant API */

/* ---- storage (JSON file). Replace with a real database when traffic grows ---- */
const DATA=path.join(__dirname,'data');fs.mkdirSync(DATA,{recursive:true});
const DB=path.join(DATA,'payments.json');
let pays={};try{pays=JSON.parse(fs.readFileSync(DB,'utf8'))}catch(e){}
const save=()=>{const t=DB+'.tmp';fs.writeFileSync(t,JSON.stringify(pays,null,1));fs.renameSync(t,DB)};

/* ---- helpers ---- */
class HttpErr extends Error{constructor(s,m){super(m);this.s=s}}
const bad=m=>new HttpErr(400,m),fail=(s,m)=>new HttpErr(s,m);
function catalog(){
  for(const f of [E.CATALOG_FILE,path.join(__dirname,'catalog.json'),path.join(__dirname,'..','catalog.json'),path.join(__dirname,'catalog.default.json')]){
    if(f&&fs.existsSync(f)){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){console.error('Bad catalog file',f)}}}
  return{items:[]};
}
const PACK={'@mo1':'1 mwa','@mo3':'3 mwa','@mo6':'6 mwa','@mo12':'12 mwa'};
/* The server decides the price. It never trusts the amount sent by the browser. */
function priceLines(items){
  if(!Array.isArray(items)||!items.length||items.length>30)throw bad('items');
  const by={};for(const i of catalog().items||[])by[i.k]=i;
  return items.map(it=>{
    if(!it||typeof it!=='object')throw bad('item');
    const to=String(it.to||'').slice(0,60);
    if(it.k==='wal'){const a=Math.floor(+it.a);if(!(a>=MINREC&&a<=200000))throw bad('amount');return{k:'wal',q:1,to,name:'Sledy Top-Up (recharge)',a}}
    const p=by[it.k];if(!p||p.on===0||p.on===false)throw bad('item');
    const q=Math.floor(+it.q||1);if(q<1||q>20)throw bad('qty');
    const o=p.o&&p.o[+it.o];if(!o)throw bad('pack');
    return{k:it.k,o:+it.o,q,to,name:p.n,pack:PACK[o[0]]||o[0],a:Math.round(+o[1])*q};
  });
}
const totalWithFee=(lines,rate)=>lines.reduce((n,l)=>n+l.a+Math.round(l.a*rate),0);

/* ---- MonCash ---- */
let tok={v:'',exp:0};
async function mcToken(){
  if(tok.v&&Date.now()<tok.exp)return tok.v;
  const r=await fetch(MC.api+'/oauth/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(MC.id+':'+MC.secret).toString('base64'),Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:'scope=read,write&grant_type=client_credentials'});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.access_token)throw fail(502,'moncash_token');
  tok={v:j.access_token,exp:Date.now()+Math.max(30,(+j.expires_in||60)-20)*1000};return tok.v;
}
async function mc(p,body){
  const t=await mcToken();
  const r=await fetch(MC.api+p,{method:'POST',headers:{Authorization:'Bearer '+t,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(body)});
  return{ok:r.ok,j:await r.json().catch(()=>({}))};
}

/* ---- routes ---- */
async function pay(b){
  const method=b.method;if(!METHODS[method])throw fail(501,'method_unavailable');
  const cid=String(b.id||'');if(!/^[\w-]{4,40}$/.test(cid))throw bad('id');
  const done=Object.values(pays).find(p=>p.clientId===cid&&p.status==='paid');
  if(done)return{ref:done.payId,paid:true};
  const lines=priceLines(b.items),amount=totalWithFee(lines,FEES[method]||0);
  const payId='S'+Date.now().toString(36)+crypto.randomBytes(3).toString('hex');
  let url='';
  if(method==='MonCash'){
    const r=await mc('/v1/CreatePayment',{amount,orderId:payId});
    const token=r.j&&r.j.payment_token&&r.j.payment_token.token;
    if(!r.ok||!token)throw fail(502,'moncash_create');
    url=MC.gw+'/Payment/Redirect?token='+encodeURIComponent(token);
  }
  pays[payId]={payId,clientId:cid,method,amount,lines,payerNumber:String(b.payerNumber||'').slice(0,20),status:'pending',created:Date.now()};save();
  return{url,ref:payId};
}
async function verify(b){
  const cid=String(b.id||'');
  const rec=Object.values(pays).filter(p=>p.clientId===cid).sort((a,c)=>c.created-a.created)[0];
  if(!rec)return{paid:false};
  if(rec.status==='paid')return{paid:true,ref:rec.payId};
  const tx=/^[\w-]{4,60}$/.test(String(b.txid||''))?String(b.txid):'';
  const usedBy=t=>Object.values(pays).find(x=>x.txid&&x.txid===t&&x.payId!==rec.payId);
  if(tx&&usedBy(tx))return{duplicate:true};
  const r=tx?await mc('/v1/RetrieveTransactionPayment',{transactionId:tx}):await mc('/v1/RetrieveOrderPayment',{orderId:rec.payId});
  const p=r.j&&r.j.payment;
  if(!r.ok||!p||String(p.message||'').toLowerCase()!=='successful')return{paid:false};
  if(String(p.reference||'')!==rec.payId||!(Number(p.cost)>=rec.amount))return{failed:true};
  const txid=String(p.transaction_id||tx||'');
  if(txid&&usedBy(txid))return{duplicate:true};
  Object.assign(rec,{status:'paid',txid,paidAt:Date.now(),payer:String(p.payer||'')});save();notify(rec);
  return{paid:true,ref:rec.payId};
}
function notify(rec){
  const text=`PEMAN KONFIME ${rec.amount} HTG (${rec.method}) | ${rec.payId}\n`+rec.lines.map(l=>`- ${l.name}${l.pack?' '+l.pack:''} x${l.q} | ${l.to}`).join('\n');
  console.log('[PAID]',text);
  if(E.NOTIFY_WEBHOOK)fetch(E.NOTIFY_WEBHOOK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,content:text})}).catch(()=>{});
}
async function player(q){
  if(!E.PLAYER_LOOKUP_URL)throw fail(501,'unsupported');
  const id=String(q.get('id')||'');if(!/^\d{6,14}$/.test(id))throw bad('id');
  const url=E.PLAYER_LOOKUP_URL.replace('{id}',encodeURIComponent(id)).replace('{region}',encodeURIComponent(q.get('region')||''));
  const r=await fetch(url,{headers:E.PLAYER_LOOKUP_KEY?{Authorization:'Bearer '+E.PLAYER_LOOKUP_KEY}:{}});
  const j=await r.json().catch(()=>({}));
  const name=j.name||j.nickname||(j.data&&(j.data.name||j.data.nickname));
  if(!r.ok||!name)throw fail(404,'not_found');
  return{name:String(name)};
}
const adminOk=req=>{const a=Buffer.from(String(req.headers['x-admin-token']||'')),b=Buffer.from(ADMIN);return ADMIN.length>=12&&a.length===b.length&&crypto.timingSafeEqual(a,b)};

/* ---- http server ---- */
const hits=new Map();
setInterval(()=>hits.clear(),60000).unref();
function readBody(req){return new Promise((res,rej)=>{let s='';req.on('data',c=>{s+=c;if(s.length>20000){rej(bad('too_big'));req.destroy()}});req.on('end',()=>{try{res(s?JSON.parse(s):{})}catch(e){rej(bad('json'))}});req.on('error',rej)})}
const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin||'';
  if(ORIGIN&&(ORIGIN==='*'||origin===ORIGIN)){res.setHeader('Access-Control-Allow-Origin',ORIGIN==='*'?'*':origin);res.setHeader('Vary','Origin')}
  res.setHeader('Access-Control-Allow-Headers','Content-Type,x-admin-token');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('X-Content-Type-Options','nosniff');
  const send=(s,o)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
  const ip=req.socket.remoteAddress,n=(hits.get(ip)||0)+1;hits.set(ip,n);if(n>120)return send(429,{error:'slow_down'});
  const u=new URL(req.url,'http://x');
  try{
    if(req.method==='GET'&&u.pathname==='/health')return send(200,{ok:true});
    if(req.method==='GET'&&u.pathname==='/config')return send(200,{methods:METHODS,fees:FEES,minRecharge:MINREC,mode:MODE});
    if(req.method==='GET'&&u.pathname==='/player')return send(200,await player(u.searchParams));
    if(req.method==='POST'&&u.pathname==='/pay')return send(200,await pay(await readBody(req)));
    if(req.method==='POST'&&u.pathname==='/verify')return send(200,await verify(await readBody(req)));
    if(req.method==='POST'&&u.pathname==='/receipt')return send(200,{ok:false,unsupported:true}); /* WhatsApp sending needs WhatsApp Business API */
    if(u.pathname==='/admin/payments'&&req.method==='GET'){if(!adminOk(req))return send(401,{error:'unauthorized'});return send(200,Object.values(pays).sort((a,b)=>b.created-a.created))}
    if(u.pathname==='/admin/delivered'&&req.method==='POST'){if(!adminOk(req))return send(401,{error:'unauthorized'});const b=await readBody(req),p=pays[b.payId];if(!p)throw bad('not_found');p.delivered=true;p.deliveredAt=Date.now();save();return send(200,{ok:true})}
    send(404,{error:'not_found'});
  }catch(e){
    if(e instanceof HttpErr)return send(e.s,{error:e.message,unsupported:e.s===501||undefined});
    console.error(e);send(500,{error:'server'});
  }
});
if(require.main===module)server.listen(PORT,()=>console.log(`Sledy payments on :${PORT} | MonCash ${METHODS.MonCash?'ON ('+MODE+')':'OFF (add keys in .env)'} | NatCash OFF`));
module.exports=server;
