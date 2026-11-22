import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreEvidenceStore } from '../src/core/coreEvidenceStore.ts';

type Query = { sql:string; values:unknown[] };
const sourceId='11111111-2222-4333-8444-555555555555';
const insightId='66666666-7777-4888-8999-aaaaaaaaaaaa';

test('legacy import emits single escaped brackets and canonical final UUID markers for PostgreSQL',async()=>{
  const queries:Query[]=[];
  const db={query:async(sql:string,values:unknown[])=>{queries.push({sql,values});return{rows:[]};}};
  const store=new CoreEvidenceStore(db as unknown as ConstructorParameters<typeof CoreEvidenceStore>[0]);
  assert.equal(await store.importLegacyLessons('account-a','owner-a'),0);
  const sql=queries[0].sql;
  const reference=sql.match(/substring\(i\.observation from '([^']+)'\)/)?.[1];
  const pattern=sql.match(/i\.observation ~ '([^']+)'/)?.[1];
  assert.ok(reference);assert.ok(pattern);
  const expected='\\[Trade reference: ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\]\\n\\[Brain stance: (good|warning)\\]$';
  assert.equal(reference,expected);
  assert.equal(pattern,'\\[Brain pattern: (high|low):[23]\\]');
  assert.deepEqual([...reference].slice(0,2).map(c=>c.charCodeAt(0)),[92,91]);
  const note='After three high digits\n[Brain pattern: high:3]\n[Trade reference: '+sourceId+']\n[Brain stance: good]';
  assert.equal(new RegExp(reference).exec(note)?.[1],sourceId);
  assert.equal(new RegExp(reference).exec('[Trade reference: ------------------------------------]\n'+note)?.[1],sourceId);
  assert.equal(new RegExp(reference).test('[Trade reference: ------------------------------------]\n[Brain stance: good]'),false);
  assert.equal(new RegExp(pattern).test(note),true);
  assert.equal(new RegExp(pattern).test(note.replace('high:3','high:4')),false);
  assert.equal(new RegExp(pattern).test('An ordinary unconfirmed note'),false);
  assert.match(sql,/i\.created_at < \(select created_at from core_private\.engine_versions/);
  assert.deepEqual(queries[0].values,['account-a','owner-a']);
});

test('legacy import preserves original source, timestamp and account binding',async()=>{
  const queries:Query[]=[];
  const createdAt=new Date('2026-11-20T12:00:00.000Z');
  const observation='After three high digits\n[Brain pattern: high:3]\n[Trade reference: '+sourceId+']\n[Brain stance: warning]';
  const db={query:async(sql:string,values:unknown[])=>{
    queries.push({sql,values});
    if(sql.includes('select i.*,c.mode'))return{rows:[{id:insightId,mode:'demo',market_symbol:'R_100',expected_direction:'over',barrier:2,observation,confidence:4,created_at:createdAt}]};
    if(sql.includes('insert into core_private.lesson_rules'))return{rows:[{id:'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',version:1,account_id:values[0],source_trade_id:values[1],
      legacy_insight_id:values[2],market_symbol:'R_100',expected_direction:'over',barrier:2,mode:'demo',stance:values[3],conditions:JSON.parse(String(values[4])),
      note:values[5],confidence:values[6],created_at:createdAt}]};
    throw Error('Unexpected query');
  }};
  const store=new CoreEvidenceStore(db as unknown as ConstructorParameters<typeof CoreEvidenceStore>[0]);
  assert.equal(await store.importLegacyLessons('account-a','owner-a'),1);
  const insert=queries.find(q=>q.sql.includes('insert into core_private.lesson_rules'))!;
  assert.equal(insert.values[0],'account-a');assert.equal(insert.values[1],sourceId);assert.equal(insert.values[2],insightId);assert.equal(insert.values[3],'warning');
  assert.deepEqual(JSON.parse(String(insert.values[4])),{digitSequence:{side:'high',count:3}});
  assert.equal(insert.values[5],'After three high digits');assert.equal(insert.values[7],createdAt.getTime());
  assert.match(insert.sql,/c\.account_id=\$1 and c\.id=\$2/);
});

