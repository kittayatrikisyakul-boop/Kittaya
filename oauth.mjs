import { randomBytes, timingSafeEqual } from 'node:crypto';
import { JsonClient, MarketFeed } from './ctrader.mjs';
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const equal = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const random = () => randomBytes(32).toString('hex');
export function createBrokerRoutes({env=process.env,fetchImpl=fetch,clientFactory=(live,credentials)=>new JsonClient(live,credentials),feedFactory=(...args)=>new MarketFeed(...args)}={}) {
  const sessions=new Map();
  const config={clientId:env.CTRADER_CLIENT_ID,clientSecret:env.CTRADER_CLIENT_SECRET,redirect:env.CTRADER_REDIRECT_URI};
  const configured=!!(config.clientId && config.clientSecret && config.redirect);
  let origin,secure=true;
  try {const u=new URL(config.redirect);origin=u.origin;secure=u.protocol==='https:';if(u.pathname!=='/auth/ctrader/callback'||u.search||u.hash||(!secure&&u.hostname!=='localhost'))throw Error();} catch {origin=null;}
  const available=configured&&!!origin;
  const cleanup=setInterval(()=>{for(const [id,s] of sessions)if(s.expires<Date.now()){s.feed?.close();sessions.delete(id);}},60000);cleanup.unref();
  function session(req) {
    const id=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('ctrader_sid='))?.slice(12);
    const s=sessions.get(id);if(!s || s.expires<Date.now())return null;
    s.expires=Date.now()+3600000;return s;
  }
  const html = (res,status,title,message) => {
    res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});
    res.end(`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><h1>${escape(title)}</h1>${message}</html>`);
  };
  const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
  const redirect=(res,url)=>{res.writeHead(303,{Location:url,'Referrer-Policy':'no-referrer'});res.end();};
  async function token(params) {
    const url=new URL('https://openapi.ctrader.com/apps/token');
    for(const [k,v]of Object.entries({...params,client_id:config.clientId,client_secret:config.clientSecret}))url.searchParams.set(k,v);
    // GET matches the official OpenApiPy SDK. Never log this URL or response.
    const r=await fetchImpl(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!r.ok)throw Error('Token service rejected request');
    const t=await r.json();if(!t.accessToken||!t.refreshToken||!Number.isFinite(Number(t.expiresIn))||Number(t.expiresIn)<=60)throw Error('Invalid token response');
    return {accessToken:t.accessToken,refreshToken:t.refreshToken,expiresAt:Date.now()+Number(t.expiresIn)*1000};
  }
  async function access(s) {
    if(!s.token)throw Error('Authorization required');
    if(s.token.expiresAt-Date.now()>60000)return s.token.accessToken;
    if(!s.refresh)s.refresh=token({grant_type:'refresh_token',refresh_token:s.token.refreshToken}).then(t=>{s.token=t;s.feed?.close();s.feed=null;return t.accessToken;}).finally(()=>{s.refresh=null;});
    return s.refresh;
  }
  async function listAccounts(s) {
    const c=clientFactory(false,config);
    try {await c.connect();const data=await c.request(2149,{accessToken:await access(s)},2150);
      s.accounts=(data.ctidTraderAccount || []).map(a=>({id:String(a.ctidTraderAccountId),isLive:a.isLive===true,login:String(a.traderLogin || ''),broker:String(a.brokerTitleShort || '')}));
      return s.accounts;
    } finally {c.close();}
  }
  async function connectFeed(s) {
    if(s.connecting)return s.connecting;
    s.connecting=(async()=>{
      const a=s.accounts?.find(a=>a.id===s.selected);if(!a)throw Error('Select an authorized account');
      const current=await access(s);s.feed?.close();
      s.feedAccount=a.id;
      const feed=s.feed=feedFactory(clientFactory(a.isLive,config),a.id,current);
      s.error=null;
      try {await feed.start();}catch {feed.close();s.error='Broker connection failed. Check app/account permissions and retry.';}
    })().finally(()=>{s.connecting=null;});
    return s.connecting;
  }
  return {
    close(){clearInterval(cleanup);for(const s of sessions.values())s.feed?.close();sessions.clear();},
    async handle(req,res,url) {
      const path=url.pathname;if(!path.startsWith('/auth/ctrader')&&!path.startsWith('/api/ctrader'))return false;
      res.setHeader('Referrer-Policy','no-referrer');
      try {
        const s=session(req);
        if(path==='/api/ctrader/status' && req.method==='GET') {
          json(res,200,{configured:available,authorized:!!s?.token,selected:!!s?.selected,connecting:!!s?.connecting,connected:!!s?.feed?.client.connected,error:s?.error || null,storage:'Session-only; reconnect after server restart'});return true;
        }
        if(!available){html(res,503,'cTrader setup required','<p>ตั้งค่า CTRADER_CLIENT_ID, CTRADER_CLIENT_SECRET และ CTRADER_REDIRECT_URI ใน Render Environment แล้ว Deploy ใหม่</p>');return true;}
        if(path==='/auth/ctrader' && req.method==='GET') {
          if(s){s.feed?.close();sessions.delete(s.id);}
          if(sessions.size>=100){html(res,429,'Please retry later','<p>Connection session limit reached.</p>');return true;}
          const id=random(),state=random();sessions.set(id,{id,state,stateExpires:Date.now()+600000,expires:Date.now()+3600000});
          res.setHeader('Set-Cookie',`ctrader_sid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${secure?'; Secure':''}`);
          const auth=new URL('https://openapi.ctrader.com/apps/auth');
          auth.searchParams.set('client_id',config.clientId);auth.searchParams.set('redirect_uri',config.redirect);auth.searchParams.set('scope','accounts');auth.searchParams.set('state',state);
          redirect(res,auth.toString());return true;
        }
        if(path==='/auth/ctrader/callback' && req.method==='GET') {
          if(!s || !s.state || s.stateExpires<Date.now() || !equal(url.searchParams.get('state'),s.state)) {
            html(res,400,'Authorization session mismatch','<p>ไม่พบหรือยืนยัน state ของการเชื่อมต่อไม่ได้ กรุณาเริ่มจากลิงก์ด้านล่าง ไม่ต้องส่ง URL ที่มี code มาในแชต</p><p><a href="/auth/ctrader">เริ่มเชื่อม cTrader ใหม่</a></p>');return true;
          }
          delete s.state;
          const code=url.searchParams.get('code');
          if(!code||url.searchParams.has('error')){html(res,400,'Authorization not granted','<p><a href="/auth/ctrader">ลองอีกครั้ง</a></p>');return true;}
          s.token=await token({grant_type:'authorization_code',code,redirect_uri:config.redirect});s.csrf=random();
          await listAccounts(s);redirect(res,'/auth/ctrader/accounts');return true;
        }
        if(!s?.token){json(res,401,{error:'Connect your cTrader account',connectUrl:'/auth/ctrader'});return true;}
        if(path==='/auth/ctrader/accounts' && req.method==='GET') {
          const list=s.accounts || await listAccounts(s);
          const options=list.map(a=>`<option value="${escape(a.id)}">${escape(a.broker)} · ${a.isLive?'Live':'Demo'} · ${escape(a.login)}</option>`).join('');
          html(res,200,'เลือกบัญชีสำหรับอ่านราคา',list.length?`<p>อ่านราคาและแท่งเทียนเท่านั้น ไม่ส่งคำสั่งซื้อขาย</p><form action="/auth/ctrader/select" method="post"><input type="hidden" name="csrf" value="${s.csrf}"><select name="account">${options}</select><button type="submit">เชื่อมราคา</button></form>`:'<p>ไม่พบบัญชีที่อนุญาต ให้ตรวจ cTrader ID และสิทธิ์แอป</p>');return true;
        }
        if(path==='/auth/ctrader/select' && req.method==='POST') {
          if(req.headers.origin!==origin){json(res,403,{error:'Invalid origin'});return true;}
          let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('Request too large');}
          const fields=new URLSearchParams(body);
          if(!equal(fields.get('csrf'),s.csrf)||!s.accounts?.some(a=>a.id===fields.get('account'))){json(res,403,{error:'Invalid account selection'});return true;}
          s.feed?.close();s.feed=null;s.selected=fields.get('account');s.csrf=random();s.retryAt=null;
          connectFeed(s).catch(()=>{s.error='Could not start broker connection';});
          redirect(res,'/?ctrader=connected');return true;
        }
        if(path==='/api/ctrader/market' && req.method==='GET') {
          if(!s.selected){json(res,409,{error:'Choose an account',accountUrl:'/auth/ctrader/accounts'});return true;}
          if(!s.connecting && (s.feedAccount!==s.selected || !s.feed?.client.connected || s.token.expiresAt-Date.now()<60000) && (!s.retryAt||s.retryAt<Date.now())) {
            s.retryAt=Date.now()+15000;connectFeed(s).catch(()=>{s.error='Reconnect failed; reconnect your cTrader account';});
          }
          json(res,200,{...((s.feedAccount===s.selected ? s.feed?.snapshot() : null) || {connected:false,symbols:{}}),connecting:!!s.connecting,error:s.error || null});return true;
        }
        json(res,404,{error:'Not found'});return true;
      } catch {
        // No OAuth codes, tokens, client secrets or broker responses in logs/pages.
        html(res,502,'cTrader connection not completed','<p>บริการยืนยันบัญชีหรือโบรกเกอร์ตอบกลับไม่สำเร็จ กรุณาตรวจคีย์และ Redirect URI ใน Render แล้วเริ่มใหม่</p><p><a href="/auth/ctrader">เริ่มเชื่อมใหม่</a></p>');return true;
      }
    }
  };
}
