import { rankCoreCandidates, findCoreDecision, isCorePastureCandidate, type CoreLessonEvidence, type CoreDirection } from './predictionEngine.ts';
import { CoreResearch } from './coreResearch.ts';
import type { MarketRegistry } from './marketState.ts';
import type { CoreEvidenceStore } from './coreEvidenceStore.ts';

/** Account lessons are refreshed off the quote/buy path. */
export class CoreRuntime {
 readonly research: CoreResearch;
 private registry:MarketRegistry;
 private evidence:CoreEvidenceStore;
 private accounts=new Map<string,{lessons:CoreLessonEvidence[];at:number;busy:boolean}>();
 private timer:ReturnType<typeof setInterval>;
 constructor(registry:MarketRegistry,evidence:CoreEvidenceStore){
  this.registry=registry;this.evidence=evidence;
  this.research=new CoreResearch(()=>registry.coreMarkets(),evidence);
  this.timer=setInterval(()=>{void evidence.drainEvidenceJobs(4).catch(()=>{});for(const [id,value] of this.accounts)if(Date.now()-value.at>15000)void this.refresh(id);},5000);this.timer.unref();
 }
 close(){clearInterval(this.timer);this.research.close();}
 lessons(accountId:string){return this.accounts.get(accountId)?.lessons??[];}
 async refresh(accountId:string){
  let item=this.accounts.get(accountId);
  if(item?.busy||(item&&Date.now()-item.at<15000))return;
  if(!item){if(this.accounts.size>=500)this.accounts.delete(this.accounts.keys().next().value!);item={lessons:[],at:0,busy:false};this.accounts.set(accountId,item);}
  item.busy=true;
  try{const summaries=await this.evidence.lessonSummaries(accountId);item.lessons=summaries.flatMap(row=>row.engineEvidence?[row.engineEvidence]:[]);item.at=Date.now();}
  catch{item.lessons=[];item.at=Date.now();}
  finally{item.busy=false;}
 }
 candidates(accountId?:string){
  const result=rankCoreCandidates(this.registry.coreMarkets(),accountId?this.lessons(accountId):[]);
  const best=new Map<string,typeof result[number]>();
  for(const candidate of result)if(isCorePastureCandidate(candidate)&&!best.has(candidate.market))best.set(candidate.market,candidate);
  return [...best.values()];
 }
 decision(accountId:string,market:string,direction:CoreDirection,barrier:number){
  const input=this.registry.coreMarkets().find(item=>item.symbol===market);
  return input?findCoreDecision(input,direction,barrier,this.lessons(accountId)):null;
 }
}

