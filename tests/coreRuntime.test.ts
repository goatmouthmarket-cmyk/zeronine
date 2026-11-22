import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketRegistry } from '../src/core/marketState.ts';
import { CoreRuntime } from '../src/core/coreRuntime.ts';
import type { CoreEvidenceStore } from '../src/core/coreEvidenceStore.ts';

test('Core uses live arrival identities without changing legacy sixty-digit history',()=>{
 const registry=new MarketRegistry({onTick:()=>{}});registry.ensure('R_10');
 const now=Math.floor(Date.now()/1000);
 registry.seed('R_10',[{epoch:now-2,quote:100,digit:0}]);
 assert.equal(registry.coreMarkets()[0].recentTicks.length,0,'ambiguous seeded history does not invent sequence identities');
 for(let i=0;i<80;i++)registry.push('R_10',100+i/100,now,i%10);
 const market=registry.coreMarkets()[0];assert.equal(market.recentTicks.length,80);
 assert.equal(market.recentTicks[79].sequence,80);assert.equal(registry.snapshot('R_10').recentDigits.length,60);
 const oldSegment=market.recentTicks[79].segment;
 registry.push('R_10',101,now+20,1);
 assert.notEqual(registry.coreMarkets()[0].recentTicks.at(-1)?.segment,oldSegment,'a feed gap starts a different context segment');
});
test('pasture and exact-quote decisions share Core probability and account evidence reads are cached',async()=>{
 const registry=new MarketRegistry({onTick:()=>{}});registry.ensure('R_10');const now=Math.floor(Date.now()/1000);
 for(let i=0;i<100;i++)registry.push('R_10',100+i/100,now,i%10);
 let reads=0;
 const evidence={lessonSummaries:async()=>{reads++;return[]},drainEvidenceJobs:async()=>{}} as unknown as CoreEvidenceStore;
 const runtime=new CoreRuntime(registry,evidence);
 try{
  await runtime.refresh('account-a');await runtime.refresh('account-a');assert.equal(reads,1);
  const displayed=runtime.candidates('account-a')[0];assert.ok(displayed);assert.ok(displayed.baseWin>=.7&&displayed.baseWin<=.8);
  const entry=runtime.decision('account-a',displayed.market,displayed.direction,displayed.barrier);
  assert.equal(entry?.probability,displayed.probability);assert.equal(entry?.decisionId,displayed.decisionId);
 }finally{runtime.close();}
});

