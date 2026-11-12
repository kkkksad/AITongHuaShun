const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const [inputPath,firstPath,secondPath,nativePath,outputPrefix]=process.argv.slice(2);
if(!inputPath||!firstPath||!secondPath||!nativePath||!outputPrefix)throw Error('Expected frozen input, two runs, original native report and distinct output prefix');
const path=require('node:path');
const inputs=[inputPath,firstPath,secondPath,nativePath].map(p=>path.resolve(p));
const outputs=['-summary.json','-table.md','-all-results.md'].map(s=>path.resolve(outputPrefix+s));
assert(outputs.every(p=>!inputs.includes(p)),'Cannot overwrite input evidence');
const bytes=fs.readFileSync(firstPath);
assert.deepEqual(bytes,fs.readFileSync(secondPath));
const result=JSON.parse(bytes),input=read(inputPath);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex'),
 '32fc7da6789ebcd55660f7b031d036ad070e09b3baa8d919c8391350f9963d01');
assert.equal(result.results.length,216);
const original=read(nativePath);
assert.equal(result.inputSha256,original.inputSha256);
assert.deepEqual(result.windows,original.windows);
assert.equal(result.asOf,original.asOf);
const expectedKeys=['kairosLowVolTrend','kairosTrendHealth','kairosVolumePriceBreakout','aSharePullback','rsi','bollingerBands'];
const expectedGroups=new Set(expectedKeys.flatMap(key=>['native','common-price-stop','family-exit'].flatMap(mode=>
 ['base','stress'].flatMap(cost=>[1,2,3].flatMap(window=>['ascending','descending'].map(order=>[key,mode,cost,window,order].join(':')))))));
const observedGroups=new Set();
for(const row of result.results){
 const key=[row.strategyKey,row.exitMode,row.cost.label,row.window,row.order].join(':');
 assert(expectedGroups.has(key)&&!observedGroups.has(key),'Missing, unexpected or duplicated experiment group');
 observedGroups.add(key);
}
assert.equal(observedGroups.size,216);
let nativeGroups=0,checkedFills=0,minimumCash=20000;
const dates=input.history.series[0].bars.map(b=>b.date),windows=[dates.slice(0,166),dates.slice(166,332),dates.slice(332)];
for(const row of result.results){
 if(row.exitMode==='native'){
  const {exitMode,exitFamily,exitDiagnostics,...projection}=row;
  assert.deepEqual(projection,original.results.find(r=>r.strategyKey===row.strategyKey&&r.window===row.window&&
    r.cost.label===row.cost.label&&r.order===row.order));nativeGroups++;
 }
 let cash=20000,fees=0,closed=0,wins=0;
 const lots=new Map();
 for(const trade of row.trades){
  const day=trade.time.slice(0,10);
  assert(trade.time.endsWith('T09:30:00+08:00'));
  assert(trade.barIndex>0&&trade.barIndex%2===0);
  assert.equal(day,windows[row.window-1][trade.barIndex/2]);
  assert.equal(trade.quantity%100,0);assert(trade.quantity>0);
  const raw=input.history.series.find(s=>s.symbol===trade.symbol).bars.find(b=>b.date===day);
  assert(raw&&raw.volume>0);
  const price=Number((raw.open*(1+(trade.side==='buy'?1:-1)*row.cost.slippageBps/10000)).toFixed(2));
  assert.equal(trade.price,price);assert.equal(trade.notional,price*trade.quantity);
  assert.equal(trade.commission,Number(Math.max(row.cost.minimumCommission,trade.notional*row.cost.commissionRate).toFixed(2)));
  const owned=lots.get(trade.symbol)||[];
  if(trade.side==='buy'){
   cash-=trade.notional+trade.commission;
   owned.push({day,quantity:trade.quantity,unitCost:(trade.notional+trade.commission)/trade.quantity});
  }else{
   let remaining=trade.quantity;
   for(const lot of owned){
    if(lot.day>=day)continue;
    const quantity=Math.min(lot.quantity,remaining);
    if(quantity===0)continue;
    const pnl=(trade.notional-trade.commission)/trade.quantity*quantity-lot.unitCost*quantity;
    closed++;if(pnl>0)wins++;
    lot.quantity-=quantity;remaining-=quantity;
   }
   assert.equal(remaining,0,'No T+0 or oversold inventory');cash+=trade.notional-trade.commission;
  }
  lots.set(trade.symbol,owned);fees+=trade.commission;checkedFills++;
  assert(cash>=-0.005);minimumCash=Math.min(minimumCash,cash);
 }
 assert(Math.abs(cash-row.metrics.cash)<0.001);assert(Math.abs(fees-row.metrics.commission)<0.001);
 assert.equal(closed,row.metrics.closedMatches);assert.equal(wins,row.metrics.winningMatches);
 assert.equal(row.metrics.closedMatchWinRate,closed?wins/closed:null);
 for(const[symbol,owned]of lots)assert.equal(owned.reduce((s,lot)=>s+lot.quantity,0),row.finalPositions.find(p=>p.symbol===symbol)?.quantity||0);
 for(const position of row.finalPositions)assert.equal(position.quantity,(lots.get(position.symbol)||[]).reduce((s,l)=>s+l.quantity,0));
 let replayCash=20000,peak=20000,drawdown=0,lastEquity=20000;
 const holdings=new Map();
 const observe=(day,field)=>{
  const value=[...holdings].reduce((sum,[symbol,quantity])=>sum+quantity*
    input.history.series.find(s=>s.symbol===symbol).bars.find(b=>b.date===day)[field],0);
  lastEquity=Number((replayCash+value).toFixed(2));peak=Math.max(peak,lastEquity);
  drawdown=Math.max(drawdown,(peak-lastEquity)/peak);
 };
 for(const day of windows[row.window-1]){
  for(const trade of row.trades.filter(t=>t.time.slice(0,10)===day)){
   holdings.set(trade.symbol,(holdings.get(trade.symbol)||0)+(trade.side==='buy'?trade.quantity:-trade.quantity));
   replayCash+=trade.side==='buy'?-trade.notional-trade.commission:trade.notional-trade.commission;
  }
  observe(day,'open');observe(day,'close');
 }
 assert(Math.abs(lastEquity-row.metrics.finalEquity)<0.001);
 assert(Math.abs((lastEquity/20000-1)-row.metrics.netEquityReturn)<1e-10);
 assert(Math.abs(drawdown-row.metrics.observedMaxDrawdownRatio)<1e-10);
}
assert.equal(nativeGroups,72);
const keys=[...new Set(result.results.map(r=>r.strategyKey))];
const summaries=keys.map(strategyKey=>{
 const rows=result.results.filter(r=>r.strategyKey===strategyKey);
 const modes=['native','common-price-stop','family-exit'].map(exitMode=>{
  const modeRows=rows.filter(r=>r.exitMode===exitMode),asc=modeRows.filter(r=>r.order==='ascending');
  const byCost=['base','stress'].map(cost=>{
   const selected=asc.filter(r=>r.cost.label===cost),reverse=modeRows.filter(r=>r.order==='descending'&&r.cost.label===cost);
   return{cost,ascendingReturns:selected.map(r=>r.metrics.netEquityReturn),descendingReturns:reverse.map(r=>r.metrics.netEquityReturn),
    ascendingClosed:selected.reduce((s,r)=>s+r.metrics.closedMatches,0),ascendingWins:selected.reduce((s,r)=>s+r.metrics.winningMatches,0),
    ascendingFills:selected.reduce((s,r)=>s+r.metrics.filledOrders,0),ascendingFees:selected.reduce((s,r)=>s+r.metrics.commission,0),
    worstDrawdown:Math.max(...selected.map(r=>r.metrics.observedMaxDrawdownRatio)),ascendingOpenWindows:selected.filter(r=>r.finalPositions.length).length,
    orderChanged:selected.filter(r=>r.metrics.finalEquity!==reverse.find(o=>o.window===r.window).metrics.finalEquity).length};
  });
  const changed=exitMode==='native'?[]:modeRows.map(row=>{
   const native=rows.find(r=>r.exitMode==='native'&&r.order===row.order&&r.window===row.window&&r.cost.label===row.cost.label);
   return{delta:row.metrics.finalEquity-native.metrics.finalEquity,drawdownDelta:row.metrics.observedMaxDrawdownRatio-native.metrics.observedMaxDrawdownRatio};
  });
  const diagnostics={};for(const row of modeRows)for(const d of Object.values(row.exitDiagnostics))for(const[k,v]of Object.entries(d))diagnostics[k]=(diagnostics[k]||0)+v;
  return{exitMode,byCost,betterThanNative:changed.filter(r=>r.delta>0.005).length,worseThanNative:changed.filter(r=>r.delta<-.005).length,
   equalToNative:changed.filter(r=>Math.abs(r.delta)<=.005).length,worseDrawdownThanNative:changed.filter(r=>r.drawdownDelta>1e-10).length,diagnostics};
 });return{strategyKey,modes};
});
const summary={outputSha256:crypto.createHash('sha256').update(bytes).digest('hex'),repeatedBytesEqual:true,groups:216,nativeGroupsFullyUnchanged:nativeGroups,
 checkedFills,minimumCash,sourceWarning:result.sourceWarning,validationWarnings:result.validationWarnings,summaries};
fs.writeFileSync(outputPrefix+'-summary.json',JSON.stringify(summary,null,2));
const pct=n=>(n*100).toFixed(2);
const table=['| 固定策略 | 退出模式 | 成本 | 正序三窗权益% | 逆序三窗权益% | 正序盈利/闭合片段 | 正序成交/佣金元 | 正序最差回撤% | 正序期末有仓窗 | 改序改变权益窗/3 |',
 '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |'];
for(const s of summaries)for(const m of s.modes)for(const c of m.byCost)table.push(
 `| ${s.strategyKey} | ${m.exitMode} | ${c.cost} | ${c.ascendingReturns.map(pct).join(' / ')} | ${c.descendingReturns.map(pct).join(' / ')} | ${c.ascendingWins}/${c.ascendingClosed} | ${c.ascendingFills}/${c.ascendingFees} | ${pct(c.worstDrawdown)} | ${c.ascendingOpenWindows} | ${c.orderChanged} |`);
fs.writeFileSync(outputPrefix+'-table.md',table.join('\n')+'\n');
const full=['| 策略 | 退出 | 成本 | 窗 | 顺序 | 权益元 | 观察回撤% | 成交/佣金元 | 盈利/闭合片段 | 期末仓数 | 拒单 | 年龄未知观察 | 尾部意图 |',
 '| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
for(const r of result.results)full.push(`| ${r.strategyKey} | ${r.exitMode} | ${r.cost.label} | ${r.window} | ${r.order} | ${r.metrics.finalEquity} | ${pct(r.metrics.observedMaxDrawdownRatio)} | ${r.metrics.filledOrders}/${r.metrics.commission} | ${r.metrics.winningMatches}/${r.metrics.closedMatches} | ${r.finalPositions.length} | ${r.orderStatusCounts.rejected} | ${Object.values(r.exitDiagnostics).reduce((s,d)=>s+d.unknownHoldingAgeObservations,0)} | ${r.diagnostics.tailSignals} |`);
fs.writeFileSync(outputPrefix+'-all-results.md',full.join('\n')+'\n');
console.log(JSON.stringify({outputSha256:summary.outputSha256,groups:216,nativeGroupsFullyUnchanged:nativeGroups,
 checkedFills,minimumCash}));
