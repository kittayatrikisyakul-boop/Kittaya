import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonClient, decodeBar, matchSymbols, MarketFeed, analyseCandles } from '../ctrader.mjs';
import { createServer } from '../server.mjs';
const H4=14400000;

test('broker price scale, bar validation, exact symbol mapping and ambiguity',()=>{
  assert.deepEqual(decodeBar({low:123000,deltaOpen:10,deltaClose:20,deltaHigh:30,utcTimestampInMinutes:100}),{time:6000000,low:1.23,open:1.2301,close:1.2302,high:1.2303});
  assert.equal(decodeBar({low:-1,utcTimestampInMinutes:100}),null);
  assert.equal(decodeBar({low:123000,deltaHigh:1,deltaOpen:5,utcTimestampInMinutes:100}),null);
  assert.deepEqual(matchSymbols([{symbolName:'EUR/USD',symbolId:1},{symbolName:'XAUUSD.a',symbolId:2}]),{EURUSD:{symbolName:'EUR/USD',symbolId:1}});
  assert.deepEqual(matchSymbols([{symbolName:'EURUSD',symbolId:1},{symbolName:'EUR/USD',symbolId:2}]),{});
});

test('read-only JSON client authenticates, correlates requests and rejects trading requests',async()=>{
  const sent=[];
  class Socket extends EventTarget {
    constructor(){super();this.readyState=0;queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
    send(raw){const m=JSON.parse(raw);sent.push(m);queueMicrotask(()=>{this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({payloadType:m.payloadType===2100?2101:2150,clientMsgId:m.clientMsgId,payload:{ctidTraderAccount:[]}})}));});}
    close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
  }
  const c=new JsonClient(false,{clientId:'test-client',clientSecret:'test-secret'},{Socket});
  await c.connect();await c.request(2149,{accessToken:'test-access'},2150);
  await assert.rejects(c.request(2106,{},2126),/read-only/);
  assert.equal(sent.length,2);assert.equal(sent[0].payloadType,2100);assert.match(c.url,/demo\.ctraderapi\.com:5036/);c.close();
});

test('spot freshness, partial quotes and out-of-order data never create fresh fabricated prices',()=>{
 const now=Date.now();const client={connected:true,close(){}};const feed=new MarketFeed(client,'1','test-only');
 feed.items.EURUSD={id:'7',price:null,ask:null,timestamp:null,bars:[],historyReady:false};
 feed.spot({ctidTraderAccountId:'1',symbolId:7,bid:112345,ask:112355,timestamp:now});
 assert.equal(feed.snapshot(now).symbols.EURUSD.price,1.12345);
 assert.equal(feed.snapshot(now).symbols.EURUSD.fresh,true);
 feed.spot({ctidTraderAccountId:'2',symbolId:7,bid:999999,timestamp:now+1});
 feed.spot({ctidTraderAccountId:'1',symbolId:7,bid:999999,timestamp:now-1});
 feed.spot({ctidTraderAccountId:'1',symbolId:7,bid:999999});
 assert.equal(feed.snapshot(now).symbols.EURUSD.price,1.12345);
 assert.equal(feed.snapshot(now+120001).symbols.EURUSD.fresh,false);
 client.connected=false;assert.equal(feed.snapshot(now).symbols.EURUSD.fresh,false);
});

test('H4 zones use closed candles only and report no invented entry/stop/targets',()=>{
 const now=Date.now(),start=Math.floor(now/H4)*H4-30*H4;
 const bars=Array.from({length:25},(_,i)=>({time:start+i*H4,open:1+i*.005,close:1.001+i*.005,high:1.003+i*.005,low:.997+i*.005}));
 const a=analyseCandles(bars,1.13,now);
 assert.ok(a.fvg.length>0);
 assert.equal(a.tp.sl,null);assert.equal(a.tp.direction,'none');
 const forming={time:Math.floor(now/H4)*H4,open:10,close:100,high:100,low:10};
 assert.deepEqual(analyseCandles([...bars,forming],1.13,now),a);
 assert.equal(analyseCandles(bars.slice(0,5),1.1,now).structure.type,'Waiting for H4 candles');
});

test('OAuth uses session-bound one-use state, read-only scope, account authorization and no token disclosure',async t=>{
 const clients=[],fetches=[];
 const server=createServer({env:{CTRADER_CLIENT_ID:'test-client',CTRADER_CLIENT_SECRET:'test-secret',CTRADER_REDIRECT_URI:'https://kittaya.onrender.com/auth/ctrader/callback'},
  fetchImpl:async url=>{fetches.push(new URL(url));return {ok:true,json:async()=>({accessToken:'test-access',refreshToken:'test-refresh',expiresIn:3600})};},
  clientFactory:()=>{const c={connected:true,async connect(){return this;},async request(type){assert.equal(type,2149);return {ctidTraderAccount:[{ctidTraderAccountId:123,isLive:false,traderLogin:456,brokerTitleShort:'Demo Broker'}]};},close(){this.connected=false;}};clients.push(c);return c;},
  feedFactory:client=>({client,async start(){},snapshot(){return {connected:true,symbols:{EURUSD:{price:1.1}}};},close(){client.close();}})
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const login=await fetch(base+'/auth/ctrader',{redirect:'manual'});
 const cookie=login.headers.get('set-cookie').split(';')[0];const target=new URL(login.headers.get('location'));
 assert.equal(target.searchParams.get('scope'),'accounts');assert.equal(target.searchParams.has('client_secret'),false);
 assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));assert.ok(login.headers.get('set-cookie').includes('Secure'));
 assert.equal((await fetch(base+'/auth/ctrader/callback?code=test-code&state=wrong',{headers:{cookie}})).status,400);
 assert.equal(fetches.length,0);
 const query=new URLSearchParams({code:'test-code',state:target.searchParams.get('state')});
 const callback=await fetch(base+'/auth/ctrader/callback?'+query,{headers:{cookie},redirect:'manual'});
 assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/auth/ctrader/accounts');
 assert.equal(fetches[0].searchParams.get('grant_type'),'authorization_code');
 assert.equal((await fetch(base+'/auth/ctrader/callback?'+query,{headers:{cookie}})).status,400);
 const accounts=await fetch(base+'/auth/ctrader/accounts',{headers:{cookie}});const html=await accounts.text();
 assert.match(html,/Demo Broker/);assert.doesNotMatch(html,/test-access|test-refresh|test-secret/);
 const csrf=html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
 const opts={method:'POST',headers:{cookie,Origin:'https://evil.example','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,account:'123'}),redirect:'manual'};
 assert.equal((await fetch(base+'/auth/ctrader/select',opts)).status,403);
 opts.headers.Origin='https://kittaya.onrender.com';
 assert.equal((await fetch(base+'/auth/ctrader/select',opts)).status,303);
 const market=await fetch(base+'/api/ctrader/market',{headers:{cookie}});assert.equal(market.status,200);assert.doesNotMatch(await market.text(),/test-access|test-secret|test-refresh/);
 assert.equal((await fetch(base+'/api/ctrader/market')).status,401);
 const state=await(await fetch(base+'/api/ctrader/status',{headers:{cookie}})).json();assert.equal(state.authorized,true);assert.equal(state.configured,true);
});

test('confirmed H4 pivot break produces BOS, then opposite break produces CHoCH; forming bars cannot repaint it',()=>{
 const now=Date.now(),start=Math.floor(now/H4)*H4-30*H4;
 const bars=Array.from({length:20},(_,i)=>{const center=1+Math.sin(i*Math.PI/2)*.01;return {time:start+i*H4,open:center,close:center+(i%2?-.0005:.0005),high:center+.002,low:center-.002};});
 const breakout={time:start+20*H4,open:1.005,close:1.02,high:1.021,low:1};
 const bullish=analyseCandles([...bars,breakout],1.02,now);
 assert.equal(bullish.bias,'bull');assert.equal(bullish.structure.type,'BOS');assert.ok(bullish.orderBlocks.some(z=>z.type==='demand'));
 const reversal={time:start+21*H4,open:1.005,close:.98,high:1.01,low:.979};
 const bearish=analyseCandles([...bars,breakout,reversal],.98,now);
 assert.equal(bearish.bias,'bear');assert.equal(bearish.structure.type,'CHoCH');assert.ok(bearish.orderBlocks.some(z=>z.type==='supply'));
 assert.ok(bearish.orderBlocks.every(z=>z.type!=='demand'));
});
