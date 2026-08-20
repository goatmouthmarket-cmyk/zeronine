import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overunder-paper-'));
process.env.DATA_DIR = tmp;
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

test('paper sweep', async (t) => {
  const [storeMod, hubMod, paperMod] = await Promise.all([
    import('../src/db/store.ts'),
    import('../src/api/hub.ts'),
    import('../src/testlab/paper.ts'),
  ]);

  const setSession = (mode: 'demo' | 'real') =>
    storeMod.setSession({
      id: 'test',
      loginid: 'TEST000000',
      balance: 100,
      currency: 'USD',
      mode,
      auth_kind: 'pat',
      token_cipher: 'x',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

  const makeMock = () => {
    const m = {
      running: false,
      started: 0,
      stopped: 0,
      state: () => ({ runTrades: m.running ? 4 : 0, running: m.running }),
      isRunning: () => m.running,
      start: (_opts: { maxTrades?: number }) => {
        m.running = true;
        m.started += 1;
        setTimeout(() => {
          m.running = false;
        }, 5);
      },
      stop: (_reason?: string) => {
        m.running = false;
        m.stopped += 1;
      },
    };
    return m;
  };

  await t.test('rejects when no session is connected', async () => {
    const hub = new hubMod.Hub();
    const mock = makeMock();
    await assert.rejects(
      paperMod.runPaperSweep(mock, hub, { configs: [{ strategyMode: 'conservative', botMode: 'rapid' }], tradesPerConfig: 2 }),
      (err: Error & { code?: string }) => err.code === 'NO_SESSION',
    );
  });

  await t.test('rejects a real-account session (demo-only)', async () => {
    setSession('real');
    const hub = new hubMod.Hub();
    const mock = makeMock();
    await assert.rejects(
      paperMod.runPaperSweep(mock, hub, { configs: [{ strategyMode: 'conservative', botMode: 'rapid' }], tradesPerConfig: 2 }),
      (err: Error & { code?: string }) => err.code === 'REAL_MODE',
    );
  });

  await t.test('rejects when the bot is already running', async () => {
    setSession('demo');
    const hub = new hubMod.Hub();
    const mock = {
      running: true,
      started: 0,
      stopped: 0,
      state: () => ({ runTrades: 0, running: true }),
      isRunning: () => true,
      start: () => undefined,
      stop: () => undefined,
    };
    await assert.rejects(
      paperMod.runPaperSweep(mock, hub, { configs: [{ strategyMode: 'conservative', botMode: 'rapid' }], tradesPerConfig: 2 }),
      (err: Error & { code?: string }) => err.code === 'BOT_RUNNING',
    );
  });

  await t.test('runs each config, persists paper runs, restores settings', async () => {
    setSession('demo');
    const hub = new hubMod.Hub();
    const mock = makeMock();
    const before = storeMod.getSettings();

    const result = await paperMod.runPaperSweep(mock, hub, {
      configs: [
        { strategyMode: 'conservative', botMode: 'rapid' },
        { strategyMode: 'chase', botMode: 'strict' },
      ],
      tradesPerConfig: 4,
      timeoutMs: 4000,
    });

    assert.equal(result.completed, 2);
    assert.equal(result.failed, 0);
    assert.equal(mock.started, 2);
    assert.equal(mock.stopped, 2);

    const rows = storeMod.listTestRuns('paper', 10);
    assert.ok(rows.length >= 2, 'paper runs should be persisted');
    for (const row of rows) {
      assert.equal(row.kind, 'paper');
      assert.equal(row.trades, 0);
    }

    const after = storeMod.getSettings();
    assert.equal(after.strategy_mode, before.strategy_mode, 'strategy_mode restored');
    assert.equal(after.bot_mode, before.bot_mode, 'bot_mode restored');
  });
});