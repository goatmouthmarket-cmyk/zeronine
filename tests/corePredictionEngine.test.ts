import test from 'node:test';
import assert from 'node:assert/strict';
import { coreBaseWin, rankCoreCandidates, findCoreDecision, evaluateCoreQuote, type CoreMarketInput, type CoreLessonEvidence } from '../src/core/predictionEngine.ts';

const NOW = 1_800_000_000_000;
const market = (digits = Array.from({length:60}, (_,i)=>i%10)): CoreMarketInput => ({
  symbol:'R_100',display:'Volatility 100',fresh:true,precision:3,
  recentTicks:digits.map((digit,i)=>({digit,quote:100+i/1000,epoch:NOW/1000-digits.length+i+1,sequence:i+1,segment:'a'})),
});
const pick = (m=market()) => findCoreDecision(m,'over',1,[],NOW)!;
const lesson = (): CoreLessonEvidence => ({
  id:'lesson-1',marketSymbol:'R_100',expectedDirection:'over',barrier:1,createdAt:NOW-1000000,
  confirmedPattern:{side:'high',count:3},
  patternEvidence:{supported:true,forwardOnly:true,complete:true,firstEvaluatedAt:NOW-900000,lastEvaluatedAt:NOW-1000,
    matched:{trades:100,wins:99,profit:20,stake:100},comparable:{trades:100,wins:60,profit:-30,stake:100}},
});

test('all 18 valid Over/Under contracts, including the 90% baselines, use one calculation',()=>{
  const all=rankCoreCandidates([market()],[],NOW);
  assert.equal(all.length,18);
  assert.equal(all.find(x=>x.direction==='over'&&x.barrier===0)?.probability,.9);
  assert.equal(all.find(x=>x.direction==='under'&&x.barrier===9)?.probability,.9);
  assert.equal(pick().probability,.8);
  assert.equal(coreBaseWin('over',2),.7);
  assert.throws(()=>coreBaseWin('over',9),RangeError);
});
test('small apparent digit runs are shrunk and do not imply verified accuracy',()=>{
  const decision=pick(market([9,9,9]));
  assert.ok(decision.probability>.8&&decision.probability<.81);
  assert.equal(decision.evidence.calibrated,false);
  assert.equal(decision.payoutSource,'estimate');
  assert.equal(decision.quote,null);
});
test('actual quote changes payout value without inventing a new probability or contract',()=>{
  const decision=pick();
  const quote=evaluateCoreQuote(decision,2,2.2,NOW+10);
  assert.equal(quote.probability,decision.probability);
  assert.equal(quote.decisionId,decision.decisionId);
  assert.equal(quote.quote?.breakeven,2/2.2);
  assert.ok(Math.abs(quote.expectedROI-(.8*2.2/2-1))<1e-12);
  assert.equal(quote.payoutSource,'live_quote');
  assert.equal(decision.payoutSource,'estimate');
  assert.throws(()=>evaluateCoreQuote(decision,2,1,NOW),RangeError);
  assert.throws(()=>evaluateCoreQuote(decision,2,3,NOW-1000),RangeError);
});
test('stale, future, malformed and out-of-order feeds cannot create candidates',()=>{
  const stale=market();stale.fresh=false;
  assert.deepEqual(rankCoreCandidates([stale],[],NOW),[]);
  const old=market();old.recentTicks=old.recentTicks.map(t=>({...t,epoch:t.epoch-20}));
  assert.deepEqual(rankCoreCandidates([old],[],NOW),[]);
  const future=market();future.recentTicks=[{digit:9,quote:100,epoch:NOW/1000+3}];
  assert.deepEqual(rankCoreCandidates([future],[],NOW),[]);
  const malformed=market();malformed.recentTicks=[{digit:10,quote:100,epoch:NOW/1000}];
  assert.deepEqual(rankCoreCandidates([malformed],[],NOW),[]);
  const reversed=market();reversed.recentTicks=[...reversed.recentTicks].reverse();
  assert.deepEqual(rankCoreCandidates([reversed],[],NOW),[]);
});
test('only completed forward evidence can add bounded lesson influence; correlated lessons do not stack',()=>{
  const m=market([1,2,3,5,7,9]),base=findCoreDecision(m,'over',1,[],NOW)!;
  const learned=findCoreDecision(m,'over',1,[lesson()],NOW)!;
  assert.ok(learned.probability>base.probability);
  assert.ok(learned.probability-base.probability<=.04);
  assert.deepEqual(learned.lessonIds,['lesson-1']);
  const second={...lesson(),id:'lesson-2'};
  assert.equal(findCoreDecision(m,'over',1,[lesson(),second],NOW)?.probability,learned.probability);
});
test('notes, losing evidence, small samples, wrong setup and future evidence cannot boost a pick',()=>{
  const m=market([1,2,3,5,7,9]),base=findCoreDecision(m,'over',1,[],NOW)!;
  const bad:CoreLessonEvidence[]=[];
  let l=lesson();l.confirmedPattern=null;bad.push(l);
  l=lesson();l.patternEvidence!.matched.profit=-1;bad.push(l);
  l=lesson();l.patternEvidence!.matched.trades=20;l.patternEvidence!.matched.wins=19;bad.push(l);
  l=lesson();l.patternEvidence!.lastEvaluatedAt=NOW+1;bad.push(l);
  l=lesson();l.patternEvidence!.forwardOnly=false;bad.push(l);
  l=lesson();l.patternEvidence!.complete=false;bad.push(l);
  l=lesson();l.marketSymbol='R_10';bad.push(l);
  l=lesson();l.patternEvidence!.firstEvaluatedAt=l.createdAt;bad.push(l);
  for(const candidate of bad)assert.equal(findCoreDecision(m,'over',1,[candidate],NOW)?.probability,base.probability);
});
test('sequence gaps and reconnects do not fabricate a consecutive lesson match',()=>{
  const m=market([1,2,3,5,7,9]);const gap=m.recentTicks.map(t=>({...t}));
  gap[gap.length-1].sequence=99;m.recentTicks=gap;
  assert.deepEqual(findCoreDecision(m,'over',1,[lesson()],NOW)?.lessonIds,[]);
  const split=market([5,7,9]);split.recentTicks=split.recentTicks.map((t,i)=>({...t,segment:i===2?'new':'old'}));
  assert.equal(findCoreDecision(split,'over',1,[lesson()],NOW)?.features.samples,1);
  assert.deepEqual(findCoreDecision(split,'over',1,[lesson()],NOW)?.lessonIds,[]);
});
test('decision snapshots are deeply immutable and change with a new cutoff',()=>{
  const m=market(),decision=pick(m);
  assert.ok(Object.isFrozen(decision));assert.ok(Object.isFrozen(decision.cutoff));assert.ok(Object.isFrozen(decision.features));
  assert.throws(()=>{(decision.features as {samples:number}).samples=99},TypeError);
  const next=market();next.recentTicks=[...next.recentTicks,{quote:105,digit:5,epoch:NOW/1000,sequence:61,segment:'a'}];
  assert.notEqual(pick(next).decisionId,decision.decisionId);
  assert.equal(pick(m).decisionId,decision.decisionId);
});

test('a reliable adverse pattern lowers confidence based on outcomes, without stacking warnings',()=>{
  const m=market([1,2,3,5,7,9]),base=findCoreDecision(m,'over',1,[],NOW)!;
  const warning=lesson();warning.id='adverse-lesson';
  warning.patternEvidence!.matched={trades:100,wins:50,profit:-40,stake:100};
  warning.patternEvidence!.comparable={trades:100,wins:95,profit:12,stake:100};
  const learned=findCoreDecision(m,'over',1,[warning],NOW)!;
  assert.ok(learned.probability<base.probability);
  assert.ok(base.probability-learned.probability<=.04);
  assert.deepEqual(learned.lessonIds,['adverse-lesson']);
  assert.ok(learned.features.lessonAdjustment<0);
  const duplicate={...warning,id:'same-warning'};
  assert.equal(findCoreDecision(m,'over',1,[warning,duplicate],NOW)?.probability,learned.probability);
  assert.equal(findCoreDecision(m,'under',8,[warning],NOW)?.features.lessonAdjustment,0);
});
