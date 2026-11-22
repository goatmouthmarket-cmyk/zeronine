import { randomUUID } from 'node:crypto';
import { CORE_CONTRACT_POLICY, isCorePastureCandidate, rankCoreCandidates, evaluateCoreQuote, type CoreDecision, type CoreMarketInput, type CoreLessonEvidence } from './predictionEngine.ts';

export type ResearchConfig = { stake:number; startingBalance:number; takeProfit:number; maxLoss:number };
type ResearchQuote = { askPrice:number; payout:number };
type Result = { id:string; runId:string; market:string; direction:'over'|'under'; barrier:number; status:'open'|'won'|'lost'|'missing'; stake:number; profit:number|null; entryDigit:number; exitDigit:number|null; quotedPayout:number; settledAt:number|null; decisionId:string; engineVersion:string; contractPolicy:typeof CORE_CONTRACT_POLICY; entrySequence:number; openedAt:number; pilotWindowStartedAt?:number; segment:string; probability:number; baselineProbability:number };
export type ActivationEvidence = {engineVersion:'core-v1';contractPolicy:typeof CORE_CONTRACT_POLICY;startedAt?:number;activatedAt:number;lastSettledAt:number;settled:number;fills:number;missing:number;netProfit:number;modelBrier:number;baselineBrier:number};
export type PilotEvidence = {accountId:string;engineVersion:'core-v1';contractPolicy:typeof CORE_CONTRACT_POLICY;startedAt:number;lastSettledAt:number;settled:number;fills:number;missing:number;netProfit:number;totalStaked:number;probabilitySquaredError:number;baselineSquaredError:number;quoteBreakevenSum:number;runCount:number};
export type ResearchRun = ResearchConfig & { id:string; engineVersion:'core-v1'; contractPolicy:typeof CORE_CONTRACT_POLICY; balance:number; startedAt:number; settled:number; wins:number; losses:number; netProfit:number; maxDrawdown:number; peakBalance:number; phase:string; running:boolean; missing:number; baselineExpectedWins:number; predictedExpectedWins:number; fills:number; totalStaked:number; probabilitySquaredError:number; baselineSquaredError:number; quoteBreakevenSum:number; lastSettledAt:number; autoEnabled:boolean; activationEvidence:ActivationEvidence|null; pilotEvidence?:PilotEvidence };
export interface ResearchPersistence {
 saveResearchRun(accountId:string,run:{id:string;[key:string]:unknown}):Promise<void>;
 saveResearchResult(accountId:string,result:{id:string;runId:string;[key:string]:unknown}):Promise<void>;
 readResearchRun(accountId:string):Promise<Record<string,unknown>|null>;
 readResearchResults(accountId:string,runId:string,limit?:number):Promise<Record<string,unknown>[]>;
 saveDecision(accountId:string,snapshot:{id:string;engineVersion:string;[key:string]:unknown}):Promise<void>;
}
type Slot = { run:ResearchRun; recent:Result[]; pending:Result|null; busy:boolean; serial:number; lastCutoff:string; quote:(decision:CoreDecision,stake:number)=>Promise<ResearchQuote>; lessons:()=>CoreLessonEvidence[]; authorized:()=>Promise<boolean>; persistenceFailed:boolean; writes:Promise<void> };
export interface ResearchReadiness {ready:boolean;reason:string;settled:number;target:number;missing:number;fills:number;modelBrier:number|null;baselineBrier:number|null;pilotOnly:boolean;netProfit:number;runCount:number;startedAt:number|null;lastSettledAt:number|null}
export interface CoreResearchOptions { now?:()=>number; intervalMs?:number|false }

/** Virtual money only. This class has no buy API or account balance writer. */
export class CoreResearch {
 private slots = new Map<string,Slot>();
 private restoring = new Map<string,Promise<void>>();
 private restoreCheckedAt = new Map<string,number>();
 private timer:ReturnType<typeof setInterval>|null = null;
 private now:()=>number;
 private closed = false;
 private markets:()=>CoreMarketInput[];
 private persistence:ResearchPersistence;
 constructor(markets:()=>CoreMarketInput[],persistence:ResearchPersistence,options:CoreResearchOptions={}){
  this.markets=markets;this.persistence=persistence;this.now=options.now??Date.now;
  if(options.intervalMs!==false){
   this.timer=setInterval(()=>{void this.step();},Math.max(100,options.intervalMs??500));
   this.timer.unref();
  }
 }
 close(){
  this.closed=true;if(this.timer)clearInterval(this.timer);
  for(const [account,slot] of this.slots){slot.run.running=false;slot.run.phase='Paused';slot.serial++;this.persist(account,slot);}
 }
 /** One bounded server update. Exposed for deterministic replay and tests. */
 async step(account?:string){
  if(this.closed)return;
  const rows=account?[[account,this.slots.get(account)] as const]:[...this.slots];
  await Promise.all(rows.map(([id,slot])=>slot?this.tick(id,slot):Promise.resolve()));
 }
 private pauseSaving(slot:Slot){
  slot.persistenceFailed=true;slot.run.running=false;slot.run.autoEnabled=false;slot.serial++;slot.run.phase='Saving unavailable · research paused';
 }
 private persist(account:string,slot:Slot,result?:Result,decision?:CoreDecision){
  const run={...slot.run,pilotEvidence:slot.run.pilotEvidence?{...slot.run.pilotEvidence}:undefined,activationEvidence:slot.run.activationEvidence?{...slot.run.activationEvidence}:null},row=result?{...result}:null;
  // Preserve write order so an earlier open row cannot overwrite settlement.
  slot.writes=slot.writes.then(async()=>{
   if(decision)await this.persistence.saveDecision(account,{...decision,id:row?.decisionId??[account,decision.decisionId,decision.probability].join(':'),contractPolicy:CORE_CONTRACT_POLICY});
   if(row)await this.persistence.saveResearchResult(account,row);
   await this.persistence.saveResearchRun(account,run);
  }).catch(()=>{this.pauseSaving(slot);});
 }
 /** Await queued research writes without blocking quote or purchase routes. */
 async flush(account?:string){
  const rows=account?[this.slots.get(account)]:[...this.slots.values()];
  await Promise.all(rows.map(slot=>slot?.writes));
 }
 async restore(account:string){
  if(this.slots.has(account)||this.closed)return;
  const checked=this.restoreCheckedAt.get(account);
  if(checked!==undefined&&this.now()-checked<30_000)return;
  if(this.restoring.has(account))return this.restoring.get(account);
  const task=(async()=>{
   const saved=await this.persistence.readResearchRun(account);
   if(!saved||this.slots.has(account)||this.closed)return;
   const rows=await this.persistence.readResearchResults(account,String(saved.id),20);
   if(this.slots.has(account)||this.closed)return;
   const run={...saved,running:false,phase:'Saved run · paused',fills:Number(saved.fills)||0,totalStaked:Number(saved.totalStaked)||0,probabilitySquaredError:Number(saved.probabilitySquaredError)||0,baselineSquaredError:Number(saved.baselineSquaredError)||0,quoteBreakevenSum:Number(saved.quoteBreakevenSum)||0,lastSettledAt:Number(saved.lastSettledAt)||0,autoEnabled:saved.autoEnabled===true,activationEvidence:saved.activationEvidence??null} as unknown as ResearchRun;
   if(!this.validActivation(run.activationEvidence))run.autoEnabled=false;
   const legacyPilotDerived=run.pilotEvidence==null;
   run.pilotEvidence=this.pilotFor(account,run)??undefined;
   const recent=rows.map(row=>({...row})) as unknown as Result[];
   // Restart loses an unobserved fill/exit boundary. Never infer its outcome.
   const interrupted=recent.filter(row=>row.status==='open');
   for(const row of interrupted)row.status='missing';
   run.missing=(Number(run.missing)||0)+interrupted.length;
   for(const row of interrupted){
    const pilot=run.pilotEvidence;
    if(pilot&&(row.pilotWindowStartedAt===pilot.startedAt||(legacyPilotDerived&&row.pilotWindowStartedAt===undefined))){
     pilot.missing++;row.pilotWindowStartedAt=pilot.startedAt;
    }
   }
   const slot:Slot={run,recent,pending:null,busy:false,serial:0,lastCutoff:'',quote:async()=>{throw Error('Start a new research run');},lessons:()=>[],authorized:async()=>false,persistenceFailed:false,writes:Promise.resolve()};
   this.slots.set(account,slot);
   if(interrupted.length)for(const row of interrupted)this.persist(account,slot,row);else this.persist(account,slot);
  })().finally(()=>{this.restoring.delete(account);if(this.restoreCheckedAt.size>=5000)this.restoreCheckedAt.clear();this.restoreCheckedAt.set(account,this.now());});
  this.restoring.set(account,task);return task;
 }
 start(account:string,config:ResearchConfig,quote:Slot['quote'],lessons:Slot['lessons'],authorized:Slot['authorized']){
  if(this.closed)throw Error('Research has closed.');
  if(!account)throw Error('Connect an account to keep research results.');
  for(const key of ['stake','startingBalance','takeProfit','maxLoss'] as const){
   const value=config[key];
   if(!Number.isFinite(value)||value<0||((key==='stake'||key==='startingBalance')&&value<=0))throw Error('Enter positive virtual funds and stake.');
  }
  if(config.stake>config.startingBalance*.3)throw Error('Virtual stake must be within 30% of virtual funds.');
  if(config.maxLoss>0&&config.stake>config.maxLoss)throw Error('Virtual stake must fit within the loss limit.');
  this.restoreCheckedAt.delete(account);
  const old=this.slots.get(account);
  if(old?.run.running||old?.pending||old?.busy)throw Error('Finish the current virtual trade before starting another run.');
  if([...this.slots.values()].filter(slot=>slot.run.running).length>=20)throw Error('Research is busy. Try again shortly.');
  if(old)old.serial++;
  const pilot={...(this.pilotFor(account,old?.run)??this.emptyPilot(account,this.now(),0))};pilot.runCount++;
  const run:ResearchRun={...config,id:randomUUID(),engineVersion:'core-v1',contractPolicy:CORE_CONTRACT_POLICY,balance:config.startingBalance,startedAt:this.now(),settled:0,wins:0,losses:0,netProfit:0,maxDrawdown:0,peakBalance:config.startingBalance,phase:'Looking for a cow',running:true,missing:0,baselineExpectedWins:0,predictedExpectedWins:0,fills:0,totalStaked:0,probabilitySquaredError:0,baselineSquaredError:0,quoteBreakevenSum:0,lastSettledAt:0,autoEnabled:old?.run.autoEnabled===true&&this.validActivation(old.run.activationEvidence),activationEvidence:old?.run.autoEnabled===true&&this.validActivation(old.run.activationEvidence)?old.run.activationEvidence:null,pilotEvidence:pilot};
  const slot:Slot={run,recent:[],pending:null,busy:false,serial:0,lastCutoff:'',quote,lessons,authorized,persistenceFailed:false,writes:old?.writes??Promise.resolve()};
  this.slots.set(account,slot);this.persist(account,slot);return this.snapshot(account);
 }
 stop(account:string){
  const slot=this.slots.get(account);
  if(slot){slot.run.running=false;slot.run.phase=slot.pending?'Paused · finishing virtual trade':'Paused';slot.serial++;this.persist(account,slot);}
  return this.snapshot(account);
 }
 snapshot(account:string){
  const slot=this.slots.get(account);
  const readiness:ResearchReadiness=slot?this.readiness(slot.run,account):{ready:false,reason:'Collect paper results first.',settled:0,target:200,missing:0,fills:0,modelBrier:null,baselineBrier:null,pilotOnly:true,netProfit:0,runCount:0,startedAt:null,lastSettledAt:null};
  return {engineVersion:'core-v1',contractPolicy:CORE_CONTRACT_POLICY,available:true,running:slot?.run.running??false,canActivate:readiness.ready&&!slot?.persistenceFailed,autoEnabled:slot?.run.autoEnabled===true&&this.validActivation(slot.run.activationEvidence)&&!slot.persistenceFailed,readiness,run:slot?{...slot.run,pilotEvidence:slot.run.pilotEvidence?{...slot.run.pilotEvidence}:undefined,activationEvidence:slot.run.activationEvidence?{...slot.run.activationEvidence}:null}:null,recent:slot?slot.recent.map(row=>({...row})):[],coverage:{complete:slot?.run.settled??0,missing:slot?.run.missing??0},reason:slot?.persistenceFailed?'Saving unavailable. Research paused.':undefined};
 }
 private validActivation(e:ActivationEvidence|null):boolean{
  return !!e&&e.engineVersion==='core-v1'&&e.contractPolicy===CORE_CONTRACT_POLICY&&Number.isFinite(e.activatedAt)&&e.activatedAt<=this.now()&&
   Number.isFinite(e.startedAt??e.activatedAt)&&(e.startedAt??e.activatedAt)>0&&(e.startedAt===undefined||e.startedAt<=e.lastSettledAt)&&this.now()-(e.startedAt??e.activatedAt)<=7*86400000&&
   this.now()-e.lastSettledAt<=7*86400000&&e.lastSettledAt<=this.now()&&e.settled>=200&&
   Number.isInteger(e.settled)&&Number.isInteger(e.fills)&&Number.isInteger(e.missing)&&e.missing>=0&&
   e.fills>=e.settled+e.missing&&e.missing/e.fills<=.05&&Number.isFinite(e.netProfit)&&e.netProfit>0&&
   Number.isFinite(e.modelBrier)&&e.modelBrier>=0&&e.modelBrier<=1&&Number.isFinite(e.baselineBrier)&&
   e.baselineBrier>=0&&e.baselineBrier<=1&&e.modelBrier<=e.baselineBrier+1e-12;
 }
 private emptyPilot(account:string,startedAt:number,runCount=1):PilotEvidence{
  return {accountId:account,engineVersion:'core-v1',contractPolicy:CORE_CONTRACT_POLICY,startedAt,lastSettledAt:0,settled:0,fills:0,missing:0,netProfit:0,totalStaked:0,probabilitySquaredError:0,baselineSquaredError:0,quoteBreakevenSum:0,runCount};
 }
 private pilotFor(account:string,run?:ResearchRun):PilotEvidence|null{
  if(!run||run.engineVersion!=='core-v1'||run.contractPolicy!==CORE_CONTRACT_POLICY)return null;
  // Old compatible run JSON is account-scoped by the persistence query.
  // Never reinterpret an explicitly incompatible pilot record as legacy data.
  const p=run.pilotEvidence??{...this.emptyPilot(account,run.startedAt),lastSettledAt:run.lastSettledAt,settled:run.settled,fills:run.fills,missing:run.missing,netProfit:run.netProfit,totalStaked:run.totalStaked,probabilitySquaredError:run.probabilitySquaredError,baselineSquaredError:run.baselineSquaredError,quoteBreakevenSum:run.quoteBreakevenSum};
  if(p.accountId!==account||p.engineVersion!=='core-v1'||p.contractPolicy!==CORE_CONTRACT_POLICY||
   !Number.isFinite(p.startedAt)||p.startedAt<=0||p.startedAt>this.now()||this.now()-p.startedAt>7*86400000||
   !Number.isFinite(p.lastSettledAt)||p.lastSettledAt<0||p.lastSettledAt>this.now()||!Number.isFinite(p.netProfit))return null;
  for(const key of ['settled','fills','missing','runCount'] as const)if(!Number.isSafeInteger(p[key])||p[key]<0)return null;
  for(const key of ['totalStaked','probabilitySquaredError','baselineSquaredError','quoteBreakevenSum'] as const)if(!Number.isFinite(p[key])||p[key]<0)return null;
  if(p.fills<p.settled+p.missing)return null;
  return p;
 }
 private ensurePilot(account:string,run:ResearchRun,anchor=this.now()):PilotEvidence{
  const existing=this.pilotFor(account,run);
  if(existing){run.pilotEvidence=existing;return existing;}
  const startedAt=Number.isFinite(anchor)&&anchor<=this.now()&&this.now()-anchor<=30_000?anchor:this.now();
  run.pilotEvidence=this.emptyPilot(account,startedAt);
  return run.pilotEvidence;
 }
 private readiness(run:ResearchRun,account:string):ResearchReadiness{
  const pilot=this.pilotFor(account,run);
  const settled=pilot?.settled??0,fills=pilot?.fills??0,missing=pilot?.missing??0;
  const modelBrier=pilot&&settled?pilot.probabilitySquaredError/settled:null;
  const baselineBrier=pilot&&settled?pilot.baselineSquaredError/settled:null;
  let reason='Ready for a controlled Auto trial.';
  if(run.engineVersion!=='core-v1')reason='Collect results for the current Core.';
  else if(run.contractPolicy!==CORE_CONTRACT_POLICY)reason='Collect results for the current contract pool.';
  else if(!pilot)reason='Collect fresh paper results.';
  else if(settled<200)reason='Collect '+(200-settled)+' more paper results.';
  else if(missing/Math.max(1,fills)>.05)reason='Too many prices are missing.';
  else if(!pilot.lastSettledAt)reason='Collect fresh paper results.';
  else if(!(pilot.netProfit>0))reason='Paper results need to finish ahead.';
  else if(modelBrier===null||baselineBrier===null||!Number.isFinite(modelBrier)||!Number.isFinite(baselineBrier)||modelBrier>baselineBrier+1e-12)reason='Core has not matched the baseline yet.';
  return {ready:reason==='Ready for a controlled Auto trial.',reason,settled,target:200,missing,fills,modelBrier,baselineBrier,pilotOnly:true,netProfit:pilot?.netProfit??0,runCount:pilot?.runCount??0,startedAt:pilot?.startedAt??null,lastSettledAt:pilot?.lastSettledAt||null};
 }
 /** Explicitly enable Auto from a saved forward paper run. This never buys. */
 async activate(account:string){
  const slot=this.slots.get(account);
  if(!slot||slot.persistenceFailed||!this.readiness(slot.run,account).ready)throw Error(slot?this.readiness(slot.run,account).reason:'Collect paper results first.');
  const run=slot.run,pilot=this.pilotFor(account,run)!;
  run.activationEvidence={engineVersion:'core-v1',contractPolicy:CORE_CONTRACT_POLICY,startedAt:pilot.startedAt,activatedAt:this.now(),lastSettledAt:pilot.lastSettledAt,settled:pilot.settled,fills:pilot.fills,missing:pilot.missing,netProfit:pilot.netProfit,modelBrier:pilot.probabilitySquaredError/pilot.settled,baselineBrier:pilot.baselineSquaredError/pilot.settled};
  if(!this.validActivation(run.activationEvidence))throw Error('Research evidence is incomplete.');
  run.autoEnabled=true;this.persist(account,slot);await slot.writes;
  if(slot.persistenceFailed)throw Error('Saving unavailable. Auto was not enabled.');
  return this.snapshot(account);
 }
 private affordable(slot:Slot,stake:number):boolean {
  const run=slot.run;
  if(stake>run.balance*.3+1e-9){run.running=false;run.phase='Virtual stake limit reached';return false;}
  if(run.maxLoss>0&&run.netProfit-stake < -run.maxLoss-1e-9){run.running=false;run.phase='Remaining loss budget is smaller than the stake';return false;}
  return true;
 }
 private async tick(account:string,slot:Slot){
  if(slot.busy||(!slot.run.running&&!slot.pending))return;
  slot.busy=true;const serial=slot.serial;
  try{
   const markets=this.markets();
   if(slot.pending){
    const pending=slot.pending,market=markets.find(m=>m.symbol===pending.market),ticks=market?.recentTicks??[];
    const anchor=ticks.findIndex(t=>t.sequence===pending.entrySequence&&String(t.segment??'')===pending.segment);
    const next=anchor>=0?ticks[anchor+1]:null;
    if(next){
     if(next.sequence!==pending.entrySequence+1||String(next.segment??'')!==pending.segment||!Number.isInteger(next.digit)||next.digit<0||next.digit>9){this.missing(account,slot,pending);return;}
     const won=pending.direction==='over'?next.digit>pending.barrier:next.digit<pending.barrier;
     pending.exitDigit=next.digit;pending.status=won?'won':'lost';pending.profit=won?pending.quotedPayout-pending.stake:-pending.stake;pending.settledAt=next.epoch*1000;
     slot.pending=null;slot.run.settled++;if(won)slot.run.wins++;else slot.run.losses++;
     slot.run.baselineExpectedWins+=pending.baselineProbability;slot.run.predictedExpectedWins+=pending.probability;
     const outcome=won?1:0;
     slot.run.probabilitySquaredError+=(pending.probability-outcome)**2;
     slot.run.baselineSquaredError+=(pending.baselineProbability-outcome)**2;
     slot.run.totalStaked+=pending.stake;slot.run.quoteBreakevenSum+=pending.stake/pending.quotedPayout;slot.run.lastSettledAt=this.now();
     const pilot=this.ensurePilot(account,slot.run,pending.openedAt);
     if(pending.pilotWindowStartedAt!==pilot.startedAt)pilot.fills++;
     pilot.settled++;pilot.lastSettledAt=this.now();pilot.netProfit+=pending.profit;pilot.totalStaked+=pending.stake;
     pilot.probabilitySquaredError+=(pending.probability-outcome)**2;pilot.baselineSquaredError+=(pending.baselineProbability-outcome)**2;
     pilot.quoteBreakevenSum+=pending.stake/pending.quotedPayout;
     slot.run.netProfit+=pending.profit;slot.run.balance=slot.run.startingBalance+slot.run.netProfit;
     slot.run.peakBalance=Math.max(slot.run.peakBalance,slot.run.balance);slot.run.maxDrawdown=Math.max(slot.run.maxDrawdown,slot.run.peakBalance-slot.run.balance);
     if(slot.run.takeProfit>0&&slot.run.netProfit>=slot.run.takeProfit){slot.run.running=false;slot.run.phase='Target reached';}
     else if(slot.run.maxLoss>0&&slot.run.netProfit<=-slot.run.maxLoss){slot.run.running=false;slot.run.phase='Loss limit reached';}
     else slot.run.phase=slot.run.running?'Looking for a cow':'Paused';
     this.persist(account,slot,pending);return;
    }
    if(!market||market.fresh===false||anchor<0||this.now()-pending.openedAt>30_000||this.now()-(ticks[ticks.length-1]?.epoch??0)*1000>15_000)this.missing(account,slot,pending);
    return;
   }
   if(!await slot.authorized()){
    slot.run.running=false;slot.run.phase='Reconnect to continue research';this.persist(account,slot);return;
   }
   if(!slot.run.running||serial!==slot.serial||this.closed)return;
   if(!this.affordable(slot,slot.run.stake)){this.persist(account,slot);return;}
   const candidates=rankCoreCandidates(markets,slot.lessons(),this.now()).filter(isCorePastureCandidate);
   const chosen=candidates[0];if(!chosen){slot.run.phase='Waiting for fresh prices';return;}
   const key=chosen.decisionId;if(key===slot.lastCutoff)return;slot.lastCutoff=key;
   slot.run.phase='Checking a live quote';
   const offered=await slot.quote(chosen,slot.run.stake);
   if(serial!==slot.serial||!slot.run.running||this.closed)return;
   if(!Number.isFinite(offered.askPrice)||offered.askPrice<=0||offered.askPrice>slot.run.stake+1e-9)throw Error('Invalid paper quote');
   if(!this.affordable(slot,offered.askPrice)){this.persist(account,slot);return;}
   // Entry is the latest observed tick AFTER the quote resolves. Only the next
   // consecutive tick can settle it; ticks observed during quoting are not wins.
   const market=this.markets().find(m=>m.symbol===chosen.market),ticks=market?.recentTicks??[],entry=ticks[ticks.length-1];
   if(market?.fresh===false||!entry||!Number.isInteger(entry.sequence))return;
   const refreshed=rankCoreCandidates([market!],slot.lessons(),this.now()).find(c=>c.direction===chosen.direction&&c.barrier===chosen.barrier);
   if(!refreshed)return;
   const final=evaluateCoreQuote(refreshed,offered.askPrice,offered.payout,this.now());
   const pilot=this.ensurePilot(account,slot.run);
   const result:Result={id:randomUUID(),runId:slot.run.id,market:chosen.market,direction:chosen.direction,barrier:chosen.barrier,status:'open',stake:offered.askPrice,profit:null,entryDigit:entry.digit,exitDigit:null,quotedPayout:offered.payout,settledAt:null,decisionId:[account,final.decisionId,final.probability].join(':'),engineVersion:'core-v1',contractPolicy:CORE_CONTRACT_POLICY,entrySequence:entry.sequence!,openedAt:this.now(),pilotWindowStartedAt:pilot.startedAt,segment:String(entry.segment??''),probability:final.estWin,baselineProbability:final.baseWin};
   slot.pending=result;slot.run.fills++;pilot.fills++;slot.recent.unshift(result);slot.recent=slot.recent.slice(0,20);slot.run.phase='Virtual trade open';
   this.persist(account,slot,result,final);
  }catch{if(!slot.persistenceFailed&&serial===slot.serial)slot.run.phase='Quote unavailable · waiting';}
  finally{slot.busy=false;}
 }
 private missing(account:string,slot:Slot,result:Result){
  result.status='missing';slot.pending=null;slot.run.missing++;
  const pilot=this.ensurePilot(account,slot.run,result.openedAt);if(result.pilotWindowStartedAt!==pilot.startedAt)pilot.fills++;pilot.missing++;
  slot.run.phase=slot.persistenceFailed?'Saving unavailable · research paused':slot.run.running?'Price gap · waiting':'Paused';this.persist(account,slot,result);
 }
}
