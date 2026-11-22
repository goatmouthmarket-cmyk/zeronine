import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CoreLessonEvidence } from './predictionEngine.ts';
import { evaluateLessonRule, normalizeLessonConditions, type CoreLessonRule, type EvidenceTrade, type LessonConditions } from './lessonRules.ts';

type Queryable = Pick<Pool, 'query'>;
type Row = Record<string, unknown>;
type Group = { trades: number; wins: number; profit: number; stake: number };
export type CoreLessonSummary = CoreLessonRule & {
  matched: Group; comparable: Group; skipped: number; firstEvaluatedAt: number | null; lastEvaluatedAt: number | null;
  status: 'needs_examples' | 'helping' | 'not_helping_yet';
  engineEvidence: CoreLessonEvidence | null;
};
export type SaveCoreLesson = {
  sourceTradeId: string; marketSymbol: string; expectedDirection: 'over' | 'under'; barrier: number;
  mode?: 'demo' | 'real'; stance: 'good' | 'warning'; conditions: LessonConditions; note: string;
  confidence: number; legacyInsightId?: string; createdAt?: number;
};
export type CoreExecutionAttempt = {
  id?: string; decisionId: string | null; contractId?: string | null; providerContractId?: string | null;
  source: 'manual' | 'auto' | 'brain'; status: string; ask?: number | null; payout?: number | null; reason?: string | null;
};
const at = (value: unknown): number => value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(String(value));
const numberOrNull = (value: unknown): number | null => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const ruleFromRow = (row: Row): CoreLessonRule => ({
  id: String(row.id), version: Number(row.version), accountId: String(row.account_id), sourceTradeId: String(row.source_trade_id),
  marketSymbol: String(row.market_symbol), expectedDirection: row.expected_direction as 'over' | 'under', barrier: Number(row.barrier),
  mode: row.mode as 'demo' | 'real', stance: row.stance as 'good' | 'warning',
  conditions: row.conditions as LessonConditions, note: String(row.note || ''), confidence: Number(row.confidence),
  createdAt: at(row.created_at), legacyInsightId: row.legacy_insight_id == null ? null : String(row.legacy_insight_id),
});

/** All methods are account scoped. Invoke evidence writes after execution or
 * from a background runner; evidence availability must never decide risk. */
export class CoreEvidenceStore {
  private readonly db: Queryable;
  private readonly running = new Set<string>();
  constructor(db: Queryable) { this.db = db; }

  async health(): Promise<boolean> {
    const result = await this.db.query(`select bool_and(to_regclass(name) is not null) as ready
      from unnest(array['core_private.engine_versions','core_private.decision_snapshots','core_private.execution_attempts',
        'core_private.lesson_rules','core_private.lesson_evaluations','core_private.research_runs','core_private.research_results','core_private.evidence_jobs']) as required(name)`);
    return result.rows[0]?.ready === true;
  }

  async saveDecision(accountId: string, snapshot: { id: string; engineVersion: string; [key: string]: unknown }): Promise<void> {
    await this.db.query(
      'insert into core_private.decision_snapshots(id,account_id,engine_version,snapshot) values($1,$2,$3,$4::jsonb) on conflict(id) do nothing',
      [snapshot.id, accountId, snapshot.engineVersion, JSON.stringify(snapshot)],
    );
  }

  async recordAttempt(accountId: string, attempt: CoreExecutionAttempt): Promise<void> {
    // Only link snapshots and contracts owned by the current account.
    await this.db.query(
      `insert into core_private.execution_attempts(id,account_id,decision_id,contract_id,provider_contract_id,source,status,ask,payout,reason)
       values($1,$2,(select id from core_private.decision_snapshots where id=$3 and account_id=$2),
       (select id from multiplayer_private.contracts where id=$4 and account_id=$2),$5,$6,$7,$8,$9,$10)
       on conflict(id) do nothing`,
      [attempt.id || randomUUID(), accountId, attempt.decisionId, attempt.contractId || null, attempt.providerContractId || null,
        attempt.source, attempt.status, attempt.ask ?? null, attempt.payout ?? null, attempt.reason?.slice(0,500) || null],
    );
  }

  async saveLesson(accountId: string, input: SaveCoreLesson): Promise<CoreLessonRule> {
    const conditions = normalizeLessonConditions(input.conditions);
    if (!Number.isInteger(input.confidence) || input.confidence < 1 || input.confidence > 5 || !['good','warning'].includes(input.stance)) throw new Error('Choose your call and confidence.');
    // Derive contract identity and mode from the account-owned source trade,
    // never trust the browser's market or account-mode assertions.
    const result = await this.db.query(
      `insert into core_private.lesson_rules(account_id,source_trade_id,legacy_insight_id,market_symbol,expected_direction,barrier,mode,stance,conditions,note,confidence,created_at)
       select c.account_id,c.id,$3,c.market,c.direction,c.barrier,c.mode,$4,$5::jsonb,$6,$7,coalesce(to_timestamp($8::double precision/1000),now())
       from multiplayer_private.contracts c where c.account_id=$1 and c.id=$2
         and c.status in ('won','lost') and c.settled_at is not null and c.mode in ('demo','real')
         and c.direction in ('over','under') and c.barrier between 0 and 9
       on conflict(account_id,source_trade_id) do nothing returning *`,
      [accountId,input.sourceTradeId,input.legacyInsightId || null,input.stance,JSON.stringify(conditions),input.note.slice(0,500),input.confidence,input.createdAt ?? null],
    );
    if (result.rows[0]) return ruleFromRow(result.rows[0]);
    const existing = await this.db.query('select * from core_private.lesson_rules where account_id=$1 and source_trade_id=$2',[accountId,input.sourceTradeId]);
    if (existing.rows[0]) return ruleFromRow(existing.rows[0]);
    throw new Error('That settled trade is not available for this account.');
  }

  /** Import only user-confirmed supported rules. Ordinary notes stay notes. */
  async importLegacyLessons(accountId: string, ownerKey: string): Promise<number> {
    const rows = await this.db.query(
      `select i.*,c.mode from brain_private.insights i
       join multiplayer_private.contracts c on c.id=substring(i.observation from '\\[Trade reference: ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\]\\n\\[Brain stance: (good|warning)\\]$')::uuid and c.account_id=$1
       where i.owner_key=$2 and i.created_at < (select created_at from core_private.engine_versions where id='core-v1')
       and i.observation ~ '\\[Brain pattern: (high|low):[23]\\]'
       and not exists(select 1 from core_private.lesson_rules r where r.legacy_insight_id=i.id or (r.account_id=$1 and r.source_trade_id=c.id))`,
      [accountId,ownerKey],
    );
    let imported = 0;
    for (const row of rows.rows as Row[]) {
      const observation=String(row.observation), pattern=/\[Brain pattern: (high|low):([23])\]\n\[Trade reference: [0-9a-f-]{36}\]\n\[Brain stance: (good|warning)\]$/i.exec(observation);
      const source=/\[Trade reference: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\n\[Brain stance: (good|warning)\]$/i.exec(observation), stance=/\[Brain stance: (good|warning)\]$/.exec(observation);
      if (!pattern || !source || !stance) continue;
      await this.saveLesson(accountId,{
        sourceTradeId:source[1],marketSymbol:String(row.market_symbol),expectedDirection:row.expected_direction as 'over'|'under',
        barrier:Number(row.barrier),mode:row.mode as 'demo'|'real',stance:stance[1] as 'good'|'warning',
        conditions:{digitSequence:{side:pattern[1] as 'high'|'low',count:Number(pattern[2]) as 2|3}},
        note:observation.replace(/\n\[(?:Brain pattern|Trade reference|Brain stance):[^\]]+\]/g,''),confidence:Number(row.confidence),
        legacyInsightId:String(row.id),createdAt:at(row.created_at),
      }); imported++;
    }
    return imported;
  }

  async requestEvaluation(accountId: string): Promise<void> {
    await this.db.query(`insert into core_private.evidence_jobs(account_id) values($1)
      on conflict(account_id) do update set requested_at=now(),available_at=now()`,[accountId]);
  }

  /** Recover delayed evidence writes from the account-owned trade snapshot.
   * These rows are recorded facts, never reconstructed model predictions. */
  async backfillExecutionEvidence(accountId:string):Promise<number>{
    const rows=await this.db.query(
      `select c.id,c.provider_contract_id,c.status,c.ask_price,c.payout,x.context
       from multiplayer_private.contracts c join multiplayer_private.trade_context x on x.contract_id=c.id and x.account_id=c.account_id
       where c.account_id=$1 and jsonb_typeof(x.context->'coreDecision')='object'
         and not exists(select 1 from core_private.execution_attempts a where a.account_id=c.account_id and a.contract_id=c.id)
       order by c.created_at,c.id limit 200`,[accountId]);
    let recovered=0;
    for(const row of rows.rows as Row[]){
      const context=row.context as Row,decision=context.coreDecision as Row;
      if(typeof decision.decisionId!=='string'||!decision.decisionId||decision.engineVersion!=='core-v1'||
        typeof decision.probability!=='number'||!Number.isFinite(decision.probability))continue;
      const decisionId=accountId+':'+decision.decisionId+':'+decision.probability;
      await this.saveDecision(accountId,{...decision,id:decisionId,engineVersion:'core-v1'});
      const source=context.source==='auto'||context.source==='brain'?context.source:'manual';
      await this.recordAttempt(accountId,{id:String(row.id),decisionId,contractId:String(row.id),
        providerContractId:row.provider_contract_id==null?null:String(row.provider_contract_id),source,status:String(row.status),
        ask:numberOrNull(row.ask_price),payout:numberOrNull(row.payout),reason:'Recovered from saved trade context'});
      recovered++;
    }
    return recovered;
  }

  /** Persistent evaluations do not disappear when old trades leave UI windows.
   * Skips are retried when asynchronous context capture later fills the record. */
  async evaluateLessons(accountId: string): Promise<{ evaluated: number; skipped: number }> {
    if (this.running.has(accountId)) return {evaluated:0,skipped:0};
    this.running.add(accountId);
    let evaluated=0,skipped=0,backlog=false;
    const startedAt=new Date();
    try {
      backlog=(await this.backfillExecutionEvidence(accountId))>=200;
      const rules = await this.db.query('select * from core_private.lesson_rules where account_id=$1 order by created_at,id',[accountId]);
      for (const row of rules.rows as Row[]) {
        const rule=ruleFromRow(row);
        const pending = await this.db.query(
          `select c.*,x.context from multiplayer_private.contracts c
           left join multiplayer_private.trade_context x on x.contract_id=c.id and x.account_id=c.account_id
           left join core_private.lesson_evaluations e on e.trade_id=c.id and e.rule_id=$2 and e.rule_version=$3
           where c.account_id=$1 and c.mode=$4 and c.market=$5 and c.direction=$6 and c.barrier=$7
             and c.created_at > to_timestamp($8::double precision/1000) and c.status in ('won','lost') and c.settled_at is not null
             and (e.trade_id is null or (e.classification='skipped' and x.updated_at > e.evaluated_at))
           order by c.created_at,c.id limit 500`,
          [accountId,rule.id,rule.version,rule.mode,rule.marketSymbol,rule.expectedDirection,rule.barrier,rule.createdAt],
        );
        if(pending.rows.length===500)backlog=true;
        for (const record of pending.rows as Row[]) {
          const trade:EvidenceTrade={id:String(record.id),accountId,market:String(record.market),direction:String(record.direction),
            barrier:Number(record.barrier),mode:String(record.mode),status:String(record.status),createdAt:at(record.created_at),
            settledAt:record.settled_at==null?null:at(record.settled_at),stake:numberOrNull(record.stake),profit:numberOrNull(record.profit),
            context:record.context && typeof record.context==='object'?record.context as Row:null};
          const result=evaluateLessonRule(rule,trade);
          await this.db.query(
            `insert into core_private.lesson_evaluations(rule_id,rule_version,trade_id,account_id,classification,reason,matched_conditions,won,profit,stake,trade_created_at)
             values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,to_timestamp($11::double precision/1000))
             on conflict(rule_id,rule_version,trade_id) do update set
               classification=excluded.classification,reason=excluded.reason,matched_conditions=excluded.matched_conditions,
               won=excluded.won,profit=excluded.profit,stake=excluded.stake,evaluated_at=now()
             where core_private.lesson_evaluations.classification='skipped'`,
            [rule.id,rule.version,trade.id,accountId,result.classification,result.reason,JSON.stringify(result.conditions),trade.status==='won',trade.profit,trade.stake,trade.createdAt],
          );
          if(result.classification==='skipped')skipped++;else evaluated++;
        }
      }
      if(backlog) await this.requestEvaluation(accountId);
      else await this.db.query('delete from core_private.evidence_jobs where account_id=$1 and requested_at <= $2',[accountId,startedAt]);
      return {evaluated,skipped};
    } finally { this.running.delete(accountId); }
  }

  /** A low-frequency background runner can resume work after a process restart. */
  async drainEvidenceJobs(limit=4): Promise<void> {
    const jobs=await this.db.query('select account_id from core_private.evidence_jobs where available_at<=now() order by requested_at limit $1',[Math.max(1,Math.min(10,limit))]);
    for(const job of jobs.rows){
      const accountId=String(job.account_id);
      try { await this.evaluateLessons(accountId); }
      catch(error) { await this.db.query(`update core_private.evidence_jobs set attempts=attempts+1,available_at=now()+interval '30 seconds',last_error=$2 where account_id=$1`,[accountId,error instanceof Error?error.message.slice(0,300):'Evidence check unavailable']); }
    }
  }

  async lessonSummaries(accountId: string): Promise<CoreLessonSummary[]> {
    const result=await this.db.query(
      `select r.*,
        count(*) filter(where e.classification='matched')::int as matched_trades,
        count(*) filter(where e.classification='matched' and e.won)::int as matched_wins,
        coalesce(sum(e.profit) filter(where e.classification='matched'),0)::float8 as matched_profit,
        coalesce(sum(e.stake) filter(where e.classification='matched'),0)::float8 as matched_stake,
        count(*) filter(where e.classification='comparison')::int as comparison_trades,
        count(*) filter(where e.classification='comparison' and e.won)::int as comparison_wins,
        coalesce(sum(e.profit) filter(where e.classification='comparison'),0)::float8 as comparison_profit,
        coalesce(sum(e.stake) filter(where e.classification='comparison'),0)::float8 as comparison_stake,
        count(*) filter(where e.classification='skipped')::int as skipped,
        extract(epoch from min(e.evaluated_at) filter(where e.classification<>'skipped'))*1000 as first_evaluated,
        extract(epoch from max(e.evaluated_at) filter(where e.classification<>'skipped'))*1000 as last_evaluated
       from core_private.lesson_rules r left join core_private.lesson_evaluations e on e.rule_id=r.id and e.rule_version=r.version and e.account_id=r.account_id
       where r.account_id=$1 group by r.id order by r.created_at desc`,[accountId]);
    return (result.rows as Row[]).map(row=>{
      const rule=ruleFromRow(row);
      const matched:Group={trades:Number(row.matched_trades),wins:Number(row.matched_wins),profit:Number(row.matched_profit),stake:Number(row.matched_stake)};
      const comparable:Group={trades:Number(row.comparison_trades),wins:Number(row.comparison_wins),profit:Number(row.comparison_profit),stake:Number(row.comparison_stake)};
      const skipped=Number(row.skipped),first=numberOrNull(row.first_evaluated),last=numberOrNull(row.last_evaluated);
      const enough=matched.trades>=30&&comparable.trades>=30;
      const delta=(matched.stake?matched.profit/matched.stake:0)-(comparable.stake?comparable.profit/comparable.stake:0);
      const p=(matched.wins+1)/(matched.trades+2),q=(comparable.wins+1)/(comparable.trades+2);
      const se=Math.sqrt(p*(1-p)/(matched.trades+2)+q*(1-q)/(comparable.trades+2));
      const helping=enough&&(rule.stance==='good'
        ? matched.profit>0&&delta>0&&p-q>2*se
        : delta<0&&p-q < -2*se);
      // Complex conditions are evaluated without turning them into misleading
      // digit-only engine evidence. The current adapter supports digit rules.
      let confirmedConditions:LessonConditions|null=null;
      try { confirmedConditions=normalizeLessonConditions(rule.conditions); } catch { /* Invalid historical rules cannot match or change a prediction. */ }
      const supported=!!confirmedConditions?.digitSequence&&!confirmedConditions.edge&&!confirmedConditions.confidence;
      const engineEvidence:CoreLessonEvidence|null=confirmedConditions ? {
        id:rule.id,marketSymbol:rule.marketSymbol,expectedDirection:rule.expectedDirection,barrier:rule.barrier,createdAt:rule.createdAt,
        confirmedConditions,
        confirmedPattern:confirmedConditions.digitSequence??null,
        patternEvidence:supported&&first!=null&&last!=null
          ? {supported:true,forwardOnly:true,complete:true,firstEvaluatedAt:first,lastEvaluatedAt:last,matched,comparable}
          : null,
      }:null;
      return {...rule,matched,comparable,skipped,firstEvaluatedAt:first,lastEvaluatedAt:last,
        status:!enough?'needs_examples':helping?'helping':'not_helping_yet',engineEvidence};
    });
  }

  async readResearchRun(accountId:string):Promise<Record<string,unknown>|null>{
    const result=await this.db.query('select state from core_private.research_runs where account_id=$1 order by updated_at desc limit 1',[accountId]);
    const saved=result.rows[0]?.state;
    return saved&&typeof saved==='object'?{...saved,running:false,phase:'paused',restored:true}:null;
  }
  async readResearchResults(accountId:string,runId:string,limit=20):Promise<Array<Record<string,unknown>>>{
    const result=await this.db.query('select result from core_private.research_results where account_id=$1 and run_id=$2 order by created_at desc,id desc limit $3',[accountId,runId,Math.max(1,Math.min(100,limit))]);
    return result.rows.map(row=>row.result as Record<string,unknown>);
  }
  async saveResearchRun(accountId: string, run: {id:string;[key:string]:unknown}):Promise<void>{
    await this.db.query(`insert into core_private.research_runs(id,account_id,engine_version,state) values($1,$2,'core-v1',$3::jsonb)
      on conflict(id) do update set state=excluded.state,updated_at=now() where core_private.research_runs.account_id=excluded.account_id`,[run.id,accountId,JSON.stringify(run)]);
  }
  async saveResearchResult(accountId:string,result:{id:string;runId:string;[key:string]:unknown}):Promise<void>{
    await this.db.query(`insert into core_private.research_results(id,run_id,account_id,result)
      select $1,r.id,r.account_id,$4::jsonb from core_private.research_runs r where r.id=$2 and r.account_id=$3
      on conflict(id) do update set result=excluded.result
      where core_private.research_results.account_id=excluded.account_id
        and core_private.research_results.run_id=excluded.run_id
        and core_private.research_results.result->>'status'='open'
        and excluded.result->>'status' in ('won','lost','missing')`,[result.id,result.runId,accountId,JSON.stringify(result)]);
  }
}

