import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isCorePastureCandidate, rankCoreCandidates } from '../src/core/predictionEngine.ts';

const source=readFileSync(new URL('../web/public/trading-room-core.js',import.meta.url),'utf8');
function between(name:string,next:string):string{
 const start=source.indexOf('function '+name+'('),end=source.indexOf('function '+next+'(',start);
 assert.ok(start>=0&&end>start,'Pasture function boundaries exist: '+name);
 return source.slice(start,end);
}
const functions=[
 between('applyMarkets','splitDigits'),
 between('brainCowScore','brainFactorList'),
 between('selectRangerAutoCandidate','rangerAutoSettingsFromInputs'),
 between('onCowDefeated','clearPending'),
].join('\n');
function harness(extra:Record<string,unknown>={}){
 const ctx=vm.createContext({
  liveMarkets:[],contracts:[],cows:[{}],target:null,marketTickSequences:new Map(),
  observeMarketFreshness:()=>{},updateMarketTickSequences:()=>{},quoteFreshness:()=>({fresh:true}),
  rank:()=>{},updatePastureHighlightTargets:()=>{},performance:{now:()=>100},
  connectedAccount:true,pending:null,lockUntil:0,rangerBet:null,rangerBubbleDismissed:false,activeAccountId:'account-a',
  renderRangerBet:()=>{},notify:()=>{},brainEntryCheck:()=>null,brainEntryReaction:()=>{},
  window:{},brainSnipe:null,rangerAutoMinEdge:0,rangerAutoStatus:'',renderRangerAutoHud:()=>{},
  selectedCowStake:()=>1,lastRoomState:{},plannedCowStake:()=>({stake:2}),stopRangerAuto:()=>{},
  submitted:[],submitContract:(...args:unknown[])=>{(ctx.submitted as unknown[][]).push(args)},
  ...extra,
 });
 vm.runInContext(functions,ctx);return ctx;
}
const candidate=(patch:Record<string,unknown>={})=>({
 engineVersion:'core-v1',market:'R_100',direction:'over',barrier:2,baseWin:.7,estWin:.74,
 edge:.02,expectedROI:.04,estPayout:1.4,fresh:true,decisionId:'core-decision',lessonIds:[],
 features:{samples:200,lessonAdjustment:0},cutoff:{sequence:51},payoutSource:'estimate',...patch,
});
const market={symbol:'R_100',display:'Volatility 100 Index',fresh:true,recentDigits:Array(50).fill(9),
 recentQuotes:Array.from({length:40},(_,i)=>100+i)};
test('pasture forwards Core probability, edge and return unchanged despite one-sided ticks',()=>{
 const ctx=harness({inputs:{markets:[market],candidates:[candidate()]}});
 vm.runInContext('applyMarkets(inputs.markets,inputs.candidates,[],[],[])',ctx);
 const tag=vm.runInContext('contracts[0]',ctx);
 assert.equal(tag.p,.74);assert.equal(tag.rawP,.74);assert.equal(tag.edge,.02);assert.equal(tag.score,.04);
 assert.equal(tag.decisionId,'core-decision');assert.equal(tag.tickSeq,51);assert.equal(tag.hitSignal,false);
});
test('missing canonical candidates mark existing cows stale without invented fallback predictions',()=>{
 const ctx=harness({contracts:[{...candidate(),symbol:'R_100',kind:'OVER',p:.74,score:.04}],inputs:{markets:[market]}});
 vm.runInContext('applyMarkets(inputs.markets,[],[],[],[])',ctx);
 assert.equal(vm.runInContext('contracts[0].fresh',ctx),false);
 assert.equal(vm.runInContext('cows[0].contract.fresh',ctx),false);
 assert.equal(vm.runInContext('contracts[0].p',ctx),.74);
});
test('Brain and Auto follow Core return ranking instead of confidence or payout bonuses',()=>{
 const a={...candidate(),symbol:'R_100',kind:'OVER',p:.72,score:.08,digitSamples:100,tickSeq:1};
 const b={...candidate({market:'R_10'}),symbol:'R_10',kind:'UNDER',p:.99,score:.01,payout:9.5,digitSamples:1000,hitSignal:true,tickSeq:1};
 const ctx=harness({items:[a,b]});
 assert.equal(vm.runInContext('brainCowScore({contract:items[0]}) > brainCowScore({contract:items[1]})',ctx),true);
 assert.equal(vm.runInContext('selectRangerAutoCandidate(items).symbol',ctx),'R_100');
 assert.equal(vm.runInContext('brainCowScore({contract:{...items[0],fresh:false}})',ctx),-Infinity);
});
test('missed tick sequences restart confirmation rather than inventing unseen confirmations',()=>{
 const ctx=harness({item:{symbol:'R_100',kind:'OVER',barrier:2,tickSeq:10}});
 vm.runInContext('progress=updateRangerAutoProgress(null,item)',ctx);
 assert.equal(vm.runInContext('progress.confirmations',ctx),1);
 vm.runInContext('item.tickSeq=13;progress=updateRangerAutoProgress(progress,item)',ctx);
 assert.equal(vm.runInContext('progress.confirmations',ctx),1);
 vm.runInContext('item.tickSeq=14;progress=updateRangerAutoProgress(progress,item)',ctx);
 assert.equal(vm.runInContext('progress.confirmations',ctx),2);
 vm.runInContext('progress=updateRangerAutoProgress(progress,item)',ctx);
 assert.equal(vm.runInContext('progress.confirmations',ctx),2);
});
test('defeating an Auto cow never swaps to another contract and reprices the exact remaining target',()=>{
 const original={symbol:'R_100',kind:'OVER',barrier:2,fresh:true,edge:.02};
 const other={symbol:'R_100',kind:'UNDER',barrier:7,fresh:true,edge:.2};
 const cow={contract:original,tradeIntent:{accountId:'account-a',rangerAutomation:true,contract:original,stake:9,style:'base'}};
 const ctx=harness({contracts:[other],cow});
 vm.runInContext('onCowDefeated(cow)',ctx);assert.equal((ctx.submitted as unknown[]).length,0);
 vm.runInContext('contracts.push(cow.contract);onCowDefeated(cow)',ctx);
 const submitted=ctx.submitted as unknown[][];
 assert.equal(submitted.length,1);assert.equal((submitted[0][0] as typeof original).kind,'OVER');
 assert.equal((submitted[0][0] as typeof original).barrier,2);assert.equal(submitted[0][1],2);
});
test('the shared pasture pool keeps70/80 percent contracts while manual analysis retains all18',()=>{
 const now=1_800_000_000_000;
 const all=rankCoreCandidates([{symbol:'R_100',fresh:true,recentTicks:Array.from({length:60},(_,i)=>({digit:i%10,quote:100+i/1000,epoch:now/1000-59+i,sequence:i+1,segment:'a'}))}],[],now);
 assert.equal(all.length,18);const balanced=all.filter(isCorePastureCandidate);
 assert.equal(balanced.length,4);
 assert.deepEqual(balanced.map(c=>[c.direction,c.barrier]).sort(),[['over',1],['over',2],['under',7],['under',8]].sort());
});
