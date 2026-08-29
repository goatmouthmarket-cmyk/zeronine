import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-momentum-focus-'));

test('focusing a watched market drops the scan feeds and retains only the selected chart seed', async () => {
  const [{ Hub }, { MomentumObserver }] = await Promise.all([
    import('../src/api/hub.ts'), import('../src/momentum/observer.ts'),
  ]);
  const observer = new MomentumObserver(new Hub()) as any;
  const sent: Array<Record<string, unknown>> = [];
  observer.ws = { send: (payload: string) => sent.push(JSON.parse(payload)) };
  observer.running = true;
  observer.phase = 'scanning';
  observer.markets = [
    { symbol: 'cryBTCUSD', display: 'Bitcoin/USD', market: 'cryptocurrency' },
    { symbol: 'frxEURUSD', display: 'EUR/USD', market: 'forex' },
  ];
  observer.scanStartedAt = 100;
  observer.scanTicks = new Map([
    ['cryBTCUSD', [{ epoch: 100, quote: 100 }, { epoch: 130, quote: 101 }]],
    ['frxEURUSD', [{ epoch: 100, quote: 1.08 }, { epoch: 130, quote: 1.081 }]],
  ]);

  const state = observer.focus('cryBTCUSD');
  assert.equal(state.phase, 'observing');
  assert.equal(state.config.symbol, 'cryBTCUSD');
  assert.equal(state.scan, null);
  assert.deepEqual(state.window.samples.map((sample: { quote: number }) => sample.quote), [100, 101]);
  assert.ok(sent.some((payload) => payload.forget_all === 'ticks'));
  assert.ok(sent.some((payload) => payload.ticks === 'cryBTCUSD' && payload.subscribe === 1));
});

test('a scan with partial but usable evidence focuses the strongest observed market', async () => {
  const [{ Hub }, { MomentumObserver }] = await Promise.all([
    import('../src/api/hub.ts'), import('../src/momentum/observer.ts'),
  ]);
  const observer = new MomentumObserver(new Hub()) as any;
  const sent: Array<Record<string, unknown>> = [];
  const now = Math.floor(Date.now() / 1000);
  observer.ws = { send: (payload: string) => sent.push(JSON.parse(payload)) };
  observer.running = true;
  observer.phase = 'scanning';
  observer.generation = 7;
  observer.markets = [
    { symbol: 'cryBTCUSD', display: 'Bitcoin/USD', market: 'cryptocurrency' },
    { symbol: 'frxEURUSD', display: 'EUR/USD', market: 'forex' },
  ];
  observer.scanStartedAt = now - 60;
  observer.scanTicks = new Map([
    ['cryBTCUSD', [{ epoch: now - 45, quote: 100 }, { epoch: now, quote: 100.1 }]],
    ['frxEURUSD', [{ epoch: now - 45, quote: 1.08 }, { epoch: now, quote: 1.08001 }]],
  ]);

  observer.finishScan(7);

  const state = observer.state();
  assert.equal(state.running, true);
  assert.equal(state.phase, 'observing');
  assert.equal(state.config.symbol, 'cryBTCUSD');
  assert.match(state.reason, /No full aligned 60-second signal yet/);
  assert.ok(sent.some((payload) => payload.ticks === 'cryBTCUSD' && payload.subscribe === 1));
});

test('automatic scan skips a stronger market when historical evidence blocks its direction', async () => {
  const [{ Hub }, { MomentumObserver }] = await Promise.all([
    import('../src/api/hub.ts'), import('../src/momentum/observer.ts'),
  ]);
  const observer = new MomentumObserver(new Hub()) as any;
  const sent: Array<Record<string, unknown>> = [];
  const now = Math.floor(Date.now() / 1000);
  const ticks = (values: number[]) => values.map((quote, index) => ({ epoch: now - 60 + index * 15, quote }));
  observer.ws = { send: (payload: string) => sent.push(JSON.parse(payload)) };
  observer.running = true;
  observer.phase = 'scanning';
  observer.generation = 9;
  observer.markets = [
    { symbol: 'R_BAD', display: 'Strong But Bad History', market: 'synthetic_index' },
    { symbol: 'R_OK', display: 'Cleaner Momentum', market: 'synthetic_index' },
  ];
  observer.scanStartedAt = now - 60;
  observer.scanTicks = new Map([
    ['R_BAD', ticks([100, 100.2, 100.4, 100.6, 101])],
    ['R_OK', ticks([100, 100.08, 100.16, 100.24, 100.34])],
  ]);
  observer.researchProfiles = new Map([
    ['R_BAD:up', {
      symbol: 'R_BAD',
      direction: 'up',
      windows: 12,
      wins: 3,
      losses: 9,
      win_rate: .25,
      estimated_net: -4.5,
      last_completed_at: Date.now(),
    }],
  ]);

  observer.finishScan(9);

  const state = observer.state();
  assert.equal(state.running, true);
  assert.equal(state.phase, 'observing');
  assert.equal(state.config.symbol, 'R_OK');
  assert.ok(sent.some((payload) => payload.ticks === 'R_OK' && payload.subscribe === 1));
});

test('a scan without usable ticks stays active and starts another bounded comparison', async () => {
  const [{ Hub }, { MomentumObserver }] = await Promise.all([
    import('../src/api/hub.ts'), import('../src/momentum/observer.ts'),
  ]);
  const observer = new MomentumObserver(new Hub()) as any;
  observer.ws = { send: () => undefined };
  observer.running = true;
  observer.phase = 'scanning';
  observer.generation = 3;
  observer.scanStartedAt = Math.floor(Date.now() / 1000) - 60;
  observer.scanTicks = new Map([['cryBTCUSD', []]]);

  observer.finishScan(3);

  const state = observer.state();
  assert.equal(state.running, true);
  assert.equal(state.phase, 'scanning');
  assert.match(state.reason, /extending the market comparison/);
  observer.stop();
});
