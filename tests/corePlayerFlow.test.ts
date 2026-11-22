import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DerivPrivateClient as PrivateClient } from '../src/deriv/privateClient.ts';

process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'core-player-flow-'));
process.env.SESSION_SECRET='core-player-flow-test-secret-32-characters';

test('Core routes preserve account isolation, quote math and manual trading without Core tables',async t=>{
  const [{default:Fastify},{default:cookie},{default:websocket},{registerPlayerTrading},{DerivPrivateClient},{MarketRegistry},{setPrecision},{findCoreDecision,CORE_CONTRACT_POLICY}]=await Promise.all([
    import('fastify'),import('@fastify/cookie'),import('@fastify/websocket'),import('../src/api/playerTrading.ts'),
    import('../src/deriv/privateClient.ts'),import('../src/core/marketState.ts'),import('../src/core/digitMath.ts'),import('../src/core/predictionEngine.ts'),
  ]);
  const originals={connect:DerivPrivateClient.prototype.connect,getQuote:DerivPrivateClient.prototype.getQuote,placeBuy:DerivPrivateClient.prototype.placeBuy,
    getOpenContractIds:DerivPrivateClient.prototype.getOpenContractIds,getContractSnapshot:DerivPrivateClient.prototype.getContractSnapshot,
    isConnected:Object.getOwnPropertyDescriptor(DerivPrivateClient.prototype,'isConnected'),connectedAccountId:Object.getOwnPropertyDescriptor(DerivPrivateClient.prototype,'connectedAccountId')};
  const connected=new WeakMap<PrivateClient,string>(),sessions=new Map([
    ['session-alice',{accountId:'VRTC_CORE_ALICE',token:'fake-alice'}],['session-bob',{accountId:'VRTC_CORE_BOB',token:'fake-bob'}],['session-charlie',{accountId:'VRTC_CORE_CHARLIE',token:'fake-charlie'}],
  ]);
  const now=Date.now(),epoch=Math.floor(now/1000),registry=new MarketRegistry({onTick:()=>{}});
  registry.ensure('R_10');registry.setDisplay('R_10','Volatility 10');setPrecision('R_10',1);
  for(let index=0;index<40;index++){const digit=index%10;registry.push('R_10',100+digit/10,epoch-43+index,digit);}
  registry.push('R_10',100.5,epoch-2,5);registry.push('R_10',100.6,epoch-1,6);registry.push('R_10',100.7,epoch,7);
  let migrationReady=false,failInitialContext=true,quoteMultiplier=2;
  const buys:string[]=[],writes:Array<{accountId:string;context:Record<string,unknown>}>=[],attempts:Array<{accountId:string;attempt:Record<string,unknown>}>=[];
  const active=new Map<string,{id:string;status:string;provider_contract_id:string|null;market:string}>();
  const evidence={
    health:async()=>migrationReady,drainEvidenceJobs:async()=>{},requestEvaluation:async()=>{},
    lessonSummaries:async(accountId:string)=>{
      if(!migrationReady)throw Error('Core tables unavailable');
      return accountId==='VRTC_CORE_ALICE'?[{engineEvidence:{
        id:'alice-rule',marketSymbol:'R_10',expectedDirection:'over',barrier:2,createdAt:now-86400000,confirmedPattern:{side:'high',count:3},
        patternEvidence:{supported:true,forwardOnly:true,complete:true,firstEvaluatedAt:now-2000,lastEvaluatedAt:now-1000,
          matched:{trades:100,wins:98,profit:20,stake:100},comparable:{trades:100,wins:50,profit:-20,stake:100}},
      }}]:[];
    },
    readResearchRun:async(accountId:string)=>{
      if(!migrationReady)throw Error('Core tables unavailable');
      if(accountId==='VRTC_CORE_CHARLIE')return{id:'qualified-charlie-run',engineVersion:'core-v1',contractPolicy:CORE_CONTRACT_POLICY,stake:1,startingBalance:100,balance:120,netProfit:20,
        takeProfit:30,maxLoss:10,settled:200,wins:180,losses:20,missing:0,fills:200,autoEnabled:false,activationEvidence:null,startedAt:now-100000,
        lastSettledAt:now-2000,totalStaked:200,probabilitySquaredError:20,baselineSquaredError:40,quoteBreakevenSum:100};
      return accountId==='VRTC_CORE_ALICE'?{id:'saved-alice-run',engineVersion:'core-v1',stake:1,startingBalance:100,balance:101,netProfit:1,
        takeProfit:10,maxLoss:10,settled:2,wins:2,losses:0,missing:0,fills:2,autoEnabled:false,activationEvidence:null,startedAt:now-10000}:null;
    },
    readResearchResults:async(accountId:string)=>accountId==='VRTC_CORE_ALICE'?[{id:'alice-result',runId:'saved-alice-run',status:'won',profit:1}]:[],
    saveResearchRun:async()=>{},saveResearchResult:async()=>{},
    saveDecision:async()=>{},
    recordAttempt:async(accountId:string,attempt:Record<string,unknown>)=>{attempts.push({accountId,attempt});},
  };
  const store={
    coreEvidence:evidence,resolveSession:async(secret:string)=>sessions.get(secret)??null,
    riskSnapshot:async()=>({mode:'base',streak:0,debt:0,attempts:0,cycleStake:0,peakBalance:100}),
    activeContract:async(accountId:string)=>active.get(accountId)??null,listTrades:async()=>[],
    reserve:async(accountId:string)=>{if(active.has(accountId))throw Error('reserved');const id=randomUUID();active.set(accountId,{id,status:'purchasing',provider_contract_id:null,market:'R_10'});return id;},
    markPurchased:async(accountId:string,id:string,provider:string)=>{assert.equal(active.get(accountId)?.id,id);active.set(accountId,{id,status:'open',provider_contract_id:provider,market:'R_10'});},
    markUnknown:async()=>{},cancelBeforeBuy:async(accountId:string)=>{active.delete(accountId);},recordSettlement:async(accountId:string)=>{active.delete(accountId);},
    saveTradeContext:async(accountId:string,_contractId:string,context:Record<string,unknown>)=>{
      if(failInitialContext){failInitialContext=false;throw Error('Simulated first evidence write failure');}
      writes.push({accountId,context});
    },
  };
  DerivPrivateClient.prototype.connect=async function(_token,accountId){connected.set(this,accountId!);return{loginid:accountId!,balance:100,currency:'USD',mode:'demo'};};
  Object.defineProperty(DerivPrivateClient.prototype,'isConnected',{configurable:true,get(){return connected.has(this);}});
  Object.defineProperty(DerivPrivateClient.prototype,'connectedAccountId',{configurable:true,get(){return connected.get(this)??null;}});
  DerivPrivateClient.prototype.getOpenContractIds=async()=>new Set();
  DerivPrivateClient.prototype.getQuote=async args=>({id:'fake-proposal',askPrice:args.amount,payout:args.amount*quoteMultiplier,spot:100.7,barrier:args.barrier,direction:args.direction,
    requestSentAt:Date.now(),receivedAt:Date.now(),roundTripMs:0,basis:'stake'});
  DerivPrivateClient.prototype.placeBuy=async function(){
    const accountId=connected.get(this)!;buys.push(accountId);
    registry.push('R_10',100.8,epoch,8);registry.push('R_10',100.9,epoch,9);registry.push('R_10',100,epoch,0);
    return{contractId:'fake-contract-'+accountId,buyPrice:1,payout:2,purchaseTime:Date.now()};
  };
  DerivPrivateClient.prototype.getContractSnapshot=async()=>({contractId:'fake-contract',status:'open',profit:0,sellPrice:0,buyPrice:1,settled:false,
    entrySpot:100.7,entryDigit:7,entryTickTime:epoch});
  const app=Fastify();
  try{
    await app.register(cookie,{secret:process.env.SESSION_SECRET});
    await app.register(websocket);
    app.get('/test/session/:name',(req,reply)=>{const name=(req.params as {name:string}).name;reply.setCookie('deriv_cows_session','session-'+name,{signed:true,path:'/'});return{ok:true};});
    registerPlayerTrading(app,store as never,registry);
    const cookieFor=async(name:string)=>String((await app.inject({method:'GET',url:'/test/session/'+name})).headers['set-cookie']).split(';')[0];
    const alice=await cookieFor('alice'),bob=await cookieFor('bob'),charlie=await cookieFor('charlie');
    const order={market:'R_10',direction:'over',barrier:2,stake:1,minEdge:0};
    let previewId='';

    await t.test('public candidates never expose a private account or allow research writes',async()=>{
      const result=await app.inject({method:'GET',url:'/api/core/candidates'});
      assert.equal(result.statusCode,200,result.body);assert.equal(result.json().accountId,null);assert.equal(result.json().autoEnabled,false);
      assert.ok(result.json().candidates.length>0);
      for(const request of [{method:'GET' as const,url:'/api/core/research'},{method:'POST' as const,url:'/api/core/research/start',payload:{stake:1,startingBalance:100}}]){
        const denied=await app.inject(request);assert.equal(denied.statusCode,401,denied.body);
      }
    });
    await t.test('missing Core migration disables research while manual preview uses shared engine math',async()=>{
      const unavailable=await app.inject({method:'GET',url:'/api/core/research',headers:{cookie:alice}});
      assert.equal(unavailable.statusCode,200,unavailable.body);assert.equal(unavailable.json().available,false);
      const start=await app.inject({method:'POST',url:'/api/core/research/start',headers:{cookie:alice},payload:{stake:1,startingBalance:100}});
      assert.equal(start.statusCode,503,start.body);
      const preview=await app.inject({method:'POST',url:'/api/player/trade/preview',headers:{cookie:alice},payload:order});
      assert.equal(preview.statusCode,200,preview.body);previewId=preview.json().previewId;
      const decision=findCoreDecision(registry.coreMarkets()[0],'over',2,[],Date.now())!;
      assert.ok(decision);assert.equal(preview.json().order.source,'manual');
      assert.equal(preview.json().order.coreDecision.probability,decision.probability);
      assert.ok(Math.abs(preview.json().edge-(decision.probability-.5))<1e-12);
      assert.equal(buys.length,0);
    });
    await t.test('a preview belongs only to its signed account',async()=>{
      const stolen=await app.inject({method:'POST',url:'/api/player/trade/confirm',headers:{cookie:bob},payload:{previewId,idempotencyKey:'bob-cannot-buy-alice'}});
      assert.equal(stolen.statusCode,403,stolen.body);assert.equal(buys.length,0);
    });
    await t.test('only fake own-account purchase executes and final metadata survives an initial evidence-write failure',async()=>{
      const purchase=await app.inject({method:'POST',url:'/api/player/trade/confirm',headers:{cookie:alice},payload:{previewId,idempotencyKey:'alice-fake-purchase'}});
      assert.equal(purchase.statusCode,200,purchase.body);assert.deepEqual(buys,['VRTC_CORE_ALICE']);
      for(let wait=0;wait<30&&!writes.length;wait++)await new Promise(resolve=>setTimeout(resolve,10));
      assert.ok(writes.length,'Final context is saved even when first write failed');
      const saved=writes[writes.length-1];assert.equal(saved.accountId,'VRTC_CORE_ALICE');
      assert.equal(saved.context.source,'manual');assert.equal(saved.context.engineVersion,'core-v1');
      assert.equal((saved.context.coreDecision as {engineVersion:string}).engineVersion,'core-v1');
      assert.equal(saved.context.complete,true);assert.equal((saved.context.before as unknown[]).length,3);
      for(let wait=0;wait<30&&!attempts.length;wait++)await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(attempts[0].accountId,'VRTC_CORE_ALICE');
      assert.ok(String(attempts[0].attempt.decisionId).startsWith('VRTC_CORE_ALICE:'));
      active.clear();
    });
    await t.test('saved research and lesson influence stay account scoped',async()=>{
      migrationReady=true;
      const aliceResearch=await app.inject({method:'GET',url:'/api/core/research',headers:{cookie:alice}});
      const bobResearch=await app.inject({method:'GET',url:'/api/core/research',headers:{cookie:bob}});
      assert.equal(aliceResearch.statusCode,200,aliceResearch.body);assert.equal(aliceResearch.json().run.id,'saved-alice-run');assert.equal(aliceResearch.json().running,false);
      assert.equal(bobResearch.json().run,null);assert.deepEqual(bobResearch.json().recent,[]);
      assert.equal(aliceResearch.json().recent[0].id,'alice-result');
      // Restore a current three-high-digit pattern after the fake purchase.
      registry.push('R_10',101.5,epoch,5);registry.push('R_10',101.6,epoch,6);registry.push('R_10',101.7,epoch,7);
      await app.inject({method:'GET',url:'/api/core/candidates',headers:{cookie:alice}});
      await app.inject({method:'GET',url:'/api/core/candidates',headers:{cookie:bob}});
      await new Promise(resolve=>setTimeout(resolve,20));
      const a=await app.inject({method:'GET',url:'/api/core/candidates',headers:{cookie:alice}});
      const b=await app.inject({method:'GET',url:'/api/core/candidates',headers:{cookie:bob}});
      assert.equal(a.json().accountId,'VRTC_CORE_ALICE');assert.equal(b.json().accountId,'VRTC_CORE_BOB');
      assert.ok(a.json().candidates.some((row:{lessonIds:string[]})=>row.lessonIds.includes('alice-rule')));
      assert.ok(b.json().candidates.every((row:{lessonIds:string[]})=>!row.lessonIds.includes('alice-rule')));
    });
    await t.test('Auto cannot place trades or activate without qualifying research',async()=>{
      const denied=await app.inject({method:'POST',url:'/api/player/trade/preview',headers:{cookie:bob},payload:{...order,rangerAutomation:true}});
      assert.equal(denied.statusCode,409,denied.body);assert.match(denied.json().error,/research/i);
      const activation=await app.inject({method:'POST',url:'/api/core/research/activate',headers:{cookie:bob}});
      assert.equal(activation.statusCode,409,activation.body);assert.equal(buys.length,1);
    });
    await t.test('qualifying saved research still needs explicit activation before that account can preview Auto',async()=>{
      const before=await app.inject({method:'POST',url:'/api/player/trade/preview',headers:{cookie:charlie},payload:{...order,rangerAutomation:true}});
      assert.equal(before.statusCode,409,before.body);
      const activate=await app.inject({method:'POST',url:'/api/core/research/activate',headers:{cookie:charlie}});
      assert.equal(activate.statusCode,200,activate.body);assert.equal(activate.json().autoEnabled,true);
      const after=await app.inject({method:'POST',url:'/api/player/trade/preview',headers:{cookie:charlie},payload:{...order,rangerAutomation:true}});
      assert.equal(after.statusCode,200,after.body);assert.equal(after.json().order.source,'auto');
      const other=await app.inject({method:'POST',url:'/api/player/trade/preview',headers:{cookie:bob},payload:{...order,rangerAutomation:true}});
      assert.equal(other.statusCode,409,other.body);assert.equal(buys.length,1,'Activation and previews never buy');
    });
    await t.test('Auto rejects a nonpositive live quote edge at preview and repriced confirmation',async()=>{
      quoteMultiplier=1.01;
      try{
        const denied=await app.inject({method:'POST',url:'/api/player/trade/preview',headers:{cookie:charlie},payload:{...order,rangerAutomation:true}});
        assert.equal(denied.statusCode,409,denied.body);assert.equal(buys.length,1);
      }finally{quoteMultiplier=2;}
      const preview=await app.inject({method:'POST',url:'/api/player/trade/preview',headers:{cookie:charlie},payload:{...order,rangerAutomation:true}});
      assert.equal(preview.statusCode,200,preview.body);
      quoteMultiplier=1.01;
      try{
        const denied=await app.inject({method:'POST',url:'/api/player/trade/confirm',headers:{cookie:charlie},payload:{previewId:preview.json().previewId,idempotencyKey:'charlie-repriced-edge'}});
        assert.equal(denied.statusCode,409,denied.body);assert.equal(buys.length,1,'An unprofitable repriced quote never buys');
      }finally{quoteMultiplier=2;}
    });
    await t.test('the archived Railway runner cannot be re-enabled by an environment flag',async()=>{
      const previous=process.env.ENABLE_RAILWAY_RANGER_AUTO;
      try{
        process.env.ENABLE_RAILWAY_RANGER_AUTO='true';
        const result=await app.inject({method:'POST',url:'/api/player/automation/start',headers:{cookie:bob},payload:{
          stake:1,minWin:.7,shots:1,maxTrades:0,green:true,gold:true,red:true,pastureContracts:[{market:'R_10',direction:'over',barrier:2}],
        }});
        assert.equal(result.statusCode,410,result.body);
        assert.equal(buys.length,1,'Archived runner never reaches the fake buy client');
      }finally{
        if(previous===undefined)delete process.env.ENABLE_RAILWAY_RANGER_AUTO;else process.env.ENABLE_RAILWAY_RANGER_AUTO=previous;
      }
    });
  }finally{
    await app.close();
    DerivPrivateClient.prototype.connect=originals.connect;DerivPrivateClient.prototype.getQuote=originals.getQuote;
    DerivPrivateClient.prototype.placeBuy=originals.placeBuy;DerivPrivateClient.prototype.getOpenContractIds=originals.getOpenContractIds;
    DerivPrivateClient.prototype.getContractSnapshot=originals.getContractSnapshot;
    if(originals.isConnected)Object.defineProperty(DerivPrivateClient.prototype,'isConnected',originals.isConnected);
    if(originals.connectedAccountId)Object.defineProperty(DerivPrivateClient.prototype,'connectedAccountId',originals.connectedAccountId);
  }
});

