import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('a touch lesson gesture still consumes the synthetic click after its cow moves',()=>{
 const id='11111111-2222-4333-8444-555555555555';let focusEvents=0,legacyShots=0;
 const cow={alive:true,lessonBadge:{x:10,y:20,width:80,height:17,lessonId:id,state:'matched'}};
 const ctx=harness({cows:[cow],window:{dispatchEvent:()=>{focusEvents++;}},
  CustomEvent:class{constructor(_type:string,_options:unknown){}},
 });
 const names=['consumePastureLesson','pastureLessonPointerDown','pastureLessonPointerUp','pastureLessonClick'];
 vm.runInContext(between('pastureLessonAtClientPoint','consumePastureLesson')
  +names.map(name=>'function '+name+source.split('function '+name)[1].split('\n')[0]).join('\n'),ctx);
 const event=(type:string)=>({type,pointerId:7,pointerType:'touch',clientX:20,clientY:25,stopped:false,prevented:false,
  preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}});
 const down=event('pointerdown');ctx.event=down;vm.runInContext('pastureLessonPointerDown(event)',ctx);
 assert.equal(down.stopped,true);
 // The opening Brain menu changes zoom/positions before the browser sends click.
 cow.lessonBadge.x=500;
 const up=event('pointerup');ctx.event=up;vm.runInContext('pastureLessonPointerUp(event)',ctx);
 assert.equal(up.stopped,true);assert.equal(focusEvents,1);
 const click=event('click');ctx.event=click;vm.runInContext('pastureLessonClick(event)',ctx);
 if(!click.stopped)legacyShots++;
 assert.equal(click.prevented,true);assert.equal(click.stopped,true);
 assert.equal(focusEvents,1,'The synthesized click does not open or request the same lesson twice');
 assert.equal(legacyShots,0);assert.equal((ctx.submitted as unknown[]).length,0);
});


test('all-negative markets keep honest WAIT cards and a visible waiting status without an Auto candidate',()=>{
 const status={textContent:'',dataset:{} as Record<string,string>,title:''};
 const setup={state:'wait',label:'Wait',reason:'Payout costs more than the estimated chance.',lesson:'none',probabilityKind:'estimate'};
 const ctx=harness({$:()=>status,inputs:{markets:[market],candidates:[candidate({edge:-.04,expectedROI:-.05,setup})]}});
 vm.runInContext('applyMarkets(inputs.markets,inputs.candidates,[],[],[])',ctx);
 assert.equal(vm.runInContext('contracts.length',ctx),1);
 assert.equal(vm.runInContext('pastureSetup(contracts[0]).state',ctx),'wait');
 assert.equal(vm.runInContext('selectRangerAutoCandidate(contracts)',ctx),null);
 assert.equal(vm.runInContext('pastureBestValueCow',ctx),null);
 assert.equal(status.dataset.state,'wait');assert.match(status.textContent,/Waiting/i);
});

test('offline and stale prices clear highlights without retaining an eligible old setup',()=>{
 const setup={state:'quoted_edge',label:'Quoted edge',reason:'A positive quoted edge.',lesson:'none',probabilityKind:'estimate'};
 const tag={...candidate({setup,payoutSource:'live_quote'}),symbol:'R_100',kind:'OVER',p:.74,score:.04};
 const cow={alive:true,contract:tag};
 const ctx=harness({contracts:[tag],cows:[cow]});
 vm.runInContext('updatePastureHighlightTargets()',ctx);assert.equal(ctx.pastureBestValueCow,cow);
 vm.runInContext('lastRoomState.feedConnected=false;updatePastureHighlightTargets()',ctx);
 assert.equal(ctx.pastureBestValueCow,null);assert.equal(vm.runInContext('pastureSetup(contracts[0]).state',ctx),'waiting_prices');
 assert.equal(vm.runInContext('selectRangerAutoCandidate(contracts)',ctx),null);
 vm.runInContext('lastRoomState.feedConnected=true;contracts[0].fresh=false;updatePastureHighlightTargets()',ctx);
 assert.equal(ctx.pastureBestValueCow,null);assert.equal(vm.runInContext('pastureSetup(contracts[0]).state',ctx),'waiting_prices');
});

test('gold selection means best return rather than the market with the largest sample',()=>{
 const a={...candidate(),symbol:'R_100',kind:'OVER',p:.74,score:.08,digitSamples:30};
 const b={...candidate({market:'R_10'}),symbol:'R_10',kind:'UNDER',p:.74,score:.01,digitSamples:1000};
 const ctx=harness({items:[a,b]});
 assert.equal(vm.runInContext('selectRangerAutoCandidate(items,{minEdge:0,green:false,gold:true,red:false}).symbol',ctx),'R_100');
});

test('Brain Auto obeys ring choices and does not turn an unweighted lesson match into a helpful signal',()=>{
 const supports={state:'check_quote',label:'Check quote',reason:'Estimate only.',lesson:'supports',probabilityKind:'estimate'};
 const plain={...candidate(),symbol:'R_100',kind:'OVER',p:.74,score:.08,lessonMatches:[{id:'note',state:'matched'}]};
 const taught={...candidate({market:'R_10',setup:supports}),symbol:'R_10',kind:'UNDER',p:.74,score:.03};
 const ctx=harness({contracts:[plain,taught],cows:[{alive:true,contract:plain},{alive:true,contract:taught}]});
 assert.equal(vm.runInContext("brainScanUncached(null,{minEdge:0,green:false,gold:false,red:true}).pick.tag.symbol",ctx),'R_10');
 assert.equal(vm.runInContext("brainScanUncached(null,{minEdge:0,green:false,gold:false,red:false}).pick",ctx),null);
});

function drawTag(tag:Record<string,unknown>){
 const texts:string[]=[],strokes:string[]=[];
 const context=new Proxy({strokeStyle:'',measureText:(value:string)=>({width:String(value).length*3}),
  fillText:(value:string)=>texts.push(String(value)),stroke(){strokes.push(this.strokeStyle);}},
  {get(target,key){return key in target?Reflect.get(target,key):()=>{};}});
 const ctx=harness({c:context,hoverCow:null,attackCow:null,player:{x:0,y:0},zoom:1,
  recoveryRecommendation:null,rect:()=>{},poly:()=>{},circle:()=>{},cowLessonArt:{complete:false},
  camera:()=>({x:0,y:0}),testCow:{alive:true,x:100,y:100,hp:3,max:3,contract:tag}});
 const start=source.indexOf('function cow(v)'),end=source.indexOf('const rangerAppearanceDefaults',start);
 vm.runInContext(source.slice(start,end)+'\ncow(testCow)',ctx);
 return{texts,strokes,ctx};
}
test('cow cards show actual Core probability, estimated versus quoted edge, and independent lesson badges',()=>{
 const setup={state:'check_quote',label:'Check quote',reason:'Estimate only.',lesson:'none',probabilityKind:'estimate'};
 const tag={...candidate({setup}),symbol:'R_100',kind:'OVER',market:'Volatility 100',p:.74,score:.04,
  lessonMatches:[{id:'11111111-2222-4333-8444-555555555555',state:'matched'}]};
 const estimated=drawTag(tag);
 assert.ok(estimated.texts.includes('74% EST WIN'));assert.ok(estimated.texts.some(value=>value.startsWith('EST +')));
 assert.ok(estimated.texts.some(value=>value.startsWith('Lesson match')));
 assert.ok(!estimated.texts.some(value=>/50%|BET NOW/.test(value)));
 assert.ok(!estimated.strokes.includes('#38d783'),'Estimated positive edge is amber rather than a confirmed green quote');
 const quoted=drawTag({...tag,payoutSource:'live_quote',setup:{...setup,state:'quoted_edge',label:'Quoted edge'}});
 assert.ok(quoted.strokes.includes('#38d783'));assert.ok(quoted.texts.some(value=>value.startsWith('QUOTE +')));
 assert.equal((estimated.ctx.testCow as {lessonBadge:{lessonId:string}}).lessonBadge.lessonId,tag.lessonMatches[0].id);
});

test('a lesson badge consumes its click and opens the lesson without selecting or submitting a cow',()=>{
 const id='11111111-2222-4333-8444-555555555555';let prevented=0,stopped=0;const dispatched:Array<{type:string;detail:unknown}>=[];
 const ctx=harness({cows:[{alive:true,lessonBadge:{x:10,y:20,width:80,height:17,lessonId:id,state:'matched'}}],
  window:{dispatchEvent:(event:{type:string;detail:unknown})=>dispatched.push(event)},
  CustomEvent:class{type:string;detail:unknown;constructor(type:string,options:{detail:unknown}){this.type=type;this.detail=options.detail;}},
  event:{clientX:20,clientY:25,preventDefault:()=>{prevented++;},stopImmediatePropagation:()=>{stopped++;}}});
 vm.runInContext(between('pastureLessonAtClientPoint','consumePastureLesson').replace(/let pastureLessonTouchAt[^;]+;/,'')
  +'\nfunction consumePastureLesson'+source.split('function consumePastureLesson')[1].split('\n')[0],ctx);
 assert.equal(vm.runInContext('consumePastureLesson(event,true)',ctx),true);
 assert.equal(prevented,1);assert.equal(stopped,1);
 assert.deepEqual(JSON.parse(JSON.stringify(dispatched)),[{type:'zeronine:brain-lesson-focus',detail:{lessonId:id}}]);
 assert.equal((ctx.submitted as unknown[]).length,0);assert.equal(ctx.target,null);
});

import { isCorePastureCandidate, rankCoreCandidates } from '../src/core/predictionEngine.ts';

const source=readFileSync(new URL('../web/public/trading-room-core.js',import.meta.url),'utf8');
function between(name:string,next:string):string{
 const start=source.indexOf('function '+name+'('),end=source.indexOf('function '+next+'(',start);
 assert.ok(start>=0&&end>start,'Pasture function boundaries exist: '+name);
 return source.slice(start,end);
}
const functions=[
 between('pastureSetup','observeMarketFreshness'),
 between('applyMarkets','splitDigits'),
 between('brainCowScore','brainFactorList'),
 between('rangerAutoEligible','rangerAutoRingMatches'),
 between('rangerAutoRingMatches','selectRangerAutoCandidate'),
 between('selectRangerAutoCandidate','rangerAutoSettingsFromInputs'),
 between('onCowDefeated','clearPending'),
 between('brainScanUncached','brainScan'),
 between('renderPastureSetupStatus','pastureLessonAtClientPoint'),
 'function updatePastureHighlightTargets'+source.split('function updatePastureHighlightTargets')[1].split('\n')[0],
].join('\n');
function harness(extra:Record<string,unknown>={}){
 const ctx=vm.createContext({
  liveMarkets:[],contracts:[],cows:[{}],target:null,marketTickSequences:new Map(),
  observeMarketFreshness:()=>{},updateMarketTickSequences:()=>{},quoteFreshness:()=>({fresh:true}),
  rank:()=>{},updatePastureHighlightTargets:()=>{},performance:{now:()=>100},
  connectedAccount:true,pending:null,lockUntil:0,rangerBet:null,rangerBubbleDismissed:false,activeAccountId:'account-a',
  renderRangerBet:()=>{},notify:()=>{},brainEntryCheck:()=>null,brainEntryReaction:()=>{},
  window:{},brainSnipe:null,rangerAutoMinEdge:0,rangerAutoStatus:'',renderRangerAutoHud:()=>{},
  pastureWaitingSetup:{state:'waiting_prices',label:'Waiting for prices',reason:'Waiting for fresh Core prices.',lesson:'none',probabilityKind:'estimate'},
  pastureSetupStates:new Set(['waiting_prices','wait','check_quote','quoted_edge']),
  pastureBestValueCow:null,ghostCow:null,pastureSetupStatusAt:0,
  $:()=>({textContent:'',dataset:{},title:''}),
  brainCandidateEligible:()=>({ok:true}),brainFactorList:()=>[],
  selectedCowStake:()=>1,lastRoomState:{},plannedCowStake:()=>({stake:2}),stopRangerAuto:()=>{},
  submitted:[],submitContract:(...args:unknown[])=>{(ctx.submitted as unknown[][]).push(args)},
  ...extra,
 });
 vm.runInContext(functions,ctx);return ctx;
}
const candidate=(patch:Record<string,unknown>={})=>({
 engineVersion:'core-v1',market:'R_100',direction:'over',barrier:2,baseWin:.7,estWin:.74,
 edge:.02,expectedROI:.04,estPayout:1.4,fresh:true,decisionId:'core-decision',lessonIds:[],
 features:{samples:200,lessonAdjustment:0},cutoff:{sequence:51},payoutSource:'estimate',
 setup:{state:'check_quote',label:'Check quote',reason:'An estimate to check.',lesson:'none',probabilityKind:'estimate'},lessonMatches:[],...patch,
});
const market={symbol:'R_100',display:'Volatility 100 Index',fresh:true,recentDigits:Array(50).fill(9),
 recentQuotes:Array.from({length:40},(_,i)=>100+i)};
test('pasture forwards Core probability, edge and return unchanged despite one-sided ticks',()=>{
 const canonical=candidate({lessonMatches:[{id:'11111111-2222-4333-8444-555555555555',state:'matched'}]});
 const ctx=harness({inputs:{markets:[market],candidates:[canonical]}});
 vm.runInContext('applyMarkets(inputs.markets,inputs.candidates,[],[],[])',ctx);
 const tag=vm.runInContext('contracts[0]',ctx);
 assert.equal(tag.p,.74);assert.equal(tag.rawP,.74);assert.equal(tag.edge,.02);assert.equal(tag.score,.04);
 assert.equal(tag.decisionId,'core-decision');assert.equal(tag.tickSeq,51);assert.equal(tag.hitSignal,false);
 assert.equal(tag.setup,canonical.setup);assert.equal(tag.lessonMatches,canonical.lessonMatches);
 assert.equal(tag.riseRate,undefined,'No fabricated50% direction feature is reintroduced');
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
