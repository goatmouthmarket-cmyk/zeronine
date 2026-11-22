import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLessonRule, normalizeLessonConditions, type CoreLessonRule, type EvidenceTrade } from '../src/core/lessonRules.ts';

const rule:CoreLessonRule={id:'lesson',version:1,accountId:'demo-a',sourceTradeId:'source',marketSymbol:'R_100',expectedDirection:'over',barrier:2,
  mode:'demo',stance:'good',conditions:{digitSequence:{side:'high',count:3}},note:'after three high digits',confidence:3,createdAt:100_000,legacyInsightId:null};
const trade:EvidenceTrade={id:'later',accountId:'demo-a',market:'R_100',direction:'over',barrier:2,mode:'demo',status:'won',createdAt:110_000,settledAt:112_000,profit:.4,stake:1,
  context:{entryEpoch:111,before:[{digit:5,epoch:108},{digit:6,epoch:109},{digit:9,epoch:110}],cowShownAt:109_000,cowEdge:.04,cowConfidence:.74}};
test('only a confirmed supported rule is accepted',()=>{
  assert.deepEqual(normalizeLessonConditions({digitSequence:{side:'high',count:3}}),rule.conditions);
  for(const value of [{},{digitSequence:{side:'high',count:4}},{edge:{min:.3,max:.1}},{confidence:{min:'0.7'}}]) assert.throws(()=>normalizeLessonConditions(value));
});
test('a real later settled trade matching three preceding digits is evidence',()=>{
  const result=evaluateLessonRule(rule,trade);
  assert.equal(result.classification,'matched');assert.equal(result.conditions.digitSequence,true);
});
test('a different sequence is comparison evidence even when it wins',()=>{
  const different={...trade,context:{...trade.context,before:[{digit:5,epoch:108},{digit:2,epoch:109},{digit:9,epoch:110}]}};
  assert.equal(evaluateLessonRule(rule,different).classification,'comparison');
});
test('the same setup from another account or mode is never evidence',()=>{
  for(const modified of [{...trade,accountId:'other'},{...trade,mode:'real'}]) assert.equal(evaluateLessonRule(rule,modified).classification,'skipped');
});
test('the source or an earlier trade cannot validate its own lesson',()=>{
  for(const modified of [{...trade,id:'source'},{...trade,createdAt:99_000},{...trade,createdAt:100_000}]) assert.equal(evaluateLessonRule(rule,modified).reason,'not_a_later_trade');
});
test('winning versus losing does not affect pattern membership or good/bad judgment',()=>{
  const loss={...trade,status:'lost',profit:-1};
  assert.equal(evaluateLessonRule(rule,loss).classification,'matched');
  assert.equal(evaluateLessonRule({...rule,stance:'warning'},trade).classification,'matched');
});
test('future ticks, incomplete ticks and null results are skipped explicitly',()=>{
  assert.equal(evaluateLessonRule(rule,{...trade,context:{entryEpoch:111,before:[{digit:5,epoch:108}]}}).reason,'missing_before_ticks');
  assert.equal(evaluateLessonRule(rule,{...trade,context:{entryEpoch:111,before:[{digit:5,epoch:108},{digit:6,epoch:109},{digit:7,epoch:112}]}}).reason,'invalid_before_ticks');
  assert.equal(evaluateLessonRule(rule,{...trade,profit:null}).reason,'missing_result_values');
});
test('edge and confidence require captured pre-entry values and all conditions must match',()=>{
  const extended={...rule,conditions:{...rule.conditions,edge:{min:.03},confidence:{min:.7,max:.8}}};
  assert.equal(evaluateLessonRule(extended,trade).classification,'matched');
  assert.equal(evaluateLessonRule(extended,{...trade,context:{...trade.context,cowEdge:.01}}).classification,'comparison');
  assert.equal(evaluateLessonRule(extended,{...trade,context:{...trade.context,cowShownAt:120_000}}).reason,'missing_pre_entry_edge');
});
test('missing data can be checked later when the same real context completes',()=>{
  assert.equal(evaluateLessonRule(rule,{...trade,context:null}).classification,'skipped');
  assert.equal(evaluateLessonRule(rule,trade).classification,'matched');
});

test('Core tick identities must be consecutive within one connection segment',()=>{
  const identified={...trade,context:{...trade.context,engineVersion:'core-v1',before:[{digit:5,epoch:108,sequence:8,segment:'a'},{digit:6,epoch:109,sequence:9,segment:'a'},{digit:9,epoch:110,sequence:10,segment:'a'}]}};
  assert.equal(evaluateLessonRule(rule,identified).classification,'matched');
  const gaps={...identified,context:{...identified.context,before:[{digit:5,epoch:108,sequence:8,segment:'a'},{digit:6,epoch:109,sequence:10,segment:'a'},{digit:9,epoch:110,sequence:11,segment:'a'}]}};
  assert.equal(evaluateLessonRule(rule,gaps).reason,'gapped_before_ticks');
  const reconnect={...identified,context:{...identified.context,before:[{digit:5,epoch:108,sequence:8,segment:'a'},{digit:6,epoch:109,sequence:9,segment:'b'},{digit:9,epoch:110,sequence:10,segment:'b'}]}};
  assert.equal(evaluateLessonRule(rule,reconnect).reason,'gapped_before_ticks');
  assert.equal(evaluateLessonRule(rule,{...trade,context:{...trade.context,engineVersion:'core-v1'}}).reason,'missing_tick_identity');
});

