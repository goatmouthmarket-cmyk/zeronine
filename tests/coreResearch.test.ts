import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreResearch, type ResearchPersistence } from '../src/core/coreResearch.ts';
import type { CoreMarketInput } from '../src/core/predictionEngine.ts';
const BASE=1_800_000_000_000;
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve};}
class Memory implements ResearchPersistence {
 runs=new Map<string,Record<string,unknown>>();results=new Map<string,Record<string,unknown>>();decisions:Record<string,unknown>[]=[];
 fail=false;
 async saveResearchRun(account:string,run:{id:string;[key:string]:unknown}){if(this.fail)throw Error('offline');this.runs.set(account,{...run});}
 async saveResearchResult(_account:string,row:{id:string;runId:string;[key:string]:unknown}){if(this.fail)throw Error('offline');this.results.set(row.id,{...row});}
 async readResearchRun(account:string){return this.runs.get(account)??null;}
 async readResearchResults(_account:string,runId:string){return [...this.results.values()].filter(row=>row.runId===runId);}
 async saveDecision(_account:string,row:{id:string;engineVersion:string;[key:string]:unknown}){if(this.fail)throw Error('offline');this.decisions.push({...row});}
}
function setup(){
 let now=BASE,seq=60;
 const persistence=new Memory();
 const market:CoreMarketInput={symbol:'R_100',display:'Volatility 100',fresh:true,precision:3,recentTicks:Array.from({length:60},(_,i)=>({epoch:BASE/1000-59+i,quote:100+i/1000,digit:i%10,sequence:i+1,segment:'a'}))};
 const research=new CoreResearch(()=>[market],persistence,{now:()=>now,intervalMs:false});
 const append=(digit:number,options:{gap?:number;segment?:string;sameSecond?:boolean}={})=>{
  if(!options.sameSecond)now+=1000;seq+=options.gap??1;
  market.recentTicks=[...market.recentTicks,{epoch:now/1000,quote:100+seq/1000,digit,sequence:seq,segment:options.segment??'a'}];
 };
 const config={stake:1,startingBalance:100,takeProfit:5,maxLoss:5};
 return{research,persistence,market,append,config,advance:(ms:number)=>{now+=ms}};
}
test('research requests proposals only, settles exactly the next tick and persists one result',async()=>{
 const s=setup();let proposals=0;
 s.research.start('a',s.config,async()=>{proposals++;return{askPrice:1,payout:1.2}},()=>[],async()=>true);
 await s.research.step('a');assert.equal(proposals,1);
 const opened=s.research.snapshot('a').recent[0];assert.equal(opened.status,'open');
 await s.research.step('a');assert.equal(s.research.snapshot('a').run?.settled,0);
 s.append(opened.direction==='over'?opened.barrier+1:opened.barrier-1,{sameSecond:true});
 await s.research.step('a');await s.research.flush();
 const snap=s.research.snapshot('a');
 assert.equal(snap.run?.settled,1);assert.equal(snap.run?.wins,1);assert.ok(Math.abs(snap.run!.netProfit-.2)<1e-12);
 assert.equal(proposals,1);assert.equal(s.persistence.results.size,1);assert.equal([...s.persistence.results.values()][0].status,'won');
 assert.equal(s.persistence.decisions[0].payoutSource,'live_quote');
 s.research.close();await s.research.flush();
});
test('a stopped run cannot create a virtual fill from an in-flight quote',async()=>{
 const s=setup(),gate=deferred<{askPrice:number;payout:number}>();
 s.research.start('a',s.config,()=>gate.promise,()=>[],async()=>true);
 const pending=s.research.step('a');await Promise.resolve();
 s.research.stop('a');gate.resolve({askPrice:1,payout:1.2});await pending;await s.research.flush();
 assert.equal(s.research.snapshot('a').recent.length,0);assert.equal(s.research.snapshot('a').running,false);
 s.research.close();
});
test('ticks arriving while quoting do not get counted as the virtual exit',async()=>{
 const s=setup(),gate=deferred<{askPrice:number;payout:number}>();
 s.research.start('a',s.config,()=>gate.promise,()=>[],async()=>true);
 const pending=s.research.step('a');await Promise.resolve();
 s.append(9);s.append(8);gate.resolve({askPrice:1,payout:1.2});await pending;
 const row=s.research.snapshot('a').recent[0];assert.equal(row.entrySequence,62);
 await s.research.step('a');assert.equal(s.research.snapshot('a').run?.settled,0);
 s.append(row.barrier);await s.research.step('a');
 assert.equal(s.research.snapshot('a').run?.losses,1);
 s.research.close();await s.research.flush();
});
test('pause finishes an existing virtual trade but starts no next trade',async()=>{
 const s=setup();let proposals=0;
 s.research.start('a',s.config,async()=>{proposals++;return{askPrice:1,payout:1.2}},()=>[],async()=>true);
 await s.research.step('a');const row=s.research.snapshot('a').recent[0];
 s.research.stop('a');s.append(row.barrier);await s.research.step('a');await s.research.step('a');
 assert.equal(s.research.snapshot('a').run?.losses,1);assert.equal(proposals,1);
 s.research.close();await s.research.flush();
});
test('gaps and reconnects become missing evidence, never wins or losses',async()=>{
 for(const options of [{gap:2},{segment:'b'}]){
  const s=setup();s.research.start('a',s.config,async()=>({askPrice:1,payout:1.2}),()=>[],async()=>true);
  await s.research.step('a');s.append(9,options);await s.research.step('a');
  assert.equal(s.research.snapshot('a').coverage.missing,1);assert.equal(s.research.snapshot('a').run?.settled,0);
  assert.equal(s.research.snapshot('a').run?.netProfit,0);s.research.close();await s.research.flush();
 }
});
test('loss budget stops before a further full-stake loss could exceed it',async()=>{
 const s=setup();let quotes=0;
 s.research.start('a',{...s.config,maxLoss:1.5},async()=>{quotes++;return{askPrice:1,payout:1.2}},()=>[],async()=>true);
 await s.research.step('a');s.append(s.research.snapshot('a').recent[0].barrier);await s.research.step('a');await s.research.step('a');
 assert.equal(s.research.snapshot('a').run?.netProfit,-1);assert.equal(s.research.snapshot('a').running,false);assert.equal(quotes,1);
 s.research.close();await s.research.flush();
});
test('failed storage pauses research and interrupted saved fills restore as missing',async()=>{
 const s=setup();s.persistence.fail=true;
 s.research.start('a',s.config,async()=>({askPrice:1,payout:1.2}),()=>[],async()=>true);
 await s.research.flush();assert.equal(s.research.snapshot('a').running,false);assert.match(s.research.snapshot('a').reason!,/Saving unavailable/);
 s.research.close();await s.research.flush();
 const healthy=setup();healthy.research.start('b',healthy.config,async()=>({askPrice:1,payout:1.2}),()=>[],async()=>true);
 await healthy.research.step('b');await healthy.research.flush();
 const restored=new CoreResearch(()=>[],healthy.persistence,{now:()=>BASE+20000,intervalMs:false});
 await restored.restore('b');await restored.flush();
 assert.equal(restored.snapshot('b').running,false);assert.equal(restored.snapshot('b').recent[0].status,'missing');
 assert.equal(restored.snapshot('b').run?.settled,0);assert.equal(restored.snapshot('b').coverage.missing,1);
 restored.close();healthy.research.close();await restored.flush();await healthy.research.flush();
});
test('authorization loss and invalid virtual settings cannot request quotes',async()=>{
 const s=setup();let quotes=0;const quote=async()=>{quotes++;return{askPrice:1,payout:1.2}};
 assert.throws(()=>s.research.start('a',{...s.config,maxLoss:.5},quote,()=>[],async()=>true));
 s.research.start('a',s.config,quote,()=>[],async()=>false);await s.research.step('a');
 assert.equal(quotes,0);assert.equal(s.research.snapshot('a').running,false);s.research.close();await s.research.flush();
});

test('Auto activation requires completed evidence and explicit saved consent, and expires after seven days',async()=>{
 const s=setup();let proposals=0;
 s.research.start('a',{...s.config,takeProfit:0,maxLoss:0},async()=>{proposals++;return{askPrice:1,payout:1.2}},()=>[],async()=>true);
 assert.equal(s.research.snapshot('a').autoEnabled,false);
 await assert.rejects(s.research.activate('a'),/200 more/);
 for(let i=0;i<200;i++){
  await s.research.step('a');
  const row=s.research.snapshot('a').recent[0];
  assert.equal(row.status,'open');
  s.append(row.direction==='over'?row.barrier+1:row.barrier-1);
  await s.research.step('a');
 }
 await s.research.flush();
 const ready=s.research.snapshot('a');
 assert.equal(ready.canActivate,true);assert.equal(ready.autoEnabled,false);
 assert.equal(ready.run?.settled,200);assert.equal(ready.run?.fills,200);assert.equal(ready.run?.totalStaked,200);
 assert.ok(ready.readiness.modelBrier!<=ready.readiness.baselineBrier!);
 const before=proposals;
 await s.research.activate('a');
 assert.equal(proposals,before,'activation cannot request a quote or buy');
 assert.equal(s.research.snapshot('a').autoEnabled,true);
 s.research.stop('a');await s.research.flush();
 const restored=new CoreResearch(()=>[s.market],s.persistence,{now:()=>BASE+200000,intervalMs:false});
 await restored.restore('a');assert.equal(restored.snapshot('a').autoEnabled,true);
 const newer=restored.start('a',{...s.config,takeProfit:0,maxLoss:0},async()=>({askPrice:1,payout:1.2}),()=>[],async()=>true);
 assert.equal(newer.autoEnabled,true);assert.equal(newer.canActivate,false);
 s.advance(8*86400000);assert.equal(s.research.snapshot('a').autoEnabled,false);assert.equal(s.research.snapshot('a').canActivate,false);
 s.research.close();restored.close();await s.research.flush();await restored.flush();
});
test('negative paper return or incomplete evidence cannot unlock Auto even after enough settlements',async()=>{
 const s=setup();
 const saved={id:'run-1',engineVersion:'core-v1',contractPolicy:'balanced-over-under-v1',stake:1,startingBalance:100,takeProfit:0,maxLoss:0,balance:99,
  startedAt:BASE-200000,settled:200,wins:180,losses:20,netProfit:-1,maxDrawdown:2,peakBalance:101,phase:'Paused',running:false,
  missing:0,baselineExpectedWins:180,predictedExpectedWins:180,fills:200,totalStaked:200,
  probabilitySquaredError:15,baselineSquaredError:20,quoteBreakevenSum:190,lastSettledAt:BASE-1000,autoEnabled:false,activationEvidence:null};
 s.persistence.runs.set('a',saved);
 await s.research.restore('a');
 assert.equal(s.research.snapshot('a').canActivate,false);
 await assert.rejects(s.research.activate('a'),/finish ahead/);
 const gaps=setup();gaps.persistence.runs.set('a',{...saved,netProfit:5,missing:20,fills:220});
 await gaps.research.restore('a');
 assert.equal(gaps.research.snapshot('a').canActivate,false);
 await assert.rejects(gaps.research.activate('a'),/missing/);
 s.research.close();gaps.research.close();await s.research.flush();await gaps.research.flush();
});

test('research decision snapshots are private per account even on the same market tick',async()=>{
 const s=setup(),quote=async()=>({askPrice:1,payout:1.2});
 s.research.start('alice',s.config,quote,()=>[],async()=>true);
 s.research.start('bob',s.config,quote,()=>[],async()=>true);
 await s.research.step();await s.research.flush();
 const alice=s.research.snapshot('alice').recent[0],bob=s.research.snapshot('bob').recent[0];
 assert.notEqual(alice.decisionId,bob.decisionId);
 assert.ok(alice.decisionId.startsWith('alice:'));assert.ok(bob.decisionId.startsWith('bob:'));
 assert.equal(s.persistence.decisions.find(row=>row.id===alice.decisionId)?.decisionId,s.persistence.decisions.find(row=>row.id===bob.decisionId)?.decisionId);
 s.research.close();await s.research.flush();
});
test('empty saved research reads are cached briefly and default snapshots have complete readiness shape',async()=>{
 const s=setup();let reads=0;
 s.persistence.readResearchRun=async()=>{reads++;return null;};
 await s.research.restore('a');await s.research.restore('a');assert.equal(reads,1);
 assert.equal(s.research.snapshot('a').readiness.modelBrier,null);
 s.advance(30001);await s.research.restore('a');assert.equal(reads,2);
 s.research.close();
});
