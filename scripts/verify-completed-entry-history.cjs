const fs = require('node:fs'), crypto = require('node:crypto'), assert = require('node:assert/strict');
require('tsx/cjs');
const { classifyStockRegime, analyzeMarketRegimeData } = require('../server/research/marketRegimeResearch.ts');
const { rankAdaptiveCandidateStrategies } = require('../server/research/adaptiveCandidateStrategy.ts');
const { routeAdaptiveStrategies } = require('../server/research/adaptiveStrategyRouter.ts');
const [inputPath, resultPath, repeatPath, outputPrefix, contractPath] = process.argv.slice(2);
if (!inputPath || !resultPath || !repeatPath || !outputPrefix || !contractPath) throw Error('Expected frozen input, result, repeat, output prefix, volume declaration');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const bytes = fs.readFileSync(resultPath); assert.deepEqual(bytes, fs.readFileSync(repeatPath));
const input = read(inputPath), result = read(resultPath);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(fs.readFileSync(inputPath)), '32fc7da6789ebcd55660f7b031d036ad070e09b3baa8d919c8391350f9963d01');
assert.equal(result.inputSha256, sha(fs.readFileSync(inputPath)));
const declaration = read(contractPath);
assert.equal(declaration.inputSha256, result.inputSha256);
assert.equal(declaration.source, 'eastmoney-stock-history');
assert.equal(declaration.volumeUnit, 'lots'); // This verifier is for the original native-lot frozen fixture.
assert.deepEqual(result.volumeContract, {...declaration, contractSha256: sha(fs.readFileSync(contractPath))});
assert.equal(result.results.length, 72);
const keys = ['kairosVolumePriceBreakout','kairosVolatilityContractionBreakout','aSharePullback'];
const symbols = input.history.series.map(s => s.symbol).sort(); assert.equal(symbols.length,12);
const dates = input.history.series[0].bars.map(b => b.date);
assert.equal(dates.length,500); assert(input.history.series.every(s => JSON.stringify(s.bars.map(b=>b.date))===JSON.stringify(dates)));
const windows = [dates.slice(0,166),dates.slice(166,332),dates.slice(332)];
const expected = new Set(keys.flatMap(key=>['proxy','structure'].flatMap(mode=>['base','stress'].flatMap(cost=>
 [1,2,3].flatMap(window=>['ascending','descending'].map(order=>[key,mode,cost,window,order].join(':')))))));
const groups = new Set(), rowIndex = new Map(), structureIndex = new Map(), proxyIndex = new Map();
const suppliedRows = new Map(result.evidenceRows.map(r=>[[r.symbol,r.closeTime.slice(0,10),r.strategyKey].join(':'),r]));
assert.equal(suppliedRows.size,result.evidenceRows.length);
const empty = {provider:'akshare',source:'offline-no-sectors',fetchedAt:result.asOf,warning:null,series:[]};
const routing = routeAdaptiveStrategies(analyzeMarketRegimeData({asOf:new Date(result.asOf),mode:'paper',provider:'offline',days:500,
 sectorResponse:{...empty,sectors:[]},sectorHistory:empty,stockHistory:empty,stockNames:new Map()}));
const avg = xs => xs.reduce((a,b)=>a+b,0)/xs.length;
let checkedStructure = 0, checkedProxy = 0;
for(const s of input.history.series) for(let i=0;i<s.bars.length;i++) {
 assert.equal(s.source,'eastmoney-stock-history','Only the documented frozen lots source is accepted');
 const bar=s.bars[i],prior=s.bars.slice(0,i),prev=prior.at(-1),prefix=s.bars.slice(0,i+1);
 assert(Date.parse(`${bar.date}T15:00:00+08:00`)<=Date.parse(result.asOf));
 const stock = i>=120?{rank:1,...classifyStockRegime(s.symbol,s.name,prior)}:null;
 const quote=prev?{symbol:s.symbol,name:s.name,price:bar.close,previousClose:prev.close,tradable:bar.volume>0,volume:bar.volume*100,
  amount:bar.amount??undefined,turnover:bar.turnover??undefined,open:bar.open,high:bar.high,low:bar.low,
  amplitude:(bar.high-bar.low)/prev.close*100,changePercent:(bar.close/prev.close-1)*100,updatedAt:`${bar.date}T15:00:00+08:00`}:null;
 let facts;
 if(prefix.length>=61){
  const before20=prefix.slice(-21,-1),before40=prefix.slice(-61,-21),meanV=avg(before20.map(b=>b.volume));
  const lowWindow=prefix.slice(-7,-1);let lowOffset=0;for(let j=1;j<lowWindow.length;j++)if(lowWindow[j].low<=lowWindow[lowOffset].low)lowOffset=j;
  const lowIndex=prefix.length-7+lowOffset,low=prefix[lowIndex],anchorBars=prefix.slice(lowIndex-20,lowIndex);
  const anchorHigh=Math.max(...anchorBars.map(b=>b.high)),lowMeanV=avg(anchorBars.map(b=>b.volume));
  const range40=avg(before40.map(b=>(b.high-b.low)/b.close));
  facts={breaks:bar.close>Math.max(...before20.map(b=>b.high)),volume:bar.volume>0&&meanV>0?bar.volume/meanV:null,
   contraction:range40>0?avg(before20.map(b=>(b.high-b.low)/b.close))/range40:null,
   drawdown:1-low.low/anchorHigh,recovery:bar.close/low.low-1,aboveYesterday:bar.close>prev.high,
   lowVolume:low.volume>0&&lowMeanV>0?low.volume/lowMeanV:null,afterLow:bar.date>low.date};
 }
 for(const key of keys){
  let structure='unknown';
  if(facts&&facts.volume!==null){
   if(key==='kairosVolumePriceBreakout')structure=facts.breaks&&facts.volume>=1.5?'confirmed':'not-confirmed';
   if(key==='kairosVolatilityContractionBreakout'&&facts.contraction!==null)structure=facts.breaks&&facts.volume>=1.4&&facts.contraction<=.62?'confirmed':'not-confirmed';
   if(key==='aSharePullback'&&facts.lowVolume!==null)structure=facts.drawdown>0&&facts.drawdown<=.07&&facts.recovery>=.008&&facts.aboveYesterday&&facts.lowVolume<=1&&facts.volume>=1.15&&facts.afterLow?'confirmed':'not-confirmed';
  }
  const proxy=stock!==null&&rankAdaptiveCandidateStrategies({quote,stockRegime:stock,routing,executionStrategy:key,candidateScore:80}).some(r=>r.strategyKey===key);
  const id=[s.symbol,bar.date,key].join(':');structureIndex.set(id,structure);proxyIndex.set(id,proxy);
  const evidence=suppliedRows.get(id);
  assert(evidence&&!rowIndex.has(id));rowIndex.set(id,evidence);
  assert.equal(evidence.structure,structure);assert.equal(evidence.proxyEligible,proxy);
  assert.equal(evidence.priorHistoryDate,stock?.latestDate??null);assert.equal(evidence.priorBarCount,i);
  assert.equal(evidence.structureLatestDate,bar.date);checkedStructure++;checkedProxy++;
 }
}
assert.equal(result.evidenceRows.length,18000);assert.equal(rowIndex.size,18000);
let checkedFills=0,checkedEntries=0,minimumCash=20000;
for(const row of result.results){
 const id=[row.strategyKey,row.entryMode,row.cost.label,row.window,row.order].join(':');assert(expected.has(id)&&!groups.has(id));groups.add(id);
 assert.deepEqual(row.methodology.childOrder,row.order==='ascending'?symbols:[...symbols].reverse());
 let cash=20000,fees=0,closed=0,wins=0;const lots=new Map();
 for(const trade of row.trades){
  const day=trade.time.slice(0,10),window=windows[row.window-1],dayIndex=window.indexOf(day);
  assert(dayIndex>0);assert.equal(trade.time,day+'T09:30:00+08:00');assert.equal(trade.barIndex,dayIndex*2);
  assert(trade.quantity>0&&trade.quantity%100===0);
  const series=input.history.series.find(s=>s.symbol===trade.symbol),bar=series.bars.find(b=>b.date===day);assert(bar&&bar.volume>0);
  const price=Number((bar.open*(1+(trade.side==='buy'?1:-1)*row.cost.slippageBps/10000)).toFixed(2));
  assert.equal(trade.price,price);assert.equal(trade.notional,price*trade.quantity);
  assert.equal(trade.commission,Number(Math.max(row.cost.minimumCommission,trade.notional*row.cost.commissionRate).toFixed(2)));
  const owned=lots.get(trade.symbol)||[];
  if(trade.side==='buy'){
   assert.equal(owned.reduce((s,l)=>s+l.quantity,0),0,'No addition while actually held');
   const decisionDate=window[dayIndex-1],key=[trade.symbol,decisionDate,row.strategyKey].join(':');assert.equal(proxyIndex.get(key),true);
   if(row.entryMode==='structure')assert.equal(structureIndex.get(key),'confirmed');
   assert(trade.notional<=5000);
   cash-=trade.notional+trade.commission;owned.push({day,quantity:trade.quantity,unitPrice:trade.price,unitCost:(trade.notional+trade.commission)/trade.quantity});checkedEntries++;
  }else{
   const active=owned.filter(l=>l.quantity>0);assert.equal(active.length,1);
   const lot=active[0],decisionDate=window[dayIndex-1],decisionBar=series.bars.find(b=>b.date===decisionDate);
   assert(lot.day<decisionDate,'Sell decision cannot borrow tomorrow unlock');
   const holdingCloses=window.indexOf(decisionDate)-window.indexOf(lot.day)+1;
   assert(decisionBar.close<=lot.unitPrice*.97||decisionBar.close>=lot.unitPrice*1.05||holdingCloses>=10,'Exit must follow common fixed policy');
   assert.equal(trade.quantity,lot.quantity);
   let remaining=trade.quantity;
   for(const lot of owned){if(lot.day>=day)continue;const quantity=Math.min(remaining,lot.quantity);if(!quantity)continue;
    const pnl=(trade.notional-trade.commission)/trade.quantity*quantity-lot.unitCost*quantity;closed++;if(pnl>0)wins++;
    lot.quantity-=quantity;remaining-=quantity;}
   assert.equal(remaining,0,'No T+0 or oversold lots');cash+=trade.notional-trade.commission;
  }
  lots.set(trade.symbol,owned);fees+=trade.commission;checkedFills++;assert(cash>=-.005);minimumCash=Math.min(minimumCash,cash);
 }
 assert(Math.abs(cash-row.metrics.cash)<.001);assert(Math.abs(fees-row.metrics.commission)<.001);
 assert.equal(closed,row.metrics.closedMatches);assert.equal(wins,row.metrics.winningMatches);
 assert.equal(row.metrics.closedMatchWinRate,closed?wins/closed:null);
 for(const[symbol,owned]of lots)assert.equal(owned.reduce((s,l)=>s+l.quantity,0),row.finalPositions.find(p=>p.symbol===symbol)?.quantity||0);
 for(const p of row.finalPositions)assert.equal(p.quantity,(lots.get(p.symbol)||[]).reduce((s,l)=>s+l.quantity,0));
 let replayCash=20000,peak=20000,drawdown=0,equity=20000;const holdings=new Map();
 for(const day of windows[row.window-1]){
  for(const t of row.trades.filter(t=>t.time.slice(0,10)===day)){holdings.set(t.symbol,(holdings.get(t.symbol)||0)+(t.side==='buy'?t.quantity:-t.quantity));replayCash+=t.side==='buy'?-t.notional-t.commission:t.notional-t.commission;}
  for(const field of ['open','close']){const value=[...holdings].reduce((sum,[symbol,quantity])=>sum+quantity*input.history.series.find(s=>s.symbol===symbol).bars.find(b=>b.date===day)[field],0);
   equity=Number((replayCash+value).toFixed(2));peak=Math.max(peak,equity);drawdown=Math.max(drawdown,(peak-equity)/peak);}
 }
 assert(Math.abs(equity-row.metrics.finalEquity)<.001);assert(Math.abs((equity/20000-1)-row.metrics.netEquityReturn)<1e-10);
 assert(Math.abs(drawdown-row.metrics.observedMaxDrawdownRatio)<1e-10);
}
assert.equal(groups.size,72);
const summaries=keys.map(strategyKey=>({strategyKey,modes:['proxy','structure'].map(entryMode=>{
 const rows=result.results.filter(r=>r.strategyKey===strategyKey&&r.entryMode===entryMode);
 return{entryMode,byCost:['base','stress'].map(cost=>{const asc=rows.filter(r=>r.cost.label===cost&&r.order==='ascending'),desc=rows.filter(r=>r.cost.label===cost&&r.order==='descending');
  return{cost,ascendingReturns:asc.map(r=>r.metrics.netEquityReturn),descendingReturns:desc.map(r=>r.metrics.netEquityReturn),
   wins:asc.reduce((s,r)=>s+r.metrics.winningMatches,0),closed:asc.reduce((s,r)=>s+r.metrics.closedMatches,0),
   fills:asc.reduce((s,r)=>s+r.metrics.filledOrders,0),fees:asc.reduce((s,r)=>s+r.metrics.commission,0),
   worstDrawdown:Math.max(...asc.map(r=>r.metrics.observedMaxDrawdownRatio)),openWindows:asc.filter(r=>r.finalPositions.length).length};})};})}));
const summary={outputSha256:sha(bytes),groups:72,checkedStructure,checkedProxy,checkedFills,checkedEntries,minimumCash,summaries};
fs.writeFileSync(outputPrefix+'-summary.json',JSON.stringify(summary,null,2));
const table=['| 策略 | 模式 | 成本 | 窗 | 顺序 | 期末权益 | 观察回撤% | 成交/佣金 | 盈利/闭合片段 | 未平仓股数 | 拒单 | 尾意图 |',
 '| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
for(const r of result.results)table.push(`| ${r.strategyKey} | ${r.entryMode} | ${r.cost.label} | ${r.window} | ${r.order} | ${r.metrics.finalEquity} | ${(r.metrics.observedMaxDrawdownRatio*100).toFixed(3)} | ${r.metrics.filledOrders}/${r.metrics.commission} | ${r.metrics.winningMatches}/${r.metrics.closedMatches} | ${r.finalPositions.length} | ${r.orderStatusCounts.rejected} | ${r.diagnostics.tailSignals} |`);
fs.writeFileSync(outputPrefix+'-all-results.md',table.join('\n')+'\n');
console.log(JSON.stringify({outputSha256:summary.outputSha256,groups:72,checkedFills,checkedEntries,checkedStructure,checkedProxy,minimumCash}));
