import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TelemetryService, telemetryFromHub } from '../src/telemetry/service.ts';

test('telemetry allowlists research fields and excludes credentials and account identifiers', () => {
  const rows = telemetryFromHub({ type: 'trade', ts: 100, trade: { id: 7, market: 'R_50', status: 'won', profit: 1, loginid: 'private-account', token: 'secret-token' } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.market, 'R_50');
  assert.equal(rows[0]?.data.tradeId, 7);
  assert.doesNotMatch(JSON.stringify(rows), /private-account|secret-token/);
  assert.deepEqual(telemetryFromHub({ type: 'session', ts: 100, session: { token: 'secret-token' } }), []);
});

test('background writer persists and pages separate virtual and account events', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pasture-telemetry-'));
  const service = new TelemetryService(path.join(dir, 'telemetry.db'), 30);
  try {
    service.record({ type: 'tick', ts: Date.now(), symbol: 'R_50', epoch: 123, quote: 100.5, digit: 5, fresh: true });
    service.record({ type: 'paper_simulation', ts: Date.now(), event: 'settled', contract: { id: 1, runId: 'run-1', market: 'R_50', status: 'won', direction: 'over', barrier: 2, entryDigit: 1, exitDigit: 5 } });
    service.record({ type: 'trade', ts: Date.now(), settled: true, trade: { id: 22, market: 'R_50', status: 'lost', profit: -1 } });
    const deadline = Date.now() + 5000;
    while (service.status().written < 3 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(service.status().state, 'running');
    assert.equal(service.status().written, 3);
    const first = await service.query(0, 2) as Array<{ id: number; event_type: string; source: string }>;
    const next = await service.query(first[1]!.id, 2) as Array<{ id: number; event_type: string; source: string }>;
    assert.deepEqual(first.map((row) => row.event_type), ['tick', 'paper_settled']);
    assert.equal(first[1]!.source, 'virtual_scout');
    assert.equal(next[0]!.source, 'account');
    assert.equal(next[0]!.event_type, 'account_trade');
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed telemetry writer stays isolated from callers', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pasture-telemetry-failure-'));
  const service = new TelemetryService(dir, 30);
  try {
    const deadline = Date.now() + 5000;
    while (service.status().state === 'starting' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(service.status().state, 'failed');
    assert.doesNotThrow(() => service.record({ type: 'tick', ts: Date.now(), symbol: 'R_50', digit: 4 }));
    await assert.rejects(service.query(0, 10));
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
