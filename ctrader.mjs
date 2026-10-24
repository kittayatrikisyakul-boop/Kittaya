// Read-only JSON protocol. Reference: spotware/openapi-proto-messages.
import { randomUUID } from 'node:crypto';
export const SYMBOLS = ['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD','XAUUSD','GBPJPY','GBPAUD','GBPNZD','GBPCAD','EURJPY','EURAUD','EURNZD'];
const H4 = 14400000;
export const FRESH_MS = 120000;
const READ_TYPES = new Set([2100,2102,2114,2127,2135,2137,2149]);
export function decodeBar(b) {
  const low = Number(b.low) / 100000;
  const bar = {time:Number(b.utcTimestampInMinutes)*60000, low,
    open:low + Number(b.deltaOpen || 0)/100000, close:low + Number(b.deltaClose || 0)/100000,
    high:low + Number(b.deltaHigh || 0)/100000};
  return Object.values(bar).every(Number.isFinite) && bar.time > 0 && bar.low > 0 &&
    bar.low <= Math.min(bar.open,bar.close) && bar.high >= Math.max(bar.open,bar.close) ? bar : null;
}
export function matchSymbols(list) {
  const result = {};
  for (const key of SYMBOLS) {
    const matches = list.filter(s => s.enabled !== false && String(s.symbolName).toUpperCase().replace(/\//g,'') === key);
    if (matches.length === 1) result[key] = matches[0];
  }
  return result; // Never guess a broker's suffix, symbol ID or oil contract.
}
export class JsonClient {
  constructor(isLive, credentials, {Socket = WebSocket, timeout = 15000} = {}) {
    this.credentials=credentials; this.Socket=Socket; this.timeout=timeout;
    this.url=`wss://${isLive ? 'live' : 'demo'}.ctraderapi.com:5036`; this.pending=new Map(); this.connected=false;
  }
  async connect() {
    const socket=this.socket=new this.Socket(this.url);
    socket.addEventListener('message', e => {
      try {
        const m=JSON.parse(String(e.data));
        if (m.payloadType === 51) return;
        const waiting=this.pending.get(m.clientMsgId);
        if (waiting) {
          this.pending.delete(m.clientMsgId);clearTimeout(waiting.timer);
          if (m.payloadType===2142 || m.payload?.errorCode) waiting.reject(new Error('Broker rejected request'));
          else if (m.payloadType!==waiting.expected) waiting.reject(new Error('Unexpected broker response'));
          else waiting.resolve(m.payload || {});
        }
        if (m.payloadType===2131) this.onSpot?.(m.payload || {});
        if ([2147,2148,2164].includes(m.payloadType)) this.close();
      } catch { /* Ignore malformed unsolicited frames; requests still time out. */ }
    });
    socket.addEventListener('close', () => {
      this.connected=false;clearInterval(this.heartbeat);
      for (const p of this.pending.values()) {clearTimeout(p.timer);p.reject(new Error('Broker disconnected'));}
      this.pending.clear(); this.onDisconnect?.();
    });
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.close();reject(new Error('Broker connection timeout'));},this.timeout);timer.unref?.();
      socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Broker connection failed'));},{once:true});
    });
    await this.request(2100,{clientId:this.credentials.clientId,clientSecret:this.credentials.clientSecret},2101);
    this.connected=true;
    this.heartbeat=setInterval(()=>{if(socket.readyState===1)socket.send(JSON.stringify({payloadType:51,payload:{}}));},10000);
    this.heartbeat.unref?.();
    return this;
  }
  request(type,payload,expected) {
    if (!READ_TYPES.has(type)) return Promise.reject(new Error('Only read-only requests are supported'));
    if (this.socket?.readyState!==1) return Promise.reject(new Error('Broker is not connected'));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Broker request timeout'));},this.timeout);timer.unref?.();
      this.pending.set(id,{resolve,reject,timer,expected});
      this.socket.send(JSON.stringify({clientMsgId:id,payloadType:type,payload}));
    });
  }
  close() {this.connected=false;clearInterval(this.heartbeat);this.socket?.close();}
}

// Deterministic H4 analysis using CLOSED broker candles. It is not a forecast.
export function analyseCandles(input, price, now=Date.now()) {
  const bars=[...new Map(input.filter(b=>b && b.time+H4<=now).map(b=>[b.time,b])).values()].sort((a,b)=>a.time-b.time).slice(-150);
  const empty={bias:'neutral',structure:{type:'Waiting for H4 candles',dir:'neutral',tf:'H4',note:'Need at least 20 closed candles'},choch:null,orderBlocks:[],fvg:[],liquidity:[],targets:{bull:[],bear:[]},tp:{entry:[null,null],sl:null,tp1:null,tp2:null,tp3:null,direction:'none'},plan:'Waiting for closed H4 candle data.'};
  if(bars.length<20)return empty;
  let pivotHigh=null,pivotLow=null,bias='neutral',structure=empty.structure,choch=null;
  const highs=[],lows=[]; let obs=[],gaps=[];
  for(let i=4;i<bars.length;i++) {
    const b=bars[i],p=bars[i-2],window=bars.slice(i-4,i+1);
    if(window.every(v=>v===p || p.high>v.high)) {pivotHigh={price:p.high,time:p.time};highs.push(pivotHigh);}
    if(window.every(v=>v===p || p.low<v.low)) {pivotLow={price:p.low,time:p.time};lows.push(pivotLow);}
    obs=obs.filter(z=>z.type==='demand'?b.close>=z.zone[0]:b.close<=z.zone[1]);
    gaps=gaps.filter(z=>z.dir==='bullish'?b.low>z.zone[0]:b.high<z.zone[1]);
    let dir=null;
    if(pivotHigh && b.close>pivotHigh.price && bars[i-1].close<=pivotHigh.price) {dir='bull';pivotHigh=null;}
    else if(pivotLow && b.close<pivotLow.price && bars[i-1].close>=pivotLow.price) {dir='bear';pivotLow=null;}
    if(dir) {
      const reversal=bias!=='neutral' && bias!==dir;
      structure={type:reversal?'CHoCH':'BOS',dir:dir==='bull'?'bullish':'bearish',tf:'H4',note:'Confirmed by H4 close',time:b.time+H4};
      choch=reversal?{...structure}:null;bias=dir;
      const origin=bars.slice(Math.max(0,i-8),i).reverse().find(v=>dir==='bull'?v.close<v.open:v.close>v.open);
      if(origin)obs.push({type:dir==='bull'?'demand':'supply',zone:[origin.low,origin.high],strength:'strong',note:'Last opposite candle before confirmed break',time:b.time+H4});
    }
    const a=bars[i-2];
    if(b.low>a.high)gaps.push({zone:[a.high,b.low],dir:'bullish',note:'Three-candle H4 gap',time:b.time+H4});
    if(b.high<a.low)gaps.push({zone:[b.high,a.low],dir:'bearish',note:'Three-candle H4 gap',time:b.time+H4});
  }
  const recent=bars.slice(-40),swingHigh=Math.max(...recent.map(b=>b.high)),swingLow=Math.min(...recent.map(b=>b.low));
  const bull=[...new Set(highs.map(p=>p.price).filter(v=>v>price))].sort((a,b)=>a-b);
  const bear=[...new Set(lows.map(p=>p.price).filter(v=>v<price))].sort((a,b)=>b-a);
  return {...empty,bias,structure,choch,swingHigh,swingLow,orderBlocks:obs.slice(-8),fvg:gaps.slice(-8),
    liquidity:[...highs.slice(-4).map(p=>({type:'BSL',level:p.price,note:'Confirmed pivot high'})),...lows.slice(-4).map(p=>({type:'SSL',level:p.price,note:'Confirmed pivot low'}))],
    targets:{bull,bear},plan:'H4 structure and zones calculated from closed cTrader candles; price uses broker BID. No automatic orders. Entry, stop and take-profit require a separate confirmed trade setup.'};
}

export class MarketFeed {
  constructor(client,accountId,accessToken) {this.client=client;this.accountId=accountId;this.accessToken=accessToken;this.items={};this.closed=false;this.feedId=randomUUID();}
  async start() {
    const c=this.client; await c.connect();
    await c.request(2102,{ctidTraderAccountId:this.accountId,accessToken:this.accessToken},2103);
    const list=await c.request(2114,{ctidTraderAccountId:this.accountId,includeArchivedSymbols:false},2115);
    const mapped=matchSymbols(list.symbol || []);
    this.items=Object.fromEntries(Object.entries(mapped).map(([key,s])=>[key,{id:String(s.symbolId),name:s.symbolName,price:null,ask:null,timestamp:null,receivedAt:null,bars:[],historyReady:false}]));
    c.onSpot=e=>this.spot(e);
    const ids=Object.values(this.items).map(s=>s.id);
    if(ids.length)await c.request(2127,{ctidTraderAccountId:this.accountId,symbolId:ids,subscribeToSpotTimestamp:true},2128);
    for(const item of Object.values(this.items)) {
      if(this.closed)return;
      try {
        const now=Date.now();
        const data=await c.request(2137,{ctidTraderAccountId:this.accountId,symbolId:item.id,period:10,fromTimestamp:now-90*86400000,toTimestamp:now,count:150},2138);
        item.bars=(data.trendbar || []).map(decodeBar).filter(Boolean);item.historyReady=true;
        await c.request(2135,{ctidTraderAccountId:this.accountId,symbolId:item.id,period:10},2165);
      } catch {item.historyReady=false;item.historyError='Historical candles unavailable; signals paused';}
      // Keep historical request rate below 5/sec, even with low-latency responses.
      await new Promise(r=>setTimeout(r,250));
    }
  }
  spot(e) {
    if(String(e.ctidTraderAccountId)!==String(this.accountId))return;
    const item=Object.values(this.items).find(s=>s.id===String(e.symbolId));if(!item)return;
    const stamp=Number(e.timestamp),now=Date.now();
    if(!Number.isFinite(stamp)||stamp<=0||stamp>now+5000||stamp<(item.timestamp || 0))return;
    if(e.bid!==undefined) {
      const bid=Number(e.bid)/100000;
      if(Number.isFinite(bid)&&bid>0){item.price=bid;item.timestamp=stamp;item.receivedAt=now;}
    }
    if(e.ask!==undefined) {const ask=Number(e.ask)/100000;if(Number.isFinite(ask)&&ask>0)item.ask=ask;}
    for(const raw of e.trendbar || []) {
      if(raw.period!==undefined && ![10,'H4'].includes(raw.period))continue;
      const b=decodeBar(raw);if(!b)continue;
      const i=item.bars.findIndex(v=>v.time===b.time);if(i>=0)item.bars[i]=b;else item.bars.push(b);
      item.bars.sort((a,b)=>a.time-b.time);item.bars=item.bars.slice(-155);
    }
  }
  snapshot(now=Date.now()) {
    const result={};
    for(const [key,s] of Object.entries(this.items)) {
      const fresh=this.client.connected && Number.isFinite(s.timestamp) && now-s.timestamp<=FRESH_MS && Number.isFinite(s.price);
      result[key]={symbol:s.name,price:s.price,ask:s.ask,timestamp:s.timestamp,fresh,historyReady:s.historyReady,
        historyError:s.historyError || null,analysis:s.historyReady?analyseCandles(s.bars,s.price,now):null};
    }
    return {feedId:this.feedId,connected:this.client.connected,symbols:result,unavailable:SYMBOLS.filter(k=>!this.items[k]),oilOptional:true};
  }
  close(){this.closed=true;this.client.close();}
}
