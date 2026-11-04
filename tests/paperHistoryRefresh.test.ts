import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('overlapping paper-history refreshes share one request and retain data on failure', async () => {
  const source = readFileSync(new URL('../web/src/store.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const paperTradeRefreshes =');
  const end = source.indexOf('/** Detailed virtual-paper evidence', start);
  assert.ok(start >= 0 && end > start);
  const javascript = ts.transpile(source.slice(start, end).replace('export async function', 'async function'), { target: ts.ScriptTarget.ES2022 });
  let calls = 0;
  let resolveRequest: (value: unknown) => void = () => {};
  let rejectRequest: (reason: Error) => void = () => {};
  const snapshots: unknown[] = [];
  const load = runInNewContext(`${javascript}\nloadPaperTrades`, {
    api: () => { calls += 1; return new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; }); },
    set: (patch: unknown) => snapshots.push(patch),
    paperTradeFromApi: (trade: unknown) => trade,
  }) as (limit: number) => Promise<void>;

  const first = load(300);
  const second = load(300);
  assert.equal(calls, 1);
  resolveRequest({ trades: [{ id: 1 }], portfolio: null });
  await Promise.all([first, second]);
  assert.equal(snapshots.length, 1);
  const next = load(300);
  assert.equal(calls, 2, 'a later refresh can fetch new evidence');
  rejectRequest(new Error('offline'));
  await next;
  assert.equal(snapshots.length, 1, 'a failed refresh preserves the last snapshot');
});
