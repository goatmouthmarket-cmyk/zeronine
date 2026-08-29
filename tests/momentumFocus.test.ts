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
