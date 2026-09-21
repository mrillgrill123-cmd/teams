// ==UserScript==
// @name         BTC 双页价格 · 磨砂玻璃
// @namespace    local.btc.monitor
// @version      0.5.1
// @description  Polymarket 单页 BTC 价格、涨跌点及偏离提示；不交易
// @match        https://polymarket.com/*
// @match        https://www.polymarket.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      gamma-api.polymarket.com
// @connect      clob.polymarket.com
// @connect      api.exchange.coinbase.com
// @run-at       document-idle
// @noframes
// ==/UserScript==
(() => {
'use strict';
if(!['polymarket.com','www.polymarket.com'].includes(location.hostname))return;
try{
let running=true,busy=false,market=null,socket=null,lastConnect=0,lastWire=0,lastBookAt=0,quoteAt=0,transportName='';
let binding=null,boundSlug=null,currentNode=null,baseNode=null,currentValue=null,baseValue=null,domAt=0,renderTimer=null;
const host=document.createElement('div');document.documentElement.append(host);const root=host.attachShadow({mode:'open'});
function el(tag,text,parent=root){const n=document.createElement(tag);n.textContent=text;parent.append(n);return n;}

function moneyView(node,text){
 if(node.dataset.moneyText===text)return;
 node.dataset.moneyText=text;node.replaceChildren();
 const pattern=/[+-]?\$-?(?:[\d,]+(?:\.\d+)?|—)|[+-]?\d+(?:\.\d+)?(?:¢| USD(?:\/秒)?)/g;
 let last=0;for(const match of text.matchAll(pattern)){node.append(document.createTextNode(text.slice(last,match.index)));const b=el('b',match[0],node);b.className='money';last=match.index+match[0].length;}node.append(document.createTextNode(text.slice(last)));
}
el('style',":host{all:initial;position:fixed;right:14px;top:85px;z-index:2147483647;font:12px/1.6 'PingFang SC','Segoe UI',sans-serif;color:#344059}section{width:285px;padding:14px;border:1px solid #ffffffb0;border-radius:17px;background:#f2f5ffeb;backdrop-filter:blur(14px);box-shadow:0 8px 24px #24304a20}header{font-weight:650;cursor:move;touch-action:none}p{margin:7px 0;white-space:pre-line}button{font:inherit;border:0;border-radius:8px;background:#e3e5f5;color:#535276;padding:5px 8px;margin:3px;cursor:pointer}small{display:block;color:#778096}.money{font-weight:750}.connection{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:1.6em;min-height:1.6em;line-height:1.6}.history-entry{margin:0 0 10px;white-space:pre-line}.history-entry.profit{color:#2563b8}.history-entry.loss{color:#c43d4b}.history-entry.neutral{color:#778096}strong{display:block;font-size:24px;font-weight:800;color:#bc583c}");
const panel=el('section',''),head=el('header','BTC · Polymarket 0.5.1',panel),btc=el('p','等待绑定 BTC 价格',panel),book=el('p','等待盘口',panel),signal=el('strong','',panel),reason=el('small','',panel),status=el('small','',panel);
status.className='connection';status.title='当前价=目标价+差价；页面差价可能取整';
function button(label,fn){const b=el('button',label,panel);b.onclick=fn;return b;}
const auto=button(GM_getValue('pm-auto',true)?'跟随：开':'跟随：关',()=>{const on=!GM_getValue('pm-auto',true);GM_setValue('pm-auto',on);auto.textContent=on?'跟随：开':'跟随：关';});
const spotView=el('small','Coinbase BTC/USD：等待跨域行情',panel);
const totalView=el('small','模拟每次投入 $100',panel);
const historyView=el('p','',panel);historyView.style.maxHeight='150px';historyView.style.overflow='auto';historyView.hidden=true;
let historyOpen=false;
function toggleHistory(){historyOpen=!historyOpen;historyView.hidden=!historyOpen;historyButton.textContent=historyOpen?'收起历史':'历史';historyButton.setAttribute('aria-expanded',String(historyOpen));if(historyOpen)showHistory();}
button('立即跟随',()=>{lastFollowCheck=0;followLive();});const historyButton=button('历史',toggleHistory);historyButton.setAttribute('aria-expanded','false');button('导出 JSON',()=>{const blob=new Blob([JSON.stringify(history(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='polymarket-opportunities.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});
const toggle=button('停止',()=>{running=!running;toggle.textContent=running?'停止':'实行';if(!running){socket?.close();socket=null;quoteAt=0;}else{sampleDOM();poll();}render();});
let drag=null;head.onpointerdown=e=>{if(e.button!==0)return;const r=host.getBoundingClientRect();drag={x:e.clientX-r.left,y:e.clientY-r.top};head.setPointerCapture(e.pointerId);};head.onpointermove=e=>{if(!drag)return;host.style.right='auto';host.style.left=Math.max(0,Math.min(innerWidth-315,e.clientX-drag.x))+'px';host.style.top=Math.max(0,Math.min(innerHeight-80,e.clientY-drag.y))+'px';};head.onpointerup=head.onpointercancel=()=>drag=null;
function pageSlug(){return location.pathname.match(/\/event\/(btc-updown-5m-\d+)(?:\/|$)/)?.[1]||null;}
function parseUSD(text){const m=text.trim().match(/^\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:USD)?$/i);const n=m?Number(m[1].replaceAll(',','')):NaN;return Number.isFinite(n)&&n>0?n:null;}


// Verified against Polymarket module 442854 (AnimatedNumber) from its public bundle.
function animatedPrice(root){
 if(!root?.style?.getPropertyValue('--height'))return null;
 const slots=[...root.querySelectorAll('div')].filter(n=>n.classList.contains('w-[1ch]')&&n.classList.contains('tabular-nums'));
 if(slots.length<1||slots.length>12)return null;
 const digits=new Map();
 for(const slot of slots){
  const r=slot.getBoundingClientRect();if(r.width<1||r.height<1)return null;
  const spans=[...slot.children].filter(n=>/^\d$/.test(n.textContent.trim()));
  if(spans.length!==10||new Set(spans.map(n=>n.textContent.trim())).size!==10)return null;
  const rows=spans.map(n=>{const b=n.getBoundingClientRect();return{n,d:Math.abs((b.top+b.bottom-r.top-r.bottom)/2)};}).sort((a,b)=>a.d-b.d);
  // Require alignment: while digits are between rows no quote is emitted.
  if(rows[0].d>r.height*.12||rows[1].d-rows[0].d<r.height*.5||Number(getComputedStyle(rows[0].n).opacity)<.9)return null;
  digits.set(slot,rows[0].n.textContent.trim());
 }
 let out='',bad=false;
 function walk(n){if(digits.has(n)){out+=digits.get(n);return;}if(n.nodeType===3){const t=n.textContent.trim();if(!t)return;if(/^[,$.\s]+$/.test(t))out+=t;else bad=true;return;}for(const child of n.childNodes)walk(child);}
 walk(root);if(bad)return null;
 const value=parseUSD(out);return value!==123456789.01?value:null;
}
function animatedRoot(n){return !!n?.style?.getPropertyValue('--height')&&n.classList.contains('overflow-hidden');}

function currentPrice(n){
 if(!n)return null;
 if(animatedRoot(n))return animatedPrice(n);
 const accept=x=>{const v=typeof x==='number'?x:typeof x==='string'?parseUSD(x):null;return Number.isFinite(v)&&v>0&&v!==123456789.01?v:null;};
 // Animated price components can expose real values separately from sizing text.
 const component=/^number-flow(?:-react)?$/.test(n.localName);
 if(component){const v=accept(n.value);if(v!==null)return v;}
 for(const key of ['aria-valuenow','data-value','aria-label']){const v=accept(n.getAttribute(key));if(v!==null)return v;}
 if(n.shadowRoot){const values=new Set();for(const el of n.shadowRoot.querySelectorAll('[aria-label],[aria-valuenow]')){const v=accept(el.getAttribute('aria-valuenow')||el.getAttribute('aria-label'));if(v!==null)values.add(v);}if(values.size===1)return [...values][0];}
 if(component)return null; // Never concatenate animated digit reels or sizing placeholders.
 return accept(n.innerText??n.textContent);
}

function opportunity(delta,buyUp,fresh){return !!fresh&&Number.isFinite(delta)&&Number.isFinite(buyUp)&&buyUp>=0&&buyUp<=1&&((delta>0&&buyUp<.5)||(delta<0&&buyUp>.5));}
let samplePending=false;
const observer=new MutationObserver(()=>{if(samplePending)return;samplePending=true;queueMicrotask(()=>{samplePending=false;sampleDOM();requestRender();});});
function observe(){observer.disconnect();for(const n of [currentNode,baseNode])if(n)observer.observe(n,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['aria-label','aria-valuenow','data-value']});}
let lastGoodDisplay=null;

let baselineProbe=null,baselineCommitted=null;
function inferFromNext(rec,next){
 const expected='btc-updown-5m-'+(Number(rec.slug.split('-').at(-1))+300);
 if(next.slug!==expected||!Number.isFinite(rec.baseline)||!Number.isFinite(next.price)||next.price<=0)return null;
 if(next.price===rec.baseline)return {source:'next_market_target',nextSlug:next.slug,endPrice:next.price,baseline:rec.baseline,tie:true,checkedAt:next.at};
 const winner=next.price>rec.baseline?'Up':'Down',won=rec.boughtSide.toLowerCase()===winner.toLowerCase();
 return {source:'next_market_target',nextSlug:next.slug,endPrice:next.price,baseline:rec.baseline,winner,won,pnlPerShare:(won?1:0)-rec.entryPrice,reversal:(rec.delta>0&&winner==='Down')||(rec.delta<0&&winner==='Up'),checkedAt:next.at};
}
function rememberBaseline(slug,price){
 if(!slug||!Number.isFinite(price)||price<=0)return;
 const now=Date.now(),start=Number(slug.split('-').at(-1))*1000;
 if(now<start||now>=start+300000)return;
 // Settle locally as soon as this route supplies its first valid target price.
 const signature=slug+':'+price;if(baselineCommitted===signature)return;
 const next={slug,price,at:now};GM_setValue('pm-baseline:'+slug,next);
 const previous='btc-updown-5m-'+(Number(slug.split('-').at(-1))-300);
 for(const rec of history().filter(r=>r.slug===previous)){
  const estimate=inferFromNext(rec,next);if(estimate)GM_setValue('pm-event:'+rec.id,{...rec,nextTargetResult:estimate,status:rec.status==='resolved'?'resolved':estimate.tie?'pending':'next_target_settled'});
 }
 baselineCommitted=signature;showHistory();
}
function resultText(r){
 if(r.status!=='pending')return (r.pnlPerShare>0?'盈利':'未盈利')+' '+r.pnlPerShare.toFixed(3)+' USD · '+(r.reversal?'反转':'未反转')+' · 官方结算';
 const e=r.nextTargetResult;if(!e)return '待下一期目标价/官方结算';
 if(e.tie)return '下一期目标价相同，待官方结算';
 return (e.pnlPerShare>0?'盈利':'未盈利')+' '+e.pnlPerShare.toFixed(3)+' USD · '+(e.reversal?'反转':'未反转')+' · 依据下一期目标价（待核对）';
}

function sampleDOM(){
 if(!running||document.hidden)return;
 const slug=pageSlug();if(boundSlug!==slug){currentNode=baseNode=null;currentValue=baseValue=null;domAt=0;boundSlug=null;lastGoodDisplay=null;observe();return;}
 baseValue=baseNode?.isConnected?parseUSD(baseNode.textContent):null;
 rememberBaseline(slug,baseValue);
 const difference=signedDifference(currentNode),now=Date.now();
 if(baseValue!==null&&difference!==null){currentValue=baseValue+difference;domAt=now;lastGoodDisplay={slug,base:baseValue,value:currentValue,at:now};}
 else{domAt=0;currentValue=lastGoodDisplay?.slug===slug&&lastGoodDisplay.base===baseValue&&now-lastGoodDisplay.at<=1500?lastGoodDisplay.value:null;}
}
function requestRender(){if(renderTimer!==null)return;renderTimer=setTimeout(()=>{renderTimer=null;render();},200);}
const usd=n=>n===null?'—':n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function render(){
const slug=pageSlug(),start=Number(slug?.split('-').at(-1))*1000,active=slug&&Date.now()>=start&&Date.now()<start+300000;
const delta=currentValue!==null&&baseValue!==null?currentValue-baseValue:null;
moneyView(btc,'BTC 当前 $'+usd(currentValue)+'\n本期基准 $'+usd(baseValue)+'\n涨跌点数 '+(delta===null?'—':(delta>=0?'+':'')+delta.toFixed(2))+' USD');
const quotes=market?.slug===slug?market.quotes:[];
moneyView(book,quotes.length?quotes.map(q=>q.name+' · Buy '+(q.ask===null?'—':(q.ask*100).toFixed(1)+'¢')+' / Sell '+(q.bid===null?'—':(q.bid*100).toFixed(1)+'¢')).join('\n'):'等待本页盘口');
const up=quotes.find(q=>/^up$/i.test(q.name));
const fresh=running&&!document.hidden&&active&&boundSlug===slug&&domAt>0&&Date.now()-domAt<=3000&&up?.at>0&&Date.now()-up.at<=5000;
signal.textContent=opportunity(delta,up?.ask,fresh)?'机会':'';recordSignal(slug,delta,quotes,fresh,!!signal.textContent);
reason.textContent=!running?'已停止':!active?'本期未开始或已结束，请切换当前市场':!domAt?'正在自动识别当前价和起始价，无需点击绑定':!fresh?'数据过期或页面在后台，暂停判断':signal.textContent?'满足设定的方向/Buy Up 偏离条件':'未达到偏离条件';
if(fresh)status.textContent=(transportName==='WebSocket'?'WS':transportName)+' · '+((Date.now()-quoteAt)/1000).toFixed(1)+'秒前';
}
function json(url){return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'GET',url,timeout:10000,onload:r=>{try{if(r.status!==200)throw Error('HTTP '+r.status);resolve(JSON.parse(r.responseText));}catch(e){reject(e);}},onerror:()=>reject(Error('网络或扩展权限错误')),ontimeout:()=>reject(Error('请求超时'))}));}
const arr=x=>typeof x==='string'?JSON.parse(x):x;
function valid(x){const n=Number(x);return x!==undefined&&x!==null&&x!==''&&Number.isFinite(n)&&n>=0&&n<=1?n:null;}
function emit(transport){if(market){quoteAt=Date.now();transportName=transport;requestRender();}}
function connect(m){lastConnect=Date.now();socket?.close();const ws=new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');socket=ws;ws.onopen=()=>{if(socket!==ws||!running){ws.close();return;}lastWire=Date.now();ws.send(JSON.stringify({assets_ids:m.tokens,type:'market',custom_feature_enabled:true}));};ws.onmessage=e=>{if(socket!==ws||market!==m||!running||pageSlug()!==m.slug)return;try{lastWire=Date.now();if(e.data==='PONG')return;const data=JSON.parse(e.data);for(const a of Array.isArray(data)?data:[data]){const changes=a.event_type==='price_change'?a.price_changes:[a];for(const x of changes||[]){const i=m.tokens.indexOf(x.asset_id);if(i<0)continue;if(a.event_type==='book'){m.quotes[i].bid=x.bids?.length?Math.max(...x.bids.map(b=>Number(b.price))):null;m.quotes[i].ask=x.asks?.length?Math.min(...x.asks.map(b=>Number(b.price))):null;}else if(x.best_bid!==undefined||x.best_ask!==undefined){m.quotes[i].bid=valid(x.best_bid);m.quotes[i].ask=valid(x.best_ask);}else continue;m.quotes[i].at=Date.now();emit('WebSocket');}}}catch{status.textContent='行情消息解析失败';}};ws.onerror=()=>{status.textContent='WS 断开 · REST 采样';};}
async function poll(){if(!running||busy||document.hidden)return;busy=true;try{const slug=pageSlug(),epoch=Number(slug?.split('-').at(-1));if(!slug||Date.now()<epoch*1000||Date.now()>=epoch*1000+300000){status.textContent=followMessage||'请打开正在进行的 BTC 五分钟市场';return;}if(market?.slug!==slug){socket?.close();socket=null;market=null;quoteAt=0;const list=await json('https://gamma-api.polymarket.com/markets?slug='+slug);if(!running||document.hidden||pageSlug()!==slug)return;const m=list.find(x=>x.slug===slug&&!x.closed);if(!m)throw Error('当前五分钟市场尚不可用');const tokens=arr(m.clobTokenIds),names=arr(m.outcomes);if(tokens?.length!==2||names?.length!==2)throw Error('市场数据格式不符');market={slug,tokens,quotes:names.map(name=>({name,bid:null,ask:null}))};}const m=market;if(socket?.readyState===1&&Date.now()-lastWire>30000){socket.close();socket=null;}if(!socket||socket.readyState>1){if(Date.now()-lastConnect>5000){try{connect(m);}catch{status.textContent='WS 受限 · REST 采样';}}}if(socket?.readyState===1&&m.quotes.every(q=>q.bid!==null||q.ask!==null)&&Date.now()-lastBookAt<10000){status.textContent='WS · 已连接';return;}const wireAtRequest=lastWire;const books=await Promise.all(m.tokens.map(t=>json('https://clob.polymarket.com/book?token_id='+encodeURIComponent(t))));if(!running||market!==m||pageSlug()!==slug||Date.now()>=epoch*1000+300000)return;lastBookAt=Date.now();if(socket?.readyState!==1||lastWire===wireAtRequest||m.quotes.some(q=>q.bid===null&&q.ask===null)){books.forEach((b,i)=>{m.quotes[i].at=Date.now();m.quotes[i].bid=b.bids?.length?Math.max(...b.bids.map(x=>Number(x.price))):null;m.quotes[i].ask=b.asks?.length?Math.min(...b.asks.map(x=>Number(x.price))):null;});emit('REST');}status.textContent='运行中 · 自动跟随';}catch(e){status.textContent='采集失败：'+e.message;}finally{busy=false;}}


// Binding templates require a nearby field label, not just an old numeric position.

function normalLabel(text){return text.replace(/\s+/g,' ').replace(/[：:]\s*$/,'').trim().toLowerCase();}
function labelFor(kind){return kind==='current'?/^(current price|current btc price|当前价格|当前价|当前比特币价格|現在価格|現在の価格)$/:/^(price to beat|target price|起始价|起始价格|基准价|目标价格|目標価格|基準価格)$/;}
function visible(n){return n.getClientRects().length>0&&!n.closest('[aria-hidden="true"],[hidden]')&&getComputedStyle(n).visibility!=='hidden';}
function largestPriceText(values){
 const ranked=values.map(node=>({node,size:Math.max(...[node,...node.querySelectorAll('*')].filter(visible).map(n=>parseFloat(getComputedStyle(n).fontSize)||0))}));
 const max=Math.max(...ranked.map(x=>x.size));
 return ranked.filter(x=>x.size===max).map(x=>x.node);
}

function priceAtLabelPoint(labels){
 const found=new Set();
 for(const label of labels){
  const r=label.getBoundingClientRect();if(r.width<=0||r.height<=0)continue;
  // Coordinates follow the live label, not screenshot pixels or a fixed viewport.
  for(const dx of [20,50,80])for(const dy of [16,30,44]){
   const x=r.left+dx,y=r.bottom+dy;
   if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
   let n=document.elementFromPoint(x,y);
   for(let i=0;n&&i<10;i++,n=n.parentElement){
    if(!animatedRoot(n))continue;
    const b=n.getBoundingClientRect(),font=parseFloat(getComputedStyle(n).fontSize);
    if(b.top>=r.bottom-4&&b.top-r.bottom<65&&Math.abs(b.left-r.left)<45&&font>=20&&visible(n))found.add(n);
    break;
   }
  }
 }
 return found.size===1?[...found][0]:null;
}



function explicitDirection(node){
 const text=(node.getAttribute('aria-label')||'')+' '+node.textContent;
 const up=/[▲△↑]|\b(up|increase)\b/i.test(text),down=/[▼▽↓]|\b(down|decrease)\b/i.test(text);
 return up&&down?0:up?1:down?-1:null;
}
let colorContext;
function colorDirection(css){
 // Safari can return color(display-p3 ...) / oklch(...), NOT RGB components.
 if(!colorContext){const canvas=document.createElement('canvas');canvas.width=canvas.height=1;colorContext=canvas.getContext('2d',{willReadFrequently:true});}
 if(!colorContext)return null;
 colorContext.clearRect(0,0,1,1);colorContext.fillStyle=css;colorContext.fillRect(0,0,1,1);
 const [r,g,b,a]=colorContext.getImageData(0,0,1,1).data;if(a<200)return null;
 if(r>g*1.25&&r>b*1.25)return -1;
 if(b>r*1.25&&b>g*1.1)return 1;
 return null;
}
function signedDifference(node){
 if(!node?.isConnected)return null;
 const magnitude=animatedRoot(node)?animatedPrice(node):parseUSD((node.innerText||node.textContent).replace(/[▲△↑▼▽↓+−-]/g,''));
 if(magnitude===null)return null;if(magnitude===0)return 0;
 const scopes=[node,node.parentElement,node.parentElement?.parentElement].filter(Boolean);
 // Direction indicators win over text colors. Never search the whole market card.
 const arrows=new Set(scopes.map(explicitDirection).filter(x=>x!==null));
 if(arrows.has(0)||arrows.size>1)return null;
 if(arrows.size===1)return [...arrows][0]*Math.abs(magnitude);

 // Prefer the nearby direction icon; animated digits may temporarily flash another color.
 const rect=node.getBoundingClientRect();
 for(const scope of scopes.slice(1)){
  const icons=[...scope.querySelectorAll('svg')].filter(icon=>{const r=icon.getBoundingClientRect();return r.width>0&&Math.abs((r.top+r.bottom-rect.top-rect.bottom)/2)<20&&Math.abs(r.right-rect.left)<55;});
  const signs=new Set(icons.map(icon=>{const style=getComputedStyle(icon);return colorDirection(style.fill==='none'?style.color:style.fill);}).filter(x=>x!==null));
  if(signs.size===1)return [...signs][0]*Math.abs(magnitude);
  if(signs.size>1)return null;
 }
 for(const scope of scopes.slice(0,2)){const sign=colorDirection(getComputedStyle(scope).color);if(sign!==null)return sign*Math.abs(magnitude);}
 return null;

}
function differenceAtLabel(labels){
 const found=new Set();
 for(const label of labels){const l=label.getBoundingClientRect();let scope=label.parentElement;
 for(let depth=0;scope&&depth<3;depth++,scope=scope.parentElement){
  for(const n of scope.querySelectorAll('*')){
   if(!animatedRoot(n)||!visible(n))continue;
   const r=n.getBoundingClientRect(),font=parseFloat(getComputedStyle(n).fontSize);
   if(font<=22&&font>=9&&r.left>=l.right-15&&r.left-l.right<180&&Math.abs((r.top+r.bottom-l.top-l.bottom)/2)<25)found.add(n);
  }
 }
 }
 return found.size===1?[...found][0]:null;
}

function fieldPrice(kind){
 const all=[...document.querySelectorAll('span,div,p,label,dt,dd,h2,h3,h4,strong')];
 const matches=(n,k)=>labelFor(k).test(normalLabel(n.textContent))||labelFor(k).test(normalLabel([...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent).join(' ')));
 // Use the innermost visible text label, never a saved child index or coordinate.
 const labels=all.filter(n=>visible(n)&&matches(n,kind)&&![...n.children].some(c=>matches(c,kind)));
 if(kind==='current')return differenceAtLabel(labels);
 const found=new Set();
 for(const label of labels){
  let scope=label;
  for(let depth=0;scope&&depth<6;depth++,scope=scope.parentElement){
   if(scope===document.body||scope.textContent.length>800)break;
   const nodes=[...scope.querySelectorAll('*')].filter(visible);
   if(nodes.some(n=>matches(n,kind==='current'?'base':'current')))break;
   const animated=kind==='current'?nodes.filter(animatedRoot):[];
   if(animated.length){for(const node of animated)found.add(node);continue;}
   const semantic=kind==='current'?nodes.filter(n=>(/^number-flow(?:-react)?$/.test(n.localName)||n.hasAttribute('aria-valuenow')||n.hasAttribute('data-value')||n.hasAttribute('aria-label'))&&currentPrice(n)!==null):[];
   const candidates=semantic.length?semantic:nodes.filter(n=>(kind==='current'?currentPrice(n):parseUSD(n.textContent))!==null);
   // Keep the complete price wrapper, not each digit/decimal child.
   let values=candidates.filter(n=>!candidates.some(p=>p!==n&&p.contains(n)));
   if(kind==='current'&&values.length>1)values=largestPriceText(values);
   if(kind==='current'){for(const node of values)found.add(node);continue;}
   if(values.length===1){found.add(values[0]);break;}
   if(values.length>1)break; // Ambiguity is not resolved by taking the first number.
  }
 }
 const result=kind==='current'?largestPriceText([...found].some(animatedRoot)?[...found].filter(animatedRoot):[...found]):[...found];
 return result.length===1?result[0]:(kind==='current'?priceAtLabelPoint(labels):null);
}
function saveBinding(kind,n){GM_setValue('pm-bind-'+kind,{mode:'label',label:kind});autoKinds.delete(kind);}
const autoKinds=new Set();
let route=pageSlug(),routeAt=Date.now();
function autoBind(){
 const slug=pageSlug();if(slug!==route){route=slug;routeAt=Date.now();currentNode=baseNode=null;currentValue=baseValue=null;domAt=0;boundSlug=null;autoKinds.clear();observe();}
 if(!slug)return;
 for(const kind of ['current','base']){
  const target=fieldPrice(kind);
  if(target){if(kind==='current')currentNode=target;else baseNode=target;autoKinds.add(kind);}
  else if(autoKinds.has(kind)){if(kind==='current')currentNode=null;else baseNode=null;}
 }
 // A missing current quote must not invalidate the valid baseline on this route.
 boundSlug=slug;
 if(currentNode===baseNode)currentNode=null;
 observe();sampleDOM();requestRender();
 if(currentValue===null||baseValue===null)status.textContent='价格识别中 · 暂停判断';
}

let following=false,lastFollowCheck=0,followMessage='';
function verifiedCurrentMarket(list,slug,now){
 const start=Number(slug.split('-').at(-1))*1000;
 if(!Number.isFinite(start)||now<start||now>=start+300000||!Array.isArray(list))return null;
 const m=list.find(x=>x.slug===slug&&x.active===true&&x.closed===false);
 if(!m||Date.parse(m.endDate)!==start+300000)return null;
 const event=m.events?.find(e=>e.slug===slug);
 if(!event||Date.parse(event.startTime)!==start)return null;
 return m;
}
async function followLive(){
 if(following||!running||document.hidden||!GM_getValue('pm-auto',true))return;
 const old=pageSlug();if(!old)return;
 const now=Date.now(),oldStart=Number(old.split('-').at(-1))*1000;
 if(now<oldStart+300000||now-lastFollowCheck<4000)return;
 following=true;lastFollowCheck=now;
 try{
  const target='btc-updown-5m-'+(Math.floor(now/300000)*300);
  const list=await json('https://gamma-api.polymarket.com/markets?slug='+target);
  if(!running||document.hidden||pageSlug()!==old||!GM_getValue('pm-auto',true))return;
  if(!verifiedCurrentMarket(list,target,Date.now())){followMessage='新市场尚未确认，4 秒后重试';return;}
  // Write destination receipt before full-page navigation; new document verifies it.
  sessionStorage.setItem('pm-follow-receipt',JSON.stringify({from:old,to:target,at:Date.now()}));
  followMessage='已核实新市场，正在切换';
  socket?.close();socket=null;quoteAt=0;domAt=0;signal.textContent='';
  location.replace(location.origin+'/event/'+target);
 }catch(e){followMessage='换期失败，将重试：'+e.message;}finally{following=false;}
}
function verifyArrival(){try{const r=JSON.parse(sessionStorage.getItem('pm-follow-receipt')||'null');if(!r)return;if(r.to===pageSlug()){followMessage='已到达新市场，正在恢复绑定';sessionStorage.removeItem('pm-follow-receipt');GM_setValue('pm-last-follow',{...r,arrivedAt:Date.now()});}else followMessage='目标页面未到达，等待重新检查';}catch{followMessage='无法读取换期回执';}}

function withMoney(rec){
 const stake=rec.stakeUSD??100,price=rec.entryPrice;
 if(!Number.isFinite(price)||price<=0||price>1)return {...rec,accounting:null};
 const shares=stake/price;
 const result=rec.status==='resolved'?rec:rec.nextTargetResult&&!rec.nextTargetResult.tie?rec.nextTargetResult:null;
 const basis=rec.status==='resolved'?'official':result?'next_target':'pending';
 const payout=result?(result.won?shares:0):null;
 return {...rec,stakeUSD:stake,shares,accounting:{basis,payoutUSD:payout,pnlUSD:payout===null?null:payout-stake,feesIncluded:false}};
}
function moneyTotals(records){
 const t={official:0,estimated:0,pending:0,invested:0,count:records.length};
 for(const raw of records){const r=withMoney(raw),a=r.accounting;if(!a)continue;t.invested+=r.stakeUSD;if(a.basis==='official')t.official+=a.pnlUSD;else if(a.basis==='next_target')t.estimated+=a.pnlUSD;else t.pending+=r.stakeUSD;}
 return t;
}
function moneyText(r){const a=r.accounting;if(!a)return '价格无效，未计算';if(a.basis==='pending')return '投入 $'+r.stakeUSD.toFixed(2)+' · 待结算';return '投入 $'+r.stakeUSD.toFixed(2)+' · 回款 $'+a.payoutUSD.toFixed(2)+' · 盈亏 '+(a.pnlUSD>=0?'+':'')+'$'+a.pnlUSD.toFixed(2)+' · '+(a.basis==='official'?'官方结算':'已结算：下一期目标价');}

function history(){const raw=GM_listValues().filter(k=>k.startsWith('pm-event:')).map(k=>GM_getValue(k)).filter(Boolean).sort((a,b)=>a.at-b.at);const unique=new Map();for(const r of raw)if(!unique.has(r.slug))unique.set(r.slug,r);return [...unique.values()].map(withMoney).sort((a,b)=>b.at-a.at);}
function recordSignal(slug,delta,quotes,fresh,on){
 if(!slug||!fresh)return;const key='pm-episode:'+slug;if(history().some(r=>r.slug===slug))return;let episode=GM_getValue(key,null);
 if(!on){if(episode?.active){episode.active=false;GM_setValue(key,episode);}return;}
 if(episode?.active)return;
 if(quotes.length!==2||quotes.some(q=>!Number.isFinite(q.ask)||q.ask<0||q.ask>1||!q.at||Date.now()-q.at>5000))return;
 if(quotes[0].ask===quotes[1].ask)return;
 const expensive=quotes.reduce((a,b)=>a.ask>b.ask?a:b),id='slug:'+slug;
 const rec={id,slug,at:Date.now(),btc:currentValue,baseline:baseValue,delta,quotes:JSON.parse(JSON.stringify(quotes)),boughtSide:expensive.name,entryPrice:expensive.ask,status:'pending',simulated:true,stakeUSD:100,shares:100/expensive.ask};
 try{GM_setValue('pm-event:'+id,rec);GM_setValue(key,{active:true,id});}catch{status.textContent='历史保存失败，请导出备份';}
}
function finalWinner(m){if(!m?.closed||m.umaResolutionStatus!=='resolved')return null;try{const names=arr(m.outcomes),prices=arr(m.outcomePrices).map(Number);if(names.length!==2||prices.length!==2||prices.filter(x=>x===1).length!==1||prices.filter(x=>x===0).length!==1)return null;return names[prices.indexOf(1)];}catch{return null;}}
function settleRecord(rec,winner){const win=rec.boughtSide.toLowerCase()===winner.toLowerCase();return {...rec,status:'resolved',winner,won:win,pnlPerShare:(win?1:0)-rec.entryPrice,reversal:(rec.delta>0&&/^down$/i.test(winner))||(rec.delta<0&&/^up$/i.test(winner)),checkedAt:Date.now(),feesIncluded:false};}
let checking=false,settleCursor=0;
async function checkSettlements(){if(checking||!running||document.hidden)return;checking=true;try{const slugs=[...new Set(history().filter(r=>r.status!=='resolved'&&Date.now()>Number(r.slug.split('-').at(-1))*1000+300000).map(r=>r.slug))];if(!slugs.length)return;const slug=slugs[settleCursor++%slugs.length],list=await json('https://gamma-api.polymarket.com/markets?slug='+encodeURIComponent(slug)),m=list.find(m=>m.slug===slug),winner=finalWinner(m);if(!winner)return;for(const rec of history().filter(r=>r.slug===slug&&r.status!=='resolved'))GM_setValue('pm-event:'+rec.id,settleRecord(rec,winner));showHistory();}catch{status.textContent='结算查询未完成，保留待结算记录';}finally{checking=false;}}
function showHistory(){const records=history(),t=moneyTotals(records),nl=String.fromCharCode(10);moneyView(totalView,'模拟每笔 $100 · '+t.count+' 笔'+nl+'已确认盈亏 $'+t.official.toFixed(2)+' · 按下一期目标价结算 $'+t.estimated.toFixed(2)+nl+'当前总盈亏$'+(t.official+t.estimated).toFixed(2)+' · 待结算投入 $'+t.pending.toFixed(2));if(!historyOpen)return;historyView.replaceChildren();for(const r of records.slice(0,20)){const row=el('div','',historyView),pnl=r.accounting?.pnlUSD;row.className='history-entry '+(Number.isFinite(pnl)&&pnl>0?'profit':Number.isFinite(pnl)&&pnl<0?'loss':'neutral');moneyView(row,new Date(r.at).toLocaleString()+' '+r.boughtSide+' '+(r.entryPrice*100).toFixed(1)+'¢ · '+(r.shares?.toFixed(4)||'—')+'份'+nl+moneyText(r)+' · '+((r.status==='resolved'?r:r.nextTargetResult)?.reversal===true?'反转':(r.status==='resolved'?r:r.nextTargetResult)?.reversal===false?'未反转':'方向待结算'));}}

setInterval(()=>{if(running&&!document.hidden){autoBind();followLive();}},2000);

let spotBusy=false,spotSamples=[],spotLast=null;
function velocity(samples){if(samples.length<2)return null;const first=samples[0],last=samples.at(-1),seconds=(last.time-first.time)/1000;if(seconds<=0)return null;return {usdPerSecond:(last.price-first.price)/seconds,percentPerSecond:(last.price/first.price-1)*100/seconds,seconds};}
async function pollSpot(){
 if(!running||document.hidden||spotBusy)return;spotBusy=true;
 try{
  const data=await json('https://api.exchange.coinbase.com/products/BTC-USD/ticker');
  if(!running||document.hidden)return;
  const price=Number(data.price),time=Date.parse(data.time),now=Date.now();
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(time)||time>now+5000||now-time>15000)throw Error('行情时间无效或超过15秒');
  if(spotLast&&time<spotLast.time)throw Error('收到较旧报价');
  if(!spotLast||time>spotLast.time){spotLast={price,time};spotSamples.push(spotLast);spotSamples=spotSamples.filter(x=>time-x.time<=10000).slice(-20);}
  const v=velocity(spotSamples);
  moneyView(spotView,'Coinbase 现货 BTC/USD $'+price.toFixed(2)+' · '+((now-time)/1000).toFixed(1)+'秒前'+String.fromCharCode(10)+(v?'近'+v.seconds.toFixed(1)+'秒增速 '+(v.usdPerSecond>=0?'+':'')+v.usdPerSecond.toFixed(2)+' USD/秒 · '+v.percentPerSecond.toFixed(5)+'%/秒':'增速：等待下一笔报价'));
 }catch(e){moneyView(spotView,'Coinbase 行情不可用：'+e.message);}finally{spotBusy=false;}
}
setInterval(pollSpot,1000);
pollSpot();

setInterval(checkSettlements,15000);
setInterval(showHistory,5000);
showHistory();
setTimeout(checkSettlements,3000);

setInterval(()=>{if(running&&!document.hidden){if(!currentNode?.isConnected)autoBind();sampleDOM();requestRender();}},150);
setInterval(()=>{if(boundSlug&&boundSlug!==pageSlug()){currentNode=baseNode=null;currentValue=baseValue=null;boundSlug=null;domAt=0;observe();}sampleDOM();poll();requestRender();},1000);
setInterval(()=>{if(socket?.readyState===1)socket.send('PING');},10000);
document.addEventListener('visibilitychange',()=>{quoteAt=0;lastBookAt=0;if(document.hidden){socket?.close();socket=null;}else{sampleDOM();poll();}render();});
verifyArrival();autoBind();sampleDOM();poll();render();followLive();
 }catch(error){const note=document.createElement('div');note.textContent='BTC 0.5.1 启动失败：'+error.message;note.style.cssText='position:fixed;top:10px;left:10px;z-index:2147483647;padding:12px;background:white;color:red';document.documentElement.append(note);}
})();