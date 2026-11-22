import test from 'node:test';
import assert from 'node:assert/strict';
import { paperSignalFromHubEvent } from '../src/simulation/paperSignal.ts';
import { PaperSimulator } from '../src/simulation/paperSimulator.ts';
const ratio=.95/.8;
const candidate={market:'R_100',direction:'over',barrier:1,estPayout:ratio,estWin:.82,edge:.01,expectedROI:.82*ratio-1,engineVersion:'core-v1',payoutSource:'estimate'};
const event=(patch:Record<string,unknown>={})=>({ts:Date.now(),signal:{holds:false,candidates:[{...candidate,...patch}],reason:'Core'}});
test('public Ghost uses the exact supplied payout rather than a generic simulator return',()=>{
 const signal=paperSignalFromHubEvent(event(),4,'core','paper');assert.ok(signal);
 assert.equal(signal.payoutRatio,ratio);assert.equal(signal.estWin,.82);assert.equal(signal.edge,.01);
 assert.deepEqual({verified:signal.evidence?.payout_verified,core:signal.evidence?.engine_core_v1},{verified:0,core:1});
 assert.match(signal.reason!,/estimated virtual payout/);
 const simulator=new PaperSimulator({initialBalance:100,defaultPayoutRatio:1.9});simulator.start();
 simulator.onTick({market:'R_100',quote:100.2,digit:2,epoch:100},signal);
 assert.equal(simulator.state().openContract?.payoutRatio,ratio);
 simulator.onTick({market:'R_100',quote:100.9,digit:9,epoch:101});
 assert.equal(simulator.state().lastSettled?.profit,.75,'4 stake at1.1875x returns0.75 profit, not3.60');
});
test('an absent or invalid payout is missing evidence and never falls back to1.9x',()=>{
 for(const estPayout of [undefined,null,0,1,-1,NaN,Infinity,'1.9']){
  const result=paperSignalFromHubEvent(event({estPayout}),2,'core','paper');
  // Only finite numeric model values are accepted, not loosely coerced strings.
  assert.equal(result,null,String(estPayout));
 }
});
test('quoted provenance is separate from probability and holds suppress paper entry',()=>{
 const quoted=paperSignalFromHubEvent(event({payoutSource:'live_quote',estPayout:1.25}),2,'core','paper')!;
 assert.equal(quoted.payoutRatio,1.25);assert.equal(quoted.estWin,candidate.estWin);
 assert.equal(quoted.evidence?.payout_verified,1);assert.match(quoted.reason!,/quoted virtual payout/);
 assert.equal(paperSignalFromHubEvent({ts:Date.now(),signal:{holds:true,candidates:[candidate]}},2,'core','paper'),null);
 assert.equal(paperSignalFromHubEvent(event({engineVersion:'unknown'}),2,'core','paper')?.evidence?.engine_core_v1,null);
});

